import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Hand, Monitor, Pause, Play, RotateCcw, Smartphone, Tablet, Video, VideoOff, Zap,
} from 'lucide-react';
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, Segmented } from '../../ui';
import { fmtInt } from '../../ui/timeSeries';
import { fmtDuration } from '../../lib/behaviourFormat';
import { screenName } from '../behaviourCopy';
import ScreenPaint, { ScreenPaintEmpty } from './ScreenPaint';

/* ─────────────────────────────────────────────────────────────────────
 * Session replay.
 *
 * WHAT THIS IS, EXACTLY. Not a video and not a recording of the page.
 * Nothing a customer typed or had in a field is stored anywhere, and no
 * screenshot is ever taken. What is stored is the ordered stream of what
 * they DID — screen opened, scrolled this far, tapped here, left — and
 * this plays it back over the same repainted screen the heatmap uses
 * (ScreenPaint), which capture rebuilt from the page's own measurements.
 * So it looks like the venue's app, and you watch the behaviour rather
 * than the person.
 *
 * It only lists visits captured while the venue had replay switched on
 * (`ux_sessions.replay`, written by ux-ingest from the venue's own
 * setting), so turning it off hides everything it was off for rather
 * than quietly keeping it.
 *
 * The clock is the visit's own, with idle gaps squeezed to a couple of
 * seconds — nobody needs to watch a real ninety-second pause.
 * ───────────────────────────────────────────────────────────────────── */

const SPEEDS = [
  { id: '1', label: '1×' },
  { id: '2', label: '2×' },
  { id: '4', label: '4×' },
];
const MAX_GAP_MS = 2000;
const DEVICE_ICON = { mobile: Smartphone, tablet: Tablet, desktop: Monitor };

function when(iso) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  return new Date(t).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

/* The visit's steps, each with how long to hold on it. */
function toSteps(events) {
  const kept = (events || []).filter(e => ['view', 'click', 'rage', 'dead', 'scroll', 'leave'].includes(e.kind));
  return kept.map((e, i) => {
    const next = kept[i + 1];
    const raw = next ? Date.parse(next.at) - Date.parse(e.at) : 900;
    const hold = Number.isFinite(raw) ? Math.min(MAX_GAP_MS, Math.max(220, raw)) : 700;
    return { ...e, hold };
  });
}

