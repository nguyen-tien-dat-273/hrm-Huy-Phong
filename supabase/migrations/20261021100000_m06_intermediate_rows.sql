-- ============================================================================
-- M06 — Dòng TRUNG GIAN tách khỏi danh mục khoản lương.
-- ----------------------------------------------------------------------------
-- Danh mục khoản lương giờ đúng 26 khoản trong 5 nhóm; mỗi khoản là dòng CỘNG
-- hoặc TRỪ vào lương (riêng "Lương cơ bản / Bậc lương" là mức để tính các
-- khoản lương thời gian nên là dòng trung gian của nhóm Thu nhập cố định).
--
-- Những con số không cộng trừ vào thực lĩnh — đơn giá ngày, tổng cộng, thu
-- nhập tính thuế, doanh số khoán… — là DÒNG TRUNG GIAN (kind = 'INFO'):
--   * không thuộc nhóm nào (category_code để trống), bỏ nhóm "Số liệu & dòng
--     trung gian";
--   * tạo thẳng ở màn Cơ chế lương qua `save_payroll_intermediate`;
--   * `show_on_payslip` quyết định nhân viên có thấy dòng đó trên phiếu không.
--
-- Dữ liệu cũ bỏ đi, thay bằng dữ liệu theo tài liệu:
--   * danh mục chỉ còn 26 khoản chuẩn — khoản cũ ngoài danh sách bị xoá (đã lên
--     phiếu lương thì chỉ khoá để giữ lịch sử), khai riêng của khoản đó mất theo;
--   * cơ chế chung của mọi đơn vị gieo lại theo bảng lương mẫu — BL 01 cho đơn
--     vị gốc (Văn phòng / Kho / Vận chuyển), BL 02 khai lại phần khác cho đơn vị
--     Kinh doanh. Khai riêng từng người của các khoản còn lại (bậc lương…) giữ
--     nguyên.
--
-- LƯU Ý CHẠY: phần dữ liệu nằm trong MỘT khối DO để SQL Editor của Supabase
-- đọc được cột vừa thêm. Dán nguyên file rồi Run một lần.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Kiểm đầu mục: dòng trung gian không cần nhóm
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
  if new.nature is null and new.category_code is not null then
    select g.default_nature into new.nature from public.payroll_component_categories g where g.code = new.category_code;
  end if;
  new.nature := coalesce(new.nature, 'VARIABLE');
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
-- 2. Cấu trúc + dữ liệu
-- ---------------------------------------------------------------------------
do $mig$
declare
  v_last date := public.payroll_last_closed_month();
  v_from date;
  v_sales record;
  v_missing text;
  v_count integer;
