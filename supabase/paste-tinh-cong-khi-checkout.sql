-- ============================================================================
-- DAN CA FILE NAY vao Supabase > SQL Editor. BAM Ctrl+A TRUOC KHI RUN.
-- ----------------------------------------------------------------------------
--   PHAN A  Ngay cong tu may tu tinh cong ngay khi co du gio vao va gio ra.
--   PHAN B  Tat yeu cau GPS khi check-in tren HRM.
--
-- Chay lai nhieu lan deu duoc.
-- ============================================================================


-- ############################ PHAN A ########################################

-- ============================================================================
-- Ngay cong tu may TU TINH CONG ngay khi co du gio vao va gio ra.
-- ----------------------------------------------------------------------------
-- Luat nghiep vu da chot:
--
--   Quet may    -> co gio vao, CHUA tinh cong (thieu gio ra)
--   Check-out   -> co gio ra, TINH CONG NGAY, khong ai phai duyet
--
-- Truoc thay doi nay, trigger normalize_device_attendance_state (migration
-- 20261004120000) ep approved_by_lead = false trong CA HAI truong hop:
--
--   if new.check_out_time is null or checkout_just_added then
--     new.approved_by_lead := false;
--
-- Ve nhanh dau dung: chua co gio ra thi chua du de tinh cong. Nhung nhanh
-- `checkout_just_added` thi ep ve false DUNG LUC nguoi ta vua bam checkout -
-- tuc ngay cong du du lieu roi van khong tinh, va phai co nguoi vao duyet tay.
-- Buoc duyet tay do da duoc bo khoi giao dien, nen ngay cong ket lai vinh vien:
-- payrollData.ts loc `.eq('approved_by_lead', true)` nen bang luong ra 0 ngay
-- cong ma khong bao loi gi. Dung 318 ngay cong dang mac o trang thai nay.
--
-- Sua: dao nhanh thu hai. Co gio ra thi TU dat approved_by_lead = true.
--
-- Chi ap cho nguon DEVICE. Ngay cong tu khai tren HRM (check_in_method khac
-- DEVICE) giu nguyen nep cu phai duyet tay, vi no khong qua van tay/khuon mat.
--
-- guard_attendance_approval giu nguyen: van doi du gio vao va gio ra. Trigger
-- nay ten bat dau bang 00 nen chay truoc guard theo thu tu alphabet, gia tri
-- dat o day se duoc guard kiem lai - va se qua, vi luc nay da du hai moc gio.
--
-- Chay lai nhieu lan duoc.
-- ============================================================================

create or replace function public.normalize_device_attendance_state()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if coalesce(new.check_in_method, '') <> 'DEVICE' then
    return new;
  end if;

  -- Mot lan quet la du ghi nhan ngay do co di lam; may nay khong gui gio ra.
  new.status := 'completed';

  if new.check_out_time is null then
    -- Chua du de tinh cong. Khong de sot gia tri duyet cu lai.
    new.approved_by_lead := false;
    new.approved_at := null;
    new.approved_by_user_id := null;
  elsif not coalesce(new.approved_by_lead, false) then
    -- Du ca hai moc gio: tinh cong ngay, khong cho ai duyet tay.
    new.approved_by_lead := true;
    new.approved_at := coalesce(new.approved_at, now());
  end if;

  return new;
end;
$$;

drop trigger if exists attendance_00_device_state on public.attendance;
create trigger attendance_00_device_state
before insert or update on public.attendance
for each row execute function public.normalize_device_attendance_state();

comment on function public.normalize_device_attendance_state() is
  'Ngay cong nguon DEVICE: luon completed; tu tinh cong khi da co gio ra, chua co thi de chua tinh.';

-- ----------------------------------------------------------------------------
-- Hoi to: nhung ngay da co du hai moc gio ma van mac o chua tinh cong.
-- Khong dong vao ky luong da khoa.
-- ----------------------------------------------------------------------------
update public.attendance
set approved_by_lead = true,
    approved_at = coalesce(approved_at, now())
where coalesce(check_in_method, '') = 'DEVICE'
  and check_in_time is not null
  and check_out_time is not null
  and not coalesce(approved_by_lead, false)
  and not public.timesheet_period_locked(date);


-- ############################ PHAN B ########################################
-- Tat yeu cau GPS khi check-in.
-- ----------------------------------------------------------------------------
-- guard_attendance_geofence doc co nay truoc khi lam bat cu gi khac:
--
--   select coalesce(f.enabled, false) into enabled
--   from public.feature_flags f where f.key = 'geofence_attendance';
--   if not enabled then ... return new; end if;
--
-- Nen tat co la bo qua toan bo phan doi toa do, doi do chinh xac va doi moc
-- thoi gian GPS. Khong dung toi than trigger, bat lai luc nao cung duoc.
--
-- Cham cong o day den tu may van tay/khuon mat dat co dinh mot cho; kiem tra
-- toa do trinh duyet khong them duoc gi, chi chan mat duong check-in du phong.
--
-- Bat lai sau nay: doi false thanh true o cau duoi.
-- ----------------------------------------------------------------------------

update public.feature_flags
set enabled = false, updated_at = now()
where key = 'geofence_attendance';

insert into public.feature_flags(key, name, description, enabled)
select 'geofence_attendance',
       'Chan cham cong ngoai dia diem cho phep (GPS)',
       'Bat thi check-in tren HRM phai co toa do GPS hop le trong ban kinh dia diem.',
       false
where not exists (
  select 1 from public.feature_flags where key = 'geofence_attendance'
);

-- Xem lai ket qua.
select key, enabled from public.feature_flags where key = 'geofence_attendance';
