# Bàn giao HRM bằng Docker Compose

## Kiến trúc

- HRM và API của dự án chạy trong container `hrm`; không cần Vercel.
- Supabase tự host chạy theo Docker Compose chính thức của Supabase, trên cùng máy chủ/mạng Docker.
- PostgreSQL và Supabase Storage nằm trên volume của máy khách.
- Container `backup` tạo bản sao PostgreSQL và Storage mỗi ngày, giữ 30 ngày tại thư mục NAS do khách hàng mount vào máy chủ.
- Đặt reverse proxy HTTPS trước HRM và Supabase Kong; không mở trực tiếp cổng PostgreSQL hoặc Supabase Studio ra Internet.

Supabase Docker là một stack riêng gồm nhiều dịch vụ. Dùng bộ cấu hình chính thức đã pin phiên bản, không tự thay bằng một PostgreSQL đơn lẻ: HRM phụ thuộc Supabase Auth, PostgREST, Storage và Realtime. Hướng dẫn cài đặt chính thức: [Self-hosting Supabase with Docker](https://supabase.com/docs/guides/self-hosting/docker).

## Điều kiện máy chủ

Máy chủ Linux có Docker Engine và Docker Compose plugin. Tài liệu Supabase hiện yêu cầu tối thiểu 4 GB RAM, 2 CPU và 40 GB SSD; khuyến nghị từ 8 GB RAM, 4 CPU và 80 GB SSD. Dung lượng cần tính thêm theo số hồ sơ/file và thời gian lưu backup.

## Cấu hình HRM

1. Cài stack Supabase self-hosted theo tài liệu chính thức. Ví dụ pin release `self-hosted/v0.8.2`:

   ```sh
   git clone --depth 1 --branch self-hosted/v0.8.2 https://github.com/supabase/supabase supabase-source
   mkdir -p /opt/supabase-project
   cp -a supabase-source/docker/. /opt/supabase-project/
   cd /opt/supabase-project
   cp .env.example .env
   ```

   Đọc và cấu hình secrets/domain theo tài liệu chính thức trước khi chạy Compose. Giữ Compose project name là `supabase` để network mặc định là `supabase_default`.
2. Đặt `SUPABASE_PUBLIC_URL`, `API_EXTERNAL_URL` và `SITE_URL` theo domain HTTPS của khách hàng trong cấu hình Supabase. `SITE_URL` phải là domain HRM để luồng xác thực và khôi phục mật khẩu hoạt động đúng. Cấu hình SMTP thật (và SMS nếu dùng khôi phục qua điện thoại); không bàn giao với mailer thử nghiệm mặc định.
3. Chạy Supabase trước để tạo network và khởi tạo các dịch vụ.
4. Sao chép `.env.docker.example` thành `.env.docker`, điền URL public, `ANON_KEY`, `SERVICE_ROLE_KEY` và `POSTGRES_PASSWORD` từ cấu hình Supabase của chính khách hàng. Không đưa file này vào Git hoặc gửi service-role key qua chat.
5. Gắn thư mục Storage của Supabase vào `SUPABASE_STORAGE_PATH` và một thư mục backup riêng trên NAS vào `BACKUP_PATH`. NAS phải được mount sẵn trên máy chủ; không mở dịch vụ NAS ra Internet.
   Thư mục NAS phải ghi được bởi UID/GID trong `BACKUP_UID` và `BACKUP_GID`.
6. Chạy từ thư mục repository:

   ```sh
   docker compose --env-file .env.docker up -d --build
   ```

HRM mặc định chỉ bind vào `127.0.0.1:8080`. Cấu hình reverse proxy của khách hàng để đưa domain HTTPS về cổng này. Supabase URL được đóng vào frontend lúc build và phải truy cập được từ trình duyệt người dùng; `SUPABASE_INTERNAL_URL` chỉ dùng cho API server bên trong Docker network.
Đặt `APP_USER_AGENT` với domain hoặc địa chỉ liên hệ của khách hàng nếu dùng reverse geocoding công khai.

## Sao lưu và khôi phục

Container `backup` ghi mỗi lần sao lưu thành một thư mục UTC gồm:

- `database.dump`: bản dump PostgreSQL dạng custom.
- `storage.tar.gz`: bản sao file Storage.
- `SHA256SUMS`: checksum để phát hiện file bị hỏng.
- `COMPLETE`: chỉ được tạo sau khi dump và nén thành công.

Lịch chạy là lần đầu khi container khởi động, sau đó mỗi 24 giờ; khi thất bại sẽ thử lại sau 5 phút. Dọn các bản sao cũ hơn 30 ngày. Cần cấu hình NAS mã hóa dữ liệu khi lưu và giới hạn quyền truy cập; checksum không thay thế mã hóa. Cảnh báo/giám sát việc backup thất bại và diễn tập khôi phục vẫn là trách nhiệm vận hành cần thiết.

Lưu riêng bản mã hóa của file `.env` Supabase, `.env.docker` và cấu hình reverse proxy trong kho bí mật có phân quyền. Các file này chứa JWT/service keys; thiếu đúng khóa khi phục hồi có thể làm phiên đăng nhập và tích hợp không hoạt động.

Để khôi phục, dừng HRM/ghi dữ liệu, dùng `pg_restore` lên đúng database và giải nén `storage.tar.gz` vào volume Storage đã dừng. Kiểm tra checksum trước khi restore, sau đó xác minh dữ liệu và đăng nhập trên môi trường cô lập trước khi mở lại hệ thống. Không chạy restore trực tiếp lên production khi chưa có bản sao hiện trạng.

## Điều kiện bàn giao database

Repository có `supabase/schema_baseline.sql` làm nền schema ban đầu và các migration nâng cấp trong `supabase/migrations/`. Baseline phụ thuộc các schema Supabase (`auth`, `storage`) đã được Supabase self-hosted khởi tạo trước; nó không thay thế việc cài Supabase hoặc chuyển dữ liệu production.

Chỉ chạy baseline một lần trên database HRM mới, rỗng và dùng riêng cho staging. Sau đó áp dụng các migration theo thứ tự tên tệp, rồi chạy `supabase/check_migrations.sql`. Tệp kiểm tra hiển thị những migration chưa có object tương ứng; các bucket và cấu hình nghiệp vụ được đánh dấu trong kết quả cần được xử lý riêng. Không chạy baseline trên database đang có dữ liệu.

Migration `20260929130000_employee_profile_records.sql` đã được đổi thành `20260929133000_employee_profile_records.sql` để tránh trùng version. Trước khi chạy migration trên database hiện hữu, vẫn phải đối chiếu lịch sử và schema thực tế; không coi trạng thái container healthy hoặc việc lệnh SQL chạy xong là bằng chứng dữ liệu production đã sẵn sàng.

Hiện repository chưa có `tools/init-production-db.sh` hoặc `tools/docker-restore.sh`. Runbook Linux trong [linux-staging-dry-run.md](./linux-staging-dry-run.md) nêu các lệnh tương đương để kiểm thử trên staging và cách nhận diện bước restore còn cần hoàn thiện script.
