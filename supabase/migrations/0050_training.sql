-- อบรม · แฟ้มสมรรถนะ (Training & competency): JCI 8th FMS.01.01 / FMS.09.01 / SQE (outsource staff) and contract KPI item 7.
-- Additive only: 4 new tables, read/write policies, a central course list. Nothing existing is changed.
-- Competency is worked out on the page: last passed session of a course + valid_months = still valid / expiring / expired / never.

create table if not exists public.training_courses (
  id bigint generated always as identity primary key,
  hospital_id uuid references public.hospitals(id),          -- null = central course used by all 12 hospitals
  code text not null,
  name text not null,
  category text not null default 'อื่น ๆ',                   -- e.g. อัคคีภัย / ภาวะฉุกเฉิน / ความปลอดภัย / สารเคมี / ควบคุมการติดเชื้อ / ปฐมนิเทศ / เทคนิคงานช่าง
  groups text[] not null default '{}',                       -- ช่าง / แม่บ้าน / รปภ. / ผู้รับเหมา / อื่น ๆ (empty = everyone)
  mandatory boolean not null default true,
  kpi7 boolean not null default false,                       -- counts for contract KPI item 7 (emergency training: lift, power failure, fire)
  valid_months int not null default 12 check (valid_months between 0 and 120),   -- 0 = once, never expires
  hours numeric not null default 1,
  ref text,                                                  -- standard / ME reference, e.g. FMS.06.01
  active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create unique index if not exists training_courses_code_uq on public.training_courses (coalesce(hospital_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(code));

create table if not exists public.training_people (
  id bigint generated always as identity primary key,
  hospital_id uuid not null references public.hospitals(id),
  full_name text not null,
  grp text not null default 'ช่าง' check (grp in ('ช่าง', 'แม่บ้าน', 'รปภ.', 'ผู้รับเหมา', 'อื่น ๆ')),
  position text,
  company text,
  start_date date,
  profile_id uuid references public.profiles(id),
  active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists training_people_hosp_idx on public.training_people (hospital_id, active);
create unique index if not exists training_people_profile_uq on public.training_people (hospital_id, profile_id) where profile_id is not null;

create table if not exists public.training_sessions (
  id bigint generated always as identity primary key,
  hospital_id uuid not null references public.hospitals(id),
  course_id bigint not null references public.training_courses(id),
  held_on date not null,
  hours numeric,
  trainer text,
  place text,
  note text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists training_sessions_hosp_idx on public.training_sessions (hospital_id, held_on);

create table if not exists public.training_attendance (
  id bigint generated always as identity primary key,
  session_id bigint not null references public.training_sessions(id) on delete cascade,
  person_id bigint not null references public.training_people(id),
  result text not null default 'pass' check (result in ('pass', 'fail', 'attend')),
  score numeric,
  note text,
  unique (session_id, person_id)
);
create index if not exists training_attendance_person_idx on public.training_attendance (person_id);

alter table public.training_courses enable row level security;
alter table public.training_people enable row level security;
alter table public.training_sessions enable row level security;
alter table public.training_attendance enable row level security;

do $p$ begin
  -- courses: everyone signed in reads central courses and their own hospitals' courses; heads add their hospital's, execs add central ones
  if not exists (select 1 from pg_policies where tablename = 'training_courses' and policyname = 'tc read') then
    create policy "tc read" on public.training_courses for select to authenticated
      using (hospital_id is null or public.am_exec() or hospital_id in (select m.id from public.my_hospitals() m)); end if;
  if not exists (select 1 from pg_policies where tablename = 'training_courses' and policyname = 'tc write') then
    create policy "tc write" on public.training_courses for insert to authenticated
      with check (public.am_exec() or (hospital_id is not null and public.is_manager() and hospital_id in (select m.id from public.my_hospitals() m))); end if;
  if not exists (select 1 from pg_policies where tablename = 'training_courses' and policyname = 'tc edit') then
    create policy "tc edit" on public.training_courses for update to authenticated
      using (public.am_exec() or (hospital_id is not null and public.is_manager() and hospital_id in (select m.id from public.my_hospitals() m)))
      with check (public.am_exec() or (hospital_id is not null and public.is_manager() and hospital_id in (select m.id from public.my_hospitals() m))); end if;

  -- people and sessions: read = own hospitals or exec; write = heads of that hospital or exec
  if not exists (select 1 from pg_policies where tablename = 'training_people' and policyname = 'tp read') then
    create policy "tp read" on public.training_people for select to authenticated
      using (public.am_exec() or hospital_id in (select m.id from public.my_hospitals() m)); end if;
  if not exists (select 1 from pg_policies where tablename = 'training_people' and policyname = 'tp write') then
    create policy "tp write" on public.training_people for insert to authenticated
      with check (public.am_exec() or (public.is_manager() and hospital_id in (select m.id from public.my_hospitals() m))); end if;
  if not exists (select 1 from pg_policies where tablename = 'training_people' and policyname = 'tp edit') then
    create policy "tp edit" on public.training_people for update to authenticated
      using (public.am_exec() or (public.is_manager() and hospital_id in (select m.id from public.my_hospitals() m)))
      with check (public.am_exec() or (public.is_manager() and hospital_id in (select m.id from public.my_hospitals() m))); end if;

  if not exists (select 1 from pg_policies where tablename = 'training_sessions' and policyname = 'ts read') then
    create policy "ts read" on public.training_sessions for select to authenticated
      using (public.am_exec() or hospital_id in (select m.id from public.my_hospitals() m)); end if;
  if not exists (select 1 from pg_policies where tablename = 'training_sessions' and policyname = 'ts write') then
    create policy "ts write" on public.training_sessions for insert to authenticated
      with check (public.am_exec() or (public.is_manager() and hospital_id in (select m.id from public.my_hospitals() m))); end if;
  if not exists (select 1 from pg_policies where tablename = 'training_sessions' and policyname = 'ts edit') then
    create policy "ts edit" on public.training_sessions for update to authenticated
      using (public.am_exec() or (public.is_manager() and hospital_id in (select m.id from public.my_hospitals() m)))
      with check (public.am_exec() or (public.is_manager() and hospital_id in (select m.id from public.my_hospitals() m))); end if;

  -- attendance follows its session's hospital
  if not exists (select 1 from pg_policies where tablename = 'training_attendance' and policyname = 'ta read') then
    create policy "ta read" on public.training_attendance for select to authenticated
      using (exists (select 1 from public.training_sessions s where s.id = session_id
        and (public.am_exec() or s.hospital_id in (select m.id from public.my_hospitals() m)))); end if;
  if not exists (select 1 from pg_policies where tablename = 'training_attendance' and policyname = 'ta write') then
    create policy "ta write" on public.training_attendance for insert to authenticated
      with check (exists (select 1 from public.training_sessions s join public.training_people p on p.id = person_id and p.hospital_id = s.hospital_id
        where s.id = session_id and (public.am_exec() or (public.is_manager() and s.hospital_id in (select m.id from public.my_hospitals() m))))); end if;
  if not exists (select 1 from pg_policies where tablename = 'training_attendance' and policyname = 'ta edit') then
    create policy "ta edit" on public.training_attendance for update to authenticated
      using (exists (select 1 from public.training_sessions s where s.id = session_id
        and (public.am_exec() or (public.is_manager() and s.hospital_id in (select m.id from public.my_hospitals() m))))); end if;
end $p$;

grant select, insert, update on public.training_courses, public.training_people, public.training_sessions, public.training_attendance to authenticated;

-- central courses (JCI 8th FMS / SQE for engineering, housekeeping and security staff; KPI item 7 = emergency training)
insert into public.training_courses (hospital_id, code, name, category, groups, mandatory, kpi7, valid_months, hours, ref)
select null, v.code, v.name, v.cat, v.grp, v.mand, v.k7, v.vm, v.hr, v.ref from (values
  ('OR01', 'ปฐมนิเทศพนักงานใหม่ (ความปลอดภัย, Code ฉุกเฉิน, จุดรวมพล, การแจ้งเหตุ)', 'ปฐมนิเทศ', '{}'::text[], true, false, 0, 3, 'FMS.01.01 · SQE'),
  ('FR01', 'ดับเพลิงขั้นต้น RACE / PASS และการใช้ถังดับเพลิง', 'อัคคีภัย', '{}'::text[], true, true, 12, 3, 'FMS.06.00'),
  ('FR02', 'ซ้อมอพยพหนีไฟ และหน้าที่ตาม Code Red', 'อัคคีภัย', '{}'::text[], true, true, 12, 2, 'FMS.06.01'),
  ('EM01', 'Code ฉุกเฉินของโรงพยาบาล (Code Red / Blue / Pink / Grey ฯลฯ) หน้าที่ของแต่ละกลุ่ม', 'ภาวะฉุกเฉิน', '{}'::text[], true, false, 12, 1, 'FMS.09.01'),
  ('EM02', 'ระบบสาธารณูปโภคขัดข้อง: ไฟฟ้าดับ เครื่องกำเนิดไฟฟ้า น้ำไม่ไหล (Utility failure)', 'ภาวะฉุกเฉิน', '{ช่าง}'::text[], true, true, 12, 2, 'FMS.08.02'),
  ('EM03', 'ช่วยเหลือผู้ติดค้างในลิฟต์ (Lift rescue)', 'ภาวะฉุกเฉิน', '{ช่าง,รปภ.}'::text[], true, true, 12, 2, 'FMS.08.00'),
  ('EM04', 'ปิดวาล์วก๊าซทางการแพทย์ (Zone valve) และการแจ้งหน่วยงาน', 'ภาวะฉุกเฉิน', '{ช่าง}'::text[], true, false, 12, 1, 'FMS.08.01'),
  ('SF01', 'ความปลอดภัยงานไฟฟ้า และ Lockout / Tagout', 'ความปลอดภัย', '{ช่าง}'::text[], true, false, 12, 3, 'FMS.03.00'),
  ('SF02', 'งานที่อับอากาศ และงานบนที่สูง', 'ความปลอดภัย', '{ช่าง,ผู้รับเหมา}'::text[], true, false, 24, 6, 'FMS.03.00'),
  ('SF03', 'Work Permit และ Hot work', 'ความปลอดภัย', '{ช่าง,ผู้รับเหมา}'::text[], true, false, 12, 1, 'FMS.10.00'),
  ('HZ01', 'สารเคมีและวัสดุอันตราย: SDS, Spill kit, Eyewash', 'สารเคมี', '{ช่าง,แม่บ้าน}'::text[], true, false, 12, 2, 'FMS.05.00'),
  ('HZ02', 'การคัดแยกและจัดการขยะติดเชื้อ / ขยะอันตราย', 'สารเคมี', '{แม่บ้าน}'::text[], true, false, 12, 1, 'FMS.05.00'),
  ('IC01', 'ควบคุมการติดเชื้อขณะซ่อม / ปรับปรุง (ICRA, กั้นพื้นที่, HEPA)', 'ควบคุมการติดเชื้อ', '{ช่าง,ผู้รับเหมา}'::text[], true, false, 12, 2, 'FMS.10.00 · PCI'),
  ('IC02', 'ล้างมือ 7 ขั้นตอน และอุปกรณ์ป้องกัน (PPE)', 'ควบคุมการติดเชื้อ', '{}'::text[], true, false, 12, 1, 'PCI'),
  ('SC01', 'การรักษาความปลอดภัย: Code Pink, บุคคลต้องสงสัย, ความรุนแรง (Code Grey)', 'การรักษาความปลอดภัย', '{รปภ.}'::text[], true, false, 12, 2, 'FMS.04.00'),
  ('TK01', 'ระบบปรับอากาศ Chiller / AHU และค่าแรงดันห้อง (AIIR / OR)', 'เทคนิคงานช่าง', '{ช่าง}'::text[], false, false, 24, 3, 'FMS.08.03'),
  ('TK02', 'Water management: Cooling tower (Legionella), น้ำ RO', 'เทคนิคงานช่าง', '{ช่าง}'::text[], false, false, 24, 2, 'FMS.08.04')
) v(code, name, cat, grp, mand, k7, vm, hr, ref)
where not exists (select 1 from public.training_courses c where c.hospital_id is null and lower(c.code) = lower(v.code));
