import { useEffect, useMemo, useState } from 'react';
import {
  BarChart, Bar, PieChart, Pie, Cell, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from 'recharts';
import { ClipboardList } from 'lucide-react';
import { startOfMonth, endOfMonth, addMonths, format } from 'date-fns';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { MonthNav } from '@/components/ui/MonthNav';
import { Skeleton } from '@/components/ui/Skeleton';
import { ErrorState } from '@/components/ui/ErrorState';
import { useAuth } from '@/contexts/AuthContext';
import { useRealtimeSync } from '@/hooks/useRealtimeSync';
import { supabase } from '@/lib/supabase';
import { describeDbError, describeDbErrorOrNull } from '@/lib/dbError';
import { toDateString } from '@/lib/utils';
import type { Task, Attendance, AttendanceSession, DailyAssignment } from '@/types';

export function StaffReports() {
  const { profile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [taskStatusData, setTaskStatusData] = useState<{ name: string; value: number; color: string }[]>([]);
  const [weeklyData, setWeeklyData] = useState<{ day: string; completed: number }[]>([]);
  const [attendanceData, setAttendanceData] = useState<{ date: string; hours: number }[]>([]);

  // ---- Công việc được giao theo tháng ----
  const [monthStart, setMonthStart] = useState(() => startOfMonth(new Date()));
  const [monthAsg, setMonthAsg] = useState<DailyAssignment[]>([]);
  /** 6 tháng gần nhất để vẽ xu hướng tỷ lệ hoàn thành. */
  const [halfYearAsg, setHalfYearAsg] = useState<DailyAssignment[]>([]);
  const [monthLoading, setMonthLoading] = useState(true);
  const [monthError, setMonthError] = useState<string | null>(null);

  useEffect(() => {
    if (profile) loadData();
  }, [profile]);

  useEffect(() => {
    if (profile) loadMonthData();
  }, [profile, monthStart]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadMonthData = async (silent = false) => {
    if (!silent) setMonthLoading(true);
    const sixMonthsAgo = startOfMonth(addMonths(new Date(), -5));
    const [{ data: month, error: monthQueryError }, { data: half, error: halfQueryError }] = await Promise.all([
      supabase
        .from('daily_assignments')
        .select('work_date, status')
        .eq('user_id', profile?.id)
        .gte('work_date', toDateString(monthStart))
        .lte('work_date', toDateString(endOfMonth(monthStart))),
      supabase
        .from('daily_assignments')
        .select('work_date, status')
        .eq('user_id', profile?.id)
        .gte('work_date', toDateString(sixMonthsAgo)),
    ]);
    setMonthError(monthQueryError ? describeDbError(monthQueryError) : halfQueryError ? describeDbError(halfQueryError) : null);
    setMonthAsg((month || []) as DailyAssignment[]);
    setHalfYearAsg((half || []) as DailyAssignment[]);
    setMonthLoading(false);
  };

  const monthTotals = useMemo(() => {
    const total = monthAsg.length;
    const approved = monthAsg.filter((a) => a.status === 'approved').length;
    const rejected = monthAsg.filter((a) => a.status === 'rejected').length;
    return { total, approved, rejected, rate: total > 0 ? Math.round((approved / total) * 100) : 0 };
  }, [monthAsg]);

  /** Tỷ lệ hoàn thành từng tháng, 6 tháng gần nhất — thấy mình tiến hay lùi. */
  const monthlyTrend = useMemo(() => {
    return Array.from({ length: 6 }, (_, i) => {
      const m = startOfMonth(addMonths(new Date(), i - 5));
      const key = format(m, 'yyyy-MM');
      const inMonth = halfYearAsg.filter((a) => a.work_date.startsWith(key));
      const approved = inMonth.filter((a) => a.status === 'approved').length;
      return {
        month: format(m, 'MM/yy'),
        rate: inMonth.length > 0 ? Math.round((approved / inMonth.length) * 100) : 0,
        total: inMonth.length,
      };
    });
  }, [halfYearAsg]);

  const loadData = async (silent = false) => {
    if (!silent) setLoading(true);

    const { data: tasks, error: tasksError } = await supabase
      .from('tasks')
      .select('*')
      .eq('assignee_id', profile?.id);

    const taskList = (tasks || []) as Task[];

    // Task status distribution
    setTaskStatusData([
      { name: 'Cần làm', value: taskList.filter((t) => t.status === 'todo').length, color: '#94a3b8' },
      { name: 'Đang làm', value: taskList.filter((t) => t.status === 'in_progress').length, color: '#3b82f6' },
      { name: 'Đang duyệt', value: taskList.filter((t) => t.status === 'in_review').length, color: '#f59e0b' },
      { name: 'Hoàn thành', value: taskList.filter((t) => t.status === 'done').length, color: '#10b981' },
    ]);

    // Weekly completed tasks
    const days: { day: string; completed: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateStr = toDateString(date);
      const count = taskList.filter((t) => t.status === 'done' && t.updated_at.slice(0, 10) === dateStr).length;
      days.push({ day: date.toLocaleDateString('vi-VN', { weekday: 'short' }), completed: count });
    }
    setWeeklyData(days);

    // Attendance hours
    const { data: attData, error: attendanceError } = await supabase
      .from('attendance')
      .select('*')
      .eq('user_id', profile?.id)
      .order('date', { ascending: false })
      .limit(7);

    const attList = (attData || []) as Attendance[];
    const sessionResult = attList.length > 0
      ? await supabase.from('attendance_sessions').select('*').in('attendance_id', attList.map((attendance) => attendance.id))
      : { data: [], error: null };
    setLoadError(
      describeDbErrorOrNull(tasksError)
        ?? describeDbErrorOrNull(attendanceError)
        ?? describeDbErrorOrNull(sessionResult.error),
    );
    const sessions = sessionResult.error ? [] : (sessionResult.data || []) as AttendanceSession[];
    const attChart = attList.reverse().map((a) => {
      let hours = 0;
      const ownSessions = sessions.filter((session) => session.attendance_id === a.id && session.ended_at);
      if (ownSessions.length > 0) {
        hours = Math.round(ownSessions.reduce((sum, session) => sum + Math.max(0, new Date(session.ended_at!).getTime() - new Date(session.started_at).getTime()), 0) / 3600000 * 10) / 10;
      } else if (a.check_in_time && a.check_out_time) {
        hours = Math.round((new Date(a.check_out_time).getTime() - new Date(a.check_in_time).getTime()) / 3600000 * 10) / 10;
      }
      return { date: a.date.slice(5), hours };
    });
    setAttendanceData(attChart);

    setLoading(false);
  };

  // Báo cáo cá nhân đọc cùng dữ liệu với Kanban, Chấm công và Giao việc.
  // Cập nhật âm thầm để người dùng không bị bật lại skeleton khi quản lý vừa
  // duyệt một tác vụ hoặc hệ thống ghi nhận phiên chấm công mới.
  useRealtimeSync(
    profile ? [
      { table: 'tasks', filter: `assignee_id=eq.${profile.id}` },
      { table: 'attendance', filter: `user_id=eq.${profile.id}` },
      { table: 'attendance_sessions' },
      { table: 'daily_assignments', filter: `user_id=eq.${profile.id}` },
    ] : [],
    () => {
      void loadData(true);
      void loadMonthData(true);
    },
    { enabled: !!profile, channelKey: `staff-reports-${profile?.id ?? 'anonymous'}` },
  );

  if (loading) {
    return <div className="space-y-6"><Skeleton className="h-72" /><Skeleton className="h-72" /></div>;
  }
  if (loadError) {
    return <Card><ErrorState message={loadError} onRetry={() => loadData()} /></Card>;
  }

  const monthLabel = format(monthStart, 'MM/yyyy');

  return (
    <div className="space-y-6">
      {/* ---- Công việc được giao theo tháng --------------------------------- */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-3">
            <CardTitle>Công việc được giao — tháng {monthLabel}</CardTitle>
            <MonthNav value={monthStart} onChange={setMonthStart} theme="staff" />
          </div>
        </CardHeader>
        <CardContent>
          {monthLoading ? (
            <Skeleton className="h-40" />
          ) : monthError ? (
            <ErrorState message={monthError} onRetry={() => loadMonthData()} />
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div>
                {monthTotals.total === 0 ? (
                  <p className="flex items-center gap-2.5 text-sm text-slate-400 py-6">
                    <ClipboardList className="w-5 h-5" />
                    Tháng {monthLabel} bạn chưa được giao công việc nào.
                  </p>
                ) : (
                  <>
                    <div className="grid grid-cols-3 gap-3">
                      <div className="rounded-xl bg-slate-50 p-4 text-center">
                        <p className="text-2xl font-extrabold text-slate-800">{monthTotals.total}</p>
                        <p className="text-xs text-slate-500 mt-0.5">Được giao</p>
                      </div>
                      <div className="rounded-xl bg-emerald-50 p-4 text-center">
                        <p className="text-2xl font-extrabold text-emerald-600">{monthTotals.approved}</p>
                        <p className="text-xs text-slate-500 mt-0.5">Đã xác nhận</p>
                      </div>
                      <div className="rounded-xl bg-blue-50 p-4 text-center">
                        <p className="text-2xl font-extrabold text-blue-600">{monthTotals.rate}%</p>
                        <p className="text-xs text-slate-500 mt-0.5">Tỷ lệ hoàn thành</p>
                      </div>
                    </div>
                    <div className="mt-4">
                      <div className="h-2.5 rounded-full bg-slate-100 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-400 transition-all duration-500"
                          style={{ width: `${monthTotals.rate}%` }}
                        />
                      </div>
                      {monthTotals.rejected > 0 && (
                        <p className="text-xs text-red-500 mt-2">
                          Còn {monthTotals.rejected} việc đang cần làm lại — hoàn thành sớm để giữ tỷ lệ.
                        </p>
                      )}
                    </div>
                  </>
                )}
              </div>

              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase mb-2 px-1">Tỷ lệ hoàn thành 6 tháng gần nhất</p>
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={monthlyTrend}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                    <XAxis dataKey="month" tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} unit="%" />
                    <Tooltip
                      contentStyle={{ borderRadius: '16px', border: '1px solid #e2e8f0', fontSize: '13px', boxShadow: '0 12px 32px -4px rgba(15,23,42,0.15)', padding: '8px 12px' }}
                      cursor={{ fill: '#f8fafc' }}
                      formatter={(value, _name, item) => {
                        const total = (item?.payload as { total?: number } | undefined)?.total ?? 0;
                        return [`${String(value)}% (${total} việc)`, 'Hoàn thành'];
                      }}
                    />
                    <Bar dataKey="rate" fill="#bf1f2b" radius={[6, 6, 0, 0]} name="Tỷ lệ" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle>Tác vụ hoàn thành theo tuần</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={weeklyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                <XAxis dataKey="day" tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip contentStyle={{ borderRadius: '16px', border: '1px solid #e2e8f0', fontSize: '13px', boxShadow: '0 12px 32px -4px rgba(15,23,42,0.15)', padding: '8px 12px' }} cursor={{ fill: '#f8fafc' }} />
                <Bar dataKey="completed" fill="#bf1f2b" radius={[6, 6, 0, 0]} name="Tác vụ" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Phân bổ tác vụ</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie data={taskStatusData} cx="50%" cy="50%" innerRadius={60} outerRadius={100} paddingAngle={3} dataKey="value">
                  {taskStatusData.map((e, i) => <Cell key={i} fill={e.color} />)}
                </Pie>
                <Tooltip contentStyle={{ borderRadius: '16px', border: '1px solid #e2e8f0', fontSize: '13px', boxShadow: '0 12px 32px -4px rgba(15,23,42,0.15)', padding: '8px 12px' }} />
                <Legend verticalAlign="bottom" iconType="circle" wrapperStyle={{ fontSize: '12px' }} />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Giờ làm việc (7 ngày gần nhất)</CardTitle></CardHeader>
        <CardContent>
          {attendanceData.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-8">Chưa có dữ liệu chấm công</p>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={attendanceData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ borderRadius: '16px', border: '1px solid #e2e8f0', fontSize: '13px', boxShadow: '0 12px 32px -4px rgba(15,23,42,0.15)', padding: '8px 12px' }} />
                <Line type="monotone" dataKey="hours" stroke="#bf1f2b" strokeWidth={3} dot={{ fill: '#bf1f2b', r: 4 }} name="Giờ" />
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
