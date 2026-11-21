-- the guard's first catch: the update-stamp trigger still had its old name.
alter trigger notes_touch on public.vn_notes rename to vn_notes_touch;
