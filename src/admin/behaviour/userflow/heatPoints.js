import simpleheat from 'simpleheat';
import { rampColor } from './heatRamp';

/* ─────────────────────────────────────────────────────────────────────
 * Putting a tap back where it landed.
 *
 * THE MISTAKE THIS REPLACES. A tap used to be stored as a fraction of the
 * document height of the visit it happened in, and drawn against the
 * height of whatever the preview happens to be. Those are three different
 * numbers. On the home screen the page ran from 1153px to 1947px between
 * visits, so one button's taps were filed anywhere across a sixth of the
 * screen — measured, 154px of spread on a button 48px tall.
 *
 * WHAT IT DOES INSTEAD. Every tap already carries the key of the control
 * it hit and where inside that control's box the finger landed. The
 * dashboard reads the control's real rectangle out of the embedded app
 * (ScreenFrame → lib/uxKeys.measureControls) and puts the tap back on it:
 *
 *     x = box.left + ox · box.width
 *     y = box.top  + oy · box.height
 *
 * The page can be any height on any visit and the tap still lands on its
 * button. This is the approach the tools that do this well converged on —
 * Clarity aggregates per DOM element, PostHog's clickmap does the same and
 * says plainly that coordinate heatmaps "drift onto non-clickable areas".
 *
 * A tap that hit nothing (a dead tap) has no control to anchor to, so it
 * keeps its page pixels, scaled from the width it was recorded at to the
 * width being drawn — Mixpanel's trick of keeping the page dimensions
 * beside the click rather than baking a ratio into it. A tap on a pinned
 * control (a sheet, a modal, the cookie banner) was never given the scroll
 * position, so its y is measured from the top of the viewport.
 *
 * Old rows have none of this and fall back to the fractions they do have,
 * which is the best that can be done for them.
 * ───────────────────────────────────────────────────────────────────── */

/**
 * @param {Array} points  rows from ux_points
 * @param {Map}   controls  key → {left, top, width, height, pinned}
 * @param {{width:number, pageHeight:number}} geo  the embedded page
 * @returns {{pts: Array<[number, number, number]>, anchored: number, loose: number}}
 */
export function anchorPoints(points, controls, geo) {
  const out = [];
  let anchored = 0;
  let loose = 0;
  if (!Array.isArray(points) || !geo?.width || !geo?.pageHeight) {
    return { pts: out, anchored, loose };
  }

  for (const p of points) {
    const box = p.target ? controls?.get(p.target) : null;
    let x;
    let y;

    if (box && p.ox != null && p.oy != null) {
      // The control it hit, where it hit it.
      x = box.left + Number(p.ox) * box.width;
      y = box.top + Number(p.oy) * box.height;
      anchored += 1;
    } else if (box) {
      // Knows the control but not where in it (an older row): the middle
      // of the button is still the right button.
      x = box.left + box.width / 2;
      y = box.top + box.height / 2;
      anchored += 1;
    } else if (p.px != null && p.py != null && p.vw) {
      // No control: page pixels, rescaled from the width they were taken at.
      const k = geo.width / Number(p.vw);
      x = Number(p.px) * k;
      y = Number(p.py) * (p.pinned ? 1 : k);
      loose += 1;
    } else if (p.x != null && (p.y != null || p.yv != null)) {
      // Everything recorded before this existed. `y` is a fraction of a
      // page height we no longer have, so it is only ever approximate.
      x = Number(p.x) * geo.width;
      y = Number(p.y != null ? p.y : p.yv) * geo.pageHeight;
      loose += 1;
    } else {
      continue;
    }

    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    // A rage tap is three taps' worth of frustration in one row.
    out.push([x, y, p.kind === 'rage' ? 3 : 1]);
  }
  return { pts: out, anchored, loose };
}

/* simpleheat draws the alpha surface — blurred blobs summed into one
 * field, which is what makes heat read as a surface rather than a pile of
 * circles — and the ramp is then applied to that alpha so the colours are
 * this dashboard's, not the library's. */
export function paintHeat(canvas, pts, width, height, intensity, dpr) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!pts.length) return;

  const heat = simpleheat(canvas);
  // Roughly a thumb, scaled to the device and to the intensity slider.
  const radius = Math.max(10, Math.round((width / 11) * intensity));
  heat.data(pts.map(([x, y, v]) => [x * dpr, y * dpr, v]));
  heat.radius(radius * dpr, Math.round(radius * 0.7 * dpr));
  // One tap must still be visible; a busy spot must not wash the rest out.
  heat.max(Math.max(2, Math.ceil(pts.length / 12)));
  heat.gradient({ 0.25: '#000', 1: '#000' });   // alpha only; the ramp colours it
  heat.draw(0.02);

  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3] / 255;
    if (!a) continue;
    const [r, g, b] = rampColor(a);
    d[i] = r; d[i + 1] = g; d[i + 2] = b;
    d[i + 3] = Math.round(Math.min(1, a * 1.25) * 225);
  }
  ctx.putImageData(img, 0, 0);
  void height;
}
