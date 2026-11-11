-- Phase A (additive only): accept step, multi-technician, due time, on-hold reasons with approval,
-- SLA pause during hold, before/after photos, job edit with history, appointments, reporter rating,
-- per-hospital settings, masked public tracking. Existing functions (submit_job, job_transition) are kept.

-- per-hospital settings ------------------------------------------------------
create table public.hospital_settings (
  hospital_id uuid primary key references public.hospitals(id) on delete cascade,
  require_photo boolean not null default false,
  max_photos int not null default 6 check (max_photos between 1 and 10),
  alert_unassigned_min int not null default 5,
  alert_not_started_min int not null default 10,
  appointment_grace_min int not null default 120,
  hold_needs_approval boolean not null default true,
  updated_at timestamptz not null default now()
);
insert into public.hospital_settings (hospital_id) select id from public.hospitals on conflict do nothing;
alter table public.hospital_settings enable row level security;
create policy "settings readable" on public.hospital_settings for select using (true);
create policy "settings managed" on public.hospital_settings for update to authenticated
  using (hospital_id = public.my_hospital() and public.is_manager()) with check (hospital_id = public.my_hospital() and public.is_manager());
grant select on public.hospital_settings to anon, authenticated;
grant update on public.hospital_settings to authenticated;

-- on-hold reasons (pick list) -------------------------------------------------
create table public.hold_reasons (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null references public.hospitals(id) on delete cascade,
  name text not null,
  sort int not null default 0,
  active boolean not null default true,
  unique (hospital_id, name)
);
insert into public.hold_reasons (hospital_id, name, sort)
select h.id, r.name, r.sort from public.hospitals h,
  (values ('รออะไหล่',1),('รอผู้รับเหมา / ช่างภายนอก',2),('รอหน่วยงานเปิดพื้นที่',3),('รอจัดซื้อ / อนุมัติงบ',4),
          ('รอผู้แจ้งยืนยันเวลา',5),('รอผลตรวจ / ผู้เชี่ยวชาญ',6),('อื่นๆ',9)) as r(name, sort)
on conflict do nothing;
alter table public.hold_reasons enable row level security;
create policy "hold reasons readable" on public.hold_reasons for select using (true);
create policy "hold reasons managed" on public.hold_reasons for all to authenticated
  using (hospital_id = public.my_hospital() and public.is_manager()) with check (hospital_id = public.my_hospital() and public.is_manager());
grant select on public.hold_reasons to anon, authenticated;
grant insert, update on public.hold_reasons to authenticated;

-- new job columns ------------------------------------------------------------------
alter table public.jobs
  add column if not exists accepted_at timestamptz,
  add column if not exists due_minutes int,
  add column if not exists hold_category text,
  add column if not exists hold_started_at timestamptz,
  add column if not exists hold_minutes int not null default 0,
  add column if not exists hold_status text check (hold_status in ('pending','ack','ack_memo','rejected')),
  add column if not exists hold_decided_by uuid references public.profiles(id),
  add column if not exists hold_decided_at timestamptz,
  add column if not exists memo_requested boolean not null default false,
  add column if not exists before_photo_paths text[] not null default '{}',
  add column if not exists appointment_at timestamptz,
  add column if not exists rating smallint check (rating between 1 and 5),
  add column if not exists rating_comment text,
  add column if not exists rated_at timestamptz,
  add column if not exists edited_at timestamptz;

-- several technicians per job (technician_id stays the lead) -------------------------
create table public.job_assignees (
  job_id uuid not null references public.jobs(id) on delete cascade,
  profile_id uuid not null references public.profiles(id),
  is_lead boolean not null default false,
  active boolean not null default true,
  assigned_at timestamptz not null default now(),
  primary key (job_id, profile_id)
);
create index job_assignees_profile_idx on public.job_assignees (profile_id);
alter table public.job_assignees enable row level security;
create policy "assignees staff read" on public.job_assignees for select to authenticated
  using (exists (select 1 from public.jobs j where j.id = job_id and j.hospital_id = public.my_hospital()));
