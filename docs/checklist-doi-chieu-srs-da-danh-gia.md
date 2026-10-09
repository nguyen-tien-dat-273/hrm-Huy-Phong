# HRM Huy Phong — SRS Project Comparison Checklist

> **Mục đích:** Dùng tài liệu này làm checklist để đối chiếu một project/codebase thực tế với SRS `HRM-SRS-001 v0.1` ngày 07/10/2026.
>
> **Nguồn:** `SRS_HRM_v.0.1.docx`. Nội dung dưới đây được rút gọn theo hướng **có thể kiểm tra trực tiếp trong project**.
>
> **Quy ước trạng thái**
> - `[ ]` Chưa kiểm tra
> - `[x]` Đạt
> - `[~]` Một phần
> - `[-]` Chưa có
> - `[?]` Không đủ bằng chứng / cần xác nhận nghiệp vụ

---

## 1. Thông tin project được kiểm tra

**Cách đọc trạng thái:** `[~]` nghĩa là có dấu vết triển khai liên quan, không phải mọi tiêu chí đều đã đạt. `[?]` nghĩa là chưa xác minh hoặc phạm vi chưa chốt. Không nhóm chức năng nào được đánh dấu đạt nếu thiếu bằng chứng UAT. Mục 22 được tích vì các vấn đề đó được nêu trực tiếp trong SRS, không có nghĩa dự án đã xử lý.

| Hạng mục | Giá trị |
|---|---|
| Project | HRM Huy Phong |
| Repository | `nguyen-tien-dat-273/hrm-Huy-Phong` - `C:\Users\admin\Downloads\hrm-Huy-Phong-cloned` |
| Branch | `main` |
| Commit | `faed6b4` |
| Ngày kiểm tra | 2026-10-07 |
| Người kiểm tra | Đánh giá tĩnh bằng AI assistant |
| SRS đối chiếu | HRM-SRS-001 v0.1 |
| Ghi chú | Rà code/tài liệu/migration; không kiểm thử production/UAT hoặc thiết bị thật. |

### Kết quả tổng quan

| Nhóm | Đạt | Có dấu vết một phần | Chưa có | Chưa kiểm tra / cần xác nhận |
|---|---:|---:|---:|---:|
| M01 — Tổ chức & Nhân sự (4 nhóm) | 0 | 4 | 0 | 0 |
| M02 — Đào tạo & Quy trình (3 nhóm) | 0 | 3 | 0 | 0 |
| M03 — Thời gian & Đơn từ (5 nhóm) | 0 | 5 | 0 | 0 |
| M04 — Dự án & Công việc (7 nhóm) | 0 | 7 | 0 | 0 |
| M05 — KPI (2 nhóm) | 0 | 2 | 0 | 0 |
| M06 — Lương & Đãi ngộ (3 nhóm) | 0 | 3 | 0 | 0 |
| M07 — Báo cáo quản trị (4 nhóm) | 0 | 3 | 1 | 0 |
| Bảo mật / NFR | 0 | 0 | 0 | Chưa kiểm chứng runtime/benchmark |
| Tích hợp / Hạ tầng | 0 | 4 | 0 | 4 |
---

# 2. Phạm vi bắt buộc

SRS xác định 7 phân hệ chính: M01–M07. Hệ thống hướng tới quản lý vòng đời nhân sự từ tuyển dụng, thử việc, hợp đồng, chấm công, đơn từ, đào tạo, KPI, lương/thuế/BHXH và báo cáo.

- [~] Có dấu vết triển khai M01 — Tổ chức và nhân sự; chưa xác nhận đủ tiêu chí nghiệm thu.
- [~] Có dấu vết triển khai M02 — Đào tạo và Quy trình; chưa xác nhận đủ tiêu chí nghiệm thu.
- [~] Có dấu vết triển khai M03 — Thời gian và Đơn từ; chưa xác nhận đủ tiêu chí nghiệm thu.
- [~] Có dấu vết triển khai M04 — Dự án và Công việc; chưa xác nhận đủ tiêu chí nghiệm thu.
- [~] Có dấu vết triển khai M05 — KPI; chưa xác nhận đủ tiêu chí nghiệm thu.
- [~] Có dấu vết triển khai M06 — Lương và Đãi ngộ; chưa xác nhận đủ tiêu chí nghiệm thu.
- [~] Có dấu vết triển khai M07 — Báo cáo quản trị; chưa xác nhận đủ tiêu chí nghiệm thu.

### Ngoài phạm vi cần kiểm tra

- [?] Không triển khai KPI 360° nếu chỉ theo scope SRS hiện tại.
- [?] Không có realtime GPS tracking 24/7; GPS chỉ ghi nhận tại thời điểm check-in/out.
- [?] Không kết nối trực tiếp cổng giải ngân ngân hàng; chỉ xuất file chuẩn.
- [?] Không thay thế hệ thống kế toán tổng thể.
- [?] Không xây CRM / quản lý logistics cấp chuỗi cung ứng.
- [?] Demo MVP không được mặc định coi là đã có KPI, Payroll đa cơ chế, Tuyển dụng/Hợp đồng.

---

# 3. M01 — Tổ chức và Nhân sự

## F01.01 — Hồ sơ & Tài khoản

