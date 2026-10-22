import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  DndContext, DragOverlay, PointerSensor, useDroppable, useSensor, useSensors,
  closestCorners, type DragStartEvent, type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Calendar, CalendarDays, Clock3, History, KanbanSquare, AlertCircle, Edit3, Trash2, Plus, ShieldCheck, Send, Paperclip, X } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input, Select, Textarea } from '@/components/ui/Input';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/contexts/ToastContext';
import { useConfirm } from '@/contexts/ConfirmContext';
import { useAuth } from '@/contexts/AuthContext';
import { useRealtimeSync } from '@/hooks/useRealtimeSync';
import { ErrorState } from '@/components/ui/ErrorState';
import { supabase } from '@/lib/supabase';
import { describeDbError } from '@/lib/dbError';
import { uploadContentType } from '@/lib/documents';
import { fetchProfileMap } from '@/lib/profileDirectory';
import { notifyUser } from '@/lib/assignments';
import { TaskCompletionReviewModal } from '@/components/TaskCompletionReviewModal';
import { KANBAN_COLUMNS, PRIORITY_CONFIG, formatDate, getTodayString, isOverdue } from '@/lib/utils';
import type { Task, TaskStatus, TaskPriority, Project, Profile, ProjectMember, MemberRole, ProjectRoleDefinition } from '@/types';

type ProjectAccess = Pick<ProjectRoleDefinition, 'code' | 'name' | 'permissions'>;
type TaskViewFilter = 'all' | 'today' | 'upcoming' | 'history';
interface MyTaskRequest {
  id: string;
  task_id: string;
  request_type: 'DEADLINE_EXTENSION' | 'COMPLETION';
  status: 'SUBMITTED' | 'APPROVED' | 'RETURNED';
  review_note: string | null;
  requested_due_date: string | null;
  evidence_url: string | null;
  evidence_file_path: string | null;
  evidence_file_name: string | null;
  evidence_file_signed_url?: string | null;
  created_at: string;
}

