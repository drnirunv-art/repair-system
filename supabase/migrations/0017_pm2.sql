-- PM2: preventive maintenance by QR. Equipment registry with TAG + yearly plan (M/Q/H/Y, months, week, TW/MA),
-- standard check sheets per equipment type, monthly PM tasks, technician answers (sign 1/3),
-- head technician sign 2/3, engineer sign 3/3, send back with reason, open a repair job from failed items.
-- Additive only.

-- 1. registry fields on equipment -------------------------------------------------------------------
alter table public.equipment
  add column if not exists tag text,
  add column if not exists eq_type text,
  add column if not exists building text,
  add column if not exists floor text,
  add column if not exists place text,
  add column if not exists pm_freq text check (pm_freq in ('M','Q','H','Y')),
  add column if not exists pm_months int[] not null default '{}',
  add column if not exists pm_week int not null default 1 check (pm_week between 1 and 4),
  add column if not exists pm_by text not null default 'TW' check (pm_by in ('TW','MA')),
  add column if not exists updated_at timestamptz not null default now();
create unique index if not exists equipment_tag_uq on public.equipment (hospital_id, upper(tag)) where tag is not null;

-- start values: TAG = old code when it is unique in the hospital; type guessed from the name; place from location
update public.equipment e set tag = e.code
where e.tag is null and e.code is not null
  and not exists (select 1 from public.equipment x where x.hospital_id = e.hospital_id and x.id <> e.id and upper(x.code) = upper(e.code));
update public.equipment e set building = l.building, floor = l.floor, place = coalesce(e.place, l.department)
from public.locations l where l.id = e.location_id and e.building is null;
update public.equipment set eq_type = case
  when upper(name) like '%CHILLER%' then 'Chiller'
  when upper(name) like '%COOLING TOWER%' then 'Cooling Tower'
  when upper(name) like '%AHU%' or upper(name) like '%AIR HANDLING%' then 'AHU'
  when upper(name) like '%FCU%' or upper(name) like '%FAN COIL%' then 'FCU'
  when upper(name) like '%SPLIT%' or upper(name) like '%VRF%' or upper(name) like '%VRV%' then 'Split / VRF'
  when upper(name) like '%FIRE PUMP%' then 'Fire Pump'
  when upper(name) like '%JOCKEY%' then 'Jockey Pump'
  when upper(name) like '%BOOSTER%' then 'Booster Pump'
  when upper(name) like '%TRANSFER%' then 'Transfer Pump'
  when upper(name) like '%SUBMERSIBLE%' or upper(name) like '%SUMP%' then 'Submersible Pump'
  when upper(name) like '%DRAIN%' then 'Drainage Pump'
  when upper(name) like '%BLOWER%' then 'Air Blower'
  when upper(name) like '%CDP%' or upper(name) like '%CONDENSER WATER PUMP%' then 'Condenser Water Pump'
  when upper(name) like '%PCP%' or upper(name) like '%PRIMARY%' then 'Primary Chilled Pump'
  when upper(name) like '%SCP%' or upper(name) like '%SECONDARY%' then 'Secondary Chilled Pump'
  when upper(name) like '%PUMP%' or name like '%ปั๊ม%' then 'ปั๊มน้ำ'
  when upper(name) like '%GENERATOR%' or upper(name) like '%GEN %' or name like '%เครื่องกำเนิด%' then 'Generator'
  when upper(name) like '%ATS%' then 'ATS'
  when upper(name) like '%EMDB%' then 'EMDB'
  when upper(name) like '%MDB%' then 'MDB'
  when upper(name) like '%TRANSFORMER%' or name like '%หม้อแปลง%' then 'Transformer'
  when upper(name) like '%UPS%' then 'UPS'
  when upper(name) like '%ESCALATOR%' or name like '%บันไดเลื่อน%' then 'บันไดเลื่อน'
  when upper(name) like '%LIFT%' or upper(name) like '%ELEVATOR%' or upper(name) like '%DUMB%' or name like '%ลิฟต์%' then 'ลิฟต์'
  when upper(name) like '%FIRE ALARM%' or upper(name) like '%FCP%' then 'Fire Alarm'
  when upper(name) like '%TANK%' or name like '%ถัง%' then 'ถังเก็บน้ำ'
  when upper(name) like '%FAN%' or name like '%พัดลม%' then 'พัดลม'
  when system = 'Special room' then 'Special room'
  else null end
