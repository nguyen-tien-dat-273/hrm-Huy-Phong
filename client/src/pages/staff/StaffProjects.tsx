import { useEffect, useState } from 'react';
import { Briefcase, Calendar, Users as UsersIcon, FileText } from 'lucide-react';
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
import { PROJECT_STATUS_CONFIG, MEMBER_ROLE_CONFIG, formatDate, formatVND } from '@/lib/utils';
import type { Project, ProjectMember, Task } from '@/types';

export function StaffProjects() {
  const { profile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [docsProject, setDocsProject] = useState<{ id: string; name: string } | null>(null);
  const [projects, setProjects] = useState<{ project: Project; role: string; members: ProjectMember[]; taskCount: number }[]>([]);

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
      supabase.from('tasks').select('project_id').in('project_id', projectIds),
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

          <div className="flex items-center gap-1.5 pt-3 border-t border-slate-100">
            {members.slice(0, 5).map((m) => (
              <Avatar key={m.id} name={m.profile?.name || ''} url={m.profile?.avatar_url} size="sm" />
            ))}
            {members.length > 5 && (
              <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-xs font-medium text-slate-500">
                +{members.length - 5}
              </div>
            )}

            {/* Nhân viên không có trang chi tiết dự án riêng, nên tài liệu mở
                trong hộp thoại ngay từ thẻ. */}
            <button
              onClick={() => setDocsProject({ id: project.id, name: project.name })}
              className="ml-auto inline-flex items-center gap-1.5 h-9 px-3 rounded-xl border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50 hover:border-slate-300 transition-colors"
            >
              <FileText className="w-4 h-4" />
              Tài liệu
            </button>
          </div>
        </Card>
      ))}

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
