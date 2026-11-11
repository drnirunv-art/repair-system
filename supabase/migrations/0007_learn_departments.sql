-- Learn new departments from the public form (additive; submit_job unchanged).
-- A reporter can pick "other" and type a department name; it is added to
-- locations under the chosen building/floor so the next person can select it.

create table public.learned_locations (
  location_id uuid primary key references public.locations(id) on delete cascade,
  hospital_id uuid not null references public.hospitals(id),
  first_job_no text,
  created_at timestamptz not null default now()
);
alter table public.learned_locations enable row level security;
create policy "learned staff read" on public.learned_locations for select to authenticated using (hospital_id = public.my_hospital());
grant select on public.learned_locations to authenticated;

create or replace function public.submit_job_new_dept(
  p_hospital_code text, p_building text, p_floor text, p_department text,
  p_detail text, p_reporter_name text, p_reporter_phone text,
  p_equipment_id uuid default null, p_equipment_text text default null, p_job_type_id uuid default null,
  p_photo_paths text[] default '{}'
) returns table (job_no text)
language plpgsql security definer set search_path = public as $$
declare h uuid; v_dept text := regexp_replace(trim(coalesce(p_department,'')), '\s+', ' ', 'g'); loc uuid; is_new boolean := false; v_no text;
begin
  select id into h from hospitals where code = p_hospital_code and active;
  if h is null then raise exception 'ไม่พบโรงพยาบาล'; end if;
  if length(v_dept) < 2 or length(v_dept) > 80 then raise exception 'ชื่อแผนกต้องยาว 2-80 ตัวอักษร'; end if;
  -- building/floor must already exist for this hospital
  if not exists (select 1 from locations where hospital_id = h and building = p_building and floor = p_floor and active) then
    raise exception 'ไม่พบอาคาร/ชั้นที่เลือก'; end if;
  select id into loc from locations
   where hospital_id = h and building = p_building and floor = p_floor and lower(department) = lower(v_dept) limit 1;
  if loc is null then
    insert into locations (hospital_id, building, floor, department) values (h, p_building, p_floor, v_dept)
      on conflict do nothing returning id into loc;
    if loc is null then
      select id into loc from locations where hospital_id = h and building = p_building and floor = p_floor and department = v_dept;
    else is_new := true; end if;
  end if;
  select s.job_no into v_no from public.submit_job(p_hospital_code, loc, p_detail, p_reporter_name, p_reporter_phone,
    p_equipment_id, p_equipment_text, p_job_type_id, p_photo_paths) s;
  if is_new then insert into learned_locations (location_id, hospital_id, first_job_no) values (loc, h, v_no) on conflict do nothing; end if;
  return query select v_no;
end $$;

revoke execute on function public.submit_job_new_dept from public;
grant execute on function public.submit_job_new_dept to anon, authenticated;
