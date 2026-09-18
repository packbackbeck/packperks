-- 055 — Dashboard accounts see the staff of the venues they run.
--
-- The Staff app page (Programme) is for managers and vendors too, and the
-- sidebar counts the people asking for access at the open venue. Reading
-- staff_members was master-only (migration 050); now any active dashboard
-- account can read the rows of an organisation it sees (admin_sees_org,
-- migration 048). Writes stay with masters here: everything else goes
-- through the staff-app edge function, which checks the role's Staff app tab.

drop policy if exists "staff_members: dashboard read" on public.staff_members;
create policy "staff_members: dashboard read" on public.staff_members
  for select to authenticated using (public.admin_sees_org(org_id));
