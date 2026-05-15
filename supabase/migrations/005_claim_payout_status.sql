-- ─────────────────────────────────────────────────────────────────────
-- PackPerks — split claim payout state out of the review status column.
--
-- P-02: claims.status used to collapse three distinct lifecycle states
-- (review decision, AI validation, payout state) into one badge. The
-- external review flagged this as a trust failure — "completed" could
-- mean any combination of "AI passed", "admin approved", or "cashback
-- sent" depending on context.
--
-- We add a dedicated payout_status column. The legacy `status` keeps
-- doing its job as the *review* status (pending → approved/rejected).
-- AI validation is derived client-side from existing ai_* columns +
-- the 50% confidence threshold.
--
--   not_queued — direct refunds and rejected claims (no payout owed)
--   queued     — approved cashback awaiting bank batch
--   sent       — bank received the payout instruction
--   failed     — payout bounced (wrong IBAN, etc) — needs manual fix
--   refunded   — admin reversed the payout
-- ─────────────────────────────────────────────────────────────────────

alter table claims
  add column if not exists payout_status text
    check (payout_status in ('not_queued','queued','sent','failed','refunded'));

-- Best-effort backfill — admins can set payout_status explicitly going
-- forward via updateClaimStatus.
update claims set payout_status = 'sent'       where status = 'completed' and type = 'cashback'      and payout_status is null;
update claims set payout_status = 'not_queued' where status = 'completed' and type = 'direct_refund' and payout_status is null;
update claims set payout_status = 'not_queued' where status in ('pending','failed')                   and payout_status is null;
