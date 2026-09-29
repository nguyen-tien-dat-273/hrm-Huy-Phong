import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Suspense, useEffect, type ReactNode } from 'react';
import { clearChunkReloadMarks, lazyRoute } from '@/lib/lazyRoute';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import { ToastProvider } from '@/contexts/ToastContext';
import { ConfirmProvider } from '@/contexts/ConfirmContext';
import { ViewModeProvider } from '@/contexts/ViewModeContext';
import { SettingsProvider } from '@/contexts/SettingsContext';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { CommandPalette } from '@/components/CommandPalette';
import { InstallPrompt } from '@/components/InstallPrompt';
import { hasAdminFunction, hasAnyAdminPermission, hasPermission, type AdminFunctionCode, type AdminPermission } from '@/lib/permissions';
import { AdminLayout } from '@/components/layouts/AdminLayout';
import { StaffLayout } from '@/components/layouts/StaffLayout';
import { ADMIN_NAV_ITEMS } from '@/config/navigation';

// Mỗi module được tải khi người dùng thực sự mở tới. Việc này giữ lần tải đầu
// nhẹ dù hệ thống tiếp tục mở rộng thêm nghiệp vụ và vai trò.
const LoginPage = lazyRoute('LoginPage', () => import('@/pages/auth/LoginPage').then((m) => ({ default: m.LoginPage })));
const ChangePasswordPage = lazyRoute('ChangePasswordPage', () => import('@/pages/auth/ChangePasswordPage').then((m) => ({ default: m.ChangePasswordPage })));
const SetupPage = lazyRoute('SetupPage', () => import('@/pages/auth/SetupPage').then((m) => ({ default: m.SetupPage })));
const AdminOverview = lazyRoute('AdminOverview', () => import('@/pages/admin/AdminOverview').then((m) => ({ default: m.AdminOverview })));
const AdminUsers = lazyRoute('AdminUsers', () => import('@/pages/admin/AdminUsers').then((m) => ({ default: m.AdminUsers })));
const AdminOrganization = lazyRoute('AdminOrganization', () => import('@/pages/admin/AdminOrganization').then((m) => ({ default: m.AdminOrganization })));
const AdminProjects = lazyRoute('AdminProjects', () => import('@/pages/admin/AdminProjects').then((m) => ({ default: m.AdminProjects })));
const AdminProjectDetail = lazyRoute('AdminProjectDetail', () => import('@/pages/admin/AdminProjectDetail').then((m) => ({ default: m.AdminProjectDetail })));
const AdminReports = lazyRoute('AdminReports', () => import('@/pages/admin/AdminReports').then((m) => ({ default: m.AdminReports })));
const AdminAttendance = lazyRoute('AdminAttendance', () => import('@/pages/admin/AdminAttendance').then((m) => ({ default: m.AdminAttendance })));
const AdminAttendanceDevices = lazyRoute('AdminAttendanceDevices', () => import('@/pages/admin/AdminAttendanceDevices').then((m) => ({ default: m.AdminAttendanceDevices })));
const AdminTimesheet = lazyRoute('AdminTimesheet', () => import('@/pages/admin/AdminTimesheet').then((m) => ({ default: m.AdminTimesheet })));
const AdminPayroll = lazyRoute('AdminPayroll', () => import('@/pages/admin/AdminPayroll').then((m) => ({ default: m.AdminPayroll })));
const AdminAssignments = lazyRoute('AdminAssignments', () => import('@/pages/admin/AdminAssignments').then((m) => ({ default: m.AdminAssignments })));
const AdminWorklog = lazyRoute('AdminWorklog', () => import('@/pages/admin/AdminWorklog').then((m) => ({ default: m.AdminWorklog })));
const AdminLeave = lazyRoute('AdminLeave', () => import('@/pages/admin/AdminLeave').then((m) => ({ default: m.AdminLeave })));
const AdminSettings = lazyRoute('AdminSettings', () => import('@/pages/admin/AdminSettings').then((m) => ({ default: m.AdminSettings })));
const AdminAttendanceSettings = lazyRoute('AdminAttendanceSettings', () => import('@/pages/admin/AdminAttendanceSettings').then((m) => ({ default: m.AdminAttendanceSettings })));
const AdminAudit = lazyRoute('AdminAudit', () => import('@/pages/admin/AdminAudit').then((m) => ({ default: m.AdminAudit })));
const AdminProcessLibrary = lazyRoute('AdminProcessLibrary', () => import('@/pages/admin/AdminProcessLibrary').then((m) => ({ default: m.AdminProcessLibrary })));
const AdminTraining = lazyRoute('AdminTraining', () => import('@/pages/admin/AdminTraining').then((m) => ({ default: m.AdminTraining })));
const AdminRecruitment = lazyRoute('AdminRecruitment', () => import('@/pages/admin/AdminRecruitment').then((m) => ({ default: m.AdminRecruitment })));
const AdminWorkforceCenter = lazyRoute('AdminWorkforceCenter', () => import('@/pages/admin/AdminWorkforceCenter').then((m) => ({ default: m.AdminWorkforceCenter })));
const AdminNexusCenter = lazyRoute('AdminNexusCenter', () => import('@/pages/admin/AdminNexusCenter').then((m) => ({ default: m.AdminNexusCenter })));
const ProfilePage = lazyRoute('ProfilePage', () => import('@/pages/ProfilePage').then((m) => ({ default: m.ProfilePage })));
const StaffDashboard = lazyRoute('StaffDashboard', () => import('@/pages/staff/StaffDashboard').then((m) => ({ default: m.StaffDashboard })));
const StaffProjects = lazyRoute('StaffProjects', () => import('@/pages/staff/StaffProjects').then((m) => ({ default: m.StaffProjects })));
const StaffKanban = lazyRoute('StaffKanban', () => import('@/pages/staff/StaffKanban').then((m) => ({ default: m.StaffKanban })));
const StaffAttendance = lazyRoute('StaffAttendance', () => import('@/pages/staff/StaffAttendance').then((m) => ({ default: m.StaffAttendance })));
const StaffWorklog = lazyRoute('StaffWorklog', () => import('@/pages/staff/StaffWorklog').then((m) => ({ default: m.StaffWorklog })));
const StaffLeave = lazyRoute('StaffLeave', () => import('@/pages/staff/StaffLeave').then((m) => ({ default: m.StaffLeave })));
const StaffReports = lazyRoute('StaffReports', () => import('@/pages/staff/StaffReports').then((m) => ({ default: m.StaffReports })));
const StaffPayroll = lazyRoute('StaffPayroll', () => import('@/pages/staff/StaffPayroll').then((m) => ({ default: m.StaffPayroll })));
const StaffTraining = lazyRoute('StaffTraining', () => import('@/pages/staff/StaffTraining').then((m) => ({ default: m.StaffTraining })));
const StaffGrowth = lazyRoute('StaffGrowth', () => import('@/pages/staff/StaffGrowth').then((m) => ({ default: m.StaffGrowth })));

function AppLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-ambient px-6" role="status" aria-live="polite">
      <div className="flex flex-col items-center gap-4 text-center">
        <span className="h-10 w-10 animate-spin rounded-full border-[3px] border-indigo-100 border-t-indigo-600" />
        <div>
          <p className="font-display text-sm font-bold text-slate-800">Đang mở không gian làm việc</p>
          <p className="mt-1 text-xs text-slate-500">HRM Huy Phong đang chuẩn bị dữ liệu cho bạn…</p>
        </div>
      </div>
    </div>
  );
}

function AuthRedirect() {
  const { profile, loading, supabaseConfigured } = useAuth();
  const location = useLocation();

  if (loading) return null;
  if (!supabaseConfigured) return <SetupPage />;
  if (!profile) return <LoginPage />;
  if (profile.must_change_password) return <Navigate to="/change-password" replace />;

  if (location.pathname === '/' || location.pathname === '/login') {
    if (profile.role === 'admin' || profile.role === 'ceo') {
      return <Navigate to="/admin/overview" replace />;
    }
    // Trưởng nhóm vào thẳng khu quản lý nhóm — công việc chính của họ là giao
    // việc và duyệt. Họ vẫn tự chấm công/xin nghỉ ở khu nhân viên khi cần.
    if (profile.role === 'teamlead') {
      return <Navigate to="/admin/assignments" replace />;
    }
    // Vai trò nghiệp vụ tùy chỉnh có thể chỉ được cấp một vài module quản trị;
    // để AdminHomeRedirect chọn đúng module đầu tiên thay vì rơi nhầm vào khu
    // nhân viên chỉ vì cột role kỹ thuật vẫn là staff.
    if (hasAnyAdminPermission(profile)) {
      return <Navigate to="/admin" replace />;
    }
    return <Navigate to="/staff/dashboard" replace />;
  }

  return null;
}

function PublicRoute({ children }: { children: ReactNode }) {
  const { profile, loading } = useAuth();

  if (loading) return null;
  if (profile) {
    if (profile.must_change_password) return <Navigate to="/change-password" replace />;
    if (profile.role === 'staff' && !hasAnyAdminPermission(profile)) return <Navigate to="/staff/dashboard" replace />;
    if (profile.role === 'teamlead') return <Navigate to="/admin/assignments" replace />;
    return <Navigate to="/admin/overview" replace />;
  }

  return <>{children}</>;
}

