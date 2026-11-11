-- 0014 Phase B (additive only): spare parts store, part issue on jobs (stock cut), purchase requests (PR),
-- memos with a register, approver inbox decisions. Replaces the unapplied draft 0006 (parts/PO part only).
-- Writes to stock and documents go through security-definer RPCs so stock cannot be edited by hand.

-- running numbers per hospital, kind and Buddhist-era month: PT1-PR-6911-001 ------------------
create table if not exists public.doc_counters (
  hospital_id uuid not null references public.hospitals(id) on delete cascade,
  kind text not null,
  period text not null,
  last_no int not null default 0,
  primary key (hospital_id, kind, period)
);
alter table public.doc_counters enable row level security;  -- no policies: only the RPCs below touch it

create or replace function public.next_doc_no(p_hospital uuid, p_kind text) returns text
language plpgsql security definer set search_path = public as $$
declare v_code text; v_period text := to_char(now() at time zone 'Asia/Bangkok' + interval '543 years', 'YYMM'); v_n int;
begin
  select code into v_code from hospitals where id = p_hospital;
  insert into doc_counters (hospital_id, kind, period, last_no) values (p_hospital, p_kind, v_period, 1)
    on conflict (hospital_id, kind, period) do update set last_no = doc_counters.last_no + 1
    returning last_no into v_n;
  return v_code || '-' || p_kind || '-' || v_period || '-' || lpad(v_n::text, 3, '0');
end $$;
revoke execute on function public.next_doc_no(uuid, text) from public, anon, authenticated;

