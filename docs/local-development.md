# Chạy HRM local với Supabase staging

## Cấu hình

1. Dùng một Supabase project staging/test đã có schema HRM và các migration cần thiết. Không dùng project production để tạo tài khoản hoặc dữ liệu demo.
2. Sao chép `.env.local.example` thành `.env.local` ở thư mục gốc repository.
3. Điền `VITE_SUPABASE_URL` và `VITE_SUPABASE_ANON_KEY` bằng Project URL và publishable/anon key của project. Đây là các giá trị phía trình duyệt; **không** đặt `service_role` key trong file này.
4. Trong Supabase Dashboard của project staging, mở SQL Editor và chạy `supabase/seed-demo-account.sql`.

Seed có thể chạy lại để đặt lại mật khẩu mẫu. Nó tạo tài khoản đã xác thực email cùng hồ sơ `admin`; chỉ chạy trên database staging/test mà bạn có quyền thay đổi.

## Cài dependency và chạy

Từ thư mục gốc repository trên Windows:

```powershell
corepack pnpm install --frozen-lockfile
corepack pnpm exec vite --host 127.0.0.1
```

Mở `http://127.0.0.1:5173` và đăng nhập bằng:

- Email: `demo.admin@example.test`
- Mật khẩu: `DemoAdmin123!`

Không dùng lại mật khẩu mẫu này ngoài project staging/test. Nhấn `Ctrl+C` trong terminal để dừng server local.

Các chức năng quản trị gọi `/api/*` cần API server riêng và `SUPABASE_SERVICE_ROLE_KEY` phía server; chúng không được cung cấp bởi Vite dev server. Không chuyển service-role key vào `VITE_*` hoặc gửi key qua chat.
