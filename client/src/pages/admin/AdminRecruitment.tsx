import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle, ArrowRight, CheckCircle2, Clock3, FileText, FolderKanban, Plus, Search, Trash2, UserPlus, UserRoundCheck, UsersRound, XCircle,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Select, Textarea } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { EmptyState } from '@/components/ui/EmptyState';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { useConfirm } from '@/contexts/ConfirmContext';
import { useRealtimeSync } from '@/hooks/useRealtimeSync';
import { fetchApproverIds, notifyUser, notifyUsers } from '@/lib/assignments';
import { describeDbError } from '@/lib/dbError';
import { hasPermission, isFullAdmin } from '@/lib/permissions';
import { supabase } from '@/lib/supabase';

// Tuyển dụng nhân sự ngoài công ty (quyết định nhóm 20/10/2026, lệch SRS F01.03):
// Trưởng phòng lập đề xuất -> HR kiểm tra -> BGĐ (Admin/CEO) phê duyệt ->
// Đang tuyển: Admin/CEO thêm tay nhân sự đã tuyển vào dự án (add_hire_to_project)
// -> đủ số lượng thì đề xuất tự Hoàn tất. Không còn quản lý ứng viên.

type RequestStatus = 'DRAFT' | 'SUBMITTED' | 'PENDING_BOARD' | 'RETURNED' | 'APPROVED' | 'REJECTED' | 'OPEN' | 'CLOSED' | 'CANCELLED';

interface RecruitmentRequest {
  id: string;
  code: string;
  title: string;
  unit_id: string | null;
  position_id: string | null;
  requested_by: string;
  hiring_manager_id: string;
  headcount: number;
  employment_type: string;
  reason: string;
  salary_min: number | null;
  salary_max: number | null;
  desired_start_date: string | null;
  status: RequestStatus;
  submitted_at: string | null;
  review_due_at: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  attachment_path?: string | null;
  attachment_name?: string | null;
  hr_note?: string | null;
  created_at: string;
}

/** Nhân sự đã tuyển của một đề xuất, đã được thêm vào dự án. */
interface Hire { id: string; requisition_id: string; project_id: string; user_id: string; role_code: string; added_at: string }

interface DirectoryItem { id: string; name: string; }
interface OrgItem { id: string; name: string; }

const requestStatus: Record<RequestStatus, { label: string; color: string }> = {
  DRAFT: { label: 'Bản nháp', color: 'bg-slate-100 text-slate-700' },
  SUBMITTED: { label: 'Chờ HR kiểm tra', color: 'bg-amber-100 text-amber-700' },
  PENDING_BOARD: { label: 'Chờ BGĐ phê duyệt', color: 'bg-orange-100 text-orange-700' },
  RETURNED: { label: 'Trả về điều chỉnh', color: 'bg-rose-100 text-rose-700' },
  APPROVED: { label: 'BGĐ đã phê duyệt', color: 'bg-blue-100 text-blue-700' },
  REJECTED: { label: 'Từ chối', color: 'bg-red-100 text-red-700' },
  OPEN: { label: 'Đang tuyển', color: 'bg-emerald-100 text-emerald-700' },
  CLOSED: { label: 'Đã hoàn tất', color: 'bg-indigo-100 text-indigo-700' },
  CANCELLED: { label: 'Đã hủy', color: 'bg-slate-100 text-slate-500' },
};

/** Vai trò dự án khi thêm nhân sự; trưởng dự án gán ở thông tin dự án. */
const HIRE_ROLES: Array<{ code: string; label: string }> = [
  { code: 'member', label: 'Thành viên' },
  { code: 'coordinator', label: 'Điều phối dự án' },
  { code: 'reviewer', label: 'Người kiểm duyệt' },
  { code: 'viewer', label: 'Người xem' },
];
const roleLabel = (code: string) => HIRE_ROLES.find((role) => role.code === code)?.label || code;

/** BR-007 / UC-M01-007: tệp đề xuất theo mẫu Huy Phong. */
const REQUISITION_FILE_MAX = 20 * 1024 * 1024;
const REQUISITION_FILE_EXT = ['pdf', 'doc', 'docx'];
const checkRequisitionFile = (file: File | null): string | null => {
  if (!file) return 'Cần đính kèm tệp đề xuất (.pdf, .doc, .docx).';
  if (!REQUISITION_FILE_EXT.includes(file.name.split('.').pop()?.toLowerCase() || '')) return 'Tệp đề xuất chỉ nhận .pdf, .doc, .docx.';
  if (file.size > REQUISITION_FILE_MAX) return 'Tệp đề xuất tối đa 20 MB.';
  return null;
};

/** Khớp CHECK của recruitment_requisitions để báo lỗi tiếng Việt trước khi gửi. */
const REASON_MIN = 5;
const TITLE_MIN = 3;
const checkRequestFields = (form: { title: string; headcount: string; reason: string; salary_min: string; salary_max: string }): string | null => {
  if (form.title.trim().length < TITLE_MIN) return `Vị trí cần tuyển cần ít nhất ${TITLE_MIN} ký tự.`;
  if (!Number.isInteger(Number(form.headcount)) || Number(form.headcount) < 1) return 'Số lượng cần tuyển phải từ 1 người.';
  if (form.reason.trim().length < REASON_MIN) return `Lý do và yêu cầu tuyển cần ít nhất ${REASON_MIN} ký tự (VD: "Bổ sung 1 nhân viên thiết kế cho dự án mới").`;
  if (form.salary_min && Number(form.salary_min) < 0) return 'Lương tối thiểu không được âm.';
  if (form.salary_min && form.salary_max && Number(form.salary_max) < Number(form.salary_min)) return 'Lương tối đa phải lớn hơn hoặc bằng lương tối thiểu.';
  return null;
};

