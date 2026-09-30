-- ============================================================================
-- Khai may cham cong + token bridge. Dan ca file vao Supabase > SQL Editor > Run.
-- ----------------------------------------------------------------------------
-- Ban ro cua token KHONG nam trong file nay. No da duoc ghi san vao
-- .env.attendance-bridge tren may chay bridge; day chi la ban bam SHA-256,
-- dung nhu cach issue_attendance_device_token() luu.
--
-- Chay lai nhieu lan duoc: thiet bi khop theo serial, token khop theo ban bam.
-- ============================================================================

-- 1. Thiet bi.
insert into public.attendance_devices
  (name, model, serial_number, timezone, records_checkout, is_active)
select 'May cua chinh', 'ZMM510_TFT', '1313245000324', 'Asia/Ho_Chi_Minh', false, true
where not exists (
  select 1 from public.attendance_devices
  where lower(serial_number) = lower('1313245000324')
);

-- 2. Token bridge. Chay lai thi bo co thu hoi de dung lai chinh token cu.
insert into public.attendance_device_tokens (device_id, label, token_hash)
select d.id, 'Bridge', 'd4c539f8b4634855836f118fd3e19df5d79d084b26a0a07c08a68d9b88898dfc'
from public.attendance_devices d
where lower(d.serial_number) = lower('1313245000324')
on conflict (token_hash) do update
  set revoked_at = null, expires_at = null;

-- 3. Thu hoi moi token KHAC cua may nay, tranh de khoa cu con song.
update public.attendance_device_tokens t
set revoked_at = now()
from public.attendance_devices d
where t.device_id = d.id
  and lower(d.serial_number) = lower('1313245000324')
  and t.token_hash <> 'd4c539f8b4634855836f118fd3e19df5d79d084b26a0a07c08a68d9b88898dfc'
  and t.revoked_at is null;

-- 4. Xem lai ket qua.
select d.id, d.name, d.model, d.serial_number, d.records_checkout, d.is_active,
       (select count(*) from public.attendance_device_tokens t
        where t.device_id = d.id and t.revoked_at is null) as token_con_hieu_luc
from public.attendance_devices d
where lower(d.serial_number) = lower('1313245000324');
