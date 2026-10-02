import { type ReactNode, useState, useEffect, useRef } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Briefcase, KanbanSquare, Fingerprint,
  FileBarChart, NotebookPen, Bell, ChevronDown, Building2, Menu, X, ArrowLeft, Eye, KeyRound, LogOut, ShieldCheck,
  UserCircle, BookOpen, Target, WalletCards, Clock, LayoutGrid, ClipboardList,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useViewMode } from '@/contexts/ViewModeContext';
import { Avatar } from '@/components/ui/Avatar';
import { supabase } from '@/lib/supabase';
import { hasAnyAdminPermission } from '@/lib/permissions';
import { useAppSettings } from '@/contexts/SettingsContext';
import { getGreeting } from '@/lib/utils';
import type { Notification } from '@/types';

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
    iconIdle: 'bg-indigo-50 text-indigo-600', iconOn: 'bg-indigo-600 text-white shadow-sm shadow-indigo-600/30',
    tileOn: 'bg-indigo-50', textOn: 'text-indigo-700',
    chip: 'bg-indigo-600 text-white shadow-sm shadow-indigo-600/30 hover:bg-indigo-700',
  },
  {
    name: 'Công việc', icon: KanbanSquare, hint: 'Dự án, tác vụ và nhật ký giờ',
    iconIdle: 'bg-orange-50 text-orange-600', iconOn: 'bg-orange-600 text-white shadow-sm shadow-orange-600/30',
    tileOn: 'bg-orange-50', textOn: 'text-orange-700',
    chip: 'bg-orange-600 text-white shadow-sm shadow-orange-600/30 hover:bg-orange-700',
  },
  {
    name: 'Thời gian & Lịch', icon: Clock, hint: 'Chấm công và các loại đơn từ',
    iconIdle: 'bg-amber-50 text-amber-600', iconOn: 'bg-amber-500 text-white shadow-sm shadow-amber-500/30',
    tileOn: 'bg-amber-50', textOn: 'text-amber-700',
    chip: 'bg-amber-500 text-white shadow-sm shadow-amber-500/30 hover:bg-amber-600',
  },
  {
    name: 'Lương & Đãi ngộ', icon: WalletCards, hint: 'Phiếu lương của bạn',
    iconIdle: 'bg-emerald-50 text-emerald-600', iconOn: 'bg-emerald-600 text-white shadow-sm shadow-emerald-600/30',
    tileOn: 'bg-emerald-50', textOn: 'text-emerald-700',
    chip: 'bg-emerald-600 text-white shadow-sm shadow-emerald-600/30 hover:bg-emerald-700',
  },
  {
    name: 'KPI', icon: Target, hint: 'Kết quả chấm điểm của bạn',
    iconIdle: 'bg-rose-50 text-rose-600', iconOn: 'bg-rose-600 text-white shadow-sm shadow-rose-600/30',
    tileOn: 'bg-rose-50', textOn: 'text-rose-700',
    chip: 'bg-rose-600 text-white shadow-sm shadow-rose-600/30 hover:bg-rose-700',
  },
  {
    // Teal, khong phai rose: KPI da tach ra thanh module rieng nen hai cum
    // phai nhin ra la hai thu khac nhau. Teal cung khop voi cum "Dao tao &
    // Quy trinh" ben khu quan tri.
    name: 'Phát triển', icon: BookOpen, hint: 'Đào tạo, quy trình và lộ trình',
    iconIdle: 'bg-teal-50 text-teal-600', iconOn: 'bg-teal-600 text-white shadow-sm shadow-teal-600/30',
    tileOn: 'bg-teal-50', textOn: 'text-teal-700',
    chip: 'bg-teal-600 text-white shadow-sm shadow-teal-600/30 hover:bg-teal-700',
  },
];

