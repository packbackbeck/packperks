/* ─────────────────────────────────────────────────────────────────────
 * rates.js — the per-cup rates a venue actually pays, in one place.
 *
 * A venue's rates are whatever its Settings page says. The only way two
 * screens could disagree was when a rate was never set: the dashboard
 * filled in €1.00 while the server paid its own default of €0.10, so a
 * new Deferred Tikkie venue showed one figure and paid another — and
 * publishing from Settings would quietly have made the €1.00 real.
 *
 * Everything that shows or edits a rate goes through `effectiveRates()`,
 * which applies the server's own rule: a positive number from settings,
 * otherwise the mode's default below.
 *
 * The server can't import this file. Its defaults live in
 *   supabase/functions/bin-tikkie/index.ts       DEFAULT_RATE_EUR
 *   supabase/functions/bin-mint-batch/index.ts   DEFAULT_RATE_EUR
 * and must stay equal to DEFERRED_TIKKIE_DEFAULT_RATE here.
 * ───────────────────────────────────────────────────────────────────── */

export const DEFERRED_TIKKIE_DEFAULT_RATE = 0.10;

export const RATE_DEFAULTS = {
  standard:    { cashbackRatePerCup: 1.25, refundRatePerCup: 1.00 },
  byo:         { cashbackRatePerCup: 1.25, refundRatePerCup: 1.00 },
  // One rate only. The server reads refundRatePerCup, then cashbackRatePerCup.
  tikkie_only: { cashbackRatePerCup: DEFERRED_TIKKIE_DEFAULT_RATE, refundRatePerCup: DEFERRED_TIKKIE_DEFAULT_RATE },
};

const positive = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * The rates a venue pays, resolved the way the server resolves them.
 * @param {object} settings  The venue's settings (draft or published).
 * @param {string} [mode]    'standard' | 'byo' | 'tikkie_only'. Read from
 *                           settings.mode when omitted.
 * @returns {{ cashback: number, refund: number }}
 */
export function effectiveRates(settings = {}, mode) {
  const m = mode || (settings?.mode === 'tikkie_only' ? 'tikkie_only' : 'standard');
  const d = RATE_DEFAULTS[m] || RATE_DEFAULTS.standard;
  if (m === 'tikkie_only') {
    // Mirrors bin-tikkie: refund rate, then cashback rate, then the default.
    const r = positive(settings?.refundRatePerCup) ?? positive(settings?.cashbackRatePerCup) ?? d.refundRatePerCup;
    return { cashback: r, refund: r };
  }
  return {
    cashback: positive(settings?.cashbackRatePerCup) ?? d.cashbackRatePerCup,
    refund:   positive(settings?.refundRatePerCup)   ?? d.refundRatePerCup,
  };
}

/** Settings with any unset rate filled in from the mode's default. */
export function withRateDefaults(settings = {}) {
  const { cashback, refund } = effectiveRates(settings);
  return { ...settings, cashbackRatePerCup: cashback, refundRatePerCup: refund };
}
