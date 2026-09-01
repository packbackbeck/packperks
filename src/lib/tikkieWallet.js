/* ─────────────────────────────────────────────────────────────────────
 * tikkieWallet — the client of bin-tikkie's wallet model.
 *
 * One place for the device identity, the locally-remembered profile, and
 * every edge-function call the Redirect Refund home makes. Plain fetch on
 * purpose: supabase.functions.invoke serialises behind the client's auth
 * lock and a single wedged request then hangs every later call.
 * ───────────────────────────────────────────────────────────────────── */

const FN_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/bin-tikkie`;
const FN_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY;

/* Same device id the rest of PackPerks uses — one profile per device. */
export function deviceId() {
  try {
    let id = localStorage.getItem('packperks_device_id');
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem('packperks_device_id', id);
    }
    return id;
  } catch {
    return 'no-storage';
  }
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

export const redeemWallet = (orgId) =>
  invokeBinTikkie({ action: 'redeem', org_id: orgId, device_id: deviceId() }, 25000);

export const setEmail = (orgId, email, marketing) =>
  invokeBinTikkie({
    action: 'set_email', org_id: orgId, device_id: deviceId(),
    email, privacy_accepted: true, marketing_consent: marketing === true,
  });

export const savePendingEmail = (orgId, batchId, email, marketing) =>
  invokeBinTikkie({
    action: 'save_email', batch_id: batchId, org_id: orgId, device_id: deviceId(),
    email, create_account: true, privacy_accepted: true, marketing_consent: marketing === true,
  });

export const checkBatch = (batchId) =>
  invokeBinTikkie({ action: 'check', batch_id: batchId });

export const loginRequest = (orgId, email) =>
  invokeBinTikkie({ action: 'login_request', org_id: orgId, email, device_id: deviceId() });

export const loginVerify = (orgId, email, code, batchId) =>
  invokeBinTikkie({
    action: 'login_verify', org_id: orgId, email, code,
    device_id: deviceId(), batch_id: batchId || null,
  });
