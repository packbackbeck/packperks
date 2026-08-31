/* ─────────────────────────────────────────────────────────────────────
 * Email templates — the automated messages PackPerks sends customers in
 * Redirect Refund mode, and the defaults every one of them falls back to.
 *
 * This file is the single source of truth for the ADMIN side. Each edge
 * function carries the same defaults inline (they deploy independently,
 * so they cannot import from here) — when you change a default here,
 * change it there too. The stored template always wins; the defaults are
 * what a venue gets before anyone edits anything, and what a blank
 * template falls back to.
 *
 * Storage: app_config key `email_templates:<orgId>`:
 *   { <key>: { enabled, subject, html } }
 * ───────────────────────────────────────────────────────────────────── */

export const EMAIL_TEMPLATE_KEY = (orgId) => `email_templates:${orgId}`;

/* Tags are substituted verbatim by the edge function that sends the mail.
 * Anything not listed here is left untouched, so a typo shows up as
 * literal {{text}} in the preview rather than silently vanishing. */
export const EMAIL_TEMPLATES = [
  {
    key: 'refund_ready',
    label: 'Refund ready',
    sentBy: 'bin-mint-batch',
    when: 'The customer left their email on the waiting screen, and the smart bin has now confirmed the receipt. This is the mail that hands them their payout link.',
    canDisable: true,
    disableNote: 'Turn this off and customers who left an email while waiting are never told their refund is ready.',
    tags: [
      { tag: '{{link}}',   desc: 'The customer’s receipt link (opens their payout)', sample: 'https://perks.packback.network/t3/?batch=…' },
      { tag: '{{amount}}', desc: 'Payout amount, formatted (e.g. 0.40)',             sample: '0.40' },
      { tag: '{{cups}}',   desc: 'Cups on the receipt',                              sample: '4' },
      { tag: '{{venue}}',  desc: 'Venue name',                                       sample: 'Unknown Campus' },
    ],
    subject: 'Your refund is ready to collect',
    html:
      `<div style="font:15px/1.6 -apple-system,sans-serif;color:#1F1B16">\n` +
      `  <p>Good news — your cup return has been confirmed.</p>\n` +
      `  <p><a href="{{link}}" style="display:inline-block;padding:12px 22px;background:#1A8737;color:#fff;border-radius:999px;text-decoration:none;font-weight:700">Collect your refund</a></p>\n` +
      `  <p>Amount: <strong>€{{amount}}</strong> for {{cups}} cups.</p>\n` +
      `  <p style="color:#6C6259">{{venue}} · PackPerks</p>\n` +
      `</div>`,
  },
  {
    key: 'login_code',
    label: 'Login code',
    sentBy: 'bin-tikkie',
    when: 'The customer is logging in to their refunds page, or is saving a refund onto an email that already has an account on another device. Always sent — a login cannot complete without it.',
    canDisable: false,
    tags: [
      { tag: '{{code}}',    desc: 'The 6-digit one-time code', sample: '481902' },
      { tag: '{{minutes}}', desc: 'Minutes until it expires',  sample: '10' },
      { tag: '{{venue}}',   desc: 'Venue name',                sample: 'Unknown Campus' },
    ],
    subject: '{{code}} is your PackPerks code',
    html:
      `<div style="font:15px/1.6 -apple-system,sans-serif;color:#1F1B16">\n` +
      `  <p>Your one-time PackPerks code is:</p>\n` +
      `  <p style="font-size:30px;font-weight:800;letter-spacing:0.2em">{{code}}</p>\n` +
      `  <p>It expires in {{minutes}} minutes. If you didn’t request it, you can ignore this email.</p>\n` +
      `  <p style="color:#6C6259">{{venue}} · PackPerks</p>\n` +
      `</div>`,
  },
];

export const templateByKey = (key) => EMAIL_TEMPLATES.find(t => t.key === key) || null;

/* Fill {{tags}} — the exact substitution the edge functions perform, so
 * the dashboard preview is the mail the customer receives. */
export function renderTemplate(text, values) {
  return Object.entries(values).reduce(
    (acc, [k, v]) => acc.replaceAll(`{{${k}}}`, String(v ?? '')),
    String(text || ''),
  );
}

/* Sample values for the preview + test send, taken from each tag's own
 * `sample` so there is only one place to keep them honest. */
export function sampleValues(def) {
  return Object.fromEntries(
    (def?.tags || []).map(t => [t.tag.replace(/[{}]/g, ''), t.sample]),
  );
}

/* Which tags does this body actually use, and does it use any we don't
 * know how to fill? The editor surfaces the second list as a warning. */
export function auditTags(def, text) {
  const known = new Set((def?.tags || []).map(t => t.tag.replace(/[{}]/g, '')));
  const used = [...String(text || '').matchAll(/\{\{\s*([a-z_]+)\s*\}\}/gi)].map(m => m[1]);
  return {
    used: [...new Set(used.filter(u => known.has(u)))],
    unknown: [...new Set(used.filter(u => !known.has(u)))],
  };
}