begin
  alter table public.payroll_components alter column category_code drop not null;
  alter table public.payroll_components add column if not exists show_on_payslip boolean not null default false;
  comment on column public.payroll_components.category_code is
    'Nhóm của khoản lương (1 trong 5 nhóm). Dòng trung gian (kind = INFO) có thể để trống.';
  comment on column public.payroll_components.show_on_payslip is
    'Dòng trung gian có hiện trên phiếu lương của nhân viên không (bậc lương, doanh số khoán, tổng cộng…).';

  -- Bỏ nhóm thứ sáu: dòng trung gian không thuộc nhóm khoản lương nào.
  update public.payroll_components set category_code = null where category_code = 'SO_LIEU';
  delete from public.payroll_component_categories where code = 'SO_LIEU';
  comment on table public.payroll_component_categories is
    'Năm nhóm của danh mục khoản lương. Dòng trung gian không thuộc nhóm nào.';

  -- Đủ 26 khoản chuẩn.
  insert into public.payroll_components (
    code, name, kind, calc_type, default_amount, taxable, insurable, is_base, prorate,
    sort_order, category_code, nature, calc_source, is_active, is_system, note, report_tag
  )
  select s.code, s.name, s.kind, 'FIXED', 0, s.taxable, s.insurable, false, false,
         s.sort_order, s.category_code, s.nature, 'ASSIGNED', true, false, s.note, s.report_tag
  from public.payroll_standard_catalog() s
  where not exists (select 1 from public.payroll_components c where c.code = s.code)
    and not exists (select 1 from public.payroll_components c where lower(c.name) = lower(s.name));

  -- Dòng trung gian mà bảng lương mẫu dùng.
  create temp table _m06_mid (
    code text primary key, name text, sort_order integer, show boolean, report_tag text, note text
  ) on commit drop;
  insert into _m06_mid values
    ('DAILY_RATE', 'Đơn giá ngày', 20, false, null, 'Bậc lương chia công chuẩn của tháng.'),
    ('HOURLY_RATE', 'Đơn giá giờ', 30, false, null, 'Đơn giá ngày chia giờ làm chuẩn mỗi ngày.'),
    ('SO_CONG_DEM', 'Số công làm thêm sau 22h', 40, false, null, 'Nhập mỗi tháng; mỗi lần làm thêm sau 22h cộng một công.'),
    ('MUC_KPI', 'Bậc lương KPI', 50, true, null, 'Mức lương KPI khai cho từng người.'),
    ('DOANH_SO', 'Doanh số thu tiền hàng', 60, true, null, 'Nhập mỗi tháng.'),
    ('DOANH_SO_KHOAN', 'Doanh số khoán', 61, true, null, 'Chỉ tiêu doanh số của tháng.'),
    ('DOANH_SO_CAT_MA', 'Doanh số cắt mã', 62, true, null, 'Nhập mỗi tháng.'),
    ('DOANH_SO_THU_CAT_LO', 'Doanh số thu cắt lô', 63, true, null, 'Doanh thu cắt lô trên 40% / nhà hàng có PG.'),
    ('TY_LE_DAT_DS', 'Tỷ lệ đạt doanh số (%)', 64, true, null, '(Doanh số thu tiền hàng + doanh số thu cắt lô) ÷ doanh số khoán.'),
    ('SO_LAN_THIEU_BAO_CAO', 'Số lần thiếu báo cáo / kế hoạch', 65, false, null, 'Nhập mỗi tháng.'),
    ('TONG_CONG', 'Tổng cộng', 600, true, null, 'Tổng các khoản cộng trừ các khoản phạt — căn cứ tính thuế.'),
    ('INSURANCE_BASE', 'Lương đóng bảo hiểm', 610, false, null, 'Mặc định bằng bậc lương; khai riêng nếu khác.'),
    ('DEPENDENTS', 'Số người phụ thuộc', 700, false, null, 'Khai cho từng người.'),
    ('THU_NHAP_MIEN_THUE', 'Thu nhập miễn thuế', 710, false, null, 'Phần ăn trưa và hỗ trợ không chịu thuế, theo ngày hưởng lương.'),
    ('THU_NHAP_TINH_THUE', 'Thu nhập tính thuế', 720, false, 'TAXABLE_INCOME', 'Tổng cộng trừ miễn thuế, giảm trừ gia cảnh và bảo hiểm.'),
    ('INS_EMPLOYER', 'BH doanh nghiệp đóng', 740, false, 'INSURANCE_EMPLOYER',
      'Phần bảo hiểm, kinh phí công đoàn doanh nghiệp đóng thêm — không trừ của nhân viên.');

  insert into public.payroll_components (
    code, name, kind, calc_type, default_amount, taxable, insurable, is_base, prorate,
    sort_order, category_code, nature, calc_source, is_active, is_system, note, report_tag, show_on_payslip
  )
  select m.code, m.name, 'INFO', 'FIXED', 0, false, false, false, false,
         m.sort_order, null, 'VARIABLE', 'ASSIGNED', true, false, m.note, m.report_tag, m.show
  from _m06_mid m
  where not exists (select 1 from public.payroll_components c where c.code = m.code)
    and not exists (select 1 from public.payroll_components c where lower(c.name) = lower(m.name));

  update public.payroll_components c
  set kind = 'INFO', category_code = null, show_on_payslip = m.show, is_active = true,
      report_tag = coalesce(m.report_tag, c.report_tag)
  from _m06_mid m
  where c.code = m.code;

  -- Bậc lương: dòng trung gian của nhóm Thu nhập cố định, hiện trên phiếu.
  update public.payroll_components
  set kind = 'INFO', category_code = 'THU_NHAP_CO_DINH', show_on_payslip = true, is_active = true
  where code = 'LUONG_CO_BAN';

  -- Khoản cộng / trừ ngoài 26 khoản chuẩn (dữ liệu cũ): xoá; đã có trên phiếu lương thì chỉ khoá.
  update public.payroll_components c set is_active = false
  where c.kind <> 'INFO'
    and not exists (select 1 from public.payroll_standard_catalog() s where s.code = c.code)
    and exists (select 1 from public.payslip_lines l where l.code = c.code);
  delete from public.payroll_components c
  where c.kind <> 'INFO'
    and not exists (select 1 from public.payroll_standard_catalog() s where s.code = c.code)
    and not exists (select 1 from public.payslip_lines l where l.code = c.code);

  -- Dòng trung gian cũ không còn dùng: xoá; đã có trên phiếu lương thì chỉ khoá.
  update public.payroll_components c set is_active = false
  where c.kind = 'INFO' and c.code <> 'LUONG_CO_BAN'
    and not exists (select 1 from _m06_mid m where m.code = c.code)
    and exists (select 1 from public.payslip_lines l where l.code = c.code);
  delete from public.payroll_components c
  where c.kind = 'INFO' and c.code <> 'LUONG_CO_BAN'
    and not exists (select 1 from _m06_mid m where m.code = c.code)
    and not exists (select 1 from public.payslip_lines l where l.code = c.code);

  -- Mã mà bộ công thức mẫu cần mà vẫn thiếu (vướng trùng tên với đầu mục khác).
  select string_agg(m.code, ', ') into v_missing
  from _m06_mid m where not exists (select 1 from public.payroll_components c where c.code = m.code);
  if v_missing is not null then
    raise notice 'Không tạo được dòng trung gian % (trùng tên đầu mục đã có) — công thức đọc tới các mã này sẽ ra 0.', v_missing;
  end if;

  -- ------------------------------------------------------------------------
  -- Cơ chế chung gieo lại theo bảng lương mẫu
  -- ------------------------------------------------------------------------
  v_from := coalesce((v_last + interval '1 month')::date, date '2000-01-01');

  create temp table _m06_seed (
    variant text, code text, mode text, formula text, amount numeric, sort_order integer
  ) on commit drop;
  insert into _m06_seed values
    -- BL 01 — Văn phòng / Kho / Vận chuyển (đơn vị gốc, mọi đơn vị thừa hưởng)
    ('BL01', 'LUONG_CO_BAN', 'PER_PERSON', null, null, 10),
    ('BL01', 'DAILY_RATE', 'FORMULA', 'LUONG_CO_BAN / STANDARD_DAYS', null, 20),
    ('BL01', 'HOURLY_RATE', 'FORMULA', 'DAILY_RATE / HOURS_PER_DAY', null, 30),
    ('BL01', 'SO_CONG_DEM', 'MONTHLY_INPUT', null, null, 40),
    ('BL01', 'BASE_WORK', 'FORMULA', 'DAILY_RATE * WORK_DAYS', null, 100),
    ('BL01', 'BASE_HOLIDAY', 'FORMULA', 'DAILY_RATE * HOLIDAY_DAYS', null, 110),
    ('BL01', 'BASE_LEAVE', 'FORMULA', 'DAILY_RATE * LEAVE_DAYS', null, 120),
    ('BL01', 'OT_WEEKDAY', 'FORMULA', 'HOURLY_RATE * HE_SO_OT_THUONG * OT_WEEKDAY_HOURS', null, 130),
    ('BL01', 'OT_WEEKEND', 'FORMULA', 'HOURLY_RATE * HE_SO_OT_NGHI * OT_WEEKEND_HOURS', null, 140),
    ('BL01', 'OT_HOLIDAY', 'FORMULA', 'HOURLY_RATE * HE_SO_OT_LE * OT_HOLIDAY_HOURS', null, 150),
    ('BL01', 'CONG_THEM_DEM', 'FORMULA', 'DAILY_RATE * SO_CONG_DEM', null, 160),
    ('BL01', 'LUONG_VAN_CHUYEN', 'MONTHLY_INPUT', null, null, 200),
    ('BL01', 'PHU_CAP_KHAC', 'VALUE', null, 0, 300),
    ('BL01', 'ALLOW_RESPONSIBILITY', 'VALUE', null, 0, 310),
    ('BL01', 'THUONG_DI_SOM', 'MONTHLY_INPUT', null, null, 400),
    ('BL01', 'THUONG_THANG', 'MONTHLY_INPUT', null, null, 410),
    ('BL01', 'PHAT_DI_MUON_VE_SOM', 'FORMULA', '(LATE_COUNT + EARLY_COUNT) * DON_GIA_PHAT_DI_MUON', null, 500),
    ('BL01', 'PHAT_DI_MUON', 'FORMULA', 'MAX(LATE_COUNT - SO_LAN_DI_MUON_CHO_PHEP, 0) * DON_GIA_PHAT_DI_MUON_QUA_LAN', null, 510),
    ('BL01', 'TONG_CONG', 'FORMULA', 'TONG_THU_NHAP - PHAT_DI_MUON_VE_SOM - PHAT_DI_MUON - PHAT_BAO_CAO', null, 600),
    ('BL01', 'INSURANCE_BASE', 'FORMULA', 'LUONG_CO_BAN', null, 610),
    ('BL01', 'INS_EMPLOYEE', 'FORMULA',
      'IF(UNPAID_DAYS >= SO_NGAY_MIEN_DONG_BH, 0, MIN(INSURANCE_BASE, TRAN_BHXH_BHYT) * (TY_LE_BHXH_NLD + TY_LE_BHYT_NLD) + MIN(INSURANCE_BASE, TRAN_BHTN) * TY_LE_BHTN_NLD)',
      null, 620),
    ('BL01', 'QUY_CONG_DOAN', 'FORMULA', '(BASE_WORK + LUONG_VAN_CHUYEN) * TY_LE_QUY_1PT', null, 630),
    ('BL01', 'DEPENDENTS', 'VALUE', null, 0, 700),
    ('BL01', 'THU_NHAP_MIEN_THUE', 'FORMULA',
      '1000000 / STANDARD_DAYS * PAID_DAYS + MIN(1200000, 1500000 / STANDARD_DAYS * PAID_DAYS)', null, 710),
    ('BL01', 'THU_NHAP_TINH_THUE', 'FORMULA',
      'MAX(0, TONG_CONG - THU_NHAP_MIEN_THUE - DEPENDENTS * GIAM_TRU_NPT - INS_EMPLOYEE - GIAM_TRU_BAN_THAN)', null, 720),
    ('BL01', 'PIT', 'FORMULA', 'THUE_LUY_TIEN(THU_NHAP_TINH_THUE)', null, 730),
    ('BL01', 'INS_EMPLOYER', 'FORMULA',
      'IF(UNPAID_DAYS >= SO_NGAY_MIEN_DONG_BH, 0, MIN(INSURANCE_BASE, TRAN_BHXH_BHYT) * (TY_LE_BHXH_DN + TY_LE_BHYT_DN + TY_LE_KPCD) + MIN(INSURANCE_BASE, TRAN_BHTN) * TY_LE_BHTN_DN)',
      null, 740),
    ('BL01', 'ADVANCE', 'MONTHLY_INPUT', null, null, 750),
    -- BL 02 — Kinh doanh: chỉ phần khác BL 01
    ('BL02', 'LUONG_VAN_CHUYEN', 'OFF', null, null, 200),
    ('BL02', 'MUC_KPI', 'PER_PERSON', null, null, 50),
    ('BL02', 'DOANH_SO', 'MONTHLY_INPUT', null, null, 60),
    ('BL02', 'DOANH_SO_KHOAN', 'MONTHLY_INPUT', null, null, 61),
    ('BL02', 'DOANH_SO_CAT_MA', 'MONTHLY_INPUT', null, null, 62),
    ('BL02', 'DOANH_SO_THU_CAT_LO', 'MONTHLY_INPUT', null, null, 63),
    ('BL02', 'TY_LE_DAT_DS', 'FORMULA',
      'IF(DOANH_SO_KHOAN > 0, (DOANH_SO + DOANH_SO_THU_CAT_LO) / DOANH_SO_KHOAN * 100, 0)', null, 64),
    ('BL02', 'SO_LAN_THIEU_BAO_CAO', 'MONTHLY_INPUT', null, null, 65),
    ('BL02', 'LUONG_KPI', 'FORMULA', 'MUC_KPI * TY_LE_KPI', null, 170),
    ('BL02', 'LUONG_DOANH_SO', 'FORMULA', 'DOANH_SO * HH_BL02(TY_LE_DAT_DS) + DOANH_SO_CAT_MA * TY_LE_HH_CAT_MA', null, 200),
    ('BL02', 'LUONG_DT_CAT_LO', 'FORMULA', 'DOANH_SO_THU_CAT_LO * TY_LE_HH_CAT_LO', null, 210),
    ('BL02', 'PC_CONG_TAC_TINH', 'VALUE', null, 0, 320),
    ('BL02', 'THUONG_CTKM', 'MONTHLY_INPUT', null, null, 420),
    ('BL02', 'THUONG_DOANH_SO_VUOT', 'FORMULA', 'IF(TY_LE_DAT_DS / 100 > NGUONG_THUONG_VUOT, MUC_THUONG_VUOT, 0)', null, 430),
    ('BL02', 'PHAT_BAO_CAO', 'FORMULA', 'SO_LAN_THIEU_BAO_CAO * DON_GIA_PHAT_BAO_CAO', null, 520),
    ('BL02', 'QUY_CONG_DOAN', 'FORMULA', '(BASE_WORK + LUONG_DOANH_SO + LUONG_DT_CAT_LO) * TY_LE_QUY_1PT', null, 630);

  delete from public.unit_pay_items;

  insert into public.unit_pay_items (unit_id, component_id, mode, formula, amount, sort_order, effective_from, note)
  select u.id, c.id, s.mode, s.formula, s.amount, s.sort_order, v_from, 'Bảng lương mẫu BL 01'
  from public.organization_units u
  cross join _m06_seed s
  join public.payroll_components c on c.code = s.code
  where u.parent_id is null and s.variant = 'BL01';
  get diagnostics v_count = row_count;
  raise notice 'Gieo cơ chế BL 01: % dòng.', v_count;

  -- Đơn vị Kinh doanh trên cùng (cấp trên của nó không phải đơn vị kinh doanh).
  for v_sales in
    select u.id, u.name
    from public.organization_units u
    where u.parent_id is not null and u.name ilike '%kinh doanh%'
      and not exists (
        with recursive up as (
          select p.id, p.parent_id, p.name from public.organization_units p where p.id = u.parent_id
          union all
          select p.id, p.parent_id, p.name from public.organization_units p join up on p.id = up.parent_id
        )
        select 1 from up where up.name ilike '%kinh doanh%'
      )
  loop
    insert into public.unit_pay_items (unit_id, component_id, mode, formula, amount, sort_order, effective_from, note)
    select v_sales.id, c.id, s.mode, s.formula, s.amount, s.sort_order, v_from, 'Bảng lương mẫu BL 02'
    from _m06_seed s
    join public.payroll_components c on c.code = s.code
    where s.variant = 'BL02';
    raise notice 'Gieo cơ chế BL 02 cho đơn vị %.', v_sales.name;
  end loop;
