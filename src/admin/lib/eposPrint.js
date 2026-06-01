/* ─────────────────────────────────────────────────────────────────────
 * Epson TM-m30III printing via ePOS-Print (over Ethernet).
 *
 * The TM-m30III runs an ePOS-Print HTTP service. We POST an ePOS-Print
 * XML document to its service.cgi endpoint; the printer turns that into
 * ESC/POS internally and prints — including a NATIVE QR code via the
 * <symbol> element (crisper than a raster image).
 *
 * Endpoint:  http://<printer-ip>/cgi-bin/epos/service.cgi?devid=local_printer&timeout=10000
 *
 * Requirements / gotchas:
 *   • The computer must be on the printer's subnet. Epson's default
 *     direct-Ethernet IP is 192.168.192.168 — set your Mac's Ethernet
 *     IPv4 to e.g. 192.168.192.100 / 255.255.255.0 to reach it.
 *   • Works from localhost (http) and the Vercel domain (https): the
 *     endpoint matches the page protocol. For https, enable the printer's
 *     TLS/SSL ePOS-Print and trust its self-signed cert once.
 *   • ePOS-Print must be enabled on the printer (default ON for TM-m30III).
 *     Open the printer's built-in config in a browser at http://<printer-ip>.
 *   • Logo: the bundled SVG is rasterised in-browser and printed as an
 *     <image> (no Epson utility needed). Optionally register an NV-graphics
 *     logo and set its key codes to print by reference instead.
 * ───────────────────────────────────────────────────────────────────── */

import logoUrl from '../../assets/images/packback-print-logo.svg';

const DEFAULT_PRINTER_IP = '192.168.192.168';
const IP_STORAGE_KEY = 'packperks_printer_ip';
const LOGO_STORAGE_KEY = 'packperks_printer_logo_keys';

export function getPrinterIp() {
  try { return localStorage.getItem(IP_STORAGE_KEY) || DEFAULT_PRINTER_IP; }
  catch { return DEFAULT_PRINTER_IP; }
}
export function setPrinterIp(ip) {
  try { localStorage.setItem(IP_STORAGE_KEY, (ip || '').trim() || DEFAULT_PRINTER_IP); }
  catch { /* ignore */ }
}

/* ── NV-graphics logo (optional) ──────────────────────────────────────
 * The fastest, non-raster way to print a logo: register the bitmap ONCE
 * into the printer's NV graphics memory (384 KB, persistent) with a 2-byte
 * key code, then print it by reference. ePOS-Print's <logo> element does
 * exactly that — it sends ~6 bytes, not the bitmap, so nothing is
 * rasterized/binarised per receipt.
 *
 * HOW TO REGISTER THE LOGO (one-time):
 *   Use Epson's "TM-m30III Utility" (or EpsonNet) → NV graphics / logo
 *   registration → import the PackPerks logo, assign a key code (e.g.
 *   ASCII "PP" = 80,80), write it to the printer. Then set the same key
 *   codes here. Inspect what's registered via the printer's "NV Graphics
 *   Information" print mode (Feed-button self-test, option 1).
 *
 * Stored as "k1,k2" (decimal key-code bytes). Empty = no logo (the
 * receipt prints the "PackPerks" text brand instead). */
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
    if (Number.isInteger(k1) && Number.isInteger(k2)) {
      localStorage.setItem(LOGO_STORAGE_KEY, `${k1},${k2}`);
    } else {
      localStorage.removeItem(LOGO_STORAGE_KEY);
    }
  } catch { /* ignore */ }
}

// Match the page's protocol so printing works from BOTH localhost (http)
// and the Vercel domain (https). A plain-http page can only reach the
// printer over http; an https page must reach it over https (otherwise the
// browser blocks the request as mixed content). For the https case the
// printer needs its TLS/SSL ePOS-Print enabled and its self-signed cert
// trusted once (visit https://<printer-ip> and accept it).
const endpoint = (ip) => {
  const proto = (typeof window !== 'undefined' && window.location.protocol === 'https:') ? 'https' : 'http';
  return `${proto}://${ip}/cgi-bin/epos/service.cgi?devid=local_printer&timeout=10000`;
};

function xmlEscape(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/* ── Logo as a printed raster (no NV registration / no utility needed) ──
 * Rasterise the bundled SVG logo to a 1-bit mono bitmap in the browser and
 * emit it as an ePOS-Print <image>. Done ONCE and cached, so repeated
 * prints reuse the same payload (fast). Width is forced to a multiple of 8
 * so the mono packing is unambiguous. Returns '' if rasterising isn't
 * possible (e.g. no DOM) → caller falls back to the text wordmark. */
let _logoImageXmlCache; // undefined = not tried, '' = tried/none, string = ready
const LOGO_PRINT_WIDTH = 384; // dots (multiple of 8); fits 80mm paper, centered

function rasterizeToEposImage(src, targetWidth) {
  return new Promise((resolve, reject) => {
    if (typeof document === 'undefined') { reject(new Error('no DOM')); return; }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const w = targetWidth - (targetWidth % 8);
        const scale = w / img.width;
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        const { data } = ctx.getImageData(0, 0, w, h);
        const bytesPerRow = w / 8;
        const out = new Uint8Array(bytesPerRow * h);
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const i = (y * w + x) * 4;
            const alpha = data[i + 3];
            const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
            // 1 = black dot. Treat near-transparent as white.
            if (alpha > 64 && lum < 180) {
              out[y * bytesPerRow + (x >> 3)] |= (0x80 >> (x & 7));
            }
          }
        }
        let bin = '';
        for (let i = 0; i < out.length; i++) bin += String.fromCharCode(out[i]);
        const b64 = btoa(bin);
        resolve(`<image width="${w}" height="${h}" color="color_1" mode="mono" align="center">${b64}</image>`);
      } catch (e) { reject(e); }
    };
    img.onerror = () => reject(new Error('logo image failed to load'));
    img.src = src;
  });
}

