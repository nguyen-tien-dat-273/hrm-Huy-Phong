-- ============================================================================
-- M06 · F06.02 — Tham số & công thức tính lương theo NGÀY HIỆU LỰC.
-- ----------------------------------------------------------------------------
-- Đặc tả F06.02 (biểu đồ Use Case): "Tuyệt đối không hard-code các con số
-- pháp lý trong phần mềm. Tham số phải được quản lý theo ngày bắt đầu hiệu
-- lực (Effective Date)". Hiện trạng trái cả hai vế:
--
--   * `payroll_settings` là bảng MỘT DÒNG, `pit_brackets` một bộ duy nhất,
--     `payroll_named_params` không có ngày hiệu lực. Sửa tỷ lệ bảo hiểm hôm nay
--     là kỳ lương tháng trước (chưa chốt) tính lại theo số mới.
--   * Client còn giữ bộ số luật định làm "mặc định" (DEFAULT_PAYROLL_SETTINGS,
--     PIT_BRACKETS, ngưỡng 14 ngày nghỉ không đóng bảo hiểm...) và rơi về đó
--     khi database thiếu — tức là con số pháp lý vẫn nằm trong code.
--
-- Bảng mới `payroll_param_versions`: MỖI DÒNG là trọn một bộ tham số có hiệu
-- lực từ ngày đầu một tháng. Kỳ lương tháng M dùng bộ có `effective_from` lớn
-- nhất mà ≤ M. Bộ nào đã dùng cho kỳ lương ĐÃ CHỐT thì khoá, muốn đổi phải
-- tạo bộ mới — quá khứ không bị sửa ngược.
--
-- Một bộ gồm: tham số luật định (công chuẩn, bảo hiểm hai phía, KPCĐ, trần
-- đóng, giảm trừ gia cảnh, lương cơ sở / tối thiểu vùng), biểu thuế lũy tiến,
-- tham số công ty dùng trong công thức (hệ số OT, đơn giá phạt, tỷ lệ trích
-- quỹ...) và BIỂU BẬC THANG (hoa hồng khoán BL 02 – BR-PAY-004). Biểu bậc
-- thang gọi được như một hàm trong công thức: `HH_BL02(TY_LE_DAT)`.
--
-- Công thức theo KHỐI (BL 01 cho Văn phòng/Kho/Vận chuyển, BL 02 cho Kinh
-- doanh — BR-PAY-002/004) là `payroll_templates`: một mẫu bảng lương gồm các
-- khoản và công thức riêng, gán cho đơn vị trên cây tổ chức. Người trong đơn
-- vị con THỪA HƯỞNG mẫu của đơn vị gần nhất phía trên — cùng quy ước cây mà
-- KPI đang dùng (`kpi_scheme_for`, migration 20261001140000).
--
-- Chạy lại được nhiều lần.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Bộ tham số theo ngày hiệu lực
-- ---------------------------------------------------------------------------
create table if not exists public.payroll_param_versions (
  id uuid primary key default gen_random_uuid(),
  effective_from date not null unique,
  label text,
  note text,

  standard_work_days numeric(5, 2) not null,

  social_insurance_rate numeric(5, 2) not null,
  health_insurance_rate numeric(5, 2) not null,
  unemployment_insurance_rate numeric(5, 2) not null,
  employer_social_rate numeric(5, 2) not null,
  employer_health_rate numeric(5, 2) not null,
  employer_unemployment_rate numeric(5, 2) not null,
  /* Kinh phí công đoàn doanh nghiệp đóng (FR06.02.03). 0 = không tự tính. */
  employer_union_fund_rate numeric(5, 2) not null default 0,

  insurance_salary_cap numeric(15, 2) not null,
  unemployment_salary_cap numeric(15, 2) not null,

  tax_personal_deduction numeric(15, 2) not null,
  tax_dependent_deduction numeric(15, 2) not null,

  base_salary_level numeric(15, 2) not null,
  regional_minimum_wage numeric(15, 2) not null,
  region_code text not null,

  /* Thuế khấu trừ thẳng cho hợp đồng dưới 3 tháng. */
  flat_tax_rate numeric(5, 2) not null,
  /* Số ngày nghỉ không lương trong tháng từ đó trở lên thì tháng đó không đóng
     bảo hiểm (Luật BHXH). Trước đây là hằng số trong code. */
  unpaid_days_waive_insurance numeric(5, 2) not null,
  /* Làm tròn thực lĩnh (FR06.04.01: tới hàng nghìn). */
  net_rounding_unit integer not null,
  net_rounding_mode text not null,

  /* [{upper_bound: số | null, rate: %}] — bậc cuối để null. */
  pit_brackets jsonb not null,
  /* [{code, name, value, unit, group, note}] — mã dùng thẳng trong công thức. */
  named_params jsonb not null default '[]'::jsonb,
  /* [{code, name, input_label, unit, note, rows: [{from, value}]}] */
  tier_tables jsonb not null default '[]'::jsonb,

  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint payroll_param_versions_first_day
    check (effective_from = date_trunc('month', effective_from)::date),
  constraint payroll_param_versions_standard_days
    check (standard_work_days > 0 and standard_work_days <= 31),
  constraint payroll_param_versions_rates check (
    social_insurance_rate between 0 and 100
    and health_insurance_rate between 0 and 100
    and unemployment_insurance_rate between 0 and 100
    and employer_social_rate between 0 and 100
    and employer_health_rate between 0 and 100
    and employer_unemployment_rate between 0 and 100
    and employer_union_fund_rate between 0 and 100
    and flat_tax_rate between 0 and 100
    and social_insurance_rate + health_insurance_rate + unemployment_insurance_rate <= 100
  ),
  constraint payroll_param_versions_amounts check (
    insurance_salary_cap >= 0 and unemployment_salary_cap >= 0
    and tax_personal_deduction >= 0 and tax_dependent_deduction >= 0
    and base_salary_level > 0 and regional_minimum_wage > 0
  ),
  constraint payroll_param_versions_region check (region_code in ('I', 'II', 'III', 'IV')),
  constraint payroll_param_versions_unpaid_days
    check (unpaid_days_waive_insurance > 0 and unpaid_days_waive_insurance <= 31),
  constraint payroll_param_versions_rounding check (
    net_rounding_unit in (1, 10, 100, 1000, 10000)
    and net_rounding_mode in ('NEAREST', 'DOWN', 'UP')
  ),
  constraint payroll_param_versions_json_shape check (
    jsonb_typeof(pit_brackets) = 'array'
    and jsonb_typeof(named_params) = 'array'
    and jsonb_typeof(tier_tables) = 'array'
  )
);

