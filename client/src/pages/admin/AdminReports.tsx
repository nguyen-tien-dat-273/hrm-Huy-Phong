import { useEffect, useMemo, useState } from 'react';
import {
  BarChart, Bar, PieChart, Pie, Cell, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from 'recharts';
import { ClipboardList } from 'lucide-react';
import { startOfMonth, endOfMonth, addMonths, format, getDaysInMonth } from 'date-fns';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { MonthNav } from '@/components/ui/MonthNav';
import { Skeleton } from '@/components/ui/Skeleton';
import { ErrorState } from '@/components/ui/ErrorState';
import { useRealtimeSync } from '@/hooks/useRealtimeSync';
import { supabase } from '@/lib/supabase';
import { describeDbError } from '@/lib/dbError';
import { fetchProfileMap } from '@/lib/profileDirectory';
import { toDateString } from '@/lib/utils';
import type { DailyAssignment, Project, Task, Profile, Attendance } from '@/types';

/** Một dòng trong bảng xếp hạng hoàn thành công việc của tháng. */
interface MemberMonthStats {
  id: string;
  name: string;
  avatar_url: string | null;
  department: string | null;
  total: number;
  approved: number;
  rejected: number;
  rate: number;
}

export function AdminReports() {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [projectStatusData, setProjectStatusData] = useState<{ name: string; value: number; color: string }[]>([]);
  const [taskByProject, setTaskByProject] = useState<{ name: string; done: number; total: number }[]>([]);
  const [attendanceTrend, setAttendanceTrend] = useState<{ date: string; checkins: number }[]>([]);
  const [budgetData, setBudgetData] = useState<{ name: string; budget: number }[]>([]);

  // ---- Báo cáo hoàn thành công việc theo tháng ----
  const [monthStart, setMonthStart] = useState(() => startOfMonth(new Date()));
  const [monthAsg, setMonthAsg] = useState<DailyAssignment[]>([]);
  const [monthLoading, setMonthLoading] = useState(true);
  const [monthError, setMonthError] = useState<string | null>(null);

  useEffect(() => { loadData(); }, []);

  useEffect(() => { loadMonthAssignments(); }, [monthStart]); // eslint-disable-line react-hooks/exhaustive-deps

  // Báo cáo là màn hình đọc tổng hợp của nhiều module. Khi một nguồn thay đổi
  // (giao việc, chấm công hoặc dự án), biểu đồ phải cập nhật cùng nhịp với các
  // màn hình vận hành thay vì buộc người dùng tải lại trang.
  useRealtimeSync(
    [
      { table: 'projects' },
      { table: 'tasks' },
      { table: 'attendance' },
      { table: 'daily_assignments' },
      { table: 'leave_requests' },
    ],
    () => {
      void loadData(true);
      void loadMonthAssignments(true);
    },
    { channelKey: 'reports' },
  );

  const loadMonthAssignments = async (silent = false) => {
    if (!silent) setMonthLoading(true);
    const { data, error } = await supabase
      .from('daily_assignments')
      .select('*')
      .gte('work_date', toDateString(monthStart))
      .lte('work_date', toDateString(endOfMonth(monthStart)));
    setMonthError(error ? describeDbError(error) : null);
    // `profiles_directory` là VIEW nên PostgREST không nhúng được (PGRST200).
    const rows = (data || []) as DailyAssignment[];
    const people = await fetchProfileMap(rows.map((row) => row.user_id));
    setMonthAsg(rows.map((row) => ({ ...row, profile: row.profile ?? people.get(row.user_id) })));
    setMonthLoading(false);
  };

  /** Gom theo thành viên, xếp hạng theo tỷ lệ hoàn thành giảm dần. */
  const memberStats: MemberMonthStats[] = useMemo(() => {
    const map = new Map<string, MemberMonthStats>();
    for (const a of monthAsg) {
      const cur = map.get(a.user_id) ?? {
        id: a.user_id,
        name: a.profile?.name ?? '—',
        avatar_url: a.profile?.avatar_url ?? null,
        department: a.profile?.department ?? null,
        total: 0,
        approved: 0,
        rejected: 0,
        rate: 0,
      };
      cur.total++;
      if (a.status === 'approved') cur.approved++;
      if (a.status === 'rejected') cur.rejected++;
      map.set(a.user_id, cur);
    }
    return [...map.values()]
      .map((m) => ({ ...m, rate: m.total > 0 ? Math.round((m.approved / m.total) * 100) : 0 }))
      .sort((a, b) => b.rate - a.rate || b.total - a.total);
  }, [monthAsg]);

  const monthTotals = useMemo(() => {
    const total = monthAsg.length;
    const approved = monthAsg.filter((a) => a.status === 'approved').length;
    const rejected = monthAsg.filter((a) => a.status === 'rejected').length;
    return { total, approved, rejected, rate: total > 0 ? Math.round((approved / total) * 100) : 0 };
  }, [monthAsg]);

  // Không lưu KPI dẫn xuất vào state: memberStats là nguồn sự thật của báo cáo
  // tháng và có thể thay đổi sau realtime. Tính trực tiếp giúp biểu đồ luôn
  // phản ánh đúng dữ liệu vừa được nạp.
  const hrHealthData = useMemo(() => {
    const highPerformers = memberStats.filter((m) => m.rate >= 80).length;
    const stablePerformers = memberStats.filter((m) => m.rate >= 50 && m.rate < 80).length;
    const needSupport = memberStats.filter((m) => m.rate < 50).length;
    return [
      { name: 'Năng suất cao', value: highPerformers, color: '#10b981' },
      { name: 'Ổn định', value: stablePerformers, color: '#3b82f6' },
      { name: 'Cần hỗ trợ', value: needSupport, color: '#f59e0b' },
    ].filter((d) => d.value > 0);
  }, [memberStats]);

  /** Số việc được xác nhận theo từng ngày trong tháng — thấy nhịp làm việc. */
  const dailyApproved = useMemo(() => {
    const days = getDaysInMonth(monthStart);
    const counts = new Array(days).fill(0) as number[];
    for (const a of monthAsg) {
      if (a.status !== 'approved') continue;
      counts[new Date(a.work_date + 'T00:00:00').getDate() - 1]++;
    }
    return counts.map((v, i) => ({ day: String(i + 1).padStart(2, '0'), approved: v }));
  }, [monthAsg, monthStart]);

  const loadData = async (silent = false) => {
    if (!silent) setLoading(true);
    const [
      { data: projects, error: projErr },
      { data: tasks, error: taskErr },
      { data: attendance, error: attErr },
    ] = await Promise.all([
      supabase.from('projects').select('*'),
      supabase.from('tasks').select('*'),
      supabase.from('attendance').select('*'),
    ]);

    const firstError = projErr ?? taskErr ?? attErr;
    setLoadError(firstError ? describeDbError(firstError) : null);

    const projectList = (projects || []) as Project[];
    const taskList = (tasks || []) as Task[];
    const attList = (attendance || []) as Attendance[];

    // Project status distribution
    const statusMap: Record<string, { label: string; color: string }> = {
      planning: { label: 'Lập kế hoạch', color: '#94a3b8' },
      active: { label: 'Đang hoạt động', color: '#3b82f6' },
      on_hold: { label: 'Tạm dừng', color: '#f59e0b' },
      completed: { label: 'Hoàn thành', color: '#10b981' },
      archived: { label: 'Lưu trữ', color: '#cbd5e1' },
    };
    setProjectStatusData(
      Object.entries(statusMap).map(([key, val]) => ({
        name: val.label,
        value: projectList.filter((p) => p.status === key).length,
        color: val.color,
      })).filter((d) => d.value > 0)
    );

    // Tasks by project
    setTaskByProject(
      projectList.map((p) => ({
        name: p.name.length > 15 ? p.name.slice(0, 15) + '...' : p.name,
        done: taskList.filter((t) => t.project_id === p.id && t.status === 'done').length,
        total: taskList.filter((t) => t.project_id === p.id).length,
      }))
    );

    // Attendance trend (last 7 days)
    const days: { date: string; checkins: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateStr = toDateString(date);
      days.push({
        date: date.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' }),
        checkins: attList.filter((a) => a.date === dateStr).length,
      });
    }
    setAttendanceTrend(days);

    // Budget by project
    setBudgetData(
      projectList
        .filter((p) => p.budget)
        .map((p) => ({ name: p.name.length > 12 ? p.name.slice(0, 12) + '...' : p.name, budget: (p.budget || 0) / 1000000 }))
    );

    setLoading(false);
  };

  if (loading) {
    return <div className="space-y-6"><Skeleton className="h-72" /><Skeleton className="h-72" /></div>;
  }

  // Biểu đồ rỗng vì lỗi truy vấn trông y hệt biểu đồ rỗng vì chưa có dữ liệu —
  // phải nói rõ là lỗi, nếu không người xem sẽ tin vào một báo cáo sai.
  if (loadError) {
    return <Card><ErrorState message={loadError} onRetry={loadData} /></Card>;
  }

  const monthLabel = format(monthStart, 'MM/yyyy');

  return (
    <div className="space-y-6">
      {/* ---- Tỷ lệ hoàn thành công việc theo tháng -------------------------- */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-3">
            <CardTitle>
              Hoàn thành công việc giao — tháng {monthLabel}
              <span className="ml-2 text-xs font-normal text-slate-400">
                tính trên công việc quản lý giao theo ngày
              </span>
            </CardTitle>
            <MonthNav value={monthStart} onChange={setMonthStart} />
          </div>
        </CardHeader>
        <CardContent>
          {monthLoading ? (
            <Skeleton className="h-48" />
          ) : monthError ? (
            <ErrorState message={monthError} onRetry={loadMonthAssignments} />
          ) : monthTotals.total === 0 ? (
            <p className="flex items-center justify-center gap-2.5 text-sm text-slate-400 py-10">
              <ClipboardList className="w-5 h-5" />
              Tháng {monthLabel} chưa có công việc nào được giao.
            </p>
          ) : (
            <>
              {/* KPI của tháng */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
                <div className="rounded-xl bg-slate-50 p-4">
                  <p className="text-2xl font-extrabold text-slate-800">{monthTotals.total}</p>
                  <p className="text-xs text-slate-500 mt-0.5">Việc được giao</p>
                </div>
                <div className="rounded-xl bg-emerald-50 p-4">
                  <p className="text-2xl font-extrabold text-emerald-600">{monthTotals.approved}</p>
                  <p className="text-xs text-slate-500 mt-0.5">Đã xác nhận hoàn thành</p>
                </div>
                <div className="rounded-xl bg-blue-50 p-4">
                  <p className="text-2xl font-extrabold text-blue-600">{monthTotals.rate}%</p>
                  <p className="text-xs text-slate-500 mt-0.5">Tỷ lệ hoàn thành</p>
                </div>
                <div className="rounded-xl bg-red-50 p-4">
                  <p className="text-2xl font-extrabold text-red-500">{monthTotals.rejected}</p>
                  <p className="text-xs text-slate-500 mt-0.5">Đang cần làm lại</p>
                </div>
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                {/* Xếp hạng theo thành viên */}
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-slate-100">
                        <th className="text-left text-xs font-semibold text-slate-500 uppercase px-3 py-2.5">Thành viên</th>
                        <th className="text-center text-xs font-semibold text-slate-500 uppercase px-2 py-2.5">Giao</th>
                        <th className="text-center text-xs font-semibold text-slate-500 uppercase px-2 py-2.5">Xong</th>
                        <th className="text-left text-xs font-semibold text-slate-500 uppercase px-3 py-2.5 w-2/5">Tỷ lệ</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {memberStats.map((m) => (
                        <tr key={m.id}>
                          <td className="px-3 py-3">
                            <div className="flex items-center gap-2.5 min-w-0">
                              <Avatar name={m.name} url={m.avatar_url} size="sm" />
                              <div className="min-w-0">
                                <p className="text-sm font-medium text-slate-800 truncate">{m.name}</p>
                                <p className="text-xs text-slate-400 truncate">{m.department || '—'}</p>
                              </div>
                            </div>
                          </td>
                          <td className="px-2 py-3 text-center text-sm text-slate-600 tabular-nums">{m.total}</td>
                          <td className="px-2 py-3 text-center text-sm text-emerald-600 font-semibold tabular-nums">{m.approved}</td>
                          <td className="px-3 py-3">
                            <div className="flex items-center gap-2.5">
                              <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
                                <div
                                  className={`h-full rounded-full transition-all duration-500 ${
                                    m.rate >= 80 ? 'bg-emerald-500' : m.rate >= 50 ? 'bg-amber-400' : 'bg-red-400'
                                  }`}
                                  style={{ width: `${m.rate}%` }}
                                />
                              </div>
                              <span className="text-sm font-semibold text-slate-700 tabular-nums w-11 text-right">{m.rate}%</span>
                              {m.rejected > 0 && (
                                <Badge className="bg-red-100 text-red-700">{m.rejected} làm lại</Badge>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Việc được xác nhận theo ngày trong tháng */}
                <div>
                  <p className="text-xs font-semibold text-slate-500 uppercase mb-2 px-1">Việc hoàn thành theo ngày</p>
                  <ResponsiveContainer width="100%" height={230}>
                    <BarChart data={dailyApproved}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                      <XAxis dataKey="day" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} interval={2} />
                      <YAxis tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} allowDecimals={false} />
                      <Tooltip
                        contentStyle={{ borderRadius: '16px', border: '1px solid #e2e8f0', fontSize: '13px', boxShadow: '0 12px 32px -4px rgba(15,23,42,0.15)', padding: '8px 12px' }}
                        cursor={{ fill: '#f8fafc' }}
                        labelFormatter={(d) => `Ngày ${d}/${monthLabel}`}
                      />
                      <Bar dataKey="approved" fill="#10b981" radius={[4, 4, 0, 0]} name="Việc xác nhận" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Sức khỏe nhân sự (Hiệu suất)</CardTitle>
          </CardHeader>
          <CardContent>
            {hrHealthData.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-20">Chưa đủ dữ liệu hiệu suất</p>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie data={hrHealthData} cx="50%" cy="50%" innerRadius={60} outerRadius={90} dataKey="value" paddingAngle={5}>
                    {hrHealthData.map((e, i) => <Cell key={i} fill={e.color} stroke="none" />)}
                  </Pie>
                  <Tooltip contentStyle={{ borderRadius: '16px', border: 'none', fontSize: '13px', boxShadow: '0 12px 32px -4px rgba(15,23,42,0.15)' }} />
                  <Legend verticalAlign="bottom" iconType="circle" wrapperStyle={{ fontSize: '12px', paddingTop: '10px' }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Trạng thái dự án</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie data={projectStatusData} cx="50%" cy="50%" outerRadius={100} dataKey="value" label={({ name }) => name}>
                  {projectStatusData.map((e, i) => <Cell key={i} fill={e.color} />)}
                </Pie>
                <Tooltip contentStyle={{ borderRadius: '16px', border: '1px solid #e2e8f0', fontSize: '13px', boxShadow: '0 12px 32px -4px rgba(15,23,42,0.15)', padding: '8px 12px' }} />
                <Legend verticalAlign="bottom" iconType="circle" wrapperStyle={{ fontSize: '12px' }} />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Tác vụ theo dự án</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={taskByProject} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} width={100} />
                <Tooltip contentStyle={{ borderRadius: '16px', border: '1px solid #e2e8f0', fontSize: '13px', boxShadow: '0 12px 32px -4px rgba(15,23,42,0.15)', padding: '8px 12px' }} cursor={{ fill: '#f8fafc' }} />
                <Legend wrapperStyle={{ fontSize: '12px' }} />
                <Bar dataKey="done" stackId="a" fill="#10b981" radius={[0, 0, 0, 0]} name="Hoàn thành" />
                <Bar dataKey="total" stackId="a" fill="#dbeafe" radius={[0, 4, 4, 0]} name="Tổng" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle>Xu hướng Check-in (7 ngày)</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={attendanceTrend}>
                <defs>
                  <linearGradient id="checkinGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip contentStyle={{ borderRadius: '16px', border: '1px solid #e2e8f0', fontSize: '13px', boxShadow: '0 12px 32px -4px rgba(15,23,42,0.15)', padding: '8px 12px' }} />
                <Area type="monotone" dataKey="checkins" stroke="#3b82f6" strokeWidth={2} fill="url(#checkinGrad)" name="Lượt check-in" />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Ngân sách dự án (triệu VNĐ)</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={budgetData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ borderRadius: '16px', border: '1px solid #e2e8f0', fontSize: '13px', boxShadow: '0 12px 32px -4px rgba(15,23,42,0.15)', padding: '8px 12px' }} cursor={{ fill: '#f8fafc' }} />
                <Bar dataKey="budget" fill="#8b5cf6" radius={[6, 6, 0, 0]} name="Ngân sách" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
