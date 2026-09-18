import { createContext, useEffect, useMemo } from 'react';
import { ensureContrast, hexToRgb, mix, toHex } from '../admin/appdesign/colorUtils';

/* ─────────────────────────────────────────────────────────────────────
 * The staff app wears the venue's customer-app colours (App design →
 * colours, published per organisation). A venue with none keeps the
 * PackPerks look in staff.css. Everything is derived from the eight
 * palette colours, with contrast checked so text and the QR code stay
 * readable whatever the venue picked.
 * ───────────────────────────────────────────────────────────────────── */

/* The PackPerks look, and the QR colours that go with it. */
export const DEFAULT_TONES = {
  ink: { module: '#1C1A17', ring: '#1C1A17', center: '#5333A5' },
  active: { module: '#CDC3EC', ring: '#B9ABE6', center: '#9A86DD' },
  ghost: { module: '#EAE4DA', ring: '#E2DBCF', center: '#E2DBCF' },
};
const DEFAULT_BG = '#F6F2EC';

/* The QR code's colours for the venue on screen. */
export const ToneContext = createContext(DEFAULT_TONES);

const rgba = (hex, a) => {
  const c = hexToRgb(hex);
  return c ? `rgba(${c.r}, ${c.g}, ${c.b}, ${a})` : undefined;
};

export function staffTheme(colors) {
  const c = {};
  for (const [k, v] of Object.entries(colors || {})) {
    const hex = toHex(v);
    if (hex) c[k] = hex;
  }
  if (!c.primary && !c.accent) return { vars: null, tones: DEFAULT_TONES, bg: DEFAULT_BG };

  const bg = c.background || '#F6F2EC';
  const card = c.surface || '#FFFFFF';
  const text = ensureContrast(c.text || '#1C1A17', card, 7);
  const accent = ensureContrast(c.primary || c.accent, '#FFFFFF', 4.5);
  const glow = c.accentDeep || c.accent || accent;
  const success = ensureContrast(c.success || '#2E7D4F', card, 4.5);
  const muted = ensureContrast(c.textMuted || mix(text, bg, 0.5), bg, 4.5);

  const vars = {
    '--st-bg': bg,
    '--st-card': card,
    '--st-field': mix(card, bg, 0.4),
    '--st-ink': text,
    '--st-ink-2': mix(text, card, 0.2),
    '--st-muted': muted,
    '--st-faint': mix(muted, bg, 0.35),
    '--st-line': mix(bg, text, 0.09),
    '--st-line-2': mix(card, text, 0.05),
    '--st-tint': mix(bg, text, 0.025),
    '--st-accent': accent,
    '--st-accent-hover': mix(accent, '#000000', 0.16),
    '--st-accent-soft': mix(accent, card, 0.92),
    '--st-accent-ring': rgba(accent, 0.12),
    '--st-accent-glow': rgba(accent, 0.9),
    '--st-beam': mix(glow, '#FFFFFF', 0.35),
    '--st-edge': mix(accent, card, 0.7),
    '--st-green': success,
    '--st-green-soft': mix(success, card, 0.9),
    '--st-shadow': `0 1px 1px ${rgba(text, 0.03)}, 0 20px 44px -30px ${rgba(text, 0.3)}`,
  };

  const faintInk = mix(bg, text, 0.07);
  const tones = {
    ink: { module: text, ring: text, center: accent },
    active: { module: mix(accent, card, 0.76), ring: mix(accent, card, 0.66), center: mix(glow, card, 0.4) },
    ghost: { module: faintInk, ring: mix(bg, text, 0.1), center: mix(bg, text, 0.1) },
  };
  return { vars, tones, bg };
}

export function useStaffTheme(colors) {
  const key = JSON.stringify(colors || {});
  const theme = useMemo(() => staffTheme(JSON.parse(key)), [key]);

  // The page behind the app column and the phone's status bar follow along.
  useEffect(() => {
    const root = document.getElementById('root');
    const meta = document.querySelector('meta[name="theme-color"]');
    const before = { root: root?.style.background, meta: meta?.getAttribute('content') };
    if (root) root.style.background = theme.bg;
    meta?.setAttribute('content', theme.bg);
    return () => {
      if (root) root.style.background = before.root || '';
      if (meta && before.meta) meta.setAttribute('content', before.meta);
    };
  }, [theme.bg]);

  return theme;
}
