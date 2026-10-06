/* ─────────────────────────────────────────────────────────────────────
 * tikkieWallet — the client of bin-tikkie's wallet model.
 *
 * One place for the device identity, the locally-remembered profile, and
 * every edge-function call the Deferred Tikkie home makes. Plain fetch on
 * purpose: supabase.functions.invoke serialises behind the client's auth
 * lock and a single wedged request then hangs every later call.
 * ───────────────────────────────────────────────────────────────────── */

import { getDeviceId } from './deviceId';
import { supabase } from './supabase';

const FN_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/bin-tikkie`;
const FN_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY;

/* Same device id the rest of PackPerks uses — one profile per device. */
export function deviceId() {
  return getDeviceId();
}

const PROFILE_KEY = (orgId) => `packperks_refund_user:${orgId}`;

export function readStoredProfile(orgId) {
  try { return JSON.parse(localStorage.getItem(PROFILE_KEY(orgId)) || 'null'); } catch { return null; }
}
export function storeProfile(orgId, profile) {
  try { localStorage.setItem(PROFILE_KEY(orgId), JSON.stringify(profile)); } catch { /* fine */ }
}

/* Every call, with a hard abort timeout: a request that never settles must
 * never leave a button spinning forever. Resolves to the body, or null. */
export async function invokeBinTikkie(body, timeoutMs = 15000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await fetch(FN_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${FN_ANON}`,
        apikey: FN_ANON,
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    return await resp.json().catch(() => null);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/* ── The wallet calls ── */
export const fetchWallet = (orgId) =>
  invokeBinTikkie({ action: 'wallet', org_id: orgId, device_id: deviceId() });

export const scanBatch = (batchId) =>
  invokeBinTikkie({ batch_id: batchId, device_id: deviceId() });

export const scanBackupCups = (cupIds) =>
  invokeBinTikkie({ cup_ids: cupIds, device_id: deviceId() });

/* The counter's Static QR code: one cup's refund, up to the venue's daily
 * limit per person. */
export const scanStaticQr = (orgId, locationId) =>
  invokeBinTikkie({ action: 'static_qr', org_id: orgId, device_id: deviceId(), location_id: locationId || null });

export const redeemWallet = (orgId) =>
  invokeBinTikkie({ action: 'redeem', org_id: orgId, device_id: deviceId() }, 25000);

/* Give some or all of the balance to the charity partner. The server caps
 * the amount at the balance, so a stale number can only give less. */
export const donateWallet = (orgId, amount) =>
  invokeBinTikkie({ action: 'donate', org_id: orgId, device_id: deviceId(), amount });

export const setEmail = (orgId, email, marketing) =>
  invokeBinTikkie({
    action: 'set_email', org_id: orgId, device_id: deviceId(),
    email, privacy_accepted: true, marketing_consent: marketing === true,
  });

/* ── Marketing consent ──
 * The wallet call does not carry it, and the account view's switch has to
 * show the truth rather than guess it. Stage 2 binds a customer row to the
 * device that created it (migration 046), so this device may read and
 * change its own — through src/lib/supabase.js, which sends the
 * `x-device-id` header that makes the row visible at all. Consent is still
 * only ever set by a switch the customer moved. */
export async function getMarketingConsent(userId) {
  if (!userId) return false;
  const { data, error } = await supabase
    .from('users').select('marketing_consent').eq('id', userId).maybeSingle();
  if (error) return false;
  return data?.marketing_consent === true;
}

export async function setMarketingConsent(userId, on) {
  if (!userId) return false;
  const { error } = await supabase.from('users').update({
    marketing_consent: on === true,
    marketing_consent_at: on === true ? new Date().toISOString() : null,
  }).eq('id', userId);
  return !error;
}

export const savePendingEmail = (orgId, batchId, email, marketing) =>
  invokeBinTikkie({
    action: 'save_email', batch_id: batchId, org_id: orgId, device_id: deviceId(),
    email, create_account: true, privacy_accepted: true, marketing_consent: marketing === true,
  });

export const checkBatch = (batchId) =>
  invokeBinTikkie({ action: 'check', batch_id: batchId });

export const loginRequest = (orgId, email) =>
  invokeBinTikkie({ action: 'login_request', org_id: orgId, email, device_id: deviceId() });

/* Google login: Supabase Auth has the verified address; bin-tikkie checks
 * the token itself and moves the account onto this phone, the same as a
 * verified code does (adoptAccountOnDevice). */
export const oauthWalletLogin = (orgId, accessToken, batchId) =>
  invokeBinTikkie({
    action: 'oauth_login', org_id: orgId, device_id: deviceId(),
    access_token: accessToken, batch_id: batchId || null,
  });

export const loginVerify = (orgId, email, code, batchId) =>
  invokeBinTikkie({
    action: 'login_verify', org_id: orgId, email, code,
    device_id: deviceId(), batch_id: batchId || null,
  });
