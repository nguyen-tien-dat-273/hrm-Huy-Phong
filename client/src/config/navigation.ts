import type { LucideIcon } from 'lucide-react';
import {
  BarChart3, BookOpen, Briefcase, Calculator, ClipboardCheck,
  ClipboardList, Clock, ContactRound, FileWarning, FolderKanban, LayoutDashboard,
  LayoutGrid, Network, NotebookPen, Rocket, Settings, SlidersHorizontal, Table,
  ArrowLeftRight, Receipt, Scale, Target, UserSearch, Users, Wallet, Cpu,
  FileBarChart, Fingerprint, KanbanSquare, WalletCards,
} from 'lucide-react';
import type { AdminFunctionCode, AdminPermission } from '@/lib/permissions';

export interface AdminNavItem {
  to: string;
  label: string;
  description: string;
  icon: LucideIcon;
  permission: AdminPermission;
  anyPermissions?: AdminPermission[];
  group: string;
  keywords?: string;
  fullAdminOnly?: boolean;
  functionCode?: AdminFunctionCode;
  hideForTeamlead?: boolean;
}

/**
 * Một nguồn điều hướng duy nhất cho sidebar và tìm kiếm nhanh.
 * Thứ tự phản ánh vòng đời nghiệp vụ: thiết lập tổ chức → thu hút/tiếp nhận
 * nhân sự → vận hành công việc & thời gian → phát triển → hệ thống.
 */
