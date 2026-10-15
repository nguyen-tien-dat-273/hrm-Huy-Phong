-- ============================================================================
-- M06 — Cơ chế chung theo ĐƠN VỊ (bỏ cơ chế mẫu gán theo khối).
-- ----------------------------------------------------------------------------
-- Trước đây một người chịu ba lớp: cơ chế mẫu (payroll_templates, gán cho đơn
-- vị hoặc gán riêng) → giá trị chung của đơn vị → khai riêng. Giờ chỉ còn:
--
--   Cơ chế chung   unit_pay_items — MỖI đơn vị có danh sách dòng của riêng
--                  mình (đầu mục + cách lấy giá trị + công thức). Đơn vị con
--                  thừa hưởng cấp trên; dòng nào khai lại ở đơn vị con thì
--                  thay hẳn dòng của cấp trên; mode OFF = đơn vị con bỏ dòng
--                  đó.
--   Khai riêng     employee_pay_items — thay một dòng cho một người, hoặc
--                  thêm một dòng chỉ người đó có.
--
-- Dữ liệu cũ chuyển sang mô hình mới sao cho dòng lương của từng người ra
-- cùng số: mỗi đơn vị nhận đúng phần khác với cấp trên của nó (cơ chế mẫu đã
-- gán + giá trị chung đã khai). Người gán cơ chế mẫu riêng mà khác đơn vị:
-- phần khác được ghi thành khai riêng; phần không diễn đạt được thì báo
-- (RAISE NOTICE) để rà tay.
--
-- Lưu cơ chế (của đơn vị hoặc của người) là áp dụng ngay, không còn bản nháp.
--
-- LƯU Ý CHẠY: toàn bộ file là MỘT câu lệnh (khối DO) vì SQL Editor của Supabase
-- không cho câu lệnh sau đọc thứ câu trước vừa tạo. Dán nguyên file rồi Run một
-- lần. Chạy lại được: bước chuyển dữ liệu chỉ chạy khi bảng cơ chế mẫu còn.
-- ============================================================================

do $mig$
declare
  v_month date := date_trunc('month', current_date)::date;
  v_end date := (date_trunc('month', current_date) + interval '1 month - 1 day')::date;
  v_from date := date '2000-01-01';
  v_unit record;
  v_person record;
  v_diff record;
  v_tpl uuid;
  v_has boolean;
  v_path uuid[];
  v_units integer := 0;
  v_future integer := 0;
  v_unrepresentable integer := 0;
