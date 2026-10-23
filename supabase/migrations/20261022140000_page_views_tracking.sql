-- Page views tracking
--
-- This migration adds a table to track page views per path and a function
-- to increment the view count atomically.

create table if not exists public.site_page_views (
  path            text        primary key,
  view_count      bigint      not null default 0 check (view_count >= 0),
  first_seen_at   timestamptz not null default now(),
  last_seen_at    timestamptz not null default now()
);

create or replace function public.increment_page_view(p_path text)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count bigint;
begin
  insert into public.site_page_views (path, view_count, first_seen_at, last_seen_at)
  values (p_path, 1, now(), now())
  on conflict (path) do update
    set view_count = site_page_views.view_count + 1,
        last_seen_at = now()
  returning view_count;
end;
$$;

-- Grants for the page views tracking
grant select on public.site_page_views to anon, authenticated;
grant execute on function public.increment_page_view(text) to anon, authenticated;
