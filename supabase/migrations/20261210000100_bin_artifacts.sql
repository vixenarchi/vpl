-- vpl · the bin, part two: the inputs.
--
-- In vd, vc and va the thing a person deletes is not a document version, it is
-- an input — the pasted text, the worksheet, the pdf that turned into text.
-- Those live in *_artifacts, so that is the table with the bin.
--
-- Re-runnable.

alter table public.vd_artifacts add column if not exists deleted_at timestamptz;
alter table public.vc_artifacts add column if not exists deleted_at timestamptz;
alter table public.va_artifacts add column if not exists deleted_at timestamptz;

create index if not exists vd_artifacts_bin_idx
  on public.vd_artifacts (project_id, deleted_at desc) where deleted_at is not null;
create index if not exists vc_artifacts_bin_idx
  on public.vc_artifacts (project_id, deleted_at desc) where deleted_at is not null;
create index if not exists va_artifacts_bin_idx
  on public.va_artifacts (project_id, deleted_at desc) where deleted_at is not null;

comment on column public.vd_artifacts.deleted_at is 'in the recycle bin; null = live';
comment on column public.vc_artifacts.deleted_at is 'in the recycle bin; null = live';
comment on column public.va_artifacts.deleted_at is 'in the recycle bin; null = live';
