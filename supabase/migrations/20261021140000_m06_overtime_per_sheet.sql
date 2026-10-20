-- M06: làm thêm giờ theo sheet "Thêm giờ VC" và BL 02.
--
--   Đơn giá giờ   = lương tính làm thêm ÷ công chuẩn ÷ giờ chuẩn mỗi ngày
--                   (lương tính làm thêm là mức riêng của từng người, mặc định bằng bậc lương —
--                    sheet: Hùng 10 tr / bậc 8 tr, Hà 7 tr / bậc 5 tr)
--   Hệ số          ngày thường 1, Chủ nhật / ngày nghỉ 1,5, ngày lễ 2
--   Kinh doanh     làm ngày lễ tính 3 lần đơn giá ngày (BL 02: bậc lương ÷ công chuẩn × ngày lễ × 3)
--
-- Chỉ sửa dòng cơ chế còn đúng bản gieo; chỉ sửa bộ tham số chưa dùng cho kỳ đã chốt.

insert into public.payroll_components (
  code, name, kind, calc_type, default_amount, taxable, insurable, is_base, prorate,
  sort_order, category_code, nature, calc_source, is_active, is_system, note, show_on_payslip
)
select 'LUONG_TINH_OT', 'Lương tính làm thêm giờ', 'INFO', 'FIXED', 0, false, false, false, false,
       25, null, 'VARIABLE', 'ASSIGNED', true, false,
       'Mức lương dùng tính đơn giá giờ làm thêm. Mặc định bằng bậc lương; khai riêng nếu khác.', false
where not exists (select 1 from public.payroll_components c where c.code = 'LUONG_TINH_OT')
  and not exists (select 1 from public.payroll_components c where lower(c.name) = lower('Lương tính làm thêm giờ'));

do $mig$
declare
  v_from date := coalesce((public.payroll_last_closed_month() + interval '1 month')::date, date '2000-01-01');
  v_comp jsonb;
  v_unit uuid;
  v_sales uuid;
begin
  select coalesce(jsonb_object_agg(code, id), '{}'::jsonb) into v_comp from public.payroll_components;
  if not (v_comp ? 'LUONG_TINH_OT') then
    raise notice 'Không tạo được dòng "Lương tính làm thêm giờ" (trùng tên) — bỏ qua phần cơ chế.';
    return;
  end if;

  for v_unit in select id from public.organization_units where parent_id is null
  loop
    insert into public.unit_pay_items (unit_id, component_id, mode, formula, amount, sort_order, effective_from, note)
    select v_unit, (v_comp ->> 'LUONG_TINH_OT')::uuid, 'FORMULA', 'LUONG_CO_BAN', null, 25, v_from, 'Bảng lương mẫu BL 01'
    where not exists (
      select 1 from public.unit_pay_items i
      where i.unit_id = v_unit and i.component_id = (v_comp ->> 'LUONG_TINH_OT')::uuid
    );

    update public.unit_pay_items
    set formula = 'LUONG_TINH_OT / STANDARD_DAYS / HOURS_PER_DAY'
    where unit_id = v_unit and component_id = (v_comp ->> 'HOURLY_RATE')::uuid
      and formula = 'DAILY_RATE / HOURS_PER_DAY';
  end loop;

  -- Kinh doanh: làm ngày lễ = đơn giá ngày × số ngày lễ đi làm × 3 (giờ quy ra ngày).
  for v_sales in
    select u.id
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
    select v_sales, (v_comp ->> 'OT_HOLIDAY')::uuid, 'FORMULA',
           'DAILY_RATE / HOURS_PER_DAY * HE_SO_LAM_LE_KD * OT_HOLIDAY_HOURS', null, 150, v_from, 'Bảng lương mẫu BL 02'
    where v_comp ? 'OT_HOLIDAY'
      and not exists (
        select 1 from public.unit_pay_items i
        where i.unit_id = v_sales and i.component_id = (v_comp ->> 'OT_HOLIDAY')::uuid
      );
  end loop;
end
$mig$;

-- Bộ tham số: hệ số theo sheet. Có mã thì sửa, chưa có thì thêm vào "Hệ số & đơn giá chung".
create or replace function public.m06_tmp_set_param(
  p_tables jsonb, p_version uuid, p_code text, p_name text, p_type text, p_unit text, p_value numeric
) returns jsonb
language plpgsql
as $$
declare
  v_common text := 't' || substr(md5(p_version::text || ':macdinh'), 1, 12);
begin
  if exists (
    select 1 from jsonb_array_elements(p_tables) t, jsonb_array_elements(coalesce(t -> 'params', '[]'::jsonb)) p
    where p ->> 'code' = p_code
  ) then
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

alter table public.payroll_param_versions disable trigger payroll_param_versions_period_guard;
alter table public.payroll_param_versions disable trigger payroll_param_versions_audit;

do $mig$
declare
  v_last date := public.payroll_last_closed_month();
  v record;
  t jsonb;
begin
  for v in
    select id, param_tables from public.payroll_param_versions
    where v_last is null or effective_from > v_last
  loop
    t := coalesce(v.param_tables, '[]'::jsonb);
    t := public.m06_tmp_set_param(t, v.id, 'HE_SO_OT_THUONG', 'Hệ số OT ngày thường', 'RATE', 'HE_SO', 1);
    t := public.m06_tmp_set_param(t, v.id, 'HE_SO_OT_NGHI', 'Hệ số OT ngày nghỉ hằng tuần', 'RATE', 'HE_SO', 1.5);
    t := public.m06_tmp_set_param(t, v.id, 'HE_SO_OT_LE', 'Hệ số OT ngày lễ, tết', 'RATE', 'HE_SO', 2);
    t := public.m06_tmp_set_param(t, v.id, 'HE_SO_LAM_LE_KD', 'Hệ số làm ngày lễ — kinh doanh', 'RATE', 'HE_SO', 3);
    update public.payroll_param_versions set param_tables = t where id = v.id;
  end loop;
end
$mig$;

alter table public.payroll_param_versions enable trigger payroll_param_versions_period_guard;
alter table public.payroll_param_versions enable trigger payroll_param_versions_audit;

drop function public.m06_tmp_set_param(jsonb, uuid, text, text, text, text, numeric);
