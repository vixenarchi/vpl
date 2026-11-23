-- The desk does not send its own id: the row knows who wrote it, because the
-- session is the only thing that can be trusted to say so.
alter table public.va_jobs alter column user_id set default auth.uid();

-- The same for the project rows' owner column on insert? No: those are created
-- by the app with an explicit user_id and have been since vd. Only the queue is
-- written by a button, and a button should not have to remember who pressed it.
