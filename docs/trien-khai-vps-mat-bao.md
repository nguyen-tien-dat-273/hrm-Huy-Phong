# Lộ trình đưa HRM Huy Phong lên VPS Mắt Bão

**Soạn:** 12/11/2026 · **Trạng thái:** kế hoạch + bộ công cụ đã sẵn sàng; **chưa chạy backup thật** (cần chuỗi kết nối database — xem mục 3) và **chưa dựng thử trên VPS** (chưa có máy).

## 0. Cần chốt trước khi làm

| # | Câu hỏi | Gợi ý |
|---|---|---|
| 1 | **Chuyển luôn Supabase về VPS (tự host), hay giữ Supabase Cloud và chỉ chuyển ứng dụng?** | Tài liệu này viết cho phương án **tự host toàn bộ** (khớp `compose.yaml` + `docs/docker-handover.md`). Giữ Cloud thì bỏ mục 4–5 phần Supabase: chỉ cần Docker + Caddy, đơn giản và rẻ tài nguyên hơn nhiều. |
| 2 | Gói VPS? | **Linux** (Ubuntu 22.04/24.04), tối thiểu 4 vCPU / 8 GB RAM / 80 GB SSD (Supabase tự host ngốn RAM; 4 GB là mức tối thiểu của Supabase, không thoải mái). VPS Windows không phù hợp bộ Docker này. Cần quyền root SSH. |
| 3 | Hai tên miền con trỏ về IP VPS: một cho HRM (`hrm.…`), một cho Supabase (`api.…`). | Trình duyệt gọi thẳng `api.…` nên bắt buộc có HTTPS hợp lệ. |
| 4 | SMTP thật cho email quên mật khẩu. | Cloud đang gửi giúp; tự host thì **không có** cho đến khi cấu hình. |
| 5 | Nơi lưu bản sao lưu **ngoài VPS** (NAS công ty / Google Drive / máy khác). | Sao lưu chỉ nằm trên chính VPS thì VPS hỏng là mất cả hai. |

## 1. Kiến trúc đích

```
Máy chấm công ──HTTP :80 /iclock/*──┐
Trình duyệt ──HTTPS──> Caddy (80/443) ──> hrm:8080   (React + API Node, container `hrm`)
                          └─────────────> Supabase gateway (api.…): Auth/REST/Storage/Realtime
                                              └─ Postgres (volume trên VPS)
container `backup`: pg_dump + tar Storage mỗi 24h → thư mục sao lưu (30 ngày)
```

Thay đổi so với hiện tại (Vercel + Supabase Cloud + Cloudflare Worker):

- `/iclock/*` giờ do chính server `hrm` xử lý (đã bổ sung vào `server/index.mjs`, thử cục bộ: sê-ri lạ → 403, sê-ri khai → bắt tay OK). **Không cần Cloudflare Worker `hic` nữa**; máy chấm công trỏ thẳng về `hrm.…` cổng 80.
- Cron nhắc nhở không còn do Vercel Cron: server tự chạy vòng lặp khi có `CRON_SECRET`.

## 2. Những thứ KHÔNG nằm trong database — phải ghi lại thủ công trước khi tắt Vercel/Cloud

Lấy ở Vercel › Settings › Environment Variables, Supabase Dashboard và Cloudflare. Lưu vào kho bí mật (trình quản lý mật khẩu), không vào Git/chat.

- [ ] **Biến môi trường Vercel** (tất cả): `SUPABASE_SERVICE_ROLE_KEY`, `RECRUITMENT_INTAKE_TOKEN`, `CRON_SECRET`, `GEMINI_API_KEY`, `CHATBOT_ALIAS_SECRET` (nếu có), `ATTENDANCE_DEVICE_SERIALS`, …
- [ ] **`VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY`** — phải **giữ nguyên**; đổi khoá thì mọi thiết bị đã đăng ký thông báo đẩy mất hiệu lực.
- [ ] Supabase › Authentication: **SMTP**, **Site URL**, **Redirect URLs**, mẫu email, mật khẩu tối thiểu, tuỳ chọn đăng ký/xác nhận email.
- [ ] Supabase › Project Settings › API: **JWT Secret** (nếu dùng cùng JWT secret cho máy mới thì khoá anon/service hiện hành vẫn dùng được và người dùng không bị đăng xuất; nếu sinh mới thì mọi người phải đăng nhập lại và phải cập nhật khoá ở mọi nơi dùng chúng — chương trình bridge `.env.attendance-bridge`, Worker).
- [ ] Cấu hình máy chấm công (địa chỉ máy chủ, cổng, HTTPS bật/tắt) — chụp màn hình để đối chiếu.
- [ ] Danh sách DNS hiện có của tên miền.
- [ ] Form tuyển dụng bên ngoài đang gọi webhook nào (sẽ phải đổi sang URL mới + cùng token).

