import { useEffect, useMemo, useRef, useState } from 'react';
import { Flame, Layers, MoveVertical, SquareDashedMousePointer } from 'lucide-react';
import { Card, CardBody, CardHeader, EmptyState, InfoTip, Segmented } from '../../ui';
import { fmtInt } from '../../ui/timeSeries';
import { fmtDuration } from '../../lib/behaviourFormat';
import { screenName } from '../behaviourCopy';
import { fmtRate } from '../behaviourModel';

/* ─────────────────────────────────────────────────────────────────────
 * The heatmap.
 *
 * Three ways of looking at one screen, over the same backdrop:
 *
 *   Taps      — every tap, blurred into heat. The classic view: where
 *               thumbs actually land, including where they land on
 *               nothing.
 *   Scroll    — how far down the page visits got, as bands. The line
 *               where the colour drops off is the line below which you
 *               are publishing to nobody.
 *   Controls  — the screen's own buttons, shaded by how much they are
 *               used, with the ones nobody touches left as outlines.
 *
 * THE BACKDROP IS NOT A SCREENSHOT. We never hold a picture of a
 * customer's screen. What we have is where the controls were
 * (`ux_layouts`, recorded as fractions of the page), so the card draws
 * that as a wireframe and lays the heat over it. It reads like the
 * screen without ever having photographed one.
 * ───────────────────────────────────────────────────────────────────── */

const VIEWS = [
  { id: 'taps', label: 'Taps', icon: Flame },
  { id: 'scroll', label: 'Scroll', icon: MoveVertical },
  { id: 'controls', label: 'Controls', icon: SquareDashedMousePointer },
];

/* Cool to warm, the convention every heatmap uses, in this dashboard's
 * own colours. Stops are [position, r, g, b]. */
const RAMP = [
  [0.00, 76, 111, 255],
  [0.35, 15, 138, 126],
  [0.62, 232, 147, 12],
  [1.00, 224, 52, 63],
];

