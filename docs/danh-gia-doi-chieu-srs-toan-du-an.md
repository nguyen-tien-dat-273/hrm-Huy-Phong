# Đánh giá đối chiếu SRS với toàn bộ dự án HRM Huy Phong

**Ngày đánh giá:** 07/10/2026
**Đầu vào:** `SRS_HRM_v.0.1.docx` (HRM-SRS-001, phiên bản 0.1, ngày 07/10/2026)
**Phạm vi:** Đọc đặc tả, rà soát mã nguồn/SQL migration/tài liệu triển khai trong repository và chạy các lệnh kiểm tra sẵn có. Đây là đánh giá tĩnh; không kết nối dữ liệu hoặc Supabase production.

## 1. Kết luận điều hành

Repository đã có nền tảng HRM tương đối rộng: các luồng về hồ sơ, tuyển dụng, đào tạo/quy trình, chấm công, đơn từ, dự án, KPI, tính lương và báo cáo đều có dấu vết trong frontend và/hoặc database migrations. Tuy nhiên, **chưa đủ căn cứ kết luận toàn bộ yêu cầu SRS đã được đáp ứng hoặc sẵn sàng nghiệm thu/UAT**.

Nguyên nhân lớn nhất là đầu vào yêu cầu chưa được chốt: các nhóm M05–M07 chưa có đặc tả chức năng đầy đủ; một số mã/nhóm chức năng không nhất quán; SRS tự ghi nhận 25 vấn đề cần xác nhận; các sơ đồ, mô tả giao diện và tiêu chí phi chức năng còn chỗ chờ điền. Vì vậy, việc thấy một trang hoặc bảng dữ liệu trong mã nguồn không đồng nghĩa đã đáp ứng tiêu chí nghiệm thu tương ứng.

**Khuyến nghị:** Chốt SRS và các quyết định nghiệp vụ/tuân thủ trước khi tuyên bố hoàn tất phạm vi. Sau đó lập ma trận truy vết từng yêu cầu FR → màn hình/API/database → test case → kết quả UAT.

## 2. Đối chiếu theo phân hệ