where eq_type is null;
grant update (tag, eq_type, building, floor, place, pm_freq, pm_months, pm_week, pm_by, updated_at, name, code, active, location_id) on public.equipment to authenticated;

-- 2. check sheets (one standard per type; hospital_id null = central standard used by every hospital) -----
-- items: [{"t": text, "k": "level"|"value", "u": unit, "lo": min, "hi": max, "ph": photo required}]
create table if not exists public.pm_templates (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid references public.hospitals(id) on delete cascade,
  eq_type text not null,
  items jsonb not null default '[]',
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);
create unique index if not exists pm_templates_uq on public.pm_templates (coalesce(hospital_id, '00000000-0000-0000-0000-000000000000'::uuid), eq_type);
alter table public.pm_templates enable row level security;
create policy "pm templates read" on public.pm_templates for select to authenticated using (hospital_id is null or hospital_id = public.my_hospital());
create policy "pm templates hospital write" on public.pm_templates for insert to authenticated with check (hospital_id = public.my_hospital() and public.is_manager());
create policy "pm templates hospital edit" on public.pm_templates for update to authenticated
  using (hospital_id = public.my_hospital() and public.is_manager()) with check (hospital_id = public.my_hospital());
grant select, insert, update on public.pm_templates to authenticated;

insert into public.pm_templates (hospital_id, eq_type, items)
select null, t.eq_type, t.items::jsonb from (values
 ('ทั่วไป', '[{"t":"สภาพภายนอก สะอาด ไม่มีความเสียหาย","k":"level"},{"t":"เสียงและการสั่นสะเทือนปกติ","k":"level"},{"t":"จุดต่อสาย/ขั้วต่อแน่น ไม่มีรอยไหม้","k":"level"},{"t":"ทดสอบการทำงาน ทำงานปกติ","k":"level"},{"t":"ถ่ายรูปเครื่องหลังตรวจ","k":"level","ph":true}]'),
 ('FCU', '[{"t":"ตรวจรีโมท / Thermostat แสดงผลและทำงานปกติ","k":"level"},{"t":"มอเตอร์พัดลมและวาล์วน้ำเย็นทำงานปกติ","k":"level"},{"t":"ล้างแผ่นกรองอากาศ (Air Filter)","k":"level","ph":true},{"t":"เช็ดช่องลมกลับ (RAG) / ช่องจ่ายลม (SAG)","k":"level"},{"t":"ท่อน้ำทิ้ง / ปั๊มน้ำทิ้งไม่อุดตัน","k":"level"},{"t":"อุณหภูมิลมจ่าย","k":"value","u":"°C","lo":10,"hi":18},{"t":"ทดสอบหลังล้าง เครื่องทำงานปกติ ไม่มีความเสียหายต่อฝ้า/พื้น","k":"level","ph":true}]'),
 ('AHU', '[{"t":"ล้างแผ่นกรองอากาศ (Air Filter)","k":"level","ph":true},{"t":"สภาพและความตึงสายพาน","k":"level"},{"t":"ฝุ่น เชื้อรา คราบ จุดรั่วซึมท่อ/คอยล์","k":"level"},{"t":"ถาดน้ำทิ้งและท่อระบายน้ำไหลปกติ","k":"level"},{"t":"Fresh Air / Return Air Damper เปิด-ปิดปกติ","k":"level"},{"t":"กระแสมอเตอร์พัดลม","k":"value","u":"A"},{"t":"อุณหภูมิลมจ่าย","k":"value","u":"°C","lo":10,"hi":18},{"t":"ทดสอบหลังล้าง เครื่องทำงานปกติ","k":"level","ph":true}]'),
 ('Split / VRF', '[{"t":"ล้างแผ่นกรองอากาศ (Air Filter)","k":"level","ph":true},{"t":"ทำความสะอาดคอยล์เย็น (Indoor)","k":"level"},{"t":"ฉีดล้างแผง Condensing Unit","k":"level"},{"t":"ท่อน้ำทิ้งไม่อุดตัน","k":"level"},{"t":"สภาพท่อน้ำยาและฉนวน","k":"level"},{"t":"อุณหภูมิลมจ่าย","k":"value","u":"°C","lo":10,"hi":18},{"t":"ทดสอบทำความเย็นหลังล้าง","k":"level","ph":true}]'),
 ('พัดลม', '[{"t":"ใบพัดและตะแกรงสะอาด ไม่สั่น","k":"level"},{"t":"มอเตอร์ เสียงและความร้อนปกติ","k":"level"},{"t":"สายพาน / ลูกปืน (ถ้ามี)","k":"level"},{"t":"กระแสมอเตอร์","k":"value","u":"A"},{"t":"ทดสอบเปิด-ปิด ทำงานปกติ","k":"level","ph":true}]'),
 ('Chiller', '[{"t":"อุณหภูมิน้ำเย็นจ่าย (CHS)","k":"value","u":"°C","lo":5,"hi":8},{"t":"อุณหภูมิน้ำเย็นกลับ (CHR)","k":"value","u":"°C","lo":10,"hi":14},{"t":"แรงดันน้ำยาด้านต่ำ","k":"value","u":"psi"},{"t":"แรงดันน้ำยาด้านสูง","k":"value","u":"psi"},{"t":"กระแสคอมเพรสเซอร์","k":"value","u":"%RLA","lo":0,"hi":100},{"t":"ระดับน้ำมันคอมเพรสเซอร์","k":"level"},{"t":"ไม่มีสัญญาณเตือน (Alarm) ที่หน้าจอ","k":"level","ph":true},{"t":"ไม่มีน้ำรั่ว / น้ำยารั่ว","k":"level"}]'),
 ('Cooling Tower', '[{"t":"มอเตอร์และใบพัด เสียงและการสั่นปกติ","k":"level"},{"t":"สายพาน / เกียร์","k":"level"},{"t":"หัวกระจายน้ำและ Filling ไม่อุดตัน ไม่มีตะไคร่","k":"level","ph":true},{"t":"ลูกลอยเติมน้ำทำงานปกติ","k":"level"},{"t":"อุณหภูมิน้ำเข้า","k":"value","u":"°C"},{"t":"อุณหภูมิน้ำออก","k":"value","u":"°C"},{"t":"ระบบเติมสารเคมีทำงาน","k":"level"}]'),
 ('Generator', '[{"t":"ระดับน้ำมันเชื้อเพลิง","k":"value","u":"%","lo":75,"hi":100},{"t":"ระดับน้ำมันเครื่อง","k":"level"},{"t":"ระดับน้ำหล่อเย็น","k":"level"},{"t":"แรงดันแบตเตอรี่","k":"value","u":"V","lo":24,"hi":28},{"t":"เดินเครื่องทดสอบ (No load) 15 นาที","k":"level","ph":true},{"t":"แรงดันไฟฟ้าขณะเดินเครื่อง","k":"value","u":"V","lo":380,"hi":400},{"t":"ความถี่","k":"value","u":"Hz","lo":49.5,"hi":50.5},{"t":"ไม่มีน้ำมัน / น้ำรั่ว","k":"level"}]'),
 ('ATS', '[{"t":"ไฟแสดงสถานะ Normal / Emergency ถูกต้อง","k":"level"},{"t":"ขั้วต่อสายแน่น ไม่มีรอยไหม้","k":"level"},{"t":"ทดสอบสลับแหล่งจ่ายร่วมกับเดินเครื่อง Generator","k":"level","ph":true},{"t":"เวลาสลับ","k":"value","u":"วินาที","lo":0,"hi":10}]'),
 ('MDB', '[{"t":"แรงดัน R-S","k":"value","u":"V","lo":380,"hi":400},{"t":"แรงดัน S-T","k":"value","u":"V","lo":380,"hi":400},{"t":"แรงดัน T-R","k":"value","u":"V","lo":380,"hi":400},{"t":"หลอดไฟแสดงเฟสติดครบ","k":"level"},{"t":"ตู้สะอาด ไม่มีความร้อนผิดปกติ ไม่มีกลิ่นไหม้","k":"level","ph":true},{"t":"เบรกเกอร์ / ขั้วต่อแน่น","k":"level"}]'),
 ('EMDB', '[{"t":"แรงดัน R-S","k":"value","u":"V","lo":380,"hi":400},{"t":"แรงดัน S-T","k":"value","u":"V","lo":380,"hi":400},{"t":"แรงดัน T-R","k":"value","u":"V","lo":380,"hi":400},{"t":"หลอดไฟแสดงเฟสติดครบ","k":"level"},{"t":"ตู้สะอาด ไม่มีความร้อนผิดปกติ","k":"level","ph":true}]'),
 ('Transformer', '[{"t":"อุณหภูมิขดลวด / น้ำมัน","k":"value","u":"°C","lo":0,"hi":90},{"t":"ระดับน้ำมัน (ถ้ามี) และไม่มีรั่วซึม","k":"level"},{"t":"เสียงฮัมปกติ","k":"level"},{"t":"ห้องสะอาด ระบายอากาศดี ไม่มีสัตว์","k":"level","ph":true}]'),
 ('UPS', '[{"t":"สถานะ Online ไม่มี Alarm","k":"level","ph":true},{"t":"โหลด","k":"value","u":"%","lo":0,"hi":80},{"t":"แรงดันแบตเตอรี่","k":"value","u":"V"},{"t":"อุณหภูมิห้อง","k":"value","u":"°C","lo":18,"hi":27}]'),
 ('Fire Pump', '[{"t":"ระดับน้ำมันเชื้อเพลิง (ปั๊มดีเซล)","k":"value","u":"%","lo":75,"hi":100},{"t":"แรงดันแบตเตอรี่","k":"value","u":"V","lo":24,"hi":28},{"t":"ทดลองเดินเครื่อง (Churn test)","k":"level","ph":true},{"t":"แรงดันด้านจ่าย","k":"value","u":"bar"},{"t":"ตู้ควบคุมอยู่ในตำแหน่ง Auto","k":"level"},{"t":"ไม่มีน้ำรั่วที่ซีล / วาล์ว","k":"level"}]'),
 ('Jockey Pump', '[{"t":"ตู้ควบคุมอยู่ในตำแหน่ง Auto","k":"level"},{"t":"แรงดันตัด-ต่อปกติ","k":"value","u":"bar"},{"t":"ไม่มีน้ำรั่ว เสียงปกติ","k":"level","ph":true}]'),
 ('Booster Pump', '[{"t":"แรงดันด้านจ่าย","k":"value","u":"bar"},{"t":"กระแสมอเตอร์","k":"value","u":"A"},{"t":"เสียงและการสั่นปกติ","k":"level"},{"t":"ไม่มีน้ำรั่วที่ซีล","k":"level","ph":true},{"t":"ถังแรงดัน / Pressure switch ทำงานปกติ","k":"level"}]'),
 ('Transfer Pump', '[{"t":"กระแสมอเตอร์","k":"value","u":"A"},{"t":"เสียงและการสั่นปกติ","k":"level"},{"t":"ไม่มีน้ำรั่วที่ซีล","k":"level","ph":true},{"t":"ลูกลอยสั่งงานปกติ","k":"level"}]'),
 ('Submersible Pump', '[{"t":"ลูกลอยสั่งงานปกติ","k":"level"},{"t":"กระแสมอเตอร์","k":"value","u":"A"},{"t":"บ่อไม่มีขยะ / ตะกอนอุดตัน","k":"level","ph":true},{"t":"ทดลองสลับเครื่อง","k":"level"}]'),
 ('Drainage Pump', '[{"t":"ลูกลอยสั่งงานปกติ","k":"level"},{"t":"กระแสมอเตอร์","k":"value","u":"A"},{"t":"บ่อไม่มีขยะ / ตะกอนอุดตัน","k":"level","ph":true}]'),
 ('Air Blower', '[{"t":"เสียงและการสั่นปกติ","k":"level"},{"t":"กระแสมอเตอร์","k":"value","u":"A"},{"t":"ไส้กรองอากาศสะอาด","k":"level","ph":true},{"t":"สายพาน / น้ำมันหล่อลื่น","k":"level"}]'),
 ('Condenser Water Pump', '[{"t":"แรงดันด้านดูด / จ่าย","k":"value","u":"bar"},{"t":"กระแสมอเตอร์","k":"value","u":"A"},{"t":"เสียงและการสั่นปกติ","k":"level"},{"t":"ไม่มีน้ำรั่วที่ซีล","k":"level","ph":true}]'),
 ('Primary Chilled Pump', '[{"t":"แรงดันด้านดูด / จ่าย","k":"value","u":"bar"},{"t":"กระแสมอเตอร์","k":"value","u":"A"},{"t":"เสียงและการสั่นปกติ","k":"level"},{"t":"ไม่มีน้ำรั่วที่ซีล","k":"level","ph":true}]'),
 ('Secondary Chilled Pump', '[{"t":"แรงดันด้านดูด / จ่าย","k":"value","u":"bar"},{"t":"กระแสมอเตอร์ / ความถี่ VSD","k":"value","u":"Hz"},{"t":"เสียงและการสั่นปกติ","k":"level"},{"t":"ไม่มีน้ำรั่วที่ซีล","k":"level","ph":true}]'),
 ('ปั๊มน้ำ', '[{"t":"แรงดันด้านจ่าย","k":"value","u":"bar"},{"t":"กระแสมอเตอร์","k":"value","u":"A"},{"t":"เสียงและการสั่นปกติ","k":"level"},{"t":"ไม่มีน้ำรั่วที่ซีล","k":"level","ph":true}]'),
 ('ลิฟต์', '[{"t":"ประตูเปิด-ปิด และเซนเซอร์กันหนีบทำงาน","k":"level"},{"t":"ระดับจอดตรงชั้น","k":"level"},{"t":"ปุ่มกด ไฟแสดงชั้น อินเตอร์คอมทำงาน","k":"level"},{"t":"ไฟส่องสว่างและพัดลมในตู้โดยสาร","k":"level"},{"t":"ห้องเครื่องสะอาด ไม่มีเสียงผิดปกติ","k":"level","ph":true}]'),
 ('บันไดเลื่อน', '[{"t":"ราวมือจับเคลื่อนที่สัมพันธ์กับขั้นบันได","k":"level"},{"t":"ปุ่มหยุดฉุกเฉินทำงาน","k":"level"},{"t":"แผ่นหวี (Comb plate) ไม่บิ่น","k":"level","ph":true}]'),
 ('Fire Alarm', '[{"t":"ตู้ควบคุม (FCP) สถานะ Normal ไม่มี Fault","k":"level","ph":true},{"t":"แรงดันแบตเตอรี่สำรอง","k":"value","u":"V","lo":24,"hi":28},{"t":"สุ่มทดสอบอุปกรณ์ตรวจจับในลูป","k":"level"},{"t":"กระดิ่ง / ไฟเตือนทำงาน","k":"level"}]'),
 ('ถังเก็บน้ำ', '[{"t":"ระดับน้ำ","k":"value","u":"%","lo":50,"hi":100},{"t":"ฝาปิดสนิท ไม่มีสิ่งปนเปื้อน","k":"level","ph":true},{"t":"ลูกลอย / วาล์วเติมน้ำทำงาน","k":"level"},{"t":"ไม่มีรอยรั่วซึม","k":"level"}]'),
 ('Special room', '[{"t":"ความดันห้อง (Positive / Negative) ตามมาตรฐาน","k":"value","u":"Pa"},{"t":"อุณหภูมิห้อง","k":"value","u":"°C","lo":20,"hi":26},{"t":"ความชื้นสัมพัทธ์","k":"value","u":"%RH","lo":30,"hi":60},{"t":"ไส้กรอง HEPA / Pre-filter","k":"level","ph":true},{"t":"เกจวัดความดันหน้าห้องทำงาน","k":"level"}]')
) as t(eq_type, items)
on conflict do nothing;

