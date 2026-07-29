// PackPerks - notify-event Edge Function
//
// Real-time admin alert. DB triggers (pp_notify_event) call this via pg_net
// whenever a configured activity happens (claim, new account, cup scan, held
// BYO request, held merge request). It reads the notification_center config
// and, if that event is enabled, emails the configured admin recipient (Brevo).
//
// The email now includes the specifics (who / what / where / when), looked up
// from the row_id the trigger passes, plus a per-event emoji so the message has
// a visible icon in every client (emoji render reliably; images get blocked).
//
// Body (trigger): { event_type, summary, org_id?, row_id? }
// Body (test):    { mode: 'test', to? }
// Auth: header x-notify-secret === app_config 'digest_cron'.secret (trigger),
//       OR an admin_profiles JWT (test).

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

const LABELS: Record<string, string> = {
  claim_created: 'New claim submitted',
  account_created: 'New account created',
  cup_scanned: 'Cup scanned',
  byo_request: 'BYO cup request needs review',
  merge_request: 'Account-merge request needs review',
};
// A visible glyph for every email - emoji render across all mail clients, unlike
// inline SVG or blocked <img> logos.
const ICONS: Record<string, string> = {
  claim_created: '💶',
  account_created: '👤',
  cup_scanned: '🥤',
  byo_request: '♻️',
  merge_request: '🔗',
  test: '🔔',
};
// Where each event's "open it" button should land the admin. The admin app
// routes by URL hash and reads ?org=<slug>, so we deep-link straight to the
// relevant review page scoped to the right store.
const ADMIN_URL = 'https://perks.packback.network/admin';
const CTA: Record<string, { label: string; page: string; section?: string }> = {
  claim_created:   { label: 'Review claim',         page: 'claims' },
  account_created: { label: 'View customer',        page: 'users' },
  cup_scanned:     { label: 'Open cup scans',        page: 'cupscans' },
  byo_request:     { label: 'Review the cup scan',    page: 'cupscans' },
  // section=merge scrolls the Users page straight to the merge-request queue.
  merge_request:   { label: 'Review merge request',  page: 'users', section: 'merge' },
};
const esc = (s: string) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] || c));
const fmtWhen = (ts: string | null | undefined) =>
  ts ? new Date(ts).toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : null;

// Resolve a friendly name for a user id.
async function nameOf(userId: string | null): Promise<string | null> {
  if (!userId) return null;
  const { data } = await supabase.from('users').select('display_name, email').eq('id', userId).maybeSingle();
  if (!data) return null;
  return data.display_name || data.email || 'Guest';
}
async function locName(locationId: string | null): Promise<string | null> {
  if (!locationId) return null;
  const { data } = await supabase.from('locations').select('name, city').eq('id', locationId).maybeSingle();
  if (!data) return null;
  return data.city ? `${data.name}, ${data.city}` : data.name;
}

