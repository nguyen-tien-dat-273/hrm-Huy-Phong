# Kết nối form tuyển dụng bên ngoài

Nền tảng form gửi câu trả lời về API `POST /api/recruitment-applications`. API nhận JSON và cần header `Authorization: Bearer <RECRUITMENT_INTAKE_TOKEN>`.

```json
{
  "requisition_code": "REQ-261013-ABC123",
  "submission_id": "mã phản hồi duy nhất từ nền tảng form",
  "full_name": "Nguyễn Văn A",
  "email": "a@example.com",
  "phone": "0900000000",
  "cv_url": "https://storage.example.com/cv/nguyen-van-a.pdf",
  "note": "Thông tin bổ sung",
  "consent": true
}
```

`requisition_code`, `submission_id`, `full_name`, `email`, `cv_url` và `consent: true` là bắt buộc. `cv_url` phải là HTTPS. Nền tảng form cần tạo URL CV có thể truy cập bởi người xử lý tuyển dụng; API hiện lưu liên kết CV vào hồ sơ, không tải tệp về Supabase Storage.

## Cấu hình

1. Cấu hình biến môi trường máy chủ `RECRUITMENT_INTAKE_TOKEN` bằng token đã tạo trong `.env.recruitment`. Với Vercel, thêm biến ở **Project Settings → Environment Variables** cho các môi trường cần dùng rồi redeploy; với Docker Compose, nạp `.env.recruitment` cùng `.env.docker` theo hướng dẫn bàn giao Docker.
2. Chạy migration `20261013100000_recruitment_external_intake.sql`.
3. Mở Tuyển dụng nội bộ, chuyển yêu cầu đã duyệt sang **Đang tuyển**, rồi chọn **Kết nối form ngoài** để lưu URL form cho đợt tuyển.
4. Cấu hình webhook trên nền tảng form để gọi endpoint với token và payload ở trên. Mỗi lần gửi phải dùng `submission_id` ổn định để API xử lý gửi lặp an toàn.

Hồ sơ được ghi vào Kho hồ sơ ứng viên với nguồn **Form ngoài**. Gửi lại cùng mã phản hồi sẽ cập nhật hồ sơ đó; email đã có trong cùng đợt tuyển sẽ được cập nhật thay vì tạo hồ sơ trùng. Hồ sơ đã có tiến độ tuyển dụng sẽ giữ nguyên giai đoạn khi dữ liệu liên hệ được đồng bộ lại.
