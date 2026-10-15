# M06 — Kịch bản kiểm thử Lương & Đãi ngộ (UAT)

Kịch bản kiểm thử thủ công cho phân hệ lương theo mô hình **dựng lương bằng công thức**:
Danh mục đầu mục → Tham số theo bảng → Cơ chế lương (mỗi đầu mục một công thức) → áp cho
đơn vị / nhân sự → tính, khoá, duyệt, phát hành. Chạy sau khi đã chạy đủ sáu migration
`supabase/migrations/2026101[337]*_m06_*.sql`. Cách làm và quy tắc nghiệp vụ xem ở
[m06-luong-dai-ngo.md](m06-luong-dai-ngo.md).

> **Chạy trên staging hoặc bản sao database, không chạy trên dữ liệu thật.**
> Phần D khoá kỳ lương của tháng test. Việc khoá **không quay lại được**:
> - kỳ công tháng đó không mở lại được nữa;
> - phiếu KPI và số liệu lương tháng đó cũng bị đóng băng.
>
> Nếu buộc phải thử trên database thật, chỉ chạy phần 2, H, A, B, C và D01–D06 (dừng trước bước khoá).

---

## 1. Chuẩn bị

### 1.1 Tài khoản

| Ký hiệu | Vai trò | Chức năng cần giao |
|---|---|---|
| **KT** | Kế toán trưởng | `admin.payroll`, `admin.payroll_components`, `admin.payroll_settings`, `admin.payroll_schemes`, `admin.payroll_inputs`, `admin.payroll_adjustments`. **Không** giao `admin.payroll_approve`. |
| **BGD** | Ban Giám đốc | Chỉ giao `admin.payroll_approve` (Phê duyệt lương). |
| **NV1** | Nhân viên Phòng A (đơn vị con của Khối Văn phòng) | Không giao gì. |
| **NV2** | Nhân viên Khối Kinh doanh, **không** khai tài khoản ngân hàng | Không giao gì. |
| **NOQ** | Người dùng không có quyền lương | Không giao gì. |

- **Nơi giao chức năng:** *Cơ cấu tổ chức → Vị trí*, hoặc *Cấu hình hệ thống → Vai trò*.
- **KT** cần một app xác thực trên điện thoại (Google / Microsoft Authenticator).
- **Ca "tự duyệt"** (C14, D18) tạm giao `admin.payroll_approve` cho KT, rồi gỡ ngay sau ca.
  Sau mỗi lần đổi quyền, tải lại trang hoặc đăng nhập lại KT.
- Không dùng tài khoản Admin để đóng vai KT hoặc BGD. Admin ngầm định có mọi quyền, kể cả
  quyền duyệt, nên các ca phân quyền sẽ không còn ý nghĩa.
- Mỗi tài khoản đăng nhập trên một trình duyệt hoặc một cửa sổ ẩn danh riêng.

### 1.2 Dữ liệu

- **Tháng test** là **T**, ví dụ 11/2026. Kỳ lương T chưa có hoặc đang *Bản nháp*. Tháng
  kế tiếp gọi là **T+1**.
- **Cây tổ chức:** Khối Văn phòng → Phòng A, và Khối Kinh doanh.
- **Chấm công tháng T** của NV1 và NV2 đã nhập. Kỳ công T **chưa khoá**; phần D sẽ khoá.
- **Phiếu KPI tháng T**, nếu có, **chưa khoá**.
- **MFA TOTP** đã bật ở Supabase Dashboard → Authentication → Multi-Factor.
- **Nếu database có dữ liệu lương từ trước khi nâng cấp:** *trước khi chạy migration*, mở
  *Bảng lương* của tháng đang mở, bấm *Tính lương (bản nháp)* rồi xuất Excel. File này
  dùng ở phần H.

### 1.3 Ghi kết quả

- Chạy theo thứ tự 2 → H → A → B → C → D → E → F → G. Nhiều ca dùng dữ liệu do ca trước
  tạo ra.
- Cột **KQ** ghi `Đạt` hoặc `Lỗi`.
- Ca lỗi ghi vào bảng cuối file, kèm ảnh chụp màn hình và giờ chạy. Giờ chạy cần để đối
  chiếu Nhật ký hệ thống.

---

## 2. Kiểm tra ngay sau khi chạy migration

Chạy từng khối trong Supabase SQL Editor. Các câu dưới đây chỉ đọc dữ liệu.

```sql
-- 2.1 Có 6 nhóm hiển thị của danh mục
select code, name from public.payroll_component_categories order by sort_order;

-- 2.2 Không còn đầu mục "hệ thống tự tính", không đầu mục nào thiếu nhóm / tính chất
select count(*) filter (where calc_source = 'ENGINE') as tu_tinh,
       count(*) filter (where category_code is null or nature is null) as thieu
from public.payroll_components;

-- 2.3 Mỗi bộ tham số đã có các bảng tham số
select effective_from, label, jsonb_array_length(param_tables) as so_bang, net_rounding_unit
from public.payroll_param_versions order by effective_from;

-- 2.4 Các cơ chế lương và số dòng đang hiệu lực
select t.code, t.name, t.is_active, count(i.id) as so_dong
from public.payroll_templates t
left join public.payroll_template_items i on i.template_id = t.id and i.effective_to is null
group by t.code, t.name, t.is_active order by t.code;

-- 2.5 Có hai mẫu file ngân hàng
select code, name from public.payroll_bank_templates order by code;

-- 2.6 Kỳ đã chi trả từ trước có ngày phát hành, nên nhân viên vẫn xem được phiếu cũ
select count(*) from public.payroll_runs where status = 'PAID' and published_at is null;

-- 2.7 Đủ các trigger chặn chéo module
select tgname, tgrelid::regclass from pg_trigger
where tgname in ('payroll_runs_status_guard', 'timesheet_periods_payroll_lock',
                 'payroll_inputs_payroll_lock', 'performance_reviews_payroll_lock');

-- 2.8 Không còn chữ dẫn chiếu tài liệu đặc tả trong dữ liệu người dùng nhìn thấy
select 'dau muc' as o, code, note from public.payroll_components
 where note ~* '(BR-PAY|FR0?6\.|tài liệu|đặc tả|DMKL)'
union all
select 'co che', code, coalesce(description, '') from public.payroll_templates
 where coalesce(description, '') ~* '(BR-PAY|tài liệu|đặc tả)' or name ~ 'BL 0'
union all
select 'tham so', p ->> 'code', p ->> 'note'
  from public.payroll_param_versions v, jsonb_array_elements(v.param_tables) t,
       jsonb_array_elements(coalesce(t -> 'params', '[]'::jsonb)) p
 where coalesce(p ->> 'note', '') ~* '(BR-PAY|FR0?6\.|tài liệu|đặc tả|DMKL)';
```

