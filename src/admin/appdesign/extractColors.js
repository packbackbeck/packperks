/* ─────────────────────────────────────────────────────────────────────
 * extractColors — pull a sensible 6-colour palette out of any uploaded
 * image, with no external dependencies.
 *
 * Algorithm:
 *   1. Draw the image onto a tiny 96×96 canvas (fast pixel reads,
 *      smooths out noise from the source).
 *   2. Bucket every visible pixel into a coarse RGB grid (16-step per
 *      channel = 4096 buckets max).
 *   3. Keep the top N most-frequent buckets, weighted slightly by
 *      saturation so the truly grey backdrop doesn't outweigh a brand
 *      accent that covers fewer pixels.
 *   4. Sort by perceived luminance to fill the palette slots.
 *   5. Pick the most-saturated mid-luminance bucket as the explicit
 *      `accent` (the one that should grab the eye).
 *
 * Returns an object matching the shape of DEFAULT_DESIGN.colors so the
 * caller can drop it straight into the design draft.
 * ───────────────────────────────────────────────────────────────────── */

const CANVAS_SIZE = 96;
const BUCKET_BITS = 4; // 16 steps per channel
const TOP_N       = 8;

export async function extractColorsFromFile(file) {
  if (!file) throw new Error('No file provided.');
  const url = URL.createObjectURL(file);
  try {
    const palette = await extractFromUrl(url);
    return palette;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function extractFromUrl(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        resolve(extractFromImage(img));
      } catch (e) { reject(e); }
    };
    img.onerror = () => reject(new Error('Could not load the image.'));
    img.src = url;
  });
}

function extractFromImage(img) {
  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_SIZE;
  canvas.height = CANVAS_SIZE;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, CANVAS_SIZE, CANVAS_SIZE);
  const { data } = ctx.getImageData(0, 0, CANVAS_SIZE, CANVAS_SIZE);

  // Bucket pixels by quantised RGB. Keep weight + accumulated rgb so
  // we can recover the bucket's average colour, not just the midpoint.
  const buckets = new Map();
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (a < 128) continue; // skip semi-transparent pixels
    const r = data[i], g = data[i + 1], b = data[i + 2];
    // Drop almost-pure-white pixels (paper background, glare) since
    // they dominate logos and pollute the palette.
    if (r > 245 && g > 245 && b > 245) continue;
    const key = (r >> BUCKET_BITS) << (BUCKET_BITS * 2)
              | (g >> BUCKET_BITS) << BUCKET_BITS
              | (b >> BUCKET_BITS);
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { r: 0, g: 0, b: 0, count: 0 };
      buckets.set(key, bucket);
    }
    bucket.r += r; bucket.g += g; bucket.b += b; bucket.count += 1;
  }
  if (buckets.size === 0) throw new Error('No usable pixels in this image.');

  // Score each bucket: count × (1 + saturation). Pure greys lose ground,
  // pure brand colours win.
  const scored = Array.from(buckets.values()).map(b => {
    const r = Math.round(b.r / b.count);
    const g = Math.round(b.g / b.count);
    const bl = Math.round(b.b / b.count);
    const { s, l } = rgbToHsl(r, g, bl);
    return { r, g, b: bl, count: b.count, s, l, score: b.count * (1 + s * 1.5) };
  });
  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, TOP_N);

  // Sort by luminance for slot assignment.
  const byL = [...top].sort((a, b) => a.l - b.l);

  // Most-saturated mid-tone wins the explicit accent slot.
  const accentCandidate = [...top].sort((a, b) => {
    const aMid = midScore(a.l);
    const bMid = midScore(b.l);
    return (b.s * 1.5 + bMid) - (a.s * 1.5 + aMid);
  })[0];

  const dark   = byL[0];
  const light  = byL[byL.length - 1];
  // Primary = the largest-area non-accent, non-extreme-luminance bucket.
  const primaryCandidate = top.find(b =>
    b !== accentCandidate &&
    b !== light &&
    b.l > 0.12 && b.l < 0.80
  ) || top[0];

  // Text/textMuted: pick the darkest non-accent bucket as text; mute is
  // a 60% mix toward the background.
  const text = dark;

  const palette = {
    primary:    rgbHex(primaryCandidate),
    accent:     rgbHex(accentCandidate),
    background: lightenForBg(light),
    surface:    '#FFFFFF',
    text:       rgbHex(text),
    textMuted:  blend(text, light, 0.55),
    success:    '#1A8737', // keep the universal success colour intact
  };
  return palette;
}

/* ── colour-math helpers ──────────────────────────────────────────── */

function midScore(l) {
  // 1.0 at l≈0.5, dropping to 0 at the extremes.
  return 1 - Math.abs(0.5 - l) * 2;
}

function rgbHex({ r, g, b }) {
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase();
}

function lightenForBg({ r, g, b }) {
  // Always push background toward a cream/off-white so the user-app
  // page stays readable even if the dominant light tone is mid-grey.
  const target = 240;
  return rgbHex({
    r: Math.round((r + target * 2) / 3),
    g: Math.round((g + target * 2) / 3),
    b: Math.round((b + target * 2) / 3),
  });
}

function blend(a, b, t) {
  return rgbHex({
    r: Math.round(a.r + (b.r - a.r) * t),
    g: Math.round(a.g + (b.g - a.g) * t),
    b: Math.round(a.b + (b.b - a.b) * t),
  });
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  const d = max - min;
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return { h, s, l };
}
