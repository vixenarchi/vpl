-- Fix: user_id default must not allow NULL through RLS.
-- With email confirmation on, a freshly registered user has no session yet,
-- so auth.uid() is NULL and the policy check fails. Make it a hard error
-- instead of a silent RLS violation, and require an authenticated insert.
alter table public.notes alter column user_id drop default;
alter table public.notes alter column user_id set not null;

-- Explicit: only authenticated users may insert, and they must own the row.
drop policy if exists "own all" on public.notes;
create policy "own all" on public.notes
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
