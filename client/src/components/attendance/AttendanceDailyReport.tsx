// ============================================================================
// Báo cáo công theo ngày — một ngày, từng người có mặt / nghỉ / vắng, giờ vào ra,
// đi muộn, về sớm và các đơn (muộn, sớm, OT, ca đêm) phát sinh trong ngày.
// Số liệu tính ở `loadDailyAttendanceReport` cùng cách đo với báo cáo tháng.
// ============================================================================

import { useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Dropdown } from '@/components/ui/Dropdown';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { ExportButtons } from '@/components/payroll/ExportButtons';
import { Pager } from '@/components/payroll/Pager';
import { useRealtimeSync } from '@/hooks/useRealtimeSync';
import { formatDate, getTodayString, toDateString } from '@/lib/utils';
import {
  DAILY_PRESENCE_LABEL,
  loadDailyAttendanceReport,
  type DailyAttendanceReport,
  type DailyAttendanceRow,
  type DailyPresence,
} from '@/lib/attendanceReportData';
import type { ExportOptions } from '@/lib/tableExport';

const ITEMS_PER_PAGE = 20;

const PRESENCE_STYLE: Record<DailyPresence, string> = {
  PRESENT: 'border border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300',
  LEAVE: 'border border-violet-300 bg-violet-50 text-violet-800 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-300',
  ABSENT: 'border border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300',
  DAY_OFF: 'border border-slate-300 bg-slate-100 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300',
};

const REQUEST_STATUS_STYLE: Record<string, string> = {
  APPROVED: 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300',
  PENDING: 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300',
  REJECTED: 'border-red-300 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300',
};

const REQUEST_STATUS_LABEL: Record<string, string> = { APPROVED: 'đã duyệt', PENDING: 'chờ duyệt', REJECTED: 'từ chối' };

const clock = (timestamp: string | null) => (timestamp ? format(new Date(timestamp), 'HH:mm') : '—');

const shiftDay = (iso: string, delta: number) => {
  const next = new Date(`${iso}T00:00:00`);
  next.setDate(next.getDate() + delta);
  return toDateString(next);
};

