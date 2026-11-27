-- 0013 — a hint about the account behind an address.
--
-- Sharing with an address means trusting whoever registered it first. Email
-- confirmation would settle that, and it is deliberately off here: a private
-- notes app should let a person sign up in ten seconds. So the owner gets the
-- next best thing — before the grant is made, the dialog shows the *name* on
-- that account and *when it was made*. A minute-old account claiming a friend's
-- address is visible at a glance, and the decision stays with the owner.
--
-- What it reveals: for a given address, whether it is registered and the display
-- name. Sign-up already reveals the first part ("already registered"), so this
-- adds a name — no note, no email list, nothing that can be enumerated usefully.

create or replace function public.account_hint(who text)
returns table (found boolean, name text, made timestamptz)
language sql
stable
security definer
set search_path = public, auth
as $$
  select true,
         coalesce(nullif(u.raw_user_meta_data ->> 'full_name', ''),
                  nullif(u.raw_user_meta_data ->> 'name', '')),
         u.created_at
    from auth.users u
   where lower(u.email) = lower(btrim(who))
   limit 1;
$$;

revoke all on function public.account_hint(text) from public, anon;
grant execute on function public.account_hint(text) to authenticated;
