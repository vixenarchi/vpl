-- 0017 — a wider broom for throwaway accounts.
--
-- The suites make an account per run and delete it at the end, but a run that
-- fails before the cleanup leaves one behind. 0011 knew nine prefixes; there
-- are a few more now (prov-, mode-, and the accounts whose name looks like an
-- address on vpl.local). Same shape, one more regex, and it stays uncallable
-- from the app: only the project owner, through a migration.

create or replace function public.purge_test_accounts()
returns integer
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  doomed uuid[];
begin
  select coalesce(array_agg(id), '{}') into doomed
    from auth.users
   where email ~ '^(own|view|edit|nos|del|pal|friend|dnd|tree|plain|fresh|schema|shot|prov|mode|vpl-a|vpl-b|e2e)-?[0-9]{9,}@example\.com$'
      or email ~ '^miki[0-9]{9,}@vpl\.local$';

  if array_length(doomed, 1) is null then
    return 0;
  end if;

  delete from public.note_shares
   where owner_id = any(doomed)
      or note_id in (select id from public.notes where user_id = any(doomed));
  delete from public.note_shares
   where lower(email) in (select lower(email) from auth.users where id = any(doomed));

  delete from public.notes where user_id = any(doomed);
  delete from auth.users where id = any(doomed);

  return array_length(doomed, 1);
end;
$$;

revoke all on function public.purge_test_accounts() from public, anon, authenticated;

select public.purge_test_accounts() as removed;
