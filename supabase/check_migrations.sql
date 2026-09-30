-- ============================================================================
-- Do xem migration nao DA chay tren database nay.
-- ----------------------------------------------------------------------------
-- Dan ca file vao Supabase -> SQL Editor -> Run. Chi DOC, khong sua gi.
--
-- Khong tra bang `supabase_migrations.schema_migrations` vi bang do chi ghi
-- nhan nhung lan chay qua `supabase db push`. SQL dan tay vao SQL Editor van
-- doi database that nhung khong de lai dau vet o do, nen tra bang ay se bao
-- "chua chay" cho thu da chay roi.
--
-- Thay vao do do truc tiep object ma moi migration tao ra. Co object = da chay.
--
-- Ca file la MOT cau lenh duy nhat. Supabase SQL Editor chi hien ket qua cua
-- cau lenh CUOI CUNG, nen tach lam hai cau se nuot mat bang dau - phan viec
-- lam tay o cuoi duoc noi thang vao cung mot bang bang UNION ALL.
--
-- LUU Y khi doc ket qua: moi dong do MOT object dac trung. Migration nao chay
-- do dang (dut giua chung) van co the bao "DA CHAY" neu object duoc do nam o
-- dau file. Gap truong hop nghi ngo thi cu chay lai - moi migration trong thu
-- muc nay deu viet de chay lai duoc nhieu lan.
-- ============================================================================

