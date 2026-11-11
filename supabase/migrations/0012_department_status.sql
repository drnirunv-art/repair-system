-- 0012: department QR status page (additive). E-mail to departments deferred by the user (2026-11-11).

-- department status page (anyone who scans the department QR) ----------------------------------
create or replace function public.track_location_jobs(p_hospital_code text, p_location_id uuid)
returns table (job_no text, created_at timestamptz, building text, floor text, department text, detail text,
  status public.job_status, technician text, hold_category text, hold_until date, appointment_at timestamptz,
  cleared_at timestamptz, closed_at timestamptz, reporter_masked text, rating smallint, can_rate boolean)
language sql stable security definer set search_path = public as $$
  select j.job_no, j.created_at, j.building, j.floor, j.department, j.detail, j.status,
         p.full_name, j.hold_category, j.hold_until, j.appointment_at, j.cleared_at, j.closed_at,
         left(j.reporter_name, 2) || repeat('*', greatest(length(j.reporter_name) - 2, 1)),
         j.rating, (j.status in ('clear','evaluated','close') and j.rating is null)
  from locations l join hospitals h on h.id = l.hospital_id
  join jobs j on j.hospital_id = l.hospital_id
   and (j.location_id = l.id or (j.building = l.building and j.floor = l.floor and j.department = l.department))
  left join profiles p on p.id = j.technician_id
  where h.code = p_hospital_code and l.id = p_location_id
    and (j.status not in ('close','cancel') or j.created_at > now() - interval '60 days')
  order by (j.status in ('close','cancel')), j.created_at desc
  limit 60
$$;
revoke execute on function public.track_location_jobs(text, uuid) from public;
grant execute on function public.track_location_jobs(text, uuid) to anon, authenticated;

-- optional reporter e-mail (asked 2026-11-11). Stored now; sending is set up later. ---------------
alter table public.jobs add column if not exists reporter_email text
  check (reporter_email is null or reporter_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$');

-- the public form calls this right after submit_job; phone must match and the job must be fresh
create or replace function public.set_reporter_email(p_job_no text, p_phone text, p_email text)
returns void language plpgsql security definer set search_path = public as $$
declare j jobs;
begin
  if nullif(trim(coalesce(p_email,'')), '') is null then return; end if;
  if trim(p_email) !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'รูปแบบอีเมลไม่ถูกต้อง'; end if;
  select * into j from jobs where job_no = trim(p_job_no);
  if j.id is null then raise exception 'ไม่พบใบงาน'; end if;
  if regexp_replace(j.reporter_phone, '\D', '', 'g') <> regexp_replace(coalesce(p_phone,''), '\D', '', 'g')
     or j.created_at < now() - interval '30 minutes' then raise exception 'บันทึกอีเมลไม่ได้'; end if;
  update jobs set reporter_email = lower(trim(p_email)) where id = j.id;
end $$;
revoke execute on function public.set_reporter_email(text, text, text) from public;
grant execute on function public.set_reporter_email(text, text, text) to anon, authenticated;
