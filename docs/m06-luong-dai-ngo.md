# M06 — Lương và Đãi ngộ: bốn tính năng chính

Tài liệu này mô tả phần đã làm cho F06.01–F06.04 theo `Mo06 - Lương và đãi ngộ.docx`,
`BR_PAY.docx`, `ENT liên quan.docx` và `Ycau giao dien.docx`: chỗ nằm trong code, cách
triển khai, cách kiểm thử và những điểm đặc tả còn phải chốt.

## Nguyên tắc chung

- **Không có quy tắc lương nào nằm trong code.** Tỷ lệ bảo hiểm, biểu thuế, giảm trừ gia
  cảnh, lương tối thiểu vùng, hệ số OT, bậc hoa hồng, đơn giá, cách làm tròn thực lĩnh
  đều là dữ liệu: bộ tham số theo ngày hiệu lực (`payroll_param_versions`), mẫu bảng
  lương theo khối (`payroll_templates` / `payroll_template_items`) và cơ chế của từng
  người / đơn vị. Chỗ duy nhất có con số là dữ liệu **gợi ý** khi nạp lần đầu (danh mục
  26 khoản chuẩn, bộ tham số mẫu, công thức gợi ý BL 01/BL 02). Kế toán sửa được hết các
  dữ liệu đó trên giao diện.
- **Cây tổ chức dùng đúng quy ước của dự án.** Mẫu BL và khoản chung của đơn vị đi xuống
  đơn vị con bằng `unitLineage` (`lib/kpiSchemeFor.ts`) giống KPI: đơn vị gần nhất
  thắng, tối đa 10 cấp, có chặn vòng. Cây vẽ bằng `components/payroll/UnitTree.tsx`
  (cùng cách vẽ với `KpiSchemeBoard`). Bản database tương ứng là `payroll_template_for`.
- **Database là chốt chặn cuối.** Mọi chuyển trạng thái (duyệt cơ chế, tính / khoá /
  duyệt / chi trả kỳ lương, xuất file ngân hàng) đi qua RPC `security definer`. Trigger
  chặn cập nhật thẳng cột trạng thái, chặn sửa dữ liệu của tháng đã khoá, và ghi nhật ký
  kiểm toán.
- **Quyền theo chức năng.** Dùng `can_function()` / `hasAdminFunction()` như các module
  khác. Bảy mã chức năng là `admin.payroll_components`, `admin.payroll_settings`,
  `admin.payroll_schemes`, `admin.payroll_inputs`, `admin.payroll_adjustments`,
  `admin.payroll` và `admin.payroll_approve` (Ban Giám đốc). Mã cuối là mã mới.

## Bản đồ tính năng → code

| Tính năng | Màn (route) | Code chính | Migration |
|---|---|---|---|
| F06.01 Danh mục khoản lương | `/admin/payroll/components` | `components/payroll/ComponentCatalog.tsx` | `20261013100000_m06_f0601_payroll_catalog.sql` |
| F06.02 Tham số lương | `/admin/payroll/params` | `PayrollParamsTab.tsx`, `lib/payrollSettings.ts` | `20261013110000_m06_f0602_payroll_params_formulas.sql` |
| F06.02 Công thức theo khối + chạy thử | `/admin/payroll/formulas` | `PayrollFormulasTab.tsx`, `PayrollFormulaBuilder.tsx`, `PayrollDryRunModal.tsx`, `lib/payrollFormula.ts` | như trên |
| F06.03 Cơ chế lương theo sơ đồ tổ chức | `/admin/payroll/schemes` | `PaySchemeTree.tsx`, `PaySchemeModal.tsx`, `lib/payrollScheme.ts` | `20261013120000_m06_f0603_payroll_scheme_approval.sql` |
| F06.03/F06.04 Phê duyệt của BGĐ | `/admin/payroll/approvals` | `PayrollApprovals.tsx`, `ReauthDialog.tsx` | 0603 + 0604 |
| F06.04 Số liệu tháng, điều chỉnh | `/admin/payroll/inputs`, `/admin/payroll/adjustments` | `MonthlyInputsTab.tsx`, `AdjustmentsTab.tsx` | 0604 |
| F06.04 Bảng lương: tính, khoá, chi, phát hành | `/admin/payroll` | `PayrollRegister.tsx`, `TwoFactorDialog.tsx`, `BankExportModal.tsx`, `lib/payrollRun.ts` | `20261013130000_m06_f0604_payroll_lock_publish.sql` |
| F06.04 Phiếu lương của tôi | `/staff/payroll` | `pages/staff/StaffPayroll.tsx` | 0604 |

