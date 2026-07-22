/* ─────────────────────────────────────────────────────────────────────
 * payments.js — payout provider routing. A region selects a provider; a
 * provider knows which edge function actually mints the payout.
 *
 * Today only Tikkie (NL / EUR) is live. The UAE slot is a deliberate seam:
 * an approved UAE claim resolves to a provider with no edge function yet, so
 * the admin flow surfaces "provider not configured" instead of wrongly minting
 * a EUR Tikkie link. Wiring UAE = give it an `edgeFunction` and set `live`.
 * ───────────────────────────────────────────────────────────────────── */

import { getRegion } from './regions';

export const PAYMENT_PROVIDERS = {
  tikkie: {
    key: 'tikkie',
    label: 'Tikkie (ABN AMRO)',
    edgeFunction: 'tikkie-cashback', // live
    live: true,
    currencies: ['EUR'],
  },
  uae: {
    key: 'uae',
    label: 'UAE payout',
    // Generic UAE adapter. The edge function exists and routes to whichever
    // concrete provider is configured via the UAE_PAYOUT_PROVIDER secret; until
    // one is chosen + credentialed it returns "not configured" (live: false), so
    // approving an AE claim never mints in the wrong currency.
    edgeFunction: 'uae-payout',
    live: false,
    currencies: ['AED'],
    // Both payout shapes the adapter supports, so any UAE provider fits:
    //   • link  — a hosted collect link the customer opens (reuses tikkie_url).
    //   • proxy — instant push to the customer's mobile/email/QR identifier.
    models: ['link', 'proxy'],
  },
  none: {
    key: 'none',
    label: 'No automatic payout',
    edgeFunction: null,
    live: false,
    currencies: [],
  },
};

/** The provider options an admin can assign to a region. */
export function paymentProviderOptions() {
  return Object.values(PAYMENT_PROVIDERS);
}

/** Region key ("NL") → payment provider. Unknown/removed provider keys resolve
 * to a "not configured" shape so we NEVER silently pay out through the wrong
 * provider (e.g. minting a EUR Tikkie for an AED region). */
export function providerForRegion(regionKey) {
  const r = getRegion(regionKey);
  const p = PAYMENT_PROVIDERS[r.provider];
  if (p) return { ...p, region: r.key };
  return { key: r.provider || 'unknown', label: 'Not configured', edgeFunction: null, live: false, region: r.key };
}

/** organizations.country ("NL") → payment provider. */
export function providerForCountry(country) {
  return providerForRegion(getRegion(country).key);
}
