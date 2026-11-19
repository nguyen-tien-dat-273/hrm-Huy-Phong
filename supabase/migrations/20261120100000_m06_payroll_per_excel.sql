-- ============================================================================
-- M06 — Dữ liệu lương dựng lại đúng theo "BANG LUONG GUI HRM.xlsx".
-- ----------------------------------------------------------------------------
-- Rà soát với sheet BL01, BL 02 (kèm bảng kê lương sản phẩm BL 03 ở cột AI–AU)
-- tháng 08/2026. Dữ liệu cũ lệch Excel ở ba chỗ:
--
--   1. Đầu mục: 26 khoản theo tài liệu DMKL + ~20 dòng trung gian tự đặt (Đơn giá
--      ngày, Đơn giá giờ, Lương tính làm thêm giờ, Mức trách nhiệm, Mức miễn thuế
--      theo người, Lương đóng bảo hiểm, BH doanh nghiệp đóng, Số người phụ thuộc,
--      Tỷ lệ đạt doanh số…). Nhiều khoản Excel không có (Tạm ứng, Phụ cấp công tác
--      tỉnh, Lương vận chuyển, ba dòng OT tách riêng, Lương DT sau cắt lô tách khỏi
--      Lương doanh số…), còn cột của Excel lại mang tên khác.
--   2. Tham số: 11 bảng, nhiều mã không công thức nào dùng hoặc bằng 0 (Lương cơ
--      sở, lương tối thiểu vùng, OT kho, hệ số ca đêm, đơn giá chai / bịch, định
--      mức KPI, mức ăn trưa, đơn giá phạt…), tên bảng không theo Excel.
--   3. Nhóm: 5 nhóm của tài liệu, không phải nhóm cột của bảng lương.
--
-- Nay:
--   * Nhóm = tiêu đề cột gộp của Excel: Lương thời gian, Lương nghỉ lễ, Làm thêm,
--     Lương doanh số, Phạt, Thưởng. Cột đơn (Bậc lương, Trách nhiệm, Phụ cấp…) không
--     thuộc nhóm nào.
--   * Đầu mục = đúng các cột của BL01 / BL 02 / BL 03, tên đúng tiêu đề cột, thứ tự
--     theo cột. Thực lĩnh do bảng lương tính (không phải đầu mục).
--   * Bảng tham số mang tên cột Excel có hằng số đó; chỉ giữ hằng số dùng chung.
--     Số riêng từng người (bậc lương, mức trách nhiệm, mức BHXH, 1.000.000 /
--     500.000 miễn thuế, số người phụ thuộc…) nằm trong cơ chế của người đó, đúng
--     như ô Excel của họ.
--   * Bộ mẫu "BL 01" và "BL 02" = công thức theo cột của hai sheet.
--   * Ba sheet phụ thành dòng của người liên quan, số chảy về bảng chính như Excel:
--     CAT LO (số thu → doanh số tính lương → doanh số còn lại = Doanh số thu tiền
--     hàng của BL 03), TÍNH ĐẦU CHAI VẬN CHUYỂN (chai / bịch × đơn giá + gửi xe =
--     Lương DT của người vận chuyển), LÀM THÊM GIỜ KHO (lương cơ bản riêng → lương
--     ngày công → tiền từng loại giờ = Làm thêm của kho / vận chuyển).
--   * Cơ chế 29 người có lương trong BL01 / BL 02, hiệu lực từ 08/2026, khớp theo
--     họ tên. Người chưa khớp được tên thì báo NOTICE — chép bộ mẫu ở Cơ chế lương.
--
-- Hệ thống chưa dùng thật: kỳ lương, phiếu lương, số liệu tháng, điều chỉnh, cơ
-- chế cũ và bộ tham số cũ bị XOÁ HẾT.
--
-- Đã kiểm bằng engine của bảng lương (client/src/lib/payroll.ts) với số chấm
-- công tháng 08 lấy từ chính file Excel: 25/29 người khớp thực lĩnh từng đồng.
-- Bốn người lệch đều do Excel gõ tay riêng tháng 8: Lưu Danh Nhân (+2 ngày phụ
-- cấp) và Trần Xuân Trường (+1 ngày phụ cấp) trong ô Phụ cấp, Hà Thị Thu Trang
-- (+322.000 đầu chai PG trong ô Lương doanh số), Lê Văn Lợi (tháng chuyển thử
-- việc + truy lĩnh tháng 7 trong ô Lương thời gian). Các khoản này nhập qua
-- Điều chỉnh của kỳ, không nằm trong cơ chế.
--
-- LƯU Ý CHẠY: dán nguyên file vào SQL Editor rồi Run một lần.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Đầu mục không bắt buộc thuộc nhóm (cột đơn của bảng lương)
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
  -- Khoản người lao động đóng và thuế phải là dòng TRỪ; thu nhập tính thuế và phần
  -- doanh nghiệp đóng là dòng TRUNG GIAN.
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

comment on table public.payroll_component_categories is
  'Nhóm đầu mục = tiêu đề cột gộp của bảng lương (Lương thời gian, Làm thêm, Phạt…). Đầu mục cột đơn không thuộc nhóm nào.';
comment on column public.payroll_components.category_code is
  'Nhóm (cột gộp của bảng lương). Để trống với cột đơn.';

-- ---------------------------------------------------------------------------
-- 2. Danh mục chuẩn = các cột của bảng lương Excel (nút "Bổ sung đầu mục chuẩn")
-- ---------------------------------------------------------------------------
create or replace function public.payroll_standard_catalog()
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
  select (row_number() over (order by t.sort_order))::integer, t.code, t.name, t.category_code, t.kind,
         'ASSIGNED'::text, t.kind = 'EARNING', false, false, t.sort_order, null::text, t.report_tag
  from (values
    ('BAC_LUONG', 'Bậc lương', 'INFO', null, 10, true, null),
    ('TRACH_NHIEM', 'Trách nhiệm', 'EARNING', null, 20, false, null),
    ('PHU_CAP', 'Phụ cấp', 'EARNING', null, 30, false, null),
    ('KPIS', 'KPIs', 'INFO', null, 40, true, null),
    ('CONG', 'Công', 'INFO', 'LUONG_THOI_GIAN', 50, true, null),
    ('LUONG_THOI_GIAN', 'Lương thời gian', 'EARNING', 'LUONG_THOI_GIAN', 60, false, null),
    ('LUONG_KPI', 'Lương KPI', 'EARNING', null, 70, false, null),
    ('CHAI_XE_MAY', 'Chai xe máy', 'INFO', 'DAU_CHAI', 80, false, null),
    ('TIEN_CHAI_XE_MAY', 'Tiền chai xe máy', 'INFO', 'DAU_CHAI', 90, false, null),
    ('PK_NGOAI_GIO', 'Phụ kiện + ngoài giờ', 'INFO', 'DAU_CHAI', 100, false, null),
    ('TIEN_PK_NGOAI_GIO', 'Tiền phụ kiện + ngoài giờ', 'INFO', 'DAU_CHAI', 110, false, null),
    ('CHAI_O_TO', 'Chai ô tô', 'INFO', 'DAU_CHAI', 120, false, null),
    ('TIEN_CHAI_O_TO', 'Tiền chai ô tô', 'INFO', 'DAU_CHAI', 130, false, null),
    ('BICH_O_TO', 'Bịch ô tô', 'INFO', 'DAU_CHAI', 140, false, null),
    ('TIEN_BICH_O_TO', 'Tiền bịch ô tô', 'INFO', 'DAU_CHAI', 150, false, null),
    ('BICH_CHAI_DIEU_CHUYEN', 'Bịch + chai điều chuyển', 'INFO', 'DAU_CHAI', 160, false, null),
    ('TIEN_DIEU_CHUYEN', 'Tiền điều chuyển và soạn hàng', 'INFO', 'DAU_CHAI', 170, false, null),
    ('SOAN_HANG', 'Soạn hàng SG, ĐN', 'INFO', 'DAU_CHAI', 180, false, null),
    ('TIEN_SOAN_HANG', 'Tiền soạn hàng SG, ĐN', 'INFO', 'DAU_CHAI', 190, false, null),
    ('TIEN_GUI_XE', 'Tiền gửi xe', 'INFO', 'DAU_CHAI', 200, false, null),
    ('LUONG_DT', 'Lương DT', 'EARNING', null, 210, false, null),
    ('LUONG_PHEP', 'Lương phép', 'EARNING', null, 220, false, null),
    ('LAM_NGAY_LE', 'Làm ngày lễ', 'INFO', 'LUONG_NGHI_LE', 230, false, null),
    ('LUONG_NGHI_LE', 'Lương nghỉ lễ', 'EARNING', 'LUONG_NGHI_LE', 240, false, null),
    ('LE_CN', 'Lễ, CN', 'INFO', 'LAM_THEM', 250, false, null),
    ('SAU_22H', 'Sau 22h', 'INFO', 'LAM_THEM', 260, false, null),
    ('LCB_LAM_THEM', 'Lương cơ bản', 'INFO', 'LAM_THEM', 270, false, null),
    ('LUONG_NGAY_CONG', 'Lương ngày công', 'INFO', 'LAM_THEM', 280, false, null),
    ('GIO_TRUC_T7', 'Giờ trực thứ 7', 'INFO', 'LAM_THEM', 290, false, null),
    ('TIEN_TRUC_T7', 'Tiền trực thứ 7', 'INFO', 'LAM_THEM', 300, false, null),
    ('TIEN_GIO_THUONG', 'Tiền làm thêm giờ ngày thường', 'INFO', 'LAM_THEM', 310, false, null),
    ('TIEN_GIO_CN', 'Tiền làm thêm giờ CN', 'INFO', 'LAM_THEM', 320, false, null),
    ('TIEN_GIO_LE', 'Tiền làm thêm giờ ngày lễ', 'INFO', 'LAM_THEM', 330, false, null),
    ('LAM_THEM', 'Làm thêm', 'EARNING', 'LAM_THEM', 340, false, null),
    ('SO_THU_TIEN', 'Số thu tiền', 'INFO', 'LUONG_DOANH_SO', 350, false, null),
    ('GIAM_TRU_SO_THU', 'Giảm trừ số thu', 'INFO', 'LUONG_DOANH_SO', 360, false, null),
    ('DS_TINH_LUONG', 'Doanh số tính lương', 'INFO', 'LUONG_DOANH_SO', 370, false, null),
    ('DT_CAT_LO', 'Doanh thu cắt lô (tính % DS)', 'INFO', 'LUONG_DOANH_SO', 380, true, null),
    ('DS_THU_TIEN_HANG', 'Doanh số thu tiền hàng', 'INFO', 'LUONG_DOANH_SO', 390, true, null),
    ('DOANH_SO_KHOAN', 'Doanh số khoán', 'INFO', 'LUONG_DOANH_SO', 400, true, null),
    ('HE_SO_PT', 'Hệ số %', 'INFO', 'LUONG_DOANH_SO', 410, true, null),
    ('SO_THU_CAT_MA', 'Số thu cắt mã', 'INFO', 'LUONG_DOANH_SO', 420, false, null),
    ('GIAM_TRU_CAT_MA', 'Giảm trừ cắt mã', 'INFO', 'LUONG_DOANH_SO', 430, false, null),
    ('DS_CAT_MA', 'Doanh số cắt mã', 'INFO', 'LUONG_DOANH_SO', 440, false, null),
    ('HE_SO_1PT_CAT_MA', 'Hệ số 1% cắt mã theo HĐ', 'INFO', 'LUONG_DOANH_SO', 450, false, null),
    ('HE_SO_1PT', 'Hệ số 1%', 'INFO', 'LUONG_DOANH_SO', 460, false, null),
    ('HE_SO_1_5PT', 'Hệ số 1.5%', 'INFO', 'LUONG_DOANH_SO', 470, false, null),
    ('HE_SO_3PT', 'Hệ số 3%', 'INFO', 'LUONG_DOANH_SO', 480, false, null),
    ('HE_SO_4PT', 'Hệ số 4%', 'INFO', 'LUONG_DOANH_SO', 490, false, null),
    ('THUONG_DS_150', 'Thưởng DS về 150%', 'INFO', 'LUONG_DOANH_SO', 500, false, null),
    ('LUONG_DOANH_SO', 'Lương doanh số', 'EARNING', 'LUONG_DOANH_SO', 510, false, null),
    ('PHU_CAP_TRACH_NHIEM', 'Phụ cấp / trách nhiệm', 'EARNING', null, 520, false, null),
    ('TRU_CONG_DI_MUON', 'Trừ công đi muộn', 'INFO', 'PHAT', 530, false, null),
    ('PHAT_DI_MUON_KH', 'Đi muộn + ko thực hiện KH', 'DEDUCTION', 'PHAT', 540, false, null),
    ('PHAT_KHAC', 'Khác (quá lần đi muộn)', 'DEDUCTION', 'PHAT', 550, false, null),
    ('PHAT_KO_BC', 'Ko làm BC ngày', 'DEDUCTION', 'PHAT', 560, false, null),
    ('PHAT_CTKM', 'CTKM', 'DEDUCTION', 'PHAT', 570, false, null),
    ('PHAT_DI_MUON_KHAC', 'Đi muộn, khác', 'DEDUCTION', 'PHAT', 580, false, null),
    ('THUONG_DI_SOM_KHAC', 'Đi sớm, khác', 'EARNING', 'THUONG', 590, false, null),
    ('KHAC_THUONG', 'Khác', 'EARNING', 'THUONG', 600, false, null),
    ('BS_LUONG', 'BS Lương', 'EARNING', 'THUONG', 610, false, null),
    ('THUONG_CTKM', 'CTKM / Mở mới', 'EARNING', 'THUONG', 620, false, null),
    ('THUONG_DI_SOM', 'Đi sớm', 'EARNING', 'THUONG', 630, false, null),
    ('BU_LUONG', 'Bù lương', 'EARNING', 'THUONG', 640, false, null),
    ('THUONG_KHAC', 'Thưởng khác', 'EARNING', null, 650, false, null),
    ('PHAT_DI_MUON_QUA_LAN', 'Phạt đi muộn quá số lần', 'DEDUCTION', null, 660, false, null),
    ('TONG_CONG', 'Tổng cộng', 'INFO', null, 670, true, null),
    ('TN_MIEN_THUE', 'TN miễn thuế', 'INFO', null, 680, false, null),
    ('GIAM_TRU', 'Giảm trừ', 'INFO', null, 690, false, null),
    ('TN_TINH_THUE', 'TN tính thuế', 'INFO', null, 700, false, 'TAXABLE_INCOME'),
    ('THUE_TNCN', 'Thuế TNCN', 'DEDUCTION', null, 710, false, 'INCOME_TAX'),
    ('TRU_BHXH', 'Trừ BHXH', 'DEDUCTION', null, 720, false, 'INSURANCE_EMPLOYEE'),
    ('TRU_QUY', 'Trừ 1% nhập quỹ', 'DEDUCTION', null, 730, false, null)
  ) as t(code, name, kind, category_code, sort_order, show_on_payslip, report_tag);
$$;

grant execute on function public.payroll_standard_catalog() to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Dữ liệu
-- ---------------------------------------------------------------------------
do $mig$
declare
  v_tables text[] := array[
    'payslip_lines', 'payslips', 'payroll_runs', 'payroll_adjustments', 'payroll_inputs',
    'payroll_scheme_requests', 'employee_pay_items', 'payroll_scheme_items', 'payroll_schemes',
    'unit_pay_items', 'payslip_layouts', 'payroll_components', 'payroll_component_categories'
  ];
  v_table text;
  v_version uuid;
  v_person record;
  v_user uuid;
  v_hits integer;
  v_missing text[] := '{}';
  v_seeded integer := 0;
  v_without integer;
