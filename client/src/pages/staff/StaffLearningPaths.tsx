import { useEffect, useState } from 'react';
import { CheckCircle2, Clock3, Send } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';
import { Textarea } from '@/components/ui/Input';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { supabase } from '@/lib/supabase';
import { describeDbError } from '@/lib/dbError';
import { notifyUser, notifyUsers } from '@/lib/assignments';
import { createTrainingVideoUrl } from '@/lib/training';

type Assignment = { id: string; path_id: string; user_id: string; status: string };
type PathRow = { id: string; title: string; description: string | null };
type Milestone = { id: string; path_id: string; title: string; sort_order: number };
type Step = { id: string; milestone_id: string; title: string; instructions: string | null; approver_id: string; alternate_approver_id: string | null; course_id: string | null; sort_order: number };
type Submission = { id: string; assignment_id: string; step_id: string; attempt: number; submission_text: string | null; file_path: string | null; file_name: string | null; status: string; review_note: string | null };
type Course = { id: string; title: string; resource_url: string | null; video_path: string | null };

export function StaffLearningPaths() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [paths, setPaths] = useState<PathRow[]>([]);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [steps, setSteps] = useState<Step[]>([]);
  const [courses, setCourses] = useState<Record<string, Course>>({});
  const [courseVideos, setCourseVideos] = useState<Record<string, string>>({});
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [reviewQueue, setReviewQueue] = useState<Submission[]>([]);
  const [assignmentUsers, setAssignmentUsers] = useState<Record<string, string>>({});
  const [assignmentOwners, setAssignmentOwners] = useState<Record<string, string>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [files, setFiles] = useState<Record<string, File | null>>({});
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const load = async () => {
    if (!profile) return;
    setError('');
    const [a, queue] = await Promise.all([
      supabase.from('training_path_assignments').select('*').eq('user_id', profile.id).order('assigned_at', { ascending: false }),
      supabase.from('training_step_submissions').select('*').eq('status', 'pending').order('submitted_at'),
    ]);
    if (a.error || queue.error) { setError(describeDbError(a.error || queue.error)); return; }
    const ownAssignments = (a.data || []) as Assignment[];
    setAssignments(ownAssignments);
    const allSubs: Submission[] = [];
    const allSteps: Step[] = [];
    const allMilestones: Milestone[] = [];
    const allPaths: PathRow[] = [];
    const userNames: Record<string, string> = {};
    if (ownAssignments.length) {
      const pathIds = [...new Set(ownAssignments.map((x) => x.path_id))];
      const [p, m] = await Promise.all([
        supabase.from('training_paths').select('id,title,description').in('id', pathIds),
        supabase.from('training_milestones').select('*').in('path_id', pathIds).order('sort_order'),
      ]);
      allPaths.push(...((p.data || []) as PathRow[])); allMilestones.push(...((m.data || []) as Milestone[]));
      if (allMilestones.length) {
        const s = await supabase.from('training_path_steps').select('*').in('milestone_id', allMilestones.map((x) => x.id)).order('sort_order');
        allSteps.push(...((s.data || []) as Step[]));
      }
      const mine = await supabase.from('training_step_submissions').select('*').in('assignment_id', ownAssignments.map((x) => x.id)).order('attempt');
      allSubs.push(...((mine.data || []) as Submission[]));
    }
    const pending = (queue.data || []) as Submission[];
    const reviewStepIds = [...new Set(pending.map((x) => x.step_id))];
    let reviewSteps: Step[] = [];
    if (reviewStepIds.length) {
      const sr = await supabase.from('training_path_steps').select('*').in('id', reviewStepIds);
      reviewSteps = (sr.data || []) as Step[];
    }
    const eligible = new Set(reviewSteps.filter((s) => s.approver_id === profile.id || s.alternate_approver_id === profile.id).map((s) => s.id));
    const queueRows = pending.filter((x) => eligible.has(x.step_id));
    setReviewQueue(queueRows);
    const courseIds = [...new Set([...allSteps, ...reviewSteps].map((step) => step.course_id).filter((id): id is string => Boolean(id)))];
    if (courseIds.length) {
      const coursesResult = await supabase.from('training_courses').select('id,title,resource_url,video_path').in('id', courseIds);
      const nextCourses: Record<string, Course> = {};
      const nextVideos: Record<string, string> = {};
      for (const course of (coursesResult.data || []) as Course[]) {
        nextCourses[course.id] = course;
        if (course.video_path) { const signed = await createTrainingVideoUrl(course.video_path); if (signed.url) nextVideos[course.id] = signed.url; }
      }
      setCourses(nextCourses); setCourseVideos(nextVideos);
    } else { setCourses({}); setCourseVideos({}); }
    const queueAssignments = queueRows.length ? await supabase.from('training_path_assignments').select('id,user_id').in('id', [...new Set(queueRows.map((x) => x.assignment_id))]) : { data: [], error: null };
    const userIds = [...new Set((queueAssignments.data || []).map((row) => row.user_id))];
    const userProfiles = userIds.length ? await supabase.from('profiles_directory').select('id,name').in('id', userIds) : { data: [], error: null };
    const names = Object.fromEntries((userProfiles.data || []).map((row) => [row.id, row.name]));
    const owners: Record<string, string> = {};
    (queueAssignments.data || []).forEach((row) => { userNames[row.id] = names[row.user_id] || row.user_id; owners[row.id] = row.user_id; });
    setAssignmentUsers(userNames); setAssignmentOwners(owners); setPaths(allPaths); setMilestones(allMilestones); setSteps([...allSteps, ...reviewSteps]); setSubmissions(allSubs);
  };
  useEffect(() => { void load(); }, [profile?.id]);

  const submit = async (assignment: Assignment, step: Step) => {
    const key = `${assignment.id}:${step.id}`; setBusy(key);
    let filePath: string | null = null;
    const selectedFile = files[key];
    if (selectedFile) {
      const safeName = selectedFile.name.replace(/[^\p{L}\p{N}._-]+/gu, '_');
      filePath = `${assignment.id}/${step.id}/${Date.now()}-${safeName}`;
      const { error: uploadError } = await supabase.storage.from('training-step-submissions').upload(filePath, selectedFile, { upsert: false });
      if (uploadError) { setBusy(''); toast('Không tải được tệp: ' + uploadError.message, 'error'); return; }
    }
    const { error: submitError } = await supabase.rpc('submit_training_step', { p_assignment: assignment.id, p_step: step.id, p_text: drafts[key] || null, p_file_path: filePath, p_file_name: selectedFile?.name || null });
    setBusy('');
    if (submitError) {
      if (filePath) await supabase.storage.from('training-step-submissions').remove([filePath]);
      toast('Không gửi được bước: ' + describeDbError(submitError), 'error');
    } else { await notifyUsers([step.approver_id, step.alternate_approver_id].filter((id): id is string => !!id && id !== profile?.id), 'Có bước đào tạo cần kiểm duyệt', step.title, 'training_review'); toast('Đã gửi người kiểm duyệt.', 'success'); setDrafts((d) => ({ ...d, [key]: '' })); setFiles((f) => ({ ...f, [key]: null })); await load(); }
  };
  const openFile = async (path: string) => {
    const { data, error: fileError } = await supabase.storage.from('training-step-submissions').createSignedUrl(path, 300);
    if (fileError || !data) toast('Không mở được tệp: ' + (fileError?.message || ''), 'error'); else window.open(data.signedUrl, '_blank', 'noopener');
  };
  const review = async (submission: Submission, approve: boolean) => {
    const note = approve ? '' : window.prompt('Nhập lý do yêu cầu làm lại (bắt buộc):') || '';
    if (!approve && !note.trim()) return;
    setBusy(submission.id);
    const { error: reviewError } = await supabase.rpc('review_training_step', { p_submission: submission.id, p_approve: approve, p_note: note });
    setBusy('');
    if (reviewError) toast('Không lưu được kết quả duyệt: ' + describeDbError(reviewError), 'error');
    else { const ownerId = assignmentOwners[submission.assignment_id]; if (ownerId) await notifyUser(ownerId, approve ? 'Bước đào tạo đã được duyệt' : 'Bước đào tạo cần làm lại', stepName(submission.step_id), 'training_review_result'); toast(approve ? 'Đã duyệt bước.' : 'Đã trả bước để làm lại.', 'success'); await load(); }
  };

  const latest = (assignmentId: string, stepId: string) => submissions.filter((x) => x.assignment_id === assignmentId && x.step_id === stepId).sort((x, y) => y.attempt - x.attempt)[0];
  const stepName = (id: string) => steps.find((x) => x.id === id)?.title || 'Bước đào tạo';
  return <section className="space-y-4">
    <div><h3 className="font-display text-lg font-bold text-slate-800">Lộ trình được phân công</h3><p className="text-sm text-slate-500">Chỉ bước kế tiếp được mở sau khi bước trước được duyệt.</p></div>
    {error && <Card><CardContent className="py-4 text-sm text-rose-700">Không tải được lộ trình: {error}</CardContent></Card>}
    {assignments.length === 0 && !error && <Card><CardContent className="py-6 text-sm text-slate-500">Bạn chưa được phân công lộ trình.</CardContent></Card>}
    {assignments.map((assignment) => {
      const path = paths.find((x) => x.id === assignment.path_id);
      const ordered = milestones.filter((m) => m.path_id === assignment.path_id).flatMap((m) => steps.filter((s) => s.milestone_id === m.id).map((s) => ({ step: s, milestone: m })));
      let unlocked = true;
      const doneCount = ordered.filter(({ step }) => latest(assignment.id, step.id)?.status === 'approved').length;
      const percent = ordered.length ? Math.round(doneCount / ordered.length * 100) : 0;
      return <Card key={assignment.id}><CardContent><div className="flex items-center justify-between gap-2"><div><h4 className="font-semibold text-slate-800">{path?.title || 'Lộ trình'}</h4><p className="text-xs text-slate-500">{path?.description}</p></div><Badge className={assignment.status === 'completed' ? 'bg-emerald-50 text-emerald-700' : 'bg-indigo-50 text-indigo-700'}>{assignment.status === 'completed' ? 'Hoàn tất' : `${percent}% hoàn thành`}</Badge></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-indigo-600" style={{ width: `${percent}%` }} /></div><div className="mt-4 space-y-3">{ordered.map(({ step, milestone }, index) => {
        const last = latest(assignment.id, step.id);
        const isUnlocked = unlocked;
        if (last?.status !== 'approved') unlocked = false;
        const key = `${assignment.id}:${step.id}`;
        const canSend = isUnlocked && last?.status !== 'pending' && assignment.status !== 'completed';
        const course = step.course_id ? courses[step.course_id] : null;
        return <div key={step.id} className={`rounded-xl border p-3 ${isUnlocked ? 'border-indigo-100 bg-indigo-50/30' : 'border-slate-100 opacity-70'}`}><div className="flex items-center gap-2 text-xs text-slate-500"><span>{milestone.title} · Bước {index + 1}</span>{last?.status === 'approved' ? <Badge className="bg-emerald-50 text-emerald-700">Đã duyệt</Badge> : last?.status === 'pending' ? <Badge className="bg-amber-50 text-amber-700">Chờ duyệt</Badge> : last?.status === 'revision' ? <Badge className="bg-rose-50 text-rose-700">Cần làm lại</Badge> : !isUnlocked ? <span className="inline-flex items-center gap-1"><Clock3 className="h-3 w-3"/>Đang khóa</span> : null}</div><p className="mt-1 font-medium text-slate-800">{step.title}</p>{step.instructions && <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600">{step.instructions}</p>}{course && <div className="mt-3 rounded-lg border border-indigo-100 bg-white p-3"><p className="text-sm font-semibold text-indigo-900">Nội dung học: {course.title}</p>{courseVideos[course.id] && <video controls preload="metadata" className="mt-2 aspect-video w-full rounded-lg bg-slate-900" src={courseVideos[course.id]} />}{course.resource_url && <a className="mt-2 inline-block text-sm font-medium text-indigo-700 underline" href={course.resource_url} target="_blank" rel="noreferrer">Mở tài liệu khóa học</a>}</div>}{last?.file_path && <button type="button" className="mt-2 text-sm font-medium text-indigo-700 underline" onClick={() => void openFile(last.file_path!)}>Tệp đã nộp: {last.file_name || 'Mở tệp'}</button>}{last?.review_note && <p className="mt-2 rounded-lg bg-rose-50 p-2 text-sm text-rose-700">Phản hồi: {last.review_note}</p>}{canSend && <div className="mt-3 space-y-2"><Textarea label="Kết quả / nội dung nộp" value={drafts[key] ?? (last?.submission_text || '')} onChange={(e) => setDrafts((d) => ({ ...d, [key]: e.target.value }))}/><label className="block text-sm text-slate-600">Tệp đính kèm (PDF, ảnh hoặc Word; tối đa 20 MB)<input className="mt-1 block w-full text-sm" type="file" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,application/pdf,image/jpeg,image/png,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={(e) => setFiles((f) => ({ ...f, [key]: e.target.files?.[0] || null }))}/></label>{files[key] && <p className="text-xs text-slate-500">{files[key]?.name}</p>}<Button size="sm" theme="staff" disabled={busy === key} onClick={() => void submit(assignment, step)}><Send className="h-4 w-4"/>{busy === key ? 'Đang gửi…' : 'Gửi kiểm duyệt'}</Button></div>}</div>;
      })}</div></CardContent></Card>;
    })}
    {reviewQueue.length > 0 && <div className="space-y-3"><div><h3 className="font-display text-lg font-bold text-slate-800">Chờ bạn kiểm duyệt</h3><p className="text-sm text-slate-500">Từ chối sẽ trả bước cho nhân viên làm lại, kèm lý do bắt buộc.</p></div>{reviewQueue.map((submission) => <Card key={submission.id}><CardContent className="flex flex-wrap items-center justify-between gap-3"><div><p className="font-semibold text-slate-800">{stepName(submission.step_id)}</p><p className="text-xs text-slate-500">Nhân viên: {assignmentUsers[submission.assignment_id] || '—'} · Lần nộp {submission.attempt}</p>{submission.submission_text && <p className="mt-2 whitespace-pre-wrap text-sm text-slate-600">{submission.submission_text}</p>}{submission.file_path && <button type="button" className="mt-2 text-sm font-medium text-indigo-700 underline" onClick={() => void openFile(submission.file_path!)}>{submission.file_name || 'Mở tệp đính kèm'}</button>}</div><div className="flex gap-2"><Button size="sm" variant="secondary" disabled={busy === submission.id} onClick={() => void review(submission, false)}>Yêu cầu làm lại</Button><Button size="sm" theme="staff" disabled={busy === submission.id} onClick={() => void review(submission, true)}><CheckCircle2 className="h-4 w-4"/>Duyệt</Button></div></CardContent></Card>)}</div>}
  </section>;
}
