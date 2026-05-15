import { supabase } from '../../lib/supabase';

/* ─────────────────────────────────────────────────────────────────────
 * Admin auth API — thin wrappers around supabase.auth + the
 * bootstrap-admin edge function. The UI never talks to Supabase Auth
 * directly so we can centralise the bootstrap flow + error mapping.
 * ───────────────────────────────────────────────────────────────────── */

/* Email + password signup. Sends a 6-digit OTP code to the inbox; the
 * user enters it via verifyEmailOtp() on the next screen. */
export async function signUpWithEmail(email, password) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      // Don't redirect; we handle verification inline with the OTP code.
      emailRedirectTo: window.location.origin + '/admin',
    },
  });
  if (error) throw error;
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
    options: { emailRedirectTo: window.location.origin + '/admin' },
  });
  if (error) throw error;
}

export async function signInWithGoogle() {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin + '/admin' },
  });
  if (error) throw error;
  return data;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function sendPasswordReset(email) {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin + '/admin#reset',
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
