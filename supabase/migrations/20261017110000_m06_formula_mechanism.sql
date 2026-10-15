-- ============================================================================
-- M06 — Lương tính hoàn toàn bằng CÔNG THỨC người dùng dựng.
-- ----------------------------------------------------------------------------
-- Trước đây engine tự tính ngầm lương thời gian / phép / lễ, bảo hiểm, thuế
-- TNCN; tham số là các cột cố định (tỷ lệ BHXH, biểu thuế…). Giờ:
--
--   Danh mục    chỉ là danh sách đầu mục. Mỗi đầu mục có LOẠI DÒNG: cộng vào
--               lương (EARNING), trừ khỏi lương (DEDUCTION), chỉ để tính (INFO).
--               Không còn khoản "hệ thống tự tính".
--   Tham số     xếp trong các BẢNG người dùng tự tạo (`param_tables`), mỗi tham
--               số có loại (thời gian / giá / tỷ lệ / số lượng) và đơn vị. Bảng
--               bậc thang gọi như hàm (tra bậc hoặc lũy tiến từng phần).
--   Cơ chế      (payroll_templates) = danh sách đầu mục, mỗi dòng một cách lấy
--               giá trị: FORMULA / VALUE / PER_PERSON / MONTHLY_INPUT.
--   Thực lĩnh   = tổng dòng cộng − tổng dòng trừ, làm tròn theo bộ tham số.
--
-- Dữ liệu cũ được chuyển sang mô hình mới sao cho phiếu lương ra cùng số:
--   * tham số cố định + tham số tự đặt + biểu thuế → các bảng tham số;
--   * phần engine tính ngầm (lương thời gian / phép / lễ, bảo hiểm, thuế) →
--     các dòng công thức, thêm vào mọi cơ chế đang dùng; người chưa thuộc cơ
--     chế nào nhận "Cơ chế chung" gồm đúng các dòng đó;
--   * cách tính của danh mục (theo ngày, theo giờ, %, chia ngày công, trần) →
--     công thức của từng dòng; số liệu nhập tay trong công thức → đầu mục
--     "chỉ để tính" lấy theo số liệu tháng;
--   * người phụ thuộc, mức đóng BH, không đóng BH, thuế khoán, công chuẩn
--     riêng, lương ngày / giờ / khoán, khoản không chịu thuế khai riêng →
--     giá trị hoặc công thức khai riêng của từng người;
--   * tỷ lệ % trong công thức nay là phần trăm thật (1,5% = 0,015), nên "/ 100"
--     ngay sau tham số % được bỏ.
--
-- Kỳ đã khoá giữ nguyên: phiếu lương đã ghi không bị tính lại.
-- Chạy lại được: bước chuyển dữ liệu chỉ chạy ở lần đầu (khi cột `mode` của
-- dòng cơ chế chưa có).
-- ============================================================================

-- Bảng thường (không phải bảng tạm): SQL Editor có thể chạy mỗi câu ở một phiên khác
-- nhau, bảng tạm sẽ mất giữa chừng. Giữ giá trị lần đầu nếu phải chạy lại; xoá ở cuối.
-- LƯU Ý CHẠY: toàn bộ file là MỘT câu lệnh (khối DO) vì SQL Editor của Supabase
-- không cho câu lệnh sau đọc thứ câu trước vừa tạo. Dán nguyên file rồi Run một lần.
do $mig$
begin
create table if not exists public._m06_formula_ctx as
select not exists (
  select 1 from information_schema.columns
  where table_schema = 'public' and table_name = 'payroll_template_items' and column_name = 'mode'
) as first_run;

-- Cây đơn vị: mỗi đơn vị kèm mọi đơn vị con cháu và khoảng cách tới nó.
drop table if exists _m06_unit_tree;
create table public._m06_unit_tree as
with recursive tree(root_id, unit_id, depth) as (
  select id, id, 0 from public.organization_units
  union all
  select tree.root_id, o.id, tree.depth + 1
  from public.organization_units o join tree on o.parent_id = tree.unit_id
  where tree.depth < 20
)
select root_id, unit_id, min(depth) as depth from tree group by root_id, unit_id;

-- Engine cũ lấy lương gốc từ dòng "lương gốc" của mẫu / đơn vị nếu người đó
-- thuộc một mẫu / đơn vị có dòng ấy (mức trống = mức mặc định), và khi đó BỎ
-- QUA mức lương ở hồ sơ. Ghi lại TRƯỚC khi đổi cách gán cơ chế ở dưới.
drop table if exists _m06_old_base;
create table public._m06_old_base as
select p.user_id, p.effective_from,
       exists (
         select 1
         from public.payroll_template_items i
         join public.payroll_components b on b.id = i.component_id and b.is_base
         join public.payroll_templates t on t.id = i.template_id and t.is_active
         where i.template_id = public.payroll_template_for(p.user_id, date_trunc('month', p.effective_from)::date)
           and i.effective_from <= (date_trunc('month', p.effective_from) + interval '1 month - 1 day')::date
           and (i.effective_to is null or i.effective_to >= date_trunc('month', p.effective_from)::date)
       ) or exists (
         select 1
         from public.profiles pr
         join _m06_unit_tree t on t.unit_id = pr.unit_id
         join public.unit_pay_items u on u.unit_id = t.root_id
         join public.payroll_components b on b.id = u.component_id and b.is_base
         where pr.id = p.user_id
           and u.effective_from <= (date_trunc('month', p.effective_from) + interval '1 month - 1 day')::date
           and (u.effective_to is null or u.effective_to >= date_trunc('month', p.effective_from)::date)
       ) as shared_base
from public.employee_pay_profiles p;

-- Mỗi người đang thuộc cơ chế nào (điền sau khi gán xong "Cơ chế chung").
drop table if exists _m06_person_tpl;
create table public._m06_person_tpl (user_id uuid, unit_id uuid, template_id uuid);

-- ---------------------------------------------------------------------------
-- 1. Danh mục: loại dòng INFO, nhóm "Số liệu", không còn khoản tự tính
-- ---------------------------------------------------------------------------
alter table public.payroll_components drop constraint if exists payroll_components_kind_check;
alter table public.payroll_components
  add constraint payroll_components_kind_check check (kind in ('EARNING', 'DEDUCTION', 'INFO', 'EMPLOYER_COST'));

alter table public.payslip_lines drop constraint if exists payslip_lines_kind_check;
alter table public.payslip_lines
  add constraint payslip_lines_kind_check check (kind in ('EARNING', 'DEDUCTION', 'INFO', 'EMPLOYER_COST'));

alter table public.payroll_component_categories drop constraint if exists payroll_component_categories_allowed_kinds_check;
alter table public.payroll_component_categories
  add constraint payroll_component_categories_allowed_kinds_check
  check (allowed_kinds <@ array['EARNING', 'DEDUCTION', 'INFO', 'EMPLOYER_COST']::text[] and cardinality(allowed_kinds) > 0);

-- Nhãn báo cáo: người dùng gắn cho đầu mục để báo cáo (bảo hiểm & thuế theo
-- tháng) biết số nào thuộc cột nào. Không vào công thức, không đổi cách tính;
-- khi chốt kỳ, số của các đầu mục cùng nhãn được cộng vào cột tương ứng của
-- phiếu lương. Hệ thống vẫn không biết "bảo hiểm" hay "thuế" là gì — nhãn là
-- do người dùng khai.
alter table public.payroll_components add column if not exists report_tag text;
alter table public.payroll_components drop constraint if exists payroll_components_report_tag_check;
alter table public.payroll_components
  add constraint payroll_components_report_tag_check
  check (report_tag is null or report_tag in ('INSURANCE_EMPLOYEE', 'INSURANCE_EMPLOYER', 'INCOME_TAX', 'TAXABLE_INCOME'));

comment on column public.payroll_components.report_tag is
  'Nhãn báo cáo: INSURANCE_EMPLOYEE / INSURANCE_EMPLOYER / INCOME_TAX / TAXABLE_INCOME. Chỉ để báo cáo; không ảnh hưởng cách tính.';

-- Nhóm chỉ còn để xếp danh mục cho dễ nhìn — loại dòng chọn độc lập.
update public.payroll_component_categories
set allowed_kinds = array['EARNING', 'DEDUCTION', 'INFO']::text[];

insert into public.payroll_component_categories (code, name, description, allowed_kinds, default_nature, sort_order)
values ('SO_LIEU', 'Số liệu & dòng trung gian',
        'Con số dùng để tính dòng khác hoặc hiện trên phiếu: đơn giá ngày, lương đóng bảo hiểm, số người phụ thuộc, doanh số…',
        array['EARNING', 'DEDUCTION', 'INFO']::text[], 'VARIABLE', 60)
on conflict (code) do nothing;

comment on table public.payroll_component_categories is
  'Nhóm để xếp danh mục đầu mục lương. Loại dòng (cộng / trừ / chỉ để tính) chọn độc lập với nhóm.';

-- Tên dành riêng: dữ liệu tự động engine cấp + hàm dựng sẵn. Khớp
-- `RESERVED_FORMULA_NAMES` ở client (lib/payrollVariables.ts).
create or replace function public.payroll_reserved_formula_names()
returns text[]
language sql
immutable
as $$
  select array[
    'WORK_DAYS', 'LEAVE_DAYS', 'HOLIDAY_DAYS', 'PAID_DAYS', 'UNPAID_DAYS', 'STANDARD_DAYS', 'WORK_HOURS',
    'HOURS_PER_DAY', 'OT_WEEKDAY_HOURS', 'OT_WEEKEND_HOURS', 'OT_HOLIDAY_HOURS', 'TY_LE_KPI', 'KPI_PCT',
    'LATE_COUNT', 'LATE_MINUTES', 'LATE_AFTER_CUTOFF', 'EARLY_COUNT', 'EARLY_MINUTES', 'TONG_THU_NHAP',
    'ADJ_RECOVERY', 'ADJ_CLAWBACK', 'MUC_RIENG',
    'MIN', 'MAX', 'ROUND', 'FLOOR', 'CEIL', 'ABS', 'IF'
  ]::text[];
$$;

grant execute on function public.payroll_reserved_formula_names() to authenticated;

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
  if new.category_code is null then
    new.category_code := case
      when new.kind = 'DEDUCTION' then 'KHAU_TRU_PHAT'
      when new.kind = 'INFO' then 'SO_LIEU'
      else 'THU_NHAP_BIEN_DOI'
    end;
  end if;
  if not exists (select 1 from public.payroll_component_categories g where g.code = new.category_code) then
    raise exception 'Nhóm "%" không tồn tại.', new.category_code using errcode = '23503';
  end if;
  -- Chỉ xét khi tên / mã thực sự đổi: dữ liệu cũ có thể đang trùng sẵn, và
  -- sửa một trường khác của dòng đó không được bị chặn vì chuyện cũ.
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
  if new.nature is null then
    select g.default_nature into new.nature from public.payroll_component_categories g where g.code = new.category_code;
  end if;
  -- Khoản người lao động đóng và thuế phải là dòng TRỪ (không thì tổng trừ trên
  -- phiếu bị cộng hai lần); phần doanh nghiệp đóng và thu nhập tính thuế là
  -- dòng CHỈ ĐỂ TÍNH.
  if new.report_tag in ('INSURANCE_EMPLOYEE', 'INCOME_TAX') and new.kind <> 'DEDUCTION' then
    raise exception 'Nhãn báo cáo của đầu mục "%" chỉ dùng với loại dòng "Trừ khỏi lương".', new.name
      using errcode = '23514';
  end if;
  if new.report_tag = 'INSURANCE_EMPLOYER' and new.kind not in ('INFO', 'EMPLOYER_COST') then
    raise exception 'Nhãn báo cáo của đầu mục "%" chỉ dùng với loại dòng "Chỉ để tính".', new.name
      using errcode = '23514';
  end if;
  if new.report_tag = 'TAXABLE_INCOME' and new.kind <> 'INFO' then
    raise exception 'Nhãn báo cáo của đầu mục "%" chỉ dùng với loại dòng "Chỉ để tính".', new.name
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

-- Không còn khoản "hệ thống tự tính" nào để chặn gán.
drop trigger if exists employee_pay_items_assignable on public.employee_pay_items;
drop trigger if exists unit_pay_items_assignable on public.unit_pay_items;
drop trigger if exists payroll_template_items_assignable on public.payroll_template_items;
drop function if exists public.guard_assignable_payroll_component();

