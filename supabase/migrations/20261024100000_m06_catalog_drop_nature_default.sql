-- ============================================================================
-- M06 — Danh mục khoản lương bỏ "Tính chất" và "Giá trị mặc định".
-- ----------------------------------------------------------------------------
-- Danh mục chỉ khai đầu mục LÀ GÌ: tên, mã, nhóm, loại dòng, nhãn báo cáo.
-- Cách tính và con số cụ thể đặt ở Cơ chế lương, nên hai cột này không còn
-- chỗ dùng:
--   * payroll_components.nature          (Cố định / Biến đổi / Cả hai)
--   * payroll_components.default_amount  (giá trị mặc định)
--   * payroll_component_categories.default_nature
-- Dữ liệu trong ba cột bỏ theo cột. Các hàm đang đọc / ghi chúng được viết lại
-- trước khi bỏ cột.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Kiểm đầu mục: không còn gán tính chất theo nhóm
-- ---------------------------------------------------------------------------
create or replace function public.guard_payroll_component()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if public.payroll_component_used_in_closed_period(old.code) then
      raise exception 'Đầu mục "%" đã phát sinh trong kỳ lương đã chốt — không xoá được, chỉ chuyển Khóa.', old.name
        using errcode = '23514';
    end if;
    return old;
  end if;

  new.code := upper(trim(new.code));
  new.name := trim(new.name);
  if new.name = '' then
    raise exception 'Tên đầu mục không được để trống.' using errcode = '23514';
  end if;
  -- Khoản cộng / trừ luôn thuộc một trong năm nhóm; dòng trung gian thì không bắt buộc.
  if new.category_code is null and new.kind <> 'INFO' then
    new.category_code := case when new.kind = 'DEDUCTION' then 'KHAU_TRU_PHAT' else 'THU_NHAP_BIEN_DOI' end;
  end if;
  if new.category_code is not null
     and not exists (select 1 from public.payroll_component_categories g where g.code = new.category_code) then
    raise exception 'Nhóm "%" không tồn tại.', new.category_code using errcode = '23503';
  end if;
  if (tg_op = 'INSERT' or lower(new.name) is distinct from lower(old.name)) and exists (
    select 1 from public.payroll_components c
    where lower(c.name) = lower(new.name) and c.id <> new.id
  ) then
    raise exception 'Tên đầu mục "%" đã có trong danh mục.', new.name using errcode = '23505';
  end if;
  if (tg_op = 'INSERT' or new.code is distinct from old.code)
     and new.code = any(public.payroll_reserved_formula_names()) then
    raise exception 'Mã "%" trùng tên dữ liệu hệ thống — đặt mã khác.', new.code using errcode = '23514';
  end if;
  -- Khoản người lao động đóng và thuế phải là dòng TRỪ (không thì tổng trừ trên
  -- phiếu bị cộng hai lần); phần doanh nghiệp đóng và thu nhập tính thuế là
  -- dòng TRUNG GIAN.
  if new.report_tag in ('INSURANCE_EMPLOYEE', 'INCOME_TAX') and new.kind <> 'DEDUCTION' then
    raise exception 'Nhãn báo cáo của đầu mục "%" chỉ dùng với loại dòng "Trừ khỏi lương".', new.name
      using errcode = '23514';
  end if;
  if new.report_tag in ('INSURANCE_EMPLOYER', 'TAXABLE_INCOME') and new.kind not in ('INFO', 'EMPLOYER_COST') then
    raise exception 'Nhãn báo cáo của đầu mục "%" chỉ dùng với dòng trung gian.', new.name
      using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and new.code is distinct from old.code then
    if exists (select 1 from public.payslip_lines l where l.code = old.code) then
      raise exception 'Đầu mục "%" đã có trên phiếu lương — không đổi mã được nữa.', old.name using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Danh mục chuẩn (đổi cột trả về nên dựng lại hàm) và nạp danh mục chuẩn