| Mã | Kết quả mong đợi | KQ |
|---|---|---|
| S01 | 2.1 trả 6 dòng: Thu nhập cố định, Thu nhập biến đổi, Làm thêm giờ (OT & ca đêm), Thưởng phát sinh, Khấu trừ & phạt, Số liệu & dòng trung gian. | |
| S02 | 2.2 trả `0 | 0`. | |
| S03 | 2.3 có ít nhất dòng *Bộ tham số gốc* hiệu lực `2000-01-01`, `so_bang` từ 4 trở lên (Lương nền, Bảo hiểm, Thuế TNCN, Biểu thuế lũy tiến…). `net_rounding_unit = 1000`. | |
| S04 | 2.4 có `BL01` (Khối Văn phòng / Kho / Vận chuyển) và `BL02` (Khối Kinh doanh). Nếu database có dữ liệu lương từ trước: có thêm `CO_CHE_CHUNG` (Cơ chế chung) và các cơ chế đang dùng đều có dòng Lương thời gian, BHXH-BHYT-BHTN, Thuế TNCN. | |
| S05 | 2.5 có `BIDV` và `VIETINBANK`. | |
| S06 | 2.6 trả `0`. | |
| S07 | 2.7 trả 4 dòng. Nếu database không có bảng `performance_reviews` thì 3 dòng là đúng. | |
| S08 | 2.8 trả 0 dòng. | |
| S09 | Trên ứng dụng, menu *Lương & Đãi ngộ* của KT có 6 mục: Danh mục khoản lương, Tham số lương, Cơ chế lương, Số liệu lương tháng, Điều chỉnh lương, Bảng lương. Không còn mục *Công thức theo khối*. Menu của BGD có *Phê duyệt lương*. | |

---

## 3. Ca tính tay để đối chiếu

Ca này dùng ở C03, C11 và D06. Bảo hiểm và thuế ở đây **không phải hệ thống tự tính**: đó
là công thức của các dòng trong cơ chế (bộ gợi ý khối Văn phòng / Kinh doanh), đọc tham số
ở *Tham số lương*.

**Giả định:**
- NV1 có lương cơ bản **20.000.000**; lương đóng bảo hiểm = lương cơ bản.
- 0 người phụ thuộc, đi đủ công chuẩn.
- Không có dòng nào khác ra tiền.

**Bộ tham số giả định:**
- Tỷ lệ BHXH / BHYT / BHTN của người lao động là 8% / 1,5% / 1%.
- Giảm trừ bản thân **11.000.000**.
- Biểu thuế lũy tiến: tới 5 tr chịu 5%, từ 5 tr tới 10 tr chịu 10%.
- Làm tròn thực lĩnh tới 1.000.

| Dòng | Công thức (theo tên) | Số tiền |
|---|---|---|
| Đơn giá ngày | Lương cơ bản ÷ Công chuẩn của tháng | 20.000.000 ÷ công chuẩn |
| Lương thời gian | Đơn giá ngày × Ngày công thực tế | 20.000.000 |
| BHXH, BHYT, BHTN | Nhỏ nhất(Lương đóng BH; trần) × (8% + 1,5%) + Nhỏ nhất(Lương đóng BH; trần BHTN) × 1% | 2.100.000 |
| Thu nhập chịu thuế | Tổng các khoản cộng − phần làm thêm giờ được miễn | 20.000.000 |
| Thu nhập tính thuế | Lớn nhất(0; Thu nhập chịu thuế − BH − Giảm trừ bản thân − NPT × Giảm trừ NPT) | 6.900.000 |
| Thuế TNCN | Biểu thuế lũy tiến(Thu nhập tính thuế) = 5.000.000 × 5% + 1.900.000 × 10% | 440.000 |
| **Thực lĩnh** | Tự động: tổng dòng "+" trừ tổng dòng "−" | **17.460.000** |

**Biến thể có 1 người phụ thuộc:**
- Mức giảm trừ NPT 4.400.000: thuế còn 125.000, thực lĩnh **17.775.000**.
- Mức giảm trừ NPT 6.200.000: thuế còn 35.000, thực lĩnh **17.865.000**.

Bộ tham số thật khác giả định thì tính lại theo đúng các công thức trên. *Chạy thử* hiện
từng dòng với công thức đã thay số để đối chiếu.

---

## H. Dữ liệu cũ sau khi nâng cấp

Chỉ chạy nếu database có dữ liệu lương từ trước khi nâng cấp (xem 1.2).

