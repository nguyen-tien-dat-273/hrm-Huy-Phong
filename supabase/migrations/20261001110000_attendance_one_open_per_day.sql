-- ============================================================================
-- Moi nguoi moi ngay chi duoc MOT ban ghi cham cong dang mo.
-- ----------------------------------------------------------------------------
-- `handleCheckIn` o trang nhan vien chen thang mot dong `attendance` moi,
-- khong he kiem tra xem hom nay da co dong nao dang mo chua. Giao dien co che
-- nut Check-in khi da cham, nhung do la che theo TRANG THAI TREN MAN - mo hai
-- tab, dung hai may, hoac mat mang roi bam lai la ra hai dong cung ngay.
--
-- Hau qua: check-out chi dong duoc MOT dong, dong con lai ket o trang thai
-- `active` vinh vien. No hien thanh "quen check-out" trong bang cong, va
-- nguoi lao dong khong co cach nao tu sua.
--
-- Chi khoa dong DANG MO (`status = 'active'`). Khong dung toi cac dong da
-- hoan tat: mot ngay lam hai ca (sang, toi) la chuyen binh thuong, va engine
-- luong dem ngay cong bang `Set` theo ngay nen khong bi nhan doi.
--
-- Ban ghi trung da co tu truoc: KHONG tu dong don. Gop hai dong cham cong la
-- sua du lieu goc cua tien luong - viec do phai co nguoi nhin va quyet dinh.
-- Migration bao ra danh sach roi dung lai.
-- ============================================================================

do $$
declare
  v_dup record;
  v_count integer := 0;
begin
  for v_dup in
    select user_id, date, count(*) as so_dong
    from public.attendance
    where status = 'active'
    group by user_id, date
    having count(*) > 1
    order by date desc
  loop
    v_count := v_count + 1;
    raise notice 'Trung: user_id=% ngay=% co % dong dang mo',
      v_dup.user_id, v_dup.date, v_dup.so_dong;
  end loop;

  if v_count > 0 then
    raise exception
      'Co % ngay dang co nhieu hon mot ban ghi cham cong MO. Xem danh sach o tren, giu lai dong dung roi xoa dong thua, sau do chay lai migration nay.',
      v_count;
  end if;
end $$;

create unique index if not exists attendance_one_open_per_user_day
  on public.attendance(user_id, date)
  where status = 'active';

comment on index public.attendance_one_open_per_user_day is
  'Moi nguoi moi ngay chi mot ban ghi cham cong dang mo. Dong da hoan tat khong bi khoa - mot ngay hai ca la hop le.';
