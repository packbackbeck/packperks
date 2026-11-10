/* ─────────────────────────────────────────────────────────────────────
 * Automatic cashout — the Deferred Refund wallet pays itself out on a
 * schedule the customer picks, with a bonus for waiting longer.
 *
 * ONE place for the tiers and the bonus defaults, read by the wallet
 * (components/tikkie/AutoCashout.jsx) and the dashboard
 * (admin/settings/AutoCashoutCard.jsx). The server keeps the same numbers
 * in supabase/functions/auto-cashout (TIERS) and bin-tikkie (AUTO_TIERS):
 * change them together.
 *
 * Published settings:
 *   autoCashout          — the feature (off unless set)
 *   autoCashoutBonus     — the bonus on top (off unless set)
 *   autoCashoutBonusPct  — { week, month, quarter } in percent
 *
 * The bonus is worked out on the server from these settings when the
 * payout is made. What the app shows is only ever a preview of that.
 * ───────────────────────────────────────────────────────────────────── */

export const AUTO_TIERS = [
  { key: 'week', label: '1 week', every: 'every week', adverb: 'weekly', defaultBonus: 5 },
  { key: 'month', label: '1 month', every: 'every month', adverb: 'monthly', defaultBonus: 10 },
  { key: 'quarter', label: '3 months', every: 'every 3 months', adverb: 'every 3 months', defaultBonus: 15 },
];

export const TIER_BY_KEY = Object.fromEntries(AUTO_TIERS.map(t => [t.key, t]));

/* The server refuses more than this, whatever the settings say. */
export const MAX_BONUS_PCT = 50;

export function clampBonusPct(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.min(MAX_BONUS_PCT, Math.max(0, Math.round(n * 100) / 100));
}

/** What the venue offers: on, bonus on, and the bonus per tier (0 when off). */
export function autoCashoutConfig(settings) {
  const on = settings?.autoCashout === true;
  const bonusOn = on && settings?.autoCashoutBonus === true;
  const set = settings?.autoCashoutBonusPct || {};
  const bonus = Object.fromEntries(AUTO_TIERS.map(t => [
    t.key, bonusOn ? clampBonusPct(set[t.key] ?? t.defaultBonus) : 0,
  ]));
  return { on, bonusOn, bonus };
}

/** The bonus on an amount, rounded to the cent the way the server does. */
export function bonusOn(amount, pct) {
  return Math.round(Number(amount || 0) * Number(pct || 0)) / 100;
}

/** The default percentages, for the settings form. */
export const DEFAULT_BONUS_PCT = Object.fromEntries(AUTO_TIERS.map(t => [t.key, t.defaultBonus]));
