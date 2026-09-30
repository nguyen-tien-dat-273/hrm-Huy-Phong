-- ============================================================================
-- Dò xem migration nào ĐÃ chạy trên database này.
-- ----------------------------------------------------------------------------
-- Dán cả file vào Supabase -> SQL Editor -> Run. Chỉ ĐỌC, không sửa gì.
--
-- Không tra bảng `supabase_migrations.schema_migrations` vì bảng đó chỉ ghi
-- nhận những lần chạy qua `supabase db push`. SQL dán tay vào SQL Editor vẫn
-- đổi database thật nhưng không để lại dấu vết ở đó, nên tra bảng ấy sẽ báo
-- "chưa chạy" cho thứ đã chạy rồi.
--
-- Thay vào đó dò trực tiếp object mà mỗi migration tạo ra. Có object = đã chạy.
-- ============================================================================

with probe as (
  select * from (values
    ('20260921110000_merge_hours_setting',
     not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'app_settings'
                   and column_name = 'payroll_hours_per_day'),
     'Bỏ thiết lập giờ/ngày trùng lặp ở app_settings'),

    ('20260921120000_unify_insurance_rates',
     not exists (select 1 from public.payroll_components where code = 'ER_SOCIAL'),
     'Gộp tỷ lệ bảo hiểm doanh nghiệp về tham số, xoá khoản ER_*'),

    ('20260921130000_payroll_settings',
     to_regclass('public.payroll_settings') is not null,
     'Tách tham số lương sang bảng riêng, RLS chỉ Admin/CEO'),

    ('20260928100000_union_fee_component',
     exists (select 1 from public.payroll_components where code = 'UNION_FEE'),
     'Khoản đoàn phí công đoàn'),

    ('20260928110000_work_schedules',
     to_regclass('public.work_schedules') is not null,
     'Ca làm việc theo mùa, ngày công chuẩn theo tháng'),

    ('20260928120000_overtime_tax_exemption',
     exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'payroll_components'
               and column_name = 'ot_multiplier'),
     'Miễn thuế phần tăng ca trả cao hơn giờ thường'),

    ('20260928130000_leave_two_stage_approval',
     exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'leave_requests'
               and column_name = 'approval_stage'),
     'Duyệt nghỉ phép hai cấp, chặn ở tầng trigger'),

    ('20260928140000_payroll_adjustments',
     to_regclass('public.payroll_adjustments') is not null,
     'Truy lĩnh, truy thu của kỳ trước'),

    ('20260928150000_unit_pay_items',
     to_regclass('public.unit_pay_items') is not null,
     'Gán khoản lương theo đơn vị + XOÁ bảng salary_profiles'),

    ('20260928160000_payroll_caps_and_minimums',
     exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'payroll_components'
               and column_name = 'tax_exempt_cap'),
     'Trần khoản lương, lương cơ sở/tối thiểu vùng, biểu thuế sửa được')
  ) as t(migration, applied, mo_ta)
)
select
  case when applied then '✅ ĐÃ CHẠY' else '❌ CHƯA CHẠY' end as trang_thai,
  migration,
  mo_ta
from probe
order by applied, migration;

-- ---------------------------------------------------------------------------
-- Trước khi chạy 20260928150000: nó XOÁ bảng `salary_profiles`.
-- Bảng này là mô hình lương đời đầu, dữ liệu đã được chép sang
-- `employee_pay_profiles` từ migration 20260921090000. Chạy câu dưới để tự
-- kiểm chứng trước khi xoá - nếu trả về 0 dòng hoặc báo bảng không tồn tại
-- thì xoá là an toàn.
-- ---------------------------------------------------------------------------
-- Câu này KHÔNG được nhắc `salary_profiles` như một bảng ở bất kỳ đâu.
-- PostgreSQL phân giải tên bảng lúc lập kế hoạch, trước khi chạy - nên kể cả
-- đặt trong nhánh `else` của CASE, hay bọc trong `exists`, thì bảng không tồn
-- tại vẫn làm hỏng cả câu lệnh. Chỉ `to_regclass` nhận tên dạng CHUỖI mới an
-- toàn.
select
  case
    when to_regclass('public.salary_profiles') is null
      then 'Bảng lương cũ đã không còn - lệnh xoá trong 20260928150000 là vô hại, cứ chạy.'
    else 'Bảng lương cũ VẪN CÒN. Chạy câu ở cuối file này để đếm số dòng trước khi xoá.'
  end as salary_profiles,
  (select count(*) from public.employee_pay_profiles) as so_dong_bang_moi;

-- Chỉ chạy câu dưới NẾU câu trên báo bảng cũ vẫn còn. Bảng đã xoá thì câu này
-- báo lỗi 42P01, và đó là kết quả đúng chứ không phải hỏng.
-- select count(*) as con_lai_o_bang_cu from public.salary_profiles;
