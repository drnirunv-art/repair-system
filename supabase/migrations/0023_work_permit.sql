-- 0023 Contractor work permit, following the WI "ขั้นตอนการปฏิบัติงานกรณีงานปรับปรุง แก้ไข ซ่อมแซม ภายในโรงพยาบาล". Additive only.
-- Flow: engineering opens a permit and sends the contractor its private link → contractor fills the entry request, schedule and
-- attachments → engineering checks documents (kick-off 1) → engineering + safety officer approve (kick-off 2) → each working day:
-- contractor sends manpower / plan / tools / photos, engineering checks and lets work start, security logs badges in and out,
-- contractor sends the end-of-day update → contractor reports the job finished → engineering inspects against TOR / quotation
-- → handover report → closed.
-- Contractors have NO account: every contractor action goes through a function that takes the permit's secret token.

create table if not exists public.wp_permits (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null references public.hospitals(id) on delete cascade,
  permit_no text not null unique,
  token uuid not null unique default gen_random_uuid(),
  title text not null, company text not null,
  contact_name text, contact_phone text, contact_email text,
  area text, start_date date, end_date date, work_hours text, headcount int,
  hazards text[] not null default '{}', hazard_note text,
  schedule text, tools text,
  workers jsonb not null default '[]',        -- [{name, duty}]
  files jsonb not null default '[]',          -- [{name, path}] under docs/WP/<token>/
  status text not null default 'draft' check (status in ('draft','submitted','returned','docs_ok','approved','working','finished','fix','accepted','closed','cancelled')),
  return_note text,
  signs jsonb not null default '{}',          -- docs / eng / safety / security / inspect / handover : {name, at, by}
  kickoff1_at timestamptz, kickoff2_at timestamptz,
  finish_note text, handover_note text,
  created_by uuid references public.profiles(id) default auth.uid(), created_at timestamptz not null default now(),
  submitted_at timestamptz, updated_at timestamptz not null default now()
);
create index if not exists wp_permits_hosp_idx on public.wp_permits (hospital_id, created_at desc);

create table if not exists public.wp_daily (
  id uuid primary key default gen_random_uuid(),
  permit_id uuid not null references public.wp_permits(id) on delete cascade,
  work_date date not null,
  headcount int, plan text, tools text, photos_before jsonb not null default '[]',
  status text not null default 'sent' check (status in ('sent','fix','ok','done')),
  check_note text, checked_by uuid references public.profiles(id), checked_at timestamptz, checked_name text,
  progress text, next_plan text, photos_after jsonb not null default '[]', done_at timestamptz,
  created_at timestamptz not null default now(),
  unique (permit_id, work_date)
);
create table if not exists public.wp_gate (
  id uuid primary key default gen_random_uuid(),
  permit_id uuid not null references public.wp_permits(id) on delete cascade,
  work_date date not null default (now() at time zone 'Asia/Bangkok')::date,
  worker text not null, badge text,
  in_at timestamptz not null default now(), out_at timestamptz,
  in_by uuid references public.profiles(id) default auth.uid(), out_by uuid references public.profiles(id)
);
create index if not exists wp_gate_permit_idx on public.wp_gate (permit_id, work_date);

alter table public.wp_permits enable row level security;
alter table public.wp_daily enable row level security;
alter table public.wp_gate enable row level security;
create policy "wp permits read" on public.wp_permits for select to authenticated using (hospital_id = public.my_hospital() and public.my_role() <> 'observer');
create policy "wp daily read" on public.wp_daily for select to authenticated
  using (exists (select 1 from wp_permits p where p.id = permit_id and p.hospital_id = public.my_hospital() and public.my_role() <> 'observer'));
create policy "wp gate read" on public.wp_gate for select to authenticated
  using (exists (select 1 from wp_permits p where p.id = permit_id and p.hospital_id = public.my_hospital() and public.my_role() <> 'observer'));
grant select on public.wp_permits, public.wp_daily, public.wp_gate to authenticated;

create table if not exists public.wp_counters (hospital_id uuid not null, year int not null, last_no int not null default 0, primary key (hospital_id, year));
alter table public.wp_counters enable row level security;

