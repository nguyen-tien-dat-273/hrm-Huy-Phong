# Đưa HRM Huy Phong lên VPS (tự host toàn bộ, không dùng Supabase Cloud)

**Cập nhật:** 13/11/2026 · **Gói VPS:** Nhân Hòa NVMe Cloud VPS B (2 core, 2.5 GB + 0.5 GB RAM, 40 GB NVMe), Ubuntu 24.04.

**Đã kiểm trên máy dev** (trong một "VPS giả" Linux có Docker riêng): cài Supabase rút gọn, deploy app, `status`, sao lưu, xoá trắng rồi khôi phục. Kết quả ở mục 12. **Chưa làm trên VPS thật**, và **chưa chuyển dữ liệu thật từ Supabase Cloud** (cần chuỗi kết nối Cloud).

---

## Kế hoạch triển khai (đọc trước, làm theo thứ tự)

**Nguyên tắc:** hệ thống cũ (Vercel + Supabase Cloud + Worker) **chạy nguyên** cho tới đúng bước chuyển; mỗi giai đoạn có **cửa qua** (không đạt thì dừng, không sang giai đoạn sau); luôn còn đường quay lại cho tới 14 ngày sau khi chuyển. Tổng thời gian khoảng 3–4 ngày làm việc, trong đó chỉ **1–2 giờ ngừng ghi** (đêm hoặc cuối tuần).

| GĐ | Việc | Ở đâu | Cửa qua | Mục |
|---|---|---|---|---|
| 0 | **Chốt đầu vào**: có tên miền + quyền DNS, Gmail riêng (mật khẩu ứng dụng) cho SMTP, tài khoản healthchecks.io, Google Drive cho sao lưu ngoài, chép biến môi trường từ Vercel (đặc biệt `VAPID_*`) và chuỗi kết nối Cloud | Máy bạn | Có đủ danh sách mục 2, cất trong trình quản lý mật khẩu | 2 |
| 1 | **Mua VPS** B, Ubuntu 24.04, trả theo tháng; hỏi 4 câu với Nhân Hòa (RAM "+0.5GB", IP cố định, cổng 80/443, nâng gói có cài lại không) | Nhân Hòa | Có IP, SSH vào được, cổng 80/443 không bị chặn | 3 |
| 2 | **Chuẩn bị máy chủ**: khoá SSH → `setup-server.sh` → `--harden-ssh`; trỏ DNS | VPS | `ssh deploy@IP` vào bằng khoá; mật khẩu bị tắt; ufw chỉ 22/80/443 | 4 |
| 3 | **Cài Supabase rút gọn** + SMTP | VPS | `install-supabase.sh` báo "Auth, Storage, Postgres: OK"; email thử "Quên mật khẩu" tới được | 5, 6 |
| 4 | **Dựng và đưa app lên** (`make-bundle` → `hrm.sh deploy`) | Máy bạn → VPS | `./hrm.sh status` không còn dòng ✗ ngoài các mục chưa cấu hình có chủ đích | 7 |
| 5 | **Sao lưu ra ngoài + giám sát**: rclone (mã hoá) và healthchecks.io | VPS | `./hrm.sh backup` ra "Đã chép ra ngoài"; **tự lấy một bản về và `sha256sum -c` khớp** | 9 |
| 6 | **Diễn tập** (làm hết 8.1–8.2 trên bản sao Cloud, người dùng cũ vẫn dùng hệ thống cũ) | VPS | `restore` báo **KHỚP**; checklist 8.2 đạt (kể cả phiếu lương trùng số, chấm công thử, quy tắc check-in) | 8.1–8.2 |
| 7 | **Nghiệm thu với người dùng thật** trên VPS (1–2 người mỗi vai: admin, HR, trưởng phòng, nhân viên) | Trình duyệt | Mọi người báo đúng quyền và đúng số liệu; **quyết định ĐI / DỪNG** (xem dưới) | 8.2 |
| 8 | **Chuyển thật**: ngừng ghi → sao lưu Cloud lần cuối → xoá bản diễn tập → khôi phục → trỏ Worker sang VPS → mở lại | VPS + máy bạn | `KHỚP`; máy chấm công đồng bộ về VPS; người dùng đăng nhập được | 8.3, 8.4 |
| 9 | **Theo dõi** 24 giờ đầu, rồi 14 ngày; sau đó dọn hệ thống cũ | — | Sao lưu hằng đêm đều; RAM còn ≥ 300 MB; không ai báo thiếu dữ liệu | 8.3, 11 |

**Quyết định ĐI / DỪNG (cuối GĐ 7).** Chỉ ĐI khi đạt cả bốn: (1) `restore` khớp 100% số dòng; (2) phiếu lương kỳ đã khoá trùng Cloud ở mọi trường hợp đã so; (3) đã khôi phục thử **từ bản sao lưu ngoài** (không chỉ từ ổ VPS); (4) bạn nhắn được cho người ở công ty trong ngày chuyển phòng khi máy chấm công cần xử lý tay. Còn thiếu một trong bốn thì lùi một tuần, không chuyển vội.