| Mã | Bước | Kết quả mong đợi | KQ |
|---|---|---|---|
| H01 | Mở *Bảng lương* tháng đang mở, bấm *Tính lại*. So cột *Thực nhận* với file Excel xuất ở bước 1.2. | Từng người ra đúng số như trước khi nâng cấp. Lệch tối đa 1đ ở người có bảo hiểm (bảo hiểm nay làm tròn một lần cho cả ba khoản). | |
| H02 | *Cơ chế lương → Thiết kế cơ chế*, mở *Cơ chế chung*. | Có các dòng Lương cơ bản (Từng người), Đơn giá ngày, Đơn giá giờ, Lương thời gian / phép / lễ, Lương đóng bảo hiểm, Số người phụ thuộc, Thu nhập chịu thuế, Thu nhập tính thuế, BHXH-BHYT-BHTN, Thuế TNCN. Cơ chế này gán ở gốc cây tổ chức. | |
| H03 | Mở BL 01 / BL 02. | Ngoài các dòng cũ có thêm các dòng trên. Công thức hiện bằng **tên** (thẻ màu), không có thẻ đỏ. Dòng từng là "số liệu nhập tay" (Tạm ứng, Thưởng…) có cách lấy *Hằng tháng*. | |
| H04 | *Áp dụng cho nhân sự*, mở một người trước đây có người phụ thuộc / không đóng BH / thuế khoán / công chuẩn riêng. | Thiết lập cũ hiện thành *giá trị riêng* (Số người phụ thuộc, BHXH-BHYT-BHTN = 0…) hoặc *công thức riêng* (Thuế TNCN = Thu nhập chịu thuế × tỷ lệ; Đơn giá ngày = Lương cơ bản ÷ số ngày riêng). | |
| H05 | *Số liệu lương tháng*, tháng đang mở. | Số đã nhập dưới mã cũ (tiền tạm ứng, tiền thưởng…) hiện ở cột của đầu mục tương ứng. Tháng đã chốt giữ nguyên. | |
| H06 | Mở một đề xuất cơ chế đang chờ từ trước khi nâng cấp. | Mở được, các giá trị cũ (người phụ thuộc, mức đóng BH…) nằm trong phần giá trị riêng. Trình / duyệt được như thường. | |

---

## A. Danh mục khoản lương

Đăng nhập **KT**, vào *Danh mục khoản lương* (`/admin/payroll/components`).

| Mã | Bước | Kết quả mong đợi | KQ |
|---|---|---|---|
| A01 | Danh mục trống thì bấm *Khởi tạo danh mục chuẩn*. Đã có đầu mục thì bấm bổ sung đầu mục chuẩn còn thiếu, rồi xác nhận. | "Đã thêm N đầu mục chuẩn vào danh mục." Có đủ 26 đầu mục chuẩn. *Lương cơ bản / Bậc lương* có loại dòng **Chỉ để tính**. Đầu mục đã có từ trước giữ nguyên. | |
| A02 | Bổ sung thêm lần nữa. | Không còn gì để bổ sung. Không sinh đầu mục trùng. | |
| A03 | *Thêm mới*: tên "Phụ cấp xăng xe test", mã `TEST_XANG`, loại dòng *Cộng vào lương*, nhóm *Thu nhập cố định*, giá trị mặc định 500.000. Lưu. | "Đã lưu “Phụ cấp xăng xe test”." Đầu mục hiện đúng nhóm, có dấu "+". | |
| A04 | Thêm đầu mục khác cũng mã `TEST_XANG`. | Ô Mã đỏ "Mã khoản lương đã tồn tại trên hệ thống." Không lưu. | |
| A05 | Thêm đầu mục mã khác nhưng tên "phụ cấp xăng xe TEST" (khác hoa thường). | Ô Tên đỏ "Tên khoản lương đã tồn tại trên hệ thống." | |
| A06 | Nhập mã `test xang`. | "Mã viết hoa không dấu, bắt đầu bằng chữ, chỉ gồm chữ, số và "_"." | |
| A07 | Thêm "Số chuyến test" loại *Chỉ để tính*, đặt ở nhóm *Thu nhập cố định*. | Lưu được: nhóm chỉ để xếp danh mục, không ràng buộc loại dòng. | |
| A08 | Thêm đầu mục mã `WORK_DAYS`. | Bị chặn: mã trùng tên dữ liệu hệ thống. | |
| A09 | Mở *Lương thời gian* và *BHXH, BHYT, BHTN*. | Sửa được như mọi đầu mục (không còn khoản "hệ thống tự tính"). Mô tả không nhắc mã tài liệu đặc tả. Mục *Có trong cơ chế* liệt kê các cơ chế đang dùng. | |
| A10 | Tạo đầu mục `TEST_XOA` rồi xoá ngay. | "Đã xoá “…”." | |
| A11 | Tìm "xăng", lọc theo loại dòng / nhóm / trạng thái, sắp xếp, chuyển trang. | Danh sách lọc đúng. Phân trang không mất bộ lọc. | |
| A12 | Xuất Excel, CSV và In / PDF. | File mở được, tiếng Việt không lỗi font, cột khớp màn hình. | |
| A13 | Vào *Nhật ký hệ thống* (`/admin/audit`). | Có dòng tạo / sửa / xoá đầu mục của A03 và A10, đúng người, đúng giờ. | |
| A14 | Sửa đầu mục *BHXH, BHYT, BHTN*, mở ô *Nhãn báo cáo*. | Đang là "Bảo hiểm người lao động đóng". Danh sách hiện thẻ "Báo cáo: …" dưới tên đầu mục. *Thuế TNCN* mang "Thuế thu nhập cá nhân", *Thu nhập tính thuế* mang "Thu nhập tính thuế", *BH doanh nghiệp đóng* mang "Doanh nghiệp đóng thêm". | |
| A15 | Đổi *Nhãn báo cáo* của "Số chuyến test" (loại *Chỉ để tính*) sang "Thuế thu nhập cá nhân". Lưu. | Ô nhãn đỏ: nhãn này chỉ dùng với loại dòng "Trừ khỏi lương". Không lưu. Đổi sang "Thu nhập tính thuế" thì lưu được; gỡ nhãn thì lưu được. | |
| A16 | Chạy bảng lương tháng đang mở, rồi *Báo cáo nhân sự → Bảo hiểm & thuế* của tháng đó đã khoá và duyệt. | Cột BH người lao động, BH doanh nghiệp, Thuế TNCN và Thu nhập tính thuế bằng tổng các đầu mục mang nhãn tương ứng của mọi phiếu; đầu mục chưa gắn nhãn thì cột bằng 0. | |
| A17 | Đăng nhập một nhân viên đã có phiếu phát hành, mở *Phiếu lương của tôi*. | Không thấy dòng "BH doanh nghiệp đóng" (dòng mang nhãn "Doanh nghiệp đóng thêm"). Các dòng khác như cũ. | |

