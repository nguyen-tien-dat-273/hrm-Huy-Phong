# Tích hợp máy chấm công Ronald Jack / ZKTeco

Toàn bộ mã đã có sẵn trong repo. Tài liệu này là thứ tự các bước để nối máy thật vào HRM.

## Vì sao phải có "bridge" chứ không nối trực tiếp

Máy chấm công nói giao thức nhị phân ZKTeco trên cổng 4370 và chỉ tồn tại ở IP nội bộ
(`192.168.x.x`). Website chạy trên Vercel không thể với tới IP đó, và cũng không nên: mở
máy chấm công ra Internet là mở luôn một thiết bị firmware cũ, không HTTPS, cho cả thế giới.

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
- IP, cổng, comm key của máy chấm công: xem ngay trên máy, `Menu > Comm > Ethernet` và
  `Menu > Comm > Security`.
- Quyền Admin/CEO trong HRM để tạo token.

## Bước 1 — Nạp phần máy chấm công vào database

Tính đến 30/09/2026, Supabase của dự án **chưa có** bảng và RPC của máy chấm công — hai
migration dưới đây chưa được chạy. Đây là điểm chặn đầu tiên, làm xong mới đi tiếp được.

Mở Supabase > SQL Editor, dán cả file **`supabase/paste-attendance-devices.sql`** rồi Run.
File này là hai migration gộp lại, comment đã chuyển hết sang ASCII để dán không lỗi
encoding, và mọi câu lệnh đều chạy lại được nhiều lần:

| gộp từ | làm gì |
| --- | --- |
| `20260926100000_attendance_devices` | Bảng thiết bị, ánh xạ nhân viên, token bridge, log thô, RPC nạp sự kiện. |
| `20260927130000_attendance_device_autoapprove` | Thay thân RPC: ngày công từ máy tự động duyệt. |

Thứ tự trong file là cố ý. Chạy riêng phần đầu thì ngày công từ máy mắc ở
`approved_by_lead = false`, và vì màn "Duyệt chấm công" đã bị bỏ khỏi menu nên **không còn
cách nào đặt cờ đó thành true** — bảng lương ra ~0 ngày công cho tất cả mọi người mà không
báo lỗi gì, vì truy vấn vẫn chạy đúng, chỉ là không còn dòng nào thoả điều kiện.

Xong thì kiểm chứng: dán `supabase/check_migrations.sql` vào SQL Editor và Run. Hai dòng
`20260926100000_attendance_devices` và `20260927130000_attendance_device_autoapprove` phải
ra `✅ ĐÃ CHẠY`. Hoặc chạy `pnpm attendance:doctor` — bước 6 của nó báo ngay nếu RPC còn thiếu.

## Bước 2 — Khai máy trong HRM và lấy token

1. Vào HRM > **Máy chấm công** (`/admin/attendance-devices`).
2. **Thêm máy**: tên, model, chọn địa điểm làm việc. Serial để trống được, bước 4 sẽ đọc ra.
3. Bấm **Tạo token bridge**. Token dạng `rj_...` **chỉ hiện đúng một lần** — copy ngay.

Gắn địa điểm có tác dụng thật: ngày công do máy tạo ra sẽ mang `location_id` đó, và
trigger kiểm tra toạ độ GPS được bỏ qua cho nguồn `DEVICE` (máy vật lý đã cố định chỗ
rồi, không cần trình duyệt báo toạ độ).

## Bước 3 — Điền cấu hình trên máy chạy bridge

File `.env.attendance-bridge` đã được tạo sẵn ở gốc dự án, phần Supabase đã điền từ
`.env.local`. Chỉ cần sửa ba chỗ:

```ini
ATTENDANCE_BRIDGE_TOKEN=rj_...   # token vừa copy ở bước 2
RJ_DEVICE_IP=192.168.1.201       # IP thật của máy chấm công
RJ_COMM_KEY=0                    # comm key trên máy, chưa đặt thì để 0
```

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

Mỗi nhân viên, mỗi ngày (theo `timezone` khai ở thiết bị, mặc định `Asia/Ho_Chi_Minh`):

- **Giờ vào** = lần chấm sớm nhất trong ngày.
- **Giờ ra** = lần chấm gần nhất có `status` nằm trong `RJ_OUT_STATUS_CODES`; không có thì
  lấy lần chấm muộn nhất, miễn là ngày đó có từ hai lần chấm.
- Chấm đúng một lần trong ngày thì ngày công để trạng thái `active` (chưa ra), không tự
  bịa giờ ra.
- Ngày công từ máy được **tự động duyệt** (`approved_by_lead = true`) — người đã qua vân
  tay/khuôn mặt tại máy rồi, không cần ai duyệt lại tay.
- Nhân viên tự check-in bằng GPS rồi quét máy lúc về: hệ thống giữ giờ vào GPS và lấy giờ
  ra từ máy.

Mã `status` khác nhau theo firmware. Bước 4 với `--logs` in ra đúng các mã máy đang dùng;
nếu bridge hiểu sai chiều vào/ra thì sửa `RJ_IN_STATUS_CODES` / `RJ_OUT_STATUS_CODES`. Máy
không phân biệt vào/ra (tất cả cùng một mã) cũng chạy được: quy tắc lần đầu/lần cuối ở
trên vẫn đúng.

## Khi có sự cố

| Hiện tượng | Nguyên nhân thường gặp |
| --- | --- |
| Doctor dừng ở bước 2, `timeout` | Máy tính không cùng dải mạng với máy chấm công, hoặc firewall Windows chặn. Thử `ping <IP>`. |
| Doctor dừng ở bước 2, `ECONNREFUSED` | IP đúng nhưng cổng sai. Kiểm tra `RJ_DEVICE_PORT`. |
| Doctor dừng ở bước 3, "từ chối comm key" | `RJ_COMM_KEY` không khớp `Menu > Comm > Security`. |
| Doctor dừng ở bước 3, "mất kết nối" | Máy đang phục vụ một kết nối khác. Đóng phần mềm quản lý máy của hãng rồi thử lại. |
| Doctor dừng ở bước 3, "im lặng quá hạn" | Firmware cần UDP: đặt `RJ_TRANSPORT=udp`. Hoặc tăng `RJ_TIMEOUT_MS`. |
| Doctor dừng ở bước 6, "chưa có RPC" | Migration bước 1 chưa chạy. |
| Doctor dừng ở bước 6, "token bị từ chối" | Token sai/đã thu hồi, hoặc thiết bị bị tắt (`is_active = false`) trong HRM. |
| HRM báo **Cần ánh xạ** | Có mã máy chưa gắn nhân viên. Xem bước 5. |
| Giờ vào/ra lệch đều nhau | Đồng hồ máy chấm công sai. Doctor bước 3 báo rõ lệch bao nhiêu phút. |
| Lương ra 0 ngày công | Migration `20260927130000_attendance_device_autoapprove` chưa chạy. |

Đổi token khi nghi bị lộ: HRM > Máy chấm công > **Thu hồi token**, tạo token mới, dán lại
vào `.env.attendance-bridge`, khởi động lại bridge. Token cũ chết ngay lập tức — HRM chỉ
lưu bản băm SHA-256, không lưu token gốc.