| Phân hệ | Dấu vết hiện có trong repository | Đánh giá mức đối chiếu |
|---|---|---|
| **M01 – Tổ chức và nhân sự** | Quản trị người dùng, hồ sơ nhân viên, tuyển dụng và form ứng tuyển công khai; có cấu phần hồ sơ giấy tờ và các migration về cơ cấu tổ chức/chuyển ứng viên. Xem [AdminUsers](../client/src/pages/admin/AdminUsers.tsx), [AdminRecruitment](../client/src/pages/admin/AdminRecruitment.tsx), [ProfilePage](../client/src/pages/ProfilePage.tsx), [EmployeeDocumentVault](../client/src/components/profile/EmployeeDocumentVault.tsx). | **Một phần.** Nhiều chức năng nền đã hiện diện, nhưng SRS chưa đặc tả đầy đủ quản lý hợp đồng/thử việc và các bước sau khi trúng tuyển; chưa đủ tiêu chí để xác nhận luồng hoàn chỉnh. |
| **M02 – Đào tạo và quy trình** | Quản trị/nhân viên có trang đào tạo, thư viện quy trình; có trang tăng trưởng nhân viên và migration cho checklist vòng đời nhân sự. Xem [AdminTraining](../client/src/pages/admin/AdminTraining.tsx), [StaffTraining](../client/src/pages/staff/StaffTraining.tsx), [AdminProcessLibrary](../client/src/pages/admin/AdminProcessLibrary.tsx), [StaffGrowth](../client/src/pages/staff/StaffGrowth.tsx). | **Một phần.** Có nền tảng triển khai, nhưng SRS còn thiếu/mâu thuẫn nhóm F02.03, số lượng FR, thời hiệu tài liệu, bài kiểm tra/đo hoàn thành và offboarding. |
| **M03 – Thời gian và đơn từ** | Có trang chấm công, thiết bị, yêu cầu chấm công, nghỉ phép, bảng công và thiết lập lịch/giờ làm; có logic và migrations cho các luồng liên quan. Xem [AdminAttendanceDevices](../client/src/pages/admin/AdminAttendanceDevices.tsx), [AdminLeave](../client/src/pages/admin/AdminLeave.tsx), [AttendanceRequestPanel](../client/src/components/attendance/AttendanceRequestPanel.tsx), [workSchedule.ts](../client/src/lib/workSchedule.ts). | **Một phần, chức năng cốt lõi hiện diện.** SRS ghi nhận mâu thuẫn về duyệt công thủ công, thiếu đặc tả chấm công GPS cho khối kinh doanh và bất nhất mã/nhãn giữa các nhóm. Cần xác nhận cấu hình thiết bị và chạy thử bridge trên môi trường tích hợp. |
| **M04 – Dự án và công việc** | Có quản trị dự án/chi tiết dự án, Kanban nhân viên, giao việc hằng ngày, Gantt và worklog. Bổ sung yêu cầu gia hạn deadline/duyệt nghiệm thu task, worklog tuần và lịch sử giao việc. Xem [AdminProjects](../client/src/pages/admin/AdminProjects.tsx), [StaffKanban](../client/src/pages/staff/StaffKanban.tsx), [ProjectTaskWorkflowPanel](../client/src/components/ProjectTaskWorkflowPanel.tsx), [AdminAssignments](../client/src/pages/admin/AdminAssignments.tsx), [AdminWorklog](../client/src/pages/admin/AdminWorklog.tsx), [M04 workflow migration](../supabase/migrations/20261010110000_m04_project_workflows.sql). | **Một phần.** Các workflow mới có guard/RPC và giao diện cơ bản; migration cần đối chiếu/chạy trên clone vì DDL nền của `tasks`/`task_worklogs` không được lưu trong repository. Task nghiệm thu hiện nhận ghi chú, chưa nhận file/link minh chứng; cần test RLS, quyền Project lead, gửi lại worklog và kiểm tra lịch sử trước UAT. |
| **M05 – KPI** | Có giao diện KPI cho nhân viên, các thành phần cấu hình/chấm điểm và migrations cho template, evidence, scoring và liên kết lương. Xem [StaffKpi](../client/src/pages/staff/StaffKpi.tsx), [components/kpi](../client/src/components/kpi/), [kpi migrations](../supabase/migrations/). | **Chưa thể kết luận độ phủ.** Mã nguồn có chức năng KPI, nhưng mục 4.2 của SRS chưa có đặc tả nhóm chức năng đủ dùng làm chuẩn nghiệm thu; bộ chỉ tiêu/tỷ trọng còn chờ xác nhận theo chính phụ lục SRS. |
| **M06 – Lương và đãi ngộ** | Có trang quản trị và phiếu lương nhân viên, thư viện công thức và migrations cho payroll engine/cấu hình. Xem [AdminPayroll](../client/src/pages/admin/AdminPayroll.tsx), [StaffPayroll](../client/src/pages/staff/StaffPayroll.tsx), [payroll.ts](../client/src/lib/payroll.ts), [payroll migrations](../supabase/migrations/). | **Chưa thể kết luận độ phủ nghiệp vụ.** SRS chưa hoàn thiện yêu cầu chức năng M06; phụ lục nêu các điểm chưa thống nhất về công thức, công chuẩn, hoa hồng, làm thêm giờ, thuế và bảo hiểm. Cần Kế toán/Pháp chế xác nhận căn cứ và cấu hình trước khi dùng số liệu trả lương thực tế. |
| **M07 – Báo cáo quản trị** | Có báo cáo biến động nhân sự/quỹ lương, tổng hợp phiếu KPI đã khóa, và BHXH/thuế TNCN từ các kỳ lương đã duyệt/chi trả. Xem [AdminWorkforceReports](../client/src/pages/admin/AdminWorkforceReports.tsx), [AdminReports](../client/src/pages/admin/AdminReports.tsx), [employment-status migration](../supabase/migrations/20261010100000_employment_status_report_history.sql). | **Một phần.** F07.02–F07.04 đã có báo cáo cơ bản; lịch sử nghỉ việc chỉ ghi nhận từ khi áp dụng migration, phạm vi KPI theo đơn vị/quyền truy cập, và cần UAT với dữ liệu thật. F07.01 (định biên/ngân sách/doanh thu AMIS) tạm hoãn, chưa triển khai. |

## 3. Các phát hiện cần xử lý

### Mức nghiêm trọng – Chặn chốt phạm vi/UAT

