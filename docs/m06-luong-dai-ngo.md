# M06 — Lương và Đãi ngộ

Tài liệu cho người phát triển: mô hình tính lương, chỗ nằm trong code, cách triển khai,
cách chuyển dữ liệu cũ, cách kiểm thử và những điểm nghiệp vụ còn phải chốt. Đặc tả gốc:
`Mo06 - Lương và đãi ngộ.docx`, `BR_PAY.docx`, `ENT liên quan.docx`, `Ycau giao dien.docx`.

## Mô hình: lương dựng bằng công thức

Hệ thống **không biết** đâu là bảo hiểm, đâu là thuế. Nó chỉ biết ba thứ:

- **Danh mục** (`payroll_components`) — danh sách đầu mục. Mỗi đầu mục có **loại dòng**:
  *Cộng vào lương* (`EARNING`), *Trừ khỏi lương* (`DEDUCTION`) hoặc *Chỉ để tính*
  (`INFO`, hiện trên phiếu ở phần Thông tin, không cộng trừ). Nhóm chỉ để xếp danh mục.
- **Tham số** (`payroll_param_versions.param_tables`) — người dùng tự tạo **bảng** (ví dụ
  "Bảo hiểm", "Phạt & khấu trừ") và thêm tham số vào. Mỗi tham số có loại và đơn vị:

  | Loại | Đơn vị |
  |---|---|
  | Thời gian | ngày, giờ, phút, tháng |
  | Giá | đ, đ/ngày, đ/giờ, đ/tháng, đ/lần, đ/sản phẩm |
  | Tỷ lệ | %, hệ số |
  | Số lượng | lần, người, chuyến, sản phẩm |

  Tham số `%` vào công thức là **phần trăm thật** (1,5% = 0,015). Bảng **bậc thang** gọi
  như một hàm trong công thức: *tra bậc* lấy mức của bậc chứa giá trị (hoa hồng), *lũy
  tiến từng phần* cộng dồn từng khoảng (biểu thuế). Bộ tham số có ngày hiệu lực, kèm công
  chuẩn dự phòng, cách làm tròn thực lĩnh và (không bắt buộc) kiểm tra mức sàn.
- **Cơ chế lương** (`payroll_templates` + `payroll_template_items`) — danh sách đầu mục,
  mỗi dòng một cách lấy giá trị (`mode`):

  | Cách lấy | Nghĩa |
  |---|---|
  | `FORMULA` Công thức | tính từ tham số, dữ liệu tự động và các dòng khác |
  | `VALUE` Giá trị | một con số chung; đơn vị / từng người khai riêng được |
  | `PER_PERSON` Từng người | bắt buộc khai cho từng người (ví dụ lương cơ bản) |
  | `MONTHLY_INPUT` Hằng tháng | nhập mỗi tháng ở *Số liệu lương tháng* |

Một dòng dùng được kết quả của dòng khác (đầu mục là biến); thứ tự tính theo **phụ thuộc**,
thứ tự kéo thả chỉ là thứ tự hiện trên phiếu. Vòng lặp bị phát hiện và báo đúng tên dòng.
`TONG_THU_NHAP` là tổng các dòng cộng (gồm cả điều chỉnh tăng). **Thực lĩnh = tổng dòng
cộng − tổng dòng trừ**, làm tròn theo bộ tham số.

**Dữ liệu tự động** (`lib/payrollVariables.ts`, `systemScope` trong `lib/payroll.ts`): ngày
công thực tế, ngày phép, ngày lễ, ngày hưởng lương, ngày nghỉ không lương, công chuẩn của
tháng (theo lịch làm việc), giờ làm, giờ chuẩn mỗi ngày, giờ OT ngày thường / nghỉ / lễ (từ
đơn OT đã duyệt), tỷ lệ KPI (từ phiếu KPI đã khoá), số lần / số phút đi muộn, về sớm. Tên
dành riêng ở client và database phải khớp nhau (`RESERVED_FORMULA_NAMES` ↔
`payroll_reserved_formula_names()`).

