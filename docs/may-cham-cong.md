# Tích hợp máy chấm công Ronald Jack / ZKTeco

Toàn bộ mã đã có sẵn trong repo. Tài liệu này là thứ tự các bước để nối máy thật vào HRM.

## Vì sao phải có "bridge" chứ không nối trực tiếp

Máy chấm công nói giao thức nhị phân ZKTeco trên cổng 4370 và chỉ tồn tại ở IP nội bộ
(`192.168.x.x`). Không đưa kết nối trực tiếp tới máy chấm công ra Internet: mở thiết bị
firmware cũ, không HTTPS, cho cả thế giới là rủi ro bảo mật.

Nên đường đi là:

```
Máy chấm công  ──LAN, cổng 4370──>  Bridge (một máy tính trong cùng mạng)
                                        │
                                        │ HTTPS + token
                                        ▼
                              Supabase RPC ingest_attendance_device_events()
                                        │
                                        ▼
                              bảng attendance  ──>  bảng lương
```

IP máy và comm key **chỉ nằm trên máy tính chạy bridge**, không bao giờ lên server.

## Cần chuẩn bị

- Một máy tính Windows **cùng mạng LAN** với máy chấm công, bật 24/7 (hoặc ít nhất bật
  trong giờ làm). Máy này chạy bridge.
- Node.js 20.19 trở lên trên máy đó.
- IP, cổng, comm key của máy chấm công: xem ngay trên máy.
  IP và cổng ở `Menu > Comm > Ethernet`; comm key thường ở `Menu > Comm > PC Connection`
  (firmware cũ ghi là `Security` hoặc `COMM Key`, có máy gộp vào `Options > Comm Opt`).
- **Quyền admin trên chính máy chấm công** (vân tay admin hoặc mật khẩu menu) — không có
  thì không mở được các mục trên.
- Quyền Admin/CEO trong HRM để tạo token.

## Bước 1 — Nạp phần máy chấm công vào database

Trước khi cấu hình bridge, xác nhận các migration chấm công đã được triển khai trên đúng
Supabase project. Không suy ra trạng thái production từ file SQL trong repo.

Ưu tiên triển khai các migration trong `supabase/migrations` theo thứ tự. Nếu môi trường
vẫn dùng SQL Editor, `supabase/paste-attendance-devices.sql` cài phần tích hợp thiết bị,
sau đó chạy các migration chấm công mới hơn theo thứ tự:

| gộp từ | làm gì |
| --- | --- |
| `20260926100000_attendance_devices` | Bảng thiết bị, ánh xạ nhân viên, token bridge, log thô, RPC nạp sự kiện. |
| `20260927130000_attendance_device_autoapprove` | Ngày công từ máy tự động duyệt, không cần ai duyệt tay. |
| `20260930230000_attendance_device_arrival_only` | Máy chỉ ghi giờ vào: một lần quét = một ngày công, `check_out_time` để NULL. |
| `20261007113000_security_payroll_attendance_hardening` | Token hết hạn, luân chuyển token có thời gian chuyển tiếp, và log tổng hợp lần xác thực sai. |

Thứ tự trong file là cố ý — phần sau thay thân hàm của phần trước.

**Thiếu phần 2:** ngày công mắc ở `approved_by_lead = false`, mà màn "Duyệt chấm công" đã bị
bỏ khỏi menu nên không còn cách nào đặt cờ đó thành true — bảng lương ra ~0 ngày công cho
tất cả mọi người mà không báo lỗi gì.

**Thiếu phần 3:** 93% ngày ở máy này chỉ có **một** lần chấm, không có giờ ra. Trigger
`guard_attendance_approval` chặn duyệt khi thiếu giờ ra, nên mỗi lời gọi đồng bộ sẽ **văng
exception** — bridge không chạy được lần nào.

