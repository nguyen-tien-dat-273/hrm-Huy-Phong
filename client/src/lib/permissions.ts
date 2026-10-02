// ============================================================================
// Quyền lẻ cấp cho nhân viên.
// ----------------------------------------------------------------------------
// Admin/CEO ngầm định có tất cả quyền. Nhân viên được cấp từng quyền rời trong
// trang Quản lý User, cho phép họ dùng một phần khu quản trị mà không phải nâng
// lên admin toàn quyền.
//
// Danh sách này phải khớp với CHECK constraint `profiles_permissions_valid`
// và hàm `can()` trong migration 20260809100000_granular_permissions.sql.
// ============================================================================

import type { Profile } from '@/types';

export const ADMIN_PERMISSIONS = ['users', 'projects', 'reports', 'attendance', 'leave', 'training', 'settings'] as const;

export type AdminPermission = (typeof ADMIN_PERMISSIONS)[number];

/** Quyền chức năng nhạy cảm có thể cấp riêng cho vai trò/vị trí. */
export const ADMIN_FUNCTION_CODES = [
  'admin.overview', 'admin.employee_lifecycle', 'admin.workforce', 'admin.worker_documents',
  'admin.payroll', 'admin.payroll_schemes', 'admin.payroll_inputs',
  'admin.payroll_components', 'admin.payroll_settings', 'admin.payroll_adjustments',
  'admin.timesheet_lock', 'admin.performance_manage', 'admin.feature_flags', 'admin.audit',
] as const;
export type AdminFunctionCode = (typeof ADMIN_FUNCTION_CODES)[number];

export const ADMIN_FUNCTIONS: Record<AdminFunctionCode, { label: string; description: string; module: AdminPermission }> = {
  'admin.overview': { label: 'Tổng quan điều hành', description: 'Xem dashboard điều hành và cảnh báo toàn công ty.', module: 'reports' },
  'admin.employee_lifecycle': { label: 'Hội nhập & nghỉ việc', description: 'Quản lý checklist onboarding/offboarding.', module: 'users' },
  'admin.workforce': { label: 'Hồ sơ người lao động', description: 'Quản lý hồ sơ và tiến trình tuyển chọn.', module: 'users' },
  'admin.worker_documents': { label: 'Hồ sơ giấy tờ lao động', description: 'Theo dõi hợp đồng, visa và tài liệu.', module: 'users' },
  'admin.payroll': { label: 'Bảng lương', description: 'Tính, duyệt và khóa bảng lương; xem phiếu lương từng người.', module: 'attendance' },
  'admin.payroll_schemes': { label: 'Cơ chế lương', description: 'Đặt cách tính lương và các khoản riêng của từng nhân sự.', module: 'attendance' },
  'admin.payroll_inputs': { label: 'Số liệu lương tháng', description: 'Nhập giờ tăng ca, sản lượng, doanh số cho kỳ lương.', module: 'attendance' },
  'admin.payroll_components': { label: 'Danh mục khoản lương', description: 'Định nghĩa các khoản cộng, trừ và công thức tính.', module: 'attendance' },
  'admin.payroll_settings': { label: 'Tham số lương', description: 'Ngày công chuẩn, tỷ lệ bảo hiểm và giảm trừ thuế.', module: 'attendance' },
  'admin.payroll_adjustments': { label: 'Điều chỉnh lương', description: 'Truy lĩnh, truy thu cho sai sót của kỳ đã khóa.', module: 'attendance' },
  'admin.timesheet_lock': { label: 'Khóa/mở kỳ bảng công', description: 'Mở kỳ duyệt, khóa kỳ và chốt dữ liệu bảng công.', module: 'attendance' },
  'admin.performance_manage': { label: 'Quản lý KPI & đánh giá', description: 'Tạo chu kỳ, mục tiêu và kết quả hiệu suất.', module: 'reports' },
  'admin.feature_flags': { label: 'Tính năng thử nghiệm', description: 'Bật/tắt có kiểm soát các chức năng mới.', module: 'settings' },
  'admin.audit': { label: 'Nhật ký hệ thống', description: 'Truy vết thao tác quản trị và thay đổi dữ liệu.', module: 'settings' },
};

