import { useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { logAction } from '../auth/actionLog';
import './PiiMask.css';

/* ─────────────────────────────────────────────────────────────────────
 * PiiMask — click-to-reveal wrapper for customer PII.
 *
 * Wraps a raw value (email or IBAN) so it renders as a masked preview
 * by default. Clicking the masked chip reveals the full value AND
 * writes an entry to the action log — every reveal is auditable.
 *
 * Owners + admins see clear-text by default (their roles are already
 * trusted with the data). Managers + checkers always need to click
 * through, so any glance at sensitive data leaves an audit trail.
 *
 * The mask itself is intentionally helpful — it shows the first 2 chars
 * of an email or the bank code prefix of an IBAN so admins doing
 * support can still recognise customers, but the bulk of the value is
 * hidden. */

function maskEmail(email) {
  if (!email) return '—';
  const [local, domain] = email.split('@');
  if (!domain) return '••••••';
  const head = local.slice(0, 2);
  const tail = local.slice(-1);
  const masked = local.length <= 3 ? '•••' : `${head}•••${tail}`;
  return `${masked}@${domain}`;
}

function maskIban(iban) {
  if (!iban) return '—';
  const clean = iban.replace(/\s/g, '').toUpperCase();
  if (clean.length < 8) return '••••';
  // Keep the country + check digits (NL00) and the bank code (BANK)
  // so admins can recognise the bank, mask the rest.
  return `${clean.slice(0, 8)} •••• •••• ${clean.slice(-4)}`;
}

const MASKERS = { email: maskEmail, iban: maskIban };
const ROLES_WITH_CLEAR_DEFAULT = new Set(['owner']);

export default function PiiMask({
  type,           // 'email' | 'iban'
  value,
  targetType,     // 'user' | 'claim' — for the audit log
  targetId,
  className = '',
  inline = false, // truthy → render as <span>, falsy → as a small interactive chip
}) {
  const { profile } = useAuth?.() || { profile: null };
  const role = profile?.role || 'checker';
  const trusted = ROLES_WITH_CLEAR_DEFAULT.has(role);

  const [revealed, setRevealed] = useState(trusted);

  if (!value) {
    return <span className={`pii-mask pii-mask--empty ${className}`}>—</span>;
  }

  const display = revealed ? value : MASKERS[type](value);

  function handleReveal(e) {
    e.preventDefault();
    e.stopPropagation();
    if (revealed) return;
    setRevealed(true);
    // Audit: who viewed what, and on which record. Reveal events are
    // surprisingly useful when investigating a misconduct complaint —
    // "did anyone look at this customer's IBAN before the leak?"
    logAction({
      action: 'pii.reveal',
      targetType: targetType || 'user',
      targetId,
      metadata: { field: type, by_role: role },
    });
  }

  if (inline) {
    return (
      <span
        className={`pii-mask pii-mask--inline pii-mask--${type}${revealed ? ' pii-mask--revealed' : ''} ${className}`}
        title={revealed ? 'Click to hide' : 'Click to reveal (logged)'}
        onClick={revealed ? () => setRevealed(false) : handleReveal}
      >
        {display}
      </span>
    );
  }

  return (
    <button
      type="button"
      className={`pii-mask pii-mask--chip pii-mask--${type}${revealed ? ' pii-mask--revealed' : ''} ${className}`}
      onClick={revealed ? () => setRevealed(false) : handleReveal}
      title={revealed ? 'Click to hide' : 'Click to reveal — this view is logged'}
    >
      <span className="pii-mask__value">{display}</span>
      {!revealed && (
        <svg className="pii-mask__icon" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      )}
    </button>
  );
}
