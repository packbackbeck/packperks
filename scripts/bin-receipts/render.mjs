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
 *   preview-*.png      the whole receipt as it comes out, one per kind
 *                      (receipt, offline, demo), for people to look at.
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
  kfc: {
    titleLines: ['GET YOUR', 'FREE REWARD'],
    lede: 'Collect your returned cups with Packback and unlock free KFC rewards.',
    // icon: 'cup' | 'gift' | 'bars'
    features: [
      { icon: 'cup', lines: ['Collect your', 'cups'] },
      { icon: 'gift', lines: ['Unlock free', 'rewards'] },
      { icon: 'bars', lines: ['Keep track of', 'your progress'] },
    ],
    cta: 'Scan to collect with Packback',
    assureLines: ['No app and no registration needed.', 'Fast and secure.'],
    restaurant: 'KFC Amsterdam Centraal',
    links: {
      receipt: 'https://perks.packback.network/kfc/?batch=e2a93d7c-7207-4d81-b0dc-d3c1da8c1c14',
      offline: 'https://perks.packback.network/kfc/?byo=1',
      demo: 'https://perks.packback.network/demo/kfc',
    },
  },
};

/* Native-printed parts, in dots. One text line of the printer's Font A is
 * 24 dots tall on a 30-dot pitch; a "feed" is one empty line of 30 dots. */
const LAYOUT = { qrModule: 6, line: 30, font: 24, cols: 42 };

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
    W, kind, logo: logoDataUrl(), copy: b, layout: LAYOUT, footer,
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
  const W = D.W, c = D.copy;
  ctx.fillStyle = '#000'; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  let y = 18;
  const lw = 220, lh = Math.round(lw * logo.height / logo.width);
  ctx.drawImage(logo, (W - lw) / 2, y, lw, lh); y += lh + 22;
  ctx.font = 'bold 42px Arial, sans-serif';
  for (const ln of c.titleLines) { ctx.fillText(ln, W / 2, y + 38); y += 48; }
  y += 12;
  ctx.font = '23px Arial, sans-serif';
  for (const ln of wrap(ctx, c.lede, W - 64)) { ctx.fillText(ln, W / 2, y + 22); y += 32; }
  y += 22;
  const m = 18, gap = 14, boxW = (W - 2 * m - 2 * gap) / 3, boxH = 128;
  for (let i = 0; i < 3; i++) {
    const x = m + i * (boxW + gap), f = c.features[i];
    ctx.lineWidth = 2; ctx.strokeStyle = '#000'; rrect(ctx, x, y, boxW, boxH, 14);
    icon(ctx, f.icon, x + boxW / 2, y + 38);
    ctx.font = 'bold 19px Arial, sans-serif';
    let ty = y + 82; for (const ln of f.lines) { ctx.fillText(ln, x + boxW / 2, ty); ty += 24; }
  }
  y += boxH + 34;
  ctx.font = 'bold 30px Arial, sans-serif';
  ctx.fillText(c.cta, W / 2, y + 28); y += 40;
  return y;
}
/* The bin's own printing, drawn to match: QR at 6 dots a module, then the
 * text in a 12x24 printer font (42 columns), with the same feeds as
 * eposPrint: 1 line, QR, 2 lines, assurance, 1 line, rule, footer. */
function native(ctx, y) {
  const L = D.layout, W = D.W;
  y += L.line;                                          // feed 1
  // A short link makes a QR with fewer modules, so it gets bigger ones:
  // every QR lands at about 25-28 mm, never below 6 dots a module.
  const q = D.qr, mod = Math.max(L.qrModule, Math.min(8, Math.floor(224 / q.n)));
  const s = q.n * mod, x0 = Math.round((W - s) / 2);
  ctx.fillStyle = '#000';
  for (let r = 0; r < q.n; r++) for (let col = 0; col < q.n; col++)
    if (q.bits[r * q.n + col]) ctx.fillRect(x0 + col * mod, y + r * mod, mod, mod);
  y += s + 2 * L.line;                                  // QR, feed 2
  ctx.font = 'bold 20px Menlo, monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  for (const ln of D.copy.assureLines) { ctx.fillText(ln, W / 2, y + 2); y += L.line; }
  y += L.line;                                          // feed 1
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

for (const kind of ['header', 'receipt', 'offline', 'demo']) {
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
