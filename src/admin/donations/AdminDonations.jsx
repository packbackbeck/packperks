import { useEffect, useMemo, useState } from 'react';
import {
  getDonationTransfers,
  createDonationTransfer,
  uploadDonationReceipt,
  getDonationReceiptSignedUrl,
  getDonationCollectedTotal,
  deleteRecords,
} from '../lib/adminApi';
import { logAction } from '../auth/actionLog';
import { useAuth } from '../auth/AuthContext';
import EmptyState from '../shared/EmptyState';
import QuickLinks from '../shared/QuickLinks';
import { useBulkSelection } from '../shared/useBulkSelection';
import BulkDeleteBar from '../shared/BulkDeleteBar';
import './AdminDonations.css';

/* ─────────────────────────────────────────────────────────────────────
 * AdminDonations — money-out audit for the donation flow.
 *
 * Customers donate cups via the "Donate" CTA on the home screen. The
 * cup value (~€1.00 per cup) accumulates as completed claims with
 * type='donation' (or legacy direct_refund + null reward_id). The cash
 * itself stays in the PackPerks operating account until an admin
 * actually wires it to the partner charity (Plastic Soup Foundation
 * by default).
 *
 * This page exists so admins can:
 *   1. See how much they've collected from customers to date.
 *   2. Record outgoing transfers (amount + date + receipt photo +
 *      bank reference).
 *   3. See the running outstanding balance — "we still owe the charity
 *      €X.YZ".
 *
 * Section structure:
 *   • Header — title + status pill ("All settled" / "X owed")
 *   • Stat trio: Collected · Transferred · Outstanding
 *   • Add-transfer card with inline form + receipt upload
 *   • Past transfers table with receipt thumbnails + bank reference
 *
 * Every transfer write also fires a `donation.transfer` row to the
 * action log so a future audit can answer "who marked the September
 * batch as sent" without database forensics. */

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}

function formatEuro(n) {
  return `€${(n ?? 0).toFixed(2)}`;
}

