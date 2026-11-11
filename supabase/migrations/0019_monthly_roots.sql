-- Monthly Report "tree": roots R1–R10 collected all month, red cards for missing roots, month-close steps,
-- and a private bucket for documents (lab PDFs, bills, sign-in sheets). Additive only.

create table if not exists public.monthly_entries (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null references public.hospitals(id) on delete cascade,
  month text not null check (month ~ '^[0-9]{4}-[0-9]{2}$'),
  root text not null check (root in ('R1','R2','R3','R4','R5','R6','R7','R8','R9','R10')),
  data jsonb not null default '{}',     -- fields of the root form; {"none": true} = "no event this month"
  files text[] not null default '{}',
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  active boolean not null default true
);
create index if not exists monthly_entries_idx on public.monthly_entries (hospital_id, month, root);
alter table public.monthly_entries enable row level security;
create policy "monthly entries read" on public.monthly_entries for select to authenticated using (hospital_id = public.my_hospital());
create policy "monthly entries add" on public.monthly_entries for insert to authenticated
  with check (hospital_id = public.my_hospital() and created_by = auth.uid() and public.my_role() <> 'observer');
create policy "monthly entries edit" on public.monthly_entries for update to authenticated
  using (hospital_id = public.my_hospital() and (created_by = auth.uid() or public.is_manager())) with check (hospital_id = public.my_hospital());
grant select on public.monthly_entries to authenticated;
grant insert (hospital_id, month, root, data, files, created_by) on public.monthly_entries to authenticated;
grant update (data, files, active, updated_at) on public.monthly_entries to authenticated;

-- the month-close cycle: closed (day 1–2) → KPI compiled (day 3) → book done (day 4) → approved by Chief → presented (day 10)
create table if not exists public.monthly_books (
  hospital_id uuid not null references public.hospitals(id) on delete cascade,
  month text not null check (month ~ '^[0-9]{4}-[0-9]{2}$'),
  closed_at timestamptz, closed_by uuid references public.profiles(id),
  kpi_at timestamptz, kpi_by uuid references public.profiles(id),
  book_at timestamptz, book_by uuid references public.profiles(id),
  approved_at timestamptz, approved_by uuid references public.profiles(id),
  presented_at timestamptz, presented_by uuid references public.profiles(id),
  kpi jsonb not null default '{}',
  primary key (hospital_id, month)
);
alter table public.monthly_books enable row level security;
create policy "monthly books read" on public.monthly_books for select to authenticated using (hospital_id = public.my_hospital());
grant select on public.monthly_books to authenticated;

create or replace function public.book_step(p_month text, p_step text, p_kpi jsonb default null) returns void
language plpgsql security definer set search_path = public as $$
declare r app_role := public.my_role();
begin
  if p_step not in ('closed','kpi','book','approved','presented','undo') then raise exception 'ขั้นไม่ถูกต้อง'; end if;
  if r is null or r = 'observer' or r = 'technician' then raise exception 'เฉพาะ Admin / Supervisor / Chief Engineer'; end if;
  if p_step in ('approved','presented','undo') and r not in ('owner','admin','chief_engineer') then raise exception 'เฉพาะ Chief Engineer อนุมัติเล่มได้'; end if;
  insert into monthly_books (hospital_id, month) values (public.my_hospital(), p_month) on conflict do nothing;
  update monthly_books set
    closed_at = case when p_step = 'closed' then now() else closed_at end, closed_by = case when p_step = 'closed' then auth.uid() else closed_by end,
    kpi_at = case when p_step = 'kpi' then now() else kpi_at end, kpi_by = case when p_step = 'kpi' then auth.uid() else kpi_by end,
    kpi = case when p_step = 'kpi' and p_kpi is not null then p_kpi else kpi end,
    book_at = case when p_step = 'book' then now() else book_at end, book_by = case when p_step = 'book' then auth.uid() else book_by end,
    approved_at = case when p_step = 'approved' then now() when p_step = 'undo' then null else approved_at end,
    approved_by = case when p_step = 'approved' then auth.uid() when p_step = 'undo' then null else approved_by end,
    presented_at = case when p_step = 'presented' then now() when p_step = 'undo' then null else presented_at end,
    presented_by = case when p_step = 'presented' then auth.uid() when p_step = 'undo' then null else presented_by end
  where hospital_id = public.my_hospital() and month = p_month;
end $$;
revoke all on function public.book_step(text,text,jsonb) from public, anon;
grant execute on function public.book_step(text,text,jsonb) to authenticated;

-- private bucket for documents (PDF lab results, bills, sign-in sheets, Excel exports)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('docs', 'docs', false, 20971520, array['application/pdf','image/jpeg','image/png','image/webp','image/heic',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.ms-excel','text/csv'])
on conflict (id) do nothing;
create policy "docs upload own hospital" on storage.objects for insert to authenticated
  with check (bucket_id = 'docs' and (storage.foldername(objects.name))[1] = (select h.code from public.hospitals h where h.id = public.my_hospital()));
create policy "docs read own hospital" on storage.objects for select to authenticated
  using (bucket_id = 'docs' and (storage.foldername(objects.name))[1] = (select h.code from public.hospitals h where h.id = public.my_hospital()));
