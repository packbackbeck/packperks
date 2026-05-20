import { supabase } from '../../lib/supabase';
import { applyOrgFilter, getActiveOrgId } from '../context/orgState';

/* ─────────────────────────────────────────────────────────────────────
 * Multi-org note (Phase 2): every query in this file that touches a
 * tenant-scoped table (users, claims, cups, cup_scans, etc.) is wrapped
 * with `applyOrgFilter()` so it returns only rows belonging to the
 * currently-active organisation. When no org is active yet (very brief
 * bootstrap window before OrgContext resolves) applyOrgFilter is a
 * no-op so we don't accidentally return empty results.
 *
 * For inserts/updates we explicitly include `org_id: getActiveOrgId()`
 * in the payload so new rows are tagged correctly.
 * ───────────────────────────────────────────────────────────────────── */

export async function getAdminStats() {
  const [usersRes, balancesRes, claimsRes, scansRes, historyRes, cupActivityRes] = await Promise.all([
    // `display_name, email, device` are needed by the Overview insights
    // panels (device breakdown pie + top-returners leaderboard) — without
    // them every user falls into the "Unknown" device bucket and the
    // leaderboard shows "Anonymous" for everyone.
    applyOrgFilter(supabase.from('users').select('id, display_name, email, device, created_at, updated_at')),
    applyOrgFilter(supabase.from('cup_balances').select('user_id, balance, lifetime_cups')),
    // reward_id is needed by the Overview "Reward Popularity" chart —
    // without it the chart filtered everything out and rendered blank.
    applyOrgFilter(supabase.from('claims').select('id, type, reward_id, cups_redeemed, payout_amount, status, created_at')),
    applyOrgFilter(supabase.from('cup_scans').select('id, status, cups_awarded, scanned_at')),
    applyOrgFilter(supabase.from('activity_history').select('id, type, created_at').order('created_at', { ascending: false }).limit(20)),
    // Fetch all cup_added events for reliable daily chart (no limit, guaranteed
    // written) and to compute the retention metric (need user_id for that).
    applyOrgFilter(supabase.from('activity_history').select('id, type, created_at, user_id').eq('type', 'cup_added')),
  ]);

  const users    = usersRes.data || [];
  const balances = balancesRes.data || [];
  const claims   = claimsRes.data || [];
  const scans    = scansRes.data || [];
  const recentActivity = historyRes.data || [];
  const cupActivity    = cupActivityRes.data || [];

  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;

  const totalUsers   = users.length;
  const activeUsers  = users.filter(u => new Date(u.updated_at).getTime() > thirtyDaysAgo).length;

  // ── Retention: % of users who came back at least once.
  // Defined as: count of distinct users who scanned/returned a cup on
  // ≥2 distinct calendar days, divided by total users who ever returned a
  // cup. Two scans on the same minute count as one return — we want true
  // come-backs, not bursts within a single session.
  const cupDaysByUser = new Map();
  for (const ev of cupActivity) {
    if (ev.type !== 'cup_added') continue;
    const day = new Date(ev.created_at).toISOString().slice(0, 10);
    if (!cupDaysByUser.has(ev.user_id)) cupDaysByUser.set(ev.user_id, new Set());
    cupDaysByUser.get(ev.user_id).add(day);
  }
  const usersWithAnyCup = cupDaysByUser.size;
  const returningUsers = Array.from(cupDaysByUser.values()).filter(d => d.size >= 2).length;
  const retentionRate = usersWithAnyCup > 0
    ? Math.round((returningUsers / usersWithAnyCup) * 100)
    : 0;

  // Reliable lifetime total: current balances + all cups ever redeemed/refunded
  const totalCupsCollected =
    balances.reduce((sum, b) => sum + (b.balance || 0), 0) +
    claims.reduce((sum, c) => sum + (c.cups_redeemed || 0), 0);

  const totalCupsRedeemed = claims
    .filter(c => c.type === 'cashback')
    .reduce((sum, c) => sum + (c.cups_redeemed || 0), 0);
  const totalCashback = claims
    .filter(c => c.status === 'completed')
    .reduce((sum, c) => sum + (c.payout_amount || 0), 0);
  const pendingClaims = claims.filter(c => c.status === 'pending').length;
  const pendingScans  = scans.filter(s => s.status === 'pending').length;
  const failedClaims  = claims.filter(c => c.status === 'failed').length;

  return {
    totalUsers,
    activeUsers,
    retentionRate,
    returningUsers,
    usersWithAnyCup,
    totalCupsCollected,
    totalCupsRedeemed,
    totalCashback,
    pendingClaims,
    pendingScans,
    failedClaims,
    recentActivity,
    rawClaims: claims,
    rawScans: scans,
    rawUsers: users,
    rawBalances: balances,
    rawCupActivity: cupActivity,  // reliable per-day cup data
  };
}

