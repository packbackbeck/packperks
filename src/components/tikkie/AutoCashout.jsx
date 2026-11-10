import { useEffect, useRef, useState } from 'react';
import { Sheet } from './TikkieBits';
import { AUTO_TIERS, TIER_BY_KEY, bonusOn } from '../../lib/autoCashout';
import './AutoCashout.css';

/* ─────────────────────────────────────────────────────────────────────
 * Automatic cashout, on the Deferred Refund wallet's home screen.
 *
 * A slider with four stops: Off, 1 week, 1 month, 3 months. Off is the
 * wallet as it always was, so a Claim deposit button appears there. Any
 * other stop means we email a Tikkie link for the whole balance on that
 * schedule, with the venue's bonus on top when it offers one
 * (lib/autoCashout.js). The ? opens AutoCashoutHelp.
 *
 * The slider moves at once and says what it is about to do; the choice is
 * sent once it has stood still for a moment, so dragging across three
 * stops is one save, not three. The parent owns the saving and the
 * schedule the server answers with (`tier`, `nextAt`).
 * ───────────────────────────────────────────────────────────────────── */

const STOPS = ['off', ...AUTO_TIERS.map(t => t.key)];
const SETTLE_MS = 450;

const stopLabel = (k) => (k === 'off' ? 'Off' : TIER_BY_KEY[k].label);