// Build the who/what/where/when rows for an event. Best-effort: any failure just
// yields no extra rows, so the notification still sends.
async function loadDetails(eventType: string, rowId: string | null): Promise<{ rows: string[][]; orgId: string | null }> {
  const rows: string[][] = [];
  let orgId: string | null = null;
  if (!rowId) return { rows, orgId };
  try {
    if (eventType === 'cup_scanned') {
      const { data: s } = await supabase.from('cup_scans')
        .select('user_id, org_id, location_id, cups_awarded, scan_type, scanned_at').eq('id', rowId).maybeSingle();
      if (s) {
        orgId = s.org_id;
        const who = await nameOf(s.user_id);
        if (who) rows.push(['Customer', who]);
        rows.push(['Cups added', String(s.cups_awarded ?? 1)]);
        if (s.scan_type) rows.push(['How', s.scan_type === 'byo' ? 'Own cup (counter QR)' : String(s.scan_type)]);
        const loc = await locName(s.location_id);
        if (loc) rows.push(['Location', loc]);
        const w = fmtWhen(s.scanned_at); if (w) rows.push(['When', w]);
      }
    } else if (eventType === 'account_created') {
      const { data: u } = await supabase.from('users')
        .select('display_name, email, org_id, device, created_at').eq('id', rowId).maybeSingle();
      if (u) {
        orgId = u.org_id;
        rows.push(['Name', u.display_name || 'New guest']);
        if (u.email) rows.push(['Email', u.email]);
        if (u.device) rows.push(['Device', String(u.device)]);
        const w = fmtWhen(u.created_at); if (w) rows.push(['When', w]);
      }
    } else if (eventType === 'claim_created') {
      const { data: c } = await supabase.from('claims')
        .select('user_id, org_id, type, reward_id, cups_redeemed, payout_amount, created_at').eq('id', rowId).maybeSingle();
      if (c) {
        orgId = c.org_id;
        const who = await nameOf(c.user_id);
        if (who) rows.push(['Customer', who]);
        rows.push(['Type', String(c.type || 'cashback').replace(/_/g, ' ')]);
        if (c.reward_id) rows.push(['Reward', String(c.reward_id)]);
        if (c.cups_redeemed != null) rows.push(['Cups spent', String(c.cups_redeemed)]);
        if (c.payout_amount != null) rows.push(['Cashback', 'EUR ' + Number(c.payout_amount).toFixed(2)]);
        const w = fmtWhen(c.created_at); if (w) rows.push(['When', w]);
      }
    } else if (eventType === 'byo_request') {
      const { data: b } = await supabase.from('byo_cup_requests')
        .select('user_id, org_id, location_id, cups, note, created_at').eq('id', rowId).maybeSingle();
      if (b) {
        orgId = b.org_id;
        const who = await nameOf(b.user_id);
        if (who) rows.push(['Customer', who]);
        if (b.cups != null) rows.push(['Cups requested', String(b.cups)]);
        const loc = await locName(b.location_id);
        if (loc) rows.push(['Location', loc]);
        if (b.note) rows.push(['Note', String(b.note)]);
        const w = fmtWhen(b.created_at); if (w) rows.push(['When', w]);
        rows.push(['Status', 'Awaiting review']);
      }
    } else if (eventType === 'merge_request') {
      const { data: m } = await supabase.from('merge_requests')
        .select('email, absorbed_user_ids, org_id, requested_at').eq('id', rowId).maybeSingle();
      if (m) {
        orgId = m.org_id;
        if (m.email) rows.push(['Email', String(m.email)]);
        if (Array.isArray(m.absorbed_user_ids)) rows.push(['Accounts to merge', String(m.absorbed_user_ids.length + 1)]);
        const w = fmtWhen(m.requested_at); if (w) rows.push(['When', w]);
        rows.push(['Status', 'Awaiting review']);
      }
    }
  } catch (_e) { /* best-effort: send without details */ }
  return { rows, orgId };
}

