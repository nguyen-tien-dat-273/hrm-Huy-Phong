import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PostgrestError } from '@supabase/supabase-js';
import { FileSpreadsheet, Table as TableIcon, Lock, Unlock, ScanSearch, Search, TriangleAlert, CalendarDays } from 'lucide-react';
import { startOfMonth, endOfMonth, format, getDaysInMonth } from 'date-fns';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { TableSkeleton } from '@/components/ui/Skeleton';
import { MonthNav } from '@/components/ui/MonthNav';
import { Dropdown } from '@/components/ui/Dropdown';
import { Modal } from '@/components/ui/Modal';
import { Input, Textarea } from '@/components/ui/Input';
import {
  FullscreenPanel, FullscreenToggle, ScrollArrows, TableShell, scrollAreaClass, useColumnScroll,
} from '@/components/payroll/WideTable';
import { normalizeText } from '@/lib/formulaTokens';
import { useToast } from '@/contexts/ToastContext';
import { useAuth } from '@/contexts/AuthContext';
import { useAppSettings } from '@/contexts/SettingsContext';
import { useRealtimeSync } from '@/hooks/useRealtimeSync';
import { supabase } from '@/lib/supabase';
import { describeDbError, describeDbErrorOrNull } from '@/lib/dbError';
import { formatTime, toDateString } from '@/lib/utils';
import { hasAdminFunction, isTeamlead } from '@/lib/permissions';
import { fetchPayrollMonthClosed } from '@/lib/payrollData';
import type { Attendance, AttendanceSession, DailyAssignment, LeaveRequest, Profile } from '@/types';

/** Một ô ngày trên bảng công. */
interface DayCell {
  /** Giờ công đã chốt; null khi không có mặt. */
  hours: number | null;
  /** Giờ checkout muộn nhất trong ngày, hiển thị theo mẫu bảng công tháng. */
  checkoutTime: string | null;
  /** Bản ghi chấm công của ô này (bản có giờ ra muộn nhất) — để sửa tay. */
  recordId: string | null;
  checkInTime: string | null;
  /** Có check-in nhưng chưa/không check-out — vẫn tính ngày công, giờ = 0. */
  missingCheckout: boolean;
  /** Có check-out nhưng chưa có check-in (chờ máy chấm công) — hiển thị màu xám. */
  missingCheckIn: boolean;
  /** Nằm trong đơn nghỉ phép đã duyệt (chỉ tính ngày thường, trừ T7/CN). */
  onLeave: boolean;
  /** Đơn nghỉ nửa ngày — vẫn là ngày có phép nhưng chỉ tính 0.5 công. */
  halfLeave: boolean;
}

interface EmployeeRow {
  profile: Profile;
  days: DayCell[];
  workDays: number;
  totalHours: number;
  leaveDays: number;
  asgTotal: number;
  asgDone: number;
}

/** Bản ghi chấm công chưa vào bảng công chính thức: đang làm, thiếu checkout hoặc chưa được duyệt. */
type PendingRecord = Pick<Attendance, 'id' | 'user_id' | 'date' | 'status' | 'approved_by_lead' | 'check_in_time' | 'check_out_time'>;

/** Ô đang được sửa tay. `recordId` rỗng nghĩa là chưa có bản ghi nào, sẽ thêm mới. */
interface EditTarget {
  profile: Profile;
  date: string;
  recordId: string | null;
  oldCheckIn: string | null;
  oldCheckOut: string | null;
  checkIn: string;
  checkOut: string;
  reason: string;
}

const clock = (iso: string | null) => (iso ? format(new Date(iso), 'HH:mm') : '');

type PeriodStatus = 'OPEN' | 'REVIEW' | 'LOCKED';
const PERIOD_ORDER: PeriodStatus[] = ['OPEN', 'REVIEW', 'LOCKED'];
const PERIOD_LABEL: Record<PeriodStatus, string> = { OPEN: 'Đang mở', REVIEW: 'Đang đối soát', LOCKED: 'Đã khóa' };
const PAGE_SIZE = 50;
interface TimesheetPeriod { id: string; month_start: string; status: PeriodStatus; locked_at: string | null }

const hoursBetween = (a: Attendance, sessionsByAttendance: Map<string, AttendanceSession[]>): number => {
  const ownSessions = (sessionsByAttendance.get(a.id) ?? []).filter((session) => session.ended_at);
  const milliseconds = ownSessions.length > 0
    ? ownSessions.reduce((sum, session) => sum + Math.max(0, new Date(session.ended_at!).getTime() - new Date(session.started_at).getTime()), 0)
    : a.check_in_time && a.check_out_time ? new Date(a.check_out_time).getTime() - new Date(a.check_in_time).getTime() : 0;
  return Math.round((milliseconds / 3600000) * 10) / 10;
};

/** Máy chủ cắt mỗi lần trả về ở 1.000 dòng; bảng công cả tháng vượt mức đó nên phải đọc nhiều trang. */
const FETCH_PAGE = 1000;
async function fetchAllRows<T = any>(
  page: (from: number, to: number) => PromiseLike<{ data: any; error: PostgrestError | null }>,
): Promise<{ data: T[]; error: PostgrestError | null }> {
  const all: T[] = [];
  for (let from = 0; ; from += FETCH_PAGE) {
    const { data, error } = await page(from, from + FETCH_PAGE - 1);
    if (error) return { data: all, error };
    all.push(...((data as unknown as T[]) ?? []));
    if (!data || data.length < FETCH_PAGE) return { data: all, error: null };
  }
}

/** Tải session theo lô 150 id để tận dụng index attendance_id và không làm tràn độ dài URL */
async function fetchSessionsForAttendance(attendanceIds: string[]): Promise<AttendanceSession[]> {
  if (attendanceIds.length === 0) return [];
  const CHUNK_SIZE = 150;
  const chunks: string[][] = [];
  for (let i = 0; i < attendanceIds.length; i += CHUNK_SIZE) {
    chunks.push(attendanceIds.slice(i, i + CHUNK_SIZE));
  }
  const results = await Promise.all(
    chunks.map((chunk) =>
      supabase
        .from('attendance_sessions')
        .select('id, attendance_id, user_id, started_at, ended_at')
        .in('attendance_id', chunk),
    ),
  );
  return results.flatMap((res) => (res.data || []) as AttendanceSession[]);
}

interface TimesheetRowProps {
  row: EmployeeRow;
  visibleDays: number[];
  weekendFlags: boolean[];
  todayIdx: number;
  standardHours: number;
  canEdit: boolean;
  canManage?: boolean;
  onEditCell: (person: Profile, dayIndex: number, cell: DayCell) => void;
}

/**
 * Một dòng nhân sự (~35 ô). Bọc `memo` với props ổn định: gõ ô lọc, mở hộp thoại, cuộn...
 * làm trang vẽ lại nhưng dòng nào dữ liệu không đổi thì React bỏ qua, không dựng lại hàng nghìn ô.
 */
