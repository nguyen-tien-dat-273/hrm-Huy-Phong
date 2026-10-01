# Rà soát hệ thống — phát hiện và kế hoạch cải tiến

*Ngày rà: 2026-10-01 · Phạm vi: 133 file, 37.851 dòng (`client/src` + `api`), 66 migration*

Mỗi phát hiện dưới đây đều đã kiểm chứng trên mã nguồn, có dẫn `file:dòng`.
Chỗ nào tôi nghi mà kiểm ra không phải lỗi thì ghi rõ là không phải, để lần
sau khỏi mất công nghi lại.

---

## P0 — Hỏng chức năng, cần sửa trước

### 1. Tính năng geofence chấm công đang chạy nhưng không ai điều khiển được

Cờ `feature_flags.geofence_attendance` là công tắc tổng của việc **check-in có
bị ràng buộc vị trí hay không**. Nó điều khiển 5 chốt chặn:

| Chốt | Vị trí |
|---|---|
| Bắt buộc có quyền GPS | `StaffAttendance.tsx:237` |
| Phải ở gần một điểm đã khai | `StaffAttendance.tsx:269` |
| Khoảng cách vượt bán kính thì chặn | `StaffAttendance.tsx:274` |
| GPS quá nhiễu thì chặn | `StaffAttendance.tsx:279` |
| Đọc cờ | `StaffAttendance.tsx:214` |

Dữ liệu đi kèm là `work_locations` và `organization_unit_work_locations`
(danh sách điểm chấm công và ánh xạ theo đơn vị).

**Vấn đề:** cả công tắc lẫn dữ liệu chỉ sửa được trong `AdminNexusCenter`, ở
hai section `flags` và `locations`. Mà `App.tsx` chỉ gắn route cho `lifecycle`
và `performance` (dòng 203–204). **Không section nào trong hai cái đó có
đường vào.** Mã quản lý vẫn còn nguyên — form, `toggleFlag`, CRUD điểm — chỉ
là không ai tới được.

Hệ quả thực tế: muốn bật/tắt kiểm tra vị trí khi chấm công, hoặc thêm/sửa một
điểm chấm công, phải vào thẳng database sửa tay.

Hai điểm phụ cùng gốc:

- `App.tsx:210` ghi *"không mã nào đọc `feature_flags`"* — **sai**.
  `StaffAttendance.tsx:214` đọc nó mỗi lần check-in. Comment này nhiều khả
  năng là lý do trang bị gỡ.
- Fail-open: `const geofenceEnabled = flag?.enabled === true`
  (`StaffAttendance.tsx:217`). Thiếu dòng cờ trong bảng ⇒ geofence **tắt im
  lặng**, nhân viên chấm công được từ bất kỳ đâu mà không cảnh báo gì.

**Cách sửa:** trả lại route và mục menu cho hai section (mã UI còn nguyên, chỉ
thiếu đường vào) — ước lượng nửa ngày. Riêng chuyện fail-open nên quyết rõ:
thiếu cờ thì coi là bật hay tắt, rồi ghi hẳn vào mã.

### 2. Một bảng không liên quan bị thiếu là sập cả hai module

`AdminNexusCenter.load()` nạp 8 truy vấn **bất kể đang mở section nào**
(`AdminNexusCenter.tsx:82–91`): profiles, lifecycle processes, checklist items,
performance cycles, work_locations, feature_flags, organization_units,
organization_unit_work_locations.

Rồi gộp lỗi của tất cả lại:

```
const featureError = results.slice(1).find((result) => result.error)?.error;
```

và chặn toàn trang:

```
if (error) return <Card><ErrorState message={error} onRetry={load} /></Card>;   // dòng 192
```

**Hệ quả:** chỉ cần `feature_flags` hoặc `work_locations` thiếu, lỗi RLS, hay
đổi tên — thì **KPI & Đánh giá** (module ba bước vừa dựng) và **Hội nhập &
nghỉ việc** đều trắng xoá, kèm thông báo đòi chạy
`20260908170000_nexus_hrm_capabilities.sql` trong khi người dùng chỉ muốn chấm
KPI, chẳng liên quan gì tới capability đó.

Đi kèm là lãng phí: mở KPI tốn 5 truy vấn không bao giờ dùng tới.

**Cách sửa:** nạp theo section, và chỉ chặn trang khi lỗi rơi đúng vào bảng mà
section đó cần — ước lượng nửa ngày.

---

## P1 — Sai âm thầm, khó phát hiện

### 3. Ba chỗ tính ngày/tháng bằng UTC trong hệ thống chạy ở UTC+7

