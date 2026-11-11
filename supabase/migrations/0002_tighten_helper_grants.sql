revoke execute on function public.my_hospital(), public.my_role(), public.is_manager() from public, anon;
grant execute on function public.my_hospital(), public.my_role(), public.is_manager() to authenticated;
revoke execute on function public.track_jobs(text, text) from public;
grant execute on function public.track_jobs(text, text) to anon, authenticated;
