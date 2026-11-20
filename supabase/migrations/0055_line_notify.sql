-- 0055 LINE alerts: new repair jobs and SLA-overdue jobs are pushed to LINE groups (LINE Messaging API).
-- Additive only: new tables, new functions, new triggers, one new cron job. Nothing existing is changed.
--
-- How it works
--   1. The Owner creates a LINE Official Account, turns on Messaging API and sets two secrets in Supabase:
--      LINE_CHANNEL_ACCESS_TOKEN and LINE_CHANNEL_SECRET. Webhook URL = .../functions/v1/line-webhook
--   2. The bot is invited into a LINE group. The webhook records the group here (line_groups), not yet sending.
--   3. In staff.html > ตั้งค่า > แจ้งเตือน LINE a head picks which hospital the group is for (or "ทุกโรง" for executives)
--      and which alerts it gets: new job, late response (5/15/45 min), over SLA.
--   4. New job (trigger) and the 5-minute scan (cron) queue messages in line_outbox; edge function line-send pushes them.
--      Messages waiting for the same group are joined into one push to save the LINE monthly message quota.
-- Only jobs that become late AFTER this goes live are alerted (old backlog is not flooded into the group).

create table if not exists public.line_groups (
  id uuid primary key default gen_random_uuid(),
  line_id text not null unique,                      -- LINE groupId / roomId / userId (from the webhook)
  kind text not null default 'group' check (kind in ('group', 'room', 'user')),
  name text,                                         -- group name / person's LINE name
  hospital_id uuid references public.hospitals(id) on delete set null,
  all_hospitals boolean not null default false,      -- Owner / executive group: alerts of all 12 hospitals
  notify_new boolean not null default true,
  notify_resp boolean not null default true,
  notify_sla boolean not null default true,
  active boolean not null default false,             -- sends only after a head has set it up
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  set_by uuid references public.profiles(id),
  set_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.line_groups enable row level security;
revoke all on public.line_groups from anon;
grant select on public.line_groups to authenticated;
do $p$ begin
  if not exists (select 1 from pg_policies where tablename = 'line_groups' and policyname = 'line groups read') then
    create policy "line groups read" on public.line_groups for select to authenticated
      using (public.am_exec() or hospital_id in (select m.id from public.my_hospitals() m)
             or (hospital_id is null and not all_hospitals and public.is_manager())); end if;
end $p$;

create table if not exists public.line_outbox (
  id bigint generated always as identity primary key,
  hospital_id uuid references public.hospitals(id) on delete cascade,
  job_id uuid references public.jobs(id) on delete cascade,
  kind text not null check (kind in ('new', 'resp', 'sla', 'test')),
  to_line text,                                      -- only for 'test': the one group to send to
  body text not null,
  sent_to text[] not null default '{}',
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed')),
  attempts int not null default 0,
  error text,
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  sent_at timestamptz
);
create index if not exists line_outbox_pending_idx on public.line_outbox (status, id) where status in ('pending', 'sending');
alter table public.line_outbox enable row level security;
revoke all on public.line_outbox from anon;
grant select on public.line_outbox to authenticated;
do $p$ begin
  if not exists (select 1 from pg_policies where tablename = 'line_outbox' and policyname = 'line outbox read') then
    create policy "line outbox read" on public.line_outbox for select to authenticated
      using (public.am_exec() or (public.is_manager() and hospital_id in (select m.id from public.my_hospitals() m))); end if;
end $p$;

-- one alert per job per kind (late response / over SLA)
create table if not exists public.line_alerted (
  job_id uuid not null references public.jobs(id) on delete cascade,
  kind text not null check (kind in ('resp', 'sla')),
  at timestamptz not null default now(),
  primary key (job_id, kind)
);
alter table public.line_alerted enable row level security;
revoke all on public.line_alerted from anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.line_th_time(t timestamptz) returns text
language sql immutable set search_path = public as $$
  select to_char(t at time zone 'Asia/Bangkok', 'DD/MM/') || (extract(year from t at time zone 'Asia/Bangkok')::int + 543)
         || to_char(t at time zone 'Asia/Bangkok', ' HH24:MI') || ' น.'
$$;

create or replace function public.line_dur(m int) returns text
language sql immutable as $$
  select case when m < 60 then m || ' นาที'
              when m < 1440 then (m / 60) || ' ชั่วโมง' || case when m % 60 > 0 then ' ' || (m % 60) || ' นาที' else '' end
              else (m / 1440) || ' วัน' || case when (m % 1440) / 60 > 0 then ' ' || ((m % 1440) / 60) || ' ชั่วโมง' else '' end end
$$;

-- full text of one job for a LINE message (nothing is cut)
create or replace function public.line_job_text(j public.jobs) returns text
language sql stable security definer set search_path = public as $$
  select 'เลขที่ ' || j.job_no || chr(10) ||
    'ตำแหน่ง: ' || coalesce(nullif(concat_ws(' · ', nullif(j.building, ''), nullif(j.floor, ''), nullif(j.department, '')), ''), '-') || chr(10) ||
    coalesce('เครื่อง/อุปกรณ์: ' || nullif(j.equipment_text, '') || chr(10), '') ||
    'ประเภทงาน: ' || coalesce((select t.code || ' ' || t.name from job_types t where t.id = j.job_type_id), 'ยังไม่ระบุ') || chr(10) ||
    'ความเร่งด่วน: ' || coalesce((select p.name || coalesce(' (ตอบรับภายใน ' || p.respond_minutes || ' นาที)', '') from priorities p where p.id = j.priority_id), 'ยังไม่ระบุ') || chr(10) ||
    'อาการ: ' || coalesce(j.detail, '-') || chr(10) ||
    'ผู้แจ้ง: ' || coalesce(j.reporter_name, '-') || chr(10) ||
    'เวลาแจ้ง: ' || line_th_time(j.created_at)
$$;
revoke execute on function public.line_job_text(public.jobs) from public, anon, authenticated;

-- is there any group that should get this kind of alert for this hospital?
create or replace function public.line_has_target(p_hospital uuid, p_kind text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from line_groups g where g.active and g.left_at is null
    and (g.hospital_id = p_hospital or g.all_hospitals)
    and case p_kind when 'new' then g.notify_new when 'resp' then g.notify_resp when 'sla' then g.notify_sla else false end)
$$;
revoke execute on function public.line_has_target(uuid, text) from public, anon, authenticated;

-- new job -> queue at once
create or replace function public.line_new_job() returns trigger
language plpgsql security definer set search_path = public as $$
declare h hospitals;
begin
  begin   -- never block saving the job itself
    if public.line_has_target(new.hospital_id, 'new') then
      select * into h from hospitals where id = new.hospital_id;
      insert into line_outbox (hospital_id, job_id, kind, body)
      values (new.hospital_id, new.id, 'new', '🔧 งานแจ้งซ่อมใหม่ · ' || h.code || ' ' || h.name || chr(10) || line_job_text(new));
    end if;
  exception when others then null;
  end;
  return null;
end $$;
revoke execute on function public.line_new_job() from public, anon, authenticated;
do $t$ begin
  if not exists (select 1 from pg_trigger where tgname = 'line_new_job' and tgrelid = 'public.jobs'::regclass) then
    create trigger line_new_job after insert on public.jobs for each row execute function public.line_new_job(); end if;
end $t$;

-- every 5 minutes: jobs that just became late. One message per hospital per kind (saves quota).
--   resp = no technician has accepted yet and the response time of the urgency level (5/15/45 min) has passed
--   sla  = job still open and working minutes (hold time excluded, same as the staff page) are over the SLA of the urgency level
-- Only jobs that crossed the line within the last 24 hours are sent, so the old backlog is not flooded at go-live.
create or replace function public.line_sla_scan() returns int
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0; nl text := chr(10);
begin
  for r in
    with c as (
      select j.*, p.name pname, p.respond_minutes rm, coalesce(p.sla_minutes, 1440) sm, public.job_work_minutes(j) wm,
             round(extract(epoch from (now() - j.created_at)) / 60)::int age
      from jobs j left join priorities p on p.id = j.priority_id
      where j.status in ('register', 'assign', 'work_on', 'on_hold') and j.created_at > now() - interval '120 days'),
    late as (
      select 'resp'::text kind, c.* from c
        where c.rm is not null and c.status in ('register', 'assign') and c.accepted_at is null
          and c.age > c.rm and c.age - c.rm < 1440
      union all
      select 'sla', c.* from c where c.wm > c.sm and c.wm - c.sm < 1440),
    fresh as (
      select l.* from late l where not exists (select 1 from line_alerted a where a.job_id = l.id and a.kind = l.kind)
        and public.line_has_target(l.hospital_id, l.kind))
    select f.hospital_id, f.kind, array_agg(f.id order by f.created_at) ids,
      string_agg(case f.kind
          when 'resp' then '• ' || f.job_no || ' แจ้งมาแล้ว ' || line_dur(f.age) || ' (ต้องรับงานภายใน ' || f.rm || ' นาที · ' || f.pname || ')' || nl
                           || '  ตำแหน่ง: ' || coalesce(nullif(concat_ws(' · ', nullif(f.building, ''), nullif(f.floor, ''), nullif(f.department, '')), ''), '-') || nl
                           || '  อาการ: ' || coalesce(f.detail, '-')
          else '• ' || f.job_no || ' ใช้เวลาแล้ว ' || line_dur(f.wm) || ' เกิน SLA ' || line_dur(f.sm) || coalesce(' (' || f.pname || ')', '') || nl
               || '  สถานะ: ' || job_status_th(f.status) || coalesce(' · ช่าง: ' || (select full_name from profiles where id = f.technician_id), '') || nl
               || '  ตำแหน่ง: ' || coalesce(nullif(concat_ws(' · ', nullif(f.building, ''), nullif(f.floor, ''), nullif(f.department, '')), ''), '-') || nl
               || '  อาการ: ' || coalesce(f.detail, '-') end, nl order by f.created_at) txt
    from fresh f group by f.hospital_id, f.kind
  loop
    insert into line_alerted (job_id, kind) select unnest(r.ids), r.kind on conflict do nothing;
    insert into line_outbox (hospital_id, kind, body)
    select r.hospital_id, r.kind,
      case r.kind when 'resp' then '⏰ ยังไม่มีช่างรับงาน เกินเวลาตอบรับ · ' else '🔴 งานเกิน SLA · ' end
      || h.code || ' ' || h.name || ' (' || array_length(r.ids, 1) || ' ใบ)' || nl || r.txt || nl
      || 'ดูงาน: https://drnirunv-art.github.io/repair-system/staff.html'
    from hospitals h where h.id = r.hospital_id;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.line_sla_scan() from public, anon, authenticated;

-- sender claims rows with the groups each row must still go to
create or replace function public.line_claim(p_limit int default 50)
returns table (id bigint, kind text, body text, targets text[])
language sql security definer set search_path = public as $$
  with c as (
    update line_outbox o set status = 'sending', claimed_at = now(), attempts = o.attempts + 1
    where o.id in (select x.id from line_outbox x
                   where (x.status = 'pending' or (x.status = 'sending' and x.claimed_at < now() - interval '10 minutes'))
                     and x.attempts < 5 order by x.id limit p_limit for update skip locked)
    returning o.*)
  select c.id, c.kind, c.body,
    coalesce(case when c.kind = 'test' then array[c.to_line]
      else (select array_agg(g.line_id) from line_groups g where g.active and g.left_at is null
              and (g.hospital_id = c.hospital_id or g.all_hospitals)
              and case c.kind when 'new' then g.notify_new when 'resp' then g.notify_resp when 'sla' then g.notify_sla else false end
              and not g.line_id = any(c.sent_to)) end, '{}')
  from c order by c.id
$$;
revoke execute on function public.line_claim(int) from public, anon, authenticated;
grant execute on function public.line_claim(int) to service_role;

create or replace function public.kick_line_send() returns void
language sql security definer set search_path = public, extensions as $$
  select net.http_post(url := 'https://ufyhxubzpoqjkvrejxek.supabase.co/functions/v1/line-send',
                       body := '{}'::jsonb, headers := '{"Content-Type":"application/json"}'::jsonb, timeout_milliseconds := 20000);
$$;
revoke execute on function public.kick_line_send() from public, anon, authenticated;
create or replace function public.line_outbox_kick() returns trigger
language plpgsql security definer set search_path = public as $$
begin begin perform kick_line_send(); exception when others then null; end; return null; end $$;
revoke execute on function public.line_outbox_kick() from public, anon, authenticated;
do $t$ begin
  if not exists (select 1 from pg_trigger where tgname = 'line_outbox_kick' and tgrelid = 'public.line_outbox'::regclass) then
    create trigger line_outbox_kick after insert on public.line_outbox for each statement execute function public.line_outbox_kick(); end if;
end $t$;

create or replace function public.line_tick() returns void
language plpgsql security definer set search_path = public as $$
begin
  perform line_sla_scan();
  if exists (select 1 from line_outbox where status in ('pending', 'sending') and attempts < 5) then perform kick_line_send(); end if;
end $$;
revoke execute on function public.line_tick() from public, anon, authenticated;
do $c$ begin
  if not exists (select 1 from cron.job where jobname = 'line-tick') then
    perform cron.schedule('line-tick', '*/5 * * * *', 'select public.line_tick()'); end if;
end $c$;

-- ---------------------------------------------------------------------------------------------------------------
-- settings page: heads set up a group for their hospital; only executives can make it an "all hospitals" group
create or replace function public.line_group_set(p_id uuid, p_hospital uuid, p_all boolean, p_new boolean, p_resp boolean, p_sla boolean, p_active boolean)
returns void language plpgsql security definer set search_path = public as $$
declare g line_groups;
begin
  select * into g from line_groups where id = p_id;
  if g.id is null then raise exception 'ไม่พบกลุ่ม LINE นี้'; end if;
  if not coalesce(public.am_exec(), false) then
    if not coalesce(public.is_manager(), false) then raise exception 'เฉพาะหัวหน้า (Owner / Admin / Chief Engineer) ตั้งค่า LINE ได้'; end if;
    if coalesce(p_all, false) or g.all_hospitals then raise exception 'กลุ่ม "ทุกโรง" ตั้งได้เฉพาะผู้บริหาร'; end if;
    if p_hospital is null or p_hospital not in (select m.id from public.my_hospitals() m) then raise exception 'เลือกได้เฉพาะโรงพยาบาลของท่าน'; end if;
    if g.hospital_id is not null and g.hospital_id not in (select m.id from public.my_hospitals() m) then raise exception 'กลุ่มนี้เป็นของโรงพยาบาลอื่น'; end if;
  end if;
  update line_groups set hospital_id = case when coalesce(p_all, false) then null else p_hospital end, all_hospitals = coalesce(p_all, false),
    notify_new = coalesce(p_new, true), notify_resp = coalesce(p_resp, true), notify_sla = coalesce(p_sla, true),
    active = coalesce(p_active, false) and (coalesce(p_all, false) or p_hospital is not null),
    set_by = auth.uid(), set_at = now()
  where id = p_id;
end $$;
revoke execute on function public.line_group_set(uuid, uuid, boolean, boolean, boolean, boolean, boolean) from public, anon;
grant execute on function public.line_group_set(uuid, uuid, boolean, boolean, boolean, boolean, boolean) to authenticated;

create or replace function public.line_test(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare g line_groups; who text;
begin
  select * into g from line_groups where id = p_id;
  if g.id is null then raise exception 'ไม่พบกลุ่ม LINE นี้'; end if;
  if not (coalesce(public.am_exec(), false) or (coalesce(public.is_manager(), false) and not g.all_hospitals
          and (g.hospital_id is null or g.hospital_id in (select m.id from public.my_hospitals() m)))) then
    raise exception 'ไม่มีสิทธิ์ทดสอบกลุ่มนี้'; end if;
  if g.left_at is not null then raise exception 'บอทออกจากกลุ่มนี้แล้ว เชิญบอทเข้ากลุ่มใหม่ก่อน'; end if;
  select full_name into who from profiles where id = auth.uid();
  insert into line_outbox (hospital_id, kind, to_line, body)
  values (g.hospital_id, 'test', g.line_id, '✅ ทดสอบการแจ้งเตือนจากระบบ FM และวิศวกรรมอาคาร' || chr(10) || 'กลุ่มนี้: ' || coalesce(g.name, '-') || chr(10)
    || 'รับแจ้งเตือนของ: ' || case when g.all_hospitals then 'ทุกโรงพยาบาล' else coalesce((select code || ' ' || name from hospitals where id = g.hospital_id), 'ยังไม่ได้เลือกโรงพยาบาล') end || chr(10)
    || 'ผู้กดทดสอบ: ' || coalesce(who, '-') || chr(10) || 'เวลา: ' || line_th_time(now()));
end $$;
revoke execute on function public.line_test(uuid) from public, anon;
grant execute on function public.line_test(uuid) to authenticated;
