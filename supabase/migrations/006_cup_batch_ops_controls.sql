-- ─────────────────────────────────────────────────────────────────────
-- PackPerks — QR batch ops controls (P-21).
--
-- Until now a generated QR batch had no expiry, no revocation path,
-- and no way for admins to mark a misprint as dead. Once minted, the
-- QR could be claimed indefinitely — which is a fraud hole and a
-- support headache (reprints + originals both stay valid).
--
-- We add three optional columns on `cups`:
--   • expires_at     — null = never expires. Set at generation time
--                      when the admin picks an expiry preset.
--   • revoked_at     — null = active. Set when an admin revokes the
--                      batch (e.g. misprinted, reprinted as a fresh
--                      batch).
--   • revoked_reason — short audit note ("misprinted batch 12, reprinted
--                      as batch 17"). Surfaced in the user app's
--                      error page when the revoke reason is meaningful.
--
-- The claim-cups edge function is updated (v3 deploy) to:
--   1. Pre-check the candidate cups — if every one is revoked or
--      expired, return `batch_revoked` / `batch_expired` so the user
--      app can show tailored copy.
--   2. Atomically update only rows that are status='available' AND
--      revoked_at IS NULL AND (expires_at IS NULL OR > now()).
--
-- Existing rows are NULL on both new columns and continue to behave
-- exactly as before, so the migration is non-breaking.
-- ─────────────────────────────────────────────────────────────────────

alter table cups
  add column if not exists expires_at timestamptz,
  add column if not exists revoked_at timestamptz,
  add column if not exists revoked_reason text;

create index if not exists idx_cups_batch_id on cups(batch_id);
