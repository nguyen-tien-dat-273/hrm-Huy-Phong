// ============================================================================
// Lịch họp & nhắc nhở của một dự án.
// ----------------------------------------------------------------------------
// Nhúng vào tab "Lịch họp" của trang chi tiết dự án. Trưởng nhóm (và admin/quyền
// projects) tạo/sửa/xoá; mọi thành viên dự án xem. Tạo xong, database tự bắn
// thông báo cho thành viên (trigger) — component không notify tay.
// ============================================================================

import { useEffect, useState } from 'react';
import {
  CalendarClock, MapPin, Plus, Edit3, Trash2, Building2, Bell, Video,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Avatar } from '@/components/ui/Avatar';
import { Modal } from '@/components/ui/Modal';
import { Input, Select, Textarea } from '@/components/ui/Input';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/contexts/ToastContext';
import { useConfirm } from '@/contexts/ConfirmContext';
import { useAuth } from '@/contexts/AuthContext';
import { useRealtimeSync } from '@/hooks/useRealtimeSync';
import {
  EVENT_TYPE_CONFIG, createProjectEvent, deleteProjectEvent, fetchProjectEvents, formatEventTime,
  isEventPast, toDateTimeLocal, updateProjectEvent, type ProjectEventInput,
} from '@/lib/projectEvents';
import type { ProjectEvent, ProjectEventType } from '@/types';

const EMPTY_FORM: ProjectEventInput = {
  type: 'meeting', title: '', description: '', client_name: '', location: '', start_at_local: '',
};

