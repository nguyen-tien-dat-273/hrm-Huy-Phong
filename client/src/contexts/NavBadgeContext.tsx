// ============================================================================
// Số việc mới / đang chờ xử lý cho từng trang — một nguồn cho cả ba tầng:
//   nút bảng module (tổng) → ô module → mục sidebar → tab/CTA trong trang.
// ----------------------------------------------------------------------------
// Khu quản trị đếm theo HÀNG CHỜ thật trong database (đơn chờ duyệt, hồ sơ
// chờ kiểm tra…): con số chỉ giảm khi việc đã xử lý xong, không phải khi vừa
// liếc qua. RLS tự giới hạn phạm vi — trưởng phòng chỉ đếm được đơn phòng mình.
//
// Khu nhân viên không có hàng chờ để duyệt, nên đếm theo THÔNG BÁO CHƯA ĐỌC
// dẫn tới trang đó (đơn được duyệt, việc mới giao, phiếu lương phát hành…).
// Mở trang là coi như đã xem: các thông báo dẫn tới trang đó được đánh dấu đọc.
//
// Đặt ở App chứ không trong layout: layout dựng lại theo từng route, đặt trong
// đó thì mỗi lần đổi trang lại đếm từ đầu và con số nháy về 0.
// ============================================================================

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { useRealtimeSync } from '@/hooks/useRealtimeSync';
import { hasAdminFunction, hasPermission, isFullAdmin } from '@/lib/permissions';
import { notificationRoute } from '@/lib/notificationRoutes';

/** Một hàng chờ cụ thể — trang có nhiều tab dùng khoá riêng cho từng tab. */
export type BadgeKey =
  | 'assignments'
  | 'attendance'
  | 'leave.attendance'
  | 'leave.requests'
  | 'leave.cancellations'
  | 'onboarding'
  | 'recruitment.hr'
  | 'recruitment.board'
  | 'payroll.schemes'
  | 'payroll.runs'
  | 'kpi.board';

/** Trang nào gom những hàng chờ nào. */
const ROUTE_KEYS: Record<string, BadgeKey[]> = {
  '/admin/assignments': ['assignments'],
  '/admin/attendance': ['attendance'],
  '/admin/leave': ['leave.attendance', 'leave.requests', 'leave.cancellations'],
  '/admin/onboarding': ['onboarding'],
  '/admin/recruitment': ['recruitment.hr', 'recruitment.board'],
  '/admin/payroll/approvals': ['payroll.schemes', 'payroll.runs'],
  '/admin/performance/review': ['kpi.board'],
};

interface NavBadgeValue {
  /** Số của một hàng chờ (tab trong trang). */
  count: (key: BadgeKey) => number;
  /** Tổng của một trang (mục sidebar) — `to` có thể kèm ?query. */
  countFor: (to: string) => number;
  /** Tổng của nhiều trang (ô module, nút bảng module). */
  countForAll: (tos: readonly string[]) => number;
  refresh: () => void;
}

const NavBadgeContext = createContext<NavBadgeValue>({
  count: () => 0,
  countFor: () => 0,
  countForAll: () => 0,
  refresh: () => {},
});

