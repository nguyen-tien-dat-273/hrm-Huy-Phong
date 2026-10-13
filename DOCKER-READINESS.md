# Đánh giá mức độ sẵn sàng bàn giao Docker

**Ngày đánh giá:** 07/10/2026
**Kết luận:** Chưa đủ cơ sở để bàn giao như một gói khách hàng chỉ cần chạy ngay. Đã có nền tảng Docker và hướng dẫn triển khai, nhưng vẫn cần hoàn thiện, cấu hình và kiểm thử hạ tầng Supabase cùng dữ liệu của khách hàng.

## Những gì đã kiểm tra

- `Dockerfile` đóng gói frontend và API của HRM trong image production.
- `compose.yaml` định nghĩa dịch vụ HRM và dịch vụ backup; có healthcheck, restart policy và một số thiết lập hạn chế quyền của container.
- `docs/docker-handover.md` mô tả kiến trúc, điều kiện máy chủ, cấu hình, sao lưu và khôi phục.
- `pnpm install --frozen-lockfile` hoàn tất và lệnh build production của ứng dụng thành công trên môi trường kiểm tra.
- Máy kiểm tra không có lệnh `docker`, do đó chưa chạy được `docker compose config`, build image hoặc kiểm tra các container hoạt động thực tế.

## Điều kiện cần hoàn tất trước khi bàn giao

### 1. Supabase self-hosted

HRM phụ thuộc Supabase self-hosted, bao gồm Auth, PostgREST, Storage và Realtime. Cần cài đặt và cấu hình stack Supabase riêng trên máy chủ khách hàng, bảo đảm HRM kết nối đúng Docker network, API gateway, PostgreSQL và Storage.

URL Supabase được nhúng vào frontend khi build phải là URL HTTPS có thể truy cập từ trình duyệt người dùng. URL nội bộ chỉ dành cho API server trong Docker network. Không mở trực tiếp PostgreSQL hoặc Supabase Studio ra Internet.

### 2. Schema, migration và dữ liệu HRM

Các migration hiện có trong repository là migration nâng cấp theo chức năng, không bao gồm migration nền để tạo toàn bộ schema HRM. Vì vậy, chỉ khởi tạo Supabase mới và chạy các migration hiện có chưa đủ để tạo database production dùng được.

- Cần lấy schema nền từ database hiện tại và đối chiếu lịch sử migration trước khi chuyển dữ liệu.
- Có hai migration cùng version `20260929130000`; cần xác minh lịch sử migration trước khi triển khai tự động bằng Supabase CLI.
- Migration `20261006100000_daily_assignments_security.sql` cần được chạy và kiểm tra trên staging sau khi có schema nền, trước khi đưa dữ liệu thật vào.
- Không coi trạng thái container healthy là bằng chứng database đã sẵn sàng cho HRM.

### 3. Cấu hình môi trường và vận hành

Khách hàng cần tự cấu hình secrets và domain theo môi trường của họ, bao gồm URL Supabase công khai, anon key, service-role key, mật khẩu PostgreSQL và cấu hình reverse proxy HTTPS. Cần cấu hình SMTP thật để luồng email xác thực/khôi phục mật khẩu hoạt động đúng.

HRM mặc định chỉ bind vào `127.0.0.1:8080`; reverse proxy của khách hàng phải chuyển tiếp HTTPS về cổng này. Không đưa service-role key vào frontend hoặc commit/gửi key qua kênh không an toàn.

### 4. Sao lưu và khôi phục

Compose có dịch vụ backup PostgreSQL và Supabase Storage, lưu bản sao vào đường dẫn backup được mount và giữ tối đa 30 ngày. Trước khi sử dụng cần:

- Mount NAS/thư mục backup trên máy chủ và bảo đảm UID/GID cấu hình có quyền ghi.
- Cấu hình đúng đường dẫn Storage của Supabase.
- Lưu bản mã hóa các file cấu hình chứa secrets ở nơi an toàn.
- Thiết lập giám sát/cảnh báo backup thất bại; hiện script chỉ ghi lỗi và thử lại sau 5 phút.
- Diễn tập khôi phục trên môi trường cô lập, kiểm tra checksum và dữ liệu trước khi áp dụng vào production.

## Kế hoạch xác nhận triển khai

1. Hoàn thiện schema nền, đối chiếu migration và lập kế hoạch chuyển dữ liệu.
2. Dựng Supabase self-hosted và HRM trên máy Linux thử nghiệm có Docker Engine và Docker Compose plugin.
3. Xác nhận cấu hình Compose hợp lệ, build image thành công, healthcheck đạt và các luồng đăng nhập, phân quyền, API, upload file hoạt động.
4. Kiểm tra domain HTTPS, SMTP, backup và khôi phục.
5. Chỉ bàn giao production sau khi các bước trên được xác nhận với cấu hình và dữ liệu của khách hàng.

## Phạm vi xác nhận

Đánh giá này xác nhận build ứng dụng bằng pnpm trên môi trường kiểm tra; không xác nhận Docker image/container thực sự chạy, Supabase của khách hàng hoạt động, hay quy trình chuyển dữ liệu và khôi phục đã được diễn tập.