**Ngày chuyển (gợi ý tối thứ Sáu hoặc sáng Chủ nhật, ít người chấm công):**

| Giờ | Việc |
|---|---|
| T−1 ngày | Báo toàn công ty giờ ngừng. Kiểm `./hrm.sh status` sạch. Cloud và VPS đều đã đăng nhập sẵn trên máy bạn. Chạy `cloud-backup` thử để đo thời gian. |
| T+0:00 | Chặn ghi ở bản cũ (đổi tạm mật khẩu quản trị / tạm dừng Vercel). Tắt cron Vercel. |
| T+0:10 | `./hrm.sh wipe-supabase` → `cloud-backup` → `restore` → phải `KHỚP`. |
| T+0:40 | `./hrm.sh backup`. Trỏ Worker sang VPS (8.4 cách A). Quét thử một lần ở máy chấm công (nhờ người ở công ty, hoặc đợi giờ quét đầu tiên). |
| T+1:00 | Mở cho người dùng. Gửi đường dẫn mới. |
| T+2:00 | Xem `status` + `logs hrm`. Đạt thì kết thúc; có lỗi nặng thì **quay lại** (8.3) ngay, không sửa tại chỗ. |

**Rủi ro lớn nhất và cách chặn:**

| Rủi ro | Cách chặn |
|---|---|
| Khôi phục lỗi vì lệch phiên bản schema `auth` giữa Cloud và bản tự host | Diễn tập ở GĐ 6 trước khi có người dùng; sao lưu **chạy trên VPS** (cùng `pg_dump` 17) |
| Mất dữ liệu khi VPS hỏng | Sao lưu ngoài mã hoá + đã khôi phục thử từ bản ngoài; mất file `/opt/supabase/.env` vẫn khôi phục được (dựng lại giao diện với khoá mới) |
| Hết RAM làm Postgres bị giết | Giới hạn bộ nhớ từng container, swap 2 GB, `oom_score_adj` cho Postgres; theo dõi bằng `status`; nâng gói C nếu RAM < 300 MB kéo dài |
| Máy chấm công ngừng gửi vì đổi địa chỉ | Cách A (đổi secret Worker, máy không đổi gì) |
| Quên gia hạn VPS | Bật tự động gia hạn nếu có, hoặc đặt nhắc lịch trước hạn 7 ngày |
| Quên `VAPID_*` cũ | Giữ nguyên cặp khoá từ Vercel (đổi là mọi thiết bị mất thông báo đẩy) |
| Hai migration trùng mốc `20261021100000` (đã có từ trước trong repo) | **Không đổi tên** (tên nằm trong lịch sử database đang chạy). `pnpm supabase:local:check` sẽ báo lỗi này; không ảnh hưởng khôi phục từ bản sao lưu |

**Trước khi đóng gói mỗi lần (máy bạn):** `pnpm build` (gồm eslint + tsc) đạt, `pnpm check:all` đạt, mọi thay đổi đã commit (gói ghi `dirty=true` nếu chưa).

---

## 1. Kiến trúc

```
Máy chấm công ──HTTP :80  /iclock/*──────┐
Trình duyệt   ──HTTPS :443───────────────┤
                                         ▼
                              Caddy (HTTPS tự động, Let's Encrypt)
                 /auth/v1 /rest/v1 /realtime/v1 /storage/v1 │ còn lại (giao diện, /api, /iclock)
                                   ▼                         ▼
                     Supabase rút gọn (api-gw/Envoy)     hrm (Node: React + API)
                     auth · rest · realtime · storage
                                   ▼
                     Postgres 17 (dữ liệu trên ổ VPS) ◄── backup (2h sáng mỗi ngày)
                                                            └─► rclone ─► Google Drive (mã hoá)
```

- **Một tên miền** cho cả giao diện lẫn API Supabase (ví dụ `hrm.congty.vn`). Không cần CORS, không cần tên miền thứ hai.
- **Supabase rút gọn:** chỉ chạy 6 dịch vụ HRM cần (db, auth, rest, realtime, storage, api-gw). Tắt Studio (bật khi cần), Edge Functions, imgproxy, Supavisor. **RAM đo thật khi rảnh: khoảng 470 MB** (realtime ~230, storage ~90, db ~80, còn lại < 40 mỗi dịch vụ).
- **Chỉ cổng 80 và 443 mở ra Internet** (Caddy). Postgres, Studio, API nội bộ chỉ nghe trong mạng Docker hoặc 127.0.0.1.
- Giao diện được **dựng sẵn trên máy bạn**; VPS không chạy `pnpm build` (cần 1–2 GB RAM, dễ làm Postgres bị giết).

| Thư mục trên VPS | Nội dung |
|---|---|
| `/opt/supabase` | Supabase bản chính thức `self-hosted/v0.8.4` + lớp phủ rút gọn. **`.env` ở đây chứa mọi khoá — sao lưu vào trình quản lý mật khẩu.** |
| `/opt/hrm` | Gói triển khai: `compose.yaml`, `Caddyfile`, `hrm.sh`, `app/`, `backup/`… và `.env` (cấu hình HRM). |
| `/opt/hrm-backups` | Bản sao lưu hằng đêm (giữ 14 ngày, file không đổi được hard link nên ít tốn chỗ). |