-- 3. monthly PM tasks --------------------------------------------------------------------------------
create table if not exists public.pm_tasks (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null references public.hospitals(id) on delete cascade,
  equipment_id uuid not null references public.equipment(id) on delete cascade,
  year int not null, month int not null check (month between 1 and 12), week int not null default 1 check (week between 1 and 4),
  status text not null default 'todo' check (status in ('todo','submitted','head_signed','approved','returned')),
  items jsonb not null default '[]',      -- copy of the check sheet when answered
  answers jsonb not null default '[]',    -- [{"v": "ok"|"wear"|"bad"|number, "n": note, "ph": [paths]}]
  score int, abnormal int not null default 0,
  note text, scanned boolean not null default false,
  tech_id uuid references public.profiles(id), submitted_at timestamptz,
  head_id uuid references public.profiles(id), head_at timestamptz,
  eng_id uuid references public.profiles(id), eng_at timestamptz,
  return_reason text, returned_at timestamptz,
  job_id uuid references public.jobs(id),
  created_at timestamptz not null default now(),
  unique (equipment_id, year, month)
);
create index if not exists pm_tasks_month_idx on public.pm_tasks (hospital_id, year, month);
alter table public.pm_tasks enable row level security;
create policy "pm tasks staff read" on public.pm_tasks for select to authenticated using (hospital_id = public.my_hospital());
grant select on public.pm_tasks to authenticated;

