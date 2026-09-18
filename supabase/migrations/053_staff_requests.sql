-- 053 — PackPerks Staff: access requests and a dashboard page per venue.
--
-- Anyone can now ask for a staff account at a venue that runs the app. The
-- request waits (`status = 'requested'`) until someone who runs that venue
-- approves it on the dashboard's Staff app page: a master, a manager or a
-- vendor. PackBack's own addresses (@packback.network) skip the wait.
--
-- A sign-up code can be sent before any staff row exists, so the emailed
-- code carries the venue and name the person asked with.
--
-- The Staff app page is a dashboard tab (`staffapp`): managers who can change
-- settings can change it, everyone else who sees it can view it, and viewing
-- is enough to approve or decline a request.

alter table public.staff_members drop constraint if exists staff_members_status_check;
alter table public.staff_members add constraint staff_members_status_check
  check (status in ('requested', 'invited', 'active', 'blocked'));

alter table public.staff_members
  add column if not exists requested_at timestamptz,
  add column if not exists approved_by  uuid,
  add column if not exists approved_at  timestamptz;

create index if not exists staff_members_requested_idx
  on public.staff_members (org_id) where status = 'requested';

alter table public.staff_email_codes
  add column if not exists org_id uuid references public.organizations(id) on delete cascade,
  add column if not exists name   text;

-- The new tab on the roles that list their tabs.
update public.admin_roles
   set tabs = tabs || jsonb_build_object(
         'staffapp',
         case when level = 'manager' and tabs->>'settings' = 'edit' then 'edit' else 'view' end)
 where level in ('manager', 'vendor')
   and not (tabs ? 'staffapp');