**Khai riêng** đè dòng của cơ chế theo lớp: người > đơn vị gần nhất trên cây > cơ chế >
giá trị mặc định của danh mục (`applyOverride`, `resolveMechanismRows` trong
`lib/payrollScheme.ts`). Giá trị riêng trên dòng công thức có đọc `MUC_RIENG` (mức riêng
của chính dòng — chỉ còn ở công thức chuyển từ dữ liệu cũ) thì giữ công thức; còn lại dòng
thành giá trị. Đầu mục không có trong cơ chế mà khai riêng thì thành dòng thêm ở cuối phiếu.

**Ô công thức** (`components/payroll/formula/FormulaInput.tsx`, `lib/formulaTokens.ts`):
công thức lưu bằng mã, người dùng thấy và gõ bằng tên dạng thẻ. Gợi ý ngay khi gõ, không
cần dấu, khớp đầu từ và chữ cái đầu ("lcb"), xếp theo nhóm. Enter / Tab chọn; Space chỉ
chốt khi chỉ còn một kết quả; `+ − × ÷ ( )` và `x`, `:`, `%` thành phép tính. Ngoặc tương
ứng được tô; lỗi chỉ đúng thẻ. "Dạng chữ" cho sửa cả công thức như văn bản rồi đọc lại.

## Nguyên tắc chung

- **Không có quy tắc lương nào nằm trong code.** Tỷ lệ bảo hiểm, biểu thuế, giảm trừ,
  lương tối thiểu vùng, hệ số OT, bậc hoa hồng, đơn giá, làm tròn đều là dữ liệu. Chỗ duy
  nhất có con số là dữ liệu **gợi ý** khi nạp lần đầu (danh mục 26 đầu mục chuẩn, bộ tham
  số gốc, bộ dòng gợi ý khối Văn phòng / Kinh doanh trong
  `payroll_mechanism_suggestions()`).
- **Cây tổ chức dùng đúng quy ước của dự án.** Cơ chế và giá trị chung của đơn vị đi xuống
  đơn vị con bằng `unitLineage` (`lib/kpiSchemeFor.ts`): đơn vị gần nhất thắng, tối đa 10
  cấp, có chặn vòng. Bản database tương ứng là `payroll_template_for`.
- **Database là chốt chặn cuối.** Mọi chuyển trạng thái và mọi lần ghi cơ chế đi qua RPC
  `security definer`; trigger chặn sửa dữ liệu của tháng đã khoá và ghi nhật ký kiểm toán.
- **Quyền theo chức năng** (`can_function()` / `hasAdminFunction()`): `admin.payroll_components`
  (danh mục), `admin.payroll_settings` (tham số, thiết kế cơ chế), `admin.payroll_schemes`
  (áp dụng cho nhân sự), `admin.payroll_inputs`, `admin.payroll_adjustments`,
  `admin.payroll`, `admin.payroll_approve` (Ban Giám đốc).
- **Giao diện không dẫn chiếu tài liệu đặc tả** (mã BR-PAY / FR06…), kể cả câu lỗi từ
  database và ghi chú gieo sẵn.

## Bản đồ tính năng → code

| Tính năng | Màn (route) | Code chính |
|---|---|---|
| Danh mục khoản lương | `/admin/payroll/components` | `components/payroll/ComponentCatalog.tsx` |
| Tham số lương | `/admin/payroll/params` | `PayrollParamsTab.tsx`, `lib/payrollSettings.ts`, `lib/payrollVariables.ts` |
| Thiết kế cơ chế + chạy thử | `/admin/payroll/schemes?tab=design` | `MechanismDesigner.tsx`, `formula/FormulaInput.tsx`, `lib/formulaTokens.ts`, `lib/formulaEntries.ts`, `PayrollDryRunModal.tsx`, `lib/payroll.ts` |
| Áp dụng cơ chế cho nhân sự | `/admin/payroll/schemes?tab=apply` | `PaySchemeTree.tsx`, `PaySchemeModal.tsx`, `lib/payrollScheme.ts` |
| Phê duyệt của BGĐ | `/admin/payroll/approvals` | `PayrollApprovals.tsx`, `ReauthDialog.tsx` |
| Số liệu tháng, điều chỉnh | `/admin/payroll/inputs`, `/admin/payroll/adjustments` | `MonthlyInputsTab.tsx`, `AdjustmentsTab.tsx` |
| Bảng lương: tính, khoá, chi, phát hành | `/admin/payroll` | `PayrollRegister.tsx`, `TwoFactorDialog.tsx`, `BankExportModal.tsx`, `lib/payrollRun.ts`, `lib/payrollJournal.ts` |
| Phiếu lương của tôi | `/staff/payroll` | `pages/staff/StaffPayroll.tsx`, `PayslipBreakdown.tsx` |