const navItems = [
  { to: '/staff/dashboard', label: 'Trang chủ', description: 'Tổng quan công việc và lịch cá nhân hôm nay', icon: LayoutDashboard, group: 'Tổng quan' },
  { to: '/staff/reports', label: 'Báo cáo cá nhân', description: 'Ngày công, thời gian và kết quả của bạn', icon: FileBarChart, group: 'Tổng quan' },

  { to: '/staff/assignments', label: 'Việc được giao', description: 'Việc quản lý giao theo ngày, gửi lại khi xong', icon: ClipboardList, group: 'Công việc' },
  { to: '/staff/projects', label: 'Dự án của tôi', description: 'Các dự án và thành viên đang cộng tác', icon: Briefcase, group: 'Công việc' },
  { to: '/staff/kanban', label: 'Tác vụ Kanban', description: 'Theo dõi và cập nhật trạng thái tác vụ', icon: KanbanSquare, group: 'Công việc' },
  { to: '/staff/worklog', label: 'Nhật ký giờ', description: 'Ghi nhận thời gian thực tế cho từng công việc', icon: NotebookPen, group: 'Công việc' },

  { to: '/staff/attendance', label: 'Chấm công', description: 'Xem dữ liệu từ máy chấm công và hoàn tất check-out', icon: Fingerprint, group: 'Thời gian & Lịch' },
  { to: '/staff/leave', label: 'Đơn từ của tôi', description: 'Nghỉ phép, đi muộn, về sớm và làm thêm giờ', icon: ClipboardList, group: 'Thời gian & Lịch' },

  { to: '/staff/payroll', label: 'Lương của tôi', description: 'Xem phiếu lương và các khoản khấu trừ cá nhân', icon: WalletCards, group: 'Lương & Đãi ngộ' },

  { to: '/staff/kpi', label: 'KPI của tôi', description: 'Kết quả chấm điểm và điểm từng tiêu chí', icon: Target, group: 'KPI' },
  { to: '/staff/training', label: 'Đào tạo của tôi', description: 'Khóa học được giao và tiến độ hoàn thành', icon: BookOpen, group: 'Phát triển' },
  { to: '/staff/processes', label: 'Quy trình & biểu mẫu', description: 'Tài liệu đang hiệu lực của công ty', icon: BookOpen, group: 'Phát triển' },
  { to: '/staff/growth', label: 'Lộ trình phát triển', description: 'Checklist hội nhập và bàn giao của tôi', icon: Target, group: 'Phát triển' },
];

