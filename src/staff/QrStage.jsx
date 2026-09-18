import { useContext, useEffect, useRef } from 'react';
import { defineCustomElements } from '@bitjson/qr-code';
import { Ban, Check, Clock3 } from 'lucide-react';
import { cupsLabel } from './staffApi';
import { ToneContext } from './staffTheme';

/* ─────────────────────────────────────────────────────────────────────
 * The square that shows the code. The QR itself is <qr-code>
 * (@bitjson/qr-code, MIT): an SVG web component whose animations run on
 * the browser's own animation engine, so they stay smooth on a phone.
 *
 *   idle:    a faint placeholder code
 *   making:  the placeholder ripples and a light runs round the edge
 *            (the Border Beam from Magic UI, MIT, in plain CSS)
 *   showing: the real code grows in from the centre
 *   done:    collected (the whole square lights up green), expired or
 *            cancelled, over a faded code
 *
 * The status line ("2 cups · works for 14:32") sits inside the square,
 * under the code. The component draws round dots; they are reshaped into
 * rounded squares as soon as it draws (roundModules).
 * ───────────────────────────────────────────────────────────────────── */

if (typeof window !== 'undefined' && !window.customElements.get('qr-code')) {
  defineCustomElements(window);
}

const PLACEHOLDER = 'https://perks.packback.network/staff';

/* Each module is one unit wide. A rounded square a little smaller than
 * that keeps a hairline between neighbours and scans like a plain one. */
const MODULE_SIZE = 0.88;
const MODULE_RADIUS = 0.26;
const SVG_NS = 'http://www.w3.org/2000/svg';

function roundModules(el) {
  const dots = el?.shadowRoot?.querySelectorAll('circle.module');
  if (!dots?.length) return;
  const half = MODULE_SIZE / 2;
  for (const dot of dots) {
    const rect = document.createElementNS(SVG_NS, 'rect');
    rect.setAttribute('class', 'module');
    rect.setAttribute('fill', dot.getAttribute('fill'));
    rect.setAttribute('x', String(Number(dot.getAttribute('cx')) - half));
    rect.setAttribute('y', String(Number(dot.getAttribute('cy')) - half));
    rect.setAttribute('width', String(MODULE_SIZE));
    rect.setAttribute('height', String(MODULE_SIZE));
    rect.setAttribute('rx', String(MODULE_RADIUS));
    // The animations find a module's place from these.
    rect.dataset.column = dot.dataset.column;
    rect.dataset.row = dot.dataset.row;
    dot.replaceWith(rect);
  }
}

/* Dots appear from the centre outwards, then the three corner markers
 * settle in. */
function reveal(targets, x, y, count, entity) {
  const c = (count - 1) / 2;
  const d = Math.hypot(x - c, y - c) / c;
  if (entity === 'module') {
    return {
      targets,
      from: d * 380,
      duration: 560,
      easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
      web: { opacity: [0, 1], scale: [0.2, 1] },
    };
  }
  return {
    targets,
    from: entity === 'position-center' ? 520 : 440,
    duration: 620,
    easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
    web: { opacity: [0, 1], scale: [0.7, 1] },
  };
}

function QrCode({ contents, tone = 'ink', play }) {
  const ref = useRef(null);

  // Every draw is reshaped first; the first draw of a real code then plays
  // the reveal once.
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    let revealed = play !== 'reveal';
    const onDraw = () => {
      roundModules(el);
      if (revealed) return;
      revealed = true;
      el.animateQRCode?.(reveal);
    };
    roundModules(el);
    el.addEventListener('codeRendered', onDraw);
    return () => el.removeEventListener('codeRendered', onDraw);
  }, [play]);

  // While a code is being made, the placeholder ripples.
  useEffect(() => {
    const el = ref.current;
    if (!el || play !== 'ripple') return undefined;
    const run = () => el.animateQRCode?.('RadialRipple');
    const first = setTimeout(run, 60);
    const loop = setInterval(run, 1150);
    return () => { clearTimeout(first); clearInterval(loop); };
  }, [play]);

  // The venue's colours (staffTheme.js): ink for a real code, a tint of
  // the accent while making one, a whisper of ink when idle.
  const colours = useContext(ToneContext)[tone];

  return (
    <qr-code
      ref={ref}
      className="st-qr"
      contents={contents}
      module-color={colours.module}
      position-ring-color={colours.ring}
      position-center-color={colours.center}
    />
  );
}

const DONE = {
  claimed: { icon: Check, tone: 'green', title: 'Collected', sub: (c) => `${cupsLabel(c.claimed_cups)} added` },
  partly_claimed: { icon: Check, tone: 'amber', title: 'Partly collected', sub: (c) => `${c.claimed_cups} of ${cupsLabel(c.cups)} added` },
  expired: { icon: Clock3, tone: 'grey', title: 'Expired', sub: () => 'Make a new code' },
  cancelled: { icon: Ban, tone: 'grey', title: 'Cancelled', sub: () => 'Make a new code' },
};

export default function QrStage({ code, making, status }) {
  const phase = making ? 'making' : code ? 'showing' : 'idle';
  const done = code && code.status !== 'waiting' ? DONE[code.status] : null;
  const DoneIcon = done?.icon;
  const lit = code?.status === 'claimed' || code?.status === 'partly_claimed';

  return (
    <div className={`st-stage st-stage--${phase}${done ? ' st-stage--done' : ''}${lit ? ' st-stage--lit' : ''}`}>
      {phase === 'making' && <span className="st-beam" aria-hidden="true"><i /></span>}

      <div className="st-stage__art">
        {phase === 'showing' && code?.url ? (
          <div className={`st-stage__code${done ? ' st-stage__code--faded' : ''}`} key={code.id}>
            <QrCode contents={code.url} tone="ink" play={done ? null : 'reveal'} />
          </div>
        ) : (
          <div className="st-stage__code st-stage__code--ghost" key={phase}>
            <QrCode contents={PLACEHOLDER} tone={phase === 'making' ? 'active' : 'ghost'} play={phase === 'making' ? 'ripple' : null} />
          </div>
        )}

        {done && (
          <div className={`st-done st-done--${done.tone}`} role="status">
            <span className="st-done__badge">
              <DoneIcon size={30} strokeWidth={2.4} aria-hidden="true" />
            </span>
            <p className="st-done__title">{done.title}</p>
            <p className="st-done__sub">{done.sub(code)}</p>
          </div>
        )}
      </div>
      <div className="st-stage__status">{status}</div>
    </div>
  );
}