create or replace function public.remove_payroll_component(p_component_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_component public.payroll_components%rowtype;
begin
  if auth.uid() is null or not public.can_function('admin.payroll_components') then
    raise exception 'Bạn không có quyền quản lý danh mục đầu mục lương.' using errcode = '42501';
  end if;
  select * into v_component from public.payroll_components where id = p_component_id for update;
  if v_component.id is null then
    raise exception 'Không tìm thấy đầu mục.' using errcode = 'P0002';
  end if;
  if public.payroll_component_used_in_closed_period(v_component.code) then
    if v_component.is_active then
      update public.payroll_components set is_active = false where id = p_component_id;
    end if;
    perform public.write_payroll_audit(
      'salary.component_delete_blocked', 'payroll_component', p_component_id::text,
      format('Chặn xoá đầu mục %s — %s: đã phát sinh trong kỳ lương đã chốt, chuyển Khóa', v_component.code, v_component.name),
      null
    );
    return 'DEACTIVATED';
  end if;
  delete from public.payroll_components where id = p_component_id;
  return 'DELETED';
end;
$$;

revoke all on function public.remove_payroll_component(uuid) from public;
grant execute on function public.remove_payroll_component(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Danh mục chuẩn và đầu mục phụ trợ
-- ---------------------------------------------------------------------------
-- Danh mục chuẩn: không còn khoản tự tính; lương cơ bản là dòng chỉ để tính
-- (là MỨC để các dòng khác nhân chia, không tự cộng vào lương).
-- Thêm cột nhãn báo cáo nên phải dựng lại hàm (đổi kiểu trả về).
drop function if exists public.payroll_standard_catalog();
create function public.payroll_standard_catalog()
returns table (
  std_no integer,
  code text,
  name text,
  category_code text,
  kind text,
  nature text,
  calc_source text,
  taxable boolean,
  insurable boolean,
  is_base boolean,
  sort_order integer,
  note text,
  report_tag text
)
language sql
stable
as $$
  select t.*,
         case t.code when 'INS_EMPLOYEE' then 'INSURANCE_EMPLOYEE' when 'PIT' then 'INCOME_TAX' end::text
  from (values
    (1,  'LUONG_CO_BAN', 'Lương cơ bản / Bậc lương', 'THU_NHAP_CO_DINH', 'INFO', 'FIXED', 'ASSIGNED', true, true, true, 10,
         'Mức lương theo hợp đồng/chức danh làm cơ sở tính các khoản lương thời gian.'),
    (2,  'ALLOW_RESPONSIBILITY', 'Trách nhiệm', 'THU_NHAP_CO_DINH', 'EARNING', 'FIXED', 'ASSIGNED', true, true, false, 111,
         'Phụ cấp chức vụ hoặc tiền trách nhiệm công việc.'),
    (3,  'PHU_CAP_KHAC', 'Phụ cấp / Trợ cấp khác', 'THU_NHAP_CO_DINH', 'EARNING', 'FIXED', 'ASSIGNED', true, false, false, 148,
         'Các khoản phụ cấp cố định theo chính sách công ty (ăn trưa, xăng xe, điện thoại...).'),
    (4,  'BASE_WORK', 'Lương thời gian', 'THU_NHAP_BIEN_DOI', 'EARNING', 'VARIABLE', 'ASSIGNED', true, true, false, 20,
         'Tiền lương tính theo ngày công thực tế làm việc.'),
    (5,  'BASE_LEAVE', 'Lương phép', 'THU_NHAP_BIEN_DOI', 'EARNING', 'VARIABLE', 'ASSIGNED', true, true, false, 21,
         'Tiền lương cho những ngày nghỉ phép năm được hưởng lương.'),
    (6,  'BASE_HOLIDAY', 'Lương nghỉ lễ', 'THU_NHAP_BIEN_DOI', 'EARNING', 'VARIABLE', 'ASSIGNED', true, true, false, 22,
         'Tiền lương cho các ngày nghỉ lễ, Tết theo quy định nhà nước.'),
    (7,  'LUONG_KPI', 'Lương KPI', 'THU_NHAP_BIEN_DOI', 'EARNING', 'VARIABLE', 'ASSIGNED', true, false, false, 200,
         'Khoản thu nhập tính theo kết quả đánh giá KPI thực tế.'),
    (8,  'LUONG_DOANH_SO', 'Lương doanh thu (Lương DT)', 'THU_NHAP_BIEN_DOI', 'EARNING', 'VARIABLE', 'ASSIGNED', true, false, false, 115,
         'Khoản thu nhập hoa hồng tính theo doanh số/doanh thu thực tế.'),
    (9,  'LUONG_DT_CAT_LO', 'Lương doanh thu sau cắt lô (>40% / nhà hàng có PG)', 'THU_NHAP_BIEN_DOI', 'EARNING', 'VARIABLE', 'ASSIGNED', true, false, false, 116,
         'Khoản hoa hồng tính trên doanh số sau khi đã trừ cắt lô (>40% / nhà hàng có PG).'),
    (10, 'LUONG_VAN_CHUYEN', 'Lương vận chuyển', 'THU_NHAP_BIEN_DOI', 'EARNING', 'VARIABLE', 'ASSIGNED', true, false, false, 110,
         'Tiền trả cho đội vận chuyển dựa trên sản lượng (chai, bịch, soạn hàng, gửi xe).'),
    (11, 'PC_CONG_TAC_TINH', 'Phụ cấp công tác tỉnh', 'THU_NHAP_BIEN_DOI', 'EARNING', 'VARIABLE', 'ASSIGNED', true, false, false, 142,
         'Khoản hỗ trợ chi trả cho nhân sự đi thị trường/tỉnh theo ngày thực tế.'),
    (12, 'OT_WEEKDAY', 'Lương OT ngày thường', 'LAM_THEM_GIO', 'EARNING', 'VARIABLE', 'ASSIGNED', true, false, false, 210,
         'Tiền làm thêm giờ vào ngày thường (Hệ số 150%).'),
    (13, 'OT_WEEKEND', 'Lương OT Chủ nhật / Ngày nghỉ', 'LAM_THEM_GIO', 'EARNING', 'VARIABLE', 'ASSIGNED', true, false, false, 220,
         'Tiền làm thêm giờ vào ngày nghỉ hằng tuần/Chủ nhật (Hệ số 200%).'),
    (14, 'OT_HOLIDAY', 'Lương OT Ngày lễ', 'LAM_THEM_GIO', 'EARNING', 'VARIABLE', 'ASSIGNED', true, false, false, 230,
         'Tiền làm thêm giờ vào các ngày Lễ, Tết (Hệ số 300%).'),
    (15, 'CONG_THEM_DEM', 'Lương làm thêm ca đêm', 'LAM_THEM_GIO', 'EARNING', 'VARIABLE', 'ASSIGNED', true, false, false, 240,
         'Tiền phụ cấp/lương cho thời gian làm việc sau 22h.'),
    (16, 'THUONG_DI_SOM', 'Thưởng đi sớm', 'THUONG_PHAT_SINH', 'EARNING', 'VARIABLE', 'ASSIGNED', true, false, false, 300,
         'Thưởng chuyên cần cho nhân sự đi làm sớm/đúng giờ.'),
    (17, 'THUONG_CTKM', 'Thưởng CTKM / Mở mới', 'THUONG_PHAT_SINH', 'EARNING', 'VARIABLE', 'ASSIGNED', true, false, false, 301,
         'Thưởng chương trình khuyến mại hoặc mở điểm bán mới (Khối KD).'),
    (18, 'THUONG_DOANH_SO_VUOT', 'Thưởng doanh số 150%', 'THUONG_PHAT_SINH', 'EARNING', 'VARIABLE', 'ASSIGNED', true, false, false, 302,
         'Thưởng khi hoàn thành vượt mức 150% chỉ tiêu doanh số.'),
    (19, 'THUONG_THANG', 'Thưởng khác / Bổ sung lương', 'THUONG_PHAT_SINH', 'EARNING', 'BOTH', 'ASSIGNED', true, false, false, 303,
         'Các khoản thưởng đột xuất, bổ sung lương hoặc bù lương phát sinh trong kỳ.'),
    (20, 'INS_EMPLOYEE', 'BHXH, BHYT, BHTN', 'KHAU_TRU_PHAT', 'DEDUCTION', 'VARIABLE', 'ASSIGNED', false, false, false, 600,
         'Các khoản bảo hiểm bắt buộc do người lao động đóng (8%, 1.5%, 1%).'),
    (21, 'PIT', 'Thuế TNCN', 'KHAU_TRU_PHAT', 'DEDUCTION', 'VARIABLE', 'ASSIGNED', false, false, false, 601,
         'Thuế thu nhập cá nhân tính theo biểu thuế lũy tiến 7 bậc.'),
    (22, 'QUY_CONG_DOAN', 'Trừ 1% nhập quỹ', 'KHAU_TRU_PHAT', 'DEDUCTION', 'VARIABLE', 'ASSIGNED', false, false, false, 900,
         'Quỹ nội bộ trích theo quy định riêng của Huy Phong.'),
    (23, 'ADVANCE', 'Tạm ứng', 'KHAU_TRU_PHAT', 'DEDUCTION', 'FIXED', 'ASSIGNED', false, false, false, 620,
         'Trừ số tiền nhân viên đã ứng trước trong kỳ.'),
    (24, 'PHAT_DI_MUON_VE_SOM', 'Phạt đi muộn / Về sớm', 'KHAU_TRU_PHAT', 'DEDUCTION', 'VARIABLE', 'ASSIGNED', false, false, false, 810,
         'Khấu trừ do vi phạm giờ giấc qua máy chấm công.'),
    (25, 'PHAT_BAO_CAO', 'Phạt không thực hiện kế hoạch / Báo cáo', 'KHAU_TRU_PHAT', 'DEDUCTION', 'VARIABLE', 'ASSIGNED', false, false, false, 815,
         'Khấu trừ do lỗi không làm báo cáo ngày hoặc không hoàn thành kế hoạch.'),
    (26, 'PHAT_DI_MUON', 'Phạt đi muộn quá số lần', 'KHAU_TRU_PHAT', 'DEDUCTION', 'VARIABLE', 'ASSIGNED', false, false, false, 820,
         'Khoản phạt bổ sung khi số lần đi muộn vượt ngưỡng quy chế.')
  ) as t(std_no, code, name, category_code, kind, nature, calc_source, taxable, insurable, is_base, sort_order, note);
$$;

grant execute on function public.payroll_standard_catalog() to authenticated;

-- Nạp danh mục chuẩn: như bản cũ, thêm nhãn báo cáo của khoản chuẩn.
create or replace function public.seed_standard_payroll_catalog()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted integer;
  v_has_base boolean;
begin
  if auth.uid() is null or not public.can_function('admin.payroll_components') then
    raise exception 'Bạn không có quyền quản lý danh mục khoản lương.' using errcode = '42501';
  end if;

  select exists (select 1 from public.payroll_components where is_base) into v_has_base;

  insert into public.payroll_components (
    code, name, kind, calc_type, default_amount, taxable, insurable, is_base,
    prorate, sort_order, category_code, nature, calc_source, is_active, is_system, note, report_tag
  )
  select
    s.code, s.name, s.kind, 'FIXED', 0, s.taxable, s.insurable,
    s.is_base and not v_has_base,
    false, s.sort_order, s.category_code, s.nature, s.calc_source, true,
    s.calc_source = 'ENGINE', s.note, s.report_tag
  from public.payroll_standard_catalog() s
  where not exists (select 1 from public.payroll_components c where c.code = s.code)
    and not exists (select 1 from public.payroll_components c where lower(c.name) = lower(s.name));

  get diagnostics v_inserted = row_count;

  perform public.write_payroll_audit(
    'salary.catalog_seed', 'payroll_component', null,
    format('Khởi tạo danh mục chuẩn: thêm %s khoản', v_inserted),
    null
  );
  return v_inserted;
end;
$$;

revoke all on function public.seed_standard_payroll_catalog() from public;
grant execute on function public.seed_standard_payroll_catalog() to authenticated;

-- Thêm các đầu mục còn thiếu (theo mã) mà cơ chế cần: lấy từ danh mục chuẩn,
-- hoặc từ bộ đầu mục phụ trợ "chỉ để tính" dưới đây. Trùng tên với một đầu
-- mục mã khác thì bỏ qua thay vì làm hỏng cả lượt. Trả về số đầu mục vừa thêm.
create or replace function public.payroll_ensure_components(p_codes text[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_standard integer;
  v_helper integer;
  v_has_base boolean := exists (select 1 from public.payroll_components where is_base);
begin
  insert into public.payroll_components (
    code, name, kind, calc_type, default_amount, taxable, insurable, is_base, prorate,
    sort_order, category_code, nature, calc_source, is_active, is_system, note, report_tag
  )
  select s.code, s.name, s.kind, 'FIXED', 0, s.taxable, s.insurable, s.is_base and not v_has_base, false,
         s.sort_order, s.category_code, s.nature, 'ASSIGNED', true, false, s.note, s.report_tag
  from public.payroll_standard_catalog() s
  where s.code = any(p_codes)
    and not exists (select 1 from public.payroll_components c where c.code = s.code)
    and not exists (select 1 from public.payroll_components c where lower(c.name) = lower(s.name));
  get diagnostics v_standard = row_count;

  insert into public.payroll_components (
    code, name, kind, calc_type, default_amount, category_code, nature, calc_source, is_active, is_system, sort_order, note,
    report_tag
  )
  select h.code, h.name, 'INFO', 'FIXED', 0, 'SO_LIEU', 'VARIABLE', 'ASSIGNED', true, false, h.sort_order, h.note, h.report_tag
  from (values
    ('DAILY_RATE', 'Đơn giá ngày', 11, 'Lương cơ bản chia công chuẩn của tháng.', null::text),
    ('HOURLY_RATE', 'Đơn giá giờ', 12, 'Đơn giá ngày chia giờ làm chuẩn mỗi ngày.', null),
    ('MUC_KPI', 'Bậc lương KPI', 15, 'Mức lương KPI khai cho từng người.', null),
    ('DOANH_SO', 'Doanh số', 105, 'Nhập mỗi tháng.', null),
    ('DOANH_SO_KHOAN', 'Doanh số khoán', 106, 'Nhập mỗi tháng.', null),
    ('DOANH_SO_CAT_MA', 'Doanh số cắt mã', 107, 'Nhập mỗi tháng.', null),
    ('DOANH_SO_THU_CAT_LO', 'Doanh số thu cắt lô', 108, 'Nhập mỗi tháng.', null),
    ('SO_CHUYEN', 'Số chuyến', 109, 'Nhập mỗi tháng.', null),
    ('INSURANCE_BASE', 'Lương đóng bảo hiểm', 590, 'Mặc định bằng lương cơ bản; khai riêng nếu khác.', null),
    ('DEPENDENTS', 'Số người phụ thuộc', 595, 'Khai cho từng người.', null),
    ('THU_NHAP_CHIU_THUE', 'Thu nhập chịu thuế', 597, 'Tổng thu nhập trừ phần không chịu thuế.', null),
    ('THU_NHAP_TINH_THUE', 'Thu nhập tính thuế', 598, 'Thu nhập chịu thuế trừ bảo hiểm và các khoản giảm trừ.', 'TAXABLE_INCOME'),
    ('INS_EMPLOYER', 'BH doanh nghiệp đóng', 602,
      'Phần bảo hiểm, kinh phí công đoàn doanh nghiệp đóng thêm — không trừ của nhân viên.', 'INSURANCE_EMPLOYER'),
    ('SO_LAN_THIEU_BAO_CAO', 'Số lần thiếu báo cáo / kế hoạch', 812, 'Nhập mỗi tháng.', null)
  ) as h(code, name, sort_order, note, report_tag)
  where h.code = any(p_codes)
    and not exists (select 1 from public.payroll_components c where c.code = h.code)
    and not exists (select 1 from public.payroll_components c where lower(c.name) = lower(h.name));
  get diagnostics v_helper = row_count;

  return v_standard + v_helper;
end;
$$;

revoke all on function public.payroll_ensure_components(text[]) from public, anon, authenticated;

-- Khoản cũ "hệ thống tự tính" thành đầu mục thường; lương cơ bản là MỨC để
-- tính; phần doanh nghiệp đóng thành dòng chỉ để tính.
update public.payroll_components set calc_source = 'ASSIGNED', is_system = false where calc_source = 'ENGINE';
update public.payroll_components set kind = 'INFO' where (code = 'LUONG_CO_BAN' or is_base) and kind <> 'INFO';
-- Phần doanh nghiệp đóng thêm cũ (phúc lợi… do người dùng tự định nghĩa) vẫn
-- tính vào cột "doanh nghiệp đóng thêm" của báo cáo như trước, nay bằng nhãn.
-- Bốn khoản BH / KPCĐ do engine cũ tự tính được thay bằng dòng "BH doanh nghiệp đóng".
update public.payroll_components set report_tag = 'INSURANCE_EMPLOYER'
where kind = 'EMPLOYER_COST' and report_tag is null
  and code not in ('ER_SOCIAL', 'ER_HEALTH', 'ER_UNEMPLOY', 'ER_UNION_FUND');
update public.payroll_components set kind = 'INFO' where kind = 'EMPLOYER_COST';

-- ---------------------------------------------------------------------------
-- 3. Bỏ dẫn chiếu tài liệu khỏi chữ người dùng nhìn thấy
-- ---------------------------------------------------------------------------
-- Bỏ mã điều khoản đặc tả (BR-PAY-…, FR06…), câu nhắc tới tài liệu / đặc tả.
-- Giữ phần còn lại của ghi chú (kể cả lưu ý luật như "Điều 127 BLLĐ").
create or replace function public.m06_tmp_payroll_strip_doc_refs(p_text text)
returns text
language sql
immutable
as $$
  with cleaned as (
    select regexp_replace(
             regexp_replace(coalesce(p_text, ''), '\s*\((BR-PAY|FR ?\d|F0?6\.\d)[^)]*\)', '', 'gi'),
             '(BR-PAY-\d+|FR ?\d+(\.\d+)+|F0?6\.\d+(\.\d+)*)\s*[:.]\s*', '', 'gi') as body
  ),
  sentences as (
    select t.ord,
           trim(regexp_replace(t.s, '\s*—[^—]*(BR-PAY|tài liệu|tai lieu|đặc tả|dac ta|DMKL|KTT xác nhận|KTT kiểm tra)[^—]*$', '', 'i')) as s
    from cleaned, regexp_split_to_table(cleaned.body, '(?<=[.!?])\s+') with ordinality as t(s, ord)
  ),
  kept as (
    select string_agg(s, ' ' order by ord) as body
    from sentences
    where s <> '' and s !~* '(BR-PAY|\mFR ?0?6|tài liệu|tai lieu|đặc tả|dac ta|\mDMKL\M|KTT xác nhận|KTT kiểm tra)'
  )
  select case when coalesce(body, '') = '' then null else upper(left(body, 1)) || substr(body, 2) end from kept;
$$;

create or replace function public.m06_tmp_payroll_has_doc_refs(p_text text)
returns boolean
language sql
immutable
as $$
  select coalesce(p_text, '') ~* '(BR-PAY|\mFR ?0?6|\mF0?6\.\d|tài liệu|tai lieu|đặc tả|dac ta|\mDMKL\M|KTT xác nhận|KTT kiểm tra|hệ thống tự tính)';
$$;

-- Khoản chuẩn: lấy mô tả chuẩn; khoản khác: bỏ phần dẫn chiếu.
update public.payroll_components c
set note = s.note
from public.payroll_standard_catalog() s
where s.code = c.code and public.m06_tmp_payroll_has_doc_refs(c.note);

update public.payroll_components
set note = public.m06_tmp_payroll_strip_doc_refs(note)
where public.m06_tmp_payroll_has_doc_refs(note);

update public.payroll_templates
set description = public.m06_tmp_payroll_strip_doc_refs(description)
where public.m06_tmp_payroll_has_doc_refs(description);

update public.payroll_template_items
set note = public.m06_tmp_payroll_strip_doc_refs(note)
where public.m06_tmp_payroll_has_doc_refs(note);

update public.payroll_component_categories
set description = public.m06_tmp_payroll_strip_doc_refs(description)
where public.m06_tmp_payroll_has_doc_refs(description);

-- Tên và mô tả mẫu gieo sẵn (nếu còn nguyên).
update public.payroll_templates
set name = 'Khối Văn phòng / Kho / Vận chuyển',
    description = 'Lương theo ngày công, phép, lễ, KPI, làm thêm giờ và lương vận chuyển.'
where code = 'BL01' and name = 'BL 01 — Khối Văn phòng / Kho / Vận chuyển';
update public.payroll_templates
set name = 'Khối Kinh doanh',
    description = 'Lương theo ngày công cộng hoa hồng doanh thu bậc thang, cắt mã và thu cắt lô.'
where code = 'BL02' and name = 'BL 02 — Khối Kinh doanh';

-- ---------------------------------------------------------------------------
-- 4. Tham số: bảng tự tạo, có loại và đơn vị
-- ---------------------------------------------------------------------------
alter table public.payroll_param_versions
  add column if not exists param_tables jsonb not null default '[]'::jsonb,
  add column if not exists floor_component_code text,
  add column if not exists floor_param_code text;

alter table public.payroll_param_versions drop constraint if exists payroll_param_versions_tables_shape;
alter table public.payroll_param_versions
  add constraint payroll_param_versions_tables_shape check (jsonb_typeof(param_tables) = 'array');

-- Các cột cố định cũ chỉ còn để đọc lịch sử.
alter table public.payroll_param_versions
  alter column social_insurance_rate drop not null,
  alter column health_insurance_rate drop not null,
  alter column unemployment_insurance_rate drop not null,
  alter column employer_social_rate drop not null,
  alter column employer_health_rate drop not null,
  alter column employer_unemployment_rate drop not null,
  alter column employer_union_fund_rate drop not null,
  alter column insurance_salary_cap drop not null,
  alter column unemployment_salary_cap drop not null,
  alter column tax_personal_deduction drop not null,
  alter column tax_dependent_deduction drop not null,
  alter column base_salary_level drop not null,
  alter column regional_minimum_wage drop not null,
  alter column region_code drop not null,
  alter column flat_tax_rate drop not null,
  alter column unpaid_days_waive_insurance drop not null,
  alter column pit_brackets drop not null;

comment on column public.payroll_param_versions.param_tables is
  'Bảng tham số tự tạo: [{id, kind: LIST, name, note, params: [{code, name, type, unit, value, note}]} | {id, kind: TIER, name, note, code, mode: LOOKUP|PROGRESSIVE, input_label, unit, rows: [{from, value}]}].';

create or replace function public.validate_payroll_param_version()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_table jsonb;
  v_item jsonb;
  v_row jsonb;
  v_codes text[] := '{}';
  v_reserved text[] := public.payroll_reserved_formula_names();
  v_code text;
  v_type text;
  v_unit text;
  v_from numeric;
  v_prev numeric;
begin
  if jsonb_typeof(new.param_tables) is distinct from 'array' then
    raise exception 'Bộ tham số thiếu danh sách bảng.' using errcode = '22023';
  end if;

  for v_table in select value from jsonb_array_elements(new.param_tables)
  loop
    if coalesce(trim(v_table ->> 'name'), '') = '' then
      raise exception 'Có bảng tham số chưa có tên.' using errcode = '23514';
    end if;

    if v_table ->> 'kind' = 'TIER' then
      v_code := v_table ->> 'code';
      if v_code is null or v_code !~ '^[A-Z][A-Z0-9_]*$' then
        raise exception 'Mã bảng bậc thang "%" không hợp lệ.', coalesce(v_code, '') using errcode = '23514';
      end if;
      if v_code = any(v_reserved) or v_code = any(v_codes) then
        raise exception 'Mã "%" trùng tham số khác hoặc dữ liệu hệ thống.', v_code using errcode = '23505';
      end if;
      if coalesce(v_table ->> 'mode', '') not in ('LOOKUP', 'PROGRESSIVE') then
        raise exception 'Bảng "%" chưa chọn cách tính.', v_table ->> 'name' using errcode = '23514';
      end if;
      if jsonb_typeof(v_table -> 'rows') is distinct from 'array' or jsonb_array_length(v_table -> 'rows') = 0 then
        raise exception 'Bảng "%" phải có ít nhất một bậc.', v_table ->> 'name' using errcode = '23514';
      end if;
      v_prev := null;
      for v_row in select value from jsonb_array_elements(v_table -> 'rows')
      loop
        if jsonb_typeof(v_row -> 'from') is distinct from 'number' or jsonb_typeof(v_row -> 'value') is distinct from 'number' then
          raise exception 'Mọi bậc của bảng "%" phải có ngưỡng và giá trị là số.', v_table ->> 'name' using errcode = '23514';
        end if;
        v_from := (v_row ->> 'from')::numeric;
        if v_prev is not null and v_from <= v_prev then
          raise exception 'Ngưỡng các bậc của bảng "%" phải tăng dần.', v_table ->> 'name' using errcode = '23514';
        end if;
        v_prev := v_from;
      end loop;
      v_codes := array_append(v_codes, v_code);
      continue;
    end if;

    if jsonb_typeof(v_table -> 'params') is distinct from 'array' then
      raise exception 'Bảng "%" thiếu danh sách tham số.', v_table ->> 'name' using errcode = '22023';
    end if;
    for v_item in select value from jsonb_array_elements(v_table -> 'params')
    loop
      v_code := v_item ->> 'code';
      if v_code is null or v_code !~ '^[A-Z][A-Z0-9_]*$' then
        raise exception 'Mã tham số "%" không hợp lệ (viết hoa không dấu, bắt đầu bằng chữ).', coalesce(v_code, '')
          using errcode = '23514';
      end if;
      if v_code = any(v_reserved) then
        raise exception 'Mã "%" trùng tên dữ liệu hệ thống — đặt tên khác.', v_code using errcode = '23514';
      end if;
      if v_code = any(v_codes) then
        raise exception 'Mã tham số "%" bị dùng hai lần.', v_code using errcode = '23505';
      end if;
      if coalesce(trim(v_item ->> 'name'), '') = '' then
        raise exception 'Tham số "%" chưa có tên.', v_code using errcode = '23514';
      end if;
      if jsonb_typeof(v_item -> 'value') is distinct from 'number' then
        raise exception 'Giá trị tham số "%" phải là số.', v_item ->> 'name' using errcode = '23514';
      end if;
      v_type := coalesce(v_item ->> 'type', '');
      v_unit := coalesce(v_item ->> 'unit', '');
      if not (
        (v_type = 'TIME' and v_unit in ('NGAY', 'GIO', 'PHUT', 'THANG'))
        or (v_type = 'MONEY' and v_unit in ('VND', 'VND_NGAY', 'VND_GIO', 'VND_THANG', 'VND_LAN', 'VND_SP'))
        or (v_type = 'RATE' and v_unit in ('%', 'HE_SO'))
        or (v_type = 'COUNT' and v_unit in ('LAN', 'NGUOI', 'CHUYEN', 'SP'))
      ) then
        raise exception 'Tham số "%": đơn vị không thuộc loại đã chọn.', v_item ->> 'name' using errcode = '23514';
      end if;
      v_codes := array_append(v_codes, v_code);
    end loop;
  end loop;

  if (new.floor_component_code is null) <> (new.floor_param_code is null) then
    raise exception 'Kiểm tra mức sàn cần chọn đủ cả đầu mục và tham số.' using errcode = '23514';
  end if;
  if new.floor_param_code is not null and not (new.floor_param_code = any(v_codes)) then
    raise exception 'Tham số làm mức sàn không có trong bộ tham số này.' using errcode = '23514';
  end if;

  new.updated_at := now();
  if tg_op = 'UPDATE' then
    new.updated_by := auth.uid();
  end if;
  return new;
end;
$$;

drop trigger if exists payroll_param_versions_validate on public.payroll_param_versions;
create trigger payroll_param_versions_validate
before insert or update on public.payroll_param_versions
for each row execute function public.validate_payroll_param_version();

-- Chuyển bộ tham số cũ sang bảng. Bộ của kỳ đã chốt cũng phải chuyển (chỉ đổi
-- cách lưu, không đổi số) nên tạm tắt trigger khoá kỳ và trigger nhật ký.
alter table public.payroll_param_versions disable trigger payroll_param_versions_period_guard;
alter table public.payroll_param_versions disable trigger payroll_param_versions_audit;

do $$
declare
  v record;
  v_tables jsonb;
  v_params jsonb;
  v_rows jsonb;
  v_group text;
  v_taken text[];
  -- Tên có dấu cho các tham số gieo sẵn bằng chữ không dấu.
  v_names constant jsonb := jsonb_build_object(
    'HE_SO_OT_THUONG', 'Hệ số OT ngày thường', 'HE_SO_OT_NGHI', 'Hệ số OT ngày nghỉ hằng tuần',
    'HE_SO_OT_LE', 'Hệ số OT ngày lễ, tết', 'HE_SO_CA_DEM', 'Hệ số cộng thêm làm ban đêm',
    'TY_LE_QUY_1PT', 'Tỷ lệ trích quỹ nội bộ', 'DON_GIA_CHAI', 'Đơn giá vận chuyển mỗi chai',
    'DON_GIA_BICH', 'Đơn giá vận chuyển mỗi bịch', 'HE_SO_DOANH_SO', 'Hệ số tính lương doanh số',
    'DINH_MUC_KPI', 'Định mức KPI', 'MUC_AN_TRUA', 'Mức tiền ăn trưa chuẩn'
  );
begin
  if not (select first_run from _m06_formula_ctx) then
    return;
  end if;

  for v in select * from public.payroll_param_versions where jsonb_array_length(param_tables) = 0
  loop
    v_tables := jsonb_build_array(
      jsonb_build_object(
        'id', 't' || substr(md5(v.id::text || ':nen'), 1, 12), 'kind', 'LIST', 'name', 'Lương nền', 'note', null,
        'params', jsonb_build_array(
          jsonb_build_object('code', 'LUONG_CO_SO', 'name', 'Lương cơ sở', 'type', 'MONEY', 'unit', 'VND',
            'value', coalesce(v.base_salary_level, 0), 'note', null),
          jsonb_build_object('code', 'LUONG_TOI_THIEU_VUNG', 'name', 'Lương tối thiểu vùng', 'type', 'MONEY', 'unit', 'VND',
            'value', coalesce(v.regional_minimum_wage, 0), 'note', 'Vùng ' || coalesce(v.region_code, 'I'))
        )
      ),
      jsonb_build_object(
        'id', 't' || substr(md5(v.id::text || ':bh'), 1, 12), 'kind', 'LIST', 'name', 'Bảo hiểm', 'note', null,
        'params', jsonb_build_array(
          jsonb_build_object('code', 'TY_LE_BHXH_NLD', 'name', 'Tỷ lệ BHXH người lao động', 'type', 'RATE', 'unit', '%', 'value', coalesce(v.social_insurance_rate, 0), 'note', null),
          jsonb_build_object('code', 'TY_LE_BHYT_NLD', 'name', 'Tỷ lệ BHYT người lao động', 'type', 'RATE', 'unit', '%', 'value', coalesce(v.health_insurance_rate, 0), 'note', null),
          jsonb_build_object('code', 'TY_LE_BHTN_NLD', 'name', 'Tỷ lệ BHTN người lao động', 'type', 'RATE', 'unit', '%', 'value', coalesce(v.unemployment_insurance_rate, 0), 'note', null),
          jsonb_build_object('code', 'TY_LE_BHXH_DN', 'name', 'Tỷ lệ BHXH doanh nghiệp', 'type', 'RATE', 'unit', '%', 'value', coalesce(v.employer_social_rate, 0), 'note', null),
          jsonb_build_object('code', 'TY_LE_BHYT_DN', 'name', 'Tỷ lệ BHYT doanh nghiệp', 'type', 'RATE', 'unit', '%', 'value', coalesce(v.employer_health_rate, 0), 'note', null),
          jsonb_build_object('code', 'TY_LE_BHTN_DN', 'name', 'Tỷ lệ BHTN doanh nghiệp', 'type', 'RATE', 'unit', '%', 'value', coalesce(v.employer_unemployment_rate, 0), 'note', null),
          jsonb_build_object('code', 'TY_LE_KPCD', 'name', 'Tỷ lệ kinh phí công đoàn', 'type', 'RATE', 'unit', '%', 'value', coalesce(v.employer_union_fund_rate, 0), 'note', null),
          jsonb_build_object('code', 'TRAN_BHXH_BHYT', 'name', 'Trần lương đóng BHXH, BHYT', 'type', 'MONEY', 'unit', 'VND', 'value', coalesce(v.insurance_salary_cap, 0), 'note', null),
          jsonb_build_object('code', 'TRAN_BHTN', 'name', 'Trần lương đóng BHTN', 'type', 'MONEY', 'unit', 'VND', 'value', coalesce(v.unemployment_salary_cap, 0), 'note', null),
          jsonb_build_object('code', 'SO_NGAY_MIEN_DONG_BH', 'name', 'Nghỉ không lương từ (ngày) thì không đóng', 'type', 'TIME', 'unit', 'NGAY', 'value', coalesce(v.unpaid_days_waive_insurance, 14), 'note', null)
        )
      ),
      jsonb_build_object(
        'id', 't' || substr(md5(v.id::text || ':thue'), 1, 12), 'kind', 'LIST', 'name', 'Thuế TNCN', 'note', null,
        'params', jsonb_build_array(
          jsonb_build_object('code', 'GIAM_TRU_BAN_THAN', 'name', 'Giảm trừ bản thân', 'type', 'MONEY', 'unit', 'VND_THANG', 'value', coalesce(v.tax_personal_deduction, 0), 'note', null),
          jsonb_build_object('code', 'GIAM_TRU_NPT', 'name', 'Giảm trừ mỗi người phụ thuộc', 'type', 'MONEY', 'unit', 'VND_THANG', 'value', coalesce(v.tax_dependent_deduction, 0), 'note', null),
          jsonb_build_object('code', 'TY_LE_KHAU_TRU_THANG', 'name', 'Tỷ lệ khấu trừ thẳng', 'type', 'RATE', 'unit', '%', 'value', coalesce(v.flat_tax_rate, 10), 'note', null)
        )
      )
    );
    v_taken := array[
      'LUONG_CO_SO', 'LUONG_TOI_THIEU_VUNG', 'TY_LE_BHXH_NLD', 'TY_LE_BHYT_NLD', 'TY_LE_BHTN_NLD', 'TY_LE_BHXH_DN',
      'TY_LE_BHYT_DN', 'TY_LE_BHTN_DN', 'TY_LE_KPCD', 'TRAN_BHXH_BHYT', 'TRAN_BHTN', 'SO_NGAY_MIEN_DONG_BH',
      'GIAM_TRU_BAN_THAN', 'GIAM_TRU_NPT', 'TY_LE_KHAU_TRU_THANG'
    ];

    -- Biểu thuế lũy tiến: mỗi bậc bắt đầu từ cận trên của bậc trước.
    select coalesce(jsonb_agg(r.row order by r.ord), '[]'::jsonb)
    into v_rows
    from (
      select e.ord,
             jsonb_build_object(
               'from', coalesce(lag((e.b ->> 'upper_bound')::numeric) over (order by e.ord), 0),
               'value', coalesce((e.b ->> 'rate')::numeric, 0)
             ) as row
      from jsonb_array_elements(coalesce(v.pit_brackets, '[]'::jsonb)) with ordinality as e(b, ord)
    ) r;
    if jsonb_array_length(v_rows) > 0 then
      v_tables := v_tables || jsonb_build_array(jsonb_build_object(
        'id', 't' || substr(md5(v.id::text || ':pit'), 1, 12), 'kind', 'TIER', 'name', 'Biểu thuế lũy tiến', 'note', null,
        'code', 'THUE_LUY_TIEN', 'mode', 'PROGRESSIVE', 'input_label', 'Thu nhập tính thuế', 'unit', '%', 'rows', v_rows
      ));
      v_taken := array_append(v_taken, 'THUE_LUY_TIEN');
    end if;

    -- Tham số tự đặt cũ: mỗi nhóm cũ thành một bảng (sửa / đổi tên / xoá tự do).
    foreach v_group in array array['OT', 'PENALTY', 'FUND', 'COMMISSION', 'OTHER']
    loop
      select jsonb_agg(jsonb_build_object(
               'code', p ->> 'code',
               'name', coalesce(
                 case when (p ->> 'name') = initcap(replace(lower(p ->> 'code'), '_', ' ')) or (p ->> 'name') !~ '[^\x01-\x7F]'
                   then v_names ->> (p ->> 'code') end,
                 nullif(trim(p ->> 'name'), ''), p ->> 'code'),
               'type', case p ->> 'unit' when '%' then 'RATE' when 'HE_SO' then 'RATE' when 'NGAY' then 'TIME'
                         when 'GIO' then 'TIME' when 'LAN' then 'COUNT' else 'MONEY' end,
               'unit', case when p ->> 'unit' in ('%', 'HE_SO', 'NGAY', 'GIO', 'LAN', 'VND') then p ->> 'unit' else 'VND' end,
               'value', coalesce((p ->> 'value')::numeric, 0),
               'note', public.m06_tmp_payroll_strip_doc_refs(nullif(trim(p ->> 'note'), ''))
             ) order by ord)
      into v_params
      from jsonb_array_elements(coalesce(v.named_params, '[]'::jsonb)) with ordinality as e(p, ord)
      where coalesce(p ->> 'group', 'OTHER') = v_group
        and coalesce(p ->> 'code', '') ~ '^[A-Z][A-Z0-9_]*$'
        and not (p ->> 'code' = any(public.payroll_reserved_formula_names()))
        and not (p ->> 'code' = any(v_taken));
      if v_params is not null then
        v_tables := v_tables || jsonb_build_array(jsonb_build_object(
          'id', 't' || substr(md5(v.id::text || ':' || v_group), 1, 12), 'kind', 'LIST',
          'name', case v_group when 'OT' then 'Làm thêm giờ' when 'PENALTY' then 'Phạt & khấu trừ' when 'FUND' then 'Trích quỹ'
                    when 'COMMISSION' then 'Doanh thu & hoa hồng' else 'Tham số khác' end,
          'note', null, 'params', v_params
        ));
        select v_taken || coalesce(array_agg(x ->> 'code'), '{}') into v_taken from jsonb_array_elements(v_params) x;
      end if;
    end loop;

    -- Biểu bậc thang cũ: bảng tra bậc.
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', 't' || substr(md5(v.id::text || ':tier:' || (t ->> 'code')), 1, 12),
             'kind', 'TIER',
             'name', coalesce(nullif(trim(regexp_replace(t ->> 'name', '\s*\(BL ?0\d\)', '', 'g')), ''), t ->> 'code'),
             'note', public.m06_tmp_payroll_strip_doc_refs(nullif(trim(t ->> 'note'), '')),
             'code', t ->> 'code',
             'mode', 'LOOKUP',
             'input_label', t ->> 'input_label',
             'unit', case when t ->> 'unit' in ('%', 'HE_SO', 'VND') then t ->> 'unit' else '%' end,
             'rows', coalesce(t -> 'rows', '[]'::jsonb)
           ) order by ord), '[]'::jsonb)
    into v_params
    from jsonb_array_elements(coalesce(v.tier_tables, '[]'::jsonb)) with ordinality as e(t, ord)
    where coalesce(t ->> 'code', '') ~ '^[A-Z][A-Z0-9_]*$'
      and not (t ->> 'code' = any(v_taken))
      and not (t ->> 'code' = any(public.payroll_reserved_formula_names()));
    v_tables := v_tables || v_params;

    update public.payroll_param_versions set param_tables = v_tables where id = v.id;
  end loop;
end $$;

alter table public.payroll_param_versions enable trigger payroll_param_versions_period_guard;
alter table public.payroll_param_versions enable trigger payroll_param_versions_audit;

-- ---------------------------------------------------------------------------
-- 5. Dòng của cơ chế lương: cách lấy giá trị + thứ tự trên phiếu
-- ---------------------------------------------------------------------------
alter table public.payroll_template_items
  add column if not exists mode text not null default 'FORMULA',
  add column if not exists sort_order integer not null default 0;

alter table public.payroll_template_items drop constraint if exists payroll_template_items_mode_check;
alter table public.payroll_template_items
  add constraint payroll_template_items_mode_check check (mode in ('FORMULA', 'VALUE', 'PER_PERSON', 'MONTHLY_INPUT'));

comment on column public.payroll_template_items.mode is
  'FORMULA = công thức; VALUE = giá trị chung (khai riêng được); PER_PERSON = khai cho từng người; MONTHLY_INPUT = nhập hằng tháng.';

comment on table public.payroll_templates is
  'Cơ chế lương: danh sách đầu mục, mỗi dòng một cách lấy giá trị. Gán cho đơn vị (thừa hưởng theo cây) hoặc riêng từng người.';

-- Công thức "Thu nhập chịu thuế" cho một cơ chế (và cho một người, khi cờ chịu
-- thuế của người đó khác cơ chế): tổng thu nhập trừ phần engine cũ để ngoài
-- diện thuế — khoản đánh dấu không chịu thuế (tới mức miễn, nếu có) và phần
-- làm thêm giờ trả cao hơn giờ thường. Chỉ xét các khoản mà người thuộc cơ chế
-- đó có thể có (dòng của cơ chế, khoản chung của đơn vị họ, khoản khai riêng).
-- Cờ theo đúng thứ tự engine cũ: khai riêng thay trọn dòng của đơn vị, đơn vị
-- thay trọn dòng của mẫu; cờ trống = cờ của danh mục.
create or replace function public.m06_tmp_payroll_taxable_formula(p_template uuid, p_user uuid)
returns text
language sql
stable
as $$
  with people as (
    select pt.user_id, pt.unit_id from _m06_person_tpl pt where pt.template_id = p_template
  ),
  reach as (
    select i.component_id from public.payroll_template_items i where i.template_id = p_template
    union
    select u.component_id
    from people pe
    join _m06_unit_tree tr on tr.unit_id = pe.unit_id
    join public.unit_pay_items u on u.unit_id = tr.root_id
    union
    select e.component_id from people pe join public.employee_pay_items e on e.user_id = pe.user_id
  ),
  flagged as (
    select c.code, c.sort_order, c.tax_exempt_cap, c.ot_multiplier,
           case
             when p_user is not null and exists (
               select 1 from public.employee_pay_items e
               where e.user_id = p_user and e.component_id = c.id
                 and (e.effective_to is null or e.effective_to >= date_trunc('month', current_date)::date)
             ) then coalesce((
               select e.taxable from public.employee_pay_items e
               where e.user_id = p_user and e.component_id = c.id
                 and (e.effective_to is null or e.effective_to >= date_trunc('month', current_date)::date)
               order by e.effective_from desc limit 1), c.taxable)
             when p_user is not null and exists (
               select 1 from public.profiles pr
               join _m06_unit_tree tr on tr.unit_id = pr.unit_id
               join public.unit_pay_items u on u.unit_id = tr.root_id and u.component_id = c.id
               where pr.id = p_user
                 and (u.effective_to is null or u.effective_to >= date_trunc('month', current_date)::date)
             ) then c.taxable
             else coalesce((
               select i.taxable from public.payroll_template_items i
               where i.template_id = p_template and i.component_id = c.id
               order by (i.effective_to is null) desc, i.effective_from desc limit 1), c.taxable)
           end as taxable
    from public.payroll_components c
    where c.kind = 'EARNING' and c.id in (select component_id from reach)
  ),
  terms as (
    select sort_order, code,
           case
             when not taxable and tax_exempt_cap is not null then format('MIN(%s, %s)', code, trim_scale(tax_exempt_cap))
             when not taxable then code
             when coalesce(ot_multiplier, 0) > 1
               then format('ROUND(%s * (%s - 1) / %s)', code, trim_scale(ot_multiplier), trim_scale(ot_multiplier))
           end as term
    from flagged
  )
  select 'TONG_THU_NHAP' || coalesce(
           case when count(*) = 1 then ' - ' || min(term)
                else ' - (' || string_agg(term, ' + ' order by sort_order, code) || ')' end,
           '')
  from terms
  where term is not null;
$$;

create or replace function public.m06_tmp_payroll_is_param(p_code text)
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from public.payroll_param_versions v, jsonb_array_elements(v.param_tables) t
    where t ->> 'code' = p_code
       or exists (select 1 from jsonb_array_elements(coalesce(t -> 'params', '[]'::jsonb)) p where p ->> 'code' = p_code)
  );
