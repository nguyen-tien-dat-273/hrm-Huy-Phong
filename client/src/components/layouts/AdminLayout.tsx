import { type ReactNode, useState, useEffect, useMemo, useRef } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Bell, Eye, ChevronDown, Building2, Menu, X,
  KeyRound, LogOut, Search, UserCircle, LayoutGrid,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useViewMode } from '@/contexts/ViewModeContext';
import { useRealtimeSync } from '@/hooks/useRealtimeSync';
import { Avatar } from '@/components/ui/Avatar';
import { supabase } from '@/lib/supabase';
import { hasAdminFunction, hasPermission, isFullAdmin, isTeamlead, type AdminPermission } from '@/lib/permissions';
import { useAppSettings } from '@/contexts/SettingsContext';
import type { Notification } from '@/types';
import { ADMIN_NAV_GROUPS, ADMIN_NAV_ITEMS } from '@/config/navigation';
import { notificationRoute } from '@/lib/notificationRoutes';
import { PageErrorBoundary } from '@/components/PageErrorBoundary';

/**
 * Menu đã vượt 12 mục — chia 3 cụm theo mạch công việc để quét mắt nhanh:
 * theo dõi hằng ngày → nghiệp vụ vận hành → quản trị tổ chức & lương.
 */
/**
 * Giữ người dùng trong cùng ngữ cảnh nghiệp vụ khi chuyển từ khu quản trị
 * sang góc nhìn nhân viên. Những màn hình không có bản tương ứng sẽ về
 * trang chủ nhân viên thay vì đoán một đích không liên quan.
 */
const staffPreviewRoutes: Array<[adminPath: string, staffPath: string]> = [
  ['/admin/assignments', '/staff/assignments'],
  ['/admin/projects', '/staff/projects'],
  ['/admin/worklog', '/staff/worklog'],
  ['/admin/attendance', '/staff/attendance'],
  ['/admin/timesheet', '/staff/attendance'],
  ['/admin/leave', '/staff/leave'],
  ['/admin/payroll', '/staff/payroll'],
  ['/admin/performance', '/staff/kpi'],
  ['/admin/training', '/staff/training'],
  ['/admin/process-library', '/staff/processes'],
  ['/admin/employee-lifecycle', '/staff/growth'],
  ['/admin/workforce', '/profile'],
  ['/admin/worker-documents', '/profile'],
  ['/admin/reports', '/staff/reports'],
];

const getStaffPreviewPath = (adminPath: string) =>
  staffPreviewRoutes.find(([path]) => adminPath.startsWith(path))?.[1]
  ?? '/staff/dashboard';

