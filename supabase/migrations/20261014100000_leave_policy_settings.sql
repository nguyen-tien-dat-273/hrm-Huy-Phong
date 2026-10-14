-- ============================================================================
-- Chinh sach phep nam: thang tham nien va phep ton chuyen sang nam sau.
-- ----------------------------------------------------------------------------
-- Han muc phep dang la mot con so HR go tay cho tung nguoi. Hai cho sai am tham:
--
--   Dieu 114 BLLD 2019 - "Cu du 05 nam lam viec cho mot nguoi su dung lao dong
--   thi so ngay nghi hang nam... duoc tang them tuong ung 01 ngay." Go tay
--   nghia la moi moc 5 nam cua moi nguoi, HR quen la nguoi do bi cap thieu.
--
--   Dieu 113 khoan 2 - nguoi lam CHUA DU 12 THANG thi tinh theo ty le so thang
--   lam viec. Cap tron 12 ngay cho nguoi vao thang 11 la cap du.
--
-- Cac con so deu de CAU HINH chu khong khoa cung: 12 ngay la SAN cua luat,
-- cong ty duoc cho cao hon; con tran phep ton va han dung la thoa thuan noi bo
-- (Dieu 113 cho phep thoa thuan nghi gop), khong phai luat dinh.
--
-- Chay lai duoc nhieu lan.
-- ============================================================================

alter table public.app_settings
  -- Cu du bao nhieu nam tham nien thi cong them. Dieu 114: 5 nam.
  add column if not exists leave_seniority_step_years integer not null default 5
    check (leave_seniority_step_years > 0),
  -- Moi moc tham nien cong them may ngay. Dieu 114: 1 ngay.
  add column if not exists leave_seniority_step_days numeric(5, 2) not null default 1
    check (leave_seniority_step_days >= 0),
  -- Tran so ngay phep ton duoc chuyen sang nam sau. 0 = khong cho chuyen.
  add column if not exists leave_carry_over_max numeric(5, 2) not null default 0
    check (leave_carry_over_max >= 0),
  -- Phep chuyen sang phai dung xong truoc ngay nay cua nam sau, dang MM-DD.
  -- NULL = khong dat han.
  add column if not exists leave_carry_over_deadline text
    check (leave_carry_over_deadline is null
           or leave_carry_over_deadline ~ '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$');

comment on column public.app_settings.leave_seniority_step_years is
  'Cu du bao nhieu nam lam viec thi cong them ngay phep. Dieu 114 BLLD 2019: 5 nam.';
comment on column public.app_settings.leave_seniority_step_days is
  'Moi moc tham nien cong them may ngay phep. Dieu 114 BLLD 2019: 1 ngay.';
comment on column public.app_settings.leave_carry_over_max is
  'Tran so ngay phep ton chuyen sang nam sau. 0 = khong cho chuyen. '
  'Day la thoa thuan noi bo, khong phai luat dinh.';
comment on column public.app_settings.leave_carry_over_deadline is
  'Han dung het phep chuyen sang, dang MM-DD cua nam sau. NULL = khong dat han.';

-- Mac dinh de 0 ngay chuyen sang CO CHU DICH: bat san viec chuyen phep la doi
-- so du cua moi nguoi ma khong ai yeu cau. HR bat len khi cong ty da chot
-- chinh sach.
