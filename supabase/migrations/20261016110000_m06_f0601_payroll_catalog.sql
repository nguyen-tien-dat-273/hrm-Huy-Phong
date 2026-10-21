-- ============================================================================
-- M06 · F06.01 — Danh mục khoản lương & đãi ngộ theo đặc tả.
-- ----------------------------------------------------------------------------
-- Đặc tả F06.01 đòi bốn thứ mà danh mục hiện tại chưa có:
--
--   1. NĂM NHÓM BẮT BUỘC (BR-PAY-001): Thu nhập cố định, Thu nhập biến đổi,
--      Làm thêm giờ, Thưởng phát sinh, Khấu trừ & phạt. Hiện chỉ có `kind`
--      (cộng/trừ/chi phí DN) và `group_name` gõ tự do — không có gì bắt một
--      khoản phải thuộc đúng một nhóm.
--   2. TÍNH CHẤT khoản (Cố định định kỳ / Biến đổi theo hiệu suất, thời gian).
--   3. Khoản đã phát sinh trong kỳ lương ĐÃ CHỐT thì không được xoá, chỉ được
--      chuyển "Ngừng hoạt động" — hiện xoá cứng, và CASCADE kéo theo mọi
--      khoản đã gán cho người.
--   4. Ghi vết Audit Log cho thêm/sửa/xoá. Bảng `audit_logs` có từ lâu nhưng
--      không còn trigger nào ghi cho phần lương (trigger cũ nằm trên bảng
--      `salary_profiles` đã bị xoá ở migration 20260928150000).
--
-- Năm nhóm là BẢNG chứ không phải CHECK cứng, cùng cách `kpi_blocks` đã làm:
-- tên, mô tả, loại khoản cho phép nằm ở dữ liệu, client không giữ bản sao.
--
-- Danh mục chuẩn 26 khoản KHÔNG tự chèn khi chạy migration. Năm khoản trong
-- đó (lương thời gian / phép / lễ, bảo hiểm, thuế) do ENGINE tự tính; bản
-- client cũ chưa biết cột `calc_source` sẽ coi chúng là khoản thường và đặt
-- biến BASE_WORK về 0 — công đoàn phí tính trên BASE_WORK ra 0đ trong đúng
-- quãng deploy lệch nhịp. Nên chèn qua nút "Khởi tạo danh mục chuẩn" của màn
-- mới (RPC `seed_standard_payroll_catalog`), nơi client đã hiểu cột đó.
--
-- Chạy lại được nhiều lần.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. Hàm dùng chung cho cả phân hệ M06
-- ---------------------------------------------------------------------------

-- Người đang đăng nhập có BẤT KỲ chức năng lương nào không. Dùng cho quyền
-- ĐỌC cấu hình dùng chung (danh mục, nhóm, mẫu bảng lương): màn Cơ chế lương
-- hay Số liệu tháng đều cần danh mục, không riêng người quản danh mục.
create or replace function public.can_payroll()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.can_function('admin.payroll')
      or public.can_function('admin.payroll_schemes')
      or public.can_function('admin.payroll_inputs')
      or public.can_function('admin.payroll_components')
      or public.can_function('admin.payroll_settings')
      or public.can_function('admin.payroll_adjustments')
      or public.can_function('admin.payroll_approve');
$$;

revoke all on function public.can_payroll() from public;
grant execute on function public.can_payroll() to authenticated;

-- Một người BẤT KỲ (không phải người đang đăng nhập) có chức năng này không.
-- `can_function` chỉ trả lời cho auth.uid(); tìm người duyệt để gửi thông báo
-- thì phải hỏi cho người khác. Cùng bốn nguồn quyền như `can_function`.
create or replace function public.profile_has_function(p_user uuid, p_function text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = p_user
      and p.is_active
      and (
        p.role in ('admin', 'ceo')
        or exists (
          select 1
          from public.system_access_role_functions rf
          join public.system_access_roles ar on ar.code = rf.access_role_code and ar.is_active
          where rf.access_role_code = p.access_role_code
            and rf.function_code = p_function
        )
        or exists (
          select 1
          from public.job_position_function_permissions pf
          where pf.position_id = p.position_id
            and pf.function_code = p_function
        )
        or exists (
          select 1
          from public.profile_function_permissions uf
          where uf.user_id = p.id
            and uf.function_code = p_function
        )
      )
  );
$$;

revoke all on function public.profile_has_function(uuid, text) from public;

