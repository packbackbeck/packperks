import { useEffect, useRef, useState } from 'react';
import { labelFor, pressableAncestor } from '../../../lib/uxKeys';
import DeviceChrome from './DeviceChrome';

/* ─────────────────────────────────────────────────────────────────────
 * The visit itself, played back.
 *
 * rrweb recorded a snapshot of the DOM and every change to it while the
 * customer was there; its Replayer rebuilds that in an iframe and plays
 * it. Not a re-enactment over a sample screen: the screen they had, at the
 * size they had it, scrolling when they scrolled.
 *
 * We drive the Replayer ourselves rather than use rrweb-player. The stock
 * player brings its own controller, sized for a desktop page, with a
 * mouse cursor on a phone and nothing to say what was tapped. Here the
 * device, the transport and the list of what happened are the dashboard's
 * own, and every tap is drawn: a pulse where the finger landed and an
 * outline on the control it hit, with that control's name.
 *
 * This component owns the Replayer and the clock. The parent says whether
 * it is playing, how fast, and where to seek to; it hears the time back
 * (`onTime`), the length and the taps once they are known (`onReady`), and
 * the end (`onEnd`).
 *
 * What is never in a recording: anything typed (`maskAllInputs` replaces
 * every field's value before it leaves the browser) and the profile block,
 * which is blocked outright. See src/lib/uxCapture.js.
 * ───────────────────────────────────────────────────────────────────── */

// rrweb's numbers: an IncrementalSnapshot (3) from MouseInteraction (2).
const INCREMENTAL = 3;
const META = 4;
const MOUSE_INTERACTION = 2;
const CLICK = 2;
const TOUCH_START = 7;
const PULSE_MS = 1600;

/** Unpack what the recorder packed: base64 (jsonb will not hold the raw
 *  deflate bytes) around rrweb's own packed string. */
function unpackAll(raw, unpack) {
  const out = [];
  for (const r of raw) {
    try { out.push(typeof r === 'string' ? unpack(atob(r)) : r); } catch { /* a damaged chunk */ }
  }
  return out.sort((a, b) => a.timestamp - b.timestamp);
}

/** Every tap in the recording, on the visit's own clock. A tap on a phone
 *  arrives as a touch and then a click; the click is the one that did
 *  something, so touches count only where no click followed. */
function tapsOf(events, start) {
  const clicks = [];
  const touches = [];
  for (const e of events) {
    if (e.type !== INCREMENTAL || e.data?.source !== MOUSE_INTERACTION) continue;
    const tap = { t: e.timestamp - start, x: e.data.x, y: e.data.y, id: e.data.id };
    if (e.data.type === CLICK) clicks.push(tap);
    else if (e.data.type === TOUCH_START) touches.push(tap);
  }
  const lone = touches.filter(t => !clicks.some(c => c.t >= t.t && c.t - t.t < 900));
  return [...clicks, ...lone].sort((a, b) => a.t - b.t);
}

