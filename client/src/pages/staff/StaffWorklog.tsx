import { useEffect, useState } from 'react';
import { describeDbErrorOrNull } from '@/lib/dbError';
import { ChevronLeft, ChevronRight, CalendarDays, NotebookPen, Save, TriangleAlert, CheckCircle2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/contexts/ToastContext';
import { useAuth } from '@/contexts/AuthContext';
import { useRealtimeSync } from '@/hooks/useRealtimeSync';
import { supabase } from '@/lib/supabase';
import {
  addDays, UNLOGGED_TOLERANCE_HOURS, attendanceHours, fetchDayEntries, formatHours, saveDayEntries, type WorklogEntry,
} from '@/lib/worklog';
import { getTodayString, toDateString } from '@/lib/utils';
import type { Attendance } from '@/types';

export function StaffWorklog() {
  const { profile } = useAuth();
  const { toast } = useToast();

  const [date, setDate] = useState(() => getTodayString());
  const [entries, setEntries] = useState<WorklogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [attendance, setAttendance] = useState<Attendance | null>(null);

  useEffect(() => {
    if (profile) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, date]);

  // KHÔNG nạp lại khi đang có sửa đổi chưa lưu: hàm load() gọi setDirty(false)
  // và ghi đè toàn bộ ô nhập, người dùng sẽ mất số giờ vừa gõ dở mà không hiểu
  // vì sao. Đợi họ lưu hoặc đổi ngày rồi mới đồng bộ lại.
  useRealtimeSync(
    profile
      ? [
          { table: 'task_worklogs', filter: `user_id=eq.${profile.id}` },
          { table: 'attendance', filter: `user_id=eq.${profile.id}` },
        ]
      : [],
    () => { if (!dirty) load(true); },
    { enabled: !!profile },
  );

  const load = async (silent = false) => {
    if (!profile) return;
    if (!silent) setLoading(true);
    setDirty(false);

    const [entryResult, attResult] = await Promise.all([
      fetchDayEntries(profile.id, date),
      // KHONG dung `maybeSingle()`: no nem loi khi co nhieu hon mot dong.
      //
      // Mot ngay lam hai ca (sang, toi) la chuyen binh thuong va he thong cho
      // phep - chi cam hai dong cung DANG MO (chi muc
      // attendance_one_open_per_user_day). Dung maybeSingle thi dung nguoi
      // lam hai ca se thay trang nhat ky gio bao loi, khong vao duoc.
      supabase.from('attendance').select('*').eq('user_id', profile.id).eq('date', date)
        .order('check_in_time', { ascending: true }),
    ]);

    setLoadError(entryResult.error ?? describeDbErrorOrNull(attResult.error) ?? null);
    setEntries(entryResult.entries);
    // Lay ca dau tien trong ngay lam moc gio vao.
    setAttendance(((attResult.data ?? [])[0] as Attendance) ?? null);
    setLoading(false);
  };

  const setHours = (taskId: string, raw: string) => {
    const value = raw === '' ? 0 : Math.max(0, Math.min(24, Number(raw)));
    if (Number.isNaN(value)) return;
    setEntries((prev) => prev.map((e) => (e.task.id === taskId ? { ...e, hours: value } : e)));
    setDirty(true);
  };

  const setNote = (taskId: string, note: string) => {
    setEntries((prev) => prev.map((e) => (e.task.id === taskId ? { ...e, note } : e)));
    setDirty(true);
  };

  const handleSave = async () => {
    if (!profile) return;
    setSaving(true);
    const { error } = await saveDayEntries(profile.id, date, entries);
    setSaving(false);

    if (error) {
      toast(error, 'error');
      return;
    }
    toast('Đã lưu nhật ký.', 'success');
    load();
  };

  const totalLogged = entries.reduce((sum, e) => sum + e.hours, 0);
  const presentHours = attendanceHours(attendance ?? undefined);
  const gap = presentHours !== null ? Math.round((presentHours - totalLogged) * 10) / 10 : null;

  const shiftDate = (days: number) => setDate(toDateString(addDays(new Date(`${date}T00:00:00`), days)));
  const isToday = date === getTodayString();

  return (
    <div className="space-y-4">
      {/* Chọn ngày */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <button onClick={() => shiftDate(-1)} className="p-2 rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-50 transition-colors" aria-label="Ngày trước">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button onClick={() => shiftDate(1)} className="p-2 rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-50 transition-colors" aria-label="Ngày sau">
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          max={getTodayString()}
          className="h-10 px-3 rounded-xl border border-slate-200 text-sm focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
        />

        <p className="text-sm text-slate-500">
          {new Date(`${date}T00:00:00`).toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit' })}
        </p>

        {!isToday && (
          <Button variant="outline" size="sm" onClick={() => setDate(getTodayString())}>
            <CalendarDays className="w-4 h-4" />
            Hôm nay
          </Button>
        )}
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-5 space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14" />)}</div>
          ) : loadError ? (
            <ErrorState message={loadError} onRetry={load} />
          ) : entries.length === 0 ? (
            <EmptyState
              icon={<NotebookPen className="w-8 h-8" />}
              title="Không có tác vụ nào để ghi giờ"
              description="Bạn chưa được giao tác vụ nào đang mở. Khi có, chúng sẽ hiện tại đây."
            />
          ) : (
            <div className="divide-y divide-slate-50">
              {entries.map((entry) => (
                <div key={entry.task.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-800 truncate">{entry.task.title}</p>
                    <p className="text-xs text-slate-400 truncate">
                      {entry.task.project?.name ?? '—'}
                      {entry.task.estimated_hours ? ` · ước lượng ${formatHours(Number(entry.task.estimated_hours))}` : ''}
                    </p>
                  </div>

                  <input
                    type="text"
                    inputMode="decimal"
                    value={entry.hours === 0 ? '' : entry.hours}
                    onChange={(e) => setHours(entry.task.id, e.target.value.replace(',', '.'))}
                    placeholder="0"
                    aria-label={`Số giờ cho ${entry.task.title}`}
                    className="w-20 h-10 px-3 text-center rounded-xl border border-slate-200 text-sm font-semibold text-slate-800 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                  />
                  <span className="text-sm text-slate-400 -ml-1.5">giờ</span>

                  <input
                    type="text"
                    value={entry.note}
                    onChange={(e) => setNote(entry.task.id, e.target.value)}
                    placeholder="Ghi chú (không bắt buộc)"
                    aria-label={`Ghi chú cho ${entry.task.title}`}
                    className="w-full sm:w-56 h-10 px-3 rounded-xl border border-slate-200 text-sm focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                  />
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Tổng kết + đối chiếu chấm công */}
      {!loading && !loadError && entries.length > 0 && (
        <Card>
          <CardContent>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="text-sm text-slate-500">Tổng đã ghi</p>
                <p className="font-display text-3xl font-extrabold text-slate-800">{formatHours(totalLogged)}</p>
              </div>

              <div className="text-sm">
                {presentHours === null ? (
                  <p className="text-slate-400">
                    {attendance ? 'Chưa check-out nên chưa tính được giờ có mặt.' : 'Không có dữ liệu chấm công ngày này.'}
                  </p>
                ) : gap !== null && gap > UNLOGGED_TOLERANCE_HOURS ? (
                  <p className="flex items-start gap-2 text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3.5 py-2.5">
                    <TriangleAlert className="w-4.5 h-4.5 flex-shrink-0 mt-0.5" />
                    <span>
                      Chấm công ghi nhận <strong>{formatHours(presentHours)}</strong> có mặt, nhật ký mới khai{' '}
                      <strong>{formatHours(totalLogged)}</strong> — còn <strong>{formatHours(gap)}</strong> chưa rõ.
                    </span>
                  </p>
                ) : gap !== null && gap < -UNLOGGED_TOLERANCE_HOURS ? (
                  <p className="flex items-start gap-2 text-blue-700 bg-blue-50 border border-blue-200 rounded-xl px-3.5 py-2.5">
                    <TriangleAlert className="w-4.5 h-4.5 flex-shrink-0 mt-0.5" />
                    <span>
                      Khai <strong>{formatHours(Math.abs(gap))}</strong> nhiều hơn giờ có mặt ({formatHours(presentHours)}).
                      Có thể bạn làm thêm ngoài giờ chấm công.
                    </span>
                  </p>
                ) : (
                  <p className="flex items-center gap-2 text-emerald-700">
                    <CheckCircle2 className="w-4.5 h-4.5" />
                    Khớp với chấm công ({formatHours(presentHours)} có mặt).
                  </p>
                )}
              </div>

              <Button onClick={handleSave} disabled={saving || !dirty} className="w-full sm:w-auto">
                <Save className="w-4 h-4" />
                {saving ? 'Đang lưu...' : dirty ? 'Lưu nhật ký' : 'Đã lưu'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {!loading && entries.some((e) => e.task.status === 'done') && (
        <p className="text-xs text-slate-400">
          Tác vụ đã hoàn thành vẫn hiện nếu bạn từng ghi giờ cho nó ngày này —{' '}
          <Badge className="bg-slate-100 text-slate-600">không nuốt mất dữ liệu đã nhập</Badge>
        </p>
      )}
    </div>
  );
}