- [?] Quản lý cơ cấu tổ chức cơ bản.
- [?] Quản lý tài khoản người dùng.
- [?] Quản lý hồ sơ nhân sự.
- [?] Import hồ sơ bằng Excel.
- [?] Self-service cho nhân viên cập nhật thông tin cá nhân.
- [?] Kiểm tra email/username trùng.
- [?] Nhân sự phải thuộc đơn vị hợp lệ.
- [?] Tài khoản có trạng thái và kiểm soát kích hoạt/khóa.
- [?] Gửi thông tin kích hoạt/tài khoản cho nhân viên.
- [?] Không gửi/lưu mật khẩu dạng plain text.
- [?] Có audit cho thay đổi quan trọng.

**Kiểm tra code:** `employees`, `user_accounts`, `account_requests`, import Excel, Auth, API/server action, audit log.

## F01.02 — Cơ cấu tổ chức & Phân quyền

- [?] Cây tổ chức Doanh nghiệp → Khối → Phòng ban → Nhân sự.
- [?] Quản lý `parent_id`.
- [?] Không cho tạo vòng lặp trong cây tổ chức.
- [?] Không xóa đơn vị đang có nhân sự nếu chưa điều chuyển.
- [?] Quản lý vị trí/chức vụ.
- [?] Gán người phụ trách/trưởng phòng.
- [?] RBAC 3 cấp.
- [?] Phân quyền theo chức năng.
- [?] Phân quyền theo field.
- [?] Phân quyền theo scope dữ liệu.
- [?] Tài khoản bị khóa/từ chối không được gán quyền vận hành.
- [?] Lưu lịch sử thay đổi cơ cấu.
- [?] Audit mọi thay đổi quyền.

## F01.03 — Tuyển dụng nội bộ & Online

- [?] Trưởng phòng tạo yêu cầu tuyển dụng.
- [?] Có luồng duyệt/xử lý tuyển dụng.
- [?] Có Talent Pool/Kho CV.
- [?] Tra cứu và chọn CV nội bộ.
- [?] Phản hồi danh sách CV.
- [?] Tạo Web Form tuyển dụng công khai.
- [?] URL tuyển dụng độc nhất.
- [?] Ứng viên nộp họ tên/email/SĐT/CV.
- [?] Kiểm soát email ứng viên trùng.
- [?] Kiểm soát định dạng/dung lượng file.
- [?] CV/hồ sơ được lưu tập trung.
- [?] Có thể chuyển ứng viên trúng tuyển thành nhân viên.
- [?] Có mã nhân viên duy nhất.
- [?] Có luồng thử việc/TTS → JD → KPI vị trí → chính thức nếu project đã triển khai phần này.
- [?] Audit trạng thái tuyển dụng.

## F01.04 — Kho hồ sơ giấy tờ

- [?] Kho tài liệu tập trung.
- [?] Liên kết tài liệu với nhân sự.
- [?] Có loại tài liệu.
- [?] Có nguồn tài liệu.
- [?] Có metadata tài liệu.
- [?] Upload/preview/download theo quyền.
- [?] Kiểm soát file sai định dạng/dung lượng.
- [?] File nằm trên Storage.
- [?] Metadata được lưu trong DB.
- [?] Audit thao tác tài liệu.
- [?] Người ngoài scope không truy cập được tài liệu.

---

# 4. M02 — Đào tạo và Quy trình

## F02.01 — Thư viện quy trình & tài liệu

- [?] Thư viện tài liệu/quy trình nội bộ.
- [?] PDF/tài liệu có metadata.
- [?] Phân quyền theo Khối/Ban/Phòng ban.
- [?] Hỗ trợ tài liệu chung.
- [?] Hỗ trợ tài liệu phòng ban.
- [?] Liên kết quyền xem với Org Chart.
- [?] Kiểm soát tài liệu theo phiên bản/thời hiệu nếu project triển khai.

## F02.02 — Lộ trình đào tạo & Checklist

- [?] Admin tạo lộ trình đào tạo.
- [?] Khai báo đối tượng áp dụng.
- [?] Tạo khóa học.
- [?] Tạo mốc mục tiêu.
- [?] Tạo checklist.
- [?] Checklist có thứ tự.
- [?] Chỉ định người kiểm duyệt từng bước.
- [?] Sequential Flow: bước sau chỉ mở khi bước trước được duyệt.
- [?] Nhân viên gửi kết quả/bằng chứng.
- [?] Approver duyệt/từ chối.
- [?] Trạng thái bước: chờ duyệt / đã duyệt / cần làm lại / khóa/mở.
- [?] Có thông báo cho các bên liên quan.

## F02.03 — Onboarding / Offboarding

- [?] Có onboarding.
- [?] Có checklist onboarding.
- [?] Có tài liệu/bằng chứng.
- [?] Có offboarding nếu nghiệp vụ đã được chốt.
- [?] Có trạng thái hoàn thành.
- [?] Có audit.

> **Lưu ý:** SRS hiện ghi RC3.6 Offboarding là phần cần làm rõ/chưa có đặc tả hoàn chỉnh. Không tự coi thiếu phần này là lỗi code nếu nghiệp vụ chưa được chốt.

---

# 5. M03 — Thời gian và Đơn từ

## F03.01 — Duyệt chấm công

- [?] Ghi nhận check-in/out.
- [?] Quản lý trạng thái bản ghi chấm công.
- [?] Quản lý dữ liệu theo quyền quản lý.
- [?] Đối chiếu với giờ làm chuẩn.
- [?] Có xác nhận ngày công.
- [?] Có xử lý dữ liệu từ máy chấm công.
- [?] Có liên kết với bảng công.
- [?] Có liên kết dữ liệu sang Payroll.

