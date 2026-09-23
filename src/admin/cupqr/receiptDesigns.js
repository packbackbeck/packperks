/* ─────────────────────────────────────────────────────────────────────
 * Printable receipt designs — the four artworks the designer drew, filled
 * with a live batch.
 *
 * ONE SVG, EVERY OUTPUT. The preview, the JPG, the PDF, the browser print
 * dialog and the thermal printer all rasterise the exact same self-
 * contained SVG string, so there is nothing that can drift between what an
 * admin sees and what comes out of the printer. That is the whole point of
 * this module: `renderDesign()` builds the string, and everything else is a
 * different way of drawing it.
 *
 * Self-contained means the fonts travel INSIDE the document as base64
 * @font-face. An SVG loaded into an <img> (which is what a canvas needs)
 * gets no access to the page's stylesheets, so a webfont referenced by URL
 * would silently fall back to Helvetica in the export while the preview
 * looked right — the one failure this design is built to make impossible.
 *
 * The templates in /public/receipt-designs are the designer's exports with
 * the changing text cut out; see scripts/receipt-designs/build.py. Static
 * text in them is outlined vector and cannot be changed from here.
 * ───────────────────────────────────────────────────────────────────── */

/* The artworks, in the order they appear in the picker. `sample` is what
 * the tile shows before a batch exists. */
export const RECEIPT_DESIGNS = [
  {
    id: 'banknote-simple',
    label: 'Banknote Simple',
    hint: 'Clean note, wide format.',
    width: 1782,
    height: 771,
  },
  {
    id: 'banknote-full',
    label: 'Banknote Full',
    hint: 'Engraved note with a full border.',
    width: 1916,
    height: 821,
  },
  {
    id: 'willi-wonka',
    label: 'Willy Wonka',
    hint: 'Golden-ticket lettering.',
    width: 1821,
    height: 740,
  },
  {
    id: 'ticket',
    label: 'Ticket',
    hint: 'Tear-off stub with the session details.',
    width: 1774,
    height: 764,
  },
];

export const DEFAULT_DESIGN_ID = 'receipt';

/** Is this one of the artworks (as opposed to the original tall receipt)? */
export function isArtworkDesign(id) {
  return RECEIPT_DESIGNS.some(d => d.id === id);
}

export function getDesign(id) {
  return RECEIPT_DESIGNS.find(d => d.id === id) || null;
}

/* Self-hosted from /public/fonts — no third-party font CDN, same rule as
 * DM Sans in index.css. The family names are prefixed so a font of the same
 * name installed on the admin's machine can never be picked up instead. */
const FONTS = {
  'PackPerks Figtree': '/fonts/figtree-latin.woff2',
  'PackPerks Playfair': '/fonts/playfair-display-latin.woff2',
  'PackPerks Bevan': '/fonts/bevan-latin.woff2',
};

const templateCache = new Map();   // id → raw SVG text
const fontCache = new Map();       // family → { base64, face }

async function loadTemplate(id) {
  if (!templateCache.has(id)) {
    const res = await fetch(`/receipt-designs/${id}.svg`, { cache: 'force-cache' });
    if (!res.ok) throw new Error(`Design “${id}” could not be loaded (${res.status}).`);
    templateCache.set(id, await res.text());
  }
  return templateCache.get(id);
}

function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let bin = '';
  // Chunked: String.fromCharCode(...bytes) blows the argument limit on a
  // 40 KB font.
  for (let i = 0; i < bytes.length; i += 8192) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
  }
  return btoa(bin);
}

/* Fetch a font once and use it twice: registered on the document so canvas
 * measureText can size the value, and base64 so it can ride inside the SVG. */
