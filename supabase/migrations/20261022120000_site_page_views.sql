-- Lifetime page views tracking
-- One row per unique page path, tracking lifetime view count

create table if not exists public.site_page_views (
  path text primary key,
  view_count bigint not null default 0 check (view_count >= 0),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index if not exists idx_site_page_views_last_seen on public.site_page_views (last_seen_at desc);

-- Function to register a page view
create or replace function public.register_page_view(p_path text)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count bigint;
begin
  insert into public.site_page_views (path, view_count, last_seen_at)
  values (p_path, 1, now())
  on conflict (path) do update
    set view_count = site_page_views.view_count + 1,
        last_seen_at = now()
  returning view_count into v_count;
  return v_count;
end;
$$;

-- Function to get all page views
create or replace function public.get_page_views()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  select jsonb_agg(to_jsonb(t) order by t.view_count desc)
  from (
    select path, view_count, first_seen_at, last_seen_at
    from public.site_page_views
    order by view_count desc
  ) t
  into v_result;
  return coalesce(v_result, '[]'::jsonb);
end;
$$;

-- Function to get total lifetime views across all pages
create or replace function public.get_total_lifetime_views()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total bigint;
begin
  select sum(view_count) into v_total from public.site_page_views;
  return coalesce(v_total, 0);
end;
$$;

-- Grant permissions
grant select on public.site_page_views to anon, authenticated;
grant execute on function public.register_page_view(text) to anon, authenticated;
grant execute on function public.get_page_views() to anon, authenticated;
grant execute on function public.get_total_lifetime_views() to anon, authenticated;

-- Initialize the table if empty
insert into public.site_page_views (path, view_count) values ('/', 0)
on conflict (path) do nothing;