Xong thì kiểm chứng: dán `supabase/check_migrations.sql` vào SQL Editor và Run. Hai dòng
`20260926100000_attendance_devices` và `20260927130000_attendance_device_autoapprove` phải
ra `✅ ĐÃ CHẠY`. Hoặc chạy `pnpm attendance:doctor` — bước 6 của nó báo ngay nếu RPC còn thiếu.

## Bước 2 — Khai máy trong HRM và lấy token

1. Vào HRM > **Máy chấm công** (`/admin/attendance-devices`).
2. **Thêm máy**: tên, model, chọn địa điểm làm việc. Serial để trống được, bước 4 sẽ đọc ra.
3. Bấm **Tạo token bridge**. Token dạng `rj_...` **chỉ hiện đúng một lần** — copy ngay.
   Token mới hết hạn sau 90 ngày. Khi tạo token thay thế, token cũ còn hiệu lực tối đa
   7 ngày để cập nhật cấu hình; hãy dán token mới vào máy bridge và khởi động lại trong
   khoảng thời gian này. Không dùng lại token/hash cố định từ script SQL.

Gắn địa điểm có tác dụng thật: ngày công do máy tạo ra sẽ mang `location_id` đó, và
trigger kiểm tra toạ độ GPS được bỏ qua cho nguồn `DEVICE` (máy vật lý đã cố định chỗ
rồi, không cần trình duyệt báo toạ độ).

## Bước 3 — Điền cấu hình trên máy chạy bridge

File `.env.attendance-bridge` đã được tạo sẵn ở gốc dự án, phần Supabase đã điền từ
`.env.local`. Chỉ cần sửa ba chỗ:

```ini
ATTENDANCE_BRIDGE_TOKEN=rj_...     # token vừa copy ở bước 2
RJ_DEVICE_IP=192.168.110.197       # IP thật của máy chấm công
RJ_COMM_KEY=<mật khẩu kết nối>     # xem Ronald Jack Pro > Quản lý thiết bị
```

Máy hiện tại đã dò ra và điền sẵn: `192.168.110.197:4370`, MAC `00:17:61:11:4D:F6`,
serial `1313245000324`, firmware `Ver 6.60 Feb 7 2025`, 46 người dùng. Máy đang lấy IP qua
**DHCP** — nên đặt IP tĩnh hoặc reservation theo MAC, nếu không bridge sẽ im lặng ngừng
chảy dữ liệu vào ngày máy đổi địa chỉ.

File này nằm trong `.gitignore`, không bị đẩy lên git.

Nếu máy đã chạy nhiều năm và giữ hàng chục nghìn bản ghi, đặt thêm:

```ini
RJ_BACKFILL_DAYS=30
```

Giao thức ZKTeco không có lệnh "đọc từ mốc X" — thư viện vẫn tải hết rồi lọc phía client,
nhưng đặt mốc giúp mỗi vòng poll đỡ phải băm lại toàn bộ bản ghi cũ đã đồng bộ từ lâu.
Để `0` là xét toàn bộ. Đồng bộ trùng không sinh dữ liệu trùng: mỗi lần chấm có một
`external_id` băm từ nội dung bản ghi, RPC chặn ở đó.

## Bước 4 — Dò trước khi đồng bộ

```bash
pnpm attendance:doctor
```

Script này **chỉ đọc**, không tạo ngày công nào. Nó đi lần lượt sáu mắt và dừng đúng chỗ
hỏng, kèm cách sửa:

1. Biến môi trường có đủ và đúng định dạng chưa.
2. Có tới được `IP:4370` không — phân biệt sai IP, sai cổng, và firewall chặn.
3. Bắt tay được chưa — phân biệt sai comm key với máy im lặng.
   In ra serial, firmware, số bản ghi, và **độ lệch đồng hồ máy** so với máy tính.
4. Danh sách mã nhân viên đã đăng ký trên máy.
5. Vài lần chấm gần nhất, kèm cách bridge hiểu mã `status` (chỉ hiện khi có `--logs`).
6. Token có được Supabase nhận không.

