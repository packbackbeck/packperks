import { useCallback, useMemo, useRef, useState } from 'react';
import { Flame, Layers, MoveVertical, SquareDashedMousePointer } from 'lucide-react';
import { Card, CardBody, CardHeader, EmptyState, InfoTip, Segmented } from '../../ui';
import { fmtInt } from '../../ui/timeSeries';
import { fmtDuration } from '../../lib/behaviourFormat';
import { screenName } from '../behaviourCopy';
import { fmtRate } from '../behaviourModel';
import ScreenFrame from './ScreenFrame';
import useFitHeight from './useFitHeight';
import { rampColor } from './heatRamp';
import { anchorPoints } from './heatPoints';
import HeatCanvas from './HeatCanvas';

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

/* Controls, shaded by use, drawn on the boxes the app is rendering RIGHT
 * NOW — read out of the embedded page rather than recalled from the
 * fractions one visit happened to measure. That is what keeps the outline
 * on the button instead of near it. */
function ControlHeat({ controls, byTarget, max, onHover }) {
  if (!controls?.size) return null;
  return (
    <div className="ufs-controls">
      {[...controls.entries()].map(([key, box]) => {
        const t = byTarget[key];
        const heat = t ? (Number(t.taps) || 0) / max : 0;
        const [r, g, b] = rampColor(heat);
        return (
          <div
            key={key}
            className={`ufs-control${t ? '' : ' ufs-control--cold'}`}
            style={{
              left: `${box.left}px`,
              top: `${box.top}px`,
              width: `${box.width}px`,
              height: `${box.height}px`,
              ...(t ? { background: `rgba(${r},${g},${b},${0.22 + heat * 0.5})`, borderColor: `rgb(${r},${g},${b})` } : null),
            }}
            onMouseEnter={() => onHover({ el: { k: key, l: box.label }, t })}
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
  /* Where the embedded app is drawing its controls right now. A tap is put
   * back on the control it hit, so this — not a remembered fraction — is
   * what decides where the heat goes. */
  const [controls, setControls] = useState(null);
  const onControls = useCallback(map => setControls(map), []);
  const fit = useRef(null);
  useFitHeight(fit);

  const cells = useMemo(() => data?.cells || [], [data]);
  const targets = useMemo(() => data?.targets || [], [data]);
  const row = screens.find(s => s.screen === screen) || null;

  const taps = cells.reduce((s, c) => s + (Number(c.n) || 0), 0);
  const busiest = cells.reduce((s, c) => Math.max(s, Number(c.sessions) || 0), 0);
  const byTarget = useMemo(() => Object.fromEntries(targets.map(t => [t.target, t])), [targets]);
  const maxTargetTaps = Math.max(1, ...targets.map(t => Number(t.taps) || 0));
  const points = useMemo(() => data?.points || [], [data]);
  const anchored = useMemo(
    () => (controls ? anchorPoints(points, controls, { width: geo?.width, pageHeight: geo?.pageHeight }) : null),
    [points, controls, geo?.width, geo?.pageHeight],
  );

  const nothing = !loading && !cells.length && !targets.length && !points.length;

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
                    onControls={onControls}
                    note="This venue has no address to preview yet."
                  >
                    {view === 'taps' && (
                      <>
                        <span className="ufs-veil" aria-hidden="true" />
                        <HeatCanvas
                          points={points}
                          controls={controls}
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
                    {view === 'controls' && (
                      <ControlHeat
                        controls={controls}
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
                        {/* Say which taps are on their control and which are
                            only near it: rows recorded before taps were
                            anchored can never be better than approximate. */}
                        {anchored?.loose > 0 && (
                          <InfoTip label={` · ${fmtInt(anchored.loose)} approximate`}>
                            {fmtInt(anchored.anchored)} of these taps are drawn on the control they
                            hit. {fmtInt(anchored.loose)} were recorded before taps carried their
                            control, so they are placed from the page position alone and can sit a
                            little off.
                          </InfoTip>
                        )}
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
