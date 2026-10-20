import { useEffect, useState, type ReactNode } from 'react';
import { AttendanceRequestPanel } from '@/components/attendance/AttendanceRequestPanel';
import { Check, X, TriangleAlert } from 'lucide-react';
import { Pager, clampPage } from '@/components/payroll/Pager';
import { Dropdown, type DropdownOption } from '@/components/ui/Dropdown';
import { departmentOptions, passesPeopleFilter, personOptions } from '@/lib/peopleFilter';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Textarea } from '@/components/ui/Input';
import { ErrorState } from '@/components/ui/ErrorState';
import { TableSkeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/contexts/ToastContext';
import { useAuth } from '@/contexts/AuthContext';
import { useRealtimeSync } from '@/hooks/useRealtimeSync';
import { supabase } from '@/lib/supabase';
import { describeDbError } from '@/lib/dbError';
import { fetchProfileMap } from '@/lib/profileDirectory';
import { LEAVE_TYPE_CONFIG, leaveStatusLabel } from '@/lib/leave';
import { fetchManagerIds, notifyUser, notifyUsers } from '@/lib/assignments';
import { LeaveQuotaPanel } from '@/components/LeaveQuotaPanel';
import { formatDate } from '@/lib/utils';
import { hasPermission } from '@/lib/permissions';
import type { LeaveCancellationRequest, LeaveRequest, Profile } from '@/types';

/** Nhãn trạng thái / loại đơn — cùng kiểu viên thuốc với các màn Lương & Đãi ngộ. */
function Pill({ className, children }: { className: string; children: ReactNode }) {
  return <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${className}`}>{children}</span>;
}

/** Thanh chọn dạng phân đoạn vuông góc, dùng chung cho tab chính và bộ lọc trạng thái. */
function Segmented<K extends string>({ items, value, onChange, label }: {
  items: ReadonlyArray<{ key: K; label: string }>;
  value: K;
  onChange: (key: K) => void;
  label: string;
}) {
  return (
    <div className="inline-flex max-w-full overflow-x-auto rounded-none bg-slate-100 p-1" role="tablist" aria-label={label}>
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          role="tab"
          aria-selected={value === item.key}
          onClick={() => onChange(item.key)}
          className={`inline-flex shrink-0 items-center gap-1.5 rounded-none px-3 py-1.5 text-sm font-semibold transition ${
            value === item.key ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

const PER_PAGE = 10;
const HEAD_ROW = 'border-b-2 border-[#bf1f2b] dark:border-[#e66a76] bg-[#fdf2f4] dark:bg-[#201114] text-xs font-black uppercase tracking-wider text-[#5c0f16] dark:text-[#fde8ea] shadow-[inset_0_-2px_0_#bf1f2b] dark:shadow-[inset_0_-2px_0_#e66a76]';
const COL = 'border-l border-[#eed5d8] dark:border-[#4a1c22]';

const CANCEL_STATUS: Record<string, { label: string; color: string }> = {
  pending: { label: 'Chờ duyệt', color: 'bg-amber-50 text-amber-700' },
  approved: { label: 'Đã duyệt hủy', color: 'bg-emerald-50 text-emerald-700' },
  rejected: { label: 'Đã từ chối', color: 'bg-red-50 text-red-700' },
};

/** Bộ lọc trạng thái kiểu gạch chân — khác thanh phân đoạn của nhóm đơn ở trên để không lẫn hai cấp lọc. */
function StatusTabs<K extends string>({ items, value, onChange, label }: {
  items: ReadonlyArray<{ key: K; label: string }>;
  value: K;
  onChange: (key: K) => void;
  label: string;
}) {
  return (
    <div className="flex gap-5 overflow-x-auto border-b border-slate-200" role="tablist" aria-label={label}>
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          role="tab"
          aria-selected={value === item.key}
          onClick={() => onChange(item.key)}
          className={`-mb-px shrink-0 border-b-2 px-0.5 pb-2.5 text-sm font-semibold transition ${
            value === item.key
              ? 'border-indigo-600 text-indigo-700'
              : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700'
          }`}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

/** Một ô lọc dạng Dropdown có ô gõ để tìm — cùng kiểu bộ lọc phòng ban ở Bảng lương tháng. */
function FilterSelect({ label, value, options, onChange }: {
  label: string;
  value: string;
  options: readonly DropdownOption[];
  onChange: (value: string) => void;
}) {
  return (
    <div className="w-full sm:w-60">
      <Dropdown aria-label={label} searchable value={value} options={options} onChange={onChange} />
    </div>
  );
}

function PersonCell({ person, fallback }: { person?: Profile | null; fallback: string }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-xs font-bold text-slate-800 dark:text-slate-100">{person?.name || fallback}</p>
      {person?.department && <p className="truncate text-[10px] text-slate-400">{person.department}</p>}
    </div>
  );
}

export function AdminLeave() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const canReviewAttendance = hasPermission(profile, 'attendance');
  const canReviewHr = hasPermission(profile, 'users');
  const canReviewLeave = hasPermission(profile, 'leave') || canReviewHr;
  const canManageLeave = hasPermission(profile, 'leave');

  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [cancellations, setCancellations] = useState<LeaveCancellationRequest[]>([]);
  const [cancellationSupported, setCancellationSupported] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  type LeaveFilterKey = 'pending' | 'pending_manager' | 'pending_hr' | 'approved' | 'rejected' | 'all';
  const [filter, setFilter] = useState<LeaveFilterKey>('pending');
  const [profileMap, setProfileMap] = useState<Map<string, Profile>>(new Map());
  const [rejectTarget, setRejectTarget] = useState<LeaveRequest | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [cancelRejectTarget, setCancelRejectTarget] = useState<LeaveCancellationRequest | null>(null);
  const [cancelReviewNote, setCancelReviewNote] = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  const [personFilter, setPersonFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [page, setPage] = useState(1);

  /** Một trung tâm cho mọi loại đơn đã có nghiệp vụ xử lý phía sau. */
  const [tab, setTab] = useState<'attendance' | 'requests' | 'cancellations' | 'quota'>(
    canReviewAttendance ? 'attendance' : 'requests',
  );

  useEffect(() => {
    if (tab === 'attendance' && !canReviewAttendance && canReviewLeave) setTab('requests');
    if (tab !== 'attendance' && !canReviewLeave && canReviewAttendance) setTab('attendance');
  }, [tab, canReviewAttendance, canReviewLeave]);

  // Đổi nhóm đơn / trạng thái thì bỏ các ô lọc (danh sách tuỳ chọn đổi theo dữ liệu); đổi bất kỳ ô lọc nào thì về trang đầu.
  useEffect(() => { setDeptFilter(''); setPersonFilter(''); setTypeFilter(''); }, [tab, filter]);
  useEffect(() => { setPage(1); }, [tab, filter, deptFilter, personFilter, typeFilter]);

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
    let query = supabase
      .from('leave_requests')
      .select('*')
      .order('created_at', { ascending: false });

    if (filter === 'pending' || filter === 'pending_manager' || filter === 'pending_hr') {
      query = query.eq('status', 'pending');
    } else if (filter !== 'all') {
      query = query.eq('status', filter);
    }

    const { data, error } = await query;
    const cancellationResult = await supabase
      .from('leave_cancellation_requests')
      .select('*, leave:leave_requests!leave_request_id(*)')
      .order('created_at', { ascending: false });
    setLoadError(error ? describeDbError(error) : null);

    const requestRows = (data || []) as LeaveRequest[];
    const cancelRows = cancellationResult.error
      ? []
      : ((cancellationResult.data || []) as unknown as LeaveCancellationRequest[]);
    const people = await fetchProfileMap([
      ...requestRows.map((row) => row.user_id),
      ...(requestRows.map((row) => row.manager_approved_by).filter(Boolean) as string[]),
      ...(requestRows.map((row) => row.approved_by).filter(Boolean) as string[]),
      ...cancelRows.map((row) => row.leave?.user_id),
    ]);
    setProfileMap(people);

    let filteredRequests = requestRows;
    if (filter === 'pending_manager') {
      filteredRequests = filteredRequests.filter((r) => !r.approval_stage || r.approval_stage === 'MANAGER');
    } else if (filter === 'pending_hr') {
      filteredRequests = filteredRequests.filter((r) => r.approval_stage === 'HR');
    }

    setRequests(filteredRequests.map((row) => ({ ...row, profile: row.profile ?? people.get(row.user_id) })));
    setCancellations(cancelRows.map((row) => (row.leave
      ? { ...row, leave: { ...row.leave, profile: row.leave.profile ?? people.get(row.leave.user_id) } }
      : row)));
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
      .select('id, status, approval_stage')
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

    if (updated.status === 'pending' && updated.approval_stage === 'HR') {
      try {
        const hrApproverIds = await fetchManagerIds('users');
        await notifyUsers(
          hrApproverIds.filter((id) => id !== profile?.id),
          'Đơn nghỉ phép chờ Nhân sự/HR chốt',
          `${LEAVE_TYPE_CONFIG[request.leave_type].label} (${Number(request.days)} ngày) của ${request.profile?.name ?? 'nhân viên'} đã qua duyệt của quản lý trực tiếp.`,
          'leave_approved',
        );
      } catch (notificationError) {
        toast(
          `Đơn đã chuyển sang HR nhưng không gửi được thông báo: ${notificationError instanceof Error ? notificationError.message : String(notificationError)}`,
          'warning',
        );
      }
      await notify(
        request.user_id,
        'Đơn nghỉ phép: Đã qua duyệt quản lý',
        `${LEAVE_TYPE_CONFIG[request.leave_type].label} (${Number(request.days)} ngày) đã được quản lý trực tiếp duyệt và chuyển Nhân sự/HR chốt.`,
        'leave_approved',
      );
      toast('Quản lý trực tiếp đã duyệt. Đơn được chuyển sang Nhân sự/HR chốt.', 'success');
    } else {
      await notify(
        request.user_id,
        'Đơn nghỉ phép đã được phê duyệt',
        `${LEAVE_TYPE_CONFIG[request.leave_type].label} ${formatDate(request.start_date)} → ${formatDate(request.end_date)} (${Number(request.days)} ngày) đã được phê duyệt hoàn tất.`,
        'leave_approved',
      );
      toast('Đã phê duyệt hoàn tất đơn nghỉ phép.', 'success');
    }
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

  const filters: { key: LeaveFilterKey; label: string }[] = [
    { key: 'pending', label: 'Chờ duyệt (Tất cả)' },
    { key: 'pending_manager', label: 'Chờ quản lý (Cấp 1)' },
    { key: 'pending_hr', label: 'Chờ HR (Cấp 2)' },
    { key: 'approved', label: 'Đã duyệt' },
    { key: 'rejected', label: 'Từ chối' },
    { key: 'all', label: 'Tất cả' },
  ];

  const requestPeople = requests.map((request) => request.profile);
  const cancellationPeople = cancellations.map((item) => item.leave?.profile);
  const typeOptions: DropdownOption[] = [
    { value: '', label: 'Tất cả loại nghỉ' },
    ...Object.entries(LEAVE_TYPE_CONFIG).map(([value, config]) => ({ value, label: config.label })),
  ];

  const visibleRequests = requests.filter((request) =>
    passesPeopleFilter(request.profile, request.user_id, deptFilter, personFilter)
    && (!typeFilter || request.leave_type === typeFilter));
  const visibleCancellations = cancellations.filter((item) =>
    passesPeopleFilter(item.leave?.profile, item.leave?.user_id, deptFilter, personFilter));

  const requestPage = clampPage(page, visibleRequests.length, PER_PAGE);
  const cancelPage = clampPage(page, visibleCancellations.length, PER_PAGE);
  const pagedRequests = visibleRequests.slice((requestPage - 1) * PER_PAGE, requestPage * PER_PAGE);
  const pagedCancellations = visibleCancellations.slice((cancelPage - 1) * PER_PAGE, cancelPage * PER_PAGE);

  return (
    <div className="space-y-4">
      <Segmented
        label="Nhóm đơn"
        value={tab}
        onChange={setTab}
        items={[
          ...(canReviewAttendance ? [{ key: 'attendance' as const, label: 'Đi muộn · Về sớm · Làm thêm' }] : []),
          ...(canReviewLeave ? [{ key: 'requests' as const, label: 'Nghỉ phép' }] : []),
          ...(canManageLeave && cancellationSupported ? [{ key: 'cancellations' as const, label: 'Hủy phép' }] : []),
          ...(canManageLeave ? [{ key: 'quota' as const, label: 'Quỹ phép' }] : []),
        ]}
      />

      {tab === 'attendance' ? (
        <AttendanceRequestPanel mode="review" square />
      ) : tab === 'quota' ? (
        <LeaveQuotaPanel />
      ) : tab === 'cancellations' ? (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <FilterSelect label="Lọc theo phòng ban" value={deptFilter} options={departmentOptions(cancellationPeople)}
              onChange={(value) => { setDeptFilter(value); setPersonFilter(''); }} />
            <FilterSelect label="Lọc theo nhân sự" value={personFilter} options={personOptions(cancellationPeople, deptFilter)}
              onChange={setPersonFilter} />
          </div>
          <Card className="!rounded-none border-2 border-slate-400 dark:border-slate-600 shadow-sm overflow-hidden">
            <CardContent className="p-0">
              {visibleCancellations.length === 0 ? (
                <p className="px-5 py-10 text-center text-sm font-semibold text-slate-400">
                  {cancellations.length === 0
                    ? 'Không có yêu cầu hủy phép nào. Yêu cầu hủy đơn đã duyệt sẽ xuất hiện tại đây.'
                    : 'Không có yêu cầu nào khớp bộ lọc.'}
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[700px] text-xs border-collapse">
                    <thead>
                      <tr className={HEAD_ROW}>
                        <th className="px-2.5 py-1.5 text-left min-w-[130px]"><div className="min-w-[130px] line-clamp-3">Nhân sự</div></th>
                        <th className={`${COL} px-2 py-1.5 text-left min-w-[130px]`}><div className="min-w-[130px] line-clamp-3">Lịch nghỉ cần hủy</div></th>
                        <th className={`${COL} px-2 py-1.5 text-left min-w-[130px]`}><div className="min-w-[130px] line-clamp-3">Lý do hủy</div></th>
                        <th className={`${COL} px-2 py-1.5 text-center min-w-[90px]`}><div className="min-w-[90px] text-center line-clamp-3">Trạng thái</div></th>
                        <th className={`${COL} px-2 py-1.5 text-center min-w-[90px]`}><div className="min-w-[90px] text-center line-clamp-3">Thao tác</div></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-300 dark:divide-slate-700 bg-white dark:bg-slate-900 font-semibold">
                      {pagedCancellations.map((item) => {
                        const state = CANCEL_STATUS[item.status];
                        return (
                          <tr key={item.id} className="align-top">
                            <td className="px-2.5 py-1.5"><PersonCell person={item.leave?.profile} fallback="Nhân viên" /></td>
                            <td className="px-2 py-1.5 text-xs text-slate-600 dark:text-slate-300">
                              {item.leave ? `${formatDate(item.leave.start_date)} → ${formatDate(item.leave.end_date)}` : 'Đơn nghỉ'}
                            </td>
                            <td className="px-2 py-1.5 text-xs leading-snug text-slate-600 dark:text-slate-300">
                              {item.reason}
                              {item.review_note && <span className="mt-0.5 block text-slate-500">Phản hồi: {item.review_note}</span>}
                            </td>
                            <td className="px-2 py-1.5 text-center"><Pill className={state.color}>{state.label}</Pill></td>
                            <td className="px-2 py-1.5">
                              {item.status === 'pending' ? (
                                <div className="flex justify-center gap-1.5">
                                  <Button size="sm" variant="success" onClick={() => reviewCancellation(item, 'approved')} disabled={busy}><Check className="h-3.5 w-3.5" />Duyệt</Button>
                                  <Button size="sm" variant="danger" onClick={() => { setCancelRejectTarget(item); setCancelReviewNote(''); }} disabled={busy}><X className="h-3.5 w-3.5" />Từ chối</Button>
                                </div>
                              ) : <span className="block text-center text-xs text-slate-300">—</span>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
          <Pager page={cancelPage} total={visibleCancellations.length} size={PER_PAGE} noun="yêu cầu" onPage={setPage} />
        </>
      ) : (
      <>
      <StatusTabs label="Lọc theo trạng thái" value={filter} onChange={setFilter} items={filters} />
      <div className="flex flex-wrap items-center gap-3">
        <FilterSelect label="Lọc theo phòng ban" value={deptFilter} options={departmentOptions(requestPeople)}
          onChange={(value) => { setDeptFilter(value); setPersonFilter(''); }} />
        <FilterSelect label="Lọc theo nhân sự" value={personFilter} options={personOptions(requestPeople, deptFilter)}
          onChange={setPersonFilter} />
        <FilterSelect label="Lọc theo loại nghỉ" value={typeFilter} options={typeOptions} onChange={setTypeFilter} />
      </div>

      <Card className="!rounded-none border-2 border-slate-400 dark:border-slate-600 shadow-sm overflow-hidden">
        <CardContent className="p-0">
          {loading ? (
            <div className="p-5"><TableSkeleton /></div>
          ) : loadError ? (
            <ErrorState message={loadError} onRetry={loadRequests} />
          ) : visibleRequests.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm font-semibold text-slate-400">
              {requests.length === 0 ? 'Không có đơn nghỉ phép nào trong mục này.' : 'Không có đơn nào khớp bộ lọc.'}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-xs border-collapse">
                <thead>
                  <tr className={HEAD_ROW}>
                    <th className="px-2.5 py-1.5 text-left min-w-[130px]"><div className="min-w-[130px] line-clamp-3">Nhân sự</div></th>
                    <th className={`${COL} px-2 py-1.5 text-left min-w-[100px]`}><div className="min-w-[100px] line-clamp-3">Loại nghỉ</div></th>
                    <th className={`${COL} px-2 py-1.5 text-left min-w-[120px]`}><div className="min-w-[120px] line-clamp-3">Thời gian</div></th>
                    <th className={`${COL} px-2 py-1.5 text-center min-w-[60px]`}><div className="min-w-[60px] text-center line-clamp-3">Số ngày</div></th>
                    <th className={`${COL} px-2 py-1.5 text-left min-w-[140px]`}><div className="min-w-[140px] line-clamp-3">Lý do</div></th>
                    <th className={`${COL} px-2 py-1.5 text-left min-w-[110px]`}><div className="min-w-[110px] line-clamp-3">Trạng thái</div></th>
                    <th className={`${COL} px-2 py-1.5 text-center min-w-[90px]`}><div className="min-w-[90px] text-center line-clamp-3">Thao tác</div></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-300 dark:divide-slate-700 bg-white dark:bg-slate-900 font-semibold">
                  {pagedRequests.map((request) => {
                    const type = LEAVE_TYPE_CONFIG[request.leave_type];
                    const status = leaveStatusLabel(request);
                    const managerApprover = request.manager_approved_by ? profileMap.get(request.manager_approved_by) : null;
                    const finalApprover = request.approved_by ? profileMap.get(request.approved_by) : null;
                    const canAct = request.approval_stage === 'HR' ? canReviewHr : hasPermission(profile, 'leave');

                    return (
                      <tr key={request.id} className="align-top">
                        <td className="px-2.5 py-1.5"><PersonCell person={request.profile} fallback="—" /></td>
                        <td className="px-2 py-1.5"><Pill className={type.color}>{type.label}</Pill></td>
                        <td className="whitespace-nowrap px-2 py-1.5 text-xs text-slate-600 dark:text-slate-300">
                          {formatDate(request.start_date)} → {formatDate(request.end_date)}
                        </td>
                        <td className="px-2 py-1.5 text-center text-xs font-bold tabular-nums text-slate-700 dark:text-slate-200">{Number(request.days)}</td>
                        <td className="max-w-[200px] px-2 py-1.5 text-xs leading-snug text-slate-600 dark:text-slate-300">
                          {request.reason || <span className="text-slate-300">—</span>}
                          {request.status === 'rejected' && request.reason_reject && (
                            <span className="mt-1 flex items-start gap-1 text-red-600">
                              <TriangleAlert className="mt-px h-3 w-3 flex-shrink-0" />
                              Đã từ chối: {request.reason_reject}
                            </span>
                          )}
                        </td>
                        <td className="px-2 py-1.5 text-xs">
                          <Pill className={request.is_cancelled ? 'bg-slate-100 text-slate-600' : status.color}>
                            {request.is_cancelled ? 'Đã hủy' : status.label}
                          </Pill>
                          {request.approval_stage === 'HR' && (
                            <span className="mt-1 block leading-snug text-[10px] text-indigo-700 dark:text-indigo-400">
                              Cấp 1: <strong>{managerApprover?.name || 'Trưởng BP'}</strong>
                              {request.manager_approved_at ? ` (${formatDate(request.manager_approved_at)})` : ''} · chờ HR chốt
                            </span>
                          )}
                          {request.status === 'approved' && request.manager_approved_by && (
                            <span className="mt-1 block leading-snug text-[10px] text-slate-500">
                              QL {managerApprover?.name || 'quản lý'} → HR {finalApprover?.name || 'Nhân sự'}
                            </span>
                          )}
                        </td>
                        <td className="px-2 py-1.5">
                          {request.status !== 'pending' ? (
                            <span className="block text-center text-xs text-slate-300">—</span>
                          ) : canAct ? (
                            <div className="flex justify-center gap-1.5">
                              <Button size="sm" variant="success" onClick={() => handleApprove(request)} disabled={busy}>
                                <Check className="h-3.5 w-3.5" />
                                {request.approval_stage === 'HR' ? 'HR chốt' : 'Duyệt'}
                              </Button>
                              <Button size="sm" variant="danger" onClick={() => setRejectTarget(request)} disabled={busy}>
                                <X className="h-3.5 w-3.5" />
                                Từ chối
                              </Button>
                            </div>
                          ) : (
                            <div className="flex justify-center">
                              <Button
                                size="sm"
                                variant="outline"
                                disabled
                                title={request.approval_stage === 'HR' ? 'Đơn cần Nhân sự/HR duyệt cấp cuối' : 'Đang chờ quản lý trực tiếp duyệt trước'}
                              >
                                {request.approval_stage === 'HR' ? 'Chờ HR chốt' : 'Chờ quản lý duyệt'}
                              </Button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
      {!loading && !loadError && (
        <Pager page={requestPage} total={visibleRequests.length} size={PER_PAGE} noun="đơn" onPage={setPage} />
      )}
      </>
      )}

      <Modal
        square
        open={!!rejectTarget}
        onClose={() => { setRejectTarget(null); setRejectReason(''); }}
        title={`Từ chối đơn của ${rejectTarget?.profile?.name || ''}`}
      >
        <div className="space-y-4">
          <Textarea
            className="!rounded-none"
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
            <Button type="button" variant="danger" onClick={handleReject} disabled={busy} className="flex-1">
              {busy ? 'Đang xử lý...' : 'Xác nhận từ chối'}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal square open={!!cancelRejectTarget} onClose={() => { setCancelRejectTarget(null); setCancelReviewNote(''); }} title="Từ chối yêu cầu hủy phép">
        <div className="space-y-4">
          <Textarea className="!rounded-none" label="Lý do từ chối" value={cancelReviewNote} onChange={(e) => setCancelReviewNote(e.target.value)} rows={3} />
          <div className="flex gap-3">
            <Button variant="outline" onClick={() => { setCancelRejectTarget(null); setCancelReviewNote(''); }} className="flex-1">Đóng</Button>
            <Button variant="danger" onClick={() => cancelRejectTarget && reviewCancellation(cancelRejectTarget, 'rejected', cancelReviewNote)} disabled={busy || !cancelReviewNote.trim()} className="flex-1">Xác nhận từ chối</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
