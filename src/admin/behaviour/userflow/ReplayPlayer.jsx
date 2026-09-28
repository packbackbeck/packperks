import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown, Ban, Eye, LogOut, Pause, Play, Pointer, RotateCcw, Zap,
} from 'lucide-react';
import { Segmented, Switch } from '../../ui';
import { screenName } from '../behaviourCopy';
import ScreenFrame from './ScreenFrame';
import RecordingStage from './RecordingStage';
import { anchorPoints } from './heatPoints';

/* ─────────────────────────────────────────────────────────────────────
 * One visit, played back, with what happened listed beside it.
 *
 * Three parts that always agree, because they read one clock:
 *
 *   the screen     — the rrweb recording when the visit has one; otherwise
 *                    the venue's app as it is now, stepped through the
 *                    screens and scrolls the visit made (ScreenFrame).
 *                    Every tap is drawn where it landed, with the name of
 *                    the control it hit.
 *   What they did  — every screen opened, tap, scroll and exit, with its
 *                    time. The one happening now is highlighted; clicking
 *                    one jumps there and plays it.
 *   the transport  — play, the scrubber with a mark per action, speed,
 *                    and skipping the pauses.
 *
 * The list is built from ux_events, which carry the control's name; the
 * recording's clock and theirs are the same browser's clock, so an action
 * sits at `at − the recording's first timestamp`.
 * ───────────────────────────────────────────────────────────────────── */

const SPEEDS = [
  { id: '1', label: '1×' },
  { id: '2', label: '2×' },
  { id: '4', label: '4×' },
];
const KEPT = ['view', 'click', 'rage', 'dead', 'scroll', 'leave'];
const TAPS = ['click', 'rage', 'dead'];
const GAP_MIN = 500;
const GAP_MAX = 2200;
const LEAD_IN = 700; // a jump lands this far before the action, so it is seen happening

const ICON = { view: Eye, click: Pointer, rage: Zap, dead: Ban, scroll: ArrowDown, leave: LogOut };

