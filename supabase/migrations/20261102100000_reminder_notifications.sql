-- ============================================================================
-- Thông báo nhắc nhở tự động cho toàn bộ tính năng.
-- ----------------------------------------------------------------------------
-- Các thông báo cũ chỉ nổ ra khi MỘT NGƯỜI thao tác (gửi đơn, duyệt, giao việc).
-- Nhắc nhở thì ngược lại: không ai bấm gì cả, hệ thống phải tự nhìn vào dữ liệu
-- rồi báo "sắp tới hạn", "đang chờ bạn", "bạn quên chấm công".
--
-- Cách làm:
--   1. `reminder_rules`: một dòng cho mỗi loại nhắc, có công tắc bật/tắt và một
--      tham số (số phút / số ngày báo trước) để quản trị tự chỉnh.
--   2. Mỗi loại nhắc là một hàm `reminder_*` chỉ ĐỌC dữ liệu nghiệp vụ và GHI
--      `notifications`. Hàm trả về số thông báo mới tạo.
--   3. `generate_reminders()` chạy lần lượt các hàm đó, mỗi hàm bọc trong
--      exception riêng — một bảng thiếu/đổi cột không làm hỏng loại nhắc khác.
--   4. `notifications.dedupe_key` + chỉ mục duy nhất đảm bảo gọi hàm 100 lần
--      trong ngày vẫn chỉ ra đúng một thông báo cho mỗi việc cần nhắc.
--
-- Lịch chạy nằm ngoài DB (API /api/reminders gọi hàm này mỗi vài phút rồi đẩy
-- Web Push), vì push cần khoá VAPID mà DB không có.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Chống trùng trên bảng thông báo
-- ---------------------------------------------------------------------------
alter table public.notifications
  add column if not exists dedupe_key text;

create unique index if not exists notifications_dedupe_unique
  on public.notifications(user_id, dedupe_key)
  where dedupe_key is not null;

create index if not exists notifications_push_pending_idx
  on public.notifications(created_at)
  where push_sent_at is null and dedupe_key is not null;

-- ---------------------------------------------------------------------------
-- 2. Danh mục quy tắc nhắc nhở
-- ---------------------------------------------------------------------------
create table if not exists public.reminder_rules (
  code text primary key,
  group_name text not null,
  label text not null,
  description text not null,
  audience text not null,
  enabled boolean not null default true,
  /* Ý nghĩa tuỳ quy tắc: phút hoặc ngày báo trước. Xem `param_unit`. */
  param integer,
  param_unit text check (param_unit is null or param_unit in ('phút', 'ngày', 'giờ')),
  param_label text,
  sort_order integer not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.reminder_rules enable row level security;

drop policy if exists reminder_rules_read on public.reminder_rules;
create policy reminder_rules_read on public.reminder_rules
for select to authenticated using (true);

drop policy if exists reminder_rules_update on public.reminder_rules;
create policy reminder_rules_update on public.reminder_rules
for update to authenticated
using (public.can('settings')) with check (public.can('settings'));

revoke all on public.reminder_rules from anon, authenticated;
grant select on public.reminder_rules to authenticated;
-- Quản trị chỉ được đổi công tắc và tham số, không đổi nội dung quy tắc.
grant update (enabled, param, updated_at) on public.reminder_rules to authenticated;

insert into public.reminder_rules
  (code, group_name, label, description, audience, enabled, param, param_unit, param_label, sort_order)
values
  -- Chấm công
  ('att_checkin', 'Chấm công', 'Nhắc chấm công vào',
   'Trước giờ vào ca, nhắc người chưa có dữ liệu chấm công ngày hôm nay.',
   'Nhân viên đến ca, không nghỉ phép cả ngày', true, 10, 'phút', 'Nhắc trước giờ vào ca', 10),
  ('att_checkin_late', 'Chấm công', 'Nhắc đã quá giờ mà chưa chấm công',
   'Sau giờ vào ca một lúc vẫn chưa có dữ liệu: nhắc gửi đơn bổ sung hoặc báo quản lý.',
   'Nhân viên đến ca, không nghỉ phép cả ngày', true, 15, 'phút', 'Nhắc sau giờ vào ca', 11),
  ('att_checkout', 'Chấm công', 'Nhắc chấm công ra',
   'Hết giờ làm mà vẫn đang ở trạng thái đã vào, chưa ra.',
   'Nhân viên đang trong ca', true, 0, 'phút', 'Nhắc sau giờ tan ca', 12),
  ('att_missing_checkout', 'Chấm công', 'Nhắc quên chấm công ra các ngày trước',
   'Có ngày trong 7 ngày gần đây chỉ có giờ vào, không có giờ ra.',
   'Nhân viên', true, 7, 'ngày', 'Xét lại trong', 13),
  ('att_approval', 'Chấm công', 'Nhắc duyệt chấm công',
   'Lượt chấm công của các ngày trước còn chờ xác nhận.',
   'Quản lý trực tiếp, trưởng dự án, người có quyền Chấm công', true, null, null, null, 14),
  ('att_request_pending', 'Chấm công', 'Nhắc duyệt đơn đi muộn / về sớm / làm thêm',
   'Đơn xin đi muộn, về sớm, làm thêm giờ đang chờ duyệt.',
   'Quản lý trực tiếp, trưởng dự án, người có quyền Chấm công', true, null, null, null, 15),
  -- Nghỉ phép
  ('leave_pending_manager', 'Nghỉ phép', 'Nhắc duyệt nghỉ phép (quản lý)',
   'Đơn nghỉ phép đang chờ quản lý duyệt bước đầu.',
   'Quản lý trực tiếp, người có quyền Nghỉ phép', true, null, null, null, 20),
  ('leave_pending_hr', 'Nghỉ phép', 'Nhắc duyệt nghỉ phép (Nhân sự)',
   'Đơn nghỉ phép đã qua quản lý, đang chờ Nhân sự chốt.',
   'Người có quyền Quản lý User', true, null, null, null, 21),
  ('leave_upcoming', 'Nghỉ phép', 'Nhắc lịch nghỉ phép sắp tới',
   'Đơn nghỉ đã duyệt, ngày mai bắt đầu nghỉ: nhớ bàn giao công việc.',
   'Người xin nghỉ', true, null, null, null, 22),
  -- Giao việc & dự án
  ('assign_today', 'Công việc & dự án', 'Nhắc việc được giao trong ngày',
   'Sáng và chiều nhắc những việc giao hằng ngày chưa nộp (gồm cả việc quá hạn).',
   'Người được giao việc', true, null, null, null, 30),
  ('assign_review', 'Công việc & dự án', 'Nhắc duyệt việc đã nộp',
   'Việc giao hằng ngày đã nộp quá lâu mà chưa được duyệt.',
   'Người giao việc', true, 24, 'giờ', 'Nhắc sau khi nộp', 31),
  ('task_due', 'Công việc & dự án', 'Nhắc hạn tác vụ dự án',
   'Tác vụ đến hạn ngày mai, hôm nay, và tổng hợp các tác vụ đã quá hạn.',
   'Người được giao tác vụ', true, null, null, null, 32),
  ('task_review', 'Công việc & dự án', 'Nhắc duyệt tác vụ',
   'Tác vụ đang ở cột chờ duyệt.',
   'Trưởng dự án', true, 4, 'giờ', 'Nhắc sau khi chuyển chờ duyệt', 33),
  ('task_request_pending', 'Công việc & dự án', 'Nhắc duyệt đề nghị gia hạn / hoàn thành tác vụ',
   'Đề nghị gia hạn hạn chót hoặc xác nhận hoàn thành đang chờ.',
   'Trưởng dự án', true, null, null, null, 34),
  ('worklog_submit', 'Công việc & dự án', 'Nhắc gửi nhật ký giờ tuần',
   'Chiều thứ Sáu nhắc người còn tác vụ chưa gửi nhật ký giờ tuần cho dự án.',
   'Thành viên dự án', true, null, null, null, 35),
  ('worklog_review', 'Công việc & dự án', 'Nhắc duyệt nhật ký giờ tuần',
   'Nhật ký giờ tuần đã gửi, chờ trưởng dự án duyệt.',
   'Trưởng dự án', true, null, null, null, 36),
  ('project_event', 'Công việc & dự án', 'Nhắc lịch họp / nhắc nhở dự án',
   'Nhắc trước 1 ngày và trước khoảng 1 giờ khi cuộc họp / mốc nhắc của dự án sắp diễn ra.',
   'Thành viên dự án', true, null, null, null, 37),
  -- KPI
  ('kpi_open', 'KPI', 'Nhắc mở kỳ KPI và thông báo kỳ đã mở',
   'Đến ngày mở kỳ mà chưa mở: nhắc quản trị KPI. Kỳ đã mở: báo nhân viên bắt đầu tự chấm.',
   'Quản trị KPI; nhân viên có phiếu', true, null, null, null, 40),
  ('kpi_self', 'KPI', 'Nhắc tự chấm KPI',
   'Phiếu chưa nộp hoặc bị trả lại, nhắc mỗi ngày từ khi gần đến hạn.',
   'Nhân viên có phiếu KPI', true, 3, 'ngày', 'Bắt đầu nhắc trước hạn', 41),
  ('kpi_manager', 'KPI', 'Nhắc quản lý chấm KPI',
   'Phiếu đã nộp, đang chờ quản lý trực tiếp chấm.',
   'Quản lý được giao chấm', true, 3, 'ngày', 'Bắt đầu nhắc trước hạn', 42),
  ('kpi_board', 'KPI', 'Nhắc Ban Giám đốc duyệt KPI',
   'Phiếu đang chờ Ban Giám đốc duyệt cuối.',
   'Người có quyền Duyệt KPI', true, 3, 'ngày', 'Bắt đầu nhắc trước hạn', 43),
  ('kpi_lock', 'KPI', 'Nhắc khoá sổ kỳ KPI',
   'Gần đến hoặc đã qua hạn khoá sổ mà kỳ vẫn đang mở.',
   'Người có quyền Khoá sổ KPI', true, 3, 'ngày', 'Bắt đầu nhắc trước hạn', 44),
  ('kpi_reopen', 'KPI', 'Nhắc duyệt đề nghị mở lại phiếu KPI',
   'Đề nghị mở lại phiếu đã khoá đang chờ duyệt.',
   'Người có quyền Duyệt KPI', true, null, null, null, 45),
  ('kpi_sales_target', 'KPI', 'Nhắc duyệt chỉ tiêu kinh doanh',
   'Chỉ tiêu doanh số / thu tiền đã trình, chờ duyệt.',
   'Người có quyền Duyệt KPI', true, null, null, null, 46),
  -- Lương
  ('payroll_timesheet', 'Lương', 'Nhắc khoá kỳ bảng công',
   'Tháng trước đã kết thúc nhưng kỳ bảng công chưa khoá.',
   'Người có quyền Khoá/mở kỳ bảng công', true, null, null, null, 50),
  ('payroll_run', 'Lương', 'Nhắc các bước của kỳ lương',
   'Chưa tính/khoá lương, chờ duyệt chi, chờ chi trả, hoặc chưa công bố phiếu lương của tháng trước.',
   'Kế toán lương, người duyệt lương', true, null, null, null, 51),
  ('payroll_scheme_pending', 'Lương', 'Nhắc duyệt thay đổi cơ chế lương',
   'Đề xuất đổi cơ chế lương đã trình, chờ ký duyệt.',
   'Người có quyền Phê duyệt lương', true, null, null, null, 52),
  -- Đào tạo, hội nhập, tuyển dụng, hồ sơ
  ('training_deadline', 'Đào tạo & hội nhập', 'Nhắc hạn khoá đào tạo',
   'Khoá học chưa hoàn thành: nhắc trước 3 ngày, 1 ngày, đúng hạn; quá hạn nhắc mỗi tuần.',
   'Người được ghi danh', true, null, null, null, 60),
  ('lifecycle_task', 'Đào tạo & hội nhập', 'Nhắc việc trong checklist hội nhập / nghỉ việc',
   'Đầu việc checklist đến hạn ngày mai, hôm nay hoặc đã quá hạn.',
   'Người phụ trách đầu việc', true, null, null, null, 61),
  ('recruit_sla', 'Tuyển dụng', 'Nhắc phản hồi đề xuất tuyển dụng',
   'Đề xuất tuyển dụng sắp hoặc đã quá hạn phản hồi trong 24 giờ.',
   'Ban Giám đốc, Nhân sự', true, 4, 'giờ', 'Nhắc khi còn dưới', 70),
  ('recruit_interview', 'Tuyển dụng', 'Nhắc lịch phỏng vấn',
   'Nhắc người phỏng vấn trước 1 ngày và trước khoảng 1 giờ.',
   'Người phỏng vấn', true, null, null, null, 71),
  ('recruit_offer', 'Tuyển dụng', 'Nhắc offer chưa có phản hồi',
   'Thư mời đã gửi quá 3 ngày mà ứng viên chưa trả lời.',
   'Người tạo offer', true, 3, 'ngày', 'Nhắc sau khi gửi', 72),
  ('document_expiry', 'Hồ sơ', 'Nhắc giấy tờ sắp hết hạn',
   'Hợp đồng, chứng chỉ, hộ chiếu, visa... của nhân sự và lao động sắp hết hạn (30, 7 ngày và đúng ngày).',
   'Nhân sự; người sở hữu giấy tờ', true, null, null, null, 80)
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- 3. Hàm dùng chung
-- ---------------------------------------------------------------------------
create or replace function public.reminder_today() returns date
language sql stable as $$ select (now() at time zone 'Asia/Ho_Chi_Minh')::date $$;

create or replace function public.reminder_time() returns time
language sql stable as $$ select (now() at time zone 'Asia/Ho_Chi_Minh')::time $$;

/* Đúng khung giờ làm việc để gửi tổng hợp: không réo người ta lúc nửa đêm. */
create or replace function public.reminder_in_hours(p_from integer, p_to integer) returns boolean
language sql stable as $$
  select extract(hour from (now() at time zone 'Asia/Ho_Chi_Minh')) >= p_from
     and extract(hour from (now() at time zone 'Asia/Ho_Chi_Minh')) < p_to
$$;

create or replace function public.reminder_enabled(p_code text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select r.enabled from public.reminder_rules r where r.code = p_code), false)
$$;

