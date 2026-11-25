-- vc — a batch is a queue of independent targets, not fifty clicks.
--
-- Fifty offers of 200 pages, or a job ad and a pile of CVs: the same verdict
-- grammar (PASS / FAIL / UNKNOWN per criterion), but one report per candidate
-- and a list you can sort by how many checks each one failed.
--
-- The counts live on the row (n_pass / n_fail / n_unknown) so the list sorts
-- without parsing a document. status is a queue position, and `running` is only
-- ever true while a person is looking at the screen: nothing here runs on its
-- own, and a reload turns a `running` row back into `queued`.
--
-- deleted_at, because ✕ never destroys in this suite: a candidate and their
-- report can be put aside and taken back.
--
-- No scheduler, no cron, no workers: the queue moves because a person pressed a
-- button, and stops when they leave.

create table if not exists public.vc_targets (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.vc_projects (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  name       text not null default '',
  status     text not null default 'queued'
               check (status in ('queued', 'running', 'done', 'failed')),
  error      text not null default '',
  n_pass     integer not null default 0,
  n_fail     integer not null default 0,
  n_unknown  integer not null default 0,
  pos        integer not null default 0,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists vc_targets_project_order
  on public.vc_targets (project_id, pos, created_at);

create index if not exists vc_targets_live
  on public.vc_targets (project_id, pos) where deleted_at is null;

/* An artifact, a run and an output can belong to one target. Null means the
 * check itself — the single pile every check had before batches existed. */
alter table public.vc_artifacts
  add column if not exists target_id uuid references public.vc_targets (id) on delete cascade;
alter table public.vc_runs
  add column if not exists target_id uuid references public.vc_targets (id) on delete set null;
alter table public.vc_outputs
  add column if not exists target_id uuid references public.vc_targets (id) on delete cascade;

create index if not exists vc_artifacts_target on public.vc_artifacts (target_id);
create index if not exists vc_outputs_target on public.vc_outputs (target_id);

drop trigger if exists vc_targets_touch on public.vc_targets;
create trigger vc_targets_touch before update on public.vc_targets
  for each row execute function public.touch_updated_at();

/* ── who may do what: the same questions as the rest of a check ────── */
alter table public.vc_targets enable row level security;

drop policy if exists vc_targets_read on public.vc_targets;
create policy vc_targets_read on public.vc_targets for select to authenticated
  using (exists (
    select 1 from public.vc_projects p
     where p.id = project_id
       and (p.user_id = auth.uid()
            or public.vc_share_role(p.id, lower(coalesce(auth.jwt() ->> 'email', ''))) is not null)));

drop policy if exists vc_targets_add on public.vc_targets;
create policy vc_targets_add on public.vc_targets for insert to authenticated
  with check (user_id = auth.uid() and exists (
    select 1 from public.vc_projects p
     where p.id = project_id
       and (p.user_id = auth.uid()
            or public.vc_share_role(p.id, lower(coalesce(auth.jwt() ->> 'email', ''))) = 'edit')));

drop policy if exists vc_targets_write on public.vc_targets;
create policy vc_targets_write on public.vc_targets for update to authenticated
  using (exists (
    select 1 from public.vc_projects p
     where p.id = project_id
       and (p.user_id = auth.uid()
            or public.vc_share_role(p.id, lower(coalesce(auth.jwt() ->> 'email', ''))) = 'edit')));

drop policy if exists vc_targets_drop on public.vc_targets;
create policy vc_targets_drop on public.vc_targets for delete to authenticated
  using (exists (
    select 1 from public.vc_projects p
     where p.id = project_id
       and (p.user_id = auth.uid()
            or public.vc_share_role(p.id, lower(coalesce(auth.jwt() ->> 'email', ''))) = 'edit')));

/* A shared check shows the targets, and never the binned ones — "removed" has
 * to mean one thing to the owner and to the guest. */
create or replace function public.vc_read_share(p_code text)
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  p public.vc_projects;
begin
  select * into p from public.vc_projects q
    join public.vc_shares s on s.project_id = q.id
   where s.code = p_code and s.code is not null;
  if p.id is null then return null; end if;

  return jsonb_build_object(
    'project', jsonb_build_object(
      'id', p.id, 'title', p.title, 'brief', p.brief, 'template', p.template,
      'created_at', p.created_at, 'updated_at', p.updated_at),
    'targets', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', t.id, 'name', t.name, 'status', t.status,
          'n_pass', t.n_pass, 'n_fail', t.n_fail, 'n_unknown', t.n_unknown, 'pos', t.pos)
        order by t.pos, t.created_at)
        from public.vc_targets t
       where t.project_id = p.id and t.deleted_at is null
    ), '[]'::jsonb),
    'artifacts', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', a.id, 'kind', a.kind, 'title', a.title, 'text', a.text,
          'file_name', a.file_name, 'file_size', a.file_size,
          'pos', a.pos, 'target_id', a.target_id)
        order by a.pos, a.created_at)
        from public.vc_artifacts a
       where a.project_id = p.id and a.deleted_at is null
         and (a.target_id is null or exists (
           select 1 from public.vc_targets t where t.id = a.target_id and t.deleted_at is null))
    ), '[]'::jsonb),
    'outputs', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', o.id, 'kind', o.kind, 'title', o.title, 'body', o.body,
          'pos', o.pos, 'target_id', o.target_id)
        order by o.created_at)
        from public.vc_outputs o
       where o.project_id = p.id and o.deleted_at is null
         and (o.target_id is null or exists (
           select 1 from public.vc_targets t where t.id = o.target_id and t.deleted_at is null))
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.vc_read_share(text) from public;
grant execute on function public.vc_read_share(text) to anon, authenticated;

comment on table public.vc_targets is
  'One row per candidate/offer in a batch. status is a queue position, counts are stored so the list sorts without parsing a report.';
comment on column public.vc_artifacts.target_id is
  'Which target this input belongs to. Null is the check itself (rules, shared evidence).';
