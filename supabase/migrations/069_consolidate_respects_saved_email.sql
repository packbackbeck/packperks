-- ─────────────────────────────────────────────────────────────────────
-- 069 — a login no longer sweeps up rows saved under another address.
--
-- consolidate_identity runs on every customer sign-in. Its first step
-- gathered "rows this login owns + UNCLAIMED rows on this device" — every
-- org's row on the phone with no login yet, whatever email it carried. On
-- 6 Oct 2026 a Google sign-in as one address (after the return address
-- fell back to another venue) linked a Cartouche wallet saved under a
-- DIFFERENT address to that login, so the wallet answered to the wrong
-- person's Google account.
--
-- The rule now: an unclaimed row on this device is gathered only if it has
-- no email (a genuinely anonymous visitor on this phone) or the same email
-- as the login. Everything else about the function is unchanged.
-- ─────────────────────────────────────────────────────────────────────

do $do$
declare
  src text;
  fixed text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'consolidate_identity';
  if src is null then
    raise exception 'consolidate_identity is missing';
  end if;
  if position('respects_saved_email' in src) > 0 then
    raise notice 'already applied';
    return;
  end if;
  -- The seed clause, as written in the live function (whitespace varies).
  fixed := regexp_replace(
    src,
    'device_id = p_device(\s+)and \(auth_user_id is null or auth_user_id = p_auth\)\)',
    'device_id = p_device\1and (auth_user_id is null or auth_user_id = p_auth)'
    || '\1-- respects_saved_email (migration 069): never a row saved under another address'
    || '\1and (coalesce(email, '''') = '''' or p_email is null or lower(email) = lower(p_email)))'
  );
  if fixed = src then
    raise exception 'could not find the device seed clause - consolidate_identity NOT changed';
  end if;
  execute fixed;
end $do$;