create or replace function public.reminder_param(p_code text, p_default integer) returns integer
language sql stable security definer set search_path = public as $$
  select coalesce((select r.param from public.reminder_rules r where r.code = p_code), p_default)
$$;

/* Nhân sự đang làm việc. Không lộ ra API: chỉ hàm SECURITY DEFINER dùng. */
create or replace view public.reminder_staff as
select p.id, p.name, p.role, p.manager_id, p.hire_date
from public.profiles p
where p.is_active and coalesce(p.employment_status, 'active') = 'active';

revoke all on public.reminder_staff from public, anon, authenticated;

/* Người dùng có chức năng (mã `admin.*`) — sao đúng logic `can_function` nhưng
   theo id, vì job nền không có `auth.uid()`. */
create or replace function public.reminder_users_with_function(p_function text)
returns table (user_id uuid)
language sql stable security definer set search_path = public as $$
  select p.id
  from public.profiles p
  where p.is_active
    and (
      p.role in ('admin', 'ceo')
      or exists (
        select 1
        from public.system_access_role_functions rf
        join public.system_access_roles ar on ar.code = rf.access_role_code and ar.is_active
        where rf.access_role_code = p.access_role_code and rf.function_code = p_function
      )
      or exists (
        select 1 from public.job_position_function_permissions pf
        where pf.position_id = p.position_id and pf.function_code = p_function
      )
      or exists (
        select 1 from public.profile_function_permissions uf
        where uf.user_id = p.id and uf.function_code = p_function
      )
    )
$$;

/* Người có quyền module (users/attendance/leave/projects...). Trưởng nhóm có
   quyền theo vai trò nhưng chỉ duyệt phạm vi của mình, nên KHÔNG tính ở đây —
   họ được gọi qua `reminder_reviewers_of` (quản lý trực tiếp / trưởng dự án). */
create or replace function public.reminder_users_with_permission(p_permission text)
returns table (user_id uuid)
language sql stable security definer set search_path = public as $$
  select p.id
  from public.profiles p
  where p.is_active
    and p.role <> 'teamlead'
    and (
      p.role in ('admin', 'ceo')
      or p_permission = any(coalesce(p.permissions, '{}'))
      or exists (
        select 1 from public.system_access_roles ar
        where ar.code = p.access_role_code and ar.is_active
          and p_permission = any(coalesce(ar.permissions, '{}'))
      )
      or exists (
        select 1 from public.job_position_permissions jpp
        where jpp.position_id = p.position_id and jpp.permission_code = p_permission
      )
    )
$$;

/* Những người được quyền duyệt hồ sơ của một nhân viên. */
create or replace function public.reminder_reviewers_of(p_user uuid, p_permission text)
returns table (user_id uuid)
language sql stable security definer set search_path = public as $$
  select x.user_id from (
    select pr.manager_id as user_id from public.profiles pr
      where pr.id = p_user and pr.manager_id is not null
    union
    select prj.lead_id
      from public.project_members pm
      join public.projects prj on prj.id = pm.project_id
      where pm.user_id = p_user and prj.lead_id is not null and prj.status <> 'archived'
    union
    select u.user_id from public.reminder_users_with_permission(p_permission) u
  ) x
  join public.profiles rv on rv.id = x.user_id and rv.is_active
  where x.user_id <> p_user
$$;

