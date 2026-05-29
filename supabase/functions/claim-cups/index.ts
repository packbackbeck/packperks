// ──────────────────────────────────────────────────────────────────────────
// PackPerks — claim-cups Edge Function (v4 — H-3 CORS + H-4 ownership)
//
// Activates cups for a scanning user and writes an audit row to cup_scans
// for every attempt — success or failure — so admins have a complete log.
//
// Body: { user_id, device_id, batch_id | cup_ids, scan_type?, photo_path?, scan_id? }
// Returns 200 on success; 409 when no cups could be activated.
// ──────────────────────────────────────────────────────────────────────────

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL      = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ALLOWED_ORIGIN    = Deno.env.get("ALLOWED_ORIGIN") ?? null;

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") ?? "";
  const allow  = ALLOWED_ORIGIN
    ? (origin === ALLOWED_ORIGIN ? origin : null)
    : "*";
  const h: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
  if (allow) h["Access-Control-Allow-Origin"] = allow;
  return h;
}

/** Verify the caller owns `userId`.
 *  Email users:    JWT → auth_user_id join in users table.
 *  Anonymous users: device_id match in users table (proof-of-possession). */
async function ownsUser(req: Request, userId: string, deviceId: string | null): Promise<boolean> {
  const authHeader = req.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const jwt = authHeader.replace("Bearer ", "");
    const { data: { user }, error } = await supabase.auth.getUser(jwt);
    if (!error && user) {
      const { data } = await supabase
        .from("users").select("id")
        .eq("auth_user_id", user.id).eq("id", userId)
        .maybeSingle();
      return data !== null;
    }
  }
  if (!deviceId || !UUID_RE.test(deviceId)) return false;
  const { data } = await supabase
    .from("users").select("id")
    .eq("id", userId).eq("device_id", deviceId)
    .maybeSingle();
  return data !== null;
}

interface ScanEvent {
  id?: string;
  user_id: string;
  source: "qr";
  scan_type: string | null;
  batch_id: string | null;
  requested_cup_ids: string[];
  activated_cup_ids: string[];
  cups_awarded: number;
  status: "success" | "failed" | "partial";
  error_code: string | null;
  error_message: string | null;
  photo_path: string | null;
}

async function recordScanEvent(ev: ScanEvent) {
  try {
    await supabase.from("cup_scans").insert(ev);
  } catch (e) {
    console.error("cup_scans insert failed:", e);
  }
}

