-- Chia tieu chi KPI thanh PHAN, co tieu tong rieng.
--
-- Bay file KPI that cua cong ty (thu kho, phu kho, van chuyen, MKT, du an)
-- deu chia tieu chi lam hai phan co trong so rieng:
--
--   I   Phan danh gia dinh luong   0.88
--       1  Cong tac nhap hang      0.20
--       2  Cong tac xuat hang      0.20
--       ...
--   II  Phan danh gia dinh tinh    0.12
--       1  Chuyen can              0.12
--
-- He thong dang de tieu chi mot danh sach phang, nen phieu in ra thieu hai
-- dong nhom va thieu tieu tong - nguoi ky quen doc theo hai phan do se khong
-- doi chieu duoc voi ban giay cu.
--
-- Cot de RONG, khong bat buoc: bo KPI don gian khong chia phan thi van chay
-- y nhu truoc.
--
-- Chay lai duoc nhieu lan.

alter table public.kpi_template_criteria
  add column if not exists section text;

comment on column public.kpi_template_criteria.section is
  'Ten phan cua tieu chi, vi du "Danh gia dinh luong". NULL = khong chia phan.';

-- Thu tu phan lay theo sort_order cua tieu chi dau tien thuoc phan do, khong
-- them mot cot thu tu rieng: hai cot thu tu thi som muon cung lech nhau, va
-- khong co cach nao biet cot nao dung.
create index if not exists kpi_template_criteria_section_idx
  on public.kpi_template_criteria(template_id, section);
