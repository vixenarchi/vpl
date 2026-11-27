-- 0009 — remove the throwaway accounts my own test runs created.
--
-- Not part of the product. The test suites sign up an account per run and, until
-- now, left it behind; the patterns below are the ones they use. Running this
-- again deletes nothing, so it is safe to keep in the lineage.
--
-- Deliberately narrow: every pattern is an address shape no person would pick
-- (a name plus a millisecond stamp on example.com or vpl.local). Real accounts,
-- including the owner's, cannot match any of them.

do $$
declare
  doomed uuid[];
begin
  select coalesce(array_agg(id), '{}') into doomed
    from auth.users
   where email ~ '^(own|view|edit|nos|del|pal|friend)-[0-9]{13}@example\.com$'
      or email ~ '^miki[0-9]{13}@vpl\.local$';

  if array_length(doomed, 1) is null then
    return;
  end if;

  -- grants they handed out or received
  delete from public.note_shares
   where owner_id = any(doomed)
      or note_id in (select id from public.notes where user_id = any(doomed));
  delete from public.note_shares
   where lower(email) in (select lower(email) from auth.users where id = any(doomed));

  delete from public.notes where user_id = any(doomed);
  delete from auth.users where id = any(doomed);
end;
$$;
