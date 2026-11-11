-- 0013: e-mail status updates to reporters who left an e-mail (additive).
-- Sending: edge function "send-mail" (Gmail SMTP, secrets GMAIL_USER / GMAIL_APP_PASSWORD).
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;

create table if not exists public.email_outbox (
  id bigint generated always as identity primary key,
  hospital_id uuid not null references public.hospitals(id) on delete cascade,
  job_id uuid references public.jobs(id) on delete cascade,
  to_email text not null,
  subject text not null,
  body_text text not null,
  status text not null default 'pending' check (status in ('pending','sending','sent','failed')),
  attempts int not null default 0,
  error text,
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  sent_at timestamptz
);
create index if not exists email_outbox_pending_idx on public.email_outbox (status, created_at) where status in ('pending','sending');
alter table public.email_outbox enable row level security;
create policy "outbox managers read" on public.email_outbox for select to authenticated
  using (hospital_id = public.my_hospital() and public.is_manager());
grant select on public.email_outbox to authenticated;

create or replace function public.job_status_th(s public.job_status) returns text
language sql immutable set search_path = public as $$
  select case s when 'register' then 'รับเรื่องแล้ว รอมอบหมายช่าง' when 'assign' then 'มอบหมายช่างแล้ว'
    when 'work_on' then 'ช่างกำลังซ่อม' when 'on_hold' then 'พักงานชั่วคราว' when 'clear' then 'ซ่อมเสร็จแล้ว รอหัวหน้าตรวจงาน'
    when 'evaluated' then 'ตรวจงานแล้ว' when 'close' then 'ปิดงานเรียบร้อย' when 'cancel' then 'ยกเลิกใบงาน' end
$$;

-- queue a mail when the reporter's e-mail is first saved (receipt) and on each status change
create or replace function public.jobs_queue_reporter_email() returns trigger
language plpgsql security definer set search_path = public as $$
declare h hospitals; tech text; link text;
begin
  if new.reporter_email is null then return new; end if;
  if not ((old.reporter_email is null and new.reporter_email is not null)
          or new.status is distinct from old.status) then return new; end if;
  if new.status = 'evaluated' then return new; end if;
  select * into h from hospitals where id = new.hospital_id;
  select full_name into tech from profiles where id = new.technician_id;
  link := 'https://drnirunv-art.github.io/repair-system/?h=' || h.code || '&q=' || new.job_no;
  insert into email_outbox (hospital_id, job_id, to_email, subject, body_text)
  values (new.hospital_id, new.id, new.reporter_email,
    'ใบงานแจ้งซ่อม ' || new.job_no || ' : ' || job_status_th(new.status),
    'เรียน คุณ' || new.reporter_name || E'\n\n' ||
    'ใบงานแจ้งซ่อมเลขที่ ' || new.job_no || E'\n' ||
    'สถานะล่าสุด: ' || job_status_th(new.status) || E'\n' ||
    'ตำแหน่ง: ' || concat_ws(' · ', new.building, new.floor, new.department) || E'\n' ||
    'อาการที่แจ้ง: ' || new.detail || E'\n' ||
    case when tech is not null and new.status <> 'register' then 'ช่างผู้รับผิดชอบ: ' || tech || E'\n' else '' end ||
    case when new.status = 'on_hold' then 'เหตุผลที่พักงาน: ' || concat_ws(' - ', new.hold_category, nullif(new.hold_reason,''))
         || coalesce(' (คาดว่าจะกลับมาทำ ' || to_char(new.hold_until, 'DD/MM/YYYY') || ')', '') || E'\n' else '' end ||
    case when new.status in ('clear','close') and new.summary is not null then 'สรุปการซ่อม: ' || new.summary || E'\n' else '' end ||
    E'\nดูรายละเอียดและสถานะ: ' || link || E'\n' ||
    case when new.status in ('clear','close') and new.rating is null then 'ให้คะแนนความพึงพอใจได้ที่ลิงก์เดียวกัน (ใช้เบอร์โทรที่แจ้งไว้)' || E'\n' else '' end ||
    E'\n' || h.name || ' งานวิศวกรรมอาคาร' || E'\n(อีเมลนี้ส่งอัตโนมัติ กรุณาอย่าตอบกลับ)');
  return new;
end $$;
revoke execute on function public.jobs_queue_reporter_email() from public, anon, authenticated;
create trigger jobs_queue_reporter_email after update of status, reporter_email on public.jobs
  for each row execute function public.jobs_queue_reporter_email();

-- the sender claims rows (no double sending); rows stuck in 'sending' for 10 min are retried
create or replace function public.claim_outbox(p_limit int default 20)
returns setof public.email_outbox language sql security definer set search_path = public as $$
  update email_outbox o set status = 'sending', claimed_at = now(), attempts = o.attempts + 1
  where o.id in (select id from email_outbox
                 where (status = 'pending' or (status = 'sending' and claimed_at < now() - interval '10 minutes'))
                   and attempts < 5
                 order by id limit p_limit for update skip locked)
  returning o.*
$$;
revoke execute on function public.claim_outbox(int) from public, anon, authenticated;
grant execute on function public.claim_outbox(int) to service_role;

-- wake the sender right away, plus every 5 minutes for retries
create or replace function public.kick_send_mail() returns void
language sql security definer set search_path = public, extensions as $$
  select net.http_post(url := 'https://ufyhxubzpoqjkvrejxek.supabase.co/functions/v1/send-mail',
                       body := '{}'::jsonb, headers := '{"Content-Type":"application/json"}'::jsonb, timeout_milliseconds := 20000);
$$;
revoke execute on function public.kick_send_mail() from public, anon, authenticated;
create or replace function public.outbox_kick() returns trigger
language plpgsql security definer set search_path = public as $$
begin perform kick_send_mail(); return null; end $$;
revoke execute on function public.outbox_kick() from public, anon, authenticated;
create trigger outbox_kick after insert on public.email_outbox
  for each statement execute function public.outbox_kick();
select cron.schedule('send-mail-retry', '*/5 * * * *', $$select public.kick_send_mail()$$);
