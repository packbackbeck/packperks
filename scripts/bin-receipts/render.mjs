#!/usr/bin/env node
/* ─────────────────────────────────────────────────────────────────────
 * Bin receipts — the artwork a smart bin prints, drawn at the printer's
 * real resolution.
 *
 *   node scripts/bin-receipts/render.mjs kfc
 *
 * Writes docs/bin-receipts/<brand>/:
 *   header.png         the static top of every receipt, 1-bit, 512 dots
 *                      wide. The bin prints it as one raster image.
 *   preview-*.png      the whole receipt as it comes out, one per link in
 *                      the brand's `links`, for people to look at.
 *                      The QR and the text under it are the bin's own
 *                      native printing; here they are drawn to match.
 *
 * Same printer and same layout as the dashboard's Epson receipt
 * (src/admin/lib/eposPrint.js): 512 dots across an 80 mm roll (8 dots per
 * mm), Arial for the drawn header, the printer's own font for the text,
 * and a pixel is black where its luminance is under 170 — the exact
 * threshold eposPrint uses, so what you see here is what prints.
 *
 * Needs Google Chrome (headless) and the repo's node_modules (qrcode,
 * pngjs). Brand copy lives in BRANDS below.
 * ───────────────────────────────────────────────────────────────────── */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';
import { PNG } from 'pngjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const W = 512;