export function AttendanceDailyReport() {
  const [date, setDate] = useState(getTodayString);
  const [data, setData] = useState<DailyAttendanceReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);

  const load = async (silent = false) => {
    if (!silent) setLoading(true);
    setData(await loadDailyAttendanceReport(date));
    setLoading(false);
  };

  useEffect(() => { void load(); }, [date]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setPage(1); }, [date, search, deptFilter, statusFilter]);

  useRealtimeSync(
    [{ table: 'attendance' }, { table: 'attendance_requests' }, { table: 'leave_requests' }, { table: 'work_schedules' }],
    () => { void load(true); },
    { channelKey: 'attendance-daily-report' },
  );

  const departmentOptions = useMemo(() => {
    const depts = new Set<string>();
    for (const row of data?.rows ?? []) if (row.profile.department) depts.add(row.profile.department);
    return [{ value: '', label: 'Tất cả phòng ban' }, ...Array.from(depts).sort().map((d) => ({ value: d, label: d }))];
  }, [data]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return (data?.rows ?? []).filter((row) => {
      if (q && !row.profile.name.toLowerCase().includes(q) && !(row.profile.employee_code ?? '').toLowerCase().includes(q)) return false;
      if (deptFilter && row.profile.department !== deptFilter) return false;
      switch (statusFilter) {
        case 'PRESENT': case 'LEAVE': case 'ABSENT': return row.presence === statusFilter;
        case 'LATE': return row.lateMinutes > 0;
        case 'EARLY': return row.earlyMinutes > 0;
        case 'MISSING_CHECKOUT': return row.missingCheckout;
        case 'HAS_REQUEST': return row.requests.length > 0;
        case 'PENDING_REQUEST': return row.requests.some((r) => r.status === 'PENDING');
        default: return true;
      }
    });
  }, [data, search, deptFilter, statusFilter]);

  const paged = filtered.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE);

  const requestText = (row: DailyAttendanceRow) => row.requests.map((r) =>
    `${r.label}${r.minutes != null ? ` ${r.minutes} phút` : ''}${r.hours != null ? ` ${r.hours} giờ` : ''} (${REQUEST_STATUS_LABEL[r.status] ?? r.status})`).join('; ');

  const exportOptions = (): ExportOptions<DailyAttendanceRow> => ({
    filename: `Bao_cao_cong_ngay_${date.replace(/-/g, '_')}`,
    sheetName: 'Công theo ngày',
    title: `BÁO CÁO CÔNG NGÀY ${formatDate(date)} (${data?.weekday ?? ''})`,
    subtitle: data
      ? `Có mặt: ${data.present} | Nghỉ phép: ${data.onLeave} | Vắng: ${data.absent} | Đi muộn: ${data.late} | Về sớm: ${data.early}`
      : undefined,
    columns: [
      { header: 'Mã NV', value: (r) => r.profile.employee_code ?? '' },
      { header: 'Họ và tên', value: (r) => r.profile.name },
      { header: 'Phòng ban', value: (r) => r.profile.department ?? '' },
      { header: 'Trạng thái', value: (r) => r.leaveLabel ? `${DAILY_PRESENCE_LABEL[r.presence]} - ${r.leaveLabel}` : DAILY_PRESENCE_LABEL[r.presence] },
      { header: 'Giờ vào', value: (r) => (r.checkIn ? clock(r.checkIn) : '') },
      { header: 'Giờ ra', value: (r) => (r.checkOut ? clock(r.checkOut) : '') },
      { header: 'Giờ làm (h)', value: (r) => r.workHours },
      { header: 'Đi muộn (phút)', value: (r) => r.lateMinutes },
      { header: 'Về sớm (phút)', value: (r) => r.earlyMinutes },
      { header: 'Quên checkout', value: (r) => (r.missingCheckout ? 'Có' : '') },
      { header: 'OT đã duyệt (h)', value: (r) => r.otApprovedHours },
      { header: 'Ca đêm', value: (r) => (r.nightApproved ? '1 công' : '') },
      { header: 'Đơn trong ngày', value: requestText },
    ],
    rows: filtered,
  });

  const cards: Array<{ label: string; value: string | number; sub?: string; tone?: string }> = data ? [
    { label: 'Có mặt', value: data.present, sub: `${data.rows.length} nhân sự`, tone: 'text-emerald-600 dark:text-emerald-400' },
    { label: 'Nghỉ phép', value: data.onLeave, tone: 'text-violet-600 dark:text-violet-400' },
    { label: 'Vắng', value: data.isWorkingDay ? data.absent : 0, sub: data.isWorkingDay ? 'Không đi làm, không có đơn nghỉ' : 'Không phải ngày làm việc', tone: data.absent > 0 && data.isWorkingDay ? 'text-red-600 dark:text-red-400' : undefined },
    { label: 'Đi muộn / Về sớm', value: `${data.late} / ${data.early}`, sub: `${data.missingCheckout} quên checkout` },
    { label: 'OT đã duyệt', value: `${data.otApprovedHours}h`, sub: `${data.nightWorkers} người làm ca đêm` },
    { label: 'Đơn chờ duyệt', value: data.pendingRequests, tone: data.pendingRequests > 0 ? 'text-amber-600 dark:text-amber-400' : undefined },
  ] : [];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2.5 border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900 rounded-none no-print">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" aria-label="Ngày trước" onClick={() => setDate(shiftDay(date, -1))}><ChevronLeft className="h-4 w-4" /></Button>
          <input
            type="date"
            aria-label="Chọn ngày"
            value={date}
            onChange={(e) => e.target.value && setDate(e.target.value)}
            className="h-8 border border-slate-200 bg-white px-2.5 text-xs outline-none focus:border-indigo-500 rounded-lg dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
          />
          <Button variant="outline" size="sm" aria-label="Ngày sau" onClick={() => setDate(shiftDay(date, 1))}><ChevronRight className="h-4 w-4" /></Button>
          <Button variant="outline" size="sm" onClick={() => setDate(getTodayString())} disabled={date === getTodayString()}>Hôm nay</Button>
        </div>
        <ExportButtons options={exportOptions} disabled={!data || filtered.length === 0} />
      </div>

      {loading ? (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-20 w-full !rounded-none" />)}
          </div>
          <Skeleton className="h-80 w-full !rounded-none" />
        </>
      ) : !data ? null : data.error ? (
        <ErrorState message={data.error} onRetry={() => void load()} />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 text-sm font-bold text-slate-800 dark:text-slate-100">
            <span>{data.weekday}, {formatDate(date)}</span>
            {data.holidayName && <span className="border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300 rounded-full">Ngày lễ: {data.holidayName}</span>}
            {!data.holidayName && !data.isWorkingDay && <span className="border border-slate-300 bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 rounded-full">Ngày nghỉ hằng tuần</span>}
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {cards.map((card) => (
              <div key={card.label} className="border border-slate-200 bg-white p-3.5 dark:border-slate-800 dark:bg-slate-900 rounded-none shadow-2xs">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">{card.label}</span>
                <div className={`mt-2 font-mono text-xl font-bold ${card.tone ?? 'text-slate-900 dark:text-slate-100'}`}>{card.value}</div>
                {card.sub && <div className="mt-1 text-[11px] text-slate-400">{card.sub}</div>}
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2.5 border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900 rounded-none no-print">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative w-full sm:w-60">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Tìm theo tên hoặc mã NV…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="h-8 w-full border border-slate-200 bg-white pl-8 pr-2.5 text-xs outline-none focus:border-indigo-500 rounded-lg dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>
              <div className="w-full sm:w-52">
                <Dropdown aria-label="Phòng ban" searchable value={deptFilter} options={departmentOptions} onChange={setDeptFilter} />
              </div>
              <div className="w-full sm:w-52">
                <Dropdown
                  aria-label="Lọc trạng thái"
                  value={statusFilter}
                  options={[
                    { value: '', label: 'Tất cả nhân sự' },
                    { value: 'PRESENT', label: 'Có mặt' },
                    { value: 'LEAVE', label: 'Nghỉ phép' },
                    { value: 'ABSENT', label: 'Vắng' },
                    { value: 'LATE', label: 'Đi muộn' },
                    { value: 'EARLY', label: 'Về sớm' },
                    { value: 'MISSING_CHECKOUT', label: 'Quên checkout' },
                    { value: 'HAS_REQUEST', label: 'Có đơn trong ngày' },
                    { value: 'PENDING_REQUEST', label: 'Có đơn chờ duyệt' },
                  ]}
                  onChange={setStatusFilter}
                />
              </div>
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400">
              Tổng số: <strong>{filtered.length}</strong> / {data.rows.length} nhân sự
            </div>
          </div>

          {filtered.length === 0 ? (
            <EmptyState title="Không có nhân sự nào" description="Hãy đổi ngày hoặc bỏ bớt tiêu chí lọc." />
          ) : (
            <div className="border-2 border-slate-400 dark:border-slate-600 bg-white dark:bg-slate-900 rounded-xl overflow-hidden shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="border-b-2 border-[#bf1f2b] dark:border-[#e66a76] bg-[#fdf2f4] dark:bg-[#201114] text-xs font-black uppercase tracking-wider text-[#5c0f16] dark:text-[#fde8ea] shadow-[inset_0_-2px_0_#bf1f2b] dark:shadow-[inset_0_-2px_0_#e66a76]">
                    <tr>
                      <th className="px-2.5 py-1.5">Nhân viên</th>
                      <th className="px-2 py-1.5 text-center">Trạng thái</th>
                      <th className="px-2 py-1.5 text-center">Vào</th>
                      <th className="px-2 py-1.5 text-center">Ra</th>
                      <th className="px-2 py-1.5 text-right">Giờ làm</th>
                      <th className="px-2 py-1.5 text-center">Đi muộn</th>
                      <th className="px-2 py-1.5 text-center">Về sớm</th>
                      <th className="px-2.5 py-1.5">Đơn trong ngày</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-300 dark:divide-slate-700 bg-white dark:bg-slate-900 font-semibold">
                    {paged.map((row) => (
                      <tr key={row.profile.id} className="align-top transition-colors hover:bg-slate-100/80 dark:hover:bg-slate-800/60">
                        <td className="px-2.5 py-1.5">
                          <div className="flex items-center gap-1.5">
                            <p className="truncate font-black text-xs text-slate-900 dark:text-slate-100">{row.profile.name}</p>
                            {row.profile.employee_code && (
                              <span className="border border-slate-300 bg-slate-100 px-1 font-mono text-[10px] font-bold text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 rounded">{row.profile.employee_code}</span>
                            )}
                          </div>
                          <p className="truncate text-[10px] font-medium text-slate-500 dark:text-slate-400">{row.profile.department || '—'}</p>
                        </td>
                        <td className="px-2 py-1.5 text-center">
                          <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-bold ${PRESENCE_STYLE[row.presence]}`}>{DAILY_PRESENCE_LABEL[row.presence]}</span>
                          {row.leaveLabel && <p className="mt-0.5 text-[10px] font-medium text-slate-500 dark:text-slate-400">{row.leaveLabel}</p>}
                        </td>
                        <td className="px-2 py-1.5 text-center font-mono text-xs text-slate-800 dark:text-slate-200">{clock(row.checkIn)}</td>
                        <td className="px-2 py-1.5 text-center font-mono text-xs text-slate-800 dark:text-slate-200">
                          {row.missingCheckout ? <span className="font-bold text-red-600 dark:text-red-400">Quên</span> : clock(row.checkOut)}
                        </td>
                        <td className="px-2 py-1.5 text-right font-mono text-xs text-slate-800 dark:text-slate-200">{row.workHours > 0 ? `${row.workHours}h` : '—'}</td>
                        <td className="px-2 py-1.5 text-center font-mono text-xs">
                          {row.lateMinutes > 0 ? <span className="font-bold text-red-600 dark:text-red-400">{row.lateMinutes} phút</span> : <span className="text-slate-400">—</span>}
                        </td>
                        <td className="px-2 py-1.5 text-center font-mono text-xs">
                          {row.earlyMinutes > 0 ? <span className="font-bold text-amber-600 dark:text-amber-400">{row.earlyMinutes} phút</span> : <span className="text-slate-400">—</span>}
                        </td>
                        <td className="px-2.5 py-1.5">
                          {row.requests.length === 0 ? <span className="text-slate-400">—</span> : (
                            <div className="flex flex-wrap gap-1">
                              {row.requests.map((r) => (
                                <span key={r.type} className={`border px-1.5 py-0.5 text-[10px] font-bold rounded ${REQUEST_STATUS_STYLE[r.status] ?? REQUEST_STATUS_STYLE.PENDING}`}>
                                  {r.label}
                                  {r.minutes != null && ` ${r.minutes}p`}
                                  {r.hours != null && ` ${r.hours}h`}
                                  {' · '}{REQUEST_STATUS_LABEL[r.status] ?? r.status}
                                </span>
                              ))}
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          <Pager page={page} total={filtered.length} size={ITEMS_PER_PAGE} noun="nhân sự" onPage={setPage} />
        </>
      )}
    </div>
  );
}
