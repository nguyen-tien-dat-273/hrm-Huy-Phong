import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useRealtimeSync } from '@/hooks/useRealtimeSync';
import { Plus, Search, FolderKanban, Calendar, Users as UsersIcon, Edit3, Trash2, ExternalLink } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Select, Textarea } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/contexts/ToastContext';
import { useConfirm } from '@/contexts/ConfirmContext';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { deleteProjectDocuments } from '@/lib/documents';
import { describeDbError } from '@/lib/dbError';
import { isTeamlead } from '@/lib/permissions';
import { PROJECT_STATUS_CONFIG, formatDate, formatVND, getTodayString } from '@/lib/utils';
import type { Project, Profile, ProjectStatus } from '@/types';

export function AdminProjects() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const portfolioManager = !isTeamlead(profile);

  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [leadFilter, setLeadFilter] = useState('all');
  const [modalOpen, setModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [form, setForm] = useState({
    name: '', description: '', start_date: '', end_date: '',
    budget: '', client: '', status: 'planning' as ProjectStatus,
    lead_id: '',
  });
  const [staffList, setStaffList] = useState<Profile[]>([]);

  useEffect(() => {
    let isMounted = true;

    loadProjects();
    supabase.from('profiles_directory').select('*').in('role', ['staff', 'teamlead']).eq('is_active', true).order('name').then(({ data }) => {
      if (isMounted) setStaffList((data || []) as Profile[]);
    });

    return () => { isMounted = false; };
  }, []);

  // Nghe cả project_members: được thêm vào một dự án thì dự án đó mới hiện ra
  // với nhân viên, mà thay đổi đó nằm ở bảng liên kết chứ không phải `projects`.
  useRealtimeSync(
    [{ table: 'projects' }, { table: 'project_members' }],
    () => loadProjects(true),
  );

  const loadProjects = async (silent = false) => {
    if (!silent) setLoading(true);
    const { data, error } = await supabase.from('projects').select('*').order('created_at', { ascending: false });
    setLoadError(error ? describeDbError(error) : null);
    setProjects((data || []) as Project[]);
    setLoading(false);
  };

  const filtered = projects.filter((p) => {
    const matchSearch = p.name.toLowerCase().includes(search.toLowerCase()) ||
      (p.client || '').toLowerCase().includes(search.toLowerCase());
    const matchLead = leadFilter === 'all' || p.lead_id === leadFilter;
    return matchSearch && matchLead;
  });

  const openCreate = () => {
    setEditingProject(null);
    setForm({
      name: '', description: '', start_date: getTodayString(),
      end_date: '', budget: '', client: '', status: 'planning', lead_id: '',
    });
    setModalOpen(true);
  };

  const openEdit = (project: Project) => {
    setEditingProject(project);
    setForm({
      name: project.name,
      description: project.description || '',
      start_date: project.start_date,
      end_date: project.end_date,
      budget: project.budget != null ? String(project.budget) : '',
      client: project.client || '',
      status: project.status,
      lead_id: project.lead_id || '',
    });
    setModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Trước đây form nhận cả ngày kết thúc nằm trước ngày bắt đầu.
    if (form.end_date < form.start_date) {
      toast('Ngày kết thúc phải sau ngày bắt đầu.', 'warning');
      return;
    }
    if (form.budget && Number(form.budget) < 0) {
      toast('Ngân sách không được âm.', 'warning');
      return;
    }

    setSubmitting(true);
    const payload = {
      name: form.name,
      description: form.description || null,
      start_date: form.start_date,
      end_date: form.end_date,
      budget: form.budget ? parseFloat(form.budget) : null,
      client: form.client || null,
      status: form.status,
      lead_id: form.lead_id || null,
    };

    if (editingProject) {
      const { error } = await supabase.from('projects').update(payload).eq('id', editingProject.id);
      if (error) {
        toast('Cập nhật dự án thất bại: ' + describeDbError(error), 'error');
      } else {
        toast('Cập nhật dự án thành công!', 'success');
        setModalOpen(false);
        loadProjects();
      }
    } else {
      const { data, error } = await supabase.from('projects').insert({
        ...payload,
        created_by: profile?.id,
      }).select().single();

      if (error) {
        toast('Tạo dự án thất bại: ' + describeDbError(error), 'error');
      } else {
        // Trigger database đồng bộ lead_id với project_members trong cùng giao
        // dịch; UI không chèn lần hai để tránh thành viên trùng hoặc nửa vời.
        toast('Tạo dự án thành công!', 'success');
        setModalOpen(false);
        loadProjects();
      }
    }
    setSubmitting(false);
  };

  const handleDelete = async (project: Project) => {
    const ok = await confirm({
      title: `Xóa dự án "${project.name}"?`,
      message: 'Toàn bộ tác vụ, thành viên và bình luận thuộc dự án này sẽ bị xóa theo. Không thể hoàn tác.',
      confirmLabel: 'Xóa dự án',
      danger: true,
    });
    if (!ok) return;

    // Phải xóa file TRƯỚC khi xóa dự án. `ON DELETE CASCADE` chỉ xóa dòng trong
    // bảng `project_documents` — file trong Storage sẽ ở lại vĩnh viễn, chiếm
    // dung lượng mà không còn gì trỏ tới để mà dọn.
    const cleanup = await deleteProjectDocuments(project.id);
    if (cleanup.error) {
      toast('Không dọn được tài liệu của dự án: ' + cleanup.error, 'error');
      return;
    }

    const { error } = await supabase.from('projects').delete().eq('id', project.id);
    if (error) {
      toast('Xóa dự án thất bại: ' + describeDbError(error), 'error');
    } else {
      toast('Đã xóa dự án', 'success');
      loadProjects();
    }
  };

  return (
    <div className="space-y-5">
      {/* Trên điện thoại, ô tìm và nút đứng cùng hàng khiến nút xuống dòng rồi
          đè lên ô tìm. Xếp chồng dưới sm, cùng hàng từ sm trở lên. */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex flex-1 gap-3 w-full sm:max-w-2xl">
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Tìm dự án..."
              className="w-full h-10 pl-10 pr-3.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
            />
          </div>
          <select
            value={leadFilter}
            onChange={(e) => setLeadFilter(e.target.value)}
            className="h-10 px-3 rounded-lg border border-slate-200 text-sm text-slate-700 bg-white focus:outline-none focus:border-blue-500"
          >
            <option value="all">Tất cả trưởng nhóm</option>
            {staffList.map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
        {portfolioManager && <Button onClick={openCreate} theme="admin" className="w-full sm:w-auto whitespace-nowrap">
          <Plus className="w-4 h-4" />
          Tạo dự án mới
        </Button>}
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-48" />)}
        </div>
      ) : loadError ? (
        <Card><ErrorState message={loadError} onRetry={loadProjects} /></Card>
      ) : filtered.length === 0 ? (
        <Card>
          <EmptyState
            icon={<FolderKanban className="w-8 h-8" />}
            title="Chưa có dự án nào"
            description="Tạo dự án đầu tiên để bắt đầu quản lý tiến độ."
            action={portfolioManager ? <Button onClick={openCreate} theme="admin"><Plus className="w-4 h-4" />Tạo dự án</Button> : undefined}
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((project) => (
<div
              key={project.id}
              className="bg-white rounded-2xl border border-slate-200/80 shadow-card p-5 hover:shadow-lifted hover:-translate-y-0.5 transition-all duration-300 group"
            >
              <div>
                <div className="flex items-start justify-between mb-3">
                  <div className="w-11 h-11 rounded-xl bg-indigo-50 border border-indigo-100 text-indigo-600 flex items-center justify-center transition-colors group-hover:bg-indigo-100">
                    <FolderKanban className="w-5 h-5" />
                  </div>
                  <div className="flex items-center gap-1">
                    <Badge className={PROJECT_STATUS_CONFIG[project.status].color}>
                      {PROJECT_STATUS_CONFIG[project.status].label}
                    </Badge>
                  </div>
                </div>
                <h3 className="font-display text-base font-bold text-slate-800 mb-1 group-hover:text-blue-700 transition-colors">{project.name}</h3>
                <p className="text-sm text-slate-500 line-clamp-2 mb-4">{project.description || 'Không có mô tả'}</p>
                <div className="space-y-2 text-xs text-slate-500">
                  <div className="flex items-center gap-2">
                    <Calendar className="w-3.5 h-3.5" />
                    {formatDate(project.start_date)} — {formatDate(project.end_date)}
                  </div>
                  <div className="flex items-center gap-2">
                    <UsersIcon className="w-3.5 h-3.5" />
                    {project.client || 'Không có khách hàng'}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-slate-600">{formatVND(project.budget)}</span>
                  </div>
                </div>
                {/* Actions */}
                <div className="flex items-center gap-1.5 pt-4 mt-4 border-t border-slate-100">
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1"
                    onClick={() => navigate(`/admin/projects/${project.id}`)}
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    Chi tiết
                  </Button>
                  {portfolioManager && <button
                    onClick={() => openEdit(project)}
                    title="Sửa dự án"
                    className="p-2 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                  >
                    <Edit3 className="w-4 h-4" />
                  </button>}
                  {portfolioManager && <button
                    onClick={() => handleDelete(project)}
                    title="Xóa dự án"
                    className="p-2 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editingProject ? 'Chỉnh sửa dự án' : 'Tạo dự án mới'} size="lg">
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="Tên dự án"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
            placeholder="VD: Website Bán Hàng"
          />
          <Textarea
            label="Mô tả"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            rows={3}
            placeholder="Mô tả ngắn về dự án..."
          />
          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Ngày bắt đầu"
              type="date"
              value={form.start_date}
              onChange={(e) => setForm({ ...form, start_date: e.target.value })}
              required
            />
            <Input
              label="Ngày kết thúc"
              type="date"
              value={form.end_date}
              onChange={(e) => setForm({ ...form, end_date: e.target.value })}
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Ngân sách (VNĐ)"
              type="number"
              value={form.budget}
              onChange={(e) => setForm({ ...form, budget: e.target.value })}
              placeholder="500000000"
            />
            <Input
              label="Khách hàng"
              value={form.client}
              onChange={(e) => setForm({ ...form, client: e.target.value })}
              placeholder="Công ty ABC"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Select
              label="Trạng thái"
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value as ProjectStatus })}
            >
              <option value="planning">Lập kế hoạch</option>
              <option value="active">Đang hoạt động</option>
              <option value="on_hold">Tạm dừng</option>
              <option value="completed">Hoàn thành</option>
              <option value="archived">Lưu trữ</option>
            </Select>
            <Select
              label="Trưởng nhóm"
              value={form.lead_id}
              onChange={(e) => setForm({ ...form, lead_id: e.target.value })}
            >
              <option value="">— Chọn —</option>
              {staffList.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </Select>
          </div>
          <div className="flex gap-3 pt-2">
            <Button type="button" variant="outline" onClick={() => setModalOpen(false)} className="flex-1">Hủy</Button>
            <Button type="submit" disabled={submitting} theme="admin" className="flex-1">
              {submitting ? 'Đang lưu...' : editingProject ? 'Lưu thay đổi' : 'Tạo dự án'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
