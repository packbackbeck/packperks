/* ─────────────────────────────────────────────────────────────────────
 * regions.js — the single source of truth for "region" in a multi-regional
 * PackPerks. One BYO programme; each vendor belongs to a region (derived from
 * organizations.country), and the region decides currency, the map focus, the
 * payment provider (see payments.js), and — later — locale.
 *
 * The built-ins below are the SEED. Admins can add/edit regions in the admin
 * (Organisations → Regions); those are stored in app_config `published:regions`
 * and merged over the seed via setRegions() at app boot. So a new region needs
 * NO code change — the code defaults just guarantee NL/AE always exist.
 * ───────────────────────────────────────────────────────────────────── */

export const DEFAULT_REGIONS = {
  NL: {
    key: 'NL',
    label: 'Netherlands',
    flag: '🇳🇱',
    currency: 'EUR',
    symbol: '€',
    // Locale chosen so EUR renders as "€4.80" (leading symbol, dot decimal).
    currencyLocale: 'en-IE',
    provider: 'tikkie',                 // → payments.js
    countries: ['NL', 'NLD'],           // organizations.country values
    onboardingKeys: ['netherlands'],    // onboarding.js COUNTRIES keys
    map: { lat: 52.13, lng: 5.29, zoom: 7 },
    collectLabel: 'Collect via Tikkie', // customer "collect your cashback" CTA
    payoutNoun: 'Tikkie link',          // inline copy: "we'll send you a …"
    // 'link' regions promise a link to collect; 'direct' regions promise only
    // that the cashback reaches the customer, because the mechanism (hosted
    // link vs push to a wallet/account) isn't settled yet. See payoutCopy().
    payoutStyle: 'link',
    enabled: true,
  },
  AE: {
    key: 'AE',
    label: 'United Arab Emirates',
    flag: '🇦🇪',
    currency: 'AED',
    symbol: 'د.إ',
    currencyLocale: 'en-AE',
    provider: 'uae',                    // generic UAE adapter — see payments.js
    countries: ['AE', 'ARE'],
    onboardingKeys: ['uae'],
    map: { lat: 24.2, lng: 54.4, zoom: 7 },
    collectLabel: 'Collect your cashback', // provider-neutral (no NL "Tikkie")
    payoutNoun: 'payment link',            // provider-neutral inline copy
    /* The UAE adapter supports BOTH a hosted link and a direct push to the
     * customer (payments.js `models`), and which one goes live isn't decided.
     * Promising "a payment link" would be a claim we can't keep, so AE copy
     * says only that the cashback is sent — no mechanism, no false detail. */
    payoutStyle: 'direct',
    enabled: true,
  },
};

export const DEFAULT_REGION = 'NL';

// Live registry — the seed, plus any admin overlay applied via setRegions().
let REGISTRY = clone(DEFAULT_REGIONS);

function clone(o) { return JSON.parse(JSON.stringify(o)); }

/** Fill any missing fields on a region so consumers never hit undefined. */
export function normalizeRegion(key, r = {}) {
  const seed = DEFAULT_REGIONS[key] || {};
  const m = r.map || seed.map || {};
  return {
    key,
    label: r.label ?? seed.label ?? key,
    flag: r.flag ?? seed.flag ?? '',
    currency: r.currency ?? seed.currency ?? 'EUR',
    symbol: r.symbol ?? seed.symbol ?? (r.currency || 'EUR'),
    currencyLocale: r.currencyLocale ?? seed.currencyLocale ?? 'en-IE',
    provider: r.provider ?? seed.provider ?? 'tikkie',
    countries: (r.countries && r.countries.length ? r.countries : seed.countries) || [key],
    onboardingKeys: (r.onboardingKeys && r.onboardingKeys.length ? r.onboardingKeys : seed.onboardingKeys) || [],
    map: {
      lat: Number(m.lat ?? 52.13),
      lng: Number(m.lng ?? 5.29),
      zoom: Number(m.zoom ?? 7),
    },
    collectLabel: r.collectLabel ?? seed.collectLabel ?? 'Collect your cashback',
    payoutNoun: r.payoutNoun ?? seed.payoutNoun ?? 'payment link',
    /* Must survive normalisation. The admin Regions panel round-trips every
     * region through here and saves the result, so a field dropped here is
     * dropped from the stored overlay for good — which is how AE lost its
     * 'direct' style and started promising customers a payment link that no
     * live adapter can deliver. A region we know nothing about defaults to
     * 'direct': it promises less, and payoutCopy() can always say less. */
    payoutStyle: r.payoutStyle ?? seed.payoutStyle ?? 'direct',
    enabled: r.enabled !== false,
  };
}

