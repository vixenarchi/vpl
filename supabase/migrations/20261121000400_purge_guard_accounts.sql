-- the broom, one more prefix wider: the suite's own probes (vi-, guard-, dbg-)
-- and the plain suite names. Nothing here is reachable from an app; only the
-- project owner, through a migration.
create or replace function public.vn_purge_test_accounts()
returns integer
language plpgsql security definer
set search_path = public, auth
as $$
declare
  doomed uuid[];
begin
  select coalesce(array_agg(id), '{}') into doomed
    from auth.users
   where email ~ '^(own|view|edit|nos|del|pal|friend|dnd|tree|plain|fresh|schema|shot|prov|mode|vi|guard|dbg|probe|vpl-a|vpl-b|e2e)-?[0-9]{9,}@example\.com$'
      or email ~ '^miki[0-9]{9,}@vpl\.local$';

  if array_length(doomed, 1) is null then
    return 0;
  end if;

  delete from public.vn_shares
   where owner_id = any(doomed)
      or note_id in (select id from public.vn_notes where user_id = any(doomed));
  delete from public.vn_shares
   where lower(email) in (select lower(email) from auth.users where id = any(doomed));

  delete from public.vn_notes where user_id = any(doomed);
  delete from public.vi_ideas where user_id = any(doomed);
  delete from auth.users where id = any(doomed);

  return array_length(doomed, 1);
end;
$$;

revoke all on function public.vn_purge_test_accounts() from public, anon, authenticated;

select public.vn_purge_test_accounts() as removed;