grant select on public.job_assignees to authenticated;
insert into public.job_assignees (job_id, profile_id, is_lead, assigned_at)
select id, technician_id, true, coalesce(assigned_at, created_at) from public.jobs where technician_id is not null on conflict do nothing;

-- working minutes used for SLA/due (hold time excluded) -----------------------------
create or replace function public.job_work_minutes(j public.jobs, p_until timestamptz default null) returns int
language sql stable set search_path = public as $$
  select greatest(0, round(extract(epoch from (coalesce(p_until, j.cleared_at, j.closed_at, now()) - j.created_at)) / 60)::int
    - j.hold_minutes
    - case when j.status = 'on_hold' and j.hold_started_at is not null and p_until is null and j.cleared_at is null
           then round(extract(epoch from (now() - j.hold_started_at)) / 60)::int else 0 end)
$$;

-- one entry point for all phase-A job actions ---------------------------------------
-- actions: accept, start, hold, hold_decide, resume, clear, reassign, edit, appoint
create or replace function public.job_action(p_job_id uuid, p_action text, p_data jsonb default '{}')
returns void language plpgsql security definer set search_path = public as $$
declare
  j jobs; r app_role := public.my_role(); uid uuid := auth.uid(); s hospital_settings;
  v_note text := nullif(trim(coalesce(p_data->>'note','')), '');
  v_ids uuid[]; v_lead uuid; loc locations; v_paths text[]; v_held int := 0; v_status job_status; v_ev text;
  approver boolean := public.my_role() in ('owner','admin','chief_engineer');
