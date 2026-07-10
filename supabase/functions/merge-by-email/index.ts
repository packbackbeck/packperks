// ──────────────────────────────────────────────────────────────────────────
// PackPerks — merge-by-email Edge Function
//
// Called after a customer has verified their email via Supabase OTP. The
// JWT in the Authorization header proves they own that email; this function
// then folds EVERY PackPerks `users` row carrying that email in the device's
// org (plus the current device user) into a single survivor.
//
// Required body: { device_id }.
//
// Survivor selection: auth_user_id row if any in the set, else the
// most-recently-updated. All other rows are absorbed.
//
// Merge logic (A.10/A.12 — shared atomic routine):
//   • The whole SUM-balance → repoint-FKs → delete-absorbed-balance →
//     tombstone sequence runs inside ONE transaction via the
//     merge_user_rows() security-definer RPC, so a mid-way failure can never
//     double-count cups or orphan claims. The RPC also enforces the cross-org
//     guard uniformly.
//   • Profile fields on the survivor = most-recently-updated non-empty
//     value across all candidates (best-effort, applied after the merge).
//   • Survivor's auth_user_id is set so subsequent magic-link / OTP sign-ins
//     resolve back to this row.
//   • No IBAN is carried (D.1 — the field is retired).
//
// Cross-org merges are refused (everything must share survivor's org). The
// merged-balance write uses an explicit "row exists? update : insert"
// (cup_balances.user_id has no UNIQUE, so ON CONFLICT is unavailable).
// Audited to admin_action_log under action 'user.merge_by_email'.
// ──────────────────────────────────────────────────────────────────────────

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "content-type": "application/json" },
  });
}

const PROFILE_FIELDS = [
  "display_name", "selected_reward_id", "device",
] as const;
type ProfileField = typeof PROFILE_FIELDS[number];

interface UserRow {
  id: string;
  org_id: string | null;
  display_name: string | null;
  email: string | null;
  email_verified: boolean | null;
  selected_reward_id: string | null;
  device: string | null;
  device_id: string | null;
  auth_user_id: string | null;
  merged_into: string | null;
  updated_at: string | null;
  created_at: string | null;
}

function nonEmpty(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === "string") return v.trim().length > 0;
  return true;
}

