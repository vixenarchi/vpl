/* The VA-2 trigger named a column that does not exist.
 *
 * `va_jobs` carries `started_at` and no `finished_at`, so the first version of
 * va_a_finished_job_is_a_record() would have raised "record new has no field
 * finished_at" the moment it reached that test — a freeze that fails open, which
 * is worse than no freeze: it would have looked like it worked.
 *
 * The function is rewritten without it. What is frozen stays the same: report,
 * files, status and the run's own start time.
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

  select p.user_id = auth.uid() into mine
    from public.va_projects p
   where p.id = new.project_id;

  if coalesce(mine, false) then
    return new;
  end if;

  if new.report     is distinct from old.report
     or new.files    is distinct from old.files
     or new.status   is distinct from old.status
     or new.started_at is distinct from old.started_at then
    raise exception 'this job is finished: only its owner can change the report, the files or the status'
      using errcode = '42501',
            hint = 'ask the owner to open it again, or copy it to your own account';
  end if;

  return new;
end $$;

revoke all on function public.va_a_finished_job_is_a_record() from public, anon, authenticated;
