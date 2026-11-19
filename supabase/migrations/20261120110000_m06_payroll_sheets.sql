-- ============================================================================
-- M06 — Bảng lương cấu hình được (BL 01, BL 02, Lương cắt lô, Nghỉ phép…).
-- ----------------------------------------------------------------------------
-- Mỗi bảng = một cách XEM dữ liệu lương tháng như một sheet Excel: tên bảng,
-- những ai có mặt, danh sách cột có tiêu đề nhóm (cột gộp hai tầng). Bảng không
-- tính gì: số trong ô lấy từ dòng phiếu lương của người đó (LINE), dữ liệu chấm
-- công của tháng (DATA), sổ phép năm (LEAVE) hoặc tổng của phiếu (TOTAL). Ô số
-- liệu tháng vẫn gõ được ngay trên bảng như Bảng lương.
--
--   columns  [{group, source, code, label, total}]
--            group  tiêu đề cột gộp (null = cột đơn)
--            label  tên cột (null = tên đầu mục / dữ liệu)
--            total  có cộng ở dòng Tổng không
--   require_codes  chỉ hiện người có ít nhất một trong các dòng này ([] = mọi người)
--   unit_ids       chỉ hiện người thuộc các đơn vị này và đơn vị con ([] = mọi đơn vị)
--
-- Gieo sẵn 6 bảng theo "BANG LUONG GUI HRM.xlsx". Chạy SAU 20261120100000.
-- ============================================================================

create table if not exists public.payroll_sheets (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  title text,
  sort_order integer not null default 100,
  require_codes text[] not null default '{}',
  unit_ids uuid[] not null default '{}',
  columns jsonb not null default '[]'::jsonb,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint payroll_sheets_columns_array check (jsonb_typeof(columns) = 'array')
);
create unique index if not exists payroll_sheets_name_key on public.payroll_sheets (lower(trim(name)));
comment on table public.payroll_sheets is
  'Bảng lương cấu hình được (như các sheet Excel): người có mặt + cột có tiêu đề nhóm. Chỉ để xem / nhập, không đổi cách tính.';

alter table public.payroll_sheets enable row level security;
drop policy if exists payroll_sheets_read on public.payroll_sheets;
create policy payroll_sheets_read on public.payroll_sheets for select to authenticated using (true);
revoke insert, update, delete on public.payroll_sheets from authenticated, anon;
grant select on public.payroll_sheets to authenticated;

-- Dữ liệu chấm công mà một cột DATA lấy được (khớp SYSTEM_VARIABLES phía giao diện).
create or replace function public.payroll_sheet_data_codes()
returns text[]
language sql
immutable
as $$
  select array[
    'WORK_DAYS', 'LEAVE_DAYS', 'HOLIDAY_DAYS', 'PAID_DAYS', 'UNPAID_DAYS', 'STANDARD_DAYS', 'WORK_HOURS',
    'HOURS_PER_DAY', 'OT_WEEKDAY_HOURS', 'OT_WEEKEND_HOURS', 'OT_HOLIDAY_HOURS', 'TY_LE_KPI', 'LATE_COUNT',
    'LATE_MINUTES', 'LATE_AFTER_CUTOFF', 'EARLY_COUNT', 'EARLY_MINUTES'
  ];
$$;

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

  -- Chuẩn hoá cột: chỉ giữ các trường đã biết.
  v_columns := (
    select jsonb_agg(jsonb_build_object(
      'group', nullif(trim(coalesce(c ->> 'group', '')), ''),
      'source', c ->> 'source',
      'code', upper(trim(c ->> 'code')),
      'label', nullif(trim(coalesce(c ->> 'label', '')), ''),
      'total', coalesce((c ->> 'total')::boolean, true)
    ) order by ord)
    from jsonb_array_elements(v_columns) with ordinality as e(c, ord)
  );

  if p_id is null then
    insert into public.payroll_sheets (name, title, sort_order, require_codes, unit_ids, columns, updated_by)
    values (
      v_name, nullif(trim(coalesce(p_sheet ->> 'title', '')), ''),
      coalesce((p_sheet ->> 'sort_order')::integer, (select coalesce(max(sort_order), 0) + 10 from public.payroll_sheets)),
      v_require, v_units, v_columns, auth.uid()
    )
    returning id into v_id;
  else
    update public.payroll_sheets
    set name = v_name,
        title = nullif(trim(coalesce(p_sheet ->> 'title', '')), ''),
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

