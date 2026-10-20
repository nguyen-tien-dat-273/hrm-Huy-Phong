-- M06: "Phạt đi muộn quá số lần" theo sheet BL01 (cột R).
--
--   Sheet: tiền trừ = SỐ CÔNG BỊ TRỪ do đi muộn (cột "Trừ công đi muộn" ở bảng chấm công,
--          kế toán nhập) × bậc lương ÷ công chuẩn.
--   Phần "Trừ phép đi muộn" ghi ở sheet chỉ để theo dõi phép — không vào lương, và phép
--   do module Nghỉ phép quản lý nên không chạm tới ở đây.
--
-- Chỉ sửa dòng cơ chế còn đúng bản gieo (đếm lần đi muộn vượt mức × đơn giá).

insert into public.payroll_components (
  code, name, kind, calc_type, default_amount, taxable, insurable, is_base, prorate,
  sort_order, category_code, nature, calc_source, is_active, is_system, note, show_on_payslip
)
select 'SO_CONG_TRU_DI_MUON', 'Số công bị trừ do đi muộn quá số lần', 'INFO', 'FIXED', 0, false, false, false, false,
       45, null, 'VARIABLE', 'ASSIGNED', true, false,
       'Nhập mỗi tháng. Người còn phép thì trừ vào phép (bên Nghỉ phép), không nhập ở đây; chỉ nhập phần bị trừ công.', false
where not exists (select 1 from public.payroll_components c where c.code = 'SO_CONG_TRU_DI_MUON')
  and not exists (select 1 from public.payroll_components c where lower(c.name) = lower('Số công bị trừ do đi muộn quá số lần'));

do $mig$
declare
  v_from date := coalesce((public.payroll_last_closed_month() + interval '1 month')::date, date '2000-01-01');
  v_comp jsonb;
  v_unit uuid;
begin
  select coalesce(jsonb_object_agg(code, id), '{}'::jsonb) into v_comp from public.payroll_components;
  if not (v_comp ? 'SO_CONG_TRU_DI_MUON') then
    raise notice 'Không tạo được dòng "Số công bị trừ do đi muộn quá số lần" (trùng tên) — bỏ qua.';
    return;
  end if;

  for v_unit in select id from public.organization_units where parent_id is null
  loop
    insert into public.unit_pay_items (unit_id, component_id, mode, formula, amount, sort_order, effective_from, note)
    select v_unit, (v_comp ->> 'SO_CONG_TRU_DI_MUON')::uuid, 'MONTHLY_INPUT', null, null, 45, v_from, 'Bảng lương mẫu BL 01'
    where not exists (
      select 1 from public.unit_pay_items i
      where i.unit_id = v_unit and i.component_id = (v_comp ->> 'SO_CONG_TRU_DI_MUON')::uuid
    );

    update public.unit_pay_items
    set formula = 'SO_CONG_TRU_DI_MUON * DAILY_RATE'
    where unit_id = v_unit and component_id = (v_comp ->> 'PHAT_DI_MUON')::uuid
      and formula = 'MAX(LATE_COUNT - SO_LAN_DI_MUON_CHO_PHEP, 0) * DON_GIA_PHAT_DI_MUON_QUA_LAN';
  end loop;
end
$mig$;
