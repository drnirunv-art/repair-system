-- PM monthly tasks are created automatically for all 12 hospitals on the 1st of each month (Bangkok time).
-- Same rule as pm_generate (grid week/kind when the machine has a template plan, else the simple plan); add-only, existing tasks stay.
create or replace function public.pm_generate_all(p_year int default null, p_month int default null) returns int
language plpgsql security definer set search_path = public as $$
declare n int; d date := (now() at time zone 'Asia/Bangkok')::date; y int := coalesce(p_year, extract(year from d)::int); m int := coalesce(p_month, extract(month from d)::int);
begin
  insert into pm_tasks (hospital_id, equipment_id, year, month, week, kind)
  select e.hospital_id, e.id, y, m, coalesce(g.week, e.pm_week), g.kind from equipment e
  left join lateral (select w as week, e.pm_grid ->> (((m - 1) * 4 + w)::text) as kind from generate_series(1, 4) w
    where e.pm_grid ? (((m - 1) * 4 + w)::text) order by w limit 1) g on true
  where e.active and m = any(e.pm_months)
  on conflict (equipment_id, year, month) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.pm_generate_all(int, int) from public, anon, authenticated;

-- 00:05 Bangkok on the 1st = 17:05 UTC on the last day of the previous month; run daily at 17:05 UTC and act only when Bangkok's day is the 1st
select cron.schedule('pm-generate-1st', '5 17 * * *',
  $$select public.pm_generate_all() where extract(day from (now() at time zone 'Asia/Bangkok')) = 1$$);