create index if not exists payroll_param_versions_effective_idx
  on public.payroll_param_versions(effective_from desc);

comment on table public.payroll_param_versions is
  'Bộ tham số lương theo ngày hiệu lực (F06.02). Kỳ M dùng bộ có effective_from lớn nhất ≤ M.';

-- Tên đã có nghĩa riêng trong engine / bộ đánh giá công thức. Tham số tự khai
-- trùng một trong các tên này sẽ ĐÈ biến hệ thống (ví dụ một tham số tên
-- BASE_WORK làm mọi khoản tính trên lương thời gian ra sai) — chặn ngay ở đây.
create or replace function public.payroll_reserved_formula_names()
returns text[]
language sql
immutable
as $$
  select array[
    'BASE', 'BASE_WORK', 'BASE_LEAVE', 'BASE_HOLIDAY', 'GROSS', 'MUC_RIENG',
    'HOURLY_RATE', 'DAILY_RATE', 'MONTHLY_RATE', 'WORK_DAYS', 'LEAVE_DAYS', 'HOLIDAY_DAYS',
    'PAID_DAYS', 'STANDARD_DAYS', 'WORK_HOURS', 'HOURS_PER_DAY', 'DEPENDENTS',
    'LATE_MINUTES', 'LATE_COUNT', 'LATE_AFTER_CUTOFF', 'EARLY_MINUTES', 'EARLY_COUNT',
    'INSURANCE_BASE', 'INSURANCE_EMPLOYEE', 'PIT', 'TAXABLE_INCOME',
    'ADJ_RECOVERY', 'ADJ_CLAWBACK', 'KPI_TARGET', 'KPI_PCT',
    'MIN', 'MAX', 'ROUND', 'FLOOR', 'CEIL', 'ABS', 'IF'
  ]::text[];
$$;

grant execute on function public.payroll_reserved_formula_names() to authenticated;

-- Kiểm tra phần JSON của một bộ tham số. CHECK chỉ thấy được kiểu "là mảng",
-- còn bậc thuế tăng dần hay mã trùng nhau thì phải đi từng phần tử.
create or replace function public.validate_payroll_param_version()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_item jsonb;
  v_row jsonb;
  v_idx integer := 0;
  v_count integer;
  v_prev numeric := 0;
  v_rate numeric;
  v_code text;
  v_codes text[] := '{}';
  v_reserved text[] := public.payroll_reserved_formula_names();
  v_from numeric;
  v_prev_from numeric;
begin
  v_count := jsonb_array_length(new.pit_brackets);
  if v_count = 0 then
    raise exception 'Biểu thuế phải có ít nhất một bậc.' using errcode = '23514';
  end if;

  for v_item in select value from jsonb_array_elements(new.pit_brackets)
  loop
    v_idx := v_idx + 1;
    if jsonb_typeof(v_item -> 'rate') is distinct from 'number' then
      raise exception 'Bậc thuế % chưa có thuế suất.', v_idx using errcode = '23514';
    end if;
    v_rate := (v_item ->> 'rate')::numeric;
    if v_rate < 0 or v_rate > 100 then
      raise exception 'Thuế suất bậc % phải từ 0 đến 100%%.', v_idx using errcode = '23514';
    end if;

    if v_idx < v_count then
      if jsonb_typeof(v_item -> 'upper_bound') is distinct from 'number' then
        raise exception 'Bậc thuế % phải có cận trên — chỉ bậc cuối được để trống.', v_idx using errcode = '23514';
      end if;
      if (v_item ->> 'upper_bound')::numeric <= v_prev then
        raise exception 'Các bậc thuế phải tăng dần (bậc %).', v_idx using errcode = '23514';
      end if;
      v_prev := (v_item ->> 'upper_bound')::numeric;
    elsif jsonb_typeof(v_item -> 'upper_bound') is not null
      and jsonb_typeof(v_item -> 'upper_bound') <> 'null' then
      raise exception 'Bậc thuế cuối phải để trống cận trên, nếu không phần thu nhập vượt bậc cuối sẽ không bị tính thuế.'
        using errcode = '23514';
    end if;
  end loop;

  for v_item in select value from jsonb_array_elements(new.named_params)
  loop
    v_code := v_item ->> 'code';
    if v_code is null or v_code !~ '^[A-Z][A-Z0-9_]*$' then
      raise exception 'Mã tham số "%" không hợp lệ (viết hoa không dấu, bắt đầu bằng chữ).', coalesce(v_code, '')
        using errcode = '23514';
    end if;
    if v_code = any(v_reserved) then
      raise exception 'Mã "%" trùng tên biến hệ thống — đặt mã khác.', v_code using errcode = '23514';
    end if;
    if v_code = any(v_codes) then
      raise exception 'Mã tham số "%" bị khai hai lần.', v_code using errcode = '23505';
    end if;
    if coalesce(trim(v_item ->> 'name'), '') = '' then
      raise exception 'Tham số "%" chưa có tên.', v_code using errcode = '23514';
    end if;
    if jsonb_typeof(v_item -> 'value') is distinct from 'number' then
      raise exception 'Giá trị tham số "%" phải là số.', v_code using errcode = '23514';
    end if;
    v_codes := array_append(v_codes, v_code);
  end loop;

  for v_item in select value from jsonb_array_elements(new.tier_tables)
  loop
    v_code := v_item ->> 'code';
    if v_code is null or v_code !~ '^[A-Z][A-Z0-9_]*$' then
      raise exception 'Mã biểu bậc thang "%" không hợp lệ.', coalesce(v_code, '') using errcode = '23514';
    end if;
    if v_code = any(v_reserved) or v_code = any(v_codes) then
      raise exception 'Mã biểu bậc thang "%" trùng tham số hoặc tên hệ thống.', v_code using errcode = '23505';
    end if;
    if coalesce(trim(v_item ->> 'name'), '') = '' then
      raise exception 'Biểu bậc thang "%" chưa có tên.', v_code using errcode = '23514';
    end if;
    if jsonb_typeof(v_item -> 'rows') is distinct from 'array' or jsonb_array_length(v_item -> 'rows') = 0 then
      raise exception 'Biểu bậc thang "%" phải có ít nhất một mức.', v_code using errcode = '23514';
    end if;
    v_prev_from := null;
    for v_row in select value from jsonb_array_elements(v_item -> 'rows')
    loop
      if jsonb_typeof(v_row -> 'from') is distinct from 'number' or jsonb_typeof(v_row -> 'value') is distinct from 'number' then
        raise exception 'Mỗi mức của biểu "%" phải có ngưỡng và giá trị là số.', v_code using errcode = '23514';
      end if;
      v_from := (v_row ->> 'from')::numeric;
      if v_prev_from is not null and v_from <= v_prev_from then
        raise exception 'Ngưỡng của biểu "%" phải tăng dần, không trùng nhau.', v_code using errcode = '23514';
      end if;
      v_prev_from := v_from;
    end loop;
    v_codes := array_append(v_codes, v_code);
  end loop;

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

