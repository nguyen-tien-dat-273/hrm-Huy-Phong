-- ============================================================================
-- Đơn làm thêm tách theo loại: ngày thường / Chủ nhật - ngày nghỉ / ngày lễ / ca đêm.
-- ----------------------------------------------------------------------------
-- Bảng lương có bốn cột riêng cho làm thêm (OT ngày thường, OT Chủ nhật/ngày nghỉ,
-- OT ngày lễ, làm thêm ca đêm), nên nhân viên chọn đúng loại khi gửi đơn thay vì
-- một loại "Làm thêm giờ" để hệ thống đoán theo ngày.
--
--   OT_WEEKDAY  giờ làm thêm ngày thường          → OT_WEEKDAY_HOURS
--   OT_WEEKEND  giờ làm thêm Chủ nhật / ngày nghỉ → OT_WEEKEND_HOURS
--   OT_HOLIDAY  giờ làm thêm ngày lễ              → OT_HOLIDAY_HOURS
--   NIGHT_WORK  làm thêm ca đêm                   → NIGHT_WORK_DAYS (mỗi ngày một công)
--
-- Đơn được duyệt thì kỳ công đã khoá tự điền lại sang lương (trigger sẵn có
-- attendance_requests_timesheet_payroll); kỳ công chưa khoá thì số được tính khi khoá.
-- Loại cũ OVERTIME vẫn hợp lệ: đơn đã gửi trước đây giữ nguyên và vẫn tự chia theo ngày.
-- ============================================================================

alter table public.attendance_requests
  drop constraint if exists attendance_requests_request_type_check;
alter table public.attendance_requests
  add constraint attendance_requests_request_type_check check (request_type in (
    'LATE_ARRIVAL', 'EARLY_LEAVE', 'OVERTIME', 'OT_WEEKDAY', 'OT_WEEKEND', 'OT_HOLIDAY', 'NIGHT_WORK'
  ));

alter table public.attendance_requests
  drop constraint if exists attendance_request_measure_matches_type;
alter table public.attendance_requests
  add constraint attendance_request_measure_matches_type check (
    (request_type in ('LATE_ARRIVAL', 'EARLY_LEAVE') and minutes is not null and hours is null)
    or (request_type in ('OVERTIME', 'OT_WEEKDAY', 'OT_WEEKEND', 'OT_HOLIDAY', 'NIGHT_WORK')
        and hours is not null and minutes is null)
  );

comment on table public.attendance_requests is
  'Đơn đi muộn/về sớm và các đơn làm thêm (ngày thường, Chủ nhật/ngày nghỉ, ngày lễ, ca đêm). Đơn nghỉ phép nằm ở leave_requests.';

-- ---------------------------------------------------------------------------
-- Hạn mức tháng chỉ áp cho đi muộn / về sớm; mọi loại làm thêm không tiêu hạn mức.
-- ---------------------------------------------------------------------------
create or replace function public.guard_attendance_request_quota()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_quota integer;
  v_used integer;
begin
  if new.request_type not in ('LATE_ARRIVAL', 'EARLY_LEAVE') then
    return new;
  end if;

  if new.status in ('REJECTED', 'CANCELLED') then
    return new;
  end if;

  select coalesce(max(late_request_monthly_quota), 3) into v_quota
  from public.payroll_settings;

  select count(*) into v_used
  from public.attendance_requests r
  where r.user_id = new.user_id
    and r.request_type in ('LATE_ARRIVAL', 'EARLY_LEAVE')
    and r.status not in ('REJECTED', 'CANCELLED')
    and date_trunc('month', r.work_date) = date_trunc('month', new.work_date)
    and r.id is distinct from new.id;

  if v_used >= v_quota then
    raise exception
      'Đã dùng hết % đơn đi muộn/về sớm của tháng %. Đơn này không gửi được.',
      v_quota, to_char(new.work_date, 'MM/YYYY')
      using errcode = 'check_violation';
  end if;

  return new;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- Số liệu tháng: giờ làm thêm theo loại đơn, công ca đêm từ đơn ca đêm.
-- Chỉ đổi hai khối `ot` và `night`; các khối còn lại giữ nguyên.
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
        case q.request_type
          when 'OT_WEEKDAY' then 'D'
          when 'OT_WEEKEND' then 'W'
          when 'OT_HOLIDAY' then 'H'
          -- Đơn OVERTIME cũ: chia theo ngày như trước.
          else case
            when exists (select 1 from public.company_holidays h where h.is_active and h.holiday_date = q.work_date) then 'H'
            when public.ts_day_weight(q.work_date) = 0 then 'W'
            else 'D'
          end
        end as k
      from req q
      where q.request_type in ('OVERTIME', 'OT_WEEKDAY', 'OT_WEEKEND', 'OT_HOLIDAY')
        and coalesce(q.hours, 0) > 0
    ) x
    group by x.user_id
  ),
  night as (
    -- Một ngày tính một công nếu có đơn ca đêm đã duyệt, hoặc (cách cũ) ra sau mốc
    -- giờ đêm kèm một đơn làm thêm đã duyệt cùng ngày.
    select n.user_id, count(distinct n.d) as n
    from (
      select q.user_id, q.work_date as d
      from req q
      where q.request_type = 'NIGHT_WORK'
      union
      select a.user_id, a.date as d
      from att a cross join rules ru
      where a.check_out_time is not null
        and (a.check_out_time at time zone v_tz) > (a.date + ru.night_cutoff)
        and (
          not ru.night_requires_ot
          or exists (
            select 1 from req q
            where q.user_id = a.user_id and q.work_date = a.date
              and q.request_type in ('OVERTIME', 'OT_WEEKDAY', 'OT_WEEKEND', 'OT_HOLIDAY')
          )
        )
    ) n
    group by n.user_id
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
