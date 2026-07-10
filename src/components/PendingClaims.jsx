import { useRef, useState } from 'react';
import { COLLECT_WINDOW_MS } from '../lib/collectedClaims';
import { setClaimNotifyPrefs } from '../lib/api';
import { requestPushPermission, isPushSupported } from '../lib/notify';
import './PendingClaims.css';

const money = (n) => `€${(Number(n) || 0).toFixed(2)}`;

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
      <div className="pc__rail" ref={railRef} onScroll={onScroll}>
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

const CheckMini = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M20 6L9 17l-5-5" />
  </svg>
);

/* Compact 3-step tracker: Submitted → Team review → Ready. */
function Steps({ ready }) {
  const steps = [
    { label: 'Submitted',   done: true,   active: false },
    { label: 'Team review', done: ready,  active: !ready },
    { label: 'Ready',       done: ready,  active: false },
  ];
  return (
    <div className="pc-steps">
      {steps.map((s, i) => (
        <div key={i} className={`pc-step${s.done ? ' is-done' : ''}${s.active ? ' is-active' : ''}`}>
          <span className="pc-step__dot">{s.done ? <CheckMini /> : i + 1}</span>
          <span className="pc-step__label">{s.label}</span>
          {i < steps.length - 1 && <span className="pc-step__bar" />}
        </div>
      ))}
    </div>
  );
}

function ClaimCard({ claim, onCollect, collected }) {
  const ready = isReady(claim);
  const amount = money(claim.payout_amount);
  const name = claim.rewardName || 'Cashback reward';

  return (
    <article className={`pc-card pc-card--${ready ? 'ready' : 'checking'}`}>
      <div className="pc-card__top">
        <div className="pc-card__thumb" style={claim.rewardBg ? { background: claim.rewardBg } : undefined}>
          {claim.rewardImage
            ? <img src={claim.rewardImage} alt="" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
            : <span className="pc-card__thumb-euro">€</span>}
        </div>
        <div className="pc-card__meta">
          <span className="pc-card__name">{name}</span>
          <span className="pc-card__amount">{amount} cashback</span>
        </div>
        <span className={`pc-card__badge${ready ? ' is-ready' : ''}`}>
          {ready ? (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 16 14"/></svg>
          )}
          {ready ? 'Ready' : 'In review'}
        </span>
      </div>

      <Steps ready={ready} />

      {ready ? (
        <>
          <p className="pc-card__msg">Approved by our team — collect your <strong>{amount}</strong> cashback through the secure Tikkie link.</p>
          <a
            className="pc-card__collect"
            href={claim.tikkie_url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => onCollect?.(claim)}
          >
            {collected ? 'Reopen Tikkie link' : 'Collect via Tikkie'}
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
            </svg>
          </a>
        </>
      ) : (
        <>
          <p className="pc-card__msg">A PackPerks team member checks every receipt by hand. Your Tikkie link to collect this cashback arrives within <strong>7 days</strong>.</p>
          <NotifyOptions claim={claim} />
        </>
      )}
    </article>
  );
}

/* Two small opt-in checkboxes on an in-review claim: get told the moment the
 * Tikkie link is ready, by email and/or browser push (push asks the browser
 * for permission on first tick). Persisted per claim via set_claim_notify. */
function NotifyOptions({ claim }) {
  const [email, setEmail] = useState(!!claim.notify_email);
  const [push, setPush]   = useState(!!claim.notify_push);
  const [hint, setHint]   = useState(null);

  const save = (e, p) => setClaimNotifyPrefs(claim.id, { email: e, push: p }).catch(() => {});

  const toggleEmail = (checked) => {
    setEmail(checked);
    setHint(null);
    save(checked, push);
  };

  const togglePush = async (checked) => {
    setHint(null);
    if (!checked) { setPush(false); save(email, false); return; }
    if (!isPushSupported()) {
      setHint('Push isn’t supported in this browser — email still works.');
      return;
    }
    // Ask the browser for permission on first opt-in.
    const perm = await requestPushPermission();
    if (perm === 'granted') {
      setPush(true);
      save(email, true);
    } else {
      setPush(false);
      setHint(perm === 'denied'
        ? 'Notifications are blocked for this site — allow them in your browser settings.'
        : 'Push permission wasn’t granted — email still works.');
    }
  };

  return (
    <div className="pc-notify">
      <span className="pc-notify__label">Notify me when it’s ready:</span>
      <div className="pc-notify__opts">
        <label className="pc-notify__opt">
          <input
            type="checkbox"
            className="pc-notify__box"
            checked={email}
            onChange={e => toggleEmail(e.target.checked)}
          />
          <span>via email</span>
        </label>
        {/* C.4: the "via push notification" option was removed — no push sender
            exists yet, so it delivered nothing. Email works (via Brevo). */}
      </div>
      {hint && <span className="pc-notify__hint">{hint}</span>}
    </div>
  );
}
