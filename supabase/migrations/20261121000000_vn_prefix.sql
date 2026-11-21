-- vpl · vn — give the notes app its own namespace.
--
-- vpl is a suite: vn.terg.hr, vi.terg.hr, va.terg.hr … one Supabase project,
-- one signed-in person, but each app owns its tables, functions and triggers.
-- Nothing is shared by accident because everything carries the app's prefix.
--
-- Renames only: data, columns, policies’ bodies and grants stay as they are.
-- Rollback at the bottom of the file.

begin;

-- ── tables ───────────────────────────────────────────────────────────────
alter table public.notes       rename to vn_notes;
alter table public.note_shares rename to vn_shares;

-- ── triggers ─────────────────────────────────────────────────────────────
alter trigger note_shares_code         on public.vn_shares rename to vn_shares_code;
alter trigger note_shares_known_target on public.vn_shares rename to vn_shares_known_target;
alter trigger notes_only_owner_bins    on public.vn_notes  rename to vn_notes_only_owner_bins;

-- ── trigger functions ────────────────────────────────────────────────────
alter function public.note_shares_mint_code()     rename to vn_shares_mint_code;
alter function public.note_shares_known_target()  rename to vn_shares_known_target;
alter function public.notes_only_owner_bins()     rename to vn_notes_only_owner_bins;

-- `touch_updated_at` stays unprefixed on purpose: it is a one-line utility
-- that touches nothing app-specific, and the next app will want it too.

-- ── query functions: names first, then bodies that name the tables ───────
alter function public.share_role(uuid, text)      rename to vn_share_role;
alter function public.read_share(text)            rename to vn_read_share;
alter function public.account_exists(text)        rename to vn_account_exists;
alter function public.account_hint(text)          rename to vn_account_hint;
alter function public.delete_my_account()         rename to vn_delete_my_account;
alter function public.purge_test_accounts()       rename to vn_purge_test_accounts;

create or replace function public.vn_share_role(note uuid, viewer_email text)
returns text
language sql stable security definer
set search_path = public
as $$
  with recursive up as (
    select n.id, n.parent_id, 0 as depth
      from public.vn_notes n
     where n.id = note
    union all
    select p.id, p.parent_id, up.depth + 1
      from public.vn_notes p
      join up on p.id = up.parent_id
     where up.depth < 64
  )
  select s.role
    from up
    join public.vn_shares s on s.note_id = up.id
   where viewer_email is not null
     and s.email is not null
     and lower(s.email) = lower(viewer_email)
   order by up.depth,
            (s.role = 'edit') desc
   limit 1;
$$;

comment on function public.vn_share_role(uuid, text) is
  'Nearest personal grant covering this note or an ancestor. A public code is not a grant; it is read through vn_read_share().';

create or replace function public.vn_read_share(p_code text)
returns table (id uuid, title text, body text, parent_id uuid, "position" integer, updated_at timestamptz)
language sql stable security definer
set search_path = public
as $$
  with recursive tree as (
    select n.id, n.title, n.body, n.parent_id, n."position", n.updated_at, 0 as depth
      from public.vn_notes n
      join public.vn_shares s on s.note_id = n.id
     where s.code = p_code
       and s.code is not null
       and n.deleted_at is null
    union all
    select c.id, c.title, c.body, c.parent_id, c."position", c.updated_at, t.depth + 1
      from public.vn_notes c
      join tree t on c.parent_id = t.id
     where c.deleted_at is null
       and t.depth < 64
  )
  select t.id, t.title, t.body, t.parent_id, t."position", t.updated_at
    from tree t
   order by t.depth, t."position", t.id;
$$;

comment on function public.vn_read_share(text) is
  'The rows behind one public code. Handed the code, so no account and no listing.';

create or replace function public.vn_account_exists(who text)
returns boolean
language sql stable security definer
set search_path = public, auth
as $$
  select exists (
    select 1 from auth.users u where lower(u.email) = lower(btrim(who))
  );
$$;

create or replace function public.vn_account_hint(who text)
returns table (found boolean, name text, made timestamptz)
language sql stable security definer
set search_path = public, auth
as $$
  select true, coalesce(u.raw_user_meta_data->>'full_name', ''), u.created_at
    from auth.users u
   where lower(u.email) = lower(btrim(who))
   limit 1;
$$;

create or replace function public.vn_delete_my_account()
returns void
language plpgsql security definer
set search_path = public, auth
as $$
declare
  me   uuid := auth.uid();
  mine text;
begin
  if me is null then
    raise exception 'not signed in' using errcode = 'insufficient_privilege';
  end if;

  select u.email into mine from auth.users u where u.id = me;

  delete from public.vn_shares where owner_id = me;
  delete from public.vn_shares where lower(email) = lower(coalesce(mine, ''));

  delete from public.vn_notes where user_id = me;
  delete from auth.users where id = me;
