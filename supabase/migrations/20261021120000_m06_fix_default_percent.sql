-- M06: sửa giá trị % gieo sai ở bảng "Hệ số & đơn giá chung".
-- Tham số đơn vị % lưu theo số phần trăm (1 = 1%); bản gieo trước ghi 0,01 cho
-- tỷ lệ trích quỹ (thành 0,01%) và 1 cho ngưỡng thưởng vượt (thành 1%). Chỉ sửa
-- đúng hai giá trị gieo sai đó trong bảng gieo sẵn — số người dùng đã chỉnh thì giữ.

alter table public.payroll_param_versions disable trigger payroll_param_versions_period_guard;
alter table public.payroll_param_versions disable trigger payroll_param_versions_audit;

update public.payroll_param_versions v
set param_tables = (
  select jsonb_agg(
    case
      when t ->> 'id' = 't' || substr(md5(v.id::text || ':macdinh'), 1, 12) then
        jsonb_set(t, '{params}', (
          select jsonb_agg(
            case
              when p ->> 'code' = 'TY_LE_QUY_1PT' and (p ->> 'value')::numeric = 0.01 then jsonb_set(p, '{value}', '1')
              when p ->> 'code' = 'NGUONG_THUONG_VUOT' and (p ->> 'value')::numeric = 1 then jsonb_set(p, '{value}', '100')
              else p
            end order by ord)
          from jsonb_array_elements(t -> 'params') with ordinality as e(p, ord)
        ))
      else t
    end order by tord)
  from jsonb_array_elements(v.param_tables) with ordinality as x(t, tord)
)
where exists (
  select 1 from jsonb_array_elements(v.param_tables) t
  where t ->> 'id' = 't' || substr(md5(v.id::text || ':macdinh'), 1, 12)
);

alter table public.payroll_param_versions enable trigger payroll_param_versions_period_guard;
alter table public.payroll_param_versions enable trigger payroll_param_versions_audit;