## F03.02 — Máy chấm công

- [?] Cấu hình máy Ronald Jack.
- [?] Lưu tên/IP/model máy.
- [?] Bridge LAN.
- [?] Token xác thực Bridge.
- [?] Gửi dữ liệu qua HTTPS.
- [?] Nhận log máy chấm công.
- [?] Khử trùng lặp log.
- [?] Ánh xạ mã máy với mã nhân sự.
- [?] Import Excel khi offline.
- [?] Có trạng thái Online/Offline hoặc tương đương.
- [?] Có HMAC-SHA256 cho log theo yêu cầu bảo mật.
- [?] Có audit/log lỗi đồng bộ.

## F03.03 — Trung tâm đơn từ

- [?] Đơn nghỉ phép.
- [?] Đơn đi muộn/về sớm.
- [?] Đơn làm thêm giờ.
- [?] Hủy phép.
- [?] Quản lý quỹ phép.
- [?] Duyệt/từ chối.
- [?] Từ chối phải có lý do nếu nghiệp vụ yêu cầu.
- [?] Tự động trừ quỹ phép khi đơn được duyệt.
- [?] Cập nhật bảng công.
- [?] Duyệt nghỉ theo số ngày.
- [?] Có trạng thái rõ ràng.

## F03.04 — Bảng công tháng

- [?] Chọn kỳ công.
- [?] Tổng hợp ngày công theo nhân sự.
- [?] Hiển thị trạng thái ngày công.
- [?] Cảnh báo dữ liệu chưa duyệt.
- [?] Đối soát.
- [?] Xuất Excel.
- [?] Khóa bảng công sau khi chốt.
- [?] Dữ liệu bảng công dùng chung cho Payroll.

## F03.05 — Thiết lập giờ làm

- [?] Cấu hình giờ làm chuẩn.
- [?] Cấu hình giờ mùa hè/mùa đông.
- [?] Cấu hình công chuẩn tháng.
- [?] Cấu hình phép năm.
- [?] Thay đổi cấu hình có kiểm soát/audit.
- [?] Các module chấm công/bảng công/lương sử dụng cùng tham số.

---

# 6. M04 — Dự án và Công việc

## F04.01 — Khởi tạo dự án & thành viên

- [?] Tạo dự án.
- [?] Tên/mô tả.
- [?] Ngày bắt đầu/kết thúc.
- [?] Ngân sách.
- [?] Khách hàng.
- [?] Trạng thái.
- [?] Trưởng nhóm.
- [?] Thêm thành viên.
- [?] Phân quyền vai trò thành viên.
- [?] Ghi lịch sử thay đổi.
- [?] Gửi thông báo phân công.

## F04.02 — Tạo & phân công nhiệm vụ

- [?] Tạo task.
- [?] Mô tả task.
- [?] Chọn người thực hiện từ thành viên dự án.
- [?] Deadline.
- [?] Mặc định vào cột “Cần làm”.
- [?] Cập nhật tiến độ dự án.
- [?] Gửi thông báo người được giao.

## F04.03 — Gia hạn deadline

- [~] Người được giao gửi yêu cầu, hạn mới và lý do; lưu từng yêu cầu trong `project_task_requests`.
- [~] Project lead duyệt/trả lại; chỉ duyệt mới cập nhật deadline. Guard database chặn đổi hạn trực tiếp từ client.
- [~] Người yêu cầu nhận thông báo và thấy trạng thái/lý do trả lại trên Kanban.
- [?] Cần chạy migration và kiểm thử quyền/đồng thời trên clone Supabase.

## F04.04 — Kanban

- [?] Kanban.
- [?] Kéo thả task.
- [?] Kiểm tra quyền khi đổi trạng thái.
- [?] Có trạng thái theo SRS.
- [~] Chuyển sang Hoàn thành phải qua yêu cầu nghiệm thu của người được giao và Project lead duyệt; các chuyển trạng thái Kanban khác chưa có nhật ký riêng.
- [?] Đồng bộ real-time nếu triển khai Realtime.
- [~] Báo cáo nghiệm thu hiện là ghi chú; chưa hỗ trợ đính kèm link/file minh chứng.

## F04.05 — Báo cáo & nghiệm thu

- [~] Người được giao gửi yêu cầu nghiệm thu kèm kết quả/ghi chú.
- [?] Có link/file minh chứng.
- [~] Project lead duyệt hoặc trả lại có lý do; task chỉ chuyển `done` sau khi được duyệt.
- [~] Worklog nhân viên gửi theo tuần đã kết thúc, nhóm theo dự án; Project lead duyệt/trả lại với lý do và tuần đã gửi/duyệt bị khóa sửa.
- [~] Lịch sử chuyển trạng thái worklog được lưu; cần UAT quyền xem và đối soát dữ liệu.

## F04.06 — Xem công việc cá nhân

- [?] Nhân viên xem task của mình.
- [?] Quản lý xem phạm vi task theo quyền.
- [?] Lọc theo trạng thái/deadline nếu có.

## F04.07 — Giao việc hằng ngày

- [?] Quản lý giao việc hằng ngày.
- [?] Nhân viên nhận thông báo.
- [?] Nhân viên cập nhật kết quả.
- [?] Người giao việc xác nhận.
- [?] Có yêu cầu làm lại.
- [?] Có lý do làm lại.
- [~] Lịch sử tạo/sửa/gửi/duyệt/trả lại/xóa được ghi vào `daily_assignment_history` và xem trong chi tiết giao việc; chỉ ghi từ lúc migration áp dụng, không hồi tố.

