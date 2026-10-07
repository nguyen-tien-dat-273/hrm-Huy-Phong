# Trạng thái chuẩn bị database và staging Linux

**Cập nhật:** 07/10/2026
**Trạng thái chung:** Đã có tài liệu hướng dẫn; chưa nạp schema vào project đang chạy và chưa nghiệm thu trên máy Linux.

## Đã thực hiện

- Có cấu hình đóng gói HRM bằng Docker tại `Dockerfile`, `compose.yaml` và `.env.docker.example`.
- Có dịch vụ backup PostgreSQL và Storage trong Compose, cùng các script `tools/docker-backup-loop.sh` và `tools/docker-backup-once.sh`.
- Có file `supabase/schema_baseline.sql` và 76 file SQL trong `supabase/migrations/`.
- Đã bổ sung runbook kiểm thử Ubuntu/Debian tại [linux-staging-dry-run.md](./linux-staging-dry-run.md).
- Đã cập nhật [docker-handover.md](./docker-handover.md) về điều kiện database và tình trạng các script.
- Theo kết quả kiểm tra read-only bằng Supabase CLI, project test được chỉ định đang hoạt động nhưng chưa có bảng trong schema `public` và chưa có bảng migration history. Không có lệnh ghi schema nào được chạy lên project đó.
- Cấu hình local của ứng dụng trỏ tới một Supabase project khác với project test vừa kiểm tra. Cần chủ sở hữu xác nhận project/database chính xác trước khi export hoặc triển khai.

## Chưa hoàn tất / chưa được xác nhận

- `supabase/schema_baseline.sql` hiện là baseline một phần, không phải schema-only export đầy đủ từ database HRM đang chạy.
- Chưa xác minh đủ sự tương thích giữa baseline và toàn bộ migrations. Không nạp các file hiện có vào project test cho đến khi hoàn thành việc đối chiếu.
- Chưa có `tools/init-production-db.sh`.
- Chưa có `tools/docker-restore.sh`.
- Chưa có mẫu Supabase self-hosted Compose và cấu hình Nginx HTTPS trong repo.
- Chưa cấu hình/kiểm thử SMTP thật.
- Máy làm việc hiện tại là Windows; chưa chạy `docker compose config`, chưa build/chạy container trên Linux, và chưa kiểm thử đăng nhập, upload KPI, chấm công, tính lương hoặc restore trên staging.

## Việc cần đội quản trị/Sếp cung cấp

1. Xác nhận project Supabase chứa database HRM hiện đang dùng và cấp quyền phù hợp cho người thực hiện.
2. Cung cấp **schema-only export** từ đúng database đó, không kèm dữ liệu nhân sự, password, API key, token hoặc secrets.
3. Xác nhận có thể dùng một Supabase project/database staging riêng, trống để thử nghiệm; tuyệt đối không thử bằng cách chạy baseline lên production.
4. Cung cấp máy Ubuntu/Debian staging có Docker Engine và Docker Compose plugin, cùng thông tin domain/DNS, đường dẫn Storage và vùng lưu backup nếu muốn nghiệm thu đầy đủ.
5. Nếu cần kiểm thử email, cung cấp thông số SMTP staging qua kênh quản lý secrets an toàn, không ghi vào tài liệu hoặc Git.

## Trình tự tiếp theo

1. Đối chiếu schema-only export với `supabase/schema_baseline.sql` và tất cả migration; xác định thứ tự, dependencies và các thao tác thủ công cần thiết.
2. Hoàn thiện baseline/migration và script init; rà soát trước khi ghi vào project staging rỗng.
3. Nạp schema vào staging, chạy migration và kiểm tra kết quả bằng `supabase/check_migrations.sql`.
4. Trên máy Linux, làm theo [linux-staging-dry-run.md](./linux-staging-dry-run.md): kiểm tra Compose, khởi động HRM/backup và kiểm thử các luồng nghiệp vụ bằng dữ liệu giả.
5. Hoàn thiện script restore và diễn tập khôi phục trên môi trường cô lập. Chỉ đánh dấu nghiệm thu sau khi dữ liệu PostgreSQL và file Storage đã được khôi phục, rồi xác minh ứng dụng hoạt động.

## Lưu ý an toàn

- Không chạy baseline lên database production hoặc database đã có dữ liệu.
- Không gửi hoặc commit `.env`, database password, Supabase service-role key, access token hay file backup chứa dữ liệu thật.
- Việc project test hiện không có bảng `public` chỉ là kiểm tra trạng thái tại thời điểm chạy; phải kiểm tra lại ngay trước khi nạp schema.
- Build ứng dụng thành công trước đó theo thông tin đã cung cấp; kết quả này không thay thế nghiệm thu Docker, Supabase hoặc Linux staging.
