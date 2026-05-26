-- ──────────────────────────────────────────────────────────────────────
-- PackPerks — users.merged_into (014)
--
-- The restore-by-email edge function performs a conservative merge
-- when a customer signs in with an email they already had history on
-- AND has accumulated cups on a new anonymous device row. The merge
-- consolidates everything onto the email-side row and marks the
-- absorbed device row with `merged_into = <survivor_id>`.
--
-- We deliberately do NOT hard-delete the absorbed row so:
--   • Any FK we forgot to repoint still resolves to a real users row.
--   • Audit trails (action log, history) can still trace "this claim
--     was once attributed to user X" without dangling references.
--
-- The column is a self-referential FK (nullable) so we can also enforce
-- "you can only merge into a real user row" at the DB level.
-- ──────────────────────────────────────────────────────────────────────

alter table users
  add column if not exists merged_into uuid references users(id) on delete set null;

-- Most queries for "active users" should exclude merged rows. A partial
-- index makes the common `where merged_into is null` lookups fast
-- without bloating the index for a column that's almost always null.
create index if not exists idx_users_merged_into
  on users(merged_into)
  where merged_into is not null;
