# Kịch bản test tháng 10/2026: Bảng công → KPI → Lương

Đi trọn một tháng lương cho 10 người lấy từ bảng lương tháng 08/2026 (file *BANG LUONG GUI HRM*, sheet BL01 / BL 02) và bảng lương BHXH 2026. Số mong đợi dưới đây đã chạy qua bộ tính lương thật với cơ chế do file công cụ tạo ra.

**Thứ tự:** Bảng công → KPI → Lương. Lương đọc tỷ lệ KPI khi khoá sổ KPI, nên KPI phải xong trước khi tính lương.

---

## 0. Chuẩn bị (làm một lần)

| # | Việc | Ở đâu |
|---|---|---|
| 0.1 | Chạy migration `20261029100000_m06_scheme_templates` nếu chưa chạy | Supabase › SQL Editor |
| 0.2 | Tạo đơn nghỉ phép **1 ngày 06/10/2026** cho **Nguyễn Thị Mùi** và duyệt xong | Nghỉ phép |
| 0.3 | Dán nguyên file `supabase/paste-cong-cu-thang-10.sql` rồi Run **một lần** | Supabase › SQL Editor |
| 0.4 | Đặt **Đơn giá phạt mỗi lần đi muộn / về sớm = 5.000** (mặc định là 0) | Thiết lập lương › Thông số chung |

Sau bước 0.3, kiểm tra hai bảng kết quả ở cuối SQL Editor:

- `ky_luong_con = 0`, `phieu_kpi_con = 0`, kỳ công trống hoặc OPEN.
- Mọi người đang làm có **24,5 công** (22 ngày thường + 5 thứ 7 nửa ngày). Riêng Mùi có **23,5 công** vì nghỉ phép ngày 06/10.
- NOTICE "Bỏ qua: …" liệt kê những tên trong Excel không có trong hệ thống. Những người đó không test được.

**Đạt:** __ **Ghi chú:** ____________________

---

## 1. Bảng công

| # | Việc | Kết quả mong đợi | Đạt? |
|---|---|---|---|
| 1.1 | Mở Bảng công tháng 10, xem Phạm Phi Hùng | Đủ ngày từ 01–31/10, CN để trống, thứ 7 nửa ngày, tổng 24,5 công | |
| 1.2 | Xem Nguyễn Thị Mùi | Ngày 06/10 là ngày phép, không có giờ vào/ra; tổng 23,5 công + 1 phép | |
| 1.3 | Sửa giờ vào của **Lưu Thị Vượng** 5 ngày (VD: 05, 07, 12, 14, 19/10) thành **08:15** | Mỗi ngày đó hiện đi muộn; tổng 5 lần đi muộn | |
| 1.4 | Khoá kỳ công tháng 10 | Kỳ chuyển Đã khoá; Bảng lương không cho sửa công tháng 10 | |

> 1.3: nếu ca làm việc có phút ân hạn thì giờ vào phải muộn hơn giờ vào ca cộng phút ân hạn.

---

## 2. KPI

| # | Việc | Kết quả mong đợi | Đạt? |
|---|---|---|---|
| 2.1 | Mở kỳ KPI tháng 10 | Mỗi người có bộ KPI sinh ra một phiếu | |
| 2.2 | Chấm phiếu cho các người ở mục 3 cho ra **tỷ lệ KPI đề xuất** (cột "KPI" ở bảng 3.1) → quản lý duyệt → Ban Giám đốc duyệt | Phiếu chuyển Đã duyệt | |
| 2.3 | Nhập chỉ tiêu và kết quả kinh doanh tháng 10 cho Hòa, Tùng, Trang, Tảo theo bảng 3.2 (doanh số khoán, doanh số thu tiền) | Đã lưu, Ban Giám đốc duyệt khoán | |
| 2.4 | Khoá sổ KPI tháng 10 | Bảng lương tháng 10 có **Tỷ lệ KPI** của từng người (ô khoá, không gõ tay được). Nếu đã liên kết, doanh số khoán và doanh số thu tiền cũng tự sang | |

Không cần chấm trúng đúng tỷ lệ đề xuất. Nếu tỷ lệ ra khác, tính lại thực lĩnh mong đợi bằng cột **"Mỗi 1% KPI"** ở bảng 3.1. Cột này đúng khi người đó không phải nộp thuế, tức cả 10 người trừ biến thể T8c.

---

## 3. Lương

### 3.1 Số liệu tháng nhập ở Bảng lương

Nhập ở các ô "theo tháng" của từng người. Ô tự điền từ KPI / Bảng công thì không gõ tay được: ô đó trống nghĩa là liên kết chưa có, báo lại.