const basePath = (to: string) => to.split(/[?#]/, 1)[0];

/** Đếm không kéo dữ liệu về; lỗi (bảng chưa có, không có quyền) coi là 0. */
async function headCount(build: () => PromiseLike<{ count: number | null; error: unknown }>) {
  try {
    const { count, error } = await build();
    return error ? 0 : (count ?? 0);
  } catch {
    return 0;
  }
}

export function NavBadgeProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuth();
  const location = useLocation();
  const [counts, setCounts] = useState<Partial<Record<BadgeKey, number>>>({});
  /** Thông báo chưa đọc, gom theo đường dẫn đích. */
  const [unread, setUnread] = useState<Array<{ id: string; route: string }>>([]);

  const perms = useMemo(() => ({
    attendance: hasPermission(profile, 'attendance'),
    leave: hasPermission(profile, 'leave'),
    users: hasPermission(profile, 'users'),
    board: isFullAdmin(profile),
    payrollApprove: hasAdminFunction(profile, 'admin.payroll_approve'),
    kpiApprove: hasAdminFunction(profile, 'admin.kpi_approve'),
  }), [profile]);

  const loadCounts = useCallback(async () => {
    if (!profile) { setCounts({}); return; }
    const since = new Date(Date.now() - 31 * 86_400_000).toISOString().slice(0, 10);
    const zero = Promise.resolve(0);
    const [
      assignments, attendance, leaveAttendance, leaveRequests, leaveCancellations,
      onboarding, recruitmentHr, recruitmentBoard, payrollSchemes, payrollRuns, kpiBoard,
    ] = await Promise.all([
      perms.attendance
        ? headCount(() => supabase.from('daily_assignments').select('id', { count: 'exact', head: true }).eq('status', 'submitted'))
        : zero,
      // Ngày công từ máy đã đủ giờ ra nhưng chưa ai xác nhận — chỉ tính 31
      // ngày gần nhất, tồn đọng cũ hơn đã có thông báo riêng trong trang.
      perms.attendance
        ? headCount(() => supabase.from('attendance').select('id', { count: 'exact', head: true })
          .eq('check_in_method', 'DEVICE').eq('approved_by_lead', false)
          .not('check_out_time', 'is', null).gte('date', since))
        : zero,
      perms.attendance
        ? headCount(() => supabase.from('attendance_requests').select('id', { count: 'exact', head: true }).eq('status', 'PENDING'))
        : zero,
      perms.leave || perms.users
        ? headCount(() => supabase.from('leave_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending'))
        : zero,
      perms.leave
        ? headCount(() => supabase.from('leave_cancellation_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending'))
        : zero,
      perms.users
        ? headCount(() => supabase.from('onboarding_submissions').select('id', { count: 'exact', head: true }).eq('status', 'PENDING'))
        : zero,
      perms.users
        ? headCount(() => supabase.from('recruitment_requisitions').select('id', { count: 'exact', head: true }).eq('status', 'SUBMITTED'))
        : zero,
      perms.board
        ? headCount(() => supabase.from('recruitment_requisitions').select('id', { count: 'exact', head: true }).eq('status', 'PENDING_BOARD'))
        : zero,
      perms.payrollApprove
        ? headCount(() => supabase.from('payroll_scheme_requests').select('id', { count: 'exact', head: true }).eq('status', 'SUBMITTED'))
        : zero,
      perms.payrollApprove
        ? headCount(() => supabase.from('payroll_runs').select('id', { count: 'exact', head: true }).eq('status', 'LOCKED'))
        : zero,
      perms.kpiApprove
        ? headCount(() => supabase.from('kpi_sheets').select('id', { count: 'exact', head: true }).eq('status', 'BOARD'))
        : zero,
    ]);
    setCounts({
      assignments,
      attendance,
      'leave.attendance': leaveAttendance,
      'leave.requests': leaveRequests,
      'leave.cancellations': leaveCancellations,
      onboarding,
      'recruitment.hr': recruitmentHr,
      'recruitment.board': recruitmentBoard,
      'payroll.schemes': payrollSchemes,
      'payroll.runs': payrollRuns,
      'kpi.board': kpiBoard,
    });
  }, [profile, perms]);

  const loadUnread = useCallback(async () => {
    if (!profile) { setUnread([]); return; }
    const { data } = await supabase
      .from('notifications')
      .select('id, type, message')
      .eq('user_id', profile.id)
      .eq('is_read', false)
      .order('created_at', { ascending: false })
      .limit(200);
    setUnread(((data || []) as Array<{ id: string; type: string; message: string | null }>)
      .map((row) => ({ id: row.id, route: basePath(notificationRoute(row.type, row.message ?? undefined)) })));
  }, [profile]);

  const refresh = useCallback(() => { void loadCounts(); void loadUnread(); }, [loadCounts, loadUnread]);

  useEffect(() => { refresh(); }, [refresh]);

  useRealtimeSync(
    [
      { table: 'daily_assignments' },
      { table: 'attendance' },
      { table: 'attendance_requests' },
      { table: 'leave_requests' },
      { table: 'leave_cancellation_requests' },
      { table: 'onboarding_submissions' },
      { table: 'recruitment_requisitions' },
      { table: 'payroll_scheme_requests' },
      { table: 'payroll_runs' },
      { table: 'kpi_sheets' },
    ],
    loadCounts,
    { enabled: !!profile, delayMs: 800, channelKey: 'nav-badges' },
  );

  useRealtimeSync(
    profile ? [{ table: 'notifications', filter: `user_id=eq.${profile.id}` }] : [],
    loadUnread,
    { enabled: !!profile, channelKey: `nav-badges-${profile?.id ?? 'anonymous'}` },
  );

  // Đổi trang thì đếm lại hàng chờ: thao tác duyệt ở trang vừa rời có thể
  // chưa kịp phát sự kiện realtime (hoặc bảng đó không bật realtime).
  useEffect(() => { void loadCounts(); }, [location.pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  // Lưới an toàn: phần lớn bảng hàng chờ chưa bật realtime trong publication,
  // nên cứ 60 giây đếm lại một lần (chỉ khi tab đang mở — đếm `head` rất nhẹ).
  useEffect(() => {
    if (!profile) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void loadCounts();
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [profile, loadCounts]);

  // Mở trang khu nhân viên = đã xem các thông báo dẫn tới trang đó.
  const marking = useRef(false);
  useEffect(() => {
    if (!profile || marking.current) return;
    const ids = unread.filter((row) => !row.route.startsWith('/admin') && row.route === location.pathname).map((row) => row.id);
    if (ids.length === 0) return;
    marking.current = true;
    setUnread((prev) => prev.filter((row) => !ids.includes(row.id)));
    void Promise.resolve(
      supabase.from('notifications').update({ is_read: true }).in('id', ids).eq('user_id', profile.id),
    ).finally(() => { marking.current = false; });
  }, [location.pathname, unread, profile]);

  const value = useMemo<NavBadgeValue>(() => {
    const count = (key: BadgeKey) => counts[key] ?? 0;
    const countFor = (to: string) => {
      const base = basePath(to);
      const keys = ROUTE_KEYS[base];
      if (keys) return keys.reduce((sum, key) => sum + count(key), 0);
      // Trang quản trị không có hàng chờ riêng thì không cộng thông báo:
      // tránh đếm trùng với chuông và với hàng chờ thật.
      if (base.startsWith('/admin')) return 0;
      return unread.filter((row) => row.route === base).length;
    };
    const countForAll = (tos: readonly string[]) => tos.reduce((sum, to) => sum + countFor(to), 0);
    return { count, countFor, countForAll, refresh };
  }, [counts, unread, refresh]);

  return <NavBadgeContext.Provider value={value}>{children}</NavBadgeContext.Provider>;
}

export const useNavBadges = () => useContext(NavBadgeContext);
