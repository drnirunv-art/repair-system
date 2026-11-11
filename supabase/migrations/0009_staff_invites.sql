-- Managers can add staff before the person signs up: an invite is stored and applied on sign-up.
create table public.staff_invites (
  email text primary key,
  hospital_id uuid not null references public.hospitals(id),
  role public.app_role not null,
  full_name text,
  invited_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  used_at timestamptz
);
alter table public.staff_invites enable row level security;
create policy "invites managers read" on public.staff_invites for select to authenticated
  using (hospital_id = public.my_hospital() and public.is_manager());
grant select on public.staff_invites to authenticated;

create or replace function public.add_staff(p_email text, p_role public.app_role, p_full_name text default null)
returns text language plpgsql security definer set search_path = public as $$
declare v_email text := lower(trim(p_email));
begin
  if not public.is_manager() then raise exception 'เฉพาะหัวหน้า/ผู้ดูแลเท่านั้น'; end if;
  if p_role = 'owner' and public.my_role() <> 'owner' then raise exception 'ตั้ง Owner ได้เฉพาะ Owner'; end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'รูปแบบอีเมลไม่ถูกต้อง'; end if;
  if exists (select 1 from auth.users where lower(email) = v_email) then
    perform public.assign_staff(v_email, p_role, p_full_name);
    return 'assigned';
  end if;
  insert into staff_invites (email, hospital_id, role, full_name) values (v_email, public.my_hospital(), p_role, nullif(trim(p_full_name),''))
    on conflict (email) do update set hospital_id = excluded.hospital_id, role = excluded.role, full_name = excluded.full_name,
      invited_by = auth.uid(), created_at = now(), used_at = null;
  return 'invited';
end $$;
revoke execute on function public.add_staff(text, public.app_role, text) from public, anon;
grant execute on function public.add_staff(text, public.app_role, text) to authenticated;

create or replace function public.apply_staff_invite() returns trigger
language plpgsql security definer set search_path = public as $$
declare i staff_invites;
begin
  select * into i from staff_invites where email = lower(new.email) and used_at is null;
  if i.email is not null then
    insert into profiles (id, hospital_id, role, full_name) values (new.id, i.hospital_id, i.role, coalesce(i.full_name, split_part(new.email,'@',1)))
      on conflict (id) do update set hospital_id = i.hospital_id, role = i.role, active = true,
        full_name = coalesce(i.full_name, profiles.full_name);
    update staff_invites set used_at = now() where email = i.email;
  end if;
  return new;
end $$;
revoke execute on function public.apply_staff_invite() from public, anon, authenticated;
create trigger on_auth_user_created_invite after insert on auth.users for each row execute function public.apply_staff_invite();