| Mã | Người (bảng) | KPI | Số liệu tháng cần nhập |
|---|---|---|---|
| T1 | Phạm Phi Hùng (BL 01) | 100% | Lương vận chuyển = 2.683.100 |
| T2 | Nguyễn Thị Mùi (BL 01) | 90% | — |
| T3 | Lưu Thị Vượng (BL 01) | 102% | — (5 lần đi muộn lấy từ Bảng công) |
| T4 | Bùi Thị Nhân Huệ (BL 01) | 100% | — |
| T5 | Phạm Thị Thùy Dương (BL 01) | 100% | Lương doanh số = 756.802 |
| T6 | Mai Cẩm Tú (BL 01, PG) | — | Lương doanh số = 510.000 |
| T7 | Vũ Thị Hòa (BL 02) | 48% | xem 3.2 |
| T8 | Lương Xuân Tùng (BL 02) | 38% | xem 3.2 |
| T9 | Hà Thị Thu Trang (BL 02) | 45% | xem 3.2 |
| T10 | Nguyễn Minh Tảo (BL 02) | 40% | xem 3.2 |

### 3.2 Số kinh doanh (BL 02)

Doanh số khoán và doanh số thu tiền lấy từ Chỉ tiêu KD nếu đã liên kết, không thì nhập tay. Doanh số cắt mã và doanh số thu cắt lô luôn nhập ở Bảng lương.

| Mã | Doanh số thu tiền | Doanh số khoán | Doanh số cắt mã | Doanh số thu cắt lô |
|---|---|---|---|---|
| T7 Hòa | 54.281.319 | 300.000.000 | 0 | 171.424.800 |
| T8 Tùng | 175.066.960 | 250.000.000 | 5.500.000 | 19.810.000 |
| T9 Trang | 146.205.000 | — | — | — |
| T10 Tảo | 16.807.000 | 250.000.000 | 0 | 171.088.000 |

### 3.3 Kết quả mong đợi (bấm Tính lương)

| Mã | Người | Dòng cần thấy | Thực lĩnh | Mỗi 1% KPI | Đạt? |
|---|---|---|---|---|---|
| T1 | Phạm Phi Hùng | Lương thời gian 8.000.000; Phụ cấp khác 1.225.000 (24,5 công × 50.000); Trách nhiệm 3.000.000; Lương vận chuyển 2.683.100; BH 840.000; Quỹ 1% 106.831; Miễn thuế 1.700.000 | **13.961.000** | 30.000 | |
| T2 | Nguyễn Thị Mùi | Lương thời gian 7.673.469; Lương phép 326.531; Phụ cấp 500.000; Trách nhiệm 2.700.000; BH 840.000; Quỹ 76.735 | **10.283.000** | 30.000 | |
| T3 | Lưu Thị Vượng | Trách nhiệm 5.100.000 (5tr × 102%); Phạt đi muộn 25.000; BH 2.100.000 (lương đóng BH 20tr) | **12.875.000** | 50.000 | |
| T4 | Bùi Thị Nhân Huệ | Trách nhiệm 10.000.000 cố định (không theo KPI); Tổng cộng 20.000.000; Thu nhập tính thuế 200.000; Thuế 10.000; BH 2.100.000 | **17.790.000** | 0 | |
| T5 | Phạm Thị Thùy Dương | Lương doanh số 756.802; Quỹ 1% = (8.000.000 + 756.802) × 1% = 87.568; BH 787.500 | **10.882.000** | 30.000 | |
| T6 | Mai Cẩm Tú | Lương thời gian 5.000.000 (không vượt bậc lương dù đủ công); Phụ cấp 500.000; Quỹ 50.000 (1% bậc lương); Miễn thuế 500.000; BH 577.500 | **5.383.000** | 0 | |
| T7 | Vũ Thị Hòa | Tỷ lệ đạt 75,24%; Lương KPI 1.280.000; Lương doanh số 814.220 (bậc 1,5%); Cắt lô 1.714.248; không đóng BH | **11.703.000** | 26.667 | |
| T8 | Lương Xuân Tùng | Tỷ lệ đạt 77,95%; Lương KPI 1.013.333; Lương doanh số 2.681.004 (gồm cắt mã 55.000); Cắt lô 198.100; BH 630.000 | **11.154.000** | 26.667 | |
| T9 | Hà Thị Thu Trang | Lương KPI 2.250.000 (5tr × 45%); Lương doanh số 1.462.050 (1% doanh số thu); BH 1.575.000 | **12.022.000** | 50.000 | |
| T10 | Nguyễn Minh Tảo | Tỷ lệ đạt 75,16%; Cắt lô 1.710.880; Phụ cấp/trách nhiệm 500.000; BH 1.050.000 | **10.380.000** | 26.667 | |

**Biến thể kinh doanh.** Sửa số của Tùng ở Bảng lương rồi tính lại; xong thì trả về số ở 3.2.

| Mã | Đổi | Mong đợi |
|---|---|---|
| T8a | Doanh số thu = 100.000.000, cắt lô = 50.000.000 (đạt 60%) | Dưới 75%: cắt lô 0, lương doanh số chỉ còn 55.000 (cắt mã); thực lĩnh **8.358.000** |
| T8b | Doanh số thu = 50.000.000, cắt lô = 0 (đạt 20%) | Dưới 30%: lương thời gian còn 70% = 5.600.000; thực lĩnh **5.982.000** |
| T8c | Doanh số thu = 380.000.000, cắt lô = 0 (đạt 152%) | Thưởng doanh số vượt 4.000.000 (nửa bậc lương); lương doanh số 15.255.000 (bậc 4%); thuế 543.833; thực lĩnh **26.862.000** |

