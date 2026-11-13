-- 0030 The master plan has two parts by the template's MAINTAIN BY column: PM Inhouse (TW) and PM MA (contractor).
-- Keeps the text of that column as written (a "TW/MA" machine shows in both parts) and gives the follow-up table per part. Additive.
alter table public.equipment add column if not exists pm_by_raw text;

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
        pm_vendor = nullif(trim(r ->> 'vendor'), ''), pm_by = v_by, pm_by_raw = nullif(upper(left(trim(r ->> 'by'), 40)), ''), pm_grid = g, pm_year = p_year, pm_months = ms, pm_week = coalesce(wk, 1), pm_freq = fq, updated_at = now()
      where id = eid;
      up := up + 1;
    else
      insert into equipment (hospital_id, code, tag, name, building, floor, place, system, pm_group, pm_vendor, pm_by, pm_by_raw, pm_grid, pm_year, pm_months, pm_week, pm_freq, in_form)
      values (h, v_tag, v_tag, trim(r ->> 'name'), nullif(trim(r ->> 'building'), ''), nullif(trim(r ->> 'floor'), ''), nullif(trim(r ->> 'place'), ''), nullif(trim(r ->> 'system'), ''),
        nullif(trim(r ->> 'grp'), ''), nullif(trim(r ->> 'vendor'), ''), v_by, nullif(upper(left(trim(r ->> 'by'), 40)), ''), g, p_year, ms, coalesce(wk, 1), fq, false);
      ad := ad + 1;
    end if;
  end loop;
  return jsonb_build_object('updated', up, 'added', ad);
end $$;

-- follow-up of one part: p_by = 'TW' (PM Inhouse), 'MA' (PM MA) or null (both)
create or replace function public.pm_followup_core_by(p_hospital uuid, p_year int, p_month int, p_by text)
returns table (grp text, planned bigint, done bigint, waiting_sign bigint, not_done bigint, abnormal bigint, pct int, ytd_planned bigint, ytd_done bigint, ytd_pct int)
language sql stable security definer set search_path = public as $$
  with e as (select id, coalesce(nullif(trim(system), ''), nullif(trim(eq_type), ''), 'ไม่ระบุระบบ') g, pm_months from equipment
             where hospital_id = p_hospital and active and cardinality(pm_months) > 0
               and (p_by is null or (p_by = 'MA' and (pm_by = 'MA' or pm_by_raw like '%MA%')) or (p_by = 'TW' and pm_by <> 'MA'))),
  t as (select equipment_id, month, status, abnormal from pm_tasks where hospital_id = p_hospital and year = p_year and month <= p_month),
  a as (select e.g, grouping(e.g) tot,
      count(*) filter (where p_month = any(e.pm_months)) planned,
      count(*) filter (where p_month = any(e.pm_months) and exists (select 1 from t where t.equipment_id = e.id and t.month = p_month and t.status = 'approved')) done,
      count(*) filter (where p_month = any(e.pm_months) and exists (select 1 from t where t.equipment_id = e.id and t.month = p_month and t.status in ('submitted','head_signed'))) waiting,
      coalesce(sum((select count(*) from t where t.equipment_id = e.id and t.month = p_month and t.abnormal > 0)), 0)::bigint abn,
      coalesce(sum((select count(*) from unnest(e.pm_months) m where m <= p_month)), 0)::bigint yp,
      coalesce(sum((select count(*) from t where t.equipment_id = e.id and t.status = 'approved' and t.month = any(e.pm_months))), 0)::bigint yd
    from e group by rollup (e.g))
  select case when tot = 1 then 'รวม' else g end, planned, done, waiting, planned - done - waiting, abn,
    case when planned > 0 then round(100.0 * done / planned)::int end, yp, yd, case when yp > 0 then round(100.0 * yd / yp)::int end
  from a where tot = 1 or planned > 0 or yp > 0 order by tot, 1
$$;
revoke all on function public.pm_followup_core_by(uuid, int, int, text) from public, anon, authenticated;
grant execute on function public.pm_followup_core_by(uuid, int, int, text) to service_role;

create or replace function public.pm_followup_by(p_year int, p_month int, p_by text default null)
returns table (grp text, planned bigint, done bigint, waiting_sign bigint, not_done bigint, abnormal bigint, pct int, ytd_planned bigint, ytd_done bigint, ytd_pct int)
language plpgsql stable security definer set search_path = public as $$
begin
  if public.my_hospital() is null then raise exception 'ต้องเข้าสู่ระบบก่อน'; end if;
  if p_year between 2463 and 2643 then p_year := p_year - 543; end if;
  return query select * from public.pm_followup_core_by(public.my_hospital(), p_year, p_month, nullif(upper(p_by), ''));
end $$;
create or replace function public.pm_followup_all_by(p_year int, p_month int, p_by text default null)
returns table (code text, name text, machines bigint, planned bigint, done bigint, waiting_sign bigint, not_done bigint, abnormal bigint, pct int, ytd_planned bigint, ytd_done bigint, ytd_pct int)
language plpgsql stable security definer set search_path = public as $$
declare b text := nullif(upper(p_by), '');
begin
  if not public.am_exec() then raise exception 'เฉพาะผู้ที่มีสิทธิ์ดูภาพรวม 12 โรงพยาบาล'; end if;
  if p_year between 2463 and 2643 then p_year := p_year - 543; end if;
  return query select h.code, h.name, (select count(*) from equipment e where e.hospital_id = h.id and e.active and cardinality(e.pm_months) > 0
      and (b is null or (b = 'MA' and (e.pm_by = 'MA' or e.pm_by_raw like '%MA%')) or (b = 'TW' and e.pm_by <> 'MA'))),
    c.planned, c.done, c.waiting_sign, c.not_done, c.abnormal, c.pct, c.ytd_planned, c.ytd_done, c.ytd_pct
  from hospitals h left join lateral (select * from public.pm_followup_core_by(h.id, p_year, p_month, b) x where x.grp = 'รวม') c on true
  where h.active order by h.code;
end $$;
revoke all on function public.pm_followup_by(int, int, text), public.pm_followup_all_by(int, int, text) from public, anon;
grant execute on function public.pm_followup_by(int, int, text), public.pm_followup_all_by(int, int, text) to authenticated;