Các file nguồn trong repo: [deploy/vps/](./), [tools/vps/make-bundle.mjs](../../tools/vps/make-bundle.mjs), [tools/backup/](../../tools/backup/), [tools/vps/restore-db.sh](../../tools/vps/restore-db.sh).

---

## 2. Chuẩn bị trước khi làm

| # | Việc | Ghi chú |
|---|---|---|
| 1 | **Tên miền** và quyền sửa DNS | Tạo bản ghi A `hrm.<tên-miền>` → IP VPS (TTL 300). |
| 2 | **SMTP** để gửi email mã xác minh khi quên mật khẩu | Dễ nhất: Gmail riêng cho HRM, bật xác minh 2 bước, tạo *Mật khẩu ứng dụng*. Mục 6. |
| 3 | **Nơi chép sao lưu ra ngoài** | Google Drive (15 GB miễn phí) qua rclone, mã hoá. Mục 9. |
| 4 | **Giám sát sao lưu** | Tài khoản miễn phí healthchecks.io: báo email khi sao lưu lỗi hoặc không chạy. |
| 5 | **Chép biến môi trường từ Vercel** (Settings › Environment Variables) | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (**giữ nguyên**, đổi thì mọi máy mất thông báo đẩy), `ATTENDANCE_DEVICE_SERIALS`, `RJ_*`. |
| 6 | **Chuỗi kết nối Supabase Cloud** (chỉ cần lúc chuyển dữ liệu) | Dashboard › Connect › *Session pooler* (cổng 5432), `SUPABASE_URL`, khoá `service_role`. Mục 8. |
| 7 | Ghi lại cấu hình **không nằm trong database** | Supabase Cloud › Authentication: mẫu email *Magic Link* (nếu đã sửa), nhà cung cấp SMS (nếu dùng khôi phục qua điện thoại); ảnh chụp cấu hình máy chấm công. |

> **Khoá mới, mật khẩu cũ.** VPS dùng bộ khoá JWT mới, nên sau khi chuyển mọi người phải **đăng nhập lại một lần**, nhưng **mật khẩu giữ nguyên** (mật khẩu băm được chuyển theo tài khoản).

---

## 3. Mua VPS

- Gói **NVMe Cloud VPS B**, hệ điều hành **Ubuntu 24.04** (không chọn 20.04: đã hết hỗ trợ bảo mật), thanh toán **theo tháng** cho tháng đầu.
- Hỏi Nhân Hòa trước khi trả tiền:
  1. Phần RAM "+0.5GB (\*)" là RAM dùng được thường xuyên hay chỉ tạm thời?
  2. IP có công khai và cố định không? Có chặn cổng 80/443 không?
  3. Nâng từ gói B lên C có phải cài lại máy không (giữ dữ liệu)?
  4. Có tự động gia hạn/trừ tiền không? Không có thì **đặt lịch nhắc trước hạn 7 ngày** — VPS bị khoá là HRM và máy chấm công ngừng.

Khi nào nâng lên gói C: `./hrm.sh status` thường xuyên báo RAM còn dưới 300 MB, hoặc swap dùng trên 512 MB kéo dài.

---

## 4. Lần đầu: khoá SSH và chuẩn bị máy chủ

### 4.1 Tạo khoá SSH trên máy Windows (một lần)

PowerShell:

```powershell
ssh-keygen -t ed25519 -C "hrm-vps"          # Enter để nhận đường dẫn mặc định; nên đặt passphrase
type $env:USERPROFILE\.ssh\id_ed25519.pub | ssh root@<IP-VPS> "mkdir -p ~/.ssh && chmod 700 ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"
```

(Lệnh thứ hai hỏi mật khẩu root mà Nhân Hòa gửi.) Thử lại `ssh root@<IP-VPS>`: không hỏi mật khẩu nữa là đúng.

### 4.2 Đóng gói script và chuẩn bị máy chủ

Trên máy bạn (thư mục repo):

```powershell
node tools/vps/make-bundle.mjs --scripts-only
scp hrm-vps-bundle-<…>-scripts.tgz root@<IP-VPS>:/root/
ssh root@<IP-VPS> "mkdir -p /root/hrm && tar -xzf /root/hrm-vps-bundle-<…>-scripts.tgz -C /root/hrm && sh /root/hrm/setup-server.sh"
```

`setup-server.sh` (chạy lại an toàn): cập nhật hệ thống, múi giờ, **swap 2 GB**, Docker + giới hạn log, user `deploy` (chép khoá SSH của root sang), thư mục `/opt/*`, tường lửa (chỉ 22/80/443), tự cài bản vá bảo mật, fail2ban. Script chép luôn bộ cài sang `/opt/hrm`.

### 4.3 Khoá SSH (tắt đăng nhập bằng mật khẩu)