`/admin/payroll/formulas` (màn "Công thức theo khối" cũ) chuyển sang tab Thiết kế cơ chế.

`pages/admin/AdminPayroll.tsx` chỉ là khung: nạp dữ liệu tháng một lần
(`loadPayrollWorkspace`) rồi chia cho từng mục. Phiếu lương của **một** người trong **một**
tháng luôn tính qua `computeForPerson` (`lib/payrollRun.ts`); bảng lương, chạy thử, kết quả
thử ở màn thiết kế và ước tính khi khai riêng đều gọi hàm này.

Migration theo thứ tự: `20261013100000_m06_f0601_payroll_catalog`,
`20261013110000_m06_f0602_payroll_params_formulas`, `20261013120000_m06_f0603_payroll_scheme_approval`,
`20261013130000_m06_f0604_payroll_lock_publish`, `20261017100000_m06_f0601_catalog_dmkl`,
`20261017110000_m06_formula_mechanism` (mô hình công thức + chuyển dữ liệu cũ).

## Danh mục khoản lương

- 26 đầu mục chuẩn (`payroll_standard_catalog()`); nút *Khởi tạo danh mục chuẩn* chỉ thêm
  những đầu mục còn thiếu. *Lương cơ bản* là dòng *Chỉ để tính* (là MỨC để các dòng khác
  nhân chia), không tự cộng vào lương.
- Trường: mã, tên, loại dòng, nhóm hiển thị, tính chất, giá trị mặc định (nếu có), trạng
  thái, mô tả. Cách tính, cờ thuế / bảo hiểm, trần của danh mục kiểu cũ không còn — mọi
  cách tính nằm ở công thức của dòng cơ chế. Các cột cũ còn trong bảng để đọc lịch sử.
- Không đặt được mã trùng tên dữ liệu tự động; tên không trùng (không phân biệt hoa thường).
- Xoá (`remove_payroll_component`): đã nằm trong kỳ lương đã khoá thì chuyển *Khóa*, chưa
  dùng thì xoá hẳn; cả hai ghi nhật ký.
- Mỗi đầu mục cho biết đang có trong cơ chế nào, ai khai riêng, đơn vị nào khai chung.
- **Nhãn báo cáo** (không bắt buộc): người dùng gắn cho đầu mục để báo cáo nhân sự biết số
  nào thuộc cột nào — *Bảo hiểm người lao động đóng*, *Doanh nghiệp đóng thêm*, *Thuế thu
  nhập cá nhân*, *Thu nhập tính thuế*. Nhãn **không vào công thức và không đổi cách
  tính**; khi chạy bảng lương, số của các đầu mục cùng nhãn được cộng vào cột tương ứng của
  phiếu (`insurance_employee`, `insurance_employer`, `personal_income_tax`,
  `taxable_income`) để màn *Báo cáo nhân sự → Bảo hiểm & thuế* đọc. Nhãn đi cùng loại
  dòng: bảo hiểm NLĐ và thuế phải là dòng *Trừ khỏi lương*; doanh nghiệp đóng thêm và thu
  nhập tính thuế là dòng *Chỉ để tính* — form và database đều chặn nhãn sai loại. Đầu mục
  chưa gắn nhãn thì cột ghi 0. Dòng gắn *Doanh nghiệp đóng thêm* không hiện trên phiếu của
  chính nhân viên (`get_my_payslip`). Engine tính lương không đọc nhãn
  (`lib/payrollReportTags.ts`).

## Tham số lương

- Bộ tham số theo ngày hiệu lực, luôn từ ngày đầu tháng; chỉ thêm / sửa được bộ có hiệu lực
  **sau** kỳ lương đã chốt gần nhất (`firstEditableMonth`). Bộ đã dùng cho kỳ đã chốt bị
  khoá ở database.
- Bảng tham số / bảng bậc thang tự tạo, đổi tên, xoá. Mã tham số đi theo tên cho tới khi
  được dùng trong công thức, và tự tránh tên dữ liệu tự động / tên đầu mục. Cột *Dùng ở*
  cho biết dòng cơ chế nào đang dùng tham số; xoá tham số đang dùng phải xác nhận.
