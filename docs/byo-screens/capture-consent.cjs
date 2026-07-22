const puppeteer = require('/Users/beka/Downloads/PackPerks Final/node_modules/puppeteer-core');
const path = require('path');
const OUT = '/Users/beka/Downloads/PackPerks Final/docs/byo-screens';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--hide-scrollbars', '--force-color-profile=srgb'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 375, height: 812, deviceScaleFactor: 2 });
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  // NB: do NOT pre-set consent — we want the banner to appear.
  await page.evaluateOnNewDocument(() => { try { localStorage.removeItem('packperks_cookie_consent'); localStorage.removeItem('packperks_cookie_prefs'); localStorage.setItem('packperks_onboarding', JSON.stringify({ completedAt: 1 })); } catch (e) {} });
  const shot = (n) => page.screenshot({ path: path.join(OUT, n + '.png') });
  const clickText = (re) => page.evaluate((s) => { const rx = new RegExp(s, 'i'); const b = [...document.querySelectorAll('button')].find((x) => rx.test((x.textContent || '').trim())); if (b) b.click(); }, re.source);

  await page.goto('http://localhost:5173/byonl', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.cc-sheet', { timeout: 10000 });
  await wait(700);
  await shot('consent-main'); console.log('shot consent-main');

  // Customize → the granular toggles.
  await clickText(/^customize$/);
  await wait(600);
  await shot('consent-customize'); console.log('shot consent-customize');

  // Reject → turn Technical (essential) off, Save → the blocked screen.
  await page.evaluate(() => { const t = document.getElementById('cc-technical'); if (t && t.checked) t.click(); });
  await wait(300);
  await clickText(/^save$/);
  await page.waitForSelector('.cc-blocked', { timeout: 6000 }).catch(() => {});
  await wait(500);
  await shot('consent-reject'); console.log('shot consent-reject');

  await browser.close();
  console.log('DONE consent');
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
