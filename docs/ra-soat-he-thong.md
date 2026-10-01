# Rà soát hệ thống — phát hiện và kế hoạch cải tiến

*Ngày rà: 2026-10-01 · Phạm vi: 133 file, 37.851 dòng (`client/src` + `api`), 66 migration*

Mỗi phát hiện dưới đây đều đã kiểm chứng trên mã nguồn, có dẫn `file:dòng`.
Chỗ nào tôi nghi mà kiểm ra không phải lỗi thì ghi rõ là không phải, để lần
sau khỏi mất công nghi lại.

---

## Hướng đã chốt: bỏ check-in thủ công, lấy công từ máy

Phần này rà riêng theo hướng đã quyết — gỡ đường check-in trên trình duyệt,
chấm công lấy từ máy, bảng công là sổ cái. Liệt kê đúng những gì phải đổi.

### A. Hai lỗ hổng phải bịt TRƯỚC khi gỡ nút check-in

**A1. Gỡ nút đi là không còn đường nào tạo bản ghi chấm công ngoài máy.**

Rà cả hệ thống, chỉ có **đúng một** chỗ ghi thêm dòng vào bảng `attendance`:

```
client/src/pages/staff/StaffAttendance.tsx:289     supabase.from('attendance').insert({ ... })
```

`AdminAttendance` chỉ duyệt / bỏ duyệt / xoá — **không có insert**. Không trang
quản trị nào thêm được một dòng chấm công.

Nghĩa là ngày máy hỏng, ngày mất điện, người mới chưa đăng ký vân tay, hay ai
đó quên quét — **ngày công đó không có cách nào ghi nhận**. `attendance_requests`
không đỡ được: nó chỉ có `LATE_ARRIVAL`, `EARLY_LEAVE`, `OVERTIME`, không có
loại "thiếu ngày công".

⇒ Phải làm đường nhập công tay cho quản lý **trước**, rồi mới gỡ nút. Làm
ngược thứ tự là có ngày cả công ty không chấm được công.

**A2. Trang duyệt chấm công không có route.**

`AdminAttendance` được import ở `App.tsx:28` nhưng **không `<Route>` nào render
nó** — tôi đã dò toàn bộ component lazy, đây là cái duy nhất bị bỏ rơi.

Mà đó là nơi **duy nhất** trong giao diện đặt `approved_by_lead = true`
(dòng 102 và 189). Trong khi bảng công tháng chỉ đếm:

```
.eq('status', 'completed').eq('approved_by_lead', true)      // AdminTimesheet.tsx:84
```

Dòng do máy đẩy vào được đặt `approved_by_lead = true` sẵn nên không sao. Nhưng
mọi dòng **không** do máy tạo thì kẹt vĩnh viễn ngoài bảng công, vì không còn
giao diện nào duyệt được.

Chua hơn: `AdminTimesheet.tsx:97` có đếm sẵn số dòng chưa duyệt để cảnh báo —
người dùng thấy cảnh báo, bấm vào thì không có chỗ nào xử lý.

### B. Gỡ được những gì

| Gỡ | Vị trí |
|---|---|
| Nút CHECK-IN và `handleCheckIn` | `StaffAttendance.tsx:188–320`, `550` |
| 5 chốt geofence | `StaffAttendance.tsx:237, 269, 274, 279` |
| Đọc cờ `geofence_attendance` | `StaffAttendance.tsx:214` |
| Tra `work_locations` để tính khoảng cách | `StaffAttendance.tsx:215` và đoạn lọc theo đơn vị |
| `check_in_method` giá trị `'GPS'`, `'WIFI'` | còn lại `'DEVICE'` và `'MANUAL'` cho đường nhập tay |
| Quyền `admin.feature_flags` | sau khi không còn ai đọc cờ |

Nút **Check-out cũng hết nghĩa**: máy chỉ ghi giờ vào và đánh `completed` ngay,
nên không còn ca nào "đang mở" để đóng. Kéo theo phải sửa mô tả menu
`StaffLayout.tsx:82` — hiện vẫn ghi *"Xem dữ liệu từ máy chấm công và hoàn tất
check-out"*.

Trang Chấm công của nhân viên khi đó còn lại đúng vai trò **xem**: hôm nay máy
ghi nhận mình lúc mấy giờ, tháng này được bao nhiêu công, việc được giao hôm
nay là gì.

### C. KHÔNG được gỡ nhầm

