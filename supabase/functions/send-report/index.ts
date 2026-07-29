// PackPerks - send-report Edge Function
//
// Sends the "Automated reports" email. Today it emails a preview of the
// configured dataset (claims / cup scans / activity) for the last 30 days;
// the same function is ready for a cron to call on the configured schedule.
//
// Body (test):      { mode: 'test', to?, config? }   -> admin JWT
// Body (scheduled): { }                               -> x-notify-secret header
// Config shape mirrors app_config 'automated_reports':
//   { dataset, status, scope, frequency, dayOfWeek, format, recipient }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } },
);
const BREVO_API_KEY      = Deno.env.get('BREVO_API_KEY') ?? '';
const BREVO_SENDER_NAME  = Deno.env.get('BREVO_SENDER_NAME') ?? 'PackPerks';
const BREVO_SENDER_EMAIL = Deno.env.get('BREVO_SENDER_EMAIL') ?? 'info@packback.network';

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-notify-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'content-type': 'application/json' } });
const esc = (s: unknown) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] || c));
const fmtWhen = (ts: string | null | undefined) => (ts ? new Date(ts).toISOString().replace('T', ' ').slice(0, 16) : '');

const DATASET_LABEL: Record<string, string> = { claims: 'Reward claims', cup_scans: 'Cup scans', activity: 'Activity' };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  let body: { mode?: string; to?: string; config?: Record<string, unknown> };
  try { body = await req.json(); } catch { body = {}; }
  const isTest = body.mode === 'test';

  // Auth: test uses an active admin JWT; scheduled uses the shared secret.
  if (isTest) {
    const auth = req.headers.get('Authorization');
    const authId = auth?.startsWith('Bearer ')
      ? (await supabase.auth.getUser(auth.replace('Bearer ', ''))).data.user?.id ?? null
      : null;
    if (!authId) return json({ error: 'forbidden' }, 403);
    const { data: adminP } = await supabase.from('admin_profiles').select('status').eq('id', authId).maybeSingle();
    if (!adminP || (adminP.status && adminP.status !== 'active')) return json({ error: 'forbidden' }, 403);
  } else {
    const { data: secRow } = await supabase.from('app_config').select('value').eq('key', 'digest_cron').maybeSingle();
    const secret = ((secRow?.value as { secret?: string } | null)?.secret) || '';
    if (!secret || req.headers.get('x-notify-secret') !== secret) return json({ error: 'forbidden' }, 403);
  }

  // Config: prefer the config sent from the screen, else the saved one.
  let cfg = body.config as Record<string, unknown> | null;
  if (!cfg) {
    const { data } = await supabase.from('app_config').select('value').eq('key', 'automated_reports').maybeSingle();
    cfg = (data?.value as Record<string, unknown>) || {};
  }
  const dataset = ['claims', 'cup_scans', 'activity'].includes(String(cfg.dataset)) ? String(cfg.dataset) : 'claims';
  const status = String(cfg.status || 'completed');
  const recipient = String((isTest ? (body.to || cfg.recipient) : cfg.recipient) || '');
  if (!recipient) return json({ error: 'no_recipient' }, 400);

  // Pull the last 30 days of the chosen dataset (preview of 25 rows + a count).
  const sinceIso = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const table = dataset === 'activity' ? 'activity_history' : dataset;
  const cols = dataset === 'claims'
    ? 'id, user_id, org_id, type, status, cups_redeemed, payout_amount, created_at'
    : dataset === 'cup_scans'
      ? 'id, user_id, org_id, cups_awarded, status, created_at'
      : 'id, user_id, type, label, created_at';
  let q = supabase.from(table).select(cols, { count: 'exact' })
    .gte('created_at', sinceIso).order('created_at', { ascending: false }).limit(25);
  if (dataset === 'claims' && status !== 'all') q = q.eq('status', status);
  const { data: rowsRaw, count } = await q;
  const list = (rowsRaw as Record<string, unknown>[]) || [];

  // Friendly names for customers and stores.
  const userIds = [...new Set(list.map((r) => r.user_id).filter(Boolean))] as string[];
  const orgIds = [...new Set(list.map((r) => r.org_id).filter(Boolean))] as string[];
  const [uRes, oRes] = await Promise.all([
    userIds.length ? supabase.from('users').select('id, display_name').in('id', userIds) : Promise.resolve({ data: [] }),
    orgIds.length ? supabase.from('organizations').select('id, name').in('id', orgIds) : Promise.resolve({ data: [] }),
  ]);
  const uMap: Record<string, string> = Object.fromEntries(((uRes.data as { id: string; display_name: string }[]) || []).map((u) => [u.id, u.display_name]));
  const oMap: Record<string, string> = Object.fromEntries(((oRes.data as { id: string; name: string }[]) || []).map((o) => [o.id, o.name]));

  let headers: string[];
  let cells: string[][];
  if (dataset === 'claims') {
    headers = ['When', 'Store', 'Customer', 'Type', 'Status', 'Cups', 'Payout'];
    cells = list.map((r) => [
      fmtWhen(r.created_at as string), oMap[r.org_id as string] || '', uMap[r.user_id as string] || 'Guest',
      String(r.type || ''), String(r.status || ''), String(r.cups_redeemed ?? ''),
      r.payout_amount != null ? 'EUR ' + Number(r.payout_amount).toFixed(2) : '',
    ]);
  } else if (dataset === 'cup_scans') {
    headers = ['When', 'Store', 'Customer', 'Cups', 'Status'];
    cells = list.map((r) => [
      fmtWhen(r.created_at as string), oMap[r.org_id as string] || '', uMap[r.user_id as string] || 'Guest',
      String(r.cups_awarded ?? ''), String(r.status || ''),
    ]);
  } else {
    headers = ['When', 'Customer', 'Type', 'Detail'];
    cells = list.map((r) => [
      fmtWhen(r.created_at as string), uMap[r.user_id as string] || 'Guest', String(r.type || ''), String(r.label || ''),
    ]);
  }

  const total = count ?? list.length;
  const label = DATASET_LABEL[dataset];
  const cadence = cfg.frequency === 'daily' ? 'every day'
    : cfg.frequency === 'monthly' ? 'on the 1st of each month'
      : 'every ' + (cfg.dayOfWeek ? String(cfg.dayOfWeek).charAt(0).toUpperCase() + String(cfg.dayOfWeek).slice(1) : 'week');

  const thead = headers.map((h) => `<th style='text-align:left;padding:6px 10px;border-bottom:2px solid #ECE5D8;font-size:11px;color:#8B8577;text-transform:uppercase;'>${esc(h)}</th>`).join('');
  const tbody = cells.map((row) => `<tr>${row.map((c) => `<td style='padding:6px 10px;border-bottom:1px solid #F0EADD;font-size:12.5px;color:#1D1D1D;'>${esc(c)}</td>`).join('')}</tr>`).join('');
  const emptyRow = `<tr><td colspan='${headers.length}' style='padding:14px;color:#9A9186;font-size:13px;'>No rows in the last 30 days.</td></tr>`;

  const html =
    `<!doctype html><html><body style='margin:0;background:#F5ECDD;font-family:-apple-system,Segoe UI,Roboto,sans-serif;'>` +
    `<table role='presentation' width='100%' cellpadding='0' cellspacing='0' style='background:#F5ECDD;padding:26px 0;'><tr><td align='center'>` +
    `<table role='presentation' width='640' cellpadding='0' cellspacing='0' style='max-width:640px;width:100%;'>` +
    `<tr><td style='padding:0 16px 14px;'><div style='font-size:18px;font-weight:800;color:#E4572E;'>PackPerks</div></td></tr>` +
    `<tr><td style='background:#fff;border:1px solid #ECE5D8;border-radius:18px;padding:24px;'>` +
    `<div style='font-size:12px;font-weight:700;color:#8B8577;text-transform:uppercase;letter-spacing:.5px;'>Automated report${isTest ? ' &middot; TEST' : ''}</div>` +
    `<h1 style='margin:6px 0 8px;font-size:20px;font-weight:800;color:#14100A;'>${esc(label)}</h1>` +
    `<p style='margin:0 0 14px;font-size:14px;line-height:1.5;color:#5A554F;'>Scheduled ${esc(cadence)} to ${esc(recipient)}. Showing the ${list.length} most recent of ${total} row${total === 1 ? '' : 's'} from the last 30 days.</p>` +
    `<table role='presentation' width='100%' cellpadding='0' cellspacing='0' style='border-collapse:collapse;'>` +
    `<thead><tr>${thead}</tr></thead><tbody>${tbody || emptyRow}</tbody></table>` +
    `<p style='margin:14px 0 0;font-size:11.5px;color:#A89E92;'>This is a preview of the automated report. Turn off scheduling under Reports then Automated reports.</p>` +
    `</td></tr></table></td></tr></table></body></html>`;
  const text = `PackPerks automated report${isTest ? ' (test)' : ''}: ${label}. Showing ${list.length} of ${total} rows from the last 30 days. Scheduled ${cadence} to ${recipient}.`;

  if (!BREVO_API_KEY) return json({ error: 'brevo_not_configured' }, 500);
  const resp = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': BREVO_API_KEY, 'content-type': 'application/json', 'accept': 'application/json' },
    body: JSON.stringify({
      sender: { name: BREVO_SENDER_NAME, email: BREVO_SENDER_EMAIL },
      to: [{ email: recipient }],
      subject: `PackPerks report${isTest ? ' (test)' : ''}: ${label}`,
      htmlContent: html, textContent: text, tags: ['automated-report'],
    }),
  });
  if (!resp.ok) return json({ error: 'brevo_' + resp.status }, 502);
  return json({ status: 'sent', to: recipient, dataset, rows: list.length, total });
});
