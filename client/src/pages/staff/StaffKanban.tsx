import { useEffect, useState } from 'react';
import {
  DndContext, DragOverlay, PointerSensor, useSensor, useSensors,
  closestCorners, type DragStartEvent, type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Calendar, AlertCircle, Edit3, Trash2, Plus, ShieldCheck } from 'lucide-react';
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
import { notifyUser } from '@/lib/assignments';
import { KANBAN_COLUMNS, PRIORITY_CONFIG, formatDate, isOverdue } from '@/lib/utils';
import type { Task, TaskStatus, TaskPriority, Project, Profile, ProjectMember, MemberRole, ProjectRoleDefinition } from '@/types';

type ProjectAccess = Pick<ProjectRoleDefinition, 'code' | 'name' | 'permissions'>;

const LEGACY_ACCESS: Record<string, ProjectAccess> = {
  lead: { code: 'lead', name: 'Trưởng dự án', permissions: ['project.view', 'member.manage', 'task.create', 'task.edit', 'task.delete', 'task.assign', 'task.move_any', 'task.move_own'] },
  member: { code: 'member', name: 'Thành viên', permissions: ['project.view', 'task.move_own'] },
  viewer: { code: 'viewer', name: 'Người xem', permissions: ['project.view'] },
};

export function StaffKanban() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const confirm = useConfirm();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [projectMembers, setProjectMembers] = useState<ProjectMember[]>([]);
  const [projectAccess, setProjectAccess] = useState<Record<string, ProjectAccess>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [projectFilter, setProjectFilter] = useState<string>('all');
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [createForm, setCreateForm] = useState({ title: '', description: '', project_id: '', assignee_id: '', start_date: '', due_date: '', priority: 'medium' as TaskPriority });

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  useEffect(() => {
    if (profile) loadData();
  }, [profile]);

  useRealtimeSync(
    profile ? [{ table: 'tasks' }, { table: 'project_members' }] : [],
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
      setLoadError(membershipErr ? describeDbError(membershipErr) : null);
      setLoading(false);
      return;
    }

    const [
      { data: taskData, error: taskErr },
      { data: projectData, error: projectErr },
      { data: memberData, error: memberErr },
    ] = await Promise.all([
      supabase.from('tasks').select('*, project:projects(*), assignee:profiles_directory(*)').in('project_id', projectIds).order('order_index', { ascending: true }),
      supabase.from('projects').select('*').in('id', projectIds),
      supabase.from('project_members').select('*, profile:profiles_directory(*)').in('project_id', projectIds),
    ]);

    const firstError = membershipErr ?? taskErr ?? projectErr ?? memberErr;
    const members = (memberData || []) as ProjectMember[];
    const uniqueProfiles = Array.from(
      new Map(members.flatMap((member) => member.profile ? [[member.profile.id, member.profile] as const] : [])).values(),
    );
    setLoadError(firstError ? describeDbError(firstError) : null);
    setTasks((taskData || []) as Task[]);
    setProjects((projectData || []) as Project[]);
    setProjectMembers(members);
    setProfiles(uniqueProfiles);
    setLoading(false);
  };

  const hasProjectPermission = (projectId: string, permission: string) => projectAccess[projectId]?.permissions.includes(permission) ?? false;
  const canCreateTask = (projectId: string) => hasProjectPermission(projectId, 'task.create');
  const canEditTask = (projectId: string) => hasProjectPermission(projectId, 'task.edit');
  const canDeleteTask = (projectId: string) => hasProjectPermission(projectId, 'task.delete');
  const canAssignTask = (projectId: string) => hasProjectPermission(projectId, 'task.assign');
  const canMoveTask = (task: Task) => hasProjectPermission(task.project_id, 'task.move_any')
    || (task.assignee_id === profile?.id && hasProjectPermission(task.project_id, 'task.move_own'));
  const creatableProjects = projects.filter((project) => canCreateTask(project.id));
  const selectedAccess = projectFilter === 'all' ? null : projectAccess[projectFilter];
  const assignableProfiles = Array.from(new Map(
    projectMembers
      .filter((member) => member.project_id === createForm.project_id)
      .flatMap((member) => member.profile ? [[member.profile.id, member.profile] as const] : [])
  ).values());

  const filteredTasks = projectFilter === 'all'
    ? tasks
    : tasks.filter((t) => t.project_id === projectFilter);

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
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <select
            value={projectFilter}
            onChange={(e) => setProjectFilter(e.target.value)}
            className="h-10 px-3.5 rounded-lg border border-slate-200 text-sm text-slate-700 bg-white focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
          >
            <option value="all">Tất cả dự án</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          {selectedAccess && (
            <Badge className={selectedAccess.permissions.some((permission) => permission !== 'project.view') ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}>
              <ShieldCheck className="w-3.5 h-3.5 mr-1" />
              {selectedAccess.name}
            </Badge>
          )}
        </div>
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
            <Plus className="w-4 h-4" /> Tạo tác vụ
          </Button>
        )}
      </div>

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
              <div
                key={column.value}
                className="bg-slate-100/70 rounded-2xl p-3 min-h-[400px] flex flex-col border border-slate-200/50
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
                        onEdit={canEditTask(task.project_id) ? () => openEditTask(task) : undefined}
                        onDelete={canDeleteTask(task.project_id) ? () => handleDeleteTask(task) : undefined}
                      />
                    ))}
                  </div>
                </SortableContext>
                {columnTasks.length === 0 && (
                  <div className="flex-1 flex items-center justify-center text-xs text-slate-400 py-4">
                    Chưa có tác vụ
                  </div>
                )}
              </div>
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
              onChange={(e) => setCreateForm({ ...createForm, due_date: e.target.value })}
            />
          </div>
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
    </div>
  );
}

function SortableTaskCard({ task, assignee, canMove, onEdit, onDelete }: { task: Task; assignee?: Profile; canMove: boolean; onEdit?: () => void; onDelete?: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id, disabled: !canMove });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <TaskCard task={task} assignee={assignee} canMove={canMove} onEdit={onEdit} onDelete={onDelete} />
    </div>
  );
}

function TaskCard({ task, assignee, dragging, canMove = true, onEdit, onDelete }: { task: Task; assignee?: Profile; dragging?: boolean; canMove?: boolean; onEdit?: () => void; onDelete?: () => void }) {
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
          {canMove && <GripVertical className="w-3.5 h-3.5 text-slate-300 mt-0.5" />}
        </div>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <Badge className={priority.color}>{priority.label}</Badge>
        {task.project && (
          <span className="text-xs text-slate-400 truncate">{task.project.name}</span>
        )}
      </div>
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
    </div>
  );
}
