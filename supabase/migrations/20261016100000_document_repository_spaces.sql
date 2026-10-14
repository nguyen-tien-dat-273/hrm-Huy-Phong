-- Candidate files remain private and can only be read by full administrators.
update public.system_function_catalog
set name = 'Kho hồ sơ giấy tờ',
    description = 'Tra cứu hồ sơ ứng viên và hồ sơ nhân viên.'
where code = 'admin.worker_documents';

create table if not exists public.recruitment_candidate_documents (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.recruitment_candidates(id) on delete cascade,
  title text not null check (length(trim(title)) >= 2),
  storage_path text not null unique,
  file_name text not null,
  mime_type text,
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 10485760),
  uploaded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists recruitment_candidate_documents_candidate_idx
  on public.recruitment_candidate_documents(candidate_id, created_at desc);
alter table public.recruitment_candidate_documents enable row level security;
drop policy if exists recruitment_candidate_documents_admin on public.recruitment_candidate_documents;
create policy recruitment_candidate_documents_admin on public.recruitment_candidate_documents
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
grant select, insert, update, delete on public.recruitment_candidate_documents to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'candidate-documents', 'candidate-documents', false, 10485760,
  array['application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation','image/png','image/jpeg','image/webp']
)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists candidate_documents_storage_admin on storage.objects;
create policy candidate_documents_storage_admin on storage.objects for all to authenticated
  using (bucket_id = 'candidate-documents' and public.is_admin())
  with check (bucket_id = 'candidate-documents' and public.is_admin());

-- A team lead may read documents only for employees in their own department.
-- This is read-only; uploads, edits, and deletes still require HR users permission.
create or replace function public.can_read_department_employee_documents(target_employee uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin()
    or public.can('users')
    or public.can_function('admin.worker_documents')
    or exists (
      select 1
      from public.profiles actor
      join public.profiles employee on employee.id = target_employee
      where actor.id = auth.uid()
        and actor.is_active
        and actor.role = 'teamlead'
        and actor.department is not null
        and actor.department = employee.department
    );
$$;
revoke all on function public.can_read_department_employee_documents(uuid) from public, anon;
grant execute on function public.can_read_department_employee_documents(uuid) to authenticated;

drop policy if exists employee_documents_read on public.employee_documents;
create policy employee_documents_read on public.employee_documents for select to authenticated
  using (employee_id = auth.uid() or public.can_read_department_employee_documents(employee_id));

drop policy if exists employee_documents_storage_read on storage.objects;
create policy employee_documents_storage_read on storage.objects for select to authenticated
  using (
    bucket_id = 'employee-documents'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.can_read_department_employee_documents(((storage.foldername(name))[1])::uuid)
    )
  );
