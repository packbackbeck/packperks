// PackPerks - send-claim-confirmation Edge Function
//
// Sends the customer a 'we received your cashback request' confirmation the
// moment their claim lands in review (status='pending'), so they know it went
// through and are now waiting on approval. This is the receipt-of-request email;
// the separate approval email fires later when an admin/AI approves it.
//
// The client calls this right after createClaim() when the AI routes the claim
// to human review. The recipient is ALWAYS resolved server-side from the claim's
// own user row - the caller only supplies a claim_id (an unguessable UUID), so it
// can't be used to email an arbitrary address. Guards: the claim must exist, be a
// cashback claim, be pending, be recent, and its user must have an email on file.
//
// Body: { claim_id }
// Auth: none (verify_jwt=false). Safe because the recipient is derived, not passed.

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
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'content-type': 'application/json' } });

// Loose sanity check only - the address comes from our own users table, where
// it was already validated at save time, so we just guard against empties/junk.
const looksLikeEmail = (s: string) => {
  const at = s.indexOf('@');
  return at > 0 && at < s.length - 3 && s.includes('.', at) && !s.includes(' ');
};
const esc = (s: string) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] || c));

// EUR everywhere except UAE venues, which pay out in AED.
function currency(country: string | null): { sym: string; before: boolean } {
  const c = (country || '').toLowerCase();
  if (c.includes('emirat') || c === 'ae' || c === 'uae') return { sym: 'AED ', before: true };
  return { sym: '€', before: true };
}
function money(amount: number, country: string | null): string {
  const cur = currency(country);
  const n = (Number(amount) || 0).toFixed(2);
  return cur.before ? `${cur.sym}${n}` : `${n}${cur.sym}`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  let claimId = '';
  try {
    const b = await req.json();
    claimId = typeof b?.claim_id === 'string' ? b.claim_id : '';
  } catch { return json({ error: 'invalid_json' }, 400); }
  if (!claimId) return json({ error: 'missing_claim_id' }, 400);

  // Resolve the claim server-side.
  const { data: claim } = await supabase
    .from('claims')
    .select('id, user_id, org_id, type, status, payout_amount, cups_redeemed, created_at')
    .eq('id', claimId)
    .maybeSingle();
  if (!claim) return json({ sent: false, reason: 'claim_not_found' });

  // Only confirm cashback claims that are actually waiting for approval, and only
  // for a claim created in the last 30 min (stops replay from re-emailing users).
  if (claim.type !== 'cashback') return json({ sent: false, reason: 'not_cashback' });
  if (claim.status !== 'pending') return json({ sent: false, reason: 'not_pending' });
  const ageMs = Date.now() - new Date(claim.created_at || 0).getTime();
  if (ageMs > 30 * 60 * 1000) return json({ sent: false, reason: 'stale' });

  // Recipient is the claim's own user - never a caller-supplied address.
  const { data: user } = await supabase
    .from('users')
    .select('email, display_name')
    .eq('id', claim.user_id)
    .maybeSingle();
  const email = (user?.email || '').toLowerCase();
  if (!looksLikeEmail(email)) return json({ sent: false, reason: 'no_email' });
  if (!BREVO_API_KEY) return json({ error: 'email_not_configured' }, 503);

  // Org branding for the header.
  let orgName = 'PackPerks';
  let brand = '#1A8737';
  let country: string | null = null;
  if (claim.org_id) {
    const { data: org } = await supabase
      .from('organizations')
      .select('name, partner_brand_name, brand_color, country')
      .eq('id', claim.org_id)
      .maybeSingle();
    if (org) {
      orgName = org.partner_brand_name || org.name || orgName;
      brand = org.brand_color || brand;
      country = org.country || null;
    }
  }

  const firstName = (user?.display_name || '').trim().split(' ')[0] || '';
  const hi = firstName ? `Hi ${esc(firstName)},` : 'Hi there,';
  const amount = money(claim.payout_amount, country);
  const cups = Number(claim.cups_redeemed) || 0;
  const cupsLine = cups > 0 ? `for returning ${cups} cup${cups === 1 ? '' : 's'} ` : '';
  const subject = `We've got your cashback request`;

  // Reliable, always-visible brand mark: an emoji renders in every mail client,
  // whereas a hosted logo <img> is routinely blocked or broken in email. We show
  // the venue's name as text next to a cup glyph rather than relying on the image.
  const logoHtml = `<div style='font-size:16px;font-weight:800;color:#14100A;text-align:center;margin-bottom:14px;'>🥤 ${esc(orgName)}</div>`;

  const html =
    `<!doctype html><html><body style='margin:0;background:#F5ECDD;font-family:-apple-system,Segoe UI,Roboto,sans-serif;'>` +
    `<table width='100%' cellpadding='0' cellspacing='0' style='padding:26px 0;'><tr><td align='center'>` +
    `<table width='520' cellpadding='0' cellspacing='0' style='max-width:520px;width:100%;background:#fff;border:1px solid #ECE5D8;border-radius:18px;overflow:hidden;'>` +
    `<tr><td style='height:5px;background:${esc(brand)};'></td></tr>` +
    `<tr><td style='padding:26px 28px 8px;'>${logoHtml}` +
    `<div style='text-align:center;font-size:12px;font-weight:700;color:${esc(brand)};text-transform:uppercase;letter-spacing:.6px;'>Request received</div>` +
    `<h1 style='margin:6px 0 0;text-align:center;font-size:22px;font-weight:800;color:#14100A;'>Your cashback request has been sent</h1></td></tr>` +
    `<tr><td style='padding:12px 28px 4px;font-size:15px;line-height:1.6;color:#2C2A26;'>` +
    `<p style='margin:0 0 12px;'>${hi}</p>` +
    `<p style='margin:0 0 12px;'>Thanks - we've received your request for <strong>${esc(amount)}</strong> cashback ${cupsLine}and it's now with ${esc(orgName)} for review.</p>` +
    `<p style='margin:0 0 12px;'>You don't need to do anything else. We'll email you the moment it's approved and your payout is on the way.</p>` +
    `</td></tr>` +
    `<tr><td style='padding:6px 28px 26px;'>` +
    `<div style='background:#FBF7F0;border:1px solid #EEE7DA;border-radius:12px;padding:14px 16px;'>` +
    `<table width='100%' cellpadding='0' cellspacing='0'>` +
    `<tr><td style='padding:4px 0;color:#8B8577;font-size:12px;'>Cashback</td><td style='padding:4px 0;text-align:right;color:#1D1D1D;font-size:13px;font-weight:700;'>${esc(amount)}</td></tr>` +
    (cups > 0 ? `<tr><td style='padding:4px 0;color:#8B8577;font-size:12px;'>Cups returned</td><td style='padding:4px 0;text-align:right;color:#1D1D1D;font-size:13px;font-weight:700;'>${cups}</td></tr>` : '') +
    `<tr><td style='padding:4px 0;color:#8B8577;font-size:12px;'>Status</td><td style='padding:4px 0;text-align:right;color:#B7791F;font-size:13px;font-weight:700;'>Awaiting approval</td></tr>` +
    `</table></div></td></tr>` +
    `<tr><td style='padding:0 28px 26px;text-align:center;color:#A89E92;font-size:12px;line-height:1.5;'>` +
    `Sent by PackPerks on behalf of ${esc(orgName)}.<br/>If you didn't make this request, you can ignore this email.</td></tr>` +
    `</table></td></tr></table></body></html>`;

  const NL = String.fromCharCode(10);
  const cupsNote = cups > 0 ? '(for returning ' + cups + ' cup' + (cups === 1 ? '' : 's') + ') ' : '';
  const text = [
    firstName ? 'Hi ' + firstName + ',' : 'Hi there,',
    '',
    `We've received your request for ${amount} cashback ${cupsNote}and it's now with ${orgName} for review.`,
    '',
    `You don't need to do anything else - we'll email you as soon as it's approved.`,
    '',
    'PackPerks',
  ].join(NL);

  const resp = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': BREVO_API_KEY, 'content-type': 'application/json', 'accept': 'application/json' },
    body: JSON.stringify({
      sender: { name: BREVO_SENDER_NAME, email: BREVO_SENDER_EMAIL },
      to: [{ email }],
      subject, htmlContent: html, textContent: text,
      tags: ['claim-confirmation'],
    }),
  });
  if (!resp.ok) return json({ error: `send_failed_${resp.status}` }, 502);

  return json({ sent: true });
});