1. Mở cửa sổ **mới**: `ssh deploy@<IP-VPS>` phải vào được, không hỏi mật khẩu.
2. Vào được rồi mới chạy (ở cửa sổ root cũ): `sh /root/hrm/setup-server.sh --harden-ssh`
3. Giữ cửa sổ root, mở cửa sổ mới thử lại `ssh deploy@<IP-VPS>`. Không vào được thì làm theo dòng hoàn tác script in ra.

Từ đây chỉ dùng user `deploy`. **Giữ kỹ file `id_ed25519`** (và sao lưu nó): mất khoá thì chỉ vào lại được qua console web của Nhân Hòa.

---

## 5. Cài Supabase rút gọn

Trỏ DNS `hrm.<tên-miền>` về IP VPS trước (Caddy cần DNS đúng để xin chứng chỉ ở mục 7). Rồi:

```sh
ssh deploy@<IP-VPS>
sh /opt/hrm/install-supabase.sh hrm.congty.vn
```

Script: tải đúng bản Supabase đã ghim, **sinh khoá mới**, đặt URL theo tên miền, tắt tự đăng ký và kênh điện thoại, bật lớp phủ rút gọn, **dừng nếu dịch vụ hoặc cổng mở khác dự kiến**, chạy và kiểm tra Auth/Storage/Postgres, rồi tạo `/opt/hrm/.env` (tên miền, khoá, mật khẩu DB, `CRON_SECRET`…). Cuối cùng in **khoá anon** để dựng giao diện.

Chạy lại script không sinh lại khoá (sinh lại là mất truy cập dữ liệu).

**Sao lưu ngay `/opt/supabase/.env`** vào trình quản lý mật khẩu (`cat /opt/supabase/.env` rồi chép). Mất file này khi VPS hỏng thì vẫn khôi phục được dữ liệu (mục 10), nhưng phải dựng lại giao diện với khoá mới.

---

## 6. Email (SMTP) cho "Quên mật khẩu"

HRM gửi **mã 6 số** qua email (Supabase Auth). Mẫu email tiếng Việt có sẵn ([client/public/email-templates/ma-xac-minh.html](../../client/public/email-templates/ma-xac-minh.html)), Auth tự lấy từ container `hrm`.

Sửa trong `/opt/supabase/.env` (ví dụ Gmail):

```
SMTP_ADMIN_EMAIL=hrm.huyphong@gmail.com
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=hrm.huyphong@gmail.com
SMTP_PASS=<mật khẩu ứng dụng 16 ký tự>
SMTP_SENDER_NAME=HRM Huy Phong
```

Rồi: `cd /opt/hrm && ./hrm.sh supabase up -d auth`. Thử "Quên mật khẩu" với tài khoản có email thật. Gmail giới hạn khoảng 500 email/ngày, thừa cho HRM.

Khôi phục qua **điện thoại (SMS)** đang tắt; cần nhà cung cấp SMS (Twilio…) thì cấu hình `GOTRUE_SMS_*` theo tài liệu Supabase.

---

## 7. Dựng giao diện và chạy HRM

### 7.1 Điền nốt cấu hình

`nano /opt/hrm/.env`: điền `VAPID_*`, `ATTENDANCE_DEVICE_SERIALS` (mục 2.5). Các dòng khác script đã điền.

### 7.2 Dựng và đưa lên (mỗi lần cập nhật phần mềm cũng làm đúng như vậy)

Trên máy bạn:

```powershell
node tools/vps/make-bundle.mjs --domain hrm.congty.vn --anon-key <khoá anon từ mục 5>
scp hrm-vps-bundle-<…>.tgz deploy@<IP-VPS>:/tmp/
ssh deploy@<IP-VPS> "cd /opt/hrm && ./hrm.sh deploy /tmp/hrm-vps-bundle-<…>.tgz"
```

`make-bundle` **từ chối** đóng gói khi: khoá đưa vào không phải `anon` (chặn lộ khoá service), bản dựng còn URL Supabase Cloud / Worker / Vercel cũ, hoặc thiếu file. `deploy` **từ chối** gói dựng cho tên miền hoặc khoá anon khác VPS; build image (chỉ cài thư viện chạy), chạy, kiểm tra `/healthz`, **tự quay về bản trước nếu lỗi**.

Lần đầu Caddy xin chứng chỉ HTTPS trong vài chục giây (cần DNS đúng, cổng 80/443 mở).

### 7.3 Kiểm tra

```sh
./hrm.sh status
```

Báo: container, RAM/swap, ổ đĩa, tuổi bản sao lưu, HTTPS, API Supabase, đường máy chấm công (`http://<tên-miền>/iclock` với sê-ri giả → máy chủ trả "đã khai N sê-ri", không ghi gì vào database), và cấu hình còn thiếu.

---

## 8. Chuyển dữ liệu từ Supabase Cloud

Production hiện tại (Vercel + Cloud) **chạy bình thường** cho đến bước 8.3.

### 8.1 Sao lưu Cloud — chạy NGAY TRÊN VPS