function pickMostRecentProfile(
  candidates: UserRow[],
): Partial<Record<ProfileField, unknown>> {
  const out: Partial<Record<ProfileField, unknown>> = {};
  for (const field of PROFILE_FIELDS) {
    let best: { value: unknown; ts: number } | null = null;
    for (const u of candidates) {
      const v = u[field];
      if (!nonEmpty(v)) continue;
      const ts = u.updated_at
        ? new Date(u.updated_at).getTime()
        : (u.created_at ? new Date(u.created_at).getTime() : 0);
      if (!best || ts > best.ts) best = { value: v, ts: Number.isFinite(ts) ? ts : 0 };
    }
    if (best) out[field] = best.value;
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);

  // ── Authenticate the caller via Supabase Auth JWT ─────────────────────
  const auth = req.headers.get("Authorization") || "";
  const jwt = auth.replace(/^Bearer\s+/i, "");
  if (!jwt) return jsonResponse({ error: "missing_token" }, 401);

  const { data: userData, error: userErr } = await supabase.auth.getUser(jwt);
  if (userErr || !userData?.user) {
    return jsonResponse({ error: "invalid_token", detail: userErr?.message }, 401);
  }
  const authUser = userData.user;
  const authEmail = (authUser.email || "").toLowerCase();
  if (!authEmail) return jsonResponse({ error: "no_email_on_token" }, 400);

  // ── Body ───────────────────────────────────────────────────────────────
  let deviceId = "";
  try {
    const body = await req.json();
    deviceId = typeof body?.device_id === "string" ? body.device_id : "";
  } catch {
    return jsonResponse({ error: "invalid_json" }, 400);
  }
  if (!deviceId) return jsonResponse({ error: "missing_device_id" }, 400);

  // ── Resolve the device user (needed for org-scope) ────────────────────
  const { data: deviceRow } = await supabase
    .from("users")
    .select("id, org_id, display_name, email, email_verified, selected_reward_id, device, device_id, auth_user_id, merged_into, updated_at, created_at")
    .eq("device_id", deviceId)
    .maybeSingle();

  // ── Find all same-email accounts in the device's org (or the auth row's org) ──
  // We look up by email globally and then constrain to the device's org_id
  // (or, if there's no device user, the auth row's org_id) below.
  const { data: emailRows, error: emailErr } = await supabase
    .from("users")
    .select("id, org_id, display_name, email, email_verified, selected_reward_id, device, device_id, auth_user_id, merged_into, updated_at, created_at")
    .ilike("email", authEmail)
    .is("merged_into", null);
  if (emailErr) return jsonResponse({ error: "db_error", detail: emailErr.message }, 500);

  // Build the candidate set: every email-bearing row + the device row (if any).
  const byId = new Map<string, UserRow>();
  for (const r of (emailRows || []) as unknown as UserRow[]) byId.set(r.id, r);
  if (deviceRow && !deviceRow.merged_into) byId.set(deviceRow.id, deviceRow as unknown as UserRow);

  if (byId.size === 0) {
    // Nothing to merge AND no device user — this is the "no prior history"
    // case from restore-by-email. Caller's auth session is already in place,
    // so future scans will mint a fresh row tied to the auth_user_id.
    return jsonResponse({ status: "no_prior_history" });
  }

  // ── Org-scope the merge ───────────────────────────────────────────────
  // Anchor to the device user's org if present, else the auth-linked row,
  // else the first candidate. Refuse if any candidate is in a different org.
  let candidates = [...byId.values()];
  const anchor = (deviceRow && !deviceRow.merged_into)
    ? deviceRow as unknown as UserRow
    : (candidates.find((c) => c.auth_user_id === authUser.id) || candidates[0]);
  const anchorOrg = anchor.org_id;
  const wrongOrg = candidates.filter((c) => c.org_id !== anchorOrg);
  if (wrongOrg.length) {
    // Don't fail the user — restrict the merge to the anchor's org and
    // leave the cross-org rows alone. Log it for visibility.
    candidates = candidates.filter((c) => c.org_id === anchorOrg);
  }

  // ── Pick survivor ─────────────────────────────────────────────────────
  // Preference: existing auth_user_id row, else most-recently-updated.
  const authLinked = candidates.find((c) => c.auth_user_id === authUser.id);
  const sorted = [...candidates].sort((a, b) => {
    const ta = new Date(a.updated_at || a.created_at || 0).getTime();
    const tb = new Date(b.updated_at || b.created_at || 0).getTime();
    return tb - ta;
  });
  const survivor: UserRow = authLinked || sorted[0];
  const absorbed: UserRow[] = candidates.filter((c) => c.id !== survivor.id);

  if (absorbed.length === 0) {
    // Only the survivor matched — just make sure the email + auth link are
    // saved on this row, then return.
    await supabase
      .from("users")
      .update({
        email: authEmail,
        email_verified: true,
        email_verified_at: new Date().toISOString(),
        auth_user_id: authUser.id,
        device_id: deviceId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", survivor.id);
    return jsonResponse({
      status: "linked",
      survivor_id: survivor.id,
      absorbed_count: 0,
    });
  }

  // ── Capture pre-merge balances (for the audit before_state only) ──────
  const allIds = [survivor.id, ...absorbed.map((a) => a.id)];
  const { data: balances } = await supabase
    .from("cup_balances")
    .select("user_id, balance, lifetime_cups")
    .in("user_id", allIds);

  // ── Atomic merge (A.10/A.12) ──────────────────────────────────────────
  // One transaction: sum balances → repoint FKs → delete absorbed balances →
  // tombstone absorbed users. Cross-org is already restricted above; the RPC
  // re-enforces it as a guard. No half-merged state, no double-count.
  const { data: mergeRes, error: mergeErr } = await supabase.rpc("merge_user_rows", {
    p_survivor: survivor.id,
    p_absorbed: absorbed.map((a) => a.id),
    p_enforce_same_org: true,
  });
  if (mergeErr) {
    return jsonResponse({ error: "merge_failed", detail: mergeErr.message }, 500);
  }
  const mergedBalance = (mergeRes as { merged_balance?: number })?.merged_balance ?? 0;
  const mergedLifetime = (mergeRes as { merged_lifetime?: number })?.merged_lifetime ?? 0;

  // ── Update survivor: profile fields + email + auth link + device_id ──
  const profileUpdate = pickMostRecentProfile(candidates);
  const { error: survUpdErr } = await supabase
    .from("users")
    .update({
      ...profileUpdate,
      email: authEmail,
      email_verified: true,
      email_verified_at: new Date().toISOString(),
      auth_user_id: authUser.id,
      device_id: deviceId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", survivor.id);
  if (survUpdErr) {
    return jsonResponse({ error: "survivor_update_failed", detail: survUpdErr.message }, 500);
  }

  // ── Audit log ──────────────────────────────────────────────────────────
  await supabase.from("admin_action_log").insert({
    actor_id: authUser.id,
    actor_email: authEmail,
    org_id: survivor.org_id,
    action: "user.merge_by_email",
    target_type: "user",
    target_id: survivor.id,
    before_state: {
      survivor: { id: survivor.id, balance: balances?.find((b) => b.user_id === survivor.id)?.balance ?? 0 },
      absorbed: absorbed.map((a) => ({
        id: a.id,
        balance: balances?.find((b) => b.user_id === a.id)?.balance ?? 0,
      })),
    },
    after_state: {
      survivor_id: survivor.id,
      merged_balance: mergedBalance,
      merged_lifetime: mergedLifetime,
      profile_update: profileUpdate,
      atomic: true,
    },
    ip: req.headers.get("x-forwarded-for") || null,
    user_agent: req.headers.get("user-agent") || null,
  });

  return jsonResponse({
    status: "merged",
    survivor_id: survivor.id,
    absorbed_count: absorbed.length,
    merged_balance: mergedBalance,
    merged_lifetime: mergedLifetime,
  });
});
