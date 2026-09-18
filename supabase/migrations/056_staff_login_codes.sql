-- 056 — PackPerks Staff: sign in with an emailed code.
--
-- PackBack's own addresses (@packback.network) sign in to the staff app with
-- a one-time code instead of a password. The staff-app function checks the
-- code, then hands the app a one-time sign-in token for that login.

alter table public.staff_email_codes drop constraint if exists staff_email_codes_purpose_check;
alter table public.staff_email_codes add constraint staff_email_codes_purpose_check
  check (purpose in ('signup', 'reset', 'email_change', 'login'));
