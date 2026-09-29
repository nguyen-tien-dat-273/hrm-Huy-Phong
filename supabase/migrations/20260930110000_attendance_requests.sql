-- ============================================================================
-- RC4.5 — Đơn đi muộn/về sớm và đơn làm thêm giờ.
-- ----------------------------------------------------------------------------
-- BRD Huy Phong v1.0, RC4.5 (Quan trọng):
--   "Xử lý đơn từ phát sinh tập trung: đơn nghỉ phép (phép năm/ốm/không lương),
--    đơn đi muộn/về sớm (HẠN MỨC TỐI ĐA 3 LẦN/THÁNG), đơn làm thêm giờ (OT)."
--
-- Đơn nghỉ phép đã có ở `leave_requests`. Hai loại còn lại chưa có chỗ nào.
--
-- KHÔNG nhét chúng vào `leave_requests`: bảng đó có sổ quỹ phép, kiểm tra
-- trùng ngày, và luồng duyệt hai cấp theo SỐ NGÀY NGHỈ — cả ba đều vô nghĩa
-- với một đơn xin đi muộn 30 phút. Gộp vào sẽ phải viết `if` khắp nơi để loại
-- trừ, và mỗi lần thêm quy tắc nghỉ phép lại phải nhớ nó không áp cho đi muộn.
--
-- HẠN MỨC 3 LẦN/THÁNG cưỡng chế ở TẦNG DATABASE. Để giao diện tự đếm thì một
-- người mở hai tab là lách được, và quan trọng hơn: hạn mức này ảnh hưởng tới
-- thưởng chuyên cần, tức là ảnh hưởng tiền.
-- ============================================================================

create table if not exists public.attendance_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,

  request_type text not null check (request_type in ('LATE_ARRIVAL', 'EARLY_LEAVE', 'OVERTIME')),
  work_date date not null,

  /* Đi muộn/về sớm: số phút xin phép.
     Làm thêm giờ: để null, dùng `hours` bên dưới. */
  minutes integer check (minutes is null or (minutes > 0 and minutes <= 480)),
  /* Làm thêm giờ: số giờ xin làm thêm. */
  hours numeric(5, 2) check (hours is null or (hours > 0 and hours <= 12)),

  reason text not null check (length(trim(reason)) >= 5),

  status text not null default 'PENDING' check (status in ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED')),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  review_note text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  /* Đúng một đơn mỗi loại cho mỗi ngày — hai đơn đi muộn cùng ngày là dấu
     hiệu nhập nhầm, không phải nghiệp vụ thật. */
  unique (user_id, work_date, request_type),

  /* Loại đơn nào dùng đơn vị đo nào: ràng buộc ngay tại đây thay vì tin vào
     giao diện, vì dữ liệu sai đơn vị sẽ lặng lẽ chảy vào bảng công. */
  constraint attendance_request_measure_matches_type check (
    (request_type in ('LATE_ARRIVAL', 'EARLY_LEAVE') and minutes is not null and hours is null)
    or (request_type = 'OVERTIME' and hours is not null and minutes is null)
  )
);

create index if not exists attendance_requests_user_month_idx
  on public.attendance_requests(user_id, work_date desc);
create index if not exists attendance_requests_pending_idx
  on public.attendance_requests(status) where status = 'PENDING';

comment on table public.attendance_requests is
  'Đơn đi muộn/về sớm và đơn làm thêm giờ (RC4.5). Đơn nghỉ phép nằm ở leave_requests.';

-- ---------------------------------------------------------------------------
-- Hạn mức đi muộn/về sớm mỗi tháng
-- ---------------------------------------------------------------------------
-- Để cấu hình được thay vì khoá cứng số 3: đây là chính sách của công ty, và
-- BRD ghi "tối đa 3 lần/tháng" là mức hiện tại chứ không phải luật.
alter table public.payroll_settings
  add column if not exists late_request_monthly_quota integer not null default 3
    check (late_request_monthly_quota >= 0);

comment on column public.payroll_settings.late_request_monthly_quota is
  'Số đơn đi muộn/về sớm tối đa mỗi người mỗi tháng (RC4.5). 0 = không cho phép.';

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
  -- Đơn làm thêm giờ không bị hạn mức: làm thêm là việc công ty cần, không
  -- phải đặc ân xin xỏ.
  if new.request_type = 'OVERTIME' then
    return new;
  end if;

  -- Đơn bị từ chối hoặc đã huỷ không tiêu hạn mức.
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

drop trigger if exists attendance_requests_quota on public.attendance_requests;
create trigger attendance_requests_quota
before insert or update of status, work_date, request_type on public.attendance_requests
for each row execute function public.guard_attendance_request_quota();

-- ---------------------------------------------------------------------------
-- Không sửa đơn của kỳ công đã khóa
-- ---------------------------------------------------------------------------
-- Cùng lý do với `attendance` và `leave_requests`: đơn đã duyệt ảnh hưởng số
-- liệu mà phiếu lương đã đóng băng.
create or replace function public.guard_attendance_request_period()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_date date;
begin
  if tg_op = 'DELETE' then
    v_date := old.work_date;
  else
    v_date := new.work_date;
  end if;

  if public.timesheet_period_locked(v_date) then
    raise exception
      'Kỳ công tháng % đã khóa, không sửa được đơn từ của tháng đó.',
      to_char(date_trunc('month', v_date), 'MM/YYYY')
      using errcode = 'check_violation';
  end if;

  return coalesce(new, old);
end;
$fn$;

drop trigger if exists attendance_requests_period_lock on public.attendance_requests;
create trigger attendance_requests_period_lock
before insert or update or delete on public.attendance_requests
for each row execute function public.guard_attendance_request_period();

drop trigger if exists attendance_requests_touch on public.attendance_requests;
create trigger attendance_requests_touch
before update on public.attendance_requests
for each row execute function public.touch_payroll_updated_at();

-- ---------------------------------------------------------------------------
-- RLS — cùng phạm vi RC1.2 với chấm công
-- ---------------------------------------------------------------------------
alter table public.attendance_requests enable row level security;

drop policy if exists attendance_requests_read on public.attendance_requests;
create policy attendance_requests_read on public.attendance_requests
for select to authenticated using (
  user_id = auth.uid()
  or public.is_admin()
  or (public.can('attendance') and public.manages_employee(user_id))
);

-- Ai cũng tự gửi đơn cho CHÍNH MÌNH được; không gửi hộ người khác.
drop policy if exists attendance_requests_insert on public.attendance_requests;
create policy attendance_requests_insert on public.attendance_requests
for insert to authenticated with check (user_id = auth.uid());

-- Người gửi sửa/huỷ được đơn CHƯA duyệt của mình; quản lý trong phạm vi thì
-- duyệt được.
drop policy if exists attendance_requests_update on public.attendance_requests;
create policy attendance_requests_update on public.attendance_requests
for update to authenticated using (
  (user_id = auth.uid() and status = 'PENDING')
  or public.is_admin()
  or (public.can('attendance') and public.manages_employee(user_id))
);

drop policy if exists attendance_requests_delete on public.attendance_requests;
create policy attendance_requests_delete on public.attendance_requests
for delete to authenticated using (
  (user_id = auth.uid() and status = 'PENDING') or public.is_admin()
);

grant select, insert, update, delete on public.attendance_requests to authenticated;