> Ca "xoá đầu mục đã dùng trong kỳ đã khoá" nằm ở E06.

---

## B. Tham số & thiết kế cơ chế

Đăng nhập **KT**.

### B1. Tham số lương (`/admin/payroll/params`)

| Mã | Bước | Kết quả mong đợi | KQ |
|---|---|---|---|
| B01 | Mở *Bộ tham số gốc*. | Bên trái là danh sách bảng: Lương nền, Bảo hiểm, Thuế TNCN, Biểu thuế lũy tiến (bảng bậc thang, *Lũy tiến từng phần*), các bảng tham số tự đặt (Làm thêm giờ, Phạt & khấu trừ…), bảng *Hoa hồng khoán doanh thu bậc thang* (*Tra bậc*). Mỗi tham số có Loại (Thời gian / Giá / Tỷ lệ / Số lượng) và Đơn vị; cột *Dùng ở* nói công thức nào đang dùng. | |
| B02 | *Tạo bộ mới từ bộ đang xem*, áp dụng từ tháng T. Đổi *Giảm trừ mỗi người phụ thuộc* sang 6.200.000. Lưu. | "Đã lưu bộ tham số lương." Có thêm bộ hiệu lực từ T. | |
| B03 | Tạo thêm một bộ áp dụng từ đúng tháng T. | "Đã có bộ tham số hiệu lực từ … — mở bộ đó để sửa." | |
| B04 | Trong bộ T: *Tạo bảng tham số* "Phụ cấp test". *Thêm tham số* tên "Đơn giá chuyến", loại *Giá*, đơn vị đ/lần, giá trị 37.000. | Mã tự tạo theo tên (`DON_GIA_CHUYEN`) khi tham số chưa được dùng. | |
| B05 | Đổi loại tham số vừa thêm sang *Tỷ lệ*. | Đơn vị chỉ còn % và hệ số. Tỷ lệ % đưa vào công thức là phần trăm thật (1,5% = 0,015). | |
| B06 | Thêm tham số tên "Work days". | Mã tự tránh tên dữ liệu tự động và tên đầu mục (thành `WORK_DAYS_2`), nên tham số không đè *Ngày công thực tế*. Database cũng chặn (G8). | |
| B07 | Nhập giá trị `abc` cho một tham số. | Báo giá trị phải là số. Không lưu được. | |
| B08 | *Tạo bảng bậc thang* "Thưởng test", cách tính *Tra bậc*. Thêm bậc 0 → 0 rồi một bậc có ngưỡng nhỏ hơn bậc trước. | "Ngưỡng các bậc phải tăng dần, không trùng nhau." | |
| B09 | Xoá tham số *Tỷ lệ BHXH người lao động*. | Hỏi xác nhận, nêu các dòng cơ chế đang dùng tham số này. Bấm huỷ. | |
| B10 | *Thiết lập chung → Kiểm tra mức sàn khi trình cơ chế*: chọn *Lương cơ bản / Bậc lương* ≥ *Lương tối thiểu vùng*. Lưu bộ T. | Lưu được. Dùng ở C05. | |
| B11 | Sửa một con số, **chưa lưu**, bấm *Chạy thử với bộ này*. | Hộp chạy thử dùng con số vừa sửa. Chưa có gì được ghi xuống. | |

### B2. Thiết kế cơ chế (`/admin/payroll/schemes`, tab *Thiết kế cơ chế*)

