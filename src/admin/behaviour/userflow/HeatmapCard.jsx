import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Flame, Layers, MoveVertical, SquareDashedMousePointer } from 'lucide-react';
import { Card, CardBody, CardHeader, EmptyState, InfoTip, Segmented } from '../../ui';
import { fmtInt } from '../../ui/timeSeries';
import { fmtDuration } from '../../lib/behaviourFormat';
import { screenName } from '../behaviourCopy';
import { fmtRate } from '../behaviourModel';
import ScreenFrame from './ScreenFrame';
import useFitHeight from './useFitHeight';
import { rampColor } from './heatRamp';

/* ─────────────────────────────────────────────────────────────────────
 * The heatmap.
 *
 * Three ways of looking at one screen, over the venue's actual app:
 *
 *   Taps      — every tap, blurred into heat. Where thumbs land,
 *               including where they land on nothing.
 *   Scroll    — how far down the page visits got, as bands. Where the
 *               colour drops off is the line below which you are
 *               publishing to nobody.
 *   Controls  — the screen's own buttons, shaded by how much they are
 *               used, with the ones nobody touches left cold.
 *
 * The screen underneath is the real customer app in a phone (ScreenFrame),
 * put on this screen and scrolling as a phone scrolls. The overlays are
 * drawn at fractions of the page, so they ride the same scroll.
 * ───────────────────────────────────────────────────────────────────── */

const VIEWS = [
  { id: 'taps', label: 'Taps', icon: Flame },
  { id: 'scroll', label: 'Scroll', icon: MoveVertical },
  { id: 'controls', label: 'Controls', icon: SquareDashedMousePointer },
];

/* Draw the heat: an alpha pass of blurred blobs, then the ramp applied to
 * that alpha. The same two steps every heatmap library uses, and the
 * reason the result reads as one surface instead of a pile of circles. */
function paintHeat(canvas, cells, grid, intensity) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  if (!cells?.length || !w || !h) return;

  const max = Math.max(...cells.map(c => Number(c.n) || 0)) || 1;
  const radius = Math.max(16, w / 9) * intensity;

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
    d[i + 3] = Math.round(Math.min(1, a * 1.3) * 225);
  }
  ctx.putImageData(img, 0, 0);
}

function HeatCanvas({ cells, grid, intensity, width, height }) {
  const ref = useRef(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !width || !height) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    paintHeat(canvas, cells, grid, intensity);
  }, [cells, grid, intensity, width, height]);
  return <canvas ref={ref} className="ufs-heat" aria-hidden="true" />;
}

/* The bands: each twentieth of the page, shaded by the share of visits
 * that got that far. */
