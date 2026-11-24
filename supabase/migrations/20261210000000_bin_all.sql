-- vpl · the recycle bin, in every app that has rows to lose.
--
-- vn has had a bin from the start: a note is never removed by content, only by
-- id, and a deleted note keeps its words until somebody says "for good". vz
-- got the same column with its first migration. The rest still hard-delete, so
-- a mis-pressed ✕ in vr, vi, vd, vc or va is final — which is the one thing the
-- suite must not do.
--
-- This adds the column and the index the bin reads, and nothing else: the rows
-- that exist now are all live (deleted_at is null), so nothing moves.
--
-- Re-runnable: every statement is if-not-exists.

alter table public.vi_ideas   add column if not exists deleted_at timestamptz;
alter table public.vr_reqs    add column if not exists deleted_at timestamptz;
alter table public.vd_outputs add column if not exists deleted_at timestamptz;
alter table public.vc_outputs add column if not exists deleted_at timestamptz;
alter table public.va_outputs add column if not exists deleted_at timestamptz;

-- The bin is a place you open, so it is a query: "this project, binned, newest
-- first". A partial index keeps it the size of the bin itself.
create index if not exists vi_ideas_bin_idx
  on public.vi_ideas (project_id, deleted_at desc) where deleted_at is not null;
create index if not exists vr_reqs_bin_idx
  on public.vr_reqs (project_id, deleted_at desc) where deleted_at is not null;
create index if not exists vd_outputs_bin_idx
  on public.vd_outputs (project_id, deleted_at desc) where deleted_at is not null;
create index if not exists vc_outputs_bin_idx
  on public.vc_outputs (project_id, deleted_at desc) where deleted_at is not null;
create index if not exists va_outputs_bin_idx
  on public.va_outputs (project_id, deleted_at desc) where deleted_at is not null;

-- The live lists are what every screen reads, and they now all carry
-- "deleted_at is null". vz taught the shape; the rest follow it.
create index if not exists vi_ideas_live_idx
  on public.vi_ideas (project_id, position) where deleted_at is null;
create index if not exists vr_reqs_live_idx
  on public.vr_reqs (project_id, pos) where deleted_at is null;
create index if not exists vd_outputs_live_idx
  on public.vd_outputs (project_id, updated_at desc) where deleted_at is null;
create index if not exists vc_outputs_live_idx
  on public.vc_outputs (project_id, updated_at desc) where deleted_at is null;
create index if not exists va_outputs_live_idx
  on public.va_outputs (project_id, updated_at desc) where deleted_at is null;

-- What the bin means, once, so nobody has to guess later: a row in the bin is
-- invisible to every list, cannot be edited, and can come back.
comment on column public.vi_ideas.deleted_at   is 'in the recycle bin; null = live';
comment on column public.vr_reqs.deleted_at    is 'in the recycle bin; null = live';
comment on column public.vd_outputs.deleted_at is 'in the recycle bin; null = live';
comment on column public.vc_outputs.deleted_at is 'in the recycle bin; null = live';
comment on column public.va_outputs.deleted_at is 'in the recycle bin; null = live';