export const PERMISSION_LABELS: Record<AdminPermission, { label: string; desc: string }> = {
  users:      { label: 'Quản lý User',    desc: 'Thêm, sửa, xóa tài khoản và cấp mật khẩu tạm' },
  projects:   { label: 'Quản lý Dự án',   desc: 'Tạo/sửa/xóa dự án, tác vụ và thành viên' },
  reports:    { label: 'Báo cáo',         desc: 'Xem báo cáo tổng hợp toàn công ty' },
  attendance: { label: 'Chấm công',       desc: 'Quản lý máy chấm công, bảng công và giờ làm chuẩn' },
  leave:      { label: 'Nghỉ phép',         desc: 'Xem và duyệt nghỉ phép, hủy phép và quản lý quỹ phép năm' },
  training:   { label: 'Đào tạo',         desc: 'Quản lý khóa học và tiến độ đào tạo nhân viên' },
  settings:   { label: 'Cấu hình',        desc: 'Thay đổi cấu hình hệ thống' },
};

/**
 * Phạm vi chức năng thực tế của từng quyền module.
 *
 * Quyền lưu trong database vẫn là quyền module để giữ tương thích với các
 * policy/RLS hiện hữu. Bảng này giúp màn hình gán quyền minh bạch: người dùng
 * thấy chính xác quyền đó bao phủ những màn hình/nghiệp vụ nào, thay vì chỉ
 * nhìn 8 checkbox tên chung chung.
 */
export const PERMISSION_FUNCTIONS: Record<AdminPermission, { label: string; adminOnly?: boolean; functionCode?: AdminFunctionCode }[]> = {
  users: [
    { label: 'Cơ cấu tổ chức, vị trí và tuyến quản lý' },
    { label: 'Hồ sơ & tài khoản nhân sự' },
    { label: 'Tuyển dụng nội bộ' },
    { label: 'Hội nhập & nghỉ việc', functionCode: 'admin.employee_lifecycle' },
    { label: 'Hồ sơ người lao động', functionCode: 'admin.workforce' },
    { label: 'Hồ sơ giấy tờ lao động', functionCode: 'admin.worker_documents' },
  ],
  projects: [
    { label: 'Dự án, thành viên và mốc công việc' },
    { label: 'Chi tiết dự án, tác vụ, tài liệu và quyền thành viên' },
    { label: 'Tuyển dụng nội bộ (phối hợp dự án)' },
  ],
  reports: [
    { label: 'Tổng quan điều hành', functionCode: 'admin.overview' },
    { label: 'Dashboard nhân sự' },
    { label: 'Báo cáo & phân tích' },
    { label: 'Nhật ký giờ và đối chiếu thời gian' },
    { label: 'KPI & đánh giá hiệu suất' },
  ],
  attendance: [
    { label: 'Giao việc hằng ngày' },
    { label: 'Máy chấm công Ronald Jack', adminOnly: true },
    { label: 'Bảng công tháng' },
    { label: 'Khóa/mở kỳ bảng công', functionCode: 'admin.timesheet_lock' },
    { label: 'Bảng lương', functionCode: 'admin.payroll' },
  ],
  leave: [{ label: 'Duyệt nghỉ phép, hủy phép và quản lý quỹ phép' }],
  training: [{ label: 'Đào tạo, khóa học và tiến độ' }],
  settings: [
    { label: 'Cấu hình hệ thống và vai trò', adminOnly: true },
    { label: 'Tính năng thử nghiệm', functionCode: 'admin.feature_flags' },
    { label: 'Nhật ký hệ thống', functionCode: 'admin.audit' },
  ],
};

/**
 * Các chức năng khu nhân viên được cấp mặc định cho mọi tài khoản đang hoạt
 * động. Chúng không phải quyền quản trị nên không xuất hiện trong 8 checkbox
 * module ở database; hiển thị danh sách này trong form giúp người dùng phân
 * biệt rõ “quyền quản trị được gán” và “chức năng cá nhân luôn có”.
 */
export const STAFF_FUNCTIONS = [
  'Trang chủ và lịch cá nhân',
  'Báo cáo cá nhân',
  'Dự án của tôi và tác vụ Kanban',
  'Nhật ký giờ cá nhân',
  'Chấm công từ máy và lịch sử vào/ra',
  'Đơn từ cá nhân: nghỉ phép, đi muộn, về sớm và làm thêm',
  'Lương của tôi và phiếu lương',
  'Đào tạo của tôi',
  'Lộ trình, KPI và mục tiêu cá nhân',
  'Hồ sơ cá nhân và đổi mật khẩu',
] as const;

/** Admin và CEO luôn có mọi quyền, không cần ghi vào `permissions`. */
export function isFullAdmin(profile: Profile | null | undefined): boolean {
  return profile?.role === 'admin' || profile?.role === 'ceo';
}

