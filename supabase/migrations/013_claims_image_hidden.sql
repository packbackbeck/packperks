-- ──────────────────────────────────────────────────────────────────────
-- PackPerks — claims.image_hidden + audit columns (013)
--
-- Two related features land on the same column set:
--
--   1. AI moderation: the verify-receipt edge function classifies the
--      uploaded image BEFORE running the existing receipt-extraction
--      pass. If the moderator flags the image as NSFW / violent / other-
--      inappropriate, the row is hidden automatically.
--
--   2. Admin manual action: an owner/admin can hit "Hide image" on a
--      claim detail panel after-the-fact (e.g. PII the AI missed, or
--      a borderline image the AI let through).
--
-- Either path writes to the same set of columns, with image_hidden_by
-- distinguishing automated (null) vs. human (admin profile id) actions
-- and image_hidden_reason carrying a short code + an optional admin
-- note for the audit trail.
--
-- Hiding is admin-side ONLY — the user app continues to render the
-- user's own upload from receipts/ storage. Hiding affects every
-- admin reviewer's view of the receipt, replacing it with a neutral
-- "image hidden" placeholder.
-- ──────────────────────────────────────────────────────────────────────

alter table claims
  add column if not exists image_hidden boolean default false not null,
  add column if not exists image_hidden_reason text,
  add column if not exists image_hidden_at timestamptz,
  add column if not exists image_hidden_by uuid;

-- Lookup is "show me the AI-flagged claims for review" — small but
-- worth indexing since the moderation tab will filter by this.
create index if not exists idx_claims_image_hidden
  on claims(image_hidden)
  where image_hidden = true;
