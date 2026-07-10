// ──────────────────────────────────────────────────────────────────────────
// PackPerks — admin-merge-users Edge Function
//
// Lets an admin fold multiple PackPerks user accounts into one. Common case:
// the same person opened the app several times from QR/in-app browsers,
// produced multiple anonymous rows, and (sometimes) re-typed their email
// on each one. The dashboard "Merge users" flow calls this with a chosen
// survivor + the absorbed ids.
//
// Behaviour:
//   • Verify the caller is an admin (admin_profiles row with role in
//     owner/admin/manager).
//   • Resolve survivor + absorbed users. Require: all live in the same org,
//     none already merged into another row, and the survivor is not in the
//     absorbed list. Refuse otherwise.
//   • The whole SUM-balance → repoint-FKs → delete-absorbed-balance →
//     tombstone sequence runs atomically in ONE transaction via the
//     merge_user_rows() RPC (A.10/A.12) — no double-count, no orphaned claims.
//   • For each profile field (display_name, email, selected_reward_id,
//     device, device_id), pick the most-recently-updated NON-EMPTY value
//     across (survivor ∪ absorbed) and apply it to the survivor afterwards.
//   • No IBAN is carried (D.1 — the field is retired).
//   • Write a single admin_action_log row summarising the merge.
//
// All writes use the service role (admin_profiles & users are RLS-locked).
// The caller's JWT identifies them so we can check their admin role.
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
  "display_name",
  "email",
  "selected_reward_id",
  "device",
  "device_id",
] as const;
type ProfileField = typeof PROFILE_FIELDS[number];

interface UserRow {
  id: string;
  org_id: string | null;
  display_name: string | null;
  email: string | null;
  selected_reward_id: string | null;
  device: string | null;
  device_id: string | null;
  merged_into: string | null;
  updated_at: string | null;
  created_at: string | null;
}

function nonEmpty(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === "string") return v.trim().length > 0;
  return true;
}