-- ---------------------------------------------------------------------------
drop function if exists public.payroll_standard_catalog();
create function public.payroll_standard_catalog()
returns table (
  std_no integer,
  code text,
  name text,
  category_code text,
  kind text,
  calc_source text,
  taxable boolean,
  insurable boolean,
  is_base boolean,
  sort_order integer,
  note text,
  report_tag text
)
language sql
stable
as $$
  select t.*,
         case t.code when 'INS_EMPLOYEE' then 'INSURANCE_EMPLOYEE' when 'PIT' then 'INCOME_TAX' end::text
  from (values
    (1,  'LUONG_CO_BAN', 'Lương cơ bản / Bậc lương', 'THU_NHAP_CO_DINH', 'INFO', 'ASSIGNED', true, true, true, 10,
         'Mức lương theo hợp đồng/chức danh làm cơ sở tính các khoản lương thời gian.'),
    (2,  'ALLOW_RESPONSIBILITY', 'Trách nhiệm', 'THU_NHAP_CO_DINH', 'EARNING', 'ASSIGNED', true, true, false, 111,
         'Phụ cấp chức vụ hoặc tiền trách nhiệm công việc.'),
    (3,  'PHU_CAP_KHAC', 'Phụ cấp / Trợ cấp khác', 'THU_NHAP_CO_DINH', 'EARNING', 'ASSIGNED', true, false, false, 148,
         'Các khoản phụ cấp cố định theo chính sách công ty (ăn trưa, xăng xe, điện thoại...).'),
    (4,  'BASE_WORK', 'Lương thời gian', 'THU_NHAP_BIEN_DOI', 'EARNING', 'ASSIGNED', true, true, false, 20,
         'Tiền lương tính theo ngày công thực tế làm việc.'),
    (5,  'BASE_LEAVE', 'Lương phép', 'THU_NHAP_BIEN_DOI', 'EARNING', 'ASSIGNED', true, true, false, 21,
         'Tiền lương cho những ngày nghỉ phép năm được hưởng lương.'),
    (6,  'BASE_HOLIDAY', 'Lương nghỉ lễ', 'THU_NHAP_BIEN_DOI', 'EARNING', 'ASSIGNED', true, true, false, 22,
         'Tiền lương cho các ngày nghỉ lễ, Tết theo quy định nhà nước.'),
    (7,  'LUONG_KPI', 'Lương KPI', 'THU_NHAP_BIEN_DOI', 'EARNING', 'ASSIGNED', true, false, false, 200,
         'Khoản thu nhập tính theo kết quả đánh giá KPI thực tế.'),
    (8,  'LUONG_DOANH_SO', 'Lương doanh thu (Lương DT)', 'THU_NHAP_BIEN_DOI', 'EARNING', 'ASSIGNED', true, false, false, 115,
         'Khoản thu nhập hoa hồng tính theo doanh số/doanh thu thực tế.'),
    (9,  'LUONG_DT_CAT_LO', 'Lương doanh thu sau cắt lô (>40% / nhà hàng có PG)', 'THU_NHAP_BIEN_DOI', 'EARNING', 'ASSIGNED', true, false, false, 116,
         'Khoản hoa hồng tính trên doanh số sau khi đã trừ cắt lô (>40% / nhà hàng có PG).'),
    (10, 'LUONG_VAN_CHUYEN', 'Lương vận chuyển', 'THU_NHAP_BIEN_DOI', 'EARNING', 'ASSIGNED', true, false, false, 110,
         'Tiền trả cho đội vận chuyển dựa trên sản lượng (chai, bịch, soạn hàng, gửi xe).'),
    (11, 'PC_CONG_TAC_TINH', 'Phụ cấp công tác tỉnh', 'THU_NHAP_BIEN_DOI', 'EARNING', 'ASSIGNED', true, false, false, 142,
         'Khoản hỗ trợ chi trả cho nhân sự đi thị trường/tỉnh theo ngày thực tế.'),
    (12, 'OT_WEEKDAY', 'Lương OT ngày thường', 'LAM_THEM_GIO', 'EARNING', 'ASSIGNED', true, false, false, 210,
         'Tiền làm thêm giờ vào ngày thường (Hệ số 150%).'),
    (13, 'OT_WEEKEND', 'Lương OT Chủ nhật / Ngày nghỉ', 'LAM_THEM_GIO', 'EARNING', 'ASSIGNED', true, false, false, 220,
         'Tiền làm thêm giờ vào ngày nghỉ hằng tuần/Chủ nhật (Hệ số 200%).'),
    (14, 'OT_HOLIDAY', 'Lương OT Ngày lễ', 'LAM_THEM_GIO', 'EARNING', 'ASSIGNED', true, false, false, 230,
         'Tiền làm thêm giờ vào các ngày Lễ, Tết (Hệ số 300%).'),
    (15, 'CONG_THEM_DEM', 'Lương làm thêm ca đêm', 'LAM_THEM_GIO', 'EARNING', 'ASSIGNED', true, false, false, 240,
         'Tiền phụ cấp/lương cho thời gian làm việc sau 22h.'),
    (16, 'THUONG_DI_SOM', 'Thưởng đi sớm', 'THUONG_PHAT_SINH', 'EARNING', 'ASSIGNED', true, false, false, 300,
         'Thưởng chuyên cần cho nhân sự đi làm sớm/đúng giờ.'),
    (17, 'THUONG_CTKM', 'Thưởng CTKM / Mở mới', 'THUONG_PHAT_SINH', 'EARNING', 'ASSIGNED', true, false, false, 301,
         'Thưởng chương trình khuyến mại hoặc mở điểm bán mới (Khối KD).'),
    (18, 'THUONG_DOANH_SO_VUOT', 'Thưởng doanh số 150%', 'THUONG_PHAT_SINH', 'EARNING', 'ASSIGNED', true, false, false, 302,
         'Thưởng khi hoàn thành vượt mức 150% chỉ tiêu doanh số.'),
    (19, 'THUONG_THANG', 'Thưởng khác / Bổ sung lương', 'THUONG_PHAT_SINH', 'EARNING', 'ASSIGNED', true, false, false, 303,
         'Các khoản thưởng đột xuất, bổ sung lương hoặc bù lương phát sinh trong kỳ.'),
    (20, 'INS_EMPLOYEE', 'BHXH, BHYT, BHTN', 'KHAU_TRU_PHAT', 'DEDUCTION', 'ASSIGNED', false, false, false, 600,
         'Các khoản bảo hiểm bắt buộc do người lao động đóng (8%, 1.5%, 1%).'),
    (21, 'PIT', 'Thuế TNCN', 'KHAU_TRU_PHAT', 'DEDUCTION', 'ASSIGNED', false, false, false, 601,
         'Thuế thu nhập cá nhân tính theo biểu thuế lũy tiến 7 bậc.'),
    (22, 'QUY_CONG_DOAN', 'Trừ 1% nhập quỹ', 'KHAU_TRU_PHAT', 'DEDUCTION', 'ASSIGNED', false, false, false, 900,
         'Quỹ nội bộ trích theo quy định riêng của Huy Phong.'),
    (23, 'ADVANCE', 'Tạm ứng', 'KHAU_TRU_PHAT', 'DEDUCTION', 'ASSIGNED', false, false, false, 620,
         'Trừ số tiền nhân viên đã ứng trước trong kỳ.'),
    (24, 'PHAT_DI_MUON_VE_SOM', 'Phạt đi muộn / Về sớm', 'KHAU_TRU_PHAT', 'DEDUCTION', 'ASSIGNED', false, false, false, 810,
         'Khấu trừ do vi phạm giờ giấc qua máy chấm công.'),
    (25, 'PHAT_BAO_CAO', 'Phạt không thực hiện kế hoạch / Báo cáo', 'KHAU_TRU_PHAT', 'DEDUCTION', 'ASSIGNED', false, false, false, 815,
         'Khấu trừ do lỗi không làm báo cáo ngày hoặc không hoàn thành kế hoạch.'),
    (26, 'PHAT_DI_MUON', 'Phạt đi muộn quá số lần', 'KHAU_TRU_PHAT', 'DEDUCTION', 'ASSIGNED', false, false, false, 820,
         'Khoản phạt bổ sung khi số lần đi muộn vượt ngưỡng quy chế.')
  ) as t(std_no, code, name, category_code, kind, calc_source, taxable, insurable, is_base, sort_order, note);