async function sendBrevo(to: string, subject: string, html: string, text: string) {
  if (!BREVO_API_KEY) return { ok: false, error: 'brevo_not_configured' };
  const resp = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': BREVO_API_KEY, 'content-type': 'application/json', 'accept': 'application/json' },
    body: JSON.stringify({
      sender: { name: BREVO_SENDER_NAME, email: BREVO_SENDER_EMAIL },
      to: [{ email: to }], subject, htmlContent: html, textContent: text, tags: ['notify-event'],
    }),
  });
  return resp.ok ? { ok: true } : { ok: false, error: `brevo_${resp.status}` };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  let body: { event_type?: string; summary?: string; org_id?: string; row_id?: string; mode?: string; to?: string };
  try { body = await req.json(); } catch { body = {}; }
  const isTest = body.mode === 'test';

  // Auth.
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
    const secret = (secRow?.value as { secret?: string } | null)?.secret || '';
    if (!secret || req.headers.get('x-notify-secret') !== secret) return json({ error: 'forbidden' }, 403);
  }

  // Config.
  const { data: cfgRow } = await supabase.from('app_config').select('value').eq('key', 'notification_center').maybeSingle();
  const cfg = (cfgRow?.value || {}) as { enabled?: boolean; recipient?: string; events?: string[]; org_id?: string };
  const recipient = (isTest ? (body.to || cfg.recipient) : cfg.recipient) || '';
  if (!recipient) return json({ error: 'no_recipient' }, 400);

  const eventType = isTest ? 'test' : (body.event_type || 'event');
  const label = isTest ? 'Test notification' : (LABELS[eventType] || eventType);
  const summary = isTest ? 'This is a test of your PackPerks notification center.' : (body.summary || label);
  const icon = ICONS[eventType] || '🔔';

  // Guard against re-sends when the config was toggled off mid-flight.
  if (!isTest) {
    if (!cfg.enabled) return json({ status: 'skipped', reason: 'disabled' });
    if (!Array.isArray(cfg.events) || !cfg.events.includes(eventType)) return json({ status: 'skipped', reason: 'event_off' });
  }

  // Specifics (who / what / where / when).
  const { rows: detailRows, orgId } = isTest ? { rows: [] as string[][], orgId: null } : await loadDetails(eventType, body.row_id || null);
  let orgName = '';
  let orgSlug = '';
  if (orgId) {
    const { data: org } = await supabase.from('organizations').select('name, partner_brand_name, slug').eq('id', orgId).maybeSingle();
    orgName = org?.partner_brand_name || org?.name || '';
    orgSlug = org?.slug || '';
  }

  // CTA: deep-link to the relevant admin page (scoped to the store) so the
  // admin lands where they can act on this exact notification.
  const cta = isTest ? { label: 'Open dashboard', page: 'overview' } : CTA[eventType];
  const ctaUrl = cta
    ? `${ADMIN_URL}${orgSlug ? '?org=' + orgSlug : ''}#${cta.page}${cta.section ? '?section=' + cta.section : ''}`
    : '';

  const rowHtml = detailRows.map((r) =>
    `<tr><td style='padding:7px 0;border-top:1px solid #F0EADD;color:#8B8577;font-size:12.5px;'>${esc(r[0])}</td>` +
    `<td style='padding:7px 0;border-top:1px solid #F0EADD;text-align:right;color:#1D1D1D;font-size:13px;font-weight:600;'>${esc(r[1])}</td></tr>`).join('');
  const detailBlock = detailRows.length
    ? `<div style='margin-top:14px;background:#FBF7F0;border:1px solid #ECE5D8;border-radius:12px;padding:6px 14px;'>` +
      `<table role='presentation' width='100%' cellpadding='0' cellspacing='0'>${rowHtml}</table></div>`
    : '';
  const nowStr = new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC';

  const html =
    `<!doctype html><html><body style='margin:0;background:#F5ECDD;font-family:-apple-system,Segoe UI,Roboto,sans-serif;'>` +
    `<table role='presentation' width='100%' cellpadding='0' cellspacing='0' style='background:#F5ECDD;padding:26px 0;'><tr><td align='center'>` +
    `<table role='presentation' width='520' cellpadding='0' cellspacing='0' style='max-width:520px;width:100%;'>` +
    `<tr><td style='padding:0 16px 14px;'><div style='font-size:18px;font-weight:800;color:#6C4CE0;'>${icon} PackPerks</div></td></tr>` +
    `<tr><td style='background:#fff;border:1px solid #ECE5D8;border-radius:18px;padding:24px;'>` +
    `<div style='font-size:12px;font-weight:700;color:#8B8577;text-transform:uppercase;letter-spacing:.5px;'>Notification${orgName ? ' &middot; ' + esc(orgName) : ''}</div>` +
    `<h1 style='margin:6px 0 8px;font-size:20px;font-weight:800;color:#14100A;'>${icon} ${esc(label)}</h1>` +
    `<p style='margin:0 0 4px;font-size:14.5px;line-height:1.5;color:#5A554F;'>${esc(summary)}</p>` +
    detailBlock +
    (cta ? `<div style='margin-top:18px;'><a href='${ctaUrl}' style='display:inline-block;background:#6C4CE0;color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;padding:11px 22px;border-radius:10px;'>${esc(cta.label)} &rarr;</a></div>` : '') +
    `<div style='margin-top:14px;font-size:12px;color:#A89E92;'>Received ${esc(nowStr)}</div>` +
    `</td></tr>` +
    `<tr><td style='padding:14px;text-align:center;'><p style='margin:0;font-size:11.5px;color:#B4AC9E;'>` +
    `You are receiving this because notifications are on in the PackPerks dashboard. Turn events off under Reports then Notification center.</p></td></tr>` +
    `</table></td></tr></table></body></html>`;
  const NL = String.fromCharCode(10);
  const textLines = detailRows.map((r) => `${r[0]}: ${r[1]}`).join(NL);
  const text = [
    'PackPerks notification',
    `${label}${orgName ? ' (' + orgName + ')' : ''}`,
    '',
    summary,
    ...(textLines ? ['', textLines] : []),
    ...(cta ? ['', `${cta.label}: ${ctaUrl}`] : []),
    '',
    `Received ${nowStr}`,
    '',
  ].join(NL);
  const sent = await sendBrevo(recipient, `PackPerks: ${label}`, html, text);
  if (!sent.ok) return json({ error: sent.error || 'send_failed' }, 502);
  return json({ status: 'sent', to: recipient, event: eventType, details: detailRows.length });
});
