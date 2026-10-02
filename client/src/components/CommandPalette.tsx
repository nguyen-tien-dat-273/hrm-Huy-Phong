import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search, LayoutDashboard, CalendarOff,
  Briefcase, KanbanSquare, Fingerprint, FileBarChart, NotebookPen, KeyRound, LogOut, CornerDownLeft, ArrowUp, ArrowDown,
  UserCircle, BookOpen, WalletCards,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { hasAdminFunction, hasPermission, isFullAdmin, type AdminFunctionCode, type AdminPermission } from '@/lib/permissions';
import { ADMIN_NAV_ITEMS } from '@/config/navigation';

// ============================================================================
// Command palette (Ctrl/⌘ + K)
// ----------------------------------------------------------------------------
// Đi tới bất kỳ trang nào bằng bàn phím, không cần rê chuột qua sidebar. Chỉ
// hiện những mục người dùng thực sự có quyền vào — dùng chung `hasPermission`
// với sidebar và route guard, nên không bao giờ lệch nhau.
// ============================================================================

interface Command {
  id: string;
  label: string;
  group: string;
  icon: typeof Search;
  /** Từ khóa phụ để tìm được cả khi gõ không dấu. */
  keywords?: string;
  /** Bỏ trống = mọi người đăng nhập đều dùng được (các trang khu nhân viên). */
  permission?: AdminPermission;
  anyPermissions?: AdminPermission[];
  /** Trang nhạy cảm không mở theo quyền lẻ (vd: Tính lương) — chỉ admin/CEO. */
  fullAdminOnly?: boolean;
  functionCode?: AdminFunctionCode;
  run: () => void;
}

/** Bỏ dấu tiếng Việt để gõ "cham cong" vẫn tìm ra "Chấm công". */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd');
}

