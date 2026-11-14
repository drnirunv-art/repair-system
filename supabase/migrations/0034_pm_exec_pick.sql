-- 0034 PM Inhouse / PM MA (pm.html): the 12-hospital viewers (am_exec) pick any hospital and see its PM work, sign-offs,
-- results and follow-up table, read only. Additive: three read policies and one function; nothing existing changes.
create policy "pm tasks exec read" on public.pm_tasks for select to authenticated using (public.am_exec());
create policy "pm templates exec read" on public.pm_templates for select to authenticated using (public.am_exec());
create policy "profiles exec read" on public.profiles for select to authenticated using (public.am_exec());

-- follow-up table of one hospital: the hospital's own staff, or a 12-hospital viewer for any hospital
create or replace function public.pm_followup_for(p_hospital uuid, p_year int, p_month int, p_by text default null)
returns table (grp text, planned bigint, done bigint, waiting_sign bigint, not_done bigint, abnormal bigint, pct int, ytd_planned bigint, ytd_done bigint, ytd_pct int)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.am_exec() or (p_hospital is not null and p_hospital = public.my_hospital())) then raise exception 'ไม่มีสิทธิ์ดูข้อมูลของโรงพยาบาลนี้'; end if;
  if p_year between 2463 and 2643 then p_year := p_year - 543; end if;
  return query select * from public.pm_followup_core_by(p_hospital, p_year, p_month, nullif(upper(p_by), ''));
end $$;
revoke all on function public.pm_followup_for(uuid, int, int, text) from public, anon;
grant execute on function public.pm_followup_for(uuid, int, int, text) to authenticated;
