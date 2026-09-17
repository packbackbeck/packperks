-- 051 — Only dashboard accounts can read the cups table.
--
-- `cups` held two read policies with `using (true)`, for anon and for every
-- signed-in login. With the public key anyone could list unclaimed cup ids
-- (948 at the time) and claim them through claim-cups, which accepts a list
-- of ids. That includes a PackPerks Staff code during its 15 minutes.
--
-- Nothing outside the dashboard reads the table: the customer app claims
-- through claim-cups, and every edge function uses the service role. The
-- dashboard's readers are signed-in dashboard accounts.

drop policy if exists "cups: anon read" on public.cups;
drop policy if exists "cups: authed read" on public.cups;

create policy "cups: dashboard read" on public.cups
  for select to authenticated
  using ((public.current_admin()).id is not null);
