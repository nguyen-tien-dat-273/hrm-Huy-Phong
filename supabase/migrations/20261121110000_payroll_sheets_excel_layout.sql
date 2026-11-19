-- ============================================================================
-- M06 — Bảng lương in ra đúng khuôn file "BANG LUONG GUI HRM.xlsx".
-- ----------------------------------------------------------------------------
-- 1. Phần đầu chứng từ của từng bảng:
--      form_code           mã biểu mẫu góc phải (BL 01, BL 02, DT 01, HC088…)
--      issuer              dòng dưới tên công ty (PHÒNG KẾ TOÁN, Bộ phận HC…)
--      subtitle            dòng dưới tiêu đề (BỘ PHẬN: KINH DOANH, ĐVT: VNĐ…)
--      show_standard_days  in dòng "Số ngày làm việc trong tháng: …"
--    Tiêu đề có thể chứa {tháng} / {năm}; không có thì tự thêm "THÁNG mm/yyyy".
-- 2. Nguồn cột mới INFO (chữ, không cộng tổng):
--      DAYS_CHECK  Cảnh báo nhập sai số liệu: công + phép + lễ > công chuẩn
--      START_DATE  Ngày đi làm chính thức
--      BLANK       ô để trống (Ghi chú, cột Excel luôn bỏ trống)
-- 3. Hai đầu mục trung gian cho cột "Chia DS" của BL01 (Hệ số / Thành tiền).
--    Không cộng vào Tổng cộng, đúng như Excel.
-- 4. Gieo lại 6 bảng với đủ cột như Excel: thêm Phép còn lại, Cảnh báo nhập sai
--    số liệu, Chia DS (BL 01); Lương KPI → Công, Phép còn lại, Cảnh báo (BL 02);
--    Ngày đi làm chính thức, Ghi chú (Nghỉ phép); Ghi chú (Làm thêm giờ VC).
--
-- Chạy SAU 20261120110000.
-- ============================================================================

alter table public.payroll_sheets
  add column if not exists form_code text,
  add column if not exists issuer text,
  add column if not exists subtitle text,
  add column if not exists show_standard_days boolean not null default false;

-- ---------------------------------------------------------------------------
-- Đầu mục Chia DS
-- ---------------------------------------------------------------------------
insert into public.payroll_components (
  code, name, kind, calc_type, taxable, insurable, is_base, prorate, sort_order,
  category_code, calc_source, is_active, is_system, note, report_tag, show_on_payslip
)
select v.code, v.name, 'INFO', 'FIXED', false, false, false, false, v.sort_order,
       null, 'ASSIGNED', true, false, null, null, false
from (values
  ('HE_SO_CHIA_DS', 'Hệ số chia DS', 735),
  ('TIEN_CHIA_DS', 'Thành tiền chia DS', 736)
) as v(code, name, sort_order)
where not exists (select 1 from public.payroll_components c where c.code = v.code);