`pages/admin/AdminPayroll.tsx` chỉ là khung: nạp dữ liệu tháng một lần
(`loadPayrollWorkspace`) rồi chia cho từng mục. Phiếu lương của **một** người trong
**một** tháng luôn tính qua một hàm duy nhất là `computeForPerson` (`lib/payrollRun.ts`).
Bảng lương, chạy thử và phần xem trước ở Cơ chế lương đều gọi hàm này, nên ba màn không
thể ra ba con số khác nhau.

## F06.01 — Danh mục khoản lương

- Có 26 khoản chuẩn trong 5 nhóm bắt buộc (`payroll_component_categories`). Nút "Nạp danh
  mục chuẩn" chỉ thêm những khoản còn thiếu.
- Mỗi khoản có các trường: mã, tên, nhóm, loại (cộng / trừ / chi phí doanh nghiệp), tính
  chất (cố định / biến đổi), nguồn tính (gán được / engine tự tính), đơn giá mặc định, cờ
  chịu thuế, cờ tính bảo hiểm, trạng thái và mô tả hạch toán.
- Trùng mã báo đúng câu của đặc tả: "Mã khoản lương đã tồn tại trên hệ thống."
- Xoá một khoản (RPC `remove_payroll_component`):
  - nếu khoản đã nằm trong kỳ lương đã khoá thì chuyển sang **ngừng hoạt động**;
  - nếu chưa dùng ở kỳ nào thì xoá hẳn.
  - Cả hai trường hợp đều ghi nhật ký kiểm toán.
- Danh sách có tìm kiếm, lọc, sắp xếp, phân trang và xuất Excel / CSV / In-PDF (UI_02).

## F06.02 — Tham số & công thức

- **Bộ tham số theo ngày hiệu lực**, luôn bắt đầu từ ngày đầu tháng. Chỉ thêm / sửa được
  bộ có hiệu lực **sau** kỳ lương đã chốt gần nhất (`firstEditableMonth`).
  - Bộ tham số gồm: tỷ lệ BHXH / BHYT / BHTN của NLĐ và DN, KPCĐ, trần đóng, giảm trừ
    bản thân / NPT, biểu thuế 7 bậc, lương cơ sở, lương tối thiểu vùng, thuế khấu trừ
    thẳng, làm tròn thực lĩnh.
  - Có thêm tham số tự đặt tên (hệ số OT, đơn giá…) và biểu bậc thang. Biểu bậc thang gọi
    được như một hàm trong công thức, ví dụ hoa hồng BL 02: `HH_BL02(TY_LE)`.
- **Mẫu bảng lương theo khối.** BL 01 dùng cho Văn phòng / Kho / Vận chuyển, BL 02 dùng
  cho Kinh doanh. Mỗi mẫu được gán cho một đơn vị trên cây, đơn vị con thừa hưởng. Gán
  "không áp mẫu" có nghĩa là chặn thừa hưởng.
- **Kiểm tra cú pháp có vị trí lỗi** (`explainFormulaError`): phần lỗi tô đỏ ngay trong ô
  công thức. Database kiểm lại khi lưu.
- **Chạy thử** với một nhân viên, với số liệu giả định hoặc số liệu thật. Có nhật ký từng
  bước tính, chạy được cả với bộ tham số **chưa lưu** hoặc với một mẫu BL bất kỳ.

## F06.03 — Cơ chế lương theo sơ đồ tổ chức

**Luồng thao tác:** cây tổ chức → đơn vị → danh sách nhân sự (có trạng thái cơ chế) → một
người → **Thiết lập Cơ chế Lương**. Màn thiết lập có các phần:

- Người phụ thuộc, cách tính thuế, tham gia bảo hiểm và mức đóng, công chuẩn riêng.
- Mẫu bảng lương: theo đơn vị hoặc gán riêng.
- Các khoản thừa hưởng (từ mẫu khối và đơn vị cấp trên), chỉ để xem.
- Tick các khoản khai riêng, mỗi khoản có mức / công thức riêng và ba cờ thuế, bảo hiểm,
  lương gốc.
- Ước tính Gross / Net nếu đi đủ công.
- Tài khoản nhận lương.

Đơn vị cũng có "khoản chung" riêng, khai cùng kiểu.

**Duyệt (BR-PAY-012):**

- Màn thiết lập không ghi thẳng vào cơ chế. Nó tạo một **đề xuất**
  (`payroll_scheme_requests`) đi qua các trạng thái *Nháp → Chờ BGĐ duyệt → Đã duyệt /
  Bị từ chối*. Đề xuất bị từ chối thì sửa và trình lại được.
- Chỉ khi BGĐ ký duyệt, database mới áp đề xuất. Cơ chế chưa duyệt **không** được engine
  dùng.
