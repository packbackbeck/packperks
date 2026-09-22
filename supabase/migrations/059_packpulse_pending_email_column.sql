-- 059 — packpulse_pending_batches keeps an (always empty) email column.
--
-- System health for a Deferred Tikkie venue selects `email` from
-- pending_batches (getTikkieStatsMetrics). The view left the column out, so
-- in the PackPulse embed that query failed and the bin-confirmation check
-- read as "no data". The column is back, always null: PackPulse still never
-- sees a customer's email.

create or replace view public.packpulse_pending_batches with (security_barrier = true) as
  select public.packpulse_hash(p.batch_id::text) as batch_id, p.org_id, p.user_id, p.first_seen, p.resolved_at,
         null::text as email
  from public.pending_batches p
  where p.org_id in (select unnest(public.packpulse_org_ids(array['stats'])));

revoke all on public.packpulse_pending_batches from public, anon, authenticated;
grant select on public.packpulse_pending_batches to authenticated;
