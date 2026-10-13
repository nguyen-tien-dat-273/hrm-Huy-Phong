-- ============================================================================
-- Thu gon log tho ve 30 ngay gan nhat. Dan ca file vao Supabase > SQL Editor.
-- ----------------------------------------------------------------------------
-- Vi sao can: lan dong bo dau tien da nap NHAM ca 401 ngay (tu 03/06/2025) vi
-- bien RJ_BACKFILL_DAYS khong co trong file env luc do. Chua co ngay cong nao
-- duoc tao ra - toan bo 7370 su kien dang nam cho anh xa nhan vien. Nhung ngay
-- nao anh xa xong la ca 401 ngay se thanh ngay cong, keo theo so lieu luong cua
-- nhung ky da qua thay doi.
--
-- File nay xoa phan cu, giu lai 30 ngay gan nhat.
--
-- An toan:
--   - Chi dong vao attendance_device_events (log tho tu may). KHONG dong vao
--     bang attendance, nen khong xoa ngay cong nao dang co.
--   - Chi xoa dong CHUA xu ly (processed_at is null). Dong da thanh ngay cong
--     thi giu nguyen, chay lai file nay nhieu lan cung khong lam hong gi.
--   - Khong mat du lieu vinh vien: may cham cong van giu du 7370 ban ghi. Muon
--     lay lai toan bo thi dat RJ_BACKFILL_DAYS=0 roi chay lai pnpm attendance:sync.
-- ============================================================================

delete from public.attendance_device_events e
using public.attendance_devices d
where e.device_id = d.id
  and lower(d.serial_number) = lower('1313245000324')
  and e.processed_at is null
  and e.punched_at < (now() - interval '30 days');

-- Xem lai con gi.
select count(*) as su_kien_con_lai,
       count(*) filter (where profile_id is null) as chua_anh_xa,
       min(punched_at) as som_nhat,
       max(punched_at) as moi_nhat
from public.attendance_device_events e
join public.attendance_devices d on d.id = e.device_id
where lower(d.serial_number) = lower('1313245000324');
