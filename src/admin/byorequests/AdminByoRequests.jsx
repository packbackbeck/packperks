import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { toPng } from 'html-to-image';
import { getByoRequests, approveByoRequest, denyByoRequest, getByoCap, saveByoCap, BYO_CAP_DEFAULT, getLocations } from '../lib/adminApi';
import { useOrg } from '../context/OrgContext';
import packbackLogo from '../../assets/images/packback-logo.png';
import RewardsReceiptGenerator from '../cupqr/RewardsReceiptGenerator';
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
  const { activeOrg, activeOrgId, activeOrgSlug } = useOrg();
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

  return (
    <div className="byoreq">
      <header className="byoreq__head">
        <div>
          <span className="byoreq__eyebrow">Phase 3 · Bring-Your-Own</span>
          <h1 className="byoreq__title">BYO cup requests</h1>
          <p className="byoreq__sub">
            Customers auto-collect up to {cap} {cap === 1 ? 'cup' : 'cups'} per 24&nbsp;hours at this store.
            Any extra scan in that window lands here for review — approve to credit the cup, or deny.
          </p>
        </div>
      </header>

      {/* Stationary counter QR — branded + per location */}
      <section className="byoreq__qr-card">
        <div className="byoreq__qr-left">
          {/* Branded, downloadable QR poster. This exact node is what's exported. */}
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

          <button
            type="button"
            className="byoreq__qr-download"
            onClick={handleDownload}
            disabled={!qrDataUrl || downloading}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            {downloading ? 'Preparing…' : 'Download PNG'}
          </button>
        </div>

        <div className="byoreq__qr-info">
          <h3>Counter QR for this store</h3>
          <p>Print this and stand it on the counter. Scanning it adds one cup to the customer’s balance — earned at any location, a cup is redeemable across your whole organisation.</p>

          {/* Location picker — one counter QR per address. */}
          <div className="byoreq__cap">
            <label className="byoreq__cap-label" htmlFor="byo-loc">
              Location
              <span className="byoreq__cap-hint">
                {locations.length
                  ? 'Each location gets its own QR so scans are attributed to the right address.'
                  : 'No locations yet — add them on the Organisation page. This QR works store-wide until then.'}
              </span>
            </label>
            <div className="byoreq__cap-row">
              <select
                id="byo-loc"
                className="byoreq__loc-select"
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
            </div>
          </div>

          {byoUrl
            ? <code className="byoreq__qr-url">{byoUrl}</code>
            : <span className="byoreq__muted">This store isn’t in a bring-your-own group yet.</span>}

          {/* Per-store daily scan limit */}
          <div className="byoreq__cap">
            <label className="byoreq__cap-label" htmlFor="byo-cap">
              Auto-credit limit
              <span className="byoreq__cap-hint">Scans per customer per 24&nbsp;hours before extra scans need review.</span>
            </label>
            <div className="byoreq__cap-row">
              <input
                id="byo-cap"
                className="byoreq__cap-input"
                type="number" min="1" max="50" step="1"
                value={capInput}
                onChange={e => setCapInput(e.target.value)}
                disabled={!activeOrgId || savingCap}
              />
              <button
                type="button"
                className="byoreq__cap-save"
                onClick={handleSaveCap}
                disabled={!activeOrgId || savingCap || capInput === String(cap)}
              >
                {savingCap ? 'Saving…' : 'Save limit'}
              </button>
              {capMsg && <span className="byoreq__cap-msg">{capMsg}</span>}
            </div>
          </div>
        </div>
      </section>

      <div className="byoreq__tabs">
        {STATUSES.map(s => (
          <button
            key={s.key}
            className={`byoreq__tab ${status === s.key ? 'byoreq__tab--on' : ''}`}
            onClick={() => setStatus(s.key)}
          >
            {s.label}
          </button>
        ))}
      </div>

      {error && <div className="byoreq__error">{error}</div>}
      {notice && <div className="byoreq__notice">{notice}</div>}

      {loading ? (
        <div className="byoreq__skeleton">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="byoreq__empty">
          <h3>{status === 'pending' ? 'No pending requests' : 'Nothing here'}</h3>
          <p>
            {status === 'pending'
              ? 'When a customer goes over the auto-credit cap, their extra cup appears here for review.'
              : 'No requests with this status.'}
          </p>
        </div>
      ) : (
        <div className="byoreq__table-wrap">
          <table className="byoreq__table">
            <thead>
              <tr>
                <th>Customer</th>
                <th>Cups</th>
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
                  <td>{r.cups}</td>
                  <td className="byoreq__when">{fmtWhen(r.created_at)}</td>
                  <td>
                    <span className={`byoreq__pill byoreq__pill--${r.status}`}>{r.status}</span>
                    {r.status !== 'pending' && r.decided_at && (
                      <div className="byoreq__cust-sub">{fmtWhen(r.decided_at)}</div>
                    )}
                  </td>
                  <td onClick={e => e.stopPropagation()}>
                    {r.status === 'pending' ? (
                      <div className="byoreq__actions">
                        <button
                          className="byoreq__btn byoreq__btn--approve"
                          disabled={busyId === r.id}
                          onClick={() => decide(r.id, 'approve')}
                        >
                          {busyId === r.id ? '…' : 'Approve'}
                        </button>
                        <button
                          className="byoreq__btn byoreq__btn--deny"
                          disabled={busyId === r.id}
                          onClick={() => decide(r.id, 'deny')}
                        >
                          Deny
                        </button>
                      </div>
                    ) : (
                      <span className="byoreq__muted">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Rewards receipt generator ── */}
      <section className="byoreq__generator">
        <div className="byoreq__generator-head">
          <h2 className="byoreq__generator-title">Rewards receipt generator</h2>
          <p className="byoreq__generator-sub">Mint a test reward receipt for this store — same tool as the main dashboard.</p>
        </div>
        <RewardsReceiptGenerator />
      </section>
    </div>
  );
}