$$;

-- Tháng đầu tiên một cơ chế có hiệu lực: dòng sớm nhất, lần gán sớm nhất.
create or replace function public.m06_tmp_payroll_template_start(p_template uuid)
returns date
language sql
stable
as $$
  select coalesce(
    least(
      (select min(i.effective_from) from public.payroll_template_items i where i.template_id = p_template),
      (select min(a.effective_from) from public.unit_payroll_templates a where a.template_id = p_template),
      (select min(date_trunc('month', p.effective_from)::date) from public.employee_pay_profiles p where p.template_id = p_template)
    ),
    date '2000-01-01'
  );
$$;

-- Bảo hiểm người lao động đóng, đúng như engine cũ: không đóng tháng nghỉ
-- không lương từ ngưỡng trở lên; BHXH + BHYT tính trên mức đóng chặn trần
-- lương cơ sở, BHTN chặn trần riêng.
create or replace function public.m06_tmp_payroll_insurance_formula(p_unpaid text)
returns text
language sql
immutable
as $$
  select format(
    'IF(%s >= SO_NGAY_MIEN_DONG_BH, 0, MIN(INSURANCE_BASE, TRAN_BHXH_BHYT) * (TY_LE_BHXH_NLD + TY_LE_BHYT_NLD) + MIN(INSURANCE_BASE, TRAN_BHTN) * TY_LE_BHTN_NLD)',
    p_unpaid);
