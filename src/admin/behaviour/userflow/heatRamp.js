/* ─────────────────────────────────────────────────────────────────────
 * The heat scale.
 *
 * Cool to warm, the convention every heatmap uses, in this dashboard's
 * own colours. It is a DATA scale, not a theme colour: it reads the same
 * in light and dark, because "red means busy" must not depend on which
 * one the venue happens to be in.
 *
 * Its own file so the canvas, the scroll bands and the control shading
 * share one definition — three places drawing three different reds was
 * how the first version read as three unrelated charts.
 * ───────────────────────────────────────────────────────────────────── */

const RAMP = [
  [0.00, 76, 111, 255],
  [0.35, 15, 138, 126],
  [0.62, 232, 147, 12],
  [1.00, 224, 52, 63],
];

/** A point on the scale, 0…1, as [r, g, b]. */
export function rampColor(t) {
  const v = Math.min(1, Math.max(0, Number(t) || 0));
  for (let i = 1; i < RAMP.length; i++) {
    if (v <= RAMP[i][0]) {
      const [p0, r0, g0, b0] = RAMP[i - 1];
      const [p1, r1, g1, b1] = RAMP[i];
      const k = p1 === p0 ? 0 : (v - p0) / (p1 - p0);
      return [
        Math.round(r0 + (r1 - r0) * k),
        Math.round(g0 + (g1 - g0) * k),
        Math.round(b0 + (b1 - b0) * k),
      ];
    }
  }
  const last = RAMP[RAMP.length - 1];
  return [last[1], last[2], last[3]];
}

/** The same scale as a CSS gradient, for a legend. */
export const RAMP_CSS = `linear-gradient(90deg, ${RAMP.map(([, r, g, b]) => `rgb(${r} ${g} ${b})`).join(', ')})`;
