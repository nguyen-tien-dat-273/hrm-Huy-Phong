import { useEffect, useMemo, useState, useCallback } from 'react';
import {
  ClipboardList, Plus, ChevronLeft, ChevronRight, Check, X, Inbox,
  Pencil, Trash2, CalendarDays, Copy,
} from 'lucide-react';
import { addDays } from 'date-fns';
import { Card, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input, Select, Textarea } from '@/components/ui/Input';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { TableSkeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/contexts/ToastContext';
import { useConfirm } from '@/contexts/ConfirmContext';
import { useAuth } from '@/contexts/AuthContext';
import { useRealtimeSync } from '@/hooks/useRealtimeSync';
import { supabase } from '@/lib/supabase';
import { isTeamlead } from '@/lib/permissions';
import { describeDbError, describeDbErrorOrNull } from '@/lib/dbError';
import { PRIORITY_CONFIG, formatDate, formatTime, toDateString } from '@/lib/utils';
import {
  ASSIGNMENT_STATUS_CONFIG, mondayOf, weekDates, dayLabel, weekRangeLabel, isToday, notifyUsers,
} from '@/lib/assignments';
import type { DailyAssignment, Profile, TaskPriority } from '@/types';

/** Thứ trong tuần cho khu chọn ngày của chế độ "Cả tuần" (index 0 = Thứ Hai). */
const WEEKDAY_SHORT = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];

