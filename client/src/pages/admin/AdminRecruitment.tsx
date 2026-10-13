import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, ArrowRight, CalendarClock, CheckCircle2, Clock3, FileCheck2,
  Handshake, Plus, Search, Trash2, UserRoundCheck, UsersRound, XCircle,
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
import { hasPermission } from '@/lib/permissions';
import { supabase } from '@/lib/supabase';

type RequestStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'OPEN' | 'CLOSED' | 'CANCELLED';
type CandidateStage = 'APPLIED' | 'HR_SCREENING' | 'MANAGER_SCREENING' | 'INTERVIEW_1' | 'INTERVIEW_2' | 'TEST' | 'OFFER' | 'HIRED' | 'REJECTED' | 'WITHDRAWN';

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
  created_at: string;
}

interface Candidate {
  id: string;
  requisition_id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  source: string | null;
  stage: CandidateStage;
  test_due_at: string | null;
  rejection_reason: string | null;
  consent_at: string | null;
  created_at: string;
}

interface Interview {
  id: string; candidate_id: string; round: number; scheduled_at: string;
  interviewer_id: string | null; mode: string; location_or_link: string | null;
  status: string; score: number | null; recommendation: string | null; feedback: string | null;
}

interface Offer {
  id: string; candidate_id: string; proposed_salary: number; start_date: string;
  status: 'DRAFT' | 'SENT' | 'ACCEPTED' | 'DECLINED' | 'WITHDRAWN'; note: string | null;
}

interface Handoff { id: string; candidate_id: string; planned_start_date: string; status: string; }

interface DirectoryItem { id: string; name: string; }
interface OrgItem { id: string; name: string; }

const requestStatus: Record<RequestStatus, { label: string; color: string }> = {
  DRAFT: { label: 'Bản nháp', color: 'bg-slate-100 text-slate-700' },
  SUBMITTED: { label: 'Chờ BGĐ phê duyệt', color: 'bg-amber-100 text-amber-700' },
  APPROVED: { label: 'BGĐ đã phê duyệt', color: 'bg-blue-100 text-blue-700' },
  REJECTED: { label: 'Từ chối', color: 'bg-red-100 text-red-700' },
  OPEN: { label: 'Đang tuyển', color: 'bg-emerald-100 text-emerald-700' },
  CLOSED: { label: 'Đã hoàn tất', color: 'bg-indigo-100 text-indigo-700' },
  CANCELLED: { label: 'Đã hủy', color: 'bg-slate-100 text-slate-500' },
};

const stages: CandidateStage[] = ['APPLIED', 'HR_SCREENING', 'MANAGER_SCREENING', 'INTERVIEW_1', 'INTERVIEW_2', 'TEST', 'OFFER', 'HIRED', 'REJECTED', 'WITHDRAWN'];
const stageLabel: Record<CandidateStage, string> = {
  APPLIED: 'Đã tiếp nhận hồ sơ', HR_SCREENING: 'HR sàng lọc', MANAGER_SCREENING: 'Bộ phận chuyên môn sàng lọc',
  INTERVIEW_1: 'Phỏng vấn vòng 1', INTERVIEW_2: 'Phỏng vấn vòng 2', TEST: 'Kiểm tra năng lực (24 giờ)',
  OFFER: 'Thông báo kết quả / offer', HIRED: 'Trúng tuyển', REJECTED: 'Không trúng tuyển', WITHDRAWN: 'Ứng viên rút',
};

