-- Redirect Refund v2: the WALLET model.
--
-- A scan no longer mints a Tikkie link. It credits the receipt's value to
-- the customer's profile (created on first scan, device-keyed, with the
-- same adjective+animal identity as every other PackPerks mode). One link
-- is minted only when the customer chooses "Open Tikkie" on their wallet,
-- covering the whole available balance in bulk.
--
-- payout_claim_id marks a credit as swept into a payout:
--   • credit rows:  batch_id set, no tikkie fields. Available while
--     payout_claim_id is null.
--   • payout rows:  batch_id null, tikkie_url/cashback set after the mint.
alter table public.claims
  add column if not exists payout_claim_id uuid references public.claims(id);

create index if not exists idx_claims_wallet
  on public.claims (user_id, payout_claim_id)
  where batch_id is not null;