with probe as (
  select * from (values

    -- --- Nen tang luong (thang 9, dot dau) ---------------------------------
    ('20260921110000_merge_hours_setting',
     not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'app_settings'
                   and column_name = 'payroll_hours_per_day'),
     'Bo thiet lap gio/ngay trung lap o app_settings'),

    ('20260921120000_unify_insurance_rates',
     not exists (select 1 from public.payroll_components where code = 'ER_SOCIAL'),
     'Gop ty le bao hiem doanh nghiep ve tham so, xoa khoan ER_*'),

    ('20260921130000_payroll_settings',
     to_regclass('public.payroll_settings') is not null,
     'Tach tham so luong sang bang rieng, RLS chi Admin/CEO'),

    ('20260926100000_attendance_devices',
     to_regclass('public.attendance_devices') is not null,
     'May cham cong: thiet bi, token, su kien'),

    ('20260927100000_kpi_position_templates',
     to_regclass('public.kpi_position_templates') is not null,
     'Bo KPI theo vi tri va tieu chi'),

    ('20260927110000_kpi_payroll_bridge',
     exists (select 1 from public.payroll_components where code = 'LUONG_KPI'),
     'Khoan LUONG_KPI va cau noi KPI -> bang luong'),

    ('20260928100000_union_fee_component',
     exists (select 1 from public.payroll_components where code = 'QUY_CONG_DOAN'),
     'Khoan Quy cong doan'),

    ('20260928110000_work_schedules',
     to_regclass('public.work_schedules') is not null
       or exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'organization_units'
                    and column_name = 'schedule_id'),
     'Ca lam viec, do di muon ve som'),

    ('20260928120000_overtime_tax_exemption',
     exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'payroll_components'
               and column_name = 'ot_multiplier'),
     'Mien thue phan vuot 100% cua tien tang ca'),

    ('20260928130000_leave_two_stage_approval',
     to_regclass('public.leave_cancellation_requests') is not null,
     'Duyet don nghi hai cap theo so ngay'),

    ('20260928140000_payroll_adjustments',
     to_regclass('public.payroll_adjustments') is not null,
     'Truy linh / truy thu ky truoc'),

    ('20260928150000_unit_pay_items',
     to_regclass('public.unit_pay_items') is not null,
     'Gan khoan luong cho ca don vi; xoa bang salary_profiles cu'),

    ('20260928160000_payroll_caps_and_minimums',
     exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'payroll_components'
               and column_name = 'max_amount'),
     'Tran so tien cua khoan luong, muc luong toi thieu vung'),

    -- --- KPI (29/09) -------------------------------------------------------
    ('20260929100000_kpi_auto_scoring',
     exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'kpi_template_criteria'
               and column_name = 'measure_unit'),
     'Tu cham diem tu so lieu thuc te theo thang muc'),

    ('20260929110000_kpi_flexible_methods',
     exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'kpi_position_templates'
               and column_name = 'score_method'),
     'Cach tinh ket qua, tran va san ket qua'),

    ('20260929120000_kpi_blocks',
     to_regclass('public.kpi_blocks') is not null,
     'Khoi nghiep vu cua bo KPI thanh danh muc'),

    ('20260929130000_daily_assignments',
     to_regclass('public.daily_assignments') is not null,
     'Giao viec hang ngay'),

    ('20260929130000_employee_profile_records',
     exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'profiles'
               and column_name = 'permanent_address'),
     'Ho so nhan su: que quan, dia chi, hoc van'),

    ('20260929140000_lock_timesheet_period',
     exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = 'timesheet_period_locked'),
     'Khoa ky cong: chan sua cham cong va don nghi cua ky da khoa'),

    -- --- Ra soat theo tai lieu BRD (30/09) ---------------------------------
    ('20260930100000_teamlead_department_scope',
     exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = 'manages_employee'),
     'Truong nhom chi xem duoc cham cong trong pham vi quan ly (RC1.2)'),

    ('20260930110000_attendance_requests',
     to_regclass('public.attendance_requests') is not null,
     'Don giai trinh di muon / quen cham cong'),

    ('20260930120000_process_library',
     to_regclass('public.process_documents') is not null,
     'Thu vien quy trinh, bieu mau (can tao bucket process-documents)'),

    ('20260930130000_public_apply_form',
     exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'recruitment_job_postings'
               and column_name = 'public_code'),
     'Form ung tuyen cong khai (RC2.5)'),

    -- --- KPI chi ra thong so, luong tinh tien (30/09) ----------------------
    ('20260930140000_kpi_metrics_only',
     exists (select 1 from public.payroll_components
             where code = 'LUONG_KPI' and formula like '%MUC_RIENG%'),
     'KPI chi day KPI_PCT; muc luong KPI khai o Co che luong'),

    ('20260930150000_drop_okr_goals',
     to_regclass('public.performance_goals') is null,
     'Bo OKR'),

    ('20260930160000_employee_kpi_scheme',
     to_regclass('public.employee_kpi_schemes') is not null,
     'Gan bo KPI rieng cho tung nguoi'),

    ('20260930170000_kpi_effective_weight',
     exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'performance_review_scores'
               and column_name = 'not_applicable'),
     'Tieu chi khong phat sinh nhuong ty trong cho phan con lai'),

    ('20260930180000_kpi_period_month',
     exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'performance_reviews'
               and column_name = 'period_month'),
     'Bo chu ky danh gia, chuyen sang chon thang ngay tren man cham'),

    ('20260930190000_kpi_score_methods',
     to_regclass('public.kpi_score_methods') is not null
       and to_regclass('public.unit_kpi_schemes') is not null,
     'Danh muc cach tinh ket qua KPI + gan bo KPI cho ca don vi'),

    ('20260930200000_profiles_role_teamlead',
     exists (select 1 from pg_constraint con
             join pg_class rel on rel.oid = con.conrelid
             join pg_namespace nsp on nsp.oid = rel.relnamespace
             where nsp.nspname = 'public' and rel.relname = 'profiles'
               and con.contype = 'c'
               and pg_get_constraintdef(con.oid) like '%teamlead%'),
     'Mo CHECK profiles.role cho vai tro Truong nhom'),

    ('20260930210000_huyphong_pay_components',
     exists (select 1 from public.payroll_components where code = 'LUONG_VAN_CHUYEN'),
     'Danh muc khoan luong theo cong thuc Huy Phong'),

    ('20260930220000_pay_component_groups',
     exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'payroll_components'
               and column_name = 'group_name'),
     'Nhom khoan luong; don khoan cong doan trung; tra lai dau tieng Viet'),

    -- Khong do bang to_regclass duoc: migration nay chi THAY than ham
    -- ingest_attendance_device_events, khong tao object moi. Do bang chinh
    -- doan ma da sua trong than ham.
    ('20260927130000_attendance_device_autoapprove',
     exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = 'ingest_attendance_device_events'
               and p.prosrc like '%approved_by_lead = true%'),
     'Cham cong tu may tu duyet - THIEU THI LUONG RA 0 NGAY CONG'),

    ('20260930230000_attendance_device_arrival_only',
     exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'attendance_devices'
               and column_name = 'records_checkout'),
     'May chi ghi gio vao - THIEU THI DONG BO VANG EXCEPTION')

  ) as t(migration, applied, mo_ta)
)
select
  case when applied then 'DA CHAY' else '>>> CHUA CHAY' end as trang_thai,
  migration,
  mo_ta
from probe

union all

-- Viec ngoai migration: phai lam tay tren dashboard, khong file nao chay ho.
select
  case
    when exists (select 1 from storage.buckets where id = 'process-documents')
      then 'DA CHAY'
    else '>>> CHUA CHAY'
  end,
  'zz1. Bucket process-documents',
  'Storage -> New bucket -> ten process-documents (thu vien quy trinh)'

union all

select
  case
    when (select count(*) from public.payroll_components
          where code in ('QUY_CONG_DOAN', 'PHI_CONG_DOAN', 'UNION_FEE') and is_active) > 1
      then '>>> CHUA CHAY'
    else 'DA CHAY'
  end,
  'zz2. Khoan cong doan trung',
  'Dang bat ' || (select count(*) from public.payroll_components
                  where code in ('QUY_CONG_DOAN', 'PHI_CONG_DOAN', 'UNION_FEE') and is_active)
    || ' khoan cong doan. Nen chi bat mot - gan hai khoan cho cung mot nguoi la tru hai lan.'

-- Chua chay len dau: doc tu tren xuong la ra viec phai lam.
order by 1 desc, 2;
