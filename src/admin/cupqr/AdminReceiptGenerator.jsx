import { PageHeader } from '../ui';
import AdminCupQr from './AdminCupQr';
import RewardsReceiptGenerator from './RewardsReceiptGenerator';

/* ─────────────────────────────────────────────────────────────────────
 * Two pages, one tab each (the third, Static QR code, is byorequests):
 *   • Dynamic QR code (cupqr)  — single-use cup QR batches, the same ones
 *                                the smart bin prints.
 *   • Receipt generator (receipts) — test purchase receipts that receipt
 *                                verification always accepts.
 * ───────────────────────────────────────────────────────────────────── */

export function AdminDynamicQr({ onNavigate }) {
  return (
    <div className="ui-page">
      <PageHeader
        title="Dynamic QR code"
        subtitle="Make a single-use QR code a customer scans to collect cups. Each batch mints fresh cup codes that work once."
      />
      <AdminCupQr onNavigate={onNavigate} />
    </div>
  );
}

export default function AdminReceiptGenerator() {
  return (
    <div className="ui-page">
      <PageHeader
        title="Receipt generator"
        subtitle="Make a test purchase receipt that receipt verification always accepts, so testers can claim a reward without buying anything."
      />
      <RewardsReceiptGenerator />
    </div>
  );
}
