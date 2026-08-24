-- Tikkie-only mode (smart-bin cashback): a bin receipt batch converts
-- straight into a Tikkie link via one anonymous claims row. batch_id ties
-- the claim to the cup batch and is the idempotency key — re-scanning the
-- same receipt must always return the SAME link, never mint a second one.
alter table public.claims add column if not exists batch_id uuid;

-- Partial unique index: one claim per batch. A concurrent double-scan races
-- on the insert; the loser hits this constraint and re-reads the winner's row.
create unique index if not exists claims_batch_id_key
  on public.claims (batch_id)
  where batch_id is not null;
