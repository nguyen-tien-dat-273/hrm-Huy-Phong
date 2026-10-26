# Cổng nhận máy chấm công trên Cloudflare Workers

Dùng khi máy chấm công **không đẩy được dữ liệu lên Vercel**: firmware chỉ nói HTTP thường,
hoặc không bắt tay được HTTPS với Vercel. Vercel đổi mọi yêu cầu cổng 80 sang HTTPS bằng mã 308
và máy không theo kiểu chuyển hướng đó. Cloudflare nhận được HTTP thường trên cổng 80 và 8080.

Worker này không chứa logic chấm công. Nó gọi lại đúng các hàm trong `api/iclock/`
(`cdata`, `getrequest`, `devicecmd`) nên chỉ có một bản logic; HRM vẫn ở Vercel.

## Cài đặt

Cần Node.js và một tài khoản Cloudflare. Chạy trong thư mục này:

```bash
cd cloudflare/iclock
npx wrangler@4 login
npx wrangler@4 secret put SUPABASE_URL                # cùng giá trị với Vercel
npx wrangler@4 secret put SUPABASE_SERVICE_ROLE_KEY   # cùng giá trị với Vercel
npx wrangler@4 secret put ATTENDANCE_DEVICE_SERIALS   # 1313245000324
npx wrangler@4 deploy
```

Lần `secret put` đầu tiên wrangler hỏi có tạo Worker mới không: trả lời `y`.
Cuối lệnh `deploy` in ra địa chỉ `https://hic.<tài-khoản>.workers.dev`.

Biến tuỳ chọn, đặt bằng cùng cách: `ATTENDANCE_UTC_OFFSET` (mặc định `+07:00`),
`RJ_IN_STATUS_CODES`, `RJ_OUT_STATUS_CODES`. Cũng cần đã chạy hai file
`supabase/paste-che-do-adms.sql` và `supabase/paste-adms-khong-token.sql`.

## Muốn máy gọi bằng HTTP thường

Địa chỉ `workers.dev` chưa kiểm xem có nhận HTTP thường không. Cách chắc hơn là tên miền riêng:

1. Tên miền phải nằm trên Cloudflare (DNS do Cloudflare quản lý).
2. Trong `wrangler.jsonc` bỏ chú thích dòng `routes`, đổi thành tên miền của bạn, rồi `deploy` lại.
3. Cloudflare › tên miền đó › SSL/TLS › Edge Certificates: tắt **Always Use HTTPS**.
4. Trên máy chấm công: địa chỉ máy chủ là tên miền ở trên, cổng **80** (hoặc 8080), tắt HTTPS/SSL.
   Cổng 8081 mặc định của máy không được Cloudflare nhận.

Đi HTTP thường nghĩa là mã nhân viên và giờ quét chạy trên Internet không mã hoá, và giao thức
ADMS vốn không có xác thực (chỉ có Serial). Chỉ dùng khi HTTPS không chạy.

## Xem máy gọi gì

```bash
npx wrangler@4 tail
```

Mỗi yêu cầu in một dòng `[iclock] ...`. Đường dẫn HRM chưa xử lý (như `registry`, `push`) in
kèm nội dung để biết firmware cần gì. Bản tin chấm công thì không in nội dung.

## Thử trên máy mình

```bash
npx wrangler@4 dev --local --port 8787 \
  --var SUPABASE_URL:http://127.0.0.1:54321 \
  --var SUPABASE_SERVICE_ROLE_KEY:test \
  --var ATTENDANCE_DEVICE_SERIALS:1313245000324

curl "http://127.0.0.1:8787/iclock/cdata?SN=1313245000324&options=all"
```
