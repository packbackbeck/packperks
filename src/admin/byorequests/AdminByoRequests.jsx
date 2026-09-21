import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Check, CheckCircle2, Download, Inbox, LayoutGrid, QrCode, X } from 'lucide-react';
import QRCode from 'qrcode';
import { toPng } from 'html-to-image';
import { getByoRequests, approveByoRequest, denyByoRequest, getByoCap, saveByoCap, BYO_CAP_DEFAULT, getLocations } from '../lib/adminApi';
import { useOrg } from '../context/OrgContext';
import { resolveEffectiveMode } from '../lib/orgModes';
import packbackLogo from '../../assets/images/packback-logo.png';
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, Field, PageHeader, Segmented } from '../ui';
import './AdminByoRequests.css';

/* ─────────────────────────────────────────────────────────────────────
 * AdminByoRequests — Phase 3 BYO approval queue.
 *
 * A bring-your-own store auto-credits up to 2 cups per customer per
 * rolling 24h (the byo-mint edge function). The 3rd+ scan lands here as
 * a pending request: an admin Approves (credits the cup) or Denies.
 *
 * Also hosts the store's stationary "counter QR" (/<slug>/?byo=1). One org
 * can have MULTIPLE locations, each with its own counter QR (?loc=<id>) so
 * scans are attributed to the right address — but a cup earned at any
 * location is redeemable across the whole organisation.
 * ───────────────────────────────────────────────────────────────────── */

const PROD_URL = 'https://perks.packback.network/';   // BYO QR/link always points at the .network domain

const STATUSES = [
  { key: 'pending',  label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'denied',   label: 'Denied' },
  { key: 'all',      label: 'All' },
];

const STATUS_TONE = { pending: 'warning', approved: 'success', denied: 'neutral' };

function fmtWhen(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  } catch { return iso; }
}

/* One-line address for the subtle caption under the QR. */
function addressLine(loc) {
  if (!loc) return '';
  return [loc.address, loc.postal_code, loc.city].filter(Boolean).join(', ');
}

