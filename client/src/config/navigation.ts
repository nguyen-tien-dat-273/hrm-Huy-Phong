import type { LucideIcon } from 'lucide-react';
import {
  BarChart3, BookOpen, Briefcase, Calculator, ClipboardCheck,
  ClipboardList, Clock, FileWarning, FolderKanban, LayoutDashboard,
  LayoutGrid, Network, NotebookPen, Rocket, Settings,
  SlidersHorizontal, Table, Target, UserSearch, Users, Wallet, Cpu, Link2,
  KanbanSquare, FileBarChart, Fingerprint, WalletCards, UserMinus,
  TrendingUp, MessageCircleQuestion,
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
  /** Mảng = mở khi có một trong các chức năng. */
  functionCode?: AdminFunctionCode | readonly AdminFunctionCode[];
  hideForTeamlead?: boolean;
  /** Trưởng nhóm chỉ được mở không gian nhân viên của mục này. */
  teamleadEmployeeDocuments?: boolean;
}

/**
 * Một nguồn điều hướng duy nhất cho sidebar và tìm kiếm nhanh.
 * Thứ tự phản ánh vòng đời nghiệp vụ: thiết lập tổ chức → thu hút/tiếp nhận
 * nhân sự → vận hành công việc & thời gian → phát triển → hệ thống.
 */