-- Kỳ lương ĐÃ CHỐT gần nhất: tháng lớn nhất có kỳ ở trạng thái khoá trở đi.
--
-- Đây là mốc "quá khứ không được sửa" của toàn phân hệ: mọi thay đổi cấu hình
-- có ngày hiệu lực đều phải bắt đầu SAU tháng này. Lấy tháng lớn nhất chứ không
-- phải "tháng chưa chạy đầu tiên": tháng 9 bỏ trống mà tháng 10 đã khoá thì một
-- thay đổi hiệu lực từ tháng 9 vẫn kéo sang tháng 10 — đúng thứ phải chặn.
--
-- `LOCKED` có từ migration F06.04; liệt kê sẵn ở đây không hại gì khi trạng
-- thái đó chưa tồn tại.
create or replace function public.payroll_last_closed_month()
returns date
language sql
stable
security definer
set search_path = public
as $$
  select max(r.month_start)
  from public.payroll_runs r
  where r.status in ('LOCKED', 'APPROVED', 'PAID');
$$;

revoke all on function public.payroll_last_closed_month() from public;
grant execute on function public.payroll_last_closed_month() to authenticated;

-- Ghi một dòng Audit Log. KHÔNG cấp cho client: chỉ trigger và RPC
-- (security definer) gọi được, nên không ai tự chèn vết giả.
create or replace function public.write_payroll_audit(
  p_action text,
  p_entity_type text,
  p_entity_id text,
  p_summary text,
  p_details jsonb default null,
  p_target_user uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_name text;
  v_target_name text;
begin
  if v_actor is not null then
    select p.name into v_actor_name from public.profiles p where p.id = v_actor;
  end if;
  if p_target_user is not null then
    select p.name into v_target_name from public.profiles p where p.id = p_target_user;
  end if;

  insert into public.audit_logs (
    actor_id, actor_name, action, entity_type, entity_id,
    target_user_id, target_name, summary, details
  ) values (
    v_actor, v_actor_name, p_action, p_entity_type, p_entity_id,
    p_target_user, v_target_name, p_summary, p_details
  );
end;
$$;

revoke all on function public.write_payroll_audit(text, text, text, text, jsonb, uuid) from public, anon, authenticated;

-- Các trường khác nhau giữa hai bản ghi, dạng {cột: {from, to}}. Bỏ
-- `updated_at` vì cột đó đổi ở mọi lần sửa, liệt kê vào chỉ thêm nhiễu.
create or replace function public.payroll_row_diff(p_old jsonb, p_new jsonb)
returns jsonb
language sql
immutable
as $$
  select coalesce(
    jsonb_object_agg(n.key, jsonb_build_object('from', o.value, 'to', n.value)),
    '{}'::jsonb
  )
  from jsonb_each(p_new) n
  left join jsonb_each(p_old) o on o.key = n.key
  where n.key not in ('updated_at')
    and o.value is distinct from n.value;
$$;

-- ---------------------------------------------------------------------------
-- 1. Năm nhóm phân loại bắt buộc (BR-PAY-001)
-- ---------------------------------------------------------------------------
create table if not exists public.payroll_component_categories (
  code text primary key check (code ~ '^[A-Z][A-Z0-9_]*$'),
  name text not null,
  description text,
  /* Loại khoản được phép trong nhóm. Nhóm 1–4 chỉ có khoản CỘNG; nhóm 5 gồm
     khoản trừ vào lương và phần doanh nghiệp đóng (BHXH/KPCĐ phía DN). */
  allowed_kinds text[] not null
    check (allowed_kinds <@ array['EARNING', 'DEDUCTION', 'EMPLOYER_COST']::text[]
           and cardinality(allowed_kinds) > 0),
  /* Tính chất gợi ý khi tạo khoản mới trong nhóm — người khai đổi được. */
  default_nature text not null check (default_nature in ('FIXED', 'VARIABLE')),
  sort_order integer not null default 100,
  created_at timestamptz not null default now()
);

comment on table public.payroll_component_categories is
  'Năm nhóm phân loại bắt buộc của khoản lương (BR-PAY-001, F06.01).';

insert into public.payroll_component_categories
  (code, name, description, allowed_kinds, default_nature, sort_order)
values
  ('THU_NHAP_CO_DINH', 'Thu nhập cố định',
   'Khoản trả theo hợp đồng / định mức: lương cơ bản – bậc lương, trách nhiệm, phụ cấp và trợ cấp cố định.',
   array['EARNING'], 'FIXED', 10),
  ('THU_NHAP_BIEN_DOI', 'Thu nhập biến đổi',
   'Khoản tính theo kết quả thực tế: lương thời gian, phép, lễ, KPI, doanh thu, vận chuyển, công tác.',
   array['EARNING'], 'VARIABLE', 20),
  ('LAM_THEM_GIO', 'Làm thêm giờ (OT & ca đêm)',
   'Tăng ca ngày thường, ngày nghỉ, ngày lễ và làm thêm ca đêm theo hệ số khai ở Tham số lương.',
   array['EARNING'], 'VARIABLE', 30),
  ('THUONG_PHAT_SINH', 'Thưởng phát sinh',
   'Thưởng đi sớm, CTKM / mở mới, thưởng doanh số vượt và các khoản thưởng khác.',
   array['EARNING'], 'VARIABLE', 40),
  ('KHAU_TRU_PHAT', 'Khấu trừ & phạt',
   'Bảo hiểm bắt buộc, thuế TNCN, trích quỹ, tạm ứng, các khoản phạt; kèm phần doanh nghiệp đóng (không trừ lương).',
   array['DEDUCTION', 'EMPLOYER_COST'], 'VARIABLE', 50)
on conflict (code) do update set
  name = excluded.name,
  description = excluded.description,
  allowed_kinds = excluded.allowed_kinds,
  default_nature = excluded.default_nature,
  sort_order = excluded.sort_order;

alter table public.payroll_component_categories enable row level security;

-- Năm nhóm do đặc tả quy định, không sửa qua giao diện. Đọc mở cho người có
-- bất kỳ chức năng lương nào.
drop policy if exists payroll_component_categories_read on public.payroll_component_categories;
create policy payroll_component_categories_read on public.payroll_component_categories
for select to authenticated using (public.can_payroll());

revoke insert, update, delete on public.payroll_component_categories from authenticated, anon;
grant select on public.payroll_component_categories to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Cột mới trên danh mục khoản
-- ---------------------------------------------------------------------------
alter table public.payroll_components
  add column if not exists category_code text,
  add column if not exists nature text,
  -- ASSIGNED: khoản gán cho người / phòng / mẫu bảng lương như bình thường.
  -- ENGINE:   khoản do engine tự tính từ chấm công và tham số (lương thời
  --           gian, phép, lễ, bảo hiểm, thuế). Có mặt trong danh mục để đủ 26
  --           khoản theo đặc tả và để khai mô tả hạch toán, nhưng KHÔNG gán
  --           được — gán vào là trả / trừ hai lần.
  add column if not exists calc_source text not null default 'ASSIGNED';

alter table public.payroll_components drop constraint if exists payroll_components_calc_source_check;
alter table public.payroll_components
  add constraint payroll_components_calc_source_check check (calc_source in ('ASSIGNED', 'ENGINE'));

alter table public.payroll_components drop constraint if exists payroll_components_nature_check;
alter table public.payroll_components
  add constraint payroll_components_nature_check check (nature is null or nature in ('FIXED', 'VARIABLE'));

-- Xếp các khoản hiện có vào năm nhóm. Đi theo MÃ trước (biết chắc nghĩa của
-- khoản), rồi mới theo tên nhóm cũ, cuối cùng theo loại cộng/trừ.
update public.payroll_components c
set category_code = case
  when c.code in (
    'LUONG_CO_BAN', 'ALLOW_RESPONSIBILITY', 'ALLOW_POSITION', 'ALLOW_MEAL', 'ALLOW_FUEL',
    'ALLOW_PHONE', 'PC_VAN_PHONG', 'PHU_CAP_KHAC', 'ALLOW_HAZARD', 'ALLOW_SENIORITY', 'ALLOW_HOUSING'
  ) then 'THU_NHAP_CO_DINH'
  when c.code in (
    'BASE_WORK', 'BASE_LEAVE', 'BASE_HOLIDAY', 'LUONG_KPI', 'LUONG_DOANH_SO', 'LUONG_DT_CAT_LO',
    'LUONG_VAN_CHUYEN', 'PC_CONG_TAC_TINH', 'PC_VAN_CHUYEN', 'PIECE_RATE', 'COMMISSION',
    'UNUSED_LEAVE', 'STOPPAGE_PAY', 'SEVERANCE'
  ) then 'THU_NHAP_BIEN_DOI'
  when c.code in (
    'OT_WEEKDAY', 'OT_WEEKEND', 'OT_HOLIDAY', 'NIGHT_SHIFT', 'LUONG_OT_THUONG', 'LUONG_OT_LE', 'CONG_THEM_DEM'
  ) then 'LAM_THEM_GIO'
  when c.code in (
    'ALLOW_ATTENDANCE', 'BONUS_KPI', 'BONUS_HOLIDAY', 'BONUS_13TH', 'THUONG_THANG',
    'THUONG_DI_SOM', 'THUONG_CTKM', 'THUONG_DOANH_SO_VUOT'
  ) then 'THUONG_PHAT_SINH'
  when c.kind in ('DEDUCTION', 'EMPLOYER_COST') then 'KHAU_TRU_PHAT'
  when c.group_name ilike '%làm thêm%' or c.group_name ilike '%tăng ca%' then 'LAM_THEM_GIO'
  when c.group_name ilike '%thưởng%' then 'THUONG_PHAT_SINH'
  when c.group_name ilike '%phụ cấp%' or c.group_name ilike '%lương cơ bản%' then 'THU_NHAP_CO_DINH'
  else 'THU_NHAP_BIEN_DOI'
end
where c.category_code is null;

-- Khoản cộng mà lỡ nằm ở nhóm khấu trừ (do suy theo tên) thì kéo về đúng loại;
-- ràng buộc nhóm ↔ loại bên dưới sẽ không cho tình trạng đó xảy ra nữa.
update public.payroll_components c
set category_code = 'KHAU_TRU_PHAT'
where c.kind in ('DEDUCTION', 'EMPLOYER_COST') and c.category_code <> 'KHAU_TRU_PHAT';

update public.payroll_components c
set nature = coalesce(
  (select g.default_nature from public.payroll_component_categories g where g.code = c.category_code),
  'VARIABLE'
)
where c.nature is null;

alter table public.payroll_components alter column category_code set not null;
alter table public.payroll_components alter column nature set not null;

alter table public.payroll_components drop constraint if exists payroll_components_category_fk;
alter table public.payroll_components
  add constraint payroll_components_category_fk
  foreign key (category_code) references public.payroll_component_categories(code)
  on update cascade on delete restrict;

create index if not exists payroll_components_category_idx
  on public.payroll_components(category_code, sort_order);

comment on column public.payroll_components.category_code is
  'Một trong năm nhóm bắt buộc (BR-PAY-001). Quyết định loại khoản được phép.';
comment on column public.payroll_components.nature is
  'Tính chất: FIXED = cố định định kỳ, VARIABLE = biến đổi theo hiệu suất / thời gian.';
comment on column public.payroll_components.calc_source is
  'ASSIGNED = gán cho người/phòng/mẫu; ENGINE = engine tự tính, chỉ để liệt kê, không gán được.';

-- Bỏ con số gõ cứng trong công thức mặc định, thay bằng tham số lương.
--
-- Chỉ đổi khi công thức VẪN NGUYÊN như lúc gieo: ai đã sửa tay thì giữ nguyên
-- lựa chọn của họ. Số tiền ra không đổi vì tham số mang đúng giá trị cũ (xem
-- bộ tham số gốc ở migration F06.02).
update public.payroll_components set formula = 'HOURLY_RATE * HE_SO_OT_THUONG * OT_WEEKDAY_HOURS'
 where code = 'OT_WEEKDAY' and formula = 'HOURLY_RATE * 1.5 * OT_WEEKDAY_HOURS';
update public.payroll_components set formula = 'HOURLY_RATE * HE_SO_OT_NGHI * OT_WEEKEND_HOURS'
 where code = 'OT_WEEKEND' and formula = 'HOURLY_RATE * 2 * OT_WEEKEND_HOURS';
update public.payroll_components set formula = 'HOURLY_RATE * HE_SO_OT_LE * OT_HOLIDAY_HOURS'
 where code = 'OT_HOLIDAY' and formula = 'HOURLY_RATE * 3 * OT_HOLIDAY_HOURS';
update public.payroll_components set formula = 'HOURLY_RATE * HE_SO_CA_DEM * NIGHT_HOURS'
 where code = 'NIGHT_SHIFT' and formula = 'HOURLY_RATE * 0.3 * NIGHT_HOURS';
update public.payroll_components set formula = '(BASE_WORK + LUONG_VAN_CHUYEN + LUONG_DOANH_SO) * TY_LE_QUY_1PT / 100'
 where code = 'QUY_CONG_DOAN' and formula = '(BASE_WORK + LUONG_VAN_CHUYEN + LUONG_DOANH_SO) * 0.01';
update public.payroll_components set formula = 'HOURLY_RATE * OT_NGAY_THUONG * SO_GIO_OT_MOI_NGAY * HE_SO_OT_KHO_THUONG'
 where code = 'LUONG_OT_THUONG' and formula = 'HOURLY_RATE * OT_NGAY_THUONG * 2';
update public.payroll_components set formula = 'HOURLY_RATE * OT_NGAY_LE * SO_GIO_OT_MOI_NGAY * HE_SO_OT_KHO_LE'
 where code = 'LUONG_OT_LE' and formula = 'HOURLY_RATE * OT_NGAY_LE * 2 * 2';

-- ---------------------------------------------------------------------------
-- 3. Ràng buộc nghiệp vụ trên danh mục
-- ---------------------------------------------------------------------------

-- Khoản đã xuất hiện trong phiếu lương của một kỳ ĐÃ CHỐT chưa.
-- `payslip_lines` lưu MÃ khoản (không lưu id) để phiếu tự đứng được kể cả khi
-- khoản bị sửa sau này, nên tra theo mã.
create or replace function public.payroll_component_used_in_closed_period(p_code text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.payslip_lines l
    join public.payslips s on s.id = l.payslip_id
    join public.payroll_runs r on r.id = s.run_id
    where l.code = p_code
      and r.status in ('LOCKED', 'APPROVED', 'PAID')
  );
$$;

revoke all on function public.payroll_component_used_in_closed_period(text) from public;
grant execute on function public.payroll_component_used_in_closed_period(text) to authenticated;

create or replace function public.guard_payroll_component()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_allowed text[];
begin
  if tg_op = 'DELETE' then
    -- Lớp chặn cuối: xoá thẳng qua API cũng không qua được. Đường đúng là RPC
    -- `remove_payroll_component`, tự chuyển sang Ngừng hoạt động.
    if public.payroll_component_used_in_closed_period(old.code) then
      raise exception 'Khoản "%" đã phát sinh trong kỳ lương đã chốt — không xoá được, chỉ chuyển Ngừng hoạt động.', old.name
        using errcode = '23514';
    end if;
    return old;
  end if;

  new.code := upper(trim(new.code));
  new.name := trim(new.name);
  if new.name = '' then
    raise exception 'Tên khoản lương không được để trống.' using errcode = '23514';
  end if;

  -- Màn mới luôn gửi nhóm. Bản client cũ (còn chạy trong quãng deploy lệch
  -- nhịp) thì không biết cột này — suy theo loại khoản thay vì làm hỏng lệnh
  -- thêm khoản của họ. Kế toán xếp lại nhóm sau ở màn mới.
  if new.category_code is null then
    new.category_code := case when new.kind = 'EARNING' then 'THU_NHAP_BIEN_DOI' else 'KHAU_TRU_PHAT' end;
  end if;

  -- Trùng tên (không phân biệt hoa thường). Làm bằng trigger chứ không bằng
  -- unique index: dữ liệu cũ có thể đang có hai khoản trùng tên, index sẽ làm
  -- migration hỏng; trigger chỉ xét đúng dòng đang ghi.
  if exists (
    select 1 from public.payroll_components c
    where lower(c.name) = lower(new.name)
      and c.id <> new.id
  ) then
    raise exception 'Tên khoản lương "%" đã tồn tại trên hệ thống.', new.name using errcode = '23505';
  end if;

  select g.allowed_kinds into v_allowed
  from public.payroll_component_categories g
  where g.code = new.category_code;
  if v_allowed is null then
    raise exception 'Nhóm phân loại "%" không tồn tại.', new.category_code using errcode = '23503';
  end if;
  if not (new.kind = any(v_allowed)) then
    raise exception 'Nhóm đã chọn không nhận loại khoản này (khoản cộng phải thuộc nhóm 1–4, khoản trừ thuộc nhóm Khấu trừ & phạt).'
      using errcode = '23514';
  end if;

  if new.nature is null then
    select g.default_nature into new.nature
    from public.payroll_component_categories g where g.code = new.category_code;
  end if;

  if tg_op = 'UPDATE' and new.code is distinct from old.code then
    -- Mã là định danh: phiếu lương đã chốt lưu mã, công thức tham chiếu mã.
    -- Đổi mã của khoản đã từng lên phiếu là cắt đứt phiếu đó khỏi danh mục.
    if exists (select 1 from public.payslip_lines l where l.code = old.code) then
      raise exception 'Khoản "%" đã có trên phiếu lương — không đổi mã được nữa.', old.name using errcode = '23514';
    end if;
  end if;

  if tg_op = 'UPDATE' and old.calc_source = 'ENGINE' and new.calc_source <> 'ENGINE' then
    raise exception 'Khoản do hệ thống tự tính, không chuyển thành khoản gán tay được.' using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists payroll_components_guard on public.payroll_components;
create trigger payroll_components_guard
before insert or update or delete on public.payroll_components
for each row execute function public.guard_payroll_component();

-- Không gán được khoản do engine tự tính. Dùng chung cho mọi bảng gán khoản
-- (người, phòng ban, mẫu bảng lương).
create or replace function public.guard_assignable_payroll_component()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from public.payroll_components c
    where c.id = new.component_id and c.calc_source = 'ENGINE'
  ) then
    raise exception 'Khoản này do hệ thống tự tính từ chấm công và tham số — không gán thêm được (sẽ tính hai lần).'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists employee_pay_items_assignable on public.employee_pay_items;
