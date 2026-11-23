-- vp · a drawer must be cleanable.
--
-- Revoking stops a key; deleting removes the row. Without a delete policy a
-- person cannot tidy their own drawer at all, and a test that makes slips every
-- run would leave them forever.

drop policy if exists vp_codes_delete on public.vp_codes;
create policy vp_codes_delete on public.vp_codes
  for delete to authenticated using (owner_id = (select auth.uid()));

drop policy if exists vp_keys_delete on public.vp_keys;
create policy vp_keys_delete on public.vp_keys
  for delete to authenticated
  using (owner_id = (select auth.uid()) or holder_id = (select auth.uid()));

grant delete on public.vp_codes, public.vp_keys to authenticated;
