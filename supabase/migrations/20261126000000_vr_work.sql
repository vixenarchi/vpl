-- vr, second pass: the sheet becomes a place to work.
--
-- Three changes, all of them about a person with twenty rows in front of them
-- rather than a spreadsheet with two hundred and forty:
--
--   * themes are a tree (two levels), because a document is navigated by
--     opening a drawer, not by scanning a column;
--   * importance, status and kind are vocabularies per document, so a Croatian
--     tender can say P1..P4 and a school project can say must/optional/wish —
--     and anybody may add a word the document did not have;
--   * a change of importance or status leaves a line behind: who, what, and a
--     snapshot of the row as it stood. A log with no screen yet, on purpose.

/* ── themes: project → theme → subtheme, never deeper ─────────────── */
create table if not exists public.vr_themes (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.vr_projects (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  parent_id  uuid references public.vr_themes (id) on delete cascade,
  name       text not null,
  pos        integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists vr_themes_project_order on public.vr_themes (project_id, pos, name);
create index if not exists vr_themes_parent on public.vr_themes (parent_id);

create or replace function public.vr_themes_two_levels()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  parent  public.vr_themes%rowtype;
begin
  if new.parent_id is null then
    return new;
  end if;
  select * into parent from public.vr_themes where id = new.parent_id;
  if parent.id is null then
    raise exception 'a theme belongs under a theme of the same document'
      using errcode = 'foreign_key_violation';
  end if;
  if parent.parent_id is not null then
    raise exception 'two levels are enough: a subtheme cannot hold its own subthemes'
      using errcode = 'check_violation';
  end if;
  if parent.project_id <> new.project_id then
    raise exception 'a theme belongs under a theme of the same document'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
drop trigger if exists vr_themes_depth on public.vr_themes;
create trigger vr_themes_depth before insert or update on public.vr_themes
  for each row execute function public.vr_themes_two_levels();

/* ── vocabularies: importance, status, kind — words this document uses ── */
create table if not exists public.vr_vocab (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.vr_projects (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  axis       text not null check (axis in ('importance', 'status', 'kind')),
  value      text not null,
  color      text not null default 'grey',
  pos        integer not null default 0,
  created_at timestamptz not null default now()
);
create unique index if not exists vr_vocab_unique
  on public.vr_vocab (project_id, axis, lower(value));
create index if not exists vr_vocab_order on public.vr_vocab (project_id, axis, pos);

-- a project arrives with the words most projects use; the screen may add more
create or replace function public.vr_seed_vocab()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.vr_vocab (project_id, user_id, axis, value, color, pos) values
    (new.id, new.user_id, 'importance', 'must',     'red',   1),
    (new.id, new.user_id, 'importance', 'optional', 'amber', 2),
    (new.id, new.user_id, 'importance', 'wish',     'slate', 3),
    (new.id, new.user_id, 'status', 'draft',    'grey',  1),
    (new.id, new.user_id, 'status', 'agreed',   'blue',  2),
    (new.id, new.user_id, 'status', 'built',    'violet', 3),
    (new.id, new.user_id, 'status', 'verified', 'green', 4),
    (new.id, new.user_id, 'status', 'dropped',  'grey',  5),
    (new.id, new.user_id, 'kind', 'functional',    'grey', 1),
    (new.id, new.user_id, 'kind', 'nonfunctional', 'grey', 2),
    (new.id, new.user_id, 'kind', 'constraint',    'grey', 3),
    (new.id, new.user_id, 'kind', 'rule',          'grey', 4);
  return new;
end;
$$;
drop trigger if exists vr_projects_seed_vocab on public.vr_projects;
create trigger vr_projects_seed_vocab after insert on public.vr_projects
  for each row execute function public.vr_seed_vocab();

/* ── the rows: a theme to belong to, and no fixed lists ──────────── */
alter table public.vr_reqs drop constraint if exists vr_reqs_kind_check;
alter table public.vr_reqs drop constraint if exists vr_reqs_strength_check;
alter table public.vr_reqs drop constraint if exists vr_reqs_status_check;
alter table public.vr_reqs add column if not exists theme_id uuid
  references public.vr_themes (id) on delete set null;
alter table public.vr_reqs add column if not exists updated_by uuid;
create index if not exists vr_reqs_theme_id on public.vr_reqs (theme_id);

/* ── the log: a decision leaves a line behind ─────────────────────── */
create table if not exists public.vr_log (
  id          bigserial primary key,
  project_id  uuid not null references public.vr_projects (id) on delete cascade,
  req_id      uuid,
  actor_id    uuid,
  actor_email text not null default '',
  action      text not null default 'changed',
  field       text not null default '',
  before      jsonb,
  after       jsonb,
  snapshot    jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists vr_log_req on public.vr_log (req_id, created_at desc);
create index if not exists vr_log_project on public.vr_log (project_id, created_at desc);

create or replace function public.vr_log_row_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  who   uuid := auth.uid();
  mail  text := '';
  changed text[] := '{}';
  f     text;
  b     jsonb := '{}'::jsonb;
  a     jsonb := '{}'::jsonb;
begin
  if tg_op = 'INSERT' then
    insert into public.vr_log (project_id, req_id, actor_id, actor_email, action, field, after, snapshot)
    values (new.project_id, new.id, who, coalesce((select email from auth.users where id = who), ''),
            'added', 'row', to_jsonb(new), to_jsonb(new));
    return new;
  end if;

  foreach f in array array['ref', 'kind', 'strength', 'status', 'theme_id', 'title', 'statement',
                          'verification', 'pos'] loop
    if to_jsonb(new) -> f is distinct from to_jsonb(old) -> f then
      changed := changed || f;
      b := b || jsonb_build_object(f, to_jsonb(old) -> f);
      a := a || jsonb_build_object(f, to_jsonb(new) -> f);
    end if;
  end loop;

  if array_length(changed, 1) is null then
    return new;
  end if;

  insert into public.vr_log (project_id, req_id, actor_id, actor_email, action, field, before, after, snapshot)
  values (new.project_id, new.id, who, coalesce((select email from auth.users where id = who), ''),
          'changed', array_to_string(changed, ','), b, a, to_jsonb(new));
  return new;
end;
$$;
drop trigger if exists vr_reqs_log on public.vr_reqs;
create trigger vr_reqs_log after insert or update on public.vr_reqs
  for each row execute function public.vr_log_row_change();

/* ── sharing decides words, the owner decides strength ───────────── */
drop policy if exists vr_themes_read on public.vr_themes;
create policy vr_themes_read on public.vr_themes for select to authenticated
  using (user_id = auth.uid()
         or exists (select 1 from public.vr_shares s
                     where s.project_id = vr_themes.project_id
                       and (s.code is not null or lower(s.email) = lower(auth.jwt() ->> 'email'))));
drop policy if exists vr_themes_write on public.vr_themes;
create policy vr_themes_write on public.vr_themes for all to authenticated
  using (user_id = auth.uid()
         or public.vr_share_role(vr_themes.project_id, auth.jwt() ->> 'email') in ('edit', 'view'))
  with check (user_id = auth.uid()
              or public.vr_share_role(vr_themes.project_id, auth.jwt() ->> 'email') = 'edit');

drop policy if exists vr_vocab_read on public.vr_vocab;
create policy vr_vocab_read on public.vr_vocab for select to authenticated
  using (user_id = auth.uid()
         or exists (select 1 from public.vr_shares s
                     where s.project_id = vr_vocab.project_id
                       and (s.code is not null or lower(s.email) = lower(auth.jwt() ->> 'email'))));
drop policy if exists vr_vocab_write on public.vr_vocab;
create policy vr_vocab_write on public.vr_vocab for all to authenticated
  using (user_id = auth.uid()
         or public.vr_share_role(vr_vocab.project_id, auth.jwt() ->> 'email') = 'edit')
  with check (user_id = auth.uid()
              or public.vr_share_role(vr_vocab.project_id, auth.jwt() ->> 'email') = 'edit');

drop policy if exists vr_log_read on public.vr_log;
create policy vr_log_read on public.vr_log for select to authenticated
  using (exists (select 1 from public.vr_projects p
                  where p.id = vr_log.project_id and p.user_id = auth.uid())
         or public.vr_share_role(vr_log.project_id, auth.jwt() ->> 'email') in ('edit', 'view'));

/* status is progress, not a decision: an editor may move it, and the log says so */
create or replace function public.vr_decisions_are_the_owners()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_table_name = 'vr_projects' then
    if exists (select 1 from public.vr_projects p
                where p.id = new.id and p.user_id = auth.uid()) then
      return new;
    end if;
    if new.title is distinct from old.title then
      raise exception 'only the owner renames the document'
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  if exists (select 1 from public.vr_projects p
              where p.id = new.project_id and p.user_id = auth.uid()) then
    return new;
  end if;

  if new.ref is distinct from old.ref
     or new.kind is distinct from old.kind
     or new.strength is distinct from old.strength
     or new.pos is distinct from old.pos then
    raise exception 'only the owner changes the name, the strength, the kind or the order'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

/* ── the T-Com document: its two Excel levels become the tree ────── */
do $$
declare
  pid   uuid;
  owner uuid;
  r     record;
  tid   text;
  sid   uuid;
begin
  select id, user_id into pid, owner from public.vr_projects
   where title = 'T-Com CRM · zahtjevi v15 (2012)' limit 1;
  if pid is null then
    return;
  end if;

  for r in select distinct theme from public.vr_reqs
            where project_id = pid and theme <> '' order by theme loop
    insert into public.vr_themes (project_id, user_id, name, pos)
      values (pid, owner, r.theme, 0)
      on conflict do nothing;
    select id into sid from public.vr_themes
     where project_id = pid and parent_id is null and name = r.theme limit 1;
    update public.vr_reqs set theme_id = sid where project_id = pid and theme = r.theme;
  end loop;

  for r in select distinct theme, category from public.vr_reqs
            where project_id = pid and category <> '' order by theme, category loop
    select id into sid from public.vr_themes
     where project_id = pid and parent_id is null and name = r.theme limit 1;
    if sid is not null then
      insert into public.vr_themes (project_id, user_id, parent_id, name, pos)
        values (pid, owner, sid, r.category, 0);
      update public.vr_reqs set theme_id = (
        select id from public.vr_themes
         where project_id = pid and parent_id = sid and name = r.category limit 1)
       where project_id = pid and theme = r.theme and category = r.category;
    end if;
  end loop;
end;
$$;