- Kiểm tra ở client (`validateParamVersion`) và ở database (`validate_payroll_param_version`):
  mã hợp lệ, không trùng, không trùng tên dành riêng, giá trị là số, đơn vị đúng loại, bậc
  thang tăng dần.
- *Thiết lập chung*: công chuẩn khi tháng chưa khai ca làm việc, làm tròn thực lĩnh, kiểm
  tra mức sàn (đầu mục ≥ tham số, ví dụ Lương cơ bản ≥ Lương tối thiểu vùng) khi trình đề
  xuất — kiểm ở giao diện và ở `payroll_validate_scheme_payload`.
- *Chạy thử với bộ này* dùng bộ đang soạn, chưa cần lưu.

## Thiết kế cơ chế

- Danh sách cơ chế bên trái; mỗi cơ chế có hiệu lực theo tháng, các đơn vị đang dùng, nút
  *Gán cho đơn vị*, *Chạy thử*, đổi tên, ngừng dùng, xoá (chỉ xoá được cơ chế chưa từng gán).
- Tạo cơ chế: trống, sao chép cơ chế có sẵn, hoặc nạp bộ gợi ý khối Văn phòng / Kinh doanh
  (`seed_payroll_mechanism_defaults`, chỉ cho cơ chế còn trống; tự thêm các đầu mục còn
  thiếu vào danh mục).
- Mỗi dòng: loại dòng (+ / − / ·), cách lấy giá trị, công thức hoặc giá trị, kết quả với
  dữ liệu thử, "Dùng / Được dùng ở". *Dữ liệu thử* lấy số thật của một nhân viên hoặc số
  giả định; mọi dòng tính lại ngay, không ghi gì.
- *Lưu cơ chế* (`save_payroll_mechanism`) thay trọn bộ dòng từ tháng hiệu lực: dòng cũ đóng
  ở cuối tháng trước, tháng cũ giữ nguyên. Không chen trước phiên bản đã có ở tháng sau,
  không lưu vào tháng đã chốt. Sửa công thức của cơ chế dùng chung **không** cần BGĐ duyệt.

## Áp dụng cơ chế cho nhân sự

**Luồng:** cây tổ chức → đơn vị → danh sách nhân sự (cơ chế, *Đủ x/y* giá trị riêng, tình
trạng) → một người → *Thiết lập cơ chế lương*:

- *Theo cơ chế*: của đơn vị (thừa hưởng theo cây) hoặc gán riêng; *Áp dụng từ tháng*.
- *Giá trị riêng*: các dòng *Từng người* (bắt buộc) và *Giá trị* (gợi ý giá trị chung).
- *Công thức riêng / dòng thêm riêng*: đè công thức của một dòng (ví dụ thuế khoán), hoặc
  thêm đầu mục chưa có trong cơ chế.
- *Ước tính nếu đi đủ công*, và tài khoản nhận lương.

Đơn vị có *Giá trị chung của đơn vị*, khai cùng kiểu.

**Duyệt:** màn khai riêng tạo **đề xuất** (`payroll_scheme_requests`) *Nháp → Chờ BGĐ duyệt
→ Đã duyệt / Bị từ chối*. Chỉ khi BGĐ ký duyệt (nhập lại mật khẩu), database mới áp: phần
khai riêng cũ đóng ở cuối tháng trước, phần mới hiệu lực từ tháng áp dụng. BGĐ chỉ thấy
phần **thay đổi** (`diffSchemeItems`, so cả giá trị lẫn công thức). Người trình không tự
duyệt. Không chen trước phiên bản đã có hiệu lực sau đó, không áp vào tháng đã chốt
(`earliestSchemeMonth`); database kiểm lại.

## Tính toán, điều chỉnh, khoá kỳ, phát hành

Vòng đời kỳ lương: `DRAFT → CALCULATED → LOCKED → APPROVED → PAID`.

