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
