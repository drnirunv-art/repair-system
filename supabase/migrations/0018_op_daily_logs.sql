-- Daily operation logs (OP check sheets HC-SD-6846-xx, 24 forms) and the meter registry.
-- A form = the columns of one paper sheet; a point = one machine / panel / meter / sampling spot that uses a form;
-- a log = one day's row for a point. Cumulative readings (kWh, m³, run hours) give the daily use = (today − previous) × multiplier.
-- Additive only.

create table if not exists public.op_forms (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid references public.hospitals(id) on delete cascade,   -- null = central standard for every hospital
  code text not null,
  title text not null,
  fields jsonb not null default '[]',  -- [{"k":key,"l":label,"u":unit,"t":"num"|"ok"|"read"|"text","lo":min,"hi":max,"s":standard text}]
  sort int not null default 0,
  active boolean not null default true
);
create unique index if not exists op_forms_uq on public.op_forms (coalesce(hospital_id, '00000000-0000-0000-0000-000000000000'::uuid), code);
alter table public.op_forms enable row level security;
create policy "op forms read" on public.op_forms for select to authenticated using (hospital_id is null or hospital_id = public.my_hospital());
create policy "op forms hospital add" on public.op_forms for insert to authenticated with check (hospital_id = public.my_hospital() and public.is_manager());
create policy "op forms hospital edit" on public.op_forms for update to authenticated using (hospital_id = public.my_hospital() and public.is_manager()) with check (hospital_id = public.my_hospital());
grant select, insert, update on public.op_forms to authenticated;

