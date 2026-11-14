-- 12-hospital viewers (exec_viewers) may upload / edit check sheets for any hospital, and the central standard
-- (hospital_id null = used by every hospital that has no version of its own). Additive: existing policies stay.
create policy "pm templates exec insert" on public.pm_templates for insert to authenticated with check (public.am_exec());
create policy "pm templates exec update" on public.pm_templates for update to authenticated using (public.am_exec()) with check (public.am_exec());
