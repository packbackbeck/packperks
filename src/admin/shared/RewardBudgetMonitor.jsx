import './RewardBudgetMonitor.css';

/* Shared admin-only reward-budget monitor: progress bar + committed/remaining
 * figures + status. Used on the Overview (with a "Manage in Settings" button)
 * and inside the Settings budget section. Amounts are admin-only; this is
 * never rendered in the customer app. */
export default function RewardBudgetMonitor({
  cap = 0,
  enabled = false,
  spent = 0,
  loading = false,
  title = 'Reward budget',
  onManage,
}) {
  const capNum = Math.max(0, Number(cap) || 0);
  const spentNum = Math.max(0, Number(spent) || 0);
  const pct = capNum > 0 ? Math.min(100, (spentNum / capNum) * 100) : 0;
  const remaining = Math.max(0, capNum - spentNum);
  const isBlocked = enabled && capNum > 0 && spentNum >= capNum;
  const tone = !enabled ? 'off' : isBlocked ? 'blocked' : pct >= 80 ? 'warn' : 'ok';
  const statusText = !enabled ? 'Cap off' : isBlocked ? 'Claims paused' : 'Active';

  return (
    <div className={`rbm rbm--${tone}`}>
      <div className="rbm__head">
        <span className="rbm__title">{title}</span>
        <span className="rbm__pill">{statusText}</span>
      </div>

      {loading ? (
        <div className="rbm__loading">Loading…</div>
      ) : (
        <>
          <div className="rbm__bar" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
            <div className="rbm__fill" style={{ width: `${pct}%` }} />
          </div>
          <div className="rbm__figures">
            <span><strong>€{spentNum.toFixed(2)}</strong> committed</span>
            <span>€{remaining.toFixed(2)} left of €{capNum.toFixed(2)}</span>
          </div>
          <p className="rbm__note">
            {isBlocked
              ? 'Cap reached. New cashback claims are paused for customers.'
              : enabled
                ? 'Committed cashback (paid plus in-review). Refunds and donations are excluded.'
                : 'No cap is enforced right now.'}
          </p>
        </>
      )}

      {onManage && (
        <button type="button" className="rbm__manage" onClick={onManage}>
          Manage in Settings
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <line x1="5" y1="12" x2="19" y2="12" />
            <polyline points="12 5 19 12 12 19" />
          </svg>
        </button>
      )}
    </div>
  );
}
