-- 0056 Water Management Program (JCI 8th FMS.08.04): register of water sampling points per hospital, a test plan per point
-- (parameter, limits, frequency), results checked against the limits, and every out-of-range result opening a corrective action
-- that can become a repair job. Three water groups (user 2026-11-25): น้ำกินดื่ม (drinking water dispensers), น้ำใช้ (tap water,
-- cooling tower Legionella, RO for dialysis and CSSD, hot water) and น้ำเสีย (wastewater treatment); every test is one of two types:
-- ตรวจเชื้อ (microbiological) or สารเคมี (chemical / physical).
-- Additive only: new tables, functions, policies and a central template list. Nothing existing is changed.
-- Limits in the template are starting values from the references named in each row; each hospital edits its own plan
-- to match its Water Management Plan approved by the IC / Environment of Care committee.

create table if not exists public.water_templates (
  id bigint generated always as identity primary key,
  system text not null,                 -- DW / POT / CT / RO_HD / RO_CSSD / HW / WW
  code text not null unique,
  param text not null,
  unit text,
  kind text not null default 'num' check (kind in ('num', 'detect', 'pf')),   -- num = number vs lo/hi · detect = พบ / ไม่พบ · pf = ผ่าน / ไม่ผ่าน
  lo numeric, hi numeric, warn numeric, -- warn = alert level before the limit (upper limits only)
  freq text not null check (freq in ('D', 'W', 'M', 'Q', 'S', 'Y')),
  ref text, method text, note text,
  test_type text not null default 'chem' check (test_type in ('bio', 'chem')),   -- bio = ตรวจเชื้อ · chem = สารเคมี
  sort int not null default 0
);