/* Lịch ngày làm việc: giờ vào, giờ ra thực tế (thứ Bảy nửa ngày thì ra sớm),
   và ngày đó có phải ngày đi làm không. Mặc định 08:00–17:30 như ca hành chính. */
create or replace function public.reminder_schedule(p_date date)
returns table (is_workday boolean, start_time time, end_time time, grace integer)
language plpgsql stable security definer set search_path = public as $$
declare
  s record;
  v_start time := '08:00';
  v_end time := '17:30';
  v_break integer := 90;
  v_sat text := 'HALF';
  v_grace integer := 0;
  v_dow integer := extract(isodow from p_date);
  v_work boolean := true;
begin
  select * into s
  from public.work_schedules w
  where w.is_active and w.effective_from <= p_date
    and (w.effective_to is null or w.effective_to >= p_date)
  order by w.effective_from desc limit 1;
  if found then
    v_start := s.start_time; v_end := s.end_time; v_break := s.break_minutes;
    v_sat := s.saturday_mode; v_grace := s.grace_minutes;
  end if;

  if v_dow = 7 then v_work := false;
  elsif v_dow = 6 then
    if v_sat = 'OFF' then v_work := false;
    elsif v_sat = 'HALF' then
      v_end := v_start + make_interval(mins => greatest(((extract(epoch from (v_end - v_start)) / 60)::integer - v_break) / 2, 60));
    end if;
  end if;

  if exists (select 1 from public.company_holidays h where h.holiday_date = p_date and h.is_active) then
    v_work := false;
  end if;

  return query select v_work, v_start, v_end, v_grace;
end;
$$;

/* Chuẩn bị bảng tạm chứa cặp (người nhận, đối tượng) cho thông báo tổng hợp. */
create or replace function public.reminder_pairs_reset() returns void
language plpgsql as $$
begin
  create temp table if not exists reminder_pairs (user_id uuid, item_id uuid) on commit delete rows;
  delete from reminder_pairs;
end;
$$;

/* Gom `reminder_pairs` thành một thông báo cho mỗi người: "{n}" trong nội dung
   được thay bằng số đối tượng. Khoá theo ngày nên mỗi ngày nhắc một lần. */
create or replace function public.reminder_flush_digest(
  p_type text, p_title text, p_message text, p_key text
) returns integer
language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  insert into public.notifications (user_id, type, title, message, dedupe_key)
  select g.user_id, p_type, p_title, replace(p_message, '{n}', g.n::text),
         p_key || ':' || public.reminder_today()::text
  from (
    select rp.user_id, count(distinct rp.item_id) as n
    from reminder_pairs rp
    join public.reminder_staff s on s.id = rp.user_id
    group by rp.user_id
  ) g
  on conflict (user_id, dedupe_key) where dedupe_key is not null do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

/* Ngày làm việc + khung giờ hành chính: điều kiện chung cho thông báo tổng hợp. */
create or replace function public.reminder_digest_window() returns boolean
language sql stable security definer set search_path = public as $$
  select public.reminder_in_hours(8, 18)
     and extract(isodow from public.reminder_today()) <> 7
     and not exists (
       select 1 from public.company_holidays h
       where h.holiday_date = public.reminder_today() and h.is_active
     )
$$;

-- ---------------------------------------------------------------------------
-- 4. Chấm công
-- ---------------------------------------------------------------------------
create or replace function public.reminder_att_checkin() returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_today date := public.reminder_today();
  v_now time := public.reminder_time();
  sc record;
  v_lead integer := public.reminder_param('att_checkin', 10);
  v_n integer;
begin
  if not public.reminder_enabled('att_checkin') then return 0; end if;
  select * into sc from public.reminder_schedule(v_today);
  if not sc.is_workday then return 0; end if;
  if v_now < sc.start_time - make_interval(mins => v_lead) or v_now > sc.start_time + interval '40 minutes' then
    return 0;
  end if;

  insert into public.notifications (user_id, type, title, message, dedupe_key)
  select s.id, 'reminder_att_checkin', 'Sắp đến giờ vào ca',
         'Ca làm bắt đầu lúc ' || to_char(sc.start_time, 'HH24:MI') || '. Nhớ chấm công vào khi đến nơi.',
         'att_checkin:' || v_today::text
  from public.reminder_staff s
  where coalesce(s.hire_date, v_today) <= v_today
    and not exists (select 1 from public.attendance a where a.user_id = s.id and a.date = v_today)
    and not exists (
      select 1 from public.leave_requests lr
      where lr.user_id = s.id and lr.status = 'approved' and not lr.half_day
        and v_today between lr.start_date and lr.end_date
    )
  on conflict (user_id, dedupe_key) where dedupe_key is not null do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

create or replace function public.reminder_att_checkin_late() returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_today date := public.reminder_today();
  v_now time := public.reminder_time();
  sc record;
  v_after integer := public.reminder_param('att_checkin_late', 15);
  v_n integer;
begin
  if not public.reminder_enabled('att_checkin_late') then return 0; end if;
  select * into sc from public.reminder_schedule(v_today);
  if not sc.is_workday then return 0; end if;
  if v_now < sc.start_time + make_interval(mins => sc.grace + v_after)
     or v_now > sc.start_time + interval '4 hours' then
    return 0;
  end if;

  insert into public.notifications (user_id, type, title, message, dedupe_key)
  select s.id, 'reminder_att_checkin_late', 'Bạn chưa chấm công vào hôm nay',
         'Đã quá giờ vào ca ' || to_char(sc.start_time, 'HH24:MI')
           || ' nhưng chưa có dữ liệu chấm công. Nếu quên, hãy gửi đơn bổ sung hoặc báo quản lý.',
         'att_checkin_late:' || v_today::text
  from public.reminder_staff s
  where coalesce(s.hire_date, v_today) <= v_today
    and not exists (select 1 from public.attendance a where a.user_id = s.id and a.date = v_today)
    and not exists (
      select 1 from public.leave_requests lr
      where lr.user_id = s.id and lr.status = 'approved' and not lr.half_day
        and v_today between lr.start_date and lr.end_date
    )
  on conflict (user_id, dedupe_key) where dedupe_key is not null do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

create or replace function public.reminder_att_checkout() returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_today date := public.reminder_today();
  v_now time := public.reminder_time();
  sc record;
  v_after integer := public.reminder_param('att_checkout', 0);
  v_n integer;
begin
  if not public.reminder_enabled('att_checkout') then return 0; end if;
  select * into sc from public.reminder_schedule(v_today);
  if not sc.is_workday then return 0; end if;
  if v_now < sc.end_time + make_interval(mins => v_after) or v_now >= '23:00' then return 0; end if;

  insert into public.notifications (user_id, type, title, message, dedupe_key)
  select a.user_id, 'reminder_att_checkout', 'Đừng quên chấm công ra',
         'Đã hết giờ làm (' || to_char(sc.end_time, 'HH24:MI') || '). Bạn vẫn đang ở trạng thái đã vào, chưa ra.',
         'att_checkout:' || v_today::text
  from public.attendance a
  join public.reminder_staff s on s.id = a.user_id
  where a.date = v_today and a.status = 'active' and a.check_out_time is null
  on conflict (user_id, dedupe_key) where dedupe_key is not null do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

create or replace function public.reminder_att_missing_checkout() returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_today date := public.reminder_today();
  v_days integer := public.reminder_param('att_missing_checkout', 7);
  v_n integer;
begin
  if not public.reminder_enabled('att_missing_checkout') then return 0; end if;
  if not public.reminder_digest_window() then return 0; end if;

  insert into public.notifications (user_id, type, title, message, dedupe_key)
  select a.user_id, 'reminder_att_missing_checkout', 'Thiếu giờ ra ngày ' || to_char(a.date, 'DD/MM'),
         'Ngày ' || to_char(a.date, 'DD/MM/YYYY')
           || ' chỉ có giờ vào, chưa có giờ ra. Hãy gửi đơn bổ sung hoặc nhờ quản lý xác nhận.',
         'att_missing_checkout:' || a.id::text
  from public.attendance a
  join public.reminder_staff s on s.id = a.user_id
  where a.status = 'active' and a.check_out_time is null
    and a.date < v_today and a.date >= v_today - v_days
  on conflict (user_id, dedupe_key) where dedupe_key is not null do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

create or replace function public.reminder_att_approval() returns integer
language plpgsql security definer set search_path = public as $$
declare v_today date := public.reminder_today();
begin
  if not public.reminder_enabled('att_approval') then return 0; end if;
  if not public.reminder_digest_window() then return 0; end if;
  perform public.reminder_pairs_reset();
  insert into reminder_pairs
  select rv.user_id, a.id
  from public.attendance a
  cross join lateral public.reminder_reviewers_of(a.user_id, 'attendance') rv
  where a.check_out_time is not null and not coalesce(a.approved_by_lead, false)
    and a.date < v_today and a.date >= v_today - 45;
  return public.reminder_flush_digest(
    'reminder_att_approval', 'Chấm công đang chờ bạn duyệt',
    'Có {n} lượt chấm công của các ngày trước chưa được xác nhận. Mở Chấm công để duyệt.',
    'att_approval');
