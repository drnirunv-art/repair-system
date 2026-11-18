-- KPI ตามสัญญา (เอกสารแนบ 4) รายเดือนต่อโรงพยาบาล.
-- Uses the existing kpi_monthly table (made in 0006, unused until now): one row per hospital, month and item code ('1.2', '8.3.1' ...).
-- Additive only: two columns, read/write policies for the 12-hospital executives, and one read-only function that counts
-- the figures the system already holds (PM plan vs done, repair jobs on time, response time, repeat jobs, backlog, aging, ratings).

alter table public.kpi_monthly add column if not exists updated_by uuid references public.profiles(id);
alter table public.kpi_monthly add column if not exists source text;   -- 'auto' = value from the system, 'manual' = typed by a head
-- action plan for an item that lost points: cause, corrective steps, owner, due date
alter table public.kpi_monthly add column if not exists ap_cause text;
alter table public.kpi_monthly add column if not exists ap_action text;
alter table public.kpi_monthly add column if not exists ap_owner text;
alter table public.kpi_monthly add column if not exists ap_due date;
-- RCA for that item: fishbone 4M causes (man, machine, method, material), 5 Why, and the corrective project (name, goal, budget)
alter table public.kpi_monthly add column if not exists ap_rca jsonb;

create policy "kpi exec read" on public.kpi_monthly for select to authenticated using (public.am_exec());
create policy "kpi exec write" on public.kpi_monthly for all to authenticated using (public.am_exec()) with check (public.am_exec());

-- figures for one hospital and month (CE year; a Buddhist year is turned into CE)
create or replace function public.kpi_auto(p_hospital uuid, p_year int, p_month int)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  ms timestamptz; me timestamptz; win int; code text; r jsonb := '{}'; pm record;
begin
  if not (public.am_exec() or (p_hospital is not null and exists (select 1 from public.my_hospitals() m where m.id = p_hospital))) then
    raise exception 'ไม่มีสิทธิ์ดูข้อมูลของโรงพยาบาลนี้'; end if;
  if p_year between 2463 and 2643 then p_year := p_year - 543; end if;
  ms := make_timestamptz(p_year, p_month, 1, 0, 0, 0, 'Asia/Bangkok'); me := ms + interval '1 month';
  select h.code into code from hospitals h where h.id = p_hospital;
  win := case when code = 'PLK' then 7 else 30 end;   -- 2.2 repeat window: PLK contract says 7 days, the others 30 days

  select coalesce(planned, 0) planned, coalesce(done, 0) done, coalesce(waiting_sign, 0) waiting into pm
    from public.pm_followup_core_by(p_hospital, p_year, p_month, null) where grp = 'รวม';
  r := r || jsonb_build_object('pm_planned', coalesce(pm.planned, 0), 'pm_done', coalesce(pm.done, 0), 'pm_waiting', coalesce(pm.waiting, 0), 'repeat_days', win);

  with j as (
    select j.*, p.respond_minutes, p.sla_minutes from jobs j left join priorities p on p.id = j.priority_id
    where j.hospital_id = p_hospital and j.status <> 'cancel'),
  mon as (select * from j where created_at >= ms and created_at < me),
  fin as (select *, coalesce(nullif(due_minutes, 0), sla_minutes) tgt from j where cleared_at >= ms and cleared_at < me),
  op as (select * from j where created_at < me and (cleared_at is null or cleared_at >= me) and status not in ('clear','evaluated','close'))
  select r || jsonb_build_object(
    'jobs', (select count(*) from mon),
    'finished', (select count(*) from fin),
    -- on time: finished by the planned date, or within the chosen finish time (approved pauses not counted)
    'ontime_n', (select count(*) from fin where plan_due is not null or tgt is not null),
    'ontime_ok', (select count(*) from fin where (plan_due is not null and (cleared_at at time zone 'Asia/Bangkok')::date <= plan_due)
        or (plan_due is null and tgt is not null and extract(epoch from cleared_at - created_at) / 60 - coalesce(hold_minutes, 0) <= tgt)),
    'resp_n', (select count(*) from mon where respond_minutes is not null and coalesce(accepted_at, assigned_at) is not null),
    'resp_ok', (select count(*) from mon where respond_minutes is not null and coalesce(accepted_at, assigned_at) is not null
        and extract(epoch from coalesce(accepted_at, assigned_at) - created_at) / 60 <= respond_minutes),
    -- repeat: same machine, or same place and job type, already reported within the window before
    'repeat_n', (select count(*) from mon where equipment_id is not null or (location_id is not null and job_type_id is not null)),
    'repeat_dup', (select count(*) from mon a where exists (select 1 from j b where b.id <> a.id and b.created_at < a.created_at and b.created_at >= a.created_at - make_interval(days => win)
        and ((a.equipment_id is not null and b.equipment_id = a.equipment_id) or (a.equipment_id is null and b.location_id = a.location_id and b.job_type_id = a.job_type_id)))),
    'repeat7_dup', (select count(*) from mon a where exists (select 1 from j b where b.id <> a.id and b.cleared_at is not null and b.cleared_at <= a.created_at and b.cleared_at >= a.created_at - interval '7 days'
        and ((a.equipment_id is not null and b.equipment_id = a.equipment_id) or (a.equipment_id is null and b.location_id = a.location_id and b.job_type_id = a.job_type_id)))),
    'open_end', (select count(*) from op),
    -- pauses approved by the hospital (waiting for special parts, no access, approved contractor ...) are not backlog
    'open_excl', (select count(*) from op where status = 'on_hold' and hold_status in ('ack','ack_memo')),
    'aging_over60', (select count(*) from op where created_at < me - interval '60 days'),
    'eval_n', (select count(*) from job_evaluations e join j on j.id = e.job_id where e.created_at >= ms and e.created_at < me),
    'eval_avg', (select round(avg(e.score)::numeric, 2) from job_evaluations e join j on j.id = e.job_id where e.created_at >= ms and e.created_at < me)
  ) into r;
  return r;
end $$;
revoke all on function public.kpi_auto(uuid, int, int) from public, anon;
grant execute on function public.kpi_auto(uuid, int, int) to authenticated;

-- 12-hospital table for executives: total score per hospital per month of one CE year
create or replace function public.kpi_year_all(p_year int)
returns table (code text, name text, month int, score numeric, max_score numeric, items int)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.am_exec() then raise exception 'เฉพาะผู้ที่มีสิทธิ์ดูภาพรวม 12 โรงพยาบาล'; end if;
  if p_year between 2463 and 2643 then p_year := p_year - 543; end if;
  return query select h.code, h.name, extract(month from k.month)::int, sum(k.score), sum(k.max_score), count(*)::int
    from kpi_monthly k join hospitals h on h.id = k.hospital_id
    where k.month >= make_date(p_year, 1, 1) and k.month < make_date(p_year + 1, 1, 1)
    group by h.code, h.name, extract(month from k.month) order by 1, 3;
end $$;
revoke all on function public.kpi_year_all(int) from public, anon;
grant execute on function public.kpi_year_all(int) to authenticated;