const blankRequest = {
  title: '', unit_id: '', position_id: '', headcount: '1', employment_type: 'FULL_TIME',
  reason: '', salary_min: '', salary_max: '', desired_start_date: '',
  /** Người phụ trách tuyển; rỗng = chính người lập. */
  hiring_manager_id: '',
};
const blankHire = { project_id: '', user_id: '', role_code: 'member' };

function money(value: number | null) {
  return value == null ? '—' : new Intl.NumberFormat('vi-VN').format(value) + ' ₫';
}

function deadlineText(date: string | null) {
  if (!date) return null;
  const remaining = new Date(date).getTime() - Date.now();
  if (remaining < 0) return { text: `Quá hạn ${Math.max(1, Math.ceil(Math.abs(remaining) / 3_600_000))} giờ`, overdue: true };
  return { text: `Còn ${Math.max(1, Math.ceil(remaining / 3_600_000))} giờ`, overdue: false };
}

export function AdminRecruitment() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const confirm = useConfirm();
  const canReview = hasPermission(profile, 'users');
  /** BGĐ = Admin/CEO: phê duyệt và thêm nhân sự vào dự án. */
  const isBoard = isFullAdmin(profile);
  const [requests, setRequests] = useState<RecruitmentRequest[]>([]);
  const [hires, setHires] = useState<Hire[]>([]);
  const [projects, setProjects] = useState<OrgItem[]>([]);
  const [people, setPeople] = useState<DirectoryItem[]>([]);
  const [units, setUnits] = useState<OrgItem[]>([]);
  const [positions, setPositions] = useState<OrgItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [requestOpen, setRequestOpen] = useState(false);
  const [requestForm, setRequestForm] = useState(blankRequest);
  const [reviewing, setReviewing] = useState<RecruitmentRequest | null>(null);
  /** Bước duyệt đang mở: HR kiểm tra hay BGĐ phê duyệt. */
  const [reviewMode, setReviewMode] = useState<'hr' | 'board'>('hr');
  const [requestFile, setRequestFile] = useState<File | null>(null);
  const [resubmitting, setResubmitting] = useState<RecruitmentRequest | null>(null);
  const [resubmitForm, setResubmitForm] = useState({ title: '', headcount: '1', reason: '', salary_min: '', salary_max: '', desired_start_date: '' });
  const [resubmitFile, setResubmitFile] = useState<File | null>(null);
  const [reviewNote, setReviewNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState('');
  const [changingOwner, setChangingOwner] = useState<RecruitmentRequest | null>(null);
  const [ownerDraft, setOwnerDraft] = useState('');
  const [requestFilter, setRequestFilter] = useState<'ALL' | 'SUBMITTED' | 'PENDING_BOARD' | 'RETURNED' | 'APPROVED' | 'OPEN' | 'CLOSED' | 'REJECTED'>('ALL');
  const [hiring, setHiring] = useState<RecruitmentRequest | null>(null);
  const [hireForm, setHireForm] = useState(blankHire);

  const load = async () => {
    setLoading(true);
    const [requestRes, hireRes, projectRes, peopleRes, unitRes, positionRes] = await Promise.all([
      supabase.from('recruitment_requisitions').select('*').order('created_at', { ascending: false }),
      supabase.from('recruitment_requisition_hires').select('id,requisition_id,project_id,user_id,role_code,added_at').order('added_at'),
      supabase.from('projects').select('id,name').order('name'),
      supabase.from('profiles_directory').select('id,name').eq('is_active', true).order('name'),
      supabase.from('organization_units').select('id,name').eq('is_active', true).order('name'),
      supabase.from('job_positions').select('id,title').eq('is_active', true).order('title'),
    ]);
    const firstError = requestRes.error || hireRes.error || unitRes.error || positionRes.error;
    if (firstError) {
      setLoadError(describeDbError(firstError));
    } else {
      setLoadError('');
      setRequests((requestRes.data || []) as RecruitmentRequest[]);
      setHires((hireRes.data || []) as Hire[]);
      setProjects((projectRes.data || []) as OrgItem[]);
      setPeople((peopleRes.data || []) as DirectoryItem[]);
      setUnits((unitRes.data || []) as OrgItem[]);
      setPositions((positionRes.data || []).map((item) => ({ id: item.id, name: item.title })) as OrgItem[]);
    }
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);
  useRealtimeSync(
    [{ table: 'recruitment_requisitions' }, { table: 'recruitment_requisition_hires' }],
    load,
    { channelKey: 'internal-recruitment' },
  );

  const names = useMemo(() => new Map(people.map((item) => [item.id, item.name])), [people]);
  const unitNames = useMemo(() => new Map(units.map((item) => [item.id, item.name])), [units]);
  const positionNames = useMemo(() => new Map(positions.map((item) => [item.id, item.name])), [positions]);
  const projectNames = useMemo(() => new Map(projects.map((item) => [item.id, item.name])), [projects]);
  const hiresByRequest = useMemo(() => {
    const result = new Map<string, Hire[]>();
    hires.forEach((item) => result.set(item.requisition_id, [...(result.get(item.requisition_id) || []), item]));
    return result;
  }, [hires]);
  const filteredRequests = requests.filter((item) => `${item.code} ${item.title}`.toLowerCase().includes(query.toLowerCase()));
  const requestFilterMatch = (item: RecruitmentRequest, key: typeof requestFilter) =>
    key === 'ALL' || (key === 'REJECTED' ? ['REJECTED', 'CANCELLED'].includes(item.status) : item.status === key);
  const requestFilters = ([
    ['ALL', 'Tất cả'], ['SUBMITTED', 'Chờ HR'], ['PENDING_BOARD', 'Chờ BGĐ'], ['RETURNED', 'Trả về'], ['APPROVED', 'Đã duyệt'], ['OPEN', 'Đang tuyển'], ['CLOSED', 'Hoàn tất'], ['REJECTED', 'Từ chối / hủy'],
  ] as const).map(([key, label]) => ({ key, label, count: requests.filter((item) => requestFilterMatch(item, key)).length }));
  const visibleRequests = filteredRequests.filter((item) => requestFilterMatch(item, requestFilter));
  const openHeadcount = requests.filter((item) => item.status === 'OPEN')
    .reduce((sum, item) => sum + Math.max(0, item.headcount - (hiresByRequest.get(item.id) || []).length), 0);

  const createRequest = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!profile) return;
    const fieldError = checkRequestFields(requestForm);
    if (fieldError) { toast(fieldError, 'warning'); return; }
    const fileError = checkRequisitionFile(requestFile);
    if (fileError || !requestFile) { toast(fileError || 'Cần đính kèm tệp đề xuất.', 'warning'); return; }
    setSaving(true);
    const attachmentPath = await uploadRequisitionFile(requestFile);
    if (!attachmentPath) { setSaving(false); return; }
    const { error } = await supabase.from('recruitment_requisitions').insert({
      attachment_path: attachmentPath, attachment_name: requestFile.name,
      title: requestForm.title.trim(), unit_id: requestForm.unit_id || null,
      position_id: requestForm.position_id || null, requested_by: profile.id, hiring_manager_id: requestForm.hiring_manager_id || profile.id,
      headcount: Number(requestForm.headcount), employment_type: requestForm.employment_type,
      reason: requestForm.reason.trim(), salary_min: requestForm.salary_min ? Number(requestForm.salary_min) : null,
      salary_max: requestForm.salary_max ? Number(requestForm.salary_max) : null,
      desired_start_date: requestForm.desired_start_date || null, status: 'SUBMITTED',
      submitted_at: new Date().toISOString(), review_due_at: new Date(Date.now() + 24 * 3_600_000).toISOString(),
    });
    if (error) {
      toast('Không tạo được đề xuất: ' + describeDbError(error), 'error');
      await supabase.storage.from('requisition-files').remove([attachmentPath]);
    } else {
      const approvers = await fetchApproverIds('users');
      await notifyUsers(approvers.filter((id) => id !== profile.id), 'Đề xuất tuyển dụng mới', `${profile.name} đề xuất tuyển ${requestForm.headcount} vị trí ${requestForm.title}. HR cần trình Ban Giám đốc trong 24 giờ.`, 'recruitment_request');
      if (requestForm.hiring_manager_id && requestForm.hiring_manager_id !== profile.id) {
        await notifyUser(requestForm.hiring_manager_id, 'Bạn phụ trách đề xuất tuyển dụng', `${requestForm.title.trim()} · do ${profile.name} lập`, 'recruitment_owner_assigned');
      }
      toast('Đã gửi đề xuất tuyển dụng. HR sẽ trình Ban Giám đốc trong 24 giờ.', 'success');
      setRequestOpen(false); setRequestForm(blankRequest); setRequestFile(null); await load();
    }
    setSaving(false);
  };

  const saveOwner = async () => {
    if (!changingOwner || !ownerDraft) return;
    setSaving(true);
    const { error } = await supabase.from('recruitment_requisitions').update({ hiring_manager_id: ownerDraft }).eq('id', changingOwner.id);
    setSaving(false);
    if (error) { toast('Không đổi được người phụ trách: ' + describeDbError(error), 'error'); return; }
    if (ownerDraft !== profile?.id) {
      await notifyUser(ownerDraft, 'Bạn phụ trách đề xuất tuyển dụng', `${changingOwner.code} · ${changingOwner.title}`, 'recruitment_owner_assigned');
    }
    toast('Đã cập nhật người phụ trách.', 'success');
    setChangingOwner(null);
    await load();
  };

  const uploadRequisitionFile = async (file: File): Promise<string | null> => {
    if (!profile) return null;
    const ext = file.name.split('.').pop()?.toLowerCase() || 'pdf';
    const path = `${profile.id}/${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage.from('requisition-files').upload(path, file, { contentType: file.type || 'application/octet-stream', upsert: false });
    if (error) { toast('Không tải được tệp đề xuất: ' + describeDbError(error), 'error'); return null; }
    return path;
  };

  const openRequisitionFile = async (item: RecruitmentRequest) => {
    if (!item.attachment_path) return;
    const { data, error } = await supabase.storage.from('requisition-files').createSignedUrl(item.attachment_path, 300);
    if (error || !data?.signedUrl) { toast('Không mở được tệp đề xuất: ' + (error ? describeDbError(error) : 'thiếu đường dẫn'), 'error'); return; }
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
  };

  const openReview = (item: RecruitmentRequest, mode: 'hr' | 'board') => { setReviewing(item); setReviewMode(mode); setReviewNote(''); };

  const boardIds = async () => ((await supabase.from('profiles_directory').select('id').in('role', ['admin', 'ceo']).eq('is_active', true)).data || [])
    .map((row) => row.id as string).filter((id) => id !== profile?.id);

  /** BR-005: HR trình BGĐ / trả về; BGĐ phê duyệt / không phê duyệt / trả về. */
  const reviewRequest = async (decision: 'FORWARD' | 'RETURN' | 'APPROVED' | 'REJECTED' | 'RETURNED') => {
    if (!reviewing) return;
    const note = reviewNote.trim();
    if (decision !== 'FORWARD' && decision !== 'APPROVED' && note.length < 5) { toast('Ghi rõ lý do (ít nhất 5 ký tự).', 'warning'); return; }
    setSaving(true);
    const { error } = reviewMode === 'hr'
      ? await supabase.rpc('hr_review_requisition', { target_id: reviewing.id, decision, note: note || null })
      : await supabase.rpc('board_review_requisition', { target_id: reviewing.id, decision, note: note || null });
    setSaving(false);
    if (error) { toast('Không xử lý được đề xuất: ' + describeDbError(error), 'error'); return; }
    const label = `${reviewing.code} · ${reviewing.title}${note ? ` · ${note}` : ''}`;
    const owners = [reviewing.requested_by, reviewing.hiring_manager_id];
    if (decision === 'FORWARD') {
      await notifyUsers(await boardIds(), 'Đề xuất tuyển dụng chờ BGĐ phê duyệt', label, 'recruitment_board_review');
      toast('Đã trình Ban Giám đốc.', 'success');
    } else {
      const title = decision === 'APPROVED' ? 'Đề xuất tuyển dụng đã được BGĐ phê duyệt'
        : decision === 'REJECTED' ? 'Đề xuất tuyển dụng không được phê duyệt' : 'Đề xuất tuyển dụng bị trả về để điều chỉnh';
      await notifyUsers(owners.filter((id) => id !== profile?.id), title, label, 'recruitment_review');
      toast(decision === 'APPROVED' ? 'Đã phê duyệt đề xuất.' : decision === 'REJECTED' ? 'Đã ghi nhận không phê duyệt.' : 'Đã trả về cho người lập điều chỉnh.', 'success');
    }
    setReviewing(null); setReviewNote(''); await load();
  };

  const openResubmit = (item: RecruitmentRequest) => {
    setResubmitting(item);
    setResubmitFile(null);
    setResubmitForm({
      title: item.title, headcount: String(item.headcount), reason: item.reason,
      salary_min: item.salary_min == null ? '' : String(item.salary_min), salary_max: item.salary_max == null ? '' : String(item.salary_max),
      desired_start_date: item.desired_start_date || '',
    });
  };

  const saveResubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!resubmitting) return;
    const resubmitFieldError = checkRequestFields(resubmitForm);
    if (resubmitFieldError) { toast(resubmitFieldError, 'warning'); return; }
    if (resubmitFile) { const fileError = checkRequisitionFile(resubmitFile); if (fileError) { toast(fileError, 'warning'); return; } }
    if (!resubmitFile && !resubmitting.attachment_path) { toast('Cần đính kèm tệp đề xuất.', 'warning'); return; }
    setSaving(true);
    const newPath = resubmitFile ? await uploadRequisitionFile(resubmitFile) : null;
    if (resubmitFile && !newPath) { setSaving(false); return; }
    const { error } = await supabase.rpc('resubmit_requisition', {
      target_id: resubmitting.id, p_title: resubmitForm.title.trim(), p_headcount: Number(resubmitForm.headcount), p_reason: resubmitForm.reason.trim(),
      p_salary_min: resubmitForm.salary_min ? Number(resubmitForm.salary_min) : null, p_salary_max: resubmitForm.salary_max ? Number(resubmitForm.salary_max) : null,
      p_desired_start_date: resubmitForm.desired_start_date || null, p_attachment_path: newPath, p_attachment_name: resubmitFile?.name ?? null,
    });
    setSaving(false);
    if (error) { toast('Không gửi lại được: ' + describeDbError(error), 'error'); if (newPath) await supabase.storage.from('requisition-files').remove([newPath]); return; }
    const hrIds = await fetchApproverIds('users');
    await notifyUsers(hrIds.filter((id) => id !== profile?.id), 'Đề xuất tuyển dụng được gửi lại', `${resubmitting.code} · ${resubmitForm.title.trim()}`, 'recruitment_request');
    toast('Đã gửi lại đề xuất. HR kiểm tra trong 24 giờ.', 'success');
    setResubmitting(null); await load();
  };

  const setRequestStatus = async (item: RecruitmentRequest, status: RequestStatus) => {
    const { error } = await supabase.from('recruitment_requisitions').update({ status }).eq('id', item.id);
    if (error) toast('Không cập nhật được trạng thái: ' + describeDbError(error), 'error');
    else { toast(status === 'OPEN' ? 'Đã chuyển sang triển khai tuyển dụng.' : 'Đã hoàn tất đợt tuyển dụng.', 'success'); await load(); }
  };

  const removeRequest = async (item: RecruitmentRequest) => {
    const count = (hiresByRequest.get(item.id) || []).length;
    const canDelete = count === 0 && ['DRAFT', 'REJECTED', 'CANCELLED'].includes(item.status);
    const accepted = await confirm({
      title: canDelete ? `Xóa đề xuất ${item.code}?` : `Hủy đề xuất ${item.code}?`,
      message: canDelete ? 'Đề xuất chưa có nhân sự được tuyển và sẽ bị xóa.' : 'Đề xuất đã phát sinh quy trình nên chỉ được hủy để bảo toàn lịch sử.',
      confirmLabel: canDelete ? 'Xóa đề xuất' : 'Hủy đề xuất', danger: true,
    });
    if (!accepted) return;
    const result = canDelete
      ? await supabase.from('recruitment_requisitions').delete().eq('id', item.id)
      : await supabase.from('recruitment_requisitions').update({ status: 'CANCELLED' }).eq('id', item.id);
    if (result.error) toast('Không xử lý được đề xuất: ' + describeDbError(result.error), 'error');
    else { toast(canDelete ? 'Đã xóa đề xuất.' : 'Đã hủy đề xuất và giữ lịch sử.', 'success'); await load(); }
  };

  const openHire = (item: RecruitmentRequest) => { setHiring(item); setHireForm(blankHire); };

  const saveHire = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!hiring || !hireForm.project_id || !hireForm.user_id) { toast('Chọn dự án và nhân sự.', 'warning'); return; }
    setSaving(true);
    const { error } = await supabase.rpc('add_hire_to_project', {
      target_requisition: hiring.id, target_project: hireForm.project_id, target_user: hireForm.user_id, target_role: hireForm.role_code,
    });
    setSaving(false);
    if (error) { toast('Không thêm được nhân sự: ' + describeDbError(error), 'error'); return; }
    const filled = (hiresByRequest.get(hiring.id) || []).length + 1;
    toast(filled >= hiring.headcount ? 'Đã thêm nhân sự. Đề xuất đủ số lượng và chuyển Hoàn tất.' : `Đã thêm nhân sự vào dự án (${filled}/${hiring.headcount}).`, 'success');
    if (filled >= hiring.headcount) setHiring(null); else setHireForm({ ...blankHire, project_id: hireForm.project_id, role_code: hireForm.role_code });
    await load();
  };

  const removeHireRow = async (hire: Hire) => {
    const accepted = await confirm({
      title: `Gỡ ${names.get(hire.user_id) || 'nhân sự'} khỏi đề xuất?`,
      message: 'Chỉ gỡ khỏi danh sách đã tuyển của đề xuất; tư cách thành viên dự án giữ nguyên (gỡ ở trang dự án nếu cần).',
      confirmLabel: 'Gỡ khỏi đề xuất', danger: true,
    });
    if (!accepted) return;
    const { error } = await supabase.rpc('remove_hire', { target_hire: hire.id });
    if (error) toast('Không gỡ được: ' + describeDbError(error), 'error');
    else { toast('Đã gỡ khỏi đề xuất.', 'success'); await load(); }
  };


  const statCards: Array<{ key: string; label: string; value: number; color: string; active: boolean; onClick: () => void }> = [
    { key: 'submitted', label: 'Chờ HR kiểm tra', value: requests.filter((item) => item.status === 'SUBMITTED').length, color: 'text-amber-600',
      active: requestFilter === 'SUBMITTED', onClick: () => setRequestFilter('SUBMITTED') },
    { key: 'board', label: 'Chờ BGĐ phê duyệt', value: requests.filter((item) => item.status === 'PENDING_BOARD').length, color: 'text-orange-600',
      active: requestFilter === 'PENDING_BOARD', onClick: () => setRequestFilter('PENDING_BOARD') },
    { key: 'open', label: 'Đang tuyển', value: requests.filter((item) => item.status === 'OPEN').length, color: 'text-emerald-600',
      active: requestFilter === 'OPEN', onClick: () => setRequestFilter('OPEN') },
    { key: 'headcount', label: 'Còn cần tuyển (người)', value: openHeadcount, color: 'text-indigo-600',
      active: false, onClick: () => setRequestFilter('OPEN') },
  ];

  return <div className="space-y-5">
    <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
      <div>
        <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-indigo-600"><UserRoundCheck className="h-4 w-4" />Quản lý tuyển dụng</div>
        <h2 className="font-display text-xl font-bold text-slate-900">Tuyển dụng nhân sự</h2>
        <p className="mt-1 text-sm text-slate-500">Trưởng phòng lập đề xuất → HR kiểm tra → BGĐ phê duyệt → BGĐ thêm nhân sự đã tuyển vào dự án.</p>
      </div>
      <Button theme="admin" onClick={() => setRequestOpen(true)}><Plus className="h-4 w-4" />Lập đề xuất tuyển dụng</Button>
    </div>

    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {statCards.map((card) => (
        <button key={card.key} type="button" onClick={card.onClick} aria-pressed={card.active}
          className={`rounded-2xl border bg-white p-4 text-left shadow-sm transition hover:border-indigo-300 ${card.active ? 'border-indigo-500 ring-2 ring-indigo-500/20' : 'border-slate-200'}`}>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{card.label}</p>
          <p className={`mt-2 text-2xl font-bold ${card.color}`}>{card.value}</p>
        </button>
      ))}
    </div>

    <Card><CardContent className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm font-semibold text-slate-700">Đề xuất tuyển dụng ({requests.length})</p>
        <div className="relative w-full sm:w-72"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Tìm mã, vị trí..." className="w-full rounded-xl border border-slate-200 py-2.5 pl-9 pr-3 text-sm outline-none focus:border-indigo-400" /></div>
      </div>
      <div className="flex flex-wrap gap-2">
        {requestFilters.map((filter) => (
          <button key={filter.key} type="button" onClick={() => setRequestFilter(filter.key)}
            className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${requestFilter === filter.key ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-indigo-300'}`}>
            {filter.label} <span className={requestFilter === filter.key ? 'text-indigo-100' : 'text-slate-400'}>{filter.count}</span>
          </button>
        ))}
      </div>
    </CardContent></Card>

    {loading ? <Card><CardContent><p className="py-12 text-center text-sm text-slate-400">Đang tải đề xuất tuyển dụng...</p></CardContent></Card>
      : loadError ? <Card><CardContent><div className="flex gap-3 rounded-xl bg-amber-50 p-4 text-sm text-amber-800"><AlertTriangle className="h-5 w-5 shrink-0" /><div><p className="font-bold">Chưa thể đọc dữ liệu tuyển dụng</p><p className="mt-1">{loadError}</p></div></div></CardContent></Card>
      : visibleRequests.length === 0 ? <Card><EmptyState icon={<UsersRound className="h-8 w-8" />} title={requests.length === 0 ? 'Chưa có đề xuất tuyển dụng' : 'Không có đề xuất phù hợp bộ lọc'} description="Trưởng bộ phận lập đề xuất; HR kiểm tra và trình Ban Giám đốc trong 24 giờ." action={requests.length === 0 ? <Button theme="admin" onClick={() => setRequestOpen(true)}><Plus className="h-4 w-4" />Lập đề xuất</Button> : undefined} /></Card>
      : <div className="grid gap-4 xl:grid-cols-2">{visibleRequests.map((item) => {
        const deadline = item.status === 'SUBMITTED' ? deadlineText(item.review_due_at) : null;
        const itemHires = hiresByRequest.get(item.id) || [];
        const filled = itemHires.length;
        const showHires = ['OPEN', 'CLOSED'].includes(item.status) || filled > 0;
        return <Card key={item.id}><CardContent className="space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0"><p className="text-xs font-bold text-indigo-600">{item.code}</p><h3 className="mt-1 font-display text-base font-bold text-slate-900">{item.title}</h3><p className="mt-1 text-xs text-slate-500">{unitNames.get(item.unit_id || '') || 'Chưa chọn đơn vị'} · {positionNames.get(item.position_id || '') || 'Chưa gắn vị trí'}</p></div>
            <Badge className={requestStatus[item.status].color}>{requestStatus[item.status].label}</Badge>
          </div>
          <div className="grid grid-cols-2 gap-3 rounded-xl bg-slate-50 p-3 text-xs sm:grid-cols-4">
            <div><span className="text-slate-400">Số lượng</span><p className="mt-1 font-bold text-slate-700">{item.headcount} người</p></div>
            <div><span className="text-slate-400">Người phụ trách</span><p className="mt-1 font-bold text-slate-700">{names.get(item.hiring_manager_id) || '—'}{canReview && !['CLOSED', 'CANCELLED', 'REJECTED'].includes(item.status) && <button type="button" className="ml-1.5 text-xs font-semibold text-indigo-700 hover:underline" onClick={() => { setChangingOwner(item); setOwnerDraft(item.hiring_manager_id); }}>Đổi</button>}</p></div>
            <div><span className="text-slate-400">Khoảng lương</span><p className="mt-1 font-bold text-slate-700">{item.salary_min == null && item.salary_max == null ? 'Thỏa thuận' : `${money(item.salary_min)} – ${money(item.salary_max)}`}</p></div>
            <div><span className="text-slate-400">Đã tuyển</span><p className="mt-1 font-bold text-slate-700">{filled}/{item.headcount} người</p></div>
          </div>
          <p className="line-clamp-2 text-sm text-slate-600">{item.reason}</p>
          {showHires && <div className="rounded-xl border border-emerald-100 bg-emerald-50/50 p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-700"><FolderKanban className="h-3.5 w-3.5" />Nhân sự đã thêm vào dự án</p>
              <span className="text-xs font-semibold text-emerald-700">{filled}/{item.headcount}</span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded bg-emerald-100"><div className="h-full bg-emerald-500" style={{ width: `${Math.min(100, Math.round(filled / Math.max(1, item.headcount) * 100))}%` }} /></div>
            {itemHires.length === 0 ? <p className="mt-2 text-xs text-slate-500">Chưa thêm nhân sự nào.</p> : <ul className="mt-2 space-y-1.5">
              {itemHires.map((hire) => <li key={hire.id} className="flex items-center gap-2 text-xs text-slate-600">
                <span className="font-semibold text-slate-800">{names.get(hire.user_id) || 'Nhân sự'}</span>
                <span>→ {projectNames.get(hire.project_id) || 'Dự án'} · {roleLabel(hire.role_code)}</span>
                <span className="ml-auto text-slate-400">{new Date(hire.added_at).toLocaleDateString('vi-VN')}</span>
                {isBoard && <button type="button" onClick={() => void removeHireRow(hire)} className="rounded p-1 text-slate-400 hover:bg-white hover:text-red-600" aria-label="Gỡ khỏi đề xuất"><XCircle className="h-3.5 w-3.5" /></button>}
              </li>)}
            </ul>}
          </div>}
          {item.review_note && ["RETURNED", "REJECTED"].includes(item.status) && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700"><strong>{item.status === "RETURNED" ? "Cần điều chỉnh:" : "Lý do không phê duyệt:"}</strong> {item.review_note}</p>}
          {item.status === "PENDING_BOARD" && item.hr_note && <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800"><strong>HR ghi chú:</strong> {item.hr_note}</p>}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
            {deadline ? <span className={`flex items-center gap-1.5 text-xs font-semibold ${deadline.overdue ? 'text-red-600' : 'text-amber-600'}`}><Clock3 className="h-4 w-4" />{deadline.text} để HR kiểm tra & trình BGĐ</span> : <span className="text-xs text-slate-400">Đề xuất bởi {names.get(item.requested_by) || 'người dùng'}</span>}
            <div className="flex flex-wrap gap-2">
              {item.attachment_path && <Button variant="outline" onClick={() => void openRequisitionFile(item)}><FileText className="h-4 w-4" />Tệp đề xuất</Button>}
              {canReview && item.status === 'SUBMITTED' && <Button theme="admin" onClick={() => openReview(item, 'hr')}>Kiểm tra & trình BGĐ</Button>}
              {isBoard && item.status === 'PENDING_BOARD' && <Button theme="admin" onClick={() => openReview(item, 'board')}><CheckCircle2 className="h-4 w-4" />BGĐ phê duyệt</Button>}
              {item.status === 'RETURNED' && item.requested_by === profile?.id && <Button theme="admin" onClick={() => openResubmit(item)}>Sửa & gửi lại</Button>}
              {canReview && item.status === 'APPROVED' && <Button theme="admin" onClick={() => setRequestStatus(item, 'OPEN')}><ArrowRight className="h-4 w-4" />Triển khai tuyển dụng</Button>}
              {isBoard && item.status === 'OPEN' && filled < item.headcount && <Button theme="admin" onClick={() => openHire(item)}><UserPlus className="h-4 w-4" />Thêm nhân sự vào dự án</Button>}
              {canReview && item.status === 'OPEN' && <Button variant="secondary" onClick={() => setRequestStatus(item, 'CLOSED')}><CheckCircle2 className="h-4 w-4" />Hoàn tất</Button>}
              {canReview && !['CLOSED', 'CANCELLED'].includes(item.status) && <Button variant="danger" onClick={() => void removeRequest(item)} aria-label={`Xóa hoặc hủy ${item.code}`}><Trash2 className="h-4 w-4" /></Button>}
            </div>
          </div>
        </CardContent></Card>;
      })}</div>}

    <Modal open={requestOpen} onClose={() => setRequestOpen(false)} title="Lập đề xuất tuyển dụng" size="lg"><form onSubmit={createRequest} className="space-y-4"><Input label="Vị trí cần tuyển" minLength={TITLE_MIN} placeholder="VD: Nhân viên thiết kế" value={requestForm.title} onChange={(e) => setRequestForm({ ...requestForm, title: e.target.value })} required /><div className="grid gap-3 sm:grid-cols-2"><Select label="Đơn vị" value={requestForm.unit_id} onChange={(e) => setRequestForm({ ...requestForm, unit_id: e.target.value })}><option value="">Chọn đơn vị</option>{units.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select><Select label="Vị trí trong cơ cấu" value={requestForm.position_id} onChange={(e) => setRequestForm({ ...requestForm, position_id: e.target.value })}><option value="">Chọn vị trí</option>{positions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></div><div className="grid gap-3 sm:grid-cols-3"><Input label="Số lượng" type="number" min="1" value={requestForm.headcount} onChange={(e) => setRequestForm({ ...requestForm, headcount: e.target.value })} required /><Select label="Người phụ trách tuyển" value={requestForm.hiring_manager_id || profile?.id || ''} onChange={(e) => setRequestForm({ ...requestForm, hiring_manager_id: e.target.value })}>{people.map((person) => <option key={person.id} value={person.id}>{person.name}{person.id === profile?.id ? ' (tôi)' : ''}</option>)}</Select><Select label="Hình thức" value={requestForm.employment_type} onChange={(e) => setRequestForm({ ...requestForm, employment_type: e.target.value })}><option value="FULL_TIME">Toàn thời gian</option><option value="PART_TIME">Bán thời gian</option><option value="CONTRACT">Hợp đồng</option><option value="INTERN">Thực tập</option></Select><Input label="Ngày mong muốn" type="date" value={requestForm.desired_start_date} onChange={(e) => setRequestForm({ ...requestForm, desired_start_date: e.target.value })} /></div><div className="grid gap-3 sm:grid-cols-2"><Input label="Lương tối thiểu" type="number" min="0" value={requestForm.salary_min} onChange={(e) => setRequestForm({ ...requestForm, salary_min: e.target.value })} /><Input label="Lương tối đa" type="number" min="0" value={requestForm.salary_max} onChange={(e) => setRequestForm({ ...requestForm, salary_max: e.target.value })} /></div><Textarea label="Lý do và yêu cầu tuyển" minLength={REASON_MIN} placeholder="VD: Bổ sung 1 nhân viên thiết kế cho dự án mới, yêu cầu 1 năm kinh nghiệm Figma (tối thiểu 5 ký tự)" value={requestForm.reason} onChange={(e) => setRequestForm({ ...requestForm, reason: e.target.value })} required /><label className="block"><span className="mb-1.5 block text-sm font-semibold text-slate-700">Tệp đề xuất theo mẫu Huy Phong<span className="ml-1 text-red-500">*</span></span><input type="file" accept=".pdf,.doc,.docx" required onChange={(e) => { const file = e.target.files?.[0] || null; const err = checkRequisitionFile(file); if (file && err) { toast(err, 'warning'); e.target.value = ''; setRequestFile(null); } else setRequestFile(file); }} className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-indigo-50 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-indigo-700" /><span className="mt-1 block text-xs text-slate-500">.pdf, .doc, .docx · tối đa 20 MB</span></label><p className="rounded-xl bg-indigo-50 p-3 text-xs text-indigo-700">Sau khi gửi, HR tiếp nhận đề xuất và trình Ban Giám đốc xem xét, phê duyệt trong thời hạn 24 giờ.</p><div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setRequestOpen(false)}>Hủy</Button><Button type="submit" theme="admin" disabled={saving}>{saving ? 'Đang gửi...' : 'Gửi đề xuất'}</Button></div></form></Modal>

    <Modal open={!!reviewing} onClose={() => setReviewing(null)} title={reviewMode === 'hr' ? 'HR kiểm tra đề xuất' : 'Ban Giám đốc phê duyệt'}><div className="space-y-4">
      <p className="rounded-xl bg-indigo-50 p-3 text-xs leading-relaxed text-indigo-700">{reviewMode === 'hr' ? 'Bước 1/2 · HR kiểm tra nội dung và tệp đề xuất, rồi trình Ban Giám đốc hoặc trả về để người lập điều chỉnh.' : 'Bước 2/2 · Chỉ triển khai tuyển dụng sau khi Ban Giám đốc phê duyệt.'}</p>
      <div className="rounded-xl bg-slate-50 p-3"><p className="text-xs font-bold text-indigo-600">{reviewing?.code}</p><p className="mt-1 font-bold text-slate-900">{reviewing?.title}</p><p className="mt-1 text-sm text-slate-500">{reviewing?.headcount} người · {reviewing?.reason}</p>
        {reviewing?.attachment_path ? <button type="button" onClick={() => reviewing && void openRequisitionFile(reviewing)} className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-indigo-700 underline"><FileText className="h-4 w-4" />{reviewing.attachment_name || 'Tệp đề xuất'}</button> : <p className="mt-2 text-xs text-amber-700">Đề xuất cũ chưa có tệp đính kèm.</p>}
        {reviewMode === 'board' && reviewing?.hr_note && <p className="mt-2 text-xs text-slate-600"><strong>HR ghi chú:</strong> {reviewing.hr_note}</p>}
      </div>
      <Textarea label={reviewMode === 'hr' ? 'Ghi chú của HR (bắt buộc khi trả về)' : 'Ý kiến của Ban Giám đốc (bắt buộc khi không phê duyệt / trả về)'} value={reviewNote} onChange={(e) => setReviewNote(e.target.value)} />
      <div className="flex flex-wrap justify-end gap-2">{reviewMode === 'hr' ? <>
        <Button variant="outline" onClick={() => void reviewRequest('RETURN')} disabled={saving}>Trả về điều chỉnh</Button>
        <Button theme="admin" onClick={() => void reviewRequest('FORWARD')} disabled={saving}><ArrowRight className="h-4 w-4" />Trình Ban Giám đốc</Button>
      </> : <>
        <Button variant="outline" onClick={() => void reviewRequest('RETURNED')} disabled={saving}>Trả về điều chỉnh</Button>
        <Button variant="danger" onClick={() => void reviewRequest('REJECTED')} disabled={saving}><XCircle className="h-4 w-4" />Không phê duyệt</Button>
        <Button theme="admin" onClick={() => void reviewRequest('APPROVED')} disabled={saving}><CheckCircle2 className="h-4 w-4" />Phê duyệt</Button>
      </>}</div>
    </div></Modal>

    <Modal open={!!resubmitting} onClose={() => setResubmitting(null)} title="Sửa & gửi lại đề xuất" size="lg"><form onSubmit={saveResubmit} className="space-y-4">
      {resubmitting?.review_note && <p className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700"><strong>Cần điều chỉnh:</strong> {resubmitting.review_note}</p>}
      <Input label="Vị trí cần tuyển" minLength={TITLE_MIN} value={resubmitForm.title} onChange={(e) => setResubmitForm({ ...resubmitForm, title: e.target.value })} required />
      <div className="grid gap-3 sm:grid-cols-3">
        <Input label="Số lượng" type="number" min="1" value={resubmitForm.headcount} onChange={(e) => setResubmitForm({ ...resubmitForm, headcount: e.target.value })} required />
        <Input label="Lương tối thiểu" type="number" min="0" value={resubmitForm.salary_min} onChange={(e) => setResubmitForm({ ...resubmitForm, salary_min: e.target.value })} />
        <Input label="Lương tối đa" type="number" min="0" value={resubmitForm.salary_max} onChange={(e) => setResubmitForm({ ...resubmitForm, salary_max: e.target.value })} />
      </div>
      <Input label="Ngày mong muốn" type="date" value={resubmitForm.desired_start_date} onChange={(e) => setResubmitForm({ ...resubmitForm, desired_start_date: e.target.value })} />
      <Textarea label="Lý do và yêu cầu tuyển" minLength={REASON_MIN} placeholder="Tối thiểu 5 ký tự" value={resubmitForm.reason} onChange={(e) => setResubmitForm({ ...resubmitForm, reason: e.target.value })} required />
      <label className="block"><span className="mb-1.5 block text-sm font-semibold text-slate-700">Tệp đề xuất mới {resubmitting?.attachment_path ? '(bỏ trống để giữ tệp cũ)' : <span className="text-red-500">*</span>}</span><input type="file" accept=".pdf,.doc,.docx" onChange={(e) => setResubmitFile(e.target.files?.[0] || null)} className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-indigo-50 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-indigo-700" /></label>
      <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setResubmitting(null)}>Hủy</Button><Button type="submit" theme="admin" disabled={saving}>{saving ? 'Đang gửi...' : 'Gửi lại'}</Button></div>
    </form></Modal>






    <Modal open={!!changingOwner} onClose={() => setChangingOwner(null)} title="Đổi người phụ trách tuyển dụng"><div className="space-y-4">
      <p className="text-sm text-slate-600">{changingOwner?.code} · {changingOwner?.title}</p>
      <Select label="Người phụ trách" value={ownerDraft} onChange={(e) => setOwnerDraft(e.target.value)}>{people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</Select>
      <p className="text-xs text-slate-500">Người phụ trách nhận thông báo khi đề xuất được duyệt và khi có nhân sự được thêm vào dự án.</p>
      <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setChangingOwner(null)}>Hủy</Button><Button theme="admin" disabled={saving || !ownerDraft || ownerDraft === changingOwner?.hiring_manager_id} onClick={() => void saveOwner()}>Lưu</Button></div>
    </div></Modal>

    <Modal open={!!hiring} onClose={() => setHiring(null)} title="Thêm nhân sự đã tuyển vào dự án"><form onSubmit={saveHire} className="space-y-4">
      <div className="rounded-xl bg-slate-50 p-3 text-sm"><p className="text-xs font-bold text-indigo-600">{hiring?.code}</p><p className="font-semibold text-slate-900">{hiring?.title}</p><p className="mt-1 text-xs text-slate-500">Đã tuyển {(hiring && (hiresByRequest.get(hiring.id) || []).length) || 0}/{hiring?.headcount} người</p></div>
      <Select label="Dự án" value={hireForm.project_id} onChange={(e) => setHireForm({ ...hireForm, project_id: e.target.value })} required>
        <option value="">Chọn dự án</option>
        {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
      </Select>
      <Select label="Nhân sự" value={hireForm.user_id} onChange={(e) => setHireForm({ ...hireForm, user_id: e.target.value })} required>
        <option value="">Chọn nhân sự</option>
        {people.filter((person) => !(hiring && (hiresByRequest.get(hiring.id) || []).some((hire) => hire.user_id === person.id))).map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
      </Select>
      <p className="-mt-2 text-xs text-slate-500">Nhân sự mới tuyển từ bên ngoài cần có tài khoản trước: <Link to="/admin/users" className="font-semibold text-indigo-700 underline">Hồ sơ nhân sự → Thêm người dùng</Link>.</p>
      <Select label="Vai trò trong dự án" value={hireForm.role_code} onChange={(e) => setHireForm({ ...hireForm, role_code: e.target.value })}>
        {HIRE_ROLES.map((role) => <option key={role.code} value={role.code}>{role.label}</option>)}
      </Select>
      <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setHiring(null)}>Đóng</Button><Button type="submit" theme="admin" disabled={saving || !hireForm.project_id || !hireForm.user_id}><UserPlus className="h-4 w-4" />{saving ? 'Đang thêm...' : 'Thêm vào dự án'}</Button></div>
    </form></Modal>
  </div>;
}
