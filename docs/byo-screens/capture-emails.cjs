const puppeteer = require('/Users/beka/Downloads/PackPerks Final/node_modules/puppeteer-core');
const path = require('path');
const fs = require('fs');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const REPO = '/Users/beka/Downloads/PackPerks Final';
const TPL = path.join(REPO, 'supabase/email-templates');
const OUT = path.join(REPO, 'docs/byo-screens');

// Supabase Auth template variables → sample values for a realistic preview.
const VARS = {
  '{{ .ConfirmationURL }}': 'https://perks.packback.network/auth/confirm?token=sample',
  '{{ .Token }}': '384021',
  '{{ .NewEmail }}': 'sanne.new@example.com',
};
function fill(html) {
  let out = html;
  for (const [k, v] of Object.entries(VARS)) out = out.split(k).join(v);
  return out;
}

const AUTH = [
  ['confirm-signup', 'email-confirm-signup'],
  ['magic-link', 'email-magic-link'],
  ['reset-password', 'email-reset-password'],
  ['change-email', 'email-change-email'],
  ['reauthentication', 'email-reauthentication'],
  ['invite', 'email-invite'],
];

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--force-color-profile=srgb'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 680, height: 900, deviceScaleFactor: 2 });

  for (const [file, name] of AUTH) {
    const html = fill(fs.readFileSync(path.join(TPL, file + '.html'), 'utf8'));
    await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await new Promise((r) => setTimeout(r, 400));
    await page.screenshot({ path: path.join(OUT, name + '.png'), fullPage: true });
    console.log('shot', name);
  }

  // The cashback / "your Tikkie link is ready" email (JS render fn).
  try {
    const mod = await import('file://' + path.join(REPO, 'src/emails/tikkieReadyEmail.js'));
    const render = mod.render || mod.default;
    const html = render({ name: 'Sanne', reward: 'Cappuccino', amount: '3.20', url: 'https://tikkie.me/pay/sample', cups: 8, expiryDays: 7, orgName: 'La Place' });
    await page.setContent(typeof html === 'string' ? html : (html.html || ''), { waitUntil: 'domcontentloaded', timeout: 15000 });
    await new Promise((r) => setTimeout(r, 400));
    await page.screenshot({ path: path.join(OUT, 'email-cashback-ready.png'), fullPage: true });
    console.log('shot email-cashback-ready');
  } catch (e) {
    console.log('tikkie email render skipped:', e.message);
  }

  await browser.close();
  console.log('DONE emails');
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
