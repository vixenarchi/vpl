-- Stages are data now.
--
-- The first migration pinned `stage` to a fixed list (none/inbox/explore/build),
-- which was right while there were exactly three stages and wrong the moment a
-- funnel could own its own stage list. A funnel stores stage ids in `stages`,
-- and a paper's `stage` points at one of those ids — a uuid, not an enum.
--
-- So the check goes. Nothing replaces it: referential integrity lives in the
-- funnel's jsonb, and enforcing it in SQL would mean a second table, which is
-- the thing this design refuses to add.
alter table public.notes drop constraint if exists notes_stage_check;

-- The old partial index filtered on stage <> 'none'; stage is now an id.
drop index if exists public.notes_stage_idx;
create index if not exists notes_stage_idx
  on public.notes (user_id, stage)
  where stage is not null;

comment on column public.notes.stage is
  'A stage id from the owning funnel''s stages jsonb. Null for a paper not in a funnel.';