begin
  -- Tắt trigger chặn sửa kỳ đã chốt / ghi nhật ký trong lúc dọn.
  foreach v_table in array v_tables loop
    if to_regclass('public.' || v_table) is not null then
      execute format('alter table public.%I disable trigger user', v_table);
    end if;
  end loop;
  alter table public.payroll_param_versions disable trigger payroll_param_versions_period_guard;
  alter table public.payroll_param_versions disable trigger payroll_param_versions_audit;

  -- 3.1 Dọn dữ liệu lương cũ
  delete from public.payslip_lines;
  delete from public.payslips;
  if to_regclass('public.payroll_approval_events') is not null then
    delete from public.payroll_approval_events;
  end if;
  delete from public.payroll_runs;
  delete from public.payroll_adjustments;
  delete from public.payroll_inputs;
  if to_regclass('public.payroll_scheme_requests') is not null then
    delete from public.payroll_scheme_requests;
  end if;
  delete from public.employee_pay_items;
  delete from public.payroll_scheme_items;
  delete from public.payroll_schemes;
  delete from public.unit_pay_items;
  delete from public.payslip_layouts;
  delete from public.payroll_components;
  delete from public.payroll_component_categories;
  delete from public.payroll_param_versions;

  -- 3.2 Nhóm = tiêu đề cột gộp của Excel
  insert into public.payroll_component_categories (code, name, allowed_kinds, sort_order)
  values
    ('LUONG_THOI_GIAN', 'Lương thời gian', array['EARNING', 'INFO'], 10),
    ('DAU_CHAI', 'Tính đầu chai vận chuyển', array['INFO'], 15),
    ('LUONG_NGHI_LE', 'Lương nghỉ lễ', array['EARNING', 'INFO'], 20),
    ('LAM_THEM', 'Làm thêm', array['EARNING', 'INFO'], 30),
    ('LUONG_DOANH_SO', 'Lương doanh số', array['EARNING', 'INFO'], 40),
    ('PHAT', 'Phạt', array['DEDUCTION', 'INFO'], 50),
    ('THUONG', 'Thưởng', array['EARNING'], 60)
  ;

  -- 3.3 Đầu mục = cột của BL01 / BL 02 / BL 03
  insert into public.payroll_components (
    code, name, kind, calc_type, taxable, insurable, is_base, prorate, sort_order,
    category_code, calc_source, is_active, is_system, note, report_tag, show_on_payslip
  )
  select s.code, s.name, s.kind, 'FIXED', s.taxable, s.insurable, false, false, s.sort_order,
         s.category_code, 'ASSIGNED', true, false, null, s.report_tag, c.show
  from public.payroll_standard_catalog() s
  join (values
    ('BAC_LUONG', 'Bậc lương', 'INFO', null, 10, true, null),
    ('TRACH_NHIEM', 'Trách nhiệm', 'EARNING', null, 20, false, null),
    ('PHU_CAP', 'Phụ cấp', 'EARNING', null, 30, false, null),
    ('KPIS', 'KPIs', 'INFO', null, 40, true, null),
    ('CONG', 'Công', 'INFO', 'LUONG_THOI_GIAN', 50, true, null),
    ('LUONG_THOI_GIAN', 'Lương thời gian', 'EARNING', 'LUONG_THOI_GIAN', 60, false, null),
    ('LUONG_KPI', 'Lương KPI', 'EARNING', null, 70, false, null),
    ('CHAI_XE_MAY', 'Chai xe máy', 'INFO', 'DAU_CHAI', 80, false, null),
    ('TIEN_CHAI_XE_MAY', 'Tiền chai xe máy', 'INFO', 'DAU_CHAI', 90, false, null),
    ('PK_NGOAI_GIO', 'Phụ kiện + ngoài giờ', 'INFO', 'DAU_CHAI', 100, false, null),
    ('TIEN_PK_NGOAI_GIO', 'Tiền phụ kiện + ngoài giờ', 'INFO', 'DAU_CHAI', 110, false, null),
    ('CHAI_O_TO', 'Chai ô tô', 'INFO', 'DAU_CHAI', 120, false, null),
    ('TIEN_CHAI_O_TO', 'Tiền chai ô tô', 'INFO', 'DAU_CHAI', 130, false, null),
    ('BICH_O_TO', 'Bịch ô tô', 'INFO', 'DAU_CHAI', 140, false, null),
    ('TIEN_BICH_O_TO', 'Tiền bịch ô tô', 'INFO', 'DAU_CHAI', 150, false, null),
    ('BICH_CHAI_DIEU_CHUYEN', 'Bịch + chai điều chuyển', 'INFO', 'DAU_CHAI', 160, false, null),
    ('TIEN_DIEU_CHUYEN', 'Tiền điều chuyển và soạn hàng', 'INFO', 'DAU_CHAI', 170, false, null),
    ('SOAN_HANG', 'Soạn hàng SG, ĐN', 'INFO', 'DAU_CHAI', 180, false, null),
    ('TIEN_SOAN_HANG', 'Tiền soạn hàng SG, ĐN', 'INFO', 'DAU_CHAI', 190, false, null),
    ('TIEN_GUI_XE', 'Tiền gửi xe', 'INFO', 'DAU_CHAI', 200, false, null),
    ('LUONG_DT', 'Lương DT', 'EARNING', null, 210, false, null),
    ('LUONG_PHEP', 'Lương phép', 'EARNING', null, 220, false, null),
    ('LAM_NGAY_LE', 'Làm ngày lễ', 'INFO', 'LUONG_NGHI_LE', 230, false, null),
    ('LUONG_NGHI_LE', 'Lương nghỉ lễ', 'EARNING', 'LUONG_NGHI_LE', 240, false, null),
    ('LE_CN', 'Lễ, CN', 'INFO', 'LAM_THEM', 250, false, null),
    ('SAU_22H', 'Sau 22h', 'INFO', 'LAM_THEM', 260, false, null),
    ('LCB_LAM_THEM', 'Lương cơ bản', 'INFO', 'LAM_THEM', 270, false, null),
    ('LUONG_NGAY_CONG', 'Lương ngày công', 'INFO', 'LAM_THEM', 280, false, null),
    ('GIO_TRUC_T7', 'Giờ trực thứ 7', 'INFO', 'LAM_THEM', 290, false, null),
    ('TIEN_TRUC_T7', 'Tiền trực thứ 7', 'INFO', 'LAM_THEM', 300, false, null),
    ('TIEN_GIO_THUONG', 'Tiền làm thêm giờ ngày thường', 'INFO', 'LAM_THEM', 310, false, null),
    ('TIEN_GIO_CN', 'Tiền làm thêm giờ CN', 'INFO', 'LAM_THEM', 320, false, null),
    ('TIEN_GIO_LE', 'Tiền làm thêm giờ ngày lễ', 'INFO', 'LAM_THEM', 330, false, null),
    ('LAM_THEM', 'Làm thêm', 'EARNING', 'LAM_THEM', 340, false, null),
    ('SO_THU_TIEN', 'Số thu tiền', 'INFO', 'LUONG_DOANH_SO', 350, false, null),
    ('GIAM_TRU_SO_THU', 'Giảm trừ số thu', 'INFO', 'LUONG_DOANH_SO', 360, false, null),
    ('DS_TINH_LUONG', 'Doanh số tính lương', 'INFO', 'LUONG_DOANH_SO', 370, false, null),
    ('DT_CAT_LO', 'Doanh thu cắt lô (tính % DS)', 'INFO', 'LUONG_DOANH_SO', 380, true, null),
    ('DS_THU_TIEN_HANG', 'Doanh số thu tiền hàng', 'INFO', 'LUONG_DOANH_SO', 390, true, null),
    ('DOANH_SO_KHOAN', 'Doanh số khoán', 'INFO', 'LUONG_DOANH_SO', 400, true, null),
    ('HE_SO_PT', 'Hệ số %', 'INFO', 'LUONG_DOANH_SO', 410, true, null),
    ('SO_THU_CAT_MA', 'Số thu cắt mã', 'INFO', 'LUONG_DOANH_SO', 420, false, null),
    ('GIAM_TRU_CAT_MA', 'Giảm trừ cắt mã', 'INFO', 'LUONG_DOANH_SO', 430, false, null),
    ('DS_CAT_MA', 'Doanh số cắt mã', 'INFO', 'LUONG_DOANH_SO', 440, false, null),
    ('HE_SO_1PT_CAT_MA', 'Hệ số 1% cắt mã theo HĐ', 'INFO', 'LUONG_DOANH_SO', 450, false, null),
    ('HE_SO_1PT', 'Hệ số 1%', 'INFO', 'LUONG_DOANH_SO', 460, false, null),
    ('HE_SO_1_5PT', 'Hệ số 1.5%', 'INFO', 'LUONG_DOANH_SO', 470, false, null),
    ('HE_SO_3PT', 'Hệ số 3%', 'INFO', 'LUONG_DOANH_SO', 480, false, null),
    ('HE_SO_4PT', 'Hệ số 4%', 'INFO', 'LUONG_DOANH_SO', 490, false, null),
    ('THUONG_DS_150', 'Thưởng DS về 150%', 'INFO', 'LUONG_DOANH_SO', 500, false, null),
    ('LUONG_DOANH_SO', 'Lương doanh số', 'EARNING', 'LUONG_DOANH_SO', 510, false, null),
    ('PHU_CAP_TRACH_NHIEM', 'Phụ cấp / trách nhiệm', 'EARNING', null, 520, false, null),
    ('TRU_CONG_DI_MUON', 'Trừ công đi muộn', 'INFO', 'PHAT', 530, false, null),
    ('PHAT_DI_MUON_KH', 'Đi muộn + ko thực hiện KH', 'DEDUCTION', 'PHAT', 540, false, null),
    ('PHAT_KHAC', 'Khác (quá lần đi muộn)', 'DEDUCTION', 'PHAT', 550, false, null),
    ('PHAT_KO_BC', 'Ko làm BC ngày', 'DEDUCTION', 'PHAT', 560, false, null),
    ('PHAT_CTKM', 'CTKM', 'DEDUCTION', 'PHAT', 570, false, null),
    ('PHAT_DI_MUON_KHAC', 'Đi muộn, khác', 'DEDUCTION', 'PHAT', 580, false, null),
    ('THUONG_DI_SOM_KHAC', 'Đi sớm, khác', 'EARNING', 'THUONG', 590, false, null),
    ('KHAC_THUONG', 'Khác', 'EARNING', 'THUONG', 600, false, null),
    ('BS_LUONG', 'BS Lương', 'EARNING', 'THUONG', 610, false, null),
    ('THUONG_CTKM', 'CTKM / Mở mới', 'EARNING', 'THUONG', 620, false, null),
    ('THUONG_DI_SOM', 'Đi sớm', 'EARNING', 'THUONG', 630, false, null),
    ('BU_LUONG', 'Bù lương', 'EARNING', 'THUONG', 640, false, null),
    ('THUONG_KHAC', 'Thưởng khác', 'EARNING', null, 650, false, null),
    ('PHAT_DI_MUON_QUA_LAN', 'Phạt đi muộn quá số lần', 'DEDUCTION', null, 660, false, null),
    ('TONG_CONG', 'Tổng cộng', 'INFO', null, 670, true, null),
    ('TN_MIEN_THUE', 'TN miễn thuế', 'INFO', null, 680, false, null),
    ('GIAM_TRU', 'Giảm trừ', 'INFO', null, 690, false, null),
    ('TN_TINH_THUE', 'TN tính thuế', 'INFO', null, 700, false, 'TAXABLE_INCOME'),
    ('THUE_TNCN', 'Thuế TNCN', 'DEDUCTION', null, 710, false, 'INCOME_TAX'),
    ('TRU_BHXH', 'Trừ BHXH', 'DEDUCTION', null, 720, false, 'INSURANCE_EMPLOYEE'),
    ('TRU_QUY', 'Trừ 1% nhập quỹ', 'DEDUCTION', null, 730, false, null)
  ) as c(code, name, kind, category_code, sort_order, show, report_tag) on c.code = s.code;

  -- 3.4 Bộ tham số: một bộ, bảng mang tên cột Excel
  insert into public.payroll_param_versions (
    effective_from, label, standard_work_days, net_rounding_unit, net_rounding_mode, param_tables
  )
  values (
    date '2000-01-01', 'Theo bảng lương BL 01 / BL 02', 23.5, 1000, 'NEAREST',
    $json$
  [
    {
      "id": "xl_phu_cap",
      "kind": "LIST",
      "name": "Phụ cấp",
      "note": null,
      "params": [
        {
          "code": "PHU_CAP_THEO_CONG",
          "name": "Phụ cấp theo công",
          "type": "MONEY",
          "unit": "VND_NGAY",
          "value": 50000,
          "note": null
        }
      ]
    },
    {
      "id": "xl_dau_chai",
      "kind": "LIST",
      "name": "Tính đầu chai vận chuyển",
      "note": null,
      "params": [
        {
          "code": "DG_CHAI_XE_MAY",
          "name": "Đơn giá chai xe máy",
          "type": "MONEY",
          "unit": "VND_SP",
          "value": 700,
          "note": null
        },
        {
          "code": "DG_BICH_XE_MAY",
          "name": "Đơn giá bịch xe máy",
          "type": "MONEY",
          "unit": "VND_SP",
          "value": 1000,
          "note": null
        },
        {
          "code": "DG_CHAI_O_TO",
          "name": "Đơn giá chai ô tô",
          "type": "MONEY",
          "unit": "VND_SP",
          "value": 350,
          "note": null
        },
        {
          "code": "DG_BICH_O_TO",
          "name": "Đơn giá bịch ô tô",
          "type": "MONEY",
          "unit": "VND_SP",
          "value": 500,
          "note": null
        },
        {
          "code": "DG_VC_KHO",
          "name": "Đơn giá VC từ k15-k18 và đi tỉnh",
          "type": "MONEY",
          "unit": "VND_SP",
          "value": 200,
          "note": null
        }
      ]
    },
    {
      "id": "xl_nghi_le",
      "kind": "LIST",
      "name": "Lương nghỉ lễ",
      "note": null,
      "params": [
        {
          "code": "HS_LAM_NGAY_LE",
          "name": "Hệ số làm ngày lễ",
          "type": "RATE",
          "unit": "HE_SO",
          "value": 3,
          "note": null
        }
      ]
    },
    {
      "id": "xl_lam_them",
      "kind": "LIST",
      "name": "Làm thêm",
      "note": null,
      "params": [
        {
          "code": "HS_LE_CN",
          "name": "Hệ số Lễ, CN",
          "type": "RATE",
          "unit": "HE_SO",
          "value": 1.5,
          "note": null
        },
        {
          "code": "HS_SAU_22H",
          "name": "Hệ số Sau 22h",
          "type": "RATE",
          "unit": "HE_SO",
          "value": 1,
          "note": null
        },
        {
          "code": "HS_GIO_THUONG",
          "name": "Hệ số làm thêm giờ ngày thường",
          "type": "RATE",
          "unit": "HE_SO",
          "value": 1,
          "note": null
        },
        {
          "code": "HS_GIO_CN",
          "name": "Hệ số làm thêm giờ CN",
          "type": "RATE",
          "unit": "HE_SO",
          "value": 1.5,
          "note": null
        },
        {
          "code": "HS_GIO_LE",
          "name": "Hệ số làm thêm giờ ngày lễ",
          "type": "RATE",
          "unit": "HE_SO",
          "value": 2,
          "note": null
        }
      ]
    },
    {
      "id": "xl_doanh_so",
      "kind": "LIST",
      "name": "Lương doanh số",
      "note": null,
      "params": [
        {
          "code": "MOC_75",
          "name": "Mốc 75%",
          "type": "RATE",
          "unit": "%",
          "value": 75,
          "note": null
        },
        {
          "code": "MOC_90",
          "name": "Mốc 90%",
          "type": "RATE",
          "unit": "%",
          "value": 90,
          "note": null
        },
        {
          "code": "MOC_105",
          "name": "Mốc 105%",
          "type": "RATE",
          "unit": "%",
          "value": 105,
          "note": null
        },
        {
          "code": "MOC_150",
          "name": "Mốc 150%",
          "type": "RATE",
          "unit": "%",
          "value": 150,
          "note": null
        },
        {
          "code": "TL_CAT_MA",
          "name": "Tỷ lệ cắt mã theo HĐ",
          "type": "RATE",
          "unit": "%",
          "value": 1,
          "note": null
        },
        {
          "code": "TL_CAT_LO",
          "name": "Tỷ lệ doanh thu cắt lô",
          "type": "RATE",
          "unit": "%",
          "value": 1,
          "note": null
        },
        {
          "code": "TL_MOC_75",
          "name": "Tỷ lệ mốc 75%",
          "type": "RATE",
          "unit": "%",
          "value": 1.5,
          "note": null
        },
        {
          "code": "TL_MOC_90",
          "name": "Tỷ lệ mốc 90%",
          "type": "RATE",
          "unit": "%",
          "value": 3,
          "note": null
        },
        {
          "code": "TL_MOC_105",
          "name": "Tỷ lệ mốc 105%",
          "type": "RATE",
          "unit": "%",
          "value": 4,
          "note": null
        },
        {
          "code": "TL_THUONG_150",
          "name": "Thưởng về 150% (phần bậc lương)",
          "type": "RATE",
          "unit": "%",
          "value": 50,
          "note": null
        }
      ]
    },
    {
      "id": "xl_mien_thue",
      "kind": "LIST",
      "name": "TN miễn thuế",
      "note": null,
      "params": [
        {
          "code": "MIEN_THUE_THEO_CONG",
          "name": "Mức theo công",
          "type": "MONEY",
          "unit": "VND_THANG",
          "value": 1500000,
          "note": null
        },
        {
          "code": "MIEN_THUE_TOI_DA",
          "name": "Mức tối đa",
          "type": "MONEY",
          "unit": "VND_THANG",
          "value": 1200000,
          "note": null
        }
      ]
    },
    {
      "id": "xl_giam_tru",
      "kind": "LIST",
      "name": "Giảm trừ",
      "note": null,
      "params": [
        {
          "code": "GIAM_TRU_BAN_THAN",
          "name": "Bản thân",
          "type": "MONEY",
          "unit": "VND_THANG",
          "value": 15500000,
          "note": null
        },
        {
          "code": "GIAM_TRU_NPT",
          "name": "NPT",
          "type": "MONEY",
          "unit": "VND_THANG",
          "value": 6200000,
          "note": null
        }
      ]
    },
    {
      "id": "xl_thue_tncn",
      "kind": "TIER",
      "name": "Thuế TNCN",
      "note": null,
      "code": "BIEU_THUE_TNCN",
      "mode": "PROGRESSIVE",
      "input_label": "TN tính thuế",
      "unit": "%",
      "rows": [
        {
          "from": 0,
          "value": 5
        },
        {
          "from": 10000000,
          "value": 10
        },
        {
          "from": 30000000,
          "value": 20
        },
        {
          "from": 60000000,
          "value": 30
        },
        {
          "from": 100000000,
          "value": 35
        }
      ]
    },
    {
      "id": "xl_tru_bhxh",
      "kind": "LIST",
      "name": "Trừ BHXH",
      "note": null,
      "params": [
        {
          "code": "TY_LE_TRU_BHXH",
          "name": "Tỷ lệ trừ BHXH",
          "type": "RATE",
          "unit": "%",
          "value": 10.5,
          "note": null
        }
      ]
    },
    {
      "id": "xl_tru_quy",
      "kind": "LIST",
      "name": "Trừ 1% nhập quỹ",
      "note": null,
      "params": [
        {
          "code": "TY_LE_NHAP_QUY",
          "name": "Tỷ lệ nhập quỹ",
          "type": "RATE",
          "unit": "%",
          "value": 1,
          "note": null
        }
      ]
    }
  ]
    $json$::jsonb
  )
  returning id into v_version;

  -- 3.5 Bộ mẫu BL 01 / BL 02
  create temp table _xl_rows (owner text, code text, mode text, formula text, amount numeric, sort_order integer) on commit drop;
  insert into _xl_rows values
    ('BL 01', 'BAC_LUONG', 'PER_PERSON', null, null, 10),
    ('BL 01', 'TRACH_NHIEM', 'PER_PERSON', null, null, 20),
    ('BL 01', 'PHU_CAP', 'PER_PERSON', null, null, 30),
    ('BL 01', 'KPIS', 'FORMULA', 'TY_LE_KPI', null, 40),
    ('BL 01', 'CONG', 'FORMULA', 'WORK_DAYS', null, 50),
    ('BL 01', 'LUONG_THOI_GIAN', 'FORMULA', 'BAC_LUONG / STANDARD_DAYS * CONG', null, 60),
    ('BL 01', 'LUONG_DT', 'MONTHLY_INPUT', null, null, 210),
    ('BL 01', 'LUONG_PHEP', 'FORMULA', 'BAC_LUONG / STANDARD_DAYS * LEAVE_DAYS', null, 220),
    ('BL 01', 'LUONG_NGHI_LE', 'FORMULA', 'BAC_LUONG / STANDARD_DAYS * HOLIDAY_DAYS', null, 240),
    ('BL 01', 'LE_CN', 'FORMULA', '(OT_WEEKEND_HOURS + OT_HOLIDAY_HOURS) / HOURS_PER_DAY', null, 250),
    ('BL 01', 'SAU_22H', 'MONTHLY_INPUT', null, null, 260),
    ('BL 01', 'LAM_THEM', 'FORMULA', '(LE_CN * HS_LE_CN + SAU_22H * HS_SAU_22H) * BAC_LUONG / STANDARD_DAYS', null, 340),
    ('BL 01', 'TRU_CONG_DI_MUON', 'MONTHLY_INPUT', null, null, 530),
    ('BL 01', 'PHAT_DI_MUON_KH', 'MONTHLY_INPUT', null, null, 540),
    ('BL 01', 'PHAT_KHAC', 'FORMULA', 'TRU_CONG_DI_MUON * BAC_LUONG / STANDARD_DAYS', null, 550),
    ('BL 01', 'THUONG_DI_SOM_KHAC', 'MONTHLY_INPUT', null, null, 590),
    ('BL 01', 'KHAC_THUONG', 'MONTHLY_INPUT', null, null, 600),
    ('BL 01', 'BS_LUONG', 'MONTHLY_INPUT', null, null, 610),
    ('BL 01', 'PHAT_DI_MUON_QUA_LAN', 'MONTHLY_INPUT', null, null, 660),
    ('BL 01', 'TONG_CONG', 'FORMULA', 'TONG_THU_NHAP - PHAT_DI_MUON_KH - PHAT_KHAC - PHAT_DI_MUON_QUA_LAN', null, 670),
    ('BL 01', 'TN_MIEN_THUE', 'FORMULA', '1000000 / STANDARD_DAYS * (CONG + HOLIDAY_DAYS + LEAVE_DAYS) + MIN(MIEN_THUE_TOI_DA, MIEN_THUE_THEO_CONG / STANDARD_DAYS * (CONG + HOLIDAY_DAYS + LEAVE_DAYS))', null, 680),
    ('BL 01', 'GIAM_TRU', 'VALUE', null, 0, 690),
    ('BL 01', 'TN_TINH_THUE', 'FORMULA', 'MAX(TONG_CONG - TN_MIEN_THUE - GIAM_TRU - TRU_BHXH - GIAM_TRU_BAN_THAN, 0)', null, 700),
    ('BL 01', 'THUE_TNCN', 'FORMULA', 'BIEU_THUE_TNCN(TN_TINH_THUE)', null, 710),
    ('BL 01', 'TRU_BHXH', 'FORMULA', 'BAC_LUONG * TY_LE_TRU_BHXH', null, 720),
    ('BL 01', 'TRU_QUY', 'FORMULA', '(LUONG_THOI_GIAN + LUONG_DT) * TY_LE_NHAP_QUY', null, 730),
    ('BL 02', 'BAC_LUONG', 'PER_PERSON', null, null, 10),
    ('BL 02', 'KPIS', 'FORMULA', 'TY_LE_KPI', null, 40),
    ('BL 02', 'CONG', 'FORMULA', 'WORK_DAYS', null, 50),
    ('BL 02', 'LUONG_THOI_GIAN', 'FORMULA', 'BAC_LUONG / STANDARD_DAYS * CONG', null, 60),
    ('BL 02', 'LUONG_KPI', 'FORMULA', 'BAC_LUONG / 3 * KPIS', null, 70),
    ('BL 02', 'LUONG_PHEP', 'FORMULA', 'BAC_LUONG / STANDARD_DAYS * LEAVE_DAYS', null, 220),
    ('BL 02', 'LAM_NGAY_LE', 'FORMULA', 'OT_HOLIDAY_HOURS / HOURS_PER_DAY', null, 230),
    ('BL 02', 'LUONG_NGHI_LE', 'FORMULA', 'BAC_LUONG / STANDARD_DAYS * HOLIDAY_DAYS + BAC_LUONG / STANDARD_DAYS * LAM_NGAY_LE * HS_LAM_NGAY_LE', null, 240),
    ('BL 02', 'SO_THU_TIEN', 'MONTHLY_INPUT', null, null, 350),
    ('BL 02', 'GIAM_TRU_SO_THU', 'MONTHLY_INPUT', null, null, 360),
    ('BL 02', 'DS_TINH_LUONG', 'FORMULA', 'SO_THU_TIEN - GIAM_TRU_SO_THU', null, 370),
    ('BL 02', 'DT_CAT_LO', 'MONTHLY_INPUT', null, null, 380),
    ('BL 02', 'DS_THU_TIEN_HANG', 'FORMULA', 'DS_TINH_LUONG - DT_CAT_LO', null, 390),
    ('BL 02', 'DOANH_SO_KHOAN', 'MONTHLY_INPUT', null, null, 400),
    ('BL 02', 'HE_SO_PT', 'FORMULA', 'IF(DOANH_SO_KHOAN > 0, (DT_CAT_LO + DS_THU_TIEN_HANG) / DOANH_SO_KHOAN, 0)', null, 410),
    ('BL 02', 'SO_THU_CAT_MA', 'MONTHLY_INPUT', null, null, 420),
    ('BL 02', 'GIAM_TRU_CAT_MA', 'MONTHLY_INPUT', null, null, 430),
    ('BL 02', 'DS_CAT_MA', 'FORMULA', 'SO_THU_CAT_MA - GIAM_TRU_CAT_MA', null, 440),
    ('BL 02', 'HE_SO_1PT_CAT_MA', 'FORMULA', 'DS_CAT_MA * TL_CAT_MA', null, 450),
    ('BL 02', 'HE_SO_1PT', 'FORMULA', 'IF(HE_SO_PT < MOC_75, 0, DT_CAT_LO * TL_CAT_LO)', null, 460),
    ('BL 02', 'HE_SO_1_5PT', 'FORMULA', 'IF(HE_SO_PT >= MOC_75 && HE_SO_PT < MOC_90, DS_THU_TIEN_HANG * TL_MOC_75, 0)', null, 470),
    ('BL 02', 'HE_SO_3PT', 'FORMULA', 'IF(HE_SO_PT >= MOC_90 && HE_SO_PT < MOC_105, DS_THU_TIEN_HANG * TL_MOC_90, 0)', null, 480),
    ('BL 02', 'HE_SO_4PT', 'FORMULA', 'IF(HE_SO_PT >= MOC_105, DS_THU_TIEN_HANG * TL_MOC_105, 0)', null, 490),
    ('BL 02', 'THUONG_DS_150', 'FORMULA', 'IF(HE_SO_PT >= MOC_150, BAC_LUONG * TL_THUONG_150, 0)', null, 500),
    ('BL 02', 'LUONG_DOANH_SO', 'FORMULA', 'HE_SO_1PT_CAT_MA + HE_SO_1PT + HE_SO_1_5PT + HE_SO_3PT + HE_SO_4PT + THUONG_DS_150', null, 510),
    ('BL 02', 'PHU_CAP_TRACH_NHIEM', 'PER_PERSON', null, null, 520),
    ('BL 02', 'TRU_CONG_DI_MUON', 'MONTHLY_INPUT', null, null, 530),
    ('BL 02', 'PHAT_KO_BC', 'MONTHLY_INPUT', null, null, 560),
    ('BL 02', 'PHAT_CTKM', 'MONTHLY_INPUT', null, null, 570),
    ('BL 02', 'PHAT_DI_MUON_KHAC', 'MONTHLY_INPUT', null, null, 580),
    ('BL 02', 'THUONG_CTKM', 'MONTHLY_INPUT', null, null, 620),
    ('BL 02', 'THUONG_DI_SOM', 'MONTHLY_INPUT', null, null, 630),
    ('BL 02', 'BU_LUONG', 'MONTHLY_INPUT', null, null, 640),
    ('BL 02', 'THUONG_KHAC', 'MONTHLY_INPUT', null, null, 650),
    ('BL 02', 'PHAT_DI_MUON_QUA_LAN', 'FORMULA', 'TRU_CONG_DI_MUON * BAC_LUONG / STANDARD_DAYS', null, 660),
    ('BL 02', 'TONG_CONG', 'FORMULA', 'TONG_THU_NHAP - PHAT_KO_BC - PHAT_CTKM - PHAT_DI_MUON_KHAC - PHAT_DI_MUON_QUA_LAN', null, 670),
    ('BL 02', 'TN_MIEN_THUE', 'FORMULA', '1000000 / STANDARD_DAYS * (CONG + HOLIDAY_DAYS + LEAVE_DAYS) + MIN(MIEN_THUE_TOI_DA, MIEN_THUE_THEO_CONG / STANDARD_DAYS * (CONG + HOLIDAY_DAYS + LEAVE_DAYS))', null, 680),
    ('BL 02', 'GIAM_TRU', 'VALUE', null, 0, 690),
    ('BL 02', 'TN_TINH_THUE', 'FORMULA', 'MAX(TONG_CONG - TN_MIEN_THUE - GIAM_TRU - TRU_BHXH - GIAM_TRU_BAN_THAN, 0)', null, 700),
    ('BL 02', 'THUE_TNCN', 'FORMULA', 'BIEU_THUE_TNCN(TN_TINH_THUE)', null, 710),
    ('BL 02', 'TRU_BHXH', 'FORMULA', 'BAC_LUONG * TY_LE_TRU_BHXH', null, 720),
    ('BL 02', 'TRU_QUY', 'FORMULA', '(LUONG_THOI_GIAN + LUONG_DOANH_SO) * TY_LE_NHAP_QUY', null, 730)
  ;
  insert into public.payroll_schemes (name) select distinct owner from _xl_rows;
  insert into public.payroll_scheme_items (scheme_id, component_id, mode, formula, amount, sort_order)
  select s.id, c.id, r.mode, r.formula, r.amount, r.sort_order
  from _xl_rows r
  join public.payroll_schemes s on s.name = r.owner
  join public.payroll_components c on c.code = r.code;

  -- 3.6 Cơ chế từng người (theo ô Excel của họ), hiệu lực từ 08/2026
  create temp table _xl_people (name text, sheet text) on commit drop;
  insert into _xl_people values
    ('Lưu Vũ Phong', 'BL 01'),
    ('Bùi Thị Nhân Huệ', 'BL 01'),
    ('Đàm Minh Nghĩa', 'BL 01'),
    ('Lưu Thị Vượng', 'BL 01'),
    ('Nguyễn Thị Kim Dung', 'BL 01'),
    ('Phạm Thị Thùy Dương', 'BL 01'),
    ('Nguyễn Thị Mùi', 'BL 01'),
    ('Lê Diệu Linh', 'BL 01'),
    ('Nguyễn Đức Minh', 'BL 01'),
    ('Phạm Phi Hùng', 'BL 01'),
    ('Phạm Văn Hoa', 'BL 01'),
    ('Lê Thu Hà', 'BL 01'),
    ('Trần Thu Hường', 'BL 01'),
    ('Lưu Danh Nhân', 'BL 01'),
    ('Trần Xuân Trường', 'BL 01'),
    ('Nguyễn Tuấn Đạt', 'BL 01'),
    ('Lưu Tiến Đức', 'BL 01'),
    ('Nguyễn Thị Mai Anh', 'BL 01'),
    ('Mai Cẩm Tú', 'BL 01'),
    ('Nguyễn Thị Hồng Nhung', 'BL 01'),
    ('Hà Thị Thu Trang', 'BL 02'),
    ('Nguyễn Minh Tảo', 'BL 02'),
    ('Lê Văn Lợi', 'BL 02'),
    ('Hồ Linh Chi', 'BL 02'),
    ('Nguyễn Huỳnh Đức', 'BL 02'),
    ('Vũ Thị Hòa', 'BL 02'),
    ('Vũ Thị Thanh Thúy', 'BL 02'),
    ('Lương Xuân Tùng', 'BL 02'),
    ('Scarpello Maurizio', 'BL 02')
  ;
  delete from _xl_rows;
  insert into _xl_rows values
    ('Lưu Vũ Phong', 'BAC_LUONG', 'VALUE', null, 10000000, 10),
    ('Lưu Vũ Phong', 'TRACH_NHIEM', 'VALUE', null, 10000000, 20),
    ('Lưu Vũ Phong', 'CONG', 'FORMULA', 'STANDARD_DAYS - HOLIDAY_DAYS', null, 50),
    ('Lưu Vũ Phong', 'LUONG_THOI_GIAN', 'FORMULA', 'BAC_LUONG / STANDARD_DAYS * CONG', null, 60),
    ('Lưu Vũ Phong', 'LUONG_DT', 'MONTHLY_INPUT', null, null, 210),
    ('Lưu Vũ Phong', 'LUONG_PHEP', 'FORMULA', 'BAC_LUONG / STANDARD_DAYS * LEAVE_DAYS', null, 220),
    ('Lưu Vũ Phong', 'LUONG_NGHI_LE', 'FORMULA', 'BAC_LUONG / STANDARD_DAYS * HOLIDAY_DAYS', null, 240),
    ('Lưu Vũ Phong', 'LE_CN', 'FORMULA', '(OT_WEEKEND_HOURS + OT_HOLIDAY_HOURS) / HOURS_PER_DAY', null, 250),
    ('Lưu Vũ Phong', 'SAU_22H', 'MONTHLY_INPUT', null, null, 260),
    ('Lưu Vũ Phong', 'LAM_THEM', 'FORMULA', '(LE_CN * HS_LE_CN + SAU_22H * HS_SAU_22H) * BAC_LUONG / STANDARD_DAYS', null, 340),
    ('Lưu Vũ Phong', 'TRU_CONG_DI_MUON', 'MONTHLY_INPUT', null, null, 530),
    ('Lưu Vũ Phong', 'PHAT_DI_MUON_KH', 'MONTHLY_INPUT', null, null, 540),
    ('Lưu Vũ Phong', 'PHAT_KHAC', 'FORMULA', 'TRU_CONG_DI_MUON * BAC_LUONG / STANDARD_DAYS', null, 550),
    ('Lưu Vũ Phong', 'THUONG_DI_SOM_KHAC', 'MONTHLY_INPUT', null, null, 590),
    ('Lưu Vũ Phong', 'KHAC_THUONG', 'MONTHLY_INPUT', null, null, 600),
    ('Lưu Vũ Phong', 'BS_LUONG', 'MONTHLY_INPUT', null, null, 610),
    ('Lưu Vũ Phong', 'PHAT_DI_MUON_QUA_LAN', 'MONTHLY_INPUT', null, null, 660),
    ('Lưu Vũ Phong', 'TONG_CONG', 'FORMULA', 'TONG_THU_NHAP - PHAT_DI_MUON_KH - PHAT_KHAC - PHAT_DI_MUON_QUA_LAN', null, 670),
    ('Lưu Vũ Phong', 'TN_MIEN_THUE', 'FORMULA', '1000000 / STANDARD_DAYS * (CONG + HOLIDAY_DAYS + LEAVE_DAYS) + MIN(MIEN_THUE_TOI_DA, MIEN_THUE_THEO_CONG / STANDARD_DAYS * (CONG + HOLIDAY_DAYS + LEAVE_DAYS))', null, 680),
    ('Lưu Vũ Phong', 'GIAM_TRU', 'VALUE', null, 0, 690),
    ('Lưu Vũ Phong', 'TN_TINH_THUE', 'FORMULA', 'MAX(TONG_CONG - TN_MIEN_THUE - GIAM_TRU - TRU_BHXH - GIAM_TRU_BAN_THAN, 0)', null, 700),
    ('Lưu Vũ Phong', 'THUE_TNCN', 'FORMULA', 'BIEU_THUE_TNCN(TN_TINH_THUE) + 30000', null, 710),
    ('Lưu Vũ Phong', 'TRU_BHXH', 'FORMULA', '25000000 * TY_LE_TRU_BHXH', null, 720),
    ('Lưu Vũ Phong', 'TRU_QUY', 'FORMULA', '(LUONG_THOI_GIAN + LUONG_DT) * TY_LE_NHAP_QUY', null, 730),
    ('Bùi Thị Nhân Huệ', 'BAC_LUONG', 'VALUE', null, 10000000, 10),
    ('Bùi Thị Nhân Huệ', 'TRACH_NHIEM', 'VALUE', null, 10000000, 20),
    ('Bùi Thị Nhân Huệ', 'CONG', 'FORMULA', 'STANDARD_DAYS - HOLIDAY_DAYS', null, 50),
    ('Bùi Thị Nhân Huệ', 'LUONG_THOI_GIAN', 'FORMULA', 'BAC_LUONG / STANDARD_DAYS * CONG', null, 60),
    ('Bùi Thị Nhân Huệ', 'LUONG_DT', 'MONTHLY_INPUT', null, null, 210),
    ('Bùi Thị Nhân Huệ', 'LUONG_PHEP', 'FORMULA', 'BAC_LUONG / STANDARD_DAYS * LEAVE_DAYS', null, 220),
    ('Bùi Thị Nhân Huệ', 'LUONG_NGHI_LE', 'FORMULA', 'BAC_LUONG / STANDARD_DAYS * HOLIDAY_DAYS', null, 240),
    ('Bùi Thị Nhân Huệ', 'LE_CN', 'FORMULA', '(OT_WEEKEND_HOURS + OT_HOLIDAY_HOURS) / HOURS_PER_DAY', null, 250),
    ('Bùi Thị Nhân Huệ', 'SAU_22H', 'MONTHLY_INPUT', null, null, 260),
    ('Bùi Thị Nhân Huệ', 'LAM_THEM', 'FORMULA', '(LE_CN * HS_LE_CN + SAU_22H * HS_SAU_22H) * BAC_LUONG / STANDARD_DAYS', null, 340),
    ('Bùi Thị Nhân Huệ', 'TRU_CONG_DI_MUON', 'MONTHLY_INPUT', null, null, 530),
    ('Bùi Thị Nhân Huệ', 'PHAT_DI_MUON_KH', 'MONTHLY_INPUT', null, null, 540),
    ('Bùi Thị Nhân Huệ', 'PHAT_KHAC', 'FORMULA', 'TRU_CONG_DI_MUON * BAC_LUONG / STANDARD_DAYS', null, 550),
    ('Bùi Thị Nhân Huệ', 'THUONG_DI_SOM_KHAC', 'MONTHLY_INPUT', null, null, 590),
    ('Bùi Thị Nhân Huệ', 'KHAC_THUONG', 'MONTHLY_INPUT', null, null, 600),
    ('Bùi Thị Nhân Huệ', 'BS_LUONG', 'MONTHLY_INPUT', null, null, 610),
    ('Bùi Thị Nhân Huệ', 'PHAT_DI_MUON_QUA_LAN', 'MONTHLY_INPUT', null, null, 660),
    ('Bùi Thị Nhân Huệ', 'TONG_CONG', 'FORMULA', 'TONG_THU_NHAP - PHAT_DI_MUON_KH - PHAT_KHAC - PHAT_DI_MUON_QUA_LAN', null, 670),
    ('Bùi Thị Nhân Huệ', 'TN_MIEN_THUE', 'FORMULA', '1000000 / STANDARD_DAYS * (CONG + HOLIDAY_DAYS + LEAVE_DAYS) + MIN(MIEN_THUE_TOI_DA, MIEN_THUE_THEO_CONG / STANDARD_DAYS * (CONG + HOLIDAY_DAYS + LEAVE_DAYS))', null, 680),
    ('Bùi Thị Nhân Huệ', 'GIAM_TRU', 'VALUE', null, 0, 690),
    ('Bùi Thị Nhân Huệ', 'TN_TINH_THUE', 'FORMULA', 'MAX(TONG_CONG - TN_MIEN_THUE - GIAM_TRU - TRU_BHXH - GIAM_TRU_BAN_THAN, 0)', null, 700),
    ('Bùi Thị Nhân Huệ', 'THUE_TNCN', 'FORMULA', 'BIEU_THUE_TNCN(TN_TINH_THUE) + 30000', null, 710),
    ('Bùi Thị Nhân Huệ', 'TRU_BHXH', 'FORMULA', '20000000 * TY_LE_TRU_BHXH', null, 720),
    ('Bùi Thị Nhân Huệ', 'TRU_QUY', 'FORMULA', '(LUONG_THOI_GIAN + LUONG_DT) * TY_LE_NHAP_QUY', null, 730),
    ('Đàm Minh Nghĩa', 'BAC_LUONG', 'VALUE', null, 10000000, 10),
    ('Đàm Minh Nghĩa', 'TRACH_NHIEM', 'FORMULA', '5000000 * KPIS', null, 20),
    ('Đàm Minh Nghĩa', 'KPIS', 'FORMULA', 'TY_LE_KPI', null, 40),
    ('Đàm Minh Nghĩa', 'CONG', 'FORMULA', 'STANDARD_DAYS - HOLIDAY_DAYS', null, 50),
    ('Đàm Minh Nghĩa', 'LUONG_THOI_GIAN', 'FORMULA', 'BAC_LUONG / STANDARD_DAYS * CONG', null, 60),
    ('Đàm Minh Nghĩa', 'LUONG_DT', 'MONTHLY_INPUT', null, null, 210),
    ('Đàm Minh Nghĩa', 'LUONG_PHEP', 'FORMULA', 'BAC_LUONG / STANDARD_DAYS * LEAVE_DAYS', null, 220),
    ('Đàm Minh Nghĩa', 'LUONG_NGHI_LE', 'FORMULA', 'BAC_LUONG / STANDARD_DAYS * HOLIDAY_DAYS', null, 240),
    ('Đàm Minh Nghĩa', 'LE_CN', 'FORMULA', '(OT_WEEKEND_HOURS + OT_HOLIDAY_HOURS) / HOURS_PER_DAY', null, 250),
    ('Đàm Minh Nghĩa', 'SAU_22H', 'MONTHLY_INPUT', null, null, 260),
    ('Đàm Minh Nghĩa', 'LAM_THEM', 'FORMULA', '(LE_CN * HS_LE_CN + SAU_22H * HS_SAU_22H) * BAC_LUONG / STANDARD_DAYS', null, 340),
    ('Đàm Minh Nghĩa', 'TRU_CONG_DI_MUON', 'MONTHLY_INPUT', null, null, 530),
    ('Đàm Minh Nghĩa', 'PHAT_DI_MUON_KH', 'MONTHLY_INPUT', null, null, 540),
    ('Đàm Minh Nghĩa', 'PHAT_KHAC', 'FORMULA', 'TRU_CONG_DI_MUON * BAC_LUONG / STANDARD_DAYS', null, 550),
    ('Đàm Minh Nghĩa', 'THUONG_DI_SOM_KHAC', 'MONTHLY_INPUT', null, null, 590),
    ('Đàm Minh Nghĩa', 'KHAC_THUONG', 'MONTHLY_INPUT', null, null, 600),
    ('Đàm Minh Nghĩa', 'BS_LUONG', 'MONTHLY_INPUT', null, null, 610),
    ('Đàm Minh Nghĩa', 'PHAT_DI_MUON_QUA_LAN', 'MONTHLY_INPUT', null, null, 660),
    ('Đàm Minh Nghĩa', 'TONG_CONG', 'FORMULA', 'TONG_THU_NHAP - PHAT_DI_MUON_KH - PHAT_KHAC - PHAT_DI_MUON_QUA_LAN', null, 670),
    ('Đàm Minh Nghĩa', 'TN_MIEN_THUE', 'FORMULA', '1000000 / STANDARD_DAYS * (CONG + HOLIDAY_DAYS + LEAVE_DAYS) + MIN(MIEN_THUE_TOI_DA, MIEN_THUE_THEO_CONG / STANDARD_DAYS * (CONG + HOLIDAY_DAYS + LEAVE_DAYS))', null, 680),
    ('Đàm Minh Nghĩa', 'GIAM_TRU', 'FORMULA', '2 * GIAM_TRU_NPT', null, 690),
    ('Đàm Minh Nghĩa', 'TN_TINH_THUE', 'FORMULA', 'MAX(TONG_CONG - TN_MIEN_THUE - GIAM_TRU - TRU_BHXH - GIAM_TRU_BAN_THAN, 0)', null, 700),
    ('Đàm Minh Nghĩa', 'THUE_TNCN', 'FORMULA', 'BIEU_THUE_TNCN(TN_TINH_THUE)', null, 710),
    ('Đàm Minh Nghĩa', 'TRU_QUY', 'FORMULA', '(LUONG_THOI_GIAN + LUONG_DT) * TY_LE_NHAP_QUY', null, 730),
    ('Lưu Thị Vượng', 'BAC_LUONG', 'VALUE', null, 10000000, 10),
    ('Lưu Thị Vượng', 'TRACH_NHIEM', 'FORMULA', '5000000 * KPIS', null, 20),
    ('Lưu Thị Vượng', 'KPIS', 'FORMULA', 'TY_LE_KPI', null, 40),
    ('Lưu Thị Vượng', 'CONG', 'FORMULA', 'WORK_DAYS', null, 50),
    ('Lưu Thị Vượng', 'LUONG_THOI_GIAN', 'FORMULA', 'BAC_LUONG / STANDARD_DAYS * CONG', null, 60),
    ('Lưu Thị Vượng', 'LUONG_DT', 'MONTHLY_INPUT', null, null, 210),
    ('Lưu Thị Vượng', 'LUONG_PHEP', 'FORMULA', 'BAC_LUONG / STANDARD_DAYS * LEAVE_DAYS', null, 220),
    ('Lưu Thị Vượng', 'LUONG_NGHI_LE', 'FORMULA', 'BAC_LUONG / STANDARD_DAYS * HOLIDAY_DAYS', null, 240),
    ('Lưu Thị Vượng', 'LE_CN', 'FORMULA', '(OT_WEEKEND_HOURS + OT_HOLIDAY_HOURS) / HOURS_PER_DAY', null, 250),
    ('Lưu Thị Vượng', 'SAU_22H', 'MONTHLY_INPUT', null, null, 260),
    ('Lưu Thị Vượng', 'LAM_THEM', 'FORMULA', '(LE_CN * HS_LE_CN + SAU_22H * HS_SAU_22H) * BAC_LUONG / STANDARD_DAYS', null, 340),
    ('Lưu Thị Vượng', 'TRU_CONG_DI_MUON', 'MONTHLY_INPUT', null, null, 530),
    ('Lưu Thị Vượng', 'PHAT_DI_MUON_KH', 'MONTHLY_INPUT', null, null, 540),
    ('Lưu Thị Vượng', 'PHAT_KHAC', 'FORMULA', 'TRU_CONG_DI_MUON * BAC_LUONG / STANDARD_DAYS', null, 550),
    ('Lưu Thị Vượng', 'THUONG_DI_SOM_KHAC', 'MONTHLY_INPUT', null, null, 590),
    ('Lưu Thị Vượng', 'KHAC_THUONG', 'MONTHLY_INPUT', null, null, 600),
    ('Lưu Thị Vượng', 'BS_LUONG', 'MONTHLY_INPUT', null, null, 610),
    ('Lưu Thị Vượng', 'PHAT_DI_MUON_QUA_LAN', 'MONTHLY_INPUT', null, null, 660),
    ('Lưu Thị Vượng', 'TONG_CONG', 'FORMULA', 'TONG_THU_NHAP - PHAT_DI_MUON_KH - PHAT_KHAC - PHAT_DI_MUON_QUA_LAN', null, 670),
    ('Lưu Thị Vượng', 'TN_MIEN_THUE', 'FORMULA', '1000000 / STANDARD_DAYS * (CONG + HOLIDAY_DAYS + LEAVE_DAYS) + MIN(MIEN_THUE_TOI_DA, MIEN_THUE_THEO_CONG / STANDARD_DAYS * (CONG + HOLIDAY_DAYS + LEAVE_DAYS))', null, 680),
    ('Lưu Thị Vượng', 'GIAM_TRU', 'FORMULA', '3 * GIAM_TRU_NPT', null, 690),
    ('Lưu Thị Vượng', 'TN_TINH_THUE', 'FORMULA', 'MAX(TONG_CONG - TN_MIEN_THUE - GIAM_TRU - TRU_BHXH - GIAM_TRU_BAN_THAN, 0)', null, 700),
    ('Lưu Thị Vượng', 'THUE_TNCN', 'FORMULA', 'BIEU_THUE_TNCN(TN_TINH_THUE)', null, 710),
    ('Lưu Thị Vượng', 'TRU_BHXH', 'FORMULA', '20000000 * TY_LE_TRU_BHXH', null, 720),
    ('Lưu Thị Vượng', 'TRU_QUY', 'FORMULA', '(LUONG_THOI_GIAN + LUONG_DT) * TY_LE_NHAP_QUY', null, 730),
    ('Nguyễn Thị Kim Dung', 'BAC_LUONG', 'VALUE', null, 10000000, 10),
    ('Nguyễn Thị Kim Dung', 'TRACH_NHIEM', 'FORMULA', '2000000 * KPIS', null, 20),
    ('Nguyễn Thị Kim Dung', 'KPIS', 'FORMULA', 'TY_LE_KPI', null, 40),
    ('Nguyễn Thị Kim Dung', 'CONG', 'FORMULA', 'WORK_DAYS', null, 50),
    ('Nguyễn Thị Kim Dung', 'LUONG_THOI_GIAN', 'FORMULA', 'BAC_LUONG / STANDARD_DAYS * CONG', null, 60),
    ('Nguyễn Thị Kim Dung', 'LUONG_DT', 'MONTHLY_INPUT', null, null, 210),
    ('Nguyễn Thị Kim Dung', 'LUONG_PHEP', 'FORMULA', 'BAC_LUONG / STANDARD_DAYS * LEAVE_DAYS', null, 220),
    ('Nguyễn Thị Kim Dung', 'LUONG_NGHI_LE', 'FORMULA', 'BAC_LUONG / STANDARD_DAYS * HOLIDAY_DAYS', null, 240),
    ('Nguyễn Thị Kim Dung', 'LE_CN', 'FORMULA', '(OT_WEEKEND_HOURS + OT_HOLIDAY_HOURS) / HOURS_PER_DAY', null, 250),
    ('Nguyễn Thị Kim Dung', 'SAU_22H', 'MONTHLY_INPUT', null, null, 260),
    ('Nguyễn Thị Kim Dung', 'LAM_THEM', 'FORMULA', '(LE_CN * HS_LE_CN + SAU_22H * HS_SAU_22H) * BAC_LUONG / STANDARD_DAYS', null, 340),
    ('Nguyễn Thị Kim Dung', 'TRU_CONG_DI_MUON', 'MONTHLY_INPUT', null, null, 530),
    ('Nguyễn Thị Kim Dung', 'PHAT_DI_MUON_KH', 'MONTHLY_INPUT', null, null, 540),
    ('Nguyễn Thị Kim Dung', 'PHAT_KHAC', 'FORMULA', 'TRU_CONG_DI_MUON * BAC_LUONG / STANDARD_DAYS', null, 550),
    ('Nguyễn Thị Kim Dung', 'THUONG_DI_SOM_KHAC', 'MONTHLY_INPUT', null, null, 590),
    ('Nguyễn Thị Kim Dung', 'KHAC_THUONG', 'MONTHLY_INPUT', null, null, 600),
    ('Nguyễn Thị Kim Dung', 'BS_LUONG', 'MONTHLY_INPUT', null, null, 610),
    ('Nguyễn Thị Kim Dung', 'PHAT_DI_MUON_QUA_LAN', 'MONTHLY_INPUT', null, null, 660),
    ('Nguyễn Thị Kim Dung', 'TONG_CONG', 'FORMULA', 'TONG_THU_NHAP - PHAT_DI_MUON_KH - PHAT_KHAC - PHAT_DI_MUON_QUA_LAN', null, 670),
    ('Nguyễn Thị Kim Dung', 'TN_MIEN_THUE', 'FORMULA', '500000 / STANDARD_DAYS * (CONG + HOLIDAY_DAYS + LEAVE_DAYS) + MIN(MIEN_THUE_TOI_DA, MIEN_THUE_THEO_CONG / STANDARD_DAYS * (CONG + HOLIDAY_DAYS + LEAVE_DAYS))', null, 680),
    ('Nguyễn Thị Kim Dung', 'GIAM_TRU', 'VALUE', null, 0, 690),
    ('Nguyễn Thị Kim Dung', 'TN_TINH_THUE', 'FORMULA', 'MAX(TONG_CONG - TN_MIEN_THUE - GIAM_TRU - TRU_BHXH - GIAM_TRU_BAN_THAN, 0)', null, 700),
    ('Nguyễn Thị Kim Dung', 'THUE_TNCN', 'FORMULA', 'BIEU_THUE_TNCN(TN_TINH_THUE)', null, 710),
    ('Nguyễn Thị Kim Dung', 'TRU_BHXH', 'FORMULA', '7500000 * TY_LE_TRU_BHXH', null, 720),
    ('Nguyễn Thị Kim Dung', 'TRU_QUY', 'FORMULA', '(LUONG_THOI_GIAN + LUONG_DT) * TY_LE_NHAP_QUY', null, 730),
    ('Phạm Thị Thùy Dương', 'BAC_LUONG', 'VALUE', null, 8000000, 10),
    ('Phạm Thị Thùy Dương', 'TRACH_NHIEM', 'FORMULA', '3000000 * KPIS', null, 20),
    ('Phạm Thị Thùy Dương', 'KPIS', 'FORMULA', 'TY_LE_KPI', null, 40),
    ('Phạm Thị Thùy Dương', 'CONG', 'FORMULA', 'WORK_DAYS', null, 50),
    ('Phạm Thị Thùy Dương', 'LUONG_THOI_GIAN', 'FORMULA', 'BAC_LUONG / STANDARD_DAYS * CONG', null, 60),
    ('Phạm Thị Thùy Dương', 'LUONG_DT', 'MONTHLY_INPUT', null, null, 210),
    ('Phạm Thị Thùy Dương', 'LUONG_PHEP', 'FORMULA', 'BAC_LUONG / STANDARD_DAYS * LEAVE_DAYS', null, 220),
    ('Phạm Thị Thùy Dương', 'LUONG_NGHI_LE', 'FORMULA', 'BAC_LUONG / STANDARD_DAYS * HOLIDAY_DAYS', null, 240),
    ('Phạm Thị Thùy Dương', 'LE_CN', 'FORMULA', '(OT_WEEKEND_HOURS + OT_HOLIDAY_HOURS) / HOURS_PER_DAY', null, 250),
    ('Phạm Thị Thùy Dương', 'SAU_22H', 'MONTHLY_INPUT', null, null, 260),
    ('Phạm Thị Thùy Dương', 'LAM_THEM', 'FORMULA', '(LE_CN * HS_LE_CN + SAU_22H * HS_SAU_22H) * BAC_LUONG / STANDARD_DAYS', null, 340),
    ('Phạm Thị Thùy Dương', 'TRU_CONG_DI_MUON', 'MONTHLY_INPUT', null, null, 530),
    ('Phạm Thị Thùy Dương', 'PHAT_DI_MUON_KH', 'MONTHLY_INPUT', null, null, 540),
    ('Phạm Thị Thùy Dương', 'PHAT_KHAC', 'FORMULA', 'TRU_CONG_DI_MUON * BAC_LUONG / STANDARD_DAYS', null, 550),
    ('Phạm Thị Thùy Dương', 'THUONG_DI_SOM_KHAC', 'MONTHLY_INPUT', null, null, 590),
    ('Phạm Thị Thùy Dương', 'KHAC_THUONG', 'MONTHLY_INPUT', null, null, 600),
    ('Phạm Thị Thùy Dương', 'BS_LUONG', 'MONTHLY_INPUT', null, null, 610),
    ('Phạm Thị Thùy Dương', 'PHAT_DI_MUON_QUA_LAN', 'MONTHLY_INPUT', null, null, 660),
    ('Phạm Thị Thùy Dương', 'TONG_CONG', 'FORMULA', 'TONG_THU_NHAP - PHAT_DI_MUON_KH - PHAT_KHAC - PHAT_DI_MUON_QUA_LAN', null, 670),
    ('Phạm Thị Thùy Dương', 'TN_MIEN_THUE', 'FORMULA', '500000 / STANDARD_DAYS * (CONG + HOLIDAY_DAYS + LEAVE_DAYS) + MIN(MIEN_THUE_TOI_DA, MIEN_THUE_THEO_CONG / STANDARD_DAYS * (CONG + HOLIDAY_DAYS + LEAVE_DAYS))', null, 680),
    ('Phạm Thị Thùy Dương', 'GIAM_TRU', 'FORMULA', '1 * GIAM_TRU_NPT', null, 690),
    ('Phạm Thị Thùy Dương', 'TN_TINH_THUE', 'FORMULA', 'MAX(TONG_CONG - TN_MIEN_THUE - GIAM_TRU - TRU_BHXH - GIAM_TRU_BAN_THAN, 0)', null, 700),
    ('Phạm Thị Thùy Dương', 'THUE_TNCN', 'FORMULA', 'BIEU_THUE_TNCN(TN_TINH_THUE)', null, 710),
    ('Phạm Thị Thùy Dương', 'TRU_BHXH', 'FORMULA', '7500000 * TY_LE_TRU_BHXH', null, 720),
    ('Phạm Thị Thùy Dương', 'TRU_QUY', 'FORMULA', '(LUONG_THOI_GIAN + LUONG_DT) * TY_LE_NHAP_QUY', null, 730),
    ('Nguyễn Thị Mùi', 'BAC_LUONG', 'VALUE', null, 8000000, 10),
    ('Nguyễn Thị Mùi', 'TRACH_NHIEM', 'FORMULA', '3000000 * KPIS', null, 20),
    ('Nguyễn Thị Mùi', 'PHU_CAP', 'VALUE', null, 500000, 30),
    ('Nguyễn Thị Mùi', 'KPIS', 'FORMULA', 'TY_LE_KPI', null, 40),
    ('Nguyễn Thị Mùi', 'CONG', 'FORMULA', 'WORK_DAYS', null, 50),
    ('Nguyễn Thị Mùi', 'LUONG_THOI_GIAN', 'FORMULA', 'BAC_LUONG / STANDARD_DAYS * CONG', null, 60),
    ('Nguyễn Thị Mùi', 'LUONG_DT', 'MONTHLY_INPUT', null, null, 210),
    ('Nguyễn Thị Mùi', 'LUONG_PHEP', 'FORMULA', 'BAC_LUONG / STANDARD_DAYS * LEAVE_DAYS', null, 220),
    ('Nguyễn Thị Mùi', 'LUONG_NGHI_LE', 'FORMULA', 'BAC_LUONG / STANDARD_DAYS * HOLIDAY_DAYS', null, 240),
    ('Nguyễn Thị Mùi', 'LE_CN', 'FORMULA', '(OT_WEEKEND_HOURS + OT_HOLIDAY_HOURS) / HOURS_PER_DAY', null, 250),
    ('Nguyễn Thị Mùi', 'SAU_22H', 'MONTHLY_INPUT', null, null, 260),
    ('Nguyễn Thị Mùi', 'LAM_THEM', 'FORMULA', '(LE_CN * HS_LE_CN + SAU_22H * HS_SAU_22H) * BAC_LUONG / STANDARD_DAYS', null, 340),
    ('Nguyễn Thị Mùi', 'TRU_CONG_DI_MUON', 'MONTHLY_INPUT', null, null, 530),
    ('Nguyễn Thị Mùi', 'PHAT_DI_MUON_KH', 'MONTHLY_INPUT', null, null, 540),
    ('Nguyễn Thị Mùi', 'PHAT_KHAC', 'FORMULA', 'TRU_CONG_DI_MUON * BAC_LUONG / STANDARD_DAYS', null, 550),
    ('Nguyễn Thị Mùi', 'THUONG_DI_SOM_KHAC', 'MONTHLY_INPUT', null, null, 590),
    ('Nguyễn Thị Mùi', 'KHAC_THUONG', 'MONTHLY_INPUT', null, null, 600),
    ('Nguyễn Thị Mùi', 'BS_LUONG', 'MONTHLY_INPUT', null, null, 610),
    ('Nguyễn Thị Mùi', 'PHAT_DI_MUON_QUA_LAN', 'MONTHLY_INPUT', null, null, 660),
    ('Nguyễn Thị Mùi', 'TONG_CONG', 'FORMULA', 'TONG_THU_NHAP - PHAT_DI_MUON_KH - PHAT_KHAC - PHAT_DI_MUON_QUA_LAN', null, 670),
    ('Nguyễn Thị Mùi', 'TN_MIEN_THUE', 'FORMULA', '1000000 / STANDARD_DAYS * (CONG + HOLIDAY_DAYS + LEAVE_DAYS) + MIN(MIEN_THUE_TOI_DA, MIEN_THUE_THEO_CONG / STANDARD_DAYS * (CONG + HOLIDAY_DAYS + LEAVE_DAYS))', null, 680),
    ('Nguyễn Thị Mùi', 'GIAM_TRU', 'FORMULA', '2 * GIAM_TRU_NPT', null, 690),
    ('Nguyễn Thị Mùi', 'TN_TINH_THUE', 'FORMULA', 'MAX(TONG_CONG - TN_MIEN_THUE - GIAM_TRU - TRU_BHXH - GIAM_TRU_BAN_THAN, 0)', null, 700),
    ('Nguyễn Thị Mùi', 'THUE_TNCN', 'FORMULA', 'BIEU_THUE_TNCN(TN_TINH_THUE)', null, 710),
    ('Nguyễn Thị Mùi', 'TRU_BHXH', 'FORMULA', '8000000 * TY_LE_TRU_BHXH', null, 720),
    ('Nguyễn Thị Mùi', 'TRU_QUY', 'FORMULA', '(LUONG_THOI_GIAN + LUONG_DT) * TY_LE_NHAP_QUY', null, 730),
    ('Lê Diệu Linh', 'BAC_LUONG', 'VALUE', null, 8000000, 10),
    ('Lê Diệu Linh', 'TRACH_NHIEM', 'FORMULA', '3000000 * KPIS', null, 20),
    ('Lê Diệu Linh', 'PHU_CAP', 'VALUE', null, 500000, 30),
    ('Lê Diệu Linh', 'KPIS', 'FORMULA', 'TY_LE_KPI', null, 40),
    ('Lê Diệu Linh', 'CONG', 'FORMULA', 'WORK_DAYS', null, 50),
    ('Lê Diệu Linh', 'LUONG_THOI_GIAN', 'FORMULA', 'BAC_LUONG / STANDARD_DAYS * CONG', null, 60),
    ('Lê Diệu Linh', 'LUONG_DT', 'MONTHLY_INPUT', null, null, 210),
    ('Lê Diệu Linh', 'LUONG_PHEP', 'FORMULA', 'BAC_LUONG / STANDARD_DAYS * LEAVE_DAYS', null, 220),
    ('Lê Diệu Linh', 'LUONG_NGHI_LE', 'FORMULA', 'BAC_LUONG / STANDARD_DAYS * HOLIDAY_DAYS', null, 240),
    ('Lê Diệu Linh', 'LE_CN', 'FORMULA', '(OT_WEEKEND_HOURS + OT_HOLIDAY_HOURS) / HOURS_PER_DAY', null, 250),
    ('Lê Diệu Linh', 'SAU_22H', 'MONTHLY_INPUT', null, null, 260),
    ('Lê Diệu Linh', 'LAM_THEM', 'FORMULA', '(LE_CN * HS_LE_CN + SAU_22H * HS_SAU_22H) * BAC_LUONG / STANDARD_DAYS', null, 340),
    ('Lê Diệu Linh', 'TRU_CONG_DI_MUON', 'MONTHLY_INPUT', null, null, 530),
    ('Lê Diệu Linh', 'PHAT_DI_MUON_KH', 'MONTHLY_INPUT', null, null, 540),
    ('Lê Diệu Linh', 'PHAT_KHAC', 'FORMULA', 'TRU_CONG_DI_MUON * BAC_LUONG / STANDARD_DAYS', null, 550),
    ('Lê Diệu Linh', 'THUONG_DI_SOM_KHAC', 'MONTHLY_INPUT', null, null, 590),
    ('Lê Diệu Linh', 'KHAC_THUONG', 'MONTHLY_INPUT', null, null, 600),
    ('Lê Diệu Linh', 'BS_LUONG', 'MONTHLY_INPUT', null, null, 610),
    ('Lê Diệu Linh', 'PHAT_DI_MUON_QUA_LAN', 'MONTHLY_INPUT', null, null, 660),
    ('Lê Diệu Linh', 'TONG_CONG', 'FORMULA', 'TONG_THU_NHAP - PHAT_DI_MUON_KH - PHAT_KHAC - PHAT_DI_MUON_QUA_LAN', null, 670),
    ('Lê Diệu Linh', 'TN_MIEN_THUE', 'FORMULA', '1000000 / STANDARD_DAYS * (CONG + HOLIDAY_DAYS + LEAVE_DAYS) + MIN(MIEN_THUE_TOI_DA, MIEN_THUE_THEO_CONG / STANDARD_DAYS * (CONG + HOLIDAY_DAYS + LEAVE_DAYS))', null, 680),
    ('Lê Diệu Linh', 'GIAM_TRU', 'VALUE', null, 0, 690),
    ('Lê Diệu Linh', 'TN_TINH_THUE', 'FORMULA', 'MAX(TONG_CONG - TN_MIEN_THUE - GIAM_TRU - TRU_BHXH - GIAM_TRU_BAN_THAN, 0)', null, 700),
    ('Lê Diệu Linh', 'THUE_TNCN', 'FORMULA', 'BIEU_THUE_TNCN(TN_TINH_THUE)', null, 710),
    ('Lê Diệu Linh', 'TRU_BHXH', 'FORMULA', '6600000 * TY_LE_TRU_BHXH', null, 720),
    ('Lê Diệu Linh', 'TRU_QUY', 'FORMULA', '(LUONG_THOI_GIAN + LUONG_DT) * TY_LE_NHAP_QUY', null, 730),
    ('Nguyễn Đức Minh', 'BAC_LUONG', 'VALUE', null, 8000000, 10),
    ('Nguyễn Đức Minh', 'TRACH_NHIEM', 'FORMULA', '5000000 * KPIS', null, 20),
    ('Nguyễn Đức Minh', 'KPIS', 'FORMULA', 'TY_LE_KPI', null, 40),
    ('Nguyễn Đức Minh', 'CONG', 'FORMULA', 'WORK_DAYS', null, 50),
    ('Nguyễn Đức Minh', 'LUONG_THOI_GIAN', 'FORMULA', 'BAC_LUONG / STANDARD_DAYS * CONG', null, 60),
    ('Nguyễn Đức Minh', 'LUONG_DT', 'MONTHLY_INPUT', null, null, 210),
    ('Nguyễn Đức Minh', 'LUONG_PHEP', 'FORMULA', 'BAC_LUONG / STANDARD_DAYS * LEAVE_DAYS', null, 220),
    ('Nguyễn Đức Minh', 'LUONG_NGHI_LE', 'FORMULA', 'BAC_LUONG / STANDARD_DAYS * HOLIDAY_DAYS', null, 240),
    ('Nguyễn Đức Minh', 'LE_CN', 'FORMULA', '(OT_WEEKEND_HOURS + OT_HOLIDAY_HOURS) / HOURS_PER_DAY', null, 250),
    ('Nguyễn Đức Minh', 'SAU_22H', 'MONTHLY_INPUT', null, null, 260),
    ('Nguyễn Đức Minh', 'LAM_THEM', 'FORMULA', '(LE_CN * HS_LE_CN + SAU_22H * HS_SAU_22H) * BAC_LUONG / STANDARD_DAYS', null, 340),
    ('Nguyễn Đức Minh', 'TRU_CONG_DI_MUON', 'MONTHLY_INPUT', null, null, 530),
    ('Nguyễn Đức Minh', 'PHAT_DI_MUON_KH', 'MONTHLY_INPUT', null, null, 540),
    ('Nguyễn Đức Minh', 'PHAT_KHAC', 'FORMULA', 'TRU_CONG_DI_MUON * BAC_LUONG / STANDARD_DAYS', null, 550),
    ('Nguyễn Đức Minh', 'THUONG_DI_SOM_KHAC', 'MONTHLY_INPUT', null, null, 590),
    ('Nguyễn Đức Minh', 'KHAC_THUONG', 'MONTHLY_INPUT', null, null, 600),
    ('Nguyễn Đức Minh', 'BS_LUONG', 'MONTHLY_INPUT', null, null, 610),
    ('Nguyễn Đức Minh', 'PHAT_DI_MUON_QUA_LAN', 'MONTHLY_INPUT', null, null, 660),
    ('Nguyễn Đức Minh', 'TONG_CONG', 'FORMULA', 'TONG_THU_NHAP - PHAT_DI_MUON_KH - PHAT_KHAC - PHAT_DI_MUON_QUA_LAN', null, 670),
    ('Nguyễn Đức Minh', 'TN_MIEN_THUE', 'FORMULA', '500000 / STANDARD_DAYS * (CONG + HOLIDAY_DAYS + LEAVE_DAYS) + MIN(MIEN_THUE_TOI_DA, MIEN_THUE_THEO_CONG / STANDARD_DAYS * (CONG + HOLIDAY_DAYS + LEAVE_DAYS))', null, 680),
    ('Nguyễn Đức Minh', 'GIAM_TRU', 'VALUE', null, 0, 690),
    ('Nguyễn Đức Minh', 'TN_TINH_THUE', 'FORMULA', 'MAX(TONG_CONG - TN_MIEN_THUE - GIAM_TRU - TRU_BHXH - GIAM_TRU_BAN_THAN, 0)', null, 700),
    ('Nguyễn Đức Minh', 'THUE_TNCN', 'FORMULA', 'BIEU_THUE_TNCN(TN_TINH_THUE)', null, 710),
    ('Nguyễn Đức Minh', 'TRU_QUY', 'FORMULA', '(LUONG_THOI_GIAN + LUONG_DT) * TY_LE_NHAP_QUY', null, 730),
    ('Phạm Phi Hùng', 'BAC_LUONG', 'VALUE', null, 8000000, 10),
    ('Phạm Phi Hùng', 'TRACH_NHIEM', 'FORMULA', '3000000 * KPIS', null, 20),
    ('Phạm Phi Hùng', 'PHU_CAP', 'FORMULA', 'CONG * PHU_CAP_THEO_CONG', null, 30),
    ('Phạm Phi Hùng', 'KPIS', 'FORMULA', 'TY_LE_KPI', null, 40),
    ('Phạm Phi Hùng', 'CONG', 'FORMULA', 'STANDARD_DAYS - HOLIDAY_DAYS - LEAVE_DAYS', null, 50),
    ('Phạm Phi Hùng', 'LUONG_THOI_GIAN', 'FORMULA', 'BAC_LUONG / STANDARD_DAYS * CONG', null, 60),
    ('Phạm Phi Hùng', 'CHAI_XE_MAY', 'MONTHLY_INPUT', null, null, 80),
    ('Phạm Phi Hùng', 'TIEN_CHAI_XE_MAY', 'FORMULA', 'CHAI_XE_MAY * DG_CHAI_XE_MAY', null, 90),
    ('Phạm Phi Hùng', 'PK_NGOAI_GIO', 'MONTHLY_INPUT', null, null, 100),
    ('Phạm Phi Hùng', 'TIEN_PK_NGOAI_GIO', 'FORMULA', 'PK_NGOAI_GIO * DG_BICH_XE_MAY', null, 110),
    ('Phạm Phi Hùng', 'CHAI_O_TO', 'MONTHLY_INPUT', null, null, 120),
    ('Phạm Phi Hùng', 'TIEN_CHAI_O_TO', 'FORMULA', 'CHAI_O_TO * DG_CHAI_O_TO', null, 130),
    ('Phạm Phi Hùng', 'BICH_O_TO', 'MONTHLY_INPUT', null, null, 140),
    ('Phạm Phi Hùng', 'TIEN_BICH_O_TO', 'FORMULA', 'BICH_O_TO * DG_BICH_O_TO', null, 150),
    ('Phạm Phi Hùng', 'BICH_CHAI_DIEU_CHUYEN', 'MONTHLY_INPUT', null, null, 160),
    ('Phạm Phi Hùng', 'TIEN_DIEU_CHUYEN', 'FORMULA', 'BICH_CHAI_DIEU_CHUYEN * DG_VC_KHO', null, 170),
    ('Phạm Phi Hùng', 'SOAN_HANG', 'MONTHLY_INPUT', null, null, 180),
    ('Phạm Phi Hùng', 'TIEN_SOAN_HANG', 'FORMULA', 'SOAN_HANG * DG_VC_KHO', null, 190),
    ('Phạm Phi Hùng', 'TIEN_GUI_XE', 'MONTHLY_INPUT', null, null, 200),
    ('Phạm Phi Hùng', 'LUONG_DT', 'FORMULA', 'TIEN_CHAI_XE_MAY + TIEN_PK_NGOAI_GIO + TIEN_CHAI_O_TO + TIEN_BICH_O_TO + TIEN_DIEU_CHUYEN + TIEN_SOAN_HANG + TIEN_GUI_XE', null, 210),
    ('Phạm Phi Hùng', 'LUONG_PHEP', 'FORMULA', 'BAC_LUONG / STANDARD_DAYS * LEAVE_DAYS', null, 220),
    ('Phạm Phi Hùng', 'LUONG_NGHI_LE', 'FORMULA', 'BAC_LUONG / STANDARD_DAYS * HOLIDAY_DAYS', null, 240),
    ('Phạm Phi Hùng', 'LCB_LAM_THEM', 'VALUE', null, 10000000, 270),
    ('Phạm Phi Hùng', 'LUONG_NGAY_CONG', 'FORMULA', 'LCB_LAM_THEM / STANDARD_DAYS', null, 280),
    ('Phạm Phi Hùng', 'GIO_TRUC_T7', 'MONTHLY_INPUT', null, null, 290),
    ('Phạm Phi Hùng', 'TIEN_TRUC_T7', 'FORMULA', 'LUONG_NGAY_CONG / HOURS_PER_DAY * GIO_TRUC_T7', null, 300),
    ('Phạm Phi Hùng', 'TIEN_GIO_THUONG', 'FORMULA', 'LUONG_NGAY_CONG / HOURS_PER_DAY * OT_WEEKDAY_HOURS * HS_GIO_THUONG', null, 310),
    ('Phạm Phi Hùng', 'TIEN_GIO_CN', 'FORMULA', 'LUONG_NGAY_CONG / HOURS_PER_DAY * OT_WEEKEND_HOURS * HS_GIO_CN', null, 320),
    ('Phạm Phi Hùng', 'TIEN_GIO_LE', 'FORMULA', 'LUONG_NGAY_CONG / HOURS_PER_DAY * OT_HOLIDAY_HOURS * HS_GIO_LE', null, 330),
    ('Phạm Phi Hùng', 'LAM_THEM', 'FORMULA', 'TIEN_TRUC_T7 + TIEN_GIO_THUONG + TIEN_GIO_CN + TIEN_GIO_LE', null, 340),
    ('Phạm Phi Hùng', 'TRU_CONG_DI_MUON', 'MONTHLY_INPUT', null, null, 530),
    ('Phạm Phi Hùng', 'PHAT_DI_MUON_KH', 'MONTHLY_INPUT', null, null, 540),
    ('Phạm Phi Hùng', 'PHAT_KHAC', 'FORMULA', 'TRU_CONG_DI_MUON * BAC_LUONG / STANDARD_DAYS', null, 550),
    ('Phạm Phi Hùng', 'THUONG_DI_SOM_KHAC', 'MONTHLY_INPUT', null, null, 590),
    ('Phạm Phi Hùng', 'KHAC_THUONG', 'MONTHLY_INPUT', null, null, 600),
    ('Phạm Phi Hùng', 'BS_LUONG', 'MONTHLY_INPUT', null, null, 610),
    ('Phạm Phi Hùng', 'PHAT_DI_MUON_QUA_LAN', 'MONTHLY_INPUT', null, null, 660),
    ('Phạm Phi Hùng', 'TONG_CONG', 'FORMULA', 'TONG_THU_NHAP - PHAT_DI_MUON_KH - PHAT_KHAC - PHAT_DI_MUON_QUA_LAN', null, 670),
    ('Phạm Phi Hùng', 'TN_MIEN_THUE', 'FORMULA', '500000 / STANDARD_DAYS * (CONG + HOLIDAY_DAYS + LEAVE_DAYS) + MIN(MIEN_THUE_TOI_DA, MIEN_THUE_THEO_CONG / STANDARD_DAYS * (CONG + HOLIDAY_DAYS + LEAVE_DAYS))', null, 680),
    ('Phạm Phi Hùng', 'GIAM_TRU', 'FORMULA', '1 * GIAM_TRU_NPT', null, 690),
    ('Phạm Phi Hùng', 'TN_TINH_THUE', 'FORMULA', 'MAX(TONG_CONG - TN_MIEN_THUE - GIAM_TRU - TRU_BHXH - GIAM_TRU_BAN_THAN, 0)', null, 700),
    ('Phạm Phi Hùng', 'THUE_TNCN', 'FORMULA', 'BIEU_THUE_TNCN(TN_TINH_THUE)', null, 710),
    ('Phạm Phi Hùng', 'TRU_BHXH', 'FORMULA', '8000000 * TY_LE_TRU_BHXH', null, 720),
    ('Phạm Phi Hùng', 'TRU_QUY', 'FORMULA', '(LUONG_THOI_GIAN + LUONG_DT) * TY_LE_NHAP_QUY', null, 730),
    ('Phạm Văn Hoa', 'BAC_LUONG', 'VALUE', null, 8000000, 10),
    ('Phạm Văn Hoa', 'TRACH_NHIEM', 'VALUE', null, 1000000, 20),
    ('Phạm Văn Hoa', 'CONG', 'FORMULA', 'STANDARD_DAYS - HOLIDAY_DAYS - LEAVE_DAYS', null, 50),
    ('Phạm Văn Hoa', 'LUONG_THOI_GIAN', 'FORMULA', 'BAC_LUONG / STANDARD_DAYS * CONG', null, 60),
    ('Phạm Văn Hoa', 'LUONG_DT', 'MONTHLY_INPUT', null, null, 210),
    ('Phạm Văn Hoa', 'LUONG_PHEP', 'FORMULA', 'BAC_LUONG / STANDARD_DAYS * LEAVE_DAYS', null, 220),
    ('Phạm Văn Hoa', 'LUONG_NGHI_LE', 'FORMULA', 'BAC_LUONG / STANDARD_DAYS * HOLIDAY_DAYS', null, 240),
    ('Phạm Văn Hoa', 'LE_CN', 'FORMULA', '(OT_WEEKEND_HOURS + OT_HOLIDAY_HOURS) / HOURS_PER_DAY', null, 250),
    ('Phạm Văn Hoa', 'SAU_22H', 'MONTHLY_INPUT', null, null, 260),
    ('Phạm Văn Hoa', 'LAM_THEM', 'FORMULA', '(LE_CN * HS_LE_CN + SAU_22H * HS_SAU_22H) * BAC_LUONG / STANDARD_DAYS', null, 340),
    ('Phạm Văn Hoa', 'TRU_CONG_DI_MUON', 'MONTHLY_INPUT', null, null, 530),
    ('Phạm Văn Hoa', 'PHAT_DI_MUON_KH', 'MONTHLY_INPUT', null, null, 540),
    ('Phạm Văn Hoa', 'PHAT_KHAC', 'FORMULA', 'TRU_CONG_DI_MUON * BAC_LUONG / STANDARD_DAYS', null, 550),
    ('Phạm Văn Hoa', 'THUONG_DI_SOM_KHAC', 'MONTHLY_INPUT', null, null, 590),
    ('Phạm Văn Hoa', 'KHAC_THUONG', 'MONTHLY_INPUT', null, null, 600),
    ('Phạm Văn Hoa', 'BS_LUONG', 'MONTHLY_INPUT', null, null, 610),
    ('Phạm Văn Hoa', 'PHAT_DI_MUON_QUA_LAN', 'MONTHLY_INPUT', null, null, 660),
    ('Phạm Văn Hoa', 'TONG_CONG', 'FORMULA', 'TONG_THU_NHAP - PHAT_DI_MUON_KH - PHAT_KHAC - PHAT_DI_MUON_QUA_LAN', null, 670),
    ('Phạm Văn Hoa', 'TN_MIEN_THUE', 'VALUE', null, 0, 680),
    ('Phạm Văn Hoa', 'GIAM_TRU', 'VALUE', null, 0, 690),
    ('Phạm Văn Hoa', 'TN_TINH_THUE', 'FORMULA', 'MAX(TONG_CONG - TN_MIEN_THUE - GIAM_TRU - TRU_BHXH - GIAM_TRU_BAN_THAN, 0)', null, 700),
    ('Phạm Văn Hoa', 'THUE_TNCN', 'FORMULA', 'BIEU_THUE_TNCN(TN_TINH_THUE)', null, 710),
    ('Phạm Văn Hoa', 'TRU_QUY', 'FORMULA', '(LUONG_THOI_GIAN + LUONG_DT) * TY_LE_NHAP_QUY', null, 730),
    ('Lê Thu Hà', 'BAC_LUONG', 'VALUE', null, 5000000, 10),
    ('Lê Thu Hà', 'TRACH_NHIEM', 'FORMULA', '2000000 * KPIS', null, 20),
    ('Lê Thu Hà', 'KPIS', 'FORMULA', 'TY_LE_KPI', null, 40),
    ('Lê Thu Hà', 'CONG', 'FORMULA', 'WORK_DAYS', null, 50),
    ('Lê Thu Hà', 'LUONG_THOI_GIAN', 'FORMULA', 'BAC_LUONG / STANDARD_DAYS * CONG', null, 60),
    ('Lê Thu Hà', 'LUONG_DT', 'MONTHLY_INPUT', null, null, 210),
    ('Lê Thu Hà', 'LUONG_PHEP', 'FORMULA', 'BAC_LUONG / STANDARD_DAYS * LEAVE_DAYS', null, 220),
    ('Lê Thu Hà', 'LUONG_NGHI_LE', 'FORMULA', 'BAC_LUONG / STANDARD_DAYS * HOLIDAY_DAYS', null, 240),
    ('Lê Thu Hà', 'LCB_LAM_THEM', 'VALUE', null, 7000000, 270),
    ('Lê Thu Hà', 'LUONG_NGAY_CONG', 'FORMULA', 'LCB_LAM_THEM / STANDARD_DAYS', null, 280),
    ('Lê Thu Hà', 'GIO_TRUC_T7', 'MONTHLY_INPUT', null, null, 290),
    ('Lê Thu Hà', 'TIEN_TRUC_T7', 'FORMULA', 'LUONG_NGAY_CONG / HOURS_PER_DAY * GIO_TRUC_T7', null, 300),
    ('Lê Thu Hà', 'TIEN_GIO_THUONG', 'FORMULA', 'LUONG_NGAY_CONG / HOURS_PER_DAY * OT_WEEKDAY_HOURS * HS_GIO_THUONG', null, 310),
    ('Lê Thu Hà', 'TIEN_GIO_CN', 'FORMULA', 'LUONG_NGAY_CONG / HOURS_PER_DAY * OT_WEEKEND_HOURS * HS_GIO_CN', null, 320),
    ('Lê Thu Hà', 'TIEN_GIO_LE', 'FORMULA', 'LUONG_NGAY_CONG / HOURS_PER_DAY * OT_HOLIDAY_HOURS * HS_GIO_LE', null, 330),
    ('Lê Thu Hà', 'LAM_THEM', 'FORMULA', 'TIEN_TRUC_T7 + TIEN_GIO_THUONG + TIEN_GIO_CN + TIEN_GIO_LE', null, 340),
    ('Lê Thu Hà', 'TRU_CONG_DI_MUON', 'MONTHLY_INPUT', null, null, 530),
    ('Lê Thu Hà', 'PHAT_DI_MUON_KH', 'MONTHLY_INPUT', null, null, 540),
    ('Lê Thu Hà', 'PHAT_KHAC', 'FORMULA', 'TRU_CONG_DI_MUON * BAC_LUONG / STANDARD_DAYS', null, 550),
    ('Lê Thu Hà', 'THUONG_DI_SOM_KHAC', 'MONTHLY_INPUT', null, null, 590),
    ('Lê Thu Hà', 'KHAC_THUONG', 'MONTHLY_INPUT', null, null, 600),
    ('Lê Thu Hà', 'BS_LUONG', 'MONTHLY_INPUT', null, null, 610),
    ('Lê Thu Hà', 'PHAT_DI_MUON_QUA_LAN', 'MONTHLY_INPUT', null, null, 660),
    ('Lê Thu Hà', 'TONG_CONG', 'FORMULA', 'TONG_THU_NHAP - PHAT_DI_MUON_KH - PHAT_KHAC - PHAT_DI_MUON_QUA_LAN', null, 670),
    ('Lê Thu Hà', 'TN_MIEN_THUE', 'VALUE', null, 0, 680),
    ('Lê Thu Hà', 'GIAM_TRU', 'VALUE', null, 0, 690),
    ('Lê Thu Hà', 'TN_TINH_THUE', 'FORMULA', 'MAX(TONG_CONG - TN_MIEN_THUE - GIAM_TRU - TRU_BHXH - GIAM_TRU_BAN_THAN, 0)', null, 700),
    ('Lê Thu Hà', 'THUE_TNCN', 'FORMULA', 'BIEU_THUE_TNCN(TN_TINH_THUE)', null, 710),
    ('Lê Thu Hà', 'TRU_QUY', 'FORMULA', '(LUONG_THOI_GIAN + LUONG_DT) * TY_LE_NHAP_QUY', null, 730),
    ('Trần Thu Hường', 'BAC_LUONG', 'VALUE', null, 5000000, 10),
    ('Trần Thu Hường', 'TRACH_NHIEM', 'FORMULA', '1500000 * KPIS', null, 20),
    ('Trần Thu Hường', 'KPIS', 'FORMULA', 'TY_LE_KPI', null, 40),
    ('Trần Thu Hường', 'CONG', 'FORMULA', 'WORK_DAYS', null, 50),
    ('Trần Thu Hường', 'LUONG_THOI_GIAN', 'FORMULA', 'BAC_LUONG / STANDARD_DAYS * CONG', null, 60),
    ('Trần Thu Hường', 'LUONG_DT', 'MONTHLY_INPUT', null, null, 210),
    ('Trần Thu Hường', 'LUONG_PHEP', 'FORMULA', 'BAC_LUONG / STANDARD_DAYS * LEAVE_DAYS', null, 220),
    ('Trần Thu Hường', 'LUONG_NGHI_LE', 'FORMULA', 'BAC_LUONG / STANDARD_DAYS * HOLIDAY_DAYS', null, 240),
    ('Trần Thu Hường', 'LCB_LAM_THEM', 'VALUE', null, 7000000, 270),
    ('Trần Thu Hường', 'LUONG_NGAY_CONG', 'FORMULA', 'LCB_LAM_THEM / STANDARD_DAYS', null, 280),
    ('Trần Thu Hường', 'GIO_TRUC_T7', 'MONTHLY_INPUT', null, null, 290),
    ('Trần Thu Hường', 'TIEN_TRUC_T7', 'FORMULA', 'LUONG_NGAY_CONG / HOURS_PER_DAY * GIO_TRUC_T7', null, 300),
    ('Trần Thu Hường', 'TIEN_GIO_THUONG', 'FORMULA', 'LUONG_NGAY_CONG / HOURS_PER_DAY * OT_WEEKDAY_HOURS * HS_GIO_THUONG', null, 310),
    ('Trần Thu Hường', 'TIEN_GIO_CN', 'FORMULA', 'LUONG_NGAY_CONG / HOURS_PER_DAY * OT_WEEKEND_HOURS * HS_GIO_CN', null, 320),
    ('Trần Thu Hường', 'TIEN_GIO_LE', 'FORMULA', 'LUONG_NGAY_CONG / HOURS_PER_DAY * OT_HOLIDAY_HOURS * HS_GIO_LE', null, 330),
    ('Trần Thu Hường', 'LAM_THEM', 'FORMULA', 'TIEN_TRUC_T7 + TIEN_GIO_THUONG + TIEN_GIO_CN + TIEN_GIO_LE', null, 340),
    ('Trần Thu Hường', 'TRU_CONG_DI_MUON', 'MONTHLY_INPUT', null, null, 530),
    ('Trần Thu Hường', 'PHAT_DI_MUON_KH', 'MONTHLY_INPUT', null, null, 540),
    ('Trần Thu Hường', 'PHAT_KHAC', 'FORMULA', 'TRU_CONG_DI_MUON * BAC_LUONG / STANDARD_DAYS', null, 550),
    ('Trần Thu Hường', 'THUONG_DI_SOM_KHAC', 'MONTHLY_INPUT', null, null, 590),
    ('Trần Thu Hường', 'KHAC_THUONG', 'MONTHLY_INPUT', null, null, 600),
    ('Trần Thu Hường', 'BS_LUONG', 'MONTHLY_INPUT', null, null, 610),
    ('Trần Thu Hường', 'PHAT_DI_MUON_QUA_LAN', 'MONTHLY_INPUT', null, null, 660),
    ('Trần Thu Hường', 'TONG_CONG', 'FORMULA', 'TONG_THU_NHAP - PHAT_DI_MUON_KH - PHAT_KHAC - PHAT_DI_MUON_QUA_LAN', null, 670),
    ('Trần Thu Hường', 'TN_MIEN_THUE', 'VALUE', null, 0, 680),
    ('Trần Thu Hường', 'GIAM_TRU', 'VALUE', null, 0, 690),
    ('Trần Thu Hường', 'TN_TINH_THUE', 'FORMULA', 'MAX(TONG_CONG - TN_MIEN_THUE - GIAM_TRU - TRU_BHXH - GIAM_TRU_BAN_THAN, 0)', null, 700),
    ('Trần Thu Hường', 'THUE_TNCN', 'FORMULA', 'BIEU_THUE_TNCN(TN_TINH_THUE)', null, 710),
    ('Trần Thu Hường', 'TRU_QUY', 'FORMULA', '(LUONG_THOI_GIAN + LUONG_DT) * TY_LE_NHAP_QUY', null, 730),
    ('Lưu Danh Nhân', 'BAC_LUONG', 'VALUE', null, 5000000, 10),
    ('Lưu Danh Nhân', 'TRACH_NHIEM', 'FORMULA', '2000000 * KPIS', null, 20),
    ('Lưu Danh Nhân', 'PHU_CAP', 'FORMULA', 'CONG * PHU_CAP_THEO_CONG', null, 30),
    ('Lưu Danh Nhân', 'KPIS', 'FORMULA', 'TY_LE_KPI', null, 40),
    ('Lưu Danh Nhân', 'CONG', 'FORMULA', 'WORK_DAYS', null, 50),
    ('Lưu Danh Nhân', 'LUONG_THOI_GIAN', 'FORMULA', 'BAC_LUONG / STANDARD_DAYS * CONG', null, 60),
    ('Lưu Danh Nhân', 'CHAI_XE_MAY', 'MONTHLY_INPUT', null, null, 80),
    ('Lưu Danh Nhân', 'TIEN_CHAI_XE_MAY', 'FORMULA', 'CHAI_XE_MAY * DG_CHAI_XE_MAY', null, 90),
    ('Lưu Danh Nhân', 'PK_NGOAI_GIO', 'MONTHLY_INPUT', null, null, 100),
    ('Lưu Danh Nhân', 'TIEN_PK_NGOAI_GIO', 'FORMULA', 'PK_NGOAI_GIO * DG_BICH_XE_MAY', null, 110),
    ('Lưu Danh Nhân', 'CHAI_O_TO', 'MONTHLY_INPUT', null, null, 120),
    ('Lưu Danh Nhân', 'TIEN_CHAI_O_TO', 'FORMULA', 'CHAI_O_TO * DG_CHAI_O_TO', null, 130),
    ('Lưu Danh Nhân', 'BICH_O_TO', 'MONTHLY_INPUT', null, null, 140),
    ('Lưu Danh Nhân', 'TIEN_BICH_O_TO', 'FORMULA', 'BICH_O_TO * DG_BICH_O_TO', null, 150),
    ('Lưu Danh Nhân', 'BICH_CHAI_DIEU_CHUYEN', 'MONTHLY_INPUT', null, null, 160),
    ('Lưu Danh Nhân', 'TIEN_DIEU_CHUYEN', 'FORMULA', 'BICH_CHAI_DIEU_CHUYEN * DG_VC_KHO', null, 170),
    ('Lưu Danh Nhân', 'SOAN_HANG', 'MONTHLY_INPUT', null, null, 180),
    ('Lưu Danh Nhân', 'TIEN_SOAN_HANG', 'FORMULA', 'SOAN_HANG * DG_VC_KHO', null, 190),
    ('Lưu Danh Nhân', 'TIEN_GUI_XE', 'MONTHLY_INPUT', null, null, 200),
    ('Lưu Danh Nhân', 'LUONG_DT', 'FORMULA', 'TIEN_CHAI_XE_MAY + TIEN_PK_NGOAI_GIO + TIEN_CHAI_O_TO + TIEN_BICH_O_TO + TIEN_DIEU_CHUYEN + TIEN_SOAN_HANG + TIEN_GUI_XE', null, 210),
    ('Lưu Danh Nhân', 'LUONG_PHEP', 'FORMULA', 'BAC_LUONG / STANDARD_DAYS * LEAVE_DAYS', null, 220),
    ('Lưu Danh Nhân', 'LUONG_NGHI_LE', 'FORMULA', 'BAC_LUONG / STANDARD_DAYS * HOLIDAY_DAYS', null, 240),
    ('Lưu Danh Nhân', 'LCB_LAM_THEM', 'VALUE', null, 7500000, 270),
    ('Lưu Danh Nhân', 'LUONG_NGAY_CONG', 'FORMULA', 'LCB_LAM_THEM / STANDARD_DAYS', null, 280),
    ('Lưu Danh Nhân', 'GIO_TRUC_T7', 'MONTHLY_INPUT', null, null, 290),
    ('Lưu Danh Nhân', 'TIEN_TRUC_T7', 'FORMULA', 'LUONG_NGAY_CONG / HOURS_PER_DAY * GIO_TRUC_T7', null, 300),
    ('Lưu Danh Nhân', 'TIEN_GIO_THUONG', 'FORMULA', 'LUONG_NGAY_CONG / HOURS_PER_DAY * OT_WEEKDAY_HOURS * HS_GIO_THUONG', null, 310),
    ('Lưu Danh Nhân', 'TIEN_GIO_CN', 'FORMULA', 'LUONG_NGAY_CONG / HOURS_PER_DAY * OT_WEEKEND_HOURS * HS_GIO_CN', null, 320),
    ('Lưu Danh Nhân', 'TIEN_GIO_LE', 'FORMULA', 'LUONG_NGAY_CONG / HOURS_PER_DAY * OT_HOLIDAY_HOURS * HS_GIO_LE', null, 330),
    ('Lưu Danh Nhân', 'LAM_THEM', 'FORMULA', 'TIEN_TRUC_T7 + TIEN_GIO_THUONG + TIEN_GIO_CN + TIEN_GIO_LE', null, 340),
    ('Lưu Danh Nhân', 'TRU_CONG_DI_MUON', 'MONTHLY_INPUT', null, null, 530),
    ('Lưu Danh Nhân', 'PHAT_DI_MUON_KH', 'MONTHLY_INPUT', null, null, 540),
    ('Lưu Danh Nhân', 'PHAT_KHAC', 'FORMULA', 'TRU_CONG_DI_MUON * BAC_LUONG / STANDARD_DAYS', null, 550),
    ('Lưu Danh Nhân', 'THUONG_DI_SOM_KHAC', 'MONTHLY_INPUT', null, null, 590),
    ('Lưu Danh Nhân', 'KHAC_THUONG', 'MONTHLY_INPUT', null, null, 600),
    ('Lưu Danh Nhân', 'BS_LUONG', 'MONTHLY_INPUT', null, null, 610),
    ('Lưu Danh Nhân', 'PHAT_DI_MUON_QUA_LAN', 'MONTHLY_INPUT', null, null, 660),
    ('Lưu Danh Nhân', 'TONG_CONG', 'FORMULA', 'TONG_THU_NHAP - PHAT_DI_MUON_KH - PHAT_KHAC - PHAT_DI_MUON_QUA_LAN', null, 670),
    ('Lưu Danh Nhân', 'TN_MIEN_THUE', 'FORMULA', '1000000 / STANDARD_DAYS * (CONG + HOLIDAY_DAYS + LEAVE_DAYS) + MIN(MIEN_THUE_TOI_DA, MIEN_THUE_THEO_CONG / STANDARD_DAYS * (CONG + HOLIDAY_DAYS + LEAVE_DAYS))', null, 680),
    ('Lưu Danh Nhân', 'GIAM_TRU', 'FORMULA', '1 * GIAM_TRU_NPT', null, 690),
    ('Lưu Danh Nhân', 'TN_TINH_THUE', 'FORMULA', 'MAX(TONG_CONG - TN_MIEN_THUE - GIAM_TRU - TRU_BHXH - GIAM_TRU_BAN_THAN, 0)', null, 700),
    ('Lưu Danh Nhân', 'THUE_TNCN', 'FORMULA', 'BIEU_THUE_TNCN(TN_TINH_THUE)', null, 710),
    ('Lưu Danh Nhân', 'TRU_BHXH', 'FORMULA', '6500000 * TY_LE_TRU_BHXH', null, 720),
    ('Lưu Danh Nhân', 'TRU_QUY', 'FORMULA', '(LUONG_THOI_GIAN + LUONG_DT) * TY_LE_NHAP_QUY', null, 730),
    ('Trần Xuân Trường', 'BAC_LUONG', 'VALUE', null, 5000000, 10),
    ('Trần Xuân Trường', 'TRACH_NHIEM', 'FORMULA', '2000000 * KPIS', null, 20),
    ('Trần Xuân Trường', 'PHU_CAP', 'FORMULA', 'CONG * PHU_CAP_THEO_CONG', null, 30),
    ('Trần Xuân Trường', 'KPIS', 'FORMULA', 'TY_LE_KPI', null, 40),
    ('Trần Xuân Trường', 'CONG', 'FORMULA', 'WORK_DAYS', null, 50),
    ('Trần Xuân Trường', 'LUONG_THOI_GIAN', 'FORMULA', 'BAC_LUONG / STANDARD_DAYS * CONG', null, 60),
    ('Trần Xuân Trường', 'CHAI_XE_MAY', 'MONTHLY_INPUT', null, null, 80),
    ('Trần Xuân Trường', 'TIEN_CHAI_XE_MAY', 'FORMULA', 'CHAI_XE_MAY * DG_CHAI_XE_MAY', null, 90),
    ('Trần Xuân Trường', 'PK_NGOAI_GIO', 'MONTHLY_INPUT', null, null, 100),
    ('Trần Xuân Trường', 'TIEN_PK_NGOAI_GIO', 'FORMULA', 'PK_NGOAI_GIO * DG_BICH_XE_MAY', null, 110),
    ('Trần Xuân Trường', 'CHAI_O_TO', 'MONTHLY_INPUT', null, null, 120),
    ('Trần Xuân Trường', 'TIEN_CHAI_O_TO', 'FORMULA', 'CHAI_O_TO * DG_CHAI_O_TO', null, 130),
    ('Trần Xuân Trường', 'BICH_O_TO', 'MONTHLY_INPUT', null, null, 140),
    ('Trần Xuân Trường', 'TIEN_BICH_O_TO', 'FORMULA', 'BICH_O_TO * DG_BICH_O_TO', null, 150),
    ('Trần Xuân Trường', 'BICH_CHAI_DIEU_CHUYEN', 'MONTHLY_INPUT', null, null, 160),
    ('Trần Xuân Trường', 'TIEN_DIEU_CHUYEN', 'FORMULA', 'BICH_CHAI_DIEU_CHUYEN * DG_VC_KHO', null, 170),
    ('Trần Xuân Trường', 'SOAN_HANG', 'MONTHLY_INPUT', null, null, 180),
    ('Trần Xuân Trường', 'TIEN_SOAN_HANG', 'FORMULA', 'SOAN_HANG * DG_VC_KHO', null, 190),
    ('Trần Xuân Trường', 'TIEN_GUI_XE', 'MONTHLY_INPUT', null, null, 200),
    ('Trần Xuân Trường', 'LUONG_DT', 'FORMULA', 'TIEN_CHAI_XE_MAY + TIEN_PK_NGOAI_GIO + TIEN_CHAI_O_TO + TIEN_BICH_O_TO + TIEN_DIEU_CHUYEN + TIEN_SOAN_HANG + TIEN_GUI_XE', null, 210),
    ('Trần Xuân Trường', 'LUONG_PHEP', 'FORMULA', 'BAC_LUONG / STANDARD_DAYS * LEAVE_DAYS', null, 220),
    ('Trần Xuân Trường', 'LUONG_NGHI_LE', 'FORMULA', 'BAC_LUONG / STANDARD_DAYS * HOLIDAY_DAYS', null, 240),
    ('Trần Xuân Trường', 'LCB_LAM_THEM', 'VALUE', null, 5000000, 270),
    ('Trần Xuân Trường', 'LUONG_NGAY_CONG', 'FORMULA', 'LCB_LAM_THEM / STANDARD_DAYS', null, 280),
    ('Trần Xuân Trường', 'GIO_TRUC_T7', 'MONTHLY_INPUT', null, null, 290),
    ('Trần Xuân Trường', 'TIEN_TRUC_T7', 'FORMULA', 'LUONG_NGAY_CONG / HOURS_PER_DAY * GIO_TRUC_T7', null, 300),
    ('Trần Xuân Trường', 'TIEN_GIO_THUONG', 'FORMULA', 'LUONG_NGAY_CONG / HOURS_PER_DAY * OT_WEEKDAY_HOURS * HS_GIO_THUONG', null, 310),
    ('Trần Xuân Trường', 'TIEN_GIO_CN', 'FORMULA', 'LUONG_NGAY_CONG / HOURS_PER_DAY * OT_WEEKEND_HOURS * HS_GIO_CN', null, 320),
    ('Trần Xuân Trường', 'TIEN_GIO_LE', 'FORMULA', 'LUONG_NGAY_CONG / HOURS_PER_DAY * OT_HOLIDAY_HOURS * HS_GIO_LE', null, 330),
    ('Trần Xuân Trường', 'LAM_THEM', 'FORMULA', 'TIEN_TRUC_T7 + TIEN_GIO_THUONG + TIEN_GIO_CN + TIEN_GIO_LE', null, 340),
    ('Trần Xuân Trường', 'TRU_CONG_DI_MUON', 'MONTHLY_INPUT', null, null, 530),
    ('Trần Xuân Trường', 'PHAT_DI_MUON_KH', 'MONTHLY_INPUT', null, null, 540),
    ('Trần Xuân Trường', 'PHAT_KHAC', 'FORMULA', 'TRU_CONG_DI_MUON * BAC_LUONG / STANDARD_DAYS', null, 550),
    ('Trần Xuân Trường', 'THUONG_DI_SOM_KHAC', 'MONTHLY_INPUT', null, null, 590),
    ('Trần Xuân Trường', 'KHAC_THUONG', 'MONTHLY_INPUT', null, null, 600),
    ('Trần Xuân Trường', 'BS_LUONG', 'MONTHLY_INPUT', null, null, 610),
    ('Trần Xuân Trường', 'PHAT_DI_MUON_QUA_LAN', 'MONTHLY_INPUT', null, null, 660),
    ('Trần Xuân Trường', 'TONG_CONG', 'FORMULA', 'TONG_THU_NHAP - PHAT_DI_MUON_KH - PHAT_KHAC - PHAT_DI_MUON_QUA_LAN', null, 670),
    ('Trần Xuân Trường', 'TN_MIEN_THUE', 'VALUE', null, 0, 680),
    ('Trần Xuân Trường', 'GIAM_TRU', 'VALUE', null, 0, 690),
    ('Trần Xuân Trường', 'TN_TINH_THUE', 'FORMULA', 'MAX(TONG_CONG - TN_MIEN_THUE - GIAM_TRU - TRU_BHXH - GIAM_TRU_BAN_THAN, 0)', null, 700),
    ('Trần Xuân Trường', 'THUE_TNCN', 'FORMULA', 'BIEU_THUE_TNCN(TN_TINH_THUE)', null, 710),
    ('Trần Xuân Trường', 'TRU_QUY', 'FORMULA', '(LUONG_THOI_GIAN + LUONG_DT) * TY_LE_NHAP_QUY', null, 730),
    ('Nguyễn Tuấn Đạt', 'BAC_LUONG', 'VALUE', null, 5000000, 10),
    ('Nguyễn Tuấn Đạt', 'TRACH_NHIEM', 'FORMULA', '3000000 * KPIS', null, 20),
    ('Nguyễn Tuấn Đạt', 'KPIS', 'FORMULA', 'TY_LE_KPI', null, 40),
    ('Nguyễn Tuấn Đạt', 'CONG', 'FORMULA', 'WORK_DAYS', null, 50),
    ('Nguyễn Tuấn Đạt', 'LUONG_THOI_GIAN', 'FORMULA', 'BAC_LUONG / STANDARD_DAYS * CONG', null, 60),
    ('Nguyễn Tuấn Đạt', 'LUONG_DT', 'MONTHLY_INPUT', null, null, 210),
    ('Nguyễn Tuấn Đạt', 'LUONG_PHEP', 'FORMULA', 'BAC_LUONG / STANDARD_DAYS * LEAVE_DAYS', null, 220),
    ('Nguyễn Tuấn Đạt', 'LUONG_NGHI_LE', 'FORMULA', 'BAC_LUONG / STANDARD_DAYS * HOLIDAY_DAYS', null, 240),
    ('Nguyễn Tuấn Đạt', 'LE_CN', 'FORMULA', '(OT_WEEKEND_HOURS + OT_HOLIDAY_HOURS) / HOURS_PER_DAY', null, 250),
    ('Nguyễn Tuấn Đạt', 'SAU_22H', 'MONTHLY_INPUT', null, null, 260),
    ('Nguyễn Tuấn Đạt', 'LAM_THEM', 'FORMULA', '(LE_CN * HS_LE_CN + SAU_22H * HS_SAU_22H) * BAC_LUONG / STANDARD_DAYS', null, 340),
    ('Nguyễn Tuấn Đạt', 'TRU_CONG_DI_MUON', 'MONTHLY_INPUT', null, null, 530),
    ('Nguyễn Tuấn Đạt', 'PHAT_DI_MUON_KH', 'MONTHLY_INPUT', null, null, 540),
    ('Nguyễn Tuấn Đạt', 'PHAT_KHAC', 'FORMULA', 'TRU_CONG_DI_MUON * BAC_LUONG / STANDARD_DAYS', null, 550),
    ('Nguyễn Tuấn Đạt', 'THUONG_DI_SOM_KHAC', 'MONTHLY_INPUT', null, null, 590),
    ('Nguyễn Tuấn Đạt', 'KHAC_THUONG', 'MONTHLY_INPUT', null, null, 600),
    ('Nguyễn Tuấn Đạt', 'BS_LUONG', 'MONTHLY_INPUT', null, null, 610),
    ('Nguyễn Tuấn Đạt', 'PHAT_DI_MUON_QUA_LAN', 'MONTHLY_INPUT', null, null, 660),
    ('Nguyễn Tuấn Đạt', 'TONG_CONG', 'FORMULA', 'TONG_THU_NHAP - PHAT_DI_MUON_KH - PHAT_KHAC - PHAT_DI_MUON_QUA_LAN', null, 670),
    ('Nguyễn Tuấn Đạt', 'TN_MIEN_THUE', 'FORMULA', '1000000 / STANDARD_DAYS * (CONG + HOLIDAY_DAYS + LEAVE_DAYS) + MIN(MIEN_THUE_TOI_DA, MIEN_THUE_THEO_CONG / STANDARD_DAYS * (CONG + HOLIDAY_DAYS + LEAVE_DAYS))', null, 680),
    ('Nguyễn Tuấn Đạt', 'GIAM_TRU', 'VALUE', null, 0, 690),
    ('Nguyễn Tuấn Đạt', 'TN_TINH_THUE', 'FORMULA', 'MAX(TONG_CONG - TN_MIEN_THUE - GIAM_TRU - TRU_BHXH - GIAM_TRU_BAN_THAN, 0)', null, 700),
    ('Nguyễn Tuấn Đạt', 'THUE_TNCN', 'FORMULA', 'BIEU_THUE_TNCN(TN_TINH_THUE)', null, 710),
    ('Nguyễn Tuấn Đạt', 'TRU_BHXH', 'FORMULA', '8000000 * TY_LE_TRU_BHXH', null, 720),
    ('Nguyễn Tuấn Đạt', 'TRU_QUY', 'FORMULA', '(LUONG_THOI_GIAN + LUONG_DT) * TY_LE_NHAP_QUY', null, 730),
    ('Lưu Tiến Đức', 'BAC_LUONG', 'VALUE', null, 5000000, 10),
    ('Lưu Tiến Đức', 'TRACH_NHIEM', 'FORMULA', '2000000 * KPIS', null, 20),
    ('Lưu Tiến Đức', 'KPIS', 'FORMULA', 'TY_LE_KPI', null, 40),
    ('Lưu Tiến Đức', 'CONG', 'FORMULA', 'WORK_DAYS', null, 50),
    ('Lưu Tiến Đức', 'LUONG_THOI_GIAN', 'FORMULA', 'BAC_LUONG / STANDARD_DAYS * CONG', null, 60),
    ('Lưu Tiến Đức', 'LUONG_DT', 'MONTHLY_INPUT', null, null, 210),
    ('Lưu Tiến Đức', 'LUONG_PHEP', 'FORMULA', 'BAC_LUONG / STANDARD_DAYS * LEAVE_DAYS', null, 220),
    ('Lưu Tiến Đức', 'LUONG_NGHI_LE', 'FORMULA', 'BAC_LUONG / STANDARD_DAYS * HOLIDAY_DAYS', null, 240),
    ('Lưu Tiến Đức', 'LE_CN', 'FORMULA', '(OT_WEEKEND_HOURS + OT_HOLIDAY_HOURS) / HOURS_PER_DAY', null, 250),
    ('Lưu Tiến Đức', 'SAU_22H', 'MONTHLY_INPUT', null, null, 260),
    ('Lưu Tiến Đức', 'LAM_THEM', 'FORMULA', '(LE_CN * HS_LE_CN + SAU_22H * HS_SAU_22H) * BAC_LUONG / STANDARD_DAYS', null, 340),
    ('Lưu Tiến Đức', 'TRU_CONG_DI_MUON', 'MONTHLY_INPUT', null, null, 530),
    ('Lưu Tiến Đức', 'PHAT_DI_MUON_KH', 'MONTHLY_INPUT', null, null, 540),
    ('Lưu Tiến Đức', 'PHAT_KHAC', 'FORMULA', 'TRU_CONG_DI_MUON * BAC_LUONG / STANDARD_DAYS', null, 550),
    ('Lưu Tiến Đức', 'THUONG_DI_SOM_KHAC', 'MONTHLY_INPUT', null, null, 590),
    ('Lưu Tiến Đức', 'KHAC_THUONG', 'MONTHLY_INPUT', null, null, 600),
    ('Lưu Tiến Đức', 'BS_LUONG', 'MONTHLY_INPUT', null, null, 610),
    ('Lưu Tiến Đức', 'PHAT_DI_MUON_QUA_LAN', 'MONTHLY_INPUT', null, null, 660),
    ('Lưu Tiến Đức', 'TONG_CONG', 'FORMULA', 'TONG_THU_NHAP - PHAT_DI_MUON_KH - PHAT_KHAC - PHAT_DI_MUON_QUA_LAN', null, 670),
    ('Lưu Tiến Đức', 'TN_MIEN_THUE', 'FORMULA', '500000 / STANDARD_DAYS * (CONG + HOLIDAY_DAYS + LEAVE_DAYS) + MIN(MIEN_THUE_TOI_DA, MIEN_THUE_THEO_CONG / STANDARD_DAYS * (CONG + HOLIDAY_DAYS + LEAVE_DAYS))', null, 680),
    ('Lưu Tiến Đức', 'GIAM_TRU', 'VALUE', null, 0, 690),
    ('Lưu Tiến Đức', 'TN_TINH_THUE', 'FORMULA', 'MAX(TONG_CONG - TN_MIEN_THUE - GIAM_TRU - TRU_BHXH - GIAM_TRU_BAN_THAN, 0)', null, 700),
    ('Lưu Tiến Đức', 'THUE_TNCN', 'FORMULA', 'BIEU_THUE_TNCN(TN_TINH_THUE)', null, 710),
    ('Lưu Tiến Đức', 'TRU_BHXH', 'FORMULA', '7000000 * TY_LE_TRU_BHXH', null, 720),
    ('Lưu Tiến Đức', 'TRU_QUY', 'FORMULA', '(LUONG_THOI_GIAN + LUONG_DT) * TY_LE_NHAP_QUY', null, 730),
    ('Nguyễn Thị Mai Anh', 'BAC_LUONG', 'VALUE', null, 5000000, 10),
    ('Nguyễn Thị Mai Anh', 'TRACH_NHIEM', 'FORMULA', '2000000 * KPIS', null, 20),
    ('Nguyễn Thị Mai Anh', 'KPIS', 'FORMULA', 'TY_LE_KPI', null, 40),
    ('Nguyễn Thị Mai Anh', 'CONG', 'FORMULA', 'WORK_DAYS', null, 50),
    ('Nguyễn Thị Mai Anh', 'LUONG_THOI_GIAN', 'FORMULA', 'BAC_LUONG / STANDARD_DAYS * CONG', null, 60),
    ('Nguyễn Thị Mai Anh', 'LUONG_DT', 'MONTHLY_INPUT', null, null, 210),
    ('Nguyễn Thị Mai Anh', 'LUONG_PHEP', 'FORMULA', 'BAC_LUONG / STANDARD_DAYS * LEAVE_DAYS', null, 220),
    ('Nguyễn Thị Mai Anh', 'LUONG_NGHI_LE', 'FORMULA', 'BAC_LUONG / STANDARD_DAYS * HOLIDAY_DAYS', null, 240),
    ('Nguyễn Thị Mai Anh', 'LE_CN', 'FORMULA', '(OT_WEEKEND_HOURS + OT_HOLIDAY_HOURS) / HOURS_PER_DAY', null, 250),
    ('Nguyễn Thị Mai Anh', 'SAU_22H', 'MONTHLY_INPUT', null, null, 260),
    ('Nguyễn Thị Mai Anh', 'LAM_THEM', 'FORMULA', '(LE_CN * HS_LE_CN + SAU_22H * HS_SAU_22H) * BAC_LUONG / STANDARD_DAYS', null, 340),
    ('Nguyễn Thị Mai Anh', 'TRU_CONG_DI_MUON', 'MONTHLY_INPUT', null, null, 530),
    ('Nguyễn Thị Mai Anh', 'PHAT_DI_MUON_KH', 'MONTHLY_INPUT', null, null, 540),
    ('Nguyễn Thị Mai Anh', 'PHAT_KHAC', 'FORMULA', 'TRU_CONG_DI_MUON * BAC_LUONG / STANDARD_DAYS', null, 550),
    ('Nguyễn Thị Mai Anh', 'THUONG_DI_SOM_KHAC', 'MONTHLY_INPUT', null, null, 590),
    ('Nguyễn Thị Mai Anh', 'KHAC_THUONG', 'MONTHLY_INPUT', null, null, 600),
    ('Nguyễn Thị Mai Anh', 'BS_LUONG', 'MONTHLY_INPUT', null, null, 610),
    ('Nguyễn Thị Mai Anh', 'PHAT_DI_MUON_QUA_LAN', 'MONTHLY_INPUT', null, null, 660),
    ('Nguyễn Thị Mai Anh', 'TONG_CONG', 'FORMULA', 'TONG_THU_NHAP - PHAT_DI_MUON_KH - PHAT_KHAC - PHAT_DI_MUON_QUA_LAN', null, 670),
    ('Nguyễn Thị Mai Anh', 'TN_MIEN_THUE', 'FORMULA', '500000 / STANDARD_DAYS * (CONG + HOLIDAY_DAYS + LEAVE_DAYS) + MIN(MIEN_THUE_TOI_DA, MIEN_THUE_THEO_CONG / STANDARD_DAYS * (CONG + HOLIDAY_DAYS + LEAVE_DAYS))', null, 680),
    ('Nguyễn Thị Mai Anh', 'GIAM_TRU', 'VALUE', null, 0, 690),
    ('Nguyễn Thị Mai Anh', 'TN_TINH_THUE', 'FORMULA', 'MAX(TONG_CONG - TN_MIEN_THUE - GIAM_TRU - TRU_BHXH - GIAM_TRU_BAN_THAN, 0)', null, 700),
    ('Nguyễn Thị Mai Anh', 'THUE_TNCN', 'FORMULA', 'BIEU_THUE_TNCN(TN_TINH_THUE)', null, 710),
    ('Nguyễn Thị Mai Anh', 'TRU_BHXH', 'FORMULA', '5500000 * TY_LE_TRU_BHXH', null, 720),
    ('Nguyễn Thị Mai Anh', 'TRU_QUY', 'FORMULA', '(LUONG_THOI_GIAN + LUONG_DT) * TY_LE_NHAP_QUY', null, 730),
    ('Mai Cẩm Tú', 'BAC_LUONG', 'VALUE', null, 5000000, 10),
    ('Mai Cẩm Tú', 'PHU_CAP', 'VALUE', null, 500000, 30),
    ('Mai Cẩm Tú', 'CONG', 'VALUE', null, 26, 50),
    ('Mai Cẩm Tú', 'LUONG_THOI_GIAN', 'FORMULA', 'MIN(BAC_LUONG / STANDARD_DAYS * CONG, BAC_LUONG) - LUONG_NGHI_LE', null, 60),
    ('Mai Cẩm Tú', 'LUONG_DT', 'MONTHLY_INPUT', null, null, 210),
    ('Mai Cẩm Tú', 'LUONG_PHEP', 'FORMULA', 'BAC_LUONG / STANDARD_DAYS * LEAVE_DAYS', null, 220),
    ('Mai Cẩm Tú', 'LUONG_NGHI_LE', 'FORMULA', 'BAC_LUONG / STANDARD_DAYS * HOLIDAY_DAYS', null, 240),
    ('Mai Cẩm Tú', 'LE_CN', 'FORMULA', '(OT_WEEKEND_HOURS + OT_HOLIDAY_HOURS) / HOURS_PER_DAY', null, 250),
    ('Mai Cẩm Tú', 'SAU_22H', 'MONTHLY_INPUT', null, null, 260),
    ('Mai Cẩm Tú', 'LAM_THEM', 'FORMULA', '(LE_CN * HS_LE_CN + SAU_22H * HS_SAU_22H) * BAC_LUONG / STANDARD_DAYS', null, 340),
    ('Mai Cẩm Tú', 'TRU_CONG_DI_MUON', 'MONTHLY_INPUT', null, null, 530),
    ('Mai Cẩm Tú', 'PHAT_DI_MUON_KH', 'MONTHLY_INPUT', null, null, 540),
    ('Mai Cẩm Tú', 'PHAT_KHAC', 'FORMULA', 'TRU_CONG_DI_MUON * BAC_LUONG / STANDARD_DAYS', null, 550),
    ('Mai Cẩm Tú', 'THUONG_DI_SOM_KHAC', 'MONTHLY_INPUT', null, null, 590),
    ('Mai Cẩm Tú', 'KHAC_THUONG', 'MONTHLY_INPUT', null, null, 600),
    ('Mai Cẩm Tú', 'BS_LUONG', 'MONTHLY_INPUT', null, null, 610),
    ('Mai Cẩm Tú', 'PHAT_DI_MUON_QUA_LAN', 'MONTHLY_INPUT', null, null, 660),
    ('Mai Cẩm Tú', 'TONG_CONG', 'FORMULA', 'TONG_THU_NHAP - PHAT_DI_MUON_KH - PHAT_KHAC - PHAT_DI_MUON_QUA_LAN', null, 670),
    ('Mai Cẩm Tú', 'TN_MIEN_THUE', 'FORMULA', '500000 / STANDARD_DAYS * (CONG + HOLIDAY_DAYS + LEAVE_DAYS)', null, 680),
    ('Mai Cẩm Tú', 'GIAM_TRU', 'VALUE', null, 0, 690),
    ('Mai Cẩm Tú', 'TN_TINH_THUE', 'FORMULA', 'MAX(TONG_CONG - TN_MIEN_THUE - GIAM_TRU - TRU_BHXH - GIAM_TRU_BAN_THAN, 0)', null, 700),
    ('Mai Cẩm Tú', 'THUE_TNCN', 'FORMULA', 'BIEU_THUE_TNCN(TN_TINH_THUE)', null, 710),
    ('Mai Cẩm Tú', 'TRU_BHXH', 'FORMULA', '5500000 * TY_LE_TRU_BHXH', null, 720),
    ('Mai Cẩm Tú', 'TRU_QUY', 'FORMULA', 'BAC_LUONG * TY_LE_NHAP_QUY', null, 730),
    ('Nguyễn Thị Hồng Nhung', 'BAC_LUONG', 'VALUE', null, 5000000, 10),
    ('Nguyễn Thị Hồng Nhung', 'PHU_CAP', 'VALUE', null, 500000, 30),
    ('Nguyễn Thị Hồng Nhung', 'CONG', 'VALUE', null, 26, 50),
    ('Nguyễn Thị Hồng Nhung', 'LUONG_THOI_GIAN', 'FORMULA', 'MIN(BAC_LUONG / STANDARD_DAYS * CONG, BAC_LUONG)', null, 60),
    ('Nguyễn Thị Hồng Nhung', 'LUONG_DT', 'MONTHLY_INPUT', null, null, 210),
    ('Nguyễn Thị Hồng Nhung', 'LUONG_PHEP', 'FORMULA', 'BAC_LUONG / STANDARD_DAYS * LEAVE_DAYS', null, 220),
    ('Nguyễn Thị Hồng Nhung', 'LUONG_NGHI_LE', 'FORMULA', 'BAC_LUONG / STANDARD_DAYS * HOLIDAY_DAYS', null, 240),
    ('Nguyễn Thị Hồng Nhung', 'LE_CN', 'FORMULA', '(OT_WEEKEND_HOURS + OT_HOLIDAY_HOURS) / HOURS_PER_DAY', null, 250),
    ('Nguyễn Thị Hồng Nhung', 'SAU_22H', 'MONTHLY_INPUT', null, null, 260),
    ('Nguyễn Thị Hồng Nhung', 'LAM_THEM', 'FORMULA', '(LE_CN * HS_LE_CN + SAU_22H * HS_SAU_22H) * BAC_LUONG / STANDARD_DAYS', null, 340),
    ('Nguyễn Thị Hồng Nhung', 'TRU_CONG_DI_MUON', 'MONTHLY_INPUT', null, null, 530),
    ('Nguyễn Thị Hồng Nhung', 'PHAT_DI_MUON_KH', 'MONTHLY_INPUT', null, null, 540),
    ('Nguyễn Thị Hồng Nhung', 'PHAT_KHAC', 'FORMULA', 'TRU_CONG_DI_MUON * BAC_LUONG / STANDARD_DAYS', null, 550),
    ('Nguyễn Thị Hồng Nhung', 'THUONG_DI_SOM_KHAC', 'MONTHLY_INPUT', null, null, 590),
    ('Nguyễn Thị Hồng Nhung', 'KHAC_THUONG', 'MONTHLY_INPUT', null, null, 600),
    ('Nguyễn Thị Hồng Nhung', 'BS_LUONG', 'MONTHLY_INPUT', null, null, 610),
    ('Nguyễn Thị Hồng Nhung', 'PHAT_DI_MUON_QUA_LAN', 'MONTHLY_INPUT', null, null, 660),
    ('Nguyễn Thị Hồng Nhung', 'TONG_CONG', 'FORMULA', 'TONG_THU_NHAP - PHAT_DI_MUON_KH - PHAT_KHAC - PHAT_DI_MUON_QUA_LAN', null, 670),
    ('Nguyễn Thị Hồng Nhung', 'TN_MIEN_THUE', 'FORMULA', '500000 / STANDARD_DAYS * (CONG + HOLIDAY_DAYS + LEAVE_DAYS)', null, 680),
    ('Nguyễn Thị Hồng Nhung', 'GIAM_TRU', 'VALUE', null, 0, 690),
    ('Nguyễn Thị Hồng Nhung', 'TN_TINH_THUE', 'FORMULA', 'MAX(TONG_CONG - TN_MIEN_THUE - GIAM_TRU - TRU_BHXH - GIAM_TRU_BAN_THAN, 0)', null, 700),
    ('Nguyễn Thị Hồng Nhung', 'THUE_TNCN', 'FORMULA', 'BIEU_THUE_TNCN(TN_TINH_THUE)', null, 710),
    ('Nguyễn Thị Hồng Nhung', 'TRU_BHXH', 'FORMULA', '5500000 * TY_LE_TRU_BHXH', null, 720),
    ('Nguyễn Thị Hồng Nhung', 'TRU_QUY', 'FORMULA', 'BAC_LUONG * TY_LE_NHAP_QUY', null, 730),
    ('Hà Thị Thu Trang', 'BAC_LUONG', 'VALUE', null, 10000000, 10),
    ('Hà Thị Thu Trang', 'KPIS', 'FORMULA', 'TY_LE_KPI', null, 40),
    ('Hà Thị Thu Trang', 'CONG', 'FORMULA', 'WORK_DAYS', null, 50),
    ('Hà Thị Thu Trang', 'LUONG_THOI_GIAN', 'FORMULA', 'BAC_LUONG / STANDARD_DAYS * CONG', null, 60),
    ('Hà Thị Thu Trang', 'LUONG_KPI', 'FORMULA', '5000000 * KPIS', null, 70),
    ('Hà Thị Thu Trang', 'LUONG_PHEP', 'FORMULA', 'BAC_LUONG / STANDARD_DAYS * LEAVE_DAYS', null, 220),
    ('Hà Thị Thu Trang', 'LAM_NGAY_LE', 'FORMULA', 'OT_HOLIDAY_HOURS / HOURS_PER_DAY', null, 230),
    ('Hà Thị Thu Trang', 'LUONG_NGHI_LE', 'FORMULA', 'BAC_LUONG / STANDARD_DAYS * HOLIDAY_DAYS + BAC_LUONG / STANDARD_DAYS * LAM_NGAY_LE * HS_LAM_NGAY_LE', null, 240),
    ('Hà Thị Thu Trang', 'DS_THU_TIEN_HANG', 'MONTHLY_INPUT', null, null, 390),
    ('Hà Thị Thu Trang', 'HE_SO_1PT', 'FORMULA', 'DS_THU_TIEN_HANG * TL_CAT_LO', null, 460),
    ('Hà Thị Thu Trang', 'LUONG_DOANH_SO', 'FORMULA', 'HE_SO_1PT', null, 510),
    ('Hà Thị Thu Trang', 'TRU_CONG_DI_MUON', 'MONTHLY_INPUT', null, null, 530),
    ('Hà Thị Thu Trang', 'PHAT_KO_BC', 'MONTHLY_INPUT', null, null, 560),
    ('Hà Thị Thu Trang', 'PHAT_CTKM', 'MONTHLY_INPUT', null, null, 570),
    ('Hà Thị Thu Trang', 'PHAT_DI_MUON_KHAC', 'MONTHLY_INPUT', null, null, 580),
    ('Hà Thị Thu Trang', 'THUONG_CTKM', 'MONTHLY_INPUT', null, null, 620),
    ('Hà Thị Thu Trang', 'THUONG_DI_SOM', 'MONTHLY_INPUT', null, null, 630),
    ('Hà Thị Thu Trang', 'BU_LUONG', 'MONTHLY_INPUT', null, null, 640),
    ('Hà Thị Thu Trang', 'THUONG_KHAC', 'MONTHLY_INPUT', null, null, 650),
    ('Hà Thị Thu Trang', 'PHAT_DI_MUON_QUA_LAN', 'FORMULA', 'TRU_CONG_DI_MUON * BAC_LUONG / STANDARD_DAYS', null, 660),
    ('Hà Thị Thu Trang', 'TONG_CONG', 'FORMULA', 'TONG_THU_NHAP - PHAT_KO_BC - PHAT_CTKM - PHAT_DI_MUON_KHAC - PHAT_DI_MUON_QUA_LAN', null, 670),
    ('Hà Thị Thu Trang', 'TN_MIEN_THUE', 'FORMULA', '1000000 / STANDARD_DAYS * (CONG + HOLIDAY_DAYS + LEAVE_DAYS) + MIN(MIEN_THUE_TOI_DA, MIEN_THUE_THEO_CONG / STANDARD_DAYS * (CONG + HOLIDAY_DAYS + LEAVE_DAYS))', null, 680),
    ('Hà Thị Thu Trang', 'GIAM_TRU', 'FORMULA', '2 * GIAM_TRU_NPT', null, 690),
    ('Hà Thị Thu Trang', 'TN_TINH_THUE', 'FORMULA', 'MAX(TONG_CONG - TN_MIEN_THUE - GIAM_TRU - TRU_BHXH - GIAM_TRU_BAN_THAN, 0)', null, 700),
    ('Hà Thị Thu Trang', 'THUE_TNCN', 'FORMULA', 'BIEU_THUE_TNCN(TN_TINH_THUE)', null, 710),
    ('Hà Thị Thu Trang', 'TRU_BHXH', 'FORMULA', '15000000 * TY_LE_TRU_BHXH', null, 720),
    ('Hà Thị Thu Trang', 'TRU_QUY', 'FORMULA', '(LUONG_THOI_GIAN + LUONG_DOANH_SO) * TY_LE_NHAP_QUY', null, 730),
    ('Nguyễn Minh Tảo', 'BAC_LUONG', 'VALUE', null, 8000000, 10),
    ('Nguyễn Minh Tảo', 'KPIS', 'FORMULA', 'TY_LE_KPI', null, 40),
    ('Nguyễn Minh Tảo', 'CONG', 'FORMULA', 'WORK_DAYS', null, 50),
    ('Nguyễn Minh Tảo', 'LUONG_THOI_GIAN', 'FORMULA', 'BAC_LUONG / STANDARD_DAYS * CONG', null, 60),
    ('Nguyễn Minh Tảo', 'LUONG_KPI', 'FORMULA', 'BAC_LUONG / 3 * KPIS', null, 70),
    ('Nguyễn Minh Tảo', 'LUONG_PHEP', 'FORMULA', 'BAC_LUONG / STANDARD_DAYS * LEAVE_DAYS', null, 220),
    ('Nguyễn Minh Tảo', 'LAM_NGAY_LE', 'FORMULA', 'OT_HOLIDAY_HOURS / HOURS_PER_DAY', null, 230),
    ('Nguyễn Minh Tảo', 'LUONG_NGHI_LE', 'FORMULA', 'BAC_LUONG / STANDARD_DAYS * HOLIDAY_DAYS + BAC_LUONG / STANDARD_DAYS * LAM_NGAY_LE * HS_LAM_NGAY_LE', null, 240),
    ('Nguyễn Minh Tảo', 'SO_THU_TIEN', 'MONTHLY_INPUT', null, null, 350),
    ('Nguyễn Minh Tảo', 'GIAM_TRU_SO_THU', 'MONTHLY_INPUT', null, null, 360),
    ('Nguyễn Minh Tảo', 'DS_TINH_LUONG', 'FORMULA', 'SO_THU_TIEN - GIAM_TRU_SO_THU', null, 370),
    ('Nguyễn Minh Tảo', 'DT_CAT_LO', 'MONTHLY_INPUT', null, null, 380),
    ('Nguyễn Minh Tảo', 'DS_THU_TIEN_HANG', 'FORMULA', 'DS_TINH_LUONG - DT_CAT_LO', null, 390),
    ('Nguyễn Minh Tảo', 'DOANH_SO_KHOAN', 'MONTHLY_INPUT', null, null, 400),
    ('Nguyễn Minh Tảo', 'HE_SO_PT', 'FORMULA', 'IF(DOANH_SO_KHOAN > 0, (DT_CAT_LO + DS_THU_TIEN_HANG) / DOANH_SO_KHOAN, 0)', null, 410),
    ('Nguyễn Minh Tảo', 'SO_THU_CAT_MA', 'MONTHLY_INPUT', null, null, 420),
    ('Nguyễn Minh Tảo', 'GIAM_TRU_CAT_MA', 'MONTHLY_INPUT', null, null, 430),
    ('Nguyễn Minh Tảo', 'DS_CAT_MA', 'FORMULA', 'SO_THU_CAT_MA - GIAM_TRU_CAT_MA', null, 440),
    ('Nguyễn Minh Tảo', 'HE_SO_1PT_CAT_MA', 'FORMULA', 'DS_CAT_MA * TL_CAT_MA', null, 450),
    ('Nguyễn Minh Tảo', 'HE_SO_1PT', 'FORMULA', 'IF(HE_SO_PT < MOC_75, 0, DT_CAT_LO * TL_CAT_LO)', null, 460),
    ('Nguyễn Minh Tảo', 'HE_SO_1_5PT', 'FORMULA', 'IF(HE_SO_PT >= MOC_75 && HE_SO_PT < MOC_90, DS_THU_TIEN_HANG * TL_MOC_75, 0)', null, 470),
    ('Nguyễn Minh Tảo', 'HE_SO_3PT', 'FORMULA', 'IF(HE_SO_PT >= MOC_90 && HE_SO_PT < MOC_105, DS_THU_TIEN_HANG * TL_MOC_90, 0)', null, 480),
    ('Nguyễn Minh Tảo', 'HE_SO_4PT', 'FORMULA', 'IF(HE_SO_PT >= MOC_105, DS_THU_TIEN_HANG * TL_MOC_105, 0)', null, 490),
    ('Nguyễn Minh Tảo', 'THUONG_DS_150', 'FORMULA', 'IF(HE_SO_PT >= MOC_150, BAC_LUONG * TL_THUONG_150, 0)', null, 500),
    ('Nguyễn Minh Tảo', 'LUONG_DOANH_SO', 'FORMULA', 'HE_SO_1PT_CAT_MA + HE_SO_1PT + HE_SO_1_5PT + HE_SO_3PT + HE_SO_4PT + THUONG_DS_150', null, 510),
    ('Nguyễn Minh Tảo', 'PHU_CAP_TRACH_NHIEM', 'VALUE', null, 500000, 520),
    ('Nguyễn Minh Tảo', 'TRU_CONG_DI_MUON', 'MONTHLY_INPUT', null, null, 530),
    ('Nguyễn Minh Tảo', 'PHAT_KO_BC', 'MONTHLY_INPUT', null, null, 560),
    ('Nguyễn Minh Tảo', 'PHAT_CTKM', 'MONTHLY_INPUT', null, null, 570),
    ('Nguyễn Minh Tảo', 'PHAT_DI_MUON_KHAC', 'MONTHLY_INPUT', null, null, 580),
    ('Nguyễn Minh Tảo', 'THUONG_CTKM', 'MONTHLY_INPUT', null, null, 620),
    ('Nguyễn Minh Tảo', 'THUONG_DI_SOM', 'MONTHLY_INPUT', null, null, 630),
    ('Nguyễn Minh Tảo', 'BU_LUONG', 'MONTHLY_INPUT', null, null, 640),
    ('Nguyễn Minh Tảo', 'THUONG_KHAC', 'MONTHLY_INPUT', null, null, 650),
    ('Nguyễn Minh Tảo', 'PHAT_DI_MUON_QUA_LAN', 'FORMULA', 'TRU_CONG_DI_MUON * BAC_LUONG / STANDARD_DAYS', null, 660),
    ('Nguyễn Minh Tảo', 'TONG_CONG', 'FORMULA', 'TONG_THU_NHAP - PHAT_KO_BC - PHAT_CTKM - PHAT_DI_MUON_KHAC - PHAT_DI_MUON_QUA_LAN', null, 670),
    ('Nguyễn Minh Tảo', 'TN_MIEN_THUE', 'FORMULA', '1000000 / STANDARD_DAYS * (CONG + HOLIDAY_DAYS + LEAVE_DAYS) + MIN(MIEN_THUE_TOI_DA, MIEN_THUE_THEO_CONG / STANDARD_DAYS * (CONG + HOLIDAY_DAYS + LEAVE_DAYS))', null, 680),
    ('Nguyễn Minh Tảo', 'GIAM_TRU', 'FORMULA', '2 * GIAM_TRU_NPT', null, 690),
    ('Nguyễn Minh Tảo', 'TN_TINH_THUE', 'FORMULA', 'MAX(TONG_CONG - TN_MIEN_THUE - GIAM_TRU - TRU_BHXH - GIAM_TRU_BAN_THAN, 0)', null, 700),
    ('Nguyễn Minh Tảo', 'THUE_TNCN', 'FORMULA', 'BIEU_THUE_TNCN(TN_TINH_THUE)', null, 710),
    ('Nguyễn Minh Tảo', 'TRU_BHXH', 'FORMULA', '10000000 * TY_LE_TRU_BHXH', null, 720),
    ('Nguyễn Minh Tảo', 'TRU_QUY', 'FORMULA', '(LUONG_THOI_GIAN + LUONG_DOANH_SO) * TY_LE_NHAP_QUY', null, 730),
    ('Lê Văn Lợi', 'BAC_LUONG', 'VALUE', null, 8000000, 10),
    ('Lê Văn Lợi', 'KPIS', 'FORMULA', 'TY_LE_KPI', null, 40),
    ('Lê Văn Lợi', 'CONG', 'FORMULA', 'WORK_DAYS', null, 50),
    ('Lê Văn Lợi', 'LUONG_THOI_GIAN', 'FORMULA', 'BAC_LUONG / STANDARD_DAYS * CONG', null, 60),
    ('Lê Văn Lợi', 'LUONG_KPI', 'FORMULA', 'BAC_LUONG / 3 * KPIS', null, 70),
    ('Lê Văn Lợi', 'LUONG_PHEP', 'FORMULA', 'BAC_LUONG / STANDARD_DAYS * LEAVE_DAYS', null, 220),
    ('Lê Văn Lợi', 'LAM_NGAY_LE', 'FORMULA', 'OT_HOLIDAY_HOURS / HOURS_PER_DAY', null, 230),
    ('Lê Văn Lợi', 'LUONG_NGHI_LE', 'FORMULA', 'BAC_LUONG / STANDARD_DAYS * HOLIDAY_DAYS + BAC_LUONG / STANDARD_DAYS * LAM_NGAY_LE * HS_LAM_NGAY_LE', null, 240),
    ('Lê Văn Lợi', 'SO_THU_TIEN', 'MONTHLY_INPUT', null, null, 350),
    ('Lê Văn Lợi', 'GIAM_TRU_SO_THU', 'MONTHLY_INPUT', null, null, 360),
    ('Lê Văn Lợi', 'DS_TINH_LUONG', 'FORMULA', 'SO_THU_TIEN - GIAM_TRU_SO_THU', null, 370),
    ('Lê Văn Lợi', 'DT_CAT_LO', 'MONTHLY_INPUT', null, null, 380),
    ('Lê Văn Lợi', 'DS_THU_TIEN_HANG', 'FORMULA', 'DS_TINH_LUONG - DT_CAT_LO', null, 390),
    ('Lê Văn Lợi', 'DOANH_SO_KHOAN', 'MONTHLY_INPUT', null, null, 400),
    ('Lê Văn Lợi', 'HE_SO_PT', 'FORMULA', 'IF(DOANH_SO_KHOAN > 0, (DT_CAT_LO + DS_THU_TIEN_HANG) / DOANH_SO_KHOAN, 0)', null, 410),
    ('Lê Văn Lợi', 'SO_THU_CAT_MA', 'MONTHLY_INPUT', null, null, 420),
    ('Lê Văn Lợi', 'GIAM_TRU_CAT_MA', 'MONTHLY_INPUT', null, null, 430),
    ('Lê Văn Lợi', 'DS_CAT_MA', 'FORMULA', 'SO_THU_CAT_MA - GIAM_TRU_CAT_MA', null, 440),
    ('Lê Văn Lợi', 'HE_SO_1PT_CAT_MA', 'FORMULA', 'DS_CAT_MA * TL_CAT_MA', null, 450),
    ('Lê Văn Lợi', 'HE_SO_1PT', 'FORMULA', 'IF(HE_SO_PT < MOC_75, 0, DT_CAT_LO * TL_CAT_LO)', null, 460),
    ('Lê Văn Lợi', 'HE_SO_1_5PT', 'FORMULA', 'IF(HE_SO_PT >= MOC_75 && HE_SO_PT < MOC_90, DS_THU_TIEN_HANG * TL_MOC_75, 0)', null, 470),
    ('Lê Văn Lợi', 'HE_SO_3PT', 'FORMULA', 'IF(HE_SO_PT >= MOC_90 && HE_SO_PT < MOC_105, DS_THU_TIEN_HANG * TL_MOC_90, 0)', null, 480),
    ('Lê Văn Lợi', 'HE_SO_4PT', 'FORMULA', 'IF(HE_SO_PT >= MOC_105, DS_THU_TIEN_HANG * TL_MOC_105, 0)', null, 490),
    ('Lê Văn Lợi', 'THUONG_DS_150', 'FORMULA', 'IF(HE_SO_PT >= MOC_150, BAC_LUONG * TL_THUONG_150, 0)', null, 500),
    ('Lê Văn Lợi', 'LUONG_DOANH_SO', 'FORMULA', 'HE_SO_1PT_CAT_MA + HE_SO_1PT + HE_SO_1_5PT + HE_SO_3PT + HE_SO_4PT + THUONG_DS_150', null, 510),
    ('Lê Văn Lợi', 'PHU_CAP_TRACH_NHIEM', 'VALUE', null, 1000000, 520),
    ('Lê Văn Lợi', 'TRU_CONG_DI_MUON', 'MONTHLY_INPUT', null, null, 530),
    ('Lê Văn Lợi', 'PHAT_KO_BC', 'MONTHLY_INPUT', null, null, 560),
    ('Lê Văn Lợi', 'PHAT_CTKM', 'MONTHLY_INPUT', null, null, 570),
    ('Lê Văn Lợi', 'PHAT_DI_MUON_KHAC', 'MONTHLY_INPUT', null, null, 580),
    ('Lê Văn Lợi', 'THUONG_CTKM', 'MONTHLY_INPUT', null, null, 620),
    ('Lê Văn Lợi', 'THUONG_DI_SOM', 'MONTHLY_INPUT', null, null, 630),
    ('Lê Văn Lợi', 'BU_LUONG', 'MONTHLY_INPUT', null, null, 640),
    ('Lê Văn Lợi', 'THUONG_KHAC', 'MONTHLY_INPUT', null, null, 650),
    ('Lê Văn Lợi', 'PHAT_DI_MUON_QUA_LAN', 'FORMULA', 'TRU_CONG_DI_MUON * BAC_LUONG / STANDARD_DAYS', null, 660),
    ('Lê Văn Lợi', 'TONG_CONG', 'FORMULA', 'TONG_THU_NHAP - PHAT_KO_BC - PHAT_CTKM - PHAT_DI_MUON_KHAC - PHAT_DI_MUON_QUA_LAN', null, 670),
    ('Lê Văn Lợi', 'TN_TINH_THUE', 'FORMULA', 'TONG_CONG', null, 700),
    ('Lê Văn Lợi', 'THUE_TNCN', 'FORMULA', 'TN_TINH_THUE * 0.1', null, 710),
    ('Lê Văn Lợi', 'TRU_QUY', 'FORMULA', '(LUONG_THOI_GIAN + LUONG_DOANH_SO) * TY_LE_NHAP_QUY', null, 730),
    ('Hồ Linh Chi', 'BAC_LUONG', 'VALUE', null, 8000000, 10),
    ('Hồ Linh Chi', 'KPIS', 'FORMULA', 'TY_LE_KPI', null, 40),
    ('Hồ Linh Chi', 'CONG', 'FORMULA', 'WORK_DAYS', null, 50),
    ('Hồ Linh Chi', 'LUONG_THOI_GIAN', 'FORMULA', 'BAC_LUONG / STANDARD_DAYS * CONG', null, 60),
    ('Hồ Linh Chi', 'LUONG_KPI', 'FORMULA', 'BAC_LUONG / 3 * KPIS', null, 70),
    ('Hồ Linh Chi', 'LUONG_PHEP', 'FORMULA', 'BAC_LUONG / STANDARD_DAYS * LEAVE_DAYS', null, 220),
    ('Hồ Linh Chi', 'LAM_NGAY_LE', 'FORMULA', 'OT_HOLIDAY_HOURS / HOURS_PER_DAY', null, 230),
    ('Hồ Linh Chi', 'LUONG_NGHI_LE', 'FORMULA', 'BAC_LUONG / STANDARD_DAYS * HOLIDAY_DAYS + BAC_LUONG / STANDARD_DAYS * LAM_NGAY_LE * HS_LAM_NGAY_LE', null, 240),
    ('Hồ Linh Chi', 'SO_THU_TIEN', 'MONTHLY_INPUT', null, null, 350),
    ('Hồ Linh Chi', 'GIAM_TRU_SO_THU', 'MONTHLY_INPUT', null, null, 360),
    ('Hồ Linh Chi', 'DS_TINH_LUONG', 'FORMULA', 'SO_THU_TIEN - GIAM_TRU_SO_THU', null, 370),
    ('Hồ Linh Chi', 'DT_CAT_LO', 'MONTHLY_INPUT', null, null, 380),
    ('Hồ Linh Chi', 'DS_THU_TIEN_HANG', 'FORMULA', 'DS_TINH_LUONG - DT_CAT_LO', null, 390),
    ('Hồ Linh Chi', 'DOANH_SO_KHOAN', 'MONTHLY_INPUT', null, null, 400),
    ('Hồ Linh Chi', 'HE_SO_PT', 'FORMULA', 'IF(DOANH_SO_KHOAN > 0, (DT_CAT_LO + DS_THU_TIEN_HANG) / DOANH_SO_KHOAN, 0)', null, 410),
    ('Hồ Linh Chi', 'SO_THU_CAT_MA', 'MONTHLY_INPUT', null, null, 420),
    ('Hồ Linh Chi', 'GIAM_TRU_CAT_MA', 'MONTHLY_INPUT', null, null, 430),
    ('Hồ Linh Chi', 'DS_CAT_MA', 'FORMULA', 'SO_THU_CAT_MA - GIAM_TRU_CAT_MA', null, 440),
    ('Hồ Linh Chi', 'HE_SO_1PT_CAT_MA', 'FORMULA', 'DS_CAT_MA * TL_CAT_MA', null, 450),
    ('Hồ Linh Chi', 'HE_SO_1PT', 'FORMULA', 'IF(HE_SO_PT < MOC_75, 0, DT_CAT_LO * TL_CAT_LO)', null, 460),
    ('Hồ Linh Chi', 'HE_SO_1_5PT', 'FORMULA', 'IF(HE_SO_PT >= MOC_75 && HE_SO_PT < MOC_90, DS_THU_TIEN_HANG * TL_MOC_75, 0)', null, 470),
    ('Hồ Linh Chi', 'HE_SO_3PT', 'FORMULA', 'IF(HE_SO_PT >= MOC_90 && HE_SO_PT < MOC_105, DS_THU_TIEN_HANG * TL_MOC_90, 0)', null, 480),
    ('Hồ Linh Chi', 'HE_SO_4PT', 'FORMULA', 'IF(HE_SO_PT >= MOC_105, DS_THU_TIEN_HANG * TL_MOC_105, 0)', null, 490),
    ('Hồ Linh Chi', 'THUONG_DS_150', 'FORMULA', 'IF(HE_SO_PT >= MOC_150, BAC_LUONG * TL_THUONG_150, 0)', null, 500),
    ('Hồ Linh Chi', 'LUONG_DOANH_SO', 'FORMULA', 'HE_SO_1PT_CAT_MA + HE_SO_1PT + HE_SO_1_5PT + HE_SO_3PT + HE_SO_4PT + THUONG_DS_150', null, 510),
    ('Hồ Linh Chi', 'TRU_CONG_DI_MUON', 'MONTHLY_INPUT', null, null, 530),
    ('Hồ Linh Chi', 'PHAT_KO_BC', 'MONTHLY_INPUT', null, null, 560),
    ('Hồ Linh Chi', 'PHAT_CTKM', 'MONTHLY_INPUT', null, null, 570),
    ('Hồ Linh Chi', 'PHAT_DI_MUON_KHAC', 'MONTHLY_INPUT', null, null, 580),
    ('Hồ Linh Chi', 'THUONG_CTKM', 'MONTHLY_INPUT', null, null, 620),
    ('Hồ Linh Chi', 'THUONG_DI_SOM', 'MONTHLY_INPUT', null, null, 630),
    ('Hồ Linh Chi', 'BU_LUONG', 'MONTHLY_INPUT', null, null, 640),
    ('Hồ Linh Chi', 'THUONG_KHAC', 'MONTHLY_INPUT', null, null, 650),
    ('Hồ Linh Chi', 'PHAT_DI_MUON_QUA_LAN', 'FORMULA', 'TRU_CONG_DI_MUON * BAC_LUONG / STANDARD_DAYS', null, 660),
    ('Hồ Linh Chi', 'TONG_CONG', 'FORMULA', 'TONG_THU_NHAP - PHAT_KO_BC - PHAT_CTKM - PHAT_DI_MUON_KHAC - PHAT_DI_MUON_QUA_LAN', null, 670),
    ('Hồ Linh Chi', 'TN_MIEN_THUE', 'FORMULA', '500000 / STANDARD_DAYS * (CONG + HOLIDAY_DAYS + LEAVE_DAYS) + MIN(MIEN_THUE_TOI_DA, MIEN_THUE_THEO_CONG / STANDARD_DAYS * (CONG + HOLIDAY_DAYS + LEAVE_DAYS))', null, 680),
    ('Hồ Linh Chi', 'GIAM_TRU', 'VALUE', null, 0, 690),
    ('Hồ Linh Chi', 'TN_TINH_THUE', 'FORMULA', 'MAX(TONG_CONG - TN_MIEN_THUE - GIAM_TRU - TRU_BHXH - GIAM_TRU_BAN_THAN, 0)', null, 700),
    ('Hồ Linh Chi', 'THUE_TNCN', 'FORMULA', 'BIEU_THUE_TNCN(TN_TINH_THUE)', null, 710),
    ('Hồ Linh Chi', 'TRU_BHXH', 'FORMULA', '6600000 * TY_LE_TRU_BHXH', null, 720),
    ('Hồ Linh Chi', 'TRU_QUY', 'FORMULA', '(LUONG_THOI_GIAN + LUONG_DOANH_SO) * TY_LE_NHAP_QUY', null, 730),
    ('Nguyễn Huỳnh Đức', 'BAC_LUONG', 'VALUE', null, 8000000, 10),
    ('Nguyễn Huỳnh Đức', 'KPIS', 'FORMULA', 'TY_LE_KPI', null, 40),
    ('Nguyễn Huỳnh Đức', 'CONG', 'FORMULA', 'WORK_DAYS', null, 50),
    ('Nguyễn Huỳnh Đức', 'LUONG_THOI_GIAN', 'FORMULA', 'BAC_LUONG / STANDARD_DAYS * CONG', null, 60),
    ('Nguyễn Huỳnh Đức', 'LUONG_KPI', 'FORMULA', 'BAC_LUONG / 3 * KPIS', null, 70),
    ('Nguyễn Huỳnh Đức', 'LUONG_PHEP', 'FORMULA', 'BAC_LUONG / STANDARD_DAYS * LEAVE_DAYS', null, 220),
    ('Nguyễn Huỳnh Đức', 'LAM_NGAY_LE', 'FORMULA', 'OT_HOLIDAY_HOURS / HOURS_PER_DAY', null, 230),
    ('Nguyễn Huỳnh Đức', 'LUONG_NGHI_LE', 'FORMULA', 'BAC_LUONG / STANDARD_DAYS * HOLIDAY_DAYS + BAC_LUONG / STANDARD_DAYS * LAM_NGAY_LE * HS_LAM_NGAY_LE', null, 240),
    ('Nguyễn Huỳnh Đức', 'SO_THU_TIEN', 'MONTHLY_INPUT', null, null, 350),
    ('Nguyễn Huỳnh Đức', 'GIAM_TRU_SO_THU', 'MONTHLY_INPUT', null, null, 360),
    ('Nguyễn Huỳnh Đức', 'DS_TINH_LUONG', 'FORMULA', 'SO_THU_TIEN - GIAM_TRU_SO_THU', null, 370),
    ('Nguyễn Huỳnh Đức', 'DT_CAT_LO', 'MONTHLY_INPUT', null, null, 380),
    ('Nguyễn Huỳnh Đức', 'DS_THU_TIEN_HANG', 'FORMULA', 'DS_TINH_LUONG - DT_CAT_LO', null, 390),
    ('Nguyễn Huỳnh Đức', 'DOANH_SO_KHOAN', 'MONTHLY_INPUT', null, null, 400),
    ('Nguyễn Huỳnh Đức', 'HE_SO_PT', 'FORMULA', 'IF(DOANH_SO_KHOAN > 0, (DT_CAT_LO + DS_THU_TIEN_HANG) / DOANH_SO_KHOAN, 0)', null, 410),
    ('Nguyễn Huỳnh Đức', 'SO_THU_CAT_MA', 'MONTHLY_INPUT', null, null, 420),
    ('Nguyễn Huỳnh Đức', 'GIAM_TRU_CAT_MA', 'MONTHLY_INPUT', null, null, 430),
    ('Nguyễn Huỳnh Đức', 'DS_CAT_MA', 'FORMULA', 'SO_THU_CAT_MA - GIAM_TRU_CAT_MA', null, 440),
    ('Nguyễn Huỳnh Đức', 'HE_SO_1PT_CAT_MA', 'FORMULA', 'DS_CAT_MA * TL_CAT_MA', null, 450),
    ('Nguyễn Huỳnh Đức', 'HE_SO_1PT', 'FORMULA', 'IF(HE_SO_PT < MOC_75, 0, DT_CAT_LO * TL_CAT_LO)', null, 460),
    ('Nguyễn Huỳnh Đức', 'HE_SO_1_5PT', 'FORMULA', 'IF(HE_SO_PT >= MOC_75 && HE_SO_PT < MOC_90, DS_THU_TIEN_HANG * TL_MOC_75, 0)', null, 470),
    ('Nguyễn Huỳnh Đức', 'HE_SO_3PT', 'FORMULA', 'IF(HE_SO_PT >= MOC_90 && HE_SO_PT < MOC_105, DS_THU_TIEN_HANG * TL_MOC_90, 0)', null, 480),
    ('Nguyễn Huỳnh Đức', 'HE_SO_4PT', 'FORMULA', 'IF(HE_SO_PT >= MOC_105, DS_THU_TIEN_HANG * TL_MOC_105, 0)', null, 490),
    ('Nguyễn Huỳnh Đức', 'THUONG_DS_150', 'FORMULA', 'IF(HE_SO_PT >= MOC_150, BAC_LUONG * TL_THUONG_150, 0)', null, 500),
    ('Nguyễn Huỳnh Đức', 'LUONG_DOANH_SO', 'FORMULA', 'HE_SO_1PT_CAT_MA + HE_SO_1PT + HE_SO_1_5PT + HE_SO_3PT + HE_SO_4PT + THUONG_DS_150', null, 510),
    ('Nguyễn Huỳnh Đức', 'PHU_CAP_TRACH_NHIEM', 'VALUE', null, 3000000, 520),
    ('Nguyễn Huỳnh Đức', 'TRU_CONG_DI_MUON', 'MONTHLY_INPUT', null, null, 530),
    ('Nguyễn Huỳnh Đức', 'PHAT_KO_BC', 'MONTHLY_INPUT', null, null, 560),
    ('Nguyễn Huỳnh Đức', 'PHAT_CTKM', 'MONTHLY_INPUT', null, null, 570),
    ('Nguyễn Huỳnh Đức', 'PHAT_DI_MUON_KHAC', 'MONTHLY_INPUT', null, null, 580),
    ('Nguyễn Huỳnh Đức', 'THUONG_CTKM', 'MONTHLY_INPUT', null, null, 620),
    ('Nguyễn Huỳnh Đức', 'THUONG_DI_SOM', 'MONTHLY_INPUT', null, null, 630),
    ('Nguyễn Huỳnh Đức', 'BU_LUONG', 'MONTHLY_INPUT', null, null, 640),
    ('Nguyễn Huỳnh Đức', 'THUONG_KHAC', 'MONTHLY_INPUT', null, null, 650),
    ('Nguyễn Huỳnh Đức', 'PHAT_DI_MUON_QUA_LAN', 'FORMULA', 'TRU_CONG_DI_MUON * BAC_LUONG / STANDARD_DAYS', null, 660),
    ('Nguyễn Huỳnh Đức', 'TONG_CONG', 'FORMULA', 'TONG_THU_NHAP - PHAT_KO_BC - PHAT_CTKM - PHAT_DI_MUON_KHAC - PHAT_DI_MUON_QUA_LAN', null, 670),
    ('Nguyễn Huỳnh Đức', 'TN_MIEN_THUE', 'FORMULA', '500000 / STANDARD_DAYS * (CONG + HOLIDAY_DAYS + LEAVE_DAYS) + MIN(MIEN_THUE_TOI_DA, MIEN_THUE_THEO_CONG / STANDARD_DAYS * (CONG + HOLIDAY_DAYS + LEAVE_DAYS))', null, 680),
    ('Nguyễn Huỳnh Đức', 'GIAM_TRU', 'VALUE', null, 0, 690),
    ('Nguyễn Huỳnh Đức', 'TN_TINH_THUE', 'FORMULA', 'MAX(TONG_CONG - TN_MIEN_THUE - GIAM_TRU - TRU_BHXH - GIAM_TRU_BAN_THAN, 0)', null, 700),
    ('Nguyễn Huỳnh Đức', 'THUE_TNCN', 'FORMULA', 'BIEU_THUE_TNCN(TN_TINH_THUE)', null, 710),
    ('Nguyễn Huỳnh Đức', 'TRU_BHXH', 'FORMULA', '6600000 * TY_LE_TRU_BHXH', null, 720),
    ('Nguyễn Huỳnh Đức', 'TRU_QUY', 'FORMULA', '(LUONG_THOI_GIAN + LUONG_DOANH_SO) * TY_LE_NHAP_QUY', null, 730),
    ('Vũ Thị Hòa', 'BAC_LUONG', 'VALUE', null, 8000000, 10),
    ('Vũ Thị Hòa', 'KPIS', 'FORMULA', 'TY_LE_KPI', null, 40),
    ('Vũ Thị Hòa', 'CONG', 'FORMULA', 'WORK_DAYS', null, 50),
    ('Vũ Thị Hòa', 'LUONG_THOI_GIAN', 'FORMULA', 'BAC_LUONG / STANDARD_DAYS * CONG', null, 60),
    ('Vũ Thị Hòa', 'LUONG_KPI', 'FORMULA', 'BAC_LUONG / 3 * KPIS', null, 70),
    ('Vũ Thị Hòa', 'LUONG_PHEP', 'FORMULA', 'BAC_LUONG / STANDARD_DAYS * LEAVE_DAYS', null, 220),
    ('Vũ Thị Hòa', 'LAM_NGAY_LE', 'FORMULA', 'OT_HOLIDAY_HOURS / HOURS_PER_DAY', null, 230),
    ('Vũ Thị Hòa', 'LUONG_NGHI_LE', 'FORMULA', 'BAC_LUONG / STANDARD_DAYS * HOLIDAY_DAYS + BAC_LUONG / STANDARD_DAYS * LAM_NGAY_LE * HS_LAM_NGAY_LE', null, 240),
    ('Vũ Thị Hòa', 'SO_THU_TIEN', 'MONTHLY_INPUT', null, null, 350),
    ('Vũ Thị Hòa', 'GIAM_TRU_SO_THU', 'MONTHLY_INPUT', null, null, 360),
    ('Vũ Thị Hòa', 'DS_TINH_LUONG', 'FORMULA', 'SO_THU_TIEN - GIAM_TRU_SO_THU', null, 370),
    ('Vũ Thị Hòa', 'DT_CAT_LO', 'MONTHLY_INPUT', null, null, 380),
    ('Vũ Thị Hòa', 'DS_THU_TIEN_HANG', 'FORMULA', 'DS_TINH_LUONG - DT_CAT_LO', null, 390),
    ('Vũ Thị Hòa', 'DOANH_SO_KHOAN', 'MONTHLY_INPUT', null, null, 400),
    ('Vũ Thị Hòa', 'HE_SO_PT', 'FORMULA', 'IF(DOANH_SO_KHOAN > 0, (DT_CAT_LO + DS_THU_TIEN_HANG) / DOANH_SO_KHOAN, 0)', null, 410),
    ('Vũ Thị Hòa', 'SO_THU_CAT_MA', 'MONTHLY_INPUT', null, null, 420),
    ('Vũ Thị Hòa', 'GIAM_TRU_CAT_MA', 'MONTHLY_INPUT', null, null, 430),
    ('Vũ Thị Hòa', 'DS_CAT_MA', 'FORMULA', 'SO_THU_CAT_MA - GIAM_TRU_CAT_MA', null, 440),
    ('Vũ Thị Hòa', 'HE_SO_1PT_CAT_MA', 'FORMULA', 'DS_CAT_MA * TL_CAT_MA', null, 450),
    ('Vũ Thị Hòa', 'HE_SO_1PT', 'FORMULA', 'IF(HE_SO_PT < MOC_75, 0, DT_CAT_LO * TL_CAT_LO)', null, 460),
    ('Vũ Thị Hòa', 'HE_SO_1_5PT', 'FORMULA', 'IF(HE_SO_PT >= MOC_75 && HE_SO_PT < MOC_90, DS_THU_TIEN_HANG * TL_MOC_75, 0)', null, 470),
    ('Vũ Thị Hòa', 'HE_SO_3PT', 'FORMULA', 'IF(HE_SO_PT >= MOC_90 && HE_SO_PT < MOC_105, DS_THU_TIEN_HANG * TL_MOC_90, 0)', null, 480),
    ('Vũ Thị Hòa', 'HE_SO_4PT', 'FORMULA', 'IF(HE_SO_PT >= MOC_105, DS_THU_TIEN_HANG * TL_MOC_105, 0)', null, 490),
    ('Vũ Thị Hòa', 'THUONG_DS_150', 'FORMULA', 'IF(HE_SO_PT >= MOC_150, BAC_LUONG * TL_THUONG_150, 0)', null, 500),
    ('Vũ Thị Hòa', 'LUONG_DOANH_SO', 'FORMULA', 'HE_SO_1PT_CAT_MA + HE_SO_1PT + HE_SO_1_5PT + HE_SO_3PT + HE_SO_4PT + THUONG_DS_150', null, 510),
    ('Vũ Thị Hòa', 'TRU_CONG_DI_MUON', 'MONTHLY_INPUT', null, null, 530),
    ('Vũ Thị Hòa', 'PHAT_KO_BC', 'MONTHLY_INPUT', null, null, 560),
    ('Vũ Thị Hòa', 'PHAT_CTKM', 'MONTHLY_INPUT', null, null, 570),
    ('Vũ Thị Hòa', 'PHAT_DI_MUON_KHAC', 'MONTHLY_INPUT', null, null, 580),
    ('Vũ Thị Hòa', 'THUONG_CTKM', 'MONTHLY_INPUT', null, null, 620),
    ('Vũ Thị Hòa', 'THUONG_DI_SOM', 'MONTHLY_INPUT', null, null, 630),
    ('Vũ Thị Hòa', 'BU_LUONG', 'MONTHLY_INPUT', null, null, 640),
    ('Vũ Thị Hòa', 'THUONG_KHAC', 'MONTHLY_INPUT', null, null, 650),
    ('Vũ Thị Hòa', 'PHAT_DI_MUON_QUA_LAN', 'FORMULA', 'TRU_CONG_DI_MUON * BAC_LUONG / STANDARD_DAYS', null, 660),
    ('Vũ Thị Hòa', 'TONG_CONG', 'FORMULA', 'TONG_THU_NHAP - PHAT_KO_BC - PHAT_CTKM - PHAT_DI_MUON_KHAC - PHAT_DI_MUON_QUA_LAN', null, 670),
    ('Vũ Thị Hòa', 'TN_MIEN_THUE', 'FORMULA', '500000 / STANDARD_DAYS * (CONG + HOLIDAY_DAYS + LEAVE_DAYS) + MIN(MIEN_THUE_TOI_DA, MIEN_THUE_THEO_CONG / STANDARD_DAYS * (CONG + HOLIDAY_DAYS + LEAVE_DAYS))', null, 680),
    ('Vũ Thị Hòa', 'GIAM_TRU', 'FORMULA', '2 * GIAM_TRU_NPT', null, 690),
    ('Vũ Thị Hòa', 'TN_TINH_THUE', 'FORMULA', 'MAX(TONG_CONG - TN_MIEN_THUE - GIAM_TRU - TRU_BHXH - GIAM_TRU_BAN_THAN, 0)', null, 700),
    ('Vũ Thị Hòa', 'THUE_TNCN', 'FORMULA', 'BIEU_THUE_TNCN(TN_TINH_THUE)', null, 710),
    ('Vũ Thị Hòa', 'TRU_QUY', 'FORMULA', '(LUONG_THOI_GIAN + LUONG_DOANH_SO) * TY_LE_NHAP_QUY', null, 730),
    ('Vũ Thị Thanh Thúy', 'BAC_LUONG', 'VALUE', null, 8000000, 10),
    ('Vũ Thị Thanh Thúy', 'KPIS', 'FORMULA', 'TY_LE_KPI', null, 40),
    ('Vũ Thị Thanh Thúy', 'CONG', 'FORMULA', 'WORK_DAYS', null, 50),
    ('Vũ Thị Thanh Thúy', 'LUONG_THOI_GIAN', 'FORMULA', 'BAC_LUONG / STANDARD_DAYS * CONG', null, 60),
    ('Vũ Thị Thanh Thúy', 'LUONG_KPI', 'FORMULA', 'BAC_LUONG / 3 * KPIS', null, 70),
    ('Vũ Thị Thanh Thúy', 'LUONG_PHEP', 'FORMULA', 'BAC_LUONG / STANDARD_DAYS * LEAVE_DAYS', null, 220),
    ('Vũ Thị Thanh Thúy', 'LAM_NGAY_LE', 'FORMULA', 'OT_HOLIDAY_HOURS / HOURS_PER_DAY', null, 230),
    ('Vũ Thị Thanh Thúy', 'LUONG_NGHI_LE', 'FORMULA', 'BAC_LUONG / STANDARD_DAYS * HOLIDAY_DAYS + BAC_LUONG / STANDARD_DAYS * LAM_NGAY_LE * HS_LAM_NGAY_LE', null, 240),
    ('Vũ Thị Thanh Thúy', 'SO_THU_TIEN', 'MONTHLY_INPUT', null, null, 350),
    ('Vũ Thị Thanh Thúy', 'GIAM_TRU_SO_THU', 'MONTHLY_INPUT', null, null, 360),
    ('Vũ Thị Thanh Thúy', 'DS_TINH_LUONG', 'FORMULA', 'SO_THU_TIEN - GIAM_TRU_SO_THU', null, 370),
    ('Vũ Thị Thanh Thúy', 'DT_CAT_LO', 'MONTHLY_INPUT', null, null, 380),
    ('Vũ Thị Thanh Thúy', 'DS_THU_TIEN_HANG', 'FORMULA', 'DS_TINH_LUONG - DT_CAT_LO', null, 390),
    ('Vũ Thị Thanh Thúy', 'DOANH_SO_KHOAN', 'MONTHLY_INPUT', null, null, 400),
    ('Vũ Thị Thanh Thúy', 'HE_SO_PT', 'FORMULA', 'IF(DOANH_SO_KHOAN > 0, (DT_CAT_LO + DS_THU_TIEN_HANG) / DOANH_SO_KHOAN, 0)', null, 410),
    ('Vũ Thị Thanh Thúy', 'SO_THU_CAT_MA', 'MONTHLY_INPUT', null, null, 420),
    ('Vũ Thị Thanh Thúy', 'GIAM_TRU_CAT_MA', 'MONTHLY_INPUT', null, null, 430),
    ('Vũ Thị Thanh Thúy', 'DS_CAT_MA', 'FORMULA', 'SO_THU_CAT_MA - GIAM_TRU_CAT_MA', null, 440),
    ('Vũ Thị Thanh Thúy', 'HE_SO_1PT_CAT_MA', 'FORMULA', 'DS_CAT_MA * TL_CAT_MA', null, 450),
    ('Vũ Thị Thanh Thúy', 'HE_SO_1PT', 'FORMULA', 'IF(HE_SO_PT < MOC_75, 0, DT_CAT_LO * TL_CAT_LO)', null, 460),
    ('Vũ Thị Thanh Thúy', 'HE_SO_1_5PT', 'FORMULA', 'IF(HE_SO_PT >= MOC_75 && HE_SO_PT < MOC_90, DS_THU_TIEN_HANG * TL_MOC_75, 0)', null, 470),
    ('Vũ Thị Thanh Thúy', 'HE_SO_3PT', 'FORMULA', 'IF(HE_SO_PT >= MOC_90 && HE_SO_PT < MOC_105, DS_THU_TIEN_HANG * TL_MOC_90, 0)', null, 480),
    ('Vũ Thị Thanh Thúy', 'HE_SO_4PT', 'FORMULA', 'IF(HE_SO_PT >= MOC_105, DS_THU_TIEN_HANG * TL_MOC_105, 0)', null, 490),
    ('Vũ Thị Thanh Thúy', 'THUONG_DS_150', 'FORMULA', 'IF(HE_SO_PT >= MOC_150, BAC_LUONG * TL_THUONG_150, 0)', null, 500),
    ('Vũ Thị Thanh Thúy', 'LUONG_DOANH_SO', 'FORMULA', 'HE_SO_1PT_CAT_MA + HE_SO_1PT + HE_SO_1_5PT + HE_SO_3PT + HE_SO_4PT + THUONG_DS_150', null, 510),
    ('Vũ Thị Thanh Thúy', 'TRU_CONG_DI_MUON', 'MONTHLY_INPUT', null, null, 530),
    ('Vũ Thị Thanh Thúy', 'PHAT_KO_BC', 'MONTHLY_INPUT', null, null, 560),
    ('Vũ Thị Thanh Thúy', 'PHAT_CTKM', 'MONTHLY_INPUT', null, null, 570),
    ('Vũ Thị Thanh Thúy', 'PHAT_DI_MUON_KHAC', 'MONTHLY_INPUT', null, null, 580),
    ('Vũ Thị Thanh Thúy', 'THUONG_CTKM', 'MONTHLY_INPUT', null, null, 620),
    ('Vũ Thị Thanh Thúy', 'THUONG_DI_SOM', 'MONTHLY_INPUT', null, null, 630),
    ('Vũ Thị Thanh Thúy', 'BU_LUONG', 'MONTHLY_INPUT', null, null, 640),
    ('Vũ Thị Thanh Thúy', 'THUONG_KHAC', 'MONTHLY_INPUT', null, null, 650),
    ('Vũ Thị Thanh Thúy', 'PHAT_DI_MUON_QUA_LAN', 'FORMULA', 'TRU_CONG_DI_MUON * BAC_LUONG / STANDARD_DAYS', null, 660),
    ('Vũ Thị Thanh Thúy', 'TONG_CONG', 'FORMULA', 'TONG_THU_NHAP - PHAT_KO_BC - PHAT_CTKM - PHAT_DI_MUON_KHAC - PHAT_DI_MUON_QUA_LAN', null, 670),
    ('Vũ Thị Thanh Thúy', 'TN_MIEN_THUE', 'FORMULA', '500000 / STANDARD_DAYS * (CONG + HOLIDAY_DAYS + LEAVE_DAYS) + MIN(MIEN_THUE_TOI_DA, MIEN_THUE_THEO_CONG / STANDARD_DAYS * (CONG + HOLIDAY_DAYS + LEAVE_DAYS))', null, 680),
    ('Vũ Thị Thanh Thúy', 'GIAM_TRU', 'FORMULA', '1 * GIAM_TRU_NPT', null, 690),
    ('Vũ Thị Thanh Thúy', 'TN_TINH_THUE', 'FORMULA', 'MAX(TONG_CONG - TN_MIEN_THUE - GIAM_TRU - TRU_BHXH - GIAM_TRU_BAN_THAN, 0)', null, 700),
    ('Vũ Thị Thanh Thúy', 'THUE_TNCN', 'FORMULA', 'BIEU_THUE_TNCN(TN_TINH_THUE)', null, 710),
    ('Vũ Thị Thanh Thúy', 'TRU_BHXH', 'FORMULA', '6600000 * TY_LE_TRU_BHXH', null, 720),
    ('Vũ Thị Thanh Thúy', 'TRU_QUY', 'FORMULA', '(LUONG_THOI_GIAN + LUONG_DOANH_SO) * TY_LE_NHAP_QUY', null, 730),
    ('Lương Xuân Tùng', 'BAC_LUONG', 'VALUE', null, 8000000, 10),
    ('Lương Xuân Tùng', 'KPIS', 'FORMULA', 'TY_LE_KPI', null, 40),
    ('Lương Xuân Tùng', 'CONG', 'FORMULA', 'WORK_DAYS', null, 50),
    ('Lương Xuân Tùng', 'LUONG_THOI_GIAN', 'FORMULA', 'BAC_LUONG / STANDARD_DAYS * CONG', null, 60),
    ('Lương Xuân Tùng', 'LUONG_KPI', 'FORMULA', 'BAC_LUONG / 3 * KPIS', null, 70),
    ('Lương Xuân Tùng', 'LUONG_PHEP', 'FORMULA', 'BAC_LUONG / STANDARD_DAYS * LEAVE_DAYS', null, 220),
    ('Lương Xuân Tùng', 'LAM_NGAY_LE', 'FORMULA', 'OT_HOLIDAY_HOURS / HOURS_PER_DAY', null, 230),
    ('Lương Xuân Tùng', 'LUONG_NGHI_LE', 'FORMULA', 'BAC_LUONG / STANDARD_DAYS * HOLIDAY_DAYS + BAC_LUONG / STANDARD_DAYS * LAM_NGAY_LE * HS_LAM_NGAY_LE', null, 240),
    ('Lương Xuân Tùng', 'SO_THU_TIEN', 'MONTHLY_INPUT', null, null, 350),
    ('Lương Xuân Tùng', 'GIAM_TRU_SO_THU', 'MONTHLY_INPUT', null, null, 360),
    ('Lương Xuân Tùng', 'DS_TINH_LUONG', 'FORMULA', 'SO_THU_TIEN - GIAM_TRU_SO_THU', null, 370),
    ('Lương Xuân Tùng', 'DT_CAT_LO', 'MONTHLY_INPUT', null, null, 380),
    ('Lương Xuân Tùng', 'DS_THU_TIEN_HANG', 'FORMULA', 'DS_TINH_LUONG - DT_CAT_LO', null, 390),
    ('Lương Xuân Tùng', 'DOANH_SO_KHOAN', 'MONTHLY_INPUT', null, null, 400),
    ('Lương Xuân Tùng', 'HE_SO_PT', 'FORMULA', 'IF(DOANH_SO_KHOAN > 0, (DT_CAT_LO + DS_THU_TIEN_HANG) / DOANH_SO_KHOAN, 0)', null, 410),
    ('Lương Xuân Tùng', 'SO_THU_CAT_MA', 'MONTHLY_INPUT', null, null, 420),
    ('Lương Xuân Tùng', 'GIAM_TRU_CAT_MA', 'MONTHLY_INPUT', null, null, 430),
    ('Lương Xuân Tùng', 'DS_CAT_MA', 'FORMULA', 'SO_THU_CAT_MA - GIAM_TRU_CAT_MA', null, 440),
    ('Lương Xuân Tùng', 'HE_SO_1PT_CAT_MA', 'FORMULA', 'DS_CAT_MA * TL_CAT_MA', null, 450),
    ('Lương Xuân Tùng', 'HE_SO_1PT', 'FORMULA', 'IF(HE_SO_PT < MOC_75, 0, DT_CAT_LO * TL_CAT_LO)', null, 460),
    ('Lương Xuân Tùng', 'HE_SO_1_5PT', 'FORMULA', 'IF(HE_SO_PT >= MOC_75 && HE_SO_PT < MOC_90, DS_THU_TIEN_HANG * TL_MOC_75, 0)', null, 470),
    ('Lương Xuân Tùng', 'HE_SO_3PT', 'FORMULA', 'IF(HE_SO_PT >= MOC_90 && HE_SO_PT < MOC_105, DS_THU_TIEN_HANG * TL_MOC_90, 0)', null, 480),
    ('Lương Xuân Tùng', 'HE_SO_4PT', 'FORMULA', 'IF(HE_SO_PT >= MOC_105, DS_THU_TIEN_HANG * TL_MOC_105, 0)', null, 490),
    ('Lương Xuân Tùng', 'THUONG_DS_150', 'FORMULA', 'IF(HE_SO_PT >= MOC_150, BAC_LUONG * TL_THUONG_150, 0)', null, 500),
    ('Lương Xuân Tùng', 'LUONG_DOANH_SO', 'FORMULA', 'HE_SO_1PT_CAT_MA + HE_SO_1PT + HE_SO_1_5PT + HE_SO_3PT + HE_SO_4PT + THUONG_DS_150', null, 510),
    ('Lương Xuân Tùng', 'TRU_CONG_DI_MUON', 'MONTHLY_INPUT', null, null, 530),
    ('Lương Xuân Tùng', 'PHAT_KO_BC', 'MONTHLY_INPUT', null, null, 560),
    ('Lương Xuân Tùng', 'PHAT_CTKM', 'MONTHLY_INPUT', null, null, 570),
    ('Lương Xuân Tùng', 'PHAT_DI_MUON_KHAC', 'MONTHLY_INPUT', null, null, 580),
    ('Lương Xuân Tùng', 'THUONG_CTKM', 'MONTHLY_INPUT', null, null, 620),
    ('Lương Xuân Tùng', 'THUONG_DI_SOM', 'MONTHLY_INPUT', null, null, 630),
    ('Lương Xuân Tùng', 'BU_LUONG', 'MONTHLY_INPUT', null, null, 640),
    ('Lương Xuân Tùng', 'THUONG_KHAC', 'MONTHLY_INPUT', null, null, 650),
    ('Lương Xuân Tùng', 'PHAT_DI_MUON_QUA_LAN', 'FORMULA', 'TRU_CONG_DI_MUON * BAC_LUONG / STANDARD_DAYS', null, 660),
    ('Lương Xuân Tùng', 'TONG_CONG', 'FORMULA', 'TONG_THU_NHAP - PHAT_KO_BC - PHAT_CTKM - PHAT_DI_MUON_KHAC - PHAT_DI_MUON_QUA_LAN', null, 670),
    ('Lương Xuân Tùng', 'TN_MIEN_THUE', 'FORMULA', '500000 / STANDARD_DAYS * (CONG + HOLIDAY_DAYS + LEAVE_DAYS) + MIN(MIEN_THUE_TOI_DA, MIEN_THUE_THEO_CONG / STANDARD_DAYS * (CONG + HOLIDAY_DAYS + LEAVE_DAYS))', null, 680),
    ('Lương Xuân Tùng', 'GIAM_TRU', 'VALUE', null, 0, 690),
    ('Lương Xuân Tùng', 'TN_TINH_THUE', 'FORMULA', 'MAX(TONG_CONG - TN_MIEN_THUE - GIAM_TRU - TRU_BHXH - GIAM_TRU_BAN_THAN, 0)', null, 700),
    ('Lương Xuân Tùng', 'THUE_TNCN', 'FORMULA', 'BIEU_THUE_TNCN(TN_TINH_THUE)', null, 710),
    ('Lương Xuân Tùng', 'TRU_BHXH', 'FORMULA', '6000000 * TY_LE_TRU_BHXH', null, 720),
    ('Lương Xuân Tùng', 'TRU_QUY', 'FORMULA', '(LUONG_THOI_GIAN + LUONG_DOANH_SO) * TY_LE_NHAP_QUY', null, 730),
    ('Scarpello Maurizio', 'BAC_LUONG', 'VALUE', null, 25000000, 10),
    ('Scarpello Maurizio', 'LUONG_THOI_GIAN', 'VALUE', null, 25000000, 60),
    ('Scarpello Maurizio', 'LUONG_NGHI_LE', 'FORMULA', 'BAC_LUONG / STANDARD_DAYS * HOLIDAY_DAYS', null, 240),
    ('Scarpello Maurizio', 'DS_THU_TIEN_HANG', 'MONTHLY_INPUT', null, null, 390),
    ('Scarpello Maurizio', 'LUONG_DOANH_SO', 'FORMULA', 'DS_THU_TIEN_HANG * 0.03', null, 510),
    ('Scarpello Maurizio', 'TRU_CONG_DI_MUON', 'MONTHLY_INPUT', null, null, 530),
    ('Scarpello Maurizio', 'PHAT_KO_BC', 'MONTHLY_INPUT', null, null, 560),
    ('Scarpello Maurizio', 'PHAT_CTKM', 'MONTHLY_INPUT', null, null, 570),
    ('Scarpello Maurizio', 'PHAT_DI_MUON_KHAC', 'MONTHLY_INPUT', null, null, 580),
    ('Scarpello Maurizio', 'THUONG_CTKM', 'MONTHLY_INPUT', null, null, 620),
    ('Scarpello Maurizio', 'THUONG_DI_SOM', 'MONTHLY_INPUT', null, null, 630),
    ('Scarpello Maurizio', 'BU_LUONG', 'MONTHLY_INPUT', null, null, 640),
    ('Scarpello Maurizio', 'THUONG_KHAC', 'MONTHLY_INPUT', null, null, 650),
    ('Scarpello Maurizio', 'PHAT_DI_MUON_QUA_LAN', 'FORMULA', 'TRU_CONG_DI_MUON * BAC_LUONG / STANDARD_DAYS', null, 660),
    ('Scarpello Maurizio', 'TONG_CONG', 'FORMULA', 'TONG_THU_NHAP - PHAT_KO_BC - PHAT_CTKM - PHAT_DI_MUON_KHAC - PHAT_DI_MUON_QUA_LAN', null, 670)
  ;

  for v_person in select * from _xl_people loop
    select count(*), min(p.id::text)::uuid into v_hits, v_user
    from public.profiles p
    where lower(normalize(regexp_replace(trim(p.name), '\s+', ' ', 'g'), NFC))
        = lower(normalize(v_person.name, NFC));
    if v_hits <> 1 then
      v_missing := v_missing || (v_person.name || case when v_hits = 0 then '' else ' (trùng ' || v_hits || ' người)' end);
      continue;
    end if;
    insert into public.employee_pay_items (user_id, component_id, mode, formula, amount, sort_order, effective_from, note)
    select v_user, c.id, r.mode, r.formula, r.amount, r.sort_order, date '2026-08-01', 'Theo ' || v_person.sheet
    from _xl_rows r
    join public.payroll_components c on c.code = r.code
    where r.owner = v_person.name;
    v_seeded := v_seeded + 1;
  end loop;

  -- 3.7 Mẫu phiếu: BL 01 cho đơn vị gốc, BL 02 cho đơn vị Kinh doanh trên cùng
  insert into public.payslip_layouts (unit_id, form_code, title, header, before_total)
  select u.id, 'BL 01', null,
         '[{"code": "BAC_LUONG", "format": "money"}, {"code": "KPIS", "format": "ratio"}, {"code": "CONG", "format": "number"}]'::jsonb,
         array['PHAT_DI_MUON_KH', 'PHAT_KHAC', 'PHAT_DI_MUON_QUA_LAN']
  from public.organization_units u
  where u.parent_id is null;

  insert into public.payslip_layouts (unit_id, form_code, title, header, before_total)
  select u.id, 'BL 02', null,
         '[{"code": "BAC_LUONG", "format": "money"}, {"code": "KPIS", "format": "ratio"}, {"code": "CONG", "format": "number"},
           {"code": "DOANH_SO_KHOAN", "format": "money"}, {"code": "HE_SO_PT", "format": "ratio"}]'::jsonb,
         array['PHAT_KO_BC', 'PHAT_CTKM', 'PHAT_DI_MUON_KHAC', 'PHAT_DI_MUON_QUA_LAN']
  from public.organization_units u
  where u.parent_id is not null and u.name ilike '%kinh doanh%'
    and not exists (
      with recursive up as (
        select p.id, p.parent_id, p.name from public.organization_units p where p.id = u.parent_id
        union all
        select p.id, p.parent_id, p.name from public.organization_units p join up on p.id = up.parent_id
      )
      select 1 from up where up.name ilike '%kinh doanh%'
    );

  foreach v_table in array v_tables loop
    if to_regclass('public.' || v_table) is not null then
      execute format('alter table public.%I enable trigger user', v_table);
    end if;
  end loop;
  alter table public.payroll_param_versions enable trigger payroll_param_versions_period_guard;
  alter table public.payroll_param_versions enable trigger payroll_param_versions_audit;

  -- 3.8 Liên kết sang lương theo mã mới
  if to_regclass('public.kpi_payroll_links') is not null then
    update public.kpi_payroll_links
    set component_code = case source when 'SALES_TARGET' then 'DOANH_SO_KHOAN' end;
  end if;
  if to_regclass('public.timesheet_payroll_links') is not null then
    update public.timesheet_payroll_links set component_code = 'SAU_22H' where source = 'NIGHT_WORK_DAYS';
    update public.timesheet_payroll_links set component_code = 'TRU_CONG_DI_MUON' where source = 'LATE_DEDUCT_DAYS';
  end if;

  select count(*) into v_without
  from public.profiles p
  where coalesce(p.is_active, true)
    and not exists (select 1 from public.employee_pay_items e where e.user_id = p.id);

  raise notice 'Đã dựng cơ chế cho % người theo Excel.', v_seeded;
  if cardinality(v_missing) > 0 then
    raise notice 'Không khớp được họ tên (chép bộ mẫu BL 01 / BL 02 cho người này ở Cơ chế lương): %',
      array_to_string(v_missing, '; ');
  end if;
  raise notice '% người đang làm chưa có cơ chế lương.', v_without;
end
$mig$;