(Chạy trên VPS để `pg_dump` cùng phiên bản với Postgres của VPS; bản dump từ PostgreSQL 18 trên máy Windows có thể không khôi phục được vào 17.)

```sh
nano ~/cloud.env       # giá trị đặt trong nháy đơn
```
```
SUPABASE_DB_URL='postgresql://postgres.<ref>:<mật-khẩu-DB>@aws-0-<vùng>.pooler.supabase.com:5432/postgres'
SUPABASE_URL='https://<ref>.supabase.co'
SUPABASE_SERVICE_ROLE_KEY='<khoá service_role của Cloud>'
```
```sh
chmod 600 ~/cloud.env
cd /opt/hrm && ./hrm.sh cloud-backup ~/cloud.env
```

Kết quả: `/opt/hrm-backups/cloud/<UTC>/` có `COMPLETE`. Quên mật khẩu DB Cloud: Dashboard › Project Settings › Database › Reset password (không ảnh hưởng khoá API).

### 8.2 Diễn tập khôi phục (bắt buộc, trước khi có người dùng thật)

```sh
./hrm.sh restore /opt/hrm-backups/cloud/<UTC>
```

Lần lượt: kiểm checksum → `public` (cấu trúc, dữ liệu, quyền) → bucket → chính sách Storage + realtime → tài khoản → file Storage → **đối chiếu số dòng từng bảng** (phải báo `KHỚP`). Script **từ chối chạy** khi Supabase đích đã có dữ liệu.

Kiểm tra bằng tay trên `https://<tên-miền>`:

- [ ] Admin / HR / trưởng phòng / nhân viên đăng nhập bằng **mật khẩu cũ**, đúng quyền, đúng dữ liệu.
- [ ] Mở vài phiếu lương kỳ đã khoá: **tổng tiền trùng với bản Cloud** (so từng người, vài trường hợp).
- [ ] Bảng công tháng này khớp; chấm công thử.
- [ ] Mở được tệp cũ: hồ sơ nhân viên, chứng từ đề xuất tuyển dụng, minh chứng công việc, bài nộp đào tạo, minh chứng KPI.
- [ ] Chuông thông báo thời gian thực, thông báo đẩy trên điện thoại, trợ lý hỏi đáp.
- [ ] Quên mật khẩu: email có **mã 6 số** tới thật.
- [ ] `./hrm.sh backup` ra `COMPLETE`.

Lỗi ở bước tài khoản (thường do lệch phiên bản schema `auth` giữa Cloud và bản tự host) → `./hrm.sh wipe-supabase`, sửa, làm lại. Đây là lý do phải diễn tập.

*Mọi thứ nhập trên VPS trong lúc diễn tập sẽ bị xoá ở bước 8.3.*

### 8.3 Chuyển thật (tối/cuối tuần, ngừng ghi 1–2 giờ)

1. Báo người dùng ngừng nhập. Chặn ghi trên bản cũ (đổi tạm mật khẩu quản trị hoặc tạm dừng project Vercel). Tắt cron Vercel.
2. `./hrm.sh wipe-supabase` (xoá dữ liệu diễn tập, giữ khoá).
3. `./hrm.sh cloud-backup ~/cloud.env` → `./hrm.sh restore /opt/hrm-backups/cloud/<UTC mới>` → phải `KHỚP`.
   Rồi thu gọn như lúc diễn tập (chỉ giữ admin/ceo + "Vượng" + cấu hình): `./hrm.sh prune-keep` (xem báo cáo) → `./hrm.sh prune-keep --apply`.
4. `./hrm.sh backup` (bản sao lưu đầu tiên của hệ thống mới). Rồi `shred -u ~/cloud.env`.
5. Máy chấm công: **trỏ Cloudflare Worker sang VPS** (mục 8.4, cách A — không cần ai ở công ty).
6. Gửi đường dẫn mới cho nhân viên (cài lại ứng dụng trên điện thoại nếu tên miền đổi).
7. Theo dõi `./hrm.sh logs hrm` khoảng 1 giờ.

**Quay lại** nếu lỗi nặng trong 24 giờ đầu: mở lại Vercel + Cloud (còn nguyên) và đặt lại 2 secret của Worker về Cloud (mục 8.4). Dữ liệu nhập trên VPS sau khi chuyển phải nhập lại tay, nên **quyết định đi/dừng sớm**.

Sau 14 ngày ổn định: tắt Vercel, Supabase Cloud; xoá `vercel.json` và thư mục `cloudflare/` khỏi repo (và Worker `hic` trên Cloudflare) khi máy đã gọi thẳng vào VPS (8.4, cách B).

### 8.4 Máy chấm công

Hiện máy đang gọi `http://hic.<tài-khoản>.workers.dev` (Cloudflare Worker), Worker ghi vào Supabase Cloud. Worker chỉ đọc hai secret `SUPABASE_URL` và `SUPABASE_SERVICE_ROLE_KEY`, nên có hai cách:

**Cách A — làm ngay lúc chuyển, không cần đụng vào máy chấm công (khuyên dùng khi không có ai ở công ty).** Trên máy bạn, trong `cloudflare/iclock/`:

```powershell
npx wrangler secret put SUPABASE_URL                 # nhập: https://hrm.<tên-miền>
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY    # nhập: SERVICE_ROLE_KEY trong /opt/supabase/.env (khoá MỚI của VPS)
```

Máy vẫn gọi địa chỉ cũ, dữ liệu giờ chảy vào VPS. Kiểm: quét thử một lần, `./hrm.sh logs hrm` không thấy gì (Worker đi qua API Supabase, không qua container `hrm`), nhưng HRM › Máy chấm công › "Đồng bộ gần nhất" phải cập nhật. **Quay lại** = đặt lại hai secret về Supabase Cloud.

**Cách B — khi có người ở công ty (làm sau, không gấp).** Trên máy: Thiết lập liên kết › **Cài đặt máy chủ đám mây**: địa chỉ = `hrm.<tên-miền>` (bật tên miền) **hoặc IP VPS**, cổng **80**, **tắt HTTPS**. Khởi động lại máy. Khi đó máy gọi thẳng `/iclock/*` của container `hrm` (đã kiểm: bắt tay, sê-ri lạ bị 403). Sau bước này mới được bỏ Worker.

Cả hai cách: sê-ri phải có trong `ATTENDANCE_DEVICE_SERIALS` (Cách B: trong `/opt/hrm/.env`; Cách A: trong secret của Worker, đã có sẵn). Máy đẩy bù dữ liệu; trùng lặp đã được chặn (`external_id`).

**Quy tắc "đã quét máy thì không check-in trên HRM nữa"** do database bảo đảm (migration `20261008100000` + `20261113100000`), nên tự đi theo bản khôi phục. Kiểm sau khi khôi phục (mục 8.2): chạy
`select tgname from pg_trigger where tgrelid='public.attendance'::regclass and not tgisinternal;`
phải có `attendance_block_manual_after_device` và `attendance_01_guard_self_checkin`.

---

## 9. Sao lưu

**Tự động:** container `backup` chạy **2 giờ sáng** mỗi ngày (`BACKUP_HOUR`):

1. Kiểm ổ đĩa còn đủ chỗ (không thì báo lỗi, không làm đầy ổ).
2. Sao lưu đầy đủ: database (toàn bộ + riêng `public`, `auth`, `storage`), mọi file Storage, kiểm kê số dòng, checksum; chỉ hoàn tất khi có `COMPLETE`. File Storage không đổi so với hôm trước được **hard link** (mỗi bản vẫn đầy đủ nhưng không tốn thêm chỗ).
3. Giữ **14 ngày** trên VPS (`BACKUP_KEEP_DAYS`, luôn giữ tối thiểu 3 bản).
4. Chép ra ngoài bằng rclone (nếu cấu hình): `db/<UTC>/` mỗi ngày (giữ 60 ngày) + `storage/` dạng gương (chỉ gửi file mới/đổi, không xoá).
5. Báo healthchecks.io: thành công / lỗi (kèm 3 KB log cuối). Không có tín hiệu quá 1 ngày → email báo.

Thất bại thì thử lại sau 30 phút, tối đa 3 lần. Sao lưu tay: `./hrm.sh backup`.

### 9.1 Chép ra Google Drive, mã hoá (rất nên làm)

Sao lưu chỉ nằm trên VPS thì VPS hỏng là mất cả hai. Làm trên **máy Windows** (cần trình duyệt):

1. Tải rclone (rclone.org/downloads), giải nén.
2. `rclone config` → `n` → tên `gdrive` → loại `drive` → để trống client id/secret → scope `drive.file` → đăng nhập Google trong trình duyệt.
3. `rclone config` → `n` → tên `hrm-mahoa` → loại `crypt` → remote `gdrive:hrm-backups` → mã hoá tên file `standard` → **đặt mật khẩu mạnh (và mật khẩu thứ hai)** → lưu.
4. **Lưu 2 mật khẩu mã hoá vào trình quản lý mật khẩu.** Mất là không đọc lại được bản sao lưu.
5. Chép file cấu hình lên VPS (`rclone config file` cho biết đường dẫn):
   ```powershell
   scp $env:APPDATA\rclone\rclone.conf deploy@<IP-VPS>:/opt/hrm/secrets/rclone.conf
   ```
6. Trên VPS: `chmod 600 /opt/hrm/secrets/rclone.conf`, đặt `RCLONE_REMOTE=hrm-mahoa:` trong `/opt/hrm/.env`, `./hrm.sh up`, `./hrm.sh backup`. Trên Google Drive sẽ thấy thư mục `hrm-backups` với tên file đã mã hoá.

### 9.2 Giám sát

healthchecks.io › tạo check: *Period* 1 ngày, *Grace* 2 giờ → chép URL ping vào `BACKUP_PING_URL` trong `/opt/hrm/.env` → `./hrm.sh up`. Thêm một monitor miễn phí (UptimeRobot…) gọi `https://<tên-miền>/healthz` mỗi 5 phút để biết khi HRM sập.

---

## 10. Khôi phục