create trigger employee_pay_items_assignable
before insert or update of component_id on public.employee_pay_items
for each row execute function public.guard_assignable_payroll_component();

drop trigger if exists unit_pay_items_assignable on public.unit_pay_items;
create trigger unit_pay_items_assignable
before insert or update of component_id on public.unit_pay_items
for each row execute function public.guard_assignable_payroll_component();

-- ---------------------------------------------------------------------------
-- 4. Audit Log cho danh mục
-- ---------------------------------------------------------------------------
create or replace function public.audit_payroll_component()
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
      'salary.component_create', 'payroll_component', new.id::text,
      format('Thêm khoản lương %s — %s', new.code, new.name),
      jsonb_build_object('after', to_jsonb(new))
    );
    return new;
  end if;

  if tg_op = 'DELETE' then
    perform public.write_payroll_audit(
      'salary.component_delete', 'payroll_component', old.id::text,
      format('Xoá khoản lương %s — %s', old.code, old.name),
      jsonb_build_object('before', to_jsonb(old))
    );
    return old;
  end if;

  v_diff := public.payroll_row_diff(to_jsonb(old), to_jsonb(new));
  if v_diff = '{}'::jsonb then
    return new;
  end if;

  perform public.write_payroll_audit(
    case
      when old.is_active and not new.is_active then 'salary.component_deactivate'
      when not old.is_active and new.is_active then 'salary.component_activate'
      else 'salary.component_update'
    end,
    'payroll_component', new.id::text,
    case
      when old.is_active and not new.is_active then format('Ngừng hoạt động khoản %s — %s', new.code, new.name)
      when not old.is_active and new.is_active then format('Kích hoạt lại khoản %s — %s', new.code, new.name)
      else format('Sửa khoản lương %s — %s', new.code, new.name)
    end,
    jsonb_build_object('changes', v_diff)
  );
  return new;
