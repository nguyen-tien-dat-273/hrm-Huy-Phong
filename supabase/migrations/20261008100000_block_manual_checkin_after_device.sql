-- ============================================================================
-- Quet o may cham cong roi thi khong check-in tren HRM duoc nua.
-- ----------------------------------------------------------------------------
-- Quy tac nghiep vu: may van tay/khuon mat la nguon duy nhat ghi GIO VAO.
-- HRM chi dung de ghi GIO RA, va de check-in cho truong hop ngoai le (quen
-- quet, lam ngoai van phong).
--
-- Vi sao phai chan o tang database chu khong chi an nut: chi so duy nhat
-- attendance_one_open_per_user_day chi ap cho `status = 'active'`, ma ngay cong
-- tu may vao voi `status = 'completed'` (quet mot lan la du cong ngay do). Nen
-- khong co gi ngan mot nguoi da quet may lai bam check-in tren HRM va sinh ra
-- DONG THU HAI cung ngay. Hai dong cung ngay thi bang cong dem doi, bang luong
-- cong doi - sai am tham, khong lỗi nao hien ra.
--
-- Trigger nay chan dung mot chieu: them dong KHONG phai DEVICE khi ngay do da
-- co dong DEVICE. Chieu nguoc lai van cho, vi ham nap su kien cua bridge tu
-- cap nhat vao dong GPS da co san chu khong them dong moi.
--
-- Chay lai nhieu lan duoc.
-- ============================================================================

create or replace function public.guard_manual_checkin_after_device()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if coalesce(new.check_in_method, '') = 'DEVICE' then
    return new;
  end if;

  if exists (
    select 1 from public.attendance a
    where a.user_id = new.user_id
      and a.date = new.date
      and a.check_in_method = 'DEVICE'
      and a.id is distinct from new.id
  ) then
    raise exception
      'Ngày % đã có giờ vào từ máy chấm công. Không cần check-in lại trên HRM; chỉ cần bấm Check-out khi về.',
      to_char(new.date, 'DD/MM/YYYY')
      using errcode = '23505';
  end if;

  return new;
end;
$$;

drop trigger if exists attendance_block_manual_after_device on public.attendance;
create trigger attendance_block_manual_after_device
before insert on public.attendance
for each row execute function public.guard_manual_checkin_after_device();

comment on function public.guard_manual_checkin_after_device() is
  'Chan tao ngay cong thu hai bang tay khi ngay do da co gio vao tu may cham cong.';
