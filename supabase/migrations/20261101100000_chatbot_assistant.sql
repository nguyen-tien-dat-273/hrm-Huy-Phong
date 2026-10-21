-- ============================================================================
-- Trợ lý hỏi đáp: các hàm CHỈ ĐỌC mà mô hình AI được phép gọi.
-- ----------------------------------------------------------------------------
-- Mô hình AI không bao giờ đọc thẳng bảng nào. Nó chỉ chọn một hàm dưới đây
-- và điền tham số; API (`api/chatbot.ts`) gọi hàm bằng JWT của CHÍNH người
-- hỏi. Vì vậy phân quyền nằm ở đây, không nằm ở lời nhắc gửi cho AI:
--
--   * Người có quyền chấm công / đơn từ: xem được số liệu của mọi người
--     (cùng mức với Bảng công và `timesheet_payroll_metrics`).
--   * Quản lý trực tiếp / người phụ trách đơn vị (`manages_employee`): nhân
--     sự mình quản lý, kể cả các tổ trực thuộc.
--   * Còn lại: chỉ số liệu của chính mình, hỏi về người khác thì nhận câu
--     "không có quyền" — dù AI có bị dụ gọi hàm với tên người khác.
--
-- Ngoài các hàm cho câu hỏi hay gặp, `chatbot_query` là công cụ "lắp ghép":
-- AI chọn bộ dữ liệu, chỉ số, cách nhóm, bộ lọc trong danh sách trắng; hàm tự
-- dựng SQL từ các biểu thức cố định nên vẫn không có SQL tự do nào từ AI.
--
-- Lương KHÔNG có hàm nào ở đây: thẻ phiếu lương trên giao diện tự gọi
-- `get_my_payslip` qua luồng xác thực lại sẵn có, số tiền không đi qua API
-- trợ lý lẫn nhà cung cấp AI.
--
-- Mọi hàm trả về jsonb có khoá `person` cho tên người — API thay khoá này
-- bằng bí danh trước khi gửi cho AI, nên AI không thấy họ tên nhân viên.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Hàm phụ (không cấp cho người dùng)
-- ---------------------------------------------------------------------------
create or replace function public.chatbot_fold(p text)
returns text language sql immutable set search_path = public as $$
  select trim(regexp_replace(translate(lower(normalize(coalesce(p, ''), NFC)),
    'àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ',
    'aaaaaaaaaaaaaaaaaeeeeeeeeeeeiiiiiooooooooooooooooouuuuuuuuuuuyyyyyd'), '\s+', ' ', 'g'));
$$;

create or replace function public.chatbot_today()
returns date language sql stable set search_path = public as $$
  select (now() at time zone 'Asia/Ho_Chi_Minh')::date;
$$;

-- Đơn vị khớp tên (bỏ dấu, bỏ tiền tố "phòng", "ban"…) cùng toàn bộ đơn vị con.
create or replace function public.chatbot_unit_scope(p_unit text)
returns uuid[]
language sql stable security definer set search_path = public as $$
  with recursive q as (
    select regexp_replace(public.chatbot_fold(p_unit),
      '^(phong|ban|bo phan|khoi|to|nhom|chi nhanh|don vi|cong ty)\s+', '') as v
  ),
  tree as (
    select u.id from public.organization_units u, q
    where u.is_active and q.v <> ''
      and (public.chatbot_fold(u.name) like '%' || q.v || '%' or lower(u.code) = lower(trim(p_unit)))
    union
    select c.id from public.organization_units c join tree t on c.parent_id = t.id
    where c.is_active
  )
  select coalesce(array_agg(distinct id), '{}') from tree;
$$;

create or replace function public.chatbot_unit_not_found(p_unit text)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'error', format('Không tìm thấy đơn vị "%s".', p_unit),
    'available_units', coalesce((
      select jsonb_agg(u.name order by u.name)
      from (select name from public.organization_units where is_active order by name limit 40) u
    ), '[]'::jsonb)
  );
$$;

-- Người được hỏi tới. Chỉ dùng sau khi hàm gọi đã kiểm quyền.
create or replace function public.chatbot_people(p_units uuid[], p_person text)
returns table (user_id uuid, person text, unit text)
language sql stable security definer set search_path = public as $$
  select p.id, p.name, u.name
  from public.profiles p
  left join public.organization_units u on u.id = p.unit_id
  where p.is_active
    and (p_units is null or p.unit_id = any(p_units))
    and (
      nullif(trim(p_person), '') is null
      or public.chatbot_fold(p.name) like '%' || public.chatbot_fold(p_person) || '%'
      or lower(p.employee_code) = lower(trim(p_person))
    );
$$;

-- Ngày đi muộn: cùng cách đo với Báo cáo công (giờ vào − giờ chuẩn − phút ân hạn).
-- Một ngày có thể có hai bản ghi (hai ca) — lấy giờ vào SỚM NHẤT trong ngày,
-- để ca chiều không bị tính là đi muộn so với giờ vào buổi sáng.
create or replace function public.chatbot_late_rows(p_from date, p_to date, p_users uuid[])
returns table (user_id uuid, work_date date, check_in text, late_minutes integer, excuse text)
language sql stable security definer set search_path = public as $$
  with first_in as (
    select x.user_id, x.date, min(x.check_in_time) as check_in_time
    from public.attendance x
    where x.date between p_from and p_to and x.user_id = any(p_users) and x.check_in_time is not null
    group by x.user_id, x.date
  )
  select a.user_id, a.date,
    to_char(a.check_in_time at time zone 'Asia/Ho_Chi_Minh', 'HH24:MI'),
    m.mins::int,
    coalesce((
      select case r.status when 'APPROVED' then 'Có đơn đã duyệt' else 'Đơn đang chờ duyệt' end
      from public.attendance_requests r
      where r.user_id = a.user_id and r.work_date = a.date
        and r.request_type = 'LATE_ARRIVAL' and r.status in ('APPROVED', 'PENDING')
      order by (r.status = 'APPROVED') desc limit 1
    ), 'Không có đơn')
  from first_in a
  join lateral (
    select s.start_time, s.grace_minutes
    from public.work_schedules s
    where s.is_active and s.effective_from <= a.date and (s.effective_to is null or s.effective_to >= a.date)
    order by s.effective_from desc limit 1
  ) sc on true
  cross join lateral (
    select extract(hour from (a.check_in_time at time zone 'Asia/Ho_Chi_Minh'))::int * 60
      + extract(minute from (a.check_in_time at time zone 'Asia/Ho_Chi_Minh'))::int
      - (extract(hour from sc.start_time)::int * 60 + extract(minute from sc.start_time)::int)
      - coalesce(sc.grace_minutes, 0) as mins
  ) m
  where public.ts_day_weight(a.date) > 0
    and m.mins > 0;
$$;

-- Những người đang làm việc mà người hỏi được xem trong một mảng nghiệp vụ:
-- có một trong các quyền `p_areas` thì mọi người; không thì chính mình cộng
-- những người mình quản lý (quản lý trực tiếp / phụ trách đơn vị cấp trên).
create or replace function public.chatbot_scope_users(p_areas text[])
returns uuid[]
language sql stable security definer set search_path = public as $$
  with g as (select exists (select 1 from unnest(p_areas) a where public.can(a)) as all_people)
  select coalesce(array_agg(p.id), '{}')
  from public.profiles p, g
  where p.is_active
    and (g.all_people or p.id = auth.uid() or public.manages_employee(p.id));
$$;

create or replace function public.chatbot_coverage(p_areas text[], p_scope uuid[])
returns text
language sql stable security definer set search_path = public as $$
  select case
    when exists (select 1 from unnest(p_areas) a where public.can(a)) then 'Toàn công ty'
    when cardinality(p_scope) > 1 then 'Nhân sự bạn quản lý'
    else 'Chỉ bản thân bạn'
  end;
$$;

-- Tìm đúng MỘT người cho các câu hỏi về cá nhân, trong phạm vi `p_scope`
-- (null = không giới hạn, hàm gọi tự kiểm quyền sau). Trả về lỗi dạng jsonb
-- khi không có quyền / không thấy / trùng tên.
drop function if exists public.chatbot_resolve_person(text, boolean);
create or replace function public.chatbot_resolve_person(p_person text, p_scope uuid[], out o_user uuid, out o_error jsonb)
language plpgsql stable security definer set search_path = public as $$
declare
  v_matches jsonb;
  v_count int;