begin
  select * into j from jobs where id = p_job_id and hospital_id = public.my_hospital() for update;
  if j.id is null then raise exception 'ไม่พบใบงาน'; end if;
  if r is null or r = 'observer' then raise exception 'บัญชีนี้ไม่มีสิทธิ์แก้ไขใบงาน'; end if;
  select * into s from hospital_settings where hospital_id = j.hospital_id;
  if p_data ? 'photos' then select coalesce(array_agg(x), '{}') into v_paths from jsonb_array_elements_text(p_data->'photos') x; end if;
  if j.status = 'on_hold' and j.hold_started_at is not null then
    v_held := round(extract(epoch from (now() - j.hold_started_at)) / 60)::int;
  end if;

  if p_action = 'accept' then
    if j.status <> 'assign' then raise exception 'รับงานได้เฉพาะใบงานที่มอบหมายแล้ว'; end if;
    update jobs set accepted_at = coalesce(accepted_at, now()) where id = j.id;
    v_status := 'assign'; v_ev := coalesce(v_note, 'รับงาน');

  elsif p_action = 'start' then
    if j.status not in ('assign','on_hold') then raise exception 'เริ่มงานได้เฉพาะงานที่มอบหมายแล้วหรือพักงาน'; end if;
    if j.status = 'on_hold' and j.hold_status = 'pending' and coalesce(s.hold_needs_approval, true) and not approver then
      raise exception 'งานนี้รอ Owner อนุมัติการพักงาน'; end if;
    update jobs set status = 'work_on', accepted_at = coalesce(accepted_at, now()),
      started_at = coalesce(started_at, now()),
      hold_minutes = hold_minutes + v_held, hold_started_at = null,
      before_photo_paths = before_photo_paths || coalesce(v_paths, '{}')
    where id = j.id;
    v_status := 'work_on'; v_ev := coalesce(v_note, case when j.status = 'on_hold' then 'กลับมาทำงานต่อ' else 'เริ่มงาน' end);

  elsif p_action = 'hold' then
    if j.status not in ('work_on','assign') then raise exception 'พักงานได้เฉพาะงานที่กำลังทำ'; end if;
    if coalesce(p_data->>'category','') = '' or v_note is null or coalesce(p_data->>'until','') = '' then
      raise exception 'เลือกเหตุผล เขียนหมายเหตุ และใส่วันนัดให้ครบ'; end if;
    update jobs set status = 'on_hold', hold_category = p_data->>'category', hold_reason = v_note,
      hold_until = (p_data->>'until')::date, hold_started_at = now(),
      hold_status = case when coalesce(s.hold_needs_approval, true) then 'pending' else 'ack' end,
      hold_decided_by = null, hold_decided_at = null
    where id = j.id;
    v_status := 'on_hold'; v_ev := (p_data->>'category') || ': ' || v_note;

  elsif p_action = 'hold_decide' then
    if not approver then raise exception 'อนุมัติพักงานได้เฉพาะ Owner / Admin / Chief Engineer'; end if;
    if j.status <> 'on_hold' then raise exception 'ใบงานนี้ไม่ได้พักงานอยู่'; end if;
    if coalesce(p_data->>'decision','') not in ('ack','ack_memo','rejected') then raise exception 'เลือกผลการพิจารณา'; end if;
    if p_data->>'decision' = 'rejected' then
      -- not approved: back to work, hold time is counted as working time
      update jobs set status = 'work_on', hold_status = 'rejected', hold_decided_by = uid, hold_decided_at = now(),
        hold_started_at = null where id = j.id;
      v_status := 'work_on'; v_ev := 'ไม่อนุมัติพักงาน' || coalesce(': ' || v_note, '');
    else
      update jobs set hold_status = p_data->>'decision', hold_decided_by = uid, hold_decided_at = now(),
        memo_requested = memo_requested or p_data->>'decision' = 'ack_memo' where id = j.id;
      v_status := 'on_hold';
      v_ev := case when p_data->>'decision' = 'ack_memo' then 'รับทราบ + ขอ Memo' else 'รับทราบการพักงาน' end || coalesce(': ' || v_note, '');
    end if;

  elsif p_action = 'clear' then
    if j.status <> 'work_on' then raise exception 'กดซ่อมเสร็จได้เฉพาะงานที่กำลังซ่อม'; end if;
    if v_note is null then raise exception 'ใส่สรุปการซ่อม'; end if;
    update jobs set status = 'clear', summary = v_note, uses_parts = coalesce((p_data->>'uses_parts')::boolean, false),
      close_photo_paths = close_photo_paths || coalesce(v_paths, '{}'), cleared_at = now()
    where id = j.id;
    v_status := 'clear'; v_ev := v_note;

  elsif p_action = 'reassign' then
    select coalesce(array_agg(x::uuid), '{}') into v_ids from jsonb_array_elements_text(coalesce(p_data->'technicians','[]')) x;
    if cardinality(v_ids) = 0 then raise exception 'เลือกช่างอย่างน้อย 1 คน'; end if;
    if exists (select 1 from unnest(v_ids) i left join profiles p on p.id = i
               where p.id is null or p.hospital_id <> j.hospital_id or not p.active or p.role = 'observer') then
      raise exception 'มีช่างที่เลือกไม่ได้'; end if;
    if j.status not in ('register','assign','work_on','on_hold') then raise exception 'ใบงานนี้มอบหมายใหม่ไม่ได้'; end if;
    v_lead := v_ids[1];
    update job_assignees set active = false, is_lead = false where job_id = j.id and profile_id <> all(v_ids);
    insert into job_assignees (job_id, profile_id, is_lead) select j.id, i, i = v_lead from unnest(v_ids) i
      on conflict (job_id, profile_id) do update set is_lead = excluded.is_lead, active = true;
    update jobs set technician_id = v_lead,
      status = case when status = 'register' then 'assign' else status end,
      assigned_at = case when status = 'register' or technician_id is distinct from v_lead then now() else assigned_at end,
      accepted_at = case when technician_id is distinct from v_lead then null else accepted_at end,
      priority_id = coalesce(nullif(p_data->>'priority_id','')::uuid, priority_id),
      job_type_id = case when p_data ? 'job_type_id' then nullif(p_data->>'job_type_id','')::uuid else job_type_id end,
      due_minutes = case when p_data ? 'due_minutes' then nullif(p_data->>'due_minutes','')::int else due_minutes end
    where id = j.id returning status into v_status;
    v_ev := 'มอบหมาย ' || (select string_agg(coalesce(nullif(full_name,''),'(ไม่มีชื่อ)'), ', ' order by array_position(v_ids, id)) from profiles where id = any(v_ids))
      || coalesce(' · ' || v_note, '');

  elsif p_action = 'edit' then
    if not public.is_manager() then raise exception 'แก้ไขใบงานได้เฉพาะหัวหน้า'; end if;
    if nullif(p_data->>'location_id','') is not null then
      select * into loc from locations where id = (p_data->>'location_id')::uuid and hospital_id = j.hospital_id;
      if loc.id is null then raise exception 'ไม่พบตำแหน่งที่เลือก'; end if;
    end if;
    update jobs set
      detail = coalesce(nullif(trim(p_data->>'detail'),''), detail),
      reporter_name = coalesce(nullif(trim(p_data->>'reporter_name'),''), reporter_name),
      reporter_phone = coalesce(nullif(trim(p_data->>'reporter_phone'),''), reporter_phone),
      equipment_text = case when p_data ? 'equipment_text' then nullif(trim(p_data->>'equipment_text'),'') else equipment_text end,
      location_id = coalesce(loc.id, location_id), building = coalesce(loc.building, building),
      floor = coalesce(loc.floor, floor), department = coalesce(loc.department, department),
      edited_at = now()
    where id = j.id;
    v_status := j.status; v_ev := 'แก้ไขใบงาน' || coalesce(': ' || v_note, '');

  elsif p_action = 'appoint' then
    update jobs set appointment_at = nullif(p_data->>'at','')::timestamptz where id = j.id;
    v_status := j.status; v_ev := coalesce('นัดเข้าทำงาน ' || to_char((nullif(p_data->>'at','')::timestamptz) at time zone 'Asia/Bangkok', 'DD/MM HH24:MI'), 'ยกเลิกนัด') || coalesce(' · ' || v_note, '');

  else raise exception 'ไม่รู้จักคำสั่ง %', p_action;
  end if;

  insert into job_events (job_id, status, note, actor_id) values (j.id, v_status, v_ev, uid);
