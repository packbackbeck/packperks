import { createClient } from '@supabase/supabase-js';

/* ─────────────────────────────────────────────────────────────────────
 * PackPerks Staff talks to Supabase through its own client, with its own
 * storage key, so a staff login never mixes with a dashboard or customer
 * session in the same browser. Everything except sign-in and the profile
 * picture upload goes through the `staff-app` edge function.
 * ───────────────────────────────────────────────────────────────────── */

const URL = import.meta.env.VITE_SUPABASE_URL;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const staffSupabase = createClient(URL, KEY, {
  auth: {
    storageKey: 'pp-staff-auth',
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});

export class StaffError extends Error {
  constructor(code, detail, status, data) {
    super(code);
    this.code = code;
    this.detail = detail;
    this.status = status;
    this.data = data || {};
  }
}

export async function staffCall(action, body = {}) {
  const { data: { session } } = await staffSupabase.auth.getSession();
  let res;
  try {
    res = await fetch(`${URL}/functions/v1/staff-app`, {
      method: 'POST',
      headers: {
        apikey: KEY,
        'content-type': 'application/json',
        ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}),
      },
      body: JSON.stringify({ action, ...body }),
    });
  } catch {
    throw new StaffError('offline');
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new StaffError(json.error || 'server_error', json.detail, res.status, json);
  return json;
}

export async function signIn(email, password) {
  const { error } = await staffSupabase.auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password,
  });
  if (error) {
    throw new StaffError(/invalid login/i.test(error.message) ? 'bad_login' : 'sign_in_failed', error.message);
  }
}

export function signOut() {
  return staffSupabase.auth.signOut();
}

/* Shrinks a photo to a square 512px JPEG and stores it in the person's
 * own folder. Returns the public URL. */
export async function uploadAvatar(file, userId) {
  const blob = await squareJpeg(file, 512);
  const path = `${userId}/${Date.now()}.jpg`;
  const { error } = await staffSupabase.storage
    .from('staff-avatars')
    .upload(path, blob, { contentType: 'image/jpeg', upsert: false });
  if (error) throw new StaffError('upload_failed', error.message);
  return staffSupabase.storage.from('staff-avatars').getPublicUrl(path).data.publicUrl;
}

function squareJpeg(file, size) {
  return new Promise((resolve, reject) => {
    const url = window.URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const side = Math.min(img.naturalWidth, img.naturalHeight);
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(
        img,
        (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side,
        0, 0, size, size,
      );
      window.URL.revokeObjectURL(url);
      canvas.toBlob(b => (b ? resolve(b) : reject(new StaffError('upload_failed'))), 'image/jpeg', 0.86);
    };
    img.onerror = () => { window.URL.revokeObjectURL(url); reject(new StaffError('bad_image')); };
    img.src = url;
  });
}

/* What people read when something goes wrong. */
const MESSAGES = {
  offline: 'No connection. Check your internet and try again.',
  bad_login: 'That email and password do not match.',
  sign_in_failed: 'Signing in did not work. Try again.',
  invalid_email: 'Enter a valid email address.',
  not_on_list: 'This email is not on a staff list yet. Pick your venue to ask for access.',
  pending_approval: 'Your request is waiting for approval. Sign in to check on it.',
  no_venues: 'No venue runs the staff app right now.',
  blocked: 'This staff account is paused. Ask your manager.',
  already_signed_up: 'This email already has an account. Sign in instead.',
  app_off: 'The staff app is not switched on for this venue.',
  not_staff: 'This login is not a staff account yet.',
  rate_limited: 'Too many tries. Wait a few minutes and try again.',
  code_invalid: 'That code is not right. Check the email and try again.',
  code_expired: 'That code has expired. Send a new one.',
  too_many_attempts: 'Too many wrong codes. Send a new one.',
  weak_password: 'Use at least 8 characters for your password.',
  email_failed: 'We could not send the email. Try again in a minute.',
  email_taken: 'That email address is already in use.',
  same_email: 'That is already your email address.',
  invalid_cups: 'Pick between 1 and 5 cups.',
  invalid_package: 'Pick a package type.',
  mint_failed: 'The code could not be made. Try again.',
  upload_failed: 'The photo could not be uploaded. Try another one.',
  bad_image: 'That file is not a photo we can use.',
  invalid_avatar: 'The photo could not be saved.',
  invalid_token: 'You were signed out. Sign in again.',
  missing_token: 'You were signed out. Sign in again.',
};

export function errorText(err) {
  if (err?.code === 'daily_limit') {
    return `You reached today's limit.${err.detail ? ` ${err.detail}.` : ''}`;
  }
  return MESSAGES[err?.code] || 'Something went wrong. Try again.';
}

/* ── Formatting ────────────────────────────────────────────────────── */
export const cupsLabel = (n) => `${n} ${n === 1 ? 'cup' : 'cups'}`;

export const PACKAGE_LABEL = { cup: 'Cups' };

export function timeLabel(iso) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function dateTimeLabel(iso) {
  const d = new Date(iso);
  return `${dayLabel(iso)}, ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

export function dayLabel(iso) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
}

export function countdown(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export const STATUS_META = {
  waiting: { label: 'Waiting', tone: 'violet' },
  claimed: { label: 'Collected', tone: 'green' },
  partly_claimed: { label: 'Partly collected', tone: 'amber' },
  expired: { label: 'Expired', tone: 'grey' },
  cancelled: { label: 'Cancelled', tone: 'grey' },
};
