import { useState } from 'react';
import './BulkDeleteBar.css';

/* Floating action bar shown when ≥1 row is selected in an admin table.
 * Two-step confirm (click → confirm) so a bulk delete can't fire on a
 * single misclick. `onDelete` should perform the delete and resolve. */
export default function BulkDeleteBar({ count, noun = 'records', onDelete, onClear }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  if (count <= 0) return null;
  const label = `${count} ${noun}${count === 1 ? '' : ''}`;

  async function doDelete() {
    setBusy(true);
    setError(null);
    try {
      await onDelete();
      setConfirming(false);
    } catch (e) {
      setError(e?.message || 'Delete failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bulkbar" role="region" aria-label="Bulk actions">
      <div className="bulkbar__left">
        <span className="bulkbar__icon" aria-hidden="true">⚠️</span>
        <span className="bulkbar__count">{label} selected</span>
      </div>

      {!confirming ? (
        <div className="bulkbar__actions">
          <button className="bulkbar__ghost" onClick={onClear} disabled={busy}>Clear</button>
          <button className="bulkbar__danger" onClick={() => setConfirming(true)} disabled={busy}>
            Delete selected
          </button>
        </div>
      ) : (
        <div className="bulkbar__actions">
          <span className="bulkbar__warn">
            Permanently delete {label}? This can’t be undone.
          </span>
          <button className="bulkbar__ghost" onClick={() => setConfirming(false)} disabled={busy}>Cancel</button>
          <button className="bulkbar__danger" onClick={doDelete} disabled={busy}>
            {busy ? 'Deleting…' : 'Confirm delete'}
          </button>
        </div>
      )}

      {error && <span className="bulkbar__error">{error}</span>}
    </div>
  );
}
