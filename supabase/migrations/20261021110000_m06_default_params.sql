-- M06: bổ sung các tham số mà bộ công thức mẫu cần nhưng bộ tham số chưa có.
-- Công thức tham chiếu biến không tồn tại sẽ báo lỗi "Không có biến ..." và chặn
-- cả bảng lương, nên mỗi bộ tham số phải có đủ các mã này. Chỉ thêm mã còn thiếu,
-- không đụng tới giá trị đã có.

alter table public.payroll_param_versions disable trigger payroll_param_versions_period_guard;
alter table public.payroll_param_versions disable trigger payroll_param_versions_audit;

do $$
declare
  v record;
  v_defs constant jsonb := jsonb_build_array(
    jsonb_build_object('code', 'HE_SO_OT_THUONG', 'name', 'Hệ số OT ngày thường', 'type', 'RATE', 'unit', 'HE_SO', 'value', 1.5),
    jsonb_build_object('code', 'HE_SO_OT_NGHI', 'name', 'Hệ số OT ngày nghỉ hằng tuần', 'type', 'RATE', 'unit', 'HE_SO', 'value', 2),
    jsonb_build_object('code', 'HE_SO_OT_LE', 'name', 'Hệ số OT ngày lễ, tết', 'type', 'RATE', 'unit', 'HE_SO', 'value', 3),
    jsonb_build_object('code', 'TY_LE_QUY_1PT', 'name', 'Tỷ lệ trích quỹ nội bộ', 'type', 'RATE', 'unit', '%', 'value', 1),
    jsonb_build_object('code', 'DON_GIA_PHAT_DI_MUON', 'name', 'Đơn giá phạt mỗi lần đi muộn / về sớm', 'type', 'MONEY', 'unit', 'VND', 'value', 0),
    jsonb_build_object('code', 'SO_LAN_DI_MUON_CHO_PHEP', 'name', 'Số lần đi muộn cho phép trong tháng', 'type', 'COUNT', 'unit', 'LAN', 'value', 0),
    jsonb_build_object('code', 'DON_GIA_PHAT_DI_MUON_QUA_LAN', 'name', 'Đơn giá phạt mỗi lần đi muộn vượt mức', 'type', 'MONEY', 'unit', 'VND', 'value', 0),
    jsonb_build_object('code', 'DON_GIA_PHAT_BAO_CAO', 'name', 'Đơn giá phạt mỗi lần không làm báo cáo', 'type', 'MONEY', 'unit', 'VND', 'value', 0),
    jsonb_build_object('code', 'TY_LE_HH_CAT_MA', 'name', 'Tỷ lệ hoa hồng doanh số cắt mã', 'type', 'RATE', 'unit', '%', 'value', 0),
    jsonb_build_object('code', 'TY_LE_HH_CAT_LO', 'name', 'Tỷ lệ hoa hồng doanh thu cắt lô', 'type', 'RATE', 'unit', '%', 'value', 0),
    jsonb_build_object('code', 'NGUONG_THUONG_VUOT', 'name', 'Ngưỡng đạt doanh số để thưởng vượt', 'type', 'RATE', 'unit', '%', 'value', 100),
    jsonb_build_object('code', 'MUC_THUONG_VUOT', 'name', 'Mức thưởng vượt doanh số', 'type', 'MONEY', 'unit', 'VND', 'value', 0)
  );
  v_missing jsonb;
begin
  for v in select id, param_tables from public.payroll_param_versions
  loop
    select coalesce(jsonb_agg(d), '[]'::jsonb) into v_missing
    from jsonb_array_elements(v_defs) d
    where not exists (
      select 1
      from jsonb_array_elements(coalesce(v.param_tables, '[]'::jsonb)) t
      where t ->> 'code' = d ->> 'code'
         or exists (
           select 1 from jsonb_array_elements(coalesce(t -> 'params', '[]'::jsonb)) p
           where p ->> 'code' = d ->> 'code')
    );

    if jsonb_array_length(v_missing) > 0 then
      update public.payroll_param_versions
      set param_tables = coalesce(param_tables, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
        'id', 't' || substr(md5(v.id::text || ':macdinh'), 1, 12),
        'kind', 'LIST',
        'name', 'Hệ số & đơn giá chung',
        'note', 'Các tham số công thức mẫu cần. Kiểm tra lại giá trị trước khi chốt kỳ.',
        'params', (select jsonb_agg(m || jsonb_build_object('note', null)) from jsonb_array_elements(v_missing) m)
      ))
      where id = v.id;
    end if;
  end loop;
end $$;

alter table public.payroll_param_versions enable trigger payroll_param_versions_period_guard;
alter table public.payroll_param_versions enable trigger payroll_param_versions_audit;
