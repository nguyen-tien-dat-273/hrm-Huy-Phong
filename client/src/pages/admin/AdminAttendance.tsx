import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, Clock, XCircle, Calendar, Trash2, CheckCheck, ClipboardList, LogOut, Table, Cpu, UserRoundCog } from 'lucide-react';
import { useRealtimeSync } from '@/hooks/useRealtimeSync';
import { Card, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton, TableSkeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/contexts/ToastContext';
import { useConfirm } from '@/contexts/ConfirmContext';
import { useAuth } from '@/contexts/AuthContext';
import { isTeamlead } from '@/lib/permissions';
import { supabase } from '@/lib/supabase';
import { describeDbError } from '@/lib/dbError';
import { fetchProfileMap } from '@/lib/profileDirectory';
import { formatTime, formatDateTime, getTodayString } from '@/lib/utils';
import { notifyUser } from '@/lib/assignments';
import type { Attendance, Profile } from '@/types';

export function AdminAttendance() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const confirm = useConfirm();
  const [records, setRecords] = useState<Attendance[]>([]);
  /** Tiến độ công việc theo ô (người × ngày): "đã xác nhận / tổng được giao". */
  const [asgProgress, setAsgProgress] = useState<Record<string, { approved: number; total: number }>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Dem rieng ban ghi KHONG phai tu may ma con cho duyet. Loc man hinh ve
  // mot nguon la dung y do, nhung giau luon nhung dong do thi chung khong
  // bao gio duoc duyet va khong bao gio vao bang luong - mat im lang.
  const [legacyPending, setLegacyPending] = useState(0);
  // Máy chấm công này chỉ ghi giờ vào, nên giờ ra phải nhập tay ở đây.
  // `checkoutTarget` là một bản ghi, hoặc 'bulk' cho toàn bộ dòng đang hiển thị.
  const [checkoutTarget, setCheckoutTarget] = useState<Attendance | 'bulk' | null>(null);
  const [checkoutTime, setCheckoutTime] = useState('17:30');
  const [savingCheckout, setSavingCheckout] = useState(false);
  const [filter, setFilter] = useState<'all' | 'today' | 'pending'>('today');
  // Trưởng nhóm duyệt được ngày công của phạm vi mình quản lý nhưng không đổi
  // quy tắc giờ làm dùng chung toàn công ty — khớp với guard của route cài đặt.
  const canConfigureAttendance = !isTeamlead(profile);

  useEffect(() => {
    loadAttendance();
  }, [filter]);

  // Nghe cả daily_assignments: quản lý xác nhận việc xong là cột "Công việc"
  // ở đây phải nhảy số theo.
  useRealtimeSync(
    [{ table: 'attendance' }, { table: 'daily_assignments' }],
    () => loadAttendance(true),
  );

  useEffect(() => {
    // Giờ tan ca theo ca đang áp dụng; không có ca nào thì giữ 17:30 mặc định.
    void (async () => {
      const today = getTodayString();
      const { data } = await supabase
        .from('work_schedules')
        .select('end_time,effective_from,effective_to')
        .lte('effective_from', today)
        .order('effective_from', { ascending: false })
        .limit(5);
      const current = (data || []).find((s) => !s.effective_to || s.effective_to >= today);
      if (current?.end_time) setCheckoutTime(String(current.end_time).slice(0, 5));
    })();
  }, []);

  const loadAttendance = async (silent = false) => {
    if (!silent) setLoading(true);
    // `attendance` có HAI khóa ngoại trỏ về `profiles` (user_id và
    // approved_by_user_id), nên `profiles(*)` là mơ hồ và PostgREST trả lỗi
    // PGRST201. Phải chỉ rõ khóa.
    // Cham cong o day CHI den tu may cham cong vat ly. Luong tu khai bang GPS
    // khong con dung; don tu (nghi phep, di muon, ve som, lam them) xu ly ben
    // /admin/leave chu khong phai man nay.
    let query = supabase
      .from('attendance')
      .select('*')
      .eq('check_in_method', 'DEVICE')
      .order('date', { ascending: false });
    if (filter === 'today') {
      query = query.eq('date', getTodayString());
    } else if (filter === 'pending') {
      // Gom cả bản ghi thiếu checkout để quản lý thấy nguyên nhân chưa thể duyệt.
      query = query.eq('approved_by_lead', false);
    }
    const { data, error } = await query;
    setLoadError(error ? describeDbError(error) : null);

    const legacy = await supabase
      .from('attendance')
      .select('id', { head: true, count: 'exact' })
      .neq('check_in_method', 'DEVICE')
      .eq('approved_by_lead', false);
    setLegacyPending(legacy.error ? 0 : (legacy.count ?? 0));
    const rows = (data || []) as Attendance[];
    // `profiles_directory` là VIEW nên PostgREST không nhúng được (PGRST200).
    // Nạp hồ sơ rời theo đúng những người đang hiển thị rồi ghép tại chỗ.
    const people = await fetchProfileMap(rows.map((row) => row.user_id));
    const list = rows.map((row) => ({ ...row, profile: row.profile ?? people.get(row.user_id) }));
    setRecords(list);

    // Ghép tiến độ công việc của đúng những ngày đang hiển thị — để người
    // duyệt công thấy ngay hôm đó nhân viên hoàn thành được gì.
    const dates = [...new Set(list.map((r) => r.date))];
    if (dates.length > 0) {
      const { data: asgData } = await supabase
        .from('daily_assignments')
        .select('user_id, work_date, status')
        .in('work_date', dates);
      const map: Record<string, { approved: number; total: number }> = {};
      for (const a of (asgData || []) as { user_id: string; work_date: string; status: string }[]) {
        const key = `${a.user_id}|${a.work_date}`;
        map[key] = map[key] ?? { approved: 0, total: 0 };
        map[key].total++;
        if (a.status === 'approved') map[key].approved++;
      }
      setAsgProgress(map);
    } else {
      setAsgProgress({});
    }
    setLoading(false);
  };

  const missingCheckout = records.filter((r) => r.check_in_time && !r.check_out_time);

  // Dựng mốc giờ ra từ ngày công + giờ người dùng gõ, theo múi giờ của TRÌNH
  // DUYỆT. Cố ý: cột giờ vào trên màn này cũng hiển thị theo giờ trình duyệt,
  // nên gõ "17:30" là ra đúng 17:30 như mắt nhìn thấy. Ghép cứng +07:00 ở đây
  // thì máy đặt sai múi giờ sẽ ghi lệch mà không ai thấy.
  const buildCheckout = (record: Attendance, hhmm: string) => {
    const stamp = new Date(`${record.date}T${hhmm}:00`);
    if (Number.isNaN(stamp.getTime())) return null;
    const checkIn = record.check_in_time ? new Date(record.check_in_time).getTime() : 0;
    if (stamp.getTime() <= checkIn) return 'BEFORE_CHECKIN' as const;
    return stamp.toISOString();
  };

  const saveCheckout = async () => {
    if (!checkoutTarget) return;
    const targets = checkoutTarget === 'bulk' ? missingCheckout : [checkoutTarget];
    if (targets.length === 0) return;

    setSavingCheckout(true);
    let done = 0;
    let tooEarly = 0;
    let failed: string | null = null;

    for (const record of targets) {
      const value = buildCheckout(record, checkoutTime);
      if (value === null) { failed = 'Giờ không hợp lệ.'; break; }
      if (value === 'BEFORE_CHECKIN') { tooEarly += 1; continue; }
      const { error } = await supabase
        .from('attendance')
        .update({ check_out_time: value, status: 'completed' })
        .eq('id', record.id);
      if (error) { failed = describeDbError(error); break; }
      done += 1;
    }
    setSavingCheckout(false);

    if (failed) {
      toast(`Ghi giờ ra thất bại: ${failed}`, 'error');
    } else if (done === 0 && tooEarly > 0) {
      toast(`Giờ ra phải sau giờ vào. ${tooEarly} bản ghi bị bỏ qua.`, 'error');
    } else {
      toast(
        tooEarly > 0
          ? `Đã ghi giờ ra cho ${done} bản ghi; bỏ qua ${tooEarly} bản ghi có giờ vào muộn hơn.`
          : `Đã ghi giờ ra cho ${done} bản ghi.`,
        'success',
      );
      setCheckoutTarget(null);
      loadAttendance();
    }
  };

  const handleApprove = async (record: Attendance) => {
    // Không cho phép duyệt khi nhân viên chưa checkout
    if (record.status !== 'completed' || !record.check_out_time) {
      toast('Không thể duyệt: Nhân viên chưa Check-out.', 'warning');
      return;
    }

    const { data: updated, error } = await supabase.from('attendance').update({
      approved_by_lead: true,
      approved_at: new Date().toISOString(),
      approved_by_user_id: profile?.id,
    })
      .eq('id', record.id)
      .eq('approved_by_lead', false)
      .eq('status', 'completed')
      .not('check_out_time', 'is', null)
      .select('id')
      .maybeSingle();

    if (error) {
      toast('Duyệt thất bại', 'error');
    } else if (!updated) {
      toast('Bản ghi đã thay đổi hoặc chưa đủ điều kiện duyệt. Danh sách sẽ được cập nhật lại.', 'warning');
      loadAttendance();
    } else {
      await notifyUser(
        record.user_id,
        'Chấm công đã được duyệt',
        `Quản lý đã xác nhận ngày làm việc ${record.date} của bạn.`,
        'attendance_approved',
      );
      toast('Đã duyệt chấm công', 'success');
      loadAttendance();
    }
  };

  const handleUnapprove = async (record: Attendance) => {
    const ok = await confirm({
      title: 'Bỏ duyệt chấm công?',
      message: `Bạn muốn bỏ duyệt ngày công ${record.date} của ${record.profile?.name || 'nhân viên này'}?`,
      confirmLabel: 'Bỏ duyệt',
    });
    if (!ok) return;

    const { data: updated, error } = await supabase.from('attendance').update({
      approved_by_lead: false,
      approved_at: null,
      approved_by_user_id: null,
    }).eq('id', record.id).eq('approved_by_lead', true).select('id').maybeSingle();

    if (error) {
      toast('Thao tác thất bại', 'error');
    } else if (!updated) {
      toast('Bản ghi đã thay đổi hoặc không còn ở trạng thái đã duyệt.', 'warning');
      loadAttendance(true);
    } else {
      toast('Đã bỏ duyệt chấm công', 'success');
      loadAttendance();
    }
  };

  const handleDelete = async (record: Attendance) => {
    const ok = await confirm({
      title: 'Xóa bản ghi chấm công?',
      message: `Bản ghi ngày ${record.date} của ${record.profile?.name || 'nhân viên này'} sẽ bị xóa vĩnh viễn.`,
      confirmLabel: 'Xóa bản ghi',
      danger: true,
    });
    if (!ok) return;
    const { error } = await supabase.from('attendance').delete().eq('id', record.id);
    if (error) {
      toast('Xóa thất bại', 'error');
    } else {
      toast('Đã xóa bản ghi chấm công', 'success');
      loadAttendance();
    }
  };

  const handleApproveAllPending = async () => {
    const pending = records.filter(
      (r) => !r.approved_by_lead && r.status === 'completed' && Boolean(r.check_out_time),
    );
    if (pending.length === 0) {
      toast('Không có bản ghi nào cần duyệt.', 'warning');
      return;
    }
    const ok = await confirm({
      title: `Duyệt tất cả ${pending.length} bản ghi?`,
      message: 'Mỗi nhân viên liên quan sẽ nhận được một thông báo xác nhận.',
      confirmLabel: 'Duyệt tất cả',
    });
    if (!ok) return;
    let success = 0;
    for (const r of pending) {
      const { data: updated, error } = await supabase.from('attendance').update({
        approved_by_lead: true,
        approved_at: new Date().toISOString(),
        approved_by_user_id: profile?.id,
      })
        .eq('id', r.id)
        .eq('approved_by_lead', false)
        .eq('status', 'completed')
        .not('check_out_time', 'is', null)
        .select('id')
        .maybeSingle();
      if (!error && updated) {
        success++;
        await notifyUser(
          r.user_id,
          'Chấm công đã được duyệt',
          `Quản lý đã xác nhận ngày làm việc ${r.date} của bạn.`,
          'attendance_approved',
        );
      }
    }
    if (success > 0) {
      toast(`Đã duyệt ${success} bản ghi chấm công`, 'success');
      loadAttendance();
    } else {
      toast('Duyệt thất bại', 'error');
    }
  };

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-slate-200 bg-white px-3.5 py-2.5">
        <p className="text-sm font-semibold text-slate-800">Chấm công từ máy chấm công</p>
        <p className="mt-0.5 text-xs text-slate-500">
          Chỉ hiển thị ngày công do máy vân tay/khuôn mặt ghi lại. Đơn nghỉ phép, đi muộn,
          về sớm và làm thêm xử lý ở <Link to="/admin/leave" className="font-semibold text-indigo-700 hover:underline">Trung tâm đơn từ</Link>.
        </p>
      </div>

      {legacyPending > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5">
          <p className="text-xs text-amber-900">
            Còn <strong>{legacyPending}</strong> ngày công cũ không đến từ máy và chưa được duyệt.
            Màn này đã lọc bỏ chúng, nên chúng sẽ không bao giờ được duyệt và không vào bảng lương.
          </p>
        </div>
      )}

      {canConfigureAttendance && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5">
          <p className="text-xs text-slate-500">
            Thiết lập giờ chuẩn và quy tắc vận hành dùng chung
          </p>
          <Link
            to="/admin/attendance-settings"
            className="inline-flex items-center rounded-lg px-2.5 py-1.5 text-xs font-semibold text-indigo-700 transition-colors hover:bg-indigo-50"
          >
            Mở thiết lập
          </Link>
        </div>
      )}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex gap-2">
          {([
            { key: 'today', label: 'Hôm nay' },
            { key: 'pending', label: 'Cần xử lý' },
            { key: 'all', label: 'Tất cả' },
] as { key: typeof filter; label: string }[]).map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`px-4 py-1.5 rounded text-[10px] font-bold uppercase tracking-widest transition-all duration-200 ${
                filter === f.key
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'bg-white text-slate-500 border border-slate-200 hover:bg-slate-50'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {missingCheckout.length > 0 && (
            <Button variant="outline" theme="admin" size="sm" onClick={() => setCheckoutTarget('bulk')}>
              <LogOut className="w-4 h-4" />
              Ghi giờ ra ({missingCheckout.length})
            </Button>
          )}
          {filter === 'pending' && (
            <Button variant="outline" theme="admin" size="sm" onClick={handleApproveAllPending}>
              <CheckCheck className="w-4 h-4" />
              Duyệt tất cả
            </Button>
          )}
          <Link to="/admin/timesheet">
            <Button variant="outline" theme="admin" size="sm">
              <Table className="w-4 h-4" />
              Bảng công & xuất Excel
            </Button>
          </Link>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-5"><TableSkeleton /></div>
          ) : loadError ? (
            <ErrorState message={loadError} onRetry={loadAttendance} />
          ) : records.length === 0 ? (
            <EmptyState icon={<Clock className="w-8 h-8" />} title="Không có bản ghi" description="Chưa có dữ liệu chấm công trong mục này." />
          ) : (
            <div className="overflow-x-auto p-3 md:p-0">
              <table className="w-full table-cards">
                <thead>
                  <tr className="border-b border-slate-100 bg-[#FCFAF8]">
                    <th className="text-left text-[10px] font-bold text-slate-400 uppercase tracking-widest px-6 py-4">Nhân viên</th>
                    <th className="text-left text-[10px] font-bold text-slate-400 uppercase tracking-widest px-6 py-4">Thời gian</th>
                    <th className="text-left text-[10px] font-bold text-slate-400 uppercase tracking-widest px-6 py-4">Nguồn</th>
                    <th className="text-left text-[10px] font-bold text-slate-400 uppercase tracking-widest px-6 py-4">Công việc</th>
                    <th className="text-left text-[10px] font-bold text-slate-400 uppercase tracking-widest px-6 py-4">Kiểm soát</th>
                    <th className="text-right text-[10px] font-bold text-slate-400 uppercase tracking-widest px-6 py-4">Thao tác</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {records.map((r) => (
                    <tr key={r.id} className="hover:bg-[#FCFAF8] transition-colors group">
                      <td data-label="" className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <Avatar name={r.profile?.name || ''} url={r.profile?.avatar_url} size="sm" />
                          <div className="flex flex-col">
                            <span className="text-sm font-bold text-slate-800">{r.profile?.name}</span>
                            <span className="text-[10px] text-slate-400 font-medium uppercase tracking-tighter">{r.profile?.department || 'OPS STAFF'}</span>
                          </div>
                        </div>
                      </td>
                      <td data-label="Thời gian" className="px-6 py-4">
                        <div className="flex flex-col">
                          <span className="text-xs font-bold text-slate-700 uppercase tracking-tight">{r.date}</span>
                          <span className="text-[10px] text-slate-400 font-medium uppercase tracking-tighter">
                            {formatTime(r.check_in_time)}
                            {r.check_out_time ? ` — ${formatTime(r.check_out_time)}` : r.check_in_method === 'DEVICE' ? ' · chỉ giờ vào' : ' — ...'}
                          </span>
                        </div>
                      </td>
                      <td data-label="Nguồn" className="px-6 py-4">
                        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600">
                          {r.check_in_method === 'DEVICE' ? <Cpu className="h-4 w-4 text-indigo-500" /> : <UserRoundCog className="h-4 w-4 text-slate-400" />}
                          {r.check_in_method === 'DEVICE' ? 'Máy / file' : r.check_in_method === 'MANUAL' ? 'Quản trị ghi nhận' : 'Dữ liệu kế thừa'}
                        </span>
                      </td>
                      <td data-label="Công việc" className="px-6 py-4">
                        {(() => {
                          const p = asgProgress[`${r.user_id}|${r.date}`];
                          if (!p) return <span className="text-xs font-semibold text-slate-400">Không có việc</span>;
                          const done = p.approved === p.total;
                          return (
                            <div className="flex items-center gap-2">
                              <span className={`text-[10px] font-bold uppercase tracking-widest ${done ? 'text-emerald-600' : 'text-amber-600'}`}>
                                {p.approved}/{p.total} hoàn thành
                              </span>
                              <div className="w-12 h-1 bg-slate-100 rounded-full overflow-hidden">
                                <div className={`h-full ${done ? 'bg-emerald-500' : 'bg-amber-500'}`} style={{ width: `${(p.approved/p.total)*100}%` }} />
                              </div>
                            </div>
                          );
                        })()}
                      </td>
                      <td data-label="Kiểm soát" className="px-6 py-4">
                        <div className="flex flex-wrap gap-2">
                          <Badge className={r.status === 'completed' ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'bg-amber-50 text-amber-700 border-amber-100'}>
                            {r.check_out_time ? 'Đã checkout' : r.check_in_method === 'DEVICE' ? 'Ghi nhận từ máy' : 'Thiếu checkout'}
                          </Badge>
	                          {r.approved_by_lead && (
	                            <Badge className="bg-slate-900 text-white border-slate-900">
	                              Đã duyệt
	                            </Badge>
	                          )}
                        </div>
                      </td>
                      <td data-label="" className="px-5 py-3.5">
                        <div className="flex items-center justify-end gap-2">
                          {r.check_in_time && !r.check_out_time && (
                            <button
                              onClick={() => setCheckoutTarget(r)}
                              className="px-3 py-1.5 rounded-lg bg-indigo-50 text-indigo-700 text-xs font-medium hover:bg-indigo-100 transition-colors"
                              title="Nhập giờ ra cho ngày công này"
                            >
                              Ghi giờ ra
                            </button>
                          )}
	                          {!r.approved_by_lead ? (
	                            <button
	                              onClick={() => handleApprove(r)}
	                              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
	                                r.status === 'completed' && r.check_out_time
	                                  ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
	                                  : 'bg-slate-50 text-slate-400 cursor-not-allowed'
	                              }`}
	                              title={!r.check_out_time ? 'Chờ nhân viên checkout' : r.status !== 'completed' ? 'Ngày công chưa kết thúc' : 'Duyệt ngày công'}
	                            >
	                              Duyệt
	                            </button>
	                          ) : (
	                            <button
	                              onClick={() => handleUnapprove(r)}
	                              className="px-3 py-1.5 rounded-lg bg-amber-50 text-amber-700 text-xs font-medium hover:bg-amber-100 transition-colors"
	                            >
	                              Bỏ duyệt
	                            </button>
	                          )}
                          <button
                            onClick={() => handleDelete(r)}
                            title="Xóa bản ghi"
                            className="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Modal
        open={checkoutTarget !== null}
        onClose={() => setCheckoutTarget(null)}
        title={checkoutTarget === 'bulk' ? `Ghi giờ ra cho ${missingCheckout.length} bản ghi` : 'Ghi giờ ra'}
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            {checkoutTarget === 'bulk' ? (
              <>Áp dụng cùng một giờ ra cho tất cả ngày công đang hiển thị mà chưa có giờ ra.</>
            ) : checkoutTarget ? (
              <>
                <strong>{checkoutTarget.profile?.name || 'Nhân viên'}</strong> · ngày {checkoutTarget.date} ·
                vào lúc {formatTime(checkoutTarget.check_in_time)}
              </>
            ) : null}
          </p>

          <Input
            label="Giờ ra"
            type="time"
            value={checkoutTime}
            onChange={(e) => setCheckoutTime(e.target.value)}
          />

          <p className="text-xs text-slate-500">
            Máy chấm công chỉ ghi giờ vào, nên giờ ra nhập ở đây. Giá trị mặc định lấy từ ca
            làm việc đang áp dụng. Bản ghi nào có giờ vào muộn hơn giờ này sẽ được bỏ qua chứ
            không ghi đè thành số âm.
          </p>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setCheckoutTarget(null)}>Hủy</Button>
            <Button onClick={saveCheckout} disabled={savingCheckout || !checkoutTime}>
              {savingCheckout ? 'Đang ghi...' : 'Ghi giờ ra'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
