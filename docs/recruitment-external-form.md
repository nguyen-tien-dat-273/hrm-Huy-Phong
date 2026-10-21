# Kết nối Google Forms với tuyển dụng

Google Forms không tự gọi webhook khi có câu trả lời mới. Dùng Apps Script gắn với biểu mẫu và trigger `On form submit` để gửi dữ liệu sang API `POST /api/recruitment-applications`. API cần header `Authorization: Bearer <RECRUITMENT_INTAKE_TOKEN>`.

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

`requisition_code`, `submission_id`, `full_name`, `email`, `cv_url` và `consent: true` là bắt buộc. `cv_url` phải là HTTPS. Với câu hỏi tải tệp lên Google Forms, Apps Script lấy URL tệp trong Drive và API lưu URL vào hồ sơ ứng viên. Tài khoản HR cần có quyền xem tệp trong Drive.

## Tạo form tuyển dụng tự động

Script tạo sẵn form, bảng câu trả lời và trigger gửi dữ liệu đến HRM. Mở [script tạo form](../tools/google-forms/create-recruitment-form.gs), sao chép vào dự án tại `script.google.com`, rồi thêm các **Script Properties** sau trong **Project Settings**:

- `API_URL`: URL đầy đủ của API, ví dụ `https://hr.example.com/api/recruitment-applications`.
- `API_TOKEN`: giá trị `RECRUITMENT_INTAKE_TOKEN` đã đặt ở máy chủ.
- `REQUISITION_CODE`: mã đợt tuyển dụng đang mở.

