-- แผนผังอาคาร · ปักหมุดงานซ่อม (floor plans): upload a plan picture per hospital / building / floor, put pins on it for
-- departments, machines and fixed points, place repair jobs on the plan and see the hot spots of frequent problems.
-- Additive only: 3 new tables, 1 private storage bucket, 2 read functions. Nothing existing is changed.

create table if not exists public.floor_plans (
  id bigint generated always as identity primary key,
  hospital_id uuid not null references public.hospitals(id),
  building text not null,
  floor text not null,
  title text,
  image_path text not null,                 -- in bucket floor-plans: <HOSPITAL CODE>/<uuid>.jpg
  img_w int, img_h int,
  note text,
  active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists floor_plans_hosp_idx on public.floor_plans (hospital_id, building, floor) where active;

-- a pin on a plan: x, y = place on the picture from 0 to 1 (so it stays right whatever the screen size)
create table if not exists public.floor_pins (
  id bigint generated always as identity primary key,
  plan_id bigint not null references public.floor_plans(id) on delete cascade,
  kind text not null default 'dept' check (kind in ('dept', 'equip', 'point')),
  department text,                          -- kind dept: jobs whose department is this name land here
  equipment_id uuid references public.equipment(id),   -- kind equip: jobs on this machine land here
  label text,
  x numeric not null check (x between 0 and 1),
  y numeric not null check (y between 0 and 1),
  active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists floor_pins_plan_idx on public.floor_pins (plan_id) where active;

-- the exact place of one repair job, set by staff on the plan (wins over the department / machine pin)
create table if not exists public.floor_job_pins (
  job_id uuid primary key references public.jobs(id) on delete cascade,
  plan_id bigint not null references public.floor_plans(id) on delete cascade,
  x numeric not null check (x between 0 and 1),
  y numeric not null check (y between 0 and 1),
  set_by uuid references public.profiles(id),
  set_at timestamptz not null default now()
);
create index if not exists floor_job_pins_plan_idx on public.floor_job_pins (plan_id);

alter table public.floor_plans enable row level security;
alter table public.floor_pins enable row level security;
alter table public.floor_job_pins enable row level security;

-- who may do what: read = own hospitals or exec; plans and pins = heads of that hospital or exec;
-- a job's own place = any staff of that hospital except observers (the technician on site knows the spot best)
create or replace function public.fp_can_read(p_hospital uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.am_exec() or exists (select 1 from public.my_hospitals() m where m.id = p_hospital) $$;
create or replace function public.fp_can_edit(p_hospital uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.am_exec() or (public.is_manager() and exists (select 1 from public.my_hospitals() m where m.id = p_hospital)) $$;
create or replace function public.fp_can_pin_job(p_hospital uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.am_exec() or (coalesce(public.my_role()::text, 'observer') <> 'observer' and exists (select 1 from public.my_hospitals() m where m.id = p_hospital)) $$;
revoke execute on function public.fp_can_read(uuid), public.fp_can_edit(uuid), public.fp_can_pin_job(uuid) from public, anon;
grant execute on function public.fp_can_read(uuid), public.fp_can_edit(uuid), public.fp_can_pin_job(uuid) to authenticated;

do $p$ begin
  if not exists (select 1 from pg_policies where tablename = 'floor_plans' and policyname = 'fp read') then
    create policy "fp read" on public.floor_plans for select to authenticated using (public.fp_can_read(hospital_id)); end if;
  if not exists (select 1 from pg_policies where tablename = 'floor_plans' and policyname = 'fp add') then
    create policy "fp add" on public.floor_plans for insert to authenticated with check (public.fp_can_edit(hospital_id)); end if;
  if not exists (select 1 from pg_policies where tablename = 'floor_plans' and policyname = 'fp edit') then
    create policy "fp edit" on public.floor_plans for update to authenticated using (public.fp_can_edit(hospital_id)) with check (public.fp_can_edit(hospital_id)); end if;

  if not exists (select 1 from pg_policies where tablename = 'floor_pins' and policyname = 'fpin read') then
    create policy "fpin read" on public.floor_pins for select to authenticated
      using (exists (select 1 from public.floor_plans p where p.id = plan_id and public.fp_can_read(p.hospital_id))); end if;
  if not exists (select 1 from pg_policies where tablename = 'floor_pins' and policyname = 'fpin add') then
    create policy "fpin add" on public.floor_pins for insert to authenticated
      with check (exists (select 1 from public.floor_plans p where p.id = plan_id and public.fp_can_edit(p.hospital_id))); end if;
  if not exists (select 1 from pg_policies where tablename = 'floor_pins' and policyname = 'fpin edit') then
    create policy "fpin edit" on public.floor_pins for update to authenticated
      using (exists (select 1 from public.floor_plans p where p.id = plan_id and public.fp_can_edit(p.hospital_id)))
      with check (exists (select 1 from public.floor_plans p where p.id = plan_id and public.fp_can_edit(p.hospital_id))); end if;

  if not exists (select 1 from pg_policies where tablename = 'floor_job_pins' and policyname = 'fjp read') then
    create policy "fjp read" on public.floor_job_pins for select to authenticated
      using (exists (select 1 from public.floor_plans p where p.id = plan_id and public.fp_can_read(p.hospital_id))); end if;
  if not exists (select 1 from pg_policies where tablename = 'floor_job_pins' and policyname = 'fjp add') then
    create policy "fjp add" on public.floor_job_pins for insert to authenticated
      with check (exists (select 1 from public.floor_plans p join public.jobs j on j.hospital_id = p.hospital_id where p.id = plan_id and j.id = job_id and public.fp_can_pin_job(p.hospital_id))); end if;
  if not exists (select 1 from pg_policies where tablename = 'floor_job_pins' and policyname = 'fjp edit') then
    create policy "fjp edit" on public.floor_job_pins for update to authenticated
      using (exists (select 1 from public.floor_plans p where p.id = plan_id and public.fp_can_pin_job(p.hospital_id)))
      with check (exists (select 1 from public.floor_plans p join public.jobs j on j.hospital_id = p.hospital_id where p.id = plan_id and j.id = job_id and public.fp_can_pin_job(p.hospital_id))); end if;
  if not exists (select 1 from pg_policies where tablename = 'floor_job_pins' and policyname = 'fjp remove') then
    create policy "fjp remove" on public.floor_job_pins for delete to authenticated
      using (exists (select 1 from public.floor_plans p where p.id = plan_id and public.fp_can_pin_job(p.hospital_id))); end if;
end $p$;
grant select, insert, update on public.floor_plans, public.floor_pins to authenticated;
grant select, insert, update, delete on public.floor_job_pins to authenticated;

-- repair jobs of one hospital in a date range, for the plans (also for people who look after several hospitals,
-- whose own job list only shows their current hospital). Only the fields a plan needs; no reporter phone or e-mail.
create or replace function public.fp_jobs(p_hospital uuid, p_from date, p_to date)
returns table (id uuid, job_no text, building text, floor text, department text, location_id uuid, equipment_id uuid, equipment_text text,
  detail text, status text, job_type text, created_at timestamptz, closed_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.fp_can_read(p_hospital) then raise exception 'ไม่มีสิทธิ์ดูข้อมูลของโรงพยาบาลนี้'; end if;
  return query
    select j.id, j.job_no, j.building, j.floor, j.department, j.location_id, j.equipment_id, j.equipment_text,
           j.detail, j.status::text, t.name, j.created_at, j.closed_at
      from jobs j left join job_types t on t.id = j.job_type_id
     where j.hospital_id = p_hospital and j.status::text <> 'cancel'
       and j.created_at >= make_timestamptz(extract(year from p_from)::int, extract(month from p_from)::int, extract(day from p_from)::int, 0, 0, 0, 'Asia/Bangkok')
       and j.created_at < make_timestamptz(extract(year from p_to)::int, extract(month from p_to)::int, extract(day from p_to)::int, 0, 0, 0, 'Asia/Bangkok') + interval '1 day'
     order by j.created_at desc
     limit 5000;
end $$;
revoke execute on function public.fp_jobs(uuid, date, date) from public, anon;
grant execute on function public.fp_jobs(uuid, date, date) to authenticated;

-- private bucket for the plan pictures; folder = hospital code
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('floor-plans', 'floor-plans', false, 15728640, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;
do $s$ begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'floor plans read') then
    create policy "floor plans read" on storage.objects for select to authenticated
      using (bucket_id = 'floor-plans' and exists (select 1 from public.hospitals h where h.code = (storage.foldername(objects.name))[1] and public.fp_can_read(h.id))); end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'floor plans upload') then
    create policy "floor plans upload" on storage.objects for insert to authenticated
      with check (bucket_id = 'floor-plans' and exists (select 1 from public.hospitals h where h.code = (storage.foldername(objects.name))[1] and public.fp_can_edit(h.id))); end if;
end $s$;
