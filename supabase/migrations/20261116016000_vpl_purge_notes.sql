-- v2.14 — the recycle bin can be emptied.
--
-- Until now a note was only ever *binned*: deleted_at was set and the row
-- stayed forever. That is right for undo, and wrong for a bin: a place that can
-- never be emptied is not a bin, it is a pile that grows for the life of the
-- account.
--
-- So the owner may now delete a row — but only a row that is already binned.
-- "delete" in the app stays a soft, undoable gesture; permanent removal is a
-- second, deliberate act on something already set aside. A live note cannot be
-- dropped in one step even by its owner, which is what the confirmation in the
-- app is for.
--
-- Children do not follow: parent_id is `on delete set null`, so a purged note's
-- sub-notes move up to the top level rather than disappearing with it. The
-- dialog says so.
--
-- Re-runnable.

grant delete on table public.notes to authenticated;

drop policy if exists notes_owner_purges on public.notes;
create policy notes_owner_purges on public.notes
  for delete to authenticated
  using (user_id = auth.uid() and deleted_at is not null);

comment on policy notes_owner_purges on public.notes is
  'a binned note may be deleted for good, by its owner only';