export const ADMIN_NAV_ITEMS: AdminNavItem[] = [
  { to: '/admin/overview', label: 'Tổng quan điều hành', description: 'Toàn cảnh nhân sự và các cảnh báo cần xử lý', icon: LayoutGrid, permission: 'reports', group: 'Tổng quan', keywords: 'dieu hanh canh bao', functionCode: 'admin.overview' },
  { to: '/admin/reports', label: 'Báo cáo & phân tích', description: 'Theo dõi xu hướng và xuất dữ liệu tổng hợp', icon: BarChart3, permission: 'reports', group: 'Tổng quan', keywords: 'thong ke bieu do xuat du lieu' },

  { to: '/admin/organization', label: 'Cơ cấu tổ chức', description: 'Đơn vị, vị trí và tuyến quản lý', icon: Network, permission: 'users', group: 'Tổ chức & Nhân sự', keywords: 'co cau don vi phong ban chi nhanh vi tri tuyen quan ly' },
  { to: '/admin/users', label: 'Hồ sơ & tài khoản', description: 'Danh bạ nhân viên, vai trò và quyền truy cập', icon: Users, permission: 'users', group: 'Tổ chức & Nhân sự', keywords: 'danh ba nhan vien tai khoan phan quyen user' },

  { to: '/admin/recruitment', label: 'Tuyển dụng nội bộ', description: 'Đề xuất, BGĐ phê duyệt, tuyển chọn và thông báo kết quả', icon: UserSearch, permission: 'users', anyPermissions: ['users', 'projects'], group: 'Tuyển dụng', keywords: 'de xuat tuyen bgd phe duyet ung vien phong van ket qua noi bo' },
  { to: '/admin/workforce', label: 'Hồ sơ người lao động', description: 'Thông tin và tiến trình tuyển chọn của người lao động', icon: ContactRound, permission: 'users', group: 'Tuyển dụng', keywords: 'ung vien nguoi lao dong xuat khau', functionCode: 'admin.workforce' },
  { to: '/admin/worker-documents', label: 'Hồ sơ giấy tờ', description: 'Theo dõi hợp đồng, visa và tài liệu lao động', icon: FileWarning, permission: 'users', group: 'Tuyển dụng', keywords: 'hop dong visa tai lieu giay to', functionCode: 'admin.worker_documents' },

  { to: '/admin/projects', label: 'Dự án', description: 'Dự án, thành viên, mốc và tác vụ', icon: FolderKanban, permission: 'projects', group: 'Công việc & Dự án', keywords: 'project tac vu' },
  { to: '/admin/assignments', label: 'Giao việc hằng ngày', description: 'Phân công và xác nhận kết quả công việc trong ngày', icon: ClipboardList, permission: 'attendance', group: 'Công việc & Dự án', keywords: 'giao viec phan cong xac nhan' },
  { to: '/admin/worklog', label: 'Nhật ký giờ', description: 'Đối chiếu thời gian thực tế theo người và tác vụ', icon: NotebookPen, permission: 'reports', group: 'Công việc & Dự án', keywords: 'gio cong worklog timesheet' },

  { to: '/admin/attendance', label: 'Duyệt chấm công', description: 'Kiểm tra check-in, check-out và xác nhận ngày công', icon: ClipboardCheck, permission: 'attendance', group: 'Thời gian & Đơn từ', keywords: 'duyet cham cong check in check out ngay cong' },
  { to: '/admin/attendance-devices', label: 'Máy chấm công', description: 'Kết nối Ronald Jack, ánh xạ nhân viên và theo dõi đồng bộ', icon: Cpu, permission: 'attendance', group: 'Thời gian & Đơn từ', keywords: 'ronald jack zkteco van tay thiet bi', fullAdminOnly: true },
  { to: '/admin/leave', label: 'Trung tâm đơn từ', description: 'Duyệt nghỉ phép, đi muộn, về sớm, làm thêm và hủy phép', icon: ClipboardCheck, permission: 'leave', anyPermissions: ['leave', 'attendance'], group: 'Thời gian & Đơn từ', keywords: 'don tu xin nghi huy phep di muon ve som lam them tang ca' },
  { to: '/admin/timesheet', label: 'Bảng công tháng', description: 'Tổng hợp ngày công đã duyệt và xuất Excel', icon: Table, permission: 'attendance', group: 'Thời gian & Đơn từ', keywords: 'bang cong xuat excel timesheet', hideForTeamlead: true },
  { to: '/admin/attendance-settings', label: 'Thiết lập giờ làm', description: 'Giờ làm cố định, công chuẩn và định mức phép', icon: Clock, permission: 'attendance', group: 'Thời gian & Đơn từ', keywords: 'gio lam co dinh gio vao ra cong chuan di muon', hideForTeamlead: true },

  // Module lương tách thành các mục con để đặt dấu trang được, tìm nhanh thấy
  // được, và cấp quyền riêng từng phần. Thứ tự theo trình tự chốt kỳ trong
  // sheet "Đặc tả Lương – KPI": khai cơ chế → nhập số liệu → tính → duyệt.
  { to: '/admin/payroll/schemes', label: 'Cơ chế lương', description: 'Cách tính lương và các khoản riêng của từng nhân sự', icon: Users, permission: 'attendance', group: 'Lương & Đãi ngộ', keywords: 'co che luong bac luong phu cap rieng kpi nguoi phu thuoc', functionCode: 'admin.payroll_schemes' },
  { to: '/admin/payroll/inputs', label: 'Số liệu lương tháng', description: 'Giờ tăng ca, sản lượng và doanh số của kỳ lương', icon: SlidersHorizontal, permission: 'attendance', group: 'Lương & Đãi ngộ', keywords: 'tang ca san luong doanh so so lieu thang', functionCode: 'admin.payroll_inputs' },
  { to: '/admin/payroll', label: 'Bảng lương', description: 'Tính, duyệt, chi trả và xem phiếu lương từng người', icon: Wallet, permission: 'attendance', group: 'Lương & Đãi ngộ', keywords: 'tinh luong payroll thuc nhan phieu luong bang luong', functionCode: 'admin.payroll' },
  { to: '/admin/payroll/adjustments', label: 'Điều chỉnh lương', description: 'Truy lĩnh, truy thu cho sai sót của kỳ đã khóa', icon: ArrowLeftRight, permission: 'attendance', group: 'Lương & Đãi ngộ', keywords: 'truy linh truy thu dieu chinh sai sot ky truoc', functionCode: 'admin.payroll_adjustments' },
  { to: '/admin/payroll/components', label: 'Danh mục khoản lương', description: 'Danh sách khoản cộng, khoản trừ và mô tả sử dụng', icon: Receipt, permission: 'attendance', group: 'Lương & Đãi ngộ', keywords: 'khoan luong phu cap thuong phat tam ung mo ta', functionCode: 'admin.payroll_components' },
  { to: '/admin/payroll/params', label: 'Tham số lương', description: 'Ngày công chuẩn, bảo hiểm và giảm trừ thuế', icon: Scale, permission: 'attendance', group: 'Lương & Đãi ngộ', keywords: 'ngay cong chuan bao hiem thue tncn giam tru tham so', functionCode: 'admin.payroll_settings' },

  { to: '/admin/employee-lifecycle', label: 'Hội nhập & nghỉ việc', description: 'Checklist onboarding, offboarding và người hướng dẫn', icon: Rocket, permission: 'users', group: 'Đào tạo & Quy trình', keywords: 'onboarding offboarding checklist mentor', functionCode: 'admin.employee_lifecycle' },
  { to: '/admin/process-library', label: 'Thư viện quy trình', description: 'Quy trình, quy chế và hướng dẫn vận hành', icon: BookOpen, permission: 'training', group: 'Đào tạo & Quy trình', keywords: 'thu vien quy trinh quy che huong dan pdf' },
  { to: '/admin/training', label: 'Đào tạo', description: 'Khóa học, phân công và tiến độ học tập', icon: BookOpen, permission: 'training', group: 'Đào tạo & Quy trình', keywords: 'dao tao khoa hoc hoc tap' },
  // Ba muc cu — Bo KPI, Gan KPI cho nhan su, Cham diem theo thang — gio la
  // ba BUOC trong mot man. Tach ra lam ba muc menu bat nguoi dung tu biet thu
  // tu va tu nho minh dang do o dau, trong khi he thong biet thua.
  { to: '/admin/performance', label: 'Bộ KPI nhân sự', description: 'Khai bộ KPI chung cho cả phòng, hoặc bộ riêng cho từng người', icon: Target, permission: 'reports', group: 'KPI', keywords: 'kpi bo tieu chi cach tinh diem phong ban nhan su rieng', functionCode: 'admin.performance_manage' },
  { to: '/admin/performance/review', label: 'Chấm điểm theo tháng', description: 'Bảng tổng hợp đánh giá KPI của kỳ, nhập điểm và khoá kỳ', icon: ClipboardCheck, permission: 'reports', group: 'KPI', keywords: 'cham diem ky thang bang tong hop danh gia kpi khoa phieu', functionCode: 'admin.performance_manage' },
  { to: '/admin/performance/report', label: 'Báo cáo KPI tháng', description: 'Nhiều kỳ cạnh nhau: xu hướng từng người và xuất Excel', icon: BarChart3, permission: 'reports', group: 'KPI', keywords: 'bao cao kpi thang thong ke xu huong xuat excel', functionCode: 'admin.performance_manage' },

  { to: '/admin/settings', label: 'Cấu hình hệ thống', description: 'Thiết lập vận hành dùng chung toàn tổ chức', icon: Settings, permission: 'settings', group: 'Hệ thống', keywords: 'cau hinh thiet lap' },
  { to: '/admin/audit', label: 'Nhật ký hệ thống', description: 'Truy vết thay đổi dữ liệu và thao tác quản trị', icon: ClipboardCheck, permission: 'settings', group: 'Hệ thống', keywords: 'audit log lich su truy vet', functionCode: 'admin.audit' },
];

