# Chạy thử HRM trên Linux (staging dry-run)

Runbook này dùng để nghiệm thu một máy staging Ubuntu/Debian trước khi bàn giao. Chỉ dùng dữ liệu giả lập và tài khoản kiểm thử; không kết nối vào database production hoặc dùng secrets production.

> **Trạng thái tại thời điểm viết:** Repository đã có `Dockerfile`, `compose.yaml`, `.env.docker.example`, `supabase/schema_baseline.sql` và các migration. Chưa có `tools/init-production-db.sh` và `tools/docker-restore.sh`; các lệnh bên dưới chạy init/restore thủ công để phục vụ dry-run. Môi trường phát triển Windows không thể thay thế việc chạy nghiệm thu thật trên Linux.

## 1. Chuẩn bị máy staging

- Ubuntu Server hoặc Debian được hỗ trợ, tối thiểu 2 CPU, 4 GB RAM và đủ dung lượng cho database, Storage, image và backup. Đây là ngưỡng chạy thử; sizing production cần dựa trên dữ liệu và tải thực tế.
- Docker Engine và Docker Compose plugin đã cài; tài khoản triển khai có quyền chạy `docker`.
- Stack Supabase self-hosted đã cài theo tài liệu chính thức, đã khởi tạo PostgreSQL/Auth/Storage và đang hoạt động.
- Mở HTTPS qua reverse proxy tới HRM và Supabase Kong; không public PostgreSQL, Supabase Studio hoặc cổng nội bộ.
- Có thư mục Storage thật của Supabase và một thư mục backup riêng, có thể ghi bởi UID/GID của dịch vụ backup.

Các lệnh dưới đây giả định Supabase Compose ở `/opt/supabase-project`, tên project là `supabase` (network `supabase_default`), và source HRM ở `/opt/hrm`. Điều chỉnh đường dẫn nếu máy staging dùng vị trí khác.

## 2. Kiểm tra Supabase và cấu hình

```sh
docker --version
docker compose version
docker compose --env-file /opt/supabase-project/.env \
  -f /opt/supabase-project/docker-compose.yml ps
docker network inspect supabase_default
```

Xác nhận các dịch vụ Supabase cần thiết đang healthy/running và network tồn tại trước khi khởi động HRM. Không tiếp tục nếu database chưa được khởi tạo hoặc thiếu network.

Trong thư mục source HRM, tạo file cấu hình từ mẫu và điền credentials riêng cho staging:

```sh
cd /opt/hrm
cp .env.docker.example .env.docker
chmod 600 .env.docker
${EDITOR:-vi} .env.docker
```

Điền ít nhất `VITE_SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `POSTGRES_PASSWORD`, `SUPABASE_DOCKER_NETWORK`, `SUPABASE_STORAGE_PATH` và `BACKUP_PATH`. Đảm bảo URL public truy cập được từ máy trình duyệt, đường dẫn Storage trỏ đúng volume của Supabase, NAS/thư mục backup đã mount, và `BACKUP_UID`/`BACKUP_GID` có quyền ghi. Không commit hoặc gửi file `.env.docker`.

## 3. Kiểm tra cấu hình Compose

Chạy đúng lệnh từ thư mục source HRM:

```sh
cd /opt/hrm
docker compose --env-file .env.docker config --quiet
```

**Pass:** lệnh kết thúc với exit code `0`. Nếu báo biến bắt buộc chưa đặt, lỗi YAML, volume không hợp lệ hoặc network không tồn tại, sửa cấu hình trước khi tiếp tục. Không đưa đầu ra có secrets vào log/ticket công khai.

## 4. Nạp baseline và migration trên database staging mới

> Chỉ chạy trên database staging mới, rỗng và đã được backup. Không chạy baseline lên database đang có dữ liệu. Các lệnh ví dụ dùng database mặc định `postgres`; nếu `.env` Supabase đặt `POSTGRES_DB` khác, thay `-d postgres` bằng database staging đó trong tất cả lệnh.

Xác nhận PostgreSQL có thể truy cập qua Compose của Supabase:

```sh
docker compose --env-file /opt/supabase-project/.env \
  -f /opt/supabase-project/docker-compose.yml exec -T db \
  psql -U postgres -d postgres -v ON_ERROR_STOP=1 -c 'select current_database(), version();'
```

Nạp baseline từ thư mục source:

```sh
cd /opt/hrm
docker compose --env-file /opt/supabase-project/.env \
  -f /opt/supabase-project/docker-compose.yml exec -T db \
  psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
  < supabase/schema_baseline.sql
