-- vpl · vi — the second app, and the first proof that the suite's rule works.
--
-- Its own table, its own prefix, its own policies. It shares exactly one thing
-- with vn: the person signed in. No foreign key, no view, no join — an idea is
-- not a note, and neither app can read the other's rows.

create table if not exists public.vi_ideas (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid(),
  text       text not null check (length(btrim(text)) > 0),
  done       boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists vi_ideas_live_idx
  on public.vi_ideas (user_id, created_at desc);

alter table public.vi_ideas enable row level security;

drop policy if exists vi_ideas_own_all on public.vi_ideas;
create policy vi_ideas_own_all on public.vi_ideas
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop trigger if exists vi_ideas_touch on public.vi_ideas;
create trigger vi_ideas_touch before update on public.vi_ideas
  for each row execute function public.touch_updated_at();

-- Deleting an account must take these with it. vn_delete_my_account knew only
-- about vn; the suite's list of app tables is now the place to add one line
-- per app. It is the single thing every app shares, so it stays in one body.
create or replace function public.vpl_delete_my_account()
returns void
language plpgsql security definer
set search_path = public, auth
as $$
declare
  me   uuid := auth.uid();
begin
  if me is null then
    raise exception 'not signed in' using errcode = 'insufficient_privilege';
  end if;

  -- vn
  delete from public.vn_shares where owner_id = me;
  delete from public.vn_shares
   where lower(email) = lower(coalesce((select u.email from auth.users u where u.id = me), ''));
  delete from public.vn_notes where user_id = me;

  -- vi
  delete from public.vi_ideas where user_id = me;

  delete from auth.users where id = me;
end;
$$;

revoke all on function public.vpl_delete_my_account() from public, anon;
grant execute on function public.vpl_delete_my_account() to authenticated;

comment on function public.vpl_delete_my_account() is
  'One body for every app: adding an app means adding one delete line here.';
