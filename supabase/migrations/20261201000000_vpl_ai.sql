-- vpl · one key on the account (stage 1 of vp)
--
-- A model key was pasted into every browser, on every address: five apps, two
-- browsers, three accounts. This table is the drawer it goes into once. It is
-- the only table every app may read, hence the suite prefix vpl_ and not an
-- app prefix.
--
-- The key is stored as the person wrote it, guarded by row level security: only
-- its owner can read the row. It is not encrypted per field — the database is
-- the lock, the same way it is for the notes. The settings dialog says so.
--
-- Apps copy the row into their own localStorage when a browser has no key, so
-- the call still leaves from the browser and the key still goes only to the
-- provider. No proxy, no credits, no logging: that is stage 2, not this.

create table if not exists public.vpl_ai (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  url        text not null default '',
  model      text not null default '',
  api_key    text not null default '',
  updated_at timestamptz not null default now()
);

alter table public.vpl_ai enable row level security;

drop policy if exists vpl_ai_read_own on public.vpl_ai;
create policy vpl_ai_read_own on public.vpl_ai
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists vpl_ai_write_own on public.vpl_ai;
create policy vpl_ai_write_own on public.vpl_ai
  for insert to authenticated with check (user_id = (select auth.uid()));

drop policy if exists vpl_ai_update_own on public.vpl_ai;
create policy vpl_ai_update_own on public.vpl_ai
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists vpl_ai_delete_own on public.vpl_ai;
create policy vpl_ai_delete_own on public.vpl_ai
  for delete to authenticated using (user_id = (select auth.uid()));

revoke all on public.vpl_ai from anon;
grant select, insert, update, delete on public.vpl_ai to authenticated;

create or replace function public.vpl_ai_touch()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists vpl_ai_touch on public.vpl_ai;
create trigger vpl_ai_touch before update on public.vpl_ai
  for each row execute function public.vpl_ai_touch();

-- Account deletion, corrected: the vc migration was copied from vd and purged
-- vc_ twice, so vd's jobs were never deleted. Both are here now, plus the key.
create or replace function public.vpl_delete_my_account()
returns void
language plpgsql security definer
set search_path = public, auth
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'not signed in' using errcode = 'insufficient_privilege';
  end if;

  -- vn
  delete from public.vn_shares where owner_id = me;
  delete from public.vn_shares
   where lower(email) = lower(coalesce((select u.email from auth.users u where u.id = me), ''));
  delete from public.vn_notes where user_id = me;

  -- vi (vi_ideas falls with its project)
  delete from public.vi_projects where user_id = me;

  -- vr (rows, words and shares fall with their project)
  delete from public.vr_shares where owner_id = me;
  delete from public.vr_shares
   where lower(email) = lower(coalesce((select u.email from auth.users u where u.id = me), ''));
  delete from public.vr_projects where user_id = me;

  -- vz (keys and shares fall with their project)
  delete from public.vz_shares where owner_id = me;
  delete from public.vz_shares
   where lower(email) = lower(coalesce((select u.email from auth.users u where u.id = me), ''));
  delete from public.vz_projects where user_id = me;

  -- vd (artifacts, runs and outputs fall with their job)
  delete from public.vd_shares where owner_id = me;
  delete from public.vd_shares
   where lower(email) = lower(coalesce((select u.email from auth.users u where u.id = me), ''));
  delete from public.vd_projects where user_id = me;

  -- vc
  delete from public.vc_shares where owner_id = me;
  delete from public.vc_shares
   where lower(email) = lower(coalesce((select u.email from auth.users u where u.id = me), ''));
  delete from public.vc_projects where user_id = me;

  -- the key of record
  delete from public.vpl_ai where user_id = me;

  delete from auth.users where id = me;
end;
$$;

revoke all on function public.vpl_delete_my_account() from public, anon;
grant execute on function public.vpl_delete_my_account() to authenticated;