### 3.4 Khoá kỳ, duyệt, chi trả

| # | Việc | Kết quả mong đợi | Đạt? |
|---|---|---|---|
| 3.4.1 | Khoá kỳ lương tháng 10 (nhập mã xác thực) | Kỳ Đã khoá; không sửa được số liệu tháng, công, KPI tháng 10 | |
| 3.4.2 | Ban Giám đốc duyệt chi | Kỳ Đã duyệt | |
| 3.4.3 | Xác nhận đã chi trả | Phiếu lương phát hành; đăng nhập Hùng thấy phiếu tháng 10 thực lĩnh 13.961.000 | |

---

## 4. Vì sao khác Excel tháng 8

Số tháng 10 khác tháng 8 vì công chuẩn tháng 10 là 24,5, không phải 23,5. Người làm đủ công vẫn nhận đủ bậc lương; Hùng nhiều hơn 50.000 vì có thêm 1 công × 50.000 phụ cấp. Các điểm dưới đây cơ chế cố ý **không** làm theo Excel:

| Người | Excel | Cơ chế | Cần kế toán xác nhận |
|---|---|---|---|
| Bùi Thị Nhân Huệ, Lưu Vũ Phong | Cộng tay +30.000 vào thuế | Không cộng | Khoản 30.000 có thật không? |
| Hà Thị Thu Trang | Cộng tay +322.000 vào lương doanh số tháng 8 | Không cộng | Nếu có thì ghi vào Thưởng khác của tháng |
| Nguyễn Minh Tảo | Bản file ở thư mục gốc để cắt lô = 0; bản trong `HP HRM/Lương` tính 1% | Tính 1% vì đạt ≥ 75% (theo quy chế) | Bản nào đúng? |
| Phạm Phi Hùng | Lương tính làm thêm 10tr (sheet Thêm giờ VC) | Đã khai 10tr | — |
| Lê Văn Lợi | Tháng 8 tính thử việc nửa tháng | Lương đủ, thuế khấu trừ 10% trên tổng thu nhập, chưa có KPI | Đã chính thức chưa? Có KPI chưa? |
| Scarpello Maurizio | Lương cố định 25tr, doanh số × 3%, thuế 0 | Như Excel | Thuế 0 có đúng không? |
| Phong, Huệ, Nghĩa, Hoa | Excel luôn tính đủ công | Tính theo ngày chấm công thật (như Hùng) | Họ có chấm công không? |

Người có tên trong Excel nhưng không có số lương nên **không có cơ chế** (khai tay nếu cần): Nguyễn Thế Tùng, Nguyễn Mạnh Đạt, Lưu Thị Bích Ngọc, Nguyễn Hữu Hùng Anh, Trần Thị Thu Thảo, Phan Thị Thu Phương, Trần Việt Đức, Đỗ Thị Thùy Dương, Nguyễn Anh Phương, Đinh Đức Thái, Đỗ Hoàng Ngân.

---

## 5. Tháng 8 làm mẫu đã chốt

`supabase/paste-thang-8-hoan-thien.sql` dựng tháng 08/2026 thành một tháng đã xong: công + đơn phép + đơn làm thêm, phiếu KPI đã duyệt, số liệu tháng, phiếu lương 29 người, cả ba kỳ đã khoá, lương đã chi và phát hành. Chạy **sau** `paste-cong-cu-thang-10.sql`, vì file tháng 8 dời cơ chế chuẩn về áp dụng từ 08/2026.

| # | Kiểm tra | Mong đợi | Đạt? |
|---|---|---|---|
| 5.1 | Bảng lương tháng 8 | Kỳ Đã chi, 29 phiếu, tổng thực lĩnh 318.179.000; thực lĩnh từng người bằng cột Thực lĩnh của bảng lương đã chi | |
| 5.2 | Phạm Phi Hùng xem phiếu lương tháng 8 | Thực lĩnh 13.911.000 | |
| 5.3 | Bảng công tháng 8 | Kỳ Đã khoá; Hùng 23,5 công, Mùi 23 công + 0,5 phép, Vượng 5 lần đi muộn | |
| 5.4 | KPI tháng 8 | Kỳ Đã khoá; Vượng 102%, Hòa 48% | |
| 5.5 | Sửa công / số liệu tháng 8 | Bị chặn vì kỳ đã khoá | |

## 6. Chạy lại từ đầu

Run lại `supabase/paste-cong-cu-thang-10.sql`. File này xoá công / KPI / lương tháng 10, khai lại cơ chế chuẩn và đổ lại công. Đơn nghỉ phép giữ nguyên, nên Mùi vẫn có ngày phép 06/10. Muốn bỏ qua một bước thì tắt `chay.reset`, `chay.co_che` hoặc `chay.do_cong` ở đầu file.