export default function ReplayCard({
  sessions = [], replayOn, loading, phrase, selected, onSelect, replay, replayLoading, onOpenSettings,
}) {
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState('2');
  const [at, setAt] = useState(0);
  const timer = useRef(null);
  const stage = useRef(null);

  const steps = useMemo(() => toSteps(replay?.events), [replay]);
  const step = steps[Math.min(at, Math.max(0, steps.length - 1))] || null;

  const layout = useMemo(() => {
    if (!step || !replay?.layouts?.length) return null;
    const device = replay.session?.device || 'mobile';
    return replay.layouts.find(l => l.screen === step.screen && l.device === device)
      || replay.layouts.find(l => l.screen === step.screen)
      || null;
  }, [step, replay]);

  // Advance on the visit's own clock, scaled by the chosen speed. At the
  // end there is simply nothing left to schedule, and the button turns
  // into "Again".
  const atEnd = at >= steps.length - 1;
  useEffect(() => {
    if (!playing || atEnd || !steps.length) return undefined;
    const hold = steps[at]?.hold || 700;
    timer.current = setTimeout(() => setAt(i => i + 1), hold / Number(speed));
    return () => clearTimeout(timer.current);
  }, [playing, atEnd, at, steps, speed]);

  // A different visit starts from its own beginning. Reset while
  // rendering rather than in an effect, so the old visit's position is
  // never painted against the new one's steps.
  const [shown, setShown] = useState(selected);
  if (shown !== selected) {
    setShown(selected);
    setAt(0);
    setPlaying(false);
  }

  const restart = useCallback(() => { setAt(0); setPlaying(true); }, []);

  const viewportH = layout?.vh && layout?.dh ? layout.vh / layout.dh : 0.5;
  // Where the viewport sits: the last scroll we saw, held until the next.
  const held = useMemo(() => {
    let d = 0;
    for (let i = 0; i <= at && i < steps.length; i++) {
      if (steps[i].kind === 'view') d = 0;
      if (steps[i].kind === 'scroll' && Number.isFinite(Number(steps[i].depth))) d = Number(steps[i].depth);
    }
    return d;
  }, [at, steps]);

  /* The screen is a scroll window over the whole page now, so the part the
   * customer was looking at has to be brought into view — otherwise a visit
   * that scrolls plays out somewhere off the bottom of the card. */
  useEffect(() => {
    const win = stage.current?.querySelector('.sp__window');
    const box = stage.current?.querySelector('.sp-viewport__box');
    if (!win || !box) return;
    const top = box.offsetTop - (win.clientHeight - box.clientHeight) / 2;
    win.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
  }, [held, at]);

  const elapsed = step && replay?.session
    ? Math.max(0, Date.parse(step.at) - Date.parse(replay.session.started_at))
    : 0;

  if (!replayOn) {
    return (
      <Card className="uf-replay">
        <CardHeader title="Session replay" icon={VideoOff} subtitle="Off for this venue" />
        <CardBody>
          <EmptyState
            icon={VideoOff}
            title="Replay is switched off for this venue"
            action={onOpenSettings && <Button variant="outline" onClick={onOpenSettings}>Open Capture settings</Button>}
          >
            Someone turned it off in Capture settings. Nothing is kept for replay while it is off, and
            visits captured during that time stay unlistable even after it is turned back on — so this
            shows the gap honestly rather than quietly filling it in.
          </EmptyState>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card className="uf-replay">
      <CardHeader
        title="Session replay"
        icon={Video}
        subtitle={`Visits captured ${phrase}, played back from what was tapped — never from a recording of the screen.`}
        actions={<Badge tone="violet">{fmtInt(sessions.length)} visits</Badge>}
      />
      <CardBody flush>
        <div className="uf-replay__body">
          <div className="uf-replay__list" role="list">
            {loading && <div className="uf-replay__skel" aria-busy="true" />}
            {!loading && !sessions.length && (
              <p className="uf-replay__empty">No visit was captured for replay {phrase}.</p>
            )}
            {sessions.map((s) => {
              const Icon = DEVICE_ICON[s.device] || Smartphone;
              return (
                <button
                  key={s.session_id}
                  type="button"
                  role="listitem"
                  className={`uf-visit${s.session_id === selected ? ' uf-visit--on' : ''}`}
                  onClick={() => onSelect(s.session_id)}
                >
                  <span className="uf-visit__icon"><Icon size={14} aria-hidden="true" /></span>
                  <span className="uf-visit__main">
                    <strong>{when(s.started_at)}</strong>
                    <em>
                      {fmtDuration(Number(s.duration_ms) || 0) || '0 sec'} · {fmtInt(s.screens)} screens · {fmtInt(s.clicks)} taps
                    </em>
                  </span>
                  {Number(s.rage) > 0 && (
                    <span className="uf-visit__rage" title="Rage taps in this visit">
                      <Zap size={12} aria-hidden="true" />{fmtInt(s.rage)}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="uf-replay__stage" ref={stage}>
            {!selected ? (
              <EmptyState icon={Play} title="Pick a visit">
                Choose one on the left and watch it play out: screens opening, the page scrolling, each tap
                where it landed.
              </EmptyState>
            ) : replayLoading ? (
              <div className="uf-replay__loading" aria-busy="true">Loading the visit…</div>
            ) : !steps.length ? (
              <EmptyState icon={Play} title="Nothing to play">
                This visit has no steps left — it may have fallen outside the venue’s retention window.
              </EmptyState>
            ) : (
              <>
                {layout ? (
                  <ScreenPaint layout={layout} className="uf-replay__paint">
                    {/* What the customer could actually see at this moment:
                        everything outside it is behind the fold for them. */}
                    <div className="sp-overlay sp-viewport" aria-hidden="true">
                      <div className="sp-viewport__shade" style={{ height: `${held * (1 - viewportH) * 100}%` }} />
                      <div className="sp-viewport__box" style={{ height: `${viewportH * 100}%` }} />
                    </div>
                    {step && (step.kind === 'click' || step.kind === 'rage' || step.kind === 'dead') && step.x != null && (
                      <span
                        key={`${step.seq}`}
                        className={`sp-tap sp-tap--${step.kind}`}
                        style={{ left: `${Number(step.x) * 100}%`, top: `${Number(step.y) * 100}%` }}
                      />
                    )}
                    <div className="uf-replay__caption">
                      <strong>{screenName(step?.screen)}</strong>
                      <span>
                        {step?.kind === 'view' && 'opened this screen'}
                        {step?.kind === 'scroll' && `scrolled to ${Math.round((Number(step.depth) || 0) * 100)}%`}
                        {step?.kind === 'click' && `tapped ${step.label || 'the screen'}`}
                        {step?.kind === 'rage' && `tapped ${step.label || 'here'} again — nothing happened`}
                        {step?.kind === 'dead' && 'tapped something that does nothing'}
                        {step?.kind === 'leave' && 'left'}
                      </span>
                    </div>
                  </ScreenPaint>
                ) : (
                  <ScreenPaintEmpty note={`${screenName(step?.screen)} — this visit is from before screen snapshots were switched on, so there is no picture to play it over.`} />
                )}

                <div className="uf-replay__controls">
                  <Button
                    size="sm"
                    variant="primary"
                    icon={atEnd ? RotateCcw : playing ? Pause : Play}
                    onClick={() => (atEnd ? restart() : setPlaying(p => !p))}
                  >
                    {atEnd ? 'Again' : playing ? 'Pause' : 'Play'}
                  </Button>
                  <input
                    className="uf-replay__scrub"
                    type="range"
                    min="0"
                    max={Math.max(0, steps.length - 1)}
                    value={at}
                    onChange={(e) => { setPlaying(false); setAt(Number(e.target.value)); }}
                    aria-label="Position in the visit"
                  />
                  <span className="uf-replay__time">{fmtDuration(elapsed) || '0 sec'}</span>
                  <Segmented options={SPEEDS} value={speed} onChange={setSpeed} ariaLabel="Playback speed" />
                </div>

                <div className="uf-replay__marks" aria-hidden="true">
                  {steps.map((s, i) => (
                    <span
                      key={s.seq}
                      className={`uf-mark uf-mark--${s.kind}${i === at ? ' uf-mark--now' : ''}`}
                      style={{ left: `${(i / Math.max(1, steps.length - 1)) * 100}%` }}
                    />
                  ))}
                </div>

                <p className="uf-replay__note">
                  <Hand size={13} aria-hidden="true" />
                  Reconstructed: the taps and scrolls this visit made, played over a screen rebuilt from
                  what capture measured. The page itself was never recorded, so nothing typed or shown in
                  a field exists to play back.
                </p>
              </>
            )}
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
