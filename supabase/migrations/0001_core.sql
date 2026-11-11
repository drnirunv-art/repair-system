-- Repair System core schema: hospitals, staff roles, locations, job catalog, work orders
create type public.app_role as enum ('owner','admin','chief_engineer','supervisor','senior_technician','technician','safety_officer','observer');
create type public.job_status as enum ('register','assign','work_on','on_hold','clear','evaluated','close','cancel');

create table public.hospitals (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,            -- short code used in job numbers, e.g. PT1
  name text not null,
  slug text unique,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  hospital_id uuid references public.hospitals(id),
  full_name text not null default '',
  phone text,
  role public.app_role not null default 'technician',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.locations (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null references public.hospitals(id) on delete cascade,
  building text not null,
  floor text not null,
  department text not null,
  sort int not null default 0,
  active boolean not null default true,
  unique (hospital_id, building, floor, department)
);

create table public.equipment (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null references public.hospitals(id) on delete cascade,
  location_id uuid references public.locations(id) on delete set null,
  code text,
  name text not null,
  system text,
  active boolean not null default true
);

create table public.job_types (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null references public.hospitals(id) on delete cascade,
  code text not null,
  name text not null,
  standard_minutes int,
  kpi boolean not null default true,
  active boolean not null default true,
  unique (hospital_id, code)
);

create table public.priorities (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null references public.hospitals(id) on delete cascade,
  name text not null,
  sla_minutes int not null,
  sort int not null default 0,
  is_default boolean not null default false,
  unique (hospital_id, name)
);

create table public.job_counters (
  hospital_id uuid not null references public.hospitals(id) on delete cascade,
  period text not null,                 -- YYMM (Buddhist year)
  last_no int not null default 0,
  primary key (hospital_id, period)
);

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  job_no text not null unique,
  hospital_id uuid not null references public.hospitals(id),
  location_id uuid references public.locations(id),
  building text, floor text, department text,
  equipment_id uuid references public.equipment(id),
  equipment_text text,
  detail text not null,
  reporter_name text not null,
  reporter_phone text not null,
  photo_paths text[] not null default '{}',
  job_type_id uuid references public.job_types(id),
  priority_id uuid references public.priorities(id),
  status public.job_status not null default 'register',
  technician_id uuid references public.profiles(id),
  hold_reason text, hold_until date,
  summary text,
  uses_parts boolean,
  close_photo_paths text[] not null default '{}',
  created_at timestamptz not null default now(),
  assigned_at timestamptz, started_at timestamptz, cleared_at timestamptz,
  evaluated_at timestamptz, closed_at timestamptz,
  updated_at timestamptz not null default now()
);
create index jobs_hospital_status_idx on public.jobs (hospital_id, status, created_at desc);
create index jobs_technician_idx on public.jobs (technician_id) where technician_id is not null;
create index jobs_phone_idx on public.jobs (reporter_phone);