1. **SRS chưa phải baseline nghiệm thu ổn định.** Mục 4.2 còn tên mẫu ở các nhóm M02/M05; M06 và M07 chưa có đặc tả chức năng chi tiết. Một số sơ đồ Use Case/hoạt động và bảng mô tả màn hình còn chỗ chèn hình hoặc nội dung mẫu. Ma trận 5.2 có nội dung nhưng chính ma trận và phụ lục 5.3 cũng ghi nhận các hạng mục chưa phủ/chờ xác nhận.
   **Ảnh hưởng:** Không thể phân biệt rõ “đã làm”, “ngoài phạm vi” và “chưa làm”; QA không thể tạo bộ test/UAT đầy đủ chỉ từ phiên bản hiện tại.

2. **Các quyết định nghiệp vụ có ảnh hưởng trực tiếp đến chấm công và payroll còn mở.** Phụ lục 5.3 nêu mâu thuẫn duyệt công thủ công với dữ liệu máy; thiếu luồng chấm công GPS cho khối kinh doanh; bất nhất công chuẩn; công thức lương/hoa hồng chưa thống nhất; và căn cứ thuế/làm thêm giờ cần được xác nhận.
   **Ảnh hưởng:** Có thể tạo kết quả công/lương sai hoặc làm triển khai khác với quy trình đã thống nhất. Các nhận định pháp lý trong SRS chưa được xác minh độc lập trong đánh giá này; cần Kế toán/Pháp chế xác nhận bằng văn bản trước go-live.

### Mức cao – Cần làm rõ trước khi nghiệm thu phân hệ

3. **Ma trận chức năng có sai khác nội bộ.** SRS tự ghi nhận M02 khai báo F02.03 nhưng thiếu mục chi tiết tương ứng; số FR ở phần tóm tắt không khớp phần đặc tả; M04 khai báo số nhóm/chỉ số không nhất quán; M05–M07 được nhắc trong ma trận nhưng chưa có nội dung chi tiết. Một số chức năng ở ma trận được đánh dấu “phủ một phần” hoặc chưa có nhóm FR.
   **Ảnh hưởng:** Ma trận chưa thể làm căn cứ kiểm soát tiến độ/độ phủ cuối cùng.

4. **Mã tác nhân, thực thể, luồng dữ liệu và quy tắc không thống nhất.** SRS liệt kê việc trùng/đổi nghĩa mã EXT theo module, nhiều quy ước ENT/DF/BR và mã FR không theo cùng khuôn.
   **Ảnh hưởng:** Dễ tạo nhầm lẫn khi phân quyền, thiết kế schema, viết test hoặc truy vết thay đổi.

5. **Chưa thống nhất kiến trúc triển khai giữa SRS và repository.** SRS mô tả nền tảng triển khai Vercel; repository hiện có Dockerfile, Compose, API server và tài liệu bàn giao theo hướng Docker/self-hosted Supabase.
   **Ảnh hưởng:** Cấu hình môi trường, trách nhiệm vận hành, tích hợp email/storage và tiêu chí bàn giao có thể bị hiểu khác nhau. Cần chọn kiến trúc mục tiêu và cập nhật SRS/tài liệu vận hành tương ứng.

6. **Các yêu cầu phi chức năng chưa đủ điều kiện kiểm thử định lượng.** Phụ lục SRS nêu còn thiếu quy mô người dùng/dữ liệu để kiểm thử hiệu năng, RPO/RTO, thời hạn lưu hồ sơ ứng viên/dữ liệu dự án, giới hạn API, phương thức 2FA và một số yêu cầu thiết bị.
   **Ảnh hưởng:** Chưa thể đặt ngưỡng đạt/không đạt cho hiệu năng, khôi phục, lưu trữ và bảo mật; các nội dung này cần được chốt thành tiêu chí kiểm thử.

7. **Các giới hạn của PWA và tích hợp thiết bị chưa được chuyển thành tiêu chí khả thi đã duyệt.** Phụ lục SRS lưu ý yêu cầu chống root/jailbreak/giả lập vị trí khó bảo đảm trên PWA; đồng thời còn giả định/khác biệt về cách thiết bị Ronald Jack đẩy dữ liệu.
   **Ảnh hưởng:** Cần chọn rõ giải pháp (PWA, ứng dụng native hoặc kiểm soát thay thế), giao thức/thiết bị được hỗ trợ và cách xử lý mất kết nối trước khi nghiệm thu.

### Mức trung bình – Hoàn thiện tài liệu và bằng chứng kiểm thử

8. **Tài liệu tham khảo và vai trò nghiệp vụ còn phụ thuộc đầu vào chưa cung cấp/chưa chốt.** SRS ghi biểu mẫu lương BL01/BL02 còn thiếu; một số vai trò HR/HCNS cần được xác nhận; tích hợp MISA/TopCV và dữ liệu nguồn còn phụ thuộc.
   **Ảnh hưởng:** Cần lập danh sách phụ thuộc, người chịu trách nhiệm và ngày cần chốt để tránh phát sinh trong giai đoạn kiểm thử.

