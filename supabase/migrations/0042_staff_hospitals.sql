-- 0042: which hospitals each person may work in (user 2026-11-16). Set by a 12-hospital executive in Settings > Staff:
-- tick hospitals one by one, or "ทุกโรงพยาบาล". A person with more than one hospital picks the one they are working in
-- on their home page; the system then shows that hospital's data, exactly as for someone who belongs to it.
-- Default (nothing set) = only the hospital they were added to, as before. Executives keep seeing all 12.
-- Additive only: two new columns, new functions.

alter table public.staff_access add column if not exists hospitals uuid[];
alter table public.staff_access add column if not exists all_hospitals boolean not null default false;

-- hospitals the signed-in person may work in
create or replace function public.my_hospitals() returns table (id uuid, code text, name text, current boolean)
language sql stable security definer set search_path = public as $$
  with me as (select p.hospital_id, lower(u.email) email from profiles p join auth.users u on u.id = p.id where p.id = auth.uid() and p.active),
  a as (select s.* from staff_access s join me on s.email = me.email)
  select h.id, h.code, h.name, h.id = (select hospital_id from me)
  from hospitals h
  where public.am_exec() or h.id = (select hospital_id from me)
     or exists (select 1 from a where a.all_hospitals or h.id = any(coalesce(a.hospitals, '{}')))
  order by h.code $$;

-- switch the hospital I am working in (only to one I was given)
create or replace function public.switch_hospital(p_hospital uuid) returns text
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.my_hospitals() m where m.id = p_hospital) then raise exception 'บัญชีนี้ไม่ได้รับสิทธิ์โรงพยาบาลนี้'; end if;
  -- keep the hospital I leave in my list, so I can switch back
  update staff_access set hospitals = array_append(coalesce(hospitals, '{}'), public.my_hospital())
   where email = lower((select email from auth.users where id = auth.uid())) and not all_hospitals and not (public.my_hospital() = any(coalesce(hospitals, '{}')));
  update profiles set hospital_id = p_hospital where id = auth.uid();
  return 'ok';
end $$;

-- executives set the hospitals of a person (p_all = every hospital; else the ticked list)
create or replace function public.staff_hospitals_set(p_email text, p_all boolean, p_hospitals uuid[]) returns text
language plpgsql security definer set search_path = public as $$
declare v text := lower(trim(p_email));
begin
  if not public.am_exec() then raise exception 'เฉพาะผู้บริหาร 12 โรง ตั้งโรงพยาบาลที่เข้าได้'; end if;
  if public.staff_email_hospital(v) is null then raise exception 'ยังไม่มีอีเมลนี้ในรายชื่อเจ้าหน้าที่ ให้เพิ่มเจ้าหน้าที่ก่อน'; end if;
  insert into staff_access (email, hospitals, all_hospitals, set_by, set_at) values (v, (select array_agg(distinct x) from unnest(coalesce(p_hospitals, '{}') || public.staff_email_hospital(v)) x), coalesce(p_all, false), auth.uid(), now())
  on conflict (email) do update set hospitals = excluded.hospitals, all_hospitals = excluded.all_hospitals, set_by = auth.uid(), set_at = now();
  return 'ok';
end $$;

-- for the staff list (executives only): hospitals given to each person
create or replace function public.staff_hospitals_list() returns table (email text, all_hospitals boolean, hospitals uuid[])
language sql stable security definer set search_path = public as $$
  select a.email, a.all_hospitals, a.hospitals from staff_access a where public.am_exec() $$;

revoke execute on function public.my_hospitals(), public.switch_hospital(uuid), public.staff_hospitals_set(text, boolean, uuid[]), public.staff_hospitals_list() from public, anon;
grant execute on function public.my_hospitals(), public.switch_hospital(uuid), public.staff_hospitals_set(text, boolean, uuid[]), public.staff_hospitals_list() to authenticated;
