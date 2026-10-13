# Đề xuất cải tiến: chấm công và toàn hệ thống

*Soạn 13/10/2026, dựa trên mã nguồn `main` tại thời điểm này.*

---

## Vì sao đang khó dùng — một nguyên nhân, không phải mười

Hệ thống bày theo **bảng dữ liệu**, không theo **việc người dùng đang làm**.

Chốt lương tháng là **một việc**, nhưng phải đi qua **sáu mục menu** riêng:

```
Danh mục khoản lương → Tham số lương → Cơ chế lương
→ Số liệu lương tháng → Bảng lương → Điều chỉnh lương
```

Chấm KPI là **một việc**, phải đi qua **ba mục**:

```
Bộ KPI nhân sự → Chấm điểm theo tháng → Báo cáo KPI tháng
```

Người dùng phải tự biết thứ tự, tự nhớ tháng này mình đã làm tới đâu, và tự
quay lại đúng chỗ đang dở. Hệ thống biết thừa những điều đó nhưng không nói.

Tổng cộng khu quản trị có **29 mục menu trong 9 nhóm**. Con số đó không sai tự
thân — vấn đề là chúng được xếp theo *cái gì được lưu ở đâu* chứ không theo
*ai đang cần làm gì*.

**Chính repo này đã từng nhận ra và đã từng sửa.** Ngày 1/10, commit `4fc22cc`
gộp ba mục KPI thành một màn ba bước, kèm dải trạng thái đọc thẳng từ dữ liệu
thật ("2 bộ chưa đủ 100%", "chưa gán cho ai", "3 phiếu chưa khoá"). Đến 31 giờ
trước, commit `ffa291d` tách chúng ra lại thành ba mục. Hướng đúng đã có, chỉ
là không giữ được.

### Nguyên tắc cho mọi đề xuất dưới đây

> Mỗi màn phải trả lời được ba câu mà không cần ai giải thích:
> **tôi đang ở bước nào, còn thiếu gì, bấm gì tiếp theo.**

---

## A. Phần chấm công

### A1. Chốt một nguồn sự thật, rồi sửa chữ cho khớp

Hiện có **hai đường** cùng tạo ngày công: máy chấm công đẩy vào, và nhân viên
tự bấm trên HRM. Giao diện thì nói như thể máy là chính:

> *"...đã quét máy rồi thì không check-in ở đây nữa — cuối ngày chỉ bấm
> Check-out, ngày công tính ngay."* — `StaffDeviceAttendance.tsx:151`

Nhưng mã nguồn gọi đường tự bấm là **lối ngoại lệ** (dòng 83), còn thực tế
mấy tuần nay máy chưa đẩy được dữ liệu nào.

Nhân viên đọc một đằng, hệ thống làm một nẻo. Đây là thứ khiến người dùng mất
lòng tin nhanh nhất — và sửa thì **không tốn một dòng logic nào**, chỉ là viết
lại cho đúng.

**Cần quyết trước:** máy chấm công là nguồn chính, hay HRM là nguồn chính?
Quyết xong mới sửa chữ, chứ sửa chữ trước thì lại sai lần nữa.

### A2. Một màn "Hôm nay" trả lời đúng một câu

Nhân viên mở trang Chấm công chỉ để biết: **"hôm nay tôi đã được ghi nhận
chưa?"** Màn hiện tại bắt họ tự suy ra điều đó từ trạng thái, giờ vào, phương
thức, cờ duyệt.

Thay bằng một dòng to, rõ, ở trên cùng:

```
✓ Đã ghi nhận lúc 07:32 — từ máy chấm công
⏳ Đã check-in 07:32, chờ quản lý xác nhận
✗ Hôm nay chưa có ghi nhận nào
```

Dưới đó mới là chi tiết. Ai cần thì đọc, ai không cần thì nhìn một cái là xong.

### A3. Quét QR — đường giữa, không cần phần cứng

Giữa "tự bấm nút" (ai cũng bấm được từ nhà) và "vân tay" (phải có máy, phải
cài bridge) có một bậc trung gian: **dán mã QR ở cửa, nhân viên quét bằng điện
thoại**.

| | Tự bấm nút | Quét QR | Vân tay |
| --- | --- | --- | --- |
| Phải có mặt tại chỗ | không | **có** | có |
| Cần phần cứng | không | **một tờ giấy** | máy + bridge |
| Chạy được ngay | có | cần viết thêm | đang vướng |

Mã nên **đổi theo chu kỳ** (ví dụ mỗi 30 giây, hiện trên một màn hình hoặc máy
tính bảng ở cửa), nếu không ai đó chụp lại mã rồi gửi cho đồng nghiệp quét từ
nhà.

Đây là đề xuất duy nhất trong phần A cần viết tính năng mới.

### A4. Cảnh báo khi dữ liệu ngừng chảy

Đây là lỗi âm thầm nhất của cả hệ thống, và tài liệu trong repo đã cảnh báo ít
nhất ba lần:

> *"Trôi là bridge mất dấu máy và ngừng chảy dữ liệu, KHÔNG có cảnh báo nào."*
> — `HUONG-DAN.txt`