---

# 7. M05 — KPI

> SRS v0.1 đánh dấu phần M05 là **đề xuất/chờ đặc tả 4.2.5**. Khi so sánh project, phải tách “có UI” khỏi “đã triển khai đúng nghiệp vụ”.

## F05.01 — Chỉ tiêu KPI & kỳ đánh giá

- [?] KPI theo phòng ban/vị trí.
- [?] Cấu hình mẫu KPI.
- [?] Cấu hình kỳ đánh giá.
- [?] Cấu hình chỉ tiêu kinh doanh.
- [?] Quản lý/đối tượng có quyền giao chỉ tiêu.
- [?] Có bước phê duyệt chỉ tiêu.
- [?] Khóa kỳ khi chốt.

## F05.02 — Đánh giá KPI 2 cấp

- [?] Nhân viên tự chấm KPI.
- [?] Có minh chứng/giải trình.
- [?] Quản lý cấp 2 chấm/duyệt.
- [?] Có cấp duyệt cuối.
- [?] Có khiếu nại/xác nhận số liệu.
- [?] Có khóa sổ KPI.
- [?] KPI được đưa sang Payroll.
- [?] KPI% có trần theo SRS.
- [?] Có xếp loại A+/A/B/C/D.
- [?] Có form giải trình nếu triển khai.
- [?] Có tổng hợp phục vụ xét tăng lương/thưởng.

---

# 8. M06 — Lương và Đãi ngộ

> M06 cũng được SRS đánh dấu **đề xuất/chờ đặc tả 4.2.6**. Đây là nhóm cần kiểm tra đặc biệt kỹ: không đánh giá “đã có” chỉ dựa vào việc có màn hình bảng lương.

## F06.01 — Cơ cấu lương & tham số

- [?] Có cấu hình kỳ lương.
- [?] Có tham số lương.
- [?] Có cơ cấu lương theo các khối nghiệp vụ.
- [?] Có BL01.
- [?] Có BL02.
- [?] Có tham số công chuẩn.
- [?] Có tham số OT.
- [?] Có tham số thuế TNCN.
- [?] Có tham số BHXH/BHYT/BHTN.
- [?] Có tham số KPCĐ nếu áp dụng.
- [?] Có kiểm soát thay đổi tham số.
- [?] Có audit.

## F06.02 — Tính lương, khóa & phê duyệt

- [?] Lấy dữ liệu từ bảng công.
- [?] Lấy dữ liệu KPI đã khóa.
- [?] Tính lương theo đúng công thức.
- [?] Có OT.
- [?] Có thuế TNCN.
- [?] Có BHXH/BHYT/BHTN.
- [?] Có các khoản khấu trừ/phụ cấp theo cấu hình.
- [?] Có Payroll Lock.
- [?] Không cho sửa input sau khi khóa kỳ.
- [?] KTT mở/khóa kỳ.
- [?] BGĐ phê duyệt chi trả.
- [?] Có xuất bảng lương.
- [?] Có xuất file chuyển khoản ngân hàng.
- [?] Không kết nối trực tiếp cổng giải ngân ngân hàng.
- [?] Có dữ liệu chi phí nhân sự cho kế toán tổng hợp.

## F06.03 — Payslip

- [?] Nhân viên xem phiếu lương của chính mình.
- [?] Trưởng phòng chỉ xem phạm vi phòng mình.
- [?] Cấp 1/KTT xem theo quyền.
- [?] Payslip có kỳ lương.
- [?] Payslip phản ánh KPI/công/thuế/bảo hiểm theo nghiệp vụ.
- [?] Không để lộ payslip của người khác.

---

# 9. M07 — Báo cáo quản trị

## F07.01 — Định biên & ngân sách quỹ lương

- [-] Chưa triển khai; tạm hoãn chờ chốt nguồn ngân sách/doanh thu (AMIS).
- [?] Báo cáo định biên.
- [?] Quỹ lương.
- [?] So sánh ngân sách/thực tế.
- [?] Liên hệ doanh thu thuần.
- [?] Cờ XANH/VÀNG/ĐỎ theo quy tắc.

## F07.02 — Biến động nhân sự & quỹ lương

- [~] Báo cáo biến động nhân sự; nghỉ việc chỉ ghi nhận kể từ khi áp dụng migration, không backfill ngày nghỉ cũ.
- [~] Báo cáo quỹ lương từ kỳ đã duyệt/chi trả.
- [~] Tổng hợp theo tháng.
- [~] Lọc theo đơn vị; cần áp dụng migration và UAT trên môi trường dữ liệu thật.

## F07.03 — Tổng hợp KPI & tăng lương/thưởng

- [~] Tổng hợp phiếu KPI đã khóa.
- [~] Tổng hợp theo tháng và đơn vị trong phạm vi được phép xem.
- [?] Chưa có dữ liệu xét tăng lương/thưởng trong báo cáo.
- [~] Có dữ liệu từ M05/M03 nếu nghiệp vụ yêu cầu. - module evidence found; acceptance not confirmed.

## F07.04 — BHXH & Thuế TNCN

