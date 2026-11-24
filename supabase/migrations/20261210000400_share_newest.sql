-- vpl · a guest reads the document as it stands, not as it began.
--
-- The three share functions aggregated outputs oldest first, while the desk
-- lists them newest first. A guest therefore opened the first draft, and the
-- newest — the one that is the document — sat behind it. One word each.
--
-- vd, vc and va hand a shared job to a guest through *_read_share, which
-- aggregates every artifact and every output. Now that an input can sit in the
-- bin, the aggregate must skip the binned rows — otherwise a guest reads what
-- the owner set aside, and "removed" means two different things depending on
-- who is looking. Same three functions, one more predicate each. Re-runnable.

create or replace function public.vd_read_share(p_code text)
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  p public.vd_projects;
begin
  select * into p from public.vd_projects q
    join public.vd_shares s on s.project_id = q.id
   where s.code = p_code and s.code is not null;
  if p.id is null then return null; end if;

  return jsonb_build_object(
    'project', jsonb_build_object(
      'id', p.id, 'title', p.title, 'brief', p.brief, 'template', p.template,
      'created_at', p.created_at, 'updated_at', p.updated_at),
    'artifacts', coalesce((select jsonb_agg(
        jsonb_build_object('id', a.id, 'kind', a.kind, 'title', a.title, 'text', a.text,
                           'file_name', a.file_name, 'file_size', a.file_size, 'pos', a.pos)
        order by a.pos, a.created_at) from public.vd_artifacts a
        where a.project_id = p.id and a.deleted_at is null), '[]'::jsonb),
    'outputs', coalesce((select jsonb_agg(
        jsonb_build_object('id', o.id, 'kind', o.kind, 'title', o.title, 'body', o.body, 'pos', o.pos)
        order by o.created_at desc) from public.vd_outputs o
        where o.project_id = p.id and o.deleted_at is null), '[]'::jsonb)
  );
end;
$$;

create or replace function public.vc_read_share(p_code text)
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  p public.vc_projects;
begin
  select * into p from public.vc_projects q
    join public.vc_shares s on s.project_id = q.id
   where s.code = p_code and s.code is not null;
  if p.id is null then return null; end if;

  return jsonb_build_object(
    'project', jsonb_build_object(
      'id', p.id, 'title', p.title, 'brief', p.brief, 'template', p.template,
      'created_at', p.created_at, 'updated_at', p.updated_at),
    'artifacts', coalesce((select jsonb_agg(
        jsonb_build_object('id', a.id, 'kind', a.kind, 'title', a.title, 'text', a.text,
                           'file_name', a.file_name, 'file_size', a.file_size, 'pos', a.pos)
        order by a.pos, a.created_at) from public.vc_artifacts a
        where a.project_id = p.id and a.deleted_at is null), '[]'::jsonb),
    'outputs', coalesce((select jsonb_agg(
        jsonb_build_object('id', o.id, 'kind', o.kind, 'title', o.title, 'body', o.body, 'pos', o.pos)
        order by o.created_at desc) from public.vc_outputs o
        where o.project_id = p.id and o.deleted_at is null), '[]'::jsonb)
  );
end;
$$;

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
        order by a.pos, a.created_at) from public.va_artifacts a
        where a.project_id = p.id and a.deleted_at is null), '[]'::jsonb),
    'outputs', coalesce((select jsonb_agg(
        jsonb_build_object('id', o.id, 'kind', o.kind, 'title', o.title, 'body', o.body, 'pos', o.pos)
        order by o.created_at desc) from public.va_outputs o
        where o.project_id = p.id and o.deleted_at is null), '[]'::jsonb)
  );
end;
$$;
