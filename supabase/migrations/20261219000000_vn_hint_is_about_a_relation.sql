-- vpl · vn — a name is for somebody you already know
--
-- `vn_account_hint(who)` answered, for any signed-in caller, whether an address
-- has an account *and* that person's display name and the date the account was
-- made. Registration is open, so `authenticated` means "anybody": walking a list
-- of addresses was enough to learn who is here, what they are called, and how
-- long they have been here. The share dialog only needs the first part.
--
-- The line: an account's name is shown to a person who already has a relation
-- with that address — the address is on a share they own. Otherwise the answer
-- is "yes, that account exists", which is exactly what the dialog draws.
--
-- Re-runnable.

create or replace function public.vn_account_hint(who text)
returns table (found boolean, name text, made timestamptz)
language sql stable security definer
set search_path = public, auth
as $$
  with asked as (select lower(btrim(coalesce(who, ''))) as addr),
  related as (
    select exists (
      select 1
        from public.vn_shares s, asked a
       where s.owner_id = auth.uid()
         and lower(coalesce(s.email, '')) = a.addr
    ) as yes
  )
  select true,
         case when r.yes then coalesce(u.raw_user_meta_data ->> 'full_name', '') else '' end,
         case when r.yes then u.created_at else null end
    from auth.users u, asked a, related r
   where lower(u.email) = a.addr
   limit 1;
$$;

grant execute on function public.vn_account_hint(text) to authenticated;

comment on function public.vn_account_hint(text) is
  'Does this address have an account, and — only for an address already on a share of mine — what it is called.';
