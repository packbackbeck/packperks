/* ─────────────────────────────────────────────────────────────────────
 * impact — shared plastic-avoided helpers.
 *
 * 1 cup ≈ 5 g of plastic (the PackBack pilot estimate). Used by the
 * profile "Your impact" card and the Stores-hub impact panel so both
 * speak the same language.
 * ───────────────────────────────────────────────────────────────────── */

export const GRAMS_PER_CUP = 5;

/* Everyday comparisons — tangible objects, not abstractions. A given cup
 * count maps to a stable phrase (via `cups % len`) that shifts as the
 * person collects more. */
const COMPARISON_PHRASES = [
  (cups) => `${cups} disposable coffee cup${cups === 1 ? '' : 's'} kept out of landfill`,
  (cups) => `roughly ${cups} plastic grocery bag${cups === 1 ? '' : 's'} of waste avoided`,
  (cups) => {
    const straws = cups * 10;
    return `about ${straws.toLocaleString()} plastic straw${straws === 1 ? '' : 's'} kept out of the ocean`;
  },
  (cups) => `${cups} disposable plastic fork${cups === 1 ? '' : 's'} that didn't get thrown away`,
  (cups) => {
    const g = cups * GRAMS_PER_CUP;
    if (g < 30)   return 'about the weight of a sugar packet of plastic saved';
    if (g < 80)   return 'about the weight of a chocolate bar of plastic saved';
    if (g < 200)  return 'about the weight of an apple of plastic saved';
    if (g < 600)  return 'about the weight of a paperback book of plastic saved';
    if (g < 1500) return 'about the weight of a bag of sugar of plastic saved';
    if (g < 5000) return 'about the weight of a brick of plastic saved';
    return `about ${(g / 1000).toFixed(1)} kg of plastic, a small backpack's worth`;
  },
];

export function pickComparison(cups) {
  if (!cups || cups <= 0) return 'Collect your first cup to start your impact';
  return COMPARISON_PHRASES[cups % COMPARISON_PHRASES.length](cups);
}

export function formatGrams(g) {
  if (g >= 1000) return `${(g / 1000).toFixed(1)} kg`;
  return `${g} g`;
}
