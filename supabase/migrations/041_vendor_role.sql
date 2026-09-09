-- Vendor: a read-only dashboard account for the venue's own staff.
-- Sees five pages (Overview, Rewards & offers, Reports & alerts, System
-- health, User behaviour) and can change nothing. Adding the value to
-- both role constraints is all the database needs — the page-level
-- gating lives in the admin shell (AdminSidebar / AdminApp) and the
-- action-level gating in hasPermission(), which grants 'view' only.
alter table public.admin_profiles
  drop constraint if exists admin_profiles_role_check;
alter table public.admin_profiles
  add constraint admin_profiles_role_check
  check (role = any (array['owner'::text, 'admin'::text, 'manager'::text, 'checker'::text, 'vendor'::text]));

alter table public.admin_invitations
  drop constraint if exists admin_invitations_role_check;
alter table public.admin_invitations
  add constraint admin_invitations_role_check
  check (role = any (array['admin'::text, 'manager'::text, 'checker'::text, 'vendor'::text]));