/** Trang khu quản trị, mở theo từng quyền lẻ (admin/CEO luôn thỏa). */
function admin(
  permission: AdminPermission,
  page: ReactNode,
  options: { fullAdminOnly?: boolean; functionCode?: AdminFunctionCode; denyTeamlead?: boolean } = {},
) {
  return <ProtectedRoute permission={permission} {...options}><AdminLayout>{page}</AdminLayout></ProtectedRoute>;
}

/** Quy trình liên phòng ban: trưởng bộ phận hoặc HR đều có thể tham gia. */
function adminAny(permissions: AdminPermission[], page: ReactNode) {
  return <ProtectedRoute anyPermission={permissions}><AdminLayout>{page}</AdminLayout></ProtectedRoute>;
}

function staff(page: ReactNode) {
  return <ProtectedRoute><StaffLayout>{page}</StaffLayout></ProtectedRoute>;
}

/**
 * Trang ai cũng vào được, nhưng phải nằm trong đúng layout của vai trò —
 * quản trị viên mở Hồ sơ cá nhân mà rơi vào giao diện nhân viên thì mất hết
 * thanh điều hướng đang dùng.
 */
function OwnLayout({ children }: { children: ReactNode }) {
  const { profile } = useAuth();
  const Layout = hasAnyAdminPermission(profile) ? AdminLayout : StaffLayout;
  return <Layout>{children}</Layout>;
}