1. **Tính bảng lương nháp.** Dữ liệu vào: công đã duyệt, KPI, đơn OT / đi muộn đã duyệt,
   số liệu tháng, điều chỉnh. Bảng lương có **một cột cho mỗi đầu mục** (bật *Hiện dòng
   chỉ để tính* để thấy cả dòng trung gian), rồi Tổng cộng / Tổng trừ / Thực nhận. Thực
   lĩnh làm tròn theo tham số, phần chênh ghi riêng. "Tính lại" ghi đè bộ phiếu nháp trong
   một transaction. Khi chốt phiếu, bốn cột báo cáo của phiếu lấy theo **Nhãn báo cáo** của
   đầu mục (chưa gắn nhãn thì 0) và `payslips.other_deductions` là phần khấu trừ còn lại —
   cộng bảo hiểm + thuế + còn lại luôn ra tổng trừ.
2. **Điều chỉnh tăng (+) / giảm (−)** bắt buộc có lý do, có thể ghi kỳ phát sinh; điều chỉnh
   tăng nằm trong `TONG_THU_NHAP`. Kỳ đã khoá thì ghi vào kỳ đang mở.
3. **Khoá kỳ bằng 2FA.** Danh sách kiểm tra: kỳ công đã khoá, KPI đã khoá, bộ phiếu khớp
   số liệu hiện tại (bắt buộc); người thiếu cơ chế, đề xuất chờ duyệt, cảnh báo tính toán
   (cảnh báo). Database chỉ khoá khi phiên ở `aal2` và vừa nhập TOTP trong 5 phút; ghi dấu
   vân tay SHA-256 của toàn bộ phiếu và báo BGĐ. KTT rút lại được kèm lý do.
4. **BGĐ ký duyệt chi / từ chối** bằng mật khẩu (5 phút). Database đối chiếu dấu vân tay;
   người khoá kỳ không tự duyệt chi.
5. **File chi lương ngân hàng** (VietinBank, BIDV) sau khi BGĐ duyệt; bố cục là dữ liệu
   (`payroll_bank_templates`); người chưa khai tài khoản bị liệt kê riêng.
6. **Bút toán kết chuyển** (`lib/payrollJournal.ts`): Nợ 642 / Có 334 tổng các khoản cộng;
   mỗi đầu mục trừ một bút toán Nợ 334 / Có 338 mang tên đầu mục — kế toán chỉnh tài khoản
   chi tiết trong file.
7. **Xác nhận đã chi trả & phát hành phiếu** (`PAID`), nhân viên nhận thông báo, xem phiếu
   của mình sau khi nhập lại mật khẩu (phiên 15 phút), có In / Lưu PDF.
8. **Sau khi khoá không mở lại kỳ**; kỳ công của tháng đã khoá lương cũng không mở lại.

## Chuyển dữ liệu cũ (migration `20261017110000`)

Chạy một lần (nhận biết qua cột `payroll_template_items.mode`), không tính lại kỳ đã khoá:

- **Danh mục:** khoản "hệ thống tự tính" thành đầu mục thường; lương gốc và phần doanh
  nghiệp đóng thành *Chỉ để tính*; thêm nhóm *Số liệu & dòng trung gian* và các đầu mục phụ
  trợ (Đơn giá ngày / giờ, Lương đóng bảo hiểm, Số người phụ thuộc, Thu nhập chịu thuế /
  tính thuế, BH doanh nghiệp đóng…) khi có dữ liệu lương. Các đầu mục bảo hiểm NLĐ, thuế,
  thu nhập tính thuế, BH doanh nghiệp đóng và khoản "doanh nghiệp chi" tự định nghĩa trước
  đây được gắn **Nhãn báo cáo** tương ứng để báo cáo nhân sự giữ liên tục.
- **Tham số:** các cột cố định, tham số tự đặt và biểu thuế thành bảng (Lương nền, Bảo hiểm,
  Thuế TNCN, Biểu thuế lũy tiến, các nhóm tham số cũ, bảng tra bậc cũ). Ghi chú bỏ dẫn
  chiếu tài liệu, tên không dấu được đặt lại có dấu.
- **Công thức:** biến cũ (`BASE`, `GROSS`, `MONTHLY_RATE`, `INSURANCE_EMPLOYEE`,
  `TAXABLE_INCOME`) đổi sang đầu mục / dữ liệu mới; cách tính của danh mục (theo ngày,
  theo giờ / sản lượng, %, chia ngày công, trần) thành công thức của dòng; `/ 100` sau
  tham số % được bỏ; `KPI_PCT / 100` thành *Tỷ lệ KPI*; biến nhập tay lạ thành đầu mục
  *Chỉ để tính* có dòng *Hằng tháng*; số đã nhập ở kỳ chưa chốt đổi sang mã mới.