const TimesheetRow = memo(function TimesheetRow({
  row: r, visibleDays, weekendFlags, todayIdx, standardHours, canEdit, canManage = canEdit, onEditCell,
}: TimesheetRowProps) {
  return (
    <tr className="group transition-colors hover:bg-slate-100/80 dark:hover:bg-slate-800/60">
      <td className="sticky left-0 z-10 w-[150px] min-w-[150px] max-w-[150px] bg-white dark:bg-slate-900 px-2.5 py-1 group-hover:bg-slate-100/80 dark:group-hover:bg-slate-800/80 border-r-2 border-slate-400 dark:border-slate-600 shadow-[2px_0_4px_-1px_rgba(0,0,0,0.06)] dark:shadow-[2px_0_4px_-1px_rgba(0,0,0,0.4)]">
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-black text-slate-900 dark:text-slate-100" title={r.profile.name}>{r.profile.name}</p>
          <p className="truncate text-[10px] font-semibold text-slate-500 dark:text-slate-400" title={r.profile.department || 'Chưa phân phòng ban'}>{r.profile.department || '—'}</p>
        </div>
      </td>
      {visibleDays.map((i) => {
        const d = r.days[i];
        const enough = (d.hours ?? 0) >= standardHours;
        const tone = d.missingCheckIn ? 'bg-slate-300 text-slate-800 dark:bg-slate-700 dark:text-slate-200'
          : d.missingCheckout ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
          : d.checkoutTime ? (enough ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300' : 'bg-orange-100 text-orange-800 dark:bg-orange-950/60 dark:text-orange-300')
          : d.onLeave ? 'bg-violet-100 text-violet-800 dark:bg-violet-950/60 dark:text-violet-300'
          : weekendFlags[i] ? 'bg-slate-100/80 dark:bg-slate-800/50' : '';
        return (
          <td
            key={i}
            title={[
              d.missingCheckIn ? `Ra ${formatTime(d.checkoutTime)} · Chưa check-in (chờ máy chấm công)`
                : d.missingCheckout ? `Vào ${formatTime(d.checkInTime)} · thiếu check-out`
                : d.checkoutTime ? `Vào ${formatTime(d.checkInTime)} · Ra ${formatTime(d.checkoutTime)} · ${d.hours ?? 0} giờ công`
                : d.onLeave ? (d.halfLeave ? 'Nghỉ phép nửa ngày (đã duyệt)' : 'Nghỉ phép đã duyệt') : '',
              canEdit ? 'Bấm để sửa giờ vào / ra' : canManage ? 'Bấm để xem chi tiết giờ vào / ra (chỉ xem)' : '',
            ].filter(Boolean).join('\n') || undefined}
            onClick={canManage ? () => onEditCell(r.profile, i, d) : undefined}
            className={`border-l border-slate-300 dark:border-slate-700 px-0 py-1 text-center text-[11px] font-black ${tone} ${i === todayIdx ? 'shadow-[inset_2px_0_0_#4f46e5,inset_-2px_0_0_#4f46e5]' : ''} ${canManage ? 'cursor-pointer hover:ring-2 hover:ring-inset hover:ring-indigo-400' : ''}`}
          >
            {d.missingCheckIn ? (
              d.checkoutTime ? formatTime(d.checkoutTime) : '—'
            ) : d.missingCheckout ? '!'
              : d.checkoutTime ? formatTime(d.checkoutTime)
              : d.onLeave ? (d.halfLeave ? '½' : 'P')
              : <span className="text-[11px] font-normal text-slate-300 dark:text-slate-600">·</span>}
          </td>
        );
      })}
      <td className="border-l border-slate-300 dark:border-slate-700 px-1 py-1 text-center font-black text-xs text-slate-900 dark:text-slate-100">{r.workDays}</td>
      <td className="border-l border-slate-300 dark:border-slate-700 px-1 py-1 text-center font-black text-xs text-slate-900 dark:text-slate-100">{r.totalHours}</td>
      <td className="border-l border-slate-300 dark:border-slate-700 px-1 py-1 text-center font-black text-xs text-violet-700 dark:text-violet-400">{r.leaveDays || '—'}</td>
      <td className="border-l border-slate-300 dark:border-slate-700 px-1.5 py-1 text-center font-black text-xs">
        {r.asgTotal > 0 ? (
          <span className={r.asgDone === r.asgTotal ? 'font-black text-emerald-700 dark:text-emerald-400' : 'font-black text-amber-700 dark:text-amber-400'}>
            {r.asgDone}/{r.asgTotal}
          </span>
        ) : (
          <span className="text-slate-400 dark:text-slate-600">—</span>
        )}
      </td>
    </tr>
  );
});

export function AdminTimesheet() {
  const { profile } = useAuth();
  const { toast } = useToast();
  /** Ngưỡng "công đủ" để tô màu ô — lấy từ Cấu hình, trước đây viết cứng 8. */
  const { standardHoursPerDay } = useAppSettings();
  const [monthStart, setMonthStart] = useState(() => startOfMonth(new Date()));
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [attendance, setAttendance] = useState<Attendance[]>([]);
  const [sessions, setSessions] = useState<AttendanceSession[]>([]);
  const [leaves, setLeaves] = useState<LeaveRequest[]>([]);
  const [assignments, setAssignments] = useState<DailyAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [period, setPeriod] = useState<TimesheetPeriod | null>(null);
  const [periodSupported, setPeriodSupported] = useState(true);
  const [pending, setPending] = useState<PendingRecord[]>([]);
  const [unitFilter, setUnitFilter] = useState('');
  const [personFilter, setPersonFilter] = useState('');
  const [page, setPage] = useState(0);
  const [warningsOpen, setWarningsOpen] = useState(false);
  const [edit, setEdit] = useState<EditTarget | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [full, setFull] = useState(false);
  const exitFull = useCallback(() => setFull(false), []);
  const [changingPeriod, setChangingPeriod] = useState(false);
  /** Chỉ hiện cột của hôm nay (chỉ có nghĩa khi đang xem tháng hiện tại). */
  const [todayOnly, setTodayOnly] = useState(false);
  /** Kỳ lương tháng này đã khoá — kỳ công không được mở lại nữa (BR-PAY-009). */
  const [payrollClosed, setPayrollClosed] = useState(false);

  const monthEndStr = toDateString(endOfMonth(monthStart));
  const monthStartStr = toDateString(monthStart);
  const daysInMonth = getDaysInMonth(monthStart);
  const monthLabel = format(monthStart, 'MM/yyyy');
  const now = new Date();
  /** Chỉ số cột (0-based) của hôm nay trong tháng đang xem; -1 nếu đang xem tháng khác. */
  const todayIdx = format(monthStart, 'yyyy-MM') === format(now, 'yyyy-MM') ? now.getDate() - 1 : -1;
  const todayLabel = `${['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'][now.getDay()]}, ${format(now, 'dd/MM/yyyy')}`;

  /** Mỗi lần nạp có một số thứ tự; phản hồi của lần cũ (đổi tháng nhanh) bị bỏ, không ghi đè dữ liệu tháng mới. */
  const loadSeq = useRef(0);

  const loadData = async (silent = false) => {
    const seq = ++loadSeq.current;
    if (!silent) setLoading(true);

    const [profRes, attRes, leaveRes, asgRes, periodRes, exceptionRes] = await Promise.all([
      supabase.from('profiles_directory').select('*').eq('is_active', true).order('name'),
      // Bảng công chính thức dùng cùng tập dữ liệu với Payroll.
      fetchAllRows<Attendance>((from, to) => supabase
        .from('attendance')
        .select('id, user_id, date, status, approved_by_lead, check_in_time, check_out_time')
        .eq('status', 'completed').eq('approved_by_lead', true)
        .gte('date', monthStartStr).lte('date', monthEndStr)
        .range(from, to)),
      supabase
        .from('leave_requests')
        .select('*')
        .eq('status', 'approved')
        .lte('start_date', monthEndStr)
        .gte('end_date', monthStartStr),
      supabase
        .from('daily_assignments')
        .select('user_id, work_date, status')
        .gte('work_date', monthStartStr)
        .lte('work_date', monthEndStr),
      supabase.from('timesheet_periods').select('id, month_start, status, locked_at').eq('month_start', monthStartStr).maybeSingle(),
      supabase.from('attendance').select('id, user_id, date, status, approved_by_lead, check_in_time, check_out_time').gte('date', monthStartStr).lte('date', monthEndStr).or('status.eq.active,approved_by_lead.eq.false,check_out_time.is.null'),
    ]);

    if (seq !== loadSeq.current) return;

    const attendanceRows = attRes.data || [];
    // Tải session theo các ID chấm công trong tháng, chia lô 150 để dùng đúng index mà không dài URL
    const sessionRows = await fetchSessionsForAttendance(attendanceRows.map((r) => r.id));

    if (seq !== loadSeq.current) return;

    setLoadError(
      describeDbErrorOrNull(profRes.error)
        ?? describeDbErrorOrNull(attRes.error)
        ?? describeDbErrorOrNull(leaveRes.error)
        ?? describeDbErrorOrNull(asgRes.error),
    );
    setProfiles((profRes.data || []) as Profile[]);
    setAttendance(attendanceRows);
    setSessions(sessionRows);
    setLeaves(((leaveRes.data || []) as LeaveRequest[]).filter((leave) => !leave.is_cancelled));
    setAssignments((asgRes.data || []) as DailyAssignment[]);
    setPeriod((periodRes.data as TimesheetPeriod | null) ?? null);
    setPeriodSupported(!periodRes.error);
    setPending((exceptionRes.data || []) as PendingRecord[]);
    setLoading(false);
  };

  useEffect(() => { loadData(); }, [monthStartStr]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    let cancelled = false;
    void fetchPayrollMonthClosed(monthStartStr).then((closed) => { if (!cancelled) setPayrollClosed(closed); });
    return () => { cancelled = true; };
  }, [monthStartStr]);

  useRealtimeSync(
    [{ table: 'attendance' }, { table: 'leave_requests' }, { table: 'daily_assignments' }, { table: 'timesheet_periods' }],
    () => loadData(true),
    { channelKey: 'timesheet', delayMs: 1500 },
  );

  /** Ngày (Date) của cột thứ i, 0-based. */
  const dayDate = (i: number) => new Date(monthStart.getFullYear(), monthStart.getMonth(), i + 1);
  const isWeekend = (i: number) => [0, 6].includes(dayDate(i).getDay());
  /** Các cột ngày đang hiển thị: cả tháng, hoặc riêng hôm nay khi bật bộ lọc. */
  const visibleDays = useMemo(
    () => (todayOnly && todayIdx >= 0 ? [todayIdx] : Array.from({ length: daysInMonth }, (_, i) => i)),
    [todayOnly, todayIdx, daysInMonth],
  );
  const weekendFlags = useMemo(
    () => Array.from({ length: daysInMonth }, (_, i) => [0, 6].includes(new Date(monthStart.getFullYear(), monthStart.getMonth(), i + 1).getDay())),
    [daysInMonth, monthStart],
  );
  const showToday = () => {
    setMonthStart(startOfMonth(new Date()));
    setPage(0);
    setTodayOnly((value) => !value);
  };

  const sessionsByAttendance = useMemo(() => {
    const map = new Map<string, AttendanceSession[]>();
    for (const session of sessions) {
      const list = map.get(session.attendance_id);
      if (list) list.push(session); else map.set(session.attendance_id, [session]);
    }
    return map;
  }, [sessions]);

  const rows: EmployeeRow[] = useMemo(() => {
    // Tính một lần cho cả bảng thay vì lặp lại theo từng nhân viên × đơn phép × ngày.
    const dayStrs = Array.from({ length: daysInMonth }, (_, i) => toDateString(dayDate(i)));
    const weekend = Array.from({ length: daysInMonth }, (_, i) => isWeekend(i));

    // Nhóm trước theo user_id để tra cứu O(1) thay vì O(N nhân sự × N chấm công / việc)
    const attByUserId = new Map<string, Attendance[]>();
    for (const a of attendance) {
      const list = attByUserId.get(a.user_id);
      if (list) list.push(a); else attByUserId.set(a.user_id, [a]);
    }
    // Ghép thêm bản ghi chờ/thiếu (đang làm, thiếu checkout, thiếu checkin) vào bảng công
    for (const p of pending) {
      if (!attendance.some((a) => a.id === p.id)) {
        const list = attByUserId.get(p.user_id);
        const item = p as Attendance;
        if (list) list.push(item); else attByUserId.set(p.user_id, [item]);
      }
    }
    const leavesByUserId = new Map<string, LeaveRequest[]>();
    for (const lv of leaves) {
      const list = leavesByUserId.get(lv.user_id);
      if (list) list.push(lv); else leavesByUserId.set(lv.user_id, [lv]);
    }
    const asgStatsByUserId = new Map<string, { total: number; done: number }>();
    for (const asg of assignments) {
      const cur = asgStatsByUserId.get(asg.user_id) ?? { total: 0, done: 0 };
      cur.total++;
      if (asg.status === 'approved') cur.done++;
      asgStatsByUserId.set(asg.user_id, cur);
    }

    return profiles.map((profile) => {
      const days: DayCell[] = Array.from({ length: daysInMonth }, () => ({
        hours: null,
        checkoutTime: null,
        recordId: null,
        checkInTime: null,
        missingCheckout: false,
        missingCheckIn: false,
        onLeave: false,
        halfLeave: false,
      }));

      // Nghỉ phép duyệt: đánh dấu ngày thường trong khoảng đơn
      const userLeaves = leavesByUserId.get(profile.id);
      if (userLeaves) {
        for (const lv of userLeaves) {
          for (let i = 0; i < daysInMonth; i++) {
            const ds = dayStrs[i];
            if (ds >= lv.start_date && ds <= lv.end_date && !weekend[i]) {
              days[i].onLeave = true;
              if (lv.half_day) days[i].halfLeave = true;
            }
          }
        }
      }

      // Điểm danh trong tháng của nhân sự
      const userAtt = attByUserId.get(profile.id);
      if (userAtt) {
        for (const a of userAtt) {
          const idx = Number(a.date.slice(8, 10)) - 1;
          if (idx < 0 || idx >= daysInMonth) continue;
          if (a.check_in_time && a.check_out_time) {
            days[idx].hours = (days[idx].hours ?? 0) + hoursBetween(a, sessionsByAttendance);
            if (!days[idx].checkoutTime || a.check_out_time > days[idx].checkoutTime!) {
              days[idx].checkoutTime = a.check_out_time;
              days[idx].recordId = a.id;
              days[idx].checkInTime = a.check_in_time;
            }
            days[idx].missingCheckIn = false;
            days[idx].missingCheckout = false;
          } else if (a.check_in_time) {
            days[idx].hours ??= 0;
            days[idx].missingCheckout = true;
            if (!days[idx].recordId) { days[idx].recordId = a.id; days[idx].checkInTime = a.check_in_time; }
          } else if (a.check_out_time) {
            // Check-out khi chưa check-in: hiển thị ô màu xám
            days[idx].missingCheckIn = true;
            if (!days[idx].checkoutTime || a.check_out_time > days[idx].checkoutTime!) {
              days[idx].checkoutTime = a.check_out_time;
              days[idx].recordId = a.id;
            }
          }
        }
      }

      const myAsg = asgStatsByUserId.get(profile.id) ?? { total: 0, done: 0 };
      return {
        profile,
        days,
        workDays: Math.round(days.reduce((s, d, i) => {
          if (d.hours === null) return s;
          const dow = dayDate(i).getDay();
          if (dow === 6) return s + 0.5;
          if (d.halfLeave) return s + 0.5;
          return s + 1;
        }, 0) * 10) / 10,
        totalHours: Math.round(days.reduce((s, d) => s + (d.hours ?? 0), 0) * 10) / 10,
        leaveDays: days.reduce((s, d) => s + (d.onLeave ? (d.halfLeave ? 0.5 : 1) : 0), 0),
        asgTotal: myAsg.total,
        asgDone: myAsg.done,
      };
    });
  }, [profiles, attendance, pending, sessionsByAttendance, leaves, assignments, daysInMonth]); // eslint-disable-line react-hooks/exhaustive-deps

  const departments = useMemo(
    () => [...new Set(profiles.map((person) => person.department?.trim()).filter((name): name is string => !!name))]
      .sort((a, b) => a.localeCompare(b, 'vi')),
    [profiles],
  );
  const keyword = normalizeText(personFilter);
  const filtered = useMemo(
    () => rows
      .filter((row) => !unitFilter || row.profile.department?.trim() === unitFilter)
      .filter((row) => !keyword || normalizeText(`${row.profile.name} ${row.profile.employee_code ?? ''}`).includes(keyword))
      .sort((a, b) => a.profile.name.localeCompare(b.profile.name, 'vi')),
    [keyword, rows, unitFilter],
  );
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const pageRows = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

  /** Tổng theo bộ lọc đang chọn. */
  const totals = useMemo(
    () => ({
      workDays: Math.round(filtered.reduce((s, r) => s + r.workDays, 0) * 10) / 10,
      totalHours: Math.round(filtered.reduce((s, r) => s + r.totalHours, 0) * 10) / 10,
      leaveDays: Math.round(filtered.reduce((s, r) => s + r.leaveDays, 0) * 10) / 10,
      asgTotal: filtered.reduce((s, r) => s + r.asgTotal, 0),
      asgDone: filtered.reduce((s, r) => s + r.asgDone, 0),
    }),
    [filtered],
  );
  /** Tổng toàn công ty — dùng cho file xuất chính thức, không phụ thuộc bộ lọc. */
  const companyTotals = useMemo(
    () => ({
      workDays: Math.round(rows.reduce((s, r) => s + r.workDays, 0) * 10) / 10,
      totalHours: Math.round(rows.reduce((s, r) => s + r.totalHours, 0) * 10) / 10,
      leaveDays: Math.round(rows.reduce((s, r) => s + r.leaveDays, 0) * 10) / 10,
      asgTotal: rows.reduce((s, r) => s + r.asgTotal, 0),
      asgDone: rows.reduce((s, r) => s + r.asgDone, 0),
    }),
    [rows],
  );

  const periodStatus: PeriodStatus = period?.status ?? 'OPEN';
  const exceptions = pending.length;

  const warnings = useMemo(() => {
    const nameById = new Map(profiles.map((person) => [person.id, person.name]));
    const list = [...pending]
      .sort((a, b) => a.date.localeCompare(b.date) || (nameById.get(a.user_id) ?? '').localeCompare(nameById.get(b.user_id) ?? '', 'vi'))
      .map((record) => {
        const reason = !record.check_in_time && record.check_out_time
          ? 'có giờ ra, chưa check-in (chờ máy chấm công)'
          : record.status === 'active' && !record.check_out_time
          ? 'đang làm, chưa check-out'
          : !record.check_out_time ? 'thiếu check-out' : 'quản lý chưa duyệt';
        return `${nameById.get(record.user_id) ?? 'Người dùng đã nghỉ'} — ${record.date.slice(8, 10)}/${record.date.slice(5, 7)}: ${reason}`;
      });
    if (!periodSupported) list.unshift('Cơ sở dữ liệu chưa có phần quản lý kỳ công — chưa đối soát và khoá kỳ được. Liên hệ quản trị hệ thống để cập nhật.');
    return list;
  }, [pending, periodSupported, profiles]);

  const { scrollRef, edge, updateEdge, scrollColumns } = useColumnScroll([daysInMonth, visibleDays.length, pageRows.length, rows.length, full]);

  const setPeriodStatus = async (status: PeriodStatus) => {
    if (status === 'LOCKED' && exceptions > 0) {
      toast(`Còn ${exceptions} bản ghi thiếu checkout, đang làm hoặc chưa duyệt. Hãy xử lý trước khi khóa kỳ.`, 'warning');
      return;
    }
    setChangingPeriod(true);
    const { error } = await supabase.from('timesheet_periods').upsert({
      month_start: monthStartStr,
      status,
    }, { onConflict: 'month_start' });
    setChangingPeriod(false);
    if (error) toast('Không đổi được trạng thái kỳ công: ' + describeDbError(error), 'error');
    else {
      toast(status === 'LOCKED' ? 'Đã khóa kỳ công. Payroll có thể xuất chính thức.' : status === 'REVIEW' ? 'Đã chuyển kỳ công sang đối soát.' : 'Đã mở lại kỳ công.', 'success');
      loadData(true);
    }
  };

  /** Kỳ công đã khoá thì giờ vào/ra không sửa nữa — sai sót xử lý bằng Điều chỉnh lương kỳ sau. */
  const canManage = hasAdminFunction(profile, 'admin.timesheet_lock') || isTeamlead(profile);
  const isLocked = periodStatus === 'LOCKED';
  const canEdit = canManage && !isLocked;

  const openEdit = (person: Profile, dayIndex: number, cell: DayCell) => {
    if (!canManage) return;
    const date = toDateString(dayDate(dayIndex));
    // Ngày chưa có công nhưng có bản ghi chưa duyệt / thiếu giờ ra: sửa chính bản ghi đó, không thêm bản thứ hai.
    const waiting = cell.recordId ? null : pending.find((record) => record.user_id === person.id && record.date === date) ?? null;
    const recordId = cell.recordId ?? waiting?.id ?? null;
    const oldCheckIn = cell.recordId ? cell.checkInTime : waiting?.check_in_time ?? null;
    const oldCheckOut = cell.recordId ? cell.checkoutTime : waiting?.check_out_time ?? null;
    setEdit({
      profile: person, date, recordId, oldCheckIn, oldCheckOut,
      checkIn: clock(oldCheckIn), checkOut: clock(oldCheckOut), reason: '',
    });
  };

  // openEdit được tạo lại mỗi lần render; giữ nó trong ref để hàm truyền xuống dòng luôn cùng một tham chiếu.
  const openEditRef = useRef(openEdit);
  openEditRef.current = openEdit;
  const onEditCell = useCallback(
    (person: Profile, dayIndex: number, cell: DayCell) => openEditRef.current(person, dayIndex, cell),
    [],
  );

  const saveEdit = async () => {
    if (!edit || !profile) return;
    const checkIn = new Date(`${edit.date}T${edit.checkIn}:00`);
    const checkOut = new Date(`${edit.date}T${edit.checkOut}:00`);
    if (Number.isNaN(checkIn.getTime()) || Number.isNaN(checkOut.getTime())) return toast('Nhập đủ giờ vào và giờ ra.', 'warning');
    if (checkOut.getTime() <= checkIn.getTime()) return toast('Giờ ra phải sau giờ vào.', 'warning');
    setSavingEdit(true);
    const stamp = {
      check_in_time: checkIn.toISOString(),
      check_out_time: checkOut.toISOString(),
      status: 'completed',
      approved_by_lead: true,
      approved_at: new Date().toISOString(),
      approved_by_user_id: profile.id,
    };
    let attendanceId = edit.recordId;
    let failure: string | null = null;
    if (edit.recordId) {
      const { error } = await supabase.from('attendance').update(stamp).eq('id', edit.recordId);
      if (error) failure = describeDbError(error);
    } else {
      const { data: created, error } = await supabase.from('attendance')
        .insert({ ...stamp, user_id: edit.profile.id, date: edit.date, check_in_method: 'MANUAL', anomaly_flags: [] })
        .select('id').single();
      if (error) failure = describeDbError(error);
      else attendanceId = (created as { id: string }).id;
    }
    if (failure) {
      setSavingEdit(false);
      return toast('Không sửa được giờ chấm công: ' + failure, 'error');
    }
    const { error: logError } = await supabase.from('attendance_edit_logs').insert({
      attendance_id: attendanceId,
      user_id: edit.profile.id,
      work_date: edit.date,
      action: edit.recordId ? 'UPDATE' : 'CREATE',
      old_check_in: edit.oldCheckIn,
      old_check_out: edit.oldCheckOut,
      new_check_in: stamp.check_in_time,
      new_check_out: stamp.check_out_time,
      reason: edit.reason.trim(),
      actor_id: profile.id,
    });
    setSavingEdit(false);
    setEdit(null);
    toast(
      logError ? 'Đã lưu giờ chấm công nhưng chưa ghi được nhật ký sửa: ' + describeDbError(logError) : 'Đã lưu giờ vào / giờ ra.',
      logError ? 'warning' : 'success',
    );
    loadData(true);
  };

  // --------------------------------------------------------------------------
  // Xuất Excel — 3 sheet: Bảng công / Chi tiết chấm công / Công việc.
  // Thư viện nạp động để không phình bundle chính (~400KB chỉ ai bấm mới tải).
  // --------------------------------------------------------------------------
  const handleExport = async () => {
    setExporting(true);
    try {
      const XLSX = await import('xlsx');

      // ---- Sheet 1: Bảng công ------------------------------------------------
      const dayHeaders = Array.from({ length: daysInMonth }, (_, i) => String(i + 1));
      const sheet1: (string | number)[][] = [
        [`BẢNG CÔNG THÁNG ${monthLabel}`],
        [`Ký hiệu: HH:mm = giờ checkout cuối ngày (ô xám: chưa check-in) · P = nghỉ phép · P/2 = nghỉ nửa ngày · ! = thiếu checkout · trống = vắng`],
        [],
        ['STT', 'Phòng ban', 'Mã nhân viên', 'Tên nhân viên', ...dayHeaders, 'Ngày công', 'Giờ công', 'Nghỉ phép', 'Việc xong/giao'],
        ...rows.map((r, i) => [
          i + 1,
          r.profile.department ?? '',
          r.profile.employee_code ?? '',
          r.profile.name,
          ...r.days.map((d) =>
            d.missingCheckIn ? (d.checkoutTime ? formatTime(d.checkoutTime) : '—') : d.missingCheckout ? '!' : d.checkoutTime ? formatTime(d.checkoutTime) : d.onLeave ? (d.halfLeave ? 'P/2' : 'P') : '',
          ),
          r.workDays,
          r.totalHours,
          r.leaveDays,
          `${r.asgDone}/${r.asgTotal}`,
        ]),
        [],
        ['', 'TỔNG', '', '', ...dayHeaders.map(() => ''), companyTotals.workDays, companyTotals.totalHours, companyTotals.leaveDays, `${companyTotals.asgDone}/${companyTotals.asgTotal}`],
      ];
      const ws1 = XLSX.utils.aoa_to_sheet(sheet1);
      ws1['!merges'] = [
        { s: { r: 0, c: 0 }, e: { r: 0, c: dayHeaders.length + 7 } },
        { s: { r: 1, c: 0 }, e: { r: 1, c: dayHeaders.length + 7 } },
      ];
      ws1['!cols'] = [
        { wch: 6 }, { wch: 20 }, { wch: 14 }, { wch: 24 },
        ...dayHeaders.map(() => ({ wch: 8 })),
        { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 15 },
      ];
      ws1['!rows'] = [{ hpt: 26 }, { hpt: 18 }, { hpt: 10 }, { hpt: 24 }];
      ws1['!views'] = [{ state: 'frozen', ySplit: 4 }];
      ws1['!autofilter'] = {
        ref: XLSX.utils.encode_range({
          s: { r: 3, c: 0 },
          e: { r: Math.max(3, sheet1.length - 3), c: dayHeaders.length + 7 },
        }),
      };

      // ---- Sheet 2: Chi tiết chấm công --------------------------------------
      const nameById = new Map(profiles.map((p) => [p.id, p.name]));
      const allAtt = [...attendance];
      for (const p of pending) {
        if (!allAtt.some((a) => a.id === p.id)) allAtt.push(p as Attendance);
      }
      const detail = allAtt.sort((a, b) => a.date.localeCompare(b.date) || (nameById.get(a.user_id) ?? '').localeCompare(nameById.get(b.user_id) ?? ''));
      const sheet2: (string | number)[][] = [
        [`CHI TIẾT CHẤM CÔNG THÁNG ${monthLabel}`],
        [],
        ['STT', 'Họ tên', 'Ngày', 'Check-in', 'Check-out', 'Giờ công', 'Trạng thái', 'Quản lý duyệt'],
        ...detail.map((a, i) => [
          i + 1,
          nameById.get(a.user_id) ?? '—',
          a.date,
          a.check_in_time ? formatTime(a.check_in_time) : 'THIẾU',
          a.check_out_time ? formatTime(a.check_out_time) : 'THIẾU',
          hoursBetween(a, sessionsByAttendance),
          a.status === 'completed' ? 'Hoàn thành' : 'Đang làm',
          a.approved_by_lead ? 'Đã duyệt' : 'Chưa',
        ]),
      ];
      const ws2 = XLSX.utils.aoa_to_sheet(sheet2);
      ws2['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 7 } }];
      ws2['!cols'] = [{ wch: 6 }, { wch: 24 }, { wch: 14 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 14 }];
      ws2['!rows'] = [{ hpt: 26 }, { hpt: 10 }, { hpt: 24 }];
      ws2['!views'] = [{ state: 'frozen', ySplit: 3 }];
      ws2['!autofilter'] = {
        ref: XLSX.utils.encode_range({
          s: { r: 2, c: 0 },
          e: { r: Math.max(2, sheet2.length - 1), c: 7 },
        }),
      };

      // ---- Sheet 3: Công việc giao theo ngày --------------------------------
      const sheet3: (string | number)[][] = [
        [`CÔNG VIỆC GIAO THEO NGÀY — THÁNG ${monthLabel}`],
        [],
        ['STT', 'Họ tên', 'Được giao', 'Đã xác nhận', 'Chờ xác nhận', 'Cần làm lại', 'Tỷ lệ hoàn thành'],
        ...rows
          .filter((r) => r.asgTotal > 0)
          .map((r, i) => {
            const mine = assignments.filter((a) => a.user_id === r.profile.id);
            return [
              i + 1,
              r.profile.name,
              r.asgTotal,
              r.asgDone,
              mine.filter((a) => a.status === 'submitted').length,
              mine.filter((a) => a.status === 'rejected').length,
              `${Math.round((r.asgDone / r.asgTotal) * 100)}%`,
            ];
          }),
      ];
      const ws3 = XLSX.utils.aoa_to_sheet(sheet3);
      ws3['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 6 } }];
      ws3['!cols'] = [{ wch: 6 }, { wch: 24 }, { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 18 }];
      ws3['!rows'] = [{ hpt: 26 }, { hpt: 10 }, { hpt: 24 }];
      ws3['!views'] = [{ state: 'frozen', ySplit: 3 }];
      ws3['!autofilter'] = {
        ref: XLSX.utils.encode_range({
          s: { r: 2, c: 0 },
          e: { r: Math.max(2, sheet3.length - 1), c: 6 },
        }),
      };

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws1, 'Bảng công checkout');
      XLSX.utils.book_append_sheet(wb, ws2, 'Chi tiết chấm công');
      XLSX.utils.book_append_sheet(wb, ws3, 'Công việc');
      XLSX.writeFile(wb, `bang-cong-${format(monthStart, 'yyyy-MM')}.xlsx`);

      toast(`Đã xuất bảng công tháng ${monthLabel} (3 sheet).`, 'success');
    } catch (e) {
      toast('Xuất Excel thất bại: ' + (e instanceof Error ? e.message : String(e)), 'error');
    }
    setExporting(false);
  };

  // --------------------------------------------------------------------------
  if (loading) {
    return <div className="bg-white border border-slate-200 rounded-2xl p-5"><TableSkeleton rows={6} /></div>;
  }
  if (loadError) {
    return <div className="bg-white border border-slate-200 rounded-2xl"><ErrorState message={loadError} onRetry={loadData} /></div>;
  }

  const canLock = periodSupported && hasAdminFunction(profile, 'admin.timesheet_lock');
  const thBase = 'sticky top-0 z-20 border-l border-[#eed5d8] dark:border-[#4a1c22] shadow-[inset_0_-2px_0_#bf1f2b] dark:shadow-[inset_0_-2px_0_#e66a76] font-black text-xs uppercase tracking-wider whitespace-normal break-words leading-tight bg-[#fdf2f4] dark:bg-[#201114] text-[#5c0f16] dark:text-[#fde8ea]';
  const tfBase = 'border-l border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-900 shadow-[inset_0_2px_0_#94a3b8] dark:shadow-[inset_0_2px_0_#475569] font-black text-sm';

  return (
    <div className="space-y-5 timesheet-module" data-module="timesheet">
      <div className="flex flex-wrap items-center gap-1" role="status" aria-label={`Trạng thái kỳ công: ${PERIOD_LABEL[periodStatus]}`}>
        {PERIOD_ORDER.map((step, index) => {
          const current = PERIOD_ORDER.indexOf(periodStatus);
          return (
            <span key={step} className="flex items-center gap-1">
              {index > 0 && <span className={`h-px w-3 ${index <= current ? 'bg-indigo-300' : 'bg-slate-200'}`} />}
              <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${index === current
                ? 'bg-indigo-600 text-white'
                : index < current ? 'bg-indigo-50 text-indigo-700' : 'bg-slate-100 text-slate-400'}`}>
                {PERIOD_LABEL[step]}
              </span>
            </span>
          );
        })}
      </div>

      <div className="grid items-center gap-3 no-print lg:grid-cols-[1fr_auto_1fr]">
        <div className="flex flex-wrap items-center gap-2 lg:order-1">
          {canLock && periodStatus === 'OPEN' && (
            <Button onClick={() => setPeriodStatus('REVIEW')} disabled={changingPeriod}><ScanSearch className="h-4 w-4" /> Bắt đầu đối soát</Button>
          )}
          {canLock && periodStatus === 'REVIEW' && (
            <Button variant="success" onClick={() => setPeriodStatus('LOCKED')} disabled={changingPeriod || exceptions > 0}><Lock className="h-4 w-4" /> Khóa kỳ công</Button>
          )}
          {canLock && periodStatus === 'LOCKED' && !payrollClosed && (
            <Button variant="outline" onClick={() => setPeriodStatus('OPEN')} disabled={changingPeriod}><Unlock className="h-4 w-4" /> Mở lại kỳ</Button>
          )}
          {periodStatus === 'LOCKED' && payrollClosed && (
            <span className="inline-flex h-9 items-center gap-1.5 bg-slate-100 px-3 text-xs font-semibold text-slate-500" title="Kỳ lương tháng này đã khoá — sai sót chấm công xử lý bằng Điều chỉnh lương kỳ sau.">
              <Lock className="h-3.5 w-3.5" /> Kỳ lương đã khoá — không mở lại kỳ công
            </span>
          )}
          {warnings.length > 0 && (
            <Button variant="outline" size="sm" onClick={() => setWarningsOpen(true)}>
              <TriangleAlert className="h-3.5 w-3.5 text-amber-500" /> Cảnh báo
              <span className="rounded-full bg-amber-100 px-1.5 text-[11px] font-bold text-amber-800">{warnings.length}</span>
            </Button>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2 lg:order-2">
          <MonthNav value={monthStart} onChange={(value) => { setMonthStart(value); setPage(0); setTodayOnly(false); }} bare />
          <Button
            size="sm"
            variant={todayOnly ? 'primary' : 'outline'}
            onClick={showToday}
            aria-pressed={todayOnly}
            title={todayOnly ? 'Bấm để xem lại cả tháng' : `Chỉ xem cột của hôm nay (${todayLabel})`}
          >
            <CalendarDays className="h-3.5 w-3.5" /> Hôm nay
          </Button>
        </div>
        <Button className="lg:order-3 lg:justify-self-end" variant="outline" size="sm" onClick={handleExport} disabled={exporting || rows.length === 0 || periodStatus !== 'LOCKED'} title={periodStatus !== 'LOCKED' ? 'Khóa kỳ công trước khi xuất bản chính thức' : undefined}>
          <FileSpreadsheet className="h-3.5 w-3.5" /> {exporting ? 'Đang xuất…' : 'Xuất bảng công'}
        </Button>
      </div>

      <FullscreenPanel full={full} onExit={exitFull}>
        <TableShell full={full}>
          <div className="flex flex-wrap items-center gap-3 border-b border-slate-300 dark:border-slate-700 px-4 py-3 no-print">
            {full && <p className="w-full text-sm font-bold text-slate-800 dark:text-slate-100 sm:w-auto">Bảng công tháng {monthLabel}</p>}
            <div className="w-full sm:w-60">
              <Dropdown
                aria-label="Lọc theo phòng ban"
                value={unitFilter}
                searchable
                options={[{ value: '', label: 'Tất cả phòng ban' }, ...departments.map((name) => ({ value: name, label: name }))]}
                onChange={(value) => { setUnitFilter(value); setPage(0); }}
              />
            </div>
            <div className="relative w-full sm:w-72">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={personFilter}
                onChange={(event) => { setPersonFilter(event.target.value); setPage(0); }}
                placeholder="Lọc theo tên nhân viên…"
                aria-label="Lọc theo tên nhân viên"
                className="h-10 w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 pl-9 pr-3 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
              />
            </div>
            <span className="ml-auto text-xs font-semibold text-slate-500 dark:text-slate-400">{filtered.length}/{rows.length} nhân sự</span>
            <FullscreenToggle full={full} onToggle={() => setFull((value) => !value)} />
          </div>

          {rows.length === 0 ? (
            <EmptyState
              icon={<TableIcon className="h-8 w-8" />}
              title="Chưa có nhân sự"
              description="Tạo tài khoản trong Quản lý User rồi quay lại đây."
            />
          ) : (
            <div className={full ? 'relative flex min-h-0 flex-1 flex-col' : 'relative'}>
              <ScrollArrows edge={edge} onScroll={scrollColumns} stickyWidth={150} />
              <div ref={scrollRef} onScroll={updateEdge} className={scrollAreaClass(full)}>
                <table className="w-full whitespace-nowrap text-xs tabular-nums text-slate-900 dark:text-slate-100 border-collapse">
                  <thead>
                    <tr className="border-b-2 border-[#bf1f2b] dark:border-[#e66a76] bg-[#fdf2f4] dark:bg-[#201114] text-xs font-black text-[#5c0f16] dark:text-[#fde8ea]">
                      <th className="sticky left-0 top-0 z-30 w-[150px] min-w-[150px] max-w-[150px] bg-[#fdf2f4] dark:bg-[#201114] px-2.5 py-1.5 text-left border-r-2 border-[#eed5d8] dark:border-[#4a1c22] font-black uppercase tracking-wider text-[#5c0f16] dark:text-[#fde8ea] shadow-[inset_0_-2px_0_#bf1f2b] dark:shadow-[inset_0_-2px_0_#e66a76]">Nhân sự</th>
                      {visibleDays.map((i) => {
                        const isToday = i === todayIdx;
                        const isWk = weekendFlags[i];
                        const colTone = isToday
                          ? 'bg-[#bf1f2b] text-white font-black'
                          : isWk
                            ? 'bg-[#fae6e9] dark:bg-[#2a1418] text-[#85141d] dark:text-[#f39aa1] font-bold'
                            : 'bg-[#fdf2f4] dark:bg-[#201114] text-[#5c0f16] dark:text-[#fde8ea] font-bold';
                        return (
                          <th
                            key={i}
                            className={`${thBase} ${colTone} w-7 min-w-[1.75rem] px-0 py-1 text-center text-[11px] font-black`}
                            title={isToday ? `Hôm nay — ${todayLabel}` : undefined}
                          >
                            {i + 1}
                          </th>
                        );
                      })}
                      <th className={`${thBase} min-w-[38px] max-w-[48px] px-1 py-1 text-center`}><div className="min-w-[36px] text-center line-clamp-1">Công</div></th>
                      <th className={`${thBase} min-w-[38px] max-w-[48px] px-1 py-1 text-center`}><div className="min-w-[36px] text-center line-clamp-1">Giờ</div></th>
                      <th className={`${thBase} min-w-[38px] max-w-[48px] px-1 py-1 text-center`}><div className="min-w-[36px] text-center line-clamp-1">Phép</div></th>
                      <th className={`${thBase} min-w-[38px] max-w-[48px] px-1 py-1 text-center`}><div className="min-w-[36px] text-center line-clamp-1">Việc</div></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-300 dark:divide-slate-800 bg-white dark:bg-slate-900">
                    {pageRows.map((r) => (
                      <TimesheetRow
                        key={r.profile.id}
                        row={r}
                        visibleDays={visibleDays}
                        weekendFlags={weekendFlags}
                        todayIdx={todayIdx}
                        standardHours={standardHoursPerDay}
                        canEdit={canEdit}
                        canManage={canManage}
                        onEditCell={onEditCell}
                      />
                    ))}
                  </tbody>
                  <tfoot className="sticky bottom-0 z-20 bg-slate-100 dark:bg-slate-900 font-bold text-slate-900 dark:text-slate-100 border-t-2 border-slate-400 dark:border-slate-600 shadow-[0_-3px_6px_rgba(0,0,0,0.06)] dark:shadow-[0_-3px_6px_rgba(0,0,0,0.4)]">
                    <tr>
                      <td className="sticky left-0 z-10 w-[150px] min-w-[150px] max-w-[150px] bg-slate-100 dark:bg-slate-900 px-2.5 py-1.5 text-left text-xs font-black uppercase tracking-wider border-r-2 border-slate-400 dark:border-slate-600 shadow-[inset_0_2px_0_#94a3b8] dark:shadow-[inset_0_2px_0_#475569]">
                        Tổng ({filtered.length} người)
                      </td>
                      <td colSpan={visibleDays.length} className="bg-slate-100 dark:bg-slate-900 shadow-[inset_0_2px_0_#94a3b8] dark:shadow-[inset_0_2px_0_#475569]" />
                      <td className={`${tfBase} px-1 py-1.5 text-center font-black text-xs text-slate-900 dark:text-slate-100`}>{totals.workDays}</td>
                      <td className={`${tfBase} px-1 py-1.5 text-center font-black text-xs text-slate-900 dark:text-slate-100`}>{totals.totalHours}</td>
                      <td className={`${tfBase} px-1 py-1.5 text-center font-black text-xs text-violet-700 dark:text-violet-400`}>{totals.leaveDays || '—'}</td>
                      <td className={`${tfBase} px-1.5 py-1.5 text-center font-black text-xs text-slate-900 dark:text-slate-100`}>{totals.asgTotal > 0 ? `${totals.asgDone}/${totals.asgTotal}` : '—'}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-slate-300 dark:border-slate-700 px-4 py-2 text-xs font-semibold text-slate-700 dark:text-slate-300 no-print">
            <span className="flex items-center gap-1.5"><span className="flex h-4 items-center justify-center bg-emerald-100 px-1 text-[11px] font-black text-emerald-800">17:30</span> checkout, đủ giờ công</span>
            <span className="flex items-center gap-1.5"><span className="flex h-4 items-center justify-center bg-orange-100 px-1 text-[11px] font-black text-orange-800">15:00</span> checkout, chưa đủ giờ công</span>
            <span className="flex items-center gap-1.5"><span className="flex h-4 items-center justify-center bg-slate-300 dark:bg-slate-700 px-1 text-[11px] font-black text-slate-800 dark:text-slate-200">17:30</span> checkout nhưng chưa check-in</span>
            <span className="flex items-center gap-1.5"><span className="flex h-4 w-4 items-center justify-center bg-amber-100 text-[11px] font-black text-amber-800">!</span> thiếu checkout</span>
            <span className="flex items-center gap-1.5"><span className="flex h-4 w-4 items-center justify-center bg-violet-100 text-[11px] font-black text-violet-800">P</span> nghỉ phép</span>
            <span className="flex items-center gap-1.5"><span className="h-4 w-4 border border-slate-300 bg-slate-100 dark:bg-slate-800" /> cuối tuần</span>
          </div>
          {pageCount > 1 && (
            <div className="flex items-center justify-between border-t border-slate-100 dark:border-slate-800 px-4 py-2 text-xs text-slate-500 dark:text-slate-400 no-print">
              <span>Trang {currentPage + 1}/{pageCount}</span>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Trước</Button>
                <Button size="sm" variant="outline" disabled={currentPage >= pageCount - 1} onClick={() => setPage(currentPage + 1)}>Sau</Button>
              </div>
            </div>
          )}
        </TableShell>
      </FullscreenPanel>

      <Modal
        square
        open={!!edit}
        onClose={() => { if (!savingEdit) setEdit(null); }}
        title={edit ? `${isLocked ? 'Xem chi tiết chấm công' : 'Sửa chấm công'} — ${edit.profile.name} · ${edit.date.slice(8, 10)}/${edit.date.slice(5, 7)}/${edit.date.slice(0, 4)}` : ''}
        size="md"
      >
        {edit && (
          <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); if (!isLocked) void saveEdit(); }}>
            {isLocked && (
              <p className="rounded-none border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-800">
                Kỳ công đã khóa — chỉ xem chi tiết giờ vào / giờ ra, không thể chỉnh sửa.
              </p>
            )}
            <div className="grid grid-cols-2 gap-3">
              <Input label="Giờ vào" type="time" required value={edit.checkIn} className="!rounded-none" disabled={isLocked}
                onChange={(event) => setEdit({ ...edit, checkIn: event.target.value })} />
              <Input label="Giờ ra" type="time" required value={edit.checkOut} className="!rounded-none" disabled={isLocked}
                onChange={(event) => setEdit({ ...edit, checkOut: event.target.value })} />
            </div>
            {!isLocked ? (
              <>
                <Textarea className="!rounded-none" label="Lý do sửa" required rows={3} value={edit.reason}
                  placeholder="Ví dụ: máy chấm công lỗi, quên check-in…"
                  onChange={(event) => setEdit({ ...edit, reason: event.target.value })}
                  error={edit.reason && edit.reason.trim().length < 3 ? 'Ít nhất 3 ký tự.' : undefined} />
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="secondary" onClick={() => setEdit(null)} disabled={savingEdit}>Huỷ</Button>
                  <Button type="submit" disabled={savingEdit || !edit.checkIn || !edit.checkOut || edit.reason.trim().length < 3}>
                    {savingEdit ? 'Đang lưu…' : 'Lưu'}
                  </Button>
                </div>
              </>
            ) : (
              <div className="flex justify-end">
                <Button type="button" onClick={() => setEdit(null)}>Đóng</Button>
              </div>
            )}
          </form>
        )}
      </Modal>

      <Modal square open={warningsOpen} onClose={() => setWarningsOpen(false)} title={`${warnings.length} cảnh báo cần xem lại`} size="lg">
        <ul className="max-h-[60vh] space-y-2 overflow-y-auto pr-1">
          {warnings.map((warning) => (
            <li key={warning} className="flex items-start gap-2 text-sm leading-relaxed text-slate-700">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" /> {warning}
            </li>
          ))}
        </ul>
        {exceptions > 0 && <p className="mt-4 text-xs text-slate-500">Các bản ghi này chưa được tính vào bảng công chính thức.</p>}
      </Modal>
    </div>
  );
}