-- Không sửa ngược quá khứ: bộ nào có hiệu lực từ một tháng đã chốt lương trở
-- về trước thì khoá; bộ mới phải bắt đầu SAU kỳ đã chốt gần nhất.
create or replace function public.guard_payroll_param_version_period()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_last date := public.payroll_last_closed_month();
begin
  if v_last is null then
    return coalesce(new, old);
  end if;

  if tg_op = 'INSERT' then
    if new.effective_from <= v_last then
      raise exception 'Kỳ lương tháng % đã chốt — bộ tham số mới phải có hiệu lực từ tháng % trở đi.',
        to_char(v_last, 'MM/YYYY'), to_char(v_last + interval '1 month', 'MM/YYYY')
        using errcode = '23514';
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if old.effective_from <= v_last then
      raise exception 'Bộ tham số hiệu lực từ % đã dùng cho kỳ lương đã chốt — không xoá được.',
        to_char(old.effective_from, 'MM/YYYY') using errcode = '23514';
    end if;
    return old;
  end if;

  if old.effective_from <= v_last and (
    (to_jsonb(new) - array['label', 'note', 'updated_at', 'updated_by'])
      is distinct from (to_jsonb(old) - array['label', 'note', 'updated_at', 'updated_by'])
  ) then
    raise exception 'Bộ tham số hiệu lực từ % đã dùng cho kỳ lương đã chốt (tới tháng %) — không sửa được. Tạo bộ mới hiệu lực từ tháng %.',
      to_char(old.effective_from, 'MM/YYYY'), to_char(v_last, 'MM/YYYY'),
      to_char(v_last + interval '1 month', 'MM/YYYY')
      using errcode = '23514';
  end if;
  if new.effective_from <> old.effective_from and new.effective_from <= v_last then
    raise exception 'Không dời ngày hiệu lực về kỳ lương đã chốt.' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists payroll_param_versions_period_guard on public.payroll_param_versions;
create trigger payroll_param_versions_period_guard
before insert or update or delete on public.payroll_param_versions
for each row execute function public.guard_payroll_param_version_period();

