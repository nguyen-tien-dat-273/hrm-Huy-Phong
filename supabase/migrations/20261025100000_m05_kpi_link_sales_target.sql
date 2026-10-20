-- ============================================================================
-- M05 → M06: thêm nguồn "Doanh số khoán" cho liên kết KPI sang lương.
-- ----------------------------------------------------------------------------
-- Bảng lương Kinh doanh tính tỷ lệ đạt = doanh số thu ÷ DOANH SỐ KHOÁN. Doanh số
-- khoán đã được giao và Ban Giám đốc duyệt ở màn Chỉ tiêu kinh doanh, nhưng liên
-- kết lương chưa có nguồn này, nên kế toán phải gõ lại con số đó ở Bảng lương.
--
-- Thêm nguồn SALES_TARGET: khi khoá sổ KPI, doanh số khoán đã duyệt được ghi vào
-- đầu mục lương được gắn (thường là dòng "Doanh số khoán" của cơ chế Kinh doanh).
-- Chạy lại nhiều lần được.
-- ============================================================================

-- 1. Cho phép nguồn mới
do $mig$
declare
  v_name text;
begin
  for v_name in
    select c.conname from pg_constraint c
    where c.conrelid = 'public.kpi_payroll_links'::regclass and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%source%'
  loop
    execute format('alter table public.kpi_payroll_links drop constraint %I', v_name);
  end loop;
end
$mig$;

alter table public.kpi_payroll_links add constraint kpi_payroll_links_source_check check (source in (
  'KPI_PCT', 'KPI_BONUS', 'SALES_TARGET', 'SALES_ACTUAL', 'SALES_PCT', 'COLLECT_ACTUAL', 'COLLECT_PCT', 'YEAR_BONUS'
));

insert into public.kpi_payroll_links (source) values ('SALES_TARGET')
on conflict (source) do nothing;

-- 2. Đẩy kết quả KPI đã duyệt của tháng sang số liệu lương (thêm nhánh doanh số khoán)
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
        when 'SALES_TARGET' then case when r.target_status = 'APPROVED' then r.sales_target end
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