end;
$$;

create or replace function public.reminder_att_request_pending() returns integer
language plpgsql security definer set search_path = public as $$
begin
  if not public.reminder_enabled('att_request_pending') then return 0; end if;
  if not public.reminder_digest_window() then return 0; end if;
  perform public.reminder_pairs_reset();
  insert into reminder_pairs
  select rv.user_id, r.id
  from public.attendance_requests r
  cross join lateral public.reminder_reviewers_of(r.user_id, 'attendance') rv
  where r.status = 'PENDING' and r.created_at < now() - interval '1 hour';
  return public.reminder_flush_digest(
    'reminder_att_request_pending', 'Đơn chấm công đang chờ duyệt',
    'Có {n} đơn đi muộn / về sớm / làm thêm giờ đang chờ bạn duyệt.',
    'att_request');
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Nghỉ phép
-- ---------------------------------------------------------------------------
create or replace function public.reminder_leave_pending_manager() returns integer
language plpgsql security definer set search_path = public as $$
begin
  if not public.reminder_enabled('leave_pending_manager') then return 0; end if;
  if not public.reminder_digest_window() then return 0; end if;
  perform public.reminder_pairs_reset();
  insert into reminder_pairs
  select rv.user_id, l.id
  from public.leave_requests l
  cross join lateral public.reminder_reviewers_of(l.user_id, 'leave') rv
  where l.status = 'pending' and coalesce(l.approval_stage, 'MANAGER') = 'MANAGER';
  return public.reminder_flush_digest(
    'reminder_leave_pending', 'Đơn nghỉ phép đang chờ bạn duyệt',
    'Có {n} đơn nghỉ phép đang chờ quản lý duyệt. Duyệt sớm để người nghỉ chủ động sắp xếp.',
    'leave_manager');
end;
$$;

create or replace function public.reminder_leave_pending_hr() returns integer
language plpgsql security definer set search_path = public as $$
begin
  if not public.reminder_enabled('leave_pending_hr') then return 0; end if;
  if not public.reminder_digest_window() then return 0; end if;
  perform public.reminder_pairs_reset();
  insert into reminder_pairs
  select u.user_id, l.id
  from public.leave_requests l
  cross join public.reminder_users_with_permission('users') u
  where l.status = 'pending' and l.approval_stage = 'HR' and u.user_id <> l.user_id;
  return public.reminder_flush_digest(
    'reminder_leave_pending', 'Đơn nghỉ phép chờ Nhân sự chốt',
    'Có {n} đơn nghỉ phép đã qua quản lý, đang chờ Nhân sự chốt cuối.',
    'leave_hr');
end;
$$;

create or replace function public.reminder_leave_upcoming() returns integer
language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  if not public.reminder_enabled('leave_upcoming') then return 0; end if;
  if not public.reminder_in_hours(8, 20) then return 0; end if;
  insert into public.notifications (user_id, type, title, message, dedupe_key)
  select l.user_id, 'reminder_leave_upcoming', 'Ngày mai bạn nghỉ phép',
         'Đơn nghỉ từ ' || to_char(l.start_date, 'DD/MM') || ' đến ' || to_char(l.end_date, 'DD/MM')
           || ' đã được duyệt. Nhớ bàn giao công việc đang dở.',
         'leave_upcoming:' || l.id::text
  from public.leave_requests l
  join public.reminder_staff s on s.id = l.user_id
  where l.status = 'approved' and l.start_date = public.reminder_today() + 1
  on conflict (user_id, dedupe_key) where dedupe_key is not null do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Giao việc, tác vụ dự án, nhật ký giờ, lịch họp
-- ---------------------------------------------------------------------------
create or replace function public.reminder_assign_today() returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_today date := public.reminder_today();
  v_now time := public.reminder_time();
  v_slot text;
begin
  if not public.reminder_enabled('assign_today') then return 0; end if;
  if not public.reminder_digest_window() then return 0; end if;
  v_slot := case
    when v_now >= '08:30' and v_now < '12:00' then 'am'
    when v_now >= '15:30' then 'pm'
  end;
  if v_slot is null then return 0; end if;

  perform public.reminder_pairs_reset();
  insert into reminder_pairs
  select d.user_id, d.id
  from public.daily_assignments d
  where d.status = 'pending' and d.work_date <= v_today and d.work_date >= v_today - 30;
  return public.reminder_flush_digest(
    'reminder_assign_today',
    case v_slot when 'am' then 'Việc được giao hôm nay' else 'Còn việc chưa nộp' end,
    'Bạn có {n} việc giao chưa hoàn thành (gồm cả việc quá hạn). Cập nhật và nộp để người giao duyệt.',
    'assign_today_' || v_slot);
end;
$$;

create or replace function public.reminder_assign_review() returns integer
language plpgsql security definer set search_path = public as $$
declare v_hours integer := public.reminder_param('assign_review', 24);
begin
  if not public.reminder_enabled('assign_review') then return 0; end if;
  if not public.reminder_digest_window() then return 0; end if;
  perform public.reminder_pairs_reset();
  insert into reminder_pairs
  select coalesce(d.assigned_by, u.user_id), d.id
  from public.daily_assignments d
  left join lateral (select user_id from public.reminder_users_with_permission('projects')) u
    on d.assigned_by is null
  where d.status = 'submitted' and d.submitted_at < now() - make_interval(hours => v_hours)
    and coalesce(d.assigned_by, u.user_id) is not null
    and coalesce(d.assigned_by, u.user_id) <> d.user_id;
  return public.reminder_flush_digest(
    'reminder_assign_review', 'Việc đã nộp đang chờ bạn duyệt',
    'Có {n} việc giao hằng ngày đã được nộp nhưng chưa được duyệt.',
    'assign_review');
end;
$$;

create or replace function public.reminder_task_due() returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_today date := public.reminder_today();
  v_n integer := 0;
  v_k integer;
begin
  if not public.reminder_enabled('task_due') then return 0; end if;
  if not public.reminder_digest_window() then return 0; end if;

  insert into public.notifications (user_id, type, title, message, dedupe_key)
  select t.assignee_id, 'reminder_task_due',
         case when t.due_date = v_today then 'Tác vụ đến hạn hôm nay' else 'Tác vụ đến hạn ngày mai' end,
         '"' || t.title || '" (' || pr.name || ') hạn ' || to_char(t.due_date, 'DD/MM') || '.',
         'task_due:' || t.id::text || ':' || (t.due_date - v_today)::text
  from public.tasks t
  join public.projects pr on pr.id = t.project_id and pr.status in ('planning', 'active')
  join public.reminder_staff s on s.id = t.assignee_id
  where t.status <> 'done' and t.due_date in (v_today, v_today + 1)
  on conflict (user_id, dedupe_key) where dedupe_key is not null do nothing;
  get diagnostics v_k = row_count; v_n := v_n + v_k;

  perform public.reminder_pairs_reset();
  insert into reminder_pairs
  select t.assignee_id, t.id
  from public.tasks t
  join public.projects pr on pr.id = t.project_id and pr.status in ('planning', 'active')
  where t.status <> 'done' and t.assignee_id is not null and t.due_date < v_today;
  v_n := v_n + public.reminder_flush_digest(
    'reminder_task_due', 'Tác vụ đã quá hạn',
    'Bạn có {n} tác vụ đã quá hạn chưa hoàn thành. Hoàn thành hoặc xin gia hạn.',
    'task_overdue');
  return v_n;
end;
$$;

create or replace function public.reminder_task_review() returns integer
language plpgsql security definer set search_path = public as $$
declare v_hours integer := public.reminder_param('task_review', 4);
begin
  if not public.reminder_enabled('task_review') then return 0; end if;
  if not public.reminder_digest_window() then return 0; end if;
  perform public.reminder_pairs_reset();
  insert into reminder_pairs
  select pr.lead_id, t.id
  from public.tasks t
  join public.projects pr on pr.id = t.project_id and pr.status in ('planning', 'active')
  where t.status = 'in_review' and pr.lead_id is not null
    and t.updated_at < now() - make_interval(hours => v_hours)
    and pr.lead_id is distinct from t.assignee_id;
  return public.reminder_flush_digest(
    'reminder_task_review', 'Tác vụ đang chờ bạn duyệt',
    'Có {n} tác vụ ở cột chờ duyệt trong dự án bạn phụ trách.',
    'task_review');
end;
$$;