> *"Một bridge chết lúc 2 giờ sáng sẽ im lặng tuyệt đối, đến cuối tháng mới
> phát hiện ra vì bảng lương thiếu ngày công."* — `chay-bridge.cmd`

Cần: HRM tự kiểm, máy không gửi dữ liệu quá **N giờ trong giờ làm** thì hiện
cảnh báo đỏ ở Tổng quan và gửi thông báo cho người phụ trách.

Chi phí thấp, và nó chặn đúng loại sự cố đắt nhất: phát hiện vào ngày chốt
lương, khi đã muộn.

### A5. Duyệt chấm công: một chỗ, duyệt hàng loạt

Trang **Duyệt chấm công** đã có và đã có duyệt hàng loạt. Nhưng điều kiện duyệt
hàng loạt hiện đòi bản ghi phải có giờ ra — mà máy chỉ ghi giờ vào, nên dòng từ
máy không lọt vào mẻ duyệt đó.

Sửa điều kiện cho khớp thực tế là xong.

---

## B. Phần HRM nói chung

### B1. Gộp sáu mục Lương thành một màn bốn bước

Giữ nguyên sáu màn con, chỉ xếp lại thành một luồng có hướng, kèm dải trạng
thái đọc từ dữ liệu thật:

```
①  Khai cơ chế      Khoản lương · Tham số · Cơ chế từng người
②  Nhập số liệu     Tăng ca, sản lượng, doanh số tháng này
③  Tính & duyệt     Bảng lương tháng
④  Điều chỉnh       Truy lĩnh, truy thu kỳ đã khoá
```

Dải trạng thái phải nói thật, kiểu: *"3 người chưa có cơ chế lương"*, *"tháng
này chưa nhập số liệu"*, *"12 phiếu chưa duyệt"*.

Đó mới là phần khiến bốn bước này là **một luồng** chứ không phải bốn cái tab
cạnh nhau — bước nào còn vướng thì nói rõ vướng cái gì.

Menu cấp một từ 6 mục còn **1**.

### B2. Trả lại màn KPI ba bước

Commit `4fc22cc` đã làm đúng việc này và đã bị tách ra lại. Đề xuất: khôi phục,
và lần này ghi rõ trong mã **vì sao** nó là một màn, để lần sau không ai tách
nữa.

Menu từ 3 mục còn **1**.

### B3. Trang chủ trả lời "hôm nay tôi phải làm gì"

Hiện mở HRM ra là một danh sách menu — người dùng phải tự nghĩ xem hôm nay cần
vào đâu.

Thay bằng danh sách **việc đang chờ chính mình**:

```
▸ 12 ngày công chờ duyệt
▸ 3 đơn nghỉ phép chờ bạn
▸ Bảng lương tháng 10 chưa chốt — còn 4 ngày
▸ 5 nhân sự chưa có bộ KPI
```

Bấm vào là tới thẳng chỗ cần làm. Dữ liệu để dựng những dòng này **đã có sẵn
trong database**, chỉ là chưa ai gom lại một chỗ.

Đây là đề xuất có tác động lớn nhất tới cảm giác "dễ dùng", vì nó đổi câu hỏi
từ *"menu nào chứa thứ tôi cần?"* thành *"hôm nay có gì cần tôi?"*.

### B4. Rút menu cấp một

Sau B1 và B2, khu quản trị còn khoảng **20 mục thay vì 29**. Rà thêm một lượt
nữa để gộp những chỗ còn rời rạc.

Mục tiêu không phải ít mục cho đẹp, mà là **mỗi mục tương ứng một việc người
dùng gọi tên được**. "Danh mục khoản lương" không phải một việc — nó là một
bảng dữ liệu.

---

## Thứ tự đề xuất

Xếp theo *đổi ít công nhất mà người dùng thấy khác nhất*.

| Đợt | Việc | Công sức |
| --- | --- | --- |
| **1** | A1 sửa chữ cho khớp thực tế · A5 sửa điều kiện duyệt hàng loạt | nửa ngày |
| **2** | A4 cảnh báo ngừng chảy dữ liệu · A2 màn "Hôm nay" | 1,5 ngày |
| **3** | B1 gộp Lương · B2 trả lại KPI ba bước | 2 ngày |
| **4** | B3 trang chủ theo việc chờ | 2 ngày |
| **5** | A3 quét QR · B4 rà lại menu | 3 ngày |

Đợt 1 nên làm trước khi thông báo bất cứ điều gì cho nhân viên — đang có chỗ
giao diện nói sai so với hệ thống, phổ biến hướng dẫn lúc này là nhân rộng
hiểu nhầm.

---

## Một điều không nằm trong danh sách

Mọi đề xuất trên đều là **sắp xếp lại thứ đã có**, không phải xây mới — trừ A3
(quét QR) và A4 (cảnh báo).

Nghĩa là phần lớn cảm giác "khó dùng" hiện nay không đến từ thiếu tính năng.
Nó đến từ chỗ tính năng được bày ra theo cách hệ thống lưu trữ, chứ không theo
cách con người làm việc.
