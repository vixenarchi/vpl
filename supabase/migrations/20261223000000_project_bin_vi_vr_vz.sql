-- vpl · the bin for the whole thing, not just for the rows in it
--
-- `vd`, `vc` and `va` got their project bin in 20261214. `vi` (a funnel),
-- `vr` (a document) and `vz` (a dictionary) were still destroying the container
-- from the rail: one press took every note, row or key inside it, and the bin
-- only ever held the rows. A person cannot undo a decision they were never
-- warned about, and "delete this funnel and everything in it?" is a warning
-- followed by a loss anyway.
--
-- One nullable column each, and the same rule as the other apps: ✕ bins, the
-- bin has a restore, and deleting for good is a separate verb that names what it
-- takes. Re-runnable.

begin;

alter table public.vi_projects add column if not exists deleted_at timestamptz;
alter table public.vr_projects add column if not exists deleted_at timestamptz;
alter table public.vz_projects add column if not exists deleted_at timestamptz;

-- the rail asks for one list or the other, and both are ordered by recency
create index if not exists vi_projects_bin on public.vi_projects (deleted_at, updated_at desc);
create index if not exists vr_projects_bin on public.vr_projects (deleted_at, updated_at desc);
create index if not exists vz_projects_bin on public.vz_projects (deleted_at, updated_at desc);

-- a binned container keeps its rows, but nobody reads them while it is binned:
-- the app only ever asks for the project it has open, and a binned project is
-- never opened. nothing else to change — the existing policies are per person.

commit;

-- rollback
-- begin;
-- drop index if exists public.vi_projects_bin;
-- drop index if exists public.vr_projects_bin;
-- drop index if exists public.vz_projects_bin;
-- alter table public.vi_projects drop column if exists deleted_at;
-- alter table public.vr_projects drop column if exists deleted_at;
-- alter table public.vz_projects drop column if exists deleted_at;
-- commit;
