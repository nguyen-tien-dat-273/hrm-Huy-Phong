-- Minimal baseline for the profiles table so the early HRM migrations can compile.
-- This intentionally keeps the schema narrow and does not import the legacy schema_baseline.sql
-- wholesale, because later migrations evolve the profiles structure and organization model.

create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null default '',
  email text not null default '',
  role text not null default 'staff'
    check (role in ('admin', 'ceo', 'hr', 'manager', 'teamlead', 'staff')),
  access_role_code text,
  department text,
  employee_code text unique,
  manager_id uuid references public.profiles(id) on delete set null,
  hire_date date,
  employment_status text default 'active'
    check (employment_status in ('active', 'on_leave', 'terminated')),
  phone text,
  hometown text,
  permanent_address text,
  current_address text,
  education_level text,
  school_name text,
  major text,
  graduation_year integer,
  avatar_url text,
  is_active boolean default true,
  must_change_password boolean default false,
  permissions text[] default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists profiles_manager_idx on public.profiles (manager_id);
create index if not exists profiles_employee_code_idx on public.profiles (lower(employee_code)) where employee_code is not null;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.is_active
      and p.role in ('admin', 'ceo')
  );
$$;

create or replace function public.can(perm text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.is_active
      and (
        p.role in ('admin', 'ceo')
        or perm = any(coalesce(p.permissions, '{}'))
      )
  );
$$;

revoke all on function public.is_admin() from public;
revoke all on function public.can(text) from public;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.can(text) to authenticated;