/** Apply an admin overlay (from app_config) over the seed. Idempotent. */
export function setRegions(overlay) {
  const next = clone(DEFAULT_REGIONS);
  for (const [k, v] of Object.entries(overlay || {})) {
    const key = String(k).toUpperCase();
    next[key] = normalizeRegion(key, { ...(next[key] || {}), ...v });
  }
  REGISTRY = next;
  return REGISTRY;
}

export function getRegionsRegistry() { return REGISTRY; }
export function getAllRegions() { return Object.values(REGISTRY); }

/** Resolve a region by its key ("NL") OR a country code ("NL"/"ARE"). */
export function getRegion(key) {
  if (!key) return REGISTRY[DEFAULT_REGION];
  const up = String(key).trim().toUpperCase();
  if (REGISTRY[up]) return REGISTRY[up];
  return regionForCountry(up) || REGISTRY[DEFAULT_REGION];
}

/** organizations.country → region (or null).
 *  Matches ISO codes (the `countries` list) AND the region's full label, since
 *  real data carries both "NL" and "Netherlands" in organizations.country. */
export function regionForCountry(country) {
  if (!country) return null;
  const c = String(country).trim().toUpperCase();
  return Object.values(REGISTRY).find((r) =>
    r.countries.map((s) => String(s).toUpperCase()).includes(c) ||
    String(r.label).toUpperCase() === c,
  ) || null;
}

/** onboarding.js country key ("uae") → region (or null). */
export function regionForOnboardingCountry(key) {
  if (!key) return null;
  const k = String(key).trim().toLowerCase();
  return Object.values(REGISTRY).find((r) => (r.onboardingKeys || []).map(s => String(s).toLowerCase()).includes(k)) || null;
}

export function currencyForRegion(key) {
  return getRegion(key).currency;
}

/** Pure currency formatter. Falls back to "CUR 0.00" if Intl can't help. */
export function formatCurrency(amount, currency = 'EUR', locale = 'en-IE') {
  const n = Number(amount) || 0;
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(n);
  } catch {
    return `${currency} ${n.toFixed(2)}`;
  }
}

/** Region-aware money formatter — what UI components use. */
export function formatMoney(amount, regionKey = DEFAULT_REGION) {
  const r = getRegion(regionKey);
  return formatCurrency(amount, r.currency, r.currencyLocale);
}


/* ─────────────────────────────────────────────────────────────────────
 * payoutCopy — how this region promises to pay the customer.
 *
 * Two shapes, because two things are genuinely different:
 *   link   — we hand over something to collect from ("a Tikkie link").
 *   direct — we just send it; the mechanism isn't the customer's problem
 *            and, in the UAE, isn't finalised either.
 *
 * `send` completes "…once your receipt is approved, {send}."
 * `sendAmount(x)` completes the same sentence with the figure in it.
 * ───────────────────────────────────────────────────────────────────── */
export function payoutCopy(regionKey) {
  const r = getRegion(regionKey);
  if (r.payoutStyle === 'direct') {
    return {
      style: 'direct',
      noun: r.payoutNoun,
      send: "we'll send your cashback to you",
      sendAmount: (amount) => `we'll send your ${amount} cashback to you`,
    };
  }
  return {
    style: 'link',
    noun: r.payoutNoun,
    send: `we'll send you a ${r.payoutNoun} to collect it`,
    sendAmount: (amount) => `we'll send you a ${r.payoutNoun} to collect your ${amount} cashback`,
  };
}
