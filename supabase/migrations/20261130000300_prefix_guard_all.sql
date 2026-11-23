-- The prefix guard, with every letter the suite has spoken so far.
--
-- When vc's migration was copied from vd's, the replace that introduced vc_
-- also landed inside the guard's list and quietly removed vd_. The guard then
-- reported vd's own tables as offenders, which is the loudest possible way to
-- find out that a copied list must be read line by line.

create or replace function public.vpl_prefix_check()
returns table (kind text, name text)
language sql stable security definer
set search_path = public, pg_catalog
as $$
  with allowed as (
    select unnest(array['vn_', 'vi_', 'vr_', 'vz_', 'vd_', 'vc_', 'va_', 'vg_', 'vpl_']) as p
  ),
  shared as (
    select unnest(array['touch_updated_at', 'rls_auto_enable']) as n
  ),
  tables as (
    select 'table'::text as kind, c.relname::text as name
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r'
  ),
  functions as (
    select 'function'::text as kind, p.proname::text as name
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
  ),
  triggers as (
    select 'trigger'::text as kind, t.tgname::text as name
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and not t.tgisinternal
  )
  select * from (
    select * from tables union all select * from functions union all select * from triggers
  ) o
   where not exists (select 1 from allowed a where o.name like a.p || '%')
     and not exists (select 1 from shared s where s.n = o.name)
   order by 1, 2;
$$;

revoke all on function public.vpl_prefix_check() from public, anon;
grant execute on function public.vpl_prefix_check() to authenticated;