| Mã | Bước | Kết quả mong đợi | KQ |
|---|---|---|---|
| B12 | *Tạo cơ chế* tên "VP test", bắt đầu từ *Gợi ý khối Văn phòng*. | "Đã tạo cơ chế “VP test”." Có các dòng: Lương cơ bản (*Từng người*), Đơn giá ngày, Đơn giá giờ, Lương thời gian / phép / lễ, KPI, làm thêm giờ, Lương vận chuyển (*Hằng tháng*), bảo hiểm, quỹ 1%, Thu nhập chịu thuế, Thu nhập tính thuế, Thuế TNCN, Tạm ứng. Công thức hiện bằng tên, ví dụ "Đơn giá ngày × Ngày công thực tế". | |
| B13 | Mở một cơ chế đã có dòng, tìm nút gợi ý. | Chỉ cơ chế trống mới có nút *Gợi ý khối Văn phòng / Kinh doanh*. | |
| B14 | *Thêm đầu mục* → "Phụ cấp xăng xe test", cách lấy *Công thức*. Trong ô công thức gõ `luong co` → chọn *Lương cơ bản* (Enter); gõ `/`; gõ `cong chuan` → chọn; gõ `*`; gõ `ngay cong` → chọn. | Gợi ý hiện ngay khi gõ, không cần dấu, xếp theo nhóm (Đầu mục trong cơ chế, Tham số, Dữ liệu tự động, Bảng bậc thang, Hàm, Thêm từ danh mục). Các dấu `/` `*` thành ÷ ×. Dưới ô hiện công thức đã thay số và kết quả với dữ liệu thử. | |
| B15 | Gõ `lcb` và `co ban`. | Cả hai đều gợi ý *Lương cơ bản* lên đầu. | |
| B16 | Thêm `(` … mà không đóng ngoặc. | Báo "Thiếu dấu “)” đóng ngoặc." Thêm `)` thì hết lỗi. Đặt con trỏ cạnh một ngoặc thì ngoặc tương ứng được tô. | |
| B17 | Gõ `abc` rồi Space / Enter. | Thẻ đỏ "“abc” không khớp đầu mục, tham số hay dữ liệu nào — chọn từ gợi ý." Bấm *Lưu cơ chế* bị chặn: "Còn dòng chưa hợp lệ — sửa các dòng tô đỏ trước khi lưu." Xoá thẻ đỏ (Backspace hai lần). | |
| B18 | Cho dòng A dùng dòng B và dòng B dùng dòng A. | Cả hai dòng báo "Dòng này nằm trong một vòng lặp công thức." Sửa lại cho hết vòng. | |
| B19 | Trong công thức, chọn một đầu mục ở nhóm *Thêm từ danh mục*. | Đầu mục được thêm thành dòng mới của cơ chế. Thẻ của đầu mục chưa có trong cơ chế (nếu còn) hiện viền vàng, rê chuột thấy "chưa có trong cơ chế, tính bằng 0". | |
| B20 | Bấm *Dạng chữ*, sửa `× 2` thành `× 2,5`, chuyển lại. | Công thức nhận 2,5. Số thập phân như 0,015 giữ nguyên khi chuyển qua lại. | |
| B21 | Kéo thả đổi thứ tự hai dòng. | Thứ tự hiện trên phiếu đổi theo; kết quả không đổi (thứ tự tính theo phụ thuộc). Dòng cuối luôn là *Thực lĩnh — Tự động: tổng các dòng “+” trừ tổng các dòng “−”*. | |
| B22 | *Lưu cơ chế*, hiệu lực từ T. | Hỏi "Lưu cơ chế “VP test”?" → "Đã lưu cơ chế “VP test”, hiệu lực từ …". | |
| B23 | Đặt *Hiệu lực từ tháng* là một tháng đã chốt, lưu. | Bị chặn: kỳ lương đã chốt, thay đổi phải có hiệu lực từ tháng sau kỳ chốt. | |
| B24 | Mở BL 01, *Gán cho đơn vị* → Khối Văn phòng, từ T. | "Đã gán “…” cho Khối Văn phòng." Phòng A (đơn vị con) thừa hưởng BL 01. | |
| B25 | Gán BL 02 cho Khối Kinh doanh từ T. | Khối Kinh doanh và đơn vị con dùng BL 02. | |
| B26 | Từ **T+1**: gán BL 02 trực tiếp cho Phòng A; rồi bỏ cơ chế khỏi Phòng A; rồi gán lại BL 01 trực tiếp. | Sau bước 1: Phòng A dùng BL 02 (đơn vị gần nhất thắng). Sau bước 2: Phòng A lại thừa hưởng từ cấp trên. Sau bước 3: dùng BL 01. Tháng T không đổi. | |
| B27 | Xoá BL 01 (đang được gán). | Bị chặn: cơ chế đang / đã gán cho đơn vị hoặc nhân sự — tắt cơ chế thay vì xoá. | |
| B28 | Mở BL 02, *Chạy thử* với NV2: *Doanh số khoán* = 100.000.000, *Doanh số cắt mã* = 0, lần lượt *Doanh số* = 74 tr / 75 tr / 89,5 tr / 90 tr / 104,5 tr / 105 tr. | Lương doanh thu lần lượt 0 / 1.125.000 / 1.342.500 / 2.700.000 / 3.135.000 / 4.200.000, ứng với bậc 0% / 1,5% / 1,5% / 3% / 3% / 4%. Có bảng từng dòng: cách lấy, công thức đã thay số, kết quả. | |
| B29 | Ở bộ tham số T, đổi *Hệ số OT ngày thường* (ví dụ 1,5 → 2). Chạy thử NV1 với 10 giờ OT ngày thường. | Tiền OT đổi theo hệ số mới mà không phải sửa công thức. Kiểm xong thì trả hệ số về giá trị cũ. | |
| B30 | Mở *Bảng lương* tháng T sau khi chạy thử. | Không đổi gì vì chạy thử không ghi dữ liệu. | |

---

## C. Áp dụng cơ chế cho nhân sự

Đăng nhập **KT**, vào *Cơ chế lương → Áp dụng cho nhân sự*.

