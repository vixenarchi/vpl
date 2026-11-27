-- vpl day 3: the tree.
--
-- One table still. A note is now a node: it may sit under another note
-- (parent_id), it has an order among its siblings (position), and it has a
-- kind — an ordinary paper or a funnel. A funnel stores its stages in jsonb,
-- so stages are data, not code, and a seven-year-old can add a fourth one.
--
-- `stage` keeps one job: membership in a funnel's stage list, by stage id.
-- `position` orders siblings and is only meaningful within one parent.

alter table public.notes
  add column if not exists kind     text not null default 'paper'
    check (kind in ('paper', 'funnel'));

alter table public.notes
  add column if not exists position integer not null default 0;

-- Stages of a funnel: [{ id, name, color }]. Null for papers.
alter table public.notes
  add column if not exists stages   jsonb;

-- Stable ordering of siblings under one parent.
create index if not exists notes_user_parent_pos_idx
  on public.notes (user_id, parent_id, position);

-- A funnel's stage list defaults to three, which is the method, not a law.
comment on column public.notes.stages is
  'Only for kind=funnel: [{id,name,color}]. Stages are data, the user may add or remove them.';

comment on column public.notes.stage is
  'Only for kind=paper: the funnel stage id it was dropped into, or null.';
