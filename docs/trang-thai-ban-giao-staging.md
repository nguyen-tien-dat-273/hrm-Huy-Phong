# Trạng thái chuẩn bị database và staging Linux

**Cập nhật:** 07/10/2026
**Trạng thái chung:** Supabase Local chạy được trong WSL bằng profile clone cô lập; chưa import snapshot đã ẩn danh và chưa kiểm thử hết các migration pending.

## Đã thực hiện

- Có cấu hình đóng gói HRM bằng Docker tại `Dockerfile`, `compose.yaml` và `.env.docker.example`.
- Có dịch vụ backup PostgreSQL và Storage trong Compose, cùng các script `tools/docker-backup-loop.sh` và `tools/docker-backup-once.sh`.
- Có file `supabase/schema_baseline.sql` và 81 file SQL trong `supabase/migrations/`.
- Đã bổ sung runbook kiểm thử Ubuntu/Debian tại [linux-staging-dry-run.md](./linux-staging-dry-run.md).
- Đã cập nhật [docker-handover.md](./docker-handover.md) về điều kiện database và tình trạng các script.
- Docker daemon trong WSL và Supabase CLI Linux 2.119.0 đã được xác minh.
- Đã tạo profile Supabase clone tại `tools/staging-clone/supabase/config.toml`, dùng ports riêng và tắt tự chạy migration/seed.
- Profile clone đã start thành công; database và dịch vụ Supabase báo healthy, endpoint Auth trả HTTP 200.
- Thử chạy toàn bộ migration trên database rỗng: sau khi thêm bảng/hàm `profiles` nền, migration dừng ở `20260903120000_leave_half_day.sql` do thiếu `public.leave_requests`. Đây là bằng chứng migrations cần schema hiện hữu, không phải bộ cài mới từ database rỗng.
- Không chạy lệnh link hoặc ghi lên Supabase Cloud. Chưa có snapshot dữ liệu nào được export/import.

## Chưa hoàn tất / chưa được xác nhận

- `supabase/schema_baseline.sql` là baseline một phần, không phải schema export đầy đủ; kiểu dữ liệu tổ chức trong file cũng không tương thích với migration UUID mới.
- Chưa có snapshot schema/dữ liệu đã ẩn danh, được phê duyệt và có thể khôi phục từ database HRM nguồn.
- Chưa đối chiếu migration history thực tế của nguồn với toàn bộ 81 migration; không replay toàn bộ thư mục migration lên clone một cách mù quáng.
- Chưa có `tools/init-production-db.sh`.
- Chưa có `tools/docker-restore.sh`.
- Chưa có mẫu Supabase self-hosted Compose và cấu hình Nginx HTTPS trong repo.
- Chưa cấu hình/kiểm thử SMTP thật.
- Chưa kiểm thử đăng nhập, RLS, upload KPI, chấm công, tính lương hoặc quy trình restore trên snapshot clone.

## Việc cần đội quản trị/Sếp cung cấp

1. Xác nhận project Supabase chứa database HRM hiện đang dùng và cấp quyền phù hợp cho người thực hiện.
2. Cung cấp snapshot staging đã được phê duyệt và ẩn danh, giữ nguyên quan hệ cần kiểm thử; không gồm password hashes, tokens, MFA secrets, API keys hoặc secrets. Không đưa dump thô vào Git.
3. Cung cấp migration history của nguồn hoặc xác nhận các migration đã chạy thủ công để đối chiếu. Nếu lịch sử không rõ, dừng trước khi đánh dấu migration đã áp dụng.
4. Xác nhận chỉ dùng profile clone local riêng hoặc một Supabase project/database staging riêng; tuyệt đối không thử bằng cách chạy baseline lên production.
5. Cung cấp máy Ubuntu/Debian staging có Docker Engine và Docker Compose plugin, cùng thông tin domain/DNS, đường dẫn Storage và vùng lưu backup nếu muốn nghiệm thu đầy đủ.
6. Nếu cần kiểm thử email, cấu hình SMTP staging qua secret manager; không ghi secrets vào tài liệu hoặc Git.

## Trình tự tiếp theo

1. Nạp snapshot đã ẩn danh vào profile clone riêng, không restore Supabase system schemas hoặc thông tin xác thực của người dùng thật.
2. Đối chiếu schema và migration history với các file migration, xác định chính xác migration pending.
3. Chạy từng migration pending trên clone bằng `ON_ERROR_STOP`; khi lỗi, khôi phục snapshot sạch rồi thử lại sau khi sửa.
4. Chạy [supabase/check_migrations.sql](../supabase/check_migrations.sql) như kiểm tra đối chiếu, không dùng kết quả probe làm bằng chứng duy nhất về lịch sử migration.
5. Trên máy Linux, làm theo [linux-staging-dry-run.md](./linux-staging-dry-run.md): kiểm tra Compose, khởi động HRM/backup và kiểm thử các luồng nghiệp vụ bằng dữ liệu giả.
6. Hoàn thiện script restore và diễn tập khôi phục trên môi trường cô lập. Chỉ đánh dấu nghiệm thu sau khi dữ liệu PostgreSQL và file Storage đã được khôi phục, rồi xác minh ứng dụng hoạt động.

## Lưu ý an toàn

- Không chạy baseline lên database production hoặc database đã có dữ liệu.
- Không gửi hoặc commit `.env`, database password, Supabase service-role key, access token hay file backup chứa dữ liệu thật.
- Việc project test hiện không có bảng `public` chỉ là kiểm tra trạng thái tại thời điểm chạy; phải kiểm tra lại ngay trước khi nạp schema.
- Build ứng dụng thành công trước đó theo thông tin đã cung cấp; kết quả này không thay thế nghiệm thu Docker, Supabase hoặc Linux staging.
