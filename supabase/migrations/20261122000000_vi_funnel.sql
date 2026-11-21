-- vpl · vi — the funnel's two tables.
--
-- Replaces the placeholder list (one line per idea) that proved the shell was
-- shareable. Same namespace, same rules, a real shape now:
--
--   vi_projects  one row per funnel: the title, the stage documents
--   vi_ideas     one row per sticky note: the idea, its stage, its reason
--
-- No cross-app joins. The only thing shared with vn is the signed-in person.

drop table if exists public.vi_ideas;

create table public.vi_projects (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid(),
  title       text not null default 'untitled funnel',
  context     text not null default '',
  exploration text not null default '',
  simulation  text not null default '',
  chosen_id   uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.vi_ideas (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.vi_projects(id) on delete cascade,
  user_id     uuid not null default auth.uid(),
  text        text not null check (length(btrim(text)) > 0),
  stage       text not null default 'ideation'
              check (stage in ('ideation', 'parked', 'selected', 'simulated')),
  color       text not null default 'butter',
  reason      text not null default '',
  exploration text not null default '',
  explored_at timestamptz,
  position    integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- one chosen idea per project, enforced by the database rather than by hope
create unique index vi_ideas_one_selected
  on public.vi_ideas (project_id) where stage = 'selected';

create index vi_projects_owner_idx on public.vi_projects (user_id, updated_at desc);
create index vi_ideas_project_idx on public.vi_ideas (project_id, position, created_at);

alter table public.vi_projects enable row level security;
alter table public.vi_ideas enable row level security;

drop policy if exists vi_projects_own_all on public.vi_projects;
create policy vi_projects_own_all on public.vi_projects
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists vi_ideas_own_all on public.vi_ideas;
create policy vi_ideas_own_all on public.vi_ideas
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop trigger if exists vi_projects_touch on public.vi_projects;
create trigger vi_projects_touch before update on public.vi_projects
  for each row execute function public.touch_updated_at();

drop trigger if exists vi_ideas_touch on public.vi_ideas;
create trigger vi_ideas_touch before update on public.vi_ideas
  for each row execute function public.touch_updated_at();

-- the suite's one shared body: adding an app means one delete line here
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

  delete from auth.users where id = me;
end;
$$;

revoke all on function public.vpl_delete_my_account() from public, anon;
grant execute on function public.vpl_delete_my_account() to authenticated;
