-- ============================================================================
-- M05 KPI — dựng lại theo đặc tả mới.
-- ----------------------------------------------------------------------------
--   kpi_settings          Tham số KPI (trần, thưởng trọng điểm, xếp loại, lịch kỳ) — lưu lịch sử theo ngày hiệu lực
--   kpi_sets / _items     Bộ KPI theo vị trí / phòng ban / cá nhân: hạng mục → tiêu chí con, nhóm Định lượng / Định tính
--   kpi_exemptions        Người không áp dụng KPI (part-time, thực tập sinh…)
--   kpi_periods           Kỳ đánh giá tháng: OPEN → LOCKED
--   kpi_sheets / _items   Phiếu đánh giá + chi tiết chấm từng tiêu chí, minh chứng (bản chụp bộ KPI lúc mở kỳ)
--   kpi_sales_targets     Chỉ tiêu & kết quả Kinh doanh tháng
--   kpi_logs              Nhật ký thẩm định & phê duyệt — chỉ ghi thêm
--   kpi_reopen_requests   Mở lại phiếu đã khoá sổ (có biên bản, BGĐ duyệt)
--   kpi_year_reviews      Tổng hợp năm & quyết định thưởng / tăng lương
--   kpi_payroll_links     Kết quả KPI nào điền vào đầu mục lương nào
--
-- Mọi thao tác đổi trạng thái phiếu đi qua RPC (security definer); client chỉ
-- đọc phiếu và ghi trực tiếp phần cấu hình (bộ KPI, tham số, liên kết lương).
-- Các bảng KPI cũ (performance_reviews, kpi_position_templates…) để nguyên làm
-- lịch sử, không còn màn hình nào ghi vào.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. Quyền
-- ---------------------------------------------------------------------------
--   admin.performance_manage  Cấu hình bộ KPI, tham số, mở kỳ, xem mọi phiếu
--   admin.kpi_approve         Ban Giám đốc: duyệt cuối, duyệt chỉ tiêu KD, duyệt mở lại, xét thưởng năm
--   admin.kpi_close           Kế toán trưởng: khoá sổ kỳ, lập đề nghị mở lại

do $do$
begin
  if to_regclass('public.system_function_catalog') is not null then
    insert into public.system_function_catalog (code, name, description, module_code, route, sort_order) values
      ('admin.kpi_approve', 'Duyệt KPI (Ban Giám đốc)',
       'Duyệt cuối phiếu KPI cấp trưởng bộ phận và khối Kinh doanh, duyệt chỉ tiêu kinh doanh, mở lại phiếu, xét thưởng năm.',
       'reports', '/admin/performance/approve', 101),
      ('admin.kpi_close', 'Khoá sổ KPI (Kế toán trưởng)',
       'Khoá sổ kỳ KPI, nhập số liệu kinh doanh, lập đề nghị mở lại phiếu đã khoá.',
       'reports', '/admin/performance/close', 102)
    on conflict (code) do nothing;
  end if;
end;
$do$;

create or replace function public.kpi_can_manage() returns boolean
language sql stable security definer set search_path = public as $$
  select public.can_function('admin.performance_manage');
$$;

create or replace function public.kpi_is_board() returns boolean
language sql stable security definer set search_path = public as $$
  select public.can_function('admin.kpi_approve');
$$;

create or replace function public.kpi_can_close() returns boolean
language sql stable security definer set search_path = public as $$
  select public.can_function('admin.kpi_close') or public.can_function('admin.performance_manage');
$$;

-- Người dùng hiện tại là quản lý trực tiếp của p_user (theo hồ sơ hoặc trưởng đơn vị).
create or replace function public.kpi_is_manager_of(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    left join public.organization_units u on u.id = p.unit_id
    where p.id = p_user and auth.uid() is not null and p.id <> auth.uid()
      and (p.manager_id = auth.uid() or u.manager_id = auth.uid())
  );
$$;

