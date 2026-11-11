-- Phase C: shifts + roster with check-in, 3-shift daily report with handover, monthly report notes,
-- knowledge base of fixes, and a 12-hospital overview for executives. Additive only.

alter table public.hospital_settings add column if not exists late_grace_min int not null default 15;

-- shifts (default เช้า / บ่าย / ดึก for every hospital) -------------------------------------------
create table if not exists public.shifts (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null references public.hospitals(id) on delete cascade,
  name text not null,
  start_time time not null,
  end_time time not null,            -- end <= start means the shift ends the next day
  sort int not null default 0,
  active boolean not null default true,
  unique (hospital_id, name)
);
alter table public.shifts enable row level security;
create policy "shifts staff read" on public.shifts for select to authenticated using (hospital_id = public.my_hospital());
create policy "shifts managers add" on public.shifts for insert to authenticated with check (hospital_id = public.my_hospital() and public.is_manager());
create policy "shifts managers edit" on public.shifts for update to authenticated
  using (hospital_id = public.my_hospital() and public.is_manager()) with check (hospital_id = public.my_hospital());
grant select, insert, update on public.shifts to authenticated;

insert into public.shifts (hospital_id, name, start_time, end_time, sort)
select h.id, s.name, s.st::time, s.en::time, s.sort
from public.hospitals h cross join (values ('เช้า', '08:00', '16:00', 1), ('บ่าย', '16:00', '00:00', 2), ('ดึก', '00:00', '08:00', 3)) s(name, st, en, sort)
on conflict (hospital_id, name) do nothing;

-- new hospitals get the same three shifts
create or replace function public.hospitals_default_shifts() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.shifts (hospital_id, name, start_time, end_time, sort)
  values (new.id, 'เช้า', '08:00', '16:00', 1), (new.id, 'บ่าย', '16:00', '00:00', 2), (new.id, 'ดึก', '00:00', '08:00', 3)
  on conflict (hospital_id, name) do nothing;
  return new;
end $$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'hospitals_default_shifts') then
    create trigger hospitals_default_shifts after insert on public.hospitals for each row execute function public.hospitals_default_shifts();
  end if;
end $$;

create or replace function public.shift_window(p_date date, p_shift_id uuid, out s timestamptz, out e timestamptz)
language sql stable security definer set search_path = public as $$
  select (p_date + x.start_time) at time zone 'Asia/Bangkok',
         ((p_date + case when x.end_time <= x.start_time then 1 else 0 end) + x.end_time) at time zone 'Asia/Bangkok'
  from public.shifts x where x.id = p_shift_id
$$;

