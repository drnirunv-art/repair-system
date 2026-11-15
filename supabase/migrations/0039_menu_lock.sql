-- Page access + staff-menu lock per person (user 2026-11-15). Set when a head adds or edits a staff e-mail:
--  * pages: which staff pages this person may open (null = all pages, as before)
--  * lock code: if the staff main menu (staff.html) is not ticked, opening it asks for this code
-- Keyed by e-mail so it also works for people who have not signed up yet. Codes are bcrypt hashes only.
-- "Forgot code" makes a NEW 6-digit code and e-mails it to the 12-hospital executives and the head who set it.
-- This controls which pages open; what data a person can read or change is still decided by their role.
-- Additive only.

create table if not exists public.staff_access (
  email text primary key check (email = lower(email)),
  pages text[],
  lock_hash text,
  set_by uuid references public.profiles(id) on delete set null,
  set_at timestamptz not null default now(),
  forgot_at timestamptz
);
alter table public.staff_access enable row level security;   -- no client policies: functions only

-- hospital of an e-mail: signed-up profile first, else a pending invite
create or replace function public.staff_email_hospital(p_email text) returns uuid
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select p.hospital_id from auth.users u join profiles p on p.id = u.id where lower(u.email) = lower(trim(p_email)) limit 1),
    (select i.hospital_id from staff_invites i where i.email = lower(trim(p_email)) limit 1)) $$;

-- p_pages null = all pages; p_lock: null = keep, '' = remove, text = new code
create or replace function public.staff_access_set(p_email text, p_pages text[], p_lock text default null) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare v text := lower(trim(p_email)); h uuid := public.staff_email_hospital(p_email);
begin
  if h is null then raise exception 'ยังไม่มีอีเมลนี้ในรายชื่อเจ้าหน้าที่ ให้เพิ่มเจ้าหน้าที่ก่อน'; end if;
  if not ((public.is_manager() and h = public.my_hospital()) or public.am_exec()) then
    raise exception 'เฉพาะหัวหน้าของโรงพยาบาลนี้ หรือผู้บริหาร 12 โรง ตั้งสิทธิ์ได้'; end if;
  if v = lower((select email from auth.users where id = auth.uid())) and p_pages is not null then
    raise exception 'จำกัดสิทธิ์หน้าของตัวเองไม่ได้'; end if;
  if p_lock is not null and p_lock <> '' and (length(trim(p_lock)) < 4 or length(p_lock) > 64) then
    raise exception 'รหัสล็อกต้องมี 4–64 ตัว'; end if;
  insert into staff_access (email, pages, lock_hash, set_by, set_at)
  values (v, p_pages, case when coalesce(p_lock, '') = '' then null else crypt(trim(p_lock), gen_salt('bf')) end, auth.uid(), now())
  on conflict (email) do update set pages = excluded.pages,
    lock_hash = case when p_lock is null then staff_access.lock_hash when p_lock = '' then null else excluded.lock_hash end,
    set_by = auth.uid(), set_at = now();
  return 'ok';
end $$;

-- for the staff list: access of people in my hospital (executives: everyone)
create or replace function public.staff_access_list() returns table (email text, profile_id uuid, pages text[], locked boolean)
language sql stable security definer set search_path = public as $$
  select a.email, u.id, a.pages, a.lock_hash is not null
  from staff_access a left join auth.users u on lower(u.email) = a.email
  where public.am_exec() or (public.is_manager() and public.staff_email_hospital(a.email) = public.my_hospital()) $$;

-- e-mails of staff in my hospital, so the list can open the edit form (managers / executives only)
create or replace function public.staff_emails() returns table (profile_id uuid, email text)
language sql stable security definer set search_path = public as $$
  select p.id, lower(u.email) from profiles p join auth.users u on u.id = p.id
  where public.am_exec() or (public.is_manager() and p.hospital_id = public.my_hospital()) $$;

-- the signed-in person's own access: {pages, locked}
create or replace function public.my_access() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce((select jsonb_build_object('pages', to_jsonb(a.pages), 'locked', a.lock_hash is not null)
    from staff_access a where a.email = lower((select email from auth.users where id = auth.uid()))), '{"pages":null,"locked":false}'::jsonb) $$;

create or replace function public.menu_lock_check(p_code text) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select coalesce((select a.lock_hash = crypt(trim(coalesce(p_code, '')), a.lock_hash) from staff_access a
    where a.email = lower((select email from auth.users where id = auth.uid())) and a.lock_hash is not null), false) $$;

-- forgot: new random 6-digit code, mailed to executives + the head who set it; at most once per 10 minutes
create or replace function public.menu_lock_forgot() returns int
language plpgsql security definer set search_path = public, extensions as $$
declare a staff_access; p profiles; v_code text; n int;
begin
  select * into a from staff_access where email = lower((select email from auth.users where id = auth.uid())) and lock_hash is not null;
  if not found then return 0; end if;
  if a.forgot_at is not null and a.forgot_at > now() - interval '10 minutes' then
    raise exception 'ขอรหัสใหม่ไปแล้ว รอ 10 นาทีแล้วค่อยขออีกครั้ง หรือถามรหัสจากหัวหน้า'; end if;
  select * into p from profiles where id = auth.uid();
  v_code := lpad((floor(random() * 1000000))::int::text, 6, '0');
  update staff_access set lock_hash = crypt(v_code, gen_salt('bf')), forgot_at = now() where email = a.email;
  insert into email_outbox (hospital_id, to_email, subject, body_text)
  select p.hospital_id, e.email, 'รหัสล็อกเมนูเจ้าหน้าที่ใหม่: ' || coalesce(p.full_name, a.email),
    'มีการกด "ลืมรหัสล็อก" ของ ' || coalesce(p.full_name, '') || ' (' || a.email || ', ' || coalesce((select hh.code from hospitals hh where hh.id = p.hospital_id), '') || ')' || chr(10) ||
    'รหัสล็อกใหม่: ' || v_code || chr(10) || chr(10) ||
    'รหัสเดิมใช้ไม่ได้แล้ว ถ้าไม่ได้เป็นคนขอ ให้ตั้งรหัสใหม่ในหน้าเจ้าหน้าที่ > ตั้งค่า > เจ้าหน้าที่' || chr(10) ||
    'ระบบแจ้งซ่อม RS · https://drnirunv-art.github.io/repair-system/staff.html'
  from (select distinct lower(u.email) email from auth.users u
        where u.email is not null and (u.id in (select profile_id from exec_viewers) or u.id = a.set_by)) e;
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.staff_email_hospital(text), public.staff_access_set(text, text[], text), public.staff_access_list(), public.staff_emails(),
  public.my_access(), public.menu_lock_check(text), public.menu_lock_forgot() from public, anon;
grant execute on function public.staff_access_set(text, text[], text), public.staff_access_list(), public.staff_emails(),
  public.my_access(), public.menu_lock_check(text), public.menu_lock_forgot() to authenticated;
