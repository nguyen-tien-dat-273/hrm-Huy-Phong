-- Private storage for employee completion evidence uploaded from their computer.
insert into storage.buckets (id, name, public, file_size_limit)
values ('task-evidence', 'task-evidence', false, 10485760)
on conflict (id) do update
  set public = false,
      file_size_limit = 10485760;

drop policy if exists task_evidence_read on storage.objects;
create policy task_evidence_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'task-evidence'
    and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and public.project_member_has_permission(
      ((storage.foldername(name))[1])::uuid,
      auth.uid(),
      'project.view'
    )
  );

drop policy if exists task_evidence_insert on storage.objects;
create policy task_evidence_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'task-evidence'
    and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and (storage.foldername(name))[3] = auth.uid()::text
    and public.project_member_has_permission(
      ((storage.foldername(name))[1])::uuid,
      auth.uid(),
      'project.view'
    )
  );