function clockText(ms) {
  const s = Math.max(0, Math.round((Number(ms) || 0) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/* The visit's actions, as a person would list them: a run of scrolls on
 * one screen is one scroll, to the furthest point it reached. */
function toItems(events) {
  const out = [];
  for (const e of events || []) {
    if (!KEPT.includes(e.kind)) continue;
    const at = Date.parse(e.at);
    if (!Number.isFinite(at)) continue;
    const prev = out[out.length - 1];
    if (e.kind === 'scroll' && prev?.kind === 'scroll' && prev.screen === e.screen) {
      prev.depth = Math.max(prev.depth, Number(e.depth) || 0);
      continue;
    }
    out.push({ ...e, at, depth: Number(e.depth) || 0, key: `${e.seq}-${e.kind}` });
  }
  return out;
}

function describe(item) {
  const label = item.label ? <strong>{item.label}</strong> : null;
  switch (item.kind) {
    case 'view': return <>Opened <strong>{screenName(item.screen)}</strong></>;
    case 'click': return label ? <>Tapped {label}</> : 'Tapped the screen';
    case 'rage': return <>Tapped {label || 'the same spot'} again and again</>;
    case 'dead': return 'Tapped something that does nothing';
    case 'scroll': return `Scrolled ${Math.round(item.depth * 100)}% down`;
    case 'leave': return 'Left the app';
    default: return item.kind;
  }
}

export default function ReplayPlayer({ replay, recording, slug, device = 'mobile' }) {
  const hasRecording = Array.isArray(recording) && recording.length > 1;
  const raw = useMemo(() => toItems(replay?.events), [replay]);

  const [rec, setRec] = useState(null);           // { total, start, taps } once the recording is loaded
  const [recFailed, setRecFailed] = useState(false);
  const useRec = hasRecording && !recFailed;
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState('1');
  const [skipIdle, setSkipIdle] = useState(true);
  const [t, setT] = useState(0);
  const [seek, setSeek] = useState(null);

  /* Where each action sits on the clock. */
  const { items, total } = useMemo(() => {
    if (useRec) {
      if (!rec) return { items: [], total: 0 };
      let list = raw.map(i => ({ ...i, t: Math.max(0, Math.min(rec.total, i.at - rec.start)) }));
      // No capture rows to name them (clicks switched off, say): the
      // recording's own taps still say when something was pressed.
      if (!list.some(i => TAPS.includes(i.kind))) {
        list = [...list, ...rec.taps.map(p => ({ kind: 'click', t: p.t, key: `tap-${p.t}` }))]
          .sort((a, b) => a.t - b.t);
      }
      return { items: list, total: rec.total };
    }
    // Reconstructed: the visit's own gaps, squeezed so nobody watches a
    // ninety-second pause.
    const list = [];
    for (let n = 0; n < raw.length; n++) {
      const gap = n > 0 ? Math.min(GAP_MAX, Math.max(GAP_MIN, raw[n].at - raw[n - 1].at)) : 0;
      list.push({ ...raw[n], t: (n > 0 ? list[n - 1].t : 0) + gap });
    }
    return { items: list, total: list.length ? list[list.length - 1].t + 1500 : 0 };
  }, [useRec, rec, raw]);

  const nowIndex = useMemo(() => {
    let k = -1;
    for (let i = 0; i < items.length; i++) if (items[i].t <= t + 1) k = i;
    return k;
  }, [items, t]);
  const atEnd = total > 0 && t >= total - 60;

  /* The reconstructed clock. The recording keeps its own (RecordingStage). */
  const clock = useRef(0);
  useEffect(() => {
    if (useRec || !playing || !total) return undefined;
    let raf = 0;
    let last = performance.now();
    const tick = (now) => {
      clock.current = Math.min(total, clock.current + (now - last) * Number(speed));
      last = now;
      setT(clock.current);
      if (clock.current >= total) { setPlaying(false); return; }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [useRec, playing, total, speed]);

  const jump = useCallback((to, andPlay) => {
    const clamped = Math.max(0, Math.min(total, to));
    clock.current = clamped;
    setT(clamped);
    setSeek(s => ({ t: clamped, n: (s?.n || 0) + 1 }));
    if (andPlay != null) setPlaying(andPlay);
  }, [total]);

  const toggle = () => {
    if (atEnd) { jump(0, true); return; }
    setPlaying(p => !p);
  };

  /* Keep the current action in view in the list, without moving the page. */
  const list = useRef(null);
  useEffect(() => {
    const box = list.current;
    const row = box?.querySelector('[data-now="true"]');
    if (!box || !row) return;
    const top = row.offsetTop - box.offsetTop;
    if (top < box.scrollTop || top + row.offsetHeight > box.scrollTop + box.clientHeight) {
      box.scrollTo({ top: Math.max(0, top - box.clientHeight / 3), behavior: 'smooth' });
    }
  }, [nowIndex]);

  const onReady = useCallback(info => setRec(info), []);
  const onEnd = useCallback(() => setPlaying(false), []);
  const onFail = useCallback(() => setRecFailed(true), []);

  return (
    <div className="uf-rp">
      <div className="uf-rp__stage">
        {useRec ? (
          <RecordingStage
            events={recording}
            device={device}
            playing={playing}
            speed={Number(speed)}
            skipIdle={skipIdle}
            seek={seek}
            onReady={onReady}
            onTime={setT}
            onEnd={onEnd}
            onFail={onFail}
          />
        ) : (
          <SteppedStage items={items} nowIndex={nowIndex} t={t} slug={slug} device={device} />
        )}
      </div>

      <aside className="uf-rp__side">
        <header className="uf-rp__sidehead">
          <strong>What they did</strong>
          <span>{items.length ? `${items.length} actions` : ''}</span>
        </header>
        <ol className="uf-rp__steps" ref={list}>
          {!items.length && (
            <li className="uf-rp__none">{useRec && !rec ? 'Reading the recording…' : 'Nothing was captured in this visit.'}</li>
          )}
          {items.map((it, i) => {
            const Icon = ICON[it.kind] || Pointer;
            const state = i === nowIndex ? 'now' : i < nowIndex ? 'done' : 'next';
            return (
              <li key={it.key}>
                <button
                  type="button"
                  className={`uf-step uf-step--${it.kind} uf-step--${state}`}
                  data-now={i === nowIndex}
                  aria-current={i === nowIndex ? 'step' : undefined}
                  onClick={() => jump(it.t - LEAD_IN, true)}
                >
                  <span className="uf-step__time">{clockText(it.t)}</span>
                  <span className="uf-step__icon"><Icon size={13} aria-hidden="true" /></span>
                  <span className="uf-step__text">{describe(it)}</span>
                </button>
              </li>
            );
          })}
        </ol>
        <p className="uf-rp__source">
          {useRec
            ? 'Recorded on the customer’s own screen. Fields are masked and the profile is never recorded.'
            : 'No recording for this visit: the steps are played over the venue’s app as it looks today.'}
        </p>
      </aside>

      <div className="uf-tp">
        <div className="uf-tp__track">
          <span className="uf-tp__rail" />
          <span className="uf-tp__fill" style={{ width: `${total ? (t / total) * 100 : 0}%` }} />
          {items.filter(i => i.kind !== 'scroll').map(i => (
            <span
              key={i.key}
              className={`uf-tp__mark uf-tp__mark--${i.kind}`}
              style={{ left: `${total ? (i.t / total) * 100 : 0}%` }}
            />
          ))}
          <input
            type="range"
            min="0"
            max={Math.max(1, Math.round(total))}
            step="50"
            value={Math.round(t)}
            onChange={(e) => jump(Number(e.target.value))}
            aria-label="Position in the visit"
            disabled={!total}
          />
        </div>
        <div className="uf-tp__row">
          <button
            type="button"
            className="uf-tp__play"
            onClick={toggle}
            disabled={!total}
            aria-label={atEnd ? 'Play again' : playing ? 'Pause' : 'Play'}
          >
            {atEnd ? <RotateCcw size={16} aria-hidden="true" />
              : playing ? <Pause size={16} aria-hidden="true" />
                : <Play size={16} aria-hidden="true" />}
          </button>
          <span className="uf-tp__time">
            {clockText(t)} <em>/ {clockText(total)}</em>
          </span>
          <span className="uf-tp__spacer" />
          {useRec && (
            <label className="uf-tp__skip">
              <Switch checked={skipIdle} onChange={setSkipIdle} label="Skip pauses" />
              <span>Skip pauses</span>
            </label>
          )}
          <Segmented options={SPEEDS} value={speed} onChange={setSpeed} ariaLabel="Playback speed" />
        </div>
      </div>
    </div>
  );
}

/* A visit with no recording: its screens and scrolls, stepped through over
 * the app as it is now, and each tap put back on the control it hit. */
function SteppedStage({ items, nowIndex, t, slug, device }) {
  const [controls, setControls] = useState(null);
  const [geo, setGeo] = useState(null);
  const onControls = useCallback(m => setControls(m), []);
  const onGeometry = useCallback(g => setGeo(g), []);

  let screen = 'home';
  let depth = 0;
  for (let i = 0; i <= nowIndex && i < items.length; i++) {
    const it = items[i];
    if (it.screen) screen = it.screen;
    if (it.kind === 'view') depth = 0;
    if (it.kind === 'scroll') depth = it.depth;
  }

  // A tap is shown for a moment after it happens.
  const now = nowIndex >= 0 ? items[nowIndex] : null;
  const tap = now && TAPS.includes(now.kind) && t - now.t < 1400 ? now : null;
  const at = tap && geo ? anchorPoints([tap], controls, geo).pts[0] : null;

  return (
    <ScreenFrame
      slug={slug}
      screen={screen}
      device={device}
      scrollTo={depth}
      onControls={onControls}
      onGeometry={onGeometry}
      note="This venue has no address to preview yet."
    >
      {at && (
        <span key={tap.key}>
          <span className={`uf-rec__tap uf-rec__tap--${tap.kind}`} style={{ left: at[0], top: at[1] }} />
          {tap.label && (
            <span className="uf-rec__labelrow" style={{ top: at[1] + 36 }}>
              <span className="uf-rec__label">{tap.label}</span>
            </span>
          )}
        </span>
      )}
    </ScreenFrame>
  );
}