function ScrollBands({ curve }) {
  const total = Number(curve?.[0]?.total) || 0;
  if (!total) return null;
  return (
    <div className="ufs-bands" aria-hidden="true">
      {curve.map((s) => {
        const share = Number(s.total) > 0 ? Number(s.reached) / Number(s.total) : 0;
        const [r, g, b] = rampColor(share);
        return (
          <div key={s.step} className="ufs-band" style={{ background: `rgba(${r},${g},${b},${0.22 + share * 0.5})` }}>
            {(s.step === 5 || s.step === 10 || s.step === 15 || s.step === 20) && (
              <span className="ufs-band__tag">
                {Math.round((s.step / curve.length) * 100)}% down · seen by {fmtRate(share * 100)}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* Controls, shaded by use. Their rectangles come from what capture
 * measured on the real visits, so they sit where the customer's controls
 * sat, at the same fractions of the page. */
function ControlHeat({ elements, byTarget, max, onHover }) {
  return (
    <div className="ufs-controls">
      {elements.map((el, i) => {
        const t = byTarget[el.k];
        const heat = t ? (Number(t.taps) || 0) / max : 0;
        const [r, g, b] = rampColor(heat);
        return (
          <div
            key={`${el.k}-${i}`}
            className={`ufs-control${t ? '' : ' ufs-control--cold'}`}
            style={{
              left: `${(Number(el.x) || 0) * 100}%`,
              top: `${(Number(el.y) || 0) * 100}%`,
              width: `${(Number(el.w) || 0) * 100}%`,
              height: `${(Number(el.h) || 0) * 100}%`,
              ...(t ? { background: `rgba(${r},${g},${b},${0.22 + heat * 0.5})`, borderColor: `rgb(${r},${g},${b})` } : null),
            }}
            onMouseEnter={() => onHover({ el, t })}
            onMouseLeave={() => onHover(null)}
          >
            {t && <span className="ufs-control__n">{fmtInt(t.taps)}</span>}
          </div>
        );
      })}
    </div>
  );
}

const DEVICE_WORD = { mobile: 'on a phone', tablet: 'on a tablet', desktop: 'on a desktop' };

export default function HeatmapCard({
  screens = [], screen, onScreen, data, loading, phrase, captureOff, slug, device, devicePicked,
}) {
  const [view, setView] = useState('taps');
  const [intensity, setIntensity] = useState(1);
  const [hover, setHover] = useState(null);
  const [geo, setGeo] = useState(null);
  const onGeometry = useCallback(g => setGeo(g), []);
  const fit = useRef(null);
  useFitHeight(fit);

  const cells = useMemo(() => data?.cells || [], [data]);
  const layout = data?.layout || null;
  const targets = useMemo(() => data?.targets || [], [data]);
  const grid = useMemo(() => data?.grid || { cols: 36, rows: 64 }, [data]);
  const row = screens.find(s => s.screen === screen) || null;

  const taps = cells.reduce((s, c) => s + (Number(c.n) || 0), 0);
  const busiest = cells.reduce((s, c) => Math.max(s, Number(c.sessions) || 0), 0);
  const byTarget = useMemo(() => Object.fromEntries(targets.map(t => [t.target, t])), [targets]);
  const maxTargetTaps = Math.max(1, ...targets.map(t => Number(t.taps) || 0));
  const controls = useMemo(
    () => (layout?.elements || []).filter(e => e.t === 'btn' || e.t === undefined),
    [layout],
  );

  const nothing = !loading && !cells.length && !targets.length;

  return (
    <Card className="uf-heatcard">
      <CardHeader
        title="Where customers tap"
        icon={Flame}
        subtitle={row
          ? `${screenName(row.screen)} ${DEVICE_WORD[device] || DEVICE_WORD.mobile}${devicePicked ? '' : ', where most of these visits were'} · ${fmtInt(row.views)} views from ${fmtInt(row.sessions)} visits ${phrase}`
          : `Pick a screen to see where taps land ${phrase}`}
        actions={<Segmented options={VIEWS} value={view} onChange={setView} ariaLabel="Heatmap view" />}
      />
      <CardBody flush>
        <div className="uf-heat" ref={fit}>
          <div className="uf-heat__rail" role="tablist" aria-label="Screens">
            {screens.length === 0 && !loading && (
              <p className="uf-heat__railempty">No screen has been captured yet.</p>
            )}
            {screens.map((s) => {
              const top = Math.max(1, ...screens.map(x => Number(x.views) || 0));
              const share = (Number(s.views) || 0) / top;
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
                <div className="uf-heat__phone">
                  <ScreenFrame
                    slug={slug}
                    screen={screen}
                    device={device || 'mobile'}
                    onGeometry={onGeometry}
                    note="This venue has no address to preview yet."
                  >
                    {view === 'taps' && (
                      <>
                        <span className="ufs-veil" aria-hidden="true" />
                        <HeatCanvas
                          cells={cells}
                          grid={grid}
                          intensity={intensity}
                          width={geo?.width}
                          height={geo?.pageHeight}
                        />
                      </>
                    )}
                    {view === 'scroll' && (
                      <>
                        <span className="ufs-veil" aria-hidden="true" />
                        <ScrollBands curve={data?.curve || []} />
                      </>
                    )}
                    {view === 'controls' && controls.length > 0 && (
                      <ControlHeat
                        elements={controls}
                        byTarget={byTarget}
                        max={maxTargetTaps}
                        onHover={setHover}
                      />
                    )}
                  </ScreenFrame>
                </div>

                <div className="uf-heat__foot">
                  {view === 'taps' && (
                    <>
                      <span className="uf-heat__stat">
                        <strong>{fmtInt(taps)}</strong> taps
                        {busiest > 0 && <> · busiest spot touched by <strong>{fmtInt(busiest)}</strong> visits</>}
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
                          <strong>{hover.t.label || hover.el.l || hover.el.k}</strong> — {fmtInt(hover.t.taps)} taps from {fmtInt(hover.t.sessions)} visits
                          {hover.t.median_ms != null && <> · typically {fmtDuration(Number(hover.t.median_ms))} after the screen opens</>}
                        </>
                      ) : hover ? (
                        <><strong>{hover.el.l || hover.el.k}</strong> — nobody tapped this {phrase}.</>
                      ) : controls.length ? (
                        <>
                          {fmtInt(controls.length)} controls measured on this screen,
                          {' '}{fmtInt(controls.filter(e => byTarget[e.k]).length)} of them used.
                          {' '}Hover one for its numbers.
                        </>
                      ) : (
                        <>No control rectangles for this screen yet — they are measured on the next visit.</>
                      )}
                    </span>
                  )}
                  <InfoTip label="What you are looking at">
                    The screen is this venue’s real app, opened read-only on the screen the taps belong to —
                    no account, no writes, nothing tracked. The heat is drawn over it at the same fractions
                    of the page the taps were measured at.
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