export interface StaffNavItem {
  to: string;
  label: string;
  description: string;
  icon: LucideIcon;
  group: string;
  keywords?: string;
}

/**
 * Một nguồn điều hướng duy nhất cho sidebar nhân viên và tìm kiếm nhanh.
 * Khi bổ sung chức năng mới, hai lối vào sẽ luôn xuất hiện đồng thời.
 */
export const STAFF_NAV_ITEMS: StaffNavItem[] = [
  { to: '/staff/dashboard', label: 'Trang chủ', description: 'Tổng quan công việc và lịch cá nhân hôm nay', icon: LayoutDashboard, group: 'Tổng quan', keywords: 'trang chu tong quan hom nay' },
  { to: '/staff/reports', label: 'Báo cáo cá nhân', description: 'Ngày công, thời gian và kết quả của bạn', icon: FileBarChart, group: 'Tổng quan', keywords: 'bao cao ngay cong thoi gian ket qua' },

  { to: '/staff/assignments', label: 'Việc được giao', description: 'Việc quản lý giao theo ngày, gửi lại khi xong', icon: ClipboardList, group: 'Công việc', keywords: 'giao viec phan cong nhiem vu' },
  { to: '/staff/projects', label: 'Dự án của tôi', description: 'Các dự án và thành viên đang cộng tác', icon: Briefcase, group: 'Công việc', keywords: 'du an project cong tac' },
  { to: '/staff/kanban', label: 'Tác vụ Kanban', description: 'Theo dõi và cập nhật trạng thái tác vụ', icon: KanbanSquare, group: 'Công việc', keywords: 'task cong viec tac vu' },
  { to: '/staff/worklog', label: 'Nhật ký giờ', description: 'Ghi nhận thời gian thực tế cho từng công việc', icon: NotebookPen, group: 'Công việc', keywords: 'ghi gio worklog timesheet' },

  { to: '/staff/attendance', label: 'Chấm công', description: 'Xem giờ vào từ máy và checkout cuối ngày', icon: Fingerprint, group: 'Thời gian & Lịch', keywords: 'gio vao may cham cong checkout van tay khuon mat' },
  { to: '/staff/leave', label: 'Đơn từ của tôi', description: 'Nghỉ phép, đi muộn, về sớm và làm thêm giờ', icon: ClipboardList, group: 'Thời gian & Lịch', keywords: 'don tu xin nghi quy phep di muon ve som lam them tang ca' },

  { to: '/staff/payroll', label: 'Lương của tôi', description: 'Xem phiếu lương và các khoản khấu trừ cá nhân', icon: WalletCards, group: 'Lương & Đãi ngộ', keywords: 'luong phieu luong thu nhap payslip khau tru' },

  { to: '/staff/kpi', label: 'KPI của tôi', description: 'Kết quả chấm điểm và điểm từng tiêu chí', icon: Target, group: 'KPI', keywords: 'kpi danh gia cham diem tieu chi' },
  { to: '/staff/training', label: 'Đào tạo của tôi', description: 'Khóa học được giao và tiến độ hoàn thành', icon: BookOpen, group: 'Phát triển', keywords: 'dao tao khoa hoc hoc tap' },
  { to: '/staff/processes', label: 'Quy trình & biểu mẫu', description: 'Tài liệu đang hiệu lực của công ty', icon: BookOpen, group: 'Phát triển', keywords: 'quy trinh bieu mau tai lieu quy che' },
  { to: '/staff/growth', label: 'Lộ trình phát triển', description: 'Checklist hội nhập và bàn giao của tôi', icon: Target, group: 'Phát triển', keywords: 'lo trinh phat trien onboarding offboarding checklist' },
];

