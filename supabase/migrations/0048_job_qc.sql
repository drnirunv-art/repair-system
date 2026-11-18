-- ตรวจคุณภาพงานซ่อม (Quality Supervisor) ตามสัญญาข้อ 3.20: QS ตรวจงานซ่อมไม่น้อยกว่า 80% ต่อวัน.
-- Additive only: one new table (one QS check per job), a save function for heads, and a per-day summary.
-- The existing "ตรวจแล้ว ปิดงาน" / "ส่งกลับแก้ไข" buttons and job_transition stay as they are.

create table if not exists public.job_qc (
  id bigint generated always as identity primary key,
  job_id uuid not null unique references public.jobs(id) on delete cascade,
  hospital_id uuid not null references public.hospitals(id),
  result text not null check (result in ('pass', 'fail')),
  items jsonb not null default '{}',     -- {"done":true,"clean":true,"test":true,"inform":true,"photo":true,"safe":true}
  note text,
  checked_by uuid references public.profiles(id),
  checked_at timestamptz not null default now()
);
create index if not exists job_qc_hosp_idx on public.job_qc (hospital_id, checked_at);
alter table public.job_qc enable row level security;
do $p$ begin
  if not exists (select 1 from pg_policies where tablename = 'job_qc' and policyname = 'qc staff read') then
    create policy "qc staff read" on public.job_qc for select to authenticated
      using (public.am_exec() or hospital_id in (select m.id from public.my_hospitals() m)); end if;
end $p$;

-- a head (Owner/Admin/Chief/Supervisor) records the QS check of a finished job; saving again replaces the earlier check
create or replace function public.qc_save(p_job_id uuid, p_result text, p_items jsonb default '{}', p_note text default null)
returns public.job_qc language plpgsql security definer set search_path = public as $$
declare j jobs; r job_qc; who text;
begin
  select * into j from jobs where id = p_job_id;
  if j.id is null then raise exception 'ไม่พบใบงาน'; end if;
  if not public.is_manager() or not (public.am_exec() or j.hospital_id in (select m.id from public.my_hospitals() m)) then
    raise exception 'เฉพาะหัวหน้า (Owner / Admin / Chief Engineer / Supervisor) ของโรงพยาบาลนี้ที่ตรวจคุณภาพงานได้'; end if;
  if j.status not in ('clear', 'evaluated', 'close') then raise exception 'ตรวจคุณภาพได้เมื่อช่างกด "ซ่อมเสร็จ" แล้วเท่านั้น'; end if;
  if p_result not in ('pass', 'fail') then raise exception 'เลือกผล ผ่าน หรือ ไม่ผ่าน'; end if;
  if p_result = 'fail' and coalesce(trim(p_note), '') = '' then raise exception 'ไม่ผ่าน: กรุณาเขียนสิ่งที่ต้องแก้'; end if;
  insert into job_qc (job_id, hospital_id, result, items, note, checked_by, checked_at)
    values (j.id, j.hospital_id, p_result, coalesce(p_items, '{}'), nullif(trim(p_note), ''), auth.uid(), now())
    on conflict (job_id) do update set result = excluded.result, items = excluded.items, note = excluded.note,
      checked_by = excluded.checked_by, checked_at = excluded.checked_at
    returning * into r;
  select full_name into who from profiles where id = auth.uid();
  insert into job_events (job_id, status, note, actor_id) values (j.id, j.status,
    'ตรวจคุณภาพ (QS): ' || case when p_result = 'pass' then 'ผ่าน' else 'ไม่ผ่าน' end || coalesce(' · ' || nullif(trim(p_note), ''), '') || ' โดย ' || coalesce(who, '-'), auth.uid());
  return r;
end $$;

-- per day (Bangkok date the technician pressed "ซ่อมเสร็จ"): jobs finished, how many have a QS check, passed, % checked (target 80)
create or replace function public.qc_daily(p_hospital uuid, p_from date, p_to date)
returns table (day date, finished int, checked int, passed int, pct numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.am_exec() or p_hospital in (select m.id from public.my_hospitals() m)) then
    raise exception 'ไม่มีสิทธิ์ดูข้อมูลของโรงพยาบาลนี้'; end if;
  return query
  with f as (
    select (j.cleared_at at time zone 'Asia/Bangkok')::date d, q.result
    from jobs j left join job_qc q on q.job_id = j.id
    where j.hospital_id = p_hospital and j.status <> 'cancel' and j.cleared_at is not null
      and (j.cleared_at at time zone 'Asia/Bangkok')::date between p_from and p_to)
  select f.d, count(*)::int, count(f.result)::int, count(*) filter (where f.result = 'pass')::int,
         round(100.0 * count(f.result) / count(*), 1)
  from f group by f.d order by f.d;
end $$;

revoke execute on function public.qc_save(uuid, text, jsonb, text), public.qc_daily(uuid, date, date) from public, anon;
grant execute on function public.qc_save(uuid, text, jsonb, text), public.qc_daily(uuid, date, date) to authenticated;
grant select on public.job_qc to authenticated;
