-- Minimal non-payroll objects the payroll migrations reference.
create extension if not exists pgcrypto;
create extension if not exists "uuid-ossp";

create table public.organization_units (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references public.organization_units(id),
  name text not null,
  code text
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null default '',
  email text not null default '',
  role text not null default 'staff',
  access_role_code text,
  department text,
  employee_code text unique,
  unit_id uuid references public.organization_units(id),
  position_id uuid,
  manager_id uuid,
  hire_date date,
  employment_status text default 'active',
  is_active boolean default true,
  annual_leave_quota numeric
);

create table public.system_access_roles (code text primary key, name text, is_active boolean default true);
create table public.system_access_role_functions (access_role_code text, function_code text);
create table public.job_position_function_permissions (position_id uuid, function_code text);
create table public.job_position_permissions (position_id uuid, permission text);
create table public.profile_function_permissions (user_id uuid, function_code text);

create table public.audit_logs (
  id bigserial primary key,
  actor_id uuid, actor_name text, action text, entity_type text, entity_id text,
  target_user_id uuid, target_name text, summary text, details jsonb,
  created_at timestamptz default now()
);

create table public.timesheet_periods (
  id uuid primary key default gen_random_uuid(),
  month_start date not null unique,
  status text not null default 'OPEN'
);



create table public.salary_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid, base_salary numeric, allowance numeric, note text, updated_by uuid, updated_at timestamptz
);

create table public.performance_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid, period_month date, status text, final_score numeric
);

create or replace function public.is_admin() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin', 'ceo'));
$$;

create or replace function public.can(target text) returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin();
$$;

create or replace function public.can_function(target_function text) returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or exists (
    select 1 from public.profile_function_permissions f where f.user_id = auth.uid() and f.function_code = target_function
  );
$$;
