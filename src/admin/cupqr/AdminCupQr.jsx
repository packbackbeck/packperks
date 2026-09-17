import { useEffect, useRef, useState } from 'react';
import {
  AlertCircle, Ban, CheckCircle2, ChevronLeft, ChevronRight, Copy, FileDown, History, ImageDown,
  Minus, Plus, Printer, QrCode, RotateCcw, Settings2,
} from 'lucide-react';
import QRCode from 'qrcode';
import { toJpeg, toPng } from 'html-to-image';
import { jsPDF } from 'jspdf';
import { generateCups, setBatchExpiry, revokeBatch, unrevokeBatch, listCupBatches, deleteCupBatches } from '../lib/adminApi';
import { printCupReceipt, getPrinterIp, setPrinterIp, getLogoKeys, setLogoKeys } from '../lib/eposPrint';
import { useOrg } from '../context/OrgContext';
import { getReceiptCopy } from './receiptCopy';
import { logAction } from '../auth/actionLog';
import packbackLogo from '../../assets/images/packback-logo.png';
import { APP_URL } from '../../lib/appUrl';
import { useBulkSelection } from '../shared/useBulkSelection';
import BulkDeleteBar from '../shared/BulkDeleteBar';
import { Badge, Button, Card, CardBody, CardFoot, CardHeader, EmptyState, Field, Modal } from '../ui';
import './AdminCupQr.css';
import { useAdminMoney } from '../lib/adminMoney';
import { effectiveRates } from '../../lib/rates';

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
// Canonical customer domain baked into the printed QR (VITE_APP_URL, default
// .network). Redemption ignores the QR's host, so this only affects native
// phone-camera scans — keep the old .app domain live for existing prints.
const PROD_URL = APP_URL;

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
export default function AdminCupQr() {
  const { money } = useAdminMoney();
  const { activeOrg, activeOrgMode, activeOrgSettings } = useOrg();
  // Tikkie-only orgs print a receipt that pays out on scan — no app, no
  // rewards — so the wording and the payout figure both change.
  const isTikkieOnly = activeOrgMode === 'tikkie_only';
  const receiptVariant = isTikkieOnly ? 'tikkie' : 'standard';
  const copy = getReceiptCopy(receiptVariant);
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
  // Re-open the QR for any past batch: the receipt can be reprinted, and a
  // bin-requested session can be checked without hunting through the bin.
  const [qrModal, setQrModal] = useState(null); // { batch_id, url, source }
  const modalQrRef = useRef(null);

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

  // Draw the re-opened batch's QR whenever the modal opens.
  useEffect(() => {
    if (!qrModal?.url || !modalQrRef.current) return;
    QRCode.toCanvas(modalQrRef.current, qrModal.url, {
      width: 220,
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#0F0F0F', light: '#FFFFFF' },
    }).catch(err => console.error('QR draw failed:', err));
  }, [qrModal]);

  // The customer URL for any batch, past or present — the same shape the
  // generator prints and the bin encodes (print-first: batch id = session id).
  const urlForBatch = (batchId) => {
    const slugPath = activeOrg?.slug ? `${activeOrg.slug}/` : '';
    return `${PROD_URL}${slugPath}?batch=${batchId}`;
  };

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
        variant: receiptVariant,
        // Real minted count (not the form's `count`) — this is exactly what
        // the QR will credit on scan, so the printed number can't disagree
        // with reality and the two receipts are never confused.
        cups: batch.cup_ids?.length ?? count,
      }, printerIp);
      setPrintStatus({ ok: true, text: `Sent to the printer at ${printerIp}.` });
    } catch (err) {
      console.error('ePOS print failed:', err);
      setPrintStatus({ ok: false, text: err.message || 'Print failed.' });
    } finally {
      setPrinting(false);
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

  /* Per-cup payout, resolved the way bin-tikkie resolves it (lib/rates.js):
   * the published rate, else the mode's default. A fixed fallback of 1 here
   * used to print €1.00 on receipts for venues that pay €0.10. */
  const ratePerCup = effectiveRates(activeOrgSettings || {}).refund;
  const refundAmount = (count * ratePerCup).toFixed(2);
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

  const shownCups = batch?.cup_ids?.length ?? count;

  return (
    <div className="admin-cup-qr acq">
      {printStatus && (
        <div
          className={`acq-status ${printStatus.ok ? 'acq-status--ok' : 'acq-status--err'}`}
          role={printStatus.ok ? 'status' : 'alert'}
        >
          {printStatus.ok ? <CheckCircle2 size={16} aria-hidden="true" /> : <AlertCircle size={16} aria-hidden="true" />}
          <span>{printStatus.text}</span>
        </div>
      )}

      <div className="acq-layout">
        {/* ── Left: generation controls ─────────────────────────────── */}
        <div className="acq-controls">
          <Card>
            <CardHeader
              title="New batch"
              icon={QrCode}
              subtitle="Mint the cup codes, then print the receipt or save it as an image."
            />
            <CardBody>
              <div className="acq-fields">
                {/* NOT a <label>: a label forwards clicks anywhere in its area to
                    its first labelable descendant (the − button), so clicking the
                    title, the hint, or empty space would silently decrement. */}
                <div className="ui-field">
                  <span className="ui-field__label" id="acq-count-label">Cups returned</span>
                  <div className="acq-stepper" role="group" aria-labelledby="acq-count-label">
                    <button
                      type="button"
                      className="acq-stepper__btn"
                      onClick={() => setCount(c => Math.max(1, c - 1))}
                      disabled={count <= 1}
                      aria-label="One cup fewer"
                    >
                      <Minus size={15} aria-hidden="true" />
                    </button>
                    <input
                      type="number"
                      className="acq-stepper__input"
                      aria-labelledby="acq-count-label"
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
                      aria-label="One cup more"
                    >
                      <Plus size={15} aria-hidden="true" />
                    </button>
                  </div>
                  <span className="ui-field__hint">1 to 50 cups per QR code.</span>
                </div>

                <Field label="Expiry" htmlFor="acq-expiry" hint="After this the QR code can’t be claimed any more.">
                  <select
                    id="acq-expiry"
                    className="ui-select"
                    value={expiryId}
                    onChange={e => setExpiryId(e.target.value)}
                  >
                    {EXPIRY_PRESETS.map(p => (
                      <option key={p.id} value={p.id}>{p.label}</option>
                    ))}
                  </select>
                </Field>

                <div className="acq-fields__wide">
                  <Field label="Restaurant or location" htmlFor="acq-restaurant" hint="Printed on the receipt.">
                    <input
                      id="acq-restaurant"
                      type="text"
                      className="ui-input"
                      value={restaurant}
                      onChange={e => setRestaurant(e.target.value)}
                      placeholder="Burger King — Amsterdam Damrak"
                    />
                  </Field>
                </div>
              </div>

              {error && (
                <p className="acq-error" role="alert">
                  <AlertCircle size={14} aria-hidden="true" />
                  {error}
                </p>
              )}
            </CardBody>
            <div className="acq-actions">
              <Button
                variant="primary"
                icon={QrCode}
                onClick={handleGenerate}
                disabled={generating}
              >
                {generating ? 'Generating…' : `Generate for ${count} cup${count !== 1 ? 's' : ''}`}
              </Button>
              <Button
                icon={Printer}
                onClick={handleEposPrint}
                disabled={!batch || printing}
                title={`Print to the Epson TM-m30III at ${printerIp} over Ethernet (ESC/POS via ePOS-Print)`}
              >
                {printing ? 'Printing…' : 'Print receipt'}
              </Button>
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Receipt printer"
              icon={Settings2}
              subtitle="An Epson TM-m30III on this network. Your computer must be on the same subnet."
            />
            <CardBody>
              <div className="acq-fields">
                <Field label="Printer IP address" htmlFor="acq-printer-ip" hint="Epson’s direct-Ethernet default is 192.168.192.168.">
                  <input
                    id="acq-printer-ip"
                    type="text"
                    className="ui-input acq-mono-input"
                    value={printerIp}
                    onChange={e => setPrinterIpState(e.target.value)}
                    onBlur={e => setPrinterIp(e.target.value)}
                    placeholder="192.168.192.168"
                  />
                </Field>

                {/* div, not label: two inputs inside one label would forward
                    clicks on the title/hint to whichever comes first. */}
                <div className="ui-field">
                  <span className="ui-field__label" id="acq-logo-label">
                    Logo key codes <span className="acq-optional">optional</span>
                  </span>
                  <div className="acq-pair" role="group" aria-labelledby="acq-logo-label">
                    <input
                      type="number"
                      className="ui-input"
                      aria-label="Logo key 1"
                      value={logoKey1}
                      onChange={e => { setLogoKey1(e.target.value); setLogoKeys(e.target.value, logoKey2); }}
                      placeholder="Key 1, e.g. 80"
                    />
                    <input
                      type="number"
                      className="ui-input"
                      aria-label="Logo key 2"
                      value={logoKey2}
                      onChange={e => { setLogoKey2(e.target.value); setLogoKeys(logoKey1, e.target.value); }}
                      placeholder="Key 2, e.g. 80"
                    />
                  </div>
                  <span className="ui-field__hint">The logo stored on the printer. Leave blank to print the name as text.</span>
                </div>
              </div>
            </CardBody>
          </Card>

          {batch && (
            <Card>
              <CardHeader title="Latest batch" icon={History} />
              <CardBody>
                <dl className="acq-meta">
                  <div className="acq-meta__row">
                    <dt>Batch ID</dt>
                    <dd className="acq-mono">{batch.batch_id}</dd>
                  </div>
                  <div className="acq-meta__row">
                    <dt>Cups</dt>
                    <dd>{batch.cup_ids.length}</dd>
                  </div>
                  <div className="acq-meta__row acq-meta__row--col">
                    <dt>Cup codes</dt>
                    <dd>
                      <details className="acq-uuids">
                        <summary>Show {batch.cup_ids.length} code{batch.cup_ids.length === 1 ? '' : 's'}</summary>
                        <ul>{batch.cup_ids.map(id => <li key={id}>{id}</li>)}</ul>
                      </details>
                    </dd>
                  </div>
                  <div className="acq-meta__row acq-meta__row--col">
                    <dt>Link in the QR code</dt>
                    <dd className="acq-url-row">
                      <code className="acq-url">{batch.url}</code>
                      <Button size="sm" icon={Copy} onClick={copyUrl}>Copy link</Button>
                    </dd>
                  </div>
                </dl>
              </CardBody>
            </Card>
          )}
        </div>

        {/* ── Right: live receipt preview ───────────────────────────── */}
        <Card className="acq-preview-card">
          <CardHeader
            title="Receipt preview"
            subtitle={batch ? 'Exactly what prints and exports.' : 'Generate a batch to fill in the QR code.'}
            actions={(
              <>
                <Button size="sm" icon={ImageDown} onClick={handleDownloadJpg} disabled={!batch || !!exporting}>
                  {exporting === 'jpg' ? 'Saving…' : 'JPG'}
                </Button>
                <Button size="sm" icon={FileDown} onClick={handleDownloadPdf} disabled={!batch || !!exporting}>
                  {exporting === 'pdf' ? 'Saving…' : 'PDF'}
                </Button>
                <Button
                  size="sm"
                  icon={Printer}
                  onClick={handlePrint}
                  disabled={!batch}
                  title="Open the browser print dialog (Save as PDF / any OS printer)"
                >
                  Browser print
                </Button>
              </>
            )}
          />
          <div className="acq-preview-wrap">
          {/* The receipt itself: its look is the printed/exported artwork, so it
              keeps its own colours. */}
          <div className="acq-receipt" id="cupqr-receipt-print-target" ref={receiptRef}>
            <header className="acq-receipt__brand">
              <img src={packbackLogo} alt="PackBack" />
            </header>

            <h2 className="acq-receipt__title">
              {copy.titleLines.map((ln, i) => (
                <span key={ln}>{i > 0 && <br />}{ln}</span>
              ))}
            </h2>
            <p className="acq-receipt__lede">
              {copy.ledeJsx[0]}<strong>{copy.ledeJsx[1]}</strong>{copy.ledeJsx[2]}
            </p>

            <ul className="acq-receipt__features">
              {copy.features.map(f => (
                <li key={f.lines.join(' ')}>
                  <span className="acq-receipt__feature-icon" aria-hidden>{f.emoji}</span>
                  <span>{f.lines.join(' ')}</span>
                </li>
              ))}
            </ul>

            <div className="acq-receipt__cupcount">
              <span className="acq-receipt__cupcount-num">{shownCups}</span>
              <span className="acq-receipt__cupcount-label">{shownCups === 1 ? 'CUP' : 'CUPS'}</span>
            </div>

            <h3 className="acq-receipt__cta">{copy.cta}</h3>

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

            {copy.note && <p className="acq-receipt__note">{copy.note}</p>}

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
                <span>{shownCups}</span>
              </div>
              <div className="acq-receipt__footer-row">
                <span>Total Amount:</span>
                <span>{money(Number(refundAmount) || 0)}</span>
              </div>
              <div className="acq-receipt__footer-row">
                <span>Session ID:</span>
                <span className="acq-mono">{sessionId}</span>
              </div>
            </div>
          </div>
          </div>
        </Card>
      </div>

      {/* P-21 — recent batches with revoke / un-revoke. Lets admins
       *  kill a misprinted batch or restore one that was revoked by
       *  accident. Each row shows usage (activated / total), the time
       *  generated, the expiry (if any), and the current status. */}
      <Card className="acq-batches">
        <CardHeader
          title="Recent batches"
          icon={History}
          ruled
          subtitle="Revoke a misprinted batch here: a customer who scans it sees a “QR cancelled” message."
          actions={recent.length > 0 && <Badge tone="neutral">{recent.length} batch{recent.length === 1 ? '' : 'es'}</Badge>}
        />
        <CardBody flush>
          {recentLoading && recent.length === 0 ? (
            <p className="acq-batches__loading">Loading batches…</p>
          ) : recent.length === 0 ? (
            <EmptyState icon={QrCode} title="No batches yet">
              Batches you generate, and the ones the smart bin asks for, show up here.
            </EmptyState>
          ) : (
            <div className="acq-table-wrap">
              <table className="ui-table acq-table">
                <thead>
                  <tr>
                    <th className="bulk-check-cell acq-check">
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
                    <th>Source</th>
                    <th>Generated</th>
                    <th className="ui-num">Claimed</th>
                    <th>Expires</th>
                    <th>Status</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {pageBatches.map(b => {
                    const exp = b.expires_at ? new Date(b.expires_at) : null;
                    const expired = exp ? exp.getTime() <= Date.now() : false;
                    const isRevoked = !!b.revoked_at;
                    const fullyUsed = b.activated >= b.total;
                    let statusLabel = 'Active';
                    let statusTone = 'success';
                    if (isRevoked)      { statusLabel = 'Revoked'; statusTone = 'danger'; }
                    else if (expired)   { statusLabel = 'Expired'; statusTone = 'warning'; }
                    else if (fullyUsed) { statusLabel = 'Fully claimed'; statusTone = 'neutral'; }
                    const busy = revokingId === b.batch_id;
                    const selected = batchSel.isSelected(b.batch_id);
                    return (
                      <tr key={b.batch_id} className={selected ? 'acq-row--selected' : ''}>
                        <td className="bulk-check-cell acq-check">
                          <input
                            type="checkbox"
                            checked={selected}
                            onChange={() => batchSel.toggle(b.batch_id)}
                            aria-label={`Select batch ${b.batch_id.slice(0, 8)}`}
                          />
                        </td>
                        <td>
                          <span className="acq-mono">{b.batch_id.slice(0, 8)}…</span>
                        </td>
                        <td>
                          {/* Where the batch came from: the smart bin asked for
                              it (print-first — its session id IS this batch id),
                              or an admin generated it here. */}
                          <Badge
                            tone={b.source === 'requested' ? 'info' : 'neutral'}
                            title={b.source === 'requested'
                              ? `Requested by the smart bin${b.machine_id ? ` · machine ${b.machine_id.slice(0, 10)}…` : ''}${b.session_id ? ` · session ${b.session_id}` : ''}`
                              : 'Generated in the dashboard'}
                          >
                            {b.source === 'requested' ? 'Smart bin' : 'Dashboard'}
                          </Badge>
                        </td>
                        <td className="acq-muted">
                          {new Date(b.created_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                        </td>
                        <td className="ui-num">{b.activated} / {b.total}</td>
                        <td className="acq-muted">
                          {exp
                            ? exp.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
                            : 'Never'}
                        </td>
                        <td>
                          <Badge tone={statusTone} title={b.revoked_reason ? `Reason: ${b.revoked_reason}` : undefined}>
                            {statusLabel}
                            {b.revoked_reason && <span className="acq-why"> · why?</span>}
                          </Badge>
                        </td>
                        <td className="acq-row-actions">
                          <Button
                            variant="ghost"
                            size="sm"
                            icon={QrCode}
                            onClick={() => setQrModal({ batch_id: b.batch_id, url: urlForBatch(b.batch_id), source: b.source })}
                            title="Show this batch’s QR code again"
                          >
                            QR
                          </Button>
                          {isRevoked ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              icon={RotateCcw}
                              onClick={() => handleUnrevoke(b.batch_id)}
                              disabled={busy}
                              title="Re-enable this batch. Customers will be able to claim it again."
                            >
                              {busy ? 'Restoring…' : 'Restore'}
                            </Button>
                          ) : (
                            <Button
                              variant="danger-ghost"
                              size="sm"
                              icon={Ban}
                              onClick={() => setRevokeModal({ batch_id: b.batch_id })}
                              disabled={busy || fullyUsed}
                              title={fullyUsed ? 'All cups in this batch have already been claimed — nothing to revoke.' : 'Mark this batch as cancelled. Any pending scans of it will fail.'}
                            >
                              Revoke
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>

        {recent.length > BATCH_PAGE_SIZE && (
          <CardFoot>
            <div className="acq-pagination">
              <span>
                Page {safeBatchPage + 1} of {batchPageCount} · {recent.length} batches
              </span>
              <div className="acq-pagination__btns">
                <Button
                  size="sm"
                  icon={ChevronLeft}
                  onClick={() => setBatchPage(p => Math.max(0, p - 1))}
                  disabled={safeBatchPage <= 0}
                >
                  Previous
                </Button>
                <Button
                  size="sm"
                  iconRight={ChevronRight}
                  onClick={() => setBatchPage(p => Math.min(batchPageCount - 1, p + 1))}
                  disabled={safeBatchPage >= batchPageCount - 1}
                >
                  Next
                </Button>
              </div>
            </div>
          </CardFoot>
        )}
      </Card>

      <BulkDeleteBar
        count={batchSel.count}
        noun="batches"
        onClear={batchSel.clear}
        onDelete={handleDeleteBatches}
      />

      {/* Re-opened QR for a past batch — reprint a receipt, or check the
          exact link a bin-requested session points at. */}
      <Modal
        open={!!qrModal}
        onClose={() => setQrModal(null)}
        title="Batch QR code"
        subtitle={qrModal?.source === 'requested' ? 'Requested by the smart bin.' : 'Generated in the dashboard.'}
        icon={QrCode}
        footer={(
          <>
            <Button
              icon={Copy}
              onClick={() => navigator.clipboard?.writeText(qrModal?.url || '').catch(() => {})}
            >
              Copy link
            </Button>
            <Button variant="primary" onClick={() => setQrModal(null)}>Close</Button>
          </>
        )}
      >
        {qrModal && (
          <div className="acq-qrmodal">
            <div className="acq-qrmodal__qr"><canvas ref={modalQrRef} /></div>
            <div className="acq-qrmodal__meta">
              <span className="acq-qrmodal__label">Batch</span>
              <span className="acq-mono">{qrModal.batch_id}</span>
            </div>
            <code className="acq-url">{qrModal.url}</code>
          </div>
        )}
      </Modal>

      {/* Keyed per batch so the reason starts empty every time. */}
      <RevokeBatchModal
        key={revokeModal?.batch_id || 'none'}
        batchId={revokeModal?.batch_id}
        onCancel={() => setRevokeModal(null)}
        onConfirm={async (reason) => {
          const id = revokeModal.batch_id;
          setRevokeModal(null);
          await handleRevoke(id, reason);
        }}
      />
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
    <Modal
      open={!!batchId}
      onClose={onCancel}
      title="Revoke this batch?"
      subtitle="A customer who scans this QR code sees a “QR cancelled” message and gets no cups. Cups already claimed stay in their balance."
      icon={Ban}
      iconTone="rose"
      footer={(
        <>
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button
            variant="danger"
            icon={Ban}
            onClick={() => onConfirm(reason.trim())}
            disabled={!canSubmit}
            title={!canSubmit ? 'Say why you’re revoking this batch' : undefined}
          >
            Revoke batch
          </Button>
        </>
      )}
    >
      <Field
        label="Reason (required)"
        htmlFor="acq-revoke-reason"
        hint={<>Kept in the activity log. Batch <span className="acq-mono">{batchId}</span></>}
      >
        <input
          id="acq-revoke-reason"
          className="ui-input"
          placeholder="e.g. Misprinted batch, reprinted as XYZ"
          value={reason}
          onChange={e => setReason(e.target.value)}
          autoFocus
        />
      </Field>
    </Modal>
  );
}
