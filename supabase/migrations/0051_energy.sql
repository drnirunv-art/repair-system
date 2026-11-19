-- รายงานพลังงานและความยั่งยืน (GHI / สัญญาข้อ 3.1.10 / KPI 8.1): one row per hospital per month, typed by a head from the
-- utility bills and hospital statistics. Daily OP meter logs (op_logs) are shown beside it on the page as a cross-check.
-- Additive only: one new table + read/write policies.

create table if not exists public.energy_monthly (
  id bigint generated always as identity primary key,
  hospital_id uuid not null references public.hospitals(id),
  month date not null check (extract(day from month) = 1),   -- first day of the month (CE)
  elec_kwh numeric, elec_cost numeric, peak_kw numeric,       -- electricity bill (PEA / MEA)
  water_m3 numeric, water_cost numeric,                       -- water bill (PWA / MWA / own wells)
  diesel_l numeric, lpg_kg numeric,                           -- fuel: generator + boiler / kitchen
  area_m2 numeric,                                            -- air-conditioned / usable floor area
  patient_days numeric, opd_visits numeric,                   -- inpatient days and outpatient visits in the month
  waste_general_kg numeric, waste_infect_kg numeric, waste_recycle_kg numeric,
  chiller_kwh numeric, chiller_tonh numeric,                  -- chiller plant energy and cooling delivered (for kW/TR)
  note text,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  unique (hospital_id, month)
);
alter table public.energy_monthly enable row level security;

do $p$ begin
  if not exists (select 1 from pg_policies where tablename = 'energy_monthly' and policyname = 'em read') then
    create policy "em read" on public.energy_monthly for select to authenticated
      using (public.am_exec() or hospital_id in (select m.id from public.my_hospitals() m)); end if;
  if not exists (select 1 from pg_policies where tablename = 'energy_monthly' and policyname = 'em write') then
    create policy "em write" on public.energy_monthly for insert to authenticated
      with check (public.am_exec() or (public.is_manager() and hospital_id in (select m.id from public.my_hospitals() m))); end if;
  if not exists (select 1 from pg_policies where tablename = 'energy_monthly' and policyname = 'em edit') then
    create policy "em edit" on public.energy_monthly for update to authenticated
      using (public.am_exec() or (public.is_manager() and hospital_id in (select m.id from public.my_hospitals() m)))
      with check (public.am_exec() or (public.is_manager() and hospital_id in (select m.id from public.my_hospitals() m))); end if;
end $p$;

grant select, insert, update on public.energy_monthly to authenticated;

-- ประชุม Energy รายสัปดาห์: the Chief of each hospital sends the week's energy report by Saturday 10:00 (meeting 14:00-16:00).
-- data = typed sections (previous agenda follow-up, factors, measures, proactive work, central activity, support asked, suggestions),
-- meter roles chosen by the Chief, and a snapshot of the daily figures taken at submit time (so execs see them for any hospital).
create table if not exists public.energy_weekly (
  id bigint generated always as identity primary key,
  hospital_id uuid not null references public.hospitals(id),
  week_date date not null check (extract(isodow from week_date) = 6),   -- the Saturday of the meeting
  data jsonb not null default '{}',
  submitted_at timestamptz,
  submitted_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  unique (hospital_id, week_date)
);
alter table public.energy_weekly enable row level security;
do $p$ begin
  if not exists (select 1 from pg_policies where tablename = 'energy_weekly' and policyname = 'ew read') then
    create policy "ew read" on public.energy_weekly for select to authenticated
      using (public.am_exec() or hospital_id in (select m.id from public.my_hospitals() m)); end if;
  if not exists (select 1 from pg_policies where tablename = 'energy_weekly' and policyname = 'ew write') then
    create policy "ew write" on public.energy_weekly for insert to authenticated
      with check (public.am_exec() or (public.is_manager() and hospital_id in (select m.id from public.my_hospitals() m))); end if;
  if not exists (select 1 from pg_policies where tablename = 'energy_weekly' and policyname = 'ew edit') then
    create policy "ew edit" on public.energy_weekly for update to authenticated
      using (public.am_exec() or (public.is_manager() and hospital_id in (select m.id from public.my_hospitals() m)))
      with check (public.am_exec() or (public.is_manager() and hospital_id in (select m.id from public.my_hospitals() m))); end if;
end $p$;
grant select, insert, update on public.energy_weekly to authenticated;