$$;

-- Phần doanh nghiệp đóng thêm, cùng điều kiện miễn đóng và cùng mức trần với
-- phần người lao động; kinh phí công đoàn tính trên mức đóng BHXH / BHYT.
create or replace function public.m06_tmp_payroll_employer_insurance_formula(p_unpaid text)
returns text
language sql
immutable
as $$
  select format(
    'IF(%s >= SO_NGAY_MIEN_DONG_BH, 0, MIN(INSURANCE_BASE, TRAN_BHXH_BHYT) * (TY_LE_BHXH_DN + TY_LE_BHYT_DN + TY_LE_KPCD) + MIN(INSURANCE_BASE, TRAN_BHTN) * TY_LE_BHTN_DN)',
    p_unpaid);
$$;

-- 5a. Đầu mục mà phần tính ngầm cũ cần (lương thời gian, đơn giá, bảo hiểm,
--     thuế…) phải có trong danh mục TRƯỚC mọi bước sau: biến cũ cùng tên
--     trong công thức (DAILY_RATE, INSURANCE_BASE…) trỏ thẳng vào chúng.
do $$
begin
  if not (select first_run from _m06_formula_ctx) then
    return;
  end if;
  if not exists (select 1 from public.employee_pay_profiles)
     and not exists (select 1 from public.employee_pay_items)
     and not exists (select 1 from public.unit_pay_items)
     and not exists (select 1 from public.payroll_template_items) then
    return;
  end if;
  if not exists (select 1 from public.payroll_components where is_base) then
    perform public.payroll_ensure_components(array['LUONG_CO_BAN']);
  end if;
  perform public.payroll_ensure_components(array[
    'BASE_WORK', 'BASE_LEAVE', 'BASE_HOLIDAY', 'INS_EMPLOYEE', 'INS_EMPLOYER', 'PIT', 'DAILY_RATE', 'HOURLY_RATE',
    'INSURANCE_BASE', 'DEPENDENTS', 'THU_NHAP_CHIU_THUE', 'THU_NHAP_TINH_THUE'
  ]);
end $$;

-- 5a-2. Nhãn báo cáo cho các đầu mục chuẩn đã có sẵn từ trước (khoản tạo mới
--       đã mang nhãn khi được tạo). Chỉ gắn khi còn trống và đúng loại dòng.
do $$
begin
  if not (select first_run from _m06_formula_ctx) then
    return;
  end if;
  update public.payroll_components c
  set report_tag = m.tag
  from (values
    ('INS_EMPLOYEE', 'INSURANCE_EMPLOYEE', array['DEDUCTION']),
    ('PIT', 'INCOME_TAX', array['DEDUCTION']),
    ('INS_EMPLOYER', 'INSURANCE_EMPLOYER', array['INFO', 'EMPLOYER_COST']),
    ('THU_NHAP_TINH_THUE', 'TAXABLE_INCOME', array['INFO'])
  ) as m(code, tag, kinds)
  where c.code = m.code and c.report_tag is null and c.kind = any(m.kinds);
end $$;

-- 5b. Công thức: tên biến cũ của engine → đầu mục / dữ liệu mới, cách tính
--     của danh mục → công thức của dòng, tỷ lệ % → phần trăm thật.
do $$
declare
  v_base_code text;
  v_pct_codes text[];
  v_tier_pct text[];
  v_code text;
  v_table text;
