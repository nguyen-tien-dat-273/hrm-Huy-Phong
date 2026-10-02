import { useEffect, useState } from 'react';
import { AttendanceRequestPanel } from '@/components/attendance/AttendanceRequestPanel';
import { Plus, CalendarOff, Edit3, Trash2, TriangleAlert, RotateCcw, History, Sparkles } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input, Select, Textarea } from '@/components/ui/Input';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/contexts/ToastContext';
import { useConfirm } from '@/contexts/ConfirmContext';
import { useAuth } from '@/contexts/AuthContext';
import { useRealtimeSync } from '@/hooks/useRealtimeSync';
import { supabase } from '@/lib/supabase';
import { describeDbError } from '@/lib/dbError';
import {
  LEAVE_TYPE_CONFIG, leaveStatusLabel, countWorkingDays, calculateLedgerBalance, defaultLeaveDate,
} from '@/lib/leave';
import { formatDate } from '@/lib/utils';
import { fetchApproverIds, notifyUsers } from '@/lib/assignments';
import type { LeaveCancellationRequest, LeaveLedgerEntry, LeaveRequest, LeaveType } from '@/types';

export function StaffLeave() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const confirm = useConfirm();
  const [section, setSection] = useState<'attendance' | 'leave'>('attendance');

  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [ledger, setLedger] = useState<LeaveLedgerEntry[]>([]);
  const [cancellations, setCancellations] = useState<LeaveCancellationRequest[]>([]);
  const [cancellationSupported, setCancellationSupported] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<LeaveRequest | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<LeaveRequest | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [form, setForm] = useState({
    leave_type: 'annual' as LeaveType,
    start_date: defaultLeaveDate(),
    end_date: defaultLeaveDate(),
    half_day: false,
    reason: '',
  });

  useEffect(() => {
    if (profile) loadRequests();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile]);

  // Admin duyệt hay từ chối đơn thì nhân viên thấy đổi trạng thái ngay.
  useRealtimeSync(
    profile ? [{ table: 'leave_requests', filter: `user_id=eq.${profile.id}` }] : [],
    () => loadRequests(true),
    { enabled: !!profile },
  );

  const loadRequests = async (silent = false) => {
    if (!silent) setLoading(true);
    const [{ data, error }, ledgerResult, cancellationResult] = await Promise.all([
      supabase.from('leave_requests').select('*').eq('user_id', profile?.id).order('start_date', { ascending: false }),
      supabase.from('leave_ledger').select('*').eq('user_id', profile?.id).order('created_at', { ascending: false }),
      supabase.from('leave_cancellation_requests').select('*').eq('requested_by', profile?.id).order('created_at', { ascending: false }),
    ]);

    setLoadError(error ? describeDbError(error) : null);
    setRequests((data || []) as LeaveRequest[]);
    setLedger(ledgerResult.error ? [] : (ledgerResult.data || []) as LeaveLedgerEntry[]);
    setCancellations(cancellationResult.error ? [] : (cancellationResult.data || []) as LeaveCancellationRequest[]);
    setCancellationSupported(!cancellationResult.error);
    setLoading(false);
  };

  const balance = calculateLedgerBalance(ledger, requests, profile?.annual_leave_quota ?? 0);

  // Nghỉ nửa ngày chỉ có nghĩa khi đơn gói gọn trong một ngày.
  const isSingleDay = form.start_date === form.end_date;
  const rawDays = countWorkingDays(form.start_date, form.end_date);
  const requestedDays = isSingleDay && form.half_day ? 0.5 : rawDays;

  const openCreate = () => {
    setEditing(null);
    setForm({
      leave_type: 'annual',
      start_date: defaultLeaveDate(),
      end_date: defaultLeaveDate(),
      half_day: false,
      reason: '',
    });
    setModalOpen(true);
  };

  const openEdit = (request: LeaveRequest) => {
    setEditing(request);
    setForm({
      leave_type: request.leave_type,
      start_date: request.start_date,
      end_date: request.end_date,
      half_day: request.half_day,
      reason: request.reason ?? '',
    });
    setModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (form.end_date < form.start_date) {
      toast('Ngày kết thúc phải sau ngày bắt đầu.', 'warning');
      return;
    }
    if (requestedDays <= 0) {
      toast('Khoảng đã chọn không có ngày làm việc nào — toàn bộ rơi vào cuối tuần.', 'warning');
      return;
    }
    // Chỉ cảnh báo, không chặn: nghỉ vượt quỹ vẫn có thể được duyệt và chuyển
    // thành nghỉ không lương, đó là quyết định của người duyệt.
    if (form.leave_type === 'annual' && requestedDays > balance.remaining) {
      const ok = await confirm({
        title: 'Vượt quá số ngày phép còn lại',
        message: `Bạn còn ${balance.remaining} ngày phép nhưng đang xin ${requestedDays} ngày. Đơn vẫn gửi được, nhưng người duyệt có thể từ chối hoặc chuyển sang nghỉ không lương.`,
        confirmLabel: 'Vẫn gửi đơn',
      });
      if (!ok) return;
    }

    setSubmitting(true);
    // Chặn đơn chồng ngày ngay trước khi ghi. Kiểm tra cả pending và approved
    // để người dùng không vô tình tạo hai yêu cầu cho cùng một khoảng thời gian.
    let overlapQuery = supabase
      .from('leave_requests')
      .select('id, start_date, end_date, status')
      .eq('user_id', profile?.id)
      .in('status', ['pending', 'approved'])
      .lte('start_date', form.end_date)
      .gte('end_date', form.start_date);
    if (editing) overlapQuery = overlapQuery.neq('id', editing.id);
    const { data: overlaps, error: overlapError } = await overlapQuery;
    if (overlapError) {
      setSubmitting(false);
      toast('Không kiểm tra được lịch nghỉ hiện tại: ' + describeDbError(overlapError), 'error');
      return;
    }
    if (((overlaps || []) as LeaveRequest[]).some((request) => !request.is_cancelled)) {
      setSubmitting(false);
      toast('Khoảng ngày này đang trùng với một đơn nghỉ chờ duyệt hoặc đã duyệt.', 'warning');
      return;
    }

    // Giờ làm cố định nên chỉ cần cảnh báo ngày đã có dữ liệu chấm công.
    const { count: attendanceConflicts } = await supabase
      .from('attendance')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', profile?.id)
      .gte('date', form.start_date)
      .lte('date', form.end_date);
    if ((attendanceConflicts ?? 0) > 0) {
      const ok = await confirm({
        title: 'Khoảng nghỉ đã có dữ liệu chấm công',
        message: `Phát hiện ${attendanceConflicts ?? 0} ngày đã chấm công. Bạn vẫn có thể gửi đơn, nhưng quản lý phải xử lý dữ liệu ngày công trước khi duyệt nghỉ.`,
        confirmLabel: 'Vẫn gửi đơn',
      });
      if (!ok) { setSubmitting(false); return; }
    }

    // `days` vẫn gửi lên để giữ tương thích, nhưng DATABASE TỰ TÍNH LẠI cho
    // nhân viên — số thật do trigger quyết định (migration 20260811210000).
    // `half_day` mới là thứ database cần để biết đây là nghỉ nửa ngày.
    const payload = {
      leave_type: form.leave_type,
      start_date: form.start_date,
      end_date: form.end_date,
      days: requestedDays,
      half_day: isSingleDay && form.half_day,
      reason: form.reason.trim() || null,
    };

    const saveResult = editing
      ? await supabase.from('leave_requests').update(payload).eq('id', editing.id).eq('status', 'pending').select('id').maybeSingle()
      : await supabase.from('leave_requests').insert({ ...payload, user_id: profile?.id, status: 'pending' }).select('id').single();
    const { data: saved, error } = saveResult;

    setSubmitting(false);

    if (error) {
      toast((editing ? 'Cập nhật đơn thất bại: ' : 'Gửi đơn thất bại: ') + describeDbError(error), 'error');
      return;
    }
    if (!saved) {
      toast('Đơn đã được quản lý xử lý nên không thể sửa. Danh sách sẽ được cập nhật lại.', 'warning');
      setModalOpen(false);
      loadRequests();
      return;
    }
    // Báo chuông cho người duyệt. Trước đây KHÔNG có bước này: đơn nằm im
    // trong hàng chờ, nhân viên đợi mà quản lý không hề biết có đơn mới —
    // trong khi module giao việc thì báo đầy đủ cả hai chiều.
    const managerIds = await fetchApproverIds('leave');
    await notifyUsers(
      managerIds.filter((id) => id !== profile?.id),
      editing ? 'Đơn nghỉ phép được sửa' : 'Đơn nghỉ phép mới',
      `${profile?.name ?? 'Nhân viên'} xin ${LEAVE_TYPE_CONFIG[form.leave_type].label.toLowerCase()} ` +
        `${requestedDays} ngày (${formatDate(form.start_date)} → ${formatDate(form.end_date)}).`,
      editing ? 'leave_updated' : 'leave_requested',
    );

    toast(editing ? 'Đã cập nhật đơn nghỉ phép.' : 'Đã gửi đơn nghỉ phép, chờ duyệt.', 'success');
    setModalOpen(false);
    loadRequests();
  };

  const handleDelete = async (request: LeaveRequest) => {
    const ok = await confirm({
      title: 'Hủy đơn nghỉ phép?',
      message: `Đơn ${LEAVE_TYPE_CONFIG[request.leave_type].label} ${formatDate(request.start_date)} → ${formatDate(request.end_date)} sẽ bị xóa.`,
      confirmLabel: 'Hủy đơn',
      danger: true,
    });
    if (!ok) return;

    const { data: deleted, error } = await supabase
      .from('leave_requests')
      .delete()
      .eq('id', request.id)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle();
    if (error) {
      toast('Hủy đơn thất bại: ' + describeDbError(error), 'error');
      return;
    }
    if (!deleted) {
      toast('Đơn đã được quản lý xử lý nên không thể hủy.', 'warning');
      loadRequests();
      return;
    }
    toast('Đã hủy đơn nghỉ phép.', 'success');
    loadRequests();
  };

  const handleRequestCancellation = async () => {
    if (!cancelTarget || !cancelReason.trim()) {
      toast('Vui lòng nhập lý do cần hủy phép.', 'warning');
      return;
    }
    setSubmitting(true);
    const { error } = await supabase.from('leave_cancellation_requests').insert({
      leave_request_id: cancelTarget.id,
      requested_by: profile?.id,
      reason: cancelReason.trim(),
      status: 'pending',
    });
    setSubmitting(false);
    if (error) {
      toast('Gửi yêu cầu hủy thất bại: ' + describeDbError(error), 'error');
      return;
    }
    const managerIds = await fetchApproverIds('leave');
    await notifyUsers(
      managerIds.filter((id) => id !== profile?.id),
      'Yêu cầu hủy phép đã duyệt',
      `${profile?.name ?? 'Nhân viên'} đề nghị hủy kỳ nghỉ ${formatDate(cancelTarget.start_date)} → ${formatDate(cancelTarget.end_date)}.`,
      'leave_cancellation_requested',
    );
    toast('Đã gửi yêu cầu hủy, chờ quản lý xử lý.', 'success');
    setCancelTarget(null);
    setCancelReason('');
    loadRequests();
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-2xl font-extrabold text-slate-900">Đơn từ của tôi</h1>
        <p className="mt-1 text-sm text-slate-500">Gửi và theo dõi tất cả yêu cầu cá nhân tại một nơi.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => setSection('attendance')}
          className={`rounded-2xl border p-4 text-left transition-all ${section === 'attendance' ? 'border-blue-300 bg-blue-50 ring-2 ring-blue-100' : 'border-slate-200 bg-white hover:border-slate-300'}`}
        >
          <span className="text-sm font-bold text-slate-900">Đi muộn · Về sớm · Làm thêm</span>
          <span className="mt-1 block text-xs text-slate-500">Báo thời gian phát sinh và theo dõi kết quả duyệt.</span>
        </button>
        <button
          type="button"
          onClick={() => setSection('leave')}
          className={`rounded-2xl border p-4 text-left transition-all ${section === 'leave' ? 'border-emerald-300 bg-emerald-50 ring-2 ring-emerald-100' : 'border-slate-200 bg-white hover:border-slate-300'}`}
        >
          <span className="text-sm font-bold text-slate-900">Nghỉ phép · Hủy phép</span>
          <span className="mt-1 block text-xs text-slate-500">Xem quỹ phép, gửi đơn nghỉ hoặc xin hủy lịch đã duyệt.</span>
        </button>
      </div>

      {section === 'attendance' ? (
        <AttendanceRequestPanel mode="mine" />
      ) : (
      <>

      {/* ---- Quỹ phép năm ------------------------------------------------- */}
      <Card className="overflow-hidden">
        <div className="h-1 bg-gradient-to-r from-emerald-500 via-teal-500 to-cyan-500" />
        <CardContent>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-600"><Sparkles className="h-4 w-4 text-emerald-500" />Quỹ phép năm</p>
              <p className="font-display text-4xl font-extrabold text-slate-800 mt-1">
                {balance.remaining}
                <span className="text-lg font-semibold text-slate-400"> / {balance.quota} ngày</span>
              </p>
              <p className="mt-1 text-xs text-slate-500">Số dư khả dụng sau khi trừ các đơn đã duyệt.</p>
            </div>
            <Button onClick={openCreate}>
              <Plus className="w-4 h-4" />
              Xin nghỉ phép
            </Button>
          </div>

          <div className="mt-5 flex h-3 overflow-hidden rounded-full bg-slate-100 ring-1 ring-inset ring-slate-200/60">
            <div
              className="h-full bg-emerald-500"
              style={{ width: `${balance.quota ? (balance.used / balance.quota) * 100 : 0}%` }}
              title={`Đã dùng ${balance.used} ngày`}
            />
            <div
              className="h-full bg-amber-400"
              style={{ width: `${balance.quota ? (balance.pending / balance.quota) * 100 : 0}%` }}
              title={`Chờ duyệt ${balance.pending} ngày`}
            />
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
            <span className="rounded-xl bg-emerald-50 px-3 py-2 font-medium text-emerald-700"><span className="mb-1 block h-2 w-2 rounded-full bg-emerald-500" />Đã dùng <strong className="block text-base">{balance.used}</strong></span>
            <span className="rounded-xl bg-amber-50 px-3 py-2 font-medium text-amber-700"><span className="mb-1 block h-2 w-2 rounded-full bg-amber-400" />Chờ duyệt <strong className="block text-base">{balance.pending}</strong></span>
            <span className="rounded-xl bg-slate-100 px-3 py-2 font-medium text-slate-600"><span className="mb-1 block h-2 w-2 rounded-full bg-slate-300" />Còn lại <strong className="block text-base">{balance.remaining}</strong></span>
          </div>
          {ledger.length > 0 && (
            <div className="mt-4 border-t border-slate-100 pt-3">
              <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-slate-600"><History className="h-3.5 w-3.5" />Phát sinh gần nhất</p>
              <div className="flex flex-wrap gap-2">
                {ledger.slice(0, 4).map((entry) => (
                  <span key={entry.id} className="rounded-lg bg-slate-50 px-2.5 py-1 text-xs text-slate-600">
                    {entry.note || entry.entry_type}: <strong className={Number(entry.days) > 0 ? 'text-emerald-700' : 'text-red-600'}>{Number(entry.days) > 0 ? '+' : ''}{Number(entry.days)}</strong>
                  </span>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ---- Danh sách đơn ------------------------------------------------- */}
      <Card>
        <CardContent className="p-0">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-4 sm:px-6">
            <div>
              <h2 className="font-display text-lg font-bold text-slate-900">Đơn nghỉ phép</h2>
              <p className="mt-0.5 text-xs text-slate-500">Theo dõi trạng thái duyệt và xử lý yêu cầu.</p>
            </div>
            {!loading && requests.length > 0 && <Badge className="bg-slate-100 text-slate-600">{requests.length} đơn</Badge>}
          </div>
          {loading ? (
            <div className="p-5 space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16" />)}</div>
          ) : loadError ? (
            <ErrorState message={loadError} onRetry={loadRequests} />
          ) : requests.length === 0 ? (
            <EmptyState
              icon={<CalendarOff className="w-8 h-8" />}
              title="Chưa có đơn nghỉ phép"
              description="Gửi đơn xin nghỉ để quản lý duyệt."
              action={<Button onClick={openCreate}><Plus className="w-4 h-4" />Xin nghỉ phép</Button>}
            />
          ) : (
            <div className="divide-y divide-slate-50">
              {requests.map((request) => {
                const type = LEAVE_TYPE_CONFIG[request.leave_type];
                const status = leaveStatusLabel(request);
                const cancellation = cancellations.find((item) => item.leave_request_id === request.id);
                return (
                  <div key={request.id} className="flex flex-wrap items-center gap-3 px-5 py-4 hover:bg-slate-50/70 transition-colors">
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${type.dot}`} />

                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <Badge className={type.color}>{type.label}</Badge>
                        <Badge className={request.is_cancelled ? 'bg-slate-100 text-slate-600' : status.color}>{request.is_cancelled ? 'Đã hủy' : status.label}</Badge>
                        {cancellation?.status === 'pending' && <Badge className="bg-amber-100 text-amber-700">Chờ duyệt hủy</Badge>}
                        {cancellation?.status === 'rejected' && <Badge className="bg-red-100 text-red-700">Không duyệt hủy</Badge>}
                        <span className="text-xs font-medium text-slate-500">{Number(request.days)} ngày</span>
                      </div>
                      <p className="text-sm text-slate-700">
                        {formatDate(request.start_date)} → {formatDate(request.end_date)}
                      </p>
                      {request.reason && <p className="text-xs text-slate-500 mt-0.5">{request.reason}</p>}
                      {request.status === 'rejected' && request.reason_reject && (
                        <p className="text-xs text-red-600 mt-1 flex items-start gap-1.5">
                          <TriangleAlert className="w-3.5 h-3.5 flex-shrink-0 mt-px" />
                          Lý do từ chối: {request.reason_reject}
                        </p>
                      )}
                    </div>

                    {/* Đơn đã duyệt hoặc bị từ chối thì khóa — sửa được sẽ phá vỡ kết quả duyệt. */}
                    {request.status === 'pending' && (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => openEdit(request)}
                          title="Sửa đơn"
                          className="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                        >
                          <Edit3 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(request)}
                          title="Hủy đơn"
                          className="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                    {cancellationSupported && request.status === 'approved' && !request.is_cancelled && (!cancellation || cancellation.status === 'rejected') && (
                      <Button size="sm" variant="outline" onClick={() => { setCancelTarget(request); setCancelReason(''); }}>
                        <RotateCcw className="h-4 w-4" />Yêu cầu hủy
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Modal open={!!cancelTarget} onClose={() => { setCancelTarget(null); setCancelReason(''); }} title="Yêu cầu hủy phép đã duyệt">
        <div className="space-y-4">
          <p className="text-sm text-slate-600">Quản lý cần duyệt yêu cầu này trước khi lịch nghỉ được hủy và số ngày phép được hoàn lại.</p>
          <Textarea label="Lý do hủy" value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} rows={3} placeholder="VD: Kế hoạch công việc thay đổi, tôi đi làm lại bình thường." />
          <div className="flex gap-3">
            <Button variant="outline" onClick={() => { setCancelTarget(null); setCancelReason(''); }} className="flex-1">Đóng</Button>
            <Button onClick={handleRequestCancellation} disabled={submitting} className="flex-1">{submitting ? 'Đang gửi…' : 'Gửi yêu cầu'}</Button>
          </div>
        </div>
      </Modal>

      {/* ---- Form ---------------------------------------------------------- */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Sửa đơn nghỉ phép' : 'Xin nghỉ phép'}>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Select
            label="Loại nghỉ"
            value={form.leave_type}
            onChange={(e) => setForm({ ...form, leave_type: e.target.value as LeaveType })}
          >
            {(Object.keys(LEAVE_TYPE_CONFIG) as LeaveType[]).map((t) => (
              <option key={t} value={t}>
                {LEAVE_TYPE_CONFIG[t].label}
                {!LEAVE_TYPE_CONFIG[t].paid ? ' (không hưởng lương)' : ''}
              </option>
            ))}
          </Select>

          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Từ ngày"
              type="date"
              value={form.start_date}
              onChange={(e) => {
                const start = e.target.value;
                // Kéo ngày kết thúc theo nếu nó trở nên vô lý.
                setForm((f) => ({ ...f, start_date: start, end_date: f.end_date < start ? start : f.end_date }));
              }}
              required
            />
            <Input
              label="Đến ngày"
              type="date"
              value={form.end_date}
              min={form.start_date}
              onChange={(e) => setForm({ ...form, end_date: e.target.value })}
              required
            />
          </div>

          {isSingleDay && (
            <label className="flex items-center gap-2.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={form.half_day}
                onChange={(e) => setForm({ ...form, half_day: e.target.checked })}
                className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm text-slate-600">Chỉ nghỉ nửa ngày</span>
            </label>
          )}

          <div className="flex items-start gap-3 text-slate-600 bg-slate-50 border border-slate-200 rounded-xl p-3.5 text-sm leading-relaxed">
            <CalendarOff className="w-4.5 h-4.5 text-slate-500 flex-shrink-0 mt-0.5" />
            <span>
              Số ngày tính công: <strong className="text-slate-800">{requestedDays}</strong>
              {rawDays > 0 && ' — đã trừ thứ Bảy và Chủ nhật.'}
              <br />
              <span className="text-xs text-slate-500">
                Chưa trừ ngày lễ. Nếu đơn vắt qua dịp lễ, người duyệt sẽ điều chỉnh lại.
              </span>
            </span>
          </div>

          <Textarea
            label="Lý do"
            value={form.reason}
            onChange={(e) => setForm({ ...form, reason: e.target.value })}
            rows={3}
            placeholder="Không bắt buộc, nhưng giúp quản lý duyệt nhanh hơn."
          />

          {/* Chặn sớm ngay trên nút thay vì để bấm rồi mới báo lỗi — cho người
              dùng biết TẠI SAO chưa gửi được. */}
          {requestedDays <= 0 && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              Khoảng đã chọn không có ngày làm việc nào (toàn thứ Bảy/Chủ nhật). Chọn lại ngày để gửi đơn.
            </p>
          )}

          <div className="flex gap-3 pt-2">
            <Button type="button" variant="outline" onClick={() => setModalOpen(false)} className="flex-1">Hủy</Button>
            <Button type="submit" disabled={submitting || requestedDays <= 0} className="flex-1">
              {submitting ? 'Đang gửi...' : editing ? 'Lưu thay đổi' : 'Gửi đơn'}
            </Button>
          </div>
        </form>
      </Modal>
      </>
      )}
    </div>
  );
}