| Mã | Bước | Kết quả mong đợi | KQ |
|---|---|---|---|
| C01 | Mở rộng / thu gọn cây, chọn Khối Văn phòng rồi Phòng A. | Cây giống cây ở Cơ cấu tổ chức. Danh sách nhân sự có cột Cơ chế, Giá trị riêng (*Đủ x/y* hoặc *Thiếu*), Tình trạng. | |
| C02 | Chọn NV1, bấm *Thiết lập cơ chế lương*. | Có phần *Theo cơ chế* (cơ chế của đơn vị hoặc gán riêng), *Áp dụng từ tháng*, *Giá trị riêng* (dòng *Từng người* bắt buộc; dòng *Giá trị* hiện giá trị chung làm gợi ý), *Công thức riêng / dòng thêm riêng*, *Ước tính nếu đi đủ công*. Không còn mục thuế / bảo hiểm / người phụ thuộc riêng. | |
| C03 | Áp dụng từ T, Lương cơ bản 20.000.000, Số người phụ thuộc 0. Xem phần ước tính. | Ước tính khớp ca tính tay mục 3 (cộng thêm các dòng khác của BL 01 nếu có). | |
| C04 | Bấm *Lưu nháp*. | "Đã lưu nháp đề xuất." Chạy thử NV1 vẫn ra theo cơ chế **cũ** vì đề xuất chưa duyệt. | |
| C05 | Sửa Lương cơ bản thành 3.000.000, bấm *Lưu & trình BGĐ duyệt*. | Bị chặn: "Lương cơ bản / Bậc lương 3.000.000 thấp hơn Lương tối thiểu vùng …" (kiểm tra mức sàn khai ở B10). Lưu nháp vẫn được. | |
| C06 | Xoá trống Lương cơ bản, bấm trình. | "Còn thiếu: Lương cơ bản / Bậc lương." | |
| C07 | Chọn tháng áp dụng sớm hơn tháng chốt gần nhất (nếu đã có kỳ chốt). | "Tháng áp dụng sớm nhất là …". | |
| C08 | Lương cơ bản 20.000.000, Số người phụ thuộc 1, bấm *Lưu & trình BGĐ duyệt*. | "Đã trình BGĐ duyệt cơ chế lương của NV1." NV1 có nhãn *Đề xuất chờ duyệt*. Mở lại thì thấy đúng đề xuất đang chờ, các ô bị khoá. | |
| C09 | Đăng nhập **BGD**, mở *Phê duyệt lương*, mở đề xuất của NV1. | Có thông báo trình duyệt. Chỉ thấy phần **thay đổi** (thêm / bỏ / đổi giá trị hay công thức). | |
| C10 | BGD bấm *Từ chối* không ghi lý do, rồi từ chối có lý do "Kiểm tra lại người phụ thuộc". | Lần đầu: "Từ chối phải ghi rõ lý do." Lần sau: đề xuất *Bị từ chối*, KT nhận thông báo kèm lý do. KT sửa rồi trình lại được. | |
| C11 | BGD *Ký duyệt* với mật khẩu sai, rồi đúng. KT chạy thử NV1 tháng T, đi đủ công. | Lần sai báo lỗi. Lần đúng: cơ chế áp dụng từ T. Chạy thử ra như biến thể 1 người phụ thuộc ở mục 3 (theo mức giảm trừ NPT của bộ tham số T). | |
| C12 | Cho NV2: khai *Công thức riêng* cho dòng *Thuế TNCN* = "Thu nhập chịu thuế × 10%". Xem ước tính. | Thuế trong ước tính đổi theo công thức riêng (thuế khoán 10%). Trình, BGD duyệt. | |
| C13 | Cho NV1: thêm *dòng thêm riêng* "Phụ cấp xăng xe test" (không có trong BL 01) giá trị 300.000. Trình, BGD duyệt. | Sau duyệt, phiếu NV1 có dòng này. | |
| C14 | KT trình một đề xuất hợp lệ cho NV2, tạm giao `admin.payroll_approve` cho KT rồi tự ký duyệt. Gỡ quyền tạm ngay sau đó. | "Người trình không tự duyệt đề xuất của mình." Đề xuất vẫn chờ. BGD duyệt sau đó. | |
| C15 | Lập đề xuất mới cho NV1 áp dụng từ T+1, Lương cơ bản 22.000.000. BGD duyệt. Chạy thử NV1 tháng T và T+1. | T+1 dùng 22.000.000, tháng T vẫn 20.000.000. | |
| C16 | Lập một đề xuất nháp rồi bấm *Huỷ đề xuất*. | "Đã huỷ đề xuất." | |
| C17 | Khai *Giá trị chung của đơn vị* cho Khối Văn phòng: *Phụ cấp / Trợ cấp khác* 400.000. Trình, BGD duyệt. | Người ở Phòng A thừa hưởng giá trị này (trừ ai khai riêng). | |
| C18 | Khai *Tài khoản nhận lương* cho NV1. Không khai cho NV2. | "Đã lưu tài khoản nhận lương." | |

---

## D. Tính lương, khoá kỳ, duyệt chi, phát hành

Làm D01–D12 bằng **KT**.

