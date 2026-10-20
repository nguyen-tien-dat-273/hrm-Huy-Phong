import { type ReactNode, useState, useEffect, useRef } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, KanbanSquare,
  Bell, ChevronDown, Menu, X, ArrowLeft, Eye, KeyRound, LogOut, ShieldCheck,
  UserCircle, BookOpen, Target, WalletCards, Clock, LayoutGrid, Moon, Sun,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useViewMode } from '@/contexts/ViewModeContext';
import { useTheme } from '@/contexts/ThemeContext';
import { Avatar } from '@/components/ui/Avatar';
import { supabase } from '@/lib/supabase';
import { hasAnyAdminPermission } from '@/lib/permissions';
import { useAppSettings } from '@/contexts/SettingsContext';
import { getGreeting } from '@/lib/utils';
import { useRealtimeSync } from '@/hooks/useRealtimeSync';
import { notificationRoute } from '@/lib/notificationRoutes';
import type { Notification } from '@/types';
import { STAFF_NAV_ITEMS } from '@/config/navigation';
import { PageErrorBoundary } from '@/components/PageErrorBoundary';

/**
 * Cum chuc nang cua khu nhan vien.
 *
 * Dung dung mot khuon voi khu quan tri: cap mot la cac cum, bam vao mot cum
 * thi thanh doc moi liet ke chuc nang ben trong. Hai khu dung hai kieu dieu
 * huong khac nhau se bat nguoi dung hoc lai tu dau moi lan doi che do xem,
 * trong khi admin xem thu khu nhan vien la chuyen hang ngay.
 *
 * Mau lay trung voi cum tuong duong ben khu quan tri, de doi che do xem
 * khong thay mau nhay lung tung.
 */
const navGroups: {
  name: string; icon: typeof LayoutDashboard; hint: string;
  iconIdle: string; iconOn: string; tileOn: string; textOn: string; chip: string;
}[] = [
  {
    name: 'Tổng quan', icon: LayoutDashboard, hint: 'Trang chủ và báo cáo cá nhân',
    iconIdle: 'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-400', iconOn: 'bg-indigo-600 text-white shadow-sm shadow-indigo-600/30',
    tileOn: 'bg-indigo-50 dark:bg-indigo-500/15', textOn: 'text-indigo-700 dark:text-indigo-300',
    chip: 'bg-indigo-600 text-white shadow-sm shadow-indigo-600/30 hover:bg-indigo-700',
  },
  {
    name: 'Công việc', icon: KanbanSquare, hint: 'Dự án, tác vụ và nhật ký giờ',
    iconIdle: 'bg-orange-50 text-orange-600 dark:bg-orange-500/15 dark:text-orange-400', iconOn: 'bg-orange-600 text-white shadow-sm shadow-orange-600/30',
    tileOn: 'bg-orange-50 dark:bg-orange-500/15', textOn: 'text-orange-700 dark:text-orange-300',
    chip: 'bg-orange-600 text-white shadow-sm shadow-orange-600/30 hover:bg-orange-700',
  },
  {
    name: 'Thời gian & Lịch', icon: Clock, hint: 'Chấm công và các loại đơn từ',
    iconIdle: 'bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400', iconOn: 'bg-amber-500 text-white shadow-sm shadow-amber-500/30',
    tileOn: 'bg-amber-50 dark:bg-amber-500/15', textOn: 'text-amber-700 dark:text-amber-300',
    chip: 'bg-amber-500 text-white shadow-sm shadow-amber-500/30 hover:bg-amber-600',
  },
  {
    name: 'Lương', icon: WalletCards, hint: 'Phiếu lương của bạn',
    iconIdle: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400', iconOn: 'bg-emerald-600 text-white shadow-sm shadow-emerald-600/30',
    tileOn: 'bg-emerald-50 dark:bg-emerald-500/15', textOn: 'text-emerald-700 dark:text-emerald-300',
    chip: 'bg-emerald-600 text-white shadow-sm shadow-emerald-600/30 hover:bg-emerald-700',
  },
  {
    // Fuchsia, trung voi cum KPI ben khu quan tri: mau chinh gio la do thuong
    // hieu nen rose (do nhat) se trong y het cum "Tong quan".
    name: 'KPI', icon: Target, hint: 'Kết quả chấm điểm của bạn',
    iconIdle: 'bg-fuchsia-50 text-fuchsia-600 dark:bg-fuchsia-500/15 dark:text-fuchsia-400', iconOn: 'bg-fuchsia-600 text-white shadow-sm shadow-fuchsia-600/30',
    tileOn: 'bg-fuchsia-50 dark:bg-fuchsia-500/15', textOn: 'text-fuchsia-700 dark:text-fuchsia-300',
    chip: 'bg-fuchsia-600 text-white shadow-sm shadow-fuchsia-600/30 hover:bg-fuchsia-700',
  },
  {
    // Teal, khong phai rose: KPI da tach ra thanh module rieng nen hai cum
    // phai nhin ra la hai thu khac nhau. Teal cung khop voi cum "Dao tao &
    // Quy trinh" ben khu quan tri.
    name: 'Phát triển', icon: BookOpen, hint: 'Đào tạo, quy trình và lộ trình',
    iconIdle: 'bg-teal-50 text-teal-600 dark:bg-teal-500/15 dark:text-teal-400', iconOn: 'bg-teal-600 text-white shadow-sm shadow-teal-600/30',
    tileOn: 'bg-teal-50 dark:bg-teal-500/15', textOn: 'text-teal-700 dark:text-teal-300',
    chip: 'bg-teal-600 text-white shadow-sm shadow-teal-600/30 hover:bg-teal-700',
  },
];