- Đề xuất là bản thay thế toàn bộ phần khai riêng kể từ tháng áp dụng:
  - khoản cũ đóng ở cuối tháng trước;
  - khoản không còn trong đề xuất thì thôi áp.
- BGĐ chỉ thấy phần **thay đổi** so với hiện hành (`diffSchemeItems`).
- Người trình không tự duyệt được đề xuất của mình.

**BR-PAY-013:** khi trình duyệt, nếu mức của khoản lương gốc thấp hơn lương tối thiểu vùng
của bộ tham số tháng áp dụng thì bị chặn ở cả giao diện lẫn database. Lưu nháp vẫn được.

**Không chen phiên bản:** đề xuất không được áp từ tháng sớm hơn một phiên bản đã có hiệu
lực sau đó, và không được áp vào tháng đã chốt (`earliestSchemeMonth`). Database kiểm lại
cả hai điều này.

## F06.04 — Tính toán, điều chỉnh, khoá kỳ, phát hành

Vòng đời kỳ lương: `DRAFT → CALCULATED → LOCKED → APPROVED → PAID`.

1. **Tính bảng lương nháp.**
   - Dữ liệu vào: công đã duyệt (M03), KPI (M05), đơn OT / đi muộn đã duyệt, số liệu
     tháng và điều chỉnh.
   - Thực lĩnh làm tròn theo tham số (mặc định tới hàng nghìn), phần chênh ghi riêng vào
     `rounding_adjustment`.
   - "Tính lại" ghi đè bộ phiếu nháp trong **một** transaction.
2. **Điều chỉnh tăng (+) / giảm (−)** bắt buộc có lý do, có thể ghi kỳ phát sinh. Kỳ đã
   khoá thì không thêm được: sai sót của kỳ đó ghi vào kỳ đang mở.
3. **Khoá kỳ bằng 2FA** (FR06.04.03).
   - Danh sách kiểm tra trước khi khoá:
     - kỳ công đã khoá (bắt buộc);
     - KPI đã khoá (bắt buộc);
     - bộ phiếu đã tính khớp số liệu hiện tại (bắt buộc);
     - không còn người thiếu cơ chế (cảnh báo);
     - không còn đề xuất chờ duyệt (cảnh báo);
     - không còn cảnh báo tính toán (cảnh báo).
   - KTT nhập mã TOTP. Lần đầu đăng ký bằng mã QR ngay trong hộp thoại.
   - Database chỉ khoá khi phiên ở mức `aal2` và vừa nhập TOTP trong 5 phút. Khi khoá,
     database ghi dấu vân tay SHA-256 của toàn bộ phiếu và gửi thông báo cho BGĐ.
   - Đang chờ duyệt mà cần sửa thì KTT **rút lại** kèm lý do.
4. **BGĐ ký duyệt chi / từ chối** (BR-PAY-010).
   - Ký bằng cách nhập lại mật khẩu, hạn 5 phút. Từ chối bắt buộc có lý do và trả kỳ về
     *Đã tính*.
   - Database đối chiếu lại dấu vân tay: số liệu khác lúc khoá thì không duyệt được.
   - Người khoá kỳ không tự duyệt chi.
5. **File chi lương ngân hàng** (VietinBank, BIDV), chỉ xuất được sau khi BGĐ duyệt.
   - Bố cục cột, nội dung chuyển khoản và tuỳ chọn bỏ dấu đều là dữ liệu
     (`payroll_bank_templates`).
   - Người chưa khai tài khoản bị liệt kê riêng và không có trong file.
   - Mỗi lần xuất đều ghi nhật ký.
6. **Xác nhận đã chi trả & phát hành phiếu** (`PAID`). Nhân viên nhận thông báo.
7. **Nhân viên xem phiếu** (FR06.04.05, BR-PAY-011).
   - Chỉ xem được phiếu của mình và chỉ khi kỳ đã phát hành.
   - Phải nhập lại mật khẩu: trên điện thoại, trình quản lý mật khẩu điền bằng vân tay /
     FaceID. Phiên xem có hạn 15 phút.
   - Có In / Lưu PDF (UI_08).
   - Không còn bản "tạm tính" trên máy nhân viên: con số nhân viên thấy luôn là con số đã
     được ký.
8. **Sau khi khoá, không mở lại kỳ** (BR-PAY-009). Kỳ công của tháng đã khoá lương cũng
   không mở lại được: nút ở Bảng công ẩn đi và database chặn. Sai sót xử lý bằng điều
   chỉnh của kỳ sau.

## Triển khai

