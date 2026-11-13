-- 0025 Planned finish date for backlog jobs ("งานค้างให้มีการใส่วันกำหนดเสร็จ โดยการวางแผนเสร็จ"). Additive only.

alter table public.jobs
  add column if not exists plan_due date,
  add column if not exists plan_note text,
  add column if not exists plan_by uuid references public.profiles(id),
  add column if not exists plan_at timestamptz;

-- staff of the job's hospital (not observers) set or change the planned finish date of an open job; every change is kept in the job history
create or replace function public.job_plan(p_job_id uuid, p_date date, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare j jobs; n text := left(nullif(trim(coalesce(p_note, '')), ''), 500);
begin
  if auth.uid() is null or public.my_role() is null or public.my_role() = 'observer' then raise exception 'ไม่มีสิทธิ์'; end if;
  select * into j from jobs where id = p_job_id and hospital_id = public.my_hospital() for update;
  if j.id is null then raise exception 'ไม่พบใบงาน'; end if;
  if j.status not in ('register','assign','work_on','on_hold') then raise exception 'ใบงานนี้ซ่อมเสร็จหรือปิดแล้ว'; end if;
  if p_date is null then raise exception 'เลือกวันกำหนดเสร็จ'; end if;
  if p_date < (now() at time zone 'Asia/Bangkok')::date then raise exception 'วันกำหนดเสร็จต้องไม่ใช่วันที่ผ่านมาแล้ว'; end if;
  if j.plan_due is not null and p_date <> j.plan_due and n is null then raise exception 'เลื่อนวันกำหนดเสร็จ ต้องใส่เหตุผล'; end if;
  update jobs set plan_due = p_date, plan_note = n, plan_by = auth.uid(), plan_at = now() where id = j.id;
  insert into job_events (job_id, status, note, actor_id)
  values (j.id, j.status, case when j.plan_due is null then 'วางแผนกำหนดเสร็จ ' else 'เลื่อนกำหนดเสร็จจาก ' || to_char(j.plan_due, 'DD/MM/YYYY') || ' เป็น ' end
    || to_char(p_date, 'DD/MM/YYYY') || coalesce(' · ' || n, ''), auth.uid());
end $$;
revoke all on function public.job_plan(uuid, date, text) from public, anon;
grant execute on function public.job_plan(uuid, date, text) to authenticated;