### 10.1 Lỡ xoá/sửa sai dữ liệu (VPS vẫn chạy)

Bản sao lưu có `db-public.dump`, có thể lấy lại từng bảng mà không đụng phần khác. Làm trên bản sao trước, không làm thẳng lên production: dựng Supabase thứ hai, hoặc nhờ hỗ trợ. **Đừng** `wipe-supabase` production chỉ để lấy lại một bảng.

### 10.2 VPS hỏng hoặc mất — dựng lại từ đầu

1. VPS mới → mục 4, 5 (Supabase mới, khoá mới).
2. Lấy bản sao lưu: nếu còn `/opt/hrm-backups` cũ thì chép sang; không thì tải từ Google Drive (máy có `rclone.conf`):
   ```sh
   rclone copy hrm-mahoa:db/<UTC> ./khoi-phuc/<UTC>
   rclone copy hrm-mahoa:storage ./khoi-phuc/<UTC>/storage
   ```
   (`storage/` là bản gương mới nhất; file nào bị ghi đè sau ngày `<UTC>` sẽ lệch checksum — chọn bản `<UTC>` mới nhất.)
   Kiểm trước khi dùng: trong thư mục `<UTC>` chạy `sha256sum -c --quiet SHA256SUMS` (không in gì là khớp).
3. Chép lên VPS rồi `./hrm.sh restore <thư-mục>` → phải `KHỚP`.
4. Dựng lại giao diện với khoá anon mới (mục 7.2). Trỏ DNS sang IP mới.

**Diễn tập lại mỗi 3 tháng** (trên một VPS thuê theo giờ, hoặc máy có Docker): sao lưu không khôi phục được thì coi như không có.

---

## 11. Vận hành hằng ngày

| Lệnh (`cd /opt/hrm`) | Làm gì |
|---|---|
| `./hrm.sh status` | Kiểm tra tổng thể. Nên xem mỗi tuần. |
| `./hrm.sh deploy <gói>` | Cài bản mới (mục 7.2); lỗi thì tự quay về bản trước. |
| `./hrm.sh rollback` | Quay về bản trước bằng tay. |
| `./hrm.sh logs hrm` | Log ứng dụng (`caddy`, `backup` tương tự). |
| `./hrm.sh backup` | Sao lưu ngay. |
| `./hrm.sh studio on` / `off` | Trang quản trị Supabase, chỉ qua đường hầm `ssh -L 8000:127.0.0.1:8000 deploy@<IP>` → `http://localhost:8000`. Tốn ~400 MB RAM, tắt khi xong. |
| `./hrm.sh supabase ps` | Lệnh docker compose của Supabase. |
| `./hrm.sh up` | Áp dụng thay đổi trong `/opt/hrm/.env`. |

- **Bản vá hệ điều hành** tự cài hằng ngày. Thỉnh thoảng (khi `status`/đăng nhập báo *System restart required*): `sudo reboot` vào giờ vắng; mọi container tự chạy lại.
- **Nâng cấp Supabase**: không tự động. Khi cần, đọc ghi chú phát hành, sửa `REF` trong `install-supabase.sh`, so lại lớp phủ với `docker-compose.yml` mới, sao lưu trước, thử trên máy khác trước.
- **Đổi tên miền**: phải sửa `SUPABASE_PUBLIC_URL`, `API_EXTERNAL_URL`, `SITE_URL`, `ADDITIONAL_REDIRECT_URLS` trong `/opt/supabase/.env`, `DOMAIN` trong `/opt/hrm/.env`, `./hrm.sh supabase up -d`, dựng lại giao diện với tên miền mới.

### Sự cố thường gặp

| Hiện tượng | Kiểm tra |
|---|---|
| Web không vào được | `./hrm.sh status`; `./hrm.sh logs caddy` (lỗi chứng chỉ thường do DNS sai hoặc cổng 80 bị chặn). |
| Đăng nhập lỗi / trắng trang | `./hrm.sh supabase ps` (dịch vụ nào không healthy), `./hrm.sh supabase logs --tail 100 auth`. |
| Máy chấm công im lặng | `./hrm.sh logs hrm` có dòng `[iclock]`? "từ chối sê-ri" → sửa `ATTENDANCE_DEVICE_SERIALS` rồi `./hrm.sh up`. Không có dòng nào → máy chưa tới được VPS (cấu hình máy, mạng công ty). |
| Chậm, RAM đầy | `./hrm.sh status`; `studio off`; xem container nào ăn RAM. Kéo dài → nâng gói C. |
| Ổ đầy | `docker image prune -a` (xoá image cũ), giảm `BACKUP_KEEP_DAYS`. |

---

## 12. Đã kiểm và chưa kiểm

**Đã kiểm trên máy dev, 13/11/2026** — "VPS giả": container Linux có Docker riêng, chạy đúng gói triển khai và các script trên bằng `dash` (như `/bin/sh` của Ubuntu), user `deploy`:

