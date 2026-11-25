-- vc — the library: a law you keep, so you stop pasting it.
--
-- Today a rule is pasted into a check and lives there. The same law is pasted
-- into five checks and drifts. So: one table, owned by a person, reused across
-- their checks — and nothing else. No control catalogue, no crosswalk between
-- standards, no versions with diffs, no tags tree. This is a drawer, not a
-- product.
--
-- A check never holds a pointer. "add to this check" copies the text into
-- vc_artifacts and remembers from_standard for provenance, because a report
-- must stay reproducible even if the law is replaced next year.
--
-- chars is generated, not typed: it exists so a person can see that the AI Act
-- does not fit in one call before they press the button.

create table if not exists public.vc_standards (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  title      text not null default '',
  kind       text not null default 'law'
               check (kind in ('law', 'standard', 'policy', 'terms', 'job-ad')),
  source_url text,
  text       text not null default '',
  file_path  text,
  file_name  text,
  file_size  bigint,
  file_mime  text,
  chars      integer generated always as (char_length(text)) stored,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists vc_standards_mine
  on public.vc_standards (user_id, updated_at desc);

create index if not exists vc_standards_live
  on public.vc_standards (user_id, updated_at desc) where deleted_at is null;

/* Provenance, not a foreign key you must keep: deleting the standard does not
 * take the text out of a report that was already written. */
alter table public.vc_artifacts
  add column if not exists from_standard uuid references public.vc_standards (id) on delete set null;

drop trigger if exists vc_standards_touch on public.vc_standards;
create trigger vc_standards_touch before update on public.vc_standards
  for each row execute function public.touch_updated_at();

/* ── the drawer is private ──────────────────────────────────────────
 * Read, write and delete: only the person who owns it. The library is not
 * shared, not published, and no share function reads it — when it is shared,
 * it will be shared by the person, in the two-door dialog, later. */
alter table public.vc_standards enable row level security;

drop policy if exists vc_standards_read on public.vc_standards;
create policy vc_standards_read on public.vc_standards for select to authenticated
  using (user_id = auth.uid());

drop policy if exists vc_standards_add on public.vc_standards;
create policy vc_standards_add on public.vc_standards for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists vc_standards_write on public.vc_standards;
create policy vc_standards_write on public.vc_standards for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists vc_standards_drop on public.vc_standards;
create policy vc_standards_drop on public.vc_standards for delete to authenticated
  using (user_id = auth.uid());

comment on table public.vc_standards is
  'A person''s own documents: laws, standards, policies, terms, job ads. Private, reusable, copied into a check rather than pointed at.';
comment on column public.vc_artifacts.from_standard is
  'Which library row this input was copied from. Provenance only — the text is the copy.';
