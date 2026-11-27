/* VA-2 — a finished job is a record.
 *
 * The finding: a colleague with `edit` on the job could rewrite `report`,
 * `status` and `files` of a job that had already finished. The person the report
 * was written *for* then reads a document nobody signed, and the run's own
 * evidence (which model, which inputs, how long) is gone with it.
 *
 * The rule, in one sentence: **once a job is done or failed, only its owner may
 * change it** — a colleague writes during the work, the owner decides what the
 * work says afterwards. Clearing the status back to `queued` is the owner's way
 * to open it again, so the freeze is never a dead end.
 *
 * RLS cannot say this: a `with check` policy sees the row it is writing, never
 * the one it is replacing. So it is a trigger, before update, where both are in
 * hand. The owner is read from the project, not from the row's own `owner_id`
 * claim, for the same reason `va_jobs` insert asks the project.
 */

create or replace function public.va_a_finished_job_is_a_record()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  mine boolean;
begin
  if old.status not in ('done', 'failed') then
    return new;
  end if;

  /* who is asking: the project's owner, or a colleague with edit */
  select p.user_id = auth.uid() into mine
    from public.va_projects p
   where p.id = new.project_id;

  if coalesce(mine, false) then
    return new;
  end if;

  /* a colleague may still rename or re-brief the job — those are words about the
   * work, not the work — but not the result, and not the state it ended in */
  if new.report is distinct from old.report
     or new.files is distinct from old.files
     or new.status is distinct from old.status
     or new.started_at is distinct from old.started_at
     or new.finished_at is distinct from old.finished_at then
    raise exception 'this job is finished: only its owner can change the report, the files or the status'
      using errcode = '42501',
            hint = 'ask the owner to open it again, or copy it to your own account';
  end if;

  return new;
end $$;

drop trigger if exists va_jobs_finished_is_a_record on public.va_jobs;
create trigger va_jobs_finished_is_a_record
  before update on public.va_jobs
  for each row execute function public.va_a_finished_job_is_a_record();

revoke all on function public.va_a_finished_job_is_a_record() from public, anon, authenticated;

/* the proof this migration is asked for, from the other side: a finished job
 * that a colleague tries to rewrite must be refused, and the same write by the
 * owner must go through. Both are in apps/vn/test/va-sec.mjs. */