Dự án đã có helper đúng — `toDateString()` / `getTodayString()`
(`lib/utils.ts:80–89`) dùng `getFullYear/getMonth/getDate`, tức giờ địa
phương. Ba chỗ dưới đây đi đường khác, dùng `toISOString()` tức UTC:

| Chỗ | Hỏng thế nào | Tần suất |
|---|---|---|
| `KpiWorkspace.tsx:57` | Dải trạng thái đọc nhầm tháng trước | 00:00–07:00 **ngày 1** hằng tháng |
| `KpiReviewBoard.tsx:100` | Phiếu chấm mở sẵn **sai kỳ** | 00:00–07:00 **ngày 1** hằng tháng |
| `AdminNexusCenter.tsx:37` | `start_date` hội nhập lùi một ngày | 00:00–07:00 **mỗi ngày** |

Ở UTC+7, từ nửa đêm tới 7 giờ sáng thì UTC vẫn đang ở ngày hôm trước.

Nguy hiểm nhất là `KpiReviewBoard`: nó quyết định kỳ nào được mở ra để nhập
điểm. Mở KPI lúc 6 giờ sáng ngày 1 thì màn hình bày ra kỳ tháng trước mà không
nói gì — người dùng nhập điểm, thậm chí khoá kỳ, vào nhầm tháng.

Chỗ thứ ba sai **mỗi ngày**, không chỉ ngày 1.

**Đã kiểm và KHÔNG phải lỗi:** `employeeImport.ts:117` cũng dùng
`toISOString()`, nhưng nó ghép với `Date.UTC(1899, 11, 30)` ở đầu kia — hai
đầu cùng UTC nên khớp. Để nguyên.

**Cách sửa:** thay bằng helper sẵn có; thêm một dòng trong `utils.ts` cho tháng
(`toMonthString`) để lần sau không ai phải tự nghĩ lại. Ước lượng 1 giờ.

### 4. `admin.feature_flags` — quyền cấp được nhưng không mở ra gì

Mã này vẫn nằm trong `ADMIN_FUNCTION_CODES` (`lib/permissions.ts`), nên vẫn
hiện trong ô *"Chức năng nâng cao có thể cấp riêng"*. Admin tick được, hệ
thống lưu được, nhưng trang nó bảo vệ không có route (xem mục 1).

Người đi cấp tưởng đã giao quyền; người nhận không thấy gì thay đổi.

Cột `function_code` trong `profile_function_permissions` là `text` **không có
ràng buộc CHECK** (migration `20261002100000`), nên gỡ mã này không vỡ dữ liệu
cũ.

**Cách sửa:** hoặc trả lại trang (mục 1) thì quyền này có nghĩa trở lại, hoặc
gỡ mã. Quyết mục 1 trước rồi mục này đi theo.

### 5. `api/` nằm ngoài cổng kiểm của bản build

`tsconfig.json` ở gốc chỉ tham chiếu `tsconfig.app.json` và
`tsconfig.node.json`. **Không có `api/tsconfig.json`.**

Nghĩa là `tsc -b` — chính là cổng chặn trong `buildCommand` mà Vercel chạy —
không hề đụng tới `api/admin-users.ts` và `api/google-maps-location.ts`.

Chạy riêng `npx tsc -p api/tsconfig.json` thì hiện vẫn sạch. Nhưng đây là loại
lỗ chỉ lộ ra vào đúng ngày tệ nhất: một lỗi kiểu trong `api/admin-users.ts`
(hàm tạo/xoá tài khoản) sẽ qua được build, lên production, rồi mới vỡ lúc có
người bấm.

**Cách sửa:** thêm `{ "path": "./api" }` vào references. Ước lượng 15 phút.

---

## P2 — Bảo trì, càng để lâu càng đắt

### 6. Chín cờ `*Supported` rải rác, không chỗ nào tổng hợp

Mỗi trang tự dò xem migration của mình đã chạy chưa:
`cancellationSupported`, `assignmentSupported`, `positionPermissionsSupported`,
`positionFunctionPermissionsSupported`, `multiManagerSupported`,
`profileFunctionPermissionsSupported`, `supported`, `roleFunctionsSupported`,
`periodSupported`.

Có chỗ thông báo khá rõ, ví dụ `AdminOrganization.tsx:1885`: *"Chưa chạy
migration 20261001100000 nên tạm thời chỉ chọn được một người."*

Nhưng người quản trị **phải đi hết từng trang mới biết hệ thống đang thiếu
gì**. Không có nơi nào trả lời được câu "cài đặt này đã đủ chưa".

