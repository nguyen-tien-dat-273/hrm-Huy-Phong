import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Briefcase, Calendar, Users as UsersIcon, FileText, KanbanSquare, ExternalLink } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Avatar } from '@/components/ui/Avatar';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Modal } from '@/components/ui/Modal';
import { ProjectDocuments } from '@/components/ProjectDocuments';
import { Skeleton } from '@/components/ui/Skeleton';
import { useAuth } from '@/contexts/AuthContext';
import { useRealtimeSync } from '@/hooks/useRealtimeSync';
import { supabase } from '@/lib/supabase';
import { describeDbError } from '@/lib/dbError';
import { fetchProfileMap } from '@/lib/profileDirectory';
import { PROJECT_STATUS_CONFIG, MEMBER_ROLE_CONFIG, KANBAN_COLUMNS, formatDate } from '@/lib/utils';
import type { Project, ProjectMember, Task } from '@/types';

export function StaffProjects() {
  const { profile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [docsProject, setDocsProject] = useState<{ id: string; name: string } | null>(null);
  const [detailProject, setDetailProject] = useState<Project | null>(null);
  const [projects, setProjects] = useState<{ project: Project; role: string; members: ProjectMember[]; tasks: Task[]; taskCount: number }[]>([]);

  useEffect(() => {
    if (profile) loadData();
  }, [profile]);

  // Không lọc theo user_id: được thêm vào dự án mới là một dòng project_members
  // của chính mình, nhưng dự án bị đổi tên hay thêm tác vụ lại nằm ở bảng khác.
  useRealtimeSync(
    profile ? [{ table: 'project_members' }, { table: 'projects' }, { table: 'tasks' }] : [],
    () => loadData(true),
    { enabled: !!profile },
  );

  const loadData = async (silent = false) => {
    if (!silent) setLoading(true);

    const { data: memberships, error: membershipErr } = await supabase
      .from('project_members')
      .select('project_id, role')
      .eq('user_id', profile?.id);

    if (membershipErr) {
      setLoadError(describeDbError(membershipErr));
      setProjects([]);
      setLoading(false);
      return;
    }
    setLoadError(null);

    const mList = (memberships || []) as { project_id: string; role: string }[];
    if (mList.length === 0) {
      setProjects([]);
      setLoading(false);
      return;
    }

const projectIds = mList.map((m: { project_id: string; role: string }) => m.project_id);

    const [
      { data: projectData, error: projErr },
      { data: memberData, error: memberErr },
      { data: taskData, error: taskErr },
    ] = await Promise.all([
      supabase.from('projects').select('*').in('id', projectIds),
      supabase.from('project_members').select('*').in('project_id', projectIds),
      supabase.from('tasks').select('*').in('project_id', projectIds),
    ]);

    const firstError = projErr ?? memberErr ?? taskErr;
    setLoadError(firstError ? describeDbError(firstError) : null);

    const projectList = (projectData || []) as Project[];
    // `profiles_directory` là VIEW nên PostgREST không nhúng được (PGRST200).
    const rawMembers = (memberData || []) as ProjectMember[];
    const people = await fetchProfileMap(rawMembers.map((item) => item.user_id));
    const memberList = rawMembers.map((item) => ({ ...item, profile: item.profile ?? people.get(item.user_id) }));
    const taskList = (taskData || []) as Task[];

const result = projectList.map((project) => {
      const membership = mList.find((m: { project_id: string; role: string }) => m.project_id === project.id);
      return {
        project,
        role: membership?.role || 'member',
        members: memberList.filter((m: ProjectMember) => m.project_id === project.id),
        tasks: taskList.filter((t: Task) => t.project_id === project.id),
        taskCount: taskList.filter((t: Task) => t.project_id === project.id).length,
      };
    });

    setProjects(result);
    setLoading(false);
  };

  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-56" />)}
      </div>
    );
  }

  if (loadError) {
    return <Card><ErrorState message={loadError} onRetry={loadData} /></Card>;
  }

  if (projects.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={<Briefcase className="w-8 h-8" />}
          title="Chưa tham gia dự án nào"
          description="Khi được thêm vào dự án, nó sẽ hiển thị tại đây."
        />
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
{projects.map(({ project, role, members, taskCount }) => (
        <Card hover key={project.id} className="p-5 group">
          <div className="flex items-start justify-between mb-3">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl bg-indigo-50 border border-indigo-100 text-indigo-600 flex items-center justify-center transition-colors group-hover:bg-indigo-100">
                <Briefcase className="w-5.5 h-5.5" />
              </div>
              <div>
                <h3 className="font-display text-base font-bold text-slate-800 group-hover:text-emerald-700 transition-colors">{project.name}</h3>
                <Badge className={MEMBER_ROLE_CONFIG[role as keyof typeof MEMBER_ROLE_CONFIG]?.color || ''}>
                  {MEMBER_ROLE_CONFIG[role as keyof typeof MEMBER_ROLE_CONFIG]?.label || 'Thành viên'}
                </Badge>
              </div>
            </div>
            <Badge className={PROJECT_STATUS_CONFIG[project.status].color}>
              {PROJECT_STATUS_CONFIG[project.status].label}
            </Badge>
          </div>

          <p className="text-sm text-slate-500 mb-4 line-clamp-2">{project.description || 'Không có mô tả'}</p>

          <div className="space-y-2.5 text-xs text-slate-500 mb-4">
            <div className="flex items-center gap-2">
              <Calendar className="w-3.5 h-3.5" />
              {formatDate(project.start_date)} → {formatDate(project.end_date)}
            </div>
            <div className="flex items-center gap-2">
              <UsersIcon className="w-3.5 h-3.5" />
              {members.length} thành viên • {taskCount} tác vụ
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 pt-3 border-t border-slate-100">
            {members.slice(0, 5).map((m) => (
              <Avatar key={m.id} name={m.profile?.name || ''} url={m.profile?.avatar_url} size="sm" />
            ))}
            {members.length > 5 && (
              <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-xs font-medium text-slate-500">
                +{members.length - 5}
              </div>
            )}

            <Link
              to={`/staff/kanban?project=${encodeURIComponent(project.id)}`}
              className="ml-auto inline-flex items-center gap-1.5 h-9 px-3 rounded-xl bg-emerald-600 text-sm font-semibold text-white hover:bg-emerald-700 transition-colors"
            >
              <KanbanSquare className="w-4 h-4" /> Kanban
            </Link>

            {/* Nhân viên không có trang chi tiết dự án riêng, nên tài liệu mở
                trong hộp thoại ngay từ thẻ. */}
            <button
              onClick={() => setDetailProject(project)}
              className="ml-auto inline-flex items-center gap-1.5 h-9 px-3 rounded-xl border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50 hover:border-slate-300 transition-colors"
            >
              <ExternalLink className="w-4 h-4" /> Chi tiết
            </button>
            <button
              onClick={() => setDocsProject({ id: project.id, name: project.name })}
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-xl border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50 hover:border-slate-300 transition-colors"
            >
              <FileText className="w-4 h-4" />
              Tài liệu
            </button>
          </div>
        </Card>
      ))}

      <Modal
        open={!!detailProject}
        onClose={() => setDetailProject(null)}
        title={`Chi tiết dự án — ${detailProject?.name ?? ''}`}
        size="xl"
      >
        {detailProject && (() => {
          const row = projects.find((item) => item.project.id === detailProject.id);
          const projectTasks = (row?.tasks ?? []) as Task[];
          const done = projectTasks.filter((task) => task.status === 'done').length;
          const memberNames = new Map((row?.members ?? []).map((member) => [member.user_id, member.profile?.name || 'Thành viên']));
          return <div className="space-y-4">
            <section className="rounded-xl bg-indigo-50/70 p-4">
              <h3 className="text-sm font-bold text-slate-800">Giới thiệu dự án</h3>
              <p className="mt-2 whitespace-pre-wrap text-sm text-slate-600">{detailProject.description || 'Dự án chưa có phần giới thiệu.'}</p>
              <p className="mt-3 text-xs text-slate-500">{formatDate(detailProject.start_date)} → {formatDate(detailProject.end_date)} · Vai trò của bạn: {row?.role || 'Thành viên'}</p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {(row?.members ?? []).map((member) => <Badge key={member.id} className="bg-white text-slate-600">{member.profile?.name || 'Thành viên'}</Badge>)}
              </div>
            </section>
            <Link
              to={`/staff/kanban?project=${encodeURIComponent(detailProject.id)}`}
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-emerald-600 px-4 text-sm font-semibold text-white hover:bg-emerald-700"
            >
              <KanbanSquare className="h-4 w-4" /> Mở Kanban dự án
            </Link>
            <div className="rounded-xl bg-slate-50 p-3 text-sm text-slate-700">Tiến độ: {done}/{projectTasks.length} nhiệm vụ hoàn thành ({projectTasks.length ? Math.round(done * 100 / projectTasks.length) : 0}%)</div>
            <h3 className="flex items-center gap-2 text-sm font-bold text-slate-800"><KanbanSquare className="h-4 w-4 text-emerald-600" />Kanban công việc của dự án</h3>
            <div className="flex snap-x gap-3 overflow-x-auto pb-2 md:grid md:grid-cols-2 xl:grid-cols-4">
              {KANBAN_COLUMNS.map((column) => {
                const columnTasks = projectTasks.filter((task) => task.status === column.value);
                return <section key={column.value} className="w-[78vw] shrink-0 snap-start rounded-xl border border-slate-200 bg-slate-50 p-3 md:w-auto">
                  <div className={`mb-3 flex items-center justify-between border-t-4 ${column.accent} rounded-t pt-2`}>
                    <h4 className="text-xs font-bold text-slate-700">{column.label}</h4>
                    <Badge className="bg-white text-slate-600">{columnTasks.length}</Badge>
                  </div>
                  <div className="max-h-72 space-y-2 overflow-y-auto">
                    {columnTasks.map((task) => <article key={task.id} className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
                      <p className="text-sm font-semibold text-slate-800">{task.title}</p>
                      {task.description && <p className="mt-1 line-clamp-2 text-xs text-slate-500">{task.description}</p>}
                      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-2 text-[11px] text-slate-500">
                        <span>{task.assignee_id ? memberNames.get(task.assignee_id) || 'Thành viên dự án' : 'Chưa phân công'}</span>
                        {task.due_date && <span>Hạn {formatDate(task.due_date)}</span>}
                      </div>
                    </article>)}
                    {columnTasks.length === 0 && <p className="py-4 text-center text-xs text-slate-400">Chưa có tác vụ</p>}
                  </div>
                </section>;
              })}
            </div>
          </div>;
        })()}
      </Modal>
      <Modal
        open={!!docsProject}
        onClose={() => setDocsProject(null)}
        title={`Tài liệu — ${docsProject?.name ?? ''}`}
        size="lg"
      >
        {docsProject && <ProjectDocuments projectId={docsProject.id} />}
      </Modal>
    </div>
  );
}