end;
$$;

-- Granted afterwards, in the same shape the functions had before.

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
   where email ~ '^(own|view|edit|nos|del|pal|friend|dnd|tree|plain|fresh|schema|shot|prov|mode|vpl-a|vpl-b|e2e)-?[0-9]{9,}@example\.com$'
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
  delete from auth.users where id = any(doomed);

  return array_length(doomed, 1);
end;
$$;

-- ── trigger functions: bodies name the new table ─────────────────────────
create or replace function public.vn_shares_mint_code()
returns trigger
language plpgsql
as $$
begin
  if new.code is null and new.email is null then
    /* 64 bits of the same generator the primary keys use */
    new.code := substring(replace(gen_random_uuid()::text, '-', '') from 1 for 16);
  end if;
  return new;
end $$;

create or replace function public.vn_shares_known_target()
returns trigger
language plpgsql security definer
set search_path = public, auth
as $$
begin
  if new.email is not null
     and not coalesce(new.pending, false)
     and not exists (select 1 from auth.users u
                      where lower(u.email) = lower(btrim(new.email))) then
    raise exception 'no account with that address yet'
      using errcode = 'check_violation',
            hint = 'leave the grant waiting, then allow it once they sign up';
  end if;
  return new;
end;
$$;

create or replace function public.vn_notes_only_owner_bins()
returns trigger
language plpgsql
as $$
begin
  if new.deleted_at is distinct from old.deleted_at
     and auth.uid() is not null
     and auth.uid() <> old.user_id then
    raise exception 'only the owner may delete or restore this note'
      using errcode = '42501';
  end if;
  return new;
end $$;

-- ── policies: names carry the prefix, bodies point at the functions ──────
alter policy "own all"          on public.vn_notes  rename to vn_notes_own_all;
alter policy "shared read"      on public.vn_notes  rename to vn_notes_shared_read;
alter policy "shared edit"      on public.vn_notes  rename to vn_notes_shared_edit;
alter policy "notes_owner_purges" on public.vn_notes rename to vn_notes_owner_purges;
alter policy "shares by owner"  on public.vn_shares rename to vn_shares_by_owner;
alter policy "shares for me"    on public.vn_shares rename to vn_shares_for_me;
alter policy "shares by code"   on public.vn_shares rename to vn_shares_by_code;
-- (policy expressions are re-checked at runtime, so the renamed functions
-- take effect for the old definitions too — the two "shared" policies are
-- rewritten below anyway to be explicit about it.)

drop policy if exists vn_notes_shared_read on public.vn_notes;
create policy vn_notes_shared_read on public.vn_notes
  for select to authenticated, anon
  using (public.vn_share_role(id, lower(auth.jwt() ->> 'email')) is not null);

drop policy if exists vn_notes_shared_edit on public.vn_notes;
create policy vn_notes_shared_edit on public.vn_notes
  for update to authenticated
  using (public.vn_share_role(id, lower(auth.jwt() ->> 'email')) = 'edit')
  with check (public.vn_share_role(id, lower(auth.jwt() ->> 'email')) = 'edit');

-- ── grants and function permissions, restated by name ───────────────────
revoke all on function public.vn_share_role(uuid, text)      from public;
grant execute on function public.vn_share_role(uuid, text)   to anon, authenticated;
revoke all on function public.vn_read_share(text)            from public;
grant execute on function public.vn_read_share(text)         to anon, authenticated;
revoke all on function public.vn_account_exists(text)        from public, anon;
grant execute on function public.vn_account_exists(text)     to authenticated;
revoke all on function public.vn_account_hint(text)          from public, anon;
grant execute on function public.vn_account_hint(text)       to authenticated;
revoke all on function public.vn_delete_my_account()         from public, anon;
grant execute on function public.vn_delete_my_account()      to authenticated;
revoke all on function public.vn_purge_test_accounts()       from public, anon, authenticated;

-- comments worth keeping, on the new names
comment on function public.vn_shares_mint_code() is
  'A public link needs a code, a person grant must not have one. Decided here, not by the client.';
comment on function public.vn_notes_only_owner_bins() is
  'A shared editor may change content; only the owner may bin or restore.';

commit;

-- Rollback (manual, if it is ever needed):
--   alter table public.vn_shares rename to note_shares;
--   alter table public.vn_notes  rename to notes;
--   …and the functions, triggers and policies back to their old names.
-- The baseline in 20261120000000_vpl_schema.sql is the pre-prefix state, so a
-- fresh database only ever needs this file, never the rollback.