const blankRequest = {
  title: '', unit_id: '', position_id: '', headcount: '1', employment_type: 'FULL_TIME',
  reason: '', salary_min: '', salary_max: '', desired_start_date: '',
};
const blankCandidate = { requisition_id: '', full_name: '', email: '', phone: '', source: '', consent: false };
const blankInterview = { round: '1', scheduled_at: '', interviewer_id: '', mode: 'OFFLINE', location_or_link: '', score: '', recommendation: '', feedback: '' };
const blankOffer = { proposed_salary: '', start_date: '', status: 'DRAFT' as Offer['status'], note: '' };
const blankHandoff = { planned_start_date: '', note: '' };

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
  const [tab, setTab] = useState<'requests' | 'candidates'>('requests');
  const [requests, setRequests] = useState<RecruitmentRequest[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [interviews, setInterviews] = useState<Interview[]>([]);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [handoffs, setHandoffs] = useState<Handoff[]>([]);
  const [people, setPeople] = useState<DirectoryItem[]>([]);
  const [units, setUnits] = useState<OrgItem[]>([]);
  const [positions, setPositions] = useState<OrgItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [requestOpen, setRequestOpen] = useState(false);
  const [candidateOpen, setCandidateOpen] = useState(false);
  const [requestForm, setRequestForm] = useState(blankRequest);
  const [candidateForm, setCandidateForm] = useState(blankCandidate);
  const [reviewing, setReviewing] = useState<RecruitmentRequest | null>(null);
  const [reviewNote, setReviewNote] = useState('');
  const [rejecting, setRejecting] = useState<Candidate | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState('');
  const [interviewing, setInterviewing] = useState<Candidate | null>(null);
  const [interviewForm, setInterviewForm] = useState(blankInterview);
  const [offering, setOffering] = useState<Candidate | null>(null);
  const [offerForm, setOfferForm] = useState(blankOffer);
  const [handingOff, setHandingOff] = useState<Candidate | null>(null);
  const [handoffForm, setHandoffForm] = useState(blankHandoff);

  const load = async () => {
    setLoading(true);
    const [requestRes, candidateRes, peopleRes, unitRes, positionRes, interviewRes, offerRes, handoffRes] = await Promise.all([
      supabase.from('recruitment_requisitions').select('*').order('created_at', { ascending: false }),
      supabase.from('recruitment_candidates').select('*').order('created_at', { ascending: false }),
      supabase.from('profiles_directory').select('id,name').eq('is_active', true),
      supabase.from('organization_units').select('id,name').eq('is_active', true).order('name'),
      supabase.from('job_positions').select('id,title').eq('is_active', true).order('title'),
      supabase.from('recruitment_interviews').select('*').order('scheduled_at', { ascending: false }),
      supabase.from('recruitment_offers').select('*').order('created_at', { ascending: false }),
      supabase.from('recruitment_onboarding_handoffs').select('*').order('handed_off_at', { ascending: false }),
    ]);
    const firstError = requestRes.error || candidateRes.error || unitRes.error || positionRes.error || interviewRes.error || offerRes.error || handoffRes.error;
    if (firstError) {
      setLoadError(describeDbError(firstError));
    } else {
      setLoadError('');
      setRequests((requestRes.data || []) as RecruitmentRequest[]);
      setCandidates((candidateRes.data || []) as Candidate[]);
      setPeople((peopleRes.data || []) as DirectoryItem[]);
      setUnits((unitRes.data || []) as OrgItem[]);
      setPositions((positionRes.data || []).map((item) => ({ id: item.id, name: item.title })) as OrgItem[]);
      setInterviews((interviewRes.data || []) as Interview[]);
      setOffers((offerRes.data || []) as Offer[]);
      setHandoffs((handoffRes.data || []) as Handoff[]);
    }
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);
  useRealtimeSync(
    [{ table: 'recruitment_requisitions' }, { table: 'recruitment_candidates' }, { table: 'recruitment_interviews' }, { table: 'recruitment_offers' }, { table: 'recruitment_onboarding_handoffs' }],
    load,
    { channelKey: 'internal-recruitment' },
  );

  const names = useMemo(() => new Map(people.map((item) => [item.id, item.name])), [people]);
  const unitNames = useMemo(() => new Map(units.map((item) => [item.id, item.name])), [units]);
  const positionNames = useMemo(() => new Map(positions.map((item) => [item.id, item.name])), [positions]);
  const candidateCounts = useMemo(() => {
    const result = new Map<string, number>();
    candidates.forEach((item) => result.set(item.requisition_id, (result.get(item.requisition_id) || 0) + 1));
    return result;
  }, [candidates]);
  const filteredRequests = requests.filter((item) => `${item.code} ${item.title}`.toLowerCase().includes(query.toLowerCase()));
  const filteredCandidates = candidates.filter((item) => `${item.full_name} ${item.email || ''} ${item.phone || ''}`.toLowerCase().includes(query.toLowerCase()));
  // Chỉ tiếp nhận hồ sơ sau khi HR đã chuyển đề xuất được duyệt sang bước triển khai tuyển dụng.
  const activeRequests = requests.filter((item) => item.status === 'OPEN');

  const createRequest = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!profile) return;
    setSaving(true);
    const { error } = await supabase.from('recruitment_requisitions').insert({
      title: requestForm.title.trim(), unit_id: requestForm.unit_id || null,
      position_id: requestForm.position_id || null, requested_by: profile.id, hiring_manager_id: profile.id,
      headcount: Number(requestForm.headcount), employment_type: requestForm.employment_type,
      reason: requestForm.reason.trim(), salary_min: requestForm.salary_min ? Number(requestForm.salary_min) : null,
      salary_max: requestForm.salary_max ? Number(requestForm.salary_max) : null,
      desired_start_date: requestForm.desired_start_date || null, status: 'SUBMITTED',
      submitted_at: new Date().toISOString(), review_due_at: new Date(Date.now() + 24 * 3_600_000).toISOString(),
    });
    if (error) toast('Không tạo được đề xuất: ' + describeDbError(error), 'error');
    else {
      const approvers = await fetchApproverIds('users');
      await notifyUsers(approvers.filter((id) => id !== profile.id), 'Đề xuất tuyển dụng mới', `${profile.name} đề xuất tuyển ${requestForm.headcount} vị trí ${requestForm.title}. HR cần trình Ban Giám đốc trong 24 giờ.`, 'recruitment_request');
      toast('Đã gửi đề xuất tuyển dụng. HR sẽ trình Ban Giám đốc trong 24 giờ.', 'success');
      setRequestOpen(false); setRequestForm(blankRequest); await load();
    }
    setSaving(false);
  };

  const reviewRequest = async (decision: 'APPROVED' | 'REJECTED') => {
    if (!reviewing) return;
    if (decision === 'REJECTED' && !reviewNote.trim()) { toast('Cần nhập lý do từ chối.', 'warning'); return; }
    setSaving(true);
    const { error } = await supabase.rpc('review_recruitment_requisition', {
      target_id: reviewing.id, decision, note: reviewNote.trim() || null,
    });
    if (error) toast('Không thể duyệt đề xuất: ' + describeDbError(error), 'error');
    else {
      await notifyUser(reviewing.requested_by, decision === 'APPROVED' ? 'Đề xuất tuyển dụng đã được Ban Giám đốc phê duyệt' : 'Đề xuất tuyển dụng cần điều chỉnh', `${reviewing.code} · ${reviewing.title}${reviewNote ? ` · ${reviewNote}` : ''}`, 'recruitment_review');
      toast(decision === 'APPROVED' ? 'Đã ghi nhận Ban Giám đốc phê duyệt đề xuất.' : 'Đã ghi nhận từ chối và gửi lý do.', 'success');
      setReviewing(null); setReviewNote(''); await load();
    }
    setSaving(false);
  };

  const setRequestStatus = async (item: RecruitmentRequest, status: RequestStatus) => {
    const { error } = await supabase.from('recruitment_requisitions').update({ status }).eq('id', item.id);
    if (error) toast('Không cập nhật được trạng thái: ' + describeDbError(error), 'error');
    else { toast(status === 'OPEN' ? 'Đã chuyển sang triển khai tuyển dụng.' : 'Đã hoàn tất đợt tuyển dụng.', 'success'); await load(); }
  };

  const removeRequest = async (item: RecruitmentRequest) => {
    const count = candidateCounts.get(item.id) || 0;
    const canDelete = count === 0 && ['DRAFT', 'REJECTED', 'CANCELLED'].includes(item.status);
    const accepted = await confirm({
      title: canDelete ? `Xóa đề xuất ${item.code}?` : `Hủy đề xuất ${item.code}?`,
      message: canDelete ? 'Đề xuất chưa phát sinh ứng viên và sẽ bị xóa.' : 'Đề xuất đã phát sinh quy trình nên chỉ được hủy để bảo toàn lịch sử.',
      confirmLabel: canDelete ? 'Xóa đề xuất' : 'Hủy đề xuất', danger: true,
    });
    if (!accepted) return;
    const result = canDelete
      ? await supabase.from('recruitment_requisitions').delete().eq('id', item.id)
      : await supabase.from('recruitment_requisitions').update({ status: 'CANCELLED' }).eq('id', item.id);
    if (result.error) toast('Không xử lý được đề xuất: ' + describeDbError(result.error), 'error');
    else { toast(canDelete ? 'Đã xóa đề xuất.' : 'Đã hủy đề xuất và giữ lịch sử.', 'success'); await load(); }
  };

  const createCandidate = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!candidateForm.consent) { toast('Cần xác nhận ứng viên đồng ý lưu thông tin.', 'warning'); return; }
    setSaving(true);
    const { error } = await supabase.from('recruitment_candidates').insert({
      requisition_id: candidateForm.requisition_id, full_name: candidateForm.full_name.trim(),
      email: candidateForm.email.trim() || null, phone: candidateForm.phone.trim() || null,
      source: candidateForm.source.trim() || null, consent_at: new Date().toISOString(), stage: 'APPLIED',
    });
    if (error) toast('Không thêm được ứng viên: ' + describeDbError(error), 'error');
    else { toast('Đã tiếp nhận ứng viên.', 'success'); setCandidateOpen(false); setCandidateForm(blankCandidate); await load(); }
    setSaving(false);
  };

  const removeCandidate = async (candidate: Candidate) => {
    const hasHistory = interviews.some((item) => item.candidate_id === candidate.id)
      || offers.some((item) => item.candidate_id === candidate.id)
      || handoffs.some((item) => item.candidate_id === candidate.id);
    const canDelete = candidate.stage === 'APPLIED' && !hasHistory;
    const accepted = await confirm({
      title: canDelete ? `Xóa hồ sơ ${candidate.full_name}?` : `Đánh dấu ${candidate.full_name} đã rút?`,
      message: canDelete ? 'Hồ sơ mới tiếp nhận, chưa phát sinh nghiệp vụ và sẽ bị xóa.' : 'Hồ sơ đã có lịch sử nên không thể xóa; hệ thống sẽ chuyển sang trạng thái Ứng viên rút.',
      confirmLabel: canDelete ? 'Xóa hồ sơ' : 'Xác nhận rút', danger: true,
    });
    if (!accepted) return;
    const result = canDelete
      ? await supabase.from('recruitment_candidates').delete().eq('id', candidate.id)
      : await supabase.rpc('transition_recruitment_candidate', { target_id: candidate.id, target_stage: 'WITHDRAWN', reason: null });
    if (result.error) toast('Không xử lý được hồ sơ: ' + describeDbError(result.error), 'error');
    else { toast(canDelete ? 'Đã xóa hồ sơ ứng viên.' : 'Đã ghi nhận ứng viên rút.', 'success'); await load(); }
  };

  const updateStage = async (candidate: Candidate, stage: CandidateStage) => {
    if (stage === 'REJECTED') { setRejecting(candidate); setRejectionReason(''); return; }
    const { error } = await supabase.rpc('transition_recruitment_candidate', { target_id: candidate.id, target_stage: stage, reason: null });
    if (error) toast('Không cập nhật được ứng viên: ' + describeDbError(error), 'error');
    else { toast(`Đã chuyển sang: ${stageLabel[stage]}.`, 'success'); await load(); }
  };

  const rejectCandidate = async () => {
    if (!rejecting || !rejectionReason.trim()) { toast('Cần nhập lý do không phù hợp.', 'warning'); return; }
    setSaving(true);
    const { error } = await supabase.rpc('transition_recruitment_candidate', { target_id: rejecting.id, target_stage: 'REJECTED', reason: rejectionReason.trim() });
    if (error) toast('Không cập nhật được ứng viên: ' + describeDbError(error), 'error');
    else { toast('Đã lưu kết quả sàng lọc.', 'success'); setRejecting(null); await load(); }
    setSaving(false);
  };

  const openInterview = (candidate: Candidate) => {
    const existing = interviews.find((item) => item.candidate_id === candidate.id && item.round === 1)
      || interviews.find((item) => item.candidate_id === candidate.id);
    setInterviewing(candidate);
    setInterviewForm(existing ? {
      round: String(existing.round), scheduled_at: existing.scheduled_at.slice(0, 16), interviewer_id: existing.interviewer_id || '',
      mode: existing.mode, location_or_link: existing.location_or_link || '', score: existing.score == null ? '' : String(existing.score),
      recommendation: existing.recommendation || '', feedback: existing.feedback || '',
    } : blankInterview);
  };

  const saveInterview = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!interviewing) return;
    setSaving(true);
    const payload = {
      candidate_id: interviewing.id, round: Number(interviewForm.round),
      scheduled_at: new Date(interviewForm.scheduled_at).toISOString(), interviewer_id: interviewForm.interviewer_id || null,
      mode: interviewForm.mode, location_or_link: interviewForm.location_or_link.trim() || null,
      status: interviewForm.recommendation ? 'COMPLETED' : 'SCHEDULED',
      score: interviewForm.score ? Number(interviewForm.score) : null,
      recommendation: interviewForm.recommendation || null, feedback: interviewForm.feedback.trim() || null,
    };
    const { error } = await supabase.from('recruitment_interviews').upsert(payload, { onConflict: 'candidate_id,round' });
    if (error) toast('Không lưu được lịch phỏng vấn: ' + describeDbError(error), 'error');
    else {
      const nextStage = Number(interviewForm.round) === 2 ? 'INTERVIEW_2' : 'INTERVIEW_1';
      if (!['INTERVIEW_1', 'INTERVIEW_2', 'OFFER', 'HIRED'].includes(interviewing.stage)) {
        await supabase.rpc('transition_recruitment_candidate', { target_id: interviewing.id, target_stage: nextStage, reason: null });
      }
      toast(interviewForm.recommendation ? 'Đã lưu kết quả phỏng vấn.' : 'Đã lên lịch phỏng vấn.', 'success');
      setInterviewing(null); await load();
    }
    setSaving(false);
  };

  const openOffer = (candidate: Candidate) => {
    const existing = offers.find((item) => item.candidate_id === candidate.id);
    setOffering(candidate);
    setOfferForm(existing ? { proposed_salary: String(existing.proposed_salary), start_date: existing.start_date, status: existing.status, note: existing.note || '' } : blankOffer);
  };

  const saveOffer = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!offering) return;
    setSaving(true);
    const existing = offers.find((item) => item.candidate_id === offering.id);
    const now = new Date().toISOString();
    const payload = {
      candidate_id: offering.id, proposed_salary: Number(offerForm.proposed_salary), start_date: offerForm.start_date,
      status: offerForm.status, note: offerForm.note.trim() || null,
      sent_at: ['SENT', 'ACCEPTED', 'DECLINED'].includes(offerForm.status) ? now : null,
      responded_at: ['ACCEPTED', 'DECLINED'].includes(offerForm.status) ? now : null,
    };
    const result = existing
      ? await supabase.from('recruitment_offers').update(payload).eq('id', existing.id)
      : await supabase.from('recruitment_offers').insert(payload);
    if (result.error) toast('Không lưu được offer: ' + describeDbError(result.error), 'error');
    else {
      if (offering.stage !== 'OFFER' && offering.stage !== 'HIRED') {
        const transition = await supabase.rpc('transition_recruitment_candidate', { target_id: offering.id, target_stage: 'OFFER', reason: null });
        if (transition.error) toast('Đã lưu offer nhưng chưa chuyển bước: ' + describeDbError(transition.error), 'warning');
      }
      toast('Đã lưu thông tin thông báo kết quả / offer.', 'success'); setOffering(null); await load();
    }
    setSaving(false);
  };

  const saveHandoff = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!handingOff) return;
    setSaving(true);
    const { error } = await supabase.rpc('handoff_hired_candidate', {
      target_candidate: handingOff.id, target_start_date: handoffForm.planned_start_date, target_note: handoffForm.note.trim() || null,
    });
    if (error) toast('Không bàn giao được onboarding: ' + describeDbError(error), 'error');
    else { toast('Đã bàn giao hồ sơ sang quy trình onboarding.', 'success'); setHandingOff(null); await load(); }
    setSaving(false);
  };

  return <div className="space-y-5">
    <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
      <div>
        <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-indigo-600"><UserRoundCheck className="h-4 w-4" />Quản lý tuyển dụng</div>
        <h2 className="font-display text-xl font-bold text-slate-900">Tuyển dụng nội bộ</h2>
        <p className="mt-1 text-sm text-slate-500">Quản lý đề xuất tuyển dụng và hồ sơ ứng viên.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => { setTab('candidates'); setCandidateOpen(true); }} disabled={!canReview || activeRequests.length === 0}><Plus className="h-4 w-4" />Tiếp nhận hồ sơ</Button>
        <Button theme="admin" onClick={() => setRequestOpen(true)}><Plus className="h-4 w-4" />Lập đề xuất tuyển dụng</Button>
      </div>
    </div>

    <div className="grid gap-3 sm:grid-cols-3">
      <Card><CardContent><p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Chờ BGĐ phê duyệt</p><p className="mt-2 text-2xl font-bold text-amber-600">{requests.filter((item) => item.status === 'SUBMITTED').length}</p></CardContent></Card>
      <Card><CardContent><p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Đang tuyển</p><p className="mt-2 text-2xl font-bold text-emerald-600">{requests.filter((item) => item.status === 'OPEN').length}</p></CardContent></Card>
      <Card><CardContent><p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Ứng viên trong pipeline</p><p className="mt-2 text-2xl font-bold text-indigo-600">{candidates.filter((item) => !['HIRED', 'REJECTED', 'WITHDRAWN'].includes(item.stage)).length}</p></CardContent></Card>
    </div>

    <Card><CardContent>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="inline-flex rounded-xl bg-slate-100 p-1">
          <button onClick={() => setTab('requests')} className={`rounded-lg px-4 py-2 text-sm font-semibold ${tab === 'requests' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>Đề xuất tuyển dụng ({requests.length})</button>
          <button onClick={() => setTab('candidates')} className={`rounded-lg px-4 py-2 text-sm font-semibold ${tab === 'candidates' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>Ứng viên ({candidates.length})</button>
        </div>
        <div className="relative w-full sm:w-72"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Tìm mã, vị trí, ứng viên..." className="w-full rounded-xl border border-slate-200 py-2.5 pl-9 pr-3 text-sm outline-none focus:border-indigo-400" /></div>
      </div>
    </CardContent></Card>

    {loading ? <Card><CardContent><p className="py-12 text-center text-sm text-slate-400">Đang tải quy trình tuyển dụng...</p></CardContent></Card>
      : loadError ? <Card><CardContent><div className="flex gap-3 rounded-xl bg-amber-50 p-4 text-sm text-amber-800"><AlertTriangle className="h-5 w-5 shrink-0" /><div><p className="font-bold">Chưa thể đọc dữ liệu tuyển dụng</p><p className="mt-1">{loadError}</p><p className="mt-2 text-xs">Cần chạy hai migration <strong>20260919120000_internal_recruitment_flow.sql</strong> và <strong>20260919130000_recruitment_interview_offer_handoff.sql</strong> trên Supabase.</p></div></div></CardContent></Card>
      : tab === 'requests' ? (
        filteredRequests.length === 0 ? <Card><EmptyState icon={<UsersRound className="h-8 w-8" />} title="Chưa có đề xuất tuyển dụng" description="Trưởng bộ phận lập đề xuất; HR tiếp nhận và trình Ban Giám đốc trong 24 giờ." action={<Button theme="admin" onClick={() => setRequestOpen(true)}><Plus className="h-4 w-4" />Lập đề xuất</Button>} /></Card>
          : <div className="grid gap-4 xl:grid-cols-2">{filteredRequests.map((item) => {
            const deadline = item.status === 'SUBMITTED' ? deadlineText(item.review_due_at) : null;
            return <Card key={item.id}><CardContent>
              <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-bold text-indigo-600">{item.code}</p><h3 className="mt-1 font-display text-base font-bold text-slate-900">{item.title}</h3><p className="mt-1 text-xs text-slate-500">{unitNames.get(item.unit_id || '') || 'Chưa chọn đơn vị'} · {positionNames.get(item.position_id || '') || 'Chưa gắn vị trí'}</p></div><Badge className={requestStatus[item.status].color}>{requestStatus[item.status].label}</Badge></div>
              <div className="mt-4 grid grid-cols-2 gap-3 rounded-xl bg-slate-50 p-3 text-xs"><div><span className="text-slate-400">Số lượng</span><p className="mt-1 font-bold text-slate-700">{item.headcount} người</p></div><div><span className="text-slate-400">Quản lý tuyển</span><p className="mt-1 font-bold text-slate-700">{names.get(item.hiring_manager_id) || '—'}</p></div><div><span className="text-slate-400">Khoảng lương</span><p className="mt-1 font-bold text-slate-700">{money(item.salary_min)} – {money(item.salary_max)}</p></div><div><span className="text-slate-400">Ứng viên</span><p className="mt-1 font-bold text-slate-700">{candidateCounts.get(item.id) || 0} hồ sơ</p></div></div>
              <p className="mt-3 line-clamp-2 text-sm text-slate-600">{item.reason}</p>
              {item.review_note && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700"><strong>Phản hồi:</strong> {item.review_note}</p>}
              <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-4">
                {deadline ? <span className={`flex items-center gap-1.5 text-xs font-semibold ${deadline.overdue ? 'text-red-600' : 'text-amber-600'}`}><Clock3 className="h-4 w-4" />{deadline.text} để HR trình BGĐ</span> : <span className="text-xs text-slate-400">Đề xuất bởi {names.get(item.requested_by) || 'người dùng'}</span>}
                <div className="flex gap-2">{canReview && item.status === 'SUBMITTED' && <Button theme="admin" onClick={() => { setReviewing(item); setReviewNote(''); }}>Trình / ghi nhận duyệt</Button>}{canReview && item.status === 'APPROVED' && <Button theme="admin" onClick={() => setRequestStatus(item, 'OPEN')}><ArrowRight className="h-4 w-4" />Triển khai tuyển dụng</Button>}{canReview && item.status === 'OPEN' && <Button variant="secondary" onClick={() => setRequestStatus(item, 'CLOSED')}><CheckCircle2 className="h-4 w-4" />Hoàn tất</Button>}{canReview && !['CLOSED', 'CANCELLED'].includes(item.status) && <Button variant="danger" onClick={() => void removeRequest(item)} aria-label={`Xóa hoặc hủy ${item.code}`}><Trash2 className="h-4 w-4" /></Button>}</div>
              </div>
            </CardContent></Card>;
          })}</div>
      ) : (
        filteredCandidates.length === 0 ? <Card><EmptyState icon={<UserRoundCheck className="h-8 w-8" />} title="Chưa có ứng viên" description="HR tiếp nhận hồ sơ sau khi đề xuất đã được phê duyệt và chuyển sang triển khai tuyển dụng." /></Card>
          : <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">{filteredCandidates.map((candidate) => {
            const request = requests.find((item) => item.id === candidate.requisition_id);
            const testDeadline = candidate.stage === 'TEST' ? deadlineText(candidate.test_due_at) : null;
            const candidateInterviews = interviews.filter((item) => item.candidate_id === candidate.id);
            const offer = offers.find((item) => item.candidate_id === candidate.id);
            const handoff = handoffs.find((item) => item.candidate_id === candidate.id);
            return <Card key={candidate.id}><CardContent>
              <div className="flex items-start justify-between gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-full bg-indigo-50 font-bold text-indigo-700">{candidate.full_name.slice(0, 1).toUpperCase()}</div><Badge className="bg-indigo-50 text-indigo-700">{stageLabel[candidate.stage]}</Badge></div>
              <h3 className="mt-3 font-bold text-slate-900">{candidate.full_name}</h3><p className="mt-1 text-xs text-slate-500">{request?.code || '—'} · {request?.title || 'Yêu cầu không còn tồn tại'}</p>
              <div className="mt-3 space-y-1 text-xs text-slate-500"><p>{candidate.email || 'Chưa có email'}</p><p>{candidate.phone || 'Chưa có số điện thoại'}{candidate.source ? ` · Nguồn: ${candidate.source}` : ''}</p></div>
              {testDeadline && <p className={`mt-3 flex items-center gap-1 text-xs font-semibold ${testDeadline.overdue ? 'text-red-600' : 'text-amber-600'}`}><Clock3 className="h-4 w-4" />{testDeadline.text} để hoàn thành bài test</p>}
              {candidate.rejection_reason && <p className="mt-3 rounded-lg bg-red-50 p-2 text-xs text-red-700">{candidate.rejection_reason}</p>}
              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                {candidateInterviews.map((item) => <span key={item.id} className="rounded-lg bg-blue-50 px-2 py-1 font-semibold text-blue-700">PV vòng {item.round}: {item.status === 'COMPLETED' ? (item.recommendation === 'PASS' ? 'Đạt' : item.recommendation === 'FAIL' ? 'Không đạt' : 'Cân nhắc') : new Date(item.scheduled_at).toLocaleString('vi-VN')}</span>)}
                {offer && <span className="rounded-lg bg-violet-50 px-2 py-1 font-semibold text-violet-700">Offer: {offer.status === 'ACCEPTED' ? 'Đã nhận' : offer.status === 'DECLINED' ? 'Từ chối' : offer.status === 'SENT' ? 'Đã gửi' : 'Bản nháp'}</span>}
                {handoff && <span className="rounded-lg bg-emerald-50 px-2 py-1 font-semibold text-emerald-700">Onboarding: đã bàn giao</span>}
              </div>
              {canReview && <Select label="Giai đoạn xử lý" value={candidate.stage} onChange={(e) => void updateStage(candidate, e.target.value as CandidateStage)} className="mt-4">{stages.map((stage) => <option key={stage} value={stage}>{stageLabel[stage]}</option>)}</Select>}
              {canReview && <div className="mt-3 grid grid-cols-2 gap-2"><Button variant="secondary" onClick={() => openInterview(candidate)}><CalendarClock className="h-4 w-4" />Phỏng vấn / đánh giá</Button><Button variant="secondary" onClick={() => openOffer(candidate)}><FileCheck2 className="h-4 w-4" />Thông báo / Offer</Button>{candidate.stage === 'HIRED' && !handoff && <Button theme="admin" className="col-span-2" onClick={() => { setHandingOff(candidate); setHandoffForm({ planned_start_date: offer?.start_date || '', note: '' }); }}><Handshake className="h-4 w-4" />Bàn giao onboarding</Button>}{!['HIRED', 'REJECTED', 'WITHDRAWN'].includes(candidate.stage) && <Button variant="danger" className="col-span-2" onClick={() => void removeCandidate(candidate)}><Trash2 className="h-4 w-4" />Xóa / ghi nhận rút</Button>}</div>}
            </CardContent></Card>;
          })}</div>
      )}

    <Modal open={requestOpen} onClose={() => setRequestOpen(false)} title="Lập đề xuất tuyển dụng" size="lg"><form onSubmit={createRequest} className="space-y-4"><Input label="Vị trí cần tuyển" value={requestForm.title} onChange={(e) => setRequestForm({ ...requestForm, title: e.target.value })} required /><div className="grid gap-3 sm:grid-cols-2"><Select label="Đơn vị" value={requestForm.unit_id} onChange={(e) => setRequestForm({ ...requestForm, unit_id: e.target.value })}><option value="">Chọn đơn vị</option>{units.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select><Select label="Vị trí trong cơ cấu" value={requestForm.position_id} onChange={(e) => setRequestForm({ ...requestForm, position_id: e.target.value })}><option value="">Chọn vị trí</option>{positions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></div><div className="grid gap-3 sm:grid-cols-3"><Input label="Số lượng" type="number" min="1" value={requestForm.headcount} onChange={(e) => setRequestForm({ ...requestForm, headcount: e.target.value })} required /><Select label="Hình thức" value={requestForm.employment_type} onChange={(e) => setRequestForm({ ...requestForm, employment_type: e.target.value })}><option value="FULL_TIME">Toàn thời gian</option><option value="PART_TIME">Bán thời gian</option><option value="CONTRACT">Hợp đồng</option><option value="INTERN">Thực tập</option></Select><Input label="Ngày mong muốn" type="date" value={requestForm.desired_start_date} onChange={(e) => setRequestForm({ ...requestForm, desired_start_date: e.target.value })} /></div><div className="grid gap-3 sm:grid-cols-2"><Input label="Lương tối thiểu" type="number" min="0" value={requestForm.salary_min} onChange={(e) => setRequestForm({ ...requestForm, salary_min: e.target.value })} /><Input label="Lương tối đa" type="number" min="0" value={requestForm.salary_max} onChange={(e) => setRequestForm({ ...requestForm, salary_max: e.target.value })} /></div><Textarea label="Lý do và yêu cầu tuyển" value={requestForm.reason} onChange={(e) => setRequestForm({ ...requestForm, reason: e.target.value })} required /><p className="rounded-xl bg-indigo-50 p-3 text-xs text-indigo-700">Sau khi gửi, HR tiếp nhận đề xuất và trình Ban Giám đốc xem xét, phê duyệt trong thời hạn 24 giờ.</p><div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setRequestOpen(false)}>Hủy</Button><Button type="submit" theme="admin" disabled={saving}>{saving ? 'Đang gửi...' : 'Gửi đề xuất'}</Button></div></form></Modal>

    <Modal open={!!reviewing} onClose={() => setReviewing(null)} title="Trình và ghi nhận phê duyệt"><div className="space-y-4"><p className="rounded-xl bg-indigo-50 p-3 text-xs leading-relaxed text-indigo-700">HR kiểm tra đề xuất, trình Ban Giám đốc và ghi nhận kết quả phê duyệt tại đây.</p><div className="rounded-xl bg-slate-50 p-3"><p className="text-xs font-bold text-indigo-600">{reviewing?.code}</p><p className="mt-1 font-bold text-slate-900">{reviewing?.title}</p><p className="mt-1 text-sm text-slate-500">{reviewing?.headcount} người · {reviewing?.reason}</p></div><Textarea label="Ý kiến của Ban Giám đốc (bắt buộc khi từ chối)" value={reviewNote} onChange={(e) => setReviewNote(e.target.value)} /><div className="flex justify-end gap-2"><Button variant="danger" onClick={() => void reviewRequest('REJECTED')} disabled={saving}><XCircle className="h-4 w-4" />Không phê duyệt</Button><Button theme="admin" onClick={() => void reviewRequest('APPROVED')} disabled={saving}><CheckCircle2 className="h-4 w-4" />Ghi nhận phê duyệt</Button></div></div></Modal>

    <Modal open={candidateOpen} onClose={() => setCandidateOpen(false)} title="Tiếp nhận hồ sơ ứng viên"><form onSubmit={createCandidate} className="space-y-4"><Select label="Đợt tuyển dụng" value={candidateForm.requisition_id} onChange={(e) => setCandidateForm({ ...candidateForm, requisition_id: e.target.value })} required><option value="">Chọn đợt đang triển khai tuyển dụng</option>{activeRequests.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.title}</option>)}</Select><Input label="Họ tên ứng viên" value={candidateForm.full_name} onChange={(e) => setCandidateForm({ ...candidateForm, full_name: e.target.value })} required /><div className="grid gap-3 sm:grid-cols-2"><Input label="Email" type="email" value={candidateForm.email} onChange={(e) => setCandidateForm({ ...candidateForm, email: e.target.value })} /><Input label="Số điện thoại" value={candidateForm.phone} onChange={(e) => setCandidateForm({ ...candidateForm, phone: e.target.value })} /></div><Input label="Nguồn ứng viên" value={candidateForm.source} onChange={(e) => setCandidateForm({ ...candidateForm, source: e.target.value })} placeholder="Website, giới thiệu, mạng xã hội..." /><label className="flex items-start gap-3 rounded-xl bg-slate-50 p-3 text-sm text-slate-600"><input type="checkbox" checked={candidateForm.consent} onChange={(e) => setCandidateForm({ ...candidateForm, consent: e.target.checked })} className="mt-0.5 h-4 w-4" /><span>Đã thông báo và được ứng viên đồng ý cho lưu thông tin phục vụ tuyển dụng.</span></label><div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setCandidateOpen(false)}>Hủy</Button><Button type="submit" theme="admin" disabled={saving}>{saving ? 'Đang lưu...' : 'Tiếp nhận hồ sơ'}</Button></div></form></Modal>

    <Modal open={!!interviewing} onClose={() => setInterviewing(null)} title="Phỏng vấn và đánh giá ứng viên" size="lg"><form onSubmit={saveInterview} className="space-y-4"><p className="text-sm text-slate-500">HR phối hợp với bộ phận chuyên môn đánh giá <strong className="text-slate-800">{interviewing?.full_name}</strong>. Kết quả là căn cứ để xác định và thông báo kết quả tuyển dụng.</p><div className="grid gap-3 sm:grid-cols-2"><Select label="Vòng phỏng vấn" value={interviewForm.round} onChange={(e) => setInterviewForm({ ...interviewForm, round: e.target.value })}><option value="1">Vòng 1 · Bộ phận chuyên môn</option><option value="2">Vòng 2 · BGĐ/vị trí quan trọng</option></Select><Input label="Thời gian" type="datetime-local" value={interviewForm.scheduled_at} onChange={(e) => setInterviewForm({ ...interviewForm, scheduled_at: e.target.value })} required /></div><div className="grid gap-3 sm:grid-cols-2"><Select label="Người phỏng vấn" value={interviewForm.interviewer_id} onChange={(e) => setInterviewForm({ ...interviewForm, interviewer_id: e.target.value })}><option value="">Chưa phân công</option>{people.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select><Select label="Hình thức" value={interviewForm.mode} onChange={(e) => setInterviewForm({ ...interviewForm, mode: e.target.value })}><option value="OFFLINE">Trực tiếp</option><option value="ONLINE">Trực tuyến</option><option value="PHONE">Điện thoại</option></Select></div><Input label="Địa điểm hoặc liên kết" value={interviewForm.location_or_link} onChange={(e) => setInterviewForm({ ...interviewForm, location_or_link: e.target.value })} /><div className="grid gap-3 sm:grid-cols-2"><Input label="Điểm (0–100)" type="number" min="0" max="100" value={interviewForm.score} onChange={(e) => setInterviewForm({ ...interviewForm, score: e.target.value })} /><Select label="Kết quả đánh giá" value={interviewForm.recommendation} onChange={(e) => setInterviewForm({ ...interviewForm, recommendation: e.target.value })}><option value="">Chưa có kết quả</option><option value="PASS">Đạt</option><option value="HOLD">Cân nhắc</option><option value="FAIL">Không đạt</option></Select></div><Textarea label="Nhận xét / minh chứng" value={interviewForm.feedback} onChange={(e) => setInterviewForm({ ...interviewForm, feedback: e.target.value })} /><div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setInterviewing(null)}>Hủy</Button><Button type="submit" theme="admin" disabled={saving}>{saving ? 'Đang lưu...' : 'Lưu kết quả đánh giá'}</Button></div></form></Modal>

    <Modal open={!!offering} onClose={() => setOffering(null)} title="Thông báo kết quả / Offer"><form onSubmit={saveOffer} className="space-y-4"><p className="text-sm text-slate-500">HR thông báo kết quả tuyển dụng cho <strong className="text-slate-800">{offering?.full_name}</strong>. Hệ thống chỉ xác nhận trúng tuyển sau khi ứng viên chấp nhận offer.</p><Input label="Mức lương đề xuất" type="number" min="0" value={offerForm.proposed_salary} onChange={(e) => setOfferForm({ ...offerForm, proposed_salary: e.target.value })} required /><Input label="Ngày dự kiến nhận việc" type="date" value={offerForm.start_date} onChange={(e) => setOfferForm({ ...offerForm, start_date: e.target.value })} required /><Select label="Trạng thái thông báo / offer" value={offerForm.status} onChange={(e) => setOfferForm({ ...offerForm, status: e.target.value as Offer['status'] })}><option value="DRAFT">Bản nháp</option><option value="SENT">Đã gửi</option><option value="ACCEPTED">Ứng viên chấp nhận</option><option value="DECLINED">Ứng viên từ chối</option><option value="WITHDRAWN">Thu hồi</option></Select><Textarea label="Ghi chú trao đổi" value={offerForm.note} onChange={(e) => setOfferForm({ ...offerForm, note: e.target.value })} /><div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setOffering(null)}>Hủy</Button><Button type="submit" theme="admin" disabled={saving}>{saving ? 'Đang lưu...' : 'Lưu thông báo kết quả'}</Button></div></form></Modal>

    <Modal open={!!handingOff} onClose={() => setHandingOff(null)} title="Bàn giao sang onboarding"><form onSubmit={saveHandoff} className="space-y-4"><p className="text-sm text-slate-500">Tạo điểm bàn giao có kiểm soát cho <strong className="text-slate-800">{handingOff?.full_name}</strong>. HR tiếp tục tạo tài khoản nhân viên và checklist hội nhập tại module Hội nhập & nghỉ việc.</p><Input label="Ngày dự kiến nhận việc" type="date" value={handoffForm.planned_start_date} onChange={(e) => setHandoffForm({ ...handoffForm, planned_start_date: e.target.value })} required /><Textarea label="Thông tin bàn giao" value={handoffForm.note} onChange={(e) => setHandoffForm({ ...handoffForm, note: e.target.value })} placeholder="Hồ sơ cần bổ sung, thiết bị, mentor dự kiến..." /><div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setHandingOff(null)}>Hủy</Button><Button type="submit" theme="admin" disabled={saving}><Handshake className="h-4 w-4" />{saving ? 'Đang bàn giao...' : 'Bàn giao'}</Button></div></form></Modal>

    <Modal open={!!rejecting} onClose={() => setRejecting(null)} title="Ghi nhận ứng viên không phù hợp"><div className="space-y-4"><p className="text-sm text-slate-500">Lý do được lưu để HR theo dõi chất lượng nguồn tuyển và tránh đánh giá thiếu căn cứ.</p><Textarea label="Lý do" value={rejectionReason} onChange={(e) => setRejectionReason(e.target.value)} required /><div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setRejecting(null)}>Hủy</Button><Button variant="danger" onClick={() => void rejectCandidate()} disabled={saving}>Xác nhận</Button></div></div></Modal>
  </div>;
}
