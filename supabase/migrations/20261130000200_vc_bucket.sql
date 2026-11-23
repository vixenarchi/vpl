-- vc's files live in their own bucket.
--
-- The first vc migration was copied from vd's and kept the bucket name in the
-- storage policies: the policies were right but they guarded vd's bucket, and
-- vc's uploads (path under vc-files) had nowhere to land. A copied file is a
-- fine starting point and a bad place to stop reading.

insert into storage.buckets (id, name, public, file_size_limit)
values ('vc-files', 'vc-files', false, 10485760)
on conflict (id) do update set file_size_limit = excluded.file_size_limit, public = false;

drop policy if exists vc_files_read on storage.objects;
create policy vc_files_read on storage.objects for select to authenticated
  using (bucket_id = 'vc-files' and public.vc_can_read(public.vc_path_project(name)));

drop policy if exists vc_files_add on storage.objects;
create policy vc_files_add on storage.objects for insert to authenticated
  with check (bucket_id = 'vc-files' and public.vc_can_edit(public.vc_path_project(name)));

drop policy if exists vc_files_write on storage.objects;
create policy vc_files_write on storage.objects for update to authenticated
  using (bucket_id = 'vc-files' and public.vc_can_edit(public.vc_path_project(name)));

drop policy if exists vc_files_drop on storage.objects;
create policy vc_files_drop on storage.objects for delete to authenticated
  using (bucket_id = 'vc-files' and public.vc_can_edit(public.vc_path_project(name)));
