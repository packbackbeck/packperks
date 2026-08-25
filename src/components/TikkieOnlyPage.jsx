import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import packperksLogo from '../assets/images/packperks-logo.svg';
import './TikkieOnlyPage.css';

/* Tikkie-only mode (smart-bin cashback): the whole customer experience.
 *
 * The bin prints a receipt QR → /<slug>/?batch=<uuid>. For a tikkie_only
 * org, App.jsx renders THIS page instead of booting the app: no account,
 * no rewards, no cookies — just "one sec…" while bin-tikkie converts the
 * batch into a Tikkie link, then a hard redirect to Tikkie.
 *
 * Re-scanning the same receipt returns the SAME link (server-side
 * idempotency), so a closed tab or a dead battery never loses the payout. */

const FRIENDLY = {
  already_claimed: 'This receipt has already been used for a cashback.',
  batch_revoked:   'This receipt is no longer valid.',
  batch_expired:   'This receipt has expired.',
  batch_not_found: 'We couldn’t recognise this QR code. Please use the receipt printed by the bin.',
  invalid_batch:   'We couldn’t recognise this QR code. Please use the receipt printed by the bin.',
  wrong_mode:      'This QR code belongs to a different PackPerks programme.',
};

const MAX_POLLS = 8;

export default function TikkieOnlyPage({ org, batchId }) {
  const [phase, setPhase] = useState('working'); // working | redirecting | error
  const [error, setError] = useState(null);      // friendly message
  const [payout, setPayout] = useState(null);    // { cups, amount, url }
  const pollsRef = useRef(0);
  const startedRef = useRef(false);

  useEffect(() => {
    // StrictMode double-mount guard. NOTE: no companion "cancelled" cleanup —
    // the ref survives StrictMode's unmount/remount cycle, so a cleanup flag
    // would strand the ONE running redeem() with nowhere to deliver its
    // result (the page would spin forever). Post-unmount setState is a no-op
    // in React 18, so letting the promise finish is the correct shape here.
    if (startedRef.current) return;
    startedRef.current = true;

    if (!batchId) {
      setError(FRIENDLY.batch_not_found);
      setPhase('error');
      return;
    }

    async function redeem() {
      let data = null;
      try {
        const res = await supabase.functions.invoke('bin-tikkie', {
          body: { batch_id: batchId },
        });
        // supabase-js surfaces non-2xx as error with a Response attached —
        // read the JSON body either way so we get the structured code.
        data = res.data;
        if (!data && res.error?.context?.json) {
          data = await res.error.context.json().catch(() => null);
        }
      } catch {
        data = null;
      }

      if (data?.url) {
        setPayout({ cups: data.cups, amount: data.amount, url: data.url });
        setPhase('redirecting');
        // Long enough to actually read the amount before Tikkie takes over.
        // At the old 900ms the payout flashed past unread, which is the one
        // thing the customer came here to see.
        setTimeout(() => { window.location.replace(data.url); }, 2400);
        return;
      }
      if (data?.status === 'in_progress') {
        // Another scan of the same receipt is minting right now — poll it.
        if (pollsRef.current++ < MAX_POLLS) {
          setTimeout(redeem, 1400);
          return;
        }
      }
      setError(FRIENDLY[data?.error] || 'We couldn’t create your cashback link right now. Please scan the QR code again in a moment.');
      setPhase('error');
    }

    redeem();
  }, [batchId]);

  const brandColor = org?.brand_color || '#1A8737';

  return (
    <div className="tikkie-only">
      <div className="tikkie-only__card">
        <div className="tikkie-only__logos">
          <img className="tikkie-only__logo" src={org?.logo_url || packperksLogo} alt={org?.name || 'PackPerks'} />
          <svg className="tikkie-only__link-arrows" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <line x1="5" y1="12" x2="19" y2="12" />
            <polyline points="13 6 19 12 13 18" />
          </svg>
          {/* Tikkie doesn't ship a hotlinkable logo — a wordmark chip keeps
              the page self-contained and unmistakable. */}
          <span className="tikkie-only__tikkie-chip">Tikkie</span>
        </div>

        {phase === 'working' && (
          <>
            <div className="tikkie-only__spinner" style={{ borderTopColor: brandColor }} aria-hidden="true" />
            <h1 className="tikkie-only__title">One sec…</h1>
            <p className="tikkie-only__sub">We’re preparing your Tikkie cashback link.</p>
          </>
        )}

        {phase === 'redirecting' && (
          <>
            {/* Success is always green — the org's brand colour (often warm
                orange/red) reads as an error on a confirmation tick. */}
            <div className="tikkie-only__check" aria-hidden="true">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            {/* The payout is the headline: what they get, and for how many
                cups, both readable at a glance before the redirect fires. */}
            <div className="tikkie-only__payout">
              <div className="tikkie-only__amount">
                €{Number(payout?.amount ?? 0).toFixed(2)}
              </div>
              {payout?.cups != null && (
                <div className="tikkie-only__cups">
                  for {payout.cups} cup{payout.cups === 1 ? '' : 's'} returned
                </div>
              )}
            </div>
            <p className="tikkie-only__sub">Redirecting you to Tikkie…</p>
            {/* Fallback if the auto-redirect is blocked. */}
            {payout?.url && (
              <a className="tikkie-only__btn" href={payout.url}>Open Tikkie</a>
            )}
          </>
        )}

        {phase === 'error' && (
          <>
            <div className="tikkie-only__err-icon" aria-hidden="true">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>
            <h1 className="tikkie-only__title">Sorry!</h1>
            <p className="tikkie-only__sub">{error}</p>
          </>
        )}

        <p className="tikkie-only__foot">Powered by PackPerks</p>
      </div>
    </div>
  );
}
