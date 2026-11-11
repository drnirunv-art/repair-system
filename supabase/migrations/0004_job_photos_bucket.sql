-- Private bucket for repair photos: anyone can upload under an active hospital code folder; only that hospital's staff can read
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('job-photos', 'job-photos', false, 5242880, array['image/jpeg','image/png','image/webp']);

create policy "anyone uploads job photos" on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'job-photos' and exists (select 1 from public.hospitals h where h.code = (storage.foldername(name))[1] and h.active));
create policy "staff read job photos" on storage.objects for select to authenticated
  using (bucket_id = 'job-photos' and (storage.foldername(name))[1] = (select code from public.hospitals where id = public.my_hospital()));