end
$mig$;

-- ---------------------------------------------------------------------------
-- 3. Hàm cũ không còn dùng (gợi ý cơ chế mẫu, bộ đầu mục phụ trợ)
-- ---------------------------------------------------------------------------
drop function if exists public.payroll_mechanism_suggestions(text);
drop function if exists public.payroll_ensure_components(text[]);

-- ---------------------------------------------------------------------------
-- 4. Tạo / sửa dòng trung gian ngay ở màn Cơ chế lương
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
      code, name, kind, calc_type, default_amount, taxable, insurable, is_base, prorate,
      sort_order, category_code, nature, calc_source, is_active, is_system, note, show_on_payslip
    )
    values (
      upper(trim(p_code)), trim(p_name), 'INFO', 'FIXED', 0, false, false, false, false,
      (select coalesce(max(sort_order), 0) + 10 from public.payroll_components), null, 'VARIABLE', 'ASSIGNED',
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
-- 5. Phiếu lương của nhân viên: chỉ hiện dòng trung gian được đánh dấu
-- ---------------------------------------------------------------------------
create or replace function public.get_my_payslip(p_month date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_slip public.payslips%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Chưa đăng nhập.' using errcode = '42501';
  end if;
  if not public.payroll_recent_auth(15) then
    raise exception 'Nhập lại mật khẩu để xem chi tiết phiếu lương.' using errcode = '28000';
  end if;

  select s.* into v_slip
  from public.payslips s
  join public.payroll_runs r on r.id = s.run_id
  where s.user_id = auth.uid()
    and r.month_start = date_trunc('month', p_month)::date
    and r.status = 'PAID' and r.published_at is not null;

  if v_slip.id is null then
    return null;
  end if;

  return jsonb_build_object(
    'payslip', to_jsonb(v_slip),
    -- Kèm nhóm danh mục của từng dòng: nhân viên không đọc được danh mục, mà
    -- phiếu dạng mẫu cần nhóm để chia mục I, II, III…
    'lines', coalesce((
      select jsonb_agg(
        to_jsonb(l) || jsonb_build_object('category_name', g.name, 'category_sort', g.sort_order)
        order by l.sequence
      )
      from public.payslip_lines l
      left join public.payroll_components pc on pc.code = l.code
      left join public.payroll_component_categories g on g.code = pc.category_code
      where l.payslip_id = v_slip.id
        and l.kind <> 'EMPLOYER_COST'
        and (
          l.kind <> 'INFO'
          or exists (
            select 1 from public.payroll_components c
            where c.code = l.code and c.show_on_payslip and c.report_tag is distinct from 'INSURANCE_EMPLOYER'
          )
        )
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.get_my_payslip(date) from public;
grant execute on function public.get_my_payslip(date) to authenticated;
