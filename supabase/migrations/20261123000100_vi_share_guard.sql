-- vi — an editor writes text, never decisions.
--
-- RLS can say who may update a row but not which columns. These two triggers
-- can, and they say the rule where it cannot be worked around: the stage, the
-- reason, the order and the chosen idea move only under the owner's hand.

/* An editor writes text; a decision changes the funnel's shape. RLS can say who
 * may update a row but not which columns, so the rule is a trigger: the stage,
 * the reason, the order and the chosen idea move only under the owner's hand. */
create or replace function public.vi_decisions_are_the_owners()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_table_name = 'vi_projects' then
    if new.chosen_id is distinct from old.chosen_id
       and not exists (select 1 from public.vi_projects p
                        where p.id = new.id and p.user_id = auth.uid()) then
      raise exception 'only the owner decides which idea is chosen'
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  if (new.stage is distinct from old.stage
      or new.reason is distinct from old.reason
      or new."position" is distinct from old."position")
     and not exists (select 1 from public.vi_projects p
                      where p.id = new.project_id and p.user_id = auth.uid()) then
    raise exception 'only the owner chooses or parks an idea'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

comment on function public.vi_decisions_are_the_owners() is
  'Shared editors may write text; choosing, parking and reordering belong to the owner of the funnel.';

drop trigger if exists vi_projects_owner_decides on public.vi_projects;
create trigger vi_projects_owner_decides
  before update on public.vi_projects
  for each row execute function public.vi_decisions_are_the_owners();

drop trigger if exists vi_ideas_owner_decides on public.vi_ideas;
create trigger vi_ideas_owner_decides
  before update on public.vi_ideas
  for each row execute function public.vi_decisions_are_the_owners();