grant execute on function public.kpi_can_manage(), public.kpi_is_board(), public.kpi_can_close(),
  public.kpi_is_manager_of(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 1. Tham số KPI
-- ---------------------------------------------------------------------------
create table if not exists public.kpi_settings (
  id uuid primary key default gen_random_uuid(),
  effective_from date not null unique check (effective_from = date_trunc('month', effective_from)::date),
  cap_pct numeric(6, 2) not null default 120 check (cap_pct between 100 and 200),
  bonus_max_pct numeric(6, 2) not null default 10 check (bonus_max_pct between 0 and 50),
  -- Ngưỡng xếp loại, cao xuống thấp: [{code, label, min}] — KPI% ≥ min thì đạt loại đó.
  grades jsonb not null default '[
    {"code":"A+","label":"Rất tốt","min":100.01},
    {"code":"A","label":"Tốt","min":95},
    {"code":"B","label":"Khá","min":81},
    {"code":"C","label":"Trung bình khá","min":51},
    {"code":"D","label":"Kém","min":0}
  ]'::jsonb,
  open_day smallint not null default 25 check (open_day between 1 and 28),
  self_due_day smallint not null default 2 check (self_due_day between 1 and 28),
  manager_due_day smallint not null default 3 check (manager_due_day between 1 and 28),
  manager_due_time time not null default '17:00',
  board_due_day smallint not null default 4 check (board_due_day between 1 and 28),
  board_due_time time not null default '12:00',
  lock_day smallint not null default 4 check (lock_day between 1 and 28),
  lock_time time not null default '17:00',
  note text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

insert into public.kpi_settings (effective_from, note)
values ('2020-01-01', 'Mặc định: trần 120%, thưởng trọng điểm tối đa 10%.')
on conflict (effective_from) do nothing;

create or replace function public.kpi_settings_for(p_month date)
returns public.kpi_settings
language sql stable security definer set search_path = public as $$
  select s.* from public.kpi_settings s
  where s.effective_from <= date_trunc('month', p_month)::date
  order by s.effective_from desc limit 1;
$$;

create or replace function public.kpi_grade_of(p_pct numeric, p_month date)
returns text
language sql stable security definer set search_path = public as $$
  select g ->> 'code'
  from jsonb_array_elements((public.kpi_settings_for(p_month)).grades) g
  where p_pct is not null and p_pct >= (g ->> 'min')::numeric
  order by (g ->> 'min')::numeric desc
  limit 1;
$$;

-- Mốc thời gian của kỳ tháng p_month (giờ Việt Nam).
create or replace function public.kpi_deadline(p_month date, p_kind text)
returns timestamptz
language plpgsql stable security definer set search_path = public as $$
declare
  s public.kpi_settings := public.kpi_settings_for(p_month);
  m date := date_trunc('month', p_month)::date;
  n date := (date_trunc('month', p_month) + interval '1 month')::date;
begin
  return case p_kind
    when 'OPEN' then ((m + (s.open_day - 1)) + time '00:00') at time zone 'Asia/Ho_Chi_Minh'
    when 'SELF' then ((n + (s.self_due_day - 1)) + time '23:59:59') at time zone 'Asia/Ho_Chi_Minh'
    when 'MANAGER' then ((n + (s.manager_due_day - 1)) + s.manager_due_time) at time zone 'Asia/Ho_Chi_Minh'
    when 'BOARD' then ((n + (s.board_due_day - 1)) + s.board_due_time) at time zone 'Asia/Ho_Chi_Minh'
    when 'LOCK' then ((n + (s.lock_day - 1)) + s.lock_time) at time zone 'Asia/Ho_Chi_Minh'
  end;
end;
$$;

grant execute on function public.kpi_settings_for(date), public.kpi_grade_of(numeric, date),
  public.kpi_deadline(date, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Bộ KPI
-- ---------------------------------------------------------------------------
create table if not exists public.kpi_sets (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  block text not null default 'VAN_PHONG' check (block in ('VAN_PHONG', 'KINH_DOANH')),
  -- Áp cho ai: cá nhân > vị trí > đơn vị (và đơn vị con). Bỏ trống cả ba = bộ mẫu.
  user_id uuid references public.profiles(id) on delete set null,
  position_id uuid,
  unit_id uuid references public.organization_units(id) on delete set null,
  base_set_id uuid references public.kpi_sets(id) on delete set null,
  effective_from date not null default date_trunc('month', current_date)::date
    check (effective_from = date_trunc('month', effective_from)::date),
  is_active boolean not null default false,
  -- Phiếu của bộ này phải qua Ban Giám đốc duyệt cuối (cấp trưởng bộ phận, khối Kinh doanh).
  board_review boolean not null default false,
  note text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists kpi_sets_user_idx on public.kpi_sets(user_id) where user_id is not null;
create index if not exists kpi_sets_unit_idx on public.kpi_sets(unit_id) where unit_id is not null;
create index if not exists kpi_sets_position_idx on public.kpi_sets(position_id) where position_id is not null;

create table if not exists public.kpi_set_items (
  id uuid primary key default gen_random_uuid(),
  set_id uuid not null references public.kpi_sets(id) on delete cascade,
  sort_order integer not null default 0,
  category text not null check (length(trim(category)) > 0),
  name text not null check (length(trim(name)) > 0),
  measure text,
  group_code text not null default 'QUANT' check (group_code in ('QUANT', 'QUAL')),
  weight numeric(7, 3) not null check (weight > 0 and weight <= 100),
  standard_score numeric(4, 2) not null default 4 check (standard_score > 0 and standard_score <= 5),
  -- LEVEL thang bậc · RANGE dải quy đổi → điểm · PENALTY trừ theo lần vi phạm · BINARY đạt/không đạt
  method text not null default 'LEVEL' check (method in ('LEVEL', 'RANGE', 'PENALTY', 'BINARY')),
  -- [{score, label}] mô tả từng mức điểm
  levels jsonb not null default '[]'::jsonb,
  -- [{min, max, score}] — min ≤ giá trị < max; bỏ trống min/max = không chặn
  ranges jsonb not null default '[]'::jsonb,
  value_unit text,
  penalty_pct numeric(6, 2) check (penalty_pct is null or penalty_pct > 0),
  allow_over boolean not null default false,
  -- Tự điền giá trị: SALES_PCT, COLLECT_PCT, COVERAGE_PCT (chỉ tiêu KD), LATE_COUNT (chấm công)
  source text check (source is null or source in ('SALES_PCT', 'COLLECT_PCT', 'COVERAGE_PCT', 'LATE_COUNT')),
  note text
);

create index if not exists kpi_set_items_set_idx on public.kpi_set_items(set_id, sort_order);

alter table public.kpi_sets add column if not exists version integer not null default 1;

-- Lịch sử thay đổi bộ KPI: bản chụp trước mỗi lần lưu.
create table if not exists public.kpi_set_versions (
  id bigserial primary key,
  set_id uuid not null references public.kpi_sets(id) on delete cascade,
  version integer not null,
  snapshot jsonb not null,
  saved_by uuid references public.profiles(id) on delete set null,
  saved_at timestamptz not null default now()
);

create index if not exists kpi_set_versions_set_idx on public.kpi_set_versions(set_id, version desc);

-- Lỗi của một bộ KPI; rỗng = hợp lệ để áp dụng.
create or replace function public.kpi_set_problems(p_set uuid)
returns text[]
language plpgsql stable security definer set search_path = public as $$
declare
  v_problems text[] := '{}';
  v_total numeric;
  v_categories integer;
  r record;
begin
  select coalesce(sum(weight), 0), count(distinct lower(trim(category)))
    into v_total, v_categories
  from public.kpi_set_items where set_id = p_set;

  if v_categories = 0 then
    return array['Bộ KPI chưa có tiêu chí nào.'];
  end if;
  if abs(v_total - 100) > 0.01 then
    v_problems := v_problems || format('Tổng tỷ trọng đang là %s%%, phải bằng 100%%.', trim(to_char(v_total, 'FM990.###')));
  end if;
  if v_categories > 10 then
    v_problems := v_problems || format('Có %s hạng mục, tối đa 10.', v_categories);
  end if;

  for r in select * from public.kpi_set_items where set_id = p_set order by sort_order loop
    if r.method = 'LEVEL' and jsonb_array_length(r.levels) = 0 then
      v_problems := v_problems || format('“%s”: chưa mô tả mức điểm.', r.name);
    end if;
    if r.method = 'RANGE' then
      if jsonb_array_length(r.ranges) = 0 then
        v_problems := v_problems || format('“%s”: chưa có dải quy đổi.', r.name);
      elsif exists (
        select 1
        from jsonb_array_elements(r.ranges) with ordinality a(v, i)
        join jsonb_array_elements(r.ranges) with ordinality b(v, j) on a.i < b.j
        where coalesce((a.v ->> 'min')::numeric, '-infinity') < coalesce((b.v ->> 'max')::numeric, 'infinity')
          and coalesce((b.v ->> 'min')::numeric, '-infinity') < coalesce((a.v ->> 'max')::numeric, 'infinity')
      ) then
        v_problems := v_problems || format('“%s”: các dải quy đổi chồng lên nhau.', r.name);
      end if;
    end if;
    if r.method = 'PENALTY' and r.penalty_pct is null then
      v_problems := v_problems || format('“%s”: chưa có mức trừ mỗi lần vi phạm.', r.name);
    end if;
  end loop;
  return v_problems;
end;
$$;

grant execute on function public.kpi_set_problems(uuid) to authenticated;

-- Bật áp dụng chỉ khi bộ hợp lệ; bộ đang áp dụng thì không để sai tổng.
create or replace function public.guard_kpi_set_active()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_problems text[];
begin
  new.updated_at := now();
  if new.is_active then
    v_problems := public.kpi_set_problems(new.id);
    if array_length(v_problems, 1) > 0 then
      raise exception '%', array_to_string(v_problems, ' ') using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists kpi_sets_active_guard on public.kpi_sets;
create trigger kpi_sets_active_guard
  before insert or update on public.kpi_sets
  for each row execute function public.guard_kpi_set_active();

-- Sửa tiêu chí của bộ đang áp dụng: kiểm lại sau cả câu lệnh (cho phép sửa nhiều
-- dòng một lượt). Trigger dùng bảng chuyển tiếp chỉ gắn được một sự kiện nên tách ba.
create or replace function public.guard_kpi_set_items_ins()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_set uuid; v_problems text[];
begin
  for v_set in select distinct s.id from public.kpi_sets s join new_rows n on n.set_id = s.id where s.is_active loop
    v_problems := public.kpi_set_problems(v_set);
    if array_length(v_problems, 1) > 0 then
      raise exception 'Bộ KPI đang áp dụng: %', array_to_string(v_problems, ' ') using errcode = '23514';
    end if;
  end loop;
  return null;
end;
$$;

create or replace function public.guard_kpi_set_items_del()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_set uuid; v_problems text[];
begin
  for v_set in select distinct s.id from public.kpi_sets s join old_rows o on o.set_id = s.id where s.is_active loop
    v_problems := public.kpi_set_problems(v_set);
    if array_length(v_problems, 1) > 0 then
      raise exception 'Bộ KPI đang áp dụng: %', array_to_string(v_problems, ' ') using errcode = '23514';
    end if;
  end loop;
  return null;
end;
$$;

drop trigger if exists kpi_set_items_ins_guard on public.kpi_set_items;
drop trigger if exists kpi_set_items_upd_guard on public.kpi_set_items;
drop trigger if exists kpi_set_items_del_guard on public.kpi_set_items;
create trigger kpi_set_items_ins_guard after insert on public.kpi_set_items
  referencing new table as new_rows for each statement execute function public.guard_kpi_set_items_ins();
create trigger kpi_set_items_upd_guard after update on public.kpi_set_items
  referencing new table as new_rows for each statement execute function public.guard_kpi_set_items_ins();
create trigger kpi_set_items_del_guard after delete on public.kpi_set_items
  referencing old table as old_rows for each statement execute function public.guard_kpi_set_items_del();

-- Lưu cả bộ (thông tin + toàn bộ tiêu chí) trong một giao dịch: thay hết tiêu chí cũ.
create or replace function public.kpi_save_set(p_set jsonb, p_items jsonb)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid := nullif(p_set ->> 'id', '')::uuid;
  v_active boolean := coalesce((p_set ->> 'is_active')::boolean, false);
  v_item jsonb;
  v_order integer := 0;
begin
  if not public.kpi_can_manage() then
    raise exception 'Bạn không có quyền cấu hình bộ KPI.' using errcode = '42501';
  end if;

  if v_id is null then
    insert into public.kpi_sets (code, name, block, user_id, position_id, unit_id, base_set_id, effective_from,
      is_active, board_review, note, created_by)
    values (
      coalesce(nullif(trim(p_set ->> 'code'), ''), 'KPI-' || upper(substr(gen_random_uuid()::text, 1, 8))),
      trim(p_set ->> 'name'),
      coalesce(p_set ->> 'block', 'VAN_PHONG'),
      nullif(p_set ->> 'user_id', '')::uuid,
      nullif(p_set ->> 'position_id', '')::uuid,
      nullif(p_set ->> 'unit_id', '')::uuid,
      nullif(p_set ->> 'base_set_id', '')::uuid,
      coalesce(nullif(p_set ->> 'effective_from', '')::date, date_trunc('month', current_date)::date),
      false,
      coalesce((p_set ->> 'board_review')::boolean, false),
      nullif(trim(p_set ->> 'note'), ''),
      auth.uid()
    )
    returning id into v_id;
  else
    insert into public.kpi_set_versions (set_id, version, snapshot, saved_by)
    select s.id, s.version,
      to_jsonb(s) || jsonb_build_object('items', coalesce((
        select jsonb_agg(to_jsonb(i) - 'set_id' order by i.sort_order) from public.kpi_set_items i where i.set_id = s.id
      ), '[]'::jsonb)),
      auth.uid()
    from public.kpi_sets s where s.id = v_id;

    update public.kpi_sets set
      version = version + 1,
      name = trim(p_set ->> 'name'),
      block = coalesce(p_set ->> 'block', block),
      user_id = nullif(p_set ->> 'user_id', '')::uuid,
      position_id = nullif(p_set ->> 'position_id', '')::uuid,
      unit_id = nullif(p_set ->> 'unit_id', '')::uuid,
      effective_from = coalesce(nullif(p_set ->> 'effective_from', '')::date, effective_from),
      is_active = false,
      board_review = coalesce((p_set ->> 'board_review')::boolean, board_review),
      note = nullif(trim(p_set ->> 'note'), '')
    where id = v_id;
  end if;

  delete from public.kpi_set_items where set_id = v_id;
  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    v_order := v_order + 1;
    insert into public.kpi_set_items (set_id, sort_order, category, name, measure, group_code, weight,
      standard_score, method, levels, ranges, value_unit, penalty_pct, allow_over, source, note)
    values (
      v_id, v_order,
      trim(v_item ->> 'category'), trim(v_item ->> 'name'), nullif(trim(v_item ->> 'measure'), ''),
      coalesce(v_item ->> 'group_code', 'QUANT'),
      (v_item ->> 'weight')::numeric,
      coalesce((v_item ->> 'standard_score')::numeric, 4),
      coalesce(v_item ->> 'method', 'LEVEL'),
      coalesce(v_item -> 'levels', '[]'::jsonb),
      coalesce(v_item -> 'ranges', '[]'::jsonb),
      nullif(trim(v_item ->> 'value_unit'), ''),
      nullif(v_item ->> 'penalty_pct', '')::numeric,
      coalesce((v_item ->> 'allow_over')::boolean, false),
      nullif(v_item ->> 'source', ''),
      nullif(trim(v_item ->> 'note'), '')
    );
  end loop;

  if v_active then
    update public.kpi_sets set is_active = true where id = v_id;
  end if;
  return v_id;
end;
$$;

grant execute on function public.kpi_save_set(jsonb, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Người không áp dụng KPI
-- ---------------------------------------------------------------------------
create table if not exists public.kpi_exemptions (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  reason text not null default 'Không áp dụng KPI',
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 4. Kỳ, phiếu, chi tiết chấm
-- ---------------------------------------------------------------------------
create table if not exists public.kpi_periods (
  month_start date primary key check (month_start = date_trunc('month', month_start)::date),
  status text not null default 'OPEN' check (status in ('OPEN', 'LOCKED')),
  opened_by uuid references public.profiles(id) on delete set null,
  opened_at timestamptz not null default now(),
  locked_by uuid references public.profiles(id) on delete set null,
  locked_at timestamptz,
  note text
);

create table if not exists public.kpi_sheets (
  id uuid primary key default gen_random_uuid(),
  period_month date not null references public.kpi_periods(month_start) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  set_id uuid references public.kpi_sets(id) on delete set null,
  set_name text not null,
  block text not null default 'VAN_PHONG',
  unit_id uuid references public.organization_units(id) on delete set null,
  reviewer_id uuid references public.profiles(id) on delete set null,
  board_review boolean not null default false,
  status text not null default 'DRAFT' check (status in ('DRAFT', 'PENDING', 'REJECTED', 'BOARD', 'APPROVED')),
  explanation text,
  self_pct numeric(7, 2),
  manager_pct numeric(7, 2),
  bonus_pct numeric(6, 2) not null default 0,
  bonus_note text,
  final_pct numeric(7, 2),
  grade text,
  return_reason text,
  submitted_at timestamptz,
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  version integer not null default 1,
  payroll_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (period_month, user_id)
);

create index if not exists kpi_sheets_reviewer_idx on public.kpi_sheets(reviewer_id, period_month);
create index if not exists kpi_sheets_user_idx on public.kpi_sheets(user_id, period_month);

create table if not exists public.kpi_sheet_items (
  id uuid primary key default gen_random_uuid(),
  sheet_id uuid not null references public.kpi_sheets(id) on delete cascade,
  sort_order integer not null default 0,
  category text not null,
  name text not null,
  measure text,
  group_code text not null,
  weight numeric(7, 3) not null,
  standard_score numeric(4, 2) not null,
  method text not null,
  levels jsonb not null default '[]'::jsonb,
  ranges jsonb not null default '[]'::jsonb,
  value_unit text,
  penalty_pct numeric(6, 2),
  allow_over boolean not null default false,
  source text,
  -- Tự chấm
  self_value numeric,
  self_score numeric(5, 2),
  self_na boolean not null default false,
  self_note text,
  evidence_url text,
  evidence_path text,
  evidence_name text,
  -- Quản lý / BGĐ chấm
  mgr_value numeric,
  mgr_score numeric(5, 2),
  mgr_na boolean not null default false,
  mgr_reason text,
  -- Kết quả
  eff_weight numeric(9, 4),
  self_points numeric(9, 4),
  mgr_points numeric(9, 4)
);

create index if not exists kpi_sheet_items_sheet_idx on public.kpi_sheet_items(sheet_id, sort_order);

-- Điểm của một tiêu chí từ giá trị đo (dải quy đổi), hoặc giữ điểm đã chọn.
create or replace function public.kpi_score_from_value(p_ranges jsonb, p_value numeric)
returns numeric
language sql immutable as $$
  select (r ->> 'score')::numeric
  from jsonb_array_elements(p_ranges) r
  where p_value is not null
    and (r ->> 'min' is null or p_value >= (r ->> 'min')::numeric)
    and (r ->> 'max' is null or p_value < (r ->> 'max')::numeric)
  order by (r ->> 'score')::numeric desc
  limit 1;
$$;

-- Tính lại một phiếu: điểm từ giá trị, tỷ trọng thực tế khi có tiêu chí "không phát sinh"
-- (chia cho các tiêu chí còn lại cùng hạng mục, rồi cùng nhóm, rồi toàn phiếu), điểm từng
-- tiêu chí, KPI% tự chấm / quản lý / chốt và xếp loại.
create or replace function public.kpi_effective_weights(p_sheet uuid, p_mgr boolean)
returns table (item_id uuid, eff numeric)
language sql stable security definer set search_path = public as $$
  with base as (
    select id, category, group_code, weight, case when p_mgr then mgr_na else self_na end as na
    from public.kpi_sheet_items where sheet_id = p_sheet
  ), cat as (
    select category, sum(weight) as total, coalesce(sum(weight) filter (where not na), 0) as live
    from base group by category
  ), grp as (
    select b.group_code,
      coalesce(sum(b.weight) filter (where c.live > 0), 0) as live_w,
      coalesce(sum(b.weight) filter (where c.live = 0), 0) as dead_w
    from base b join cat c using (category) group by b.group_code
  ), glob as (
    select coalesce(sum(live_w + dead_w) filter (where live_w > 0), 0) as live_t,
           coalesce(sum(dead_w) filter (where live_w = 0), 0) as dead_t
    from grp
  )
  select b.id,
    case when b.na or c.live = 0 then 0::numeric
    else b.weight * c.total / c.live
      * (g.live_w + g.dead_w) / g.live_w
      * (gl.live_t + gl.dead_t) / gl.live_t
    end
  from base b join cat c using (category) join grp g using (group_code) cross join glob gl;
$$;

-- Điểm (đóng góp vào KPI%) của một tiêu chí.
create or replace function public.kpi_points(
  p_eff numeric, p_na boolean, p_method text, p_value numeric, p_score numeric,
  p_standard numeric, p_allow_over boolean, p_penalty numeric
) returns numeric
language sql immutable as $$
  select case
    when p_na then 0
    when p_method = 'PENALTY' then
      case when p_value is null then null else greatest(0, p_eff - p_value * coalesce(p_penalty, 0)) end
    when p_score is null then null
    else p_eff * least(p_score, case when p_allow_over then 5 else p_standard end) / p_standard
  end;
$$;

create or replace function public.kpi_recalc_sheet(p_sheet uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_sheet public.kpi_sheets;
  v_cap numeric;
  v_self numeric;
  v_mgr numeric;
  v_mgr_done boolean;
begin
  select * into v_sheet from public.kpi_sheets where id = p_sheet;
  if v_sheet.id is null then return; end if;
  v_cap := (public.kpi_settings_for(v_sheet.period_month)).cap_pct;

  -- Điểm suy từ giá trị đo
  update public.kpi_sheet_items set
    self_score = case
      when method = 'RANGE' then public.kpi_score_from_value(ranges, self_value)
      when method = 'PENALTY' then case when self_value is null then null else standard_score end
      else self_score end,
    mgr_score = case
      when method = 'RANGE' then public.kpi_score_from_value(ranges, mgr_value)
      when method = 'PENALTY' then case when mgr_value is null then null else standard_score end
      else mgr_score end
  where sheet_id = p_sheet;

  update public.kpi_sheet_items i set
    self_points = round(public.kpi_points(e.eff, i.self_na, i.method, i.self_value, i.self_score,
      i.standard_score, i.allow_over, i.penalty_pct), 4),
    eff_weight = case when v_sheet.status in ('DRAFT', 'REJECTED') then round(e.eff, 4) else i.eff_weight end
  from public.kpi_effective_weights(p_sheet, false) e
  where i.id = e.item_id;

  update public.kpi_sheet_items i set
    mgr_points = round(public.kpi_points(e.eff, i.mgr_na, i.method, i.mgr_value, i.mgr_score,
      i.standard_score, i.allow_over, i.penalty_pct), 4),
    eff_weight = case when v_sheet.status in ('DRAFT', 'REJECTED') then i.eff_weight else round(e.eff, 4) end
  from public.kpi_effective_weights(p_sheet, true) e
  where i.id = e.item_id;

  select
    round(sum(self_points), 2),
    round(sum(mgr_points), 2),
    bool_and(mgr_na or mgr_points is not null)
  into v_self, v_mgr, v_mgr_done
  from public.kpi_sheet_items where sheet_id = p_sheet;

  update public.kpi_sheets set
    self_pct = v_self,
    manager_pct = case when v_mgr_done then v_mgr else null end,
    final_pct = case when v_mgr_done then least(v_cap, coalesce(v_mgr, 0) + bonus_pct) else null end,
    grade = case when v_mgr_done then public.kpi_grade_of(least(v_cap, coalesce(v_mgr, 0) + bonus_pct), period_month) else null end,
    updated_at = now()
  where id = p_sheet;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Nhật ký — chỉ ghi thêm
-- ---------------------------------------------------------------------------
create table if not exists public.kpi_logs (
  id bigserial primary key,
  sheet_id uuid references public.kpi_sheets(id) on delete set null,
  period_month date,
  user_id uuid references public.profiles(id) on delete set null,
  action text not null,
  from_status text,
  to_status text,
  reason text,
  detail jsonb,
  actor_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists kpi_logs_sheet_idx on public.kpi_logs(sheet_id, created_at);
create index if not exists kpi_logs_period_idx on public.kpi_logs(period_month, created_at);

create or replace function public.guard_kpi_logs_append_only()
returns trigger language plpgsql as $$
begin
  raise exception 'Nhật ký KPI chỉ được ghi thêm.' using errcode = '42501';
end;
$$;

drop trigger if exists kpi_logs_append_only on public.kpi_logs;
create trigger kpi_logs_append_only before update or delete on public.kpi_logs
  for each row execute function public.guard_kpi_logs_append_only();

create or replace function public.kpi_log(
  p_sheet uuid, p_month date, p_user uuid, p_action text,
  p_from text, p_to text, p_reason text, p_detail jsonb default null
) returns void
language sql security definer set search_path = public as $$
  insert into public.kpi_logs (sheet_id, period_month, user_id, action, from_status, to_status, reason, detail, actor_id)
  values (p_sheet, p_month, p_user, p_action, p_from, p_to, nullif(trim(p_reason), ''), p_detail, auth.uid());
$$;

-- ---------------------------------------------------------------------------
-- 6. Chỉ tiêu & kết quả Kinh doanh
-- ---------------------------------------------------------------------------
create table if not exists public.kpi_sales_targets (
  id uuid primary key default gen_random_uuid(),
  period_month date not null check (period_month = date_trunc('month', period_month)::date),
  user_id uuid not null references public.profiles(id) on delete cascade,
  sales_target numeric(16, 0) not null default 0 check (sales_target >= 0),
  collect_target numeric(16, 0) not null default 0 check (collect_target >= 0),
  customers_target integer not null default 0 check (customers_target >= 0),
  sales_actual numeric(16, 0),
  collect_actual numeric(16, 0),
  customers_actual integer,
  status text not null default 'DRAFT' check (status in ('DRAFT', 'SUBMITTED', 'APPROVED', 'CHANGES')),
  review_reason text,
  submitted_by uuid references public.profiles(id) on delete set null,
  submitted_at timestamptz,
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  -- Nhân viên xác nhận / khiếu nại số liệu thực hiện
  confirm_status text check (confirm_status in ('CONFIRMED', 'DISPUTED')),
  dispute_note text,
  actual_note text,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (period_month, user_id)
);

create or replace function public.kpi_sales_pct(p_actual numeric, p_target numeric)
returns numeric language sql immutable as $$
  select case when p_actual is null or coalesce(p_target, 0) = 0 then null
              else round(p_actual * 100.0 / p_target, 2) end;
$$;

-- Lưu chỉ tiêu (TP Kinh doanh / người cấu hình KPI) — nhiều dòng một lượt, dùng cho cả nhập Excel.
create or replace function public.kpi_save_sales_targets(p_month date, p_rows jsonb)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_month date := date_trunc('month', p_month)::date;
  v_row jsonb;
  v_user uuid;
  v_count integer := 0;
  v_existing public.kpi_sales_targets;
begin
  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_user := (v_row ->> 'user_id')::uuid;
    if not (public.kpi_can_manage() or public.kpi_is_manager_of(v_user)) then
      raise exception 'Bạn không giao chỉ tiêu được cho người này.' using errcode = '42501';
    end if;
    select * into v_existing from public.kpi_sales_targets where period_month = v_month and user_id = v_user;
    if v_existing.status in ('SUBMITTED', 'APPROVED') and (
      v_existing.sales_target is distinct from coalesce((v_row ->> 'sales_target')::numeric, 0)
      or v_existing.collect_target is distinct from coalesce((v_row ->> 'collect_target')::numeric, 0)
      or v_existing.customers_target is distinct from coalesce((v_row ->> 'customers_target')::integer, 0)
    ) then
      raise exception 'Chỉ tiêu đã gửi duyệt / đã duyệt — không sửa được.' using errcode = '23514';
    end if;
    insert into public.kpi_sales_targets (period_month, user_id, sales_target, collect_target, customers_target, updated_by)
    values (v_month, v_user,
      coalesce((v_row ->> 'sales_target')::numeric, 0),
      coalesce((v_row ->> 'collect_target')::numeric, 0),
      coalesce((v_row ->> 'customers_target')::integer, 0),
      auth.uid())
    on conflict (period_month, user_id) do update set
      sales_target = excluded.sales_target,
      collect_target = excluded.collect_target,
      customers_target = excluded.customers_target,
      status = case when kpi_sales_targets.status = 'CHANGES' then 'DRAFT' else kpi_sales_targets.status end,
      updated_by = auth.uid(), updated_at = now();
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- Nhập số liệu thực hiện (từ báo cáo AMIS) — Kế toán công nợ / người cấu hình KPI.
create or replace function public.kpi_save_sales_actuals(p_month date, p_rows jsonb)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_month date := date_trunc('month', p_month)::date;
  v_row jsonb;
  v_count integer := 0;
begin
  if not (public.kpi_can_manage() or public.kpi_can_close()) then
    raise exception 'Bạn không có quyền nhập số liệu kinh doanh.' using errcode = '42501';
  end if;
  if exists (select 1 from public.kpi_periods where month_start = v_month and status = 'LOCKED') then
    raise exception 'Kỳ KPI tháng % đã khoá sổ.', to_char(v_month, 'MM/YYYY') using errcode = '23514';
  end if;
  for v_row in select * from jsonb_array_elements(p_rows) loop
    update public.kpi_sales_targets set
      sales_actual = (v_row ->> 'sales_actual')::numeric,
      collect_actual = (v_row ->> 'collect_actual')::numeric,
      customers_actual = (v_row ->> 'customers_actual')::integer,
      actual_note = coalesce(nullif(trim(v_row ->> 'note'), ''), actual_note),
      confirm_status = null,
      updated_by = auth.uid(), updated_at = now()
    where period_month = v_month and user_id = (v_row ->> 'user_id')::uuid;
    if found then v_count := v_count + 1; end if;
  end loop;
  -- Đổ % đạt vào các tiêu chí tự điền của phiếu đang mở
  perform public.kpi_fill_sources(v_month, null);
  return v_count;
end;
$$;

-- Gửi duyệt / duyệt / yêu cầu điều chỉnh chỉ tiêu.
create or replace function public.kpi_review_sales_targets(p_month date, p_users uuid[], p_action text, p_reason text default null)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_month date := date_trunc('month', p_month)::date;
  v_count integer;
begin
  if p_action = 'SUBMIT' then
    update public.kpi_sales_targets set status = 'SUBMITTED', submitted_by = auth.uid(), submitted_at = now(), review_reason = null
    where period_month = v_month and user_id = any(p_users) and status in ('DRAFT', 'CHANGES')
      and (public.kpi_can_manage() or public.kpi_is_manager_of(user_id));
  elsif p_action = 'APPROVE' then
    if not public.kpi_is_board() then
      raise exception 'Chỉ Ban Giám đốc duyệt chỉ tiêu kinh doanh.' using errcode = '42501';
    end if;
    update public.kpi_sales_targets set status = 'APPROVED', approved_by = auth.uid(), approved_at = now(), review_reason = null
    where period_month = v_month and user_id = any(p_users) and status = 'SUBMITTED';
  elsif p_action = 'CHANGES' then
    if not public.kpi_is_board() then
      raise exception 'Chỉ Ban Giám đốc yêu cầu điều chỉnh chỉ tiêu.' using errcode = '42501';
    end if;
    if length(trim(coalesce(p_reason, ''))) < 3 then
      raise exception 'Nhập lý do yêu cầu điều chỉnh.' using errcode = '23514';
    end if;
    update public.kpi_sales_targets set status = 'CHANGES', review_reason = trim(p_reason)
    where period_month = v_month and user_id = any(p_users) and status = 'SUBMITTED';
  else
    raise exception 'Thao tác không hợp lệ.' using errcode = '22023';
  end if;
  get diagnostics v_count = row_count;
  perform public.kpi_log(null, v_month, null, 'SALES_' || p_action, null, null, p_reason,
    jsonb_build_object('users', to_jsonb(p_users), 'count', v_count));
  return v_count;
end;
$$;

-- Nhân viên xác nhận / khiếu nại số liệu doanh số của mình.
create or replace function public.kpi_confirm_sales(p_month date, p_confirm boolean, p_note text default null)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not p_confirm and length(trim(coalesce(p_note, ''))) < 3 then
    raise exception 'Ghi rõ nội dung khiếu nại.' using errcode = '23514';
  end if;
  update public.kpi_sales_targets set
    confirm_status = case when p_confirm then 'CONFIRMED' else 'DISPUTED' end,
    dispute_note = case when p_confirm then null else trim(p_note) end,
    updated_at = now()
  where period_month = date_trunc('month', p_month)::date and user_id = auth.uid();
  if not found then
    raise exception 'Bạn chưa có chỉ tiêu kinh doanh tháng này.' using errcode = 'P0002';
  end if;
  perform public.kpi_log(null, date_trunc('month', p_month)::date, auth.uid(),
    case when p_confirm then 'SALES_CONFIRM' else 'SALES_DISPUTE' end, null, null, p_note);
end;
$$;

grant execute on function public.kpi_sales_pct(numeric, numeric), public.kpi_save_sales_targets(date, jsonb),
  public.kpi_save_sales_actuals(date, jsonb), public.kpi_review_sales_targets(date, uuid[], text, text),
  public.kpi_confirm_sales(date, boolean, text) to authenticated;

-- Đổ % đạt chỉ tiêu KD vào các tiêu chí có nguồn tự điền (cả tự chấm lẫn quản lý chấm).
create or replace function public.kpi_fill_sources(p_month date, p_user uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  r record;
  v_value numeric;
begin
  for r in
    select i.id, i.source, i.sheet_id, t.sales_actual, t.sales_target, t.collect_actual, t.collect_target,
      t.customers_actual, t.customers_target
    from public.kpi_sheet_items i
    join public.kpi_sheets s on s.id = i.sheet_id
    join public.kpi_sales_targets t on t.period_month = s.period_month and t.user_id = s.user_id
    where s.period_month = date_trunc('month', p_month)::date
      and (p_user is null or s.user_id = p_user)
      and s.status in ('DRAFT', 'PENDING', 'REJECTED', 'BOARD')
      and i.source in ('SALES_PCT', 'COLLECT_PCT', 'COVERAGE_PCT')
  loop
    v_value := case r.source
      when 'SALES_PCT' then public.kpi_sales_pct(r.sales_actual, r.sales_target)
      when 'COLLECT_PCT' then public.kpi_sales_pct(r.collect_actual, r.collect_target)
      when 'COVERAGE_PCT' then public.kpi_sales_pct(r.customers_actual, r.customers_target)
    end;
    if v_value is not null then
      update public.kpi_sheet_items set self_value = v_value, mgr_value = v_value where id = r.id;
      perform public.kpi_recalc_sheet(r.sheet_id);
    end if;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Mở kỳ & sinh phiếu
-- ---------------------------------------------------------------------------

-- Bộ KPI áp cho một người trong tháng: cá nhân > vị trí > đơn vị gần nhất.
create or replace function public.kpi_set_for(p_user uuid, p_month date)
returns uuid
language sql stable security definer set search_path = public as $$
  with recursive person as (
    select id, unit_id, position_id from public.profiles where id = p_user
  ), lineage as (
    select u.id, u.parent_id, 0 as depth from public.organization_units u join person p on p.unit_id = u.id
    union all
    select u.id, u.parent_id, l.depth + 1 from public.organization_units u join lineage l on u.id = l.parent_id
    where l.depth < 10
  )
  select s.id from public.kpi_sets s, person p
  where s.is_active and s.effective_from <= date_trunc('month', p_month)::date
    and (
      s.user_id = p.id
      or (s.user_id is null and s.position_id is not null and s.position_id = p.position_id)
      or (s.user_id is null and s.position_id is null and s.unit_id in (select id from lineage))
    )
  order by
    case when s.user_id is not null then 0 when s.position_id is not null then 1 else 2 end,
    coalesce((select depth from lineage l where l.id = s.unit_id), 0),
    s.effective_from desc
  limit 1;
$$;

grant execute on function public.kpi_set_for(uuid, date) to authenticated;

-- Phiếu cần BGĐ duyệt cuối: bộ có cờ, khối Kinh doanh, hoặc người là trưởng đơn vị.
create or replace function public.kpi_needs_board(p_user uuid, p_set uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select board_review or block = 'KINH_DOANH' from public.kpi_sets where id = p_set), false)
    or exists (select 1 from public.organization_units u where u.manager_id = p_user)
    or exists (
      select 1 from public.profiles p join public.job_positions j on j.id = p.position_id
      where p.id = p_user and j.is_manager
    );
$$;

-- Tạo phiếu cho một người từ bộ KPI (bản chụp tiêu chí).
create or replace function public.kpi_create_sheet(p_month date, p_user uuid, p_set uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_set public.kpi_sets;
  v_reviewer uuid;
begin
  select * into v_set from public.kpi_sets where id = p_set;
  select coalesce(p.manager_id, nullif(u.manager_id, p.id)) into v_reviewer
  from public.profiles p left join public.organization_units u on u.id = p.unit_id
  where p.id = p_user;

  insert into public.kpi_sheets (period_month, user_id, set_id, set_name, block, unit_id, reviewer_id, board_review)
  select p_month, p.id, v_set.id, v_set.name, v_set.block, p.unit_id, v_reviewer,
    v_reviewer is null or public.kpi_needs_board(p.id, v_set.id)
  from public.profiles p where p.id = p_user
  on conflict (period_month, user_id) do nothing
  returning id into v_id;
  if v_id is null then return null; end if;

  insert into public.kpi_sheet_items (sheet_id, sort_order, category, name, measure, group_code, weight,
    standard_score, method, levels, ranges, value_unit, penalty_pct, allow_over, source)
  select v_id, sort_order, category, name, measure, group_code, weight,
    standard_score, method, levels, ranges, value_unit, penalty_pct, allow_over, source
  from public.kpi_set_items where set_id = p_set order by sort_order;

  perform public.kpi_recalc_sheet(v_id);
  perform public.kpi_log(v_id, p_month, p_user, 'CREATE', null, 'DRAFT', null, jsonb_build_object('set', v_set.name));
  return v_id;
end;
$$;

-- Mở kỳ (hoặc bổ sung phiếu cho người mới): trả về số phiếu tạo và danh sách người chưa có bộ KPI.
create or replace function public.kpi_open_period(p_month date)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_month date := date_trunc('month', p_month)::date;
  v_period public.kpi_periods;
  r record;
  v_set uuid;
  v_created integer := 0;
  v_missing jsonb := '[]'::jsonb;
begin
  if not public.kpi_can_manage() then
    raise exception 'Bạn không có quyền mở kỳ KPI.' using errcode = '42501';
  end if;
  select * into v_period from public.kpi_periods where month_start = v_month;
  if v_period.status = 'LOCKED' then
    raise exception 'Kỳ KPI tháng % đã khoá sổ.', to_char(v_month, 'MM/YYYY') using errcode = '23514';
  end if;
  if v_period.month_start is null then
    insert into public.kpi_periods (month_start, opened_by) values (v_month, auth.uid());
    perform public.kpi_log(null, v_month, null, 'PERIOD_OPEN', null, 'OPEN', null);
  end if;

  for r in
    select p.id, p.name from public.profiles p
    where p.is_active
      and coalesce(p.employment_status, 'active') in ('active', 'probation')
      and not exists (select 1 from public.kpi_exemptions e where e.user_id = p.id)
      and not exists (select 1 from public.kpi_sheets s where s.period_month = v_month and s.user_id = p.id)
    order by p.name
  loop
    v_set := public.kpi_set_for(r.id, v_month);
    if v_set is null then
      v_missing := v_missing || jsonb_build_object('user_id', r.id, 'name', r.name);
    elsif public.kpi_create_sheet(v_month, r.id, v_set) is not null then
      v_created := v_created + 1;
    end if;
  end loop;

  perform public.kpi_fill_sources(v_month, null);
  return jsonb_build_object('created', v_created, 'missing', v_missing);
end;
$$;

grant execute on function public.kpi_open_period(date) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Chấm & duyệt
-- ---------------------------------------------------------------------------

create or replace function public.kpi_sheet_for_update(p_sheet uuid)
returns public.kpi_sheets
language plpgsql security definer set search_path = public as $$
declare
  v_sheet public.kpi_sheets;
begin
  select * into v_sheet from public.kpi_sheets where id = p_sheet for update;
  if v_sheet.id is null then
    raise exception 'Không tìm thấy phiếu KPI.' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.kpi_periods where month_start = v_sheet.period_month and status = 'LOCKED')
     and not exists (select 1 from public.kpi_reopen_requests q where q.sheet_id = p_sheet and q.status = 'APPROVED' and q.closed_at is null) then
    raise exception 'Kỳ KPI tháng % đã khoá sổ — muốn sửa phải mở lại phiếu.', to_char(v_sheet.period_month, 'MM/YYYY')
      using errcode = '23514';
  end if;
  return v_sheet;
end;
$$;

-- Vai trò của người đang đăng nhập với một phiếu.
create or replace function public.kpi_sheet_role(p_sheet public.kpi_sheets)
returns text
language plpgsql stable security definer set search_path = public as $$
declare
  v_now timestamptz := now();
begin
  if p_sheet.status = 'BOARD' and public.kpi_is_board() then return 'BOARD'; end if;
  if p_sheet.status = 'PENDING' and public.kpi_is_board() and v_now > public.kpi_deadline(p_sheet.period_month, 'MANAGER') then
    return 'BOARD';
  end if;
  -- Không có quản lý trực tiếp (trưởng bộ phận): Ban Giám đốc chấm và duyệt luôn
  if p_sheet.status = 'PENDING' and p_sheet.reviewer_id is null and public.kpi_is_board() then return 'BOARD'; end if;
  if p_sheet.status = 'PENDING' and (p_sheet.reviewer_id = auth.uid() or public.kpi_can_manage()) then
    return 'MANAGER';
  end if;
  -- Phiếu mở lại sau khoá sổ: Kế toán trưởng chấm lại và duyệt lại
  if p_sheet.status = 'PENDING' and public.kpi_can_close() and exists (
    select 1 from public.kpi_reopen_requests q where q.sheet_id = p_sheet.id and q.status = 'APPROVED' and q.closed_at is null
  ) then
    return 'MANAGER';
  end if;
  if p_sheet.status in ('DRAFT', 'REJECTED')
     and (p_sheet.reviewer_id = auth.uid() or public.kpi_can_manage())
     and v_now > public.kpi_deadline(p_sheet.period_month, 'SELF') then
    return 'MANAGER';
  end if;
  if p_sheet.status in ('DRAFT', 'REJECTED') and p_sheet.user_id = auth.uid() then return 'SELF'; end if;
  return null;
end;
$$;

grant execute on function public.kpi_sheet_role(public.kpi_sheets) to authenticated;

-- Nhân viên lưu phần tự chấm. p_items: [{id, value, score, na, note, evidence_url, evidence_path, evidence_name}]
create or replace function public.kpi_save_self(p_sheet uuid, p_items jsonb, p_explanation text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_sheet public.kpi_sheets := public.kpi_sheet_for_update(p_sheet);
  v_item jsonb;
begin
  if v_sheet.user_id <> auth.uid() or v_sheet.status not in ('DRAFT', 'REJECTED') then
    raise exception 'Phiếu không ở bước tự chấm.' using errcode = '42501';
  end if;
  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    update public.kpi_sheet_items i set
      self_value = case when i.source is not null and i.source <> 'LATE_COUNT' then i.self_value
                        else nullif(v_item ->> 'value', '')::numeric end,
      self_score = case when i.method in ('LEVEL', 'BINARY') then nullif(v_item ->> 'score', '')::numeric else i.self_score end,
      self_na = coalesce((v_item ->> 'na')::boolean, false),
      self_note = nullif(trim(v_item ->> 'note'), ''),
      evidence_url = nullif(trim(v_item ->> 'evidence_url'), ''),
      evidence_path = nullif(v_item ->> 'evidence_path', ''),
      evidence_name = nullif(v_item ->> 'evidence_name', '')
    where i.id = (v_item ->> 'id')::uuid and i.sheet_id = p_sheet;
  end loop;
  -- Điểm vượt chuẩn chỉ với tiêu chí cho phép, tối đa 5
  if exists (
    select 1 from public.kpi_sheet_items
    where sheet_id = p_sheet and self_score is not null
      and (self_score < 0 or self_score > case when allow_over then 5 else standard_score end)
  ) then
    raise exception 'Có điểm tự chấm vượt điểm chuẩn của tiêu chí.' using errcode = '23514';
  end if;
  update public.kpi_sheets set explanation = nullif(trim(p_explanation), '') where id = p_sheet;
  perform public.kpi_recalc_sheet(p_sheet);
end;
$$;

-- Gửi duyệt: đủ điểm mọi tiêu chí; có minh chứng hoặc giải trình; điểm vượt chuẩn phải có ghi chú.
create or replace function public.kpi_submit(p_sheet uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_sheet public.kpi_sheets := public.kpi_sheet_for_update(p_sheet);
  v_missing text;
begin
  if v_sheet.user_id <> auth.uid() or v_sheet.status not in ('DRAFT', 'REJECTED') then
    raise exception 'Phiếu không ở bước tự chấm.' using errcode = '42501';
  end if;
  select string_agg(name, ', ' order by sort_order) into v_missing
  from public.kpi_sheet_items
  where sheet_id = p_sheet and not self_na and self_points is null;
  if v_missing is not null then
    raise exception 'Chưa chấm: %.', v_missing using errcode = '23514';
  end if;
  select string_agg(name, ', ' order by sort_order) into v_missing
  from public.kpi_sheet_items
  where sheet_id = p_sheet and not self_na and self_score > standard_score
    and self_note is null and evidence_url is null and evidence_path is null;
  if v_missing is not null then
    raise exception 'Điểm vượt chuẩn cần minh chứng hoặc giải trình: %.', v_missing using errcode = '23514';
  end if;
  if v_sheet.explanation is null and not exists (
    select 1 from public.kpi_sheet_items
    where sheet_id = p_sheet and (self_note is not null or evidence_url is not null or evidence_path is not null)
  ) then
    raise exception 'Thêm minh chứng hoặc giải trình trước khi gửi.' using errcode = '23514';
  end if;

  update public.kpi_sheets set status = 'PENDING', submitted_at = now(), return_reason = null where id = p_sheet;
  -- Quản lý bắt đầu từ điểm tự chấm
  update public.kpi_sheet_items set
    mgr_value = coalesce(mgr_value, self_value),
    mgr_score = coalesce(mgr_score, self_score),
    mgr_na = self_na
  where sheet_id = p_sheet and mgr_reason is null;
  perform public.kpi_recalc_sheet(p_sheet);
  perform public.kpi_log(p_sheet, v_sheet.period_month, v_sheet.user_id, 'SUBMIT', v_sheet.status, 'PENDING', null,
    jsonb_build_object('self_pct', (select self_pct from public.kpi_sheets where id = p_sheet)));
end;
$$;

-- Quản lý / BGĐ lưu điểm duyệt. p_items: [{id, value, score, na, reason}]
create or replace function public.kpi_save_review(p_sheet uuid, p_items jsonb, p_bonus numeric, p_bonus_note text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_sheet public.kpi_sheets := public.kpi_sheet_for_update(p_sheet);
  v_role text := public.kpi_sheet_role(v_sheet);
  v_item jsonb;
  v_max numeric := (public.kpi_settings_for(v_sheet.period_month)).bonus_max_pct;
begin
  if v_role not in ('MANAGER', 'BOARD') then
    raise exception 'Bạn không chấm được phiếu này ở bước hiện tại.' using errcode = '42501';
  end if;
  if coalesce(p_bonus, 0) < 0 or coalesce(p_bonus, 0) > v_max then
    raise exception 'Thưởng trọng điểm tối đa %%%.', v_max using errcode = '23514';
  end if;
  if coalesce(p_bonus, 0) > 0 and length(trim(coalesce(p_bonus_note, ''))) < 3 then
    raise exception 'Ghi nội dung công việc trọng điểm được thưởng.' using errcode = '23514';
  end if;
  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    update public.kpi_sheet_items i set
      mgr_value = case when i.source is not null and i.source <> 'LATE_COUNT' then i.mgr_value
                       else nullif(v_item ->> 'value', '')::numeric end,
      mgr_score = case when i.method in ('LEVEL', 'BINARY') then nullif(v_item ->> 'score', '')::numeric else i.mgr_score end,
      mgr_na = coalesce((v_item ->> 'na')::boolean, false),
      mgr_reason = nullif(trim(v_item ->> 'reason'), '')
    where i.id = (v_item ->> 'id')::uuid and i.sheet_id = p_sheet;
  end loop;
  if exists (
    select 1 from public.kpi_sheet_items
    where sheet_id = p_sheet and mgr_score is not null
      and (mgr_score < 0 or mgr_score > case when allow_over then 5 else standard_score end)
  ) then
    raise exception 'Có điểm duyệt vượt điểm chuẩn của tiêu chí.' using errcode = '23514';
  end if;
  update public.kpi_sheets set bonus_pct = coalesce(p_bonus, 0), bonus_note = nullif(trim(p_bonus_note), '')
  where id = p_sheet;
  perform public.kpi_recalc_sheet(p_sheet);
end;
$$;

-- Duyệt: quản lý → APPROVED (hoặc chuyển BGĐ); BGĐ → APPROVED.
create or replace function public.kpi_approve(p_sheet uuid, p_note text default null)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_sheet public.kpi_sheets := public.kpi_sheet_for_update(p_sheet);
  v_role text := public.kpi_sheet_role(v_sheet);
  v_missing text;
  v_next text;
  v_after public.kpi_sheets;
begin
  if v_role not in ('MANAGER', 'BOARD') then
    raise exception 'Bạn không duyệt được phiếu này ở bước hiện tại.' using errcode = '42501';
  end if;
  -- Phiếu nhân viên chưa tự chấm (quá hạn): quản lý chấm thẳng từ đầu
  select string_agg(name, ', ' order by sort_order) into v_missing
  from public.kpi_sheet_items where sheet_id = p_sheet and not mgr_na and mgr_points is null;
  if v_missing is not null then
    raise exception 'Chưa chấm: %.', v_missing using errcode = '23514';
  end if;
  select string_agg(name, ', ' order by sort_order) into v_missing
  from public.kpi_sheet_items
  where sheet_id = p_sheet and mgr_reason is null and v_sheet.status not in ('DRAFT', 'REJECTED')
    and (mgr_score is distinct from self_score or mgr_value is distinct from self_value or mgr_na is distinct from self_na);
  if v_missing is not null then
    raise exception 'Điểm duyệt khác điểm tự chấm cần lý do: %.', v_missing using errcode = '23514';
  end if;

  v_next := case when v_role = 'MANAGER' and v_sheet.board_review then 'BOARD' else 'APPROVED' end;
  update public.kpi_sheets set
    status = v_next,
    reviewed_by = case when v_role = 'MANAGER' then auth.uid() else reviewed_by end,
    reviewed_at = case when v_role = 'MANAGER' then now() else reviewed_at end,
    approved_by = case when v_next = 'APPROVED' then auth.uid() else approved_by end,
    approved_at = case when v_next = 'APPROVED' then now() else approved_at end,
    return_reason = null
  where id = p_sheet
  returning * into v_after;

  perform public.kpi_log(p_sheet, v_sheet.period_month, v_sheet.user_id,
    case when v_role = 'BOARD' then 'BOARD_APPROVE' when v_next = 'BOARD' then 'MANAGER_APPROVE' else 'APPROVE' end,
    v_sheet.status, v_next, p_note,
    jsonb_build_object('manager_pct', v_after.manager_pct, 'bonus_pct', v_after.bonus_pct,
      'final_pct', v_after.final_pct, 'grade', v_after.grade));

  -- Phiếu được duyệt sau khi kỳ đã khoá (mở lại) thì đẩy ngay sang lương
  if v_next = 'APPROVED' and exists (select 1 from public.kpi_periods where month_start = v_sheet.period_month and status = 'LOCKED') then
    update public.kpi_reopen_requests set closed_at = now(), new_pct = v_after.final_pct
    where sheet_id = p_sheet and status = 'APPROVED' and closed_at is null;
    perform public.kpi_sync_payroll(v_sheet.period_month, v_sheet.user_id);
  end if;
  return v_next;
end;
$$;

-- Trả về kèm lý do.
create or replace function public.kpi_return(p_sheet uuid, p_reason text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_sheet public.kpi_sheets := public.kpi_sheet_for_update(p_sheet);
  v_role text := public.kpi_sheet_role(v_sheet);
begin
  if v_role not in ('MANAGER', 'BOARD') or v_sheet.status not in ('PENDING', 'BOARD') then
    raise exception 'Bạn không trả được phiếu này ở bước hiện tại.' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Nhập lý do trả về.' using errcode = '23514';
  end if;
  update public.kpi_sheets set
    status = case when v_sheet.status = 'BOARD' then 'PENDING' else 'REJECTED' end,
    return_reason = trim(p_reason)
  where id = p_sheet;
  perform public.kpi_log(p_sheet, v_sheet.period_month, v_sheet.user_id, 'RETURN', v_sheet.status,
    case when v_sheet.status = 'BOARD' then 'PENDING' else 'REJECTED' end, p_reason);
end;
$$;

grant execute on function public.kpi_save_self(uuid, jsonb, text), public.kpi_submit(uuid),
  public.kpi_save_review(uuid, jsonb, numeric, text), public.kpi_approve(uuid, text),
  public.kpi_return(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. Liên kết lương
-- ---------------------------------------------------------------------------
create table if not exists public.kpi_payroll_links (
  source text primary key check (source in (
    'KPI_PCT', 'KPI_BONUS', 'SALES_ACTUAL', 'SALES_PCT', 'COLLECT_ACTUAL', 'COLLECT_PCT', 'YEAR_BONUS'
  )),
  component_code text,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

insert into public.kpi_payroll_links (source) values
  ('KPI_PCT'), ('KPI_BONUS'), ('SALES_ACTUAL'), ('SALES_PCT'), ('COLLECT_ACTUAL'), ('COLLECT_PCT'), ('YEAR_BONUS')
on conflict (source) do nothing;

-- Một đầu mục chỉ nhận số từ một nguồn KPI.
create unique index if not exists kpi_payroll_links_component_idx
  on public.kpi_payroll_links(upper(component_code)) where component_code is not null;

create or replace function public.guard_kpi_payroll_link()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.component_code := nullif(upper(trim(new.component_code)), '');
  new.updated_at := now();
  new.updated_by := auth.uid();
  if new.component_code is not null and not exists (
    select 1 from public.payroll_components c where upper(c.code) = new.component_code
  ) then
    raise exception 'Không có đầu mục lương mã %.', new.component_code using errcode = '23503';
  end if;
  return new;
end;
$$;

drop trigger if exists kpi_payroll_links_guard on public.kpi_payroll_links;
create trigger kpi_payroll_links_guard before insert or update on public.kpi_payroll_links
  for each row execute function public.guard_kpi_payroll_link();

-- Mã nào trong số liệu lương tháng là do KPI ghi (không sửa tay ở Bảng lương).
create or replace function public.kpi_payroll_codes()
returns text[]
language sql stable security definer set search_path = public as $$
  select array['KPI_PCT'] || coalesce(array_agg(component_code) filter (where component_code is not null), '{}')
  from public.kpi_payroll_links;
$$;

grant execute on function public.kpi_payroll_codes() to authenticated;

create or replace function public.guard_kpi_payroll_inputs_readonly()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if upper(new.code) = any(public.kpi_payroll_codes())
     and coalesce(current_setting('app.kpi_payroll_sync', true), '') <> 'on' then
    raise exception 'Số liệu “%” do KPI tự điền khi khoá sổ kỳ KPI — sửa ở phiếu KPI, không sửa tay ở Bảng lương.', new.code
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists payroll_inputs_kpi_readonly_guard on public.payroll_inputs;
create trigger payroll_inputs_kpi_readonly_guard
  before insert or update on public.payroll_inputs
  for each row execute function public.guard_kpi_payroll_inputs_readonly();

-- Ghi một mã vào số liệu lương tháng (bỏ qua khi kỳ lương đã khoá).
create or replace function public.kpi_put_payroll_input(p_user uuid, p_month date, p_code text, p_value numeric, p_note text)
returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if p_code is null then return false; end if;
  if to_regprocedure('public.payroll_month_closed(date)') is not null and public.payroll_month_closed(p_month) then
    return false;
  end if;
  perform set_config('app.kpi_payroll_sync', 'on', true);
  if p_value is null then
    delete from public.payroll_inputs where user_id = p_user and month_start = p_month and upper(code) = upper(p_code);
  else
    insert into public.payroll_inputs (user_id, month_start, code, quantity, note)
    values (p_user, p_month, upper(p_code), p_value, p_note)
    on conflict (user_id, month_start, code)
    do update set quantity = excluded.quantity, note = excluded.note, updated_at = now();
  end if;
  perform set_config('app.kpi_payroll_sync', 'off', true);
  return true;
end;
$$;

-- Đẩy kết quả KPI đã duyệt của tháng sang số liệu lương (một người hoặc cả tháng).
create or replace function public.kpi_sync_payroll(p_month date, p_user uuid default null)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_month date := date_trunc('month', p_month)::date;
  v_link record;
  r record;
  v_value numeric;
  v_count integer := 0;
begin
  if exists (select 1 from public.kpi_periods where month_start = v_month and status = 'LOCKED') is not true then
    return 0;
  end if;

  for r in
    select p.id as user_id, s.id as sheet_id, s.status, s.final_pct, s.bonus_pct,
      t.status as target_status, t.sales_actual, t.sales_target, t.collect_actual, t.collect_target
    from public.profiles p
    left join public.kpi_sheets s on s.period_month = v_month and s.user_id = p.id
    left join public.kpi_sales_targets t on t.period_month = v_month and t.user_id = p.id
    where (p_user is null or p.id = p_user) and (s.id is not null or t.id is not null)
  loop
    -- Phiếu chưa duyệt không sang lương kỳ này (truy lĩnh khi duyệt bổ sung).
    perform public.kpi_put_payroll_input(r.user_id, v_month, 'KPI_PCT',
      case when r.status = 'APPROVED' then r.final_pct end, 'Tự động từ phiếu KPI đã duyệt.');
    for v_link in select * from public.kpi_payroll_links where component_code is not null and source <> 'YEAR_BONUS' loop
      v_value := case v_link.source
        when 'KPI_PCT' then case when r.status = 'APPROVED' then r.final_pct end
        when 'KPI_BONUS' then case when r.status = 'APPROVED' then r.bonus_pct end
        when 'SALES_ACTUAL' then case when r.target_status = 'APPROVED' then r.sales_actual end
        when 'SALES_PCT' then case when r.target_status = 'APPROVED' then public.kpi_sales_pct(r.sales_actual, r.sales_target) end
        when 'COLLECT_ACTUAL' then case when r.target_status = 'APPROVED' then r.collect_actual end
        when 'COLLECT_PCT' then case when r.target_status = 'APPROVED' then public.kpi_sales_pct(r.collect_actual, r.collect_target) end
      end;
      perform public.kpi_put_payroll_input(r.user_id, v_month, v_link.component_code, v_value,
        'Tự động từ KPI tháng ' || to_char(v_month, 'MM/YYYY') || '.');
    end loop;
    if r.sheet_id is not null then
      update public.kpi_sheets set payroll_synced_at = now() where id = r.sheet_id and status = 'APPROVED';
    end if;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

grant execute on function public.kpi_sync_payroll(date, uuid) to authenticated;

-- Đổi liên kết lương thì đồng bộ lại các kỳ KPI đã khoá mà kỳ lương còn mở.
create or replace function public.kpi_save_payroll_links(p_links jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_old text;
  v_link jsonb;
  v_month date;
begin
  if not (public.kpi_can_manage() or public.can_function('admin.payroll_settings')) then
    raise exception 'Bạn không có quyền đổi liên kết lương.' using errcode = '42501';
  end if;
  for v_link in select * from jsonb_array_elements(p_links) loop
    select component_code into v_old from public.kpi_payroll_links where source = v_link ->> 'source';
    if v_old is not null and v_old is distinct from nullif(upper(trim(v_link ->> 'component_code')), '') then
      -- Gỡ số đã điền ở mã cũ của các kỳ lương còn mở
      perform set_config('app.kpi_payroll_sync', 'on', true);
      delete from public.payroll_inputs i
      where upper(i.code) = v_old
        and (to_regprocedure('public.payroll_month_closed(date)') is null or not public.payroll_month_closed(i.month_start));
      perform set_config('app.kpi_payroll_sync', 'off', true);
    end if;
    update public.kpi_payroll_links set component_code = nullif(upper(trim(v_link ->> 'component_code')), '')
    where source = v_link ->> 'source';
  end loop;
  for v_month in select month_start from public.kpi_periods where status = 'LOCKED' loop
    perform public.kpi_sync_payroll(v_month, null);
  end loop;
end;
$$;

grant execute on function public.kpi_save_payroll_links(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 10. Khoá sổ & mở lại
-- ---------------------------------------------------------------------------
create table if not exists public.kpi_reopen_requests (
  id uuid primary key default gen_random_uuid(),
  sheet_id uuid not null references public.kpi_sheets(id) on delete cascade,
  reason text not null check (length(trim(reason)) >= 3),
  minutes_path text,
  minutes_name text,
  status text not null default 'PENDING' check (status in ('PENDING', 'APPROVED', 'REJECTED')),
  requested_by uuid references public.profiles(id) on delete set null,
  requested_at timestamptz not null default now(),
  decided_by uuid references public.profiles(id) on delete set null,
  decided_at timestamptz,
  decision_note text,
  old_pct numeric(7, 2),
  new_pct numeric(7, 2),
  closed_at timestamptz
);

create or replace function public.kpi_lock_period(p_month date)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_month date := date_trunc('month', p_month)::date;
  v_open integer;
  v_synced integer;
begin
  if not public.kpi_can_close() then
    raise exception 'Bạn không có quyền khoá sổ KPI.' using errcode = '42501';
  end if;
  update public.kpi_periods set status = 'LOCKED', locked_by = auth.uid(), locked_at = now()
  where month_start = v_month and status = 'OPEN';
  if not found then
    raise exception 'Kỳ KPI tháng % chưa mở hoặc đã khoá.', to_char(v_month, 'MM/YYYY') using errcode = '23514';
  end if;
  select count(*) into v_open from public.kpi_sheets where period_month = v_month and status <> 'APPROVED';
  v_synced := public.kpi_sync_payroll(v_month, null);
  perform public.kpi_log(null, v_month, null, 'PERIOD_LOCK', 'OPEN', 'LOCKED', null,
    jsonb_build_object('not_approved', v_open, 'synced', v_synced));
  return jsonb_build_object('not_approved', v_open, 'synced', v_synced);
end;
$$;

create or replace function public.kpi_request_reopen(p_sheet uuid, p_reason text, p_minutes_path text, p_minutes_name text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_sheet public.kpi_sheets;
  v_id uuid;
begin
  if not public.kpi_can_close() then
    raise exception 'Chỉ Kế toán trưởng lập đề nghị mở lại phiếu.' using errcode = '42501';
  end if;
  if nullif(trim(p_minutes_path), '') is null then
    raise exception 'Đính kèm biên bản điều chỉnh.' using errcode = '23514';
  end if;
  select * into v_sheet from public.kpi_sheets where id = p_sheet;
  if not exists (select 1 from public.kpi_periods where month_start = v_sheet.period_month and status = 'LOCKED') then
    raise exception 'Kỳ chưa khoá sổ — sửa trực tiếp trên phiếu.' using errcode = '23514';
  end if;
  if exists (select 1 from public.kpi_reopen_requests where sheet_id = p_sheet and (status = 'PENDING' or (status = 'APPROVED' and closed_at is null))) then
    raise exception 'Phiếu đang có đề nghị mở lại chưa xử lý xong.' using errcode = '23514';
  end if;
  insert into public.kpi_reopen_requests (sheet_id, reason, minutes_path, minutes_name, requested_by, old_pct)
  values (p_sheet, trim(p_reason), p_minutes_path, p_minutes_name, auth.uid(), v_sheet.final_pct)
  returning id into v_id;
  perform public.kpi_log(p_sheet, v_sheet.period_month, v_sheet.user_id, 'REOPEN_REQUEST', v_sheet.status, null, p_reason);
  return v_id;
end;
$$;

create or replace function public.kpi_decide_reopen(p_request uuid, p_approve boolean, p_note text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_req public.kpi_reopen_requests;
  v_sheet public.kpi_sheets;
begin
  if not public.kpi_is_board() then
    raise exception 'Chỉ Ban Giám đốc duyệt mở lại phiếu.' using errcode = '42501';
  end if;
  select * into v_req from public.kpi_reopen_requests where id = p_request and status = 'PENDING' for update;
  if v_req.id is null then
    raise exception 'Đề nghị không còn chờ duyệt.' using errcode = 'P0002';
  end if;
  if not p_approve and length(trim(coalesce(p_note, ''))) < 3 then
    raise exception 'Nhập lý do không duyệt.' using errcode = '23514';
  end if;
  update public.kpi_reopen_requests set
    status = case when p_approve then 'APPROVED' else 'REJECTED' end,
    decided_by = auth.uid(), decided_at = now(), decision_note = nullif(trim(p_note), ''),
    closed_at = case when p_approve then null else now() end
  where id = p_request;
  select * into v_sheet from public.kpi_sheets where id = v_req.sheet_id;
  if p_approve then
    update public.kpi_sheets set status = 'PENDING', version = version + 1, approved_at = null, approved_by = null
    where id = v_req.sheet_id;
  end if;
  perform public.kpi_log(v_sheet.id, v_sheet.period_month, v_sheet.user_id,
    case when p_approve then 'REOPEN' else 'REOPEN_REJECT' end, v_sheet.status,
    case when p_approve then 'PENDING' else v_sheet.status end, coalesce(p_note, v_req.reason),
    jsonb_build_object('version', v_sheet.version + case when p_approve then 1 else 0 end));
end;
$$;

grant execute on function public.kpi_lock_period(date), public.kpi_request_reopen(uuid, text, text, text),
  public.kpi_decide_reopen(uuid, boolean, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 11. Tổng hợp năm & quyết định thưởng / tăng lương
-- ---------------------------------------------------------------------------
create table if not exists public.kpi_year_reviews (
  year integer not null check (year between 2020 and 2100),
  user_id uuid not null references public.profiles(id) on delete cascade,
  months integer not null default 0,
  avg_pct numeric(7, 2),
  grade text,
  late_count integer,
  discipline_flag boolean not null default false,
  note text,
  bonus_amount numeric(16, 0),
  raise_pct numeric(6, 2),
  payout_month date,
  decision_reason text,
  status text not null default 'DRAFT' check (status in ('DRAFT', 'APPROVED')),
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (year, user_id)
);

-- BGĐ lưu / phê duyệt quyết định năm. p_rows: [{user_id, months, avg_pct, grade, late_count, discipline_flag,
-- note, bonus_amount, raise_pct, decision_reason}]
create or replace function public.kpi_save_year_reviews(p_year integer, p_rows jsonb, p_approve boolean, p_payout_month date)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_row jsonb;
  v_count integer := 0;
  v_code text;
begin
  if not public.kpi_is_board() then
    raise exception 'Chỉ Ban Giám đốc xét thưởng và tăng lương.' using errcode = '42501';
  end if;
  select component_code into v_code from public.kpi_payroll_links where source = 'YEAR_BONUS';
  for v_row in select * from jsonb_array_elements(p_rows) loop
    if exists (select 1 from public.kpi_year_reviews where year = p_year and user_id = (v_row ->> 'user_id')::uuid and status = 'APPROVED') then
      continue;
    end if;
    if coalesce((v_row ->> 'discipline_flag')::boolean, false) and coalesce((v_row ->> 'raise_pct')::numeric, 0) > 0 then
      raise exception 'Người bị kỷ luật trong năm không được đề xuất tăng lương.' using errcode = '23514';
    end if;
    insert into public.kpi_year_reviews (year, user_id, months, avg_pct, grade, late_count, discipline_flag, note,
      bonus_amount, raise_pct, payout_month, decision_reason, status, approved_by, approved_at, updated_by)
    values (p_year, (v_row ->> 'user_id')::uuid,
      coalesce((v_row ->> 'months')::integer, 0), (v_row ->> 'avg_pct')::numeric, v_row ->> 'grade',
      (v_row ->> 'late_count')::integer, coalesce((v_row ->> 'discipline_flag')::boolean, false),
      nullif(trim(v_row ->> 'note'), ''), (v_row ->> 'bonus_amount')::numeric, (v_row ->> 'raise_pct')::numeric,
      case when p_approve then date_trunc('month', p_payout_month)::date end,
      nullif(trim(v_row ->> 'decision_reason'), ''),
      case when p_approve then 'APPROVED' else 'DRAFT' end,
      case when p_approve then auth.uid() end, case when p_approve then now() end, auth.uid())
    on conflict (year, user_id) do update set
      months = excluded.months, avg_pct = excluded.avg_pct, grade = excluded.grade, late_count = excluded.late_count,
      discipline_flag = excluded.discipline_flag, note = excluded.note, bonus_amount = excluded.bonus_amount,
      raise_pct = excluded.raise_pct, payout_month = excluded.payout_month, decision_reason = excluded.decision_reason,
      status = excluded.status, approved_by = excluded.approved_by, approved_at = excluded.approved_at,
      updated_by = auth.uid(), updated_at = now();
    if p_approve and v_code is not null and p_payout_month is not null then
      perform public.kpi_put_payroll_input((v_row ->> 'user_id')::uuid, date_trunc('month', p_payout_month)::date,
        v_code, (v_row ->> 'bonus_amount')::numeric, 'Thưởng năm ' || p_year || ' đã duyệt.');
    end if;
    v_count := v_count + 1;
  end loop;
  perform public.kpi_log(null, make_date(p_year, 12, 1), null, case when p_approve then 'YEAR_APPROVE' else 'YEAR_SAVE' end,
    null, null, null, jsonb_build_object('count', v_count));
  return v_count;
end;
$$;

grant execute on function public.kpi_save_year_reviews(integer, jsonb, boolean, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 12. Kỳ lương đọc KPI mới
-- ---------------------------------------------------------------------------
-- Khoá lương cần kỳ KPI tháng đó đã khoá sổ (phiếu chưa duyệt không chặn — sang kỳ sau).
create or replace function public.kpi_open_count(p_month date)
returns integer
language sql stable security definer set search_path = public as $$
  select count(*)::integer from public.kpi_sheets s
  join public.kpi_periods p on p.month_start = s.period_month
  where s.period_month = date_trunc('month', p_month)::date and p.status <> 'LOCKED';
$$;

do $do$
begin
  if to_regprocedure('public.payroll_lock_readiness(date)') is not null then
    execute $f$
      create or replace function public.payroll_lock_readiness(p_month date)
      returns jsonb
      language plpgsql
      stable
      security definer
      set search_path = public
      as $$
      declare
        v_month date := date_trunc('month', p_month)::date;
      begin
        if auth.uid() is null or not (public.can_function('admin.payroll') or public.can_function('admin.payroll_approve')) then
          raise exception 'Bạn không có quyền với kỳ lương.' using errcode = '42501';
        end if;
        return jsonb_build_object(
          'timesheet_locked', exists (
            select 1 from public.timesheet_periods p where p.month_start = v_month and p.status = 'LOCKED'
          ),
          'open_kpi_reviews', public.kpi_open_count(v_month),
          'last_closed_month', public.payroll_last_closed_month()
        );
      end;
      $$
    $f$;
  end if;

  -- lock_payroll_run: thay đoạn đếm performance_reviews bằng kỳ KPI mới
  if to_regprocedure('public.lock_payroll_run(uuid)') is not null then
    execute replace(replace(replace(
      replace(pg_get_functiondef('public.lock_payroll_run(uuid)'::regprocedure), E'\r', ''),
      $old$execute 'select count(*) from public.performance_reviews where period_month = $1 and locked_at is null'
      into v_open_reviews using v_run.month_start;$old$,
      $new$v_open_reviews := public.kpi_open_count(v_run.month_start);$new$),
      $old$if to_regclass('public.performance_reviews') is not null then$old$, 'if true then'),
      'phiếu KPI tháng % chưa khoá (M05) — khoá KPI trước khi khoá lương.',
      'phiếu KPI tháng % thuộc kỳ chưa khoá sổ — khoá sổ KPI trước khi khoá lương.'
    );
    if position('kpi_open_count' in pg_get_functiondef('public.lock_payroll_run(uuid)'::regprocedure)) = 0 then
      raise warning 'lock_payroll_run chưa đổi sang kỳ KPI mới — kiểm tra lại.';
    end if;
  end if;
end;
$do$;

-- Trigger cũ đẩy KPI_PCT từ performance_reviews: tắt để không ghi chồng.
do $do$
begin
  if to_regclass('public.performance_reviews') is not null then
    execute 'drop trigger if exists performance_reviews_sync_payroll on public.performance_reviews';
  end if;
end;
$do$;

-- ---------------------------------------------------------------------------
-- 13. Minh chứng (Storage)
-- ---------------------------------------------------------------------------
-- Đường dẫn: <user_id>/<tháng>/<tên file> cho minh chứng; reopen/<sheet_id>/<file> cho biên bản.
do $do$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit)
    values ('kpi-evidence', 'kpi-evidence', false, 52428800)
    on conflict (id) do nothing;

    execute 'drop policy if exists kpi_evidence_files_read on storage.objects';
    execute $p$
      create policy kpi_evidence_files_read on storage.objects for select to authenticated
      using (bucket_id = 'kpi-evidence' and (
        (storage.foldername(name))[1] = auth.uid()::text
        or public.kpi_can_manage() or public.kpi_is_board() or public.kpi_can_close()
        or public.kpi_is_manager_of(nullif((storage.foldername(name))[1], '')::uuid)
        or (storage.foldername(name))[1] = 'reopen'
      ))
    $p$;
    execute 'drop policy if exists kpi_evidence_files_write on storage.objects';
    execute $p$
      create policy kpi_evidence_files_write on storage.objects for insert to authenticated
      with check (bucket_id = 'kpi-evidence' and (
        (storage.foldername(name))[1] = auth.uid()::text
        or ((storage.foldername(name))[1] = 'reopen' and public.kpi_can_close())
      ))
    $p$;
    execute 'drop policy if exists kpi_evidence_files_delete on storage.objects';
    execute $p$
      create policy kpi_evidence_files_delete on storage.objects for delete to authenticated
      using (bucket_id = 'kpi-evidence' and (storage.foldername(name))[1] = auth.uid()::text)
    $p$;
  end if;
end;
$do$;

-- ---------------------------------------------------------------------------
-- 14. Phân quyền đọc
-- ---------------------------------------------------------------------------
alter table public.kpi_settings enable row level security;
alter table public.kpi_sets enable row level security;
alter table public.kpi_set_items enable row level security;
alter table public.kpi_exemptions enable row level security;
alter table public.kpi_periods enable row level security;
alter table public.kpi_sheets enable row level security;
alter table public.kpi_sheet_items enable row level security;
alter table public.kpi_sales_targets enable row level security;
alter table public.kpi_logs enable row level security;
alter table public.kpi_reopen_requests enable row level security;
alter table public.kpi_year_reviews enable row level security;
alter table public.kpi_payroll_links enable row level security;

-- Ai xem được phiếu của p_user: chính họ, quản lý trực tiếp, người cấu hình, BGĐ, KTT.
create or replace function public.kpi_can_view_user(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() = p_user or public.kpi_can_manage() or public.kpi_is_board() or public.kpi_can_close()
    or public.kpi_is_manager_of(p_user)
    or exists (select 1 from public.kpi_sheets s where s.user_id = p_user and s.reviewer_id = auth.uid());
$$;
grant execute on function public.kpi_can_view_user(uuid) to authenticated;

drop policy if exists kpi_settings_read on public.kpi_settings;
create policy kpi_settings_read on public.kpi_settings for select to authenticated using (true);
drop policy if exists kpi_settings_manage on public.kpi_settings;
create policy kpi_settings_manage on public.kpi_settings for all to authenticated
  using (public.kpi_can_manage()) with check (public.kpi_can_manage());

drop policy if exists kpi_sets_read on public.kpi_sets;
create policy kpi_sets_read on public.kpi_sets for select to authenticated using (true);
drop policy if exists kpi_sets_manage on public.kpi_sets;
create policy kpi_sets_manage on public.kpi_sets for all to authenticated
  using (public.kpi_can_manage()) with check (public.kpi_can_manage());

drop policy if exists kpi_set_items_read on public.kpi_set_items;
create policy kpi_set_items_read on public.kpi_set_items for select to authenticated using (true);
drop policy if exists kpi_set_items_manage on public.kpi_set_items;
create policy kpi_set_items_manage on public.kpi_set_items for all to authenticated
  using (public.kpi_can_manage()) with check (public.kpi_can_manage());

drop policy if exists kpi_exemptions_read on public.kpi_exemptions;
create policy kpi_exemptions_read on public.kpi_exemptions for select to authenticated using (true);
drop policy if exists kpi_exemptions_manage on public.kpi_exemptions;
create policy kpi_exemptions_manage on public.kpi_exemptions for all to authenticated
  using (public.kpi_can_manage()) with check (public.kpi_can_manage());

drop policy if exists kpi_periods_read on public.kpi_periods;
create policy kpi_periods_read on public.kpi_periods for select to authenticated using (true);

drop policy if exists kpi_sheets_read on public.kpi_sheets;
create policy kpi_sheets_read on public.kpi_sheets for select to authenticated
  using (user_id = auth.uid() or reviewer_id = auth.uid() or public.kpi_can_view_user(user_id));

drop policy if exists kpi_sheet_items_read on public.kpi_sheet_items;
create policy kpi_sheet_items_read on public.kpi_sheet_items for select to authenticated
  using (exists (select 1 from public.kpi_sheets s where s.id = sheet_id
    and (s.user_id = auth.uid() or s.reviewer_id = auth.uid() or public.kpi_can_view_user(s.user_id))));

drop policy if exists kpi_sales_targets_read on public.kpi_sales_targets;
create policy kpi_sales_targets_read on public.kpi_sales_targets for select to authenticated
  using (public.kpi_can_view_user(user_id));

drop policy if exists kpi_logs_read on public.kpi_logs;
create policy kpi_logs_read on public.kpi_logs for select to authenticated
  using (user_id = auth.uid() or public.kpi_can_manage() or public.kpi_is_board() or public.kpi_can_close()
    or (user_id is not null and public.kpi_can_view_user(user_id)));

drop policy if exists kpi_reopen_requests_read on public.kpi_reopen_requests;
create policy kpi_reopen_requests_read on public.kpi_reopen_requests for select to authenticated
  using (public.kpi_can_manage() or public.kpi_is_board() or public.kpi_can_close());

drop policy if exists kpi_year_reviews_read on public.kpi_year_reviews;
create policy kpi_year_reviews_read on public.kpi_year_reviews for select to authenticated
  using (user_id = auth.uid() or public.kpi_is_board() or public.kpi_can_close() or public.kpi_can_manage());

drop policy if exists kpi_payroll_links_read on public.kpi_payroll_links;
create policy kpi_payroll_links_read on public.kpi_payroll_links for select to authenticated using (true);

grant select on public.kpi_settings, public.kpi_sets, public.kpi_set_items, public.kpi_exemptions,
  public.kpi_periods, public.kpi_sheets, public.kpi_sheet_items, public.kpi_sales_targets, public.kpi_logs,
  public.kpi_reopen_requests, public.kpi_year_reviews, public.kpi_payroll_links to authenticated;
grant insert, update, delete on public.kpi_settings, public.kpi_sets, public.kpi_set_items, public.kpi_exemptions
  to authenticated;

do $do$
begin
  begin
    alter publication supabase_realtime add table public.kpi_sheets, public.kpi_periods, public.kpi_sales_targets;
  exception when others then null;
  end;
end;
$do$;
