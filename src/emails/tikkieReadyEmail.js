/* ─────────────────────────────────────────────────────────────────────
 * Tikkie-ready cashback email — PackPerks-branded layout.
 *
 * This is the message a customer receives once an admin approves their
 * receipt and a Tikkie cashback link is minted. It's a pure render
 * function returning { subject, html, text } — NO sending happens here.
 * The sender edge function (Brevo — SMTP relay or transactional API) imports
 * this and ships the result, honouring the claim's notify_email preference.
 *
 * Email-client constraints shaped every choice below:
 *   • Table-based layout + inline styles (Gmail/Outlook strip <style> and
 *     fl/grid). No external CSS, no web fonts that must download — DM Sans
 *     is named first but every client falls back to a system sans.
 *   • A "bulletproof" button: a padded <a> inside a rounded table cell, so
 *     it renders as a solid block even where CSS border-radius is dropped.
 *   • 600px max width, centered, cream page + white card to mirror the app.
 *   • All interpolated values are HTML-escaped (esc) to avoid breaking the
 *     markup or injecting markup via a reward/display name.
 * ───────────────────────────────────────────────────────────────────── */

const BRAND = {
  cream:     '#F4EBDC',
  card:      '#FFFFFF',
  ink:       '#1D1D1D',
  muted:     '#7A7166',
  hairline:  '#EDE6D9',
  orange:    '#E24400', // primary CTA
  green:     '#1A8737',
  tileBg:    '#FEA01E',
  font:      "'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  supportEmail: 'info@packback.network',
};

/** Minimal HTML-entity escape for interpolated user/reward strings. */
function esc(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Format a euro amount: number | numeric string → "€4.50" (or "" if none). */
function euros(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) return '';
  return '€' + n.toFixed(2);
}

/**
 * Render the Tikkie-ready cashback email.
 *
 * @param {object}  p
 * @param {string}  [p.name]        Customer's display name (greeting).
 * @param {string}  p.reward        Reward the customer redeemed.
 * @param {number|string} [p.amount] Cashback amount in euros.
 * @param {string}  p.url           The Tikkie link (dummy in Phase 1).
 * @param {number}  [p.cups]        Cups redeemed (shown in the summary).
 * @param {number}  [p.expiryDays]  Link validity window (default 7).
 * @param {string}  [p.orgName]     Store/brand the claim was made at.
 * @returns {{ subject: string, html: string, text: string }}
 */