function fmtDay(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

export default function AutoCashout({
  config, tier, nextAt, email, balance, owed, money, saving, claiming,
  isLinkPayout, accent, unverified = false, onChange, onClaim, onHelp, onConfirm,
}) {
  const committed = tier || 'off';
  const indexOf = (k) => Math.max(0, STOPS.indexOf(k));
  const [pos, setPos] = useState(indexOf(committed));
  // The server's answer (or a revert) moves the slider back into line.
  const [seen, setSeen] = useState(committed);
  if (committed !== seen) {
    setSeen(committed);
    setPos(indexOf(committed));
  }
  const timer = useRef(null);
  const committedRef = useRef(committed);
  useEffect(() => { committedRef.current = committed; }, [committed]);
  useEffect(() => () => clearTimeout(timer.current), []);

  function move(i, now = false) {
    setPos(i);
    clearTimeout(timer.current);
    const send = () => { if (STOPS[i] !== committedRef.current) onChange(STOPS[i]); };
    if (now) send();
    else timer.current = setTimeout(send, SETTLE_MS);
  }

  const key = STOPS[pos];
  const t = key === 'off' ? null : TIER_BY_KEY[key];
  const pct = t ? config.bonus[key] : 0;
  const settled = key === committed;

  return (
    <section className="tikkie-home__section ac" style={accent ? { '--ac-accent': accent } : undefined}>
      <div className="ac__head">
        <h2 className="tikkie-home__section-title ac__title">Automatic cashout</h2>
        <button type="button" className="ac__help" onClick={onHelp} aria-label="How automatic cashout works">?</button>
      </div>

      <div className="ac__card">
        <div className="ac__state">
          <div className="ac__state-main">
            <span className="ac__state-value">{t ? `Every ${t.label.replace(/^1 /, '')}` : 'Off'}</span>
            <span className="ac__state-sub" aria-live="polite">
              {saving ? 'Saving…'
                : t ? 'We email you a Tikkie link for your whole balance.'
                  : 'Claim your deposit yourself, whenever you like.'}
            </span>
          </div>
          {pct > 0 && <span className="ac__pill">+{pct}% bonus</span>}
        </div>

        <div className="ac__slider" style={{ '--ac-fill': `${(pos / (STOPS.length - 1)) * 100}%` }}>
          <div className="ac__track" aria-hidden="true">
            <span className="ac__track-fill" />
            {STOPS.map((k, i) => (
              <span key={k} className={`ac__dot${i <= pos ? ' ac__dot--on' : ''}`} style={{ left: `${(i / (STOPS.length - 1)) * 100}%` }} />
            ))}
          </div>
          <input
            type="range"
            className="ac__range"
            min={0}
            max={STOPS.length - 1}
            step={1}
            value={pos}
            disabled={saving}
            aria-label="How often to cash out automatically"
            aria-valuetext={t ? `Every ${t.label}` : 'Off'}
            onChange={e => move(Number(e.target.value))}
          />
        </div>
        <div className="ac__stops">
          {STOPS.map((k, i) => (
            <button
              key={k}
              type="button"
              className={`ac__stop${i === pos ? ' ac__stop--on' : ''}`}
              style={{ '--at': `${(i / (STOPS.length - 1)) * 100}%` }}
              onClick={() => move(i, true)}
              disabled={saving}
              tabIndex={-1}
            >
              <span>{stopLabel(k)}</span>
              {config.bonusOn && k !== 'off' && config.bonus[k] > 0 && (
                <span className="ac__stop-bonus">+{config.bonus[k]}%</span>
              )}
            </button>
          ))}
        </div>

        {key === 'off' ? (
          <button
            type="button"
            className={`ac__claim ${isLinkPayout ? 'ac__claim--tikkie' : 'ac__claim--collect'}`}
            onClick={onClaim}
            disabled={claiming || !(owed > 0)}
          >
            {claiming ? 'Preparing…' : owed > 0 ? `Claim deposit · ${money(owed)}` : 'Nothing to claim yet'}
          </button>
        ) : (
          <ul className="ac__plan">
            <li>
              <span className="ac__plan-icon" aria-hidden="true">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="3.5" y="5" width="17" height="15.5" rx="2.5" /><path d="M3.5 10h17M8 3v4M16 3v4" /></svg>
              </span>
              <span>
                {settled && nextAt
                  ? <>Next cashout <b>{fmtDay(nextAt)}</b></>
                  : <>First cashout in <b>{t.label}</b></>}
              </span>
            </li>
            <li className={unverified ? 'ac__plan-warn' : undefined}>
              <span className="ac__plan-icon" aria-hidden="true">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="m3.5 6.5 8.5 6.5 8.5-6.5" /></svg>
              </span>
              <span className="ac__plan-email">
                {unverified
                  ? <>Confirm <b>{email}</b> to keep getting the link</>
                  : email ? <>The link goes to <b>{email}</b></> : <>Add and confirm your email to get the link</>}
              </span>
              {unverified && (
                <button type="button" className="ac__confirm" onClick={onConfirm} disabled={saving}>Confirm</button>
              )}
            </li>
            {pct > 0 && balance > 0 && (
              <li className="ac__plan-bonus">
                <span className="ac__plan-icon" aria-hidden="true">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="3.5" y="9" width="17" height="11.5" rx="2" /><path d="M2.5 9h19v-3h-19zM12 6v14.5M12 6c-1.5-3.5-6-3.5-6-1s4.5 1 6 1zm0 0c1.5-3.5 6-3.5 6-1s-4.5 1-6 1z" /></svg>
                </span>
                <span>Your {money(balance)} now would come with <b>{money(bonusOn(balance, pct))}</b> extra</span>
              </li>
            )}
          </ul>
        )}
      </div>
    </section>
  );
}

/* ── The ? sheet: how it works, and why it is worth choosing. ── */
const EXAMPLE = 10;

export function AutoCashoutHelp({ config, money, onClose }) {
  const bars = [{ key: 'off', label: 'Off', pct: 0 }, ...AUTO_TIERS.map(t => ({ key: t.key, label: t.label, pct: config.bonus[t.key] }))];
  const top = Math.max(...bars.map(b => b.pct));
  return (
    <Sheet onClose={onClose} label="How automatic cashout works">
      <div className="ach">
        <ol className="ach__steps" aria-label="How it works">
          <li className="ach__step">
            <span className="ach__step-icon ach__step-icon--cup" aria-hidden="true">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5.5 6.5h13l-1.6 13.2a1.5 1.5 0 0 1-1.5 1.3H8.6a1.5 1.5 0 0 1-1.5-1.3z" /><path d="M4.5 6.5h15M8 3.5h8" /><path d="M9.5 12.5h5" /></svg>
            </span>
            <b>Return cups</b>
            <span>Every receipt adds to your deposit.</span>
          </li>
          <li className="ach__step">
            <span className="ach__step-icon ach__step-icon--cal" aria-hidden="true">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3.5" y="5" width="17" height="15.5" rx="2.5" /><path d="M3.5 10h17M8 3v4M16 3v4" /><path d="m9 15 2 2 4-4" /></svg>
            </span>
            <b>Your day comes</b>
            <span>Every week, month or 3 months.</span>
          </li>
          <li className="ach__step">
            <span className="ach__step-icon ach__step-icon--mail" aria-hidden="true">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="m3.5 6.5 8.5 6.5 8.5-6.5" /></svg>
            </span>
            <b>Link in your inbox</b>
            <span>Tap it, and Tikkie pays you.</span>
          </li>
        </ol>

        <h2 className="tk-sheet__title">Your deposit, sent to you</h2>
        <p className="tk-sheet__sub">
          Pick how often and we email you a Tikkie link for your whole balance.
          No link to ask for and no details to fill in each time.
        </p>

        {config.bonusOn && top > 0 && (
          <div className="ach__bonus">
            <p className="ach__bonus-title">Wait longer, get more</p>
            <div className="ach__bars" role="img" aria-label={`A ${money(EXAMPLE)} deposit becomes ${bars.map(b => `${money(EXAMPLE + bonusOn(EXAMPLE, b.pct))} ${b.key === 'off' ? 'when you claim it yourself' : `every ${b.label}`}`).join(', ')}`}>
              {bars.map(b => (
                <div key={b.key} className={`ach__bar${b.key === 'off' ? ' ach__bar--off' : ''}`}>
                  <span className="ach__bar-value">{money(EXAMPLE + bonusOn(EXAMPLE, b.pct))}</span>
                  <span className="ach__bar-col" style={{ height: `${40 + (top ? (b.pct / top) * 52 : 0)}px` }}>
                    {b.pct > 0 && <span className="ach__bar-pct">+{b.pct}%</span>}
                  </span>
                  <span className="ach__bar-label">{b.label}</span>
                </div>
              ))}
            </div>
            <p className="ach__bonus-note">For a {money(EXAMPLE)} deposit. The bonus is added to the link.</p>
          </div>
        )}

        <ul className="ach__why">
          <li>Change it or stop it any time with the slider.</li>
          <li>Drag it to Off to claim your deposit yourself.</li>
        </ul>

        <button type="button" className="tk-btn tk-btn--primary tk-btn--full" onClick={onClose}>Got it</button>
      </div>
    </Sheet>
  );
}

/* ── Confirm the email before a tier is saved: the link goes there, so the
 * address has to be the customer's own (auto-cashout `verify`). ── */
export function AutoCashoutVerify({ email, onVerify, onResend, onClose }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [resent, setResent] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (busy || code.length !== 6) return;
    setBusy(true);
    setErr(null);
    const problem = await onVerify(code);
    setBusy(false);
    if (problem) setErr(problem);
  }

  async function resend() {
    setBusy(true);
    setErr(null);
    const ok = await onResend();
    setBusy(false);
    setCode('');
    if (ok) setResent(true);
    else setErr('We couldn’t send a new code just now. Please try again in a minute.');
  }

  return (
    <Sheet onClose={busy ? undefined : onClose} label="Confirm your email">
      <h2 className="tk-sheet__title">Confirm your email</h2>
      <p className="tk-sheet__sub">
        {resent ? 'A new code is on its way to ' : 'Enter the 6-digit code we sent to '}<strong>{email}</strong>.
      </p>
      <form onSubmit={submit} className="tk-sheet__stack tk-sheet__stack--spaced">
        <input
          className="tk-input acv__code"
          inputMode="numeric"
          autoComplete="one-time-code"
          aria-label="6-digit code"
          placeholder="••••••"
          maxLength={6}
          value={code}
          onChange={e => { setCode(e.target.value.replace(/\D/g, '').slice(0, 6)); setErr(null); }}
          disabled={busy}
          autoFocus
        />
        {err && <p className="tk-err">{err}</p>}
        <button type="submit" className="tk-btn tk-btn--primary tk-btn--full" disabled={busy || code.length !== 6}>
          {busy ? 'Checking…' : 'Confirm'}
        </button>
        <button type="button" className="tk-btn tk-btn--full" onClick={resend} disabled={busy}>
          Send a new code
        </button>
      </form>
    </Sheet>
  );
}
