-- vr — the guard read a column that only one of the two tables has.
--
-- The first version asked for new.project_id before it asked which table it was
-- on, so every change to a document died with 42703 and no amount of retry
-- could save a title. The branch now comes first: a document is decided by its
-- own id, a row by the document it belongs to.

create or replace function public.vr_decisions_are_the_owners()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_table_name = 'vr_projects' then
    if exists (select 1 from public.vr_projects p
                where p.id = new.id and p.user_id = auth.uid()) then
      return new;
    end if;
    if new.title is distinct from old.title then
      raise exception 'only the owner renames the document'
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  if exists (select 1 from public.vr_projects p
              where p.id = new.project_id and p.user_id = auth.uid()) then
    return new;
  end if;

  if new.ref is distinct from old.ref
     or new.kind is distinct from old.kind
     or new.strength is distinct from old.strength
     or new.status is distinct from old.status
     or new.pos is distinct from old.pos then
    raise exception 'only the owner changes the name, the strength, the kind or the order'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