function nextDate(date: string): string {
  const value = new Date(`${date}T12:00:00`);
  value.setDate(value.getDate() + 1);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

const LEGACY_ACCESS: Record<string, ProjectAccess> = {
  lead: { code: 'lead', name: 'Trưởng dự án', permissions: ['project.view', 'member.manage', 'task.create', 'task.edit', 'task.delete', 'task.assign', 'task.move_any', 'task.move_own'] },
  member: { code: 'member', name: 'Thành viên', permissions: ['project.view', 'task.move_own'] },
  viewer: { code: 'viewer', name: 'Người xem', permissions: ['project.view'] },
};

export function StaffKanban() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { profile } = useAuth();
  const { toast } = useToast();
  const confirm = useConfirm();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [projectMembers, setProjectMembers] = useState<ProjectMember[]>([]);
  const [projectAccess, setProjectAccess] = useState<Record<string, ProjectAccess>>({});
  const [myTaskRequests, setMyTaskRequests] = useState<MyTaskRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [projectFilter, setProjectFilter] = useState<string>(() => searchParams.get('project') || 'all');
  const [taskView, setTaskView] = useState<TaskViewFilter>('all');
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [workflowTarget, setWorkflowTarget] = useState<Task | null>(null);
  const [workflowKind, setWorkflowKind] = useState<'DEADLINE_EXTENSION' | 'COMPLETION'>('COMPLETION');
  const [workflowDate, setWorkflowDate] = useState('');
  const [workflowNote, setWorkflowNote] = useState('');
  const [workflowEvidenceUrl, setWorkflowEvidenceUrl] = useState('');
  const [workflowEvidenceFile, setWorkflowEvidenceFile] = useState<File | null>(null);
  const [workflowSaving, setWorkflowSaving] = useState(false);
  const [reviewTask, setReviewTask] = useState<Task | null>(null);
  const [createForm, setCreateForm] = useState({ title: '', description: '', project_id: '', assignee_id: '', start_date: '', due_date: '', priority: 'medium' as TaskPriority });

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  useEffect(() => {
    if (profile) loadData();
  }, [profile]);

  useEffect(() => {
    const projectId = searchParams.get('project');
    if (projectId) setProjectFilter(projectId);
  }, [searchParams]);

  useRealtimeSync(
    profile ? [{ table: 'tasks' }, { table: 'task_status_logs' }, { table: 'project_members' }, { table: 'project_task_requests', filter: `requested_by=eq.${profile.id}` }] : [],
    () => loadData(true),
    { enabled: !!profile },
  );

  const loadData = async (silent = false) => {
    if (!silent) setLoading(true);
    const enrichedMembershipResult = await supabase
      .from('project_members')
      .select('project_id, role, role_code, project_role:project_role_definitions!role_code(code,name,permissions)')
      .eq('user_id', profile?.id);
    let membershipRows: unknown[] = enrichedMembershipResult.data || [];
    let membershipErr = enrichedMembershipResult.error;

    // Cơ sở dữ liệu chưa chạy migration quyền mới vẫn dùng được ba role cũ.
    if (membershipErr) {
      const legacyResult = await supabase
        .from('project_members')
        .select('project_id, role')
        .eq('user_id', profile?.id);
      membershipRows = legacyResult.data || [];
      membershipErr = legacyResult.error;
    }

    const mList = membershipRows as Array<{
      project_id: string;
      role: MemberRole;
      role_code?: MemberRole;
      project_role?: ProjectAccess | ProjectAccess[] | null;
    }>;
    const projectIds = mList.map((m: { project_id: string }) => m.project_id);
    setProjectAccess(Object.fromEntries(mList.map((member) => {
      const joinedRole = Array.isArray(member.project_role) ? member.project_role[0] : member.project_role;
      const access = joinedRole ?? LEGACY_ACCESS[member.role] ?? { code: member.role_code || member.role, name: member.role_code || member.role, permissions: ['project.view'] };
      return [member.project_id, access];
    })));

    if (projectIds.length === 0) {
      setTasks([]);
      setProjects([]);
      setProfiles([]);
      setProjectMembers([]);
      setMyTaskRequests([]);
      setLoadError(membershipErr ? describeDbError(membershipErr) : null);
      setLoading(false);
      return;
    }

    const [
      { data: taskData, error: taskErr },
      { data: projectData, error: projectErr },
      { data: memberData, error: memberErr },
      { data: requestData, error: requestErr },
    ] = await Promise.all([
      supabase.from('tasks').select('*, project:projects(*)').in('project_id', projectIds).order('order_index', { ascending: true }),
      supabase.from('projects').select('*').in('id', projectIds),
      supabase.from('project_members').select('*').in('project_id', projectIds),
      supabase.from('project_task_requests')
        .select('id,task_id,request_type,status,review_note,requested_due_date,evidence_url,evidence_file_path,evidence_file_name,created_at')
        .eq('requested_by', profile?.id ?? '')
        .order('created_at', { ascending: false }),
    ]);

    const firstError = membershipErr ?? taskErr ?? projectErr ?? memberErr ?? requestErr;
    // Chỉ tải hồ sơ thành viên thuộc các dự án hiện tại, không nhúng VIEW qua PostgREST.
    const rawMembers = (memberData || []) as ProjectMember[];
    const people = await fetchProfileMap(rawMembers.map((item) => item.user_id));
    const members = rawMembers.map((item) => ({ ...item, profile: item.profile ?? people.get(item.user_id) }));
    const uniqueProfiles = Array.from(
      new Map(members.flatMap((member) => member.profile ? [[member.profile.id, member.profile] as const] : [])).values(),
    );
    setLoadError(firstError ? describeDbError(firstError) : null);
    setTasks((taskData || []) as Task[]);
    setProjects((projectData || []) as Project[]);
    setProjectMembers(members);
    setProfiles(uniqueProfiles);
    const requestRows = (requestData || []) as MyTaskRequest[];
    const signedRequests = await Promise.all(requestRows.map(async (request) => {
      if (!request.evidence_file_path) return request;
      const { data } = await supabase.storage.from('task-evidence').createSignedUrl(request.evidence_file_path, 300);
      return { ...request, evidence_file_signed_url: data?.signedUrl ?? null };
    }));
    setMyTaskRequests(signedRequests);
    setLoading(false);
  };

  const hasProjectPermission = (projectId: string, permission: string) => projectAccess[projectId]?.permissions.includes(permission) ?? false;
  const canCreateTask = (projectId: string) => hasProjectPermission(projectId, 'task.create');
  const canEditTask = (projectId: string) => hasProjectPermission(projectId, 'task.edit');
  const canDeleteTask = (projectId: string) => hasProjectPermission(projectId, 'task.delete');
  const canAssignTask = (projectId: string) => hasProjectPermission(projectId, 'task.assign');
  const canMoveTask = (task: Task) => task.assignee_id === profile?.id
    && task.status !== 'in_review'
    && hasProjectPermission(task.project_id, 'task.move_own');
  /** Trưởng dự án = projects.lead_id hoặc thành viên vai trò lead (khớp can_review_project_task_request). */
  const projectLeadIds = (projectId: string) => [...new Set([
    ...projects.filter((project) => project.id === projectId && project.lead_id).map((project) => project.lead_id as string),
    ...projectMembers
      .filter((member) => member.project_id === projectId && (member.role_code || member.role) === 'lead')
      .map((member) => member.user_id),
  ])];
  const canReviewTask = (task: Task) => task.status === 'in_review'
    && !!profile && task.assignee_id !== profile.id
    && projectLeadIds(task.project_id).includes(profile.id);
  const creatableProjects = projects.filter((project) => canCreateTask(project.id));
  const selectedProject = projects.find((project) => project.id === projectFilter);
  const selectedAccess = projectFilter === 'all' ? null : projectAccess[projectFilter];
  const assignableProfiles = Array.from(new Map(
    projectMembers
      .filter((member) => member.project_id === createForm.project_id)
      .flatMap((member) => member.profile ? [[member.profile.id, member.profile] as const] : [])
  ).values());
  const latestRequestByTask = new Map<string, MyTaskRequest>();
  for (const request of myTaskRequests) {
    if (!latestRequestByTask.has(request.task_id)) latestRequestByTask.set(request.task_id, request);
  }

  const projectTasks = projectFilter === 'all'
    ? tasks
    : tasks.filter((t) => t.project_id === projectFilter);
  const today = getTodayString();
  const todayTasks = projectTasks.filter((task) => task.due_date === today || task.start_date === today);
  const upcomingTasks = projectTasks.filter((task) => task.status !== 'done' && (task.due_date || task.start_date || '') > today);
  const historyTasks = projectTasks.filter((task) => task.status === 'done');
  const filteredTasks = taskView === 'today' ? todayTasks
    : taskView === 'upcoming' ? upcomingTasks
      : taskView === 'history' ? historyTasks : projectTasks;

  const handleDragStart = (e: DragStartEvent) => {
    const task = tasks.find((item) => item.id === e.active.id);
    if (task && canMoveTask(task)) setActiveId(e.active.id as string);
  };

  const handleDragEnd = async (e: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = e;
    if (!over) return;

    const taskId = active.id as string;
    const overId = over.id as string;

    // Tìm cột đích dựa trên id của phần tử bị kéo qua
    let newStatus: TaskStatus | undefined;
    
    // Nếu kéo đè lên chính cột
    const column = KANBAN_COLUMNS.find(c => c.value === overId);
    if (column) {
      newStatus = column.value;
    } else {
      // Nếu kéo đè lên một tác vụ khác trong cột, tìm tác vụ đó thuộc cột nào
      const targetTask = tasks.find(t => t.id === overId);
      if (targetTask) {
        newStatus = targetTask.status;
      }
    }

    if (!newStatus) return;

    const task = tasks.find((t) => t.id === taskId);
    if (!task || task.status === newStatus) return;
    if (!canMoveTask(task)) {
      toast('Bạn chỉ được chuyển trạng thái tác vụ được giao cho mình.', 'warning');
      return;
    }
    if (task.assignee_id !== profile?.id) {
      toast('Chỉ người được giao mới được chuyển trạng thái thẻ.', 'warning');
      return;
    }
    if (newStatus === 'done') {
      toast('Chỉ người kiểm duyệt mới nghiệm thu hoàn thành.', 'warning');
      return;
    }
    if (newStatus === 'in_review') {
      if (task.status !== 'in_progress') {
        toast('Chỉ có thể gửi nghiệm thu từ cột Đang làm.', 'warning');
        return;
      }
      if (latestRequestByTask.get(task.id)?.status === 'SUBMITTED') {
        toast('Yêu cầu nghiệm thu đang chờ Project lead xử lý.', 'warning');
        return;
      }
      setWorkflowTarget(task);
      setWorkflowKind('COMPLETION');
      setWorkflowDate('');
      setWorkflowNote('');
      setWorkflowEvidenceUrl('');
      setWorkflowEvidenceFile(null);
      return;
    }
    const validMove = (task.status === 'todo' && newStatus === 'in_progress')
      || (task.status === 'in_progress' && newStatus === 'todo')
      || (task.status === 'done' && (newStatus === 'todo' || newStatus === 'in_progress'));
    if (!validMove) {
      toast('Chuyển cột không đúng thứ tự.', 'warning');
      return;
    }

    // Cập nhật UI ngay lập tức (Optimistic Update)
    setTasks((prev) => prev.map((t) => t.id === taskId ? { ...t, status: newStatus! } : t));

    const { error } = await supabase.from('tasks').update({ status: newStatus }).eq('id', taskId);
    if (error) {
      toast('Cập nhật thất bại: ' + error.message, 'error');
      loadData(true);
    } else {
      toast(`Đã chuyển sang "${KANBAN_COLUMNS.find((c) => c.value === newStatus)?.label}"`, 'success');
    }
  };

  const handleStartTask = async (task: Task) => {
    if (!canMoveTask(task) || task.status !== 'todo') return;
    setTasks((prev) => prev.map((item) => item.id === task.id ? { ...item, status: 'in_progress' } : item));
    const { error } = await supabase.from('tasks').update({ status: 'in_progress' }).eq('id', task.id);
    if (error) {
      toast(`Không thể bắt đầu tác vụ: ${error.message}`, 'error');
      await loadData(true);
      return;
    }
    toast('Đã chuyển tác vụ sang Đang làm. Khi hoàn tất, chọn “Nộp task” để gửi nghiệm thu.', 'success');
  };

  const openWorkflowRequest = (task: Task, kind: 'DEADLINE_EXTENSION' | 'COMPLETION') => {
    setWorkflowTarget(task);
    setWorkflowKind(kind);
    setWorkflowDate(kind === 'DEADLINE_EXTENSION' && task.due_date ? nextDate(task.due_date) : '');
    setWorkflowNote('');
    setWorkflowEvidenceUrl('');
    setWorkflowEvidenceFile(null);
  };

  useEffect(() => {
    const taskId = searchParams.get('task');
    if (!taskId || loading) return;
    const task = tasks.find((item) => item.id === taskId);
    if (!task) return;
    if (task.status === 'in_progress' && task.assignee_id === profile?.id) {
      setWorkflowTarget(task);
      setWorkflowKind('COMPLETION');
      setWorkflowDate('');
      setWorkflowNote('');
      setWorkflowEvidenceUrl('');
      setWorkflowEvidenceFile(null);
    }
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete('task');
    setSearchParams(nextParams, { replace: true });
  }, [searchParams, setSearchParams, tasks, loading, profile?.id]);

  const submitWorkflowRequest = async () => {
    if (!workflowTarget) return;
    if (workflowNote.trim().length < (workflowKind === 'COMPLETION' ? 10 : 3)) {
      toast(workflowKind === 'COMPLETION' ? 'Báo cáo công việc cần ít nhất 10 ký tự.' : 'Nhập lý do xin gia hạn (ít nhất 3 ký tự).', 'warning');
      return;
    }
    if (workflowKind === 'DEADLINE_EXTENSION' && !workflowDate) {
      toast('Chọn hạn mới.', 'warning');
      return;
    }
    if (workflowKind === 'COMPLETION' && !workflowEvidenceFile) {
      toast('Đính kèm file minh chứng trước khi gửi nghiệm thu.', 'warning');
      return;
    }
    const evidenceUrl = workflowEvidenceUrl.trim();
    if (workflowEvidenceFile && workflowEvidenceFile.size > 10 * 1024 * 1024) {
      toast('File minh chứng tối đa 10 MB.', 'warning');
      return;
    }
    if (evidenceUrl) {
      try {
        const parsed = new URL(evidenceUrl);
        if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error('protocol');
      } catch {
        toast('Link minh chứng phải bắt đầu bằng http:// hoặc https://.', 'warning');
        return;
      }
    }
    setWorkflowSaving(true);
    let evidenceFilePath: string | null = null;
    if (workflowKind === 'COMPLETION' && workflowEvidenceFile) {
      // Storage chỉ nhận key ASCII: bỏ dấu tiếng Việt, tên gốc vẫn lưu ở target_evidence_file_name.
      const safeFileName = workflowEvidenceFile.name
        .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd')
        .replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-').slice(-120) || 'minh-chung';
      evidenceFilePath = `${workflowTarget.project_id}/${workflowTarget.id}/${profile?.id}/${crypto.randomUUID()}-${safeFileName}`;
      const { error: uploadError } = await supabase.storage.from('task-evidence').upload(evidenceFilePath, workflowEvidenceFile, {
        contentType: uploadContentType(workflowEvidenceFile.name),
      });
      if (uploadError) {
        setWorkflowSaving(false);
        toast(`Tải file minh chứng thất bại: ${uploadError.message}`, 'error');
        return;
      }
    }
    const { error } = await supabase.rpc('request_project_task_action', {
      target_task: workflowTarget.id,
      request_kind: workflowKind,
      target_due_date: workflowKind === 'DEADLINE_EXTENSION' ? workflowDate : null,
      request_reason: workflowNote.trim(),
      target_evidence_url: evidenceUrl || null,
      target_evidence_file_path: evidenceFilePath,
      target_evidence_file_name: workflowEvidenceFile?.name ?? null,
    });
    setWorkflowSaving(false);
    if (error) {
      if (evidenceFilePath) await supabase.storage.from('task-evidence').remove([evidenceFilePath]);
      toast(`Gửi yêu cầu thất bại: ${describeDbError(error)}`, 'error');
      return;
    }
    // F04.05: chỉ trưởng dự án duyệt nên chỉ báo cho trưởng dự án (lead_id và
    // thành viên vai trò lead), trừ chính người gửi.
    const reviewerIds = projectLeadIds(workflowTarget.project_id).filter((reviewerId) => reviewerId !== profile?.id);
    toast(
      reviewerIds.length === 0
        ? 'Đã gửi, nhưng dự án chưa có trưởng dự án khác để duyệt. Báo quản trị viên gán trưởng dự án.'
        : workflowKind === 'DEADLINE_EXTENSION' ? 'Đã gửi yêu cầu gia hạn.' : 'Đã gửi yêu cầu nghiệm thu.',
      reviewerIds.length === 0 ? 'warning' : 'success',
    );
    for (const reviewerId of reviewerIds) {
      await notifyUser(
        reviewerId,
        workflowKind === 'DEADLINE_EXTENSION' ? 'Yêu cầu gia hạn deadline' : 'Yêu cầu nghiệm thu task',
        workflowTarget.title,
        'project_task_review',
      );
    }
    if (workflowKind === 'COMPLETION' && workflowTarget) {
      // request_project_task_action đã chuyển thẻ sang in_review trong cùng giao dịch.
      const targetId = workflowTarget.id;
      setTasks((prev) => prev.map((t) => t.id === targetId ? { ...t, status: 'in_review' } : t));
    }
    setWorkflowTarget(null);
    await loadData(true);
  };

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();

    if (editingTask) {
      if (!canEditTask(editingTask.project_id)) {
        toast('Vai trò của bạn không có quyền chỉnh sửa nội dung tác vụ.', 'warning');
        return;
      }
      const { error } = await supabase.from('tasks').update({
        title: createForm.title,
        description: createForm.description || null,
        assignee_id: createForm.assignee_id || profile?.id,
        start_date: createForm.start_date || null,
        due_date: createForm.due_date || null,
        priority: createForm.priority,
      }).eq('id', editingTask.id);
      if (error) {
        toast('Cập nhật tác vụ thất bại', 'error');
      } else {
        const newAssigneeId = createForm.assignee_id || profile?.id;
        if (newAssigneeId && newAssigneeId !== editingTask.assignee_id && newAssigneeId !== profile?.id) {
          const taskProject = projects.find((project) => project.id === editingTask.project_id);
          await notifyUser(
            newAssigneeId,
            'Bạn được giao một tác vụ dự án',
            `${createForm.title}${taskProject?.name ? ` · ${taskProject.name}` : ''}`,
            'project_task_assigned',
          );
        }
        toast('Cập nhật tác vụ thành công!', 'success');
        setCreateModalOpen(false);
        setEditingTask(null);
        setCreateForm({ title: '', description: '', project_id: '', assignee_id: '', start_date: '', due_date: '', priority: 'medium' });
        loadData();
      }
      return;
    }

    if (!createForm.project_id) {
      toast('Vui lòng chọn dự án', 'warning');
      return;
    }
    if (!canCreateTask(createForm.project_id)) {
      toast('Vai trò của bạn không có quyền tạo tác vụ.', 'warning');
      return;
    }
    const { error } = await supabase.from('tasks').insert({
      project_id: createForm.project_id,
      title: createForm.title,
      description: createForm.description || null,
      assignee_id: createForm.assignee_id || profile?.id,
      start_date: createForm.start_date || null,
      due_date: createForm.due_date || null,
      priority: createForm.priority,
      status: 'todo',
      order_index: tasks.filter((t) => t.project_id === createForm.project_id).length,
    });
    if (error) {
      toast('Tạo tác vụ thất bại', 'error');
    } else {
      const newAssigneeId = createForm.assignee_id || profile?.id;
      if (newAssigneeId && newAssigneeId !== profile?.id) {
        const taskProject = projects.find((project) => project.id === createForm.project_id);
        await notifyUser(
          newAssigneeId,
          'Bạn có tác vụ dự án mới',
          `${createForm.title}${taskProject?.name ? ` · ${taskProject.name}` : ''}`,
          'project_task_assigned',
        );
      }
      toast('Tạo tác vụ thành công!', 'success');
      setCreateModalOpen(false);
      setCreateForm({ title: '', description: '', project_id: '', assignee_id: '', start_date: '', due_date: '', priority: 'medium' });
      loadData();
    }
  };

  const openEditTask = (task: Task) => {
    if (!canEditTask(task.project_id)) return;
    setEditingTask(task);
    setCreateForm({
      title: task.title,
      description: task.description || '',
      project_id: task.project_id,
      assignee_id: task.assignee_id || '',
      start_date: task.start_date || '',
      due_date: task.due_date || '',
      priority: task.priority,
    });
    setCreateModalOpen(true);
  };

  const handleDeleteTask = async (task: Task) => {
    if (!canDeleteTask(task.project_id)) {
      toast('Vai trò của bạn không có quyền xóa tác vụ.', 'warning');
      return;
    }
    const ok = await confirm({
      title: `Xóa tác vụ "${task.title}"?`,
      message: 'Tác vụ sẽ bị xóa vĩnh viễn khỏi bảng Kanban.',
      confirmLabel: 'Xóa tác vụ',
      danger: true,
    });
    if (!ok) return;
    const { error } = await supabase.from('tasks').delete().eq('id', task.id);
    if (error) {
      toast('Xóa tác vụ thất bại', 'error');
    } else {
      toast('Đã xóa tác vụ', 'success');
      loadData();
    }
  };

  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-96" />)}
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="bg-white border border-slate-200 rounded-2xl">
        <ErrorState message={loadError} onRetry={loadData} />
      </div>
    );
  }

  if (projects.length === 0) {
    return (
      <Card>
        <EmptyState title="Chưa có dự án" description="Bạn cần được thêm vào dự án để sử dụng Kanban board." />
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <header className="rounded-2xl border border-slate-200/80 bg-white px-5 py-4 shadow-sm sm:px-6">
        <p className="text-lg font-bold tracking-tight text-slate-800">{selectedProject?.name || 'Dự án của tôi'}</p>
        <div className="mt-1 flex items-center gap-2 text-xs text-slate-500">
          <span>Dự án</span><span className="text-slate-300">/</span><span className="font-medium text-emerald-700">Bảng tác vụ</span>
          {selectedAccess && <Badge className="ml-1 bg-emerald-50 text-emerald-700"><ShieldCheck className="mr-1 h-3.5 w-3.5" />{selectedAccess.name}</Badge>}
        </div>
      </header>

      <section className="rounded-2xl border border-slate-200/80 bg-white p-3 shadow-sm sm:p-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Lọc tác vụ">
            {([
              { value: 'all', label: 'Tất cả', count: projectTasks.length, icon: KanbanSquare },
              { value: 'today', label: 'Hôm nay', count: todayTasks.length, icon: CalendarDays },
              { value: 'upcoming', label: 'Sắp tới', count: upcomingTasks.length, icon: Clock3 },
              { value: 'history', label: 'Lịch sử tác vụ', count: historyTasks.length, icon: History },
            ] as const).map((filter) => {
              const Icon = filter.icon;
              const active = taskView === filter.value;
              return (
                <button
                  key={filter.value}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setTaskView(filter.value)}
                  className={`inline-flex h-10 items-center gap-2 rounded-xl border px-3 text-xs font-semibold transition-colors sm:text-sm ${active
                    ? 'border-rose-600 bg-rose-600 text-white shadow-sm'
                    : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'}`}
                >
                  <Icon className="h-4 w-4" />
                  {filter.label}
                  <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${active ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500'}`}>{filter.count}</span>
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
            <select
              value={projectFilter}
              onChange={(e) => setProjectFilter(e.target.value)}
              aria-label="Chọn dự án"
              className="h-10 min-w-48 flex-1 rounded-xl border border-slate-200 bg-white px-3.5 text-sm text-slate-700 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 sm:flex-none"
            >
              <option value="all">Tất cả dự án</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            {creatableProjects.length > 0 && (
              <Button
                theme="staff"
                onClick={() => {
                  const initialProject = projectFilter !== 'all' && canCreateTask(projectFilter) ? projectFilter : creatableProjects[0].id;
                  setEditingTask(null);
                  setCreateForm({ title: '', description: '', project_id: initialProject, assignee_id: '', start_date: '', due_date: '', priority: 'medium' });
                  setCreateModalOpen(true);
                }}
              >
                <Plus className="h-4 w-4" /> Tạo tác vụ
              </Button>
            )}
          </div>
        </div>
      </section>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        {/* Điện thoại: bốn cột xếp dọc thành một trang dài lê thê, muốn xem cột
            "Hoàn thành" phải cuộn qua hết ba cột trước. Chuyển sang vuốt ngang
            có điểm dừng — mỗi lần vuốt là đúng một cột, giống Trello. */}
        <div
          className="flex gap-4 overflow-x-auto snap-x snap-mandatory pb-2 -mx-4 px-4
                     md:mx-0 md:px-0 md:grid md:grid-cols-2 lg:grid-cols-4 md:overflow-visible"
        >
          {KANBAN_COLUMNS.map((column) => {
            const columnTasks = filteredTasks.filter((t) => t.status === column.value);
            return (
              <KanbanDropColumn
                id={column.value}
                key={column.value}
                className="bg-slate-50/90 rounded-2xl p-3 min-h-[440px] flex flex-col border border-slate-200/70 shadow-sm
                           w-[85vw] flex-shrink-0 snap-start md:w-auto md:flex-shrink"
              >
                <div className={`flex items-center justify-between mb-3 px-1 border-t-4 ${column.accent} rounded-t-lg pt-2`}>
                  <h3 className="text-sm font-bold text-slate-700">{column.label}</h3>
                  <span className="text-xs font-bold text-slate-500 bg-white px-2.5 py-0.5 rounded-full shadow-soft">
                    {columnTasks.length}
                  </span>
                </div>
                <SortableContext
                  items={columnTasks.map((t) => t.id)}
                  strategy={verticalListSortingStrategy}
                >
<div className="flex-1 space-y-2 min-h-[50px]">
                    {columnTasks.map((task) => (
                      <SortableTaskCard
                        key={task.id}
                        task={task}
                        assignee={profiles.find((p) => p.id === task.assignee_id)}
                        canMove={canMoveTask(task)}
                        onEdit={task.status !== 'done' && canEditTask(task.project_id) ? () => openEditTask(task) : undefined}
                        onDelete={task.status !== 'done' && canDeleteTask(task.project_id) ? () => handleDeleteTask(task) : undefined}
                        onRequestDeadline={task.status !== 'done' && task.assignee_id === profile?.id && task.due_date
                          && latestRequestByTask.get(task.id)?.status !== 'SUBMITTED'
                          ? () => openWorkflowRequest(task, 'DEADLINE_EXTENSION') : undefined}
        onRequestCompletion={task.assignee_id === profile?.id && task.status === 'in_progress'
                          && latestRequestByTask.get(task.id)?.status !== 'SUBMITTED'
                          ? () => openWorkflowRequest(task, 'COMPLETION') : undefined}
                        request={latestRequestByTask.get(task.id)}
                        onStart={task.status === 'todo' && canMoveTask(task) ? () => void handleStartTask(task) : undefined}
                        onReview={canReviewTask(task) ? () => setReviewTask(task) : undefined}
                      />
                    ))}
                  </div>
                </SortableContext>
                {columnTasks.length === 0 && (
                  <div className="flex-1 flex items-center justify-center text-xs text-slate-400 py-4">
                    Kéo tác vụ vào đây
                  </div>
                )}
              </KanbanDropColumn>
            );
          })}
        </div>

        <DragOverlay>
          {activeId ? (
            <TaskCard
              task={tasks.find((t) => t.id === activeId)!}
              assignee={profiles.find((p) => p.id === tasks.find((t) => t.id === activeId)?.assignee_id)}
              dragging
            />
          ) : null}
        </DragOverlay>
      </DndContext>

      <TaskCompletionReviewModal
        task={reviewTask}
        requesterName={profiles.find((p) => p.id === reviewTask?.assignee_id)?.name}
        onClose={() => setReviewTask(null)}
        onReviewed={() => void loadData(true)}
      />

      <Modal open={createModalOpen} onClose={() => setCreateModalOpen(false)} title={editingTask ? 'Chỉnh sửa tác vụ' : 'Tạo tác vụ mới'}>
        <form onSubmit={handleCreateTask} className="space-y-4">
<Select
            label="Dự án"
            value={createForm.project_id}
            onChange={(e) => setCreateForm({ ...createForm, project_id: e.target.value })}
            disabled={!!editingTask}
            required
          >
            <option value="">— Chọn dự án —</option>
            {creatableProjects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </Select>
          <Input
            label="Tiêu đề"
            value={createForm.title}
            onChange={(e) => setCreateForm({ ...createForm, title: e.target.value })}
            required
            placeholder="VD: Thiết kế trang chủ"
          />
          <Textarea
            label="Mô tả"
            value={createForm.description}
            onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })}
            rows={3}
          />
          <Select
            label="Người thực hiện"
            value={createForm.assignee_id}
            onChange={(e) => setCreateForm({ ...createForm, assignee_id: e.target.value })}
            disabled={!canAssignTask(createForm.project_id)}
          >
            <option value="">{canAssignTask(createForm.project_id) ? '— Chưa giao —' : 'Không có quyền phân công'}</option>
            {assignableProfiles.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </Select>
          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Ngày bắt đầu"
              type="date"
              value={createForm.start_date}
              max={createForm.due_date || undefined}
              onChange={(e) => setCreateForm({ ...createForm, start_date: e.target.value })}
            />
            <Input
              label="Hạn chót"
              type="date"
              value={createForm.due_date}
              min={createForm.start_date || undefined}
              disabled={!!editingTask}
              onChange={(e) => setCreateForm({ ...createForm, due_date: e.target.value })}
            />
          </div>
          {editingTask && <p className="text-xs text-slate-500">Đổi hạn chót cần gửi yêu cầu gia hạn để Project lead duyệt.</p>}
          <div className="grid grid-cols-2 gap-4">
            <Select
              label="Mức ưu tiên"
              value={createForm.priority}
              onChange={(e) => setCreateForm({ ...createForm, priority: e.target.value as TaskPriority })}
            >
              <option value="low">Thấp</option>
              <option value="medium">Trung bình</option>
              <option value="high">Cao</option>
              <option value="critical">Khẩn cấp</option>
            </Select>
          </div>
<div className="flex gap-3 pt-2">
            <Button type="button" variant="outline" onClick={() => setCreateModalOpen(false)} className="flex-1">Hủy</Button>
            <Button type="submit" theme="staff" className="flex-1">{editingTask ? 'Lưu thay đổi' : 'Tạo tác vụ'}</Button>
          </div>
        </form>
      </Modal>

      <Modal
        open={!!workflowTarget}
        onClose={() => setWorkflowTarget(null)}
        title={workflowKind === 'DEADLINE_EXTENSION' ? 'Yêu cầu gia hạn deadline' : 'Gửi nghiệm thu task'}
      >
        {workflowTarget && (
          <div className="space-y-4">
            <p className="text-sm font-medium text-slate-700">{workflowTarget.title}</p>
            {workflowKind === 'DEADLINE_EXTENSION' && (
              <>
                <p className="text-xs text-slate-500">Hạn hiện tại: {workflowTarget.due_date ? formatDate(workflowTarget.due_date) : '—'}</p>
                <Input
                  label="Hạn mới đề xuất"
                  type="date"
                  min={workflowTarget.due_date ? nextDate(workflowTarget.due_date) : undefined}
                  value={workflowDate}
                  onChange={(event) => setWorkflowDate(event.target.value)}
                  required
                />
              </>
            )}
            <Textarea
              label={workflowKind === 'DEADLINE_EXTENSION' ? 'Lý do xin gia hạn' : 'Kết quả công việc / ghi chú nghiệm thu'}
              rows={4}
              value={workflowNote}
              onChange={(event) => setWorkflowNote(event.target.value)}
              required
            />
            {workflowKind === 'COMPLETION' && (
              <>
              <Input
                label="Link minh chứng (tùy chọn)"
                type="url"
                value={workflowEvidenceUrl}
                onChange={(event) => setWorkflowEvidenceUrl(event.target.value)}
                placeholder="https://..."
                autoComplete="url"
              />
              <div className="space-y-2">
                <p className="text-sm font-semibold text-slate-700">File minh chứng (bắt buộc)</p>
                <label htmlFor="completion-evidence-file" className="flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-3 transition hover:border-indigo-400 hover:bg-indigo-50/50">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white text-indigo-600 shadow-sm"><Paperclip className="h-5 w-5" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-indigo-700">Chọn file từ máy tính</span>
                    <span className="mt-0.5 block text-xs font-normal text-slate-500">Tối đa 10 MB · Link minh chứng là tùy chọn, nhưng bắt buộc phải gán file minh chứng</span>
                  </span>
                  <input
                    id="completion-evidence-file"
                    type="file"
                    className="sr-only"
                    onChange={(event) => {
                      setWorkflowEvidenceFile(event.target.files?.[0] ?? null);
                      event.currentTarget.value = '';
                    }}
                  />
                </label>
                {workflowEvidenceFile && (
                  <div className="flex items-center gap-3 rounded-lg border border-indigo-100 bg-indigo-50 px-3 py-2">
                    <Paperclip className="h-4 w-4 shrink-0 text-indigo-600" />
                    <span className="min-w-0 flex-1 truncate text-xs font-medium text-slate-700">{workflowEvidenceFile.name}</span>
                    <span className="shrink-0 text-[11px] text-slate-500">{(workflowEvidenceFile.size / (1024 * 1024)).toFixed(2)} MB</span>
                    <button
                      type="button"
                      onClick={() => setWorkflowEvidenceFile(null)}
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-white hover:text-red-600"
                      aria-label="Gỡ file minh chứng"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </div>
              </>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setWorkflowTarget(null)} disabled={workflowSaving}>Hủy</Button>
              <Button onClick={() => void submitWorkflowRequest()} disabled={workflowSaving || workflowNote.trim().length < (workflowKind === 'COMPLETION' ? 10 : 3) || (workflowKind === 'COMPLETION' && !workflowEvidenceFile)}>
                <Send className="h-4 w-4" />
                {workflowSaving ? 'Đang gửi…' : 'Gửi Project lead'}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function KanbanDropColumn({ id, className, children }: {
  id: TaskStatus;
  className: string;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });

  return (
    <div
      ref={setNodeRef}
      className={`${className} transition-colors ${isOver ? 'bg-emerald-50 ring-2 ring-emerald-300' : ''}`}
    >
      {children}
    </div>
  );
}

function SortableTaskCard({ task, assignee, canMove, onEdit, onDelete, onRequestDeadline, onRequestCompletion, onStart, onReview, request }: {
  task: Task;
  assignee?: Profile;
  canMove: boolean;
  onEdit?: () => void;
  onDelete?: () => void;
  onRequestDeadline?: () => void;
  onRequestCompletion?: () => void;
  onStart?: () => void;
  onReview?: () => void;
  request?: MyTaskRequest;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id, disabled: !canMove });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <TaskCard task={task} assignee={assignee} canMove={canMove} onEdit={onEdit} onDelete={onDelete} onRequestDeadline={onRequestDeadline} onRequestCompletion={onRequestCompletion} onStart={onStart} onReview={onReview} request={request} />
    </div>
  );
}

function TaskCard({ task, assignee, dragging, canMove = true, onEdit, onDelete, onRequestDeadline, onRequestCompletion, onStart, onReview, request }: {
  task: Task;
  assignee?: Profile;
  dragging?: boolean;
  canMove?: boolean;
  onEdit?: () => void;
  onDelete?: () => void;
  onRequestDeadline?: () => void;
  onRequestCompletion?: () => void;
  onStart?: () => void;
  /** Trưởng dự án mở hộp thoại nghiệm thu thẻ ở cột Đang duyệt. */
  onReview?: () => void;
  request?: MyTaskRequest;
}) {
  const priority = PRIORITY_CONFIG[task.priority];
  const overdue = isOverdue(task.due_date, task.status);

  return (
<div
      className={`bg-white rounded-xl p-3 border border-slate-200 border-l-4 ${priority.border} ${canMove ? 'cursor-grab active:cursor-grabbing' : 'cursor-default'} shadow-soft transition-all duration-200 ${
        dragging ? 'shadow-lifted scale-[1.02] rotate-1 ring-2 ring-emerald-500/30' : 'hover:shadow-card'
      }`}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <p className="text-sm font-medium text-slate-800 leading-snug">{task.title}</p>
        <div className="flex items-center gap-0.5 flex-shrink-0">
          {onEdit && (
            <button
              onClick={(e) => { e.stopPropagation(); onEdit(); }}
              className="p-1 rounded text-slate-300 hover:text-blue-600 hover:bg-blue-50 transition-colors"
              title="Sửa"
            >
              <Edit3 className="w-3.5 h-3.5" />
            </button>
          )}
          {onDelete && (
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(); }}
              className="p-1 rounded text-slate-300 hover:text-red-600 hover:bg-red-50 transition-colors"
              title="Xóa"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
          {onRequestDeadline && (
            <button
              onClick={(e) => { e.stopPropagation(); onRequestDeadline(); }}
              className="p-1 rounded text-slate-300 hover:text-amber-600 hover:bg-amber-50 transition-colors"
              title="Yêu cầu gia hạn deadline"
            >
              <Calendar className="w-3.5 h-3.5" />
            </button>
          )}
          {onRequestCompletion && (
            <button
              onClick={(e) => { e.stopPropagation(); onRequestCompletion(); }}
              className="p-1 rounded text-slate-300 hover:text-emerald-600 hover:bg-emerald-50 transition-colors"
              title="Gửi nghiệm thu"
            >
              <ShieldCheck className="w-3.5 h-3.5" />
            </button>
          )}
          {canMove && <GripVertical className="w-3.5 h-3.5 text-slate-300 mt-0.5" />}
        </div>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <Badge className={priority.color}>{priority.label}</Badge>
        {task.project && (
          <span className="text-xs text-slate-400 truncate">{task.project.name}</span>
        )}
      </div>
      {request && (
        <div className="mt-2">
          <Badge className={request.status === 'APPROVED'
            ? 'bg-emerald-50 text-emerald-700'
            : request.status === 'RETURNED'
              ? 'bg-rose-50 text-rose-700'
              : 'bg-amber-50 text-amber-700'}>
            {request.request_type === 'DEADLINE_EXTENSION' ? 'Gia hạn' : 'Nghiệm thu'} · {
              request.status === 'APPROVED' ? 'đã duyệt' : request.status === 'RETURNED' ? 'cần gửi lại' : 'chờ duyệt'
            }
          </Badge>
          {request.status === 'RETURNED' && request.review_note && (
            <p className="mt-1 text-xs text-rose-700">{request.review_note}</p>
          )}
          {request.evidence_url && (
            <a href={request.evidence_url} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block text-xs font-medium text-indigo-700 underline underline-offset-2">
              Mở link minh chứng
            </a>
          )}
          {request.evidence_file_signed_url && (
            <a href={request.evidence_file_signed_url} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block text-xs font-medium text-indigo-700 underline underline-offset-2">
              Mở file: {request.evidence_file_name || 'minh chứng'}
            </a>
          )}
        </div>
      )}
      <div className="flex items-center justify-between mt-2.5 pt-2.5 border-t border-slate-50">
        <div className="flex items-center gap-2">
          {task.due_date && (
            <span className={`text-xs flex items-center gap-1 ${overdue ? 'text-red-500' : 'text-slate-400'}`}>
              {overdue ? <AlertCircle className="w-3 h-3" /> : <Calendar className="w-3 h-3" />}
              {formatDate(task.due_date)}
            </span>
          )}
        </div>
        {assignee && <Avatar name={assignee.name} url={assignee.avatar_url} size="sm" />}
      </div>
      {(onStart || onRequestCompletion || onReview) && (
        <div className="mt-2">
          {onReview && (
            <button onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onReview(); }} className="w-full rounded-lg bg-amber-500 px-3 py-2 text-xs font-semibold text-white transition hover:bg-amber-600">
              Chờ bạn duyệt · Nghiệm thu
            </button>
          )}
          {onStart && (
            <button onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onStart(); }} className="w-full rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-emerald-700">
              Bắt đầu tác vụ
            </button>
          )}
          {onRequestCompletion && (
            <button onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onRequestCompletion(); }} className="w-full rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-indigo-700">
              Nộp task · gửi nghiệm thu
            </button>
          )}
        </div>
      )}
    </div>
  );
}
