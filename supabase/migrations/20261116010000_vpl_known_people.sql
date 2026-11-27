-- 0008 — sharing is for people who already have an account, and an account can
-- be removed by its owner.
--
-- Why the check exists: a grant is an address, `note_shares.email`. Before this
-- migration an owner could type any address, registered or not, and whoever
-- signed up with that address later received the note — including a stranger,
-- if the address was a guess. Now a grant can only be made for an account that
-- exists at the moment of sharing, so the address was at least plausible then.
--
-- What this does NOT fix, and no SQL can: this project has no email
-- confirmation, so a person can sign up with an address they do not own. Turning
-- on "Confirm email" in the Supabase dashboard closes that. The check below
-- still helps — it removes the "invite by guessing" path entirely.

-- ── 1. does an account exist? ─────────────────────────────────────────
-- Reading auth.users needs the owner's rights, so this is a definer function.
-- It reveals whether an address is registered, which sign-up already reveals
-- ("already registered"), so nothing new leaks.
create or replace function public.account_exists(who text)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1 from auth.users u
     where lower(u.email) = lower(btrim(who))
  );
$$;

revoke all on function public.account_exists(text) from public, anon;
grant execute on function public.account_exists(text) to authenticated;

-- ── 2. the rule is enforced in the table, not only in the dialog ──────
-- The browser asks first so it can explain; this trigger is what makes the
-- rule true even for a hand-made request.
create or replace function public.note_shares_known_target()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if new.email is not null
     and not exists (select 1 from auth.users u
                      where lower(u.email) = lower(btrim(new.email))) then
    raise exception 'no account with that address yet'
      using errcode = 'check_violation',
            hint = 'ask them to create an account first, then share again';
  end if;
  return new;
end;
$$;

drop trigger if exists note_shares_known_target on public.note_shares;
create trigger note_shares_known_target
  before insert or update of email on public.note_shares
  for each row execute function public.note_shares_known_target();

-- ── 3. delete my account ──────────────────────────────────────────────
-- There is no server, so the browser cannot hold a service-role key. The
-- deletion therefore runs as the table owner, and takes the caller's identity
-- from the JWT — it can only ever delete the caller's own rows.
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
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

  -- grants I handed out, and grants handed to me
  delete from public.note_shares where owner_id = me;
  delete from public.note_shares where lower(email) = lower(coalesce(mine, ''));

  delete from public.notes where user_id = me;
  delete from auth.users where id = me;
end;
$$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
