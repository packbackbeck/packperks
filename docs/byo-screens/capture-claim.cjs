const puppeteer = require('/Users/beka/Downloads/PackPerks Final/node_modules/puppeteer-core');
const path = require('path');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = '/Users/beka/Downloads/PackPerks Final/docs/byo-screens';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Standalone re-capture of shot #4: clicking "Get cashback" without enough cups
// opens the how-it-works guide; closing it reveals the cup-progress-bar nudge.
(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--hide-scrollbars', '--force-color-profile=srgb'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 375, height: 812, deviceScaleFactor: 2 });
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await page.evaluateOnNewDocument(() => { try { localStorage.setItem('packperks_cookie_prefs', JSON.stringify({ technical: true, marketing: true, analytical: true })); localStorage.setItem('packperks_cookie_consent', 'all'); localStorage.setItem('packperks_onboarding', JSON.stringify({ completedAt: 1 })); } catch (e) {} });

  await page.goto('http://localhost:5173/byonl?__shot=home-partial', { waitUntil: 'domcontentloaded' });
  await wait(1400);
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => /get .*cashback/i.test(((x.getAttribute('aria-label') || '') + ' ' + (x.textContent || '')))); if (b) b.click(); });
  await wait(800);
  await page.evaluate(() => { const c = [...document.querySelectorAll('button')].find((b) => /close/i.test(b.getAttribute('aria-label') || '')); if (c) c.click(); });
  await wait(1100);
  await page.evaluate(() => window.scrollTo(0, 0));
  await wait(700);
  await page.screenshot({ path: path.join(OUT, 'claim-locked-progress.png') });
  console.log('shot claim-locked-progress');
  await browser.close();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
