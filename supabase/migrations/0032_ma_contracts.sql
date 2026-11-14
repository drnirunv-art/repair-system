-- 0032 PM MA: contractor (MA) contract register, contract renewal steps, appointments and contractor PM visits (ma.html).
-- Additive: four new tables, no change to existing ones. Rows are visible to the staff of the hospital and to the
-- 12-hospital viewers (am_exec); the register and the renewal steps are edited by managers, visits and appointments are added by the hospital's staff (not observers).
create table if not exists public.ma_contracts (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null references public.hospitals(id) on delete cascade,
  grp text not null default '',            -- work group, e.g. "1. By-law ตามกฎหมาย"
  grp_item text not null default '',       -- item inside the group (dashboard heading)
  sys text not null default '',
  scope text not null default '',
  qty int,
  vendor text not null default '',
  contract_no text not null default '',
  start_date date,
  end_date date,
  pm_cycle text not null default '',       -- M, 2M, Q, 4M, S, Y (may be combined: "M,Y")
  value_year numeric,
  contact text not null default '',
  vendor_email text not null default '',
  note text not null default '',
  cancelled boolean not null default false,
  sort int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);
create index if not exists ma_contracts_hospital on public.ma_contracts (hospital_id, sort);

create table if not exists public.ma_visits (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null references public.hospitals(id) on delete cascade,
  contract_id uuid not null references public.ma_contracts(id) on delete cascade,
  visit_date date not null,
  detail text not null default '',
  result text not null default '',
  report_link text not null default '',
  on_time text not null default '',
  tech text not null default '',
  tech_n int,
  problem text not null default '',
  need_quote boolean not null default false,
  supervisor text not null default '',
  machines int,
  created_by uuid default auth.uid(),
  created_by_name text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists ma_visits_contract on public.ma_visits (contract_id, visit_date desc);

create table if not exists public.ma_appts (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null references public.hospitals(id) on delete cascade,
  contract_id uuid not null references public.ma_contracts(id) on delete cascade,
  plan_month date not null,                -- first day of the planned month
  appt_date date,
  status text not null check (status in ('ยืนยันทางอีเมลแล้ว','ยืนยันทางโทรศัพท์/LINE','ส่งอีเมลแล้ว รอตอบ','ขอเลื่อน','แจ้งไม่เข้า')),
  new_date date,
  ref text not null default '',
  note text not null default '',
  created_by uuid default auth.uid(),
  created_by_name text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists ma_appts_contract on public.ma_appts (contract_id, plan_month desc);

create table if not exists public.ma_proc (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null references public.hospitals(id) on delete cascade,
  contract_id uuid not null references public.ma_contracts(id) on delete cascade,
  step text not null check (step in ('PR','ใบเสนอราคา 3 เจ้า','สรุปเลือกผู้รับเหมา','PO')),
  step_date date not null,
  doc_no text not null default '',
  seller text not null default '',
  price numeric,
  note text not null default '',
  created_by uuid default auth.uid(),
  created_by_name text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists ma_proc_contract on public.ma_proc (contract_id, step_date);

drop trigger if exists ma_contracts_touch on public.ma_contracts;
create trigger ma_contracts_touch before update on public.ma_contracts for each row execute function public.touch_updated_at();

alter table public.ma_contracts enable row level security;
alter table public.ma_visits enable row level security;
alter table public.ma_appts enable row level security;
alter table public.ma_proc enable row level security;
revoke all on public.ma_contracts, public.ma_visits, public.ma_appts, public.ma_proc from anon;
grant select, insert, update, delete on public.ma_contracts, public.ma_visits, public.ma_appts, public.ma_proc to authenticated;

create policy "ma contracts read" on public.ma_contracts for select to authenticated
  using (hospital_id = public.my_hospital() or public.am_exec());
create policy "ma contracts managers add" on public.ma_contracts for insert to authenticated
  with check ((hospital_id = public.my_hospital() and public.is_manager()) or public.am_exec());
create policy "ma contracts managers edit" on public.ma_contracts for update to authenticated
  using ((hospital_id = public.my_hospital() and public.is_manager()) or public.am_exec())
  with check ((hospital_id = public.my_hospital() and public.is_manager()) or public.am_exec());
create policy "ma contracts managers delete" on public.ma_contracts for delete to authenticated
  using ((hospital_id = public.my_hospital() and public.is_manager()) or public.am_exec());

-- logs: a row must belong to a contract of the same hospital
create policy "ma visits read" on public.ma_visits for select to authenticated
  using (hospital_id = public.my_hospital() or public.am_exec());
create policy "ma visits add" on public.ma_visits for insert to authenticated
  with check (((hospital_id = public.my_hospital() and coalesce(public.my_role() <> 'observer', false)) or public.am_exec())
    and exists (select 1 from public.ma_contracts c where c.id = contract_id and c.hospital_id = ma_visits.hospital_id));
create policy "ma visits managers delete" on public.ma_visits for delete to authenticated
  using ((hospital_id = public.my_hospital() and public.is_manager()) or public.am_exec());

create policy "ma appts read" on public.ma_appts for select to authenticated
  using (hospital_id = public.my_hospital() or public.am_exec());
create policy "ma appts add" on public.ma_appts for insert to authenticated
  with check (((hospital_id = public.my_hospital() and coalesce(public.my_role() <> 'observer', false)) or public.am_exec())
    and exists (select 1 from public.ma_contracts c where c.id = contract_id and c.hospital_id = ma_appts.hospital_id));
create policy "ma appts managers delete" on public.ma_appts for delete to authenticated
  using ((hospital_id = public.my_hospital() and public.is_manager()) or public.am_exec());

create policy "ma proc read" on public.ma_proc for select to authenticated
  using (hospital_id = public.my_hospital() or public.am_exec());
create policy "ma proc managers add" on public.ma_proc for insert to authenticated
  with check (((hospital_id = public.my_hospital() and public.is_manager()) or public.am_exec())
    and exists (select 1 from public.ma_contracts c where c.id = contract_id and c.hospital_id = ma_proc.hospital_id));
create policy "ma proc managers delete" on public.ma_proc for delete to authenticated
  using ((hospital_id = public.my_hospital() and public.is_manager()) or public.am_exec());
