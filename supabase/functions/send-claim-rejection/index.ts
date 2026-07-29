// PackPerks - send-claim-rejection Edge Function
//
// Emails the customer when their cashback claim is NOT approved, so they learn
// the outcome + the reasons even though they're no longer on the in-app
// rejected screen (a manual reject can land hours or days after they submit).
//
// The client (admin dashboard) calls this right after updateClaimStatus() flips
// a claim to 'failed'. The recipient is ALWAYS resolved server-side from the
// claim's own user row - the caller only supplies a claim_id (an unguessable
// UUID), so it can't be used to email an arbitrary address. Guards: the claim
// must exist, be a cashback claim, be failed, be recent, and its user must have
// an email on file.
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

const looksLikeEmail = (s: string) => {
  const at = s.indexOf('@');
  return at > 0 && at < s.length - 3 && s.includes('.', at) && !s.includes(' ');
};
const esc = (s: string) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] || c));

// Mirror of src/admin/lib/aiVerdictLabels.js FAILURE_INFO — kept inline because
// edge functions can't import the client bundle. {brand} is substituted with
// the org's partner brand name. Keep this list in sync when checks change.
const FAILURE_INFO: Record<string, { title: string; hint: string }> = {
  is_receipt:               { title: "That's not a receipt",           hint: "We couldn't find a printed store receipt in the photo." },
  is_authentic_burger_king: { title: 'Not a valid {brand} receipt',    hint: "We couldn't confirm the brand, menu items, and printed total." },
  contains_required_item:   { title: 'Reward item not on the receipt', hint: 'The receipt has to include the item being claimed.' },
  is_newer_than_cup_return: { title: 'This receipt is too old',        hint: "It's dated before the cups were returned, not after." },
  duplicate_receipt:        { title: 'Receipt already used',           hint: 'Each receipt can only be claimed once.' },
  inappropriate_image:      { title: "Couldn't process this photo",    hint: 'Please upload a clear photo of the printed receipt.' },
};

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
    .select('id, user_id, org_id, type, status, payout_amount, cups_redeemed, created_at, notify_email, ai_failure_checks, admin_failure_checks, approval_note')
    .eq('id', claimId)
    .maybeSingle();
  if (!claim) return json({ sent: false, reason: 'claim_not_found' });

  if (claim.type !== 'cashback') return json({ sent: false, reason: 'not_cashback' });
  if (claim.status !== 'failed')  return json({ sent: false, reason: 'not_failed' });
  if (claim.notify_email === false) return json({ sent: false, reason: 'opted_out' });
  // Guard against replay from very old claims (a legit reject lands within days).
  const ageMs = Date.now() - new Date(claim.created_at || 0).getTime();
  if (ageMs > 90 * 24 * 60 * 60 * 1000) return json({ sent: false, reason: 'stale' });

  // Recipient is the claim's own user - never a caller-supplied address.
  const { data: user } = await supabase
    .from('users')
    .select('email, display_name')
    .eq('id', claim.user_id)
    .maybeSingle();
  const email = (user?.email || '').toLowerCase();
  if (!looksLikeEmail(email)) return json({ sent: false, reason: 'no_email' });
  if (!BREVO_API_KEY) return json({ error: 'email_not_configured' }, 503);

  // Org branding for the header + brand-aware reason copy.
  let orgName = 'PackPerks';
  let brand = '#C0392B';
  let country: string | null = null;
  let partnerBrand = 'the partner';
  if (claim.org_id) {
    const { data: org } = await supabase
      .from('organizations')
      .select('name, partner_brand_name, brand_color, country')
      .eq('id', claim.org_id)
      .maybeSingle();
    if (org) {
      orgName = org.partner_brand_name || org.name || orgName;
      partnerBrand = org.partner_brand_name || org.name || partnerBrand;
      country = org.country || null;
      // Keep the header accent red for a decline regardless of brand colour.
    }
  }

  // Reasons: admin's per-criteria verdict takes priority, else the AI's.
  const codes: string[] = (Array.isArray(claim.admin_failure_checks) && claim.admin_failure_checks.length
    ? claim.admin_failure_checks
    : (claim.ai_failure_checks || [])) as string[];
  const reasons = codes
    .map((c) => FAILURE_INFO[c])
    .filter(Boolean)
    .map((r) => ({ title: r!.title.replaceAll('{brand}', partnerBrand), hint: r!.hint.replaceAll('{brand}', partnerBrand) }));

  const firstName = (user?.display_name || '').trim().split(' ')[0] || '';
  const hi = firstName ? `Hi ${esc(firstName)},` : 'Hi there,';
  const amount = money(claim.payout_amount, country);
  const subject = `Update on your cashback request`;
  const note = (claim.approval_note || '').trim();

  const logoHtml = `<div style='font-size:16px;font-weight:800;color:#14100A;text-align:center;margin-bottom:14px;'>🥤 ${esc(orgName)}</div>`;

  const reasonsHtml = reasons.length
    ? `<div style='background:#FFF4F0;border:1px solid #F6D9CE;border-radius:12px;padding:14px 16px;margin-top:4px;'>` +
      `<div style='font-size:11px;font-weight:800;letter-spacing:.5px;text-transform:uppercase;color:#C0392B;margin-bottom:8px;'>Why it wasn't approved</div>` +
      reasons.map((r) =>
        `<div style='padding:6px 0;border-top:1px solid #F6D9CE;'>` +
        `<div style='font-size:13px;font-weight:700;color:#1D1D1D;'>${esc(r.title)}</div>` +
        `<div style='font-size:12px;color:#6B4A42;line-height:1.5;'>${esc(r.hint)}</div></div>`
      ).join('') +
      `</div>`
    : '';

  const noteHtml = note
    ? `<div style='background:#FBF7F0;border:1px solid #EEE7DA;border-radius:12px;padding:12px 16px;margin-top:10px;'>` +
      `<div style='font-size:11px;font-weight:800;letter-spacing:.5px;text-transform:uppercase;color:#8B8577;margin-bottom:4px;'>A note from ${esc(orgName)}</div>` +
      `<div style='font-size:13px;color:#2C2A26;line-height:1.5;'>${esc(note)}</div></div>`
    : '';

  const html =
    `<!doctype html><html><body style='margin:0;background:#F5ECDD;font-family:-apple-system,Segoe UI,Roboto,sans-serif;'>` +
    `<table width='100%' cellpadding='0' cellspacing='0' style='padding:26px 0;'><tr><td align='center'>` +
    `<table width='520' cellpadding='0' cellspacing='0' style='max-width:520px;width:100%;background:#fff;border:1px solid #ECE5D8;border-radius:18px;overflow:hidden;'>` +
    `<tr><td style='height:5px;background:${esc(brand)};'></td></tr>` +
    `<tr><td style='padding:26px 28px 8px;'>${logoHtml}` +
    `<div style='text-align:center;font-size:12px;font-weight:700;color:${esc(brand)};text-transform:uppercase;letter-spacing:.6px;'>Cashback update</div>` +
    `<h1 style='margin:6px 0 0;text-align:center;font-size:22px;font-weight:800;color:#14100A;'>Your cashback request wasn't approved</h1></td></tr>` +
    `<tr><td style='padding:12px 28px 4px;font-size:15px;line-height:1.6;color:#2C2A26;'>` +
    `<p style='margin:0 0 12px;'>${hi}</p>` +
    `<p style='margin:0 0 12px;'>We reviewed your request for <strong>${esc(amount)}</strong> cashback, and unfortunately it didn't pass this time. Your cups are safe and still on your balance.</p>` +
    `</td></tr>` +
    `<tr><td style='padding:2px 28px 6px;'>${reasonsHtml}${noteHtml}</td></tr>` +
    `<tr><td style='padding:8px 28px 26px;font-size:14px;line-height:1.6;color:#2C2A26;'>` +
    `<p style='margin:0;'>You're welcome to try again with a clear photo of the full printed receipt. If you think this was a mistake, just reply to this email and we'll take another look.</p></td></tr>` +
    `<tr><td style='padding:0 28px 26px;text-align:center;color:#A89E92;font-size:12px;line-height:1.5;'>` +
    `Sent by PackPerks on behalf of ${esc(orgName)}.<br/>If you didn't make this request, you can ignore this email.</td></tr>` +
    `</table></td></tr></table></body></html>`;

  const NL = String.fromCharCode(10);
  const text = [
    firstName ? 'Hi ' + firstName + ',' : 'Hi there,',
    '',
    `We reviewed your request for ${amount} cashback and unfortunately it wasn't approved this time. Your cups are safe and still on your balance.`,
    ...(reasons.length ? ['', 'Why it wasn\'t approved:', ...reasons.map((r) => `- ${r.title}: ${r.hint}`)] : []),
    ...(note ? ['', `A note from ${orgName}: ${note}`] : []),
    '',
    "You're welcome to try again with a clear photo of the full printed receipt. If you think this was a mistake, reply to this email and we'll take another look.",
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
      tags: ['claim-rejection'],
    }),
  });
  if (!resp.ok) return json({ error: `send_failed_${resp.status}` }, 502);

  return json({ sent: true });
});