begin
  if nullif(trim(p_person), '') is null then
    o_user := auth.uid();
    return;
  end if;

  select count(*), jsonb_agg(jsonb_build_object('person', x.person, 'unit', x.unit))
    into v_count, v_matches
  from (
    select * from public.chatbot_people(null, p_person) c
    where p_scope is null or c.user_id = any(p_scope)
    limit 8
  ) x;

  if v_count = 0 then
    if exists (select 1 from public.chatbot_people(null, p_person)) then
      o_error := jsonb_build_object('error', case when cardinality(p_scope) <= 1
        then 'Bạn chỉ xem được số liệu của chính mình.'
        else 'Người này không thuộc phạm vi bạn được xem.' end);
    else
      o_error := jsonb_build_object('error', format('Không tìm thấy nhân viên "%s" đang làm việc.', p_person));
    end if;
  elsif v_count > 1 then
    o_error := jsonb_build_object('error', 'Có nhiều người trùng tên, hỏi lại kèm tên đầy đủ hoặc đơn vị.',
      'candidates', v_matches);
  else
    select c.user_id into o_user from public.chatbot_people(null, p_person) c
    where p_scope is null or c.user_id = any(p_scope);
  end if;
end;
$$;

revoke all on function public.chatbot_unit_scope(text) from public, anon, authenticated;
revoke all on function public.chatbot_unit_not_found(text) from public, anon, authenticated;
revoke all on function public.chatbot_people(uuid[], text) from public, anon, authenticated;
revoke all on function public.chatbot_late_rows(date, date, uuid[]) from public, anon, authenticated;
revoke all on function public.chatbot_scope_users(text[]) from public, anon, authenticated;
revoke all on function public.chatbot_coverage(text[], uuid[]) from public, anon, authenticated;
revoke all on function public.chatbot_resolve_person(text, uuid[]) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Tình hình một ngày: ai đã đến, ai đi muộn, ai nghỉ, ai chưa chấm công
-- ---------------------------------------------------------------------------
create or replace function public.chatbot_attendance_day(p_date date default null, p_unit text default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_date date := coalesce(p_date, public.chatbot_today());
  v_today date := public.chatbot_today();
  v_scope uuid[] := public.chatbot_scope_users(array['attendance', 'leave']);
  v_units uuid[];
  v_users uuid[];
  v_att record;
  v_result jsonb;
begin
  if auth.uid() is null then
    raise exception 'Chưa đăng nhập.' using errcode = '42501';
  end if;

  -- Không xem được ai khác: trả lời về ngày của chính mình.
  if cardinality(v_scope) <= 1 then
    if nullif(trim(p_unit), '') is not null then
      return jsonb_build_object('error', 'Bạn chỉ xem được số liệu chấm công của chính mình.');
    end if;
    select min(a.check_in_time) as check_in_time, max(a.check_out_time) as check_out_time into v_att
    from public.attendance a where a.user_id = auth.uid() and a.date = v_date;
    return jsonb_build_object(
      'scope', 'self',
      'date', v_date,
      'is_workday', public.ts_day_weight(v_date) > 0,
      'check_in', to_char(v_att.check_in_time at time zone 'Asia/Ho_Chi_Minh', 'HH24:MI'),
      'check_out', to_char(v_att.check_out_time at time zone 'Asia/Ho_Chi_Minh', 'HH24:MI'),
      'late_minutes', (select l.late_minutes from public.chatbot_late_rows(v_date, v_date, array[auth.uid()]) l limit 1),
      'leave', (
        select jsonb_build_object('type', lr.leave_type, 'half_day', lr.half_day)
        from public.leave_requests lr
        where lr.user_id = auth.uid() and lr.status = 'approved' and not lr.is_cancelled
          and v_date between lr.start_date and lr.end_date
        limit 1
      )
    );
  end if;

  if nullif(trim(p_unit), '') is not null then
    v_units := public.chatbot_unit_scope(p_unit);
    if cardinality(v_units) = 0 then
      return public.chatbot_unit_not_found(p_unit);
    end if;
  end if;
  select coalesce(array_agg(c.user_id), '{}') into v_users
  from public.chatbot_people(v_units, null) c where c.user_id = any(v_scope);

  with ppl as (
    select * from public.chatbot_people(v_units, null) c where c.user_id = any(v_users)
  ),
  att as (
    select a.user_id, a.check_in_time, a.check_out_time
    from public.attendance a
    where a.date = v_date and a.user_id = any(v_users)
      and (a.check_in_time is not null or a.check_out_time is not null)
  ),
  lv as (
    select distinct on (lr.user_id) lr.user_id, lr.leave_type, lr.half_day
    from public.leave_requests lr
    where lr.status = 'approved' and not lr.is_cancelled
      and v_date between lr.start_date and lr.end_date and lr.user_id = any(v_users)
    order by lr.user_id, lr.half_day
  ),
  late as (
    select l.*, p.person, p.unit from public.chatbot_late_rows(v_date, v_date, v_users) l
    join ppl p on p.user_id = l.user_id
  ),
  absent as (
    select p.person, p.unit from ppl p
    where public.ts_day_weight(v_date) > 0 and v_date <= v_today
      and not exists (select 1 from att a where a.user_id = p.user_id)
      and not exists (select 1 from lv where lv.user_id = p.user_id)
  )
  select jsonb_build_object(
    'scope', 'team',
    'coverage', public.chatbot_coverage(array['attendance', 'leave'], v_scope),
    'date', v_date,
    'unit_filter', nullif(trim(p_unit), ''),
    'is_workday', public.ts_day_weight(v_date) > 0,
    'headcount', (select count(*) from ppl),
    'present_count', (select count(distinct user_id) from att),
    'late_count', (select count(*) from late),
    'late', coalesce((
      select jsonb_agg(jsonb_build_object('person', x.person, 'unit', x.unit, 'check_in', x.check_in,
        'late_minutes', x.late_minutes, 'excuse', x.excuse) order by x.late_minutes desc)
      from (select * from late order by late_minutes desc limit 40) x
    ), '[]'::jsonb),
    'on_leave_count', (select count(*) from lv),
    'on_leave', coalesce((
      select jsonb_agg(jsonb_build_object('person', p.person, 'unit', p.unit,
        'type', case lv.leave_type when 'annual' then 'Phép năm' when 'sick' then 'Nghỉ ốm'
                  when 'unpaid' then 'Không lương' else 'Khác' end,
        'half_day', lv.half_day) order by p.person)
      from lv join ppl p on p.user_id = lv.user_id
    ), '[]'::jsonb),
    'not_checked_in_count', (select count(*) from absent),
    'not_checked_in', coalesce((
      select jsonb_agg(jsonb_build_object('person', x.person, 'unit', x.unit) order by x.person)
      from (select * from absent order by person limit 40) x
    ), '[]'::jsonb),
    'note', case when v_date = v_today
      then 'Số liệu tính đến thời điểm hỏi; "chưa chấm công" gồm cả người có thể đến muộn hoặc quên chấm.' end
  ) into v_result;

  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Đi muộn trong một khoảng ngày: xếp hạng theo người, hoặc chi tiết một người
-- ---------------------------------------------------------------------------
create or replace function public.chatbot_late_summary(
  p_from date default null, p_to date default null, p_unit text default null, p_person text default null
)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_to date := least(coalesce(p_to, public.chatbot_today()), public.chatbot_today());
  v_from date := coalesce(p_from, date_trunc('month', coalesce(p_to, public.chatbot_today()))::date);
  v_scope uuid[] := public.chatbot_scope_users(array['attendance']);
  v_team boolean := cardinality(v_scope) > 1;
  v_units uuid[];
  v_users uuid[];
  v_single boolean;
  v_who record;
begin
  if auth.uid() is null then
    raise exception 'Chưa đăng nhập.' using errcode = '42501';
  end if;
  if v_from > v_to then
    return jsonb_build_object('error', 'Khoảng ngày không hợp lệ (ngày bắt đầu sau ngày kết thúc hoặc ở tương lai).');
  end if;
  if v_to - v_from > 92 then
    return jsonb_build_object('error', 'Chỉ tra được tối đa 3 tháng một lần.');
  end if;

  if nullif(trim(p_person), '') is not null then
    select * into v_who from public.chatbot_resolve_person(p_person, v_scope);
    if v_who.o_error is not null then return v_who.o_error; end if;
    v_users := array[v_who.o_user];
  elsif v_team then
    if nullif(trim(p_unit), '') is not null then
      v_units := public.chatbot_unit_scope(p_unit);
      if cardinality(v_units) = 0 then return public.chatbot_unit_not_found(p_unit); end if;
    end if;
    select coalesce(array_agg(c.user_id), '{}') into v_users
    from public.chatbot_people(v_units, null) c where c.user_id = any(v_scope);
  else
    if nullif(trim(p_unit), '') is not null then
      return jsonb_build_object('error', 'Bạn chỉ xem được số liệu chấm công của chính mình.');
    end if;
    v_users := array[auth.uid()];
  end if;
  v_single := cardinality(v_users) = 1;

  return (
    with lr as (
      select l.*, p.name as person, u.name as unit
      from public.chatbot_late_rows(v_from, v_to, v_users) l
      join public.profiles p on p.id = l.user_id
      left join public.organization_units u on u.id = p.unit_id
    ),
    agg as (
      select person, unit, count(*) as late_count, sum(late_minutes) as late_minutes,
        count(*) filter (where excuse = 'Có đơn đã duyệt') as excused_count
      from lr group by user_id, person, unit
    )
    select jsonb_build_object(
      'scope', case when v_single and v_users[1] = auth.uid() then 'self' when v_single then 'person' else 'team' end,
      'coverage', case when not v_single then public.chatbot_coverage(array['attendance'], v_scope) end,
      'from', v_from,
      'to', v_to,
      'unit_filter', nullif(trim(p_unit), ''),
      'total_late_times', (select count(*) from lr),
      'people_late', (select count(*) from agg),
      'by_person', coalesce((
        select jsonb_agg(to_jsonb(a) order by a.late_count desc, a.late_minutes desc)
        from (select * from agg order by late_count desc, late_minutes desc limit 30) a
      ), '[]'::jsonb),
      'days', case when v_single then coalesce((
        select jsonb_agg(jsonb_build_object('date', r.work_date, 'check_in', r.check_in,
          'late_minutes', r.late_minutes, 'excuse', r.excuse) order by r.work_date)
        from lr r
      ), '[]'::jsonb) end,
      'rule', 'Đi muộn = giờ vào sau giờ bắt đầu ca cộng phút ân hạn, chỉ tính ngày làm việc.'
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Công trong tháng của một người
-- ---------------------------------------------------------------------------
create or replace function public.chatbot_month_summary(p_month date default null, p_person text default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_start date := date_trunc('month', coalesce(p_month, public.chatbot_today()))::date;
  v_end date := (date_trunc('month', coalesce(p_month, public.chatbot_today())) + interval '1 month - 1 day')::date;
  v_until date;
  v_who record;
  v_uid uuid;
begin
  if auth.uid() is null then
    raise exception 'Chưa đăng nhập.' using errcode = '42501';
  end if;
  select * into v_who from public.chatbot_resolve_person(p_person, public.chatbot_scope_users(array['attendance']));
  if v_who.o_error is not null then return v_who.o_error; end if;
  v_uid := v_who.o_user;
  v_until := least(v_end, public.chatbot_today());
  if v_until < v_start then
    return jsonb_build_object('error', 'Tháng này chưa bắt đầu.');
  end if;

  return (
    with att as (
      select a.date, a.check_in_time, a.check_out_time, a.approved_by_lead
      from public.attendance a
      where a.user_id = v_uid and a.date between v_start and v_end
    ),
    late as (
      select * from public.chatbot_late_rows(v_start, v_end, array[v_uid])
    ),
    req as (
      select r.request_type, r.status, r.hours
      from public.attendance_requests r
      where r.user_id = v_uid and r.work_date between v_start and v_end
    ),
    leave_days as (
      select lr.leave_type,
        sum(public.ts_day_weight(d::date) * case when lr.half_day then 0.5 else 1 end) as days
      from public.leave_requests lr
      cross join lateral generate_series(greatest(lr.start_date, v_start)::timestamp, least(lr.end_date, v_end)::timestamp, interval '1 day') d
      where lr.user_id = v_uid and lr.status = 'approved' and not lr.is_cancelled
        and lr.start_date <= v_end and lr.end_date >= v_start
      group by lr.leave_type
    )
    select jsonb_build_object(
      'scope', case when v_uid = auth.uid() then 'self' else 'person' end,
      'person', (select name from public.profiles where id = v_uid),
      'month', to_char(v_start, 'MM/YYYY'),
      'counted_until', v_until,
      'standard_days', coalesce(
        (select m.standard_days from public.month_standard_days m where m.month = v_start),
        (select sum(public.ts_day_weight(d::date)) from generate_series(v_start::timestamp, v_end::timestamp, interval '1 day') d)
      ),
      'work_days', coalesce((
        select sum(public.ts_day_weight(d.date))
        from (select distinct a.date from att a where a.check_in_time is not null) d
      ), 0),
      'approved_work_days', coalesce((
        select sum(public.ts_day_weight(d.date))
        from (select distinct a.date from att a where a.check_in_time is not null and a.approved_by_lead) d
      ), 0),
      'late_count', (select count(*) from late),
      'late_minutes', coalesce((select sum(late_minutes) from late), 0),
      'late_without_approved_request', (select count(*) from late where excuse <> 'Có đơn đã duyệt'),
      'missing_checkout_days', (
        select count(*) from att a
        where a.check_in_time is not null and a.check_out_time is null and a.date < public.chatbot_today()
      ),
      'overtime_hours_approved', coalesce((select sum(hours) from req where request_type = 'OVERTIME' and status = 'APPROVED'), 0),
      'overtime_hours_pending', coalesce((select sum(hours) from req where request_type = 'OVERTIME' and status = 'PENDING'), 0),
      'leave_days', coalesce((
        select jsonb_object_agg(case leave_type when 'annual' then 'Phép năm' when 'sick' then 'Nghỉ ốm'
          when 'unpaid' then 'Không lương' else 'Khác' end, days)
        from leave_days where days > 0
      ), '{}'::jsonb),
      'timesheet_status', coalesce((
        select case t.status when 'LOCKED' then 'Đã khoá công' when 'REVIEW' then 'Đang rà soát' else 'Đang mở' end
        from public.timesheet_periods t where t.month_start = v_start
      ), 'Đang mở')
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Phép năm còn lại
-- ---------------------------------------------------------------------------
create or replace function public.chatbot_leave_balance(p_person text default null, p_year integer default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_year int := coalesce(p_year, extract(year from public.chatbot_today())::int);
  v_who record;
  v_uid uuid;
  v_has_ledger boolean;
  v_granted numeric;
  v_balance numeric;
  v_used numeric;
begin
  if auth.uid() is null then
    raise exception 'Chưa đăng nhập.' using errcode = '42501';
  end if;
  select * into v_who from public.chatbot_resolve_person(p_person, public.chatbot_scope_users(array['leave']));
  if v_who.o_error is not null then return v_who.o_error; end if;
  v_uid := v_who.o_user;

  -- Cùng cách tính với màn Đơn từ: có sổ phép thì theo sổ, chưa có thì lấy định mức trừ đơn đã duyệt.
  select exists (
    select 1 from public.leave_ledger l where l.user_id = v_uid and l.leave_type = 'annual' and l.leave_year = v_year
  ) into v_has_ledger;

  if v_has_ledger then
    select coalesce(sum(days) filter (where entry_type in ('GRANT', 'CARRY_FORWARD', 'ADJUSTMENT')), 0), coalesce(sum(days), 0)
      into v_granted, v_balance
    from public.leave_ledger where user_id = v_uid and leave_type = 'annual' and leave_year = v_year;
    v_used := greatest(v_granted - v_balance, 0);
  else
    select coalesce(p.annual_leave_quota, 12) into v_granted from public.profiles p where p.id = v_uid;
    select coalesce(sum(days), 0) into v_used from public.leave_requests
    where user_id = v_uid and leave_type = 'annual' and status = 'approved' and not is_cancelled
      and extract(year from start_date) = v_year;
    v_balance := v_granted - v_used;
  end if;

  return jsonb_build_object(
    'scope', case when v_uid = auth.uid() then 'self' else 'person' end,
    'person', (select name from public.profiles where id = v_uid),
    'year', v_year,
    'annual_granted', v_granted,
    'annual_used', v_used,
    'annual_remaining', greatest(v_balance, 0),
    'annual_pending', (
      select coalesce(sum(days), 0) from public.leave_requests
      where user_id = v_uid and leave_type = 'annual' and status = 'pending' and not is_cancelled
        and extract(year from start_date) = v_year
    ),
    'other_leave_used', coalesce((
      select jsonb_object_agg(case leave_type when 'sick' then 'Nghỉ ốm' when 'unpaid' then 'Không lương' else 'Khác' end, d)
      from (
        select leave_type, sum(days) as d from public.leave_requests
        where user_id = v_uid and leave_type <> 'annual' and status = 'approved' and not is_cancelled
          and extract(year from start_date) = v_year
        group by leave_type
      ) x
    ), '{}'::jsonb),
    'upcoming_leaves', coalesce((
      select jsonb_agg(jsonb_build_object('from', start_date, 'to', end_date, 'days', days, 'status',
        case status when 'approved' then 'Đã duyệt' else 'Chờ duyệt' end) order by start_date)
      from (
        select * from public.leave_requests
        where user_id = v_uid and status in ('approved', 'pending') and not is_cancelled
          and end_date >= public.chatbot_today()
        order by start_date limit 5
      ) u
    ), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Việc đang chờ: đơn của tôi, đơn tôi cần duyệt, phiếu KPI cần chấm
-- ---------------------------------------------------------------------------
create or replace function public.chatbot_pending_items()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_month date := date_trunc('month', public.chatbot_today())::date;
  v_result jsonb;
begin
  if v_uid is null then
    raise exception 'Chưa đăng nhập.' using errcode = '42501';
  end if;

  v_result := jsonb_build_object(
    'my_requests', jsonb_build_object(
      'leave_pending', (select count(*) from public.leave_requests where user_id = v_uid and status = 'pending' and not is_cancelled),
      'attendance_requests_pending', (select count(*) from public.attendance_requests where user_id = v_uid and status = 'PENDING'),
      'kpi_sheet_this_month', (
        select case s.status when 'DRAFT' then 'Chưa gửi tự chấm' when 'PENDING' then 'Chờ quản lý chấm'
          when 'REJECTED' then 'Bị trả lại, cần sửa' when 'BOARD' then 'Chờ Ban Giám đốc duyệt' else 'Đã duyệt' end
        from public.kpi_sheets s where s.user_id = v_uid and s.period_month = v_month
      )
    ),
    'kpi_to_review', (select count(*) from public.kpi_sheets where reviewer_id = v_uid and status = 'PENDING')
  );

  if public.can('leave') then
    v_result := v_result || jsonb_build_object('leave_to_approve', jsonb_build_object(
      'manager_stage', (select count(*) from public.leave_requests where status = 'pending' and not is_cancelled
        and coalesce(approval_stage, 'MANAGER') = 'MANAGER'),
      'hr_stage', (select count(*) from public.leave_requests where status = 'pending' and not is_cancelled
        and approval_stage = 'HR')
    ));
  end if;
  if public.can('attendance') then
    v_result := v_result || jsonb_build_object(
      'attendance_requests_to_approve', (select count(*) from public.attendance_requests where status = 'PENDING'),
      'attendance_days_to_confirm', (
        select count(*) from public.attendance
        where status = 'completed' and not approved_by_lead and date >= v_month - interval '1 month'
      )
    );
  end if;
  if public.can_function('admin.kpi_approve') then
    v_result := v_result || jsonb_build_object(
      'kpi_waiting_board', (select count(*) from public.kpi_sheets where status = 'BOARD')
    );
  end if;
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Kết quả KPI một tháng
-- ---------------------------------------------------------------------------
create or replace function public.chatbot_kpi(p_month date default null, p_person text default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_month date := date_trunc('month', coalesce(p_month, public.chatbot_today()))::date;
  v_who record;
  v_sheet public.kpi_sheets%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Chưa đăng nhập.' using errcode = '42501';
  end if;
  -- Xem phiếu người khác: người cấu hình / duyệt KPI, hoặc người chấm của chính phiếu đó (kiểm bên dưới).
  select * into v_who from public.chatbot_resolve_person(p_person, null::uuid[]);
  if v_who.o_error is not null then return v_who.o_error; end if;

  select * into v_sheet from public.kpi_sheets where user_id = v_who.o_user and period_month = v_month;
  if v_who.o_user <> auth.uid()
     and not public.can_function('admin.performance_manage')
     and not public.can_function('admin.kpi_approve')
     and v_sheet.reviewer_id is distinct from auth.uid() then
    return jsonb_build_object('error', 'Bạn không có quyền xem KPI của người này.');
  end if;

  if v_sheet.id is null then
    return jsonb_build_object(
      'scope', case when v_who.o_user = auth.uid() then 'self' else 'person' end,
      'month', to_char(v_month, 'MM/YYYY'),
      'sheet', null,
      'note', 'Chưa có phiếu KPI cho tháng này (kỳ chưa mở hoặc không thuộc diện chấm).'
    );
  end if;

  return jsonb_build_object(
    'scope', case when v_who.o_user = auth.uid() then 'self' else 'person' end,
    'person', (select name from public.profiles where id = v_who.o_user),
    'month', to_char(v_month, 'MM/YYYY'),
    'set_name', v_sheet.set_name,
    'status', case v_sheet.status when 'DRAFT' then 'Chưa gửi tự chấm' when 'PENDING' then 'Chờ quản lý chấm'
      when 'REJECTED' then 'Bị trả lại, cần sửa' when 'BOARD' then 'Chờ Ban Giám đốc duyệt' else 'Đã duyệt' end,
    'self_pct', v_sheet.self_pct,
    'manager_pct', v_sheet.manager_pct,
    'bonus_pct', v_sheet.bonus_pct,
    'final_pct', v_sheet.final_pct,
    'grade', v_sheet.grade,
    'period_status', coalesce((
      select case k.status when 'LOCKED' then 'Đã khoá sổ' else 'Đang mở' end
      from public.kpi_periods k where k.month_start = v_month
    ), 'Chưa mở')
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Ngày lễ sắp tới và quân số
-- ---------------------------------------------------------------------------
create or replace function public.chatbot_holidays(p_from date default null, p_to date default null)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'holidays', coalesce((
      select jsonb_agg(jsonb_build_object('date', h.holiday_date, 'name', h.name) order by h.holiday_date)
      from (
        select holiday_date, name from public.company_holidays
        where is_active
          and holiday_date between coalesce(p_from, public.chatbot_today())
                               and coalesce(p_to, coalesce(p_from, public.chatbot_today()) + 365)
        order by holiday_date limit 30
      ) h
    ), '[]'::jsonb)
  )
  where auth.uid() is not null;
$$;

create or replace function public.chatbot_headcount(p_unit text default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_units uuid[];
begin
  if auth.uid() is null then
    raise exception 'Chưa đăng nhập.' using errcode = '42501';
  end if;
  if not (public.can('users') or public.can('attendance') or public.can('reports')) then
    return jsonb_build_object('error', 'Bạn không có quyền xem số liệu quân số.');
  end if;
  if nullif(trim(p_unit), '') is not null then
    v_units := public.chatbot_unit_scope(p_unit);
    if cardinality(v_units) = 0 then return public.chatbot_unit_not_found(p_unit); end if;
  end if;

  return (
    with ppl as (select * from public.chatbot_people(v_units, null))
    select jsonb_build_object(
      'unit_filter', nullif(trim(p_unit), ''),
      'total_active', (select count(*) from ppl),
      'by_unit', coalesce((
        select jsonb_agg(jsonb_build_object('unit', coalesce(unit, 'Chưa gán đơn vị'), 'count', n) order by n desc)
        from (select unit, count(*) as n from ppl group by unit) g
      ), '[]'::jsonb)
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. Truy vấn lắp ghép — cho những câu hỏi không có hàm riêng
-- ---------------------------------------------------------------------------
-- p_spec = {dataset, metrics[], group_by[], from, to, unit, person,
--           filters {status, leave_type, request_type, grade, employment_status, position},
--           sort_by, sort_order, limit, min_value}
--
-- Tên chiều / chỉ số chỉ được chọn trong các bảng ánh xạ cố định bên dưới:
-- biểu thức SQL không bao giờ lấy từ đầu vào, giá trị lọc đi qua tham số
-- ($1…$9), người được xem đã lọc sẵn theo quyền vào $3.
create or replace function public.chatbot_query(p_spec jsonb)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_today date := public.chatbot_today();
  v_dataset text := lower(coalesce(p_spec->>'dataset', ''));
  v_filters jsonb := case when jsonb_typeof(p_spec->'filters') = 'object' then p_spec->'filters' else '{}'::jsonb end;
  v_unit text := nullif(trim(p_spec->>'unit'), '');
  v_person text := nullif(trim(p_spec->>'person'), '');
  v_limit int;
  v_min numeric;
  v_sort text := p_spec->>'sort_by';
  v_asc boolean := lower(coalesce(p_spec->>'sort_order', '')) = 'asc';
  v_from date;
  v_to date;
  v_metrics text[];
  v_group text[];
  v_default_metric text;
  v_dims jsonb := jsonb_build_object('person', 'person', 'unit', 'unit', 'position', 'job');
  v_meas jsonb;
  v_text_meas text[] := array['avg_check_in', 'avg_check_out'];
  v_time_dims text[] := array['date', 'week', 'month', 'weekday', 'hire_date', 'hire_month', 'hire_year'];
  v_areas text[];
  v_scope uuid[];
  v_users uuid[];
  v_units uuid[];
  v_full_kpi boolean := false;
  v_status text;
  v_coverage text;
  v_note text;
  v_ppl text;
  v_ctes text;
  v_sel text;
  v_grp text;
  v_msel text;
  v_having text := '';
  v_order text;
  v_first_time text;
  v_out jsonb;
  v_totals jsonb;
begin
  if auth.uid() is null then
    raise exception 'Chưa đăng nhập.' using errcode = '42501';
  end if;

  begin
    v_from := nullif(p_spec->>'from', '')::date;
    v_to := nullif(p_spec->>'to', '')::date;
    v_limit := least(greatest(coalesce(nullif(p_spec->>'limit', '')::int, 20), 1), 50);
    v_min := nullif(p_spec->>'min_value', '')::numeric;
  exception when others then
    return jsonb_build_object('error', 'Tham số không hợp lệ (ngày dạng YYYY-MM-DD, limit và min_value là số).');
  end;

  if v_dataset in ('attendance', 'leave', 'requests') then
    v_dims := v_dims || jsonb_build_object(
      'date', $q$to_char(date, 'YYYY-MM-DD')$q$,
      'week', $q$to_char(date_trunc('week', date), 'YYYY-MM-DD')$q$,
      'month', $q$to_char(date, 'YYYY-MM')$q$,
      'weekday', $q$case extract(isodow from date)::int when 7 then 'Chủ nhật' else 'Thứ ' || (extract(isodow from date)::int + 1) end$q$
    );
  end if;

  if v_dataset = 'attendance' then
    v_areas := array['attendance'];
    v_to := least(coalesce(v_to, v_today), v_today);
    v_from := coalesce(v_from, date_trunc('month', v_to)::date);
    v_default_metric := 'work_days';
    v_meas := jsonb_build_object(
      'work_days', 'coalesce(sum(w) filter (where ci is not null), 0)',
      'late_count', 'count(*) filter (where late_min > 0)',
      'late_minutes', 'coalesce(sum(late_min), 0)',
      'early_leave_count', 'count(*) filter (where early_min > 0)',
      'early_leave_minutes', 'coalesce(sum(early_min), 0)',
      'absent_days', 'coalesce(sum(w) filter (where absent), 0)',
      'leave_days', 'coalesce(sum(w * leave_part), 0)',
      'missing_checkout', 'count(*) filter (where ci is not null and co is null and date < $4)',
      'avg_check_in', $q$to_char(avg(ci - time '00:00'), 'HH24:MI')$q$,
      'avg_check_out', $q$to_char(avg(co - time '00:00'), 'HH24:MI')$q$,
      'avg_work_hours', 'round((avg(extract(epoch from co - ci) / 3600) filter (where co > ci))::numeric, 2)',
      'people', 'count(distinct user_id)',
      'people_late', 'count(distinct user_id) filter (where late_min > 0)',
      'people_absent', 'count(distinct user_id) filter (where absent)'
    );
    v_ctes := $q$
      days as (
        select d::date as date, public.ts_day_weight(d::date) as w, sc.start_time, sc.end_time, sc.grace_minutes
        from generate_series($1::timestamp, $2::timestamp, interval '1 day') d
        left join lateral (
          select s.start_time, s.end_time, s.grace_minutes from public.work_schedules s
          where s.is_active and s.effective_from <= d::date and (s.effective_to is null or s.effective_to >= d::date)
          order by s.effective_from desc limit 1
        ) sc on true
        where public.ts_day_weight(d::date) > 0
      ),
      att as (
        select a.user_id, a.date,
          (min(a.check_in_time) at time zone 'Asia/Ho_Chi_Minh')::time as ci,
          (max(a.check_out_time) at time zone 'Asia/Ho_Chi_Minh')::time as co
        from public.attendance a
        where a.date between $1 and $2 and a.user_id = any($3)
        group by a.user_id, a.date
      ),
      lv as (
        select lr.user_id, g::date as date, max(case when lr.half_day then 0.5 else 1 end) as part
        from public.leave_requests lr
        cross join lateral generate_series(greatest(lr.start_date, $1)::timestamp, least(lr.end_date, $2)::timestamp, interval '1 day') g
        where lr.status = 'approved' and not lr.is_cancelled and lr.user_id = any($3)
          and lr.start_date <= $2 and lr.end_date >= $1
        group by lr.user_id, g::date
      ),
      base as (
        select p.user_id, p.person, p.unit, p.job, d.date, d.w, a.ci, a.co,
          coalesce(l.part, 0) as leave_part,
          case when a.ci is not null and d.start_time is not null then greatest(0,
            (extract(hour from a.ci) * 60 + extract(minute from a.ci))::int
            - (extract(hour from d.start_time) * 60 + extract(minute from d.start_time))::int
            - coalesce(d.grace_minutes, 0)) else 0 end as late_min,
          -- Về sớm chỉ xét ngày làm đủ, không nghỉ nửa ngày.
          case when a.co is not null and d.end_time is not null and d.w >= 1 and l.part is null then greatest(0,
            (extract(hour from d.end_time) * 60 + extract(minute from d.end_time))::int
            - (extract(hour from a.co) * 60 + extract(minute from a.co))::int) else 0 end as early_min,
          (a.ci is null and a.co is null and l.part is null and d.date < $4) as absent
        from ppl p
        cross join days d
        left join att a on a.user_id = p.user_id and a.date = d.date
        left join lv l on l.user_id = p.user_id and l.date = d.date
        where p.hire_date is null or d.date >= p.hire_date
      )$q$;
    v_note := 'Chỉ tính ngày làm việc (bỏ ngày nghỉ, ngày lễ), đến hết hôm nay. Vắng = ngày làm việc đã qua, không chấm công, không có đơn nghỉ được duyệt. Đi muộn / về sớm so với giờ ca cộng phút ân hạn, lấy giờ vào sớm nhất và giờ ra muộn nhất trong ngày.';

  elsif v_dataset in ('leave', 'requests') then
    v_areas := case v_dataset when 'leave' then array['leave'] else array['attendance'] end;
    v_from := coalesce(v_from, date_trunc('month', coalesce(v_to, v_today))::date);
    v_to := coalesce(v_to, (date_trunc('month', v_from) + interval '1 month - 1 day')::date);
    if v_dataset = 'leave' then
      v_status := lower(coalesce(nullif(v_filters->>'status', ''), 'approved'));
      v_default_metric := 'days';
      v_meas := jsonb_build_object(
        'requests', 'count(distinct request_id)',
        'days', 'coalesce(sum(day_value), 0)',
        'people', 'count(distinct user_id)'
      );
      v_dims := v_dims || jsonb_build_object(
        'leave_type', $q$case leave_type when 'annual' then 'Phép năm' when 'sick' then 'Nghỉ ốm' when 'unpaid' then 'Không lương' else 'Khác' end$q$,
        'status', $q$case status when 'approved' then 'Đã duyệt' when 'pending' then 'Chờ duyệt' when 'rejected' then 'Từ chối' else status end$q$
      );
      v_ctes := $q$
        base as (
          select p.user_id, p.person, p.unit, p.job, lr.id as request_id, lr.leave_type, lr.status, g::date as date,
            public.ts_day_weight(g::date) * case when lr.half_day then 0.5 else 1 end as day_value
          from public.leave_requests lr
          join ppl p on p.user_id = lr.user_id
          cross join lateral generate_series(greatest(lr.start_date, $1)::timestamp, least(lr.end_date, $2)::timestamp, interval '1 day') g
          where not lr.is_cancelled and lr.start_date <= $2 and lr.end_date >= $1
            and public.ts_day_weight(g::date) > 0
            and ($7 = 'all' or lr.status = $7)
            and (nullif($5->>'leave_type', '') is null or lr.leave_type = lower($5->>'leave_type'))
        )$q$;
      v_note := 'Số ngày tính theo ngày làm việc nằm trong khoảng hỏi, nghỉ nửa ngày = 0,5. Mặc định chỉ đơn đã duyệt.';
    else
      v_status := upper(coalesce(nullif(v_filters->>'status', ''), 'approved'));
      v_default_metric := 'requests';
      v_meas := jsonb_build_object(
        'requests', 'count(*)',
        'hours', 'coalesce(sum(hours), 0)',
        'minutes', 'coalesce(sum(minutes), 0)',
        'people', 'count(distinct user_id)'
      );
      v_dims := v_dims || jsonb_build_object(
        'request_type', $q$case request_type when 'LATE_ARRIVAL' then 'Xin đi muộn' when 'EARLY_LEAVE' then 'Xin về sớm' else 'Làm thêm giờ' end$q$,
        'status', $q$case status when 'APPROVED' then 'Đã duyệt' when 'PENDING' then 'Chờ duyệt' when 'REJECTED' then 'Từ chối' else 'Đã huỷ' end$q$
      );
      v_ctes := $q$
        base as (
          select p.user_id, p.person, p.unit, p.job, r.request_type, r.status, r.work_date as date, r.hours, r.minutes
          from public.attendance_requests r
          join ppl p on p.user_id = r.user_id
          where r.work_date between $1 and $2
            and ($7 = 'ALL' or r.status = $7)
            and (nullif($5->>'request_type', '') is null or r.request_type = upper($5->>'request_type'))
        )$q$;
      v_note := 'Đơn xin đi muộn / về sớm / làm thêm giờ theo ngày áp dụng. hours = giờ làm thêm, minutes = phút xin muộn/sớm. Mặc định chỉ đơn đã duyệt.';
    end if;

  elsif v_dataset = 'employees' then
    v_areas := array['users', 'reports'];
    v_default_metric := 'headcount';
    v_meas := jsonb_build_object(
      'headcount', 'count(*)',
      'avg_tenure_years', 'round(avg(($4 - hire_date) / 365.25)::numeric, 1)'
    );
    v_dims := v_dims || jsonb_build_object(
      'employment_status', $q$case employment_status when 'onboarding' then 'Đang tiếp nhận' when 'probation' then 'Thử việc'
        when 'active' then 'Chính thức' when 'suspended' then 'Tạm hoãn' else coalesce(employment_status, 'Chưa rõ') end$q$,
      'education_level', $q$case education_level when 'HIGH_SCHOOL' then 'THPT' when 'VOCATIONAL' then 'Trung cấp / nghề'
        when 'COLLEGE' then 'Cao đẳng' when 'UNIVERSITY' then 'Đại học' when 'POSTGRADUATE' then 'Sau đại học' else 'Khác / chưa khai' end$q$,
      'hire_date', $q$to_char(hire_date, 'YYYY-MM-DD')$q$,
      'hire_month', $q$to_char(hire_date, 'YYYY-MM')$q$,
      'hire_year', 'extract(year from hire_date)::int',
      'tenure_band', 'tenure_band'
    );
    v_ctes := $q$
      base as (
        select p.*,
          case when p.hire_date is null then 'Chưa có ngày vào làm'
            when $4 - p.hire_date < 365 then 'Dưới 1 năm'
            when $4 - p.hire_date < 3 * 365 then '1–3 năm'
            when $4 - p.hire_date < 5 * 365 then '3–5 năm'
            else 'Trên 5 năm' end as tenure_band
        from ppl p
        where ($1 is null or p.hire_date >= $1) and ($2 is null or p.hire_date <= $2)
          and (nullif($5->>'employment_status', '') is null or p.employment_status = lower($5->>'employment_status'))
      )$q$;
    v_note := 'Nhân sự đang làm việc. from/to (nếu có) lọc theo ngày vào làm.';

  elsif v_dataset = 'kpi' then
    v_full_kpi := public.can_function('admin.performance_manage') or public.can_function('admin.kpi_approve');
    v_from := coalesce(v_from, date_trunc('month', coalesce(v_to, v_today))::date);
    v_to := coalesce(v_to, (date_trunc('month', v_from) + interval '1 month - 1 day')::date);
    v_status := nullif(upper(coalesce(v_filters->>'status', '')), '');
    if v_status = 'ALL' then v_status := null; end if;
    v_default_metric := 'avg_final_pct';
    v_meas := jsonb_build_object(
      'sheets', 'count(*)',
      'avg_final_pct', 'round(avg(final_pct), 2)',
      'avg_manager_pct', 'round(avg(manager_pct), 2)',
      'avg_self_pct', 'round(avg(self_pct), 2)',
      'max_final_pct', 'max(final_pct)',
      'min_final_pct', 'min(final_pct)'
    );
    v_dims := v_dims || jsonb_build_object(
      'month', $q$to_char(period_month, 'YYYY-MM')$q$,
      'grade', $q$coalesce(grade, 'Chưa xếp loại')$q$,
      'status', $q$case status when 'DRAFT' then 'Chưa gửi tự chấm' when 'PENDING' then 'Chờ quản lý chấm'
        when 'REJECTED' then 'Bị trả lại' when 'BOARD' then 'Chờ BGĐ duyệt' else 'Đã duyệt' end$q$,
      'set_name', 'set_name'
    );
    v_ctes := $q$
      base as (
        select p.user_id, p.person, p.unit, p.job, s.period_month, s.status, s.grade, s.set_name,
          s.self_pct, s.manager_pct, s.final_pct
        from public.kpi_sheets s
        join ppl p on p.user_id = s.user_id
        where s.period_month between date_trunc('month', $1)::date and $2
          and ($6 or s.user_id = auth.uid() or s.reviewer_id = auth.uid())
          and ($7 is null or s.status = $7)
          and (nullif($5->>'grade', '') is null or upper(s.grade) = upper($5->>'grade'))
      )$q$;
    v_note := 'Phiếu KPI theo tháng. Điểm là %.';

  else
    return jsonb_build_object('error', 'Bộ dữ liệu không hợp lệ.',
      'allowed_datasets', jsonb_build_array('attendance', 'leave', 'requests', 'employees', 'kpi'));
  end if;

  if v_from is not null and v_to is not null then
    if v_from > v_to then
      return jsonb_build_object('error', 'Khoảng ngày không hợp lệ (ngày bắt đầu sau ngày kết thúc hoặc ở tương lai).');
    end if;
    if v_to - v_from > 366 then
      return jsonb_build_object('error', 'Chỉ tra được tối đa 1 năm một lần.');
    end if;
  end if;

  -- Chỉ số và chiều: bỏ trùng, giữ thứ tự, kiểm theo danh sách trắng.
  select coalesce(array_agg(x order by o), '{}') into v_metrics
  from (
    select x, min(o) as o
    from jsonb_array_elements_text(case when jsonb_typeof(p_spec->'metrics') = 'array' then p_spec->'metrics' else '[]' end)
      with ordinality t(x, o)
    group by x
  ) s;
  select coalesce(array_agg(x order by o), '{}') into v_group
  from (
    select x, min(o) as o
    from jsonb_array_elements_text(case when jsonb_typeof(p_spec->'group_by') = 'array' then p_spec->'group_by' else '[]' end)
      with ordinality t(x, o)
    group by x
  ) s;
  if cardinality(v_metrics) = 0 then v_metrics := array[v_default_metric]; end if;

  if cardinality(v_metrics) > 5 or exists (select 1 from unnest(v_metrics) m where not v_meas ? m) then
    return jsonb_build_object('error', 'Chỉ số không hợp lệ cho bộ dữ liệu này (tối đa 5).',
      'allowed_metrics', (select jsonb_agg(k) from jsonb_object_keys(v_meas) k));
  end if;
  if cardinality(v_group) > 3 or exists (select 1 from unnest(v_group) d where not v_dims ? d) then
    return jsonb_build_object('error', 'Cách nhóm không hợp lệ cho bộ dữ liệu này (tối đa 3).',
      'allowed_group_by', (select jsonb_agg(k) from jsonb_object_keys(v_dims) k));
  end if;
  if 'person' = any(v_group) and not 'unit' = any(v_group) then
    v_group := v_group || 'unit'::text;
  end if;

  -- Người được xem: theo quyền, rồi theo đơn vị / tên / vị trí.
  if v_dataset = 'kpi' then
    select coalesce(array_agg(p.id), '{}') into v_scope
    from public.profiles p
    where p.is_active and (v_full_kpi or p.id = auth.uid()
      or exists (select 1 from public.kpi_sheets s where s.user_id = p.id and s.reviewer_id = auth.uid()));
    v_coverage := case when v_full_kpi then 'Toàn công ty' else 'Phiếu của bạn và phiếu bạn được giao chấm' end;
  else
    v_scope := public.chatbot_scope_users(v_areas);
    v_coverage := public.chatbot_coverage(v_areas, v_scope);
  end if;

  if v_unit is not null then
    v_units := public.chatbot_unit_scope(v_unit);
    if cardinality(v_units) = 0 then return public.chatbot_unit_not_found(v_unit); end if;
  end if;

  select coalesce(array_agg(p.id), '{}') into v_users
  from public.profiles p
  left join public.job_positions jp on jp.id = p.position_id
  where p.id = any(v_scope)
    and (v_units is null or p.unit_id = any(v_units))
    and (v_person is null
      or public.chatbot_fold(p.name) like '%' || public.chatbot_fold(v_person) || '%'
      or lower(p.employee_code) = lower(v_person))
    and (nullif(v_filters->>'position', '') is null
      or public.chatbot_fold(jp.title) like '%' || public.chatbot_fold(v_filters->>'position') || '%');

  if cardinality(v_users) = 0 and v_person is not null then
    if exists (select 1 from public.chatbot_people(null, v_person)) then
      return jsonb_build_object('error', case when cardinality(v_scope) <= 1
        then 'Bạn chỉ xem được số liệu của chính mình.'
        else 'Người này không thuộc phạm vi bạn được xem.' end);
    end if;
    return jsonb_build_object('error', 'Không tìm thấy nhân viên này trong số người đang làm việc.');
  end if;

  if v_dataset = 'attendance' and cardinality(v_users)::bigint * (v_to - v_from + 1) > 300000 then
    return jsonb_build_object('error', 'Khoảng tra quá lớn, hãy thu hẹp số ngày hoặc lọc theo đơn vị.');
  end if;

  -- Dựng câu truy vấn từ các mảnh cố định.
  select coalesce(string_agg(format('%s as %I', v_dims->>d, d), ', ' order by o), ''),
         coalesce(string_agg(v_dims->>d, ', ' order by o), '')
    into v_sel, v_grp
  from unnest(v_group) with ordinality t(d, o);
  if 'person' = any(v_group) then
    v_sel := v_sel || ', user_id';
    v_grp := v_grp || ', user_id';
  end if;
  if 'weekday' = any(v_group) then
    v_sel := v_sel || ', min(extract(isodow from date))::int as _wd';
  end if;
  select string_agg(format('%s as %I', v_meas->>m, m), ', ' order by o) into v_msel
  from unnest(v_metrics) with ordinality t(m, o);

  if v_min is not null and cardinality(v_group) > 0 and not v_metrics[1] = any(v_text_meas) then
    v_having := format('having (%s) >= $8', v_meas->>v_metrics[1]);
  end if;

  select d into v_first_time from unnest(v_group) with ordinality t(d, o) where d = any(v_time_dims) order by o limit 1;
  if v_sort is not null and (v_sort = any(v_metrics) or v_sort = any(v_group)) then
    v_order := case when v_sort = 'weekday' then '_wd' else format('%I', v_sort) end
      || case when v_asc then ' asc' else ' desc' end || ' nulls last';
  elsif v_first_time is not null then
    v_order := case when v_first_time = 'weekday' then '_wd' else format('%I', v_first_time) end || ' asc';
  else
    v_order := format('%I', v_metrics[1]) || case when v_asc then ' asc' else ' desc' end || ' nulls last';
  end if;
  v_order := v_order || format(', %I desc nulls last', v_metrics[1]);

  v_ppl := $q$
    ppl as (
      select p.id as user_id, p.name as person, coalesce(u.name, 'Chưa gán đơn vị') as unit,
        coalesce(jp.title, 'Chưa gán vị trí') as job, p.hire_date, p.employment_status, p.education_level
      from public.profiles p
      left join public.organization_units u on u.id = p.unit_id
      left join public.job_positions jp on jp.id = p.position_id
      where p.id = any($3)
    )$q$;

  execute 'with ' || v_ppl || ',' || v_ctes || ',
    g as (select ' || concat_ws(', ', nullif(v_sel, ''), v_msel) || ' from base '
      || case when v_grp <> '' then 'group by ' || v_grp else '' end || ' ' || v_having || '),
    r as (select g.*, row_number() over (order by ' || v_order || ') as _rn from g)
    select jsonb_build_object(
      ''total_groups'', (select count(*) from g),
      ''rows'', coalesce((
        select jsonb_agg(to_jsonb(r) - ''user_id'' - ''_wd'' - ''_rn'' order by r._rn) from r where r._rn <= $9
      ), ''[]''::jsonb)
    )'
    into v_out
    using v_from, v_to, v_users, v_today, v_filters, v_full_kpi, v_status, v_min, v_limit;

  if cardinality(v_group) > 0 then
    execute 'with ' || v_ppl || ',' || v_ctes || '
      select to_jsonb(t) from (select ' || v_msel || ' from base) t'
      into v_totals
      using v_from, v_to, v_users, v_today, v_filters, v_full_kpi, v_status, v_min, v_limit;
  end if;

  return jsonb_build_object(
    'dataset', v_dataset,
    'from', v_from,
    'to', v_to,
    'coverage', v_coverage,
    'unit_filter', v_unit,
    'status_filter', v_status,
    'group_by', to_jsonb(v_group),
    'metrics', to_jsonb(v_metrics),
    'rows', v_out->'rows',
    'total_groups', v_out->'total_groups',
    'shown', least((v_out->>'total_groups')::int, v_limit),
    'totals', v_totals,
    'note', v_note
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 10. Quy chế công ty: giờ làm, quy tắc phạt, cộng văn bản do admin soạn
-- ---------------------------------------------------------------------------
-- Văn bản ở đây được gửi cho AI để trả lời câu hỏi về quy chế, nên chỉ chứa
-- nội dung công khai trong công ty (nội quy, quy trình, chính sách).
create table if not exists public.chatbot_knowledge (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) between 2 and 200),
  content text not null check (length(trim(content)) between 1 and 6000),
  is_active boolean not null default true,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.chatbot_knowledge enable row level security;
drop policy if exists chatbot_knowledge_select on public.chatbot_knowledge;
create policy chatbot_knowledge_select on public.chatbot_knowledge
  for select to authenticated using (is_active or public.can('settings'));
drop policy if exists chatbot_knowledge_insert on public.chatbot_knowledge;
create policy chatbot_knowledge_insert on public.chatbot_knowledge
  for insert to authenticated with check (public.can('settings'));
drop policy if exists chatbot_knowledge_update on public.chatbot_knowledge;
create policy chatbot_knowledge_update on public.chatbot_knowledge
  for update to authenticated using (public.can('settings')) with check (public.can('settings'));
drop policy if exists chatbot_knowledge_delete on public.chatbot_knowledge;
create policy chatbot_knowledge_delete on public.chatbot_knowledge
  for delete to authenticated using (public.can('settings'));
revoke all on public.chatbot_knowledge from anon;
grant select, insert, update, delete on public.chatbot_knowledge to authenticated;

create or replace function public.chatbot_knowledge_touch()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

drop trigger if exists chatbot_knowledge_touch on public.chatbot_knowledge;
create trigger chatbot_knowledge_touch
before insert or update on public.chatbot_knowledge
for each row execute function public.chatbot_knowledge_touch();

create or replace function public.chatbot_company_policy(p_topic text default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_today date := public.chatbot_today();
  v_words text[];
  v_sched public.work_schedules%rowtype;
  v_rules public.timesheet_payroll_rules%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Chưa đăng nhập.' using errcode = '42501';
  end if;
  v_words := array(
    select w from unnest(regexp_split_to_array(public.chatbot_fold(p_topic), '\s+')) w where length(w) >= 2
  );
  select * into v_sched from public.work_schedules s
  where s.is_active and s.effective_from <= v_today and (s.effective_to is null or s.effective_to >= v_today)
  order by s.effective_from desc limit 1;
  select * into v_rules from public.timesheet_payroll_rules limit 1;

  return jsonb_build_object(
    'work_schedule', case when v_sched.id is not null then jsonb_build_object(
      'name', v_sched.name,
      'start', to_char(v_sched.start_time, 'HH24:MI'),
      'end', to_char(v_sched.end_time, 'HH24:MI'),
      'lunch_break_minutes', v_sched.break_minutes,
      'grace_minutes_before_late', v_sched.grace_minutes,
      'saturday', case v_sched.saturday_mode when 'OFF' then 'Nghỉ' when 'HALF' then 'Làm nửa ngày' else 'Làm cả ngày' end,
      'effective', format('Từ %s%s', to_char(v_sched.effective_from, 'DD/MM/YYYY'),
        case when v_sched.effective_to is not null then ' đến ' || to_char(v_sched.effective_to, 'DD/MM/YYYY') else '' end)
    ) end,
    'late_penalty', case when v_rules.id is not null then jsonb_build_object(
      'tiers', (
        select jsonb_agg(format('Từ %s lần đi muộn trong tháng: trừ %s ngày công', t->>'from', t->>'days')
          order by (t->>'from')::int)
        from jsonb_array_elements(v_rules.late_tiers) t
      ),
      'how', 'Áp mức cao nhất đạt được trong tháng'
        || case when v_rules.deduct_leave_first then ', trừ vào phép năm trước nếu còn phép.' else '.' end
    ) end,
    'night_work', case when v_rules.id is not null then
      format('Ra về sau %s được tính một ngày làm đêm%s.', to_char(v_rules.night_cutoff, 'HH24:MI'),
        case when v_rules.night_requires_ot then ' nếu ngày đó có đơn làm thêm giờ' else '' end) end,
    'documents', coalesce((
      select jsonb_agg(jsonb_build_object('title', k.title, 'content', left(k.content, 3000)) order by k.score desc, k.title)
      from (
        select kn.title, kn.content,
          (select coalesce(sum((public.chatbot_fold(kn.title) like '%' || w || '%')::int * 3
                             + (public.chatbot_fold(kn.content) like '%' || w || '%')::int), 0)
           from unnest(v_words) w) as score
        from public.chatbot_knowledge kn
        where kn.is_active
        order by score desc, kn.updated_at desc
        limit 6
      ) k
    ), '[]'::jsonb),
    'note', 'documents là văn bản quy chế do công ty soạn; chỉ trả lời theo đúng nội dung có ở đây.'
  );
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'chatbot_attendance_day(date, text)',
    'chatbot_late_summary(date, date, text, text)',
    'chatbot_month_summary(date, text)',
    'chatbot_leave_balance(text, integer)',
    'chatbot_pending_items()',
    'chatbot_kpi(date, text)',
    'chatbot_holidays(date, date)',
    'chatbot_headcount(text)',
    'chatbot_query(jsonb)',
    'chatbot_company_policy(text)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 11. Nhật ký câu hỏi: giới hạn tần suất và tìm câu hỏi chưa trả lời được
-- ---------------------------------------------------------------------------
-- Chỉ lưu câu hỏi và tên hàm đã gọi — KHÔNG lưu câu trả lời hay số liệu.
create table if not exists public.chatbot_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  question text not null check (length(question) between 1 and 1000),
  tools text[] not null default '{}',
  answered boolean,
  error text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists chatbot_logs_created_idx on public.chatbot_logs(created_at desc);
create index if not exists chatbot_logs_user_idx on public.chatbot_logs(user_id, created_at desc);

alter table public.chatbot_logs enable row level security;
drop policy if exists chatbot_logs_select on public.chatbot_logs;
create policy chatbot_logs_select on public.chatbot_logs
  for select to authenticated
  using (user_id = auth.uid() or public.can('settings'));
-- Không có policy ghi: chỉ hai hàm dưới đây được ghi.

create or replace function public.chatbot_log_begin(p_question text)
returns uuid
language plpgsql volatile security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Chưa đăng nhập.' using errcode = '42501';
  end if;
  if (select count(*) from public.chatbot_logs
      where user_id = auth.uid() and created_at > now() - interval '1 minute') >= 12
     or (select count(*) from public.chatbot_logs
      where user_id = auth.uid() and created_at > now() - interval '1 day') >= 300 then
    raise exception 'Bạn hỏi hơi nhanh, đợi một lát rồi hỏi tiếp nhé.' using errcode = 'P0429';
  end if;

  insert into public.chatbot_logs (user_id, question)
  values (auth.uid(), left(trim(p_question), 1000))
  returning id into v_id;

  -- Dọn nhật ký cũ thỉnh thoảng, không cần lịch chạy riêng.
  if random() < 0.02 then
    delete from public.chatbot_logs where created_at < now() - interval '180 days';
  end if;
  return v_id;
end;
$$;

create or replace function public.chatbot_log_finish(p_id uuid, p_tools text[], p_answered boolean, p_error text default null)
returns void
language sql volatile security definer set search_path = public as $$
  update public.chatbot_logs
  set tools = coalesce(p_tools, '{}'), answered = p_answered, error = left(p_error, 500), finished_at = now()
  where id = p_id and user_id = auth.uid();
$$;

-- Màn quản trị: câu hỏi gần đây kèm tên người hỏi.
create or replace function public.chatbot_recent_logs(p_only_unanswered boolean default false, p_limit integer default 200)
returns table (id uuid, created_at timestamptz, person text, question text, tools text[], answered boolean, error text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.can('settings') then
    raise exception 'Bạn không có quyền xem nhật ký trợ lý.' using errcode = '42501';
  end if;
  return query
  select l.id, l.created_at, p.name, l.question, l.tools, l.answered, l.error
  from public.chatbot_logs l
  left join public.profiles p on p.id = l.user_id
  where not p_only_unanswered or l.answered is distinct from true
  order by l.created_at desc
  limit least(greatest(coalesce(p_limit, 200), 1), 500);
end;
$$;

revoke all on function public.chatbot_log_begin(text) from public, anon;
revoke all on function public.chatbot_log_finish(uuid, text[], boolean, text) from public, anon;
revoke all on function public.chatbot_recent_logs(boolean, integer) from public, anon;
grant execute on function public.chatbot_log_begin(text) to authenticated;
grant execute on function public.chatbot_log_finish(uuid, text[], boolean, text) to authenticated;
grant execute on function public.chatbot_recent_logs(boolean, integer) to authenticated;

notify pgrst, 'reload schema';