export function AdminAssignments() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const confirm = useConfirm();

  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()));
  const [staff, setStaff] = useState<Profile[]>([]);
  const [weekAssignments, setWeekAssignments] = useState<DailyAssignment[]>([]);
  const [queue, setQueue] = useState<DailyAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // ----- Modal giao việc -----
  const [assignOpen, setAssignOpen] = useState(false);
  const [selMembers, setSelMembers] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<'day' | 'week'>('day');
  const [singleDate, setSingleDate] = useState(toDateString(new Date()));
  // index 0..6 tương ứng T2..CN của tuần đang xem; mặc định T2–T6
  const [selDays, setSelDays] = useState<Set<number>>(new Set([0, 1, 2, 3, 4]));
  /**
   * Nội dung việc RIÊNG cho từng ngày trong chế độ "Cả tuần" (khóa = index 0..6).
   * Để trống thì ngày đó dùng nội dung chung ở ô "Công việc" — nhờ vậy cách dùng
   * cũ (một việc lặp cho cả tuần) không đổi, mà vẫn giao được việc khác nhau
   * từng ngày khi cần.
   */
  const [dayTitles, setDayTitles] = useState<Record<number, string>>({});
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('medium');

  // ----- Modal từ chối -----
  const [rejectTarget, setRejectTarget] = useState<DailyAssignment | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  // ----- Modal chi tiết / sửa -----
  const [detail, setDetail] = useState<DailyAssignment | null>(null);
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editPriority, setEditPriority] = useState<TaskPriority>('medium');
  const [editDate, setEditDate] = useState('');

  const days = useMemo(() => weekDates(weekStart), [weekStart]);
  const weekStartStr = toDateString(weekStart);
  const weekEndStr = toDateString(addDays(weekStart, 6));

  const loadData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);

    const [staffRes, weekRes, queueRes] = await Promise.all([
      // KHONG loc `role = 'staff'`.
      //
      // Loc nhu vay thi truong nhom, truong phong va giam doc bien mat khoi
      // bang giao viec - trong khi o cong ty vua va nho ho van nhan viec hang
      // ngay nhu moi nguoi. Thuc te tren he thong nay: chi dung mot tai khoan
      // co vai tro Nhan vien, nen bang chi hien dung mot dong.
      //
      // RLS cua `daily_assignments` cung khong he chan theo vai tro nguoi
      // duoc giao - no chi doi nguoi tao phai la chinh minh hoac nguoi giao.
      // Tuc la bo loc nay khong do mot quy tac nghiep vu nao ca.
      supabase.from('profiles').select('*').eq('is_active', true).order('name'),
      supabase
        .from('daily_assignments')
        .select('*, profile:profiles!daily_assignments_user_id_fkey(*)')
        .gte('work_date', weekStartStr)
        .lte('work_date', weekEndStr)
        .order('created_at', { ascending: true }),
      supabase
        .from('daily_assignments')
        .select('*, profile:profiles!daily_assignments_user_id_fkey(*)')
        .eq('status', 'submitted')
        .order('submitted_at', { ascending: true }),
    ]);

    setLoadError(
      describeDbErrorOrNull(staffRes.error)
        ?? describeDbErrorOrNull(weekRes.error)
        ?? describeDbErrorOrNull(queueRes.error),
    );

    // Trưởng nhóm chỉ giao việc cho thành viên nhóm mình — lọc danh sách theo
    // my_team_member_ids() (RLS cũng chặn giao cho người ngoài, đây là để danh
    // sách chọn không hiện người không giao được).
    let staffList = (staffRes.data || []) as Profile[];
    if (isTeamlead(profile)) {
      const { data: teamIds } = await supabase.rpc('my_team_member_ids');
      const idSet = new Set(((teamIds as { user_id: string }[]) || []).map((r) => r.user_id));
      staffList = staffList.filter((p) => idSet.has(p.id));
    }
    setStaff(staffList);
    setWeekAssignments((weekRes.data || []) as DailyAssignment[]);
    setQueue((queueRes.data || []) as DailyAssignment[]);
    setLoading(false);
  }, [weekStartStr, weekEndStr, profile]);

  useEffect(() => { loadData(); }, [loadData]);

  // Nhân viên bấm "Gửi duyệt" là hàng chờ ở đây phải hiện ngay.
  useRealtimeSync([{ table: 'daily_assignments' }], () => loadData(true));

  /** Tra cứu nhanh việc theo ô (người × ngày) cho bảng tuần. */
  const byCell = useMemo(() => {
    const map = new Map<string, DailyAssignment[]>();
    for (const a of weekAssignments) {
      const key = `${a.user_id}|${a.work_date}`;
      const list = map.get(key) ?? [];
      list.push(a);
      map.set(key, list);
    }
    return map;
  }, [weekAssignments]);

  // --------------------------------------------------------------------------
  // Giao việc
  // --------------------------------------------------------------------------
  const openAssign = (memberId?: string, date?: Date) => {
    setSelMembers(new Set(memberId ? [memberId] : []));
    setMode('day');
    setSingleDate(toDateString(date ?? new Date()));
    setSelDays(new Set([0, 1, 2, 3, 4]));
    setDayTitles({});
    setTitle('');
    setDescription('');
    setPriority('medium');
    setAssignOpen(true);
  };

  /**
   * Các ngày sẽ giao, KÈM nội dung việc của từng ngày.
   *
   * Chế độ "Cả tuần" trước đây chỉ áp một tên việc cho mọi ngày, nên muốn giao
   * việc khác nhau từng ngày phải mở lại hộp thoại nhiều lần. Giờ mỗi ngày có ô
   * riêng; để trống thì rơi về nội dung chung, giữ nguyên cách dùng cũ.
   */
  const targets: { date: string; title: string }[] = useMemo(() => {
    const common = title.trim();
    if (mode === 'day') return singleDate ? [{ date: singleDate, title: common }] : [];
    return days
      .map((d, i) => ({ i, date: toDateString(d) }))
      .filter(({ i }) => selDays.has(i))
      .map(({ i, date }) => ({ date, title: (dayTitles[i] ?? '').trim() || common }));
  }, [mode, singleDate, selDays, days, dayTitles, title]);

  const targetDates: string[] = useMemo(() => targets.map((t) => t.date), [targets]);

  const handleAssign = async () => {
    if (selMembers.size === 0) { toast('Chọn ít nhất một thành viên.', 'warning'); return; }
    if (targets.length === 0) { toast('Chọn ít nhất một ngày.', 'warning'); return; }

    // Mỗi ngày phải có nội dung: hoặc ô riêng của ngày đó, hoặc nội dung chung.
    const thieu = targets.filter((t) => !t.title);
    if (thieu.length > 0) {
      toast(
        mode === 'day'
          ? 'Nhập tên công việc.'
          : `Còn ${thieu.length} ngày chưa có nội dung việc — nhập cho từng ngày, hoặc điền ô "Công việc" dùng chung.`,
        'warning',
      );
      return;
    }

    setBusy(true);
    const rows = [...selMembers].flatMap((user_id) =>
      targets.map((t) => ({
        user_id,
        assigned_by: profile?.id,
        work_date: t.date,
        title: t.title,
        description: description.trim() || null,
        priority,
        status: 'pending',
      })),
    );

    const { error } = await supabase.from('daily_assignments').insert(rows);
    setBusy(false);

    if (error) {
      toast('Giao việc thất bại: ' + describeDbError(error), 'error');
      return;
    }

    // Nhiều ngày có thể mang nội dung khác nhau — đếm số việc PHÂN BIỆT để câu
    // thông báo không nói dối là chỉ giao một việc.
    const distinct = [...new Set(targets.map((t) => t.title))];
    const workText = distinct.length === 1 ? `"${distinct[0]}"` : `${distinct.length} công việc`;

    toast(`Đã giao ${workText} cho ${selMembers.size} thành viên × ${targets.length} ngày.`, 'success');
    setAssignOpen(false);
    loadData(true);

    const dateText = targetDates.length === 1
      ? `ngày ${formatDate(targetDates[0])}`
      : `${targetDates.length} ngày (${formatDate(targetDates[0])} → ${formatDate(targetDates[targetDates.length - 1])})`;
    await notifyUsers(
      [...selMembers],
      'Bạn được giao công việc mới',
      `${workText} — ${dateText}. Check-in để xem và thực hiện.`,
      'assignment_new',
    );
  };

  // --------------------------------------------------------------------------
  // Xác nhận / từ chối
  // --------------------------------------------------------------------------
  const handleApprove = async (a: DailyAssignment) => {
    setBusy(true);
    const { data, error } = await supabase
      .from('daily_assignments')
      .update({
        status: 'approved',
        reviewed_by: profile?.id,
        reviewed_at: new Date().toISOString(),
        review_note: null,
      })
      .eq('id', a.id)
      .eq('status', 'submitted')
      .select();
    setBusy(false);

    if (error) { toast('Xác nhận thất bại: ' + describeDbError(error), 'error'); return; }
    if (!data || data.length === 0) {
      toast('Công việc này vừa thay đổi trạng thái — đã tải lại.', 'warning');
      loadData(true);
      return;
    }

    toast(`Đã xác nhận "${a.title}".`, 'success');
    setDetail(null);
    loadData(true);
    await notifyUsers(
      [a.user_id],
      'Công việc đã được xác nhận',
      `"${a.title}" (${formatDate(a.work_date)}) đã được xác nhận hoàn thành.`,
      'assignment_approved',
    );
  };

  const handleReject = async () => {
    if (!rejectTarget) return;
    if (!rejectReason.trim()) {
      toast('Nhập lý do từ chối — nhân viên cần biết phải sửa gì.', 'warning');
      return;
    }

    setBusy(true);
    const { data, error } = await supabase
      .from('daily_assignments')
      .update({
        status: 'rejected',
        reviewed_by: profile?.id,
        reviewed_at: new Date().toISOString(),
        review_note: rejectReason.trim(),
      })
      .eq('id', rejectTarget.id)
      .eq('status', 'submitted')
      .select();
    setBusy(false);

    if (error) { toast('Từ chối thất bại: ' + describeDbError(error), 'error'); return; }
    if (!data || data.length === 0) {
      toast('Công việc này vừa thay đổi trạng thái — đã tải lại.', 'warning');
      setRejectTarget(null);
      loadData(true);
      return;
    }

    toast(`Đã trả lại "${rejectTarget.title}" để làm lại.`, 'success');
    const target = rejectTarget;
    setRejectTarget(null);
    setRejectReason('');
    setDetail(null);
    loadData(true);
    await notifyUsers(
      [target.user_id],
      'Công việc cần làm lại',
      `"${target.title}" (${formatDate(target.work_date)}) bị trả lại. Lý do: ${rejectReason.trim()}`,
      'assignment_rejected',
    );
  };

  // --------------------------------------------------------------------------
  // Sao chép tuần
  // --------------------------------------------------------------------------
  /**
   * Nhân bản toàn bộ phân công của tuần đang xem sang tuần kế tiếp (mọi trạng
   * thái đều quay về "pending"). Bỏ qua dòng đích đã tồn tại cùng
   * (người, ngày, tên việc) để bấm hai lần không tạo bản trùng.
   */
  const handleCopyWeek = async () => {
    if (weekAssignments.length === 0) {
      toast('Tuần này chưa có phân công nào để sao chép.', 'warning');
      return;
    }
    const ok = await confirm({
      title: 'Sao chép sang tuần sau?',
      message: `${weekAssignments.length} phân công của tuần ${weekRangeLabel(weekStart)} sẽ được tạo lại cho tuần kế tiếp với trạng thái "Cần làm".`,
      confirmLabel: 'Sao chép',
    });
    if (!ok) return;

    setBusy(true);
    const nextStart = toDateString(addDays(weekStart, 7));
    const nextEnd = toDateString(addDays(weekStart, 13));
    const { data: existing } = await supabase
      .from('daily_assignments')
      .select('user_id, work_date, title')
      .gte('work_date', nextStart)
      .lte('work_date', nextEnd);
    const taken = new Set((existing || []).map((e) => `${e.user_id}|${e.work_date}|${e.title}`));

    const rows = weekAssignments
      .map((a) => ({
        user_id: a.user_id,
        assigned_by: profile?.id,
        work_date: toDateString(addDays(new Date(a.work_date), 7)),
        title: a.title,
        description: a.description,
        priority: a.priority,
        status: 'pending',
      }))
      .filter((r) => !taken.has(`${r.user_id}|${r.work_date}|${r.title}`));

    if (rows.length === 0) {
      setBusy(false);
      toast('Tuần sau đã có đủ các phân công này rồi — không tạo thêm.', 'warning');
      return;
    }

    const { error } = await supabase.from('daily_assignments').insert(rows);
    setBusy(false);

    if (error) {
      toast('Sao chép thất bại: ' + describeDbError(error), 'error');
      return;
    }

    toast(`Đã sao chép ${rows.length} phân công sang tuần sau.`, 'success');
    loadData(true);

    const byUser = new Map<string, number>();
    for (const r of rows) byUser.set(r.user_id, (byUser.get(r.user_id) ?? 0) + 1);
    await Promise.all(
      [...byUser.entries()].map(([userId, n]) =>
        notifyUsers(
          [userId],
          'Bạn được giao công việc tuần sau',
          `Quản lý vừa giao ${n} công việc cho tuần ${weekRangeLabel(addDays(weekStart, 7))}. Check-in từng ngày để thực hiện.`,
          'assignment_new',
        ),
      ),
    );
  };

  // --------------------------------------------------------------------------
  // Sửa / xóa
  // --------------------------------------------------------------------------
  const openDetail = (a: DailyAssignment) => {
    setDetail(a);
    setEditing(false);
    setEditTitle(a.title);
    setEditDesc(a.description ?? '');
    setEditPriority(a.priority);
    setEditDate(a.work_date);
  };

  const handleSaveEdit = async () => {
    if (!detail) return;
    if (!editTitle.trim()) { toast('Tên công việc không được để trống.', 'warning'); return; }

    setBusy(true);
    const { error } = await supabase
      .from('daily_assignments')
      .update({
        title: editTitle.trim(),
        description: editDesc.trim() || null,
        priority: editPriority,
        work_date: editDate,
      })
      .eq('id', detail.id);
    setBusy(false);

    if (error) { toast('Lưu thất bại: ' + describeDbError(error), 'error'); return; }
    toast('Đã cập nhật phân công.', 'success');
    setDetail(null);
    loadData(true);
  };

  const handleDelete = async (a: DailyAssignment) => {
    const ok = await confirm({
      title: 'Xóa phân công này?',
      message: `"${a.title}" ngày ${formatDate(a.work_date)} của ${a.profile?.name ?? 'nhân viên'} sẽ bị xóa khỏi danh sách công việc.`,
      confirmLabel: 'Xóa',
      danger: true,
    });
    if (!ok) return;

    const { error } = await supabase.from('daily_assignments').delete().eq('id', a.id);
    if (error) { toast('Xóa thất bại: ' + describeDbError(error), 'error'); return; }
    toast('Đã xóa phân công.');
    setDetail(null);
    loadData(true);
  };

  // --------------------------------------------------------------------------
  // Render
  // --------------------------------------------------------------------------
  if (loading) {
    return <div className="bg-white border border-slate-200 rounded-2xl p-5"><TableSkeleton rows={6} /></div>;
  }

  if (loadError) {
    return (
      <div className="bg-white border border-slate-200 rounded-2xl">
        <ErrorState message={loadError} onRetry={loadData} />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-800">Giao việc theo ngày</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Giao việc cho từng ngày hoặc cả tuần — nhân viên check-in sẽ thấy việc, làm xong gửi lại để bạn xác nhận.
          </p>
        </div>
        <Button onClick={() => openAssign()}>
          <Plus className="w-4 h-4" /> Giao việc
        </Button>
      </div>

      {/* Hàng chờ xác nhận */}
      {queue.length > 0 && (
        <Card className="border-amber-200 ring-1 ring-amber-100">
          <div className="px-5 py-4 border-b border-amber-100 bg-gradient-to-r from-amber-50/80 to-white flex items-center gap-2">
            <Inbox className="w-5 h-5 text-amber-600" />
            <h3 className="text-base font-semibold text-slate-800">Chờ xác nhận</h3>
            <Badge className="bg-amber-100 text-amber-700">{queue.length}</Badge>
          </div>
          <CardContent className="p-0">
            <div className="divide-y divide-slate-50">
              {queue.map((a) => (
                <div key={a.id} className="px-5 py-4 flex items-start gap-4 flex-wrap sm:flex-nowrap">
                  <Avatar name={a.profile?.name ?? '?'} url={a.profile?.avatar_url} size="md" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-800">
                      {a.profile?.name} · <span className="font-semibold">{a.title}</span>
                    </p>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      <Badge className="bg-slate-100 text-slate-600">
                        <CalendarDays className="w-3 h-3" /> {formatDate(a.work_date)}
                      </Badge>
                      <Badge className={PRIORITY_CONFIG[a.priority].color}>{PRIORITY_CONFIG[a.priority].label}</Badge>
                      <span className="text-xs text-slate-400">Gửi lúc {formatTime(a.submitted_at)}</span>
                    </div>
                    {a.submit_note && (
                      <p className="text-xs text-slate-500 mt-1.5 bg-slate-50 rounded-lg px-3 py-2">
                        Ghi chú: {a.submit_note}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Button size="sm" variant="success" onClick={() => handleApprove(a)} disabled={busy}>
                      <Check className="w-4 h-4" /> Xác nhận
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="!text-red-600 hover:!bg-red-50 hover:!border-red-300"
                      onClick={() => { setRejectTarget(a); setRejectReason(''); }}
                      disabled={busy}
                    >
                      <X className="w-4 h-4" /> Từ chối
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Điều hướng tuần + chú giải */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setWeekStart((w) => addDays(w, -7))}
            className="w-9 h-9 rounded-xl border border-slate-200 bg-white flex items-center justify-center text-slate-500 hover:bg-slate-50"
            aria-label="Tuần trước"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-sm font-semibold text-slate-700 min-w-[130px] text-center">
            Tuần {weekRangeLabel(weekStart)}
          </span>
          <button
            onClick={() => setWeekStart((w) => addDays(w, 7))}
            className="w-9 h-9 rounded-xl border border-slate-200 bg-white flex items-center justify-center text-slate-500 hover:bg-slate-50"
            aria-label="Tuần sau"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
          <Button size="sm" variant="ghost" onClick={() => setWeekStart(mondayOf(new Date()))}>
            Tuần này
          </Button>
          {weekAssignments.length > 0 && (
            <Button size="sm" variant="outline" onClick={handleCopyWeek} disabled={busy} title="Tạo lại toàn bộ phân công của tuần này cho tuần kế tiếp">
              <Copy className="w-3.5 h-3.5" /> Sao chép sang tuần sau
            </Button>
          )}
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {Object.entries(ASSIGNMENT_STATUS_CONFIG).map(([key, cfg]) => (
            <span key={key} className="flex items-center gap-1.5 text-xs text-slate-500">
              <span className={`w-2 h-2 rounded-full ${cfg.dot}`} /> {cfg.label}
            </span>
          ))}
        </div>
      </div>

      {/* Bảng phân công tuần */}
      <Card>
        <CardContent className="p-0">
          {staff.length === 0 ? (
            <EmptyState
              icon={<ClipboardList className="w-8 h-8" />}
              title="Chưa có nhân viên"
              description="Tạo tài khoản nhân viên trong Quản lý User trước, rồi quay lại giao việc."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] border-collapse">
                <thead>
                  <tr className="border-b border-slate-100">
                    <th className="text-left text-xs font-semibold text-slate-500 uppercase px-4 py-3 w-44 sticky left-0 bg-white z-10">
                      Thành viên
                    </th>
                    {days.map((d) => (
                      <th
                        key={d.toISOString()}
                        className={`text-center text-xs font-semibold uppercase px-2 py-3 ${
                          isToday(d) ? 'text-blue-600' : 'text-slate-500'
                        }`}
                      >
                        {dayLabel(d)}
                        {isToday(d) && <span className="block text-[10px] font-medium normal-case text-blue-500">Hôm nay</span>}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {staff.map((member) => (
                    <tr key={member.id} className="border-b border-slate-50 align-top">
                      <td className="px-4 py-3 sticky left-0 bg-white z-10">
                        <div className="flex items-center gap-2.5">
                          <Avatar name={member.name} url={member.avatar_url} size="sm" />
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-slate-800 truncate">{member.name}</p>
                            <p className="text-xs text-slate-400 truncate">{member.department || '—'}</p>
                          </div>
                        </div>
                      </td>
                      {days.map((d) => {
                        const cell = byCell.get(`${member.id}|${toDateString(d)}`) ?? [];
                        return (
                          <td
                            key={d.toISOString()}
                            className={`px-1.5 py-2 min-w-[110px] ${isToday(d) ? 'bg-blue-50/40' : ''}`}
                          >
                            <div className="space-y-1">
                              {cell.map((a) => {
                                const cfg = ASSIGNMENT_STATUS_CONFIG[a.status];
                                return (
                                  <button
                                    key={a.id}
                                    onClick={() => openDetail(a)}
                                    className={`w-full text-left flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-xs font-medium ${cfg.color} hover:brightness-95 transition`}
                                    title={`${a.title} — ${cfg.label}`}
                                  >
                                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${cfg.dot}`} />
                                    <span className="truncate">{a.title}</span>
                                  </button>
                                );
                              })}
                              <button
                                onClick={() => openAssign(member.id, d)}
                                className="w-full flex items-center justify-center py-1 rounded-lg text-slate-300 hover:text-blue-500 hover:bg-blue-50 transition"
                                aria-label={`Giao việc cho ${member.name} ${dayLabel(d)}`}
                              >
                                <Plus className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ================= Modal giao việc ================= */}
      <Modal open={assignOpen} onClose={() => setAssignOpen(false)} title="Giao việc" size="lg">
        <div className="space-y-5">
          {/* Thành viên */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-sm font-medium text-slate-700">Thành viên</label>
              <button
                className="text-xs font-medium text-blue-600 hover:text-blue-700"
                onClick={() =>
                  setSelMembers(selMembers.size === staff.length ? new Set() : new Set(staff.map((s) => s.id)))
                }
              >
                {selMembers.size === staff.length ? 'Bỏ chọn tất cả' : 'Chọn tất cả'}
              </button>
            </div>
            <div className="border border-slate-200 rounded-xl max-h-44 overflow-y-auto divide-y divide-slate-50">
              {staff.map((s) => (
                <label key={s.id} className="flex items-center gap-3 px-3.5 py-2.5 cursor-pointer hover:bg-slate-50">
                  <input
                    type="checkbox"
                    className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    checked={selMembers.has(s.id)}
                    onChange={(e) => {
                      const next = new Set(selMembers);
                      if (e.target.checked) next.add(s.id); else next.delete(s.id);
                      setSelMembers(next);
                    }}
                  />
                  <Avatar name={s.name} url={s.avatar_url} size="sm" />
                  <span className="text-sm text-slate-700">{s.name}</span>
                  <span className="text-xs text-slate-400 ml-auto">{s.department || ''}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Phạm vi thời gian */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Thời gian</label>
            <div className="flex gap-2 mb-3">
              {([
                { key: 'day', label: 'Một ngày' },
                { key: 'week', label: 'Cả tuần' },
              ] as const).map((m) => (
                <button
                  key={m.key}
                  onClick={() => setMode(m.key)}
                  className={`h-9 px-4 rounded-xl text-sm font-medium transition-colors ${
                    mode === m.key
                      ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/25'
                      : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>

            {mode === 'day' ? (
              <Input type="date" value={singleDate} onChange={(e) => setSingleDate(e.target.value)} />
            ) : (
              <div>
                <p className="text-xs text-slate-500 mb-2">
                  Tuần {weekRangeLabel(weekStart)} — chọn các ngày muốn giao (mỗi ngày tạo một phân công riêng):
                </p>
                <div className="flex gap-1.5 flex-wrap">
                  {days.map((d, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => {
                        const next = new Set(selDays);
                        if (next.has(i)) next.delete(i); else next.add(i);
                        setSelDays(next);
                      }}
                      className={`flex flex-col items-center px-3 py-2 rounded-xl text-xs font-semibold border transition-colors ${
                        selDays.has(i)
                          ? 'bg-blue-600 text-white border-blue-600'
                          : 'bg-white text-slate-500 border-slate-200 hover:border-blue-300'
                      }`}
                    >
                      {WEEKDAY_SHORT[i]}
                      <span className={`text-[10px] font-normal ${selDays.has(i) ? 'text-blue-100' : 'text-slate-400'}`}>
                        {String(d.getDate()).padStart(2, '0')}/{String(d.getMonth() + 1).padStart(2, '0')}
                      </span>
                    </button>
                  ))}
                </div>

                {/* Việc riêng từng ngày. Bỏ trống = dùng nội dung chung bên dưới,
                    nên ai chỉ cần giao một việc lặp cả tuần thì không phải gõ gì thêm. */}
                {selDays.size > 0 && (
                  <div className="mt-3 rounded-xl border border-slate-200 divide-y divide-slate-100">
                    <p className="px-3 py-2 text-xs text-slate-500 bg-slate-50 rounded-t-xl">
                      Việc riêng từng ngày — để trống thì lấy theo ô <strong>Công việc</strong> bên dưới.
                    </p>
                    {days.map((d, i) =>
                      selDays.has(i) ? (
                        <div key={i} className="flex items-center gap-2.5 px-3 py-2">
                          <span className="w-16 flex-shrink-0 text-xs font-semibold text-slate-600">
                            {WEEKDAY_SHORT[i]} {String(d.getDate()).padStart(2, '0')}/{String(d.getMonth() + 1).padStart(2, '0')}
                          </span>
                          <input
                            value={dayTitles[i] ?? ''}
                            onChange={(e) => setDayTitles((prev) => ({ ...prev, [i]: e.target.value }))}
                            placeholder={title.trim() || 'Việc của ngày này…'}
                            className="flex-1 h-9 px-3 rounded-lg border border-slate-200 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-blue-500"
                          />
                        </div>
                      ) : null,
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Nội dung việc */}
          <Input
            label={mode === 'week' ? 'Công việc (dùng chung cho ngày bỏ trống)' : 'Công việc'}
            placeholder="VD: Kiểm kê kho hàng khu A"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <Textarea
            label="Mô tả chi tiết (không bắt buộc)"
            rows={3}
            placeholder="Yêu cầu, tiêu chí hoàn thành..."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <Select label="Độ ưu tiên" value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)}>
            {Object.entries(PRIORITY_CONFIG).map(([value, cfg]) => (
              <option key={value} value={value}>{cfg.label}</option>
            ))}
          </Select>

          <div className="flex items-center justify-between gap-3 pt-2 border-t border-slate-100">
            <p className="text-xs text-slate-500">
              {selMembers.size > 0 && targets.length > 0
                ? `Sẽ tạo ${selMembers.size * targets.length} phân công (${selMembers.size} thành viên × ${targets.length} ngày` +
                  `${new Set(targets.map((t) => t.title)).size > 1 ? `, ${new Set(targets.map((t) => t.title)).size} việc khác nhau` : ''})`
                : 'Chọn thành viên và ngày để giao việc'}
            </p>
            <div className="flex gap-3">
              <Button variant="outline" onClick={() => setAssignOpen(false)} disabled={busy}>Hủy</Button>
              <Button onClick={handleAssign} disabled={busy}>
                {busy ? 'Đang giao…' : 'Giao việc'}
              </Button>
            </div>
          </div>
        </div>
      </Modal>

      {/* ================= Modal từ chối ================= */}
      <Modal open={!!rejectTarget} onClose={() => setRejectTarget(null)} title="Trả lại để làm lại" size="sm">
        <div className="space-y-4">
          {rejectTarget && (
            <div className="p-3 rounded-lg bg-slate-50">
              <p className="text-sm font-medium text-slate-800">{rejectTarget.title}</p>
              <p className="text-xs text-slate-500 mt-0.5">
                {rejectTarget.profile?.name} · {formatDate(rejectTarget.work_date)}
              </p>
            </div>
          )}
          <Textarea
            label="Lý do từ chối (bắt buộc)"
            rows={3}
            placeholder="VD: Thiếu số liệu khu B, bổ sung rồi gửi lại..."
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
          />
          <div className="flex gap-3 pt-1">
            <Button variant="outline" onClick={() => setRejectTarget(null)} className="flex-1" disabled={busy}>Hủy</Button>
            <Button variant="danger" onClick={handleReject} className="flex-1" disabled={busy}>
              {busy ? 'Đang gửi…' : 'Trả lại'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* ================= Modal chi tiết / sửa ================= */}
      <Modal
        open={!!detail}
        onClose={() => setDetail(null)}
        title={editing ? 'Sửa phân công' : 'Chi tiết công việc'}
        size="md"
      >
        {detail && (
          <div className="space-y-4">
            {!editing ? (
              <>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-base font-semibold text-slate-800">{detail.title}</p>
                    {detail.description && (
                      <p className="text-sm text-slate-500 mt-1 whitespace-pre-line">{detail.description}</p>
                    )}
                  </div>
                  <Badge className={ASSIGNMENT_STATUS_CONFIG[detail.status].color}>
                    {ASSIGNMENT_STATUS_CONFIG[detail.status].label}
                  </Badge>
                </div>

                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="bg-slate-50 rounded-lg p-3">
                    <p className="text-xs text-slate-400 mb-0.5">Thành viên</p>
                    <p className="font-medium text-slate-700">{detail.profile?.name ?? '—'}</p>
                  </div>
                  <div className="bg-slate-50 rounded-lg p-3">
                    <p className="text-xs text-slate-400 mb-0.5">Ngày làm</p>
                    <p className="font-medium text-slate-700">{formatDate(detail.work_date)}</p>
                  </div>
                  <div className="bg-slate-50 rounded-lg p-3">
                    <p className="text-xs text-slate-400 mb-0.5">Độ ưu tiên</p>
                    <p className="font-medium text-slate-700">{PRIORITY_CONFIG[detail.priority].label}</p>
                  </div>
                  <div className="bg-slate-50 rounded-lg p-3">
                    <p className="text-xs text-slate-400 mb-0.5">
                      {detail.status === 'submitted' ? 'Gửi lúc' : detail.status === 'approved' ? 'Xác nhận lúc' : 'Cập nhật'}
                    </p>
                    <p className="font-medium text-slate-700">
                      {detail.status === 'submitted'
                        ? formatTime(detail.submitted_at)
                        : detail.reviewed_at
                        ? formatTime(detail.reviewed_at)
                        : '—'}
                    </p>
                  </div>
                </div>

                {detail.submit_note && (
                  <div className="text-xs text-slate-600 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2">
                    Ghi chú của nhân viên: {detail.submit_note}
                  </div>
                )}
                {detail.status === 'rejected' && detail.review_note && (
                  <div className="text-xs text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                    Lý do trả lại: {detail.review_note}
                  </div>
                )}

                <div className="flex items-center justify-between gap-3 pt-3 border-t border-slate-100">
                  <div className="flex gap-2">
                    {(detail.status === 'pending' || detail.status === 'rejected') && (
                      <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                        <Pencil className="w-3.5 h-3.5" /> Sửa
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="!text-red-600 hover:!bg-red-50"
                      onClick={() => handleDelete(detail)}
                    >
                      <Trash2 className="w-3.5 h-3.5" /> Xóa
                    </Button>
                  </div>
                  {detail.status === 'submitted' && (
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="!text-red-600 hover:!bg-red-50 hover:!border-red-300"
                        onClick={() => { setRejectTarget(detail); setRejectReason(''); }}
                        disabled={busy}
                      >
                        <X className="w-4 h-4" /> Từ chối
                      </Button>
                      <Button size="sm" variant="success" onClick={() => handleApprove(detail)} disabled={busy}>
                        <Check className="w-4 h-4" /> Xác nhận
                      </Button>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <>
                <Input label="Công việc" value={editTitle} onChange={(e) => setEditTitle(e.target.value)} />
                <Textarea label="Mô tả" rows={3} value={editDesc} onChange={(e) => setEditDesc(e.target.value)} />
                <div className="grid grid-cols-2 gap-3">
                  <Select label="Độ ưu tiên" value={editPriority} onChange={(e) => setEditPriority(e.target.value as TaskPriority)}>
                    {Object.entries(PRIORITY_CONFIG).map(([value, cfg]) => (
                      <option key={value} value={value}>{cfg.label}</option>
                    ))}
                  </Select>
                  <Input label="Ngày làm" type="date" value={editDate} onChange={(e) => setEditDate(e.target.value)} />
                </div>
                <div className="flex gap-3 pt-2">
                  <Button variant="outline" onClick={() => setEditing(false)} className="flex-1" disabled={busy}>
                    Quay lại
                  </Button>
                  <Button onClick={handleSaveEdit} className="flex-1" disabled={busy}>
                    {busy ? 'Đang lưu…' : 'Lưu thay đổi'}
                  </Button>
                </div>
              </>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
