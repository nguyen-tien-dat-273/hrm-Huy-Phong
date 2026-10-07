import { useEffect, useMemo, useState } from 'react';
import { describeDbErrorOrNull } from '@/lib/dbError';
import { ChevronLeft, ChevronRight, CalendarDays, TriangleAlert, NotebookPen } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Avatar } from '@/components/ui/Avatar';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import { supabase } from '@/lib/supabase';
import { useRealtimeSync } from '@/hooks/useRealtimeSync';
import { addDays, startOfWeek, weekDays, UNLOGGED_TOLERANCE_HOURS, attendanceHours, formatHours } from '@/lib/worklog';
import { toDateString } from '@/lib/utils';
import type { Attendance, Profile } from '@/types';

interface WorklogRow {
  user_id: string;
  work_date: string;
  hours: number;
}

/**
 * Báo cáo giờ theo người theo tuần, đối chiếu với chấm công.
 *
 * Câu hỏi trang này trả lời: ai đang quá tải, ai chưa khai giờ, và giờ có mặt
 * có khớp với giờ đã ghi vào tác vụ hay không.
 */
export function AdminWorklog() {
  const [anchor, setAnchor] = useState(() => startOfWeek(new Date()));
  const [staff, setStaff] = useState<Profile[]>([]);
  const [logs, setLogs] = useState<WorklogRow[]>([]);
  const [attendance, setAttendance] = useState<Pick<Attendance, 'user_id' | 'date' | 'check_in_time' | 'check_out_time'>[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const days = useMemo(() => weekDays(anchor), [anchor]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor]);

  useRealtimeSync(
    [{ table: 'task_worklogs' }, { table: 'attendance' }],
    () => load(true),
  );

  const load = async (silent = false) => {
    if (!silent) setLoading(true);
    const from = days[0].key;
    const to = days[6].key;

    const [staffResult, logResult, attResult] = await Promise.all([
      supabase.from('profiles_directory').select('*').eq('is_active', true).order('name'),
      supabase.from('task_worklogs').select('user_id, work_date, hours').gte('work_date', from).lte('work_date', to),
      supabase.from('attendance').select('user_id, date, check_in_time, check_out_time').gte('date', from).lte('date', to),
    ]);

    const error = describeDbErrorOrNull(staffResult.error) ?? describeDbErrorOrNull(logResult.error) ?? describeDbErrorOrNull(attResult.error) ?? null;
    setLoadError(error);
    setStaff((staffResult.data || []) as Profile[]);
    setLogs((logResult.data || []) as WorklogRow[]);
    setAttendance((attResult.data || []) as typeof attendance);
    setLoading(false);
  };

  const loggedOn = (userId: string, dateKey: string) =>
    logs
      .filter((l) => l.user_id === userId && l.work_date === dateKey)
      .reduce((sum, l) => sum + Number(l.hours), 0);

  const presentOn = (userId: string, dateKey: string) =>
    attendanceHours(attendance.find((a) => a.user_id === userId && a.date === dateKey));

  const today = toDateString(new Date());
  const isThisWeek = toDateString(startOfWeek(new Date())) === days[0].key;

  /** Tổng giờ chưa khai của cả tuần — chỉ tính ngày đã qua và có chấm công đủ. */
  const totalUnlogged = staff.reduce((sum, person) => {
    for (const day of days) {
      if (day.key > today) continue;
      const present = presentOn(person.id, day.key);
      if (present === null) continue;
      const gap = present - loggedOn(person.id, day.key);
      if (gap > UNLOGGED_TOLERANCE_HOURS) sum += gap;
    }
    return sum;
  }, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <button onClick={() => setAnchor(addDays(anchor, -7))} className="p-2 rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-50 transition-colors" aria-label="Tuần trước">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button onClick={() => setAnchor(addDays(anchor, 7))} className="p-2 rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-50 transition-colors" aria-label="Tuần sau">
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
        <p className="font-display text-base font-bold text-slate-800">{days[0].label} — {days[6].label}</p>
        {!isThisWeek && (
          <Button variant="outline" size="sm" onClick={() => setAnchor(startOfWeek(new Date()))}>
            <CalendarDays className="w-4 h-4" />
            Về tuần này
          </Button>
        )}

        {!loading && totalUnlogged > UNLOGGED_TOLERANCE_HOURS && (
          <span className="ml-auto flex items-center gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-1.5">
            <TriangleAlert className="w-4 h-4" />
            {formatHours(Math.round(totalUnlogged * 10) / 10)} có mặt nhưng chưa khai
          </span>
        )}
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-5 space-y-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
          ) : loadError ? (
            <ErrorState message={loadError} onRetry={load} />
          ) : staff.length === 0 ? (
            <EmptyState icon={<NotebookPen className="w-8 h-8" />} title="Chưa có nhân sự" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse min-w-[820px]">
                <thead>
                  <tr className="bg-slate-50/70">
                    <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-4 py-3 sticky left-0 bg-slate-50/70 z-10 min-w-[180px]">
                      Nhân viên
                    </th>
                    {days.map((d) => (
                      <th key={d.key} className="text-center text-xs font-semibold px-2 py-3 min-w-[86px]">
                        <span className="block text-slate-600">{d.weekdayLabel}</span>
                        <span className="block text-[11px] font-normal text-slate-400">{d.label}</span>
                      </th>
                    ))}
                    <th className="text-center text-xs font-semibold text-slate-500 uppercase tracking-wider px-3 py-3 min-w-[86px]">
                      Tổng
                    </th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-slate-50">
                  {staff.map((person) => {
                    const weekTotal = days.reduce((sum, d) => sum + loggedOn(person.id, d.key), 0);
                    return (
                      <tr key={person.id} className="hover:bg-slate-50/40 transition-colors">
                        <td className="px-4 py-2.5 sticky left-0 bg-white z-10">
                          <div className="flex items-center gap-2.5">
                            <Avatar name={person.name} url={person.avatar_url} size="sm" />
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-slate-800 truncate">{person.name}</p>
                              {person.department && <p className="text-xs text-slate-400 truncate">{person.department}</p>}
                            </div>
                          </div>
                        </td>

                        {days.map((d) => {
                          const logged = loggedOn(person.id, d.key);
                          const present = presentOn(person.id, d.key);
                          const future = d.key > today;
                          // Có mặt mà chưa khai giờ — chỗ cần hỏi lại.
                          const unlogged = !future && present !== null && present - logged > UNLOGGED_TOLERANCE_HOURS;

                          return (
                            <td key={d.key} className="px-2 py-2.5 text-center">
                              {logged > 0 ? (
                                <span className={`text-sm font-semibold ${unlogged ? 'text-amber-600' : 'text-slate-700'}`}>
                                  {formatHours(logged)}
                                </span>
                              ) : (
                                <span className={`text-sm ${unlogged ? 'text-amber-500' : 'text-slate-300'}`}>—</span>
                              )}
                              {unlogged && (
                                <span className="block text-[10px] text-amber-600" title="Giờ có mặt theo chấm công">
                                  có mặt {formatHours(present!)}
                                </span>
                              )}
                            </td>
                          );
                        })}

                        <td className="px-3 py-2.5 text-center">
                          <span className="text-sm font-bold text-slate-800">{formatHours(weekTotal)}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>

                <tfoot className="bg-slate-50/70 border-t-2 border-slate-200">
                  <tr>
                    <td className="px-4 py-2.5 sticky left-0 bg-slate-50/70 z-10 text-xs font-semibold text-slate-600">
                      Tổng toàn đội
                    </td>
                    {days.map((d) => {
                      const dayTotal = staff.reduce((sum, p) => sum + loggedOn(p.id, d.key), 0);
                      return (
                        <td key={d.key} className="px-2 py-2.5 text-center">
                          <span className={`text-sm font-semibold ${dayTotal === 0 ? 'text-slate-300' : 'text-slate-700'}`}>
                            {dayTotal > 0 ? formatHours(dayTotal) : '—'}
                          </span>
                        </td>
                      );
                    })}
                    <td className="px-3 py-2.5 text-center">
                      <span className="text-sm font-bold text-slate-800">
                        {formatHours(staff.reduce((sum, p) => sum + days.reduce((s, d) => s + loggedOn(p.id, d.key), 0), 0))}
                      </span>
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-slate-400 leading-relaxed">
        Ô màu cam nghĩa là chấm công ghi nhận có mặt nhưng nhật ký khai ít hơn quá {UNLOGGED_TOLERANCE_HOURS} giờ.
        Ngày chưa tới và ngày chưa check-out không được tính.
      </p>
    </div>
  );
}
