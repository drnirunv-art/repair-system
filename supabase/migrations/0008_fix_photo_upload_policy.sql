-- 0004's insert policy compared the folder against hospitals.name (column name clash),
-- so every photo upload was rejected. Additive fix: a correct policy alongside it.
create policy "upload job photos by hospital folder" on storage.objects for insert to anon, authenticated
with check (
  bucket_id = 'job-photos'
  and exists (select 1 from public.hospitals h where h.code = (storage.foldername(objects.name))[1] and h.active)
);
