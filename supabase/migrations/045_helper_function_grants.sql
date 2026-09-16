-- 045 — Keep 043's internal helpers internal.
--
-- These are only called from SECURITY DEFINER functions (which run as their
-- owner), so the public and signed-in roles never need to call them directly.
-- published_reward, venue_refund_rate, is_staff_writer and owns_user stay
-- callable: row-level policies and the invoker-rights claim trigger use them,
-- and they only return public settings or facts about the caller.
revoke execute on function public.assert_can_claim(uuid) from public, anon, authenticated;
revoke execute on function public.venue_flag(uuid, text, boolean) from public, anon, authenticated;
revoke execute on function public.venue_settings(uuid) from public, anon, authenticated;
revoke execute on function public.venue_payment_method(uuid) from public, anon, authenticated;
grant execute on function public.assert_can_claim(uuid) to service_role;
grant execute on function public.venue_flag(uuid, text, boolean) to service_role;
grant execute on function public.venue_settings(uuid) to service_role;
grant execute on function public.venue_payment_method(uuid) to service_role;

-- Flagged by the Supabase linter: pin the search path like every other function.
alter function public.config_number(jsonb) set search_path = public;
