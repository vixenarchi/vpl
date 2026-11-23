-- The shared job answers newest output first, as the owner's screen does.
-- A guest who opens a link should read what was last written, not the first
-- draft from an hour ago.
create or replace function public.va_read_share(p_code text)
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  p public.va_projects;
begin
  select * into p from public.va_projects q
    join public.va_shares s on s.project_id = q.id
   where s.code = p_code and s.code is not null;
  if p.id is null then return null; end if;

  return jsonb_build_object(
    'project', jsonb_build_object(
      'id', p.id, 'title', p.title, 'brief', p.brief, 'template', p.template,
      'created_at', p.created_at, 'updated_at', p.updated_at),
    'artifacts', coalesce((select jsonb_agg(
        jsonb_build_object('id', a.id, 'kind', a.kind, 'title', a.title, 'text', a.text,
                           'file_name', a.file_name, 'file_size', a.file_size, 'pos', a.pos)
        order by a.pos, a.created_at) from public.va_artifacts a where a.project_id = p.id), '[]'::jsonb),
    'outputs', coalesce((select jsonb_agg(
        jsonb_build_object('id', o.id, 'kind', o.kind, 'title', o.title, 'body', o.body,
                           'pos', o.pos, 'created_at', o.created_at)
        order by o.created_at desc) from public.va_outputs o where o.project_id = p.id), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.va_read_share(text) from public;
grant execute on function public.va_read_share(text) to anon, authenticated;