create or replace function public.delete_payroll_sheet(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.can_function('admin.payroll_settings') then
    raise exception 'Bạn không có quyền thiết lập bảng lương.' using errcode = '42501';
  end if;
  delete from public.payroll_sheets where id = p_id;
end;
$$;

revoke all on function public.save_payroll_sheet(uuid, jsonb) from public;
revoke all on function public.delete_payroll_sheet(uuid) from public;
grant execute on function public.save_payroll_sheet(uuid, jsonb) to authenticated;
grant execute on function public.delete_payroll_sheet(uuid) to authenticated;
grant execute on function public.payroll_sheet_data_codes() to authenticated;

-- Gieo 6 bảng theo file Excel (bảng trùng tên thì thay).
insert into public.payroll_sheets (name, title, sort_order, require_codes, columns)
values
    ('BL 01', 'BẢNG THANH TOÁN TIỀN LƯƠNG', 10, array['LUONG_DT']::text[], $c$[{"group":null,"source":"LINE","code":"BAC_LUONG","label":null,"total":true},{"group":null,"source":"LINE","code":"TRACH_NHIEM","label":null,"total":true},{"group":null,"source":"LINE","code":"PHU_CAP","label":null,"total":true},{"group":null,"source":"LINE","code":"KPIS","label":null,"total":false},{"group":"Lương thời gian","source":"LINE","code":"CONG","label":"Công","total":true},{"group":"Lương thời gian","source":"LINE","code":"LUONG_THOI_GIAN","label":"Tiền","total":true},{"group":null,"source":"LINE","code":"LUONG_DT","label":null,"total":true},{"group":"Lương phép","source":"DATA","code":"LEAVE_DAYS","label":"Công","total":true},{"group":"Lương phép","source":"LINE","code":"LUONG_PHEP","label":"Tiền","total":true},{"group":"Lương nghỉ lễ","source":"DATA","code":"HOLIDAY_DAYS","label":"Công","total":true},{"group":"Lương nghỉ lễ","source":"LINE","code":"LUONG_NGHI_LE","label":"Tiền","total":true},{"group":"Làm thêm","source":"LINE","code":"LE_CN","label":null,"total":true},{"group":"Làm thêm","source":"LINE","code":"SAU_22H","label":null,"total":true},{"group":"Làm thêm","source":"LINE","code":"LAM_THEM","label":"Tiền","total":true},{"group":"Phạt","source":"LINE","code":"PHAT_DI_MUON_KH","label":null,"total":true},{"group":"Phạt","source":"LINE","code":"PHAT_KHAC","label":null,"total":true},{"group":"Thưởng","source":"LINE","code":"THUONG_DI_SOM_KHAC","label":null,"total":true},{"group":"Thưởng","source":"LINE","code":"KHAC_THUONG","label":null,"total":true},{"group":"Thưởng","source":"LINE","code":"BS_LUONG","label":null,"total":true},{"group":null,"source":"LINE","code":"PHAT_DI_MUON_QUA_LAN","label":null,"total":true},{"group":null,"source":"LINE","code":"TONG_CONG","label":null,"total":true},{"group":null,"source":"LINE","code":"TN_MIEN_THUE","label":null,"total":true},{"group":"Giảm trừ","source":"LINE","code":"GIAM_TRU","label":"NPT","total":true},{"group":null,"source":"LINE","code":"TN_TINH_THUE","label":null,"total":true},{"group":null,"source":"LINE","code":"THUE_TNCN","label":null,"total":true},{"group":null,"source":"LINE","code":"TRU_BHXH","label":null,"total":true},{"group":null,"source":"LINE","code":"TRU_QUY","label":null,"total":true},{"group":null,"source":"TOTAL","code":"NET_PAY","label":"Thực lĩnh","total":true}]$c$::jsonb),
    ('BL 02', 'BẢNG THANH TOÁN TIỀN LƯƠNG – BỘ PHẬN KINH DOANH', 20, array['LUONG_DOANH_SO']::text[], $c$[{"group":null,"source":"LINE","code":"BAC_LUONG","label":null,"total":true},{"group":null,"source":"LINE","code":"KPIS","label":null,"total":false},{"group":"Lương thời gian","source":"LINE","code":"CONG","label":"Công","total":true},{"group":"Lương thời gian","source":"LINE","code":"LUONG_THOI_GIAN","label":"Tiền","total":true},{"group":"Lương KPI","source":"LINE","code":"LUONG_KPI","label":"Tiền","total":true},{"group":"Lương phép","source":"DATA","code":"LEAVE_DAYS","label":"Công","total":true},{"group":"Lương phép","source":"LINE","code":"LUONG_PHEP","label":"Tiền","total":true},{"group":"Lương nghỉ lễ","source":"DATA","code":"HOLIDAY_DAYS","label":"Công","total":true},{"group":"Lương nghỉ lễ","source":"LINE","code":"LAM_NGAY_LE","label":null,"total":true},{"group":"Lương nghỉ lễ","source":"LINE","code":"LUONG_NGHI_LE","label":"Tiền","total":true},{"group":null,"source":"LINE","code":"LUONG_DOANH_SO","label":null,"total":true},{"group":null,"source":"LINE","code":"PHU_CAP_TRACH_NHIEM","label":null,"total":true},{"group":"Phạt","source":"LINE","code":"PHAT_KO_BC","label":null,"total":true},{"group":"Phạt","source":"LINE","code":"PHAT_CTKM","label":null,"total":true},{"group":"Phạt","source":"LINE","code":"PHAT_DI_MUON_KHAC","label":null,"total":true},{"group":"Thưởng","source":"LINE","code":"THUONG_CTKM","label":null,"total":true},{"group":"Thưởng","source":"LINE","code":"THUONG_DI_SOM","label":null,"total":true},{"group":"Thưởng","source":"LINE","code":"BU_LUONG","label":null,"total":true},{"group":null,"source":"LINE","code":"THUONG_KHAC","label":null,"total":true},{"group":null,"source":"LINE","code":"PHAT_DI_MUON_QUA_LAN","label":null,"total":true},{"group":null,"source":"LINE","code":"TONG_CONG","label":null,"total":true},{"group":null,"source":"LINE","code":"TN_MIEN_THUE","label":null,"total":true},{"group":"Giảm trừ","source":"LINE","code":"GIAM_TRU","label":"NPT","total":true},{"group":null,"source":"LINE","code":"TN_TINH_THUE","label":null,"total":true},{"group":null,"source":"LINE","code":"THUE_TNCN","label":null,"total":true},{"group":null,"source":"LINE","code":"TRU_BHXH","label":null,"total":true},{"group":null,"source":"LINE","code":"TRU_QUY","label":null,"total":true},{"group":null,"source":"TOTAL","code":"NET_PAY","label":"Thực lĩnh","total":true}]$c$::jsonb),
    ('Lương cắt lô', 'BẢNG TÍNH DOANH THU', 30, array['DS_TINH_LUONG', 'DS_CAT_MA']::text[], $c$[{"group":null,"source":"LINE","code":"SO_THU_TIEN","label":null,"total":true},{"group":null,"source":"LINE","code":"GIAM_TRU_SO_THU","label":null,"total":true},{"group":null,"source":"LINE","code":"DS_TINH_LUONG","label":null,"total":true},{"group":null,"source":"LINE","code":"DT_CAT_LO","label":"Cắt lô > 40% NH có PG","total":true},{"group":null,"source":"LINE","code":"DS_THU_TIEN_HANG","label":"Doanh số còn lại","total":true},{"group":null,"source":"LINE","code":"DOANH_SO_KHOAN","label":"Số khoán","total":true},{"group":null,"source":"LINE","code":"HE_SO_PT","label":"%","total":false},{"group":"Cắt mã","source":"LINE","code":"SO_THU_CAT_MA","label":"Số thu tiền","total":true},{"group":"Cắt mã","source":"LINE","code":"GIAM_TRU_CAT_MA","label":"Giảm trừ số thu","total":true},{"group":"Cắt mã","source":"LINE","code":"DS_CAT_MA","label":"Doanh số tính lương","total":true},{"group":"Bảng kê lương sản phẩm","source":"LINE","code":"HE_SO_1PT_CAT_MA","label":null,"total":true},{"group":"Bảng kê lương sản phẩm","source":"LINE","code":"HE_SO_1PT","label":null,"total":true},{"group":"Bảng kê lương sản phẩm","source":"LINE","code":"HE_SO_1_5PT","label":null,"total":true},{"group":"Bảng kê lương sản phẩm","source":"LINE","code":"HE_SO_3PT","label":null,"total":true},{"group":"Bảng kê lương sản phẩm","source":"LINE","code":"HE_SO_4PT","label":null,"total":true},{"group":"Bảng kê lương sản phẩm","source":"LINE","code":"THUONG_DS_150","label":null,"total":true},{"group":"Bảng kê lương sản phẩm","source":"LINE","code":"LUONG_DOANH_SO","label":"Tổng cộng","total":true}]$c$::jsonb),
    ('Lương nghỉ phép', 'BẢNG THEO DÕI NGHỈ PHÉP NĂM', 40, array[]::text[], $c$[{"group":"Nghỉ phép trong năm","source":"LEAVE","code":"LEAVE_M01","label":"T1","total":true},{"group":"Nghỉ phép trong năm","source":"LEAVE","code":"LEAVE_M02","label":"T2","total":true},{"group":"Nghỉ phép trong năm","source":"LEAVE","code":"LEAVE_M03","label":"T3","total":true},{"group":"Nghỉ phép trong năm","source":"LEAVE","code":"LEAVE_M04","label":"T4","total":true},{"group":"Nghỉ phép trong năm","source":"LEAVE","code":"LEAVE_M05","label":"T5","total":true},{"group":"Nghỉ phép trong năm","source":"LEAVE","code":"LEAVE_M06","label":"T6","total":true},{"group":"Nghỉ phép trong năm","source":"LEAVE","code":"LEAVE_M07","label":"T7","total":true},{"group":"Nghỉ phép trong năm","source":"LEAVE","code":"LEAVE_M08","label":"T8","total":true},{"group":"Nghỉ phép trong năm","source":"LEAVE","code":"LEAVE_M09","label":"T9","total":true},{"group":"Nghỉ phép trong năm","source":"LEAVE","code":"LEAVE_M10","label":"T10","total":true},{"group":"Nghỉ phép trong năm","source":"LEAVE","code":"LEAVE_M11","label":"T11","total":true},{"group":"Nghỉ phép trong năm","source":"LEAVE","code":"LEAVE_M12","label":"T12","total":true},{"group":"Nghỉ phép trong năm","source":"LEAVE","code":"LEAVE_USED","label":"Cộng","total":true},{"group":null,"source":"LEAVE","code":"LEAVE_QUOTA","label":"Phép năm","total":true},{"group":"Trừ phép đi muộn trong tháng","source":"LEAVE","code":"LATE_M01","label":"T1","total":true},{"group":"Trừ phép đi muộn trong tháng","source":"LEAVE","code":"LATE_M02","label":"T2","total":true},{"group":"Trừ phép đi muộn trong tháng","source":"LEAVE","code":"LATE_M03","label":"T3","total":true},{"group":"Trừ phép đi muộn trong tháng","source":"LEAVE","code":"LATE_M04","label":"T4","total":true},{"group":"Trừ phép đi muộn trong tháng","source":"LEAVE","code":"LATE_M05","label":"T5","total":true},{"group":"Trừ phép đi muộn trong tháng","source":"LEAVE","code":"LATE_M06","label":"T6","total":true},{"group":"Trừ phép đi muộn trong tháng","source":"LEAVE","code":"LATE_M07","label":"T7","total":true},{"group":"Trừ phép đi muộn trong tháng","source":"LEAVE","code":"LATE_M08","label":"T8","total":true},{"group":"Trừ phép đi muộn trong tháng","source":"LEAVE","code":"LATE_M09","label":"T9","total":true},{"group":"Trừ phép đi muộn trong tháng","source":"LEAVE","code":"LATE_M10","label":"T10","total":true},{"group":"Trừ phép đi muộn trong tháng","source":"LEAVE","code":"LATE_M11","label":"T11","total":true},{"group":"Trừ phép đi muộn trong tháng","source":"LEAVE","code":"LATE_M12","label":"T12","total":true},{"group":"Trừ phép đi muộn trong tháng","source":"LEAVE","code":"LATE_TOTAL","label":"Tổng trừ","total":true},{"group":null,"source":"LEAVE","code":"LEAVE_REMAIN","label":"Còn lại","total":true}]$c$::jsonb),
    ('Tính đầu chai vận chuyển', 'TÍNH ĐẦU CHAI VẬN CHUYỂN', 50, array['CHAI_XE_MAY']::text[], $c$[{"group":"Xe máy","source":"LINE","code":"CHAI_XE_MAY","label":"Chai","total":true},{"group":"Xe máy","source":"LINE","code":"TIEN_CHAI_XE_MAY","label":"Thành tiền","total":true},{"group":"Xe máy","source":"LINE","code":"PK_NGOAI_GIO","label":"Phụ kiện + ngoài giờ","total":true},{"group":"Xe máy","source":"LINE","code":"TIEN_PK_NGOAI_GIO","label":"Thành tiền","total":true},{"group":"Ô tô","source":"LINE","code":"CHAI_O_TO","label":"Chai","total":true},{"group":"Ô tô","source":"LINE","code":"TIEN_CHAI_O_TO","label":"Thành tiền","total":true},{"group":"Ô tô","source":"LINE","code":"BICH_O_TO","label":"Bịch","total":true},{"group":"Ô tô","source":"LINE","code":"TIEN_BICH_O_TO","label":"Thành tiền","total":true},{"group":"Điều chuyển hàng và soạn hàng ĐN, SG","source":"LINE","code":"BICH_CHAI_DIEU_CHUYEN","label":"Bịch + chai","total":true},{"group":"Điều chuyển hàng và soạn hàng ĐN, SG","source":"LINE","code":"TIEN_DIEU_CHUYEN","label":"Thành tiền","total":true},{"group":"Soạn hàng SG, ĐN","source":"LINE","code":"SOAN_HANG","label":"Số lượng","total":true},{"group":"Soạn hàng SG, ĐN","source":"LINE","code":"TIEN_SOAN_HANG","label":"Thành tiền","total":true},{"group":null,"source":"LINE","code":"TIEN_GUI_XE","label":null,"total":true},{"group":null,"source":"LINE","code":"LUONG_DT","label":"Tổng cộng","total":true}]$c$::jsonb),
    ('Làm thêm giờ VC', 'BẢNG TÍNH LƯƠNG LÀM THÊM GIỜ KHO', 60, array['LCB_LAM_THEM']::text[], $c$[{"group":null,"source":"LINE","code":"LCB_LAM_THEM","label":null,"total":true},{"group":null,"source":"LINE","code":"LUONG_NGAY_CONG","label":null,"total":true},{"group":"Đi làm trực ngày thứ 7","source":"LINE","code":"GIO_TRUC_T7","label":"Giờ công","total":true},{"group":"Đi làm trực ngày thứ 7","source":"LINE","code":"TIEN_TRUC_T7","label":"Thành tiền","total":true},{"group":"Làm thêm giờ ngày thường","source":"DATA","code":"OT_WEEKDAY_HOURS","label":"Giờ công","total":true},{"group":"Làm thêm giờ ngày thường","source":"LINE","code":"TIEN_GIO_THUONG","label":"Thành tiền","total":true},{"group":"Làm thêm giờ CN","source":"DATA","code":"OT_WEEKEND_HOURS","label":"Giờ công","total":true},{"group":"Làm thêm giờ CN","source":"LINE","code":"TIEN_GIO_CN","label":"Thành tiền","total":true},{"group":"Làm thêm giờ ngày lễ","source":"DATA","code":"OT_HOLIDAY_HOURS","label":"Giờ công","total":true},{"group":"Làm thêm giờ ngày lễ","source":"LINE","code":"TIEN_GIO_LE","label":"Thành tiền","total":true},{"group":null,"source":"LINE","code":"LAM_THEM","label":"Tổng cộng","total":true}]$c$::jsonb)
on conflict ((lower(trim(name)))) do update
set title = excluded.title, sort_order = excluded.sort_order, require_codes = excluded.require_codes,
    columns = excluded.columns, updated_at = now();