- [~] Tổng hợp BHXH, BHYT/BHTN từ snapshot phiếu lương.
- [~] Tổng hợp thuế TNCN từ snapshot phiếu lương.
- [~] Chỉ lấy kỳ lương đã duyệt/chi trả; cần đối soát với nghiệp vụ kế toán.
- [~] Có giới hạn quyền xem payroll; cần xác nhận mapping quyền Kế toán trưởng.

---

# 10. Phân quyền & quyền riêng tư

## RBAC 3 cấp

### Cấp 1 — BGĐ / KTT / Admin

- [?] Quản trị hệ thống theo quyền.
- [?] Xem dữ liệu toàn phạm vi được cấp.
- [?] KTT có quyền vận hành bảng công/lương theo SRS.
- [?] BGĐ có quyền phê duyệt chi trả/báo cáo.

### Cấp 2 — Trưởng phòng

- [?] Quản lý nhân viên trong phòng.
- [?] Duyệt đơn theo phạm vi.
- [?] Duyệt/chấm KPI theo phạm vi.
- [?] Giao/duyệt công việc.
- [?] Chỉ xem lương nhân viên thuộc phạm vi phòng.
- [?] Không xem dữ liệu nhạy cảm của phòng khác.

### Cấp 3 — Nhân viên

- [?] Xem/cập nhật dữ liệu cá nhân theo quyền.
- [?] Check-in/out.
- [?] Gửi đơn.
- [?] Xem công việc.
- [?] Tự chấm KPI.
- [?] Xem payslip của chính mình.
- [?] Không xem dữ liệu nhân viên khác nếu không được cấp quyền.

### Dữ liệu nhạy cảm

- [?] CCCD được giới hạn theo quyền.
- [?] Dữ liệu lương được giới hạn theo scope.
- [?] Dữ liệu thuế/BHXH được giới hạn theo scope.
- [?] Có masking field nhạy cảm khi cần.
- [?] Có RLS ở tầng database.
- [?] Không chỉ kiểm tra quyền ở frontend.

---

# 11. Bảo mật — NFR/SEC

- [?] NFR-SEC-001: HTTPS/TLS.
- [?] NFR-SEC-002: RBAC + field-level + RLS.
- [?] NFR-SEC-003: Audit log cho tạo/sửa/xóa/duyệt.
- [?] Audit log không được tùy tiện sửa/xóa.
- [?] NFR-SEC-004: 2FA cho Admin/KTT khi chốt sổ lương.
- [?] NFR-SEC-005: HMAC-SHA256 cho log máy chấm công + token Bridge.
- [?] NFR-SEC-006: phát hiện Mock Location/Fake GPS.
- [?] Chặn check-in trên Root/Jailbreak nếu nền tảng cho phép.
- [?] SEC-01: tài khoản phải được kích hoạt.
- [?] SEC-02: RBAC 3 cấp + scope.
- [?] SEC-03: nhân viên chỉ xem payslip của mình.
- [?] Không lưu mật khẩu plain text.
- [?] Token/kích hoạt có thời hạn.
- [?] Khóa tài khoản khi nghỉ việc.
- [?] Có kiểm soát file upload.
- [?] Có audit cho thao tác quản trị.

> **Lưu ý:** Nếu project dùng PWA, khả năng phát hiện Root/Jailbreak và Fake GPS có thể bị giới hạn bởi nền tảng/browser. Phải ghi rõ “không hỗ trợ / giới hạn” thay vì đánh dấu đạt một cách máy móc.

---

# 12. Hiệu năng

- [?] NFR-PERF-001: webhook log máy chấm công ≤ 2 giây.
- [?] ≥95% log được ghi nhận trong ≤2 giây ở giờ cao điểm.
- [?] NFR-PERF-002: Mobile Check-in ≤3 giây qua 4G ổn định.
- [?] NFR-PERF-003: tính + xuất bảng lương ≤60 giây.
- [?] NFR-PERF-004: danh sách/tra cứu ≤3 giây với 10.000 bản ghi.
- [?] Có pagination cho dữ liệu lớn.
- [?] Có index phù hợp.
- [?] Có kiểm thử tải.

---

# 13. Availability / Reliability

- [?] NFR-AVAIL-001: uptime mục tiêu ≥99,9%/tháng.
- [?] NFR-AVAIL-002: không timeout trong giờ cao điểm chấm công 07:45–08:15 và 17:00–17:30.
- [?] NFR-REL-001: offline buffering cho log chấm công.
- [?] Đồng bộ bù ≤30 phút sau khi mạng hồi phục.
- [?] Không mất log.
- [?] NFR-REL-002: backup DB hằng ngày lúc 02:00.
- [?] Có kiểm thử restore backup.
- [?] NFR-REL-003: có phương án khôi phục sự cố.
- [?] RPO/RTO đã được xác nhận.
- [?] NFR-REL-004: retry email/notification khi thất bại.
- [?] Có cảnh báo Admin khi retry thất bại.

---

# 14. Usability / UI

- [?] NFR-USAB-001: Web Portal responsive.
- [?] NFR-USAB-001: Mobile/PWA dễ sử dụng.
- [?] NFR-USAB-002: Check-in một chạm từ màn hình chính.
- [?] NFR-USAB-003: Kanban kéo-thả trực quan.
- [?] Kanban đồng bộ realtime.
- [?] NFR-USAB-004: nhân viên kho có thể tự tra cứu công/nộp đơn.
- [~] NFR-USAB-005: M06 có thiết kế độc lập, không sao chép mẫu 1Office. - module evidence found; acceptance not confirmed.
- [?] UI có thông báo lỗi rõ ràng.
- [?] Form có validation.
- [?] Loading/error/empty state đầy đủ.

