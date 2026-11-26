-- vpl · a job in the va desk is the owner's, and the screen now agrees
--
-- `20261224000000` gave `va_jobs` the same insert rule as every other content
-- table — an editor may add a row — and `va-sec.mjs` caught it immediately: an
-- editor queued a job with a task of their own choosing ("ignore all previous
-- rules…") on somebody else's desk. That is VA-1, from 2026-12-07, and it is not
-- a document row: a job runs code.
--
-- So the insert policy goes back to the owner. The other half of the fix is on
-- the screen: `apps/va` no longer offers a guest a generate button that the
-- database would refuse, and says who starts a job instead.
--
-- Re-runnable.

begin;

drop policy if exists va_jobs_add on public.va_jobs;
create policy va_jobs_add on public.va_jobs for insert to authenticated
  with check (user_id = auth.uid()
              and exists (select 1 from public.va_projects p
                           where p.id = va_jobs.project_id
                             and p.user_id = auth.uid()));

commit;

-- rollback (not wanted: an editor queueing work on somebody else's desk)
