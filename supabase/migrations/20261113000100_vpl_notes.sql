-- vpl: one table, three policies. Nothing else.
create table if not exists public.notes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title       text not null default '',
  body        text not null default '',
  tags        text[] not null default '{}',
  stage       text not null default 'none'
              check (stage in ('none','inbox','explore','build')),
  gate_note   text,
  parent_id   uuid references public.notes(id) on delete set null,
  is_public   boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists notes_user_updated_idx on public.notes (user_id, updated_at desc);
create index if not exists notes_stage_idx on public.notes (user_id, stage) where stage <> 'none';

alter table public.notes enable row level security;

drop policy if exists "own all" on public.notes;
create policy "own all" on public.notes
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "public read" on public.notes;
create policy "public read" on public.notes
  for select to anon, authenticated
  using (is_public = true);

-- updated_at maintained by the database, not the client
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists notes_touch on public.notes;
create trigger notes_touch before update on public.notes
  for each row execute function public.touch_updated_at();
