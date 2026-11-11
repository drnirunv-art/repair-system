-- Admin-only helper: import equipment rows [[system, code, name], ...] for one hospital
-- and derive locations from "Special room" names. Not callable by app users.
CREATE OR REPLACE FUNCTION public.import_equipment(p_hospital_code text, p_rows jsonb)
 RETURNS TABLE(equipment_added integer, locations_added integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare h uuid; e int; l int;
begin
  select id into h from hospitals where code = p_hospital_code;
  if h is null then raise exception 'no hospital %', p_hospital_code; end if;
  with r0 as (
    select trim(x->>0) sy, nullif(trim(x->>1),'') c, regexp_replace(trim(x->>2), '\s+', ' ', 'g') n, ord
    from jsonb_array_elements(p_rows) with ordinality t(x, ord) where coalesce(trim(x->>2),'') <> ''
  ), r as (
    select sy, coalesce(c, 'EQ' || ord) c,
      case when c is not null and position(lower(c) in lower(n)) = 0 and length(c) > 4 then c || ' · ' || n else n end n
    from r0
  ), ins as (
    insert into equipment (hospital_id, system, code, name)
    select h, sy, c, n from r
    where not exists (select 1 from equipment q where q.hospital_id = h and q.system = r.sy and q.code = r.c and q.name = r.n)
    returning 1
  ) select count(*) into e from ins;
  with p as (
    select coalesce('อาคาร ' || substring(name from 'อาคาร\s*([0-9A-Za-zก-๙]+)'), 'ไม่ระบุอาคาร') b,
           coalesce('ชั้น ' || substring(name from 'ชั้น\s*([0-9]+[A-Za-z]?)'), '-') f,
           trim(regexp_replace(regexp_replace(name, '\s*ชั้น\s*\S+', '', 'g'), '\s*อาคาร\s*\S+', '', 'g')) d
    from equipment where hospital_id = h and system ilike 'special%'
  ), ins2 as (
    insert into locations (hospital_id, building, floor, department)
    select distinct h, b, f, left(d, 120) from p where d <> ''
    on conflict do nothing returning 1
  ) select count(*) into l from ins2;
  insert into locations (hospital_id, building, floor, department, sort)
  values (h, 'พื้นที่ส่วนกลาง', '-', 'ห้องเครื่อง / ระบบส่วนกลาง', 999) on conflict do nothing;
  return query select e, l;
end $function$;

revoke all on function public.import_equipment(text, jsonb) from public, anon, authenticated;