export default function AdminByoRequests() {
  const { activeOrg, activeOrgId, activeOrgSlug, activeOrgMode, activeGroupMode } = useOrg();
  // Static QR code runs in every programme. Bring Your Own and Deposit
  // Rewards add cups (extra scans wait for review); Deferred Tikkie adds one
  // cup's refund to the wallet and simply stops at the limit.
  const mode = resolveEffectiveMode(activeOrgMode, activeGroupMode);
  const tikkie = mode === 'tikkie_only';
  const [status, setStatus]   = useState('pending');
  const [rows, setRows]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [busyId, setBusyId]   = useState(null);
  const [notice, setNotice]   = useState(null);

  // Per-store daily auto-credit cap (how many times/day a customer can scan
  // this store's QR before extra scans are held for review).
  const [cap, setCap]         = useState(BYO_CAP_DEFAULT);
  const [capInput, setCapInput] = useState(String(BYO_CAP_DEFAULT));
  const [savingCap, setSavingCap] = useState(false);
  const [capMsg, setCapMsg]   = useState(null);

  // Locations for this org + the one whose counter QR we're showing.
  const [locations, setLocations] = useState([]);
  const [locId, setLocId]     = useState(''); // '' = whole store (no ?loc)
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [downloadingA4, setDownloadingA4] = useState(false);
  const qrCardRef = useRef(null);

  const selectedLocation = useMemo(
    () => locations.find(l => l.id === locId) || null,
    [locations, locId],
  );
  const brandName = activeOrg?.partner_brand_name || activeOrg?.name || 'Your store';

  useEffect(() => {
    let alive = true;
    if (!activeOrgId) return undefined;
    getByoCap(activeOrgId).then(n => {
      if (!alive) return;
      setCap(n); setCapInput(String(n));
    }).catch(() => {});
    getLocations(activeOrgId).then(locs => {
      if (!alive) return;
      setLocations(locs);
      // Default to the first location if the org has any; else the whole store.
      setLocId(locs.length ? locs[0].id : '');
    }).catch(() => { if (alive) { setLocations([]); setLocId(''); } });
    return () => { alive = false; };
  }, [activeOrgId]);

  async function handleSaveCap() {
    setSavingCap(true); setCapMsg(null);
    try {
      const saved = await saveByoCap(activeOrgId, capInput);
      setCap(saved); setCapInput(String(saved));
      setCapMsg('Saved');
      setTimeout(() => setCapMsg(null), 2500);
    } catch (e) {
      setCapMsg(e.message || 'Could not save.');
    } finally {
      setSavingCap(false);
    }
  }

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await getByoRequests(status));
    } catch (e) {
      console.error(e);
      setError(e.message || 'Failed to load requests.');
    } finally {
      setLoading(false);
    }
  }, [status, activeOrgId]);

  useEffect(() => { load(); }, [load]);

  // Per-location counter URL. ?loc=<id> tags the scan with its location; a cup
  // is still added to the customer's org-wide balance (redeemable anywhere).
  const byoUrl = activeOrgSlug
    ? `${PROD_URL}${activeOrgSlug}/?byo=1${locId ? `&loc=${locId}` : ''}`
    : null;

  // Render the QR as a data URL (an <img>, not a live canvas) so html-to-image
  // captures it reliably when downloading the branded card.
  useEffect(() => {
    if (!byoUrl) { setQrDataUrl(''); return; }
    QRCode.toDataURL(byoUrl, {
      width: 320, margin: 1, errorCorrectionLevel: 'M',
      color: { dark: '#0F0F0F', light: '#FFFFFF' },
    }).then(setQrDataUrl).catch(err => console.error('BYO QR draw failed:', err));
  }, [byoUrl]);

  async function handleDownload() {
    if (!qrCardRef.current) return;
    setDownloading(true);
    try {
      const dataUrl = await toPng(qrCardRef.current, {
        pixelRatio: 3,
        backgroundColor: '#FFFFFF',
        cacheBust: true,
      });
      const a = document.createElement('a');
      const locSlug = selectedLocation
        ? '-' + (selectedLocation.name || 'location').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
        : '';
      a.href = dataUrl;
      a.download = `packperks-counter-qr-${activeOrgSlug || 'store'}${locSlug}.png`;
      a.click();
    } catch (e) {
      console.error('QR download failed:', e);
      setError('Could not download the QR image. If your logo is hosted elsewhere it may block the export — try again or remove the logo.');
    } finally {
      setDownloading(false);
    }
  }

  // Print sheet: an A4 PNG that tiles the BRANDED card (logo + store name + QR)
  // at exactly 6cm × 6cm, 3 across × 4 down (12 total), with dashed cut lines
  // around each so a store can print one page and cut them apart. Rendered at
  // 300 DPI; the card itself is captured once at high resolution.
  async function handleDownloadA4() {
    if (!qrCardRef.current || !qrDataUrl) return;
    setDownloadingA4(true);
    try {
      // Capture the branded card node (same node the single PNG exports) once.
      const cardPng = await toPng(qrCardRef.current, { pixelRatio: 4, backgroundColor: '#FFFFFF', cacheBust: true });
      const img = new Image();
      img.src = cardPng;
      await new Promise((res, rej) => { img.onload = res; img.onerror = rej; });

      const DPI = 300;
      const mm = (v) => Math.round((v / 25.4) * DPI);
      const W = mm(210), H = mm(297);       // A4 portrait
      const TILE = mm(60);                   // 6cm branded card
      const cols = 3, rows = 4;
      const gapX = (W - cols * TILE) / (cols + 1);
      const gapY = (H - rows * TILE) / (rows + 1);

      const canvas = document.createElement('canvas');
      canvas.width = W; canvas.height = H;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, W, H);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const x = Math.round(gapX + c * (TILE + gapX));
          const y = Math.round(gapY + r * (TILE + gapY));
          ctx.drawImage(img, x, y, TILE, TILE);
          // Dashed cut boundary just outside the card.
          const pad = mm(2);
          ctx.strokeStyle = '#B9AF9A';
          ctx.lineWidth = Math.max(1, mm(0.25));
          ctx.setLineDash([mm(2.5), mm(1.8)]);
          ctx.strokeRect(x - pad, y - pad, TILE + pad * 2, TILE + pad * 2);
        }
      }
      ctx.setLineDash([]);

      const locSlug = selectedLocation
        ? '-' + (selectedLocation.name || 'location').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
        : '';
      const a = document.createElement('a');
      a.href = canvas.toDataURL('image/png');
      a.download = `packperks-counter-qr-a4-${activeOrgSlug || 'store'}${locSlug}.png`;
      a.click();
    } catch (e) {
      console.error('A4 QR sheet failed:', e);
      setError('Could not build the A4 sheet. If your logo is hosted elsewhere it may block the export — try again or remove the logo.');
    } finally {
      setDownloadingA4(false);
    }
  }

  async function decide(id, action) {
    setBusyId(id);
    setError(null);
    setNotice(null);
    try {
      if (action === 'approve') {
        await approveByoRequest(id);
        setNotice('Approved — the cup was credited to the customer.');
      } else {
        await denyByoRequest(id);
        setNotice('Request denied. No cup was credited.');
      }
      await load();
      setTimeout(() => setNotice(null), 4000);
    } catch (e) {
      console.error(e);
      setError(e.message || 'Action failed.');
    } finally {
      setBusyId(null);
    }
  }

  const statusLabel = (st) => (st ? st.charAt(0).toUpperCase() + st.slice(1) : '');

  return (
    <div className="ui-page byoreq">
      <PageHeader
        title="Static QR code"
        subtitle={tikkie
          ? `A QR code that stays on the counter. Each scan adds one cup’s refund to the customer’s wallet, up to ${cap} ${cap === 1 ? 'cup' : 'cups'} per person per 24 hours.`
          : `A QR code that stays on the counter. Each customer collects up to ${cap} ${cap === 1 ? 'cup' : 'cups'} per 24 hours automatically; extra scans wait below for you to approve or deny.`}
      />

      {/* Stationary counter QR — branded + per location */}
      <Card>
        <CardHeader
          title="Counter QR code"
          icon={QrCode}
          subtitle={tikkie
            ? 'Print it and stand it on the counter. Each scan adds one cup’s refund to the customer’s wallet, which they collect via Tikkie like any other refund.'
            : 'Print it and stand it on the counter. Each scan adds one cup to the customer’s balance, and a cup earned at any location can be spent across your whole organisation.'}
          ruled
        />
        <CardBody>
          <div className="byoreq__qr">
            <div className="byoreq__qr-left">
              {/* Branded, downloadable QR poster. This exact node is what's
                  exported, so it keeps its own colours. */}
              <div className="byoreq__qr-stage">
                <div className="byoreq__qr-brand" ref={qrCardRef}>
                  <div className="byoreq__qr-brand-head">
                    <img
                      className="byoreq__qr-logo"
                      src={activeOrg?.logo_url || packbackLogo}
                      alt=""
                      crossOrigin="anonymous"
                      onError={(e) => { e.currentTarget.src = packbackLogo; }}
                    />
                  </div>

                  {qrDataUrl
                    ? <img className="byoreq__qr-img" src={qrDataUrl} alt="Counter QR" width="200" height="200" />
                    : <div className="byoreq__qr-img byoreq__qr-img--placeholder" />}

                  {/* Name + address on one line: bold venue name, then ", address". */}
                  <div className="byoreq__qr-address">
                    <span className="byoreq__qr-brand-name">{brandName}</span>
                    {selectedLocation && addressLine(selectedLocation) ? <>, {addressLine(selectedLocation)}</> : null}
                  </div>
                </div>
              </div>

              <div className="byoreq__qr-downloads">
                <Button
                  icon={Download}
                  onClick={handleDownload}
                  disabled={!qrDataUrl || downloading}
                >
                  {downloading ? 'Preparing…' : 'Download PNG'}
                </Button>
                <Button
                  icon={LayoutGrid}
                  onClick={handleDownloadA4}
                  disabled={!qrDataUrl || downloadingA4}
                  title="An A4 sheet of 12 codes (3 × 4), each 6 cm — print and cut apart"
                >
                  {downloadingA4 ? 'Preparing…' : 'A4 sheet of 12'}
                </Button>
              </div>
            </div>

            <div className="byoreq__qr-info">
              {/* Location picker — one counter QR per address. */}
              <Field
                label="Location"
                htmlFor="byo-loc"
                hint={locations.length
                  ? 'Each location has its own QR code, so scans count toward the right address.'
                  : 'No locations yet. Add them under Settings → Locations; until then this QR code works for the whole store.'}
              >
                <select
                  id="byo-loc"
                  className="ui-select byoreq__loc-select"
                  value={locId}
                  onChange={e => setLocId(e.target.value)}
                  disabled={!locations.length}
                >
                  <option value="">Whole store (no location)</option>
                  {locations.map(l => (
                    <option key={l.id} value={l.id}>
                      {l.name}{l.city ? ` · ${l.city}` : ''}{l.status && l.status !== 'active' ? ' (inactive)' : ''}
                    </option>
                  ))}
                </select>
              </Field>

              <div className="ui-field">
                <span className="ui-field__label">Link in the QR code</span>
                {byoUrl
                  ? <code className="byoreq__qr-url">{byoUrl}</code>
                  : <span className="byoreq__muted">This organisation has no web address yet.</span>}
              </div>

              <div className="byoreq__divider" />

              {/* Per-store daily scan limit */}
              <Field
                label={tikkie ? 'Cups per person per day' : 'Automatic cups per day'}
                htmlFor="byo-cap"
                hint={tikkie
                  ? 'How many scans each customer gets credited per 24 hours. Scans over the limit add nothing.'
                  : 'How many scans each customer gets credited per 24 hours before extra scans need your review.'}
              >
                <div className="byoreq__cap-row">
                  <input
                    id="byo-cap"
                    className="ui-input byoreq__cap-input"
                    type="number" min="1" max="50" step="1"
                    value={capInput}
                    onChange={e => setCapInput(e.target.value)}
                    disabled={!activeOrgId || savingCap}
                  />
                  <Button
                    variant="primary"
                    onClick={handleSaveCap}
                    disabled={!activeOrgId || savingCap || capInput === String(cap)}
                  >
                    {savingCap ? 'Saving…' : 'Save limit'}
                  </Button>
                  {capMsg && (
                    <span className={`byoreq__cap-msg${capMsg === 'Saved' ? '' : ' byoreq__cap-msg--err'}`} role="status">
                      {capMsg === 'Saved' && <Check size={14} aria-hidden="true" />}
                      {capMsg}
                    </span>
                  )}
                </div>
              </Field>
            </div>
          </div>
        </CardBody>
      </Card>

      {/* Review queue: cups over the limit. A Deferred Tikkie wallet simply
          stops at the limit, so there is nothing to review there. */}
      {!tikkie && (
      <Card>
        <CardHeader
          title="Cup requests"
          icon={Inbox}
          subtitle="Scans over the daily limit. Approve to credit the cup, or deny."
          ruled
          actions={(
            <Segmented
              ariaLabel="Filter requests"
              value={status}
              onChange={setStatus}
              options={STATUSES.map(s => ({ id: s.key, label: s.label }))}
            />
          )}
        />
        <CardBody flush>
          {(error || notice) && (
            <div className="byoreq__messages">
              {error && (
                <p className="byoreq__msg byoreq__msg--err" role="alert">
                  <AlertCircle size={15} aria-hidden="true" />{error}
                </p>
              )}
              {notice && (
                <p className="byoreq__msg byoreq__msg--ok" role="status">
                  <CheckCircle2 size={15} aria-hidden="true" />{notice}
                </p>
              )}
            </div>
          )}

          {loading ? (
            <p className="byoreq__loading">Loading…</p>
          ) : rows.length === 0 ? (
            <EmptyState icon={Inbox} title={status === 'pending' ? 'No pending requests' : 'Nothing here'}>
              {status === 'pending'
                ? 'When a customer goes over the daily limit, their extra cup appears here for review.'
                : 'No requests with this status.'}
            </EmptyState>
          ) : (
            <div className="byoreq__table-wrap">
              <table className="ui-table byoreq__table">
                <thead>
                  <tr>
                    <th>Customer</th>
                    <th className="ui-num">Cups</th>
                    <th>Requested</th>
                    <th>Status</th>
                    <th className="byoreq__th-actions">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => (
                    <tr key={r.id}>
                      <td>
                        <div className="byoreq__cust">{r.userName || 'Anonymous'}</div>
                        {r.userEmail && <div className="byoreq__cust-sub">{r.userEmail}</div>}
                      </td>
                      <td className="ui-num">{r.cups}</td>
                      <td className="byoreq__when">{fmtWhen(r.created_at)}</td>
                      <td>
                        <Badge tone={STATUS_TONE[r.status] || 'neutral'}>{statusLabel(r.status)}</Badge>
                        {r.status !== 'pending' && r.decided_at && (
                          <div className="byoreq__cust-sub">{fmtWhen(r.decided_at)}</div>
                        )}
                      </td>
                      <td onClick={e => e.stopPropagation()}>
                        {r.status === 'pending' ? (
                          <div className="byoreq__actions">
                            <Button
                              variant="primary"
                              size="sm"
                              icon={Check}
                              disabled={busyId === r.id}
                              onClick={() => decide(r.id, 'approve')}
                            >
                              {busyId === r.id ? '…' : 'Approve'}
                            </Button>
                            <Button
                              variant="danger-ghost"
                              size="sm"
                              icon={X}
                              disabled={busyId === r.id}
                              onClick={() => decide(r.id, 'deny')}
                            >
                              Deny
                            </Button>
                          </div>
                        ) : (
                          <span className="byoreq__muted byoreq__none">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>
      )}

    </div>
  );
}
