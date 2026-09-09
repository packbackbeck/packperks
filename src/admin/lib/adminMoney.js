/* ─────────────────────────────────────────────────────────────────────
 * adminMoney — the dashboard's money formatter.
 *
 * The admin was written euro-first: every payout, rate and budget in it
 * was a hardcoded "€". That is wrong the moment a venue is not in the
 * Netherlands — a UAE store's cashback is AED, and showing it with a
 * euro sign misstates what the venue actually paid.
 *
 * Currency follows the ACTIVE ORGANISATION, not the admin looking at it:
 * a PackBack staffer switching from Titaan to NYU Abu Dhabi should see
 * the numbers change currency with the switch, because they are that
 * store's numbers.
 *
 * Two entry points, because the dashboard formats money from both sides:
 *   • useAdminMoney()  — inside components.
 *   • adminMoney(n)    — inside adminApi and other non-React modules,
 *                        reading the same module-level org state that
 *                        applyOrgFilter() already relies on.
 * ───────────────────────────────────────────────────────────────────── */

import { useOrg } from '../context/OrgContext';
import { getActiveOrgCountry } from '../context/orgState';
import { regionForCountry, formatMoney, getRegion, DEFAULT_REGION } from '../../lib/regions';

function regionKeyFor(country) {
  return regionForCountry(country)?.key || DEFAULT_REGION;
}

/** Non-React formatter, scoped to the active org. */
export function adminMoney(amount, country) {
  return formatMoney(amount, regionKeyFor(country ?? getActiveOrgCountry()));
}

/** The active org's currency symbol — for input prefixes and field labels. */
export function adminSymbol(country) {
  return getRegion(regionKeyFor(country ?? getActiveOrgCountry())).symbol;
}

/**
 * Money bound to the active organisation.
 * @returns {{ money: (n:number)=>string, symbol: string, currency: string, region: string }}
 */
export function useAdminMoney() {
  const { activeOrg } = useOrg();
  const region = regionKeyFor(activeOrg?.country);
  const r = getRegion(region);
  return {
    region,
    symbol: r.symbol,
    currency: r.currency,
    money: (n) => formatMoney(n, region),
  };
}
