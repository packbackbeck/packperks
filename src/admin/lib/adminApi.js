import { supabase } from '../../lib/supabase';
import { applyOrgFilter, getActiveOrgId } from '../context/orgState';
import { fmtDuration } from './behaviourFormat';
import { getCopyPreset, normalizeMode } from '../../lib/copyPresets';

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

export async function getAdminStats(orgIds) {
  // orgIds (optional): explicit scope for the group-analytics toggle. When
  // omitted, applyOrgFilter falls back to the global active org (unchanged).
  const [usersRes, balancesRes, claimsRes, scansRes, historyRes, cupActivityRes] = await Promise.all([
    // `display_name, email, device` are needed by the Overview insights
    // panels (device breakdown pie + top-returners leaderboard) — without
    // them every user falls into the "Unknown" device bucket and the
    // leaderboard shows "Anonymous" for everyone.
    applyOrgFilter(supabase.from('users').select('id, display_name, email, device, created_at, updated_at'), orgIds),
    applyOrgFilter(supabase.from('cup_balances').select('user_id, balance, lifetime_cups'), orgIds),
    // reward_id is needed by the Overview "Reward Popularity" chart —
    // without it the chart filtered everything out and rendered blank.
    applyOrgFilter(supabase.from('claims').select('id, type, reward_id, cups_redeemed, payout_amount, status, created_at'), orgIds),
    applyOrgFilter(supabase.from('cup_scans').select('id, status, cups_awarded, scanned_at'), orgIds),
    applyOrgFilter(supabase.from('activity_history').select('id, type, created_at').order('created_at', { ascending: false }).limit(20), orgIds),
    // Fetch all cup_added events for reliable daily chart (no limit, guaranteed
    // written) and to compute the retention metric (need user_id for that).
    applyOrgFilter(supabase.from('activity_history').select('id, type, created_at, user_id').eq('type', 'cup_added'), orgIds),
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

/* ─────────────────────────────────────────────────────────────────────
 * Feasibility-test Stats (Titaan sandbox validation).
 *
 * Computes the 10 go/no-go metrics from the existing event log
 * (`cup_scans`, filtered to source='qr' so photo/OCR claim reviews
 * don't contaminate the QR-return funnel) plus `cups` (for org
 * consistency + generation counts) and the per-user scan grouping
 * (for "stuck" users).
 *
 * Each metric returns a normalised shape the UI can render directly:
 *   { id, label, value (0–100 | null), numerator, denominator,
 *     band: 'go'|'cond'|'nogo'|'na', lowerIsBetter, thresholds, note }
 *
 * `value === null` / band 'na' means we can't measure it from data
 * collected today — those are the Phase-2 gaps (generation-failure
 * logging + client funnel analytics), surfaced honestly rather than
 * faked.
 * ───────────────────────────────────────────────────────────────────── */

// Server-side failures that mean the system itself broke (vs. expected
// user-facing rejections like already_claimed / batch_expired which are
// the system working correctly).
const CRITICAL_ERROR_CODES = new Set([
  'db_error', 'balance_update_failed', 'survivor_update_failed',
  'merge_balance_failed', 'update_failed', 'photo_download_failed',
  'claim_update_failed', 'no_tool_use', 'anthropic_error',
]);

// Classifier for a metric value against its go / conditional / no-go bands.
function classify({ value, lowerIsBetter, go, condLow, condHigh }) {
  if (value === null || value === undefined || Number.isNaN(value)) return 'na';
  if (lowerIsBetter) {
    if (value <= go) return 'go';
    if (value <= condHigh) return 'cond';
    return 'nogo';
  }
  if (value >= go) return 'go';
  if (value >= condLow) return 'cond';
  return 'nogo';
}

const pct = (num, den) => (den > 0 ? (num / den) * 100 : null);

export async function getStatsMetrics({ fromTs = null, toTs = null, orgIds } = {}) {
  // orgIds (optional): explicit scope for the group-analytics toggle.
  // ── QR scan events for the active org, in range ────────────────────
  let scanQ = supabase
    .from('cup_scans')
    .select('id, user_id, status, error_code, error_message, cups_awarded, requested_cup_ids, activated_cup_ids, batch_id, org_id, scanned_at, source')
    .eq('source', 'qr');
  scanQ = applyOrgFilter(scanQ, orgIds);
  if (fromTs) scanQ = scanQ.gte('scanned_at', new Date(fromTs).toISOString());
  if (toTs)   scanQ = scanQ.lte('scanned_at', new Date(toTs).toISOString());
  scanQ = scanQ.order('scanned_at', { ascending: true });

  // ── Cups for this org (org-consistency + generation count) ─────────
  const cupsQ = applyOrgFilter(
    supabase.from('cups').select('id, batch_id, org_id, created_at'), orgIds
  );

  // ── system_events: QR-generation attempts (Phase 2) for metric #1 ──
  let sysQ = applyOrgFilter(
    supabase.from('system_events').select('event_type, status, count, created_at').eq('event_type', 'qr_generation'), orgIds
  );
  if (fromTs) sysQ = sysQ.gte('created_at', new Date(fromTs).toISOString());
  if (toTs)   sysQ = sysQ.lte('created_at', new Date(toTs).toISOString());

  // ── client_events: app funnel (Phase 2) for metrics #6, #9, #10 ────
  let cliQ = applyOrgFilter(
    supabase.from('client_events').select('event, session_id, user_id, created_at, props'), orgIds
  );
  if (fromTs) cliQ = cliQ.gte('created_at', new Date(fromTs).toISOString());
  if (toTs)   cliQ = cliQ.lte('created_at', new Date(toTs).toISOString());

  const [scansRes, cupsRes, sysRes, cliRes] = await Promise.all([scanQ, cupsQ, sysQ, cliQ]);
  const scans     = scansRes.data || [];
  const cups      = cupsRes.data  || [];
  const sysEvents = sysRes.data   || [];
  const cliEvents = cliRes.data   || [];

  const total = scans.length;
  const isSuccess = (s) => s.status === 'success';
  const isPartial = (s) => s.status === 'partial';
  const isFailed  = (s) => s.status === 'failed';
  const reached   = scans.filter(s => isSuccess(s) || isPartial(s)); // server activated ≥1 cup

  // Boundary of the "instrumented era": the first moment a server-side QR
  // scan row exists. Client telemetry logged before this can't possibly
  // match a server row (the pipeline wasn't recording yet), so completeness
  // (#6) and stuck-rate (#9) only count attempts from this point on — else
  // pre-logging ghosts make the system look broken when it wasn't.
  const firstServerTs = scans.length ? new Date(scans[0].scanned_at).getTime() : null;
  const serverScanIds = new Set(scans.map(s => s.id));

  // #2 QR scan success rate — exclude already_claimed duplicate re-scans
  // from the denominator. A duplicate is a benign, correctly-blocked event
  // (scored on its own "Duplicate scan handling" card); counting it as a
  // failed attempt here understates real first-scan health.
  const duplicateScans = scans.filter(s => s.error_code === 'already_claimed');
  const qrScanDenom = total - duplicateScans.length;
  const m2 = pct(reached.length, qrScanDenom);

  // #3 Correct organization page rate — a scan's batch must belong to a cup
  // of THIS org. Three outcomes:
  //   • matched   → batch is one of this org's cups (correct landing)
  //   • wrong-org → batch exists, but under a DIFFERENT org (real failure)
  //   • deleted   → batch exists nowhere (cup deleted after the scan; the
  //                 audit row remains) → not measurable, excluded from denom.
  const orgBatchIds = new Set(cups.map(c => c.batch_id).filter(Boolean));
  const scansWithBatch = scans.filter(s => s.batch_id);
  const orgMatched = scansWithBatch.filter(s => orgBatchIds.has(s.batch_id));
  const mismatchBatchIds = [...new Set(
    scansWithBatch.filter(s => !orgBatchIds.has(s.batch_id)).map(s => s.batch_id)
  )];
  // Cross-org existence check. Cups are world-readable (org scoping is done
  // in JS, not RLS), so a batch that returns rows here exists under another
  // org (genuine wrong-org). No rows → the cup was deleted (unverifiable).
  const foreignBatchIds = new Set();
  if (mismatchBatchIds.length) {
    const { data: fb } = await supabase
      .from('cups').select('batch_id').in('batch_id', mismatchBatchIds);
    for (const row of (fb || [])) foreignBatchIds.add(row.batch_id);
  }
  const orgWrong = scansWithBatch.filter(s => !orgBatchIds.has(s.batch_id) && foreignBatchIds.has(s.batch_id));
  const orgDeleted = scansWithBatch.filter(s => !orgBatchIds.has(s.batch_id) && !foreignBatchIds.has(s.batch_id));
  const orgDenom = orgMatched.length + orgWrong.length;
  const m3 = pct(orgMatched.length, orgDenom);

  // #4 Correct cup count rate — among scans that activated cups, the full
  // requested amount came through (partial = wrong/short count).
  const fullCount = reached.filter(s => {
    const req = Array.isArray(s.requested_cup_ids) ? s.requested_cup_ids.length : null;
    const act = Array.isArray(s.activated_cup_ids) ? s.activated_cup_ids.length : (s.cups_awarded || 0);
    // Success with matching counts, or no requested list to compare → trust status.
    if (req == null) return isSuccess(s);
    return isSuccess(s) && act >= req;
  });
  const m4 = pct(fullCount.length, reached.length);

  // #5 UID/event registration accuracy — scan tied to a real user row.
  const withUid = scans.filter(s => s.user_id);
  const m5 = pct(withUid.length, total);

  // #6 Dashboard data completeness — of the scan attempts the app logged
  // during the instrumented era, how many produced a matching server row
  // (joined by scan_id, which the client mints and the server reuses as the
  // cup_scans row id). This is a true 1:1 match rate, not a count ratio of
  // mismatched populations. Falls back to a field-integrity proxy only when
  // there are no instrumented attempts yet.
  const complete = scans.filter(s => s.user_id && s.status && s.scanned_at && s.org_id);
  const eraAttempts = cliEvents.filter(e =>
    e.event === 'scan_attempted' && e.props && e.props.scan_id &&
    firstServerTs != null && new Date(e.created_at).getTime() >= firstServerTs
  );
  const eraMatched = eraAttempts.filter(e => serverScanIds.has(e.props.scan_id));
  const preLogAttempts = cliEvents.filter(e =>
    e.event === 'scan_attempted' && e.props && e.props.scan_id &&
    (firstServerTs == null || new Date(e.created_at).getTime() < firstServerTs)
  ).length;
  let m6, m6Real;
  if (eraAttempts.length > 0) {
    m6 = pct(eraMatched.length, eraAttempts.length);
    m6Real = true;
  } else {
    m6 = pct(complete.length, total);
    m6Real = false;
  }

  // #7 Duplicate scan handling — real integrity check, not a hardcoded 100.
  // The guard's whole job is to never credit a cup twice, so we verify it
  // directly: count how many times each cup id appears across all scans'
  // activated lists; every cup must appear exactly once. A cup credited by
  // two scans (a leaked duplicate) drops the score below 100.
  const dupHandled = scans.filter(s => s.error_code === 'already_claimed');
  const activationCounts = new Map();
  for (const s of scans) {
    if (Array.isArray(s.activated_cup_ids)) {
      for (const cid of s.activated_cup_ids) {
        activationCounts.set(cid, (activationCounts.get(cid) || 0) + 1);
      }
    }
  }
  let totalActivations = 0;
  let doubleCredited = 0; // cups credited more than once (leaks)
  for (const n of activationCounts.values()) {
    totalActivations += n;
    if (n > 1) doubleCredited += 1;
  }
  const distinctActivated = activationCounts.size;
  const m7 = totalActivations > 0
    ? pct(distinctActivated, totalActivations)
    : (dupHandled.length > 0 ? 100 : null);

  // #8 Critical error rate (lower is better)
  const critical = scans.filter(s => s.error_code && CRITICAL_ERROR_CODES.has(s.error_code));
  const m8 = total > 0 ? (critical.length / total) * 100 : null;

  // #9 User stuck rate (lower is better).
  // "Stuck" must mean a user who TRIED and couldn't — not someone who merely
  // opened the app and browsed (app_loaded fires for every visitor, so the
  // old denominator counted curiosity opens as "stuck"). So the denominator
  // is users who actually fired a scan_attempted in the instrumented era;
  // the numerator is those who never reached a successful scan. Falls back to
  // the all-failed-scans proxy only when no instrumented attempts exist.
  const succeededUserIds = new Set(reached.filter(s => s.user_id).map(s => s.user_id));
  const attemptUserIds = new Set(
    cliEvents
      .filter(e => e.event === 'scan_attempted' && e.user_id &&
        firstServerTs != null && new Date(e.created_at).getTime() >= firstServerTs)
      .map(e => e.user_id)
  );
  let m9, m9Real, m9Num, m9Den;
  if (attemptUserIds.size > 0) {
    let stuck = 0;
    for (const uid of attemptUserIds) if (!succeededUserIds.has(uid)) stuck += 1;
    m9 = (stuck / attemptUserIds.size) * 100;
    m9Num = stuck; m9Den = attemptUserIds.size; m9Real = true;
  } else {
    const byUser = new Map();
    for (const s of scans) {
      if (!s.user_id) continue;
      if (!byUser.has(s.user_id)) byUser.set(s.user_id, []);
      byUser.get(s.user_id).push(s);
    }
    const attemptingUsers = byUser.size;
    let stuckUsers = 0;
    for (const list of byUser.values()) {
      if (!list.some(s => isSuccess(s) || isPartial(s))) stuckUsers += 1;
    }
    m9 = attemptingUsers > 0 ? (stuckUsers / attemptingUsers) * 100 : null;
    m9Num = stuckUsers; m9Den = attemptingUsers; m9Real = false;
  }
  const attemptingUsers = new Set(scans.filter(s => s.user_id).map(s => s.user_id)).size;

  // #1 QR generation success rate — from system_events (Phase 2 logging).
  const genSuccess = sysEvents.filter(e => e.status === 'success').length;
  const genFailure = sysEvents.filter(e => e.status === 'failure').length;
  const genTotal   = genSuccess + genFailure;
  const m1 = genTotal > 0 ? (genSuccess / genTotal) * 100 : null;
  const batchesGenerated = new Set(cups.map(c => c.batch_id).filter(Boolean)).size;

  // #10 Setup uptime (lower-confidence proxy): of the hours that had any
  // scan activity, the fraction with zero critical errors.
  const hourBuckets = new Map(); // hourKey -> { hasCritical }
  for (const s of scans) {
    const hourKey = new Date(s.scanned_at).toISOString().slice(0, 13);
    const b = hourBuckets.get(hourKey) || { hasCritical: false };
    if (s.error_code && CRITICAL_ERROR_CODES.has(s.error_code)) b.hasCritical = true;
    hourBuckets.set(hourKey, b);
  }
  const activeHours = hourBuckets.size;
  const cleanHours = Array.from(hourBuckets.values()).filter(b => !b.hasCritical).length;
  const m10 = activeHours > 0 ? (cleanHours / activeHours) * 100 : null;

  // ── Time series (daily) ────────────────────────────────────────────
  const dayMap = new Map();
  for (const s of scans) {
    const day = new Date(s.scanned_at).toISOString().slice(0, 10);
    const d = dayMap.get(day) || { date: day, success: 0, failed: 0, total: 0 };
    if (isSuccess(s) || isPartial(s)) d.success += 1; else if (isFailed(s)) d.failed += 1;
    d.total += 1;
    dayMap.set(day, d);
  }
  const timeSeries = Array.from(dayMap.values()).sort((a, b) => a.date.localeCompare(b.date));

  // ── Error breakdown ────────────────────────────────────────────────
  const errMap = new Map();
  for (const s of scans) {
    if (!s.error_code) continue;
    const e = errMap.get(s.error_code) || {
      code: s.error_code, count: 0, lastMessage: null, lastSeen: null,
      critical: CRITICAL_ERROR_CODES.has(s.error_code),
    };
    e.count += 1;
    if (!e.lastSeen || s.scanned_at > e.lastSeen) {
      e.lastSeen = s.scanned_at;
      e.lastMessage = s.error_message || null;
    }
    errMap.set(s.error_code, e);
  }
  const errorBreakdown = Array.from(errMap.values()).sort((a, b) => b.count - a.count);

  // ── Assemble metrics with thresholds + bands ───────────────────────
  const metrics = [
    {
      id: 'qr_gen', label: 'QR generation success rate',
      value: m1, numerator: genSuccess, denominator: genTotal,
      lowerIsBetter: false, thresholds: { go: 95, condLow: 85 },
      formula: 'Successful QR generated / total generation attempts',
      note: genTotal === 0
        ? `No QR generations logged in this range yet — logging is now live, so this fills in the next time a batch is generated. (${batchesGenerated} batch${batchesGenerated !== 1 ? 'es' : ''} exist from before logging.)`
        : `${genSuccess}/${genTotal} generation attempts succeeded.`,
    },
    {
      id: 'qr_scan', label: 'QR scan success rate',
      value: m2, numerator: reached.length, denominator: qrScanDenom,
      lowerIsBetter: false, thresholds: { go: 95, condLow: 85 },
      formula: 'Successful scans / first-scan attempts (duplicates excluded)',
      note: duplicateScans.length > 0
        ? `${duplicateScans.length} duplicate re-scan${duplicateScans.length !== 1 ? 's' : ''} (already-claimed) excluded from the denominator — scored on "Duplicate scan handling".`
        : null,
    },
    {
      id: 'correct_org', label: 'Correct organization page rate',
      value: m3, numerator: orgMatched.length, denominator: orgDenom,
      lowerIsBetter: false, thresholds: { go: 100, condLow: 95 },
      formula: "Scans on this org's page / resolvable scans (by batch)",
      note: orgDeleted.length > 0
        ? `${orgDeleted.length} scan${orgDeleted.length !== 1 ? 's' : ''} excluded — the cup was deleted after scanning, so the org can't be verified.${orgWrong.length > 0 ? ` ${orgWrong.length} genuinely hit another org.` : ' None genuinely hit another org.'}`
        : null,
    },
    {
      id: 'cup_count', label: 'Correct cup count rate',
      value: m4, numerator: fullCount.length, denominator: reached.length,
      lowerIsBetter: false, thresholds: { go: 98, condLow: 90 },
      formula: 'Correct cup amount shown / total activated scans',
    },
    {
      id: 'uid_reg', label: 'UID / event registration accuracy',
      value: m5, numerator: withUid.length, denominator: total,
      lowerIsBetter: false, thresholds: { go: 98, condLow: 90 },
      formula: 'Correct UID or session event / total scans',
    },
    {
      id: 'completeness', label: 'Dashboard data completeness',
      value: m6, numerator: m6Real ? eraMatched.length : complete.length, denominator: m6Real ? eraAttempts.length : total,
      lowerIsBetter: false, thresholds: { go: 95, condLow: 85 },
      formula: m6Real ? 'Logged scan attempts with a matching server row (by scan_id)' : 'Scan rows with all key fields / total scan rows',
      note: m6Real
        ? `${eraMatched.length}/${eraAttempts.length} instrumented scan attempts produced a server row.${preLogAttempts > 0 ? ` ${preLogAttempts} attempt${preLogAttempts !== 1 ? 's' : ''} before server logging began ${preLogAttempts !== 1 ? 'are' : 'is'} excluded (couldn't match by design).` : ''}`
        : 'Proxy: % of scan rows with all key fields. Real scan_id match rate fills in once the app logs attempts.',
    },
    {
      id: 'duplicate', label: 'Duplicate scan handling',
      value: m7, numerator: distinctActivated, denominator: totalActivations,
      lowerIsBetter: false, thresholds: { go: 100, condLow: 90 },
      formula: 'Cups credited exactly once / total cup activations',
      note: totalActivations === 0
        ? 'No cups activated in range yet.'
        : `${dupHandled.length} duplicate re-scan${dupHandled.length !== 1 ? 's' : ''} blocked; ${doubleCredited} cup${doubleCredited !== 1 ? 's' : ''} credited more than once.`,
    },
    {
      id: 'critical_err', label: 'Critical error rate',
      value: m8, numerator: critical.length, denominator: total,
      lowerIsBetter: true, thresholds: { go: 0, condHigh: 3 },
      formula: 'Critical errors / total attempts',
    },
    {
      id: 'stuck', label: 'User stuck rate',
      value: m9, numerator: m9Num, denominator: m9Den,
      lowerIsBetter: true, thresholds: { go: 5, condHigh: 10 },
      formula: m9Real ? 'Users who tried a scan but never completed one / users who tried' : 'Users whose every scan failed / users who scanned',
      note: m9Real
        ? `${m9Num} of ${m9Den} users who actually attempted a scan never completed one. Visitors who only opened the app without trying are not counted.`
        : 'Proxy: users whose every scan failed. Real attempt-based rate fills in once the app logs scan attempts.',
    },
    {
      id: 'uptime', label: 'Setup uptime',
      value: m10, numerator: cleanHours, denominator: activeHours,
      lowerIsBetter: false, thresholds: { go: 95, condLow: 85 },
      formula: 'Time setup works / total test time',
      note: 'Proxy: active hours with zero critical errors. True uptime needs health pings (Phase 2).',
    },
  ].map(m => ({
    ...m,
    band: m.band === 'na' ? 'na' : classify({
      value: m.value,
      lowerIsBetter: m.lowerIsBetter,
      go: m.thresholds.go,
      condLow: m.thresholds.condLow,
      condHigh: m.thresholds.condHigh,
    }),
  }));

  // ── Overall verdict — worst real band wins ─────────────────────────
  const realBands = metrics.filter(m => m.band !== 'na').map(m => m.band);
  let verdict = 'na';
  if (realBands.length) {
    if (realBands.includes('nogo')) verdict = 'nogo';
    else if (realBands.includes('cond')) verdict = 'cond';
    else verdict = 'go';
  }

  // ── Row-level detail for the per-card "Inspect" drill-downs ────────
  // Each metric exposes a generic { summary, labels, columns, rows } shape
  // the modal renders directly. row.state ∈ ok|bad|excluded.
  const shortId = (id) => (id ? String(id).slice(0, 8) : '—');
  const dt = (v) => (v ? new Date(v).toLocaleString('en-GB') : '—');
  const L = (ok, bad, excluded = null) => ({ ok, bad, excluded });
  const reasonForScan = (s) => {
    if (isSuccess(s)) return 'Activated cups (success)';
    if (isPartial(s)) return 'Activated some cups (partial)';
    if (s.error_code === 'already_claimed') return 'Duplicate — cup already claimed, blocked';
    if (s.error_code) return s.error_message || s.error_code;
    return 'Failed (no cups activated)';
  };
  const stuckUserRows = m9Real
    ? [...attemptUserIds].map(uid => ({ uid, ok: succeededUserIds.has(uid) }))
    : [...new Set(scans.filter(s => s.user_id).map(s => s.user_id))]
        .map(uid => ({ uid, ok: reached.some(s => s.user_id === uid) }));

  const details = {
    qr_gen: {
      summary: genTotal === 0
        ? 'No QR-generation attempts logged in this range yet, so there are no rows. This fills in once a batch is generated with logging live.'
        : `${genSuccess} of ${genTotal} generation attempts succeeded.`,
      labels: L('Success', 'Failed'),
      columns: [{ key: 'time', label: 'Logged at' }, { key: 'count', label: 'Cups' }, { key: 'status', label: 'Status' }],
      rows: sysEvents.slice().sort((a, b) => (a.created_at < b.created_at ? 1 : -1)).map((e, i) => ({
        id: `gen-${i}`, state: e.status === 'success' ? 'ok' : 'bad',
        reason: e.status === 'success' ? 'Batch generated' : 'Generation failed',
        cells: { time: dt(e.created_at), count: e.count ?? '—', status: e.status || '—' },
      })),
    },
    qr_scan: {
      summary: `${reached.length} of ${qrScanDenom} first-scan attempts activated cups. ${duplicateScans.length} duplicate re-scan(s) are excluded from the denominator (greyed) and scored on "Duplicate scan handling".`,
      labels: L('Counted', 'Failed', 'Excluded (duplicate)'),
      columns: [{ key: 'time', label: 'Scanned at' }, { key: 'cups', label: 'Cups' }, { key: 'batch', label: 'Batch' }, { key: 'status', label: 'Status' }],
      rows: scans.map(s => {
        const dup = s.error_code === 'already_claimed';
        const ok = isSuccess(s) || isPartial(s);
        return {
          id: s.id, state: dup ? 'excluded' : (ok ? 'ok' : 'bad'), reason: reasonForScan(s),
          cells: { time: dt(s.scanned_at), cups: Array.isArray(s.activated_cup_ids) ? s.activated_cup_ids.length : (s.cups_awarded || 0), batch: shortId(s.batch_id), status: s.status || '—' },
        };
      }),
    },
    correct_org: {
      summary: `${orgMatched.length} of ${orgDenom} resolvable scans map to one of this org's cups. ${orgWrong.length} hit a different org; ${orgDeleted.length} can't be verified because the cup was deleted after scanning (excluded).`,
      labels: L('Match', 'Wrong org', 'Excluded (deleted)'),
      columns: [{ key: 'time', label: 'Scanned at' }, { key: 'batch', label: 'Batch' }, { key: 'status', label: 'Status' }],
      rows: scansWithBatch.map(s => {
        const matched = orgBatchIds.has(s.batch_id);
        const foreign = !matched && foreignBatchIds.has(s.batch_id);
        return {
          id: s.id, state: matched ? 'ok' : (foreign ? 'bad' : 'excluded'),
          reason: matched ? 'Batch belongs to this org' : (foreign ? 'Batch belongs to a different org' : 'Cup deleted after scan — org unverifiable'),
          cells: { time: dt(s.scanned_at), batch: shortId(s.batch_id), status: s.status || '—' },
        };
      }),
    },
    cup_count: {
      summary: `Among ${reached.length} scans that activated cups, ${fullCount.length} delivered the full requested amount.`,
      labels: L('Full count', 'Short / partial'),
      columns: [{ key: 'time', label: 'Scanned at' }, { key: 'req', label: 'Requested' }, { key: 'act', label: 'Activated' }, { key: 'status', label: 'Status' }],
      rows: reached.map(s => {
        const req = Array.isArray(s.requested_cup_ids) ? s.requested_cup_ids.length : null;
        const act = Array.isArray(s.activated_cup_ids) ? s.activated_cup_ids.length : (s.cups_awarded || 0);
        const ok = req == null ? isSuccess(s) : (isSuccess(s) && act >= req);
        return {
          id: s.id, state: ok ? 'ok' : 'bad',
          reason: ok ? 'Requested amount delivered' : 'Fewer cups activated than requested',
          cells: { time: dt(s.scanned_at), req: req == null ? 'n/a' : req, act, status: s.status || '—' },
        };
      }),
    },
    uid_reg: {
      summary: `${withUid.length} of ${total} scans are tied to a real user row.`,
      labels: L('Has user', 'No user'),
      columns: [{ key: 'time', label: 'Scanned at' }, { key: 'user', label: 'User' }, { key: 'status', label: 'Status' }],
      rows: scans.map(s => ({
        id: s.id, state: s.user_id ? 'ok' : 'bad', reason: s.user_id ? 'Linked to a user' : 'No user_id on scan',
        cells: { time: dt(s.scanned_at), user: shortId(s.user_id), status: s.status || '—' },
      })),
    },
    completeness: m6Real
      ? {
        summary: `${eraMatched.length} of ${eraAttempts.length} scan attempts logged during the instrumented era have a matching server row (joined by scan_id). ${preLogAttempts} attempt(s) before server logging began are excluded — they can't match by design.`,
        labels: L('Matched', 'No server row'),
        columns: [{ key: 'time', label: 'Attempted at' }, { key: 'scan', label: 'Scan id' }, { key: 'matched', label: 'Server row' }],
        rows: eraAttempts.map((e, i) => {
          const matched = serverScanIds.has(e.props.scan_id);
          return {
            id: `att-${i}`, state: matched ? 'ok' : 'bad',
            reason: matched ? 'Server cup_scans row exists' : 'No server row for this attempt',
            cells: { time: dt(e.created_at), scan: shortId(e.props.scan_id), matched: matched ? 'yes' : 'missing' },
          };
        }),
      }
      : {
        summary: `Proxy (no instrumented attempts yet): ${complete.length} of ${total} scan rows have all key fields (user, status, time, org).`,
        labels: L('Complete', 'Missing fields'),
        columns: [{ key: 'time', label: 'Scanned at' }, { key: 'missing', label: 'Missing fields' }, { key: 'status', label: 'Status' }],
        rows: scans.map(s => {
          const miss = [];
          if (!s.user_id) miss.push('user');
          if (!s.status) miss.push('status');
          if (!s.scanned_at) miss.push('time');
          if (!s.org_id) miss.push('org');
          return {
            id: s.id, state: miss.length === 0 ? 'ok' : 'bad',
            reason: miss.length === 0 ? 'All key fields present' : `Missing: ${miss.join(', ')}`,
            cells: { time: dt(s.scanned_at), missing: miss.length ? miss.join(', ') : 'none', status: s.status || '—' },
          };
        }),
      },
    duplicate: {
      summary: totalActivations === 0
        ? 'No cups have been activated in this range yet.'
        : `${distinctActivated} of ${totalActivations} cup activations are unique — ${doubleCredited} cup(s) credited more than once. Separately, ${dupHandled.length} duplicate re-scan(s) were blocked (already-claimed). Rows below = each activated cup and how many scans credited it.`,
      labels: L('Credited once', 'Double-credited'),
      columns: [{ key: 'cup', label: 'Cup' }, { key: 'times', label: 'Times credited' }],
      rows: [...activationCounts.entries()].map(([cid, n], i) => ({
        id: `cup-${i}`, state: n > 1 ? 'bad' : 'ok',
        reason: n > 1 ? `Credited by ${n} scans (leak!)` : 'Credited exactly once',
        cells: { cup: shortId(cid), times: n },
      })),
    },
    critical_err: {
      summary: `${critical.length} critical system error(s) across ${total} attempts. Rows are scans that logged any error; "expected" rejections (e.g. already-claimed) are not critical.`,
      labels: L('Expected', 'Critical'),
      columns: [{ key: 'time', label: 'Scanned at' }, { key: 'code', label: 'Error code' }, { key: 'msg', label: 'Message' }],
      rows: scans.filter(s => s.error_code).map(s => ({
        id: s.id, state: CRITICAL_ERROR_CODES.has(s.error_code) ? 'bad' : 'ok',
        reason: CRITICAL_ERROR_CODES.has(s.error_code) ? 'Critical system failure' : 'Expected user-facing rejection',
        cells: { time: dt(s.scanned_at), code: s.error_code, msg: s.error_message || '—' },
      })),
    },
    stuck: {
      summary: m9Real
        ? `${m9Num} of ${m9Den} users who actually attempted a scan (in the instrumented era) never completed one. Visitors who opened the app without trying are not counted.`
        : `Proxy: ${m9Num} of ${m9Den} users who scanned never had one succeed.`,
      labels: L('Completed', 'Stuck'),
      columns: [{ key: 'user', label: 'User' }, { key: 'outcome', label: 'Outcome' }],
      rows: stuckUserRows.map((u, i) => ({
        id: `u-${i}`, state: u.ok ? 'ok' : 'bad',
        reason: u.ok ? 'Reached a successful scan' : 'Attempted but never completed',
        cells: { user: shortId(u.uid), outcome: u.ok ? 'Completed' : 'Stuck' },
      })),
    },
    uptime: {
      summary: `${cleanHours} of ${activeHours} active hour(s) had zero critical errors.`,
      labels: L('Clean', 'Had critical'),
      columns: [{ key: 'hour', label: 'Hour (UTC)' }, { key: 'result', label: 'Result' }],
      rows: [...hourBuckets.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([hour, b], i) => ({
        id: `h-${i}`, state: b.hasCritical ? 'bad' : 'ok',
        reason: b.hasCritical ? 'A critical error occurred this hour' : 'No critical errors',
        cells: { hour: hour.replace('T', ' ') + ':00', result: b.hasCritical ? 'Critical' : 'Clean' },
      })),
    },
  };

  return {
    metrics,
    verdict,
    timeSeries,
    errorBreakdown,
    details,
    totals: {
      totalScans: total,
      reached: reached.length,
      failed: scans.filter(isFailed).length,
      attemptingUsers,
      batchesGenerated,
      firstScan: scans[0]?.scanned_at || null,
      lastScan: scans[scans.length - 1]?.scanned_at || null,
    },
  };
}

/* ─────────────────────────────────────────────────────────────────────
 * User Action Stats — real behavioural percentages for the active org.
 * Every number is derived from live rows (cups / cup_scans / claims);
 * there are no placeholder/dummy values. Returns metrics with 0–100
 * values, or null when the denominator is 0 (shown as "—" / "no data").
 * ───────────────────────────────────────────────────────────────────── */
export async function getUserActionStats() {
  const cupsQ   = applyOrgFilter(supabase.from('cups').select('id, status'));
  const scansQ  = applyOrgFilter(supabase.from('cup_scans').select('user_id, status, source'));
  const claimsQ = applyOrgFilter(supabase.from('claims').select('id, type, cups_redeemed'));

  const [cupsRes, scansRes, claimsRes] = await Promise.all([cupsQ, scansQ, claimsQ]);
  const cups   = cupsRes.data   || [];
  const scans  = scansRes.data  || [];
  const claims = claimsRes.data || [];

  // 1) QR cups actually claimed vs issued. Issued = every cup minted by the
  //    QR generator for this org; claimed = cups activated by a scan.
  const cupsIssued  = cups.length;
  const cupsClaimed = cups.filter(c => c.status === 'activated').length;

  // 2) Returning scanners: of the users who ever successfully claimed a QR
  //    cup, how many did it a second time (≥2 successful QR scans).
  const successScans = scans.filter(s => s.source === 'qr' && s.status === 'success' && s.user_id);
  const scansPerUser = new Map();
  for (const s of successScans) scansPerUser.set(s.user_id, (scansPerUser.get(s.user_id) || 0) + 1);
  const usersWithAnyScan = scansPerUser.size;
  const usersWithSecond  = [...scansPerUser.values()].filter(n => n >= 2).length;

  // 3–5) Claim-type mix across ALL claims (reward + direct refund + donation).
  const totalClaims = claims.length;
  const nReward   = claims.filter(c => c.type === 'cashback').length;
  const nRefund   = claims.filter(c => c.type === 'direct_refund').length;
  const nDonation = claims.filter(c => c.type === 'donation').length;

  // 6) Cups spent on claims vs all cups users ever claimed (collected).
  const cupsUsedInClaims = claims.reduce((sum, c) => sum + (Number(c.cups_redeemed) || 0), 0);

  // ── Row-level detail for the per-card "Inspect" drill-downs ────────
  const shortId = (id) => (id ? String(id).slice(0, 8) : '—');
  const CAP = 400;
  const capNote = (n) => (n > CAP ? ` Showing the first ${CAP} of ${n}.` : '');
  const claimMixDetail = (matchType, word) => ({
    summary: `Of ${totalClaims} claim(s), ${claims.filter(c => c.type === matchType).length} chose ${word}.${capNote(claims.length)}`,
    labels: { ok: word, bad: 'Other type', excluded: null },
    columns: [{ key: 'claim', label: 'Claim' }, { key: 'type', label: 'Type' }, { key: 'cups', label: 'Cups' }],
    rows: claims.slice(0, CAP).map(c => ({
      id: c.id, state: c.type === matchType ? 'ok' : 'bad', reason: `Claim type: ${c.type || '—'}`,
      cells: { claim: shortId(c.id), type: c.type || '—', cups: c.cups_redeemed ?? '—' },
    })),
  });

  return [
    {
      id: 'qr_claimed_rate',
      label: 'QR cups claimed',
      value: pct(cupsClaimed, cupsIssued),
      numerator: cupsClaimed, denominator: cupsIssued,
      formula: 'Cups claimed (activated) ÷ cups issued by the QR generator',
      detail: {
        summary: `${cupsClaimed} of ${cupsIssued} issued cups have been claimed (activated).${capNote(cups.length)}`,
        labels: { ok: 'Claimed', bad: 'Unclaimed', excluded: null },
        columns: [{ key: 'cup', label: 'Cup' }, { key: 'status', label: 'Status' }],
        rows: cups.slice(0, CAP).map(c => ({
          id: c.id, state: c.status === 'activated' ? 'ok' : 'bad',
          reason: c.status === 'activated' ? 'Claimed by a scan' : `Status: ${c.status || '—'}`,
          cells: { cup: shortId(c.id), status: c.status || '—' },
        })),
      },
    },
    {
      id: 'returning_scanners',
      label: 'Returning scanners (2nd QR)',
      value: pct(usersWithSecond, usersWithAnyScan),
      numerator: usersWithSecond, denominator: usersWithAnyScan,
      formula: 'Users with ≥2 successful QR scans ÷ users with ≥1',
      detail: {
        summary: `${usersWithSecond} of ${usersWithAnyScan} users who claimed once came back for a second successful QR scan.`,
        labels: { ok: 'Returned', bad: 'One-time', excluded: null },
        columns: [{ key: 'user', label: 'User' }, { key: 'scans', label: 'Successful scans' }],
        rows: [...scansPerUser.entries()].map(([uid, n], i) => ({
          id: `ru-${i}`, state: n >= 2 ? 'ok' : 'bad',
          reason: n >= 2 ? `Scanned ${n} times` : 'Only one successful scan',
          cells: { user: shortId(uid), scans: n },
        })),
      },
    },
    {
      id: 'claim_mix_reward',
      label: 'Reward claims',
      value: pct(nReward, totalClaims),
      numerator: nReward, denominator: totalClaims,
      formula: 'Reward (cashback) claims ÷ all claims',
      detail: claimMixDetail('cashback', 'a reward (cashback)'),
    },
    {
      id: 'claim_mix_refund',
      label: 'Direct-refund claims',
      value: pct(nRefund, totalClaims),
      numerator: nRefund, denominator: totalClaims,
      formula: 'Direct-refund claims ÷ all claims',
      detail: claimMixDetail('direct_refund', 'a direct refund'),
    },
    {
      id: 'claim_mix_donation',
      label: 'Donation claims',
      value: pct(nDonation, totalClaims),
      numerator: nDonation, denominator: totalClaims,
      formula: 'Donation claims ÷ all claims',
      detail: claimMixDetail('donation', 'a donation'),
    },
    {
      id: 'cups_used_rate',
      label: 'Cups spent on claims',
      value: pct(cupsUsedInClaims, cupsClaimed),
      numerator: cupsUsedInClaims, denominator: cupsClaimed,
      formula: 'Cups redeemed across all claims ÷ all cups users claimed',
      detail: {
        summary: `${cupsUsedInClaims} cups were redeemed across ${claims.length} claim(s); the denominator is the ${cupsClaimed} cups users have claimed.${capNote(claims.length)}`,
        labels: { ok: 'Spent cups', bad: 'No cups', excluded: null },
        columns: [{ key: 'claim', label: 'Claim' }, { key: 'type', label: 'Type' }, { key: 'cups', label: 'Cups redeemed' }],
        rows: claims.slice(0, CAP).map(c => ({
          id: c.id, state: (Number(c.cups_redeemed) || 0) > 0 ? 'ok' : 'bad',
          reason: `Redeemed ${Number(c.cups_redeemed) || 0} cups`,
          cells: { claim: shortId(c.id), type: c.type || '—', cups: Number(c.cups_redeemed) || 0 },
        })),
      },
    },
  ];
}

/* ─────────────────────────────────────────────────────────────────────
 * User Behaviour — the behavioural funnel for the active org.
 *
 * Every measurable rate is computed from live rows (cups / cup_scans /
 * claims / users). Each rate carries the numerator and denominator (with
 * human labels) so the UI can show the raw counts the percentage came from.
 * Metrics that need client-event instrumentation we don't persist yet
 * (e.g. reward re-selection, per-button clicks, session time) are returned
 * with measurable:false and a note instead of a faked number.
 *
 * Definitions:
 *   • Receipt   = one generated cup batch (one printed QR).
 *   • Redeemed  = a generated batch that got ≥1 successful QR scan.
 *   • Cup spent = cups_redeemed on committed claims (completed + pending).
 * ───────────────────────────────────────────────────────────────────── */
function computeMetrics({ cups, scans, claims, users, ev }) {
  const ok = (s) => s.status === 'success' || s.status === 'partial';
  const successScans = scans.filter(s => s.source === 'qr' && ok(s));

  // ── Receipts (cup batches) ──
  const generatedBatches = new Set(cups.map(c => c.batch_id).filter(Boolean));
  const scannedBatches   = new Set(successScans.map(s => s.batch_id).filter(Boolean));
  const genReceipts      = generatedBatches.size;
  const redeemedReceipts = [...generatedBatches].filter(b => scannedBatches.has(b)).length;
  const ignoredReceipts  = Math.max(0, genReceipts - redeemedReceipts);

  // ── Successful scans per user (for repeat-scan funnel) ──
  const perUser = new Map();
  for (const s of successScans) {
    if (!s.user_id) continue;
    perUser.set(s.user_id, (perUser.get(s.user_id) || 0) + 1);
  }
  const usersWith2 = [...perUser.values()].filter(n => n >= 2).length;
  const usersWith3 = [...perUser.values()].filter(n => n >= 3).length;

  // ── Average time between a user's 1st and 2nd successful scan ──
  const tsByUser = new Map();
  for (const s of successScans) {
    if (!s.user_id || !s.scanned_at) continue;
    const t = new Date(s.scanned_at).getTime();
    if (!Number.isFinite(t)) continue;
    if (!tsByUser.has(s.user_id)) tsByUser.set(s.user_id, []);
    tsByUser.get(s.user_id).push(t);
  }
  let gapSum = 0, gapUsers = 0;
  for (const arr of tsByUser.values()) {
    if (arr.length >= 2) {
      arr.sort((a, b) => a - b);
      gapSum += arr[1] - arr[0];
      gapUsers += 1;
    }
  }
  const avgSecondScanMs = gapUsers > 0 ? gapSum / gapUsers : null;

  // ── Cups ──
  const totalCups     = cups.length;
  const activatedCups = cups.filter(c => c.status === 'activated').length;

  // ── Claims ──
  const totalClaims    = claims.length;
  const cashbackClaims = claims.filter(c => c.type === 'cashback').length;
  const donationClaims = claims.filter(c => c.type === 'donation').length;
  const committed      = claims.filter(c => c.status === 'completed' || c.status === 'pending');
  const cupsSpent      = committed.reduce((s, c) => s + (Number(c.cups_redeemed) || 0), 0);
  const usersWithClaim = new Set(claims.map(c => c.user_id).filter(Boolean)).size;

  // ── Users ──
  const totalUsers = users.length;
  const withEmail  = users.filter(u => u.email && String(u.email).trim()).length;

  // ── Visitor vs. user (S1) ──
  // A "visitor" only opened the app. The moment someone adds a cup, tries a
  // scan (even an already-claimed one), sets an email, picks a reward,
  // or edits/regenerates their name, they're a real user. Derived from
  // persisted state + scan rows + action events so it survives reloads.
  const scanUserIds = new Set(scans.map(s => s.user_id).filter(Boolean));
  const ENGAGE_EVENTS = new Set([
    'reward_selected', 'name_edit_opened', 'name_regenerated', 'email_saved',
    'reward_claim_attempted', 'withdraw_all_cups', 'direct_refund_opened', 'share_cup',
  ]);
  const eventEngagedIds = new Set(ev.filter(e => ENGAGE_EVENTS.has(e.event) && e.user_id).map(e => e.user_id));
  const isEngagedUser = (u) =>
    !!(u.email && String(u.email).trim()) ||
    !!u.selected_reward_id ||
    scanUserIds.has(u.id) ||
    eventEngagedIds.has(u.id);
  const engagedUsers = users.filter(isEngagedUser).length;
  const visitorUsers = Math.max(0, totalUsers - engagedUsers);

  // ── Behavioural events (client_events) ──
  const visitorSessions = new Set(ev.filter(e => e.event === 'app_loaded' && e.session_id).map(e => e.session_id)).size;

  // Reward changes: visits where the customer actively picked/switched a reward.
  const rewardChangeSessions = new Set(
    ev.filter(e => e.event === 'reward_selected' && e.session_id).map(e => e.session_id)
  ).size;

  // Session time: span between a session's first and last recorded event.
  const sessSpan = new Map();
  for (const e of ev) {
    if (!e.session_id || !e.created_at) continue;
    const t = new Date(e.created_at).getTime();
    if (!Number.isFinite(t)) continue;
    const cur = sessSpan.get(e.session_id);
    if (!cur) sessSpan.set(e.session_id, { min: t, max: t });
    else { if (t < cur.min) cur.min = t; if (t > cur.max) cur.max = t; }
  }
  let spanSum = 0, spanSessions = 0;
  for (const v of sessSpan.values()) {
    const d = v.max - v.min;
    if (d > 0) { spanSum += d; spanSessions += 1; }
  }
  const avgSessionMs = spanSessions > 0 ? spanSum / spanSessions : null;

  // Last screen per session (drop-off point).
  const lastScreen = new Map();
  for (const e of ev) {
    if (e.event !== 'screen_view' || !e.session_id) continue;
    const t = new Date(e.created_at).getTime();
    const screen = (e.props && e.props.screen) ? String(e.props.screen) : 'unknown';
    const cur = lastScreen.get(e.session_id);
    if (!cur || t >= cur.t) lastScreen.set(e.session_id, { screen, t });
  }
  const screenCounts = new Map();
  for (const { screen } of lastScreen.values()) screenCounts.set(screen, (screenCounts.get(screen) || 0) + 1);
  const screenSessions = lastScreen.size;
  let topScreen = null, topScreenCount = 0;
  for (const [s, c] of screenCounts) if (c > topScreenCount) { topScreen = s; topScreenCount = c; }

  // Button interactions, by named action.
  const ACTION_LABELS = {
    reward_selected: 'Pick reward',
    reward_claim_attempted: 'Get cashback',
    share_cup: 'Share',
    direct_refund_opened: 'Direct refund',
    withdraw_all_cups: 'Withdraw cups',
    terms_opened: 'Terms',
    add_cups_opened: 'Add more cups',
    balance_opened: 'Check balance',
    account_opened: 'Check account',
    howto_opened: 'How it works',
    name_edit_opened: 'Edit name',
    name_regenerated: 'Regenerate name',
    reward_card_opened: 'View reward',
  };
  const clickCounts = new Map();
  for (const e of ev) {
    if (e.event in ACTION_LABELS) clickCounts.set(e.event, (clickCounts.get(e.event) || 0) + 1);
  }
  let totalClicks = 0;
  for (const c of clickCounts.values()) totalClicks += c;
  // Per-button counts, highest first — the detail view charts these.
  const clickBreakdown = [...clickCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k, c]) => ({ key: k, label: ACTION_LABELS[k] || k, count: c }));

  // Entry source — where each visit came from, read from the app_loaded
  // event's entry context (captured client-side from referrer / deeplink /
  // ref / in-app UA). Events recorded before that instrumentation shipped
  // have none of these keys and are bucketed as "Untracked (pre-update)".
  const MSG_REF = /whatsapp|wa\.me|telegram|t\.me|t\.co|instagram|facebook|fb\.|messenger|twitter|x\.com|tiktok|line|snapchat|reddit|linkedin/;
  const classifyEntry = (p) => {
    if (!p || typeof p !== 'object') return 'Untracked (pre-update)';
    const tracked = ('in_app' in p) || ('deeplink' in p) || ('referrer' in p) || ('ref' in p);
    if (!tracked) return 'Untracked (pre-update)';
    const referrer = typeof p.referrer === 'string' ? p.referrer.toLowerCase() : '';
    if (p.ref === 'share') return 'Shared cups (in-app)';
    if (p.deeplink === 'batch' || p.deeplink === 'cups') return 'Cup receipt QR';
    if (referrer && MSG_REF.test(referrer)) return 'Messaging / social';
    if (p.in_app === true) return 'In-app browser';
    if (referrer) return 'Other website';
    return 'Direct / poster QR';
  };
  const entryCounts = new Map();
  for (const e of ev) {
    if (e.event !== 'app_loaded') continue;
    const label = classifyEntry(e.props);
    entryCounts.set(label, (entryCounts.get(label) || 0) + 1);
  }
  const entryBreakdown = [...entryCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k, c]) => ({ key: k, label: k, count: c }));
  const totalEntries = [...entryCounts.values()].reduce((s, n) => s + n, 0);

  // In-app browser redirect (Android): prompt shown → opened in default
  // browser vs collected here anyway vs no choice yet.
  const inappShown     = ev.filter(e => e.event === 'inapp_prompt_shown').length;
  const inappOpened    = ev.filter(e => e.event === 'open_in_default_browser').length;
  const inappCollected = ev.filter(e => e.event === 'collect_here_anyway').length;
  const inappPending   = Math.max(0, inappShown - inappOpened - inappCollected);

  // Customers who shared (a cup / their impact).
  const sharedUsers = new Set(ev.filter(e => e.event === 'share_cup' && e.user_id).map(e => e.user_id)).size;

  const pct = (n, d) => (d > 0 ? (n / d) * 100 : null);
  // Percentage metrics: value and the chartable rawValue are the same %.
  const M = (o) => {
    const value = pct(o.numerator, o.denominator);
    return { measurable: true, valueType: 'percent', ...o, value, rawValue: value };
  };

  return [
    // ── Primary ──
    M({ id: 'qr_scan_receipts', group: 'primary', label: 'QR scan rate (receipts)',
        numerator: redeemedReceipts, denominator: genReceipts,
        numLabel: 'Redeemed receipts', denLabel: 'Generated receipts',
        desc: 'Generated cup QR receipts that were actually scanned. Unscanned (ignored) receipts count in the total.' }),
    M({ id: 'second_scan', group: 'primary', label: 'Second scan rate',
        numerator: usersWith2, denominator: redeemedReceipts,
        numLabel: 'Returned to scan again', denLabel: 'Redeemed receipts',
        desc: 'People who came back and scanned a second QR receipt, out of all redeemed receipts.' }),
    (avgSecondScanMs != null
      ? { measurable: true, id: 'avg_second_scan', group: 'primary', label: 'Avg time to 2nd scan',
          valueType: 'duration', value: null, rawValue: avgSecondScanMs, valueText: fmtDuration(avgSecondScanMs),
          numerator: gapUsers, numLabel: 'Returning users measured', denominator: null, denLabel: null,
          desc: 'Average time between a customer\'s first and second cup scan.' }
      : { measurable: false, id: 'avg_second_scan', group: 'primary', label: 'Avg time to 2nd scan',
          valueType: 'duration', value: null, rawValue: null, numerator: null, denominator: null,
          desc: 'Average time between a customer\'s first and second cup scan.',
          note: 'No customer has a second scan yet, so there is nothing to average.' }),
    M({ id: 'cup_spent', group: 'primary', label: 'Cup spent rate',
        numerator: cupsSpent, denominator: activatedCups,
        numLabel: 'Cups spent', denLabel: 'Cups registered',
        desc: 'Cups spent on claims out of all cups customers actually scanned in (not just generated).' }),
    M({ id: 'rewards_claim', group: 'primary', label: 'Rewards claim rate',
        numerator: usersWithClaim, denominator: totalUsers,
        numLabel: 'Users who claimed', denLabel: 'Total users',
        desc: 'Users who made at least one claim, out of everyone who used the app.' }),
    M({ id: 'active_users', group: 'primary', label: 'Active users (not just visitors)',
        numerator: engagedUsers, denominator: totalUsers,
        numLabel: 'Active users', denLabel: 'All profiles',
        desc: 'Profiles that did something real — added a cup, tried a scan (even an already-claimed one), set an email, picked a reward, or edited their name. The rest are visitors who only opened the app (e.g. via a shared/poster link), which inflates the raw user count.' }),

    // ── Secondary ──
    M({ id: 'emails_input', group: 'secondary', label: 'Emails input rate',
        numerator: withEmail, denominator: totalUsers,
        numLabel: 'Emails collected', denLabel: 'Total users',
        desc: 'Customers who linked an email to their balance.' }),
    M({ id: 'changed_rewards', group: 'secondary', label: 'Changed rewards rate',
        numerator: rewardChangeSessions, denominator: visitorSessions,
        numLabel: 'Visits with a reward change', denLabel: 'Total visits',
        desc: 'Visits where the customer actively picked or switched their reward.' }),
    M({ id: 'qr_scan_cups', group: 'secondary', label: 'QR scan rate (cups)',
        numerator: activatedCups, denominator: totalCups,
        numLabel: 'Redeemed cups', denLabel: 'Generated cups',
        desc: 'Individual cup tokens that were scanned in, out of all generated.' }),
    M({ id: 'third_scan', group: 'secondary', label: 'Third scan rate',
        numerator: usersWith3, denominator: redeemedReceipts,
        numLabel: '3rd-time scanners', denLabel: 'Redeemed receipts',
        desc: 'Customers who scanned a third time, out of all redeemed receipts.' }),
    M({ id: 'third_scan_returning', group: 'secondary', label: 'Third scan rate (returning)',
        numerator: usersWith3, denominator: usersWith2,
        numLabel: '3rd-time scanners', denLabel: 'Returned to scan again',
        desc: 'Customers who scanned a third time, out of those who returned to scan a second time.' }),
    M({ id: 'rewards_share', group: 'secondary', label: 'Rewards claims share',
        numerator: cashbackClaims, denominator: totalClaims,
        numLabel: 'Reward (cashback) claims', denLabel: 'Total claims',
        desc: 'Share of all claims that chose a cashback reward.' }),
    M({ id: 'donation_share', group: 'secondary', label: 'Donation claims share',
        numerator: donationClaims, denominator: totalClaims,
        numLabel: 'Donation claims', denLabel: 'Total claims',
        desc: 'Share of all claims that chose to donate.' }),

    // ── Optional / derived ──
    M({ id: 'ignored_receipts', group: 'optional', label: 'Ignored receipt rate',
        numerator: ignoredReceipts, denominator: genReceipts,
        numLabel: 'Never-scanned receipts', denLabel: 'Generated receipts',
        desc: 'Generated QR receipts that were never scanned in.' }),
    (avgSessionMs != null
      ? { measurable: true, id: 'avg_session', group: 'optional', label: 'Avg session time',
          valueType: 'duration', value: null, rawValue: avgSessionMs, valueText: fmtDuration(avgSessionMs),
          numerator: spanSessions, numLabel: 'Sessions measured', denominator: null, denLabel: null,
          desc: 'Average time between a visit\'s first and last recorded action.' }
      : { measurable: false, id: 'avg_session', group: 'optional', label: 'Avg session time',
          valueType: 'duration', value: null, rawValue: null, numerator: null, denominator: null,
          desc: 'Average time a customer spends per visit.',
          note: 'No multi-action sessions recorded yet. Fills in as customers use the app.' }),
    (totalClicks > 0
      ? { measurable: true, id: 'button_clicks', group: 'optional', label: 'Button clicks',
          valueType: 'count', value: null, rawValue: totalClicks, valueText: totalClicks.toLocaleString(),
          numerator: totalClicks, numLabel: 'Tracked interactions', denominator: null, denLabel: null,
          breakdown: clickBreakdown, breakdownTitle: 'Clicks by button', breakdownNoun: 'clicks',
          desc: 'How often each key button is pressed across all visits.' }
      : { measurable: false, id: 'button_clicks', group: 'optional', label: 'Button clicks',
          valueType: 'count', value: null, rawValue: null, numerator: null, denominator: null,
          breakdown: [],
          desc: 'How often each key button is pressed across all visits.',
          note: 'No button interactions recorded yet. Fills in as customers use the app.' }),
    (totalEntries > 0
      ? { measurable: true, id: 'entry_source', group: 'optional', label: 'Entry source',
          valueType: 'count', value: null, rawValue: totalEntries, valueText: totalEntries.toLocaleString(),
          numerator: totalEntries, numLabel: 'App opens tracked', denominator: null, denLabel: null,
          breakdown: entryBreakdown, breakdownTitle: 'Visits by source', breakdownNoun: 'visits',
          desc: 'How visitors reach the app — in-app share, messaging/social, a cup receipt QR, a plain link, or direct. Captured per visit; opens before this was instrumented show as "Untracked".' }
      : { measurable: false, id: 'entry_source', group: 'optional', label: 'Entry source',
          valueType: 'count', value: null, rawValue: null, numerator: null, denominator: null,
          breakdown: [],
          desc: 'How visitors reach the app — in-app share, messaging/social, a cup receipt QR, a plain link, or direct.',
          note: 'No app-open events recorded yet. Fills in as customers open the app.' }),
    M({ id: 'visitor_rate', group: 'optional', label: 'Visitor rate',
        numerator: visitorUsers, denominator: totalUsers,
        numLabel: 'Visitors (opened only)', denLabel: 'All profiles',
        desc: 'Share of profiles that only ever opened the app and never took an action — created by a shared/poster link or an in-app browser. This is the slice of the raw user count that is not a real user.' }),
    { measurable: true, id: 'audience_split', group: 'optional', label: 'Audience split',
        valueType: 'count', value: null, rawValue: totalUsers, valueText: totalUsers.toLocaleString(),
        numerator: totalUsers, numLabel: 'Total profiles', denominator: null, denLabel: null,
        breakdown: [
          { key: 'active', label: 'Active users', count: engagedUsers },
          { key: 'visitor', label: 'Visitors', count: visitorUsers },
        ],
        breakdownTitle: 'Active users vs visitors', breakdownNoun: 'profiles',
        desc: 'Every profile split into active users (did something) vs visitors (only opened the app).' },
    (screenSessions > 0
      ? { measurable: true, id: 'last_screen', group: 'optional', label: 'Most common last screen',
          valueType: 'count', value: null, rawValue: topScreenCount, valueText: topScreen,
          numerator: topScreenCount, numLabel: `Ended on "${topScreen}"`, denominator: screenSessions, denLabel: 'Sessions tracked',
          desc: 'Where customers most often stop. Use it to spot drop-off points.' }
      : { measurable: false, id: 'last_screen', group: 'optional', label: 'Most common last screen',
          valueType: 'count', value: null, rawValue: null, numerator: null, denominator: null,
          desc: 'Where customers drop off, the last screen they reached.',
          note: 'No screen views recorded yet. Fills in as customers use the app.' }),
    M({ id: 'impact_shares', group: 'optional', label: 'Cup share rate',
        numerator: sharedUsers, denominator: totalUsers,
        numLabel: 'Users who shared', denLabel: 'Total users',
        desc: 'Customers who shared a cup or their impact with someone else.' }),
    (inappShown > 0
      ? { measurable: true, id: 'inapp_redirect', group: 'optional', label: 'In-app browser redirect',
          valueType: 'count', value: null, rawValue: inappShown, valueText: inappShown.toLocaleString(),
          numerator: inappShown, numLabel: 'Prompts shown', denominator: null, denLabel: null,
          breakdown: [
            { key: 'opened', label: 'Opened in default browser', count: inappOpened },
            { key: 'collected', label: 'Collected here anyway', count: inappCollected },
            { key: 'pending', label: 'No choice yet', count: inappPending },
          ],
          breakdownTitle: 'In-app prompt outcomes', breakdownNoun: 'prompts',
          desc: 'Android in-app browsers (Instagram/Facebook/Telegram, …) that opened a cup deeplink. We prompt them to open in their default browser so the cup sticks to their real account; this shows what they chose.' }
      : { measurable: false, id: 'inapp_redirect', group: 'optional', label: 'In-app browser redirect',
          valueType: 'count', value: null, rawValue: null, numerator: null, denominator: null,
          breakdown: [],
          desc: 'Android in-app browsers that opened a cup deeplink, and whether they moved to their default browser to claim.',
          note: 'No in-app browser prompts recorded yet. Fills in as Android in-app opens hit a cup link.' }),
  ];
}

