import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useRealtimeSync } from '@/hooks/useRealtimeSync';
import { ArrowLeft, Plus, Users as UsersIcon, KanbanSquare, UserPlus, Trash2, CheckCircle2, Clock, Edit3, FileText, CalendarRange, CalendarClock, ClipboardList, GripVertical, AlertCircle } from 'lucide-react';
import {
  DndContext, DragOverlay, PointerSensor, useSensor, useSensors,
  closestCorners, type DragStartEvent, type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Select, Textarea } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { Avatar } from '@/components/ui/Avatar';
import { Modal } from '@/components/ui/Modal';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/contexts/ToastContext';
import { useConfirm } from '@/contexts/ConfirmContext';
import { useAuth } from '@/contexts/AuthContext';
import { isFullAdmin, isTeamlead, hasPermission } from '@/lib/permissions';
import { ErrorState } from '@/components/ui/ErrorState';
import { ProjectDocuments } from '@/components/ProjectDocuments';
import { ProjectEventsPanel } from '@/components/ProjectEventsPanel';
import { GanttChart } from '@/components/GanttChart';
import { estimateRatio, fetchTaskTotals, formatHours as formatWorkHours } from '@/lib/worklog';
import { notifyUser } from '@/lib/assignments';
import { supabase } from '@/lib/supabase';
import { describeDbError } from '@/lib/dbError';
import { KANBAN_COLUMNS, PRIORITY_CONFIG, TASK_STATUSES, PROJECT_STATUS_CONFIG, MEMBER_ROLE_CONFIG, formatDate, isOverdue, getTodayString } from '@/lib/utils';
import type { Project, Task, Profile, ProjectMember, TaskStatus, TaskPriority, MemberRole, ProjectRoleDefinition } from '@/types';

type Tab = 'overview' | 'tasks' | 'kanban' | 'gantt' | 'members' | 'documents' | 'events';

