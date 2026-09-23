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
 */

export const LINK_STATE = {
  collected: { label: 'Collected', tone: 'done' },
  expired: { label: 'Link expired', tone: 'gone' },
  open: { label: 'Ready to collect', tone: 'open' },
  pending: { label: 'On its way', tone: 'wait' },
  failed: { label: 'Link failed', tone: 'gone' },
};

/* `claim` may be a claims row (tikkie_*) or a wallet history row
 * (link_status / expires_at / redeemed_at), with the url passed separately
 * when the caller holds it. */
export function payoutLinkState(claim, url = null) {
  if (!claim) return { state: 'pending', url: null, at: null, ...LINK_STATE.pending };
  const status = claim.tikkie_status ?? claim.link_status ?? null;
  const expiresAt = claim.tikkie_expires_at ?? claim.expires_at ?? null;
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

export const isLinkOpen = (claim, url = null) => payoutLinkState(claim, url).state === 'open';