$$;

grant execute on function public.payroll_standard_catalog() to authenticated;
create or replace function public.seed_standard_payroll_catalog()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted integer;
  v_has_base boolean;
begin
  if auth.uid() is null or not public.can_function('admin.payroll_components') then
    raise exception 'Bạn không có quyền quản lý danh mục khoản lương.' using errcode = '42501';
  end if;

  select exists (select 1 from public.payroll_components where is_base) into v_has_base;

  insert into public.payroll_components (
    code, name, kind, calc_type, taxable, insurable, is_base,
    prorate, sort_order, category_code, calc_source, is_active, is_system, note, report_tag
  )
  select
    s.code, s.name, s.kind, 'FIXED', s.taxable, s.insurable,
    s.is_base and not v_has_base,
    false, s.sort_order, s.category_code, s.calc_source, true,
    s.calc_source = 'ENGINE', s.note, s.report_tag
  from public.payroll_standard_catalog() s
  where not exists (select 1 from public.payroll_components c where c.code = s.code)
    and not exists (select 1 from public.payroll_components c where lower(c.name) = lower(s.name));

  get diagnostics v_inserted = row_count;

  perform public.write_payroll_audit(
    'salary.catalog_seed', 'payroll_component', null,
    format('Khởi tạo danh mục chuẩn: thêm %s khoản', v_inserted),
    null
  );
  return v_inserted;