create or replace function public.audit_payroll_param_version()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_diff jsonb;
begin
  if tg_op = 'INSERT' then
    perform public.write_payroll_audit(
      'salary.params_create', 'payroll_param_version', new.id::text,
      format('Lưu bộ tham số lương hiệu lực từ %s', to_char(new.effective_from, 'MM/YYYY')),
      jsonb_build_object('after', to_jsonb(new))
    );
    return new;
  end if;
  if tg_op = 'DELETE' then
    perform public.write_payroll_audit(
      'salary.params_delete', 'payroll_param_version', old.id::text,
      format('Xoá bộ tham số lương hiệu lực từ %s', to_char(old.effective_from, 'MM/YYYY')),
      jsonb_build_object('before', to_jsonb(old))
    );
    return old;
  end if;
  v_diff := public.payroll_row_diff(to_jsonb(old), to_jsonb(new)) - 'updated_by';
  if v_diff <> '{}'::jsonb then
    perform public.write_payroll_audit(
      'salary.params_update', 'payroll_param_version', new.id::text,
      format('Sửa bộ tham số lương hiệu lực từ %s', to_char(new.effective_from, 'MM/YYYY')),
      jsonb_build_object('changes', v_diff)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists payroll_param_versions_audit on public.payroll_param_versions;
create trigger payroll_param_versions_audit
after insert or update or delete on public.payroll_param_versions
for each row execute function public.audit_payroll_param_version();

-- Bộ tham số áp cho một tháng.
create or replace function public.payroll_param_version_for(p_month date)
returns public.payroll_param_versions
language sql
stable
security definer
set search_path = public
as $$
  select v.*
  from public.payroll_param_versions v
  where v.effective_from <= date_trunc('month', p_month)::date
  order by v.effective_from desc
  limit 1;
$$;

revoke all on function public.payroll_param_version_for(date) from public;
grant execute on function public.payroll_param_version_for(date) to authenticated;

alter table public.payroll_param_versions enable row level security;

-- ĐỌC mở cho mọi người đăng nhập, như `payroll_settings` trước đây: phiếu tạm
-- tính của nhân viên tính từ chính các con số quy định chung này. GHI chỉ
-- người có chức năng Tham số lương.
drop policy if exists payroll_param_versions_read on public.payroll_param_versions;
create policy payroll_param_versions_read on public.payroll_param_versions
for select to authenticated using (true);

drop policy if exists payroll_param_versions_manage on public.payroll_param_versions;
create policy payroll_param_versions_manage on public.payroll_param_versions
for all to authenticated
using (public.can_function('admin.payroll_settings'))
with check (public.can_function('admin.payroll_settings'));

grant select, insert, update, delete on public.payroll_param_versions to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Bộ tham số gốc: chép nguyên cấu hình hiện hành
-- ---------------------------------------------------------------------------
-- Hiệu lực từ 01/2000 để phủ mọi kỳ cũ — các kỳ đó trước giờ vẫn tính bằng
-- đúng những con số này. Bổ sung các tham số trước nằm trong code hoặc gõ cứng
-- vào công thức, MANG ĐÚNG GIÁ TRỊ đang dùng để số tiền không đổi:
--   - 14 ngày nghỉ không lương thì không đóng bảo hiểm (hằng số cũ trong code)
--   - 10% khấu trừ thẳng hợp đồng dưới 3 tháng (mặc định cũ trong code)
--   - SO_GIO_OT_MOI_NGAY = 2, HE_SO_OT_KHO_THUONG = 1, HE_SO_OT_KHO_LE = 2:
--     giữ đúng `HOURLY_RATE * OT_NGAY_LE * 2 * 2` đang chạy.
-- Riêng làm tròn thực lĩnh đặt hàng nghìn theo FR06.04.01, và KPCĐ để 0
-- (công ty đang gán khoản ER_UNION_FUND theo từng người — tự tính thêm ở đây
-- là đếm hai lần; khai tỷ lệ ở đây thì engine tự bỏ khoản trùng mã).
do $$
declare
  v_settings jsonb;
  v_brackets jsonb;
  v_params jsonb;
begin
  if exists (select 1 from public.payroll_param_versions) then
    return;
  end if;

  select to_jsonb(s) into v_settings from public.payroll_settings s limit 1;
  v_settings := coalesce(v_settings, '{}'::jsonb);

  select coalesce(jsonb_agg(jsonb_build_object('upper_bound', b.upper_bound, 'rate', b.rate) order by b.step), '[]'::jsonb)
  into v_brackets
  from public.pit_brackets b;

  if jsonb_array_length(v_brackets) = 0 then
    -- Không có biểu nào để chép (môi trường chưa chạy migration biểu thuế):
    -- dùng biểu đang ghi trong migration 20260928160000.
    v_brackets := '[
      {"upper_bound": 5000000, "rate": 5}, {"upper_bound": 10000000, "rate": 10},
      {"upper_bound": 18000000, "rate": 15}, {"upper_bound": 32000000, "rate": 20},
      {"upper_bound": 52000000, "rate": 25}, {"upper_bound": 80000000, "rate": 30},
      {"upper_bound": null, "rate": 35}]'::jsonb;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'code', p.code,
      'name', p.name,
      'value', p.value,
      'unit', p.unit,
      'group', case
        when p.code like 'HE_SO_OT%' or p.code = 'HE_SO_CA_DEM' then 'OT'
        when p.code like 'TY_LE_QUY%' then 'FUND'
        when p.code in ('HE_SO_DOANH_SO') then 'COMMISSION'
        else 'OTHER'
      end,
      'note', p.note
    ) order by p.sort_order, p.code), '[]'::jsonb)
  into v_params
  from public.payroll_named_params p
  where p.is_active;

  -- Tham số mới. Chỉ thêm mã chưa có.
  v_params := v_params || coalesce((
    select jsonb_agg(n.item)
    from (values
      (jsonb_build_object('code', 'SO_GIO_OT_MOI_NGAY', 'name', 'Số giờ tính cho mỗi ngày làm thêm (kho)', 'value', 2, 'unit', 'GIO', 'group', 'OT',
        'note', 'Giữ đúng công thức đang chạy (2 giờ/ngày). BR-PAY-003 ghi "1 đơn hàng ngoài giờ = 1 giờ" — KTT xác nhận.')),
      (jsonb_build_object('code', 'HE_SO_OT_KHO_THUONG', 'name', 'Hệ số làm thêm kho ngày thường', 'value', 1, 'unit', 'HE_SO', 'group', 'OT',
        'note', 'BR-PAY-003: hệ số ngày thường 1,0. Cần đối chiếu Điều 98 BLLĐ 2019 (tối thiểu 150%).')),
      (jsonb_build_object('code', 'HE_SO_OT_KHO_LE', 'name', 'Hệ số làm thêm kho Chủ nhật / lễ', 'value', 2, 'unit', 'HE_SO', 'group', 'OT',
        'note', 'BR-PAY-003: hệ số Chủ nhật/lễ 2,0. Cần đối chiếu Điều 98 BLLĐ 2019.')),
      (jsonb_build_object('code', 'DON_GIA_PHAT_DI_MUON', 'name', 'Đơn giá phạt mỗi lần đi muộn / về sớm', 'value', 0, 'unit', 'VND', 'group', 'PENALTY',
        'note', 'FR06.02.04. Chưa có số trong tài liệu — để 0 là chưa phạt. Lưu ý Điều 127 BLLĐ 2019.')),
      (jsonb_build_object('code', 'SO_LAN_DI_MUON_CHO_PHEP', 'name', 'Số lần đi muộn cho phép trong tháng', 'value', 0, 'unit', 'LAN', 'group', 'PENALTY',
        'note', 'Vượt số lần này mới tính "Phạt đi muộn quá số lần".')),
      (jsonb_build_object('code', 'DON_GIA_PHAT_DI_MUON_QUA_LAN', 'name', 'Đơn giá phạt mỗi lần đi muộn vượt mức', 'value', 0, 'unit', 'VND', 'group', 'PENALTY',
        'note', 'FR06.02.04. Chưa có số trong tài liệu.')),
      (jsonb_build_object('code', 'DON_GIA_PHAT_BAO_CAO', 'name', 'Đơn giá phạt mỗi lần không làm báo cáo / kế hoạch', 'value', 0, 'unit', 'VND', 'group', 'PENALTY',
        'note', 'FR06.02.04. Chưa có số trong tài liệu.')),
      (jsonb_build_object('code', 'TY_LE_HH_CAT_MA', 'name', 'Tỷ lệ hoa hồng trên doanh số cắt mã', 'value', 1, 'unit', '%', 'group', 'COMMISSION',
        'note', 'BR-PAY-004: cộng 1% doanh số cắt mã.')),
      (jsonb_build_object('code', 'TY_LE_HH_CAT_LO', 'name', 'Tỷ lệ hoa hồng trên doanh số thu cắt lô (>40%)', 'value', 1, 'unit', '%', 'group', 'COMMISSION',
        'note', 'BR-PAY-004: cộng 1% doanh số thu cắt lô.')),
      (jsonb_build_object('code', 'NGUONG_THUONG_VUOT', 'name', 'Ngưỡng tỷ lệ đạt doanh số để thưởng vượt', 'value', 150, 'unit', '%', 'group', 'COMMISSION',
        'note', 'BR-PAY-004: R > 150% → thưởng vượt theo quy chế.')),
      (jsonb_build_object('code', 'MUC_THUONG_VUOT', 'name', 'Mức thưởng doanh số vượt ngưỡng', 'value', 0, 'unit', 'VND', 'group', 'COMMISSION',
        'note', 'BR-PAY-004 ghi "theo quy chế" — chưa có số, để 0.'))
    ) as n(item)
    where not exists (
      select 1 from jsonb_array_elements(v_params) e where e ->> 'code' = n.item ->> 'code'
    )
  ), '[]'::jsonb);

  insert into public.payroll_param_versions (
    effective_from, label, note,
    standard_work_days,
    social_insurance_rate, health_insurance_rate, unemployment_insurance_rate,
    employer_social_rate, employer_health_rate, employer_unemployment_rate, employer_union_fund_rate,
    insurance_salary_cap, unemployment_salary_cap,
    tax_personal_deduction, tax_dependent_deduction,
    base_salary_level, regional_minimum_wage, region_code,
    flat_tax_rate, unpaid_days_waive_insurance, net_rounding_unit, net_rounding_mode,
    pit_brackets, named_params, tier_tables, created_by
  ) values (
    '2000-01-01', 'Bộ tham số gốc',
    'Chép nguyên từ Tham số lương trước khi có phiên bản theo ngày hiệu lực. Muốn đổi số từ một kỳ cụ thể thì tạo bộ mới hiệu lực từ kỳ đó.',
    coalesce((v_settings ->> 'standard_work_days')::numeric, 26),
    coalesce((v_settings ->> 'social_insurance_rate')::numeric, 8),
    coalesce((v_settings ->> 'health_insurance_rate')::numeric, 1.5),
    coalesce((v_settings ->> 'unemployment_insurance_rate')::numeric, 1),
    coalesce((v_settings ->> 'employer_social_rate')::numeric, 17.5),
    coalesce((v_settings ->> 'employer_health_rate')::numeric, 3),
    coalesce((v_settings ->> 'employer_unemployment_rate')::numeric, 1),
    0,
    coalesce((v_settings ->> 'insurance_salary_cap')::numeric, 46800000),
    coalesce((v_settings ->> 'unemployment_salary_cap')::numeric, 99200000),
    coalesce((v_settings ->> 'tax_personal_deduction')::numeric, 11000000),
    coalesce((v_settings ->> 'tax_dependent_deduction')::numeric, 4400000),
    coalesce((v_settings ->> 'base_salary_level')::numeric, 2340000),
    coalesce((v_settings ->> 'regional_minimum_wage')::numeric, 4960000),
    coalesce(v_settings ->> 'region_code', 'I'),
    10, 14, 1000, 'NEAREST',
    v_brackets,
    v_params,
    '[{"code": "HH_BL02",
       "name": "Hoa hồng khoán doanh thu bậc thang (BL 02)",
       "input_label": "Tỷ lệ doanh số đạt / doanh số khoán (%)",
       "unit": "%",
       "note": "BR-PAY-004. Mỗi mức áp từ ngưỡng của nó tới ngay dưới ngưỡng kế tiếp — đặc tả để ngỏ khoảng 89–90% và 104–105%, KTT xác nhận.",
       "rows": [{"from": 0, "value": 0}, {"from": 75, "value": 1.5}, {"from": 90, "value": 3}, {"from": 105, "value": 4}]}]'::jsonb,
    null
  );
