-- vpl · va — a person who may write text may not start a machine
--
-- `va_jobs_add` let anybody with the project's `edit` grant insert a row. A job
-- is not a paragraph: the worker hands its `task.md` to `pi`, and `pi` has
-- tools. So a guest who was trusted with words could write a sentence that made
-- a model run a command — the largest jump in trust in the whole suite, made by
-- a button that said "share for editing".
--
-- The line drawn here:
--   * only the owner of the desk hands work to an agent;
--   * inside a job folder, only `out/` may be written by whoever works the job —
--     `task.md` and `inputs/` are the owner's words;
--   * a job's own row may move forward by whoever works it, but its content
--     (template, note, project, submitter) is not theirs to rewrite.
--
-- An agent is still a colleague the person shared the job with: it claims and
-- finishes rows through the same `va_can_edit` it always used, and writes its
-- deliverable under `out/`. Nothing here needs a second permission system.
--
-- Re-runnable.

create or replace function public.va_is_owner(p_project uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.va_projects p
     where p.id = p_project
       and p.user_id = auth.uid()
  );
$$;

revoke all on function public.va_is_owner(uuid) from public, anon;
grant execute on function public.va_is_owner(uuid) to authenticated;

-- ── who may queue ────────────────────────────────────────────────────────
drop policy if exists va_jobs_add on public.va_jobs;
create policy va_jobs_add on public.va_jobs for insert to authenticated
  with check (user_id = (select auth.uid()) and public.va_is_owner(project_id));

comment on policy va_jobs_add on public.va_jobs is
  'Only the desk''s owner hands a job to an agent. An editor writes text; a job runs code.';

-- ── what may move, and what may not ──────────────────────────────────────
-- The agent still claims (`queued → running`) and finishes (`→ done|failed`),
-- which is an update under `va_can_edit`. What it must not do is rewrite the
-- words it is answering.
create or replace function public.va_jobs_guard()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() is null then return new; end if;          -- service role / worker with its own token
  if public.va_is_owner(old.project_id) then return new; end if;
  if new.project_id is distinct from old.project_id
     or new.user_id   is distinct from old.user_id
     or new.template  is distinct from old.template
     or new.note      is distinct from old.note
     or new.task      is distinct from old.task
     or new.path      is distinct from old.path
  then
    raise exception 'the work of a job belongs to the person who handed it over'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

drop trigger if exists va_jobs_guard on public.va_jobs;
create trigger va_jobs_guard before update on public.va_jobs
  for each row execute function public.va_jobs_guard();

-- ── a job folder: out/ is the worker's, the rest is the owner's ───────────
-- Permissive policies above say "anyone who can edit this project". These are
-- restrictive, so they narrow that rather than widen it: a path inside a job
-- folder is writable by an editor only under `out/`.
drop policy if exists va_files_job_task on storage.objects;
create policy va_files_job_task on storage.objects as restrictive
  for insert to authenticated
  with check (
    bucket_id <> 'va-files'
    or name !~ '/jobs/'
    or name ~ '/jobs/[^/]+/out/'
    or public.va_is_owner(public.va_path_project(name))
  );

drop policy if exists va_files_job_task_write on storage.objects;
create policy va_files_job_task_write on storage.objects as restrictive
  for update to authenticated
  using (
    bucket_id <> 'va-files'
    or name !~ '/jobs/'
    or name ~ '/jobs/[^/]+/out/'
    or public.va_is_owner(public.va_path_project(name))
  )
  with check (
    bucket_id <> 'va-files'
    or name !~ '/jobs/'
    or name ~ '/jobs/[^/]+/out/'
    or public.va_is_owner(public.va_path_project(name))
  );

drop policy if exists va_files_job_task_drop on storage.objects;
create policy va_files_job_task_drop on storage.objects as restrictive
  for delete to authenticated
  using (
    bucket_id <> 'va-files'
    or name !~ '/jobs/'
    or name ~ '/jobs/[^/]+/out/'
    or public.va_is_owner(public.va_path_project(name))
  );