export async function getAdminUsers() {
  const { data: users, error } = await applyOrgFilter(
    supabase
      .from('users')
      .select('id, display_name, email, iban, device, selected_reward_id, created_at, updated_at')
      .order('created_at', { ascending: false })
  );

  if (error) throw error;

  const { data: balances } = await applyOrgFilter(
    supabase
      .from('cup_balances')
      .select('user_id, balance, lifetime_cups')
  );

  const balanceMap = Object.fromEntries(
    (balances || []).map(b => [b.user_id, { balance: b.balance, lifetime: b.lifetime_cups }])
  );

  return (users || []).map(u => ({
    ...u,
    cupBalance: balanceMap[u.id]?.balance || 0,
    lifetimeCups: balanceMap[u.id]?.lifetime || 0,
  }));
}

export async function getUserActivity(userId) {
  const { data, error } = await supabase
    .from('activity_history')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

export async function getUserClaims(userId) {
  const { data, error } = await supabase
    .from('claims')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

export async function adjustUserBalance(userId, newBalance) {
  const { error } = await supabase
    .from('cup_balances')
    .update({ balance: newBalance, updated_at: new Date().toISOString() })
    .eq('user_id', userId);

  if (error) throw error;
}

export async function adminUpdateUser(userId, updates) {
  const allowed = ['display_name', 'email', 'iban'];
  const filtered = Object.fromEntries(Object.entries(updates).filter(([k]) => allowed.includes(k)));
  const { error } = await supabase
    .from('users')
    .update({ ...filtered, updated_at: new Date().toISOString() })
    .eq('id', userId);
  if (error) throw error;
}

// The AI verdict columns are pulled into every admin claim view so the
// reviewer can see *why* Claude flagged the claim, alongside the existing
// status workflow.
const CLAIMS_COLS = `
  id, user_id, type, reward_id, cups_redeemed, payout_amount, iban,
  receipt_photo_url, receipt_photo_path, status, payout_status, created_at,
  ai_verdict, ai_confidence, ai_is_receipt, ai_is_burger_king,
  ai_contains_required_item, ai_failure_checks, ai_reason,
  ai_required_item, extracted_total_eur, extracted_datetime,
  extracted_receipt_id, verified_at,
  approved_by, approved_at, approval_note
`;

export async function getAdminClaims() {
  const { data, error } = await applyOrgFilter(
    supabase
      .from('claims')
      .select(CLAIMS_COLS)
      .order('created_at', { ascending: false })
  );

  if (error) throw error;

  const [{ data: users }, { data: admins }] = await Promise.all([
    applyOrgFilter(supabase.from('users').select('id, display_name, email')),
    // Pull the admin profiles referenced by approved_by so the UI can
    // show "Approved by Jasper" without an extra query per row. Admin
    // profiles are also org-scoped now.
    applyOrgFilter(supabase.from('admin_profiles').select('id, display_name, email, color, avatar_url')),
  ]);

  const userMap  = Object.fromEntries((users || []).map(u => [u.id, u]));
  const adminMap = Object.fromEntries((admins || []).map(a => [a.id, a]));

  return (data || []).map(c => ({
    ...c,
    user: userMap[c.user_id] || null,
    approver: c.approved_by ? (adminMap[c.approved_by] || null) : null,
  }));
}

/* Update a claim's status and record who decided. Returns the updated
 * row so callers can refresh their UI state. The decision audit (action
 * log row) is written by the caller via logAction so we don't tightly
 * couple this CRUD helper to the audit system. */
export async function updateClaimStatus(claimId, status, opts = {}) {
  // Backwards compat: callers may pass either a plain note string
  // (new ClaimDetailPanel modal) or an options bag (older callers).
  const note = typeof opts === 'string' ? opts : (opts?.note || '');
  const { data: { user } } = await supabase.auth.getUser();
  const update = { status };
  // Only stamp the approver when the status is a final decision; pending
  // never has an approved_by. (Re-opening a claim is rare but possible.)
  if (status === 'completed' || status === 'failed') {
    update.approved_by = user?.id ?? null;
    update.approved_at = new Date().toISOString();
    if (note) update.approval_note = note;
  } else {
    update.approved_by = null;
    update.approved_at = null;
    update.approval_note = null;
  }

  // P-02: derive payout_status from the review decision.
  //   completed cashback → 'queued' (waiting for the payout pipeline)
  //   completed direct refund → 'not_queued' (paid directly at claim time)
  //   failed / pending → 'not_queued'
  // We look up the claim's type first because the same status string
  // means a different payout direction depending on type.
  if (status === 'completed' || status === 'failed') {
    const { data: existing } = await supabase
      .from('claims')
      .select('type')
      .eq('id', claimId)
      .single();
    if (status === 'completed' && existing?.type === 'cashback') {
      update.payout_status = 'queued';
    } else {
      update.payout_status = 'not_queued';
    }
  } else {
    update.payout_status = 'not_queued';
  }

  const { data, error } = await supabase
    .from('claims')
    .update(update)
    .eq('id', claimId)
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

// Pulls every cup_scans row (QR audit log + legacy photo flow) plus the
// owning user. The legacy table uses `scanned_at` for the timestamp;
// we alias it to `created_at` client-side so the rest of the admin UI
// can stay consistent with how other tables are surfaced.
export async function getAdminCupScans() {
  const { data, error } = await applyOrgFilter(
    supabase
      .from('cup_scans')
      .select(`
        id, user_id, source, scan_type, batch_id,
        requested_cup_ids, activated_cup_ids,
        cups_awarded, status, error_code, error_message,
        photo_url, photo_path, scanned_at
      `)
      .order('scanned_at', { ascending: false })
      .limit(500)
  );

  if (error) throw error;

  const { data: users } = await applyOrgFilter(
    supabase.from('users').select('id, display_name, email')
  );

  const userMap = Object.fromEntries((users || []).map(u => [u.id, u]));

  return (data || []).map(s => ({
    ...s,
    // Alias for the React layer so all admin tables share a timestamp field.
    created_at: s.scanned_at,
    user: userMap[s.user_id] || null,
  }));
}

// Signed URL helper for the cup-scans bucket — admin table needs these
// for the thumbnail column. Mirrors getReceiptSignedUrl.
export async function getCupScanSignedUrl(photoPath, ttlSec = 600) {
  if (!photoPath) return null;
  const { data, error } = await supabase.storage
    .from('cup-scans')
    .createSignedUrl(photoPath, ttlSec);
  if (error) {
    console.error('Cup-scan sign url failed:', error);
    return null;
  }
  return data?.signedUrl ?? null;
}

export async function updateScanStatusWithNote(scanId, status, note = '') {
  const { error } = await supabase
    .from('cup_scans')
    .update({ status, rejection_note: note || null })
    .eq('id', scanId);
  if (error) throw error;
}

export async function getAdminReceiptChecks() {
  const { data, error } = await applyOrgFilter(
    supabase
      .from('claims')
      .select(CLAIMS_COLS)
      .eq('type', 'cashback')
      .order('created_at', { ascending: false })
  );

  if (error) throw error;

  const [{ data: users }, { data: admins }] = await Promise.all([
    applyOrgFilter(supabase.from('users').select('id, display_name, email')),
    applyOrgFilter(supabase.from('admin_profiles').select('id, display_name, email, color, avatar_url')),
  ]);

  const userMap  = Object.fromEntries((users || []).map(u => [u.id, u]));
  const adminMap = Object.fromEntries((admins || []).map(a => [a.id, a]));
  return (data || []).map(c => ({
    ...c,
    user: userMap[c.user_id] || null,
    approver: c.approved_by ? (adminMap[c.approved_by] || null) : null,
  }));
}

// Mint a batch of fresh cup UUIDs the admin can print on QR receipts.
// Each UUID becomes one row in the `cups` table with status='available'.
// Scanning the resulting QR (via the user app's CupScanPage) activates
// them and increments the scanner's balance.
export async function generateCups(count = 1) {
  const { data, error } = await supabase.functions.invoke('generate-cups', {
    // Multi-org: thread the active org id through so newly-minted
    // cups belong to the currently-selected organisation in the
    // dashboard. Falls back to the DB DEFAULT if the edge function
    // hasn't been redeployed yet.
    body: { count, org_id: getActiveOrgId() },
  });
  if (error) {
    let payload = null;
    try { payload = await error.context?.json?.(); } catch {}
    throw Object.assign(new Error(payload?.detail || error.message), { detail: payload });
  }
  return data; // { batch_id, cup_ids, count }
}

/* Upload a reward image to the public reward-images bucket. Returns
 * the public URL so the caller can write it back to reward.image.
 * Returns null on failure — caller falls back to whatever they had. */
export async function uploadRewardImage(file) {
  if (!file) return null;
  const ext = (file.name?.split('.').pop() || 'jpg').toLowerCase();
  const id = (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : Date.now().toString(36) + Math.random().toString(36).slice(2);
  const path = `${id}.${ext}`;
  const { error } = await supabase.storage
    .from('reward-images')
    .upload(path, file, { contentType: file.type, upsert: false });
  if (error) {
    console.error('reward image upload failed:', error);
    return null;
  }
  const { data } = supabase.storage.from('reward-images').getPublicUrl(path);
  return data?.publicUrl || null;
}

/* ─────────────────────────────────────────────────────────────────────
 * Donation transfers — admin records of money wired from PackPerks to
 * a partner charity. Customers contribute via the donate flow (claims
 * with type='direct_refund' and a donation recipient); the cash sits
 * in the programme account until an admin actually moves it. This
 * table is that audit trail.
 * ───────────────────────────────────────────────────────────────────── */

export async function getDonationTransfers() {
  const { data, error } = await applyOrgFilter(
    supabase
      .from('donation_transfers')
      .select('*')
      .order('transfer_date', { ascending: false })
      .order('created_at', { ascending: false })
  );
  if (error) throw error;
  return data || [];
}

export async function createDonationTransfer({ amount, transferDate, recipient, reference, note, receiptPath, receiptFilename }) {
  const { data: { user } } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from('donation_transfers')
    .insert({
      amount_eur: amount,
      transfer_date: transferDate,
      recipient,
      reference: reference || null,
      note: note || null,
      receipt_path: receiptPath || null,
      receipt_filename: receiptFilename || null,
      created_by: user?.id ?? null,
      org_id: getActiveOrgId(),
    })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

/* Upload a transfer receipt (image or PDF) to the private bucket.
 * Returns the storage path or null on failure (callers can still
 * record the transfer without a receipt — useful when the admin
 * doesn't have the file handy yet). */
export async function uploadDonationReceipt(file) {
  if (!file) return { path: null, filename: null };
  const ext = (file.name?.split('.').pop() || 'bin').toLowerCase();
  const id = (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : Date.now().toString(36) + Math.random().toString(36).slice(2);
  const path = `${id}.${ext}`;
  const { error } = await supabase.storage
    .from('donation-receipts')
    .upload(path, file, { contentType: file.type, upsert: false });
  if (error) {
    console.error('donation receipt upload failed:', error);
    return { path: null, filename: file.name || null };
  }
  return { path, filename: file.name || null };
}

export async function getDonationReceiptSignedUrl(path, ttlSec = 600) {
  if (!path) return null;
  const { data, error } = await supabase.storage
    .from('donation-receipts')
    .createSignedUrl(path, ttlSec);
  if (error) {
    console.error('donation receipt sign url failed:', error);
    return null;
  }
  return data?.signedUrl ?? null;
}

/* Roll up the customer-side donation total: sum of payout_amount on
 * completed claims that went to the donation recipient. We treat
 * direct_refund claims with a non-null donation marker as donations.
 *
 * For the demo we approximate via `claims.type = 'donation'` if the
 * column exists, falling back to direct_refund + reward_id is null
 * (the donation flow stores no reward_id). */
export async function getDonationCollectedTotal() {
  // Primary: claims with type='donation' (written by the client since
  // the fix that added addDonationClaim). Include any status — donations
  // are auto-completed but we don't want to miss rows if status ever
  // diverges.
  const { data: byType } = await applyOrgFilter(
    supabase
      .from('claims')
      .select('payout_amount, cups_redeemed')
      .eq('type', 'donation')
  );
  if ((byType || []).length > 0) {
    return {
      amount: byType.reduce((s, c) => s + (c.payout_amount || 0), 0),
      cups:   byType.reduce((s, c) => s + (c.cups_redeemed || 0), 0),
    };
  }

  // Fallback A: activity_history rows with type='cups_donated'. These
  // exist for every donation ever made (pre- and post-fix). Parse the
  // cup count out of the label ("Donated N cups to …") and estimate the
  // euro value at €1.00/cup — the same default refund rate.
  const { data: hist } = await applyOrgFilter(
    supabase
      .from('activity_history')
      .select('label')
      .eq('type', 'cups_donated')
  );
  const histCups = (hist || []).reduce((sum, row) => {
    const m = row.label?.match(/Donated (\d+) cup/);
    return sum + (m ? parseInt(m[1], 10) : 0);
  }, 0);
  if (histCups > 0) {
    return { amount: histCups * 1.00, cups: histCups };
  }

  // Fallback B (legacy): direct_refund + no reward_id — kept for any
  // data that predates both of the above fixes.
  const { data: fallback } = await applyOrgFilter(
    supabase
      .from('claims')
      .select('payout_amount, cups_redeemed')
      .eq('status', 'completed')
      .eq('type', 'direct_refund')
      .is('reward_id', null)
  );
  return {
    amount: (fallback || []).reduce((s, c) => s + (c.payout_amount || 0), 0),
    cups:   (fallback || []).reduce((s, c) => s + (c.cups_redeemed || 0), 0),
  };
}

/* P-21 — QR batch ops controls. Three helpers + one list query.
 *
 * `setBatchExpiry`  attaches an expires_at timestamp to every cup in
 *                   a batch. Pass null to clear (make eternal).
 * `revokeBatch`     marks a batch as revoked, with an audit reason.
 *                   The claim-cups edge function checks revoked_at
 *                   and rejects with `batch_revoked`.
 * `unrevokeBatch`   reverses an accidental revoke. Useful when the
 *                   admin clicked revoke on the wrong batch.
 * `listCupBatches`  pulls a recent-first list of batches with their
 *                   cup count, activated count, expiry, revocation. */
export async function setBatchExpiry(batchId, expiresAt) {
  const { error } = await supabase
    .from('cups')
    .update({ expires_at: expiresAt })
    .eq('batch_id', batchId);
  if (error) throw error;
}

export async function revokeBatch(batchId, reason) {
  const { error } = await supabase
    .from('cups')
    .update({ revoked_at: new Date().toISOString(), revoked_reason: reason || null })
    .eq('batch_id', batchId);
  if (error) throw error;
}

export async function unrevokeBatch(batchId) {
  const { error } = await supabase
    .from('cups')
    .update({ revoked_at: null, revoked_reason: null })
    .eq('batch_id', batchId);
  if (error) throw error;
}

export async function listCupBatches({ limit = 30 } = {}) {
  // Bring back every cup row from the most recent N batches and roll
  // them up client-side. The cups table is small enough (hundreds of
  // rows) that this is faster than a server-side aggregation query
  // for the demo. If it ever grows past ~10k cups we'd want a view.
  const { data, error } = await applyOrgFilter(
    supabase
      .from('cups')
      .select('batch_id, status, expires_at, revoked_at, revoked_reason, created_at')
      .order('created_at', { ascending: false })
      .limit(2000)
  );
  if (error) throw error;
  const byBatch = new Map();
  for (const row of (data || [])) {
    if (!row.batch_id) continue;
    let b = byBatch.get(row.batch_id);
    if (!b) {
      b = {
        batch_id: row.batch_id,
        created_at: row.created_at,
        expires_at: row.expires_at,
        revoked_at: row.revoked_at,
        revoked_reason: row.revoked_reason,
        total: 0,
        activated: 0,
      };
      byBatch.set(row.batch_id, b);
    }
    b.total += 1;
    if (row.status === 'activated') b.activated += 1;
    // Earliest created_at wins (cups in a batch share a timestamp anyway).
    if (row.created_at < b.created_at) b.created_at = row.created_at;
  }
  return Array.from(byBatch.values())
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, limit);
}

// Generate a short-lived signed URL for a private receipt photo. Admin UI
// uses this in place of the legacy receipt_photo_url (which was a public
// data-URL stored inline).
export async function getReceiptSignedUrl(photoPath, ttlSec = 600) {
  if (!photoPath) return null;
  const { data, error } = await supabase.storage
    .from('receipts')
    .createSignedUrl(photoPath, ttlSec);
  if (error) {
    console.error('Sign URL failed:', error);
    return null;
  }
  return data?.signedUrl ?? null;
}

export async function updateScanStatus(scanId, status) {
  const { error } = await supabase
    .from('cup_scans')
    .update({ status })
    .eq('id', scanId);
  if (error) throw error;
}

// ── Organization, locations, team, invitations ─────────────────────────
//
// All four are scoped to the caller's org_id via RLS policies (see the
// admin_auth migrations). We don't need to filter here — the database
// already prevents cross-org reads.

export async function getOrgBundle() {
  // The "active org" is determined by OrgContext (URL/localStorage/first).
  // We fetch that org explicitly rather than `.limit(1)` so the switcher
  // actually swaps which org's details + team load.
  const orgId = getActiveOrgId();
  const orgQuery = orgId
    ? supabase.from('organizations').select('*').eq('id', orgId).maybeSingle()
    : supabase.from('organizations').select('*').is('deleted_at', null).order('created_at').limit(1).maybeSingle();

  const [orgRes, locRes, teamRes, invRes] = await Promise.all([
    orgQuery,
    // Locations are already org-scoped by `org_id` FK — keep using it.
    orgId
      ? supabase.from('locations').select('*').eq('org_id', orgId).order('name')
      : supabase.from('locations').select('*').order('name'),
    applyOrgFilter(
      supabase.from('admin_profiles')
        .select('id, email, display_name, avatar_url, color, role, status, last_login_at, created_at, invited_by')
        .neq('status', 'deleted')
        .order('created_at')
    ),
    applyOrgFilter(
      supabase.from('admin_invitations')
        .select('*')
        .eq('status', 'pending')
        .order('invited_at', { ascending: false })
    ),
  ]);
  return {
    org: orgRes.data || null,
    locations: locRes.data || [],
    team: teamRes.data || [],
    invitations: invRes.data || [],
  };
}

/* Create a new organisation from the onboarding wizard payload.
 *
 * `payload` shape (every field optional except name + slug):
 *   {
 *     brand:    { name, slug, partner_brand_name, email_domain_hint,
 *                 brand_color, logo_url },
 *     legal:    { legal_name, kvk_number, btw_number, address,
 *                 postal_code, city, country, contact_email,
 *                 contact_phone, website },
 *     location: { name, address, postal_code, city, phone, status },
 *     economics:{ cashbackRatePerCup, refundRatePerCup, maxCupsPerScan,
 *                 maxCupsToShare },
 *     rewards:  [ { name, cupsNeeded, euros, image, description, tags } ],
 *     copy:     { heroHeadline, heroSubtext, donationRecipient,
 *                 donationDescription, privacyUrl, termsUrl, cookieUrl },
 *     features: { featureCupSharing, featureDonations,
 *                 featureDirectRefunds },
 *     invites:  [ { email, role, method } ],
 *   }
 *
 * Order of operations (all sequential, abort on first error so we
 * don't leave a half-created org):
 *   1. Insert the organisations row → capture new_org_id
 *   2. Insert the first location row (if provided)
 *   3. Upsert app_config row keyed 'published:<new_org_id>' with
 *      rewards + settings JSON
 *   4. Fire invite-admin edge fn for each invite (best-effort; failures
 *      are surfaced but don't roll back the org)
 *
 * Returns the new organisation row so the caller can immediately
 * switch into it.
 */
export async function createOrganization(payload) {
  const { data: { user } } = await supabase.auth.getUser();
  const brand   = payload.brand    || {};
  const legal   = payload.legal    || {};
  const location = payload.location || null;
  const economics = payload.economics || {};
  const wizardRewards = payload.rewards || [];
  const copy = payload.copy || {};
  const features = payload.features || {};
  const invites = payload.invites || [];

  // 1. Organisations row.
  const orgInsert = {
    name: brand.name,
    slug: brand.slug,
    partner_brand_name: brand.partner_brand_name || brand.name,
    email_domain_hint: brand.email_domain_hint || null,
    brand_color: brand.brand_color || '#FD6F46',
    logo_url: brand.logo_url || null,
    legal_name: legal.legal_name || null,
    kvk_number: legal.kvk_number || null,
    btw_number: legal.btw_number || null,
    address: legal.address || null,
    postal_code: legal.postal_code || null,
    city: legal.city || null,
    country: legal.country || null,
    contact_email: legal.contact_email || null,
    contact_phone: legal.contact_phone || null,
    website: legal.website || null,
    created_by_packperks_admin: user?.id ?? null,
  };
  const { data: orgRow, error: orgErr } = await supabase
    .from('organizations')
    .insert(orgInsert)
    .select('*')
    .single();
  if (orgErr) throw orgErr;
  const newOrgId = orgRow.id;

  // 2. First location (optional).
  if (location && location.name) {
    const { error: locErr } = await supabase.from('locations').insert({
      org_id: newOrgId,
      name: location.name,
      address: location.address || null,
      postal_code: location.postal_code || null,
      city: location.city || null,
      phone: location.phone || null,
      status: location.status || 'active',
    });
    if (locErr) console.warn('createOrganization: location insert failed', locErr);
  }

  // 3. Published config (rewards + settings) for the new org.
  const settings = {
    cashbackRatePerCup: economics.cashbackRatePerCup ?? 1.25,
    refundRatePerCup:   economics.refundRatePerCup   ?? 1.00,
    heroHeadline:       copy.heroHeadline       || 'Collect & Get Rewards',
    heroSubtext:        copy.heroSubtext        || 'Return your packaging and earn cashback.',
    donationRecipient:  copy.donationRecipient  || '',
    donationDescription: copy.donationDescription || '',
    minIbanLength:      15,
    maxCupsPerScan:     economics.maxCupsPerScan ?? 1,
    maxCupsToShare:     economics.maxCupsToShare ?? 10,
    featureCupSharing:    features.featureCupSharing    ?? true,
    featureDonations:     features.featureDonations     ?? true,
    featureDirectRefunds: features.featureDirectRefunds ?? true,
    maintenanceMode: false,
    privacyUrl: copy.privacyUrl || '',
    termsUrl:   copy.termsUrl   || '',
    cookieUrl:  copy.cookieUrl  || '',
  };
  const liveRewards = (wizardRewards || []).map((r, i) => ({
    id: r.id || `reward-${i+1}-${Date.now().toString(36)}`,
    name: r.name,
    description: r.description || '',
    image: r.image || '',
    cupsNeeded: Number(r.cupsNeeded) || 0,
    euros: Number(r.euros) || 0,
    bgColor: r.bgColor || brand.brand_color || '#FD6F46',
    tags: r.tags || [],
    displayLines: r.displayLines || [r.name],
    allergyInfo: r.allergyInfo || '',
    nutrition: r.nutrition || [],
    status: 'live',
    featured: i === 0,
    order: i,
  }));
  const { error: cfgErr } = await supabase
    .from('app_config')
    .upsert({
      key: `published:${newOrgId}`,
      value: { rewards: liveRewards, settings },
      updated_at: new Date().toISOString(),
    });
  if (cfgErr) console.warn('createOrganization: app_config upsert failed', cfgErr);

  // 4. Team invites (best-effort).
  const inviteResults = [];
  for (const inv of invites) {
    if (!inv?.email && inv?.method !== 'link') continue;
    try {
      const { data, error } = await supabase.functions.invoke('invite-admin', {
        body: {
          email: inv.email || undefined,
          role: inv.role || 'admin',
          method: inv.method || 'email',
          single_use: inv.single_use === undefined ? true : !!inv.single_use,
          org_id: newOrgId, // edge fn should respect this if it accepts it
        },
      });
      if (error) throw error;
      inviteResults.push({ ok: true, data });
    } catch (e) {
      inviteResults.push({ ok: false, error: e.message || String(e) });
    }
  }

  return { org: orgRow, inviteResults };
}

/* Soft-delete an organisation. We don't truncate any rows — claims,
 * users, cups stay attached for audit + restorability. The org just
 * stops appearing in the switcher and the user-app stops serving its
 * slug. Restore via clearOrganizationDelete(orgId). */
export async function softDeleteOrganization(orgId) {
  const { data, error } = await supabase
    .from('organizations')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', orgId)
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

export async function restoreOrganization(orgId) {
  const { data, error } = await supabase
    .from('organizations')
    .update({ deleted_at: null })
    .eq('id', orgId)
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

/* List ALL organisations including soft-deleted (for the Manage page).
 * The switcher uses OrgContext.availableOrgs which filters to active. */
export async function listAllOrganizations() {
  const { data, error } = await supabase
    .from('organizations')
    .select('*')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function updateOrg(orgId, updates) {
  const { data, error } = await supabase
    .from('organizations')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', orgId)
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

export async function upsertLocation(orgId, location) {
  const payload = { ...location, org_id: orgId };
  // Insert when no id, update when present.
  if (!payload.id) {
    const { data, error } = await supabase
      .from('locations')
      .insert(payload)
      .select('*')
      .single();
    if (error) throw error;
    return data;
  } else {
    const { id, ...rest } = payload;
    const { data, error } = await supabase
      .from('locations')
      .update(rest)
      .eq('id', id)
      .select('*')
      .single();
    if (error) throw error;
    return data;
  }
}

export async function deleteLocation(locationId) {
  const { error } = await supabase.from('locations').delete().eq('id', locationId);
  if (error) throw error;
}

export async function updateTeamMember(memberId, updates) {
  const { data, error } = await supabase
    .from('admin_profiles')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', memberId)
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

/* Fire the invite-admin edge fn. The function validates the caller role
 * server-side; we don't pre-check here to keep the UI simple.
 *
 * Accepts either the legacy 2-arg call `inviteAdmin(email, role)` or
 * the new options-bag form `inviteAdmin({ email, role, method,
 * single_use })`. Method defaults to 'email'; in 'link' mode the email
 * is optional and the edge function returns the row with the token —
 * the caller is responsible for composing the shareable URL. */
export async function inviteAdmin(emailOrOpts, roleArg) {
  const opts = typeof emailOrOpts === 'object' && emailOrOpts !== null
    ? emailOrOpts
    : { email: emailOrOpts, role: roleArg };
  const body = {
    role: opts.role,
    method: opts.method || 'email',
    single_use: opts.single_use === undefined ? true : !!opts.single_use,
  };
  if (opts.email) body.email = opts.email;
  const { data, error } = await supabase.functions.invoke('invite-admin', { body });
  if (error) {
    let payload = null;
    try { payload = await error.context?.json?.(); } catch {}
    throw Object.assign(new Error(payload?.detail || payload?.error || error.message), { detail: payload });
  }
  return data?.invitation;
}

export async function revokeInvitation(invitationId) {
  const { error } = await supabase
    .from('admin_invitations')
    .update({ status: 'revoked' })
    .eq('id', invitationId);
  if (error) throw error;
}

// ── Transactions (cup transfers between customers) ────────────────────
//
// A "transaction" is one batch of cup UUIDs that a customer shared and
// another customer claimed. We aggregate over `cups` rows where source
// = 'user_share': each shared batch corresponds to one logical transfer.
// The result has the sender, the receiver (if any), the count, and
// timestamps for both share + activation.
export async function getCupTransactions() {
  const { data: cups, error } = await applyOrgFilter(
    supabase
      .from('cups')
      .select('id, batch_id, source, status, shared_by_user_id, activated_by_user_id, activated_at, created_at')
      .eq('source', 'user_share')
      .order('created_at', { ascending: false })
      .limit(2000)
  );
  if (error) throw error;

  // Group by batch_id so the table shows one row per share, not one per cup.
  const byBatch = new Map();
  for (const row of cups || []) {
    const key = row.batch_id || row.id;
    if (!byBatch.has(key)) {
      byBatch.set(key, {
        batch_id: key,
        shared_by_user_id: row.shared_by_user_id,
        activated_by_user_id: row.activated_by_user_id,
        // Pessimistic: a batch is "pending" until every cup is claimed.
        cup_count: 0,
        claimed_count: 0,
        shared_at: row.created_at,
        claimed_at: row.activated_at,
        cup_ids: [],
      });
    }
    const t = byBatch.get(key);
    t.cup_count += 1;
    if (row.status === 'activated') t.claimed_count += 1;
    if (row.activated_at && (!t.claimed_at || row.activated_at < t.claimed_at)) {
      t.claimed_at = row.activated_at;
    }
    // Some cups in the same batch may have been claimed by different
    // users (edge case if a batch had multiple cups). Keep the first
    // activated_by we saw — fine for display purposes.
    if (!t.activated_by_user_id && row.activated_by_user_id) {
      t.activated_by_user_id = row.activated_by_user_id;
    }
    if (row.created_at < t.shared_at) t.shared_at = row.created_at;
    t.cup_ids.push(row.id);
  }

  // Hydrate sender / receiver display info from the customer users table.
  const ids = new Set();
  for (const t of byBatch.values()) {
    if (t.shared_by_user_id) ids.add(t.shared_by_user_id);
    if (t.activated_by_user_id) ids.add(t.activated_by_user_id);
  }
  const { data: users } = await applyOrgFilter(
    supabase
      .from('users')
      .select('id, display_name, email, animal_index')
      .in('id', Array.from(ids))
  );
  const userMap = Object.fromEntries((users || []).map(u => [u.id, u]));

  return Array.from(byBatch.values()).map(t => ({
    ...t,
    sender:   t.shared_by_user_id    ? userMap[t.shared_by_user_id]    || { id: t.shared_by_user_id }    : null,
    receiver: t.activated_by_user_id ? userMap[t.activated_by_user_id] || { id: t.activated_by_user_id } : null,
    status: t.claimed_count === 0 ? 'pending'
          : t.claimed_count < t.cup_count ? 'partial' : 'complete',
  }));
}

// ── Activity log ───────────────────────────────────────────────────────
// Pulls the most recent rows from admin_action_log and joins to the
// admin_profiles that authored them. Owners + admins see the whole org;
// other roles only see their own actions (enforced by RLS).
export async function getAdminActionLog(limit = 500) {
  const { data, error } = await applyOrgFilter(
    supabase
      .from('admin_action_log')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit)
  );
  if (error) throw error;

  const { data: admins } = await applyOrgFilter(
    supabase
      .from('admin_profiles')
      .select('id, email, display_name, avatar_url, color, role')
  );
  const adminMap = Object.fromEntries((admins || []).map(a => [a.id, a]));

  return (data || []).map(row => ({
    ...row,
    actor: row.actor_id ? (adminMap[row.actor_id] || null) : null,
  }));
}
