import { useState } from 'react';
import { QrCode, ReceiptText } from 'lucide-react';
import { PageHeader, Tabs } from '../ui';
import { useOrg } from '../context/OrgContext';
import AdminCupQr from './AdminCupQr';
import RewardsReceiptGenerator from './RewardsReceiptGenerator';
import './AdminReceiptGenerator.css';

/* ─────────────────────────────────────────────────────────────────────
 * AdminReceiptGenerator — the "Receipt generator" page (formerly "QR
 * Receipt Batches"). Hosts two tabs:
 *   • Cup QR receipts — the smart-bin QR batch generator.
 *   • Reward receipts — generates test purchase-receipt images that the
 *                       AI auto-accepts (for the feasibility test).
 * ───────────────────────────────────────────────────────────────────── */
const TABS = [
  { id: 'qr', label: 'Cup QR receipts', icon: QrCode },
  { id: 'rewards', label: 'Reward receipts', icon: ReceiptText },
];

const SUBTITLES = {
  qr: 'Make the QR receipt a customer scans to collect returned cups. Each batch mints fresh single-use cup codes.',
  rewards: 'Make a test purchase receipt that receipt verification always accepts, so testers can claim a reward without buying anything.',
};

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
    <div className="ui-page arg">
      <PageHeader title="Receipt generator" subtitle={SUBTITLES[activeTab]} />

      {tabs.length > 1 && (
        <div className="arg-tabs">
          <Tabs tabs={tabs} value={activeTab} onChange={setTab} ariaLabel="Receipt type" />
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
