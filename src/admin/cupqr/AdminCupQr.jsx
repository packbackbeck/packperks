import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { toJpeg, toPng } from 'html-to-image';
import { jsPDF } from 'jspdf';
import { generateCups, setBatchExpiry, revokeBatch, unrevokeBatch, listCupBatches, deleteCupBatches } from '../lib/adminApi';
import { printCupReceipt, getPrinterIp, setPrinterIp, getLogoKeys, setLogoKeys } from '../lib/eposPrint';
import { useOrg } from '../context/OrgContext';
import { logAction } from '../auth/actionLog';
import packbackLogo from '../../assets/images/packback-logo.png';
import QuickLinks from '../shared/QuickLinks';
import { useBulkSelection } from '../shared/useBulkSelection';
import BulkDeleteBar from '../shared/BulkDeleteBar';
import './AdminCupQr.css';

/* Expiry presets for the batch generation form (P-21).
 *   id    — used as React key + form state value
 *   label — human readable
 *   ms    — milliseconds to add to "now"; null = no expiry */
const EXPIRY_PRESETS = [
  { id: 'never', label: 'Never expires',  ms: null },
  { id: '1h',    label: 'Expires in 1 hour',   ms: 60 * 60 * 1000 },
  { id: '24h',   label: 'Expires in 24 hours', ms: 24 * 60 * 60 * 1000 },
  { id: '7d',    label: 'Expires in 7 days',   ms: 7 * 24 * 60 * 60 * 1000 },
  { id: '30d',   label: 'Expires in 30 days',  ms: 30 * 24 * 60 * 60 * 1000 },
];

// Public app URL the QR code points to. The QR ALWAYS targets the
// production Vercel domain — a printed receipt is scanned by a real
// customer's phone, which must land on the live, working app (not a
// localhost dev server they can't reach). So batches generated from
// localhost OR Vercel both produce QRs that open the Vercel app.
const PROD_URL = 'https://packperks-v1.vercel.app/';

/* ─────────────────────────────────────────────────────────────────────
 * AdminCupQr — generates and prints scannable cup-return receipts.
 *
 * Flow:
 *   1. Admin picks a count (1..50) and optional restaurant/session metadata.
 *   2. Click "Generate" → calls the generate-cups edge function, which
 *      mints N rows in the `cups` table with status='available'.
 *   3. The returned UUIDs become a comma-separated `?cups=` URL param
 *      on the Vercel PROD_URL — that's the QR payload.
 *   4. We render the receipt template (matches the PackBack mock) with
 *      the live QR; "Print / Save as PDF" opens the browser print dialog
 *      scoped to just the receipt panel.
 *
 * Each "Generate" creates a fresh batch — old QRs remain valid in the
 * database until they're scanned by a user. Printing isn't required;
 * the QR on screen is scannable directly.
 * ───────────────────────────────────────────────────────────────────── */
