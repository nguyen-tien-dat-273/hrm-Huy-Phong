import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Briefcase, AlertCircle, TrendingUp, Clock, Fingerprint, ArrowRight, ClipboardList } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Skeleton } from '@/components/ui/Skeleton';
import { ErrorState } from '@/components/ui/ErrorState';
import { Button } from '@/components/ui/Button';
import { UpcomingEventsCard } from '@/components/UpcomingEventsCard';
import { useAuth } from '@/contexts/AuthContext';
import { useRealtimeSync } from '@/hooks/useRealtimeSync';
import { supabase } from '@/lib/supabase';
import { describeDbErrorOrNull } from '@/lib/dbError';
import { PRIORITY_CONFIG, TASK_STATUSES, PROJECT_STATUS_CONFIG, formatDate, formatTime, isOverdue, toDateString, getTodayString } from '@/lib/utils';
import { ASSIGNMENT_STATUS_CONFIG } from '@/lib/assignments';
import type { Task, Project, Attendance, DailyAssignment } from '@/types';

export function StaffDashboard() {
  const { profile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [attendance, setAttendance] = useState<Attendance[]>([]);
  const [todayAssignments, setTodayAssignments] = useState<DailyAssignment[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (profile) void loadData();
  }, [profile]);

  // Dashboard là điểm vào đầu ngày: giao việc, chấm công hoặc đổi trạng thái
  // phải hiện lại ngay, không bắt nhân viên F5 mới thấy dữ liệu mới.
  useRealtimeSync(
    profile ? [
      { table: 'project_members', filter: `user_id=eq.${profile.id}` },
      { table: 'tasks', filter: `assignee_id=eq.${profile.id}` },
      { table: 'attendance', filter: `user_id=eq.${profile.id}` },
      { table: 'daily_assignments', filter: `user_id=eq.${profile.id}` },
    ] : [],
    () => loadData(true),
    { enabled: !!profile, channelKey: 'staff-dashboard' },
  );

  const loadData = async (silent = false) => {
    if (!profile) return;
    if (!silent) setLoading(true);

    // Get user's project memberships
const { data: memberships, error: membershipsError } = await supabase
      .from('project_members')
      .select('project_id')
      .eq('user_id', profile.id);

const mList = (memberships || []) as { project_id: string }[];
    const projectIds = mList.map((m: { project_id: string }) => m.project_id);

    // Get tasks assigned to this user
    const { data: userTasks, error: tasksError } = await supabase
      .from('tasks')
      .select('*, project:projects(*)')
      .eq('assignee_id', profile.id)
      .order('due_date', { ascending: true });

    setTasks((userTasks || []) as Task[]);

    // Get projects
    if (projectIds.length > 0) {
      const { data: projectData, error: projectsError } = await supabase
        .from('projects')
        .select('*')
        .in('id', projectIds);
      setProjects((projectData || []) as Project[]);
      setLoadError(
        describeDbErrorOrNull(membershipsError)
          ?? describeDbErrorOrNull(tasksError)
          ?? describeDbErrorOrNull(projectsError),
      );
    } else {
      setProjects([]);
      setLoadError(describeDbErrorOrNull(membershipsError) ?? describeDbErrorOrNull(tasksError));
    }

    // Get attendance history (last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const { data: attData, error: attendanceError } = await supabase
      .from('attendance')
      .select('*')
      .eq('user_id', profile.id)
      .gte('date', toDateString(sevenDaysAgo))
      .order('date', { ascending: false });

    setAttendance((attData || []) as Attendance[]);

    // Công việc quản lý giao cho hôm nay — nhắc ngay từ dashboard.
    const { data: asgData, error: assignmentsError } = await supabase
      .from('daily_assignments')
      .select('*')
      .eq('user_id', profile.id)
      .eq('work_date', getTodayString())
      .order('created_at', { ascending: true });
    setTodayAssignments((asgData || []) as DailyAssignment[]);
    setLoadError((current) => current
      ?? describeDbErrorOrNull(attendanceError)
      ?? describeDbErrorOrNull(assignmentsError));

    setLoading(false);
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-28" />)}
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }
  if (loadError) {
    return <Card><ErrorState message={loadError} onRetry={() => loadData()} /></Card>;
  }

  const activeTasks = tasks.filter((t) => t.status !== 'done');
  const overdueTasks = tasks.filter((t) => isOverdue(t.due_date, t.status));
  const completionRate = tasks.length > 0
    ? Math.round((tasks.filter((t) => t.status === 'done').length / tasks.length) * 100)
    : 0;
  const asgApproved = todayAssignments.filter((a) => a.status === 'approved').length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">Dashboard tổng quan</h1>
        <p className="text-slate-500 mt-1">Theo dõi công việc, chấm công và tiến độ cá nhân</p>
      </div>

      {/* Lịch họp & nhắc nhở sắp tới — tự ẩn khi không có */}
      <UpcomingEventsCard />

      {/* Công việc quản lý giao hôm nay — việc phải làm trước tiên trong ngày */}
      {todayAssignments.length > 0 && (
        <Card className="border-emerald-200 ring-1 ring-emerald-100">
          <CardHeader>
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <CardTitle>
                <span className="inline-flex items-center gap-2">
                  <ClipboardList className="w-5 h-5 text-emerald-600" />
                  Công việc hôm nay
                </span>
                <span className="ml-2 text-xs font-normal text-slate-400">
                  {asgApproved}/{todayAssignments.length} đã xác nhận
                </span>
              </CardTitle>
              <Link to="/staff/attendance">
                <Button theme="staff" size="sm">
                  Vào làm việc <ArrowRight className="w-3.5 h-3.5" />
                </Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {todayAssignments.slice(0, 4).map((a) => {
                const cfg = ASSIGNMENT_STATUS_CONFIG[a.status];
                return (
                  <div key={a.id} className="flex items-center gap-3 p-2.5 rounded-lg bg-slate-50/70">
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${cfg.dot}`} />
                    <span className={`text-sm flex-1 truncate ${a.status === 'approved' ? 'text-slate-400 line-through' : 'text-slate-700'}`}>
                      {a.title}
                    </span>
                    <Badge className={cfg.color}>{cfg.label}</Badge>
                  </div>
                );
              })}
              {todayAssignments.length > 4 && (
                <p className="text-xs text-slate-400 text-center pt-1">
                  … và {todayAssignments.length - 4} công việc khác
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

{/* --- Bảng số liệu: một mặt đồng hồ, không phải ba hộp rời --- */}
      {/* Ba con số này luôn được đọc cùng nhau, nên để chung một mặt phẳng và
          ngăn bằng vạch mảnh. Ba thẻ rời nhau khiến mắt phải nhảy ba lần cho
          một thông tin duy nhất: hôm nay tôi đang đứng ở đâu. */}
      <Card className="overflow-hidden">
        <div className="grid grid-cols-1 divide-y divide-slate-100 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          <StatCell
            icon={<Briefcase className="h-4 w-4" />}
            label="Tác vụ đang làm"
            value={activeTasks.length}
            hint="Công việc cần tiếp tục xử lý"
          />
          {/* Màu đỏ CHỈ bật khi thực sự có việc quá hạn. Tô đỏ con số 0 là dạy
              người dùng bỏ qua màu đỏ, để rồi lúc quá hạn thật thì không ai
              nhìn nữa. */}
          <StatCell
            icon={<AlertCircle className="h-4 w-4" />}
            label="Tác vụ quá hạn"
            value={overdueTasks.length}
            hint={overdueTasks.length > 0 ? 'Cần ưu tiên xử lý ngay' : 'Không có việc nào trễ hạn'}
            tone={overdueTasks.length > 0 ? 'alert' : 'calm'}
          />
          <StatCell
            icon={<TrendingUp className="h-4 w-4" />}
            label="Tiến độ cá nhân"
            value={completionRate}
            suffix="%"
            hint="Tỷ lệ tác vụ đã hoàn thành"
            progress={completionRate}
          />
        </div>
      </Card>

      {/* --- Lối tắt --- */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <QuickAction
          to="/staff/attendance"
          icon={<Fingerprint className="h-5 w-5" />}
          title="Chấm công"
          desc="Giờ vào từ máy và checkout"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* My tasks */}
        <Card>
          <CardHeader>
            <CardTitle>Tác vụ của tôi</CardTitle>
          </CardHeader>
          <CardContent>
            {tasks.length === 0 ? (
              <EmptyHint icon={<Briefcase className="h-5 w-5" />} title="Chưa có tác vụ nào"
                description="Việc được giao cho bạn sẽ xuất hiện ở đây." />
            ) : (
              <div className="space-y-2">
{tasks.slice(0, 5).map((task) => {
                  const priority = PRIORITY_CONFIG[task.priority];
                  const overdue = isOverdue(task.due_date, task.status);
                  return (
                    <div key={task.id} className={`p-3 rounded-xl border-l-4 ${priority.border} bg-slate-50/50 hover:bg-slate-50 transition-colors`}>
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-medium text-slate-800 flex-1">{task.title}</p>
                        <Badge className={TASK_STATUSES.find((s) => s.value === task.status)?.color || ''}>
                          {TASK_STATUSES.find((s) => s.value === task.status)?.label}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-2 mt-1.5">
                        <span className="text-xs text-slate-400">{task.project?.name}</span>
                        {task.due_date && (
                          <span className={`text-xs ${overdue ? 'text-red-500 font-medium' : 'text-slate-400'}`}>
                            • Hạn: {formatDate(task.due_date)}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
                <Link to="/staff/kanban" className="block text-center text-sm text-emerald-600 hover:text-emerald-700 pt-2">
                  Xem tất cả trên Kanban →
                </Link>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Attendance history */}
        <Card>
          <CardHeader>
            <CardTitle>Lịch sử chấm công (7 ngày)</CardTitle>
          </CardHeader>
          <CardContent>
            {attendance.length === 0 ? (
              <EmptyHint icon={<Fingerprint className="h-5 w-5" />} title="Chưa có dữ liệu chấm công"
                description="Dữ liệu sẽ xuất hiện sau khi bạn quét tại máy và hệ thống đồng bộ."
                to="/staff/attendance" action="Xem chấm công" />
            ) : (
              <div className="space-y-2">
                {attendance.map((a) => (
                  <div key={a.id} className="flex items-center justify-between p-3 rounded-lg bg-slate-50/50">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-lg bg-white border border-slate-200 flex items-center justify-center">
                        <Clock className="w-4 h-4 text-slate-400" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-slate-700">{formatDate(a.date)}</p>
                        <p className="text-xs text-slate-400">{formatTime(a.check_in_time)} → {formatTime(a.check_out_time)}</p>
                      </div>
                    </div>
                    <Badge className={a.check_out_time ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}>
                      {a.check_out_time ? 'Đã checkout' : 'Chưa checkout'}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* My projects */}
      <Card>
        <CardHeader>
          <CardTitle>Dự án đang tham gia</CardTitle>
        </CardHeader>
        <CardContent>
          {projects.length === 0 ? (
            <EmptyHint icon={<ClipboardList className="h-5 w-5" />} title="Chưa tham gia dự án nào"
              description="Quản lý thêm bạn vào dự án thì dự án sẽ hiện ở đây." />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {projects.map((p) => (
                <div key={p.id} className="p-4 rounded-xl border border-slate-200 hover:shadow-sm transition-shadow">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-semibold text-slate-800">{p.name}</p>
                    <Badge className={PROJECT_STATUS_CONFIG[p.status].color}>
                      {PROJECT_STATUS_CONFIG[p.status].label}
                    </Badge>
                  </div>
                  <p className="text-xs text-slate-500">{p.client || '—'}</p>
                  <p className="text-xs text-slate-400 mt-1">{formatDate(p.start_date)} → {formatDate(p.end_date)}</p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Một ô số liệu trên mặt đồng hồ.
 *
 * Số đứng TRƯỚC nhãn vì việc của màn này là đọc số; nhãn chỉ để xác nhận mình
 * đang đọc cái gì. `tabular-nums` giữ các chữ số thẳng cột giữa ba ô.
 */
function StatCell({
  icon, label, value, hint, suffix = '', tone = 'calm', progress,
}: {
  icon: ReactNode;
  label: string;
  value: number;
  hint: string;
  suffix?: string;
  tone?: 'calm' | 'alert';
  progress?: number;
}) {
  const alert = tone === 'alert';
  return (
    <div className="px-5 py-4">
      <div className={`flex items-center gap-2 text-xs font-semibold ${alert ? 'text-rose-600' : 'text-slate-500'}`}>
        {icon}
        {label}
      </div>
      <p className={`mt-1.5 text-3xl font-bold tabular-nums ${alert ? 'text-rose-600' : 'text-slate-900'}`}>
        {value}
        {suffix && <span className="ml-0.5 text-xl font-semibold text-slate-400">{suffix}</span>}
      </p>

      {progress != null && (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
          <div
            className="h-full rounded-full bg-indigo-500 transition-all duration-500"
            style={{ width: `${Math.min(Math.max(progress, 0), 100)}%` }}
          />
        </div>
      )}

      <p className={`mt-1.5 text-xs ${alert ? 'text-rose-500' : 'text-slate-400'}`}>{hint}</p>
    </div>
  );
}

/**
 * Lối tắt.
 *
 * CẢ THẺ là link chứ không phải một nút nhỏ nằm trong thẻ — vùng bấm rộng hơn
 * hẳn trên điện thoại, và không còn cảnh bấm trúng thẻ mà không có gì xảy ra.
 */
function QuickAction({
  to, icon, title, desc,
}: {
  to: string;
  icon: ReactNode;
  title: string;
  desc: string;
}) {
  return (
    <Link
      to={to}
      className="group flex items-center gap-3 rounded-2xl border border-slate-200/80 bg-white/95 px-5 py-4 shadow-card transition hover:border-indigo-300 hover:shadow-md"
    >
      <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 transition group-hover:bg-indigo-600 group-hover:text-white">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-slate-800">{title}</span>
        <span className="block text-xs text-slate-500">{desc}</span>
      </span>
      <ArrowRight className="h-4 w-4 flex-shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-indigo-600" />
    </Link>
  );
}

/** Ô trống: nói vì sao trống, và nếu tự làm được thì đưa luôn lối đi. */
function EmptyHint({
  icon, title, description, to, action,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  to?: string;
  action?: string;
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-50 text-slate-300">
        {icon}
      </span>
      <p className="text-sm font-semibold text-slate-600">{title}</p>
      <p className="max-w-xs text-xs leading-relaxed text-slate-400">{description}</p>
      {to && action && (
        <Link
          to={to}
          className="mt-1 text-xs font-semibold text-indigo-600 transition hover:text-indigo-700"
        >
          {action} →
        </Link>
      )}
    </div>
  );
}