// Pick the most-recently-updated non-empty value across rows for each field.
// Falls back to survivor's value if nothing newer/non-empty exists.
function pickMostRecentProfile(
  survivor: UserRow,
  absorbed: UserRow[],
): Partial<Record<ProfileField, unknown>> {
  const out: Partial<Record<ProfileField, unknown>> = {};
  const candidates = [survivor, ...absorbed];
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

  // ── Authenticate the admin caller ─────────────────────────────────────
  const auth = req.headers.get("Authorization") || "";
  const jwt = auth.replace(/^Bearer\s+/i, "");
  if (!jwt) return jsonResponse({ error: "missing_token" }, 401);

  const { data: userData, error: userErr } = await supabase.auth.getUser(jwt);
  if (userErr || !userData?.user) {
    return jsonResponse({ error: "invalid_token", detail: userErr?.message }, 401);
  }
  const actorId = userData.user.id;
  const actorEmail = (userData.user.email || "").toLowerCase();

  const { data: actorProfile } = await supabase
    .from("admin_profiles")
    .select("id, role, status")
    .eq("id", actorId)
    .maybeSingle();
  if (!actorProfile || actorProfile.status !== "active") {
    return jsonResponse({ error: "not_admin" }, 403);
  }
  const ALLOWED = new Set(["owner", "admin", "manager"]);
  if (!ALLOWED.has(actorProfile.role)) {
    return jsonResponse({ error: "insufficient_role", detail: actorProfile.role }, 403);
  }

  // ── Parse body ─────────────────────────────────────────────────────────
  let survivorId: string | undefined;
  let absorbedIds: string[] = [];
  try {
    const body = await req.json();
    survivorId = typeof body?.survivor_id === "string" ? body.survivor_id : undefined;
    if (Array.isArray(body?.absorbed_ids)) {
      absorbedIds = body.absorbed_ids.filter((x: unknown) => typeof x === "string");
    }
  } catch {
    return jsonResponse({ error: "invalid_json" }, 400);
  }
  if (!survivorId) return jsonResponse({ error: "missing_survivor_id" }, 400);
  // Dedup + remove the survivor id if it's accidentally in there.
  absorbedIds = [...new Set(absorbedIds)].filter((id) => id !== survivorId);
  if (absorbedIds.length === 0) {
    return jsonResponse({ error: "no_absorbed_ids" }, 400);
  }
  if (absorbedIds.length > 20) {
    return jsonResponse({ error: "too_many_absorbed", detail: "max 20 absorbed accounts per merge" }, 400);
  }

  // ── Load survivor + absorbed rows ──────────────────────────────────────
  const { data: survRow, error: survErr } = await supabase
    .from("users")
    .select("id, org_id, display_name, email, selected_reward_id, device, device_id, merged_into, updated_at, created_at")
    .eq("id", survivorId)
    .maybeSingle();
  if (survErr) return jsonResponse({ error: "db_error", detail: survErr.message }, 500);
  if (!survRow) return jsonResponse({ error: "survivor_not_found" }, 404);
  if (survRow.merged_into) return jsonResponse({ error: "survivor_already_merged" }, 409);

  const { data: absRows, error: absErr } = await supabase
    .from("users")
    .select("id, org_id, display_name, email, selected_reward_id, device, device_id, merged_into, updated_at, created_at")
    .in("id", absorbedIds);
  if (absErr) return jsonResponse({ error: "db_error", detail: absErr.message }, 500);

  const foundIds = new Set((absRows || []).map((r) => r.id));
  const missing = absorbedIds.filter((id) => !foundIds.has(id));
  if (missing.length) return jsonResponse({ error: "absorbed_not_found", detail: missing }, 404);
  const alreadyMerged = (absRows || []).filter((r) => r.merged_into);
  if (alreadyMerged.length) {
    return jsonResponse({
      error: "absorbed_already_merged",
      detail: alreadyMerged.map((r) => r.id),
    }, 409);
  }
  const wrongOrg = (absRows || []).filter((r) => r.org_id !== survRow.org_id);
  if (wrongOrg.length) {
    return jsonResponse({
      error: "cross_org_merge_refused",
      detail: wrongOrg.map((r) => r.id),
    }, 409);
  }

  const absorbed: UserRow[] = (absRows || []) as unknown as UserRow[];
  const survivor: UserRow = survRow as unknown as UserRow;

  // ── Capture pre-merge balances (for the audit before_state only) ──────
  const allIds = [survivorId, ...absorbedIds];
  const { data: balances } = await supabase
    .from("cup_balances")
    .select("user_id, balance, lifetime_cups")
    .in("user_id", allIds);

  // ── Atomic merge (A.10/A.12) ──────────────────────────────────────────
  // One transaction: sum balances → repoint FKs → delete absorbed balances →
  // tombstone absorbed users. Cross-org is already refused above (409); the RPC
  // re-enforces the guard. No half-merged state, no double-count.
  const { data: mergeRes, error: mergeErr } = await supabase.rpc("merge_user_rows", {
    p_survivor: survivorId,
    p_absorbed: absorbedIds,
    p_enforce_same_org: true,
  });
  if (mergeErr) {
    return jsonResponse({ error: "merge_failed", detail: mergeErr.message }, 500);
  }
  const mergedBalance = (mergeRes as { merged_balance?: number })?.merged_balance ?? 0;
  const mergedLifetime = (mergeRes as { merged_lifetime?: number })?.merged_lifetime ?? 0;

  // ── Update survivor with most-recent profile fields ──
  const profileUpdate = pickMostRecentProfile(survivor, absorbed);
  const { error: survUpdErr } = await supabase
    .from("users")
    .update({ ...profileUpdate, updated_at: new Date().toISOString() })
    .eq("id", survivorId);
  if (survUpdErr) {
    return jsonResponse({ error: "survivor_update_failed", detail: survUpdErr.message }, 500);
  }

  // ── Audit log ──────────────────────────────────────────────────────────
  await supabase.from("admin_action_log").insert({
    actor_id: actorId,
    actor_email: actorEmail,
    org_id: survivor.org_id,
    action: "user.merge",
    target_type: "user",
    target_id: survivorId,
    before_state: {
      survivor: { id: survivorId, balance: balances?.find((b) => b.user_id === survivorId)?.balance ?? 0 },
      absorbed: absorbedIds.map((id) => ({
        id,
        balance: balances?.find((b) => b.user_id === id)?.balance ?? 0,
      })),
    },
    after_state: {
      survivor_id: survivorId,
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
    survivor_id: survivorId,
    absorbed_ids: absorbedIds,
    merged_balance: mergedBalance,
    merged_lifetime: mergedLifetime,
    profile_update: profileUpdate,
  });
});
