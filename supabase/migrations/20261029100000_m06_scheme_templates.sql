-- ============================================================================
-- M06 — Bộ cơ chế mẫu + cơ chế riêng của từng người cùng MỘT kiểu dòng.
-- ----------------------------------------------------------------------------
-- Trước đây cơ chế chung (unit_pay_items) và khai riêng (employee_pay_items) là
-- hai kiểu dữ liệu khác nhau: dòng chung mang đủ định nghĩa (cách lấy số, công
-- thức, thứ tự) và đơn vị con thừa hưởng; dòng riêng chỉ là con số / công thức
-- đè lên dòng chung. Giờ chỉ còn:
--
--   Cơ chế của người   employee_pay_items — danh sách dòng ĐẦY ĐỦ của người đó
--                      (cùng kiểu dòng với bộ mẫu: cách lấy số + công thức +
--                      thứ tự), theo phiên bản tháng.
--   Bộ cơ chế mẫu      payroll_schemes / payroll_scheme_items — danh sách dòng
--                      đặt tên sẵn để SAO CHÉP cho người khác. Sao chép là chép
--                      dòng sang người, không liên kết: sửa bộ mẫu không đổi
--                      cơ chế người đã chép.
--
-- Cơ chế chung theo đơn vị không còn tác dụng: unit_pay_items giữ nguyên làm
-- dữ liệu lịch sử, không bảng lương nào đọc nữa.
--
-- Chuyển dữ liệu (chạy một lần) sao cho dòng lương của từng người ra cùng số:
-- mỗi người nhận danh sách đã giải xong (cơ chế chung của các cấp đơn vị + khai
-- riêng), hiệu lực từ tháng hiện tại; phiên bản cũ của người đó đóng lại ngay
-- trước tháng này. Mỗi đơn vị có cơ chế chung được lưu thêm thành một bộ mẫu
-- mang tên đơn vị.
--
-- LƯU Ý CHẠY: toàn bộ file là MỘT câu lệnh (khối DO) vì SQL Editor của Supabase
-- không cho câu lệnh sau đọc thứ câu trước vừa tạo. Dán nguyên file rồi Run một
-- lần. Chạy lại được: bước chuyển dữ liệu chỉ chạy khi cột mode của
-- employee_pay_items chưa có.
-- ============================================================================

do $mig$
declare
  v_first boolean;
  v_month date := date_trunc('month', current_date)::date;
  v_end date := (date_trunc('month', current_date) + interval '1 month - 1 day')::date;
  v_person record;
  v_unit record;
  v_scheme uuid;
  v_name text;
  v_people integer := 0;
  v_schemes integer := 0;
  v_future integer := 0;
