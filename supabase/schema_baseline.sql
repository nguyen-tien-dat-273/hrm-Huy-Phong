-- ============================================================================
-- HRM HUY PHONG - SCHEMA BASELINE (KHUNG DỮ LIỆU BAN ĐẦU)
-- ----------------------------------------------------------------------------
-- File này chứa toàn bộ các bảng, kiểu dữ liệu, enum và hàm cơ sở ban đầu
-- của ứng dụng HRM. Được dùng làm nền trước khi chạy chuỗi migrations nâng cấp.
-- ============================================================================

-- Bật các extensions cần thiết
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- 1. BẢNG HO CƠ CẤU TỔ CHỨC (Organization Units)
create table if not exists public.organization_units (
  id text primary key,
  name text not null,
  code text unique,
  parent_id text references public.organization_units(id) on delete set null,
  manager_id uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 2. BẢNG HỒ SƠ NHÂN VIÊN (Profiles)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null default '',
  email text not null default '',
  role text not null default 'staff' check (role in ('admin', 'ceo', 'hr', 'manager', 'teamlead', 'staff')),
  access_role_code text,
  department text,
  employee_code text unique,
  unit_id text references public.organization_units(id) on delete set null,
  position_id text,
  manager_id uuid references public.profiles(id) on delete set null,
  hire_date date,
  employment_status text default 'active' check (employment_status in ('active', 'on_leave', 'terminated')),
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
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 3. BẢNG KỲ BẢNG CÔNG (Timesheet Periods)
create table if not exists public.timesheet_periods (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  start_date date not null,
  end_date date not null,
  is_locked boolean default false,
  created_at timestamptz default now()
);

-- 4. BẢNG CHẤM CÔNG (Attendance Sessions)
create table if not exists public.attendance_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  date date not null,
  check_in timestamptz,
  check_out timestamptz,
  work_hours numeric(5,2) default 0,
  overtime_hours numeric(5,2) default 0,
  status text default 'present',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 5. BẢNG NGHỈ PHÉP (Leave Ledger & Requests)
create table if not exists public.leave_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  year integer not null,
  annual_leave_quota numeric(4,1) default 12.0,
  used_days numeric(4,1) default 0.0,
  remaining_days numeric(4,1) default 12.0,
  created_at timestamptz default now()
);

create table if not exists public.leave_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  leave_type text not null,
  start_date date not null,
  end_date date not null,
  days_count numeric(4,1) not null,
  reason text,
  status text default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  approver_id uuid references public.profiles(id),
  approved_at timestamptz,
  created_at timestamptz default now()
);

-- 6. BẢNG DANH MỤC LƯƠNG & CẤU HÌNH LƯƠNG (Payroll Engine)
create table if not exists public.payroll_components (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  name text not null,
  type text not null check (type in ('allowance', 'deduction', 'base', 'kpi', 'bonus')),
  formula text,
  is_active boolean default true,
  created_at timestamptz default now()
);

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

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

-- Bật RLS mặc định cho tất cả các bảng
alter table public.organization_units enable row level security;
alter table public.profiles enable row level security;
alter table public.timesheet_periods enable row level security;
alter table public.attendance_sessions enable row level security;
alter table public.leave_ledger enable row level security;
alter table public.leave_requests enable row level security;
alter table public.payroll_components enable row level security;

-- Chính sách RLS mặc định
drop policy if exists "Allow read for authenticated users" on public.profiles;
drop policy if exists profiles_read_direct on public.profiles;
create policy profiles_read_direct on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_admin());
create policy "Allow read for authenticated users" on public.organization_units for select to authenticated using (true);
create policy "Allow read for authenticated users" on public.timesheet_periods for select to authenticated using (true);
create policy "Allow read own attendance" on public.attendance_sessions for select to authenticated using (auth.uid() = user_id);
