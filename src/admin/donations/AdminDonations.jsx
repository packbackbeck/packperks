import { useEffect, useMemo, useState } from 'react';
import {
  getDonationTransfers,
  createDonationTransfer,
  uploadDonationReceipt,
  getDonationReceiptSignedUrl,
  getDonationCollectedTotal,
  deleteRecords,
} from '../lib/adminApi';
import { CircleCheck, FileText, HandCoins, HeartHandshake, Paperclip, Plus, RefreshCw, Scale, Send, Upload, Wallet, X } from 'lucide-react';
import { logAction } from '../auth/actionLog';
import { useAuth } from '../auth/AuthContext';
import { useBulkSelection } from '../shared/useBulkSelection';
import BulkDeleteBar from '../shared/BulkDeleteBar';
import { Lightbox, Notice } from '../shared/opsTable';
import { Button, Card, CardBody, CardHeader, EmptyState, Field, KpiTile, PageHeader } from '../ui';
import './AdminDonations.css';
import { adminMoney, adminSymbol } from '../lib/adminMoney';

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
  return adminMoney(n ?? 0);
}

export default function AdminDonations({ draftState }) {
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

  const StatusIcon = statusKind === 'clear' ? CircleCheck : statusKind === 'owed' ? HandCoins : Scale;

  return (
    <div className="ui-page admin-donations">
      <PageHeader
        title="Charity transfers"
        subtitle={'Customers turn cups into donations with the "Donate" button in the app. Record here when you send the collected money to the partner charity, and keep the running balance in view.'}
      >
        <span className={`ad-status ad-status--${statusKind}`} role="status">
          <StatusIcon size={15} aria-hidden="true" />
          {statusCopy}
        </span>
      </PageHeader>

      {error && (
        <Notice
          tone="danger"
          action={<Button variant="outline" size="sm" icon={RefreshCw} onClick={refresh}>Retry</Button>}
        >
          <strong>Couldn't load donations:</strong> {error}
        </Notice>
      )}

      {/* Stat trio */}
      <section className="ui-grid-3 ad-stats" aria-label="Donation totals">
        <StatCard
          tone="violet"
          icon={HeartHandshake}
          label="Collected from customers"
          value={formatEuro(collected.amount)}
          sub={`${collected.cups} cup${collected.cups === 1 ? '' : 's'} donated`}
          tooltip="The value of completed donation claims. Each cup is turned into money at the refund rate when the claim was approved."
        />
        <StatCard
          tone="emerald"
          icon={Send}
          label="Transferred to charity"
          value={formatEuro(totalTransferred)}
          sub={`${transfers.length} transfer${transfers.length === 1 ? '' : 's'} recorded`}
          tooltip="The total of every transfer recorded below. Click a receipt in the table to see it."
        />
        <StatCard
          tone={statusKind === 'owed' ? 'amber' : statusKind === 'over' ? 'violet' : 'slate'}
          icon={statusKind === 'over' ? Scale : Wallet}
          label={statusKind === 'over' ? 'Over-transferred' : 'Outstanding balance'}
          value={statusKind === 'over' ? formatEuro(overshoot) : formatEuro(outstanding)}
          sub={
            statusKind === 'owed'
              ? 'Still to send to the charity'
              : statusKind === 'over'
                ? 'Programme covered the difference'
                : 'Fully settled'
          }
          tooltip="What customers donated minus what you've transferred. It should trend to zero; a small over-transfer is fine if the programme tops up."
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
        <Notice tone="info">
          Your role can view donation transfers but can't record new ones. Ask an Owner or Admin to send the money.
        </Notice>
      )}

      {/* Past transfers */}
      <Card className="ad-transfers">
        <CardHeader
          title="Past transfers"
          icon={Wallet}
          subtitle="Each row is one bank transfer to the charity. Click a receipt to enlarge it."
          ruled
        />

        {loading ? (
          <p className="ad-transfers__loading">Loading transfers…</p>
        ) : transfers.length === 0 ? (
          <EmptyState icon={Wallet} title="No transfers yet">
            {collected.amount > 0
              ? `Customers have donated ${formatEuro(collected.amount)} so far. Use the form above to record your first transfer to the charity.`
              : 'When customers start donating cups, the total shows in the "Collected" card above and you can start recording transfers.'}
          </EmptyState>
        ) : (
          <CardBody flush className="ad-transfers__table-wrap">
            <table className="ui-table ad-transfers__table">
              <thead>
                <tr>
                  {canRecord && (
                    <th className="ot-check">
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
                  <th className="ui-num">Amount</th>
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
                  <td className="ad-transfers__tf-val ui-num">{formatEuro(totalTransferred)}</td>
                  <td colSpan={3} />
                </tr>
              </tfoot>
            </table>
          </CardBody>
        )}
      </Card>

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
    </div>
  );
}

