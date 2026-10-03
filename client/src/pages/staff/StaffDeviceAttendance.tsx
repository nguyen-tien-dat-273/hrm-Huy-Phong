import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays, CheckCircle2, Clock, Fingerprint, History, ShieldCheck, ClipboardList, LogOut } from 'lucide-react';
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
  if (method === 'MANUAL') return 'Quản trị ghi nhận';
  return 'Dữ liệu kế thừa';
};

export function StaffDeviceAttendance() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [checkingOut, setCheckingOut] = useState(false);
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
  const summary = useMemo(() => ({
    present: new Set(records.map((record) => record.date)).size,
    device: new Set(records.filter((record) => String(record.check_in_method).toUpperCase() === 'DEVICE').map((record) => record.date)).size,
    approved: new Set(records.filter((record) => record.approved_by_lead).map((record) => record.date)).size,
  }), [records]);

  const handleCheckOut = async () => {
    if (!profile || !todayRecord || todayRecord.check_out_time) return;
    setCheckingOut(true);
    const { data, error } = await supabase
      .from('attendance')
      .update({ check_out_time: new Date().toISOString(), status: 'completed' })
      .eq('id', todayRecord.id)
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
        <p className="leading-relaxed"><strong>Dữ liệu máy là nguồn ghi nhận giờ vào.</strong> Bạn không cần check-in hoặc cấp quyền vị trí trên trang này; cuối ngày chỉ cần checkout.</p>
      </div>

      <Card className="overflow-hidden">
        <div className="border-b border-slate-100 bg-gradient-to-r from-emerald-50 to-white px-5 py-4 sm:px-6">
          <div className="flex items-center gap-2 text-sm font-bold text-emerald-800"><CalendarDays className="h-4 w-4" />Hôm nay · {formatDate(today)}</div>
        </div>
        <CardContent className="p-5 sm:p-6">
          {!todayRecord ? (
            <div className="py-8 text-center">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-100 text-slate-400"><Fingerprint className="h-8 w-8" /></div>
              <h2 className="mt-4 font-display text-lg font-bold text-slate-800">Chưa có dữ liệu vào ca hôm nay</h2>
              <p className="mx-auto mt-1 max-w-md text-sm leading-relaxed text-slate-500">Hãy quét tại máy chấm công. Trang sẽ tự cập nhật sau lần đồng bộ kế tiếp.</p>
            </div>
          ) : (
            <div className="grid gap-5 lg:grid-cols-[1.15fr_0.85fr]">
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div><p className="text-xs font-bold uppercase tracking-widest text-emerald-700">Giờ vào đã ghi nhận</p><p className="mt-2 font-display text-4xl font-extrabold tabular-nums text-slate-900">{formatTime(todayRecord.check_in_time)}</p></div>
                  <Badge className="bg-white text-emerald-700 ring-1 ring-emerald-200"><Fingerprint className="mr-1 h-3.5 w-3.5" />{sourceLabel(todayRecord)}</Badge>
                </div>
                <p className="mt-4 text-sm leading-relaxed text-slate-600">{todayRecord.check_out_time ? `Checkout lúc ${formatTime(todayRecord.check_out_time)}` : 'Máy đã ghi giờ vào; bạn chưa checkout hôm nay.'}</p>
                {!todayRecord.check_out_time && (
                  <Button theme="staff" onClick={handleCheckOut} disabled={checkingOut} className="mt-5 w-full sm:w-auto">
                    <LogOut className="h-4 w-4" />
                    {checkingOut ? 'Đang checkout…' : 'Checkout cuối ngày'}
                  </Button>
                )}
              </div>
              <div className="space-y-3">
                <InfoRow icon={<CheckCircle2 className="h-4 w-4" />} label="Trạng thái" value={todayRecord.approved_by_lead ? 'Đã xác nhận ngày công' : 'Đang chờ đối soát'} />
                <InfoRow icon={<Fingerprint className="h-4 w-4" />} label="Nguồn dữ liệu" value={sourceLabel(todayRecord)} />
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
              <div className="flex min-w-0 items-center gap-3"><div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-500"><Clock className="h-4.5 w-4.5" /></div><div><p className="font-semibold text-slate-800">{formatDate(record.date)}</p><p className="mt-0.5 text-xs text-slate-500">Vào {formatTime(record.check_in_time)}{record.check_out_time ? ` · Giờ ra kế thừa ${formatTime(record.check_out_time)}` : ' · Không ghi nhận giờ ra'}</p></div></div>
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