Lệch đồng hồ là lỗi âm thầm nhất: ngày công vẫn vào đủ, chỉ giờ vào/ra sai đúng bằng
khoảng lệch, không có cảnh báo nào ở đâu. Lệch quá 2 phút thì chỉnh giờ ngay trên máy.

Hai tuỳ chọn hay dùng:

```bash
pnpm attendance:doctor -- --users --logs=20
```

`--users` in hết danh sách người trên máy (mặc định chỉ 15 dòng đầu), `--logs=20` in 20
lần chấm gần nhất kèm mã `status` mà máy này thực dùng.

## Bước 5 — Ánh xạ mã nhân viên

Bridge cần biết mã trên máy ứng với ai trong HRM. Có hai đường:

- **Tự nhận**: mã trên máy trùng `employee_code` trong HRM thì khớp luôn, không cần khai gì.
  Đây là cách nên nhắm tới — đặt User ID trên máy đúng bằng mã nhân viên.
- **Khai tay**: HRM > Máy chấm công > **Ánh xạ nhân viên**, nhập mã máy và chọn người.

Dùng bảng ở bước 4 để đối chiếu. Người nào trên máy không có User ID thì bản ghi của họ
bị bỏ qua hoàn toàn — phải đặt mã cho họ ngay trên máy chấm công.

Bản ghi chưa ánh xạ **không bị mất**: nó nằm chờ trong `attendance_device_events` với cờ
`UNMAPPED_USER`, hiện ở ô **Mã chưa ánh xạ** trên trang HRM. Bấm vào mã đó, chọn nhân
viên, rồi lần đồng bộ sau sẽ xử lý nốt phần chờ — kể cả bản ghi từ nhiều ngày trước.

## Bước 6 — Đồng bộ thật

Một lần, để xem kết quả:

```bash
pnpm attendance:sync
```

Chạy liên tục (mặc định 5 phút một vòng, đổi bằng `RJ_POLL_MINUTES`):

```bash
pnpm attendance:bridge
```

Kiểm tra trên HRM: trang Máy chấm công phải đổi trạng thái thành **Ổn định**, kèm mốc
"Đồng bộ gần nhất". Ngày công xuất hiện ở trang chấm công với `check_in_method = DEVICE`.

## Bước 7 — Cho bridge tự chạy lại sau khi khởi động máy

Mở cửa số terminal rồi để đó là không đủ: ai đó đóng cửa sổ, hoặc Windows Update khởi
động lại máy, là ngày công ngừng chảy vào HRM mà không có cảnh báo nào — đến kỳ lương
mới phát hiện thiếu.

```bash
powershell -ExecutionPolicy Bypass -File tools\attendance-bridge-install-task.ps1
```

Script đăng ký Scheduled Task `HRM Attendance Bridge`, chạy lúc đăng nhập, tự khởi động
lại sau 5 phút nếu bridge chết. Không cần quyền Administrator vì task chạy dưới chính tài
khoản đang đăng nhập — đổi lại, máy phải được đăng nhập vào một tài khoản.

Xem log:

```bash
Get-Content logs\attendance-bridge.log -Tail 30 -Wait
```

Gỡ task:

```bash
Unregister-ScheduledTask -TaskName "HRM Attendance Bridge" -Confirm:$false
```

## Cách bridge quy ra ngày công

Máy đang dùng (`ZMM510_TFT`, serial `1313245000324`) **chỉ ghi giờ vào**. Số liệu thật từ
7262 bản ghi, 2025-06-03 → 2026-09-30:

- 93% cặp người-ngày chỉ có **đúng một** lần chấm (6221/6725).
- 93% lần chấm rơi vào khung 07h–08h. Buổi chiều gần như trống.
- Trong 504 cặp có từ 2 lần trở lên, **65% cách nhau dưới 1 giờ** — quét lại, không phải về sớm.
- Trường `status` chỉ có hai giá trị `1` và `15`, cả hai đều xuất hiện lúc 7–8h sáng, nên
  **không mã nào là "ra về"**. `verifyMode = 255` ở mọi bản ghi.