async function loadFont(family) {
  if (fontCache.has(family)) return fontCache.get(family);
  const url = FONTS[family];
  if (!url) throw new Error(`Unknown design font “${family}”.`);
  const res = await fetch(url, { cache: 'force-cache' });
  if (!res.ok) throw new Error(`Font ${family} could not be loaded (${res.status}).`);
  const buf = await res.arrayBuffer();
  const base64 = toBase64(buf);
  if (typeof FontFace === 'function' && document.fonts) {
    try {
      const face = new FontFace(family, buf, { weight: '100 900', style: 'normal' });
      await face.load();
      document.fonts.add(face);
    } catch (e) {
      // Measurement falls back to the default font — slightly wrong widths,
      // never a wrong-looking print (the SVG still carries the real font).
      console.warn(`[receiptDesigns] ${family} not registered for measuring:`, e);
    }
  }
  const entry = { base64 };
  fontCache.set(family, entry);
  return entry;
}

let measureCtx = null;
function measure(text, family, weight, size, letterSpacing) {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
  measureCtx.font = `${weight} ${size}px "${family}"`;
  const w = measureCtx.measureText(text).width;
  // Canvas measureText ignores letter-spacing in older engines, so add it
  // back by hand: one gap after every character but the last.
  const gaps = Math.max(0, [...text].length - 1);
  return w + gaps * (letterSpacing || 0);
}

/**
 * Fill one design and return a self-contained SVG string.
 *
 * @param {string} id      a RECEIPT_DESIGNS id
 * @param {object} values  slot name → string (see DESIGN_SLOTS per design)
 * @param {string} qrDataUrl  a data: PNG of the batch QR, or '' for none
 * @returns {Promise<{ svg: string, width: number, height: number }>}
 */
export async function renderDesign(id, values, qrDataUrl) {
  const design = getDesign(id);
  if (!design) throw new Error(`Unknown design “${id}”.`);
  const raw = await loadTemplate(id);

  const doc = new DOMParser().parseFromString(raw, 'image/svg+xml');
  if (doc.querySelector('parsererror')) throw new Error(`Design “${id}” is not valid SVG.`);
  const svg = doc.documentElement;

  // ── QR ──
  const qr = svg.querySelector('[data-pp-slot="qr"]');
  if (qr) {
    if (qrDataUrl) {
      qr.setAttribute('href', qrDataUrl);
      /* Nearest-neighbour, not smoothing. On the thermal printer the QR is
       * scaled down to roughly 140 dots and then thresholded to 1 bit: a
       * smoothed edge becomes a ragged module and the code stops scanning.
       * Hard edges survive the threshold. */
      qr.setAttribute('image-rendering', 'pixelated');
    } else {
      qr.remove();
    }
  }

  const slots = [...svg.querySelectorAll('text[data-pp-slot]')];

  /* Load every font the template asks for FIRST. measureText silently falls
   * back to a system face for a font the document has not loaded yet, and a
   * value measured against the wrong face is a value that overflows the
   * artwork it is supposed to sit inside. */
  const families = new Set(slots.map(n => n.getAttribute('font-family')));
  const embedded = new Map();
  for (const family of families) {
    const { base64 } = await loadFont(family);
    embedded.set(family, base64);
  }

  // ── Values, each shrunk to fit the space the artwork leaves it ──
  for (const node of slots) {
    const slot = node.getAttribute('data-pp-slot');
    const value = values[slot];
    if (value == null || value === '') { node.remove(); continue; }

    const family = node.getAttribute('font-family');
    const weight = node.getAttribute('font-weight') || '400';
    const base = parseFloat(node.getAttribute('data-pp-size'));
    const maxw = parseFloat(node.getAttribute('data-pp-maxw'));
    const scaleX = parseFloat(node.getAttribute('data-pp-scalex')) || 1;
    const ls = parseFloat(node.getAttribute('letter-spacing')) || 0;

    let size = base;
    const width = measure(String(value), family, weight, base, ls) * scaleX;
    if (width > maxw && width > 0) {
      const shrink = maxw / width;
      size = base * shrink;
      if (ls) node.setAttribute('letter-spacing', String(ls * shrink));
    }
    node.setAttribute('font-size', String(Math.round(size * 100) / 100));
    node.textContent = String(value);
  }

  // ── Fonts, embedded so an <img> rasteriser sees them ──
  const faces = [...embedded].map(([family, base64]) => (
    `@font-face{font-family:'${family}';font-weight:100 900;font-style:normal;` +
    `src:url(data:font/woff2;base64,${base64}) format('woff2');}`
  ));
  if (faces.length) {
    const style = doc.createElementNS('http://www.w3.org/2000/svg', 'style');
    style.textContent = faces.join('');
    svg.insertBefore(style, svg.firstChild);
  }

  return {
    svg: new XMLSerializer().serializeToString(svg),
    width: design.width,
    height: design.height,
  };
}