## 3. Sao lưu Supabase đầy đủ (chỉ đọc, an toàn chạy bất cứ lúc nào)

Công cụ: [tools/backup/supabase-cloud-backup.mjs](../tools/backup/supabase-cloud-backup.mjs).

1. Tạo file `.env.backup` ở thư mục gốc repo (đã gitignore):

   ```
   # Dashboard › Connect › "Session pooler" (cổng 5432, KHÔNG dùng Transaction pooler 6543)
   SUPABASE_DB_URL=postgresql://postgres.<ref>:<mật-khẩu-DB>@aws-0-<vùng>.pooler.supabase.com:5432/postgres
   SUPABASE_URL=https://<ref>.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=<khoá service_role>
   ```

   Quên mật khẩu database: Dashboard › Project Settings › Database › Reset password (đổi mật khẩu DB **không** ảnh hưởng khoá API; nhưng báo trước nếu có thứ gì khác đang dùng chuỗi kết nối trực tiếp).
2. Máy chạy cần Node ≥ 20 và `pg_dump`/`pg_restore` từ PostgreSQL ≥ bản của Supabase (máy hiện tại có PG 18 → đủ). Chạy:

   ```
   pnpm install
   node --env-file=.env.backup tools/backup/supabase-cloud-backup.mjs D:\hrm-backups
   ```
3. Kết quả `D:\hrm-backups\<UTC>\` gồm: `db-full.dump`, `db-public.dump`, `db-auth-data.dump`, `db-storage-data.dump`, `db-schema.sql`, `migration-history.json`, `storage/` + `storage-index.json`, `inventory.json` (số dòng từng bảng), `SHA256SUMS`, `COMPLETE`. Chỉ khi có `COMPLETE` mới là bản sao lưu hợp lệ; script tự kiểm các dump đọc lại được và kiểm kích thước từng file Storage.
4. **Chép bản sao lưu ra ít nhất 2 nơi** (ổ ngoài/NAS + bản mã hoá trên cloud). Bản sao lưu chứa mật khẩu băm và dữ liệu lương — để nơi hạn chế quyền.
5. Mốc dùng cho cutover: chạy **một bản đầu ngay bây giờ** (kiểm tra công cụ chạy được, đo thời gian và dung lượng), rồi **một bản cuối** trong đêm chuyển.

Đã kiểm: phần database của script chạy đúng trên Postgres cục bộ (6 file, `pg_restore --list` đọc được). **Chưa kiểm** phần tải Storage qua API với project thật — bản chạy đầu tiên sẽ cho biết; nếu có file lỗi script báo và **không** tạo `COMPLETE`.

## 4. Lộ trình triển khai

Mỗi giai đoạn có **điều kiện qua cửa**; không qua thì không sang giai đoạn sau. Production hiện tại (Vercel + Cloud) **giữ nguyên chạy** cho đến giai đoạn 7.

### Giai đoạn 0 — Chuẩn bị (0,5 ngày)
- Chốt mục 0, đặt mua/nhận VPS, trỏ DNS (TTL thấp, 300 s, đặt trước ≥ 1 ngày).
- **Sửa `StaffLayout.tsx`** (mục 6, rủi ro 1) và commit toàn bộ thay đổi hiện có; nếu không `pnpm build` — và do đó `docker build` — **thất bại**.
- Hoàn tất danh sách mục 2.
- *Qua cửa:* `pnpm build` thành công trên máy bạn.

### Giai đoạn 1 — Sao lưu (0,5 ngày)
- Chạy mục 3, chép ra 2 nơi, mở `inventory.json` đối chiếu số nhân viên/bảng công với màn hình HRM.
- *Qua cửa:* có `COMPLETE`, số liệu khớp bằng mắt.

### Giai đoạn 2 — Dựng VPS (0,5 ngày)
```sh
# Root, Ubuntu
apt update && apt -y upgrade
adduser deploy && usermod -aG sudo deploy      # đăng nhập bằng SSH key, tắt đăng nhập bằng mật khẩu + root
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw enable
curl -fsSL https://get.docker.com | sh && usermod -aG docker deploy
apt -y install unattended-upgrades fail2ban
```
Kiểm tra thêm tường lửa ở **bảng điều khiển Mắt Bão** (nếu có) đã mở 80/443. **Không** mở 5432, 8080, 8000, 3000.
*Qua cửa:* `docker run --rm hello-world` chạy; `curl http://<IP>` từ bên ngoài tới được cổng 80 (Caddy chưa lên thì sẽ từ chối kết nối — kết quả đúng là "từ chối", không phải "timeout").