---

# 15. Compatibility / Platform

- [?] Chrome.
- [?] Edge.
- [?] Firefox.
- [?] Cốc Cốc.
- [?] PWA trên iOS 15+.
- [?] PWA trên Android 11+.
- [?] Mobile hỗ trợ GPS/camera cho Sales.
- [?] Ronald Jack nằm trong LAN.
- [?] Có máy chạy Bridge LAN.
- [?] Production và Staging/Demo tách biệt.

---

# 16. Storage / Database

- [?] PostgreSQL/Supabase hoặc hệ CSDL tương thích với thiết kế SRS.
- [?] Auth.
- [?] Storage.
- [?] Realtime nếu tính năng yêu cầu.
- [?] RLS.
- [?] Có dữ liệu audit.
- [?] Có backup.
- [?] Có migration/schema versioning.
- [?] Có index cho dữ liệu lớn.
- [?] Có foreign key/constraint phù hợp.
- [?] Không để dữ liệu nhạy cảm chỉ được bảo vệ bằng frontend.
- [?] Storage bucket có policy.
- [?] File URL không công khai ngoài phạm vi quyền.

---

# 17. Tích hợp bên ngoài

| Mã | Tích hợp | Kiểm tra |
|---|---|---|
| SW-01 / HW-01/02 | Ronald Jack + Bridge LAN | [~] Bridge code/docs; no physical device test |
| SW-02 | Email/Notification | [~] Notification/push code; email delivery unverified |
| SW-03 | Supabase Storage | [~] Storage traces; bucket policy/runtime access unverified |
| SW-04 | MISA AMIS / accounting | [?] Method/API/file unresolved; no live integration verified |
| SW-05 | Recruitment platform/TopCV | [?] Integration method unresolved in SRS |
| SW-06 | Bank file | [?] Export format/end-to-end file unverified |
| SW-07 / HW-03 | GPS + Mobile Camera | [~] GPS attendance trace; camera/anti-spoof acceptance unverified |
| SW-08 | Logistics data | [?] Unresolved dependency; no live integration verified |

### Cần phân biệt

- `[ ]` Tích hợp thật.
- `[ ]` Import/export file.
- `[ ]` Mock/demo.
- `[ ]` Chưa tích hợp.
- `[ ]` Phương thức tích hợp chưa được xác nhận trong SRS.

---

# 18. Data / Entity cần đối chiếu

Các nhóm entity quan trọng được SRS tham chiếu:

- [?] `org_units`
- [?] `positions`
- [?] `employees`
- [?] `user_accounts`
- [?] `roles`
- [?] `role_permissions`
- [?] `account_requests`
- [?] `recruitment_requests`
- [?] `recruitment_response_details`
- [?] `document_repository`
- [?] `audit_logs`
- [?] Entity đào tạo/onboarding/offboarding
- [?] Entity attendance/chấm công
- [?] Entity leave/request
- [?] Entity project/task
- [?] Entity KPI
- [?] Entity payroll
- [?] Entity payslip
- [?] Entity report

---

# 19. Audit / Traceability

Đối với mỗi chức năng quan trọng, cần xác định được:

```text
BRD / RC
   ↓
SRS Function Fxx.yy
   ↓
FRxx.yy.zz
   ↓
Use Case
   ↓
UI
   ↓
Database Entity
   ↓
API / Service
   ↓
Business Rule
   ↓
Test Case / UAT
```

Checklist:

- [?] Mỗi module có mã chức năng.
- [?] Mỗi chức năng quan trọng có FR.
- [?] FR có thể truy về BRD/RC.
- [?] Có UI tương ứng.
- [?] Có entity/database tương ứng.
- [?] Có business rule.
- [?] Có test case.
- [?] Không có chức năng “UI có nhưng backend chưa có”.
- [?] Không có API/database tồn tại nhưng không thuộc scope.
- [?] Không đánh dấu “đạt” chỉ vì màn hình hiển thị được.

---

# 20. Bảng đối chiếu thực tế

> Chỉ dùng bằng chứng tĩnh từ mã nguồn. `[~]` không có nghĩa các tiêu chí nghiệm thu chi tiết đã đạt. Đường dẫn tính từ thư mục gốc repository.

