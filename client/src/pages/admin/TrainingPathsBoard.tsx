import { useEffect, useState } from 'react';
import { BookOpenCheck, Check, Plus, Send, Users } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';
import { Input, Select, Textarea } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { supabase } from '@/lib/supabase';
import { describeDbError } from '@/lib/dbError';
import { notifyUser } from '@/lib/assignments';
import type { Profile } from '@/types';

type PathRow = { id: string; title: string; description: string | null; status: string; manager_id: string | null; version: number; target_groups: string[] };
type MilestoneRow = { id: string; path_id: string; title: string; sort_order: number; due_days: number | null };
type StepRow = { id: string; milestone_id: string; title: string; instructions: string | null; approver_id: string; course_id: string | null; sort_order: number };
type AssignmentRow = { id: string; path_id: string; user_id: string; status: string };
type SubmissionRow = { assignment_id: string; step_id: string; status: string };

export function TrainingPathsBoard({ managerView = false }: { managerView?: boolean }) {
  const { profile } = useAuth();
  const { toast } = useToast();
  const [paths, setPaths] = useState<PathRow[]>([]);
  const [milestones, setMilestones] = useState<MilestoneRow[]>([]);
  const [steps, setSteps] = useState<StepRow[]>([]);
  const [people, setPeople] = useState<Profile[]>([]);
  const [courses, setCourses] = useState<{ id: string; title: string }[]>([]);
  const [assignmentCounts, setAssignmentCounts] = useState<Record<string, number>>({});
  const [assignments, setAssignments] = useState<AssignmentRow[]>([]);
  const [submissions, setSubmissions] = useState<SubmissionRow[]>([]);
  const [modal, setModal] = useState<'path' | 'milestone' | 'step' | 'assign' | null>(null);
  const [pathId, setPathId] = useState('');
  const [milestoneId, setMilestoneId] = useState('');
  const [personId, setPersonId] = useState('');
  const [form, setForm] = useState({ title: '', description: '', manager_id: '', target_groups: [] as string[], due_days: '', approver_id: '', alternate_approver_id: '', course_id: '', instructions: '' });
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const [p, m, s, users, c, a, submissionRows] = await Promise.all([
      supabase.from('training_paths').select('*').order('created_at', { ascending: false }),
      supabase.from('training_milestones').select('*').order('sort_order'),
      supabase.from('training_path_steps').select('*').order('sort_order'),
      supabase.from('profiles_directory').select('*').eq('is_active', true).order('name'),
      supabase.from('training_courses').select('id,title').eq('status', 'published').order('title'),
      supabase.from('training_path_assignments').select('id,path_id,user_id,status'),
      supabase.from('training_step_submissions').select('assignment_id,step_id,status'),
    ]);
    const err = p.error || m.error || s.error || a.error || submissionRows.error;
    if (err) toast('Không tải được lộ trình: ' + describeDbError(err), 'error');
    setPaths((p.data || []) as PathRow[]); setMilestones((m.data || []) as MilestoneRow[]); setSteps((s.data || []) as StepRow[]);
    setPeople((users.data || []) as Profile[]); setCourses(c.data || []);
    const counts: Record<string, number> = {};
    const assignmentRows = (a.data || []) as AssignmentRow[];
    assignmentRows.forEach((row) => { counts[row.path_id] = (counts[row.path_id] || 0) + (row.status === 'cancelled' ? 0 : 1); });
    setAssignmentCounts(counts); setAssignments(assignmentRows); setSubmissions((submissionRows.data || []) as SubmissionRow[]);
  };
  useEffect(() => { void load(); }, []);

  const savePath = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true);
    const { error } = await supabase.from('training_paths').insert({ title: form.title.trim(), description: form.description.trim() || null, target_groups: form.target_groups, manager_id: form.manager_id || null, created_by: profile?.id });
    setBusy(false);
    if (error) return toast('Không tạo được lộ trình: ' + describeDbError(error), 'error');
    if (form.manager_id) await notifyUser(form.manager_id, 'Bạn được giao thiết lập lộ trình đào tạo', form.title.trim(), 'training_path_setup');
    toast('Đã tạo bản nháp.', 'success'); setModal(null); setForm({ ...form, title: '', description: '' }); await load();
  };
  const saveMilestone = async (event: React.FormEvent) => {
    event.preventDefault(); const count = milestones.filter((m) => m.path_id === pathId).length;
    const { error } = await supabase.from('training_milestones').insert({ path_id: pathId, title: form.title.trim(), due_days: form.due_days ? Number(form.due_days) : null, sort_order: count });
    if (error) return toast('Không thêm được mốc: ' + describeDbError(error), 'error');
    setModal(null); setForm({ ...form, title: '', due_days: '' }); await load();
  };
  const saveStep = async (event: React.FormEvent) => {
    event.preventDefault(); const count = steps.filter((s) => s.milestone_id === milestoneId).length;
    const { error } = await supabase.from('training_path_steps').insert({ milestone_id: milestoneId, title: form.title.trim(), instructions: form.instructions.trim() || null, approver_id: form.approver_id, alternate_approver_id: form.alternate_approver_id || null, course_id: form.course_id || null, sort_order: count });
    if (error) return toast('Không thêm được bước: ' + describeDbError(error), 'error');
    setModal(null); setForm({ ...form, title: '', instructions: '', approver_id: '', alternate_approver_id: '', course_id: '' }); await load();
  };
  const publish = async (id: string) => {
    const { error } = await supabase.rpc('publish_training_path', { p_path: id });
    if (error) toast('Chưa thể xuất bản: ' + describeDbError(error), 'error'); else { toast('Đã xuất bản lộ trình.', 'success'); await load(); }
  };
  const cloneVersion = async (id: string) => {
    const { error } = await supabase.rpc('clone_training_path_version', { p_path: id });
    if (error) toast('Không tạo được phiên bản mới: ' + describeDbError(error), 'error'); else { toast('Đã tạo bản nháp phiên bản mới; phân công hiện tại vẫn giữ bản cũ.', 'success'); await load(); }
  };
  const assign = async () => {
    if (!pathId || !personId) return;
    const { error } = await supabase.rpc('assign_training_path', { p_path: pathId, p_user: personId });
    if (error) toast('Không phân công được: ' + describeDbError(error), 'error'); else { await notifyUser(personId, 'Bạn được phân công lộ trình đào tạo', paths.find((p) => p.id === pathId)?.title || 'Mở lộ trình đào tạo của bạn', 'training_assigned'); toast('Đã phân công lộ trình.', 'success'); setModal(null); await load(); }
  };
  const open = (kind: typeof modal, id = '') => { setPathId(id); setModal(kind); };
  const currentAssignPath = paths.find((path) => path.id === pathId);
  const eligibleStaff = people.filter((person) => !currentAssignPath?.target_groups?.length || currentAssignPath.target_groups.includes(person.training_audience || ''));

  return <div className="space-y-4">
    <div className="flex items-center justify-between gap-3"><div><h3 className="font-display text-lg font-bold text-slate-800">{managerView ? 'Thiết lập lộ trình được giao' : 'Lộ trình học tập'}</h3><p className="text-sm text-slate-500">Mốc và bước được duyệt tuần tự; mỗi bước có người kiểm duyệt.</p></div>{!managerView && <Button theme="admin" onClick={() => open('path')}><Plus className="h-4 w-4" />Tạo lộ trình</Button>}</div>
    {(managerView ? paths.filter((x) => x.manager_id === profile?.id && x.status === 'draft') : paths).length === 0 ? <Card><CardContent className="py-10 text-center text-sm text-slate-500">{managerView ? 'Bạn chưa được giao lộ trình nháp nào.' : 'Chưa có lộ trình đào tạo.'}</CardContent></Card> : (managerView ? paths.filter((x) => x.manager_id === profile?.id && x.status === 'draft') : paths).map((path) => {
      const pathMilestones = milestones.filter((m) => m.path_id === path.id);
      const pathSteps = pathMilestones.flatMap((m) => steps.filter((s) => s.milestone_id === m.id));
      const pathAssignments = assignments.filter((assignment) => assignment.path_id === path.id);
      return <Card key={path.id}><CardContent className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2"><BookOpenCheck className="h-5 w-5 text-indigo-600"/><h4 className="font-semibold text-slate-800">{path.title}</h4><Badge className={path.status === 'published' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}>{path.status === 'published' ? 'Đã xuất bản' : 'Bản nháp'} · v{path.version}</Badge></div>{path.description && <p className="mt-1 text-sm text-slate-500">{path.description}</p>}<p className="mt-1 text-xs text-slate-400">Quản lý: {people.find((x) => x.id === path.manager_id)?.name || 'Chưa gán'} · {assignmentCounts[path.id] || 0} học viên · {path.target_groups?.join(', ') || 'Mọi đối tượng'}</p></div><div className="flex flex-wrap gap-2">{managerView && path.status === 'draft' && path.manager_id === profile?.id && <Button size="sm" variant="secondary" onClick={() => void publish(path.id)}><Check className="h-4 w-4"/>Xuất bản</Button>}{!managerView && path.status === 'published' && <><Button size="sm" variant="outline" onClick={() => void cloneVersion(path.id)}><Plus className="h-4 w-4"/>Tạo phiên bản mới</Button><Button size="sm" theme="admin" onClick={() => { setPathId(path.id); setPersonId(''); setModal('assign'); }}><Users className="h-4 w-4"/>Phân công</Button></>}</div></div>
        {pathMilestones.map((milestone) => { const canConfigure = managerView && path.status === 'draft' && path.manager_id === profile?.id; return <div key={milestone.id} className="rounded-xl border border-slate-100 p-3"><div className="flex items-center justify-between"><div><p className="text-sm font-semibold text-slate-700">{milestone.title}</p><p className="text-xs text-slate-400">{milestone.due_days == null ? 'Không đặt hạn' : `Mục tiêu ${milestone.due_days} ngày`}</p></div>{canConfigure && <Button size="sm" variant="outline" onClick={() => { setMilestoneId(milestone.id); setForm({ ...form, title: '', instructions: '', approver_id: '', alternate_approver_id: '', course_id: '' }); setModal('step'); }}><Plus className="h-3 w-3"/>Thêm bước</Button>}</div><ol className="mt-2 space-y-1">{steps.filter((s) => s.milestone_id === milestone.id).map((step, index) => <li key={step.id} className="flex items-center gap-2 text-sm text-slate-600"><span className="w-5 text-xs text-slate-400">{index + 1}.</span>{step.title}{step.course_id && <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-xs text-indigo-700">{courses.find((course) => course.id === step.course_id)?.title || 'Có khóa học'}</span>}<span className="ml-auto text-xs text-slate-400">Duyệt: {people.find((p) => p.id === step.approver_id)?.name || '—'}</span></li>)}</ol></div>; })}
        {!managerView && pathAssignments.length > 0 && <div className="rounded-xl bg-slate-50 p-3"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Tiến độ học viên</p><div className="mt-2 space-y-2">{pathAssignments.map((assignment) => { const approved = new Set(submissions.filter((s) => s.assignment_id === assignment.id && s.status === 'approved').map((s) => s.step_id)); const pct = pathSteps.length ? Math.round(approved.size / pathSteps.length * 100) : 0; return <div key={assignment.id} className="flex items-center gap-3 text-sm"><span className="min-w-0 flex-1 truncate text-slate-700">{people.find((person) => person.id === assignment.user_id)?.name || 'Nhân viên'}</span><span className="text-xs text-slate-500">{assignment.status === 'completed' ? 'Hoàn tất' : `${pct}%`}</span><div className="h-1.5 w-24 overflow-hidden rounded bg-slate-200"><div className="h-full bg-indigo-600" style={{ width: `${pct}%` }}/></div></div>; })}</div></div>}
        {managerView && path.status === 'draft' && path.manager_id === profile?.id && <Button size="sm" variant="outline" onClick={() => { setForm({ ...form, title: '', due_days: '' }); open('milestone', path.id); }}><Plus className="h-4 w-4"/>Thêm mốc</Button>}
        {path.status === 'draft' && pathSteps.length === 0 && <p className="text-xs text-amber-700">Cần thêm ít nhất một bước, mỗi bước có approver, trước khi xuất bản.</p>}
      </CardContent></Card>;
    })}
    {!managerView && <Modal open={modal === 'path'} onClose={() => setModal(null)} title="Tạo lộ trình"><form onSubmit={savePath} className="space-y-4"><Input label="Tên lộ trình" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required/><Select label="Quản lý phụ trách" value={form.manager_id} onChange={(e) => setForm({ ...form, manager_id: e.target.value })}><option value="">Chưa gán</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select><fieldset className="rounded-xl border border-slate-200 p-3"><legend className="px-1 text-sm font-medium text-slate-700">Đối tượng áp dụng</legend><div className="grid grid-cols-2 gap-2">{[['INTERN','Thực tập sinh'],['PROBATION','Thử việc'],['PART_TIME','Part-time'],['FULL_TIME','Full-time'],['OFFICIAL','Chính thức']].map(([value,label]) => <label key={value} className="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={form.target_groups.includes(value)} onChange={(e) => setForm({ ...form, target_groups: e.target.checked ? [...form.target_groups,value] : form.target_groups.filter((x) => x !== value) })}/>{label}</label>)}</div><p className="mt-2 text-xs text-slate-500">Để trống nếu áp dụng cho mọi đối tượng.</p></fieldset><Textarea label="Mô tả" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}/><div className="flex justify-end"><Button type="submit" theme="admin" disabled={busy}>Tạo bản nháp</Button></div></form></Modal>}
    <Modal open={modal === 'milestone'} onClose={() => setModal(null)} title="Thêm mốc mục tiêu"><form onSubmit={saveMilestone} className="space-y-4"><Input label="Tên mốc" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required/><Input label="Số ngày mục tiêu (tùy chọn)" type="number" min="0" value={form.due_days} onChange={(e) => setForm({ ...form, due_days: e.target.value })}/><div className="flex justify-end"><Button type="submit" theme="admin">Thêm mốc</Button></div></form></Modal>
    <Modal open={modal === 'step'} onClose={() => setModal(null)} title="Thêm bước checklist"><form onSubmit={saveStep} className="space-y-4"><Input label="Nội dung bước" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required/><Textarea label="Hướng dẫn / yêu cầu nộp" value={form.instructions} onChange={(e) => setForm({ ...form, instructions: e.target.value })}/><Select label="Người kiểm duyệt" value={form.approver_id} onChange={(e) => setForm({ ...form, approver_id: e.target.value })} required><option value="">Chọn người kiểm duyệt</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select><Select label="Người kiểm duyệt thay thế (tùy chọn)" value={form.alternate_approver_id} onChange={(e) => setForm({ ...form, alternate_approver_id: e.target.value })}><option value="">Không có</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select><Select label="Khóa học liên kết (tùy chọn)" value={form.course_id} onChange={(e) => setForm({ ...form, course_id: e.target.value })}><option value="">Không liên kết</option>{courses.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}</Select><div className="flex justify-end"><Button type="submit" theme="admin">Thêm bước</Button></div></form></Modal>
    <Modal open={modal === 'assign'} onClose={() => setModal(null)} title="Phân công lộ trình"><div className="space-y-4"><Select label="Nhân viên" value={personId} onChange={(e) => setPersonId(e.target.value)}><option value="">Chọn nhân viên phù hợp</option>{eligibleStaff.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.training_audience || 'Chưa phân loại'}</option>)}</Select>{Boolean(currentAssignPath?.target_groups?.length && eligibleStaff.length === 0) && <p className="text-xs text-amber-700">Chưa có hồ sơ được phân loại đúng đối tượng. Cập nhật hồ sơ nhân sự trước khi phân công.</p>}<div className="flex justify-end"><Button theme="admin" disabled={!personId} onClick={() => void assign()}><Send className="h-4 w-4"/>Phân công</Button></div></div></Modal>
  </div>;
}