/**
 * Cụm chức năng ở cấp một của sidebar.
 *
 * Sidebar phẳng phải in ra cả 30 mục cùng lúc, nghĩa là mỗi lần đổi trang
 * người dùng lại quét qua một danh sách dài gấp mấy lần màn hình. Dựng hai
 * cấp: cấp một chỉ còn 9 ô, bấm vào mới xổ ra chức năng con bên trong.
 *
 * Thứ tự ở đây quyết định thứ tự hiện trên sidebar — KHÔNG lấy theo thứ tự
 * xuất hiện trong `ADMIN_NAV_ITEMS`, vì thêm một mục mới vào giữa mảng đó sẽ
 * âm thầm đảo lộn cả sidebar.
 */
export interface AdminNavGroup {
  name: string;
  icon: LucideIcon;
  hint: string;
  /**
   * Lop Tailwind viet SAN, khong ghep chuoi.
   *
   * Tailwind quet ma nguon de biet phai sinh ra lop nao. Ghep kieu
   * `bg-${tone}-50` thi trong ma nguon khong co chuoi "bg-sky-50" nao, lop do
   * khong duoc sinh, va mau bien mat o ban build that - trong khi chay dev
   * van dung. Loi kieu do chi lo ra sau khi deploy.
   */
  iconIdle: string;
  iconOn: string;
  tileOn: string;
  textOn: string;
  chip: string;
}