end;
$$;

drop trigger if exists payroll_components_audit on public.payroll_components;
create trigger payroll_components_audit
after insert or update or delete on public.payroll_components
for each row execute function public.audit_payroll_component();

-- ---------------------------------------------------------------------------
-- 5. Xoá theo đúng luồng hoạt động F06.01 (bước 8–10)
-- ---------------------------------------------------------------------------
-- Đã phát sinh trong kỳ chốt -> chặn xoá cứng, tự chuyển Ngừng hoạt động.
-- Chưa phát sinh             -> xoá vĩnh viễn.
-- Cả hai nhánh đều để lại vết (trigger audit ở trên).
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
    raise exception 'Bạn không có quyền quản lý danh mục khoản lương.' using errcode = '42501';
  end if;

  select * into v_component
  from public.payroll_components
  where id = p_component_id
  for update;

  if v_component.id is null then
    raise exception 'Không tìm thấy khoản lương.' using errcode = 'P0002';
  end if;

  if v_component.calc_source = 'ENGINE' then
    raise exception 'Khoản "%" do hệ thống tự tính — không xoá hay ngừng được ở danh mục.', v_component.name
      using errcode = '23514';
  end if;

  if public.payroll_component_used_in_closed_period(v_component.code) then
    if v_component.is_active then
      update public.payroll_components
      set is_active = false
      where id = p_component_id;
    end if;
    perform public.write_payroll_audit(
      'salary.component_delete_blocked', 'payroll_component', p_component_id::text,
      format('Chặn xoá khoản %s — %s: đã phát sinh trong kỳ lương đã chốt, chuyển Ngừng hoạt động',
             v_component.code, v_component.name),
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
-- 6. Danh mục chuẩn 26 khoản (F06.01, FR06.01.01–04)
-- ---------------------------------------------------------------------------
-- Chỉ là DANH SÁCH: mã, tên, nhóm, loại, tính chất, cờ thuế / bảo hiểm và mô
-- tả. Không có mức tiền hay công thức — cách tính khai ở Công thức theo khối
-- (F06.02) và Cơ chế lương (F06.03).
--
-- Mã trùng khoản đang có thì GIỮ khoản đang có (không ghi đè tên hay cờ người
-- dùng đã chỉnh): 20 trong 26 khoản đã sẵn trong danh mục hiện tại.
create or replace function public.payroll_standard_catalog()
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
  note text
)
language sql
stable
as $$
  select * from (values
    (1,  'LUONG_CO_BAN', 'Lương cơ bản / Bậc lương', 'THU_NHAP_CO_DINH', 'EARNING', 'FIXED', 'ASSIGNED', true, true, true, 10,
         'Bậc lương theo chức danh — căn cứ tính lương thời gian, phép, lễ, đơn giá giờ OT và mức đóng bảo hiểm. Bản thân khoản này không cộng thêm một dòng tiền.'),
    (2,  'ALLOW_RESPONSIBILITY', 'Phụ cấp trách nhiệm', 'THU_NHAP_CO_DINH', 'EARNING', 'FIXED', 'ASSIGNED', true, true, false, 111,
         'Trả cho người kiêm nhiệm trách nhiệm ngoài chức danh.'),
    (3,  'PHU_CAP_KHAC', 'Phụ cấp / Trợ cấp khác (ăn trưa, xăng xe, điện thoại…)', 'THU_NHAP_CO_DINH', 'EARNING', 'FIXED', 'ASSIGNED', true, false, false, 148,
         'Các khoản phụ cấp, trợ cấp cố định theo chính sách công ty.'),
    (4,  'BASE_WORK', 'Lương thời gian', 'THU_NHAP_BIEN_DOI', 'EARNING', 'VARIABLE', 'ENGINE', true, true, false, 20,
         'Hệ thống tự tính: Bậc lương ÷ công chuẩn × ngày công thực tế (BR-PAY-002).'),
    (5,  'BASE_LEAVE', 'Lương phép', 'THU_NHAP_BIEN_DOI', 'EARNING', 'VARIABLE', 'ENGINE', true, true, false, 21,
         'Hệ thống tự tính từ đơn nghỉ phép có lương đã duyệt.'),
    (6,  'BASE_HOLIDAY', 'Lương nghỉ lễ', 'THU_NHAP_BIEN_DOI', 'EARNING', 'VARIABLE', 'ENGINE', true, true, false, 22,
         'Hệ thống tự tính từ lịch nghỉ lễ công ty.'),
    (7,  'LUONG_KPI', 'Lương KPI', 'THU_NHAP_BIEN_DOI', 'EARNING', 'VARIABLE', 'ASSIGNED', true, false, false, 200,
         'Bậc lương KPI × % KPI đã khoá ở M05.'),
    (8,  'LUONG_DOANH_SO', 'Lương doanh thu (DT)', 'THU_NHAP_BIEN_DOI', 'EARNING', 'VARIABLE', 'ASSIGNED', true, false, false, 115,
         'Hoa hồng khoán doanh thu theo biểu bậc thang (BL 02).'),
    (9,  'LUONG_DT_CAT_LO', 'Lương doanh thu sau cắt lô (>40% / nhà hàng có PG)', 'THU_NHAP_BIEN_DOI', 'EARNING', 'VARIABLE', 'ASSIGNED', true, false, false, 116,
         'Hoa hồng trên doanh số thu cắt lô.'),
    (10, 'LUONG_VAN_CHUYEN', 'Lương vận chuyển', 'THU_NHAP_BIEN_DOI', 'EARNING', 'VARIABLE', 'ASSIGNED', true, false, false, 110,
         'Số chuyến giao nhận × đơn giá.'),
    (11, 'PC_CONG_TAC_TINH', 'Phụ cấp công tác tỉnh', 'THU_NHAP_BIEN_DOI', 'EARNING', 'VARIABLE', 'ASSIGNED', true, false, false, 142,
         'Mức phụ cấp mỗi tỉnh × số tỉnh đi công tác có phát sinh doanh số.'),
    (12, 'OT_WEEKDAY', 'Lương OT ngày thường', 'LAM_THEM_GIO', 'EARNING', 'VARIABLE', 'ASSIGNED', true, false, false, 210,
         'Đơn giá giờ × hệ số OT ngày thường × số giờ (đơn OT đã duyệt tự đổ vào).'),
    (13, 'OT_WEEKEND', 'Lương OT Chủ nhật / ngày nghỉ', 'LAM_THEM_GIO', 'EARNING', 'VARIABLE', 'ASSIGNED', true, false, false, 220,
         'Đơn giá giờ × hệ số OT ngày nghỉ × số giờ.'),
    (14, 'OT_HOLIDAY', 'Lương OT ngày lễ', 'LAM_THEM_GIO', 'EARNING', 'VARIABLE', 'ASSIGNED', true, false, false, 230,
         'Đơn giá giờ × hệ số OT ngày lễ × số giờ.'),
    (15, 'CONG_THEM_DEM', 'Lương làm thêm ca đêm (sau 22h)', 'LAM_THEM_GIO', 'EARNING', 'VARIABLE', 'ASSIGNED', true, false, false, 240,
         'Làm thêm sau 22h được cộng thêm công theo quy chế (BR-PAY-003).'),
    (16, 'THUONG_DI_SOM', 'Thưởng đi sớm', 'THUONG_PHAT_SINH', 'EARNING', 'VARIABLE', 'ASSIGNED', true, false, false, 300,
         'Thưởng chuyên cần đi sớm theo quy chế.'),
    (17, 'THUONG_CTKM', 'Thưởng CTKM / mở mới', 'THUONG_PHAT_SINH', 'EARNING', 'VARIABLE', 'ASSIGNED', true, false, false, 301,
         'Thưởng chương trình khuyến mại, mở mới điểm bán.'),
    (18, 'THUONG_DOANH_SO_VUOT', 'Thưởng doanh số vượt 150%', 'THUONG_PHAT_SINH', 'EARNING', 'VARIABLE', 'ASSIGNED', true, false, false, 302,
         'Thưởng khi tỷ lệ đạt doanh số khoán vượt ngưỡng (BR-PAY-004).'),
    (19, 'THUONG_THANG', 'Thưởng khác', 'THUONG_PHAT_SINH', 'EARNING', 'VARIABLE', 'ASSIGNED', true, false, false, 303,
         'Các khoản thưởng phát sinh khác trong tháng.'),
    (20, 'INS_EMPLOYEE', 'BHXH / BHYT / BHTN (người lao động đóng)', 'KHAU_TRU_PHAT', 'DEDUCTION', 'VARIABLE', 'ENGINE', false, false, false, 600,
         'Hệ thống tự tính theo tỷ lệ và trần ở Tham số lương (BR-PAY-003).'),
    (21, 'PIT', 'Thuế TNCN lũy tiến', 'KHAU_TRU_PHAT', 'DEDUCTION', 'VARIABLE', 'ENGINE', false, false, false, 601,
         'Hệ thống tự tính theo biểu thuế và giảm trừ gia cảnh ở Tham số lương (BR-PAY-002).'),
    (22, 'QUY_CONG_DOAN', 'Trừ 1% nhập quỹ nội bộ Huy Phong', 'KHAU_TRU_PHAT', 'DEDUCTION', 'VARIABLE', 'ASSIGNED', false, false, false, 900,
         'Tỷ lệ trích quỹ nội bộ khai ở Tham số lương.'),
    (23, 'ADVANCE', 'Tạm ứng', 'KHAU_TRU_PHAT', 'DEDUCTION', 'VARIABLE', 'ASSIGNED', false, false, false, 620,
         'Trừ tạm ứng đã nhận vào lương cuối tháng.'),
    (24, 'PHAT_DI_MUON_VE_SOM', 'Phạt đi muộn / về sớm', 'KHAU_TRU_PHAT', 'DEDUCTION', 'VARIABLE', 'ASSIGNED', false, false, false, 810,
         'Tự liên kết số lần đi muộn / về sớm từ chấm công × đơn giá phạt ở Tham số lương. Lưu ý Điều 127 BLLĐ 2019.'),
    (25, 'PHAT_BAO_CAO', 'Phạt không làm báo cáo / kế hoạch', 'KHAU_TRU_PHAT', 'DEDUCTION', 'VARIABLE', 'ASSIGNED', false, false, false, 815,
         'Số lần thiếu báo cáo / kế hoạch × đơn giá phạt ở Tham số lương. Lưu ý Điều 127 BLLĐ 2019.'),
    (26, 'PHAT_DI_MUON', 'Phạt đi muộn quá số lần', 'KHAU_TRU_PHAT', 'DEDUCTION', 'VARIABLE', 'ASSIGNED', false, false, false, 820,
         'Phạt phần vượt số lần đi muộn cho phép. Lưu ý Điều 127 BLLĐ 2019.')
  ) as t(std_no, code, name, category_code, kind, nature, calc_source, taxable, insurable, is_base, sort_order, note);