create table if not exists public.water_points (
  id bigint generated always as identity primary key,
  hospital_id uuid not null references public.hospitals(id),
  system text not null check (system in ('DW', 'POT', 'CT', 'RO_HD', 'RO_CSSD', 'HW', 'WW', 'WW_IN', 'WW_AER', 'OTH')),   -- WW = น้ำทิ้งหลังบำบัด · WW_IN = น้ำเสียเข้าระบบ · WW_AER = บ่อเติมอากาศ
  code text not null,
  name text not null,
  location text,
  note text,
  active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create unique index if not exists water_points_code_uq on public.water_points (hospital_id, lower(code));

create table if not exists public.water_plans (
  id bigint generated always as identity primary key,
  point_id bigint not null references public.water_points(id),
  hospital_id uuid not null references public.hospitals(id),
  template_code text,
  param text not null,
  unit text,
  kind text not null default 'num' check (kind in ('num', 'detect', 'pf')),
  lo numeric, hi numeric, warn numeric,
  freq text not null check (freq in ('D', 'W', 'M', 'Q', 'S', 'Y')),
  ref text, method text, note text,
  test_type text not null default 'chem' check (test_type in ('bio', 'chem')),
  sort int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists water_plans_point_idx on public.water_plans (point_id);
create index if not exists water_plans_hosp_idx on public.water_plans (hospital_id, active);
alter table public.water_templates add column if not exists test_type text not null default 'chem';
alter table public.water_plans add column if not exists test_type text not null default 'chem';

create table if not exists public.water_results (
  id bigint generated always as identity primary key,
  plan_id bigint not null references public.water_plans(id),
  hospital_id uuid not null references public.hospitals(id),
  sampled_on date not null,
  value numeric,
  qual text check (qual in ('nd', 'detected', 'pass', 'fail')),
  lab text, report_no text, note text,
  lo numeric, hi numeric, warn numeric,  -- the limits at the time of the test
  status text not null default 'pass' check (status in ('pass', 'warn', 'fail')),
  recorded_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
alter table public.water_results add column if not exists val_text text;   -- the value as the lab wrote it, e.g. <0.1, ND, >16,000
create index if not exists water_results_plan_idx on public.water_results (plan_id, sampled_on desc);
create index if not exists water_results_hosp_idx on public.water_results (hospital_id, sampled_on desc);

create table if not exists public.water_actions (
  id bigint generated always as identity primary key,
  result_id bigint not null unique references public.water_results(id),
  hospital_id uuid not null references public.hospitals(id),
  status text not null default 'open' check (status in ('open', 'done')),
  problem text,
  cause text, action text, owner text, due date,
  job_id uuid references public.jobs(id),
  job_no text,
  retest_result_id bigint references public.water_results(id),
  closed_by uuid references public.profiles(id),
  closed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists water_actions_hosp_idx on public.water_actions (hospital_id, status);
alter table public.water_actions add column if not exists job_no text;

-- who may do what: record results = any staff (not observer) of that hospital; manage the register, plans and close actions = heads; executives everywhere
create or replace function public.water_can_record(h uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.am_exec() or (coalesce(public.my_role() <> 'observer', false) and h in (select m.id from public.my_hospitals() m)) $$;
create or replace function public.water_can_manage(h uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.am_exec() or (public.is_manager() and h in (select m.id from public.my_hospitals() m)) $$;
create or replace function public.water_can_read(h uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.am_exec() or h in (select m.id from public.my_hospitals() m) $$;

-- a number as people write it: 1500 / 0.25 (no trailing zeros or dot)
create or replace function public.water_num(v numeric) returns text
language sql immutable as $$ select rtrim(to_char(v, 'FM999999990.999'), '.') $$;

-- the three water groups: น้ำกินดื่ม / น้ำใช้ / น้ำเสีย
create or replace function public.water_group(sys text) returns text
language sql immutable as $$ select case when sys = 'DW' then 'DRINK' when sys like 'WW%' then 'WASTE' else 'USE' end $$;

create or replace function public.water_freq_interval(f text) returns interval
language sql immutable as $$
  select case f when 'D' then interval '1 day' when 'W' then interval '7 days' when 'M' then interval '1 month'
    when 'Q' then interval '3 months' when 'S' then interval '6 months' else interval '12 months' end $$;

alter table public.water_templates enable row level security;
alter table public.water_points enable row level security;
alter table public.water_plans enable row level security;
alter table public.water_results enable row level security;
alter table public.water_actions enable row level security;

do $p$ begin
  if not exists (select 1 from pg_policies where tablename = 'water_templates' and policyname = 'wt read') then
    create policy "wt read" on public.water_templates for select to authenticated using (true); end if;

  if not exists (select 1 from pg_policies where tablename = 'water_points' and policyname = 'wpt read') then
    create policy "wpt read" on public.water_points for select to authenticated using (public.water_can_read(hospital_id)); end if;
  if not exists (select 1 from pg_policies where tablename = 'water_points' and policyname = 'wpt write') then
    create policy "wpt write" on public.water_points for insert to authenticated with check (public.water_can_manage(hospital_id)); end if;
  if not exists (select 1 from pg_policies where tablename = 'water_points' and policyname = 'wpt edit') then
    create policy "wpt edit" on public.water_points for update to authenticated
      using (public.water_can_manage(hospital_id)) with check (public.water_can_manage(hospital_id)); end if;

  if not exists (select 1 from pg_policies where tablename = 'water_plans' and policyname = 'wpl read') then
    create policy "wpl read" on public.water_plans for select to authenticated using (public.water_can_read(hospital_id)); end if;
  if not exists (select 1 from pg_policies where tablename = 'water_plans' and policyname = 'wpl write') then
    create policy "wpl write" on public.water_plans for insert to authenticated
      with check (public.water_can_manage(hospital_id) and exists (select 1 from public.water_points p where p.id = point_id and p.hospital_id = water_plans.hospital_id)); end if;
  if not exists (select 1 from pg_policies where tablename = 'water_plans' and policyname = 'wpl edit') then
    create policy "wpl edit" on public.water_plans for update to authenticated
      using (public.water_can_manage(hospital_id)) with check (public.water_can_manage(hospital_id)); end if;

  if not exists (select 1 from pg_policies where tablename = 'water_results' and policyname = 'wr read') then
    create policy "wr read" on public.water_results for select to authenticated using (public.water_can_read(hospital_id)); end if;
  if not exists (select 1 from pg_policies where tablename = 'water_results' and policyname = 'wr write') then
    create policy "wr write" on public.water_results for insert to authenticated with check (public.water_can_record(hospital_id)); end if;

  if not exists (select 1 from pg_policies where tablename = 'water_actions' and policyname = 'wa read') then
    create policy "wa read" on public.water_actions for select to authenticated using (public.water_can_read(hospital_id)); end if;
end $p$;

grant select on public.water_templates to authenticated;
grant select, insert, update on public.water_points, public.water_plans to authenticated;
grant select, insert on public.water_results to authenticated;
grant select on public.water_actions to authenticated;

-- a result takes its hospital and limits from its plan and is graded here, so nobody can save a wrong grade
create or replace function public.water_result_grade() returns trigger
language plpgsql security definer set search_path = public as $$
declare pl water_plans;
begin
  select * into pl from water_plans where id = new.plan_id;
  if pl.id is null then raise exception 'ไม่พบรายการตรวจ'; end if;
  new.hospital_id := pl.hospital_id; new.lo := pl.lo; new.hi := pl.hi; new.warn := pl.warn;
  new.recorded_by := coalesce(new.recorded_by, auth.uid());
  if new.sampled_on > (now() at time zone 'Asia/Bangkok')::date then raise exception 'วันที่เก็บตัวอย่างต้องไม่เป็นวันในอนาคต'; end if;
  if pl.kind = 'num' then
    if new.value is null then raise exception 'กรอกค่าที่ตรวจได้ของ "%"', pl.param; end if;
    new.qual := null;
    new.status := case when (pl.lo is not null and new.value < pl.lo) or (pl.hi is not null and new.value > pl.hi) then 'fail'
                       when pl.warn is not null and new.value >= pl.warn then 'warn' else 'pass' end;
  elsif pl.kind = 'detect' then
    if new.qual not in ('nd', 'detected') then raise exception 'เลือกผล พบ / ไม่พบ ของ "%"', pl.param; end if;
    new.status := case when new.qual = 'detected' then 'fail' else 'pass' end;
  else
    if new.qual not in ('pass', 'fail') then raise exception 'เลือกผล ผ่าน / ไม่ผ่าน ของ "%"', pl.param; end if;
    new.status := new.qual;
  end if;
  return new;
end $$;

-- an out-of-range result opens a corrective action at once
create or replace function public.water_result_action() returns trigger
language plpgsql security definer set search_path = public as $$
declare pl water_plans; pt water_points;
begin
  if new.status <> 'fail' then return new; end if;
  select * into pl from water_plans where id = new.plan_id;
  select * into pt from water_points where id = pl.point_id;
  insert into water_actions (result_id, hospital_id, problem, due)
  values (new.id, new.hospital_id,
    pt.code || ' ' || pt.name || ' · ' || pl.param || ' = ' ||
    case when pl.kind = 'num' then public.water_num(new.value) || coalesce(' ' || pl.unit, '')
         when new.qual = 'detected' then 'พบ' else 'ไม่ผ่าน' end ||
    case when pl.kind = 'num' then ' (เกณฑ์ ' || coalesce(public.water_num(pl.lo) || ' ถึง ', 'ไม่เกิน ') || coalesce(public.water_num(pl.hi), 'ไม่มีขั้นบน') || ')'
         when pl.kind = 'detect' then ' (เกณฑ์ ต้องไม่พบ)' else '' end ||
    ' วันที่เก็บตัวอย่าง ' || to_char(new.sampled_on, 'DD/MM/') || (extract(year from new.sampled_on)::int + 543),
    (now() at time zone 'Asia/Bangkok')::date + 7)
  on conflict (result_id) do nothing;
  return new;
end $$;

drop trigger if exists water_result_grade on public.water_results;
create trigger water_result_grade before insert on public.water_results for each row execute function public.water_result_grade();
drop trigger if exists water_result_action on public.water_results;
create trigger water_result_action after insert on public.water_results for each row execute function public.water_result_action();

-- add a sampling point; with p_template the point gets the standard tests of its system at once
create or replace function public.water_add_point(p_hospital uuid, p_system text, p_code text, p_name text, p_location text, p_template boolean default true) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  if not public.water_can_manage(p_hospital) then raise exception 'เฉพาะหัวหน้าของโรงนี้เพิ่มจุดตรวจได้'; end if;
  if coalesce(trim(p_code), '') = '' or coalesce(trim(p_name), '') = '' then raise exception 'กรอกรหัสและชื่อจุดตรวจ'; end if;
  if exists (select 1 from water_points where hospital_id = p_hospital and lower(code) = lower(trim(p_code))) then raise exception 'รหัสจุดตรวจ % มีแล้วในโรงนี้', trim(p_code); end if;
  insert into water_points (hospital_id, system, code, name, location, created_by)
  values (p_hospital, p_system, trim(p_code), trim(p_name), nullif(trim(coalesce(p_location, '')), ''), auth.uid()) returning id into v_id;
  if p_template then
    insert into water_plans (point_id, hospital_id, template_code, param, unit, kind, lo, hi, warn, freq, ref, method, note, test_type, sort)
    select v_id, p_hospital, t.code, t.param, t.unit, t.kind, t.lo, t.hi, t.warn, t.freq, t.ref, t.method, t.note, t.test_type, t.sort
    from water_templates t where t.system = p_system order by t.sort;
  end if;
  return v_id;
end $$;

-- corrective action: anyone who may record writes cause / action / owner / due; heads close it (an action needs to be written first)
create or replace function public.water_action_save(p_id bigint, p_cause text, p_action text, p_owner text, p_due date, p_close boolean default false, p_retest bigint default null) returns text
language plpgsql security definer set search_path = public as $$
declare a water_actions;
begin
  select * into a from water_actions where id = p_id for update;
  if a.id is null or not public.water_can_record(a.hospital_id) then raise exception 'ไม่พบรายการ หรือไม่มีสิทธิ์'; end if;
  if p_close and not public.water_can_manage(a.hospital_id) then raise exception 'ปิดรายการได้เฉพาะหัวหน้าของโรงนี้'; end if;
  if p_close and coalesce(trim(p_action), '') = '' then raise exception 'ปิดรายการต้องเขียนการแก้ไขที่ทำแล้ว'; end if;
  if p_retest is not null and not exists (select 1 from water_results r join water_results o on o.id = a.result_id
      where r.id = p_retest and r.plan_id = o.plan_id and r.sampled_on >= o.sampled_on and r.id <> o.id) then
    raise exception 'ผลตรวจซ้ำต้องเป็นรายการเดียวกัน และเก็บตัวอย่างหลังวันที่พบปัญหา'; end if;
  update water_actions set cause = nullif(trim(coalesce(p_cause, '')), ''), action = nullif(trim(coalesce(p_action, '')), ''),
    owner = nullif(trim(coalesce(p_owner, '')), ''), due = p_due, retest_result_id = coalesce(p_retest, retest_result_id),
    status = case when p_close then 'done' else status end,
    closed_by = case when p_close then auth.uid() else closed_by end, closed_at = case when p_close then now() else closed_at end
  where id = p_id;
  return 'ok';
end $$;

-- corrective action → repair job (same numbering as every other job)
create or replace function public.water_to_job(p_id bigint) returns text
language plpgsql security definer set search_path = public as $$
declare a water_actions; pt water_points; h hospitals; per text; n int; v_no text; jid uuid; prio uuid; me profiles;
begin
  select * into a from water_actions where id = p_id for update;
  if a.id is null or not public.water_can_record(a.hospital_id) then raise exception 'ไม่พบรายการ หรือไม่มีสิทธิ์'; end if;
  if a.job_id is not null then select job_no into v_no from jobs where id = a.job_id; return v_no; end if;
  select p.* into pt from water_points p join water_plans pl on pl.point_id = p.id join water_results r on r.plan_id = pl.id where r.id = a.result_id;
  select * into h from hospitals where id = a.hospital_id;
  select * into me from profiles where id = auth.uid();
  per := to_char((now() at time zone 'Asia/Bangkok') + interval '543 years', 'YYMM');
  insert into job_counters (hospital_id, period, last_no) values (h.id, per, 1)
    on conflict (hospital_id, period) do update set last_no = job_counters.last_no + 1 returning last_no into n;
  v_no := h.code || '-' || per || '-' || lpad(n::text, 4, '0');
  select id into prio from priorities where hospital_id = h.id and is_default limit 1;
  insert into jobs (job_no, hospital_id, department, detail, reporter_name, reporter_phone, priority_id)
  values (v_no, h.id, coalesce(pt.location, pt.name), '[Water Management] ผลตรวจน้ำนอกเกณฑ์: ' || coalesce(a.problem, '') ||
    coalesce(E'\nสาเหตุ: ' || a.cause, '') || coalesce(E'\nการแก้ไขที่วางไว้: ' || a.action, ''), coalesce(me.full_name, 'Water Management'), 'WATER', prio)
  returning id into jid;
  insert into job_events (job_id, status, note) values (jid, 'register', 'เปิดจากผลตรวจน้ำนอกเกณฑ์ (Water Management) โดย ' || coalesce(me.full_name, '-'));
  update water_actions set job_id = jid, job_no = v_no where id = a.id;
  return v_no;
end $$;

-- 12-hospital overview for executives (and each person's own hospitals)
create or replace function public.water_overview() returns table (code text, name text, points bigint, plans bigint, overdue bigint, never bigint,
  results_90 bigint, fail_90 bigint, open_actions bigint, last_test date, fail_bio_90 bigint, fail_chem_90 bigint)
language sql stable security definer set search_path = public as $$
  with pl as (
    select p.id, p.hospital_id, p.freq, (select max(r.sampled_on) from water_results r where r.plan_id = p.id) last
    from water_plans p join water_points w on w.id = p.point_id
    where p.active and w.active and public.water_can_read(p.hospital_id))
  select h.code, h.name,
    (select count(*) from water_points w where w.hospital_id = h.id and w.active),
    (select count(*) from pl where pl.hospital_id = h.id),
    (select count(*) from pl where pl.hospital_id = h.id and pl.last is not null and (pl.last + public.water_freq_interval(pl.freq))::date < (now() at time zone 'Asia/Bangkok')::date),
    (select count(*) from pl where pl.hospital_id = h.id and pl.last is null),
    (select count(*) from water_results r where r.hospital_id = h.id and r.sampled_on >= (now() at time zone 'Asia/Bangkok')::date - 90),
    (select count(*) from water_results r where r.hospital_id = h.id and r.sampled_on >= (now() at time zone 'Asia/Bangkok')::date - 90 and r.status = 'fail'),
    (select count(*) from water_actions a where a.hospital_id = h.id and a.status = 'open'),
    (select max(pl.last) from pl where pl.hospital_id = h.id),
    (select count(*) from water_results r join water_plans p on p.id = r.plan_id where r.hospital_id = h.id and r.sampled_on >= (now() at time zone 'Asia/Bangkok')::date - 90 and r.status = 'fail' and p.test_type = 'bio'),
    (select count(*) from water_results r join water_plans p on p.id = r.plan_id where r.hospital_id = h.id and r.sampled_on >= (now() at time zone 'Asia/Bangkok')::date - 90 and r.status = 'fail' and p.test_type = 'chem')
  from hospitals h where public.water_can_read(h.id) order by h.code $$;

revoke all on function public.water_can_record(uuid), public.water_can_manage(uuid), public.water_can_read(uuid), public.water_add_point(uuid, text, text, text, text, boolean),
  public.water_action_save(bigint, text, text, text, date, boolean, bigint), public.water_to_job(bigint), public.water_overview(),
  public.water_result_grade(), public.water_result_action() from public, anon;
grant execute on function public.water_can_record(uuid), public.water_can_manage(uuid), public.water_can_read(uuid), public.water_add_point(uuid, text, text, text, text, boolean),
  public.water_action_save(bigint, text, text, text, date, boolean, bigint), public.water_to_job(bigint), public.water_overview(), public.water_freq_interval(text), public.water_num(numeric), public.water_group(text) to authenticated;

-- central starting values (each hospital edits its own plan to match its approved Water Management Plan)
insert into public.water_templates (system, code, param, unit, kind, lo, hi, warn, freq, ref, method, note, sort, test_type)
select v.* from (values
  ('CT', 'CT01', 'Legionella spp. (เพาะเชื้อ)', 'CFU/L', 'num', null::numeric, 1000::numeric, 100::numeric, 'Q', 'FMS.08.04 · HSE ACOP L8 · ASHRAE 188', 'ส่งห้องปฏิบัติการที่ได้รับรอง ISO/IEC 17025', 'ตั้งแต่ 100 ทบทวนการควบคุมและเพิ่มสารฆ่าเชื้อ ถ้าเกิน 1,000 ฆ่าเชื้อแบบเข้มข้น (Shock dose) ล้างทำความสะอาด แล้วตรวจซ้ำ', 1, 'bio'),
  ('CT', 'CT02', 'จุลินทรีย์ทั้งหมด (TBC / Dip slide)', 'CFU/mL', 'num', null, 100000, 10000, 'M', 'HSE ACOP L8', 'Dip slide หรือส่งห้องปฏิบัติการ', 'ตั้งแต่ 10,000 ทบทวนการบำบัดน้ำ ถ้าเกิน 100,000 ฆ่าเชื้อและตรวจ Legionella เพิ่ม', 2, 'bio'),
  ('CT', 'CT03', 'ค่าความเป็นกรด-ด่าง (pH)', null, 'num', 7.0, 9.0, null, 'W', 'คำแนะนำผู้รับเหมาเคมีบำบัดน้ำ', 'ชุดทดสอบหรือเครื่องวัด pH', null, 3, 'chem'),
  ('CT', 'CT04', 'ค่าการนำไฟฟ้า (Conductivity)', 'µS/cm', 'num', null, 3000, null, 'W', 'คำแนะนำผู้รับเหมาเคมีบำบัดน้ำ', 'เครื่องวัดค่าการนำไฟฟ้า', 'ตั้งตามรอบความเข้มข้น (Cycle) ที่ผู้รับเหมาเคมีกำหนด เกินเกณฑ์ให้ระบายน้ำทิ้ง (Blowdown)', 4, 'chem'),
  ('CT', 'CT05', 'สารฆ่าเชื้อคงเหลือ (Free chlorine / Oxidising biocide)', 'mg/L', 'num', 0.5, 2.0, null, 'W', 'HSE ACOP L8', 'ชุดทดสอบ DPD', 'ถ้าใช้สารฆ่าเชื้อชนิดไม่ออกซิไดซ์ ให้แก้เกณฑ์ตามผู้ผลิต', 5, 'chem'),
  ('RO_HD', 'HD01', 'จุลินทรีย์ทั้งหมด (Total viable count) น้ำ RO ไตเทียม', 'CFU/mL', 'num', null, 100, 50, 'M', 'ISO 23500-3 · AAMI', 'เก็บที่จุดจ่ายน้ำ RO และปลายท่อวน (Loop)', 'ตั้งแต่ 50 คือระดับเฝ้าระวัง ต้องฆ่าเชื้อระบบ RO และท่อจ่าย แล้วตรวจซ้ำ', 1, 'bio'),
  ('RO_HD', 'HD02', 'Endotoxin น้ำ RO ไตเทียม', 'EU/mL', 'num', null, 0.25, 0.125, 'M', 'ISO 23500-3 · AAMI', 'LAL test', 'ตั้งแต่ 0.125 คือระดับเฝ้าระวัง ต้องฆ่าเชื้อระบบ RO แล้วตรวจซ้ำ', 2, 'bio'),
  ('RO_HD', 'HD03', 'ค่าการนำไฟฟ้าน้ำ RO ไตเทียม', 'µS/cm', 'num', null, 10, null, 'D', 'ISO 23500-2', 'อ่านจากเครื่องวัดที่ตัวเครื่อง RO ทุกวันก่อนเริ่มฟอกไต', 'เกินเกณฑ์ให้หยุดจ่ายน้ำ แจ้งหน่วยไตเทียม และตรวจเมมเบรน', 3, 'chem'),
  ('RO_HD', 'HD04', 'คลอรีนรวม (Total chlorine) หลังถังคาร์บอน', 'mg/L', 'num', null, 0.1, null, 'D', 'ISO 23500-3', 'ชุดทดสอบ DPD ก่อนเริ่มฟอกไตทุกวัน', 'เกินเกณฑ์ห้ามใช้น้ำฟอกไต ตรวจถังคาร์บอนสำรองและเปลี่ยนสารกรอง', 4, 'chem'),
  ('RO_HD', 'HD05', 'สารเคมีปนเปื้อนตาม ISO 23500-3 (อะลูมิเนียม ตะกั่ว ทองแดง ฟลูออไรด์ ฯลฯ)', null, 'pf', null, null, null, 'Y', 'ISO 23500-3', 'ส่งห้องปฏิบัติการที่ได้รับรอง ISO/IEC 17025', 'แนบรายงานผลจากห้องปฏิบัติการ', 5, 'chem'),
  ('RO_CSSD', 'CS01', 'ค่าการนำไฟฟ้าน้ำ RO หน่วยจ่ายกลาง', 'µS/cm', 'num', null, 10, null, 'D', 'AAMI ST108 (Critical water)', 'อ่านจากเครื่องวัดที่ตัวเครื่อง RO', 'เกินเกณฑ์ให้แจ้งหน่วยจ่ายกลาง หยุดใช้ล้างรอบสุดท้าย และตรวจเมมเบรน', 1, 'chem'),
  ('RO_CSSD', 'CS02', 'จุลินทรีย์ทั้งหมด น้ำ RO หน่วยจ่ายกลาง', 'CFU/mL', 'num', null, 10, null, 'M', 'AAMI ST108 (Critical water)', 'ส่งห้องปฏิบัติการ', 'เกินเกณฑ์ให้ฆ่าเชื้อระบบ RO แล้วตรวจซ้ำ', 2, 'bio'),
  ('RO_CSSD', 'CS03', 'Endotoxin น้ำ RO หน่วยจ่ายกลาง', 'EU/mL', 'num', null, 10, null, 'Q', 'AAMI ST108 (Critical water)', 'LAL test', 'เกินเกณฑ์ให้ฆ่าเชื้อระบบ RO แล้วตรวจซ้ำ', 3, 'bio'),
  ('RO_CSSD', 'CS04', 'ค่าความเป็นกรด-ด่าง (pH) น้ำ RO หน่วยจ่ายกลาง', null, 'num', 5.0, 7.5, null, 'M', 'AAMI ST108', 'เครื่องวัด pH', null, 4, 'chem'),
  ('POT', 'PO01', 'คลอรีนอิสระคงเหลือที่ก๊อกปลายทาง', 'mg/L', 'num', 0.2, 0.5, null, 'W', 'เกณฑ์คุณภาพน้ำประปาดื่มได้ กรมอนามัย · เกณฑ์เสนอแนะคุณภาพน้ำบริโภคเพื่อการเฝ้าระวัง (ประกาศกรมอนามัย 13 ต.ค. 2553)', 'ชุดทดสอบ DPD สุ่มก๊อกปลายทางหมุนเวียนแต่ละชั้น', 'ต่ำกว่าเกณฑ์ให้เติมคลอรีนที่ถังเก็บน้ำและตรวจซ้ำ', 1, 'chem'),
  ('POT', 'PO02', 'ค่าความเป็นกรด-ด่าง (pH) น้ำประปา', null, 'num', 6.5, 8.5, null, 'M', 'เกณฑ์คุณภาพน้ำประปาดื่มได้ กรมอนามัย · เกณฑ์เสนอแนะคุณภาพน้ำบริโภคเพื่อการเฝ้าระวัง (ประกาศกรมอนามัย 13 ต.ค. 2553)', 'เครื่องวัด pH', null, 2, 'chem'),
  ('POT', 'PO03', 'ความขุ่น (Turbidity)', 'NTU', 'num', null, 5, null, 'M', 'เกณฑ์คุณภาพน้ำประปาดื่มได้ กรมอนามัย · เกณฑ์เสนอแนะคุณภาพน้ำบริโภคเพื่อการเฝ้าระวัง (ประกาศกรมอนามัย 13 ต.ค. 2553)', 'เครื่องวัดความขุ่น', 'เกินเกณฑ์ให้ล้างถังเก็บน้ำ / เปลี่ยนไส้กรอง', 3, 'chem'),
  ('POT', 'PO04', 'โคลิฟอร์มทั้งหมด (Total coliform)', null, 'detect', null, null, null, 'M', 'เกณฑ์คุณภาพน้ำประปาดื่มได้ กรมอนามัย · เกณฑ์เสนอแนะคุณภาพน้ำบริโภคเพื่อการเฝ้าระวัง (ประกาศกรมอนามัย 13 ต.ค. 2553)', 'ส่งห้องปฏิบัติการ หรือชุดทดสอบ อ.11', 'พบให้เติมคลอรีน ล้างถังเก็บน้ำ แจ้งคณะกรรมการ IC และตรวจซ้ำ', 4, 'bio'),
  ('POT', 'PO05', 'อี. โคไล (E. coli)', null, 'detect', null, null, null, 'Q', 'เกณฑ์คุณภาพน้ำประปาดื่มได้ กรมอนามัย · เกณฑ์เสนอแนะคุณภาพน้ำบริโภคเพื่อการเฝ้าระวัง (ประกาศกรมอนามัย 13 ต.ค. 2553)', 'ส่งห้องปฏิบัติการ', 'พบให้หยุดใช้น้ำดื่มจากจุดนั้นทันที แจ้งคณะกรรมการ IC และตรวจซ้ำ', 5, 'bio'),
  ('HW', 'HW01', 'อุณหภูมิน้ำร้อนที่ถังเก็บ (Calorifier)', '°C', 'num', 60, null, null, 'M', 'HSE ACOP L8 / HTM 04-01', 'เทอร์โมมิเตอร์', 'ต่ำกว่า 60 °C เสี่ยงต่อ Legionella ให้ปรับตั้งอุณหภูมิ', 1, 'chem'),
  ('HW', 'HW02', 'อุณหภูมิน้ำร้อนที่ก๊อกปลายทาง (หลังเปิด 1 นาที)', '°C', 'num', 50, null, null, 'M', 'HSE ACOP L8 / HTM 04-01', 'เทอร์โมมิเตอร์ สุ่มก๊อกไกลที่สุดของแต่ละโซน', 'ต่ำกว่า 50 °C ให้ตรวจปั๊มวนน้ำร้อนและฉนวนท่อ', 2, 'chem'),
  ('HW', 'HW03', 'Legionella spp. ที่ก๊อกน้ำร้อน / ฝักบัว หอผู้ป่วยกลุ่มเสี่ยง', 'CFU/L', 'num', null, 1000, 100, 'S', 'FMS.08.04 · HSE ACOP L8', 'ส่งห้องปฏิบัติการที่ได้รับรอง ISO/IEC 17025', 'ตั้งแต่ 100 ทบทวนการควบคุม ถ้าเกิน 1,000 ฆ่าเชื้อด้วยความร้อนหรือคลอรีน แล้วตรวจซ้ำ', 3, 'bio')
) v(system, code, param, unit, kind, lo, hi, warn, freq, ref, method, note, sort, test_type)
where not exists (select 1 from public.water_templates t where t.code = v.code);

-- น้ำกินดื่ม (ตู้กดน้ำดื่ม / เครื่องกรองน้ำดื่ม) and น้ำเสีย (ระบบบำบัดน้ำเสีย): starting values, each hospital edits its own plan
insert into public.water_templates (system, code, param, unit, kind, lo, hi, warn, freq, ref, method, note, sort, test_type)
select v.* from (values
  ('DW', 'DW01', 'โคลิฟอร์มทั้งหมด (Total coliform) น้ำดื่ม', null, 'detect', null::numeric, null::numeric, null::numeric, 'M', 'ประกาศกระทรวงสาธารณสุข ฉบับที่ 61 (พ.ศ. 2524) เรื่อง น้ำบริโภคในภาชนะบรรจุที่ปิดสนิท และฉบับแก้ไขเพิ่มเติม (โคลิฟอร์มน้อยกว่า 2.2 ต่อ 100 มิลลิลิตร)', 'ส่งห้องปฏิบัติการ หรือชุดทดสอบ อ.11 สุ่มตู้กดน้ำดื่มหมุนเวียน', 'พบให้หยุดใช้ตู้นั้น ล้างฆ่าเชื้อ เปลี่ยนไส้กรอง แจ้งคณะกรรมการ IC และตรวจซ้ำ', 1, 'bio'),
  ('DW', 'DW02', 'อี. โคไล (E. coli) น้ำดื่ม', null, 'detect', null, null, null, 'Q', 'ประกาศกระทรวงสาธารณสุข ฉบับที่ 61 (พ.ศ. 2524) เรื่อง น้ำบริโภคในภาชนะบรรจุที่ปิดสนิท และฉบับแก้ไขเพิ่มเติม', 'ส่งห้องปฏิบัติการ', 'พบให้หยุดใช้ตู้นั้นทันที ล้างฆ่าเชื้อ แจ้งคณะกรรมการ IC และตรวจซ้ำ', 2, 'bio'),
  ('DW', 'DW03', 'สแตฟิโลค็อกคัส ออเรียส (Staphylococcus aureus) น้ำดื่ม', null, 'detect', null, null, null, 'S', 'ประกาศกระทรวงสาธารณสุข ฉบับที่ 61 (พ.ศ. 2524) เรื่อง น้ำบริโภคในภาชนะบรรจุที่ปิดสนิท และฉบับแก้ไขเพิ่มเติม', 'ส่งห้องปฏิบัติการ', 'พบให้หยุดใช้ ล้างฆ่าเชื้อหัวจ่ายและถังพัก แล้วตรวจซ้ำ', 3, 'bio'),
  ('DW', 'DW04', 'ค่าความเป็นกรด-ด่าง (pH) น้ำดื่ม', null, 'num', 6.5, 8.5, null, 'M', 'ประกาศกระทรวงสาธารณสุข ฉบับที่ 61 (พ.ศ. 2524) เรื่อง น้ำบริโภคในภาชนะบรรจุที่ปิดสนิท และฉบับแก้ไขเพิ่มเติม', 'เครื่องวัด pH', null, 4, 'chem'),
  ('DW', 'DW05', 'ความขุ่น (Turbidity) น้ำดื่ม', 'NTU', 'num', null, 5, null, 'M', 'ประกาศกระทรวงสาธารณสุข ฉบับที่ 61 (พ.ศ. 2524) เรื่อง น้ำบริโภคในภาชนะบรรจุที่ปิดสนิท และฉบับแก้ไขเพิ่มเติม', 'เครื่องวัดความขุ่น', 'เกินเกณฑ์ให้เปลี่ยนไส้กรองและล้างถังพัก', 5, 'chem'),
  ('DW', 'DW06', 'ของแข็งละลายน้ำทั้งหมด (TDS) น้ำดื่ม', 'mg/L', 'num', null, 500, null, 'M', 'ประกาศกระทรวงสาธารณสุข ฉบับที่ 61 (พ.ศ. 2524) เรื่อง น้ำบริโภคในภาชนะบรรจุที่ปิดสนิท และฉบับแก้ไขเพิ่มเติม', 'เครื่องวัด TDS', 'เกินเกณฑ์ให้ตรวจเมมเบรน RO ของเครื่องกรอง', 6, 'chem'),
  ('DW', 'DW07', 'ความกระด้างทั้งหมด (Hardness as CaCO3) น้ำดื่ม', 'mg/L', 'num', null, 100, null, 'S', 'ประกาศกระทรวงสาธารณสุข ฉบับที่ 61 (พ.ศ. 2524) เรื่อง น้ำบริโภคในภาชนะบรรจุที่ปิดสนิท และฉบับแก้ไขเพิ่มเติม', 'ส่งห้องปฏิบัติการ', null, 7, 'chem'),
  ('DW', 'DW08', 'ไนเตรต (Nitrate as N) น้ำดื่ม', 'mg/L', 'num', null, 4, null, 'Y', 'ประกาศกระทรวงสาธารณสุข ฉบับที่ 61 (พ.ศ. 2524) เรื่อง น้ำบริโภคในภาชนะบรรจุที่ปิดสนิท และฉบับแก้ไขเพิ่มเติม', 'ส่งห้องปฏิบัติการ', null, 8, 'chem'),
  ('DW', 'DW09', 'ตะกั่ว (Lead) น้ำดื่ม', 'mg/L', 'num', null, 0.01, null, 'Y', 'ประกาศกระทรวงสาธารณสุข ฉบับที่ 61 (พ.ศ. 2524) เรื่อง น้ำบริโภคในภาชนะบรรจุที่ปิดสนิท และฉบับแก้ไขเพิ่มเติม', 'ส่งห้องปฏิบัติการที่ได้รับรอง ISO/IEC 17025', 'เกินเกณฑ์ให้หยุดใช้และตรวจท่อและอุปกรณ์ที่เป็นโลหะ', 9, 'chem'),
  ('WW', 'WW01', 'คลอรีนคงเหลือ (Residual chlorine) น้ำทิ้ง', 'mg/L', 'num', null, 1.0, null, 'D', 'ประกาศกระทรวงทรัพยากรธรรมชาติและสิ่งแวดล้อม เรื่อง กำหนดมาตรฐานควบคุมการระบายน้ำทิ้งจากอาคารบางประเภทและบางขนาด พ.ศ. 2567', 'ชุดทดสอบ DPD ที่บ่อสัมผัสคลอรีนทุกวัน', 'เกินเกณฑ์ให้ลดการจ่ายคลอรีน · ค่าควบคุมการเดินระบบที่แนะนำ 0.5 ขึ้นไป เพื่อให้ฆ่าเชื้อได้พอ', 1, 'chem'),
  ('WW', 'WW02', 'ค่าความเป็นกรด-ด่าง (pH) น้ำทิ้ง', null, 'num', 5.5, 9, null, 'D', 'ประกาศกระทรวงทรัพยากรธรรมชาติและสิ่งแวดล้อม เรื่อง กำหนดมาตรฐานควบคุมการระบายน้ำทิ้งจากอาคารบางประเภทและบางขนาด พ.ศ. 2567', 'เครื่องวัด pH บันทึกตามแบบ ทส.1', null, 2, 'chem'),
  ('WW', 'WW03', 'บีโอดี (BOD) น้ำทิ้ง', 'mg/L', 'num', null, 20, null, 'M', 'ประกาศกระทรวงทรัพยากรธรรมชาติและสิ่งแวดล้อม เรื่อง กำหนดมาตรฐานควบคุมการระบายน้ำทิ้งจากอาคารบางประเภทและบางขนาด พ.ศ. 2567', 'ส่งห้องปฏิบัติการที่ขึ้นทะเบียนกรมโรงงาน / กรมควบคุมมลพิษ', 'เกินเกณฑ์ให้ตรวจระบบเติมอากาศ ตะกอนจุลินทรีย์ และเวลากักน้ำ', 3, 'chem'),
  ('WW', 'WW04', 'ของแข็งแขวนลอย (SS) น้ำทิ้ง', 'mg/L', 'num', null, 30, null, 'M', 'ประกาศกระทรวงทรัพยากรธรรมชาติและสิ่งแวดล้อม เรื่อง กำหนดมาตรฐานควบคุมการระบายน้ำทิ้งจากอาคารบางประเภทและบางขนาด พ.ศ. 2567', 'ส่งห้องปฏิบัติการ', 'เกินเกณฑ์ให้ตรวจถังตกตะกอนและการสูบตะกอนส่วนเกิน', 4, 'chem'),
  ('WW', 'WW05', 'ทีเคเอ็น (TKN) น้ำทิ้ง', 'mg/L', 'num', null, 35, null, 'M', 'ประกาศกระทรวงทรัพยากรธรรมชาติและสิ่งแวดล้อม เรื่อง กำหนดมาตรฐานควบคุมการระบายน้ำทิ้งจากอาคารบางประเภทและบางขนาด พ.ศ. 2567', 'ส่งห้องปฏิบัติการ', null, 5, 'chem'),
  ('WW', 'WW06', 'น้ำมันและไขมัน (Fat, Oil and Grease) น้ำทิ้ง', 'mg/L', 'num', null, 20, null, 'M', 'ประกาศกระทรวงทรัพยากรธรรมชาติและสิ่งแวดล้อม เรื่อง กำหนดมาตรฐานควบคุมการระบายน้ำทิ้งจากอาคารบางประเภทและบางขนาด พ.ศ. 2567', 'ส่งห้องปฏิบัติการ', 'เกินเกณฑ์ให้ตรวจและตักไขมันที่บ่อดักไขมันของโรงครัว', 6, 'chem'),
  ('WW', 'WW07', 'ซัลไฟด์ (Sulfide) น้ำทิ้ง', 'mg/L', 'num', null, 1, null, 'M', 'ประกาศกระทรวงทรัพยากรธรรมชาติและสิ่งแวดล้อม เรื่อง กำหนดมาตรฐานควบคุมการระบายน้ำทิ้งจากอาคารบางประเภทและบางขนาด พ.ศ. 2567', 'ส่งห้องปฏิบัติการ', null, 7, 'chem'),
  ('WW', 'WW08', 'โคลิฟอร์มทั้งหมด (Total coliform) น้ำทิ้ง', 'MPN/100 mL', 'num', null, 5000, null, 'M', 'ประกาศกระทรวงทรัพยากรธรรมชาติและสิ่งแวดล้อม เรื่อง กำหนดมาตรฐานควบคุมการระบายน้ำทิ้งจากอาคารบางประเภทและบางขนาด พ.ศ. 2567', 'ส่งห้องปฏิบัติการ', 'เกินเกณฑ์ให้ตรวจการจ่ายคลอรีนและเวลาสัมผัสคลอรีน แล้วตรวจซ้ำ', 8, 'bio'),
  ('WW', 'WW09', 'ฟีคัลโคลิฟอร์ม (Fecal coliform) น้ำทิ้ง', 'MPN/100 mL', 'num', null, 1000, null, 'M', 'ประกาศกระทรวงทรัพยากรธรรมชาติและสิ่งแวดล้อม เรื่อง กำหนดมาตรฐานควบคุมการระบายน้ำทิ้งจากอาคารบางประเภทและบางขนาด พ.ศ. 2567', 'ส่งห้องปฏิบัติการ', 'เกินเกณฑ์ให้ตรวจการจ่ายคลอรีนและเวลาสัมผัสคลอรีน แล้วตรวจซ้ำ', 9, 'bio')
) v(system, code, param, unit, kind, lo, hi, warn, freq, ref, method, note, sort, test_type)
where not exists (select 1 from public.water_templates t where t.code = v.code);

-- น้ำเสีย 3 จุดเก็บตัวอย่าง (ตามรูปแบบรายงานผลตรวจน้ำเสียรายปี): น้ำทิ้ง WW (มีค่ามาตรฐานตามกฎหมาย) · น้ำเสียเข้าระบบ WW_IN (ไม่มีค่ามาตรฐาน ใช้คำนวณ % การบำบัด)
-- · บ่อเติมอากาศ WW_AER (ค่าควบคุมการเดินระบบ) ; น้ำดื่มเพิ่มรายการตามประกาศ สธ. ฉบับที่ 61
insert into public.water_templates (system, code, param, unit, kind, lo, hi, warn, freq, ref, method, note, sort, test_type)
select v.* from (values
  ('WW', 'WW10', 'ซีโอดี (COD) น้ำทิ้ง', 'mg/L', 'num', null::numeric, null::numeric, null::numeric, 'M', 'ไม่กำหนดในมาตรฐานน้ำทิ้งจากอาคาร พ.ศ. 2567 · ใช้คำนวณ % การบำบัด (เป้าหมายมากกว่า 70%)', 'ส่งห้องปฏิบัติการ', null, 10, 'chem'),
  ('WW', 'WW11', 'ของแข็งละลายน้ำทั้งหมด (TDS) น้ำทิ้ง', 'mg/L', 'num', null, 1000, null, 'M', 'ประกาศกระทรวงทรัพยากรธรรมชาติและสิ่งแวดล้อม เรื่อง กำหนดมาตรฐานควบคุมการระบายน้ำทิ้งจากอาคารบางประเภทและบางขนาด พ.ศ. 2567', 'ส่งห้องปฏิบัติการ', null, 11, 'chem'),
  ('WW', 'WW12', 'ตะกอนหนัก (Settleable solids) น้ำทิ้ง', 'mL/L', 'num', null, null, null, 'M', 'ไม่กำหนดในมาตรฐานน้ำทิ้งจากอาคาร พ.ศ. 2567 · ใช้ติดตามการตกตะกอน', 'กรวยอิมฮอฟฟ์ (Imhoff cone) 1 ลิตร ตั้งทิ้ง 1 ชั่วโมง', 'เกินเกณฑ์ให้ตรวจถังตกตะกอนและการสูบตะกอนส่วนเกิน', 12, 'chem'),
  ('WW_IN', 'WI01', 'ค่าความเป็นกรด-ด่าง (pH) น้ำเสียเข้าระบบ', null, 'num', null, null, null, 'M', 'ไม่มีค่ามาตรฐาน (น้ำเสียก่อนบำบัด) ใช้ดูภาระของระบบ', 'เครื่องวัด pH', null, 1, 'chem'),
  ('WW_IN', 'WI02', 'บีโอดี (BOD) น้ำเสียเข้าระบบ', 'mg/L', 'num', null, null, null, 'M', 'ไม่มีค่ามาตรฐาน ใช้คำนวณ % การบำบัด BOD (เป้าหมายมากกว่า 85%)', 'ส่งห้องปฏิบัติการ เก็บวันเดียวกับน้ำทิ้ง', null, 2, 'chem'),
  ('WW_IN', 'WI03', 'ซีโอดี (COD) น้ำเสียเข้าระบบ', 'mg/L', 'num', null, null, null, 'M', 'ไม่มีค่ามาตรฐาน ใช้คำนวณ % การบำบัด COD (เป้าหมายมากกว่า 70%)', 'ส่งห้องปฏิบัติการ', null, 3, 'chem'),
  ('WW_IN', 'WI04', 'ของแข็งแขวนลอย (SS) น้ำเสียเข้าระบบ', 'mg/L', 'num', null, null, null, 'M', 'ไม่มีค่ามาตรฐาน ใช้คำนวณ % การบำบัด SS (เป้าหมายมากกว่า 80%)', 'ส่งห้องปฏิบัติการ', null, 4, 'chem'),
  ('WW_IN', 'WI05', 'ของแข็งละลายน้ำทั้งหมด (TDS) น้ำเสียเข้าระบบ', 'mg/L', 'num', null, null, null, 'M', 'ไม่มีค่ามาตรฐาน (น้ำเสียก่อนบำบัด)', 'ส่งห้องปฏิบัติการ', null, 5, 'chem'),
  ('WW_IN', 'WI06', 'น้ำมันและไขมัน (Fat, Oil and Grease) น้ำเสียเข้าระบบ', 'mg/L', 'num', null, null, null, 'M', 'ไม่มีค่ามาตรฐาน (น้ำเสียก่อนบำบัด)', 'ส่งห้องปฏิบัติการ', 'ค่าสูงให้ตรวจบ่อดักไขมันของโรงครัว', 6, 'chem'),
  ('WW_IN', 'WI07', 'ตะกอนหนัก (Settleable solids) น้ำเสียเข้าระบบ', 'mL/L', 'num', null, null, null, 'M', 'ไม่มีค่ามาตรฐาน (น้ำเสียก่อนบำบัด)', 'กรวยอิมฮอฟฟ์ (Imhoff cone)', null, 7, 'chem'),
  ('WW_IN', 'WI08', 'ซัลไฟด์ (Sulfide) น้ำเสียเข้าระบบ', 'mg/L', 'num', null, null, null, 'M', 'ไม่มีค่ามาตรฐาน (น้ำเสียก่อนบำบัด)', 'ส่งห้องปฏิบัติการ', null, 8, 'chem'),
  ('WW_IN', 'WI09', 'ทีเคเอ็น (TKN) น้ำเสียเข้าระบบ', 'mg/L', 'num', null, null, null, 'M', 'ไม่มีค่ามาตรฐาน ใช้คำนวณ % การบำบัด TKN (เป้าหมายมากกว่า 60%)', 'ส่งห้องปฏิบัติการ', null, 9, 'chem'),
  ('WW_IN', 'WI10', 'โคลิฟอร์มทั้งหมด (Total coliform) น้ำเสียเข้าระบบ', 'MPN/100 mL', 'num', null, null, null, 'M', 'ไม่มีค่ามาตรฐาน (น้ำเสียก่อนบำบัด)', 'ส่งห้องปฏิบัติการ', null, 10, 'bio'),
  ('WW_IN', 'WI11', 'ฟีคัลโคลิฟอร์ม (Fecal coliform) น้ำเสียเข้าระบบ', 'MPN/100 mL', 'num', null, null, null, 'M', 'ไม่มีค่ามาตรฐาน (น้ำเสียก่อนบำบัด)', 'ส่งห้องปฏิบัติการ', null, 11, 'bio'),
  ('WW_IN', 'WI12', 'คลอรีนคงเหลือ (Residual chlorine) น้ำเสียเข้าระบบ', 'mg/L', 'num', null, null, null, 'M', 'ไม่มีค่ามาตรฐาน (น้ำเสียก่อนบำบัด)', 'ชุดทดสอบ DPD', null, 12, 'chem'),
  ('WW_AER', 'WA01', 'ตะกอนจุลินทรีย์ในบ่อเติมอากาศ (MLSS)', 'mg/L', 'num', 1500, 3000, null, 'M', 'ค่าควบคุมการเดินระบบตะกอนเร่ง (Activated sludge) ไม่ใช่ค่ากฎหมาย ปรับตามผู้ออกแบบระบบ', 'ส่งห้องปฏิบัติการ', 'ต่ำกว่าช่วงควบคุมให้ลดการสูบตะกอนส่วนเกิน สูงกว่าช่วงให้สูบตะกอนส่วนเกินออก', 1, 'chem'),
  ('WW_AER', 'WA02', 'ออกซิเจนละลายในบ่อเติมอากาศ (DO)', 'mg/L', 'num', 2, null, null, 'W', 'ค่าควบคุมการเดินระบบตะกอนเร่ง ไม่ใช่ค่ากฎหมาย', 'เครื่องวัด DO', 'ต่ำกว่า 2 ให้ตรวจเครื่องเติมอากาศและหัวกระจายอากาศ', 2, 'chem'),
  ('WW_AER', 'WA03', 'ปริมาตรตะกอนหลังตั้งทิ้ง 30 นาที (SV30)', 'mL/L', 'num', null, null, null, 'W', 'ค่าควบคุมการเดินระบบ ไม่ใช่ค่ากฎหมาย', 'กระบอกตวง 1 ลิตร ตั้งทิ้ง 30 นาที', null, 3, 'chem'),
  ('DW', 'DW10', 'ซาลโมเนลลา (Salmonella spp.) น้ำดื่ม', null, 'detect', null, null, null, 'S', 'ประกาศกระทรวงสาธารณสุข ฉบับที่ 61 (พ.ศ. 2524) เรื่อง น้ำบริโภคในภาชนะบรรจุที่ปิดสนิท และฉบับแก้ไขเพิ่มเติม', 'ส่งห้องปฏิบัติการ', 'พบให้หยุดใช้ตู้นั้นทันที ล้างฆ่าเชื้อ แจ้งคณะกรรมการ IC และตรวจซ้ำ', 10, 'bio'),
  ('DW', 'DW11', 'เหล็ก (Iron) น้ำดื่ม', 'mg/L', 'num', null, 0.3, null, 'Y', 'ประกาศกระทรวงสาธารณสุข ฉบับที่ 61 (พ.ศ. 2524) เรื่อง น้ำบริโภคในภาชนะบรรจุที่ปิดสนิท และฉบับแก้ไขเพิ่มเติม', 'ส่งห้องปฏิบัติการ', null, 11, 'chem'),
  ('DW', 'DW12', 'คลอไรด์ (Chloride) น้ำดื่ม', 'mg/L', 'num', null, 250, null, 'Y', 'ประกาศกระทรวงสาธารณสุข ฉบับที่ 61 (พ.ศ. 2524) เรื่อง น้ำบริโภคในภาชนะบรรจุที่ปิดสนิท และฉบับแก้ไขเพิ่มเติม', 'ส่งห้องปฏิบัติการ', null, 12, 'chem')
) v(system, code, param, unit, kind, lo, hi, warn, freq, ref, method, note, sort, test_type)
where not exists (select 1 from public.water_templates t where t.code = v.code);

-- ผลแล็บเป็นไฟล์: แต่ละโรงแนบไฟล์ผลของแต่ละเดือน (แยกหมวด) ไฟล์ทุกแบบ (PDF รูป Excel Word) เพราะแต่ละโรงอาจใช้ห้องปฏิบัติการต่างกัน
-- AI 1 คน (edge function water-ai) อ่านไฟล์แล้วเสนอแถวผลลงแบบฟอร์มกลาง (water_plans) คนตรวจและกดบันทึกเอง ; ไฟล์เก็บใน bucket water-lab โฟลเดอร์ = รหัสโรง
create table if not exists public.water_files (
  id bigint generated always as identity primary key,
  hospital_id uuid not null references public.hospitals(id),
  month date not null,                                   -- first day of the month the results belong to
  grp text not null default 'ALL' check (grp in ('DRINK', 'USE', 'WASTE', 'ALL')),
  path text not null unique, file_name text not null, mime text, size bigint,
  lab text, note text,
  status text not null default 'uploaded' check (status in ('uploaded', 'read', 'saved', 'error')),
  ai jsonb, ai_model text, ai_at timestamptz, error text,
  saved_count int not null default 0, saved_at timestamptz, saved_by uuid references public.profiles(id),
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists water_files_hosp_idx on public.water_files (hospital_id, month);
alter table public.water_results add column if not exists file_id bigint references public.water_files(id);

-- AI executive summary + analysis per hospital (or hospital_id null = 12 โรง), per water group and year; every run is kept
create table if not exists public.water_ai (
  id bigint generated always as identity primary key,
  hospital_id uuid references public.hospitals(id),
  grp text not null check (grp in ('DRINK', 'USE', 'WASTE', 'ALL')),
  year int not null,
  report jsonb not null, model text,
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now()
);
alter table public.water_ai add column if not exists month int check (month between 1 and 12);   -- null = whole year; 1-12 = that month
create index if not exists water_ai_idx on public.water_ai (hospital_id, year, grp, created_at desc);
alter table public.water_files enable row level security;
alter table public.water_ai enable row level security;

do $p$ begin
  if not exists (select 1 from pg_policies where tablename = 'water_files' and policyname = 'wf read') then
    create policy "wf read" on public.water_files for select to authenticated using (public.water_can_read(hospital_id)); end if;
  if not exists (select 1 from pg_policies where tablename = 'water_files' and policyname = 'wf write') then
    create policy "wf write" on public.water_files for insert to authenticated with check (public.water_can_record(hospital_id) and created_by = auth.uid()); end if;
  if not exists (select 1 from pg_policies where tablename = 'water_files' and policyname = 'wf edit') then
    create policy "wf edit" on public.water_files for update to authenticated using (public.water_can_record(hospital_id)) with check (public.water_can_record(hospital_id)); end if;
  if not exists (select 1 from pg_policies where tablename = 'water_ai' and policyname = 'wai read') then
    create policy "wai read" on public.water_ai for select to authenticated
      using (case when hospital_id is null then public.am_exec() else public.water_can_read(hospital_id) end); end if;
  if not exists (select 1 from pg_policies where tablename = 'water_ai' and policyname = 'wai write') then
    create policy "wai write" on public.water_ai for insert to authenticated
      with check (created_by = auth.uid() and case when hospital_id is null then public.am_exec() else public.water_can_record(hospital_id) end); end if;
end $p$;
grant select, insert, update on public.water_files to authenticated;
grant select, insert on public.water_ai to authenticated;

-- a result saved from a file must come from a file of the same hospital
create or replace function public.water_result_file() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.file_id is not null and not exists (select 1 from water_files f where f.id = new.file_id and f.hospital_id = new.hospital_id) then
    raise exception 'ไฟล์ผลแล็บนี้ไม่ใช่ของโรงพยาบาลเดียวกับจุดตรวจ'; end if;
  return new;
end $$;
revoke all on function public.water_result_file() from public, anon;
drop trigger if exists water_result_file on public.water_results;
create trigger water_result_file before insert on public.water_results for each row execute function public.water_result_file();

-- private bucket for the lab files (any type, up to 20 MB); folder = hospital code
insert into storage.buckets (id, name, public, file_size_limit)
values ('water-lab', 'water-lab', false, 20971520)
on conflict (id) do nothing;
do $s$ begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'water lab read') then
    create policy "water lab read" on storage.objects for select to authenticated
      using (bucket_id = 'water-lab' and exists (select 1 from public.hospitals h where h.code = (storage.foldername(objects.name))[1] and public.water_can_read(h.id))); end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'water lab upload') then
    create policy "water lab upload" on storage.objects for insert to authenticated
      with check (bucket_id = 'water-lab' and exists (select 1 from public.hospitals h where h.code = (storage.foldername(objects.name))[1] and public.water_can_record(h.id))); end if;
end $s$;

-- one central template for all 12 hospitals: when a lab file is attached for a group in which the hospital has no sampling
-- point yet, the standard points of that group are made from the central templates (staff who may record results may do this;
-- heads can rename, add or switch off points later). น้ำใช้ has too many kinds of systems to guess, so heads add those points.
create or replace function public.water_std_points(p_hospital uuid, p_grp text) returns int
language plpgsql security definer set search_path = public as $$
declare n int := 0; r record;
begin
  if not public.water_can_record(p_hospital) then raise exception 'ไม่มีสิทธิ์บันทึกผลของโรงพยาบาลนี้'; end if;
  for r in select * from (values
      ('WASTE', 'WW_IN', 'WW-IN', 'น้ำเสียเข้าระบบบำบัด (น้ำเสียก่อนบำบัด)', 'ระบบบำบัดน้ำเสีย', 1),
      ('WASTE', 'WW', 'WW-OUT', 'น้ำทิ้งหลังบำบัด (น้ำเสียหลังบำบัด)', 'ระบบบำบัดน้ำเสีย จุดระบายน้ำทิ้ง', 2),
      ('WASTE', 'WW_AER', 'WW-AER', 'บ่อเติมอากาศ', 'ระบบบำบัดน้ำเสีย', 3),
      ('DRINK', 'DW', 'DW-01', 'น้ำดื่ม (ตู้กดน้ำดื่ม / เครื่องกรองน้ำดื่ม)', null, 1)) v(grp, sys, code, name, loc, o)
    where v.grp = p_grp order by v.o loop
    if not exists (select 1 from water_points w where w.hospital_id = p_hospital and w.system = r.sys)
       and not exists (select 1 from water_points w where w.hospital_id = p_hospital and lower(w.code) = lower(r.code)) then
      with p as (insert into water_points (hospital_id, system, code, name, location, created_by)
                 values (p_hospital, r.sys, r.code, r.name, r.loc, auth.uid()) returning id)
      insert into water_plans (point_id, hospital_id, template_code, param, unit, kind, lo, hi, warn, freq, ref, method, note, test_type, sort)
      select p.id, p_hospital, t.code, t.param, t.unit, t.kind, t.lo, t.hi, t.warn, t.freq, t.ref, t.method, t.note, t.test_type, t.sort
      from p, water_templates t where t.system = r.sys;
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;
revoke all on function public.water_std_points(uuid, text) from public, anon;
grant execute on function public.water_std_points(uuid, text) to authenticated;