create or replace function public.reminder_task_request_pending() returns integer
language plpgsql security definer set search_path = public as $$
begin
  if not public.reminder_enabled('task_request_pending') then return 0; end if;
  if not public.reminder_digest_window() then return 0; end if;
  perform public.reminder_pairs_reset();
  insert into reminder_pairs
  select pr.lead_id, r.id
  from public.project_task_requests r
  join public.projects pr on pr.id = r.project_id
  where r.status = 'SUBMITTED' and pr.lead_id is not null and pr.lead_id <> r.requested_by;
  return public.reminder_flush_digest(
    'reminder_task_request_pending', 'Đề nghị tác vụ đang chờ duyệt',
    'Có {n} đề nghị gia hạn / hoàn thành tác vụ đang chờ bạn duyệt.',
    'task_request');
end;
$$;

create or replace function public.reminder_worklog_submit() returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_today date := public.reminder_today();
  v_week date := date_trunc('week', public.reminder_today())::date;
begin
  if not public.reminder_enabled('worklog_submit') then return 0; end if;
  -- Thứ Sáu từ 15:00: tuần làm việc sắp hết mà chưa gửi nhật ký.
  if extract(isodow from v_today) <> 5 or not public.reminder_in_hours(15, 20) then return 0; end if;
  perform public.reminder_pairs_reset();
  insert into reminder_pairs
  select distinct t.assignee_id, t.project_id
  from public.tasks t
  join public.projects pr on pr.id = t.project_id and pr.status in ('planning', 'active')
  where t.assignee_id is not null and t.status <> 'done'
    and not exists (
      select 1 from public.worklog_submissions w
      where w.user_id = t.assignee_id and w.project_id = t.project_id and w.week_start = v_week
    );
  return public.reminder_flush_digest(
    'reminder_worklog_submit', 'Gửi nhật ký giờ tuần này',
    'Tuần này bạn chưa gửi nhật ký giờ cho {n} dự án. Gửi trước khi hết tuần để trưởng dự án duyệt.',
    'worklog_submit');
end;
$$;

create or replace function public.reminder_worklog_review() returns integer
language plpgsql security definer set search_path = public as $$
begin
  if not public.reminder_enabled('worklog_review') then return 0; end if;
  if not public.reminder_digest_window() then return 0; end if;
  perform public.reminder_pairs_reset();
  insert into reminder_pairs
  select pr.lead_id, w.id
  from public.worklog_submissions w
  join public.projects pr on pr.id = w.project_id
  where w.status = 'SUBMITTED' and pr.lead_id is not null and pr.lead_id <> w.user_id;
  return public.reminder_flush_digest(
    'reminder_worklog_review', 'Nhật ký giờ tuần chờ duyệt',
    'Có {n} nhật ký giờ tuần đã gửi, đang chờ bạn duyệt.',
    'worklog_review');
end;
$$;

create or replace function public.reminder_project_event() returns integer
language plpgsql security definer set search_path = public as $$
declare v_n integer := 0; v_k integer;
begin
  if not public.reminder_enabled('project_event') then return 0; end if;

  -- Trước 1 ngày (trong vòng 24 giờ tới, chưa nhắc lần nào).
  insert into public.notifications (user_id, type, title, message, dedupe_key)
  select pm.user_id, 'reminder_project_event',
         case when e.type = 'meeting' then 'Ngày mai có lịch họp: ' else 'Ngày mai có nhắc nhở: ' end || e.title,
         pr.name || ' · ' || to_char(e.start_at at time zone 'Asia/Ho_Chi_Minh', 'HH24:MI DD/MM')
           || coalesce(' · ' || nullif(trim(e.location), ''), ''),
         'event_d1:' || e.id::text
  from public.project_events e
  join public.projects pr on pr.id = e.project_id
  join public.project_members pm on pm.project_id = e.project_id
  join public.reminder_staff s on s.id = pm.user_id
  where e.start_at > now() + interval '75 minutes' and e.start_at <= now() + interval '24 hours'
    and public.reminder_in_hours(7, 22)
  on conflict (user_id, dedupe_key) where dedupe_key is not null do nothing;
  get diagnostics v_k = row_count; v_n := v_n + v_k;

  -- Trước khoảng 1 giờ.
  insert into public.notifications (user_id, type, title, message, dedupe_key)
  select pm.user_id, 'reminder_project_event',
         case when e.type = 'meeting' then 'Sắp họp: ' else 'Sắp đến hạn nhắc: ' end || e.title,
         pr.name || ' · ' || to_char(e.start_at at time zone 'Asia/Ho_Chi_Minh', 'HH24:MI')
           || coalesce(' · ' || nullif(trim(e.location), ''), ''),
         'event_h1:' || e.id::text
  from public.project_events e
  join public.projects pr on pr.id = e.project_id
  join public.project_members pm on pm.project_id = e.project_id
  join public.reminder_staff s on s.id = pm.user_id
  where e.start_at > now() and e.start_at <= now() + interval '75 minutes'
  on conflict (user_id, dedupe_key) where dedupe_key is not null do nothing;
  get diagnostics v_k = row_count; v_n := v_n + v_k;
  return v_n;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. KPI (hạn lấy từ `kpi_settings`, giống `deadlineOf` ở client)
-- ---------------------------------------------------------------------------
create or replace function public.reminder_kpi_due(p_month date, p_kind text)
returns date
language sql stable security definer set search_path = public as $$
  select ((p_month + interval '1 month')::date
          + (case p_kind
               when 'SELF' then coalesce(ks.self_due_day, 2)
               when 'MANAGER' then coalesce(ks.manager_due_day, 3)
               when 'BOARD' then coalesce(ks.board_due_day, 4)
               else coalesce(ks.lock_day, 4)
             end - 1))
  from (select 1) one
  left join lateral (
    select * from public.kpi_settings k
    where k.effective_from <= p_month order by k.effective_from desc limit 1
  ) ks on true
$$;

create or replace function public.reminder_kpi_open() returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_today date := public.reminder_today();
  v_month date := date_trunc('month', public.reminder_today())::date;
  v_open_day integer;
  v_n integer := 0; v_k integer;
begin
  if not public.reminder_enabled('kpi_open') then return 0; end if;
  if not public.reminder_digest_window() then return 0; end if;
  select coalesce((select k.open_day from public.kpi_settings k
                   where k.effective_from <= v_month order by k.effective_from desc limit 1), 25)
    into v_open_day;

  -- Đến ngày mở kỳ mà kỳ chưa tồn tại.
  if v_today >= v_month + (v_open_day - 1)
     and not exists (select 1 from public.kpi_periods p where p.month_start = v_month) then
    insert into public.notifications (user_id, type, title, message, dedupe_key)
    select u.user_id, 'reminder_kpi_open', 'Đến hạn mở kỳ KPI tháng ' || to_char(v_month, 'MM/YYYY'),
           'Kỳ KPI tháng ' || to_char(v_month, 'MM/YYYY') || ' chưa được mở. Mở kỳ để nhân viên bắt đầu tự chấm.',
           'kpi_open_missing:' || v_month::text || ':' || v_today::text
    from public.reminder_users_with_function('admin.performance_manage') u
    on conflict (user_id, dedupe_key) where dedupe_key is not null do nothing;
    get diagnostics v_k = row_count; v_n := v_n + v_k;
  end if;

  -- Kỳ đã mở: báo nhân viên một lần.
  insert into public.notifications (user_id, type, title, message, dedupe_key)
  select sh.user_id, 'reminder_kpi_open', 'Kỳ KPI tháng ' || to_char(p.month_start, 'MM/YYYY') || ' đã mở',
         'Hãy tự chấm phiếu KPI và nộp trước ngày '
           || to_char(public.reminder_kpi_due(p.month_start, 'SELF'), 'DD/MM') || '.',
         'kpi_opened:' || p.month_start::text
  from public.kpi_periods p
  join public.kpi_sheets sh on sh.period_month = p.month_start
  join public.reminder_staff s on s.id = sh.user_id
  where p.status = 'OPEN' and sh.status in ('DRAFT', 'REJECTED')
    and p.month_start >= v_month - interval '2 months'
  on conflict (user_id, dedupe_key) where dedupe_key is not null do nothing;
  get diagnostics v_k = row_count; v_n := v_n + v_k;
  return v_n;
end;
$$;

create or replace function public.reminder_kpi_self() returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_today date := public.reminder_today();
  v_lead integer := public.reminder_param('kpi_self', 3);
  v_n integer;
