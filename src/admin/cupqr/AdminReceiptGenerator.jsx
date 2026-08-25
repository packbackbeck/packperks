import { useState } from 'react';
import { useOrg } from '../context/OrgContext';
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
  const { activeOrgMode } = useOrg();
  // Rewards Receipts generates test PURCHASE receipts for reward claims.
  // A tikkie-only org has no rewards and no claims to test, so the tab (and
  // the tab strip itself, now that there's nothing to switch between) goes.
  const isTikkieOnly = activeOrgMode === 'tikkie_only';
  const tabs = isTikkieOnly ? TABS.filter(t => t.id === 'qr') : TABS;
  const activeTab = isTikkieOnly ? 'qr' : tab;

  return (
    <div className="arg">
      {tabs.length > 1 && (
      <div className="arg-tabs" role="tablist">
        {tabs.map(t => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={`arg-tab ${activeTab === t.id ? 'arg-tab--active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      )}

      {/* Both stay mounted so each tab keeps its in-progress state when you
          switch back and forth; only the active one is shown. */}
      <div hidden={activeTab !== 'qr'}>
        <AdminCupQr onNavigate={onNavigate} />
      </div>
      {!isTikkieOnly && (
        <div hidden={activeTab !== 'rewards'}>
          <RewardsReceiptGenerator />
        </div>
      )}
    </div>
  );
}