create or replace function public.pm_can_head() returns boolean language sql stable security definer set search_path = public as
$$ select coalesce(public.my_role() in ('owner','admin','chief_engineer','supervisor','senior_technician'), false) $$;
create or replace function public.pm_can_eng() returns boolean language sql stable security definer set search_path = public as
$$ select coalesce(public.my_role() in ('owner','admin','chief_engineer'), false) $$;

-- months that a frequency covers, starting from a month
create or replace function public.pm_months_for(p_freq text, p_start int) returns int[] language sql immutable as $$
  select coalesce(array_agg(((p_start - 1 + g) % 12) + 1 order by ((p_start - 1 + g) % 12) + 1), '{}')
  from generate_series(0, 11, case p_freq when 'M' then 1 when 'Q' then 3 when 'H' then 6 when 'Y' then 12 else 12 end) g
  where p_freq in ('M','Q','H','Y')
$$;

-- managers create the month's tasks from the plan (safe to run again: existing tasks stay)
create or replace function public.pm_generate(p_year int, p_month int) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.is_manager() then raise exception 'เฉพาะหัวหน้า / Admin สร้างแผนเดือนได้'; end if;
  insert into pm_tasks (hospital_id, equipment_id, year, month, week)
  select e.hospital_id, e.id, p_year, p_month, e.pm_week from equipment e
  where e.hospital_id = public.my_hospital() and e.active and p_month = any(e.pm_months)
  on conflict (equipment_id, year, month) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

