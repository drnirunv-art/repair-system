-- Yearly PM master plan imported from the Excel template (PM_Plan sheet: 12 months x 4 weeks with marks such as M, Q, S, Y, W, 2M).
-- Add-only: existing machines and plans stay; rows are matched by TAG inside the user's own hospital.
alter table public.equipment
  add column if not exists pm_grid jsonb,                    -- {"1":"M","23":"Y"}: slot 1..48 = (month-1)*4 + week, value = mark in the template
  add column if not exists pm_year int,                      -- year (CE) the grid was planned for
  add column if not exists pm_vendor text,                   -- contractor / vendor column of the template
  add column if not exists pm_group text,                    -- section heading the machine sits under in the template
  add column if not exists in_form boolean not null default true;  -- false = PM register only, not offered in the public repair form
alter table public.pm_tasks add column if not exists kind text;   -- mark of the visit (M, Q, S, Y ...) when the plan came from the template
grant update (pm_grid, pm_year, pm_vendor, pm_group, in_form) on public.equipment to authenticated;

-- month's tasks: week and kind come from the grid when the machine has one, otherwise from the simple plan as before
create or replace function public.pm_generate(p_year int, p_month int) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.is_manager() then raise exception 'เฉพาะหัวหน้า / Admin สร้างแผนเดือนได้'; end if;
  insert into pm_tasks (hospital_id, equipment_id, year, month, week, kind)
  select e.hospital_id, e.id, p_year, p_month, coalesce(g.week, e.pm_week), g.kind from equipment e
  left join lateral (select w as week, e.pm_grid ->> (((p_month - 1) * 4 + w)::text) as kind from generate_series(1, 4) w
    where e.pm_grid ? (((p_month - 1) * 4 + w)::text) order by w limit 1) g on true
  where e.hospital_id = public.my_hospital() and e.active and p_month = any(e.pm_months)
  on conflict (equipment_id, year, month) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

-- bulk import of template rows (the page sends them in chunks). Each row: tag, name, building, floor, place, system, grp, by, vendor, grid.
create or replace function public.pm_import(p_year int, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare h uuid := public.my_hospital(); r jsonb; g jsonb; ms int[]; wk int; fq text; v_tag text; v_by text; eid uuid; up int := 0; ad int := 0;
begin
  if h is null or not public.is_manager() then raise exception 'เฉพาะหัวหน้า / Admin นำเข้าแผน PM ได้'; end if;
  if p_year is null or p_year < 2020 or p_year > 2100 then raise exception 'ปีของแผนไม่ถูกต้อง'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 1000 then raise exception 'ส่งได้ครั้งละไม่เกิน 1,000 แถว'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    v_tag := nullif(trim(r ->> 'tag'), '');
    if v_tag is null or nullif(trim(r ->> 'name'), '') is null then raise exception 'ทุกแถวต้องมี TAG และชื่อเครื่อง'; end if;
    g := coalesce((select jsonb_object_agg(k, upper(left(trim(v), 6))) from jsonb_each_text(coalesce(r -> 'grid', '{}'::jsonb)) x(k, v)
      where k ~ '^\d+$' and k::int between 1 and 48 and trim(v) <> ''), '{}'::jsonb);
    select coalesce(array_agg(distinct ((k::int - 1) / 4) + 1 order by ((k::int - 1) / 4) + 1), '{}') into ms from jsonb_object_keys(g) k;
    select ((k::int - 1) % 4) + 1 into wk from jsonb_object_keys(g) k group by 1 order by count(*) desc, 1 limit 1;
    fq := case when cardinality(ms) >= 7 then 'M' when cardinality(ms) >= 3 then 'Q' when cardinality(ms) = 2 then 'H' when cardinality(ms) = 1 then 'Y' end;
    v_by := case when upper(coalesce(r ->> 'by', '')) like '%TW%' or coalesce(trim(r ->> 'by'), '') = '' then 'TW' else 'MA' end;
    select id into eid from equipment where hospital_id = h and upper(tag) = upper(v_tag);
    if eid is not null then
      update equipment set name = trim(r ->> 'name'), building = coalesce(nullif(trim(r ->> 'building'), ''), building), floor = coalesce(nullif(trim(r ->> 'floor'), ''), floor),
        place = coalesce(nullif(trim(r ->> 'place'), ''), place), system = coalesce(nullif(trim(r ->> 'system'), ''), system), pm_group = coalesce(nullif(trim(r ->> 'grp'), ''), pm_group),
        pm_vendor = nullif(trim(r ->> 'vendor'), ''), pm_by = v_by, pm_grid = g, pm_year = p_year, pm_months = ms, pm_week = coalesce(wk, 1), pm_freq = fq, updated_at = now()
      where id = eid;
      up := up + 1;
    else
      insert into equipment (hospital_id, code, tag, name, building, floor, place, system, pm_group, pm_vendor, pm_by, pm_grid, pm_year, pm_months, pm_week, pm_freq, in_form)
      values (h, v_tag, v_tag, trim(r ->> 'name'), nullif(trim(r ->> 'building'), ''), nullif(trim(r ->> 'floor'), ''), nullif(trim(r ->> 'place'), ''), nullif(trim(r ->> 'system'), ''),
        nullif(trim(r ->> 'grp'), ''), nullif(trim(r ->> 'vendor'), ''), v_by, g, p_year, ms, coalesce(wk, 1), fq, false);
      ad := ad + 1;
    end if;
  end loop;
  return jsonb_build_object('updated', up, 'added', ad);
end $$;
revoke all on function public.pm_import(int, jsonb) from public, anon;
grant execute on function public.pm_import(int, jsonb) to authenticated;
