const puppeteer = require('/Users/beka/Downloads/PackPerks Final/node_modules/puppeteer-core');
const path = require('path');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ORIGIN = 'http://localhost:5173';
const OUT = '/Users/beka/Downloads/PackPerks Final/docs/byo-screens';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--hide-scrollbars', '--force-color-profile=srgb'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 375, height: 812, deviceScaleFactor: 2 });
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await page.evaluateOnNewDocument(() => {
    try {
      localStorage.setItem('packperks_cookie_prefs', JSON.stringify({ technical: true, marketing: true, analytical: true }));
      localStorage.setItem('packperks_cookie_consent', 'all');
      localStorage.setItem('packperks_onboarding', JSON.stringify({ completedAt: 1 }));
    } catch (e) {}
  });
  const shot = (n) => page.screenshot({ path: path.join(OUT, n + '.png') }); // viewport crop (user view)
  const go = (s) => page.goto(ORIGIN + '/byonl?__shot=' + s, { waitUntil: 'domcontentloaded' });
  const clickText = (re) => page.evaluate((s) => { const rx = new RegExp(s, 'i'); const b = [...document.querySelectorAll('button')].find((x) => rx.test(((x.getAttribute('aria-label') || '') + ' ' + (x.textContent || '')).trim())); if (b) { b.click(); return true; } return false; }, re.source);

  // 1 — market: default list of vendors
  await go('stores-list'); await wait(1500); await shot('market-vendors'); console.log('shot market-vendors');

  // 2 — market: list + the pending-claim box
  await go('stores-claim'); await wait(1600); await shot('market-vendors-claim'); console.log('shot market-vendors-claim');

  // 3 — market: search a vendor that doesn't exist → request box
  await go('stores-list'); await wait(1200);
  await page.evaluate(() => {
    const inp = document.querySelector('.stores2__search input, input[placeholder="Search"], input[type="text"]');
    if (inp) { const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; set.call(inp, 'Nonexistent Café'); inp.dispatchEvent(new Event('input', { bubbles: true })); }
  });
  await wait(900); await shot('market-search-request'); console.log('shot market-search-request');

  // 4 — click "Get cashback" without enough cups → cup-progress circles nudge
  await go('home-partial'); await wait(1400);
  await clickText(/get .*cashback/);
  await wait(900);
  await page.evaluate(() => window.scrollTo(0, 0));
  await wait(500); await shot('claim-locked-progress'); console.log('shot claim-locked-progress');

  // 5 — privacy statement screen (opened from the account page)
  await go('user-member'); await wait(1400);
  await clickText(/privacy.*cookie|privacy & cookie/);
  await wait(900); await shot('privacy-statement'); console.log('shot privacy-statement');

  // 6 — take a photo of your store receipt (camera step)
  await go('receipt-camera'); await wait(1600); await shot('receipt-photo'); console.log('shot receipt-photo');

  await browser.close();
  console.log('DONE market');
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
