import { useEffect, useState } from 'react';
import { BookOpen, Edit3, Plus, Search, Trash2, Users, Video } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Select, Textarea } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { EmptyState } from '@/components/ui/EmptyState';
import { useToast } from '@/contexts/ToastContext';
import { useConfirm } from '@/contexts/ConfirmContext';
import { useAuth } from '@/contexts/AuthContext';
import { useRealtimeSync } from '@/hooks/useRealtimeSync';
import { supabase } from '@/lib/supabase';
import { describeDbError } from '@/lib/dbError';
import { removeTrainingDocument, removeTrainingVideo, uploadTrainingDocument, uploadTrainingVideo } from '@/lib/training';
import { notifyUser } from '@/lib/assignments';
import type { Profile, TrainingCourse, TrainingCourseStatus } from '@/types';
import { TrainingPathsBoard } from '@/pages/admin/TrainingPathsBoard';

const statusConfig: Record<TrainingCourseStatus, { label: string; color: string }> = {
  draft: { label: 'Bản nháp', color: 'bg-slate-100 text-slate-600' },
  published: { label: 'Đang mở', color: 'bg-emerald-100 text-emerald-700' },
  archived: { label: 'Đã lưu trữ', color: 'bg-amber-100 text-amber-700' },
};

const blankForm = { title: '', description: '', category: 'Chung', instructor: '', duration_hours: '1', deadline: '', resource_url: '', status: 'draft' as TrainingCourseStatus, videoFile: null as File | null, documentFile: null as File | null };

