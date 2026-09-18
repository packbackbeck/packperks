import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import './ActivityDetailModal.css';

/* ─────────────────────────────────────────────────────────────────────
 * One row of the Deferred Tikkie activity, opened: the same receipt-style
 * card the other PackPerks modes show (ActivityDetailModal's design), with
 * what this row is about. A Tikkie payout nobody has collected yet keeps
 * its link here, so the customer can still open it.
 *
 * `payoutUrl` is the wallet's outstanding link when this row is the payout
 * it belongs to (TikkieHomePage matches them).
 * ───────────────────────────────────────────────────────────────────── */

function ToneIcon({ icon }) {
  if (icon === 'plus') return <svg width="18" height="18" viewBox="0 0 20 20" fill="none"><line x1="10" y1="4" x2="10" y2="16" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" /><line x1="4" y1="10" x2="16" y2="10" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" /></svg>;
  if (icon === 'check') return <svg width="18" height="18" viewBox="0 0 20 20" fill="none"><path d="M4 10L8 14L16 6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>;
  if (icon === 'link') return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></svg>;
  if (icon === 'heart') return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" /></svg>;
  if (icon === 'clock') return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 15 14" /></svg>;
  return null;
}

const GREEN = '#1A8737';
const AMBER = '#B8922A';
const GREY = '#7A7166';

function fullWhen(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

/* A short, stable reference the customer can quote to support. */
const refFor = (id) => `PP-${String(id || '').replace(/^pending:/, '').replace(/-/g, '').slice(0, 8).toUpperCase()}`;

export default function TikkieActivitySheet({
  item, money, isLinkPayout, charity, payoutUrl, email, onClose,
}) {
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose?.(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!item) return null;

  const amount = Number(item.amount || 0);
  const cups = item.cups == null ? null : Number(item.cups);
  const cupsText = cups == null ? null : `${cups} cup${cups === 1 ? '' : 's'}`;

  let view;
  if (item.kind === 'pending') {
    view = {
      title: 'Receipt scanned', tone: 'amber', icon: 'clock',
      sub: 'We are waiting for the smart bin to confirm how many cups went in. Your balance goes up as soon as it does.',
      status: 'Waiting for the bin', statusColor: AMBER,
    };
  } else if (item.kind === 'donation') {
    view = {
      title: `Donated to ${charity}`, tone: 'green', icon: 'heart',
      sub: 'Thank you. This part of your balance went to charity.',
      status: 'Donated', statusColor: GREEN, amountLabel: 'Donated', sign: '−',
    };
  } else if (item.kind === 'payout') {
    const open = !item.redeemed && !!payoutUrl;
    view = item.redeemed
      ? {
        title: isLinkPayout ? 'Collected via Tikkie' : 'Cashback sent', tone: 'green', icon: 'check',
        sub: isLinkPayout ? 'You collected this payout through Tikkie.' : 'This cashback was sent to you.',
        status: 'Collected', statusColor: GREEN,
      }
      : open
        ? {
          title: isLinkPayout ? 'Your Tikkie is ready' : 'Payout on its way', tone: 'amber', icon: 'link',
          sub: isLinkPayout
            ? 'You have not collected this payout yet. Open the Tikkie link below to get it.'
            : 'This payout has not reached you yet.',
          status: isLinkPayout ? 'Ready to collect' : 'On its way', statusColor: AMBER,
        }
        : {
          title: isLinkPayout ? 'Tikkie payout' : 'Cashback payout', tone: 'gray', icon: 'link',
          sub: 'This link is no longer active. If you did not collect it, contact us and we will sort it out.',
          status: 'Link no longer active', statusColor: GREY,
        };
    view = { ...view, amountLabel: 'Amount', sign: '−', link: open && isLinkPayout ? payoutUrl : null };
  } else {
    view = {
      title: `${cupsText || 'Cups'} returned`, tone: 'green', icon: 'plus',
      sub: 'The smart bin confirmed your return. The refund is in your balance, ready to collect.',
      status: 'Added to your balance', statusColor: GREEN, amountLabel: 'Refund', sign: '+',
    };
  }

  return createPortal(
    <div className="adm-overlay" onClick={onClose}>
      <div className="adm-modal" role="dialog" aria-modal="true" aria-label={view.title} onClick={e => e.stopPropagation()}>
        <button className="adm-close" onClick={onClose} aria-label="Close">×</button>

        <div className="adm-card tk-activity">
          <div className={`adm-icon adm-icon--${view.tone}`}>
            <ToneIcon icon={view.icon} />
          </div>
          <h2 className="adm-title">{view.title}</h2>
          <p className="adm-sub">{view.sub}</p>

          <div className="adm-dashed" />

          <div className="adm-row"><span className="adm-row__label">Reference</span><span className="adm-row__val">{refFor(item.id)}</span></div>
          <div className="adm-row"><span className="adm-row__label">When</span><span className="adm-row__val">{fullWhen(item.created_at)}</span></div>
          {cupsText && <div className="adm-row"><span className="adm-row__label">Cups</span><span className="adm-row__val">{cupsText}</span></div>}
          {view.amountLabel && (
            <div className="adm-row"><span className="adm-row__label">{view.amountLabel}</span><span className="adm-row__val">{view.sign}{money(amount)}</span></div>
          )}
          {email && <div className="adm-row"><span className="adm-row__label">Email</span><span className="adm-row__val">{email}</span></div>}

          <div className="adm-dashed" />

          <div className="adm-row"><span className="adm-row__label">Status</span><span className="adm-row__val" style={{ color: view.statusColor }}>{view.status}</span></div>
        </div>

        {view.link && (
          <div className="adm-collect-wrap">
            <a className="adm-collect" href={view.link}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" />
              </svg>
              Open Tikkie
            </a>
            <p className="adm-collect-note">If the link no longer opens, it may have expired. Contact us and we will reissue it.</p>
          </div>
        )}

        <button type="button" className="adm-done" onClick={onClose}>Done</button>
      </div>
    </div>,
    document.body,
  );
}
