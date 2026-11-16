-- 0041: when someone signs up, e-mail the 12-hospital executives with a link that opens Settings > Staff for that e-mail,
-- so they can set the hospital, role and pages right away. Executives can add staff to any hospital.
-- Add-only: new functions and a new trigger; nothing existing is changed or dropped.

-- add a person to a chosen hospital (executives: any hospital; heads: their own hospital only)
create or replace function public.add_staff_in(p_hospital uuid, p_email text, p_role public.app_role, p_full_name text default null)
returns text language plpgsql security definer set search_path = public as $$
declare v_email text := lower(trim(p_email)); uid uuid;
begin
  if p_hospital is null or not exists (select 1 from hospitals where id = p_hospital) then raise exception 'เลือกโรงพยาบาล'; end if;
  if not (public.am_exec() or (public.is_manager() and p_hospital = public.my_hospital())) then
    raise exception 'เฉพาะหัวหน้าของโรงพยาบาลนี้ หรือผู้บริหาร 12 โรง เพิ่มเจ้าหน้าที่ได้'; end if;
  if p_role = 'owner' and public.my_role() <> 'owner' then raise exception 'ตั้ง Owner ได้เฉพาะ Owner'; end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'รูปแบบอีเมลไม่ถูกต้อง'; end if;
  select id into uid from auth.users where lower(email) = v_email;
  if uid is not null then
    insert into profiles (id, hospital_id, role, full_name) values (uid, p_hospital, p_role, coalesce(nullif(trim(p_full_name), ''), split_part(v_email, '@', 1)))
    on conflict (id) do update set hospital_id = p_hospital, role = p_role, active = true, full_name = coalesce(nullif(trim(p_full_name), ''), profiles.full_name);
    return 'assigned';
  end if;
  insert into staff_invites (email, hospital_id, role, full_name) values (v_email, p_hospital, p_role, nullif(trim(p_full_name), ''))
    on conflict (email) do update set hospital_id = excluded.hospital_id, role = excluded.role, full_name = excluded.full_name,
      invited_by = auth.uid(), created_at = now(), used_at = null;
  return 'invited';
end $$;
revoke execute on function public.add_staff_in(uuid, text, public.app_role, text) from public, anon;
grant execute on function public.add_staff_in(uuid, text, public.app_role, text) to authenticated;

-- new sign-up → one e-mail to each executive. Never blocks the sign-up itself.
create or replace function public.signup_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare p profiles; hn text;
begin
  begin
    select * into p from profiles where id = new.id;
    select code || ' ' || name into hn from hospitals where id = p.hospital_id;
    insert into email_outbox (hospital_id, to_email, subject, body_text)
    select x.hospital_id, x.email, 'ขออนุมัติสิทธิ์: มีผู้สมัครบัญชีใหม่ ' || new.email,
      'มีผู้สมัครบัญชีใหม่ในระบบ FM และวิศวกรรมอาคาร' || chr(10) || chr(10) ||
      'อีเมล: ' || new.email || chr(10) ||
      'เวลาที่สมัคร: ' || to_char(now() at time zone 'Asia/Bangkok', 'DD/MM/') || (extract(year from now() at time zone 'Asia/Bangkok')::int + 543) || to_char(now() at time zone 'Asia/Bangkok', ' HH24:MI') || ' น.' || chr(10) ||
      'สถานะ: ' || case when p.hospital_id is not null then 'หัวหน้าเพิ่มไว้แล้ว (' || coalesce(hn, '') || ') ตรวจหรือแก้หน้าที่เข้าได้จากลิงก์ด้านล่าง'
                        else 'ยังไม่มีสิทธิ์ใด ๆ รอตั้งโรงพยาบาล บทบาท และหน้าที่เข้าได้' end || chr(10) || chr(10) ||
      'กดลิงก์นี้เพื่อตั้งสิทธิ์ให้คนนี้ทันที (ต้องเข้าสู่ระบบด้วยบัญชีผู้บริหาร):' || chr(10) ||
      'https://drnirunv-art.github.io/repair-system/staff.html?tab=setup&staff=' || replace(replace(lower(new.email), '+', '%2B'), '@', '%40') || chr(10) || chr(10) ||
      'ถ้าไม่รู้จักคนนี้ ไม่ต้องทำอะไร บัญชีนี้จะยังเข้าหน้าใดไม่ได้'
    from (select distinct on (lower(u.email)) lower(u.email) email, pp.hospital_id
          from exec_viewers v join profiles pp on pp.id = v.profile_id and pp.active and pp.hospital_id is not null
          join auth.users u on u.id = v.profile_id where u.email is not null and u.id <> new.id) x;
  exception when others then null;
  end;
  return new;
end $$;
revoke execute on function public.signup_notify() from public, anon, authenticated;
create trigger on_auth_user_created_zz_notify after insert on auth.users for each row execute function public.signup_notify();

-- hospital already set for an e-mail (for the sign-up link), heads and executives only
create or replace function public.staff_hospital_of(p_email text) returns uuid
language sql stable security definer set search_path = public as $$
  select case when public.am_exec() or public.is_manager() then public.staff_email_hospital(p_email) end $$;
revoke execute on function public.staff_hospital_of(text) from public, anon;
grant execute on function public.staff_hospital_of(text) to authenticated;
