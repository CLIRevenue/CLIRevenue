-- Site-wide "heart" counter.
--
-- One row, one integer. The increment is deliberately a SECURITY DEFINER
-- function rather than a client-side read-modify-write: two simultaneous
-- clicks would each read the same count and each write count+1, losing one
-- click, and an anonymous client cannot be trusted to only ever add one.
-- The function is the only write path; RLS denies every direct write.

create table if not exists public.site_hearts (
  id          smallint    primary key default 1 check (id = 1),
  hearts      bigint      not null default 0 check (hearts >= 0),
  updated_at  timestamptz not null default now()
);

comment on table public.site_hearts is
  'Single-row counter for the public heart button. Write only via increment_heart().';

insert into public.site_hearts (id, hearts)
values (1, 0)
on conflict (id) do nothing;

-- The increment. Atomic, idempotent-free, and the only thing that may write.
create or replace function public.increment_heart()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  next bigint;
begin
  update public.site_hearts
     set hearts = hearts + 1,
         updated_at = now()
   where id = 1
  returning hearts into next;
  return coalesce(next, 0);
end;
$$;

-- A visitor can read the total. Nobody reads or writes the table directly
-- from the browser -- that is what the function is for.
alter table public.site_hearts enable row level security;

drop policy if exists "site_hearts are readable by everyone" on public.site_hearts;
create policy "site_hearts are readable by everyone"
  on public.site_hearts for select
  to anon, authenticated
  using (true);

revoke insert, update, delete on public.site_hearts from anon, authenticated;

grant execute on function public.increment_heart() to anon, authenticated;