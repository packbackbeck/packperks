// PackPerks - send-digest Edge Function
//
// Sends the scheduled digests. Two INDEPENDENT audiences, mailed as SEPARATE
// letters:
//   • VENDOR digest — behaviour + rewards a store owner cares about
//   • STAFF  digest — everything the vendor sees PLUS platform totals + health
// Config lives in app_config 'weekly_digest':
//   { org_id, frequency, dayOfWeek, scope,
//     vendor: { enabled, recipients[], title, intro, metrics[] },
//     staff:  { enabled, recipients[], title, intro, metrics[] } }
//
// Body: { mode: 'scheduled' | 'test', audience?, org_id?, to? }
//   'scheduled' - cron. Header x-digest-secret == app_config 'digest_cron'.secret.
//                 Sends each enabled audience that is due today, as its own email.
//   'test' - admin (JWT verified). Sends ONE audience (body.audience) immediately.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } },
);

const BREVO_API_KEY      = Deno.env.get('BREVO_API_KEY') ?? '';
const BREVO_SENDER_NAME  = Deno.env.get('BREVO_SENDER_NAME') ?? 'PackPerks';
const BREVO_SENDER_EMAIL = Deno.env.get('BREVO_SENDER_EMAIL') ?? 'info@packback.network';
const CO2_G_PER_CUP = 72;

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-digest-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...CORS, 'content-type': 'application/json' } });

// Labels — mirror DIGEST_VENDOR_METRICS + DIGEST_STAFF_METRICS in adminApi.js.
const LABELS: Record<string, string> = {
  new_users: 'New customers', active_users: 'Active customers', returning_users: 'Returning customers',
  repeat_rate: 'Repeat rate', scans_total: 'Cup scans', cups_period: 'Cups collected',
  avg_cups_user: 'Avg cups / customer', byo_scans: 'BYO cup scans', top_location: 'Busiest location',
  busiest_day: 'Busiest day', top_reward: 'Most-claimed reward', unique_rewards: 'Rewards claimed',
  cups_redeemed: 'Cups redeemed', redemption_rate: 'Redemption rate', cashback_paid: 'Cashback paid',
  avg_cashback: 'Avg cashback / claim', co2_avoided: 'CO2 avoided',
  total_users: 'Total customers', total_cups_lifetime: 'Cups collected (all time)',
  cups_redeemed_all: 'Cups redeemed (all time)', total_cashback: 'Cashback paid (all time)',
  approved_claims: 'Claims approved', failed_claims: 'Claims rejected', pending_claims: 'Claims awaiting review',
  rejection_rate: 'Rejection rate', ai_pass_rate: 'AI auto-pass rate', avg_ai_confidence: 'Avg AI confidence',
  pending_merges: 'Merge requests pending', merges_period: 'Merge requests', stores_count: 'Stores in scope',
  active_stores: 'Active stores',
};
const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const esc = (s: string) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] || c));
const fmtCo2 = (g: number) => g >= 1000000 ? `${(g / 1000000).toFixed(g >= 10000000 ? 0 : 1)} t`
  : g >= 1000 ? `${Math.round(g / 1000).toLocaleString()} kg` : `${Math.round(g)} g`;

async function orgScope(orgId: string, scope: string): Promise<string[]> {
  if (scope !== 'group') return [orgId];
  const { data: org } = await supabase.from('organizations').select('group_id').eq('id', orgId).maybeSingle();
  if (!org?.group_id) return [orgId];
  const { data: members } = await supabase.from('organizations').select('id').eq('group_id', org.group_id).is('deleted_at', null);
  const ids = (members || []).map((m: { id: string }) => m.id);
  return ids.length ? ids : [orgId];
}

async function rewardNameMap(orgIds: string[]): Promise<Record<string, string>> {
  const keys = orgIds.map((id) => `published:${id}`);
  const { data } = await supabase.from('app_config').select('value').in('key', keys);
  const map: Record<string, string> = {};
  for (const row of (data || []) as Array<{ value: { rewards?: Array<{ id: string; name: string }> } }>) {
    for (const r of (row.value?.rewards || [])) if (r?.id) map[r.id] = r.name || r.id;
  }
  return map;
}

