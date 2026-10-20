-- M06: đưa cơ chế chung và bộ tham số về đúng bảng lương mẫu BL 01 / BL 02.
--
-- Đối chiếu từng cột của sheet BL01, BL 02, CAT LO (tháng 08/2026) và danh mục khoản lương:
--
--   BL 01  Trách nhiệm            = mức trách nhiệm của người × tỷ lệ KPI       (cột D = mức × KPI)
--          Thu nhập miễn thuế     = mức miễn thuế theo người ÷ công chuẩn × ngày hưởng lương
--                                   + MIN(1.200.000; 1.500.000 ÷ công chuẩn × ngày hưởng lương)
--                                   (mức theo người là 1.000.000 hoặc 500.000 — cột X / Y)
--   BL 02  Bậc lương KPI          = bậc lương ÷ 3                                (cột H = C / 3 × KPI)
--          Phụ cấp / trách nhiệm  = số khai cho từng người, không nhân KPI       (cột O)
--          Lương DT sau cắt lô    = 1% doanh số thu cắt lô, chỉ khi đạt từ 75%   (cột AP)
--          Thưởng doanh số 150%   = nửa tháng bậc lương khi đạt từ 150%          (ghi chú quy chế)
--          Lương thời gian        = 70% khi đạt dưới 30% doanh số khoán           (ghi chú quy chế)
--   Tham số  giảm trừ bản thân 15.500.000, người phụ thuộc 6.200.000, biểu thuế 5 bậc,
--            hoa hồng 75% / 90% / 105% → 1,5% / 3% / 4%, cắt mã và cắt lô 1%, quỹ 1%,
--            bảo hiểm người lao động 8% / 1,5% / 1%, doanh nghiệp 17,5% / 3% / 1%,
--            công chuẩn mặc định 23,5, làm tròn thực lĩnh tới hàng nghìn.
--
-- Chỉ sửa dòng cơ chế còn đúng như bản gieo sẵn — dòng người dùng đã tự sửa thì giữ.
-- Bộ tham số: chỉ sửa bộ chưa dùng cho kỳ đã chốt; bộ mới nhất đã khoá thì tạo bộ mới
-- hiệu lực từ kỳ đang mở.

-- ---------------------------------------------------------------------------
-- 1. Dòng trung gian mới
-- ---------------------------------------------------------------------------
insert into public.payroll_components (
  code, name, kind, calc_type, default_amount, taxable, insurable, is_base, prorate,
  sort_order, category_code, nature, calc_source, is_active, is_system, note, show_on_payslip
)
select m.code, m.name, 'INFO', 'FIXED', 0, false, false, false, false,
       m.sort_order, null, 'VARIABLE', 'ASSIGNED', true, false, m.note, false
from (values
  ('MUC_TRACH_NHIEM', 'Mức trách nhiệm', 305,
    'Khai cho từng người. Trách nhiệm trên phiếu = mức trách nhiệm × tỷ lệ KPI.'),
  ('MUC_MIEN_THUE', 'Mức miễn thuế theo người', 705,
    'Phần thu nhập không chịu thuế tính theo ngày hưởng lương — thường 1.000.000 hoặc 500.000.')
) as m(code, name, sort_order, note)
where not exists (select 1 from public.payroll_components c where c.code = m.code)
  and not exists (select 1 from public.payroll_components c where lower(c.name) = lower(m.name));

-- ---------------------------------------------------------------------------
-- 2. Cơ chế chung
-- ---------------------------------------------------------------------------
do $mig$
declare
  v_last date := public.payroll_last_closed_month();
  v_from date := coalesce((public.payroll_last_closed_month() + interval '1 month')::date, date '2000-01-01');
  v_unit record;
  v_sales uuid[];
  v_sales_id uuid;
  v_comp jsonb;