begin
  if not (select first_run from _m06_formula_ctx) then
    return;
  end if;

  select code into v_base_code from public.payroll_components where is_base limit 1;
  v_base_code := coalesce(v_base_code, 'LUONG_CO_BAN');

  -- Khoản danh mục tính % trên biến cũ.
  update public.payroll_components
  set base_code = case upper(coalesce(base_code, ''))
        when 'BASE' then '(BASE_WORK + BASE_LEAVE + BASE_HOLIDAY)'
        when 'GROSS' then 'TONG_THU_NHAP'
        when 'MONTHLY_RATE' then v_base_code
        when 'INSURANCE_EMPLOYEE' then 'INS_EMPLOYEE'
        when 'TAXABLE_INCOME' then 'THU_NHAP_TINH_THUE'
        else base_code end
  where calc_type = 'PERCENT';

  foreach v_table in array array['payroll_template_items', 'employee_pay_items', 'unit_pay_items', 'payroll_components']
  loop
    execute format($f$
      update public.%I set formula = regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(formula,
          '\mMONTHLY_RATE\M', %L, 'gi'), '\mINSURANCE_EMPLOYEE\M', 'INS_EMPLOYEE', 'gi'),
          '\mTAXABLE_INCOME\M', 'THU_NHAP_TINH_THUE', 'gi'), '\mGROSS\M', 'TONG_THU_NHAP', 'gi'),
          '\mBASE\M', '(BASE_WORK + BASE_LEAVE + BASE_HOLIDAY)', 'gi')
      where formula ~* '\m(MONTHLY_RATE|INSURANCE_EMPLOYEE|TAXABLE_INCOME|GROSS|BASE)\M'
    $f$, v_table, v_base_code);
  end loop;

  -- Lương gốc khai riêng bằng một khoản khác (cờ "lương gốc" của từng người)
  -- → về đúng đầu mục lương cơ bản, trước mọi bước đọc công thức của khoản.
  update public.employee_pay_items e
  set component_id = b.id, is_base = null
  from public.payroll_components b
  where b.code = v_base_code and e.is_base and e.component_id <> b.id
    and not exists (
      select 1 from public.employee_pay_items x
      where x.user_id = e.user_id and x.component_id = b.id
        and x.effective_from <= coalesce(e.effective_to, 'infinity'::date)
        and coalesce(x.effective_to, 'infinity'::date) >= e.effective_from
    );

  -- Lương cơ bản là MỨC: công thức gắn vào nó trước đây engine vốn bỏ qua.
  update public.payroll_template_items i set formula = null
  from public.payroll_components c
  where c.id = i.component_id and (c.code = v_base_code or c.is_base) and i.formula is not null;
  update public.employee_pay_items i set formula = null
  from public.payroll_components c
  where c.id = i.component_id and (c.code = v_base_code or c.is_base or i.is_base) and i.formula is not null;
  update public.unit_pay_items i set formula = null
  from public.payroll_components c
  where c.id = i.component_id and (c.code = v_base_code or c.is_base) and i.formula is not null;

  -- Khai riêng cho người / đơn vị THAY TRỌN dòng của lớp dưới (engine cũ
  -- không gộp mức của lớp này với công thức của lớp kia). Ghi rõ mức để cách
  -- gộp mới ra cùng kết quả: bỏ trống mức = mức mặc định của danh mục.
  update public.employee_pay_items e set amount = c.default_amount
  from public.payroll_components c
  where c.id = e.component_id and e.amount is null;
  update public.unit_pay_items u set amount = c.default_amount
  from public.payroll_components c
  where c.id = u.component_id and u.amount is null;

  -- Cách tính của danh mục → công thức của dòng. `MUC_RIENG` là giá trị khai
  -- của chính dòng đó, đúng như engine cũ đọc.
  create temp table _legacy_formula on commit drop as
  select c.id, c.max_amount,
         case
           when nullif(trim(c.formula), '') is not null and c.calc_type = 'FORMULA' then trim(c.formula)
           when c.calc_type = 'PER_DAY' then 'MUC_RIENG * PAID_DAYS'
           when c.calc_type in ('PER_HOUR', 'PER_UNIT') and c.input_code is not null then 'MUC_RIENG * ' || upper(c.input_code)
           when c.calc_type = 'PERCENT' and c.base_code is not null then 'MUC_RIENG / 100 * ' || c.base_code
           when c.calc_type = 'FIXED' and c.prorate then 'MUC_RIENG / STANDARD_DAYS * PAID_DAYS'
         end as formula
  from public.payroll_components c
  where not (c.code = v_base_code or c.is_base);

  update public.payroll_template_items i set formula = l.formula
  from _legacy_formula l where l.id = i.component_id and i.formula is null and l.formula is not null;
  update public.employee_pay_items i set formula = l.formula
  from _legacy_formula l where l.id = i.component_id and i.formula is null and l.formula is not null;
  update public.unit_pay_items i set formula = l.formula
  from _legacy_formula l where l.id = i.component_id and i.formula is null and l.formula is not null;

  -- Trần của khoản (engine cũ cắt sau cùng, kể cả công thức riêng).
  foreach v_table in array array['payroll_template_items', 'employee_pay_items', 'unit_pay_items']
  loop
    execute format($f$
      update public.%I i
      set formula = format('MIN(%%s, %%s)', coalesce(nullif(trim(i.formula), ''), 'MUC_RIENG'), trim_scale(l.max_amount))
      from _legacy_formula l
      where l.id = i.component_id and l.max_amount is not null
    $f$, v_table);
  end loop;

  -- Tỷ lệ % nay là phần trăm thật: bỏ "/ 100" ngay sau tham số %, sau bảng
  -- tra bậc đơn vị %, và đổi KPI_PCT / 100 thành tỷ lệ KPI.
  foreach v_table in array array['payroll_template_items', 'employee_pay_items', 'unit_pay_items']
  loop
    execute format($f$
      update public.%I set formula = replace(formula,
        'DOANH_SO / DOANH_SO_KHOAN * 100 > NGUONG_THUONG_VUOT', 'DOANH_SO / DOANH_SO_KHOAN > NGUONG_THUONG_VUOT')
      where formula like '%%DOANH_SO / DOANH_SO_KHOAN * 100 > NGUONG_THUONG_VUOT%%'
    $f$, v_table);
    execute format($f$
      update public.%I set formula = regexp_replace(formula, '\mKPI_PCT\M\s*/\s*100(?![0-9.])', 'TY_LE_KPI', 'g')
      where formula ~ '\mKPI_PCT\M\s*/\s*100'
    $f$, v_table);
  end loop;

  select coalesce(array_agg(distinct p ->> 'code'), '{}')
  into v_pct_codes
  from public.payroll_param_versions v, jsonb_array_elements(v.param_tables) t,
       jsonb_array_elements(coalesce(t -> 'params', '[]'::jsonb)) p
  where p ->> 'unit' = '%';
  select coalesce(array_agg(distinct t ->> 'code'), '{}')
  into v_tier_pct
  from public.payroll_param_versions v, jsonb_array_elements(v.param_tables) t
  where t ->> 'kind' = 'TIER' and t ->> 'mode' = 'LOOKUP' and t ->> 'unit' = '%';

  foreach v_table in array array['payroll_template_items', 'employee_pay_items', 'unit_pay_items']
  loop
    foreach v_code in array v_pct_codes
    loop
      execute format($f$
        update public.%I set formula = regexp_replace(formula, '\m(%s)\M\s*/\s*100(?![0-9.])', '\1', 'g')
        where formula ~ '\m%s\M\s*/\s*100'
      $f$, v_table, v_code, v_code);
    end loop;
    foreach v_code in array v_tier_pct
    loop
      execute format($f$
        update public.%I set formula = regexp_replace(formula, '\m(%s)\(((?:[^()]|\([^()]*\))*)\)\s*/\s*100(?![0-9.])', '\1(\2)', 'g')
        where formula ~ '\m%s\('
      $f$, v_table, v_code, v_code);
    end loop;
  end loop;

  -- Cách lấy giá trị và thứ tự của các dòng sẵn có.
  update public.payroll_template_items i
  set mode = case
        when c.code = v_base_code or c.is_base then 'PER_PERSON'
        when nullif(trim(i.formula), '') is not null then 'FORMULA'
        else 'VALUE'
      end,
      sort_order = c.sort_order
  from public.payroll_components c
  where c.id = i.component_id;
end $$;

-- 5c. Người chưa thuộc cơ chế nào: trước đây engine vẫn tự tính lương thời
--     gian, bảo hiểm, thuế cho họ. Giờ đó là "Cơ chế chung", gán ở gốc cây tổ
--     chức (đơn vị nào đã có cơ chế riêng thì vẫn theo cơ chế riêng).
do $$
declare
  v_default uuid;
begin
  if not (select first_run from _m06_formula_ctx) then
    return;
  end if;
  if not exists (select 1 from public.employee_pay_profiles)
     and not exists (select 1 from public.employee_pay_items)
     and not exists (select 1 from public.unit_pay_items) then
    return;
  end if;

  insert into public.payroll_templates (code, name, description, created_by)
  values ('CO_CHE_CHUNG', 'Cơ chế chung',
          'Lương theo ngày công, phép, lễ; bảo hiểm và thuế thu nhập cá nhân theo bộ tham số. Áp cho đơn vị chưa gán cơ chế riêng.',
          null)
  on conflict (code) do nothing;
  select id into v_default from public.payroll_templates where code = 'CO_CHE_CHUNG';

  insert into public.unit_payroll_templates (unit_id, template_id, effective_from, note)
  select u.id, v_default, date '2000-01-01', 'Cơ chế chung khi chuyển sang lương theo công thức'
  from public.organization_units u
  where u.parent_id is null
  on conflict (unit_id, effective_from) do nothing;

  -- "Không áp mẫu", hay mẫu đã ngừng dùng mà vẫn đang gán: trước đây người
  -- trong đó vẫn có phần lương engine tự tính — đúng bằng cơ chế chung.
  update public.unit_payroll_templates a
  set template_id = v_default
  where a.template_id is null
     or exists (select 1 from public.payroll_templates t where t.id = a.template_id and not t.is_active);
  update public.employee_pay_profiles p
  set template_id = v_default
  where exists (select 1 from public.payroll_templates t where t.id = p.template_id and not t.is_active);

  -- Người không thuộc đơn vị nào.
  update public.employee_pay_profiles p
  set template_id = v_default
  from public.profiles u
  where u.id = p.user_id and u.unit_id is null and p.template_id is null;

  insert into public.employee_pay_profiles (user_id, effective_from, template_id, note)
  select e.user_id, date_trunc('month', min(e.effective_from))::date, v_default,
         'Cơ chế chung khi chuyển sang lương theo công thức'
  from public.employee_pay_items e
  join public.profiles u on u.id = e.user_id
  where u.unit_id is null
    and not exists (select 1 from public.employee_pay_profiles p where p.user_id = e.user_id)
  group by e.user_id;
end $$;

insert into _m06_person_tpl (user_id, unit_id, template_id)
select p.id, p.unit_id, public.payroll_template_for(p.id, date_trunc('month', current_date)::date)
from public.profiles p;

-- 5d. Số liệu nhập tay trong công thức → đầu mục "chỉ để tính" và dòng "Hằng
--     tháng" trong cơ chế của người dùng tới nó.
do $$
declare
  v_last date := public.payroll_last_closed_month();
  v_month date := date_trunc('month', current_date)::date;
  v_sort integer;
  v_ident text;
  v_new text[] := '{}';
  r record;
  v_known_names constant jsonb := jsonb_build_object(
    'TIEN_TAM_UNG', 'Tiền tạm ứng', 'TIEN_THUONG_DI_SOM', 'Tiền thưởng đi sớm', 'TIEN_THUONG_CTKM', 'Tiền thưởng CTKM',
    'OT_NGAY_THUONG', 'Số ngày làm thêm ngày thường', 'OT_NGAY_LE', 'Số ngày làm thêm ngày lễ',
    'OT_NGAY_SAU_22H', 'Số ngày làm thêm sau 22h', 'SO_TINH_CONG_TAC', 'Số tỉnh đi công tác',
    'NIGHT_HOURS', 'Giờ làm đêm', 'REVENUE', 'Doanh thu', 'UNITS', 'Sản lượng nghiệm thu',
    'KPI_TARGET', 'Chỉ tiêu KPI', 'THUONG', 'Tiền thưởng', 'PHAT', 'Tiền phạt'
  );
  v_input_helpers constant text[] := array[
    'DOANH_SO', 'DOANH_SO_KHOAN', 'DOANH_SO_CAT_MA', 'DOANH_SO_THU_CAT_LO', 'SO_CHUYEN', 'SO_LAN_THIEU_BAO_CAO'
  ];
begin
  if not (select first_run from _m06_formula_ctx) then
    return;
  end if;

  perform public.payroll_ensure_components(v_input_helpers);

  -- Mỗi dòng có công thức, kèm cơ chế mà nó rơi vào (của người / đơn vị dùng nó).
  create temp table _formula_rows on commit drop as
  select 'T'::text as source, i.id as row_id, i.component_id, upper(trim(i.formula)) as formula, i.template_id as target
  from public.payroll_template_items i
  where nullif(trim(i.formula), '') is not null
  union all
  select 'E', e.id, e.component_id, upper(trim(e.formula)), public.payroll_template_for(e.user_id, v_month)
  from public.employee_pay_items e
  where nullif(trim(e.formula), '') is not null
  union all
  select distinct 'U', u.id, u.component_id, upper(trim(u.formula)), public.payroll_template_for(p.id, v_month)
  from public.unit_pay_items u
  join _m06_unit_tree t on t.root_id = u.unit_id
  join public.profiles p on p.unit_id = t.unit_id
  where nullif(trim(u.formula), '') is not null;

  create temp table _input_pairs (target uuid, component_id uuid) on commit drop;

  -- Cả công thức chỉ là một số liệu nhập tay (kiểu "TIEN_TAM_UNG"): dòng đó
  -- thành dòng "Hằng tháng" của chính đầu mục, số đã nhập ở kỳ chưa chốt đổi
  -- sang mã của đầu mục.
  for r in
    select f.*, c.code as own_code
    from _formula_rows f
    join public.payroll_components c on c.id = f.component_id
    where f.formula ~ '^[A-Z_][A-Z0-9_]*$'
      and f.formula <> c.code
      and not exists (select 1 from public.payroll_components x where x.code = f.formula)
      and not (f.formula = any(public.payroll_reserved_formula_names()))
      and not public.m06_tmp_payroll_is_param(f.formula)
  loop
    if r.source = 'T' then
      update public.payroll_template_items set mode = 'MONTHLY_INPUT', formula = null where id = r.row_id;
    elsif r.source = 'E' then
      update public.employee_pay_items set formula = null, amount = null where id = r.row_id;
      insert into _input_pairs values (r.target, r.component_id);
    else
      update public.unit_pay_items set formula = null, amount = null where id = r.row_id;
      insert into _input_pairs values (r.target, r.component_id);
    end if;
    update public.payroll_inputs p set code = r.own_code
    where p.code = r.formula
      and (v_last is null or p.month_start > v_last)
      and not exists (
        select 1 from public.payroll_inputs q
        where q.user_id = p.user_id and q.month_start = p.month_start and q.code = r.own_code
      );
    delete from _formula_rows where row_id = r.row_id and source = r.source;
  end loop;

  -- Biến lạ còn lại (doanh số, số chuyến…) → đầu mục "chỉ để tính".
  select coalesce(max(sort_order), 400) into v_sort from public.payroll_components;
  for v_ident in
    select distinct m[1]
    from _formula_rows f, regexp_matches(f.formula, '([A-Z_][A-Z0-9_]*)(\s*\()?', 'g') as m
    where m[2] is null
  loop
    if v_ident = any(public.payroll_reserved_formula_names())
       or exists (select 1 from public.payroll_components c where c.code = v_ident)
       or public.m06_tmp_payroll_is_param(v_ident) then
      continue;
    end if;
    v_sort := v_sort + 10;
    insert into public.payroll_components (
      code, name, kind, calc_type, default_amount, category_code, nature, calc_source, is_active, is_system, sort_order, note
    )
    select v_ident, coalesce(v_known_names ->> v_ident, initcap(replace(lower(v_ident), '_', ' '))), 'INFO', 'FIXED', 0,
           'SO_LIEU', 'VARIABLE', 'ASSIGNED', true, false, v_sort, 'Số liệu nhập hằng tháng.'
    where not exists (
      select 1 from public.payroll_components c
      where lower(c.name) = lower(coalesce(v_known_names ->> v_ident, initcap(replace(lower(v_ident), '_', ' '))))
    );
    if found then
      v_new := array_append(v_new, v_ident);
    end if;
  end loop;

  insert into _input_pairs
  select distinct f.target, c.id
  from _formula_rows f
  cross join lateral regexp_matches(f.formula, '([A-Z_][A-Z0-9_]*)(\s*\()?', 'g') as m
  join public.payroll_components c on c.code = m[1]
  where m[2] is null and (c.code = any(v_new) or c.code = any(v_input_helpers));

  insert into public.payroll_template_items (template_id, component_id, mode, formula, amount, effective_from, sort_order, note)
  select p.target, p.component_id, 'MONTHLY_INPUT', null, null, public.m06_tmp_payroll_template_start(p.target), c.sort_order, null
  from (select distinct target, component_id from _input_pairs where target is not null) p
  join public.payroll_components c on c.id = p.component_id
  where not exists (
    select 1 from public.payroll_template_items x where x.template_id = p.target and x.component_id = p.component_id
  );
end $$;

-- 5e. Mọi cơ chế đang dùng: thêm các dòng engine cũ tính ngầm.
do $$
declare
  v_base_code text;
  v_template record;
  v_from date;
begin
  if not (select first_run from _m06_formula_ctx) then
    return;
  end if;

  select code into v_base_code from public.payroll_components where is_base limit 1;
  v_base_code := coalesce(v_base_code, 'LUONG_CO_BAN');

  for v_template in
    select t.id
    from public.payroll_templates t
    where t.code = 'CO_CHE_CHUNG'
       or exists (select 1 from public.payroll_template_items i where i.template_id = t.id)
       or exists (select 1 from public.unit_payroll_templates a where a.template_id = t.id)
       or exists (select 1 from public.employee_pay_profiles p where p.template_id = t.id)
  loop
    v_from := public.m06_tmp_payroll_template_start(v_template.id);

    insert into public.payroll_template_items (template_id, component_id, mode, formula, amount, effective_from, sort_order, note)
    select v_template.id, c.id, d.mode, d.formula, d.amount, v_from, d.sort_order, null
    from (values
      (v_base_code, 'PER_PERSON', null::text, null::numeric, 10),
      ('DAILY_RATE', 'FORMULA', v_base_code || ' / STANDARD_DAYS', null, 11),
      ('HOURLY_RATE', 'FORMULA', 'DAILY_RATE / HOURS_PER_DAY', null, 12),
      ('BASE_WORK', 'FORMULA', 'DAILY_RATE * WORK_DAYS', null, 20),
      ('BASE_LEAVE', 'FORMULA', 'DAILY_RATE * LEAVE_DAYS', null, 21),
      ('BASE_HOLIDAY', 'FORMULA', 'DAILY_RATE * HOLIDAY_DAYS', null, 22),
      ('INSURANCE_BASE', 'FORMULA', v_base_code, null, 590),
      ('DEPENDENTS', 'VALUE', null, 0, 595),
      ('THU_NHAP_CHIU_THUE', 'FORMULA', public.m06_tmp_payroll_taxable_formula(v_template.id, null), null, 597),
      ('THU_NHAP_TINH_THUE', 'FORMULA',
        'MAX(0, THU_NHAP_CHIU_THUE - INS_EMPLOYEE - GIAM_TRU_BAN_THAN - DEPENDENTS * GIAM_TRU_NPT)', null, 598),
      ('INS_EMPLOYEE', 'FORMULA', public.m06_tmp_payroll_insurance_formula('UNPAID_DAYS'), null, 600),
      ('PIT', 'FORMULA', 'THUE_LUY_TIEN(THU_NHAP_TINH_THUE)', null, 601),
      ('INS_EMPLOYER', 'FORMULA', public.m06_tmp_payroll_employer_insurance_formula('UNPAID_DAYS'), null, 602)
    ) as d(code, mode, formula, amount, sort_order)
    join public.payroll_components c on c.code = d.code
    where not exists (
      select 1 from public.payroll_template_items x where x.template_id = v_template.id and x.component_id = c.id
    );
  end loop;
