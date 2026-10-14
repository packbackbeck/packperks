/* ─────────────────────────────────────────────────────────────────────
 * deviceId — the one stable id this browser keeps in localStorage.
 *
 * An anonymous customer is their device: their rows carry this id, and
 * the database checks it (the x-device-id header, see ./supabase.js) before
 * it lets a request read or spend from a row. Signed-in customers are
 * matched by their login as well.
 *
 * `crypto.randomUUID()` only exists in secure contexts (HTTPS, localhost).
 * Reached over a raw LAN IP (http://10.x.x.x:5173 from a phone) it is
 * undefined, so fall back to a hand-rolled v4 UUID. Storage can also be
 * unavailable (private mode, blocked site data); then the id lives for the
 * page's lifetime only.
 * ───────────────────────────────────────────────────────────────────── */

const KEY = 'packperks_device_id';
let memoryId = null;

function safeUUID() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export function newUUID() {
  return safeUUID();
}

export function getDeviceId() {
  try {
    let id = localStorage.getItem(KEY);
    if (!id) {
      id = safeUUID();
      localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    if (!memoryId) memoryId = safeUUID();
    return memoryId;
  }
}

/* What this browser keeps about the PERSON (not about the browser): the
 * device id that owns their rows, a Deferred Tikkie wallet's profile, their
 * avatar, region and claim bookkeeping. Forgetting them is what makes a
 * sign-out real: an anonymous customer IS their device id, so ending the
 * login alone left the same row, email and cups on screen.
 *
 * Only the customer app's own keys. The dashboard and the staff app share
 * this origin (and its storage), so a blanket clear() would sign them out
 * and drop their drafts; cookie choices belong to the browser and stay. */
const PERSON_KEYS = [
  KEY,
  'packperks_profile_avatar',
  'packperks_region',
  'packperks_collected_claims',
  'packperks_dismissed_claims',
  'packperks_notify_on_approval',
  'packperks_requested_vendors',
  'packperks_marketing_choice_pending',
  'pp_merge_pending',
  'pp_merge_inflight',
];
const PERSON_PREFIXES = ['packperks_refund_user:'];

export function forgetThisDevice() {
  memoryId = null;
  try {
    const all = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i));
    all
      .filter(k => k && (PERSON_KEYS.includes(k) || PERSON_PREFIXES.some(p => k.startsWith(p))))
      .forEach(k => localStorage.removeItem(k));
  } catch { /* no storage: the in-memory id is already gone */ }
  try {
    ['pp_page', 'pp_page_combined', 'pp_open_page'].forEach(k => sessionStorage.removeItem(k));
  } catch { /* fine */ }
}