begin
  select coalesce(jsonb_object_agg(code, id), '{}'::jsonb) into v_comp from public.payroll_components;

  -- Đơn vị Kinh doanh trên cùng — đúng cách migration gieo bảng lương mẫu đã chọn.
  select coalesce(array_agg(u.id), '{}') into v_sales
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

  -- BL 01 — đơn vị gốc
  for v_unit in select id from public.organization_units where parent_id is null
  loop
    -- Trách nhiệm theo KPI: chỉ đổi khi dòng vẫn là "giá trị chung 0" của bản gieo.
    update public.unit_pay_items
    set mode = 'FORMULA', formula = 'MUC_TRACH_NHIEM * TY_LE_KPI', amount = null
    where unit_id = v_unit.id and component_id = (v_comp ->> 'ALLOW_RESPONSIBILITY')::uuid
      and mode = 'VALUE' and coalesce(amount, 0) = 0;

    update public.unit_pay_items
    set formula = 'MUC_MIEN_THUE / STANDARD_DAYS * PAID_DAYS + MIN(TRAN_MIEN_THUE_PHU_CAP, MIEN_THUE_PHU_CAP / STANDARD_DAYS * PAID_DAYS)'
    where unit_id = v_unit.id and component_id = (v_comp ->> 'THU_NHAP_MIEN_THUE')::uuid
      and mode = 'FORMULA'
      and formula = '1000000 / STANDARD_DAYS * PAID_DAYS + MIN(1200000, 1500000 / STANDARD_DAYS * PAID_DAYS)';

    insert into public.unit_pay_items (unit_id, component_id, mode, formula, amount, sort_order, effective_from, note)
    select v_unit.id, (v_comp ->> s.code)::uuid, s.mode, null, s.amount, s.sort_order, v_from, 'Bảng lương mẫu BL 01'
    from (values ('MUC_TRACH_NHIEM', 'VALUE', 0::numeric, 305), ('MUC_MIEN_THUE', 'VALUE', 1000000::numeric, 705))
      as s(code, mode, amount, sort_order)
    where v_comp ? s.code
      and not exists (
        select 1 from public.unit_pay_items i
        where i.unit_id = v_unit.id and i.component_id = (v_comp ->> s.code)::uuid
      );
  end loop;

  -- BL 02 — đơn vị Kinh doanh
  foreach v_sales_id in array v_sales
  loop
    update public.unit_pay_items
    set mode = 'FORMULA', formula = 'LUONG_CO_BAN / 3', amount = null
    where unit_id = v_sales_id and component_id = (v_comp ->> 'MUC_KPI')::uuid
      and mode = 'PER_PERSON';

    update public.unit_pay_items
    set formula = 'IF(TY_LE_DAT_DS / 100 >= NGUONG_HH_CAT_LO, DOANH_SO_THU_CAT_LO * TY_LE_HH_CAT_LO, 0)'
    where unit_id = v_sales_id and component_id = (v_comp ->> 'LUONG_DT_CAT_LO')::uuid
      and formula = 'DOANH_SO_THU_CAT_LO * TY_LE_HH_CAT_LO';

    update public.unit_pay_items
    set formula = 'IF(TY_LE_DAT_DS / 100 >= NGUONG_THUONG_VUOT, LUONG_CO_BAN * TY_LE_THUONG_VUOT, 0)'
    where unit_id = v_sales_id and component_id = (v_comp ->> 'THUONG_DOANH_SO_VUOT')::uuid
      and formula = 'IF(TY_LE_DAT_DS / 100 > NGUONG_THUONG_VUOT, MUC_THUONG_VUOT, 0)';

    insert into public.unit_pay_items (unit_id, component_id, mode, formula, amount, sort_order, effective_from, note)
    select v_sales_id, (v_comp ->> s.code)::uuid, s.mode, s.formula, s.amount, s.sort_order, v_from, 'Bảng lương mẫu BL 02'
    from (values
      -- Phụ cấp / trách nhiệm của người kinh doanh là số khai riêng, không nhân KPI.
      ('ALLOW_RESPONSIBILITY', 'VALUE', null::text, 0::numeric, 310),
      ('BASE_WORK', 'FORMULA',
        'DAILY_RATE * WORK_DAYS * IF(DOANH_SO_KHOAN > 0 && TY_LE_DAT_DS / 100 < NGUONG_DS_TOI_THIEU, TY_LE_LUONG_DUOI_NGUONG, 1)',
        null::numeric, 100)
    ) as s(code, mode, formula, amount, sort_order)
    where v_comp ? s.code
      and not exists (
        select 1 from public.unit_pay_items i
        where i.unit_id = v_sales_id and i.component_id = (v_comp ->> s.code)::uuid
      );
  end loop;
end
$mig$;

-- ---------------------------------------------------------------------------
-- 3. Bộ tham số
-- ---------------------------------------------------------------------------
-- Đặt giá trị một tham số: có ở bảng nào thì sửa tại đó, chưa có thì thêm vào bảng
-- "Hệ số & đơn giá chung" (tạo bảng nếu chưa có).
create or replace function public.m06_tmp_set_param(
  p_tables jsonb, p_version uuid, p_code text, p_name text, p_type text, p_unit text, p_value numeric
) returns jsonb
language plpgsql
as $$
declare
  v_found boolean;
  v_common text := 't' || substr(md5(p_version::text || ':macdinh'), 1, 12);