1. Chạy bốn migration `supabase/migrations/20261013*_m06_*.sql` theo thứ tự tên file.
2. **Bật MFA TOTP cho Supabase Auth.**
   - Môi trường local đã bật trong `supabase/config.toml` (`[auth.mfa.totp]`).
   - Project hosted phải bật ở Dashboard → Authentication → Multi-Factor. Chưa bật thì KTT
     không khoá kỳ được.
3. Giao chức năng **Phê duyệt lương** (`admin.payroll_approve`) cho tài khoản Ban Giám đốc
   ở màn cấp quyền.
4. Kế toán làm lần lượt:
   - nạp danh mục chuẩn;
   - kiểm tra lại bộ tham số (đặc biệt các điểm ở mục cuối);
   - nạp công thức gợi ý cho BL 01 / BL 02 và gán mẫu cho các khối;
   - lập cơ chế cho từng người rồi trình BGĐ duyệt;
   - khai tài khoản nhận lương.

## Kiểm thử

- `npm run check:all`: 497 kiểm chứng cho engine, công thức, giải cây, đề xuất cơ chế và
  các luồng.
- SQL chạy trên Postgres cục bộ: 105 ca cho cả bốn migration, gồm quyền, trạng thái, khoá
  dữ liệu, 2FA / ký lại, vân tay số liệu, BR-PAY-009/010/011/012/013. Các ca này không
  nằm trong repo; dựng lại bằng một Postgres trống và các file migration.
- `npx tsc -p tsconfig.app.json --noEmit`, `npx eslint . --quiet`,
  `npm run supabase:local:check` và `npm run build` đều đã chạy qua.

## Lỗi có sẵn đã sửa trong lúc làm

- Lương gốc bị cộng hai lần khi khoản lương gốc vừa có trong danh mục vừa khai riêng.
- Đồng bộ KPI sang số liệu lương đọc nhầm cột.
- Nhân viên không bao giờ xem được phiếu đã duyệt. Policy cũ tra `payroll_runs` bằng quyền
  của nhân viên, nên điều kiện luôn rỗng. Đã sửa bằng hàm `security definer`.
- Điều chỉnh lương đọc được chéo giữa các nhân viên.

## Điểm đặc tả cần chốt

Các điểm dưới đây đều là dữ liệu, nên đổi trên giao diện chứ không phải sửa code. Chúng
được ghi ra vì đặc tả mâu thuẫn hoặc có thể đã lệch với quy định hiện hành:

1. **Hệ số OT.** BR-PAY-003 ghi ngày thường 1,0 và CN / lễ 2,0. FR06.02 lại ghi 1,5 / 2,0
   / 3,0. Bộ luật Lao động 2019 (Đ.98) quy định tối thiểu 150% / 200% / 300%.
2. **Quy đổi đơn hàng ngoài giờ.** BR-PAY-003 ghi "1 đơn hàng ngoài giờ = 1 giờ", còn
   hướng dẫn khác ghi 2 giờ / ngày.
3. **Hoa hồng BL 02.** BR-PAY-004 để hở hai khoảng 89–90% và 104–105%. Biểu bậc thang
   hiện hiểu mỗi bậc áp từ ngưỡng của nó tới ngay dưới ngưỡng kế tiếp, nên lấp kín hai
   khoảng hở này.
4. **Giảm trừ gia cảnh.** FR06.02.01 ghi bản thân 11 triệu và NPT 6,2 triệu. Hai con số
   này lấy từ hai văn bản khác nhau, cần xác nhận mức áp dụng cho từng kỳ.
5. **Biểu thuế TNCN.** Đặc tả ghi 7 bậc. Nếu biểu thuế mới có hiệu lực, chỉ cần tạo một
   bộ tham số mới với ngày hiệu lực tương ứng.
6. **Mẫu file ngân hàng.** Bố cục cột VietinBank / BIDV hiện theo mẫu phổ biến, phải đối
   chiếu với file mẫu ngân hàng cấp theo hợp đồng e-banking.
7. **Chữ ký số.** "Ký điện tử" của BGĐ đang được hiểu là xác thực lại bằng mật khẩu kèm
   nhật ký và dấu vân tay số liệu, không phải chữ ký số PKI / USB token. Nếu cần PKI thì
   phải tích hợp thêm nhà cung cấp chữ ký số.
8. **Trưởng phòng xem lương phòng mình.** Đặc tả có nhắc nhưng chưa có quy tắc phân quyền
   rõ, nên chưa làm.
9. **Lương tối thiểu cho lao động theo giờ / bán thời gian.** BR-PAY-013 hiện so mức lương
   tháng với lương tối thiểu vùng tháng. Lương tối thiểu giờ chưa được kiểm.