| ID | Yêu cầu | Trạng thái | Bằng chứng | Khoảng trống / ghi chú |
|---|---|---|---|---|
| F01.01 | Profile/accounts | [~] | `AdminUsers.tsx`, `ProfilePage.tsx`, `EmployeeImportModal.tsx`, `AdminAudit.tsx` | Activation/duplicate/scope/audit criteria need tests. |
| F01.02 | Organization/permissions | [~] | `AdminOrganization.tsx`, `lib/permissions.ts`, org/permission migrations | Field/scope/history require role tests. |
| F01.03 | Recruitment | [~] | `AdminRecruitment.tsx`, `PublicApplyPage.tsx`, recruitment migrations | TopCV and contract/probation handoff unresolved. |
| F01.04 | Document vault | [~] | `EmployeeDocumentVault.tsx`, `employeeDocuments.ts`, migration `20260929133000` | Storage policy/upload restrictions need tests. |
| F02.01 | Process library | [~] | `AdminProcessLibrary.tsx`, `StaffProcesses.tsx`, migration `20260930120000` | Org access/versioning not verified. |
| F02.02 | Training/checklist | [~] | `AdminTraining.tsx`, `StaffTraining.tsx`, training migrations | Sequential checklist/quiz/completion criteria unconfirmed. |
| F02.03 | On/offboarding | [~] | `StaffGrowth.tsx`, migration `20260908170000_nexus_hrm_capabilities.sql` | Offboarding scope unresolved in SRS. |
| F03.01 | Attendance approval | [~] | `AdminAttendance.tsx`, `AttendanceRequestPanel.tsx`, attendance migrations | Manual-approval conflict needs PO decision. |
| F03.02 | Time clock | [~] | `AdminAttendanceDevices.tsx`, `tools/attendance-bridge.mjs`, migration `20260926100000` | No hardware/HMAC integration test. |
| F03.03 | Requests/leave | [~] | `AdminLeave.tsx`, `lib/leave.ts`, leave/request migrations | All request types and approval paths need UAT. |
| F03.04 | Monthly timesheet | [~] | `AdminTimesheet.tsx`, baseline/timesheet migrations | Export/lock/payroll integration need tests. |
| F03.05 | Work schedule | [~] | `AdminAttendanceSettings.tsx`, `lib/workSchedule.ts`, migration `20260928110000` | Shared parameters/audit need verification. |
| F04.01 | Projects | [~] | `AdminProjects.tsx`, `AdminProjectDetail.tsx`, project migrations | Budget/history/notifications need tests. |
| F04.02 | Tasks/deadlines | [~] | `AdminAssignments.tsx`, `StaffAssignments.tsx`, `lib/assignments.ts` | Assignment constraints require tests. |
| F04.03 | Deadline extension | [~] | `StaffKanban.tsx`, `ProjectTaskWorkflowPanel.tsx`, migration `20261010110000` | Lead review and DB guard implemented; clone/UAT required. |
| F04.04 | Kanban | [~] | `StaffKanban.tsx`, `lib/portfolio.ts` | State/history/realtime/authorization need tests. |
| F04.05 | Report/acceptance | [~] | `StaffKanban.tsx`, `AdminProjectDetail.tsx`, `AdminWorklog.tsx`, migration `20261010110000` | Task completion acceptance and weekly worklog review implemented; evidence attachment remains absent. |
| F04.06 | My tasks | [~] | `StaffProjects.tsx`, `StaffKanban.tsx`, `StaffWorklog.tsx` | Scope filtering needs tests. |
| F04.07 | Daily assignments | [~] | `AdminAssignments.tsx`, `StaffAssignments.tsx`, migration `20261010110000` | Append-only history starts at migration; verify RLS/history rendering in clone. |
| F05.01 | KPI targets | [~] | `KpiTemplateEditor.tsx`, KPI template migrations | SRS M05 lacks detailed acceptance baseline. |
| F05.02 | Two-level KPI | [~] | `StaffKpi.tsx`, KPI review/evidence/scoring migrations | Approval/lock/payroll need UAT. |
| F06.01 | Payroll setup | [~] | `AdminPayroll.tsx`, `payrollSettings.ts`, payroll migrations | BL01/02 and formulas await accounting approval. |
| F06.02 | Payroll calculation/lock | [~] | `lib/payroll.ts`, `AdminPayroll.tsx`, migration `20260921090000`, payroll checks | Production formulas/approval/export need accounting UAT. |
| F06.03 | Payslip | [~] | `StaffPayroll.tsx`, payslip RLS migration `20260921090000` | Manager scope/privacy need DB authorization tests. |
| F07.01 | Headcount/budget | [?] | `AdminReports.tsx` general report page | Specific reports/thresholds unconfirmed. |
| F07.02 | HR/payroll changes | [~] | `AdminWorkforceReports.tsx`, employment-status history migration | Termination history starts at migration; payroll periods limited to approved/paid. |
| F07.03 | KPI summary | [~] | `AdminWorkforceReports.tsx`, locked performance reviews | Monthly/unit summary exists; salary increase/bonus decision data not included. |
| F07.04 | Social insurance/tax | [~] | `AdminWorkforceReports.tsx`, payslip snapshots | Payroll role mapping and accounting reconciliation need confirmation. |
| SEC | Security | [~] | `permissions.ts`, `ProtectedRoute.tsx`, RLS/audit migrations | No runtime security review; 2FA/HMAC/fake GPS unverified. |
| PERF | Performance | [?] | No benchmark/load test found or run | Measure SRS 2s/3s/60s/10k thresholds. |
| REL | Reliability/backup | [~] | `compose.yaml`, backup scripts, `docs/docker-handover.md` | Restore drill/RPO/RTO/alerts unverified. |
| UI | Usability/responsive | [~] | Responsive UI, PWA/service worker, loading/error/empty states | Static only; browser/mobile/accessibility tests not run. |
| INT | Integration | [~] | Attendance bridge, Supabase client, notification/storage code | Device/push/storage traces; MISA/TopCV/bank live integration unverified. |

---

# 21. Tiêu chí kết luận

## Đạt

Chỉ đánh dấu **Đạt** khi:

1. Chức năng tồn tại.
2. UI hoạt động.
3. Backend/API/service xử lý thật.
4. Database/storage tồn tại và đúng mục đích.
5. Quyền truy cập đúng.
6. Business rule chính được thực thi.
7. Không chỉ là mock/static/demo.
8. Có thể kiểm chứng bằng code hoặc test.