begin
  select exists (
    select 1 from jsonb_array_elements(p_tables) t, jsonb_array_elements(coalesce(t -> 'params', '[]'::jsonb)) p
    where p ->> 'code' = p_code
  ) into v_found;

  if v_found then
    return (
      select jsonb_agg(
        case when t ? 'params' then jsonb_set(t, '{params}', (
          select coalesce(jsonb_agg(
            case when p ->> 'code' = p_code then jsonb_set(p, '{value}', to_jsonb(p_value)) else p end
            order by po), '[]'::jsonb)
          from jsonb_array_elements(t -> 'params') with ordinality as e(p, po)
        )) else t end
        order by tord)
      from jsonb_array_elements(p_tables) with ordinality as x(t, tord)
    );
  end if;

  if not exists (select 1 from jsonb_array_elements(p_tables) t where t ->> 'id' = v_common) then
    p_tables := p_tables || jsonb_build_array(jsonb_build_object(
      'id', v_common, 'kind', 'LIST', 'name', 'Hệ số & đơn giá chung',
      'note', 'Các tham số công thức mẫu cần. Kiểm tra lại giá trị trước khi chốt kỳ.',
      'params', '[]'::jsonb));
  end if;

  return (
    select jsonb_agg(
      case when t ->> 'id' = v_common then jsonb_set(t, '{params}', (t -> 'params') || jsonb_build_array(
        jsonb_build_object('code', p_code, 'name', p_name, 'type', p_type, 'unit', p_unit, 'value', p_value, 'note', null)))
      else t end
      order by tord)
    from jsonb_array_elements(p_tables) with ordinality as x(t, tord)
  );
end;
$$;

-- Đặt các bậc của một bảng bậc thang: có thì thay bậc, chưa có thì thêm bảng.
create or replace function public.m06_tmp_set_tier(
  p_tables jsonb, p_version uuid, p_code text, p_name text, p_mode text, p_input_label text, p_unit text, p_rows jsonb
) returns jsonb
language plpgsql
as $$
begin
  if exists (select 1 from jsonb_array_elements(p_tables) t where t ->> 'code' = p_code) then
    return (
      select jsonb_agg(
        case when t ->> 'code' = p_code
          then t || jsonb_build_object('mode', p_mode, 'unit', p_unit, 'rows', p_rows)
          else t end
        order by tord)
      from jsonb_array_elements(p_tables) with ordinality as x(t, tord)
    );
  end if;
  return p_tables || jsonb_build_array(jsonb_build_object(
    'id', 't' || substr(md5(p_version::text || ':tier:' || p_code), 1, 12), 'kind', 'TIER',
    'name', p_name, 'note', null, 'code', p_code, 'mode', p_mode, 'input_label', p_input_label,
    'unit', p_unit, 'rows', p_rows));
end;
$$;

alter table public.payroll_param_versions disable trigger payroll_param_versions_period_guard;
alter table public.payroll_param_versions disable trigger payroll_param_versions_audit;

do $mig$
declare
  v_last date := public.payroll_last_closed_month();
  v_latest public.payroll_param_versions;
  v record;
  t jsonb;
