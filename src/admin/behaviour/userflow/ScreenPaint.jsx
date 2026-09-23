import { useMemo } from 'react';
import { BatteryFull, Signal, Wifi } from 'lucide-react';

/* ─────────────────────────────────────────────────────────────────────
 * The customer's screen, repainted.
 *
 * Design & copy draws its phone by hand, because it is previewing a draft
 * that does not exist yet. Here the screen DID exist, and capture measured
 * it: every piece's position and size as a fraction of the page, plus how
 * it was drawn — background and text colour, corner radius, type size and
 * weight, border, its words, and the public image URL where it had one.
 * This paints that back, in the same phone frame, so a venue looking at
 * its heatmap sees its own app rather than a diagram of it.
 *
 * Two things follow from it being a measurement rather than a screenshot:
 *
 *   • The heat lands exactly where the thumbs did, because the overlay and
 *     the picture are drawn from the same normalised geometry.
 *   • There is no picture of a customer's screen anywhere. Nothing typed
 *     is read, personal-looking text is masked in the browser before it is
 *     sent, and the blocks that show a name or an address are excluded
 *     outright (`[data-ppk-private]`).
 *
 * Sizes are fractions of the CAPTURED viewport width, so everything is
 * laid out in `cqw` against the frame — the picture keeps the real screen's
 * proportions at whatever width the card gives it.
 * ───────────────────────────────────────────────────────────────────── */

const cq = (v, max = 100) => `${Math.min(max, (Number(v) || 0) * 100)}cqw`;

function Piece({ el, dh, vw }) {
  const w = Number(el.w) || 0;
  const h = Number(el.h) || 0;
  // How many lines the measured box holds at the measured type size. The
  // dashboard's font is not the app's, so the same words wrap differently
  // here; clamping to the real line count ends a line with an ellipsis
  // instead of slicing a word in half.
  const lines = el.t === 'text' && el.fs && dh && vw
    ? Math.max(1, Math.round((h * dh) / (Number(el.fs) * vw * (Number(el.lh) || 1.2))))
    : null;
  const style = {
    left: `${(Number(el.x) || 0) * 100}%`,
    top: `${(Number(el.y) || 0) * 100}%`,
    width: `${w * 100}%`,
    height: `${h * 100}%`,
    // The URL is already restricted to http(s) by ux-ingest; quoting it
    // keeps a stray bracket or space from breaking the shorthand.
    background: el.bgi ? `${el.bg || 'transparent'} center/cover no-repeat url("${el.bgi}")` : (el.bg || undefined),
    color: el.fg || undefined,
    borderRadius: el.br ? cq(el.br, 50) : undefined,
    fontSize: el.fs ? cq(el.fs, 40) : undefined,
    lineHeight: el.lh || undefined,
    fontFamily: el.ff || undefined,
    fontWeight: el.fw || undefined,
    textAlign: el.ta || undefined,
    border: el.bw && el.bc ? `${Math.max(1, (Number(el.bw) || 0) * 100)}cqw solid ${el.bc}` : undefined,
  };
  if (el.t === 'img' && el.src) {
    return (
      <img
        className="sp-piece sp-piece--img"
        style={style}
        src={el.src}
        alt=""
        referrerPolicy="no-referrer"
      />
    );
  }
  return (
    <div className={`sp-piece sp-piece--${el.t || 'box'}`} style={style}>
      {el.l && (el.t === 'text' || el.t === 'btn')
        ? (
          <span
            className="sp-piece__t"
            style={lines ? { WebkitLineClamp: lines } : undefined}
          >
            {el.l}
          </span>
        )
        : null}
    </div>
  );
}

/**
 * @param layout   a ux_layouts row: { elements, page, vw, vh, dh }
 * @param children the overlay — heat, bands, control shading, a replay dot
 * @param fold     draw the line where the first screenful ended
 * @param dim      veil the screen, so an overlay reads clearly over it
 */
export default function ScreenPaint({ layout, children, fold = false, dim = false, className = '' }) {
  const elements = useMemo(() => layout?.elements || [], [layout]);
  // The page's TRUE proportions. Capping them was the bug that squashed
  // every piece vertically on a long screen and pushed its words out of
  // their own boxes — so the phone is a scroll window over the full page
  // instead, which is what a phone is.
  const aspect = layout?.vw && layout?.dh
    ? Math.min(14, Math.max(0.4, layout.dh / layout.vw))
    : 2;
  const foldAt = layout?.vh && layout?.dh ? Math.min(0.97, layout.vh / layout.dh) : null;
  const chrome = layout?.vh && layout?.dh ? Math.min(0.08, (layout.vh * 0.055) / layout.dh) : 0.03;
  // The device the visit was on decides the furniture around the screen:
  // a phone gets a phone, a desktop gets a window. A tall screen in a
  // browser chrome, or a wide one in a phone, reads as a mistake before
  // anyone gets to the heat.
  const device = layout?.device || (aspect >= 1.4 ? 'mobile' : 'desktop');
  const phone = device === 'mobile';

  return (
    <div className={`sp sp--${device} ${className}`}>
      <div className="sp__frame">
        <div className="sp__window">
        <div className="sp__screen" style={{ aspectRatio: `1 / ${aspect}`, background: layout?.page || '#FFFFFF' }}>
          {phone ? (
            <div className="sp__status" style={{ height: `${chrome * 100}%` }}>
              <span className="sp__time">9:41</span>
              <span className="sp__island" />
              <span className="sp__icons">
                <Signal size={9} strokeWidth={2.6} aria-hidden="true" />
                <Wifi size={9} strokeWidth={2.6} aria-hidden="true" />
                <BatteryFull size={12} strokeWidth={2} aria-hidden="true" />
              </span>
            </div>
          ) : (
            <div className="sp__bar" aria-hidden="true">
              <span className="sp__dot" /><span className="sp__dot" /><span className="sp__dot" />
            </div>
          )}

          <div className="sp__page">
            {elements.map((el, i) => (
              <Piece key={`${el.k}-${i}`} el={el} dh={layout?.dh} vw={layout?.vw} />
            ))}
          </div>

          {/* Fade the screen back when something is drawn over it. */}
          {dim && <div className="sp__veil" aria-hidden="true" />}

          {fold && foldAt != null && (
            <div className="sp__fold" style={{ top: `${foldAt * 100}%` }}>
              <span>First screenful ends here</span>
            </div>
          )}

          {children}
        </div>
        </div>
        {phone && <span className="sp__homebar" />}
      </div>
    </div>
  );
}

/* A screen nobody has captured yet still needs to occupy its place. */
export function ScreenPaintEmpty({ note }) {
  return (
    <div className="sp sp--mobile sp--empty">
      <div className="sp__frame">
        <div className="sp__window">
          <div className="sp__screen" style={{ aspectRatio: '1 / 2' }}>
            <p className="sp__note">{note}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
