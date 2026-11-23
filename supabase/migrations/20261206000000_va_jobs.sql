-- va · the queue: one row per hand-off to an agent.
--
-- The desk writes a job, an agent picks it up, the desk shows what came back.
-- The row is the state machine and nothing more: there is no scheduler, no
-- worker registry, no retry policy. A job that is `running` and whose agent died
-- is simply a job a person can re-queue with a sentence.
--
-- Who may touch a job is decided by the project it belongs to, with the same
-- `va_can_edit` that governs the bucket — so an agent is a colleague the person
-- shared the job with, not a special kind of account.

create table if not exists public.va_jobs (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.va_projects(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  template   text not null default 'context',
  task       text not null default '',
  note       text not null default '',
  path       text not null default '',
  status     text not null default 'queued'
             check (status in ('queued', 'running', 'done', 'failed')),
  report     text not null default '',
  files      jsonb not null default '[]'::jsonb,
  error      text not null default '',
  created_at timestamptz not null default now(),
  started_at timestamptz,
  done_at    timestamptz
);

create index if not exists va_jobs_project on public.va_jobs (project_id, created_at desc);
create index if not exists va_jobs_queue on public.va_jobs (status, created_at);

alter table public.va_jobs enable row level security;

drop policy if exists va_jobs_read on public.va_jobs;
create policy va_jobs_read on public.va_jobs for select to authenticated
  using (public.va_can_read(project_id));

drop policy if exists va_jobs_add on public.va_jobs;
create policy va_jobs_add on public.va_jobs for insert to authenticated
  with check (user_id = (select auth.uid()) and public.va_can_edit(project_id));

/* An agent claims a job (queued → running) and finishes it; the desk may
 * re-queue a stuck one. Anybody who can edit the project may do both. */
drop policy if exists va_jobs_write on public.va_jobs;
create policy va_jobs_write on public.va_jobs for update to authenticated
  using (public.va_can_edit(project_id))
  with check (public.va_can_edit(project_id));

drop policy if exists va_jobs_drop on public.va_jobs;
create policy va_jobs_drop on public.va_jobs for delete to authenticated
  using (project_id in (select id from public.va_projects where user_id = (select auth.uid())));

-- Deleting an account takes its jobs with it: the project is deleted below,
-- but a job on somebody else's project is still this person's row.
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

  -- va (the pile, the answers, the shares and the jobs fall with their job)
  delete from public.va_jobs where user_id = me;
  delete from public.va_shares where owner_id = me;
  delete from public.va_shares
   where lower(email) = lower(coalesce((select u.email from auth.users u where u.id = me), ''));
  delete from public.va_projects where user_id = me;

  -- keys and codes, both as issuer and as holder (charges fall with the key)
  delete from public.vp_keys where owner_id = me or holder_id = me;
  delete from public.vp_codes where owner_id = me;

  delete from public.vpl_ai where user_id = me;

  delete from auth.users where id = me;
end;
$$;

revoke all on function public.vpl_delete_my_account() from public, anon;
grant execute on function public.vpl_delete_my_account() to authenticated;
