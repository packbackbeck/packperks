-- Pin search_path on the three functions Supabase's linter flagged.
--
-- current_admin() matters most: it is SECURITY DEFINER and resolves the
-- unqualified name `admin_profiles`, so with a caller-controlled search_path
-- a schema placed earlier in the path could shadow that table and answer
-- "yes, you're an admin". The two trigger functions are lower risk (invoker
-- rights, schema-qualified tables) but take the same setting for uniformity.
-- No behaviour change: every object they touch lives in public.
alter function public.current_admin()     set search_path = public;
alter function public.cup_scans_set_org() set search_path = public;
alter function public.set_org_from_user() set search_path = public;
