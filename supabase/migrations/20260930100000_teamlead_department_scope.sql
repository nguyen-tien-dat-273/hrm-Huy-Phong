-- ============================================================================
-- RC1.2 - Trưởng phòng chỉ thấy nhân viên PHÒNG MÌNH.
-- ----------------------------------------------------------------------------
-- BRD Huy Phong v1.0, RC1.2 (Quan trọng, Giai đoạn 1):
--   "Cấp 2 - Trưởng phòng: quản lý danh sách nhân viên phòng mình, theo dõi
--    ngày công thực tế, giờ vào/ra, đi muộn/về sớm, duyệt đơn từ..."
-- Mục 2A ghi rõ đây là điểm BẮT BUỘC tuỳ chỉnh, không phải cấu hình mặc định
-- của 1Office: "phân quyền theo trường dữ liệu (field-level) - cần dựng ma
-- trận quyền riêng".
--
-- Hiện trạng: `attendance_sessions` cho đọc khi `user_id = auth.uid() or
-- public.can('attendance')`, nghĩa là Trưởng phòng đọc được chấm công của
-- TOÀN CÔNG TY. Giao diện có lọc hay không cũng vô nghĩa - dữ liệu đã nằm
-- trong tay client.
--
-- ⚠️ MỘT ĐIỂM KỸ THUẬT QUYẾT ĐỊNH CẢ MIGRATION NÀY
-- `attendance` và `leave_requests` KHÔNG có policy nào trong thư mục
-- migrations - chúng được tạo thẳng trên Supabase nên tên policy không biết
-- trước. Viết `drop policy if exists <tên đoán>` rồi tạo policy mới sẽ THÊM
-- một policy bên cạnh cái cũ, mà nhiều policy permissive cho SELECT được
-- Postgres gộp bằng phép HOẶC - policy rộng cũ vẫn thắng, và migration vẫn
-- báo thành công. Siết hụt mà tưởng đã siết.
--
-- Nên phải dò `pg_policies` rồi xoá ĐỘNG mọi policy SELECT hiện có, sau đó
-- mới tạo policy mới. Policy `FOR ALL` không tự xoá (xoá là gãy luôn quyền
-- ghi) nhưng được liệt kê ra NOTICE để người chạy biết mà xử lý.
--
-- CỐ Ý CHƯA áp cho `payslips`: RC7 thuộc Giai đoạn tài chính theo Mục 11 của
-- BRD. Hàm đã sẵn sàng, xem ghi chú cuối file.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Phạm vi quản lý của một người
-- ---------------------------------------------------------------------------
-- Là quản lý của nhân sự đích nếu:
--   (a) là quản lý trực tiếp ghi trên hồ sơ nhân sự đó, HOẶC
--   (b) là người phụ trách đơn vị mà nhân sự đó thuộc về, hoặc phụ trách một
--       đơn vị CẤP TRÊN của đơn vị đó.
--
-- Có (b) vì Trưởng phòng phải thấy cả nhân sự của các tổ/bộ phận trực thuộc
-- phòng mình, không chỉ những người treo thẳng vào phòng.
create or replace function public.manages_employee(target_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with recursive target as (
    select p.manager_id, p.unit_id
    from public.profiles p
    where p.id = target_user
  ),
  lineage as (
    select u.id, u.parent_id, u.manager_id, 1 as depth
    from public.organization_units u
    where u.id = (select unit_id from target)
    union all
    select parent.id, parent.parent_id, parent.manager_id, child.depth + 1
    from lineage child
    join public.organization_units parent on parent.id = child.parent_id
    -- Chặn lặp vô hạn nếu cây đơn vị bị tạo thành chu trình.
    where child.depth < 10
  )
  select
    coalesce((select manager_id from target) = auth.uid(), false)
    or exists (select 1 from lineage where lineage.manager_id = auth.uid());
$$;

comment on function public.manages_employee(uuid) is
  'Người đang đăng nhập có phải quản lý của nhân sự này không - quản lý trực tiếp, hoặc phụ trách đơn vị/đơn vị cấp trên. Dùng cho RC1.2.';

revoke all on function public.manages_employee(uuid) from public;
grant execute on function public.manages_employee(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Dọn sạch policy SELECT cũ rồi mới siết
-- ---------------------------------------------------------------------------
do $do$
declare
  v_table text;
  v_policy record;
  v_permission text;
  v_leftover text;
begin
  foreach v_table in array array['attendance', 'attendance_sessions', 'leave_requests', 'daily_assignments']
  loop
    if to_regclass('public.' || v_table) is null then
      continue;
    end if;

    -- Xoá mọi policy CHỈ dành cho SELECT. Policy FOR ALL không đụng tới vì
    -- xoá nó là gãy luôn quyền ghi của bảng.
    for v_policy in
      select policyname from pg_policies
      where schemaname = 'public' and tablename = v_table and cmd = 'SELECT'
    loop
      execute format('drop policy %I on public.%I', v_policy.policyname, v_table);
    end loop;

    -- Policy FOR ALL còn sót sẽ vẫn mở quyền đọc rộng. Không tự xoá, nhưng
    -- phải nói ra để người chạy migration biết mà xử lý.
    select string_agg(policyname, ', ') into v_leftover
    from pg_policies
    where schemaname = 'public' and tablename = v_table and cmd = 'ALL';

    if v_leftover is not null then
      raise notice
        'Bảng %: còn policy FOR ALL (%) vẫn mở quyền đọc rộng. Kiểm tra lại nếu muốn siết triệt để theo RC1.2.',
        v_table, v_leftover;
    end if;

    v_permission := case v_table
      when 'leave_requests' then 'leave'
      else 'attendance'
    end;

    -- Admin/CEO/Kế toán trưởng (Cấp 1) vẫn thấy toàn bộ qua `is_admin()`.
    -- Người có quyền nghiệp vụ nhưng KHÔNG phải Cấp 1 chỉ thấy nhân sự trong
    -- phạm vi quản lý của mình - đúng RC1.2.
    execute format($sql$
      create policy %I on public.%I
      for select to authenticated using (
        user_id = auth.uid()
        or public.is_admin()
        or (public.can(%L) and public.manages_employee(user_id))
      )
    $sql$, v_table || '_read_scoped', v_table, v_permission);
  end loop;
end;
$do$;

-- ---------------------------------------------------------------------------
-- Còn lại cho Giai đoạn tài chính
-- ---------------------------------------------------------------------------
-- Khi phân hệ lương bước vào giai đoạn của nó, mở quyền xem lương theo phòng
-- cho Trưởng phòng bằng cách thêm nhánh dưới đây vào `payslips_read`:
--
--   or (public.can('payroll') and public.manages_employee(user_id))
--
-- Chưa làm ở đây vì RC7 thuộc Giai đoạn tài chính theo Mục 11 của BRD, và mở
-- quyền đọc bảng lương là thay đổi cần khách hàng xác nhận riêng.