export function render({ name, reward, amount, url, cups, expiryDays = 7, orgName } = {}) {
  const amountStr  = euros(amount);
  const rewardStr  = esc(reward || 'your reward');
  const greeting   = name ? `Hi ${esc(name)},` : 'Hi there,';
  const safeUrl    = esc(url || '#');
  const amountLine = amountStr ? `${amountStr} cashback` : 'Your cashback';
  const subject    = amountStr
    ? `Your ${amountStr} PackPerks cashback is ready 🎉`
    : `Your PackPerks cashback is ready 🎉`;

  // ── Receipt-style summary rows (reward / amount / cups / store) ──────
  const rows = [
    ['Reward', rewardStr],
    amountStr ? ['Cashback', amountStr] : null,
    (cups != null) ? ['Cups redeemed', esc(cups)] : null,
    orgName ? ['Store', esc(orgName)] : null,
  ].filter(Boolean).map(([label, value], i) => `
        <tr>
          <td style="padding:${i === 0 ? '0' : '10px'} 0 10px 0; border-top:${i === 0 ? 'none' : `1px solid ${BRAND.hairline}`}; font-family:${BRAND.font}; font-size:14px; color:${BRAND.muted};">${label}</td>
          <td align="right" style="padding:${i === 0 ? '0' : '10px'} 0 10px 0; border-top:${i === 0 ? 'none' : `1px solid ${BRAND.hairline}`}; font-family:${BRAND.font}; font-size:14px; font-weight:700; color:${BRAND.ink};">${value}</td>
        </tr>`).join('');

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>${esc(subject)}</title>
</head>
<body style="margin:0; padding:0; background:${BRAND.cream}; -webkit-text-size-adjust:100%;">
  <!-- Preheader (hidden preview text) -->
  <div style="display:none; max-height:0; overflow:hidden; opacity:0; color:transparent;">
    Tap to collect ${amountStr ? amountStr + ' ' : ''}cashback for ${rewardStr} via Tikkie.
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.cream};">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%; max-width:600px;">

          <!-- Brand -->
          <tr>
            <td align="center" style="padding:4px 0 22px 0;">
              <span style="font-family:${BRAND.font}; font-size:22px; font-weight:800; letter-spacing:-0.4px; color:${BRAND.ink};">PackPerks</span>
            </td>
          </tr>

          <!-- Card -->
          <tr>
            <td style="background:${BRAND.card}; border-radius:18px; padding:32px 28px;">

              <p style="margin:0 0 6px 0; font-family:${BRAND.font}; font-size:15px; color:${BRAND.ink};">${greeting}</p>
              <h1 style="margin:0 0 8px 0; font-family:${BRAND.font}; font-size:24px; line-height:1.25; font-weight:800; color:${BRAND.ink};">
                ${amountLine} is ready to collect
              </h1>
              <p style="margin:0 0 24px 0; font-family:${BRAND.font}; font-size:15px; line-height:1.5; color:${BRAND.muted};">
                We checked your receipt and approved it. Tap the button below to collect your cashback through Tikkie — it lands straight in your bank account.
              </p>

              <!-- Summary card -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FBF7EF; border:1px solid ${BRAND.hairline}; border-radius:14px; padding:18px 18px 8px 18px; margin:0 0 26px 0;">
                <tr><td style="padding:0 18px;">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                    ${rows}
                  </table>
                </td></tr>
              </table>

              <!-- Bulletproof CTA button -->
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td align="center">
                    <table role="presentation" cellpadding="0" cellspacing="0">
                      <tr>
                        <td align="center" bgcolor="${BRAND.orange}" style="border-radius:14px;">
                          <a href="${safeUrl}" target="_blank" rel="noopener noreferrer"
                             style="display:inline-block; padding:16px 40px; font-family:${BRAND.font}; font-size:16px; font-weight:800; color:#FFFFFF; text-decoration:none; border-radius:14px;">
                            Collect ${amountStr || 'your'} cashback
                          </a>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <p style="margin:20px 0 0 0; font-family:${BRAND.font}; font-size:13px; line-height:1.5; color:${BRAND.muted}; text-align:center;">
                Opens in Tikkie · collect within ${esc(expiryDays)} days.
              </p>

              <!-- Fallback link -->
              <p style="margin:14px 0 0 0; font-family:${BRAND.font}; font-size:12px; line-height:1.5; color:${BRAND.muted}; text-align:center;">
                Button not working? Copy this link:<br>
                <a href="${safeUrl}" target="_blank" rel="noopener noreferrer" style="color:${BRAND.orange}; word-break:break-all;">${safeUrl}</a>
              </p>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:22px 12px 8px 12px;" align="center">
              <p style="margin:0 0 6px 0; font-family:${BRAND.font}; font-size:12px; line-height:1.6; color:${BRAND.muted};">
                You're receiving this because you asked us to email you when your cashback is ready.
              </p>
              <p style="margin:0; font-family:${BRAND.font}; font-size:12px; line-height:1.6; color:${BRAND.muted};">
                Questions? <a href="mailto:${BRAND.supportEmail}" style="color:${BRAND.muted};">${BRAND.supportEmail}</a> · PackPerks
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  // Plain-text alternative (deliverability + accessibility).
  const text = [
    greeting.replace(/<[^>]+>/g, ''),
    '',
    `${amountLine} is ready to collect.`,
    'We checked your receipt and approved it.',
    '',
    `Reward: ${reward || 'your reward'}`,
    amountStr ? `Cashback: ${amountStr}` : null,
    (cups != null) ? `Cups redeemed: ${cups}` : null,
    orgName ? `Store: ${orgName}` : null,
    '',
    'Collect your cashback via Tikkie:',
    url || '',
    '',
    `Opens in Tikkie · collect within ${expiryDays} days.`,
    '',
    `Questions? ${BRAND.supportEmail} · PackPerks`,
  ].filter(v => v !== null).join('\n');

  return { subject, html, text };
}

export default render;
