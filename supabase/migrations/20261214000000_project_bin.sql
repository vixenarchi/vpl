-- vpl · the job itself goes to the bin too
--
-- vd, vc and va had a bin for the inputs of a job and nothing for the job: the
-- ✕ in the rail asked "and everything in it?" and then did exactly that. A
-- mis-pressed ✕ on the one row that holds a whole document is the most
-- expensive click in the suite, and it was the only one with no way back.
--
-- The same column, the same shape as everywhere else: deleted_at is the bin,
-- null is live. Nothing moves — every existing row is live.
--
-- Re-runnable: every statement is if-not-exists.

alter table public.vd_projects add column if not exists deleted_at timestamptz;
alter table public.vc_projects add column if not exists deleted_at timestamptz;
alter table public.va_projects add column if not exists deleted_at timestamptz;

-- The rail reads live jobs on every repaint; the bin reads the other side.
create index if not exists vd_projects_live_idx
  on public.vd_projects (user_id, updated_at desc) where deleted_at is null;
create index if not exists vc_projects_live_idx
  on public.vc_projects (user_id, updated_at desc) where deleted_at is null;
create index if not exists va_projects_live_idx
  on public.va_projects (user_id, updated_at desc) where deleted_at is null;

create index if not exists vd_projects_bin_idx
  on public.vd_projects (user_id, deleted_at desc) where deleted_at is not null;
create index if not exists vc_projects_bin_idx
  on public.vc_projects (user_id, deleted_at desc) where deleted_at is not null;
create index if not exists va_projects_bin_idx
  on public.va_projects (user_id, deleted_at desc) where deleted_at is not null;

comment on column public.vd_projects.deleted_at is 'in the recycle bin; null = live';
comment on column public.vc_projects.deleted_at is 'in the recycle bin; null = live';
comment on column public.va_projects.deleted_at is 'in the recycle bin; null = live';
