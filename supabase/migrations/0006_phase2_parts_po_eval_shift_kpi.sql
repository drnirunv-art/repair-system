-- Phase 2 (additive only): spare parts, purchase orders, job evaluation,
-- shift schedule, monthly KPI per contract TOR.

-- spare parts ------------------------------------------------------------
create table public.parts (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null references public.hospitals(id),
  code text not null,
  name text not null,
  unit text not null default 'ชิ้น',
  category text,
  min_qty numeric not null default 0,
  qty numeric not null default 0,
  unit_cost numeric not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (hospital_id, code)
);

create table public.part_moves (
  id bigint generated always as identity primary key,
  hospital_id uuid not null references public.hospitals(id),
  part_id uuid not null references public.parts(id),
  qty numeric not null,               -- + receive, - issue
  kind text not null check (kind in ('receive','issue','adjust','return')),
  job_id uuid references public.jobs(id),
  po_id uuid,
  note text,
  actor_id uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now()
);
create index part_moves_part_idx on public.part_moves (part_id, created_at desc);
create index part_moves_job_idx on public.part_moves (job_id) where job_id is not null;

-- purchase orders --------------------------------------------------------
create type public.po_status as enum ('draft','requested','approved','ordered','received','cancel');

create table public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null references public.hospitals(id),
  po_no text not null,
  job_id uuid references public.jobs(id),
  supplier text,
  status public.po_status not null default 'draft',
  note text,
  requested_by uuid references public.profiles(id) default auth.uid(),
  approved_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  approved_at timestamptz, ordered_at timestamptz, received_at timestamptz,
  unique (hospital_id, po_no)
);

create table public.po_items (
  id bigint generated always as identity primary key,
  po_id uuid not null references public.purchase_orders(id) on delete cascade,
  part_id uuid references public.parts(id),
  description text not null,
  qty numeric not null check (qty > 0),
  unit text not null default 'ชิ้น',
  unit_price numeric not null default 0
);

-- job evaluation by the reporter -----------------------------------------
create table public.job_evaluations (
  job_id uuid primary key references public.jobs(id) on delete cascade,
  hospital_id uuid not null references public.hospitals(id),
  score int not null check (score between 1 and 5),
  comment text,
  created_at timestamptz not null default now()
);

-- shift schedule ---------------------------------------------------------
create table public.shifts (
  id bigint generated always as identity primary key,
  hospital_id uuid not null references public.hospitals(id),
  staff_id uuid not null references public.profiles(id),
  work_date date not null,
  shift text not null check (shift in ('day','evening','night','off','leave')),
  note text,
  unique (hospital_id, staff_id, work_date)
);

-- monthly KPI (TOR ข้อ 12 / แนบ 4) ---------------------------------------
create table public.kpi_monthly (
  id bigint generated always as identity primary key,
  hospital_id uuid not null references public.hospitals(id),
  month date not null,                 -- first day of month
  item text not null,                  -- e.g. 'PM ตามแผน'
  target text,
  actual numeric,
  score numeric,
  max_score numeric,
  note text,
  updated_at timestamptz not null default now(),
  unique (hospital_id, month, item)
);

-- RLS --------------------------------------------------------------------
alter table public.parts enable row level security;
alter table public.part_moves enable row level security;
alter table public.purchase_orders enable row level security;
alter table public.po_items enable row level security;
alter table public.job_evaluations enable row level security;
alter table public.shifts enable row level security;
alter table public.kpi_monthly enable row level security;

create policy "parts staff read" on public.parts for select to authenticated using (hospital_id = public.my_hospital());
create policy "parts managed" on public.parts for all to authenticated
  using (hospital_id = public.my_hospital() and public.is_manager()) with check (hospital_id = public.my_hospital() and public.is_manager());
create policy "moves staff read" on public.part_moves for select to authenticated using (hospital_id = public.my_hospital());
create policy "po staff read" on public.purchase_orders for select to authenticated using (hospital_id = public.my_hospital());
create policy "po staff insert" on public.purchase_orders for insert to authenticated with check (hospital_id = public.my_hospital());
create policy "po managed" on public.purchase_orders for update to authenticated
  using (hospital_id = public.my_hospital() and public.is_manager()) with check (hospital_id = public.my_hospital());
create policy "po items read" on public.po_items for select to authenticated
  using (exists (select 1 from public.purchase_orders p where p.id = po_id and p.hospital_id = public.my_hospital()));
create policy "po items write" on public.po_items for all to authenticated
  using (exists (select 1 from public.purchase_orders p where p.id = po_id and p.hospital_id = public.my_hospital() and p.status in ('draft','requested')))
  with check (exists (select 1 from public.purchase_orders p where p.id = po_id and p.hospital_id = public.my_hospital() and p.status in ('draft','requested')));
create policy "eval staff read" on public.job_evaluations for select to authenticated using (hospital_id = public.my_hospital());
create policy "shifts staff read" on public.shifts for select to authenticated using (hospital_id = public.my_hospital());
create policy "shifts managed" on public.shifts for all to authenticated
  using (hospital_id = public.my_hospital() and public.is_manager()) with check (hospital_id = public.my_hospital() and public.is_manager());
