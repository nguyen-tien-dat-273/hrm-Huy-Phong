import { useEffect, useMemo, useState } from 'react';
import { FileSpreadsheet, Table as TableIcon, Lock, Unlock, ScanSearch } from 'lucide-react';
import { startOfMonth, endOfMonth, format, getDaysInMonth } from 'date-fns';
import { Card, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { TableSkeleton } from '@/components/ui/Skeleton';
import { MonthNav } from '@/components/ui/MonthNav';
import { useToast } from '@/contexts/ToastContext';
import { useAuth } from '@/contexts/AuthContext';
import { useAppSettings } from '@/contexts/SettingsContext';
import { useRealtimeSync } from '@/hooks/useRealtimeSync';
import { supabase } from '@/lib/supabase';
import { describeDbError, describeDbErrorOrNull } from '@/lib/dbError';
import { formatTime, toDateString } from '@/lib/utils';
import { hasAdminFunction } from '@/lib/permissions';
import type { Attendance, AttendanceSession, DailyAssignment, LeaveRequest, Profile } from '@/types';

/** Một ô ngày trên bảng công. */
interface DayCell {
  /** Giờ công đã chốt; null khi không có mặt. */
  hours: number | null;
  /** Giờ checkout muộn nhất trong ngày, hiển thị theo mẫu bảng công tháng. */
  checkoutTime: string | null;
  /** Có check-in nhưng chưa/không check-out — vẫn tính ngày công, giờ = 0. */
  missingCheckout: boolean;
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

type PeriodStatus = 'OPEN' | 'REVIEW' | 'LOCKED';
interface TimesheetPeriod { id: string; month_start: string; status: PeriodStatus; locked_at: string | null }

const hoursBetween = (a: Attendance, sessions: AttendanceSession[]): number => {
  const ownSessions = sessions.filter((session) => session.attendance_id === a.id && session.ended_at);
  const milliseconds = ownSessions.length > 0
    ? ownSessions.reduce((sum, session) => sum + Math.max(0, new Date(session.ended_at!).getTime() - new Date(session.started_at).getTime()), 0)
    : a.check_in_time && a.check_out_time ? new Date(a.check_out_time).getTime() - new Date(a.check_in_time).getTime() : 0;
  return Math.round((milliseconds / 3600000) * 10) / 10;
};

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
  const [exceptions, setExceptions] = useState(0);
  const [changingPeriod, setChangingPeriod] = useState(false);

  const monthEndStr = toDateString(endOfMonth(monthStart));
  const monthStartStr = toDateString(monthStart);
  const daysInMonth = getDaysInMonth(monthStart);
  const monthLabel = format(monthStart, 'MM/yyyy');

  const loadData = async (silent = false) => {
    if (!silent) setLoading(true);
    const [profRes, attRes, leaveRes, asgRes, periodRes, exceptionRes] = await Promise.all([
      supabase.from('profiles').select('*').eq('is_active', true).order('name'),
      // Bảng công chính thức dùng cùng tập dữ liệu với Payroll.
      supabase.from('attendance').select('*').eq('status', 'completed').eq('approved_by_lead', true).gte('date', monthStartStr).lte('date', monthEndStr),
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
      supabase.from('attendance').select('id', { count: 'exact', head: true }).gte('date', monthStartStr).lte('date', monthEndStr).or('status.eq.active,approved_by_lead.eq.false,check_out_time.is.null'),
    ]);

    setLoadError(
      describeDbErrorOrNull(profRes.error)
        ?? describeDbErrorOrNull(attRes.error)
        ?? describeDbErrorOrNull(leaveRes.error)
        ?? describeDbErrorOrNull(asgRes.error),
    );
    const attendanceRows = (attRes.data || []) as Attendance[];
    const sessionRes = attendanceRows.length > 0
      ? await supabase.from('attendance_sessions').select('*').in('attendance_id', attendanceRows.map((row) => row.id))
      : { data: [], error: null };
    setProfiles((profRes.data || []) as Profile[]);
    setAttendance(attendanceRows);
    setSessions(sessionRes.error ? [] : (sessionRes.data || []) as AttendanceSession[]);
    setLeaves(((leaveRes.data || []) as LeaveRequest[]).filter((leave) => !leave.is_cancelled));
    setAssignments((asgRes.data || []) as DailyAssignment[]);
    setPeriod((periodRes.data as TimesheetPeriod | null) ?? null);
    setPeriodSupported(!periodRes.error);
    setExceptions(exceptionRes.count ?? 0);
    setLoading(false);
  };

  useEffect(() => { loadData(); }, [monthStartStr]); // eslint-disable-line react-hooks/exhaustive-deps

  useRealtimeSync(
    [{ table: 'attendance' }, { table: 'leave_requests' }, { table: 'daily_assignments' }, { table: 'timesheet_periods' }],
    () => loadData(true),
    { channelKey: 'timesheet' },
  );

  /** Ngày (Date) của cột thứ i, 0-based. */
  const dayDate = (i: number) => new Date(monthStart.getFullYear(), monthStart.getMonth(), i + 1);
  const isWeekend = (i: number) => [0, 6].includes(dayDate(i).getDay());

  const rows: EmployeeRow[] = useMemo(() => {
    return profiles.map((profile) => {
      const days: DayCell[] = Array.from({ length: daysInMonth }, () => ({
        hours: null,
        checkoutTime: null,
        missingCheckout: false,
        onLeave: false,
        halfLeave: false,
      }));

      // Nghỉ phép duyệt: đánh dấu ngày thường trong khoảng đơn — nhất quán với
      // cách module nghỉ phép tính số ngày (đã trừ T7/CN).
      for (const lv of leaves) {
        if (lv.user_id !== profile.id) continue;
        for (let i = 0; i < daysInMonth; i++) {
          const ds = toDateString(dayDate(i));
          if (ds >= lv.start_date && ds <= lv.end_date && !isWeekend(i)) {
            days[i].onLeave = true;
            // Nghỉ nửa ngày vẫn là một ngày CÓ phép, nhưng chỉ tính 0.5 công.
            if (lv.half_day) days[i].halfLeave = true;
          }
        }
      }

      for (const a of attendance) {
        if (a.user_id !== profile.id) continue;
        const idx = Number(a.date.slice(8, 10)) - 1;
        if (idx < 0 || idx >= daysInMonth) continue;
        if (a.check_in_time && a.check_out_time) {
          days[idx].hours = (days[idx].hours ?? 0) + hoursBetween(a, sessions);
          if (!days[idx].checkoutTime || new Date(a.check_out_time) > new Date(days[idx].checkoutTime!)) {
            days[idx].checkoutTime = a.check_out_time;
          }
        } else if (a.check_in_time) {
          days[idx].hours ??= 0;
          days[idx].missingCheckout = true;
        }
      }

      const myAsg = assignments.filter((x) => x.user_id === profile.id);
      return {
        profile,
        days,
        workDays: days.filter((d) => d.hours !== null).length,
        totalHours: Math.round(days.reduce((s, d) => s + (d.hours ?? 0), 0) * 10) / 10,
        leaveDays: days.reduce((s, d) => s + (d.onLeave ? (d.halfLeave ? 0.5 : 1) : 0), 0),
        asgTotal: myAsg.length,
        asgDone: myAsg.filter((x) => x.status === 'approved').length,
      };
    });
  }, [profiles, attendance, sessions, leaves, assignments, daysInMonth]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Hàng tổng toàn công ty — cái giám đốc nhìn đầu tiên. */
  const totals = useMemo(
    () => ({
      workDays: rows.reduce((s, r) => s + r.workDays, 0),
      totalHours: Math.round(rows.reduce((s, r) => s + r.totalHours, 0) * 10) / 10,
      leaveDays: rows.reduce((s, r) => s + r.leaveDays, 0),
      asgTotal: rows.reduce((s, r) => s + r.asgTotal, 0),
      asgDone: rows.reduce((s, r) => s + r.asgDone, 0),
    }),
    [rows],
  );

  const periodStatus: PeriodStatus = period?.status ?? 'OPEN';
  const periodMeta: Record<PeriodStatus, { label: string; color: string }> = {
    OPEN: { label: 'Đang mở', color: 'bg-blue-50 text-blue-700' },
    REVIEW: { label: 'Đang đối soát', color: 'bg-amber-50 text-amber-700' },
    LOCKED: { label: 'Đã khóa', color: 'bg-emerald-50 text-emerald-700' },
  };

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
        [`Ký hiệu: HH:mm = giờ checkout cuối ngày · P = nghỉ phép · P/2 = nghỉ nửa ngày · ! = thiếu checkout · trống = vắng`],
        [],
        ['STT', 'Phòng ban', 'Mã nhân viên', 'Tên nhân viên', ...dayHeaders, 'Ngày công', 'Giờ công', 'Nghỉ phép', 'Việc xong/giao'],
        ...rows.map((r, i) => [
          i + 1,
          r.profile.department ?? '',
          r.profile.employee_code ?? '',
          r.profile.name,
          ...r.days.map((d) =>
            d.missingCheckout ? '!' : d.checkoutTime ? formatTime(d.checkoutTime) : d.onLeave ? (d.halfLeave ? 'P/2' : 'P') : '',
          ),
          r.workDays,
          r.totalHours,
          r.leaveDays,
          `${r.asgDone}/${r.asgTotal}`,
        ]),
        [],
        ['', 'TỔNG', '', '', ...dayHeaders.map(() => ''), totals.workDays, totals.totalHours, totals.leaveDays, `${totals.asgDone}/${totals.asgTotal}`],
      ];
      const ws1 = XLSX.utils.aoa_to_sheet(sheet1);
      ws1['!cols'] = [
        { wch: 4 }, { wch: 18 }, { wch: 14 }, { wch: 24 },
        ...dayHeaders.map(() => ({ wch: 7 })),
        { wch: 9 }, { wch: 9 }, { wch: 9 }, { wch: 13 },
      ];

      // ---- Sheet 2: Chi tiết chấm công --------------------------------------
      const nameById = new Map(profiles.map((p) => [p.id, p.name]));
      const detail = [...attendance].sort((a, b) => a.date.localeCompare(b.date) || (nameById.get(a.user_id) ?? '').localeCompare(nameById.get(b.user_id) ?? ''));
      const sheet2: (string | number)[][] = [
        [`CHI TIẾT CHẤM CÔNG THÁNG ${monthLabel}`],
        [],
        ['STT', 'Họ tên', 'Ngày', 'Check-in', 'Check-out', 'Giờ công', 'Trạng thái', 'Quản lý duyệt'],
        ...detail.map((a, i) => [
          i + 1,
          nameById.get(a.user_id) ?? '—',
          a.date,
          formatTime(a.check_in_time),
          a.check_out_time ? formatTime(a.check_out_time) : 'THIẾU',
          hoursBetween(a, sessions),
          a.status === 'completed' ? 'Hoàn thành' : 'Đang làm',
          a.approved_by_lead ? 'Đã duyệt' : 'Chưa',
        ]),
      ];
      const ws2 = XLSX.utils.aoa_to_sheet(sheet2);
      ws2['!cols'] = [{ wch: 4 }, { wch: 24 }, { wch: 11 }, { wch: 9 }, { wch: 9 }, { wch: 8 }, { wch: 11 }, { wch: 13 }];

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
      ws3['!cols'] = [{ wch: 4 }, { wch: 24 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 11 }, { wch: 15 }];

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

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-bold text-slate-800">Bảng công tháng {monthLabel}</h2>
            <Badge className={periodMeta[periodStatus].color}>{periodMeta[periodStatus].label}</Badge>
          </div>
          <p className="text-sm text-slate-500 mt-0.5">
            Mỗi ô ngày hiển thị giờ checkout cuối cùng; chỉ gồm công đã hoàn tất và được quản lý duyệt.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {periodSupported && hasAdminFunction(profile, 'admin.timesheet_lock') && periodStatus === 'OPEN' && (
            <Button variant="outline" onClick={() => setPeriodStatus('REVIEW')} disabled={changingPeriod}><ScanSearch className="w-4 h-4" />Bắt đầu đối soát</Button>
          )}
          {periodSupported && hasAdminFunction(profile, 'admin.timesheet_lock') && periodStatus === 'REVIEW' && (
            <Button onClick={() => setPeriodStatus('LOCKED')} disabled={changingPeriod || exceptions > 0}><Lock className="w-4 h-4" />Khóa kỳ công</Button>
          )}
          {periodSupported && hasAdminFunction(profile, 'admin.timesheet_lock') && periodStatus === 'LOCKED' && (
            <Button variant="outline" onClick={() => setPeriodStatus('OPEN')} disabled={changingPeriod}><Unlock className="w-4 h-4" />Mở lại kỳ</Button>
          )}
          <Button onClick={handleExport} disabled={exporting || rows.length === 0 || periodStatus !== 'LOCKED'} title={periodStatus !== 'LOCKED' ? 'Khóa kỳ công trước khi xuất bản chính thức' : undefined}>
            <FileSpreadsheet className="w-4 h-4" />
            {exporting ? 'Đang xuất…' : 'Xuất bảng công'}
          </Button>
        </div>
      </div>

      {!periodSupported && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">Chưa có quản lý kỳ công. Chạy migration <strong>20260909090000_core_flow_integration.sql</strong> để đối soát và khóa kỳ.</div>
      )}
      {exceptions > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">Còn <strong>{exceptions}</strong> bản ghi đang làm, thiếu checkout hoặc chưa duyệt. Các bản ghi này chưa được tính vào bảng công chính thức.</div>
      )}

      {/* Điều hướng tháng + chú giải */}
      <div className="flex items-center justify-between flex-wrap gap-3 no-print">
        <MonthNav value={monthStart} onChange={setMonthStart} />
        <div className="flex items-center gap-3 flex-wrap text-xs text-slate-500">
          <span className="flex items-center gap-1.5"><span className="h-5 rounded bg-emerald-100 px-1 text-emerald-700 text-[10px] font-bold flex items-center justify-center">17:30</span> giờ checkout</span>
          <span className="flex items-center gap-1.5"><span className="w-4 h-4 rounded bg-amber-100 text-amber-700 text-[10px] font-bold flex items-center justify-center">!</span> thiếu checkout</span>
          <span className="flex items-center gap-1.5"><span className="w-4 h-4 rounded bg-violet-100 text-violet-700 text-[10px] font-bold flex items-center justify-center">P</span> nghỉ phép</span>
          <span className="flex items-center gap-1.5"><span className="w-4 h-4 rounded bg-slate-100" /> cuối tuần</span>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <EmptyState
              icon={<TableIcon className="w-8 h-8" />}
              title="Chưa có nhân sự"
              description="Tạo tài khoản trong Quản lý User rồi quay lại đây."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="border-collapse" style={{ minWidth: `${720 + daysInMonth * 48}px` }}>
                <thead>
                  <tr className="border-b border-slate-100">
                    <th className="sticky left-0 z-20 w-12 min-w-12 bg-white px-2 py-3 text-center text-xs font-semibold uppercase text-slate-500">STT</th>
                    <th className="sticky left-12 z-20 min-w-[140px] bg-white px-3 py-3 text-left text-xs font-semibold uppercase text-slate-500">Phòng ban</th>
                    <th className="sticky left-[188px] z-20 min-w-[100px] bg-white px-3 py-3 text-left text-xs font-semibold uppercase text-slate-500">Mã NV</th>
                    <th className="sticky left-[288px] z-20 min-w-[190px] bg-white px-4 py-3 text-left text-xs font-semibold uppercase text-slate-500">Tên nhân viên</th>
                    {Array.from({ length: daysInMonth }, (_, i) => (
                      <th
                        key={i}
                        className={`w-12 min-w-12 px-0 py-2 text-center text-[11px] font-semibold ${
                          isWeekend(i) ? 'bg-slate-50 text-slate-400' : 'text-slate-500'
                        }`}
                      >
                        {i + 1}
                      </th>
                    ))}
                    <th className="text-center text-xs font-semibold text-slate-500 uppercase px-2 py-3">Công</th>
                    <th className="text-center text-xs font-semibold text-slate-500 uppercase px-2 py-3">Giờ</th>
                    <th className="text-center text-xs font-semibold text-slate-500 uppercase px-2 py-3">Phép</th>
                    <th className="text-center text-xs font-semibold text-slate-500 uppercase px-2 py-3">Việc</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {rows.map((r, rowIndex) => (
                    <tr key={r.profile.id}>
                      <td className="sticky left-0 z-10 bg-white px-2 py-2.5 text-center text-xs text-slate-500">{rowIndex + 1}</td>
                      <td className="sticky left-12 z-10 max-w-[140px] bg-white px-3 py-2.5 text-xs text-slate-600">
                        <span className="block truncate" title={r.profile.department || 'Chưa phân phòng ban'}>{r.profile.department || '—'}</span>
                      </td>
                      <td className="sticky left-[188px] z-10 bg-white px-3 py-2.5 text-xs font-medium text-slate-500">{r.profile.employee_code || '—'}</td>
                      <td className="sticky left-[288px] z-10 bg-white px-4 py-2.5">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <Avatar name={r.profile.name} url={r.profile.avatar_url} size="sm" />
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-slate-800 truncate">{r.profile.name}</p>
                          </div>
                        </div>
                      </td>
                      {r.days.map((d, i) => (
                        <td key={i} className={`text-center px-0 py-2.5 ${isWeekend(i) ? 'bg-slate-50/70' : ''}`}>
                          {d.missingCheckout ? (
                            <span title="Có check-in nhưng thiếu check-out" className="inline-flex w-6 h-6 rounded bg-amber-100 text-amber-700 text-[11px] font-bold items-center justify-center">!</span>
                          ) : d.checkoutTime ? (
                            <span
                              title={`Checkout ${formatTime(d.checkoutTime)} · ${d.hours ?? 0} giờ công`}
                              className={`inline-flex h-6 min-w-10 rounded px-1 text-[11px] font-bold items-center justify-center ${
                                (d.hours ?? 0) >= standardHoursPerDay ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-50 text-blue-600'
                              }`}
                            >
                              {formatTime(d.checkoutTime)}
                            </span>
                          ) : d.onLeave ? (
                            <span
                              title={d.halfLeave ? 'Nghỉ phép nửa ngày (đã duyệt)' : 'Nghỉ phép đã duyệt'}
                              className="inline-flex w-6 h-6 rounded bg-violet-100 text-violet-700 text-[11px] font-bold items-center justify-center"
                            >
                              {d.halfLeave ? '½' : 'P'}
                            </span>
                          ) : (
                            <span className="text-slate-200 text-xs">·</span>
                          )}
                        </td>
                      ))}
                      <td className="text-center px-2 py-2.5 text-sm font-semibold text-slate-700 tabular-nums">{r.workDays}</td>
                      <td className="text-center px-2 py-2.5 text-sm font-semibold text-slate-700 tabular-nums">{r.totalHours}</td>
                      <td className="text-center px-2 py-2.5 text-sm text-violet-600 tabular-nums">{r.leaveDays || '—'}</td>
                      <td className="text-center px-2 py-2.5 text-sm tabular-nums">
                        {r.asgTotal > 0 ? (
                          <span className={r.asgDone === r.asgTotal ? 'text-emerald-600 font-semibold' : 'text-amber-600 font-semibold'}>
                            {r.asgDone}/{r.asgTotal}
                          </span>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-slate-200 bg-slate-50/60">
                    <td colSpan={4} className="px-4 py-3 text-sm font-bold text-slate-700 sticky left-0 bg-slate-50 z-10">
                      Tổng ({rows.length} nhân sự)
                    </td>
                    <td colSpan={daysInMonth} />
                    <td className="text-center px-2 py-3 text-sm font-bold text-slate-800 tabular-nums">{totals.workDays}</td>
                    <td className="text-center px-2 py-3 text-sm font-bold text-slate-800 tabular-nums">{totals.totalHours}</td>
                    <td className="text-center px-2 py-3 text-sm font-bold text-violet-700 tabular-nums">{totals.leaveDays || '—'}</td>
                    <td className="text-center px-2 py-3 text-sm font-bold text-slate-800 tabular-nums">
                      {totals.asgTotal > 0 ? `${totals.asgDone}/${totals.asgTotal}` : '—'}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