end $$;

-- 5f. Thiết lập riêng của từng người trước đây (người phụ thuộc, mức đóng BH,
--     không đóng BH, thuế khoán / không khấu trừ, công chuẩn riêng, lương
--     ngày / giờ / khoán, lương gốc khai ở hồ sơ) → giá trị / công thức khai
--     riêng, cùng khoảng hiệu lực với hồ sơ cũ.
create or replace function public.m06_tmp_payroll_own_days(p_formula text, p_days numeric)
returns text
language sql
immutable
as $$
  select regexp_replace(
           regexp_replace(p_formula, '\mUNPAID_DAYS\M', format('MAX(0, %s - PAID_DAYS)', trim_scale(p_days)), 'g'),
           '\mSTANDARD_DAYS\M', trim_scale(p_days)::text, 'g');
$$;

do $$
declare
  v_base_code text;
begin
  if not (select first_run from _m06_formula_ctx) then
    return;
  end if;
  select code into v_base_code from public.payroll_components where is_base limit 1;
  v_base_code := coalesce(v_base_code, 'LUONG_CO_BAN');

  create temp table _profile_windows on commit drop as
  select p.*,
         date_trunc('month', p.effective_from)::date as month_start,
         (lead(p.effective_from) over (partition by p.user_id order by p.effective_from) - 1) as window_end,
         (select v.flat_tax_rate from public.payroll_param_version_for(p.effective_from) v) as version_flat_rate,
         coalesce(b.shared_base, false) as shared_base
  from public.employee_pay_profiles p
  left join _m06_old_base b on b.user_id = p.user_id and b.effective_from = p.effective_from;

  insert into public.employee_pay_items (user_id, component_id, amount, formula, effective_from, effective_to, note, created_by)
  select w.user_id, c.id, s.amount, s.formula, w.effective_from, w.window_end,
         'Chuyển từ thiết lập lương cũ', w.created_by
  from _profile_windows w
  cross join lateral (values
    ('DEPENDENTS', case when w.dependents > 0 then w.dependents::numeric end, null::text),
    ('INSURANCE_BASE',
      case when w.insurance_enabled and w.insurance_base is not null then w.insurance_base
           when w.insurance_base is null and w.pay_basis = 'PIECE' then 0::numeric end,
      case when w.insurance_base is null and w.pay_basis = 'DAILY' then 'BASE_WORK + BASE_LEAVE + BASE_HOLIDAY'
           when w.insurance_base is null and w.pay_basis = 'HOURLY' then 'BASE_WORK' end),
    ('INS_EMPLOYEE', case when not w.insurance_enabled then 0::numeric end, null),
    ('INS_EMPLOYER', case when not w.insurance_enabled then 0::numeric end, null),
    ('PIT',
      case when w.tax_mode = 'NONE' then 0::numeric end,
      case when w.tax_mode = 'FLAT' then 'THU_NHAP_CHIU_THUE * ' ||
        case when w.flat_tax_rate = w.version_flat_rate then 'TY_LE_KHAU_TRU_THANG'
             else trim_scale(round(w.flat_tax_rate / 100, 6))::text end end),
    -- Số tính thuế của người khoán / không khấu trừ: engine cũ ghi thu nhập
    -- tính thuế = toàn bộ thu nhập chịu thuế (khoán) hoặc 0 (không khấu trừ).
    ('THU_NHAP_TINH_THUE',
      case when w.tax_mode = 'NONE' then 0::numeric end,
      case when w.tax_mode = 'FLAT' then 'THU_NHAP_CHIU_THUE' end),
    ('DAILY_RATE', null::numeric, case when w.pay_basis = 'DAILY' then v_base_code end),
    ('HOURLY_RATE',
      case when w.pay_basis = 'PIECE' then 0::numeric end,
      case when w.pay_basis = 'DAILY' then v_base_code || ' / HOURS_PER_DAY'
           when w.pay_basis = 'HOURLY' then v_base_code end),
    ('BASE_WORK',
      case when w.pay_basis = 'PIECE' then 0::numeric end,
      case when w.pay_basis = 'HOURLY' then v_base_code || ' * WORK_HOURS' end),
    ('BASE_LEAVE', case when w.pay_basis in ('HOURLY', 'PIECE') then 0::numeric end, null),
    ('BASE_HOLIDAY', case when w.pay_basis in ('HOURLY', 'PIECE') then 0::numeric end, null),
    -- Mức lương ở hồ sơ chỉ chuyển khi engine cũ thực sự dùng nó (không có
    -- dòng lương gốc nào từ mẫu / đơn vị / khai riêng). Lương khoán không có
    -- lương cứng: khai 0 cho rõ, không phải "chưa khai".
    (v_base_code,
      case when (w.base_amount > 0 or w.pay_basis = 'PIECE') and not w.shared_base and not exists (
        select 1 from public.employee_pay_items e
        join public.payroll_components b on b.id = e.component_id
        where e.user_id = w.user_id and (b.code = v_base_code or b.is_base or e.is_base)
          and e.effective_from <= coalesce(w.window_end, 'infinity'::date)
          and coalesce(e.effective_to, 'infinity'::date) >= w.effective_from
      ) then case when w.pay_basis = 'PIECE' then 0::numeric else w.base_amount end end,
      null)
  ) as s(code, amount, formula)
  join public.payroll_components c on c.code = s.code
  where (s.amount is not null or s.formula is not null)
    and not exists (
      select 1 from public.employee_pay_items e
      where e.user_id = w.user_id and e.component_id = c.id and e.effective_from = w.effective_from
    );

  -- Công chuẩn riêng: engine cũ dùng nó ở MỌI chỗ đọc công chuẩn — đơn giá
  -- ngày, khoản chia theo ngày công, ngưỡng nghỉ không lương miễn đóng BH.
  -- Công thức nào của người đó đọc công chuẩn / số ngày nghỉ không lương thì
  -- thành công thức riêng mang số riêng.
  --   (1) khoản khai riêng sẵn có: sửa tại chỗ;
  update public.employee_pay_items e
  set formula = public.m06_tmp_payroll_own_days(e.formula, w.standard_days_override)
  from _profile_windows w
  where w.standard_days_override is not null
    and e.user_id = w.user_id
    and e.effective_from <= coalesce(w.window_end, 'infinity'::date)
    and coalesce(e.effective_to, 'infinity'::date) >= w.effective_from
    and e.formula ~ '\m(STANDARD_DAYS|UNPAID_DAYS)\M';

  --   (2) dòng chung của đơn vị gần nhất;
  insert into public.employee_pay_items (user_id, component_id, amount, formula, effective_from, effective_to, note)
  select w.user_id, u.component_id, u.amount, public.m06_tmp_payroll_own_days(u.formula, w.standard_days_override),
         w.effective_from, w.window_end, 'Chuyển từ thiết lập lương cũ'
  from _profile_windows w
  join public.profiles pr on pr.id = w.user_id
  cross join lateral (
    select distinct on (ui.component_id) ui.component_id, ui.amount, ui.formula
    from _m06_unit_tree t
    join public.unit_pay_items ui on ui.unit_id = t.root_id
    where t.unit_id = pr.unit_id
      and ui.effective_from <= (w.month_start + interval '1 month - 1 day')::date
      and (ui.effective_to is null or ui.effective_to >= w.month_start)
    order by ui.component_id, t.depth, ui.effective_from desc
  ) u
  where w.standard_days_override is not null
    and u.formula ~ '\m(STANDARD_DAYS|UNPAID_DAYS)\M'
    and not exists (
      select 1 from public.employee_pay_items e
      where e.user_id = w.user_id and e.component_id = u.component_id
        and e.effective_from <= coalesce(w.window_end, 'infinity'::date)
        and coalesce(e.effective_to, 'infinity'::date) >= w.effective_from
    );

  --   (3) dòng của cơ chế (khi đơn vị và người đó không khai riêng dòng ấy).
  insert into public.employee_pay_items (user_id, component_id, amount, formula, effective_from, effective_to, note)
  select w.user_id, i.component_id, i.amount, public.m06_tmp_payroll_own_days(i.formula, w.standard_days_override),
         w.effective_from, w.window_end, 'Chuyển từ thiết lập lương cũ'
  from _profile_windows w
  join public.profiles pr on pr.id = w.user_id
  join public.payroll_template_items i
    on i.template_id = public.payroll_template_for(w.user_id, w.month_start)
   and i.effective_from <= (w.month_start + interval '1 month - 1 day')::date
   and (i.effective_to is null or i.effective_to >= w.month_start)
  where w.standard_days_override is not null
    and i.formula ~ '\m(STANDARD_DAYS|UNPAID_DAYS)\M'
    and not exists (
      select 1 from public.employee_pay_items e
      where e.user_id = w.user_id and e.component_id = i.component_id
        and e.effective_from <= coalesce(w.window_end, 'infinity'::date)
        and coalesce(e.effective_to, 'infinity'::date) >= w.effective_from
    )
    and not exists (
      select 1 from _m06_unit_tree t
      join public.unit_pay_items ui on ui.unit_id = t.root_id and ui.component_id = i.component_id
      where t.unit_id = pr.unit_id
        and ui.effective_from <= (w.month_start + interval '1 month - 1 day')::date
        and (ui.effective_to is null or ui.effective_to >= w.month_start)
    );

  -- Cờ chịu thuế của người khác cơ chế (khai riêng một khoản không chịu thuế,
  -- hay khoản chung của đơn vị thay dòng mẫu mang cờ khác) → công thức "Thu
  -- nhập chịu thuế" riêng của người đó, từ kỳ chưa chốt đầu tiên.
  insert into public.employee_pay_items (user_id, component_id, amount, formula, effective_from, note)
  select x.user_id, c.id, null, x.personal,
         greatest(x.first_month, coalesce((public.payroll_last_closed_month() + interval '1 month')::date, x.first_month)),
         'Chuyển từ thiết lập lương cũ'
  from (
    select pt.user_id,
           public.m06_tmp_payroll_taxable_formula(pt.template_id, pt.user_id) as personal,
           public.m06_tmp_payroll_taxable_formula(pt.template_id, null) as shared,
           least(
             (select min(date_trunc('month', p.effective_from)::date) from public.employee_pay_profiles p where p.user_id = pt.user_id),
             (select min(date_trunc('month', e.effective_from)::date) from public.employee_pay_items e where e.user_id = pt.user_id)
           ) as first_month
    from _m06_person_tpl pt
    where pt.template_id is not null
      and (exists (select 1 from public.employee_pay_profiles p where p.user_id = pt.user_id)
           or exists (select 1 from public.employee_pay_items e where e.user_id = pt.user_id))
  ) x
  join public.payroll_components c on c.code = 'THU_NHAP_CHIU_THUE'
  where x.personal is distinct from x.shared
    and not exists (
      select 1 from public.employee_pay_items e2 where e2.user_id = x.user_id and e2.component_id = c.id
    );
end $$;

-- 5g. Đề xuất đang mở mang thiết lập cũ → cùng cách chuyển như trên.
do $$
begin
  if not (select first_run from _m06_formula_ctx) then
    return;
  end if;

  update public.payroll_scheme_requests r
  set payload = jsonb_build_object(
        'profile', jsonb_build_object('template_id', r.payload -> 'profile' -> 'template_id'),
        'items', coalesce((
          select jsonb_agg(i - 'taxable' - 'insurable' - 'is_base')
          from jsonb_array_elements(coalesce(r.payload -> 'items', '[]'::jsonb)) i
        ), '[]'::jsonb) || coalesce((
          select jsonb_agg(jsonb_build_object('component_id', c.id, 'amount', s.amount, 'formula', s.formula, 'note', null))
          from (values
            ('DEPENDENTS', case when coalesce((r.payload -> 'profile' ->> 'dependents')::numeric, 0) > 0
              then (r.payload -> 'profile' ->> 'dependents')::numeric end, null::text),
            ('INSURANCE_BASE', case when jsonb_typeof(r.payload -> 'profile' -> 'insurance_base') = 'number'
              and coalesce((r.payload -> 'profile' ->> 'insurance_enabled')::boolean, true)
              then (r.payload -> 'profile' ->> 'insurance_base')::numeric end, null),
            ('INS_EMPLOYEE', case when not coalesce((r.payload -> 'profile' ->> 'insurance_enabled')::boolean, true) then 0::numeric end,
              case when coalesce((r.payload -> 'profile' ->> 'insurance_enabled')::boolean, true)
                and jsonb_typeof(r.payload -> 'profile' -> 'standard_days_override') = 'number'
                then public.m06_tmp_payroll_insurance_formula(format('MAX(0, %s - PAID_DAYS)', r.payload -> 'profile' ->> 'standard_days_override')) end),
            ('INS_EMPLOYER', case when not coalesce((r.payload -> 'profile' ->> 'insurance_enabled')::boolean, true) then 0::numeric end,
              case when coalesce((r.payload -> 'profile' ->> 'insurance_enabled')::boolean, true)
                and jsonb_typeof(r.payload -> 'profile' -> 'standard_days_override') = 'number'
                then public.m06_tmp_payroll_employer_insurance_formula(format('MAX(0, %s - PAID_DAYS)', r.payload -> 'profile' ->> 'standard_days_override')) end),
            ('PIT', case when r.payload -> 'profile' ->> 'tax_mode' = 'NONE' then 0::numeric end,
              case when r.payload -> 'profile' ->> 'tax_mode' = 'FLAT'
                then 'THU_NHAP_CHIU_THUE * ' || trim_scale(round(coalesce((r.payload -> 'profile' ->> 'flat_tax_rate')::numeric, 10) / 100, 6))::text end),
            ('THU_NHAP_TINH_THUE', case when r.payload -> 'profile' ->> 'tax_mode' = 'NONE' then 0::numeric end,
              case when r.payload -> 'profile' ->> 'tax_mode' = 'FLAT' then 'THU_NHAP_CHIU_THUE' end),
            ('DAILY_RATE', null::numeric, case when jsonb_typeof(r.payload -> 'profile' -> 'standard_days_override') = 'number'
              then coalesce((select code from public.payroll_components where is_base limit 1), 'LUONG_CO_BAN')
                || ' / ' || (r.payload -> 'profile' ->> 'standard_days_override') end)
          ) as s(code, amount, formula)
          join public.payroll_components c on c.code = s.code
          where (s.amount is not null or s.formula is not null)
            and not exists (
              select 1 from jsonb_array_elements(coalesce(r.payload -> 'items', '[]'::jsonb)) x
              where x ->> 'component_id' = c.id::text
            )
        ), '[]'::jsonb)
      )
  where r.target_type = 'USER'
    and r.status in ('DRAFT', 'SUBMITTED', 'REJECTED')
    and jsonb_typeof(r.payload -> 'profile') = 'object'
    and (r.payload -> 'profile') ? 'dependents';
end $$;

-- 5h. Danh mục không còn giữ cách tính — cách tính nằm ở dòng cơ chế.
update public.payroll_components
set calc_type = 'FIXED', formula = null, input_code = null, base_code = null, prorate = false
where calc_type <> 'FIXED' or formula is not null or input_code is not null or base_code is not null or prorate;

