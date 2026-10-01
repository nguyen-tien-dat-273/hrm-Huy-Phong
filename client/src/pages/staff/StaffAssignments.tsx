// ============================================================================
// Việc được giao — trang riêng cho nhân viên.
// ----------------------------------------------------------------------------
// Trước đây toàn bộ việc được giao nằm lẫn trong trang Chấm công. Việc của
// HÔM NAY ở đó là đúng chỗ — mở ra check-in là thấy ngay phải làm gì. Nhưng
// kế hoạch cả tuần và những việc bị trả lại thì không ai nghĩ đến chuyện vào
// trang Chấm công để tìm.
//
// Nên tách: trang Chấm công giữ việc hôm nay, trang này là toàn cảnh.
// ============================================================================

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ClipboardList, Clock, RotateCcw, Send, TriangleAlert } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Modal } from '@/components/ui/Modal';
import { Skeleton } from '@/components/ui/Skeleton';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { useRealtimeSync } from '@/hooks/useRealtimeSync';
import { describeDbError } from '@/lib/dbError';
import { supabase } from '@/lib/supabase';
import { formatDate, getTodayString } from '@/lib/utils';
import type { DailyAssignment } from '@/types';

const STATUS_STYLE: Record<string, { label: string; className: string }> = {
  pending: { label: 'Cần làm', className: 'bg-slate-100 text-slate-700' },
  submitted: { label: 'Chờ xác nhận', className: 'bg-amber-100 text-amber-700' },
  approved: { label: 'Đã xác nhận', className: 'bg-emerald-100 text-emerald-700' },
  rejected: { label: 'Cần làm lại', className: 'bg-red-100 text-red-700' },
};

/** Thứ hai của tuần chứa ngày đang xem. */
function startOfWeek(date: Date): Date {
  const result = new Date(date);
  const weekday = (result.getDay() + 6) % 7;
  result.setDate(result.getDate() - weekday);
  result.setHours(0, 0, 0, 0);
  return result;
}

