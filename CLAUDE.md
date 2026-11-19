# Quy luật giao diện (bắt buộc)

Áp dụng cho mọi thay đổi trong `client/src`. Kiểm đủ các luật dưới đây trước khi coi một việc sửa UI là xong.

## 1. Vuông góc
- Ô nhập, nút, bảng, thẻ, hộp thoại, dropdown, tab: **vuông hẳn** (`rounded-none`).
- `rounded-full` chỉ dùng cho: ảnh đại diện, nhãn/badge trạng thái, chấm tròn, công tắc bật/tắt.
- Cấm `rounded`, `rounded-sm/md/lg/xl/2xl/3xl`.

## 2. Dropdown có ô tìm kiếm
- Mọi danh sách chọn dùng `components/ui/Dropdown.tsx` (tự hiện ô tìm khi > 7 lựa chọn, gõ không dấu được).
- Không dùng `<select>`, `<datalist>` hay menu tự viết cho danh sách nhân viên / phòng ban / dự án / kỳ.

## 3. Chữ phải nổi rõ trên nền
- Nền sáng: chữ chính `text-slate-900`, chữ phụ đậm nhất có thể là `text-slate-600`, nhạt hơn thì không được.
- Cấm `text-slate-300/400/500` (và các bậc tương đương của gray/zinc/neutral) trên nền sáng, kể cả placeholder, ô trống "—", dòng "Đang tải…".
- Dark mode giữ độ tương phản tương đương.

## 4. Không trùng lặp, không giải thích thừa, tiêu đề ngắn
- Thanh trên cùng của layout đã hiện tên trang → trang **không** đặt lại h1 trùng tên, **không** có câu mô tả dưới tiêu đề.
- Không viết đoạn hướng dẫn hay giải thích cách hệ thống chạy trên giao diện. Quy tắc nghiệp vụ thể hiện bằng hành vi (nút bị khoá, nhãn trạng thái, thông báo lỗi khi bấm), không bằng chữ.
- Không hiện một thông tin hai lần trên cùng trang (ví dụ thẻ tổng hợp lặp lại đúng số đã có trong bảng bên dưới).
- Tiêu đề trang / thẻ / hộp thoại tối đa khoảng 4 từ.
- Không nhắc mã tài liệu đặc tả (BR-…, FR…) trên giao diện.

Ví dụ phải bỏ (trang Chấm công cá nhân):
- ✗ "Theo dõi giờ vào/ra hôm nay và toàn bộ lịch công từng ngày trong tháng." — mô tả lại đúng những gì trang đang hiện.
- ✗ "Máy chấm công là nguồn chính ghi giờ vào. Quét ở máy rồi thì không cần check-in ở đây nữa — cuối ngày chỉ bấm Check-out… Hôm nào chưa kịp quét máy thì check-in ở đây, nhưng ngày đó phải chờ quản lý xác nhận…" — hướng dẫn quy trình. Thay bằng trạng thái ngắn ngay trên nút/ngày, ví dụ nhãn "Chờ xác nhận".

## 5. Một trang, một việc chính
- Phần dữ liệu dài (nhật ký, lịch sử, danh sách theo tháng) không xếp nối đuôi dưới phần thao tác chính. Tách sang **tab** riêng hoặc trang con, có phân trang hoặc cuộn trong khung.
- Ví dụ: trang Chấm công cá nhân hiện để "Nhật ký vào / ra tháng" chung một trang với phần check-in và lịch công nên trang rất dài → tách thành tab "Hôm nay" / "Lịch công" / "Nhật ký".
- Màn hình thao tác chính phải thấy đủ mà không cần cuộn xa (trên máy tính).

## 6. Đồng bộ tab, bộ lọc và nút hành động
Một loại điều khiển chỉ có MỘT kiểu hiển thị trên toàn hệ thống. Không tự vẽ lại bằng `<button>` + class riêng.
- **Chuyển nhóm nội dung / trang con** → `components/ui/Tabs.tsx` (gạch chân tab đang chọn, chữ in hoa, có icon tuỳ chọn, số đếm `count`, `alert` cho chấm đỏ việc cần xử lý, `to` khi mỗi tab là một đường dẫn). Cấm tab nền xám (`bg-slate-100 p-1`), tab dạng thẻ lớn, hay nút viên thuốc.
- **Lọc theo trạng thái / nhóm / kiểu xem** → `components/ui/FilterChips.tsx` (dải nút vuông liền nhau, mục đang chọn tô đặc). Cấm tự vẽ nút lọc.
- **Lọc theo danh sách giá trị** (người, phòng ban, dự án, kỳ) → `Dropdown` (luật 2).
- **Tìm kiếm** → ô có icon kính lúp bên trái, cao `h-11` (thanh công cụ trang) hoặc `h-9` (trong hộp thoại, bảng dày), viền `slate-300`, vuông góc. Không tự đặt chiều cao khác.
- **Thanh công cụ của trang** xếp theo thứ tự cố định: tab → tìm kiếm → dropdown lọc → bộ lọc trạng thái → nút hành động chính nằm **bên phải**.
- **Nút hành động** → `components/ui/Button.tsx`. Mỗi vùng chỉ một nút chính (`variant="primary"`, màu indigo) — kể cả khu nhân viên, không dùng riêng màu emerald/rose cho CTA. Nút phụ dùng `outline`, nút huỷ/xoá dùng `danger`. Liên kết trông như nút cũng dùng cùng class của `Button` (cỡ `min-h-11`).
- Trang mới hoặc form mới chưa có sẵn kiểu nào thì **thêm component vào `components/ui/`** rồi dùng, không viết cục bộ trong trang.

## 7. Phân trang cho danh sách và bảng
- Mọi trang dạng **danh sách / bảng dữ liệu** có thể dài (nhân sự, đơn từ, đề xuất, tài liệu, nhật ký, phiếu…) phải phân trang bằng `components/ui/Pagination.tsx`. Không tự vẽ nút Trước/Sau, không dùng "Xem thêm" làm cách phân trang, không để cuộn dài vô hạn.
- Dùng hook: `const pg = usePagination(filtered, PAGE_SIZE_TABLE, [search, filter]);` rồi `pg.rows.map(...)` và `<Pagination page={pg.page} total={pg.total} size={pg.size} noun="người" setPage={pg.setPage} />` đặt ngay dưới bảng/danh sách. Mảng truyền vào `resetKey` là các bộ lọc/tìm kiếm/tab/tháng — đổi thì tự về trang 1.
- Cỡ trang chuẩn, không tự đặt số khác: bảng **20** dòng (`PAGE_SIZE_TABLE`), danh sách thẻ **10** mục (`PAGE_SIZE_LIST`), bảng ma trận nhiều cột như bảng công/bảng lương **50** dòng (`PAGE_SIZE_MATRIX`).
- Thanh phân trang chỉ hiện khi quá một trang; luôn gồm khoảng đang xem "21–40 / 95 người" và nút Trước / Sau, số trang.
- Tổng, đếm, xuất file tính trên **toàn bộ** kết quả lọc, không chỉ trang đang xem.
- Danh sách cố định ngắn (dưới 10 mục: vai trò, cấu hình, bước quy trình) không cần phân trang.
