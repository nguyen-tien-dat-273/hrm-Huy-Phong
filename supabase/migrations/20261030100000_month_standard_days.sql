-- ============================================================================
-- Công chuẩn nhập tay theo tháng.
-- ----------------------------------------------------------------------------
-- Công chuẩn mặc định suy từ lịch giờ làm và ngày lễ. Có tháng công ty chốt
-- một con số khác (nghỉ bù, làm bù, quy chế riêng) mà không muốn sửa lịch —
-- HR nhập thẳng con số đó ở Thiết lập giờ làm. Có dòng ở đây thì Bảng công,
-- Báo cáo công và Bảng lương đều dùng nó thay cho số tính từ lịch; xoá dòng
-- là quay về số tính từ lịch.
-- ============================================================================

create table if not exists public.month_standard_days (
  month date primary key check (extract(day from month) = 1),
  standard_days numeric(5, 2) not null check (standard_days > 0 and standard_days <= 31),
  note text,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists month_standard_days_touch on public.month_standard_days;
create trigger month_standard_days_touch
before update on public.month_standard_days
for each row execute function public.touch_payroll_updated_at();

-- Cùng quyền với lịch giờ làm: ai cũng đọc được, người có quyền chấm công sửa.
alter table public.month_standard_days enable row level security;

drop policy if exists month_standard_days_read on public.month_standard_days;
create policy month_standard_days_read on public.month_standard_days
for select to authenticated using (true);

drop policy if exists month_standard_days_manage on public.month_standard_days;
create policy month_standard_days_manage on public.month_standard_days
for all to authenticated
using (public.can('attendance')) with check (public.can('attendance'));

grant select, insert, update, delete on public.month_standard_days to authenticated;

comment on table public.month_standard_days is
  'Công chuẩn nhập tay cho từng tháng, thay cho số tính từ lịch giờ làm và ngày lễ.';