-- technician answers the check sheet (sign 1/3). Answers are checked against the sheet on the server.
create or replace function public.pm_submit(p_task uuid, p_answers jsonb, p_note text, p_scanned boolean)
returns int language plpgsql security definer set search_path = public as $$
declare t pm_tasks; e equipment; its jsonb; i int; a jsonb; it jsonb; v text; bad int := 0; ok numeric := 0; n int;
begin
  select * into t from pm_tasks where id = p_task for update;
  if t.id is null or t.hospital_id <> public.my_hospital() then raise exception 'ไม่พบงาน PM'; end if;
  if public.my_role() = 'observer' then raise exception 'บัญชีผู้ดูส่งผลตรวจไม่ได้'; end if;
  if t.status not in ('todo','returned') then raise exception 'งานนี้ส่งผลแล้ว'; end if;
  select * into e from equipment where id = t.equipment_id;
  select items into its from pm_templates where eq_type = coalesce(e.eq_type, 'ทั่วไป') and (hospital_id = t.hospital_id or hospital_id is null)
    order by hospital_id nulls last limit 1;
  if its is null then select items into its from pm_templates where eq_type = 'ทั่วไป' and hospital_id is null; end if;
  n := jsonb_array_length(its);
  if jsonb_typeof(p_answers) <> 'array' or jsonb_array_length(p_answers) <> n then raise exception 'ตอบให้ครบทุกข้อ (% ข้อ)', n; end if;
  for i in 0 .. n - 1 loop
    it := its -> i; a := p_answers -> i; v := a ->> 'v';
    if v is null or v = '' then raise exception 'ข้อ % ยังไม่ได้ตอบ', i + 1; end if;
    if coalesce((it ->> 'ph')::boolean, false) and coalesce(jsonb_array_length(a -> 'ph'), 0) = 0 then raise exception 'ข้อ % ต้องถ่ายรูป', i + 1; end if;
    if it ->> 'k' = 'value' then
      if v !~ '^-?[0-9]+(\.[0-9]+)?$' then raise exception 'ข้อ % ใส่ตัวเลข', i + 1; end if;
      if (it ? 'lo' and v::numeric < (it ->> 'lo')::numeric) or (it ? 'hi' and v::numeric > (it ->> 'hi')::numeric) then bad := bad + 1; else ok := ok + 1; end if;
    else
      if v not in ('ok','wear','bad') then raise exception 'ข้อ % คำตอบไม่ถูกต้อง', i + 1; end if;
      if v = 'bad' then bad := bad + 1; elsif v = 'ok' then ok := ok + 1; else ok := ok + 0.5; end if;
    end if;
  end loop;
  update pm_tasks set status = 'submitted', items = its, answers = p_answers, abnormal = bad, score = round(100 * ok / greatest(n, 1)),
    note = nullif(trim(p_note), ''), scanned = coalesce(p_scanned, false), tech_id = auth.uid(), submitted_at = now(),
    head_id = null, head_at = null, eng_id = null, eng_at = null, return_reason = null
  where id = p_task;
  return bad;
