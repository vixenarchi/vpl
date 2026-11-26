-- vpl · a job is worked by a colleague, which is what `edit` already means
--
-- `20261224000000` rewrote the write side of every content table to one shape,
-- and `va_jobs` was the one table where the shape did not fit: an agent claims a
-- job (`queued → running`) and finishes it through the `edit` grant it was given,
-- exactly as `20261206` says. My first correction (`…000300`) put the insert
-- back where it belonged but also narrowed the update to "its own row or the
-- owner's project", which locked the worker out: `va-handoff.mjs` caught it — the
-- job was handed over and never claimed.
--
-- So: the update policy goes back to `va_can_edit`, which is what a share means
-- here, and `va_jobs_guard` (20261217) stays the thing that stops an editor from
-- rewriting the words it is answering. The insert stays owner-only, because
-- queueing work on somebody's desk is not writing text.
--
-- Re-runnable.

begin;

drop policy if exists va_jobs_write on public.va_jobs;
create policy va_jobs_write on public.va_jobs for update to authenticated
  using (public.va_can_edit(project_id))
  with check (public.va_can_edit(project_id));

comment on policy va_jobs_write on public.va_jobs is
  'An agent claims and finishes a job it was shared; va_jobs_guard stops it rewriting the work.';

commit;

-- rollback (not wanted: the worker would stop being able to take a job)
