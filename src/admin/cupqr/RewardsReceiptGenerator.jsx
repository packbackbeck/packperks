import { useEffect, useRef, useState, useCallback } from 'react';
import { toJpeg, toPng } from 'html-to-image';
import { jsPDF } from 'jspdf';
import { getAppConfig } from '../../lib/api';
import { createGeneratedReceipt, listGeneratedReceipts } from '../lib/adminApi';
import { useOrg } from '../context/OrgContext';
import { logAction } from '../auth/actionLog';
import './RewardsReceiptGenerator.css';

/* ─────────────────────────────────────────────────────────────────────
 * RewardsReceiptGenerator — mints test "purchase receipt" images for the
 * feasibility test. Admin builds a line-item list (from the org's rewards
 * or free-typed custom items to probe the AI), sets a date, and generates
 * a receipt image stamped with a "PackPerks Verified Test Receipt" badge
 * + a unique PPK- token. verify-receipt reads that token back and
 * auto-accepts the receipt (see supabase/functions/verify-receipt).
 *
 * Custom items let an admin try to trick the vision check — but because
 * acceptance is driven by the server-validated token (not the AI's
 * authenticity guess), our own generated receipts are always accepted.
 * ───────────────────────────────────────────────────────────────────── */

function nowLocalDatetime() {
  const d = new Date();
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60_000).toISOString().slice(0, 16);
}

