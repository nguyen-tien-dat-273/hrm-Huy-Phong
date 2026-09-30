-- ============================================================================
-- Khai danh muc khoan luong theo dung cong thuc Huy Phong.
-- ----------------------------------------------------------------------------
--   Tong luong  = luong thoi gian + luong doanh so / van chuyen + luong phep
--                 + luong nghi le + luong lam them + phu cap + thuong - phat
--   Thuc linh   = tong luong - thue TNCN - BHXH - phi cong doan
--
-- Ba khoan luong goc (thoi gian, phep, nghi le) do ENGINE sinh san tu cham
-- cong, khong khai o day. Phan con lai la danh muc, moi khoan mot dong.
--
-- MUC_RIENG = so tien gan cho chinh khoan do o Co che luong cua tung nguoi
-- (don gia chuyen, muc phu cap/ngay...). Nho no ma mot khoan dung chung cho
-- ca cong ty van ra con so rieng cua tung nguoi.
--
-- Cac ma viet HOA la SO LIEU THANG, nhap o Bang luong > So lieu thang. Chua
-- nhap thi bang 0, khong phai loi.
--
-- Chay lai duoc nhieu lan: da co ma nao thi giu nguyen ma khong ghi de, de
-- khong xoa mat cac muc tien da chinh tay.
-- ============================================================================

insert into public.payroll_components
  (code, name, kind, calc_type, default_amount, input_code, formula,
   taxable, insurable, prorate, sort_order, is_active, is_system, note)
values
  -- --- Luong theo san luong -------------------------------------------------
  ('LUONG_VAN_CHUYEN', 'Luong van chuyen', 'EARNING', 'FORMULA',
   0, 'SO_CHUYEN', 'SO_CHUYEN * MUC_RIENG',
   true, false, false, 110, true, false,
   'So chuyen giao hang trong thang nhan don gia moi chuyen. Don gia khai o Co che luong tung nguoi.'),

  ('LUONG_DOANH_SO', 'Luong doanh so', 'EARNING', 'FORMULA',
   0, 'DOANH_SO', 'DOANH_SO * MUC_RIENG / 100',
   true, false, false, 115, true, false,
   'Doanh so thang nhan ty le phan tram. MUC_RIENG la ty le %, vi du 1.5 nghia la 1,5%.'),

  -- --- Lam them gio --------------------------------------------------------
  -- BASC luong / cong chuan / 8 = HOURLY_RATE. Moi ngay phat sinh tinh 2 gio.
  ('LUONG_OT_THUONG', 'Lam them gio ngay thuong', 'EARNING', 'FORMULA',
   0, 'OT_NGAY_THUONG', 'HOURLY_RATE * OT_NGAY_THUONG * 2',
   true, false, false, 120, true, false,
   'So ngay phat sinh don hang ngoai gio, moi ngay 2 gio, he so 1. Xem canh bao Dieu 98 BLLD trong tai lieu.'),

  ('LUONG_OT_LE', 'Lam them gio chu nhat / ngay le', 'EARNING', 'FORMULA',
   0, 'OT_NGAY_LE', 'HOURLY_RATE * OT_NGAY_LE * 2 * 2',
   true, false, false, 125, true, false,
   'Nhu tren nhung he so 2.'),

  ('CONG_THEM_DEM', 'Cong them lam sau 22h', 'EARNING', 'FORMULA',
   0, 'OT_NGAY_SAU_22H', 'DAILY_RATE * OT_NGAY_SAU_22H',
   true, false, false, 130, true, false,
   'Lam them den sau 22h duoc cong them 1 cong cho moi ngay nhu vay.'),

  -- --- Phu cap, ba kieu khac nhau theo nhom nhan su -------------------------
  ('PC_VAN_PHONG', 'Phu cap van phong', 'EARNING', 'FIXED',
   0, null, null,
   true, false, false, 140, true, false,
   'Muc co dinh moi thang. Gan cho nhan vien van phong.'),

  -- CO Y khong dung PER_DAY: PER_DAY nhan voi ngay cong HUONG LUONG (gom ca
  -- ngay phep va ngay le), con phu cap van chuyen tinh theo ngay DI LAM thuc
  -- te - nghi phep thi khong di duong nen khong phat sinh chi phi.
  ('PC_VAN_CHUYEN', 'Phu cap van chuyen theo ngay', 'EARNING', 'FORMULA',
   0, null, 'MUC_RIENG * WORK_DAYS',
   true, false, false, 141, true, false,
   'Muc phu cap moi ngay nhan so ngay DI LAM thuc te, khong tinh ngay phep va ngay le.'),

  ('PC_CONG_TAC_TINH', 'Phu cap cong tac theo tinh', 'EARNING', 'FORMULA',
   0, 'SO_TINH_CONG_TAC', 'MUC_RIENG * SO_TINH_CONG_TAC',
   true, false, false, 142, true, false,
   'Muc phu cap moi tinh nhan so tinh di cong tac co phat sinh doanh so.'),

  -- --- Thuong / phat -------------------------------------------------------
  ('THUONG_THANG', 'Thuong', 'EARNING', 'FORMULA',
   0, 'THUONG', 'THUONG',
   true, false, false, 150, true, false,
   'Nhap thang so tien thuong o So lieu thang.'),

  ('PHAT_THANG', 'Phat', 'DEDUCTION', 'FORMULA',
   0, 'PHAT', 'PHAT',
   false, false, false, 160, true, false,
   'Nhap thang so tien phat. Luu y Dieu 127 BLLD 2019 cam phat tien thay cho xu ly ky luat.'),

  -- --- Phi cong doan -------------------------------------------------------
  -- sort_order lon hon tat ca khoan tren: cong thuc chi doc duoc khoan da
  -- tinh xong truoc no.
  --
  -- Dung BASE_WORK chu khong dung BASE: BASE la tong ca ba dong luong goc
  -- (thoi gian + phep + nghi le), viet BASE se thu them 1% tren tien phep va
  -- tien le - khong dung cong thuc cong ty dang dung.
  ('PHI_CONG_DOAN', 'Phi cong doan', 'DEDUCTION', 'FORMULA',
   0, null, '(BASE_WORK + LUONG_VAN_CHUYEN + LUONG_DOANH_SO) * 0.01',
   false, false, false, 900, true, false,
   '1% tren luong thoi gian cong luong doanh so/van chuyen. Xem muc canh bao ve ten goi trong tai lieu.')

on conflict (code) do nothing;

-- Ghi chu ve cac ma so lieu thang de HR biet phai nhap gi moi ky.
comment on table public.payroll_components is
  'Danh muc khoan luong. So lieu thang can nhap: SO_CHUYEN, DOANH_SO, OT_NGAY_THUONG, OT_NGAY_LE, OT_NGAY_SAU_22H, SO_TINH_CONG_TAC, THUONG, PHAT.';
