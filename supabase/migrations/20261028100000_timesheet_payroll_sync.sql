-- ============================================================================
-- Bảng công → Bảng lương: số liệu tháng tự điền khi khoá kỳ công.
-- ----------------------------------------------------------------------------
-- Trước đây các dòng sau phải nhập tay ở Bảng lương:
--   Công làm thêm sau 22h, Công bị trừ do đi muộn quá số lần, giờ làm thêm.
-- Nay tính thẳng từ chấm công + đơn đã duyệt ngay trong database, ghi vào
-- payroll_inputs khi kỳ công chuyển sang "Đã khóa" (giống cách KPI điền sang lương):
--
--   timesheet_payroll_rules   Quy tắc tính (bậc phạt đi muộn, mốc 22h, trừ phép trước)
--   timesheet_payroll_links   Số nào của Bảng công điền vào đầu mục lương nào
--   timesheet_payroll_metrics Số liệu từng người để Bảng công hiện cột đối chiếu
--   timesheet_sync_payroll    Ghi số vào lương (gọi bởi trigger khoá kỳ công)
--
-- Quy tắc:
--   Giờ làm thêm      đơn làm thêm đã duyệt, chia ngày thường / ngày nghỉ / ngày lễ
--                     đúng như cách bảng lương vẫn chia.
--   Công sau 22h      ngày có giờ ra sau mốc (mặc định 22:00) VÀ có đơn làm thêm
--                     đã duyệt thì cộng 1 công.
--   Công bị trừ       số lần đi muộn (đo từ ca làm việc, bỏ ngày có đơn đi muộn đã
--                     duyệt) tra bảng bậc ra số ngày phạt; trừ phép năm còn lại
--                     trước (ghi vào sổ phép), phần thiếu mới là công bị trừ.
--   Mở lại kỳ công    gỡ số đã điền và hoàn phép đã trừ (khi kỳ lương chưa chốt).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Quy tắc
-- ---------------------------------------------------------------------------
create table if not exists public.timesheet_payroll_rules (
  id boolean primary key default true check (id),
  -- [{"from": 7, "days": 1}, ...]: từ ngần ấy lần đi muộn trở lên bị phạt ngần ấy ngày
  late_tiers jsonb not null default '[{"from":7,"days":1},{"from":11,"days":2},{"from":16,"days":6}]'::jsonb,
  night_cutoff time not null default '22:00',
  night_requires_ot boolean not null default true,
  deduct_leave_first boolean not null default true,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

insert into public.timesheet_payroll_rules (id) values (true) on conflict (id) do nothing;

alter table public.timesheet_payroll_rules enable row level security;
drop policy if exists timesheet_payroll_rules_read on public.timesheet_payroll_rules;
create policy timesheet_payroll_rules_read on public.timesheet_payroll_rules for select to authenticated using (true);
revoke all on public.timesheet_payroll_rules from anon, authenticated;
grant select on public.timesheet_payroll_rules to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Liên kết sang đầu mục lương
-- ---------------------------------------------------------------------------
create table if not exists public.timesheet_payroll_links (
  source text primary key check (source in (
    'OT_WEEKDAY_HOURS', 'OT_WEEKEND_HOURS', 'OT_HOLIDAY_HOURS', 'NIGHT_WORK_DAYS', 'LATE_DEDUCT_DAYS'
  )),
  component_code text,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

create unique index if not exists timesheet_payroll_links_code_idx
  on public.timesheet_payroll_links(upper(component_code)) where component_code is not null;

-- Mã nhận số: đầu mục lương, hoặc ba biến giờ làm thêm mà bảng lương đọc sẵn.
create or replace function public.guard_timesheet_payroll_link()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.component_code := nullif(upper(trim(new.component_code)), '');
  new.updated_at := now();
  new.updated_by := auth.uid();
  if new.component_code is not null then
    if not (
      new.component_code in ('OT_WEEKDAY_HOURS', 'OT_WEEKEND_HOURS', 'OT_HOLIDAY_HOURS')
      or exists (select 1 from public.payroll_components c where upper(c.code) = new.component_code)
    ) then
      raise exception 'Không có đầu mục lương mã %.', new.component_code using errcode = '23503';
    end if;
    if to_regclass('public.kpi_payroll_links') is not null and exists (
      select 1 from public.kpi_payroll_links k where upper(k.component_code) = new.component_code
    ) then
      raise exception 'Đầu mục % đang nhận số từ KPI, không dùng cho Bảng công được.', new.component_code
        using errcode = '23505';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists timesheet_payroll_links_guard on public.timesheet_payroll_links;
create trigger timesheet_payroll_links_guard before insert or update on public.timesheet_payroll_links
  for each row execute function public.guard_timesheet_payroll_link();

insert into public.timesheet_payroll_links (source) values
  ('OT_WEEKDAY_HOURS'), ('OT_WEEKEND_HOURS'), ('OT_HOLIDAY_HOURS'), ('NIGHT_WORK_DAYS'), ('LATE_DEDUCT_DAYS')
on conflict (source) do nothing;

update public.timesheet_payroll_links set component_code = 'OT_WEEKDAY_HOURS' where source = 'OT_WEEKDAY_HOURS' and component_code is null;
update public.timesheet_payroll_links set component_code = 'OT_WEEKEND_HOURS' where source = 'OT_WEEKEND_HOURS' and component_code is null;
update public.timesheet_payroll_links set component_code = 'OT_HOLIDAY_HOURS' where source = 'OT_HOLIDAY_HOURS' and component_code is null;
update public.timesheet_payroll_links set component_code = 'SO_CONG_DEM'
  where source = 'NIGHT_WORK_DAYS' and component_code is null
    and exists (select 1 from public.payroll_components c where c.code = 'SO_CONG_DEM');
update public.timesheet_payroll_links set component_code = 'SO_CONG_TRU_DI_MUON'
  where source = 'LATE_DEDUCT_DAYS' and component_code is null
    and exists (select 1 from public.payroll_components c where c.code = 'SO_CONG_TRU_DI_MUON');

alter table public.timesheet_payroll_links enable row level security;
drop policy if exists timesheet_payroll_links_read on public.timesheet_payroll_links;
create policy timesheet_payroll_links_read on public.timesheet_payroll_links for select to authenticated using (true);
revoke all on public.timesheet_payroll_links from anon, authenticated;
grant select on public.timesheet_payroll_links to authenticated;

-- Số nào của lương do Bảng công điền thì không sửa tay ở Bảng lương.
create or replace function public.timesheet_payroll_codes()
returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(component_code) filter (where component_code is not null), '{}')
  from public.timesheet_payroll_links;
$$;

revoke all on function public.timesheet_payroll_codes() from public;
grant execute on function public.timesheet_payroll_codes() to authenticated;

create or replace function public.guard_timesheet_payroll_inputs_readonly()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if upper(new.code) = any(public.timesheet_payroll_codes())
     and coalesce(current_setting('app.timesheet_payroll_sync', true), '') <> 'on' then
    raise exception 'Số liệu “%” do Bảng công tự điền khi khoá kỳ công — sửa ở Bảng công, không sửa tay ở Bảng lương.', new.code
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists payroll_inputs_timesheet_readonly_guard on public.payroll_inputs;
create trigger payroll_inputs_timesheet_readonly_guard
  before insert or update on public.payroll_inputs
  for each row execute function public.guard_timesheet_payroll_inputs_readonly();

-- ---------------------------------------------------------------------------
-- 3. Sổ phép: nhận biết dòng do Bảng công ghi để gỡ khi mở lại kỳ công
-- ---------------------------------------------------------------------------
alter table public.leave_ledger add column if not exists ref_kind text;
alter table public.leave_ledger add column if not exists ref_month date;

create unique index if not exists leave_ledger_timesheet_ref_unique
  on public.leave_ledger(user_id, ref_kind, ref_month) where ref_kind is not null;

-- ---------------------------------------------------------------------------
-- 4. Hàm dùng chung: ca làm việc và trọng số ngày (cùng cách tính với phía client)
-- ---------------------------------------------------------------------------
create or replace function public.ts_day_weight(p_date date, p_with_holidays boolean default true)
returns numeric
language sql stable set search_path = public as $$
  select case
    when p_with_holidays and exists (
      select 1 from public.company_holidays h where h.holiday_date = p_date and h.is_active
    ) then 0
    when extract(dow from p_date) = 0 then 0
    when extract(dow from p_date) = 6 then coalesce((
      select case s.saturday_mode when 'FULL' then 1 when 'HALF' then 0.5 else 0 end
      from public.work_schedules s
      where s.is_active and s.effective_from <= p_date and (s.effective_to is null or s.effective_to >= p_date)
      order by s.effective_from desc limit 1
    ), 0)
    else 1
  end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Số liệu từng người trong tháng
-- ---------------------------------------------------------------------------
create or replace function public.timesheet_payroll_raw(p_month date, p_user uuid default null)
returns table (
  user_id uuid,
  ot_weekday numeric,
  ot_weekend numeric,
  ot_holiday numeric,
  night_days numeric,
  late_count integer,
  late_penalty_days numeric,
  leave_balance numeric,
  leave_deduct numeric,
  pay_deduct numeric,
  holiday_days numeric
)
language plpgsql stable security definer set search_path = public as $fn$
declare
  v_start date := date_trunc('month', p_month)::date;
  v_end date := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
  v_tz constant text := 'Asia/Ho_Chi_Minh';
begin
  return query
  with rules as (
    select * from public.timesheet_payroll_rules limit 1
  ),
  att as (
    select a.user_id, a.date, a.check_in_time, a.check_out_time
    from public.attendance a
    where a.status = 'completed' and a.approved_by_lead
      and a.date between v_start and v_end
      and (p_user is null or a.user_id = p_user)
  ),
  req as (
    select r.user_id, r.request_type, r.work_date, r.hours
    from public.attendance_requests r
    where r.status = 'APPROVED' and r.work_date between v_start and v_end
      and (p_user is null or r.user_id = p_user)
  ),
  people as (
    select p.id as user_id from public.profiles p
    where p.is_active and (p_user is null or p.id = p_user)
    union select a.user_id from att a
    union select q.user_id from req q
  ),
  ot as (
    select x.user_id,
      coalesce(sum(x.hours) filter (where x.k = 'D'), 0) as wd,
      coalesce(sum(x.hours) filter (where x.k = 'W'), 0) as we,
      coalesce(sum(x.hours) filter (where x.k = 'H'), 0) as ho
    from (
      select q.user_id, q.hours,
        case
          when exists (select 1 from public.company_holidays h where h.is_active and h.holiday_date = q.work_date) then 'H'
          when public.ts_day_weight(q.work_date) = 0 then 'W'
          else 'D'
        end as k
      from req q
      where q.request_type = 'OVERTIME' and coalesce(q.hours, 0) > 0
    ) x
    group by x.user_id
  ),
  night as (
    select a.user_id, count(distinct a.date) as n
    from att a cross join rules ru
    where a.check_out_time is not null
      and (a.check_out_time at time zone v_tz) > (a.date + ru.night_cutoff)
      and (
        not ru.night_requires_ot
        or exists (
          select 1 from req q
          where q.user_id = a.user_id and q.work_date = a.date and q.request_type = 'OVERTIME'
        )
      )
    group by a.user_id
  ),
  late as (
    select a.user_id, count(*) as n
    from att a
    join lateral (
      select s.start_time, s.grace_minutes
      from public.work_schedules s
      where s.is_active and s.effective_from <= a.date and (s.effective_to is null or s.effective_to >= a.date)
      order by s.effective_from desc limit 1
    ) sc on true
    where a.check_in_time is not null
      and public.ts_day_weight(a.date) > 0
      and not exists (
        select 1 from public.attendance_requests r
        where r.user_id = a.user_id and r.work_date = a.date
          and r.request_type = 'LATE_ARRIVAL' and r.status = 'APPROVED'
      )
      and (
        extract(hour from (a.check_in_time at time zone v_tz))::int * 60
        + extract(minute from (a.check_in_time at time zone v_tz))::int
        - (extract(hour from sc.start_time)::int * 60 + extract(minute from sc.start_time)::int)
        - sc.grace_minutes
      ) > 0
    group by a.user_id
  ),
  hol as (
    select pe.user_id, coalesce(sum(public.ts_day_weight(h.holiday_date, false)), 0) as d
    from people pe
    cross join public.company_holidays h
    where h.is_active and h.holiday_date between v_start and v_end
      and not exists (
        select 1 from att a
        where a.user_id = pe.user_id and a.date = h.holiday_date and a.check_in_time is not null
      )
    group by pe.user_id
  ),
  base as (
    select pe.user_id,
      coalesce(ot.wd, 0) as wd, coalesce(ot.we, 0) as we, coalesce(ot.ho, 0) as ho,
      coalesce(night.n, 0)::numeric as night_n,
      coalesce(late.n, 0)::int as late_n,
      coalesce(hol.d, 0) as hol_d,
      coalesce((
        select (t ->> 'days')::numeric
        from rules ru, jsonb_array_elements(ru.late_tiers) t
        where coalesce(late.n, 0) >= (t ->> 'from')::int
        order by (t ->> 'from')::int desc limit 1
      ), 0) as pen,
      coalesce((
        select sum(l.days) from public.leave_ledger l
        where l.user_id = pe.user_id and l.leave_type = 'annual'
          and l.leave_year = extract(year from v_start)::int
          and (l.ref_kind is distinct from 'TIMESHEET_LATE' or l.ref_month is distinct from v_start)
      ), 0) as bal
    from people pe
    left join ot on ot.user_id = pe.user_id
    left join night on night.user_id = pe.user_id
    left join late on late.user_id = pe.user_id
    left join hol on hol.user_id = pe.user_id
  )
  select b.user_id, b.wd, b.we, b.ho, b.night_n, b.late_n, b.pen, b.bal,
    case when (select deduct_leave_first from rules) then least(b.pen, greatest(b.bal, 0)) else 0 end,
    b.pen - case when (select deduct_leave_first from rules) then least(b.pen, greatest(b.bal, 0)) else 0 end,
    b.hol_d
  from base b;
end;
$fn$;

revoke all on function public.timesheet_payroll_raw(date, uuid) from public, anon, authenticated;

-- Bản cho giao diện: Bảng công hiện cột đối chiếu (người có quyền chấm công / lương, hoặc xem của chính mình).
create or replace function public.timesheet_payroll_metrics(p_month date)
returns table (
  user_id uuid,
  ot_weekday numeric,
  ot_weekend numeric,
  ot_holiday numeric,
  night_days numeric,
  late_count integer,
  late_penalty_days numeric,
  leave_balance numeric,
  leave_deduct numeric,
  pay_deduct numeric,
  holiday_days numeric
)
language plpgsql stable security definer set search_path = public as $$
begin
  if public.can('attendance') or public.can_function('admin.timesheet_lock')
     or public.can_function('admin.payroll_settings') or public.can('payroll') then
    return query select * from public.timesheet_payroll_raw(p_month, null);
  elsif auth.uid() is not null then
    return query select * from public.timesheet_payroll_raw(p_month, auth.uid());
  end if;
end;
$$;

revoke all on function public.timesheet_payroll_metrics(date) from public;
grant execute on function public.timesheet_payroll_metrics(date) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Ghi vào lương khi khoá kỳ công, gỡ khi mở lại
-- ---------------------------------------------------------------------------
create or replace function public.timesheet_sync_payroll(p_month date, p_user uuid default null)
returns integer
language plpgsql security definer set search_path = public as $fn$
declare
  v_month date := date_trunc('month', p_month)::date;
  v_year integer := extract(year from date_trunc('month', p_month))::int;
  r record;
  v_link record;
  v_val numeric;
  v_count integer := 0;
begin
  if not exists (select 1 from public.timesheet_periods where month_start = v_month and status = 'LOCKED') then
    return 0;
  end if;
  if to_regprocedure('public.payroll_month_closed(date)') is not null and public.payroll_month_closed(v_month) then
    return 0;
  end if;

  perform set_config('app.timesheet_payroll_sync', 'on', true);

  delete from public.payroll_inputs i
  using public.timesheet_payroll_links l
  where l.component_code is not null
    and upper(i.code) = l.component_code
    and i.month_start = v_month
    and (p_user is null or i.user_id = p_user);

  delete from public.leave_ledger
  where ref_kind = 'TIMESHEET_LATE' and ref_month = v_month and (p_user is null or user_id = p_user);

  for r in select * from public.timesheet_payroll_raw(v_month, p_user) loop
    for v_link in select * from public.timesheet_payroll_links where component_code is not null loop
      v_val := case v_link.source
        when 'OT_WEEKDAY_HOURS' then r.ot_weekday
        when 'OT_WEEKEND_HOURS' then r.ot_weekend
        when 'OT_HOLIDAY_HOURS' then r.ot_holiday
        when 'NIGHT_WORK_DAYS' then r.night_days
        when 'LATE_DEDUCT_DAYS' then r.pay_deduct
      end;
      if coalesce(v_val, 0) > 0 then
        insert into public.payroll_inputs (user_id, month_start, code, quantity, note, created_by)
        values (r.user_id, v_month, v_link.component_code, v_val,
          'Tự động từ Bảng công tháng ' || to_char(v_month, 'MM/YYYY') || '.', auth.uid())
        on conflict (user_id, month_start, code)
        do update set quantity = excluded.quantity, note = excluded.note, updated_at = now();
      end if;
    end loop;

    if r.leave_deduct > 0 then
      insert into public.leave_ledger (user_id, leave_type, leave_year, entry_type, days, note, created_by, ref_kind, ref_month)
      values (r.user_id, 'annual', v_year, 'ADJUSTMENT', -r.leave_deduct,
        'Trừ phép do đi muộn quá số lần — tháng ' || to_char(v_month, 'MM/YYYY'), auth.uid(), 'TIMESHEET_LATE', v_month);
    end if;
    v_count := v_count + 1;
  end loop;

  perform set_config('app.timesheet_payroll_sync', 'off', true);
  return v_count;
end;
$fn$;

revoke all on function public.timesheet_sync_payroll(date, uuid) from public, anon, authenticated;

create or replace function public.timesheet_unsync_payroll(p_month date)
returns void
language plpgsql security definer set search_path = public as $fn$
declare
  v_month date := date_trunc('month', p_month)::date;
begin
  if to_regprocedure('public.payroll_month_closed(date)') is not null and public.payroll_month_closed(v_month) then
    return;
  end if;
  perform set_config('app.timesheet_payroll_sync', 'on', true);
  delete from public.payroll_inputs i
  using public.timesheet_payroll_links l
  where l.component_code is not null and upper(i.code) = l.component_code and i.month_start = v_month;
  delete from public.leave_ledger where ref_kind = 'TIMESHEET_LATE' and ref_month = v_month;
  perform set_config('app.timesheet_payroll_sync', 'off', true);
end;
$fn$;

revoke all on function public.timesheet_unsync_payroll(date) from public, anon, authenticated;

create or replace function public.timesheet_period_payroll_trigger()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'LOCKED' and (tg_op = 'INSERT' or old.status is distinct from 'LOCKED') then
    perform public.timesheet_sync_payroll(new.month_start);
  elsif tg_op = 'UPDATE' and old.status = 'LOCKED' and new.status <> 'LOCKED' then
    perform public.timesheet_unsync_payroll(old.month_start);
  end if;
  return null;
end;
$$;

drop trigger if exists timesheet_periods_payroll_sync on public.timesheet_periods;
create trigger timesheet_periods_payroll_sync
  after insert or update of status on public.timesheet_periods
  for each row execute function public.timesheet_period_payroll_trigger();

-- Đơn làm thêm / đi muộn duyệt hoặc đổi sau khi khoá kỳ công (kỳ lương còn mở): điền lại cho người đó.
create or replace function public.timesheet_request_payroll_trigger()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.status = 'APPROVED' then perform public.timesheet_sync_payroll(new.work_date, new.user_id); end if;
  elsif tg_op = 'DELETE' then
    if old.status = 'APPROVED' then perform public.timesheet_sync_payroll(old.work_date, old.user_id); end if;
  elsif old.status = 'APPROVED' or new.status = 'APPROVED' then
    perform public.timesheet_sync_payroll(old.work_date, old.user_id);
    if new.work_date is distinct from old.work_date or new.user_id is distinct from old.user_id then
      perform public.timesheet_sync_payroll(new.work_date, new.user_id);
    end if;
  end if;
  return null;
end;
$$;

drop trigger if exists attendance_requests_timesheet_payroll on public.attendance_requests;
create trigger attendance_requests_timesheet_payroll
  after insert or update or delete on public.attendance_requests
  for each row execute function public.timesheet_request_payroll_trigger();

-- ---------------------------------------------------------------------------
-- 7. Lưu cấu hình (chỉ qua hàm, có kiểm quyền)
-- ---------------------------------------------------------------------------
create or replace function public.timesheet_save_payroll_links(p_links jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_old text;
  v_link jsonb;
  v_month date;
begin
  if not (public.can_function('admin.payroll_settings') or public.can_function('admin.timesheet_lock')) then
    raise exception 'Bạn không có quyền đổi liên kết lương.' using errcode = '42501';
  end if;
  for v_link in select * from jsonb_array_elements(p_links) loop
    select component_code into v_old from public.timesheet_payroll_links where source = v_link ->> 'source';
    if v_old is not null and v_old is distinct from nullif(upper(trim(v_link ->> 'component_code')), '') then
      perform set_config('app.timesheet_payroll_sync', 'on', true);
      delete from public.payroll_inputs i
      where upper(i.code) = v_old
        and (to_regprocedure('public.payroll_month_closed(date)') is null or not public.payroll_month_closed(i.month_start))
        and exists (select 1 from public.timesheet_periods p where p.month_start = i.month_start and p.status = 'LOCKED');
      perform set_config('app.timesheet_payroll_sync', 'off', true);
    end if;
    update public.timesheet_payroll_links
    set component_code = nullif(upper(trim(v_link ->> 'component_code')), '')
    where source = v_link ->> 'source';
  end loop;
  for v_month in select month_start from public.timesheet_periods where status = 'LOCKED' loop
    perform public.timesheet_sync_payroll(v_month, null);
  end loop;
end;
$$;

revoke all on function public.timesheet_save_payroll_links(jsonb) from public;
grant execute on function public.timesheet_save_payroll_links(jsonb) to authenticated;

create or replace function public.timesheet_save_payroll_rules(
  p_late_tiers jsonb,
  p_night_cutoff time,
  p_night_requires_ot boolean,
  p_deduct_leave_first boolean
)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_tier jsonb;
  v_month date;
begin
  if not (public.can_function('admin.payroll_settings') or public.can_function('admin.timesheet_lock')) then
    raise exception 'Bạn không có quyền đổi quy tắc tính.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_late_tiers) <> 'array' then
    raise exception 'Bảng bậc phạt đi muộn không hợp lệ.' using errcode = '22023';
  end if;
  for v_tier in select * from jsonb_array_elements(p_late_tiers) loop
    if coalesce((v_tier ->> 'from')::int, 0) < 1 or coalesce((v_tier ->> 'days')::numeric, 0) <= 0 then
      raise exception 'Mỗi bậc cần số lần từ 1 trở lên và số ngày phạt lớn hơn 0.' using errcode = '22023';
    end if;
  end loop;

  update public.timesheet_payroll_rules
  set late_tiers = p_late_tiers,
      night_cutoff = p_night_cutoff,
      night_requires_ot = p_night_requires_ot,
      deduct_leave_first = p_deduct_leave_first,
      updated_by = auth.uid(),
      updated_at = now()
  where id;

  for v_month in select month_start from public.timesheet_periods where status = 'LOCKED' loop
    perform public.timesheet_sync_payroll(v_month, null);
  end loop;
end;
$$;

revoke all on function public.timesheet_save_payroll_rules(jsonb, time, boolean, boolean) from public;
grant execute on function public.timesheet_save_payroll_rules(jsonb, time, boolean, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Điền cho các kỳ công đã khoá mà kỳ lương còn mở
-- ---------------------------------------------------------------------------
do $mig$
declare
  v_month date;
begin
  for v_month in select month_start from public.timesheet_periods where status = 'LOCKED' loop
    perform public.timesheet_sync_payroll(v_month, null);
  end loop;
end
$mig$;