/** Trưởng nhóm dự án — quyền GIỚI HẠN theo dự án mình lead (xem RLS teamlead). */
export function isTeamlead(profile: Profile | null | undefined): boolean {
  return profile?.role === 'teamlead';
}

/**
 * Quyền teamlead NGẦM có, để vào đúng các trang vận hành nhóm. Khác quyền lẻ
 * của nhân viên ở chỗ: những trang này khi teamlead mở CHỈ hiện dữ liệu nhóm
 * họ lead — hàng rào thật là RLS ở database (migration 20260811230000), không
 * phải danh sách này. Cố tình KHÔNG có: users, reports, settings — teamlead
 * không đụng tới quản lý tài khoản, báo cáo toàn công ty, cấu hình, lương.
 */
export const TEAMLEAD_PERMISSIONS: readonly AdminPermission[] = ['projects', 'attendance', 'leave'];

export function hasPermission(profile: Profile | null | undefined, permission: AdminPermission): boolean {
  if (!profile || !profile.is_active) return false;
  if (isFullAdmin(profile)) return true;
  if (isTeamlead(profile)) return TEAMLEAD_PERMISSIONS.includes(permission);
  return profile.permissions?.includes(permission)
    || profile.access_role_permissions?.includes(permission)
    || profile.position_permissions?.includes(permission)
    || false;
}

/** Admin/CEO có tất cả; vai trò/vị trí khác chỉ có chức năng được cấp rõ ràng. */
export function hasAdminFunction(profile: Profile | null | undefined, functionCode: AdminFunctionCode): boolean {
  if (!profile || !profile.is_active) return false;
  if (isFullAdmin(profile)) return true;
  return profile.function_permissions?.includes(functionCode) ?? false;
}

/** Có vào được khu quản trị không (dù chỉ một quyền). */
export function hasAnyAdminPermission(profile: Profile | null | undefined): boolean {
  if (!profile) return false;
  if (isFullAdmin(profile)) return true;
  if (isTeamlead(profile)) return true;
  return (profile.permissions?.length ?? 0) > 0
    || (profile.access_role_permissions?.length ?? 0) > 0
    || (profile.position_permissions?.length ?? 0) > 0
    || (profile.function_permissions?.length ?? 0) > 0;
}

/** Một quyền đang có hiệu lực, kèm những nguồn đã cấp nó. */
export interface EffectivePermission {
  permission: AdminPermission;
  sources: PermissionSource[];
}

export type PermissionSource =
  | { kind: 'FULL_ADMIN' }
  | { kind: 'TEAMLEAD' }
  | { kind: 'DIRECT' }
  | { kind: 'ACCESS_ROLE' }
  | { kind: 'POSITION' };

/**
 * Giải thích vì sao một người có từng quyền.
 *
 * `hasPermission` gộp bốn nguồn bằng phép HOẶC, nên nhìn vào kết quả không
 * biết quyền đến từ đâu. Hệ quả thực tế: muốn GỠ một quyền phải lục cả bốn
 * chỗ, sót một chỗ là quyền vẫn còn mà người gỡ tưởng đã xong.
 *
 * Hàm này trả về đúng danh sách nguồn cho từng quyền, để màn hình chỉ thẳng
 * ra phải sửa ở đâu.
 */
export function explainPermissions(
  profile: Profile | null | undefined,
): EffectivePermission[] {
  if (!profile || !profile.is_active) return [];

  return ADMIN_PERMISSIONS.map((permission) => {
    const sources: PermissionSource[] = [];

    // Admin/CEO có mọi quyền không qua cấp phát — nêu riêng để người xem
    // không đi tìm một dòng cấu hình vốn không tồn tại.
    if (isFullAdmin(profile)) sources.push({ kind: 'FULL_ADMIN' });
    else {
      if (isTeamlead(profile) && TEAMLEAD_PERMISSIONS.includes(permission)) {
        sources.push({ kind: 'TEAMLEAD' });
      }
      if (profile.permissions?.includes(permission)) sources.push({ kind: 'DIRECT' });
      if (profile.access_role_permissions?.includes(permission)) sources.push({ kind: 'ACCESS_ROLE' });
      if (profile.position_permissions?.includes(permission)) sources.push({ kind: 'POSITION' });
    }

    return { permission, sources };
  }).filter((entry) => entry.sources.length > 0);
}

export function isValidPermission(value: string): value is AdminPermission {
  return (ADMIN_PERMISSIONS as readonly string[]).includes(value);
}
