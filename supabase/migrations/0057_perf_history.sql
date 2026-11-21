-- Bi-Weekly Performance: every save is ADDED as a new version, nothing is ever overwritten (user 2026-11-21 "ไม่ทับแต่เพิ่ม").
-- perf_weekly keeps the latest version of each round (the page works as before); perf_weekly_history keeps a copy of
-- every saved / sent version so any earlier version can be opened or downloaded again, and the month-end roll-up can use them.
-- Additive only: one new table, one trigger, read policy. The AI progress steps (ai.job only) are not copied, only the finished report.

create table if not exists public.perf_weekly_history (
  id bigint generated always as identity primary key,
  perf_id bigint not null references public.perf_weekly(id) on delete cascade,
  hospital_id uuid not null references public.hospitals(id),
  meet_date date not null,
  kind text not null,                       -- 'draft' (บันทึกร่าง) / 'submit' (ส่งรายงาน) / 'ai' (AI 3 คนทำรายงานเสร็จ)
  data jsonb not null default '{}',
  backlog jsonb not null default '{}',
  ai jsonb not null default '{}',
  submitted_at timestamptz,
  saved_by uuid references public.profiles(id),
  saved_at timestamptz not null default now()
);
create index if not exists perf_weekly_history_perf on public.perf_weekly_history (perf_id, saved_at desc);
create index if not exists perf_weekly_history_month on public.perf_weekly_history (hospital_id, meet_date);
alter table public.perf_weekly_history enable row level security;
do $p$ begin
  if not exists (select 1 from pg_policies where tablename = 'perf_weekly_history' and policyname = 'pwh read') then
    create policy "pwh read" on public.perf_weekly_history for select to authenticated
      using (public.am_exec() or hospital_id in (select m.id from public.my_hospitals() m)); end if;
end $p$;
grant select on public.perf_weekly_history to authenticated;

create or replace function public.perf_weekly_keep() returns trigger language plpgsql security definer set search_path = public as $f$
declare k text;
begin
  if tg_op = 'UPDATE' and new.data = old.data and new.backlog = old.backlog and new.submitted_at is not distinct from old.submitted_at
     and (new.ai -> 'report') is not distinct from (old.ai -> 'report') then
    return new;                              -- only AI progress changed: nothing new to keep
  end if;
  k := case when new.submitted_at is not null and (tg_op = 'INSERT' or new.submitted_at is distinct from old.submitted_at) then 'submit'
            when tg_op = 'UPDATE' and (new.ai -> 'report') is distinct from (old.ai -> 'report') and new.data = old.data then 'ai'
            else 'draft' end;
  insert into public.perf_weekly_history (perf_id, hospital_id, meet_date, kind, data, backlog, ai, submitted_at, saved_by)
    values (new.id, new.hospital_id, new.meet_date, k, new.data, new.backlog, new.ai - 'job', new.submitted_at, coalesce(new.updated_by, auth.uid()));
  return new;
end $f$;
revoke execute on function public.perf_weekly_keep() from public, anon, authenticated;
drop trigger if exists perf_weekly_keep on public.perf_weekly;
create trigger perf_weekly_keep after insert or update on public.perf_weekly for each row execute function public.perf_weekly_keep();

-- the rounds saved before this migration become version 1
insert into public.perf_weekly_history (perf_id, hospital_id, meet_date, kind, data, backlog, ai, submitted_at, saved_by, saved_at)
  select p.id, p.hospital_id, p.meet_date, case when p.submitted_at is not null then 'submit' else 'draft' end, p.data, p.backlog, p.ai - 'job', p.submitted_at, p.updated_by, p.updated_at
  from public.perf_weekly p where not exists (select 1 from public.perf_weekly_history h where h.perf_id = p.id);
