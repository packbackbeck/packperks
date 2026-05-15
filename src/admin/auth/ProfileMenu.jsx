import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from './AuthContext';
import { sendPasswordReset, updateEmail, updateMyProfile, uploadAvatar } from './authApi';
import './ProfileMenu.css';

/* Compact dropdown menu anchored to the admin top bar. Shows the
 * signed-in user's avatar + name, exposes "Edit profile", "Change
 * email", "Reset password" (sends an email link to the current
 * address), and "Sign out". */
export default function ProfileMenu() {
  const { profile, signOut, setProfile } = useAuth();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState('menu'); // 'menu' | 'profile' | 'email' | 'password'
  const rootRef = useRef(null);
  const dropdownRef = useRef(null);

  /* Portal-positioned dropdown.
   *
   * The dropdown used to be a child of the sidebar's footer DOM, which
   * meant it inherited `overflow-y: auto` from `.admin-sidebar` and
   * got visually clipped when it stuck out. Even bumping z-index
   * couldn't fix it because the sidebar establishes its own stacking
   * context.
   *
   * We now render the dropdown into `document.body` via createPortal,
   * with absolute pixel coordinates derived from the trigger's
   * `getBoundingClientRect()`. Re-measured on open + on resize so the
   * dropdown follows the trigger if the window changes.
   *
   * `position` is computed top-left of the dropdown. We position the
   * dropdown above the trigger (since it lives in the sidebar footer
   * at the bottom of the viewport), aligned to the trigger's left
   * edge. */
  const [coords, setCoords] = useState(null);
  useLayoutEffect(() => {
    if (!open) { setCoords(null); return; }
    function measure() {
      const rect = rootRef.current?.getBoundingClientRect();
      if (!rect) return;
      // Position the dropdown above the trigger with a 6px gap, aligned
      // to the trigger's left edge. Width is fixed in CSS at 280px.
      const dropdownH = dropdownRef.current?.offsetHeight ?? 280;
      setCoords({
        left: Math.max(8, rect.left),
        top:  Math.max(8, rect.top - dropdownH - 6),
      });
    }
    measure();
    // Re-measure after the dropdown actually renders (we need its
    // height to position above the trigger).
    requestAnimationFrame(measure);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [open, view]);

  // Close on outside click / Escape. We check both the trigger root
  // AND the portaled dropdown — they're in different DOM subtrees now.
  useEffect(() => {
    if (!open) return;
    function onClick(e) {
      if (rootRef.current?.contains(e.target)) return;
      if (dropdownRef.current?.contains(e.target)) return;
      setOpen(false); setView('menu');
    }
    function onKey(e) {
      if (e.key === 'Escape') { setOpen(false); setView('menu'); }
    }
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!profile) return null;
  const initials = (profile.display_name || profile.email)[0].toUpperCase();

  return (
    <div className="pm" ref={rootRef}>
      <button
        type="button"
        className="pm__trigger"
        onClick={() => { setOpen(o => !o); setView('menu'); }}
        title={profile.display_name || profile.email}
      >
        <span className="pm__avatar" style={{ background: profile.color || '#FD6F46' }}>
          {profile.avatar_url
            ? <img src={profile.avatar_url} alt="" />
            : initials}
        </span>
        <span className="pm__name">
          <span className="pm__name-display">{profile.display_name || profile.email.split('@')[0]}</span>
          <span className="pm__name-role">{profile.role}</span>
        </span>
        <svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 8L10 13L15 8"/>
        </svg>
      </button>

      {open && createPortal(
        <div
          className="pm__dropdown pm__dropdown--portal"
          ref={dropdownRef}
          style={coords ? { left: coords.left, top: coords.top, right: 'auto', bottom: 'auto' } : { visibility: 'hidden' }}
        >
          {view === 'menu' && (
            <MenuView
              profile={profile}
              onEditProfile={() => setView('profile')}
              onChangeEmail={() => setView('email')}
              onResetPassword={() => setView('password')}
              onSignOut={async () => { setOpen(false); await signOut(); }}
            />
          )}
          {view === 'profile' && (
            <EditProfileView
              profile={profile}
              setProfile={setProfile}
              onBack={() => setView('menu')}
            />
          )}
          {view === 'email' && (
            <ChangeEmailView
              currentEmail={profile.email}
              onBack={() => setView('menu')}
            />
          )}
          {view === 'password' && (
            <ResetPasswordView
              email={profile.email}
              onBack={() => setView('menu')}
            />
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}

function MenuView({ profile, onEditProfile, onChangeEmail, onResetPassword, onSignOut }) {
  return (
    <>
      <div className="pm__header">
        <span className="pm__h-avatar" style={{ background: profile.color || '#FD6F46' }}>
          {profile.avatar_url
            ? <img src={profile.avatar_url} alt="" />
            : (profile.display_name || profile.email)[0].toUpperCase()}
        </span>
        <div className="pm__h-info">
          <div className="pm__h-name">{profile.display_name || '—'}</div>
          <div className="pm__h-email">{profile.email}</div>
          <span className="pm__h-role">{profile.role}</span>
        </div>
      </div>

      <div className="pm__divider" />

      <button className="pm__item" onClick={onEditProfile}>
        <span className="pm__item-icon" aria-hidden>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
          </svg>
        </span>
        Edit profile
      </button>
      <button className="pm__item" onClick={onChangeEmail}>
        <span className="pm__item-icon" aria-hidden>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="4" width="20" height="16" rx="2" />
            <path d="m22 7-10 5L2 7" />
          </svg>
        </span>
        Change email
      </button>
      <button className="pm__item" onClick={onResetPassword}>
        <span className="pm__item-icon" aria-hidden>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        </span>
        Reset password
      </button>

      <div className="pm__divider" />

      <button className="pm__item pm__item--danger" onClick={onSignOut}>
        <span className="pm__item-icon" aria-hidden>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
        </span>
        Sign out
      </button>
    </>
  );
}

const COLOR_OPTIONS = ['#FD6F46', '#FF7A2E', '#FFC52F', '#1A8737', '#5333A5', '#7C3AED', '#C2185B', '#0F172A'];

function EditProfileView({ profile, setProfile, onBack }) {
  const fileRef = useRef(null);
  const [name, setName]       = useState(profile.display_name || '');
  const [color, setColor]     = useState(profile.color || '#FD6F46');
  const [avatar, setAvatar]   = useState(profile.avatar_url || '');
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving]   = useState(false);
  const [err, setErr]         = useState(null);
  const [info, setInfo]       = useState(null);

  async function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setErr(null); setUploading(true);
    try {
      const url = await uploadAvatar(file);
      if (url) setAvatar(url);
    } catch (ex) { setErr(ex.message); }
    finally { setUploading(false); e.target.value = ''; }
  }

  async function handleSave() {
    setErr(null); setInfo(null); setSaving(true);
    try {
      const updated = await updateMyProfile({
        display_name: name.trim() || null,
        color,
        avatar_url: avatar || null,
      });
      setProfile(updated);
      setInfo('Saved.');
      setTimeout(() => onBack(), 600);
    } catch (ex) { setErr(ex.message); }
    finally { setSaving(false); }
  }

  return (
    <>
      <SubHeader title="Edit profile" onBack={onBack} />
      <div className="pm__form">
        <div className="pm__form-row">
          <span className="pm__form-avatar" style={{ background: color }}>
            {avatar
              ? <img src={avatar} alt="" />
              : (name || profile.email)[0].toUpperCase()}
          </span>
          <button type="button" className="pm__form-btn" onClick={() => fileRef.current?.click()} disabled={uploading}>
            {uploading ? 'Uploading…' : avatar ? 'Change photo' : 'Upload photo'}
          </button>
          <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFile} />
        </div>

        <label className="pm__field">
          <span>Display name</span>
          <input type="text" value={name} onChange={e => setName(e.target.value)} maxLength={80} />
        </label>

        <div className="pm__field">
          <span>Profile colour</span>
          <div className="pm__colors">
            {COLOR_OPTIONS.map(c => (
              <button
                key={c}
                type="button"
                className={`pm__color${color === c ? ' pm__color--active' : ''}`}
                style={{ background: c }}
                onClick={() => setColor(c)}
                aria-label={`Pick ${c}`}
              />
            ))}
          </div>
        </div>

        {err && <p className="pm__err">{err}</p>}
        {info && <p className="pm__info">{info}</p>}

        <button className="pm__primary" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </>
  );
}

function ChangeEmailView({ currentEmail, onBack }) {
  const [newEmail, setNewEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState(null);
  const [info, setInfo] = useState(null);

  async function handleSubmit() {
    setErr(null); setInfo(null); setBusy(true);
    try {
      await updateEmail(newEmail.trim());
      setInfo(`Check both your old (${currentEmail}) and new (${newEmail.trim()}) inboxes — Supabase sends a confirmation link to each.`);
    } catch (ex) { setErr(ex.message); }
    finally { setBusy(false); }
  }

  return (
    <>
      <SubHeader title="Change email" onBack={onBack} />
      <div className="pm__form">
        <p className="pm__hint">
          Current: <strong>{currentEmail}</strong>
        </p>
        <label className="pm__field">
          <span>New email</span>
          <input type="email" value={newEmail} onChange={e => setNewEmail(e.target.value)} placeholder="newaddress@burgerking.nl" />
        </label>
        {err && <p className="pm__err">{err}</p>}
        {info && <p className="pm__info">{info}</p>}
        <button className="pm__primary" onClick={handleSubmit} disabled={busy || !newEmail}>
          {busy ? 'Sending…' : 'Send confirmation'}
        </button>
      </div>
    </>
  );
}

function ResetPasswordView({ email, onBack }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState(null);
  const [info, setInfo] = useState(null);

  async function handleSubmit() {
    setErr(null); setInfo(null); setBusy(true);
    try {
      await sendPasswordReset(email);
      setInfo(`Sent — check ${email} for a reset link.`);
    } catch (ex) { setErr(ex.message); }
    finally { setBusy(false); }
  }

  return (
    <>
      <SubHeader title="Reset password" onBack={onBack} />
      <div className="pm__form">
        <p className="pm__hint">
          We'll send a one-time reset link to <strong>{email}</strong>.
        </p>
        {err && <p className="pm__err">{err}</p>}
        {info && <p className="pm__info">{info}</p>}
        <button className="pm__primary" onClick={handleSubmit} disabled={busy}>
          {busy ? 'Sending…' : 'Send reset link'}
        </button>
      </div>
    </>
  );
}

function SubHeader({ title, onBack }) {
  return (
    <div className="pm__subheader">
      <button className="pm__back" onClick={onBack} aria-label="Back">
        <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 4L6 10L12 16"/>
        </svg>
      </button>
      <span className="pm__subtitle">{title}</span>
    </div>
  );
}