begin
  -- ------------------------------------------------------------------------
  -- 1. Dòng của đơn vị mang đủ định nghĩa: cách lấy giá trị + thứ tự
  -- ------------------------------------------------------------------------
  alter table public.unit_pay_items add column if not exists mode text not null default 'FORMULA';
  alter table public.unit_pay_items add column if not exists sort_order integer;
  alter table public.unit_pay_items drop constraint if exists unit_pay_items_mode_check;
  alter table public.unit_pay_items
    add constraint unit_pay_items_mode_check
    check (mode in ('FORMULA', 'VALUE', 'PER_PERSON', 'MONTHLY_INPUT', 'OFF'));
  comment on column public.unit_pay_items.mode is
    'Cách lấy giá trị của dòng: FORMULA công thức / VALUE số cố định / PER_PERSON khai từng người / MONTHLY_INPUT nhập hằng tháng / OFF đơn vị này bỏ dòng của cấp trên.';

  -- ------------------------------------------------------------------------
  -- 2. Chuyển dữ liệu: mỗi đơn vị nhận phần khác cấp trên
  -- ------------------------------------------------------------------------
  if to_regclass('public.payroll_templates') is not null then
    create temp table _um_eff (
      unit_id uuid not null, component_id uuid not null, mode text, formula text, amount numeric, sort_order integer,
      primary key (unit_id, component_id)
    ) on commit drop;
    create temp table _um_work (
      component_id uuid primary key, mode text, formula text, amount numeric, sort_order integer
    ) on commit drop;
    create temp table _um_out (
      unit_id uuid not null, component_id uuid not null, mode text, formula text, amount numeric, sort_order integer
    ) on commit drop;
    create temp table _um_path (unit_id uuid primary key, path uuid[]) on commit drop;

    -- Nạp các dòng của một cơ chế mẫu đang hiệu lực trong tháng vào _um_work.
    create or replace function pg_temp.um_load(p_template uuid, p_month date, p_end date)
    returns void language plpgsql as $f$
    begin
      delete from _um_work;
      insert into _um_work (component_id, mode, formula, amount, sort_order)
      select distinct on (i.component_id)
        i.component_id,
        coalesce(i.mode, case when nullif(trim(coalesce(i.formula, '')), '') is not null then 'FORMULA' else 'VALUE' end),
        i.formula, i.amount, coalesce(i.sort_order, c.sort_order)
      from public.payroll_template_items i
      join public.payroll_templates t on t.id = i.template_id and t.is_active
      join public.payroll_components c on c.id = i.component_id and c.is_active
      where i.template_id = p_template
        and i.effective_from <= p_end and (i.effective_to is null or i.effective_to >= p_month)
      order by i.component_id, i.effective_from desc;
    end
    $f$;

    -- Áp giá trị chung đã khai của các đơn vị trên đường đi (cao → thấp) lên _um_work,
    -- đúng cách cũ: có công thức → công thức riêng; chỉ có số → giá trị của dòng.
    create or replace function pg_temp.um_apply(p_path uuid[], p_month date, p_end date)
    returns void language plpgsql as $f$
    declare
      o record;
      w record;
      v_formula text;
    begin
      for o in
        select * from (
          select distinct on (i.unit_id, i.component_id)
            i.unit_id, i.component_id, i.amount, i.formula, c.sort_order as c_sort,
            array_position(p_path, i.unit_id) as pos
          from public.unit_pay_items i
          join public.payroll_components c on c.id = i.component_id and c.is_active
          where i.unit_id = any(p_path)
            and i.effective_from <= p_end and (i.effective_to is null or i.effective_to >= p_month)
          order by i.unit_id, i.component_id, i.effective_from desc
        ) s order by s.pos, s.c_sort
      loop
        v_formula := nullif(trim(coalesce(o.formula, '')), '');
        select * into w from _um_work where component_id = o.component_id;
        if not found then
          insert into _um_work (component_id, mode, formula, amount, sort_order)
          values (o.component_id, case when v_formula is not null then 'FORMULA' else 'VALUE' end,
                  v_formula, o.amount, 100000 + o.c_sort);
        elsif v_formula is not null then
          update _um_work set mode = 'FORMULA', formula = v_formula, amount = coalesce(o.amount, w.amount)
          where component_id = o.component_id;
        elsif o.amount is null then
          null;
        elsif w.mode = 'FORMULA' then
          if upper(coalesce(w.formula, '')) ~ '(^|[^A-Z0-9_])MUC_RIENG([^A-Z0-9_]|$)' then
            update _um_work set amount = o.amount where component_id = o.component_id;
          else
            update _um_work set mode = 'VALUE', formula = null, amount = o.amount where component_id = o.component_id;
          end if;
        elsif w.mode = 'MONTHLY_INPUT' then
          update _um_work set mode = 'VALUE', amount = o.amount where component_id = o.component_id;
        else
          update _um_work set amount = o.amount where component_id = o.component_id;
        end if;
      end loop;
    end
    $f$;

    -- Từ gốc xuống: kết quả đã áp của từng đơn vị, rồi chỉ ghi phần khác cấp trên.
    for v_unit in
      with recursive tree as (
        select id, parent_id, 0 as depth, array[id] as path
        from public.organization_units where parent_id is null
        union all
        select u.id, u.parent_id, t.depth + 1, t.path || u.id
        from public.organization_units u
        join tree t on u.parent_id = t.id
        where not (u.id = any (t.path))
      )
      select * from tree order by depth, id
    loop
      v_units := v_units + 1;
      insert into _um_path (unit_id, path) values (v_unit.id, v_unit.path);

      v_has := false;
      v_tpl := null;
      select true, a.template_id into v_has, v_tpl
      from public.unit_payroll_templates a
      where a.unit_id = v_unit.id and a.effective_from <= v_month
      order by a.effective_from desc
      limit 1;
      v_has := coalesce(v_has, false);

      if v_has then
        -- Cơ chế gán thẳng cho đơn vị (hoặc "không áp cơ chế" = bắt đầu từ trống).
        if v_tpl is not null then
          perform pg_temp.um_load(v_tpl, v_month, v_end);
        else
          delete from _um_work;
        end if;
        perform pg_temp.um_apply(v_unit.path, v_month, v_end);
      else
        delete from _um_work;
        if v_unit.parent_id is not null then
          insert into _um_work (component_id, mode, formula, amount, sort_order)
          select component_id, mode, formula, amount, sort_order from _um_eff where unit_id = v_unit.parent_id;
        end if;
        perform pg_temp.um_apply(array[v_unit.id], v_month, v_end);
      end if;

      insert into _um_out (unit_id, component_id, mode, formula, amount, sort_order)
      select v_unit.id, w.component_id, w.mode, w.formula, w.amount, w.sort_order
      from _um_work w
      left join _um_eff p on p.unit_id = v_unit.parent_id and p.component_id = w.component_id
      where p.component_id is null
         or (p.mode, p.formula, p.amount, p.sort_order) is distinct from (w.mode, w.formula, w.amount, w.sort_order);

      insert into _um_out (unit_id, component_id, mode, formula, amount, sort_order)
      select v_unit.id, p.component_id, 'OFF', null, null, null
      from _um_eff p
      where p.unit_id = v_unit.parent_id
        and not exists (select 1 from _um_work w where w.component_id = p.component_id);

      insert into _um_eff (unit_id, component_id, mode, formula, amount, sort_order)
      select v_unit.id, component_id, mode, formula, amount, sort_order from _um_work;
    end loop;

    select count(*) into v_future from public.unit_pay_items where effective_from > v_end;
    if v_future > 0 then
      raise notice 'Có % dòng giá trị chung hiệu lực sau tháng hiện tại — không chuyển được, khai lại ở Cơ chế lương.', v_future;
    end if;

    -- Người gán cơ chế mẫu riêng: ghi phần khác đơn vị của họ thành khai riêng.
    for v_person in
      select distinct on (p.user_id) p.user_id, p.template_id, pr.unit_id
      from public.employee_pay_profiles p
      join public.profiles pr on pr.id = p.user_id
      where p.effective_from <= v_end
      order by p.user_id, p.effective_from desc
    loop
      continue when v_person.template_id is null;
      select path into v_path from _um_path where unit_id = v_person.unit_id;
      perform pg_temp.um_load(v_person.template_id, v_month, v_end);
      perform pg_temp.um_apply(coalesce(v_path, '{}'::uuid[]), v_month, v_end);

      for v_diff in
        select w.component_id, w.mode, w.formula, w.amount
        from _um_work w
        left join _um_eff e on e.unit_id = v_person.unit_id and e.component_id = w.component_id
        where e.component_id is null
           or (e.mode, e.formula, e.amount) is distinct from (w.mode, w.formula, w.amount)
      loop
        if v_diff.mode in ('FORMULA', 'VALUE')
           and (nullif(trim(coalesce(v_diff.formula, '')), '') is not null or v_diff.amount is not null) then
          if not exists (
            select 1 from public.employee_pay_items x
            where x.user_id = v_person.user_id and x.component_id = v_diff.component_id
              and x.effective_from <= v_end and (x.effective_to is null or x.effective_to >= v_month)
          ) then
            insert into public.employee_pay_items (user_id, component_id, amount, formula, effective_from, note)
            values (
              v_person.user_id, v_diff.component_id,
              v_diff.amount,
              nullif(trim(coalesce(v_diff.formula, '')), ''),
              v_from, 'Chuyển từ cơ chế gán riêng khi bỏ cơ chế mẫu'
            );
          end if;
        else
          v_unrepresentable := v_unrepresentable + 1;
        end if;
      end loop;

      -- Dòng đơn vị có mà cơ chế riêng của người này không có.
      select v_unrepresentable + count(*) into v_unrepresentable
      from _um_eff e
      where e.unit_id = v_person.unit_id
        and not exists (select 1 from _um_work w where w.component_id = e.component_id);
    end loop;
    if v_unrepresentable > 0 then
      raise notice '% dòng của nhân sự gán cơ chế riêng không chuyển được — rà lại ở Cơ chế lương.', v_unrepresentable;
    end if;

    -- Thay toàn bộ giá trị chung cũ bằng cơ chế chung mới (hiệu lực từ mốc đầu).
    delete from public.unit_pay_items;
    insert into public.unit_pay_items (unit_id, component_id, mode, formula, amount, sort_order, effective_from, note)
    select unit_id, component_id, mode,
           case when mode = 'FORMULA' then nullif(trim(coalesce(formula, '')), '') end,
           case when mode in ('FORMULA', 'VALUE', 'PER_PERSON') then amount end,
           sort_order, v_from, 'Chuyển từ cơ chế mẫu'
    from _um_out;
    raise notice 'Đã chuyển cơ chế chung cho % đơn vị.', v_units;

    drop table _um_eff;
    drop table _um_work;
    drop table _um_out;
    drop table _um_path;
  end if;

  -- ------------------------------------------------------------------------
  -- 3. Bỏ cơ chế mẫu
  -- ------------------------------------------------------------------------
  drop function if exists public.save_payroll_scheme_request(uuid, text, uuid, uuid, date, jsonb, text, boolean);
  drop function if exists public.save_payroll_mechanism(uuid, date, jsonb);
  drop function if exists public.seed_payroll_mechanism_defaults(uuid, date, text);
  drop function if exists public.assign_payroll_template(uuid, uuid, date, text);
  drop function if exists public.payroll_template_for(uuid, date);

  alter table public.employee_pay_profiles drop column if exists template_id;
  drop table if exists public.payroll_template_items;
  drop table if exists public.unit_payroll_templates;
  drop table if exists public.payroll_templates;

  drop function if exists public.audit_payroll_template();
  drop function if exists public.guard_payroll_template_delete();

  -- ------------------------------------------------------------------------
  -- 4. Kiểm tra nội dung một lần khai (cơ chế chung của đơn vị / khai riêng của người)
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
      if p_target_type = 'UNIT' then
        -- Đề xuất cũ không có mode: có công thức là công thức, còn lại là giá trị.
        v_mode := coalesce(
          nullif(v_item ->> 'mode', ''),
          case when nullif(trim(coalesce(v_item ->> 'formula', '')), '') is not null then 'FORMULA' else 'VALUE' end
        );
        if v_mode not in ('FORMULA', 'VALUE', 'PER_PERSON', 'MONTHLY_INPUT', 'OFF') then
          raise exception 'Cách lấy giá trị của "%" không hợp lệ.', v_component.name using errcode = '22023';
        end if;
        if v_mode = 'FORMULA'
           and nullif(trim(coalesce(v_item ->> 'formula', '')), '') is null
           and jsonb_typeof(v_item -> 'amount') is distinct from 'number' then
          raise exception 'Dòng "%" chưa có công thức.', v_component.name using errcode = '22023';
        end if;
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
      raise exception 'Người này đã có khai riêng hiệu lực sau tháng % — phải áp dụng từ sau mốc đó.',
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
  -- 6. Lưu cơ chế = áp dụng ngay
  -- ------------------------------------------------------------------------
  create or replace function public.save_payroll_scheme(
    p_target_type text,
    p_user_id uuid,
    p_unit_id uuid,
    p_effective_from date,
    p_payload jsonb,
    p_note text default null
  )
  returns uuid
  language plpgsql
  security definer
  set search_path = public, extensions
  as $$
  declare
    v_target uuid := coalesce(p_user_id, p_unit_id);
    v_request public.payroll_scheme_requests%rowtype;
    v_fingerprint text;
  begin
    if auth.uid() is null or not public.can_function('admin.payroll_schemes') then
      raise exception 'Bạn không có quyền thiết lập cơ chế lương.' using errcode = '42501';
    end if;
    if p_target_type not in ('USER', 'UNIT') or v_target is null then
      raise exception 'Đối tượng không hợp lệ.' using errcode = '22023';
    end if;

    perform public.payroll_validate_scheme_payload(p_target_type, v_target, p_effective_from, p_payload, true);

    -- Bản nháp / đề xuất còn mở từ trước không còn ý nghĩa: bản vừa lưu thay thế.
    update public.payroll_scheme_requests
    set status = 'CANCELLED'
    where target_type = p_target_type and coalesce(user_id, unit_id) = v_target
      and status in ('DRAFT', 'SUBMITTED', 'REJECTED');

    v_fingerprint := encode(digest(
      p_target_type || '|' || v_target::text || '|' || p_effective_from::text || '|' || p_payload::text,
      'sha256'), 'hex');

    insert into public.payroll_scheme_requests (
      target_type, user_id, unit_id, effective_from, status, payload, note,
      submitted_by, submitted_at, reviewed_by, reviewed_at, approval_fingerprint, applied_at
    )
    values (
      p_target_type,
      case when p_target_type = 'USER' then p_user_id end,
      case when p_target_type = 'UNIT' then p_unit_id end,
      p_effective_from, 'APPROVED', p_payload, nullif(trim(coalesce(p_note, '')), ''),
      auth.uid(), now(), auth.uid(), now(), v_fingerprint, now()
    )
    returning * into v_request;

    perform public.apply_payroll_scheme_request(v_request);

    perform public.add_payroll_approval_event('SCHEME', v_request.id, 'APPROVED', p_note,
      jsonb_build_object('fingerprint', v_fingerprint, 'direct', true));
    perform public.write_payroll_audit(
      'salary.scheme_apply', 'payroll_scheme_request', v_request.id::text,
      format('Áp dụng cơ chế lương từ %s', to_char(p_effective_from, 'MM/YYYY')),
      jsonb_build_object('payload', p_payload, 'fingerprint', v_fingerprint), p_user_id
    );

    return v_request.id;
  end;
  $$;

  revoke all on function public.save_payroll_scheme(text, uuid, uuid, date, jsonb, text) from public;
  grant execute on function public.save_payroll_scheme(text, uuid, uuid, date, jsonb, text) to authenticated;
end
$mig$;