- **`work_locations` vẫn cần.** `attendance_devices.location_id` tham chiếu tới
  nó (migration `20260926100000`, dòng 11), và hàm ingest ghi
  `selected_device.location_id` vào từng dòng chấm công. Gỡ geofence không làm
  bảng này thừa — nó là nơi khai mỗi máy đặt ở đâu.
  **Nhưng** giao diện tạo/sửa điểm nằm ở section `locations` của
  `AdminNexusCenter`, mà `App.tsx` không gắn route. Thêm một máy mới mà chưa có
  điểm nào trong bảng thì không gán được. ⇒ Vẫn phải trả lại giao diện này,
  chỉ là vì lý do khác chứ không phải vì geofence.
- **`attendance_sessions` vẫn sống** — có trigger `sync_attendance_sessions()`
  ở database tự ghi từ bảng `attendance` (migration `20260909110000`). Client
  chỉ đọc, không ghi, nên nhìn tưởng chết.

### D. Dữ liệu cũ phải dọn

Mọi dòng `attendance` có `status = 'active'` và `check_in_method = 'GPS'` ở các
ngày đã qua là nạn nhân của lỗi mục 1: lần quét vân tay của họ đã bị nuốt, ngày
công không vào bảng công. Cần đếm, đối chiếu với
`attendance_device_events` cùng ngày, rồi bù trước khi chốt kỳ lương tới.

### E. Thứ tự làm

1. **Đường nhập công tay cho quản lý** *(A1)* — không có cái này thì không được
   gỡ gì cả
2. **Trả route cho trang duyệt chấm công** *(A2)* — và kiểm lại điều kiện duyệt
   hàng loạt ở dòng 174, hiện đòi `check_out_time` khác rỗng nên dòng từ máy
   không lọt vào
3. **Trả route cho giao diện điểm chấm công** *(C)*
4. **Dọn dữ liệu cũ** *(D)* — làm trước kỳ lương tới
5. **Gỡ đường check-in thủ công và bộ geofence** *(B)* — bước cuối, khi bốn
   bước trên đã xong

---

## P0 — Hỏng chức năng, cần sửa trước

### 1. Nút Check-in thủ công còn sống song song với máy chấm công — và một lần quét vân tay có thể bị nuốt mất

Chấm công đã chuyển sang chạy bằng máy: migration `20260930230000` khai rằng
máy chỉ ghi GIỜ VÀO, và **một lần quét = một ngày công hoàn chỉnh**
(`resolved_status := 'completed'`, dòng 207) kèm `approved_by_lead = true`.

Nhưng trang Chấm công vẫn render nút CHECK-IN tròn to màu xanh
(`StaffAttendance.tsx:550`), không rào bởi cờ nào, không nhắc gì tới máy. Hễ
bridge chưa kịp đồng bộ lần quét sáng nay thì màn hình hiện `not_checked_in`
và mời người ta bấm.

Bấm vào thì ghi một dòng `status = 'active'`, `approved_by_lead = false`
(dòng 294), `check_in_method = 'GPS'` nếu có GPS (dòng 296).

**Rồi khi bridge ingest lần quét vân tay cùng ngày đó** (migration
`20260930230000`, dòng 212–241), nó xét ba nhánh:

| Nhánh | Điều kiện | Với dòng GPS nói trên |
|---|---|---|
| 1 | chưa có dòng nào trong ngày | **trượt** — đã có dòng |
| 2 | `coalesce(check_in_method,'DEVICE') = 'DEVICE'` | **trượt** — đang là `'GPS'` |
| 3 | `resolved_out is not null` | **trượt** — máy chỉ ghi giờ vào nên `resolved_out := null` (dòng 205) |

**Không nhánh nào chạy.** Nhưng ngay sau đó sự kiện vẫn bị đánh dấu đã xử lý
(`processed_at = now()`, dòng 243). Lần quét vân tay biến mất không dấu vết.

Dòng chấm công nằm lại `status = 'active'`, `approved_by_lead = false`. Mà
bảng công tháng chỉ đếm:

```
.eq('status', 'completed').eq('approved_by_lead', true)     // AdminTimesheet.tsx:84
```

⇒ **Ngày đó không vào bảng công tháng. Trả thiếu lương, không một cảnh báo nào.**

Nghịch lý đáng chú ý: nhân viên **bật** GPS thì mất ngày công; nhân viên
**tắt** GPS thì `check_in_method = null`, `coalesce(null,'DEVICE') = 'DEVICE'`,
nhánh 2 chạy và dòng được gộp đúng. Người làm đúng hơn lại thiệt.

**Hướng đã chốt: A** (bỏ hẳn check-in thủ công) — xem phần *Hướng đã chốt* ở
đầu tài liệu để biết phải đổi những gì và theo thứ tự nào. Hai hướng ban đầu
ghi lại ở đây để giữ lý do:

