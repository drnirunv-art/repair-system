-- 0020 Cross-hospital parts market (additive only).
-- Flow: pick (consigned or "share" from any stock) → ① purchase memo (buyer) → buyer chief approves → seller chief confirms qty
-- → central approval in rounds (XH-R) → ② purchase order → seller ships (③ delivery note, stock unchanged) → buyer receives
-- → both sides count, and only then stock moves. No prices anywhere in this flow (purchasing adds prices outside the system).
-- Movement status per part from real issue history: FAST / NORMAL / SLOW / NON MOVE / NEW.

-- who is "central" (approver of rounds / central accounting); added by an owner ---------------------------------
create table if not exists public.xh_central (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  can_approve boolean not null default false,
  can_account boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.xh_central enable row level security;
create policy "xh central see self" on public.xh_central for select to authenticated using (profile_id = auth.uid() or public.my_role() = 'owner');
grant select on public.xh_central to authenticated;
insert into public.xh_central (profile_id, can_approve, can_account) select id, true, true from public.profiles where role = 'owner' on conflict do nothing;

create or replace function public.xh_central_of(p_kind text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from xh_central c join profiles p on p.id = c.profile_id where c.profile_id = auth.uid() and p.active
    and ((p_kind = 'approve' and c.can_approve) or (p_kind = 'account' and c.can_account) or (p_kind = 'any' and (c.can_approve or c.can_account)))) $$;
grant execute on function public.xh_central_of(text) to authenticated;

create or replace function public.xh_central_set(p_profile uuid, p_approve boolean, p_account boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.my_role() is distinct from 'owner' then raise exception 'เฉพาะ Owner กำหนดผู้อนุมัติส่วนกลางได้'; end if;
  if not p_approve and not p_account then delete from xh_central where profile_id = p_profile; return; end if;
  insert into xh_central (profile_id, can_approve, can_account) values (p_profile, p_approve, p_account)
    on conflict (profile_id) do update set can_approve = excluded.can_approve, can_account = excluded.can_account;
end $$;
revoke all on function public.xh_central_set(uuid, boolean, boolean) from public, anon;
grant execute on function public.xh_central_set(uuid, boolean, boolean) to authenticated;

-- role groups from the manual: opener = Admin / head technician / Chief; chief = Chief / Owner
create or replace function public.xh_opener() returns boolean language sql stable security definer set search_path = public as
$$ select public.my_role() in ('owner','admin','chief_engineer','supervisor') $$;
create or replace function public.xh_chief() returns boolean language sql stable security definer set search_path = public as
$$ select public.my_role() in ('owner','chief_engineer') $$;
grant execute on function public.xh_opener() to authenticated;
grant execute on function public.xh_chief() to authenticated;

-- movement status from issue history --------------------------------------------------------------------------
create or replace function public.part_use(p_part uuid, p_days int) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(-sum(qty), 0) from part_moves where part_id = p_part and kind = 'issue' and created_at >= now() - make_interval(days => p_days) $$;
create or replace function public.part_movement(p_part uuid) returns text
language plpgsql stable security definer set search_path = public as $$
declare p parts; u3 numeric; u6 numeric;
begin
  select * into p from parts where id = p_part;
  if p.id is null then return null; end if;
  u3 := public.part_use(p.id, 90); u6 := public.part_use(p.id, 180);
  if p.created_at > now() - interval '180 days' and u6 = 0 then return 'NEW'; end if;
  if u6 = 0 then return 'NON MOVE'; end if;
  if u3 >= p.qty and u3 > 0 then return 'FAST'; end if;
  if u3 > 0.1 * p.qty then return 'NORMAL'; end if;
  return 'SLOW';
end $$;
grant execute on function public.part_use(uuid, int) to authenticated;
grant execute on function public.part_movement(uuid) to authenticated;
-- the same part in another hospital: match by code first, then by name ("spec")
create or replace function public.part_match(p_hospital uuid, p_code text, p_name text) returns uuid
language sql stable security definer set search_path = public as $$
  select id from parts where hospital_id = p_hospital and active and (upper(code) = upper(p_code) or lower(trim(name)) = lower(trim(p_name)))
  order by (upper(code) = upper(p_code)) desc limit 1 $$;
grant execute on function public.part_match(uuid, text, text) to authenticated;

-- consignment listings ------------------------------------------------------------------------------------------
create table if not exists public.xh_listings (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null references public.hospitals(id) on delete cascade,
  part_id uuid not null references public.parts(id) on delete cascade,
  qty numeric not null check (qty > 0),
  warranty_until date,
  reason text,
  active boolean not null default true,
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists xh_listings_part_uq on public.xh_listings (part_id) where active;
alter table public.xh_listings enable row level security;
create policy "xh listings read own" on public.xh_listings for select to authenticated using (hospital_id = public.my_hospital());
grant select on public.xh_listings to authenticated;

create or replace function public.xh_list(p_part uuid, p_qty numeric, p_warranty date default null, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
declare p parts;
begin
  if not public.xh_chief() then raise exception 'ฝากขายได้เฉพาะ Chief Engineer / Owner'; end if;
  select * into p from parts where id = p_part and hospital_id = public.my_hospital();
  if p.id is null then raise exception 'ไม่พบอะไหล่'; end if;
  if coalesce(p_qty, 0) <= 0 then update xh_listings set active = false, updated_at = now() where part_id = p.id and active; return; end if;
  if p_qty > p.qty then raise exception 'ฝากขายได้ไม่เกินคงเหลือ % %', p.qty, p.unit; end if;
  update xh_listings set qty = p_qty, warranty_until = p_warranty, reason = nullif(trim(coalesce(p_reason, '')), ''), updated_at = now() where part_id = p.id and active;
  if not found then
    insert into xh_listings (hospital_id, part_id, qty, warranty_until, reason) values (p.hospital_id, p.id, p_qty, p_warranty, nullif(trim(coalesce(p_reason, '')), ''));
  end if;
end $$;
revoke all on function public.xh_list(uuid, numeric, date, text) from public, anon;
grant execute on function public.xh_list(uuid, numeric, date, text) to authenticated;

-- my own parts with movement, 3-month use, months of cover, consign suggestion
create or replace function public.xh_my_parts() returns table (part_id uuid, code text, name text, unit text, qty numeric, unit_cost numeric,
  mv text, use3 numeric, cover_months numeric, suggest numeric, listing_id uuid, listed numeric, warranty_until date, listing_reason text)
language sql stable security definer set search_path = public as $$
  select p.id, p.code, p.name, p.unit, p.qty, p.unit_cost, public.part_movement(p.id), u.u3,
    case when u.u3 > 0 then round(p.qty / (u.u3 / 3), 1) end,
    case when p.qty > 0 and (u.u3 = 0 and public.part_use(p.id, 90) = 0 or p.qty / nullif(u.u3 / 3, 0) >= 3)
      then greatest(0, floor(p.qty - u.u3)) end,  -- keep 3 months of own use
    l.id, l.qty, l.warranty_until, l.reason
  from parts p cross join lateral (select public.part_use(p.id, 90) u3) u
  left join xh_listings l on l.part_id = p.id and l.active
  where p.hospital_id = public.my_hospital() and p.active order by p.code $$;
grant execute on function public.xh_my_parts() to authenticated;

-- shop: other hospitals' consigned parts; with a search of 2+ letters also any stock to "share" ----------------
create or replace function public.xh_market(p_q text default null) returns table (part_id uuid, hospital_code text, hospital_name text,
  code text, name text, unit text, available numeric, consigned boolean, warranty_until date, listing_reason text, mv_seller text,
  buyer_part uuid, mv_buyer text, use3_buyer numeric, buyer_qty numeric)
language plpgsql stable security definer set search_path = public as $$
declare h uuid := public.my_hospital(); q text := lower(trim(coalesce(p_q, '')));
begin
  if h is null or public.my_role() = 'observer' then raise exception 'ไม่มีสิทธิ์'; end if;
  return query
  with c as (
    select p.*, l.qty lq, l.warranty_until lw, l.reason lr, (l.id is not null) cons from parts p
    left join xh_listings l on l.part_id = p.id and l.active
    where p.hospital_id <> h and p.active and p.qty > 0
      and (l.id is not null or length(q) >= 2)
      and (q = '' or lower(p.code) like '%' || q || '%' or lower(p.name) like '%' || q || '%' or lower(coalesce(p.category, '')) like '%' || q || '%')
  )
  select c.id, hh.code, hh.name, c.code, c.name, c.unit, least(coalesce(c.lq, c.qty), c.qty), c.cons, c.lw, c.lr, public.part_movement(c.id),
    m.bp, public.part_movement(m.bp), coalesce(public.part_use(m.bp, 90), 0), (select qty from parts where id = m.bp)
  from c join hospitals hh on hh.id = c.hospital_id
  cross join lateral (select public.part_match(h, c.code, c.name) bp) m
  order by c.cons desc, hh.code, c.code limit 300;
end $$;
revoke all on function public.xh_market(text) from public, anon;
grant execute on function public.xh_market(text) to authenticated;

-- orders ---------------------------------------------------------------------------------------------------------
create table if not exists public.xh_counters (kind text not null, period text not null, last_no int not null default 0, primary key (kind, period));
alter table public.xh_counters enable row level security;

create table if not exists public.xh_rounds (
  id uuid primary key default gen_random_uuid(),
  round_no text not null unique,
  status text not null default 'open' check (status in ('open','decided')),
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  decided_by uuid references public.profiles(id), decided_at timestamptz,
  paper boolean not null default false, signer_name text, scan_path text, note text
);
create table if not exists public.xh_orders (
  id uuid primary key default gen_random_uuid(),
  doc_no text not null unique,
  buyer_hospital uuid not null references public.hospitals(id),
  seller_hospital uuid not null references public.hospitals(id),
  status text not null default 'memo' check (status in ('memo','memo_ok','seller_ok','central_ok','shipped','received','done','rejected','cancelled')),
  reason text,
  created_by uuid references public.profiles(id) default auth.uid(), created_at timestamptz not null default now(),
  memo_by uuid references public.profiles(id), memo_at timestamptz,
  seller_by uuid references public.profiles(id), seller_at timestamptz,
  round_id uuid references public.xh_rounds(id),
  central_by uuid references public.profiles(id), central_at timestamptz, central_note text,
  shipped_by uuid references public.profiles(id), shipped_at timestamptz,
  received_by uuid references public.profiles(id), received_at timestamptz,
  seller_count_by uuid references public.profiles(id), seller_count_at timestamptz,
  buyer_count_by uuid references public.profiles(id), buyer_count_at timestamptz,
  reject_note text, rejected_by uuid references public.profiles(id), rejected_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists xh_orders_buyer_idx on public.xh_orders (buyer_hospital, created_at desc);
create index if not exists xh_orders_seller_idx on public.xh_orders (seller_hospital, created_at desc);
create table if not exists public.xh_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.xh_orders(id) on delete cascade,
  line int not null,
  seller_part uuid references public.parts(id),
  buyer_part uuid references public.parts(id),
  code text not null, name text not null, unit text not null,
  consigned boolean not null default false,
  qty_req numeric not null check (qty_req > 0),
  reason_kind text not null check (reason_kind in ('ขอแบ่งซื้อ','ช่วยระบาย','ขาดคราว/ด่วน','อื่น ๆ')),
  reason text,
  mv_seller text, mv_buyer text, use3_buyer numeric,   -- frozen on the day the memo is opened
  qty_seller numeric, central_ok boolean, qty_central numeric,
  count_seller numeric, count_buyer numeric, note_seller text, note_buyer text
);
create index if not exists xh_items_order_idx on public.xh_items (order_id, line);

alter table public.xh_rounds enable row level security;
alter table public.xh_orders enable row level security;
alter table public.xh_items enable row level security;
create policy "xh orders read" on public.xh_orders for select to authenticated
  using (buyer_hospital = public.my_hospital() or seller_hospital = public.my_hospital() or public.xh_central_of('any'));
create policy "xh items read" on public.xh_items for select to authenticated
  using (exists (select 1 from xh_orders o where o.id = order_id and (o.buyer_hospital = public.my_hospital() or o.seller_hospital = public.my_hospital() or public.xh_central_of('any'))));
create policy "xh rounds read" on public.xh_rounds for select to authenticated
  using (public.xh_central_of('any') or exists (select 1 from xh_orders o where o.round_id = xh_rounds.id and (o.buyer_hospital = public.my_hospital() or o.seller_hospital = public.my_hospital())));
grant select on public.xh_rounds, public.xh_orders, public.xh_items to authenticated;

create or replace function public.xh_next(p_kind text, p_prefix text) returns text
language plpgsql security definer set search_path = public as $$
declare v_period text := to_char(now() at time zone 'Asia/Bangkok', 'MM') || '/' || (extract(year from now() at time zone 'Asia/Bangkok')::int + 543); v_n int;
begin
  insert into xh_counters (kind, period, last_no) values (p_kind, v_period, 1)
    on conflict (kind, period) do update set last_no = xh_counters.last_no + 1 returning last_no into v_n;
  return p_prefix || '-' || lpad(v_n::text, 3, '0') || '/' || v_period;
end $$;
revoke execute on function public.xh_next(text, text) from public, anon, authenticated;

-- ① create memos from the cart; one memo per seller hospital
create or replace function public.xh_create(p_items jsonb, p_reason text default null) returns text[]
language plpgsql security definer set search_path = public as $$
declare h uuid := public.my_hospital(); v_code text; it jsonb; p parts; o uuid; outs text[] := '{}'; s uuid; n int; bp uuid; l xh_listings;
begin
  if not public.xh_opener() then raise exception 'เปิด Memo ขอซื้อได้เฉพาะ Admin / หัวหน้าช่าง / Chief'; end if;
  if jsonb_array_length(coalesce(p_items, '[]')) = 0 then raise exception 'ตะกร้าว่าง'; end if;
  select code into v_code from hospitals where id = h;
  for s in select distinct pp.hospital_id from jsonb_array_elements(p_items) e join parts pp on pp.id = (e->>'part_id')::uuid loop
    if s = h then raise exception 'ซื้อของจากโรงตัวเองไม่ได้'; end if;
    insert into xh_orders (doc_no, buyer_hospital, seller_hospital, reason) values (public.xh_next('XH-' || v_code, 'XH-' || v_code), h, s, nullif(trim(coalesce(p_reason, '')), ''))
      returning id into o;
    n := 0;
    for it in select e from jsonb_array_elements(p_items) e where (select hospital_id from parts where id = (e->>'part_id')::uuid) = s loop
      select * into p from parts where id = (it->>'part_id')::uuid and active;
      if p.id is null then raise exception 'ไม่พบอะไหล่ในโรงผู้ขาย'; end if;
      if coalesce((it->>'qty')::numeric, 0) <= 0 then raise exception 'ใส่จำนวนของ % ให้ถูกต้อง', p.name; end if;
      if (it->>'qty')::numeric > p.qty then raise exception '% มีให้ซื้อได้ไม่เกิน % %', p.name, p.qty, p.unit; end if;
      if coalesce(it->>'reason_kind', '') not in ('ขอแบ่งซื้อ','ช่วยระบาย','ขาดคราว/ด่วน','อื่น ๆ') then raise exception 'เลือกเหตุผลของ % ทุกบรรทัด', p.name; end if;
      if it->>'reason_kind' = 'อื่น ๆ' and coalesce(trim(it->>'reason'), '') = '' then raise exception 'เหตุผล "อื่น ๆ" ของ % ต้องพิมพ์รายละเอียด', p.name; end if;
      select * into l from xh_listings where part_id = p.id and active;
      bp := public.part_match(h, p.code, p.name); n := n + 1;
      insert into xh_items (order_id, line, seller_part, buyer_part, code, name, unit, consigned, qty_req, reason_kind, reason, mv_seller, mv_buyer, use3_buyer)
      values (o, n, p.id, bp, p.code, p.name, p.unit, l.id is not null, (it->>'qty')::numeric, it->>'reason_kind', nullif(trim(coalesce(it->>'reason', '')), ''),
        public.part_movement(p.id), case when bp is null then null else public.part_movement(bp) end, case when bp is null then 0 else public.part_use(bp, 90) end);
    end loop;
    outs := outs || (select doc_no from xh_orders where id = o);
  end loop;
  return outs;
end $$;
revoke all on function public.xh_create(jsonb, text) from public, anon;
grant execute on function public.xh_create(jsonb, text) to authenticated;

-- every later step goes through one function so the order can only move forward along the flow
-- p_lines: [{id, qty}] for seller confirm, [{id, ok}] for central, [{id, count, note}] for counts
create or replace function public.xh_step(p_order uuid, p_step text, p_lines jsonb default '[]', p_note text default null) returns text
language plpgsql security definer set search_path = public as $$
declare h uuid := public.my_hospital(); o xh_orders; it xh_items; ln jsonb; v numeric; p parts; bp uuid; v_left int;
begin
  select * into o from xh_orders where id = p_order for update;
  if o.id is null then raise exception 'ไม่พบใบ'; end if;
  if p_step = 'memo_ok' or p_step = 'memo_no' then
    if o.status <> 'memo' or h <> o.buyer_hospital or not public.xh_chief() then raise exception 'อนุมัติ Memo ได้เฉพาะ Chief ของโรงผู้ซื้อ เมื่อใบรออนุมัติ'; end if;
    if o.created_by = auth.uid() then raise exception 'ผู้อนุมัติต้องไม่ใช่คนเปิดใบ'; end if;
    if p_step = 'memo_no' then
      update xh_orders set status = 'rejected', reject_note = coalesce(nullif(trim(p_note), ''), 'ไม่อนุมัติ Memo'), rejected_by = auth.uid(), rejected_at = now(), updated_at = now() where id = o.id;
    else update xh_orders set status = 'memo_ok', memo_by = auth.uid(), memo_at = now(), updated_at = now() where id = o.id; end if;
  elsif p_step = 'seller' or p_step = 'seller_no' then
    if o.status <> 'memo_ok' or h <> o.seller_hospital or not public.xh_chief() then raise exception 'ยืนยันจำนวนได้เฉพาะ Chief ของโรงผู้ขาย'; end if;
    if p_step = 'seller_no' then
      update xh_orders set status = 'rejected', reject_note = coalesce(nullif(trim(p_note), ''), 'ผู้ขายปฏิเสธ'), rejected_by = auth.uid(), rejected_at = now(), updated_at = now() where id = o.id;
      return 'rejected';
    end if;
    for it in select * from xh_items where order_id = o.id loop
      select value into ln from jsonb_array_elements(p_lines) where value->>'id' = it.id::text;
      v := coalesce((ln->>'qty')::numeric, it.qty_req);
      if v < 0 or v > it.qty_req then raise exception 'จำนวนที่ให้ได้ของ % ต้องอยู่ระหว่าง 0–%', it.name, it.qty_req; end if;
      update xh_items set qty_seller = v where id = it.id;
    end loop;
    if not exists (select 1 from xh_items where order_id = o.id and qty_seller > 0) then
      update xh_orders set status = 'rejected', reject_note = 'ผู้ขายให้ได้ 0 ทุกรายการ', seller_by = auth.uid(), seller_at = now(), rejected_by = auth.uid(), rejected_at = now(), updated_at = now() where id = o.id;
    else update xh_orders set status = 'seller_ok', seller_by = auth.uid(), seller_at = now(), updated_at = now() where id = o.id; end if;
  elsif p_step = 'ship' then
    if o.status <> 'central_ok' or h <> o.seller_hospital or not public.xh_chief() then raise exception 'ส่งของได้เฉพาะ Chief ของโรงผู้ขาย หลังส่วนกลางอนุมัติ'; end if;
    for it in select * from xh_items where order_id = o.id and qty_central > 0 loop
      select * into p from parts where id = it.seller_part;
      if p.qty < it.qty_central then raise exception 'สต็อก % เหลือ % ไม่พอส่ง % — เติมสต็อกหรือปฏิเสธใบ', it.name, p.qty, it.qty_central; end if;
    end loop;
    update xh_orders set status = 'shipped', shipped_by = auth.uid(), shipped_at = now(), updated_at = now() where id = o.id;
  elsif p_step = 'receive' then
    if o.status <> 'shipped' or h <> o.buyer_hospital or not public.xh_opener() then raise exception 'กดรับของได้เฉพาะ Admin / หัวหน้าช่าง / Chief ของโรงผู้ซื้อ หลังผู้ขายส่งของ'; end if;
    update xh_orders set status = 'received', received_by = auth.uid(), received_at = now(), updated_at = now() where id = o.id;
  elsif p_step = 'count_seller' or p_step = 'count_buyer' then
    if not public.xh_opener() then raise exception 'ตรวจนับได้เฉพาะ Admin / หัวหน้าช่าง / Chief'; end if;
    if p_step = 'count_seller' and (h <> o.seller_hospital or o.status not in ('shipped','received') or o.seller_count_at is not null) then raise exception 'ยังไม่มีงานตรวจนับฝั่งผู้ขายของใบนี้'; end if;
    if p_step = 'count_buyer' and (h <> o.buyer_hospital or o.status <> 'received' or o.buyer_count_at is not null) then raise exception 'ยังไม่มีงานตรวจนับฝั่งผู้ซื้อของใบนี้ (ต้องกดรับของก่อน)'; end if;
    for it in select * from xh_items where order_id = o.id and qty_central > 0 order by line loop
      select value into ln from jsonb_array_elements(p_lines) where value->>'id' = it.id::text;
      v := (ln->>'count')::numeric;
      if v is null or v < 0 then raise exception 'ใส่จำนวนนับจริงของ % ทุกบรรทัด', it.name; end if;
      if v <> it.qty_central and coalesce(trim(ln->>'note'), '') = '' then raise exception 'นับ % ไม่ตรงเอกสาร (%) ต้องใส่หมายเหตุ', it.name, it.qty_central; end if;
      if p_step = 'count_seller' then
        select * into p from parts where id = it.seller_part for update;
        if p.qty < v then raise exception 'สต็อก % เหลือ % ไม่พอตัด %', it.name, p.qty, v; end if;
        update parts set qty = qty - v where id = p.id;
        insert into part_moves (hospital_id, part_id, kind, qty, qty_after, unit_cost, note)
          values (h, p.id, 'adjust', -v, p.qty - v, p.unit_cost, 'ส่งให้โรงอื่น ' || o.doc_no);
        update xh_items set count_seller = v, note_seller = nullif(trim(coalesce(ln->>'note', '')), '') where id = it.id;
        -- the consignment shrinks by what left the store
        update xh_listings set qty = case when qty > v then qty - v else qty end, active = qty > v, updated_at = now() where part_id = p.id and active;
      else
        bp := coalesce(it.buyer_part, public.part_match(h, it.code, it.name));
        if bp is null then
          if exists (select 1 from parts where hospital_id = h and upper(code) = upper(it.code) and not active) then
            raise exception 'รหัส % ในสต็อกเราถูกปิดใช้งาน ระบบไม่เปิดกลับเอง ให้เปิดใช้ที่แท็บอะไหล่ก่อน', it.code; end if;
          insert into parts (hospital_id, code, name, unit, qty) values (h, it.code, it.name, it.unit, 0) returning id into bp;
        end if;
        select * into p from parts where id = bp for update;
        update parts set qty = qty + v where id = p.id;
        insert into part_moves (hospital_id, part_id, kind, qty, qty_after, unit_cost, note)
          values (h, p.id, 'receive', v, p.qty + v, p.unit_cost, 'รับจากโรงอื่น ' || o.doc_no);
        update xh_items set count_buyer = v, buyer_part = bp, note_buyer = nullif(trim(coalesce(ln->>'note', '')), '') where id = it.id;
      end if;
    end loop;
    if p_step = 'count_seller' then update xh_orders set seller_count_by = auth.uid(), seller_count_at = now(), updated_at = now() where id = o.id;
    else update xh_orders set buyer_count_by = auth.uid(), buyer_count_at = now(), updated_at = now() where id = o.id; end if;
    update xh_orders set status = 'done' where id = o.id and seller_count_at is not null and buyer_count_at is not null;
  elsif p_step = 'cancel' then
    if h <> o.buyer_hospital or not public.xh_opener() or o.status not in ('memo','memo_ok','seller_ok','central_ok') then raise exception 'ยกเลิกได้เฉพาะโรงผู้ซื้อ ก่อนผู้ขายส่งของ'; end if;
    update xh_orders set status = 'cancelled', reject_note = nullif(trim(coalesce(p_note, '')), ''), rejected_by = auth.uid(), rejected_at = now(), updated_at = now() where id = o.id;
  elsif p_step = 'reject_ship' then
    if o.status <> 'central_ok' or h <> o.seller_hospital or not public.xh_chief() then raise exception 'ปฏิเสธได้เฉพาะ Chief ของโรงผู้ขาย ก่อนส่งของ'; end if;
    update xh_orders set status = 'rejected', reject_note = coalesce(nullif(trim(p_note), ''), 'ของไม่พอส่ง'), rejected_by = auth.uid(), rejected_at = now(), updated_at = now() where id = o.id;
  else raise exception 'ขั้นไม่ถูกต้อง';
  end if;
  return (select status from xh_orders where id = o.id);
end $$;
revoke all on function public.xh_step(uuid, text, jsonb, text) from public, anon;
grant execute on function public.xh_step(uuid, text, jsonb, text) to authenticated;

-- central rounds: accounting gathers seller-confirmed orders; approver decides line by line (or paper + scan) ----
create or replace function public.xh_round_create() returns text
language plpgsql security definer set search_path = public as $$
declare r uuid; v_no text;
begin
  if not public.xh_central_of('account') then raise exception 'จัดรอบได้เฉพาะบัญชีส่วนกลาง'; end if;
  if not exists (select 1 from xh_orders where status = 'seller_ok' and round_id is null) then raise exception 'ยังไม่มีใบที่ผู้ขายยืนยันแล้วรอเข้ารอบ'; end if;
  v_no := public.xh_next('XH-R', 'XH-R');
  insert into xh_rounds (round_no) values (v_no) returning id into r;
  update xh_orders set round_id = r, updated_at = now() where status = 'seller_ok' and round_id is null;
  return v_no;
end $$;
revoke all on function public.xh_round_create() from public, anon;
grant execute on function public.xh_round_create() to authenticated;

-- p_lines: [{id, ok}] (missing = approve); p_paper true → central accounting records a signed paper form, scan required
create or replace function public.xh_round_decide(p_round uuid, p_lines jsonb, p_paper boolean default false, p_signer text default null,
  p_scan text default null, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare rd xh_rounds; it record; ok boolean; ln jsonb;
begin
  select * into rd from xh_rounds where id = p_round for update;
  if rd.id is null or rd.status <> 'open' then raise exception 'รอบนี้ตัดสินแล้วหรือไม่พบรอบ'; end if;
  if p_paper then
    if not public.xh_central_of('account') then raise exception 'บันทึกผลจากกระดาษได้เฉพาะบัญชีส่วนกลาง'; end if;
    if coalesce(trim(p_signer), '') = '' or coalesce(trim(p_scan), '') = '' then raise exception 'ต้องใส่ชื่อผู้เซ็นและแนบสแกนแบบฟอร์ม'; end if;
  elsif not public.xh_central_of('approve') then raise exception 'อนุมัติรอบได้เฉพาะผู้อนุมัติส่วนกลาง'; end if;
  for it in select i.* from xh_items i join xh_orders o on o.id = i.order_id where o.round_id = rd.id and o.status = 'seller_ok' loop
    select value into ln from jsonb_array_elements(coalesce(p_lines, '[]')) where value->>'id' = it.id::text;
    ok := coalesce((ln->>'ok')::boolean, true) and coalesce(it.qty_seller, 0) > 0;
    update xh_items set central_ok = ok, qty_central = case when ok then it.qty_seller else 0 end where id = it.id;
  end loop;
  update xh_orders o set status = case when exists (select 1 from xh_items i where i.order_id = o.id and i.qty_central > 0) then 'central_ok' else 'rejected' end,
    reject_note = case when exists (select 1 from xh_items i where i.order_id = o.id and i.qty_central > 0) then reject_note else 'ส่วนกลางไม่อนุมัติ' end,
    central_by = auth.uid(), central_at = now(), central_note = nullif(trim(coalesce(p_note, '')), ''), updated_at = now()
  where o.round_id = rd.id and o.status = 'seller_ok';
  update xh_rounds set status = 'decided', decided_by = auth.uid(), decided_at = now(), paper = coalesce(p_paper, false),
    signer_name = nullif(trim(coalesce(p_signer, '')), ''), scan_path = nullif(trim(coalesce(p_scan, '')), ''), note = nullif(trim(coalesce(p_note, '')), '')
  where id = rd.id;
end $$;
revoke all on function public.xh_round_decide(uuid, jsonb, boolean, text, text, text) from public, anon;
grant execute on function public.xh_round_decide(uuid, jsonb, boolean, text, text, text) to authenticated;

-- names on documents (the other hospital's people are not readable through profiles RLS)
create or replace function public.xh_people(p_order uuid) returns table (id uuid, full_name text, hospital_code text)
language sql stable security definer set search_path = public as $$
  select distinct p.id, p.full_name, h.code from xh_orders o
  cross join lateral unnest(array[o.created_by, o.memo_by, o.seller_by, o.central_by, o.shipped_by, o.received_by, o.seller_count_by, o.buyer_count_by, o.rejected_by]) u(pid)
  join profiles p on p.id = u.pid left join hospitals h on h.id = p.hospital_id
  where o.id = p_order and (o.buyer_hospital = public.my_hospital() or o.seller_hospital = public.my_hospital() or public.xh_central_of('any')) $$;
grant execute on function public.xh_people(uuid) to authenticated;
create or replace function public.xh_hospitals() returns table (id uuid, code text, name text)
language sql stable security definer set search_path = public as $$ select id, code, name from hospitals where active order by code $$;
grant execute on function public.xh_hospitals() to authenticated;

-- dashboard: per hospital movement mix (count and stock value), consigned, open orders, pending counts ------------
-- a hospital sees itself; central sees every hospital
create or replace function public.xh_dashboard() returns table (hospital_id uuid, code text, name text, items bigint,
  fast_v numeric, normal_v numeric, slow_v numeric, non_v numeric, new_v numeric, fast_n bigint, normal_n bigint, slow_n bigint, non_n bigint, new_n bigint,
  listed_n bigint, listed_qty numeric, buying bigint, selling bigint, count_wait bigint)
language sql stable security definer set search_path = public as $$
  with s as (
    select p.hospital_id, p.qty * p.unit_cost v, public.part_movement(p.id) mv from parts p
    where p.active and (p.hospital_id = public.my_hospital() or public.xh_central_of('any'))
  )
  select h.id, h.code, h.name, count(s.mv),
    coalesce(sum(v) filter (where mv = 'FAST'), 0), coalesce(sum(v) filter (where mv = 'NORMAL'), 0), coalesce(sum(v) filter (where mv = 'SLOW'), 0),
    coalesce(sum(v) filter (where mv = 'NON MOVE'), 0), coalesce(sum(v) filter (where mv = 'NEW'), 0),
    count(*) filter (where mv = 'FAST'), count(*) filter (where mv = 'NORMAL'), count(*) filter (where mv = 'SLOW'), count(*) filter (where mv = 'NON MOVE'), count(*) filter (where mv = 'NEW'),
    (select count(*) from xh_listings l where l.hospital_id = h.id and l.active), (select coalesce(sum(qty), 0) from xh_listings l where l.hospital_id = h.id and l.active),
    (select count(*) from xh_orders o where o.buyer_hospital = h.id and o.status not in ('done','rejected','cancelled')),
    (select count(*) from xh_orders o where o.seller_hospital = h.id and o.status not in ('done','rejected','cancelled')),
    (select count(*) from xh_orders o where (o.seller_hospital = h.id and o.status in ('shipped','received') and o.seller_count_at is null)
       or (o.buyer_hospital = h.id and o.status = 'received' and o.buyer_count_at is null))
  from hospitals h left join s on s.hospital_id = h.id
  where h.active and (h.id = public.my_hospital() or public.xh_central_of('any'))
  group by h.id, h.code, h.name order by h.code $$;
grant execute on function public.xh_dashboard() to authenticated;

-- same spec across hospitals + transfer suggestions (central only):
-- from SLOW / NON MOVE stock (keeping 3 months of own use) to FAST hospitals with under 1.5 months of cover
create or replace function public.xh_transfer_hints() returns table (spec text, from_code text, from_part uuid, from_mv text, from_qty numeric, can_give numeric,
  to_code text, to_mv text, to_qty numeric, to_use_month numeric, to_cover numeric, value numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.xh_central_of('any') then raise exception 'เฉพาะส่วนกลาง'; end if;
  return query
  with s as (
    select p.id, p.hospital_id, lower(trim(p.name)) sp, p.name, p.qty, p.unit_cost, public.part_movement(p.id) mv, public.part_use(p.id, 90) / 3.0 um
    from parts p where p.active
  )
  select a.name, ha.code, a.id, a.mv, a.qty, greatest(0, floor(a.qty - 3 * a.um)), hb.code, b.mv, b.qty, round(b.um, 1),
    round(b.qty / nullif(b.um, 0), 1), greatest(0, floor(a.qty - 3 * a.um)) * a.unit_cost
  from s a join s b on a.sp = b.sp and a.hospital_id <> b.hospital_id
  join hospitals ha on ha.id = a.hospital_id join hospitals hb on hb.id = b.hospital_id
  where a.mv in ('SLOW','NON MOVE') and b.mv = 'FAST' and b.um > 0 and b.qty / b.um < 1.5 and floor(a.qty - 3 * a.um) > 0
  order by 12 desc nulls last, 1 limit 200;
end $$;
revoke all on function public.xh_transfer_hints() from public, anon;
grant execute on function public.xh_transfer_hints() to authenticated;

-- round scans live in the private docs bucket under XH/ (central accounting only)
create policy "docs xh central upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'docs' and (storage.foldername(objects.name))[1] = 'XH' and public.xh_central_of('account'));
create policy "docs xh central read" on storage.objects for select to authenticated
  using (bucket_id = 'docs' and (storage.foldername(objects.name))[1] = 'XH' and public.xh_central_of('any'));

do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['xh_orders'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;
