-- vz — the suite's last app: a project is a dictionary, a row is a key and a
-- value. Both are plain text; the key is the identity and the value is
-- whatever fits (a password, a setting, a JSON blob, a joke, a glossary entry).
--
-- Think of it as a poor man's Redis: GET project/key, and a project that can be
-- published as a read-only HTTP service on the same code that lets a person
-- read it.
--
-- Two switches belong to the owner and to the owner only:
--   hide_values  — the screen collapses values until a row is opened
--   published + publish_code — the project answers at /p/<code>
-- "Hidden" is a curtain, not a lock: the value is plain text in this table and
-- anybody holding a link can read it. That is said on the screen, once.

create table if not exists public.vz_projects (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  title        text not null default 'untitled',
  note         text not null default '',
  hide_values  boolean not null default true,
  published    boolean not null default false,
  publish_code text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint vz_projects_code_length check (publish_code is null or length(publish_code) >= 16)
);

create unique index if not exists vz_projects_code_once
  on public.vz_projects (publish_code) where publish_code is not null;

create table if not exists public.vz_pairs (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.vz_projects (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  key        text not null,
  value      text not null default '',
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vz_pairs_key_not_blank check (btrim(key) <> '')
);

-- A key is a name, and names in this suite ignore case: DB_HOST and db_host are
-- the same lookup, and the screen shows whichever spelling was used first.
-- Deleted rows keep their key so a restore never collides with a living one.
create unique index if not exists vz_pairs_key_once
  on public.vz_pairs (project_id, lower(key)) where deleted_at is null;
create index if not exists vz_pairs_project
  on public.vz_pairs (project_id, lower(key));
create index if not exists vz_pairs_bin
  on public.vz_pairs (project_id, deleted_at) where deleted_at is not null;

create table if not exists public.vz_shares (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.vz_projects (id) on delete cascade,
  owner_id   uuid not null references auth.users (id) on delete cascade,
  code       text,
  email      text,
  role       text not null default 'view' check (role in ('view', 'edit')),
  pending    boolean not null default true,
  created_at timestamptz not null default now(),
  constraint vz_shares_one_target check (
    (code is not null and email is null) or (code is null and email is not null)),
  constraint vz_shares_code_length check (code is null or length(code) >= 16)
);

create unique index if not exists vz_shares_code_once
  on public.vz_shares (code) where code is not null;
create unique index if not exists vz_shares_person_once
  on public.vz_shares (project_id, lower(email)) where email is not null;

drop trigger if exists vz_projects_touch on public.vz_projects;
create trigger vz_projects_touch before update on public.vz_projects
  for each row execute function public.touch_updated_at();

drop trigger if exists vz_pairs_touch on public.vz_pairs;
create trigger vz_pairs_touch before update on public.vz_pairs
  for each row execute function public.touch_updated_at();

/* ── who may do what ────────────────────────────────────────────────── */
create or replace function public.vz_share_role(project uuid, viewer_email text)
returns text
language sql stable security definer
set search_path = public
as $$
  select s.role
    from public.vz_shares s
   where s.project_id = project
     and s.email is not null
     and lower(s.email) = lower(coalesce(viewer_email, ''))
     and s.pending = false
   limit 1;
$$;

revoke all on function public.vz_share_role(uuid, text) from public, anon;
grant execute on function public.vz_share_role(uuid, text) to authenticated;

/* A code is a read, not a grant: it returns the project and the keys, and goes
 * away. The bin stays home either way. */
create or replace function public.vz_read_share(p_code text)
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  p public.vz_projects;
begin
  select * into p from public.vz_projects q
    join public.vz_shares s on s.project_id = q.id
   where s.code = p_code and s.code is not null;
  if p.id is null then return null; end if;

  return jsonb_build_object(
    'project', jsonb_build_object(
      'id', p.id, 'title', p.title, 'note', p.note, 'hide_values', p.hide_values,
      'published', p.published, 'created_at', p.created_at, 'updated_at', p.updated_at),
    'pairs', coalesce((select jsonb_agg(
                          jsonb_build_object('id', x.id, 'key', x.key, 'value', x.value,
                                             'created_at', x.created_at, 'updated_at', x.updated_at)
                          order by lower(x.key))
                        from public.vz_pairs x
                       where x.project_id = p.id and x.deleted_at is null), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.vz_read_share(text) from public;
grant execute on function public.vz_read_share(text) to anon, authenticated;

/* The published project, as a machine reads it: no key asked → the whole map,
 * one key asked → that value. Unknown code or an unpublished project → null,
 * so the caller cannot tell "no such code" from "not published". */
create or replace function public.vz_read_public(p_code text, p_key text default null)
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  p public.vz_projects;
  v text;
begin
  select * into p from public.vz_projects q
   where q.published = true and q.publish_code = p_code;
  if p.id is null then return null; end if;

  if p_key is null or btrim(p_key) = '' then
    return jsonb_build_object(
      'title', p.title,
      'keys', coalesce((select jsonb_object_agg(x.key, x.value order by lower(x.key))
                          from public.vz_pairs x
                         where x.project_id = p.id and x.deleted_at is null), '{}'::jsonb));
  end if;

  select x.value into v
    from public.vz_pairs x
   where x.project_id = p.id and x.deleted_at is null and lower(x.key) = lower(p_key);
  if v is null then
    return jsonb_build_object('title', p.title, 'key', p_key, 'found', false);
  end if;
  return jsonb_build_object('title', p.title, 'key', p_key, 'found', true, 'value', v);
end;
$$;

revoke all on function public.vz_read_public(text, text) from public;
grant execute on function public.vz_read_public(text, text) to anon, authenticated;

/* ── row level security ─────────────────────────────────────────────── */
alter table public.vz_projects enable row level security;
alter table public.vz_pairs    enable row level security;
alter table public.vz_shares   enable row level security;

drop policy if exists vz_projects_read on public.vz_projects;
create policy vz_projects_read on public.vz_projects for select to authenticated
  using (user_id = auth.uid()
         or public.vz_share_role(id, lower(coalesce(auth.jwt() ->> 'email', ''))) is not null);

drop policy if exists vz_projects_write on public.vz_projects;
create policy vz_projects_write on public.vz_projects for update to authenticated
  using (user_id = auth.uid()
         or public.vz_share_role(id, lower(coalesce(auth.jwt() ->> 'email', ''))) = 'edit')
  with check (user_id = auth.uid()
         or public.vz_share_role(id, lower(coalesce(auth.jwt() ->> 'email', ''))) = 'edit');

drop policy if exists vz_projects_make on public.vz_projects;
create policy vz_projects_make on public.vz_projects for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists vz_projects_drop on public.vz_projects;
create policy vz_projects_drop on public.vz_projects for delete to authenticated
  using (user_id = auth.uid());

drop policy if exists vz_pairs_read on public.vz_pairs;
create policy vz_pairs_read on public.vz_pairs for select to authenticated
  using (exists (
    select 1 from public.vz_projects p
     where p.id = project_id
       and (p.user_id = auth.uid()
            or public.vz_share_role(p.id, lower(coalesce(auth.jwt() ->> 'email', ''))) is not null)));

drop policy if exists vz_pairs_write on public.vz_pairs;
create policy vz_pairs_write on public.vz_pairs for update to authenticated
  using (exists (
    select 1 from public.vz_projects p
     where p.id = project_id
       and (p.user_id = auth.uid()
            or public.vz_share_role(p.id, lower(coalesce(auth.jwt() ->> 'email', ''))) = 'edit')))
  with check (exists (
    select 1 from public.vz_projects p
     where p.id = project_id
       and (p.user_id = auth.uid()
            or public.vz_share_role(p.id, lower(coalesce(auth.jwt() ->> 'email', ''))) = 'edit')));

drop policy if exists vz_pairs_add on public.vz_pairs;
create policy vz_pairs_add on public.vz_pairs for insert to authenticated
  with check (user_id = auth.uid() and exists (
    select 1 from public.vz_projects p
     where p.id = project_id
       and (p.user_id = auth.uid()
            or public.vz_share_role(p.id, lower(coalesce(auth.jwt() ->> 'email', ''))) = 'edit')));

/* A row leaves the sheet by being marked, so anybody who may write may put it
 * in the bin. Emptying the bin for good is the owner's, and so is every
 * decision about the project itself. */
drop policy if exists vz_pairs_drop on public.vz_pairs;
create policy vz_pairs_drop on public.vz_pairs for delete to authenticated
  using (exists (
    select 1 from public.vz_projects p
     where p.id = project_id and p.user_id = auth.uid()));

drop policy if exists vz_shares_own on public.vz_shares;
create policy vz_shares_own on public.vz_shares for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists vz_shares_mine on public.vz_shares;
create policy vz_shares_mine on public.vz_shares for select to authenticated
  using (email is not null and lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));

create or replace function public.vz_decisions_are_the_owners()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.vz_projects p
              where p.id = new.id and p.user_id = auth.uid()) then
    return new;
  end if;

  if new.title is distinct from old.title
     or new.hide_values is distinct from old.hide_values
     or new.published is distinct from old.published
     or new.publish_code is distinct from old.publish_code then
    raise exception 'only the owner renames the project, hides its values or publishes it'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists vz_projects_owner_decides on public.vz_projects;
create trigger vz_projects_owner_decides before update on public.vz_projects
  for each row execute function public.vz_decisions_are_the_owners();

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

  -- vz (keys and shares fall with their project)
  delete from public.vz_shares where owner_id = me;
  delete from public.vz_shares
   where lower(email) = lower(coalesce((select u.email from auth.users u where u.id = me), ''));
  delete from public.vz_projects where user_id = me;

  delete from auth.users where id = me;
end;
$$;

revoke all on function public.vpl_delete_my_account() from public, anon;
grant execute on function public.vpl_delete_my_account() to authenticated;

/* ── the prefix guard learns the last app ──────────────────────────── */
create or replace function public.vpl_prefix_check()
returns table (kind text, name text)
language sql stable security definer
set search_path = public, pg_catalog
as $$
  with allowed as (
    select unnest(array['vn_', 'vi_', 'vr_', 'vz_', 'va_', 'vg_', 'vpl_']) as p
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
