import { useEffect, useState } from 'react';
import { AttendanceRequestPanel } from '@/components/attendance/AttendanceRequestPanel';
import { Check, X, CalendarOff, TriangleAlert, RotateCcw } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Textarea } from '@/components/ui/Input';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { TableSkeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/contexts/ToastContext';
import { useAuth } from '@/contexts/AuthContext';
import { useRealtimeSync } from '@/hooks/useRealtimeSync';
import { supabase } from '@/lib/supabase';
import { describeDbError } from '@/lib/dbError';
import { LEAVE_TYPE_CONFIG, leaveStatusLabel } from '@/lib/leave';
import { notifyUser } from '@/lib/assignments';
import { LeaveQuotaPanel } from '@/components/LeaveQuotaPanel';
import { formatDate } from '@/lib/utils';
import { hasPermission } from '@/lib/permissions';
import type { LeaveCancellationRequest, LeaveRequest, LeaveStatus } from '@/types';

export function AdminLeave() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const canReviewAttendance = hasPermission(profile, 'attendance');
  const canReviewLeave = hasPermission(profile, 'leave');

  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [cancellations, setCancellations] = useState<LeaveCancellationRequest[]>([]);
  const [cancellationSupported, setCancellationSupported] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<LeaveStatus | 'all'>('pending');
  const [rejectTarget, setRejectTarget] = useState<LeaveRequest | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [cancelRejectTarget, setCancelRejectTarget] = useState<LeaveCancellationRequest | null>(null);
  const [cancelReviewNote, setCancelReviewNote] = useState('');

  /** Một trung tâm cho mọi loại đơn đã có nghiệp vụ xử lý phía sau. */
  const [tab, setTab] = useState<'attendance' | 'requests' | 'cancellations' | 'quota'>(
    canReviewAttendance ? 'attendance' : 'requests',
  );

  useEffect(() => {
    if (tab === 'attendance' && !canReviewAttendance && canReviewLeave) setTab('requests');
    if (tab !== 'attendance' && !canReviewLeave && canReviewAttendance) setTab('attendance');
  }, [tab, canReviewAttendance, canReviewLeave]);

  useEffect(() => {
    loadRequests();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  // Nhân viên gửi đơn xong là hàng chờ duyệt phải hiện ngay, không đợi F5.
  useRealtimeSync(
    [{ table: 'leave_requests' }, { table: 'leave_cancellation_requests' }],
    () => loadRequests(true),
    { channelKey: 'leave-review' },
  );

  const loadRequests = async (silent = false) => {
    if (!silent) setLoading(true);
    // `leave_requests` chỉ có MỘT khóa ngoại tới profiles qua user_id ngoài
    // approved_by, nên vẫn phải chỉ rõ khóa để tránh lỗi PGRST201 như đã gặp ở
    // bảng shifts và attendance.
    let query = supabase
      .from('leave_requests')
      .select('*, profile:profiles!user_id(*)')
      .order('created_at', { ascending: false });

    if (filter !== 'all') query = query.eq('status', filter);

    const { data, error } = await query;
    const cancellationResult = await supabase
      .from('leave_cancellation_requests')
      .select('*, leave:leave_requests!leave_request_id(*, profile:profiles!user_id(*))')
      .order('created_at', { ascending: false });
    setLoadError(error ? describeDbError(error) : null);
    setRequests((data || []) as LeaveRequest[]);
    setCancellations(cancellationResult.error ? [] : (cancellationResult.data || []) as unknown as LeaveCancellationRequest[]);
    setCancellationSupported(!cancellationResult.error);
    setLoading(false);
  };

  // Đi qua notifyUser để công tắc "Gửi thông báo tự động" trong Cấu hình có tác dụng.
  const notify = notifyUser;

  const handleApprove = async (request: LeaveRequest) => {
    setBusy(true);
    const { data: updated, error } = await supabase
      .from('leave_requests')
      .update({ status: 'approved', approved_by: profile?.id, approved_at: new Date().toISOString(), reason_reject: null })
      .eq('id', request.id)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle();
    setBusy(false);

    if (error) {
      toast('Duyệt đơn thất bại: ' + describeDbError(error), 'error');
      return;
    }
    if (!updated) {
      toast('Đơn này đã được người khác xử lý. Danh sách sẽ được cập nhật lại.', 'warning');
      loadRequests();
      return;
    }
    await notify(
      request.user_id,
      'Đơn nghỉ phép đã được duyệt',
      `${LEAVE_TYPE_CONFIG[request.leave_type].label} ${formatDate(request.start_date)} → ${formatDate(request.end_date)} (${Number(request.days)} ngày) đã được duyệt.`,
      'leave_approved',
    );
    toast('Đã duyệt đơn nghỉ phép.', 'success');
    loadRequests();
  };

  const handleReject = async () => {
    if (!rejectTarget) return;
    if (!rejectReason.trim()) {
      toast('Vui lòng nhập lý do từ chối — người gửi cần biết vì sao.', 'warning');
      return;
    }

    setBusy(true);
    const { data: updated, error } = await supabase
      .from('leave_requests')
      .update({ status: 'rejected', approved_by: profile?.id, approved_at: new Date().toISOString(), reason_reject: rejectReason.trim() })
      .eq('id', rejectTarget.id)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle();
    setBusy(false);

    if (error) {
      toast('Từ chối đơn thất bại: ' + describeDbError(error), 'error');
      return;
    }
    if (!updated) {
      toast('Đơn này đã được người khác xử lý. Danh sách sẽ được cập nhật lại.', 'warning');
      setRejectTarget(null);
      setRejectReason('');
      loadRequests();
      return;
    }
    await notify(
      rejectTarget.user_id,
      'Đơn nghỉ phép bị từ chối',
      `${LEAVE_TYPE_CONFIG[rejectTarget.leave_type].label} ${formatDate(rejectTarget.start_date)} → ${formatDate(rejectTarget.end_date)} đã bị từ chối. Lý do: ${rejectReason.trim()}`,
      'leave_rejected',
    );
    toast('Đã từ chối đơn nghỉ phép.', 'success');
    setRejectTarget(null);
    setRejectReason('');
    loadRequests();
  };

  const reviewCancellation = async (request: LeaveCancellationRequest, status: 'approved' | 'rejected', note?: string) => {
    setBusy(true);
    const { data, error } = await supabase
      .from('leave_cancellation_requests')
      .update({ status, review_note: note?.trim() || null })
      .eq('id', request.id)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle();
    setBusy(false);
    if (error) {
      toast('Xử lý yêu cầu hủy thất bại: ' + describeDbError(error), 'error');
      return;
    }
    if (!data) {
      toast('Yêu cầu này đã được người khác xử lý.', 'warning');
      loadRequests();
      return;
    }
    await notify(request.requested_by, status === 'approved' ? 'Yêu cầu hủy phép đã được duyệt' : 'Yêu cầu hủy phép không được duyệt', status === 'approved' ? 'Lịch nghỉ đã được hủy và quỹ phép đã được hoàn lại.' : `Lý do: ${note?.trim() || 'Không được chấp thuận.'}`, status === 'approved' ? 'leave_cancellation_approved' : 'leave_cancellation_rejected');
    toast(status === 'approved' ? 'Đã hủy lịch nghỉ và hoàn phép.' : 'Đã từ chối yêu cầu hủy.', 'success');
    setCancelRejectTarget(null);
    setCancelReviewNote('');
    loadRequests();
  };

  const filters: { key: LeaveStatus | 'all'; label: string }[] = [
    { key: 'pending', label: 'Chờ duyệt' },
    { key: 'approved', label: 'Đã duyệt' },
    { key: 'rejected', label: 'Từ chối' },
    { key: 'all', label: 'Tất cả' },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-2xl font-extrabold text-slate-900">Trung tâm đơn từ</h1>
        <p className="mt-1 text-sm text-slate-500">Duyệt tập trung đơn nghỉ phép, đi muộn, về sớm, làm thêm giờ và yêu cầu hủy phép.</p>
      </div>

      <div className="flex max-w-full gap-1 overflow-x-auto p-1 bg-slate-100 rounded-xl w-fit">
        {([
          ...(canReviewAttendance ? [{ key: 'attendance' as const, label: 'Đi muộn · Về sớm · Làm thêm' }] : []),
          ...(canReviewLeave ? [{ key: 'requests' as const, label: 'Nghỉ phép' }] : []),
          ...(canReviewLeave && cancellationSupported ? [{ key: 'cancellations' as const, label: 'Hủy phép' }] : []),
          ...(canReviewLeave ? [{ key: 'quota' as const, label: 'Quỹ phép' }] : []),
        ] as const).map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`h-9 shrink-0 px-4 rounded-lg text-sm font-medium transition-colors ${
              tab === t.key ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'attendance' ? (
        <AttendanceRequestPanel mode="review" />
      ) : tab === 'quota' ? (
        <LeaveQuotaPanel />
      ) : tab === 'cancellations' ? (
        <Card>
          <CardContent className="p-0">
            {cancellations.length === 0 ? (
              <EmptyState icon={<RotateCcw className="h-8 w-8" />} title="Không có yêu cầu hủy" description="Yêu cầu hủy đơn đã duyệt sẽ xuất hiện tại đây." />
            ) : (
              <div className="divide-y divide-slate-50">
                {cancellations.map((item) => (
                  <div key={item.id} className="flex flex-wrap items-center gap-3 px-5 py-4">
                    <Avatar name={item.leave?.profile?.name || ''} url={item.leave?.profile?.avatar_url} size="sm" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-slate-800">{item.leave?.profile?.name || 'Nhân viên'}</span>
                        <Badge className={item.status === 'pending' ? 'bg-amber-100 text-amber-700' : item.status === 'approved' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}>
                          {item.status === 'pending' ? 'Chờ duyệt' : item.status === 'approved' ? 'Đã duyệt hủy' : 'Đã từ chối'}
                        </Badge>
                      </div>
                      <p className="mt-1 text-sm text-slate-600">{item.leave ? `${formatDate(item.leave.start_date)} → ${formatDate(item.leave.end_date)}` : 'Đơn nghỉ'} · {item.reason}</p>
                      {item.review_note && <p className="mt-1 text-xs text-slate-500">Phản hồi: {item.review_note}</p>}
                    </div>
                    {item.status === 'pending' && (
                      <div className="flex gap-2">
                        <Button size="sm" onClick={() => reviewCancellation(item, 'approved')} disabled={busy}><Check className="h-4 w-4" />Duyệt hủy</Button>
                        <Button size="sm" variant="outline" onClick={() => { setCancelRejectTarget(item); setCancelReviewNote(''); }} disabled={busy}><X className="h-4 w-4" />Từ chối</Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
      <>
      <div className="flex flex-wrap gap-2">
        {filters.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`h-9 px-4 rounded-xl text-sm font-medium transition-colors ${
              filter === f.key
                ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/25'
                : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-5"><TableSkeleton /></div>
          ) : loadError ? (
            <ErrorState message={loadError} onRetry={loadRequests} />
          ) : requests.length === 0 ? (
            <EmptyState
              icon={<CalendarOff className="w-8 h-8" />}
              title="Không có đơn nghỉ phép"
              description="Chưa có đơn nào trong mục này."
            />
          ) : (
            <div className="divide-y divide-slate-50">
              {requests.map((request) => {
                const type = LEAVE_TYPE_CONFIG[request.leave_type];
                const status = leaveStatusLabel(request);
                return (
                  <div key={request.id} className="flex flex-wrap items-center gap-3 px-5 py-4 hover:bg-slate-50/70 transition-colors">
                    <Avatar name={request.profile?.name || ''} url={request.profile?.avatar_url} size="sm" />

                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <span className="text-sm font-medium text-slate-800">{request.profile?.name || '—'}</span>
                        <Badge className={type.color}>{type.label}</Badge>
                        <Badge className={request.is_cancelled ? 'bg-slate-100 text-slate-600' : status.color}>{request.is_cancelled ? 'Đã hủy' : status.label}</Badge>
                        <span className="text-xs font-medium text-slate-500">{Number(request.days)} ngày</span>
                      </div>
                      <p className="text-sm text-slate-600">
                        {formatDate(request.start_date)} → {formatDate(request.end_date)}
                        {request.profile?.department && <span className="text-slate-400"> · {request.profile.department}</span>}
                      </p>
                      {request.reason && <p className="text-xs text-slate-500 mt-0.5">Lý do: {request.reason}</p>}
                      {request.status === 'rejected' && request.reason_reject && (
                        <p className="text-xs text-red-600 mt-1 flex items-start gap-1.5">
                          <TriangleAlert className="w-3.5 h-3.5 flex-shrink-0 mt-px" />
                          Đã từ chối: {request.reason_reject}
                        </p>
                      )}
                    </div>

                    {request.status === 'pending' && (
                      <div className="flex items-center gap-2">
                        <Button size="sm" onClick={() => handleApprove(request)} disabled={busy} theme="admin">
                          <Check className="w-4 h-4" />
                          Duyệt
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setRejectTarget(request)} disabled={busy}>
                          <X className="w-4 h-4" />
                          Từ chối
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
      </>
      )}

      <Modal
        open={!!rejectTarget}
        onClose={() => { setRejectTarget(null); setRejectReason(''); }}
        title={`Từ chối đơn của ${rejectTarget?.profile?.name || ''}`}
      >
        <div className="space-y-4">
          <Textarea
            label="Lý do từ chối"
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            rows={3}
            placeholder="VD: Trùng lịch bàn giao dự án, đề nghị dời sang tuần sau."
          />
          <p className="text-xs text-slate-500 leading-relaxed">
            Lý do sẽ được gửi kèm thông báo cho người xin nghỉ. Bắt buộc nhập — từ chối
            mà không nói rõ vì sao sẽ khiến họ phải hỏi lại.
          </p>
          <div className="flex gap-3 pt-1">
            <Button type="button" variant="outline" onClick={() => { setRejectTarget(null); setRejectReason(''); }} className="flex-1">
              Hủy
            </Button>
            <Button type="button" onClick={handleReject} disabled={busy} className="flex-1">
              {busy ? 'Đang xử lý...' : 'Xác nhận từ chối'}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={!!cancelRejectTarget} onClose={() => { setCancelRejectTarget(null); setCancelReviewNote(''); }} title="Từ chối yêu cầu hủy phép">
        <div className="space-y-4">
          <Textarea label="Lý do từ chối" value={cancelReviewNote} onChange={(e) => setCancelReviewNote(e.target.value)} rows={3} />
          <div className="flex gap-3">
            <Button variant="outline" onClick={() => { setCancelRejectTarget(null); setCancelReviewNote(''); }} className="flex-1">Đóng</Button>
            <Button onClick={() => cancelRejectTarget && reviewCancellation(cancelRejectTarget, 'rejected', cancelReviewNote)} disabled={busy || !cancelReviewNote.trim()} className="flex-1">Xác nhận từ chối</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
