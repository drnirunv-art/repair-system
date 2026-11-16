-- 0044: FMS Round follows the hospital ticks of 0042 (user 2026-11-16: an inspector given one hospital must not be able
-- to pick the others). Recording in a hospital now needs: a 12-hospital executive, or an FMS committee member to whom
-- that hospital was given (their own hospital, the ticked ones, or "ทุกโรงพยาบาล"). Replaces the 0038 "any hospital" rule.
create or replace function public.fms_in(h uuid) returns boolean language sql stable security definer set search_path = public as
$$ select h is not null and (public.am_exec() or (public.fms_can() and exists (select 1 from public.my_hospitals() m where m.id = h))) $$;
