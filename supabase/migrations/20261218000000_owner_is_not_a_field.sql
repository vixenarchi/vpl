-- vpl · a row belongs to somebody, and that is not a field a person edits
--
-- The sixth app in the suite has a policy shaped like
--
--   using (share_role(project_id) = 'edit')
--   with check (share_role(project_id) = 'edit')
--
-- and it reads like a rule about people. It is a rule about an *id*: the check
-- re-reads the grant from the row's own `project_id`. So a shared editor could
-- send `{ "user_id": "<their own uuid>" }` along with a normal edit, the check
-- still passed — the project id had not moved — and the row now belonged to
-- them. One field, and somebody else's document is yours.
--
-- A `with check` cannot fix this: by the time it runs, `user_id` is already the
-- new one. The rule is about a column, so it belongs in a trigger, and it is one
-- trigger for the whole suite rather than seven copies of the same paragraph.
--
-- Attached by schema walk, so a table added later gets it without being
-- remembered. Re-runnable.

create or replace function public.vpl_owner_is_not_a_field()
returns trigger
language plpgsql
as $$
declare
  before_row jsonb := to_jsonb(old);
  after_row  jsonb := to_jsonb(new);
  col text;
begin
  /* the service role and the worker write without a JWT; a person never does */
  if auth.uid() is null then return new; end if;

  foreach col in array array['user_id', 'owner_id', 'project_id', 'note_id', 'sheet_id', 'standard_id']
  loop
    if before_row ? col and after_row ? col
       and after_row ->> col is distinct from before_row ->> col then
      raise exception 'this row belongs to somebody; % is not a field a person edits', col
        using errcode = 'insufficient_privilege';
    end if;
  end loop;

  return new;
end;
$$;

comment on function public.vpl_owner_is_not_a_field() is
  'An owner is decided when a row is made. Moving a row to another person is not an edit.';

do $$
declare
  t record;
begin
  for t in
    select distinct c.table_name
      from information_schema.columns c
      join information_schema.tables tb
        on tb.table_schema = c.table_schema and tb.table_name = c.table_name
     where c.table_schema = 'public'
       and tb.table_type = 'BASE TABLE'
       and c.column_name in ('user_id', 'owner_id')
       and c.table_name not like 'pg_%'
  loop
    execute format('drop trigger if exists %I on public.%I',
      t.table_name || '_owner_guard', t.table_name);
    execute format('create trigger %I before update on public.%I '
                   'for each row execute function public.vpl_owner_is_not_a_field()',
      t.table_name || '_owner_guard', t.table_name);
  end loop;
end;
$$;
