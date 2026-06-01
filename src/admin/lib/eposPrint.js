/* ─────────────────────────────────────────────────────────────────────
 * Epson TM-m30III printing via ePOS-Print (over Ethernet).
 *
 * Posts an ePOS-Print XML document to the printer's service.cgi; the
 * printer renders ESC/POS internally, including a NATIVE QR via <symbol>.
 *
 * Layout strategy (to match the dashboard receipt preview):
 *   • Header block (logo + headline + intro + three icon "cards" + "Scan
 *     to start") is rendered to a canvas and printed as ONE mono <image>.
 *     Thermal text commands can't draw boxes/icons, so this is the only
 *     way to match the boxed 3-column design. It's STATIC, so we render it
 *     once and cache it — fast on every subsequent print.
 *   • QR stays native (<symbol>) — sharp, not raster.
 *   • Assurance lines + footer (time/restaurant/total/session) are text.
 *
 * Requirements / gotchas:
 *   • Computer must be on the printer's subnet. Epson's default direct-
 *     Ethernet IP is 192.168.192.168 — set the Mac's Ethernet IPv4 to e.g.
 *     192.168.192.100 / 255.255.255.0.
 *   • Works from localhost (http) and the Vercel domain (https): the
 *     endpoint matches the page protocol. For https, enable the printer's
 *     TLS ePOS-Print and trust its self-signed cert once.
 *   • ePOS-Print must be enabled on the printer (default ON). Open the
 *     printer's built-in config in a browser at http://<printer-ip>.
 * ───────────────────────────────────────────────────────────────────── */

import logoUrl from '../../assets/images/packback-print-logo.svg';

const DEFAULT_PRINTER_IP = '192.168.192.168';
const IP_STORAGE_KEY = 'packperks_printer_ip';
const LOGO_STORAGE_KEY = 'packperks_printer_logo_keys';
const PRINT_WIDTH = 512; // dots (multiple of 8); ~80 mm printable width

export function getPrinterIp() {
  try { return localStorage.getItem(IP_STORAGE_KEY) || DEFAULT_PRINTER_IP; }
  catch { return DEFAULT_PRINTER_IP; }
}
export function setPrinterIp(ip) {
  try { localStorage.setItem(IP_STORAGE_KEY, (ip || '').trim() || DEFAULT_PRINTER_IP); }
  catch { /* ignore */ }
}

/* Optional NV-graphics logo key codes (print logo by reference). Empty =
 * use the rendered header image (default). See header comment. */
export function getLogoKeys() {
  try {
    const raw = localStorage.getItem(LOGO_STORAGE_KEY);
    if (!raw) return null;
    const [k1, k2] = raw.split(',').map(n => parseInt(n, 10));
    return Number.isInteger(k1) && Number.isInteger(k2) ? { key1: k1, key2: k2 } : null;
  } catch { return null; }
}
export function setLogoKeys(key1, key2) {
  try {
    const k1 = parseInt(key1, 10), k2 = parseInt(key2, 10);
    if (Number.isInteger(k1) && Number.isInteger(k2)) localStorage.setItem(LOGO_STORAGE_KEY, `${k1},${k2}`);
    else localStorage.removeItem(LOGO_STORAGE_KEY);
  } catch { /* ignore */ }
}

const endpoint = (ip) => {
  const proto = (typeof window !== 'undefined' && window.location.protocol === 'https:') ? 'https' : 'http';
  return `${proto}://${ip}/cgi-bin/epos/service.cgi?devid=local_printer&timeout=10000`;
};

function xmlEscape(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

// ── Canvas → ePOS mono <image> helpers ──────────────────────────────────
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.crossOrigin = 'anonymous';
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error('image load failed'));
    im.src = src;
  });
}