export default function AdminCupQr({ onNavigate }) {
  const { activeOrg } = useOrg();
  const [count, setCount] = useState(1);
  const [restaurant, setRestaurant] = useState(
    activeOrg ? `${activeOrg.partner_brand_name || activeOrg.name} — Location` : 'Location 1'
  );
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(null);
  const [batch, setBatch] = useState(null); // { batch_id, cup_ids, url, generatedAt, expires_at }
  const qrCanvasRef = useRef(null);
  const receiptRef = useRef(null);
  const [exporting, setExporting] = useState(null); // 'jpg' | 'pdf' | null

  /* Epson TM-m30III (ePOS-Print over Ethernet). printerIp is editable +
   * persisted; printStatus drives the inline success/error message. */
  const [printerIp, setPrinterIpState] = useState(getPrinterIp());
  const [printing, setPrinting] = useState(false);
  const [printStatus, setPrintStatus] = useState(null); // { ok, text } | null
  // Quick print: one tap generates + prints a batch of N cups.
  const [quickN, setQuickN] = useState(null); // the N currently generating/printing
  // Optional NV-graphics logo key codes (print logo by reference, no raster).
  const initialLogo = getLogoKeys();
  const [logoKey1, setLogoKey1] = useState(initialLogo ? String(initialLogo.key1) : '');
  const [logoKey2, setLogoKey2] = useState(initialLogo ? String(initialLogo.key2) : '');

  /* P-21 — batch ops state. expiryId picks how long the new batch
   * stays valid; recent / loading / revokingId drive the recent-batches
   * panel below the receipt preview. */
  const [expiryId, setExpiryId] = useState('24h');
  const [recent, setRecent] = useState([]);
  const [recentLoading, setRecentLoading] = useState(false);
  const [revokingId, setRevokingId] = useState(null); // batch_id being acted on
  const [revokeModal, setRevokeModal] = useState(null); // { batch_id } | null
  const [batchPage, setBatchPage] = useState(0); // Recent-batches pagination

  /* Pull recent batches on mount and whenever a new one is generated /
   * revoked / unrevoked, so the recent list stays in sync without a
   * manual refresh. */
  async function refreshRecent() {
    setRecentLoading(true);
    try { setRecent(await listCupBatches()); }
    catch (e) { console.error('listCupBatches:', e); }
    finally { setRecentLoading(false); }
  }
  useEffect(() => { refreshRecent(); }, []);
  // Re-pull batches when the admin switches org.
  useEffect(() => { refreshRecent(); /* eslint-disable-next-line */ }, [activeOrg?.id]);

  // Whenever a new batch lands, redraw the QR onto the canvas.
  useEffect(() => {
    if (!batch?.url || !qrCanvasRef.current) return;
    QRCode.toCanvas(qrCanvasRef.current, batch.url, {
      width: 200,
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#0F0F0F', light: '#FFFFFF' },
    }).catch(err => console.error('QR draw failed:', err));
  }, [batch]);

  async function handleGenerate() {
    if (count < 1 || count > 50) {
      setError('Count must be between 1 and 50.');
      return;
    }
    setError(null);
    setGenerating(true);
    try {
      const res = await generateCups(count);
      // Use the batch_id form — keeps the QR module density constant
      // regardless of how many cups are in the batch. (Direct UUID lists
      // worked up to ~30 cups before QRs got unreadable.)
      // Multi-org: prefix with the active org's slug so a scan opens
      // the right brand's user app (e.g. /coffeeshop/?batch=…).
      // Use the slug the SERVER actually minted the cups under (res.slug) —
      // it's authoritative and immune to a stale/unloaded client org context.
      // Fall back to the client's active org slug only if the server didn't
      // return one (older edge deployment).
      const orgSlug = res.slug || activeOrg?.slug || '';
      const slugPath = orgSlug ? `${orgSlug}/` : '';
      // Problem-2 guard: a non-default org MUST contribute its slug, or the
      // phone-camera scan would open the root (default org) page instead of
      // this brand's page. The cups are still org-stamped server-side (so
      // cross-org "add more cups" works), but the landing page is driven by
      // the slug in the URL.
      if (!orgSlug) {
        console.warn(
          `[AdminCupQr] Batch ${res.batch_id} has no org slug ` +
          `(server org_id=${res.org_id ?? 'none'}, active=${activeOrg?.slug ?? 'none'}) — ` +
          `its QR will open the default org page.`
        );
      }
      const url = `${PROD_URL}${slugPath}?batch=${res.batch_id}`;
      // P-21: optional expiry. Compute from the picked preset and set
      // the column on every cup in the new batch in one round trip.
      // Done after the batch insert so we don't wedge generation if the
      // expiry update fails.
      const preset = EXPIRY_PRESETS.find(p => p.id === expiryId);
      let expiresAt = null;
      if (preset?.ms) {
        expiresAt = new Date(Date.now() + preset.ms).toISOString();
        try { await setBatchExpiry(res.batch_id, expiresAt); }
        catch (e) { console.error('setBatchExpiry failed (continuing):', e); }
      }
      setBatch({
        batch_id: res.batch_id,
        cup_ids: res.cup_ids,
        url,
        generatedAt: new Date(),
        expires_at: expiresAt,
      });
      logAction({
        action: 'cup_batch.generate',
        targetType: 'cup_batch',
        targetId: res.batch_id,
        metadata: { count: res.count, expires_at: expiresAt, restaurant },
      });
      refreshRecent();
    } catch (err) {
      console.error('generateCups failed:', err);
      setError(err.message || 'Failed to generate cup QR. Check the edge function logs.');
    } finally {
      setGenerating(false);
    }
  }

  async function handleRevoke(batchId, reason) {
    setRevokingId(batchId);
    try {
      await revokeBatch(batchId, reason);
      logAction({
        action: 'cup_batch.revoke',
        targetType: 'cup_batch',
        targetId: batchId,
        metadata: { reason },
      });
      await refreshRecent();
    } catch (e) {
      alert('Revoke failed: ' + e.message);
    } finally {
      setRevokingId(null);
    }
  }

  async function handleUnrevoke(batchId) {
    setRevokingId(batchId);
    try {
      await unrevokeBatch(batchId);
      logAction({
        action: 'cup_batch.unrevoke',
        targetType: 'cup_batch',
        targetId: batchId,
      });
      await refreshRecent();
    } catch (e) {
      alert('Un-revoke failed: ' + e.message);
    } finally {
      setRevokingId(null);
    }
  }

  function handlePrint() {
    // Browser print fallback (Save as PDF / any OS printer).
    document.body.classList.add('cupqr-printing');
    window.print();
    // remove on next tick — Safari fires afterprint before print finishes
    setTimeout(() => document.body.classList.remove('cupqr-printing'), 1000);
  }

  /* Print to the Epson TM-m30III over Ethernet via ePOS-Print. Sends the
   * receipt (with a native QR of the batch URL) straight to the printer. */
  async function handleEposPrint() {
    if (!batch) return;
    setPrinting(true);
    setPrintStatus(null);
    try {
      await printCupReceipt({
        url: batch.url,
        restaurant,
        generatedAt: batch.generatedAt,
        totalAmount: refundAmount,
        sessionId,
        // Real minted count (not the form's `count`) — this is exactly what
        // the QR will credit on scan, so the printed number can't disagree
        // with reality and the two receipts are never confused.
        cups: batch.cup_ids?.length ?? count,
      }, printerIp);
      setPrintStatus({ ok: true, text: `Sent to printer at ${printerIp} ✓` });
    } catch (err) {
      console.error('ePOS print failed:', err);
      setPrintStatus({ ok: false, text: err.message || 'Print failed.' });
    } finally {
      setPrinting(false);
    }
  }

  /* Quick print: mint a fresh batch of `n` cups and send it straight to the
   * Epson printer in one tap. Mirrors handleGenerate + handleEposPrint but
   * uses the freshly minted batch directly (no waiting on async state). */
  async function handleQuickPrint(n) {
    if (quickN !== null) return;
    setQuickN(n);
    setError(null);
    setPrintStatus(null);
    // A quick-print batch only "counts" if it actually prints. We mint it
    // first (the QR codes have to exist before we can print them), then print,
    // and only record it (latest-batch card, audit log, recent list) once the
    // printer confirms. If printing fails, we roll the batch back with
    // deleteCupBatches so it never lands in the records.
    let pendingBatchId = null;
    try {
      const res = await generateCups(n);
      pendingBatchId = res.batch_id;
      const orgSlug = res.slug || activeOrg?.slug || '';
      const slugPath = orgSlug ? `${orgSlug}/` : '';
      const url = `${PROD_URL}${slugPath}?batch=${res.batch_id}`;
      const preset = EXPIRY_PRESETS.find(p => p.id === expiryId);
      let expiresAt = null;
      if (preset?.ms) {
        expiresAt = new Date(Date.now() + preset.ms).toISOString();
        try { await setBatchExpiry(res.batch_id, expiresAt); }
        catch (e) { console.error('setBatchExpiry failed (continuing):', e); }
      }
      const newBatch = { batch_id: res.batch_id, cup_ids: res.cup_ids, url, generatedAt: new Date(), expires_at: expiresAt };

      // Print BEFORE recording. This is what throws if the printer is
      // unreachable, sending us to the catch block where we roll back.
      await printCupReceipt({
        url,
        restaurant,
        generatedAt: newBatch.generatedAt,
        totalAmount: (n * 1.0).toFixed(2),
        sessionId: res.batch_id.slice(0, 8).toUpperCase(),
        cups: res.cup_ids?.length ?? n,
      }, printerIp);

      // Printed OK → commit it to the records.
      pendingBatchId = null;
      setBatch(newBatch);
      setCount(n);
      setPrintStatus({ ok: true, text: `Quick-printed ${n} cup${n !== 1 ? 's' : ''} to ${printerIp} ✓` });
      logAction({
        action: 'cup_batch.generate',
        targetType: 'cup_batch',
        targetId: res.batch_id,
        metadata: { count: res.count, expires_at: expiresAt, restaurant, quick_print: true },
      });
      refreshRecent();
    } catch (err) {
      console.error('quick print failed:', err);
      // Roll back the minted-but-unprinted batch so it is never recorded.
      if (pendingBatchId) {
        try { await deleteCupBatches([pendingBatchId]); }
        catch (rbErr) { console.error('rollback (deleteCupBatches) failed:', rbErr); }
      }
      const msg = err.message || 'Quick print failed.';
      setError(msg);
      setPrintStatus({ ok: false, text: msg });
    } finally {
      setQuickN(null);
    }
  }

  /* Helper that grabs the receipt DOM at its NATURAL size (no fit-to-page
   * scaling), so the exported file stays narrow like a real thermal
   * receipt instead of stretching to A4 width. Pixel ratio of 2 gives
   * crisp output without a huge filesize. */
  async function captureReceipt(format) {
    const node = receiptRef.current;
    if (!node) return null;
    const rect = node.getBoundingClientRect();
    const opts = {
      pixelRatio: 2,
      backgroundColor: '#FFFFFF',
      width: rect.width,
      height: rect.height,
      cacheBust: true,
    };
    return format === 'jpg' ? toJpeg(node, { ...opts, quality: 0.92 }) : toPng(node, opts);
  }

  async function handleDownloadJpg() {
    if (!batch) return;
    setExporting('jpg');
    try {
      const dataUrl = await captureReceipt('jpg');
      if (!dataUrl) return;
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `packperks-cup-qr-${batch.batch_id.slice(0, 8)}.jpg`;
      a.click();
    } catch (err) {
      console.error('JPG export failed:', err);
      setError('Could not export JPG. Try again.');
    } finally {
      setExporting(null);
    }
  }

  async function handleDownloadPdf() {
    if (!batch) return;
    setExporting('pdf');
    try {
      const dataUrl = await captureReceipt('png');
      if (!dataUrl) return;
      // Build a narrow PDF page that matches the receipt's aspect ratio —
      // 80mm wide is standard thermal-printer paper. Height scales to
      // preserve the captured image's proportions.
      const node = receiptRef.current;
      const rect = node.getBoundingClientRect();
      const aspect = rect.height / rect.width;
      const widthMm = 80;
      const heightMm = widthMm * aspect;
      const pdf = new jsPDF({
        unit: 'mm',
        format: [widthMm, heightMm],
        orientation: heightMm > widthMm ? 'portrait' : 'landscape',
      });
      pdf.addImage(dataUrl, 'PNG', 0, 0, widthMm, heightMm);
      pdf.save(`packperks-cup-qr-${batch.batch_id.slice(0, 8)}.pdf`);
    } catch (err) {
      console.error('PDF export failed:', err);
      setError('Could not export PDF. Try again.');
    } finally {
      setExporting(null);
    }
  }

  function copyUrl() {
    if (!batch?.url) return;
    navigator.clipboard?.writeText(batch.url).catch(() => {});
  }

  const refundAmount = (count * 1.0).toFixed(2);
  const sessionId = batch?.batch_id?.slice(0, 8).toUpperCase() ?? '———';
  const generatedAt = batch?.generatedAt ?? new Date();

  // Multi-select + bulk delete for the Recent batches table. Selection is
  // keyed on the FULL list, so the header checkbox selects every batch across
  // all pages (and per-row selections persist while paging).
  const batchSel = useBulkSelection(recent, (b) => b.batch_id);

  // Client-side pagination of the full batch list.
  const BATCH_PAGE_SIZE = 12;
  const batchPageCount = Math.max(1, Math.ceil(recent.length / BATCH_PAGE_SIZE));
  const safeBatchPage = Math.min(batchPage, batchPageCount - 1);
  const pageBatches = recent.slice(
    safeBatchPage * BATCH_PAGE_SIZE,
    safeBatchPage * BATCH_PAGE_SIZE + BATCH_PAGE_SIZE,
  );

  async function handleDeleteBatches() {
    const ids = batchSel.selectedIds;
    await deleteCupBatches(ids);
    logAction({ action: 'cup_batch.delete', targetType: 'cup_batch', targetId: ids.join(','), metadata: { count: ids.length } });
    // If the currently-previewed batch was deleted, clear the preview.
    if (batch && ids.includes(batch.batch_id)) setBatch(null);
    batchSel.clear();
    await refreshRecent();
  }

  return (
    <div className="admin-cup-qr">
      <div className="acq-header">
        <div className="acq-header__text">
          <h1 className="acq-header__title">Cup QR Codes</h1>
          <p className="acq-header__sub">
            Generate the QR receipt printed by the smart bin. Each QR mints fresh
            single-use cup tokens — scan them in the user app to redeem.
          </p>
        </div>
        <div className="acq-header__actions">
          <button
            className="acq-btn acq-btn--ghost"
            onClick={handleDownloadJpg}
            disabled={!batch || !!exporting}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2"/>
              <circle cx="8.5" cy="8.5" r="1.5"/>
              <polyline points="21 15 16 10 5 21"/>
            </svg>
            {exporting === 'jpg' ? 'Saving…' : 'JPG'}
          </button>
          <button
            className="acq-btn acq-btn--ghost"
            onClick={handleDownloadPdf}
            disabled={!batch || !!exporting}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
            </svg>
            {exporting === 'pdf' ? 'Saving…' : 'PDF'}
          </button>
          <button
            className="acq-btn acq-btn--ghost"
            onClick={handlePrint}
            disabled={!batch}
            title="Open the browser print dialog (Save as PDF / any OS printer)"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 9 6 2 18 2 18 9"/>
              <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/>
              <rect x="6" y="14" width="12" height="8"/>
            </svg>
            Browser print
          </button>
        </div>
      </div>

      {printStatus && (
        <div className={`acq-print-status ${printStatus.ok ? 'acq-print-status--ok' : 'acq-print-status--err'}`}>
          {printStatus.text}
        </div>
      )}

      {/* ── Left: generation controls ────────────────────────────────── */}
      <div className="acq-layout">
        <div className="acq-controls">
          {/* Quick print — one tap mints a fresh batch of N cups and prints it. */}
          <div className="acq-card acq-quick">
            <h2 className="acq-card__title">Quick print</h2>
            <p className="acq-field__hint">
              One tap mints a fresh batch and prints it to {printerIp}.
            </p>
            <div className="acq-quick__row">
              {[1, 2, 3, 4, 5].map(n => (
                <button
                  key={n}
                  type="button"
                  className="acq-quick__btn"
                  onClick={() => handleQuickPrint(n)}
                  disabled={quickN !== null}
                  aria-label={`Generate and print ${n} cup${n !== 1 ? 's' : ''}`}
                  title={`Generate + print ${n} cup${n !== 1 ? 's' : ''}`}
                >
                  {quickN === n ? <span className="acq-quick__spin" /> : n}
                </button>
              ))}
            </div>
          </div>

          <div className="acq-card">
            <h2 className="acq-card__title">New batch</h2>

            {/* NOT a <label>: a label forwards clicks anywhere in its area to
                its first labelable descendant (the − button), so clicking the
                title, the hint, or empty space would silently decrement. */}
            <div className="acq-field">
              <span className="acq-field__label">How many cups returned?</span>
              <div className="acq-stepper">
                <button
                  type="button"
                  className="acq-stepper__btn"
                  onClick={() => setCount(c => Math.max(1, c - 1))}
                  disabled={count <= 1}
                >−</button>
                <input
                  type="number"
                  className="acq-stepper__input"
                  min={1}
                  max={50}
                  value={count}
                  onChange={e => {
                    const v = parseInt(e.target.value, 10);
                    if (!isNaN(v)) setCount(Math.max(1, Math.min(50, v)));
                  }}
                />
                <button
                  type="button"
                  className="acq-stepper__btn"
                  onClick={() => setCount(c => Math.min(50, c + 1))}
                  disabled={count >= 50}
                >+</button>
              </div>
              <span className="acq-field__hint">1 to 50 cups per QR.</span>
            </div>

            <label className="acq-field">
              <span className="acq-field__label">Restaurant / location</span>
              <input
                type="text"
                className="acq-input"
                value={restaurant}
                onChange={e => setRestaurant(e.target.value)}
                placeholder="Burger King — Amsterdam Damrak"
              />
              <span className="acq-field__hint">Shown on the printed receipt.</span>
            </label>

            <label className="acq-field">
              <span className="acq-field__label">Expiry</span>
              <select
                className="acq-input"
                value={expiryId}
                onChange={e => setExpiryId(e.target.value)}
              >
                {EXPIRY_PRESETS.map(p => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </select>
              <span className="acq-field__hint">After expiry the QR can't be claimed. Default: never expires.</span>
            </label>

            <label className="acq-field">
              <span className="acq-field__label">Printer IP (Epson TM-m30III)</span>
              <input
                type="text"
                className="acq-input"
                value={printerIp}
                onChange={e => setPrinterIpState(e.target.value)}
                onBlur={e => setPrinterIp(e.target.value)}
                placeholder="192.168.192.168"
              />
              <span className="acq-field__hint">Epson direct-Ethernet default — your computer must be on the same subnet.</span>
            </label>

            {/* div, not label: two inputs inside one label would forward
                clicks on the title/hint to whichever comes first. */}
            <div className="acq-field">
              <span className="acq-field__label">Logo NV key codes (optional)</span>
              <div className="acq-row" style={{ display: 'flex', gap: 8 }}>
                <input
                  type="number"
                  className="acq-input"
                  value={logoKey1}
                  onChange={e => { setLogoKey1(e.target.value); setLogoKeys(e.target.value, logoKey2); }}
                  placeholder="key 1 (e.g. 80)"
                />
                <input
                  type="number"
                  className="acq-input"
                  value={logoKey2}
                  onChange={e => { setLogoKey2(e.target.value); setLogoKeys(logoKey1, e.target.value); }}
                  placeholder="key 2 (e.g. 80)"
                />
              </div>
              <span className="acq-field__hint">Blank = text wordmark. Or enter the printer's NV-graphics key codes.</span>
            </div>

            <div className="acq-generate-row">
              <button
                className="acq-btn acq-btn--primary"
                onClick={handleGenerate}
                disabled={generating}
              >
                {generating ? 'Generating…' : `Generate for ${count} cup${count !== 1 ? 's' : ''}`}
              </button>
              <button
                className="acq-btn acq-btn--print"
                onClick={handleEposPrint}
                disabled={!batch || printing}
                title={`Print to the Epson TM-m30III at ${printerIp} over Ethernet (ESC/POS via ePOS-Print)`}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="6 9 6 2 18 2 18 9"/>
                  <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/>
                  <rect x="6" y="14" width="12" height="8"/>
                </svg>
                {printing ? 'Printing…' : 'Print receipt'}
              </button>
            </div>

            {error && <p className="acq-error">{error}</p>}
          </div>

          {batch && (
            <div className="acq-card acq-card--meta">
              <h2 className="acq-card__title">Latest batch</h2>
              <div className="acq-meta-row"><span>Batch ID</span><strong className="acq-mono">{batch.batch_id}</strong></div>
              <div className="acq-meta-row"><span>Cup count</span><strong>{batch.cup_ids.length}</strong></div>
              <div className="acq-meta-row acq-meta-row--col">
                <span>Cup UUIDs</span>
                <details className="acq-uuids">
                  <summary>Show {batch.cup_ids.length} UUIDs</summary>
                  <ul>{batch.cup_ids.map(id => <li key={id}>{id}</li>)}</ul>
                </details>
              </div>
              <div className="acq-meta-row acq-meta-row--col">
                <span>QR URL</span>
                <code className="acq-url">{batch.url}</code>
                <button className="acq-btn acq-btn--ghost" onClick={copyUrl}>Copy URL</button>
              </div>
            </div>
          )}
        </div>

        {/* ── Right: live receipt preview ───────────────────────────── */}
        <div className="acq-preview-wrap">
          <div className="acq-receipt" id="cupqr-receipt-print-target" ref={receiptRef}>
            <header className="acq-receipt__brand">
              <img src={packbackLogo} alt="PackBack" />
            </header>

            <h2 className="acq-receipt__title">GET YOUR REFUND<br/>AND REWARDS</h2>
            <p className="acq-receipt__lede">
              Use <strong>PackPerks</strong> to access your deposit, track returns,
              and unlock extra rewards.
            </p>

            <ul className="acq-receipt__features">
              <li>
                <span className="acq-receipt__feature-icon" aria-hidden>💸</span>
                <span>Access your deposit</span>
              </li>
              <li>
                <span className="acq-receipt__feature-icon" aria-hidden>🎁</span>
                <span>Earn more from repeat returns</span>
              </li>
              <li>
                <span className="acq-receipt__feature-icon" aria-hidden>🌍</span>
                <span>Keep track of your progress</span>
              </li>
            </ul>

            <div className="acq-receipt__cupcount">
              <span className="acq-receipt__cupcount-num">{batch?.cup_ids?.length ?? count}</span>
              <span className="acq-receipt__cupcount-label">{(batch?.cup_ids?.length ?? count) === 1 ? 'CUP' : 'CUPS'}</span>
            </div>

            <h3 className="acq-receipt__cta">Scan to start with PackPerks</h3>

            <div className="acq-receipt__qr">
              {batch ? (
                <canvas ref={qrCanvasRef} />
              ) : (
                <div className="acq-receipt__qr-placeholder">
                  Generate a batch to see the QR
                </div>
              )}
            </div>

            <p className="acq-receipt__assure">
              <strong>No app</strong> and <strong>no registration</strong> needed.
              <br />Fast and secure.
            </p>

            <p className="acq-receipt__note">
              You can still directly refund in the same app by clicking on the
              user icon top-right.
            </p>

            <div className="acq-receipt__dashed" />

            <div className="acq-receipt__footer">
              <div className="acq-receipt__footer-row">
                <span>Time:</span>
                <span>{generatedAt.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
              </div>
              <div className="acq-receipt__footer-row">
                <span>Restaurant:</span>
                <span>{restaurant || '—'}</span>
              </div>
              <div className="acq-receipt__footer-row">
                <span>Cups:</span>
                <span>{batch?.cup_ids?.length ?? count}</span>
              </div>
              <div className="acq-receipt__footer-row">
                <span>Total Amount:</span>
                <span>€{refundAmount}</span>
              </div>
              <div className="acq-receipt__footer-row">
                <span>Session ID:</span>
                <span className="acq-mono">{sessionId}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* P-21 — recent batches with revoke / un-revoke. Lets admins
       *  kill a misprinted batch or restore one that was revoked by
       *  accident. Each row shows usage (activated / total), the time
       *  generated, the expiry (if any), and the current status. */}
      <section className="acq-batches">
        <header className="acq-batches__head">
          <h2 className="acq-batches__title">Recent batches</h2>
          <p className="acq-batches__sub">
            Mint new QR receipts above. Use this list to revoke a misprinted batch — the
            customer will see a "QR cancelled" message if they try to scan it.
          </p>
        </header>
        {recentLoading ? (
          <div className="acq-batches__loading">Loading batches…</div>
        ) : recent.length === 0 ? (
          <div className="acq-batches__empty">No batches generated yet.</div>
        ) : (
          <table className="acq-batches__table">
            <thead>
              <tr>
                <th className="bulk-check-cell">
                  <input
                    type="checkbox"
                    checked={batchSel.allSelected}
                    ref={el => { if (el) el.indeterminate = batchSel.someSelected && !batchSel.allSelected; }}
                    onChange={batchSel.toggleAll}
                    aria-label="Select all batches across all pages"
                    title="Select all batches (all pages)"
                  />
                </th>
                <th>Batch</th>
                <th>Generated</th>
                <th>Used</th>
                <th>Expiry</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {pageBatches.map(b => {
                const exp = b.expires_at ? new Date(b.expires_at) : null;
                const expired = exp ? exp.getTime() <= Date.now() : false;
                const isRevoked = !!b.revoked_at;
                const fullyUsed = b.activated >= b.total;
                let statusLabel = 'Active';
                let statusTone = 'active';
                if (isRevoked)      { statusLabel = 'Revoked'; statusTone = 'revoked'; }
                else if (expired)   { statusLabel = 'Expired'; statusTone = 'expired'; }
                else if (fullyUsed) { statusLabel = 'Fully claimed'; statusTone = 'used'; }
                const busy = revokingId === b.batch_id;
                return (
                  <tr key={b.batch_id} className={batchSel.isSelected(b.batch_id) ? 'acq-batches__row--selected' : ''}>
                    <td className="bulk-check-cell">
                      <input
                        type="checkbox"
                        checked={batchSel.isSelected(b.batch_id)}
                        onChange={() => batchSel.toggle(b.batch_id)}
                        aria-label="Select batch"
                      />
                    </td>
                    <td>
                      <span className="acq-mono">{b.batch_id.slice(0, 8)}…</span>
                    </td>
                    <td className="acq-batches__muted">
                      {new Date(b.created_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td>{b.activated} / {b.total}</td>
                    <td className="acq-batches__muted">
                      {exp
                        ? exp.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
                        : <span style={{ color: '#B8B2A8' }}>Never</span>}
                    </td>
                    <td>
                      <span className={`acq-batch-status acq-batch-status--${statusTone}`}>
                        {statusLabel}
                        {b.revoked_reason && <span className="acq-batch-status__why" title={b.revoked_reason}> · why</span>}
                      </span>
                    </td>
                    <td className="acq-batches__actions">
                      {isRevoked ? (
                        <button
                          className="acq-batches__btn acq-batches__btn--ghost"
                          onClick={() => handleUnrevoke(b.batch_id)}
                          disabled={busy}
                          title="Re-enable this batch. Customers will be able to claim it again."
                        >
                          {busy ? 'Restoring…' : 'Un-revoke'}
                        </button>
                      ) : (
                        <button
                          className="acq-batches__btn acq-batches__btn--danger"
                          onClick={() => setRevokeModal({ batch_id: b.batch_id })}
                          disabled={busy || fullyUsed}
                          title={fullyUsed ? 'All cups in this batch have already been claimed — nothing to revoke.' : 'Mark this batch as cancelled. Any pending scans of it will fail.'}
                        >
                          Revoke
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {recent.length > BATCH_PAGE_SIZE && (
          <div className="acq-pagination">
            <button
              className="acq-btn acq-btn--ghost"
              onClick={() => setBatchPage(p => Math.max(0, p - 1))}
              disabled={safeBatchPage <= 0}
            >
              ← Prev
            </button>
            <span className="acq-pagination__info">
              Page {safeBatchPage + 1} of {batchPageCount} · {recent.length} batches
            </span>
            <button
              className="acq-btn acq-btn--ghost"
              onClick={() => setBatchPage(p => Math.min(batchPageCount - 1, p + 1))}
              disabled={safeBatchPage >= batchPageCount - 1}
            >
              Next →
            </button>
          </div>
        )}
      </section>

      <BulkDeleteBar
        count={batchSel.count}
        noun="batches"
        onClear={batchSel.clear}
        onDelete={handleDeleteBatches}
      />

      {revokeModal && (
        <RevokeBatchModal
          batchId={revokeModal.batch_id}
          onCancel={() => setRevokeModal(null)}
          onConfirm={async (reason) => {
            const id = revokeModal.batch_id;
            setRevokeModal(null);
            await handleRevoke(id, reason);
          }}
        />
      )}

      <QuickLinks currentPage="cupqr" onNavigate={onNavigate} />
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────
 * RevokeBatchModal — confirm + required-reason for batch revocation.
 *
 * Revoking a batch means every still-pending cup in it dies. We force
 * the admin to type a reason both for the audit log and to slow them
 * down on a high-stakes click — same pattern as the claim-decision and
 * maintenance-toggle confirms elsewhere in the dashboard. */
function RevokeBatchModal({ batchId, onCancel, onConfirm }) {
  const [reason, setReason] = useState('');
  const canSubmit = reason.trim().length >= 3;

  return (
    <div className="admin-publish-overlay" onClick={onCancel}>
      <div className="admin-publish-modal" onClick={e => e.stopPropagation()}>
        <div className="admin-publish-modal__header">
          <div
            className="admin-publish-modal__icon"
            style={{ background: 'rgba(220,38,38,0.10)', color: '#DC2626' }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
            </svg>
          </div>
          <div>
            <h3 className="admin-publish-modal__title">Revoke this batch?</h3>
            <p className="admin-publish-modal__sub">
              Customers scanning this QR will see a "QR cancelled" message and won't get any cups.
              Already-claimed cups stay in their balance — revocation only affects pending claims.
            </p>
          </div>
        </div>

        <label className="admin-publish-modal__label">Reason (required)</label>
        <input
          className="admin-publish-modal__input"
          placeholder="e.g. Misprinted batch, reprinted as XYZ"
          value={reason}
          onChange={e => setReason(e.target.value)}
          autoFocus
        />

        <div className="admin-publish-modal__actions">
          <button className="admin-publish-modal__cancel" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="admin-publish-modal__confirm"
            onClick={() => onConfirm(reason.trim())}
            disabled={!canSubmit}
            style={{ background: '#DC2626' }}
            title={!canSubmit ? 'Please describe why you\'re revoking this batch' : ''}
          >
            Revoke batch →
          </button>
        </div>
        <p style={{ marginTop: 8, fontSize: 11, color: '#9E9A93' }}>
          Batch ID: <span className="acq-mono">{batchId}</span>
        </p>
      </div>
    </div>
  );
}
