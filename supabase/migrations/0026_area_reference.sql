-- Reference data per hospital: what each area is (division, hours, whether it needs air-conditioning, what happens when cooling is cut)
-- and the internal phone book. Read by staff of the same hospital only; rows are loaded per hospital outside this file
-- (the data itself is not kept in the repository).
create table if not exists public.area_info (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null references public.hospitals(id) on delete cascade,
  building text not null,
  floor text not null,
  unit text not null,
  division text,
  work_group text check (work_group in ('OPD','IPD','OFFICE')),
  hours text,
  ac_required boolean,          -- true = cooling must stay on, false = can be switched off, null = not assessed
  ac_off_area text,             -- which rooms are affected when cooling is cut to reduce chiller load
  ac_off_risk text,
  ac_mitigation text,
  note text,
  sort int not null default 0,
  active boolean not null default true,
  updated_at timestamptz not null default now(),
  unique (hospital_id, building, floor, unit)
);
create table if not exists public.phone_book (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null references public.hospitals(id) on delete cascade,
  kind text not null default 'internal' check (kind in ('internal','emergency','direct')),
  building text,
  floor text,
  unit text not null,
  numbers text not null default '',
  note text,
  sort int not null default 0,
  active boolean not null default true,
  updated_at timestamptz not null default now()
);
create index if not exists phone_book_hospital on public.phone_book (hospital_id, kind, sort);

alter table public.area_info enable row level security;
alter table public.phone_book enable row level security;
revoke all on public.area_info, public.phone_book from anon;
grant select, insert, update on public.area_info, public.phone_book to authenticated;

create policy "area info read own hospital" on public.area_info for select to authenticated using (hospital_id = public.my_hospital());
create policy "area info managers add" on public.area_info for insert to authenticated with check (hospital_id = public.my_hospital() and public.is_manager());
create policy "area info managers edit" on public.area_info for update to authenticated using (hospital_id = public.my_hospital() and public.is_manager()) with check (hospital_id = public.my_hospital() and public.is_manager());
create policy "phone book read own hospital" on public.phone_book for select to authenticated using (hospital_id = public.my_hospital());
create policy "phone book managers add" on public.phone_book for insert to authenticated with check (hospital_id = public.my_hospital() and public.is_manager());
create policy "phone book managers edit" on public.phone_book for update to authenticated using (hospital_id = public.my_hospital() and public.is_manager()) with check (hospital_id = public.my_hospital() and public.is_manager());
