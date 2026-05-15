// ──────────────────────────────────────────────────────────────────────────
// PackPerks — claim-cups Edge Function (v3 — P-21 expiry + revoke)
//
// Activates cups for a scanning user and writes an audit row to cup_scans
// for every attempt — success or failure — so admins have a complete log.
//
// Accepts EITHER form (both produced by the QR pipeline):
//   { user_id, batch_id, ... }   — preferred, keeps QR payload tiny
//   { user_id, cup_ids: [...], ... }  — legacy: explicit UUID list
//
// Optional fields:
//   scan_type:  'camera' | 'gallery' | 'deeplink'
//   photo_path: storage key in `cup-scans` bucket (client uploads before call)
//   scan_id:    UUID minted by the client; used as cup_scans.id so the
//               client can pre-upload to cup-scans/{scan_id}.jpg
//
// Pipeline:
//   1. Resolve batch_id → list of available cup UUIDs in that batch
//      (or use the provided cup_ids).
//   2. Pre-check the batch: if every cup is revoked or expired, return
//      a specific error code so the user app can show tailored copy
//      instead of the generic "already claimed".
//   3. Atomically UPDATE rows from 'available' → 'activated' filtered
//      by status + not revoked + not expired, so a race between two
//      scanners is safe.
//   4. Increment user balance + lifetime + activity history.
//   5. Insert a cup_scans event row (source='qr') capturing the verdict.
//
// Returns 200 on success; 409 when no cups could be activated.
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

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "content-type": "application/json" },
  });
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
    // Audit logging is best-effort — don't fail the claim if it errors.
    console.error("cup_scans insert failed:", e);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);

  let body: {
    user_id?: string;
    cup_ids?: string[];
    batch_id?: string;
    scan_type?: string;
    photo_path?: string;
    scan_id?: string;
  };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "invalid_json" }, 400);
  }

  const userId = body?.user_id;
  const rawBatchId = body?.batch_id;
  const rawCupIds = Array.isArray(body?.cup_ids) ? body.cup_ids : [];
  const scanType = body?.scan_type ?? null;
  const photoPath = body?.photo_path ?? null;
  const scanId = body?.scan_id;

  if (!userId || !UUID_RE.test(userId))
    return jsonResponse({ error: "missing_or_invalid_user_id" }, 400);
  if (scanId && !UUID_RE.test(scanId))
    return jsonResponse({ error: "invalid_scan_id" }, 400);

  // ── Resolve which cup UUIDs to attempt to claim ─────────────────────
  let candidateIds: string[] = [];
  let resolvedBatchId: string | null = null;

  if (rawBatchId) {
    if (!UUID_RE.test(rawBatchId))
      return jsonResponse({ error: "invalid_batch_id" }, 400);
    resolvedBatchId = rawBatchId;
    const { data: rows, error } = await supabase
      .from("cups")
      .select("id")
      .eq("batch_id", rawBatchId);
    if (error) return jsonResponse({ error: "db_error", detail: error.message }, 500);
    candidateIds = (rows || []).map((r: { id: string }) => r.id);
    if (candidateIds.length === 0) {
      await recordScanEvent({
        id: scanId,
        user_id: userId,
        source: "qr",
        scan_type: scanType,
        batch_id: resolvedBatchId,
        requested_cup_ids: [],
        activated_cup_ids: [],
        cups_awarded: 0,
        status: "failed",
        error_code: "batch_not_found",
        error_message: "No cups exist for that batch.",
        photo_path: photoPath,
      });
      return jsonResponse(
        {
          error: "no_cups_claimed",
          reason: "This QR code is not valid — no cups found for the batch.",
          activatedCount: 0,
          requestedCount: 0,
          alreadyClaimed: [],
        },
        409,
      );
    }
  } else {
    candidateIds = Array.from(
      new Set(rawCupIds.map((s) => String(s).trim()).filter(Boolean)),
    );
    if (candidateIds.length === 0)
      return jsonResponse({ error: "no_cups" }, 400);
    if (candidateIds.length > 60)
      return jsonResponse({ error: "too_many" }, 400);
    for (const id of candidateIds) {
      if (!UUID_RE.test(id))
        return jsonResponse({ error: "invalid_uuid", detail: id }, 400);
    }
  }

  // ── P-21: Pre-check revoked / expired so we can return a specific
  //         error code instead of the generic "already_claimed".
  const { data: candidateRows } = await supabase
    .from("cups")
    .select("id, revoked_at, expires_at, revoked_reason")
    .in("id", candidateIds);
  const nowTs = Date.now();
  const allRevoked = (candidateRows || []).every((r: { revoked_at: string | null }) => r.revoked_at != null);
  const allExpired = (candidateRows || []).every((r: { expires_at: string | null }) => {
    return r.expires_at != null && new Date(r.expires_at).getTime() <= nowTs;
  });
  if ((candidateRows || []).length > 0 && allRevoked) {
    const reason = candidateRows![0].revoked_reason || "This QR batch was revoked by an admin.";
    await recordScanEvent({
      id: scanId,
      user_id: userId,
      source: "qr",
      scan_type: scanType,
      batch_id: resolvedBatchId,
      requested_cup_ids: candidateIds,
      activated_cup_ids: [],
      cups_awarded: 0,
      status: "failed",
      error_code: "batch_revoked",
      error_message: reason,
      photo_path: photoPath,
    });
    return jsonResponse(
      { error: "batch_revoked", reason, activatedCount: 0, requestedCount: candidateIds.length, alreadyClaimed: [] },
      409,
    );
  }
  if ((candidateRows || []).length > 0 && allExpired) {
    await recordScanEvent({
      id: scanId,
      user_id: userId,
      source: "qr",
      scan_type: scanType,
      batch_id: resolvedBatchId,
      requested_cup_ids: candidateIds,
      activated_cup_ids: [],
      cups_awarded: 0,
      status: "failed",
      error_code: "batch_expired",
      error_message: "This QR batch has expired.",
      photo_path: photoPath,
    });
    return jsonResponse(
      { error: "batch_expired", reason: "This QR batch has expired.", activatedCount: 0, requestedCount: candidateIds.length, alreadyClaimed: [] },
      409,
    );
  }

  // ── Atomically claim every still-claimable row in the candidate set ──
  // Three filters in the WHERE clause together prevent claiming:
  //   1. status='available' — not already-activated by someone else
  //   2. revoked_at IS NULL — not killed by an admin (P-21)
  //   3. expires_at IS NULL OR expires_at > now() — not past lifetime
  const nowIso = new Date().toISOString();
  const { data: activated, error: actErr } = await supabase
    .from("cups")
    .update({
      status: "activated",
      activated_at: nowIso,
      activated_by_user_id: userId,
    })
    .in("id", candidateIds)
    .eq("status", "available")
    .is("revoked_at", null)
    .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
    .select("id");

  if (actErr) {
    await recordScanEvent({
      id: scanId,
      user_id: userId,
      source: "qr",
      scan_type: scanType,
      batch_id: resolvedBatchId,
      requested_cup_ids: candidateIds,
      activated_cup_ids: [],
      cups_awarded: 0,
      status: "failed",
      error_code: "db_error",
      error_message: actErr.message,
      photo_path: photoPath,
    });
    return jsonResponse({ error: "db_error", detail: actErr.message }, 500);
  }

  const activatedIds = (activated ?? []).map((r: { id: string }) => r.id);
  const activatedCount = activatedIds.length;
  const activatedSet = new Set(activatedIds);
  const alreadyClaimed = candidateIds.filter((id) => !activatedSet.has(id));

  if (activatedCount === 0) {
    await recordScanEvent({
      id: scanId,
      user_id: userId,
      source: "qr",
      scan_type: scanType,
      batch_id: resolvedBatchId,
      requested_cup_ids: candidateIds,
      activated_cup_ids: [],
      cups_awarded: 0,
      status: "failed",
      error_code: "already_claimed",
      error_message:
        "All cups in this QR have already been activated by another user.",
      photo_path: photoPath,
    });
    return jsonResponse(
      {
        error: "no_cups_claimed",
        reason:
          "These cups have already been claimed, or the QR code is invalid.",
        activatedCount: 0,
        requestedCount: candidateIds.length,
        alreadyClaimed,
      },
      409,
    );
  }

  // ── Bump the user's balance + lifetime counter ───────────────────────
  const { data: balanceRow } = await supabase
    .from("cup_balances")
    .select("balance, lifetime_cups")
    .eq("user_id", userId)
    .maybeSingle();

  const newBalance = (balanceRow?.balance || 0) + activatedCount;
  const newLifetime = (balanceRow?.lifetime_cups || 0) + activatedCount;

  const { error: balErr } = await supabase
    .from("cup_balances")
    .update({
      balance: newBalance,
      lifetime_cups: newLifetime,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId);
  if (balErr) {
    await recordScanEvent({
      id: scanId,
      user_id: userId,
      source: "qr",
      scan_type: scanType,
      batch_id: resolvedBatchId,
      requested_cup_ids: candidateIds,
      activated_cup_ids: activatedIds,
      cups_awarded: activatedCount,
      status: "failed",
      error_code: "balance_update_failed",
      error_message: balErr.message,
      photo_path: photoPath,
    });
    return jsonResponse(
      { error: "balance_update_failed", detail: balErr.message },
      500,
    );
  }

  // ── Activity log (one entry per batch, not per cup) ──────────────────
  const label =
    activatedCount === 1
      ? "Cup returned at Burger King"
      : `${activatedCount} cups returned at Burger King`;
  await supabase
    .from("activity_history")
    .insert({ user_id: userId, type: "cup_added", label });

  // ── Final audit row ──────────────────────────────────────────────────
  await recordScanEvent({
    id: scanId,
    user_id: userId,
    source: "qr",
    scan_type: scanType,
    batch_id: resolvedBatchId,
    requested_cup_ids: candidateIds,
    activated_cup_ids: activatedIds,
    cups_awarded: activatedCount,
    status: alreadyClaimed.length > 0 ? "partial" : "success",
    error_code: null,
    error_message: null,
    photo_path: photoPath,
  });

  return jsonResponse({
    activatedCount,
    requestedCount: candidateIds.length,
    newBalance,
    partial: activatedCount < candidateIds.length,
    alreadyClaimed,
    batchId: resolvedBatchId,
  });
});