export function StaffLayout({ children }: { children: ReactNode }) {
  const { profile, signOut } = useAuth();
  const { setViewAs } = useViewMode();
  const { theme, toggleTheme } = useTheme();
  const { orgName } = useAppSettings();
  const navigate = useNavigate();
  const location = useLocation();
  const [avatarOpen, setAvatarOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const notifRef = useRef<HTMLDivElement>(null);
  const [bottomOpen, setBottomOpen] = useState(false);
  const bottomLauncherRef = useRef<HTMLDivElement>(null);
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const avatarRef = useRef<HTMLDivElement>(null);
  /** Bảng lưới module ở header desktop. Bấm vẫn mở/đóng được; rê chuột vào
   *  là tự xổ ra, không cần bấm. */
  const [launcherOpen, setLauncherOpen] = useState(false);
  const launcherRef = useRef<HTMLDivElement>(null);
  const launcherCloseTimer = useRef<number | null>(null);
  const openLauncherHover = () => {
    if (launcherCloseTimer.current) { window.clearTimeout(launcherCloseTimer.current); launcherCloseTimer.current = null; }
    setLauncherOpen(true);
  };
  const scheduleCloseLauncher = () => {
    launcherCloseTimer.current = window.setTimeout(() => setLauncherOpen(false), 150);
  };

  // URL khu nhân viên + tài khoản quản trị là tín hiệu đáng tin cậy hơn state
  // tạm thời: tải lại trang vẫn phải luôn thấy lối quay về quản trị.
  const isAdminViewingAsStaff =
    (profile?.role === 'admin' || profile?.role === 'ceo')
    && location.pathname.startsWith('/staff');

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
    { enabled: !!profile, channelKey: `staff-notifications-${profile?.id ?? 'anonymous'}` },
  );

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setNotifOpen(false);
      if (bottomLauncherRef.current && !bottomLauncherRef.current.contains(e.target as Node)) setBottomOpen(false);
      if (avatarRef.current && !avatarRef.current.contains(e.target as Node)) setAvatarOpen(false);
      if (launcherRef.current && !launcherRef.current.contains(e.target as Node)) setLauncherOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const unreadCount = notifications.filter((n) => !n.is_read).length;
  const unreadNotifications = notifications.filter((n) => !n.is_read);

  const handleBackToAdmin = () => {
    setViewAs('admin');
    const savedPath = window.sessionStorage.getItem('hrm:admin-return-path');
    window.sessionStorage.removeItem('hrm:admin-return-path');
    navigate(savedPath?.startsWith('/admin') ? savedPath : '/admin');
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

  const currentPage = STAFF_NAV_ITEMS.find((item) => {
    const base = item.to.split(/[?#]/, 1)[0];
    return location.pathname === base || location.pathname.startsWith(base + '/');
  });

  const groupsWithItems = navGroups
    .map((group) => ({ ...group, items: STAFF_NAV_ITEMS.filter((item) => item.group === group.name) }))
    .filter((group) => group.items.length > 0);

  // Lay duong dan KHOP DAI NHAT, giong khu quan tri.
  const groupOfCurrentPath = groupsWithItems
    .flatMap((group) => group.items.map((item) => ({ group: group.name, base: item.to })))
    .filter(({ base }) => location.pathname === base || location.pathname.startsWith(base + '/'))
    .sort((a, b) => b.base.length - a.base.length)[0]?.group ?? null;

  useEffect(() => {
    if (groupOfCurrentPath) setOpenGroup(groupOfCurrentPath);
  }, [groupOfCurrentPath]);

  const activeGroup = groupsWithItems.find((group) => group.name === openGroup) ?? null;

  const openModule = (name: string) => {
    setOpenGroup(name);
    setSidebarOpen(false);
    setLauncherOpen(false);
    if (name === groupOfCurrentPath) return;
    const first = groupsWithItems.find((group) => group.name === name)?.items[0];
    if (first) navigate(first.to);
  };




  return (
    <div className="app-shell min-h-screen bg-ambient flex">
      <a href="#main-content" className="skip-link">Bỏ qua điều hướng</a>
      {/* ================================================================
          Sidebar gọn trên desktop — danh sách chức năng của module đang
          mở (như cũ). Mặc định chỉ hiện icon; rê chuột vào BẤT KỲ đâu
          trong thanh là cả thanh xổ rộng ra (kiểu Supabase) và hiện tên
          từng trang. Thuần CSS, không giữ state JS cho việc này.
          ================================================================ */}
      <aside className="app-sidebar hidden md:flex sticky top-0 z-40 h-screen w-14 hover:w-60 flex-col overflow-hidden border-r border-slate-200 dark:border-slate-800 px-2 py-3 transition-[width] duration-200 ease-out">
        <NavLink
          to="/staff/dashboard"
          aria-label={orgName || 'HRM Huy Phong'}
          title={orgName || 'HRM Huy Phong'}
          className="flex h-10 flex-shrink-0 items-center gap-3 rounded-none px-1.5"
        >
          <img src="/logo-mark.png?v=3" alt="" aria-hidden="true" className="h-7 w-7 flex-shrink-0 object-contain" />
          <span className="truncate text-sm font-bold text-slate-800 dark:text-slate-100">{orgName || 'HRM Huy Phong'}</span>
        </NavLink>

        <nav className="mt-4 flex flex-1 flex-col gap-1.5 overflow-y-auto overflow-x-hidden scrollbar-none">
          {activeGroup ? (
            activeGroup.items.map((item) => {
              const Icon = item.icon;
              const base = item.to.split(/[?#]/, 1)[0];
              const isActive = location.pathname === base || location.pathname.startsWith(base + '/');
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  aria-label={item.label}
                  className={`flex h-10 flex-shrink-0 items-center gap-3 rounded-none px-2.5 transition-colors duration-150 ${
                    isActive ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-600/30' : 'text-slate-500 hover:bg-slate-100 hover:text-indigo-600 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-indigo-400'
                  }`}
                >
                  <Icon className="h-5 w-5 flex-shrink-0" />
                  <span className="truncate text-sm font-semibold">{item.label}</span>
                </NavLink>
              );
            })
          ) : (
            <p className="px-2.5 py-6 text-xs leading-relaxed text-slate-400 dark:text-slate-500">
              Chọn mục ở nút lưới trên đầu trang
            </p>
          )}
        </nav>
      </aside>

      {/* ================================================================
          Off-canvas cho điện thoại — hàng ô vuông chọn module ở trên,
          danh sách chức năng của module đang chọn ở dưới.
          ================================================================ */}
      <aside className={`app-sidebar fixed md:hidden top-0 left-0 z-40 h-screen w-[18.5rem] border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 flex flex-col transition-transform duration-300 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="min-h-20 flex items-center px-5 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <img
              src="/logo-mark.png?v=3"
              alt=""
              aria-hidden="true"
              className="h-9 w-9 flex-shrink-0 object-contain"
            />
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-slate-900 dark:text-slate-100">{orgName || 'HRM Huy Phong'}</p>
              <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">Cổng thông tin nhân viên</p>
            </div>
          </div>
          <button type="button" onClick={() => setSidebarOpen(false)} aria-label="Đóng menu điều hướng" className="ml-auto flex h-11 w-11 items-center justify-center rounded-xl text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">
            <X className="w-5 h-5" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4">
          {activeGroup ? (
            <div className="space-y-1">
              <div className="mb-3 flex items-center gap-3 border-b border-slate-200 dark:border-slate-800 px-3 pb-3">
                <span className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl ${activeGroup.iconOn}`}>
                  <activeGroup.icon className="h-5 w-5" />
                </span>
                <span className="min-w-0">
                  <span className="block text-[15px] font-bold leading-snug text-slate-900 dark:text-slate-100">{activeGroup.name}</span>
                  <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">{activeGroup.items.length} chức năng</span>
                </span>
              </div>

              {activeGroup.items.map((item) => {
                const Icon = item.icon;
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    onClick={() => setSidebarOpen(false)}
                    className={({ isActive }) =>
                      `group flex items-start gap-3 rounded-xl px-3 py-2.5 transition-colors duration-200 ${
                        isActive ? 'bg-indigo-600 shadow-sm shadow-indigo-600/30' : 'hover:bg-slate-100 dark:hover:bg-slate-800'
                      }`
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <Icon className={`mt-0.5 h-5 w-5 flex-shrink-0 transition-transform duration-200 group-hover:scale-110 ${
                          isActive ? 'text-white' : 'text-indigo-500 dark:text-indigo-400'
                        }`} />
                        <span className="min-w-0 flex-1">
                          <span className={`block text-sm font-semibold leading-snug ${
                            isActive ? 'text-white' : 'text-slate-800 dark:text-slate-200'
                          }`}>
                            {item.label}
                          </span>
                        </span>
                      </>
                    )}
                  </NavLink>
                );
              })}
            </div>
          ) : (
            <p className="px-3 py-6 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
              Chọn một mục ở nút lưới trên đầu trang.
            </p>
          )}
        </nav>
      </aside>

      {sidebarOpen && <div className="fixed inset-0 bg-slate-900/50 z-[38] md:hidden" onClick={() => setSidebarOpen(false)} />}

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header className="app-header min-h-[4.5rem] bg-white/80 dark:bg-slate-900/80 border-b border-slate-200/80 dark:border-slate-800/80 flex items-center justify-between px-4 sm:px-6 lg:px-8 sticky top-0 z-[35] backdrop-blur-xl">
          {/* `min-w-0 flex-1`: o flex mac dinh min-width:auto nen khong co
              duoc duoi kich thuoc noi dung - thieu no thi header phinh ra va
              day ca trang tran ngang, dung loi da gap ben khu quan tri. */}
          <div className="flex min-w-0 flex-1 items-center gap-4">
            <button type="button" onClick={() => setSidebarOpen(true)} aria-label="Mở menu điều hướng" className="flex h-11 w-11 items-center justify-center rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 md:hidden">
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex min-w-0 flex-col">
              <div className="flex items-center gap-2">
                {currentPage?.group && <span className="hidden sm:inline text-[10px] font-bold uppercase tracking-wider text-indigo-500 dark:text-indigo-400">{currentPage.group}</span>}
                {currentPage?.group && <span className="hidden sm:inline text-slate-300 dark:text-slate-600">/</span>}
                <h1 className="font-display truncate text-base font-bold tracking-tight text-slate-900 dark:text-slate-100">{currentPage?.label || 'Cổng nhân viên'}</h1>
              </div>
              {!currentPage && (
                <p className="hidden max-w-[560px] truncate text-xs text-slate-600 dark:text-slate-400 sm:block">
                  {`${getGreeting()}, ${profile?.name}`}
                </p>
              )}
            </div>
          </div>

          <div className="flex flex-shrink-0 items-center gap-2">
            {/* Bang module: dung khuon, dung vi tri, dung hanh vi voi khu
                quan tri - doi che do xem khong phai hoc lai cach dieu huong.
                Re chuot vao la tu xo ra, khong can bam. */}
            <div
              className="relative hidden md:block"
              ref={launcherRef}
              onMouseEnter={openLauncherHover}
              onMouseLeave={scheduleCloseLauncher}
            >
              <button
                onClick={() => setLauncherOpen(!launcherOpen)}
                onFocus={openLauncherHover}
                className={`flex h-11 items-center gap-2 rounded-none px-3 text-sm font-bold transition-colors ${
                  activeGroup ? activeGroup.chip : 'bg-slate-800 text-white hover:bg-slate-900'
                }`}
                aria-label="Mở bảng chức năng"
                aria-expanded={launcherOpen}
              >
                <LayoutGrid className="h-4.5 w-4.5 flex-shrink-0" />
                <span className="hidden max-w-[11rem] truncate sm:inline">
                  {activeGroup?.name ?? 'Chọn mục'}
                </span>
                <ChevronDown className={`h-4 w-4 flex-shrink-0 transition-transform ${launcherOpen ? 'rotate-180' : ''}`} />
              </button>

              {launcherOpen && (
                <div
                  onMouseEnter={openLauncherHover}
                  onMouseLeave={scheduleCloseLauncher}
                  className="absolute right-0 top-full z-50 mt-2 w-[min(32rem,calc(100vw-2rem))] rounded-none border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-3 shadow-xl"
                >
                  <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
                    {groupsWithItems.map((group) => {
                      const Icon = group.icon;
                      const isActive = group.name === openGroup;
                      return (
                        <button
                          key={group.name}
                          type="button"
                          onClick={() => openModule(group.name)}
                          aria-current={isActive ? 'true' : undefined}
                          className={`flex flex-col items-center gap-2 rounded-none px-2 py-3.5 text-center transition-colors ${
                            isActive ? group.tileOn : 'hover:bg-slate-50 dark:hover:bg-slate-700/50'
                          }`}
                        >
                          <span className={`flex h-11 w-11 items-center justify-center rounded-none transition-colors ${
                            isActive ? group.iconOn : group.iconIdle
                          }`}>
                            <Icon className="h-5 w-5" />
                          </span>
                          <span className={`text-xs font-semibold leading-tight ${
                            isActive ? group.textOn : 'text-slate-700 dark:text-slate-300'
                          }`}>
                            {group.name}
                          </span>
                          {/* So chuc nang ben trong: bu lai viec chung bi giau
                              sau mot cu bam - nhin la biet cum nao co gi. */}
                          <span className={`text-[10px] ${isActive ? group.textOn : 'text-slate-400 dark:text-slate-500'}`}>
                            {group.items.length} chức năng
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Chuyển sáng/tối */}
            <button
              type="button"
              onClick={toggleTheme}
              className="flex h-11 w-11 items-center justify-center rounded-none text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              aria-label={theme === 'dark' ? 'Chuyển sang giao diện sáng' : 'Chuyển sang giao diện tối'}
            >
              {theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            </button>

            {isAdminViewingAsStaff && (
              <button
                type="button"
                onClick={handleBackToAdmin}
                title="Kết thúc chế độ xem nhân viên và quay lại trang quản trị trước đó"
                className="group inline-flex h-11 items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-2.5 text-xs font-semibold text-indigo-700 transition-colors hover:border-indigo-300 hover:bg-indigo-100 sm:px-3"
              >
                <Eye className="h-4 w-4" />
                <span className="hidden lg:inline">Đang xem nhân viên</span>
                <span className="hidden h-4 w-px bg-indigo-200 lg:block" />
                <ArrowLeft className="h-3.5 w-3.5" />
                <span>Về Admin</span>
              </button>
            )}

            {/* Notifications */}
            <div className="relative" ref={notifRef}>
              <button
                onClick={() => { setNotifOpen(!notifOpen); setAvatarOpen(false); setLauncherOpen(false); }}
                className="relative p-2.5 rounded-none hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                aria-label={unreadCount > 0 ? `Mở thông báo, ${unreadCount} thông báo mới` : 'Mở thông báo'}
                aria-expanded={notifOpen}
              >
                <Bell className="w-5 h-5 text-slate-600 dark:text-slate-300" />
                {unreadCount > 0 && (
                  <span className="absolute top-1.5 right-1.5 w-4 h-4 bg-gradient-to-br from-red-500 to-rose-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center ring-2 ring-white dark:ring-slate-900">
                    {unreadCount}
                  </span>
                )}
              </button>
              {notifOpen && (
                <div className="absolute right-0 top-12 w-80 bg-white dark:bg-slate-800 rounded-2xl shadow-lifted border border-slate-100 dark:border-slate-700 z-40 modal-in overflow-hidden">
                  <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between bg-gradient-to-r from-slate-50 to-white dark:from-slate-800 dark:to-slate-800">
                    <span className="font-display font-semibold text-sm text-slate-800 dark:text-slate-100">Thông báo</span>
                    {unreadCount > 0 && (
                      <button onClick={markAllRead} className="text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:text-indigo-700">Đánh dấu đã đọc</button>
                    )}
                  </div>
                  <div className="max-h-80 overflow-y-auto">
                    {unreadNotifications.length === 0 ? (
                      <p className="text-sm text-slate-400 text-center py-10">Không có thông báo mới</p>
                    ) : (
                      unreadNotifications.map((n) => (
                        <button type="button" key={n.id} onClick={() => void openNotification(n)} className="block w-full px-4 py-3 border-b border-slate-50 dark:border-slate-700/60 text-left cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700/40 transition-colors bg-emerald-50/40 dark:bg-emerald-500/10">
                          <div className="flex items-center gap-2">
                            {!n.is_read && <span className="w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0" />}
                            <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{n.title}</p>
                          </div>
                          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 ml-4">{n.message}</p>
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
                className="flex items-center gap-2 p-1.5 pr-2.5 rounded-none hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                aria-label="Mở menu tài khoản"
                aria-expanded={avatarOpen}
              >
                <Avatar name={profile?.name || ''} url={profile?.avatar_url} size="sm" />
                <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${avatarOpen ? 'rotate-180' : ''}`} />
              </button>
              {avatarOpen && (
                <div className="absolute right-0 top-12 w-56 bg-white dark:bg-slate-800 rounded-2xl shadow-lifted border border-slate-100 dark:border-slate-700 z-40 modal-in py-1.5 overflow-hidden">
                  <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-700 bg-gradient-to-r from-slate-50 to-white dark:from-slate-800 dark:to-slate-800">
                    <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{profile?.name}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{profile?.email}</p>
                  </div>
                  {isAdminViewingAsStaff ? (
                    <button
                      onClick={handleBackToAdmin}
                      className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors text-left"
                    >
                      <span className="w-7 h-7 rounded-lg bg-indigo-50 dark:bg-indigo-500/15 flex items-center justify-center"><ArrowLeft className="w-4 h-4 text-indigo-600 dark:text-indigo-400" /></span>
                      Về trang quản trị trước đó
                    </button>
                  ) : hasAnyAdminPermission(profile) && (
                    // Nhân viên được cấp quyền lẻ vẫn vào được phần khu quản trị
                    // tương ứng; /admin tự đẩy tới trang đầu tiên họ có quyền.
                    <button
                      onClick={() => { setAvatarOpen(false); navigate('/admin'); }}
                      className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors text-left"
                    >
                      <span className="w-7 h-7 rounded-lg bg-indigo-50 dark:bg-indigo-500/15 flex items-center justify-center"><ShieldCheck className="w-4 h-4 text-indigo-600 dark:text-indigo-400" /></span>
                      Khu quản trị
                    </button>
                  )}
                  <button
                    onClick={() => { setAvatarOpen(false); navigate('/profile'); }}
                    className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors text-left"
                  >
                    <span className="w-7 h-7 rounded-lg bg-slate-100 dark:bg-slate-700 flex items-center justify-center"><UserCircle className="w-4 h-4 text-slate-600 dark:text-slate-300" /></span>
                    Hồ sơ cá nhân
                  </button>
                  <button
                    onClick={() => { setAvatarOpen(false); navigate('/change-password'); }}
                    className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors text-left"
                  >
                    <span className="w-7 h-7 rounded-lg bg-violet-50 dark:bg-violet-500/15 flex items-center justify-center"><KeyRound className="w-4 h-4 text-violet-600 dark:text-violet-400" /></span>
                    Đổi mật khẩu
                  </button>
                  <button
                    onClick={handleSignOut}
                    className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors text-left"
                  >
                    <span className="w-7 h-7 rounded-lg bg-red-50 dark:bg-red-500/15 flex items-center justify-center"><LogOut className="w-4 h-4" /></span>
                    Đăng xuất
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Page content — chừa chỗ cho thanh điều hướng đáy trên điện thoại */}
        <main id="main-content" data-bottom-launcher tabIndex={-1} className="page-content flex-1 p-4 pb-24 sm:p-6 sm:pb-24 md:p-8 md:pb-8 xl:p-10 max-w-[1520px] w-full mx-auto page-fade-in">
          {/* Lưới an toàn: một trang ném lỗi thì chỉ trang đó hiện báo lỗi,
              thanh điều hướng và đầu trang vẫn còn để đi chỗ khác. Không có
              nó thì React gỡ cả cây và màn hình trắng trơn. */}
          <PageErrorBoundary>{children}</PageErrorBoundary>
        </main>
      </div>
      {/* ================================================================
          Bảng module ở ĐÁY trên điện thoại.
          ----------------------------------------------------------------
          Nhân viên dùng điện thoại là chính, mà góc trên bên phải là chỗ
          xa ngón cái nhất khi cầm một tay. Từ màn tablet trở lên thì nút
          quay về header cho giống hệt khu quản trị — chuột thì góc trên
          không phải vấn đề.

          Chỉ một trong hai hiện tại mỗi thời điểm, nên không có chuyện hai
          thanh điều hướng cùng tồn tại rồi phải đoán cái nào là chính.
          ================================================================ */}
      <div ref={bottomLauncherRef} className="md:hidden">
        {bottomOpen && (
          <>
            <div
              className="fixed inset-0 z-40 bg-slate-900/40"
              onClick={() => setBottomOpen(false)}
              aria-hidden
            />
            <div className="safe-bottom fixed inset-x-0 bottom-0 z-50 rounded-t-3xl border-t border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4 shadow-[0_-18px_40px_-20px_rgba(15,23,42,0.45)]">
              <span aria-hidden className="mx-auto mb-3 block h-1 w-10 rounded-full bg-slate-300 dark:bg-slate-600" />
              <div className="grid grid-cols-3 gap-1">
                {groupsWithItems.map((group) => {
                  const Icon = group.icon;
                  const isActive = group.name === openGroup;
                  return (
                    <button
                      key={group.name}
                      type="button"
                      onClick={() => { openModule(group.name); setBottomOpen(false); }}
                      aria-current={isActive ? 'true' : undefined}
                      className={`flex flex-col items-center gap-2 rounded-lg px-2 py-3.5 text-center transition-colors ${
                        isActive ? group.tileOn : 'hover:bg-slate-50 dark:hover:bg-slate-700/50'
                      }`}
                    >
                      <span className={`flex h-12 w-12 items-center justify-center rounded-lg transition-colors ${
                        isActive ? group.iconOn : group.iconIdle
                      }`}>
                        <Icon className="h-5 w-5" />
                      </span>
                      <span className={`text-xs font-semibold leading-tight ${
                        isActive ? group.textOn : 'text-slate-700 dark:text-slate-300'
                      }`}>
                        {group.name}
                      </span>
                      <span className={`text-[10px] ${isActive ? group.textOn : 'text-slate-400 dark:text-slate-500'}`}>
                        {group.items.length} chức năng
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </>
        )}

        <div className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 dark:border-slate-700 bg-white/95 dark:bg-slate-900/95 px-4 pt-3 backdrop-blur-xl">
          <button
            type="button"
            onClick={() => setBottomOpen(!bottomOpen)}
            aria-expanded={bottomOpen}
            className={`flex h-12 w-full items-center justify-center gap-2 rounded-xl text-sm font-bold transition-colors ${
              activeGroup ? activeGroup.chip : 'bg-slate-800 text-white'
            }`}
          >
            <LayoutGrid className="h-5 w-5 flex-shrink-0" />
            <span className="truncate">{activeGroup?.name ?? 'Chọn mục'}</span>
            <ChevronDown className={`h-4 w-4 flex-shrink-0 transition-transform ${bottomOpen ? '' : 'rotate-180'}`} />
          </button>
        </div>
      </div>
    </div>
  );
}
