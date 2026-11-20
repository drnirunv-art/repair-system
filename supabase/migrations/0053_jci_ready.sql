-- แฟ้มพร้อมตรวจ JCI (JCI readiness): certificate / calibration register, ILSM register, Code drill log (3 shifts),
-- Reverse-Tracer practice log (point at a machine, show its PM, certificates and repairs within 15 minutes).
-- JCI 8th FMS.06 / FMS.07 / FMS.08 / FMS.09 / FMS.10 (ILSM) and contract KPI item 6 (Code drill).
-- Additive only: 4 new tables, read/write policies, 2 storage policies. Nothing existing is changed.

create table if not exists public.jci_certs (
  id bigint generated always as identity primary key,
  hospital_id uuid not null references public.hospitals(id),
  equipment_id uuid references public.equipment(id),       -- null = not tied to one machine (e.g. building licence)
  item text not null,                                        -- what is certified, e.g. "เกจวัดความดันห้อง AIIR ICU 1"
  kind text not null default 'สอบเทียบ',                      -- สอบเทียบ / ตรวจรับรองตามกฎหมาย / ทดสอบประจำปี / ใบอนุญาต / อื่น ๆ
  issuer text,
  cert_no text,
  issued_on date,
  expires_on date,
  ref text,                                                  -- standard / ME reference, e.g. FMS.08.03
  files text[] not null default '{}',                        -- docs bucket paths <CODE>/JCI/...
  note text,
  active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists jci_certs_hosp_idx on public.jci_certs (hospital_id, expires_on);
create index if not exists jci_certs_eq_idx on public.jci_certs (equipment_id);

create table if not exists public.jci_ilsm (
  id bigint generated always as identity primary key,
  hospital_id uuid not null references public.hospitals(id),
  title text not null,                                       -- the deficiency / work that weakens life safety
  area text,
  ref text,
  risk text not null default 'กลาง' check (risk in ('สูง', 'กลาง', 'ต่ำ')),
  measures text[] not null default '{}',                     -- interim measures chosen
  started_on date not null,
  target_end date,
  ended_on date,
  owner_name text,
  note text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists jci_ilsm_hosp_idx on public.jci_ilsm (hospital_id, started_on);

create table if not exists public.jci_drills (
  id bigint generated always as identity primary key,
  hospital_id uuid not null references public.hospitals(id),
  code text not null,                                        -- Code Red / Code Blue / Code Pink / ไฟฟ้าดับ ...
  held_on date not null,
  shift text not null check (shift in ('เช้า', 'บ่าย', 'ดึก')),
  place text,
  participants int check (participants >= 0),
  groups text[] not null default '{}',                       -- ช่าง / แม่บ้าน / รปภ. / ผู้รับเหมา / พยาบาล / อื่น ๆ
  minutes int check (minutes >= 0),                          -- response / drill time
  result text not null default 'ผ่าน' check (result in ('ผ่าน', 'ต้องปรับปรุง')),
  findings text,
  actions text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists jci_drills_hosp_idx on public.jci_drills (hospital_id, held_on);

create table if not exists public.jci_tracer (
  id bigint generated always as identity primary key,
  hospital_id uuid not null references public.hospitals(id),
  equipment_id uuid references public.equipment(id),
  tag text,
  seconds int not null check (seconds >= 0),
  found text[] not null default '{}',                        -- which evidence was shown: PM / ใบสอบเทียบ / งานซ่อม / สติกเกอร์
  note text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists jci_tracer_hosp_idx on public.jci_tracer (hospital_id, created_at);

alter table public.jci_certs enable row level security;
alter table public.jci_ilsm enable row level security;
alter table public.jci_drills enable row level security;
alter table public.jci_tracer enable row level security;

-- read = own hospitals or exec; add / edit = heads of that hospital or exec (tracer practice: any staff of that hospital)
do $p$ declare t text; begin
  foreach t in array array['jci_certs', 'jci_ilsm', 'jci_drills', 'jci_tracer'] loop
    if not exists (select 1 from pg_policies where tablename = t and policyname = t || ' read') then
      execute format('create policy %I on public.%I for select to authenticated using (public.am_exec() or hospital_id in (select m.id from public.my_hospitals() m))', t || ' read', t); end if;
  end loop;
  foreach t in array array['jci_certs', 'jci_ilsm', 'jci_drills'] loop
    if not exists (select 1 from pg_policies where tablename = t and policyname = t || ' write') then
      execute format('create policy %I on public.%I for insert to authenticated with check (public.am_exec() or (public.is_manager() and hospital_id in (select m.id from public.my_hospitals() m)))', t || ' write', t); end if;
    if not exists (select 1 from pg_policies where tablename = t and policyname = t || ' edit') then
      execute format('create policy %I on public.%I for update to authenticated using (public.am_exec() or (public.is_manager() and hospital_id in (select m.id from public.my_hospitals() m))) with check (public.am_exec() or (public.is_manager() and hospital_id in (select m.id from public.my_hospitals() m)))', t || ' edit', t); end if;
  end loop;
  if not exists (select 1 from pg_policies where tablename = 'jci_tracer' and policyname = 'jci_tracer write') then
    create policy "jci_tracer write" on public.jci_tracer for insert to authenticated
      with check (public.my_role() <> 'observer' and (public.am_exec() or hospital_id in (select m.id from public.my_hospitals() m))); end if;
end $p$;

grant select, insert, update on public.jci_certs, public.jci_ilsm, public.jci_drills to authenticated;
grant select, insert on public.jci_tracer to authenticated;

-- certificate files: docs bucket, folder <CODE>/JCI/ — for every hospital the person belongs to (not only the primary one) and execs
do $p$ begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'docs jci upload') then
    create policy "docs jci upload" on storage.objects for insert to authenticated
      with check (bucket_id = 'docs' and (storage.foldername(objects.name))[2] = 'JCI'
        and (public.am_exec() or (storage.foldername(objects.name))[1] in (select m.code from public.my_hospitals() m))); end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'docs jci read') then
    create policy "docs jci read" on storage.objects for select to authenticated
      using (bucket_id = 'docs' and (storage.foldername(objects.name))[2] = 'JCI'
        and (public.am_exec() or (storage.foldername(objects.name))[1] in (select m.code from public.my_hospitals() m))); end if;
end $p$;
