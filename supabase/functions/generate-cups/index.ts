// ──────────────────────────────────────────────────────────────────────────
// PackPerks — generate-cups Edge Function (v3 — generation event logging)
//
// Admin calls this to mint a batch of fresh cup UUIDs. The UUIDs are
// embedded in the QR code printed on the deposit receipt; when a user
// scans the QR, the claim-cups function activates them and increments
// the user's balance.
//
// Every attempt (success or failure) is logged to `system_events` so the
// Stats dashboard can compute the QR-generation success rate (#1).
//
// Body: { count: number, org_id?: string }   (count 1..50)
// Returns: { batch_id, cup_ids: [uuid, ...], count }
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

// Fire-and-forget log of a generation attempt. Never blocks or fails the
// request — stats logging must not break cup minting.
async function logGeneration(
  status: "success" | "failure",
  orgId: string | null,
  actorId: string | null,
  count: number,
  detail: Record<string, unknown>,
) {
  try {
    await supabase.from("system_events").insert({
      org_id: orgId,
      event_type: "qr_generation",
      status,
      count,
      detail,
      actor_id: actorId,
    });
  } catch (e) {
    console.error("system_events insert failed:", e);
  }
}

// Returns the active admin's row ({ id, org_id }) or null.
async function getActiveAdmin(req: Request): Promise<{ id: string; org_id: string | null } | null> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  const jwt = authHeader.replace("Bearer ", "");

  const { data: { user }, error } = await supabase.auth.getUser(jwt);
  if (error || !user) return null;

  const { data: admin } = await supabase
    .from("admin_profiles")
    .select("id, org_id")
    .eq("id", user.id)
    .eq("status", "active")
    .maybeSingle();

  return admin ? { id: admin.id, org_id: admin.org_id ?? null } : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);

  const admin = await getActiveAdmin(req);
  if (!admin) {
    return jsonResponse({ error: "forbidden" }, 403);
  }

  let count = 1;
  let orgId: string | null = null;
  try {
    const body = await req.json();
    count = parseInt(body?.count, 10) || 1;
    // Multi-org: caller can pass org_id so the new cups belong to the
    // currently-active organisation in the admin dashboard. Fall back to
    // the admin's own org, then to the cups table DEFAULT.
    if (typeof body?.org_id === "string" && body.org_id.length > 0) {
      orgId = body.org_id;
    }
  } catch {
    return jsonResponse({ error: "invalid_json" }, 400);
  }
  const effectiveOrg = orgId || admin.org_id;

  // Bound the batch to keep QR payload reasonable (a 50-cup QR is already
  // ~1.9KB encoded — fits but high-density modules get hard to scan).
  if (count < 1 || count > 50) {
    await logGeneration("failure", effectiveOrg, admin.id, count, { error: "invalid_count" });
    return jsonResponse({ error: "invalid_count", detail: "count must be 1..50" }, 400);
  }

  const batchId = crypto.randomUUID();
  // Always stamp the cups with an org (the cups.org_id DB default to BK was
  // removed in migration 021 to stop cross-org leakage). Prefer the org_id
  // passed by the dashboard, fall back to the calling admin's org.
  const rows = Array.from({ length: count }, () => ({
    id: crypto.randomUUID(),
    batch_id: batchId,
    source: "admin_batch",
    status: "available",
    ...(effectiveOrg ? { org_id: effectiveOrg } : {}),
  }));

  const { data, error } = await supabase
    .from("cups")
    .insert(rows)
    .select("id");

  if (error) {
    await logGeneration("failure", effectiveOrg, admin.id, count, { batch_id: batchId, error: error.message });
    return jsonResponse({ error: "db_error", detail: error.message }, 500);
  }

  await logGeneration("success", effectiveOrg, admin.id, data?.length ?? 0, { batch_id: batchId });

  // Return the org we ACTUALLY minted under (+ its slug) so the dashboard
  // can build the QR URL from the authoritative server value instead of a
  // possibly-stale client context. This guarantees the slug in the scanned
  // URL always matches the org that owns the cups.
  let orgSlug: string | null = null;
  if (effectiveOrg) {
    const { data: orgRow } = await supabase
      .from("organizations")
      .select("slug")
      .eq("id", effectiveOrg)
      .maybeSingle();
    orgSlug = orgRow?.slug ?? null;
  }

  return jsonResponse({
    batch_id: batchId,
    cup_ids: (data || []).map((r: { id: string }) => r.id),
    count: data?.length ?? 0,
    org_id: effectiveOrg ?? null,
    slug: orgSlug,
  });
});