/**
 * Cum chuc nang o cap mot cua dieu huong.
 *
 * Sidebar phang phai in ra ca 30 muc cung luc, nghia la moi lan doi trang
 * nguoi dung lai quet qua mot danh sach dai gap may lan man hinh. Dung hai
 * cap: cap mot chi con 8 o, bam vao moi xo ra chuc nang con ben trong.
 *
 * Moi cum mot mau: 8 o vuong cung mau xam thi phai DOC ten moi phan biet
 * duoc, con khac mau thi nho duoc bang vi tri va mau sac sau vai lan dung.
 *
 * Thu tu o day quyet dinh thu tu hien tren sidebar - KHONG lay theo thu tu
 * xuat hien trong `ADMIN_NAV_ITEMS`, vi them mot muc moi vao giua mang do se
 * am tham dao lon ca sidebar.
 */
/**
 * Moi quyen mo duoc nhung module nao - suy thang tu `ADMIN_NAV_ITEMS`.
 *
 * Nhan quyen truoc day viet tay ("Quan ly User", "Cham cong") va lech han voi
 * ten module nguoi dung nhin thay ngoai man chon ("To chuc & Nhan su", "Thoi
 * gian & Nghi phep"). Nguoi cap quyen phai tu doan tich cai nao thi mo ra cai
 * gi - doan sai thi hoac khoa mat viec cua nguoi ta, hoac mo rong hon minh
 * tuong.
 *
 * Tinh tu menu chu khong chep tay lan nua: them mot muc moi vao menu la bang
 * nay tu dung theo, khong co duong cho hai noi noi hai dieu khac nhau.
 */
export const MODULES_BY_PERMISSION: Partial<Record<AdminPermission, string[]>> = (() => {
  const map: Partial<Record<AdminPermission, string[]>> = {};
  for (const item of ADMIN_NAV_ITEMS) {
    // Mot muc menu co the mo duoc bang NHIEU quyen (`anyPermissions`): ví dụ
    // "Trung tâm đơn từ" mở được bằng `leave` HOẶC `attendance`. Chỉ quy nó
    // về `item.permission` thì bảng này báo THIẾU — admin cấp quyền
    // `attendance` cho ai đó mà không hề biết mình vừa mở luôn cả màn duyệt
    // đơn từ. Đây là màn dùng để quyết định cấp quyền, báo thiếu ở đây là
    // chỗ quyết định sai.
    for (const permission of item.anyPermissions ?? [item.permission]) {
      const list = map[permission] ?? (map[permission] = []);
      if (!list.includes(item.group)) list.push(item.group);
    }
  }
  return map;
})();