export default function AdminDonations({ onNavigate, draftState }) {
  const { profile } = useAuth();
  const role = profile?.role || 'checker';
  const canRecord = role === 'owner' || role === 'admin';

  const [transfers, setTransfers] = useState([]);
  const [collected, setCollected] = useState({ amount: 0, cups: 0 });
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState(null);

  // Default recipient pulls from the published donation copy, with the
  // sensible Plastic Soup Foundation fallback used elsewhere.
  const defaultRecipient = draftState?.draft?.settings?.donationRecipient || 'Plastic Soup Foundation';

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const [trs, total] = await Promise.all([
        getDonationTransfers(),
        getDonationCollectedTotal(),
      ]);
      setTransfers(trs);
      setCollected(total);
    } catch (e) {
      setError(e.message || 'Failed to load donations.');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { refresh(); }, []);

  const sel = useBulkSelection(transfers);

  const totalTransferred = useMemo(
    () => transfers.reduce((s, t) => s + Number(t.amount_eur || 0), 0),
    [transfers],
  );
  const outstanding = Math.max(0, collected.amount - totalTransferred);
  const overshoot   = Math.max(0, totalTransferred - collected.amount);

  // Status pill copy — three flavours: all clear, money owed, money overpaid.
  const statusKind = outstanding > 0.01 ? 'owed' : overshoot > 0.01 ? 'over' : 'clear';
  const statusCopy = {
    owed:  `${formatEuro(outstanding)} still owed to the charity`,
    over:  `${formatEuro(overshoot)} sent above what customers donated`,
    clear: 'All settled — donations are fully transferred',
  }[statusKind];

  return (
    <div className="admin-donations">
      {/* Header */}
      <header className="ad-header">
        <div className="ad-header__text">
          <h1 className="ad-header__title">Charity transfers</h1>
          <p className="ad-header__sub">
            Customers turn cups into donations via the "Donate" button on the user app.
            Use this page to record when you wire the collected funds to the partner
            charity and to keep the running balance visible.
          </p>
        </div>
        <div className={`ad-status ad-status--${statusKind}`}>
          <span className="ad-status__dot" />
          {statusCopy}
        </div>
      </header>

      {error && (
        <div className="ad-error">
          <strong>Couldn't load donations:</strong> {error}
          <button onClick={refresh}>Retry</button>
        </div>
      )}

      {/* Stat trio */}
      <section className="ad-stats">
        <StatCard
          tone="purple"
          label="Collected from customers"
          value={formatEuro(collected.amount)}
          sub={`${collected.cups} cup${collected.cups === 1 ? '' : 's'} donated`}
          tooltip="Sum of payout_amount on completed donation claims. Each cup → cash via the refund rate at the moment the claim was approved."
        />
        <StatCard
          tone="green"
          label="Transferred to charity"
          value={formatEuro(totalTransferred)}
          sub={`${transfers.length} transfer${transfers.length === 1 ? '' : 's'} recorded`}
          tooltip="Sum of amount_eur across donation_transfers. Click a row below to see the receipt."
        />
        <StatCard
          tone={statusKind === 'owed' ? 'orange' : 'cream'}
          label={statusKind === 'over' ? 'Over-transferred' : 'Outstanding balance'}
          value={statusKind === 'over' ? formatEuro(overshoot) : formatEuro(outstanding)}
          sub={
            statusKind === 'owed'
              ? 'Still to wire to the charity'
              : statusKind === 'over'
                ? 'Programme covered the difference'
                : '✓ Fully settled'
          }
          tooltip="Difference between what customers donated and what you've transferred. Should trend to zero; a small over-transfer is fine if the programme tops up."
        />
      </section>

      {/* Add transfer */}
      {canRecord ? (
        <AddTransferCard
          defaultRecipient={defaultRecipient}
          outstanding={outstanding}
          onCreated={(row) => {
            setTransfers(prev => [row, ...prev]);
            logAction({
              action: 'donation.transfer',
              targetType: 'donation_transfer',
              targetId: row.id,
              metadata: {
                amount_eur: Number(row.amount_eur),
                recipient: row.recipient,
                reference: row.reference,
                has_receipt: !!row.receipt_path,
              },
            });
          }}
        />
      ) : (
        <div className="ad-readonly">
          Your role can view donation transfers but can't record new ones. Ask an Owner or Admin to wire the money.
        </div>
      )}

      {/* Past transfers */}
      <section className="ad-transfers">
        <header className="ad-transfers__head">
          <h2 className="ad-transfers__title">Past transfers</h2>
          <p className="ad-transfers__sub">Each row is one bank transfer to the charity. Click the receipt to enlarge.</p>
        </header>

        {loading ? (
          <div className="ad-transfers__loading">Loading transfers…</div>
        ) : transfers.length === 0 ? (
          <EmptyState
            icon={
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" />
                <path d="M3 5v14a2 2 0 0 0 2 2h16v-5" />
                <path d="M18 12a2 2 0 0 0 0 4h4v-4Z" />
              </svg>
            }
            title="No transfers yet"
            body={
              collected.amount > 0
                ? `Customers have donated ${formatEuro(collected.amount)} so far. Use the form above to record your first wire to the charity.`
                : 'When customers start donating cups, the rolled-up total will show in the "Collected" card above and you can start recording outgoing transfers.'
            }
            tone="action"
          />
        ) : (
          <div className="ad-transfers__table-wrap">
            <table className="ad-transfers__table">
              <thead>
                <tr>
                  {canRecord && (
                    <th className="bulk-check-cell">
                      <input
                        type="checkbox"
                        checked={sel.allSelected}
                        ref={el => { if (el) el.indeterminate = sel.someSelected && !sel.allSelected; }}
                        onChange={sel.toggleAll}
                        aria-label="Select all transfers"
                      />
                    </th>
                  )}
                  <th>Date</th>
                  <th>Recipient</th>
                  <th>Amount</th>
                  <th>Reference</th>
                  <th>Receipt</th>
                  <th>Recorded</th>
                </tr>
              </thead>
              <tbody>
                {transfers.map(t => (
                  <TransferRow
                    key={t.id}
                    transfer={t}
                    selectable={canRecord}
                    checked={sel.isSelected(t.id)}
                    onToggle={() => sel.toggle(t.id)}
                  />
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={canRecord ? 3 : 2} className="ad-transfers__tf-label">Total transferred</td>
                  <td className="ad-transfers__tf-val">{formatEuro(totalTransferred)}</td>
                  <td colSpan={3} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>

      {canRecord && (
        <BulkDeleteBar
          count={sel.count}
          noun="transfers"
          onClear={sel.clear}
          onDelete={async () => {
            await deleteRecords('donation_transfers', sel.selectedIds);
            sel.clear();
            refresh();
          }}
        />
      )}

      <QuickLinks currentPage="donations" onNavigate={onNavigate} />
    </div>
  );
}

/* ── Stat tile ─────────────────────────────────────────────────────── */
function StatCard({ tone, label, value, sub, tooltip }) {
  return (
    <div className={`ad-stat ad-stat--${tone}`} title={tooltip}>
      <div className="ad-stat__label">
        {label}
        {tooltip && (
          <span className="ad-stat__info" aria-hidden>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="16" x2="12" y2="12" />
              <line x1="12" y1="8" x2="12.01" y2="8" />
            </svg>
          </span>
        )}
      </div>
      <div className="ad-stat__value">{value}</div>
      {sub && <div className="ad-stat__sub">{sub}</div>}
    </div>
  );
}

/* ── Inline form to record a new transfer ──────────────────────────── */
function AddTransferCard({ defaultRecipient, outstanding, onCreated }) {
  const today = new Date().toISOString().slice(0, 10);
  const [amount, setAmount]       = useState(outstanding > 0 ? outstanding.toFixed(2) : '');
  const [transferDate, setDate]   = useState(today);
  const [recipient, setRecipient] = useState(defaultRecipient);
  const [reference, setReference] = useState('');
  const [note, setNote]           = useState('');
  const [file, setFile]           = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState(null);
  const [info, setInfo] = useState(null);

  // Snap the prefilled amount whenever the outstanding-owed total
  // refreshes, but only while the field hasn't been manually edited
  // (we detect that via a string-equality check against the previous
  // outstanding figure).
  useEffect(() => {
    if (!amount && outstanding > 0) setAmount(outstanding.toFixed(2));
  }, [outstanding]); // eslint-disable-line

  async function handleSubmit(e) {
    e.preventDefault();
    const amt = parseFloat(amount);
    if (!Number.isFinite(amt) || amt <= 0) { setErr('Enter a positive amount in euros.'); return; }
    if (!transferDate) { setErr('Pick the transfer date.'); return; }
    if (!recipient.trim()) { setErr('Recipient is required.'); return; }
    if (!file) { setErr('Please attach a transfer receipt (image or PDF).'); return; }

    setErr(null);
    setInfo(null);
    setSubmitting(true);
    try {
      const { path, filename } = await uploadDonationReceipt(file);
      const row = await createDonationTransfer({
        amount: amt,
        transferDate,
        recipient: recipient.trim(),
        reference: reference.trim(),
        note: note.trim(),
        receiptPath: path,
        receiptFilename: filename,
      });
      setInfo(`Recorded a transfer of €${amt.toFixed(2)} to ${recipient.trim()}.`);
      onCreated?.(row);
      // Reset for the next entry.
      setAmount('');
      setReference('');
      setNote('');
      setFile(null);
      // Keep date + recipient — admins typically record several
      // transfers on the same wire-day to the same partner.
    } catch (e) {
      setErr(e.message || 'Failed to record the transfer.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="ad-add" onSubmit={handleSubmit}>
      <div className="ad-add__head">
        <div className="ad-add__head-text">
          <h2 className="ad-add__title">Record a transfer</h2>
          <p className="ad-add__sub">
            Wire the collected donation cash to the partner charity, then capture the proof
            here. Attach the bank confirmation (PDF or screenshot) so this row stands up to
            an audit.
          </p>
        </div>
      </div>

      <div className="ad-add__grid">
        <label className="ad-add__field">
          <span className="ad-add__label">Amount (€)</span>
          <input
            type="number"
            step="0.01"
            min="0.01"
            value={amount}
            onChange={e => setAmount(e.target.value)}
            placeholder="0.00"
            className="ad-add__input"
            required
          />
          {outstanding > 0 && (
            <span className="ad-add__hint">
              {formatEuro(outstanding)} still owed.{' '}
              <button
                type="button"
                className="ad-add__hint-link"
                onClick={() => setAmount(outstanding.toFixed(2))}
              >
                Fill outstanding amount
              </button>
            </span>
          )}
        </label>

        <label className="ad-add__field">
          <span className="ad-add__label">Transfer date</span>
          <input
            type="date"
            value={transferDate}
            onChange={e => setDate(e.target.value)}
            className="ad-add__input"
            required
          />
        </label>

        <label className="ad-add__field ad-add__field--wide">
          <span className="ad-add__label">Recipient</span>
          <input
            type="text"
            value={recipient}
            onChange={e => setRecipient(e.target.value)}
            placeholder="Plastic Soup Foundation"
            className="ad-add__input"
            required
          />
        </label>

        <label className="ad-add__field">
          <span className="ad-add__label">Bank reference (optional)</span>
          <input
            type="text"
            value={reference}
            onChange={e => setReference(e.target.value)}
            placeholder="e.g. PSF-2025-09"
            className="ad-add__input"
          />
        </label>

        <label className="ad-add__field ad-add__field--wide">
          <span className="ad-add__label">Internal note (optional)</span>
          <input
            type="text"
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="e.g. Quarterly batch, includes August + September donations."
            className="ad-add__input"
          />
        </label>

        <label className="ad-add__field ad-add__field--wide">
          <span className="ad-add__label">Receipt (required)</span>
          <div className={`ad-add__file${file ? ' ad-add__file--has' : ''}`}>
            <input
              type="file"
              accept="image/*,application/pdf"
              onChange={e => setFile(e.target.files?.[0] || null)}
              className="ad-add__file-input"
            />
            <span className="ad-add__file-cta">
              {file ? `📎 ${file.name}` : 'Drop a file here or click to upload — image or PDF'}
            </span>
            {file && (
              <button
                type="button"
                className="ad-add__file-clear"
                onClick={() => setFile(null)}
                aria-label="Remove file"
              >×</button>
            )}
          </div>
        </label>
      </div>

      {err && <p className="ad-add__err">{err}</p>}
      {info && <p className="ad-add__info">{info}</p>}

      <div className="ad-add__actions">
        <button
          type="submit"
          className="ad-add__submit"
          disabled={submitting}
        >
          {submitting ? 'Recording…' : 'Record transfer'}
        </button>
      </div>
    </form>
  );
}

/* ── Single transfer row with receipt lightbox ────────────────────── */
function TransferRow({ transfer, selectable = false, checked = false, onToggle }) {
  const [signedUrl, setSignedUrl] = useState(null);
  const [lightbox, setLightbox]   = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (transfer.receipt_path) {
      getDonationReceiptSignedUrl(transfer.receipt_path).then(u => {
        if (!cancelled) setSignedUrl(u);
      });
    }
    return () => { cancelled = true; };
  }, [transfer.id, transfer.receipt_path]);

  const isPdf = (transfer.receipt_filename || transfer.receipt_path || '').toLowerCase().endsWith('.pdf');

  return (
    <>
      <tr className={checked ? 'ad-transfers__row--selected' : ''}>
        {selectable && (
          <td className="bulk-check-cell">
            <input
              type="checkbox"
              checked={checked}
              onChange={onToggle}
              aria-label="Select transfer"
            />
          </td>
        )}
        <td className="ad-transfers__date">{formatDate(transfer.transfer_date)}</td>
        <td>{transfer.recipient}</td>
        <td className="ad-transfers__amount">{formatEuro(Number(transfer.amount_eur))}</td>
        <td className="ad-transfers__ref">
          {transfer.reference || <span className="ad-transfers__muted">—</span>}
        </td>
        <td>
          {!transfer.receipt_path ? (
            <span className="ad-transfers__muted">No file</span>
          ) : isPdf ? (
            <a
              href={signedUrl || '#'}
              target="_blank"
              rel="noopener noreferrer"
              className="ad-transfers__pdf"
              title={transfer.receipt_filename || 'Receipt PDF'}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
              PDF
            </a>
          ) : (
            <button
              type="button"
              className="ad-transfers__thumb"
              onClick={() => setLightbox(true)}
              title="Click to enlarge"
            >
              {signedUrl
                ? <img src={signedUrl} alt="Transfer receipt" />
                : <span className="ad-transfers__thumb-loading">…</span>}
            </button>
          )}
        </td>
        <td className="ad-transfers__recorded">{formatDate(transfer.created_at)}</td>
      </tr>
      {lightbox && signedUrl && (
        <tr className="ad-transfers__lightbox-row">
          <td colSpan={selectable ? 7 : 6}>
            <div className="ad-lightbox" onClick={() => setLightbox(false)}>
              <button className="ad-lightbox__close" onClick={e => { e.stopPropagation(); setLightbox(false); }}>×</button>
              <img src={signedUrl} alt="Transfer receipt enlarged" onClick={e => e.stopPropagation()} />
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
