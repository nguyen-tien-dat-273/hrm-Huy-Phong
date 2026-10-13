// ============================================================================
// Mỗi quyền module mở ra những gì.
// ----------------------------------------------------------------------------
// Màn cấp quyền chỉ phải nói đúng một điều: bật ô này thì người kia vào thêm
// được những đâu. Trước đây danh sách đó viết tay trong `permissions.ts`, song
// song với `ADMIN_NAV_ITEMS` — thứ THẬT SỰ quyết định mục nào hiện trên menu
// và trang nào mở được (bộ lọc ở AdminLayout, chốt chặn ở ProtectedRoute).
//
// Hai bản viết tay cho cùng một sự thật thì sớm muộn cũng lệch, và đã lệch
// thật:
//
//   · Lương tách thành 7 mục con, danh sách kia không ai sửa theo — cấp quyền
//     `attendance` mà màn hình chỉ kể 5 việc, giấu mất cả khu lương.
//   · "KPI & đánh giá" thiếu dấu cần cấp riêng `admin.performance_manage`:
//     cấp xong quyền `reports`, màn hình hứa người ta xem được KPI, mở ra vẫn
//     không thấy gì.
//   · "Dashboard nhân sự" và "Tính năng thử nghiệm" đã gỡ khỏi hệ thống
//     (`/admin/dashboard`, `/admin/feature-flags` giờ chỉ còn chuyển hướng)
//     nhưng vẫn nằm đó rao món không còn bán.
//
// Nên suy thẳng từ `ADMIN_NAV_ITEMS`: thêm một mục menu là màn cấp quyền tự
// biết, không còn chỗ thứ hai để lệch.
// ============================================================================

import { ADMIN_NAV_ITEMS, type AdminNavItem } from '@/config/navigation';
import { ADMIN_PERMISSIONS, type AdminFunctionCode, type AdminPermission } from '@/lib/permissions';

export interface PermissionFunction {
  label: string;
  /** Có quyền module vẫn chưa đủ — phải là Admin/CEO. */
  adminOnly?: boolean;
  /** Có quyền module vẫn chưa đủ — phải được cấp riêng mã chức năng này. */
  functionCode?: AdminFunctionCode;
}

/**
 * Việc làm TRONG một trang nên không có mục menu riêng để suy ra.
 *
 * Giữ tay đúng ba mục này thôi, và mỗi mục phải chỉ được ra chỗ chặn thật —
 * danh sách tay càng dài thì càng sớm quay về đúng cái lệch vừa gỡ.
 */
const IN_PAGE_FUNCTIONS: Partial<Record<AdminPermission, PermissionFunction[]>> = {
  // Route /admin/projects/:id — mở từ trong danh sách dự án, không nằm ở menu.
  projects: [{ label: 'Chi tiết dự án, tác vụ, tài liệu và quyền thành viên' }],
  // Nút mở kỳ / khóa kỳ nằm trong trang Bảng công tháng (AdminTimesheet).
  attendance: [{ label: 'Khóa/mở kỳ bảng công', functionCode: 'admin.timesheet_lock' }],
  // Khu vai trò & phân quyền nằm trong Cấu hình hệ thống; ở đó
  // `canManageRoles = isFullAdmin(profile)`, quyền `settings` không đủ.
  settings: [{ label: 'Vai trò truy cập và phân quyền', adminOnly: true }],
};

/**
 * Một mục menu thuộc về quyền nào.
 *
 * Chép đúng bộ lọc đang chạy ở AdminLayout: có `anyPermissions` thì chính nó
 * quyết định và `permission` bị bỏ qua — nên Tuyển dụng nội bộ nằm ở cả hai
 * quyền `users` và `projects`, đúng như người có một trong hai đều vào được.
 */
const covers = (item: AdminNavItem, permission: AdminPermission) =>
  item.anyPermissions ? item.anyPermissions.includes(permission) : item.permission === permission;

/** Nhãn lấy nguyên từ menu, để người cấp quyền đối chiếu được với thứ người kia sắp nhìn thấy. */
const fromNavItem = (item: AdminNavItem): PermissionFunction => ({
  label: item.label,
  ...(item.fullAdminOnly ? { adminOnly: true as const } : {}),
  ...(item.functionCode ? { functionCode: item.functionCode } : {}),
});

export const PERMISSION_FUNCTIONS = Object.fromEntries(
  ADMIN_PERMISSIONS.map((permission) => [
    permission,
    [
      ...ADMIN_NAV_ITEMS.filter((item) => covers(item, permission)).map(fromNavItem),
      ...(IN_PAGE_FUNCTIONS[permission] ?? []),
    ],
  ]),
) as Record<AdminPermission, PermissionFunction[]>;
