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
    label: 'UAE payout — not available yet',
    // UNAVAILABLE ON PURPOSE. No UAE provider has been chosen, and the
    // `uae-payout` edge function is written (supabase/functions/uae-payout) but
    // NOT deployed. `live: false` is what keeps it that way: an approved AE
    // claim surfaces "provider not configured" rather than calling a function
    // that isn't there, and nothing ever mints in the wrong currency.
    // To enable: pick the provider, deploy uae-payout, set its secrets, then
    // flip `live` to true.
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