### Giai đoạn 3 — Supabase tự host (1 ngày)
Làm theo [Self-hosting Supabase with Docker](https://supabase.com/docs/guides/self-hosting/docker) (hướng dẫn pin phiên bản ở [docker-handover.md](./docker-handover.md)). Điểm riêng của dự án:
- `SUPABASE_PUBLIC_URL` / `API_EXTERNAL_URL` = `https://api.…`; `SITE_URL` = `https://hrm.…`.
- Sinh `JWT_SECRET`, `ANON_KEY`, `SERVICE_ROLE_KEY`, `POSTGRES_PASSWORD` theo tài liệu. Muốn giữ phiên đăng nhập cũ: dùng đúng JWT secret của Cloud (mục 2) và **chính khoá anon/service cũ**.
- Cấu hình SMTP thật.
- Giữ tên project Compose là `supabase` (mạng `supabase_default`). Kiểm tên dịch vụ cổng API bằng `docker compose ps` — `compose.yaml` mặc định đang ghi `api-gw`, có thể phải đặt `SUPABASE_INTERNAL_URL=http://kong:8000` (hoặc tên thực tế) trong `.env.docker`.
- `.env` của Supabase: `chmod 600`, sao chép bản mã hoá ra kho bí mật.
*Qua cửa:* mọi container healthy; `curl https://api.…/auth/v1/health` trả 200 (sau giai đoạn 5 khi có HTTPS).

### Giai đoạn 4 — Diễn tập khôi phục (0,5–1 ngày) ⭐ quan trọng nhất
Khôi phục **bản sao lưu giai đoạn 1** lên Supabase mới **trước khi** có người dùng thật.
```sh
scp -r D:\hrm-backups\<UTC> deploy@vps:/opt/backups/in/
cd /opt/hrm
sh tools/vps/restore-db.sh /opt/backups/in/<UTC>
SUPABASE_SERVICE_ROLE_KEY=<khoá service máy MỚI> node tools/backup/storage-restore.mjs /opt/backups/in/<UTC> --url https://api.…
```
Script từ chối chạy nếu `public` hoặc `auth.users` không rỗng (chống ghi đè); dừng ngay khi có lỗi. Trình tự: checksum → `public` (cấu trúc, dữ liệu, GRANT) → bảng bucket → chính sách RLS của Storage + publication realtime → tài khoản `auth` (bỏ `auth.schema_migrations` của GoTrue).

Đối chiếu số dòng (chạy trong mạng Docker để tới được DB):
```sh
docker run --rm --network supabase_default -v "$PWD:/w" -w /w node:22-alpine sh -c \
 "npm i --no-save pg >/dev/null && DB_URL=postgresql://supabase_admin:<POSTGRES_PASSWORD>@db:5432/postgres node tools/backup/verify-counts.mjs /opt/backups/in/<UTC>"
```
Nếu restore lỗi (thường: cột `auth` lệch phiên bản GoTrue giữa Cloud và bản tự host) → **dựng lại Supabase sạch**, sửa, làm lại. Đây là lý do phải diễn tập.
*Qua cửa:* `verify-counts` báo KHỚP; `supabase/check_migrations.sql` không còn `>>> CHUA CHAY` bất thường.

### Giai đoạn 5 — HRM + HTTPS (0,5 ngày)
```sh
# Máy bạn
node tools/vps/make-bundle.mjs            # ra hrm-vps-bundle-<UTC>.tgz (chỉ mã nguồn, không bí mật)
scp hrm-vps-bundle-*.tgz deploy@vps:/opt/ && ssh deploy@vps 'mkdir -p /opt/hrm && tar -xzf /opt/hrm-vps-bundle-*.tgz -C /opt/hrm'
# VPS
cd /opt/hrm
cp .env.docker.example .env.docker && chmod 600 .env.docker   # điền: VITE_SUPABASE_URL=https://api.…, 2 khoá, POSTGRES_PASSWORD,
                                                              # SUPABASE_STORAGE_PATH, BACKUP_PATH, VAPID_*, CRON_SECRET, GEMINI_API_KEY,
                                                              # RECRUITMENT_INTAKE_TOKEN, ATTENDANCE_DEVICE_SERIALS ...
docker compose --env-file .env.docker config --quiet && docker compose --env-file .env.docker up -d --build
cp deploy/vps/.env.vps.example deploy/vps/.env.vps            # điền 2 tên miền + tên cổng Supabase
docker compose -f deploy/vps/compose.caddy.yaml --env-file deploy/vps/.env.vps up -d
```
Lưu ý: `VITE_SUPABASE_URL` được **đóng vào frontend lúc build** — đổi URL phải build lại.
*Qua cửa:* `https://hrm.…/healthz` → `{"status":"ok"}`; trình duyệt đăng nhập được; `curl -i "http://hrm.…/iclock/cdata?SN=<sê-ri>&options=all"` trả bắt tay 200 qua **HTTP thuần** (không bị chuyển hướng).

### Giai đoạn 6 — Nghiệm thu (UAT, 1 ngày)
Người dùng thật đăng nhập bằng mật khẩu cũ. Chạy theo bảng ở [linux-staging-dry-run.md](./linux-staging-dry-run.md) mục 6 **và**:
- [ ] Admin / HR / quản lý / nhân viên: đúng quyền, đúng dữ liệu.
- [ ] Mở một phiếu lương kỳ đã khoá: **tổng tiền trùng với Cloud** (so từng người, vài trường hợp).
- [ ] Bảng công tháng hiện tại khớp; tạo check-in thử.
- [ ] Tải/mở tệp cũ trong bốn bucket: `employee-documents`, `requisition-files`, `task-evidence`, `training-step-submissions` (+ bucket KPI nếu có).
- [ ] Thông báo thời gian thực (chuông) và thông báo đẩy trên điện thoại.
- [ ] Trợ lý hỏi đáp, quên mật khẩu (email tới thật), form tuyển dụng ngoài.
- [ ] Sao lưu: `docker compose exec backup sh /backup/backup-once.sh` ra `COMPLETE`, rồi **khôi phục thử bản đó** lên một Supabase riêng.
- *Giai đoạn này làm trên dữ liệu bản sao; mọi thứ người dùng nhập ở đây sẽ bị bỏ khi cutover.*

### Giai đoạn 7 — Cutover (đêm/cuối tuần, 1–2 giờ ngừng ghi)
1. Thông báo ngừng hệ thống; **đặt Vercel ở chế độ bảo trì** hoặc đổi mật khẩu quản trị tạm để chặn ghi. Tắt cron Vercel.
2. Chạy **bản sao lưu cuối** (mục 3) → chép sang VPS.
3. **Dựng lại Supabase sạch** trên VPS (xoá volume của lần diễn tập), chạy lại `restore-db.sh` + `storage-restore.mjs` + `verify-counts.mjs` đến khi KHỚP.
4. Đổi DNS `hrm.…` / `api.…` (nếu đang dùng tên miền cũ cho Vercel thì đổi bản ghi A).
5. Máy chấm công: **Cài đặt máy chủ đám mây** → địa chỉ = `hrm.…` (hoặc IP VPS), cổng **80**, **tắt HTTPS** (giống cấu hình đang chạy với Worker). Sê-ri phải nằm trong `ATTENDANCE_DEVICE_SERIALS`. Máy sẽ đẩy bù dữ liệu — chống trùng đã có (`external_id`).
6. Gửi lại đường dẫn mới cho nhân viên (cài lại PWA nếu tên miền đổi).
7. Theo dõi `docker compose logs -f hrm` 1 giờ.
- **Quay lại (rollback):** nếu lỗi nặng trong 24 giờ đầu, mở lại Vercel + Supabase Cloud (còn nguyên, chưa tắt) và trỏ DNS/máy chấm công về như cũ. Dữ liệu nhập trên VPS sau cutover phải nhập lại bằng tay — nên chốt **quyết định đi/dừng sớm**.

### Giai đoạn 8 — Sau cutover (1–2 tuần)
- Giữ Supabase Cloud + Vercel ở trạng thái chỉ đọc **≥ 14 ngày** rồi mới tắt. Tắt Worker `hic`.
- Sao lưu tự động ra **ngoài** VPS (rclone/`rsync` thư mục `BACKUP_PATH` sang NAS/cloud mỗi đêm).
- Giám sát: UptimeRobot (hoặc tương đương) gọi `https://hrm.…/healthz` + cảnh báo nếu `.last-success` trong thư mục sao lưu quá 26 giờ.
- Cập nhật bản vá hệ điều hành; lịch nâng cấp Supabase; diễn tập khôi phục lại sau 1 tháng.
- Gia hạn chứng chỉ: Caddy tự lo (cần cổng 80/443 mở).

## 5. Gói đã chuẩn bị trong repo

| Tệp | Để làm gì |
|---|---|
| [tools/backup/supabase-cloud-backup.mjs](../tools/backup/supabase-cloud-backup.mjs) | Sao lưu đầy đủ Supabase Cloud (DB + Auth + Storage), có checksum và kiểm đọc lại |
| [tools/vps/restore-db.sh](../tools/vps/restore-db.sh) | Khôi phục DB vào Supabase tự host (có chốt chống ghi đè) |
| [tools/backup/storage-restore.mjs](../tools/backup/storage-restore.mjs) | Nạp file Storage, kiểm sha256 từng file |
| [tools/backup/verify-counts.mjs](../tools/backup/verify-counts.mjs) | Đối chiếu số dòng sau khôi phục |
| [tools/vps/make-bundle.mjs](../tools/vps/make-bundle.mjs) | Đóng gói mã nguồn để chép lên VPS (không có `.env`, tài liệu đặc tả) |
| [deploy/vps/](../deploy/vps/) | Caddy (HTTPS, cho `/iclock/*` đi HTTP thuần) + mẫu biến môi trường |
| `server/index.mjs`, `api/tsconfig.json` | Bổ sung `/iclock/*` vào server Docker (trước đó chỉ có trên Vercel/Worker) |
| `compose.yaml`, `.env.docker.example` | Thêm biến máy chấm công (`ATTENDANCE_DEVICE_SERIALS`…) |
| `.dockerignore`, `.gitignore` | Loại tài liệu đặc tả, dữ liệu local, `backups/`, `.env.backup` khỏi image/Git |

## 6. Rủi ro đã biết

1. **`pnpm build` đang lỗi** do bản sửa dở chưa commit ở [StaffLayout.tsx](../client/src/components/layouts/StaffLayout.tsx) (dòng ~376 và ~402: mỗi chỗ có hai thuộc tính `className`; có vẻ dòng cũ chưa bị xoá). Phải sửa trước khi đóng gói.
2. **Không dựng được database từ migration trên máy rỗng** (migration chỉ là nâng cấp; baseline chỉ là một phần). Vì vậy kế hoạch **khôi phục từ dump**, không chạy baseline + migration.
3. **Lệch phiên bản schema `auth`** giữa Cloud và GoTrue tự host có thể làm bước nạp tài khoản lỗi — chỉ lộ ra khi diễn tập (giai đoạn 4).
4. **Hai mạng Docker:** tên dịch vụ gateway của Supabase tự host chưa xác minh được từ máy này (nguồn tìm được mâu thuẫn: `kong` hay tên khác) — xác nhận bằng `docker compose ps` ở giai đoạn 3.
5. **Chưa chạy Docker trên máy này** (Docker Desktop chưa bật) nên `docker build` và `docker compose config` chưa được kiểm. Cần chạy lần đầu ở giai đoạn 5; có thể kiểm sớm trên máy Windows khi bật Docker Desktop.
6. **Giao thức máy chấm công không có xác thực** (chỉ có sê-ri) và chạy HTTP thuần qua Internet — giống hiện trạng, nhưng nay tới VPS; giữ `ATTENDANCE_DEVICE_SERIALS` luôn điền.
7. Cloud→tự host mất: bản sao lưu tự động/point-in-time của Supabase Cloud, giám sát, vá lỗi — trách nhiệm chuyển sang bạn. Nếu không có người vận hành VPS, cân nhắc phương án **giữ Supabase Cloud** (mục 0.1).
