import { useEffect, useRef, useState } from 'react';
import { COLLECT_WINDOW_MS } from '../lib/collectedClaims';
import { useMoney, useRegion } from '../lib/RegionContext';
import './PendingClaims.css';

/* A claim is only "ready" once an admin has approved it AND minted the Tikkie
 * link. The AI receipt check is just a pre-screen — the final verdict is a
 * person, so a claim the AI auto-passed (status 'completed' but no tikkie_url
 * yet) is still shown as "in review" until the team sends the link. */
const isReady = (c) => c.status === 'completed' && !!c.tikkie_url;
const isUnderReview = (c) => c.status === 'pending' || (c.status === 'completed' && !c.tikkie_url);

/* Active cashback claims the customer is waiting on — a prominent, highlighted
 * section near the top of the profile with a per-claim status + steps:
 *   • In review — a PackPerks team member is checking the receipt by hand.
 *   • Ready     — approved; a "Collect €X" button opens the Tikkie link.
 * A single claim fills the width; several become a swipeable slideshow with
 * pagination dots. A claim disappears from here once its Collect CTA is tapped
 * once (tracked in `collectedIds`) — the record lives on in Activity. */
export default function PendingClaims({ claims = [], collectedMap = {}, onCollect }) {
  const now = Date.now();
  // A collected claim lingers for a 24h grace window, then drops off.
  const collectExpired = (id) => {
    const t = collectedMap[id];
    return t != null && (now - t) > COLLECT_WINDOW_MS;
  };
  const active = (claims || []).filter(c =>
    (c.type === 'cashback' || c.type === 'direct_refund') &&
    c.status !== 'failed' &&
    c.tikkie_status !== 'redeemed' &&
    !collectExpired(c.id) &&
    (isReady(c) || isUnderReview(c)),
  );
  const railRef = useRef(null);
  const [activeIdx, setActiveIdx] = useState(0);

  if (!active.length) return null;

  const perCard = () => {
    const el = railRef.current;
    return el ? el.scrollWidth / active.length : 1;
  };
  const onScroll = () => {
    const el = railRef.current;
    if (!el) return;
    setActiveIdx(Math.max(0, Math.min(active.length - 1, Math.round(el.scrollLeft / perCard()))));
  };
  const goTo = (i) => {
    const el = railRef.current;
    if (el) el.scrollTo({ left: i * perCard(), behavior: 'smooth' });
  };

  return (
    <section className="pc" aria-label="Cashback claims in progress">
      <div className="pc__head">
        <span className="pc__title">Your cashback claims</span>
        <span className="pc__count">{active.length} in progress</span>
      </div>
      <div className={`pc__rail${active.length === 1 ? ' pc__rail--single' : ''}`} ref={railRef} onScroll={onScroll}>
        {active.map(c => <ClaimCard key={c.id} claim={c} onCollect={onCollect} collected={collectedMap[c.id] != null} />)}
      </div>
      {active.length > 1 && (
        <div className="pc__dots" role="tablist" aria-label="Claims">
          {active.map((c, i) => (
            <button
              key={c.id}
              type="button"
              className={`pc__dot${i === activeIdx ? ' is-active' : ''}`}
              aria-label={`Go to claim ${i + 1}`}
              aria-selected={i === activeIdx}
              onClick={() => goTo(i)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

const REVIEW_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/* How far along the review a claim is, purely from elapsed time: 0% the moment
 * it's submitted (day 0), filling toward the 7-day promise (day 7 = 100%).
 * Recomputed on every load, so it creeps forward each session. Held at 95% —
 * the final stretch only completes once a human approves and the Tikkie link
 * exists, at which point this bar is gone and the card shows Collect instead. */
function reviewPct(claim) {
  const start = claim.created_at ? new Date(claim.created_at).getTime() : Date.now();
  const elapsed = Date.now() - start;
  if (!Number.isFinite(elapsed)) return 5;
  return Math.max(5, Math.min(95, (elapsed / REVIEW_WINDOW_MS) * 100));
}

/* Slim, live-feeling progress bar for an in-review claim. Animates up from 0 to
 * the current value on mount, with a barber-pole stripe + pulsing dot so it
 * reads as actively being worked on. */
function ReviewProgress({ claim }) {
  const target = reviewPct(claim);
  const [w, setW] = useState(0);
  useEffect(() => {
    const id = requestAnimationFrame(() => setW(target));
    return () => cancelAnimationFrame(id);
  }, [target]);
  return (
    <div className="pc-progress">
      <div className="pc-progress__track">
        <div className="pc-progress__fill" style={{ width: `${w}%` }} />
      </div>
      <div className="pc-progress__meta">
        <span className="pc-progress__stage">Checking your receipt</span>
        <span className="pc-progress__eta">Ready within 7 days</span>
      </div>
    </div>
  );
}

function ClaimCard({ claim, onCollect, collected }) {
  const money = useMoney();
  const { symbol, collectLabel } = useRegion();
  const ready = isReady(claim);
  const amount = money(claim.payout_amount);
  const name = claim.rewardName || 'Cashback reward';

  return (
    <article className={`pc-card pc-card--${ready ? 'ready' : 'checking'}`}>
      <div className="pc-card__top">
        <div className="pc-card__thumb" style={claim.rewardBg ? { background: claim.rewardBg } : undefined}>
          {claim.rewardImage
            ? <img src={claim.rewardImage} alt="" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
            : <span className="pc-card__thumb-euro">{symbol}</span>}
        </div>
        <div className="pc-card__meta">
          <span className="pc-card__name">{name}</span>
          <span className="pc-card__amount">{amount} cashback</span>
        </div>
        {!ready && (
          <span className="pc-card__badge">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 16 14"/></svg>
            In review
          </span>
        )}
      </div>

      {ready ? (
        /* Once the payout link exists, the review progress is done — its block
           becomes the full-width Collect action. Label is region-aware so the
           UAE flow doesn't say "Tikkie". */
        <a
          className="pc-card__collect"
          href={claim.tikkie_url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => onCollect?.(claim)}
        >
          {collected ? 'Reopen payout link' : (collectLabel || 'Collect your cashback')}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
          </svg>
        </a>
      ) : (
        <ReviewProgress claim={claim} />
      )}
    </article>
  );
}
