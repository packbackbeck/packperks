-- 044 — Only published settings are public; rotate the cron secret.
--
-- app_config was readable in full with the public key. Besides venue
-- settings it holds staff email addresses (digest and alert recipients) and
-- `digest_cron`, the shared secret that lets send-digest, send-report and
-- notify-event run without a login. Anyone who read it could trigger those
-- emails.
--
-- The customer app only reads `published` and `published:*` rows
-- (src/lib/api.js, groups.js, RegionContext.jsx, ModelChooser.jsx). The
-- dashboard reads the rest with a staff login; edge functions and the cron
-- job use the service role or run as the database owner.

drop policy if exists "public_read" on public.app_config;
drop policy if exists "app_config: public read published" on public.app_config;
create policy "app_config: public read published" on public.app_config
  for select to anon, authenticated
  using (key = 'published' or key like 'published:%');
drop policy if exists "app_config: staff read" on public.app_config;
create policy "app_config: staff read" on public.app_config
  for select to authenticated
  using ((current_admin()).id is not null);

-- The old secret was public, so replace it. The cron job and the
-- notification trigger read it at run time; nothing else stores it.
update public.app_config
   set value = jsonb_set(value, '{secret}',
         to_jsonb(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))),
       updated_at = now()
 where key = 'digest_cron';