export const ADMIN_NAV_GROUPS: AdminNavGroup[] = [
  {
    name: 'Tổng quan', icon: LayoutDashboard, hint: 'Dashboard và báo cáo toàn công ty',
    iconIdle: 'bg-indigo-50 text-indigo-600', iconOn: 'bg-indigo-600 text-white shadow-sm shadow-indigo-600/30',
    tileOn: 'bg-indigo-50', textOn: 'text-indigo-700',
    chip: 'bg-indigo-600 text-white shadow-sm shadow-indigo-600/30 hover:bg-indigo-700',
  },
  {
    name: 'Tổ chức & Nhân sự', icon: Network, hint: 'Sơ đồ tổ chức, hồ sơ và tài khoản nhân sự',
    // Cyan chu khong phai sky: mau chinh cua he thong da la blue, ma o
    // "Tong quan" nam ngay ben trai o nay trong bang luoi - hai sac xanh
    // duong canh nhau thi phai doc ten moi phan biet.
    iconIdle: 'bg-cyan-50 text-cyan-600', iconOn: 'bg-cyan-600 text-white shadow-sm shadow-cyan-600/30',
    tileOn: 'bg-cyan-50', textOn: 'text-cyan-700',
    chip: 'bg-cyan-600 text-white shadow-sm shadow-cyan-600/30 hover:bg-cyan-700',
  },
  {
    name: 'Tuyển dụng', icon: UserSearch, hint: 'Đề xuất tuyển, ứng viên, hồ sơ và giấy tờ',
    iconIdle: 'bg-violet-50 text-violet-600', iconOn: 'bg-violet-600 text-white shadow-sm shadow-violet-600/30',
    tileOn: 'bg-violet-50', textOn: 'text-violet-700',
    chip: 'bg-violet-600 text-white shadow-sm shadow-violet-600/30 hover:bg-violet-700',
  },
  {
    name: 'Công việc & Dự án', icon: FolderKanban, hint: 'Dự án, giao việc và nhật ký giờ',
    // Cam chu khong phai tim: tim nam ngay canh indigo cua "Tong quan" nen
    // hai o dau bang luoi nhin gan nhu cung mot mau. Cam la mau am duy nhat
    // o khu vuc do, va trong luoi no o goc doi dien voi amber cua "Thoi gian"
    // nen hai mau am khong ke nhau.
    iconIdle: 'bg-orange-50 text-orange-600', iconOn: 'bg-orange-600 text-white shadow-sm shadow-orange-600/30',
    tileOn: 'bg-orange-50', textOn: 'text-orange-700',
    chip: 'bg-orange-600 text-white shadow-sm shadow-orange-600/30 hover:bg-orange-700',
  },
  {
    name: 'Thời gian & Đơn từ', icon: Clock, hint: 'Chấm công, bảng công và mọi loại đơn',
    iconIdle: 'bg-amber-50 text-amber-600', iconOn: 'bg-amber-500 text-white shadow-sm shadow-amber-500/30',
    tileOn: 'bg-amber-50', textOn: 'text-amber-700',
    chip: 'bg-amber-500 text-white shadow-sm shadow-amber-500/30 hover:bg-amber-600',
  },
  {
    name: 'Lương & Đãi ngộ', icon: Wallet, hint: 'Bảng lương, cơ chế và tham số',
    iconIdle: 'bg-emerald-50 text-emerald-600', iconOn: 'bg-emerald-600 text-white shadow-sm shadow-emerald-600/30',
    tileOn: 'bg-emerald-50', textOn: 'text-emerald-700',
    chip: 'bg-emerald-600 text-white shadow-sm shadow-emerald-600/30 hover:bg-emerald-700',
  },
  {
    // Fuchsia chu khong phai rose: mau chinh cua he thong gio la do thuong
    // hieu Huy Phong, ma rose chinh la do nhat - o KPI se trong y het o
    // "Tong quan" va nguoi dung phai doc ten moi phan biet duoc.
    name: 'KPI', icon: Target, hint: 'Chấm điểm, bộ tiêu chí và cách quy ra lương',
    iconIdle: 'bg-fuchsia-50 text-fuchsia-600', iconOn: 'bg-fuchsia-600 text-white shadow-sm shadow-fuchsia-600/30',
    tileOn: 'bg-fuchsia-50', textOn: 'text-fuchsia-700',
    chip: 'bg-fuchsia-600 text-white shadow-sm shadow-fuchsia-600/30 hover:bg-fuchsia-700',
  },
  {
    name: 'Đào tạo & Quy trình', icon: BookOpen, hint: 'Khóa học và thư viện quy trình',
    iconIdle: 'bg-teal-50 text-teal-600', iconOn: 'bg-teal-600 text-white shadow-sm shadow-teal-600/30',
    tileOn: 'bg-teal-50', textOn: 'text-teal-700',
    chip: 'bg-teal-600 text-white shadow-sm shadow-teal-600/30 hover:bg-teal-700',
  },
  {
    name: 'Hệ thống', icon: Settings, hint: 'Cấu hình, nhật ký và tính năng',
    iconIdle: 'bg-slate-100 text-slate-600', iconOn: 'bg-slate-700 text-white shadow-sm shadow-slate-700/30',
    tileOn: 'bg-slate-100', textOn: 'text-slate-800',
    chip: 'bg-slate-700 text-white shadow-sm shadow-slate-700/30 hover:bg-slate-800',
  },
];