// Compute the display value for every requested metric id.
async function computeMetrics(orgIds: string[], need: Set<string>, sinceIso: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};

  const PERIOD_SCAN = ['active_users', 'cups_period', 'byo_scans', 'top_location', 'co2_avoided', 'returning_users', 'avg_cups_user', 'redemption_rate', 'scans_total', 'repeat_rate', 'busiest_day', 'active_stores'];
  let scans: Array<{ user_id: string; cups_awarded: number; scan_type: string; location_id: string | null; scanned_at: string; org_id: string }> = [];
  if (PERIOD_SCAN.some((m) => need.has(m))) {
    const { data } = await supabase.from('cup_scans')
      .select('user_id, cups_awarded, scan_type, location_id, scanned_at, org_id')
      .in('org_id', orgIds).eq('status', 'success').gte('scanned_at', sinceIso);
    scans = data || [];
  }
  const cupsPeriod = scans.reduce((s, x) => s + (x.cups_awarded || 0), 0);
  const activeUsers = new Set(scans.map((s) => s.user_id)).size;
  const daysByUser = new Map<string, Set<string>>();
  for (const s of scans) {
    const d = (s.scanned_at || '').slice(0, 10);
    if (!d) continue;
    if (!daysByUser.has(s.user_id)) daysByUser.set(s.user_id, new Set());
    daysByUser.get(s.user_id)!.add(d);
  }
  const returning = Array.from(daysByUser.values()).filter((set) => set.size >= 2).length;

  if (need.has('scans_total')) out.scans_total = scans.length.toLocaleString();
  if (need.has('cups_period')) out.cups_period = cupsPeriod.toLocaleString();
  if (need.has('active_users')) out.active_users = activeUsers.toLocaleString();
  if (need.has('returning_users')) out.returning_users = returning.toLocaleString();
  if (need.has('repeat_rate')) out.repeat_rate = activeUsers ? `${Math.round((returning / activeUsers) * 100)}%` : '0%';
  if (need.has('byo_scans')) out.byo_scans = scans.filter((s) => s.scan_type === 'byo').length.toLocaleString();
  if (need.has('co2_avoided')) out.co2_avoided = fmtCo2(cupsPeriod * CO2_G_PER_CUP);
  if (need.has('avg_cups_user')) out.avg_cups_user = activeUsers ? (cupsPeriod / activeUsers).toFixed(1) : '0';
  if (need.has('active_stores')) out.active_stores = String(new Set(scans.map((s) => s.org_id)).size);
  if (need.has('busiest_day')) {
    const byDay = new Array(7).fill(0);
    for (const s of scans) { const t = new Date(s.scanned_at); if (!Number.isNaN(t.getTime())) byDay[t.getUTCDay()]++; }
    let best = -1, bestN = 0;
    for (let i = 0; i < 7; i++) if (byDay[i] > bestN) { bestN = byDay[i]; best = i; }
    out.busiest_day = best >= 0 ? `${WEEKDAY_NAMES[best]} (${bestN})` : '-';
  }
  if (need.has('top_location')) {
    const counts = new Map<string, number>();
    for (const s of scans) if (s.location_id) counts.set(s.location_id, (counts.get(s.location_id) || 0) + 1);
    let topId: string | null = null, topN = 0;
    for (const [id, n] of counts) if (n > topN) { topN = n; topId = id; }
    let name = '-';
    if (topId) {
      const { data: loc } = await supabase.from('locations').select('name, city').eq('id', topId).maybeSingle();
      if (loc) name = loc.city ? `${loc.name} - ${loc.city}` : loc.name;
    }
    out.top_location = topN ? `${name} (${topN} scans)` : 'No location-tagged scans';
  }

  if (need.has('new_users')) {
    const { count } = await supabase.from('users').select('id', { count: 'exact', head: true }).in('org_id', orgIds).is('merged_into', null).gte('created_at', sinceIso);
    out.new_users = (count || 0).toLocaleString();
  }
  if (need.has('total_users')) {
    const { count } = await supabase.from('users').select('id', { count: 'exact', head: true }).in('org_id', orgIds).is('merged_into', null);
    out.total_users = (count || 0).toLocaleString();
  }
  if (need.has('total_cups_lifetime')) {
    const { data } = await supabase.from('cup_balances').select('lifetime_cups').in('org_id', orgIds);
    out.total_cups_lifetime = (data || []).reduce((s: number, x: { lifetime_cups: number }) => s + (x.lifetime_cups || 0), 0).toLocaleString();
  }

  // Period completed claims.
  if (['cups_redeemed', 'cashback_paid', 'redemption_rate', 'avg_cashback', 'unique_rewards', 'top_reward'].some((m) => need.has(m))) {
    const { data } = await supabase.from('claims').select('cups_redeemed, payout_amount, reward_id').in('org_id', orgIds).eq('status', 'completed').gte('created_at', sinceIso);
    const rows = data || [];
    const redeemed = rows.reduce((s: number, x: { cups_redeemed: number }) => s + (x.cups_redeemed || 0), 0);
    const paid = rows.reduce((s: number, x: { payout_amount: number }) => s + Number(x.payout_amount || 0), 0);
    if (need.has('cups_redeemed')) out.cups_redeemed = redeemed.toLocaleString();
    if (need.has('cashback_paid')) out.cashback_paid = 'EUR ' + paid.toFixed(2);
    if (need.has('avg_cashback')) out.avg_cashback = rows.length ? 'EUR ' + (paid / rows.length).toFixed(2) : 'EUR 0.00';
    if (need.has('redemption_rate')) out.redemption_rate = cupsPeriod ? `${Math.round((redeemed / cupsPeriod) * 100)}%` : '0%';
    if (need.has('unique_rewards')) out.unique_rewards = String(new Set(rows.map((r: { reward_id: string }) => r.reward_id).filter(Boolean)).size);
    if (need.has('top_reward')) {
      const counts = new Map<string, number>();
      for (const r of rows as Array<{ reward_id: string }>) if (r.reward_id) counts.set(r.reward_id, (counts.get(r.reward_id) || 0) + 1);
      let topId: string | null = null, topN = 0;
      for (const [id, n] of counts) if (n > topN) { topN = n; topId = id; }
      if (topId) { const names = await rewardNameMap(orgIds); out.top_reward = `${names[topId] || topId} (${topN})`; }
      else out.top_reward = 'No claims yet';
    }
  }
  // All-time completed claims.
  if (['total_cashback', 'cups_redeemed_all', 'approved_claims', 'rejection_rate'].some((m) => need.has(m))) {
    const { count: approved } = await supabase.from('claims').select('id', { count: 'exact', head: true }).in('org_id', orgIds).eq('status', 'completed');
    if (need.has('approved_claims')) out.approved_claims = (approved || 0).toLocaleString();
    if (need.has('total_cashback') || need.has('cups_redeemed_all')) {
      const { data } = await supabase.from('claims').select('cups_redeemed, payout_amount').in('org_id', orgIds).eq('status', 'completed');
      const rows = data || [];
      if (need.has('total_cashback')) out.total_cashback = 'EUR ' + rows.reduce((s: number, x: { payout_amount: number }) => s + Number(x.payout_amount || 0), 0).toFixed(2);
      if (need.has('cups_redeemed_all')) out.cups_redeemed_all = rows.reduce((s: number, x: { cups_redeemed: number }) => s + (x.cups_redeemed || 0), 0).toLocaleString();
    }
    if (need.has('rejection_rate')) {
      const { count: failed } = await supabase.from('claims').select('id', { count: 'exact', head: true }).in('org_id', orgIds).eq('status', 'failed');
      const decided = (approved || 0) + (failed || 0);
      out.rejection_rate = decided ? `${Math.round(((failed || 0) / decided) * 100)}%` : '0%';
    }
  }
  if (need.has('failed_claims')) {
    const { count } = await supabase.from('claims').select('id', { count: 'exact', head: true }).in('org_id', orgIds).eq('status', 'failed');
    out.failed_claims = (count || 0).toLocaleString();
  }
  if (need.has('pending_claims')) {
    const { count } = await supabase.from('claims').select('id', { count: 'exact', head: true }).in('org_id', orgIds).eq('status', 'pending');
    out.pending_claims = (count || 0).toLocaleString();
  }
  if (need.has('pending_merges')) {
    const { count } = await supabase.from('merge_requests').select('id', { count: 'exact', head: true }).in('org_id', orgIds).eq('status', 'pending');
    out.pending_merges = (count || 0).toLocaleString();
  }
  if (need.has('merges_period')) {
    const { count } = await supabase.from('merge_requests').select('id', { count: 'exact', head: true }).in('org_id', orgIds).gte('requested_at', sinceIso);
    out.merges_period = (count || 0).toLocaleString();
  }
  if (need.has('stores_count')) out.stores_count = String(orgIds.length);
  if (need.has('ai_pass_rate') || need.has('avg_ai_confidence')) {
    const { data } = await supabase.from('claims').select('ai_failure_checks, ai_confidence').in('org_id', orgIds).not('verified_at', 'is', null);
    const rows = data || [];
    if (need.has('ai_pass_rate')) {
      const passed = rows.filter((r: { ai_failure_checks: string[] | null }) => !r.ai_failure_checks || r.ai_failure_checks.length === 0).length;
      out.ai_pass_rate = rows.length ? `${Math.round((passed / rows.length) * 100)}%` : '-';
    }
    if (need.has('avg_ai_confidence')) {
      const conf = rows.filter((r: { ai_confidence: number | null }) => typeof r.ai_confidence === 'number');
      out.avg_ai_confidence = conf.length ? `${Math.round((conf.reduce((s: number, r: { ai_confidence: number }) => s + r.ai_confidence, 0) / conf.length) * 100)}%` : '-';
    }
  }

  return out;
}