async function getLogoImageXml() {
  if (_logoImageXmlCache !== undefined) return _logoImageXmlCache;
  try {
    _logoImageXmlCache = await rasterizeToEposImage(logoUrl, LOGO_PRINT_WIDTH);
  } catch (e) {
    console.warn('Logo rasterise failed; printing text wordmark instead:', e);
    _logoImageXmlCache = '';
  }
  return _logoImageXmlCache;
}

/* Build the ePOS-Print XML for a cup-return QR receipt. Mirrors the
 * on-screen receipt: brand, headline, QR (batch URL), and a footer with
 * time / location / total / session id, then a feed + cut. */
export function buildCupReceiptXml({ url, restaurant, generatedAt, totalAmount, sessionId, logo = getLogoKeys(), logoImageXml = '' }) {
  const when = generatedAt
    ? new Date(generatedAt).toLocaleString('en-GB', {
        day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
      })
    : '';
  const NL = '&#10;';
  // Brand block, in priority order:
  //   1. NV-registered logo by key code (fastest, no raster) — if configured
  //   2. rasterised logo image (no utility needed) — the default
  //   3. text wordmark — fallback if rasterising failed
  let brand;
  if (logo && Number.isInteger(logo.key1) && Number.isInteger(logo.key2)) {
    brand = `<logo key1="${logo.key1}" key2="${logo.key2}"/><feed line="1"/>`;
  } else if (logoImageXml) {
    brand = `${logoImageXml}<feed line="1"/>`;
  } else {
    brand = `<text dw="true" dh="true" em="true">PackPerks${NL}</text><text dw="false" dh="false" em="false"/><feed line="1"/>`;
  }
  // Mirrors the dashboard receipt preview: brand → headline → intro →
  // 3 feature lines → scan CTA → native QR → assurance → refund note →
  // dashed divider → footer (time / restaurant / total / session).
  const DASH = '------------------------------------------'; // ~42 cols
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">',
    '<s:Body>',
    '<epos-print xmlns="http://www.epson-pos.com/schemas/2011/03/epos-print">',
    '<text align="center"/>',
    brand,
    `<text dw="true" dh="true" em="true">GET YOUR REFUND${NL}AND REWARDS${NL}</text>`,
    '<text dw="false" dh="false" em="false"/>',
    '<feed line="1"/>',
    `<text>Use PackPerks to access your deposit,${NL}track returns, and unlock extra rewards.${NL}</text>`,
    '<feed line="1"/>',
    `<text>Access your deposit${NL}</text>`,
    `<text>Earn more from repeat returns${NL}</text>`,
    `<text>Keep track of your progress${NL}</text>`,
    '<feed line="1"/>',
    `<text em="true">Scan to start with PackPerks${NL}</text>`,
    '<text em="false"/>',
    '<feed line="1"/>',
    `<symbol type="qrcode_model_2" level="level_m" width="6" height="6">${xmlEscape(url)}</symbol>`,
    '<feed line="1"/>',
    `<text em="true">No app and no registration needed.${NL}Fast and secure.${NL}</text>`,
    '<text em="false"/>',
    '<feed line="1"/>',
    `<text>You can still directly refund in the same${NL}app by tapping the user icon top-right.${NL}</text>`,
    '<feed line="1"/>',
    `<text>${DASH}${NL}</text>`,
    '<text align="left"/>',
    `<text>Time:          ${xmlEscape(when)}${NL}</text>`,
    `<text>Restaurant:    ${xmlEscape(restaurant)}${NL}</text>`,
    `<text>Total Amount:  EUR ${xmlEscape(totalAmount)}${NL}</text>`,
    `<text>Session ID:    ${xmlEscape(sessionId)}${NL}</text>`,
    '<feed line="3"/>',
    '<cut type="feed"/>',
    '</epos-print>',
    '</s:Body>',
    '</s:Envelope>',
  ].join('');
}

/* POST the receipt to the printer. Resolves on success, throws with a
 * human-readable message on failure (network, CORS, or printer error). */
export async function printCupReceipt(data, ip = getPrinterIp()) {
  // If no NV logo key is configured, rasterise + cache the bundled logo and
  // print it as an image (no Epson utility needed). NV keys take priority.
  let logoImageXml = '';
  if (!getLogoKeys()) {
    logoImageXml = await getLogoImageXml();
  }
  const xml = buildCupReceiptXml({ ...data, logoImageXml });
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
