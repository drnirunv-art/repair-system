-- 0029 PM plan import: people with the 12-hospital view can import a hospital's template for that hospital,
-- and a year typed as a Thai year (2569) is stored as CE (2026) everywhere a year comes in. Additive.
create or replace function public.pm_import_core(h uuid, p_year int, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb; g jsonb; ms int[]; wk int; fq text; v_tag text; v_by text; eid uuid; up int := 0; ad int := 0;
begin
  if h is null then raise exception 'ไม่พบโรงพยาบาล'; end if;
  if p_year between 2463 and 2643 then p_year := p_year - 543; end if;   -- a Thai (Buddhist) year is stored as CE
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
revoke all on function public.pm_import_core(uuid, int, jsonb) from public, anon, authenticated;

create or replace function public.pm_import(p_year int, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if public.my_hospital() is null or not public.is_manager() then raise exception 'เฉพาะหัวหน้า / Admin นำเข้าแผน PM ได้'; end if;
  return public.pm_import_core(public.my_hospital(), p_year, p_rows);
end $$;
create or replace function public.pm_import_for(p_hospital uuid, p_year int, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not (public.am_exec() or (p_hospital = public.my_hospital() and public.is_manager())) then raise exception 'เฉพาะผู้ที่มีสิทธิ์ดูภาพรวม 12 โรงพยาบาล นำเข้าแผนให้โรงพยาบาลอื่นได้'; end if;
  if not exists (select 1 from hospitals where id = p_hospital) then raise exception 'ไม่พบโรงพยาบาล'; end if;
  return public.pm_import_core(p_hospital, p_year, p_rows);
end $$;
revoke all on function public.pm_import(int, jsonb), public.pm_import_for(uuid, int, jsonb) from public, anon;
grant execute on function public.pm_import(int, jsonb), public.pm_import_for(uuid, int, jsonb) to authenticated;

-- Thai year guard on the other entry points that take a year
create or replace function public.pm_followup_send_now(p_year int, p_month int, p_plan boolean default false) returns int
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_manager() then raise exception 'เฉพาะหัวหน้า / Admin ส่งอีเมลได้'; end if;
  if p_month not between 1 and 12 then raise exception 'เดือนไม่ถูกต้อง'; end if;
  if p_year between 2463 and 2643 then p_year := p_year - 543; end if;
  return public.pm_followup_queue(public.my_hospital(), p_year, p_month, coalesce(p_plan, false));
end $$;
