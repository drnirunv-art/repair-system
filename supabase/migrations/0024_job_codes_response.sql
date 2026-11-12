-- 0024 Response-time targets and extra job codes used at Phyathai Sriracha, for all 12 hospitals.
-- User: "ใช้ทั้ง12โรง" then "เพิ่ม จากเดิมนะ": only ADD to what exists. Nothing is renamed, hidden or deleted.

alter table public.priorities add column if not exists respond_minutes int check (respond_minutes is null or respond_minutes > 0);
comment on column public.priorities.respond_minutes is 'minutes from report until a technician accepts; sla_minutes stays the repair-finished target';
update public.priorities set respond_minutes = case name when 'Critical' then 5 when 'Priority' then 15 when 'Non-priority' then 45 end
  where name in ('Critical', 'Priority', 'Non-priority') and respond_minutes is null;

insert into public.job_types (hospital_id, code, name)
  select h.id, v.code, v.name from public.hospitals h
  cross join (values ('Commu', 'ระบบสื่อสาร (Commu)'), ('FA', 'ระบบแจ้งเหตุเพลิงไหม้ (FA)'), ('ROOM', 'ตรวจห้องพร้อมใช้')) v(code, name)
  on conflict (hospital_id, code) do nothing;

comment on column public.jobs.due_minutes is 'finish target chosen at assignment: 360 (6 h), 1440 (24 h), 43200 (30 d), 86400 (60 d), 0 = over 60 days, null = not chosen';
