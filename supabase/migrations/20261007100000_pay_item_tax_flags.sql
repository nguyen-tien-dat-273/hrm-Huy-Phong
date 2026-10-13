-- ============================================================================
-- Chuyen ba co "chiu thue / tinh bao hiem / luong goc" ve TUNG NGUOI.
-- ----------------------------------------------------------------------------
-- Danh muc khoan luong chi con la DANH SACH: ten khoan, cong hay tru, ghi chu.
-- Moi thu quyet dinh ra tien deu khai o Co che luong cua tung nguoi, vi cung
-- mot khoan nhung moi nguoi mot muc va mot cach tinh.
--
-- NULL = chua khai rieng, engine lay theo khoan trong danh muc. Giu NULL chu
-- khong dat mac dinh cung: dat cung thi moi dong cu deu thanh "da khai", khong
-- con phan biet duoc nguoi nao that su duoc khai rieng.
--
-- Chay lai duoc nhieu lan.
-- ============================================================================

alter table public.employee_pay_items
  add column if not exists taxable boolean,
  add column if not exists insurable boolean,
  add column if not exists is_base boolean;

comment on column public.employee_pay_items.taxable is
  'Tinh vao thu nhap chiu thue TNCN cua rieng nguoi nay. NULL = theo danh muc.';
comment on column public.employee_pay_items.insurable is
  'Tinh vao luong dong bao hiem bat buoc cua rieng nguoi nay. NULL = theo danh muc.';
comment on column public.employee_pay_items.is_base is
  'Khoan nay la LUONG GOC cua rieng nguoi nay — can cu tinh don gia gio tang ca '
  'va muc dong bao hiem. NULL = theo danh muc. Moi nguoi chi mot khoan.';

-- Moi nguoi chi duoc MOT khoan luong goc.
--
-- Khong co rang buoc nay thi hai khoan cung bat is_base se cho ra don gia gio
-- khac nhau tuy dong nao doc truoc - sai tien tang ca mot cach khong lap lai
-- duoc, nen rat kho tim.
--
-- Chi dem cac dong CON HIEU LUC (effective_to is null): mot nguoi doi khoan
-- luong goc theo thoi gian la binh thuong, dong cu dong lai van phai giu.
create unique index if not exists employee_pay_item_one_base
  on public.employee_pay_items(user_id)
  where is_base and effective_to is null;
