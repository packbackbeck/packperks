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
 *   • Must be served over http:// (e.g. localhost dev). A page served
 *     over https can't POST to a plain-http printer (mixed content),
 *     so run the admin from localhost for printing.
 *   • ePOS-Print must be enabled on the printer (default ON for TM-m30III).
 * ───────────────────────────────────────────────────────────────────── */

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

const endpoint = (ip) =>
  `http://${ip}/cgi-bin/epos/service.cgi?devid=local_printer&timeout=10000`;

function xmlEscape(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/* Build the ePOS-Print XML for a cup-return QR receipt. Mirrors the
 * on-screen receipt: brand, headline, QR (batch URL), and a footer with
 * time / location / total / session id, then a feed + cut. */
export function buildCupReceiptXml({ url, restaurant, generatedAt, totalAmount, sessionId, logo = getLogoKeys() }) {
  const when = generatedAt
    ? new Date(generatedAt).toLocaleString('en-GB', {
        day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
      })
    : '';
  const NL = '&#10;';
  // Brand block: print the NV-registered logo by key code (no raster) when
  // one is configured; otherwise fall back to the text wordmark.
  const brand = (logo && Number.isInteger(logo.key1) && Number.isInteger(logo.key2))
    ? `<logo key1="${logo.key1}" key2="${logo.key2}"/><feed line="1"/>`
    : `<text dw="true" dh="true" em="true">PackPerks${NL}</text><text dw="false" dh="false" em="false"/><feed line="1"/>`;
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">',
    '<s:Body>',
    '<epos-print xmlns="http://www.epson-pos.com/schemas/2011/03/epos-print">',
    '<text align="center"/>',
    brand,
    `<text em="true">GET YOUR REFUND${NL}AND REWARDS${NL}</text>`,
    '<text em="false"/>',
    '<feed line="1"/>',
    `<text>Use PackPerks to access your deposit,${NL}track returns, and unlock rewards.${NL}</text>`,
    '<feed line="1"/>',
    `<text>Scan to start with PackPerks${NL}</text>`,
    '<feed line="1"/>',
    `<symbol type="qrcode_model_2" level="level_m" width="6" height="6">${xmlEscape(url)}</symbol>`,
    '<feed line="1"/>',
    `<text>No app and no registration needed.${NL}</text>`,
    '<feed line="1"/>',
    '<text align="left"/>',
    `<text>--------------------------------${NL}</text>`,
    `<text>Time:     ${xmlEscape(when)}${NL}</text>`,
    `<text>Location: ${xmlEscape(restaurant)}${NL}</text>`,
    `<text>Total:    EUR ${xmlEscape(totalAmount)}${NL}</text>`,
    `<text>Session:  ${xmlEscape(sessionId)}${NL}</text>`,
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
  const xml = buildCupReceiptXml(data);
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