## Một phần

Dùng khi:

- UI có nhưng backend chưa đầy đủ.
- CRUD có nhưng business rule thiếu.
- Có chức năng nhưng thiếu phân quyền.
- Có DB nhưng chưa có flow hoàn chỉnh.
- Có import/export nhưng chưa có integration thật.
- Có demo nhưng chưa đủ tiêu chí nghiệm thu.

## Chưa có

Dùng khi:

- Không có route/component/API/service tương ứng.
- Không có DB/entity cần thiết.
- Không có flow nghiệp vụ.
- Chỉ có placeholder hoặc text “coming soon”.

## Không đủ bằng chứng

Dùng khi:

- Có code nhưng chưa xác định được luồng chạy.
- Có cấu hình nhưng chưa test.
- Có integration nhưng chưa xác định production có dùng thật hay không.
- SRS chưa chốt nghiệp vụ.

---

# 22. Các điểm đặc biệt cần kiểm tra kỹ

SRS v0.1 có một số nội dung chính nó đã ghi nhận là **chưa hoàn thiện/mâu thuẫn/chờ xác nhận**. Khi so sánh project không được coi chúng là yêu cầu đã chốt tuyệt đối:

- [x] M05 KPI còn chờ đặc tả chi tiết.
- [x] M06 Payroll còn chờ đặc tả chi tiết.
- [x] M07 Reporting còn chờ đặc tả chi tiết.
- [x] RC2.4: cách lấy CV từ TopCV chưa rõ.
- [x] RC2.6: hợp đồng/thử việc/JD/KPI vị trí chưa đầy đủ.
- [x] RC3.2: quy trình liên phòng ban chưa có FR rõ.
- [x] RC3.4: bài test và % hoàn thành chưa có FR rõ.
- [x] RC3.5: thời hiệu quy trình chưa phủ.
- [x] RC3.6: Offboarding cần làm rõ.
- [x] RC4.2: có mâu thuẫn liên quan duyệt công thủ công.
- [x] RC4.3: GPS check-in Sales chưa có chức năng đặc tả đầy đủ.
- [x] M04 có các vấn đề mã FR/ENT/BR cần lưu ý.
- [x] RPO/RTO chưa được quy định.
- [x] Phương thức tích hợp MISA/TopCV/dữ liệu kho vận cần xác nhận.
- [x] Quy mô nhân sự dùng để benchmark Payroll cần xác nhận.
- [x] Một số tham số lương/phạt/thưởng cần KTT xác nhận.

---

# 23. Kết luận đánh giá

- Nhóm chức năng đã rà soát: **28**
- Đạt: **0** (chưa có bằng chứng nghiệm thu/UAT)
- Có dấu vết triển khai một phần: **27**
- Chưa có: **1** (F07.01)
- Chưa kiểm tra/cần xác nhận: **1** (F07.01)

### Khoảng trống chính

1. Hoàn thiện/chốt đặc tả M05–M07 và chuẩn hóa mã/ma trận truy vết.
2. Kế toán/Pháp chế xác nhận quy tắc lương, thuế, bảo hiểm, làm thêm và hoa hồng.
3. Kiểm thử RLS/RBAC theo vai trò với dữ liệu nhạy cảm.
4. Xác nhận luồng gia hạn/nghiệm thu công việc, offboarding và checklist đào tạo.
5. Chạy kiểm thử tích hợp thiết bị, khôi phục backup, hiệu năng và UAT production.

### Mức độ hoàn thiện

- [?] MVP
- [?] Demo
- [?] Beta
- [ ] Sẵn sàng production
- [x] Chưa đủ điều kiện nghiệm thu

### Kết luận

Repository có dấu vết triển khai một phần các luồng M01–M07, nhưng chưa có bằng
chứng tiêu chí chi tiết đã đạt UAT. F04.03, nghiệm thu task, worklog tuần và lịch sử
giao việc vừa được bổ sung; phải chạy migration trên clone có schema nền dự án rồi
kiểm thử RLS/quyền lead. Không xem việc có UI/schema hoặc build thành công là bằng
chứng đủ cho business rule, RLS, tích hợp thiết bị hay payroll production. Cần chốt
SRS, chạy kiểm thử tích hợp và UAT với PO, Kế toán, Pháp chế trước khi go-live.

---

## 24. Nguyên tắc khi dùng file này với Agent

Agent khi review project phải:

1. Đọc code trước khi kết luận.
2. Tìm route → component → service/API → database → policy.
3. Không suy đoán chức năng chỉ từ tên file.
4. Không coi mock/static data là chức năng hoàn chỉnh.
5. Không tự sửa code trong quá trình audit nếu task chỉ yêu cầu phân tích.
6. Ghi rõ file/path làm bằng chứng.
7. Nếu không tìm thấy bằng chứng, đánh dấu `[-]` hoặc `[?]`, không tự đoán.
8. Giữ nguyên kiến trúc hiện tại của project khi phân tích.
9. Phân biệt:
   - **Implemented**
   - **Partially implemented**
   - **UI only**
   - **Backend only**
   - **Mock/demo**
   - **Missing**
   - **Cannot verify**
10. Mọi gap quan trọng phải ghi rõ nguyên nhân và phạm vi ảnh hưởng.

---

## Nguồn

- `SRS_HRM_v.0.1.docx`
- Mã tài liệu: `HRM-SRS-001`
- Version: `0.1`
- Ngày: `07/10/2026`