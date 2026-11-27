-- v2.6 — an edit grant may change content, not existence.
--
-- RLS runs on the row as it will be written, so `with check` cannot see that
-- `deleted_at` changed — it can only see the new value. An editor with a
-- legitimate 'edit' grant could therefore bin the owner's note, which the app
-- never offers but the API allows. The difference between "may write here" and
-- "may make this disappear" is exactly what a BEFORE trigger can see, because
-- it has OLD.
--
-- Owner only, and only for accounts: a direct SQL connection (service role,
-- migrations) has auth.uid() = null and is left alone, as it should be.
-- Re-runnable.

create or replace function public.notes_only_owner_bins()
returns trigger
language plpgsql
as $$
begin
  if new.deleted_at is distinct from old.deleted_at
     and auth.uid() is not null
     and auth.uid() <> old.user_id then
    raise exception 'only the owner may delete or restore this note'
      using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists notes_only_owner_bins on public.notes;
create trigger notes_only_owner_bins
  before update on public.notes
  for each row execute function public.notes_only_owner_bins();

comment on function public.notes_only_owner_bins() is
  'A shared editor may change content; only the owner may bin or restore.';
