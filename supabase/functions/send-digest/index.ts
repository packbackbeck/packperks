// PackPerks - send-digest Edge Function
//
// Renders + emails the configurable weekly digest (admin picks which dashboard
// metrics to include; config lives in app_config 'weekly_digest').
//
// Body: { mode: 'scheduled' | 'test', org_id?, to? }
//   'scheduled' - called by cron. Requires header x-digest-secret matching the
//     secret in app_config 'digest_cron'. Sends only if enabled AND due today.
//   'test' - called by an admin from the dashboard (JWT verified against
//     admin_profiles). Sends immediately, ignoring the schedule.
//
// Metrics are computed server-side (org- or group-scoped) and sent via Brevo.

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

// Metric labels (mirror of DIGEST_METRICS in adminApi.js).
const LABELS: Record<string, string> = {
  new_users: 'New users', total_users: 'Total users', active_users: 'Active users',
  cups_period: 'Cups collected', cups_lifetime: 'Cups collected (all time)',
  cups_redeemed: 'Cups redeemed', cashback_paid: 'Cashback paid',
  pending_claims: 'Claims awaiting review', byo_scans: 'BYO cup scans',
  top_location: 'Busiest location', co2_avoided: 'CO2 avoided',
};

// Attributes in this template are single-quoted, so we only need to neutralise
// the angle brackets and ampersand.
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

async function computeMetrics(orgIds: string[], ids: string[], sinceIso: string) {
  const out: Record<string, { label: string; display: string }> = {};
  const need = (id: string) => ids.includes(id);
  const put = (id: string, display: string) => { out[id] = { label: LABELS[id] || id, display }; };

  if (need('total_users')) {
    const { count } = await supabase.from('users').select('id', { count: 'exact', head: true }).in('org_id', orgIds).is('merged_into', null);
    put('total_users', (count || 0).toLocaleString());
  }
  if (need('new_users')) {
    const { count } = await supabase.from('users').select('id', { count: 'exact', head: true }).in('org_id', orgIds).is('merged_into', null).gte('created_at', sinceIso);
    put('new_users', (count || 0).toLocaleString());
  }

  let scans: Array<{ user_id: string; cups_awarded: number; scan_type: string; location_id: string | null }> = [];
  if (['active_users', 'cups_period', 'byo_scans', 'top_location', 'co2_avoided'].some(need)) {
    const { data } = await supabase.from('cup_scans')
      .select('user_id, cups_awarded, scan_type, location_id')
      .in('org_id', orgIds).eq('status', 'success').gte('scanned_at', sinceIso);
    scans = data || [];
  }
  const cupsPeriod = scans.reduce((s, x) => s + (x.cups_awarded || 0), 0);
  if (need('active_users')) put('active_users', new Set(scans.map((s) => s.user_id)).size.toLocaleString());
  if (need('cups_period')) put('cups_period', cupsPeriod.toLocaleString());
  if (need('co2_avoided')) put('co2_avoided', fmtCo2(cupsPeriod * CO2_G_PER_CUP));
  if (need('byo_scans')) put('byo_scans', scans.filter((s) => s.scan_type === 'byo').length.toLocaleString());
  if (need('top_location')) {
    const counts = new Map<string, number>();
    for (const s of scans) if (s.location_id) counts.set(s.location_id, (counts.get(s.location_id) || 0) + 1);
    let topId: string | null = null, topN = 0;
    for (const [id, n] of counts) if (n > topN) { topN = n; topId = id; }
    let name = '-';
    if (topId) {
      const { data: loc } = await supabase.from('locations').select('name, city').eq('id', topId).maybeSingle();
      if (loc) name = loc.city ? `${loc.name} - ${loc.city}` : loc.name;
    }
    put('top_location', topN ? `${name} (${topN} scans)` : 'No location-tagged scans');
  }

  if (need('cups_lifetime')) {
    const { data } = await supabase.from('cup_balances').select('lifetime_cups').in('org_id', orgIds);
    put('cups_lifetime', (data || []).reduce((s: number, x: { lifetime_cups: number }) => s + (x.lifetime_cups || 0), 0).toLocaleString());
  }
  if (need('pending_claims')) {
    const { count } = await supabase.from('claims').select('id', { count: 'exact', head: true }).in('org_id', orgIds).eq('status', 'pending');
    put('pending_claims', (count || 0).toLocaleString());
  }
  if (need('cups_redeemed') || need('cashback_paid')) {
    const { data } = await supabase.from('claims').select('cups_redeemed, payout_amount').in('org_id', orgIds).eq('status', 'completed').gte('created_at', sinceIso);
    const rows = data || [];
    if (need('cups_redeemed')) put('cups_redeemed', rows.reduce((s: number, x: { cups_redeemed: number }) => s + (x.cups_redeemed || 0), 0).toLocaleString());
    if (need('cashback_paid')) put('cashback_paid', 'EUR ' + rows.reduce((s: number, x: { payout_amount: number }) => s + Number(x.payout_amount || 0), 0).toFixed(2));
  }

  return ids.map((id) => out[id]).filter(Boolean);
}

