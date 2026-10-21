-- Cột / bảng tổ chức mà phần KPI đọc tới.
alter table public.organization_units add column if not exists manager_id uuid;
alter table public.organization_units add column if not exists is_active boolean default true;
create table if not exists public.job_positions (
  id uuid primary key default gen_random_uuid(),
  code text, title text, unit_id uuid, is_manager boolean default false, is_active boolean default true
);
