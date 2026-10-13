-- ============================================================================
-- Bo sung danh muc khoan luong con thieu so voi Dac ta phan he Luong (muc 1).
-- ----------------------------------------------------------------------------
-- Doi chieu 21 dau muc cua tai lieu voi danh muc dang co (38 khoan):
--
--   DA CO     Luong doanh thu, Luong phep, Luong lam them gio, Luong KPI,
--             Trach nhiem, Phu cap, An trua, Xang xe, Thuong, Tam ung, Phat,
--             Tru 1% nhap quy.
--
--   ENGINE    Luong thoi gian, Luong nghi le, BHXH, BHYT, BHTN, Thue TNCN.
--   TU SINH   Sau khoan nay KHONG khai o danh muc: engine dung ra tu cham cong
--             va tham so (xem `computeBaseLines` va khoi bao hiem/thue trong
--             `lib/payroll.ts`). Them chung vao danh muc roi gan cho ai la
--             TRU HAI LAN - phieu luong co ca dong engine sinh lan dong khoan
--             gan, khong co gi chan.
--
--   THIEU     Ba khoan duoi day.
--
-- Khai thuan la LIET KE: khong formula, khong calc_type dac biet, khong muc
-- tien. Moi cach tinh khai o Co che luong theo tung nguoi.
--
-- Chay lai duoc nhieu lan.
-- ============================================================================

insert into public.payroll_components
  (code, name, kind, calc_type, default_amount, taxable, insurable, sort_order,
   group_name, is_active, is_system, note)
values
  -- Dac ta muc 1 dong 1. La CAN CU tinh don gia gio OT va muc dong bao hiem,
  -- nen phai co mot khoan mang co LUONG GOC. Khong co thi HOURLY_RATE,
  -- DAILY_RATE va BASE_WORK deu bang 0, moi cong thuc OT ra 0d ma khong bao loi.
  ('LUONG_CO_BAN', 'Lương cơ bản / Bậc lương', 'EARNING', 'FIXED',
   0, true, true, 10, 'Lương cơ bản', true, false,
   'Mức lương theo bậc hoặc chức danh, làm cơ sở tính các khoản lương khác. '
   'Khai mức riêng cho từng người ở Cơ chế lương.'),

  -- Dac ta muc 1 dong 12.
  ('PHU_CAP_KHAC', 'Phụ cấp khác', 'EARNING', 'FIXED',
   0, true, false, 148, 'Phụ cấp', true, false,
   'Các khoản phụ cấp khác theo chính sách công ty.'),

  -- Dac ta muc 1 dong 21. Luu y Dieu 127 BLLD 2019 cam phat tien thay cho xu
  -- ly ky luat lao dong - khoan nay chi dung khi co can cu trong noi quy da
  -- dang ky.
  ('PHAT_DI_MUON', 'Phạt đi muộn quá số lần', 'DEDUCTION', 'FIXED',
   0, false, false, 820, 'Trợ cấp/Khác', true, false,
   'Khoản phạt khi vượt số lần đi muộn theo quy định. Engine cấp sẵn biến '
   'LATE_COUNT và LATE_AFTER_CUTOFF để viết công thức ở Cơ chế lương. '
   'Lưu ý Điều 127 BLLĐ 2019 cấm phạt tiền thay cho xử lý kỷ luật.')
on conflict (code) do nothing;

-- Dat LUONG GOC cho khoan luong co ban, CHI KHI chua khoan nao giu co do.
--
-- `payroll_components` co unique index chan hai khoan cung la luong goc, nen
-- dat vo dieu kien se lam migration do o moi moi truong da khai tay. Dieu kien
-- `not exists` cho phep chay lai nhieu lan va khong de len lua chon cua nguoi
-- dung.
update public.payroll_components
   set is_base = true
 where code = 'LUONG_CO_BAN'
   and not exists (select 1 from public.payroll_components where is_base);