function renderEmail(cfg: { title: string; intro: string }, orgName: string, periodLabel: string, metrics: Array<{ label: string; display: string }>) {
  const card = (m: { label: string; display: string }) =>
    `<td style='padding:8px;' width='50%'><div style='background:#FBF7F0;border:1px solid #ECE5D8;border-radius:14px;padding:16px 18px;'>` +
    `<div style='font-size:12px;font-weight:700;color:#8B8577;text-transform:uppercase;letter-spacing:.4px;'>${esc(m.label)}</div>` +
    `<div style='font-size:26px;font-weight:800;color:#14100A;margin-top:6px;font-family:Georgia,serif;'>${esc(m.display)}</div></div></td>`;
  const rows: string[] = [];
  for (let i = 0; i < metrics.length; i += 2) {
    rows.push(`<tr>${card(metrics[i])}${metrics[i + 1] ? card(metrics[i + 1]) : `<td width='50%'></td>`}</tr>`);
  }
  const html =
    `<!doctype html><html><body style='margin:0;background:#F5ECDD;font-family:-apple-system,Segoe UI,Roboto,sans-serif;'>` +
    `<table role='presentation' width='100%' cellpadding='0' cellspacing='0' style='background:#F5ECDD;padding:28px 0;'><tr><td align='center'>` +
    `<table role='presentation' width='600' cellpadding='0' cellspacing='0' style='max-width:600px;width:100%;'>` +
    `<tr><td style='padding:0 16px 16px;'><div style='font-size:20px;font-weight:800;color:#6C4CE0;'>🥤 PackPerks</div></td></tr>` +
    `<tr><td style='background:#fff;border:1px solid #ECE5D8;border-radius:20px;padding:28px 24px;'>` +
    `<div style='font-size:12px;font-weight:700;color:#8B8577;text-transform:uppercase;letter-spacing:.5px;'>${esc(orgName)} - ${esc(periodLabel)}</div>` +
    `<h1 style='margin:6px 0 4px;font-size:24px;font-weight:800;color:#14100A;'>${esc(cfg.title)}</h1>` +
    `<p style='margin:0 0 18px;font-size:14.5px;line-height:1.5;color:#5A554F;'>${esc(cfg.intro)}</p>` +
    `<table role='presentation' width='100%' cellpadding='0' cellspacing='0'>${rows.join('')}</table></td></tr>` +
    `<tr><td style='padding:16px;text-align:center;'><p style='margin:0;font-size:11.5px;line-height:1.55;color:#B4AC9E;'>` +
    `You are receiving this because a weekly digest is configured in the PackPerks dashboard. Change the metrics or turn it off under Reports then Weekly digest.</p></td></tr>` +
    `</table></td></tr></table></body></html>`;
  const NL = String.fromCharCode(10);
  const text = [cfg.title, `${orgName} - ${periodLabel}`, '', ...metrics.map((m) => `${m.label}: ${m.display}`), ''].join(NL);
  return { html, text };
}

async function sendBrevo(to: string, subject: string, html: string, text: string) {
  if (!BREVO_API_KEY) return { ok: false, error: 'brevo_not_configured' };
  const resp = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': BREVO_API_KEY, 'content-type': 'application/json', 'accept': 'application/json' },
    body: JSON.stringify({
      sender: { name: BREVO_SENDER_NAME, email: BREVO_SENDER_EMAIL },
      to: [{ email: to }], subject, htmlContent: html, textContent: text, tags: ['weekly-digest'],
    }),
  });
  return resp.ok ? { ok: true } : { ok: false, error: `brevo_${resp.status}` };
}

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  let body: { mode?: string; org_id?: string; to?: string };
  try { body = await req.json(); } catch { body = {}; }
  const mode = body.mode === 'test' ? 'test' : 'scheduled';

  const { data: cfgRow } = await supabase.from('app_config').select('value').eq('key', 'weekly_digest').maybeSingle();
  const cfg = (cfgRow?.value || {}) as {
    enabled?: boolean; org_id?: string; frequency?: string; dayOfWeek?: string;
    recipient?: string; title?: string; intro?: string; metrics?: string[]; scope?: string;
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
    if (!cfg.enabled) return json({ status: 'skipped', reason: 'disabled' });
    const now = new Date();
    const freq = cfg.frequency || 'weekly';
    const dueToday = freq === 'weekly'
      ? WEEKDAYS[now.getUTCDay()] === (cfg.dayOfWeek || 'monday')
      : now.getUTCDate() === 1;
    if (!dueToday) return json({ status: 'skipped', reason: 'not_today' });
  }

  const orgId = (mode === 'test' ? (body.org_id || cfg.org_id) : cfg.org_id) || null;
  if (!orgId) return json({ error: 'no_org_configured' }, 400);
  const recipient = (mode === 'test' ? (body.to || cfg.recipient) : cfg.recipient) || '';
  if (!recipient) return json({ error: 'no_recipient' }, 400);

  const metrics = Array.isArray(cfg.metrics) && cfg.metrics.length ? cfg.metrics : ['new_users', 'cups_period', 'byo_scans'];
  const scope = cfg.scope || 'org';
  const freq = cfg.frequency || 'weekly';
  const days = freq === 'monthly' ? 30 : 7;
  const sinceIso = new Date(Date.now() - days * 86400000).toISOString();
  const periodLabel = freq === 'monthly' ? 'Last 30 days' : 'Last 7 days';

  const orgIds = await orgScope(orgId, scope);
  const { data: orgRow } = await supabase.from('organizations').select('name, partner_brand_name').eq('id', orgId).maybeSingle();
  const orgName = orgRow?.partner_brand_name || orgRow?.name || 'Your store';

  let computed;
  try { computed = await computeMetrics(orgIds, metrics, sinceIso); }
  catch (e) { return json({ error: 'compute_failed', detail: String(e) }, 500); }

  const { html, text } = renderEmail(
    { title: cfg.title || 'Your PackPerks digest', intro: cfg.intro || 'Here is your latest programme summary.' },
    orgName, periodLabel, computed,
  );
  const subject = `${cfg.title || 'PackPerks digest'} - ${orgName}`;
  const sent = await sendBrevo(recipient, subject, html, text);
  if (!sent.ok) return json({ error: sent.error || 'send_failed' }, 502);

  return json({ status: 'sent', mode, to: recipient, org: orgName, metrics: computed.length });
});
