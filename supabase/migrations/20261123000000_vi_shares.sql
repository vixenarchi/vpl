-- vi — sharing a funnel.
--
-- The unit is the whole funnel, not one stage: the stages only mean something in
-- order, and a funnel read half-way is a pile of sentences. A grant gives
-- exactly three rights to choose from:
--
--   view  read the funnel, its ideas, reasons and sketches; touch nothing
--   edit  write text — the context, an exploration, the test plan, a new idea
--         on the wall — but not decide: choosing, parking and deleting stay with
--         the owner, because those are the funnel's whole point
--
-- A public code is not an account and not a grant: it is read through
-- vi_read_share(code), which returns rows for that code and nothing else. A
-- personal grant is read through RLS, as in vn.

create table if not exists public.vi_shares (
  id         uuid primary key default extensions.gen_random_uuid(),
  project_id uuid not null references public.vi_projects(id) on delete cascade,
  owner_id   uuid not null references auth.users(id) on delete cascade,
  code       text,
  email      text,
  role       text not null default 'view',
  pending    boolean not null default false,
  created_at timestamptz not null default now(),
  constraint vi_shares_one_target check ((code is null) <> (email is null)),
  constraint vi_shares_role_check check (role in ('view', 'edit')),
  constraint vi_shares_code_len check (code is null or length(code) >= 16)
);

comment on column public.vi_shares.code is
  'Public link token. Read-only for anyone, signed in or not, through vi_read_share().';
comment on column public.vi_shares.email is
  'Lowercased address of the one account this grant is for.';

create unique index if not exists vi_shares_code_key
  on public.vi_shares (code) where code is not null;
create unique index if not exists vi_shares_project_email
  on public.vi_shares (project_id, lower(email)) where email is not null;

alter table public.vi_shares enable row level security;

drop policy if exists vi_shares_owner_all on public.vi_shares;
create policy vi_shares_owner_all on public.vi_shares
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists vi_shares_own_grant on public.vi_shares;
create policy vi_shares_own_grant on public.vi_shares
  for select using (email is not null and lower(email) = lower(auth.jwt() ->> 'email'));

/* Which rights does this person hold on this funnel? Null means none. */
create or replace function public.vi_share_role(project uuid, viewer_email text)
returns text
language sql stable security definer
set search_path = public
as $$
  select s.role
    from public.vi_shares s
   where s.project_id = project
     and s.pending = false
     and viewer_email is not null
     and s.email is not null
     and lower(s.email) = lower(viewer_email)
   order by (s.role = 'edit') desc
   limit 1;
$$;

comment on function public.vi_share_role(uuid, text) is
  'Nearest personal grant on this funnel. A public code is not a grant; it is read through vi_read_share().';

/* The rows behind one public code: the funnel and its ideas, in order. */
create or replace function public.vi_read_share(p_code text)
returns table (
  project_id uuid, title text, context text, exploration text, simulation text,
  chosen_id uuid, updated_at timestamptz,
  idea_id uuid, idea_text text, stage text, color text, reason text,
  idea_exploration text, "position" integer
)
language sql stable security definer
set search_path = public
as $$
  select p.id, p.title, p."context", p.exploration, p.simulation,
         p.chosen_id, p.updated_at,
         i.id, i.text, i.stage, i.color, i.reason,
         i.exploration, i.position
    from public.vi_shares s
    join public.vi_projects p on p.id = s.project_id
    left join public.vi_ideas i on i.project_id = p.id
   where s.code = p_code
     and s.code is not null
   order by i.position nulls last, i.id;
$$;

comment on function public.vi_read_share(text) is
  'The rows behind one public code. Handed the code, so no account and no listing.';

revoke all on function public.vi_read_share(text) from public;
grant execute on function public.vi_read_share(text) to anon, authenticated;

revoke all on function public.vi_share_role(uuid, text) from public;
grant execute on function public.vi_share_role(uuid, text) to authenticated;

/* RLS on the two tables: a grant reads, an edit grant writes text — never the
 * decision columns, which are the owner's alone. */
drop policy if exists vi_projects_shared_read on public.vi_projects;
create policy vi_projects_shared_read on public.vi_projects
  for select using (
    public.vi_share_role(id, lower(auth.jwt() ->> 'email')) is not null
  );

drop policy if exists vi_projects_shared_write on public.vi_projects;
create policy vi_projects_shared_write on public.vi_projects
  for update using (
    public.vi_share_role(id, lower(auth.jwt() ->> 'email')) = 'edit'
  ) with check (
    public.vi_share_role(id, lower(auth.jwt() ->> 'email')) = 'edit'
  );

drop policy if exists vi_ideas_shared_read on public.vi_ideas;
create policy vi_ideas_shared_read on public.vi_ideas
  for select using (
    public.vi_share_role(project_id, lower(auth.jwt() ->> 'email')) is not null
  );

drop policy if exists vi_ideas_shared_write on public.vi_ideas;
create policy vi_ideas_shared_write on public.vi_ideas
  for update using (
    public.vi_share_role(project_id, lower(auth.jwt() ->> 'email')) = 'edit'
  ) with check (
    public.vi_share_role(project_id, lower(auth.jwt() ->> 'email')) = 'edit'
  );

/* Adding an idea to a funnel someone shared for editing. The insert must carry
 * the caller as user_id, as everywhere else. */
drop policy if exists vi_ideas_shared_add on public.vi_ideas;
create policy vi_ideas_shared_add on public.vi_ideas
  for insert with check (
    user_id = auth.uid()
    and public.vi_share_role(project_id, lower(auth.jwt() ->> 'email')) = 'edit'
  );