begin
  if not public.reminder_enabled('kpi_self') then return 0; end if;
  if not public.reminder_digest_window() then return 0; end if;
  insert into public.notifications (user_id, type, title, message, dedupe_key)
  select sh.user_id, 'reminder_kpi_self',
         case when sh.status = 'REJECTED' then 'Phiếu KPI bị trả lại, cần chỉnh lại'
              else 'Nhắc tự chấm KPI tháng ' || to_char(p.month_start, 'MM/YYYY') end,
         case
           when d.due_date < v_today then 'Đã quá hạn nộp ' || (v_today - d.due_date) || ' ngày (hạn ' || to_char(d.due_date, 'DD/MM') || '). Nộp phiếu ngay.'
           when d.due_date = v_today then 'Hôm nay là hạn nộp phiếu KPI.'
           else 'Còn ' || (d.due_date - v_today) || ' ngày để nộp phiếu (hạn ' || to_char(d.due_date, 'DD/MM') || ').'
         end,
         'kpi_self:' || sh.id::text || ':' || v_today::text
  from public.kpi_periods p
  join public.kpi_sheets sh on sh.period_month = p.month_start
  join public.reminder_staff s on s.id = sh.user_id
  cross join lateral (select public.reminder_kpi_due(p.month_start, 'SELF') as due_date) d
  where p.status = 'OPEN' and sh.status in ('DRAFT', 'REJECTED')
    and p.month_start >= date_trunc('month', v_today)::date - interval '2 months'
    and d.due_date - v_today <= v_lead
  on conflict (user_id, dedupe_key) where dedupe_key is not null do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

create or replace function public.reminder_kpi_manager() returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_today date := public.reminder_today();
  v_lead integer := public.reminder_param('kpi_manager', 3);
  v_n integer;
begin
  if not public.reminder_enabled('kpi_manager') then return 0; end if;
  if not public.reminder_digest_window() then return 0; end if;
  insert into public.notifications (user_id, type, title, message, dedupe_key)
  select g.reviewer_id, 'reminder_kpi_manager',
         'Phiếu KPI chờ bạn chấm (tháng ' || to_char(g.month_start, 'MM/YYYY') || ')',
         'Có ' || g.n || ' phiếu đang chờ bạn chấm. Hạn ' || to_char(g.due_date, 'DD/MM')
           || case when g.due_date < v_today then ' (đã quá hạn)' else '' end || '.',
         'kpi_manager:' || g.month_start::text || ':' || v_today::text
  from (
    select sh.reviewer_id, p.month_start, count(*) as n,
           public.reminder_kpi_due(p.month_start, 'MANAGER') as due_date
    from public.kpi_periods p
    join public.kpi_sheets sh on sh.period_month = p.month_start
    where p.status = 'OPEN' and sh.status = 'PENDING' and sh.reviewer_id is not null
      and p.month_start >= date_trunc('month', v_today)::date - interval '2 months'
    group by sh.reviewer_id, p.month_start
  ) g
  join public.reminder_staff s on s.id = g.reviewer_id
  where g.due_date - v_today <= v_lead
  on conflict (user_id, dedupe_key) where dedupe_key is not null do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

create or replace function public.reminder_kpi_board() returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_today date := public.reminder_today();
  v_lead integer := public.reminder_param('kpi_board', 3);
  v_n integer;
begin
  if not public.reminder_enabled('kpi_board') then return 0; end if;
  if not public.reminder_digest_window() then return 0; end if;
  insert into public.notifications (user_id, type, title, message, dedupe_key)
  select u.user_id, 'reminder_kpi_board',
         'Phiếu KPI chờ Ban Giám đốc duyệt (tháng ' || to_char(g.month_start, 'MM/YYYY') || ')',
         'Có ' || g.n || ' phiếu đang chờ duyệt cuối. Hạn ' || to_char(g.due_date, 'DD/MM')
           || case when g.due_date < v_today then ' (đã quá hạn)' else '' end || '.',
         'kpi_board:' || g.month_start::text || ':' || v_today::text
  from (
    select p.month_start, count(*) as n, public.reminder_kpi_due(p.month_start, 'BOARD') as due_date
    from public.kpi_periods p
    join public.kpi_sheets sh on sh.period_month = p.month_start
    where p.status = 'OPEN' and sh.status = 'BOARD'
      and p.month_start >= date_trunc('month', v_today)::date - interval '2 months'
    group by p.month_start
  ) g
  cross join public.reminder_users_with_function('admin.kpi_approve') u
  where g.due_date - v_today <= v_lead
  on conflict (user_id, dedupe_key) where dedupe_key is not null do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

create or replace function public.reminder_kpi_lock() returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_today date := public.reminder_today();
  v_lead integer := public.reminder_param('kpi_lock', 3);
  v_n integer;
begin
  if not public.reminder_enabled('kpi_lock') then return 0; end if;
  if not public.reminder_digest_window() then return 0; end if;
  insert into public.notifications (user_id, type, title, message, dedupe_key)
  select u.user_id, 'reminder_kpi_lock',
         'Khoá sổ KPI tháng ' || to_char(g.month_start, 'MM/YYYY'),
         case when g.due_date < v_today then 'Đã quá hạn khoá sổ ' || (v_today - g.due_date) || ' ngày'
              when g.due_date = v_today then 'Hôm nay là hạn khoá sổ'
              else 'Còn ' || (g.due_date - v_today) || ' ngày đến hạn khoá sổ (' || to_char(g.due_date, 'DD/MM') || ')' end
           || '. Còn ' || g.open_n || '/' || g.total_n || ' phiếu chưa duyệt xong.',
         'kpi_lock:' || g.month_start::text || ':' || v_today::text
  from (
    select p.month_start, public.reminder_kpi_due(p.month_start, 'LOCK') as due_date,
           count(sh.id) filter (where sh.status <> 'APPROVED') as open_n, count(sh.id) as total_n
    from public.kpi_periods p
    left join public.kpi_sheets sh on sh.period_month = p.month_start
    where p.status = 'OPEN' and p.month_start >= date_trunc('month', v_today)::date - interval '2 months'
    group by p.month_start
  ) g
  cross join (
    select user_id from public.reminder_users_with_function('admin.kpi_close')
    union select user_id from public.reminder_users_with_function('admin.performance_manage')
  ) u
  where g.due_date - v_today <= v_lead
  on conflict (user_id, dedupe_key) where dedupe_key is not null do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

create or replace function public.reminder_kpi_reopen() returns integer
language plpgsql security definer set search_path = public as $$
begin
  if not public.reminder_enabled('kpi_reopen') then return 0; end if;
  if not public.reminder_digest_window() then return 0; end if;
  perform public.reminder_pairs_reset();
  insert into reminder_pairs
  select u.user_id, r.id
  from public.kpi_reopen_requests r
  cross join public.reminder_users_with_function('admin.kpi_approve') u
  where r.status = 'PENDING';
  return public.reminder_flush_digest(
    'reminder_kpi_reopen', 'Đề nghị mở lại phiếu KPI chờ duyệt',
    'Có {n} đề nghị mở lại phiếu KPI đã khoá đang chờ bạn duyệt.',
    'kpi_reopen');
end;
$$;

create or replace function public.reminder_kpi_sales_target() returns integer
language plpgsql security definer set search_path = public as $$
begin
  if not public.reminder_enabled('kpi_sales_target') then return 0; end if;
  if not public.reminder_digest_window() then return 0; end if;
  perform public.reminder_pairs_reset();
  insert into reminder_pairs
  select u.user_id, t.id
  from public.kpi_sales_targets t
  cross join public.reminder_users_with_function('admin.kpi_approve') u
  where t.status = 'SUBMITTED';
  return public.reminder_flush_digest(
    'reminder_kpi_sales_target', 'Chỉ tiêu kinh doanh chờ duyệt',
    'Có {n} chỉ tiêu doanh số / thu tiền đã trình, đang chờ bạn duyệt.',
    'kpi_sales_target');
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Lương: bảng công → lương → duyệt → chi trả → công bố
-- ---------------------------------------------------------------------------
create or replace function public.reminder_payroll_timesheet() returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_month date := date_trunc('month', public.reminder_today() - interval '1 month')::date;
begin
  if not public.reminder_enabled('payroll_timesheet') then return 0; end if;
  if not public.reminder_digest_window() then return 0; end if;
  if exists (select 1 from public.timesheet_periods p where p.month_start = v_month and p.status = 'LOCKED') then
    return 0;
  end if;
  perform public.reminder_pairs_reset();
  insert into reminder_pairs
  select u.user_id, gen_random_uuid()
  from public.reminder_users_with_function('admin.timesheet_lock') u;
  return public.reminder_flush_digest(
    'reminder_payroll_timesheet', 'Chưa khoá kỳ bảng công ' || to_char(v_month, 'MM/YYYY'),
    'Tháng ' || to_char(v_month, 'MM/YYYY') || ' đã kết thúc nhưng kỳ bảng công chưa khoá. Rà soát công, duyệt đơn rồi khoá để chuyển sang tính lương.',
    'payroll_timesheet');
end;
$$;

create or replace function public.reminder_payroll_run() returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_month date := date_trunc('month', public.reminder_today() - interval '1 month')::date;
  v_label text := to_char(date_trunc('month', public.reminder_today() - interval '1 month'), 'MM/YYYY');
  v_status text;
  v_published timestamptz;
  v_locked boolean;
  v_title text;
  v_msg text;
  v_fn text;
