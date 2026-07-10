// PackPerks customer-app screenshot audit — DEV ONLY, not shipped.
// Drives the local Vite dev server (localhost:5173) with the ?__shot=<preset>
// harness (added to App.jsx behind import.meta.env.DEV) to force each screen +
// state deterministically, and saves a named PNG per screen into this folder.
//
// Run:  node screen-audit/_capture.mjs
// Needs: the dev server running on :5173 and puppeteer-core (installed --no-save).
import puppeteer from 'puppeteer-core'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
// Override with SHOT_BASE if the dev server binds IPv6-only (e.g. http://[::1]:5173)
// and headless Chrome can't reach "localhost" over IPv4.
const BASE = process.env.SHOT_BASE || 'http://localhost:5173'

// iPhone-ish viewport (retina) so the screenshots look like a real phone.
const VIEW = { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }

// Each entry: { name, shot, full? , path? }
//   shot  → ?__shot=<shot> preset understood by the App.jsx harness
//   full  → capture the whole scrollable page (default: just the viewport)
//   path  → override the URL path (defaults to '/')
// Filled from the code inventory below.
import { MANIFEST } from './_manifest.mjs'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Optional name filter: `SHOT_ONLY=guide node screen-audit/_capture.mjs` captures
// only manifest entries whose name contains "guide" (leaves the rest untouched).
const ONLY = process.env.SHOT_ONLY
const items = ONLY ? MANIFEST.filter((m) => m.name.includes(ONLY)) : MANIFEST

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--force-color-profile=srgb', '--hide-scrollbars'],
})

let ok = 0
try {
  for (const item of items) {
    const page = await browser.newPage()
    await page.setViewport(VIEW)
    // Pre-seed cookie consent so the banner only shows on the cookie shot.
    if (item.consent !== false) {
      await page.evaluateOnNewDocument(() => {
        try { localStorage.setItem('packperks_cookie_consent', 'all') } catch { /* private mode */ }
      })
    }
    const path = item.path ?? '/'
    const url = `${BASE}${path}${path.includes('?') ? '&' : '?'}__shot=${encodeURIComponent(item.shot)}`
    try {
      await page.goto(url, { waitUntil: 'networkidle0', timeout: 20000 })
    } catch {
      // networkidle can hang on dev HMR sockets; fall back to domcontentloaded.
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {})
    }
    await sleep(item.settle ?? 1100) // let fonts, images, animations settle
    // Optionally advance the UI (e.g. rules → camera) before shooting.
    if (item.clickText) {
      await page.evaluate((text) => {
        const el = [...document.querySelectorAll('button, [role="button"]')]
          .find((b) => (b.textContent || '').trim().includes(text))
        if (el) el.click()
      }, item.clickText)
      await sleep(900)
    }
    // Advance a Stories-style guide N steps (taps "Next" / .hiw__cta), stopping
    // auto-play so the target step is captured deterministically.
    if (item.advance) {
      for (let i = 0; i < item.advance; i++) {
        await page.evaluate(() => {
          const el = document.querySelector('.hiw__cta')
            || [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === 'Next')
          if (el) el.click()
        })
        await sleep(450)
      }
      await sleep(500)
    }
    const file = join(__dirname, `${item.name}.png`)
    await page.screenshot({ path: file, fullPage: !!item.full })
    console.log(`✓ ${item.name}`)
    ok++
    await page.close()
  }
} finally {
  await browser.close()
}
console.log(`\nDone — ${ok}/${items.length} screens captured into screen-audit/`)