/** The SVG as a data: URL — what <img>, canvas and jsPDF all consume. */
export function svgToDataUrl(svg) {
  // encodeURIComponent, not btoa: the fonts are already base64 and the
  // artwork is ASCII, so this is both smaller and immune to unicode in a
  // venue name.
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** Rasterise at a given pixel width. Resolves to a canvas. */
export function rasterise(svg, width, height, pixelWidth) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(pixelWidth);
      canvas.height = Math.round(pixelWidth * (height / width));
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas);
    };
    img.onerror = () => reject(new Error('The design could not be drawn.'));
    img.src = svgToDataUrl(svg);
  });
}

/**
 * Rasterise a design for the thermal printer, turned a quarter turn.
 *
 * All four artworks are landscape and about 2.3 times as wide as they are
 * tall. Printed the right way up on an 80 mm roll their QR lands at roughly
 * 10 mm across, which a phone camera cannot read. Turned on its side the
 * same QR is about 25 mm and the note runs down the roll instead — so the
 * slip comes out sideways and the customer turns it, which is what the
 * artwork wants anyway: it is a banknote, not a till receipt.
 *
 * @param {number} dots  printable width in dots (must be a multiple of 8)
 */
export function rasteriseForThermal(svg, width, height, dots) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      // Paper width carries the design's HEIGHT; its width runs down the roll.
      const w = Math.round(dots);
      const h = Math.round(w * (width / height));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, w, h);
      // Quarter turn clockwise: the design's top edge ends up on the right
      // of the paper, so the slip reads when turned anticlockwise.
      ctx.translate(w, 0);
      ctx.rotate(Math.PI / 2);
      ctx.drawImage(img, 0, 0, h, w);
      resolve(canvas);
    };
    img.onerror = () => reject(new Error('The design could not be drawn.'));
    img.src = svgToDataUrl(svg);
  });
}

/* ── The values each design asks for ──────────────────────────────────
 * The artworks are worded for a deposit refund, so the live values are the
 * money, the cups, the time and the session — the same four the tall
 * receipt prints in its footer. `symbol` is the active org's currency.
 *
 * The designs put the symbol on different sides because the artwork does:
 * the banknotes read "SCAN QR FOR €2", the ticket and the Wonka note read
 * "1.00€". Both follow the mock rather than one house rule.                */
export function designValues({ symbol, total, cups, when, session }) {
  const money = Number(total || 0).toFixed(2);
  const stamp = when instanceof Date ? when : new Date();
  const time = stamp.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const dd = String(stamp.getDate()).padStart(2, '0');
  const mm = String(stamp.getMonth() + 1).padStart(2, '0');
  const date = `${dd}.${mm}`;   // the artwork reads "18.06.", not "18/06".
  const strip = `TIME: ${time}. ${date}. CUPS: ${cups}`;
  return {
    'banknote-simple': { strip, amount: `SCAN QR FOR ${symbol}${money}` },
    'banknote-full': { strip, amount: `SCAN QR FOR ${symbol}${money}` },
    'willi-wonka': { amount: `${money}${symbol}` },
    'ticket': {
      amount: `${money}${symbol}`,
      amountStub: `${money}${symbol}`,
      time: `${time} ${date}`,
      cups: String(cups),
      total: `${money}${symbol}`,
      session,
    },
  };
}