export function ProjectEventsPanel({ projectId, canManage }: { projectId: string; canManage: boolean }) {
  const { profile } = useAuth();
  const { toast } = useToast();
  const confirm = useConfirm();

  const [events, setEvents] = useState<ProjectEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ProjectEvent | null>(null);
  const [form, setForm] = useState<ProjectEventInput>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const load = async (silent = false) => {
    if (!silent) setLoading(true);
    const { data, error } = await fetchProjectEvents(projectId);
    setLoadError(error);
    setEvents(data);
    setLoading(false);
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  useRealtimeSync([{ table: 'project_events', filter: `project_id=eq.${projectId}` }], () => load(true), {
    channelKey: `events:${projectId}`,
  });

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setModalOpen(true);
  };

  const openEdit = (ev: ProjectEvent) => {
    setEditing(ev);
    setForm({
      type: ev.type,
      title: ev.title,
      description: ev.description ?? '',
      client_name: ev.client_name ?? '',
      location: ev.location ?? '',
      start_at_local: toDateTimeLocal(ev.start_at),
    });
    setModalOpen(true);
  };

  const save = async () => {
    if (!profile) return;
    setSaving(true);
    const { error } = editing
      ? await updateProjectEvent(editing.id, form)
      : await createProjectEvent(projectId, profile.id, form);
    setSaving(false);

    if (error) {
      toast(error, 'error');
      return;
    }
    toast(
      editing ? 'Đã cập nhật.' : form.type === 'meeting' ? 'Đã tạo lịch họp — đã báo cho thành viên.' : 'Đã gửi nhắc nhở cho thành viên.',
      'success',
    );
    setModalOpen(false);
    void load(true);
  };

  const remove = async (ev: ProjectEvent) => {
    const ok = await confirm({
      title: 'Xóa sự kiện?',
      message: `"${ev.title}" sẽ bị xóa khỏi lịch dự án.`,
      confirmLabel: 'Xóa',
      danger: true,
    });
    if (!ok) return;
    const { error } = await deleteProjectEvent(ev.id);
    if (error) { toast(error, 'error'); return; }
    toast('Đã xóa sự kiện.', 'success');
    void load(true);
  };

  const upcoming = events.filter((e) => !isEventPast(e));
  const past = events.filter((e) => isEventPast(e));

  if (loading) return <div className="space-y-3">{Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-20" />)}</div>;
  if (loadError) return <ErrorState message={loadError} onRetry={load} />;

  const renderEvent = (ev: ProjectEvent, dim = false) => {
    const cfg = EVENT_TYPE_CONFIG[ev.type];
    return (
      <div key={ev.id} className={`flex items-start gap-3 px-5 py-4 ${dim ? 'opacity-60' : ''} hover:bg-slate-50/60 transition-colors`}>
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${cfg.color}`}>
          {ev.type === 'meeting' ? <CalendarClock className="w-5 h-5" /> : <Bell className="w-5 h-5" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-0.5">
            <span className="text-sm font-semibold text-slate-800">{ev.title}</span>
            <Badge className={cfg.color}>{cfg.label}</Badge>
          </div>
          <p className="text-xs font-medium text-slate-600 flex items-center gap-1.5">
            <CalendarClock className="w-3.5 h-3.5 text-slate-400" />
            {formatEventTime(ev.start_at)}
          </p>
          {ev.client_name && (
            <p className="text-xs text-slate-500 flex items-center gap-1.5 mt-0.5">
              <Building2 className="w-3.5 h-3.5 text-slate-400" /> {ev.client_name}
            </p>
          )}
          {ev.location && (
            <p className="text-xs text-slate-500 flex items-center gap-1.5 mt-0.5">
              {/^https?:\/\//.test(ev.location) ? <Video className="w-3.5 h-3.5 text-slate-400" /> : <MapPin className="w-3.5 h-3.5 text-slate-400" />}
              {/^https?:\/\//.test(ev.location)
                ? <a href={ev.location} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline truncate">{ev.location}</a>
                : <span className="truncate">{ev.location}</span>}
            </p>
          )}
          {ev.description && <p className="text-xs text-slate-500 mt-1 whitespace-pre-wrap">{ev.description}</p>}
          {ev.creator && <p className="text-[11px] text-slate-400 mt-1">Tạo bởi {ev.creator.name}</p>}
        </div>
        {canManage && (
          <div className="flex items-center gap-1 flex-shrink-0">
            <button onClick={() => openEdit(ev)} title="Sửa" className="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors">
              <Edit3 className="w-4 h-4" />
            </button>
            <button onClick={() => remove(ev)} title="Xóa" className="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors">
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {canManage && (
        <div className="flex justify-end">
          <Button onClick={openCreate} theme="admin" size="sm">
            <Plus className="w-4 h-4" />
            Thêm lịch họp / nhắc nhở
          </Button>
        </div>
      )}

      {events.length === 0 ? (
        <Card>
          <EmptyState
            icon={<CalendarClock className="w-8 h-8" />}
            title="Chưa có lịch họp hay nhắc nhở"
            description={canManage ? 'Tạo lịch họp với khách hàng hoặc gửi nhắc nhở chung cho cả nhóm.' : 'Trưởng nhóm chưa đặt lịch nào cho dự án này.'}
          />
        </Card>
      ) : (
        <>
          {upcoming.length > 0 && (
            <Card>
              <CardContent className="p-0">
                <p className="px-5 pt-4 pb-1 text-xs font-semibold text-slate-500 uppercase tracking-wide">Sắp tới</p>
                <div className="divide-y divide-slate-50">{upcoming.map((e) => renderEvent(e))}</div>
              </CardContent>
            </Card>
          )}
          {past.length > 0 && (
            <Card>
              <CardContent className="p-0">
                <p className="px-5 pt-4 pb-1 text-xs font-semibold text-slate-400 uppercase tracking-wide">Đã qua</p>
                <div className="divide-y divide-slate-50">{past.map((e) => renderEvent(e, true))}</div>
              </CardContent>
            </Card>
          )}
        </>
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Sửa sự kiện' : 'Thêm lịch họp / nhắc nhở'}>
        <div className="space-y-4">
          <Select
            label="Loại"
            value={form.type}
            onChange={(e) => setForm({ ...form, type: e.target.value as ProjectEventType })}
          >
            <option value="meeting">Họp khách hàng</option>
            <option value="reminder">Nhắc nhở chung</option>
          </Select>

          <Input
            label={form.type === 'meeting' ? 'Nội dung cuộc họp' : 'Nội dung nhắc nhở'}
            placeholder={form.type === 'meeting' ? 'VD: Chốt yêu cầu giai đoạn 2' : 'VD: Nộp báo cáo tuần trước 17h thứ Sáu'}
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
          />

          <Input
            label="Thời điểm"
            type="datetime-local"
            value={form.start_at_local}
            onChange={(e) => setForm({ ...form, start_at_local: e.target.value })}
          />

          {form.type === 'meeting' && (
            <>
              <Input
                label="Khách hàng (không bắt buộc)"
                placeholder="VD: Công ty ABC"
                value={form.client_name}
                onChange={(e) => setForm({ ...form, client_name: e.target.value })}
              />
              <Input
                label="Địa điểm / link online (không bắt buộc)"
                placeholder="VD: Văn phòng tầng 5, hoặc https://meet.google.com/..."
                value={form.location}
                onChange={(e) => setForm({ ...form, location: e.target.value })}
              />
            </>
          )}

          <Textarea
            label="Ghi chú (không bắt buộc)"
            rows={3}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />

          <p className="text-xs text-slate-500">
            Khi lưu, mọi thành viên dự án sẽ nhận được thông báo về sự kiện này.
          </p>

          <div className="flex gap-3 pt-1">
            <Button variant="outline" onClick={() => setModalOpen(false)} className="flex-1" disabled={saving}>Hủy</Button>
            <Button theme="admin" onClick={save} className="flex-1" disabled={saving}>
              {saving ? 'Đang lưu…' : editing ? 'Lưu thay đổi' : 'Tạo & thông báo'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