end;
$$;

revoke all on function public.seed_standard_payroll_catalog() from public;
grant execute on function public.seed_standard_payroll_catalog() to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Dòng trung gian tạo ngay ở màn Cơ chế lương
-- ---------------------------------------------------------------------------
create or replace function public.save_payroll_intermediate(
  p_id uuid,
  p_code text,
  p_name text,
  p_show_on_payslip boolean,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_row public.payroll_components%rowtype;
begin
  if auth.uid() is null
     or not (public.can_function('admin.payroll_schemes') or public.can_function('admin.payroll_components')) then
    raise exception 'Bạn không có quyền thiết lập cơ chế lương.' using errcode = '42501';
  end if;
  if coalesce(trim(p_name), '') = '' then
    raise exception 'Nhập tên dòng trung gian.' using errcode = '23514';
  end if;

  if p_id is null then
    if coalesce(trim(p_code), '') = '' or upper(trim(p_code)) !~ '^[A-Z][A-Z0-9_]*$' then
      raise exception 'Mã dòng trung gian viết hoa không dấu, bắt đầu bằng chữ.' using errcode = '22023';
    end if;
    if exists (select 1 from public.payroll_components where code = upper(trim(p_code))) then
      raise exception 'Mã "%" đã có — đặt mã khác.', upper(trim(p_code)) using errcode = '23505';
    end if;
    insert into public.payroll_components (
      code, name, kind, calc_type, taxable, insurable, is_base, prorate,
      sort_order, category_code, calc_source, is_active, is_system, note, show_on_payslip
    )
    values (
      upper(trim(p_code)), trim(p_name), 'INFO', 'FIXED', false, false, false, false,
      (select coalesce(max(sort_order), 0) + 10 from public.payroll_components), null, 'ASSIGNED',
      true, false, nullif(trim(coalesce(p_note, '')), ''), coalesce(p_show_on_payslip, false)
    )
    returning id into v_id;
    return v_id;
  end if;

  select * into v_row from public.payroll_components where id = p_id for update;
  if v_row.id is null then
    raise exception 'Không tìm thấy dòng trung gian.' using errcode = 'P0002';
  end if;
  if v_row.kind <> 'INFO' then
    raise exception '"%" là khoản lương — sửa ở Danh mục khoản lương.', v_row.name using errcode = '23514';
  end if;
  update public.payroll_components
  set name = trim(p_name),
      show_on_payslip = coalesce(p_show_on_payslip, show_on_payslip),
      note = case when p_note is null then note else nullif(trim(p_note), '') end
  where id = p_id;
  return p_id;
end;
$$;

revoke all on function public.save_payroll_intermediate(uuid, text, text, boolean, text) from public;
grant execute on function public.save_payroll_intermediate(uuid, text, text, boolean, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Bỏ cột (ràng buộc CHECK / NOT NULL của cột đi theo)
-- ---------------------------------------------------------------------------
alter table public.payroll_components drop column if exists nature;
alter table public.payroll_components drop column if exists default_amount;
alter table public.payroll_component_categories drop column if exists default_nature;