export function AdminTraining() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const confirm = useConfirm();
  const [courses, setCourses] = useState<TrainingCourse[]>([]);
  const [staff, setStaff] = useState<Profile[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState<TrainingCourse | null>(null);
  const [editing, setEditing] = useState<TrainingCourse | null>(null);
  const [selectedStaff, setSelectedStaff] = useState('');
  const [selectedStaffIds, setSelectedStaffIds] = useState<string[]>([]);
  const [form, setForm] = useState(blankForm);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState('');
  /** F02.02: Admin tạo/xuất bản/phân công lộ trình ở tab riêng. */
  const [tab, setTab] = useState<'courses' | 'paths'>('courses');
  const filteredCourses = courses.filter((course) => `${course.title} ${course.category} ${course.instructor || ''}`.toLowerCase().includes(query.trim().toLowerCase()));

  const load = async () => {
    setLoading(true);
    const [{ data: courseData, error }, { data: staffData }, { data: enrollmentData }] = await Promise.all([
      supabase.from('training_courses').select('*').order('created_at', { ascending: false }),
      supabase.from('profiles_directory').select('*').eq('is_active', true).order('name'),
      supabase.from('training_enrollments').select('course_id'),
    ]);
    if (error) toast('Không tải được khóa học: ' + describeDbError(error), 'error');
    setCourses((courseData || []) as TrainingCourse[]);
    setStaff((staffData || []) as Profile[]);
    const nextCounts: Record<string, number> = {};
    (enrollmentData || []).forEach((item) => { nextCounts[item.course_id] = (nextCounts[item.course_id] || 0) + 1; });
    setCounts(nextCounts);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);
  useRealtimeSync([{ table: 'training_courses' }, { table: 'training_enrollments' }], load);

  const openCreate = () => { setEditing(null); setForm(blankForm); setSelectedStaffIds([]); setModalOpen(true); };
  const openEdit = (course: TrainingCourse) => {
    setEditing(course);
    setForm({ title: course.title, description: course.description || '', category: course.category, instructor: course.instructor || '', duration_hours: String(course.duration_hours), deadline: course.deadline || '', resource_url: course.resource_url || '', status: course.status, videoFile: null, documentFile: null });
    setModalOpen(true);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    const { videoFile, documentFile, ...courseForm } = form;
    const payload = { ...courseForm, duration_hours: Number(form.duration_hours), description: form.description || null, instructor: form.instructor || null, deadline: form.deadline || null, resource_url: form.resource_url || null };
    const result = editing
      ? await supabase.from('training_courses').update(payload).eq('id', editing.id).select('id').single()
      : await supabase.from('training_courses').insert({ ...payload, created_by: profile?.id }).select('id').single();
    if (result.error) { setSaving(false); toast('Lưu khóa học thất bại: ' + describeDbError(result.error), 'error'); return; }
    const courseId = editing?.id || result.data?.id;
    if (videoFile && courseId) {
      const uploaded = await uploadTrainingVideo(videoFile, courseId);
      if (uploaded.error || !uploaded.path) { setSaving(false); toast('Video chưa được tải lên: ' + uploaded.error, 'warning'); setModalOpen(false); load(); return; }
      const { error: videoError } = await supabase.from('training_courses').update({ video_path: uploaded.path, video_file_name: videoFile.name }).eq('id', courseId);
      if (videoError) { await removeTrainingVideo(uploaded.path); setSaving(false); toast('Lưu video thất bại: ' + describeDbError(videoError), 'error'); return; }
    }
    if (documentFile && courseId) {
      const uploaded = await uploadTrainingDocument(documentFile, courseId);
      if (uploaded.error || !uploaded.path) { setSaving(false); toast('Tài liệu chưa được tải lên: ' + uploaded.error, 'error'); return; }
      const { error: documentError } = await supabase.from('training_courses').update({ document_path: uploaded.path, document_file_name: documentFile.name }).eq('id', courseId);
      if (documentError) { await removeTrainingDocument(uploaded.path); setSaving(false); toast('Lưu tài liệu thất bại: ' + describeDbError(documentError), 'error'); return; }
      if (editing?.document_path && editing.document_path !== uploaded.path) await removeTrainingDocument(editing.document_path);
    }
    if (!editing && selectedStaffIds.length && courseId) {
      const enrollmentRows = selectedStaffIds.map((user_id) => ({ course_id: courseId, user_id, status: 'enrolled', progress: 0 }));
      const { error: enrollmentError } = await supabase.from('training_enrollments').upsert(enrollmentRows, { onConflict: 'course_id,user_id' });
      if (enrollmentError) {
        setSaving(false);
        toast(`Đã lưu khóa học nhưng chưa giao được: ${describeDbError(enrollmentError)}`, 'warning');
        setModalOpen(false);
        void load();
        return;
      }
      await Promise.all(selectedStaffIds.map((userId) => notifyUser(userId, 'Bạn có khóa học mới', `${form.title}${form.deadline ? ` · hạn hoàn thành ${form.deadline}` : ''}`, 'training_assigned')));
    }
    toast(editing ? 'Đã cập nhật khóa học.' : selectedStaffIds.length ? `Đã tạo khóa học và giao cho ${selectedStaffIds.length} nhân viên.` : 'Đã tạo khóa học.', 'success');
    setSaving(false); setModalOpen(false); load();
  };

  const remove = async (course: TrainingCourse) => {
    if (!await confirm({ title: `Xóa khóa học "${course.title}"?`, message: 'Toàn bộ đăng ký và tiến độ của khóa học cũng sẽ bị xóa.', confirmLabel: 'Xóa khóa học', danger: true })) return;
    const { error } = await supabase.from('training_courses').delete().eq('id', course.id);
    if (error) toast('Xóa thất bại: ' + describeDbError(error), 'error'); else { toast('Đã xóa khóa học.', 'success'); load(); }
  };

  const assign = async () => {
    if (!assignOpen || !selectedStaff) return;
    const { error } = await supabase.from('training_enrollments').upsert({ course_id: assignOpen.id, user_id: selectedStaff, status: 'enrolled', progress: 0 }, { onConflict: 'course_id,user_id' });
    if (error) toast('Giao khóa học thất bại: ' + describeDbError(error), 'error'); else {
      await notifyUser(selectedStaff, 'Bạn có khóa học mới', `${assignOpen.title}${assignOpen.deadline ? ` · hạn hoàn thành ${assignOpen.deadline}` : ''}`, 'training_assigned');
      toast('Đã giao khóa học cho nhân viên.', 'success'); setAssignOpen(null); load();
    }
  };

  return <div className="space-y-5">
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
      <div><h2 className="font-display text-xl font-bold text-slate-800">Đào tạo</h2><p className="text-sm text-slate-500 mt-1">{tab === 'courses' ? 'Tạo khóa học, giao cho nhân viên và theo dõi tiến độ hoàn thành.' : 'Tạo lộ trình, giao quản lý thiết lập mốc/checklist, phân công nhân viên và theo dõi tiến độ.'}</p></div>
      {tab === 'courses' && <Button onClick={openCreate} theme="admin"><Plus className="w-4 h-4" />Tạo khóa học</Button>}
    </div>
    <div role="tablist" className="inline-flex rounded-xl bg-slate-100 p-1">
      {([['courses', 'Khóa học'], ['paths', 'Lộ trình đào tạo']] as const).map(([key, label]) => (
        <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)}
          className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${tab === key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>
          {label}
        </button>
      ))}
    </div>
    {tab === 'paths' ? <TrainingPathsBoard /> : <>
    <Card><CardContent className="flex items-center gap-3 py-3"><Search className="h-4 w-4 text-slate-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm theo khóa học, danh mục hoặc giảng viên..." className="w-full bg-transparent text-sm outline-none" /></CardContent></Card>
    {loading ? <Card><CardContent><p className="text-sm text-slate-400 py-10 text-center">Đang tải khóa học...</p></CardContent></Card> : courses.length === 0 ? <Card><EmptyState icon={<BookOpen className="w-8 h-8" />} title="Chưa có khóa học" description="Tạo khóa học đầu tiên cho đội ngũ của bạn." action={<Button onClick={openCreate} theme="admin"><Plus className="w-4 h-4" />Tạo khóa học</Button>} /></Card> : filteredCourses.length === 0 ? <Card><EmptyState icon={<Search className="w-8 h-8" />} title="Không tìm thấy khóa học" description="Thử từ khóa khác hoặc xóa bộ lọc tìm kiếm." /></Card> : <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">{filteredCourses.map((course) => <Card key={course.id}><CardContent><div className="flex items-start justify-between gap-3"><div className="w-11 h-11 rounded-xl bg-amber-50 text-amber-700 flex items-center justify-center"><BookOpen className="w-5 h-5" /></div><Badge className={statusConfig[course.status].color}>{statusConfig[course.status].label}</Badge></div><h3 className="font-display text-base font-bold text-slate-800 mt-4">{course.title}</h3><p className="text-sm text-slate-500 mt-1 line-clamp-2">{course.description || 'Chưa có mô tả.'}</p><div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-slate-500 mt-4"><span>{course.category}</span><span>{course.duration_hours} giờ</span><span className="flex items-center gap-1"><Users className="w-3.5 h-3.5" />{counts[course.id] || 0} học viên</span>{course.deadline && <span>Hạn {course.deadline}</span>}</div><div className="flex gap-2 mt-4 pt-4 border-t border-slate-100"><Button onClick={() => { setAssignOpen(course); setSelectedStaff(''); }} theme="admin" className="flex-1"><Users className="w-4 h-4" />Giao khóa học</Button><Button onClick={() => openEdit(course)} variant="secondary" aria-label="Sửa khóa học"><Edit3 className="w-4 h-4" /></Button><Button onClick={() => remove(course)} variant="danger" aria-label="Xóa khóa học"><Trash2 className="w-4 h-4" /></Button></div></CardContent></Card>)}</div>}
    </>}

    <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Sửa khóa học' : 'Tạo khóa học'}><form onSubmit={submit} className="space-y-4"><Input label="Tên khóa học" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required /><div className="grid grid-cols-2 gap-3"><Input label="Danh mục" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} required /><Input label="Thời lượng (giờ)" type="number" min="0.5" step="0.5" value={form.duration_hours} onChange={(e) => setForm({ ...form, duration_hours: e.target.value })} required /></div><div className="grid grid-cols-2 gap-3"><Input label="Giảng viên" value={form.instructor} onChange={(e) => setForm({ ...form, instructor: e.target.value })} /><Input label="Hạn hoàn thành" type="date" value={form.deadline} onChange={(e) => setForm({ ...form, deadline: e.target.value })} /></div><Select label="Trạng thái" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as TrainingCourseStatus })}><option value="draft">Bản nháp</option><option value="published">Đang mở</option><option value="archived">Đã lưu trữ</option></Select>
      {!editing && <fieldset className="rounded-xl border border-slate-200 p-3"><legend className="px-1 text-sm font-semibold text-slate-700">Giao khóa học cho nhân viên</legend><p className="mb-2 text-xs text-slate-500">Có thể chọn nhiều nhân viên. Bỏ trống nếu muốn lưu khóa học trước.</p><div className="max-h-44 space-y-1 overflow-y-auto">{staff.map((person) => <label key={person.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-50"><input type="checkbox" checked={selectedStaffIds.includes(person.id)} onChange={(event) => setSelectedStaffIds((current) => event.target.checked ? [...current, person.id] : current.filter((id) => id !== person.id))} className="h-4 w-4 accent-indigo-600" /><span>{person.name}</span><span className="text-xs text-slate-400">{person.department || 'Chưa có phòng ban'}</span></label>)}{staff.length === 0 && <p className="py-2 text-sm text-slate-400">Chưa có nhân viên đang hoạt động.</p>}</div><p className="mt-2 text-xs font-medium text-indigo-700">Đã chọn {selectedStaffIds.length} nhân viên</p></fieldset>}
      <label className="block"><span className="mb-2 block text-sm font-semibold text-slate-700">Tệp tài liệu khóa học</span><input type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt" onChange={(e) => setForm({ ...form, documentFile: e.target.files?.[0] || null })} className="block w-full text-sm text-slate-500 file:mr-3 file:rounded-lg file:border-0 file:bg-indigo-50 file:px-3 file:py-2 file:font-semibold file:text-indigo-700" /><span className="mt-1 block text-xs text-slate-400">PDF, Word, Excel, PowerPoint hoặc TXT · tối đa 20 MB{form.documentFile ? ` · ${form.documentFile.name}` : editing?.document_file_name ? ` · Tệp hiện tại: ${editing.document_file_name}` : ''}</span></label><label className="block"><span className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-700"><Video className="w-4 h-4 text-amber-600" />Video đào tạo</span><input type="file" accept="video/mp4,video/webm,video/quicktime,video/x-m4v,.mp4,.webm,.mov,.m4v" onChange={(e) => setForm({ ...form, videoFile: e.target.files?.[0] || null })} className="block w-full text-sm text-slate-500 file:mr-3 file:rounded-lg file:border-0 file:bg-amber-50 file:px-3 file:py-2 file:font-semibold file:text-amber-700" /><span className="mt-1 block text-xs text-slate-400">MP4, WebM, MOV hoặc M4V, tối đa 500 MB{form.videoFile ? ` · ${form.videoFile.name}` : ''}</span></label><Textarea label="Mô tả" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /><div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setModalOpen(false)}>Hủy</Button><Button type="submit" theme="admin" disabled={saving}>{saving ? 'Đang lưu...' : selectedStaffIds.length && !editing ? 'Tạo khóa học & giao' : 'Lưu khóa học'}</Button></div></form></Modal>
    <Modal open={!!assignOpen} onClose={() => setAssignOpen(null)} title="Giao khóa học"><div className="space-y-4"><p className="text-sm text-slate-500">Chọn nhân viên sẽ tham gia <strong>{assignOpen?.title}</strong>.</p><Select label="Nhân viên" value={selectedStaff} onChange={(e) => setSelectedStaff(e.target.value)}><option value="">Chọn nhân viên</option>{staff.map((person) => <option key={person.id} value={person.id}>{person.name} · {person.department || 'Chưa có phòng ban'}</option>)}</Select><div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setAssignOpen(null)}>Hủy</Button><Button theme="admin" onClick={assign} disabled={!selectedStaff}>Giao khóa học</Button></div></div></Modal>
  </div>;
}