export function AdminLayout({ children }: { children: ReactNode }) {
  const { profile, signOut } = useAuth();
  const { setViewAs } = useViewMode();
  const { orgName } = useAppSettings();
  const navigate = useNavigate();
  const location = useLocation();
  const [avatarOpen, setAvatarOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  /** Số công việc nhân viên đã gửi, đang chờ xác nhận — hiện cạnh mục "Giao việc". */
  const [pendingAssignments, setPendingAssignments] = useState(0);
  const notifRef = useRef<HTMLDivElement>(null);
  const avatarRef = useRef<HTMLDivElement>(null);
  const launcherRef = useRef<HTMLDivElement>(null);

  const canReviewAssignments = hasPermission(profile, 'attendance');

  const loadNotifications = async () => {
    if (!profile) return;
    const { data } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', profile.id)
      .order('created_at', { ascending: false })
      .limit(10);
    if (data) setNotifications(data);
  };

  useEffect(() => { void loadNotifications(); }, [profile, location.pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  useRealtimeSync(
    profile ? [{ table: 'notifications', filter: `user_id=eq.${profile.id}` }] : [],
    loadNotifications,
    { enabled: !!profile, channelKey: `admin-notifications-${profile?.id ?? 'anonymous'}` },
  );

  const loadPendingAssignments = async () => {
    const { count } = await supabase
      .from('daily_assignments')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'submitted');
    setPendingAssignments(count ?? 0);
  };

  useEffect(() => {
    if (canReviewAssignments) loadPendingAssignments();
  }, [canReviewAssignments]);

  // Nhân viên bấm "Gửi duyệt" ở bất cứ đâu là con số trên sidebar nhảy ngay.
  // channelKey bắt buộc: trang Giao việc cũng nghe bảng này, trùng tên kênh
  // là supabase-js ném lỗi và trang trắng.
  useRealtimeSync(
    [{ table: 'daily_assignments' }],
    loadPendingAssignments,
    { enabled: canReviewAssignments, channelKey: 'layout-badge' },
  );

  // Close dropdowns on outside click
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setNotifOpen(false);
      if (avatarRef.current && !avatarRef.current.contains(e.target as Node)) setAvatarOpen(false);
      if (launcherRef.current && !launcherRef.current.contains(e.target as Node)) setLauncherOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const unreadCount = notifications.filter((n) => !n.is_read).length;
  const unreadNotifications = notifications.filter((n) => !n.is_read);

  // Chỉ hiện mục menu người dùng thực sự có quyền vào.
  const navItems = ADMIN_NAV_ITEMS.filter(
    (item) =>
      (item.anyPermissions
        ? item.anyPermissions.some((permission) => hasPermission(profile, permission))
        : hasPermission(profile, item.permission)) &&
      (!item.fullAdminOnly || isFullAdmin(profile)) &&
      (!item.functionCode || hasAdminFunction(profile, item.functionCode)) &&
      !(item.hideForTeamlead && isTeamlead(profile)),
  );

  /**
   * Cum dang mo o sidebar. `null` = dang o man danh sach cum.
   *
   * Khoi dong theo trang hien tai chu khong mo san cum dau: nguoi dung F5
   * hay mo link truc tiep phai thay minh dang dung trong cum nao, khong phai
   * tu bam lai tu dau.
   */
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  /** Bang luoi module o header. */
  const [launcherOpen, setLauncherOpen] = useState(false);

  const groupsWithItems = ADMIN_NAV_GROUPS
    .map((group) => ({ ...group, items: navItems.filter((item) => item.group === group.name) }))
    .filter((group) => group.items.length > 0);

  /**
   * Cum chua trang dang mo. Doi trang (ke ca tu tim nhanh hay mot link trong
   * noi dung) thi sidebar tu nhay theo, khong de nguoi dung dung o cum cu.
   *
   * Lay duong dan KHOP DAI NHAT chu khong phai cum dau tien khop: duong dan
   * cua muc nay co the la tien to cua muc kia. `/admin/payroll/kpi` khop ca
   * `/admin/payroll` (Bang luong, cum Luong & Dai ngo) lan chinh no (cum Phat
   * trien nhan su) - lay cai dau tien thi sidebar liet ke mot cum trong khi
   * dong dinh vi tren dau trang ghi mot cum khac.
   */
  const groupOfCurrentPath = groupsWithItems
    .flatMap((group) => group.items.map((item) => ({
      group: group.name,
      base: item.to.split(/[?#]/, 1)[0],
    })))
    .filter(({ base }) => location.pathname === base || location.pathname.startsWith(base + '/'))
    .sort((a, b) => b.base.length - a.base.length)[0]?.group ?? null;

  useEffect(() => {
    if (groupOfCurrentPath) setOpenGroup(groupOfCurrentPath);
  }, [groupOfCurrentPath]);

  const activeGroup = groupsWithItems.find((group) => group.name === openGroup) ?? null;

  /**
   * Bam mot module tren thanh ngang thi vao luon chuc nang DAU TIEN cua no.
   *
   * Chi doi thanh doc ma khong dieu huong se de nguoi dung o lai trang cu
   * trong khi thanh doc da liet ke mot module khac - hai thu tren man noi hai
   * chuyen khac nhau. Dang dung san trong module do thi khong dieu huong lai,
   * tranh keo ho ra khoi trang dang lam.
   */
  const openModule = (name: string) => {
    setOpenGroup(name);
    setSidebarOpen(false);
    setLauncherOpen(false);
    if (name === groupOfCurrentPath) return;
    const first = groupsWithItems.find((group) => group.name === name)?.items[0];
    if (first) navigate(first.to);
  };

  const handleSwitchToStaff = () => {
    // Ghi nhớ đúng màn hình quản trị đang làm để khi thoát chế độ xem thử,
    // người dùng quay lại đúng ngữ cảnh thay vì luôn bị đẩy về Dashboard.
    window.sessionStorage.setItem('hrm:admin-return-path', `${location.pathname}${location.search}`);
    setViewAs('staff');
    navigate(getStaffPreviewPath(location.pathname));
  };

  const handleSignOut = async () => {
    await signOut();
    navigate('/login');
  };

  const markAllRead = async () => {
    if (!profile) return;
    await supabase.from('notifications').update({ is_read: true }).eq('user_id', profile.id).eq('is_read', false);
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
  };

  const markNotificationRead = async (id: string) => {
    if (!profile) return;
    await supabase.from('notifications').update({ is_read: true }).eq('id', id).eq('user_id', profile.id);
    setNotifications((prev) => prev.map((n) => n.id === id ? { ...n, is_read: true } : n));
  };

  const openNotification = async (notification: Notification) => {
    await markNotificationRead(notification.id);
    setNotifOpen(false);
    navigate(notificationRoute(notification.type));
  };

  const currentPage = navItems
    .filter((item) => location.pathname.startsWith(item.to.split(/[?#]/, 1)[0]))
    .sort((a, b) => b.to.length - a.to.length)[0];

  /**
   * Mục nào là tổ tiên của mục khác thì phải so khớp CHÍNH XÁC.
   *
   * NavLink mặc định coi là đang mở khi đường dẫn bắt đầu bằng `to`, nên
   * "/admin/payroll" sáng lên cả khi đang ở "/admin/payroll/inputs" — hai mục
   * cùng nổi một lúc. Tính tự động thay vì liệt kê tay: thêm route con mới
   * sau này không phải nhớ quay lại sửa chỗ này.
   */
  const exactMatchPaths = useMemo(() => {
    const paths = navItems.map((item) => item.to.split(/[?#]/, 1)[0]);
    return new Set(paths.filter((path) => paths.some((other) => other.startsWith(`${path}/`))));
  }, [navItems]);

  return (
    <div className="app-shell min-h-screen bg-ambient flex">
      {/* Người dùng bàn phím không phải Tab qua toàn bộ sidebar mỗi lần đổi trang. */}
      <a href="#main-content" className="skip-link">Bỏ qua điều hướng</a>

      {/* Sidebar */}
      <aside className={`app-sidebar fixed md:sticky top-0 left-0 z-40 h-screen w-[18.5rem] border-r border-slate-200 bg-white text-slate-700 flex flex-col transition-transform duration-300 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}>
        <div className="min-h-20 flex items-center px-5 border-b border-slate-200">
          <div className="flex items-center gap-3">
            <img
              src="/logo-mark.png?v=3"
              alt=""
              aria-hidden="true"
              className="h-9 w-9 flex-shrink-0 object-contain"
            />
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-slate-900">{orgName || 'HRM Huy Phong'}</p>
              <p className="mt-0.5 text-[11px] text-slate-500">Hệ thống quản lý nhân sự</p>
            </div>
          </div>
          <button type="button" onClick={() => setSidebarOpen(false)} aria-label="Đóng menu điều hướng" className="ml-auto flex h-11 w-11 items-center justify-center rounded-xl text-slate-400 hover:bg-slate-100 hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 md:hidden">
            <X className="w-5 h-5" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4">
          {activeGroup ? (
            <div className="space-y-1">
              {/* Nhac lai dang dung trong module nao: thanh ngang o tren co the
                  bi cuon khuat, va man hinh hep thi no xuong dong. */}
              <div className="mb-3 flex items-center gap-3 border-b border-slate-200 px-3 pb-3">
                <span className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl ${activeGroup.iconOn}`}>
                  <activeGroup.icon className="h-5 w-5" />
                </span>
                <span className="min-w-0">
                  <span className="block text-[15px] font-bold leading-snug text-slate-900">{activeGroup.name}</span>
                  <span className="mt-0.5 block text-xs text-slate-500">
                    {activeGroup.items.length} chức năng
                  </span>
                </span>
              </div>

              {activeGroup.items.map((item) => {
                const Icon = item.icon;
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    onClick={() => setSidebarOpen(false)}
                    end={exactMatchPaths.has(item.to.split(/[?#]/, 1)[0])}
                    className={({ isActive }) =>
                      `group flex items-start gap-3 rounded-xl px-3 py-2.5 transition-colors duration-200 ${
                        isActive
                          ? 'bg-indigo-600 shadow-sm shadow-indigo-600/30'
                          : 'hover:bg-slate-100'
                      }`
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <Icon
                          className={`mt-0.5 h-5 w-5 flex-shrink-0 transition-transform duration-200 group-hover:scale-110 ${
                            isActive ? 'text-white' : 'text-indigo-500'
                          }`}
                        />
                        <span className="min-w-0 flex-1">
                          <span className={`block text-sm font-semibold leading-snug ${
                            isActive ? 'text-white' : 'text-slate-800'
                          }`}>
                            {item.label}
                          </span>
                          {/* Cau mo ta cua tung chuc nang: nhan khong noi
                              duoc "Co che luong" khac "Tham so luong" cho
                              nao, ma do la thu nguoi dung can biet truoc khi
                              bam chu khong phai sau. */}
                          <span className={`mt-0.5 block text-[11px] leading-snug ${
                            isActive ? 'text-indigo-100' : 'text-slate-500'
                          }`}>
                            {item.description}
                          </span>
                        </span>
                        {item.to === '/admin/assignments' && pendingAssignments > 0 && (
                          <span className={`mt-0.5 flex h-5 min-w-5 flex-shrink-0 items-center justify-center rounded-full px-1.5 text-[11px] font-bold ${
                            isActive ? 'bg-white/25 text-white' : 'bg-amber-500 text-white'
                          }`}>
                            {pendingAssignments}
                          </span>
                        )}
                      </>
                    )}
                  </NavLink>
                );
              })}
            </div>
          ) : (
            <p className="px-3 py-6 text-xs leading-relaxed text-slate-500">
              Chọn một module ở nút lưới trên đầu trang để xem các chức năng bên trong.
            </p>
          )}
        </nav>

        <div className="border-t border-slate-200 p-3">
          <div className="flex items-center gap-3 rounded-xl bg-slate-50 px-3 py-2">
            <Avatar name={profile?.name || ''} url={profile?.avatar_url} size="sm" />
            <div className="flex-1 min-w-0">
              <p className="truncate text-sm font-medium text-slate-900">{profile?.name}</p>
              <p className="text-xs capitalize text-slate-500">{profile?.role}</p>
            </div>
          </div>
        </div>
      </aside>

      {sidebarOpen && <div className="fixed inset-0 bg-slate-900/50 z-30 lg:hidden" onClick={() => setSidebarOpen(false)} />}

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header className="app-header min-h-[4.5rem] bg-white/80 border-b border-slate-200/80 flex items-center justify-between px-4 sm:px-6 lg:px-8 sticky top-0 z-20 backdrop-blur-xl">
          {/* `min-w-0 flex-1`: o flex mac dinh `min-width: auto` nen KHONG co
              nho hon noi dung. Khoi ben trong da co min-w-0 de cat chu, nhung
              cha khong co thi phep co khong bao gio truyen xuong - header
              phinh ra 751px trong khung 553px va day ca trang tran ngang. */}
          <div className="flex min-w-0 flex-1 items-center gap-4">
            <button type="button" onClick={() => setSidebarOpen(true)} aria-label="Mở menu điều hướng" className="flex h-11 w-11 items-center justify-center rounded-xl text-slate-600 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 md:hidden">
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex min-w-0 flex-col">
              <div className="flex items-center gap-2">
                {currentPage?.group && <span className="hidden sm:inline text-[10px] font-bold uppercase tracking-wider text-indigo-500">{currentPage.group}</span>}
                {currentPage?.group && <span className="hidden sm:inline text-slate-300">/</span>}
                <h1 className="font-display truncate text-base font-bold tracking-tight text-slate-900">{currentPage?.label || 'Khu quản trị'}</h1>
              </div>
              <p className="hidden max-w-[560px] truncate text-xs text-slate-600 sm:block">
                {currentPage?.description || (isTeamlead(profile) ? `Quản lý nhóm · ${orgName}` : `Quản trị hệ thống · ${orgName}`)}
              </p>
            </div>
          </div>

          <div className="flex flex-shrink-0 items-center gap-2">
            {/* ---- Bảng module ----
                 Cấp một của điều hướng. Thanh dọc bên trái chỉ liệt kê chức
                 năng CỦA module đang chọn, nên không còn phải in cả 30 mục
                 một lúc.

                 Để trong một bảng bật ra thay vì một dãy nút nằm ngang: chín
                 tên module tiếng Việt xếp ngang thì hoặc tràn ra ngoài, hoặc
                 phải cắt chữ — mà tên module là thứ duy nhất để nhận ra nó. */}
            <div className="relative" ref={launcherRef}>
              {/* Nut nay la duong vao DUY NHAT cua cap mot, nen no phai
                  trong ra la mot nut bam chu khong phai mot cai nhan: to
                  nguyen mau cua module dang mo. */}
              <button
                onClick={() => { setLauncherOpen(!launcherOpen); setNotifOpen(false); setAvatarOpen(false); }}
                className={`flex h-11 items-center gap-2 rounded-xl px-3 text-sm font-bold transition-colors ${
                  activeGroup
                    ? activeGroup.chip
                    : 'bg-slate-800 text-white hover:bg-slate-900'
                }`}
                aria-label="Mở bảng module"
                aria-expanded={launcherOpen}
              >
                <LayoutGrid className="h-4.5 w-4.5 flex-shrink-0" />
                <span className="hidden max-w-[11rem] truncate sm:inline">
                  {activeGroup?.name ?? 'Chọn module'}
                </span>
                <ChevronDown className={`h-4 w-4 flex-shrink-0 transition-transform ${launcherOpen ? 'rotate-180' : ''}`} />
              </button>

              {/* Tren dien thoai bang neo vao MAN HINH chu khong vao nut.
                  Nut nam gan giua header, ma bang rong gan het man - neo
                  `right-0` vao nut thi canh trai bang lot ra ngoai man hinh
                  va mat han mot cot o. */}
              {launcherOpen && (
                <div className="fixed inset-x-4 top-[4.5rem] z-50 rounded-2xl border border-slate-200 bg-white p-3 shadow-xl sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:w-[min(38rem,calc(100vw-2rem))]">
                  <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
                    {groupsWithItems.map((group) => {
                      const Icon = group.icon;
                      const isActive = group.name === openGroup;
                      const pending = group.items.some((item) => item.to === '/admin/assignments')
                        ? pendingAssignments : 0;
                      return (
                        <button
                          key={group.name}
                          type="button"
                          onClick={() => openModule(group.name)}
                          aria-current={isActive ? 'true' : undefined}
                          className={`relative flex flex-col items-center gap-2 rounded-xl px-2 py-3.5 text-center transition-colors ${
                            isActive ? group.tileOn : 'hover:bg-slate-50'
                          }`}
                        >
                          {/* Mau rieng tung module: 8 o cung mau xam thi phai
                              doc ten moi phan biet, con khac mau thi nho duoc
                              bang vi tri va mau sau vai lan dung. */}
                          <span className={`flex h-11 w-11 items-center justify-center rounded-xl transition-colors ${
                            isActive ? group.iconOn : group.iconIdle
                          }`}>
                            <Icon className="h-5 w-5" />
                          </span>
                          <span className={`text-xs font-semibold leading-tight ${
                            isActive ? group.textOn : 'text-slate-700'
                          }`}>
                            {group.name}
                          </span>
                          {pending > 0 && (
                            <span className="absolute right-2 top-2 flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-bold text-white">
                              {pending}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Gợi ý command palette — người dùng không tự đoán ra phím tắt nếu
                không được nhắc ở đâu đó. */}
            <button
              type="button"
              onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }))}
              className="hidden h-11 items-center gap-2 rounded-xl border border-slate-200 pl-3 pr-2 text-slate-400 transition-colors hover:border-slate-300 hover:text-slate-600 md:flex"
              aria-label="Mở tìm nhanh"
            >
              <Search className="w-4 h-4" />
              <span className="text-sm">Tìm nhanh</span>
              <kbd className="text-[11px] font-medium bg-slate-100 rounded-md px-1.5 py-0.5">Ctrl K</kbd>
            </button>

            {/* Notifications */}
            <div className="relative" ref={notifRef}>
              <button
                onClick={() => { setNotifOpen(!notifOpen); setAvatarOpen(false); setLauncherOpen(false); }}
                className="relative p-2.5 rounded-xl hover:bg-slate-100 transition-colors"
                aria-label={unreadCount > 0 ? `Mở thông báo, ${unreadCount} thông báo mới` : 'Mở thông báo'}
                aria-expanded={notifOpen}
              >
                <Bell className="w-5 h-5 text-slate-600" />
                {unreadCount > 0 && (
                  <span className="absolute top-1.5 right-1.5 w-4 h-4 bg-gradient-to-br from-red-500 to-rose-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center ring-2 ring-white">
                    {unreadCount}
                  </span>
                )}
              </button>
              {notifOpen && (
                <div className="absolute right-0 top-12 w-80 bg-white rounded-2xl shadow-lifted border border-slate-100 z-40 modal-in overflow-hidden">
                  <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between bg-gradient-to-r from-slate-50 to-white">
                    <span className="font-display font-semibold text-sm text-slate-800">Thông báo</span>
                    {unreadCount > 0 && (
                      <button onClick={markAllRead} className="text-xs font-medium text-indigo-600 hover:text-indigo-700">Đánh dấu đã đọc</button>
                    )}
                  </div>
                  <div className="max-h-80 overflow-y-auto">
                    {unreadNotifications.length === 0 ? (
                      <p className="text-sm text-slate-400 text-center py-10">Không có thông báo mới</p>
                    ) : (
                      unreadNotifications.map((n) => (
                        <button type="button" key={n.id} onClick={() => void openNotification(n)} className="block w-full px-4 py-3 border-b border-slate-50 text-left cursor-pointer hover:bg-slate-50 transition-colors bg-indigo-50/40">
                          <div className="flex items-center gap-2">
                            {!n.is_read && <span className="w-2 h-2 rounded-full bg-indigo-500 flex-shrink-0" />}
                            <p className="text-sm font-medium text-slate-800">{n.title}</p>
                          </div>
                          <p className="text-xs text-slate-500 mt-0.5 ml-4">{n.message}</p>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Avatar dropdown */}
            <div className="relative" ref={avatarRef}>
              <button
                onClick={() => { setAvatarOpen(!avatarOpen); setNotifOpen(false); setLauncherOpen(false); }}
                className="flex items-center gap-2 p-1.5 pr-2.5 rounded-xl hover:bg-slate-100 transition-colors"
                aria-label="Mở menu tài khoản"
                aria-expanded={avatarOpen}
              >
                <Avatar name={profile?.name || ''} url={profile?.avatar_url} size="sm" />
                <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${avatarOpen ? 'rotate-180' : ''}`} />
              </button>
              {avatarOpen && (
                <div className="absolute right-0 top-12 w-56 bg-white rounded-2xl shadow-lifted border border-slate-100 z-40 modal-in py-1.5 overflow-hidden">
                  <div className="px-4 py-3 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white">
                    <p className="text-sm font-semibold text-slate-800">{profile?.name}</p>
                    <p className="text-xs text-slate-500 truncate">{profile?.email}</p>
                  </div>
                  <button
                    onClick={() => { setAvatarOpen(false); navigate('/profile'); }}
                    className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors text-left"
                  >
                    <span className="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center"><UserCircle className="w-4 h-4 text-slate-600" /></span>
                    Hồ sơ cá nhân
                  </button>
                  <button
                    onClick={handleSwitchToStaff}
                    className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors text-left"
                  >
                    <span className="w-7 h-7 rounded-lg bg-indigo-50 flex items-center justify-center"><Eye className="w-4 h-4 text-indigo-600" /></span>
                    {isFullAdmin(profile) ? 'Xem với tư cách Nhân viên' : 'Về khu nhân viên'}
                  </button>
                  <button
                    onClick={() => { setAvatarOpen(false); navigate('/change-password'); }}
                    className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors text-left"
                  >
                    <span className="w-7 h-7 rounded-lg bg-violet-50 flex items-center justify-center"><KeyRound className="w-4 h-4 text-violet-600" /></span>
                    Đổi mật khẩu
                  </button>
                  <button
                    onClick={handleSignOut}
                    className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 transition-colors text-left"
                  >
                    <span className="w-7 h-7 rounded-lg bg-red-50 flex items-center justify-center"><LogOut className="w-4 h-4" /></span>
                    Đăng xuất
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Page content */}
        <main id="main-content" tabIndex={-1} className="page-content flex-1 p-4 sm:p-6 lg:p-8 xl:p-10 max-w-[1520px] w-full mx-auto page-fade-in">
          {/* Lưới an toàn: một trang ném lỗi thì chỉ trang đó hiện báo lỗi,
              thanh điều hướng và đầu trang vẫn còn để đi chỗ khác. Không có
              nó thì React gỡ cả cây và màn hình trắng trơn. */}
          <PageErrorBoundary>{children}</PageErrorBoundary>
        </main>
      </div>
    </div>
  );
}
