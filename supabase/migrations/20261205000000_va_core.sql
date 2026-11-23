-- va — architecture: a job, its pile, and what a model made of them.
--
-- The shape the generator apps share (vd, vc, va). One job is a
-- folder of input artifacts and a stack of outputs; a run is one transformation
-- with the exact prompt that produced it, so an answer can always be explained.
--
-- There is no metamodel here on purpose. An artifact is a kind, a title and some
-- text (plus a file when it came as one). If a template needs structure, that
-- structure is markdown inside `text`, not a schema in the database.

create table if not exists public.va_projects (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  title      text not null default 'untitled job',
  brief      text not null default '',
  template   text not null default 'offer',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.va_artifacts (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.va_projects (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  kind       text not null default 'text'
               check (kind in ('text', 'file', 'image', 'note')),
  title      text not null default '',
  text       text not null default '',
  file_path  text,
  file_name  text,
  file_size  bigint,
  file_mime  text,
  pos        integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists va_artifacts_project_order
  on public.va_artifacts (project_id, pos, created_at);

create table if not exists public.va_runs (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.va_projects (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  template   text not null default 'offer',
  model      text not null default '',
  notes      text not null default '',
  prompt     text not null default '',
  status     text not null default 'running'
               check (status in ('running', 'done', 'failed')),
  error      text not null default '',
  took_ms    integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists va_runs_project
  on public.va_runs (project_id, created_at desc);

create table if not exists public.va_outputs (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.va_projects (id) on delete cascade,
  run_id     uuid references public.va_runs (id) on delete set null,
  user_id    uuid not null references auth.users (id) on delete cascade,
  kind       text not null default 'doc' check (kind in ('doc', 'report', 'code')),
  title      text not null default '',
  body       text not null default '',
  pos        integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists va_outputs_project
  on public.va_outputs (project_id, created_at desc);

create table if not exists public.va_shares (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.va_projects (id) on delete cascade,
  owner_id   uuid not null references auth.users (id) on delete cascade,
  code       text,
  email      text,
  role       text not null default 'view' check (role in ('view', 'edit')),
  pending    boolean not null default true,
  created_at timestamptz not null default now(),
  constraint va_shares_one_target check (
    (code is not null and email is null) or (code is null and email is not null)),
  constraint va_shares_code_length check (code is null or length(code) >= 16)
);

create unique index if not exists va_shares_code_once
  on public.va_shares (code) where code is not null;
create unique index if not exists va_shares_person_once
  on public.va_shares (project_id, lower(email)) where email is not null;

drop trigger if exists va_projects_touch on public.va_projects;
create trigger va_projects_touch before update on public.va_projects
  for each row execute function public.touch_updated_at();

drop trigger if exists va_artifacts_touch on public.va_artifacts;
create trigger va_artifacts_touch before update on public.va_artifacts
  for each row execute function public.touch_updated_at();

drop trigger if exists va_outputs_touch on public.va_outputs;
create trigger va_outputs_touch before update on public.va_outputs
  for each row execute function public.touch_updated_at();

/* ── who may do what ────────────────────────────────────────────────── */
create or replace function public.va_share_role(project uuid, viewer_email text)
returns text
language sql stable security definer
set search_path = public
as $$
  select s.role
    from public.va_shares s
   where s.project_id = project
     and s.email is not null
     and lower(s.email) = lower(coalesce(viewer_email, ''))
     and s.pending = false
   limit 1;
$$;

revoke all on function public.va_share_role(uuid, text) from public, anon;
grant execute on function public.va_share_role(uuid, text) to authenticated;

/* A link is a read: the job, its inputs and its outputs, one time. Files are
 * named but not signed — a reader with the link sees that a file exists. */
create or replace function public.va_read_share(p_code text)
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  p public.va_projects;
begin
  select * into p from public.va_projects q
    join public.va_shares s on s.project_id = q.id
   where s.code = p_code and s.code is not null;
  if p.id is null then return null; end if;

  return jsonb_build_object(
    'project', jsonb_build_object(
      'id', p.id, 'title', p.title, 'brief', p.brief, 'template', p.template,
      'created_at', p.created_at, 'updated_at', p.updated_at),
    'artifacts', coalesce((select jsonb_agg(
        jsonb_build_object('id', a.id, 'kind', a.kind, 'title', a.title, 'text', a.text,
                           'file_name', a.file_name, 'file_size', a.file_size, 'pos', a.pos)
        order by a.pos, a.created_at) from public.va_artifacts a where a.project_id = p.id), '[]'::jsonb),
    'outputs', coalesce((select jsonb_agg(
        jsonb_build_object('id', o.id, 'kind', o.kind, 'title', o.title, 'body', o.body, 'pos', o.pos)
        order by o.created_at) from public.va_outputs o where o.project_id = p.id), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.va_read_share(text) from public;
grant execute on function public.va_read_share(text) to anon, authenticated;

/* ── row level security ─────────────────────────────────────────────── */
alter table public.va_projects  enable row level security;
alter table public.va_artifacts enable row level security;
alter table public.va_runs      enable row level security;
alter table public.va_outputs   enable row level security;
alter table public.va_shares    enable row level security;

drop policy if exists va_projects_read on public.va_projects;
create policy va_projects_read on public.va_projects for select to authenticated
  using (user_id = auth.uid()
         or public.va_share_role(id, lower(coalesce(auth.jwt() ->> 'email', ''))) is not null);

drop policy if exists va_projects_write on public.va_projects;
create policy va_projects_write on public.va_projects for update to authenticated
  using (user_id = auth.uid()
         or public.va_share_role(id, lower(coalesce(auth.jwt() ->> 'email', ''))) = 'edit')
  with check (user_id = auth.uid()
         or public.va_share_role(id, lower(coalesce(auth.jwt() ->> 'email', ''))) = 'edit');

drop policy if exists va_projects_make on public.va_projects;
create policy va_projects_make on public.va_projects for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists va_projects_drop on public.va_projects;
create policy va_projects_drop on public.va_projects for delete to authenticated
  using (user_id = auth.uid());

drop policy if exists va_artifacts_read on public.va_artifacts;
create policy va_artifacts_read on public.va_artifacts for select to authenticated
  using (exists (
    select 1 from public.va_projects p
     where p.id = project_id
       and (p.user_id = auth.uid()
            or public.va_share_role(p.id, lower(coalesce(auth.jwt() ->> 'email', ''))) is not null)));

drop policy if exists va_artifacts_write on public.va_artifacts;
create policy va_artifacts_write on public.va_artifacts for update to authenticated
  using (exists (
    select 1 from public.va_projects p
     where p.id = project_id
       and (p.user_id = auth.uid()
            or public.va_share_role(p.id, lower(coalesce(auth.jwt() ->> 'email', ''))) = 'edit')));

drop policy if exists va_artifacts_add on public.va_artifacts;
create policy va_artifacts_add on public.va_artifacts for insert to authenticated
  with check (user_id = auth.uid() and exists (
    select 1 from public.va_projects p
     where p.id = project_id
       and (p.user_id = auth.uid()
            or public.va_share_role(p.id, lower(coalesce(auth.jwt() ->> 'email', ''))) = 'edit')));

drop policy if exists va_artifacts_drop on public.va_artifacts;
create policy va_artifacts_drop on public.va_artifacts for delete to authenticated
  using (exists (
    select 1 from public.va_projects p
     where p.id = project_id
       and (p.user_id = auth.uid()
            or public.va_share_role(p.id, lower(coalesce(auth.jwt() ->> 'email', ''))) = 'edit')));

drop policy if exists va_runs_read on public.va_runs;
create policy va_runs_read on public.va_runs for select to authenticated
  using (exists (
    select 1 from public.va_projects p
     where p.id = project_id
       and (p.user_id = auth.uid()
            or public.va_share_role(p.id, lower(coalesce(auth.jwt() ->> 'email', ''))) is not null)));

drop policy if exists va_runs_add on public.va_runs;
create policy va_runs_add on public.va_runs for insert to authenticated
  with check (user_id = auth.uid() and exists (
    select 1 from public.va_projects p
     where p.id = project_id
       and (p.user_id = auth.uid()
            or public.va_share_role(p.id, lower(coalesce(auth.jwt() ->> 'email', ''))) = 'edit')));

drop policy if exists va_runs_write on public.va_runs;
create policy va_runs_write on public.va_runs for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists va_outputs_read on public.va_outputs;
create policy va_outputs_read on public.va_outputs for select to authenticated
  using (exists (
    select 1 from public.va_projects p
     where p.id = project_id
       and (p.user_id = auth.uid()
            or public.va_share_role(p.id, lower(coalesce(auth.jwt() ->> 'email', ''))) is not null)));

drop policy if exists va_outputs_write on public.va_outputs;
create policy va_outputs_write on public.va_outputs for update to authenticated
  using (exists (
    select 1 from public.va_projects p
     where p.id = project_id
       and (p.user_id = auth.uid()
            or public.va_share_role(p.id, lower(coalesce(auth.jwt() ->> 'email', ''))) = 'edit')));

drop policy if exists va_outputs_add on public.va_outputs;
create policy va_outputs_add on public.va_outputs for insert to authenticated
  with check (user_id = auth.uid() and exists (
    select 1 from public.va_projects p
     where p.id = project_id
       and (p.user_id = auth.uid()
            or public.va_share_role(p.id, lower(coalesce(auth.jwt() ->> 'email', ''))) = 'edit')));

drop policy if exists va_outputs_drop on public.va_outputs;
create policy va_outputs_drop on public.va_outputs for delete to authenticated
  using (exists (
    select 1 from public.va_projects p
     where p.id = project_id and p.user_id = auth.uid()));

drop policy if exists va_shares_own on public.va_shares;
create policy va_shares_own on public.va_shares for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists va_shares_mine on public.va_shares;
create policy va_shares_mine on public.va_shares for select to authenticated
  using (email is not null and lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));

/* Text and outputs are shared; the job's name and its template are not. */
create or replace function public.va_decisions_are_the_owners()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.va_projects p
              where p.id = new.id and p.user_id = auth.uid()) then
    return new;
  end if;
  if new.title is distinct from old.title or new.template is distinct from old.template then
    raise exception 'only the owner renames the job or changes its template'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists va_projects_owner_decides on public.va_projects;
create trigger va_projects_owner_decides before update on public.va_projects
  for each row execute function public.va_decisions_are_the_owners();

/* ── files: one bucket, the path names the job ─────────────────────── */
insert into storage.buckets (id, name, public, file_size_limit)
values ('va-files', 'va-files', false, 10485760)
on conflict (id) do update set file_size_limit = excluded.file_size_limit, public = false;

create or replace function public.va_can_read(p_project uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.va_projects p
     where p.id = p_project
       and (p.user_id = auth.uid()
            or public.va_share_role(p.id, lower(coalesce(auth.jwt() ->> 'email', ''))) is not null));
$$;

create or replace function public.va_can_edit(p_project uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.va_projects p
     where p.id = p_project
       and (p.user_id = auth.uid()
            or public.va_share_role(p.id, lower(coalesce(auth.jwt() ->> 'email', ''))) = 'edit'));
$$;

create or replace function public.va_path_project(object_name text)
returns uuid
language plpgsql stable
set search_path = public
as $$
begin
  return (split_part(object_name, '/', 1))::uuid;
exception when others then
  return null;
end;
$$;

revoke all on function public.va_can_read(uuid) from public, anon;
revoke all on function public.va_can_edit(uuid) from public, anon;
grant execute on function public.va_can_read(uuid) to authenticated;
grant execute on function public.va_can_edit(uuid) to authenticated;

drop policy if exists va_files_read on storage.objects;
create policy va_files_read on storage.objects for select to authenticated
  using (bucket_id = 'va-files' and public.va_can_read(public.va_path_project(name)));

drop policy if exists va_files_add on storage.objects;
create policy va_files_add on storage.objects for insert to authenticated
  with check (bucket_id = 'va-files' and public.va_can_edit(public.va_path_project(name)));

drop policy if exists va_files_write on storage.objects;
create policy va_files_write on storage.objects for update to authenticated
  using (bucket_id = 'va-files' and public.va_can_edit(public.va_path_project(name)));

drop policy if exists va_files_drop on storage.objects;
create policy va_files_drop on storage.objects for delete to authenticated
  using (bucket_id = 'va-files' and public.va_can_edit(public.va_path_project(name)));
