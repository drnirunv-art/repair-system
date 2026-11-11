-- New sign-ups get a profile; managers attach staff to their hospital; all job status changes go through job_transition()
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, full_name) values (new.id, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1)))
  on conflict do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();
revoke execute on function public.handle_new_user() from public, anon, authenticated;

create or replace function public.assign_staff(p_email text, p_role public.app_role, p_full_name text default null)
returns void language plpgsql security definer set search_path = public as $$
declare uid uuid;
begin
  if not public.is_manager() then raise exception 'เฉพาะหัวหน้า/ผู้ดูแลเท่านั้น'; end if;
  if p_role = 'owner' and public.my_role() <> 'owner' then raise exception 'ตั้ง Owner ได้เฉพาะ Owner'; end if;
  select id into uid from auth.users where lower(email) = lower(trim(p_email));
  if uid is null then raise exception 'ไม่พบบัญชีนี้ ให้ผู้ใช้สมัครด้วยอีเมลนี้ก่อน'; end if;
  insert into profiles (id, hospital_id, role, full_name) values (uid, public.my_hospital(), p_role, coalesce(p_full_name,''))
  on conflict (id) do update set hospital_id = public.my_hospital(), role = p_role, active = true,
    full_name = coalesce(nullif(p_full_name,''), profiles.full_name);
end $$;
revoke execute on function public.assign_staff(text, public.app_role, text) from public, anon;
grant execute on function public.assign_staff(text, public.app_role, text) to authenticated;

create or replace function public.job_transition(p_job_id uuid, p_status public.job_status, p_note text default null,
  p_technician_id uuid default null, p_priority_id uuid default null, p_job_type_id uuid default null,
  p_hold_reason text default null, p_hold_until date default null, p_summary text default null, p_uses_parts boolean default null)
returns void language plpgsql security definer set search_path = public as $$
declare j jobs; r app_role := public.my_role();
begin
  select * into j from jobs where id = p_job_id and hospital_id = public.my_hospital() for update;
  if j.id is null then raise exception 'ไม่พบใบงาน'; end if;
  if r is null or r = 'observer' then raise exception 'บัญชีนี้ไม่มีสิทธิ์แก้ไขใบงาน'; end if;
  if p_status in ('close','cancel','evaluated') and not public.is_manager() then raise exception 'ปิดงาน/ยกเลิกได้เฉพาะหัวหน้า'; end if;
  if p_status = 'assign' and p_technician_id is null then raise exception 'เลือกช่างผู้รับงาน'; end if;
  if p_status = 'on_hold' and (coalesce(p_hold_reason,'') = '' or p_hold_until is null) then raise exception 'ใส่เหตุผลและวันนัด'; end if;
  if p_status = 'clear' and coalesce(p_summary,'') = '' then raise exception 'ใส่สรุปการซ่อม'; end if;
  update jobs set
    status = p_status,
    technician_id = coalesce(p_technician_id, technician_id),
    priority_id = coalesce(p_priority_id, priority_id),
    job_type_id = coalesce(p_job_type_id, job_type_id),
    hold_reason = case when p_status = 'on_hold' then p_hold_reason else hold_reason end,
    hold_until = case when p_status = 'on_hold' then p_hold_until else hold_until end,
    summary = coalesce(p_summary, summary),
    uses_parts = coalesce(p_uses_parts, uses_parts),
    assigned_at = case when p_status = 'assign' then now() else assigned_at end,
    started_at = case when p_status = 'work_on' and started_at is null then now() else started_at end,
    cleared_at = case when p_status = 'clear' then now() else cleared_at end,
    evaluated_at = case when p_status = 'evaluated' then now() else evaluated_at end,
    closed_at = case when p_status in ('close','cancel') then now() else closed_at end
  where id = j.id;
  insert into job_events (job_id, status, note, actor_id) values (j.id, p_status, p_note, auth.uid());
end $$;
revoke execute on function public.job_transition(uuid, public.job_status, text, uuid, uuid, uuid, text, date, text, boolean) from public, anon;
grant execute on function public.job_transition(uuid, public.job_status, text, uuid, uuid, uuid, text, date, text, boolean) to authenticated;

-- additive only: existing policies are kept; the app writes job changes through job_transition()
