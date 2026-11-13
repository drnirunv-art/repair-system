-- PM follow-up table per hospital (plan of the month against what was done) and its monthly e-mail on the 28th.
-- Contract duty: PM results go to the hospital every month, and the yearly master plan once before the year ends.
-- Recipients are set per hospital by that hospital's managers (people with the 12-hospital view can set any hospital).
create table if not exists public.report_recipients (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null references public.hospitals(id) on delete cascade,
  kind text not null default 'pm_followup' check (kind in ('pm_followup')),
  email text not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create unique index if not exists report_recipients_uq on public.report_recipients (hospital_id, kind, lower(email));
alter table public.report_recipients enable row level security;
revoke all on public.report_recipients from anon;
grant select, insert, update on public.report_recipients to authenticated;
create policy "recipients managers read" on public.report_recipients for select to authenticated
  using ((hospital_id = public.my_hospital() and public.is_manager()) or public.am_exec());
create policy "recipients managers add" on public.report_recipients for insert to authenticated
  with check ((hospital_id = public.my_hospital() and public.is_manager()) or public.am_exec());
create policy "recipients managers edit" on public.report_recipients for update to authenticated
  using ((hospital_id = public.my_hospital() and public.is_manager()) or public.am_exec())
  with check ((hospital_id = public.my_hospital() and public.is_manager()) or public.am_exec());

-- one hospital, one month: a row per system (last row grp = 'รวม'). planned = machines whose plan has that month.
create or replace function public.pm_followup_core(p_hospital uuid, p_year int, p_month int)
returns table (grp text, planned bigint, done bigint, waiting_sign bigint, not_done bigint, abnormal bigint, pct int, ytd_planned bigint, ytd_done bigint, ytd_pct int)
language sql stable security definer set search_path = public as $$
  with e as (select id, coalesce(nullif(trim(system), ''), nullif(trim(eq_type), ''), 'ไม่ระบุระบบ') g, pm_months from equipment
             where hospital_id = p_hospital and active and cardinality(pm_months) > 0),
  t as (select equipment_id, month, status, abnormal from pm_tasks where hospital_id = p_hospital and year = p_year and month <= p_month),
  a as (select e.g, grouping(e.g) tot,
      count(*) filter (where p_month = any(e.pm_months)) planned,
      count(*) filter (where p_month = any(e.pm_months) and exists (select 1 from t where t.equipment_id = e.id and t.month = p_month and t.status = 'approved')) done,
      count(*) filter (where p_month = any(e.pm_months) and exists (select 1 from t where t.equipment_id = e.id and t.month = p_month and t.status in ('submitted','head_signed'))) waiting,
      coalesce(sum((select count(*) from t where t.equipment_id = e.id and t.month = p_month and t.abnormal > 0)), 0)::bigint abn,
      coalesce(sum((select count(*) from unnest(e.pm_months) m where m <= p_month)), 0)::bigint yp,
      coalesce(sum((select count(*) from t where t.equipment_id = e.id and t.status = 'approved' and t.month = any(e.pm_months))), 0)::bigint yd
    from e group by rollup (e.g))
  select case when tot = 1 then 'รวม' else g end, planned, done, waiting, planned - done - waiting, abn,
    case when planned > 0 then round(100.0 * done / planned)::int end, yp, yd, case when yp > 0 then round(100.0 * yd / yp)::int end
  from a where tot = 1 or planned > 0 or yp > 0 order by tot, 1
$$;
revoke all on function public.pm_followup_core(uuid, int, int) from public, anon, authenticated;

-- staff see their own hospital
create or replace function public.pm_followup(p_year int, p_month int)
returns table (grp text, planned bigint, done bigint, waiting_sign bigint, not_done bigint, abnormal bigint, pct int, ytd_planned bigint, ytd_done bigint, ytd_pct int)
language plpgsql stable security definer set search_path = public as $$
begin
  if public.my_hospital() is null then raise exception 'ต้องเข้าสู่ระบบก่อน'; end if;
  return query select * from public.pm_followup_core(public.my_hospital(), p_year, p_month);
end $$;
-- people with the 12-hospital view see one total row per hospital
create or replace function public.pm_followup_all(p_year int, p_month int)
returns table (code text, name text, machines bigint, planned bigint, done bigint, waiting_sign bigint, not_done bigint, abnormal bigint, pct int, ytd_planned bigint, ytd_done bigint, ytd_pct int)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.am_exec() then raise exception 'เฉพาะผู้ที่มีสิทธิ์ดูภาพรวม 12 โรงพยาบาล'; end if;
  return query select h.code, h.name, (select count(*) from equipment e where e.hospital_id = h.id and e.active and cardinality(e.pm_months) > 0),
    c.planned, c.done, c.waiting_sign, c.not_done, c.abnormal, c.pct, c.ytd_planned, c.ytd_done, c.ytd_pct
  from hospitals h left join lateral (select * from public.pm_followup_core(h.id, p_year, p_month) x where x.grp = 'รวม') c on true
  where h.active order by h.code;
end $$;
revoke all on function public.pm_followup(int, int), public.pm_followup_all(int, int) from public, anon;
grant execute on function public.pm_followup(int, int), public.pm_followup_all(int, int) to authenticated;

-- the sender attaches an Excel file built from live data: {"kind":"pm_month","year":2026,"month":11} or {"kind":"pm_master_plan","year":2026}
alter table public.email_outbox add column if not exists attach jsonb;
grant execute on function public.pm_followup_core(uuid, int, int) to service_role;

-- queue the table as a plain-text e-mail to the hospital's recipients; returns how many mails were queued
create or replace function public.pm_followup_queue(p_hospital uuid, p_year int, p_month int, p_plan boolean default false) returns int
language plpgsql security definer set search_path = public as $$
declare h hospitals; body text; r record; n int := 0; n2 int := 0; tot record;
  mth text := (array['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'])[p_month] || ' ' || (p_year + 543);
begin
  select * into h from hospitals where id = p_hospital;
  if h.id is null or not exists (select 1 from report_recipients where hospital_id = p_hospital and kind = 'pm_followup' and active) then return 0; end if;
  select * into tot from pm_followup_core(p_hospital, p_year, p_month) where grp = 'รวม';
  body := 'ตารางติดตามแผน PM ประจำเดือน ' || mth || E'\n' || h.name || ' (' || h.code || E')\n\n' ||
    'สรุป: แผนเดือนนี้ ' || coalesce(tot.planned, 0) || ' เครื่อง ทำเสร็จและอนุมัติแล้ว ' || coalesce(tot.done, 0) || ' เครื่อง (' || coalesce(tot.pct::text || '%', '-') || ')' ||
    ' รอเซ็น ' || coalesce(tot.waiting_sign, 0) || ' ยังไม่ทำ ' || coalesce(tot.not_done, 0) || ' พบผิดปกติ ' || coalesce(tot.abnormal, 0) || E' ใบ\n' ||
    'สะสมตั้งแต่ต้นปี: ทำแล้ว ' || coalesce(tot.ytd_done, 0) || ' จากแผน ' || coalesce(tot.ytd_planned, 0) || ' ครั้ง (' || coalesce(tot.ytd_pct::text || '%', '-') || E')\n\n' ||
    E'แยกตามระบบ (แผน / เสร็จ / รอเซ็น / ยังไม่ทำ / % เสร็จ)\n';
  for r in select * from pm_followup_core(p_hospital, p_year, p_month) where grp <> 'รวม' and planned > 0 loop
    body := body || '- ' || r.grp || ': ' || r.planned || ' / ' || r.done || ' / ' || r.waiting_sign || ' / ' || r.not_done || ' / ' || coalesce(r.pct::text || '%', '-') || E'\n';
  end loop;
  if coalesce(tot.planned, 0) = 0 then body := body || E'(เดือนนี้ยังไม่มีเครื่องในแผน PM ของระบบ)\n'; end if;
  body := body || E'\nรายละเอียดรายเครื่องอยู่ในไฟล์ Excel ที่แนบมากับอีเมลนี้\n\n' ||
    h.name || E' งานวิศวกรรมอาคาร\n(อีเมลนี้ส่งอัตโนมัติทุกวันที่ 28 ของเดือน กรุณาอย่าตอบกลับ)';
  insert into email_outbox (hospital_id, to_email, subject, body_text, attach)
  select p_hospital, rr.email, 'ผลงาน PM ' || h.code || ' เดือน' || mth || ': เสร็จ ' || coalesce(tot.done, 0) || ' จาก ' || coalesce(tot.planned, 0) || ' เครื่อง', body,
    jsonb_build_object('kind', 'pm_month', 'year', p_year, 'month', p_month)
  from report_recipients rr where rr.hospital_id = p_hospital and rr.kind = 'pm_followup' and rr.active;
  get diagnostics n = row_count;
  -- once a year (the December run, or when asked): the master plan in the template layout
  if p_plan or p_month = 12 then
    insert into email_outbox (hospital_id, to_email, subject, body_text, attach)
    select p_hospital, rr.email, 'Master Plan PM ' || h.code || ' ปี ' || (p_year + 543),
      'Master Plan Preventive Maintenance ปี ' || (p_year + 543) || E'\n' || h.name || ' (' || h.code || E')\n\n' ||
      'แนบไฟล์ Excel แผน PM ทั้งปีรายเครื่อง (12 เดือน เดือนละ 4 สัปดาห์) ตามรูปแบบ Master Plan จำนวน ' ||
      (select count(*) from equipment e where e.hospital_id = p_hospital and e.active and e.tag is not null and cardinality(e.pm_months) > 0) || E' เครื่อง\n\n' ||
      h.name || E' งานวิศวกรรมอาคาร\n(อีเมลนี้ส่งอัตโนมัติปีละ 1 ครั้ง วันที่ 28 ธันวาคม กรุณาอย่าตอบกลับ)',
      jsonb_build_object('kind', 'pm_master_plan', 'year', p_year)
    from report_recipients rr where rr.hospital_id = p_hospital and rr.kind = 'pm_followup' and rr.active;
    get diagnostics n2 = row_count;
  end if;
  return n + n2;
end $$;
revoke all on function public.pm_followup_queue(uuid, int, int, boolean) from public, anon, authenticated;

-- the 28th job: every hospital that has recipients
create or replace function public.pm_followup_send_all() returns int
language plpgsql security definer set search_path = public as $$
declare d date := (now() at time zone 'Asia/Bangkok')::date; n int := 0; h record;
begin
  for h in select id from hospitals where active loop n := n + public.pm_followup_queue(h.id, extract(year from d)::int, extract(month from d)::int); end loop;
  return n;
end $$;
revoke all on function public.pm_followup_send_all() from public, anon, authenticated;
-- managers can send their own hospital's table now (to check the addresses)
create or replace function public.pm_followup_send_now(p_year int, p_month int, p_plan boolean default false) returns int
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_manager() then raise exception 'เฉพาะหัวหน้า / Admin ส่งอีเมลได้'; end if;
  if p_month not between 1 and 12 then raise exception 'เดือนไม่ถูกต้อง'; end if;
  return public.pm_followup_queue(public.my_hospital(), p_year, p_month, coalesce(p_plan, false));
end $$;
revoke all on function public.pm_followup_send_now(int, int, boolean) from public, anon;
grant execute on function public.pm_followup_send_now(int, int, boolean) to authenticated;

-- 08:00 Bangkok on the 28th of every month
select cron.schedule('pm-followup-28', '0 1 28 * *', $$select public.pm_followup_send_all()$$);
