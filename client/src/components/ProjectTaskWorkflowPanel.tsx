import { useCallback, useEffect, useState } from 'react';
import { Check, Clock3, RotateCcw, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Modal } from '@/components/ui/Modal';
import { Textarea } from '@/components/ui/Input';
import { Skeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/contexts/ToastContext';
import { useRealtimeSync } from '@/hooks/useRealtimeSync';
import { describeDbError } from '@/lib/dbError';
import { notifyUser } from '@/lib/assignments';
import { formatDate } from '@/lib/utils';
import { supabase } from '@/lib/supabase';

interface WorkflowRequest {
  id: string;
  task_id: string;
  project_id: string;
  requested_by: string;
  request_type: 'DEADLINE_EXTENSION' | 'COMPLETION';
  previous_due_date: string | null;
  requested_due_date: string | null;
  request_note: string;
  created_at: string;
}

interface WorkflowDetails {
  taskNames: Map<string, string>;
  peopleNames: Map<string, string>;
}

export function ProjectTaskWorkflowPanel({
  projectId,
  canReview,
}: {
  projectId: string;
  canReview: boolean;
}) {
  const { toast } = useToast();
  const [requests, setRequests] = useState<WorkflowRequest[]>([]);
  const [details, setDetails] = useState<WorkflowDetails>({ taskNames: new Map(), peopleNames: new Map() });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reviewTarget, setReviewTarget] = useState<WorkflowRequest | null>(null);
  const [reviewNote, setReviewNote] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    const { data, error } = await supabase
      .from('project_task_requests')
      .select('id,task_id,project_id,requested_by,request_type,previous_due_date,requested_due_date,request_note,created_at')
      .eq('project_id', projectId)
      .eq('status', 'SUBMITTED')
      .order('created_at', { ascending: true });
    if (error) {
      setLoadError(describeDbError(error));
      setLoading(false);
      return;
    }

    const rows = (data || []) as WorkflowRequest[];
    const taskIds = [...new Set(rows.map((row) => row.task_id))];
    const userIds = [...new Set(rows.map((row) => row.requested_by))];
    const [tasksResult, peopleResult] = await Promise.all([
      taskIds.length ? supabase.from('tasks').select('id,title').in('id', taskIds) : Promise.resolve({ data: [], error: null }),
      userIds.length ? supabase.from('profiles_directory').select('id,name').in('id', userIds) : Promise.resolve({ data: [], error: null }),
    ]);
    const detailError = tasksResult.error ?? peopleResult.error;
    setLoadError(detailError ? describeDbError(detailError) : null);
    setRequests(rows);
    setDetails({
      taskNames: new Map((tasksResult.data || []).map((task) => [task.id, task.title])),
      peopleNames: new Map((peopleResult.data || []).map((person) => [person.id, person.name])),
    });
    setLoading(false);
  }, [projectId]);

  useEffect(() => { void load(); }, [load]);
  useRealtimeSync(
    [{ table: 'project_task_requests', filter: `project_id=eq.${projectId}` }],
    () => load(true),
    { channelKey: `project-task-workflow-${projectId}` },
  );

  const review = async (target: WorkflowRequest, decision: 'APPROVED' | 'RETURNED', note = reviewNote) => {
    if (decision === 'RETURNED' && note.trim().length < 3) {
      toast('Nhập lý do trả lại (ít nhất 3 ký tự).', 'warning');
      return;
    }
    setBusy(true);
    const { error } = await supabase.rpc('review_project_task_request', {
      target_request: target.id,
      decision,
      decision_note: note.trim() || null,
    });
    setBusy(false);
    if (error) {
      toast(`Xử lý yêu cầu thất bại: ${describeDbError(error)}`, 'error');
      return;
    }
    toast(decision === 'APPROVED' ? 'Đã duyệt yêu cầu.' : 'Đã trả yêu cầu.', 'success');
    await notifyUser(
      target.requested_by,
      decision === 'APPROVED' ? 'Yêu cầu task đã được duyệt' : 'Yêu cầu task cần chỉnh sửa',
      `${details.taskNames.get(target.task_id) ?? 'Task'}${decision === 'RETURNED' ? ` · ${note.trim()}` : ''}`,
      'project_task_review_result',
    );
    setReviewTarget(null);
    setReviewNote('');
    await load(true);
  };

  if (loading) return <Skeleton className="h-28" />;
  if (loadError) return <Card><CardContent><ErrorState message={loadError} onRetry={() => void load()} /></CardContent></Card>;

  return (
    <>
      <Card>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="flex items-center gap-2 font-semibold text-slate-800">
                <ShieldCheck className="h-4 w-4 text-indigo-600" />
                Yêu cầu task chờ nghiệm thu
              </h3>
              <p className="mt-1 text-xs text-slate-500">Gia hạn deadline và hoàn thành task cần Project lead duyệt.</p>
            </div>
            <Badge className="bg-amber-50 text-amber-700">{requests.length} chờ xử lý</Badge>
          </div>
          {requests.length === 0 ? (
            <EmptyState title="Không có yêu cầu đang chờ" />
          ) : (
            <ul className="divide-y divide-slate-100">
              {requests.map((request) => (
                <li key={request.id} className="flex flex-wrap items-start gap-3 py-3">
                  <Clock3 className="mt-0.5 h-4 w-4 flex-shrink-0 text-slate-400" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-slate-800">
                      {request.request_type === 'DEADLINE_EXTENSION' ? 'Gia hạn deadline' : 'Gửi nghiệm thu'}
                      <span className="font-normal text-slate-500"> · {details.taskNames.get(request.task_id) ?? 'Task'}</span>
                    </p>
                    <p className="text-xs text-slate-500">
                      {details.peopleNames.get(request.requested_by) ?? 'Nhân viên'} · {new Date(request.created_at).toLocaleString('vi-VN')}
                    </p>
                    {request.request_type === 'DEADLINE_EXTENSION' && (
                      <p className="mt-1 text-xs text-slate-600">
                        Hạn: {request.previous_due_date ? formatDate(request.previous_due_date) : '—'}
                        {' → '}{request.requested_due_date ? formatDate(request.requested_due_date) : '—'}
                      </p>
                    )}
                    <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600">{request.request_note}</p>
                  </div>
                  {canReview && (
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => { setReviewTarget(request); setReviewNote(''); }}>
                        <RotateCcw className="h-3.5 w-3.5" /> Trả lại
                      </Button>
                      <Button size="sm" variant="success" onClick={() => void review(request, 'APPROVED', '')}>
                        <Check className="h-3.5 w-3.5" /> Duyệt
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Modal open={!!reviewTarget} onClose={() => setReviewTarget(null)} title="Xử lý yêu cầu task">
        {reviewTarget && (
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              {reviewTarget.request_type === 'DEADLINE_EXTENSION' ? 'Duyệt gia hạn deadline' : 'Nghiệm thu hoàn thành'}
              {' · '}{details.taskNames.get(reviewTarget.task_id) ?? 'Task'}
            </p>
            <Textarea
              label="Ghi chú (bắt buộc nếu trả lại)"
              rows={3}
              value={reviewNote}
              onChange={(event) => setReviewNote(event.target.value)}
              placeholder="Ghi lý do trả lại hoặc góp ý nghiệm thu."
            />
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="outline" onClick={() => setReviewTarget(null)} disabled={busy}>Hủy</Button>
              <Button variant="outline" onClick={() => void review(reviewTarget, 'RETURNED')} disabled={busy || reviewNote.trim().length < 3}>
                <RotateCcw className="h-4 w-4" /> Trả lại
              </Button>
              <Button variant="success" onClick={() => void review(reviewTarget, 'APPROVED', '')} disabled={busy}>
                <Check className="h-4 w-4" /> Duyệt
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