/* The Packback logo, drawn black: thermal paper has one colour. */
function logoDataUrl() {
  const svg = fs.readFileSync(path.join(ROOT, 'src/assets/images/packback-logo.svg'), 'utf8')
    .replace(/#FE6F46/gi, '#000000');
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

const BRANDS = {
  /* The receipt opens the KFC app (the demo at /demo/kfc), so its words are
   * that app's: "Bring cup back, get points", the three steps Return cup →
   * Scan QR → Scan at the kiosk, and "Redeem with points". At KFC a point
   * is a cup (pointsPerCup 1 in src/demo/brands.js). */
  kfc: {
    titleLines: ['GET YOUR', 'FREE REWARD'],
    // Lines as printed: set by hand so no word is left alone on a line.
    lede: ['Bring your cup back,', 'get points in the KFC app.'],
    // icon: 'cup' | 'qr' | 'gift' | 'bars'
    features: [
      { icon: 'cup', lines: ['Return', 'your cup'] },
      { icon: 'qr', lines: ['Scan for', 'points'] },
      { icon: 'gift', lines: ['Redeem at', 'the kiosk'] },
    ],
    cta: 'Scan to get your points',
    assureLines: ['1 cup = 1 point.', 'Redeem with points in the KFC app.'],
    restaurant: 'KFC Amsterdam Centraal',
    // The KFC bin prints only the KFC app receipt (Nov 2026). A brand whose
    // bin registers sessions would add receipt: '…/<slug>/?batch=<uuid>'
    // here, and the footer then gets the session line.
    links: {
      demo: 'https://perks.packback.network/demo/kfc',
    },
  },
};

/* Native-printed parts, in dots. One text line of the printer's Font A is
 * 24 dots tall on a 30-dot pitch; a "feed" is one empty line of 30 dots.
 * The QR is sized to about 42 mm (qrTarget dots), whatever its link. */
const LAYOUT = { qrTarget: 336, qrModuleMax: 12, line: 30, font: 24, cols: 42 };

/* The header's spacing, in dots. Generous on purpose: every block gets
 * room around it, so the receipt reads as a few clear steps. */
const SPACE = {
  top: 28, logoW: 110, afterLogo: 34, afterTitle: 20, afterLede: 40,
  afterBoxes: 52, bottom: 24,
};

function qrMatrix(url) {
  const q = QRCode.create(url, { errorCorrectionLevel: 'M' });
  const n = q.modules.size;
  return { n, bits: Array.from(q.modules.data, b => (b ? 1 : 0)) };
}

function page({ brand, kind }) {
  const b = BRANDS[brand];
  const sample = {
    time: '10 Nov 2026, 12:07',
    session: 'E2A93D7C',
  };
  const footer = [
    ['Time:', sample.time],
    ['Restaurant:', b.restaurant],
    ...(kind === 'receipt' ? [['Session ID:', sample.session]] : []),
  ];
  const data = {
    W, kind, logo: logoDataUrl(), copy: b, layout: LAYOUT, space: SPACE, footer,
    qr: kind === 'header' ? null : qrMatrix(b.links[kind]),
  };
  return `<!doctype html><html><head><meta charset="utf-8">
<style>html,body{margin:0;padding:0;background:#fff}canvas{display:block}</style></head>
<body><canvas id="c"></canvas><script>
const D = ${JSON.stringify(data)};
${drawScript}
</script></body></html>`;
}

/* Runs in the page. The header is a copy of eposPrint.renderHeaderImage
 * with the brand's words and a cup icon; keep the two in step. */
const drawScript = String.raw`
function wrap(ctx, text, max) {
  const out = []; let line = '';
  for (const w of text.split(' ')) {
    const t = line ? line + ' ' + w : w;
    if (ctx.measureText(t).width > max && line) { out.push(line); line = w; } else line = t;
  }
  if (line) out.push(line);
  return out;
}
function rrect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.stroke(); }
function icon(ctx, kind, cx, cy) {
  ctx.save(); ctx.strokeStyle = '#000'; ctx.fillStyle = '#000'; ctx.lineWidth = 2.5;
  if (kind === 'cup') {
    ctx.beginPath();                                   // body, wider at the top
    ctx.moveTo(cx - 15, cy - 8); ctx.lineTo(cx + 15, cy - 8);
    ctx.lineTo(cx + 11, cy + 18); ctx.lineTo(cx - 11, cy + 18); ctx.closePath(); ctx.stroke();
    ctx.strokeRect(cx - 19, cy - 15, 38, 7);           // lid
    ctx.beginPath(); ctx.moveTo(cx - 13.5, cy + 2); ctx.lineTo(cx + 13.5, cy + 2); ctx.stroke(); // sleeve
    ctx.beginPath(); ctx.moveTo(cx + 4, cy - 15); ctx.lineTo(cx + 9, cy - 25); ctx.stroke();     // straw
  } else if (kind === 'qr') {
    // Three finder squares and a few modules, the same 40-dot footprint
    // as the cup and the gift, with strokes heavy enough to survive print.
    ctx.lineWidth = 3.5;
    const f = (x, y) => { ctx.strokeRect(x + 1.75, y + 1.75, 13.5, 13.5); ctx.fillRect(x + 6, y + 6, 5, 5); };
    f(cx - 20, cy - 22); f(cx + 3, cy - 22); f(cx - 20, cy + 1);
    for (const [dx, dy] of [[3, 1], [12, 1], [8, 7], [3, 12], [14, 12]]) ctx.fillRect(cx + dx, cy + dy, 5, 5);
  } else if (kind === 'gift') {
    ctx.strokeRect(cx - 20, cy - 6, 40, 22);
    ctx.beginPath(); ctx.moveTo(cx - 22, cy - 6); ctx.lineTo(cx + 22, cy - 6); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx, cy - 6); ctx.lineTo(cx, cy + 16); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx - 7, cy - 12, 6, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx + 7, cy - 12, 6, 0, Math.PI * 2); ctx.stroke();
  } else {
    ctx.fillRect(cx - 20, cy + 4, 9, 10);
    ctx.fillRect(cx - 5, cy - 4, 9, 18);
    ctx.fillRect(cx + 10, cy - 12, 9, 26);
  }
  ctx.restore();
}
function header(ctx, logo) {
  const W = D.W, c = D.copy, S = D.space;
  ctx.fillStyle = '#000'; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  let y = S.top;
  const lw = S.logoW, lh = Math.round(lw * logo.height / logo.width);
  ctx.drawImage(logo, (W - lw) / 2, y, lw, lh); y += lh + S.afterLogo;
  ctx.font = 'bold 42px Arial, sans-serif';
  for (const ln of c.titleLines) { ctx.fillText(ln, W / 2, y + 38); y += 48; }
  y += S.afterTitle;
  ctx.font = '23px Arial, sans-serif';
  const lede = Array.isArray(c.lede) ? c.lede : wrap(ctx, c.lede, W - 64);
  for (const ln of lede) { ctx.fillText(ln, W / 2, y + 22); y += 32; }
  y += S.afterLede;
  const m = 18, gap = 14, boxW = (W - 2 * m - 2 * gap) / 3, boxH = 128;
  for (let i = 0; i < 3; i++) {
    const x = m + i * (boxW + gap), f = c.features[i];
    ctx.lineWidth = 2; ctx.strokeStyle = '#000'; rrect(ctx, x, y, boxW, boxH, 14);
    icon(ctx, f.icon, x + boxW / 2, y + 38);
    ctx.font = 'bold 19px Arial, sans-serif';
    let ty = y + 82; for (const ln of f.lines) { ctx.fillText(ln, x + boxW / 2, ty); ty += 24; }
  }
  y += boxH + S.afterBoxes;
  ctx.font = 'bold 30px Arial, sans-serif';
  ctx.fillText(c.cta, W / 2, y + 28); y += 40 + S.bottom;
  return y;
}
/* The bin's own printing, drawn to match: the QR, then the text in a 12x24
 * printer font (42 columns). Feeds: 1 line, QR, 2 lines, the two bold
 * lines, 2 lines, rule, footer. */
function native(ctx, y) {
  const L = D.layout, W = D.W;
  y += L.line;                                          // feed 1
  // A short link makes a QR with fewer modules, so it gets bigger ones:
  // every QR lands at about 40-42 mm.
  const q = D.qr, mod = Math.min(L.qrModuleMax, Math.floor(L.qrTarget / q.n));
  const s = q.n * mod, x0 = Math.round((W - s) / 2);
  ctx.fillStyle = '#000';
  for (let r = 0; r < q.n; r++) for (let col = 0; col < q.n; col++)
    if (q.bits[r * q.n + col]) ctx.fillRect(x0 + col * mod, y + r * mod, mod, mod);
  y += s + 2 * L.line;                                  // QR, feed 2
  ctx.font = 'bold 20px Menlo, monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  for (const ln of D.copy.assureLines) { ctx.fillText(ln, W / 2, y + 2); y += L.line; }
  y += 2 * L.line;                                      // feed 2
  ctx.font = '20px Menlo, monospace'; ctx.textAlign = 'left';
  const left = Math.round((W - L.cols * 12) / 2);
  ctx.fillText('-'.repeat(L.cols), left, y + 2); y += L.line;
  for (const [k, v] of D.footer) { ctx.fillText(k.padEnd(15) + v, left, y + 2); y += L.line; }
  return y + 2 * L.line;                                // a little paper before the cut
}
function mono(ctx, w, h) {
  const img = ctx.getImageData(0, 0, w, h), d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    const v = d[i + 3] > 64 && lum < 170 ? 0 : 255;
    d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}
(async () => {
  const logo = new Image(); logo.src = D.logo; await logo.decode();
  const cv = document.getElementById('c'); cv.width = D.W; cv.height = 2000;
  const ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, D.W, 2000);
  let y = header(ctx, logo);
  if (D.kind !== 'header') y = native(ctx, y);
  const h = Math.ceil(y);
  mono(ctx, D.W, h);
  const out = document.createElement('canvas'); out.width = D.W; out.height = h;
  out.getContext('2d').drawImage(cv, 0, 0);
  cv.replaceWith(out); out.id = 'c';
  document.body.setAttribute('data-h', h);
})();
`;

function chrome(args) {
  return execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars',
    '--force-device-scale-factor=1', '--virtual-time-budget=4000', ...args],
    { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
}

/* Snap to pure black and white and to the exact height: a screenshot can
 * carry a stray grey edge pixel, and the printer wants 1 bit a dot. */
function writeMono(src, dst, h) {
  const p = PNG.sync.read(fs.readFileSync(src));
  const out = new PNG({ width: W, height: h, colorType: 0, bitDepth: 8 });
  for (let y = 0; y < h; y++) for (let x = 0; x < W; x++) {
    const i = (y * p.width + x) * 4;
    out.data[(y * W + x) * 4] = p.data[i] < 128 ? 0 : 255;
    out.data[(y * W + x) * 4 + 1] = out.data[(y * W + x) * 4];
    out.data[(y * W + x) * 4 + 2] = out.data[(y * W + x) * 4];
    out.data[(y * W + x) * 4 + 3] = 255;
  }
  fs.writeFileSync(dst, PNG.sync.write(out, { colorType: 0 }));
}

const brand = process.argv[2] || 'kfc';
if (!BRANDS[brand]) { console.error(`Unknown brand ${brand}`); process.exit(1); }
const outDir = path.join(ROOT, 'docs/bin-receipts', brand);
fs.mkdirSync(outDir, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bin-receipt-'));

for (const old of fs.readdirSync(outDir)) {
  if (old.startsWith('preview-')) fs.rmSync(path.join(outDir, old));
}
for (const kind of ['header', ...Object.keys(BRANDS[brand].links)]) {
  const html = path.join(tmp, `${kind}.html`);
  fs.writeFileSync(html, page({ brand, kind }));
  const dom = chrome(['--dump-dom', `file://${html}`]);
  const h = Number((dom.match(/data-h="(\d+)"/) || [])[1]);
  if (!h) throw new Error(`${kind}: the page did not finish drawing`);
  const shot = path.join(tmp, `${kind}.png`);
  chrome([`--screenshot=${shot}`, `--window-size=${W},${h}`, `file://${html}`]);
  const name = kind === 'header' ? 'header.png' : `preview-${kind}.png`;
  writeMono(shot, path.join(outDir, name), h);
  console.log(`${name}  ${W} x ${h} dots  (${(h / 8).toFixed(0)} mm)`);
}
fs.rmSync(tmp, { recursive: true, force: true });
