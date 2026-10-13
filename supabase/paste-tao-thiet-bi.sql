-- ============================================================================
-- Khai may cham cong. Dan ca file vao Supabase > SQL Editor > Run.
-- Token moi phai duoc tao qua HRM; khong seed token/hash co dinh trong SQL.
-- Chay lai nhieu lan duoc: thiet bi khop theo serial.
-- ============================================================================

-- 1. Thiet bi.
insert into public.attendance_devices
  (name, model, serial_number, timezone, records_checkout, is_active)
select 'May cua chinh', 'ZMM510_TFT', '1313245000324', 'Asia/Ho_Chi_Minh', false, true
where not exists (
  select 1 from public.attendance_devices
  where lower(serial_number) = lower('1313245000324')
);

-- 2. Do not seed a fixed, non-expiring bridge credential here. Create and
-- rotate credentials through issue_attendance_device_token() in the HRM UI.
update public.attendance_device_tokens t
set expires_at = now() + interval '30 days'
from public.attendance_devices d
where t.device_id = d.id
  and lower(d.serial_number) = lower('1313245000324')
  and t.revoked_at is null
  and t.expires_at is null;

-- 3. Xem lai ket qua.
select d.id, d.name, d.model, d.serial_number, d.records_checkout, d.is_active,
       (select count(*) from public.attendance_device_tokens t
        where t.device_id = d.id and t.revoked_at is null
          and t.expires_at > now()) as token_con_hieu_luc
from public.attendance_devices d
where lower(d.serial_number) = lower('1313245000324');