| Mã | Bước | Kết quả mong đợi | KQ |
|---|---|---|---|
| D01 | Vào *Số liệu lương tháng* (`/admin/payroll/inputs`), tháng T. | Mỗi cột là một dòng *Hằng tháng* trong cơ chế của mọi người, ví dụ Doanh số, Doanh số khoán (BL 02), Lương vận chuyển, Thưởng, Tạm ứng. Ô của người không có dòng đó bị mờ. Ô chưa nhập để trống. | |
| D02 | Nhập Doanh số / Doanh số khoán cho NV2 rồi lưu. | "Đã lưu N ô số liệu." | |
| D03 | Vào *Điều chỉnh lương*, thêm cho NV1 nhưng để trống lý do. | "Ghi lý do điều chỉnh — bắt buộc, để rà soát về sau." | |
| D04 | Thêm điều chỉnh với số tiền 0. | "Nhập số tiền lớn hơn 0." | |
| D05 | Thêm cho NV1: *Điều chỉnh tăng (+)* 500.000 "Bù thiếu tháng trước"; *Giảm (−)* 200.000 "Thu tạm ứng". | Lưu được, hiện đúng dấu + / −. Không còn ô "chịu thuế". | |
| D06 | *Bảng lương* (`/admin/payroll`), tháng T, bấm *Tính lương (bản nháp)*. | "Đã tính N phiếu lương nháp tháng T." Mỗi đầu mục cộng / trừ là một cột; bật *Hiện dòng chỉ để tính* thì thấy cả Đơn giá ngày, Thu nhập tính thuế…; sau cùng là Tổng cộng, Tổng trừ, Thực nhận. Phiếu NV1 có Lương thời gian theo ngày công thật, dòng BHXH-BHYT-BHTN, các dòng ở C13/C17 và hai điều chỉnh; thuế tính lại theo mục 3. Mọi thực lĩnh chia hết cho 1.000; phần chênh nằm ở cột *Làm tròn*, không quá 500đ. | |
| D07 | Xem khung *Kiểm tra trước khi khoá kỳ*. | Mục kỳ công tháng đã khoá màu đỏ. Nút *Khoá kỳ & trình BGĐ (2FA)* bị mờ. | |
| D08 | Sửa một ô ở *Số liệu lương tháng* của NV2, quay lại Bảng lương. | Mục "Bộ phiếu đã tính khớp số liệu hiện tại" đỏ: "1 phiếu đã đổi — bấm Tính lại". | |
| D09 | Bấm *Tính lại*. | Mục đó xanh lại. Số của NV2 đổi theo. | |
| D10 | Khoá kỳ công tháng T ở *Bảng công tháng*, khoá phiếu KPI tháng T. Quay lại Bảng lương. | Hai mục bắt buộc xanh. Nút khoá bấm được. Mục cảnh báo vàng không chặn. | |
| D11 | Bấm *Khoá kỳ & trình BGĐ (2FA)*. Lần đầu quét mã QR. Nhập **sai** mã 6 số. | Báo mã không hợp lệ. Kỳ chưa khoá. | |
| D12 | Nhập **đúng** mã OTP. | "Đã khoá kỳ lương T và trình Ban Giám đốc." Trạng thái *Đã khoá · chờ BGĐ*. Nút *Tính lại* biến mất. | |
| D13 | KT bấm *Rút lại để sửa*, để trống lý do. | "Rút lại phải ghi lý do." | |
| D14 | Rút lại với lý do "Sửa số liệu NV2". | "Đã rút kỳ lương về để sửa." Trạng thái về *Đã tính*, có dải đỏ ghi lý do. | |
| D15 | Khoá lại theo D12. | Về *Đã khoá · chờ BGĐ*. BGD nhận thông báo. | |
| D16 | **BGD** mở kỳ T ở *Phê duyệt lương*, *Từ chối* có lý do. | "Đã từ chối — kỳ trả về Kế toán." Kỳ về *Đã tính*. | |
| D17 | KT khoá lại. BGD mở kỳ, đối chiếu Số phiếu, Tổng các khoản cộng, Tổng các khoản trừ, Tổng thực chi với *Bảng lương*. | Các tổng khớp đúng. | |
| D18 | Tạm giao `admin.payroll_approve` cho KT, KT ký duyệt chi kỳ T mà chính KT đã khoá. Gỡ quyền tạm ngay sau đó. | "Người khoá kỳ không tự duyệt chi." | |
| D19 | BGD *Ký duyệt chi*, mật khẩu sai rồi đúng. | Lần sai báo lỗi. Lần đúng: "Đã duyệt chi bảng lương T." | |
| D20 | KT xem các nút trên Bảng lương; bấm *Bút toán kết chuyển*. | Có *File chi lương ngân hàng* và *Xác nhận đã chi trả & phát hành phiếu*. File bút toán có Nợ 642 / Có 334 cho tổng các khoản cộng và **mỗi đầu mục trừ một bút toán** Nợ 334 / Có 338 mang tên đầu mục. | |
| D21 | *File chi lương ngân hàng*: VietinBank rồi BIDV. | Có NV1, **không** có NV2, kèm cảnh báo "1 người chưa khai tài khoản nhận lương nên KHÔNG có trong file". Tổng tiền bằng tổng thực lĩnh của những người có trong file. | |
| D22 | **NV1** vào *Lương của tôi*, tháng T (chưa phát hành). | "Bảng lương tháng T đang được hoàn tất". Không có số tiền nào. | |
| D23 | KT bấm *Xác nhận đã chi trả & phát hành phiếu*. | "Đã xác nhận chi trả và phát hành N phiếu lương." | |
| D24 | NV1 mở thông báo phiếu lương. | Mở đúng *Lương của tôi*. | |
| D25 | NV1 *Xác thực để xem phiếu*, mật khẩu sai. | Báo lỗi, không hiện phiếu. | |
| D26 | NV1 nhập đúng mật khẩu. | Hiện phiếu tháng T: phần Các khoản cộng, Các khoản trừ (và Thông tin nếu có). Số khớp dòng NV1 trên Bảng lương. | |
| D27 | *In / Lưu PDF*, rồi *Ẩn phiếu*. | Bản in đủ các dòng. Ẩn xong phải xác thực lại. | |
| D28 | Để quá 15 phút rồi mở lại phiếu. | Phải nhập lại mật khẩu. | |
| D29 | NV2 xem tháng T. | Chỉ thấy phiếu của chính NV2. | |

---

## E. Sau khi khoá kỳ

Kỳ T đã ở *Đã chi trả & phát hành*.

| Mã | Bước | Kết quả mong đợi | KQ |
|---|---|---|---|
| E01 | KT mở *Bảng lương* tháng T. | Không còn *Tính lại* hay *Rút lại*. Dải xanh hướng dẫn xử lý sai sót bằng *Điều chỉnh lương* của kỳ sau. | |
| E02 | Thêm điều chỉnh vào tháng T. | "Kỳ lương tháng T đã khoá — ghi điều chỉnh vào kỳ chưa khoá." | |
| E03 | Thêm điều chỉnh vào **T+1**, *Kỳ phát sinh* = T, có lý do. | Lưu được. | |
| E04 | *Số liệu lương tháng* tháng T. | Các ô bị khoá, có dải xanh giải thích. | |
| E05 | *Bảng công tháng* tháng T. | Không có nút mở lại kỳ. Có nhãn "Kỳ lương đã khoá — không mở lại kỳ công". | |
| E06 | Xoá đầu mục `TEST_XANG` (đã lên phiếu kỳ T). | "“…” đã phát sinh trong kỳ lương đã chốt — không xoá, đã chuyển Khóa." | |
| E07 | *Tham số lương*: sửa hoặc xoá bộ hiệu lực từ T. | Bị chặn vì bộ đã dùng cho kỳ lương đã chốt; gợi ý tạo bộ mới từ T+1. | |
| E08 | Tạo bộ tham số mới hiệu lực từ T. | "Kỳ lương tháng T đã chốt — bộ tham số mới phải có hiệu lực từ tháng T+1 trở đi." | |
| E09 | *Thiết kế cơ chế*: lưu BL 01 hiệu lực từ T. *Áp dụng cho nhân sự*: lập đề xuất từ T. | Cả hai đều chỉ cho từ T+1. | |
| E10 | Sửa hoặc mở khoá một phiếu KPI tháng T. | "Kỳ lương tháng T đã khoá — dữ liệu của tháng này không sửa được nữa." (không kèm mã tài liệu). | |
| E11 | *Nhật ký hệ thống*. | Có đủ: lưu cơ chế, nạp gợi ý, gán cơ chế, tính, khoá, rút lại, từ chối, duyệt, xuất file ngân hàng, chi trả — đúng người, đúng giờ. | |

---

## F. Phân quyền

