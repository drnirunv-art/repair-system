-- 0021 Air-conditioning contractor: work reports and monthly acceptance per the standard TOR (forms AC-01 .. AC-13). Additive only.
-- Contractor staff log in with ordinary accounts whose role is 'observer' (read-only everywhere else) and are marked
-- as contractor in ac_members; that mark is what lets them write AC records. Hospital side = any non-observer staff.
-- Nothing here touches jobs, PM or stock.

-- who is the contractor ---------------------------------------------------------------------------------------------
create table if not exists public.ac_members (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  hospital_id uuid not null references public.hospitals(id) on delete cascade,
  position text not null default 'tech' check (position in ('tech','lead')),
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now()
);
alter table public.ac_members enable row level security;
create policy "ac members read" on public.ac_members for select to authenticated using (hospital_id = public.my_hospital());
grant select on public.ac_members to authenticated;

-- 'lead' / 'tech' for contractor staff, 'hospital' for hospital staff, null for anyone else (plain observers only read)
create or replace function public.ac_side() returns text
language sql stable security definer set search_path = public as $$
  select case
    when exists (select 1 from ac_members m where m.profile_id = auth.uid() and m.hospital_id = public.my_hospital())
      then (select m.position from ac_members m where m.profile_id = auth.uid())
    when public.my_role() is not null and public.my_role() <> 'observer' then 'hospital' end $$;
grant execute on function public.ac_side() to authenticated;

create or replace function public.ac_member_set(p_profile uuid, p_position text) returns void
language plpgsql security definer set search_path = public as $$
declare p profiles;
begin
  if not public.is_manager() then raise exception 'เฉพาะ Owner / Admin / Chief / หัวหน้าช่าง กำหนดทีมผู้รับเหมาได้'; end if;
  select * into p from profiles where id = p_profile and hospital_id = public.my_hospital();
  if p.id is null then raise exception 'ไม่พบผู้ใช้ในโรงนี้'; end if;
  if p_position is null then delete from ac_members where profile_id = p_profile; return; end if;
  if p.role <> 'observer' then raise exception 'บัญชีผู้รับเหมาต้องมีสิทธิ์เป็น Observer ก่อน (ตั้งที่หน้าเจ้าหน้าที่ > ตั้งค่า > เจ้าหน้าที่)'; end if;
  if p_position not in ('tech','lead') then raise exception 'ตำแหน่งไม่ถูกต้อง'; end if;
  insert into ac_members (profile_id, hospital_id, position) values (p_profile, p.hospital_id, p_position)
    on conflict (profile_id) do update set position = excluded.position, hospital_id = excluded.hospital_id;
end $$;
revoke all on function public.ac_member_set(uuid, text) from public, anon;
grant execute on function public.ac_member_set(uuid, text) to authenticated;

-- contract data (one per hospital): value, SLA hours, penalty rate — TOR 8.5, 9.1, 9.3, 13, 15 -------------------------
create table if not exists public.ac_contracts (
  hospital_id uuid primary key references public.hospitals(id) on delete cascade,
  contractor text, contract_no text, start_date date, end_date date,
  value numeric not null default 0 check (value >= 0),
  installments int not null default 12 check (installments > 0),
  sla_hours numeric not null default 24, damage_hours numeric not null default 48, defect_hours numeric not null default 72,
  penalty_rate numeric not null default 0.001 check (penalty_rate >= 0 and penalty_rate <= 1),
  updated_by uuid references public.profiles(id) default auth.uid(), updated_at timestamptz not null default now()
);
alter table public.ac_contracts enable row level security;
create policy "ac contract read" on public.ac_contracts for select to authenticated using (hospital_id = public.my_hospital());
create policy "ac contract add" on public.ac_contracts for insert to authenticated with check (hospital_id = public.my_hospital() and public.is_manager());
create policy "ac contract edit" on public.ac_contracts for update to authenticated
  using (hospital_id = public.my_hospital() and public.is_manager()) with check (hospital_id = public.my_hospital() and public.is_manager());
grant select, insert, update on public.ac_contracts to authenticated;

