-- ──────────────────────────────────────────────────────────────────────
-- PackPerks — admin-only, single-org purge of activity records (024)
--
-- Powers the Stats "Danger zone — delete test data" button. Deletes this
-- org's cup scans, reward claims, and cup/donation transfers — and nothing
-- else. SECURITY DEFINER so it can delete past RLS, but:
--   • gated on current_admin() (only active admins may run it), and
--   • scoped strictly to the passed org_id (never "all orgs").
-- Execute is granted to `authenticated` only (revoked from anon/public);
-- the in-function admin check blocks non-admin authenticated callers too.
--
-- Safe to re-run.
-- ──────────────────────────────────────────────────────────────────────

create or replace function public.admin_purge_org_records(p_org_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid;
  n_scans int;
  n_claims int;
  n_transfers int;
begin
  v_admin := (current_admin()).id;
  if v_admin is null then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if p_org_id is null then
    raise exception 'org_id_required' using errcode = '22004';
  end if;

  delete from public.cup_scans where org_id = p_org_id;
  get diagnostics n_scans = row_count;

  delete from public.claims where org_id = p_org_id;
  get diagnostics n_claims = row_count;

  delete from public.donation_transfers where org_id = p_org_id;
  get diagnostics n_transfers = row_count;

  return json_build_object(
    'cup_scans', n_scans,
    'claims', n_claims,
    'cup_transfers', n_transfers
  );
end $$;

revoke all on function public.admin_purge_org_records(uuid) from public, anon;
grant execute on function public.admin_purge_org_records(uuid) to authenticated;