-- ---------------------------------------------------------------------------
-- Lưu bảng: thêm nguồn INFO và bốn trường đầu chứng từ
-- ---------------------------------------------------------------------------
create or replace function public.save_payroll_sheet(p_id uuid, p_sheet jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_name text := trim(coalesce(p_sheet ->> 'name', ''));
  v_columns jsonb := coalesce(p_sheet -> 'columns', '[]'::jsonb);
  v_require text[] := coalesce(array(select upper(trim(x)) from jsonb_array_elements_text(coalesce(p_sheet -> 'require_codes', '[]'::jsonb)) x), '{}');
  v_units uuid[] := coalesce(array(select x::uuid from jsonb_array_elements_text(coalesce(p_sheet -> 'unit_ids', '[]'::jsonb)) x), '{}');
  v_title text := nullif(trim(coalesce(p_sheet ->> 'title', '')), '');
  v_form_code text := nullif(trim(coalesce(p_sheet ->> 'form_code', '')), '');
  v_issuer text := nullif(trim(coalesce(p_sheet ->> 'issuer', '')), '');
  v_subtitle text := nullif(trim(coalesce(p_sheet ->> 'subtitle', '')), '');
  v_show_days boolean := coalesce((p_sheet ->> 'show_standard_days')::boolean, false);
  v_col jsonb;
  v_source text;
  v_code text;
  v_missing text;
begin
  if auth.uid() is null or not public.can_function('admin.payroll_settings') then
    raise exception 'Bạn không có quyền thiết lập bảng lương.' using errcode = '42501';
  end if;
  if v_name = '' then
    raise exception 'Nhập tên bảng.' using errcode = '23514';
  end if;
  if exists (select 1 from public.payroll_sheets s where lower(trim(s.name)) = lower(v_name) and s.id is distinct from p_id) then
    raise exception 'Đã có bảng tên "%".', v_name using errcode = '23505';
  end if;
  if jsonb_typeof(v_columns) <> 'array' or jsonb_array_length(v_columns) = 0 then
    raise exception 'Bảng phải có ít nhất một cột.' using errcode = '23514';
  end if;

  for v_col in select value from jsonb_array_elements(v_columns) loop
    v_source := v_col ->> 'source';
    v_code := upper(trim(coalesce(v_col ->> 'code', '')));
    if v_code = '' then
      raise exception 'Có cột chưa chọn lấy số từ đâu.' using errcode = '23514';
    end if;
    if v_source = 'LINE' then
      if not exists (select 1 from public.payroll_components c where c.code = v_code) then
        raise exception 'Không có đầu mục mã %.', v_code using errcode = '23503';
      end if;
    elsif v_source = 'DATA' then
      if not (v_code = any(public.payroll_sheet_data_codes())) then
        raise exception 'Không có dữ liệu chấm công mã %.', v_code using errcode = '23514';
      end if;
    elsif v_source = 'LEAVE' then
      if v_code !~ '^(LEAVE|LATE)_M(0[1-9]|1[0-2])$' and not (v_code = any(array['LEAVE_USED', 'LEAVE_QUOTA', 'LATE_TOTAL', 'LEAVE_REMAIN'])) then
        raise exception 'Không có số phép năm mã %.', v_code using errcode = '23514';
      end if;
    elsif v_source = 'TOTAL' then
      if not (v_code = any(array['GROSS_PAY', 'DEDUCTIONS', 'NET_PAY'])) then
        raise exception 'Không có số tổng mã %.', v_code using errcode = '23514';
      end if;
    elsif v_source = 'INFO' then
      if not (v_code = any(array['DAYS_CHECK', 'START_DATE', 'BLANK'])) then
        raise exception 'Không có thông tin mã %.', v_code using errcode = '23514';
      end if;
    else
      raise exception 'Nguồn cột "%" không hợp lệ.', coalesce(v_source, '') using errcode = '23514';
    end if;
  end loop;

  select string_agg(r, ', ') into v_missing
  from unnest(v_require) r
  where not exists (select 1 from public.payroll_components c where c.code = r);
  if v_missing is not null then
    raise exception 'Không có đầu mục mã %.', v_missing using errcode = '23503';
  end if;
  if exists (select 1 from unnest(v_units) u where not exists (select 1 from public.organization_units o where o.id = u)) then
    raise exception 'Có đơn vị không còn tồn tại.' using errcode = '23503';
  end if;

  -- Chuẩn hoá cột: chỉ giữ các trường đã biết; cột chữ (INFO) không cộng tổng.
  v_columns := (
    select jsonb_agg(jsonb_build_object(
      'group', nullif(trim(coalesce(c ->> 'group', '')), ''),
      'source', c ->> 'source',
      'code', upper(trim(c ->> 'code')),
      'label', nullif(trim(coalesce(c ->> 'label', '')), ''),
      'total', (c ->> 'source') <> 'INFO' and coalesce((c ->> 'total')::boolean, true)
    ) order by ord)
    from jsonb_array_elements(v_columns) with ordinality as e(c, ord)
  );

  if p_id is null then
    insert into public.payroll_sheets (
      name, title, form_code, issuer, subtitle, show_standard_days, sort_order, require_codes, unit_ids, columns, updated_by
    )
    values (
      v_name, v_title, v_form_code, v_issuer, v_subtitle, v_show_days,
      coalesce((p_sheet ->> 'sort_order')::integer, (select coalesce(max(sort_order), 0) + 10 from public.payroll_sheets)),
      v_require, v_units, v_columns, auth.uid()
    )
    returning id into v_id;
  else
    update public.payroll_sheets
    set name = v_name,
        title = v_title,
        form_code = v_form_code,
        issuer = v_issuer,
        subtitle = v_subtitle,
        show_standard_days = v_show_days,
        sort_order = coalesce((p_sheet ->> 'sort_order')::integer, sort_order),
        require_codes = v_require,
        unit_ids = v_units,
        columns = v_columns,
        updated_by = auth.uid(),
        updated_at = now()
    where id = p_id
    returning id into v_id;
    if v_id is null then
      raise exception 'Không tìm thấy bảng.' using errcode = 'P0002';
    end if;
  end if;
  return v_id;
end;
$$;

revoke all on function public.save_payroll_sheet(uuid, jsonb) from public;
grant execute on function public.save_payroll_sheet(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Gieo lại 6 bảng theo file Excel (bảng trùng tên thì thay).
-- ---------------------------------------------------------------------------
insert into public.payroll_sheets (name, title, form_code, issuer, subtitle, show_standard_days, sort_order, require_codes, columns)
values
    ('BL 01', 'BẢNG THANH TOÁN TIỀN LƯƠNG', 'BL 01', null, null, true, 10, array['LUONG_DT']::text[],
     $c$[{"group":null,"source":"LINE","code":"BAC_LUONG","label":null,"total":true},{"group":null,"source":"LINE","code":"TRACH_NHIEM","label":null,"total":true},{"group":null,"source":"LINE","code":"PHU_CAP","label":null,"total":true},{"group":null,"source":"LINE","code":"KPIS","label":null,"total":false},{"group":"Lương thời gian","source":"LINE","code":"CONG","label":"Công","total":true},{"group":"Lương thời gian","source":"LINE","code":"LUONG_THOI_GIAN","label":"Tiền","total":true},{"group":null,"source":"LINE","code":"LUONG_DT","label":null,"total":true},{"group":"Lương phép","source":"DATA","code":"LEAVE_DAYS","label":"Công","total":true},{"group":"Lương phép","source":"LINE","code":"LUONG_PHEP","label":"Tiền","total":true},{"group":"Lương nghỉ lễ","source":"DATA","code":"HOLIDAY_DAYS","label":"Công","total":true},{"group":"Lương nghỉ lễ","source":"LINE","code":"LUONG_NGHI_LE","label":"Tiền","total":true},{"group":"Làm thêm","source":"LINE","code":"LE_CN","label":null,"total":true},{"group":"Làm thêm","source":"LINE","code":"SAU_22H","label":null,"total":true},{"group":"Làm thêm","source":"LINE","code":"LAM_THEM","label":"Tiền","total":true},{"group":"Phạt","source":"LINE","code":"PHAT_DI_MUON_KH","label":null,"total":true},{"group":"Phạt","source":"LINE","code":"PHAT_KHAC","label":null,"total":true},{"group":"Thưởng","source":"LINE","code":"THUONG_DI_SOM_KHAC","label":null,"total":true},{"group":"Thưởng","source":"LINE","code":"KHAC_THUONG","label":null,"total":true},{"group":"Thưởng","source":"LINE","code":"BS_LUONG","label":null,"total":true},{"group":null,"source":"LINE","code":"PHAT_DI_MUON_QUA_LAN","label":null,"total":true},{"group":null,"source":"LINE","code":"TONG_CONG","label":null,"total":true},{"group":null,"source":"LINE","code":"TN_MIEN_THUE","label":null,"total":true},{"group":"Giảm trừ","source":"LINE","code":"GIAM_TRU","label":"NPT","total":true},{"group":null,"source":"LINE","code":"TN_TINH_THUE","label":null,"total":true},{"group":null,"source":"LINE","code":"THUE_TNCN","label":null,"total":true},{"group":null,"source":"LINE","code":"TRU_BHXH","label":null,"total":true},{"group":null,"source":"LINE","code":"TRU_QUY","label":null,"total":true},{"group":null,"source":"TOTAL","code":"NET_PAY","label":"Thực lĩnh","total":true},{"group":null,"source":"LEAVE","code":"LEAVE_REMAIN","label":"Phép còn lại","total":true},{"group":null,"source":"INFO","code":"DAYS_CHECK","label":"Cảnh báo nhập sai số liệu","total":false},{"group":"Chia DS","source":"LINE","code":"HE_SO_CHIA_DS","label":"Hệ số","total":false},{"group":"Chia DS","source":"LINE","code":"TIEN_CHIA_DS","label":"Thành tiền","total":true}]$c$::jsonb),
    ('BL 02', 'BẢNG THANH TOÁN TIỀN LƯƠNG', 'BL 02', 'PHÒNG KẾ TOÁN', 'BỘ PHẬN: KINH DOANH', true, 20, array['LUONG_DOANH_SO']::text[],
     $c$[{"group":null,"source":"LINE","code":"BAC_LUONG","label":null,"total":true},{"group":null,"source":"LINE","code":"KPIS","label":null,"total":false},{"group":"Lương thời gian","source":"LINE","code":"CONG","label":"Công","total":true},{"group":"Lương thời gian","source":"LINE","code":"LUONG_THOI_GIAN","label":"Tiền","total":true},{"group":"Lương KPI","source":"INFO","code":"BLANK","label":"Công","total":false},{"group":"Lương KPI","source":"LINE","code":"LUONG_KPI","label":"Tiền","total":true},{"group":"Lương phép","source":"DATA","code":"LEAVE_DAYS","label":"Công","total":true},{"group":"Lương phép","source":"LINE","code":"LUONG_PHEP","label":"Tiền","total":true},{"group":"Lương nghỉ lễ","source":"DATA","code":"HOLIDAY_DAYS","label":"Công","total":true},{"group":"Lương nghỉ lễ","source":"LINE","code":"LAM_NGAY_LE","label":null,"total":true},{"group":"Lương nghỉ lễ","source":"LINE","code":"LUONG_NGHI_LE","label":"Tiền","total":true},{"group":null,"source":"LINE","code":"LUONG_DOANH_SO","label":null,"total":true},{"group":null,"source":"LINE","code":"PHU_CAP_TRACH_NHIEM","label":null,"total":true},{"group":"Phạt","source":"LINE","code":"PHAT_KO_BC","label":null,"total":true},{"group":"Phạt","source":"LINE","code":"PHAT_CTKM","label":null,"total":true},{"group":"Phạt","source":"LINE","code":"PHAT_DI_MUON_KHAC","label":null,"total":true},{"group":"Thưởng","source":"LINE","code":"THUONG_CTKM","label":null,"total":true},{"group":"Thưởng","source":"LINE","code":"THUONG_DI_SOM","label":null,"total":true},{"group":"Thưởng","source":"LINE","code":"BU_LUONG","label":null,"total":true},{"group":null,"source":"LINE","code":"THUONG_KHAC","label":null,"total":true},{"group":null,"source":"LINE","code":"PHAT_DI_MUON_QUA_LAN","label":null,"total":true},{"group":null,"source":"LINE","code":"TONG_CONG","label":null,"total":true},{"group":null,"source":"LINE","code":"TN_MIEN_THUE","label":null,"total":true},{"group":"Giảm trừ","source":"LINE","code":"GIAM_TRU","label":"NPT","total":true},{"group":null,"source":"LINE","code":"TN_TINH_THUE","label":null,"total":true},{"group":null,"source":"LINE","code":"THUE_TNCN","label":null,"total":true},{"group":null,"source":"LINE","code":"TRU_BHXH","label":null,"total":true},{"group":null,"source":"LINE","code":"TRU_QUY","label":null,"total":true},{"group":null,"source":"TOTAL","code":"NET_PAY","label":"Thực lĩnh","total":true},{"group":null,"source":"LEAVE","code":"LEAVE_REMAIN","label":"Phép còn lại","total":true},{"group":null,"source":"INFO","code":"DAYS_CHECK","label":"Cảnh báo nhập sai số liệu","total":false}]$c$::jsonb),
    ('Lương cắt lô', 'BẢNG TÍNH DOANH THU', 'DT 01', 'Phòng kế toán', null, false, 30, array['DS_TINH_LUONG', 'DS_CAT_MA']::text[],
     $c$[{"group":null,"source":"LINE","code":"SO_THU_TIEN","label":null,"total":true},{"group":null,"source":"LINE","code":"GIAM_TRU_SO_THU","label":null,"total":true},{"group":null,"source":"LINE","code":"DS_TINH_LUONG","label":null,"total":true},{"group":null,"source":"LINE","code":"DT_CAT_LO","label":"Cắt lô > 40% NH có PG","total":true},{"group":null,"source":"LINE","code":"DS_THU_TIEN_HANG","label":"Doanh số còn lại","total":true},{"group":null,"source":"LINE","code":"DOANH_SO_KHOAN","label":"Số khoán","total":true},{"group":null,"source":"LINE","code":"HE_SO_PT","label":"%","total":false},{"group":"Cắt mã","source":"LINE","code":"SO_THU_CAT_MA","label":"Số thu tiền","total":true},{"group":"Cắt mã","source":"LINE","code":"GIAM_TRU_CAT_MA","label":"Giảm trừ số thu","total":true},{"group":"Cắt mã","source":"LINE","code":"DS_CAT_MA","label":"Doanh số tính lương","total":true},{"group":"Bảng kê lương sản phẩm","source":"LINE","code":"HE_SO_1PT_CAT_MA","label":null,"total":true},{"group":"Bảng kê lương sản phẩm","source":"LINE","code":"HE_SO_1PT","label":null,"total":true},{"group":"Bảng kê lương sản phẩm","source":"LINE","code":"HE_SO_1_5PT","label":null,"total":true},{"group":"Bảng kê lương sản phẩm","source":"LINE","code":"HE_SO_3PT","label":null,"total":true},{"group":"Bảng kê lương sản phẩm","source":"LINE","code":"HE_SO_4PT","label":null,"total":true},{"group":"Bảng kê lương sản phẩm","source":"LINE","code":"THUONG_DS_150","label":null,"total":true},{"group":"Bảng kê lương sản phẩm","source":"LINE","code":"LUONG_DOANH_SO","label":"Tổng cộng","total":true}]$c$::jsonb),
    ('Lương nghỉ phép', 'BẢNG THEO DÕI NGHỈ PHÉP NĂM {năm}', 'HC088', null, null, false, 40, array[]::text[],
     $c$[{"group":"Nghỉ phép trong năm","source":"LEAVE","code":"LEAVE_M01","label":"T1","total":true},{"group":"Nghỉ phép trong năm","source":"LEAVE","code":"LEAVE_M02","label":"T2","total":true},{"group":"Nghỉ phép trong năm","source":"LEAVE","code":"LEAVE_M03","label":"T3","total":true},{"group":"Nghỉ phép trong năm","source":"LEAVE","code":"LEAVE_M04","label":"T4","total":true},{"group":"Nghỉ phép trong năm","source":"LEAVE","code":"LEAVE_M05","label":"T5","total":true},{"group":"Nghỉ phép trong năm","source":"LEAVE","code":"LEAVE_M06","label":"T6","total":true},{"group":"Nghỉ phép trong năm","source":"LEAVE","code":"LEAVE_M07","label":"T7","total":true},{"group":"Nghỉ phép trong năm","source":"LEAVE","code":"LEAVE_M08","label":"T8","total":true},{"group":"Nghỉ phép trong năm","source":"LEAVE","code":"LEAVE_M09","label":"T9","total":true},{"group":"Nghỉ phép trong năm","source":"LEAVE","code":"LEAVE_M10","label":"T10","total":true},{"group":"Nghỉ phép trong năm","source":"LEAVE","code":"LEAVE_M11","label":"T11","total":true},{"group":"Nghỉ phép trong năm","source":"LEAVE","code":"LEAVE_M12","label":"T12","total":true},{"group":"Nghỉ phép trong năm","source":"LEAVE","code":"LEAVE_USED","label":"Cộng","total":true},{"group":null,"source":"LEAVE","code":"LEAVE_QUOTA","label":"Phép năm","total":true},{"group":"Trừ phép đi muộn trong tháng","source":"LEAVE","code":"LATE_M01","label":"T1","total":true},{"group":"Trừ phép đi muộn trong tháng","source":"LEAVE","code":"LATE_M02","label":"T2","total":true},{"group":"Trừ phép đi muộn trong tháng","source":"LEAVE","code":"LATE_M03","label":"T3","total":true},{"group":"Trừ phép đi muộn trong tháng","source":"LEAVE","code":"LATE_M04","label":"T4","total":true},{"group":"Trừ phép đi muộn trong tháng","source":"LEAVE","code":"LATE_M05","label":"T5","total":true},{"group":"Trừ phép đi muộn trong tháng","source":"LEAVE","code":"LATE_M06","label":"T6","total":true},{"group":"Trừ phép đi muộn trong tháng","source":"LEAVE","code":"LATE_M07","label":"T7","total":true},{"group":"Trừ phép đi muộn trong tháng","source":"LEAVE","code":"LATE_M08","label":"T8","total":true},{"group":"Trừ phép đi muộn trong tháng","source":"LEAVE","code":"LATE_M09","label":"T9","total":true},{"group":"Trừ phép đi muộn trong tháng","source":"LEAVE","code":"LATE_M10","label":"T10","total":true},{"group":"Trừ phép đi muộn trong tháng","source":"LEAVE","code":"LATE_M11","label":"T11","total":true},{"group":"Trừ phép đi muộn trong tháng","source":"LEAVE","code":"LATE_M12","label":"T12","total":true},{"group":"Trừ phép đi muộn trong tháng","source":"LEAVE","code":"LATE_TOTAL","label":"Tổng trừ","total":true},{"group":null,"source":"LEAVE","code":"LEAVE_REMAIN","label":"Còn lại","total":true},{"group":null,"source":"INFO","code":"START_DATE","label":"Ngày đi làm chính thức","total":false},{"group":null,"source":"INFO","code":"BLANK","label":"Ghi chú","total":false}]$c$::jsonb),
    ('Tính đầu chai vận chuyển', 'TÍNH ĐẦU CHAI VẬN CHUYỂN', 'HC - 17đc', 'Bộ phận HC', 'ĐVT: VNĐ', false, 50, array['CHAI_XE_MAY']::text[],
     $c$[{"group":"Xe máy","source":"LINE","code":"CHAI_XE_MAY","label":"Chai","total":true},{"group":"Xe máy","source":"LINE","code":"TIEN_CHAI_XE_MAY","label":"Thành tiền","total":true},{"group":"Xe máy","source":"LINE","code":"PK_NGOAI_GIO","label":"Phụ kiện + ngoài giờ","total":true},{"group":"Xe máy","source":"LINE","code":"TIEN_PK_NGOAI_GIO","label":"Thành tiền","total":true},{"group":"Ô tô","source":"LINE","code":"CHAI_O_TO","label":"Chai","total":true},{"group":"Ô tô","source":"LINE","code":"TIEN_CHAI_O_TO","label":"Thành tiền","total":true},{"group":"Ô tô","source":"LINE","code":"BICH_O_TO","label":"Bịch","total":true},{"group":"Ô tô","source":"LINE","code":"TIEN_BICH_O_TO","label":"Thành tiền","total":true},{"group":"Điều chuyển hàng và soạn hàng ĐN, SG","source":"LINE","code":"BICH_CHAI_DIEU_CHUYEN","label":"Bịch + chai","total":true},{"group":"Điều chuyển hàng và soạn hàng ĐN, SG","source":"LINE","code":"TIEN_DIEU_CHUYEN","label":"Thành tiền","total":true},{"group":"Soạn hàng SG, ĐN","source":"LINE","code":"SOAN_HANG","label":"Số lượng","total":true},{"group":"Soạn hàng SG, ĐN","source":"LINE","code":"TIEN_SOAN_HANG","label":"Thành tiền","total":true},{"group":null,"source":"LINE","code":"TIEN_GUI_XE","label":"Tiền gửi xe","total":true},{"group":null,"source":"LINE","code":"LUONG_DT","label":"Tổng cộng","total":true}]$c$::jsonb),
    ('Làm thêm giờ VC', 'BẢNG TÍNH LƯƠNG LÀM THÊM GIỜ KHO K18', null, 'Phòng kế toán', null, true, 60, array['LCB_LAM_THEM']::text[],
     $c$[{"group":null,"source":"LINE","code":"LCB_LAM_THEM","label":null,"total":true},{"group":null,"source":"LINE","code":"LUONG_NGAY_CONG","label":null,"total":true},{"group":"Đi làm trực ngày thứ 7","source":"LINE","code":"GIO_TRUC_T7","label":"Giờ công","total":true},{"group":"Đi làm trực ngày thứ 7","source":"LINE","code":"TIEN_TRUC_T7","label":"Thành tiền","total":true},{"group":"Làm thêm giờ ngày thường","source":"DATA","code":"OT_WEEKDAY_HOURS","label":"Giờ công","total":true},{"group":"Làm thêm giờ ngày thường","source":"LINE","code":"TIEN_GIO_THUONG","label":"Thành tiền","total":true},{"group":"Làm thêm giờ CN","source":"DATA","code":"OT_WEEKEND_HOURS","label":"Giờ công","total":true},{"group":"Làm thêm giờ CN","source":"LINE","code":"TIEN_GIO_CN","label":"Thành tiền","total":true},{"group":"Làm thêm giờ ngày lễ","source":"DATA","code":"OT_HOLIDAY_HOURS","label":"Giờ công","total":true},{"group":"Làm thêm giờ ngày lễ","source":"LINE","code":"TIEN_GIO_LE","label":"Thành tiền","total":true},{"group":null,"source":"LINE","code":"LAM_THEM","label":"Tổng cộng","total":true},{"group":null,"source":"INFO","code":"BLANK","label":"Ghi chú","total":false}]$c$::jsonb)
on conflict ((lower(trim(name)))) do update
set title = excluded.title, form_code = excluded.form_code, issuer = excluded.issuer, subtitle = excluded.subtitle,
    show_standard_days = excluded.show_standard_days, sort_order = excluded.sort_order,
    require_codes = excluded.require_codes, columns = excluded.columns, updated_at = now();