begin
  if not public.reminder_enabled('payroll_run') then return 0; end if;
  if not public.reminder_digest_window() then return 0; end if;

  select r.status, r.published_at into v_status, v_published
  from public.payroll_runs r where r.month_start = v_month;
  select exists (select 1 from public.timesheet_periods p where p.month_start = v_month and p.status = 'LOCKED')
    into v_locked;

  if not v_locked then return 0; end if; -- bước khoá bảng công đã có quy tắc riêng

  if v_status is null or v_status in ('DRAFT', 'CALCULATED') then
    v_fn := 'admin.payroll';
    v_title := 'Tính và khoá bảng lương ' || v_label;
    v_msg := 'Kỳ công đã khoá nhưng bảng lương tháng ' || v_label || ' chưa được tính và khoá. Kiểm số liệu lương tháng rồi chốt.';
  elsif v_status = 'LOCKED' then
    v_fn := 'admin.payroll_approve';
    v_title := 'Bảng lương ' || v_label || ' chờ duyệt chi';
    v_msg := 'Bảng lương đã khoá, đang chờ bạn ký duyệt lệnh chi.';
  elsif v_status = 'APPROVED' then
    v_fn := 'admin.payroll';
    v_title := 'Chi lương tháng ' || v_label;
    v_msg := 'Bảng lương đã được duyệt, chưa xác nhận chi trả. Xuất file ngân hàng và xác nhận khi đã chi.';
  elsif v_status = 'PAID' and v_published is null then
    v_fn := 'admin.payroll';
    v_title := 'Công bố phiếu lương ' || v_label;
    v_msg := 'Lương đã chi nhưng phiếu lương chưa được công bố cho nhân viên.';
  else
    return 0;
  end if;

  perform public.reminder_pairs_reset();
  execute 'insert into reminder_pairs select u.user_id, gen_random_uuid() from public.reminder_users_with_function($1) u'
    using v_fn;
  if v_fn = 'admin.payroll' then
    insert into reminder_pairs
    select u.user_id, gen_random_uuid() from public.reminder_users_with_function('admin.payroll_inputs') u
    where v_status is null or v_status in ('DRAFT', 'CALCULATED');
  end if;
  return public.reminder_flush_digest('reminder_payroll_run', v_title, v_msg, 'payroll_run:' || v_month::text || ':' || coalesce(v_status, 'NONE'));
end;
$$;

create or replace function public.reminder_payroll_scheme_pending() returns integer
language plpgsql security definer set search_path = public as $$
begin
  if not public.reminder_enabled('payroll_scheme_pending') then return 0; end if;
  if not public.reminder_digest_window() then return 0; end if;
  perform public.reminder_pairs_reset();
  insert into reminder_pairs
  select u.user_id, r.id
  from public.payroll_scheme_requests r
  cross join public.reminder_users_with_function('admin.payroll_approve') u
  where r.status = 'SUBMITTED' and u.user_id is distinct from r.submitted_by;
  return public.reminder_flush_digest(
    'reminder_payroll_scheme_pending', 'Đề xuất cơ chế lương chờ ký duyệt',
    'Có {n} đề xuất thay đổi cơ chế lương đang chờ bạn ký duyệt.',
    'payroll_scheme');
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. Đào tạo, hội nhập
-- ---------------------------------------------------------------------------
create or replace function public.reminder_training_deadline() returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_today date := public.reminder_today();
  v_n integer := 0; v_k integer;
begin
  if not public.reminder_enabled('training_deadline') then return 0; end if;
  if not public.reminder_digest_window() then return 0; end if;

  insert into public.notifications (user_id, type, title, message, dedupe_key)
  select e.user_id, 'reminder_training_deadline',
         case when c.deadline = v_today then 'Khoá đào tạo hết hạn hôm nay' else 'Khoá đào tạo sắp đến hạn' end,
         '"' || c.title || '" hạn hoàn thành ' || to_char(c.deadline, 'DD/MM/YYYY')
           || ' (tiến độ ' || e.progress || '%).',
         'training:' || e.id::text || ':' || (c.deadline - v_today)::text
  from public.training_enrollments e
  join public.training_courses c on c.id = e.course_id and c.status = 'published'
  join public.reminder_staff s on s.id = e.user_id
  where e.status <> 'completed' and c.deadline is not null
    and c.deadline - v_today in (3, 1, 0)
  on conflict (user_id, dedupe_key) where dedupe_key is not null do nothing;
  get diagnostics v_k = row_count; v_n := v_n + v_k;

  -- Quá hạn: tổng hợp mỗi tuần một lần.
  perform public.reminder_pairs_reset();
  insert into reminder_pairs
  select e.user_id, e.id
  from public.training_enrollments e
  join public.training_courses c on c.id = e.course_id and c.status = 'published'
  where e.status <> 'completed' and c.deadline is not null and c.deadline < v_today;
  insert into public.notifications (user_id, type, title, message, dedupe_key)
  select g.user_id, 'reminder_training_deadline', 'Khoá đào tạo đã quá hạn',
         'Bạn có ' || g.n || ' khoá đào tạo đã quá hạn chưa hoàn thành.',
         'training_overdue:' || to_char(v_today, 'IYYY-IW')
  from (select rp.user_id, count(distinct rp.item_id) as n from reminder_pairs rp group by rp.user_id) g
  join public.reminder_staff s on s.id = g.user_id
  on conflict (user_id, dedupe_key) where dedupe_key is not null do nothing;
  get diagnostics v_k = row_count; v_n := v_n + v_k;
  return v_n;
end;
$$;

create or replace function public.reminder_lifecycle_task() returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_today date := public.reminder_today();
  v_n integer := 0; v_k integer;
begin
  if not public.reminder_enabled('lifecycle_task') then return 0; end if;
  if not public.reminder_digest_window() then return 0; end if;

  insert into public.notifications (user_id, type, title, message, dedupe_key)
  select i.owner_id, 'reminder_lifecycle_task',
         case when i.due_date = v_today then 'Đầu việc checklist đến hạn hôm nay' else 'Đầu việc checklist đến hạn ngày mai' end,
         '"' || i.title || '" thuộc "' || pr.title || '", hạn ' || to_char(i.due_date, 'DD/MM/YYYY') || '.',
         'lifecycle:' || i.id::text || ':' || (i.due_date - v_today)::text
  from public.employee_checklist_items i
  join public.employee_lifecycle_processes pr on pr.id = i.process_id and pr.status = 'ACTIVE'
  join public.reminder_staff s on s.id = i.owner_id
  where not i.completed and i.due_date in (v_today, v_today + 1)
  on conflict (user_id, dedupe_key) where dedupe_key is not null do nothing;
  get diagnostics v_k = row_count; v_n := v_n + v_k;

  perform public.reminder_pairs_reset();
  insert into reminder_pairs
  select i.owner_id, i.id
  from public.employee_checklist_items i
  join public.employee_lifecycle_processes pr on pr.id = i.process_id and pr.status = 'ACTIVE'
  where not i.completed and i.owner_id is not null and i.due_date < v_today;
  insert into public.notifications (user_id, type, title, message, dedupe_key)
  select g.user_id, 'reminder_lifecycle_task', 'Đầu việc checklist đã quá hạn',
         'Bạn có ' || g.n || ' đầu việc hội nhập / nghỉ việc đã quá hạn chưa hoàn thành.',
         'lifecycle_overdue:' || to_char(v_today, 'IYYY-IW')
  from (select rp.user_id, count(distinct rp.item_id) as n from reminder_pairs rp group by rp.user_id) g
  join public.reminder_staff s on s.id = g.user_id
  on conflict (user_id, dedupe_key) where dedupe_key is not null do nothing;
  get diagnostics v_k = row_count; v_n := v_n + v_k;
  return v_n;
end;
$$;

-- ---------------------------------------------------------------------------
-- 10. Tuyển dụng
-- ---------------------------------------------------------------------------
create or replace function public.reminder_recruit_sla() returns integer
language plpgsql security definer set search_path = public as $$
declare v_hours integer := public.reminder_param('recruit_sla', 4);
begin
  if not public.reminder_enabled('recruit_sla') then return 0; end if;
  if not public.reminder_in_hours(8, 20) then return 0; end if;
  perform public.reminder_pairs_reset();
  insert into reminder_pairs
  select u.user_id, r.id
  from public.recruitment_requisitions r
  cross join public.reminder_users_with_permission('users') u
  where r.status = 'SUBMITTED' and r.review_due_at is not null
    and r.review_due_at <= now() + make_interval(hours => v_hours)
    and u.user_id <> r.requested_by;
  return public.reminder_flush_digest(
    'reminder_recruit_sla', 'Đề xuất tuyển dụng sắp / đã quá hạn phản hồi',
    'Có {n} đề xuất tuyển dụng sắp hoặc đã quá hạn phản hồi 24 giờ. Mở Tuyển dụng để xử lý.',
    'recruit_sla');
