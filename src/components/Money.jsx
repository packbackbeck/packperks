import { useRegion } from '../lib/RegionContext';
import { moneyParts as partsFor } from '../lib/regions';
import './Money.css';

/* ─────────────────────────────────────────────────────────────────────
 * Money — an amount rendered with its currency's MARK rather than its
 * ISO code.
 *
 * Intl gives us "AED 6.00", which is correct but reads as a database
 * field next to a price like "€4.80". The UAE has had an official
 * currency symbol since 2025 — a Latin D with two horizontal strokes —
 * and no font we can rely on ships it yet, so it is drawn here.
 *
 * The string form still exists and is still correct: `money()` from
 * RegionContext returns "AED 6.00" for aria-labels, alt text, template
 * literals and anywhere a component can't go. This is the visual layer
 * only, so a screen reader still hears the currency named.
 * ───────────────────────────────────────────────────────────────────── */

/* The UAE dirham mark. Sized in `em` so it tracks whatever type it sits
 * in, and stroked in currentColor so it inherits the text colour —
 * including on the voucher card, where the amount is white on a
 * gradient. */
export function DirhamMark({ className = '', title = 'AED' }) {
  return (
    <svg
      className={`money__mark ${className}`}
      viewBox="0 0 21 24"
      role="img"
      aria-label={title}
      focusable="false"
    >
      {/* The D: an upright stem with the bowl springing off it top and
          bottom. Drawn narrow and squarish rather than round — a circular
          bowl reads as an eth (Ð) once it is 11px tall. */}
      <path d="M8.2 3.4h2.5c5 0 8.4 3.5 8.4 8.6s-3.4 8.6-8.4 8.6H8.2" />
      <path d="M8.2 3.4v17.2" />
      {/* The two strokes, at the same weight as the letter so they read as
          part of it. Pushed to the outer thirds: at 11px tall the gap
          between them is what carries the "two", and anything closer
          merges into a single bar. */}
      <path d="M1.6 8.3h8.8" />
      <path d="M1.6 15.7h8.8" />
    </svg>
  );
}

/**
 * Render an amount for the active region.
 *
 * @param {number} value  The amount.
 * @param {string} [className] Extra class on the wrapper.
 */
export default function Money({ value, className = '' }) {
  const { moneyParts } = useRegion();
  const { number, mark, text } = moneyParts(value);

  if (mark !== 'AED') return <>{text}</>;

  // aria-label carries the whole amount so assistive tech reads
  // "6.00 dirhams", not a stray glyph followed by a number.
  return (
    <span className={`money ${className}`} aria-label={text}>
      <DirhamMark title="" />
      <span aria-hidden="true">{number}</span>
    </span>
  );
}

/**
 * Same, but for an EXPLICIT region rather than the active one. A combined
 * balance spans stores in different regions, and those amounts must each
 * keep their own currency — they are never summed (see UserPage).
 */
export function MoneyIn({ value, region, className = '' }) {
  const { number, mark, text } = partsFor(value, region);
  if (mark !== 'AED') return <>{text}</>;
  return (
    <span className={`money ${className}`} aria-label={text}>
      <DirhamMark title="" />
      <span aria-hidden="true">{number}</span>
    </span>
  );
}
