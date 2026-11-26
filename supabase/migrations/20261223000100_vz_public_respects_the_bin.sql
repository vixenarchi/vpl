-- vpl · a binned dictionary stops answering at its public address
--
-- `vz` publishes a project at /p/<code>: `vz_read_public` is a security definer
-- that serves it to anyone with the code. Binning a project (20261223) hid it
-- from the rail but not from the world, because the function only asked whether
-- the project was published. A place you have put away must not go on answering.
--
-- Same body, one more condition. Re-runnable.

begin;

create or replace function public.vz_read_public(p_code text, p_key text default null)
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  p public.vz_projects;
  v text;
begin
  select * into p from public.vz_projects q
   where q.published = true and q.publish_code = p_code and q.deleted_at is null;
  if p.id is null then return null; end if;

  if p_key is null or btrim(p_key) = '' then
    return jsonb_build_object(
      'title', p.title,
      'keys', coalesce((select jsonb_object_agg(x.key, x.value order by lower(x.key))
                          from public.vz_pairs x
                         where x.project_id = p.id and x.deleted_at is null), '{}'::jsonb));
  end if;

  select x.value into v
    from public.vz_pairs x
   where x.project_id = p.id and x.deleted_at is null and lower(x.key) = lower(p_key);
  if v is null then
    return jsonb_build_object('title', p.title, 'key', p_key, 'found', false);
  end if;
  return jsonb_build_object('title', p.title, 'key', p_key, 'found', true, 'value', v);
end;
$$;

revoke all on function public.vz_read_public(text, text) from public;
grant execute on function public.vz_read_public(text, text) to anon, authenticated;

commit;
