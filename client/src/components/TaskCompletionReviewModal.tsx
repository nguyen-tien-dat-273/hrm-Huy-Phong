import { useEffect, useState } from 'react';
import { Check, ExternalLink, FileText, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Textarea } from '@/components/ui/Input';
import { Skeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/contexts/ToastContext';
import { describeDbError } from '@/lib/dbError';
import { notifyUser } from '@/lib/assignments';
import { supabase } from '@/lib/supabase';
import type { Task } from '@/types';

interface CompletionRequest {
  id: string;
  requested_by: string;
  request_note: string;
  evidence_url: string | null;
  evidence_file_path: string | null;
  evidence_file_name: string | null;
  created_at: string;
}

/**
 * F04.05: người kiểm duyệt mở thẻ ở cột "Đang duyệt" để xem báo cáo, minh
 * chứng rồi chọn Đạt (sang Hoàn thành) hoặc Chưa đạt (về Đang làm, lý do
 * ≥ 10 ký tự). Quyền duyệt do DB quyết định qua can_review_project_task_request
 * (chỉ trưởng dự án, không tự duyệt); nút chỉ hiện khi DB trả về true.
 */
export function TaskCompletionReviewModal({
  task,
  requesterName,
  onClose,
  onReviewed,
}: {
  task: Task | null;
  requesterName?: string;
  onClose: () => void;
  onReviewed: () => void;
}) {
  const { toast } = useToast();
  const [request, setRequest] = useState<CompletionRequest | null>(null);
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [canReview, setCanReview] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [returnNote, setReturnNote] = useState('');
  const [returning, setReturning] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!task) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setRequest(null);
    setFileUrl(null);
    setCanReview(false);
    setReturnNote('');
    setReturning(false);
    void (async () => {
      const { data, error } = await supabase
        .from('project_task_requests')
        .select('id,requested_by,request_note,evidence_url,evidence_file_path,evidence_file_name,created_at')
        .eq('task_id', task.id)
        .eq('request_type', 'COMPLETION')
        .eq('status', 'SUBMITTED')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cancelled) return;
      if (error) {
        setLoadError(describeDbError(error));
        setLoading(false);
        return;
      }
      const row = data as CompletionRequest | null;
      setRequest(row);
      if (row) {
        const [{ data: allowed }, signed] = await Promise.all([
          supabase.rpc('can_review_project_task_request', { target_request: row.id }),
          row.evidence_file_path
            ? supabase.storage.from('task-evidence').createSignedUrl(row.evidence_file_path, 300)
            : Promise.resolve({ data: null }),
        ]);
        if (cancelled) return;
        setCanReview(allowed === true);
        setFileUrl(signed.data?.signedUrl ?? null);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [task]);

  const review = async (decision: 'APPROVED' | 'RETURNED') => {
    if (!task || !request) return;
    const note = returnNote.trim();
    if (decision === 'RETURNED' && note.length < 10) {
      toast('Lý do trả lại cần ít nhất 10 ký tự.', 'warning');
      return;
    }
    setBusy(true);
    const { error } = await supabase.rpc('review_project_task_request', {
      target_request: request.id,
      decision,
      decision_note: decision === 'RETURNED' ? note : null,
    });
    setBusy(false);
    if (error) {
      toast(`Xử lý nghiệm thu thất bại: ${describeDbError(error)}`, 'error');
      return;
    }
    toast(decision === 'APPROVED' ? 'Đã nghiệm thu, task chuyển sang Hoàn thành.' : 'Đã trả lại, task về Đang làm.', 'success');
    await notifyUser(
      request.requested_by,
      decision === 'APPROVED' ? 'Task đã được nghiệm thu' : 'Task bị trả lại, cần chỉnh sửa',
      `${task.title}${decision === 'RETURNED' ? ` · ${note}` : ''}`,
      'project_task_review_result',
    );
    onReviewed();
    onClose();
  };

  return (
    <Modal open={!!task} onClose={onClose} title="Nghiệm thu task" size="lg">
      {task && (
        <div className="space-y-4">
          <div>
            <p className="text-base font-semibold text-slate-800">{task.title}</p>
            <p className="text-xs text-slate-500">
              {requesterName ? `${requesterName} · ` : ''}
              {request ? `Nộp lúc ${new Date(request.created_at).toLocaleString('vi-VN')}` : ''}
            </p>
          </div>

          {loading ? (
            <Skeleton className="h-28" />
          ) : loadError ? (
            <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{loadError}</p>
          ) : !request ? (
            <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
              Không tìm thấy báo cáo nghiệm thu đang chờ duyệt cho task này.
            </p>
          ) : (
            <>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="mb-1 text-xs font-semibold uppercase text-slate-500">Báo cáo kết quả</p>
                <p className="whitespace-pre-wrap text-sm text-slate-700">{request.request_note}</p>
              </div>
              <div className="flex flex-col gap-2">
                {request.evidence_url && (
                  <a
                    href={request.evidence_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-10 items-center gap-2 text-sm font-medium text-indigo-700 underline underline-offset-2 hover:text-indigo-900"
                  >
                    <ExternalLink className="h-4 w-4" /> Mở link minh chứng
                  </a>
                )}
                {request.evidence_file_path && (
                  fileUrl ? (
                    <a
                      href={fileUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex min-h-10 items-center gap-2 text-sm font-medium text-indigo-700 underline underline-offset-2 hover:text-indigo-900"
                    >
                      <FileText className="h-4 w-4" /> {request.evidence_file_name || 'File minh chứng'}
                    </a>
                  ) : (
                    <p className="text-sm text-slate-500">Không mở được file minh chứng: {request.evidence_file_name}</p>
                  )
                )}
              </div>

              {!canReview ? (
                <p className="rounded-lg bg-slate-100 p-3 text-sm text-slate-600">
                  Chỉ trưởng dự án mới được nghiệm thu, và không ai tự duyệt task của mình.
                </p>
              ) : returning ? (
                <div className="space-y-3">
                  <Textarea
                    label="Lý do trả lại (ít nhất 10 ký tự)"
                    rows={3}
                    value={returnNote}
                    onChange={(event) => setReturnNote(event.target.value)}
                    placeholder="Nêu rõ phần chưa đạt để nhân viên chỉnh sửa."
                  />
                  <div className="flex flex-wrap justify-end gap-2">
                    <Button variant="outline" onClick={() => setReturning(false)} disabled={busy}>Quay lại</Button>
                    <Button variant="danger" onClick={() => void review('RETURNED')} disabled={busy || returnNote.trim().length < 10}>
                      <RotateCcw className="h-4 w-4" /> Xác nhận trả lại
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap justify-end gap-2">
                  <Button variant="outline" onClick={() => setReturning(true)} disabled={busy}>
                    <RotateCcw className="h-4 w-4" /> Chưa đạt - Trả lại
                  </Button>
                  <Button variant="success" onClick={() => void review('APPROVED')} disabled={busy}>
                    <Check className="h-4 w-4" /> Đạt - Nghiệm thu
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </Modal>
  );
}
