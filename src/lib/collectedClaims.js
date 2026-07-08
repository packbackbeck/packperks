/* Tracks when the customer "collected" a cashback claim — i.e. tapped its
 * Tikkie link. Purely local (localStorage): once tapped, the pending-claims
 * block keeps showing the claim for a 24h grace window and only then drops it
 * (so it doesn't vanish the instant they tap). The Activity record keeps the
 * link forever. Never touches the DB, so it works for anonymous device users.
 *
 * Storage shape: { [claimId]: collectedAtMillis }. */

const KEY = 'packperks_collected_claims';

// How long a collected claim stays in the pending block before disappearing.
export const COLLECT_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours

export function getCollectedMap() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}');
    // Migrate the old array-of-ids format → timestamp map (ts 0 = already
    // past the grace window, so those legacy claims hide immediately).
    if (Array.isArray(raw)) {
      const m = {};
      raw.forEach(id => { if (id) m[id] = 0; });
      return m;
    }
    return raw && typeof raw === 'object' ? raw : {};
  } catch {
    return {};
  }
}

export function getCollectedAt(id) {
  if (!id) return null;
  const m = getCollectedMap();
  return Object.prototype.hasOwnProperty.call(m, id) ? m[id] : null;
}

/* True once the claim was collected AND its 24h grace window has passed. */
export function isCollectExpired(id, now = Date.now()) {
  const t = getCollectedAt(id);
  return t != null && (now - t) > COLLECT_WINDOW_MS;
}

/* Record the FIRST collect time (re-tapping doesn't reset the 24h clock). */
export function markClaimCollected(id) {
  if (!id) return getCollectedMap();
  const m = getCollectedMap();
  if (!Object.prototype.hasOwnProperty.call(m, id)) {
    m[id] = Date.now();
    try { localStorage.setItem(KEY, JSON.stringify(m)); } catch { /* quota / private mode */ }
  }
  return m;
}
