-- Staff main-menu lock per person (user 2026-11-15): a head sets a lock code for a person in the staff list.
-- That person can use FMS Round and the other pages, but opening the staff main menu (staff.html) asks for the code.
-- Codes are stored only as bcrypt hashes. "Forgot code" makes a NEW 6-digit code and e-mails it to the
-- 12-hospital executives and to the head who set the lock (the old code cannot be read back). Additive only.

create table if not exists public.menu_locks (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  code_hash text not null,
  set_by uuid references public.profiles(id) on delete set null,
  set_at timestamptz not null default now(),
  forgot_at timestamptz
);
alter table public.menu_locks enable row level security;   -- no client policies: functions only

-- head of the person's hospital, or 12-hospital executive; empty code = remove the lock
create or replace function public.menu_lock_set(p_profile uuid, p_code text) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare h uuid;
begin
  select hospital_id into h from profiles where id = p_profile;
  if h is null then raise exception 'ไม่พบเจ้าหน้าที่คนนี้'; end if;
  if not ((public.is_manager() and h = public.my_hospital()) or public.am_exec()) then
    raise exception 'เฉพาะหัวหน้าของโรงพยาบาลนี้ หรือผู้บริหาร 12 โรง ตั้งรหัสล็อกได้'; end if;
  if p_profile = auth.uid() then raise exception 'ตั้งรหัสล็อกให้ตัวเองไม่ได้'; end if;
  if coalesce(trim(p_code), '') = '' then delete from menu_locks where profile_id = p_profile; return 'removed'; end if;
  if length(trim(p_code)) < 4 or length(p_code) > 64 then raise exception 'รหัสล็อกต้องมี 4–64 ตัว'; end if;
  insert into menu_locks (profile_id, code_hash, set_by, set_at) values (p_profile, crypt(trim(p_code), gen_salt('bf')), auth.uid(), now())
  on conflict (profile_id) do update set code_hash = excluded.code_hash, set_by = excluded.set_by, set_at = now();
  return 'set';
end $$;

-- which people of my hospital (or all, for executives) are locked: for the staff list
create or replace function public.menu_lock_list() returns setof uuid
language sql stable security definer set search_path = public as $$
  select l.profile_id from menu_locks l join profiles p on p.id = l.profile_id
  where (public.is_manager() and p.hospital_id = public.my_hospital()) or public.am_exec() $$;

-- is the signed-in person locked?
create or replace function public.menu_lock_mine() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from menu_locks where profile_id = auth.uid()) $$;

create or replace function public.menu_lock_check(p_code text) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select coalesce((select code_hash = crypt(trim(coalesce(p_code, '')), code_hash) from menu_locks where profile_id = auth.uid()), true) $$;

-- forgot: new random 6-digit code, mailed to executives + the head who set it; at most once per 10 minutes
create or replace function public.menu_lock_forgot() returns int
language plpgsql security definer set search_path = public, extensions as $$
declare l menu_locks; p profiles; v_code text; n int;
begin
  select * into l from menu_locks where profile_id = auth.uid();
  if not found then return 0; end if;
  if l.forgot_at is not null and l.forgot_at > now() - interval '10 minutes' then
    raise exception 'ขอรหัสใหม่ไปแล้ว รอ 10 นาทีแล้วค่อยขออีกครั้ง หรือถามรหัสจากหัวหน้า'; end if;
  select * into p from profiles where id = auth.uid();
  v_code := lpad((floor(random() * 1000000))::int::text, 6, '0');
  update menu_locks set code_hash = crypt(v_code, gen_salt('bf')), forgot_at = now() where profile_id = auth.uid();
  insert into email_outbox (hospital_id, to_email, subject, body_text)
  select p.hospital_id, e.email, 'รหัสล็อกเมนูเจ้าหน้าที่ใหม่: ' || coalesce(p.full_name, ''),
    'มีการกด "ลืมรหัสล็อก" ของ ' || coalesce(p.full_name, '') || ' (' || coalesce((select hh.code from hospitals hh where hh.id = p.hospital_id), '') || ')' || chr(10) ||
    'รหัสล็อกใหม่: ' || v_code || chr(10) || chr(10) ||
    'รหัสเดิมใช้ไม่ได้แล้ว ถ้าไม่ได้เป็นคนขอ ให้ตั้งรหัสใหม่ในหน้าเจ้าหน้าที่ > ตั้งค่า > เจ้าหน้าที่' || chr(10) ||
    'ระบบแจ้งซ่อม RS · https://drnirunv-art.github.io/repair-system/staff.html'
  from (select distinct lower(u.email) email from auth.users u
        where u.email is not null and (u.id in (select profile_id from exec_viewers) or u.id = l.set_by)) e;
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.menu_lock_set(uuid, text), public.menu_lock_list(), public.menu_lock_mine(), public.menu_lock_check(text), public.menu_lock_forgot() from public, anon;
grant execute on function public.menu_lock_set(uuid, text), public.menu_lock_list(), public.menu_lock_mine(), public.menu_lock_check(text), public.menu_lock_forgot() to authenticated;