export const ADMIN_NAV_ITEMS: AdminNavItem[] = [
  { to: '/admin/overview', label: 'Tổng quan điều hành', description: 'Toàn cảnh nhân sự và các cảnh báo cần xử lý', icon: LayoutGrid, permission: 'reports', group: 'Tổng quan', keywords: 'dieu hanh canh bao', functionCode: 'admin.overview' },
  { to: '/admin/reports', label: 'Báo cáo & phân tích', description: 'Theo dõi xu hướng và xuất dữ liệu tổng hợp', icon: BarChart3, permission: 'reports', group: 'Tổng quan', keywords: 'thong ke bieu do xuat du lieu' },

  { to: '/admin/organization', label: 'Cơ cấu tổ chức', description: 'Đơn vị, vị trí và tuyến quản lý', icon: Network, permission: 'users', group: 'Nhân sự', keywords: 'co cau don vi phong ban chi nhanh vi tri tuyen quan ly' },
  { to: '/admin/users', label: 'Hồ sơ nhân sự', description: 'Thông tin cá nhân, tình trạng làm việc và giấy tờ nhân viên', icon: Users, permission: 'users', group: 'Nhân sự', keywords: 'ho so nhan su danh ba nhan vien tai khoan' },

  { to: '/admin/onboarding', label: 'Khai báo hồ sơ qua link', description: 'Đường dẫn cho nhân viên mới tự khai báo, duyệt và cấp tài khoản', icon: Link2, permission: 'users', group: 'Nhân sự', keywords: 'khai bao ho so link form nhan vien moi cap tai khoan duyet' },
  { to: '/admin/recruitment', label: 'Tuyển dụng nội bộ', description: 'Đề xuất, HR kiểm tra, BGĐ phê duyệt và thêm nhân sự vào dự án', icon: UserSearch, permission: 'users', anyPermissions: ['users', 'projects'], group: 'Tuyển dụng', keywords: 'de xuat tuyen bgd phe duyet ung vien phong van ket qua noi bo' },
  { to: '/admin/worker-documents', label: 'Kho hồ sơ giấy tờ', description: 'Tra cứu hồ sơ và giấy tờ nhân viên', icon: FileWarning, permission: 'users', group: 'Tổ chức & Nhân sự', keywords: 'ho so nhan vien hop dong visa tai lieu giay to', functionCode: 'admin.worker_documents', teamleadEmployeeDocuments: true },

  { to: '/admin/projects', label: 'Dự án', description: 'Dự án, thành viên, mốc và tác vụ', icon: FolderKanban, permission: 'projects', group: 'Dự án', keywords: 'project tac vu' },
  { to: '/admin/assignments', label: 'Giao việc hằng ngày', description: 'Phân công và xác nhận kết quả công việc trong ngày', icon: ClipboardList, permission: 'attendance', group: 'Giao việc', keywords: 'giao viec phan cong xac nhan' },
  { to: '/admin/worklog', label: 'Nhật ký giờ', description: 'Đối chiếu thời gian thực tế theo người và tác vụ', icon: NotebookPen, permission: 'reports', group: 'Dự án', keywords: 'gio cong worklog timesheet' },

  { to: '/admin/timesheet', label: 'Bảng công tháng', description: 'Tổng hợp ngày công đã duyệt và xuất Excel', icon: Table, permission: 'attendance', group: 'Công', keywords: 'bang cong xuat excel timesheet', hideForTeamlead: true },
  { to: '/admin/attendance', label: 'Duyệt chấm công', description: 'Kiểm tra check-in, check-out và xác nhận ngày công', icon: ClipboardCheck, permission: 'attendance', group: 'Công', keywords: 'duyet cham cong check in check out ngay cong' },
  { to: '/admin/leave', label: 'Trung tâm đơn từ', description: 'Duyệt nghỉ phép, đi muộn, về sớm, làm thêm và hủy phép', icon: ClipboardCheck, permission: 'leave', anyPermissions: ['leave', 'attendance', 'users'], group: 'Công', keywords: 'don tu xin nghi huy phep di muon ve som lam them tang ca' },
  { to: '/admin/attendance-devices', label: 'Máy chấm công', description: 'Kết nối Ronald Jack, ánh xạ nhân viên và theo dõi đồng bộ', icon: Cpu, permission: 'attendance', group: 'Công', keywords: 'ronald jack zkteco van tay thiet bi', fullAdminOnly: true },
  { to: '/admin/attendance-settings', label: 'Thiết lập giờ làm', description: 'Giờ làm cố định, công chuẩn và định mức phép', icon: Clock, permission: 'attendance', group: 'Công', keywords: 'gio lam co dinh gio vao ra cong chuan di muon', hideForTeamlead: true },
  { to: '/admin/attendance/reports', label: 'Báo cáo công', description: 'Tổng hợp chuyên cần, đi muộn, làm thêm và nghỉ phép theo tháng', icon: BarChart3, permission: 'attendance', anyPermissions: ['attendance', 'reports'], group: 'Công', keywords: 'bao cao cong cham cong chuyen can di muon lam them ot nghi phep' },

  // Module lương: Bảng lương lên đầu để vào module là vào thẳng bảng lương kỳ;
  // phê duyệt và thiết lập ở giữa; Báo cáo lương đưa xuống cuối sidebar.
  { to: '/admin/payroll', label: 'Bảng lương', description: 'Chạy nháp, khoá kỳ 2FA, file ngân hàng, chi trả & phát hành phiếu', icon: Wallet, permission: 'attendance', group: 'Lương', keywords: 'tinh luong payroll thuc nhan phieu luong bang luong khoa ky ngan hang', functionCode: 'admin.payroll' },
  { to: '/admin/payroll/approvals', label: 'Phê duyệt lương', description: 'Ký duyệt cơ chế lương và lệnh chi lương', icon: ClipboardCheck, permission: 'attendance', group: 'Lương', keywords: 'phe duyet bgd ky duyet co che luong chi luong', functionCode: 'admin.payroll_approve' },
  { to: '/admin/payroll/setup/params', label: 'Thiết lập lương', description: 'Thông số chung, cơ chế đơn vị, mức riêng từng người và danh mục đầu mục', icon: Calculator, permission: 'attendance', group: 'Lương', keywords: 'thiet lap luong co che luong cong thuc dau muc muc rieng bac luong tham so ty le don gia bao hiem thue danh muc khoan luong phu cap chay thu', functionCode: ['admin.payroll_settings', 'admin.payroll_schemes', 'admin.payroll_components'] },
  { to: '/admin/payroll/reports', label: 'Báo cáo lương', description: 'Biến động quỹ lương, chi phí BHXH và thuế TNCN theo tháng', icon: BarChart3, permission: 'attendance', group: 'Lương', keywords: 'bao cao luong quy luong bhxh thue tncn chi phi nhan su bien dong', functionCode: 'admin.payroll' },

  { to: '/admin/employee-lifecycle', label: 'Hội nhập nhân viên · Tham gia', description: 'Tiếp nhận nhân viên mới, checklist và tiến độ thử việc', icon: Rocket, permission: 'users', group: 'Đào tạo', keywords: 'onboarding tham gia checklist mentor', functionCode: 'admin.employee_lifecycle' },
  { to: '/admin/employee-lifecycle/offboarding', label: 'Lưu trữ thông tin nghỉ việc', description: 'Checklist nghỉ việc, bàn giao và thu hồi tài sản', icon: UserMinus, permission: 'users', group: 'Đào tạo', keywords: 'offboarding nghi viec ban giao luu tru', functionCode: 'admin.employee_lifecycle' },
  { to: '/admin/process-library', label: 'Thư viện quy trình', description: 'Quy trình, quy chế và hướng dẫn vận hành', icon: BookOpen, permission: 'training', group: 'Đào tạo', keywords: 'thu vien quy trinh quy che huong dan pdf' },
  { to: '/admin/training', label: 'Đào tạo', description: 'Khóa học, phân công và tiến độ học tập', icon: BookOpen, permission: 'training', group: 'Đào tạo', keywords: 'dao tao khoa hoc hoc tap' },

  // Module KPI: Phiếu KPI tháng lên đầu để vào module là vào thẳng chấm và duyệt phiếu;
  // Báo cáo KPI đưa xuống cuối sidebar.
  { to: '/admin/performance/review', label: 'Phiếu KPI tháng', description: 'Chấm, duyệt, khoá sổ và đối soát sang lương', icon: ClipboardCheck, permission: 'reports', group: 'KPI', keywords: 'phieu kpi cham diem duyet khoa so thang', functionCode: ['admin.performance_manage', 'admin.kpi_approve', 'admin.kpi_close'] },
  { to: '/admin/performance/sales', label: 'Chỉ tiêu kinh doanh', description: 'Doanh số khoán, thu tiền, khách hàng và số thực hiện', icon: TrendingUp, permission: 'reports', group: 'KPI', keywords: 'chi tieu kinh doanh doanh so khoan thu tien amis', functionCode: ['admin.performance_manage', 'admin.kpi_approve', 'admin.kpi_close'] },
  { to: '/admin/performance', label: 'Bộ KPI', description: 'Bộ tiêu chí theo phòng ban, vị trí hoặc từng người', icon: Target, permission: 'reports', group: 'KPI', keywords: 'kpi bo tieu chi hang muc ty trong vi tri phong ban ca nhan', functionCode: 'admin.performance_manage' },
  { to: '/admin/performance/settings', label: 'Tham số KPI', description: 'Xếp loại, trần, lịch kỳ và liên kết sang lương', icon: SlidersHorizontal, permission: 'reports', group: 'KPI', keywords: 'tham so kpi xep loai tran lich ky lien ket luong', functionCode: 'admin.performance_manage' },
  { to: '/admin/performance/report', label: 'Báo cáo KPI', description: 'Tiến độ kỳ, kết quả tháng, quý, năm và xét thưởng', icon: BarChart3, permission: 'reports', group: 'KPI', keywords: 'bao cao kpi xep loai quy nam thuong tang luong', functionCode: ['admin.performance_manage', 'admin.kpi_approve', 'admin.kpi_close'] },

  { to: '/admin/settings', label: 'Cấu hình hệ thống', description: 'Thiết lập vận hành dùng chung toàn tổ chức', icon: Settings, permission: 'settings', group: 'Hệ thống', keywords: 'cau hinh thiet lap' },
  { to: '/admin/audit', label: 'Nhật ký hệ thống', description: 'Truy vết thay đổi dữ liệu và thao tác quản trị', icon: ClipboardCheck, permission: 'settings', group: 'Hệ thống', keywords: 'audit log lich su truy vet', functionCode: 'admin.audit' },
  { to: '/admin/chatbot-logs', label: 'Trợ lý hỏi đáp', description: 'Câu hỏi người dùng gửi trợ lý và văn bản quy chế cho trợ lý tra cứu', icon: MessageCircleQuestion, permission: 'settings', group: 'Hệ thống', keywords: 'chatbot tro ly ai hoi dap cau hoi gemini quy che noi quy kien thuc' },
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

  { to: '/staff/projects', label: 'Dự án của tôi', description: 'Các dự án và thành viên đang cộng tác', icon: Briefcase, group: 'Công việc', keywords: 'du an project cong tac' },
  { to: '/staff/kanban', label: 'Kanban dự án', description: 'Theo dõi và cập nhật task theo từng dự án', icon: KanbanSquare, group: 'Công việc', keywords: 'kanban bang cong viec task trang thai keo tha' },
  { to: '/staff/worklog', label: 'Nhật ký giờ', description: 'Ghi nhận thời gian thực tế cho từng công việc', icon: NotebookPen, group: 'Công việc', keywords: 'ghi gio worklog timesheet' },

  { to: '/staff/attendance', label: 'Chấm công', description: 'Xem giờ vào từ máy và checkout cuối ngày', icon: Fingerprint, group: 'Thời gian & Lịch', keywords: 'gio vao may cham cong checkout van tay khuon mat' },
  { to: '/staff/leave', label: 'Đơn từ của tôi', description: 'Nghỉ phép, đi muộn, về sớm và làm thêm giờ', icon: ClipboardList, group: 'Thời gian & Lịch', keywords: 'don tu xin nghi quy phep di muon ve som lam them tang ca' },

  { to: '/staff/payroll', label: 'Lương của tôi', description: 'Xem phiếu lương và các khoản khấu trừ cá nhân', icon: WalletCards, group: 'Lương', keywords: 'luong phieu luong thu nhap payslip khau tru' },

  { to: '/staff/kpi', label: 'KPI của tôi', description: 'Tự chấm, kết quả và phiếu cần chấm của nhóm', icon: Target, group: 'KPI', keywords: 'kpi danh gia cham diem tieu chi tu cham' },
  { to: '/staff/training', label: 'Đào tạo của tôi', description: 'Khóa học được giao và tiến độ hoàn thành', icon: BookOpen, group: 'Phát triển', keywords: 'dao tao khoa hoc hoc tap' },
  { to: '/staff/processes', label: 'Quy trình & biểu mẫu', description: 'Tài liệu đang hiệu lực của công ty', icon: BookOpen, group: 'Phát triển', keywords: 'quy trinh bieu mau tai lieu quy che' },
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
    iconIdle: 'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-400', iconOn: 'bg-indigo-600 text-white shadow-sm shadow-indigo-600/30',
    tileOn: 'bg-indigo-50 dark:bg-indigo-500/15', textOn: 'text-indigo-700 dark:text-indigo-300',
    chip: 'bg-indigo-600 text-white shadow-sm shadow-indigo-600/30 hover:bg-indigo-700',
  },
  {
    name: 'Nhân sự', icon: Network, hint: 'Sơ đồ tổ chức, hồ sơ và tài khoản nhân sự',
    // Cyan chu khong phai sky: mau chinh cua he thong da la blue, ma o
    // "Tong quan" nam ngay ben trai o nay trong bang luoi - hai sac xanh
    // duong canh nhau thi phai doc ten moi phan biet.
    iconIdle: 'bg-cyan-50 text-cyan-600 dark:bg-cyan-500/15 dark:text-cyan-400', iconOn: 'bg-cyan-600 text-white shadow-sm shadow-cyan-600/30',
    tileOn: 'bg-cyan-50 dark:bg-cyan-500/15', textOn: 'text-cyan-700 dark:text-cyan-300',
    chip: 'bg-cyan-600 text-white shadow-sm shadow-cyan-600/30 hover:bg-cyan-700',
  },
  {
    name: 'Tuyển dụng', icon: UserSearch, hint: 'Đề xuất tuyển, ứng viên, hồ sơ và giấy tờ',
    iconIdle: 'bg-violet-50 text-violet-600 dark:bg-violet-500/15 dark:text-violet-400', iconOn: 'bg-violet-600 text-white shadow-sm shadow-violet-600/30',
    tileOn: 'bg-violet-50 dark:bg-violet-500/15', textOn: 'text-violet-700 dark:text-violet-300',
    chip: 'bg-violet-600 text-white shadow-sm shadow-violet-600/30 hover:bg-violet-700',
  },
  {
    name: 'Dự án', icon: FolderKanban, hint: 'Dự án, thành viên và nhật ký giờ',
    // Cam chu khong phai tim: tim nam ngay canh indigo cua "Tong quan" nen
    // hai o dau bang luoi nhin gan nhu cung mot mau. Cam la mau am duy nhat
    // o khu vuc do, va trong luoi no o goc doi dien voi amber cua "Thoi gian"
    // nen hai mau am khong ke nhau.
    iconIdle: 'bg-orange-50 text-orange-600 dark:bg-orange-500/15 dark:text-orange-400', iconOn: 'bg-orange-600 text-white shadow-sm shadow-orange-600/30',
    tileOn: 'bg-orange-50 dark:bg-orange-500/15', textOn: 'text-orange-700 dark:text-orange-300',
    chip: 'bg-orange-600 text-white shadow-sm shadow-orange-600/30 hover:bg-orange-700',
  },
  {
    // Lime: cam la cua "Du an", tim/indigo da co o "Tong quan" - lime la sac
    // lanh con trong, khong dung voi cum nao canh no.
    name: 'Giao việc', icon: ClipboardList, hint: 'Phân công và xác nhận việc hằng ngày',
    iconIdle: 'bg-lime-50 text-lime-700 dark:bg-lime-500/15 dark:text-lime-400', iconOn: 'bg-lime-600 text-white shadow-sm shadow-lime-600/30',
    tileOn: 'bg-lime-50 dark:bg-lime-500/15', textOn: 'text-lime-700 dark:text-lime-300',
    chip: 'bg-lime-600 text-white shadow-sm shadow-lime-600/30 hover:bg-lime-700',
  },
  {
    name: 'Công', icon: Clock, hint: 'Chấm công, bảng công và mọi loại đơn',
    iconIdle: 'bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400', iconOn: 'bg-amber-500 text-white shadow-sm shadow-amber-500/30',
    tileOn: 'bg-amber-50 dark:bg-amber-500/15', textOn: 'text-amber-700 dark:text-amber-300',
    chip: 'bg-amber-500 text-white shadow-sm shadow-amber-500/30 hover:bg-amber-600',
  },
  {
    name: 'Lương', icon: Wallet, hint: 'Bảng lương, cơ chế và tham số',
    iconIdle: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400', iconOn: 'bg-emerald-600 text-white shadow-sm shadow-emerald-600/30',
    tileOn: 'bg-emerald-50 dark:bg-emerald-500/15', textOn: 'text-emerald-700 dark:text-emerald-300',
    chip: 'bg-emerald-600 text-white shadow-sm shadow-emerald-600/30 hover:bg-emerald-700',
  },
  {
    // Fuchsia chu khong phai rose: mau chinh cua he thong gio la do thuong
    // hieu Huy Phong, ma rose chinh la do nhat - o KPI se trong y het o
    // "Tong quan" va nguoi dung phai doc ten moi phan biet duoc.
    name: 'KPI', icon: Target, hint: 'Chấm điểm, bộ tiêu chí và cách quy ra lương',
    iconIdle: 'bg-fuchsia-50 text-fuchsia-600 dark:bg-fuchsia-500/15 dark:text-fuchsia-400', iconOn: 'bg-fuchsia-600 text-white shadow-sm shadow-fuchsia-600/30',
    tileOn: 'bg-fuchsia-50 dark:bg-fuchsia-500/15', textOn: 'text-fuchsia-700 dark:text-fuchsia-300',
    chip: 'bg-fuchsia-600 text-white shadow-sm shadow-fuchsia-600/30 hover:bg-fuchsia-700',
  },
  {
    name: 'Đào tạo', icon: BookOpen, hint: 'Khóa học và thư viện quy trình',
    iconIdle: 'bg-teal-50 text-teal-600 dark:bg-teal-500/15 dark:text-teal-400', iconOn: 'bg-teal-600 text-white shadow-sm shadow-teal-600/30',
    tileOn: 'bg-teal-50 dark:bg-teal-500/15', textOn: 'text-teal-700 dark:text-teal-300',
    chip: 'bg-teal-600 text-white shadow-sm shadow-teal-600/30 hover:bg-teal-700',
  },
  {
    name: 'Hệ thống', icon: Settings, hint: 'Cấu hình, nhật ký và tính năng',
    iconIdle: 'bg-slate-100 text-slate-600 dark:bg-slate-700/40 dark:text-slate-300', iconOn: 'bg-slate-700 text-white shadow-sm shadow-slate-700/30',
    tileOn: 'bg-slate-100 dark:bg-slate-700/40', textOn: 'text-slate-800 dark:text-slate-200',
    chip: 'bg-slate-700 text-white shadow-sm shadow-slate-700/30 hover:bg-slate-800',
  },
];
