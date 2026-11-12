-- 0022 Repair-system survey (opinions + improvement requests), from the paper form "แบบสอบถามความคิดเห็นและข้อเสนอปรับปรุงระบบแจ้งซ่อม".
-- Anyone with the hospital's link or QR can answer without logging in; staff of that hospital read the summary. Additive only.

create table if not exists public.survey_responses (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null references public.hospitals(id) on delete cascade,
  respondent text, unit text,
  role text not null check (role in ('reporter','technician','chief','executive','other')),
  role_other text,
  frequency text not null check (frequency in ('daily','weekly','monthly','rarely')),
  scores jsonb not null default '{}',          -- {"1":5, ... "7":4}; a topic never used may be skipped
  problems text[] not null default '{}', problem_detail text,
  features text[] not null default '{}',
  first_fix text, suggestion text,
  created_at timestamptz not null default now()
);
create index if not exists survey_responses_hosp_idx on public.survey_responses (hospital_id, created_at desc);
alter table public.survey_responses enable row level security;
create policy "survey read own hospital" on public.survey_responses for select to authenticated
  using (hospital_id = public.my_hospital() and public.my_role() <> 'observer');
grant select on public.survey_responses to authenticated;

create or replace function public.survey_submit(p_hospital text, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare h uuid; k text; v int; s jsonb := '{}'; t text := left(nullif(trim(coalesce(p->>'role_other', '')), ''), 200);
  pr text[] := array(select left(x, 40) from jsonb_array_elements_text(coalesce(p->'problems', '[]')) x limit 12);
  fe text[] := array(select left(x, 40) from jsonb_array_elements_text(coalesce(p->'features', '[]')) x limit 12);
begin
  select id into h from hospitals where upper(code) = upper(trim(p_hospital)) and active;
  if h is null then raise exception 'ไม่พบโรงพยาบาล'; end if;
  if coalesce(p->>'role', '') not in ('reporter','technician','chief','executive','other') then raise exception 'เลือกบทบาทการใช้งานระบบ'; end if;
  if p->>'role' = 'other' and t is null then raise exception 'ระบุบทบาทอื่น ๆ'; end if;
  if coalesce(p->>'frequency', '') not in ('daily','weekly','monthly','rarely') then raise exception 'เลือกความถี่ในการใช้งาน'; end if;
  for k in select jsonb_object_keys(coalesce(p->'scores', '{}')) loop
    if k not in ('1','2','3','4','5','6','7') then continue; end if;
    v := (p->'scores'->>k)::int;
    if v not between 1 and 5 then raise exception 'คะแนนต้องอยู่ระหว่าง 1–5'; end if;
    s := s || jsonb_build_object(k, v);
  end loop;
  if s = '{}' then raise exception 'ให้คะแนนอย่างน้อย 1 หัวข้อ'; end if;
  -- the same answers sent twice within a minute (double tap) are kept once
  if exists (select 1 from survey_responses where hospital_id = h and created_at > now() - interval '1 minute' and scores = s
      and coalesce(suggestion, '') = coalesce(left(nullif(trim(coalesce(p->>'suggestion', '')), ''), 2000), '') and role = p->>'role') then return; end if;
  if (select count(*) from survey_responses where hospital_id = h and created_at > now() - interval '1 hour') >= 300 then raise exception 'มีผู้ตอบจำนวนมาก ลองใหม่ภายหลัง'; end if;
  insert into survey_responses (hospital_id, respondent, unit, role, role_other, frequency, scores, problems, problem_detail, features, first_fix, suggestion)
  values (h, left(nullif(trim(coalesce(p->>'respondent', '')), ''), 120), left(nullif(trim(coalesce(p->>'unit', '')), ''), 120), p->>'role',
    case when p->>'role' = 'other' then t end, p->>'frequency', s, pr, left(nullif(trim(coalesce(p->>'problem_detail', '')), ''), 2000), fe,
    left(nullif(trim(coalesce(p->>'first_fix', '')), ''), 1000), left(nullif(trim(coalesce(p->>'suggestion', '')), ''), 2000));
end $$;
revoke all on function public.survey_submit(text, jsonb) from public;
grant execute on function public.survey_submit(text, jsonb) to anon, authenticated;
