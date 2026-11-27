-- 0016 — leftovers that no longer have a reader.
--
-- The diagram pane was taken out of the notes app, and a table stayed behind:
-- public.diagrams, with a policy and grants, reachable by any signed-in person
-- and used by nothing. The notes table also kept a policy that published every
-- row with is_public = true to anonymous readers — a door that predates links
-- being capabilities. Links are read through read_share() now, so the door is
-- closed rather than left ajar.
--
-- The is_public column stays: it is in the specification, and dropping a column
-- to save nothing is churn.

drop policy if exists "public read" on public.notes;

drop policy if exists "own diagrams" on public.diagrams;
drop table if exists public.diagrams;