end;
$$;

create or replace function public.reminder_recruit_interview() returns integer
language plpgsql security definer set search_path = public as $$
declare v_n integer := 0; v_k integer;
begin
  if not public.reminder_enabled('recruit_interview') then return 0; end if;

  insert into public.notifications (user_id, type, title, message, dedupe_key)
  select i.interviewer_id, 'reminder_recruit_interview', 'Ngày mai có lịch phỏng vấn',
         c.full_name || ' · vòng ' || i.round || ' · '
           || to_char(i.scheduled_at at time zone 'Asia/Ho_Chi_Minh', 'HH24:MI DD/MM')
           || coalesce(' · ' || nullif(trim(i.location_or_link), ''), ''),
         'interview_d1:' || i.id::text
  from public.recruitment_interviews i
  join public.recruitment_candidates c on c.id = i.candidate_id
  join public.reminder_staff s on s.id = i.interviewer_id
  where i.status = 'SCHEDULED' and i.scheduled_at > now() + interval '75 minutes'
    and i.scheduled_at <= now() + interval '24 hours' and public.reminder_in_hours(7, 22)
  on conflict (user_id, dedupe_key) where dedupe_key is not null do nothing;
  get diagnostics v_k = row_count; v_n := v_n + v_k;

  insert into public.notifications (user_id, type, title, message, dedupe_key)
  select i.interviewer_id, 'reminder_recruit_interview', 'Sắp đến giờ phỏng vấn',
         c.full_name || ' · vòng ' || i.round || ' · '
           || to_char(i.scheduled_at at time zone 'Asia/Ho_Chi_Minh', 'HH24:MI')
           || coalesce(' · ' || nullif(trim(i.location_or_link), ''), ''),
         'interview_h1:' || i.id::text
  from public.recruitment_interviews i
  join public.recruitment_candidates c on c.id = i.candidate_id
  join public.reminder_staff s on s.id = i.interviewer_id
  where i.status = 'SCHEDULED' and i.scheduled_at > now() and i.scheduled_at <= now() + interval '75 minutes'
  on conflict (user_id, dedupe_key) where dedupe_key is not null do nothing;
  get diagnostics v_k = row_count; v_n := v_n + v_k;
  return v_n;
end;
$$;

create or replace function public.reminder_recruit_offer() returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_days integer := public.reminder_param('recruit_offer', 3);
  v_n integer;
begin
  if not public.reminder_enabled('recruit_offer') then return 0; end if;
  if not public.reminder_digest_window() then return 0; end if;
  insert into public.notifications (user_id, type, title, message, dedupe_key)
  select o.created_by, 'reminder_recruit_offer', 'Offer chưa có phản hồi',
         'Offer gửi ' || c.full_name || ' ngày ' || to_char(o.sent_at at time zone 'Asia/Ho_Chi_Minh', 'DD/MM')
           || ' chưa được trả lời. Liên hệ ứng viên để chốt.',
         'offer:' || o.id::text || ':' || to_char(public.reminder_today(), 'IYYY-IW')
  from public.recruitment_offers o
  join public.recruitment_candidates c on c.id = o.candidate_id
  join public.reminder_staff s on s.id = o.created_by
  where o.status = 'SENT' and o.sent_at < now() - make_interval(days => v_days)
  on conflict (user_id, dedupe_key) where dedupe_key is not null do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- ---------------------------------------------------------------------------
-- 11. Giấy tờ sắp hết hạn
-- ---------------------------------------------------------------------------
create or replace function public.reminder_document_expiry() returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_today date := public.reminder_today();
  v_n integer := 0; v_k integer;
begin
  if not public.reminder_enabled('document_expiry') then return 0; end if;
  if not public.reminder_digest_window() then return 0; end if;

  -- Giấy tờ nhân viên: báo cho Nhân sự và chính chủ.
  insert into public.notifications (user_id, type, title, message, dedupe_key)
  select r.user_id, 'reminder_document_expiry',
         case when d.expiry_date = v_today then 'Giấy tờ hết hạn hôm nay' else 'Giấy tờ sắp hết hạn' end,
         d.title || ' (' || p.name || ') hết hạn ' || to_char(d.expiry_date, 'DD/MM/YYYY')
           || case when d.expiry_date = v_today then '.' else ' — còn ' || (d.expiry_date - v_today) || ' ngày.' end,
         'doc:' || d.id::text || ':' || (d.expiry_date - v_today)::text
  from public.employee_documents d
  join public.profiles p on p.id = d.employee_id
  cross join lateral (
    select d.employee_id as user_id
    union
    select u.user_id from public.reminder_users_with_permission('users') u
  ) r
  join public.reminder_staff s on s.id = r.user_id
  where p.is_active and d.expiry_date is not null and d.expiry_date - v_today in (30, 7, 0)
  on conflict (user_id, dedupe_key) where dedupe_key is not null do nothing;
  get diagnostics v_k = row_count; v_n := v_n + v_k;

  -- Giấy tờ lao động (hộ chiếu, visa...): báo cho người quản lý hồ sơ lao động.
  insert into public.notifications (user_id, type, title, message, dedupe_key)
  select u.user_id, 'reminder_worker_document_expiry',
         case when d.expiry_date = v_today then 'Giấy tờ lao động hết hạn hôm nay' else 'Giấy tờ lao động sắp hết hạn' end,
         d.document_type || ' ' || d.document_number || ' của ' || w.full_name || ' hết hạn '
           || to_char(d.expiry_date, 'DD/MM/YYYY')
           || case when d.expiry_date = v_today then '.' else ' — còn ' || (d.expiry_date - v_today) || ' ngày.' end,
         'wdoc:' || d.id::text || ':' || (d.expiry_date - v_today)::text
  from public.worker_documents d
  join public.overseas_workers w on w.id = d.worker_id
  cross join public.reminder_users_with_function('admin.worker_documents') u
  where d.expiry_date is not null and d.expiry_date - v_today in (60, 30, 7, 0)
  on conflict (user_id, dedupe_key) where dedupe_key is not null do nothing;
  get diagnostics v_k = row_count; v_n := v_n + v_k;
  return v_n;
end;
$$;

-- ---------------------------------------------------------------------------
-- 12. Điều phối
-- ---------------------------------------------------------------------------
create or replace function public.generate_reminders() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  fn text;
  v_n integer;
  v_total integer := 0;
  v_result jsonb := '{}'::jsonb;
  v_errors jsonb := '{}'::jsonb;
  v_auto boolean;
begin
  -- Công tắc "Gửi thông báo tự động" ở Cấu hình áp dụng cho cả nhắc nhở.
  select coalesce((select a.auto_notify from public.app_settings a limit 1), true) into v_auto;
  if not v_auto then
    return jsonb_build_object('created', 0, 'skipped', 'auto_notify_off');
  end if;

  for fn in
    select unnest(array[
      'reminder_att_checkin', 'reminder_att_checkin_late', 'reminder_att_checkout',
      'reminder_att_missing_checkout', 'reminder_att_approval', 'reminder_att_request_pending',
      'reminder_leave_pending_manager', 'reminder_leave_pending_hr', 'reminder_leave_upcoming',
      'reminder_assign_today', 'reminder_assign_review', 'reminder_task_due', 'reminder_task_review',
      'reminder_task_request_pending', 'reminder_worklog_submit', 'reminder_worklog_review',
      'reminder_project_event',
      'reminder_kpi_open', 'reminder_kpi_self', 'reminder_kpi_manager', 'reminder_kpi_board',
      'reminder_kpi_lock', 'reminder_kpi_reopen', 'reminder_kpi_sales_target',
      'reminder_payroll_timesheet', 'reminder_payroll_run', 'reminder_payroll_scheme_pending',
      'reminder_training_deadline', 'reminder_lifecycle_task',
      'reminder_recruit_sla', 'reminder_recruit_interview', 'reminder_recruit_offer',
      'reminder_document_expiry'
    ])
  loop
    begin
      execute format('select public.%I()', fn) into v_n;
      v_result := v_result || jsonb_build_object(fn, v_n);
      v_total := v_total + coalesce(v_n, 0);
    exception when others then
      -- Một loại nhắc lỗi (thiếu bảng, đổi cột...) không được kéo theo các loại khác.
      v_errors := v_errors || jsonb_build_object(fn, sqlerrm);
    end;
  end loop;

  return jsonb_build_object('created', v_total, 'rules', v_result, 'errors', v_errors);
end;
$$;

-- Chỉ job nền (service role) được chạy bộ sinh nhắc nhở.
revoke all on function public.generate_reminders() from public, anon, authenticated;
grant execute on function public.generate_reminders() to service_role;

do $$
declare f text;
begin
  for f in
    select p.oid::regprocedure::text
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'reminder\_%'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