export default function RecordingStage({
  events, device = 'mobile', playing, speed = 1, skipIdle = true, seek, onReady, onTime, onEnd, onFail,
}) {
  const root = useRef(null);
  const player = useRef(null);
  const meta = useRef({ total: 0, taps: [] });
  const clock = useRef(0);        // where the replay is, ms from the start
  const seen = useRef(0);         // taps before this time have been drawn
  const [size, setSize] = useState(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [pulses, setPulses] = useState([]);

  // Callbacks read through a ref, so a parent re-rendering never tears the
  // Replayer down.
  const cb = useRef({ onReady, onTime, onEnd, onFail });
  useEffect(() => { cb.current = { onReady, onTime, onEnd, onFail }; });

  /* Build the Replayer once per recording. */
  useEffect(() => {
    const el = root.current;
    if (!el || !Array.isArray(events) || events.length < 2) return undefined;
    let dead = false;
    let rep = null;

    (async () => {
      try {
        const [{ Replayer }, { unpack }] = await Promise.all([
          import('rrweb'),
          import('@rrweb/packer/unpack'),
          import('rrweb/dist/style.css'),
        ]);
        if (dead) return;
        const evs = unpackAll(events, unpack);
        if (evs.length < 2) throw new Error('empty');
        const start = evs[0].timestamp;
        const first = evs.find(e => e.type === META);
        const w = Number(first?.data?.width) || 375;
        const h = Number(first?.data?.height) || 812;

        rep = new Replayer(evs, {
          root: el,
          speed,
          skipInactive: skipIdle,
          mouseTail: false,
          showWarning: false,
          triggerFocus: false,
        });
        rep.on('resize', (d) => {
          if (!dead && d?.width && d?.height) setSize({ w: d.width, h: d.height });
        });
        rep.on('finish', () => {
          if (dead) return;
          clock.current = meta.current.total;
          cb.current.onTime?.(meta.current.total);
          cb.current.onEnd?.();
        });
        player.current = rep;
        const total = Math.max(1, rep.getMetaData().totalTime);
        const taps = tapsOf(evs, start);
        meta.current = { total, taps, start };
        clock.current = 0;
        seen.current = 0;
        setSize({ w, h });
        setReady(true);
        rep.pause(0);
        cb.current.onReady?.({ total, start, taps });
      } catch {
        if (dead) return;
        setFailed(true);
        cb.current.onFail?.();
      }
    })();

    return () => {
      dead = true;
      player.current = null;
      setReady(false);
      setPulses([]);
      try { rep?.destroy(); } catch { /* already gone */ }
      if (el) el.innerHTML = '';
    };
    // speed and skipIdle are applied by their own effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events]);

  useEffect(() => { player.current?.setConfig({ speed }); }, [speed, ready]);
  useEffect(() => { player.current?.setConfig({ skipInactive: skipIdle }); }, [skipIdle, ready]);

  /* Seeking: jump, forget what was drawn, stay playing or paused. */
  useEffect(() => {
    const rep = player.current;
    if (!rep || !seek) return;
    const t = Math.max(0, Math.min(meta.current.total, seek.t));
    clock.current = t;
    seen.current = t;
    setPulses([]);
    if (playing) rep.play(t); else rep.pause(t);
    cb.current.onTime?.(t);
    // Only a new seek request moves the replay.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seek?.n, ready]);

  /* Play and pause, and the clock while playing. */
  useEffect(() => {
    const rep = player.current;
    if (!rep || !ready) return undefined;
    if (!playing) {
      rep.pause(clock.current);
      return undefined;
    }
    // Pressing play at the end starts again.
    if (clock.current >= meta.current.total - 60) {
      clock.current = 0;
      seen.current = 0;
    }
    rep.play(clock.current);

    let raf = 0;
    let told = 0;
    const tick = (now) => {
      const t = Math.max(0, Math.min(meta.current.total, rep.getCurrentTime()));
      clock.current = t;

      // Taps the clock has just passed get drawn.
      const fresh = meta.current.taps.filter(p => p.t > seen.current && p.t <= t);
      seen.current = t;
      if (fresh.length) {
        const doc = rep.iframe?.contentDocument;
        const win = rep.iframe?.contentWindow;
        const drawn = fresh.map((p) => {
          let rect = null;
          let label = '';
          try {
            const node = rep.getMirror().getNode(p.id);
            const el = node && node.nodeType === 1 ? node : node?.parentElement;
            const ctl = el && doc ? (pressableAncestor(el, win) || el) : null;
            if (ctl && ctl !== doc.body && ctl !== doc.documentElement) {
              label = labelFor(ctl);
              // The replay has already applied what the tap did by now, and
              // a popup that locks the page can move the control. Outline it
              // only if it is still under the finger; a box somewhere else
              // would point at the wrong thing.
              const r = ctl.getBoundingClientRect();
              const under = p.x >= r.left - 6 && p.x <= r.right + 6 && p.y >= r.top - 6 && p.y <= r.bottom + 6;
              if (under && r.width > 4 && r.height > 4) {
                rect = { left: r.left, top: r.top, width: r.width, height: r.height };
              }
            }
          } catch { /* a node the replay no longer has */ }
          return { key: `${p.t}-${p.x}-${p.y}`, x: p.x, y: p.y, rect, label };
        });
        setPulses(prev => [...prev, ...drawn].slice(-6));
        drawn.forEach(d => setTimeout(() => setPulses(prev => prev.filter(q => q.key !== d.key)), PULSE_MS));
      }

      // The parent re-renders a list, so it hears the time ten times a
      // second rather than sixty.
      if (now - told > 100) {
        told = now;
        cb.current.onTime?.(t);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, ready]);

  if (failed) {
    return <p className="uf-rp__msg" role="status">This recording could not be played back here.</p>;
  }

  const w = size?.w || 375;
  const h = size?.h || 812;
  return (
    <DeviceChrome device={device} width={w} height={h} furniture={false} screenClassName="ufs__screen--rec">
      <div className="uf-rec" ref={root} style={{ width: w, height: h }} />
      <div className="uf-rec__over" aria-hidden="true">
        {pulses.map(p => (
          <span key={p.key}>
            {p.rect && (
              <span
                className="uf-rec__hit"
                style={{ left: p.rect.left, top: p.rect.top, width: p.rect.width, height: p.rect.height }}
              />
            )}
            <span className="uf-rec__tap" style={{ left: p.x, top: p.y }} />
            {p.label && (
              <span className="uf-rec__labelrow" style={{ top: p.y > h - 110 ? p.y - 76 : p.y + 36 }}>
                <span className="uf-rec__label">{p.label}</span>
              </span>
            )}
          </span>
        ))}
      </div>
      {!ready && <p className="uf-rp__msg uf-rp__msg--over">Loading the recording…</p>}
    </DeviceChrome>
  );
}