Chạy `createRecruitmentForm()` một lần và cấp quyền theo yêu cầu. Script tạo các câu hỏi họ tên, email, số điện thoại, giới thiệu thêm, đồng ý lưu thông tin; tạo bảng câu trả lời; cài trigger đồng bộ. Link form, link chỉnh sửa và bảng câu trả lời xuất hiện trong **Execution log**. Mở link chỉnh sửa, thêm thủ công câu hỏi **File upload** có tiêu đề đúng `Tải CV`, đặt bắt buộc và giới hạn một tệp. Google Apps Script hiện không hỗ trợ tạo câu hỏi tải tệp bằng Form service; câu hỏi này cần được thêm trong trình chỉnh sửa Form ([tài liệu Form service](https://developers.google.com/apps-script/reference/forms/form)).

Google Forms yêu cầu ứng viên đăng nhập Google để tải tệp lên ([Trợ giúp Google Forms](https://support.google.com/docs/answer/15473134?hl=vi)). Nếu cần ứng viên nộp CV mà không cần tài khoản Google, cần dùng form tải tệp trên HRM hoặc nền tảng khác.

Sau khi thêm câu hỏi CV, lưu URL gửi ứng viên trong **Tuyển dụng nội bộ → Kết nối Google Forms**. Tệp CV nằm trên Drive của chủ sở hữu form; cấp quyền xem cho tài khoản HR.

## Apps Script cho form đã có sẵn

Mở biểu mẫu → **Tiện ích mở rộng → Apps Script**, dán đoạn mã dưới đây. Sửa `FORM_FIELDS` cho khớp chính xác tiêu đề câu hỏi trong biểu mẫu. Trong **Project Settings → Script Properties**, thêm các thuộc tính `API_URL` (ví dụ `https://hr.example.com/api/recruitment-applications`), `API_TOKEN` (giá trị `RECRUITMENT_INTAKE_TOKEN`) và `REQUISITION_CODE` (mã đợt tuyển dụng). Sau đó tạo trigger cho hàm `onFormSubmit`, nguồn sự kiện **From form**, loại sự kiện **On form submit**.

```javascript
const FORM_FIELDS = {
  fullName: 'Họ và tên',
  email: 'Email',
  phone: 'Số điện thoại',
  cv: 'Tải CV',
  consent: 'Đồng ý lưu thông tin',
};

function onFormSubmit(e) {
  const props = PropertiesService.getScriptProperties();
  const answers = {};
  e.response.getItemResponses().forEach((answer) => {
    answers[answer.getItem().getTitle()] = answer.getResponse();
  });

  const text = (key) => String(answers[FORM_FIELDS[key]] || '').trim();
  const fileAnswer = answers[FORM_FIELDS.cv];
  const fileId = Array.isArray(fileAnswer) ? fileAnswer[0] : fileAnswer;
  if (!fileId) throw new Error('Không tìm thấy tệp CV trong câu trả lời.');

  const consentAnswer = answers[FORM_FIELDS.consent];
  const consent = Array.isArray(consentAnswer)
    ? consentAnswer.length > 0
    : ['true', 'yes', 'có', 'đồng ý'].includes(String(consentAnswer).trim().toLowerCase());
  if (!consent) throw new Error('Ứng viên chưa đồng ý lưu thông tin.');

  const cvUrl = DriveApp.getFileById(String(fileId)).getUrl();
  const payload = {
    requisition_code: props.getProperty('REQUISITION_CODE'),
    submission_id: e.response.getId(),
    full_name: text('fullName'),
    email: text('email'),
    phone: text('phone'),
    cv_url: cvUrl,
    consent: true,
  };
  const response = UrlFetchApp.fetch(props.getProperty('API_URL'), {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: `Bearer ${props.getProperty('API_TOKEN')}` },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
  if (response.getResponseCode() < 200 || response.getResponseCode() >= 300) {
    throw new Error(`API tuyển dụng trả về ${response.getResponseCode()}: ${response.getContentText()}`);
  }
}
```

Script dùng ID phản hồi của Google Forms làm `submission_id`, nên trigger gửi lại cùng phản hồi sẽ không tạo hồ sơ mới.

## Cấu hình

Thực hiện lần lượt trên môi trường HRM sẽ nhận ứng viên:

1. **Triển khai API.** Endpoint `/api/recruitment-applications` đã có trong repo và được đăng ký trong cả Vercel serverless API lẫn Docker API server. `API_URL` trong Apps Script phải là domain HTTPS công khai của HRM cộng với `/api/recruitment-applications`.
2. **Cấu hình secret máy chủ.** API yêu cầu `RECRUITMENT_INTAKE_TOKEN`, `SUPABASE_SERVICE_ROLE_KEY` và URL Supabase. Trên Vercel, đặt `RECRUITMENT_INTAKE_TOKEN`, `SUPABASE_SERVICE_ROLE_KEY` và `SUPABASE_URL` (hoặc `VITE_SUPABASE_URL`) ở **Project Settings → Environment Variables**, rồi redeploy. Với Docker, `.env.docker.example` đã có các biến cần thiết; `SUPABASE_INTERNAL_URL` mặc định trỏ đến Supabase trong Docker network. Có thể để token trong `.env.docker` hoặc `.env.recruitment` (file secret bị Git ignore) và chạy theo lệnh trong `docs/docker-handover.md`. Tạo token ngẫu nhiên dài, dùng cùng giá trị cho máy chủ và Apps Script; không commit hoặc gửi token/service role key qua chat.
3. **Cập nhật database.** Xác nhận đã chạy migration `supabase/migrations/20261013100000_recruitment_external_intake.sql` trên Supabase đang dùng. Migration thêm trường form ngoài và mã nhận diện phản hồi để chống trùng.
4. **Mở đợt tuyển dụng.** Trong HRM, chuyển yêu cầu đã duyệt sang **Đang tuyển**, rồi vào **Kết nối Google Forms** và lưu URL của form hiện tại. API sẽ từ chối nhận hồ sơ nếu đợt không ở trạng thái `OPEN` hoặc chưa lưu URL form.
5. **Gắn Apps Script vào Form.** Mở Google Form bằng Gmail sở hữu form → **Tiện ích mở rộng → Apps Script**. Dùng mã ở phần **Apps Script cho form đã có sẵn**, sửa `FORM_FIELDS` cho khớp tiêu đề câu hỏi thực tế, đặt `API_URL`, `API_TOKEN`, `REQUISITION_CODE` trong Script Properties, rồi tạo trigger `onFormSubmit` với nguồn **From form** và loại sự kiện **On form submit**. Trigger phải gắn với Form, không phải bảng tính phản hồi.
6. **Kiểm tra một hồ sơ thử.** Gửi phản hồi thử có CV, xem mục **Executions** của Apps Script để biết trigger thành công, sau đó kiểm tra ứng viên trong Kho hồ sơ ứng viên. Bấm lại cùng phản hồi không tạo bản ghi trùng. Nếu lỗi, API trả mã 400/401/409/503; nội dung lỗi hiện trong Execution log.

Hồ sơ được ghi vào Kho hồ sơ ứng viên với nguồn **Form ngoài**. Gửi lại cùng mã phản hồi sẽ cập nhật hồ sơ đó; email đã có trong cùng đợt tuyển sẽ được cập nhật thay vì tạo hồ sơ trùng. Hồ sơ đã có tiến độ tuyển dụng sẽ giữ nguyên giai đoạn khi dữ liệu liên hệ được đồng bộ lại.

API lưu URL Drive trong `cv_url`; API hiện chưa sao chép tệp vào Supabase Storage. Tài khoản HR cần quyền mở tệp trong Drive. Câu hỏi tải tệp của Google Forms cũng yêu cầu ứng viên đăng nhập tài khoản Google.
