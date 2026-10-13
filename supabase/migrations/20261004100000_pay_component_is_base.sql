-- Danh dau mot khoan trong danh muc la LUONG GOC.
--
-- Truoc day luong goc khong phai mot khoan, no la mot kieu khai rieng:
-- `employee_pay_profiles.pay_basis` (MONTHLY/HOURLY/DAILY/PIECE/COMMISSION)
-- cong voi `base_amount`. Nguoi dung phai hoc hai mo hinh cho cung mot thu:
-- luong goc khai mot kieu, moi khoan con lai khai mot kieu khac.
--
-- Co nay cho phep khai luong goc nhu moi khoan khac - chon trong danh muc,
-- dien cong thuc. Engine uu tien khoan duoc danh dau; khong co khoan nao
-- danh dau thi chay y nhu cu theo `pay_basis`.
--
-- KHONG doi luong cua ai khi chay migration nay: chua danh dau khoan nao thi
-- moi phieu tinh ra giong het hom qua.
--
-- Chay lai duoc nhieu lan.

alter table public.payroll_components
  add column if not exists is_base boolean not null default false;

comment on column public.payroll_components.is_base is
  'Khoan nay la LUONG GOC: engine lay no lam can cu suy don gia gio tang ca va muc dong bao hiem.';

-- Chi MOT khoan duoc lam luong goc.
--
-- Hai khoan cung danh dau thi engine phai chon mot - va dieu do quyet dinh
-- don gia tang ca lan muc dong bao hiem cua ca cong ty, khong duoc de no phu
-- thuoc thu tu tra ve cua mot cau truy van.
create unique index if not exists payroll_components_single_base_idx
  on public.payroll_components((true)) where is_base;