-- equipment register (one row per unit, code = QR) — TOR 10.6, 10.8 ---------------------------------------------------
create table if not exists public.ac_units (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null references public.hospitals(id) on delete cascade,
  code text not null, kind text not null,
  building text, floor text, room text, area_type text, brand text, model text, capacity text, refrigerant text,
  install_year int, condition text, note text,
  active boolean not null default true,
  created_by uuid references public.profiles(id) default auth.uid(), created_at timestamptz not null default now()
);
create unique index if not exists ac_units_code_uq on public.ac_units (hospital_id, upper(code));
alter table public.ac_units enable row level security;
create policy "ac units read" on public.ac_units for select to authenticated using (hospital_id = public.my_hospital());
create policy "ac units add" on public.ac_units for insert to authenticated with check (hospital_id = public.my_hospital() and public.ac_side() is not null);
create policy "ac units edit" on public.ac_units for update to authenticated
  using (hospital_id = public.my_hospital() and public.ac_side() is not null) with check (hospital_id = public.my_hospital() and public.ac_side() is not null);
grant select, insert, update on public.ac_units to authenticated;

-- yearly plan: units to clean per month, minor and major — TOR 5.1, 10.1, 10.2 ----------------------------------------
create table if not exists public.ac_plan (
  hospital_id uuid not null references public.hospitals(id) on delete cascade,
  year int not null, kind text not null,
  minor_per_year int not null default 4, major_per_year int not null default 2,
  minor_m int[] not null default array[0,0,0,0,0,0,0,0,0,0,0,0], major_m int[] not null default array[0,0,0,0,0,0,0,0,0,0,0,0],
  updated_by uuid references public.profiles(id) default auth.uid(), updated_at timestamptz not null default now(),
  primary key (hospital_id, year, kind),
  check (array_length(minor_m, 1) = 12 and array_length(major_m, 1) = 12)
);
alter table public.ac_plan enable row level security;
create policy "ac plan read" on public.ac_plan for select to authenticated using (hospital_id = public.my_hospital());
create policy "ac plan add" on public.ac_plan for insert to authenticated with check (hospital_id = public.my_hospital() and (public.is_manager() or public.ac_side() = 'lead'));
create policy "ac plan edit" on public.ac_plan for update to authenticated
  using (hospital_id = public.my_hospital() and (public.is_manager() or public.ac_side() = 'lead'))
  with check (hospital_id = public.my_hospital() and (public.is_manager() or public.ac_side() = 'lead'));
grant select, insert, update on public.ac_plan to authenticated;

-- running numbers ------------------------------------------------------------------------------------------------------
create table if not exists public.ac_counters (hospital_id uuid not null, kind text not null, year int not null, last_no int not null default 0, primary key (hospital_id, kind, year));
alter table public.ac_counters enable row level security;
create or replace function public.ac_next(p_kind text) returns text
language plpgsql security definer set search_path = public as $$
declare h uuid := public.my_hospital(); y int := extract(year from now() at time zone 'Asia/Bangkok')::int + 543; n int;
begin
  insert into ac_counters (hospital_id, kind, year, last_no) values (h, p_kind, y, 1)
    on conflict (hospital_id, kind, year) do update set last_no = ac_counters.last_no + 1 returning last_no into n;
  return p_kind || '-' || (select code from hospitals where id = h) || '-' || lpad(n::text, 4, '0') || '/' || y;
end $$;
revoke execute on function public.ac_next(text) from public, anon, authenticated;

