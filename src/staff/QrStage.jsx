import { memo, useMemo } from 'react';
import QRCode from 'qrcode';
import { Ban, Check, Clock3, CupSoda } from 'lucide-react';
import { countdown, cupsLabel, timeLabel } from './staffApi';

/* ─────────────────────────────────────────────────────────────────────
 * The big square. Four looks:
 *   idle:    a quiet grid that says what to do
 *   making:  the grid shimmers while the code is made
 *   showing: the QR code assembles from the centre out
 *   done:    collected, expired or cancelled, over a faded code
 * ───────────────────────────────────────────────────────────────────── */

const GRID = 21;

/* A fixed pseudo-random sequence, so the idle and making grids look the
 * same on every render. */
function seeded(n) {
  let s = 7;
  return Array.from({ length: n }, () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  });
}
const DOTS = (() => {
  const rnd = seeded(GRID * GRID * 2);
  const out = [];
  for (let r = 0; r < GRID; r++) {
    for (let c = 0; c < GRID; c++) {
      const i = r * GRID + c;
      const inFinder = (r < 7 && c < 7) || (r < 7 && c >= GRID - 7) || (r >= GRID - 7 && c < 7);
      if (inFinder) continue;
      out.push({ r, c, on: rnd[i] > 0.52, delay: Math.round(rnd[i + GRID * GRID] * 1400) });
    }
  }
  return out;
})();

function Finder({ x, y, accent = '#5333A5' }) {
  return (
    <g className="st-qr__finder">
      <rect x={x + 0.5} y={y + 0.5} width="6" height="6" rx="1.7" fill="none" stroke="currentColor" strokeWidth="1" />
      <rect x={x + 2} y={y + 2} width="3" height="3" rx="0.95" fill={accent} />
    </g>
  );
}

function Grid({ making }) {
  return (
    <svg className={`st-grid${making ? ' st-grid--making' : ''}`} viewBox={`0 0 ${GRID} ${GRID}`} aria-hidden="true">
      <Finder x={0} y={0} />
      <Finder x={GRID - 7} y={0} />
      <Finder x={0} y={GRID - 7} />
      {DOTS.map(d => (
        <rect
          key={`${d.r}-${d.c}`}
          className={d.on ? 'st-grid__dot st-grid__dot--on' : 'st-grid__dot'}
          x={d.c + 0.2}
          y={d.r + 0.2}
          width="0.6"
          height="0.6"
          rx="0.3"
          style={{ animationDelay: `${d.delay}ms` }}
        />
      ))}
    </svg>
  );
}

/* The QR code as SVG: rounded modules, drawn in from the centre. */
const QrSvg = memo(function QrSvg({ url }) {
  const { size, modules } = useMemo(() => {
    const qr = QRCode.create(url, { errorCorrectionLevel: 'M' });
    const n = qr.modules.size;
    const finder = (r, c) => (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7);
    const mid = (n - 1) / 2;
    const maxD = Math.hypot(mid, mid);
    const list = [];
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (!qr.modules.get(r, c) || finder(r, c)) continue;
        const d = Math.hypot(r - mid, c - mid) / maxD;
        // Centre first, a little jitter so it doesn't read as rings.
        const jitter = ((r * 31 + c * 17) % 7) * 12;
        list.push({ r, c, delay: Math.round(d * 520 + jitter) });
      }
    }
    return { size: n, modules: list };
  }, [url]);

  return (
    <svg
      className="st-qr"
      viewBox={`-0.5 -0.5 ${size + 1} ${size + 1}`}
      role="img"
      aria-label="QR code for the customer to scan"
      shapeRendering="geometricPrecision"
    >
      {modules.map(m => (
        <rect
          key={`${m.r}-${m.c}`}
          className="st-qr__mod"
          x={m.c + 0.05}
          y={m.r + 0.05}
          width="0.9"
          height="0.9"
          rx="0.26"
          style={{ animationDelay: `${m.delay}ms` }}
        />
      ))}
      <g className="st-qr__finders">
        <Finder x={0} y={0} />
        <Finder x={size - 7} y={0} />
        <Finder x={0} y={size - 7} />
      </g>
    </svg>
  );
});

const DONE = {
  claimed: { icon: Check, tone: 'green', title: 'Collected', sub: (c) => `${cupsLabel(c.claimed_cups)} added to the customer` },
  partly_claimed: { icon: Check, tone: 'amber', title: 'Partly collected', sub: (c) => `${c.claimed_cups} of ${cupsLabel(c.cups)} added` },
  expired: { icon: Clock3, tone: 'grey', title: 'Code expired', sub: () => 'Make a new one below' },
  cancelled: { icon: Ban, tone: 'grey', title: 'Code cancelled', sub: () => 'Make a new one below' },
};

export default function QrStage({ code, making, remainingMs, venueName }) {
  const phase = making ? 'making' : code ? 'showing' : 'idle';
  const done = code && code.status !== 'waiting' ? DONE[code.status] : null;
  const DoneIcon = done?.icon;
  const urgent = code?.status === 'waiting' && remainingMs < 60_000;

  return (
    <div className={`st-stage st-stage--${phase}${done ? ' st-stage--done' : ''}`}>
      <div className="st-stage__corners" aria-hidden="true"><i /><i /><i /><i /></div>

      <div className="st-stage__top">
        <span className="st-stage__venue">{venueName}</span>
        {phase === 'showing' && !done && (
          <span className={`st-stage__timer${urgent ? ' st-stage__timer--urgent' : ''}`} aria-live="off">
            <Clock3 size={13} aria-hidden="true" />
            {countdown(remainingMs)}
          </span>
        )}
      </div>

      <div className="st-stage__art">
        {phase === 'showing' && code?.url ? (
          <div className={`st-stage__code${done ? ' st-stage__code--faded' : ''}`} key={code.id}>
            <QrSvg url={code.url} />
            <span className="st-stage__sweep" aria-hidden="true" />
          </div>
        ) : phase === 'showing' ? (
          <div className="st-stage__code st-stage__code--faded" key={code.id}><Grid /></div>
        ) : (
          <Grid making={phase === 'making'} />
        )}
        {phase === 'making' && <span className="st-stage__beam" aria-hidden="true" />}

        {done && (
          <div className={`st-done st-done--${done.tone}`} role="status">
            <span className="st-done__badge">
              <DoneIcon size={34} strokeWidth={2.6} aria-hidden="true" />
              {code.status === 'claimed' && <span className="st-done__burst" aria-hidden="true"><i /><i /><i /><i /><i /><i /><i /><i /></span>}
            </span>
            <p className="st-done__title">{done.title}</p>
            <p className="st-done__sub">{done.sub(code)}</p>
          </div>
        )}
      </div>

      <div className="st-stage__bottom">
        {phase === 'idle' && <p className="st-stage__hint">Pick the cups below, then tap <b>Show QR code</b></p>}
        {phase === 'making' && <p className="st-stage__hint" role="status">Making a code…</p>}
        {phase === 'showing' && code && (
          <>
            <span className="st-chip">
              <CupSoda size={14} aria-hidden="true" />
              {cupsLabel(code.cups)}
            </span>
            <span className="st-stage__scan">
              {!done && 'Ask the customer to scan'}
              {done && code.claimed_at && `Collected at ${timeLabel(code.claimed_at)}`}
              {done && !code.claimed_at && code.status === 'cancelled' && code.cancelled_at && `Cancelled at ${timeLabel(code.cancelled_at)}`}
              {done && !code.claimed_at && code.status === 'expired' && `Stopped at ${timeLabel(code.expires_at)}`}
            </span>
          </>
        )}
      </div>
    </div>
  );
}
