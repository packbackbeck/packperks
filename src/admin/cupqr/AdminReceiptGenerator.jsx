import { useState } from 'react';
import AdminCupQr from './AdminCupQr';
import RewardsReceiptGenerator from './RewardsReceiptGenerator';
import './AdminReceiptGenerator.css';

/* ─────────────────────────────────────────────────────────────────────
 * AdminReceiptGenerator — the "Receipt Generator" page (formerly "QR
 * Receipt Batches"). Hosts two tabs:
 *   • QR Cup Receipts  — the existing smart-bin QR batch generator.
 *   • Rewards Receipts — generates test purchase-receipt images that the
 *                        AI auto-accepts (for the feasibility test).
 * ───────────────────────────────────────────────────────────────────── */
const TABS = [
  { id: 'qr', label: 'QR Cup Receipts' },
  { id: 'rewards', label: 'Rewards Receipts' },
];

export default function AdminReceiptGenerator({ onNavigate }) {
  const [tab, setTab] = useState('qr');

  return (
    <div className="arg">
      <div className="arg-tabs" role="tablist">
        {TABS.map(t => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={`arg-tab ${tab === t.id ? 'arg-tab--active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Both stay mounted so each tab keeps its in-progress state when you
          switch back and forth; only the active one is shown. */}
      <div hidden={tab !== 'qr'}>
        <AdminCupQr onNavigate={onNavigate} />
      </div>
      <div hidden={tab !== 'rewards'}>
        <RewardsReceiptGenerator />
      </div>
    </div>
  );
}