end $$;
revoke execute on function public.job_action(uuid, text, jsonb) from public, anon;
grant execute on function public.job_action(uuid, text, jsonb) to authenticated;

-- keep job_assignees and hold clock in step when the older job_transition() is used ----
create or replace function public.jobs_sync_phase_a() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.technician_id is not null and new.technician_id is distinct from old.technician_id then
    insert into job_assignees (job_id, profile_id, is_lead) values (new.id, new.technician_id, true)
      on conflict (job_id, profile_id) do update set is_lead = true, active = true;
    update job_assignees set is_lead = false where job_id = new.id and profile_id <> new.technician_id;
  end if;
  if new.status = 'on_hold' and old.status <> 'on_hold' and new.hold_started_at is null then new.hold_started_at := now(); end if;
  if old.status = 'on_hold' and new.status <> 'on_hold' and old.hold_started_at is not null and new.hold_started_at is not null
     and coalesce(new.hold_status, '') <> 'rejected' then
    new.hold_minutes := new.hold_minutes + round(extract(epoch from (now() - old.hold_started_at)) / 60)::int;
    new.hold_started_at := null;
  end if;
  return new;
end $$;
revoke execute on function public.jobs_sync_phase_a() from public, anon, authenticated;
create trigger jobs_sync_phase_a before update on public.jobs for each row execute function public.jobs_sync_phase_a();

