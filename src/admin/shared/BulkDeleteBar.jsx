import { useState } from 'react';
import { ListChecks, Trash2, TriangleAlert } from 'lucide-react';
import { Button } from '../ui';
import './BulkDeleteBar.css';

/* Floating action bar shown when ≥1 row is selected in an admin table.
 * Two-step confirm (click → confirm) so a bulk delete can't fire on a
 * single misclick. `onDelete` should perform the delete and resolve. */
/* `extraAction` (optional) — a non-destructive action button shown alongside
 * Delete (e.g. "Merge selected" on the Users table). Pass:
 *   { label, onClick, disabled?, visible? }
 * `visible` lets the caller hide the button at certain counts (e.g. merge
 * needs ≥2 selected). It's hidden during the delete-confirm step. */
export default function BulkDeleteBar({ count, noun = 'records', onDelete, onClear, extraAction }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  if (count <= 0) return null;
  // Nouns are passed plural ("users", "batches"); use the singular for one.
  const singular = /(ch|sh|x)es$/.test(noun) ? noun.slice(0, -2) : noun.replace(/s$/, '');
  const label = `${count} ${count === 1 ? singular : noun}`;

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
    <div className={`bulkbar${confirming ? ' bulkbar--confirm' : ''}`} role="region" aria-label="Bulk actions">
      <div className="bulkbar__left">
        <span className="bulkbar__icon" aria-hidden="true">
          {confirming ? <TriangleAlert size={15} /> : <ListChecks size={15} />}
        </span>
        {!confirming ? (
          <span className="bulkbar__count">{label} selected</span>
        ) : (
          <span className="bulkbar__warn">
            Permanently delete {label}? This can’t be undone.
          </span>
        )}
      </div>

      {!confirming ? (
        <div className="bulkbar__actions">
          <Button variant="ghost" size="sm" onClick={onClear} disabled={busy}>Clear</Button>
          {extraAction && (extraAction.visible !== false) && (
            <Button
              variant="primary"
              size="sm"
              onClick={extraAction.onClick}
              disabled={busy || extraAction.disabled}
            >
              {extraAction.label}
            </Button>
          )}
          <Button variant="danger-ghost" size="sm" icon={Trash2} className="bulkbar__delete" onClick={() => setConfirming(true)} disabled={busy}>
            Delete selected
          </Button>
        </div>
      ) : (
        <div className="bulkbar__actions">
          <Button variant="outline" size="sm" onClick={() => setConfirming(false)} disabled={busy}>Cancel</Button>
          <Button variant="danger" size="sm" icon={Trash2} onClick={doDelete} disabled={busy}>
            {busy ? 'Deleting…' : 'Confirm delete'}
          </Button>
        </div>
      )}

      {error && <span className="bulkbar__error" role="alert">{error}</span>}
    </div>
  );
}