export function StaffLayout({ children }: { children: ReactNode }) {
  const { profile, signOut } = useAuth();
  const { setViewAs } = useViewMode();
  const { orgName } = useAppSettings();
  const navigate = useNavigate();
  const location = useLocation();
  const [avatarOpen, setAvatarOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const notifRef = useRef<HTMLDivElement>(null);
  const launcherRef = useRef<HTMLDivElement>(null);
  const [launcherOpen, setLauncherOpen] = useState(false);
  const [bottomOpen, setBottomOpen] = useState(false);
  const bottomLauncherRef = useRef<HTMLDivElement>(null);
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const avatarRef = useRef<HTMLDivElement>(null);

  // URL khu nhân viên + tài khoản quản trị là tín hiệu đáng tin cậy hơn state
  // tạm thời: tải lại trang vẫn phải luôn thấy lối quay về quản trị.
  const isAdminViewingAsStaff =
    (profile?.role === 'admin' || profile?.role === 'ceo')
    && location.pathname.startsWith('/staff');

  useEffect(() => {
    if (profile) {
      supabase
        .from('notifications')
        .select('*')
        .eq('user_id', profile.id)
        .order('created_at', { ascending: false })
        .limit(10)
        .then(({ data }) => { if (data) setNotifications(data); });
    }
  }, [profile, location.pathname]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setNotifOpen(false);
      if (launcherRef.current && !launcherRef.current.contains(e.target as Node)) setLauncherOpen(false);
      if (bottomLauncherRef.current && !bottomLauncherRef.current.contains(e.target as Node)) setBottomOpen(false);
      if (avatarRef.current && !avatarRef.current.contains(e.target as Node)) setAvatarOpen(false);
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

  const currentPage = navItems.find((item) => location.pathname.startsWith(item.to));

  const groupsWithItems = navGroups
    .map((group) => ({ ...group, items: navItems.filter((item) => item.group === group.name) }))
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
      {/* Sidebar */}
      <aside className={`app-sidebar fixed md:sticky top-0 left-0 z-40 h-screen w-[18.5rem] border-r border-slate-200 bg-white text-slate-700 flex flex-col transition-transform duration-300 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}>
        <div className="min-h-20 flex items-center px-5 border-b border-slate-200">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-indigo-600 rounded-lg flex flex-col items-center justify-center gap-0.5">
              <div className="w-4 h-0.5 bg-white/30 rounded-full" />
              <div className="w-4 h-0.5 bg-white rounded-full" />
              <div className="w-4 h-0.5 bg-white/30 rounded-full" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-slate-900">{orgName || 'HRM Huy Phong'}</p>
              <p className="mt-0.5 text-[11px] text-slate-500">Cổng thông tin nhân viên</p>
            </div>
          </div>
          <button onClick={() => setSidebarOpen(false)} className="md:hidden ml-auto text-slate-400">
            <X className="w-5 h-5" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4">
          {activeGroup ? (
            <div className="space-y-1">
              <div className="mb-3 flex items-center gap-3 border-b border-slate-200 px-3 pb-3">
                <span className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl ${activeGroup.iconOn}`}>
                  <activeGroup.icon className="h-5 w-5" />
                </span>
                <span className="min-w-0">
                  <span className="block text-[15px] font-bold leading-snug text-slate-900">{activeGroup.name}</span>
                  <span className="mt-0.5 block text-xs text-slate-500">{activeGroup.items.length} chức năng</span>
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
                        isActive ? 'bg-indigo-600 shadow-sm shadow-indigo-600/30' : 'hover:bg-slate-100'
                      }`
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <Icon className={`mt-0.5 h-5 w-5 flex-shrink-0 transition-transform duration-200 group-hover:scale-110 ${
                          isActive ? 'text-white' : 'text-indigo-500'
                        }`} />
                        <span className="min-w-0 flex-1">
                          <span className={`block text-sm font-semibold leading-snug ${
                            isActive ? 'text-white' : 'text-slate-800'
                          }`}>
                            {item.label}
                          </span>
                          <span className={`mt-0.5 block text-[11px] leading-snug ${
                            isActive ? 'text-indigo-100' : 'text-slate-500'
                          }`}>
                            {item.description}
                          </span>
                        </span>
                      </>
                    )}
                  </NavLink>
                );
              })}
            </div>
          ) : (
            <p className="px-3 py-6 text-xs leading-relaxed text-slate-500">
              Chọn một mục ở nút lưới trên đầu trang.
            </p>
          )}
        </nav>
      </aside>

      {sidebarOpen && <div className="fixed inset-0 bg-slate-900/50 z-30 lg:hidden" onClick={() => setSidebarOpen(false)} />}

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header className="app-header min-h-[4.5rem] bg-white/80 border-b border-slate-200/80 flex items-center justify-between px-4 sm:px-6 lg:px-8 sticky top-0 z-20 backdrop-blur-xl">
          {/* `min-w-0 flex-1`: o flex mac dinh min-width:auto nen khong co
              duoc duoi kich thuoc noi dung - thieu no thi header phinh ra va
              day ca trang tran ngang, dung loi da gap ben khu quan tri. */}
          <div className="flex min-w-0 flex-1 items-center gap-4">
            <button onClick={() => setSidebarOpen(true)} className="md:hidden text-slate-600 p-2 rounded-lg hover:bg-slate-100">
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex min-w-0 flex-col">
              <div className="flex items-center gap-2">
                {currentPage?.group && <span className="hidden sm:inline text-[10px] font-bold uppercase tracking-wider text-indigo-500">{currentPage.group}</span>}
                {currentPage?.group && <span className="hidden sm:inline text-slate-300">/</span>}
                <h1 className="font-display truncate text-base font-bold tracking-tight text-slate-900">{currentPage?.label || 'Cổng nhân viên'}</h1>
              </div>
              <p className="hidden max-w-[560px] truncate text-xs text-slate-600 sm:block">
                {currentPage?.description || `${getGreeting()}, ${profile?.name}`}
              </p>
            </div>
          </div>

          <div className="flex flex-shrink-0 items-center gap-2">
            {/* Bang module: dung khuon, dung vi tri, dung hanh vi voi khu
                quan tri - doi che do xem khong phai hoc lai cach dieu huong. */}
            <div className="relative hidden md:block" ref={launcherRef}>
              <button
                onClick={() => { setLauncherOpen(!launcherOpen); setNotifOpen(false); setAvatarOpen(false); }}
                className={`flex h-10 items-center gap-2 rounded-xl px-3 text-sm font-bold transition-colors ${
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
                <div className="absolute right-0 top-full z-50 mt-2 w-[min(32rem,calc(100vw-2rem))] rounded-2xl border border-slate-200 bg-white p-3 shadow-xl">
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
                          className={`flex flex-col items-center gap-2 rounded-xl px-2 py-3.5 text-center transition-colors ${
                            isActive ? group.tileOn : 'hover:bg-slate-50'
                          }`}
                        >
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
                          {/* So chuc nang ben trong: bu lai viec chung bi giau
                              sau mot cu bam - nhin la biet cum nao co gi. */}
                          <span className={`text-[10px] ${isActive ? group.textOn : 'text-slate-400'}`}>
                            {group.items.length} chức năng
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {isAdminViewingAsStaff && (
              <button
                type="button"
                onClick={handleBackToAdmin}
                title="Kết thúc chế độ xem nhân viên và quay lại trang quản trị trước đó"
                className="group inline-flex h-9 items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-2.5 text-xs font-semibold text-indigo-700 transition-colors hover:border-indigo-300 hover:bg-indigo-100 sm:px-3"
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
                onClick={() => { setNotifOpen(!notifOpen); setAvatarOpen(false); }}
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
                        <button type="button" key={n.id} onClick={() => void markNotificationRead(n.id)} className="block w-full px-4 py-3 border-b border-slate-50 text-left cursor-pointer hover:bg-slate-50 transition-colors bg-emerald-50/40">
                          <div className="flex items-center gap-2">
                            {!n.is_read && <span className="w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0" />}
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
                onClick={() => { setAvatarOpen(!avatarOpen); setNotifOpen(false); }}
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
                  {isAdminViewingAsStaff ? (
                    <button
                      onClick={handleBackToAdmin}
                      className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors text-left"
                    >
                      <span className="w-7 h-7 rounded-lg bg-blue-50 flex items-center justify-center"><ArrowLeft className="w-4 h-4 text-blue-600" /></span>
                      Về trang quản trị trước đó
                    </button>
                  ) : hasAnyAdminPermission(profile) && (
                    // Nhân viên được cấp quyền lẻ vẫn vào được phần khu quản trị
                    // tương ứng; /admin tự đẩy tới trang đầu tiên họ có quyền.
                    <button
                      onClick={() => { setAvatarOpen(false); navigate('/admin'); }}
                      className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors text-left"
                    >
                      <span className="w-7 h-7 rounded-lg bg-blue-50 flex items-center justify-center"><ShieldCheck className="w-4 h-4 text-blue-600" /></span>
                      Khu quản trị
                    </button>
                  )}
                  <button
                    onClick={() => { setAvatarOpen(false); navigate('/profile'); }}
                    className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors text-left"
                  >
                    <span className="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center"><UserCircle className="w-4 h-4 text-slate-600" /></span>
                    Hồ sơ cá nhân
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

        {/* Page content — chừa chỗ cho thanh điều hướng đáy trên điện thoại */}
        <main id="main-content" data-bottom-launcher tabIndex={-1} className="page-content flex-1 p-4 pb-24 sm:p-6 sm:pb-24 md:p-8 md:pb-8 xl:p-10 max-w-[1520px] w-full mx-auto page-fade-in">
          {children}
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
            <div className="safe-bottom fixed inset-x-0 bottom-0 z-50 rounded-t-3xl border-t border-slate-200 bg-white p-4 shadow-[0_-18px_40px_-20px_rgba(15,23,42,0.45)]">
              <span aria-hidden className="mx-auto mb-3 block h-1 w-10 rounded-full bg-slate-300" />
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
                      className={`flex flex-col items-center gap-2 rounded-xl px-2 py-3.5 text-center transition-colors ${
                        isActive ? group.tileOn : 'hover:bg-slate-50'
                      }`}
                    >
                      <span className={`flex h-12 w-12 items-center justify-center rounded-xl transition-colors ${
                        isActive ? group.iconOn : group.iconIdle
                      }`}>
                        <Icon className="h-5 w-5" />
                      </span>
                      <span className={`text-xs font-semibold leading-tight ${
                        isActive ? group.textOn : 'text-slate-700'
                      }`}>
                        {group.name}
                      </span>
                      <span className={`text-[10px] ${isActive ? group.textOn : 'text-slate-400'}`}>
                        {group.items.length} chức năng
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </>
        )}

        <div className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 px-4 pt-3 backdrop-blur-xl">
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