begin
  v_first := not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'employee_pay_items' and column_name = 'mode'
  );

  -- ------------------------------------------------------------------------
  -- 1. Dòng của người mang đủ định nghĩa như dòng của bộ mẫu
  -- ------------------------------------------------------------------------
  alter table public.employee_pay_items add column if not exists mode text not null default 'FORMULA';
  alter table public.employee_pay_items add column if not exists sort_order integer;
  alter table public.employee_pay_items drop constraint if exists employee_pay_items_mode_check;
  alter table public.employee_pay_items
    add constraint employee_pay_items_mode_check
    check (mode in ('FORMULA', 'VALUE', 'PER_PERSON', 'MONTHLY_INPUT'));
  comment on column public.employee_pay_items.mode is
    'Cách lấy giá trị của dòng: FORMULA công thức / VALUE số cố định / PER_PERSON mức riêng / MONTHLY_INPUT nhập hằng tháng.';

  if v_first then
    -- Dòng khai riêng cũ chỉ có số hoặc công thức: suy ra cách lấy giá trị.
    update public.employee_pay_items
    set mode = case when nullif(trim(coalesce(formula, '')), '') is not null then 'FORMULA' else 'VALUE' end;
  end if;

  -- ------------------------------------------------------------------------
  -- 2. Bộ cơ chế mẫu
  -- ------------------------------------------------------------------------
  create table if not exists public.payroll_schemes (
    id uuid primary key default gen_random_uuid(),
    name text not null check (length(trim(name)) > 0),
    created_by uuid references public.profiles(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );
  create unique index if not exists payroll_schemes_name_key on public.payroll_schemes (lower(trim(name)));

  create table if not exists public.payroll_scheme_items (
    id uuid primary key default gen_random_uuid(),
    scheme_id uuid not null references public.payroll_schemes(id) on delete cascade,
    component_id uuid not null references public.payroll_components(id) on delete cascade,
    mode text not null default 'FORMULA' check (mode in ('FORMULA', 'VALUE', 'PER_PERSON', 'MONTHLY_INPUT')),
    formula text,
    amount numeric(15, 2) check (amount is null or amount >= 0),
    sort_order integer,
    unique (scheme_id, component_id)
  );
  create index if not exists payroll_scheme_items_scheme_idx on public.payroll_scheme_items (scheme_id);

  drop trigger if exists payroll_schemes_touch on public.payroll_schemes;
  create trigger payroll_schemes_touch
  before update on public.payroll_schemes
  for each row execute function public.touch_payroll_updated_at();

  -- Chỉ người có chức năng thiết lập cơ chế đọc được bộ mẫu; ghi qua RPC bên dưới.
  alter table public.payroll_schemes enable row level security;
  alter table public.payroll_scheme_items enable row level security;
  drop policy if exists payroll_schemes_read on public.payroll_schemes;
  create policy payroll_schemes_read on public.payroll_schemes
    for select to authenticated
    using (public.is_admin() or public.can_function('admin.payroll_schemes'));
  drop policy if exists payroll_scheme_items_read on public.payroll_scheme_items;
  create policy payroll_scheme_items_read on public.payroll_scheme_items
    for select to authenticated
    using (public.is_admin() or public.can_function('admin.payroll_schemes'));
  revoke all on public.payroll_schemes, public.payroll_scheme_items from anon, authenticated;
  grant select on public.payroll_schemes, public.payroll_scheme_items to authenticated;

  -- ------------------------------------------------------------------------
  -- 3. Chuyển cơ chế chung của đơn vị xuống từng người + thành bộ mẫu
  -- ------------------------------------------------------------------------
  if v_first then
    create temp table _mx_work (
      component_id uuid primary key, mode text, formula text, amount numeric, sort_order integer
    ) on commit drop;

    -- Dòng cơ chế chung áp cho một đơn vị: từ cấp cao nhất xuống, khai lại thì thay, OFF thì bỏ.
    create or replace function pg_temp.mx_unit_rows(p_unit uuid, p_month date, p_end date)
    returns void language plpgsql as $f$
    declare
      u record;
      i record;
      v_mode text;
    begin
      delete from _mx_work;
      for u in
        with recursive up as (
          select id, parent_id, 0 as d from public.organization_units where id = p_unit
          union all
          select o.id, o.parent_id, up.d + 1
          from public.organization_units o join up on o.id = up.parent_id
          where up.d < 30
        )
        select id from up order by d desc
      loop
        for i in
          select distinct on (x.component_id)
            x.component_id, x.mode, x.formula, x.amount, x.sort_order,
            c.sort_order as c_sort, c.is_active as c_active
          from public.unit_pay_items x
          join public.payroll_components c on c.id = x.component_id
          where x.unit_id = u.id
            and x.effective_from <= p_end and (x.effective_to is null or x.effective_to >= p_month)
          order by x.component_id, x.effective_from desc
        loop
          v_mode := coalesce(i.mode, case when nullif(trim(coalesce(i.formula, '')), '') is not null then 'FORMULA' else 'VALUE' end);
          if v_mode = 'OFF' then
            delete from _mx_work where component_id = i.component_id;
          elsif i.c_active then
            insert into _mx_work (component_id, mode, formula, amount, sort_order)
            values (i.component_id, v_mode, i.formula, i.amount, coalesce(i.sort_order, i.c_sort))
            on conflict (component_id) do update
              set mode = excluded.mode, formula = excluded.formula, amount = excluded.amount, sort_order = excluded.sort_order;
          end if;
        end loop;
      end loop;
    end
    $f$;

    -- Khai riêng cũ của một người áp lên _mx_work, đúng cách client giải trước đây.
    create or replace function pg_temp.mx_person_rows(p_user uuid, p_month date, p_end date)
    returns void language plpgsql as $f$
    declare
      o record;
      w record;
      v_formula text;
    begin
      for o in
        select distinct on (e.component_id)
          e.component_id, e.amount, e.formula, c.sort_order as c_sort
        from public.employee_pay_items e
        join public.payroll_components c on c.id = e.component_id and c.is_active
        where e.user_id = p_user
          and e.effective_from <= p_end and (e.effective_to is null or e.effective_to >= p_month)
        order by e.component_id, e.effective_from desc
      loop
        v_formula := nullif(trim(coalesce(o.formula, '')), '');
        select * into w from _mx_work where component_id = o.component_id;
        if not found then
          insert into _mx_work (component_id, mode, formula, amount, sort_order)
          values (o.component_id, case when v_formula is not null then 'FORMULA' else 'VALUE' end,
                  v_formula, o.amount, 100000 + o.c_sort);
        elsif v_formula is not null then
          update _mx_work set mode = 'FORMULA', formula = v_formula, amount = coalesce(o.amount, w.amount)
          where component_id = o.component_id;
        elsif o.amount is null then
          null;
        elsif w.mode = 'FORMULA' then
          if upper(coalesce(w.formula, '')) ~ '(^|[^A-Z0-9_])MUC_RIENG([^A-Z0-9_]|$)' then
            update _mx_work set amount = o.amount where component_id = o.component_id;
          else
            update _mx_work set mode = 'VALUE', formula = null, amount = o.amount where component_id = o.component_id;
          end if;
        elsif w.mode = 'MONTHLY_INPUT' then
          update _mx_work set mode = 'VALUE', amount = o.amount where component_id = o.component_id;
        else
          update _mx_work set amount = o.amount where component_id = o.component_id;
        end if;
      end loop;
    end
    $f$;

    select count(*) into v_future from public.unit_pay_items where effective_from > v_end;
    if v_future > 0 then
      raise notice 'Có % dòng cơ chế chung hiệu lực sau tháng hiện tại — không chuyển được, khai lại ở Cơ chế lương.', v_future;
    end if;

    -- Mỗi đơn vị có cơ chế chung → một bộ mẫu mang tên đơn vị.
    for v_unit in
      select u.id, u.name, u.code from public.organization_units u
      where exists (select 1 from public.unit_pay_items x where x.unit_id = u.id)
      order by u.name
    loop
      perform pg_temp.mx_unit_rows(v_unit.id, v_month, v_end);
      continue when not exists (select 1 from _mx_work);
      v_name := v_unit.name;
      if exists (select 1 from public.payroll_schemes where lower(trim(name)) = lower(trim(v_name))) then
        v_name := v_unit.name || ' (' || coalesce(v_unit.code, left(v_unit.id::text, 4)) || ')';
      end if;
      insert into public.payroll_schemes (name) values (v_name) returning id into v_scheme;
      insert into public.payroll_scheme_items (scheme_id, component_id, mode, formula, amount, sort_order)
      select v_scheme, component_id, mode,
             case when mode = 'FORMULA' then nullif(trim(coalesce(formula, '')), '') end,
             case when mode in ('FORMULA', 'VALUE', 'PER_PERSON') then amount end,
             sort_order
      from _mx_work;
      v_schemes := v_schemes + 1;
    end loop;

    -- Từng người: danh sách dòng đã giải xong, hiệu lực từ tháng hiện tại.
    for v_person in select p.id, p.unit_id from public.profiles p order by p.id
    loop
      if v_person.unit_id is not null then
        perform pg_temp.mx_unit_rows(v_person.unit_id, v_month, v_end);
      else
        delete from _mx_work;
      end if;
      perform pg_temp.mx_person_rows(v_person.id, v_month, v_end);
      continue when not exists (select 1 from _mx_work);

      update public.employee_pay_items
      set effective_to = (v_month - interval '1 day')::date
      where user_id = v_person.id and effective_from < v_month
        and (effective_to is null or effective_to >= v_month);
      delete from public.employee_pay_items where user_id = v_person.id and effective_from >= v_month;

      insert into public.employee_pay_items (user_id, component_id, mode, formula, amount, sort_order, effective_from, note)
      select v_person.id, component_id, mode,
             case when mode = 'FORMULA' then nullif(trim(coalesce(formula, '')), '') end,
             case when mode in ('FORMULA', 'VALUE', 'PER_PERSON') then amount end,
             sort_order, v_month, 'Chuyển từ cơ chế chung của đơn vị'
      from _mx_work;
      v_people := v_people + 1;
    end loop;

    raise notice 'Đã chuyển cơ chế cho % người, tạo % bộ mẫu.', v_people, v_schemes;
  end if;

  -- ------------------------------------------------------------------------
  -- 4. Kiểm tra nội dung một lần khai — người và đơn vị cùng kiểu dòng
  -- ------------------------------------------------------------------------
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
    v_component public.payroll_components%rowtype;
    v_mode text;
    v_seen uuid[] := '{}';
    v_version public.payroll_param_versions%rowtype;
    v_last date := public.payroll_last_closed_month();
    v_floor_value numeric;
    v_floor_param numeric;
    v_floor_name text;
  begin
    if jsonb_typeof(p_payload -> 'items') is distinct from 'array' then
      raise exception 'Thiếu danh sách dòng cần lưu.' using errcode = '22023';
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
      -- Đề xuất cũ không có mode: có công thức là công thức, còn lại là giá trị.
      v_mode := coalesce(
        nullif(v_item ->> 'mode', ''),
        case when nullif(trim(coalesce(v_item ->> 'formula', '')), '') is not null then 'FORMULA' else 'VALUE' end
      );
      if v_mode not in ('FORMULA', 'VALUE', 'PER_PERSON', 'MONTHLY_INPUT', 'OFF')
         or (p_target_type = 'USER' and v_mode = 'OFF') then
        raise exception 'Cách lấy giá trị của "%" không hợp lệ.', v_component.name using errcode = '22023';
      end if;
      if v_mode = 'FORMULA'
         and nullif(trim(coalesce(v_item ->> 'formula', '')), '') is null
         and jsonb_typeof(v_item -> 'amount') is distinct from 'number' then
        raise exception 'Dòng "%" chưa có công thức.', v_component.name using errcode = '22023';
      end if;
    end loop;

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

    if p_target_type = 'USER' and exists (
      select 1 from public.employee_pay_items where user_id = p_target_id and effective_from > p_effective_from
    ) then
      raise exception 'Người này đã có cơ chế hiệu lực sau tháng % — phải áp dụng từ sau mốc đó.',
        to_char(p_effective_from, 'MM/YYYY') using errcode = '23514';
    end if;
    if p_target_type = 'UNIT' and exists (
      select 1 from public.unit_pay_items where unit_id = p_target_id and effective_from > p_effective_from
    ) then
      raise exception 'Đơn vị này đã có cơ chế hiệu lực sau tháng % — phải áp dụng từ sau mốc đó.',
        to_char(p_effective_from, 'MM/YYYY') using errcode = '23514';
    end if;
  end;
  $$;

  revoke all on function public.payroll_validate_scheme_payload(text, uuid, date, jsonb, boolean) from public, anon, authenticated;

  -- ------------------------------------------------------------------------
  -- 5. Ghi một lần khai vào bảng cơ chế, theo phiên bản
  -- ------------------------------------------------------------------------
  create or replace function public.apply_payroll_scheme_request(p_request public.payroll_scheme_requests)
  returns void
  language plpgsql
  security definer
  set search_path = public
  as $$
  declare
    v_eff date := p_request.effective_from;
    v_close date := (p_request.effective_from - interval '1 day')::date;
  begin
    if p_request.target_type = 'USER' then
      update public.employee_pay_items
      set effective_to = v_close
      where user_id = p_request.user_id
        and effective_from < v_eff
        and (effective_to is null or effective_to >= v_eff);
      delete from public.employee_pay_items
      where user_id = p_request.user_id and effective_from >= v_eff;

      insert into public.employee_pay_items (user_id, component_id, mode, amount, formula, sort_order, effective_from, note, created_by)
      select
        p_request.user_id,
        (i ->> 'component_id')::uuid,
        coalesce(
          nullif(i ->> 'mode', ''),
          case when nullif(trim(coalesce(i ->> 'formula', '')), '') is not null then 'FORMULA' else 'VALUE' end
        ),
        case when jsonb_typeof(i -> 'amount') = 'number' then (i ->> 'amount')::numeric end,
        nullif(trim(coalesce(i ->> 'formula', '')), ''),
        case when jsonb_typeof(i -> 'sort_order') = 'number' then (i ->> 'sort_order')::integer end,
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

      insert into public.unit_pay_items (unit_id, component_id, mode, amount, formula, sort_order, effective_from, note, created_by)
      select
        p_request.unit_id,
        (i ->> 'component_id')::uuid,
        coalesce(
          nullif(i ->> 'mode', ''),
          case when nullif(trim(coalesce(i ->> 'formula', '')), '') is not null then 'FORMULA' else 'VALUE' end
        ),
        case when jsonb_typeof(i -> 'amount') = 'number' then (i ->> 'amount')::numeric end,
        nullif(trim(coalesce(i ->> 'formula', '')), ''),
        case when jsonb_typeof(i -> 'sort_order') = 'number' then (i ->> 'sort_order')::integer end,
        v_eff,
        nullif(trim(coalesce(i ->> 'note', '')), ''),
        p_request.submitted_by
      from jsonb_array_elements(p_request.payload -> 'items') i;
    end if;
  end;
  $$;

  revoke all on function public.apply_payroll_scheme_request(public.payroll_scheme_requests) from public, anon, authenticated;

  -- ------------------------------------------------------------------------
  -- 6. Lưu / xoá bộ cơ chế mẫu
  -- ------------------------------------------------------------------------
  create or replace function public.save_payroll_scheme_template(p_id uuid, p_name text, p_items jsonb)
  returns uuid
  language plpgsql
  security definer
  set search_path = public
  as $$
  declare
    v_id uuid := p_id;
    v_name text := trim(coalesce(p_name, ''));
    v_item jsonb;
    v_component public.payroll_components%rowtype;
    v_mode text;
    v_seen uuid[] := '{}';
  begin
    if auth.uid() is null or not public.can_function('admin.payroll_schemes') then
      raise exception 'Bạn không có quyền thiết lập cơ chế lương.' using errcode = '42501';
    end if;
    if v_name = '' then
      raise exception 'Bộ cơ chế cần có tên.' using errcode = '22023';
    end if;
    if jsonb_typeof(p_items) is distinct from 'array' then
      raise exception 'Thiếu danh sách dòng cần lưu.' using errcode = '22023';
    end if;
    if exists (
      select 1 from public.payroll_schemes s
      where lower(trim(s.name)) = lower(v_name) and s.id is distinct from v_id
    ) then
      raise exception 'Đã có bộ cơ chế tên "%".', v_name using errcode = '23505';
    end if;

    for v_item in select value from jsonb_array_elements(p_items)
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
      v_mode := coalesce(nullif(v_item ->> 'mode', ''), 'FORMULA');
      if v_mode not in ('FORMULA', 'VALUE', 'PER_PERSON', 'MONTHLY_INPUT') then
        raise exception 'Cách lấy giá trị của "%" không hợp lệ.', v_component.name using errcode = '22023';
      end if;
      if jsonb_typeof(v_item -> 'amount') = 'number' and (v_item ->> 'amount')::numeric < 0 then
        raise exception 'Giá trị "%" không được âm.', v_component.name using errcode = '23514';
      end if;
      if length(coalesce(v_item ->> 'formula', '')) > 2000 then
        raise exception 'Công thức "%" quá dài.', v_component.name using errcode = '22023';
      end if;
      if v_mode = 'FORMULA'
         and nullif(trim(coalesce(v_item ->> 'formula', '')), '') is null
         and jsonb_typeof(v_item -> 'amount') is distinct from 'number' then
        raise exception 'Dòng "%" chưa có công thức.', v_component.name using errcode = '22023';
      end if;
    end loop;

    if v_id is null then
      insert into public.payroll_schemes (name, created_by) values (v_name, auth.uid()) returning id into v_id;
    else
      update public.payroll_schemes set name = v_name where id = v_id;
      if not found then
        raise exception 'Không tìm thấy bộ cơ chế.' using errcode = 'P0002';
      end if;
      delete from public.payroll_scheme_items where scheme_id = v_id;
    end if;

    insert into public.payroll_scheme_items (scheme_id, component_id, mode, formula, amount, sort_order)
    select
      v_id,
      (i ->> 'component_id')::uuid,
      coalesce(nullif(i ->> 'mode', ''), 'FORMULA'),
      nullif(trim(coalesce(i ->> 'formula', '')), ''),
      case when jsonb_typeof(i -> 'amount') = 'number' then (i ->> 'amount')::numeric end,
      case when jsonb_typeof(i -> 'sort_order') = 'number' then (i ->> 'sort_order')::integer end
    from jsonb_array_elements(p_items) i;

    perform public.write_payroll_audit(
      'salary.template_save', 'payroll_scheme', v_id::text,
      format('Lưu bộ cơ chế mẫu "%s"', v_name),
      jsonb_build_object('items', p_items)
    );
    return v_id;
  end;
  $$;

  revoke all on function public.save_payroll_scheme_template(uuid, text, jsonb) from public;
  grant execute on function public.save_payroll_scheme_template(uuid, text, jsonb) to authenticated;

  create or replace function public.delete_payroll_scheme_template(p_id uuid)
  returns void
  language plpgsql
  security definer
  set search_path = public
  as $$
  declare
    v_name text;
  begin
    if auth.uid() is null or not public.can_function('admin.payroll_schemes') then
      raise exception 'Bạn không có quyền thiết lập cơ chế lương.' using errcode = '42501';
    end if;
    delete from public.payroll_schemes where id = p_id returning name into v_name;
    if v_name is null then
      raise exception 'Không tìm thấy bộ cơ chế.' using errcode = 'P0002';
    end if;
    perform public.write_payroll_audit(
      'salary.template_delete', 'payroll_scheme', p_id::text, format('Xoá bộ cơ chế mẫu "%s"', v_name)
    );
  end;
  $$;

  revoke all on function public.delete_payroll_scheme_template(uuid) from public;
  grant execute on function public.delete_payroll_scheme_template(uuid) to authenticated;
end
$mig$;
