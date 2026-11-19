-- SLA งานรอ (ไม่นับใน KPI): ทุกครั้งที่ใบงานเข้าสถานะพักงาน (รออะไหล่ รอผู้รับเหมา รอเข้าพื้นที่ ฯลฯ)
-- ต้องออก PR หรือ Memo ของใบงานนั้นถึงโรงพยาบาลภายใน 24 ชั่วโมงนับจากเวลาที่เข้าสถานะรอ (นับเป็นชั่วโมง ไม่ใช่ถึงเที่ยงคืน).
-- QS เข้าสัปดาห์ละครั้งเพื่อตรวจตัวเลขนี้คู่กับการตรวจคุณภาพงานซ่อม.
-- Read-only function only: no table, nothing changes, kpi_auto is not touched.
--
-- One row per waiting period: a job_events row with status on_hold whose previous event of the same job was not on_hold.
-- The period ends at the next event of another status. The first PR / Memo (not cancelled) of the job created at or after
-- the start stops the clock.
--   ok      = PR/Memo issued within 24 hours
--   late    = issued after 24 hours, or none and the 24 hours have passed while the job was still waiting
--   pending = none yet, still inside the 24 hours
--   no_need = the job left the waiting status within 24 hours without a PR/Memo (e.g. part found in stock)

create or replace function public.wait_sla(p_hospital uuid, p_from date, p_to date)
returns table (job_id uuid, job_no text, detail text, category text, started_at timestamptz, ended_at timestamptz,
               due_at timestamptz, doc_no text, doc_at timestamptz, result text, hours numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.am_exec() or p_hospital in (select m.id from public.my_hospitals() m)) then
    raise exception 'ไม่มีสิทธิ์ดูข้อมูลของโรงพยาบาลนี้'; end if;
  return query
  with ev as (
    select e.job_id, e.status, e.note, e.created_at,
           lag(e.status) over (partition by e.job_id order by e.created_at, e.id) prev
    from job_events e join jobs j on j.id = e.job_id
    where j.hospital_id = p_hospital and j.status <> 'cancel'),
  st as (   -- start of each waiting period
    select ev.job_id, ev.note, ev.created_at s from ev where ev.status = 'on_hold' and ev.prev is distinct from 'on_hold'
      and (ev.created_at at time zone 'Asia/Bangkok')::date between p_from and p_to),
  per as (
    select st.*, (select min(e2.created_at) from job_events e2 where e2.job_id = st.job_id and e2.created_at > st.s and e2.status <> 'on_hold') e
    from st),
  d as (
    select per.*, x.no, x.at from per
    left join lateral (
      select u.no, u.at from (
        select p.pr_no no, p.created_at at from purchase_requests p where p.job_id = per.job_id and p.status <> 'cancel' and p.created_at >= per.s
        union all
        select m.memo_no, m.created_at from memos m where m.job_id = per.job_id and m.status <> 'cancel' and m.created_at >= per.s) u
      order by u.at limit 1) x on true)
  select d.job_id, j.job_no, j.detail, nullif(split_part(coalesce(d.note, ''), ':', 1), ''), d.s, d.e, d.s + interval '24 hours', d.no, d.at,
    case when d.at is not null and d.at <= d.s + interval '24 hours' then 'ok'
         when d.at is not null then 'late'
         when d.e is not null and d.e <= d.s + interval '24 hours' then 'no_need'
         when now() <= d.s + interval '24 hours' then 'pending'
         else 'late' end,
    round(extract(epoch from (coalesce(d.at, case when d.e is not null and d.e <= d.s + interval '24 hours' then d.e end, now()) - d.s)) / 3600, 1)
  from d join jobs j on j.id = d.job_id
  order by d.s desc;
end $$;