| Mã | Bước | Kết quả mong đợi | KQ |
|---|---|---|---|
| F01 | **NOQ** gõ thẳng: `/admin/payroll`, `/admin/payroll/components`, `/params`, `/formulas`, `/schemes`, `/inputs`, `/adjustments`, `/approvals`. | Đều bị chặn (`/formulas` chuyển sang `/schemes` rồi bị chặn). Menu không có nhóm Lương & Đãi ngộ. | |
| F02 | **KT** mở `/admin/payroll/approvals`. | Bị chặn. Menu không hiện *Phê duyệt lương*. | |
| F03 | Người chỉ có `admin.payroll_schemes` (không có `admin.payroll_settings`) mở *Cơ chế lương*. | Vào được, chỉ có phần *Áp dụng cho nhân sự* (không có tab *Thiết kế cơ chế*). Gọi thẳng RPC lưu cơ chế bị database chặn. | |
| F04 | **BGD** mở *Danh mục khoản lương* và *Cơ chế lương*. | Không vào được, hoặc chỉ xem mà không sửa được. | |
| F05 | **NV1** xem menu. | Chỉ có *Lương của tôi*. | |
| F06 | Gỡ `admin.payroll_components` khỏi KT, rồi KT thử lưu một đầu mục. | Báo không có quyền. Xong thì trả lại quyền. | |

---

## G. Chặn ở tầng database (SQL Editor, staging)

Phần này kiểm rằng database tự chặn, kể cả khi gọi thẳng mà không qua giao diện.

- Mỗi khối có `begin … rollback`. Lệnh bị chặn đúng thì báo lỗi; lỡ không bị chặn thì
  `rollback` cũng huỷ thay đổi.
- Thay `'2026-11-01'` bằng ngày đầu tháng T.
- Thay `<ID_NV1>` bằng id của NV1 (`select id, name from public.profiles where name ilike '%…%';`).

```sql
-- G1. Không đổi thẳng trạng thái kỳ lương
begin;
update public.payroll_runs set status = 'DRAFT' where month_start = '2026-11-01';
rollback;

-- G2. Không sửa phiếu lương của kỳ đã khoá
begin;
update public.payslips set net_pay = net_pay + 1
where run_id = (select id from public.payroll_runs where month_start = '2026-11-01');
rollback;

-- G3. Không mở lại kỳ công của tháng đã khoá lương
begin;
update public.timesheet_periods set status = 'OPEN' where month_start = '2026-11-01';
rollback;

-- G4. Không thêm số liệu lương vào tháng đã khoá
begin;
insert into public.payroll_inputs (user_id, month_start, code, quantity)
values ('<ID_NV1>', '2026-11-01', 'TEST_CODE', 1);
rollback;

-- G5. Nhân viên CHƯA xác thực lại thì không đọc được phiếu, kể cả phiếu của mình
begin;
select set_config('request.jwt.claims',
  json_build_object('sub', '<ID_NV1>', 'role', 'authenticated')::text, true);
set local role authenticated;
select user_id, count(*) from public.payslips group by user_id;
rollback;

-- G6. Nhân viên vừa xác thực lại thì chỉ đọc được phiếu của mình, và chỉ ở kỳ đã phát hành
begin;
select set_config('request.jwt.claims', json_build_object(
  'sub', '<ID_NV1>', 'role', 'authenticated',
  'amr', json_build_array(json_build_object('method', 'password',
         'timestamp', extract(epoch from now())::bigint)))::text, true);
set local role authenticated;
select p.user_id, r.month_start, r.status
from public.payslips p join public.payroll_runs r on r.id = p.run_id;
rollback;

-- G7. Không ghi thẳng dòng cơ chế (chỉ qua RPC lưu cơ chế)
begin;
select set_config('request.jwt.claims',
  json_build_object('sub', '<ID_NV1>', 'role', 'authenticated')::text, true);
set local role authenticated;
delete from public.payroll_template_items;
rollback;

-- G8. Bộ tham số không nhận tham số trùng tên dữ liệu tự động
begin;
update public.payroll_param_versions
set param_tables = jsonb_set(param_tables, '{0,params,0,code}', '"WORK_DAYS"')
where effective_from = (select max(effective_from) from public.payroll_param_versions);
rollback;
```

| Mã | Kết quả mong đợi | KQ |
|---|---|---|
| G1 | Lỗi "Trạng thái kỳ lương chỉ đổi qua đúng thao tác (Tính lương, Khoá kỳ, Duyệt, Chi trả)." | |
| G2 | Lỗi "Kỳ lương đã khoá — phiếu lương không sửa được." | |
| G3 | Lỗi "Kỳ lương tháng 11/2026 đã khoá — không mở lại kỳ công được." | |
| G4 | Lỗi "Kỳ lương tháng 11/2026 đã khoá — dữ liệu của tháng này không sửa được nữa." | |
| G5 | Trả **0 dòng**. | |
| G6 | Mọi dòng đều là của NV1 và đều có `status = 'PAID'`. | |
| G7 | Lỗi không có quyền (permission denied). | |
| G8 | Lỗi "Mã "WORK_DAYS" trùng tên dữ liệu hệ thống — đặt tên khác." (hoặc lỗi bộ tham số đã dùng cho kỳ đã chốt nếu bộ mới nhất đã khoá). | |

---

## Tổng kết

| Phần | Số ca | Đạt | Lỗi | Ghi chú |
|---|---:|---:|---:|---|
| 2. Sau migration | 9 | | | |
| H. Dữ liệu cũ sau nâng cấp | 6 | | | Chỉ khi có dữ liệu cũ |
| A. Danh mục khoản lương | 17 | | | |
| B. Tham số & thiết kế cơ chế | 30 | | | |
| C. Áp dụng cơ chế cho nhân sự | 18 | | | |
| D. Tính → khoá → duyệt → phát hành | 29 | | | |
| E. Sau khi khoá kỳ | 11 | | | |
| F. Phân quyền | 6 | | | |
| G. Chặn ở database | 8 | | | |
| **Cộng** | **134** | | | |

### Danh sách lỗi

| # | Mã ca | Tài khoản | Giờ chạy | Mô tả (thấy gì / mong đợi gì) | Ảnh |
|---|---|---|---|---|---|
| 1 | | | | | |
