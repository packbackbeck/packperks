/* ─────────────────────────────────────────────────────────────────────
 * RegionContext — the active region for the customer app, provided ABOVE
 * <App/> (see main.jsx) so it survives App's many per-page returns.
 *
 * App resolves the active region from the active org's country and pushes it
 * in via setRegion(); any component reads currency + a formatter with
 * useRegion() / useMoney(). Outside a provider (admin, mockup) it safely
 * falls back to the default region, so nothing crashes.
 *
 * On mount we also load the admin-managed region overlay (app_config
 * `published:regions`) and merge it over the code seed, so admin-added regions
 * (currency, symbol, map, payout provider) take effect for customers.
 * ───────────────────────────────────────────────────────────────────── */

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { getRegion, formatMoney, moneyParts, setRegions, DEFAULT_REGION, payoutCopy } from './regions';
import { supabase } from './supabase';

const RegionContext = createContext(null);

function valueFor(region, setRegion, rev) {
  const r = getRegion(region);
  return {
    region: r.key,
    currency: r.currency,
    symbol: r.symbol,
    collectLabel: r.collectLabel, // provider-neutral "collect your cashback" CTA
    payoutNoun: r.payoutNoun,     // inline copy noun ("Tikkie link" / "payment link")
    payout: payoutCopy(r.key),    // full phrases — see payoutCopy() in regions.js
    money: (n) => formatMoney(n, r.key),
    // Split form, for rendering the currency as a drawn mark — see <Money/>.
    moneyParts: (n) => moneyParts(n, r.key),
    setRegion,
    _rev: rev, // bumps when the overlay loads so consumers re-read the registry
  };
}

export function RegionProvider({ children }) {
  const [region, setRegion] = useState(DEFAULT_REGION);
  const [rev, setRev] = useState(0);

  // Load the admin region overlay once. Same `published:*` RLS the customer
  // already uses for group config, so it's a plain read; on any failure we
  // simply keep the code defaults.
  useEffect(() => {
    let alive = true;
    supabase.from('app_config').select('value').eq('key', 'published:regions').maybeSingle()
      .then(({ data }) => {
        if (!alive || !data?.value) return;
        setRegions(data.value.regions || data.value);
        setRev((r) => r + 1);
      })
      .catch(() => { /* keep defaults */ });
    return () => { alive = false; };
  }, []);

  const value = useMemo(() => valueFor(region, setRegion, rev), [region, rev]);
  return <RegionContext.Provider value={value}>{children}</RegionContext.Provider>;
}

const FALLBACK = valueFor(DEFAULT_REGION, () => {}, 0);

export function useRegion() {
  return useContext(RegionContext) || FALLBACK;
}

/** Shortcut for the common case: a money formatter bound to the active region. */
export function useMoney() {
  return useRegion().money;
}
