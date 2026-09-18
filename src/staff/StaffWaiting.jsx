import { useState } from 'react';
import { Hourglass } from 'lucide-react';
import logo from '../assets/images/packperks-logo.svg';
import VenuePicker from './VenuePicker';
import { errorText, staffCall } from './staffApi';

/* Signed in, but not making codes yet: either the request to join a venue
 * waits for approval, or this login is on no staff list and can ask. */
export default function StaffWaiting({ state, onCheck, onSignOut }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [checked, setChecked] = useState(false);
  const venues = state.venues || [];
  const [orgId, setOrgId] = useState(venues.length === 1 ? venues[0].id : null);

  async function run(fn) {
    setBusy(true);
    setError(null);
    try { await fn(); } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }

  const check = () => run(async () => { await onCheck(); setChecked(true); });
  const join = () => run(async () => { await staffCall('join', { org_id: orgId }); await onCheck(); });

  const pending = state.kind === 'pending';
  const since = state.requested_at
    ? new Date(state.requested_at).toLocaleDateString([], { day: 'numeric', month: 'long' })
    : null;

  return (
    <div className="st-login">
      <header className="st-brand">
        <img src={logo} alt="PackPerks" className="st-brand__logo" />
        <span className="st-brand__rule" aria-hidden="true" />
        <span className="st-brand__app">Staff</span>
      </header>

      <main className="st-login__card">
        {pending ? (
          <>
            <div className="st-wait">
              {state.venue?.logo_url
                ? <img src={state.venue.logo_url} alt={state.venue.name} className="st-wait__logo" />
                : <span className="st-wait__icon"><Hourglass size={24} aria-hidden="true" /></span>}
            </div>
            <div className="st-login__head">
              <h1 className="st-login__title">Waiting for approval</h1>
              <p className="st-login__sub">
                You asked to join <b>{state.venue?.name || 'the venue'}</b>{since ? <> on {since}</> : null}.
                Someone who runs it approves staff on the PackPerks dashboard. We email <b>{state.email}</b> when you are in.
              </p>
            </div>
            {error && <p className="st-alert" role="alert">{error}</p>}
            {checked && !error && <p className="st-hint" role="status">Not approved yet.</p>}
            <button type="button" className="st-btn st-btn--primary st-btn--big" onClick={check} disabled={busy}>
              {busy ? <span className="st-spin st-spin--light" /> : null}
              {busy ? 'Checking…' : 'Check again'}
            </button>
          </>
        ) : (
          <>
            <div className="st-login__head">
              <h1 className="st-login__title">Where do you work?</h1>
              <p className="st-login__sub">
                <b>{state.email}</b> is not on a staff list yet.{' '}
                {state.trusted
                  ? 'PackBack addresses get access straight away.'
                  : 'Pick your venue and we ask the people who run it to let you in.'}
              </p>
            </div>
            <VenuePicker venues={venues} value={orgId} onChange={setOrgId} disabled={busy} />
            {error && <p className="st-alert" role="alert">{error}</p>}
            <button type="button" className="st-btn st-btn--primary st-btn--big" onClick={join} disabled={busy || !orgId}>
              {busy ? <span className="st-spin st-spin--light" /> : null}
              {state.trusted ? 'Join' : 'Ask to join'}
            </button>
          </>
        )}
        <div className="st-login__foot">
          <button type="button" className="st-link" onClick={onSignOut}>Sign out</button>
        </div>
      </main>

      <p className="st-login__legal">PackPerks by PackBack</p>
    </div>
  );
}
