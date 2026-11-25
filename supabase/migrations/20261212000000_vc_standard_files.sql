-- vc — files for the library.
--
-- A standard can arrive as a PDF. The text is extracted in the browser and kept
-- in vc_standards.text; the original goes to vc-files so a person can still look
-- at page 47. The existing storage policies ask "is this a project I may read",
-- and a standard is not a project, so a standard's own file would have been
-- refused. Two more questions, in the same shape as the four already there.
--
-- Path for a standard's file: <vc_standards.id>/<uuid>-<name>

create or replace function public.vc_can_read_std(object_name text)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.vc_standards s
     where s.id = public.vc_path_project(object_name)
       and s.user_id = auth.uid()
  );
$$;

revoke all on function public.vc_can_read_std(text) from public, anon;
grant execute on function public.vc_can_read_std(text) to authenticated;

/* The drawer is private, so read and write are the same person. Kept as two
 * functions anyway: the day the library is shared, only this one changes. */
create or replace function public.vc_can_edit_std(object_name text)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select public.vc_can_read_std(object_name);
$$;

revoke all on function public.vc_can_edit_std(text) from public, anon;
grant execute on function public.vc_can_edit_std(text) to authenticated;

drop policy if exists vc_files_read on storage.objects;
create policy vc_files_read on storage.objects for select to authenticated
  using (bucket_id = 'vc-files'
         and (public.vc_can_read(public.vc_path_project(name))
              or public.vc_can_read_std(name)));

drop policy if exists vc_files_add on storage.objects;
create policy vc_files_add on storage.objects for insert to authenticated
  with check (bucket_id = 'vc-files'
              and (public.vc_can_edit(public.vc_path_project(name))
                   or public.vc_can_edit_std(name)));

drop policy if exists vc_files_write on storage.objects;
create policy vc_files_write on storage.objects for update to authenticated
  using (bucket_id = 'vc-files'
         and (public.vc_can_edit(public.vc_path_project(name))
              or public.vc_can_edit_std(name)));

drop policy if exists vc_files_drop on storage.objects;
create policy vc_files_drop on storage.objects for delete to authenticated
  using (bucket_id = 'vc-files'
         and (public.vc_can_edit(public.vc_path_project(name))
              or public.vc_can_edit_std(name)));

comment on function public.vc_can_read_std(text) is
  'May this person read the file that belongs to this library standard. A standard is not a project.';
