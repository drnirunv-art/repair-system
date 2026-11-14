-- 0033 PM MA e-mails, as in the old PM MA system: contract renewal alert (Monday 08:00), weekly contractor PM summary
-- (Friday 16:00) and the monthly result on the 23rd (08:00, with an Excel file). Each hospital gets only its own data;
-- the 12-hospital recipients (hospital_id null) get the overview. Additive: one new table, new functions, three cron jobs.
-- email_outbox.hospital_id becomes optional so a 12-hospital mail needs no hospital.
alter table public.email_outbox alter column hospital_id drop not null;

create table if not exists public.ma_recipients (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid references public.hospitals(id) on delete cascade,   -- null = 12-hospital overview (executives)
  name text not null default '',
  position text not null default '',
  email text not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  renew boolean not null default true,      -- Monday renewal alert
  weekly boolean not null default true,     -- Friday summary
  monthly boolean not null default true,    -- 23rd monthly result
  active boolean not null default true,
  note text not null default '',
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
create unique index if not exists ma_recipients_uq on public.ma_recipients (coalesce(hospital_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(email));
alter table public.ma_recipients enable row level security;
revoke all on public.ma_recipients from anon;
grant select, insert, update, delete on public.ma_recipients to authenticated;
create policy "ma recipients read" on public.ma_recipients for select to authenticated
  using ((hospital_id = public.my_hospital() and public.is_manager()) or public.am_exec());
create policy "ma recipients add" on public.ma_recipients for insert to authenticated
  with check ((hospital_id = public.my_hospital() and public.is_manager()) or public.am_exec());
create policy "ma recipients edit" on public.ma_recipients for update to authenticated
  using ((hospital_id = public.my_hospital() and public.is_manager()) or public.am_exec())
  with check ((hospital_id = public.my_hospital() and public.is_manager()) or public.am_exec());
create policy "ma recipients delete" on public.ma_recipients for delete to authenticated
  using ((hospital_id = public.my_hospital() and public.is_manager()) or public.am_exec());

-- shortest PM interval in days of a cycle text such as "M", "2M,S", "Q,Y"
create or replace function public.ma_cycle_days(p text) returns int language sql immutable as $$
  select min(case t when 'W' then 7 when '2W' then 14 when 'M' then 31 when '2M' then 62 when 'Q' then 92 when '4M' then 123 when 'S' then 183 when 'Y' then 366 end)
  from unnest(regexp_split_to_array(upper(coalesce(p, '')), '[,\s/]+')) t
$$;

-- state of every contract of one hospital (null = all hospitals), the same rules as ma.html
create or replace function public.ma_state(p_hospital uuid)
returns table (contract_id uuid, hospital_id uuid, code text, hname text, grp text, sys text, scope text, vendor text, pm_cycle text,
  start_date date, end_date date, days_left int, status text, renew boolean, stage text, po_done boolean, steps text,
  last_visit date, overdue boolean, next_due date, up_date date, up_status text, visits_month int, visits_week int)
language sql stable security definer set search_path = public as $$
  with d as (select (now() at time zone 'Asia/Bangkok')::date t),
  c as (
    select c.*, h.code, h.name hname, d.t, (c.end_date - d.t) dl,
      (c.end_date is null and c.note ~ 'สถานะไซต์:\s*(หมดแล้ว|ไม่เคยมี)') site_exp,
      (c.cancelled or (c.scope || ' ' || c.note) ~ 'ยกเลิก') off,
      public.ma_cycle_days(c.pm_cycle) iv
    from ma_contracts c join hospitals h on h.id = c.hospital_id cross join d
    where p_hospital is null or c.hospital_id = p_hospital),
  s as (
    select c.*,
      case when off then 'ยกเลิก' when site_exp then 'หมดอายุแล้ว' when end_date is null then 'ยังไม่มีวันที่' when dl < 0 then 'หมดอายุแล้ว' when dl <= 90 then 'ใกล้หมด' else 'ยังมีผล' end st,
      p.steps, coalesce(p.po, false) po,
      v.last_visit, v.vm, v.vw, a.a_date, a.a_status, (a.plan_month is not null) has_a
    from c
    left join lateral (
      select string_agg(case when exists (select 1 from ma_proc x where x.contract_id = c.id and x.step = st.s
               and x.step_date >= coalesce(c.end_date, c.t) - 365) then '✓ ' else '○ ' end || st.s, '  ' order by st.o) steps,
        bool_or(st.s = 'PO' and exists (select 1 from ma_proc x where x.contract_id = c.id and x.step = 'PO' and x.step_date >= coalesce(c.end_date, c.t) - 365)) po
      from (values (1, 'PR'), (2, 'ใบเสนอราคา 3 เจ้า'), (3, 'สรุปเลือกผู้รับเหมา'), (4, 'PO')) st(o, s)) p on true
    left join lateral (
      select max(visit_date) last_visit,
        count(*) filter (where date_trunc('month', visit_date) = date_trunc('month', c.t))::int vm,
        count(*) filter (where visit_date between c.t - 6 and c.t)::int vw
      from ma_visits x where x.contract_id = c.id) v on true
    left join lateral (
      select distinct on (x.plan_month) x.plan_month, coalesce(x.new_date, x.appt_date) a_date, x.status a_status
      from ma_appts x where x.contract_id = c.id and coalesce(x.new_date, x.appt_date, x.plan_month) >= date_trunc('month', c.t)::date
      order by x.plan_month desc, x.created_at desc limit 1) a on true)
  select id, hospital_id, code, hname, grp, sys, scope, vendor, pm_cycle, start_date, end_date, dl, st,
    r.renew, case when not r.renew then '' when site_exp or dl < 0 then 'หมดสัญญาแล้ว ต้องเร่งออก PO' when dl <= 30 then 'สรุปเลือกผู้รับเหมาและออก PO'
      when dl <= 60 then 'ขอใบเสนอราคา 3 เจ้า และเปรียบเทียบ' else 'ออก PR เพื่อเริ่มจัดซื้อ' end,
    po, steps, last_visit,
    coalesce(act.ok and iv is not null and case when last_visit is null then start_date is not null and t - start_date > iv + 7 else t - last_visit > iv + 7 end, false),
    case when act.ok and iv is not null and last_visit is not null then last_visit + iv end,
    up.dt, up.stt, vm, vw
  from s
  cross join lateral (select (not off and (site_exp or (end_date is not null and dl <= 90)) and not po) renew) r
  cross join lateral (select (not off and end_date is not null and dl >= 0 and (start_date is null or start_date <= t)) ok) act
  cross join lateral (select case when has_a then a_date else case when act.ok and iv is not null and last_visit is not null then last_visit + iv end end due) du
  cross join lateral (select case when (st in ('ยังมีผล', 'ใกล้หมด') or po) and du.due between t and t + 14 and not (has_a and a_status like 'ยืนยัน%')
    then du.due end dt, case when has_a then a_status else 'ยังไม่บันทึกนัด' end stt) up
  order by code, grp, sort
$$;
revoke all on function public.ma_state(uuid) from public, anon, authenticated;
grant execute on function public.ma_state(uuid) to service_role;

-- builds and queues the mails of one kind ('renew' | 'weekly' | 'monthly') for one hospital (or the 12-hospital overview when
-- p_hospital is null). p_only: send to this address only (a test from the page). Returns how many mails were queued.
create or replace function public.ma_mail_queue(p_kind text, p_hospital uuid, p_only text default null) returns int
language plpgsql security definer set search_path = public as $$
declare t date := (now() at time zone 'Asia/Bangkok')::date; th text := extract(day from t) || '/' || extract(month from t) || '/' || (extract(year from t) + 543);
  h hospitals; body text := ''; subj text; r record; n int := 0; k record; att jsonb := null; nm text;
  ym text := (array['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'])[extract(month from t)] || ' ' || (extract(year from t) + 543);
begin
  if p_kind not in ('renew', 'weekly', 'monthly') then raise exception 'unknown kind %', p_kind; end if;
  if p_hospital is not null then select * into h from hospitals where id = p_hospital; end if;
  nm := coalesce(h.name, 'โรงพยาบาลในสัญญา 12 โรง');
  create temp table if not exists _ma on commit drop as select * from public.ma_state(null) limit 0;
  delete from _ma; insert into _ma select * from public.ma_state(p_hospital);
  select count(*) filter (where status <> 'ยกเลิก') total, count(*) filter (where renew) rn, count(*) filter (where overdue) od,
    count(*) filter (where up_date is not null) up, count(*) filter (where status = 'ยังไม่มีวันที่') nod, count(*) filter (where status = 'ยังมีผล' or status = 'ใกล้หมด') act,
    count(*) filter (where renew and (end_date is null or days_left < 0)) exp, coalesce(sum(visits_week), 0) vw, coalesce(sum(visits_month), 0) vm,
    count(*) filter (where visits_month > 0) vin, count(*) filter (where status not in ('ยกเลิก', 'หมดอายุแล้ว') and public.ma_cycle_days(pm_cycle) is not null) vdue
  into k from _ma;
  if p_kind = 'renew' then
    if k.rn = 0 and p_hospital is not null then return 0; end if;
    subj := 'แจ้งเตือนต่อสัญญา MA ' || coalesce(h.code, '12 โรง') || ' ' || th || ': ' || k.rn || ' สัญญา';
    body := 'แจ้งเตือนสัญญา MA ใกล้หมดอายุ ' || nm || ' ประจำวันที่ ' || th || E'\n\nขั้นตอน: 1) ออก PR  2) ขอใบเสนอราคา 3 เจ้า  3) สรุปเปรียบเทียบเลือกผู้รับเหมา  4) ออก PO ให้ผู้รับเหมา\nเมื่อทำแต่ละขั้นแล้ว กรุณาบันทึกในหน้า PM MA (เปิดสัญญา แล้วกด บันทึกขั้นจัดซื้อ) ระบบจะหยุดเตือนเมื่อบันทึก PO แล้ว\n\n';
    if p_hospital is null then
      body := body || E'สรุปรายโรง (หมดแล้วยังไม่ PO / เหลือ ≤30 วัน / 31-60 วัน / 61-90 วัน / ยังไม่มีวันที่ / สัญญาทั้งหมด)\n';
      for r in select code, count(*) filter (where renew and (end_date is null or days_left < 0)) a, count(*) filter (where renew and days_left between 0 and 30) b,
          count(*) filter (where renew and days_left between 31 and 60) c, count(*) filter (where renew and days_left > 60) d,
          count(*) filter (where status = 'ยังไม่มีวันที่') e, count(*) filter (where status <> 'ยกเลิก') f from _ma group by code order by code loop
        body := body || '- ' || r.code || ': ' || r.a || ' / ' || r.b || ' / ' || r.c || ' / ' || r.d || ' / ' || r.e || ' / ' || r.f || E'\n';
      end loop;
      body := body || E'\nรวมต้องต่อสัญญา ' || k.rn || ' สัญญา (หมดแล้วยังไม่ออก PO ' || k.exp || E')\n';
    else
      body := body || E'รายการที่ต้องดำเนินการ (เรียงจากเร่งด่วนที่สุด)\n';
      for r in select * from _ma where renew order by days_left nulls first loop
        body := body || '- ' || r.sys || ' — ' || r.scope || E'\n  ผู้รับเหมา: ' || coalesce(nullif(r.vendor, ''), '-') || ' | สิ้นสุด: ' ||
          coalesce(extract(day from r.end_date) || '/' || extract(month from r.end_date) || '/' || (extract(year from r.end_date) + 543), 'ไซต์แจ้งว่าหมดแล้ว') ||
          ' | ' || case when r.days_left is null then 'หมดแล้ว' when r.days_left < 0 then 'เกินมา ' || -r.days_left || ' วัน' else 'เหลือ ' || r.days_left || ' วัน' end ||
          E'\n  ควรทำ: ' || r.stage || E'\n  ความคืบหน้า: ' || r.steps || E'\n';
      end loop;
      if k.nod > 0 then body := body || E'\nหมายเหตุ: มี ' || k.nod || E' สัญญาที่ยังไม่ได้กรอกวันสิ้นสุดในทะเบียนสัญญา\n'; end if;
    end if;
  elsif p_kind = 'weekly' then
    subj := 'สรุป PM MA ประจำสัปดาห์ ' || coalesce(h.code, '12 โรง') || ': เข้า PM ' || k.vw || ' ครั้ง ขาดรอบ ' || k.od;
    body := 'สรุปการเข้า PM ของผู้รับเหมา (MA) ' || nm || ' ระหว่าง ' || to_char(t - 6, 'FMDD/FMMM/') || (extract(year from t - 6) + 543) || ' - ' || th || E'\n\n';
    if p_hospital is null then
      body := body || E'สรุปรายโรง (เข้า PM สัปดาห์นี้ / ขาดรอบ / นัด 14 วันยังไม่ยืนยัน / รอต่อสัญญา / สัญญาที่มีผล)\n';
      for r in select code, sum(visits_week) a, count(*) filter (where overdue) b, count(*) filter (where up_date is not null) c, count(*) filter (where renew) d,
          count(*) filter (where status in ('ยังมีผล', 'ใกล้หมด')) e from _ma group by code order by code loop
        body := body || '- ' || r.code || ': ' || r.a || ' / ' || r.b || ' / ' || r.c || ' / ' || r.d || ' / ' || r.e || E'\n';
      end loop;
    else
      body := body || E'ผู้รับเหมาที่เข้า PM สัปดาห์นี้\n';
      for r in select x.visit_date, c.vendor, c.scope, x.detail, x.result from ma_visits x join _ma c on c.contract_id = x.contract_id
          where x.visit_date between t - 6 and t order by x.visit_date loop
        body := body || '- ' || to_char(r.visit_date, 'FMDD/FMMM/') || (extract(year from r.visit_date) + 543) || ' ' || coalesce(nullif(r.vendor, ''), '-') || ': ' || r.scope ||
          coalesce(' — ' || nullif(r.detail, ''), '') || ' (' || coalesce(nullif(r.result, ''), '-') || E')\n';
      end loop;
      if k.vw = 0 then body := body || E'- ไม่มี -\n'; end if;
      body := body || E'\nผู้รับเหมาที่ขาดรอบ PM ตามสัญญา\n';
      for r in select * from _ma where overdue order by code, vendor loop
        body := body || '- ' || coalesce(nullif(r.vendor, ''), '-') || ': ' || r.scope || ' | รอบ ' || r.pm_cycle || ' | เข้าล่าสุด ' ||
          coalesce(to_char(r.last_visit, 'FMDD/FMMM/') || (extract(year from r.last_visit) + 543), 'ยังไม่มีบันทึก') || E'\n';
      end loop;
      if k.od = 0 then body := body || E'- ไม่มี -\n'; end if;
      body := body || E'\nนัดเข้า PM ใน 14 วันข้างหน้าที่ผู้รับเหมายังไม่ยืนยัน\n';
      for r in select * from _ma where up_date is not null order by up_date loop
        body := body || '- ' || coalesce(nullif(r.vendor, ''), '-') || ': ' || r.scope || ' | กำหนด ' || to_char(r.up_date, 'FMDD/FMMM/') || (extract(year from r.up_date) + 543) || ' | ' || r.up_status || E'\n';
      end loop;
      if k.up = 0 then body := body || E'- ไม่มี -\n'; end if;
      if k.rn > 0 then body := body || E'\nสัญญาที่อยู่ระหว่างต่อสัญญา: ' || k.rn || E' สัญญา\n'; end if;
    end if;
  else
    subj := 'สรุปผล PM MA ' || coalesce(h.code, '12 โรง') || ' เดือน' || ym;
    att := jsonb_build_object('kind', 'ma_month', 'hospital', p_hospital, 'year', extract(year from t)::int, 'month', extract(month from t)::int);
    body := 'สรุปผล PM MA ' || nm || ' เดือน' || ym || ' (ข้อมูลถึง ' || th || E')\n\n';
    if p_hospital is null then
      body := body || E'สรุปรายโรง (งานตามแผน PM MA เดือนนี้ / เข้า PM (ครั้ง) / ผู้รับเหมาเข้าแล้ว / ขาดรอบ / รอต่อสัญญา / หมดแล้วไม่มี PO)\n';
      for r in select hh.code, (select planned from public.pm_followup_core_by(hh.id, extract(year from t)::int, extract(month from t)::int, 'MA') where grp = 'รวม') pl,
          coalesce(sum(m.visits_month), 0) a, count(m.contract_id) filter (where m.visits_month > 0) b,
          count(m.contract_id) filter (where m.status not in ('ยกเลิก', 'หมดอายุแล้ว') and public.ma_cycle_days(m.pm_cycle) is not null) b2,
          count(m.contract_id) filter (where m.overdue) c, count(m.contract_id) filter (where m.renew) d, count(m.contract_id) filter (where m.renew and (m.end_date is null or m.days_left < 0)) e
          from hospitals hh left join _ma m on m.hospital_id = hh.id where hh.active group by hh.id, hh.code order by hh.code loop
        body := body || '- ' || r.code || ': ' || coalesce(r.pl::text, '-') || ' / ' || r.a || ' / ' || r.b || '/' || r.b2 || ' / ' || r.c || ' / ' || r.d || ' / ' || r.e || E'\n';
      end loop;
    else
      select planned, done into r from public.pm_followup_core_by(p_hospital, extract(year from t)::int, extract(month from t)::int, 'MA') where grp = 'รวม';
      body := body || '- งาน PM ตามแผน PM MA เดือนนี้: ' || coalesce(r.planned, 0) || ' เครื่อง (บันทึกผลเสร็จแล้ว ' || coalesce(r.done, 0) || E')\n' ||
        '- ผู้รับเหมาที่เข้า PM แล้ว / ที่มีสัญญา: ' || k.vin || ' / ' || k.vdue || E'\n' ||
        '- บันทึกการเข้า PM เดือนนี้: ' || k.vm || E' ครั้ง\n' || '- ผู้รับเหมาขาดรอบ: ' || k.od || E'\n' ||
        '- สัญญารอต่อ (≤90 วัน): ' || k.rn || E'\n' || '- สัญญาหมดแล้วยังไม่ออก PO: ' || k.exp || E'\n';
    end if;
    body := body || E'\nรายละเอียดรายสัญญาอยู่ในไฟล์ Excel ที่แนบมากับอีเมลนี้\n';
  end if;
  body := body || E'\nเปิดหน้า PM MA: https://drnirunv-art.github.io/repair-system/ma.html' || coalesce('?p=' || h.code, '') ||
    E'\n\nงานวิศวกรรมอาคาร\n(อีเมลนี้ส่งอัตโนมัติ: แจ้งเตือนต่อสัญญาทุกวันจันทร์ 08:00 สรุปทุกวันศุกร์ 16:00 และสรุปรายเดือนวันที่ 23 กรุณาอย่าตอบกลับ)';
  if p_only is not null then
    insert into email_outbox (hospital_id, to_email, subject, body_text, attach) values (p_hospital, p_only, '[ทดสอบ] ' || subj, body, att);
    return 1;
  end if;
  insert into email_outbox (hospital_id, to_email, subject, body_text, attach)
  select p_hospital, rr.email, subj, body, att from ma_recipients rr
  where rr.active and rr.hospital_id is not distinct from p_hospital
    and case p_kind when 'renew' then rr.renew when 'weekly' then rr.weekly else rr.monthly end;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.ma_mail_queue(text, uuid, text) from public, anon, authenticated;

-- the scheduled run: every hospital that has recipients, then the 12-hospital overview
create or replace function public.ma_mail_all(p_kind text) returns int
language plpgsql security definer set search_path = public as $$
declare n int := 0; h record;
begin
  for h in select distinct hospital_id from ma_recipients where active and hospital_id is not null loop n := n + public.ma_mail_queue(p_kind, h.hospital_id); end loop;
  if exists (select 1 from ma_recipients where active and hospital_id is null) then n := n + public.ma_mail_queue(p_kind, null); end if;
  return n;
end $$;
revoke all on function public.ma_mail_all(text) from public, anon, authenticated;

-- a manager (or a 12-hospital viewer) sends one mail of a kind to their own address now, to see how it looks
create or replace function public.ma_mail_test(p_kind text, p_hospital uuid) returns int
language plpgsql security definer set search_path = public as $$
declare em text := (select email from auth.users where id = auth.uid());
begin
  if p_hospital is null and not public.am_exec() then raise exception 'เฉพาะผู้ที่มีสิทธิ์ดูภาพรวม 12 โรงพยาบาล'; end if;
  if p_hospital is not null and not ((p_hospital = public.my_hospital() and public.is_manager()) or public.am_exec()) then raise exception 'เฉพาะหัวหน้า / Admin ของโรงนี้'; end if;
  if em is null then raise exception 'ไม่พบอีเมลของบัญชีนี้'; end if;
  return public.ma_mail_queue(p_kind, p_hospital, em);
end $$;
revoke all on function public.ma_mail_test(text, uuid) from public, anon;
grant execute on function public.ma_mail_test(text, uuid) to authenticated;

-- Bangkok times: Monday 08:00, Friday 16:00, the 23rd 08:00
select cron.schedule('ma-renew-mon', '0 1 * * 1', $$select public.ma_mail_all('renew')$$);
select cron.schedule('ma-weekly-fri', '0 9 * * 5', $$select public.ma_mail_all('weekly')$$);
select cron.schedule('ma-monthly-23', '0 1 23 * *', $$select public.ma_mail_all('monthly')$$);
