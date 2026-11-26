-- vpl · vp — the ledger stays readable after the columns were trimmed
--
-- `vp_charges_read` was written as `exists (select 1 from vp_keys k where
-- k.id = key_id and (k.holder_id = auth.uid() or k.owner_id = auth.uid()))`.
-- A policy expression is evaluated with the caller's own privileges, and
-- 20261215 took `owner_id` away from the caller — so the ledger stopped
-- answering with 403 for everyone, holder and issuer alike. The rule was right;
-- the way it was written depended on a column nobody should read.
--
-- The question "may this person see this key's charges" is asked in one function
-- that runs as its owner and answers yes or no. Re-runnable.

create or replace function public.vp_can_see_key(p_key uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.vp_keys k
     where k.id = p_key
       and (k.holder_id = auth.uid() or k.owner_id = auth.uid())
  );
$$;

revoke all on function public.vp_can_see_key(uuid) from public, anon;
grant execute on function public.vp_can_see_key(uuid) to authenticated;

drop policy if exists vp_charges_read on public.vp_charges;
create policy vp_charges_read on public.vp_charges for select to authenticated
  using (public.vp_can_see_key(key_id));
