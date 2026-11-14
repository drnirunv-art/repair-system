-- 0031 One-time bulk import of yearly PM plans from the owner's computer (tools/pm-bulk-import).
-- A caller that knows a valid, unexpired token may import plan rows for a hospital code. Tokens are stored hashed,
-- are created by hand for one job and expire; with no valid token in the table the function does nothing. Additive.
create table if not exists public.import_tokens (
  token_hash text primary key,
  expires_at timestamptz not null,
  note text,
  created_at timestamptz not null default now()
);
alter table public.import_tokens enable row level security;
revoke all on public.import_tokens from anon, authenticated;

create or replace function public.pm_import_token(p_token text, p_code text, p_year int, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare h uuid;
begin
  if p_token is null or length(p_token) < 32 or not exists (select 1 from import_tokens
      where token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex') and expires_at > now()) then
    raise exception 'token ไม่ถูกต้องหรือหมดอายุ';
  end if;
  select id into h from hospitals where upper(code) = upper(trim(p_code));
  if h is null then raise exception 'ไม่พบโรงพยาบาลรหัส %', p_code; end if;
  return public.pm_import_core(h, p_year, p_rows);
end $$;
revoke all on function public.pm_import_token(text, text, int, jsonb) from public;
grant execute on function public.pm_import_token(text, text, int, jsonb) to anon, authenticated;