function rampColor(t) {
  const v = Math.min(1, Math.max(0, t));
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

/* Draw the heat: an alpha pass of blurred blobs, then the ramp applied to
 * that alpha. Same two-step every heatmap library uses, and the reason the
 * result reads as one surface instead of a pile of circles. */
function paintHeat(canvas, cells, grid, intensity) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  if (!cells?.length || !w || !h) return;

  const max = Math.max(...cells.map(c => Number(c.n) || 0)) || 1;
  const radius = Math.max(14, Math.min(w, h) / 14) * intensity;

  ctx.globalCompositeOperation = 'source-over';
  for (const c of cells) {
    const x = ((Number(c.cx) + 0.5) / grid.cols) * w;
    const y = ((Number(c.cy) + 0.5) / grid.rows) * h;
    // A square-rooted weight, so one runaway hotspot doesn't flatten
    // everything else into invisibility.
    const a = Math.min(1, Math.sqrt((Number(c.n) || 0) / max)) * 0.85;
    const g = ctx.createRadialGradient(x, y, 0, x, y, radius);
    g.addColorStop(0, `rgba(0,0,0,${a})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3] / 255;
    if (!a) continue;
    const [r, g, b] = rampColor(a);
    d[i] = r; d[i + 1] = g; d[i + 2] = b;
    // Ease the alpha so the cool edge fades out instead of ringing.
    d[i + 3] = Math.round(Math.min(1, a * 1.25) * 235);
  }
  ctx.putImageData(img, 0, 0);
}

function HeatCanvas({ cells, grid, intensity }) {
  const ref = useRef(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return undefined;
    const draw = () => {
      const box = canvas.parentElement?.getBoundingClientRect();
      if (!box?.width) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(box.width * dpr);
      canvas.height = Math.round(box.height * dpr);
      canvas.style.width = `${box.width}px`;
      canvas.style.height = `${box.height}px`;
      paintHeat(canvas, cells, grid, intensity);
    };
    draw();
    const ro = new ResizeObserver(draw);
    if (canvas.parentElement) ro.observe(canvas.parentElement);
    return () => ro.disconnect();
  }, [cells, grid, intensity]);
  return <canvas ref={ref} className="uf-heat__canvas" aria-hidden="true" />;
}

/* The bands: each twentieth of the page, shaded by the share of visits
 * that got that far. */
function ScrollBands({ curve }) {
  const total = Number(curve?.[0]?.total) || 0;
  if (!total) return null;
  return (
    <div className="uf-heat__bands" aria-hidden="true">
      {curve.map((s) => {
        const share = Number(s.total) > 0 ? Number(s.reached) / Number(s.total) : 0;
        const [r, g, b] = rampColor(share);
        return (
          <div
            key={s.step}
            className="uf-band"
            style={{ background: `rgba(${r},${g},${b},${0.14 + share * 0.5})` }}
          >
            {(s.step === 5 || s.step === 10 || s.step === 15 || s.step === 20) && (
              <span className="uf-band__tag">
                {Math.round((s.step / curve.length) * 100)}% down · seen by {fmtRate(share * 100)}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function HeatmapCard({
  screens = [], screen, onScreen, data, loading, phrase, captureOff,
}) {
  const [view, setView] = useState('taps');
  const [intensity, setIntensity] = useState(1);
  const [hover, setHover] = useState(null);

  const cells = useMemo(() => data?.cells || [], [data]);
  const layout = data?.layout || null;
  const targets = useMemo(() => data?.targets || [], [data]);
  const grid = useMemo(() => data?.grid || { cols: 36, rows: 64 }, [data]);
  const row = screens.find(s => s.screen === screen) || null;

  const taps = cells.reduce((s, c) => s + (Number(c.n) || 0), 0);
  const tapsBySession = cells.reduce((s, c) => Math.max(s, Number(c.sessions) || 0), 0);
  const tapsByTarget = useMemo(
    () => Object.fromEntries(targets.map(t => [t.target, t])),
    [targets],
  );
  const maxTargetTaps = Math.max(1, ...targets.map(t => Number(t.taps) || 0));

  // The page is taller than the viewport, and both are recorded, so the
  // backdrop keeps the real proportions instead of guessing at them.
  const aspect = layout?.vw && layout?.dh
    ? Math.min(3.2, Math.max(0.6, layout.dh / layout.vw))
    : 2;
  const foldAt = layout?.vh && layout?.dh ? Math.min(0.96, layout.vh / layout.dh) : null;

  const nothing = !loading && !cells.length && !targets.length;

  return (
    <Card className="uf-heatcard">
      <CardHeader
        title="Where customers tap"
        icon={Flame}
        subtitle={row
          ? `${screenName(row.screen)} · ${fmtInt(row.views)} views from ${fmtInt(row.sessions)} visits ${phrase}`
          : `Pick a screen to see where taps land ${phrase}`}
        actions={<Segmented options={VIEWS} value={view} onChange={setView} ariaLabel="Heatmap view" />}
      />
      <CardBody flush>
        <div className="uf-heat">
          <div className="uf-heat__rail" role="tablist" aria-label="Screens">
            {screens.length === 0 && !loading && (
              <p className="uf-heat__railempty">No screen has been captured yet.</p>
            )}
            {screens.map((s) => {
              const busiest = Math.max(1, ...screens.map(x => Number(x.views) || 0));
              const share = (Number(s.views) || 0) / busiest;
              return (
                <button
                  key={s.screen}
                  type="button"
                  role="tab"
                  aria-selected={s.screen === screen}
                  className={`uf-screen${s.screen === screen ? ' uf-screen--on' : ''}`}
                  onClick={() => onScreen(s.screen)}
                >
                  <span className="uf-screen__bar" style={{ width: `${Math.max(4, share * 100)}%` }} />
                  <span className="uf-screen__name">{screenName(s.screen)}</span>
                  <span className="uf-screen__meta">
                    {fmtInt(s.views)} views
                    {Number(s.rage) > 0 && <em className="uf-screen__flag" title="Rage taps here">{fmtInt(s.rage)} rage</em>}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="uf-heat__stage">
            {nothing ? (
              <EmptyState icon={Layers} title={captureOff ? 'Capture is off' : 'Nothing captured for this screen'}>
                {captureOff
                  ? 'Switch capture on in Capture settings and taps start landing here within a few visits.'
                  : `No taps were recorded on this screen ${phrase}. Try a longer period, or a different device.`}
              </EmptyState>
            ) : (
              <>
                <div className="uf-heat__frame" style={{ aspectRatio: `1 / ${aspect}` }}>
                  {/* The wireframe: where the controls were. Never a screenshot. */}
                  <div className="uf-heat__wire" aria-hidden={view !== 'controls'}>
                    {(layout?.elements || []).map((el, i) => {
                      const t = tapsByTarget[el.k];
                      const heat = t ? (Number(t.taps) || 0) / maxTargetTaps : 0;
                      const [r, g, b] = rampColor(heat);
                      return (
                        <div
                          key={`${el.k}-${i}`}
                          className={`uf-el${view === 'controls' ? ' uf-el--on' : ''}${t ? '' : ' uf-el--cold'}`}
                          style={{
                            left: `${(el.x || 0) * 100}%`,
                            top: `${(el.y || 0) * 100}%`,
                            width: `${Math.max(0.02, el.w || 0) * 100}%`,
                            height: `${Math.max(0.006, el.h || 0) * 100}%`,
                            ...(view === 'controls' && t
                              ? { background: `rgba(${r},${g},${b},${0.16 + heat * 0.42})`, borderColor: `rgba(${r},${g},${b},0.75)` }
                              : null),
                          }}
                          onMouseEnter={view === 'controls' ? () => setHover({ el, t }) : undefined}
                          onMouseLeave={view === 'controls' ? () => setHover(null) : undefined}
                        >
                          <span className="uf-el__label">{el.l || el.k}</span>
                          {view === 'controls' && t && (
                            <span className="uf-el__count">{fmtInt(t.taps)}</span>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {view === 'taps' && <HeatCanvas cells={cells} grid={grid} intensity={intensity} />}
                  {view === 'scroll' && <ScrollBands curve={data?.curve || []} />}

                  {foldAt != null && view !== 'controls' && (
                    <div className="uf-heat__fold" style={{ top: `${foldAt * 100}%` }}>
                      <span>First screenful ends here</span>
                    </div>
                  )}
                </div>

                <div className="uf-heat__foot">
                  {view === 'taps' && (
                    <>
                      <span className="uf-heat__stat">
                        <strong>{fmtInt(taps)}</strong> taps
                        {tapsBySession > 0 && <> · busiest spot touched by <strong>{fmtInt(tapsBySession)}</strong> visits</>}
                      </span>
                      <span className="uf-heat__legend" aria-hidden="true">
                        <em>quiet</em>
                        <i className="uf-heat__ramp" />
                        <em>busy</em>
                      </span>
                      <label className="uf-heat__slider">
                        Spread
                        <input
                          type="range" min="0.6" max="1.8" step="0.1" value={intensity}
                          onChange={e => setIntensity(Number(e.target.value))}
                        />
                      </label>
                    </>
                  )}
                  {view === 'scroll' && (
                    <span className="uf-heat__stat">
                      {row?.avg_scroll != null
                        ? <>The average visit reaches <strong>{fmtRate(Number(row.avg_scroll) * 100)}</strong> of the way down this screen.</>
                        : <>No scrolling was recorded on this screen.</>}
                    </span>
                  )}
                  {view === 'controls' && (
                    <span className="uf-heat__stat">
                      {hover?.t ? (
                        <>
                          <strong>{hover.el.l || hover.el.k}</strong> — {fmtInt(hover.t.taps)} taps from {fmtInt(hover.t.sessions)} visits
                          {hover.t.median_ms != null && <> · typically {fmtDuration(Number(hover.t.median_ms))} after the screen opens</>}
                        </>
                      ) : hover ? (
                        <><strong>{hover.el.l || hover.el.k}</strong> — nobody tapped this {phrase}.</>
                      ) : (
                        <>
                          {fmtInt((layout?.elements || []).length)} controls on this screen,
                          {' '}{fmtInt((layout?.elements || []).filter(e => tapsByTarget[e.k]).length)} of them used.
                          {' '}Hover one for its numbers.
                        </>
                      )}
                    </span>
                  )}
                  <InfoTip label="How this is drawn">
                    The outlines are where the controls sat, recorded as fractions of the page. We never hold a picture of a customer’s screen.
                  </InfoTip>
                </div>
              </>
            )}
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