function wrapText(ctx, text, maxWidth) {
  const words = text.split(' ');
  const lines = [];
  let line = '';
  for (const wd of words) {
    const test = line ? `${line} ${wd}` : wd;
    if (ctx.measureText(test).width > maxWidth && line) { lines.push(line); line = wd; }
    else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

// Convert a canvas (width must be a multiple of 8) to an ePOS-Print mono
// <image>: 1 bit/dot, MSB-first, 1 = black. lum<threshold + opaque = black.
function canvasToEposImage(canvas) {
  const w = canvas.width, h = canvas.height;
  const { data } = canvas.getContext('2d').getImageData(0, 0, w, h);
  const bytesPerRow = w / 8;
  const out = new Uint8Array(bytesPerRow * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const a = data[i + 3];
      const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      if (a > 64 && lum < 170) out[y * bytesPerRow + (x >> 3)] |= (0x80 >> (x & 7));
    }
  }
  let bin = '';
  for (let i = 0; i < out.length; i++) bin += String.fromCharCode(out[i]);
  return `<image width="${w}" height="${h}" color="color_1" mode="mono" align="center">${btoa(bin)}</image>`;
}

function strokeRoundRect(ctx, x, y, w, h, r) {
  if (typeof ctx.roundRect === 'function') { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.stroke(); return; }
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  ctx.stroke();
}

// Simple monochrome icons that read cleanly on thermal paper (color emoji
// would threshold to muddy blobs): banknote(€), gift box, progress bars.
function drawFeatureIcon(ctx, idx, cx, cy) {
  ctx.save();
  ctx.strokeStyle = '#000'; ctx.fillStyle = '#000'; ctx.lineWidth = 2.5;
  if (idx === 0) {
    ctx.strokeRect(cx - 24, cy - 14, 48, 28);
    ctx.font = 'bold 22px Arial, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('€', cx, cy + 1);
  } else if (idx === 1) {
    ctx.strokeRect(cx - 20, cy - 6, 40, 22);          // box body
    ctx.beginPath(); ctx.moveTo(cx - 22, cy - 6); ctx.lineTo(cx + 22, cy - 6); ctx.stroke(); // lid
    ctx.beginPath(); ctx.moveTo(cx, cy - 6); ctx.lineTo(cx, cy + 16); ctx.stroke();          // ribbon
    ctx.beginPath(); ctx.arc(cx - 7, cy - 12, 6, 0, Math.PI * 2); ctx.stroke();              // bow L
    ctx.beginPath(); ctx.arc(cx + 7, cy - 12, 6, 0, Math.PI * 2); ctx.stroke();              // bow R
  } else {
    ctx.fillRect(cx - 20, cy + 4, 9, 10);
    ctx.fillRect(cx - 5, cy - 4, 9, 18);
    ctx.fillRect(cx + 10, cy - 12, 9, 26);
  }
  ctx.restore();
}

/* Render the static top of the receipt (logo, headline, intro, 3 icon
 * cards, "Scan to start") to a mono <image>. Cached after first render. */
let _headerImgCache; // undefined=not tried, ''=failed, string=ready
async function renderHeaderImage() {
  if (_headerImgCache !== undefined) return _headerImgCache;
  try {
    if (typeof document === 'undefined') throw new Error('no DOM');
    const W = PRINT_WIDTH;
    const MAXH = 900;
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = MAXH;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, W, MAXH);
    ctx.fillStyle = '#000000';
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';

    let y = 18;

    // Logo (centered)
    try {
      const logo = await loadImage(logoUrl);
      const lw = 300;
      const lh = Math.round(lw * (logo.height / logo.width));
      ctx.drawImage(logo, (W - lw) / 2, y, lw, lh);
      y += lh + 26;
    } catch { y += 10; }

    // Headline
    ctx.font = 'bold 42px Arial, sans-serif';
    ctx.fillText('GET YOUR REFUND', W / 2, y + 38); y += 48;
    ctx.fillText('AND REWARDS', W / 2, y + 38); y += 60;

    // Intro
    ctx.font = '23px Arial, sans-serif';
    for (const ln of wrapText(ctx, 'Use PackPerks to access your deposit, track returns, and unlock extra rewards.', W - 64)) {
      ctx.fillText(ln, W / 2, y + 22); y += 32;
    }
    y += 22;

    // Three icon cards (boxes)
    const m = 18, gap = 14;
    const boxW = (W - 2 * m - 2 * gap) / 3;
    const boxH = 128;
    const labels = [['Access your', 'deposit'], ['Earn more from', 'repeat returns'], ['Keep track of', 'your progress']];
    for (let c = 0; c < 3; c++) {
      const x = m + c * (boxW + gap);
      ctx.lineWidth = 2;
      strokeRoundRect(ctx, x, y, boxW, boxH, 14);
      drawFeatureIcon(ctx, c, x + boxW / 2, y + 38);
      ctx.fillStyle = '#000'; ctx.font = 'bold 19px Arial, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      let ty = y + 82;
      for (const ln of labels[c]) { ctx.fillText(ln, x + boxW / 2, ty); ty += 24; }
    }
    y += boxH + 34;

    // Scan CTA
    ctx.font = 'bold 30px Arial, sans-serif';
    ctx.fillText('Scan to start with PackPerks', W / 2, y + 28); y += 40;

    // Trim to used height
    const trimmed = document.createElement('canvas');
    trimmed.width = W; trimmed.height = y;
    const tctx = trimmed.getContext('2d');
    tctx.fillStyle = '#FFFFFF'; tctx.fillRect(0, 0, W, y);
    tctx.drawImage(canvas, 0, 0);

    _headerImgCache = canvasToEposImage(trimmed);
  } catch (e) {
    console.warn('Header image render failed; using text layout:', e);
    _headerImgCache = '';
  }
  return _headerImgCache;
}

