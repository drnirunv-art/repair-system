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