-- work forms: AC-01..06 one per unit per visit, AC-07 IAQ, AC-08 daily plan, AC-11 requisition, AC-13 training ---------
create table if not exists public.ac_forms (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null references public.hospitals(id) on delete cascade,
  form text not null check (form in ('AC-01','AC-02','AC-03','AC-04','AC-05','AC-06','AC-07','AC-08','AC-11','AC-13')),
  doc_no text not null unique,
  work_date date not null,
  unit_id uuid references public.ac_units(id),
  work_kind text check (work_kind in ('minor','major')),
  data jsonb not null default '{}',
  status text not null default 'draft' check (status in ('draft','submitted','accepted','returned')),
  signs jsonb not null default '{}',
  return_note text,
  created_by uuid references public.profiles(id) default auth.uid(), created_at timestamptz not null default now(),
  submitted_at timestamptz, accepted_by uuid references public.profiles(id), accepted_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists ac_forms_hosp_idx on public.ac_forms (hospital_id, work_date desc);
create index if not exists ac_forms_unit_idx on public.ac_forms (unit_id, work_date desc);
alter table public.ac_forms enable row level security;
create policy "ac forms read" on public.ac_forms for select to authenticated using (hospital_id = public.my_hospital());
grant select on public.ac_forms to authenticated;

create or replace function public.ac_form_save(p_id uuid, p_form text, p_date date, p_unit uuid, p_kind text, p_data jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare h uuid := public.my_hospital(); f ac_forms; v_id uuid;
begin
  if public.ac_side() is null then raise exception 'ไม่มีสิทธิ์บันทึกแบบฟอร์มงานแอร์'; end if;
  if p_date is null then raise exception 'ใส่วันที่'; end if;
  if p_unit is not null and not exists (select 1 from ac_units where id = p_unit and hospital_id = h) then raise exception 'ไม่พบเครื่องในทะเบียน'; end if;
  if p_form in ('AC-01','AC-02','AC-03','AC-04','AC-06') and p_unit is null then raise exception 'เลือกเครื่องจากทะเบียน (1 ใบต่อ 1 เครื่อง)'; end if;
  if p_form in ('AC-01','AC-02','AC-03','AC-04','AC-05','AC-06') and p_kind is null then raise exception 'เลือกประเภทงาน ล้างย่อย หรือ ล้างใหญ่'; end if;
  if p_id is null then
    insert into ac_forms (hospital_id, form, doc_no, work_date, unit_id, work_kind, data)
      values (h, p_form, public.ac_next(replace(p_form, '-', '')), p_date, p_unit, p_kind, coalesce(p_data, '{}')) returning id into v_id;
    return v_id;
  end if;
  select * into f from ac_forms where id = p_id and hospital_id = h for update;
  if f.id is null then raise exception 'ไม่พบแบบฟอร์ม'; end if;
  if f.status not in ('draft','returned') then raise exception 'แบบฟอร์มส่งแล้ว แก้ไขไม่ได้ (ให้ รพ. ตีกลับก่อน)'; end if;
  update ac_forms set work_date = p_date, unit_id = p_unit, work_kind = p_kind, data = coalesce(p_data, '{}'), updated_at = now() where id = f.id;
  return f.id;
end $$;
revoke all on function public.ac_form_save(uuid, text, date, uuid, text, jsonb) from public, anon;
grant execute on function public.ac_form_save(uuid, text, date, uuid, text, jsonb) to authenticated;

-- signatures. slots: tech, lead (contractor) · building, eng (hospital) · owner (area owner / trainer: a typed name)
-- lead's signature submits the form; eng's signature (a manager) accepts it. building / owner may still sign after that
-- (e.g. the store keeper who hands out parts on AC-11 after the request is approved).
create or replace function public.ac_form_sign(p_id uuid, p_slot text, p_name text default null) returns text
language plpgsql security definer set search_path = public as $$
declare h uuid := public.my_hospital(); f ac_forms; s text := public.ac_side(); v_name text;
begin
  select * into f from ac_forms where id = p_id and hospital_id = h for update;
  if f.id is null then raise exception 'ไม่พบแบบฟอร์ม'; end if;
  if f.status = 'accepted' and p_slot not in ('building','owner') then raise exception 'แบบฟอร์มนี้ตรวจรับแล้ว'; end if;
  if s is null then raise exception 'ไม่มีสิทธิ์ลงนาม'; end if;
  if f.signs ? p_slot then raise exception 'ตำแหน่งนี้ลงนามแล้ว'; end if;
  select full_name into v_name from profiles where id = auth.uid();
  if p_slot = 'tech' then
    if s not in ('tech','lead') then raise exception 'ช่องนี้สำหรับช่างของผู้รับเหมา'; end if;
  elsif p_slot = 'lead' then
    if s <> 'lead' then raise exception 'ช่องนี้สำหรับหัวหน้าช่างของผู้รับเหมา'; end if;
  elsif p_slot = 'building' then
    if s <> 'hospital' then raise exception 'ช่องนี้สำหรับเจ้าหน้าที่ของโรงพยาบาล'; end if;
  elsif p_slot = 'eng' then
    if not public.is_manager() then raise exception 'ตรวจรับได้เฉพาะ Owner / Admin / Chief / หัวหน้าช่าง ของโรงพยาบาล'; end if;
    if f.status <> 'submitted' then raise exception 'ผู้รับเหมายังไม่ส่งแบบฟอร์มนี้ (หัวหน้าช่างผู้รับเหมาต้องลงนามก่อน)'; end if;
  elsif p_slot = 'owner' then
    if coalesce(trim(p_name), '') = '' then raise exception 'พิมพ์ชื่อผู้ลงนาม'; end if;
    v_name := trim(p_name);
  else raise exception 'ตำแหน่งลงนามไม่ถูกต้อง';
  end if;
  update ac_forms set signs = signs || jsonb_build_object(p_slot, jsonb_build_object('name', v_name, 'at', now(), 'by', auth.uid())),
    status = case when p_slot = 'lead' then 'submitted' when p_slot = 'eng' then 'accepted' else status end,
    submitted_at = case when p_slot = 'lead' then now() else submitted_at end,
    accepted_by = case when p_slot = 'eng' then auth.uid() else accepted_by end,
    accepted_at = case when p_slot = 'eng' then now() else accepted_at end,
    return_note = case when p_slot = 'lead' then null else return_note end, updated_at = now()
  where id = f.id;
  return (select status from ac_forms where id = f.id);
end $$;
revoke all on function public.ac_form_sign(uuid, text, text) from public, anon;
grant execute on function public.ac_form_sign(uuid, text, text) to authenticated;

create or replace function public.ac_form_return(p_id uuid, p_note text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_manager() then raise exception 'ตีกลับได้เฉพาะ Owner / Admin / Chief / หัวหน้าช่าง ของโรงพยาบาล'; end if;
  if coalesce(trim(p_note), '') = '' then raise exception 'ใส่เหตุผลที่ตีกลับ'; end if;
  update ac_forms set status = 'returned', signs = '{}', return_note = trim(p_note), updated_at = now()
    where id = p_id and hospital_id = public.my_hospital() and status = 'submitted';
  if not found then raise exception 'ตีกลับได้เฉพาะแบบฟอร์มที่ส่งแล้วและยังไม่ตรวจรับ'; end if;
end $$;
revoke all on function public.ac_form_return(uuid, text) from public, anon;
grant execute on function public.ac_form_return(uuid, text) to authenticated;

-- AC-09 repair-call register with SLA, AC-10 damage register ----------------------------------------------------------
create table if not exists public.ac_tickets (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null references public.hospitals(id) on delete cascade,
  ticket_no text not null unique,
  reported_at timestamptz not null, reporter text, place text, unit_id uuid references public.ac_units(id),
  symptom text not null,
  visited_at timestamptz, fixed_at timestamptz, fix_note text,
  inspected_by uuid references public.profiles(id), inspected_at timestamptz, inspector_name text,
  created_by uuid references public.profiles(id) default auth.uid(), created_at timestamptz not null default now()
);
create index if not exists ac_tickets_hosp_idx on public.ac_tickets (hospital_id, reported_at desc);
create table if not exists public.ac_damages (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null references public.hospitals(id) on delete cascade,
  occurred_at timestamptz not null, place text, unit_id uuid references public.ac_units(id),
  asset text not null, cause text,
  criteria text not null default 'work' check (criteria in ('work','defect')),
  fixed_at timestamptz, fix_note text, contractor_pays boolean not null default true,
  inspected_by uuid references public.profiles(id), inspected_at timestamptz, inspector_name text,
  created_by uuid references public.profiles(id) default auth.uid(), created_at timestamptz not null default now()
);
create index if not exists ac_damages_hosp_idx on public.ac_damages (hospital_id, occurred_at desc);
alter table public.ac_tickets enable row level security;
alter table public.ac_damages enable row level security;
create policy "ac tickets read" on public.ac_tickets for select to authenticated using (hospital_id = public.my_hospital());
create policy "ac damages read" on public.ac_damages for select to authenticated using (hospital_id = public.my_hospital());
grant select on public.ac_tickets, public.ac_damages to authenticated;

-- penalty days: time over the limit, any part of a day counts as one day (TOR 13)
create or replace function public.ac_pen_days(p_from timestamptz, p_to timestamptz, p_limit numeric) returns int
language sql immutable as $$
  select case when p_from is null or p_to is null then 0
    else greatest(0, ceil((extract(epoch from (p_to - p_from)) / 3600.0 - p_limit) / 24.0))::int end $$;
grant execute on function public.ac_pen_days(timestamptz, timestamptz, numeric) to authenticated;

create or replace function public.ac_ticket_open(p_reported timestamptz, p_reporter text, p_place text, p_unit uuid, p_symptom text) returns text
language plpgsql security definer set search_path = public as $$
declare h uuid := public.my_hospital(); v_no text;
begin
  if public.ac_side() is null then raise exception 'ไม่มีสิทธิ์'; end if;
  if coalesce(trim(p_symptom), '') = '' then raise exception 'ใส่อาการที่แจ้ง'; end if;
  if p_reported is null or p_reported > now() + interval '5 minutes' then raise exception 'วัน-เวลารับแจ้งไม่ถูกต้อง'; end if;
  if p_unit is not null and not exists (select 1 from ac_units where id = p_unit and hospital_id = h) then raise exception 'ไม่พบเครื่องในทะเบียน'; end if;
  v_no := public.ac_next('RQ');
  insert into ac_tickets (hospital_id, ticket_no, reported_at, reporter, place, unit_id, symptom)
    values (h, v_no, p_reported, nullif(trim(coalesce(p_reporter, '')), ''), nullif(trim(coalesce(p_place, '')), ''), p_unit, trim(p_symptom));
  return v_no;
end $$;
revoke all on function public.ac_ticket_open(timestamptz, text, text, uuid, text) from public, anon;
grant execute on function public.ac_ticket_open(timestamptz, text, text, uuid, text) to authenticated;

-- steps: visit (first response), fix (done + what was done), inspect (hospital accepts the record)
create or replace function public.ac_ticket_step(p_id uuid, p_step text, p_at timestamptz default null, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare t ac_tickets; v_at timestamptz := coalesce(p_at, now());
begin
  select * into t from ac_tickets where id = p_id and hospital_id = public.my_hospital() for update;
  if t.id is null then raise exception 'ไม่พบรายการแจ้งซ่อม'; end if;
  if public.ac_side() is null then raise exception 'ไม่มีสิทธิ์'; end if;
  if t.inspected_at is not null then raise exception 'รายการนี้ รพ. ตรวจรับแล้ว แก้ไขไม่ได้'; end if;
  if v_at > now() + interval '5 minutes' then raise exception 'ใส่เวลาในอนาคตไม่ได้'; end if;
  if p_step = 'visit' then
    if t.visited_at is not null then raise exception 'บันทึกเวลาเข้าตรวจแล้ว'; end if;
    if v_at < t.reported_at then raise exception 'เวลาเข้าตรวจต้องไม่ก่อนเวลารับแจ้ง'; end if;
    update ac_tickets set visited_at = v_at where id = t.id;
  elsif p_step = 'fix' then
    if t.visited_at is null then raise exception 'บันทึกเวลาเข้าตรวจก่อน'; end if;
    if t.fixed_at is not null then raise exception 'บันทึกแก้เสร็จแล้ว'; end if;
    if v_at < t.visited_at then raise exception 'เวลาแก้เสร็จต้องไม่ก่อนเวลาเข้าตรวจ'; end if;
    if coalesce(trim(p_note), '') = '' then raise exception 'ใส่การแก้ไข / อะไหล่ที่ใช้'; end if;
    update ac_tickets set fixed_at = v_at, fix_note = trim(p_note) where id = t.id;
  elsif p_step = 'inspect' then
    if public.ac_side() <> 'hospital' then raise exception 'ตรวจรับได้เฉพาะเจ้าหน้าที่ของโรงพยาบาล'; end if;
    if t.fixed_at is null then raise exception 'ผู้รับเหมายังไม่บันทึกแก้เสร็จ'; end if;
    update ac_tickets set inspected_by = auth.uid(), inspected_at = now(), inspector_name = (select full_name from profiles where id = auth.uid()) where id = t.id;
  else raise exception 'ขั้นไม่ถูกต้อง';
  end if;
end $$;
revoke all on function public.ac_ticket_step(uuid, text, timestamptz, text) from public, anon;
grant execute on function public.ac_ticket_step(uuid, text, timestamptz, text) to authenticated;

create or replace function public.ac_damage_open(p_at timestamptz, p_place text, p_unit uuid, p_asset text, p_cause text, p_criteria text) returns uuid
language plpgsql security definer set search_path = public as $$
declare h uuid := public.my_hospital(); v uuid;
begin
  if public.ac_side() is null then raise exception 'ไม่มีสิทธิ์'; end if;
  if coalesce(trim(p_asset), '') = '' then raise exception 'ใส่ทรัพย์สินที่เสียหาย'; end if;
  if p_at is null or p_at > now() + interval '5 minutes' then raise exception 'วัน-เวลาเกิดเหตุไม่ถูกต้อง'; end if;
  if p_unit is not null and not exists (select 1 from ac_units where id = p_unit and hospital_id = h) then raise exception 'ไม่พบเครื่องในทะเบียน'; end if;
  insert into ac_damages (hospital_id, occurred_at, place, unit_id, asset, cause, criteria)
    values (h, p_at, nullif(trim(coalesce(p_place, '')), ''), p_unit, trim(p_asset), nullif(trim(coalesce(p_cause, '')), ''), coalesce(p_criteria, 'work')) returning id into v;
  return v;
end $$;
revoke all on function public.ac_damage_open(timestamptz, text, uuid, text, text, text) from public, anon;
grant execute on function public.ac_damage_open(timestamptz, text, uuid, text, text, text) to authenticated;

create or replace function public.ac_damage_step(p_id uuid, p_step text, p_at timestamptz default null, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare d ac_damages; v_at timestamptz := coalesce(p_at, now());
begin
  select * into d from ac_damages where id = p_id and hospital_id = public.my_hospital() for update;
  if d.id is null then raise exception 'ไม่พบรายการ'; end if;
  if public.ac_side() is null then raise exception 'ไม่มีสิทธิ์'; end if;
  if d.inspected_at is not null then raise exception 'รายการนี้ รพ. ตรวจรับแล้ว แก้ไขไม่ได้'; end if;
  if p_step = 'fix' then
    if d.fixed_at is not null then raise exception 'บันทึกแก้เสร็จแล้ว'; end if;
    if v_at < d.occurred_at or v_at > now() + interval '5 minutes' then raise exception 'เวลาแก้เสร็จไม่ถูกต้อง'; end if;
    update ac_damages set fixed_at = v_at, fix_note = nullif(trim(coalesce(p_note, '')), '') where id = d.id;
  elsif p_step = 'inspect' then
    if public.ac_side() <> 'hospital' then raise exception 'ตรวจรับได้เฉพาะเจ้าหน้าที่ของโรงพยาบาล'; end if;
    if d.fixed_at is null then raise exception 'ผู้รับเหมายังไม่บันทึกแก้เสร็จ'; end if;
    update ac_damages set inspected_by = auth.uid(), inspected_at = now(), inspector_name = (select full_name from profiles where id = auth.uid()) where id = d.id;
  else raise exception 'ขั้นไม่ถูกต้อง';
  end if;
end $$;
revoke all on function public.ac_damage_step(uuid, text, timestamptz, text) from public, anon;
grant execute on function public.ac_damage_step(uuid, text, timestamptz, text) to authenticated;

-- AC-12 monthly summary and acceptance ---------------------------------------------------------------------------------
create table if not exists public.ac_monthly (
  hospital_id uuid not null references public.hospitals(id) on delete cascade,
  month date not null check (extract(day from month) = 1),
  installment_no int,
  docs jsonb not null default '{}',          -- {"1":"ok"|"no"|"na", ...} the 11 documents needed before billing
  deduct numeric not null default 0 check (deduct >= 0),
  note text,
  status text not null default 'draft' check (status in ('draft','submitted','accepted')),
  signs jsonb not null default '{}',
  summary jsonb,                              -- frozen numbers at acceptance
  updated_at timestamptz not null default now(),
  primary key (hospital_id, month)
);
alter table public.ac_monthly enable row level security;
create policy "ac monthly read" on public.ac_monthly for select to authenticated using (hospital_id = public.my_hospital());
grant select on public.ac_monthly to authenticated;

-- work done vs plan per equipment type, penalties from AC-09 / AC-10, and the net payment for the month
create or replace function public.ac_month_summary(p_month date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare h uuid := public.my_hospital(); m date := date_trunc('month', p_month)::date; c ac_contracts; mo ac_monthly;
  f timestamptz := (m::text || ' 00:00:00+07')::timestamptz; t timestamptz := ((m + interval '1 month')::date::text || ' 00:00:00+07')::timestamptz;
  v_rows jsonb; v_p9 numeric; v_d9 int; v_p10 numeric; v_d10 int; v_fee numeric; i int := extract(month from m)::int;
begin
  if h is null then raise exception 'ไม่มีสิทธิ์'; end if;
  select * into c from ac_contracts where hospital_id = h;
  select * into mo from ac_monthly where hospital_id = h and month = m;
  with done as (
    select u.kind, fo.work_kind, count(*) n from ac_forms fo join ac_units u on u.id = fo.unit_id
      where fo.hospital_id = h and fo.form in ('AC-01','AC-02','AC-03','AC-04','AC-06') and fo.status in ('submitted','accepted')
        and fo.work_date >= m and fo.work_date < (m + interval '1 month')::date group by 1, 2
    union all
    select coalesce(nullif(r->>'kind', ''), 'พัดลมขนาดเล็ก (Exhaust/Ventilation/Fresh Air)'), fo.work_kind, count(*)
      from ac_forms fo cross join lateral jsonb_array_elements(coalesce(fo.data->'rows', '[]')) r
      where fo.hospital_id = h and fo.form = 'AC-05' and fo.status in ('submitted','accepted') and coalesce(r->>'code', '') <> ''
        and fo.work_date >= m and fo.work_date < (m + interval '1 month')::date group by 1, 2
  ), k as (
    select kind from ac_units where hospital_id = h and active
    union select kind from ac_plan where hospital_id = h and year = extract(year from m)::int
    union select kind from done
  )
  select coalesce(jsonb_agg(jsonb_build_object('kind', k.kind,
      'units', (select count(*) from ac_units u where u.hospital_id = h and u.active and u.kind = k.kind),
      'plan_minor', coalesce(p.minor_m[i], 0), 'plan_major', coalesce(p.major_m[i], 0),
      'done_minor', coalesce((select sum(n) from done d where d.kind = k.kind and d.work_kind = 'minor'), 0),
      'done_major', coalesce((select sum(n) from done d where d.kind = k.kind and d.work_kind = 'major'), 0)) order by k.kind), '[]')
    into v_rows
  from k left join ac_plan p on p.hospital_id = h and p.year = extract(year from m)::int and p.kind = k.kind;
  select coalesce(sum(public.ac_pen_days(reported_at, coalesce(visited_at, now()), coalesce(c.sla_hours, 24))), 0) into v_d9
    from ac_tickets where hospital_id = h and reported_at >= f and reported_at < t;
  select coalesce(sum(public.ac_pen_days(occurred_at, coalesce(fixed_at, now()), case when criteria = 'defect' then coalesce(c.defect_hours, 72) else coalesce(c.damage_hours, 48) end)), 0) into v_d10
    from ac_damages where hospital_id = h and occurred_at >= f and occurred_at < t;
  v_p9 := v_d9 * coalesce(c.value, 0) * coalesce(c.penalty_rate, 0.001);
  v_p10 := v_d10 * coalesce(c.value, 0) * coalesce(c.penalty_rate, 0.001);
  v_fee := round(coalesce(c.value, 0) / coalesce(c.installments, 12), 2);
  return jsonb_build_object('month', m, 'rows', v_rows, 'fee', v_fee,
    'tickets', (select count(*) from ac_tickets where hospital_id = h and reported_at >= f and reported_at < t),
    'damages', (select count(*) from ac_damages where hospital_id = h and occurred_at >= f and occurred_at < t),
    'pen9_days', v_d9, 'pen9', v_p9, 'pen10_days', v_d10, 'pen10', v_p10,
    'deduct', coalesce(mo.deduct, 0), 'net', v_fee - v_p9 - v_p10 - coalesce(mo.deduct, 0));
end $$;
revoke all on function public.ac_month_summary(date) from public, anon;
grant execute on function public.ac_month_summary(date) to authenticated;

create or replace function public.ac_month_save(p_month date, p_installment int, p_docs jsonb, p_note text, p_deduct numeric default null) returns void
language plpgsql security definer set search_path = public as $$
declare h uuid := public.my_hospital(); m date := date_trunc('month', p_month)::date; mo ac_monthly;
begin
  if not (public.is_manager() or public.ac_side() = 'lead') then raise exception 'บันทึกสรุปเดือนได้เฉพาะหัวหน้าช่างผู้รับเหมา หรือผู้จัดการฝั่งโรงพยาบาล'; end if;
  select * into mo from ac_monthly where hospital_id = h and month = m for update;
  if mo.status = 'accepted' then raise exception 'เดือนนี้ตรวจรับแล้ว แก้ไขไม่ได้'; end if;
  if mo.status = 'submitted' and not public.is_manager() then raise exception 'ส่งรายงานแล้ว แก้ไขไม่ได้'; end if;
  insert into ac_monthly (hospital_id, month, installment_no, docs, note, deduct)
    values (h, m, p_installment, coalesce(p_docs, '{}'), nullif(trim(coalesce(p_note, '')), ''), case when public.is_manager() then coalesce(p_deduct, 0) else 0 end)
  on conflict (hospital_id, month) do update set installment_no = excluded.installment_no, docs = excluded.docs, note = excluded.note,
    deduct = case when public.is_manager() and p_deduct is not null then p_deduct else ac_monthly.deduct end, updated_at = now();
end $$;
revoke all on function public.ac_month_save(date, int, jsonb, text, numeric) from public, anon;
grant execute on function public.ac_month_save(date, int, jsonb, text, numeric) to authenticated;

-- slots: contractor (lead; submits) · supervisor (hospital staff in charge) · manager (accepts; freezes the numbers)
create or replace function public.ac_month_sign(p_month date, p_slot text) returns text
language plpgsql security definer set search_path = public as $$
declare h uuid := public.my_hospital(); m date := date_trunc('month', p_month)::date; mo ac_monthly; s text := public.ac_side(); v_sum jsonb;
begin
  select * into mo from ac_monthly where hospital_id = h and month = m for update;
  if mo.month is null then raise exception 'ยังไม่ได้บันทึกสรุปเดือนนี้'; end if;
  if mo.status = 'accepted' then raise exception 'เดือนนี้ตรวจรับแล้ว'; end if;
  if mo.signs ? p_slot then raise exception 'ตำแหน่งนี้ลงนามแล้ว'; end if;
  if p_slot = 'contractor' then
    if s is distinct from 'lead' then raise exception 'ส่งงานได้เฉพาะหัวหน้าช่างผู้รับเหมา'; end if;
  elsif p_slot = 'supervisor' then
    if s is distinct from 'hospital' or mo.status <> 'submitted' then raise exception 'ลงนามได้เฉพาะเจ้าหน้าที่โรงพยาบาล หลังผู้รับเหมาส่งรายงานแล้ว'; end if;
  elsif p_slot = 'manager' then
    if not public.is_manager() or mo.status <> 'submitted' then raise exception 'ตรวจรับได้เฉพาะผู้จัดการฝั่งโรงพยาบาล หลังผู้รับเหมาส่งรายงานแล้ว'; end if;
    if exists (select 1 from jsonb_each_text(mo.docs) d where d.value = 'no') or (select count(*) from jsonb_each_text(mo.docs)) < 11 then
      raise exception 'เอกสารประกอบยังไม่ครบ 11 รายการ ตรวจรับไม่ได้'; end if;
    v_sum := public.ac_month_summary(m);
  else raise exception 'ตำแหน่งลงนามไม่ถูกต้อง';
  end if;
  update ac_monthly set signs = signs || jsonb_build_object(p_slot, jsonb_build_object('name', (select full_name from profiles where id = auth.uid()), 'at', now(), 'by', auth.uid())),
    status = case when p_slot = 'contractor' then 'submitted' when p_slot = 'manager' then 'accepted' else status end,
    summary = coalesce(v_sum, summary), updated_at = now()
  where hospital_id = h and month = m;
  return (select status from ac_monthly where hospital_id = h and month = m);
end $$;
revoke all on function public.ac_month_sign(date, text) from public, anon;
grant execute on function public.ac_month_sign(date, text) to authenticated;

-- manager sends a submitted month back to the contractor
create or replace function public.ac_month_return(p_month date) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_manager() then raise exception 'ตีกลับได้เฉพาะผู้จัดการฝั่งโรงพยาบาล'; end if;
  update ac_monthly set status = 'draft', signs = '{}', updated_at = now()
    where hospital_id = public.my_hospital() and month = date_trunc('month', p_month)::date and status = 'submitted';
  if not found then raise exception 'ตีกลับได้เฉพาะเดือนที่ส่งแล้วและยังไม่ตรวจรับ'; end if;
end $$;
revoke all on function public.ac_month_return(date) from public, anon;
grant execute on function public.ac_month_return(date) to authenticated;

-- history of one unit: every form, repair call and damage, newest first — TOR 10.12, 10.13 ------------------------------
create or replace function public.ac_history(p_unit uuid) returns table (at timestamptz, kind text, ref text, detail text, measure text, who text, status text)
language sql stable security definer set search_path = public as $$
  with u as (select * from ac_units where id = p_unit and hospital_id = public.my_hospital())
  select (fo.work_date::text || ' 12:00:00+07')::timestamptz, case fo.work_kind when 'major' then 'ล้างใหญ่' when 'minor' then 'ล้างย่อย' else fo.form end, fo.doc_no,
      coalesce(nullif(fo.data->>'remark', ''), fo.form), coalesce(fo.data->>'measure_text', ''),
      coalesce(fo.signs->'tech'->>'name', fo.signs->'lead'->>'name', ''), fo.status
    from ac_forms fo, u where fo.hospital_id = u.hospital_id and (fo.unit_id = u.id
      or (fo.form in ('AC-05','AC-07') and exists (select 1 from jsonb_array_elements(coalesce(fo.data->'rows', '[]')) r where upper(r->>'code') = upper(u.code))))
  union all
  select t.reported_at, 'แจ้งซ่อม', t.ticket_no, t.symptom, coalesce(t.fix_note, ''), coalesce(t.inspector_name, ''), case when t.inspected_at is not null then 'accepted' when t.fixed_at is not null then 'submitted' else 'draft' end
    from ac_tickets t, u where t.unit_id = u.id
  union all
  select d.occurred_at, 'ความเสียหาย', 'AC-10', d.asset, coalesce(d.cause, ''), coalesce(d.inspector_name, ''), case when d.inspected_at is not null then 'accepted' when d.fixed_at is not null then 'submitted' else 'draft' end
    from ac_damages d, u where d.unit_id = u.id
  order by 1 desc limit 500 $$;
revoke all on function public.ac_history(uuid) from public, anon;
grant execute on function public.ac_history(uuid) to authenticated;
