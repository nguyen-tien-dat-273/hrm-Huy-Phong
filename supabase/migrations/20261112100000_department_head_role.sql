-- ============================================================================
-- Vai trò TRƯỞNG PHÒNG (Cấp 2 trong phân quyền 3 cấp).
-- ----------------------------------------------------------------------------
-- Trước đây hệ thống chỉ có bốn vai trò: Nhân viên, Trưởng nhóm, Admin, CEO.
-- Trưởng phòng chỉ tồn tại gián tiếp — được khai là người phụ trách một đơn
-- vị trong Cơ cấu tổ chức (organization_unit_managers) — nên không có mẫu
-- quyền để gán, không có menu riêng, và muốn mở khu quản trị cho họ thì
-- Admin phải tự tay ghép quyền lẻ.
--
-- Phạm vi dữ liệu KHÔNG đến từ vai trò mà đến từ `manages_employee()`: các
-- bảng chấm công, đơn nghỉ, đơn chấm công, giao việc đã lọc theo hàm đó. Vai
-- trò này chỉ làm một việc là mở cửa vào các màn quản trị tương ứng.
--
-- Quyền module cấp sẵn: attendance (duyệt công, giao việc), leave (duyệt đơn
-- bước quản lý). KHÔNG cấp:
--   · users    — là quyền của HR: đọc mọi đơn, duyệt bước HR, sửa hồ sơ.
--   · projects — mở quản lý dự án toàn công ty, không lọc theo phòng.
--   · reports  — báo cáo toàn công ty.
-- Phần KPI của phòng đi theo tuyến quản lý trực tiếp, không cần quyền này.
-- ============================================================================

insert into public.system_access_roles(code, name, description, permissions, is_system, sort_order)
values (
  'truong_phong',
  'Trưởng phòng',
  'Quản lý nhân sự trong phòng mình phụ trách: duyệt ngày công, đơn từ và giao việc. Chỉ thấy dữ liệu của đơn vị mình phụ trách.',
  '{attendance,leave}',
  true,
  25
)
on conflict (code) do update set
  name = excluded.name,
  description = excluded.description,
  is_system = true,
  updated_at = now();
-- Cố ý KHÔNG ghi đè `permissions` khi vai trò đã có: Admin có thể đã chỉnh mẫu
-- quyền trong Cấu hình hệ thống, chạy lại migration không được xoá chỉnh sửa đó.

-- ---------------------------------------------------------------------------
-- Người quản lý có phạm vi hẹp: Trưởng nhóm hoặc Trưởng phòng
-- ---------------------------------------------------------------------------
create or replace function public.is_scoped_manager()
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
      and p.role not in ('admin', 'ceo')
      and (p.role = 'teamlead' or p.access_role_code = 'truong_phong')
  );
$$;

revoke all on function public.is_scoped_manager() from public;
grant execute on function public.is_scoped_manager() to authenticated;

comment on function public.is_scoped_manager() is
  'Người đang đăng nhập là Trưởng nhóm hoặc Trưởng phòng (không phải Admin/CEO) — quyền chỉ có hiệu lực trong phạm vi quản lý của họ.';

-- ---------------------------------------------------------------------------
-- Danh sách nhân sự thuộc phạm vi quản lý — cho ô chọn người ở màn giao việc
-- ---------------------------------------------------------------------------
-- Cùng quy tắc với RLS (`manages_employee`) để danh sách chọn không hiện những
-- người mà RLS sẽ từ chối giao việc.
create or replace function public.my_managed_employee_ids()
returns table (user_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select p.id
  from public.profiles p
  where p.is_active
    and p.id <> auth.uid()
    and public.manages_employee(p.id);
$$;

revoke all on function public.my_managed_employee_ids() from public;
grant execute on function public.my_managed_employee_ids() to authenticated;

-- ---------------------------------------------------------------------------
-- Gỡ quyền GHI cấu hình dùng chung toàn công ty khỏi người quản lý hẹp
-- ---------------------------------------------------------------------------
-- Lịch giờ làm và công chuẩn tháng cho ghi khi `can('attendance')` — đúng cho
-- HR, nhưng quyền `attendance` giờ cũng nằm trong vai trò Trưởng phòng (và đã
-- nằm sẵn ở Trưởng nhóm), tức là họ sửa được giờ làm của cả công ty dù giao
-- diện đã ẩn màn đó. Giữ nguyên với HR, loại riêng hai vai trò này.
drop policy if exists work_schedules_manage on public.work_schedules;
create policy work_schedules_manage on public.work_schedules
for all to authenticated
using (public.can('attendance') and not public.is_scoped_manager())
with check (public.can('attendance') and not public.is_scoped_manager());

drop policy if exists month_standard_days_manage on public.month_standard_days;
create policy month_standard_days_manage on public.month_standard_days
for all to authenticated
using (public.can('attendance') and not public.is_scoped_manager())
with check (public.can('attendance') and not public.is_scoped_manager());

notify pgrst, 'reload schema';