revoke execute on function public.wait_sla(uuid, date, date) from public, anon;
grant execute on function public.wait_sla(uuid, date, date) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- Memo e-mail: when a Memo is issued, it is e-mailed right away to the hospital's engineering department manager
-- (ผู้จัดการฝ่ายวิศวกรรมโรงพยาบาล). Addresses are set per hospital in staff.html > ตั้งค่า (kept in the database only).
-- Rows with no hospital (hospital_id null) are the overall list set by the Owner / executives: they get the Memos of every hospital.
-- Uses the existing email_outbox + send-mail (Gmail) route, so no new key or service is needed.
create table if not exists public.memo_recipients (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid references public.hospitals(id) on delete cascade,   -- null = overall list (all hospitals)
  email text not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  name text,
  position text not null default 'ผู้จัดการฝ่ายวิศวกรรมโรงพยาบาล',
  active boolean not null default true,
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now()
);
create unique index if not exists memo_recipients_uq on public.memo_recipients (coalesce(hospital_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(email));
alter table public.memo_recipients enable row level security;
revoke all on public.memo_recipients from anon;
grant select, insert, update on public.memo_recipients to authenticated;
do $p$ begin
  if not exists (select 1 from pg_policies where tablename = 'memo_recipients' and policyname = 'memo rcpt read') then
    create policy "memo rcpt read" on public.memo_recipients for select to authenticated
      using (public.am_exec() or hospital_id in (select m.id from public.my_hospitals() m) or (hospital_id is null and public.is_manager())); end if;
  if not exists (select 1 from pg_policies where tablename = 'memo_recipients' and policyname = 'memo rcpt write') then
    create policy "memo rcpt write" on public.memo_recipients for insert to authenticated
      with check (public.am_exec() or (public.is_manager() and hospital_id in (select m.id from public.my_hospitals() m))); end if;
  if not exists (select 1 from pg_policies where tablename = 'memo_recipients' and policyname = 'memo rcpt update') then
    create policy "memo rcpt update" on public.memo_recipients for update to authenticated
      using (public.am_exec() or (public.is_manager() and hospital_id in (select m.id from public.my_hospitals() m)))
      with check (public.am_exec() or (public.is_manager() and hospital_id in (select m.id from public.my_hospitals() m))); end if;
end $p$;

create or replace function public.memo_mail() returns trigger
language plpgsql security definer set search_path = public as $$
declare h hospitals; j jobs; who text; pr text; nl text := chr(10);
begin
  begin   -- never block issuing the Memo itself
    select * into h from hospitals where id = new.hospital_id;
    if new.job_id is not null then select * into j from jobs where id = new.job_id; end if;
    if new.pr_id is not null then select pr_no into pr from purchase_requests where id = new.pr_id; end if;
    select full_name into who from profiles where id = new.created_by;
    insert into email_outbox (hospital_id, job_id, to_email, subject, body_text)
    select new.hospital_id, new.job_id, r.email, 'Memo ' || new.memo_no || ': ' || new.subject,
      case when r.hospital_id is null then 'สำเนาถึง ' || coalesce(nullif(r.name, '') || ' ', '') || r.position || ' (Memo ของ ' || coalesce(h.name, '') || ')'
           else 'เรียน ' || coalesce(nullif(r.name, '') || ' ', '') || r.position || ' ' || coalesce(h.name, '') end || nl || nl ||
      'เรื่อง: ' || new.subject || nl ||
      'เลขที่ Memo: ' || new.memo_no || nl ||
      'ถึง: ' || new.to_whom || nl ||
      case when j.id is not null then 'ใบงานแจ้งซ่อม: ' || j.job_no || coalesce(' (' || nullif(concat_ws(' ', j.building, j.floor, j.department), '') || ')', '') || ' อาการ: ' || coalesce(j.detail, '-') || nl else '' end ||
      case when pr is not null then 'อ้างอิงใบขอซื้อ: ' || pr || nl else '' end ||
      case when new.amount is not null then 'จำนวนเงิน: ' || to_char(new.amount, 'FM999,999,999,990.00') || ' บาท' || nl else '' end ||
      nl || new.body || nl || nl ||
      'ผู้ออก Memo: ' || coalesce(who, '-') || nl ||
      'เวลา: ' || to_char(new.created_at at time zone 'Asia/Bangkok', 'DD/MM/') || (extract(year from new.created_at at time zone 'Asia/Bangkok')::int + 543) || to_char(new.created_at at time zone 'Asia/Bangkok', ' HH24:MI') || ' น.' || nl || nl ||
      'ลิงก์พิมพ์ Memo (สำหรับเจ้าหน้าที่ที่มีบัญชีในระบบ): https://drnirunv-art.github.io/repair-system/doc.html?memo=' || new.id || nl ||
      '(อีเมลนี้ส่งอัตโนมัติจากระบบ FM และวิศวกรรมอาคาร)'
    from (select distinct on (lower(x.email)) x.* from memo_recipients x where x.active and (x.hospital_id = new.hospital_id or x.hospital_id is null)
          order by lower(x.email), (x.hospital_id is null)) r;
  exception when others then null;
  end;
  return null;
end $$;
revoke execute on function public.memo_mail() from public, anon, authenticated;
do $t$ begin
  if not exists (select 1 from pg_trigger where tgname = 'memo_mail' and tgrelid = 'public.memos'::regclass) then
    create trigger memo_mail after insert on public.memos for each row execute function public.memo_mail(); end if;
end $t$;