| Hạng mục | Kết quả |
|---|---|
| `install-supabase.sh` (tải bản ghim, sinh khoá, cấu hình, lớp phủ, chạy, kiểm tra) | Đạt. `.env` quyền 600, không còn khoá mặc định. |
| RAM khi rảnh, toàn bộ VPS (6 dịch vụ Supabase + hrm + Caddy + backup) | **≈ 510 MB** |
| Cổng mở | Chỉ 80, 443 ra ngoài; 8000, 8080 trên 127.0.0.1; Postgres không mở. |
| `make-bundle` | Dựng đúng tên miền và khoá; **chặn** khoá `service_role`, chặn tên miền có `https://`. |
| `hrm.sh deploy` | Đạt. **Chặn** gói sai tên miền. Gói hỏng (app không chạy) → **tự quay về bản trước**, HRM vẫn chạy. |
| Đường đi qua Caddy | Giao diện, SPA, `/api/*`, Auth, REST (RLS), Storage, **websocket realtime (101)**, `http://…/iclock` (bắt tay 200, sê-ri lạ 403, theo IP cũng được, **không chuyển hướng**), HTTP khác → HTTPS, có HSTS. |
| Sao lưu | Đạt, có `COMPLETE`. Lần 2 **tái dùng file Storage bằng hard link**. Thư mục 700, file 600. Lịch: chạy đúng 2:00 giờ VN. |
| Chép ra ngoài (rclone, mã hoá) | Đạt: tên file trên đích đã mã hoá; xoá bản > 60 ngày, giữ bản mới; **lấy về qua giải mã, checksum khớp toàn bộ**. |
| `wipe-supabase` | Gõ sai → huỷ. Gõ đúng → DB trống (0 tài khoản, 0 bảng, 0 bucket), giữ khoá. |
| `restore` | Đạt: **KHỚP 40 bảng + file**. Đăng nhập bằng **mật khẩu cũ** được (sai mật khẩu → 400); RLS đúng (đăng nhập thấy, ẩn danh không); hàm SQL chạy; realtime còn đăng ký bảng; file tải về **trùng checksum gốc**, ẩn danh bị chặn. Khôi phục đè lên DB có dữ liệu → **từ chối**. |
| `studio on/off` | Đạt: qua 127.0.0.1:8000 không mật khẩu → 401, có mật khẩu → 200; từ Internet (Caddy) không vào được Studio. Tốn ~325 MB khi bật; tắt xong không còn container. |
| `setup-server.sh` (container Ubuntu 24.04, `systemctl` giả) | Đạt, chạy lại an toàn: cài gói, Docker, user `deploy` + khoá SSH + sudo, thư mục, ufw (chỉ cổng SSH thật + 80 + 443), vá tự động, giới hạn log. `--harden-ssh` có hiệu lực theo `sshd -T`, **thắng cả file `50-cloud-init.conf` bật mật khẩu**. Phát hiện và đã sửa: Ubuntu tối giản thiếu gói `sudo`; Ubuntu 24.04 có sẵn user `ubuntu` UID 1000 nên `deploy` có thể là 1001 (đã tự xử lý). |

Dữ liệu thử là bảng/tài khoản/file mẫu do mình tạo, không phải dữ liệu HRM thật.

**Chưa kiểm — sẽ lộ ra khi làm thật:**

1. **Chuyển dữ liệu thật từ Cloud** (8.1–8.2). Rủi ro chính: lệch phiên bản schema `auth` giữa Cloud và GoTrue tự host làm bước nạp tài khoản lỗi; Cloud chạy Postgres 15 còn VPS chạy 17. Diễn tập để phát hiện.
2. **Email thật** qua SMTP, và Auth có lấy được mẫu email tiếng Việt từ container `hrm` không (nếu không, email vẫn gửi nhưng dùng mẫu mặc định tiếng Anh, có mã 6 số).
3. **HTTPS Let's Encrypt thật** (trên máy dev Caddy dùng chứng chỉ nội bộ).
4. **Máy chấm công thật** gọi vào VPS (đường HTTP cổng 80 giống hệt cách đang chạy với Worker).
5. **rclone + Google Drive** và **healthchecks.io** (cần tài khoản của bạn).
6. Phần cần systemd của `setup-server.sh` trên Ubuntu thật: tạo swap, khởi động lại Docker/SSH, fail2ban chạy thật.
7. `./hrm.sh cloud-backup` với project Cloud thật (đường kết nối SSL tới pooler của Supabase).

**Giới hạn đã biết:**

- File Storage khôi phục qua API nên **người tải lên** và **thời điểm tải lên** của từng file trong `storage.objects` thành thời điểm khôi phục. Quyền xem file của HRM dựa trên đường dẫn thư mục, không dựa trên người tải lên, nên không ảnh hưởng quyền.
- Giao thức máy chấm công không có xác thực ngoài số sê-ri và đi HTTP thường (giống hiện trạng). Luôn điền `ATTENDANCE_DEVICE_SERIALS`.
- Một VPS, không dự phòng: VPS hỏng thì HRM ngừng đến khi dựng lại (mục 10.2, khoảng 1–2 giờ nếu đã diễn tập).