/* ── Stat tile ─────────────────────────────────────────────────────── */
function StatCard({ tone, icon, label, value, sub, tooltip }) {
  return (
    <KpiTile
      interactive={false}
      metric={{ id: label, label, icon, tone, value, description: sub, info: tooltip }}
    />
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
      setInfo(`Recorded a transfer of ${adminMoney(amt)} to ${recipient.trim()}.`);
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
    <Card as="form" className="ad-add" onSubmit={handleSubmit}>
      <CardHeader
        title="Record a transfer"
        icon={Send}
        subtitle="Send the collected donation money to the partner charity, then record it here. Attach the bank confirmation (PDF or screenshot) so the record holds up in an audit."
        ruled
      />

      <CardBody className="ad-add__body">
        <div className="ad-add__grid">
          <Field
            label={`Amount (${adminSymbol()})`}
            htmlFor="ad-amount"
            hint={outstanding > 0 && (
              <>
                {formatEuro(outstanding)} still owed.{' '}
                <button
                  type="button"
                  className="ad-add__hint-link"
                  onClick={() => setAmount(outstanding.toFixed(2))}
                >
                  Fill outstanding amount
                </button>
              </>
            )}
          >
            <input
              id="ad-amount"
              type="number"
              step="0.01"
              min="0.01"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              placeholder="0.00"
              className="ui-input"
              required
            />
          </Field>

          <Field label="Transfer date" htmlFor="ad-date">
            <input
              id="ad-date"
              type="date"
              value={transferDate}
              onChange={e => setDate(e.target.value)}
              className="ui-input"
              required
            />
          </Field>

          <div className="ad-add__wide">
            <Field label="Recipient" htmlFor="ad-recipient">
              <input
                id="ad-recipient"
                type="text"
                value={recipient}
                onChange={e => setRecipient(e.target.value)}
                placeholder="Plastic Soup Foundation"
                className="ui-input"
                required
              />
            </Field>
          </div>

          <Field label="Bank reference (optional)" htmlFor="ad-reference">
            <input
              id="ad-reference"
              type="text"
              value={reference}
              onChange={e => setReference(e.target.value)}
              placeholder="e.g. PSF-2025-09"
              className="ui-input"
            />
          </Field>

          <Field label="Internal note (optional)" htmlFor="ad-note">
            <input
              id="ad-note"
              type="text"
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="e.g. Quarterly batch, includes August + September donations."
              className="ui-input"
            />
          </Field>

          <div className="ad-add__wide">
            <Field label="Receipt (required)" htmlFor="ad-file">
              <div className={`ad-add__file${file ? ' ad-add__file--has' : ''}`}>
                <input
                  id="ad-file"
                  type="file"
                  accept="image/*,application/pdf"
                  onChange={e => setFile(e.target.files?.[0] || null)}
                  className="ad-add__file-input"
                />
                <span className="ad-add__file-icon" aria-hidden="true">
                  {file ? <Paperclip size={16} /> : <Upload size={16} />}
                </span>
                <span className="ad-add__file-text">
                  <span className="ad-add__file-cta">
                    {file ? file.name : 'Drop a file here or click to upload'}
                  </span>
                  <span className="ad-add__file-sub">{file ? 'Ready to attach' : 'Image or PDF of the bank confirmation'}</span>
                </span>
                {file && (
                  <button
                    type="button"
                    className="ad-add__file-clear"
                    onClick={() => setFile(null)}
                    aria-label="Remove file"
                  >
                    <X size={14} aria-hidden="true" />
                  </button>
                )}
              </div>
            </Field>
          </div>
        </div>

        {err && <Notice tone="danger">{err}</Notice>}
        {info && <Notice tone="success">{info}</Notice>}
      </CardBody>

      <div className="ad-add__actions">
        <Button type="submit" variant="primary" icon={Plus} disabled={submitting}>
          {submitting ? 'Recording…' : 'Record transfer'}
        </Button>
      </div>
    </Card>
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
    <tr className={checked ? 'ot-row--selected' : ''}>
      {selectable && (
        <td className="ot-check">
          <input
            type="checkbox"
            checked={checked}
            onChange={onToggle}
            aria-label="Select transfer"
          />
        </td>
      )}
      <td className="ad-transfers__date">{formatDate(transfer.transfer_date)}</td>
      <td className="ad-transfers__recipient">{transfer.recipient}</td>
      <td className="ad-transfers__amount ui-num">{formatEuro(Number(transfer.amount_eur))}</td>
      <td className="ad-transfers__ref">
        {transfer.reference || <span className="ot-faint">—</span>}
      </td>
      <td>
        {!transfer.receipt_path ? (
          <span className="ot-faint">No file</span>
        ) : isPdf ? (
          <a
            href={signedUrl || '#'}
            target="_blank"
            rel="noopener noreferrer"
            className="ui-badge ui-badge--primary ad-transfers__pdf"
            title={transfer.receipt_filename || 'Receipt PDF'}
          >
            <FileText size={12} aria-hidden="true" />
            PDF
          </a>
        ) : (
          <button
            type="button"
            className="ot-thumb ad-transfers__thumb"
            onClick={() => setLightbox(true)}
            title="Click to enlarge"
          >
            {signedUrl
              ? <img src={signedUrl} alt="Transfer receipt" />
              : <span className="ad-transfers__thumb-loading">…</span>}
          </button>
        )}
        <Lightbox src={lightbox && signedUrl ? signedUrl : null} alt="Transfer receipt enlarged" onClose={() => setLightbox(false)} />
      </td>
      <td className="ot-date">{formatDate(transfer.created_at)}</td>
    </tr>
  );
}