function toDateString(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function StaffAssignments() {
  const { profile } = useAuth();
  const { toast } = useToast();

  const [assignments, setAssignments] = useState<DailyAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [weekOffset, setWeekOffset] = useState(0);
  const [submitTarget, setSubmitTarget] = useState<DailyAssignment | null>(null);
  const [submitNote, setSubmitNote] = useState('');
  const [sending, setSending] = useState(false);

  const weekStart = useMemo(() => {
    const base = startOfWeek(new Date());
    base.setDate(base.getDate() + weekOffset * 7);
    return base;
  }, [weekOffset]);

  const weekEnd = useMemo(() => {
    const end = new Date(weekStart);
    end.setDate(end.getDate() + 6);
    return end;
  }, [weekStart]);

  const loadData = useCallback(async (silent = false) => {
    if (!profile || !supabase) return;
    if (!silent) setLoading(true);

    // `daily_assignments` co 3 khoa ngoai toi profiles nen phai chi ro khoa
    // khi embed, tranh loi PGRST201.
    const { data, error } = await supabase
      .from('daily_assignments')
      .select('*, assigner:profiles!daily_assignments_assigned_by_fkey(id,name,avatar_url)')
      .eq('user_id', profile.id)
      .gte('work_date', toDateString(weekStart))
      .lte('work_date', toDateString(weekEnd))
      .order('work_date', { ascending: true })
      .order('created_at', { ascending: true });

    if (error) toast(describeDbError(error), 'error');
    setAssignments((data || []) as DailyAssignment[]);
    setLoading(false);
  }, [profile, weekStart, weekEnd, toast]);

  useEffect(() => { void loadData(); }, [loadData]);

  useRealtimeSync(
    profile ? [{ table: 'daily_assignments', filter: `user_id=eq.${profile.id}` }] : [],
    () => loadData(true),
    { enabled: !!profile, channelKey: `staff-assignments-${profile?.id ?? 'anonymous'}` },
  );

  /** Gửi việc cho quản lý xác nhận: pending/rejected → submitted. */
  const handleSubmit = async () => {
    if (!submitTarget || !supabase) return;
    setSending(true);

    // Khoa lac quan: chi doi trang thai neu no VAN la trang thai minh thay.
    // Quan ly vua duyet xong ma minh bam gui thi phai biet, khong ghi de.
    const { data, error } = await supabase
      .from('daily_assignments')
      .update({
        status: 'submitted',
        submitted_at: new Date().toISOString(),
        submit_note: submitNote.trim() || null,
      })
      .eq('id', submitTarget.id)
      .in('status', ['pending', 'rejected'])
      .select();

    setSending(false);
    if (error) return toast('Gửi thất bại: ' + describeDbError(error), 'error');
    if (!data || data.length === 0) {
      toast('Việc này vừa đổi trạng thái. Tải lại để xem tình hình mới.', 'warning');
    } else {
      toast('Đã gửi cho quản lý xác nhận.', 'success');
    }
    setSubmitTarget(null);
    setSubmitNote('');
    await loadData(true);
  };

  /** Thu hồi khi lỡ gửi nhầm — chỉ được khi quản lý chưa duyệt. */
  const handleRecall = async (assignment: DailyAssignment) => {
    if (!supabase) return;
    const { data, error } = await supabase
      .from('daily_assignments')
      .update({ status: 'pending', submitted_at: null, submit_note: null })
      .eq('id', assignment.id)
      .eq('status', 'submitted')
      .select();

    if (error) return toast('Thu hồi thất bại: ' + describeDbError(error), 'error');
    if (!data || data.length === 0) {
      toast('Quản lý đã xử lý việc này rồi, không thu hồi được.', 'warning');
    } else {
      toast('Đã thu hồi.', 'success');
    }
    await loadData(true);
  };

  const days = useMemo(() => Array.from({ length: 7 }, (_, index) => {
    const date = new Date(weekStart);
    date.setDate(date.getDate() + index);
    return date;
  }), [weekStart]);

  const needsAction = assignments.filter((item) => item.status === 'pending' || item.status === 'rejected');

  if (loading) return <Skeleton className="h-64" />;

  return (
    <div className="space-y-4">
      <Card><CardContent className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setWeekOffset(weekOffset - 1)}>Tuần trước</Button>
          <span className="text-sm font-bold text-slate-800">
            {formatDate(toDateString(weekStart))} – {formatDate(toDateString(weekEnd))}
          </span>
          <Button size="sm" variant="outline" onClick={() => setWeekOffset(weekOffset + 1)}>Tuần sau</Button>
          {weekOffset !== 0 && (
            <Button size="sm" variant="ghost" onClick={() => setWeekOffset(0)}>Tuần này</Button>
          )}
        </div>
        {needsAction.length > 0 && (
          <Badge className="bg-amber-100 text-amber-700">
            {needsAction.length} việc chờ bạn
          </Badge>
        )}
      </CardContent></Card>

      {assignments.length === 0 ? (
        <EmptyState
          icon={<ClipboardList className="h-8 w-8" />}
          title="Tuần này chưa có việc nào được giao"
          description="Quản lý giao việc cho ngày nào thì việc hiện ở đúng ngày đó."
        />
      ) : (
        days.map((date) => {
          const dateStr = toDateString(date);
          const items = assignments.filter((item) => item.work_date === dateStr);
          if (items.length === 0) return null;
          const isToday = dateStr === getTodayString();

          return (
            <Card key={dateStr}>
              <CardContent className="p-0">
                <p className={`flex items-center gap-2 border-b border-slate-100 px-5 py-3 text-xs font-bold ${
                  isToday ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600'
                }`}>
                  <Clock className="h-3.5 w-3.5" />
                  {formatDate(dateStr)}
                  {isToday && <span className="rounded bg-indigo-600 px-1.5 py-0.5 text-[10px] text-white">HÔM NAY</span>}
                  <span className="font-normal text-slate-400">({items.length} việc)</span>
                </p>

                <ul className="divide-y divide-slate-50">
                  {items.map((item) => {
                    const style = STATUS_STYLE[item.status] ?? STATUS_STYLE.pending;
                    return (
                      <li key={item.id} className="flex flex-wrap items-start gap-3 px-5 py-3.5">
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-semibold text-slate-800">{item.title}</span>
                          {item.description && (
                            <span className="mt-0.5 block text-xs leading-relaxed text-slate-500">{item.description}</span>
                          )}
                          {/* Ly do bi tra lai: thu duy nhat cho biet phai sua
                              gi truoc khi gui lai. */}
                          {item.status === 'rejected' && item.review_note && (
                            <span className="mt-1 flex items-start gap-1.5 text-xs leading-relaxed text-red-700">
                              <TriangleAlert className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                              {item.review_note}
                            </span>
                          )}
                          {item.status === 'approved' && item.review_note && (
                            <span className="mt-1 flex items-start gap-1.5 text-xs leading-relaxed text-emerald-700">
                              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                              {item.review_note}
                            </span>
                          )}
                        </span>

                        <Badge className={style.className}>{style.label}</Badge>

                        {(item.status === 'pending' || item.status === 'rejected') && (
                          <Button size="sm" onClick={() => { setSubmitTarget(item); setSubmitNote(''); }}>
                            <Send className="h-3.5 w-3.5" />Gửi
                          </Button>
                        )}
                        {item.status === 'submitted' && (
                          <Button size="sm" variant="outline" onClick={() => void handleRecall(item)}>
                            <RotateCcw className="h-3.5 w-3.5" />Thu hồi
                          </Button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </CardContent>
            </Card>
          );
        })
      )}

      <Modal
        open={!!submitTarget}
        onClose={() => setSubmitTarget(null)}
        title={`Gửi việc: ${submitTarget?.title ?? ''}`}
        size="md"
      >
        <div className="space-y-4">
          <p className="text-xs leading-relaxed text-slate-500">
            Ghi lại kết quả hoặc vướng mắc để quản lý xác nhận nhanh hơn. Không bắt buộc.
          </p>
          <textarea
            value={submitNote}
            onChange={(event) => setSubmitNote(event.target.value)}
            rows={4}
            placeholder="VD: Đã giao đủ 12 đơn, còn 1 đơn khách hẹn mai."
            className="w-full rounded-xl border border-slate-200 p-3 text-sm outline-none focus:border-indigo-500"
          />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setSubmitTarget(null)} disabled={sending}>Hủy</Button>
            <Button onClick={() => void handleSubmit()} disabled={sending}>
              {sending ? 'Đang gửi…' : 'Gửi cho quản lý'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
