-- 0043: "ส่วนกลาง" (central office) as an affiliation (user 2026-11-16). In Settings > Staff the executive picks
-- "สังกัด": one hospital, or ส่วนกลาง. A central person still works inside the hospitals ticked for them (the profile
-- keeps one of those as the hospital being worked in, so every existing rule keeps working); the flag only says
-- they belong to the central office, and pages show "ส่วนกลาง" for them. No hospitals row is added, so the
-- 12-hospital summaries stay as they are. Additive only: one new column, new functions.

alter table public.staff_access add column if not exists central boolean not null default false;

-- executives mark a person as central office (or not)
create or replace function public.staff_central_set(p_email text, p_central boolean) returns text
language plpgsql security definer set search_path = public as $$
declare v text := lower(trim(p_email));
begin
  if not public.am_exec() then raise exception 'เฉพาะผู้บริหาร 12 โรง ตั้งสังกัดส่วนกลาง'; end if;
  if public.staff_email_hospital(v) is null then raise exception 'ยังไม่มีอีเมลนี้ในรายชื่อเจ้าหน้าที่ ให้เพิ่มเจ้าหน้าที่ก่อน'; end if;
  insert into staff_access (email, central, set_by, set_at) values (v, coalesce(p_central, false), auth.uid(), now())
  on conflict (email) do update set central = excluded.central, set_by = auth.uid(), set_at = now();
  return 'ok';
end $$;

-- e-mails of central-office people (executives only)
create or replace function public.staff_central_list() returns setof text
language sql stable security definer set search_path = public as $$
  select a.email from staff_access a where a.central and public.am_exec() $$;

-- am I central office?
create or replace function public.my_central() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select a.central from staff_access a where a.email = lower((select email from auth.users where id = auth.uid()))), false) $$;

revoke execute on function public.staff_central_set(text, boolean), public.staff_central_list(), public.my_central() from public, anon;
grant execute on function public.staff_central_set(text, boolean), public.staff_central_list(), public.my_central() to authenticated;