create policy "kpi staff read" on public.kpi_monthly for select to authenticated using (hospital_id = public.my_hospital());
create policy "kpi managed" on public.kpi_monthly for all to authenticated
  using (hospital_id = public.my_hospital() and public.is_manager()) with check (hospital_id = public.my_hospital() and public.is_manager());

-- RPCs -------------------------------------------------------------------
-- technician issues / returns a part on a job; keeps stock in sync
create or replace function public.move_part(p_part_id uuid, p_qty numeric, p_kind text, p_job_id uuid default null, p_note text default null, p_po_id uuid default null)
returns numeric language plpgsql security definer set search_path = public as $$
declare h uuid := public.my_hospital(); v_qty numeric;
begin
  if h is null then raise exception 'not staff'; end if;
  if p_kind not in ('issue','return','receive','adjust') then raise exception 'bad kind'; end if;
  if p_kind in ('receive','adjust') and not public.is_manager() then raise exception 'manager only'; end if;
  if p_kind = 'issue' then p_qty := -abs(p_qty); elsif p_kind in ('return','receive') then p_qty := abs(p_qty); end if;
  update parts set qty = qty + p_qty where id = p_part_id and hospital_id = h returning qty into v_qty;
  if v_qty is null then raise exception 'part not found'; end if;
  if v_qty < 0 then raise exception 'stock not enough'; end if;
  insert into part_moves (hospital_id, part_id, qty, kind, job_id, po_id, note) values (h, p_part_id, p_qty, p_kind, p_job_id, p_po_id, p_note);
  if p_job_id is not null then update jobs set uses_parts = true where id = p_job_id and hospital_id = h; end if;
  return v_qty;
end $$;

-- PO number <HOSP>-PO-<BE YYMM>-<001>
create or replace function public.create_po(p_supplier text, p_note text default null, p_job_id uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare h uuid := public.my_hospital(); v_code text; v_pre text; v_n int; v_id uuid;
begin
  if h is null then raise exception 'not staff'; end if;
  select code into v_code from hospitals where id = h;
  v_pre := v_code || '-PO-' || to_char(now() at time zone 'Asia/Bangkok' + interval '543 years', 'YYMM') || '-';
  select coalesce(max(substring(po_no from length(v_pre) + 1)::int), 0) + 1 into v_n
    from purchase_orders where hospital_id = h and po_no like v_pre || '%';
  insert into purchase_orders (hospital_id, po_no, supplier, note, job_id, status)
    values (h, v_pre || lpad(v_n::text, 3, '0'), p_supplier, p_note, p_job_id, 'requested') returning id into v_id;
  return v_id;
end $$;

-- receive a PO: stock in every item that is linked to a part
create or replace function public.receive_po(p_po_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare h uuid := public.my_hospital(); r record;
begin
  if not public.is_manager() then raise exception 'manager only'; end if;
  update purchase_orders set status = 'received', received_at = now()
    where id = p_po_id and hospital_id = h and status in ('approved','ordered');
  if not found then raise exception 'PO not ready'; end if;
  for r in select part_id, qty from po_items where po_id = p_po_id and part_id is not null loop
    perform public.move_part(r.part_id, r.qty, 'receive', null, 'รับของตาม PO', p_po_id);
  end loop;
end $$;

-- reporter rates a finished job (anon, must know job no + phone)
create or replace function public.evaluate_job(p_job_no text, p_phone text, p_score int, p_comment text default null)
returns text language plpgsql security definer set search_path = public as $$
declare j record;
begin
  select id, hospital_id, status into j from jobs
   where job_no = upper(trim(p_job_no)) and regexp_replace(reporter_phone, '\D', '', 'g') = regexp_replace(p_phone, '\D', '', 'g');
  if j.id is null then raise exception 'ไม่พบใบงาน หรือเบอร์โทรไม่ตรง'; end if;
  if j.status not in ('clear','close') then raise exception 'งานยังไม่เสร็จ'; end if;
  if p_score not between 1 and 5 then raise exception 'คะแนน 1-5'; end if;
  insert into job_evaluations (job_id, hospital_id, score, comment) values (j.id, j.hospital_id, p_score, left(p_comment, 500))
    on conflict (job_id) do update set score = excluded.score, comment = excluded.comment, created_at = now();
  update jobs set evaluated_at = now() where id = j.id;
  insert into job_events (job_id, status, note) values (j.id, j.status, 'ผู้แจ้งประเมิน ' || p_score || '/5');
  return 'ok';
end $$;

revoke all on function public.move_part(uuid, numeric, text, uuid, text, uuid) from public, anon;
revoke all on function public.create_po(text, text, uuid) from public, anon;
revoke all on function public.receive_po(uuid) from public, anon;
grant execute on function public.move_part(uuid, numeric, text, uuid, text, uuid) to authenticated;
grant execute on function public.create_po(text, text, uuid) to authenticated;
grant execute on function public.receive_po(uuid) to authenticated;
grant execute on function public.evaluate_job(text, text, int, text) to anon, authenticated;

grant select, insert, update, delete on public.parts, public.purchase_orders, public.po_items, public.shifts, public.kpi_monthly to authenticated;
grant select on public.part_moves, public.job_evaluations to authenticated;