-- spare parts ---------------------------------------------------------------------------------
create table if not exists public.parts (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null references public.hospitals(id) on delete cascade,
  code text not null,
  name text not null,
  unit text not null default 'ชิ้น',
  category text,
  store text,
  min_qty numeric not null default 0 check (min_qty >= 0),
  qty numeric not null default 0 check (qty >= 0),
  unit_cost numeric not null default 0 check (unit_cost >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (hospital_id, code)
);
create table if not exists public.part_moves (
  id bigint generated always as identity primary key,
  hospital_id uuid not null references public.hospitals(id) on delete cascade,
  part_id uuid not null references public.parts(id),
  kind text not null check (kind in ('receive','issue','return','adjust')),
  qty numeric not null,                       -- signed: + into store, - out of store
  qty_after numeric not null,
  unit_cost numeric not null default 0,
  job_id uuid references public.jobs(id),
  equipment_id uuid references public.equipment(id),
  equipment_text text,
  pr_id uuid,
  note text,
  actor_id uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists part_moves_part_idx on public.part_moves (part_id, created_at desc);
create index if not exists part_moves_job_idx on public.part_moves (job_id) where job_id is not null;
create index if not exists part_moves_hosp_idx on public.part_moves (hospital_id, created_at desc);

alter table public.parts enable row level security;
alter table public.part_moves enable row level security;
create policy "parts staff read" on public.parts for select to authenticated using (hospital_id = public.my_hospital());
create policy "parts managers add" on public.parts for insert to authenticated
  with check (hospital_id = public.my_hospital() and public.is_manager() and qty = 0);
create policy "parts managers edit" on public.parts for update to authenticated
  using (hospital_id = public.my_hospital() and public.is_manager()) with check (hospital_id = public.my_hospital());
create policy "moves staff read" on public.part_moves for select to authenticated using (hospital_id = public.my_hospital());
grant select on public.parts, public.part_moves to authenticated;
grant insert (hospital_id, code, name, unit, category, store, min_qty, unit_cost) on public.parts to authenticated;
grant update (code, name, unit, category, store, min_qty, unit_cost, active) on public.parts to authenticated;

-- one entry point for stock: issue / return (any staff but observer), receive / adjust (managers)
-- adjust takes the counted quantity; the others take a positive amount
create or replace function public.part_move(p_part_id uuid, p_kind text, p_qty numeric, p_job_id uuid default null,
  p_note text default null, p_unit_cost numeric default null, p_pr_id uuid default null)
returns numeric language plpgsql security definer set search_path = public as $$
declare h uuid := public.my_hospital(); r app_role := public.my_role(); p parts; j jobs; v_delta numeric; v_after numeric;
begin
  if h is null or r is null or r = 'observer' then raise exception 'บัญชีนี้ไม่มีสิทธิ์เบิกหรือรับอะไหล่'; end if;
  if p_kind not in ('issue','return','receive','adjust') then raise exception 'ไม่รู้จักรายการ %', p_kind; end if;
  if p_kind in ('receive','adjust') and not public.is_manager() then raise exception 'รับเข้าและปรับยอดได้เฉพาะหัวหน้า'; end if;
  if p_qty is null or p_qty < 0 or (p_kind <> 'adjust' and p_qty = 0) then raise exception 'ใส่จำนวนให้ถูกต้อง'; end if;
  select * into p from parts where id = p_part_id and hospital_id = h for update;
  if p.id is null then raise exception 'ไม่พบอะไหล่'; end if;
  if p_job_id is not null then
    select * into j from jobs where id = p_job_id and hospital_id = h;
    if j.id is null then raise exception 'ไม่พบใบงาน'; end if;
    if j.status in ('close','cancel') then raise exception 'ใบงานปิดหรือยกเลิกแล้ว เบิกอะไหล่ไม่ได้'; end if;
  end if;
  v_delta := case p_kind when 'issue' then -p_qty when 'adjust' then p_qty - p.qty else p_qty end;
  v_after := p.qty + v_delta;
  if v_after < 0 then raise exception 'สต็อก % เหลือ % % ไม่พอเบิก', p.name, p.qty, p.unit; end if;
  update parts set qty = v_after,
    unit_cost = case when p_kind = 'receive' and coalesce(p_unit_cost, 0) > 0 then p_unit_cost else unit_cost end
  where id = p.id;
  insert into part_moves (hospital_id, part_id, kind, qty, qty_after, unit_cost, job_id, equipment_id, equipment_text, pr_id, note)
  values (h, p.id, p_kind, v_delta, v_after,
    case when p_kind = 'receive' and coalesce(p_unit_cost, 0) > 0 then p_unit_cost else p.unit_cost end,
    j.id, j.equipment_id, j.equipment_text, p_pr_id, nullif(trim(coalesce(p_note, '')), ''));
  if j.id is not null then
    update jobs set uses_parts = true where id = j.id and uses_parts is distinct from true;
    insert into job_events (job_id, status, note, actor_id) values (j.id, j.status,
      case when p_kind = 'issue' then 'เบิกอะไหล่ ' else 'คืนอะไหล่ ' end || p.name || ' ' || p_qty || ' ' || p.unit, auth.uid());
  end if;
  return v_after;
end $$;
revoke execute on function public.part_move(uuid, text, numeric, uuid, text, numeric, uuid) from public, anon;
grant execute on function public.part_move(uuid, text, numeric, uuid, text, numeric, uuid) to authenticated;

-- purchase requests ----------------------------------------------------------------------------
create table if not exists public.purchase_requests (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null references public.hospitals(id) on delete cascade,
  pr_no text not null unique,
  job_id uuid references public.jobs(id),
  reason text not null,
  supplier text,
  need_by date,
  status text not null default 'requested' check (status in ('requested','approved','rejected','ordered','received','cancel')),
  total numeric not null default 0,
  requested_by uuid references public.profiles(id) default auth.uid(),
  decided_by uuid references public.profiles(id),
  decided_at timestamptz,
  decision_note text,
  ordered_at timestamptz,
  received_at timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists public.pr_items (
  id bigint generated always as identity primary key,
  pr_id uuid not null references public.purchase_requests(id) on delete cascade,
  part_id uuid references public.parts(id),
  description text not null,
  qty numeric not null check (qty > 0),
  unit text not null default 'ชิ้น',
  unit_price numeric not null default 0 check (unit_price >= 0)
);
create index if not exists pr_hosp_idx on public.purchase_requests (hospital_id, created_at desc);
create index if not exists pr_items_pr_idx on public.pr_items (pr_id);
alter table public.purchase_requests enable row level security;
alter table public.pr_items enable row level security;
create policy "pr staff read" on public.purchase_requests for select to authenticated using (hospital_id = public.my_hospital());
create policy "pr items staff read" on public.pr_items for select to authenticated
  using (exists (select 1 from public.purchase_requests x where x.id = pr_id and x.hospital_id = public.my_hospital()));
grant select on public.purchase_requests, public.pr_items to authenticated;

-- p_items: [{part_id?, description, qty, unit, unit_price}]
create or replace function public.pr_create(p_job_id uuid, p_reason text, p_supplier text, p_need_by date, p_items jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare h uuid := public.my_hospital(); r app_role := public.my_role(); v_id uuid; v_no text; it jsonb; p parts; j jobs; v_total numeric := 0;
begin
  if h is null or r is null or r = 'observer' then raise exception 'บัญชีนี้ไม่มีสิทธิ์ขอซื้อ'; end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then raise exception 'ใส่เหตุผลที่ขอซื้อ'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'ใส่รายการที่จะซื้ออย่างน้อย 1 รายการ'; end if;
  if p_job_id is not null then
    select * into j from jobs where id = p_job_id and hospital_id = h;
    if j.id is null then raise exception 'ไม่พบใบงาน'; end if;
  end if;
  v_no := public.next_doc_no(h, 'PR');
  insert into purchase_requests (hospital_id, pr_no, job_id, reason, supplier, need_by)
    values (h, v_no, j.id, trim(p_reason), nullif(trim(coalesce(p_supplier, '')), ''), p_need_by) returning id into v_id;
  for it in select * from jsonb_array_elements(p_items) loop
    p := null;
    if nullif(it->>'part_id', '') is not null then
      select * into p from parts where id = (it->>'part_id')::uuid and hospital_id = h;
      if p.id is null then raise exception 'ไม่พบอะไหล่ในรายการ'; end if;
    end if;
    if coalesce(nullif(trim(it->>'description'), ''), p.name) is null then raise exception 'ใส่ชื่อรายการให้ครบ'; end if;
    if coalesce((it->>'qty')::numeric, 0) <= 0 then raise exception 'จำนวนต้องมากกว่า 0'; end if;
    insert into pr_items (pr_id, part_id, description, qty, unit, unit_price)
      values (v_id, p.id, coalesce(nullif(trim(it->>'description'), ''), p.name), (it->>'qty')::numeric,
        coalesce(nullif(trim(it->>'unit'), ''), p.unit, 'ชิ้น'), greatest(coalesce((it->>'unit_price')::numeric, p.unit_cost, 0), 0));
  end loop;
  select coalesce(sum(qty * unit_price), 0) into v_total from pr_items where pr_id = v_id;
  update purchase_requests set total = v_total where id = v_id;
  if j.id is not null then
    insert into job_events (job_id, status, note, actor_id) values (j.id, j.status, 'ขอซื้อ ' || v_no || ' : ' || trim(p_reason), auth.uid());
  end if;
  return v_no;
end $$;

-- approve / reject (Owner, Admin, Chief Engineer); ordered / received / cancel (managers)
create or replace function public.pr_action(p_pr_id uuid, p_action text, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare h uuid := public.my_hospital(); x purchase_requests; it record; v_new text;
  approver boolean := public.my_role() in ('owner','admin','chief_engineer');
begin
  select * into x from purchase_requests where id = p_pr_id and hospital_id = h for update;
  if x.id is null then raise exception 'ไม่พบใบขอซื้อ'; end if;
  if p_action in ('approve','reject') then
    if not approver then raise exception 'อนุมัติได้เฉพาะ Owner / Admin / Chief Engineer'; end if;
    if x.status <> 'requested' then raise exception 'ใบขอซื้อนี้พิจารณาไปแล้ว'; end if;
    v_new := case p_action when 'approve' then 'approved' else 'rejected' end;
    update purchase_requests set status = v_new, decided_by = auth.uid(), decided_at = now(),
      decision_note = nullif(trim(coalesce(p_note, '')), '') where id = x.id;
  elsif p_action = 'ordered' then
    if not public.is_manager() then raise exception 'เฉพาะหัวหน้า'; end if;
    if x.status <> 'approved' then raise exception 'สั่งซื้อได้หลังอนุมัติแล้ว'; end if;
    update purchase_requests set status = 'ordered', ordered_at = now() where id = x.id; v_new := 'ordered';
  elsif p_action = 'received' then
    if not public.is_manager() then raise exception 'เฉพาะหัวหน้า'; end if;
    if x.status not in ('approved','ordered') then raise exception 'รับของได้หลังอนุมัติแล้ว'; end if;
    update purchase_requests set status = 'received', received_at = now(), ordered_at = coalesce(ordered_at, now()) where id = x.id;
    for it in select part_id, qty, unit_price from pr_items where pr_id = x.id and part_id is not null loop
      perform public.part_move(it.part_id, 'receive', it.qty, null, 'รับของตาม ' || x.pr_no, it.unit_price, x.id);
    end loop;
    v_new := 'received';
  elsif p_action = 'cancel' then
    if not (public.is_manager() or x.requested_by = auth.uid()) then raise exception 'ยกเลิกได้เฉพาะผู้ขอหรือหัวหน้า'; end if;
    if x.status in ('received','cancel') then raise exception 'ยกเลิกไม่ได้'; end if;
    update purchase_requests set status = 'cancel', decision_note = coalesce(nullif(trim(coalesce(p_note, '')), ''), decision_note) where id = x.id;
    v_new := 'cancel';
  else raise exception 'ไม่รู้จักคำสั่ง %', p_action;
  end if;
  if x.job_id is not null then
    insert into job_events (job_id, status, note, actor_id)
    select j.id, j.status, x.pr_no || ' : ' || case v_new when 'approved' then 'อนุมัติแล้ว' when 'rejected' then 'ไม่อนุมัติ'
      when 'ordered' then 'สั่งซื้อแล้ว' when 'received' then 'ได้รับของแล้ว' else 'ยกเลิก' end
      || coalesce(' · ' || nullif(trim(coalesce(p_note, '')), ''), ''), auth.uid()
    from jobs j where j.id = x.job_id;
  end if;
end $$;

-- memos ------------------------------------------------------------------------------------------
create table if not exists public.memos (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null references public.hospitals(id) on delete cascade,
  memo_no text not null unique,
  job_id uuid references public.jobs(id),
  pr_id uuid references public.purchase_requests(id),
  subject text not null,
  to_whom text not null,
  body text not null,
  amount numeric,
  status text not null default 'submitted' check (status in ('submitted','approved','rejected','cancel')),
  created_by uuid references public.profiles(id) default auth.uid(),
  decided_by uuid references public.profiles(id),
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now()
);
create index if not exists memos_hosp_idx on public.memos (hospital_id, created_at desc);
create index if not exists memos_job_idx on public.memos (job_id) where job_id is not null;
alter table public.memos enable row level security;
create policy "memos staff read" on public.memos for select to authenticated using (hospital_id = public.my_hospital());
grant select on public.memos to authenticated;

create or replace function public.memo_create(p_job_id uuid, p_pr_id uuid, p_subject text, p_to text, p_body text, p_amount numeric)
returns text language plpgsql security definer set search_path = public as $$
declare h uuid := public.my_hospital(); r app_role := public.my_role(); v_no text; j jobs; x purchase_requests;
begin
  if h is null or r is null or r = 'observer' then raise exception 'บัญชีนี้ไม่มีสิทธิ์เขียน Memo'; end if;
  if nullif(trim(coalesce(p_subject, '')), '') is null or nullif(trim(coalesce(p_to, '')), '') is null
     or nullif(trim(coalesce(p_body, '')), '') is null then raise exception 'ใส่เรื่อง เรียน และรายละเอียดให้ครบ'; end if;
  if p_job_id is not null then
    select * into j from jobs where id = p_job_id and hospital_id = h;
    if j.id is null then raise exception 'ไม่พบใบงาน'; end if;
  end if;
  if p_pr_id is not null then
    select * into x from purchase_requests where id = p_pr_id and hospital_id = h;
    if x.id is null then raise exception 'ไม่พบใบขอซื้อ'; end if;
  end if;
  v_no := public.next_doc_no(h, 'MEMO');
  insert into memos (hospital_id, memo_no, job_id, pr_id, subject, to_whom, body, amount)
    values (h, v_no, coalesce(j.id, x.job_id), x.id, trim(p_subject), trim(p_to), trim(p_body), p_amount);
  if coalesce(j.id, x.job_id) is not null then
    insert into job_events (job_id, status, note, actor_id)
    select jj.id, jj.status, 'เขียน Memo ' || v_no || ' : ' || trim(p_subject), auth.uid() from jobs jj where jj.id = coalesce(j.id, x.job_id);
  end if;
  return v_no;
end $$;

create or replace function public.memo_action(p_memo_id uuid, p_action text, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare h uuid := public.my_hospital(); m memos; v_new text;
  approver boolean := public.my_role() in ('owner','admin','chief_engineer');
begin
  select * into m from memos where id = p_memo_id and hospital_id = h for update;
  if m.id is null then raise exception 'ไม่พบ Memo'; end if;
  if p_action in ('approve','reject') then
    if not approver then raise exception 'อนุมัติได้เฉพาะ Owner / Admin / Chief Engineer'; end if;
    if m.status <> 'submitted' then raise exception 'Memo นี้พิจารณาไปแล้ว'; end if;
    v_new := case p_action when 'approve' then 'approved' else 'rejected' end;
  elsif p_action = 'cancel' then
    if not (public.is_manager() or m.created_by = auth.uid()) then raise exception 'ยกเลิกได้เฉพาะผู้เขียนหรือหัวหน้า'; end if;
    if m.status <> 'submitted' then raise exception 'ยกเลิกได้เฉพาะ Memo ที่ยังไม่พิจารณา'; end if;
    v_new := 'cancel';
  else raise exception 'ไม่รู้จักคำสั่ง %', p_action;
  end if;
  update memos set status = v_new, decided_by = case when v_new = 'cancel' then decided_by else auth.uid() end,
    decided_at = case when v_new = 'cancel' then decided_at else now() end,
    decision_note = coalesce(nullif(trim(coalesce(p_note, '')), ''), decision_note) where id = m.id;
  if m.job_id is not null then
    insert into job_events (job_id, status, note, actor_id)
    select j.id, j.status, m.memo_no || ' : ' || case v_new when 'approved' then 'อนุมัติ Memo' when 'rejected' then 'ไม่อนุมัติ Memo' else 'ยกเลิก Memo' end
      || coalesce(' · ' || nullif(trim(coalesce(p_note, '')), ''), ''), auth.uid()
    from jobs j where j.id = m.job_id;
  end if;
end $$;

revoke execute on function public.pr_create(uuid, text, text, date, jsonb) from public, anon;
revoke execute on function public.pr_action(uuid, text, text) from public, anon;
revoke execute on function public.memo_create(uuid, uuid, text, text, text, numeric) from public, anon;
revoke execute on function public.memo_action(uuid, text, text) from public, anon;
grant execute on function public.pr_create(uuid, text, text, date, jsonb) to authenticated;
grant execute on function public.pr_action(uuid, text, text) to authenticated;
grant execute on function public.memo_create(uuid, uuid, text, text, text, numeric) to authenticated;
grant execute on function public.memo_action(uuid, text, text) to authenticated;

-- live updates on the staff page (RLS still decides who receives which rows) -----------------------
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['jobs','job_assignees','parts','purchase_requests','memos'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;