- **Cơ chế:** mọi cơ chế đang dùng được thêm các dòng engine cũ tính ngầm (lương thời gian /
  phép / lễ, bảo hiểm, thu nhập chịu thuế với đúng các khoản không chịu thuế — kể cả trần
  miễn thuế và phần OT vượt giờ thường —, thu nhập tính thuế, thuế lũy tiến, và phần doanh
  nghiệp đóng thêm: BHXH / BHYT / BHTN / KPCĐ phía doanh nghiệp, cùng điều kiện miễn đóng và
  mức trần với phần người lao động). Người không
  thuộc cơ chế nào, đơn vị "không áp mẫu" và mẫu đã ngừng dùng chuyển sang **Cơ chế chung**.
- **Từng người:** người phụ thuộc, mức đóng BH, không đóng BH, thuế khoán / không khấu trừ,
  công chuẩn riêng (thay mọi chỗ đọc công chuẩn), lương ngày / giờ / khoán (người khoán /
  không khấu trừ thuế còn có số tính thuế riêng = toàn bộ thu nhập chịu thuế / 0, như cột
  "thu nhập tính thuế" của engine cũ), lương gốc ở hồ
  sơ (chỉ khi engine cũ thực sự dùng nó), cờ không chịu thuế khai riêng → giá trị / công
  thức riêng cùng khoảng hiệu lực. Khai riêng cũ được ghi rõ mức để cách gộp mới ra đúng
  như cách "thay trọn dòng" của engine cũ. Đề xuất đang mở chuyển payload sang dạng mới.

Đã đối chiếu bằng cách chạy engine cũ (commit trước) trên dữ liệu trước migration và engine
mới trên dữ liệu sau migration cho 12 người phủ các nhánh trên: thực lĩnh khớp tới từng
đồng. Bốn cột báo cáo (bảo hiểm NLĐ, doanh nghiệp đóng thêm, thuế, thu nhập tính thuế)
cũng khớp engine cũ cho cả 12 người. Khác biệt đã biết:

1. Bảo hiểm là một dòng (BHXH, BHYT, BHTN) làm tròn một lần thay vì ba dòng làm tròn
   riêng — có thể lệch 1đ. Phần doanh nghiệp đóng cũng vậy.
2. Phần doanh nghiệp đóng (BHXH / BHYT / BHTN / KPCĐ phía DN) là dòng *Chỉ để tính* "BH
   doanh nghiệp đóng" trong cơ chế (có công thức, sửa được), không còn tính ngầm. Khoản
   BH / KPCĐ doanh nghiệp tự gán tay trước đây (cùng mã ER_*) không còn được tính.
3. Truy lĩnh đánh dấu "không chịu thuế" không còn ý nghĩa: mọi điều chỉnh tăng nằm trong
   tổng các khoản cộng (ô "chịu thuế" ở màn Điều chỉnh đã bỏ).
4. Công thức cũ đọc `GROSS` (tổng thu nhập tính tới thời điểm đó) trong một khoản **cộng**
   giờ thành vòng lặp với tổng các khoản cộng — cần viết lại nếu có.
5. Cờ chịu thuế của từng dòng trong **đề xuất cũ đang mở** bị bỏ khi chuyển payload.

## Triển khai

1. Chạy sáu migration M06 theo thứ tự tên file.
2. **Bật MFA TOTP cho Supabase Auth** (local: `supabase/config.toml` `[auth.mfa.totp]`;
   hosted: Dashboard → Authentication → Multi-Factor). Chưa bật thì không khoá kỳ được.
3. Giao chức năng **Phê duyệt lương** (`admin.payroll_approve`) cho Ban Giám đốc.
4. Kế toán: kiểm tra bộ tham số (đặc biệt các điểm ở mục cuối) → mở *Cơ chế lương*, rà
   *Cơ chế chung* và các cơ chế đã chuyển (hoặc tạo từ gợi ý khối Văn phòng / Kinh doanh)
   → gán cơ chế cho các khối → khai giá trị riêng cho từng người rồi trình BGĐ → khai tài
   khoản nhận lương.

## Kiểm thử