```

Chạy migration theo thứ tự tên tệp. Dừng ngay khi có lỗi; không bỏ qua file lỗi để chạy tiếp:

```sh
set -eu
cd /opt/hrm
for migration in supabase/migrations/*.sql; do
  printf 'Applying %s\n' "$migration"
  docker compose --env-file /opt/supabase-project/.env \
    -f /opt/supabase-project/docker-compose.yml exec -T db \
    psql -U postgres -d postgres -v ON_ERROR_STOP=1 < "$migration"
done
```

Kiểm tra kết quả:

```sh
docker compose --env-file /opt/supabase-project/.env \
  -f /opt/supabase-project/docker-compose.yml exec -T db \
  psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
  < supabase/check_migrations.sql
```

**Pass:** tất cả migration được áp dụng không có lỗi; kết quả kiểm tra không còn dòng `>>> CHUA CHAY` sau khi hoàn thành các việc thủ công được nêu trong kết quả. Nếu migration lỗi giữa chừng, giữ nguyên log, xác định database đang ở trạng thái nào và khôi phục staging về snapshot sạch trước khi chạy lại; không chạy bừa baseline lần nữa vì các policy trong baseline không được thiết kế để áp dụng lặp.

## 5. Khởi động HRM và backup

```sh
cd /opt/hrm
docker compose --env-file .env.docker up -d --build
docker compose --env-file .env.docker ps
docker compose --env-file .env.docker logs --tail=100 hrm backup
```

Đợi healthcheck HRM đạt rồi kiểm tra health endpoint từ máy chủ:

```sh
curl --fail --show-error http://127.0.0.1:8080/healthz
```

**Pass:** dịch vụ `hrm` đang chạy/healthy, endpoint trả HTTP thành công, dịch vụ `backup` chạy và không có lỗi kết nối database hay quyền ghi thư mục.

Để kiểm tra reverse proxy, từ máy có thể truy cập domain:

```sh
curl --fail --show-error https://hrm.khachhang.com/healthz
curl --fail --show-error https://supabase.khachhang.com/
```

Hai domain mẫu cần được thay bằng domain staging thực tế. Xác nhận chứng thư TLS hợp lệ và HRM trong trình duyệt gọi được URL Supabase public, không phải URL nội bộ Docker.

## 6. Kiểm thử chức năng ứng dụng

Tạo tài khoản kiểm thử riêng bằng quy trình quản trị phù hợp. Không tạo tài khoản bằng cách sửa trực tiếp `auth.users` nếu chưa áp dụng đúng luồng Supabase Auth và profile của ứng dụng.

| Luồng | Thao tác kiểm thử | Tiêu chí đạt |
|---|---|---|
| Đăng nhập Admin | Đăng nhập tài khoản admin staging, mở trang quản trị | Đăng nhập thành công; quyền admin đúng; không có lỗi API/RLS trong console |
| Đăng nhập Nhân viên | Đăng nhập tài khoản staff staging | Chỉ thấy chức năng được cấp; không đọc/sửa dữ liệu người khác trái quyền |
| Upload minh chứng KPI | Tạo/cập nhật KPI kiểm thử và tải file nhỏ lên | Upload thành công vào bucket cấu hình; có thể mở/tải file theo quyền; file xuất hiện trong volume Storage |
| Chấm công | Ghi nhận check-in/check-out bằng luồng UI staging | Bản ghi và thời gian hiển thị chính xác; kiểm tra lại sau khi refresh |
| Bảng lương | Dùng kỳ lương và dữ liệu giả lập, chạy/tính bảng lương theo quyền | Tổng tiền và các thành phần đối chiếu được với dữ liệu test; không dùng dữ liệu lương thật |
| Email Auth (nếu bật SMTP) | Gửi email xác minh hoặc yêu cầu khôi phục mật khẩu | Email tới mailbox test; liên kết trỏ đúng domain HTTPS staging; token hoạt động một lần |

Lưu thời điểm, kết quả, ảnh/log đã loại bỏ thông tin nhạy cảm và phiên bản image vào biên bản nghiệm thu. Nếu một luồng lỗi, ghi rõ bước tái hiện và dừng trước khi chuyển sang production.

## 7. Kiểm thử backup và khôi phục trên staging cô lập

Tạo một backup ngay để không phải chờ lịch 24 giờ:

```sh
cd /opt/hrm
docker compose --env-file .env.docker exec -T backup /bin/sh /backup/backup-once.sh
```

Trong thư mục `BACKUP_PATH`, xác nhận thư mục backup mới có `COMPLETE`, `database.dump`, `storage.tar.gz` và `SHA256SUMS`. Kiểm tra checksum:

```sh
cd /duong-dan-backup/yyyymmddTHHMMSSZ
sha256sum --check SHA256SUMS
```

Repository hiện chưa có `tools/docker-restore.sh`. Để kiểm thử khôi phục trước khi script đó được bàn giao, dùng **một Supabase staging cô lập khác** hoặc snapshot staging đã dừng ghi; tuyệt đối không thực hiện trên production. Tối thiểu phải kiểm tra checksum trước, khôi phục PostgreSQL bằng `pg_restore` với đúng database, và giải nén Storage vào đúng volume khi Storage đã dừng. Kiểm tra kỹ target/database/volume và giữ bản backup hiện trạng trước khi ghi đè. Ví dụ thao tác khôi phục cụ thể phụ thuộc cách Supabase volume và database của khách hàng được provision; không chạy lệnh restore đoán đường dẫn hoặc nhắm vào database đang hoạt động.

**Pass:** database test khôi phục được, tài khoản và dữ liệu kiểm thử cần thiết còn đọc được, file Storage mở/tải được, HRM đăng nhập và gọi API bình thường sau khi khởi động lại. Chỉ đánh dấu bước này đạt khi thực sự restore xong trên môi trường cô lập; backup tạo thành công chưa chứng minh restore thành công.

## 8. Kết thúc nghiệm thu

Lưu biên bản với các mục: ngày/giờ, phiên bản source/image, phiên bản Docker, tên máy staging, kết quả từng bước, migration lỗi (nếu có), thời gian khôi phục và người nghiệm thu. Không đưa secrets, token, dữ liệu nhân sự thật hoặc nội dung backup vào biên bản.

Chỉ coi dry-run đạt khi cả cấu hình Compose, init database, healthcheck, luồng chức năng, backup **và restore thực tế** đều đạt. Máy Windows nơi soạn tài liệu không chạy được Docker Linux; trạng thái nghiệm thu trên máy Linux phải do đội vận hành cập nhật sau khi thực hiện runbook này.
