const puppeteer = require('/Users/beka/Downloads/PackPerks Final/node_modules/puppeteer-core');
const path = require('path');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = '/Users/beka/Downloads/PackPerks Final/docs/byo-screens';

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--hide-scrollbars', '--force-color-profile=srgb'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 375, height: 812, deviceScaleFactor: 2 });
  await page.evaluateOnNewDocument(() => {
    try {
      localStorage.setItem('packperks_cookie_prefs', JSON.stringify({ technical: true, marketing: true, analytical: true }));
      localStorage.setItem('packperks_cookie_consent', 'all');
    } catch (e) {}
  });
  await page.goto('http://localhost:5173/byonl?__shot=stores-map', { waitUntil: 'domcontentloaded', timeout: 20000 });
  // Wait until the "Map view" toggle exists, then click it.
  await page.waitForFunction(
    () => [...document.querySelectorAll('button')].some((b) => /map view/i.test(b.textContent || '')),
    { timeout: 10000 },
  );
  const clicked = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => /map view/i.test(b.textContent || ''));
    if (btn) { btn.click(); return true; }
    return false;
  });
  console.log('map-view clicked:', clicked);
  await new Promise((r) => setTimeout(r, 6000)); // let tiles + pins load
  await page.screenshot({ path: path.join(OUT, 'stores-map.png') });
  console.log('shot stores-map');
  await browser.close();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