- `npm run check:all`: `check:payroll` (207 kiểm chứng: tham số theo bảng, lũy tiến / tra
  bậc, từng cách lấy giá trị, thứ tự phụ thuộc, vòng lặp, tổng thu nhập, khai riêng đè dòng,
  KPI, phần không chịu thuế, trần, điều chỉnh, làm tròn, giải theo cây, đề xuất, bút toán,
  tổng hợp công, lịch, đi muộn, chia giờ OT) và `check:flows` (81 kiểm chứng: giải bộ KPI,
  thang điểm, đếm ngày phép, ô công thức dạng thẻ — tách / ghép, gợi ý, đọc chữ, chuyển
  "Dạng chữ" qua lại không đổi công thức).
- Migration đã chạy trên Postgres cục bộ: trên database trống, trên database có dữ liệu
  kiểu cũ (rồi chạy lại lần hai không lỗi), các RPC mới (lưu cơ chế theo phiên bản, nạp
  gợi ý, bộ tham số mới, đề xuất → kiểm mức sàn → ký duyệt → áp dụng, chặn mã dành riêng),
  và kiểm không còn chữ dẫn chiếu tài liệu. Các ca này không nằm trong repo.
- Kịch bản UAT thủ công (134 ca): [m06-kich-ban-test.md](m06-kich-ban-test.md).
- `npx tsc -p tsconfig.app.json --noEmit`, `npx eslint . --quiet`,
  `npm run supabase:local:check` và `npm run build` đều đã chạy qua.

## Lỗi có sẵn đã sửa trong lúc làm

- Lương gốc bị cộng hai lần khi khoản lương gốc vừa có trong danh mục vừa khai riêng.
- Đồng bộ KPI sang số liệu lương đọc nhầm cột.
- Nhân viên không bao giờ xem được phiếu đã duyệt (policy tra `payroll_runs` bằng quyền của
  nhân viên) — sửa bằng hàm `security definer`.
- Điều chỉnh lương đọc được chéo giữa các nhân viên.
- Gõ `0.015` trong ô công thức bị đọc thành 15; số lẻ trong công thức hiện làm tròn 2 chữ
  số nên chuyển qua "Dạng chữ" rồi về làm đổi công thức.

## Điểm nghiệp vụ cần chốt

Đều là dữ liệu — đổi trên giao diện chứ không phải sửa code:

1. **Hệ số OT.** BR-PAY-003 ghi ngày thường 1,0 và CN / lễ 2,0; FR06.02 ghi 1,5 / 2,0 /
   3,0; Bộ luật Lao động 2019 (Đ.98) quy định tối thiểu 150% / 200% / 300%.
2. **Quy đổi đơn hàng ngoài giờ.** BR-PAY-003 ghi "1 đơn hàng ngoài giờ = 1 giờ", hướng dẫn
   khác ghi 2 giờ / ngày.
3. **Hoa hồng BL 02.** BR-PAY-004 để hở hai khoảng 89–90% và 104–105%. Bảng tra bậc hiểu
   mỗi bậc áp từ ngưỡng của nó tới ngay dưới ngưỡng kế tiếp, nên lấp kín hai khoảng hở.
4. **Giảm trừ gia cảnh.** FR06.02.01 ghi bản thân 11 triệu và NPT 6,2 triệu — lấy từ hai văn
   bản khác nhau, cần xác nhận mức áp dụng cho từng kỳ.
5. **Biểu thuế TNCN.** Biểu mới có hiệu lực thì tạo bộ tham số mới với ngày hiệu lực tương ứng.
6. **Mẫu file ngân hàng.** Bố cục VietinBank / BIDV theo mẫu phổ biến, phải đối chiếu với file
   mẫu ngân hàng cấp theo hợp đồng e-banking.
7. **Chữ ký số.** "Ký điện tử" của BGĐ hiện là xác thực lại bằng mật khẩu kèm nhật ký và dấu
   vân tay số liệu, không phải chữ ký số PKI / USB token.
8. **Trưởng phòng xem lương phòng mình.** Chưa có quy tắc phân quyền rõ, nên chưa làm.
9. **Mức sàn cho lao động theo giờ / bán thời gian.** Kiểm tra mức sàn hiện so một đầu mục
   với một tham số (ví dụ lương tháng với lương tối thiểu vùng tháng); lương tối thiểu giờ
   chưa được kiểm.