**Cách cải tiến:** một mục *Tình trạng hệ thống* trong Cấu hình, dò một lượt
và liệt kê migration còn thiếu kèm tên file. Ước lượng 1 ngày.

### 7. Line ending lẫn lộn trong repo

`lib/permissions.ts` dùng CRLF nhưng riêng dòng 14 là LF;
`AdminUsers.tsx` cũng CRLF. Bất kỳ công cụ nào ghi lại cả file sẽ sinh diff giả
hàng trăm dòng, nuốt mất thay đổi thật và phá `git blame`.

**Cách sửa:** thêm `.gitattributes` với `* text=auto eol=lf`, rồi chuẩn hoá một
lần trong một commit riêng (commit đó sẽ to, nhưng chỉ một lần và không lẫn
với thay đổi logic). Ước lượng 30 phút.

### 8. Hook pre-push không chạy

`.githooks/pre-push` chặn push khi TypeScript lỗi hoặc có file `.env` bị git
theo dõi — comment trong đó ghi rõ `.env.local` **từng bị đẩy lên `main` một
lần rồi**. Nhưng `core.hooksPath` không được đặt, nên hook nằm im.

Đáng chú ý vì `.githooks/post-commit` **tự động push** ngay sau mỗi commit: sai
sót lên thẳng repo public không kịp rút, và với Vercel thì lên thẳng bản live.

**Cách sửa:** `git config core.hooksPath .githooks`. Ước lượng 1 phút.

---

## Những chỗ rà xong thấy TỐT

Ghi lại để lần sau khỏi rà lại:

- **Lõi tính lương** — `pnpm check:payroll` có 23 kiểm chứng, tất cả đạt, phủ
  cả các ca khó: nghỉ 14 ngày không trừ bảo hiểm, thực nhận không âm, hai mức
  thang chồng nhau, lỗ hổng giữa hai mức.
- **Hook realtime** (`useRealtimeSync`) — xử lý đúng ba chỗ dễ sai: giữ hàm
  trong ref, so sánh subs theo nội dung, và `channelKey` để hai component cùng
  nghe một bảng không đụng nhau.
- **Route nhân viên** — 13 route khớp đúng 13 mục menu, không trang nào mồ côi.
- **Chuyển hướng tương thích** — `/admin/dashboard`, `/admin/performance/schemes`,
  `/admin/performance/review` đều giữ link cũ không chết.
- **Chấm công hai ca/ngày** — đã xử lý đúng: không dùng `maybeSingle()`, ưu
  tiên ca đang mở, có chỉ mục `attendance_one_open_per_user_day` chặn hai ca
  cùng mở.

---

## Kế hoạch đề xuất

Xếp theo *thiệt hại nếu để nguyên*, không theo độ khó.

**Đợt 1 — chặn chảy máu (~1 ngày)**

1. Trả route + menu cho `flags` và `locations` *(mục 1)*
2. Nạp theo section trong `AdminNexusCenter` *(mục 2)*
3. Bật `core.hooksPath` *(mục 8)* — 1 phút, làm ngay

Hai mục đầu cùng nằm trong `AdminNexusCenter` nên làm một lượt rẻ hơn tách ra.

**Đợt 2 — bịt chỗ sai âm thầm (~0,5 ngày)**

4. Ba chỗ ngày/tháng UTC, thêm `toMonthString()` *(mục 3)*
5. `api/` vào `tsc -b` *(mục 5)*
6. Quyết `admin.feature_flags`: giữ hay gỡ *(mục 4)*

**Đợt 3 — trả nợ (~1,5 ngày)**

7. Mục *Tình trạng hệ thống* gom chín cờ `*Supported` *(mục 6)*
8. `.gitattributes` + chuẩn hoá line ending, commit riêng *(mục 7)*

---

## Phạm vi rà này KHÔNG phủ

Nói rõ để không ai tưởng đã yên tâm toàn bộ:

- **Chính sách RLS trong 66 migration** — chưa đối chiếu từng policy với giả
  định của giao diện. Đây là hàng rào bảo mật thật của hệ thống, đáng một
  đợt rà riêng.
- **Hành vi lúc chạy** — container này không có thông tin kết nối Supabase nên
  tôi không đăng nhập vào được. Toàn bộ phát hiện trên là đọc mã và suy luận,
  đã kiểm chứng bằng `tsc -b`, `pnpm build`, `pnpm check:payroll` và chạy thật
  module phân quyền; nhưng chưa bấm thử trên giao diện thật.
- **Hiệu năng khi dữ liệu lớn** — chưa đo truy vấn nào với vài nghìn nhân sự.
- **Hai serverless function trong `api/`** — mới chỉ kiểm kiểu, chưa rà logic.
