-- 0024 Job codes and response-time targets used at Phyathai Sriracha, for all 12 hospitals (user: "ใช้ทั้ง12โรง").
-- Additive: one new column, renames and new rows. Nothing is deleted; CH and WW are only hidden (no job uses them).

alter table public.priorities add column if not exists respond_minutes int check (respond_minutes is null or respond_minutes > 0);
comment on column public.priorities.respond_minutes is 'minutes from report until a technician accepts; sla_minutes stays the repair-finished target';

update public.priorities p set name = 'Urgent'
  where name = 'Priority' and not exists (select 1 from public.priorities x where x.hospital_id = p.hospital_id and x.name = 'Urgent');
update public.priorities set respond_minutes = case name when 'Critical' then 5 when 'Urgent' then 15 when 'Non-priority' then 45 end
  where name in ('Critical', 'Urgent', 'Non-priority') and respond_minutes is null;

update public.job_types t set code = 'BU', name = 'BU งานอาคาร'
  where code = 'CV' and not exists (select 1 from public.job_types x where x.hospital_id = t.hospital_id and x.code = 'BU');
update public.job_types t set code = 'Other', name = 'Other อื่น ๆ'
  where code = 'OT' and not exists (select 1 from public.job_types x where x.hospital_id = t.hospital_id and x.code = 'Other');
update public.job_types set name = 'AC ระบบปรับอากาศ' where code = 'AC' and name = 'ระบบแอร์';
update public.job_types set name = 'EE ระบบไฟฟ้า' where code = 'EE' and name = 'ไฟฟ้า';
update public.job_types set name = 'SN ระบบสุขาภิบาล / ประปา' where code = 'SN' and name = 'ประปา/สุขาภิบาล';
insert into public.job_types (hospital_id, code, name)
  select h.id, v.code, v.name from public.hospitals h
  cross join (values ('Commu', 'Commu ระบบสื่อสาร'), ('FA', 'FA ระบบแจ้งเหตุเพลิงไหม้'), ('ROOM', 'ตรวจห้องพร้อมใช้')) v(code, name)
  on conflict (hospital_id, code) do nothing;
update public.job_types t set active = false
  where code in ('CH', 'WW') and name in ('Chiller', 'บ่อบำบัดน้ำเสีย') and not exists (select 1 from public.jobs j where j.job_type_id = t.id);