/* Logo-only raster, used only by the text fallback layout. Cached. */
let _logoImgCache;
async function getLogoImageXml() {
  if (_logoImgCache !== undefined) return _logoImgCache;
  try {
    if (typeof document === 'undefined') throw new Error('no DOM');
    const logo = await loadImage(logoUrl);
    const w = 384;
    const h = Math.max(1, Math.round(w * (logo.height / logo.width)));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, w, h);
    ctx.drawImage(logo, 0, 0, w, h);
    _logoImgCache = canvasToEposImage(canvas);
  } catch (e) {
    console.warn('Logo rasterise failed:', e);
    _logoImgCache = '';
  }
  return _logoImgCache;
}

/* Build the ePOS-Print XML. Prefers the rendered header image (matches the
 * dashboard preview). Falls back to a text layout if rendering failed. */
export function buildCupReceiptXml({ url, restaurant, generatedAt, totalAmount, sessionId, cups, logo = getLogoKeys(), headerImageXml = '', logoImageXml = '' }) {
  const when = generatedAt
    ? new Date(generatedAt).toLocaleString('en-GB', {
        day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
      })
    : '';
  const NL = '&#10;';
  const DASH = '------------------------------------------';

  let top;
  if (headerImageXml) {
    top = `${headerImageXml}<feed line="1"/>`;
  } else {
    // Text fallback (no boxes/icons): brand → headline → intro → features → scan
    let brand;
    if (logo && Number.isInteger(logo.key1) && Number.isInteger(logo.key2)) {
      brand = `<logo key1="${logo.key1}" key2="${logo.key2}"/><feed line="1"/>`;
    } else if (logoImageXml) {
      brand = `${logoImageXml}<feed line="1"/>`;
    } else {
      brand = `<text dw="true" dh="true" em="true">PackPerks${NL}</text><text dw="false" dh="false" em="false"/><feed line="1"/>`;
    }
    top = [
      brand,
      `<text dw="true" dh="true" em="true">GET YOUR REFUND${NL}AND REWARDS${NL}</text>`,
      '<text dw="false" dh="false" em="false"/>',
      '<feed line="1"/>',
      `<text>Use PackPerks to access your deposit,${NL}track returns, and unlock extra rewards.${NL}</text>`,
      '<feed line="1"/>',
      `<text>Access your deposit${NL}Earn more from repeat returns${NL}Keep track of your progress${NL}</text>`,
      '<feed line="1"/>',
      `<text em="true">Scan to start with PackPerks${NL}</text><text em="false"/>`,
      '<feed line="1"/>',
    ].join('');
  }

  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">',
    '<s:Body>',
    '<epos-print xmlns="http://www.epson-pos.com/schemas/2011/03/epos-print">',
    '<text align="center"/>',
    top,
    // Prominent cup count so two receipts printed back-to-back are never
    // confused (the QR images look identical to the eye). Dynamic text —
    // intentionally NOT baked into the cached header image.
    cups != null
      ? `<text dw="true" dh="true" em="true">${xmlEscape(cups)} ${Number(cups) === 1 ? 'CUP' : 'CUPS'}${NL}</text><text dw="false" dh="false" em="false"/><feed line="1"/>`
      : '',
    `<symbol type="qrcode_model_2" level="level_m" width="6" height="6">${xmlEscape(url)}</symbol>`,
    '<feed line="2"/>',
    `<text em="true">No app and no registration needed.${NL}Fast and secure.${NL}</text>`,
    '<text em="false"/>',
    '<feed line="1"/>',
    `<text>You can still directly refund in the same${NL}app by tapping the user icon top-right.${NL}</text>`,
    '<feed line="2"/>',
    `<text>${DASH}${NL}</text>`,
    '<text align="left"/>',
    `<text>Time:          ${xmlEscape(when)}${NL}</text>`,
    `<text>Restaurant:    ${xmlEscape(restaurant)}${NL}</text>`,
    cups != null ? `<text>Cups:          ${xmlEscape(cups)}${NL}</text>` : '',
    `<text>Total Amount:  EUR ${xmlEscape(totalAmount)}${NL}</text>`,
    `<text>Session ID:    ${xmlEscape(sessionId)}${NL}</text>`,
    '<feed line="4"/>',
    '<cut type="feed"/>',
    '</epos-print>',
    '</s:Body>',
    '</s:Envelope>',
  ].join('');
}

