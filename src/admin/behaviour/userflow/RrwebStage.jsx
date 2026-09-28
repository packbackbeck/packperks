import { useEffect, useRef, useState } from 'react';

/* ─────────────────────────────────────────────────────────────────────
 * The visit itself, played back.
 *
 * rrweb recorded a snapshot of the DOM and every change to it while the
 * customer was there; this rebuilds that in an iframe and plays it. It is
 * not a re-enactment over a sample screen — it is the screen they had, at
 * the size they had it, with their own balance and their own activity on
 * it, scrolling when they scrolled.
 *
 * Loaded only when there is a recording to play: the player is a few
 * hundred kilobytes and no dashboard should carry it on the chance that
 * somebody opens this tab.
 *
 * What is never in a recording: anything typed (`maskAllInputs` replaces
 * every field's value before it leaves the browser) and the profile block,
 * which is blocked outright. See src/lib/uxCapture.js.
 * ───────────────────────────────────────────────────────────────────── */

export default function RrwebStage({ events, width = 340, height = 700, speed = 1, onFail }) {
  const box = useRef(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const el = box.current;
    if (!el || !Array.isArray(events) || events.length < 2) return undefined;
    let player = null;
    let dead = false;
    el.innerHTML = '';
    setFailed(false);

    (async () => {
      try {
        const [{ default: Player }, { unpack }] = await Promise.all([
          import('rrweb-player'),
          import('@rrweb/packer/unpack'),
          import('rrweb-player/dist/style.css'),
        ]);
        if (dead || !box.current) return;
        player = new Player({
          target: box.current,
          props: {
            events,
            /* The other half of what the recorder does: base64 back to the
               packed string (jsonb will not hold the raw deflate bytes),
               then rrweb's own unpack. */
            unpackFn: (raw) => unpack(typeof raw === 'string' ? atob(raw) : raw),
            width,
            height,
            autoPlay: false,
            speed,
            showController: true,
            // A recording is never interactive: it is somebody else's visit.
            mouseTail: { lineWidth: 2, strokeStyle: 'rgba(106,79,230,.55)' },
          },
        });
      } catch {
        if (dead) return;
        setFailed(true);
        onFail?.();
      }
    })();

    return () => {
      dead = true;
      try { player?.$destroy?.(); } catch { /* already gone */ }
      if (el) el.innerHTML = '';
    };
  }, [events, width, height, speed, onFail]);

  if (failed) {
    return (
      <p className="uf-replay__loading" role="status">
        This recording could not be played back here.
      </p>
    );
  }
  return <div className="uf-rrweb" ref={box} />;
}
