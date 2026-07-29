import { supabase } from '../../lib/supabase';

/* ─────────────────────────────────────────────────────────────────────
 * Admin auth API — thin wrappers around supabase.auth + the
 * bootstrap-admin edge function. The UI never talks to Supabase Auth
 * directly so we can centralise the bootstrap flow + error mapping.
 * ───────────────────────────────────────────────────────────────────── */

/* Canonical admin console URL. Auth emails (verification, magic link,
 * password reset) must send the user here and NOT to window.location.origin:
 * an admin who requests a reset from a localhost/preview build would
 * otherwise get a link back to localhost. This value must also be listed in
 * the Supabase Auth "Site URL" + "Redirect URLs" allow-list, or GoTrue
 * silently falls back to the (possibly stale) Site URL. */
const ADMIN_ORIGIN = 'https://perks.packback.network';
function adminUrl(suffix = '') {
  return ADMIN_ORIGIN + '/admin' + suffix;
}

/* Email + password signup. Sends a 6-digit OTP code to the inbox; the
 * user enters it via verifyEmailOtp() on the next screen. */
export async function signUpWithEmail(email, password) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      // Don't redirect; we handle verification inline with the OTP code.
      emailRedirectTo: adminUrl(),
    },
  });
  if (error) throw error;
  // Supabase returns a user with an EMPTY `identities` array when the email is
  // already registered — and, for that case, signUp does NOT send a fresh
  // code. So an existing admin who tries to "create account" would sit on the
  // verify screen forever. Detect it and send a login OTP instead, so they get
  // a 6-digit code and sign straight in.
  const alreadyExists = !!data?.user
    && Array.isArray(data.user.identities)
    && data.user.identities.length === 0;
  if (alreadyExists) {
    const { error: otpErr } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false, emailRedirectTo: adminUrl() },
    });
    if (otpErr) throw otpErr;
  }
  return data;
}

export async function verifyEmailOtp(email, token) {
  const { data, error } = await supabase.auth.verifyOtp({
    email,
    token,
    type: 'email',
  });
  if (error) throw error;
  return data;
}

/* Resend verification email if the user lost it. */
export async function resendEmailOtp(email) {
  const { error } = await supabase.auth.resend({ type: 'signup', email });
  if (error) throw error;
}

export async function signInWithEmail(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

/* Send a magic link / OTP without password — useful for password-less
 * login + as a fallback when the user forgets. */
export async function signInWithMagicLink(email) {
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: adminUrl() },
  });
  if (error) throw error;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function sendPasswordReset(email) {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: adminUrl('#reset'),
  });
  if (error) throw error;
}

export async function updatePassword(newPassword) {
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw error;
}

export async function updateEmail(newEmail) {
  const { error } = await supabase.auth.updateUser({ email: newEmail });
  if (error) throw error;
}

/* Calls the bootstrap-admin edge function. Triggers row creation in
 * admin_profiles on first call and returns the existing row on every
 * subsequent call. Idempotent. */
export async function bootstrapAdmin() {
  const { data, error } = await supabase.functions.invoke('bootstrap-admin', {
    body: {},
  });
  if (error) {
    let payload = null;
    try { payload = await error.context?.json?.(); } catch {}
    throw Object.assign(new Error(payload?.detail || payload?.error || error.message), { detail: payload });
  }
  return data; // { profile, justCreated }
}

export async function updateMyProfile(updates) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('not_signed_in');
  const { data, error } = await supabase
    .from('admin_profiles')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', user.id)
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

/* Upload an avatar to admin-avatars/{userId}/{ts}.{ext} and write the
 * public URL onto the admin's profile row. Pattern mirrors the receipt
 * + cup-scan uploads. */
export async function uploadAvatar(file) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('not_signed_in');
  const ext = file.type === 'image/png' ? 'png' : 'jpg';
  const path = `${user.id}/${Date.now()}.${ext}`;
  const { error: upErr } = await supabase.storage
    .from('admin-avatars')
    .upload(path, file, { contentType: file.type, upsert: true });
  if (upErr) throw upErr;
  const { data: publicData } = supabase.storage
    .from('admin-avatars')
    .getPublicUrl(path);
  return publicData?.publicUrl ?? null;
}
