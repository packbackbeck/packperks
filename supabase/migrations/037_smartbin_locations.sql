-- Redirect Refund: smart-bin locations shown on the customer home map,
-- managed from the dashboard (Smart Bins page).
--
-- Until now the one live bin was hardcoded in the client. Locations are
-- real operational data — bins move, open and close — so they belong in
-- a table the dashboard can edit, exactly like BYO's future vendors.
create table if not exists public.smartbin_locations (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  name        text not null,
  address     text,
  lat         double precision,
  lng         double precision,
  -- live: collecting today. coming_soon: announced, not installed yet.
  status      text not null default 'live',
  machine_id  text,          -- optional link to smartbin_keys.machine_id
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists idx_smartbin_locations_org
  on public.smartbin_locations (org_id, active, name);

alter table public.smartbin_locations enable row level security;

-- The customer map reads active pins for its org (no PII here).
drop policy if exists "smartbin_locations: public read" on public.smartbin_locations;
create policy "smartbin_locations: public read" on public.smartbin_locations
  for select using (active = true);

-- Admins manage them from the dashboard.
drop policy if exists "smartbin_locations: admin all" on public.smartbin_locations;
create policy "smartbin_locations: admin all" on public.smartbin_locations
  for all using ((current_admin()).id is not null)
  with check ((current_admin()).id is not null);

-- The Receipt Generator's history marks which batches the BIN requested
-- (vs the ones an admin generated at a desk), so admins need to read the
-- session log. Still no customer/anon access.
drop policy if exists "bin_sessions: admins read" on public.bin_sessions;
create policy "bin_sessions: admins read" on public.bin_sessions
  for select using ((current_admin()).id is not null);

-- Seeded once (guarded): the live Titaan bin plus the venue list the
-- operator provided. Coordinates are geocoded from the addresses; a few
-- resolved to street/city level and can be nudged from the dashboard.
do $$
begin
  if not exists (select 1 from public.smartbin_locations where org_id = 'da6f18cc-7493-4547-b54e-4987de2606b4') then
    insert into public.smartbin_locations (org_id, name, address, lat, lng) values
  ('da6f18cc-7493-4547-b54e-4987de2606b4', 'Titaan Smart Bin', 'RAI Amsterdam', 52.3411, 4.8887),
  ('da6f18cc-7493-4547-b54e-4987de2606b4', 'Rotterdam', 'Lijnbaan 100, 3012 ER Rotterdam', 51.919879, 4.477664),
  ('da6f18cc-7493-4547-b54e-4987de2606b4', 'Rotterdam', 'Watermanweg 333, 3067 GA Rotterdam', 51.951144, 4.556526),
  ('da6f18cc-7493-4547-b54e-4987de2606b4', 'Hoofddorp', 'Rijksweg A4 1, 2132 MA Hoofddorp', 52.260049, 4.68631),
  ('da6f18cc-7493-4547-b54e-4987de2606b4', 'Amsterdam', 'Tafelbergweg 4, 1105 BN Amsterdam', 52.291855, 4.947563),
  ('da6f18cc-7493-4547-b54e-4987de2606b4', 'Amsterdam', 'Reguliersbreestraat 15, 1017 CL Amsterdam', 52.366815, 4.894289),
  ('da6f18cc-7493-4547-b54e-4987de2606b4', 'Amsterdam', 'Isolatorweg 25, 1014 AS Amsterdam', 52.392553, 4.8504),
  ('da6f18cc-7493-4547-b54e-4987de2606b4', 'Son en Breugel', 'Ekkersrijt 4019, 5692 DB Son en Breugel', 51.500017, 5.472747),
  ('da6f18cc-7493-4547-b54e-4987de2606b4', 'Kerkrade', 'Roda JC Ring 2A, 6466 NH Kerkrade', 50.874909, 6.059385),
  ('da6f18cc-7493-4547-b54e-4987de2606b4', 'Amsterdam', 'Leidseplein 7, 1017 PR Amsterdam', 52.364178, 4.883512),
  ('da6f18cc-7493-4547-b54e-4987de2606b4', 'Amsterdam', 'Nieuwendijk 218, 1012 MX Amsterdam', 52.373783, 4.892728),
  ('da6f18cc-7493-4547-b54e-4987de2606b4', 'Roosendaal', 'Borchwerf 2, Roosendaal', 51.557044, 4.477513),
  ('da6f18cc-7493-4547-b54e-4987de2606b4', 'Waalwijk', 'Van Andelstraat 17, 5141 Waalwijk', 51.689014, 5.04209),
  ('da6f18cc-7493-4547-b54e-4987de2606b4', 'Wijdewormer', 'Leeghwaterstraat 3, 1456 NB Wijdewormer', 52.506488, 4.917143),
  ('da6f18cc-7493-4547-b54e-4987de2606b4', 'Groningen', 'Waagstraat 3, 9712 JX Groningen', 53.21847, 6.565828),
  ('da6f18cc-7493-4547-b54e-4987de2606b4', 'Delfgauw', 'A13 10, 2645 BS Delfgauw', 52.009584, 4.395635),
  ('da6f18cc-7493-4547-b54e-4987de2606b4', 'Delft', 'A13 202, 2629 HA Delft', 51.981595, 4.394047),
  ('da6f18cc-7493-4547-b54e-4987de2606b4', 'Apeldoorn', 'De Voorwaarts 9, 7321 MA Apeldoorn', 52.208541, 5.994789),
  ('da6f18cc-7493-4547-b54e-4987de2606b4', 'Veenendaal', 'Rondweg-West 244a, 3905 LV Veenendaal', 52.040775, 5.555154),
  ('da6f18cc-7493-4547-b54e-4987de2606b4', 'Vlaardingen', 'Schiedamsedijk 18, 3134 KK Vlaardingen', 51.905703, 4.368438),
  ('da6f18cc-7493-4547-b54e-4987de2606b4', 'Schiedam', '''s-Gravelandseweg 414, 3125 BK Schiedam', 51.928331, 4.403205),
  ('da6f18cc-7493-4547-b54e-4987de2606b4', 'Venlo', 'Columbusweg 51, 5928 LA Venlo', 51.3971, 6.08814),
  ('da6f18cc-7493-4547-b54e-4987de2606b4', 'Beesd', 'A2 1, 4153 ZA Beesd', 51.884089, 5.191636),
  ('da6f18cc-7493-4547-b54e-4987de2606b4', 'Bleiswijk', 'Jadestraat 6, 2665 NJ Bleiswijk', 52.041444, 4.540405),
  ('da6f18cc-7493-4547-b54e-4987de2606b4', 'Honselersdijk', 'Boswoning 7, 2675 DZ Honselersdijk', 52.006349, 4.213366),
  ('da6f18cc-7493-4547-b54e-4987de2606b4', 'Assen', 'Burgemeester Grollemanweg 6, 9405 TD Assen', 52.959924, 6.546964),
  ('da6f18cc-7493-4547-b54e-4987de2606b4', 'Purmerend', 'Visserijweg 4, 1446 AR Purmerend', 52.51363, 5.014526),
  ('da6f18cc-7493-4547-b54e-4987de2606b4', 'Sliedrecht', 'Sopraanweg 1, 3363 LS Sliedrecht', 51.831825, 4.739772),
  ('da6f18cc-7493-4547-b54e-4987de2606b4', 'Breda', 'Bagven 3, 4838 EH Breda', 51.578978, 4.720891),
  ('da6f18cc-7493-4547-b54e-4987de2606b4', 'Duiven', 'Droom 11, 6921 PX Duiven', 51.968532, 5.988491);
  end if;
end $$;
