-- Deleting an account now also deletes va: the pile, the answers and the shares.
-- This is the whole suite body again, one line per app, so that adding va does
-- not quietly drop what vc and vp put here.

create or replace function public.vpl_delete_my_account()
returns void
language plpgsql security definer
set search_path = public, auth
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'not signed in' using errcode = 'insufficient_privilege';
  end if;

  delete from public.vn_shares where owner_id = me;
  delete from public.vn_shares
   where lower(email) = lower(coalesce((select u.email from auth.users u where u.id = me), ''));
  delete from public.vn_notes where user_id = me;

  delete from public.vi_projects where user_id = me;

  delete from public.vr_shares where owner_id = me;
  delete from public.vr_shares
   where lower(email) = lower(coalesce((select u.email from auth.users u where u.id = me), ''));
  delete from public.vr_projects where user_id = me;

  delete from public.vz_shares where owner_id = me;
  delete from public.vz_shares
   where lower(email) = lower(coalesce((select u.email from auth.users u where u.id = me), ''));
  delete from public.vz_projects where user_id = me;

  delete from public.vd_shares where owner_id = me;
  delete from public.vd_shares
   where lower(email) = lower(coalesce((select u.email from auth.users u where u.id = me), ''));
  delete from public.vd_projects where user_id = me;

  delete from public.vc_shares where owner_id = me;
  delete from public.vc_shares
   where lower(email) = lower(coalesce((select u.email from auth.users u where u.id = me), ''));
  delete from public.vc_projects where user_id = me;

  -- va (the pile, the answers and the shares fall with their job)
  delete from public.va_shares where owner_id = me;
  delete from public.va_shares
   where lower(email) = lower(coalesce((select u.email from auth.users u where u.id = me), ''));
  delete from public.va_projects where user_id = me;

  -- keys and codes, both as issuer and as holder (charges fall with the key)
  delete from public.vp_keys where owner_id = me or holder_id = me;
  delete from public.vp_codes where owner_id = me;

  delete from public.vpl_ai where user_id = me;

  delete from auth.users where id = me;
end;
$$;

revoke all on function public.vpl_delete_my_account() from public, anon;
grant execute on function public.vpl_delete_my_account() to authenticated;
