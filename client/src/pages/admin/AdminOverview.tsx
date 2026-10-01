// ============================================================================
// Tổng quan điều hành — bức tranh danh mục dự án cho CEO/admin.
// ----------------------------------------------------------------------------
// Bốn khối: KPI tổng thể · Sức khỏe từng dự án (xếp dự án cần xử lý lên trước)
// · Điểm cần xử lý (rủi ro gom từ mọi dự án) · Mốc quan trọng sắp tới.
// CEO là isFullAdmin nên RLS cho đọc toàn bộ — không cần backend riêng.
// ============================================================================

import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip,
} from 'recharts';
import {
  FolderKanban, AlertTriangle, CalendarClock, Inbox, TrendingUp, ArrowRight,
  CalendarOff, Clock, Building2, Bell, Flag, ChevronRight, ShieldCheck,
  ClipboardList, UserCircle, Plus, BarChart3, Sparkles, CheckCircle2,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import { useRealtimeSync } from '@/hooks/useRealtimeSync';
import { useAuth } from '@/contexts/AuthContext';
import { hasAdminFunction } from '@/lib/permissions';
import { supabase } from '@/lib/supabase';
import { describeDbErrorOrNull } from '@/lib/dbError';
import { PROJECT_STATUS_CONFIG, getGreeting } from '@/lib/utils';
import { formatEventTime } from '@/lib/projectEvents';
import {
  buildMilestones, buildPortfolio, collectRisks, HEALTH_CONFIG, isLiveProject,
  type HealthLevel, type Milestone, type ProjectHealth,
} from '@/lib/portfolio';
import type { Project, Profile, ProjectMember, Task, ProjectEvent } from '@/types';

interface Pending { leave: number; assignments: number }

export function AdminOverview() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const allowed = hasAdminFunction(profile, 'admin.overview');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [events, setEvents] = useState<ProjectEvent[]>([]);
  const [pending, setPending] = useState<Pending>({ leave: 0, assignments: 0 });

  const load = async (silent = false) => {
    if (!silent) setLoading(true);
    const [projRes, taskRes, memRes, profRes, evRes, lvRes, asgRes] = await Promise.all([
      supabase.from('projects').select('*'),
      supabase.from('tasks').select('id, project_id, status, due_date, priority'),
      supabase.from('project_members').select('id, project_id, user_id, role'),
      supabase.from('profiles').select('*').eq('is_active', true),
      supabase.from('project_events').select('*, project:projects(id,name)').gte('start_at', new Date().toISOString()).order('start_at', { ascending: true }),
      supabase.from('leave_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
      supabase.from('daily_assignments').select('id', { count: 'exact', head: true }).eq('status', 'submitted'),
    ]);

    setLoadError(
      describeDbErrorOrNull(projRes.error) ?? describeDbErrorOrNull(taskRes.error) ?? describeDbErrorOrNull(memRes.error),
    );
    setProjects((projRes.data || []) as Project[]);
    setTasks((taskRes.data || []) as Task[]);
    setMembers((memRes.data || []) as ProjectMember[]);
    setProfiles((profRes.data || []) as Profile[]);
    setEvents((evRes.data || []) as ProjectEvent[]);
    setPending({ leave: lvRes.count ?? 0, assignments: asgRes.count ?? 0 });
    setLoading(false);
  };

  useEffect(() => { if (allowed) void load(); else setLoading(false); }, [allowed]);

  useRealtimeSync(
    [
      { table: 'projects' },
      { table: 'tasks' },
      { table: 'project_events' },
      { table: 'leave_requests' },
      { table: 'daily_assignments' },
    ],
    () => load(true),
    { channelKey: 'overview' },
  );

  const profilesById = useMemo(() => new Map(profiles.map((p) => [p.id, p])), [profiles]);
  const portfolio = useMemo(
    () => buildPortfolio(projects, tasks, members, profilesById),
    [projects, tasks, members, profilesById],
  );
  const risks = useMemo(() => collectRisks(portfolio), [portfolio]);
  const milestones = useMemo(() => buildMilestones(events, projects, tasks), [events, projects, tasks]);

  const live = portfolio.filter((ph) => isLiveProject(ph.project));
  const needAttention = live.filter((ph) => ph.health !== 'good').length;
  const healthyProjects = live.filter((ph) => ph.health === 'good').length;
  const overdueTasksTotal = live.reduce((s, ph) => s + ph.overdueTasks, 0);
  const pendingTotal = pending.leave + pending.assignments;
  const healthyRate = live.length > 0 ? Math.round((healthyProjects / live.length) * 100) : 0;
  const displayName = profile?.name?.trim().split(/\s+/).at(-1) || 'bạn';
  const todayLabel = new Intl.DateTimeFormat('vi-VN', {
    weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
  }).format(new Date());

  // Phân bố sức khỏe cho donut.
  const healthDist = useMemo(() => {
    const counts: Record<HealthLevel, number> = { good: 0, warning: 0, critical: 0 };
    for (const ph of live) counts[ph.health]++;
    return (['critical', 'warning', 'good'] as HealthLevel[])
      .map((k) => ({ name: HEALTH_CONFIG[k].label, value: counts[k], color: HEALTH_CONFIG[k].chart }))
      .filter((d) => d.value > 0);
  }, [live]);

  if (!allowed) {
    return (
      <div className="max-w-xl">
        <Card>
          <CardContent className="flex items-start gap-3 pt-6">
            <AlertTriangle className="w-6 h-6 text-amber-500 flex-shrink-0" />
            <div>
              <p className="font-medium text-slate-800">Chỉ Quản trị viên và Ban giám đốc</p>
              <p className="text-sm text-slate-500 mt-1">
                Tổng quan điều hành tổng hợp dữ liệu toàn bộ dự án của công ty nên không mở theo quyền lẻ.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28" />)}</div>
        <Skeleton className="h-96" />
      </div>
    );
  }
  if (loadError) return <ErrorState message={loadError} onRetry={load} />;

  return (
    <div className="space-y-5 sm:space-y-6">
      {/* ============ Mở đầu & hành động nhanh ============ */}
      <section className="dashboard-hero relative overflow-hidden rounded-[1.75rem] border border-slate-200/70 px-5 py-6 shadow-card sm:px-7 sm:py-7 lg:px-8" aria-labelledby="overview-heading">
        <div className="dashboard-hero-orb" aria-hidden="true" />
        <div className="relative z-10 flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-3xl">
            <div className="mb-3 flex flex-wrap items-center gap-2 text-[11px] font-bold uppercase tracking-[0.16em] text-indigo-600">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-indigo-200/80 bg-white/75 px-2.5 py-1 shadow-sm backdrop-blur">
                <Sparkles className="h-3.5 w-3.5" /> Trung tâm điều hành
              </span>
              <span className="font-semibold normal-case tracking-normal text-slate-500 first-letter:uppercase">{todayLabel}</span>
            </div>
            <h2 id="overview-heading" className="font-display text-2xl font-extrabold tracking-[-0.035em] text-slate-950 sm:text-3xl">
              {getGreeting()}, {displayName}
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600 sm:text-[15px]">
              {needAttention > 0 || pendingTotal > 0
                ? `Hôm nay có ${needAttention} dự án cần theo dõi và ${pendingTotal} yêu cầu đang chờ xử lý.`
                : 'Danh mục dự án đang vận hành ổn định. Không có yêu cầu khẩn cần xử lý.'}
            </p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="flex items-center gap-3 rounded-2xl border border-white/80 bg-white/72 px-4 py-3 shadow-sm backdrop-blur">
              <div className="relative flex h-11 w-11 items-center justify-center rounded-full bg-emerald-50 text-sm font-extrabold text-emerald-700 ring-1 ring-emerald-100">
                {healthyRate}%
              </div>
              <div>
                <p className="text-xs font-semibold text-slate-500">Sức khỏe danh mục</p>
                <p className="text-sm font-bold text-slate-900">{healthyProjects}/{live.length} dự án ổn định</p>
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => navigate('/admin/projects')} className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 shadow-sm transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md sm:flex-none">
                <Plus className="h-4 w-4" /> Dự án
              </button>
              <button onClick={() => navigate('/admin/reports')} className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white shadow-lg shadow-slate-900/15 transition hover:-translate-y-0.5 hover:bg-slate-800 sm:flex-none">
                <BarChart3 className="h-4 w-4" /> Báo cáo
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* ============ KPI ============ */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 lg:gap-4">
        <KpiCard icon={<FolderKanban className="h-5 w-5" />} value={live.length}
          label="Dự án đang triển khai" hint={`${healthyProjects} dự án vận hành ổn định`} />
        <KpiCard icon={<AlertTriangle className="h-5 w-5" />} value={needAttention}
          label="Dự án cần chú ý" hint={needAttention > 0 ? 'Ưu tiên kiểm tra trong hôm nay' : 'Không có cảnh báo mới'} tone={needAttention > 0 ? 'amber' : 'green'} />
        <KpiCard icon={<Flag className="h-5 w-5" />} value={overdueTasksTotal}
          label="Tác vụ quá hạn" hint={overdueTasksTotal > 0 ? 'Cần điều phối lại nguồn lực' : 'Tất cả đúng thời hạn'} tone={overdueTasksTotal > 0 ? 'red' : 'green'} />
        <KpiCard icon={<Inbox className="h-5 w-5" />} value={pendingTotal}
          label="Yêu cầu chờ duyệt" hint={`${pending.assignments} công việc · ${pending.leave} nghỉ phép`} tone="violet" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ============ Sức khỏe dự án ============ */}
        <div className="lg:col-span-2 space-y-6">
          <Card className="overflow-hidden">
            <CardHeader className="flex flex-row items-center justify-between gap-4">
              <div>
                <CardTitle>
                  <span className="inline-flex items-center gap-2"><TrendingUp className="w-5 h-5 text-blue-600" />Sức khỏe dự án</span>
                </CardTitle>
                <p className="mt-1 text-xs text-slate-500">Sắp xếp theo mức độ cần can thiệp</p>
              </div>
              <button onClick={() => navigate('/admin/projects')} className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 transition hover:text-indigo-800">
                Xem tất cả <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </CardHeader>
            <CardContent className="p-0">
              {live.length === 0 ? (
                <EmptyState icon={<FolderKanban className="w-8 h-8" />} title="Chưa có dự án đang triển khai"
                  description="Tạo dự án ở trang Quản lý Dự án để theo dõi tại đây." />
              ) : (
                <div className="divide-y divide-slate-50">
                  {portfolio.filter((ph) => isLiveProject(ph.project)).map((ph) => (
                    <ProjectHealthRow key={ph.project.id} ph={ph} onClick={() => navigate(`/admin/projects/${ph.project.id}`)} />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* ============ Cột phải: donut + rủi ro + mốc ============ */}
        <div className="space-y-6">
          {/* Donut sức khỏe */}
          <Card className="overflow-hidden">
            <CardHeader><CardTitle>Phân bố sức khỏe</CardTitle></CardHeader>
            <CardContent>
              {healthDist.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-6">Chưa có dữ liệu</p>
              ) : (
                <div className="flex items-center gap-4">
                  <div className="w-32 h-32 flex-shrink-0 relative">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={healthDist} dataKey="value" innerRadius={38} outerRadius={58} paddingAngle={2} startAngle={90} endAngle={-270}>
                          {healthDist.map((d, i) => <Cell key={i} fill={d.color} />)}
                        </Pie>
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                      <span className="text-2xl font-extrabold text-slate-800">{live.length}</span>
                      <span className="text-[10px] text-slate-400 -mt-0.5">dự án</span>
                    </div>
                  </div>
                  <div className="flex-1 space-y-2">
                    {healthDist.map((d) => (
                      <div key={d.name} className="flex items-center justify-between text-sm">
                        <span className="flex items-center gap-2 text-slate-600">
                          <span className="w-2.5 h-2.5 rounded-full" style={{ background: d.color }} />{d.name}
                        </span>
                        <span className="font-semibold text-slate-800">{d.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Điểm cần xử lý */}
          <Card className="overflow-hidden">
            <CardHeader>
              <CardTitle>
                <span className="inline-flex items-center gap-2"><AlertTriangle className="w-5 h-5 text-amber-500" />Điểm cần xử lý</span>
                {risks.length > 0 && <span className="ml-2 text-xs font-normal text-slate-400">{risks.length}</span>}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {/* Đơn chờ duyệt tồn đọng */}
              {pendingTotal > 0 && (
                <div className="px-5 py-3 border-b border-slate-50 flex flex-wrap gap-x-4 gap-y-1.5">
                  {pending.assignments > 0 && <PendingChip icon={<ShieldCheck className="w-3.5 h-3.5" />} label={`${pending.assignments} việc chờ xác nhận`} to="/admin/assignments" navigate={navigate} />}
                  {pending.leave > 0 && <PendingChip icon={<CalendarOff className="w-3.5 h-3.5" />} label={`${pending.leave} đơn nghỉ phép`} to="/admin/leave" navigate={navigate} />}
                </div>
              )}
              {risks.length === 0 && pendingTotal === 0 ? (
                <div className="flex flex-col items-center text-center py-8 px-5">
                  <div className="w-12 h-12 rounded-full bg-emerald-50 flex items-center justify-center mb-2 ring-4 ring-emerald-50/60"><CheckCircle2 className="w-6 h-6 text-emerald-600" /></div>
                  <p className="text-sm font-medium text-slate-700">Mọi thứ đang ổn</p>
                  <p className="text-xs text-slate-400">Không có dự án nào cần xử lý gấp.</p>
                </div>
              ) : (
                <div className="divide-y divide-slate-50 max-h-80 overflow-y-auto">
                  {risks.slice(0, 12).map((r, i) => (
                    <button key={i} onClick={() => navigate(`/admin/projects/${r.projectId}`)}
                      className="w-full flex items-start gap-2.5 px-5 py-2.5 hover:bg-slate-50/70 transition-colors text-left">
                      <span className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${HEALTH_CONFIG[r.level].dot}`} />
                      <span className="flex-1 min-w-0">
                        <span className="text-sm text-slate-700">{r.message}</span>
                        <span className="block text-xs text-slate-400 truncate">{r.projectName}</span>
                      </span>
                      <ChevronRight className="w-4 h-4 text-slate-300 flex-shrink-0 mt-0.5" />
                    </button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Mốc quan trọng sắp tới */}
          <Card className="overflow-hidden">
            <CardHeader>
              <CardTitle>
                <span className="inline-flex items-center gap-2"><CalendarClock className="w-5 h-5 text-blue-600" />Mốc quan trọng sắp tới</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {milestones.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-8">Không có mốc nào sắp tới</p>
              ) : (
                <div className="divide-y divide-slate-50">
                  {milestones.map((m, i) => <MilestoneRow key={i} m={m} />)}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function KpiCard({ icon, value, label, hint, tone = 'blue' }: {
  icon: React.ReactNode;
  value: number;
  label: string;
  hint: string;
  tone?: 'blue' | 'amber' | 'red' | 'green' | 'violet';
}) {
  const tones = {
    blue: { icon: 'bg-blue-50 text-blue-700 ring-blue-100', line: 'bg-blue-500' },
    amber: { icon: 'bg-amber-50 text-amber-700 ring-amber-100', line: 'bg-amber-500' },
    red: { icon: 'bg-rose-50 text-rose-700 ring-rose-100', line: 'bg-rose-500' },
    green: { icon: 'bg-emerald-50 text-emerald-700 ring-emerald-100', line: 'bg-emerald-500' },
    violet: { icon: 'bg-violet-50 text-violet-700 ring-violet-100', line: 'bg-violet-500' },
  }[tone];
  return (
    <Card className="group relative overflow-hidden transition duration-200 hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-lifted">
      <span className={`absolute inset-x-0 top-0 h-0.5 ${tones.line}`} />
      <CardContent className="flex items-start gap-4 px-5 py-5">
        <span className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl ring-1 ${tones.icon}`}>{icon}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm font-semibold leading-tight text-slate-600">{label}</p>
            <p className="font-display text-3xl font-extrabold leading-none tracking-tight text-slate-950">{value}</p>
          </div>
          <p className="mt-2 truncate text-xs text-slate-400">{hint}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function ProjectHealthRow({ ph, onClick }: { ph: ProjectHealth; onClick: () => void }) {
  const cfg = HEALTH_CONFIG[ph.health];
  const status = PROJECT_STATUS_CONFIG[ph.project.status];
  const progressPct = Math.round(ph.progress * 100);
  const timePct = Math.round(ph.timeElapsed * 100);
  const behind = ph.timeElapsed - ph.progress >= 0.2;

  return (
    <button onClick={onClick} aria-label={`Mở dự án ${ph.project.name}`} className="group w-full border-b border-slate-100 px-4 py-5 text-left transition-colors last:border-0 hover:bg-indigo-50/45 sm:px-6">
      <div className="flex items-start gap-4">
        <div className={`mt-1 h-10 w-1 flex-shrink-0 rounded-full transition-transform group-hover:scale-y-110 ${cfg.dot}`} />
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-3 mb-2">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">PRJ-{ph.project.id.slice(0,4).toUpperCase()}</span>
            <span className="text-sm font-bold text-slate-800 truncate">{ph.project.name}</span>
            <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-widest ${cfg.color}`}>{cfg.label}</span>
            <span className={`px-1.5 py-0.5 rounded text-[9px] font-semibold ${status.color}`}>{status.label}</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[10px] font-bold text-slate-400 uppercase tracking-tighter">
                <span>Tiến độ vận hành</span>
                <span>{progressPct}%</span>
              </div>
              <div
                className="relative h-1 overflow-hidden rounded-full bg-slate-100"
                role="progressbar"
                aria-label={`Tiến độ dự án ${ph.project.name}`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={progressPct}
              >
                <div className={`absolute inset-y-0 left-0 ${behind ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${progressPct}%` }} />
                <div className="absolute inset-y-0 w-0.5 bg-slate-400/50" style={{ left: `${timePct}%` }} />
              </div>
            </div>
            
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[10px] font-bold uppercase tracking-tight text-slate-400">
              <div className="flex items-center gap-1.5">
                <ClipboardList className="w-3 h-3" />
                <span>{ph.doneTasks}/{ph.totalTasks} tác vụ</span>
              </div>
              <div className="flex items-center gap-1.5">
                <UserCircle className="w-3 h-3" />
                <span>{ph.lead?.name || 'Chưa có phụ trách'}</span>
              </div>
              {ph.daysLeft !== null && (
                <div className={`flex items-center gap-1.5 ${ph.daysLeft < 0 ? 'text-red-500' : ''}`}>
                  <Clock className="w-3 h-3" />
                  <span>{ph.daysLeft < 0 ? `Quá hạn ${Math.abs(ph.daysLeft)} ngày` : `Còn ${ph.daysLeft} ngày`}</span>
                </div>
              )}
            </div>
          </div>
        </div>
        <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-indigo-600 transition-colors mt-2" />
      </div>
    </button>
  );
}

function MilestoneRow({ m }: { m: Milestone }) {
  const icon = m.kind === 'deadline' ? <Flag className="w-4 h-4" /> : m.kind === 'meeting' ? <Building2 className="w-4 h-4" /> : <Bell className="w-4 h-4" />;
  const color = m.kind === 'deadline' ? 'bg-red-100 text-red-700' : m.kind === 'meeting' ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700';
  const soon = m.daysUntil <= 3;
  return (
    <div className="flex items-start gap-3 px-5 py-3">
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${color}`}>{icon}</div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-slate-800 truncate">{m.title}</p>
        <p className="text-xs text-slate-500 truncate">{m.projectName}</p>
        <p className="text-xs text-slate-400 mt-0.5">{formatEventTime(m.at)}</p>
      </div>
      <span className={`text-xs font-semibold whitespace-nowrap ${soon ? 'text-red-600' : 'text-slate-500'}`}>
        {m.daysUntil === 0 ? 'Hôm nay' : `${m.daysUntil}n nữa`}
      </span>
    </div>
  );
}

function PendingChip({ icon, label, to, navigate }: {
  icon: React.ReactNode; label: string; to: string; navigate: (to: string) => void;
}) {
  return (
    <button onClick={() => navigate(to)} className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-blue-600 transition-colors">
      <span className="text-slate-400">{icon}</span>{label}
    </button>
  );
}