- **A — Gỡ hẳn nút check-in thủ công.** Đúng hướng đã chọn khi tích hợp máy.
  Gỡ được luôn cả bộ geofence ăn theo (xem ghi chú dưới). Rủi ro: máy hỏng
  hoặc người mới chưa đăng ký vân tay thì không còn đường chấm công nào —
  phải có lối cho quản lý nhập tay thay.
- **B — Vá nhánh ingest** để xử lý trường hợp `resolved_out is null` gặp dòng
  không phải DEVICE: gộp giờ vào, đặt `completed`, `approved_by_lead = true`.
  Rẻ hơn, nhưng giữ nguyên hai đường chấm công song song.

Vì đã chốt hướng A, nhánh ingest vẫn nên vá **nếu** đường nhập công tay sắp
tới cũng ghi `check_in_method` khác `'DEVICE'` — nếu không, đúng cái bẫy này sẽ
lặp lại với dòng nhập tay. Kiểm điều đó khi làm bước 1 của phần *Hướng đã chốt*.

> **Ghi chú — bộ geofence giờ chỉ còn ăn theo đường thủ công.**
> Cờ `feature_flags.geofence_attendance` vẫn được đọc ở
> `StaffAttendance.tsx:214` và vẫn gác 5 chốt (dòng 237, 269, 274, 279), nhưng
> chỉ trên đường check-in thủ công. Cả cờ lẫn dữ liệu `work_locations` không
> còn giao diện quản lý: chúng nằm ở hai section `flags` và `locations` của
> `AdminNexusCenter`, mà `App.tsx` chỉ gắn route cho `lifecycle` và
> `performance`. Nếu chọn hướng A thì xoá cả cụm này là gọn. Nếu chọn giữ
> đường thủ công thì phải trả lại giao diện, vì hiện muốn bật/tắt kiểm tra vị
> trí phải sửa thẳng database.
>
> Một chi tiết cần sửa dù chọn hướng nào: comment ở `App.tsx:210` ghi *"không
> mã nào đọc `feature_flags`"* — sai, `StaffAttendance.tsx:214` đọc nó mỗi lần
> check-in thủ công. Chính câu đó nhiều khả năng là lý do trang quản lý cờ bị
> gỡ.

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
- **Giao diện nhận ra dòng do máy đẩy vào** — `state` tính từ
  `attendance.status === 'completed' ? 'checked_out' : 'working'`
  (`StaffAttendance.tsx:144-150`), nên khi máy đã ghi nhận lần quét thì nút
  CHECK-IN không hiện. Tôi đã nghi đây là đường sinh bản ghi trùng ngày và
  kiểm ra **không phải** — đường đi thường không tạo dòng trùng. Lỗi ở mục 1
  nằm ở chiều ngược lại: người dùng bấm tay TRƯỚC khi bridge đồng bộ.
- **Bridge gộp đúng khi máy có ghi giờ ra** — nhánh 3 của hàm ingest xử lý
  trọn vẹn ca "nhân viên check-in GPS, máy bổ sung giờ ra". Lỗ hổng ở mục 1
  chỉ xảy ra với máy **chỉ ghi giờ vào**, đúng loại máy đang dùng.

---

## Kế hoạch đề xuất

Xếp theo *thiệt hại nếu để nguyên*, không theo độ khó.

**Đợt 1 — chặn chảy máu (~1 ngày)**

1. **Vá nhánh ingest** để lần quét vân tay không bị nuốt khi trong ngày đã có
   dòng check-in thủ công *(mục 1, hướng B)*. Đây là chỗ đang ăn mất ngày công
   của người lao động — làm trước mọi thứ khác.
2. Nạp theo section trong `AdminNexusCenter` *(mục 2)*
3. Bật `core.hooksPath` *(mục 8)* — 1 phút, làm ngay

Kèm một việc không phải code: **dò lại dữ liệu cũ**. Mọi dòng `attendance` có
`status = 'active'` và `check_in_method = 'GPS'` ở các ngày đã qua đều là nạn
nhân tiềm năng của lỗi này — cần đếm xem đã mất bao nhiêu ngày công và bù
trước khi chốt kỳ lương tới.

**Đợt 2 — bịt chỗ sai âm thầm (~0,5 ngày)**

4. Ba chỗ ngày/tháng UTC, thêm `toMonthString()` *(mục 3)*
5. `api/` vào `tsc -b` *(mục 5)*
6. **Quyết hướng A của mục 1**: giữ hay gỡ đường check-in thủ công. Quyết xong
   mới biết `admin.feature_flags`, `work_locations` và bộ geofence là thứ cần
   trả lại giao diện hay thứ cần xoá *(kéo theo mục 4)*.

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