/** Vào /admin thì đẩy tới trang đầu tiên mà người dùng có quyền. */
function AdminHomeRedirect() {
  const { profile } = useAuth();
  // Admin/CEO: Tổng quan điều hành (chỉ họ mới xem được toàn danh mục).
  if (profile?.role === 'admin' || profile?.role === 'ceo') return <Navigate to="/admin/overview" replace />;
  // Trưởng nhóm: mục chính là Giao việc.
  if (profile?.role === 'teamlead') return <Navigate to="/admin/assignments" replace />;
  const target = ADMIN_NAV_ITEMS.find(({ permission, fullAdminOnly, functionCode }) =>
    !fullAdminOnly && hasPermission(profile, permission) && (!functionCode || hasAdminFunction(profile, functionCode)),
  );
  return <Navigate to={target ? target.to : '/staff/dashboard'} replace />;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<AuthRedirect />} />
      <Route path="/login" element={<PublicRoute><LoginPage /></PublicRoute>} />
      <Route path="/setup" element={<SetupPage />} />
      <Route path="/change-password" element={<ProtectedRoute allowPasswordChange><ChangePasswordPage /></ProtectedRoute>} />

      {/* Admin routes — mỗi trang gắn với một quyền lẻ */}
      <Route path="/admin" element={<AdminHomeRedirect />} />
      {/* Tổng quan điều hành — quyền reports + chức năng nâng cao tương ứng. */}
      <Route path="/admin/overview" element={admin('reports', <AdminOverview />, { functionCode: 'admin.overview' })} />
      {/* Gộp vào Tổng quan điều hành. Giữ chuyển hướng để link cũ và
          bookmark của người dùng không chết. */}
      <Route path="/admin/dashboard" element={<Navigate to="/admin" replace />} />
      <Route path="/admin/users" element={admin('users', <AdminUsers />)} />
      <Route path="/admin/organization" element={admin('users', <AdminOrganization />)} />
      <Route path="/admin/projects" element={admin('projects', <AdminProjects />)} />
      <Route path="/admin/projects/:id" element={admin('projects', <AdminProjectDetail />)} />
      <Route path="/admin/reports" element={admin('reports', <AdminReports />)} />
      <Route path="/admin/assignments" element={admin('attendance', <AdminAssignments />)} />
      <Route path="/admin/attendance-devices" element={admin('attendance', <AdminAttendanceDevices />, { fullAdminOnly: true })} />
      <Route path="/admin/timesheet" element={admin('attendance', <AdminTimesheet />, { denyTeamlead: true })} />
      <Route path="/admin/attendance-settings" element={admin('attendance', <AdminAttendanceSettings />, { denyTeamlead: true })} />
      {/* Lương gắn route theo quyền attendance nhưng TRANG tự chặn thêm bằng
          isFullAdmin — lead có quyền chấm công vào chỉ thấy thông báo khóa.
          RLS phía database mới là hàng rào thật. */}
      <Route path="/admin/payroll" element={admin('attendance', <AdminPayroll section="register" />, { functionCode: 'admin.payroll' })} />
      <Route path="/admin/payroll/schemes" element={admin('attendance', <AdminPayroll section="schemes" />, { functionCode: 'admin.payroll_schemes' })} />
      <Route path="/admin/payroll/inputs" element={admin('attendance', <AdminPayroll section="inputs" />, { functionCode: 'admin.payroll_inputs' })} />
      <Route path="/admin/payroll/adjustments" element={admin('attendance', <AdminPayroll section="adjustments" />, { functionCode: 'admin.payroll_adjustments' })} />
      <Route path="/admin/payroll/components" element={admin('attendance', <AdminPayroll section="catalog" />, { functionCode: 'admin.payroll_components' })} />
      <Route path="/admin/payroll/params" element={admin('attendance', <AdminPayroll section="params" />, { functionCode: 'admin.payroll_settings' })} />
      <Route path="/admin/leave" element={admin('leave', <AdminLeave />)} />
      <Route path="/admin/training" element={admin('training', <AdminTraining />)} />
      <Route path="/admin/process-library" element={admin('training', <AdminProcessLibrary />)} />
      <Route path="/admin/recruitment" element={adminAny(['users', 'projects'], <AdminRecruitment />)} />
      <Route path="/admin/workforce" element={admin('users', <AdminWorkforceCenter section="workers" />, { functionCode: 'admin.workforce' })} />
      <Route path="/admin/worker-documents" element={admin('users', <AdminWorkforceCenter section="documents" />, { functionCode: 'admin.worker_documents' })} />
      <Route path="/admin/employee-lifecycle" element={admin('users', <AdminNexusCenter section="lifecycle" />, { functionCode: 'admin.employee_lifecycle' })} />
      <Route path="/admin/performance" element={admin('reports', <AdminNexusCenter section="performance" />, { functionCode: 'admin.performance_manage' })} />
      {/* Trang cờ tính năng đã gỡ: không mã nào đọc `feature_flags` để
          bật/tắt chức năng, nên nó chỉ là công tắc không nối vào đâu. */}
      <Route path="/admin/feature-flags" element={<Navigate to="/admin/settings" replace />} />
      <Route path="/admin/worklog" element={admin('reports', <AdminWorklog />)} />
      <Route path="/admin/settings" element={admin('settings', <AdminSettings />)} />
      {/* Nhật ký hệ thống — quyền module + chức năng nâng cao; RLS là hàng rào cuối. */}
      <Route path="/admin/audit" element={admin('settings', <AdminAudit />, { functionCode: 'admin.audit' })} />

      {/* Hồ sơ cá nhân — ai đăng nhập cũng có, layout theo vai trò */}
      <Route path="/profile" element={<ProtectedRoute><OwnLayout><ProfilePage /></OwnLayout></ProtectedRoute>} />

      {/* Staff routes */}
      <Route path="/staff/dashboard" element={staff(<StaffDashboard />)} />
      <Route path="/staff/projects" element={staff(<StaffProjects />)} />
      <Route path="/staff/kanban" element={staff(<StaffKanban />)} />
      <Route path="/staff/attendance" element={staff(<StaffAttendance />)} />
      <Route path="/staff/leave" element={staff(<StaffLeave />)} />
      <Route path="/staff/worklog" element={staff(<StaffWorklog />)} />
      <Route path="/staff/reports" element={staff(<StaffReports />)} />
      <Route path="/staff/payroll" element={staff(<StaffPayroll />)} />
      <Route path="/staff/training" element={staff(<StaffTraining />)} />
      <Route path="/staff/growth" element={staff(<StaffGrowth />)} />

      {/* Fallback */}
      <Route path="*" element={<AuthRedirect />} />
    </Routes>
  );
}

export default function App() {
  // App dung duoc nghia la ban build hien tai da tai tron ven. Xoa dau vet
  // "da thu tai lai vi chunk hong" de lan deploy sau co che phuc hoi con dung
  // duoc, thay vi chi cuu duoc mot lan moi phien.
  useEffect(() => { clearChunkReloadMarks(); }, []);

  return (
    <BrowserRouter>
      <ToastProvider>
        <ConfirmProvider>
          <AuthProvider>
            {/* Trong AuthProvider: RLS đòi đăng nhập mới đọc được app_settings. */}
            <SettingsProvider>
              <ViewModeProvider>
                <Suspense fallback={<AppLoading />}>
                  <AppRoutes />
                </Suspense>
                {/* Ctrl/⌘+K — tự ẩn khi chưa đăng nhập. */}
                <CommandPalette />
                {/* Dải mời cài app — chỉ hiện khi trình duyệt thực sự cài được. */}
                <InstallPrompt />
              </ViewModeProvider>
            </SettingsProvider>
          </AuthProvider>
        </ConfirmProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}