export default function RewardsReceiptGenerator() {
  const { activeOrg } = useOrg();
  const orgName = activeOrg?.partner_brand_name || activeOrg?.name || 'Partner';

  const [rewards, setRewards] = useState([]);          // [{id,name,euros}]
  const [lineItems, setLineItems] = useState([]);      // [{name, qty, price}]
  const [pickId, setPickId] = useState('');
  const [customName, setCustomName] = useState('');
  const [customPrice, setCustomPrice] = useState('');
  const [receiptDate, setReceiptDate] = useState(nowLocalDatetime);
  const [venue, setVenue] = useState(`${orgName} — Titaan`);

  const [receipt, setReceipt] = useState(null);        // { token, items, total, date, venue }
  const [generating, setGenerating] = useState(false);
  const [exporting, setExporting] = useState(null);
  const [error, setError] = useState(null);

  const [log, setLog] = useState([]);
  const [logLoading, setLogLoading] = useState(false);
  const receiptRef = useRef(null);

  // Load this org's published rewards for the dropdown.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const cfg = await getAppConfig(activeOrg?.id);
        if (cancelled) return;
        const live = Array.isArray(cfg?.rewards)
          ? cfg.rewards.filter(r => r.status !== 'archived')
          : [];
        setRewards(live.map(r => ({ id: r.id, name: r.name, euros: Number(r.euros) || 0 })));
      } catch (e) {
        console.error('load rewards failed', e);
      }
    })();
    return () => { cancelled = true; };
  }, [activeOrg?.id]);

  const refreshLog = useCallback(async () => {
    setLogLoading(true);
    try { setLog(await listGeneratedReceipts({ limit: 30 })); }
    catch (e) { console.error('listGeneratedReceipts', e); }
    finally { setLogLoading(false); }
  }, []);
  useEffect(() => { refreshLog(); }, [refreshLog, activeOrg?.id]);

  const total = lineItems.reduce((s, it) => s + (Number(it.price) || 0) * (it.qty || 1), 0);

  function addRewardItem() {
    const r = rewards.find(x => x.id === pickId);
    if (!r) return;
    setLineItems(prev => {
      const existing = prev.find(p => p.name === r.name && p.price === r.euros);
      if (existing) return prev.map(p => p === existing ? { ...p, qty: p.qty + 1 } : p);
      return [...prev, { name: r.name, qty: 1, price: r.euros }];
    });
  }

  function addCustomItem() {
    const name = customName.trim();
    if (!name) return;
    const price = parseFloat(customPrice) || 0;
    setLineItems(prev => [...prev, { name, qty: 1, price }]);
    setCustomName('');
    setCustomPrice('');
  }

  function setQty(idx, qty) {
    setLineItems(prev => prev.map((it, i) => i === idx ? { ...it, qty: Math.max(1, qty) } : it));
  }
  function removeItem(idx) {
    setLineItems(prev => prev.filter((_, i) => i !== idx));
  }

  async function handleGenerate() {
    if (lineItems.length === 0) { setError('Add at least one item first.'); return; }
    setError(null);
    setGenerating(true);
    try {
      const isoDate = receiptDate ? new Date(receiptDate).toISOString() : new Date().toISOString();
      const row = await createGeneratedReceipt({
        items: lineItems,
        total,
        receiptDate: isoDate,
        venue,
      });
      setReceipt({ token: row.token, items: lineItems, total, date: isoDate, venue });
      logAction({
        action: 'receipt.generate',
        targetType: 'generated_receipt',
        targetId: row.id,
        metadata: { token: row.token, total, item_count: lineItems.length },
      });
      refreshLog();
    } catch (e) {
      console.error('createGeneratedReceipt failed', e);
      setError(e.message || 'Could not generate the receipt.');
    } finally {
      setGenerating(false);
    }
  }

  async function capture(format) {
    const node = receiptRef.current;
    if (!node) return null;
    const rect = node.getBoundingClientRect();
    const opts = { pixelRatio: 2, backgroundColor: '#FFFFFF', width: rect.width, height: rect.height, cacheBust: true };
    return format === 'jpg' ? toJpeg(node, { ...opts, quality: 0.95 }) : toPng(node, opts);
  }

  async function downloadImage(format) {
    if (!receipt) return;
    setExporting(format);
    try {
      const dataUrl = await capture(format === 'pdf' ? 'png' : format);
      if (!dataUrl) return;
      if (format === 'pdf') {
        const rect = receiptRef.current.getBoundingClientRect();
        const aspect = rect.height / rect.width;
        const widthMm = 80;
        const heightMm = widthMm * aspect;
        const pdf = new jsPDF({ unit: 'mm', format: [widthMm, heightMm], orientation: heightMm > widthMm ? 'portrait' : 'landscape' });
        pdf.addImage(dataUrl, 'PNG', 0, 0, widthMm, heightMm);
        pdf.save(`packperks-receipt-${receipt.token}.pdf`);
      } else {
        const a = document.createElement('a');
        a.href = dataUrl;
        a.download = `packperks-receipt-${receipt.token}.${format}`;
        a.click();
      }
    } catch (e) {
      console.error('export failed', e);
      setError('Could not export the receipt image.');
    } finally {
      setExporting(null);
    }
  }

  const fmtDate = (iso) =>
    new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  return (
    <div className="rrg">
      <div className="rrg-header">
        <div>
          <h2 className="rrg-header__title">Rewards Receipt Generator</h2>
          <p className="rrg-header__sub">
            Build a test purchase receipt for <strong>{orgName}</strong>. Generated receipts carry a
            PackPerks verification token and are auto-accepted by receipt verification — so testers can
            complete the redemption flow without a real purchase. Add custom items to probe the AI vision.
          </p>
        </div>
        <div className="rrg-header__actions">
          <button className="rrg-btn rrg-btn--ghost" onClick={() => downloadImage('jpg')} disabled={!receipt || !!exporting}>
            {exporting === 'jpg' ? 'Saving…' : 'JPG'}
          </button>
          <button className="rrg-btn rrg-btn--ghost" onClick={() => downloadImage('png')} disabled={!receipt || !!exporting}>
            {exporting === 'png' ? 'Saving…' : 'PNG'}
          </button>
          <button className="rrg-btn rrg-btn--ghost" onClick={() => downloadImage('pdf')} disabled={!receipt || !!exporting}>
            {exporting === 'pdf' ? 'Saving…' : 'PDF'}
          </button>
        </div>
      </div>

      <div className="rrg-layout">
        {/* Controls */}
        <div className="rrg-controls">
          <div className="rrg-card">
            <h3 className="rrg-card__title">Add items</h3>

            <label className="rrg-field">
              <span className="rrg-field__label">From this org's rewards</span>
              <div className="rrg-row">
                <select className="rrg-input" value={pickId} onChange={e => setPickId(e.target.value)}>
                  <option value="">Select a reward…</option>
                  {rewards.map(r => (
                    <option key={r.id} value={r.id}>{r.name} — €{r.euros.toFixed(2)}</option>
                  ))}
                </select>
                <button className="rrg-btn rrg-btn--primary" onClick={addRewardItem} disabled={!pickId}>Add</button>
              </div>
              {rewards.length === 0 && <span className="rrg-field__hint">No published rewards for this org yet.</span>}
            </label>

            <label className="rrg-field">
              <span className="rrg-field__label">Custom item (to test/trick the AI)</span>
              <div className="rrg-row">
                <input className="rrg-input" placeholder="Item name" value={customName} onChange={e => setCustomName(e.target.value)} />
                <input className="rrg-input rrg-input--price" type="number" step="0.01" min="0" placeholder="€" value={customPrice} onChange={e => setCustomPrice(e.target.value)} />
                <button className="rrg-btn rrg-btn--ghost" onClick={addCustomItem} disabled={!customName.trim()}>Add</button>
              </div>
            </label>
          </div>

          <div className="rrg-card">
            <h3 className="rrg-card__title">Receipt details</h3>
            <label className="rrg-field">
              <span className="rrg-field__label">Date &amp; time</span>
              <input className="rrg-input" type="datetime-local" value={receiptDate} onChange={e => setReceiptDate(e.target.value)} />
            </label>
            <label className="rrg-field">
              <span className="rrg-field__label">Venue / location</span>
              <input className="rrg-input" value={venue} onChange={e => setVenue(e.target.value)} />
            </label>

            {lineItems.length > 0 && (
              <div className="rrg-items">
                {lineItems.map((it, i) => (
                  <div key={i} className="rrg-item">
                    <span className="rrg-item__name">{it.name}</span>
                    <input
                      className="rrg-item__qty"
                      type="number" min="1" value={it.qty}
                      onChange={e => setQty(i, parseInt(e.target.value, 10) || 1)}
                    />
                    <span className="rrg-item__price">€{((Number(it.price) || 0) * it.qty).toFixed(2)}</span>
                    <button className="rrg-item__remove" onClick={() => removeItem(i)} aria-label="Remove">×</button>
                  </div>
                ))}
                <div className="rrg-item rrg-item--total">
                  <span className="rrg-item__name">Total</span>
                  <span className="rrg-item__price">€{total.toFixed(2)}</span>
                </div>
              </div>
            )}

            <button className="rrg-btn rrg-btn--primary rrg-btn--block" onClick={handleGenerate} disabled={generating || lineItems.length === 0}>
              {generating ? 'Generating…' : 'Generate receipt'}
            </button>
            {error && <p className="rrg-error">{error}</p>}
          </div>
        </div>

        {/* Receipt preview */}
        <div className="rrg-preview-wrap">
          {receipt ? (
            <div className="rrg-receipt" ref={receiptRef}>
              <div className="rrg-receipt__head">
                <div className="rrg-receipt__brand">{(receipt.venue || orgName).toUpperCase()}</div>
                <div className="rrg-receipt__meta">{fmtDate(receipt.date)}</div>
              </div>
              <div className="rrg-receipt__dashed" />
              <div className="rrg-receipt__lines">
                {receipt.items.map((it, i) => (
                  <div key={i} className="rrg-receipt__line">
                    <span className="rrg-receipt__qty">{it.qty}×</span>
                    <span className="rrg-receipt__iname">{it.name}</span>
                    <span className="rrg-receipt__iprice">€{((Number(it.price) || 0) * it.qty).toFixed(2)}</span>
                  </div>
                ))}
              </div>
              <div className="rrg-receipt__dashed" />
              <div className="rrg-receipt__total">
                <span>TOTAL</span>
                <span>€{receipt.total.toFixed(2)}</span>
              </div>
              <div className="rrg-receipt__total rrg-receipt__total--sub">
                <span>BTW 9%</span>
                <span>€{(receipt.total * 0.09 / 1.09).toFixed(2)}</span>
              </div>
              <div className="rrg-receipt__dashed" />
              <div className="rrg-receipt__badge">
                <span className="rrg-receipt__check">✓</span>
                <div>
                  <div className="rrg-receipt__badge-title">PackPerks Verified Test Receipt</div>
                  <div className="rrg-receipt__token">{receipt.token}</div>
                </div>
              </div>
              <div className="rrg-receipt__foot">Generated by PackPerks dashboard · not a real purchase</div>
            </div>
          ) : (
            <div className="rrg-receipt rrg-receipt--placeholder">
              Add items and click <strong>Generate receipt</strong> to preview.
            </div>
          )}
        </div>
      </div>

      {/* Log */}
      <section className="rrg-log">
        <header className="rrg-log__head">
          <h3 className="rrg-log__title">Generated receipts</h3>
          <p className="rrg-log__sub">Every receipt minted here is logged. Its token is what verification matches against.</p>
        </header>
        {logLoading ? (
          <div className="rrg-log__empty">Loading…</div>
        ) : log.length === 0 ? (
          <div className="rrg-log__empty">No receipts generated yet.</div>
        ) : (
          <table className="rrg-log__table">
            <thead>
              <tr><th>Token</th><th>Items</th><th>Total</th><th>Receipt date</th><th>Generated</th></tr>
            </thead>
            <tbody>
              {log.map(r => (
                <tr key={r.id}>
                  <td><code>{r.token}</code></td>
                  <td>{Array.isArray(r.items) ? r.items.length : 0}</td>
                  <td>€{Number(r.total || 0).toFixed(2)}</td>
                  <td className="rrg-log__muted">{r.receipt_date ? fmtDate(r.receipt_date) : '—'}</td>
                  <td className="rrg-log__muted">{fmtDate(r.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