-- ---------------------------------------------------------------------------
-- 6. Lưu trọn một cơ chế, hiệu lực từ một tháng
-- ---------------------------------------------------------------------------
create or replace function public.save_payroll_mechanism(
  p_template_id uuid,
  p_effective_from date,
  p_rows jsonb
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_last date := public.payroll_last_closed_month();
  v_template public.payroll_templates%rowtype;
  v_row jsonb;
  v_component public.payroll_components%rowtype;
  v_seen uuid[] := '{}';
  v_mode text;
  v_count integer;
begin
  if auth.uid() is null or not public.can_function('admin.payroll_settings') then
    raise exception 'Bạn không có quyền thiết kế cơ chế lương.' using errcode = '42501';
  end if;
  select * into v_template from public.payroll_templates where id = p_template_id;
  if v_template.id is null then
    raise exception 'Không tìm thấy cơ chế lương.' using errcode = 'P0002';
  end if;
  if p_effective_from is null or p_effective_from <> date_trunc('month', p_effective_from)::date then
    raise exception 'Ngày hiệu lực phải là ngày đầu tháng.' using errcode = '22023';
  end if;
  if v_last is not null and p_effective_from <= v_last then
    raise exception 'Kỳ lương tháng % đã chốt — thay đổi phải có hiệu lực từ tháng % trở đi.',
      to_char(v_last, 'MM/YYYY'), to_char(v_last + interval '1 month', 'MM/YYYY') using errcode = '23514';
  end if;
  if exists (
    select 1 from public.payroll_template_items i
    where i.template_id = p_template_id and i.effective_from > p_effective_from
  ) then
    raise exception 'Cơ chế này đã có thay đổi hiệu lực từ tháng sau — mở tháng đó để sửa.' using errcode = '23514';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'Danh sách dòng không hợp lệ.' using errcode = '22023';
  end if;

  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    select * into v_component from public.payroll_components where id = nullif(v_row ->> 'component_id', '')::uuid;
    if v_component.id is null then
      raise exception 'Có dòng trỏ tới đầu mục không còn trong danh mục.' using errcode = '23503';
    end if;
    if v_component.id = any(v_seen) then
      raise exception 'Đầu mục "%" có hai dòng trong cơ chế.', v_component.name using errcode = '23505';
    end if;
    v_seen := array_append(v_seen, v_component.id);
    v_mode := coalesce(v_row ->> 'mode', '');
    if v_mode not in ('FORMULA', 'VALUE', 'PER_PERSON', 'MONTHLY_INPUT') then
      raise exception 'Dòng "%" chưa chọn cách lấy giá trị.', v_component.name using errcode = '22023';
    end if;
    if v_mode = 'FORMULA' and coalesce(trim(v_row ->> 'formula'), '') = '' then
      raise exception 'Dòng "%" chưa có công thức.', v_component.name using errcode = '23514';
    end if;
    if length(coalesce(v_row ->> 'formula', '')) > 2000 then
      raise exception 'Công thức dòng "%" quá dài.', v_component.name using errcode = '22023';
    end if;
    if jsonb_typeof(v_row -> 'amount') = 'number' and (v_row ->> 'amount')::numeric < 0 then
      raise exception 'Giá trị dòng "%" không được âm.', v_component.name using errcode = '23514';
    end if;
  end loop;

  update public.payroll_template_items
  set effective_to = (p_effective_from - interval '1 day')::date
  where template_id = p_template_id
    and effective_from < p_effective_from
    and (effective_to is null or effective_to >= p_effective_from);
  delete from public.payroll_template_items
  where template_id = p_template_id and effective_from >= p_effective_from;

  insert into public.payroll_template_items (
    template_id, component_id, mode, formula, amount, effective_from, sort_order, note
  )
  select
    p_template_id,
    (r ->> 'component_id')::uuid,
    r ->> 'mode',
    case when r ->> 'mode' = 'FORMULA' then nullif(trim(r ->> 'formula'), '') end,
    case when r ->> 'mode' = 'VALUE' and jsonb_typeof(r -> 'amount') = 'number' then (r ->> 'amount')::numeric end,
    p_effective_from,
    coalesce(nullif(r ->> 'sort_order', '')::integer, (ord * 10)::integer),
    nullif(trim(coalesce(r ->> 'note', '')), '')
  from jsonb_array_elements(p_rows) with ordinality as e(r, ord);
  get diagnostics v_count = row_count;

  perform public.write_payroll_audit(
    'salary.mechanism_save', 'payroll_template', p_template_id::text,
    format('Lưu cơ chế lương %s (%s dòng) hiệu lực từ %s', v_template.name, v_count, to_char(p_effective_from, 'MM/YYYY')),
    jsonb_build_object('rows', p_rows)
  );
  return v_count;
end;
$$;

revoke all on function public.save_payroll_mechanism(uuid, date, jsonb) from public;
grant execute on function public.save_payroll_mechanism(uuid, date, jsonb) to authenticated;

-- Bộ dòng gợi ý cho một cơ chế còn trống. Gợi ý là DỮ LIỆU ở đây: công thức
-- chỉ gọi tên đầu mục, tham số và dữ liệu tự động — đổi chính sách là đổi
-- tham số, không phải sửa công thức.
create or replace function public.payroll_mechanism_suggestions(p_variant text)
returns table (code text, mode text, formula text, amount numeric, sort_order integer)
language sql
immutable
as $$
  select d.code, d.mode, d.formula, d.amount, d.sort_order
  from (values
    ('ALL', 'LUONG_CO_BAN', 'PER_PERSON', null::text, null::numeric, 10),
    ('ALL', 'DAILY_RATE', 'FORMULA', 'LUONG_CO_BAN / STANDARD_DAYS', null, 20),
    ('ALL', 'HOURLY_RATE', 'FORMULA', 'DAILY_RATE / HOURS_PER_DAY', null, 30),
    ('ALL', 'BASE_WORK', 'FORMULA', 'DAILY_RATE * WORK_DAYS', null, 40),
    ('ALL', 'BASE_LEAVE', 'FORMULA', 'DAILY_RATE * LEAVE_DAYS', null, 50),
    ('ALL', 'BASE_HOLIDAY', 'FORMULA', 'DAILY_RATE * HOLIDAY_DAYS', null, 60),
    ('ALL', 'MUC_KPI', 'PER_PERSON', null, null, 70),
    ('ALL', 'LUONG_KPI', 'FORMULA', 'MUC_KPI * TY_LE_KPI', null, 80),
    ('ALL', 'OT_WEEKDAY', 'FORMULA', 'HOURLY_RATE * HE_SO_OT_THUONG * OT_WEEKDAY_HOURS', null, 90),
    ('ALL', 'OT_WEEKEND', 'FORMULA', 'HOURLY_RATE * HE_SO_OT_NGHI * OT_WEEKEND_HOURS', null, 100),
    ('ALL', 'OT_HOLIDAY', 'FORMULA', 'HOURLY_RATE * HE_SO_OT_LE * OT_HOLIDAY_HOURS', null, 110),
    ('VAN_PHONG', 'LUONG_VAN_CHUYEN', 'MONTHLY_INPUT', null, null, 120),
    ('KINH_DOANH', 'DOANH_SO', 'MONTHLY_INPUT', null, null, 120),
    ('KINH_DOANH', 'DOANH_SO_KHOAN', 'MONTHLY_INPUT', null, null, 121),
    ('KINH_DOANH', 'DOANH_SO_CAT_MA', 'MONTHLY_INPUT', null, null, 122),
    ('KINH_DOANH', 'DOANH_SO_THU_CAT_LO', 'MONTHLY_INPUT', null, null, 123),
    ('KINH_DOANH', 'LUONG_DOANH_SO', 'FORMULA',
      'IF(DOANH_SO_KHOAN > 0, DOANH_SO * HH_BL02(DOANH_SO / DOANH_SO_KHOAN * 100), 0) + DOANH_SO_CAT_MA * TY_LE_HH_CAT_MA', null, 124),
    ('KINH_DOANH', 'LUONG_DT_CAT_LO', 'FORMULA', 'DOANH_SO_THU_CAT_LO * TY_LE_HH_CAT_LO', null, 125),
    ('KINH_DOANH', 'PC_CONG_TAC_TINH', 'VALUE', null, null, 126),
    ('ALL', 'ALLOW_RESPONSIBILITY', 'VALUE', null, null, 130),
    ('ALL', 'PHU_CAP_KHAC', 'VALUE', null, null, 140),
    ('ALL', 'THUONG_DI_SOM', 'MONTHLY_INPUT', null, null, 150),
    ('KINH_DOANH', 'THUONG_CTKM', 'MONTHLY_INPUT', null, null, 155),
    ('KINH_DOANH', 'THUONG_DOANH_SO_VUOT', 'FORMULA',
      'IF(DOANH_SO_KHOAN > 0 && DOANH_SO / DOANH_SO_KHOAN > NGUONG_THUONG_VUOT, MUC_THUONG_VUOT, 0)', null, 158),
    ('ALL', 'THUONG_THANG', 'MONTHLY_INPUT', null, null, 160),
    ('ALL', 'PHAT_DI_MUON_VE_SOM', 'FORMULA', '(LATE_COUNT + EARLY_COUNT) * DON_GIA_PHAT_DI_MUON', null, 200),
    ('ALL', 'PHAT_DI_MUON', 'FORMULA', 'MAX(LATE_COUNT - SO_LAN_DI_MUON_CHO_PHEP, 0) * DON_GIA_PHAT_DI_MUON_QUA_LAN', null, 210),
    ('KINH_DOANH', 'SO_LAN_THIEU_BAO_CAO', 'MONTHLY_INPUT', null, null, 215),
    ('KINH_DOANH', 'PHAT_BAO_CAO', 'FORMULA', 'SO_LAN_THIEU_BAO_CAO * DON_GIA_PHAT_BAO_CAO', null, 220),
    ('ALL', 'INSURANCE_BASE', 'FORMULA', 'LUONG_CO_BAN', null, 300),
    ('ALL', 'INS_EMPLOYEE', 'FORMULA',
      'IF(UNPAID_DAYS >= SO_NGAY_MIEN_DONG_BH, 0, MIN(INSURANCE_BASE, TRAN_BHXH_BHYT) * (TY_LE_BHXH_NLD + TY_LE_BHYT_NLD) + MIN(INSURANCE_BASE, TRAN_BHTN) * TY_LE_BHTN_NLD)',
      null, 310),
    ('VAN_PHONG', 'QUY_CONG_DOAN', 'FORMULA', '(BASE_WORK + LUONG_VAN_CHUYEN) * TY_LE_QUY_1PT', null, 320),
    ('KINH_DOANH', 'QUY_CONG_DOAN', 'FORMULA', '(BASE_WORK + LUONG_DOANH_SO) * TY_LE_QUY_1PT', null, 320),
    ('ALL', 'DEPENDENTS', 'VALUE', null, 0, 330),
    ('ALL', 'THU_NHAP_CHIU_THUE', 'FORMULA',
      'TONG_THU_NHAP - OT_WEEKDAY * (HE_SO_OT_THUONG - 1) / HE_SO_OT_THUONG - OT_WEEKEND * (HE_SO_OT_NGHI - 1) / HE_SO_OT_NGHI - OT_HOLIDAY * (HE_SO_OT_LE - 1) / HE_SO_OT_LE',
      null, 335),
    ('ALL', 'THU_NHAP_TINH_THUE', 'FORMULA',
      'MAX(0, THU_NHAP_CHIU_THUE - INS_EMPLOYEE - GIAM_TRU_BAN_THAN - DEPENDENTS * GIAM_TRU_NPT)', null, 340),
    ('ALL', 'PIT', 'FORMULA', 'THUE_LUY_TIEN(THU_NHAP_TINH_THUE)', null, 350),
    ('ALL', 'INS_EMPLOYER', 'FORMULA',
      'IF(UNPAID_DAYS >= SO_NGAY_MIEN_DONG_BH, 0, MIN(INSURANCE_BASE, TRAN_BHXH_BHYT) * (TY_LE_BHXH_DN + TY_LE_BHYT_DN + TY_LE_KPCD) + MIN(INSURANCE_BASE, TRAN_BHTN) * TY_LE_BHTN_DN)',
      null, 355),
    ('ALL', 'ADVANCE', 'MONTHLY_INPUT', null, null, 360)
  ) as d(variant, code, mode, formula, amount, sort_order)
  where d.variant = 'ALL' or d.variant = p_variant;
$$;

create or replace function public.seed_payroll_mechanism_defaults(
  p_template_id uuid,
  p_effective_from date,
  p_variant text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_template public.payroll_templates%rowtype;
  v_last date := public.payroll_last_closed_month();
  v_count integer;
begin
  if auth.uid() is null or not public.can_function('admin.payroll_settings') then
    raise exception 'Bạn không có quyền thiết kế cơ chế lương.' using errcode = '42501';
  end if;
  if p_variant not in ('VAN_PHONG', 'KINH_DOANH') then
    raise exception 'Bộ gợi ý không hợp lệ.' using errcode = '22023';
  end if;
  select * into v_template from public.payroll_templates where id = p_template_id;
  if v_template.id is null then
    raise exception 'Không tìm thấy cơ chế lương.' using errcode = 'P0002';
  end if;
  if p_effective_from is null or p_effective_from <> date_trunc('month', p_effective_from)::date then
    raise exception 'Ngày hiệu lực phải là ngày đầu tháng.' using errcode = '22023';
  end if;
  if v_last is not null and p_effective_from <= v_last then
    raise exception 'Kỳ lương tháng % đã chốt — chọn tháng % trở đi.',
      to_char(v_last, 'MM/YYYY'), to_char(v_last + interval '1 month', 'MM/YYYY') using errcode = '23514';
  end if;
  if exists (select 1 from public.payroll_template_items where template_id = p_template_id) then
    raise exception 'Cơ chế đã có dòng — chỉ nạp gợi ý cho cơ chế còn trống.' using errcode = '23514';
  end if;

  perform public.payroll_ensure_components(array(select s.code from public.payroll_mechanism_suggestions(p_variant) s));

  insert into public.payroll_template_items (template_id, component_id, mode, formula, amount, effective_from, sort_order, note)
  select p_template_id, c.id, s.mode, s.formula, s.amount, p_effective_from, s.sort_order, null
  from public.payroll_mechanism_suggestions(p_variant) s
  join public.payroll_components c on c.code = s.code and c.is_active;
  get diagnostics v_count = row_count;

  perform public.write_payroll_audit(
    'salary.mechanism_seed', 'payroll_template', p_template_id::text,
    format('Nạp %s dòng gợi ý vào cơ chế %s', v_count, v_template.name), null);
  return v_count;
end;
$$;

revoke all on function public.seed_payroll_mechanism_defaults(uuid, date, text) from public;
grant execute on function public.seed_payroll_mechanism_defaults(uuid, date, text) to authenticated;

-- Đường ghi cũ từng dòng / nạp gợi ý cũ — thay bằng hai hàm trên.
drop function if exists public.save_payroll_template_item(uuid, uuid, date, numeric, text, boolean, boolean, text);
drop function if exists public.end_payroll_template_item(uuid, uuid, date);
drop function if exists public.seed_payroll_template_defaults(uuid, date);

-- Gán cơ chế cho đơn vị: cùng luật như trước, câu chữ theo tên mới.
create or replace function public.assign_payroll_template(
  p_unit_id uuid,
  p_template_id uuid,
  p_effective_from date,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_last date := public.payroll_last_closed_month();
begin
  if auth.uid() is null or not public.can_function('admin.payroll_settings') then
    raise exception 'Bạn không có quyền gán cơ chế lương.' using errcode = '42501';
  end if;
  if p_effective_from is null or p_effective_from <> date_trunc('month', p_effective_from)::date then
    raise exception 'Ngày hiệu lực phải là ngày đầu tháng.' using errcode = '22023';
  end if;
  if v_last is not null and p_effective_from <= v_last then
    raise exception 'Kỳ lương tháng % đã chốt — đổi cơ chế phải có hiệu lực từ tháng % trở đi.',
      to_char(v_last, 'MM/YYYY'), to_char(v_last + interval '1 month', 'MM/YYYY') using errcode = '23514';
  end if;
  if p_template_id is not null and not exists (
    select 1 from public.payroll_templates t where t.id = p_template_id and t.is_active
  ) then
    raise exception 'Cơ chế lương không tồn tại hoặc đã tắt.' using errcode = '23503';
  end if;
  if exists (
    select 1 from public.unit_payroll_templates a
    where a.unit_id = p_unit_id and a.effective_from > p_effective_from
  ) then
    raise exception 'Đơn vị này đã có thay đổi cơ chế từ tháng sau — sửa thay đổi đó trước.' using errcode = '23514';
  end if;

  insert into public.unit_payroll_templates (unit_id, template_id, effective_from, note)
  values (p_unit_id, p_template_id, p_effective_from, nullif(trim(coalesce(p_note, '')), ''))
  on conflict (unit_id, effective_from) do update set
    template_id = excluded.template_id,
    note = excluded.note;

  perform public.write_payroll_audit(
    'salary.template_assign', 'organization_unit', p_unit_id::text,
    format('%s%s cho %s từ %s',
      case when p_template_id is null then 'Bỏ gán cơ chế lương' else 'Gán cơ chế ' end,
      coalesce((select name from public.payroll_templates where id = p_template_id), ''),
      (select name from public.organization_units where id = p_unit_id),
      to_char(p_effective_from, 'MM/YYYY')),
    null
  );
end;
$$;

revoke all on function public.assign_payroll_template(uuid, uuid, date, text) from public;
grant execute on function public.assign_payroll_template(uuid, uuid, date, text) to authenticated;

create or replace function public.audit_payroll_template()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    perform public.write_payroll_audit('salary.template_create', 'payroll_template', new.id::text,
      format('Tạo cơ chế lương %s', new.name), null);
    return new;
  elsif tg_op = 'DELETE' then
    perform public.write_payroll_audit('salary.template_delete', 'payroll_template', old.id::text,
      format('Xoá cơ chế lương %s', old.name), null);
    return old;
  end if;
  if public.payroll_row_diff(to_jsonb(old), to_jsonb(new)) <> '{}'::jsonb then
    perform public.write_payroll_audit('salary.template_update', 'payroll_template', new.id::text,
      format('Sửa cơ chế lương %s', new.name),
      jsonb_build_object('changes', public.payroll_row_diff(to_jsonb(old), to_jsonb(new))));
  end if;
  return new;
end;
$$;

create or replace function public.guard_payroll_template_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.unit_payroll_templates a where a.template_id = old.id)
     or exists (select 1 from public.employee_pay_profiles p where p.template_id = old.id) then
    raise exception 'Cơ chế "%" đang / đã gán cho đơn vị hoặc nhân sự — tắt cơ chế thay vì xoá.', old.name
      using errcode = '23503';
  end if;
  return old;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Đề xuất khai riêng: payload chỉ còn cơ chế + giá trị / công thức riêng
-- ---------------------------------------------------------------------------
create or replace function public.payroll_validate_scheme_payload(
  p_target_type text,
  p_target_id uuid,
  p_effective_from date,
  p_payload jsonb,
  p_full boolean
)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_item jsonb;
  v_profile jsonb := p_payload -> 'profile';
  v_component public.payroll_components%rowtype;
  v_seen uuid[] := '{}';
  v_version public.payroll_param_versions%rowtype;
  v_last date := public.payroll_last_closed_month();
  v_floor_value numeric;
  v_floor_param numeric;
  v_floor_name text;
begin
  if jsonb_typeof(p_payload -> 'items') is distinct from 'array' then
    raise exception 'Đề xuất thiếu danh sách giá trị khai riêng.' using errcode = '22023';
  end if;
  if p_effective_from is null or p_effective_from <> date_trunc('month', p_effective_from)::date then
    raise exception 'Tháng áp dụng phải là ngày đầu tháng.' using errcode = '22023';
  end if;
  if v_last is not null and p_effective_from <= v_last then
    raise exception 'Kỳ lương tháng % đã chốt — cơ chế mới phải áp dụng từ tháng % trở đi.',
      to_char(v_last, 'MM/YYYY'), to_char(v_last + interval '1 month', 'MM/YYYY') using errcode = '23514';
  end if;

  for v_item in select value from jsonb_array_elements(p_payload -> 'items')
  loop
    if jsonb_typeof(v_item -> 'component_id') is distinct from 'string' then
      raise exception 'Có dòng chưa chọn đầu mục.' using errcode = '22023';
    end if;
    select * into v_component from public.payroll_components where id = (v_item ->> 'component_id')::uuid;
    if v_component.id is null then
      raise exception 'Đầu mục không còn trong danh mục.' using errcode = '23503';
    end if;
    if v_component.id = any(v_seen) then
      raise exception 'Đầu mục "%" bị khai hai lần.', v_component.name using errcode = '23505';
    end if;
    v_seen := array_append(v_seen, v_component.id);
    if v_item ? 'amount' and jsonb_typeof(v_item -> 'amount') <> 'null' then
      if jsonb_typeof(v_item -> 'amount') is distinct from 'number' then
        raise exception 'Giá trị "%" phải là số.', v_component.name using errcode = '22023';
      end if;
      if (v_item ->> 'amount')::numeric < 0 then
        raise exception 'Giá trị "%" không được âm.', v_component.name using errcode = '23514';
      end if;
    end if;
    if v_item ? 'formula' and jsonb_typeof(v_item -> 'formula') not in ('null', 'string') then
      raise exception 'Công thức "%" không hợp lệ.', v_component.name using errcode = '22023';
    end if;
    if length(coalesce(v_item ->> 'formula', '')) > 2000 then
      raise exception 'Công thức "%" quá dài.', v_component.name using errcode = '22023';
    end if;
  end loop;

  if p_target_type = 'USER' and jsonb_typeof(v_profile) = 'object'
     and jsonb_typeof(v_profile -> 'template_id') = 'string' and not exists (
       select 1 from public.payroll_templates t where t.id = (v_profile ->> 'template_id')::uuid and t.is_active
     ) then
    raise exception 'Cơ chế lương đã chọn không còn dùng.' using errcode = '23503';
  end if;

  if not p_full then
    return;
  end if;

  select * into v_version from public.payroll_param_version_for(p_effective_from);
  if v_version.id is null then
    raise exception 'Chưa có bộ tham số lương hiệu lực cho tháng % — khai ở Tham số lương trước.',
      to_char(p_effective_from, 'MM/YYYY') using errcode = '23514';
  end if;

  -- Kiểm tra mức sàn (nếu bộ tham số có khai): ví dụ lương cơ bản ≥ lương tối thiểu vùng.
  if p_target_type = 'USER' and v_version.floor_component_code is not null and v_version.floor_param_code is not null then
    select (i ->> 'amount')::numeric, c.name
    into v_floor_value, v_floor_name
    from jsonb_array_elements(p_payload -> 'items') i
    join public.payroll_components c on c.id = (i ->> 'component_id')::uuid
    where c.code = v_version.floor_component_code and jsonb_typeof(i -> 'amount') = 'number'
    limit 1;
    select (p ->> 'value')::numeric
    into v_floor_param
    from jsonb_array_elements(v_version.param_tables) t, jsonb_array_elements(coalesce(t -> 'params', '[]'::jsonb)) p
    where p ->> 'code' = v_version.floor_param_code
    limit 1;
    if v_floor_value is not null and v_floor_param is not null and v_floor_value < v_floor_param then
      raise exception '% % thấp hơn mức sàn % của bộ tham số.',
        v_floor_name, replace(to_char(v_floor_value, 'FM999,999,999,999'), ',', '.'),
        replace(to_char(v_floor_param, 'FM999,999,999,999'), ',', '.')
        using errcode = '23514';
    end if;
  end if;

  if p_target_type = 'USER' and (
    exists (select 1 from public.employee_pay_profiles where user_id = p_target_id and effective_from > p_effective_from)
    or exists (select 1 from public.employee_pay_items where user_id = p_target_id and effective_from > p_effective_from)
  ) then
    raise exception 'Người này đã có cơ chế hiệu lực sau tháng % — đề xuất phải áp dụng từ sau mốc đó.',
      to_char(p_effective_from, 'MM/YYYY') using errcode = '23514';
  end if;
  if p_target_type = 'UNIT' and exists (
    select 1 from public.unit_pay_items where unit_id = p_target_id and effective_from > p_effective_from
  ) then
    raise exception 'Đơn vị này đã có giá trị chung hiệu lực sau tháng % — đề xuất phải áp dụng từ sau mốc đó.',
      to_char(p_effective_from, 'MM/YYYY') using errcode = '23514';
  end if;
end;
$$;

revoke all on function public.payroll_validate_scheme_payload(text, uuid, date, jsonb, boolean) from public, anon, authenticated;

create or replace function public.apply_payroll_scheme_request(p_request public.payroll_scheme_requests)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_eff date := p_request.effective_from;
  v_close date := (p_request.effective_from - interval '1 day')::date;
  v_profile jsonb := p_request.payload -> 'profile';
begin
  if p_request.target_type = 'USER' then
    insert into public.employee_pay_profiles (user_id, effective_from, template_id, note, created_by)
    values (
      p_request.user_id, v_eff,
      case when jsonb_typeof(v_profile -> 'template_id') = 'string' then (v_profile ->> 'template_id')::uuid end,
      coalesce(p_request.note, 'Áp dụng theo đề xuất ' || p_request.code),
      p_request.submitted_by
    )
    on conflict (user_id, effective_from) do update set
      template_id = excluded.template_id,
      note = excluded.note;

    update public.employee_pay_items
    set effective_to = v_close
    where user_id = p_request.user_id
      and effective_from < v_eff
      and (effective_to is null or effective_to >= v_eff);
    delete from public.employee_pay_items
    where user_id = p_request.user_id and effective_from >= v_eff;

    insert into public.employee_pay_items (user_id, component_id, amount, formula, effective_from, note, created_by)
    select
      p_request.user_id,
      (i ->> 'component_id')::uuid,
      case when jsonb_typeof(i -> 'amount') = 'number' then (i ->> 'amount')::numeric end,
      nullif(trim(coalesce(i ->> 'formula', '')), ''),
      v_eff,
      nullif(trim(coalesce(i ->> 'note', '')), ''),
      p_request.submitted_by
    from jsonb_array_elements(p_request.payload -> 'items') i;
  else
    update public.unit_pay_items
    set effective_to = v_close
    where unit_id = p_request.unit_id
      and effective_from < v_eff
      and (effective_to is null or effective_to >= v_eff);
    delete from public.unit_pay_items
    where unit_id = p_request.unit_id and effective_from >= v_eff;

    insert into public.unit_pay_items (unit_id, component_id, amount, formula, effective_from, note, created_by)
    select
      p_request.unit_id,
      (i ->> 'component_id')::uuid,
      case when jsonb_typeof(i -> 'amount') = 'number' then (i ->> 'amount')::numeric end,
      nullif(trim(coalesce(i ->> 'formula', '')), ''),
      v_eff,
      nullif(trim(coalesce(i ->> 'note', '')), ''),
      p_request.submitted_by
    from jsonb_array_elements(p_request.payload -> 'items') i;
  end if;
end;
$$;

revoke all on function public.apply_payroll_scheme_request(public.payroll_scheme_requests) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 8. Câu báo lỗi không dẫn chiếu tài liệu
-- ---------------------------------------------------------------------------
create or replace function public.mark_payroll_run_paid(p_run_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run public.payroll_runs%rowtype;
  v_slips integer;
begin
  if auth.uid() is null or not public.can_function('admin.payroll') then
    raise exception 'Bạn không có quyền với kỳ lương.' using errcode = '42501';
  end if;
  select * into v_run from public.payroll_runs where id = p_run_id for update;
  if v_run.status is distinct from 'APPROVED' then
    raise exception 'Chỉ xác nhận chi trả kỳ đã được Ban Giám đốc duyệt.' using errcode = '23514';
  end if;

  perform set_config('app.payroll_run_transition', 'on', true);
  update public.payroll_runs
  set status = 'PAID', paid_at = now(), paid_by = auth.uid(), published_at = now()
  where id = p_run_id;
  perform set_config('app.payroll_run_transition', 'off', true);

  select count(*) into v_slips from public.payslips where run_id = p_run_id;
  perform public.add_payroll_approval_event('RUN', p_run_id, 'PAID', null, jsonb_build_object('published', v_slips));
  perform public.write_payroll_audit('salary.run_paid', 'payroll_run', p_run_id::text,
    format('Xác nhận đã chi trả kỳ %s, phát hành %s phiếu lương', to_char(v_run.month_start, 'MM/YYYY'), v_slips), null);
  return v_slips;
end;
$$;

revoke all on function public.mark_payroll_run_paid(uuid) from public;
grant execute on function public.mark_payroll_run_paid(uuid) to authenticated;

create or replace function public.guard_timesheet_reopen_after_payroll()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and old.status = 'LOCKED' and new.status <> 'LOCKED'
     and public.payroll_month_closed(old.month_start) then
    raise exception 'Kỳ lương tháng % đã khoá — không mở lại kỳ công được.',
      to_char(old.month_start, 'MM/YYYY') using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function public.guard_month_input_after_payroll()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_month date;
  v_json jsonb := to_jsonb(coalesce(new, old));
begin
  v_month := coalesce((v_json ->> 'period_month')::date, (v_json ->> 'month_start')::date);
  if v_month is not null and public.payroll_month_closed(v_month) then
    raise exception 'Kỳ lương tháng % đã khoá — dữ liệu của tháng này không sửa được nữa.',
      to_char(v_month, 'MM/YYYY') using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' then
    v_json := to_jsonb(old);
    v_month := coalesce((v_json ->> 'period_month')::date, (v_json ->> 'month_start')::date);
    if v_month is not null and public.payroll_month_closed(v_month) then
      raise exception 'Kỳ lương tháng % đã khoá — dữ liệu của tháng này không sửa được nữa.',
        to_char(v_month, 'MM/YYYY') using errcode = '23514';
    end if;
  end if;
  return coalesce(new, old);
end;
$$;

create or replace function public.record_payroll_bank_export(
  p_run_id uuid, p_template_code text, p_rows integer, p_total numeric
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run public.payroll_runs%rowtype;
begin
  if auth.uid() is null or not public.can_function('admin.payroll') then
    raise exception 'Bạn không có quyền xuất file chi lương.' using errcode = '42501';
  end if;
  select * into v_run from public.payroll_runs where id = p_run_id;
  if v_run.status not in ('APPROVED', 'PAID') then
    raise exception 'Chỉ xuất file ngân hàng khi Ban Giám đốc đã ký duyệt chi.' using errcode = '23514';
  end if;
  perform public.add_payroll_approval_event('RUN', p_run_id, 'BANK_EXPORTED', null,
    jsonb_build_object('template', p_template_code, 'rows', p_rows, 'total', p_total));
  perform public.write_payroll_audit('salary.bank_export', 'payroll_run', p_run_id::text,
    format('Xuất file chi lương %s kỳ %s: %s dòng, tổng %s', p_template_code, to_char(v_run.month_start, 'MM/YYYY'),
      p_rows, replace(to_char(p_total, 'FM999,999,999,999,999'), ',', '.')),
    null);
end;
$$;

revoke all on function public.record_payroll_bank_export(uuid, text, integer, numeric) from public;
grant execute on function public.record_payroll_bank_export(uuid, text, integer, numeric) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. Phiếu của chính mình không hiện phần doanh nghiệp đóng thêm
-- ---------------------------------------------------------------------------
-- Như trước: phần doanh nghiệp chi không nằm trên phiếu của nhân viên. Trước
-- đây là loại dòng "doanh nghiệp chi"; nay là dòng chỉ để tính mang nhãn báo
-- cáo "doanh nghiệp đóng thêm".
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
    'lines', coalesce((
      select jsonb_agg(to_jsonb(l) order by l.sequence)
      from public.payslip_lines l
      where l.payslip_id = v_slip.id
        and l.kind <> 'EMPLOYER_COST'
        and not exists (
          select 1 from public.payroll_components c
          where c.code = l.code and c.report_tag = 'INSURANCE_EMPLOYER'
        )
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.get_my_payslip(date) from public;
grant execute on function public.get_my_payslip(date) to authenticated;

drop function if exists public.m06_tmp_payroll_strip_doc_refs(text);
drop function if exists public.m06_tmp_payroll_has_doc_refs(text);
drop function if exists public.m06_tmp_payroll_taxable_formula(uuid, uuid);
drop function if exists public.m06_tmp_payroll_is_param(text);
drop function if exists public.m06_tmp_payroll_template_start(uuid);
drop function if exists public.m06_tmp_payroll_insurance_formula(text);
drop function if exists public.m06_tmp_payroll_employer_insurance_formula(text);
drop function if exists public.m06_tmp_payroll_own_days(text, numeric);
drop table if exists _m06_formula_ctx;
drop table if exists _m06_unit_tree;
drop table if exists _m06_old_base;
drop table if exists _m06_person_tpl;
end
$mig$;