// A metric card. Three per row → narrower cards fit more numbers per line.
function metricCard(label: string, display: string) {
  return `<td style='padding:6px;' width='33.33%'><div style='background:#FBF7F0;border:1px solid #ECE5D8;border-radius:12px;padding:12px 13px;'>` +
    `<div style='font-size:10.5px;font-weight:700;color:#8B8577;text-transform:uppercase;letter-spacing:.3px;'>${esc(label)}</div>` +
    `<div style='font-size:21px;font-weight:800;color:#14100A;margin-top:4px;font-family:Georgia,serif;'>${esc(display)}</div></div></td>`;
}

function renderEmail(title: string, intro: string, accent: string, badge: string, orgName: string, periodLabel: string, cells: Array<{ label: string; display: string }>) {
  const rows: string[] = [];
  for (let i = 0; i < cells.length; i += 3) {
    rows.push('<tr>' +
      metricCard(cells[i].label, cells[i].display) +
      (cells[i + 1] ? metricCard(cells[i + 1].label, cells[i + 1].display) : `<td width='33.33%'></td>`) +
      (cells[i + 2] ? metricCard(cells[i + 2].label, cells[i + 2].display) : `<td width='33.33%'></td>`) +
    '</tr>');
  }
  // Wider email shell (680px) so three cards sit comfortably in one row.
  const html =
    `<!doctype html><html><body style='margin:0;background:#F5ECDD;font-family:-apple-system,Segoe UI,Roboto,sans-serif;'>` +
    `<table role='presentation' width='100%' cellpadding='0' cellspacing='0' style='background:#F5ECDD;padding:28px 0;'><tr><td align='center'>` +
    `<table role='presentation' width='680' cellpadding='0' cellspacing='0' style='max-width:680px;width:100%;'>` +
    `<tr><td style='padding:0 12px 16px;'><div style='font-size:20px;font-weight:800;color:#6C4CE0;'>🥤 PackPerks</div></td></tr>` +
    `<tr><td style='background:#fff;border:1px solid #ECE5D8;border-radius:20px;padding:26px 20px;'>` +
    `<span style='display:inline-block;font-size:11px;font-weight:800;letter-spacing:.5px;text-transform:uppercase;color:#fff;background:${accent};padding:4px 10px;border-radius:6px;'>${esc(badge)}</span>` +
    `<div style='font-size:12px;font-weight:700;color:#8B8577;text-transform:uppercase;letter-spacing:.5px;margin-top:10px;'>${esc(orgName)} - ${esc(periodLabel)}</div>` +
    `<h1 style='margin:5px 0 4px;font-size:23px;font-weight:800;color:#14100A;'>${esc(title)}</h1>` +
    `<p style='margin:0 0 14px;font-size:14.5px;line-height:1.5;color:#5A554F;'>${esc(intro)}</p>` +
    `<table role='presentation' width='100%' cellpadding='0' cellspacing='0'>${rows.join('')}</table>` +
    `</td></tr>` +
    `<tr><td style='padding:16px;text-align:center;'><p style='margin:0;font-size:11.5px;line-height:1.55;color:#B4AC9E;'>` +
    `You are receiving this because a digest is configured in the PackPerks dashboard. Change it or turn it off under Reports &amp; alerts then Scheduled digests.</p></td></tr>` +
    `</table></td></tr></table></body></html>`;
  const NL = String.fromCharCode(10);
  const text = [title, `${orgName} - ${periodLabel}`, '', ...cells.map((m) => `${m.label}: ${m.display}`), ''].join(NL);
  return { html, text };
}

