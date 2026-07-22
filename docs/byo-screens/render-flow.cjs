const puppeteer = require('/Users/beka/Downloads/PackPerks Final/node_modules/puppeteer-core');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const HTML = 'file:///Users/beka/Downloads/PackPerks%20Final/docs/byo-screens/_flow.html';
const OUT = '/Users/beka/Downloads/PackPerks Final/docs/byo-screens/_flowchart.png';

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--force-color-profile=srgb', '--allow-file-access-from-files'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1520, height: 1000, deviceScaleFactor: 2 });
  await page.goto(HTML, { waitUntil: 'networkidle0', timeout: 30000 });
  await new Promise((r) => setTimeout(r, 600));
  await page.screenshot({ path: OUT, fullPage: true });
  console.log('flowchart ->', OUT);
  await browser.close();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