end $$;

-- head signs 2/3, engineer signs 3/3. Several at once only when every sheet scored 100 with no abnormal item.
create or replace function public.pm_sign(p_tasks uuid[], p_level int) returns int
language plpgsql security definer set search_path = public as $$
declare t pm_tasks; n int := 0; batch boolean := array_length(p_tasks, 1) > 1;
begin
  if p_level = 2 and not public.pm_can_head() then raise exception 'เฉพาะหัวหน้าช่างเซ็น 2/3 ได้'; end if;
  if p_level = 3 and not public.pm_can_eng() then raise exception 'เฉพาะวิศวกร / Chief Engineer เซ็น 3/3 ได้'; end if;
  for t in select * from pm_tasks where id = any(p_tasks) and hospital_id = public.my_hospital() for update loop
    if batch and (coalesce(t.score, 0) < 100 or t.abnormal > 0) then continue; end if;
    if p_level = 2 and t.status = 'submitted' and t.tech_id is distinct from auth.uid() then
      update pm_tasks set status = 'head_signed', head_id = auth.uid(), head_at = now() where id = t.id; n := n + 1;
    elsif p_level = 3 and t.status = 'head_signed' then
      update pm_tasks set status = 'approved', eng_id = auth.uid(), eng_at = now() where id = t.id; n := n + 1;
    end if;
  end loop;
  if n = 0 and not batch then raise exception 'เซ็นไม่ได้: ใบต้องอยู่ในขั้นที่รอคุณเซ็น และผู้ตรวจเซ็นใบของตัวเองไม่ได้'; end if;
  return n;