end $$;

comment on table public.payroll_settings is
  'ĐÃ THAY bằng payroll_param_versions (migration 20261013110000). Giữ lại để bản client cũ còn đọc được trong quãng deploy; không còn nguồn nào ghi.';
comment on table public.pit_brackets is
  'ĐÃ THAY bằng payroll_param_versions.pit_brackets (migration 20261013110000).';
comment on table public.payroll_named_params is
  'ĐÃ THAY bằng payroll_param_versions.named_params (migration 20261013110000).';

-- ---------------------------------------------------------------------------
-- 3. Mẫu bảng lương theo khối (BL 01 / BL 02)
-- ---------------------------------------------------------------------------
create table if not exists public.payroll_templates (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z][A-Z0-9_]*$'),
  name text not null check (length(trim(name)) > 0),
  description text,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.payroll_template_items (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.payroll_templates(id) on delete cascade,
  component_id uuid not null references public.payroll_components(id) on delete cascade,
  /* Mức mặc định của khoản trong mẫu. NULL = theo danh mục / khai từng người. */
  amount numeric(15, 2) check (amount is null or amount >= 0),
  formula text check (formula is null or length(formula) <= 2000),
  taxable boolean,
  insurable boolean,
  effective_from date not null,
  effective_to date,
  note text,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payroll_template_items_first_day
    check (effective_from = date_trunc('month', effective_from)::date),
  constraint payroll_template_items_range
    check (effective_to is null or effective_to >= effective_from),
  unique (template_id, component_id, effective_from)
);

create index if not exists payroll_template_items_template_idx
  on public.payroll_template_items(template_id, effective_from desc);

-- Mẫu nào áp cho đơn vị nào, từ tháng nào. template_id NULL = đơn vị này
-- KHÔNG dùng mẫu (chặn thừa hưởng từ cấp trên).
create table if not exists public.unit_payroll_templates (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references public.organization_units(id) on delete cascade,
  template_id uuid references public.payroll_templates(id) on delete restrict,
  effective_from date not null,
  note text,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint unit_payroll_templates_first_day
    check (effective_from = date_trunc('month', effective_from)::date),
  unique (unit_id, effective_from)
);

create index if not exists unit_payroll_templates_unit_idx
  on public.unit_payroll_templates(unit_id, effective_from desc);

-- Mẫu gán RIÊNG cho một người (ví dụ nhân viên kinh doanh ngồi ở phòng hành
-- chính). NULL = theo mẫu của đơn vị trên cây. Khai qua Cơ chế lương (F06.03).
alter table public.employee_pay_profiles
  add column if not exists template_id uuid references public.payroll_templates(id) on delete restrict;

