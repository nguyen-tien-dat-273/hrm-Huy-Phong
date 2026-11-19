-- ============================================================================
-- Đã quét máy chấm công thì nhân viên KHÔNG tự check-in / sửa giờ vào trên HRM.
-- ----------------------------------------------------------------------------
-- Migration 20261008100000 chỉ chặn INSERT dòng công thứ hai. Còn hai lối hở:
--
--  1. UPDATE: dòng của máy (check_in_method = 'DEVICE') đã có giờ vào, nhưng
--     nhân viên vẫn gọi thẳng API `update attendance set check_in_time = ...`
--     lên chính dòng đó và ghi đè giờ của máy.
--  2. Tự ghi nguồn DEVICE: lối "check-out khi chưa check-in" chèn dòng với
--     nguồn DEVICE (do nhân viên). Trigger attendance_00_device_state coi
--     DEVICE có đủ hai mốc giờ là TỰ DUYỆT, nên "Check-in bổ sung" sau đó
--     biến một lần tự khai thành ngày công không cần quản lý xác nhận.
--
-- Quy tắc sau migration này, chỉ áp cho NHÂN VIÊN TỰ THAO TÁC trên dòng của
-- chính mình (người có quyền chấm công / admin, máy chấm công qua service role
-- hoặc bridge không bị ảnh hưởng):
--   - không được tạo dòng hoặc đổi sang nguồn DEVICE;
--   - không được đổi giờ vào của dòng đã là DEVICE và đã có giờ vào.
-- Giờ ra vẫn tự bấm được. Check-in ngoại lệ (quên quét) vẫn dùng nguồn MANUAL
-- và chờ quản lý xác nhận như cũ.
--
-- Chạy lại nhiều lần được.
-- ============================================================================

create or replace function public.guard_self_checkin_vs_device()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  owner uuid := coalesce(new.user_id, old.user_id);
begin
  -- Máy chấm công (service role / bridge) không có phiên người dùng: auth.uid() null.
  -- Người dùng thao tác dòng của người khác (quản lý, HR) hoặc có quyền chấm công: cho qua.
  if actor is null or actor is distinct from owner then
    return new;
  end if;
  if public.is_admin() or public.can('attendance') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if coalesce(new.check_in_method, '') = 'DEVICE' then
      raise exception 'Nguồn "máy chấm công" chỉ do máy chấm công ghi, không tạo được từ HRM.'
        using errcode = '42501';
    end if;
    return new;
  end if;

  -- UPDATE
  if coalesce(new.check_in_method, '') = 'DEVICE'
     and coalesce(old.check_in_method, '') is distinct from 'DEVICE' then
    raise exception 'Không đổi được nguồn dữ liệu sang máy chấm công từ HRM.'
      using errcode = '42501';
  end if;

  if coalesce(old.check_in_method, '') = 'DEVICE'
     and old.check_in_time is not null
     and new.check_in_time is distinct from old.check_in_time then
    raise exception 'Ngày % đã có giờ vào từ máy chấm công, không sửa được trên HRM. Chỉ cần bấm Check-out khi về.',
      to_char(old.date, 'DD/MM/YYYY')
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists attendance_01_guard_self_checkin on public.attendance;
create trigger attendance_01_guard_self_checkin
before insert or update on public.attendance
for each row execute function public.guard_self_checkin_vs_device();

comment on function public.guard_self_checkin_vs_device() is
  'Nhân viên tự thao tác: không tạo/đổi sang nguồn DEVICE, không sửa giờ vào của dòng đã do máy chấm công ghi.';