export function AdminProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const confirm = useConfirm();
  const { profile } = useAuth();

  const [project, setProject] = useState<Project | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [projectRoles, setProjectRoles] = useState<ProjectRoleDefinition[]>([]);
  const [allProfiles, setAllProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** Tổng giờ đã ghi cho từng tác vụ, tra theo task_id. */
  const [taskHours, setTaskHours] = useState<Map<string, number>>(new Map());
  const [tab, setTab] = useState<Tab>('overview');
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  const [taskModalOpen, setTaskModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [memberModalOpen, setMemberModalOpen] = useState(false);
  const [editingMember, setEditingMember] = useState<ProjectMember | null>(null);
  const [taskForm, setTaskForm] = useState({ title: '', description: '', assignee_id: '', start_date: '', due_date: '', priority: 'medium' as TaskPriority, estimated_hours: '' });
  const [memberForm, setMemberForm] = useState({ user_id: '', role: 'member' as MemberRole });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!id) return;
    loadData(id);
  }, [id]);

  useRealtimeSync(
    id
      ? [
          { table: 'tasks', filter: `project_id=eq.${id}` },
          { table: 'project_members', filter: `project_id=eq.${id}` },
          { table: 'task_worklogs' },
          { table: 'profiles' },
        ]
      : [],
    () => { if (id) loadData(id, true); },
    { enabled: !!id },
  );

  /**
   * `silent` dùng cho lần nạp do realtime kích hoạt: giữ nguyên nội dung đang
   * hiển thị thay vì nháy khung xương, vì người dùng không hề yêu cầu tải lại.
   */
  const loadData = async (projectId: string, silent = false) => {
    if (!silent) setLoading(true);
    const [
      { data: proj, error: projErr },
      { data: tks, error: tksErr },
      { data: mems, error: memsErr },
      { data: profiles, error: profErr },
      { data: roles },
    ] = await Promise.all([
      supabase.from('projects').select('*').eq('id', projectId).maybeSingle(),
      supabase.from('tasks').select('*').eq('project_id', projectId).order('order_index', { ascending: true }),
      supabase.from('project_members').select('*, profile:profiles_directory(*)').eq('project_id', projectId),
      supabase.from('profiles_directory').select('*').eq('is_active', true),
      supabase.from('project_role_definitions').select('*').eq('is_active', true).order('sort_order'),
    ]);

    const firstError = projErr ?? tksErr ?? memsErr ?? profErr;
    setLoadError(firstError ? describeDbError(firstError) : null);
    const taskList = (tks || []) as Task[];
    setTaskHours(await fetchTaskTotals(taskList.map((t) => t.id)));

    setProject(proj as Project | null);
    setTasks((tks || []) as Task[]);
    setMembers((mems || []) as ProjectMember[]);
    setProjectRoles((roles || []) as ProjectRoleDefinition[]);
    setAllProfiles((profiles || []) as Profile[]);
    setLoading(false);
  };

  const openCreateTask = () => {
    setEditingTask(null);
    setTaskForm({ title: '', description: '', assignee_id: '', start_date: getTodayString(), due_date: '', priority: 'medium', estimated_hours: '' });
    setTaskModalOpen(true);
  };

  const openEditTask = (task: Task) => {
    setEditingTask(task);
    setTaskForm({
      title: task.title,
      description: task.description || '',
      assignee_id: task.assignee_id || '',
      start_date: task.start_date || '',
      due_date: task.due_date || '',
      priority: task.priority,
      estimated_hours: task.estimated_hours ? String(task.estimated_hours) : '',
    });
    setTaskModalOpen(true);
  };

  const handleSaveTask = async (e: React.FormEvent) => {
    e.preventDefault();

    // DB có CHECK (start_date <= due_date). Chặn ở đây để người dùng thấy câu
    // tiếng Việt chứ không phải lỗi ràng buộc của Postgres.
    if (taskForm.start_date && taskForm.due_date && taskForm.start_date > taskForm.due_date) {
      toast('Ngày bắt đầu phải trước hoặc trùng hạn chót.', 'warning');
      return;
    }

    setSubmitting(true);
    const payload = {
      title: taskForm.title,
      description: taskForm.description || null,
      assignee_id: taskForm.assignee_id || null,
      start_date: taskForm.start_date || null,
      due_date: taskForm.due_date || null,
      priority: taskForm.priority,
      // Chuỗi rỗng phải thành NULL, không phải 0 — "chưa ước lượng" khác
      // "ước lượng 0 giờ", và cột có CHECK (estimated_hours > 0).
      estimated_hours: taskForm.estimated_hours ? Number(taskForm.estimated_hours) : null,
    };

    if (editingTask) {
      const { error } = await supabase.from('tasks').update(payload).eq('id', editingTask.id);
      if (error) {
        toast('Cập nhật tác vụ thất bại', 'error');
      } else {
        if (taskForm.assignee_id && taskForm.assignee_id !== editingTask.assignee_id && taskForm.assignee_id !== profile?.id) {
          await notifyUser(
            taskForm.assignee_id,
            'Bạn được giao một tác vụ dự án',
            `${taskForm.title}${project?.name ? ` · ${project.name}` : ''}`,
            'project_task_assigned',
          );
        }
        toast('Cập nhật tác vụ thành công!', 'success');
        setTaskModalOpen(false);
        loadData(id!);
      }
    } else {
      const { error } = await supabase.from('tasks').insert({
        project_id: id,
        ...payload,
        status: 'todo',
        order_index: tasks.length,
      });
      if (error) {
        toast('Tạo tác vụ thất bại', 'error');
      } else {
        if (taskForm.assignee_id && taskForm.assignee_id !== profile?.id) {
          await notifyUser(
            taskForm.assignee_id,
            'Bạn có tác vụ dự án mới',
            `${taskForm.title}${project?.name ? ` · ${project.name}` : ''}`,
            'project_task_assigned',
          );
        }
        toast('Tạo tác vụ thành công!', 'success');
        setTaskModalOpen(false);
        loadData(id!);
      }
    }
    setSubmitting(false);
  };

  const handleDeleteTask = async (task: Task) => {
    const ok = await confirm({
      title: `Xóa tác vụ "${task.title}"?`,
      message: 'Tác vụ và toàn bộ bình luận của nó sẽ bị xóa vĩnh viễn.',
      confirmLabel: 'Xóa tác vụ',
      danger: true,
    });
    if (!ok) return;
    const { error } = await supabase.from('tasks').delete().eq('id', task.id);
    if (error) {
      toast('Xóa tác vụ thất bại', 'error');
    } else {
      toast('Đã xóa tác vụ', 'success');
      loadData(id!);
    }
  };

  const handleUpdateTaskStatus = async (taskId: string, status: TaskStatus) => {
    const { error } = await supabase.from('tasks').update({ status }).eq('id', taskId);
    if (error) {
      toast('Cập nhật thất bại', 'error');
    } else {
      setTasks((prev) => prev.map((t) => t.id === taskId ? { ...t, status } : t));
    }
  };

  const handleDragStart = (e: DragStartEvent) => {
    setActiveTaskId(e.active.id as string);
  };

  const handleDragEnd = async (e: DragEndEvent) => {
    setActiveTaskId(null);
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

    // Cập nhật UI ngay lập tức (Optimistic Update)
    setTasks((prev) => prev.map((t) => t.id === taskId ? { ...t, status: newStatus! } : t));
    
    const { error } = await supabase.from('tasks').update({ status: newStatus }).eq('id', taskId);
    if (error) {
      toast('Cập nhật thất bại: ' + error.message, 'error');
      if (id) loadData(id, true);
    } else {
      toast('Đã cập nhật trạng thái', 'success');
    }
  };

  const openAddMember = () => {
    setEditingMember(null);
    setMemberForm({ user_id: '', role: 'member' });
    setMemberModalOpen(true);
  };

  const openEditMember = (m: ProjectMember) => {
    setEditingMember(m);
    setMemberForm({ user_id: m.user_id, role: m.role_code || m.role });
    setMemberModalOpen(true);
  };

  const handleSaveMember = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    const rolePayload = projectRoles.length > 0
      ? {
          role_code: memberForm.role,
          role: (['lead', 'member', 'viewer'].includes(memberForm.role) ? memberForm.role : 'member'),
        }
      : { role: memberForm.role };
    if (editingMember) {
      const { error } = await supabase.from('project_members').update(rolePayload).eq('id', editingMember.id);
      if (error) {
        toast('Cập nhật vai trò thất bại: ' + describeDbError(error), 'error');
      } else {
        toast('Cập nhật vai trò thành công!', 'success');
        setMemberModalOpen(false);
        loadData(id!);
      }
    } else {
      const { error } = await supabase.from('project_members').insert({
        project_id: id,
        user_id: memberForm.user_id,
        ...rolePayload,
      });
      if (error) {
        toast('Thêm thành viên thất bại: ' + describeDbError(error), 'error');
      } else {
        toast('Thêm thành viên thành công!', 'success');
        setMemberModalOpen(false);
        loadData(id!);
      }
    }
    setSubmitting(false);
  };

  const handleRemoveMember = async (memberId: string) => {
    const ok = await confirm({
      title: 'Gỡ thành viên khỏi dự án?',
      message: 'Người này sẽ không còn thấy dự án và các tác vụ trong đó. Tác vụ đã giao vẫn giữ nguyên.',
      confirmLabel: 'Gỡ thành viên',
      danger: true,
    });
    if (!ok) return;
    const { error } = await supabase.from('project_members').delete().eq('id', memberId);
    if (error) {
      toast('Xóa thất bại', 'error');
    } else {
      toast('Đã xóa thành viên', 'success');
      loadData(id!);
    }
  };

  if (loading) {
    return <div className="space-y-4"><Skeleton className="h-20" /><Skeleton className="h-64" /></div>;
  }

  // Lỗi tải phải phân biệt với "dự án không tồn tại" — hai nguyên nhân khác nhau.
  if (loadError) {
    return (
      <div className="bg-white border border-slate-200 rounded-2xl">
        <ErrorState message={loadError} onRetry={() => id && loadData(id)} />
      </div>
    );
  }

  if (!project) {
    return <EmptyState title="Không tìm thấy dự án" description="Dự án có thể đã bị xóa." />;
  }

  const availableProfiles = allProfiles.filter((p) => !members.some((m) => m.user_id === p.id));

  // --- Ai được quản lý thành viên dự án này ---
  // Admin/CEO và người có quyền lẻ 'projects' quản lý MỌI dự án. Trưởng nhóm
  // chỉ quản lý dự án mình làm lead — và không đụng tới dòng 'lead' (RLS chặn
  // cứng, đây chỉ là ẩn nút cho khớp). Xem migration 20260811230000.
  const iAmProjectLead = !!profile && members.some((m) => m.user_id === profile.id && (m.role_code || m.role) === 'lead');
  const canManageMembers =
    isFullAdmin(profile) ||
    (hasPermission(profile, 'projects') && (!isTeamlead(profile) || iAmProjectLead));
  /** Teamlead không thao tác được dòng trưởng nhóm (phong/hạ/xoá lead là của admin). */
  const canEditMember = (m: ProjectMember) => canManageMembers && !(isTeamlead(profile) && (m.role_code || m.role) === 'lead');
  /** Teamlead không được đặt vai trò 'lead' khi thêm/sửa thành viên. */
  const canAssignLeadRole = !isTeamlead(profile);
  const availableProjectRoles = projectRoles.length > 0
    ? projectRoles.filter((role) => canAssignLeadRole || !role.permissions.includes('member.manage'))
    : [
        { code: 'lead', name: 'Trưởng dự án', permissions: ['member.manage'] },
        { code: 'member', name: 'Thành viên', permissions: ['task.move_own'] },
        { code: 'viewer', name: 'Người xem', permissions: ['project.view'] },
      ].filter((role) => canAssignLeadRole || role.code !== 'lead');

  const getMemberRoleView = (member: ProjectMember) => {
    const code = member.role_code || member.role;
    const definition = projectRoles.find((role) => role.code === code);
    return {
      label: definition?.name || MEMBER_ROLE_CONFIG[code]?.label || code,
      color: MEMBER_ROLE_CONFIG[code]?.color || 'bg-emerald-100 text-emerald-700',
    };
  };

  // Milestone simulation: Tasks with high priority and specific naming or just a list for now
  const milestones = tasks.filter(t => t.priority === 'critical' || t.priority === 'high').slice(0, 5);

  return (
    <div className="space-y-5">
      <button onClick={() => navigate('/admin/projects')} className="flex items-center gap-2 text-sm text-slate-500 hover:text-slate-700 transition-colors">
        <ArrowLeft className="w-4 h-4" />
        Quay lại danh sách dự án
      </button>

      {/* Project header */}
<Card className="p-6 relative overflow-hidden">
        <div className="absolute -top-16 -right-16 w-48 h-48 rounded-full bg-gradient-to-br from-blue-500/10 to-violet-500/10 blur-3xl" />
        <div className="flex items-start justify-between relative">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <h2 className="font-display text-2xl font-extrabold text-slate-800">{project.name}</h2>
              <Badge className={PROJECT_STATUS_CONFIG[project.status].color}>
                {PROJECT_STATUS_CONFIG[project.status].label}
              </Badge>
            </div>
            <p className="text-sm text-slate-500 max-w-2xl">{project.description || 'Không có mô tả'}</p>
            <div className="flex items-center gap-4 mt-3 text-xs text-slate-500">
              <span className="flex items-center gap-1.5"><Clock className="w-3.5 h-3.5" />{formatDate(project.start_date)} → {formatDate(project.end_date)}</span>
              <span>Khách hàng: {project.client || '—'}</span>
            </div>
          </div>
        </div>
      </Card>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-slate-200">
        {([
          { key: 'overview', label: 'Tổng quan', icon: null },
	          { key: 'tasks', label: 'Danh sách', icon: ClipboardList },
	          { key: 'kanban', label: 'Kanban', icon: KanbanSquare },
	          { key: 'gantt', label: 'Tiến độ', icon: CalendarRange },
          { key: 'members', label: 'Thành viên', icon: UsersIcon },
          { key: 'events', label: 'Lịch họp', icon: CalendarClock },
          { key: 'documents', label: 'Tài liệu', icon: FileText },
] as { key: Tab; label: string; icon: typeof KanbanSquare | null }[]).map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-semibold border-b-2 transition-all duration-200 ${
              tab === t.key
                ? 'border-blue-500 text-blue-600 font-semibold'
                : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-200'
            }`}
          >
            {t.icon && <t.icon className="w-4 h-4" />}
            {t.label}
          </button>
        ))}
      </div>

{/* Overview tab */}
      {tab === 'overview' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card hover className="p-5">
            <p className="text-sm text-slate-500 mb-1">Tổng tác vụ</p>
            <p className="font-display text-3xl font-extrabold text-slate-800">{tasks.length}</p>
          </Card>
          <Card hover className="p-5">
            <p className="text-sm text-slate-500 mb-1">Đã hoàn thành</p>
            <p className="font-display text-3xl font-extrabold text-emerald-600">{tasks.filter((t) => t.status === 'done').length}</p>
          </Card>
	          <Card hover className="p-5">
	            <p className="text-sm text-slate-500 mb-1">Thành viên</p>
	            <p className="font-display text-3xl font-extrabold text-slate-800">{members.length}</p>
	          </Card>

            {/* Milestones section */}
            <div className="md:col-span-3 mt-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-slate-800">Mốc quan trọng (Milestones)</h3>
                <Badge className="bg-orange-50 text-orange-700 border border-orange-200">
                  {milestones.length} mốc
                </Badge>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {milestones.length === 0 ? (
                  <div className="md:col-span-2 text-sm text-slate-400 italic py-8 border border-dashed border-slate-200 rounded-2xl text-center bg-slate-50/50">
                    Chưa thiết lập mốc quan trọng (Tác vụ mức Cao/Khẩn cấp)
                  </div>
                ) : (
                  milestones.map(m => (
                    <div key={m.id} className="flex items-center gap-4 p-4 bg-white border border-slate-100 rounded-2xl shadow-sm hover:shadow-md transition-all group">
                      <div className={`w-1.5 h-12 rounded-full ${m.status === 'done' ? 'bg-emerald-500' : 'bg-orange-500'} group-hover:scale-y-110 transition-transform`} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-slate-800 truncate">{m.title}</p>
                        <p className="text-xs text-slate-500 mt-1">Hạn chót: {formatDate(m.due_date)}</p>
                      </div>
                      <Badge className={TASK_STATUSES.find(s => s.value === m.status)?.color}>
                        {TASK_STATUSES.find(s => s.value === m.status)?.label}
                      </Badge>
                    </div>
                  ))
                )}
              </div>
            </div>
	        </div>
	      )}

      {/* Tasks tab */}
	      {tab === 'tasks' && (
	        <div className="space-y-4">
	          <div className="flex justify-end">
	            <Button onClick={openCreateTask} theme="admin" size="sm">
	              <Plus className="w-4 h-4" />
	              Tạo tác vụ
	            </Button>
	          </div>
	          {tasks.length === 0 ? (
	            <Card><EmptyState title="Chưa có tác vụ" description="Tạo tác vụ đầu tiên cho dự án này." /></Card>
	          ) : (
	            <div className="space-y-2">
	              {tasks.map((task) => {
	                const priority = PRIORITY_CONFIG[task.priority];
	                const overdue = isOverdue(task.due_date, task.status);
	                const assignee = allProfiles.find((p) => p.id === task.assignee_id);
	                return (
	                  <Card key={task.id} className={`p-4 border-l-4 ${priority.border}`}>
	                    <div className="flex items-center justify-between gap-4">
	                      <div className="flex-1 min-w-0">
	                        <p className="text-sm font-medium text-slate-800">{task.title}</p>
	                        <div className="flex items-center gap-3 mt-1.5">
	                          <Badge className={TASK_STATUSES.find((s) => s.value === task.status)?.color || ''}>
	                            {TASK_STATUSES.find((s) => s.value === task.status)?.label}
	                          </Badge>
	                          <Badge className={priority.color}>{priority.label}</Badge>
	                          {task.due_date && (
	                            <span className={`text-xs ${overdue ? 'text-red-500 font-medium' : 'text-slate-400'}`}>
	                              Hạn: {formatDate(task.due_date)}
	                            </span>
	                          )}
	                          {/* Giờ thực tế so với ước lượng — chỉ số cốt lõi của
	                              quản lý dự án. Không có ước lượng thì chỉ hiện giờ đã tốn. */}
	                          {(() => {
	                            const actual = taskHours.get(task.id) ?? 0;
	                            if (actual === 0 && !task.estimated_hours) return null;
	                            const ratio = estimateRatio(actual, task.estimated_hours);
	                            const over = ratio !== null && ratio > 100;
	                            return (
	                              <span
	                                className={`text-xs font-medium ${over ? 'text-red-600' : 'text-slate-500'}`}
	                                title={task.estimated_hours ? `Ước lượng ${formatWorkHours(Number(task.estimated_hours))}` : 'Chưa có ước lượng'}
	                              >
	                                {formatWorkHours(actual)}
	                                {task.estimated_hours && ` / ${formatWorkHours(Number(task.estimated_hours))}`}
	                                {ratio !== null && ` · ${ratio}%`}
	                              </span>
	                            );
	                          })()}
	                          {assignee && (
	                            <div className="flex items-center gap-1.5">
	                              <Avatar name={assignee.name} url={assignee.avatar_url} size="sm" />
	                              <span className="text-xs text-slate-500">{assignee.name}</span>
	                            </div>
	                          )}
	                        </div>
	                      </div>
	                      <div className="flex items-center gap-2">
	                        <Select
	                          value={task.status}
	                          onChange={(e) => handleUpdateTaskStatus(task.id, e.target.value as TaskStatus)}
	                          className="w-36 h-9 text-xs"
	                        >
	                          {TASK_STATUSES.map((s) => (
	                            <option key={s.value} value={s.value}>{s.label}</option>
	                          ))}
	                        </Select>
	                        <button
	                          onClick={() => openEditTask(task)}
	                          title="Sửa tác vụ"
	                          className="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
	                        >
	                          <Edit3 className="w-4 h-4" />
	                        </button>
	                        <button
	                          onClick={() => handleDeleteTask(task)}
	                          title="Xóa tác vụ"
	                          className="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors"
	                        >
	                          <Trash2 className="w-4 h-4" />
	                        </button>
	                      </div>
	                    </div>
	                  </Card>
	                );
	              })}
	            </div>
	          )}
	        </div>
	      )}

        {/* Kanban tab */}
        {tab === 'kanban' && (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCorners}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          >
            <div className="flex gap-4 overflow-x-auto pb-4 -mx-4 px-4 md:mx-0 md:px-0 md:grid md:grid-cols-2 lg:grid-cols-4 md:overflow-visible">
              {KANBAN_COLUMNS.map((column) => {
                const columnTasks = tasks.filter((t) => t.status === column.value);
                return (
                  <div
                    key={column.value}
                    id={column.value}
                    className="bg-slate-50 rounded-2xl p-3 min-h-[500px] flex flex-col border border-slate-200/50 w-[85vw] flex-shrink-0 md:w-auto md:flex-shrink"
                  >
                    <div className={`flex items-center justify-between mb-3 px-1 border-t-4 ${column.accent} rounded-t-lg pt-2`}>
                      <h3 className="text-sm font-bold text-slate-700">{column.label}</h3>
                      <span className="text-xs font-bold text-slate-500 bg-white px-2.5 py-0.5 rounded-full shadow-sm">
                        {columnTasks.length}
                      </span>
                    </div>
                    <SortableContext
                      items={columnTasks.map((t) => t.id)}
                      strategy={verticalListSortingStrategy}
                    >
                      <div className="flex-1 space-y-2 min-h-[100px]">
                        {columnTasks.map((task) => (
                          <SortableTaskItem
                            key={task.id}
                            task={task}
                            assignee={allProfiles.find((p) => p.id === task.assignee_id)}
                            onEdit={() => openEditTask(task)}
                            onDelete={() => handleDeleteTask(task)}
                          />
                        ))}
                      </div>
                    </SortableContext>
                  </div>
                );
              })}
            </div>

            <DragOverlay>
              {activeTaskId ? (
                <div className="bg-white p-4 rounded-xl shadow-2xl border-2 border-blue-500 opacity-90 w-72 rotate-3">
                  <p className="text-sm font-bold text-slate-800">{tasks.find(t => t.id === activeTaskId)?.title}</p>
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        )}

      {/* Documents tab */}
      {tab === 'gantt' && (
        <GanttChart tasks={tasks} profiles={allProfiles} onSelectTask={openEditTask} />
      )}

      {tab === 'events' && id && <ProjectEventsPanel projectId={id} canManage={canManageMembers} />}
      {tab === 'documents' && id && <ProjectDocuments projectId={id} />}

      {/* Members tab */}
      {tab === 'members' && (
        <div className="space-y-4">
          {canManageMembers && (
            <div className="flex justify-end">
              <Button onClick={openAddMember} theme="admin" size="sm" disabled={availableProfiles.length === 0}>
                <UserPlus className="w-4 h-4" />
                Thêm thành viên
              </Button>
            </div>
          )}
          {members.length === 0 ? (
            <Card><EmptyState title="Chưa có thành viên" description="Thêm thành viên để phân công công việc." /></Card>
          ) : (
            <Card>
              <CardContent className="p-0">
                <div className="divide-y divide-slate-50">
                  {members.map((m) => (
                    <div key={m.id} className="flex items-center gap-3 px-5 py-4 hover:bg-slate-50/50 transition-colors">
                      <Avatar name={m.profile?.name || ''} url={m.profile?.avatar_url} size="md" />
                      <div className="flex-1">
                        <p className="text-sm font-medium text-slate-800">{m.profile?.name}</p>
                        <p className="text-xs text-slate-500">{m.profile?.employee_code || m.profile?.department || 'Thành viên dự án'}</p>
                      </div>
                      <Badge className={getMemberRoleView(m).color}>
                        {getMemberRoleView(m).label}
                      </Badge>
                      {canEditMember(m) && (
                        <>
                          <button
                            onClick={() => openEditMember(m)}
                            title="Sửa vai trò"
                            className="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                          >
                            <Edit3 className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleRemoveMember(m.id)}
                            title="Xóa thành viên"
                            className="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Task Modal */}
      <Modal open={taskModalOpen} onClose={() => setTaskModalOpen(false)} title={editingTask ? 'Chỉnh sửa tác vụ' : 'Tạo tác vụ mới'}>
        <form onSubmit={handleSaveTask} className="space-y-4">
          <Input
            label="Tiêu đề"
            value={taskForm.title}
            onChange={(e) => setTaskForm({ ...taskForm, title: e.target.value })}
            required
            placeholder="VD: Thiết kế trang chủ"
          />
          <Textarea
            label="Mô tả"
            value={taskForm.description}
            onChange={(e) => setTaskForm({ ...taskForm, description: e.target.value })}
            rows={3}
          />
          <Select
            label="Người thực hiện"
            value={taskForm.assignee_id}
            onChange={(e) => setTaskForm({ ...taskForm, assignee_id: e.target.value })}
          >
            <option value="">— Chọn —</option>
            {members.map((m) => (
              <option key={m.user_id} value={m.user_id}>{m.profile?.name}</option>
            ))}
          </Select>
          <Input
            label="Ước lượng (giờ)"
            type="text"
            inputMode="decimal"
            value={taskForm.estimated_hours}
            onChange={(e) => setTaskForm({ ...taskForm, estimated_hours: e.target.value.replace(',', '.') })}
            placeholder="VD: 8 — bỏ trống nếu chưa ước lượng"
          />
          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Ngày bắt đầu"
              type="date"
              value={taskForm.start_date}
              max={taskForm.due_date || undefined}
              onChange={(e) => setTaskForm({ ...taskForm, start_date: e.target.value })}
            />
            <Input
              label="Hạn chót"
              type="date"
              value={taskForm.due_date}
              min={taskForm.start_date || undefined}
              onChange={(e) => setTaskForm({ ...taskForm, due_date: e.target.value })}
            />
          </div>
          <Select
            label="Mức ưu tiên"
            value={taskForm.priority}
            onChange={(e) => setTaskForm({ ...taskForm, priority: e.target.value as TaskPriority })}
          >
            <option value="low">Thấp</option>
            <option value="medium">Trung bình</option>
            <option value="high">Cao</option>
            <option value="critical">Khẩn cấp</option>
          </Select>
          <div className="flex gap-3 pt-2">
            <Button type="button" variant="outline" onClick={() => setTaskModalOpen(false)} className="flex-1">Hủy</Button>
            <Button type="submit" disabled={submitting} theme="admin" className="flex-1">
              {submitting ? 'Đang lưu...' : editingTask ? 'Lưu thay đổi' : 'Tạo tác vụ'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Member Modal */}
      <Modal open={memberModalOpen} onClose={() => setMemberModalOpen(false)} title={editingMember ? 'Chỉnh sửa vai trò thành viên' : 'Thêm thành viên'}>
        <form onSubmit={handleSaveMember} className="space-y-4">
          {!editingMember && (
            <Select
              label="Người dùng"
              value={memberForm.user_id}
              onChange={(e) => setMemberForm({ ...memberForm, user_id: e.target.value })}
              required
            >
              <option value="">— Chọn —</option>
              {availableProfiles.map((p) => (
                <option key={p.id} value={p.id}>{p.name}{p.employee_code ? ` (${p.employee_code})` : ''}</option>
              ))}
            </Select>
          )}
          {editingMember && (
            <div className="p-3 rounded-lg bg-slate-50">
              <p className="text-sm font-medium text-slate-800">{editingMember.profile?.name}</p>
              <p className="text-xs text-slate-500">{editingMember.profile?.employee_code || editingMember.profile?.department || 'Thành viên dự án'}</p>
            </div>
          )}
          <Select
            label="Vai trò"
            value={memberForm.role}
            onChange={(e) => setMemberForm({ ...memberForm, role: e.target.value as MemberRole })}
          >
            {availableProjectRoles.map((role) => (
              <option key={role.code} value={role.code}>{role.name}</option>
            ))}
          </Select>
          <div className="flex gap-3 pt-2">
            <Button type="button" variant="outline" onClick={() => setMemberModalOpen(false)} className="flex-1">Hủy</Button>
            <Button type="submit" disabled={submitting} theme="admin" className="flex-1">
              {submitting ? 'Đang lưu...' : editingMember ? 'Lưu thay đổi' : 'Thêm'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

function SortableTaskItem({ task, assignee, onEdit, onDelete }: { task: Task; assignee?: Profile; onEdit: () => void; onDelete: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id });
  const style = { transform: CSS.Transform.toString(transform), transition };
  const priority = PRIORITY_CONFIG[task.priority];

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`bg-white p-3 rounded-xl border border-slate-200 shadow-sm group ${isDragging ? 'z-50 opacity-50 shadow-2xl' : 'hover:shadow-md'}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div {...attributes} {...listeners} className="mt-1 cursor-grab active:cursor-grabbing text-slate-300 hover:text-slate-500">
          <GripVertical className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-slate-800 leading-tight mb-2">{task.title}</p>
          <div className="flex flex-wrap items-center gap-2">
            <Badge className={`text-[10px] px-1.5 py-0 ${priority.color}`}>{priority.label}</Badge>
            {task.due_date && (
              <span className={`text-[10px] flex items-center gap-1 ${isOverdue(task.due_date, task.status) ? 'text-red-500 font-bold' : 'text-slate-400'}`}>
                <Clock className="w-3 h-3" /> {formatDate(task.due_date)}
              </span>
            )}
          </div>
          {assignee && (
            <div className="flex items-center gap-1.5 mt-2 pt-2 border-t border-slate-50">
              <Avatar name={assignee.name} url={assignee.avatar_url} size="xs" />
              <span className="text-[10px] text-slate-500 truncate">{assignee.name}</span>
            </div>
          )}
        </div>
      </div>
      <div className="flex justify-end gap-1 mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <button onClick={onEdit} className="p-1 text-slate-400 hover:text-blue-600"><Edit3 className="w-3.5 h-3.5" /></button>
        <button onClick={onDelete} className="p-1 text-slate-400 hover:text-red-600"><Trash2 className="w-3.5 h-3.5" /></button>
      </div>
    </div>
  );
}
