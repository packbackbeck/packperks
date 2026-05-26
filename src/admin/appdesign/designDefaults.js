/* ─────────────────────────────────────────────────────────────────────
 * designDefaults — canonical schema for the per-org design payload.
 *
 * Lives under settings.design in the published app_config row, so it
 * inherits the same per-org isolation that everything else in
 * settings already has.
 *
 * Three groups:
 *   • colors   — applied to the user app via CSS variables on :root
 *   • copy     — button/label text the user app reads at render time
 *   • sections — visibility toggles for individual UI blocks beyond
 *                the existing feature flags (those still live in
 *                Quick Settings to keep that one click handy)
 *
 * Every consumer should merge with DEFAULT_DESIGN before reading so a
 * brand-new org (or a legacy row that predates this schema) doesn't
 * crash on a missing key.
 * ───────────────────────────────────────────────────────────────────── */

export const DEFAULT_DESIGN = {
  colors: {
    primary:     '#502314', // CTAs, headings, dark strokes (was --bk-brown)
    accent:      '#FEA01E', // highlights, progress gradient start (was --bk-orange)
    accentDeep:  '#E24400', // deeper accent, "FREE" pills, gradient end (was --bk-red)
    background:  '#F4EBDC', // page background (was --bk-cream)
    surface:     '#FFFFFF', // card / sheet background
    text:        '#1D1D1D', // body text
    textMuted:   '#6C6259', // secondary text
    success:     '#1A8737', // success / unlocked states
  },
  copy: {
    badgeText:           'My Cups',
    shareButtonLabel:    'Share a cup',
    donateButtonLabel:   'Donate cups',
    nextCupFreeLabel:    'Next cup for free',
    activityLabel:       'Activity',
    refundButtonLabel:   'Get direct refund',
  },
  sections: {
    showShareCup:        true,
    showDonate:          true,
    showNextCupForFree:  true,
    showActivity:        true,
    showDirectRefund:    true,
    // Lifetime impact card (cups returned + plastic avoided + a
    // playful comparison). Defaults ON because most pilots will want
    // the sustainability framing; orgs running a pure-loyalty
    // campaign can switch it off.
    showImpact:          true,
  },
};

export function mergeDesign(partial) {
  const p = partial || {};
  return {
    colors:   { ...DEFAULT_DESIGN.colors,   ...(p.colors   || {}) },
    copy:     { ...DEFAULT_DESIGN.copy,     ...(p.copy     || {}) },
    sections: { ...DEFAULT_DESIGN.sections, ...(p.sections || {}) },
  };
}

/* CSS-variable map: which design tokens override which existing root
 * variable in index.css. Keeping this here means the user-app components
 * never have to know about the design system — they keep using
 * var(--bk-*) and we just retarget those vars at the org's palette. */
export const COLOR_VAR_MAP = {
  primary:    '--bk-brown',
  accent:     '--bk-orange',
  accentDeep: '--bk-red',
  background: '--bk-cream',
  surface:    '--white',
  text:       '--black',
  textMuted:  '--text-muted',
  success:    '--bk-green',
};

/* Apply a design.colors object to the document root so the user app
 * picks up the new palette without component changes. Safe to call
 * with `null` — restores to the index.css defaults. */
export function applyDesignColors(colors) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (!colors) {
    Object.values(COLOR_VAR_MAP).forEach(v => root.style.removeProperty(v));
    return;
  }
  for (const [key, cssVar] of Object.entries(COLOR_VAR_MAP)) {
    if (colors[key]) root.style.setProperty(cssVar, colors[key]);
  }
}
