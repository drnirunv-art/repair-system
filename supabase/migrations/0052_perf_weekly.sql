-- ประชุม Bi-Weekly Performance (Chief Engineer): the Chief of each hospital sends the report by Saturday 10:00 (QC checks 10:00-12:00,
-- meeting with GM 14:00-16:00). One row per hospital per meeting Saturday.
-- data    = the 13 sections of the Chief Engineer Weekly Submission Template (site info, TOR scorecard, CM daily, 24h KPI, backlog aging,
--           backlog action plan, PM, MA, energy, energy measures, QC, decisions, next-week commitments), typed or filled from the system
-- backlog = the open-job list uploaded from Excel (or taken from the system): file name, upload time and rows
-- ai      = the Action plan written by three AI roles (RCA fishbone 4M + 5 Why) and the AI 3 check log
-- Additive only: one new table + read/write policies (same rules as energy_weekly).

create table if not exists public.perf_weekly (
  id bigint generated always as identity primary key,
  hospital_id uuid not null references public.hospitals(id),
  meet_date date not null check (extract(isodow from meet_date) = 6),   -- the Saturday of the meeting
  data jsonb not null default '{}',
  backlog jsonb not null default '{}',
  ai jsonb not null default '{}',
  submitted_at timestamptz,
  submitted_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  unique (hospital_id, meet_date)
);
alter table public.perf_weekly enable row level security;
do $p$ begin
  if not exists (select 1 from pg_policies where tablename = 'perf_weekly' and policyname = 'pw read') then
    create policy "pw read" on public.perf_weekly for select to authenticated
      using (public.am_exec() or hospital_id in (select m.id from public.my_hospitals() m)); end if;
  if not exists (select 1 from pg_policies where tablename = 'perf_weekly' and policyname = 'pw write') then
    create policy "pw write" on public.perf_weekly for insert to authenticated
      with check (public.am_exec() or (public.is_manager() and hospital_id in (select m.id from public.my_hospitals() m))); end if;
  if not exists (select 1 from pg_policies where tablename = 'perf_weekly' and policyname = 'pw edit') then
    create policy "pw edit" on public.perf_weekly for update to authenticated
      using (public.am_exec() or (public.is_manager() and hospital_id in (select m.id from public.my_hospitals() m)))
      with check (public.am_exec() or (public.is_manager() and hospital_id in (select m.id from public.my_hospitals() m))); end if;
end $p$;
grant select, insert, update on public.perf_weekly to authenticated;
