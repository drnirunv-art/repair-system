-- 0037: FMS Round in three kinds (document review per ME, field walk per area, tracer that follows the surveyor's path),
-- security gate desk checks, building readiness (8 systems).
-- Add-only: new tables and functions; nothing existing is changed or dropped.

-- who may run FMS rounds: managers and the safety officer of the hospital; 12-hospital executives read only
create or replace function public.fms_can() returns boolean language sql stable security definer set search_path = public as
$$ select coalesce(public.my_role() in ('owner','admin','chief_engineer','supervisor','safety_officer'), false) $$;
grant execute on function public.fms_can() to authenticated;
-- may record FMS rounds for hospital h: the FMS committee of that hospital, or an executive viewer of all 12 hospitals
create or replace function public.fms_in(h uuid) returns boolean language sql stable security definer set search_path = public as
$$ select h is not null and ((h = public.my_hospital() and public.fms_can()) or public.am_exec()) $$;
grant execute on function public.fms_in(uuid) to authenticated;

-- check-list items: hospital_id null = central standard form; a hospital that uploads its own form (per kind) uses its own rows
create table if not exists public.fms_items (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid references public.hospitals(id) on delete cascade,
  kind text not null default 'walk' check (kind in ('doc','walk','tracer')),
  cat text not null, cat_name text not null, no int not null, text text not null,
  ref text,                                  -- JCI 8th standard + ME the item checks, e.g. 'FMS.06.01 ME 3' (see fms_me)
  red boolean not null default false,        -- high-risk point (JCI 8th high-risk checkpoints / SAF Zero-Red): shown red, counted apart
  active boolean not null default true
);
create index if not exists fms_items_h_idx on public.fms_items (hospital_id, kind, cat, no);

create table if not exists public.fms_rounds (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null references public.hospitals(id) on delete cascade,
  year_be int not null, no int not null, title text,
  status text not null default 'open' check (status in ('open','closed')),
  created_by uuid references public.profiles(id) default auth.uid(), created_at timestamptz not null default now(),
  unique (hospital_id, year_be, no)
);

create table if not exists public.fms_checks (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.fms_rounds(id) on delete cascade,
  hospital_id uuid not null references public.hospitals(id) on delete cascade,
  kind text not null default 'walk' check (kind in ('doc','walk','tracer')),
  area text not null, cat text not null,   -- area: the area walked / the document owner / the tracer target (machine TAG, permit no., unit)
  assessor text not null, assessor_phone text,
  answers jsonb not null default '[]',   -- [{id, t, c: ME, r: high-risk, v: pass|part|fail|na, n: detail, na: reason, ph: [paths]}]
  ack_name text, ack_at timestamptz,
  pass int not null default 0, part int not null default 0, fail int not null default 0, na int not null default 0, score numeric,
  created_by uuid references public.profiles(id) default auth.uid(), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (round_id, kind, area, cat)
);

create table if not exists public.fms_findings (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null references public.hospitals(id) on delete cascade,
  round_id uuid references public.fms_rounds(id) on delete cascade,
  check_id uuid references public.fms_checks(id) on delete cascade,
  kind text not null default 'walk',
  item_id uuid, cat text, area text not null, title text not null, detail text,
  photos text[] not null default '{}', after_photos text[] not null default '{}', close_note text,
  free boolean not null default false, repeat_n int not null default 0,
  status text not null default 'open' check (status in ('open','done')),
  job_id uuid references public.jobs(id),
  created_by uuid references public.profiles(id) default auth.uid(), created_at timestamptz not null default now(),
  closed_by uuid references public.profiles(id), closed_at timestamptz
);
create index if not exists fms_findings_h_idx on public.fms_findings (hospital_id, status, created_at desc);

alter table public.fms_items enable row level security;
alter table public.fms_rounds enable row level security;
alter table public.fms_checks enable row level security;
alter table public.fms_findings enable row level security;
create policy "fms items read" on public.fms_items for select to authenticated using (hospital_id is null or hospital_id = public.my_hospital() or public.am_exec());
create policy "fms rounds read" on public.fms_rounds for select to authenticated using ((hospital_id = public.my_hospital() and public.fms_can()) or public.am_exec());
create policy "fms checks read" on public.fms_checks for select to authenticated using ((hospital_id = public.my_hospital() and public.fms_can()) or public.am_exec());
create policy "fms findings read" on public.fms_findings for select to authenticated using ((hospital_id = public.my_hospital() and public.fms_can()) or public.am_exec());
grant select on public.fms_items, public.fms_rounds, public.fms_checks, public.fms_findings to authenticated;

create or replace function public.fms_round_open(p_year_be int, p_no int, p_title text default null, p_hospital uuid default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v uuid; h uuid := coalesce(p_hospital, public.my_hospital());
begin
  if not public.fms_in(h) then raise exception 'เฉพาะหัวหน้า / Admin / จป. ของโรงพยาบาลนี้ หรือผู้บริหาร 12 โรง เปิดรอบตรวจได้'; end if;
  if p_year_be is null or p_year_be < 2560 or p_year_be > 2650 then raise exception 'ใส่ปีเป็น พ.ศ. เช่น 2569'; end if;
  if p_no is null or p_no < 1 or p_no > 24 then raise exception 'ครั้งที่ต้องอยู่ระหว่าง 1–24'; end if;
  insert into fms_rounds (hospital_id, year_be, no, title) values (h, p_year_be, p_no, nullif(trim(coalesce(p_title, '')), ''))
    on conflict (hospital_id, year_be, no) do nothing returning id into v;
  if v is null then raise exception 'มีรอบ % ครั้งที่ % อยู่แล้ว', p_year_be, p_no; end if;
  return v;
end $$;

create or replace function public.fms_round_status(p_round uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_status not in ('open','closed') then raise exception 'สถานะไม่ถูกต้อง'; end if;
  update fms_rounds set status = p_status where id = p_round and public.fms_in(hospital_id);
  if not found then raise exception 'ไม่พบรอบตรวจ'; end if;
end $$;

-- save one category of one area / document set / tracer target. Every item answered.
-- walk + tracer: fail needs detail + photo. doc: part (incomplete / out of date) or fail (missing) needs a note of what is missing.
-- N/A needs a reason. Score = (pass + ½ part) ÷ (pass + part + fail) × 100, like Met 10 / Partially Met 5 / Not Met 0.
-- Failed (and partial) items become findings; "repeat" counts earlier rounds where the same target failed the same item.
create or replace function public.fms_save(p_round uuid, p_kind text, p_area text, p_cat text, p_assessor text, p_phone text, p_answers jsonb, p_ack text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r fms_rounds; cid uuid; a jsonb; np int := 0; npt int := 0; nf int := 0; nn int := 0; v text; rep int; want int; sc numeric;
begin
  if p_kind is null or p_kind not in ('doc','walk','tracer') then raise exception 'ประเภทการตรวจไม่ถูกต้อง'; end if;
  select * into r from fms_rounds where id = p_round;
  if r.id is null or not public.fms_in(r.hospital_id) then raise exception 'ไม่พบรอบตรวจ หรือไม่มีสิทธิ์บันทึกผลของโรงพยาบาลนี้'; end if;
  if r.status <> 'open' then raise exception 'รอบตรวจนี้ปิดแล้ว'; end if;
  if coalesce(trim(p_area), '') = '' then raise exception '%', case p_kind when 'doc' then 'ใส่หน่วยงานเจ้าของเอกสาร' when 'tracer' then 'ใส่เป้าหมายที่ตามรอย (เครื่อง / ใบอนุญาต / หน่วยงาน)' else 'เลือกพื้นที่ที่ตรวจ' end; end if;
  if coalesce(trim(p_assessor), '') = '' or coalesce(trim(p_phone), '') = '' then raise exception 'ใส่ชื่อและเบอร์โทรผู้ประเมิน'; end if;
  if jsonb_typeof(p_answers) <> 'array' or jsonb_array_length(p_answers) = 0 then raise exception 'ไม่มีข้อตรวจ'; end if;
  select count(*) into want from fms_items i where i.kind = p_kind and i.cat = p_cat and i.active
    and i.hospital_id is not distinct from (case when exists (select 1 from fms_items x where x.hospital_id = r.hospital_id and x.kind = p_kind and x.active) then r.hospital_id end);
  -- every item of this form (kind + category) must be answered, by its own id
  if (select count(distinct x ->> 'id') from jsonb_array_elements(p_answers) x join fms_items i on i.id::text = x ->> 'id'
      where i.kind = p_kind and i.cat = p_cat and i.active) < want then raise exception 'ตอบให้ครบทุกข้อก่อนบันทึก'; end if;
  for a in select * from jsonb_array_elements(p_answers) loop
    v := a ->> 'v';
    if v = 'pass' then np := np + 1;
    elsif v in ('fail', 'part') then
      if v = 'part' and p_kind <> 'doc' then raise exception 'ตอบได้เฉพาะ ผ่าน / ไม่ผ่าน / ไม่เกี่ยว'; end if;
      if coalesce(trim(a ->> 'n'), '') = '' then raise exception 'ข้อ "%": ต้องกรอกรายละเอียดสิ่งที่พบ/ที่ขาด', left(a ->> 't', 90); end if;
      if p_kind <> 'doc' and coalesce(jsonb_array_length(a -> 'ph'), 0) = 0 then raise exception 'ข้อ "%" ไม่ผ่าน: ต้องแนบรูปอย่างน้อย 1 รูป', left(a ->> 't', 90); end if;
      if coalesce(jsonb_array_length(a -> 'ph'), 0) > 10 then raise exception 'แนบรูปได้ไม่เกิน 10 รูปต่อข้อ'; end if;
      if v = 'part' then npt := npt + 1; else nf := nf + 1; end if;
    elsif v = 'na' then
      if coalesce(trim(a ->> 'na'), '') = '' then raise exception 'ข้อ "%" ไม่เกี่ยว: เลือกเหตุผล', left(a ->> 't', 90); end if;
      nn := nn + 1;
    else raise exception 'ตอบให้ครบทุกข้อก่อนบันทึก'; end if;
  end loop;
  sc := case when np + npt + nf > 0 then round((np + npt * 0.5) * 100.0 / (np + npt + nf), 1) end;
  insert into fms_checks (round_id, hospital_id, kind, area, cat, assessor, assessor_phone, answers, ack_name, ack_at, pass, part, fail, na, score)
  values (r.id, r.hospital_id, p_kind, trim(p_area), p_cat, trim(p_assessor), trim(p_phone), p_answers, nullif(trim(coalesce(p_ack, '')), ''), case when nullif(trim(coalesce(p_ack, '')), '') is not null then now() end,
    np, npt, nf, nn, sc)
  on conflict (round_id, kind, area, cat) do update set assessor = excluded.assessor, assessor_phone = excluded.assessor_phone, answers = excluded.answers,
    ack_name = coalesce(excluded.ack_name, fms_checks.ack_name), ack_at = coalesce(excluded.ack_at, fms_checks.ack_at),
    pass = excluded.pass, part = excluded.part, fail = excluded.fail, na = excluded.na, score = excluded.score, updated_at = now()
  returning id into cid;
  -- findings: drop open, untouched findings whose item no longer fails; add new ones
  delete from fms_findings f where f.check_id = cid and f.status = 'open' and f.job_id is null
    and not exists (select 1 from jsonb_array_elements(p_answers) x where x ->> 'v' in ('fail', 'part') and (x ->> 'id')::uuid = f.item_id);
  for a in select * from jsonb_array_elements(p_answers) x where x ->> 'v' in ('fail', 'part') loop
    if not exists (select 1 from fms_findings where check_id = cid and item_id = (a ->> 'id')::uuid) then
      select count(distinct c.round_id) into rep from fms_checks c join fms_rounds rr on rr.id = c.round_id
        where c.hospital_id = r.hospital_id and c.kind = p_kind and c.area = trim(p_area) and c.round_id <> r.id and (rr.year_be, rr.no) < (r.year_be, r.no)
          and exists (select 1 from jsonb_array_elements(c.answers) y where y ->> 'v' in ('fail', 'part') and y ->> 'id' = a ->> 'id');
      insert into fms_findings (hospital_id, round_id, check_id, kind, item_id, cat, area, title, detail, photos, repeat_n)
      values (r.hospital_id, r.id, cid, p_kind, (a ->> 'id')::uuid, p_cat, trim(p_area), a ->> 't', a ->> 'n',
        coalesce((select array_agg(x) from jsonb_array_elements_text(a -> 'ph') x), '{}'), rep);
    else
      update fms_findings set detail = a ->> 'n', photos = coalesce((select array_agg(x) from jsonb_array_elements_text(a -> 'ph') x), '{}')
        where check_id = cid and item_id = (a ->> 'id')::uuid and status = 'open';
    end if;
  end loop;
  return jsonb_build_object('id', cid, 'pass', np, 'part', npt, 'fail', nf, 'na', nn, 'score', sc);
end $$;

-- free report (no check-list): walk-through, defect, something seen on the way
create or replace function public.fms_free(p_round uuid, p_area text, p_title text, p_detail text, p_photos text[]) returns uuid
language plpgsql security definer set search_path = public as $$
declare v uuid; h uuid := public.my_hospital();
begin
  if coalesce(trim(p_area), '') = '' or coalesce(trim(p_title), '') = '' then raise exception 'เลือกพื้นที่และใส่หัวข้อสิ่งที่พบ'; end if;
  if p_round is not null then select hospital_id into h from fms_rounds where id = p_round; if h is null then raise exception 'ไม่พบรอบตรวจ'; end if; end if;
  if not public.fms_in(h) then raise exception 'ไม่มีสิทธิ์'; end if;
  insert into fms_findings (hospital_id, round_id, area, title, detail, photos, free)
  values (h, p_round, trim(p_area), trim(p_title), nullif(trim(coalesce(p_detail, '')), ''), coalesce(p_photos, '{}'), true) returning id into v;
  return v;
end $$;

-- send a finding into the normal repair queue (once per finding)
create or replace function public.fms_to_job(p_id uuid) returns text
language plpgsql security definer set search_path = public as $$
declare f fms_findings; h hospitals; per text; n int; v_no text; jid uuid; prio uuid; me profiles;
begin
  select * into f from fms_findings where id = p_id for update;
  if f.id is null or not public.fms_in(f.hospital_id) then raise exception 'ไม่พบรายการ หรือไม่มีสิทธิ์'; end if;
  if f.job_id is not null then select job_no into v_no from jobs where id = f.job_id; return v_no; end if;
  select * into h from hospitals where id = f.hospital_id;
  select * into me from profiles where id = auth.uid();
  per := to_char((now() at time zone 'Asia/Bangkok') + interval '543 years', 'YYMM');
  insert into job_counters (hospital_id, period, last_no) values (h.id, per, 1)
    on conflict (hospital_id, period) do update set last_no = job_counters.last_no + 1 returning last_no into n;
  v_no := h.code || '-' || per || '-' || lpad(n::text, 4, '0');
  select id into prio from priorities where hospital_id = h.id and is_default limit 1;
  insert into jobs (job_no, hospital_id, department, detail, reporter_name, reporter_phone, photo_paths, priority_id)
  values (v_no, h.id, f.area, '[FMS Round] ' || f.title || coalesce(E'\n' || f.detail, ''), coalesce(me.full_name, 'FMS Round'), 'FMS', f.photos, prio)
  returning id into jid;
  insert into job_events (job_id, status, note) values (jid, 'register', 'เปิดจาก FMS Round โดย ' || coalesce(me.full_name, '-'));
  update fms_findings set job_id = jid where id = f.id;
  return v_no;
end $$;

-- close with an after-photo; a missing document can instead be closed with a note naming the document now in place
create or replace function public.fms_close(p_id uuid, p_after text[], p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare k text;
begin
  select kind into k from fms_findings where id = p_id and public.fms_in(hospital_id);
  if coalesce(array_length(p_after, 1), 0) = 0 and not (k = 'doc' and coalesce(trim(p_note), '') <> '') then
    raise exception '%', case when k = 'doc' then 'ปิดงานต้องแนบรูป/ไฟล์เอกสาร หรือเขียนว่าเอกสารฉบับไหนพร้อมแล้ว' else 'ปิดงานต้องแนบรูปหลังแก้ไขอย่างน้อย 1 รูป' end; end if;
  update fms_findings set status = 'done', after_photos = coalesce(p_after, '{}'), close_note = nullif(trim(coalesce(p_note, '')), ''), closed_by = auth.uid(), closed_at = now()
    where id = p_id and public.fms_in(hospital_id) and status = 'open';
  if not found then raise exception 'ไม่พบรายการ หรือปิดไปแล้ว'; end if;
end $$;

-- replace this hospital's own check-list of one kind (from Excel). Empty array = go back to the central standard form of that kind.
create or replace function public.fms_items_replace(p_kind text, p_rows jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare h uuid := public.my_hospital(); n int;
begin
  if h is null or not public.is_manager() then raise exception 'เฉพาะหัวหน้า / Admin แก้แบบฟอร์มได้'; end if;
  if p_kind is null or p_kind not in ('doc','walk','tracer') then raise exception 'ประเภทการตรวจไม่ถูกต้อง'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 500 then raise exception 'ข้อมูลไม่ถูกต้อง (ไม่เกิน 500 ข้อ)'; end if;
  if exists (select 1 from jsonb_array_elements(p_rows) x where coalesce(trim(x ->> 'cat'), '') = '' or coalesce(trim(x ->> 'text'), '') = '') then raise exception 'ทุกแถวต้องมีรหัสหมวดและข้อความ'; end if;
  update fms_items set active = false where hospital_id = h and kind = p_kind and active;
  insert into fms_items (hospital_id, kind, cat, cat_name, no, text, ref, red)
  select h, p_kind, trim(x ->> 'cat'), coalesce(nullif(trim(x ->> 'cat_name'), ''), trim(x ->> 'cat')), coalesce(nullif(x ->> 'no', '')::int, row_number() over ()), trim(x ->> 'text'),
    nullif(trim(coalesce(x ->> 'ref', '')), ''), coalesce(lower(trim(x ->> 'red')) in ('true','1','y','yes','ใช่','x','✓'), false)
  from jsonb_array_elements(p_rows) x;
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.fms_round_open(int,int,text,uuid), public.fms_round_status(uuid,text), public.fms_save(uuid,text,text,text,text,text,jsonb,text),
  public.fms_free(uuid,text,text,text,text[]), public.fms_to_job(uuid), public.fms_close(uuid,text[],text), public.fms_items_replace(text,jsonb) from public, anon;
grant execute on function public.fms_round_open(int,int,text,uuid), public.fms_round_status(uuid,text), public.fms_save(uuid,text,text,text,text,text,jsonb,text),
  public.fms_free(uuid,text,text,text,text[]), public.fms_to_job(uuid), public.fms_close(uuid,text[],text), public.fms_items_replace(text,jsonb) to authenticated;

-- security gate desk: same badge log as wp_gate, with the checks the desk needs
create or replace function public.wp_gate_checkin(p_permit uuid, p_worker text, p_badge text) returns uuid
language plpgsql security definer set search_path = public as $$
declare p wp_permits; d date := (now() at time zone 'Asia/Bangkok')::date; v uuid;
begin
  select * into p from wp_permits where id = p_permit and hospital_id = public.my_hospital();
  if p.id is null or public.my_role() is null or public.my_role() = 'observer' then raise exception 'ไม่มีสิทธิ์'; end if;
  if p.status not in ('approved','working','fix') then raise exception 'ใบอนุญาตนี้ยังไม่ได้รับอนุมัติให้เข้าพื้นที่ หรือหมดสิทธิ์แล้ว'; end if;
  if p.start_date is not null and d < p.start_date then raise exception 'ใบอนุญาตเริ่มวันที่ % ยังเข้าไม่ได้', to_char(p.start_date, 'DD/MM/') || (extract(year from p.start_date)::int + 543); end if;
  if p.end_date is not null and d > p.end_date then raise exception 'ใบอนุญาตหมดอายุแล้ว (ถึง %)', to_char(p.end_date, 'DD/MM/') || (extract(year from p.end_date)::int + 543); end if;
  if coalesce(trim(p_worker), '') = '' then raise exception 'เลือกชื่อผู้เข้าพื้นที่'; end if;
  if coalesce(trim(p_badge), '') = '' then raise exception 'ใส่เลขบัตรที่แลกให้'; end if;
  if exists (select 1 from wp_gate g join wp_permits x on x.id = g.permit_id where x.hospital_id = p.hospital_id and g.out_at is null and lower(trim(g.worker)) = lower(trim(p_worker))) then
    raise exception '% ยังไม่ได้เช็คเอาต์ครั้งก่อน', trim(p_worker); end if;
  if exists (select 1 from wp_gate g join wp_permits x on x.id = g.permit_id where x.hospital_id = p.hospital_id and g.out_at is null and lower(trim(g.badge)) = lower(trim(p_badge))) then
    raise exception 'บัตรเลข % ยังไม่ได้คืน ใช้บัตรใบอื่น', trim(p_badge); end if;
  insert into wp_gate (permit_id, worker, badge) values (p.id, trim(p_worker), trim(p_badge)) returning id into v;
  return v;
end $$;
revoke all on function public.wp_gate_checkin(uuid, text, text) from public, anon;
grant execute on function public.wp_gate_checkin(uuid, text, text) to authenticated;

-- building readiness: 8 standard systems per building, confirmed by chief / supervisor / admin / owner
create table if not exists public.building_ready (
  hospital_id uuid not null references public.hospitals(id) on delete cascade,
  building text not null, system text not null,
  state text not null check (state in ('ok','bad')),
  notes text[] not null default '{}',
  by_id uuid references public.profiles(id), by_name text, at timestamptz not null default now(),
  primary key (hospital_id, building, system)
);
alter table public.building_ready enable row level security;
create policy "building ready read" on public.building_ready for select to authenticated using (hospital_id = public.my_hospital() or public.am_exec());
grant select on public.building_ready to authenticated;

create or replace function public.ready_set(p_building text, p_system text, p_state text, p_notes text[] default '{}') returns void
language plpgsql security definer set search_path = public as $$
declare h uuid := public.my_hospital(); nm text; ns text[];
begin
  if h is null or not public.is_manager() then raise exception 'เฉพาะ Chief / Supervisor / Admin ยืนยันความพร้อมได้'; end if;
  if p_system not in ('electric','comm','special','hvac','lift','fire','sanitary','civil') then raise exception 'ระบบไม่ถูกต้อง'; end if;
  if coalesce(trim(p_building), '') = '' then raise exception 'เลือกอาคาร'; end if;
  if p_state is null then delete from building_ready where hospital_id = h and building = trim(p_building) and system = p_system; return; end if;
  if p_state not in ('ok','bad') then raise exception 'สถานะไม่ถูกต้อง'; end if;
  select coalesce(array_agg(trim(x)) filter (where coalesce(trim(x), '') <> ''), '{}') into ns from unnest(coalesce(p_notes, '{}')) x;
  if p_state = 'bad' and cardinality(ns) = 0 then raise exception 'ไม่พร้อม: ต้องกรอกหมายเหตุว่าไม่พร้อมเพราะอะไร'; end if;
  select full_name into nm from profiles where id = auth.uid();
  insert into building_ready (hospital_id, building, system, state, notes, by_id, by_name, at)
  values (h, trim(p_building), p_system, p_state, case when p_state = 'bad' then ns else '{}' end, auth.uid(), nm, now())
  on conflict (hospital_id, building, system) do update set state = excluded.state, notes = excluded.notes, by_id = excluded.by_id, by_name = excluded.by_name, at = now();
end $$;
revoke all on function public.ready_set(text, text, text, text[]) from public, anon;
grant execute on function public.ready_set(text, text, text, text[]) to authenticated;

-- JCI 8th measurable elements used by the forms: code + a short Thai heading (own wording, not the standard's text).
-- Every form groups its items by FMS category and, inside a category, by ME.
create table if not exists public.fms_me (code text primary key, std text not null, me int not null, text text not null);
alter table public.fms_me enable row level security;
create policy "fms me read" on public.fms_me for select to authenticated using (true);
grant select on public.fms_me to authenticated;
insert into public.fms_me (code, std, me, text) values
  ('FMS.01.00 ME 1', 'FMS.01.00', 1, 'ปฏิบัติตามกฎหมาย ระเบียบ และมาตรฐานอาคาร/อัคคีภัยที่เกี่ยวข้อง'),
  ('FMS.01.00 ME 2', 'FMS.01.00', 2, 'มีเอกสารการแก้ไขตามผลตรวจของหน่วยงานภายนอก'),
  ('FMS.01.00 ME 3', 'FMS.01.00', 3, 'วางแผนและงบประมาณทดแทน/ปรับปรุงอาคาร ระบบ และอุปกรณ์'),
  ('FMS.01.00 ME 4', 'FMS.01.00', 4, 'อาคารใช้ร่วม: มีหลักฐานการปฏิบัติตามข้อกำหนดของระบบที่ใช้ร่วม'),
  ('FMS.01.01 ME 1', 'FMS.01.01', 1, 'มอบหมายผู้มีคุณสมบัติกำกับงาน FMS และมีหลักฐานประสบการณ์/การอบรม'),
  ('FMS.01.01 ME 2', 'FMS.01.01', 2, 'ผู้รับผิดชอบดูแลทรัพยากร โครงการ FMS การอบรม และการติดตามผล'),
  ('FMS.02.00 ME 1', 'FMS.02.00', 1, 'ประเมินความเสี่ยง FMS ประจำปีครบ 8 ด้าน'),
  ('FMS.02.00 ME 2', 'FMS.02.00', 2, 'จัดลำดับความเสี่ยง กำหนดเป้าหมาย และดำเนินการปรับปรุง'),
  ('FMS.02.00 ME 3', 'FMS.02.00', 3, 'ประเมินประสิทธิผลของการปรับปรุง และปรับโครงการ FMS ตามผล'),
  ('FMS.03.00 ME 1', 'FMS.03.00', 1, 'มีโครงการความปลอดภัยของสถานที่เป็นลายลักษณ์อักษรและนำไปปฏิบัติ'),
  ('FMS.03.00 ME 2', 'FMS.03.00', 2, 'ตรวจความปลอดภัยของสถานที่จริงเป็นปัจจุบัน และนำผลไปจัดการความเสี่ยง'),
  ('FMS.04.00 ME 1', 'FMS.04.00', 1, 'มีโครงการรักษาความปลอดภัยเป็นลายลักษณ์อักษรและนำไปปฏิบัติ'),
  ('FMS.04.00 ME 2', 'FMS.04.00', 2, 'ระบุพื้นที่เสี่ยงและพื้นที่หวงห้าม เฝ้าระวังและควบคุมให้ปลอดภัย'),
  ('FMS.04.00 ME 4', 'FMS.04.00', 4, 'อุปกรณ์และระบบรักษาความปลอดภัยได้รับการตรวจ ประเมิน และบำรุงรักษา'),
  ('FMS.05.00 ME 1', 'FMS.05.00', 1, 'มีโครงการจัดการวัสดุอันตรายและของเสียเป็นลายลักษณ์อักษรและนำไปปฏิบัติ'),
  ('FMS.05.00 ME 2', 'FMS.05.00', 2, 'มีบัญชีชนิด ปริมาณ และที่เก็บวัสดุอันตรายครบ ทบทวนอย่างน้อยปีละครั้ง'),
  ('FMS.05.00 ME 3', 'FMS.05.00', 3, 'ติดฉลาก จัดการ จัดเก็บ และใช้วัสดุอันตรายอย่างปลอดภัยตาม SDS'),
  ('FMS.05.00 ME 5', 'FMS.05.00', 5, 'มีขั้นตอนจัดการการหกรั่วไหลและการสัมผัส ใช้ PPE ถูกต้อง และรายงานเหตุ'),
  ('FMS.06.00 ME 1', 'FMS.06.00', 1, 'มีโครงการอัคคีภัยเป็นลายลักษณ์อักษร ปกป้องผู้อยู่ในอาคารจากไฟและควัน'),
  ('FMS.06.00 ME 2', 'FMS.06.00', 2, 'ใช้มาตรการชั่วคราว (ILSM) เมื่อยังแก้ความเสี่ยงอัคคีภัยไม่ได้ทันที'),
  ('FMS.06.00 ME 3', 'FMS.06.00', 3, 'ประเมินความเสี่ยงอัคคีภัย: การแบ่งกั้นไฟ/ควัน พื้นที่อันตราย เหนือฝ้า'),
  ('FMS.06.01 ME 1', 'FMS.06.01', 1, 'มีอุปกรณ์/ระบบตรวจจับและแจ้งเหตุไฟและควันตั้งแต่เริ่มต้น'),
  ('FMS.06.01 ME 2', 'FMS.06.01', 2, 'มีอุปกรณ์/ระบบดับเพลิง'),
  ('FMS.06.01 ME 3', 'FMS.06.01', 3, 'ออกจากอาคารได้ปลอดภัย ทางหนีไฟโล่งไม่มีสิ่งกีดขวาง'),
  ('FMS.06.01 ME 4', 'FMS.06.01', 4, 'ป้ายทางออกมองเห็นชัดและเข้าใจได้'),
  ('FMS.06.01 ME 5', 'FMS.06.01', 5, 'มีไฟส่องสว่างฉุกเฉินที่ทางเดินและบันไดหนีไฟ'),
  ('FMS.06.01 ME 6', 'FMS.06.01', 6, 'การกั้นไฟและควัน (Fire-stop ประตูทนไฟ) ได้รับการดูแลให้ได้ผล'),
  ('FMS.06.02 ME 1', 'FMS.06.02', 1, 'ตรวจ ประเมิน และบำรุงรักษาอุปกรณ์ดับเพลิงทุกชนิดตามผู้ผลิต/กฎหมาย'),
  ('FMS.06.02 ME 2', 'FMS.06.02', 2, 'มีเอกสารการตรวจ ทดสอบ บำรุงรักษา ผล และการแก้ไข'),
  ('FMS.06.02 ME 3', 'FMS.06.02', 3, 'ข้อบกพร่องของระบบดับเพลิงแก้ทันที หรือมีมาตรการชั่วคราวลดความเสี่ยง'),
  ('FMS.07.00 ME 1', 'FMS.07.00', 1, 'มีโครงการจัดการเครื่องมือแพทย์ทั้งของโรงพยาบาลและที่เช่า/ยืม'),
  ('FMS.07.00 ME 2', 'FMS.07.00', 2, 'มีทะเบียน ตรวจ ทดสอบ บำรุงรักษา และบันทึกผลเครื่องมือแพทย์'),
  ('FMS.07.00 ME 3', 'FMS.07.00', 3, 'กำหนดเป้าหมาย ติดตามข้อมูล และปรับปรุงเพื่อลดความเสี่ยงเครื่องมือแพทย์'),
  ('FMS.07.01 ME 1', 'FMS.07.01', 1, 'มีกระบวนการติดตามประกาศอันตราย การเรียกคืน อุบัติการณ์ และการชำรุด'),
  ('FMS.07.01 ME 3', 'FMS.07.01', 3, 'จัดการการใช้เครื่องที่มีปัญหา ชำรุด ถูกประกาศอันตราย หรือถูกเรียกคืน'),
  ('FMS.08.00 ME 1', 'FMS.08.00', 1, 'มีโครงการจัดการระบบสาธารณูปโภคเป็นลายลักษณ์อักษรและนำไปปฏิบัติ'),
  ('FMS.08.00 ME 2', 'FMS.08.00', 2, 'กำหนดเป้าหมาย ติดตามข้อมูล และปรับปรุงเพื่อลดความเสี่ยงระบบสาธารณูปโภค'),
  ('FMS.08.00 ME 3', 'FMS.08.00', 3, 'มีบัญชีส่วนประกอบและผังการจ่ายของระบบสาธารณูปโภคเป็นปัจจุบัน'),
  ('FMS.08.00 ME 4', 'FMS.08.00', 4, 'กำหนดกิจกรรมและรอบการตรวจ บำรุงรักษาระบบสาธารณูปโภคทุกส่วน'),
  ('FMS.08.00 ME 5', 'FMS.08.00', 5, 'ติดป้ายจุดควบคุมระบบสาธารณูปโภคเพื่อปิดฉุกเฉินได้'),
  ('FMS.08.01 ME 1', 'FMS.08.01', 1, 'มีไฟฟ้า น้ำ และก๊าซทางการแพทย์สำรองตลอด 24 ชั่วโมง 7 วัน'),
  ('FMS.08.01 ME 2', 'FMS.08.01', 2, 'ทดสอบแหล่งน้ำสำรองอย่างน้อยปีละครั้ง และบันทึกผล'),
  ('FMS.08.01 ME 3', 'FMS.08.01', 3, 'ทดสอบแหล่งไฟฟ้าสำรองอย่างน้อยทุกไตรมาส และบันทึกผล'),
  ('FMS.08.02 ME 1', 'FMS.08.02', 1, 'ตรวจคุณภาพน้ำดื่มอย่างน้อยทุกไตรมาส และบันทึกผล'),
  ('FMS.08.02 ME 2', 'FMS.08.02', 2, 'ตรวจคุณภาพน้ำที่ไม่ใช่น้ำดื่มอย่างน้อยทุก 6 เดือน และบันทึกผล'),
  ('FMS.08.02 ME 3', 'FMS.08.02', 3, 'มีมาตรการป้องกันการปนเปื้อนและการเติบโตของเชื้อในระบบน้ำ'),
  ('FMS.08.02 ME 4', 'FMS.08.02', 4, 'ท่อน้ำยูนิตทำฟันได้รับการบำบัดและทดสอบตามผู้ผลิต'),
  ('FMS.08.03 ME 1', 'FMS.08.03', 1, 'บริการไตเทียมปฏิบัติตามมาตรฐานคุณภาพน้ำและการป้องกันการติดเชื้อ'),
  ('FMS.08.03 ME 2', 'FMS.08.03', 2, 'ตรวจน้ำไตเทียม: เชื้อและ Endotoxin รายเดือน สารเคมีรายปี บันทึกผล'),
  ('FMS.08.03 ME 3', 'FMS.08.03', 3, 'ฆ่าเชื้อระบบจ่ายน้ำไตเทียมตามรอบ'),
  ('FMS.08.03 ME 4', 'FMS.08.03', 4, 'ทดสอบเครื่องไตเทียมทุกเครื่องปีละครั้ง รวมเครื่องที่ไม่ได้ใช้'),
  ('FMS.08.04 ME 1', 'FMS.08.04', 1, 'เดินและบำรุงรักษาระบบห้องแรงดันลบ/บวกตามกฎหมายและมาตรฐาน'),
  ('FMS.08.04 ME 2', 'FMS.08.04', 2, 'ควบคุมอุณหภูมิน้ำ ไอน้ำ และอื่น ๆ ตามมาตรฐาน'),
  ('FMS.08.04 ME 3', 'FMS.08.04', 3, 'ควบคุมการไหลของอากาศ การระบายอากาศ และความชื้นเพื่อลดการติดเชื้อ'),
  ('FMS.09.00 ME 1', 'FMS.09.00', 1, 'มีโครงการจัดการภาวะฉุกเฉินและภัยพิบัติเป็นลายลักษณ์อักษร'),
  ('FMS.09.00 ME 2', 'FMS.09.00', 2, 'ระบุภาวะฉุกเฉินและภัยพิบัติสำคัญตามที่ตั้งของโรงพยาบาล'),
  ('FMS.09.00 ME 3', 'FMS.09.00', 3, 'ประเมินองค์ประกอบสำคัญของแผนทุกปี รวมการซ้อมและผลการซ้อม'),
  ('FMS.09.01 ME 3', 'FMS.09.01', 3, 'ระบุจุดแรกรับผู้ป่วยและจำกัดทางเข้าเมื่อมีโรคติดต่อ'),
  ('FMS.09.01 ME 6', 'FMS.09.01', 6, 'มีกระบวนการรองรับผู้ป่วยโรคติดต่อจำนวนมากพร้อมกัน'),
  ('FMS.10.00 ME 1', 'FMS.10.00', 1, 'ประเมินความเสี่ยงก่อนก่อสร้าง/ปรับปรุง (PCRA/ICRA)'),
  ('FMS.10.00 ME 2', 'FMS.10.00', 2, 'ดำเนินมาตรการตามผลประเมินเพื่อลดความเสี่ยงระหว่างงาน'),
  ('FMS.10.00 ME 3', 'FMS.10.00', 3, 'ติดตาม บังคับใช้ และบันทึกการปฏิบัติของผู้รับเหมา'),
  ('GHI.03.00 ME 1', 'GHI.03.00', 1, 'มีแผนลดของเสีย คาร์บอน และการใช้ทรัพยากร พร้อมเป้าหมายและการติดตาม'),
  ('GHI.03.00 ME 2', 'GHI.03.00', 2, 'รายงานสัดส่วนพลังงานหมุนเวียนต่อคณะกรรมการทุกปี'),
  ('GHI.03.00 ME 3', 'GHI.03.00', 3, 'ดำเนินการประหยัดน้ำและรายงานปริมาณที่ประหยัดได้ทุกปี'),
  ('GHI.03.00 ME 4', 'GHI.03.00', 4, 'แสดงความคืบหน้าการลดผลกระทบสิ่งแวดล้อมในงาน Soft FM'),
  ('GHI.04.00 ME 3', 'GHI.04.00', 3, 'หาโอกาสลดวัสดุสิ้นเปลืองที่ไม่จำเป็นอย่างน้อย 3 ด้าน'),
  ('GHI.05.00 ME 1', 'GHI.05.00', 1, 'บรรจุผลกระทบจากการเปลี่ยนแปลงสภาพภูมิอากาศในทะเบียนความเสี่ยง'),
  ('GHI.05.00 ME 2', 'GHI.05.00', 2, 'มีแผนปรับตัวรับภัยจากสภาพภูมิอากาศ'),
  ('GHI.05.00 ME 3', 'GHI.05.00', 3, 'ประเมินความเสี่ยงสิ่งแวดล้อมของชุมชนทุก 3 ปี'),
  ('GHI.05.00 ME 4', 'GHI.05.00', 4, 'มีโครงการเตรียมพร้อมสภาพอากาศรุนแรง ทดสอบและปรับทุกปี'),
  ('HCT.01.04 ME 1', 'HCT.01.04', 1, 'มีแผนและทดสอบรับมือระบบข้อมูลล่ม (Downtime) อย่างน้อยปีละครั้ง'),
  ('HCT.02.00 ME 1', 'HCT.02.00', 1, 'มีโครงการใช้เลเซอร์/เครื่องจี้ไฟฟ้าอย่างปลอดภัยตามมาตรฐาน'),
  ('HCT.02.00 ME 2', 'HCT.02.00', 2, 'มีผู้มีคุณสมบัติกำกับดูแลโครงการเลเซอร์/เครื่องจี้ไฟฟ้า'),
  ('HCT.02.00 ME 4', 'HCT.02.00', 4, 'มีมาตรการควบคุมด้านบริหารและวิศวกรรมสำหรับเลเซอร์/เครื่องจี้ไฟฟ้า'),
  ('HCT.02.00 ME 6', 'HCT.02.00', 6, 'ตรวจ ทดสอบ บำรุงรักษา และสอบเทียบเลเซอร์/เครื่องจี้ไฟฟ้าโดยผู้ผ่านการอบรม')
on conflict (code) do nothing;

-- central standard forms (hospital_id null), generic standard only, no hospital data:
--  doc    = evidence documents per ME of the 76 engineering MEs (FMS.01–FMS.10, HCT, GHI)
--  walk   = field walk per area, FMS 03–10 by ME, with the high-risk checkpoints and SAF Zero-Red points
--  tracer = follow the surveyor: Reverse-Tracer 15 min on high-risk machines (FMEA), Zero-Red sweep, staff Q&A on every shift,
--           contractor Work Permit / ICRA, utility-failure scenarios, the physician / nurse surveyors' focus points
-- Each hospital can replace a kind with its own form from Excel (fms_items_replace); an empty upload goes back to this form.
insert into public.fms_items (hospital_id, kind, cat, cat_name, no, text, ref, red)
select null, v.* from (values
  ('doc', 'FMS01', 'FMS 01 ภาวะผู้นำและการวางแผน', 1, 'ทะเบียนกฎหมาย/ข้อกำหนดที่เกี่ยวข้อง (Legal/Code Register) ด้านอาคาร ไฟฟ้า ลิฟต์ หม้อไอน้ำ ถังแรงดัน อัคคีภัย สิ่งแวดล้อม', 'FMS.01.00 ME 1', false),
  ('doc', 'FMS01', 'FMS 01 ภาวะผู้นำและการวางแผน', 2, 'ใบอนุญาต/ใบรับรองที่ยังไม่หมดอายุ: อ.1/อ.6 อาคาร, ใบ รง., ใบอนุญาตลิฟต์, หม้อน้ำ (หม้อไอน้ำ/หม้อต้ม), ถังแรงดัน, ปั้นจั่น', 'FMS.01.00 ME 1', false),
  ('doc', 'FMS01', 'FMS 01 ภาวะผู้นำและการวางแผน', 3, 'รายงานตรวจสอบอาคารประจำปีโดยผู้ตรวจสอบอาคารขึ้นทะเบียน (แบบ ร.1) และรายงานวิศวกรตรวจระบบ', 'FMS.01.00 ME 1', false),
  ('doc', 'FMS01', 'FMS 01 ภาวะผู้นำและการวางแผน', 4, 'นโยบาย/โครงการบริหารจัดการอาคารและความปลอดภัย (FMS Program) ฉบับอนุมัติ', 'FMS.01.00 ME 1', false),
  ('doc', 'FMS01', 'FMS 01 ภาวะผู้นำและการวางแผน', 5, 'บันทึกข้อบกพร่องจากการตรวจภายนอก (จากราชการ/หน่วยกำกับ) พร้อมแผนและหลักฐานการแก้ไข (CAPA)', 'FMS.01.00 ME 2', false),
  ('doc', 'FMS01', 'FMS 01 ภาวะผู้นำและการวางแผน', 6, 'ทะเบียนติดตามผลการแก้ไขข้อบกพร่องจากการตรวจภายนอก (สถานะ เปิด/ปิด)', 'FMS.01.00 ME 2', false),
  ('doc', 'FMS01', 'FMS 01 ภาวะผู้นำและการวางแผน', 7, 'แผนงบประมาณลงทุน/ทดแทนอุปกรณ์ระบบวิศวกรรม (Capital/Replacement Plan) หลายปี', 'FMS.01.00 ME 3', false),
  ('doc', 'FMS01', 'FMS 01 ภาวะผู้นำและการวางแผน', 8, 'รายการขออนุมัติงบ (เช่น ทดแทน Chiller, เปลี่ยน Battery UPS) พร้อมเหตุผลความเสี่ยง', 'FMS.01.00 ME 3', false),
  ('doc', 'FMS01', 'FMS 01 ภาวะผู้นำและการวางแผน', 9, 'ทะเบียนอายุการใช้งานสินทรัพย์/แผนทดแทนตามอายุ (Asset lifecycle)', 'FMS.01.00 ME 3', false),
  ('doc', 'FMS01', 'FMS 01 ภาวะผู้นำและการวางแผน', 10, 'สัญญา/ข้อตกลงการใช้ระบบร่วมกับเจ้าของอาคาร (ถ้ามี) และหลักฐานการปฏิบัติตามข้อกำหนดระบบร่วม', 'FMS.01.00 ME 4', false),
  ('doc', 'FMS01', 'FMS 01 ภาวะผู้นำและการวางแผน', 11, 'รายงานตรวจ/บำรุงรักษาระบบสาธารณูปโภคส่วนที่ใช้ร่วม — หมายเหตุ: ระบุ N/A หากไม่เข้าข่าย', 'FMS.01.00 ME 4', false),
  ('doc', 'FMS01', 'FMS 01 ภาวะผู้นำและการวางแผน', 12, 'คำสั่งแต่งตั้งผู้รับผิดชอบงาน FMS/ผู้จัดการวิศวกรรม', 'FMS.01.01 ME 1', false),
  ('doc', 'FMS01', 'FMS 01 ภาวะผู้นำและการวางแผน', 13, 'ประวัติ/คุณวุฒิ/ใบรับรองการอบรมของผู้รับผิดชอบ (เช่น ใบ กว., certificate ด้านความปลอดภัย)', 'FMS.01.01 ME 1', false),
  ('doc', 'FMS01', 'FMS 01 ภาวะผู้นำและการวางแผน', 14, 'โครงการ/แผน FMS ทั้ง 8 ด้าน ฉบับปัจจุบัน (ลงวันที่ทบทวนภายใน 1 ปี)', 'FMS.01.01 ME 2', false),
  ('doc', 'FMS01', 'FMS 01 ภาวะผู้นำและการวางแผน', 15, 'บันทึกการทบทวนประจำปีของแต่ละโครงการ FMS', 'FMS.01.01 ME 2', false),
  ('doc', 'FMS01', 'FMS 01 ภาวะผู้นำและการวางแผน', 16, 'ทะเบียนการอบรมบุคลากรด้าน FMS และรายงานการประเมิน/ติดตามผลโครงการ', 'FMS.01.01 ME 2', false),
  ('doc', 'FMS01', 'FMS 01 ภาวะผู้นำและการวางแผน', 17, 'ประชุมคณะกรรมการ FMS มีวาระติดตามระบบสาธารณูปโภค', 'FMS.01.01 ME 2', false),
  ('doc', 'FMS02', 'FMS 02 การประเมินความเสี่ยง', 1, 'รายงานการประเมินความเสี่ยง FMS ประจำปี ครบทั้ง 8 ด้าน (Risk Assessment)', 'FMS.02.00 ME 1', false),
  ('doc', 'FMS02', 'FMS 02 การประเมินความเสี่ยง', 2, 'ทะเบียนความเสี่ยง (Risk Register) ด้านวิศวกรรม/กายภาพ', 'FMS.02.00 ME 1', false),
  ('doc', 'FMS02', 'FMS 02 การประเมินความเสี่ยง', 3, 'ตารางจัดลำดับความเสี่ยง (risk scoring/matrix) พร้อมเป้าหมาย/ตัวชี้วัด', 'FMS.02.00 ME 2', false),
  ('doc', 'FMS02', 'FMS 02 การประเมินความเสี่ยง', 4, 'แผนปรับปรุงลดความเสี่ยงและหลักฐานการดำเนินการ', 'FMS.02.00 ME 2', false),
  ('doc', 'FMS02', 'FMS 02 การประเมินความเสี่ยง', 5, 'รายงานประเมินประสิทธิผลของมาตรการที่ปรับปรุง (ก่อน/หลัง)', 'FMS.02.00 ME 3', false),
  ('doc', 'FMS02', 'FMS 02 การประเมินความเสี่ยง', 6, 'บันทึกการปรับปรุงโครงการ FMS ตามผลการประเมิน', 'FMS.02.00 ME 3', false),
  ('doc', 'FMS03', 'FMS 03 ความปลอดภัย', 1, 'โครงการความปลอดภัยทางกายภาพ (Safety Program) ฉบับอนุมัติ', 'FMS.03.00 ME 1', false),
  ('doc', 'FMS03', 'FMS 03 ความปลอดภัย', 2, 'รายงานตรวจความปลอดภัยกายภาพ/Safety walk round พร้อมผลและการแก้ไข', 'FMS.03.00 ME 2', false),
  ('doc', 'FMS03', 'FMS 03 ความปลอดภัย', 3, 'หลักฐานการนำผลตรวจเข้าสู่การประเมินความเสี่ยงรวม (FMS.02)', 'FMS.03.00 ME 2', false),
  ('doc', 'FMS04', 'FMS 04 การรักษาความปลอดภัย', 1, 'โครงการรักษาความปลอดภัย (Security Program) ฉบับอนุมัติ', 'FMS.04.00 ME 1', false),
  ('doc', 'FMS04', 'FMS 04 การรักษาความปลอดภัย', 2, 'ผังพื้นที่เสี่ยง/พื้นที่หวงห้าม (restricted areas) เช่น ห้องยา ห้องแม่-เด็ก ห้องเซิร์ฟเวอร์ ห้องเครื่อง', 'FMS.04.00 ME 2', false),
  ('doc', 'FMS04', 'FMS 04 การรักษาความปลอดภัย', 3, 'แผนผังกล้อง CCTV และระบบควบคุมการเข้าออก (Access Control) พร้อมบันทึกการเฝ้าระวัง', 'FMS.04.00 ME 2', false),
  ('doc', 'FMS04', 'FMS 04 การรักษาความปลอดภัย', 4, 'แผน/บันทึก PM และผลทดสอบระบบ CCTV, Access Control, ระบบสัญญาณเตือน/ปุ่มฉุกเฉิน (panic/duress)', 'FMS.04.00 ME 4', false),
  ('doc', 'FMS04', 'FMS 04 การรักษาความปลอดภัย', 5, 'ทะเบียนอุปกรณ์รักษาความปลอดภัยและสถานะใช้งาน', 'FMS.04.00 ME 4', false),
  ('doc', 'FMS05', 'FMS 05 วัสดุอันตรายและของเสีย', 1, 'โครงการจัดการวัสดุอันตรายและของเสีย (HazMat & Waste Program) ฉบับอนุมัติ', 'FMS.05.00 ME 1', false),
  ('doc', 'FMS05', 'FMS 05 วัสดุอันตรายและของเสีย', 2, 'บัญชีวัสดุอันตราย (HazMat inventory) ระบุชนิด/ปริมาณ/ตำแหน่งเก็บ ปรับปรุงภายใน 1 ปี', 'FMS.05.00 ME 2', false),
  ('doc', 'FMS05', 'FMS 05 วัสดุอันตรายและของเสีย', 3, 'ผังตำแหน่งจัดเก็บวัสดุอันตรายและจุดพักขยะติดเชื้อ/ขยะอันตราย', 'FMS.05.00 ME 2', false),
  ('doc', 'FMS05', 'FMS 05 วัสดุอันตรายและของเสีย', 4, 'เอกสารข้อมูลความปลอดภัย (SDS/MSDS) ครบทุกสารเคมี ณ จุดใช้งาน', 'FMS.05.00 ME 3', false),
  ('doc', 'FMS05', 'FMS 05 วัสดุอันตรายและของเสีย', 5, 'มาตรฐานการติดฉลาก/จัดเก็บสารเคมีและของเสีย', 'FMS.05.00 ME 3', false),
  ('doc', 'FMS05', 'FMS 05 วัสดุอันตรายและของเสีย', 6, 'ขั้นตอนจัดการสารเคมีหกรั่วไหล (Spill response) และตำแหน่ง Spill kit', 'FMS.05.00 ME 5', false),
  ('doc', 'FMS05', 'FMS 05 วัสดุอันตรายและของเสีย', 7, 'แบบ/ตัวอย่างรายงานเหตุหกรั่วไหลและการสัมผัส', 'FMS.05.00 ME 5', false),
  ('doc', 'FMS06', 'FMS 06 อัคคีภัย', 1, 'โครงการความปลอดภัยจากอัคคีภัย (Fire Safety Program) ฉบับอนุมัติ', 'FMS.06.00 ME 1', false),
  ('doc', 'FMS06', 'FMS 06 อัคคีภัย', 2, 'ขั้นตอนมาตรการชั่วคราว (ILSM/Interim Life Safety Measures) และตัวอย่างการบังคับใช้', 'FMS.06.00 ME 2', false),
  ('doc', 'FMS06', 'FMS 06 อัคคีภัย', 3, 'รายงานประเมินความเสี่ยงอัคคีภัยทั้งอาคาร ครอบคลุมหัวข้อตาม ME', 'FMS.06.00 ME 3', false),
  ('doc', 'FMS06', 'FMS 06 อัคคีภัย', 4, 'ผังการแบ่งส่วนป้องกันไฟ/ควัน (fire/smoke compartment) และตำแหน่งพื้นที่อันตราย', 'FMS.06.00 ME 3', false),
  ('doc', 'FMS06', 'FMS 06 อัคคีภัย', 5, 'ผังระบบแจ้งเหตุเพลิงไหม้ (Fire Alarm/FACP) และรายการอุปกรณ์ตรวจจับควัน/ความร้อน', 'FMS.06.01 ME 1', false),
  ('doc', 'FMS06', 'FMS 06 อัคคีภัย', 6, 'บันทึก History/Log การตรวจระบบแจ้งเหตุประจำวัน', 'FMS.06.01 ME 1', false),
  ('doc', 'FMS06', 'FMS 06 อัคคีภัย', 7, 'ผังระบบดับเพลิง: หัวกระจายน้ำดับเพลิง (sprinkler), ตู้สายฉีด (fire hose cabinet), ถังดับเพลิงมือถือ', 'FMS.06.01 ME 2', false),
  ('doc', 'FMS06', 'FMS 06 อัคคีภัย', 8, 'แผน/บันทึกการตรวจปั๊มดับเพลิง (fire pump) และระบบ sprinkler', 'FMS.06.01 ME 2', false),
  ('doc', 'FMS06', 'FMS 06 อัคคีภัย', 9, 'บันทึกตรวจทางหนีไฟ/ประตูหนีไฟ/บันไดหนีไฟ ว่าปลอดสิ่งกีดขวาง', 'FMS.06.01 ME 3', false),
  ('doc', 'FMS06', 'FMS 06 อัคคีภัย', 10, 'ผังเส้นทางหนีไฟ (egress plan) แต่ละชั้น', 'FMS.06.01 ME 3', false),
  ('doc', 'FMS06', 'FMS 06 อัคคีภัย', 11, 'บันทึกตรวจป้ายทางออก/ป้ายหนีไฟ (exit sign) ว่าติดสว่างและมองเห็นชัด', 'FMS.06.01 ME 4', false),
  ('doc', 'FMS06', 'FMS 06 อัคคีภัย', 12, 'บันทึกทดสอบไฟส่องสว่างฉุกเฉิน (emergency light) ตามรอบที่กำหนด', 'FMS.06.01 ME 5', false),
  ('doc', 'FMS06', 'FMS 06 อัคคีภัย', 13, 'บันทึกตรวจประตูกันไฟ (fire door), ผนัง/ช่องอุดกันไฟ (fire stopping), แดมเปอร์กันควัน (fire/smoke damper)', 'FMS.06.01 ME 6', false),
  ('doc', 'FMS06', 'FMS 06 อัคคีภัย', 14, 'บันทึกทดสอบพัดลมอัดอากาศบันไดหนีไฟ (pressurized fan)', 'FMS.06.01 ME 6', false),
  ('doc', 'FMS06', 'FMS 06 อัคคีภัย', 15, 'แผน ITM ประจำปีของระบบอัคคีภัยทั้งหมด (fire alarm, sprinkler, fire pump, ถังดับเพลิง, fire door/damper)', 'FMS.06.02 ME 1', false),
  ('doc', 'FMS06', 'FMS 06 อัคคีภัย', 16, 'บันทึกผลตรวจ/ทดสอบ/บำรุงรักษาตามรอบ (รายเดือน/ราย 6 เดือน/รายปี)', 'FMS.06.02 ME 1', false),
  ('doc', 'FMS06', 'FMS 06 อัคคีภัย', 17, 'แบบบันทึก ITM พร้อมผลและ corrective action ครบถ้วน', 'FMS.06.02 ME 2', false),
  ('doc', 'FMS06', 'FMS 06 อัคคีภัย', 18, 'ทะเบียนถังดับเพลิงพร้อมวันตรวจ/วันหมดอายุ', 'FMS.06.02 ME 2', false),
  ('doc', 'FMS06', 'FMS 06 อัคคีภัย', 19, 'ทะเบียนข้อบกพร่องระบบอัคคีภัย พร้อมสถานะแก้ไข/มาตรการชั่วคราว (ILSM)', 'FMS.06.02 ME 3', false),
  ('doc', 'FMS07', 'FMS 07 เครื่องมือแพทย์', 1, 'โครงการจัดการเครื่องมือแพทย์ (Medical Equipment Program) ฉบับอนุมัติ', 'FMS.07.00 ME 1', false),
  ('doc', 'FMS07', 'FMS 07 เครื่องมือแพทย์', 2, 'บัญชีเครื่องมือแพทย์ทั้งหมด (inventory) พร้อมประวัติเครื่อง', 'FMS.07.00 ME 2', false),
  ('doc', 'FMS07', 'FMS 07 เครื่องมือแพทย์', 3, 'แผนและบันทึก PM/สอบเทียบ (calibration) เครื่องมือแพทย์ตามรอบ', 'FMS.07.00 ME 2', false),
  ('doc', 'FMS07', 'FMS 07 เครื่องมือแพทย์', 4, 'ใบรับรองสอบเทียบจากหน่วยงานที่ได้รับการรับรอง', 'FMS.07.00 ME 2', false),
  ('doc', 'FMS07', 'FMS 07 เครื่องมือแพทย์', 5, 'เป้าหมาย/ตัวชี้วัดและข้อมูลติดตามความเสี่ยงเครื่องมือแพทย์ (เช่น % PM ตามแผน, อัตราเสีย)', 'FMS.07.00 ME 3', false),
  ('doc', 'FMS07', 'FMS 07 เครื่องมือแพทย์', 6, 'กระบวนการเฝ้าระวังประกาศเตือน/เรียกคืน (hazard notice/recall) เครื่องมือแพทย์', 'FMS.07.01 ME 1', false),
  ('doc', 'FMS07', 'FMS 07 เครื่องมือแพทย์', 7, 'ทะเบียนการตอบสนองต่อประกาศเตือน/เรียกคืน', 'FMS.07.01 ME 1', false),
  ('doc', 'FMS07', 'FMS 07 เครื่องมือแพทย์', 8, 'ขั้นตอนกักกัน/ระงับใช้เครื่องมือที่มีปัญหาหรือถูกเรียกคืน (quarantine/tag-out)', 'FMS.07.01 ME 3', false),
  ('doc', 'FMS08', 'FMS 08 ระบบสาธารณูปโภค', 1, 'โครงการจัดการระบบสาธารณูปโภค (Utility Systems Program) ฉบับอนุมัติ', 'FMS.08.00 ME 1', false),
  ('doc', 'FMS08', 'FMS 08 ระบบสาธารณูปโภค', 2, 'เป้าหมาย/ตัวชี้วัดและข้อมูลติดตามระบบสาธารณูปโภค (เช่น ความพร้อมใช้, downtime)', 'FMS.08.00 ME 2', false),
  ('doc', 'FMS08', 'FMS 08 ระบบสาธารณูปโภค', 3, 'บัญชีส่วนประกอบระบบสาธารณูปโภค (ไฟฟ้า น้ำ ก๊าซการแพทย์ HVAC ไอน้ำ ฯลฯ)', 'FMS.08.00 ME 3', false),
  ('doc', 'FMS08', 'FMS 08 ระบบสาธารณูปโภค', 4, 'ผังการจ่าย/แผนผังระบบ (single line diagram, ผังท่อ) เป็นปัจจุบัน', 'FMS.08.00 ME 3', false),
  ('doc', 'FMS08', 'FMS 08 ระบบสาธารณูปโภค', 5, 'แผน ITM/PM ระบบสาธารณูปโภคระบุกิจกรรมและรอบเวลาแต่ละส่วนประกอบ', 'FMS.08.00 ME 4', false),
  ('doc', 'FMS08', 'FMS 08 ระบบสาธารณูปโภค', 6, 'บันทึกผล PM ตามแผน (ไฟฟ้า/น้ำ/ก๊าซ/ปรับอากาศ)', 'FMS.08.00 ME 4', false),
  ('doc', 'FMS08', 'FMS 08 ระบบสาธารณูปโภค', 7, 'ผังและบันทึกการติดฉลากจุดควบคุม/วาล์วปิดฉุกเฉิน (เช่น Zone Valve ก๊าซการแพทย์, เมนไฟฟ้า/น้ำ)', 'FMS.08.00 ME 5', false),
  ('doc', 'FMS08', 'FMS 08 ระบบสาธารณูปโภค', 8, 'ตำแหน่ง shutoff ฉุกเฉินและคู่มือการปิดระบบ', 'FMS.08.00 ME 5', false),
  ('doc', 'FMS08', 'FMS 08 ระบบสาธารณูปโภค', 9, 'เครื่องกำเนิดไฟฟ้าสำรอง (generator) + ATS พร้อมบันทึกความพร้อมใช้ และปริมาณเชื้อเพลิงสำรอง (วัน) (ระบุค่าจริงในช่องรายละเอียด)', 'FMS.08.01 ME 1', false),
  ('doc', 'FMS08', 'FMS 08 ระบบสาธารณูปโภค', 10, 'แหล่งน้ำสำรอง/ถังเก็บน้ำ และปริมาณสำรอง (วัน) (ระบุค่าจริงในช่องรายละเอียด)', 'FMS.08.01 ME 1', false),
  ('doc', 'FMS08', 'FMS 08 ระบบสาธารณูปโภค', 11, 'แหล่งก๊าซการแพทย์สำรอง (manifold/ถังสำรอง O2) และปริมาณสำรอง (วัน) (ระบุค่าจริงในช่องรายละเอียด)', 'FMS.08.01 ME 1', false),
  ('doc', 'FMS08', 'FMS 08 ระบบสาธารณูปโภค', 12, 'ผลทดสอบ/ประเมินแหล่งน้ำสำรองประจำปี (ความพร้อมใช้ + คุณภาพน้ำ)', 'FMS.08.01 ME 2', false),
  ('doc', 'FMS08', 'FMS 08 ระบบสาธารณูปโภค', 13, 'บันทึกการทดสอบจ่ายน้ำจากแหล่งสำรอง', 'FMS.08.01 ME 2', false),
  ('doc', 'FMS08', 'FMS 08 ระบบสาธารณูปโภค', 14, 'ผลทดสอบเดินเครื่องกำเนิดไฟฟ้าสำรองรายสัปดาห์/รายเดือน (มีโหลด)', 'FMS.08.01 ME 3', false),
  ('doc', 'FMS08', 'FMS 08 ระบบสาธารณูปโภค', 15, 'ผลทดสอบ Load bank / full-load test ประจำไตรมาส/ประจำปี', 'FMS.08.01 ME 3', false),
  ('doc', 'FMS08', 'FMS 08 ระบบสาธารณูปโภค', 16, 'บันทึกทดสอบสลับแหล่งจ่ายอัตโนมัติ (ATS) และเวลาสวิตช์', 'FMS.08.01 ME 3', false),
  ('doc', 'FMS08', 'FMS 08 ระบบสาธารณูปโภค', 17, 'ผลตรวจคุณภาพน้ำดื่ม/น้ำใช้ (potable) ทุกไตรมาส (จุลชีววิทยา/เคมี)', 'FMS.08.02 ME 1', false),
  ('doc', 'FMS08', 'FMS 08 ระบบสาธารณูปโภค', 18, 'แผนจุดเก็บตัวอย่างน้ำและตารางรอบการตรวจ', 'FMS.08.02 ME 1', false),
  ('doc', 'FMS08', 'FMS 08 ระบบสาธารณูปโภค', 19, 'ผลตรวจคุณภาพน้ำ non-potable ทุก 6 เดือน (เช่น น้ำหอผึ่ง/cooling tower)', 'FMS.08.02 ME 2', false),
  ('doc', 'FMS08', 'FMS 08 ระบบสาธารณูปโภค', 20, 'แผนจัดการความเสี่ยง Legionella/แบคทีเรียในระบบน้ำ และบันทึกมาตรการ (เช่น เติมคลอรีน, flushing)', 'FMS.08.02 ME 3', false),
  ('doc', 'FMS08', 'FMS 08 ระบบสาธารณูปโภค', 21, 'บันทึกตรวจ/ทำความสะอาดถังเก็บน้ำและ cooling tower', 'FMS.08.02 ME 3', false),
  ('doc', 'FMS08', 'FMS 08 ระบบสาธารณูปโภค', 22, 'ผลทดสอบ/บำบัดน้ำท่อยูนิตทำฟัน — ระบุ N/A หากไม่มีบริการทันตกรรม', 'FMS.08.02 ME 4', false),
  ('doc', 'FMS08', 'FMS 08 ระบบสาธารณูปโภค', 23, 'แนวทาง/มาตรฐานคุณภาพน้ำไตเทียม (เช่น AAMI) ที่หน่วยไตเทียมใช้ — ระบุ N/A หากไม่มีบริการไตเทียม', 'FMS.08.03 ME 1', false),
  ('doc', 'FMS08', 'FMS 08 ระบบสาธารณูปโภค', 24, 'โครงการ/ขั้นตอนควบคุมคุณภาพน้ำระบบ RO ไตเทียม', 'FMS.08.03 ME 1', false),
  ('doc', 'FMS08', 'FMS 08 ระบบสาธารณูปโภค', 25, 'ผลตรวจน้ำ RO ไตเทียม: แบคทีเรีย + เอนโดทอกซิน รายเดือน', 'FMS.08.03 ME 2', false),
  ('doc', 'FMS08', 'FMS 08 ระบบสาธารณูปโภค', 26, 'ผลตรวจสารเคมีปนเปื้อนในน้ำ RO รายปี', 'FMS.08.03 ME 2', false),
  ('doc', 'FMS08', 'FMS 08 ระบบสาธารณูปโภค', 27, 'บันทึกค่าการนำไฟฟ้า/คุณภาพน้ำประจำวัน (ถ้ามี)', 'FMS.08.03 ME 2', false),
  ('doc', 'FMS08', 'FMS 08 ระบบสาธารณูปโภค', 28, 'บันทึกการฆ่าเชื้อ (disinfection) ระบบท่อ/ถังน้ำ RO ไตเทียมตามรอบ', 'FMS.08.03 ME 3', false),
  ('doc', 'FMS08', 'FMS 08 ระบบสาธารณูปโภค', 29, 'ผลทดสอบ/บำรุงรักษาเครื่องไตเทียมรายปี ครบทุกเครื่อง (รวมเครื่องสำรอง)', 'FMS.08.03 ME 4', false),
  ('doc', 'FMS08', 'FMS 08 ระบบสาธารณูปโภค', 30, 'รายการห้องความดันลบ/บวก (AIIR, ห้องผ่าตัด, ห้องแยกโรค) พร้อมผลวัดความดัน/ทิศทางลม', 'FMS.08.04 ME 1', false),
  ('doc', 'FMS08', 'FMS 08 ระบบสาธารณูปโภค', 31, 'บันทึกตรวจ/บำรุงรักษาและผลวัดความดันห้องตามรอบ', 'FMS.08.04 ME 1', false),
  ('doc', 'FMS08', 'FMS 08 ระบบสาธารณูปโภค', 32, 'บันทึกควบคุมอุณหภูมิน้ำร้อน/ไอน้ำ (เช่น จุดใช้งาน, ถังเก็บน้ำร้อน) ตามเกณฑ์', 'FMS.08.04 ME 2', false),
  ('doc', 'FMS08', 'FMS 08 ระบบสาธารณูปโภค', 33, 'แผน/บันทึก PM ระบบไอน้ำและ heat exchanger', 'FMS.08.04 ME 2', false),
  ('doc', 'FMS08', 'FMS 08 ระบบสาธารณูปโภค', 34, 'ผลวัดอัตราการระบายอากาศ (ACH), ความชื้นสัมพัทธ์, อุณหภูมิในพื้นที่สำคัญ (OR, ICU, ห้องแยกโรค)', 'FMS.08.04 ME 3', false),
  ('doc', 'FMS08', 'FMS 08 ระบบสาธารณูปโภค', 35, 'บันทึกเปลี่ยน/ตรวจไส้กรองอากาศ (HEPA/pre-filter) ตามรอบ', 'FMS.08.04 ME 3', false),
  ('doc', 'FMS09', 'FMS 09 ภาวะฉุกเฉินและภัยพิบัติ', 1, 'โครงการจัดการภาวะฉุกเฉินและภัยพิบัติ (Emergency Management Program) ฉบับอนุมัติ', 'FMS.09.00 ME 1', false),
  ('doc', 'FMS09', 'FMS 09 ภาวะฉุกเฉินและภัยพิบัติ', 2, 'แผนจัดหาไฟฟ้า/น้ำสำรองในภาวะฉุกเฉิน (ส่วนที่วิศวกรรมรับผิดชอบ)', 'FMS.09.00 ME 1', false),
  ('doc', 'FMS09', 'FMS 09 ภาวะฉุกเฉินและภัยพิบัติ', 3, 'HVA (Hazard Vulnerability Analysis) ครอบคลุมความเปราะบางโครงสร้าง/ระบบ', 'FMS.09.00 ME 1', false),
  ('doc', 'FMS09', 'FMS 09 ภาวะฉุกเฉินและภัยพิบัติ', 4, 'รายงานระบุภัยสำคัญตามที่ตั้ง (เช่น น้ำท่วม ไฟไหม้ ไฟฟ้าดับ) — เชื่อมโยงแผนป้องกันน้ำท่วม (FERT)', 'FMS.09.00 ME 2', false),
  ('doc', 'FMS09', 'FMS 09 ภาวะฉุกเฉินและภัยพิบัติ', 5, 'รายงานประเมินองค์ประกอบสำคัญประจำปี รวมการทดสอบแหล่งไฟฟ้า/น้ำสำรอง', 'FMS.09.00 ME 3', false),
  ('doc', 'FMS09', 'FMS 09 ภาวะฉุกเฉินและภัยพิบัติ', 6, 'ผังจุดคัดกรอง/จุดเข้าออกที่ควบคุม และมาตรการทางกายภาพ/ระบบเพื่อจำกัดการเข้าถึง', 'FMS.09.01 ME 3', false),
  ('doc', 'FMS09', 'FMS 09 ภาวะฉุกเฉินและภัยพิบัติ', 7, 'แผน surge capacity และการจัดพื้นที่/ระบบระบายอากาศรองรับ (ส่วนวิศวกรรมสนับสนุน)', 'FMS.09.01 ME 6', false),
  ('doc', 'FMS10', 'FMS 10 ก่อสร้างและปรับปรุง', 1, 'แบบฟอร์มและตัวอย่างรายงาน PCRA ครบหัวข้อตาม ME', 'FMS.10.00 ME 1', false),
  ('doc', 'FMS10', 'FMS 10 ก่อสร้างและปรับปรุง', 2, 'การประเมิน ICRA (Infection Control Risk Assessment) ร่วมกับ IC', 'FMS.10.00 ME 1', false),
  ('doc', 'FMS10', 'FMS 10 ก่อสร้างและปรับปรุง', 3, 'แผน/มาตรการควบคุมระหว่างก่อสร้าง (ผนังกั้นฝุ่น, ความดันลบ, เส้นทางขนย้าย) พร้อมภาพถ่าย/บันทึกตรวจ', 'FMS.10.00 ME 2', false),
  ('doc', 'FMS10', 'FMS 10 ก่อสร้างและปรับปรุง', 4, 'บันทึกตรวจติดตามผู้รับเหมา (permit to work, checklist) และหลักฐานการบังคับใช้', 'FMS.10.00 ME 3', false),
  ('doc', 'HCT', 'HCT เทคโนโลยีสุขภาพ', 1, 'โครงการตอบสนอง downtime ระบบข้อมูล (IT downtime plan) และบันทึกการทดสอบประจำปี', 'HCT.01.04 ME 1', false),
  ('doc', 'HCT', 'HCT เทคโนโลยีสุขภาพ', 2, 'โครงการใช้เลเซอร์/เครื่องจี้ไฟฟ้า/อุปกรณ์รังสีแสงอย่างปลอดภัย ฉบับอนุมัติ', 'HCT.02.00 ME 1', false),
  ('doc', 'HCT', 'HCT เทคโนโลยีสุขภาพ', 3, 'คำสั่งแต่งตั้ง Laser Safety Officer/ผู้รับผิดชอบ พร้อมคุณวุฒิ', 'HCT.02.00 ME 2', false),
  ('doc', 'HCT', 'HCT เทคโนโลยีสุขภาพ', 4, 'มาตรการควบคุมเชิงวิศวกรรม: ป้ายเตือนหน้าห้อง, สัญญาณไฟ, การควบคุมการเข้าออกห้องเลเซอร์, ระบบระบายควัน (smoke evacuator)', 'HCT.02.00 ME 4', false),
  ('doc', 'HCT', 'HCT เทคโนโลยีสุขภาพ', 5, 'แผนและบันทึก PM/สอบเทียบเลเซอร์/เครื่องจี้ไฟฟ้า พร้อมใบรับรองสอบเทียบ', 'HCT.02.00 ME 6', false),
  ('doc', 'GHI', 'GHI ความยั่งยืน', 1, 'แผนลดของเสีย/คาร์บอน/การใช้ทรัพยากร พร้อมเป้าหมายและตัวชี้วัด (เชื่อมโยงรายงานการจัดการพลังงาน)', 'GHI.03.00 ME 1', false),
  ('doc', 'GHI', 'GHI ความยั่งยืน', 2, 'ข้อมูลสัดส่วนพลังงานหมุนเวียน (เช่น โซลาร์) เทียบการใช้พลังงานรวม (ระบุค่าจริงในช่องรายละเอียด)', 'GHI.03.00 ME 2', false),
  ('doc', 'GHI', 'GHI ความยั่งยืน', 3, 'บันทึกมาตรการประหยัดน้ำและปริมาณน้ำที่ประหยัดได้ (ระบุค่าจริงในช่องรายละเอียด)', 'GHI.03.00 ME 3', false),
  ('doc', 'GHI', 'GHI ความยั่งยืน', 4, 'ข้อมูลความคืบหน้าลดผลกระทบใน soft FM (ของเสีย/ทำความสะอาด/ซักรีด)', 'GHI.03.00 ME 4', false),
  ('doc', 'GHI', 'GHI ความยั่งยืน', 5, 'การวิเคราะห์ลดวัสดุที่ไม่จำเป็น (รวมอุปกรณ์/เครื่องมือ รพ. ที่วิศวกรรมเกี่ยวข้อง)', 'GHI.04.00 ME 3', false),
  ('doc', 'GHI', 'GHI ความยั่งยืน', 6, 'ทะเบียนความเสี่ยงที่รวมความเสี่ยงจาก climate (เช่น น้ำท่วม คลื่นความร้อน)', 'GHI.05.00 ME 1', false),
  ('doc', 'GHI', 'GHI ความยั่งยืน', 7, 'แผนปรับตัวต่อภัยภูมิอากาศ (adaptation plan) — เชื่อมโยงแผนรับมือน้ำท่วม (FERT/External Flood)', 'GHI.05.00 ME 2', false),
  ('doc', 'GHI', 'GHI ความยั่งยืน', 8, 'รายงานประเมินความเสี่ยงสิ่งแวดล้อมชุมชน (ทุก 3 ปี)', 'GHI.05.00 ME 3', false),
  ('doc', 'GHI', 'GHI ความยั่งยืน', 9, 'โครงการเตรียมพร้อมสภาพอากาศรุนแรง พร้อมบันทึกการทดสอบ/ซ้อมและการอบรมประจำปี (เชื่อม FMS.09)', 'GHI.05.00 ME 4', false),
  ('walk', 'FMS03', 'FMS 03 ความปลอดภัย (Safety)', 1, 'เจ้าหน้าที่ตอบได้: แจ้งซ่อม/แจ้งความเสี่ยงด้านอาคารอย่างไร และติดต่อวิศวกรรมเบอร์ใด', 'FMS.03.00 ME 1', false),
  ('walk', 'FMS03', 'FMS 03 ความปลอดภัย (Safety)', 2, 'ฝ้าเพดานไม่ชำรุด ไม่มีคราบน้ำรั่ว เชื้อรา หรือแผ่นฝ้าเปิดค้าง', 'FMS.03.00 ME 2', true),
  ('walk', 'FMS03', 'FMS 03 ความปลอดภัย (Safety)', 3, 'ตู้ใต้อ่างล้างมือ/ซิงก์ สะอาด ไม่มีน้ำรั่วซึม และเปิดตรวจได้ (ไม่ล็อกทิ้งไว้)', 'FMS.03.00 ME 2', false),
  ('walk', 'FMS03', 'FMS 03 ความปลอดภัย (Safety)', 4, 'พื้นทางเดินแห้ง ไม่ลื่น ไม่แตก ไม่มีสายไฟหรือสิ่งของกีดขวางทางเดิน', 'FMS.03.00 ME 2', false),
  ('walk', 'FMS03', 'FMS 03 ความปลอดภัย (Safety)', 5, 'หน้าต่างในพื้นที่ผู้ป่วยเสี่ยง (เด็ก จิตเวช เสี่ยงทำร้ายตนเอง ห้องคลอด) มีตัวจำกัดระยะเปิด', 'FMS.03.00 ME 2', true),
  ('walk', 'FMS03', 'FMS 03 ความปลอดภัย (Safety)', 6, 'ถังดับเพลิงและอุปกรณ์ติดผนังยึดแน่น ไม่ล้มใส่ผู้ป่วย (โดยเฉพาะหอผู้ป่วยเด็ก)', 'FMS.03.00 ME 2', false),
  ('walk', 'FMS03', 'FMS 03 ความปลอดภัย (Safety)', 7, 'ราวจับ ราวกันตก บันได ทางลาด แข็งแรง ไม่หลวม ไม่มีขอบคม', 'FMS.03.00 ME 2', false),
  ('walk', 'FMS03', 'FMS 03 ความปลอดภัย (Safety)', 8, 'ปลั๊ก เต้ารับ สายไฟ ไม่ชำรุด ไม่ใช้ปลั๊กพ่วงต่อกันหลายทอด ไม่วางสายไฟพาดทางเดิน', 'FMS.03.00 ME 2', false),
  ('walk', 'FMS03', 'FMS 03 ความปลอดภัย (Safety)', 9, 'ห้องไฟฟ้า ห้องเครื่อง ห้องระบบ ปิดล็อก มีป้ายชื่อห้องและป้ายเตือนอันตราย ไม่ใช้เป็นที่เก็บของ', 'FMS.03.00 ME 2', true),
  ('walk', 'FMS03', 'FMS 03 ความปลอดภัย (Safety)', 10, 'จุดเสี่ยง (พื้นต่างระดับ ขั้นบันได คานหัวชน) มีป้ายเตือนหรือเทปเหลือง-ดำ', 'FMS.03.00 ME 2', false),
  ('walk', 'FMS03', 'FMS 03 ความปลอดภัย (Safety)', 11, 'วัสดุที่ผู้ป่วยสัมผัส (มือจับประตู ราว พื้นผิว) เหมาะสม ไม่ลื่น ไม่สะท้อนแสงจ้า', 'FMS.03.00 ME 2', false),
  ('walk', 'FMS03', 'FMS 03 ความปลอดภัย (Safety)', 12, 'ข้อบกพร่องที่พบรอบก่อนมีใบแจ้งซ่อมและแก้ไขแล้ว หรือมีกำหนดเสร็จชัดเจน', 'FMS.03.00 ME 2', false),
  ('walk', 'FMS04', 'FMS 04 การรักษาความปลอดภัย (Security)', 1, 'แสงสว่างภายนอกอาคาร ลานจอดรถ ทางเดินเชื่อม เพียงพอช่วงกลางคืน', 'FMS.04.00 ME 1', false),
  ('walk', 'FMS04', 'FMS 04 การรักษาความปลอดภัย (Security)', 2, 'เจ้าหน้าที่และ รปภ. ตอบได้: Code Pink (ลักพาเด็ก) และ Code Grey/Silver (ความรุนแรง) ทำอย่างไร', 'FMS.04.00 ME 1', false),
  ('walk', 'FMS04', 'FMS 04 การรักษาความปลอดภัย (Security)', 3, 'พื้นที่หวงห้าม (NICU/Nursery, OR, LR, ห้องยา, ห้อง Server) ควบคุมการเข้าออกด้วยบัตรหรือกุญแจ และทำงานจริง', 'FMS.04.00 ME 2', true),
  ('walk', 'FMS04', 'FMS 04 การรักษาความปลอดภัย (Security)', 4, 'บุคคลภายนอกและผู้รับเหมาติดบัตรผู้มาติดต่อให้เห็นชัด และลงชื่อเข้า-ออกที่ป้อมรักษาความปลอดภัย', 'FMS.04.00 ME 2', false),
  ('walk', 'FMS04', 'FMS 04 การรักษาความปลอดภัย (Security)', 5, 'ช่องชาร์ป ช่องท่อ ช่องเซอร์วิส และตู้ควบคุมระบบ ปิดล็อกทุกจุด', 'FMS.04.00 ME 2', true),
  ('walk', 'FMS04', 'FMS 04 การรักษาความปลอดภัย (Security)', 6, 'ประตู Magnetic / Access control / Door holder ทำงานปกติ ไม่ชำรุดจนเปิดค้าง', 'FMS.04.00 ME 4', false),
  ('walk', 'FMS04', 'FMS 04 การรักษาความปลอดภัย (Security)', 7, 'กล้อง CCTV จุดสำคัญทำงาน ภาพชัด และดูภาพย้อนหลังได้', 'FMS.04.00 ME 4', false),
  ('walk', 'FMS04', 'FMS 04 การรักษาความปลอดภัย (Security)', 8, 'ปุ่มฉุกเฉิน / Nurse call ในห้องน้ำและเตียงผู้ป่วยกดแล้วมีสัญญาณจริง', 'FMS.04.00 ME 4', false),
  ('walk', 'FMS05', 'FMS 05 วัสดุอันตรายและของเสีย (Hazardous Materials & Waste)', 1, 'ขยะแยกถุงสีถูกประเภท (ติดเชื้อ อันตราย ทั่วไป รีไซเคิล) และไม่ล้นเกิน 3/4', 'FMS.05.00 ME 1', false),
  ('walk', 'FMS05', 'FMS 05 วัสดุอันตรายและของเสีย (Hazardous Materials & Waste)', 2, 'ภาชนะทิ้งของมีคมไม่เกิน 3/4 ปิดฝาได้ ติดชื่อหน่วยงานและวันที่เริ่มใช้', 'FMS.05.00 ME 1', false),
  ('walk', 'FMS05', 'FMS 05 วัสดุอันตรายและของเสีย (Hazardous Materials & Waste)', 3, 'ห้องพักขยะและห้องผ้าเปื้อนปิดล็อก สะอาด มีการระบายอากาศ', 'FMS.05.00 ME 1', true),
  ('walk', 'FMS05', 'FMS 05 วัสดุอันตรายและของเสีย (Hazardous Materials & Waste)', 4, 'ระบบบำบัดน้ำเสียมีผลตรวจน้ำทิ้งตามกฎหมาย และจุดเก็บสารเคมีที่บ่อบำบัดติด SDS', 'FMS.05.00 ME 1', false),
  ('walk', 'FMS05', 'FMS 05 วัสดุอันตรายและของเสีย (Hazardous Materials & Waste)', 5, 'มีบัญชีรายการสารเคมีของหน่วยงานเป็นปัจจุบัน ตรงกับของที่มีจริง', 'FMS.05.00 ME 2', false),
  ('walk', 'FMS05', 'FMS 05 วัสดุอันตรายและของเสีย (Hazardous Materials & Waste)', 6, 'SDS ภาษาไทยฉบับปัจจุบัน อยู่ ณ จุดใช้และจุดเก็บสารเคมีทุกชนิด', 'FMS.05.00 ME 3', true),
  ('walk', 'FMS05', 'FMS 05 วัสดุอันตรายและของเสีย (Hazardous Materials & Waste)', 7, 'ภาชนะสารเคมีมีฉลากชื่อและสัญลักษณ์อันตราย (GHS) ครบ รวมขวดที่แบ่งบรรจุ', 'FMS.05.00 ME 3', false),
  ('walk', 'FMS05', 'FMS 05 วัสดุอันตรายและของเสีย (Hazardous Materials & Waste)', 8, 'ตู้/ห้องเก็บสารเคมีปิดล็อก แยกสารที่ทำปฏิกิริยากัน มีถาดรองรับการหก', 'FMS.05.00 ME 3', true),
  ('walk', 'FMS05', 'FMS 05 วัสดุอันตรายและของเสีย (Hazardous Materials & Waste)', 9, 'ไนโตรเจนเหลวและถังก๊าซอัด ยึดโซ่ แยกถังเต็ม/ถังเปล่า มีแผนและการซ้อมกรณีรั่วไหล', 'FMS.05.00 ME 3', true),
  ('walk', 'FMS05', 'FMS 05 วัสดุอันตรายและของเสีย (Hazardous Materials & Waste)', 10, 'ห้องเก็บก๊าซ/สารไวไฟใช้โคมไฟและอุปกรณ์ไฟฟ้าชนิดกันระเบิดตามความเสี่ยง', 'FMS.05.00 ME 3', false),
  ('walk', 'FMS05', 'FMS 05 วัสดุอันตรายและของเสีย (Hazardous Materials & Waste)', 11, 'Spill kit พร้อมใช้ ไม่หมดอายุ และเจ้าหน้าที่สาธิตวิธีใช้ได้', 'FMS.05.00 ME 5', true),
  ('walk', 'FMS05', 'FMS 05 วัสดุอันตรายและของเสีย (Hazardous Materials & Waste)', 12, 'PPE เหมาะกับสารที่ใช้ (เช่น ถุงมือไนไตรล์กับฟอร์มาลีน แว่น หน้ากาก) มีพร้อมใช้', 'FMS.05.00 ME 5', false),
  ('walk', 'FMS05', 'FMS 05 วัสดุอันตรายและของเสีย (Hazardous Materials & Waste)', 13, 'ไส้กรองหน้ากากกันสารเคมีติดป้ายวันเปิดใช้และวันหมดอายุ', 'FMS.05.00 ME 5', false),
  ('walk', 'FMS05', 'FMS 05 วัสดุอันตรายและของเสีย (Hazardous Materials & Waste)', 14, 'Eyewash / Safety shower เดินถึงภายใน 10 วินาที ไม่มีสิ่งกีดขวาง และมีบันทึก Flush รายสัปดาห์', 'FMS.05.00 ME 5', true),
  ('walk', 'FMS05', 'FMS 05 วัสดุอันตรายและของเสีย (Hazardous Materials & Waste)', 15, 'เจ้าหน้าที่ตอบได้: ขั้นตอนเมื่อสารเคมีหรือสารคัดหลั่งหก และการล้างตาเมื่อสารเข้าตา', 'FMS.05.00 ME 5', false),
  ('walk', 'FMS06', 'FMS 06 อัคคีภัย (Fire Safety)', 1, 'ป้าย/แผนผัง RACE และ PASS ติดในจุดที่เห็นชัด สภาพดี', 'FMS.06.00 ME 1', false),
  ('walk', 'FMS06', 'FMS 06 อัคคีภัย (Fire Safety)', 2, 'พื้นที่เสี่ยงสูง (OR, ICU, CCU, LR, NICU, IVF) มีแผนดับเพลิงและอพยพเฉพาะพื้นที่ รวมลำดับการเคลื่อนย้าย', 'FMS.06.00 ME 1', true),
  ('walk', 'FMS06', 'FMS 06 อัคคีภัย (Fire Safety)', 3, 'ไม่ใช้เครื่องใช้ไฟฟ้าความร้อนที่ไม่ได้รับอนุญาต และไม่สูบบุหรี่นอกจุดที่กำหนด', 'FMS.06.00 ME 1', false),
  ('walk', 'FMS06', 'FMS 06 อัคคีภัย (Fire Safety)', 4, 'เจ้าหน้าที่ทุกกะรวม Outsource ตอบได้: Code Red, RACE, PASS และชี้ถังดับเพลิง/ทางหนีไฟที่ใกล้ที่สุด', 'FMS.06.00 ME 1', true),
  ('walk', 'FMS06', 'FMS 06 อัคคีภัย (Fire Safety)', 5, 'ห้อง Generator ห้องไฟฟ้า จุดควบคุม Solar/Inverter และ EV Charger มีอุปกรณ์ดับเพลิงที่เหมาะสมและเข้าถึงได้ปลอดภัย', 'FMS.06.00 ME 3', false),
  ('walk', 'FMS06', 'FMS 06 อัคคีภัย (Fire Safety)', 6, 'ห้องผ่าตัด/หัตถการประเมินความเสี่ยง Surgical fire และมีบันทึกการซ้อมตามบทบาทจริง', 'FMS.06.00 ME 3', false),
  ('walk', 'FMS06', 'FMS 06 อัคคีภัย (Fire Safety)', 7, 'อุปกรณ์ตรวจจับควัน/ความร้อนไม่ถูกคลุม มีรหัสอุปกรณ์ และทดสอบตามรอบ', 'FMS.06.01 ME 1', false),
  ('walk', 'FMS06', 'FMS 06 อัคคีภัย (Fire Safety)', 8, 'สถานีแจ้งเหตุด้วยมือ (Manual pull / Break glass) เข้าถึงได้ ไม่ถูกบัง มีป้าย', 'FMS.06.01 ME 1', false),
  ('walk', 'FMS06', 'FMS 06 อัคคีภัย (Fire Safety)', 9, 'เสียงแจ้งเหตุเพลิงไหม้ได้ยินชัดในพื้นที่ รวมห้องปิด', 'FMS.06.01 ME 1', true),
  ('walk', 'FMS06', 'FMS 06 อัคคีภัย (Fire Safety)', 10, 'ตู้สายฉีดน้ำดับเพลิง (FHC) เปิดได้ ไม่มีของวางหน้าตู้ สายและหัวฉีดครบ มีบันทึกการตรวจ', 'FMS.06.01 ME 2', false),
  ('walk', 'FMS06', 'FMS 06 อัคคีภัย (Fire Safety)', 11, 'แรงดันน้ำดับเพลิงถึงเกณฑ์ (ดูเกจที่ตู้ชั้นบนสุดหรือ Roof manifold)', 'FMS.06.01 ME 2', true),
  ('walk', 'FMS06', 'FMS 06 อัคคีภัย (Fire Safety)', 12, 'หัว Sprinkler สะอาด ไม่ถูกทาสีหรือคลุม และของวางสูงห่างหัวอย่างน้อย 18 นิ้ว (45 ซม.)', 'FMS.06.01 ME 2', true),
  ('walk', 'FMS06', 'FMS 06 อัคคีภัย (Fire Safety)', 13, 'ท่อดับเพลิงทาสีแดงหรือมีป้ายระบุ หัวรับน้ำดับเพลิงมีป้ายบอกโซนที่จ่าย', 'FMS.06.01 ME 2', false),
  ('walk', 'FMS06', 'FMS 06 อัคคีภัย (Fire Safety)', 14, 'ทางหนีไฟและบันไดหนีไฟโล่ง ไม่มีเตียง รถเข็น หรือของวางกีดขวาง', 'FMS.06.01 ME 3', true),
  ('walk', 'FMS06', 'FMS 06 อัคคีภัย (Fire Safety)', 15, 'ประตูหนีไฟเปิดกลับเข้าชั้นได้ (Re-entry) หรือมีป้ายบอกชั้นที่กลับเข้าได้', 'FMS.06.01 ME 3', false),
  ('walk', 'FMS06', 'FMS 06 อัคคีภัย (Fire Safety)', 16, 'ประตูที่ล็อกด้วยระบบควบคุมการเข้าออกปลดล็อกเมื่อมีสัญญาณเพลิงไหม้ หรือมี Break glass พร้อมป้าย', 'FMS.06.01 ME 3', true),
  ('walk', 'FMS06', 'FMS 06 อัคคีภัย (Fire Safety)', 17, 'บันไดหนีไฟมีกันลื่นที่ขั้นบันได ราวจับ แสงสว่าง และระบบอัดอากาศ/ระบายอากาศทำงาน', 'FMS.06.01 ME 3', false),
  ('walk', 'FMS06', 'FMS 06 อัคคีภัย (Fire Safety)', 18, 'ป้ายทางออกฉุกเฉิน (Exit) ติดสว่าง ครบทุกจุด ไม่ถูกถอดหรือถูกบัง', 'FMS.06.01 ME 4', true),
  ('walk', 'FMS06', 'FMS 06 อัคคีภัย (Fire Safety)', 19, 'ผังหนีไฟ "ท่านอยู่ที่นี่" ตรงกับพื้นที่จริง เป็นปัจจุบัน และระบุจุดรวมพล', 'FMS.06.01 ME 4', false),
  ('walk', 'FMS06', 'FMS 06 อัคคีภัย (Fire Safety)', 20, 'ไฟฉุกเฉินทำงาน ครอบคลุมโถงบันไดหนีไฟ ห้องเครื่อง และห้องเครื่องลิฟต์', 'FMS.06.01 ME 5', true),
  ('walk', 'FMS06', 'FMS 06 อัคคีภัย (Fire Safety)', 21, 'ประตูหนีไฟปิดสนิทได้เอง (โช้คทำงาน) ไม่ถูกยันหรือผูกให้เปิดค้าง', 'FMS.06.01 ME 6', true),
  ('walk', 'FMS06', 'FMS 06 อัคคีภัย (Fire Safety)', 22, 'ผนัง ฝ้า ช่องท่อทะลุ ปิด Fire-stop เรียบร้อย ไม่มีช่องเปิดเหนือฝ้าหรือช่องแนวดิ่งในห้องไฟฟ้า', 'FMS.06.01 ME 6', true),
  ('walk', 'FMS06', 'FMS 06 อัคคีภัย (Fire Safety)', 23, 'ถังดับเพลิงชนิดเหมาะกับพื้นที่ เข็มอยู่เขตเขียว สลักและซีลครบ ป้ายตรวจรายเดือนเป็นปัจจุบัน ไม่ถูกบัง', 'FMS.06.02 ME 1', false),
  ('walk', 'FMS06', 'FMS 06 อัคคีภัย (Fire Safety)', 24, 'วาล์วโซนน้ำดับเพลิงอยู่ในตำแหน่งเปิด มีป้าย และล็อกกันปิด', 'FMS.06.02 ME 1', false),
  ('walk', 'FMS06', 'FMS 06 อัคคีภัย (Fire Safety)', 25, 'Fire damper / Smoke damper มีบันทึกการตรวจทดสอบตามรอบ', 'FMS.06.02 ME 2', false),
  ('walk', 'FMS06', 'FMS 06 อัคคีภัย (Fire Safety)', 26, 'Fire pump มีผลทดสอบเดินเครื่องรายสัปดาห์และ Flow test ประจำปี', 'FMS.06.02 ME 2', true),
  ('walk', 'FMS06', 'FMS 06 อัคคีภัย (Fire Safety)', 27, 'อุปกรณ์/ระบบดับเพลิงที่ชำรุดถูกแจ้งซ่อมทันที และระหว่างรอซ่อมมีมาตรการชั่วคราว (ILSM) ติดประกาศ', 'FMS.06.02 ME 3', true),
  ('walk', 'FMS07', 'FMS 07 เครื่องมือแพทย์ (Medical Equipment)', 1, 'ผู้ใช้งานผ่านการอบรมเครื่องที่ใช้ประจำ และมีหลักฐานการอบรม', 'FMS.07.00 ME 1', false),
  ('walk', 'FMS07', 'FMS 07 เครื่องมือแพทย์ (Medical Equipment)', 2, 'เครื่องสำคัญต่อชีวิตเสียบเต้ารับไฟฉุกเฉิน สายไฟและปลั๊กไม่ชำรุด', 'FMS.07.00 ME 1', false),
  ('walk', 'FMS07', 'FMS 07 เครื่องมือแพทย์ (Medical Equipment)', 3, 'ห้อง MRI แบ่ง Zone I–IV มีป้ายเตือน และคัดกรองโลหะก่อนเข้า', 'FMS.07.00 ME 1', false),
  ('walk', 'FMS07', 'FMS 07 เครื่องมือแพทย์ (Medical Equipment)', 4, 'เครื่องมือแพทย์ทุกเครื่องมีสติกเกอร์ PM/สอบเทียบ และยังไม่เกินกำหนด', 'FMS.07.00 ME 2', false),
  ('walk', 'FMS07', 'FMS 07 เครื่องมือแพทย์ (Medical Equipment)', 5, 'สุ่ม 1–3 เครื่อง ดึงประวัติ PM และใบสอบเทียบมาแสดงได้ภายใน 15 นาที (Reverse-Tracer)', 'FMS.07.00 ME 2', true),
  ('walk', 'FMS07', 'FMS 07 เครื่องมือแพทย์ (Medical Equipment)', 6, 'เครื่องช่วยชีวิต (Defibrillator/AED, Ventilator, Suction) ตรวจความพร้อมทุกกะ มีบันทึก', 'FMS.07.00 ME 2', true),
  ('walk', 'FMS07', 'FMS 07 เครื่องมือแพทย์ (Medical Equipment)', 7, 'ตู้เย็นยา วัคซีน ตู้เก็บเลือด ตู้แช่ศพ: อุณหภูมิในเกณฑ์ บันทึกทุกวัน มี Alarm และ Corrective action เมื่อหลุดเกณฑ์', 'FMS.07.00 ME 2', true),
  ('walk', 'FMS07', 'FMS 07 เครื่องมือแพทย์ (Medical Equipment)', 8, 'เครื่องวัดอุณหภูมิ ความชื้น แรงดัน ที่ใช้บันทึกค่า มีใบสอบเทียบ', 'FMS.07.00 ME 2', false),
  ('walk', 'FMS07', 'FMS 07 เครื่องมือแพทย์ (Medical Equipment)', 9, 'เครื่องที่มีประกาศเรียกคืน (Recall) หรือแจ้งอันตราย ถูกตรวจสอบและหยุดใช้ตามระบบ', 'FMS.07.01 ME 1', true),
  ('walk', 'FMS07', 'FMS 07 เครื่องมือแพทย์ (Medical Equipment)', 10, 'เครื่องชำรุด/รอซ่อมติดป้าย "ห้ามใช้" แยกเก็บ และมีใบแจ้งซ่อม', 'FMS.07.01 ME 3', false),
  ('walk', 'FMS07', 'FMS 07 เครื่องมือแพทย์ (Medical Equipment)', 11, 'เจ้าหน้าที่ตอบได้: ทำอย่างไรเมื่อเครื่องเสียหรือเกิดอุบัติการณ์จากเครื่องมือ', 'FMS.07.01 ME 3', false),
  ('walk', 'FMS07', 'FMS 07 เครื่องมือแพทย์ (Medical Equipment)', 12, 'เครื่องจี้ไฟฟ้า (Electrosurgery) มีเครื่องดูดควันหรือการระบายอากาศเหมาะสม มีนโยบายและการอบรมผู้ใช้', 'HCT.02.00 ME 4', false),
  ('walk', 'FMS08', 'FMS 08 ระบบสาธารณูปโภค (Utility Systems)', 1, 'ระบบ BMS/BAS แจ้งเตือนค่าผิดปกติ มีผู้รับ Alarm และบันทึกการแก้ไข', 'FMS.08.00 ME 2', false),
  ('walk', 'FMS08', 'FMS 08 ระบบสาธารณูปโภค (Utility Systems)', 2, 'ผังระบบสาธารณูปโภค (Single line ไฟฟ้า ผังท่อน้ำ ก๊าซ ลม) ฉบับปัจจุบันมีที่ห้องควบคุม/ห้องเครื่อง', 'FMS.08.00 ME 3', false),
  ('walk', 'FMS08', 'FMS 08 ระบบสาธารณูปโภค (Utility Systems)', 3, 'ห้องเครื่อง (Chiller, ปั๊ม, ไฟฟ้า, Gen) สะอาด ไม่มีของเก็บ แสงสว่างพอ มีป้ายสถานะเครื่องจักร', 'FMS.08.00 ME 4', false),
  ('walk', 'FMS08', 'FMS 08 ระบบสาธารณูปโภค (Utility Systems)', 4, 'ไม่มีน้ำรั่วหรือท่อรั่วใกล้ตู้ไฟฟ้า ห้อง Server หรือเครื่องมือแพทย์', 'FMS.08.00 ME 4', true),
  ('walk', 'FMS08', 'FMS 08 ระบบสาธารณูปโภค (Utility Systems)', 5, 'ลิฟต์มีใบตรวจสอบประจำปีติดในลิฟต์ ปุ่มและโทรศัพท์ฉุกเฉินใช้ได้ ห้องเครื่องลิฟต์มีไฟฉุกเฉิน', 'FMS.08.00 ME 4', false),
  ('walk', 'FMS08', 'FMS 08 ระบบสาธารณูปโภค (Utility Systems)', 6, 'ระบบบำบัดน้ำเสียทำงานได้ตามประสิทธิภาพ มีบันทึกค่าควบคุมประจำวัน', 'FMS.08.00 ME 4', false),
  ('walk', 'FMS08', 'FMS 08 ระบบสาธารณูปโภค (Utility Systems)', 7, 'ตู้ไฟฟ้า/แผงควบคุมปิดฝา ล็อก มีตารางวงจร หน้าตู้โล่งอย่างน้อย 1 เมตร', 'FMS.08.00 ME 5', false),
  ('walk', 'FMS08', 'FMS 08 ระบบสาธารณูปโภค (Utility Systems)', 8, 'ก๊าซทางการแพทย์: Zone valve มีป้ายบอกห้องที่ควบคุม ไม่ถูกกีดขวาง ท่อติดป้ายสีและชื่อก๊าซ', 'FMS.08.00 ME 5', true),
  ('walk', 'FMS08', 'FMS 08 ระบบสาธารณูปโภค (Utility Systems)', 9, 'ท่อระบบต่าง ๆ ติดป้ายชื่อและทิศทางการไหล วาล์วมีป้ายปกติเปิด/ปกติปิด', 'FMS.08.00 ME 5', false),
  ('walk', 'FMS08', 'FMS 08 ระบบสาธารณูปโภค (Utility Systems)', 10, 'เต้ารับไฟฉุกเฉินแยกสีชัด ใช้งานได้ และผู้ใช้รู้ว่าเต้าไหนต่อ Generator/UPS', 'FMS.08.01 ME 1', false),
  ('walk', 'FMS08', 'FMS 08 ระบบสาธารณูปโภค (Utility Systems)', 11, 'Alarm ก๊าซทางการแพทย์ทำงาน เจ้าหน้าที่รู้ว่าใครปิดวาล์วและต้องแจ้งใคร', 'FMS.08.01 ME 1', true),
  ('walk', 'FMS08', 'FMS 08 ระบบสาธารณูปโภค (Utility Systems)', 12, 'หน่วยงานมีแผนรับมือระบบล้มเหลว (ไฟดับ น้ำไม่ไหล ก๊าซหมด ลิฟต์ค้าง) และเจ้าหน้าที่ตอบได้', 'FMS.08.01 ME 1', true),
  ('walk', 'FMS08', 'FMS 08 ระบบสาธารณูปโภค (Utility Systems)', 13, 'แหล่งน้ำสำรอง (ถังสำรอง บ่อ รถน้ำ) มีผลทดสอบปริมาณและคุณภาพอย่างน้อยปีละครั้ง', 'FMS.08.01 ME 2', false),
  ('walk', 'FMS08', 'FMS 08 ระบบสาธารณูปโภค (Utility Systems)', 14, 'Generator ทดสอบเดินเครื่องมีโหลดตามรอบ ไฟเข้าภายใน 10 วินาที และบันทึกชั่วโมงน้ำมันสำรอง', 'FMS.08.01 ME 3', true),
  ('walk', 'FMS08', 'FMS 08 ระบบสาธารณูปโภค (Utility Systems)', 15, 'UPS ห้องสำคัญ (OR, ICU, Server) ทดสอบตามรอบ มีบันทึก', 'FMS.08.01 ME 3', false),
  ('walk', 'FMS08', 'FMS 08 ระบบสาธารณูปโภค (Utility Systems)', 16, 'ตู้น้ำดื่มมี PM และผลตรวจเชื้อรายไตรมาสครบทุกหัวจ่าย', 'FMS.08.02 ME 1', false),
  ('walk', 'FMS08', 'FMS 08 ระบบสาธารณูปโภค (Utility Systems)', 17, 'Water Management Program: ผลตรวจ Legionella (Cooling tower, น้ำร้อน) และคลอรีนตกค้างตามรอบ', 'FMS.08.02 ME 3', true),
  ('walk', 'FMS08', 'FMS 08 ระบบสาธารณูปโภค (Utility Systems)', 18, 'น้ำ RO ไตเทียม/CSSD มีผล Conductivity, Endotoxin และแบคทีเรียตามรอบ', 'FMS.08.03 ME 2', true),
  ('walk', 'FMS08', 'FMS 08 ระบบสาธารณูปโภค (Utility Systems)', 19, 'ห้องแรงดันลบ (AIIR) ไม่น้อยกว่า 2.5 Pa / ห้องแรงดันบวกถึงเกณฑ์ ค่าที่จดแกว่งจริง และเกจมีใบสอบเทียบ', 'FMS.08.04 ME 1', true),
  ('walk', 'FMS08', 'FMS 08 ระบบสาธารณูปโภค (Utility Systems)', 20, 'อุณหภูมิน้ำร้อนและไอน้ำควบคุมตามเกณฑ์ (ลดเชื้อ Legionella และป้องกันน้ำร้อนลวก) มีบันทึก', 'FMS.08.04 ME 2', false),
  ('walk', 'FMS08', 'FMS 08 ระบบสาธารณูปโภค (Utility Systems)', 21, 'อุณหภูมิ/ความชื้นห้องสำคัญ (OR, ห้องเก็บเวชภัณฑ์, CSSD, ห้องยา) อยู่ในเกณฑ์ มีบันทึกและ Corrective action เมื่อหลุด', 'FMS.08.04 ME 3', true),
  ('walk', 'FMS08', 'FMS 08 ระบบสาธารณูปโภค (Utility Systems)', 22, 'หัวจ่ายลม/ช่องลมกลับและ Filter สะอาด ทิศทางลมจากพื้นที่สะอาดไปพื้นที่ปนเปื้อนถูกต้อง', 'FMS.08.04 ME 3', false),
  ('walk', 'FMS09', 'FMS 09 ภาวะฉุกเฉินและภัยพิบัติ (Emergency & Disaster)', 1, 'มีแผนรับมือภาวะฉุกเฉินของหน่วยงาน (Code ต่าง ๆ) ฉบับปัจจุบัน และเข้าถึงได้ทันที', 'FMS.09.00 ME 1', false),
  ('walk', 'FMS09', 'FMS 09 ภาวะฉุกเฉินและภัยพิบัติ (Emergency & Disaster)', 2, 'เบอร์โทรฉุกเฉินและผังการแจ้งเหตุติดที่จุดเห็นชัด', 'FMS.09.00 ME 1', false),
  ('walk', 'FMS09', 'FMS 09 ภาวะฉุกเฉินและภัยพิบัติ (Emergency & Disaster)', 3, 'อุปกรณ์อพยพผู้ป่วย (เปลสนาม, Evacuation chair/sheet) พร้อมใช้ และเจ้าหน้าที่รู้ที่เก็บ', 'FMS.09.00 ME 1', false),
  ('walk', 'FMS09', 'FMS 09 ภาวะฉุกเฉินและภัยพิบัติ (Emergency & Disaster)', 4, 'ไฟฉาย วิทยุสื่อสาร และอุปกรณ์สำรองยามฉุกเฉินพร้อมใช้', 'FMS.09.00 ME 1', false),
  ('walk', 'FMS09', 'FMS 09 ภาวะฉุกเฉินและภัยพิบัติ (Emergency & Disaster)', 5, 'เจ้าหน้าที่ตอบ Code Blue / Red / Pink และบทบาทของตนเองได้ (Q&A card ประจำจุด)', 'FMS.09.00 ME 1', true),
  ('walk', 'FMS09', 'FMS 09 ภาวะฉุกเฉินและภัยพิบัติ (Emergency & Disaster)', 6, 'ประเมินความเสี่ยงภัยพิบัติของพื้นที่ (น้ำท่วม พายุ ไฟฟ้าดับนาน) และมีมาตรการรองรับ', 'FMS.09.00 ME 2', false),
  ('walk', 'FMS09', 'FMS 09 ภาวะฉุกเฉินและภัยพิบัติ (Emergency & Disaster)', 7, 'มีบันทึกการซ้อมแผนในรอบปีครบทุกกะ (รวม Outsource) และมีการประเมินผลหลังซ้อม', 'FMS.09.00 ME 3', true),
  ('walk', 'FMS09', 'FMS 09 ภาวะฉุกเฉินและภัยพิบัติ (Emergency & Disaster)', 8, 'จุดคัดกรองผู้ป่วยโรคติดต่อ (ARI) จุดแรกรับ และการจำกัดทางเข้าเมื่อมีโรคระบาด พร้อมใช้', 'FMS.09.01 ME 3', false),
  ('walk', 'FMS09', 'FMS 09 ภาวะฉุกเฉินและภัยพิบัติ (Emergency & Disaster)', 9, 'มีแผนและการซ้อม Downtime กรณีระบบ HIS/EMR หรือ BMS ล่ม', 'HCT.01.04 ME 1', false),
  ('walk', 'FMS10', 'FMS 10 ก่อสร้างและปรับปรุง (Construction & Renovation / ICRA)', 1, 'งานก่อสร้าง/ซ่อมในพื้นที่มีใบอนุญาตทำงาน (Work Permit) และ ICRA Permit ติดหน้างาน', 'FMS.10.00 ME 1', true),
  ('walk', 'FMS10', 'FMS 10 ก่อสร้างและปรับปรุง (Construction & Renovation / ICRA)', 2, 'ประเมินผลกระทบต่อระบบ (ไฟฟ้า น้ำ ลม ก๊าซ) และแจ้งหน่วยงานที่เกี่ยวข้องล่วงหน้า', 'FMS.10.00 ME 1', false),
  ('walk', 'FMS10', 'FMS 10 ก่อสร้างและปรับปรุง (Construction & Renovation / ICRA)', 3, 'กั้นพื้นที่ทึบกันฝุ่นตามระดับ ICRA มีแรงดันลบหรือ HEPA ตามความเสี่ยง', 'FMS.10.00 ME 2', true),
  ('walk', 'FMS10', 'FMS 10 ก่อสร้างและปรับปรุง (Construction & Renovation / ICRA)', 4, 'มีมาตรการ ILSM เมื่อปิดระบบดับเพลิงหรือทางหนีไฟระหว่างงาน', 'FMS.10.00 ME 2', true),
  ('walk', 'FMS10', 'FMS 10 ก่อสร้างและปรับปรุง (Construction & Renovation / ICRA)', 5, 'งานร้อน (Hot work) มีใบอนุญาตและผู้เฝ้าระวังไฟตลอดเวลา', 'FMS.10.00 ME 2', false),
  ('walk', 'FMS10', 'FMS 10 ก่อสร้างและปรับปรุง (Construction & Renovation / ICRA)', 6, 'ผู้รับเหมาติดบัตร ผ่านปฐมนิเทศความปลอดภัย และลงชื่อเข้า-ออก', 'FMS.10.00 ME 3', false),
  ('walk', 'FMS10', 'FMS 10 ก่อสร้างและปรับปรุง (Construction & Renovation / ICRA)', 7, 'หลังเสร็จงานทำความสะอาด ไม่มีเศษวัสดุ แผ่นฝ้าที่เปิดถูกปิดคืน และตรวจรับงานแล้ว', 'FMS.10.00 ME 3', false),
  ('tracer', 'TR1', 'TR1 Reverse-Tracer 10 จุดสุ่ม ดึงหลักฐานใน 15 นาที', 1, 'เกจห้องแรงดันลบ (AIIR) / ห้องผ่าตัด: ดึงบันทึกแรงดันรายกะ ใบสอบเทียบเกจ และ PM AHU ได้ภายใน 15 นาที', 'FMS.08.04 ME 1', true),
  ('tracer', 'TR1', 'TR1 Reverse-Tracer 10 จุดสุ่ม ดึงหลักฐานใน 15 นาที', 2, 'ตู้เย็นเก็บยา / ตู้เก็บเลือด: ดึงบันทึกอุณหภูมิ ผลทดสอบ Alarm และ Corrective action ได้ภายใน 15 นาที', 'FMS.07.00 ME 2', true),
  ('tracer', 'TR1', 'TR1 Reverse-Tracer 10 จุดสุ่ม ดึงหลักฐานใน 15 นาที', 3, 'Zone valve ก๊าซทางการแพทย์: มีผังวาล์ว-ห้องที่คุม PM และรายชื่อผู้มีอำนาจสั่งปิด', 'FMS.08.00 ME 5', true),
  ('tracer', 'TR1', 'TR1 Reverse-Tracer 10 จุดสุ่ม ดึงหลักฐานใน 15 นาที', 4, 'ถังดับเพลิง / ตู้สายฉีด: มี Tag ตรวจรายเดือนตรงกับทะเบียนถัง', 'FMS.06.02 ME 1', true),
  ('tracer', 'TR1', 'TR1 Reverse-Tracer 10 จุดสุ่ม ดึงหลักฐานใน 15 นาที', 5, 'ประตูหนีไฟ / Fire-Smoke damper: มีบันทึกตรวจประตูและผลทดสอบ Damper ตามรอบ', 'FMS.06.02 ME 2', true),
  ('tracer', 'TR1', 'TR1 Reverse-Tracer 10 จุดสุ่ม ดึงหลักฐานใน 15 นาที', 6, 'พัดลมดูดอากาศห้องผ้าเปื้อน / ห้องขยะ: มี PM และผลวัดทิศทางลม', 'FMS.08.04 ME 3', false),
  ('tracer', 'TR1', 'TR1 Reverse-Tracer 10 จุดสุ่ม ดึงหลักฐานใน 15 นาที', 7, 'Generator / ATS: มีผล Load test รับโหลดภายใน 10 วินาที และชั่วโมงน้ำมันสำรอง', 'FMS.08.01 ME 3', true),
  ('tracer', 'TR1', 'TR1 Reverse-Tracer 10 จุดสุ่ม ดึงหลักฐานใน 15 นาที', 8, 'Eyewash / Emergency shower: มีบันทึก Flush รายสัปดาห์ และเดินถึงภายใน 10 วินาที', 'FMS.05.00 ME 5', true),
  ('tracer', 'TR1', 'TR1 Reverse-Tracer 10 จุดสุ่ม ดึงหลักฐานใน 15 นาที', 9, 'จุดจ่ายน้ำ RO ไตเทียม / CSSD: มีผล Conductivity, Endotoxin และเชื้อตามรอบ', 'FMS.08.03 ME 2', true),
  ('tracer', 'TR1', 'TR1 Reverse-Tracer 10 จุดสุ่ม ดึงหลักฐานใน 15 นาที', 10, 'AED / เครื่องมือช่วยชีวิต: มี PM และผล Safety test ไม่เกินกำหนด', 'FMS.07.00 ME 2', true),
  ('tracer', 'TR1', 'TR1 Reverse-Tracer 10 จุดสุ่ม ดึงหลักฐานใน 15 นาที', 11, 'สติกเกอร์ PM/สอบเทียบที่ตัวอุปกรณ์ตรงกับข้อมูลในระบบ (ไม่ตรง = ไม่ผ่าน)', 'FMS.08.00 ME 4', true),
  ('tracer', 'TR7', 'TR7 Reverse-Tracer เครื่องจักรความเสี่ยงสูง (FMEA)', 1, 'เครื่องมีป้าย/สติกเกอร์ TAG และ PM ครั้งล่าสุดไม่เกินกำหนด', 'FMS.08.00 ME 4', false),
  ('tracer', 'TR7', 'TR7 Reverse-Tracer เครื่องจักรความเสี่ยงสูง (FMEA)', 2, 'ห้องวิศวกรรมดึงประวัติ PM ย้อนหลังของเครื่องนี้มาแสดงได้ภายใน 15 นาที', 'FMS.08.00 ME 4', true),
  ('tracer', 'TR7', 'TR7 Reverse-Tracer เครื่องจักรความเสี่ยงสูง (FMEA)', 3, 'มีผลทดสอบตามรอบล่าสุด (เช่น Gen มีโหลดรายเดือน, Fire pump รายสัปดาห์, FACP) และผลอยู่ในเกณฑ์', 'FMS.08.01 ME 3', true),
  ('tracer', 'TR7', 'TR7 Reverse-Tracer เครื่องจักรความเสี่ยงสูง (FMEA)', 4, 'ใบรับรอง/ใบสอบเทียบ/ผลตรวจตามกฎหมายของเครื่องยังไม่หมดอายุ', 'FMS.01.00 ME 1', false),
  ('tracer', 'TR7', 'TR7 Reverse-Tracer เครื่องจักรความเสี่ยงสูง (FMEA)', 5, 'เหตุขัดข้องหรือค่าผิดปกติครั้งล่าสุดมีใบแจ้งซ่อมและบันทึก Corrective action ปิดแล้ว', 'FMS.06.02 ME 3', false),
  ('tracer', 'TR7', 'TR7 Reverse-Tracer เครื่องจักรความเสี่ยงสูง (FMEA)', 6, 'มีสัญญา MA/ผู้รับเหมาเข้า PM ตามรอบ และมีรายงานการเข้า PM ครั้งล่าสุด', 'FMS.08.00 ME 4', false),
  ('tracer', 'TR7', 'TR7 Reverse-Tracer เครื่องจักรความเสี่ยงสูง (FMEA)', 7, 'เครื่องอยู่ในทะเบียนความเสี่ยง (FMEA) และมีแผนทดแทนตามอายุใช้งาน', 'FMS.01.00 ME 3', false),
  ('tracer', 'TR7', 'TR7 Reverse-Tracer เครื่องจักรความเสี่ยงสูง (FMEA)', 8, 'ช่างประจำกะอธิบายวิธีปิดฉุกเฉิน/สลับไปเครื่องสำรองได้ และจุดควบคุมมีป้าย', 'FMS.08.00 ME 5', false),
  ('tracer', 'TR2', 'TR2 กวาด Zero-Red 5 จุด (หลายแผนก ตามแนว SAF Matrix)', 1, 'ฝ้าไม่ชำรุด ไม่มีคราบน้ำ และเหนือฝ้าปิด Fire-stop เรียบร้อย', 'FMS.06.01 ME 6', true),
  ('tracer', 'TR2', 'TR2 กวาด Zero-Red 5 จุด (หลายแผนก ตามแนว SAF Matrix)', 2, 'ของวางสูงห่างหัว Sprinkler อย่างน้อย 18 นิ้ว (45 ซม.)', 'FMS.06.01 ME 2', true),
  ('tracer', 'TR2', 'TR2 กวาด Zero-Red 5 จุด (หลายแผนก ตามแนว SAF Matrix)', 3, 'ตู้สารเคมี ตู้ยา High-alert ห้องขยะ และห้องผ้าเปื้อน ปิดล็อก', 'FMS.05.00 ME 3', true),
  ('tracer', 'TR2', 'TR2 กวาด Zero-Red 5 จุด (หลายแผนก ตามแนว SAF Matrix)', 4, 'ค่าอุณหภูมิ ความชื้น แรงดัน ที่หลุดเกณฑ์มีบันทึก Corrective action ทุกครั้ง', 'FMS.08.04 ME 3', true),
  ('tracer', 'TR2', 'TR2 กวาด Zero-Red 5 จุด (หลายแผนก ตามแนว SAF Matrix)', 5, 'ทางหนีไฟและประตูหนีไฟไม่มีเตียง รถเข็น หรือของกีดขวาง', 'FMS.06.01 ME 3', true),
  ('tracer', 'TR3', 'TR3 3-Shift Micro-Drill: ถาม-ตอบทุกกะ รวม Outsource', 1, 'ตอบ Code Red และขั้นตอน RACE ได้ถูกต้อง', 'FMS.06.00 ME 1', true),
  ('tracer', 'TR3', 'TR3 3-Shift Micro-Drill: ถาม-ตอบทุกกะ รวม Outsource', 2, 'สาธิตการใช้ถังดับเพลิงแบบ PASS และชี้ถังที่ใกล้ที่สุดได้', 'FMS.06.00 ME 1', true),
  ('tracer', 'TR3', 'TR3 3-Shift Micro-Drill: ถาม-ตอบทุกกะ รวม Outsource', 3, 'บอกเส้นทางหนีไฟและจุดรวมพลของพื้นที่ได้', 'FMS.06.01 ME 3', false),
  ('tracer', 'TR3', 'TR3 3-Shift Micro-Drill: ถาม-ตอบทุกกะ รวม Outsource', 4, 'ตอบ Code Blue / Code Pink และบทบาทของตนเองได้', 'FMS.09.00 ME 1', false),
  ('tracer', 'TR3', 'TR3 3-Shift Micro-Drill: ถาม-ตอบทุกกะ รวม Outsource', 5, 'ไฟดับ/ก๊าซทางการแพทย์ขัดข้อง: บอกได้ว่าใช้เต้ารับสีแดง ใครปิด Zone valve และแจ้งใคร', 'FMS.08.01 ME 1', true),
  ('tracer', 'TR3', 'TR3 3-Shift Micro-Drill: ถาม-ตอบทุกกะ รวม Outsource', 6, 'สารเคมี/สารคัดหลั่งหก: บอกขั้นตอน ที่ตั้ง Spill kit และ Eyewash ได้', 'FMS.05.00 ME 5', false),
  ('tracer', 'TR3', 'TR3 3-Shift Micro-Drill: ถาม-ตอบทุกกะ รวม Outsource', 7, 'บอกวิธีแจ้งซ่อมและแจ้งความเสี่ยงด้านอาคารได้', 'FMS.03.00 ME 1', false),
  ('tracer', 'TR3', 'TR3 3-Shift Micro-Drill: ถาม-ตอบทุกกะ รวม Outsource', 8, 'ไฟดับทั้งอาคารและ Gen ไม่ติด: ช่างกะและพยาบาล ICU/OR บอกขั้นตอนที่ต้องทำได้', 'FMS.09.00 ME 1', true),
  ('tracer', 'TR3', 'TR3 3-Shift Micro-Drill: ถาม-ตอบทุกกะ รวม Outsource', 9, 'AIIR แรงดันตก: บอกได้ว่าค่าเท่าไรถือว่าผิดปกติ และเห็นแล้วแจ้งใคร', 'FMS.08.04 ME 1', true),
  ('tracer', 'TR3', 'TR3 3-Shift Micro-Drill: ถาม-ตอบทุกกะ รวม Outsource', 10, 'BMS / ระบบควบคุมอาคารล่ม: ช่าง BMS และ IT บอกวิธีเฝ้าระวังแทนระบบได้', 'HCT.01.04 ME 1', false),
  ('tracer', 'TR3', 'TR3 3-Shift Micro-Drill: ถาม-ตอบทุกกะ รวม Outsource', 11, 'ช่าง/รปภ./แม่บ้าน Outsource มีแฟ้มอบรม Orientation และ Competency ตรงหน้าที่ ยังไม่หมดอายุ', 'FMS.01.01 ME 2', false),
  ('tracer', 'TR4', 'TR4 ตามรอยงานผู้รับเหมา Work Permit / ICRA', 1, 'ใบอนุญาตทำงาน (Work Permit) ฉบับอนุมัติแล้ว ติดหน้างาน และตรงกับงานที่ทำจริง', 'FMS.10.00 ME 3', true),
  ('tracer', 'TR4', 'TR4 ตามรอยงานผู้รับเหมา Work Permit / ICRA', 2, 'มี JSA / ประเมินความเสี่ยงงาน และ ICRA/PCRA ก่อนเริ่มงาน', 'FMS.10.00 ME 1', true),
  ('tracer', 'TR4', 'TR4 ตามรอยงานผู้รับเหมา Work Permit / ICRA', 3, 'รายชื่อคนงานหน้างานตรงกับใบอนุญาต ติดบัตร และเช็คอินที่ป้อม รปภ. แล้ว', 'FMS.10.00 ME 3', false),
  ('tracer', 'TR4', 'TR4 ตามรอยงานผู้รับเหมา Work Permit / ICRA', 4, 'กั้นพื้นที่ทึบกันฝุ่น แรงดันลบ/HEPA ตามระดับ ICRA และป้ายเตือน', 'FMS.10.00 ME 2', true),
  ('tracer', 'TR4', 'TR4 ตามรอยงานผู้รับเหมา Work Permit / ICRA', 5, 'งานร้อน: เคลียร์วัสดุติดไฟ มีถังดับเพลิง ผู้เฝ้าระวังไฟ และตรวจก๊าซติดไฟก่อนเริ่ม', 'FMS.10.00 ME 2', true),
  ('tracer', 'TR4', 'TR4 ตามรอยงานผู้รับเหมา Work Permit / ICRA', 6, 'งานตัดแยกพลังงาน: ล็อกและติดป้าย (LOTO) ทดสอบว่าไม่มีพลังงานค้าง และคืนสภาพหลังเสร็จ', 'FMS.10.00 ME 2', true),
  ('tracer', 'TR4', 'TR4 ตามรอยงานผู้รับเหมา Work Permit / ICRA', 7, 'งานที่อับอากาศ: ตรวจวัดก๊าซ มีระบายอากาศ ผู้เฝ้าทางเข้า และอุปกรณ์ช่วยเหลือ', 'FMS.10.00 ME 2', true),
  ('tracer', 'TR4', 'TR4 ตามรอยงานผู้รับเหมา Work Permit / ICRA', 8, 'หยุดระบบดับเพลิง/แจ้งเหตุระหว่างงาน: มีใบควบคุมการหยุดระบบ มาตรการ ILSM แจ้ง รปภ./ทีมดับเพลิง และทดสอบคืนระบบ', 'FMS.06.00 ME 2', true),
  ('tracer', 'TR4', 'TR4 ตามรอยงานผู้รับเหมา Work Permit / ICRA', 9, 'คนงานสวม PPE ตรงตามใบอนุญาต และมีรายงานประจำวัน', 'FMS.10.00 ME 3', false),
  ('tracer', 'TR4', 'TR4 ตามรอยงานผู้รับเหมา Work Permit / ICRA', 10, 'เมื่อเสร็จงาน: ทำความสะอาด ปิดฝ้า ตรวจรับงาน และปิดใบอนุญาต', 'FMS.10.00 ME 3', false),
  ('tracer', 'TR5', 'TR5 ตามรอยสถานการณ์ระบบล้มเหลว (Utility failure)', 1, 'ไฟฟ้าดับ: มีบันทึก Gen รับโหลดภายใน 10 วินาที และ ATS ทำงาน (ผลทดสอบล่าสุด)', 'FMS.08.01 ME 3', true),
  ('tracer', 'TR5', 'TR5 ตามรอยสถานการณ์ระบบล้มเหลว (Utility failure)', 2, 'ไฟฟ้าดับ: ห้องสำคัญ (OR, ICU, Server) มี UPS และเต้ารับไฟฉุกเฉินใช้ได้จริง', 'FMS.08.01 ME 1', true),
  ('tracer', 'TR5', 'TR5 ตามรอยสถานการณ์ระบบล้มเหลว (Utility failure)', 3, 'ก๊าซทางการแพทย์: มีถังสำรอง/Manifold พร้อมปริมาณสำรอง และ Alarm แจ้งเตือนทำงาน', 'FMS.08.01 ME 1', true),
  ('tracer', 'TR5', 'TR5 ตามรอยสถานการณ์ระบบล้มเหลว (Utility failure)', 4, 'น้ำไม่ไหล: มีแหล่งน้ำสำรอง ปริมาณสำรองกี่วัน และแผนจ่ายน้ำฉุกเฉิน', 'FMS.08.01 ME 2', false),
  ('tracer', 'TR5', 'TR5 ตามรอยสถานการณ์ระบบล้มเหลว (Utility failure)', 5, 'ลิฟต์ค้าง: มีขั้นตอนช่วยเหลือผู้โดยสาร ผู้รับผิดชอบ และเบอร์ติดต่อ', 'FMS.09.00 ME 1', false),
  ('tracer', 'TR5', 'TR5 ตามรอยสถานการณ์ระบบล้มเหลว (Utility failure)', 6, 'BMS/HIS ล่ม: มีแผน Downtime และบันทึกการซ้อมในรอบปี', 'HCT.01.04 ME 1', false),
  ('tracer', 'TR5', 'TR5 ตามรอยสถานการณ์ระบบล้มเหลว (Utility failure)', 7, 'ผลการซ้อมระบบล้มเหลวมีการประเมินและนำไปปรับแผน', 'FMS.09.00 ME 3', false),
  ('tracer', 'TR6', 'TR6 จุดที่ผู้ตรวจแพทย์/พยาบาลเพ่งเล็ง (Integrated tracer)', 1, 'OR / Cath Lab / ICU: อุณหภูมิ ความชื้น และแรงดันห้องอยู่ในเกณฑ์ และย้อนดูบันทึกได้', 'FMS.08.04 ME 3', true),
  ('tracer', 'TR6', 'TR6 จุดที่ผู้ตรวจแพทย์/พยาบาลเพ่งเล็ง (Integrated tracer)', 2, 'ห้องแยกโรคแรงดันลบ (AIIR) ไม่น้อยกว่า 2.5 Pa เกจมีใบสอบเทียบ และพยาบาลบอกสัญญาณเตือนได้', 'FMS.08.04 ME 1', true),
  ('tracer', 'TR6', 'TR6 จุดที่ผู้ตรวจแพทย์/พยาบาลเพ่งเล็ง (Integrated tracer)', 3, 'น้ำ RO ไตเทียม/CSSD มีผล Bacteria/Endotoxin รายเดือน ย้อนดูได้', 'FMS.08.03 ME 2', true),
  ('tracer', 'TR6', 'TR6 จุดที่ผู้ตรวจแพทย์/พยาบาลเพ่งเล็ง (Integrated tracer)', 4, 'ตู้เก็บเลือด/ตู้เย็นยามี Alarm ทำงาน และมีบันทึกการแก้ไขเมื่ออุณหภูมิหลุด', 'FMS.07.00 ME 2', true),
  ('tracer', 'TR6', 'TR6 จุดที่ผู้ตรวจแพทย์/พยาบาลเพ่งเล็ง (Integrated tracer)', 5, 'ห้อง MRI แบ่ง Zone I–IV ป้ายเตือน และมีการคัดกรองโลหะ', 'FMS.07.00 ME 1', false),
  ('tracer', 'TR6', 'TR6 จุดที่ผู้ตรวจแพทย์/พยาบาลเพ่งเล็ง (Integrated tracer)', 6, 'Eyewash ในพื้นที่ใช้สารเคมีเดินถึงภายใน 10 วินาที และมีบันทึก Flush รายสัปดาห์', 'FMS.05.00 ME 5', true),
  ('tracer', 'TR6', 'TR6 จุดที่ผู้ตรวจแพทย์/พยาบาลเพ่งเล็ง (Integrated tracer)', 7, 'งานซ่อมในหอผู้ป่วยมี ICRA และกั้นพื้นที่ตามระดับความเสี่ยง', 'FMS.10.00 ME 2', true),
  ('tracer', 'TR8', 'TR8 สัญญา SLA และงานค้าง (ผู้ตรวจดูงาน Outsource)', 1, 'งานแจ้งซ่อมค้างเกิน 60 วัน = 0 หรือทุกใบมีเหตุผลและวันแล้วเสร็จที่วางแผนไว้', 'FMS.01.01 ME 2', true),
  ('tracer', 'TR8', 'TR8 สัญญา SLA และงานค้าง (ผู้ตรวจดูงาน Outsource)', 2, 'ตั้ง SLA ตามระดับความเร่งด่วนในสัญญา และมีรายงาน Response time รายสัปดาห์', 'FMS.01.01 ME 2', false),
  ('tracer', 'TR8', 'TR8 สัญญา SLA และงานค้าง (ผู้ตรวจดูงาน Outsource)', 3, 'อัตราปิดงานรายเดือนไม่ต่ำกว่า 95% และมีการติดตามงานที่เข้าพื้นที่ไม่ได้', 'FMS.01.01 ME 2', false),
  ('tracer', 'TR8', 'TR8 สัญญา SLA และงานค้าง (ผู้ตรวจดูงาน Outsource)', 4, 'ตรวจระบบประจำวันครบทุกรายการ และค่าที่ผิดปกติมีการแก้ไข (Corrective action)', 'FMS.08.00 ME 4', true),
  ('tracer', 'TR8', 'TR8 สัญญา SLA และงานค้าง (ผู้ตรวจดูงาน Outsource)', 5, 'ผล KPI ตามสัญญารายเดือนผ่านเกณฑ์ และมีรายงานส่งผู้ว่าจ้าง', 'FMS.01.01 ME 2', false),
  ('tracer', 'TR8', 'TR8 สัญญา SLA และงานค้าง (ผู้ตรวจดูงาน Outsource)', 6, 'งานจ้างที่เสร็จไม่ทันวันตรวจ มีมาตรการชั่วคราว (ILSM) PO และตารางงานเป็นหลักฐาน', 'FMS.06.00 ME 2', true)
) v(kind, cat, cat_name, no, text, ref, red)
where not exists (select 1 from public.fms_items where hospital_id is null);
