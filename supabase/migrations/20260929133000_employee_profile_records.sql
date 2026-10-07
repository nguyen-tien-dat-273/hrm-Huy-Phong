-- Hồ sơ nhân sự tập trung: thông tin cá nhân, học vấn, mã nhân viên chuẩn và kho tài liệu.

alter table public.profiles add column if not exists hometown text;
alter table public.profiles add column if not exists permanent_address text;
alter table public.profiles add column if not exists current_address text;
alter table public.profiles add column if not exists education_level text
  check (education_level is null or education_level in ('HIGH_SCHOOL','VOCATIONAL','COLLEGE','UNIVERSITY','POSTGRADUATE','OTHER'));
alter table public.profiles add column if not exists school_name text;
alter table public.profiles add column if not exists major text;
alter table public.profiles add column if not exists graduation_year smallint
  check (graduation_year is null or graduation_year between 1950 and 2100);

create sequence if not exists public.employee_code_seq start 1;

create or replace function public.standardize_employee_code()
returns trigger language plpgsql set search_path = public as $$
declare candidate text;
begin
  if nullif(trim(new.employee_code), '') is not null then
    new.employee_code := upper(regexp_replace(trim(new.employee_code), '\s+', '-', 'g'));
    return new;
  end if;
  loop
    candidate := 'HP-' || lpad(nextval('public.employee_code_seq')::text, 6, '0');
    exit when not exists (
      select 1 from public.profiles p where lower(p.employee_code) = lower(candidate) and p.id <> new.id
    );
  end loop;
  new.employee_code := candidate;
  return new;
end;
$$;

drop trigger if exists profiles_standardize_employee_code on public.profiles;
create trigger profiles_standardize_employee_code
before insert or update of employee_code on public.profiles
for each row execute function public.standardize_employee_code();

update public.profiles set employee_code = null where nullif(trim(employee_code), '') is null;

create table if not exists public.employee_documents (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.profiles(id) on delete cascade,
  document_type text not null check (document_type in ('CV','IDENTITY','CONTRACT','DEGREE','CERTIFICATE','HEALTH','OTHER')),
  title text not null check (length(trim(title)) >= 2),
  document_number text,
  issue_date date,
  expiry_date date,
  storage_path text not null unique,
  file_name text not null,
  mime_type text,
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 10485760),
  version integer not null default 1 check (version > 0),
  note text,
  uploaded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint employee_document_dates_valid check (expiry_date is null or issue_date is null or expiry_date >= issue_date)
);

create index if not exists employee_documents_employee_idx on public.employee_documents(employee_id, created_at desc);
create index if not exists employee_documents_expiry_idx on public.employee_documents(expiry_date) where expiry_date is not null;
alter table public.employee_documents enable row level security;

drop policy if exists employee_documents_read on public.employee_documents;
create policy employee_documents_read on public.employee_documents for select to authenticated
  using (employee_id = auth.uid() or public.can('users'));
drop policy if exists employee_documents_manage on public.employee_documents;
create policy employee_documents_manage on public.employee_documents for all to authenticated
  using (public.can('users')) with check (public.can('users'));
grant select, insert, update, delete on public.employee_documents to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'employee-documents', 'employee-documents', false, 10485760,
  array['application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','image/png','image/jpeg','image/webp']
)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists employee_documents_storage_read on storage.objects;
create policy employee_documents_storage_read on storage.objects for select to authenticated
  using (bucket_id = 'employee-documents' and ((storage.foldername(name))[1] = auth.uid()::text or public.can('users')));
drop policy if exists employee_documents_storage_insert on storage.objects;
create policy employee_documents_storage_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'employee-documents' and public.can('users'));
drop policy if exists employee_documents_storage_update on storage.objects;
create policy employee_documents_storage_update on storage.objects for update to authenticated
  using (bucket_id = 'employee-documents' and public.can('users'))
  with check (bucket_id = 'employee-documents' and public.can('users'));
drop policy if exists employee_documents_storage_delete on storage.objects;
create policy employee_documents_storage_delete on storage.objects for delete to authenticated
  using (bucket_id = 'employee-documents' and public.can('users'));
