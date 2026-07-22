const puppeteer = require('/Users/beka/Downloads/PackPerks Final/node_modules/puppeteer-core');
const path = require('path');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ORIGIN = 'http://localhost:5173';
const OUT = '/Users/beka/Downloads/PackPerks Final/docs/byo-screens';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Click the first <button> whose visible text matches `re`.
async function clickByText(page, re) {
  return page.evaluate((src) => {
    const rx = new RegExp(src, 'i');
    const btn = [...document.querySelectorAll('button')].find((b) => rx.test((b.textContent || '').trim()));
    if (btn) { btn.click(); return true; }
    return false;
  }, re.source);
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--hide-scrollbars', '--force-color-profile=srgb'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 375, height: 812, deviceScaleFactor: 2 });
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await page.evaluateOnNewDocument(() => {
    try {
      localStorage.setItem('packperks_cookie_prefs', JSON.stringify({ technical: true, marketing: true, analytical: true }));
      localStorage.setItem('packperks_cookie_consent', 'all');
      localStorage.removeItem('packperks_onboarding'); // let onboarding auto-show
      localStorage.removeItem('packperks_region');
    } catch (e) {}
  });
  const shot = (name) => page.screenshot({ path: path.join(OUT, name + '.png') });

  // ── stores-map (needs the Map-view toggle) ──
  await page.goto(ORIGIN + '/byonl?__shot=stores-map', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => /map view/i.test(b.textContent || '')), { timeout: 10000 });
  await clickByText(page, /map view/);
  await wait(6000);
  await shot('stores-map');
  console.log('shot stores-map');

  // ── story guide — all 3 steps ──
  await page.goto(ORIGIN + '/byonl?__shot=how-it-works', { waitUntil: 'domcontentloaded' });
  await wait(1400);
  await shot('how-it-works-1'); console.log('shot how-it-works-1');
  await clickByText(page, /^next$/); await wait(900);
  await shot('how-it-works-2'); console.log('shot how-it-works-2');
  await clickByText(page, /^next$/); await wait(900);
  await shot('how-it-works-3'); console.log('shot how-it-works-3');

  // ── edit profile (open the modal from the account page) ──
  await page.goto(ORIGIN + '/byonl?__shot=user-member', { waitUntil: 'domcontentloaded' });
  await wait(1400);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => /edit profile|^edit$/i.test((x.getAttribute('aria-label') || x.textContent || '').trim()));
    if (b) b.click();
  });
  await wait(900);
  await shot('edit-profile'); console.log('shot edit-profile');

  // ── onboarding — value prop → how it works → personalise → processing ──
  await page.goto(ORIGIN + '/byonl', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('.onb-screen'), { timeout: 12000 }).catch(() => {});
  await wait(1000);
  await shot('onboarding-1'); console.log('shot onboarding-1');
  await clickByText(page, /^show me|^next|^continue|earn/); await wait(900);
  await shot('onboarding-2'); console.log('shot onboarding-2');
  await clickByText(page, /^next|^continue|^got it|^start/); await wait(900);
  await shot('onboarding-3'); console.log('shot onboarding-3');
  // Fill required country + city to unlock the CTA, then capture processing.
  await page.evaluate(() => { const c = document.querySelector('.onb-country'); if (c) c.click(); });
  await wait(500);
  await page.evaluate(() => { const c = document.querySelector('.onb-chip--city'); if (c) c.click(); });
  await wait(400);
  await page.evaluate(() => { const b = document.querySelector('.onb-btn--primary:not([disabled])'); if (b) b.click(); });
  await wait(550);
  await shot('onboarding-4'); console.log('shot onboarding-4 (processing)');

  await browser.close();
  console.log('\nDONE extras');
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
