-- vpl · the bin is not part of the document.
--
-- vr hands a shared requirement sheet to a guest through vr_read_share, which
-- aggregates every row of vr_reqs. Now that a row can sit in the bin, that
-- aggregate must skip it — otherwise a guest reads what the owner deleted, and
-- "delete" would mean two different things depending on who is looking.
--
-- Same function, one more predicate. Re-runnable.

create or replace function public.vr_read_share(p_code text)
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  p public.vr_projects;
begin
  select * into p from public.vr_projects q
    join public.vr_shares s on s.project_id = q.id
   where s.code = p_code and s.code is not null;
  if p.id is null then return null; end if;

  return jsonb_build_object(
    'project', to_jsonb(p),
    'reqs', coalesce((select jsonb_agg(to_jsonb(r) order by r.pos, r.created_at)
                        from public.vr_reqs r
                       where r.project_id = p.id and r.deleted_at is null), '[]'::jsonb),
    'terms', coalesce((select jsonb_agg(to_jsonb(t) order by lower(t.term))
                        from public.vr_terms t where t.project_id = p.id), '[]'::jsonb)
  );
end;
$$;
