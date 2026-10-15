-- ============================================================================
-- M06 · F06.01 — Căn danh mục chuẩn theo tài liệu DMKL (Danh mục khoản lương).
-- ----------------------------------------------------------------------------
-- DMKL liệt kê 26 khoản với bốn cột: STT, Tên khoản lương, Tính chất, Mô tả /
-- Vai trò. Hai chỗ bản trước lệch DMKL:
--
--   1. TÊN và MÔ TẢ của nhiều khoản do người làm tự đặt ("Phụ cấp trách
--      nhiệm", "Thuế TNCN lũy tiến", mô tả kèm công thức…). Nay lấy đúng chữ
--      của DMKL.
--   2. TÍNH CHẤT: DMKL có khoản "Biến đổi / Cố định" (khoản 19) và khoản 23
--      Tạm ứng là Cố định. Thêm giá trị BOTH cho cột `nature`.
--
-- Cờ thuế / bảo hiểm, mã, nhóm, loại khoản và thứ tự tính KHÔNG đổi: DMKL
-- không nói gì về chúng, và engine đang dựa vào chúng.
--
-- Khoản đã có trong danh mục chỉ được đổi tên / mô tả / tính chất khi giá trị
-- hiện tại còn NGUYÊN như lúc gieo — ai đã sửa tay thì giữ lựa chọn của họ.
-- Chạy lại được nhiều lần.
-- ============================================================================

alter table public.payroll_components drop constraint if exists payroll_components_nature_check;
alter table public.payroll_components
  add constraint payroll_components_nature_check
  check (nature is null or nature in ('FIXED', 'VARIABLE', 'BOTH'));

comment on column public.payroll_components.nature is
  'Tính chất: FIXED = cố định, VARIABLE = biến đổi, BOTH = có thể cả hai (DMKL khoản 19).';

-- Chụp bản chuẩn CŨ trước khi thay hàm, để nhận ra dòng chưa ai sửa.
drop table if exists _old_std;
create temp table _old_std as
select s.code, s.name, s.note, s.nature from public.payroll_standard_catalog() s;

create or replace function public.payroll_standard_catalog()
returns table (
  std_no integer,
  code text,
  name text,
  category_code text,
  kind text,
  nature text,
  calc_source text,
  taxable boolean,
  insurable boolean,
  is_base boolean,
  sort_order integer,
  note text
)
language sql
stable
as $$
  select * from (values
    (1,  'LUONG_CO_BAN', 'Lương cơ bản / Bậc lương', 'THU_NHAP_CO_DINH', 'EARNING', 'FIXED', 'ASSIGNED', true, true, true, 10,
         'Mức lương theo hợp đồng/chức danh làm cơ sở tính các khoản lương thời gian.'),
    (2,  'ALLOW_RESPONSIBILITY', 'Trách nhiệm', 'THU_NHAP_CO_DINH', 'EARNING', 'FIXED', 'ASSIGNED', true, true, false, 111,
         'Phụ cấp chức vụ hoặc tiền trách nhiệm công việc.'),
    (3,  'PHU_CAP_KHAC', 'Phụ cấp / Trợ cấp khác', 'THU_NHAP_CO_DINH', 'EARNING', 'FIXED', 'ASSIGNED', true, false, false, 148,
         'Các khoản phụ cấp cố định theo chính sách công ty (ăn trưa, xăng xe, điện thoại...).'),
    (4,  'BASE_WORK', 'Lương thời gian', 'THU_NHAP_BIEN_DOI', 'EARNING', 'VARIABLE', 'ENGINE', true, true, false, 20,
         'Tiền lương tính theo ngày công thực tế làm việc.'),
    (5,  'BASE_LEAVE', 'Lương phép', 'THU_NHAP_BIEN_DOI', 'EARNING', 'VARIABLE', 'ENGINE', true, true, false, 21,
         'Tiền lương cho những ngày nghỉ phép năm được hưởng lương.'),
    (6,  'BASE_HOLIDAY', 'Lương nghỉ lễ', 'THU_NHAP_BIEN_DOI', 'EARNING', 'VARIABLE', 'ENGINE', true, true, false, 22,
         'Tiền lương cho các ngày nghỉ lễ, Tết theo quy định nhà nước.'),
    (7,  'LUONG_KPI', 'Lương KPI', 'THU_NHAP_BIEN_DOI', 'EARNING', 'VARIABLE', 'ASSIGNED', true, false, false, 200,
         'Khoản thu nhập tính theo kết quả đánh giá KPI thực tế.'),
    (8,  'LUONG_DOANH_SO', 'Lương doanh thu (Lương DT)', 'THU_NHAP_BIEN_DOI', 'EARNING', 'VARIABLE', 'ASSIGNED', true, false, false, 115,
         'Khoản thu nhập hoa hồng tính theo doanh số/doanh thu thực tế.'),
    (9,  'LUONG_DT_CAT_LO', 'Lương doanh thu sau cắt lô (>40% / nhà hàng có PG)', 'THU_NHAP_BIEN_DOI', 'EARNING', 'VARIABLE', 'ASSIGNED', true, false, false, 116,
         'Khoản hoa hồng tính trên doanh số sau khi đã trừ cắt lô (>40% / nhà hàng có PG).'),
    (10, 'LUONG_VAN_CHUYEN', 'Lương vận chuyển', 'THU_NHAP_BIEN_DOI', 'EARNING', 'VARIABLE', 'ASSIGNED', true, false, false, 110,
         'Tiền trả cho đội vận chuyển dựa trên sản lượng (chai, bịch, soạn hàng, gửi xe).'),
    (11, 'PC_CONG_TAC_TINH', 'Phụ cấp công tác tỉnh', 'THU_NHAP_BIEN_DOI', 'EARNING', 'VARIABLE', 'ASSIGNED', true, false, false, 142,
         'Khoản hỗ trợ chi trả cho nhân sự đi thị trường/tỉnh theo ngày thực tế.'),
    (12, 'OT_WEEKDAY', 'Lương OT ngày thường', 'LAM_THEM_GIO', 'EARNING', 'VARIABLE', 'ASSIGNED', true, false, false, 210,
         'Tiền làm thêm giờ vào ngày thường (Hệ số 150%).'),
    (13, 'OT_WEEKEND', 'Lương OT Chủ nhật / Ngày nghỉ', 'LAM_THEM_GIO', 'EARNING', 'VARIABLE', 'ASSIGNED', true, false, false, 220,
         'Tiền làm thêm giờ vào ngày nghỉ hằng tuần/Chủ nhật (Hệ số 200%).'),
    (14, 'OT_HOLIDAY', 'Lương OT Ngày lễ', 'LAM_THEM_GIO', 'EARNING', 'VARIABLE', 'ASSIGNED', true, false, false, 230,
         'Tiền làm thêm giờ vào các ngày Lễ, Tết (Hệ số 300%).'),
    (15, 'CONG_THEM_DEM', 'Lương làm thêm ca đêm', 'LAM_THEM_GIO', 'EARNING', 'VARIABLE', 'ASSIGNED', true, false, false, 240,
         'Tiền phụ cấp/lương cho thời gian làm việc sau 22h.'),
    (16, 'THUONG_DI_SOM', 'Thưởng đi sớm', 'THUONG_PHAT_SINH', 'EARNING', 'VARIABLE', 'ASSIGNED', true, false, false, 300,
         'Thưởng chuyên cần cho nhân sự đi làm sớm/đúng giờ.'),
    (17, 'THUONG_CTKM', 'Thưởng CTKM / Mở mới', 'THUONG_PHAT_SINH', 'EARNING', 'VARIABLE', 'ASSIGNED', true, false, false, 301,
         'Thưởng chương trình khuyến mại hoặc mở điểm bán mới (Khối KD).'),
    (18, 'THUONG_DOANH_SO_VUOT', 'Thưởng doanh số 150%', 'THUONG_PHAT_SINH', 'EARNING', 'VARIABLE', 'ASSIGNED', true, false, false, 302,
         'Thưởng khi hoàn thành vượt mức 150% chỉ tiêu doanh số.'),
    (19, 'THUONG_THANG', 'Thưởng khác / Bổ sung lương', 'THUONG_PHAT_SINH', 'EARNING', 'BOTH', 'ASSIGNED', true, false, false, 303,
         'Các khoản thưởng đột xuất, bổ sung lương hoặc bù lương phát sinh trong kỳ.'),
    (20, 'INS_EMPLOYEE', 'BHXH, BHYT, BHTN', 'KHAU_TRU_PHAT', 'DEDUCTION', 'VARIABLE', 'ENGINE', false, false, false, 600,
         'Các khoản bảo hiểm bắt buộc do người lao động đóng (8%, 1.5%, 1%).'),
    (21, 'PIT', 'Thuế TNCN', 'KHAU_TRU_PHAT', 'DEDUCTION', 'VARIABLE', 'ENGINE', false, false, false, 601,
         'Thuế thu nhập cá nhân tính theo biểu thuế lũy tiến 7 bậc.'),
    (22, 'QUY_CONG_DOAN', 'Trừ 1% nhập quỹ', 'KHAU_TRU_PHAT', 'DEDUCTION', 'VARIABLE', 'ASSIGNED', false, false, false, 900,
         'Quỹ nội bộ trích theo quy định riêng của Huy Phong.'),
    (23, 'ADVANCE', 'Tạm ứng', 'KHAU_TRU_PHAT', 'DEDUCTION', 'FIXED', 'ASSIGNED', false, false, false, 620,
         'Trừ số tiền nhân viên đã ứng trước trong kỳ.'),
    (24, 'PHAT_DI_MUON_VE_SOM', 'Phạt đi muộn / Về sớm', 'KHAU_TRU_PHAT', 'DEDUCTION', 'VARIABLE', 'ASSIGNED', false, false, false, 810,
         'Khấu trừ do vi phạm giờ giấc qua máy chấm công.'),
    (25, 'PHAT_BAO_CAO', 'Phạt không thực hiện kế hoạch / Báo cáo', 'KHAU_TRU_PHAT', 'DEDUCTION', 'VARIABLE', 'ASSIGNED', false, false, false, 815,
         'Khấu trừ do lỗi không làm báo cáo ngày hoặc không hoàn thành kế hoạch.'),
    (26, 'PHAT_DI_MUON', 'Phạt đi muộn quá số lần', 'KHAU_TRU_PHAT', 'DEDUCTION', 'VARIABLE', 'ASSIGNED', false, false, false, 820,
         'Khoản phạt bổ sung khi số lần đi muộn vượt ngưỡng quy chế.')
  ) as t(std_no, code, name, category_code, kind, nature, calc_source, taxable, insurable, is_base, sort_order, note);
$$;

grant execute on function public.payroll_standard_catalog() to authenticated;

-- Đưa các khoản đã gieo (và chưa ai sửa) về đúng chữ DMKL.
update public.payroll_components c
set name = n.name
from _old_std o
join public.payroll_standard_catalog() n on n.code = o.code
where c.code = o.code and c.name = o.name and o.name <> n.name
  and not exists (
    select 1 from public.payroll_components x
    where lower(x.name) = lower(n.name) and x.id <> c.id
  );

update public.payroll_components c
set note = n.note
from _old_std o
join public.payroll_standard_catalog() n on n.code = o.code
where c.code = o.code and c.note is not distinct from o.note and o.note is distinct from n.note;

update public.payroll_components c
set nature = n.nature
from _old_std o
join public.payroll_standard_catalog() n on n.code = o.code
where c.code = o.code and c.nature = o.nature and o.nature <> n.nature;