Deno.serve(async (req) => {
  const CORS = corsHeaders(req);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...CORS, "content-type": "application/json" },
    });

  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let body: {
    user_id?: string;
    device_id?: string;
    cup_ids?: string[];
    batch_id?: string;
    scan_type?: string;
    photo_path?: string;
    scan_id?: string;
  };
  try { body = await req.json(); }
  catch { return json({ error: "invalid_json" }, 400); }

  const userId    = body?.user_id ?? null;
  const deviceId  = body?.device_id ?? null;
  const rawBatchId  = body?.batch_id;
  const rawCupIds   = Array.isArray(body?.cup_ids) ? body.cup_ids : [];
  const scanType    = body?.scan_type ?? null;
  const photoPath   = body?.photo_path ?? null;
  const scanId      = body?.scan_id;

  if (!userId || !UUID_RE.test(userId))
    return json({ error: "missing_or_invalid_user_id" }, 400);
  if (scanId && !UUID_RE.test(scanId))
    return json({ error: "invalid_scan_id" }, 400);

  if (!await ownsUser(req, userId, deviceId))
    return json({ error: "forbidden" }, 403);

  // ── Resolve which cup UUIDs to attempt to claim ─────────────────────
  let candidateIds: string[] = [];
  let resolvedBatchId: string | null = null;

  if (rawBatchId) {
    if (!UUID_RE.test(rawBatchId))
      return json({ error: "invalid_batch_id" }, 400);
    resolvedBatchId = rawBatchId;
    const { data: rows, error } = await supabase
      .from("cups").select("id").eq("batch_id", rawBatchId);
    if (error) return json({ error: "db_error", detail: error.message }, 500);
    candidateIds = (rows || []).map((r: { id: string }) => r.id);
    if (candidateIds.length === 0) {
      await recordScanEvent({
        id: scanId, user_id: userId, source: "qr", scan_type: scanType,
        batch_id: resolvedBatchId, requested_cup_ids: [], activated_cup_ids: [],
        cups_awarded: 0, status: "failed", error_code: "batch_not_found",
        error_message: "No cups exist for that batch.", photo_path: photoPath,
      });
      return json({
        error: "no_cups_claimed",
        reason: "This QR code is not valid — no cups found for the batch.",
        activatedCount: 0, requestedCount: 0, alreadyClaimed: [],
      }, 409);
    }
  } else {
    candidateIds = Array.from(
      new Set(rawCupIds.map((s) => String(s).trim()).filter(Boolean)),
    );
    if (candidateIds.length === 0) return json({ error: "no_cups" }, 400);
    if (candidateIds.length > 60)  return json({ error: "too_many" }, 400);
    for (const id of candidateIds) {
      if (!UUID_RE.test(id)) return json({ error: "invalid_uuid", detail: id }, 400);
    }
  }

  // ── Pre-check revoked / expired ──────────────────────────────────────
  const { data: candidateRows } = await supabase
    .from("cups").select("id, revoked_at, expires_at, revoked_reason")
    .in("id", candidateIds);
  const nowTs     = Date.now();
  const allRevoked = (candidateRows || []).every((r: { revoked_at: string | null }) => r.revoked_at != null);
  const allExpired = (candidateRows || []).every((r: { expires_at: string | null }) =>
    r.expires_at != null && new Date(r.expires_at).getTime() <= nowTs,
  );

  if ((candidateRows || []).length > 0 && allRevoked) {
    const reason = candidateRows![0].revoked_reason || "This QR batch was revoked by an admin.";
    await recordScanEvent({
      id: scanId, user_id: userId, source: "qr", scan_type: scanType,
      batch_id: resolvedBatchId, requested_cup_ids: candidateIds, activated_cup_ids: [],
      cups_awarded: 0, status: "failed", error_code: "batch_revoked",
      error_message: reason, photo_path: photoPath,
    });
    return json({ error: "batch_revoked", reason, activatedCount: 0, requestedCount: candidateIds.length, alreadyClaimed: [] }, 409);
  }
  if ((candidateRows || []).length > 0 && allExpired) {
    await recordScanEvent({
      id: scanId, user_id: userId, source: "qr", scan_type: scanType,
      batch_id: resolvedBatchId, requested_cup_ids: candidateIds, activated_cup_ids: [],
      cups_awarded: 0, status: "failed", error_code: "batch_expired",
      error_message: "This QR batch has expired.", photo_path: photoPath,
    });
    return json({ error: "batch_expired", reason: "This QR batch has expired.", activatedCount: 0, requestedCount: candidateIds.length, alreadyClaimed: [] }, 409);
  }

  // ── Atomically claim still-claimable rows ────────────────────────────
  const nowIso = new Date().toISOString();
  const { data: activated, error: actErr } = await supabase
    .from("cups")
    .update({ status: "activated", activated_at: nowIso, activated_by_user_id: userId })
    .in("id", candidateIds)
    .eq("status", "available")
    .is("revoked_at", null)
    .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
    .select("id");

  if (actErr) {
    await recordScanEvent({
      id: scanId, user_id: userId, source: "qr", scan_type: scanType,
      batch_id: resolvedBatchId, requested_cup_ids: candidateIds, activated_cup_ids: [],
      cups_awarded: 0, status: "failed", error_code: "db_error",
      error_message: actErr.message, photo_path: photoPath,
    });
    return json({ error: "db_error", detail: actErr.message }, 500);
  }

  const activatedIds   = (activated ?? []).map((r: { id: string }) => r.id);
  const activatedCount = activatedIds.length;
  const activatedSet   = new Set(activatedIds);
  const alreadyClaimed = candidateIds.filter((id) => !activatedSet.has(id));

  if (activatedCount === 0) {
    await recordScanEvent({
      id: scanId, user_id: userId, source: "qr", scan_type: scanType,
      batch_id: resolvedBatchId, requested_cup_ids: candidateIds, activated_cup_ids: [],
      cups_awarded: 0, status: "failed", error_code: "already_claimed",
      error_message: "All cups in this QR have already been activated by another user.",
      photo_path: photoPath,
    });
    return json({
      error: "no_cups_claimed",
      reason: "These cups have already been claimed, or the QR code is invalid.",
      activatedCount: 0, requestedCount: candidateIds.length, alreadyClaimed,
    }, 409);
  }

  // ── Bump balance + lifetime ──────────────────────────────────────────
  const { data: balanceRow } = await supabase
    .from("cup_balances").select("balance, lifetime_cups")
    .eq("user_id", userId).maybeSingle();

  const newBalance  = (balanceRow?.balance || 0) + activatedCount;
  const newLifetime = (balanceRow?.lifetime_cups || 0) + activatedCount;

  const { error: balErr } = await supabase
    .from("cup_balances")
    .update({ balance: newBalance, lifetime_cups: newLifetime, updated_at: new Date().toISOString() })
    .eq("user_id", userId);

  if (balErr) {
    await recordScanEvent({
      id: scanId, user_id: userId, source: "qr", scan_type: scanType,
      batch_id: resolvedBatchId, requested_cup_ids: candidateIds,
      activated_cup_ids: activatedIds, cups_awarded: activatedCount,
      status: "failed", error_code: "balance_update_failed",
      error_message: balErr.message, photo_path: photoPath,
    });
    return json({ error: "balance_update_failed", detail: balErr.message }, 500);
  }

  const label = activatedCount === 1
    ? "Cup returned at Burger King"
    : `${activatedCount} cups returned at Burger King`;
  await supabase.from("activity_history").insert({ user_id: userId, type: "cup_added", label });

  await recordScanEvent({
    id: scanId, user_id: userId, source: "qr", scan_type: scanType,
    batch_id: resolvedBatchId, requested_cup_ids: candidateIds,
    activated_cup_ids: activatedIds, cups_awarded: activatedCount,
    status: alreadyClaimed.length > 0 ? "partial" : "success",
    error_code: null, error_message: null, photo_path: photoPath,
  });

  return json({
    activatedCount, requestedCount: candidateIds.length,
    newBalance, partial: activatedCount < candidateIds.length,
    alreadyClaimed, batchId: resolvedBatchId,
  });
});
