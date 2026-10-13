# Supabase Local – kiểm thử staging clone

## Mục tiêu

Kiểm thử migration trên bản clone cô lập của schema HRM, không chạy lại toàn bộ migration như một database cài mới. Production tiếp tục dùng Vercel và Supabase Cloud; không link CLI local tới production.

## Môi trường đã xác minh

- Windows 11 + WSL2/Ubuntu.
- Docker daemon trong WSL: `29.8.2`, đã phản hồi `docker info`.
- Supabase CLI Linux: `2.119.0`, cài tại `$HOME/.local/bin/supabase`.
- PostgreSQL major version cấu hình là 17.

## Phát hiện khi chạy migration thật

Chạy `supabase start --debug` trên database mới xác nhận chuỗi migration hiện tại **không phải** chuỗi cài đặt đầy đủ từ database rỗng:

1. `20260902000000_initial_profiles.sql` tạo `profiles` và các helper RLS nền.
2. `20260903000000_training_module.sql` ban đầu dừng vì thiếu `public.can(text)`; helper bootstrap đã được thêm vào migration nền.
3. Lần chạy tiếp theo dừng tại `20260903120000_leave_half_day.sql` vì `public.leave_requests` chưa tồn tại.

Database mới do lần chạy lỗi tạo ra đã được Supabase CLI dọn. Không có lệnh nào link hoặc ghi lên Supabase Cloud. Không tiếp tục `supabase db reset` trên profile chính: các migration cần schema HRM đã tồn tại và không thể kiểm thử như một fresh install bằng cách replay toàn bộ.

`npm run supabase:local:check` chỉ kiểm tra tên/timestamp migration cùng sự hiện diện/thứ tự của migration `profiles`; nó **không** chứng minh SQL chain chạy được hoặc các dependency đã đầy đủ.

## Phạm vi môi trường

```text
Local staging clone: HRM → Supabase Local clone → PostgreSQL (Docker, port 55422)
Production:           Người dùng → Vercel (frontend/API) → Supabase Cloud
```

Profile clone riêng ở [tools/staging-clone/supabase/config.toml](../tools/staging-clone/supabase/config.toml) có project ID và port riêng, tắt tự chạy migrations và seed. Mục đích là nạp snapshot staging trước, rồi chỉ chạy migration đã xác định là còn thiếu. Profile này không dùng `supabase link`.

Không dùng credentials production trong kiểm thử local. Không đưa service-role key vào frontend hoặc biến môi trường `VITE_*`. Không commit database dumps, dữ liệu khách hàng hoặc `.env`; file dump trong thư mục clone đã được gitignore.

## Khởi động profile staging clone

Trong WSL:

```bash
export PATH="$HOME/.local/bin:$PATH"
cd /mnt/c/Users/admin/Downloads/hrm-Huy-Phong-cloned
supabase --workdir tools/staging-clone start
supabase --workdir tools/staging-clone status
```

Profile clone có API tại `http://127.0.0.1:55421`, PostgreSQL tại `127.0.0.1:55422`, và Studio tại `http://127.0.0.1:55423`. Đây là stack local tách biệt; không thay đổi config Vercel hay Supabase Cloud.

## Quy trình clone và kiểm thử

1. Tạo snapshot có thể khôi phục của đúng database HRM nguồn, chỉ trong môi trường được chủ sở hữu phê duyệt. Không xuất/chia sẻ credentials, dump thô hoặc dữ liệu cá nhân.
2. Đặt các đầu vào đã duyệt vào `tools/staging-clone/restore/`:
   - `schema.sql`: schema ứng dụng `public` từ nguồn, không gồm system schemas hoặc secrets.
   - `masked-data.sql`: dữ liệu tổng hợp/đã ẩn danh, giữ nguyên khóa và quan hệ cần cho các test.
   - `migration-history.txt`: danh sách version từ `supabase_migrations.schema_migrations` (nếu có), cùng kết quả kiểm tra migration thủ công có liên quan.
   Thư mục `restore/` được gitignore; không thay đổi quy tắc này để commit snapshot.
3. Không mang `auth.users` password hashes, refresh/access tokens, MFA secrets hoặc session data sang staging. Tạo tài khoản test mới qua Supabase Auth riêng của clone và ánh xạ hồ sơ test tới user IDs mới; bảo đảm dữ liệu test vẫn thỏa các foreign key.
4. Giữ riêng migration history của nguồn. Chạy [supabase/check_migrations.sql](../supabase/check_migrations.sql) như kiểm tra đối chiếu nếu áp dụng được. Script đó chỉ probe một số object, không phải bằng chứng đầy đủ để đánh dấu migration đã chạy.
5. Restore schema và dữ liệu đã ẩn danh vào profile clone; giữ nguyên system schemas của Supabase Local. Không restore `auth`, `storage`, roles hoặc secrets từ nguồn lên local.
6. So sánh trạng thái schema/migration history với các file trong `supabase/migrations/`. Chỉ chạy migration được xác nhận là pending trên clone; không replay toàn bộ thư mục theo thứ tự một cách mù quáng. Nếu lịch sử không rõ hoặc file đã chạy thủ công nhưng không có version record, dừng và đối chiếu từng thay đổi trước khi cập nhật migration history.
7. Chạy mỗi migration pending với `psql -v ON_ERROR_STOP=1` trên database local clone. Sau mỗi file, kiểm tra schema, function, policies và trigger liên quan. Khi có lỗi, giữ log và khôi phục clone từ snapshot sạch trước lần thử lại.
8. Kiểm thử RLS bằng user test khác role, Auth, Storage và Realtime; chỉ dùng dữ liệu giả.

**Chưa thể coi quy trình clone/ẩn danh là hoàn tất** cho tới khi có snapshot staging đã duyệt, xác nhận được migration history của nguồn, và chạy hết các migration pending trên clone thành công. Không dùng `schema_baseline.sql` làm bản thay thế snapshot: file đó là baseline cũ một phần và có kiểu dữ liệu tổ chức không tương thích với migration UUID hiện tại.
