-- 047 — The dashboard audit log records staff actions again.
--
-- logAction() (src/admin/auth/actionLog.js) writes the open venue's id on
-- each row. Staff accounts have no venue of their own (org_id null), and the
-- old rules compared the row's venue with the account's, which never matches
-- null. So every staff action taken with a venue open was refused, and the
-- log recorded nothing after 31 July 2026. The same comparison hid other
-- people's entries from global owners and admins.
--
-- Now: any active dashboard account may log its own actions. Staff may log
-- them under any venue; a vendor only under its own. Owners and admins read
-- the whole log (a venue-scoped owner or admin, only its venue). Everyone
-- still reads their own entries. The log stays append-only: there is no
-- update or delete rule. A customer login can no longer write to it.

drop policy if exists "audit: self insert" on public.admin_action_log;
create policy "audit: self insert" on public.admin_action_log
  for insert to authenticated
  with check (
    actor_id = auth.uid()
    and (current_admin()).id is not null
    and (org_id is null
         or (current_admin()).org_id is null
         or org_id = (current_admin()).org_id)
  );

drop policy if exists "audit: org owner+admin read" on public.admin_action_log;
drop policy if exists "audit: owner+admin read" on public.admin_action_log;
create policy "audit: owner+admin read" on public.admin_action_log
  for select to authenticated
  using ((current_admin()).role in ('owner', 'admin')
         and ((current_admin()).org_id is null or org_id = (current_admin()).org_id));
