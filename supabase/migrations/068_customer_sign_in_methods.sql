-- ─────────────────────────────────────────────────────────────────────
-- 068 — how a customer signs in, for the dashboard's Users page.
--
-- Customers can now sign in with Google as well as with an emailed code.
-- Both are Supabase Auth logins, and Supabase links them automatically
-- when the address is the same and verified: one login, two identities
-- (auth.identities rows with provider 'email' and 'google'). The Users
-- page shows which doors a customer has used, so support can say "use
-- Google, or ask for a code to the same address — it's one account".
--
-- auth.* is not readable from the API, so this is a SECURITY DEFINER read
-- of exactly three facts per login: the providers, when it last signed in,
-- and whether the address is confirmed. Nothing else from auth.users (no
-- tokens, no metadata, no phone).
--
-- Who may call it: dashboard accounts only. The check is in the WHERE of
-- the one statement, not in a CTE that Postgres may prune (see migration
-- 065). A PackPulse connection has no admin profile, so it gets nothing;
-- the anon key cannot even execute it.
-- ─────────────────────────────────────────────────────────────────────

create or replace function public.admin_customer_logins(p_auth_ids uuid[])
returns table (
  auth_user_id uuid,
  providers text[],
  last_sign_in_at timestamptz,
  email_confirmed boolean
)
language sql
stable
security definer
set search_path to 'public', 'auth'
as $$
  select u.id,
         coalesce(
           (select array_agg(distinct i.provider order by i.provider)
              from auth.identities i
             where i.user_id = u.id),
           '{}'::text[]
         ),
         u.last_sign_in_at,
         u.email_confirmed_at is not null
    from auth.users u
   where (public.current_admin()).id is not null
     and u.id = any (p_auth_ids[1:5000]);
$$;

revoke all on function public.admin_customer_logins(uuid[]) from public, anon;
grant execute on function public.admin_customer_logins(uuid[]) to authenticated, service_role;

comment on function public.admin_customer_logins(uuid[]) is
  'Dashboard only: sign-in providers (email, google), last sign-in and email confirmation for the given customer logins.';
