-- vr: one attachment per row, kept out of the table and out of the repo.
--
-- The proof of a requirement is sometimes a screenshot or a PDF: a photo of the
-- old roof, a scan of the tender clause. It is not enough to keep a path — the
-- file has to be readable by exactly the people who may read the document, and
-- by nobody else. So the bucket is private and the screen asks for a signed url
-- at the moment somebody opens it.
--
-- Two megabytes is deliberate. A spec is a text document with evidence attached,
-- not a file store; anything bigger than a photo or a short scan belongs in a
-- link, and the source field still takes a link.
--
-- Paths are `<project_id>/<req_id>/<stamp>-<name>`: the first segment is the
-- document, which is how the storage policies know whose file this is.

alter table public.vr_reqs
  add column if not exists file_path text,
  add column if not exists file_name text,
  add column if not exists file_size integer,
  add column if not exists file_mime text;

insert into storage.buckets (id, name, public, file_size_limit)
values ('vr-files', 'vr-files', false, 2097152)
on conflict (id) do update
  set public = false,
      file_size_limit = 2097152;

/* Who may read and who may write a document, in one place, so the storage
 * policies and the table policies cannot drift apart. */
create or replace function public.vr_can_read(project uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.vr_projects p
     where p.id = project
       and (p.user_id = auth.uid()
            or public.vr_share_role(p.id, lower(coalesce(auth.jwt() ->> 'email', ''))) is not null));
$$;

create or replace function public.vr_can_edit(project uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.vr_projects p
     where p.id = project
       and (p.user_id = auth.uid()
            or public.vr_share_role(p.id, lower(coalesce(auth.jwt() ->> 'email', ''))) = 'edit'));
$$;

revoke all on function public.vr_can_read(uuid) from public, anon;
revoke all on function public.vr_can_edit(uuid) from public, anon;
grant execute on function public.vr_can_read(uuid) to authenticated;
grant execute on function public.vr_can_edit(uuid) to authenticated;

/* The first path segment is a project id — or it is nothing, and the policy
 * denies. A cast that raises would turn a stray object into an error page. */
create or replace function public.vr_path_project(object_name text)
returns uuid
language plpgsql immutable
as $$
declare
  head text := split_part(coalesce(object_name, ''), '/', 1);
begin
  if head !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    return null;
  end if;
  return head::uuid;
exception when others then
  return null;
end;
$$;

revoke all on function public.vr_path_project(text) from public;
grant execute on function public.vr_path_project(text) to authenticated;

/* storage.objects already has RLS on; these are the only doors into vr-files */
drop policy if exists vr_files_read on storage.objects;
create policy vr_files_read on storage.objects for select to authenticated
  using (bucket_id = 'vr-files'
         and public.vr_can_read(public.vr_path_project(name)));

drop policy if exists vr_files_write on storage.objects;
create policy vr_files_write on storage.objects for insert to authenticated
  with check (bucket_id = 'vr-files'
              and public.vr_can_edit(public.vr_path_project(name)));

drop policy if exists vr_files_change on storage.objects;
create policy vr_files_change on storage.objects for update to authenticated
  using (bucket_id = 'vr-files'
         and public.vr_can_edit(public.vr_path_project(name)));

drop policy if exists vr_files_drop on storage.objects;
create policy vr_files_drop on storage.objects for delete to authenticated
  using (bucket_id = 'vr-files'
         and public.vr_can_edit(public.vr_path_project(name)));