-- public tracking v2: masked name/phone, photos, rating ------------------------------------
create or replace function public.track_jobs_v2(p_hospital_code text, p_query text)
returns table (job_no text, created_at timestamptz, building text, floor text, department text, detail text,
  status public.job_status, technician text, hold_category text, hold_reason text, hold_until date,
  appointment_at timestamptz, cleared_at timestamptz, closed_at timestamptz, summary text,
  reporter_masked text, phone_masked text, photo_paths text[], before_photo_paths text[], after_photo_paths text[],
  rating smallint, can_rate boolean)
language sql stable security definer set search_path = public as $$
  select j.job_no, j.created_at, j.building, j.floor, j.department, j.detail, j.status,
         p.full_name, j.hold_category, j.hold_reason, j.hold_until, j.appointment_at, j.cleared_at, j.closed_at,
         case when j.status in ('clear','evaluated','close') then j.summary end,
         left(j.reporter_name, 2) || repeat('*', greatest(length(j.reporter_name) - 2, 1)),
         case when length(j.reporter_phone) > 4 then repeat('*', length(j.reporter_phone) - 4) || right(j.reporter_phone, 4) else '****' end,
         j.photo_paths, j.before_photo_paths, j.close_photo_paths, j.rating,
         (j.status in ('clear','evaluated','close') and j.rating is null)
  from jobs j join hospitals h on h.id = j.hospital_id
  left join profiles p on p.id = j.technician_id
  where h.code = p_hospital_code and length(trim(p_query)) >= 3
    and (j.job_no ilike '%' || trim(p_query) || '%' or j.reporter_phone = trim(p_query)
         or j.reporter_name ilike '%' || trim(p_query) || '%')
  order by j.created_at desc limit 30
$$;
grant execute on function public.track_jobs_v2(text, text) to anon, authenticated;

-- reporter rates a finished job (needs the job number and the phone used to report) --------
create or replace function public.rate_job(p_job_no text, p_phone text, p_score int, p_comment text default null)
returns void language plpgsql security definer set search_path = public as $$
declare j jobs;
begin
  select * into j from jobs where job_no = trim(p_job_no) for update;
  if j.id is null then raise exception 'ไม่พบใบงาน'; end if;
  if regexp_replace(j.reporter_phone, '\D', '', 'g') <> regexp_replace(coalesce(p_phone,''), '\D', '', 'g') then
    raise exception 'เบอร์โทรไม่ตรงกับที่ใช้แจ้งซ่อม'; end if;
  if j.status not in ('clear','evaluated','close') then raise exception 'ประเมินได้เมื่อซ่อมเสร็จแล้ว'; end if;
  if j.rating is not null then raise exception 'ใบงานนี้ประเมินแล้ว'; end if;
  if p_score not between 1 and 5 then raise exception 'ให้คะแนน 1 ถึง 5'; end if;
  update jobs set rating = p_score, rating_comment = nullif(trim(coalesce(p_comment,'')), ''), rated_at = now() where id = j.id;
  insert into job_events (job_id, status, note) values (j.id, j.status, 'ผู้แจ้งประเมิน ' || p_score || '/5' || coalesce(': ' || nullif(trim(p_comment),''), ''));
end $$;
revoke execute on function public.rate_job(text, text, int, text) from public;
grant execute on function public.rate_job(text, text, int, text) to anon, authenticated;

-- photos/videos: bigger files and more types; reporters can view photos of their job by exact path --------
create or replace function public.photo_is_linked(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from jobs j where p_name = any(j.photo_paths || j.before_photo_paths || j.close_photo_paths))
$$;
grant execute on function public.photo_is_linked(text) to anon, authenticated;
create policy "public read photos linked to a job" on storage.objects for select to anon, authenticated
  using (bucket_id = 'job-photos' and public.photo_is_linked(name));
