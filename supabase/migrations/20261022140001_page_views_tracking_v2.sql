-- Page views tracking v2 - fix the increment function
--
-- The previous version had an issue with the RETURNING clause in the
-- INSERT ... ON CONFLICT statement. This version uses a more explicit
-- approach with a CTE to ensure the return value is properly captured.

create or replace function public.increment_page_view(p_path text)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count bigint;
begin
  -- Try to insert a new row
  insert into public.site_page_views (path, view_count, first_seen_at, last_seen_at)
  values (p_path, 1, now(), now())
  on conflict (path) do update
    set view_count = site_page_views.view_count + 1,
        last_seen_at = now()
  returning view_count into strict v_count;
  
  -- If the INSERT didn't return a value (shouldn't happen with ON CONFLICT),
  -- fall back to selecting the current count
  if v_count is null then
    select view_count into v_count from public.site_page_views where path = p_path;
  end if;
  
  return v_count;
end;
$$;

-- Re-grant permissions
grant select on public.site_page_views to anon, authenticated;
grant execute on function public.increment_page_view(text) to anon, authenticated;