-- staff side ----------------------------------------------------------------------------------------------------------
create or replace function public.wp_open(p_title text, p_company text, p_contact text, p_phone text, p_email text, p_area text) returns uuid
language plpgsql security definer set search_path = public as $$
declare h uuid := public.my_hospital(); y int := extract(year from now() at time zone 'Asia/Bangkok')::int + 543; n int; v uuid;
begin
  if not public.is_manager() then raise exception 'เปิด Work Permit ได้เฉพาะ Owner / Admin / Chief / หัวหน้าช่าง'; end if;
  if coalesce(trim(p_title), '') = '' or coalesce(trim(p_company), '') = '' then raise exception 'ใส่ชื่องานและชื่อบริษัทผู้รับเหมา'; end if;
  insert into wp_counters (hospital_id, year, last_no) values (h, y, 1)
    on conflict (hospital_id, year) do update set last_no = wp_counters.last_no + 1 returning last_no into n;
  insert into wp_permits (hospital_id, permit_no, title, company, contact_name, contact_phone, contact_email, area)
    values (h, 'WP-' || (select code from hospitals where id = h) || '-' || lpad(n::text, 4, '0') || '/' || y, trim(p_title), trim(p_company),
      nullif(trim(coalesce(p_contact, '')), ''), nullif(trim(coalesce(p_phone, '')), ''), nullif(trim(coalesce(p_email, '')), ''), nullif(trim(coalesce(p_area, '')), ''))
    returning id into v;
  return v;
end $$;
revoke all on function public.wp_open(text, text, text, text, text, text) from public, anon;
grant execute on function public.wp_open(text, text, text, text, text, text) to authenticated;

-- steps by hospital staff:
--  docs_ok (manager; documents complete, kick-off 1 done) · return (manager; send back with a reason)
--  eng / safety / security (kick-off 2 sign-offs; eng = manager, safety = safety officer or manager, security = any staff with a typed name)
--    → status 'approved' once eng and safety have both signed
--  inspect_ok / inspect_fix (manager; after the contractor reports the job finished) · close (manager; handover received)
--  cancel (manager; any time before closed)
create or replace function public.wp_step(p_id uuid, p_step text, p_note text default null) returns text
language plpgsql security definer set search_path = public as $$
declare p wp_permits; r text := public.my_role()::text; v_name text; sg jsonb;
begin
  select * into p from wp_permits where id = p_id and hospital_id = public.my_hospital() for update;
  if p.id is null then raise exception 'ไม่พบ Work Permit'; end if;
  if r is null or r = 'observer' then raise exception 'ไม่มีสิทธิ์'; end if;
  select full_name into v_name from profiles where id = auth.uid();
  sg := jsonb_build_object('name', v_name, 'at', now(), 'by', auth.uid());
  if p_step in ('docs_ok','return','inspect_ok','inspect_fix','close','cancel','eng') and not public.is_manager() then
    raise exception 'ขั้นนี้ทำได้เฉพาะ Owner / Admin / Chief / หัวหน้าช่าง'; end if;
  if p_step = 'docs_ok' then
    if p.status <> 'submitted' then raise exception 'ผู้รับเหมายังไม่ส่งหนังสือขอเข้าพื้นที่'; end if;
    update wp_permits set status = 'docs_ok', signs = signs || jsonb_build_object('docs', sg), kickoff1_at = now(), return_note = null, updated_at = now() where id = p.id;
  elsif p_step = 'return' then
    if p.status not in ('submitted','docs_ok') then raise exception 'ตีกลับได้เฉพาะก่อนอนุมัติเข้าพื้นที่'; end if;
    if coalesce(trim(p_note), '') = '' then raise exception 'ใส่เหตุผลที่ตีกลับ'; end if;
    update wp_permits set status = 'returned', return_note = trim(p_note), signs = '{}', updated_at = now() where id = p.id;
  elsif p_step in ('eng','safety','security') then
    if p.status <> 'docs_ok' then raise exception 'ต้องตรวจเอกสารผ่าน (Kick off ครั้งที่ 1) ก่อน'; end if;
    if p.signs ? p_step then raise exception 'ตำแหน่งนี้ลงนามแล้ว'; end if;
    if p_step = 'safety' and r <> 'safety_officer' and not public.is_manager() then raise exception 'ช่องนี้สำหรับ จป. (Safety Officer) หรือผู้จัดการ'; end if;
    if p_step = 'security' then
      if coalesce(trim(p_note), '') = '' then raise exception 'พิมพ์ชื่อเจ้าหน้าที่ รปภ. ที่รับทราบ'; end if;
      sg := sg || jsonb_build_object('name', trim(p_note));
    end if;
    update wp_permits set signs = signs || jsonb_build_object(p_step, sg), updated_at = now() where id = p.id returning * into p;
    if p.signs ? 'eng' and p.signs ? 'safety' then update wp_permits set status = 'approved', kickoff2_at = now() where id = p.id; end if;
  elsif p_step = 'inspect_ok' then
    if p.status <> 'finished' then raise exception 'ผู้รับเหมายังไม่แจ้งว่างานเสร็จ'; end if;
    update wp_permits set status = 'accepted', signs = signs || jsonb_build_object('inspect', sg), return_note = null, updated_at = now() where id = p.id;
  elsif p_step = 'inspect_fix' then
    if p.status <> 'finished' then raise exception 'ผู้รับเหมายังไม่แจ้งว่างานเสร็จ'; end if;
    if coalesce(trim(p_note), '') = '' then raise exception 'ใส่รายการที่ต้องแก้ไข'; end if;
    update wp_permits set status = 'fix', return_note = trim(p_note), updated_at = now() where id = p.id;
  elsif p_step = 'close' then
    if p.status <> 'accepted' then raise exception 'ต้องตรวจรับงานผ่านก่อน'; end if;
    update wp_permits set status = 'closed', signs = signs || jsonb_build_object('handover', sg), handover_note = nullif(trim(coalesce(p_note, '')), ''), updated_at = now() where id = p.id;
  elsif p_step = 'cancel' then
    if p.status in ('closed','cancelled') then raise exception 'ใบนี้ปิดแล้ว'; end if;
    update wp_permits set status = 'cancelled', return_note = nullif(trim(coalesce(p_note, '')), ''), updated_at = now() where id = p.id;
  else raise exception 'ขั้นไม่ถูกต้อง';
  end if;
  return (select status from wp_permits where id = p.id);
