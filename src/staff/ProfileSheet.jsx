import { useRef, useState } from 'react';
import { Camera, LogOut, Mail, MapPin, Pencil } from 'lucide-react';
import Sheet from './Sheet';
import Avatar from './Avatar';
import { errorText, staffCall, uploadAvatar } from './staffApi';

/* The person's own details: photo, name and email. A new email address is
 * confirmed with a code sent to it. */
export default function ProfileSheet({ open, me, userId, onClose, onUpdated, onSignOut }) {
  const file = useRef(null);
  const [name, setName] = useState(me?.profile?.name || '');
  const [savingName, setSavingName] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [emailStep, setEmailStep] = useState('idle'); // idle | enter | code
  const [newEmail, setNewEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [note, setNote] = useState(null);

  if (!me) return null;
  const { profile, venue } = me;
  const nameChanged = name.trim() !== (profile.name || '');

  function reset() {
    setEmailStep('idle');
    setNewEmail('');
    setCode('');
    setError(null);
  }

  async function saveName(e) {
    e?.preventDefault();
    if (!nameChanged) return;
    setSavingName(true);
    setError(null);
    try {
      const res = await staffCall('update_profile', { name });
      onUpdated(res);
      setNote('Name saved.');
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSavingName(false);
    }
  }

  async function pickPhoto(e) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setPhotoBusy(true);
    setError(null);
    try {
      const url = await uploadAvatar(f, userId);
      const res = await staffCall('update_profile', { avatar_url: url });
      onUpdated(res);
      setNote('Photo saved.');
    } catch (err) {
      setError(errorText(err));
    } finally {
      setPhotoBusy(false);
    }
  }

  async function removePhoto() {
    setPhotoBusy(true);
    try {
      const res = await staffCall('update_profile', { avatar_url: null });
      onUpdated(res);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setPhotoBusy(false);
    }
  }

  async function sendEmailCode(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await staffCall('email_request', { new_email: newEmail });
      setEmailStep('code');
      setNote(null);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function confirmEmail(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await staffCall('email_verify', { code });
      onUpdated(res);
      reset();
      setNote('Email changed. Use the new address to sign in.');
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onClose={() => { reset(); setNote(null); onClose(); }} labelledBy="st-profile-title">
      <div className="st-profile-head">
        <button
          type="button"
          className="st-profile-head__photo"
          onClick={() => file.current?.click()}
          disabled={photoBusy}
          aria-label="Change profile photo"
        >
          <Avatar profile={profile} size={84} />
          <span className="st-profile-head__cam">{photoBusy ? <span className="st-spin" /> : <Camera size={15} aria-hidden="true" />}</span>
        </button>
        <input ref={file} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={pickPhoto} />
        <h2 className="st-sheet__title" id="st-profile-title">{profile.name || 'Your profile'}</h2>
        <p className="st-profile-head__venue"><MapPin size={13} aria-hidden="true" />{venue.name}</p>
        {profile.avatar_url && (
          <button type="button" className="st-link" onClick={removePhoto} disabled={photoBusy}>Remove photo</button>
        )}
      </div>

      <form className="st-form" onSubmit={saveName}>
        <label className="st-field">
          <span className="st-field__label">Name</span>
          <div className="st-field__row">
            <input
              className="st-input"
              value={name}
              maxLength={60}
              placeholder="Your name"
              autoComplete="name"
              onChange={e => { setName(e.target.value); setNote(null); }}
            />
            {nameChanged && (
              <button type="submit" className="st-btn st-btn--primary st-btn--small" disabled={savingName}>
                {savingName ? 'Saving…' : 'Save'}
              </button>
            )}
          </div>
        </label>
      </form>

      <div className="st-field">
        <span className="st-field__label">Email</span>
        {emailStep === 'idle' && (
          <div className="st-field__static">
            <Mail size={16} aria-hidden="true" />
            <span className="st-field__value">{profile.email}</span>
            <button type="button" className="st-link" onClick={() => { setEmailStep('enter'); setNote(null); }}>
              <Pencil size={13} aria-hidden="true" /> Change
            </button>
          </div>
        )}
        {emailStep === 'enter' && (
          <form className="st-form st-form--inline" onSubmit={sendEmailCode}>
            <input
              className="st-input"
              type="email"
              inputMode="email"
              autoComplete="email"
              placeholder="New email address"
              value={newEmail}
              onChange={e => setNewEmail(e.target.value)}
              autoFocus
              required
            />
            <p className="st-help">We send a 6-digit code to the new address.</p>
            <div className="st-confirm__row">
              <button type="button" className="st-btn st-btn--quiet" onClick={reset} disabled={busy}>Cancel</button>
              <button type="submit" className="st-btn st-btn--primary" disabled={busy || !newEmail.trim()}>
                {busy ? 'Sending…' : 'Send code'}
              </button>
            </div>
          </form>
        )}
        {emailStep === 'code' && (
          <form className="st-form st-form--inline" onSubmit={confirmEmail}>
            <p className="st-help">Enter the code we sent to <b>{newEmail.trim().toLowerCase()}</b>.</p>
            <input
              className="st-input st-input--code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={6}
              placeholder="000000"
              value={code}
              onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
              autoFocus
              aria-label="Code from the email"
            />
            <div className="st-confirm__row">
              <button type="button" className="st-btn st-btn--quiet" onClick={reset} disabled={busy}>Cancel</button>
              <button type="submit" className="st-btn st-btn--primary" disabled={busy || code.length !== 6}>
                {busy ? 'Checking…' : 'Confirm'}
              </button>
            </div>
          </form>
        )}
      </div>

      {error && <p className="st-alert" role="alert">{error}</p>}
      {note && !error && <p className="st-note" role="status">{note}</p>}

      <div className="st-sheet__actions">
        <button type="button" className="st-btn st-btn--quiet" onClick={onSignOut}>
          <LogOut size={17} aria-hidden="true" />
          Sign out
        </button>
      </div>
    </Sheet>
  );
}
