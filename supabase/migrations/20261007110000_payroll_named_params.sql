-- ============================================================================
-- Tham so luong tu khai, dung duoc THANG trong cong thuc.
-- ----------------------------------------------------------------------------
-- Dac ta phan he Luong, muc 5:
--
--   Danh muc khoan luong + Tham so luong + Du lieu dau vao
--      -> Cong thuc tinh luong -> Ket qua
--
-- Truoc do chi `STANDARD_DAYS` (ngay cong chuan) vao duoc cong thuc. Cac tham
-- so con lai — he so OT, don gia van chuyen, he so doanh so, dinh muc KPI —
-- khong co duong nao tham chieu toi, nen nguoi khai phai go thang con so vao
-- tung cong thuc cua tung nguoi. Doi chinh sach la phai sua lai tay tung chO.
--
-- Bang nay cho khai tham so theo MA, roi dung ma do nhu mot bien trong cong
-- thuc o Co che luong. Dung bang chu khong phai them cot: dac ta UC-PAY-02 ghi
-- "Tuyet doi khong hard-code cac con so phap ly, noi bo trong code phan mem",
-- va NFR-MAINT-01 doi "thay doi tham so qua UI, 0% re-deploy" — them mot tham
-- so moi khong duoc phep can sua code.
--
-- Cac ty le bao hiem va thue van o `payroll_settings`: engine dung chung theo
-- nghia rieng (tran dong bao hiem, bieu thue luy tien), khong phai chi la mot
-- con so nhan vao cong thuc.
--
-- Chay lai duoc nhieu lan.
-- ============================================================================

create table if not exists public.payroll_named_params (
  id uuid primary key default gen_random_uuid(),
  -- Ma dung lam BIEN trong cong thuc, nen phai viet hoa khong dau.
  code text not null unique check (code ~ '^[A-Z][A-Z0-9_]*$'),
  name text not null,
  value numeric(15, 4) not null default 0,
  -- Chi de hien thi cho dung: 'VND', '%', 'HE_SO', 'NGAY', 'GIO'.
  unit text not null default 'VND',
  note text,
  sort_order integer not null default 100,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.payroll_named_params is
  'Tham so luong tu khai. Ma cua moi dong la mot bien dung duoc trong cong thuc '
  'o Co che luong. Xem muc 2 "Tham so luong" trong Dac ta phan he Luong.';

alter table public.payroll_named_params enable row level security;

-- Doc: moi nguoi dang nhap deu can, vi phieu luong cua ho tinh tu cac tham so
-- nay. Ghi: chi quan tri.
drop policy if exists payroll_named_params_read on public.payroll_named_params;
create policy payroll_named_params_read on public.payroll_named_params
  for select to authenticated using (true);

drop policy if exists payroll_named_params_write on public.payroll_named_params;
create policy payroll_named_params_write on public.payroll_named_params
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- --- Gieo cac tham so trong Dac ta muc 2 ------------------------------------
--
-- Gia tri he so OT lay tu Dieu 98 BLLD 2019 va muc 8 cua dac ta: 150% ngay
-- thuong, 200% ngay nghi hang tuan, 300% ngay le. Cac don gia rieng cua Huy
-- Phong de 0 — chua co so trong tai lieu, va de 0 thi cong thuc ra 0d, de
-- nhin ra la chua khai, hon la doan mot con so roi tra sai luong.
insert into public.payroll_named_params (code, name, value, unit, sort_order, note)
values
  ('HE_SO_OT_THUONG', 'He so OT ngay thuong', 1.5, 'HE_SO', 110,
   'Dieu 98 BLLD 2019: it nhat 150% don gia gio ngay lam viec binh thuong.'),
  ('HE_SO_OT_NGHI', 'He so OT ngay nghi hang tuan', 2.0, 'HE_SO', 120,
   'Dieu 98 BLLD 2019: it nhat 200%.'),
  ('HE_SO_OT_LE', 'He so OT ngay le, tet', 3.0, 'HE_SO', 130,
   'Dieu 98 BLLD 2019: it nhat 300%, chua ke tien luong ngay le huong nguyen.'),
  ('HE_SO_CA_DEM', 'He so cong them lam ban dem', 0.3, 'HE_SO', 140,
   'Dieu 98 BLLD 2019: cong them it nhat 30% don gia gio ban ngay.'),
  ('TY_LE_QUY_1PT', 'Ty le trich quy noi bo', 1.0, '%', 210,
   'Quy che Huy Phong: tru 1% nhap quy tren luong thoi gian cong luong doanh thu.'),
  ('DON_GIA_CHAI', 'Don gia van chuyen moi chai', 0, 'VND', 310,
   'Chua co so trong tai lieu — khai truoc khi dung trong cong thuc.'),
  ('DON_GIA_BICH', 'Don gia van chuyen moi bich', 0, 'VND', 320,
   'Chua co so trong tai lieu — khai truoc khi dung trong cong thuc.'),
  ('HE_SO_DOANH_SO', 'He so tinh luong doanh so', 0, 'HE_SO', 330,
   'Chua co so trong tai lieu — khai truoc khi dung trong cong thuc.'),
  ('DINH_MUC_KPI', 'Dinh muc KPI', 0, 'VND', 340,
   'Nguong hoac dinh muc dung trong cong thuc KPI.'),
  ('MUC_AN_TRUA', 'Muc tien an trua chuan', 0, 'VND', 350,
   'Dung khi chinh sach an trua cau hinh co dinh cho ca cong ty.')
on conflict (code) do nothing;
