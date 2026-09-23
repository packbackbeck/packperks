/* What became of a payout link, in one place.
 *
 * A Tikkie link is only worth offering while it is still collectable. Once
 * the customer has collected it, or it has expired, the link leads nowhere
 * and showing it invites a confusing dead end, so every surface (the
 * activity list, its popup, the claim cards and the wallet) reads its state
 * from here and shows the status instead.
 *
 * The truth comes from Tikkie itself: tikkie-webhook writes it the moment a
 * collection is reported, and tikkie-sweep re-checks open links every 15
 * minutes (migration 060). `expiresAt` in the past counts as expired even
 * when that news hasn't arrived yet.
 *
 * Two deadlines can apply and the earlier one wins. Tikkie's own
 * (`tikkie_expires_at`) is the campaign's end date, identical for every
 * link it mints. Ours (`expires_at`, migration 063) is the venue's window
 * from Settings → Rules & limits, stamped on the claim when it is made. A
 * row that carries neither can still be judged by passing
 * `expireAfterMonths`, which measures the window from `created_at` — the
 * Deferred Tikkie wallet does that, because its history rows come from the
 * edge function rather than the claims table.
 */

export const LINK_STATE = {
  collected: { label: 'Collected', tone: 'done' },
  expired: { label: 'Link expired', tone: 'gone' },
  open: { label: 'Ready to collect', tone: 'open' },
  pending: { label: 'On its way', tone: 'wait' },
  failed: { label: 'Link failed', tone: 'gone' },
};

/* The earliest moment this link stops being ours to offer. */
function deadline(claim, expireAfterMonths) {
  const stamps = [claim.tikkie_expires_at, claim.expires_at]
    .map(v => (v ? Date.parse(v) : NaN))
    .filter(Number.isFinite);
  const months = Number(expireAfterMonths);
  if (Number.isFinite(months) && months > 0 && claim.created_at) {
    const made = new Date(claim.created_at);
    if (!Number.isNaN(made.getTime())) {
      const own = new Date(made);
      own.setMonth(own.getMonth() + Math.round(months));
      stamps.push(own.getTime());
    }
  }
  if (!stamps.length) return null;
  return new Date(Math.min(...stamps)).toISOString();
}

/* `claim` may be a claims row (tikkie_*, expires_at) or a wallet history row
 * (link_status / expires_at / redeemed_at), with the url passed separately
 * when the caller holds it. `opts.expireAfterMonths` applies the venue's
 * window to a row that carries no deadline of its own. */
export function payoutLinkState(claim, url = null, opts = {}) {
  if (!claim) return { state: 'pending', url: null, at: null, ...LINK_STATE.pending };
  const status = claim.tikkie_status ?? claim.link_status ?? null;
  const expiresAt = deadline(claim, opts.expireAfterMonths);
  const redeemedAt = claim.tikkie_redeemed_at ?? claim.redeemed_at ?? null;
  const link = url || claim.tikkie_url || null;
  // A row may know a link exists without carrying its URL (the wallet only
  // hands out the URL of the one link it wants opened).
  const hasLink = !!link || claim.has_link === true;

  let state;
  if (status === 'redeemed' || redeemedAt) state = 'collected';
  else if (status === 'expired' || (expiresAt && Date.parse(expiresAt) < Date.now())) state = 'expired';
  else if (status === 'failed') state = 'failed';
  else if (!hasLink) state = 'pending';
  else state = 'open';

  return {
    state,
    // Only an open link is ever handed out.
    url: state === 'open' ? link : null,
    at: state === 'collected' ? redeemedAt : state === 'expired' ? expiresAt : null,
    expiresAt,
    ...LINK_STATE[state],
  };
}

export const isLinkOpen = (claim, url = null, opts = {}) => payoutLinkState(claim, url, opts).state === 'open';
