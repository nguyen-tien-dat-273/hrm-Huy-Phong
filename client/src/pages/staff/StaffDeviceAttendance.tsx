import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays, CheckCircle2, Clock, Fingerprint, History, ShieldCheck, ClipboardList, LogIn, LogOut } from 'lucide-react';
import { addDays } from 'date-fns';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { useRealtimeSync } from '@/hooks/useRealtimeSync';
import { supabase } from '@/lib/supabase';
import { describeDbError } from '@/lib/dbError';
import { formatDate, formatTime, getTodayString, toDateString } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Skeleton } from '@/components/ui/Skeleton';
import { ErrorState } from '@/components/ui/ErrorState';
import { Button } from '@/components/ui/Button';
import type { Attendance } from '@/types';

const sourceLabel = (record: Attendance) => {
  const method = String(record.check_in_method || '').toUpperCase();
  if (method === 'DEVICE') return 'Máy chấm công';
  if (method === 'MANUAL') return 'Ghi nhận trên HRM';
  return 'Dữ liệu kế thừa';
};

export function StaffDeviceAttendance() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [checkingOut, setCheckingOut] = useState(false);
  const [checkingIn, setCheckingIn] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [records, setRecords] = useState<Attendance[]>([]);

  const loadData = useCallback(async (silent = false) => {
    if (!profile) return;
    if (!silent) setLoading(true);
    const { data, error } = await supabase
      .from('attendance')
      .select('*')
      .eq('user_id', profile.id)
      .gte('date', toDateString(addDays(new Date(), -30)))
      .order('date', { ascending: false })
      .order('check_in_time', { ascending: false });
    setLoadError(error ? describeDbError(error) : null);
    setRecords((data || []) as Attendance[]);
    setLoading(false);
  }, [profile]);

  useEffect(() => { loadData(); }, [loadData]);
  useRealtimeSync(
    profile ? [{ table: 'attendance', filter: `user_id=eq.${profile.id}` }] : [],
    () => loadData(true),
    { enabled: !!profile, channelKey: `staff-device-attendance-${profile?.id || 'anonymous'}` },
  );

  const today = getTodayString();
  const todayRecord = records.find((record) => record.date === today) || null;
  const checkoutRecord = records.find((record) => {
    if (record.check_out_time || !record.check_in_time) return false;
    const ageHours = (Date.now() - new Date(record.check_in_time).getTime()) / 3_600_000;
    return ageHours >= 0 && ageHours <= 36;
  }) || null;
  const focusRecord = (todayRecord && !todayRecord.check_out_time ? todayRecord : checkoutRecord) || todayRecord;
  const summary = useMemo(() => ({
    present: new Set(records.map((record) => record.date)).size,
    device: new Set(records.filter((record) => String(record.check_in_method).toUpperCase() === 'DEVICE').map((record) => record.date)).size,
    approved: new Set(records.filter((record) => record.approved_by_lead).map((record) => record.date)).size,
  }), [records]);

  // Check-in trên HRM là LỐI NGOẠI LỆ: quên quét máy, hoặc làm ngoài văn
  // phòng. Đã quét máy rồi thì trigger attendance_block_manual_after_device
  // dưới database chặn — giao diện ẩn nút chỉ là lớp ngoài, người dùng gọi
  // thẳng API vẫn không tạo được dòng thứ hai cùng ngày.
  const handleCheckIn = async () => {
    if (!profile || todayRecord) return;
    setCheckingIn(true);
    const { error } = await supabase.from('attendance').insert({
      user_id: profile.id,
      date: today,
      check_in_time: new Date().toISOString(),
      status: 'active',
      check_in_method: 'MANUAL',
      approved_by_lead: false,
    });
    setCheckingIn(false);
    if (error) {
      toast(`Check-in thất bại: ${describeDbError(error)}`, 'error');
      await loadData(true);
      return;
    }
    toast('Đã check-in. Nhớ bấm Check-out khi về.', 'success');
    await loadData(true);
  };

  const handleCheckOut = async () => {
    if (!profile || !checkoutRecord) return;
    setCheckingOut(true);
    const { data, error } = await supabase
      .from('attendance')
      .update({ check_out_time: new Date().toISOString(), status: 'completed' })
      .eq('id', checkoutRecord.id)
      .eq('user_id', profile.id)
      .is('check_out_time', null)
      .select('id')
      .maybeSingle();
    setCheckingOut(false);
    if (error) {
      toast(`Checkout thất bại: ${describeDbError(error)}`, 'error');
      return;
    }
    if (!data) {
      toast('Bản ghi vừa được cập nhật ở nơi khác. Đang tải lại dữ liệu.', 'warning');
    } else {
      toast('Checkout thành công. Giờ ra đã được ghi nhận.', 'success');
    }
    await loadData(true);
  };

  if (loading) return <div className="space-y-5"><Skeleton className="h-16 w-full" /><Skeleton className="h-64 w-full rounded-2xl" /><Skeleton className="h-80 w-full rounded-2xl" /></div>;
  if (loadError) return <Card><ErrorState message={loadError} onRetry={() => loadData()} /></Card>;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-extrabold text-slate-900">Chấm công của tôi</h1>
          <p className="mt-1 text-sm text-slate-500">Xem dữ liệu vào ca được đồng bộ từ máy chấm công.</p>
        </div>
        <Link to="/staff/assignments" className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 shadow-sm hover:border-emerald-300 hover:text-emerald-700">
          <ClipboardList className="h-4 w-4" /> Việc được giao
        </Link>
      </div>

      <div className="flex items-start gap-3 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3.5 text-sm text-blue-900">
        <ShieldCheck className="mt-0.5 h-5 w-5 flex-shrink-0 text-blue-600" />
        <p className="leading-relaxed">
          <strong>Máy chấm công là nguồn chính ghi giờ vào.</strong> Quét ở máy rồi thì không cần
          check-in ở đây nữa — cuối ngày chỉ bấm <strong>Check-out</strong>. Nút check-in bên dưới
          chỉ dành cho hôm nào bạn chưa kịp quét máy.
        </p>
      </div>

      {!todayRecord && focusRecord && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3.5">
          <p className="text-sm text-slate-600">
            Hôm nay chưa có giờ vào — ca đang hiển thị bên dưới là ca cũ chưa checkout.
          </p>
          <Button theme="staff" onClick={handleCheckIn} disabled={checkingIn}>
            <LogIn className="h-4 w-4" />
            {checkingIn ? 'Đang check-in…' : 'Check-in hôm nay'}
          </Button>
        </div>
      )}

      <Card className="overflow-hidden">
        <div className="border-b border-slate-100 bg-gradient-to-r from-emerald-50 to-white px-5 py-4 sm:px-6">
          <div className="flex items-center gap-2 text-sm font-bold text-emerald-800"><CalendarDays className="h-4 w-4" />{focusRecord?.date === today ? 'Hôm nay' : 'Ca cần checkout'} · {formatDate(focusRecord?.date || today)}</div>
        </div>
        <CardContent className="p-5 sm:p-6">
          {!focusRecord ? (
            <div className="py-8 text-center">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-100 text-slate-400"><Fingerprint className="h-8 w-8" /></div>
              <h2 className="mt-4 font-display text-lg font-bold text-slate-800">Chưa có giờ vào hôm nay</h2>
              <p className="mx-auto mt-1 max-w-md text-sm leading-relaxed text-slate-500">
                Quét tại máy chấm công là cách thông thường; trang sẽ tự cập nhật sau lần đồng bộ
                kế tiếp. Nếu hôm nay bạn không quét được máy thì check-in ở đây.
              </p>
              <Button theme="staff" onClick={handleCheckIn} disabled={checkingIn} className="mt-5">
                <LogIn className="h-4 w-4" />
                {checkingIn ? 'Đang check-in…' : 'Check-in trên HRM'}
              </Button>
            </div>
          ) : (
            <div className="grid gap-5 lg:grid-cols-[1.15fr_0.85fr]">
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div><p className="text-xs font-bold uppercase tracking-widest text-emerald-700">Giờ vào đã ghi nhận</p><p className="mt-2 font-display text-4xl font-extrabold tabular-nums text-slate-900">{formatTime(focusRecord.check_in_time)}</p></div>
                  <Badge className="bg-white text-emerald-700 ring-1 ring-emerald-200"><Fingerprint className="mr-1 h-3.5 w-3.5" />{sourceLabel(focusRecord)}</Badge>
                </div>
                <p className="mt-4 text-sm leading-relaxed text-slate-600">{focusRecord.check_out_time ? `Checkout lúc ${formatTime(focusRecord.check_out_time)}` : 'Máy đã ghi giờ vào; bạn chưa checkout ca này.'}</p>
                {checkoutRecord?.id === focusRecord.id && (
                  <Button theme="staff" onClick={handleCheckOut} disabled={checkingOut} className="mt-5 w-full sm:w-auto">
                    <LogOut className="h-4 w-4" />
                    {checkingOut ? 'Đang checkout…' : 'Checkout cuối ngày'}
                  </Button>
                )}
              </div>
              <div className="space-y-3">
                <InfoRow icon={<CheckCircle2 className="h-4 w-4" />} label="Trạng thái" value={!focusRecord.check_out_time ? 'Đã vào ca · chờ checkout' : focusRecord.approved_by_lead ? 'Đã duyệt ngày công' : 'Đã checkout · chờ quản lý duyệt'} />
                <InfoRow icon={<Fingerprint className="h-4 w-4" />} label="Nguồn dữ liệu" value={sourceLabel(focusRecord)} />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <SummaryCard label="Ngày có mặt" value={summary.present} hint="Trong 31 ngày gần nhất" />
        <SummaryCard label="Từ máy chấm công" value={summary.device} hint="Ngày đồng bộ từ thiết bị" />
        <SummaryCard label="Đã xác nhận" value={summary.approved} hint="Ngày công đã được chốt" />
      </div>

      <Card className="overflow-hidden">
        <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-4 sm:px-6"><History className="h-5 w-5 text-slate-500" /><div><h2 className="font-display text-lg font-bold text-slate-900">Lịch sử gần đây</h2><p className="text-xs text-slate-500">Dữ liệu 31 ngày gần nhất, mới nhất ở trên.</p></div></div>
        {records.length === 0 ? <div className="px-5 py-12 text-center text-sm text-slate-500">Chưa có dữ liệu chấm công.</div> : (
          <div className="divide-y divide-slate-100">{records.map((record) => (
            <div key={record.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 sm:px-6">
              <div className="flex min-w-0 items-center gap-3"><div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-500"><Clock className="h-4.5 w-4.5" /></div><div><p className="font-semibold text-slate-800">{formatDate(record.date)}</p><p className="mt-0.5 text-xs text-slate-500">Vào {formatTime(record.check_in_time)}{record.check_out_time ? ` · Ra ${formatTime(record.check_out_time)}` : ' · Thiếu checkout'}</p></div></div>
              <div className="flex flex-wrap items-center gap-2"><Badge className="bg-slate-100 text-slate-600">{sourceLabel(record)}</Badge><Badge className={record.approved_by_lead ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}>{record.approved_by_lead ? 'Đã xác nhận' : 'Chờ đối soát'}</Badge></div>
            </div>
          ))}</div>
        )}
      </Card>
    </div>
  );
}

function InfoRow({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3.5 py-3"><span className="text-slate-400">{icon}</span><div className="min-w-0"><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</p><p className="truncate text-sm font-semibold text-slate-700">{value}</p></div></div>;
}

function SummaryCard({ label, value, hint }: { label: string; value: number; hint: string }) {
  return <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4 shadow-sm"><p className="text-xs font-semibold text-slate-500">{label}</p><p className="mt-1 font-display text-2xl font-extrabold text-slate-900">{value}</p><p className="mt-0.5 text-xs text-slate-400">{hint}</p></div>;
}