/* POST the receipt to the printer. Resolves on success, throws with a
 * human-readable message on failure. */
export async function printCupReceipt(data, ip = getPrinterIp()) {
  // Default: render the boxed header image (matches the dashboard preview).
  // If an NV logo key is set, skip the image and use the text layout with
  // the NV logo. If image render fails, fall back to text + rasterised logo.
  let headerImageXml = '';
  let logoImageXml = '';
  if (!getLogoKeys()) {
    headerImageXml = await renderHeaderImage();
    if (!headerImageXml) logoImageXml = await getLogoImageXml();
  }
  const xml = buildCupReceiptXml({ ...data, headerImageXml, logoImageXml });

  let res;
  try {
    res = await fetch(endpoint(ip), {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml; charset=utf-8', 'SOAPAction': '""' },
      body: xml,
    });
  } catch (e) {
    throw new Error(
      `Could not reach the printer at ${ip}. Check the Ethernet cable, that your ` +
      `computer is on the 192.168.192.x subnet, and that ePOS-Print is enabled. (${e.message})`,
    );
  }
  const body = await res.text();
  const success = /success\s*=\s*"true"/i.test(body);
  if (!success) {
    const code = (body.match(/code\s*=\s*"([^"]*)"/i) || [])[1];
    const status = (body.match(/status\s*=\s*"([^"]*)"/i) || [])[1];
    throw new Error(
      `Printer rejected the job${code ? ` (code: ${code})` : ''}${status ? `, status ${status}` : ''}. ` +
      `Common causes: cover open, out of paper, or wrong device id.`,
    );
  }
  return { success: true };
}
