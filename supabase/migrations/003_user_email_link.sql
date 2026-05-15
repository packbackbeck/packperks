-- ─────────────────────────────────────────────────────────────────────
-- PackPerks — link users to Supabase Auth (P0-for-launch).
--
-- Until now, the user app has identified customers by a localStorage
-- `device_id` only. Clear browser data → start over. This migration
-- adds an optional Supabase Auth bridge:
--
--   • `users.auth_user_id` — when present, this row belongs to a real
--     `auth.users` account (email-verified via magic link). The same
--     account can sign in from any device and recover their balance.
--   • `users.email_verified_at` — bookkeeping for analytics + so we can
--     tell "linked-by-email" rows from anonymous device-only rows.
--
-- The flow:
--   1. New user opens app on a fresh device → anonymous row keyed by
--      device_id (no auth_user_id).
--   2. User taps "Save your cups across devices", enters email →
--      signInWithOtp sends a magic link.
--   3. User clicks the link → auth session is established → app calls
--      linkAuthToUser() which sets users.auth_user_id = auth.uid() on
--      the existing row.
--   4. Next time on a new device, signing in with the same email
--      pulls the same users row by auth_user_id and re-binds it to
--      the new device_id.
--
-- This is additive — `device_id` stays as the primary anonymous lookup
-- key and existing rows continue to work untouched.
-- ─────────────────────────────────────────────────────────────────────

alter table users
  add column if not exists auth_user_id uuid unique references auth.users(id) on delete set null,
  add column if not exists email_verified_at timestamptz;

-- Lookup index so the "find me by auth uid" path is O(1) at signin.
create index if not exists idx_users_auth_user_id on users(auth_user_id);

-- Optional RLS hardening: let an authenticated user read + update their
-- own row (matched by auth_user_id). The existing anon-key policies
-- continue to govern the device-id path. We do NOT add an auth-based
-- policy that broadens what anon can see — that stays scoped to the
-- device_id check already in place.
do $$
begin
  if exists (select 1 from pg_policies where tablename = 'users' and policyname = 'users_self_read_authed') then
    drop policy users_self_read_authed on users;
  end if;
  if exists (select 1 from pg_policies where tablename = 'users' and policyname = 'users_self_update_authed') then
    drop policy users_self_update_authed on users;
  end if;
end$$;

create policy users_self_read_authed
  on users
  for select
  to authenticated
  using (auth_user_id = auth.uid());

create policy users_self_update_authed
  on users
  for update
  to authenticated
  using (auth_user_id = auth.uid())
  with check (auth_user_id = auth.uid());