create table if not exists public.op_points (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null references public.hospitals(id) on delete cascade,
  form_id uuid not null references public.op_forms(id),
  name text not null,
  building text, floor text, place text,
  equipment_id uuid references public.equipment(id) on delete set null,
  meter_no text,
  multiplier numeric not null default 1,
  brand text, model text, serial text,
  sort int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.op_points enable row level security;
create policy "op points read" on public.op_points for select to authenticated using (hospital_id = public.my_hospital());
create policy "op points add" on public.op_points for insert to authenticated with check (hospital_id = public.my_hospital() and public.is_manager());
create policy "op points edit" on public.op_points for update to authenticated using (hospital_id = public.my_hospital() and public.is_manager()) with check (hospital_id = public.my_hospital());
grant select, insert, update on public.op_points to authenticated;

create table if not exists public.op_logs (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null references public.hospitals(id) on delete cascade,
  point_id uuid not null references public.op_points(id) on delete cascade,
  log_date date not null,
  values jsonb not null default '{}',
  usage jsonb not null default '{}',     -- daily use of each cumulative reading, multiplier applied
  abnormal int not null default 0,
  bad_keys text[] not null default '{}',
  note text,
  logged_by uuid references public.profiles(id),
  logged_at timestamptz not null default now(),
  unique (point_id, log_date)
);
create index if not exists op_logs_hosp_date_idx on public.op_logs (hospital_id, log_date);
alter table public.op_logs enable row level security;
create policy "op logs read" on public.op_logs for select to authenticated using (hospital_id = public.my_hospital());
grant select on public.op_logs to authenticated;

-- save (or correct) one day's row. Checks ranges on the server; a cumulative reading may not go below the previous one.
create or replace function public.op_save(p_point uuid, p_date date, p_values jsonb, p_note text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare pt op_points; f op_forms; fld jsonb; v text; prev jsonb; pv text; bad text[] := '{}'; use jsonb := '{}'; old op_logs;
begin
  select * into pt from op_points where id = p_point and active;
  if pt.id is null or pt.hospital_id <> public.my_hospital() then raise exception 'ไม่พบจุดตรวจ'; end if;
  if public.my_role() = 'observer' then raise exception 'บัญชีผู้ดูบันทึกไม่ได้'; end if;
  if p_date > (now() at time zone 'Asia/Bangkok')::date then raise exception 'บันทึกล่วงหน้าไม่ได้'; end if;
  select * into old from op_logs where point_id = p_point and log_date = p_date;
  if old.id is not null and old.logged_by <> auth.uid() and not public.is_manager() then raise exception 'วันนี้มีคนบันทึกแล้ว ให้หัวหน้าแก้ไข'; end if;
  if p_date < (now() at time zone 'Asia/Bangkok')::date - 3 and not public.is_manager() then raise exception 'ย้อนหลังเกิน 3 วัน ให้หัวหน้าบันทึก'; end if;
  select * into f from op_forms where id = pt.form_id;
  select l.values into prev from op_logs l where l.point_id = p_point and l.log_date < p_date order by l.log_date desc limit 1;
  for fld in select * from jsonb_array_elements(f.fields) loop
    v := nullif(trim(p_values ->> (fld ->> 'k')), '');
    if v is null then continue; end if;
    if fld ->> 't' in ('num','read') then
      if v !~ '^-?[0-9]+(\.[0-9]+)?$' then raise exception '% ต้องเป็นตัวเลข', fld ->> 'l'; end if;
      if fld ->> 't' = 'read' then
        pv := prev ->> (fld ->> 'k');
        if pv is not null and v::numeric < pv::numeric then raise exception '% (%) ต่ำกว่าครั้งก่อน (%) ตรวจเลขอีกครั้ง', fld ->> 'l', v, pv; end if;
        if pv is not null then use := use || jsonb_build_object(fld ->> 'k', round((v::numeric - pv::numeric) * pt.multiplier, 2)); end if;
        if pv is not null and fld ? 'hi' and (v::numeric - pv::numeric) * pt.multiplier > (fld ->> 'hi')::numeric then bad := bad || (fld ->> 'k'); end if;
      elsif (fld ? 'lo' and v::numeric < (fld ->> 'lo')::numeric) or (fld ? 'hi' and v::numeric > (fld ->> 'hi')::numeric) then bad := bad || (fld ->> 'k');
      end if;
    elsif fld ->> 't' = 'ok' then
      if v not in ('/','x') then raise exception '% เลือก / หรือ ×', fld ->> 'l'; end if;
      if v = 'x' then bad := bad || (fld ->> 'k'); end if;
    end if;
  end loop;
  insert into op_logs (hospital_id, point_id, log_date, values, usage, abnormal, bad_keys, note, logged_by, logged_at)
  values (pt.hospital_id, p_point, p_date, p_values, use, coalesce(array_length(bad, 1), 0), bad, nullif(trim(p_note), ''), coalesce(old.logged_by, auth.uid()), now())
  on conflict (point_id, log_date) do update set values = excluded.values, usage = excluded.usage, abnormal = excluded.abnormal,
    bad_keys = excluded.bad_keys, note = excluded.note, logged_at = now();
  return jsonb_build_object('abnormal', coalesce(array_length(bad, 1), 0), 'bad', to_jsonb(bad), 'usage', use);
end $$;
revoke all on function public.op_save(uuid,date,jsonb,text) from public, anon;
grant execute on function public.op_save(uuid,date,jsonb,text) to authenticated;

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'op_logs') then
    execute 'alter publication supabase_realtime add table public.op_logs';
  end if;
end $$;

-- the 24 OP sheets (columns of one machine/point; the "No.1 / No.2" pairs on paper become two points) --------
insert into public.op_forms (hospital_id, code, title, sort, fields)
select null, x.code, x.title, x.sort, x.fields::jsonb from (values
 ('OP-01','ตู้ควบคุมระบบไฟฟ้าหลัก (MDB) · HC-SD-6846-04',1,'[{"k":"vrs","l":"แรงดัน R-S","u":"V","t":"num","lo":380,"hi":400},{"k":"vst","l":"แรงดัน S-T","u":"V","t":"num","lo":380,"hi":400},{"k":"vtr","l":"แรงดัน T-R","u":"V","t":"num","lo":380,"hi":400},{"k":"ar","l":"กระแส R","u":"A","t":"num","hi":800},{"k":"as","l":"กระแส S","u":"A","t":"num","hi":800},{"k":"at","l":"กระแส T","u":"A","t":"num","hi":800},{"k":"kwh","l":"หน่วยสะสม","u":"kWh","t":"read"},{"k":"lamp","l":"หลอดแสดงเฟส R S T","t":"ok","s":"ติดครบ"}]'),
 ('OP-02','ตู้ควบคุมระบบไฟฟ้าหลักฉุกเฉิน (EMDB) · HC-SD-6846-05',2,'[{"k":"vrs","l":"แรงดัน R-S","u":"V","t":"num","lo":380,"hi":400},{"k":"vst","l":"แรงดัน S-T","u":"V","t":"num","lo":380,"hi":400},{"k":"vtr","l":"แรงดัน T-R","u":"V","t":"num","lo":380,"hi":400},{"k":"ar","l":"กระแส R","u":"A","t":"num","hi":800},{"k":"as","l":"กระแส S","u":"A","t":"num","hi":800},{"k":"at","l":"กระแส T","u":"A","t":"num","hi":800},{"k":"kwh","l":"หน่วยสะสม","u":"kWh","t":"read"},{"k":"lamp","l":"หลอดแสดงเฟส R S T","t":"ok","s":"ติดครบ"}]'),
 ('OP-03','สวิตช์โอนแหล่งจ่ายไฟ (ATS)',3,'[{"k":"pos","l":"ตำแหน่งสวิตช์","t":"ok","s":"Auto"},{"k":"lamp","l":"หลอด Normal ติด / Emergency ไม่ติด","t":"ok","s":"ถูกต้อง"},{"k":"vn","l":"แรงดันด้าน Normal","u":"V","t":"num","lo":380,"hi":400},{"k":"vg","l":"แรงดันด้าน Generator (Standby)","u":"V","t":"num","hi":0},{"k":"bat","l":"แบตเตอรี่ชุดควบคุม","u":"V DC","t":"num","lo":24,"hi":26},{"k":"cond","l":"สภาพตู้ ความร้อน เสียง กลิ่น","t":"ok","s":"ปกติ"},{"k":"xfer","l":"เวลา Transfer (ทดสอบรายสัปดาห์)","u":"วินาที","t":"num","hi":10}]'),
 ('OP-04','เครื่องกำเนิดไฟฟ้า (Generator) · HC-SD-6846-09',4,'[{"k":"sw","l":"สถานะสวิตช์ระบบควบคุม","t":"ok","s":"อัตโนมัติ"},{"k":"elec","l":"ระดับน้ำกลั่นแบตเตอรี่","t":"ok","s":"Low–High"},{"k":"bat","l":"แรงดันแบตเตอรี่","u":"V DC","t":"num","lo":24,"hi":26},{"k":"fuel","l":"ระดับน้ำมันเชื้อเพลิง","u":"ลิตร","t":"num"},{"k":"valve","l":"วาล์วจ่ายน้ำมัน","t":"ok","s":"เปิด"},{"k":"oil","l":"ระดับน้ำมันเครื่อง","t":"ok","s":"2 ใน 3"},{"k":"cool","l":"ระดับน้ำหม้อน้ำ","t":"ok","s":"เต็ม"},{"k":"leak","l":"รั่วไหลน้ำมัน / น้ำ","t":"ok","s":"ไม่รั่วไหล"},{"k":"light","l":"ไฟแสงสว่างห้องเครื่อง","t":"ok","s":"ติดทุกดวง"},{"k":"hr","l":"ชั่วโมงทำงาน","u":"hr","t":"read"}]'),
 ('OP-05','เครื่องสูบน้ำดับเพลิง ดีเซล (Diesel Fire Pump)',5,'[{"k":"sw","l":"สวิตช์ควบคุม","t":"ok","s":"Auto"},{"k":"pr","l":"แรงดันระบบท่อดับเพลิง","u":"bar","t":"num","lo":7,"hi":9},{"k":"bat","l":"แรงดันแบตเตอรี่","u":"V DC","t":"num","lo":24,"hi":26},{"k":"fuel","l":"ระดับน้ำมันเชื้อเพลิง","u":"%","t":"num","lo":75},{"k":"oil","l":"ระดับน้ำมันเครื่อง","t":"ok","s":"ระหว่าง Low–High"},{"k":"cool","l":"ระดับน้ำหม้อน้ำ","t":"ok","s":"เต็ม"},{"k":"leak","l":"รั่วไหลน้ำ / น้ำมัน","t":"ok","s":"ไม่รั่วไหล"},{"k":"valve","l":"วาล์วทางดูด-จ่าย","t":"ok","s":"เปิด"},{"k":"lamp","l":"หลอดไฟตู้ควบคุม","t":"ok","s":"ปกติ"},{"k":"hr","l":"ชั่วโมงทำงาน","u":"hr","t":"read"}]'),
 ('OP-06','เครื่องสูบน้ำรักษาแรงดัน (Jockey Pump)',6,'[{"k":"sw","l":"สวิตช์ควบคุม","t":"ok","s":"Auto"},{"k":"set","l":"ค่าตั้ง Start/Stop","u":"bar","t":"text"},{"k":"pr","l":"แรงดันปัจจุบัน","u":"bar","t":"num","lo":7,"hi":8.5},{"k":"amp","l":"กระแส","u":"A","t":"num","hi":8},{"k":"cnt","l":"ตัวนับสตาร์ทสะสม","u":"ครั้ง","t":"read","hi":10},{"k":"seal","l":"รั่วซึมซีล","t":"ok","s":"ไม่รั่วซึม"},{"k":"noise","l":"เสียง / สั่นผิดปกติ","t":"ok","s":"ไม่มี"},{"k":"lamp","l":"หลอดไฟตู้ควบคุม","t":"ok","s":"ปกติ"}]'),
 ('OP-07','เครื่องสูบน้ำดับเพลิงไฟฟ้า (Electrical Fire Pump)',7,'[{"k":"sw","l":"สวิตช์ควบคุม","t":"ok","s":"Auto"},{"k":"pr","l":"แรงดันระบบ","u":"bar","t":"num","lo":7,"hi":9},{"k":"v","l":"แรงดันไฟเข้าตู้","u":"V","t":"num","lo":380,"hi":400},{"k":"ar","l":"กระแสขณะทดสอบ R","u":"A","t":"num","hi":120},{"k":"as","l":"กระแสขณะทดสอบ S","u":"A","t":"num","hi":120},{"k":"at","l":"กระแสขณะทดสอบ T","u":"A","t":"num","hi":120},{"k":"lamp","l":"หลอดไฟตู้ควบคุม","t":"ok","s":"ปกติ"},{"k":"valve","l":"วาล์วทางดูด-จ่าย","t":"ok","s":"เปิด"},{"k":"seal","l":"รั่วซึมซีล","t":"ok","s":"ไม่รั่วซึม"},{"k":"noise","l":"เสียง / สั่น","t":"ok","s":"ไม่มีผิดปกติ"},{"k":"hr","l":"ชั่วโมงทำงาน","u":"hr","t":"read"}]'),
 ('OP-08','ปั๊มจุ่ม บ่อบำบัดน้ำเสีย (Submersible Pump) · HC-SD-6846-13',8,'[{"k":"main","l":"เมนสวิตช์","t":"ok","s":"เปิด"},{"k":"ctl","l":"สวิตช์ควบคุม","t":"ok","s":"อัตโนมัติ"},{"k":"lamp","l":"หลอดแสดงผล","t":"ok","s":"ปกติ"},{"k":"float","l":"ลูกลอย (Float switch)","t":"ok","s":"ทำงานปกติ"},{"k":"amp","l":"กระแส","u":"A","t":"num","hi":12}]'),
 ('OP-09','ปั๊มอัดอากาศบ่อบำบัด (Air Pump / Air Blower)',9,'[{"k":"main","l":"เมนสวิตช์","t":"ok","s":"เปิด"},{"k":"ctl","l":"สวิตช์ควบคุม","t":"ok","s":"Auto"},{"k":"lamp","l":"หลอดแสดงผล","t":"ok","s":"ปกติ"},{"k":"run","l":"สถานะ Run / Standby","t":"text","s":"ตามแผน สลับ"},{"k":"pr","l":"แรงดันลม","u":"bar","t":"num","lo":0.3,"hi":0.6},{"k":"amp","l":"กระแส","u":"A","t":"num","hi":15},{"k":"noise","l":"เสียง / สั่น / ความร้อน","t":"ok","s":"ปกติ"},{"k":"filter","l":"ไส้กรองอากาศ / สายพาน","t":"ok","s":"สะอาด / ตึงปกติ"},{"k":"hr","l":"ชั่วโมงทำงาน","u":"hr","t":"read"}]'),
 ('OP-10','ปั๊มสูบน้ำทิ้ง / บ่อระบายน้ำ / บ่อดักไขมัน (Drainage Pump)',10,'[{"k":"main","l":"เมนสวิตช์","t":"ok","s":"เปิด"},{"k":"ctl","l":"สวิตช์ควบคุม","t":"ok","s":"อัตโนมัติ"},{"k":"lamp","l":"หลอดแสดงผล","t":"ok","s":"ปกติ"},{"k":"amp","l":"กระแส","u":"A","t":"num"},{"k":"level","l":"ระดับน้ำในบ่อ","t":"ok","s":"ปกติ"},{"k":"screen","l":"ตะแกรง / ไขมันสะสม","t":"ok","s":"สะอาด"}]'),
 ('OP-11','ที่จอดรถอัตโนมัติ (Tower Car Park)',11,'[{"k":"ready","l":"พร้อมใช้งาน","t":"ok","s":"พร้อม"},{"k":"run","l":"ทดสอบขึ้น-ลง ไม่มีเสียงผิดปกติ","t":"ok","s":"ผ่าน"},{"k":"safe","l":"เซ็นเซอร์นิรภัย / ประตู","t":"ok","s":"ทำงาน"}]'),
 ('OP-12','เครื่องทำน้ำเย็น (Chiller)',12,'[{"k":"run","l":"สถานะ Run / Standby","t":"text","s":"ตามแผนเดินเครื่อง"},{"k":"chws","l":"CHWS น้ำเย็นออก","u":"°C","t":"num","lo":6,"hi":8},{"k":"chwr","l":"CHWR น้ำเย็นกลับ","u":"°C","t":"num","lo":11,"hi":13},{"k":"cws","l":"CWS น้ำหล่อเย็นเข้า","u":"°C","t":"num","lo":28,"hi":32},{"k":"cwr","l":"CWR น้ำหล่อเย็นออก","u":"°C","t":"num","lo":33,"hi":37},{"k":"pe","l":"แรงดัน Evaporator","u":"bar","t":"num","lo":3,"hi":5},{"k":"pc","l":"แรงดัน Condenser","u":"bar","t":"num","lo":8,"hi":12},{"k":"amp","l":"กระแส / %RLA","u":"A","t":"num","hi":400},{"k":"kw","l":"กำลังไฟฟ้า","u":"kW","t":"num","hi":230},{"k":"hr","l":"ชั่วโมงทำงาน","u":"hr","t":"read"},{"k":"oil","l":"ระดับน้ำมันหล่อลื่น (Sight glass)","t":"ok","s":"ปกติ"},{"k":"alarm","l":"Alarm","t":"ok","s":"ไม่มี"}]'),
 ('OP-13','ปั๊มน้ำหล่อเย็น (Condenser Water Pump — CDP)',13,'[{"k":"ctl","l":"สวิตช์ควบคุม","t":"ok","s":"Auto"},{"k":"run","l":"สถานะ Run / Standby","t":"text","s":"ตามแผน สลับ"},{"k":"amp","l":"กระแส","u":"A","t":"num","hi":40},{"k":"ps","l":"แรงดันทางดูด","u":"bar","t":"num","lo":1,"hi":3},{"k":"pd","l":"แรงดันทางจ่าย","u":"bar","t":"num","lo":3,"hi":6},{"k":"seal","l":"รั่วซึมซีล","t":"ok","s":"ไม่รั่วซึม"},{"k":"noise","l":"เสียง / สั่น / ความร้อนแบริ่ง","t":"ok","s":"ปกติ"},{"k":"hr","l":"ชั่วโมงทำงาน","u":"hr","t":"read"}]'),
 ('OP-14','ปั๊มน้ำเย็นปฐมภูมิ (Primary Chilled Water Pump — PCP)',14,'[{"k":"ctl","l":"สวิตช์ควบคุม","t":"ok","s":"Auto"},{"k":"run","l":"สถานะ Run / Standby","t":"text","s":"ตามแผน สลับ"},{"k":"amp","l":"กระแส","u":"A","t":"num","hi":40},{"k":"ps","l":"แรงดันทางดูด","u":"bar","t":"num","lo":1,"hi":3},{"k":"pd","l":"แรงดันทางจ่าย","u":"bar","t":"num","lo":3,"hi":6},{"k":"seal","l":"รั่วซึมซีล","t":"ok","s":"ไม่รั่วซึม"},{"k":"noise","l":"เสียง / สั่น / ความร้อนแบริ่ง","t":"ok","s":"ปกติ"},{"k":"hr","l":"ชั่วโมงทำงาน","u":"hr","t":"read"}]'),
 ('OP-15','ปั๊มน้ำเย็นทุติยภูมิ (Secondary Chilled Water Pump — SCP)',15,'[{"k":"ctl","l":"สวิตช์ควบคุม","t":"ok","s":"Auto"},{"k":"run","l":"สถานะ Run / Standby","t":"text","s":"ตามแผน"},{"k":"amp","l":"กระแส","u":"A","t":"num","hi":40},{"k":"ps","l":"แรงดันทางดูด","u":"bar","t":"num","lo":1,"hi":3},{"k":"pd","l":"แรงดันทางจ่าย","u":"bar","t":"num","lo":3,"hi":6},{"k":"seal","l":"รั่วซึมซีล","t":"ok","s":"ไม่รั่วซึม"},{"k":"noise","l":"เสียง / สั่น / ความร้อนแบริ่ง","t":"ok","s":"ปกติ"},{"k":"vsd","l":"ความเร็ว VSD","u":"Hz","t":"num","lo":30,"hi":50},{"k":"hr","l":"ชั่วโมงทำงาน","u":"hr","t":"read"}]'),
 ('OP-16','หอผึ่งน้ำ (Cooling Tower)',16,'[{"k":"tin","l":"อุณหภูมิน้ำเข้า","u":"°C","t":"num","lo":33,"hi":37},{"k":"tout","l":"อุณหภูมิน้ำออก","u":"°C","t":"num","lo":28,"hi":32},{"k":"level","l":"ระดับน้ำในอ่าง","t":"ok","s":"ปกติ"},{"k":"float","l":"ลูกลอย / วาล์วน้ำเติม","t":"ok","s":"ทำงาน"},{"k":"fan","l":"พัดลม Run / เสียง / สั่น","t":"ok","s":"เดินปกติ"},{"k":"belt","l":"สายพาน / เกียร์-น้ำมัน","t":"ok","s":"ปกติ"},{"k":"fill","l":"สภาพ Fill / ตะไคร่ / ตะกอน","t":"ok","s":"สะอาด"},{"k":"amp","l":"กระแสมอเตอร์พัดลม","u":"A","t":"num","hi":20},{"k":"tds","l":"TDS / ค่าสารเคมี","u":"ppm","t":"num","hi":1500}]'),
 ('OP-17','ปั๊มส่งน้ำ (Transfer Pump)',17,'[{"k":"mode","l":"โหมด","t":"ok","s":"Auto"},{"k":"run","l":"ตัวที่เดิน Run / Standby","t":"text","s":"ตามแผน สลับ"},{"k":"pr","l":"แรงดันจ่าย","u":"bar","t":"num","lo":3,"hi":5},{"k":"amp","l":"กระแส","u":"A","t":"num","hi":20},{"k":"float","l":"ลูกลอย / สวิตช์ระดับถังสั่งงาน","t":"ok","s":"ทำงาน"},{"k":"seal","l":"รั่วซึม","t":"ok","s":"ไม่รั่วซึม"},{"k":"noise","l":"เสียง / สั่น","t":"ok","s":"ปกติ"},{"k":"hr","l":"ชั่วโมงทำงาน","u":"hr","t":"read"}]'),
 ('OP-18','ปั๊มเพิ่มแรงดัน (Booster Pump)',18,'[{"k":"mode","l":"โหมด","t":"ok","s":"Auto"},{"k":"set","l":"ค่าตั้ง Start/Stop","u":"bar","t":"text"},{"k":"pr","l":"แรงดันปัจจุบัน","u":"bar","t":"num","lo":3,"hi":4.5},{"k":"amp","l":"กระแส","u":"A","t":"num","hi":15},{"k":"vsd","l":"ความเร็ว VSD","u":"Hz","t":"num","lo":30,"hi":50},{"k":"tank","l":"แรงดันลม Pressure tank","u":"bar","t":"num","lo":2.5,"hi":3},{"k":"alt","l":"สลับการทำงาน (Alternate)","t":"ok","s":"สลับตามแผน"},{"k":"seal","l":"รั่วซึม","t":"ok","s":"ไม่รั่วซึม"},{"k":"noise","l":"เสียง / สั่น","t":"ok","s":"ปกติ"}]'),
 ('OP-19','ถังเก็บน้ำ (Roof Tank / Underground Tank)',19,'[{"k":"level","l":"ระดับน้ำ","u":"%","t":"num","lo":50,"hi":100},{"k":"vol","l":"ปริมาตรคงเหลือ","u":"m³","t":"num"},{"k":"float","l":"ลูกลอย / วาล์วเติมอัตโนมัติ","t":"ok","s":"ทำงาน"},{"k":"lid","l":"ฝาปิด / ตะแกรง / กุญแจล็อก","t":"ok","s":"ครบ ปิดล็อก"},{"k":"leak","l":"น้ำล้น / รั่วซึม","t":"ok","s":"ไม่มี"},{"k":"color","l":"สี / กลิ่นน้ำ","t":"ok","s":"ไม่มีผิดปกติ"}]'),
 ('OP-20','ตู้ควบคุมแจ้งเตือนอัคคีภัย (Fire Alarm) · HC-SD-6846-11',20,'[{"k":"panel","l":"สภาพทั่วไปตู้ควบคุม / สวิตช์","t":"ok","s":"ปกติ"},{"k":"dc","l":"ไฟจ่าย DC แบตเตอรี่","u":"V","t":"num","lo":12},{"k":"sup","l":"Supervisory","t":"ok","s":"LED ไม่ติด"},{"k":"trouble","l":"Trouble","t":"ok","s":"ไม่ติด"},{"k":"alarm","l":"Alarm / Silenced","t":"ok","s":"ไม่ติด"},{"k":"monitor","l":"หน้าจอ Monitor","t":"ok","s":"ไม่ชำรุด"},{"k":"btn","l":"ปุ่ม Acknowledge / Silence / Drill","t":"ok","s":"พร้อมใช้งาน"},{"k":"lamp","l":"Test Lamp","t":"ok","s":"LED ติดทุกหลอด"}]'),
 ('OP-21','ลิฟต์โดยสาร (Elevator) · HC-SD-6846-12',21,'[{"k":"phone","l":"โทรศัพท์ฉุกเฉิน","t":"ok","s":"ทำงานปกติ"},{"k":"fan","l":"พัดลมระบายอากาศ","t":"ok","s":"ทำงานปกติ"},{"k":"light","l":"ไฟแสงสว่างห้องโดยสาร","t":"ok","s":"ติดครบ"},{"k":"door","l":"อุปกรณ์จับความเคลื่อนไหวประตู","t":"ok","s":"ทำงานปกติ"},{"k":"btn","l":"ปุ่มกดทำงานถูกต้อง","t":"ok","s":"ถูกต้อง"},{"k":"run","l":"ทดลองวิ่งขึ้น-ลง","t":"ok","s":"ไม่มีเสียงผิดปกติ"},{"k":"box","l":"Switch Box ล็อก","t":"ok","s":"ล็อก"},{"k":"ac","l":"เครื่องปรับอากาศห้องเครื่อง","t":"ok","s":"ทำงานปกติ"},{"k":"room","l":"ความเรียบร้อยห้องเครื่อง","t":"ok","s":"เรียบร้อย"}]'),
 ('OP-22E','มิเตอร์ไฟฟ้าย่อย (Electric Submeter) · HC-SD-6846-06',22,'[{"k":"kwh","l":"พลังงานไฟฟ้ารวม","u":"kWh","t":"read","hi":80}]'),
 ('OP-22W','มิเตอร์น้ำย่อย (Water Submeter) · HC-SD-6846-07',23,'[{"k":"m3","l":"ปริมาณน้ำสะสม","u":"m³","t":"read"}]'),
 ('OP-23','ค่าน้ำ ระบบบ่อบำบัดน้ำเสีย (Wastewater Parameters) · HC-SD-6846-08',24,'[{"k":"ph","l":"pH","t":"num","lo":5,"hi":9},{"k":"cl","l":"Chlorine","u":"mg/L","t":"num","lo":0.5,"hi":1},{"k":"do","l":"DO","u":"mg/L","t":"num","lo":0,"hi":20},{"k":"tds","l":"TDS","u":"ppm","t":"num","lo":0,"hi":500},{"k":"sv30","l":"ค่าตะกอน SV30","u":"%","t":"num"},{"k":"color","l":"สีน้ำ","t":"ok","s":"ปกติ"},{"k":"temp","l":"อุณหภูมิ","u":"°C","t":"num"},{"k":"cltank","l":"ระดับคลอรีนในถังจ่าย","u":"%","t":"num"}]'),
 ('OP-24','พารามิเตอร์น้ำใช้ (Water Quality)',25,'[{"k":"cl","l":"คลอรีนอิสระ","u":"ppm","t":"num","lo":0.2,"hi":0.5},{"k":"ph","l":"pH","t":"num","lo":6.5,"hi":8.5},{"k":"ntu","l":"ความขุ่น","u":"NTU","t":"num","hi":5},{"k":"color","l":"สี / กลิ่น","t":"ok","s":"ไม่มี"},{"k":"temp","l":"อุณหภูมิ","u":"°C","t":"num"}]')
) as x(code, title, sort, fields)
on conflict do nothing;