comment on column public.employee_pay_profiles.template_id is
  'Mẫu bảng lương gán riêng cho người này. NULL = thừa hưởng mẫu của đơn vị gần nhất trên cây tổ chức.';

drop trigger if exists payroll_template_items_assignable on public.payroll_template_items;
create trigger payroll_template_items_assignable
before insert or update of component_id on public.payroll_template_items
for each row execute function public.guard_assignable_payroll_component();

do $do$
declare
  t text;
begin
  foreach t in array array['payroll_templates', 'payroll_template_items', 'unit_payroll_templates'] loop
    execute format('drop trigger if exists %I_touch on public.%I', t, t);
    execute format(
      'create trigger %I_touch before update on public.%I
       for each row execute function public.touch_payroll_updated_at()', t, t);
  end loop;
end;
$do$;

-- Mẫu đang áp cho một người vào một tháng, theo CÂY tổ chức: đơn vị gần nhất
-- phía trên có khai thì thắng (cùng quy ước với `kpi_scheme_for`). Bản client
-- giải giống hệt ở `lib/payrollScheme.ts`.
create or replace function public.payroll_template_for(p_user uuid, p_month date)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  with recursive lineage as (
    select u.id, u.parent_id, 1 as depth
    from public.organization_units u
    join public.profiles p on p.id = p_user
    where u.id = p.unit_id
    union all
    select parent.id, parent.parent_id, child.depth + 1
    from lineage child
    join public.organization_units parent on parent.id = child.parent_id
    where child.depth < 10
  ),
  personal as (
    select pp.template_id
    from public.employee_pay_profiles pp
    where pp.user_id = p_user
      and pp.effective_from <= (date_trunc('month', p_month) + interval '1 month - 1 day')::date
    order by pp.effective_from desc
    limit 1
  )
  select coalesce(
    (select template_id from personal),
    (
      select a.template_id
      from public.unit_payroll_templates a
      join lineage l on l.id = a.unit_id
      where a.effective_from <= date_trunc('month', p_month)::date
      order by l.depth asc, a.effective_from desc
      limit 1
    )
  );
$$;

revoke all on function public.payroll_template_for(uuid, date) from public;
grant execute on function public.payroll_template_for(uuid, date) to authenticated;

-- Ghi một khoản của mẫu theo kiểu PHIÊN BẢN: từ tháng p_effective_from khoản
-- mang giá trị mới, các tháng trước giữ giá trị cũ.
create or replace function public.save_payroll_template_item(
  p_template_id uuid,
  p_component_id uuid,
  p_effective_from date,
  p_amount numeric,
  p_formula text,
  p_taxable boolean,
  p_insurable boolean,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_last date := public.payroll_last_closed_month();
  v_id uuid;
begin
  if auth.uid() is null or not public.can_function('admin.payroll_settings') then
    raise exception 'Bạn không có quyền cấu hình công thức lương.' using errcode = '42501';
  end if;
  if p_effective_from is null or p_effective_from <> date_trunc('month', p_effective_from)::date then
    raise exception 'Ngày hiệu lực phải là ngày đầu tháng.' using errcode = '22023';
  end if;
  if v_last is not null and p_effective_from <= v_last then
    raise exception 'Kỳ lương tháng % đã chốt — thay đổi phải có hiệu lực từ tháng % trở đi.',
      to_char(v_last, 'MM/YYYY'), to_char(v_last + interval '1 month', 'MM/YYYY') using errcode = '23514';
  end if;
  if p_amount is not null and p_amount < 0 then
    raise exception 'Mức tiền không được âm.' using errcode = '23514';
  end if;
  if exists (
    select 1 from public.payroll_template_items i
    where i.template_id = p_template_id and i.component_id = p_component_id
      and i.effective_from > p_effective_from
  ) then
    raise exception 'Khoản này đã có thay đổi hiệu lực từ tháng sau — sửa hoặc bỏ thay đổi đó trước.'
      using errcode = '23514';
  end if;

  update public.payroll_template_items
  set effective_to = (p_effective_from - interval '1 day')::date
  where template_id = p_template_id
    and component_id = p_component_id
    and effective_from < p_effective_from
    and (effective_to is null or effective_to >= p_effective_from);

  insert into public.payroll_template_items (
    template_id, component_id, amount, formula, taxable, insurable, effective_from, note
  ) values (
    p_template_id, p_component_id, p_amount, nullif(trim(coalesce(p_formula, '')), ''),
    p_taxable, p_insurable, p_effective_from, nullif(trim(coalesce(p_note, '')), '')
  )
  on conflict (template_id, component_id, effective_from) do update set
    amount = excluded.amount,
    formula = excluded.formula,
    taxable = excluded.taxable,
    insurable = excluded.insurable,
    note = excluded.note,
    effective_to = null
  returning id into v_id;

  perform public.write_payroll_audit(
    'salary.template_item_save', 'payroll_template', p_template_id::text,
    format('Khai khoản %s vào mẫu %s từ %s',
      (select code from public.payroll_components where id = p_component_id),
      (select code from public.payroll_templates where id = p_template_id),
      to_char(p_effective_from, 'MM/YYYY')),
    jsonb_build_object('amount', p_amount, 'formula', p_formula, 'taxable', p_taxable, 'insurable', p_insurable)
  );
  return v_id;
end;
$$;

revoke all on function public.save_payroll_template_item(uuid, uuid, date, numeric, text, boolean, boolean, text) from public;
grant execute on function public.save_payroll_template_item(uuid, uuid, date, numeric, text, boolean, boolean, text) to authenticated;

-- Bỏ một khoản khỏi mẫu từ tháng p_effective_from (các tháng trước vẫn có).
create or replace function public.end_payroll_template_item(
  p_template_id uuid,
  p_component_id uuid,
  p_effective_from date
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
    raise exception 'Bạn không có quyền cấu hình công thức lương.' using errcode = '42501';
  end if;
  if p_effective_from is null or p_effective_from <> date_trunc('month', p_effective_from)::date then
    raise exception 'Ngày hiệu lực phải là ngày đầu tháng.' using errcode = '22023';
  end if;
  if v_last is not null and p_effective_from <= v_last then
    raise exception 'Kỳ lương tháng % đã chốt — chỉ bỏ khoản từ tháng % trở đi.',
      to_char(v_last, 'MM/YYYY'), to_char(v_last + interval '1 month', 'MM/YYYY') using errcode = '23514';
  end if;

  delete from public.payroll_template_items
  where template_id = p_template_id and component_id = p_component_id
    and effective_from >= p_effective_from;

  update public.payroll_template_items
  set effective_to = (p_effective_from - interval '1 day')::date
  where template_id = p_template_id and component_id = p_component_id
    and effective_from < p_effective_from
    and (effective_to is null or effective_to >= p_effective_from);

  perform public.write_payroll_audit(
    'salary.template_item_end', 'payroll_template', p_template_id::text,
    format('Bỏ khoản %s khỏi mẫu %s từ %s',
      (select code from public.payroll_components where id = p_component_id),
      (select code from public.payroll_templates where id = p_template_id),
      to_char(p_effective_from, 'MM/YYYY')),
    null
  );
end;
$$;

revoke all on function public.end_payroll_template_item(uuid, uuid, date) from public;
grant execute on function public.end_payroll_template_item(uuid, uuid, date) to authenticated;

-- Gán (hoặc bỏ gán bằng p_template_id = NULL) mẫu cho một khối / đơn vị.
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
    raise exception 'Bạn không có quyền cấu hình công thức lương.' using errcode = '42501';
  end if;
  if p_effective_from is null or p_effective_from <> date_trunc('month', p_effective_from)::date then
    raise exception 'Ngày hiệu lực phải là ngày đầu tháng.' using errcode = '22023';
  end if;
  if v_last is not null and p_effective_from <= v_last then
    raise exception 'Kỳ lương tháng % đã chốt — đổi mẫu phải có hiệu lực từ tháng % trở đi.',
      to_char(v_last, 'MM/YYYY'), to_char(v_last + interval '1 month', 'MM/YYYY') using errcode = '23514';
  end if;
  if p_template_id is not null and not exists (
    select 1 from public.payroll_templates t where t.id = p_template_id and t.is_active
  ) then
    raise exception 'Mẫu bảng lương không tồn tại hoặc đã ngừng dùng.' using errcode = '23503';
  end if;
  if exists (
    select 1 from public.unit_payroll_templates a
    where a.unit_id = p_unit_id and a.effective_from > p_effective_from
  ) then
    raise exception 'Đơn vị này đã có thay đổi mẫu từ tháng sau — sửa thay đổi đó trước.' using errcode = '23514';
  end if;

  insert into public.unit_payroll_templates (unit_id, template_id, effective_from, note)
  values (p_unit_id, p_template_id, p_effective_from, nullif(trim(coalesce(p_note, '')), ''))
  on conflict (unit_id, effective_from) do update set
    template_id = excluded.template_id,
    note = excluded.note;

  perform public.write_payroll_audit(
    'salary.template_assign', 'organization_unit', p_unit_id::text,
    format('%s %s cho %s từ %s',
      case when p_template_id is null then 'Bỏ áp mẫu bảng lương' else 'Áp mẫu' end,
      coalesce((select code from public.payroll_templates where id = p_template_id), ''),
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
      format('Tạo mẫu bảng lương %s — %s', new.code, new.name), null);
    return new;
  elsif tg_op = 'DELETE' then
    perform public.write_payroll_audit('salary.template_delete', 'payroll_template', old.id::text,
      format('Xoá mẫu bảng lương %s — %s', old.code, old.name), null);
    return old;
  end if;
  if public.payroll_row_diff(to_jsonb(old), to_jsonb(new)) <> '{}'::jsonb then
    perform public.write_payroll_audit('salary.template_update', 'payroll_template', new.id::text,
      format('Sửa mẫu bảng lương %s — %s', new.code, new.name),
      jsonb_build_object('changes', public.payroll_row_diff(to_jsonb(old), to_jsonb(new))));
  end if;
  return new;
end;
$$;

drop trigger if exists payroll_templates_audit on public.payroll_templates;
create trigger payroll_templates_audit
after insert or update or delete on public.payroll_templates
for each row execute function public.audit_payroll_template();

-- Mẫu đã gán cho đơn vị hoặc cho người thì không xoá (kỳ cũ còn tra về nó),
-- chỉ ngừng dùng.
create or replace function public.guard_payroll_template_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.unit_payroll_templates a where a.template_id = old.id)
     or exists (select 1 from public.employee_pay_profiles p where p.template_id = old.id) then
    raise exception 'Mẫu "%" đang / đã gán cho đơn vị hoặc nhân sự — chuyển Ngừng dùng thay vì xoá.', old.name
      using errcode = '23503';
  end if;
  return old;
end;
$$;

drop trigger if exists payroll_templates_delete_guard on public.payroll_templates;
create trigger payroll_templates_delete_guard
before delete on public.payroll_templates
for each row execute function public.guard_payroll_template_delete();

alter table public.payroll_templates enable row level security;
alter table public.payroll_template_items enable row level security;
alter table public.unit_payroll_templates enable row level security;

-- Đọc mở cho người đăng nhập, như `unit_pay_items`: phiếu tạm tính của nhân
-- viên cần đúng công thức của khối mình. Đây là quy chế chung, không phải số
-- lương riêng của ai.
drop policy if exists payroll_templates_read on public.payroll_templates;
create policy payroll_templates_read on public.payroll_templates
for select to authenticated using (true);
drop policy if exists payroll_templates_manage on public.payroll_templates;
create policy payroll_templates_manage on public.payroll_templates
for all to authenticated
using (public.can_function('admin.payroll_settings'))
with check (public.can_function('admin.payroll_settings'));

drop policy if exists payroll_template_items_read on public.payroll_template_items;
create policy payroll_template_items_read on public.payroll_template_items
for select to authenticated using (true);

drop policy if exists unit_payroll_templates_read on public.unit_payroll_templates;
create policy unit_payroll_templates_read on public.unit_payroll_templates
for select to authenticated using (true);

grant select, insert, update, delete on public.payroll_templates to authenticated;
-- Khoản của mẫu và việc gán mẫu chỉ ghi qua RPC phía trên: ghi thẳng thì
-- không còn ai giữ quy tắc "đóng phiên bản cũ, mở phiên bản mới".
grant select on public.payroll_template_items, public.unit_payroll_templates to authenticated;
revoke insert, update, delete on public.payroll_template_items, public.unit_payroll_templates from authenticated, anon;

-- Hai mẫu theo đặc tả. Chỉ tạo khung — khoản và công thức do KTT khai (hoặc
-- nạp gợi ý theo BR-PAY bằng nút trên màn Công thức theo khối).
insert into public.payroll_templates (code, name, description, created_by)
values
  ('BL01', 'BL 01 — Khối Văn phòng / Kho / Vận chuyển',
   'BR-PAY-002: Lương thời gian = Bậc lương ÷ công chuẩn × ngày công; lương phép, lễ tương tự; Lương KPI = Bậc lương KPI × % KPI. Kho có làm thêm theo đơn hàng ngoài giờ, Vận chuyển có lương theo chuyến.',
   null),
  ('BL02', 'BL 02 — Khối Kinh doanh',
   'BR-PAY-004: hoa hồng khoán doanh thu bậc thang theo tỷ lệ doanh số đạt / doanh số khoán, cộng % doanh số cắt mã và doanh số thu cắt lô.',
   null)
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- 4. Nạp khoản gợi ý theo BR-PAY vào một mẫu (chỉ khi mẫu còn trống)
-- ---------------------------------------------------------------------------
-- Gợi ý là DỮ LIỆU ở đây, không nằm trong client. Công thức chỉ tham chiếu mã
-- tham số / biểu bậc thang của bộ tham số, không gõ cứng con số nào — đổi
-- chính sách là đổi tham số, không phải sửa công thức.
create or replace function public.seed_payroll_template_defaults(p_template_id uuid, p_effective_from date)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_template public.payroll_templates%rowtype;
  v_count integer := 0;
  v_item record;
begin
  if auth.uid() is null or not public.can_function('admin.payroll_settings') then
    raise exception 'Bạn không có quyền cấu hình công thức lương.' using errcode = '42501';
  end if;
  select * into v_template from public.payroll_templates where id = p_template_id;
  if v_template.id is null then
    raise exception 'Không tìm thấy mẫu bảng lương.' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.payroll_template_items where template_id = p_template_id) then
    raise exception 'Mẫu đã có khoản — chỉ nạp gợi ý cho mẫu còn trống.' using errcode = '23514';
  end if;

  for v_item in
    select c.id as component_id, s.formula
    from (values
      ('ALL', 'LUONG_CO_BAN', null::text),
      ('ALL', 'LUONG_KPI', null),
      ('ALL', 'OT_WEEKDAY', 'HOURLY_RATE * HE_SO_OT_THUONG * OT_WEEKDAY_HOURS'),
      ('ALL', 'OT_WEEKEND', 'HOURLY_RATE * HE_SO_OT_NGHI * OT_WEEKEND_HOURS'),
      ('ALL', 'OT_HOLIDAY', 'HOURLY_RATE * HE_SO_OT_LE * OT_HOLIDAY_HOURS'),
      ('ALL', 'CONG_THEM_DEM', null),
      ('ALL', 'PHU_CAP_KHAC', null),
      ('ALL', 'THUONG_DI_SOM', 'TIEN_THUONG_DI_SOM'),
      ('ALL', 'THUONG_CTKM', 'TIEN_THUONG_CTKM'),
      ('ALL', 'THUONG_THANG', null),
      ('ALL', 'QUY_CONG_DOAN', '(BASE_WORK + LUONG_VAN_CHUYEN + LUONG_DOANH_SO) * TY_LE_QUY_1PT / 100'),
      ('ALL', 'ADVANCE', 'TIEN_TAM_UNG'),
      ('ALL', 'PHAT_DI_MUON_VE_SOM', '(LATE_COUNT + EARLY_COUNT) * DON_GIA_PHAT_DI_MUON'),
      ('ALL', 'PHAT_BAO_CAO', 'SO_LAN_THIEU_BAO_CAO * DON_GIA_PHAT_BAO_CAO'),
      ('ALL', 'PHAT_DI_MUON', 'MAX(LATE_COUNT - SO_LAN_DI_MUON_CHO_PHEP, 0) * DON_GIA_PHAT_DI_MUON_QUA_LAN'),
      ('BL01', 'LUONG_VAN_CHUYEN', null),
      ('BL01', 'LUONG_OT_THUONG', null),
      ('BL01', 'LUONG_OT_LE', null),
      ('BL02', 'LUONG_DOANH_SO',
        'IF(DOANH_SO_KHOAN > 0, DOANH_SO * HH_BL02(DOANH_SO / DOANH_SO_KHOAN * 100) / 100, 0) + DOANH_SO_CAT_MA * TY_LE_HH_CAT_MA / 100'),
      ('BL02', 'LUONG_DT_CAT_LO', 'DOANH_SO_THU_CAT_LO * TY_LE_HH_CAT_LO / 100'),
      ('BL02', 'THUONG_DOANH_SO_VUOT',
        'IF(DOANH_SO_KHOAN > 0 && DOANH_SO / DOANH_SO_KHOAN * 100 > NGUONG_THUONG_VUOT, MUC_THUONG_VUOT, 0)'),
      ('BL02', 'PC_CONG_TAC_TINH', null)
    ) as s(scope, code, formula)
    join public.payroll_components c on c.code = s.code and c.calc_source = 'ASSIGNED' and c.is_active
    where s.scope = 'ALL' or s.scope = v_template.code
  loop
    insert into public.payroll_template_items (template_id, component_id, formula, effective_from, note)
    values (p_template_id, v_item.component_id, v_item.formula, p_effective_from,
            'Gợi ý theo BR-PAY — KTT kiểm tra trước khi áp dụng.')
    on conflict (template_id, component_id, effective_from) do nothing;
    v_count := v_count + 1;
  end loop;

  perform public.write_payroll_audit(
    'salary.template_seed', 'payroll_template', p_template_id::text,
    format('Nạp %s khoản gợi ý theo BR-PAY vào mẫu %s', v_count, v_template.code), null);
  return v_count;
end;
$$;

revoke all on function public.seed_payroll_template_defaults(uuid, date) from public;
grant execute on function public.seed_payroll_template_defaults(uuid, date) to authenticated;