create table public.job_events (
  id bigint generated always as identity primary key,
  job_id uuid not null references public.jobs(id) on delete cascade,
  status public.job_status not null,
  note text,
  actor_id uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index job_events_job_idx on public.job_events (job_id, created_at);

-- helpers ---------------------------------------------------------------
create or replace function public.my_hospital() returns uuid
language sql stable security definer set search_path = public as
$$ select hospital_id from public.profiles where id = auth.uid() and active $$;

create or replace function public.my_role() returns public.app_role
language sql stable security definer set search_path = public as
$$ select role from public.profiles where id = auth.uid() and active $$;

create or replace function public.is_manager() returns boolean
language sql stable security definer set search_path = public as
$$ select coalesce(public.my_role() in ('owner','admin','chief_engineer','supervisor'), false) $$;

create or replace function public.touch_updated_at() returns trigger
language plpgsql set search_path = public as
$$ begin new.updated_at := now(); return new; end $$;
create trigger jobs_touch before update on public.jobs for each row execute function public.touch_updated_at();

-- public: submit a repair request without logging in ----------------------
create or replace function public.submit_job(
  p_hospital_code text, p_location_id uuid, p_detail text, p_reporter_name text, p_reporter_phone text,
  p_equipment_id uuid default null, p_equipment_text text default null, p_job_type_id uuid default null,
  p_photo_paths text[] default '{}'
) returns table (job_no text)
language plpgsql security definer set search_path = public as $$
declare h public.hospitals; loc public.locations; per text; n int; v_no text; jid uuid; prio uuid;
begin
  select * into h from hospitals where code = p_hospital_code and active;
  if h.id is null then raise exception 'ไม่พบโรงพยาบาล'; end if;
  select * into loc from locations where id = p_location_id and hospital_id = h.id;
  if loc.id is null then raise exception 'ไม่พบตำแหน่งที่เลือก'; end if;
  if coalesce(trim(p_detail),'') = '' or coalesce(trim(p_reporter_name),'') = '' or coalesce(trim(p_reporter_phone),'') = '' then
    raise exception 'กรอกรายละเอียด ชื่อ และเบอร์โทรให้ครบ'; end if;
  per := to_char((now() at time zone 'Asia/Bangkok') + interval '543 years', 'YYMM');
  insert into job_counters (hospital_id, period, last_no) values (h.id, per, 1)
    on conflict (hospital_id, period) do update set last_no = job_counters.last_no + 1
    returning last_no into n;
  v_no := h.code || '-' || per || '-' || lpad(n::text, 4, '0');
  select id into prio from priorities where hospital_id = h.id and is_default limit 1;
  insert into jobs (job_no, hospital_id, location_id, building, floor, department, equipment_id, equipment_text,
    detail, reporter_name, reporter_phone, photo_paths, job_type_id, priority_id)
  values (v_no, h.id, loc.id, loc.building, loc.floor, loc.department, p_equipment_id, nullif(trim(p_equipment_text),''),
    trim(p_detail), trim(p_reporter_name), trim(p_reporter_phone), coalesce(p_photo_paths,'{}'), p_job_type_id, prio)
  returning id into jid;
  insert into job_events (job_id, status, note) values (jid, 'register', 'แจ้งซ่อมโดย ' || trim(p_reporter_name));
  return query select v_no;
end $$;

-- public: track status by job number, phone or name (limited fields) -------
create or replace function public.track_jobs(p_hospital_code text, p_query text)
returns table (job_no text, created_at timestamptz, building text, floor text, department text, detail text,
  status public.job_status, technician text, hold_reason text, hold_until date, closed_at timestamptz)
language sql stable security definer set search_path = public as $$
  select j.job_no, j.created_at, j.building, j.floor, j.department, j.detail, j.status,
         p.full_name, j.hold_reason, j.hold_until, j.closed_at
  from jobs j join hospitals h on h.id = j.hospital_id
  left join profiles p on p.id = j.technician_id
  where h.code = p_hospital_code and length(trim(p_query)) >= 3
    and (j.job_no ilike '%' || trim(p_query) || '%' or j.reporter_phone = trim(p_query)
         or j.reporter_name ilike '%' || trim(p_query) || '%')
  order by j.created_at desc limit 30
$$;

-- RLS ------------------------------------------------------------------------
alter table public.hospitals enable row level security;
alter table public.profiles enable row level security;
alter table public.locations enable row level security;
alter table public.equipment enable row level security;
alter table public.job_types enable row level security;
alter table public.priorities enable row level security;
alter table public.job_counters enable row level security;
alter table public.jobs enable row level security;
alter table public.job_events enable row level security;

-- reference data readable by anyone (needed by the public form)
create policy "hospitals readable" on public.hospitals for select using (active);
create policy "locations readable" on public.locations for select using (active);
create policy "equipment readable" on public.equipment for select using (active);
create policy "job types readable" on public.job_types for select using (active);
create policy "priorities readable" on public.priorities for select using (true);
-- managers maintain reference data of their hospital
create policy "locations managed" on public.locations for all to authenticated
  using (hospital_id = public.my_hospital() and public.is_manager()) with check (hospital_id = public.my_hospital() and public.is_manager());
create policy "equipment managed" on public.equipment for all to authenticated
  using (hospital_id = public.my_hospital() and public.is_manager()) with check (hospital_id = public.my_hospital() and public.is_manager());
create policy "job types managed" on public.job_types for all to authenticated
  using (hospital_id = public.my_hospital() and public.is_manager()) with check (hospital_id = public.my_hospital() and public.is_manager());
create policy "priorities managed" on public.priorities for all to authenticated
  using (hospital_id = public.my_hospital() and public.is_manager()) with check (hospital_id = public.my_hospital() and public.is_manager());

create policy "profiles same hospital" on public.profiles for select to authenticated
  using (id = auth.uid() or hospital_id = public.my_hospital());
create policy "profiles managed" on public.profiles for update to authenticated
  using (hospital_id = public.my_hospital() and public.is_manager()) with check (hospital_id = public.my_hospital() and public.is_manager());

create policy "jobs staff read" on public.jobs for select to authenticated using (hospital_id = public.my_hospital());
create policy "jobs staff update" on public.jobs for update to authenticated
  using (hospital_id = public.my_hospital() and public.my_role() <> 'observer')
  with check (hospital_id = public.my_hospital());
create policy "events staff read" on public.job_events for select to authenticated
  using (exists (select 1 from public.jobs j where j.id = job_id and j.hospital_id = public.my_hospital()));
create policy "events staff insert" on public.job_events for insert to authenticated
  with check (actor_id = auth.uid() and exists (select 1 from public.jobs j where j.id = job_id and j.hospital_id = public.my_hospital()));
-- job_counters: no policies, only reachable through submit_job

revoke execute on function public.submit_job from public;
grant execute on function public.submit_job to anon, authenticated;
grant execute on function public.track_jobs to anon, authenticated;