begin
  -- Bộ mới nhất đã dùng cho kỳ chốt: chép thành bộ mới hiệu lực từ kỳ đang mở.
  select * into v_latest from public.payroll_param_versions order by effective_from desc limit 1;
  if v_latest.id is not null and v_last is not null and v_latest.effective_from <= v_last then
    insert into public.payroll_param_versions
    select (jsonb_populate_record(null::public.payroll_param_versions, to_jsonb(v_latest) || jsonb_build_object(
      'id', gen_random_uuid(),
      'effective_from', (v_last + interval '1 month')::date,
      'label', 'Theo bảng lương mẫu',
      'updated_at', now()
    ))).*;
  end if;

  for v in
    select id, param_tables from public.payroll_param_versions
    where v_last is null or effective_from > v_last
  loop
    t := coalesce(v.param_tables, '[]'::jsonb);
    t := public.m06_tmp_set_param(t, v.id, 'GIAM_TRU_BAN_THAN', 'Giảm trừ bản thân', 'MONEY', 'VND_THANG', 15500000);
    t := public.m06_tmp_set_param(t, v.id, 'GIAM_TRU_NPT', 'Giảm trừ mỗi người phụ thuộc', 'MONEY', 'VND_THANG', 6200000);
    t := public.m06_tmp_set_param(t, v.id, 'TY_LE_BHXH_NLD', 'Tỷ lệ BHXH người lao động', 'RATE', '%', 8);
    t := public.m06_tmp_set_param(t, v.id, 'TY_LE_BHYT_NLD', 'Tỷ lệ BHYT người lao động', 'RATE', '%', 1.5);
    t := public.m06_tmp_set_param(t, v.id, 'TY_LE_BHTN_NLD', 'Tỷ lệ BHTN người lao động', 'RATE', '%', 1);
    t := public.m06_tmp_set_param(t, v.id, 'TY_LE_BHXH_DN', 'Tỷ lệ BHXH doanh nghiệp', 'RATE', '%', 17.5);
    t := public.m06_tmp_set_param(t, v.id, 'TY_LE_BHYT_DN', 'Tỷ lệ BHYT doanh nghiệp', 'RATE', '%', 3);
    t := public.m06_tmp_set_param(t, v.id, 'TY_LE_BHTN_DN', 'Tỷ lệ BHTN doanh nghiệp', 'RATE', '%', 1);
    t := public.m06_tmp_set_param(t, v.id, 'TY_LE_QUY_1PT', 'Tỷ lệ trích quỹ nội bộ', 'RATE', '%', 1);
    t := public.m06_tmp_set_param(t, v.id, 'TY_LE_HH_CAT_MA', 'Tỷ lệ hoa hồng doanh số cắt mã', 'RATE', '%', 1);
    t := public.m06_tmp_set_param(t, v.id, 'TY_LE_HH_CAT_LO', 'Tỷ lệ hoa hồng doanh thu cắt lô', 'RATE', '%', 1);
    t := public.m06_tmp_set_param(t, v.id, 'NGUONG_HH_CAT_LO', 'Tỷ lệ đạt tối thiểu để hưởng hoa hồng cắt lô', 'RATE', '%', 75);
    t := public.m06_tmp_set_param(t, v.id, 'NGUONG_THUONG_VUOT', 'Ngưỡng đạt doanh số để thưởng vượt', 'RATE', '%', 150);
    t := public.m06_tmp_set_param(t, v.id, 'TY_LE_THUONG_VUOT', 'Thưởng vượt — phần bậc lương được hưởng', 'RATE', '%', 50);
    t := public.m06_tmp_set_param(t, v.id, 'NGUONG_DS_TOI_THIEU', 'Tỷ lệ đạt doanh số tối thiểu', 'RATE', '%', 30);
    t := public.m06_tmp_set_param(t, v.id, 'TY_LE_LUONG_DUOI_NGUONG', 'Lương thời gian khi dưới tỷ lệ tối thiểu', 'RATE', '%', 70);
    t := public.m06_tmp_set_param(t, v.id, 'MIEN_THUE_PHU_CAP', 'Phụ cấp miễn thuế theo ngày — mức tháng', 'MONEY', 'VND', 1500000);
    t := public.m06_tmp_set_param(t, v.id, 'TRAN_MIEN_THUE_PHU_CAP', 'Phụ cấp miễn thuế theo ngày — trần', 'MONEY', 'VND', 1200000);
    t := public.m06_tmp_set_tier(t, v.id, 'THUE_LUY_TIEN', 'Biểu thuế lũy tiến', 'PROGRESSIVE', 'Thu nhập tính thuế', '%',
      '[{"from": 0, "value": 5}, {"from": 10000000, "value": 10}, {"from": 30000000, "value": 20},
        {"from": 60000000, "value": 30}, {"from": 100000000, "value": 35}]'::jsonb);
    t := public.m06_tmp_set_tier(t, v.id, 'HH_BL02', 'Hoa hồng doanh thu theo tỷ lệ đạt', 'LOOKUP', 'Tỷ lệ đạt doanh số (%)', '%',
      '[{"from": 0, "value": 0}, {"from": 75, "value": 1.5}, {"from": 90, "value": 3}, {"from": 105, "value": 4}]'::jsonb);

    update public.payroll_param_versions
    set param_tables = t, standard_work_days = 23.5, net_rounding_unit = 1000, net_rounding_mode = 'NEAREST'
    where id = v.id;
  end loop;
end
$mig$;

alter table public.payroll_param_versions enable trigger payroll_param_versions_period_guard;
alter table public.payroll_param_versions enable trigger payroll_param_versions_audit;

drop function public.m06_tmp_set_param(jsonb, uuid, text, text, text, text, numeric);
drop function public.m06_tmp_set_tier(jsonb, uuid, text, text, text, text, text, jsonb);
