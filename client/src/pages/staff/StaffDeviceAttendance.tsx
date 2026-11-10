import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  CalendarDays, CheckCircle2, Clock, Fingerprint, History, ShieldCheck,
  ClipboardList, LogIn, LogOut, Flame, Briefcase, AlertTriangle,
} from 'lucide-react';
import { startOfMonth, endOfMonth, getDaysInMonth, format } from 'date-fns';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { useRealtimeSync } from '@/hooks/useRealtimeSync';
import { supabase } from '@/lib/supabase';
import { describeDbError } from '@/lib/dbError';
import { formatDate, formatTime, getTodayString, toDateString } from '@/lib/utils';
import { LEAVE_TYPE_CONFIG } from '@/lib/leave';
import { EMPTY_SCHEDULES, fetchWorkSchedules, dayWeight, monthStandardDays, scheduleForDate, type ScheduleSet } from '@/lib/workSchedule';
import { Card, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Skeleton } from '@/components/ui/Skeleton';
import { ErrorState } from '@/components/ui/ErrorState';
import { Button } from '@/components/ui/Button';
import { MonthNav } from '@/components/ui/MonthNav';
import type { Attendance, LeaveRequest } from '@/types';

interface StaffAttendanceRequestRow {
  id: string;
  user_id: string;
  request_type: string;
  work_date: string;
  minutes: number | null;
  hours: number | null;
  reason: string | null;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
}

interface CompanyHolidayRow {
  holiday_date: string;
  name: string;
}

interface CalendarDayInfo {
  date: string;
  dayNum: number;
  weekdayIdx: number; // 0 = CN, 1 = T2 ... 6 = T7
  weekdayShort: string;
  weekdayLong: string;
  isWeekend: boolean;
  isToday: boolean;
  isFuture: boolean;
  weight: number;
  holidayName: string | null;
  records: Attendance[];
  primaryRecord: Attendance | null;
  checkInTime: string | null;
  checkOutTime: string | null;
  hoursWorked: number;
  missingCheckout: boolean;
  missingCheckIn: boolean;
  lateMinutes: number;
  lateStatus: 'APPROVED' | 'PENDING' | 'REJECTED' | 'NO_REQUEST' | null;
  otHoursApproved: number;
  otHoursPending: number;
  leave: LeaveRequest | null;
  workCredit: number; // 1 | 0.5 | 0
  statusKind: 'worked_full' | 'worked_half' | 'missing_checkout' | 'missing_checkin' | 'leave' | 'holiday' | 'absent' | 'off' | 'future';
}