end $$;
revoke all on function public.wp_step(uuid, text, text) from public, anon;
grant execute on function public.wp_step(uuid, text, text) to authenticated;

-- engineering checks the morning report (manpower, tools, documents): ok → work may start, fix → contractor must correct
create or replace function public.wp_daily_check(p_daily uuid, p_ok boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare d wp_daily;
begin
  select d2.* into d from wp_daily d2 join wp_permits p on p.id = d2.permit_id where d2.id = p_daily and p.hospital_id = public.my_hospital() for update of d2;
  if d.id is null then raise exception 'ไม่พบรายงานประจำวัน'; end if;
  if public.my_role() is null or public.my_role() = 'observer' then raise exception 'ไม่มีสิทธิ์'; end if;
  if d.status not in ('sent','fix') then raise exception 'รายงานวันนี้ตรวจแล้ว'; end if;
  if not p_ok and coalesce(trim(p_note), '') = '' then raise exception 'ใส่สิ่งที่ต้องแก้ไข'; end if;
  update wp_daily set status = case when p_ok then 'ok' else 'fix' end, check_note = nullif(trim(coalesce(p_note, '')), ''), checked_by = auth.uid(), checked_at = now(),
    checked_name = (select full_name from profiles where id = auth.uid()) where id = d.id;
  if p_ok then update wp_permits set status = 'working', updated_at = now() where id = d.permit_id and status = 'approved'; end if;
end $$;
revoke all on function public.wp_daily_check(uuid, boolean, text) from public, anon;
grant execute on function public.wp_daily_check(uuid, boolean, text) to authenticated;

-- security desk: badge exchange in / out
create or replace function public.wp_gate_in(p_permit uuid, p_worker text, p_badge text) returns uuid
language plpgsql security definer set search_path = public as $$
declare p wp_permits; v uuid;
begin
  select * into p from wp_permits where id = p_permit and hospital_id = public.my_hospital();
  if p.id is null or public.my_role() is null or public.my_role() = 'observer' then raise exception 'ไม่มีสิทธิ์'; end if;
  if p.status not in ('approved','working','finished','fix') then raise exception 'ใบนี้ยังไม่ได้รับอนุมัติให้เข้าพื้นที่ หรือปิดแล้ว'; end if;
  if coalesce(trim(p_worker), '') = '' then raise exception 'ใส่ชื่อผู้เข้าพื้นที่'; end if;
  insert into wp_gate (permit_id, worker, badge) values (p.id, trim(p_worker), nullif(trim(coalesce(p_badge, '')), '')) returning id into v;
  return v;
end $$;
create or replace function public.wp_gate_out(p_gate uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.my_role() is null or public.my_role() = 'observer' then raise exception 'ไม่มีสิทธิ์'; end if;
  update wp_gate g set out_at = now(), out_by = auth.uid() from wp_permits p where g.id = p_gate and p.id = g.permit_id and p.hospital_id = public.my_hospital() and g.out_at is null;
  if not found then raise exception 'ไม่พบรายการ หรือคืนบัตรแล้ว'; end if;
end $$;
revoke all on function public.wp_gate_in(uuid, text, text) from public, anon;
revoke all on function public.wp_gate_out(uuid) from public, anon;
grant execute on function public.wp_gate_in(uuid, text, text) to authenticated;
grant execute on function public.wp_gate_out(uuid) to authenticated;

-- contractor side: everything by the permit's secret token ---------------------------------------------------------------
create or replace function public.wp_get(p_token uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select to_jsonb(p) - 'created_by' - 'hospital_id' || jsonb_build_object('hospital', (select name from hospitals where id = p.hospital_id),
    'daily', coalesce((select jsonb_agg(to_jsonb(d) - 'checked_by' order by d.work_date desc) from wp_daily d where d.permit_id = p.id), '[]'))
  from wp_permits p where p.token = p_token $$;
revoke all on function public.wp_get(uuid) from public;
grant execute on function public.wp_get(uuid) to anon, authenticated;

-- file lists arrive from the contractor's browser; keep only paths inside this permit's own folder
create or replace function public.wp_files(p_token uuid, p jsonb) returns jsonb
language sql immutable as $$
  select coalesce(jsonb_agg(jsonb_build_object('name', left(coalesce(x->>'name', ''), 150), 'path', x->>'path')), '[]')
  from (select x from jsonb_array_elements(case when jsonb_typeof(p) = 'array' then p else '[]'::jsonb end) x limit 30) s
  where x->>'path' like 'WP/' || p_token::text || '/%' and x->>'path' not like '%..%' $$;

create or replace function public.wp_submit(p_token uuid, p jsonb, p_send boolean default false) returns text
language plpgsql security definer set search_path = public as $$
declare w wp_permits; s date := nullif(p->>'start_date', '')::date; e date := nullif(p->>'end_date', '')::date; v_workers jsonb;
begin
  select * into w from wp_permits where token = p_token for update;
  if w.id is null then raise exception 'ลิงก์ไม่ถูกต้อง'; end if;
  if w.status not in ('draft','returned') then raise exception 'ส่งหนังสือขอเข้าพื้นที่แล้ว แก้ไขไม่ได้ (ติดต่อแผนกวิศวกรรมหากต้องแก้)'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('name', left(trim(x->>'name'), 120), 'duty', left(coalesce(x->>'duty', ''), 120))), '[]') into v_workers
    from (select x from jsonb_array_elements(case when jsonb_typeof(p->'workers') = 'array' then p->'workers' else '[]'::jsonb end) x limit 100) q where coalesce(trim(x->>'name'), '') <> '';
  if p_send then
    if s is null or e is null or e < s then raise exception 'ใส่วันเริ่มและวันสิ้นสุดงานให้ถูกต้อง'; end if;
    if coalesce(trim(p->>'area'), '') = '' then raise exception 'ใส่พื้นที่ปฏิบัติงาน'; end if;
    if coalesce(trim(p->>'schedule'), '') = '' then raise exception 'ใส่แผนดำเนินการ (Schedule)'; end if;
    if jsonb_array_length(v_workers) = 0 then raise exception 'ใส่รายชื่อผู้ปฏิบัติงานอย่างน้อย 1 คน'; end if;
    if coalesce(trim(p->>'contact_name'), '') = '' or coalesce(trim(p->>'contact_phone'), '') = '' then raise exception 'ใส่ชื่อและเบอร์โทรผู้ควบคุมงาน'; end if;
  end if;
  update wp_permits set contact_name = left(nullif(trim(coalesce(p->>'contact_name', '')), ''), 120), contact_phone = left(nullif(trim(coalesce(p->>'contact_phone', '')), ''), 40),
    contact_email = left(nullif(trim(coalesce(p->>'contact_email', '')), ''), 120), area = left(nullif(trim(coalesce(p->>'area', '')), ''), 300),
    start_date = s, end_date = e, work_hours = left(nullif(trim(coalesce(p->>'work_hours', '')), ''), 80), headcount = jsonb_array_length(v_workers),
    hazards = array(select left(x, 40) from jsonb_array_elements_text(case when jsonb_typeof(p->'hazards') = 'array' then p->'hazards' else '[]'::jsonb end) x limit 12),
    hazard_note = left(nullif(trim(coalesce(p->>'hazard_note', '')), ''), 1000), schedule = left(nullif(trim(coalesce(p->>'schedule', '')), ''), 4000),
    tools = left(nullif(trim(coalesce(p->>'tools', '')), ''), 2000), workers = v_workers, files = public.wp_files(p_token, p->'files'),
    status = case when p_send then 'submitted' else status end, submitted_at = case when p_send then now() else submitted_at end, updated_at = now()
  where id = w.id;
  return case when p_send then 'submitted' else w.status end;
end $$;
revoke all on function public.wp_submit(uuid, jsonb, boolean) from public;
grant execute on function public.wp_submit(uuid, jsonb, boolean) to anon, authenticated;

-- morning report (before work) and end-of-day update
create or replace function public.wp_daily_send(p_token uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare w wp_permits; d date := (now() at time zone 'Asia/Bangkok')::date; x wp_daily;
begin
  select * into w from wp_permits where token = p_token;
  if w.id is null then raise exception 'ลิงก์ไม่ถูกต้อง'; end if;
  if w.status not in ('approved','working','fix') then raise exception 'ใบนี้ยังไม่ได้รับอนุมัติให้เข้าพื้นที่ หรือปิดงานแล้ว'; end if;
  if coalesce(trim(p->>'plan'), '') = '' or coalesce((p->>'headcount')::int, 0) <= 0 then raise exception 'ใส่จำนวนคนและแผนงานของวันนี้'; end if;
  select * into x from wp_daily where permit_id = w.id and work_date = d;
  if x.id is not null and x.status in ('ok','done') then raise exception 'รายงานก่อนเริ่มงานของวันนี้ตรวจผ่านแล้ว'; end if;
  insert into wp_daily (permit_id, work_date, headcount, plan, tools, photos_before)
    values (w.id, d, (p->>'headcount')::int, left(trim(p->>'plan'), 2000), left(nullif(trim(coalesce(p->>'tools', '')), ''), 2000), public.wp_files(p_token, p->'photos'))
  on conflict (permit_id, work_date) do update set headcount = excluded.headcount, plan = excluded.plan, tools = excluded.tools, photos_before = excluded.photos_before, status = 'sent';
end $$;
create or replace function public.wp_daily_done(p_token uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare w wp_permits; d date := (now() at time zone 'Asia/Bangkok')::date;
begin
  select * into w from wp_permits where token = p_token;
  if w.id is null then raise exception 'ลิงก์ไม่ถูกต้อง'; end if;
  if coalesce(trim(p->>'progress'), '') = '' then raise exception 'ใส่ผลงานที่ทำได้วันนี้'; end if;
  update wp_daily set progress = left(trim(p->>'progress'), 2000), next_plan = left(nullif(trim(coalesce(p->>'next_plan', '')), ''), 2000),
    photos_after = public.wp_files(p_token, p->'photos'), status = 'done', done_at = now()
  where permit_id = w.id and work_date = d and status in ('ok','done');
  if not found then raise exception 'ยังไม่มีรายงานก่อนเริ่มงานของวันนี้ที่วิศวกรรมตรวจผ่าน'; end if;
end $$;
-- the whole job is finished: ask engineering to inspect (also used again after fixing defects)
create or replace function public.wp_finish(p_token uuid, p_note text) returns void
language plpgsql security definer set search_path = public as $$
begin
  update wp_permits set status = 'finished', finish_note = left(nullif(trim(coalesce(p_note, '')), ''), 2000), updated_at = now() where token = p_token and status in ('working','fix');
  if not found then raise exception 'แจ้งงานเสร็จได้เมื่ออยู่ระหว่างปฏิบัติงานเท่านั้น'; end if;
end $$;
revoke all on function public.wp_daily_send(uuid, jsonb) from public;
revoke all on function public.wp_daily_done(uuid, jsonb) from public;
revoke all on function public.wp_finish(uuid, text) from public;
grant execute on function public.wp_daily_send(uuid, jsonb) to anon, authenticated;
grant execute on function public.wp_daily_done(uuid, jsonb) to anon, authenticated;
grant execute on function public.wp_finish(uuid, text) to anon, authenticated;

-- attachments: private docs bucket, folder WP/<token>/ . The contractor (not logged in) may add files while the permit is open;
-- only hospital staff can read them back (no read policy for the public, so nobody can list the folder and discover other permits' tokens).
create or replace function public.wp_token_open(p_folder text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from wp_permits where token::text = p_folder and status not in ('closed','cancelled')) $$;
create or replace function public.wp_token_mine(p_folder text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from wp_permits where token::text = p_folder and hospital_id = public.my_hospital() and public.my_role() <> 'observer') $$;
grant execute on function public.wp_token_open(text) to anon, authenticated;
grant execute on function public.wp_token_mine(text) to authenticated;
create policy "docs wp contractor upload" on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'docs' and (storage.foldername(objects.name))[1] = 'WP' and public.wp_token_open((storage.foldername(objects.name))[2]));
create policy "docs wp staff read" on storage.objects for select to authenticated
  using (bucket_id = 'docs' and (storage.foldername(objects.name))[1] = 'WP' and public.wp_token_mine((storage.foldername(objects.name))[2]));