-- roster: who works which shift, plus their own check-in time ----------------------------------------
create table if not exists public.shift_roster (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null references public.hospitals(id) on delete cascade,
  work_date date not null,
  shift_id uuid not null references public.shifts(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  check_in_at timestamptz,
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  unique (work_date, shift_id, profile_id)
);
create or replace function public.profile_in_my_hospital(p_id uuid) returns boolean
language sql stable security definer set search_path = public as
$$ select exists (select 1 from public.profiles where id = p_id and hospital_id = public.my_hospital()) $$;
grant execute on function public.profile_in_my_hospital(uuid) to authenticated;
create index if not exists shift_roster_hosp_idx on public.shift_roster (hospital_id, work_date);
alter table public.shift_roster enable row level security;
create policy "roster staff read" on public.shift_roster for select to authenticated using (hospital_id = public.my_hospital());
create policy "roster managers add" on public.shift_roster for insert to authenticated
  with check (hospital_id = public.my_hospital() and public.is_manager() and check_in_at is null
    and exists (select 1 from public.shifts s where s.id = shift_id and s.hospital_id = public.my_hospital())
    and public.profile_in_my_hospital(profile_id));
create policy "roster managers remove" on public.shift_roster for delete to authenticated
  using (hospital_id = public.my_hospital() and public.is_manager());
grant select, delete on public.shift_roster to authenticated;
grant insert (hospital_id, work_date, shift_id, profile_id) on public.shift_roster to authenticated;

-- a technician stamps their own check-in once, on the day of the shift (from 2 hours before it starts)
create or replace function public.roster_checkin(p_roster_id uuid) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare r public.shift_roster; w record;
begin
  select * into r from public.shift_roster where id = p_roster_id for update;
  if r.id is null or r.profile_id <> auth.uid() then raise exception 'ลงเวลาได้เฉพาะชื่อของตัวเอง'; end if;
  if r.check_in_at is not null then return r.check_in_at; end if;
  select * into w from public.shift_window(r.work_date, r.shift_id);
  if now() < w.s - interval '2 hours' or now() > w.e then raise exception 'ลงเวลาได้ตั้งแต่ 2 ชั่วโมงก่อนเริ่มกะจนจบกะ'; end if;
  update public.shift_roster set check_in_at = now() where id = r.id;
  return now();
end $$;
revoke execute on function public.roster_checkin(uuid) from public, anon;
grant execute on function public.roster_checkin(uuid) to authenticated;

-- 3-shift daily report with handover --------------------------------------------------------------
create table if not exists public.shift_reports (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null references public.hospitals(id) on delete cascade,
  work_date date not null,
  shift_id uuid not null references public.shifts(id) on delete cascade,
  author_id uuid references public.profiles(id),
  stats jsonb not null default '{}',
  notes text, handover text, issues text,
  status text not null default 'draft' check (status in ('draft','submitted','received')),
  submitted_at timestamptz,
  received_by uuid references public.profiles(id), received_at timestamptz, received_note text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (hospital_id, work_date, shift_id)
);
alter table public.shift_reports enable row level security;
create policy "shift reports staff read" on public.shift_reports for select to authenticated using (hospital_id = public.my_hospital());
grant select on public.shift_reports to authenticated;

-- numbers for one shift, filled in automatically from the job history
create or replace function public.shift_stats(p_date date, p_shift_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare h uuid; w record; out jsonb;
begin
  select hospital_id into h from public.shifts where id = p_shift_id;
  if h is null or h <> public.my_hospital() then raise exception 'ไม่พบกะนี้'; end if;
  select * into w from public.shift_window(p_date, p_shift_id);
  with ev as (
    select e.status, e.job_id from public.job_events e join public.jobs j on j.id = e.job_id
    where j.hospital_id = h and e.created_at >= w.s and e.created_at < w.e)
  select jsonb_build_object(
    'from', w.s, 'to', w.e,
    'received', (select count(*) from public.jobs where hospital_id = h and created_at >= w.s and created_at < w.e),
    'assigned', (select count(distinct job_id) from ev where status = 'assign'),
    'started', (select count(distinct job_id) from ev where status = 'work_on'),
    'held', (select count(distinct job_id) from ev where status = 'on_hold'),
    'cleared', (select count(distinct job_id) from ev where status = 'clear'),
    'closed', (select count(distinct job_id) from ev where status = 'close'),
    'cancelled', (select count(distinct job_id) from ev where status = 'cancel'),
    'open_end', (select count(*) from public.jobs where hospital_id = h and created_at < w.e and status <> 'cancel' and (closed_at is null or closed_at >= w.e)),
    'received_jobs', coalesce((select jsonb_agg(job_no order by created_at) from (select job_no, created_at from public.jobs where hospital_id = h and created_at >= w.s and created_at < w.e order by created_at limit 200) x), '[]'),
    'cleared_jobs', coalesce((select jsonb_agg(distinct j.job_no) from ev join public.jobs j on j.id = ev.job_id where ev.status in ('clear','close')), '[]')
  ) into out;
  return out;
end $$;
revoke execute on function public.shift_stats(date, uuid) from public, anon;
grant execute on function public.shift_stats(date, uuid) to authenticated;

create or replace function public.shift_report_save(p_date date, p_shift_id uuid, p_notes text, p_handover text, p_issues text, p_submit boolean default false)
returns uuid language plpgsql security definer set search_path = public as $$
declare h uuid := public.my_hospital(); r public.shift_reports; st jsonb;
begin
  if h is null or public.my_role() = 'observer' then raise exception 'ไม่มีสิทธิ์เขียนรายงานกะ'; end if;
  if not exists (select 1 from public.shifts where id = p_shift_id and hospital_id = h) then raise exception 'ไม่พบกะนี้'; end if;
  st := public.shift_stats(p_date, p_shift_id);
  select * into r from public.shift_reports where hospital_id = h and work_date = p_date and shift_id = p_shift_id for update;
  if r.id is null then
    insert into public.shift_reports (hospital_id, work_date, shift_id, author_id, stats, notes, handover, issues, status, submitted_at)
    values (h, p_date, p_shift_id, auth.uid(), st, nullif(trim(p_notes), ''), nullif(trim(p_handover), ''), nullif(trim(p_issues), ''),
      case when p_submit then 'submitted' else 'draft' end, case when p_submit then now() end)
    returning * into r;
    return r.id;
  end if;
  if r.status = 'received' then raise exception 'กะถัดไปรับเวรแล้ว แก้ไขไม่ได้'; end if;
  if r.author_id <> auth.uid() and not public.is_manager() then raise exception 'แก้ได้เฉพาะผู้เขียนหรือหัวหน้า'; end if;
  update public.shift_reports set stats = st, notes = nullif(trim(p_notes), ''), handover = nullif(trim(p_handover), ''), issues = nullif(trim(p_issues), ''),
    status = case when p_submit or r.status = 'submitted' then 'submitted' else 'draft' end,
    submitted_at = coalesce(r.submitted_at, case when p_submit then now() end), updated_at = now()
  where id = r.id;
  return r.id;
end $$;
revoke execute on function public.shift_report_save(date, uuid, text, text, text, boolean) from public, anon;
grant execute on function public.shift_report_save(date, uuid, text, text, text, boolean) to authenticated;

create or replace function public.shift_report_receive(p_id uuid, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare r public.shift_reports;
begin
  select * into r from public.shift_reports where id = p_id for update;
  if r.id is null or r.hospital_id <> public.my_hospital() then raise exception 'ไม่พบรายงาน'; end if;
  if public.my_role() = 'observer' then raise exception 'ไม่มีสิทธิ์รับเวร'; end if;
  if r.status <> 'submitted' then raise exception 'รับเวรได้หลังผู้เขียนกดส่งรายงานแล้ว'; end if;
  if r.author_id = auth.uid() then raise exception 'ผู้รับเวรต้องเป็นคนในกะถัดไป ไม่ใช่ผู้เขียนรายงาน'; end if;
  update public.shift_reports set status = 'received', received_by = auth.uid(), received_at = now(), received_note = nullif(trim(p_note), ''), updated_at = now() where id = p_id;
end $$;
revoke execute on function public.shift_report_receive(uuid, text) from public, anon;
grant execute on function public.shift_report_receive(uuid, text) to authenticated;

-- monthly report: the chief's own summary and next month's plan ---------------------------------
create table if not exists public.monthly_notes (
  hospital_id uuid not null references public.hospitals(id) on delete cascade,
  month text not null check (month ~ '^\d{4}-\d{2}$'),
  summary text, plan text,
  updated_by uuid references public.profiles(id) default auth.uid(),
  updated_at timestamptz not null default now(),
  primary key (hospital_id, month)
);
alter table public.monthly_notes enable row level security;
create policy "monthly notes staff read" on public.monthly_notes for select to authenticated using (hospital_id = public.my_hospital());
create policy "monthly notes managers add" on public.monthly_notes for insert to authenticated with check (hospital_id = public.my_hospital() and public.is_manager());
create policy "monthly notes managers edit" on public.monthly_notes for update to authenticated
  using (hospital_id = public.my_hospital() and public.is_manager()) with check (hospital_id = public.my_hospital());
grant select, insert, update on public.monthly_notes to authenticated;

-- knowledge base of fixes (can be shared with the other hospitals) ---------------------------------
create table if not exists public.kb_articles (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null references public.hospitals(id) on delete cascade,
  title text not null,
  job_type_id uuid references public.job_types(id) on delete set null,
  equipment_text text,
  symptom text, cause text, solution text not null,
  tags text,
  job_id uuid references public.jobs(id) on delete set null,
  shared boolean not null default false,
  active boolean not null default true,
  author_id uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists kb_hosp_idx on public.kb_articles (hospital_id, created_at desc);
alter table public.kb_articles enable row level security;
create policy "kb read own or shared" on public.kb_articles for select to authenticated
  using (hospital_id = public.my_hospital() or (shared and active and public.my_hospital() is not null));
create policy "kb staff add" on public.kb_articles for insert to authenticated
  with check (hospital_id = public.my_hospital() and public.my_role() <> 'observer' and author_id = auth.uid());
create policy "kb author or manager edit" on public.kb_articles for update to authenticated
  using (hospital_id = public.my_hospital() and (author_id = auth.uid() or public.is_manager())) with check (hospital_id = public.my_hospital());
grant select on public.kb_articles to authenticated;
grant insert (hospital_id, title, job_type_id, equipment_text, symptom, cause, solution, tags, job_id, shared, author_id) on public.kb_articles to authenticated;
grant update (title, job_type_id, equipment_text, symptom, cause, solution, tags, shared, active, updated_at) on public.kb_articles to authenticated;

-- 12-hospital overview: only people listed in exec_viewers (added by the system builder) -----------
create table if not exists public.exec_viewers (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.exec_viewers enable row level security;
create policy "exec viewers see self" on public.exec_viewers for select to authenticated using (profile_id = auth.uid());
grant select on public.exec_viewers to authenticated;
insert into public.exec_viewers (profile_id) select id from public.profiles where role = 'owner' on conflict do nothing;

create or replace function public.am_exec() returns boolean
language sql stable security definer set search_path = public as
$$ select exists (select 1 from public.exec_viewers v join public.profiles p on p.id = v.profile_id where v.profile_id = auth.uid() and p.active) $$;
grant execute on function public.am_exec() to authenticated;

create or replace function public.exec_overview(p_from date, p_to date)
returns table (code text, name text, received bigint, cleared bigint, closed bigint, open_now bigint, late_open bigint, on_hold bigint,
  hold_pending bigint, avg_close_min int, sla_ok_pct int, rating_avg numeric, rating_n bigint, parts_cost numeric, pr_pending bigint, pr_value numeric)
language plpgsql stable security definer set search_path = public as $$
declare s timestamptz := p_from::timestamp at time zone 'Asia/Bangkok'; e timestamptz := (p_to + 1)::timestamp at time zone 'Asia/Bangkok';
begin
  if not public.am_exec() then raise exception 'เฉพาะผู้บริหารที่ได้รับสิทธิ์ดูภาพรวม'; end if;
  return query
  select h.code, h.name,
    (select count(*) from jobs j where j.hospital_id = h.id and j.created_at >= s and j.created_at < e),
    (select count(*) from jobs j where j.hospital_id = h.id and j.cleared_at >= s and j.cleared_at < e),
    (select count(*) from jobs j where j.hospital_id = h.id and j.status = 'close' and j.closed_at >= s and j.closed_at < e),
    (select count(*) from jobs j where j.hospital_id = h.id and j.status in ('register','assign','work_on','on_hold','clear')),
    (select count(*) from jobs j left join priorities p on p.id = j.priority_id where j.hospital_id = h.id and j.status in ('register','assign','work_on','on_hold')
       and public.job_work_minutes(j) > coalesce(p.sla_minutes, 1440)),
    (select count(*) from jobs j where j.hospital_id = h.id and j.status = 'on_hold'),
    (select count(*) from jobs j where j.hospital_id = h.id and j.status = 'on_hold' and j.hold_status = 'pending'),
    (select round(avg(public.job_work_minutes(j, j.closed_at)))::int from jobs j where j.hospital_id = h.id and j.status = 'close' and j.closed_at >= s and j.closed_at < e),
    (select round(100.0 * count(*) filter (where public.job_work_minutes(j, j.cleared_at) <= coalesce(p.sla_minutes, 1440)) / nullif(count(*), 0))::int
       from jobs j left join priorities p on p.id = j.priority_id where j.hospital_id = h.id and j.cleared_at >= s and j.cleared_at < e),
    (select round(avg(j.rating), 2) from jobs j where j.hospital_id = h.id and j.rated_at >= s and j.rated_at < e),
    (select count(*) from jobs j where j.hospital_id = h.id and j.rated_at >= s and j.rated_at < e and j.rating is not null),
    (select coalesce(-sum(m.qty * m.unit_cost), 0) from part_moves m where m.hospital_id = h.id and m.kind in ('issue','return') and m.created_at >= s and m.created_at < e),
    (select count(*) from purchase_requests r where r.hospital_id = h.id and r.status = 'requested'),
    (select coalesce(sum(r.total), 0) from purchase_requests r where r.hospital_id = h.id and r.status in ('approved','ordered','received') and r.decided_at >= s and r.decided_at < e)
  from hospitals h where h.active order by h.code;
end $$;
revoke execute on function public.exec_overview(date, date) from public, anon;
grant execute on function public.exec_overview(date, date) to authenticated;

-- live updates for the shift page
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['shift_reports','shift_roster'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;
