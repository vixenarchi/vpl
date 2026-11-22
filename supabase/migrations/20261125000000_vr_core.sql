-- vr — requirements, taken from the spreadsheet that was actually used.
--
-- Three levels of one document: the project (a brief and what is out of
-- scope), its requirements (rows, in order), and its glossary (the words the
-- rows assume). A fourth table shares the whole document, a link or a person,
-- exactly as vi does.
--
-- Nothing here is an attribute engine. A requirement is a row with a stable
-- name, one testable sentence, and how hard it is: must / optional / wish.

create table if not exists public.vr_projects (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  title       text not null default 'untitled spec',
  brief       text not null default '',
  assumptions text not null default '',
  scope       text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.vr_reqs (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.vr_projects (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  ref          text not null default '',
  kind         text not null default 'functional'
                 check (kind in ('functional', 'nonfunctional', 'constraint', 'rule')),
  strength     text not null default 'must'
                 check (strength in ('must', 'optional', 'wish')),
  theme        text not null default '',
  category     text not null default '',
  title        text not null default '',
  statement    text not null default '',
  detail       text not null default '',
  asis         text not null default '',
  tobe         text not null default '',
  horizon      text not null default '',
  source       text not null default '',
  verification text not null default '',
  metric       text not null default '',
  target       text not null default '',
  conditions   text not null default '',
  clause       text not null default '',
  status       text not null default 'draft'
                 check (status in ('draft', 'agreed', 'built', 'verified', 'dropped')),
  pos          integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create unique index if not exists vr_reqs_ref_unique
  on public.vr_reqs (project_id, ref) where ref <> '';
create index if not exists vr_reqs_project_order
  on public.vr_reqs (project_id, pos, created_at);
create index if not exists vr_reqs_theme
  on public.vr_reqs (project_id, theme);

create table if not exists public.vr_terms (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.vr_projects (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  term       text not null,
  meaning    text not null default '',
  created_at timestamptz not null default now()
);

create unique index if not exists vr_terms_once
  on public.vr_terms (project_id, lower(term));

create table if not exists public.vr_shares (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.vr_projects (id) on delete cascade,
  owner_id   uuid not null references auth.users (id) on delete cascade,
  code       text,
  email      text,
  role       text not null default 'view' check (role in ('view', 'edit')),
  pending    boolean not null default true,
  created_at timestamptz not null default now(),
  constraint vr_shares_one_target check (
    (code is not null and email is null) or (code is null and email is not null)),
  constraint vr_shares_code_length check (code is null or length(code) >= 16)
);

create unique index if not exists vr_shares_code_once
  on public.vr_shares (code) where code is not null;
create unique index if not exists vr_shares_person_once
  on public.vr_shares (project_id, lower(email)) where email is not null;

drop trigger if exists vr_projects_touch on public.vr_projects;
create trigger vr_projects_touch before update on public.vr_projects
  for each row execute function public.touch_updated_at();

drop trigger if exists vr_reqs_touch on public.vr_reqs;
create trigger vr_reqs_touch before update on public.vr_reqs
  for each row execute function public.touch_updated_at();

-- The name of a row is a promise. VR-001 never becomes VR-002, so the sheet can
-- be quoted, printed and argued over. The app passes explicit names when it
-- inserts a batch; this fills the blank in for a single row from the form.
create or replace function public.vr_ref_for()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  next_n integer;
begin
  if new.ref <> '' then return new; end if;
  select coalesce(max(nullif(regexp_replace(r.ref, '\D', '', 'g'), '')::int), 0) + 1
    into next_n
    from public.vr_reqs r
   where r.project_id = new.project_id;
  new.ref := 'VR-' || lpad(next_n::text, 3, '0');
  return new;
end;
$$;

drop trigger if exists vr_reqs_name on public.vr_reqs;
create trigger vr_reqs_name before insert on public.vr_reqs
  for each row execute function public.vr_ref_for();

/* ── who may do what ────────────────────────────────────────────────── */
-- The nearest grant for a person on a document, or null. Pending invitations
-- only exist in vn, where the invitee is told; a vr grant is effective at once.
create or replace function public.vr_share_role(project uuid, viewer_email text)
returns text
language sql stable security definer
set search_path = public
as $$
  select s.role
    from public.vr_shares s
   where s.project_id = project
     and s.email is not null
     and lower(s.email) = lower(coalesce(viewer_email, ''))
     and s.pending = false
   limit 1;
$$;

revoke all on function public.vr_share_role(uuid, text) from public, anon;
grant execute on function public.vr_share_role(uuid, text) to authenticated;

/* A code is a read, not a grant: it returns the document and goes away. No
 * listing, no id to ask with afterwards. */
create or replace function public.vr_read_share(p_code text)
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  p public.vr_projects;
begin
  select * into p from public.vr_projects q
    join public.vr_shares s on s.project_id = q.id
   where s.code = p_code and s.code is not null;
  if p.id is null then return null; end if;

  return jsonb_build_object(
    'project', to_jsonb(p),
    'reqs', coalesce((select jsonb_agg(to_jsonb(r) order by r.pos, r.created_at)
                        from public.vr_reqs r where r.project_id = p.id), '[]'::jsonb),
    'terms', coalesce((select jsonb_agg(to_jsonb(t) order by lower(t.term))
                        from public.vr_terms t where t.project_id = p.id), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.vr_read_share(text) from public;
grant execute on function public.vr_read_share(text) to anon, authenticated;

/* ── row level security ─────────────────────────────────────────────── */
alter table public.vr_projects enable row level security;
alter table public.vr_reqs     enable row level security;
alter table public.vr_terms    enable row level security;
alter table public.vr_shares   enable row level security;

drop policy if exists vr_projects_read on public.vr_projects;
create policy vr_projects_read on public.vr_projects for select to authenticated
  using (user_id = auth.uid()
         or public.vr_share_role(id, lower(coalesce(auth.jwt() ->> 'email', ''))) is not null);

drop policy if exists vr_projects_write on public.vr_projects;
create policy vr_projects_write on public.vr_projects for update to authenticated
  using (user_id = auth.uid()
         or public.vr_share_role(id, lower(coalesce(auth.jwt() ->> 'email', ''))) = 'edit')
  with check (user_id = auth.uid()
         or public.vr_share_role(id, lower(coalesce(auth.jwt() ->> 'email', ''))) = 'edit');

drop policy if exists vr_projects_make on public.vr_projects;
create policy vr_projects_make on public.vr_projects for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists vr_projects_drop on public.vr_projects;
create policy vr_projects_drop on public.vr_projects for delete to authenticated
  using (user_id = auth.uid());

drop policy if exists vr_reqs_read on public.vr_reqs;
create policy vr_reqs_read on public.vr_reqs for select to authenticated
  using (exists (
    select 1 from public.vr_projects p
     where p.id = project_id
       and (p.user_id = auth.uid()
            or public.vr_share_role(p.id, lower(coalesce(auth.jwt() ->> 'email', ''))) is not null)));

drop policy if exists vr_reqs_write on public.vr_reqs;
create policy vr_reqs_write on public.vr_reqs for update to authenticated
  using (exists (
    select 1 from public.vr_projects p
     where p.id = project_id
       and (p.user_id = auth.uid()
            or public.vr_share_role(p.id, lower(coalesce(auth.jwt() ->> 'email', ''))) = 'edit')))
  with check (exists (
    select 1 from public.vr_projects p
     where p.id = project_id
       and (p.user_id = auth.uid()
            or public.vr_share_role(p.id, lower(coalesce(auth.jwt() ->> 'email', ''))) = 'edit')));

drop policy if exists vr_reqs_add on public.vr_reqs;
create policy vr_reqs_add on public.vr_reqs for insert to authenticated
  with check (user_id = auth.uid() and exists (
    select 1 from public.vr_projects p
     where p.id = project_id
       and (p.user_id = auth.uid()
            or public.vr_share_role(p.id, lower(coalesce(auth.jwt() ->> 'email', ''))) = 'edit')));

drop policy if exists vr_reqs_drop on public.vr_reqs;
create policy vr_reqs_drop on public.vr_reqs for delete to authenticated
  using (exists (
    select 1 from public.vr_projects p
     where p.id = project_id and p.user_id = auth.uid()));

drop policy if exists vr_terms_read on public.vr_terms;
create policy vr_terms_read on public.vr_terms for select to authenticated
  using (exists (
    select 1 from public.vr_projects p
     where p.id = project_id
       and (p.user_id = auth.uid()
            or public.vr_share_role(p.id, lower(coalesce(auth.jwt() ->> 'email', ''))) is not null)));

drop policy if exists vr_terms_write on public.vr_terms;
create policy vr_terms_write on public.vr_terms for update to authenticated
  using (exists (
    select 1 from public.vr_projects p
     where p.id = project_id
       and (p.user_id = auth.uid()
            or public.vr_share_role(p.id, lower(coalesce(auth.jwt() ->> 'email', ''))) = 'edit')));

drop policy if exists vr_terms_add on public.vr_terms;
create policy vr_terms_add on public.vr_terms for insert to authenticated
  with check (user_id = auth.uid() and exists (
    select 1 from public.vr_projects p
     where p.id = project_id
       and (p.user_id = auth.uid()
            or public.vr_share_role(p.id, lower(coalesce(auth.jwt() ->> 'email', ''))) = 'edit')));

drop policy if exists vr_terms_drop on public.vr_terms;
create policy vr_terms_drop on public.vr_terms for delete to authenticated
  using (exists (
    select 1 from public.vr_projects p
     where p.id = project_id and p.user_id = auth.uid()));

drop policy if exists vr_shares_own on public.vr_shares;
create policy vr_shares_own on public.vr_shares for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists vr_shares_mine on public.vr_shares;
create policy vr_shares_mine on public.vr_shares for select to authenticated
  using (email is not null and lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));

/* Text is shared; the shape of the document is not. RLS can say who may update
 * a row but not which columns, so the decision columns are guarded here: the
 * name, the strength, the kind, the status and the order move under the owner's
 * hand only. */
create or replace function public.vr_decisions_are_the_owners()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.vr_projects p
              where p.id = new.project_id and p.user_id = auth.uid()) then
    return new;
  end if;

  if tg_table_name = 'vr_projects' then
    if new.title is distinct from old.title then
      raise exception 'only the owner renames the document'
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  if new.ref is distinct from old.ref
     or new.kind is distinct from old.kind
     or new.strength is distinct from old.strength
     or new.status is distinct from old.status
     or new.pos is distinct from old.pos then
    raise exception 'only the owner changes the name, the strength, the kind or the order'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists vr_projects_owner_decides on public.vr_projects;
create trigger vr_projects_owner_decides before update on public.vr_projects
  for each row execute function public.vr_decisions_are_the_owners();

drop trigger if exists vr_reqs_owner_decides on public.vr_reqs;
create trigger vr_reqs_owner_decides before update on public.vr_reqs
  for each row execute function public.vr_decisions_are_the_owners();

/* ── the suite's shared body, one line per app ─────────────────────── */
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

  delete from auth.users where id = me;
end;
$$;

revoke all on function public.vpl_delete_my_account() from public, anon;
grant execute on function public.vpl_delete_my_account() to authenticated;

/* ── the prefix guard learns the new app ───────────────────────────── */
create or replace function public.vpl_prefix_check()
returns table (kind text, name text)
language sql stable security definer
set search_path = public, pg_catalog
as $$
  with allowed as (
    select unnest(array['vn_', 'vi_', 'vr_', 'va_', 'vg_', 'vpl_']) as p
  ),
  shared as (
    select unnest(array['touch_updated_at', 'rls_auto_enable']) as n
  ),
  tables as (
    select 'table'::text as kind, c.relname::text as name
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r'
  ),
  functions as (
    select 'function'::text as kind, p.proname::text as name
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
  ),
  triggers as (
    select 'trigger'::text as kind, t.tgname::text as name
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and not t.tgisinternal
  )
  select * from (
    select * from tables union all select * from functions union all select * from triggers
  ) o
   where not exists (select 1 from allowed a where o.name like a.p || '%')
     and not exists (select 1 from shared s where s.n = o.name)
   order by 1, 2;
$$;

revoke all on function public.vpl_prefix_check() from public, anon;
grant execute on function public.vpl_prefix_check() to authenticated;
