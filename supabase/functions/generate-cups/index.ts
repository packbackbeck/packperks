// ──────────────────────────────────────────────────────────────────────────
// PackPerks — generate-cups Edge Function
//
// Admin calls this to mint a batch of fresh cup UUIDs. The UUIDs are
// embedded in the QR code printed on the deposit receipt; when a user
// scans the QR, the claim-cups function activates them and increments
// the user's balance.
//
// Body: { count: number }   (1..50)
// Returns: { batch_id, cup_ids: [uuid, ...], count }
//
// Note: no JWT verification — admin panel is currently unauthenticated.
// Lock this down with auth before going public.
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);

  let count = 1;
  let orgId: string | null = null;
  try {
    const body = await req.json();
    count = parseInt(body?.count, 10) || 1;
    // Multi-org: caller can pass org_id so the new cups belong to the
    // currently-active organisation in the admin dashboard. Older
    // callers omit it and the cups table's DEFAULT (set by migration
    // 011) points at the canonical default org as a fallback.
    if (typeof body?.org_id === "string" && body.org_id.length > 0) {
      orgId = body.org_id;
    }
  } catch {
    return jsonResponse({ error: "invalid_json" }, 400);
  }
  // Bound the batch to keep QR payload reasonable (a 50-cup QR is already
  // ~1.9KB encoded — fits but high-density modules get hard to scan).
  if (count < 1 || count > 50) {
    return jsonResponse({ error: "invalid_count", detail: "count must be 1..50" }, 400);
  }

  const batchId = crypto.randomUUID();
  const rows = Array.from({ length: count }, () => ({
    id: crypto.randomUUID(),
    batch_id: batchId,
    source: "admin_batch",
    status: "available",
    ...(orgId ? { org_id: orgId } : {}),
  }));

  const { data, error } = await supabase
    .from("cups")
    .insert(rows)
    .select("id");

  if (error) return jsonResponse({ error: "db_error", detail: error.message }, 500);
  return jsonResponse({
    batch_id: batchId,
    cup_ids: (data || []).map((r: { id: string }) => r.id),
    count: data?.length ?? 0,
  });
});