$$;

grant execute on function public.payroll_standard_catalog() to authenticated;

-- Khởi tạo / bổ sung các khoản chuẩn còn thiếu. Trả về số khoản vừa thêm.
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

  -- Chỉ một khoản được là lương gốc (unique index). Đã có khoản lương gốc thì
  -- khoản chuẩn chèn vào không mang cờ đó, để không đè lựa chọn của công ty.
  select exists (select 1 from public.payroll_components where is_base) into v_has_base;

  insert into public.payroll_components (
    code, name, kind, calc_type, default_amount, taxable, insurable, is_base,
    prorate, sort_order, category_code, nature, calc_source, is_active, is_system, note
  )
  select
    s.code, s.name, s.kind, 'FIXED', 0, s.taxable, s.insurable,
    s.is_base and not v_has_base,
    false, s.sort_order, s.category_code, s.nature, s.calc_source, true,
    s.calc_source = 'ENGINE', s.note
  from public.payroll_standard_catalog() s
  where not exists (select 1 from public.payroll_components c where c.code = s.code)
    -- Tên trùng với một khoản mã khác: bỏ qua thay vì làm hỏng cả lượt.
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

-- ---------------------------------------------------------------------------
-- 7. Quyền: đọc theo phân hệ, ghi theo đúng chức năng Danh mục
-- ---------------------------------------------------------------------------
-- Trước đây cả đọc lẫn ghi đều gác bằng `admin.payroll` (chức năng Bảng lương),
-- nên người được cấp riêng "Danh mục khoản lương" mở màn ra thấy trống, còn
-- người chỉ được tính lương lại sửa được danh mục.
drop policy if exists payroll_components_read on public.payroll_components;
create policy payroll_components_read on public.payroll_components
for select to authenticated using (public.can_payroll());

drop policy if exists payroll_components_manage on public.payroll_components;
create policy payroll_components_manage on public.payroll_components
for all to authenticated
using (public.can_function('admin.payroll_components'))
with check (public.can_function('admin.payroll_components'));