/* Which timestamp column places each table's rows in time. */
const BEHAVIOUR_TS = {
  cups:   r => r.created_at,
  scans:  r => r.scanned_at,
  claims: r => r.created_at,
  users:  r => r.created_at,
  ev:     r => r.created_at,
};

const toMsOrNull = (v) => {
  const t = v ? new Date(v).getTime() : NaN;
  return Number.isFinite(t) ? t : null;
};

function bucketLabel(ms) {
  return new Date(ms).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

/* ~16 evenly-spaced (day-aligned) cumulative checkpoints across the window
 * so every metric's series tells a "how did this build up" story. */
function makeBuckets(fromMs, toMs) {
  if (!(toMs > fromMs)) return [{ endMs: toMs, label: bucketLabel(toMs) }];
  const dayMs = 86400000;
  const days = (toMs - fromMs) / dayMs;
  const TARGET = 16;
  const stepDays = Math.max(1, Math.ceil(days / TARGET));
  const out = [];
  for (let d = stepDays; d < days; d += stepDays) {
    const endMs = fromMs + d * dayMs;
    out.push({ endMs, label: bucketLabel(endMs) });
  }
  out.push({ endMs: toMs, label: bucketLabel(toMs) });
  return out;
}

/* One cumulative checkpoint per day across the window (stepping coarser if
 * the span is enormous, so we never run thousands of recomputes). Used by
 * the day-by-day history export. */
function makeDailyBuckets(fromMs, toMs) {
  if (!(toMs > fromMs)) return [{ endMs: toMs, label: bucketLabel(toMs) }];
  const dayMs = 86400000;
  const days = Math.floor((toMs - fromMs) / dayMs);
  const CAP = 400;
  const stepDays = days > CAP ? Math.ceil(days / CAP) : 1;
  const out = [];
  for (let d = 1; d <= days; d += stepDays) {
    const endMs = fromMs + d * dayMs;
    out.push({ endMs, label: bucketLabel(endMs) });
  }
  if (!out.length || out[out.length - 1].endMs !== toMs) {
    out.push({ endMs: toMs, label: bucketLabel(toMs) });
  }
  return out;
}

/* Load every behaviour-relevant table for the active org (or an explicit
 * group scope via orgIds), once. */
async function fetchBehaviourRows(orgIds) {
  const [cupsRes, scansRes, claimsRes, usersRes, cliRes] = await Promise.all([
    applyOrgFilter(supabase.from('cups').select('id, batch_id, status, source, created_at'), orgIds),
    applyOrgFilter(supabase.from('cup_scans').select('id, user_id, status, batch_id, source, cups_awarded, scanned_at'), orgIds),
    applyOrgFilter(supabase.from('claims').select('id, user_id, type, status, cups_redeemed, created_at'), orgIds),
    applyOrgFilter(supabase.from('users').select('id, email, selected_reward_id, created_at'), orgIds),
    applyOrgFilter(supabase.from('client_events').select('event, session_id, user_id, created_at, props'), orgIds),
  ]);
  return {
    cups:   cupsRes.data   || [],
    scans:  scansRes.data  || [],
    claims: claimsRes.data || [],
    users:  usersRes.data  || [],
    ev:     cliRes.data     || [],
  };
}

/* Data extent + the effective [effFrom, effTo] window for a requested range
 * (range null/blank → the full data extent). */
function behaviourWindow(allRows, range) {
  let minMs = Infinity, maxMs = -Infinity;
  for (const key of Object.keys(allRows)) {
    for (const r of allRows[key]) {
      const t = toMsOrNull(BEHAVIOUR_TS[key](r));
      if (t == null) continue;
      if (t < minMs) minMs = t;
      if (t > maxMs) maxMs = t;
    }
  }
  const hasData = minMs !== Infinity;
  const minDate = hasData ? minMs : Date.now();
  const maxDate = hasData ? maxMs : Date.now();
  const reqFrom = range && range.from ? toMsOrNull(range.from) : null;
  const reqTo   = range && range.to   ? toMsOrNull(range.to)   : null;
  return {
    minDate, maxDate, hasData,
    effFrom: reqFrom != null ? reqFrom : minDate,
    effTo:   reqTo   != null ? reqTo   : maxDate,
  };
}

/* Filter every table to [fromMs, toMs] by its own timestamp column. */
function sliceBehaviourRows(allRows, fromMs, toMs) {
  const out = {};
  for (const key of Object.keys(allRows)) {
    out[key] = allRows[key].filter(r => {
      const t = toMsOrNull(BEHAVIOUR_TS[key](r));
      return t != null && t >= fromMs && t <= toMs;
    });
  }
  return out;
}

/* ─────────────────────────────────────────────────────────────────────
 * getUserBehaviourStats — behavioural metrics for the active org,
 * optionally scoped to a time window, each carrying a cumulative series.
 *
 * @param range  { from, to } ISO strings, or null/omitted for all-time.
 * Returns { metrics, meta }. metrics each gain a `series` of { t, label, v }
 * points and a numeric `rawValue` / `valueType` for charting. meta carries
 * the applied window plus the data's true min/max dates so the UI can build
 * a date picker and default it to the full period.
 * ───────────────────────────────────────────────────────────────────── */
export async function getUserBehaviourStats(range = null, orgIds) {
  const allRows = await fetchBehaviourRows(orgIds);
  const { minDate, maxDate, hasData, effFrom, effTo } = behaviourWindow(allRows, range);

  // Current metrics over the selected window.
  const metrics = computeMetrics(sliceBehaviourRows(allRows, effFrom, effTo));

  // Cumulative series: recompute the full metric set at each checkpoint so
  // even derived metrics (e.g. "returned to scan again") stay correct.
  const buckets = makeBuckets(effFrom, effTo);
  const seriesById = new Map(metrics.map(m => [m.id, []]));
  for (const b of buckets) {
    const bm = computeMetrics(sliceBehaviourRows(allRows, effFrom, b.endMs));
    for (const m of bm) {
      const arr = seriesById.get(m.id);
      if (arr) arr.push({ t: b.endMs, label: b.label, v: m.rawValue == null ? null : m.rawValue });
    }
  }
  for (const m of metrics) m.series = seriesById.get(m.id) || [];

  return {
    metrics,
    meta: {
      from: new Date(effFrom).toISOString(),
      to: new Date(effTo).toISOString(),
      minDate: new Date(minDate).toISOString(),
      maxDate: new Date(maxDate).toISOString(),
      hasData,
    },
  };
}

/* ─────────────────────────────────────────────────────────────────────
 * getUserBehaviourDailyHistory — the same metrics, but as a day-by-day
 * cumulative table for spreadsheet export. Each metric's value is computed
 * from the window start up to the end of every day in the window. Returns
 * aligned dates + each metric's value array (null where there's no data
 * for that day yet).
 * ───────────────────────────────────────────────────────────────────── */
export async function getUserBehaviourDailyHistory(range = null, orgIds) {
  const allRows = await fetchBehaviourRows(orgIds);
  const { effFrom, effTo, hasData } = behaviourWindow(allRows, range);

  // Metric identity/order/units come from one full-window pass.
  const base = computeMetrics(sliceBehaviourRows(allRows, effFrom, effTo));
  const meta = base.map(m => ({ id: m.id, label: m.label, group: m.group, valueType: m.valueType }));
  const valuesById = new Map(meta.map(m => [m.id, []]));

  const buckets = makeDailyBuckets(effFrom, effTo);
  for (const b of buckets) {
    const byId = new Map(computeMetrics(sliceBehaviourRows(allRows, effFrom, b.endMs)).map(m => [m.id, m.rawValue]));
    for (const m of meta) {
      const v = byId.has(m.id) ? byId.get(m.id) : null;
      valuesById.get(m.id).push(v == null ? null : v);
    }
  }

  return {
    hasData,
    dates: buckets.map(b => ({ label: b.label, iso: new Date(b.endMs).toISOString() })),
    metrics: meta.map(m => ({ ...m, values: valuesById.get(m.id) })),
  };
}

/* ─────────────────────────────────────────────────────────────────────
 * Rewards Receipt Generator (feasibility test).
 *
 * createGeneratedReceipt mints a unique PackPerks token, persists the
 * receipt's items/date to `generated_receipts`, and returns the row. The
 * token is printed on the generated image; verify-receipt reads it back
 * and auto-accepts the receipt when it matches a row for the same org.
 * ───────────────────────────────────────────────────────────────────── */
function makeReceiptToken() {
  const a = new Uint8Array(4);
  (globalThis.crypto || crypto).getRandomValues(a);
  return 'PPK-' + Array.from(a).map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}

export async function createGeneratedReceipt({ items, total, receiptDate, venue }) {
  const orgId = getActiveOrgId();
  const token = makeReceiptToken();
  const { data, error } = await supabase
    .from('generated_receipts')
    .insert({
      org_id: orgId,
      token,
      items: items || [],
      total: total ?? null,
      receipt_date: receiptDate || null,
      venue: venue || null,
    })
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return data;
}

/* DANGER: permanently delete this org's activity records (cup scans,
 * claims, cup/donation transfers). Server-side RPC is admin-gated and
 * scoped strictly to the passed org_id. Returns per-table delete counts.
 * Pass the org explicitly so we never accidentally purge "all orgs". */
export async function purgeOrgRecords(orgId = getActiveOrgId()) {
  if (!orgId) throw new Error('No active organization selected.');
  const { data, error } = await supabase.rpc('admin_purge_org_records', { p_org_id: orgId });
  if (error) throw new Error(error.message);
  return data; // { cup_scans, claims, cup_transfers }
}

/* DANGER: permanently delete the selected rows by id. Admin-gated +
 * table-whitelisted server-side. `table` must be one of:
 * 'users' | 'claims' | 'cup_scans' | 'donation_transfers'.
 * Deleting users also clears their activity history + claims. */
export async function deleteRecords(table, ids) {
  const list = (ids || []).filter(Boolean);
  if (list.length === 0) return { deleted: 0 };
  const { data, error } = await supabase.rpc('admin_delete_records', { p_table: table, p_ids: list });
  if (error) throw new Error(error.message);
  return data; // { deleted }
}

export async function listGeneratedReceipts({ limit = 30 } = {}) {
  const { data, error } = await applyOrgFilter(
    supabase
      .from('generated_receipts')
      .select('id, token, items, total, receipt_date, venue, created_at')
      .order('created_at', { ascending: false })
      .limit(limit),
  );
  if (error) throw new Error(error.message);
  return data || [];
}

export async function getAdminUsers() {
  const { data: users, error } = await applyOrgFilter(
    supabase
      .from('users')
      .select('id, display_name, email, device, selected_reward_id, marketing_consent, marketing_consent_at, created_at, updated_at')
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

  // Anyone who ever attempted a scan (even a failed / already-claimed one)
  // counts as a real user — same engagement rule as the behaviour metrics.
  const { data: scanRows } = await applyOrgFilter(
    supabase.from('cup_scans').select('user_id')
  );
  const scanUserIds = new Set((scanRows || []).map(s => s.user_id).filter(Boolean));

  return (users || []).map(u => {
    const cupBalance = balanceMap[u.id]?.balance || 0;
    const lifetimeCups = balanceMap[u.id]?.lifetime || 0;
    // Visitor = only opened the app; becomes a user on any real action
    // (a cup, a scan attempt, an email, or an explicit reward pick).
    const isVisitor = !(
      lifetimeCups > 0 || cupBalance > 0 ||
      (u.email && String(u.email).trim()) ||
      u.selected_reward_id ||
      scanUserIds.has(u.id)
    );
    return { ...u, cupBalance, lifetimeCups, isVisitor };
  });
}

export async function getUserActivity(userId) {
  const { data, error } = await applyOrgFilter(
    supabase
      .from('activity_history')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
  );

  if (error) throw error;
  return data || [];
}

export async function getUserClaims(userId) {
  const { data, error } = await applyOrgFilter(
    supabase
      .from('claims')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
  );

  if (error) throw error;
  return data || [];
}

export async function adjustUserBalance(userId, newBalance) {
  const { error } = await applyOrgFilter(
    supabase
      .from('cup_balances')
      .update({ balance: newBalance, updated_at: new Date().toISOString() })
      .eq('user_id', userId)
  );

  if (error) throw error;
}

/* Merge multiple PackPerks user accounts into one (admin tool).
 * Sums every cup balance + lifetime, repoints history/claims/scans/cups
 * onto the survivor, and keeps the most-recent non-empty profile values
 * (display_name, email, …). Soft-marks absorbed rows with
 * merged_into so they can't be hit by anonymous reads any more. Audited
 * server-side. Returns { status:'merged', survivor_id, absorbed_ids,
 * merged_balance, merged_lifetime, profile_update, repoint_errors }. */
export async function mergeUsers(survivorId, absorbedIds) {
  const { data, error } = await supabase.functions.invoke('admin-merge-users', {
    body: { survivor_id: survivorId, absorbed_ids: absorbedIds },
  });
  if (error) {
    let payload = null;
    try { payload = await error.context?.json?.(); } catch { /* ignore */ }
    throw Object.assign(new Error(payload?.detail || payload?.error || error.message), { detail: payload });
  }
  return data;
}

export async function adminUpdateUser(userId, updates) {
  const allowed = ['display_name', 'email', 'marketing_consent'];
  const filtered = Object.fromEntries(Object.entries(updates).filter(([k]) => allowed.includes(k)));
  // Stamp consent proof whenever an admin changes the marketing flag.
  if ('marketing_consent' in filtered) {
    filtered.marketing_consent = !!filtered.marketing_consent;
    filtered.marketing_consent_at = new Date().toISOString();
    filtered.marketing_consent_source = 'admin';
  }
  const { error } = await applyOrgFilter(
    supabase
      .from('users')
      .update({ ...filtered, updated_at: new Date().toISOString() })
      .eq('id', userId)
  );
  if (error) throw error;
}

// The AI verdict columns are pulled into every admin claim view so the
// reviewer can see *why* Claude flagged the claim, alongside the existing
// status workflow.
const CLAIMS_COLS = `
  id, user_id, type, reward_id, cups_redeemed, payout_amount,
  tikkie_url, tikkie_status, tikkie_cashback_id, tikkie_expires_at, tikkie_redeemed_at,
  tikkie_last_error, tikkie_last_error_at,
  notify_email, notify_push, notified_at, flagged,
  receipt_photo_url, receipt_photo_path, status, payout_status, created_at,
  ai_verdict, ai_confidence, ai_is_receipt, ai_is_burger_king,
  ai_contains_required_item, ai_failure_checks, ai_reason,
  ai_required_item, extracted_total_eur, extracted_datetime,
  extracted_receipt_id, verified_at,
  approved_by, approved_at, approval_note,
  image_hidden, image_hidden_reason, image_hidden_at, image_hidden_by
`;

export async function getAdminClaims() {
  const { data, error } = await applyOrgFilter(
    supabase
      .from('claims')
      .select(CLAIMS_COLS)
      .order('created_at', { ascending: false })
  );

  if (error) throw error;

  // Resolve names by the ids the claims actually reference — NOT via an
  // org filter. A claim already belongs to the active org (filtered above);
  // its customer/approver must always resolve by id even if that user row
  // is cross-org or (legacy) org-less, otherwise the row shows "Unknown".
  const userIds  = [...new Set((data || []).map(c => c.user_id).filter(Boolean))];
  const adminIds = [...new Set((data || []).map(c => c.approved_by).filter(Boolean))];
  const [{ data: users }, { data: admins }] = await Promise.all([
    userIds.length
      ? supabase.from('users').select('id, display_name, email').in('id', userIds)
      : Promise.resolve({ data: [] }),
    adminIds.length
      ? supabase.from('admin_profiles').select('id, display_name, email, color, avatar_url').in('id', adminIds)
      : Promise.resolve({ data: [] }),
  ]);

  const userMap  = Object.fromEntries((users || []).map(u => [u.id, u]));
  const adminMap = Object.fromEntries((admins || []).map(a => [a.id, a]));

  return (data || []).map(c => ({
    ...c,
    user: userMap[c.user_id] || null,
    approver: c.approved_by ? (adminMap[c.approved_by] || null) : null,
  }));
}

/* Invoke an edge function and NORMALISE its result: on an HTTP error the
 * Supabase client throws away the JSON body onto error.context — we recover it
 * so callers always get the function's `{ error, ... }` payload instead of an
 * opaque "non-2xx" message. Returns the parsed body (which may contain `error`). */
async function invokeEdge(name, body) {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (!error) return data;
  try {
    const parsed = await error.context.json();
    if (parsed && typeof parsed === 'object') return parsed;
  } catch { /* fall through */ }
  return { error: error.message || 'invoke_failed' };
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

  // Look up the claim's type + whether a Tikkie cashback was already minted,
  // to decide the payout direction and whether to mint a link on approve.
  let claimType = null;
  let alreadyMinted = false;
  if (status === 'completed' || status === 'failed') {
    const { data: existing } = await applyOrgFilter(
      supabase
        .from('claims')
        .select('type, tikkie_cashback_id')
        .eq('id', claimId)
    ).maybeSingle();
    claimType = existing?.type ?? null;
    alreadyMinted = !!existing?.tikkie_cashback_id;
  }
  const payViaTikkie =
    status === 'completed' && (claimType === 'cashback' || claimType === 'direct_refund');

  // P-02: derive payout_status from the review decision.
  //   approved cashback/refund → 'queued' until the Tikkie link is minted, then
  //     the edge function flips it to 'sent' with the real url/id/status/expiry.
  //   failed / pending / other → 'not_queued'.
  if (payViaTikkie) {
    update.payout_status = alreadyMinted ? 'sent' : 'queued';
  } else {
    update.payout_status = 'not_queued';
  }

  const { data, error } = await applyOrgFilter(
    supabase
      .from('claims')
      .update(update)
      .eq('id', claimId)
      .select('*')
  ).maybeSingle();
  if (error) throw error;

  // Mint the REAL Tikkie cashback for a freshly approved cashback/refund. The
  // edge function is the sole holder of the Tikkie secrets; it POSTs a cashback
  // and writes the real tikkie_url/id/status/expiry back onto the claim. It is
  // idempotent (returns the existing link if one was already minted).
  if (payViaTikkie && !alreadyMinted) {
    try {
      const mint = await invokeEdge('tikkie-cashback', { action: 'create', claim_id: claimId });
      if (mint?.error) {
        // Approval stands; the payout link can be retried from the claim panel.
        return { ...data, tikkie_error: mint };
      }
      return {
        ...data,
        tikkie_url: mint?.url ?? data.tikkie_url,
        tikkie_cashback_id: mint?.cashbackId ?? data.tikkie_cashback_id,
        tikkie_status: mint?.tikkie_status ?? data.tikkie_status ?? 'created',
        tikkie_expires_at: mint?.expiryDateTime ?? data.tikkie_expires_at,
        payout_status: 'sent',
      };
    } catch (e) {
      return { ...data, tikkie_error: { error: 'tikkie_invoke_failed', detail: e?.message || String(e) } };
    }
  }

  return data;
}

/* Re-fetch a claim's live Tikkie cashback status (CREATED|REDEEMED|EXPIRED)
 * from the Tikkie API and sync it onto the claim. Used by the Tikkie-status
 * timeline modal's "Refresh" action. Returns { tikkie_status, ... } or { error }. */
export async function refreshTikkieStatus(claimId) {
  return invokeEdge('tikkie-cashback', { action: 'status', claim_id: claimId });
}

/* Re-mint a Tikkie cashback link for an already-approved claim whose earlier
 * mint failed (e.g. the campaign was momentarily out of funds). Idempotent. */
export async function mintTikkieLink(claimId) {
  return invokeEdge('tikkie-cashback', { action: 'create', claim_id: claimId });
}

/* Cashback campaign funds/status for the admin dashboard. Returns
 * { campaign: { remainingAmountInCents, status, ... } } or { error }. */
export async function getTikkieCampaign() {
  return invokeEdge('tikkie-cashback', { action: 'campaign' });
}

/* Toggle the admin "flag/mark" on a claim — highlights the row in the list so
 * a reviewer can set it aside for a second look. Returns the updated row. */
export async function markClaim(claimId, flagged) {
  const { data, error } = await applyOrgFilter(
    supabase.from('claims').update({ flagged: !!flagged }).eq('id', claimId).select('*')
  ).maybeSingle();
  if (error) throw error;
  return data;
}

/* Hide the receipt image attached to a claim from all admin reviewers.
 * The user-side `receipts/` storage object is left untouched — the
 * user keeps seeing their own upload in their own UI. This only
 * suppresses the image in the admin claims table + detail panel,
 * replacing it with a neutral "hidden" placeholder.
 *
 * Use cases:
 *   • PII the AI didn't catch (handwritten card numbers, IDs in frame)
 *   • Borderline content the AI moderator let through
 *   • Anything else a senior admin decides shouldn't be reviewable
 *
 * The companion `unhideClaimImage` reverses the hide (e.g. after the
 * issue is resolved or it was hidden in error). Both write the audit
 * trail via the calling component's logAction() invocation — we don't
 * couple this CRUD helper to actionLog so tests can mock cleanly. */
export async function hideClaimImage(claimId, reason) {
  const { data: { user } } = await supabase.auth.getUser();
  const { data, error } = await applyOrgFilter(
    supabase
      .from('claims')
      .update({
        image_hidden: true,
        image_hidden_reason: reason ? `admin: ${reason}` : 'admin: no reason given',
        image_hidden_at: new Date().toISOString(),
        image_hidden_by: user?.id ?? null,
      })
      .eq('id', claimId)
      .select(CLAIMS_COLS)
  ).maybeSingle();
  if (error) throw error;
  return data;
}

export async function unhideClaimImage(claimId) {
  const { data, error } = await applyOrgFilter(
    supabase
      .from('claims')
      .update({
        image_hidden: false,
        image_hidden_reason: null,
        image_hidden_at: null,
        image_hidden_by: null,
      })
      .eq('id', claimId)
      .select(CLAIMS_COLS)
  ).maybeSingle();
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
  const { error } = await applyOrgFilter(
    supabase
      .from('cup_scans')
      .update({ status, rejection_note: note || null })
      .eq('id', scanId)
  );
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

/* ─────────────────────────────────────────────────────────────────────
 * Reward budget caps (per org, admin-only).
 *
 * Caps the total cashback an org will pay out. Spend is "committed" cashback:
 * claims of type 'cashback' with status completed or pending. The cap and the
 * spend live only here and in an admin-only table; the customer app only ever
 * receives a yes/no "is claiming paused" boolean.
 * ───────────────────────────────────────────────────────────────────── */
export async function getRewardBudget(orgId) {
  const oid = orgId || getActiveOrgId();
  if (!oid) return { cap: 200, enabled: false, spent: 0, exists: false };
  const [budgetRes, claimsRes] = await Promise.all([
    supabase.from('org_reward_budgets').select('cap_eur, enabled').eq('org_id', oid).maybeSingle(),
    supabase.from('claims').select('payout_amount, type, status').eq('org_id', oid),
  ]);
  const budget = budgetRes.data;
  const spent = (claimsRes.data || [])
    .filter(c => c.type === 'cashback' && (c.status === 'completed' || c.status === 'pending'))
    .reduce((s, c) => s + (Number(c.payout_amount) || 0), 0);
  return {
    cap: budget ? Number(budget.cap_eur) : 200,
    enabled: budget ? !!budget.enabled : true,
    spent,
    exists: !!budget,
  };
}

export async function saveRewardBudget(orgId, { cap, enabled }) {
  const oid = orgId || getActiveOrgId();
  if (!oid) throw new Error('no_active_org');
  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase
    .from('org_reward_budgets')
    .upsert({
      org_id: oid,
      cap_eur: Math.max(0, Number(cap) || 0),
      enabled: !!enabled,
      updated_at: new Date().toISOString(),
      updated_by: user?.id ?? null,
    });
  if (error) throw error;
  return true;
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
  const { error } = await applyOrgFilter(
    supabase
      .from('cups')
      .update({ expires_at: expiresAt })
      .eq('batch_id', batchId)
  );
  if (error) throw error;
}

export async function revokeBatch(batchId, reason) {
  const { error } = await applyOrgFilter(
    supabase
      .from('cups')
      .update({ revoked_at: new Date().toISOString(), revoked_reason: reason || null })
      .eq('batch_id', batchId)
  );
  if (error) throw error;
}

export async function unrevokeBatch(batchId) {
  const { error } = await applyOrgFilter(
    supabase
      .from('cups')
      .update({ revoked_at: null, revoked_reason: null })
      .eq('batch_id', batchId)
  );
  if (error) throw error;
}

/* DANGER: permanently delete whole QR cup batches from the server. Removes
 * the batch's cup rows — the batch disappears from Recent batches and the
 * QR can no longer be claimed (effectively revoked). Admin-gated server-side. */
export async function deleteCupBatches(batchIds) {
  const list = (batchIds || []).filter(Boolean);
  if (list.length === 0) return { deleted_cups: 0, batches: 0 };
  const { data, error } = await supabase.rpc('admin_delete_cup_batches', { p_batch_ids: list });
  if (error) throw new Error(error.message);
  return data; // { deleted_cups, batches }
}

export async function listCupBatches() {
  // Server-side aggregation (admin_list_cup_batches) returns EVERY batch
  // for the active org as one row each — no client-side cup-row fetch, so
  // older batches are never dropped by PostgREST's row cap. The caller
  // paginates the full list client-side.
  const { data, error } = await supabase.rpc('admin_list_cup_batches', {
    p_org_id: getActiveOrgId(),
  });
  if (error) throw error;
  return (data || []).map(b => ({
    batch_id: b.batch_id,
    created_at: b.created_at,
    expires_at: b.expires_at,
    revoked_at: b.revoked_at,
    revoked_reason: b.revoked_reason,
    total: Number(b.total) || 0,
    activated: Number(b.activated) || 0,
  }));
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
  const { error } = await applyOrgFilter(
    supabase
      .from('cup_scans')
      .update({ status })
      .eq('id', scanId)
  );
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
    maxCupsPerScan:     economics.maxCupsPerScan ?? 1,
    maxCupsToShare:     economics.maxCupsToShare ?? 10,
    featureCupSharing:    features.featureCupSharing    ?? false,
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

/* ─────────────────────────────────────────────────────────────────────
 * Duplicate an organisation.
 *
 * Clones the CONFIG of an existing org into a brand-new one: brand + legal
 * fields, published app_config (rewards, settings, copy, dashboard blocks),
 * the reward-budget cap, and locations. It deliberately does NOT copy any
 * tenant data — users, cup scans, cup transfers, claims, cups, or balances —
 * so the new org starts with completely clean stats.
 *
 * The new org gets a unique "<slug>-copy" slug and a "<name> (Copy)" name.
 * Returns the new organisation row.
 * ───────────────────────────────────────────────────────────────────── */
export async function duplicateOrganization(srcOrgId) {
  if (!srcOrgId) throw new Error('no_source_org');
  const { data: { user } } = await supabase.auth.getUser();

  // 1. Read the source org.
  const { data: src, error: srcErr } = await supabase
    .from('organizations').select('*').eq('id', srcOrgId).single();
  if (srcErr) throw srcErr;

  // 2. Pick a free slug ("<slug>-copy", then "-copy-2", ...).
  const baseSlug = `${src.slug || 'org'}-copy`;
  const { data: existing } = await supabase
    .from('organizations').select('slug').ilike('slug', `${baseSlug}%`);
  const taken = new Set((existing || []).map(o => o.slug));
  let slug = baseSlug, n = 2;
  while (taken.has(slug)) slug = `${baseSlug}-${n++}`;

  // 3. Insert the new org, copying every config column but resetting id,
  //    timestamps, and the soft-delete flag.
  const { id: _id, created_at: _ca, updated_at: _ua, deleted_at: _da, ...cfg } = src;
  const newName = `${src.name} (Copy)`;
  const { data: orgRow, error: orgErr } = await supabase
    .from('organizations')
    .insert({
      ...cfg,
      name: newName,
      slug,
      partner_brand_name: src.partner_brand_name || newName,
      deleted_at: null,
      created_by_packperks_admin: user?.id ?? null,
    })
    .select('*').single();
  if (orgErr) throw orgErr;
  const newId = orgRow.id;

  // 4. Copy the published config (rewards + settings + copy + dashboard blocks).
  const { data: pub } = await supabase
    .from('app_config').select('value').eq('key', `published:${srcOrgId}`).maybeSingle();
  if (pub?.value) {
    const { error } = await supabase.from('app_config').upsert({
      key: `published:${newId}`, value: pub.value, updated_at: new Date().toISOString(),
    });
    if (error) console.warn('duplicateOrganization: config copy failed', error);
  }

  // 5. Copy the reward-budget cap.
  const { data: budget } = await supabase
    .from('org_reward_budgets').select('cap_eur, enabled').eq('org_id', srcOrgId).maybeSingle();
  if (budget) {
    const { error } = await supabase.from('org_reward_budgets').upsert({
      org_id: newId, cap_eur: budget.cap_eur, enabled: budget.enabled,
      updated_at: new Date().toISOString(), updated_by: user?.id ?? null,
    });
    if (error) console.warn('duplicateOrganization: budget copy failed', error);
  }

  // 6. Copy locations (config, not stats).
  const { data: locs } = await supabase.from('locations').select('*').eq('org_id', srcOrgId);
  if (locs?.length) {
    const rows = locs.map(({ id: _i, org_id: _o, created_at: _c, updated_at: _u, ...l }) => ({ ...l, org_id: newId }));
    const { error } = await supabase.from('locations').insert(rows);
    if (error) console.warn('duplicateOrganization: locations copy failed', error);
  }

  return orgRow;
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

/* ─────────────────────────────────────────────────────────────────────
 * Phase 3 — store groups (Bring-Your-Own).
 *
 * A group ties several venues together so a customer keeps one identity
 * across them (per-store balances, a shared Stores page). Each group has
 * a "mode" — 'deposit' (the original model) or 'byo' (bring your own
 * cup, no deposit) — which selects the default customer copy. The group
 * default copy lives in app_config under `published:group:<id>`, mirroring
 * the per-org `published:<org_id>` pattern, so no extra table is needed.
 *
 * Membership + the per-member on/off switch live on `organizations`
 * (`group_id`, `group_active`), both additive and defaulting to the
 * pre-Phase-3 behaviour (ungrouped, active) for every existing org.
 * ───────────────────────────────────────────────────────────────────── */

const GROUP_CFG_KEY = (groupId) => `published:group:${groupId}`;

function slugifyGroup(s) {
  return (s || '')
    .toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'group';
}

/* Seed app_config value for a new group. The mode selects the default
 * copy preset (resolved at read time by composeGroupCopy); admin copy
 * edits (A6) layer on top under settings.copy. */
function groupConfigFromMode(mode) {
  return { settings: { mode: normalizeMode(mode), copy: {} } };
}

/* List every group with its member orgs and resolved mode. Members
 * include soft-deleted orgs (flagged via deleted_at) so the admin can
 * see the full picture; the UI can filter as needed. */
export async function listOrgGroups() {
  const { data: groups, error } = await supabase
    .from('org_groups')
    .select('*')
    .order('created_at', { ascending: true });
  if (error) throw error;
  const list = groups || [];
  if (list.length === 0) return [];

  const ids = list.map(g => g.id);
  const { data: orgs, error: orgErr } = await supabase
    .from('organizations')
    .select('id, name, slug, brand_color, logo_url, group_id, group_active, deleted_at')
    .in('group_id', ids);
  if (orgErr) throw orgErr;

  const keys = ids.map(GROUP_CFG_KEY);
  const { data: cfgs } = await supabase
    .from('app_config')
    .select('key, value')
    .in('key', keys);
  const cfgByGroup = {};
  (cfgs || []).forEach(c => {
    const gid = c.key.replace('published:group:', '');
    cfgByGroup[gid] = c.value || null;
  });

  return list.map(g => ({
    ...g,
    mode: normalizeMode(cfgByGroup[g.id]?.settings?.mode),
    config: cfgByGroup[g.id] || null,
    members: (orgs || [])
      .filter(o => o.group_id === g.id)
      .sort((a, b) => (a.name || '').localeCompare(b.name || '')),
  }));
}

/* Create a group. Seeds the default copy from the chosen mode so a BYO
 * group immediately reads as a bring-your-own programme. */
export async function createOrgGroup({ name, mode = 'deposit' } = {}) {
  const clean = (name || '').trim();
  if (!clean) throw new Error('Group name is required.');

  const { data: existing } = await supabase.from('org_groups').select('slug');
  const taken = new Set((existing || []).map(r => r.slug));
  const base = slugifyGroup(clean);
  let slug = base, n = 2;
  while (taken.has(slug)) slug = `${base}-${n++}`;

  const { data: row, error } = await supabase
    .from('org_groups')
    .insert({ name: clean, slug })
    .select('*')
    .single();
  if (error) throw error;

  const value = groupConfigFromMode(mode);
  const { error: cfgErr } = await supabase
    .from('app_config')
    .upsert({ key: GROUP_CFG_KEY(row.id), value, updated_at: new Date().toISOString() });
  if (cfgErr) console.warn('createOrgGroup: config seed failed', cfgErr);

  return { ...row, mode: value.settings.mode, config: value, members: [] };
}

export async function renameOrgGroup(groupId, name, slug) {
  const clean = (name || '').trim();
  if (!clean) throw new Error('Group name is required.');
  const updates = { name: clean, updated_at: new Date().toISOString() };

  // Optional slug change — this is the /<groupSlug> URL for the Stores hub.
  if (slug !== undefined && slug !== null) {
    const base = slugifyGroup(slug);
    const { data: existing } = await supabase.from('org_groups').select('id, slug').neq('id', groupId);
    const taken = new Set((existing || []).map(r => r.slug));
    let s = base, n = 2;
    while (taken.has(s)) s = `${base}-${n++}`;
    updates.slug = s;
  }

  const { data, error } = await supabase
    .from('org_groups')
    .update(updates)
    .eq('id', groupId)
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

/* Switch a group's copy mode. Clears any per-string overrides so the new
 * mode's preset shows cleanly (switching mode = picking a fresh template);
 * the admin can then re-customise via saveGroupCopy. */
export async function setOrgGroupMode(groupId, mode) {
  const m = normalizeMode(mode);
  const key = GROUP_CFG_KEY(groupId);
  const { data: existing } = await supabase
    .from('app_config').select('value').eq('key', key).maybeSingle();

  const value = existing?.value
    ? JSON.parse(JSON.stringify(existing.value))
    : { settings: {} };
  value.settings = value.settings || {};
  value.settings.mode = m;
  value.settings.copy = {}; // reset overrides to the new mode's preset

  const { error } = await supabase
    .from('app_config')
    .upsert({ key, value, updated_at: new Date().toISOString() });
  if (error) throw error;
  return value;
}

/* Save the group's customer-copy overrides (A6). `copy` is the full
 * edited bundle { heroHeadline, heroSubtext, howItWorks, terms,
 * crossOrgNotice, dailyCapReview, scanSuccess, designCopy } — the customer
 * app's composeGroupCopy fills any missing key from the mode preset. */
export async function saveGroupCopy(groupId, copy) {
  const key = GROUP_CFG_KEY(groupId);
  const { data: existing } = await supabase
    .from('app_config').select('value').eq('key', key).maybeSingle();
  const value = existing?.value
    ? JSON.parse(JSON.stringify(existing.value))
    : { settings: { mode: 'deposit' } };
  value.settings = value.settings || {};
  value.settings.copy = copy || {};
  const { error } = await supabase
    .from('app_config')
    .upsert({ key, value, updated_at: new Date().toISOString() });
  if (error) throw error;
  return value;
}

/* Toggle the group's curated "coming soon / not-yet" placeholder venues on the
 * customer Stores map + list. Stored on the group config; the customer app
 * reads settings.showNotYetStores (default on when unset). */
export async function setGroupNotYetStores(groupId, show) {
  const key = GROUP_CFG_KEY(groupId);
  const { data: existing } = await supabase
    .from('app_config').select('value').eq('key', key).maybeSingle();
  const value = existing?.value
    ? JSON.parse(JSON.stringify(existing.value))
    : { settings: { mode: 'deposit' } };
  value.settings = value.settings || {};
  value.settings.showNotYetStores = !!show;
  const { error } = await supabase
    .from('app_config')
    .upsert({ key, value, updated_at: new Date().toISOString() });
  if (error) throw error;
  return value;
}

/* How many customer "Request it" taps a coming-soon venue needs before it reads
 * as "coming soon" on the Stores page. Stored on the group config (default 10). */
export async function saveNotYetThreshold(groupId, threshold) {
  const key = GROUP_CFG_KEY(groupId);
  const { data: existing } = await supabase
    .from('app_config').select('value').eq('key', key).maybeSingle();
  const value = existing?.value
    ? JSON.parse(JSON.stringify(existing.value))
    : { settings: { mode: 'deposit' } };
  value.settings = value.settings || {};
  value.settings.notYetThreshold = Math.max(1, Math.round(Number(threshold) || 10));
  const { error } = await supabase
    .from('app_config')
    .upsert({ key, value, updated_at: new Date().toISOString() });
  if (error) throw error;
  return value;
}

/* Save the group's editable "Future vendors" list (the coming-soon venues shown
 * on the customer Stores page). Stored on the group config; the customer app
 * reads settings.notYetVendors, falling back to the curated region defaults. */
export async function saveNotYetVendors(groupId, vendors) {
  const key = GROUP_CFG_KEY(groupId);
  const { data: existing } = await supabase
    .from('app_config').select('value').eq('key', key).maybeSingle();
  const value = existing?.value
    ? JSON.parse(JSON.stringify(existing.value))
    : { settings: { mode: 'deposit' } };
  value.settings = value.settings || {};
  value.settings.notYetVendors = Array.isArray(vendors) ? vendors : [];
  const { error } = await supabase
    .from('app_config')
    .upsert({ key, value, updated_at: new Date().toISOString() });
  if (error) throw error;
  return value;
}

/* Count "Request it" taps per future vendor (from client_events), so admins can
 * see which coming-soon venue customers want most. Returns { name: count }. */
export async function getFutureVendorStats(region) {
  const { data, error } = await supabase
    .from('client_events').select('props').eq('event', 'store_requested');
  if (error) return {};
  const counts = {};
  (data || []).forEach(r => {
    const p = r.props || {};
    if (region && p.region && p.region !== region) return;
    if (p.name) counts[p.name] = (counts[p.name] || 0) + 1;
  });
  return counts;
}

/* Drop all copy overrides → the group reverts to its mode preset. */
export async function resetGroupCopy(groupId) {
  const key = GROUP_CFG_KEY(groupId);
  const { data: existing } = await supabase
    .from('app_config').select('value').eq('key', key).maybeSingle();
  if (!existing?.value) return null;
  const value = JSON.parse(JSON.stringify(existing.value));
  value.settings = value.settings || {};
  value.settings.copy = {};
  const { error } = await supabase
    .from('app_config')
    .upsert({ key, value, updated_at: new Date().toISOString() });
  if (error) throw error;
  return value;
}

/* Combined stats across a group's active member orgs: per-store and
 * group totals for users, current cups (balance), lifetime cups, claims,
 * and payout. Aggregated client-side over a handful of scoped queries —
 * fine at demo scale (member orgs are few). */
export async function getGroupStats(groupId) {
  const empty = { totals: { stores: 0, users: 0, cups: 0, lifetime: 0, claims: 0, payout: 0 }, perStore: [] };
  if (!groupId) return empty;

  const { data: members } = await supabase
    .from('organizations')
    .select('id, name, slug')
    .eq('group_id', groupId).is('deleted_at', null)
    .order('name', { ascending: true });
  const orgIds = (members || []).map(m => m.id);
  if (orgIds.length === 0) return empty;

  const { data: users } = await supabase
    .from('users').select('id, org_id').in('org_id', orgIds).is('merged_into', null);
  const userIds = (users || []).map(u => u.id);
  const orgByUser = {};
  (users || []).forEach(u => { orgByUser[u.id] = u.org_id; });

  let bals = [];
  if (userIds.length) {
    const { data } = await supabase
      .from('cup_balances').select('user_id, balance, lifetime_cups').in('user_id', userIds);
    bals = data || [];
  }
  const { data: claims } = await supabase
    .from('claims').select('org_id, payout_amount, status').in('org_id', orgIds);

  // Seed per-store buckets.
  const byOrg = {};
  (members || []).forEach(m => {
    byOrg[m.id] = { orgId: m.id, name: m.name, slug: m.slug, users: 0, cups: 0, lifetime: 0, claims: 0, payout: 0 };
  });
  (users || []).forEach(u => { if (byOrg[u.org_id]) byOrg[u.org_id].users += 1; });
  bals.forEach(b => {
    const orgId = orgByUser[b.user_id];
    if (!byOrg[orgId]) return;
    byOrg[orgId].cups     += b.balance || 0;
    byOrg[orgId].lifetime += b.lifetime_cups || 0;
  });
  (claims || []).forEach(c => {
    if (!byOrg[c.org_id]) return;
    byOrg[c.org_id].claims += 1;
    if (c.status === 'completed') byOrg[c.org_id].payout += Number(c.payout_amount) || 0;
  });

  const perStore = (members || []).map(m => byOrg[m.id]);
  const totals = perStore.reduce((t, s) => ({
    stores: t.stores + 1,
    users:  t.users + s.users,
    cups:   t.cups + s.cups,
    lifetime: t.lifetime + s.lifetime,
    claims: t.claims + s.claims,
    payout: t.payout + s.payout,
  }), { stores: 0, users: 0, cups: 0, lifetime: 0, claims: 0, payout: 0 });

  return { totals, perStore };
}

/* Delete a group. organizations.group_id is ON DELETE SET NULL, so
 * members simply detach (they keep working standalone). We also drop the
 * group's config row. */
export async function deleteOrgGroup(groupId) {
  const { error } = await supabase.from('org_groups').delete().eq('id', groupId);
  if (error) throw error;
  await supabase.from('app_config').delete().eq('key', GROUP_CFG_KEY(groupId));
  return true;
}

/* Add an org to a group (or remove it with groupId = null). */
export async function setOrgGroupMembership(orgId, groupId) {
  const { data, error } = await supabase
    .from('organizations')
    .update({ group_id: groupId || null, updated_at: new Date().toISOString() })
    .eq('id', orgId)
    .select('id, group_id, group_active')
    .single();
  if (error) throw error;
  return data;
}

/* Toggle a member's presence in the group's Stores list (A7). Off keeps
 * the org fully functional standalone but hides it from the group view. */
export async function setOrgGroupActive(orgId, active) {
  const { data, error } = await supabase
    .from('organizations')
    .update({ group_active: !!active, updated_at: new Date().toISOString() })
    .eq('id', orgId)
    .select('id, group_active')
    .single();
  if (error) throw error;
  return data;
}

/* ─────────────────────────────────────────────────────────────────────
 * Phase 3 — BYO cup requests (admin approval queue).
 *
 * The byo-mint edge function auto-credits ≤2 cups per rolling 24h; the
 * 3rd+ scan lands here as a pending request. An admin approves (credits
 * the cup) or denies. Mirrors the claims approve/deny pattern — the
 * credit is a direct cup_balances bump (like adjustUserBalance), scoped
 * to the active org.
 * ───────────────────────────────────────────────────────────────────── */

export async function getByoRequests(status = 'pending') {
  let q = supabase
    .from('byo_cup_requests')
    .select('id, org_id, user_id, identity_id, cups, status, device_id, note, created_at, decided_at, decided_by, user:users(display_name, email, device)')
    .order('created_at', { ascending: false });
  q = applyOrgFilter(q);
  if (status && status !== 'all') q = q.eq('status', status);
  const { data, error } = await q;
  if (error) throw error;
  return (data || []).map(r => ({
    ...r,
    userName: r.user?.display_name || null,
    userEmail: r.user?.email || null,
    userDevice: r.user?.device || null,
  }));
}

export async function getByoPendingCount() {
  let q = supabase.from('byo_cup_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending');
  q = applyOrgFilter(q);
  const { count, error } = await q;
  if (error) throw error;
  return count || 0;
}

/* Per-store BYO auto-credit cap: how many cups a customer can auto-collect
 * from THIS store's counter QR per rolling 24h before extra scans are held
 * for review. Stored in its own app_config row (`byo:cap:<orgId>`) so it
 * never collides with the design draft/publish flow, and is org-scoped so a
 * store's cap never affects another store. The byo-mint edge function reads
 * the same key; default is 2 when unset. */
export const BYO_CAP_DEFAULT = 2;

export async function getByoCap(orgId) {
  if (!orgId) return BYO_CAP_DEFAULT;
  const { data } = await supabase
    .from('app_config').select('value').eq('key', `byo:cap:${orgId}`).maybeSingle();
  const n = Number(data?.value?.dailyCap);
  return Number.isFinite(n) && n > 0 ? n : BYO_CAP_DEFAULT;
}

export async function saveByoCap(orgId, dailyCap) {
  if (!orgId) throw new Error('No active store selected.');
  const n = Math.max(1, Math.min(50, parseInt(dailyCap, 10) || BYO_CAP_DEFAULT));
  const { error } = await supabase.from('app_config').upsert({
    key: `byo:cap:${orgId}`, value: { dailyCap: n }, updated_at: new Date().toISOString(),
  });
  if (error) throw error;
  return n;
}

export async function approveByoRequest(reqId) {
  const { data: { user } } = await supabase.auth.getUser();

  const { data: reqRow, error: reqErr } = await supabase
    .from('byo_cup_requests').select('*').eq('id', reqId).maybeSingle();
  if (reqErr) throw reqErr;
  if (!reqRow) throw new Error('Request not found.');
  if (reqRow.status !== 'pending') throw new Error('This request has already been decided.');

  const cups = reqRow.cups || 1;

  // Credit the user's per-org balance (+ lifetime).
  const { data: bal } = await supabase
    .from('cup_balances').select('balance, lifetime_cups').eq('user_id', reqRow.user_id).maybeSingle();
  const newBalance  = (bal?.balance || 0) + cups;
  const newLifetime = (bal?.lifetime_cups || 0) + cups;
  if (bal) {
    const { error: balErr } = await supabase
      .from('cup_balances')
      .update({ balance: newBalance, lifetime_cups: newLifetime, updated_at: new Date().toISOString() })
      .eq('user_id', reqRow.user_id);
    if (balErr) throw balErr;
  } else {
    await supabase.from('cup_balances').insert({
      user_id: reqRow.user_id, org_id: reqRow.org_id, balance: newBalance, lifetime_cups: newLifetime,
    });
  }

  // Log the credit (source 'byo_admin' so it never counts toward the auto
  // cap) + a user-visible activity entry. Both best-effort.
  try {
    await supabase.from('cup_scans').insert({
      user_id: reqRow.user_id, org_id: reqRow.org_id, scan_type: 'byo', source: 'byo_admin',
      status: 'success', cups_awarded: cups, scanned_at: new Date().toISOString(),
    });
  } catch (e) { console.warn('approveByoRequest: scan log failed', e); }
  try {
    await supabase.from('activity_history').insert({
      user_id: reqRow.user_id, type: 'cup_added', label: 'Cup added (approved)',
    });
  } catch (e) { console.warn('approveByoRequest: activity log failed', e); }

  // Mark approved — the status guard prevents a double-credit race.
  const { data: updated, error: updErr } = await supabase
    .from('byo_cup_requests')
    .update({ status: 'approved', decided_at: new Date().toISOString(), decided_by: user?.id ?? null })
    .eq('id', reqId).eq('status', 'pending')
    .select('*').single();
  if (updErr) throw updErr;
  return updated;
}

export async function denyByoRequest(reqId) {
  const { data: { user } } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from('byo_cup_requests')
    .update({ status: 'denied', decided_at: new Date().toISOString(), decided_by: user?.id ?? null })
    .eq('id', reqId).eq('status', 'pending')
    .select('*').single();
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
