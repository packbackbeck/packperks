import { useState } from 'react';
import { Ban, Check, Clock3, CupSoda, Package, QrCode, Timer } from 'lucide-react';
import Sheet from './Sheet';
import {
  countdown, cupsLabel, dateTimeLabel, errorText, PACKAGE_LABEL, staffCall, STATUS_META, timeLabel,
} from './staffApi';

const STATUS_ICON = { waiting: Timer, claimed: Check, partly_claimed: Check, expired: Clock3, cancelled: Ban };

/* One code from the log: when it was made, whether it was collected,
 * how many cups and what kind of package. A waiting code can be shown
 * again or cancelled. */
export default function CodeSheet({ code, now, onClose, onShow, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState(null);
  if (!code) return null;

  const meta = STATUS_META[code.status] || STATUS_META.expired;
  const Icon = STATUS_ICON[code.status] || Clock3;
  const left = Math.min(new Date(code.expires_at).getTime() - now, 15 * 60_000);
  const waiting = code.status === 'waiting' && left > 0;

  async function cancel() {
    setBusy(true);
    setError(null);
    try {
      const res = await staffCall('cancel', { id: code.id });
      onChanged?.(res.code);
      setConfirming(false);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const collected = code.claimed_at
    ? dateTimeLabel(code.claimed_at)
    : code.status === 'waiting' ? 'Not yet' : 'No';

  return (
    <Sheet open onClose={onClose} labelledBy="st-code-title">
      <div className={`st-code-head st-tone--${meta.tone}`}>
        <span className="st-code-head__icon"><Icon size={26} strokeWidth={2.4} aria-hidden="true" /></span>
        <div>
          <h2 className="st-sheet__title" id="st-code-title">{cupsLabel(code.cups)}</h2>
          <p className="st-code-head__status">
            {meta.label}
            {waiting && <> · works for {countdown(left)}</>}
          </p>
        </div>
      </div>

      <dl className="st-facts">
        <div>
          <dt><QrCode size={15} aria-hidden="true" />Made</dt>
          <dd>{dateTimeLabel(code.created_at)}</dd>
        </div>
        <div>
          <dt><Check size={15} aria-hidden="true" />Collected</dt>
          <dd className={code.claimed_at ? 'st-facts__good' : undefined}>{collected}</dd>
        </div>
        <div>
          <dt><CupSoda size={15} aria-hidden="true" />Cups</dt>
          <dd>{code.claimed_cups > 0 && code.claimed_cups < code.cups ? `${code.claimed_cups} of ${code.cups}` : code.cups}</dd>
        </div>
        <div>
          <dt><Package size={15} aria-hidden="true" />Package</dt>
          <dd>{PACKAGE_LABEL[code.package_type] || code.package_type}</dd>
        </div>
        <div>
          <dt><Clock3 size={15} aria-hidden="true" />{code.status === 'cancelled' ? 'Cancelled' : waiting ? 'Works until' : 'Stopped working'}</dt>
          <dd>{code.status === 'cancelled' && code.cancelled_at ? timeLabel(code.cancelled_at) : timeLabel(code.expires_at)}</dd>
        </div>
      </dl>

      <p className="st-code-id">Code {code.id.slice(0, 8).toUpperCase()}</p>

      {error && <p className="st-alert" role="alert">{error}</p>}

      {waiting && !confirming && (
        <div className="st-sheet__actions">
          <button type="button" className="st-btn st-btn--primary" onClick={() => onShow(code)}>
            <QrCode size={18} aria-hidden="true" />
            Show this code again
          </button>
          <button type="button" className="st-btn st-btn--quiet st-btn--danger-text" onClick={() => setConfirming(true)}>
            Cancel this code
          </button>
        </div>
      )}
      {waiting && confirming && (
        <div className="st-confirm">
          <p>Cancel this code? A customer who scans it gets nothing.</p>
          <div className="st-confirm__row">
            <button type="button" className="st-btn st-btn--quiet" onClick={() => setConfirming(false)} disabled={busy}>Keep it</button>
            <button type="button" className="st-btn st-btn--danger" onClick={cancel} disabled={busy}>
              {busy ? 'Cancelling…' : 'Cancel code'}
            </button>
          </div>
        </div>
      )}
    </Sheet>
  );
}
