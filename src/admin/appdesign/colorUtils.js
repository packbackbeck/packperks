/* Colour helpers for Design & copy: parsing, mixing and WCAG contrast. */

const HEX_RE = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i;

export function isHex(v) {
  return typeof v === 'string' && HEX_RE.test(v.trim());
}

/* '#abc' / 'abc' / '#aabbcc' → '#AABBCC', or null when it can't be read. */
export function toHex(v) {
  if (!isHex(v)) return null;
  let h = v.trim().replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  return `#${h.toUpperCase()}`;
}

/* A value the native colour input accepts (it only takes #rrggbb). */
export function pickerValue(v, fallback = '#000000') {
  return (toHex(v) || fallback).toLowerCase();
}

export function hexToRgb(v) {
  const h = toHex(v);
  if (!h) return null;
  const n = parseInt(h.slice(1), 16);
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
}

export function rgbToHex({ r, g, b }) {
  const c = (x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`.toUpperCase();
}

/* Mix a toward b by t (0 → a, 1 → b). */
export function mix(a, b, t) {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  if (!x || !y) return toHex(a) || toHex(b) || '#000000';
  return rgbToHex({ r: x.r + (y.r - x.r) * t, g: x.g + (y.g - x.g) * t, b: x.b + (y.b - x.b) * t });
}

export function luminance(v) {
  const c = hexToRgb(v);
  if (!c) return null;
  const ch = (x) => {
    const s = x / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(c.r) + 0.7152 * ch(c.g) + 0.0722 * ch(c.b);
}

/* WCAG contrast ratio, or null when either colour can't be read. */
export function contrast(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  if (la == null || lb == null) return null;
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/* How a ratio reads for a given use. Text needs 4.5:1 (large text 3:1);
 * shapes and icons need 3:1. */
export function contrastVerdict(ratio, use = 'text') {
  if (ratio == null) return null;
  if (use === 'shape') {
    return ratio >= 3
      ? { tone: 'success', label: 'Clear' }
      : { tone: 'warning', label: 'Low contrast' };
  }
  if (ratio >= 4.5) return { tone: 'success', label: 'Easy to read' };
  if (ratio >= 3) return { tone: 'warning', label: 'Large text only' };
  return { tone: 'danger', label: 'Hard to read' };
}

/* Darken (or lighten) `color` until it reaches `target` contrast on `bg`. */
export function ensureContrast(color, bg, target = 4.5) {
  let c = toHex(color) || '#000000';
  const towards = (luminance(bg) ?? 1) > 0.4 ? '#000000' : '#FFFFFF';
  for (let i = 0; i < 20 && (contrast(c, bg) ?? 0) < target; i += 1) {
    c = mix(c, towards, 0.12);
  }
  return c;
}

/* A full palette built around one brand colour. */
export function paletteFromBrand(brand, base) {
  const accent = toHex(brand);
  if (!accent) return null;
  const background = mix(accent, '#FFFFFF', 0.93);
  const text = base.text || '#1D1D1D';
  return {
    primary: ensureContrast(mix(accent, '#000000', 0.45), '#FFFFFF', 7),
    accent,
    accentDeep: ensureContrast(mix(accent, '#000000', 0.28), '#FFFFFF', 4.5),
    background,
    surface: '#FFFFFF',
    text,
    textMuted: ensureContrast(mix(text, background, 0.45), background, 4.5),
    success: base.success,
  };
}
