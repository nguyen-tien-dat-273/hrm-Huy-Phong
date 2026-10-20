-- ============================================================================
-- M05 — Chỉ tiêu kinh doanh: bỏ bước chờ Ban Giám đốc duyệt riêng.
-- ----------------------------------------------------------------------------
-- Admin, Kế toán trưởng và Ban Giám đốc quyền ngang nhau ở công ty này — không
-- cần tách người giao chỉ tiêu và người duyệt. Ai có một trong ba quyền
-- (admin.performance_manage, admin.kpi_approve, admin.kpi_close) giao được chỉ
-- tiêu, nhập được số thực hiện, và tự xác nhận luôn, không phải chờ người khác
-- duyệt.
--
-- Giữ "Yêu cầu điều chỉnh" để mở lại chỉ tiêu đã xác nhận khi cần sửa, cùng
-- nhóm quyền trên tự làm được, không giới hạn ở status SUBMITTED như trước.
-- Chạy lại nhiều lần được.
-- ============================================================================

-- Giao / sửa chỉ tiêu: mở cho cả ba quyền, không chỉ admin.performance_manage.
create or replace function public.kpi_save_sales_targets(p_month date, p_rows jsonb)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_month date := date_trunc('month', p_month)::date;
  v_row jsonb;
  v_user uuid;
  v_count integer := 0;
  v_existing public.kpi_sales_targets;
  v_can_confirm boolean := public.kpi_can_manage() or public.kpi_is_board() or public.kpi_can_close();
begin
  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_user := (v_row ->> 'user_id')::uuid;
    if not (v_can_confirm or public.kpi_is_manager_of(v_user)) then
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

-- Nhập số thực hiện: mở cho cả ba quyền (trước chỉ admin.performance_manage / kpi_close).
create or replace function public.kpi_save_sales_actuals(p_month date, p_rows jsonb)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_month date := date_trunc('month', p_month)::date;
  v_row jsonb;
  v_count integer := 0;
begin
  if not (public.kpi_can_manage() or public.kpi_is_board() or public.kpi_can_close()) then
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
  perform public.kpi_fill_sources(v_month, null);
  return v_count;
end;
$$;

create or replace function public.kpi_review_sales_targets(p_month date, p_users uuid[], p_action text, p_reason text default null)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_month date := date_trunc('month', p_month)::date;
  v_count integer;
  v_can_confirm boolean := public.kpi_can_manage() or public.kpi_is_board() or public.kpi_can_close();
begin
  if p_action = 'SUBMIT' then
    -- Giữ lại cho tương thích ngược; màn Chỉ tiêu kinh doanh không còn gọi bước này.
    update public.kpi_sales_targets set status = 'SUBMITTED', submitted_by = auth.uid(), submitted_at = now(), review_reason = null
    where period_month = v_month and user_id = any(p_users) and status in ('DRAFT', 'CHANGES')
      and (public.kpi_can_manage() or public.kpi_is_manager_of(user_id));
  elsif p_action = 'APPROVE' then
    if not v_can_confirm then
      raise exception 'Bạn không có quyền xác nhận chỉ tiêu kinh doanh.' using errcode = '42501';
    end if;
    update public.kpi_sales_targets set
      status = 'APPROVED', submitted_by = coalesce(submitted_by, auth.uid()), submitted_at = coalesce(submitted_at, now()),
      approved_by = auth.uid(), approved_at = now(), review_reason = null
    where period_month = v_month and user_id = any(p_users) and status in ('DRAFT', 'CHANGES', 'SUBMITTED');
  elsif p_action = 'CHANGES' then
    if not v_can_confirm then
      raise exception 'Bạn không có quyền mở lại chỉ tiêu kinh doanh.' using errcode = '42501';
    end if;
    if length(trim(coalesce(p_reason, ''))) < 3 then
      raise exception 'Nhập lý do yêu cầu điều chỉnh.' using errcode = '23514';
    end if;
    update public.kpi_sales_targets set status = 'CHANGES', review_reason = trim(p_reason)
    where period_month = v_month and user_id = any(p_users) and status in ('SUBMITTED', 'APPROVED');
  else
    raise exception 'Thao tác không hợp lệ.' using errcode = '22023';
  end if;
  get diagnostics v_count = row_count;
  perform public.kpi_log(null, v_month, null, 'SALES_' || p_action, null, null, p_reason,
    jsonb_build_object('users', to_jsonb(p_users), 'count', v_count));
  return v_count;
end;
$$;
