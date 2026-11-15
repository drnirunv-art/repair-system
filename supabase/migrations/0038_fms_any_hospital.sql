-- FMS Round: committee members (owner/admin/chief engineer/supervisor/safety officer) may choose any of the
-- 12 hospitals when inspecting (user 2026-11-15: JCI focus on PT2, but allow all). Additive only.

create or replace function public.fms_in(h uuid) returns boolean language sql stable security definer set search_path = public as
$$ select h is not null and (public.fms_can() or public.am_exec()) $$;

create policy "fms items read committee" on public.fms_items for select to authenticated using (public.fms_can());
create policy "fms rounds read committee" on public.fms_rounds for select to authenticated using (public.fms_can());
create policy "fms checks read committee" on public.fms_checks for select to authenticated using (public.fms_can());
create policy "fms findings read committee" on public.fms_findings for select to authenticated using (public.fms_can());

-- walk-round photos (uploaded as <CODE>/<date>/fms-<uuid>) readable by the committee of any hospital
create policy "fms photos read committee" on storage.objects for select to authenticated
  using (bucket_id = 'job-photos' and name like '%/fms-%' and public.fms_can());
