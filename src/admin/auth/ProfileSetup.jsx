import { useRef, useState } from 'react';
import { useAuth } from './AuthContext';
import { updateMyProfile, uploadAvatar } from './authApi';
import packperksLogo from '../../assets/images/packperks-logo.svg';
import './ProfileSetup.css';

/* Shown once, right after first sign-in (or sign-up + verification), so
 * the brand-new admin can choose a display name, an avatar, and a
 * profile color. We don't force any of these — every field is optional
 * and they can edit them later from the profile menu. */
const COLOR_OPTIONS = [
  '#FD6F46', '#FF7A2E', '#FFC52F', '#1A8737',
  '#5333A5', '#7C3AED', '#C2185B', '#0F172A',
];

export default function ProfileSetup({ onDone }) {
  const { profile, setProfile } = useAuth();
  const fileRef = useRef(null);

  const [displayName, setDisplayName] = useState(profile?.display_name || '');
  const [color, setColor]             = useState(profile?.color || COLOR_OPTIONS[0]);
  const [avatarUrl, setAvatarUrl]     = useState(profile?.avatar_url || '');
  const [uploading, setUploading]     = useState(false);
  const [saving, setSaving]           = useState(false);
  const [err, setErr]                 = useState(null);

  async function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setErr(null);
    setUploading(true);
    try {
      const url = await uploadAvatar(file);
      if (url) setAvatarUrl(url);
    } catch (ex) {
      console.error('avatar upload failed:', ex);
      setErr('Could not upload avatar — try a different image.');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  }

  async function handleSave() {
    setErr(null);
    setSaving(true);
    try {
      const updated = await updateMyProfile({
        display_name: displayName.trim() || null,
        color,
        avatar_url: avatarUrl || null,
      });
      setProfile(updated);
      onDone?.();
    } catch (ex) {
      console.error('profile save failed:', ex);
      setErr('Could not save profile. Please try again.');
    } finally { setSaving(false); }
  }

  const initials = (displayName.trim() || profile?.email || '?')[0].toUpperCase();

  return (
    <div className="ps-page">
      <div className="ps-card">
        <header className="ps-card__header">
          <img src={packperksLogo} alt="PackPerks" className="ps-card__logo" />
          <h1 className="ps-card__title">Welcome to the team</h1>
          <p className="ps-card__sub">
            A few details so your teammates know who you are. You can change these any time.
          </p>
        </header>

        <div className="ps-avatar-row">
          <div className="ps-avatar" style={{ background: color }}>
            {avatarUrl ? (
              <img src={avatarUrl} alt="" />
            ) : (
              <span className="ps-avatar__initial">{initials}</span>
            )}
          </div>
          <div className="ps-avatar-actions">
            <button type="button" className="ps-btn ps-btn--ghost" onClick={() => fileRef.current?.click()} disabled={uploading}>
              {uploading ? 'Uploading…' : avatarUrl ? 'Change photo' : 'Upload photo'}
            </button>
            {avatarUrl && (
              <button type="button" className="ps-link" onClick={() => setAvatarUrl('')}>
                Remove
              </button>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="ps-file-input"
              onChange={handleFile}
            />
          </div>
        </div>

        <label className="ps-field">
          <span>Display name</span>
          <input
            type="text"
            value={displayName}
            onChange={e => setDisplayName(e.target.value)}
            placeholder="e.g. Jasper de Vries"
            maxLength={80}
          />
        </label>

        <div className="ps-field">
          <span>Profile colour</span>
          <p className="ps-field__hint">
            Used for your avatar tint everywhere in the dashboard.
          </p>
          <div className="ps-color-row" role="radiogroup" aria-label="Profile color">
            {COLOR_OPTIONS.map(c => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={color === c}
                aria-label={`Pick colour ${c}`}
                className={`ps-color${color === c ? ' ps-color--active' : ''}`}
                style={{ background: c }}
                onClick={() => setColor(c)}
              />
            ))}
          </div>
        </div>

        {err && <p className="ps-err">{err}</p>}

        <div className="ps-actions">
          <button type="button" className="ps-btn ps-btn--primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Continue →'}
          </button>
          <button type="button" className="ps-link ps-link--center" onClick={onDone}>
            Skip for now
          </button>
        </div>
      </div>
    </div>
  );
}
