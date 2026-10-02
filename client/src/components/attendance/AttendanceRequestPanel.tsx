// ============================================================================
// RC4.5 — Gửi và duyệt đơn đi muộn / về sớm / làm thêm giờ.
// ----------------------------------------------------------------------------
// Một component dùng cho cả hai phía, khác nhau ở prop `mode`:
//   'mine'   — nhân viên gửi đơn của chính mình và theo dõi trạng thái
//   'review' — quản lý duyệt đơn của nhân sự trong phạm vi mình quản lý
//
// Gộp làm một vì hai màn dùng CHUNG bảng, chung quy tắc hạn mức và chung cách
// hiển thị trạng thái. Tách đôi sẽ thành hai chỗ phải sửa mỗi lần đổi quy tắc,
// và chúng sẽ lệch nhau.
//
// Hạn mức 3 lần/tháng do DATABASE cưỡng chế. Ở đây chỉ đếm để báo TRƯỚC cho
// người dùng biết còn mấy lượt — không tự quyết định chặn, vì đếm ở client thì
// mở hai tab là lệch.
// ============================================================================

import { useEffect, useMemo, useState } from 'react';
import { CalendarClock, Check, Clock3, Plus, TriangleAlert, X } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { Input, Select, Textarea } from '@/components/ui/Input';
import { Skeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/contexts/ToastContext';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { describeDbError } from '@/lib/dbError';
import { formatDate, getTodayString } from '@/lib/utils';
import { fetchApproverIds, notifyUser, notifyUsers } from '@/lib/assignments';

type RequestType = 'LATE_ARRIVAL' | 'EARLY_LEAVE' | 'OVERTIME';
type RequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

interface AttendanceRequest {
  id: string;
  user_id: string;
  request_type: RequestType;
  work_date: string;
  minutes: number | null;
  hours: number | null;
  reason: string;
  status: RequestStatus;
  review_note: string | null;
}

const TYPE_LABEL: Record<RequestType, string> = {
  LATE_ARRIVAL: 'Đi muộn',
  EARLY_LEAVE: 'Về sớm',
  OVERTIME: 'Làm thêm giờ',
};

const STATUS_STYLE: Record<RequestStatus, { label: string; color: string }> = {
  PENDING: { label: 'Chờ duyệt', color: 'bg-amber-50 text-amber-700' },
  APPROVED: { label: 'Đã duyệt', color: 'bg-emerald-50 text-emerald-700' },
  REJECTED: { label: 'Từ chối', color: 'bg-red-50 text-red-600' },
  CANCELLED: { label: 'Đã huỷ', color: 'bg-slate-100 text-slate-500' },
};

/** Hai loại đơn này tiêu hạn mức tháng; đơn OT thì không. */
const QUOTA_TYPES: RequestType[] = ['LATE_ARRIVAL', 'EARLY_LEAVE'];

export function AttendanceRequestPanel({ mode }: { mode: 'mine' | 'review' }) {
  const { profile, users } = useAuth();
  const { toast } = useToast();

  const [rows, setRows] = useState<AttendanceRequest[]>([]);
  const [quota, setQuota] = useState(3);
  const [loading, setLoading] = useState(true);
  const [supported, setSupported] = useState(true);
  const [busy, setBusy] = useState(false);
  const [formOpen, setFormOpen] = useState(false);

  const [draft, setDraft] = useState({
    request_type: 'LATE_ARRIVAL' as RequestType,
    work_date: getTodayString(),
    minutes: '30',
    hours: '2',
    reason: '',
  });

  const load = async () => {
    if (!supabase || !profile) return;
    setLoading(true);

    let query = supabase.from('attendance_requests').select('*').order('work_date', { ascending: false });
    // RLS đã giới hạn phạm vi theo RC1.2; lọc thêm ở đây chỉ để màn "đơn của
    // tôi" không lẫn đơn của người khác khi người xem là quản lý.
    if (mode === 'mine') query = query.eq('user_id', profile.id);

    const { data, error } = await query.limit(100);
    if (error) {
      // Chưa chạy migration 20260930110000 — nói rõ thay vì hiện bảng trống.
      setSupported(false);
      setLoading(false);
      return;
    }
    setRows((data || []) as AttendanceRequest[]);

    const settings = await supabase.from('payroll_settings').select('late_request_monthly_quota').maybeSingle();
    if (!settings.error && settings.data?.late_request_monthly_quota != null) {
      setQuota(Number(settings.data.late_request_monthly_quota));
    }
    setLoading(false);
  };

  useEffect(() => { void load(); }, [profile?.id, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  const nameOf = (userId: string) =>
    users.find((user) => user.id === userId)?.name ?? 'Nhân sự đã xoá';

  // Đếm số đơn đã dùng trong THÁNG của ngày đang chọn, không phải tháng hiện
  // tại — người dùng hay gửi đơn bù cho ngày cuối tháng trước.
  const usedInMonth = useMemo(() => {
    if (!profile) return 0;
    const month = draft.work_date.slice(0, 7);
    return rows.filter((row) =>
      row.user_id === profile.id
      && QUOTA_TYPES.includes(row.request_type)
      && row.status !== 'REJECTED' && row.status !== 'CANCELLED'
      && row.work_date.startsWith(month),
    ).length;
  }, [rows, profile, draft.work_date]);

  const isOvertime = draft.request_type === 'OVERTIME';

  const submit = async () => {
    if (!supabase || !profile) return;
    if (draft.reason.trim().length < 5) {
      toast('Nhập lý do ít nhất 5 ký tự.', 'warning');
      return;
    }

    setBusy(true);
    const { error } = await supabase.from('attendance_requests').insert({
      user_id: profile.id,
      request_type: draft.request_type,
      work_date: draft.work_date,
      minutes: isOvertime ? null : Number(draft.minutes),
      hours: isOvertime ? Number(draft.hours) : null,
      reason: draft.reason.trim(),
    });
    setBusy(false);

    if (error) return toast(describeDbError(error), 'error');
    const approverIds = await fetchApproverIds('attendance');
    await notifyUsers(
      approverIds.filter((id) => id !== profile.id),
      `Có đơn ${TYPE_LABEL[draft.request_type].toLowerCase()} mới`,
      `${profile.name} gửi đơn cho ngày ${formatDate(draft.work_date)}.`,
      'attendance_request_created',
    );
    toast('Đã gửi đơn.', 'success');
    setFormOpen(false);
    setDraft({ ...draft, reason: '' });
    await load();
  };

  const decide = async (row: AttendanceRequest, status: 'APPROVED' | 'REJECTED') => {
    if (!supabase || !profile) return;
    setBusy(true);
    const { error } = await supabase
      .from('attendance_requests')
      .update({ status, reviewed_by: profile.id, reviewed_at: new Date().toISOString() })
      .eq('id', row.id);
    setBusy(false);
    if (error) return toast(describeDbError(error), 'error');
    await notifyUser(
      row.user_id,
      status === 'APPROVED' ? `Đơn ${TYPE_LABEL[row.request_type].toLowerCase()} đã được duyệt` : `Đơn ${TYPE_LABEL[row.request_type].toLowerCase()} bị từ chối`,
      `${TYPE_LABEL[row.request_type]} ngày ${formatDate(row.work_date)} ${status === 'APPROVED' ? 'đã được chấp thuận.' : 'không được chấp thuận.'}`,
      status === 'APPROVED' ? 'attendance_request_approved' : 'attendance_request_rejected',
    );
    toast(status === 'APPROVED' ? 'Đã duyệt đơn.' : 'Đã từ chối đơn.', 'success');
    await load();
  };

  const cancel = async (row: AttendanceRequest) => {
    if (!supabase) return;
    const { error } = await supabase
      .from('attendance_requests')
      .update({ status: 'CANCELLED' })
      .eq('id', row.id);
    if (error) return toast(describeDbError(error), 'error');
    await load();
  };

  if (!supported) {
    return (
      <Card><CardContent>
        <p className="flex items-start gap-2.5 text-sm leading-relaxed text-amber-800">
          <TriangleAlert className="mt-0.5 h-5 w-5 flex-shrink-0" />
          Chưa chạy migration <code className="rounded bg-amber-50 px-1.5 py-0.5 font-mono text-xs">
            20260930110000_attendance_requests.sql
          </code> nên chưa dùng được đơn đi muộn/về sớm/làm thêm giờ.
        </p>
      </CardContent></Card>
    );
  }

  if (loading) return <Skeleton className="h-40" />;

  const pending = rows.filter((row) => row.status === 'PENDING');
  const visible = mode === 'review' ? [...pending, ...rows.filter((r) => r.status !== 'PENDING')] : rows;

  return (
    <Card>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-slate-800">
              {mode === 'mine' ? 'Đơn đi muộn, về sớm, làm thêm giờ' : 'Đơn từ chờ duyệt'}
            </h3>
            <p className="mt-0.5 text-xs leading-relaxed text-slate-500">
              {mode === 'mine' ? (
                <>
                  Tháng {draft.work_date.slice(5, 7)} đã dùng{' '}
                  <strong className={usedInMonth >= quota ? 'text-red-600' : 'text-slate-700'}>
                    {usedInMonth}/{quota}
                  </strong>{' '}
                  lượt đi muộn/về sớm. Đơn làm thêm giờ không tính vào hạn mức.
                </>
              ) : (
                <>{pending.length} đơn đang chờ bạn duyệt.</>
              )}
            </p>
          </div>
          {mode === 'mine' && (
            <Button size="sm" theme="staff" onClick={() => setFormOpen(true)}>
              <Plus className="h-3.5 w-3.5" /> Gửi đơn
            </Button>
          )}
        </div>

        {visible.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-50 text-slate-300">
              <CalendarClock className="h-5 w-5" />
            </span>
            <p className="text-sm font-semibold text-slate-600">
              {mode === 'mine' ? 'Chưa gửi đơn nào' : 'Không có đơn nào'}
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-slate-50">
            {visible.map((row) => {
              const status = STATUS_STYLE[row.status];
              return (
                <li key={row.id} className="flex flex-wrap items-center gap-3 py-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-50 text-slate-500">
                    <Clock3 className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-slate-800">
                      {mode === 'review' && <span className="text-slate-500">{nameOf(row.user_id)} · </span>}
                      {TYPE_LABEL[row.request_type]}
                      {row.minutes != null && ` ${row.minutes} phút`}
                      {row.hours != null && ` ${Number(row.hours)} giờ`}
                    </p>
                    <p className="truncate text-xs text-slate-500">
                      {formatDate(row.work_date)} · {row.reason}
                    </p>
                  </div>
                  <Badge className={status.color}>{status.label}</Badge>

                  {mode === 'review' && row.status === 'PENDING' && (
                    <div className="flex gap-1">
                      <Button size="sm" variant="success" disabled={busy} onClick={() => void decide(row, 'APPROVED')}>
                        <Check className="h-3.5 w-3.5" /> Duyệt
                      </Button>
                      <Button size="sm" variant="danger" disabled={busy} onClick={() => void decide(row, 'REJECTED')}>
                        <X className="h-3.5 w-3.5" /> Từ chối
                      </Button>
                    </div>
                  )}
                  {mode === 'mine' && row.status === 'PENDING' && (
                    <Button size="sm" variant="ghost" onClick={() => void cancel(row)}>Huỷ</Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>

      <Modal open={formOpen} onClose={() => setFormOpen(false)} title="Gửi đơn" size="md">
        <div className="space-y-4">
          <Select
            label="Loại đơn"
            value={draft.request_type}
            onChange={(e) => setDraft({ ...draft, request_type: e.target.value as RequestType })}
          >
            <option value="LATE_ARRIVAL">Đi muộn</option>
            <option value="EARLY_LEAVE">Về sớm</option>
            <option value="OVERTIME">Làm thêm giờ</option>
          </Select>

          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              label="Ngày"
              type="date"
              value={draft.work_date}
              onChange={(e) => setDraft({ ...draft, work_date: e.target.value })}
            />
            {isOvertime ? (
              <Input
                label="Số giờ làm thêm"
                inputMode="decimal"
                value={draft.hours}
                onChange={(e) => setDraft({ ...draft, hours: e.target.value.replace(/[^\d.]/g, '') })}
              />
            ) : (
              <Input
                label="Số phút"
                inputMode="numeric"
                value={draft.minutes}
                onChange={(e) => setDraft({ ...draft, minutes: e.target.value.replace(/[^\d]/g, '') })}
              />
            )}
          </div>

          {!isOvertime && usedInMonth >= quota && (
            <p className="flex items-start gap-1.5 rounded-lg bg-red-50 px-3 py-2.5 text-xs leading-relaxed text-red-700">
              <TriangleAlert className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
              Tháng {draft.work_date.slice(5, 7)} đã dùng hết {quota} lượt. Đơn này sẽ bị hệ thống
              từ chối khi gửi.
            </p>
          )}

          <Textarea
            label="Lý do"
            value={draft.reason}
            onChange={(e) => setDraft({ ...draft, reason: e.target.value })}
            placeholder="VD: Đưa con đi khám, tắc đường do sự cố…"
          />

          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setFormOpen(false)} disabled={busy}>Hủy</Button>
            <Button theme="staff" onClick={() => void submit()} disabled={busy}>
              {busy ? 'Đang gửi…' : 'Gửi đơn'}
            </Button>
          </div>
        </div>
      </Modal>
    </Card>
  );
}
