import './RefundSuccessPage.css';
import { useMoney, useRegion } from '../lib/RegionContext';
import Money from './Money';

function formatDate(d = new Date()) {
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}
function formatTime(d = new Date()) {
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

const Row = ({ label, value, bold, green }) => (
  <div className="rsp__row">
    <span className="rsp__label">{label}</span>
    <span className={`rsp__value${bold ? ' rsp__value--bold' : ''}${green ? ' rsp__value--green' : ''}`}>{value}</span>
  </div>
);

export default function RefundSuccessPage({ cupCount, amount, userEmail, onDone }) {
  const money = useMoney();
  // How this region promises to pay — NL hands over a Tikkie link, the UAE
  // only promises the cashback is sent (see payoutCopy in regions.js).
  const { payout } = useRegion();
  const isLinkPayout = payout.style === 'link';
  const now = new Date();
  const refundId = 'RF-' + Date.now().toString(36).toUpperCase().slice(-6);
  // C.2: the amount is computed by App from the venue's configured refund rate
  // and passed in — no hardcoded 1.00 per cup here anymore.
  const total = Number(amount || 0);
  const perCup = cupCount > 0 ? (Number(amount || 0) / cupCount) : 0;

  return (
    <div className="rsp">
      <div className="rsp__glow" />

      {/* Checkmark */}
      <div className="rsp__check-wrap">
        <svg className="rsp__check-svg" viewBox="0 0 80 80" fill="none">
          <circle cx="40" cy="40" r="38" fill="#1A8737" opacity="0.15" />
          <circle cx="40" cy="40" r="30" fill="#1A8737" />
          <path className="rsp__check-path" d="M24 40L35 51L56 29"
            stroke="white" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>

      {/* Text — C.3: in NL a refund is collected via a Tikkie link, not a bank
             deposit; other regions promise only that we send it. */}
      <div className="rsp__text">
        <h1 className="rsp__title">Refund submitted</h1>
        <p className="rsp__subtitle">
          {isLinkPayout ? 'We’ll send you a Tikkie link to collect it 💸' : 'We’ll send it straight to you 💸'}
        </p>
      </div>

      {/* Receipt card */}
      <div className="rsp__card">
        {/* Amount hero */}
        <div className="rsp__amount-row">
          <span className="rsp__amount"><Money value={total} /></span>
          <span className="rsp__amount-label">direct refund</span>
        </div>

        <div className="rsp__dashed" />

        <div className="rsp__rows">
          <Row label="Refund ID"   value={refundId} />
          <Row label="Date"        value={formatDate(now)} />
          <Row label="Time"        value={formatTime(now)} />
          {userEmail ? <Row label="Sent to" value={userEmail} /> : null}
          <Row label="Cups refunded" value={`${cupCount} cup${cupCount !== 1 ? 's' : ''}`} />
          <Row label="Rate"        value={<><Money value={perCup} /> per cup</>} />
        </div>

        <div className="rsp__dashed" />

        <Row label="Total refund" value={<Money value={total} />} bold green />

        <div className="rsp__eta">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#1A8737" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
          </svg>
          {isLinkPayout ? <>Tikkie link arrives</> : <>Cashback arrives</>} within <strong>7 days</strong>
        </div>
      </div>

      <button className="rsp__btn" onClick={onDone}>Back to home</button>

      <span className="rsp__note">
        {isLinkPayout
          ? 'We’ll review your refund and send a Tikkie link to collect your money. Open it to get paid. '
          : 'We’ll review your refund and send your money to you. '}
        Your cup balance has been reset to zero.
      </span>
    </div>
  );
}
