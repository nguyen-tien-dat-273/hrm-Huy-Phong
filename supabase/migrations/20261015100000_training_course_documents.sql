-- Private course handouts, visible to course assignees and training managers.
alter table public.training_courses add column if not exists document_path text;
alter table public.training_courses add column if not exists document_file_name text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'training-documents', 'training-documents', false, 20971520,
  array[
    'application/pdf', 'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain'
  ]
)
on conflict (id) do update set file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists training_documents_select on storage.objects;
create policy training_documents_select on storage.objects for select to authenticated
using (bucket_id = 'training-documents' and (public.can('training') or exists (
  select 1 from public.training_enrollments e
  where e.user_id = auth.uid() and e.course_id::text = (storage.foldername(name))[1]
)));

drop policy if exists training_documents_insert on storage.objects;
create policy training_documents_insert on storage.objects for insert to authenticated
with check (bucket_id = 'training-documents' and public.can('training'));

drop policy if exists training_documents_update on storage.objects;
create policy training_documents_update on storage.objects for update to authenticated
using (bucket_id = 'training-documents' and public.can('training'))
with check (bucket_id = 'training-documents' and public.can('training'));

drop policy if exists training_documents_delete on storage.objects;
create policy training_documents_delete on storage.objects for delete to authenticated
using (bucket_id = 'training-documents' and public.can('training'));
