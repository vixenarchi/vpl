-- 0011 — the same cleanup, made repeatable.
--
-- 0009 removed the throwaway accounts that existed then. Test runs since have
-- added more, and future ones will add more again, so the body moves into a
-- function. It is not granted to anyone: only a migration (i.e. the project
-- owner) can call it. Adding a one-line migration that selects it is how a test
-- session is cleaned up from now on.

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
   where email ~ '^(own|view|edit|nos|del|pal|friend|dnd|tree|plain|fresh|schema|shot|vpl-a|vpl-b|e2e)-?[0-9]{9,}@example\.com$'
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

select public.purge_test_accounts();