async function sendBrevo(recipients: string[], subject: string, html: string, text: string) {
  if (!BREVO_API_KEY) return { ok: false, error: 'brevo_not_configured' };
  const to = recipients.filter(Boolean).map((email) => ({ email }));
  if (!to.length) return { ok: false, error: 'no_recipient' };
  const resp = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': BREVO_API_KEY, 'content-type': 'application/json', 'accept': 'application/json' },
    body: JSON.stringify({
      sender: { name: BREVO_SENDER_NAME, email: BREVO_SENDER_EMAIL },
      to, subject, htmlContent: html, textContent: text, tags: ['weekly-digest'],
    }),
  });
  return resp.ok ? { ok: true } : { ok: false, error: `brevo_${resp.status}` };
}

type Audience = { enabled?: boolean; recipients?: string[]; recipient?: string; title?: string; intro?: string; metrics?: string[] };

// Build + send ONE audience's digest. Returns a small status object.
async function sendAudience(
  key: 'vendor' | 'staff', aud: Audience, orgIds: string[], orgName: string,
  periodLabel: string, sinceIso: string, toOverride: string | null,
) {
  let recipients = Array.isArray(aud.recipients) && aud.recipients.length ? aud.recipients : (aud.recipient ? [aud.recipient] : []);
  if (toOverride) recipients = [toOverride];
  recipients = [...new Set(recipients.map((r) => (r || '').trim().toLowerCase()).filter(Boolean))];
  const metrics = Array.isArray(aud.metrics) ? aud.metrics : [];
  if (!recipients.length) return { audience: key, sent: false, reason: 'no_recipient' };
  if (!metrics.length) return { audience: key, sent: false, reason: 'no_metrics' };

  const computed = await computeMetrics(orgIds, new Set(metrics), sinceIso);
  const cells = metrics.map((id) => ({ label: LABELS[id] || id, display: computed[id] ?? '-' }));
  const accent = key === 'staff' ? '#5333A5' : '#C0451F';
  const badge = key === 'staff' ? 'Staff digest' : 'Vendor digest';
  const title = aud.title || (key === 'staff' ? 'PackPerks staff digest' : 'Your PackPerks vendor digest');
  const intro = aud.intro || 'Here is your latest programme summary.';
  const { html, text } = renderEmail(title, intro, accent, badge, orgName, periodLabel, cells);
  const sent = await sendBrevo(recipients, `${title} - ${orgName}`, html, text);
  return { audience: key, sent: sent.ok, to: recipients, metrics: cells.length, error: sent.ok ? undefined : sent.error };
}

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  let body: { mode?: string; audience?: string; org_id?: string; to?: string };
  try { body = await req.json(); } catch { body = {}; }
  const mode = body.mode === 'test' ? 'test' : 'scheduled';

  const { data: cfgRow } = await supabase.from('app_config').select('value').eq('key', 'weekly_digest').maybeSingle();
  const cfg = (cfgRow?.value || {}) as {
    org_id?: string; frequency?: string; dayOfWeek?: string; scope?: string;
    // Legacy fallbacks so an old saved config still resolves.
    recipient?: string; recipients?: string[]; metrics?: string[];
    vendorEnabled?: boolean; vendorMetrics?: string[]; adminEnabled?: boolean; adminMetrics?: string[];
    vendor?: Audience; staff?: Audience;
  };

  if (mode === 'test') {
    const auth = req.headers.get('Authorization');
    const authId = auth?.startsWith('Bearer ')
      ? (await supabase.auth.getUser(auth.replace('Bearer ', ''))).data.user?.id ?? null
      : null;
    if (!authId) return json({ error: 'forbidden' }, 403);
    const { data: adminP } = await supabase.from('admin_profiles').select('status').eq('id', authId).maybeSingle();
    if (!adminP || (adminP.status && adminP.status !== 'active')) return json({ error: 'forbidden' }, 403);
  } else {
    const { data: secRow } = await supabase.from('app_config').select('value').eq('key', 'digest_cron').maybeSingle();
    const cronSecret = (secRow?.value as { secret?: string } | null)?.secret || '';
    if (!cronSecret || req.headers.get('x-digest-secret') !== cronSecret) return json({ error: 'forbidden' }, 403);
    const now = new Date();
    const freq = cfg.frequency || 'weekly';
    const dueToday = freq === 'weekly'
      ? WEEKDAYS[now.getUTCDay()] === (cfg.dayOfWeek || 'monday')
      : now.getUTCDate() === 1;
    if (!dueToday) return json({ status: 'skipped', reason: 'not_today' });
  }

  const orgId = (mode === 'test' ? (body.org_id || cfg.org_id) : cfg.org_id) || null;
  if (!orgId) return json({ error: 'no_org_configured' }, 400);

  // Resolve the two audiences, tolerating the earlier config shapes.
  const vendor: Audience = cfg.vendor
    || { enabled: cfg.vendorEnabled !== false, recipients: cfg.recipients, recipient: cfg.recipient, metrics: cfg.vendorMetrics || cfg.metrics };
  const staff: Audience = cfg.staff
    || { enabled: !!cfg.adminEnabled, recipients: cfg.recipients, recipient: cfg.recipient, metrics: cfg.adminMetrics };

  const scope = cfg.scope || 'org';
  const freq = cfg.frequency || 'weekly';
  const days = freq === 'monthly' ? 30 : 7;
  const sinceIso = new Date(Date.now() - days * 86400000).toISOString();
  const periodLabel = freq === 'monthly' ? 'Last 30 days' : 'Last 7 days';

  const orgIds = await orgScope(orgId, scope);
  const { data: orgRow } = await supabase.from('organizations').select('name, partner_brand_name').eq('id', orgId).maybeSingle();
  const orgName = orgRow?.partner_brand_name || orgRow?.name || 'Your store';

  try {
    const results: unknown[] = [];
    if (mode === 'test') {
      const which = body.audience === 'staff' ? 'staff' : 'vendor';
      const aud = which === 'staff' ? staff : vendor;
      results.push(await sendAudience(which, aud, orgIds, orgName, periodLabel, sinceIso, body.to || null));
    } else {
      if (vendor.enabled !== false && (vendor.metrics || []).length) results.push(await sendAudience('vendor', vendor, orgIds, orgName, periodLabel, sinceIso, null));
      if (staff.enabled && (staff.metrics || []).length) results.push(await sendAudience('staff', staff, orgIds, orgName, periodLabel, sinceIso, null));
    }
    return json({ status: 'ok', mode, org: orgName, results });
  } catch (e) {
    return json({ error: 'send_failed', detail: String(e) }, 500);
  }
});
