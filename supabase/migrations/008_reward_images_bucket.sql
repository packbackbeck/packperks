-- Public bucket for reward images. Reward images are shown to every
-- customer in the user app — they're not sensitive — so we keep this
-- bucket public-read with authenticated-write. The Reward editor's
-- "Upload from device" button mints files into this bucket and writes
-- the public URL back to `reward.image`.
insert into storage.buckets (id, name, public)
values ('reward-images', 'reward-images', true)
on conflict (id) do update set public = true;

drop policy if exists "reward-images: public read"   on storage.objects;
drop policy if exists "reward-images: authed write"  on storage.objects;

create policy "reward-images: public read"
  on storage.objects for select to public
  using (bucket_id = 'reward-images');

create policy "reward-images: authed write"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'reward-images');
