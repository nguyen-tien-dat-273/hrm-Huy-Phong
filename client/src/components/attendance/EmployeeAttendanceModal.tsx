import { useMemo } from 'react';
import { getDaysInMonth } from 'date-fns';
import { CalendarDays, Clock, AlertTriangle, Briefcase, UserCheck, Flame } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Avatar } from '@/components/ui/Avatar';
import { LEAVE_TYPE_CONFIG } from '@/lib/leave';
import { formatTime } from '@/lib/utils';
import type { EmployeeAttendanceRollup, DetailedLateRecord, DetailedOtRecord, DetailedLeaveRecord } from '@/lib/attendanceReportData';
import type { Attendance } from '@/types';

interface EmployeeAttendanceModalProps {
  open: boolean;
  onClose: () => void;
  rollup: EmployeeAttendanceRollup | null;
  month: string; // YYYY-MM
  attendances: Attendance[];
  lateRecords: DetailedLateRecord[];
  otRecords: DetailedOtRecord[];
  leaveRecords: DetailedLeaveRecord[];
}

const VI_WEEKDAYS = ['Chủ nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];

const GRADE_BADGE: Record<EmployeeAttendanceRollup['disciplineGrade'], { label: string; color: string }> = {
  EXCELLENT: { label: 'Xuất sắc', color: 'bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800' },
  GOOD: { label: 'Tốt', color: 'bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800' },
  FAIR: { label: 'Trung bình', color: 'bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800' },
  WARNING: { label: 'Cần lưu ý', color: 'bg-red-50 text-red-700 border border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-800' },
};

export function EmployeeAttendanceModal({
  open,
  onClose,
  rollup,
  month,
  attendances,
  lateRecords,
  otRecords,
  leaveRecords,
}: EmployeeAttendanceModalProps) {
  const daysInMonth = useMemo(() => {
    if (!rollup) return 0;
    const [y, m] = month.split('-').map(Number);
    return getDaysInMonth(new Date(y, m - 1, 1));
  }, [month, rollup]);

  // Gom dữ liệu từng ngày trong tháng của nhân sự này
  const calendarDays = useMemo(() => {
    if (!rollup) return [];
    const profile = rollup.profile;
    const days = [];
    const userAttMap = new Map<string, Attendance>();
    for (const a of attendances) {
      if (a.user_id === profile.id) userAttMap.set(a.date, a);
    }

    const userLateMap = new Map<string, DetailedLateRecord>();
    for (const l of lateRecords) {
      if (l.userId === profile.id) userLateMap.set(l.date, l);
    }

    const userOtMap = new Map<string, DetailedOtRecord[]>();
    for (const ot of otRecords) {
      if (ot.userId === profile.id) {
        const list = userOtMap.get(ot.workDate) ?? [];
        list.push(ot);
        userOtMap.set(ot.workDate, list);
      }
    }

    const userLeaveList = leaveRecords.filter((r) => r.userId === profile.id);

    for (let day = 1; day <= daysInMonth; day++) {
      const iso = `${month}-${String(day).padStart(2, '0')}`;
      const d = new Date(`${iso}T00:00:00`);
      const weekdayIdx = d.getDay();
      const isWeekend = weekdayIdx === 0 || weekdayIdx === 6;

      const att = userAttMap.get(iso);
      const late = userLateMap.get(iso);
      const ots = userOtMap.get(iso) ?? [];
      const leave = userLeaveList.find((l) => l.startDate <= iso && l.endDate >= iso);

      let durationHours: number | null = null;
      if (att?.check_in_time && att.check_out_time) {
        const st = new Date(att.check_in_time).getTime();
        const en = new Date(att.check_out_time).getTime();
        if (en > st) {
          durationHours = Math.round(((en - st) / 3_600_000) * 10) / 10;
        }
      }

      days.push({
        date: iso,
        day,
        weekday: VI_WEEKDAYS[weekdayIdx],
        isWeekend,
        att,
        late,
        ots,
        leave,
        durationHours,
      });
    }
    return days;
  }, [attendances, daysInMonth, lateRecords, leaveRecords, month, otRecords, rollup]);

  if (!rollup) return null;
  const { profile } = rollup;
  const gradeInfo = GRADE_BADGE[rollup.disciplineGrade];

  return (
    <Modal open={open} onClose={onClose} title="Chi tiết công cá nhân" size="2xl" square>
      <div className="space-y-4">
        {/* Header Hồ sơ nhân sự - vuông vức */}
        <div className="flex flex-wrap items-center justify-between gap-3 border border-slate-200 bg-[#FCFAF8] p-3.5 dark:border-slate-800 dark:bg-slate-900/60 rounded-none">
          <div className="flex items-center gap-3">
            <Avatar name={profile.name} url={profile.avatar_url} size="md" />
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">{profile.name}</h3>
                {profile.employee_code && (
                  <span className="border border-slate-200 bg-white px-1.5 py-0.2 font-mono text-[10px] text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 rounded-md">
                    {profile.employee_code}
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                {profile.department || 'Chưa phân phòng ban'} · Tháng {month.slice(5, 7)}/{month.slice(0, 4)}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500 dark:text-slate-400">Xếp loại:</span>
            <span className={`px-2.5 py-0.5 text-xs font-bold rounded-full ${gradeInfo.color}`}>
              {gradeInfo.label}
            </span>
          </div>
        </div>

        {/* Thẻ số liệu tổng hợp trong tháng - vuông vức */}
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
          <div className="border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900 rounded-none">
            <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
              <CalendarDays className="h-3.5 w-3.5 text-indigo-600" />
              <span>Ngày công</span>
            </div>
            <div className="mt-1.5 flex items-baseline gap-1 font-mono">
              <span className="text-lg font-bold text-slate-800 dark:text-slate-100">{rollup.workDays}</span>
              <span className="text-xs text-slate-400">/ {rollup.standardDays}</span>
            </div>
            <div className="mt-0.5 text-[11px] font-semibold text-indigo-600 dark:text-indigo-400">
              {rollup.completionRate}% chuẩn
            </div>
          </div>

          <div className="border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900 rounded-none">
            <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
              <Clock className="h-3.5 w-3.5 text-slate-600" />
              <span>Tổng giờ</span>
            </div>
            <div className="mt-1.5 flex items-baseline gap-1 font-mono">
              <span className="text-lg font-bold text-slate-800 dark:text-slate-100">{rollup.totalHours}</span>
              <span className="text-xs text-slate-400">h</span>
            </div>
            <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
              {rollup.workDays > 0 ? (rollup.totalHours / rollup.workDays).toFixed(1) : 0}h / ngày
            </div>
          </div>

          <div className="border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900 rounded-none">
            <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
              <span>Đi muộn</span>
            </div>
            <div className="mt-1.5 flex items-baseline gap-1 font-mono">
              <span className={`text-lg font-bold ${rollup.lateCount > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-slate-800 dark:text-slate-100'}`}>
                {rollup.lateCount}
              </span>
              <span className="text-xs text-slate-400">lần ({rollup.lateMinutes}p)</span>
            </div>
            <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
              {rollup.lateExcusedCount} có phép · {rollup.lateUnexcusedCount} vi phạm
            </div>
          </div>

          <div className="border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900 rounded-none">
            <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
              <Flame className="h-3.5 w-3.5 text-orange-600" />
              <span>Giờ OT</span>
            </div>
            <div className="mt-1.5 flex items-baseline gap-1 font-mono">
              <span className={`text-lg font-bold ${rollup.otHoursTotal > 0 ? 'text-orange-600 dark:text-orange-400' : 'text-slate-800 dark:text-slate-100'}`}>
                {rollup.otHoursTotal}
              </span>
              <span className="text-xs text-slate-400">h</span>
            </div>
            <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
              {rollup.otHoursWeekday}h ngày · {rollup.otHoursWeekend}h nghỉ
            </div>
          </div>

          <div className="border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900 rounded-none">
            <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
              <Briefcase className="h-3.5 w-3.5 text-violet-600" />
              <span>Nghỉ phép</span>
            </div>
            <div className="mt-1.5 flex items-baseline gap-1 font-mono">
              <span className="text-lg font-bold text-slate-800 dark:text-slate-100">{rollup.leaveDaysTotal}</span>
              <span className="text-xs text-slate-400">ngày</span>
            </div>
            <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
              {rollup.leaveDaysAnnual} phép năm · {rollup.leaveDaysSick} ốm
            </div>
          </div>

          <div className="border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900 rounded-none">
            <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
              <UserCheck className="h-3.5 w-3.5 text-emerald-600" />
              <span>Đúng giờ</span>
            </div>
            <div className="mt-1.5 flex items-baseline gap-1 font-mono">
              <span className="text-lg font-bold text-emerald-600 dark:text-emerald-400">
                {rollup.punctualityRate}%
              </span>
            </div>
            <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
              Quên checkout: {rollup.missingCheckoutCount} lần
            </div>
          </div>
        </div>

        {/* Lịch chi tiết từng ngày trong tháng */}
        <div className="border-2 border-slate-400 dark:border-slate-600 rounded-xl overflow-hidden shadow-sm">
          <div className="border-b-2 border-[#bf1f2b] dark:border-[#e66a76] bg-[#fdf2f4] dark:bg-[#201114] px-3.5 py-2.5 text-xs font-black uppercase tracking-wider text-[#5c0f16] dark:text-[#fde8ea]">
            Chi tiết ngày làm việc ({month.slice(5, 7)}/{month.slice(0, 4)})
          </div>
          <div className="max-h-[360px] overflow-y-auto">
            <table className="w-full text-left text-sm border-collapse">
              <thead className="sticky top-0 z-10 border-b-2 border-[#bf1f2b] dark:border-[#e66a76] bg-[#fdf2f4] dark:bg-[#201114] text-xs font-black uppercase tracking-wider text-[#5c0f16] dark:text-[#fde8ea] shadow-[inset_0_-2px_0_#bf1f2b] dark:shadow-[inset_0_-2px_0_#e66a76]">
                <tr>
                  <th className="px-3.5 py-2.5">Ngày</th>
                  <th className="px-3 py-2.5">Thứ</th>
                  <th className="px-3 py-2.5">Vào</th>
                  <th className="px-3 py-2.5">Ra</th>
                  <th className="px-3 py-2.5 text-right">Giờ làm</th>
                  <th className="px-3 py-2.5">Ghi nhận vi phạm / OT / Nghỉ phép</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-300 dark:divide-slate-700 bg-white dark:bg-slate-900 font-semibold">
                {calendarDays.map((d) => {
                  const hasCheckin = Boolean(d.att?.check_in_time);
                  const isLate = Boolean(d.late);
                  const hasLeave = Boolean(d.leave);

                  return (
                    <tr
                      key={d.date}
                      className={`group transition-colors hover:bg-slate-100/80 dark:hover:bg-slate-800/60 ${
                        d.isWeekend ? 'bg-slate-100/40 dark:bg-slate-800/30' : ''
                      }`}
                    >
                      <td className="px-3.5 py-2 font-mono font-bold text-slate-900 dark:text-slate-100 text-sm">
                        {String(d.day).padStart(2, '0')}/{month.slice(5, 7)}
                      </td>
                      <td className={`px-3 py-2 font-bold ${d.isWeekend ? 'text-amber-600 dark:text-amber-400' : 'text-slate-600 dark:text-slate-300'}`}>
                        {d.weekday}
                      </td>
                      <td className="px-3 py-2">
                        {d.att?.check_in_time ? (
                          <span className={`font-mono font-bold text-sm ${isLate ? 'text-red-600 dark:text-red-400' : 'text-slate-900 dark:text-slate-100'}`}>
                            {formatTime(d.att.check_in_time)}
                          </span>
                        ) : (
                          <span className="text-slate-400 dark:text-slate-500 font-bold">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {d.att?.check_out_time ? (
                          <span className="font-mono font-bold text-sm text-slate-900 dark:text-slate-100">
                            {formatTime(d.att.check_out_time)}
                          </span>
                        ) : hasCheckin ? (
                          <span className="border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-bold text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300 rounded-full">
                            Thiếu checkout
                          </span>
                        ) : (
                          <span className="text-slate-400 dark:text-slate-500 font-bold">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right font-mono font-black text-sm text-slate-900 dark:text-slate-100">
                        {d.durationHours != null ? `${d.durationHours}h` : '—'}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {/* Tag đi muộn bo tròn */}
                          {d.late && (
                            <span
                              className={`border px-2 py-0.5 text-[11px] font-bold rounded-full ${
                                d.late.requestStatus === 'APPROVED'
                                  ? 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300'
                                  : d.late.isAfterCutoff
                                  ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300'
                                  : 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300'
                              }`}
                            >
                              Muộn {d.late.lateMinutes}p
                              {d.late.isAfterCutoff && ' (sau 9h)'}
                              {d.late.requestStatus === 'APPROVED' && ' · Có phép'}
                              {d.late.requestStatus === 'NO_REQUEST' && ' · Vi phạm'}
                            </span>
                          )}

                          {/* Tag OT bo tròn */}
                          {d.ots.map((ot) => (
                            <span
                              key={ot.id}
                              className="border border-orange-200 bg-orange-50 px-2 py-0.5 text-[11px] font-bold text-orange-700 dark:border-orange-800 dark:bg-orange-950/40 dark:text-orange-300 rounded-full"
                            >
                              OT +{ot.hours}h ({ot.otTypeRate}%)
                            </span>
                          ))}

                          {/* Tag Nghỉ phép bo tròn */}
                          {d.leave && (
                            <span
                              className={`border px-2 py-0.5 text-[11px] font-bold rounded-full ${
                                LEAVE_TYPE_CONFIG[d.leave.leaveType]?.color ?? 'bg-slate-100 text-slate-700'
                              }`}
                            >
                              {LEAVE_TYPE_CONFIG[d.leave.leaveType]?.label ?? 'Nghỉ'}
                              {d.leave.halfDay ? ' (0.5d)' : ''}
                            </span>
                          )}

                          {!hasCheckin && !hasLeave && !d.isWeekend && (
                            <span className="text-[11px] text-slate-400 dark:text-slate-500">
                              Vắng mặt
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </Modal>
  );
}