Vì vậy mô hình là: **một lần quét = một ngày công**.

- **Giờ vào** = lần chấm sớm nhất trong ngày.
- **Giờ ra** = để trống (`NULL`). Không suy từ lần quét cuối — lần thứ hai ở máy này hầu hết
  là quét lại sau vài phút, dùng làm giờ ra thì báo cáo sẽ nói người đó làm 5 phút.
- Trạng thái = `completed`, tự động duyệt. Ngày công vào bảng lương đủ.
- **Giờ công** = `workHours` bằng 0 nên `computePeriodStats` dùng nhánh dự phòng
  `workDays × hoursPerDay`. Đây là lý do phải để `NULL` thay vì bịa giờ ra: chỉ cần một
  ngày trong tháng có khoảng cách thật là `workHours > 0`, và tổng giờ cả tháng tụt xuống
  còn đúng hôm đó — khoản lương tính theo giờ sẽ trả thiếu mà không báo lỗi.

Vì `status` không mang nghĩa vào/ra, `.env.attendance-bridge` khai rỗng hai biến:

```ini
RJ_IN_STATUS_CODES=
RJ_OUT_STATUS_CODES=
```

Nếu sau này đổi sang máy **có** chấm giờ ra thật, bật cờ trên thiết bị đó:

```sql
update public.attendance_devices set records_checkout = true where id = '<id thiết bị>';
```

Khi đó hàm quay lại cách gộp cũ: giờ ra = lần chấm có `punch_type` là `OUT`, không có thì
lấy lần chấm muộn nhất khi ngày đó có từ hai lần.


## Khi có sự cố

| Hiện tượng | Nguyên nhân thường gặp |
| --- | --- |
| Doctor dừng ở bước 2, `timeout` | Máy tính không cùng dải mạng với máy chấm công, hoặc firewall Windows chặn. Thử `ping <IP>`. |
| Doctor dừng ở bước 2, `ECONNREFUSED` | IP đúng nhưng cổng sai. Kiểm tra `RJ_DEVICE_PORT`. |
| Doctor dừng ở bước 3, "từ chối comm key" | `RJ_COMM_KEY` không khớp comm key trên máy (`Comm > PC Connection`, hoặc `Security` / `COMM Key` ở firmware cũ). |
| Doctor dừng ở bước 3, "mất kết nối" | Máy đang phục vụ một kết nối khác. Đóng phần mềm quản lý máy của hãng rồi thử lại. |
| Doctor dừng ở bước 3, "im lặng quá hạn" | Firmware cần UDP: đặt `RJ_TRANSPORT=udp`. Hoặc tăng `RJ_TIMEOUT_MS`. |
| Doctor dừng ở bước 6, "chưa có RPC" | Migration bước 1 chưa chạy. |
| Doctor dừng ở bước 6, "token bị từ chối" | Token sai/đã thu hồi, hoặc thiết bị bị tắt (`is_active = false`) trong HRM. |
| HRM báo **Cần ánh xạ** | Có mã máy chưa gắn nhân viên. Xem bước 5. |
| Giờ vào/ra lệch đều nhau | Đồng hồ máy chấm công sai. Doctor bước 3 báo rõ lệch bao nhiêu phút. |
| Lương ra 0 ngày công | Migration `20260927130000_attendance_device_autoapprove` chưa chạy. |

Đổi token định kỳ trước hạn 90 ngày, hoặc ngay khi nghi bị lộ: tạo token mới trong HRM,
cập nhật `.env.attendance-bridge`, khởi động lại bridge và xác nhận doctor/đồng bộ chạy
thành công. Sau khi xác nhận, có thể bấm **Thu hồi token** để vô hiệu hóa token cũ ngay.
HRM chỉ lưu bản băm SHA-256, không lưu token gốc. Số lần xác thực sai được gom theo phút
trong `attendance_device_auth_failures`; bảng này không lưu token hay địa chỉ thiết bị.