const WEEKDAY_HEADERS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
const VI_WEEKDAYS_LONG = ['Chủ nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];
const VI_WEEKDAYS_SHORT = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
const OT_TYPES = ['OVERTIME', 'OT_WEEKDAY', 'OT_WEEKEND', 'OT_HOLIDAY'];

function clockMinutes(val: string): number {
  const [h, m] = val.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function timeMinutes(timestamp: string): number {
  const d = new Date(timestamp);
  if (Number.isNaN(d.getTime())) return Number.NaN;
  return d.getHours() * 60 + d.getMinutes();
}

const sourceLabel = (record: Attendance) => {
  const method = String(record.check_in_method || '').toUpperCase();
  if (method === 'DEVICE') return 'Máy chấm công';
  if (method === 'MANUAL') return 'Ghi nhận trên HRM';
  return 'Dữ liệu kế thừa';
};

// Hai nguồn, hai luật: giờ vào từ máy được nhận ngay, giờ vào tự khai trên HRM
// phải chờ quản lý xác nhận. Ngày công chỉ tính khi đã có giờ ra.
const statusLabel = (record: Attendance): string => {
  const fromDevice = String(record.check_in_method || '').toUpperCase() === 'DEVICE';
  if (record.approved_by_lead) return 'Đã tính công';
  if (!record.check_in_time && record.check_out_time) {
    return 'Đã checkout · chưa check-in (chờ máy chấm công)';
  }
  if (!record.check_out_time) {
    return fromDevice
      ? 'Máy đã ghi giờ vào · chờ bạn checkout'
      : 'Đã check-in trên HRM · chờ checkout, rồi quản lý xác nhận';
  }
  return fromDevice ? 'Đã checkout · đang tính công' : 'Đã checkout · chờ quản lý xác nhận';
};

export function StaffDeviceAttendance() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [checkingOut, setCheckingOut] = useState(false);
  const [checkingIn, setCheckingIn] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [monthStart, setMonthStart] = useState(() => startOfMonth(new Date()));
  const [monthRecords, setMonthRecords] = useState<Attendance[]>([]);
  const [recentRecords, setRecentRecords] = useState<Attendance[]>([]);
  const [monthLeaves, setMonthLeaves] = useState<LeaveRequest[]>([]);
  const [monthRequests, setMonthRequests] = useState<StaffAttendanceRequestRow[]>([]);
  const [schedules, setSchedules] = useState<ScheduleSet>(EMPTY_SCHEDULES);
  const [holidays, setHolidays] = useState<CompanyHolidayRow[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>(() => getTodayString());

  const today = getTodayString();
  const monthStartStr = toDateString(monthStart);
  const monthEndStr = toDateString(endOfMonth(monthStart));
  const monthKey = format(monthStart, 'yyyy-MM');
  const monthLabel = format(monthStart, 'MM/yyyy');
  const daysInMonth = getDaysInMonth(monthStart);

  useEffect(() => {
    if (today.startsWith(monthKey)) {
      setSelectedDate(today);
    } else {
      setSelectedDate(monthStartStr);
    }
  }, [monthKey, monthStartStr, today]);

  const loadData = useCallback(async (silent = false) => {
    if (!profile) return;
    if (!silent) setLoading(true);

    const recentCutoff = toDateString(new Date(Date.now() - 3 * 86_400_000));
    const [attRes, recentRes, leaveRes, reqRes, schedSet, holRes] = await Promise.all([
      supabase
        .from('attendance')
        .select('*')
        .eq('user_id', profile.id)
        .gte('date', monthStartStr)
        .lte('date', monthEndStr)
        .order('date', { ascending: false })
        .order('check_in_time', { ascending: false }),
      supabase
        .from('attendance')
        .select('*')
        .eq('user_id', profile.id)
        .gte('date', recentCutoff)
        .order('date', { ascending: false })
        .order('check_in_time', { ascending: false }),
      supabase
        .from('leave_requests')
        .select('*')
        .eq('user_id', profile.id)
        .in('status', ['approved', 'pending'])
        .lte('start_date', monthEndStr)
        .gte('end_date', monthStartStr),
      supabase
        .from('attendance_requests')
        .select('*')
        .eq('user_id', profile.id)
        .gte('work_date', monthStartStr)
        .lte('work_date', monthEndStr),
      fetchWorkSchedules(),
      supabase
        .from('company_holidays')
        .select('holiday_date, name')
        .eq('is_active', true)
        .gte('holiday_date', monthStartStr)
        .lte('holiday_date', monthEndStr),
    ]);

    setLoadError(attRes.error ? describeDbError(attRes.error) : null);
    setMonthRecords((attRes.data || []) as Attendance[]);
    setRecentRecords((recentRes.data || []) as Attendance[]);
    setMonthLeaves(((leaveRes.data || []) as LeaveRequest[]).filter((l) => !l.is_cancelled));
    setMonthRequests((reqRes.error ? [] : (reqRes.data || [])) as StaffAttendanceRequestRow[]);
    setSchedules(schedSet);
    setHolidays((holRes.error ? [] : (holRes.data || [])) as CompanyHolidayRow[]);
    setLoading(false);
  }, [profile, monthStartStr, monthEndStr]);

  useEffect(() => { void loadData(); }, [loadData]);
  useRealtimeSync(
    profile ? [
      { table: 'attendance', filter: `user_id=eq.${profile.id}` },
      { table: 'leave_requests', filter: `user_id=eq.${profile.id}` },
      { table: 'attendance_requests', filter: `user_id=eq.${profile.id}` },
    ] : [],
    () => void loadData(true),
    { enabled: !!profile, channelKey: `staff-device-attendance-${profile?.id || 'anonymous'}` },
  );

  const allKnownRecords = useMemo(() => {
    const map = new Map<string, Attendance>();
    for (const r of recentRecords) map.set(r.id, r);
    for (const r of monthRecords) map.set(r.id, r);
    return Array.from(map.values());
  }, [recentRecords, monthRecords]);

  const todayRecord = allKnownRecords.find((record) => record.date === today) || null;
  const checkoutRecord = allKnownRecords.find((record) => {
    if (record.check_out_time || !record.check_in_time) return false;
    const ageHours = (Date.now() - new Date(record.check_in_time).getTime()) / 3_600_000;
    return ageHours >= 0 && ageHours <= 36;
  }) || null;
  const focusRecord = (todayRecord && !todayRecord.check_out_time ? todayRecord : checkoutRecord) || todayRecord;

  // Xây dựng dữ liệu từng ngày trong tháng (1..daysInMonth)
  const calendarData = useMemo(() => {
    const holidayMap = new Map<string, string>();
    for (const h of holidays) holidayMap.set(h.holiday_date, h.name || 'Nghỉ lễ');
    const holidaySet = new Set(holidayMap.keys());

    const attByDate = new Map<string, Attendance[]>();
    for (const r of monthRecords) {
      const list = attByDate.get(r.date) ?? [];
      list.push(r);
      attByDate.set(r.date, list);
    }

    const reqByDate = new Map<string, StaffAttendanceRequestRow[]>();
    for (const req of monthRequests) {
      const list = reqByDate.get(req.work_date) ?? [];
      list.push(req);
      reqByDate.set(req.work_date, list);
    }

    const approvedLeaves = monthLeaves.filter((l) => l.status === 'approved');
    const standardDays = monthStandardDays(schedules, monthStart, Array.from(holidaySet)) ?? 26;

    const days: CalendarDayInfo[] = [];
    let totalWorkDays = 0;
    let totalWorkHours = 0;
    let totalLeaveDays = 0;
    let totalOtHours = 0;
    let lateCount = 0;
    let lateMinutesTotal = 0;
    let missingCheckoutCount = 0;

    for (let dayNum = 1; dayNum <= daysInMonth; dayNum++) {
      const iso = `${monthKey}-${String(dayNum).padStart(2, '0')}`;
      const d = new Date(`${iso}T00:00:00`);
      const weekdayIdx = d.getDay();
      const isWeekend = weekdayIdx === 0 || weekdayIdx === 6;
      const isToday = iso === today;
      const isFuture = iso > today;

      const weight = schedules.supported
        ? dayWeight(schedules, iso, holidaySet)
        : (weekdayIdx === 0 ? 0 : weekdayIdx === 6 ? 0.5 : 1);
      const holidayName = holidayMap.get(iso) ?? null;

      const dayRecs = attByDate.get(iso) ?? [];
      // Sắp xếp bản ghi có giờ vào sớm nhất để lấy giờ vào, giờ ra muộn nhất để lấy giờ ra
      const withCheckIn = dayRecs.filter((r) => r.check_in_time);
      const withCheckOut = dayRecs.filter((r) => r.check_out_time);

      const earliestIn = withCheckIn.length > 0
        ? withCheckIn.reduce((min, r) => (r.check_in_time! < min.check_in_time! ? r : min)).check_in_time
        : null;
      const latestOut = withCheckOut.length > 0
        ? withCheckOut.reduce((max, r) => (r.check_out_time! > max.check_out_time! ? r : max)).check_out_time
        : null;

      let hoursWorked = 0;
      for (const r of dayRecs) {
        if (r.check_in_time && r.check_out_time) {
          const st = new Date(r.check_in_time).getTime();
          const en = new Date(r.check_out_time).getTime();
          if (en > st) hoursWorked += Math.min((en - st) / 3_600_000, 24);
        }
      }
      hoursWorked = Math.round(hoursWorked * 10) / 10;

      const missingCheckout = Boolean(earliestIn && !latestOut);
      const missingCheckIn = Boolean(!earliestIn && latestOut);

      // Kiểm tra nghỉ phép
      const leave = approvedLeaves.find((l) => l.start_date <= iso && l.end_date >= iso && weight > 0) ?? null;

      // Kiểm tra đi muộn và OT
      const dayReqs = reqByDate.get(iso) ?? [];
      let lateMinutes = 0;
      let lateStatus: CalendarDayInfo['lateStatus'] = null;

      if (earliestIn && weight > 0) {
        const sched = scheduleForDate(schedules, iso);
        if (sched) {
          const actualMin = timeMinutes(earliestIn);
          const schedMin = clockMinutes(sched.start_time);
          const grace = sched.grace_minutes || 0;
          const diff = actualMin - schedMin - grace;
          if (diff > 0) {
            lateMinutes = diff;
            const lateReq = dayReqs.find((r) => r.request_type === 'LATE_ARRIVAL');
            lateStatus = lateReq ? (lateReq.status === 'CANCELLED' ? 'NO_REQUEST' : lateReq.status) : 'NO_REQUEST';
            lateCount++;
            lateMinutesTotal += diff;
          }
        }
      }

      let otHoursApproved = 0;
      let otHoursPending = 0;
      for (const req of dayReqs) {
        if (OT_TYPES.includes(req.request_type) && Number(req.hours) > 0) {
          if (req.status === 'APPROVED') otHoursApproved += Number(req.hours);
          else if (req.status === 'PENDING') otHoursPending += Number(req.hours);
        }
      }

      // Tính công ngày này
      let workCredit = 0;
      if (earliestIn) {
        const baseCredit = weight > 0 ? weight : (weekdayIdx === 6 ? 0.5 : 1);
        workCredit = leave?.half_day ? Math.min(0.5, baseCredit) : baseCredit;
      }

      totalWorkDays += workCredit;
      totalWorkHours += hoursWorked;
      totalOtHours += otHoursApproved;
      if (missingCheckout) missingCheckoutCount++;
      if (leave && weight > 0) {
        totalLeaveDays += leave.half_day ? weight / 2 : weight;
      }

      let statusKind: CalendarDayInfo['statusKind'] = 'off';
      if (missingCheckout) statusKind = 'missing_checkout';
      else if (missingCheckIn) statusKind = 'missing_checkin';
      else if (earliestIn) statusKind = workCredit >= 1 ? 'worked_full' : 'worked_half';
      else if (leave) statusKind = 'leave';
      else if (holidayName) statusKind = 'holiday';
      else if (isFuture) statusKind = weight > 0 ? 'future' : 'off';
      else if (weight > 0) statusKind = 'absent';
      else statusKind = 'off';

      days.push({
        date: iso,
        dayNum,
        weekdayIdx,
        weekdayShort: VI_WEEKDAYS_SHORT[weekdayIdx],
        weekdayLong: VI_WEEKDAYS_LONG[weekdayIdx],
        isWeekend,
        isToday,
        isFuture,
        weight,
        holidayName,
        records: dayRecs,
        primaryRecord: dayRecs[0] ?? null,
        checkInTime: earliestIn,
        checkOutTime: latestOut,
        hoursWorked,
        missingCheckout,
        missingCheckIn,
        lateMinutes,
        lateStatus,
        otHoursApproved: Math.round(otHoursApproved * 10) / 10,
        otHoursPending: Math.round(otHoursPending * 10) / 10,
        leave,
        workCredit,
        statusKind,
      });
    }

    // Số ô trống đầu tháng để căn đúng cột Thứ Hai (T2 = 0 ... CN = 6)
    const firstDayDow = new Date(monthStart.getFullYear(), monthStart.getMonth(), 1).getDay();
    const leadingBlanks = (firstDayDow + 6) % 7;

    return {
      days,
      leadingBlanks,
      standardDays,
      totalWorkDays: Math.round(totalWorkDays * 10) / 10,
      totalWorkHours: Math.round(totalWorkHours * 10) / 10,
      totalLeaveDays: Math.round(totalLeaveDays * 10) / 10,
      totalOtHours: Math.round(totalOtHours * 10) / 10,
      lateCount,
      lateMinutesTotal,
      missingCheckoutCount,
    };
  }, [holidays, monthRecords, monthRequests, monthLeaves, schedules, monthStart, daysInMonth, monthKey, today]);

  const selectedDayInfo = useMemo(
    () => calendarData.days.find((d) => d.date === selectedDate) ?? calendarData.days[0] ?? null,
    [calendarData.days, selectedDate],
  );

  // Check-in trên HRM là LỐI NGOẠI LỆ: quên quét máy, hoặc làm ngoài văn
  // phòng. Đã quét máy rồi thì trigger attendance_block_manual_after_device
  // dưới database chặn — giao diện ẩn nút chỉ là lớp ngoài, người dùng gọi
  // thẳng API vẫn không tạo được dòng thứ hai cùng ngày.
  const handleCheckIn = async () => {
    if (!profile) return;
    if (todayRecord) {
      if (!todayRecord.check_in_time) {
        setCheckingIn(true);
        const { error } = await supabase
          .from('attendance')
          .update({ check_in_time: new Date().toISOString() })
          .eq('id', todayRecord.id)
          .eq('user_id', profile.id);
        setCheckingIn(false);
        if (error) {
          toast(`Check-in thất bại: ${describeDbError(error)}`, 'error');
          return;
        }
        toast('Đã bổ sung giờ check-in.', 'success');
        await loadData(true);
      }
      return;
    }
    setCheckingIn(true);
    const { error } = await supabase.from('attendance').insert({
      user_id: profile.id,
      date: today,
      check_in_time: new Date().toISOString(),
      status: 'active',
      check_in_method: 'MANUAL',
      approved_by_lead: false,
    });
    setCheckingIn(false);
    if (error) {
      toast(`Check-in thất bại: ${describeDbError(error)}`, 'error');
      await loadData(true);
      return;
    }
    toast('Đã check-in. Nhớ bấm Check-out khi về.', 'success');
    await loadData(true);
  };

  const handleCheckOut = async (targetId?: string) => {
    if (!profile) return;
    const target = (targetId ? allKnownRecords.find((r) => r.id === targetId) : null)
      || (todayRecord && !todayRecord.check_out_time ? todayRecord : null)
      || checkoutRecord;

    setCheckingOut(true);
    const nowIso = new Date().toISOString();

    if (target && !target.check_out_time) {
      const { data, error } = await supabase
        .from('attendance')
        .update({ check_out_time: nowIso, status: 'completed' })
        .eq('id', target.id)
        .eq('user_id', profile.id)
        .is('check_out_time', null)
        .select('id')
        .maybeSingle();
      setCheckingOut(false);
      if (error) {
        toast(`Checkout thất bại: ${describeDbError(error)}`, 'error');
        return;
      }
      if (!data) {
        toast('Bản ghi vừa được cập nhật ở nơi khác. Đang tải lại dữ liệu.', 'warning');
      } else {
        toast('Checkout thành công. Giờ ra đã được ghi nhận.', 'success');
      }
      await loadData(true);
      return;
    }

    // Chưa có bản ghi hôm nay: cho phép check out khi chưa check in
    let { error } = await supabase
      .from('attendance')
      .insert({
        user_id: profile.id,
        date: today,
        check_in_time: null,
        check_out_time: nowIso,
        status: 'completed',
        check_in_method: 'DEVICE',
        approved_by_lead: false,
      })
      .select('id')
      .maybeSingle();

    if (error) {
      const res = await supabase
        .from('attendance')
        .insert({
          user_id: profile.id,
          date: today,
          check_in_time: null,
          check_out_time: nowIso,
          status: 'completed',
          check_in_method: 'MANUAL',
          approved_by_lead: false,
        })
        .select('id')
        .maybeSingle();
      error = res.error;
    }

    setCheckingOut(false);
    if (error) {
      toast(`Checkout thất bại: ${describeDbError(error)}`, 'error');
      await loadData(true);
      return;
    }
    toast('Checkout thành công. Giờ vào sẽ được bổ sung sau.', 'success');
    await loadData(true);
  };

  if (loading) return <div className="space-y-5"><Skeleton className="h-16 w-full" /><Skeleton className="h-64 w-full rounded-2xl" /><Skeleton className="h-80 w-full rounded-2xl" /></div>;
  if (loadError) return <Card><ErrorState message={loadError} onRetry={() => loadData()} /></Card>;

  return (
    <div className="space-y-5 attendance-module" data-module="attendance">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-extrabold text-slate-900 dark:text-slate-100">Chấm công & Bảng công tháng</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Theo dõi giờ vào/ra hôm nay và toàn bộ lịch công từng ngày trong tháng.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link to="/staff/leave" className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 text-sm font-semibold text-slate-700 dark:text-slate-200 shadow-sm hover:border-indigo-300 hover:text-indigo-700">
            <Briefcase className="h-4 w-4" /> Đơn từ & Nghỉ phép
          </Link>
          <Link to="/staff/assignments" className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 text-sm font-semibold text-slate-700 dark:text-slate-200 shadow-sm hover:border-emerald-300 hover:text-emerald-700">
            <ClipboardList className="h-4 w-4" /> Việc được giao
          </Link>
        </div>
      </div>

      <div className="flex items-start gap-3 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3.5 text-sm text-blue-900">
        <ShieldCheck className="mt-0.5 h-5 w-5 flex-shrink-0 text-blue-600" />
        <div className="leading-relaxed">
          <p><strong>Máy chấm công là nguồn chính ghi giờ vào.</strong> Quét ở máy rồi thì không cần
          check-in ở đây nữa — cuối ngày chỉ bấm <strong>Check-out</strong>, ngày công tính ngay.</p>
          <p className="mt-1.5">Hôm nào chưa kịp quét máy thì check-in ở đây, nhưng ngày đó
          <strong> phải chờ quản lý xác nhận</strong> mới được tính công.</p>
        </div>
      </div>

      {!todayRecord && focusRecord && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3.5">
          <p className="text-sm text-slate-600">
            Hôm nay chưa có giờ vào — ca đang hiển thị bên dưới là ca cũ chưa checkout.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button theme="staff" onClick={handleCheckIn} disabled={checkingIn || checkingOut}>
              <LogIn className="h-4 w-4" />
              {checkingIn ? 'Đang check-in…' : 'Check-in hôm nay'}
            </Button>
            <Button variant="outline" onClick={() => handleCheckOut()} disabled={checkingOut || checkingIn}>
              <LogOut className="h-4 w-4" />
              {checkingOut ? 'Đang checkout…' : 'Check-out hôm nay'}
            </Button>
          </div>
        </div>
      )}

      <Card className="overflow-hidden">
        <div className="border-b border-slate-100 bg-gradient-to-r from-emerald-50 to-white px-5 py-4 sm:px-6">
          <div className="flex items-center gap-2 text-sm font-bold text-emerald-800"><CalendarDays className="h-4 w-4" />{focusRecord?.date === today ? 'Hôm nay' : 'Ca cần checkout'} · {formatDate(focusRecord?.date || today)}</div>
        </div>
        <CardContent className="p-5 sm:p-6">
          {!focusRecord ? (
            <div className="py-8 text-center">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-100 text-slate-400"><Fingerprint className="h-8 w-8" /></div>
              <h2 className="mt-4 font-display text-lg font-bold text-slate-800">Chưa có giờ vào hôm nay</h2>
              <p className="mx-auto mt-1 max-w-md text-sm leading-relaxed text-slate-500">
                Quét tại máy chấm công là cách thông thường; trang sẽ tự cập nhật sau lần đồng bộ
                kế tiếp. Nếu hôm nay bạn không quét được máy thì check-in ở đây.
              </p>
              <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
                <Button theme="staff" onClick={handleCheckIn} disabled={checkingIn || checkingOut}>
                  <LogIn className="h-4 w-4" />
                  {checkingIn ? 'Đang check-in…' : 'Check-in trên HRM'}
                </Button>
                <Button variant="outline" onClick={() => handleCheckOut()} disabled={checkingOut || checkingIn}>
                  <LogOut className="h-4 w-4" />
                  {checkingOut ? 'Đang checkout…' : 'Check-out (chưa check-in)'}
                </Button>
              </div>
            </div>
          ) : (
            <div className="grid gap-5 lg:grid-cols-[1.15fr_0.85fr]">
              <div className={`rounded-2xl border p-5 ${!focusRecord.check_in_time && focusRecord.check_out_time ? 'border-slate-300 dark:border-slate-700 bg-slate-100/70 dark:bg-slate-800/70' : 'border-emerald-200 bg-emerald-50/60'}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className={`text-xs font-bold uppercase tracking-widest ${!focusRecord.check_in_time && focusRecord.check_out_time ? 'text-slate-600 dark:text-slate-400' : 'text-emerald-700'}`}>
                      {focusRecord.check_in_time ? 'Giờ vào đã ghi nhận' : 'Giờ ra đã ghi nhận'}
                    </p>
                    <p className="mt-2 font-display text-4xl font-extrabold tabular-nums text-slate-900 dark:text-slate-100">
                      {focusRecord.check_in_time ? formatTime(focusRecord.check_in_time) : formatTime(focusRecord.check_out_time)}
                    </p>
                  </div>
                  <Badge className="bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 ring-1 ring-slate-300 dark:ring-slate-700">
                    <Fingerprint className="mr-1 h-3.5 w-3.5" />{sourceLabel(focusRecord)}
                  </Badge>
                </div>
                <p className="mt-4 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                  {!focusRecord.check_in_time && focusRecord.check_out_time
                    ? `Checkout lúc ${formatTime(focusRecord.check_out_time)} · Chưa có giờ vào (sẽ bổ sung qua máy chấm công).`
                    : focusRecord.check_out_time
                    ? `Checkout lúc ${formatTime(focusRecord.check_out_time)}`
                    : 'Máy đã ghi giờ vào; bạn chưa checkout ca này.'}
                </p>
                {!focusRecord.check_out_time && (
                  <Button theme="staff" onClick={() => handleCheckOut(focusRecord.id)} disabled={checkingOut} className="mt-5 w-full sm:w-auto">
                    <LogOut className="h-4 w-4" />
                    {checkingOut ? 'Đang checkout…' : 'Checkout cuối ngày'}
                  </Button>
                )}
                {!focusRecord.check_in_time && focusRecord.check_out_time && (
                  <Button variant="outline" size="sm" onClick={handleCheckIn} disabled={checkingIn} className="mt-4">
                    <LogIn className="h-4 w-4" />
                    {checkingIn ? 'Đang check-in…' : 'Check-in bổ sung'}
                  </Button>
                )}
              </div>
              <div className="space-y-3">
                <InfoRow icon={<CheckCircle2 className="h-4 w-4" />} label="Trạng thái" value={statusLabel(focusRecord)} />
                <InfoRow icon={<Fingerprint className="h-4 w-4" />} label="Nguồn dữ liệu" value={sourceLabel(focusRecord)} />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ====================================================================
          TỔNG QUAN CÔNG THÁNG & LỊCH CÔNG 31 NGÀY
          ==================================================================== */}
      <Card className="overflow-hidden border-2 border-slate-300 dark:border-slate-700 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 px-4 py-3.5 sm:px-6">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-xs">
              <CalendarDays className="h-5 w-5" />
            </div>
            <div>
              <h2 className="font-display text-base sm:text-lg font-extrabold text-slate-900 dark:text-slate-100">
                Lịch công tháng {monthLabel}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Chạm vào từng ngày trên lịch để xem chi tiết giờ vào, giờ ra, nghỉ phép hoặc làm thêm.
              </p>
            </div>
          </div>
          <MonthNav value={monthStart} onChange={setMonthStart} theme="staff" />
        </div>

        <CardContent className="p-4 sm:p-6 space-y-5">
          {/* Thẻ chỉ số tổng quan trong tháng */}
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
            <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3">
              <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                <span className="font-bold">Ngày công</span>
                <CalendarDays className="h-4 w-4 text-emerald-600" />
              </div>
              <p className="mt-1.5 font-display text-xl font-black tabular-nums text-slate-900 dark:text-slate-100">
                {calendarData.totalWorkDays}
                <span className="ml-1 text-xs font-semibold text-slate-400">/ {calendarData.standardDays} công</span>
              </p>
              <p className="mt-0.5 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                Đạt {calendarData.standardDays > 0 ? Math.round((calendarData.totalWorkDays / calendarData.standardDays) * 100) : 0}% công chuẩn
              </p>
            </div>

            <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3">
              <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                <span className="font-bold">Tổng giờ làm</span>
                <Clock className="h-4 w-4 text-blue-600" />
              </div>
              <p className="mt-1.5 font-display text-xl font-black tabular-nums text-slate-900 dark:text-slate-100">
                {calendarData.totalWorkHours}
                <span className="ml-1 text-xs font-semibold text-slate-400">giờ</span>
              </p>
              <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                {calendarData.missingCheckoutCount > 0 ? `${calendarData.missingCheckoutCount} ngày thiếu checkout` : 'Đã đủ giờ ra các ca'}
              </p>
            </div>

            <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3">
              <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                <span className="font-bold">Nghỉ phép</span>
                <Briefcase className="h-4 w-4 text-violet-600" />
              </div>
              <p className="mt-1.5 font-display text-xl font-black tabular-nums text-slate-900 dark:text-slate-100">
                {calendarData.totalLeaveDays}
                <span className="ml-1 text-xs font-semibold text-slate-400">ngày</span>
              </p>
              <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                Đơn nghỉ đã được duyệt
              </p>
            </div>

            <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3">
              <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                <span className="font-bold">Làm thêm (OT)</span>
                <Flame className="h-4 w-4 text-orange-600" />
              </div>
              <p className="mt-1.5 font-display text-xl font-black tabular-nums text-slate-900 dark:text-slate-100">
                {calendarData.totalOtHours}
                <span className="ml-1 text-xs font-semibold text-slate-400">giờ</span>
              </p>
              <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                Giờ tăng ca đã duyệt
              </p>
            </div>

            <div className="col-span-2 sm:col-span-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3">
              <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                <span className="font-bold">Đi muộn</span>
                <AlertTriangle className="h-4 w-4 text-amber-600" />
              </div>
              <p className={`mt-1.5 font-display text-xl font-black tabular-nums ${calendarData.lateCount > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-slate-900 dark:text-slate-100'}`}>
                {calendarData.lateCount}
                <span className="ml-1 text-xs font-semibold text-slate-400">lần ({calendarData.lateMinutesTotal}p)</span>
              </p>
              <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                {calendarData.lateCount === 0 ? 'Đúng giờ tất cả các ngày' : 'So với giờ vào ca chuẩn'}
              </p>
            </div>
          </div>

          {/* Chú thích màu sắc trên quyển lịch */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-800/40 px-3.5 py-2.5 text-xs font-semibold text-slate-600 dark:text-slate-300">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-3 w-3 rounded bg-emerald-500" /> Đủ công (1.0)
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-3 w-3 rounded bg-teal-400" /> Nửa công (0.5)
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-3 w-3 rounded bg-amber-400" /> Thiếu checkout / Chờ máy
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-3 w-3 rounded bg-violet-500" /> Nghỉ phép (P)
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-3 w-3 rounded bg-rose-400" /> Vắng mặt
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-3 w-3 rounded border border-slate-300 bg-slate-100 dark:border-slate-600 dark:bg-slate-800" /> Ngày nghỉ / Chủ nhật
            </span>
          </div>

          {/* Lưới lịch tháng 7 cột (Thứ 2 -> Chủ nhật) như tờ lịch treo tường */}
          <div className="overflow-hidden rounded-2xl border-2 border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900">
            <div className="grid grid-cols-7 border-b-2 border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 text-center text-[11px] sm:text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-200">
              {WEEKDAY_HEADERS.map((label, idx) => (
                <div
                  key={label}
                  className={`py-2.5 ${idx > 0 ? 'border-l border-slate-200 dark:border-slate-700' : ''} ${idx === 6 ? 'text-rose-600 dark:text-rose-400' : idx === 5 ? 'text-amber-700 dark:text-amber-400' : ''}`}
                >
                  {label}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-7 divide-x divide-y divide-slate-200 dark:divide-slate-800">
              {Array.from({ length: calendarData.leadingBlanks }).map((_, idx) => (
                <div key={`blank-${idx}`} className="min-h-[74px] sm:min-h-[96px] bg-slate-50/60 dark:bg-slate-900/40" />
              ))}

              {calendarData.days.map((d) => {
                const isSelected = d.date === selectedDayInfo?.date;
                let cellBg = 'bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800/60';
                let badgeEl: ReactNode = null;

                if (d.statusKind === 'worked_full') {
                  cellBg = 'bg-emerald-50/70 dark:bg-emerald-950/30 hover:bg-emerald-100/70';
                  badgeEl = <span className="rounded bg-emerald-600 px-1.5 py-0.5 text-[10px] font-extrabold text-white">1 công</span>;
                } else if (d.statusKind === 'worked_half') {
                  cellBg = 'bg-teal-50/70 dark:bg-teal-950/30 hover:bg-teal-100/70';
                  badgeEl = <span className="rounded bg-teal-600 px-1.5 py-0.5 text-[10px] font-extrabold text-white">0.5 công</span>;
                } else if (d.statusKind === 'missing_checkout') {
                  cellBg = 'bg-amber-50/80 dark:bg-amber-950/40 hover:bg-amber-100/70';
                  badgeEl = <span className="rounded bg-amber-500 px-1.5 py-0.5 text-[10px] font-extrabold text-white">Thiếu ra</span>;
                } else if (d.statusKind === 'missing_checkin') {
                  cellBg = 'bg-amber-50/60 dark:bg-amber-950/30 hover:bg-amber-100/60';
                  badgeEl = <span className="rounded bg-slate-600 px-1.5 py-0.5 text-[10px] font-extrabold text-white">Chờ máy</span>;
                } else if (d.statusKind === 'leave') {
                  cellBg = 'bg-violet-50/80 dark:bg-violet-950/35 hover:bg-violet-100/70';
                  badgeEl = (
                    <span className="rounded bg-violet-600 px-1.5 py-0.5 text-[10px] font-extrabold text-white">
                      {d.leave?.half_day ? 'P/2' : 'Phép'}
                    </span>
                  );
                } else if (d.statusKind === 'holiday') {
                  cellBg = 'bg-pink-50/70 dark:bg-pink-950/30 hover:bg-pink-100/70';
                  badgeEl = <span className="rounded bg-pink-600 px-1.5 py-0.5 text-[10px] font-extrabold text-white">Lễ</span>;
                } else if (d.statusKind === 'absent') {
                  cellBg = 'bg-rose-50/50 dark:bg-rose-950/20 hover:bg-rose-100/50';
                  badgeEl = <span className="rounded bg-rose-100 dark:bg-rose-900/50 px-1.5 py-0.5 text-[10px] font-bold text-rose-700 dark:text-rose-300">Vắng</span>;
                } else if (d.statusKind === 'off') {
                  cellBg = 'bg-slate-50/90 dark:bg-slate-800/40 hover:bg-slate-100/80';
                }

                return (
                  <button
                    key={d.date}
                    type="button"
                    onClick={() => setSelectedDate(d.date)}
                    className={`group relative flex min-h-[74px] sm:min-h-[96px] flex-col justify-between p-1.5 sm:p-2.5 text-left transition-all focus:outline-none ${cellBg} ${
                      isSelected
                        ? 'ring-2 ring-inset ring-indigo-600 dark:ring-indigo-400 z-10'
                        : d.isToday
                        ? 'ring-2 ring-inset ring-emerald-500'
                        : ''
                    }`}
                  >
                    <div className="flex w-full items-start justify-between gap-1">
                      <span
                        className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs sm:text-sm font-black tabular-nums ${
                          d.isToday
                            ? 'bg-indigo-600 text-white shadow-xs'
                            : d.weekdayIdx === 0
                            ? 'text-rose-600 dark:text-rose-400'
                            : d.weekdayIdx === 6
                            ? 'text-amber-700 dark:text-amber-400'
                            : 'text-slate-800 dark:text-slate-100'
                        }`}
                      >
                        {d.dayNum}
                      </span>
                      <div className="hidden sm:block">{badgeEl}</div>
                    </div>

                    {/* Giờ vào / ra hoặc trạng thái tóm tắt ngay trên ô lịch */}
                    <div className="mt-1 space-y-0.5 w-full">
                      <div className="sm:hidden">{badgeEl}</div>

                      {d.checkInTime && (
                        <p className="truncate font-mono text-[10px] sm:text-xs font-bold text-slate-800 dark:text-slate-100">
                          <span className="text-emerald-700 dark:text-emerald-400">{formatTime(d.checkInTime)}</span>
                          {d.checkOutTime ? (
                            <span className="text-slate-500 dark:text-slate-400"> → {formatTime(d.checkOutTime)}</span>
                          ) : (
                            <span className="text-amber-600 dark:text-amber-400"> → ?</span>
                          )}
                        </p>
                      )}

                      {!d.checkInTime && d.checkOutTime && (
                        <p className="truncate font-mono text-[10px] sm:text-xs font-bold text-slate-600 dark:text-slate-300">
                          ? → {formatTime(d.checkOutTime)}
                        </p>
                      )}

                      {!d.checkInTime && !d.checkOutTime && d.leave && (
                        <p className="truncate text-[10px] sm:text-[11px] font-bold text-violet-700 dark:text-violet-300">
                          {LEAVE_TYPE_CONFIG[d.leave.leave_type]?.label ?? 'Nghỉ phép'}
                        </p>
                      )}

                      {!d.checkInTime && !d.checkOutTime && !d.leave && d.holidayName && (
                        <p className="truncate text-[10px] sm:text-[11px] font-bold text-pink-700 dark:text-pink-300">
                          {d.holidayName}
                        </p>
                      )}

                      {/* Chấm cảnh báo đi muộn hoặc có OT */}
                      {(d.lateMinutes > 0 || d.otHoursApproved > 0) && (
                        <div className="flex flex-wrap items-center gap-1 pt-0.5">
                          {d.lateMinutes > 0 && (
                            <span className="inline-block rounded bg-amber-100 dark:bg-amber-900/60 px-1 py-0 text-[9px] font-bold text-amber-800 dark:text-amber-200">
                              Muộn {d.lateMinutes}p
                            </span>
                          )}
                          {d.otHoursApproved > 0 && (
                            <span className="inline-block rounded bg-orange-100 dark:bg-orange-900/60 px-1 py-0 text-[9px] font-bold text-orange-800 dark:text-orange-200">
                              +{d.otHoursApproved}h OT
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Khung chi tiết của ngày đang chọn trên lịch */}
          {selectedDayInfo && (
            <div className="rounded-2xl border-2 border-indigo-200 dark:border-indigo-900/70 bg-indigo-50/40 dark:bg-indigo-950/20 p-4 sm:p-5">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-indigo-100 dark:border-indigo-900/60 pb-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-display text-base font-extrabold text-slate-900 dark:text-slate-100">
                      {selectedDayInfo.weekdayLong}, {formatDate(selectedDayInfo.date)}
                    </h3>
                    {selectedDayInfo.isToday && (
                      <Badge className="bg-indigo-600 text-white font-bold">Hôm nay</Badge>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                    Định mức ngày: <strong>{selectedDayInfo.weight} công</strong>
                    {selectedDayInfo.holidayName ? ` · Nghỉ lễ: ${selectedDayInfo.holidayName}` : ''}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Badge className={
                    selectedDayInfo.workCredit > 0
                      ? 'bg-emerald-100 text-emerald-800 border border-emerald-300 font-bold'
                      : selectedDayInfo.leave
                      ? 'bg-violet-100 text-violet-800 border border-violet-300 font-bold'
                      : 'bg-slate-100 text-slate-700 border border-slate-300 font-bold'
                  }>
                    Tính công: {selectedDayInfo.workCredit} công
                    {selectedDayInfo.hoursWorked > 0 ? ` (${selectedDayInfo.hoursWorked}h)` : ''}
                  </Badge>
                </div>
              </div>

              <div className="mt-3.5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-sm">
                <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3">
                  <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Giờ vào</p>
                  <p className="mt-1 font-mono text-lg font-black text-slate-900 dark:text-slate-100">
                    {selectedDayInfo.checkInTime ? formatTime(selectedDayInfo.checkInTime) : '—'}
                  </p>
                  {selectedDayInfo.lateMinutes > 0 && (
                    <p className="mt-0.5 text-xs font-semibold text-amber-600">
                      Đi muộn {selectedDayInfo.lateMinutes} phút
                      {selectedDayInfo.lateStatus === 'APPROVED' ? ' (Đã duyệt đơn)' : ''}
                    </p>
                  )}
                </div>

                <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3">
                  <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Giờ ra</p>
                  <p className="mt-1 font-mono text-lg font-black text-slate-900 dark:text-slate-100">
                    {selectedDayInfo.checkOutTime ? formatTime(selectedDayInfo.checkOutTime) : selectedDayInfo.checkInTime ? 'Chưa checkout' : '—'}
                  </p>
                  {selectedDayInfo.missingCheckout && (
                    <p className="mt-0.5 text-xs font-semibold text-amber-600">
                      Cần checkout để chốt giờ làm
                    </p>
                  )}
                </div>

                <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3">
                  <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Nguồn & Trạng thái</p>
                  <p className="mt-1 text-sm font-black text-slate-900 dark:text-slate-100">
                    {selectedDayInfo.primaryRecord ? sourceLabel(selectedDayInfo.primaryRecord) : 'Chưa phát sinh'}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {selectedDayInfo.primaryRecord
                      ? statusLabel(selectedDayInfo.primaryRecord)
                      : selectedDayInfo.leave
                      ? `Nghỉ: ${LEAVE_TYPE_CONFIG[selectedDayInfo.leave.leave_type]?.label}`
                      : selectedDayInfo.holidayName
                      ? selectedDayInfo.holidayName
                      : selectedDayInfo.weight === 0
                      ? 'Ngày nghỉ hàng tuần'
                      : selectedDayInfo.isFuture
                      ? 'Chưa tới ngày làm việc'
                      : 'Không có bản ghi chấm công'}
                  </p>
                </div>

                <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3">
                  <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Đơn từ / Tăng ca</p>
                  <div className="mt-1 space-y-1 text-xs font-semibold text-slate-700 dark:text-slate-200">
                    {selectedDayInfo.leave && (
                      <p className="text-violet-700 dark:text-violet-300">
                        • {LEAVE_TYPE_CONFIG[selectedDayInfo.leave.leave_type]?.label}
                        {selectedDayInfo.leave.half_day ? ' (Nửa ngày)' : ' (Cả ngày)'}
                      </p>
                    )}
                    {selectedDayInfo.otHoursApproved > 0 && (
                      <p className="text-orange-700 dark:text-orange-300">
                        • OT đã duyệt: +{selectedDayInfo.otHoursApproved}h
                      </p>
                    )}
                    {selectedDayInfo.otHoursPending > 0 && (
                      <p className="text-amber-700 dark:text-amber-300">
                        • OT chờ duyệt: +{selectedDayInfo.otHoursPending}h
                      </p>
                    )}
                    {!selectedDayInfo.leave && selectedDayInfo.otHoursApproved === 0 && selectedDayInfo.otHoursPending === 0 && (
                      <p className="text-slate-400">Không có đơn từ ngày này</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Danh sách chi tiết từng ngày có chấm công trong tháng */}
      <Card className="overflow-hidden border-2 border-slate-400 dark:border-slate-600 shadow-sm">
        <div className="flex items-center justify-between gap-2 border-b-2 border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 px-5 py-4 sm:px-6">
          <div className="flex items-center gap-2">
            <History className="h-5 w-5 text-slate-500" />
            <div>
              <h2 className="font-display text-lg font-bold text-slate-900 dark:text-slate-100">Nhật ký vào / ra tháng {monthLabel}</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">Danh sách các lượt chấm công ghi nhận trong tháng, mới nhất ở trên.</p>
            </div>
          </div>
          <Badge className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-bold">
            {monthRecords.length} lượt
          </Badge>
        </div>
        {monthRecords.length === 0 ? <div className="px-5 py-12 text-center text-sm font-semibold text-slate-500">Tháng {monthLabel} chưa có dữ liệu chấm công.</div> : (
          <div className="divide-y divide-slate-300 dark:divide-slate-700 bg-white dark:bg-slate-900 font-semibold">{monthRecords.map((record) => (
            <div key={record.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 sm:px-6 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300"><Clock className="h-4.5 w-4.5" /></div>
                <div>
                  <p className="font-black text-sm text-slate-900 dark:text-slate-100">{formatDate(record.date)}</p>
                  <p className="mt-0.5 text-xs font-semibold text-slate-600 dark:text-slate-400">
                    {!record.check_in_time && record.check_out_time
                      ? `Chưa vào · Ra ${formatTime(record.check_out_time)}`
                      : `Vào ${formatTime(record.check_in_time)}${record.check_out_time ? ` · Ra ${formatTime(record.check_out_time)}` : ' · Thiếu checkout'}`}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge className="bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 font-bold">{sourceLabel(record)}</Badge>
                <Badge className={
                  !record.check_in_time && record.check_out_time
                    ? 'bg-slate-200 dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 font-bold'
                    : record.approved_by_lead
                    ? 'bg-emerald-100 dark:bg-emerald-950/60 border border-emerald-300 dark:border-emerald-700 text-emerald-800 dark:text-emerald-300 font-bold'
                    : 'bg-amber-100 dark:bg-amber-950/60 border border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-300 font-bold'
                }>
                  {!record.check_in_time && record.check_out_time ? 'Chờ máy chấm công' : record.approved_by_lead ? 'Đã xác nhận' : 'Chờ đối soát'}
                </Badge>
              </div>
            </div>
          ))}</div>
        )}
      </Card>
    </div>
  );
}

function InfoRow({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return <div className="flex items-center gap-3 rounded-xl border-2 border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3.5 py-3"><span className="text-slate-400">{icon}</span><div className="min-w-0"><p className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">{label}</p><p className="truncate text-sm font-black text-slate-900 dark:text-slate-100">{value}</p></div></div>;
}