export function CommandPalette() {
  const navigate = useNavigate();
  const { profile, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
    setActiveIndex(0);
  }, []);

  const commands = useMemo<Command[]>(() => {
    const go = (to: string) => () => { close(); navigate(to); };
    return [
      ...ADMIN_NAV_ITEMS.map((item) => ({
        id: `admin-${item.to.split('/').pop()}`,
        label: item.label,
        group: item.group,
        icon: item.icon,
        keywords: item.keywords,
        permission: item.permission,
        anyPermissions: item.anyPermissions,
        fullAdminOnly: item.fullAdminOnly,
        functionCode: item.functionCode,
        run: go(item.to),
      })),

      { id: 'staff-dashboard', label: 'Trang chủ cá nhân', group: 'Cổng nhân viên', icon: LayoutDashboard, run: go('/staff/dashboard') },
      { id: 'staff-projects', label: 'Dự án của tôi', group: 'Cổng nhân viên', icon: Briefcase, run: go('/staff/projects') },
      { id: 'staff-kanban', label: 'Tác vụ Kanban', group: 'Cổng nhân viên', icon: KanbanSquare, keywords: 'task cong viec', run: go('/staff/kanban') },
      { id: 'staff-attendance', label: 'Chấm công', group: 'Cổng nhân viên', icon: Fingerprint, keywords: 'check in out', run: go('/staff/attendance') },
      { id: 'staff-worklog', label: 'Nhật ký giờ của tôi', group: 'Cổng nhân viên', icon: NotebookPen, keywords: 'ghi gio worklog', run: go('/staff/worklog') },
      { id: 'staff-leave', label: 'Đơn từ của tôi', group: 'Cổng nhân viên', icon: CalendarOff, keywords: 'don tu xin nghi quy phep di muon ve som lam them tang ca', run: go('/staff/leave') },
      { id: 'staff-reports', label: 'Báo cáo cá nhân', group: 'Cổng nhân viên', icon: FileBarChart, run: go('/staff/reports') },
      { id: 'staff-payroll', label: 'Lương của tôi', group: 'Cổng nhân viên', icon: WalletCards, keywords: 'luong phieu luong thu nhap payslip', run: go('/staff/payroll') },
      { id: 'staff-training', label: 'Đào tạo của tôi', group: 'Cổng nhân viên', icon: BookOpen, keywords: 'dao tao khoa hoc hoc tap', run: go('/staff/training') },

      { id: 'profile', label: 'Hồ sơ cá nhân', group: 'Tài khoản', icon: UserCircle, keywords: 'thong tin ca nhan anh dai dien so dien thoai avatar', run: go('/profile') },
      { id: 'change-password', label: 'Đổi mật khẩu', group: 'Tài khoản', icon: KeyRound, run: go('/change-password') },
      {
        id: 'sign-out',
        label: 'Đăng xuất',
        group: 'Tài khoản',
        icon: LogOut,
        keywords: 'thoat logout',
        run: async () => { close(); await signOut(); navigate('/login'); },
      },
    ];
  }, [close, navigate, signOut]);

  const visible = useMemo(() => {
    const allowed = commands.filter(
      (c) => {
        const allowed = c.anyPermissions?.length
          ? c.anyPermissions.some((permission) => hasPermission(profile, permission))
          : (c.permission ? hasPermission(profile, c.permission) : true);
        return allowed && (!c.fullAdminOnly || isFullAdmin(profile)) && (!c.functionCode || hasAdminFunction(profile, c.functionCode));
      },
    );
    if (!query.trim()) return allowed;
    const q = normalize(query);
    return allowed.filter((c) => normalize(`${c.label} ${c.group} ${c.keywords ?? ''}`).includes(q));
  }, [commands, profile, query]);

  // Ctrl/⌘+K để mở, kể cả khi con trỏ đang ở trong ô nhập liệu khác.
  // Thêm phím `/` như GitHub, Slack, Linear — nhanh hơn vì chỉ một phím.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const inField =
        e.target instanceof HTMLElement &&
        (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName) || e.target.isContentEditable);

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
        return;
      }
      // `/` chỉ mở khi KHÔNG đang gõ trong ô nhập — nếu không sẽ không gõ được
      // dấu gạch chéo vào bất kỳ form nào.
      if (e.key === '/' && !inField && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
      // Đợi một khung hình để input đã nằm trong DOM rồi mới focus.
      requestAnimationFrame(() => inputRef.current?.focus());
      return () => { document.body.style.overflow = ''; };
    }
  }, [open]);

  useEffect(() => setActiveIndex(0), [query]);

  // Cuộn mục đang chọn vào tầm nhìn khi di chuyển bằng phím mũi tên.
  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  if (!profile || !open) return null;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIndex((i) => (i + 1) % Math.max(visible.length, 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIndex((i) => (i - 1 + visible.length) % Math.max(visible.length, 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); visible[activeIndex]?.run(); }
  };

  let lastGroup = '';

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center pt-[12vh] px-4" onKeyDown={onKeyDown}>
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-md" onClick={close} />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Tìm nhanh và điều hướng"
        className="modal-in relative w-full max-w-xl bg-white rounded-2xl shadow-2xl ring-1 ring-slate-900/5 overflow-hidden"
      >
        <div className="flex items-center gap-3 px-4 border-b border-slate-100">
          <Search className="w-4.5 h-4.5 text-slate-400 flex-shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Đi tới trang, hoặc gõ để tìm..."
            aria-label="Tìm lệnh"
            aria-autocomplete="list"
            className="flex-1 h-14 bg-transparent text-[15px] text-slate-800 placeholder:text-slate-400 focus:outline-none"
          />
          <kbd className="hidden sm:block text-[11px] font-medium text-slate-400 border border-slate-200 rounded-md px-1.5 py-0.5">
            ESC
          </kbd>
        </div>

        <div ref={listRef} role="listbox" aria-label="Kết quả" className="max-h-[52vh] overflow-y-auto py-2">
          {visible.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-10">
              Không có kết quả cho “{query}”
            </p>
          ) : (
            visible.map((cmd, i) => {
              const Icon = cmd.icon;
              const showGroup = cmd.group !== lastGroup;
              lastGroup = cmd.group;
              const active = i === activeIndex;
              return (
                <div key={cmd.id}>
                  {showGroup && (
                    <p className="px-4 pt-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                      {cmd.group}
                    </p>
                  )}
                  <button
                    role="option"
                    aria-selected={active}
                    data-active={active}
                    onMouseEnter={() => setActiveIndex(i)}
                    onClick={cmd.run}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                      active ? 'bg-blue-50 text-blue-700' : 'text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <span
                      className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                        active ? 'bg-blue-100 text-blue-600' : 'bg-slate-100 text-slate-500'
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                    </span>
                    <span className="text-sm font-medium">{cmd.label}</span>
                    {active && <CornerDownLeft className="w-3.5 h-3.5 ml-auto text-blue-400" />}
                  </button>
                </div>
              );
            })
          )}
        </div>

        <div className="flex items-center gap-4 px-4 py-2.5 border-t border-slate-100 bg-slate-50/80 text-[11px] text-slate-400">
          <span className="flex items-center gap-1"><ArrowUp className="w-3 h-3" /><ArrowDown className="w-3 h-3" /> di chuyển</span>
          <span className="flex items-center gap-1"><CornerDownLeft className="w-3 h-3" /> chọn</span>
          <span className="hidden sm:flex items-center gap-1">
            <kbd className="border border-slate-200 rounded px-1">/</kbd> mở nhanh
          </span>
          <span className="ml-auto">{visible.length} mục</span>
        </div>
      </div>
    </div>
  );
}
