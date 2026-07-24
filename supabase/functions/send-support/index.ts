// PackPerks - send-support Edge Function
//
// Public contact form (customer + vendor). Emails info@packback.network with a
// subject that starts with the audience tag + topic, e.g. 'USER Complaint' or
// 'VENDOR Suggestion', and sets reply-to to the submitter so the team can reply
// directly. No auth (public form) - basic validation + a honeypot guard.
//
// Body: { audience: 'user' | 'vendor', topic, email, message, company?, hp? }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } },
);
const BREVO_API_KEY      = Deno.env.get('BREVO_API_KEY') ?? '';
const BREVO_SENDER_NAME  = Deno.env.get('BREVO_SENDER_NAME') ?? 'PackPerks';
const BREVO_SENDER_EMAIL = Deno.env.get('BREVO_SENDER_EMAIL') ?? 'info@packback.network';
const SUPPORT_INBOX = 'info@packback.network';

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'content-type': 'application/json' } });

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const esc = (s: string) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] || c));
const clean = (s: unknown, max: number) => (typeof s === 'string' ? s.trim().slice(0, max) : '');

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  let body: { audience?: string; topic?: string; email?: string; message?: string; company?: string; hp?: string };
  try { body = await req.json(); } catch { return json({ error: 'invalid_json' }, 400); }

  // Honeypot: real users never fill this hidden field.
  if (clean(body.hp, 50)) return json({ status: 'sent' });

  const audience = body.audience === 'vendor' ? 'vendor' : 'user';
  const topic = clean(body.topic, 40) || 'Message';
  const email = clean(body.email, 200).toLowerCase();
  const message = clean(body.message, 4000);
  const company = clean(body.company, 200);

  if (!EMAIL_RE.test(email)) return json({ error: 'invalid_email' }, 400);
  if (message.length < 3) return json({ error: 'message_too_short' }, 400);
  if (!BREVO_API_KEY) return json({ error: 'email_not_configured' }, 503);

  const tag = audience === 'vendor' ? 'VENDOR' : 'USER';
  const snippet = message.replace(/\s+/g, ' ').slice(0, 60);
  const subject = `${tag} ${topic} - ${snippet}${message.length > 60 ? '...' : ''}`;

  const rows = [
    ['From', audience === 'vendor' ? 'Vendor' : 'Customer'],
    company ? ['Company', company] : null,
    ['Topic', topic],
    ['Email', email],
  ].filter(Boolean) as string[][];
  const rowHtml = rows.map((r) =>
    `<tr><td style='padding:5px 10px;color:#8B8577;font-size:12px;'>${esc(r[0])}</td>` +
    `<td style='padding:5px 10px;color:#1D1D1D;font-size:13px;font-weight:600;'>${esc(r[1])}</td></tr>`).join('');
  const html =
    `<!doctype html><html><body style='margin:0;background:#F5ECDD;font-family:-apple-system,Segoe UI,Roboto,sans-serif;'>` +
    `<table width='100%' cellpadding='0' cellspacing='0' style='padding:24px 0;'><tr><td align='center'>` +
    `<table width='560' cellpadding='0' cellspacing='0' style='max-width:560px;width:100%;background:#fff;border:1px solid #ECE5D8;border-radius:16px;'>` +
    `<tr><td style='padding:22px 22px 6px;'><div style='font-size:12px;font-weight:700;color:#6C4CE0;text-transform:uppercase;letter-spacing:.5px;'>${esc(tag)} support</div>` +
    `<h1 style='margin:4px 0 0;font-size:20px;font-weight:800;color:#14100A;'>${esc(topic)}</h1></td></tr>` +
    `<tr><td style='padding:8px 12px;'><table width='100%' cellpadding='0' cellspacing='0'>${rowHtml}</table></td></tr>` +
    `<tr><td style='padding:12px 22px 22px;'><div style='background:#FBF7F0;border:1px solid #EEE7DA;border-radius:12px;padding:14px 16px;font-size:14px;line-height:1.55;color:#2C2A26;white-space:pre-wrap;'>${esc(message)}</div></td></tr>` +
    `</table></td></tr></table></body></html>`;
  const text = `${tag} ${topic}\nFrom: ${email}${company ? `\nCompany: ${company}` : ''}\n\n${message}\n`;

  const resp = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': BREVO_API_KEY, 'content-type': 'application/json', 'accept': 'application/json' },
    body: JSON.stringify({
      sender: { name: BREVO_SENDER_NAME, email: BREVO_SENDER_EMAIL },
      to: [{ email: SUPPORT_INBOX }],
      replyTo: { email },
      subject, htmlContent: html, textContent: text,
      tags: ['support', audience],
    }),
  });
  if (!resp.ok) return json({ error: `send_failed_${resp.status}` }, 502);

  // Best-effort log so support submissions are auditable.
  try {
    await supabase.from('admin_action_log').insert({
      action: 'support.message', target_type: 'support', actor_email: email,
      after_state: { audience, topic, company, length: message.length },
    });
  } catch { /* logging best-effort */ }

  return json({ status: 'sent' });
});
