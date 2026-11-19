# HRM Huy Phong

Ứng dụng nhân sự: hồ sơ, chấm công (máy chấm công + HRM), bảng công, lương, KPI, tuyển dụng, đào tạo.

- `client/` giao diện React + Vite · `api/` hàm API (Node) · `server/` máy chủ chạy trong container
- `supabase/` migration và cấu hình cơ sở dữ liệu (Postgres/Auth/Storage/Realtime)
- `deploy/vps/` bộ cài và hướng dẫn triển khai lên VPS: **bắt đầu từ [deploy/vps/README.md](deploy/vps/README.md)**
- `tools/` công cụ sao lưu, đóng gói, bridge máy chấm công

Hiện tại production chạy trên Vercel + Supabase Cloud (+ Cloudflare Worker `cloudflare/iclock` nhận dữ liệu máy chấm công); đang chuyển sang VPS tự host.
