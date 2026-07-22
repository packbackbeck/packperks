const puppeteer = require('/Users/beka/Downloads/PackPerks Final/node_modules/puppeteer-core');
const path = require('path');
const fs = require('fs');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = 'http://localhost:5173/byonl?__shot=';
const OUT = '/Users/beka/Downloads/PackPerks Final/docs/byo-screens';
fs.mkdirSync(OUT, { recursive: true });

// Simple shot-preset screens. `full:true` captures the whole scrollable page
// (store/market pages, so every reward is visible). cup-scan-error and
// success-noemail are intentionally excluded — neither applies to BYO.
const SCREENS = [
  { name: 'loading' },
  { name: 'stores-list', full: true },
  { name: 'cup-scan' },
  { name: 'cup-scan-success' },
  { name: 'byo-popup' },
  { name: 'home-empty', full: true },
  { name: 'home-partial', full: true },
  { name: 'home-full', full: true },
  { name: 'home-member', full: true },
  { name: 'reward-detail' },
  { name: 'terms' },
  { name: 'budget-paused' },
  { name: 'inapp-prompt' },
  { name: 'receipt-rules' },
  { name: 'receipt-camera' },
  { name: 'verifying' },
  { name: 'success' },
  { name: 'rejected' },
  { name: 'user-visitor', full: true },
  { name: 'user-member', full: true },
  { name: 'user-combined', full: true },
  { name: 'signin-idle' },
  { name: 'signin-sent' },
  { name: 'signin-signedin' },
  { name: 'signin-change' },
  { name: 'signin-merge' },
  { name: 'error' },
  { name: 'maintenance' },
];

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--hide-scrollbars', '--force-color-profile=srgb'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 375, height: 812, deviceScaleFactor: 2 });
  // Disable entrance animations so text (e.g. the hero subtitle) is always
  // captured fully rendered, not mid-fade.
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await page.evaluateOnNewDocument(() => {
    try {
      localStorage.setItem('packperks_cookie_prefs', JSON.stringify({ technical: true, marketing: true, analytical: true }));
      localStorage.setItem('packperks_cookie_consent', 'all');
    } catch (e) {}
  });

  for (const s of SCREENS) {
    try {
      await page.goto(BASE + s.name, { waitUntil: 'domcontentloaded', timeout: 20000 });
    } catch (e) { console.log('goto-warn', s.name, e.message); }
    await new Promise((r) => setTimeout(r, 1600));
    await page.screenshot({ path: path.join(OUT, s.name + '.png'), fullPage: !!s.full });
    console.log('shot', s.name, s.full ? '(full)' : '');
  }
  await browser.close();
  console.log('\nDONE', SCREENS.length, 'screens');
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
