import { type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Skeleton } from '@/components/ui/Skeleton';
import { hasAdminFunction, hasPermission, isFullAdmin, isTeamlead, type AdminFunctionCode, type AdminPermission } from '@/lib/permissions';

interface ProtectedRouteProps {
  children: ReactNode;
  /**
   * Quyền cần có để vào trang. Admin/CEO luôn thỏa; nhân viên phải được cấp
   * quyền tương ứng trong trang Quản lý User.
   */
  permission?: AdminPermission;
  /** Chỉ cần có một trong các quyền — dùng cho quy trình liên phòng ban. */
  anyPermission?: AdminPermission[];
  /** Trang dữ liệu nhạy cảm chỉ dành cho Admin/CEO, kể cả khi có quyền lẻ. */
  fullAdminOnly?: boolean;
  /** Chức năng nhạy cảm được cấp riêng cho vai trò/vị trí. */
  functionCode?: AdminFunctionCode;
  /** Loại trừ vai trò trưởng nhóm khỏi màn hình tổng hợp toàn công ty. */
  denyTeamlead?: boolean;
  /** Cho phép trưởng nhóm vào đúng không gian hồ sơ nhân viên được giới hạn. */
  teamleadEmployeeDocuments?: boolean;
  /**
   * Đánh dấu route chính là trang đổi mật khẩu, để không tự chuyển hướng về
   * chính nó khi tài khoản đang bị ép đổi mật khẩu tạm.
   */
  allowPasswordChange?: boolean;
}

export function ProtectedRoute({
  children,
  permission,
  anyPermission,
  fullAdminOnly = false,
  functionCode,
  denyTeamlead = false,
  teamleadEmployeeDocuments = false,
  allowPasswordChange = false,
}: ProtectedRouteProps) {
  const { profile, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="space-y-4 w-64">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      </div>
    );
  }

  if (!profile) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // Tài khoản đang dùng mật khẩu tạm do admin cấp — chặn mọi trang khác.
  if (profile.must_change_password && !allowPasswordChange) {
    return <Navigate to="/change-password" replace />;
  }

  const teamleadDocumentAccess = teamleadEmployeeDocuments && isTeamlead(profile);

  if (permission && !hasPermission(profile, permission) && !teamleadDocumentAccess) {
    return <Navigate to="/staff/dashboard" replace />;
  }

  if (anyPermission?.length && !anyPermission.some((item) => hasPermission(profile, item))) {
    return <Navigate to="/staff/dashboard" replace />;
  }

  if (fullAdminOnly && !isFullAdmin(profile)) {
    return <Navigate to="/admin" replace />;
  }

  if (functionCode && !hasAdminFunction(profile, functionCode) && !teamleadDocumentAccess) {
    return <Navigate to="/admin" replace />;
  }

  if (denyTeamlead && isTeamlead(profile)) {
    return <Navigate to="/admin" replace />;
  }

  return <>{children}</>;
}