9. **Bằng chứng kiểm thử hiện có chưa chứng minh đầy đủ luồng tích hợp/nghiệm thu.** Các lệnh kiểm tra sẵn có tập trung vào build, kiểm tra công thức lương, luồng client và kiểm tra tĩnh tên/thứ tự migration; không thay thế kiểm thử với Supabase thật, thiết bị chấm công, email/push, phân quyền theo dữ liệu production-like hoặc UAT.
   **Ảnh hưởng:** Kết quả “build/test pass” chỉ xác nhận một phần chất lượng kỹ thuật, không xác nhận toàn bộ nghiệp vụ.

## 4. Kiểm tra đã chạy

| Lệnh | Kết quả | Giới hạn |
|---|---|---|
| `npm run build` | **Đạt** — ESLint, TypeScript, Vite production build và biên dịch API hoàn tất. | Không kiểm tra cấu hình/secrets hoặc dịch vụ bên ngoài tại môi trường production. |
| `npm run check:all` | **Đạt** — các kiểm tra công thức payroll và luồng nghiệp vụ hiện có hoàn tất. | Không phải bộ E2E/UAT cho toàn bộ 7 phân hệ. |
| `npm run supabase:local:check` | **Đạt** — kiểm tra tĩnh 81 file migration, tên/thứ tự và migration hồ sơ ban đầu. | Script thông báo rõ không thực thi SQL hoặc xác minh dependency/schema trên database. |

Tài liệu [DOCKER-READINESS.md](../DOCKER-READINESS.md) cũng ghi rõ lần đánh giá triển khai trước chưa xác nhận container/Docker thực tế, Supabase khách hàng, chuyển dữ liệu hoặc diễn tập khôi phục. Vì vậy, các mục này vẫn cần được kiểm tra trên staging theo cấu hình phát hành thực tế.

## 5. Việc cần làm theo thứ tự

1. **PO/BA:** Chốt phạm vi và hoàn thiện M02–M07; sửa các mã/đếm FR, UC, EXT, ENT, DF, BR; điền sơ đồ và mô tả màn hình; cập nhật ma trận 5.2 từ một nguồn chuẩn.
2. **Kế toán/Pháp chế:** Xác nhận công thức lương, công chuẩn, OT, hoa hồng, thuế/BHXH và quy định xử lý dữ liệu cá nhân; lưu quyết định/biểu mẫu làm căn cứ cấu hình.
3. **PO/BA + Dev:** Chốt các luồng onboarding/offboarding, tuyển dụng→hồ sơ/hợp đồng, chấm công GPS/máy, gia hạn/nghiệm thu công việc, KPI và các báo cáo M07; ghi rõ tiêu chí chấp nhận cho từng FR.
4. **Kiến trúc/DevOps:** Chốt Vercel hay Docker/self-hosted; lập hướng dẫn môi trường chuẩn; xác nhận schema nền, thứ tự migration, secrets, SMTP, Storage, backup và khôi phục trên staging.
5. **QA:** Tạo test case truy vết FR → UI/API/DB → dữ liệu kiểm thử; bổ sung kiểm thử quyền/RLS, tích hợp thiết bị/email/push, payroll regression, hiệu năng/khôi phục và UAT với người dùng nghiệp vụ.
6. **Go-live gate:** Chỉ nghiệm thu khi không còn quyết định mức nghiêm trọng/cao chưa có chủ sở hữu và phê duyệt; lưu kết quả test/UAT cùng phiên bản SRS đã chốt.

## 6. Giới hạn đánh giá

- Đối chiếu dựa trên SRS được cung cấp và trạng thái repository tại ngày đánh giá; không xác nhận dữ liệu production, cấu hình khách hàng hoặc hành vi hệ thống đang chạy.
- Không thực hiện đánh giá tuân thủ pháp luật độc lập, kiểm thử xâm nhập, kiểm thử tải, kiểm thử thiết bị vật lý hay kiểm thử khôi phục backup.
- Kết luận “có dấu vết trong mã nguồn” chỉ có nghĩa là tìm thấy trang/thành phần/logic/schema liên quan; không phải chứng nhận đầy đủ mọi nhánh nghiệp vụ hoặc phân quyền đã đạt yêu cầu.
