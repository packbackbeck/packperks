/* ─────────────────────────────────────────────────────────────────────
 * Smart sorting — pick the reward goal that feels within reach.
 *
 * The problem it solves, from the Titaan 2 behaviour data: of the 38
 * active customers who collected exactly one cup, ZERO ever left an
 * email. Everyone who reached 2+ cups converted at 30–67%. The second
 * cup is the threshold — and a first-time customer holding 1 cup who is
 * shown a 6-cup goal has no reason to believe the second cup is worth
 * collecting.
 *
 * So instead of always featuring the admin's `featured` reward, we
 * feature the goal that is closest to what this customer already has.
 * One more cup is a reason to come back; five more is a reason to leave.
 *
 * Priority, given a balance of X cups:
 *
 *   1. A reward costing exactly X+1  — "one more cup and it's yours",
 *      the strongest possible reason to come back.
 *   2. A reward costing exactly X    — exactly enough, claim it now.
 *   3. The cheapest reward above X   — the nearest goal still ahead.
 *   4. The dearest reward at or below X — nothing left ahead, so show the
 *      best thing they can walk away with.
 *
 * The featured card is a GOAL, so this looks forward: an already-unlocked
 * reward is an achievement the app surfaces on its own, not something to
 * aim at. The one risk in that is burying a reward the customer could
 * claim right now — which is why sortRewardsByReach() below puts
 * claimable rewards at the TOP of the list underneath. Hero = next goal,
 * list = what you can take today. Neither hides the other.
 *
 * A brand-new customer (X = 0) gets the cheapest reward: the shortest
 * path to a first win, not the flagship goal.
 *
 * This never overrides a customer who picked a reward themselves — that
 * check lives at the call site, keeping this function pure.
 * ───────────────────────────────────────────────────────────────────── */

/* Rewards that can actually be a goal, cheapest first. Ties break toward
 * the higher cash value, so equal-cost rewards show the better one. */
function usable(rewards) {
  return (rewards || [])
    .filter(r => r && Number(r.cupsNeeded) >= 1)
    .slice()
    .sort((a, b) =>
      (Number(a.cupsNeeded) - Number(b.cupsNeeded)) ||
      (Number(b.euros || 0) - Number(a.euros || 0)));
}

/* The reward to feature for a customer holding `balance` cups.
 * Returns null when there is nothing sensible to feature, so callers can
 * fall back to their existing behaviour. */
export function pickSmartReward(rewards, balance) {
  const list = usable(rewards);
  if (list.length === 0) return null;

  const X = Number.isFinite(Number(balance)) ? Math.max(0, Math.floor(Number(balance))) : 0;

  // No cups yet: the shortest path to a first goal beats the flagship one.
  if (X === 0) return list[0];

  // The list is sorted cheapest-first, ties by highest cash value, so the
  // first match at a given price is already the best one at that price.
  const at = (n) => list.find(r => Number(r.cupsNeeded) === n) || null;

  return (
    at(X + 1) ||                                              // one more cup
    at(X) ||                                                  // exactly enough
    list.find(r => Number(r.cupsNeeded) > X) ||               // nearest ahead
    [...list].reverse().find(r => Number(r.cupsNeeded) <= X)  // best unlocked
  );
}

/* Order the rest of the list by what the customer can act on soonest:
 * anything already unlocked first (dearest of those first — the best thing
 * they can take today), then the goals still ahead, nearest first.
 *
 * The unlocked-first half matters because the featured card looks FORWARD.
 * Without this, a customer holding 6 cups could be shown an 8-cup goal
 * while the 5-cup reward they've already earned sat halfway down the list. */
export function sortRewardsByReach(rewards, balance) {
  const X = Number.isFinite(Number(balance)) ? Math.max(0, Math.floor(Number(balance))) : 0;
  return (rewards || []).slice().sort((a, b) => {
    const ca = Number(a?.cupsNeeded) || 0;
    const cb = Number(b?.cupsNeeded) || 0;
    const unlockedA = ca <= X;
    const unlockedB = cb <= X;
    if (unlockedA !== unlockedB) return unlockedA ? -1 : 1;  // claimable first
    if (unlockedA) return cb - ca;                           // dearest unlocked
    return ca - cb;                                          // nearest goal
  });
}