end $$;

create or replace function public.pm_return(p_task uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare t pm_tasks;
begin
  if not public.pm_can_head() then raise exception 'เฉพาะหัวหน้าช่าง / วิศวกรส่งกลับได้'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'ใส่เหตุผลที่ส่งกลับ'; end if;
  select * into t from pm_tasks where id = p_task and hospital_id = public.my_hospital() for update;
  if t.id is null or t.status not in ('submitted','head_signed') then raise exception 'ส่งกลับได้เฉพาะใบที่รอเซ็น'; end if;
  update pm_tasks set status = 'returned', return_reason = trim(p_reason), returned_at = now(), head_id = null, head_at = null where id = p_task;
end $$;

-- open a repair job from the failed items of a PM sheet (once per sheet)
create or replace function public.pm_open_job(p_task uuid) returns text
language plpgsql security definer set search_path = public as $$
declare t pm_tasks; e equipment; l locations; h hospitals; per text; n int; v_no text; jid uuid; prio uuid; me profiles; d text;
begin
  select * into t from pm_tasks where id = p_task and hospital_id = public.my_hospital() for update;
  if t.id is null then raise exception 'ไม่พบงาน PM'; end if;
  if t.abnormal = 0 then raise exception 'ใบนี้ไม่มีข้อผิดปกติ'; end if;
  if t.job_id is not null then select job_no into v_no from jobs where id = t.job_id; return v_no; end if;
  select * into e from equipment where id = t.equipment_id;
  select * into l from locations where id = e.location_id;
  select * into h from hospitals where id = t.hospital_id;
  select * into me from profiles where id = auth.uid();
  select string_agg((i + 1) || '. ' || (t.items -> i ->> 't') || ' = ' ||
           case t.answers -> i ->> 'v' when 'bad' then 'ผิดปกติ' when 'wear' then 'เริ่มเสื่อม' else (t.answers -> i ->> 'v') || coalesce(' ' || (t.items -> i ->> 'u'), '') end
           || coalesce(' (' || nullif(t.answers -> i ->> 'n', '') || ')', ''), E'\n')
    into d from generate_series(0, jsonb_array_length(t.items) - 1) i
    where t.answers -> i ->> 'v' = 'bad'
       or (t.items -> i ->> 'k' = 'value' and t.answers -> i ->> 'v' ~ '^-?[0-9]+(\.[0-9]+)?$'
           and (((t.items -> i) ? 'lo' and (t.answers -> i ->> 'v')::numeric < (t.items -> i ->> 'lo')::numeric)
             or ((t.items -> i) ? 'hi' and (t.answers -> i ->> 'v')::numeric > (t.items -> i ->> 'hi')::numeric)));
  per := to_char((now() at time zone 'Asia/Bangkok') + interval '543 years', 'YYMM');
  insert into job_counters (hospital_id, period, last_no) values (h.id, per, 1)
    on conflict (hospital_id, period) do update set last_no = job_counters.last_no + 1 returning last_no into n;
  v_no := h.code || '-' || per || '-' || lpad(n::text, 4, '0');
  select id into prio from priorities where hospital_id = h.id and is_default limit 1;
  insert into jobs (job_no, hospital_id, location_id, building, floor, department, equipment_id, equipment_text, detail, reporter_name, reporter_phone, priority_id)
  values (v_no, h.id, e.location_id, coalesce(e.building, l.building), coalesce(e.floor, l.floor), coalesce(e.place, l.department), e.id, coalesce(e.tag || ' · ', '') || e.name,
    'จากผล PM ' || t.month || '/' || (t.year + 543) || ' ข้อที่ไม่ผ่าน:' || E'\n' || coalesce(d, '-'),
    coalesce(me.full_name, 'PM2'), 'PM2', prio)
  returning id into jid;
  insert into job_events (job_id, status, note) values (jid, 'register', 'เปิดจากผลตรวจ PM โดย ' || coalesce(me.full_name, '-'));
  update pm_tasks set job_id = jid where id = p_task;
  return v_no;
end $$;

revoke all on function public.pm_generate(int,int), public.pm_submit(uuid,jsonb,text,boolean), public.pm_sign(uuid[],int),
  public.pm_return(uuid,text), public.pm_open_job(uuid) from public, anon;
grant execute on function public.pm_generate(int,int), public.pm_submit(uuid,jsonb,text,boolean), public.pm_sign(uuid[],int),
  public.pm_return(uuid,text), public.pm_open_job(uuid), public.pm_can_head(), public.pm_can_eng(), public.pm_months_for(text,int) to authenticated;

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'pm_tasks') then
    execute 'alter publication supabase_realtime add table public.pm_tasks';
  end if;
end $$;
