import './SuccessPage.css';

/* Generate a deterministic-looking claim ID from timestamp */
function makeClaimId() {
  const stored = localStorage.getItem('packperks_last_claim_id');
  if (stored) return stored;
  const id = 'PP-' + Date.now().toString(36).toUpperCase().slice(-6) + '-' + Math.random().toString(36).slice(2, 5).toUpperCase();
  localStorage.setItem('packperks_last_claim_id', id);
  return id;
}

function formatDate(d = new Date()) {
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatTime(d = new Date()) {
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function getUserName() {
  try {
    const p = JSON.parse(localStorage.getItem('packperks_user_profile') || '{}');
    return p.displayName || p.firstName + ' ' + p.lastName || 'PackPerks User';
  } catch { return 'PackPerks User'; }
}

function getUserEmail() {
  try {
    const p = JSON.parse(localStorage.getItem('packperks_user_profile') || '{}');
    return p.email || null;
  } catch { return null; }
}

const ReceiptRow = ({ label, value, bold, green }) => (
  <div className="sp-receipt__row">
    <span className="sp-receipt__label">{label}</span>
    <span className={`sp-receipt__value${bold ? ' sp-receipt__value--bold' : ''}${green ? ' sp-receipt__value--green' : ''}`}>{value}</span>
  </div>
);

export default function SuccessPage({ reward, claimedIban, onDone }) {
  const now = new Date();
  const claimId = makeClaimId();
  const userName = getUserName();
  const userEmail = getUserEmail();
  const cashback = reward.euros?.toFixed(2) ?? (reward.cupsNeeded * 1.25).toFixed(2);
  const ibanDisplay = claimedIban
    ? claimedIban.replace(/\s/g, '').replace(/(.{4})/g, '$1 ').trim().slice(0, -8) + '•••• ••••'
    : '•••• •••• •••• ••••';

  return (
    <div className="success-page">
      {/* Green glow backdrop */}
      <div className="success-page__glow" />

      {/* Animated checkmark */}
      <div className="success-page__check-wrap">
        <svg className="success-page__check-svg" viewBox="0 0 80 80" fill="none">
          <circle cx="40" cy="40" r="38" fill="#1A8737" opacity="0.15" />
          <circle cx="40" cy="40" r="30" fill="#1A8737" />
          <path
            className="success-page__check-path"
            d="M24 40L35 51L56 29"
            stroke="white"
            strokeWidth="4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>

      {/* Congrats text */}
      <div className="success-page__text">
        <h1 className="success-page__title">Reward claimed!</h1>
        <p className="success-page__subtitle">Your cashback is on its way 🎉</p>
      </div>

      {/* ── Receipt card ── */}
      <div className="sp-receipt">
        {/* Header: reward thumbnail + name + amount */}
        <div className="sp-receipt__header">
          <div className="sp-receipt__img-wrap" style={{ background: reward.bgColor || '#FEA01E' }}>
            <img
              src={reward.image}
              alt={reward.name}
              className="sp-receipt__img"
              style={typeof reward.image === 'string' && reward.image.startsWith('http')
                ? { width: '140%', objectFit: 'contain', transform: 'translate(-14%, -20%)' }
                : undefined}
            />
          </div>
          <div className="sp-receipt__header-info">
            <span className="sp-receipt__reward-name">{reward.name}</span>
            <span className="sp-receipt__cashback-amount">€{cashback} cashback</span>
          </div>
        </div>

        {/* Dashed divider */}
        <div className="sp-receipt__dashed" />

        {/* Receipt rows */}
        <div className="sp-receipt__rows">
          <ReceiptRow label="Claim ID" value={claimId} />
          <ReceiptRow label="Date" value={formatDate(now)} />
          <ReceiptRow label="Time" value={formatTime(now)} />
          <ReceiptRow label="Name" value={userName} />
          {userEmail && <ReceiptRow label="Email" value={userEmail} />}
          <ReceiptRow label="IBAN" value={ibanDisplay} />
          <ReceiptRow label="Cups redeemed" value={`${reward.cupsNeeded} cup${reward.cupsNeeded !== 1 ? 's' : ''}`} />
        </div>

        {/* Dashed divider */}
        <div className="sp-receipt__dashed" />

        {/* Total */}
        <ReceiptRow label="Total cashback" value={`€${cashback}`} bold green />

        {/* ETA */}
        <div className="sp-receipt__eta">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#1A8737" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <polyline points="12 6 12 12 16 14"/>
          </svg>
          Deposited to your IBAN within <strong>24 hours</strong>
        </div>
      </div>

      {/* CTA */}
      <button className="success-page__btn" onClick={onDone}>
        Back to home
      </button>
    </div>
  );
}
