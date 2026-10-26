import { useEffect, useMemo, useState } from 'react';
import { startOfMonth, format } from 'date-fns';
import {
  BarChart, Bar, CartesianGrid, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend
} from 'recharts';
import {
  CalendarDays, Clock, AlertTriangle, Briefcase, UserCheck, Flame,
  Search, Eye, Award, TrendingUp, Layers, CheckCircle2,
  ArrowUpDown
} from 'lucide-react';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Dropdown } from '@/components/ui/Dropdown';
import { MonthNav } from '@/components/ui/MonthNav';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { ExportButtons } from '@/components/payroll/ExportButtons';
import { Pager } from '@/components/payroll/Pager';
import { useRealtimeSync } from '@/hooks/useRealtimeSync';
import { toDateString } from '@/lib/utils';
import {
  loadAttendanceReportWorkspace,
  type AttendanceReportWorkspace,
  type EmployeeAttendanceRollup,
  type DisciplineGrade,
} from '@/lib/attendanceReportData';
import { AttendanceDailyReport } from '@/components/attendance/AttendanceDailyReport';
import { EmployeeAttendanceModal } from '@/components/attendance/EmployeeAttendanceModal';
import type { ExportOptions } from '@/lib/tableExport';

type TabKey = 'charts' | 'summary' | 'daily';

const TAB_ITEMS: Array<{ key: TabKey; label: string; icon: any }> = [
  { key: 'charts', label: 'Biểu đồ & Phân tích', icon: TrendingUp },
  { key: 'summary', label: 'Bảng tổng hợp công', icon: Layers },
  { key: 'daily', label: 'Báo cáo theo ngày', icon: CalendarDays },
];

const GRADE_PILL: Record<DisciplineGrade, { label: string; class: string }> = {
  EXCELLENT: { label: 'Xuất sắc', class: 'border border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300' },
  GOOD: { label: 'Tốt', class: 'border border-blue-300 bg-blue-50 text-blue-800 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300' },
  FAIR: { label: 'Trung bình', class: 'border border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300' },
  WARNING: { label: 'Cần lưu ý', class: 'border border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300' },
};

const ITEMS_PER_PAGE = 20;


export function AdminAttendanceReports() {
  const [monthStart, setMonthStart] = useState(() => startOfMonth(new Date()));
  const monthStartStr = toDateString(monthStart);

  // Mặc định auto pick vào tab Biểu đồ trước theo yêu cầu
  const [activeTab, setActiveTab] = useState<TabKey>('charts');
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<AttendanceReportWorkspace | null>(null);

  // Bộ lọc & Tìm kiếm cho bảng tổng hợp
  const [searchQuery, setSearchQuery] = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  const [gradeFilter, setGradeFilter] = useState('');
  const [sortField, setSortField] = useState<keyof EmployeeAttendanceRollup>('workDays');
  const [sortAsc, setSortAsc] = useState(false);
  const [page, setPage] = useState(1);

  // Modal xem chi tiết từng người
  const [selectedRollup, setSelectedRollup] = useState<EmployeeAttendanceRollup | null>(null);

  const loadData = async (silent = false) => {
    if (!silent) setLoading(true);
    const result = await loadAttendanceReportWorkspace(monthStartStr);
    setData(result);
    setLoading(false);
  };

  useEffect(() => {
    void loadData();
  }, [monthStartStr]);

  // Lắng nghe realtime
  useRealtimeSync(
    [
      { table: 'attendance' },
      { table: 'attendance_requests' },
      { table: 'leave_requests' },
      { table: 'work_schedules' },
      { table: 'timesheet_periods' },
    ],
    () => { void loadData(true); },
    { channelKey: 'attendance-reports' },
  );

  // Reset trang khi đổi bộ lọc
  useEffect(() => {
    setPage(1);
  }, [searchQuery, deptFilter, gradeFilter, sortField, sortAsc, activeTab]);

  // Danh sách phòng ban duy nhất để lọc
  const departmentOptions = useMemo(() => {
    if (!data) return [{ value: '', label: 'Tất cả phòng ban' }];
    const depts = new Set<string>();
    for (const r of data.rollups) {
      if (r.profile.department) depts.add(r.profile.department);
    }
    return [
      { value: '', label: 'Tất cả phòng ban' },
      ...Array.from(depts).sort().map((d) => ({ value: d, label: d })),
    ];
  }, [data]);

  // Lọc và sắp xếp bảng tổng hợp
  const filteredRollups = useMemo(() => {
    if (!data) return [];
    const list = data.rollups.filter((r) => {
      // Tìm kiếm theo tên hoặc mã nhân viên
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchName = r.profile.name.toLowerCase().includes(q);
        const matchCode = (r.profile.employee_code ?? '').toLowerCase().includes(q);
        if (!matchName && !matchCode) return false;
      }

      // Lọc phòng ban
      if (deptFilter && r.profile.department !== deptFilter) return false;

      // Lọc xếp loại chuyên cần / điều kiện đặc biệt
      if (gradeFilter) {
        if (gradeFilter === 'HAS_LATE') return r.lateCount > 0;
        if (gradeFilter === 'HAS_OT') return r.otHoursTotal > 0;
        if (gradeFilter === 'HAS_LEAVE') return r.leaveDaysTotal > 0;
        if (gradeFilter === 'HAS_MISSING_CHECKOUT') return r.missingCheckoutCount > 0;
        return r.disciplineGrade === gradeFilter;
      }

      return true;
    });

    // Sắp xếp
    list.sort((a, b) => {
      let vA: any = a[sortField];
      let vB: any = b[sortField];
      if (sortField === 'profile') {
        vA = a.profile.name;
        vB = b.profile.name;
      }
      if (typeof vA === 'string') {
        return sortAsc ? vA.localeCompare(vB) : vB.localeCompare(vA);
      }
      return sortAsc ? (vA - vB) : (vB - vA);
    });

    return list;
  }, [data, deptFilter, gradeFilter, searchQuery, sortAsc, sortField]);

  const pagedRollups = useMemo(() => {
    const start = (page - 1) * ITEMS_PER_PAGE;
    return filteredRollups.slice(start, start + ITEMS_PER_PAGE);
  }, [filteredRollups, page]);

  // Cấu hình xuất Excel / CSV
  const getExportOptions = (): ExportOptions<EmployeeAttendanceRollup> => {
    if (!data) {
      return {
        filename: `Bao_cao_cong_${format(monthStart, 'MM_yyyy')}`,
        sheetName: 'Báo cáo công',
        columns: [],
        rows: [],
      };
    }

    return {
      filename: `Tong_hop_cham_cong_${format(monthStart, 'MM_yyyy')}`,
      sheetName: 'Tổng hợp công',
      title: `BẢNG TỔNG HỢP CÔNG & KỶ LUẬT LAO ĐỘNG - THÁNG ${format(monthStart, 'MM/yyyy')}`,
      subtitle: `Công chuẩn tháng: ${data.standardDays} ngày | Tổng nhân sự: ${data.totalEmployees}`,
      columns: [
        { header: 'Mã NV', value: (r) => r.profile.employee_code ?? '' },
        { header: 'Họ và tên', value: (r) => r.profile.name },
        { header: 'Phòng ban', value: (r) => r.profile.department ?? '' },
        { header: 'Ngày công thực tế', value: (r) => r.workDays },
        { header: 'Công chuẩn', value: (r) => r.standardDays },
        { header: 'Tỷ lệ hoàn thành (%)', value: (r) => r.completionRate },
        { header: 'Tổng giờ làm (h)', value: (r) => r.totalHours },
        { header: 'Lượt đi muộn', value: (r) => r.lateCount },
        { header: 'Tổng phút muộn', value: (r) => r.lateMinutes },
        { header: 'Muộn sau 9h', value: (r) => r.lateAfterCutoffCount },
        { header: 'Muộn có phép', value: (r) => r.lateExcusedCount },
        { header: 'Muộn không phép', value: (r) => r.lateUnexcusedCount },
        { header: 'Giờ OT (h)', value: (r) => r.otHoursTotal },
        { header: 'OT thường 150%', value: (r) => r.otHoursWeekday },
        { header: 'OT nghỉ 200%', value: (r) => r.otHoursWeekend },
        { header: 'OT lễ 300%', value: (r) => r.otHoursHoliday },
        { header: 'Ngày nghỉ phép', value: (r) => r.leaveDaysTotal },
        { header: 'Phép năm', value: (r) => r.leaveDaysAnnual },
        { header: 'Nghỉ ốm', value: (r) => r.leaveDaysSick },
        { header: 'Nghỉ không lương', value: (r) => r.leaveDaysUnpaid },
        { header: 'Quên checkout', value: (r) => r.missingCheckoutCount },
        { header: 'Tỷ lệ đúng giờ (%)', value: (r) => r.punctualityRate },
        { header: 'Xếp loại kỷ luật', value: (r) => GRADE_PILL[r.disciplineGrade]?.label ?? r.disciplineGrade },
      ],
      rows: filteredRollups,
    };
  };

  const handleSort = (field: keyof EmployeeAttendanceRollup) => {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(false);
    }
  };

  // Danh sách OT nhiều nhất (lên đến 10 người)
  const topOtEmployees = useMemo(() => {
    if (!data) return [];
    return [...data.rollups].sort((a, b) => b.otHoursTotal - a.otHoursTotal).slice(0, 10).filter((r) => r.otHoursTotal > 0);
  }, [data]);

  // Danh sách Đi muộn nhiều nhất (lên đến 10 người)
  const topLateEmployees = useMemo(() => {
    if (!data) return [];
    return [...data.rollups].sort((a, b) => b.lateCount - a.lateCount || b.lateMinutes - a.lateMinutes).slice(0, 10).filter((r) => r.lateCount > 0);
  }, [data]);


  if (loading) {
    return (
      <div className="space-y-4">
        <div className="flex justify-center">
          <MonthNav value={monthStart} onChange={setMonthStart} bare />
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-24 w-full !rounded-none" />
          ))}
        </div>
        <Skeleton className="h-96 w-full !rounded-none" />
      </div>
    );
  }

  if (!data) return null;
  if (data.error) {
    return <ErrorState message={data.error} onRetry={() => void loadData()} />;
  }

  return (
    <div className="space-y-4 attendance-module" data-module="attendance">
      {/* Header & Điều hướng tháng - Style vuông vắn clean */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-slate-200 pb-3 dark:border-slate-800 no-print">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-base sm:text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100 uppercase">
              Báo cáo công & Chuyên cần
            </h1>
            <span
              className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold border ${
                data.periodStatus === 'LOCKED'
                  ? 'border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
                  : data.periodStatus === 'REVIEW'
                  ? 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300'
                  : 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300'
              }`}
            >
              {data.periodStatus === 'LOCKED' ? 'Kỳ đã khóa' : data.periodStatus === 'REVIEW' ? 'Đang đối soát' : 'Đang mở'}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            Tổng hợp dữ liệu công, giờ làm, chuyên cần, OT và nghỉ phép tháng {data.monthLabel}.
          </p>
        </div>

        {activeTab !== 'daily' && (
          <div className="flex flex-wrap items-center gap-2.5">
            <MonthNav value={monthStart} onChange={setMonthStart} bare />
            <ExportButtons options={getExportOptions} disabled={data.rollups.length === 0} />
          </div>
        )}
      </div>

      {/* 5 Thẻ chỉ số KPI của tháng - ẩn ở tab Báo cáo theo ngày */}
      {activeTab !== 'daily' && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {/* Thẻ 1: Tổng ngày công */}
          <div className="border border-slate-200 bg-white p-3.5 dark:border-slate-800 dark:bg-slate-900 rounded-none shadow-2xs">
            <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
              <span className="font-semibold uppercase tracking-wider text-[11px]">Tổng ngày công</span>
              <CalendarDays className="h-3.5 w-3.5 text-indigo-600" />
            </div>
            <div className="mt-2 flex items-baseline gap-1 font-mono">
              <span className="text-xl font-bold text-slate-900 dark:text-slate-100">
                {data.totalWorkDays}
              </span>
              <span className="text-xs text-slate-400">công</span>
            </div>
            <div className="mt-1.5 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
              <span>TB: <strong className="text-slate-700 dark:text-slate-200">{data.avgWorkDays}</strong> / {data.standardDays}d</span>
              <span className="font-semibold text-indigo-600 dark:text-indigo-400">
                {data.standardDays > 0 ? Math.round((data.avgWorkDays / data.standardDays) * 100) : 0}%
              </span>
            </div>
            <div className="mt-1 text-[11px] text-slate-400">
              Tổng giờ làm: {data.totalWorkHours}h
            </div>
          </div>

          {/* Thẻ 2: Đi muộn & Về sớm */}
          <div className="border border-slate-200 bg-white p-3.5 dark:border-slate-800 dark:bg-slate-900 rounded-none shadow-2xs">
            <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
              <span className="font-semibold uppercase tracking-wider text-[11px]">Đi muộn & Về sớm</span>
              <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
            </div>
            <div className="mt-2 flex items-baseline gap-1 font-mono">
              <span className={`text-xl font-bold ${data.totalLateIncidents > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-slate-900 dark:text-slate-100'}`}>
                {data.totalLateIncidents}
              </span>
              <span className="text-xs text-slate-400">lượt ({data.totalLateMinutes}p)</span>
            </div>
            <div className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
              {data.lateExcusedCount} có phép · <strong className="text-red-600 dark:text-red-400">{data.lateUnexcusedCount} vi phạm</strong>
            </div>
            <div className="mt-1 text-[11px] text-slate-400">
              {data.lateAfterCutoffCount > 0 ? `${data.lateAfterCutoffCount} lượt sau 9h` : '0 lượt vào sau 9h'}
            </div>
          </div>

          {/* Thẻ 3: Làm thêm giờ OT */}
          <div className="border border-slate-200 bg-white p-3.5 dark:border-slate-800 dark:bg-slate-900 rounded-none shadow-2xs">
            <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
              <span className="font-semibold uppercase tracking-wider text-[11px]">Làm thêm giờ (OT)</span>
              <Flame className="h-3.5 w-3.5 text-orange-600" />
            </div>
            <div className="mt-2 flex items-baseline gap-1 font-mono">
              <span className={`text-xl font-bold ${data.totalOtHours > 0 ? 'text-orange-600 dark:text-orange-400' : 'text-slate-900 dark:text-slate-100'}`}>
                {data.totalOtHours}
              </span>
              <span className="text-xs text-slate-400">giờ</span>
            </div>
            <div className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
              {data.employeesWithOt} nhân sự · {data.approvedOtHours}h đã duyệt
            </div>
            <div className="mt-1 text-[11px] text-slate-400">
              {data.otHoursWeekday}h ngày (150%) · {data.otHoursWeekend}h nghỉ (200%)
            </div>
          </div>

          {/* Thẻ 4: Nghỉ phép & Vắng mặt */}
          <div className="border border-slate-200 bg-white p-3.5 dark:border-slate-800 dark:bg-slate-900 rounded-none shadow-2xs">
            <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
              <span className="font-semibold uppercase tracking-wider text-[11px]">Nghỉ phép</span>
              <Briefcase className="h-3.5 w-3.5 text-violet-600" />
            </div>
            <div className="mt-2 flex items-baseline gap-1 font-mono">
              <span className="text-xl font-bold text-slate-900 dark:text-slate-100">
                {data.totalLeaveDays}
              </span>
              <span className="text-xs text-slate-400">ngày</span>
            </div>
            <div className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
              {data.employeesWithLeave} người nghỉ · {data.leaveDaysAnnual} phép năm
            </div>
            <div className="mt-1 text-[11px] text-slate-400">
              Ốm: {data.leaveDaysSick}d · Không lương: {data.leaveDaysUnpaid}d
            </div>
          </div>

          {/* Thẻ 5: Tỷ lệ đúng giờ */}
          <div className="border border-slate-200 bg-white p-3.5 dark:border-slate-800 dark:bg-slate-900 rounded-none shadow-2xs">
            <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
              <span className="font-semibold uppercase tracking-wider text-[11px]">Tỷ lệ đúng giờ</span>
              <UserCheck className="h-3.5 w-3.5 text-emerald-600" />
            </div>
            <div className="mt-2 flex items-baseline gap-1 font-mono">
              <span className="text-xl font-bold text-emerald-600 dark:text-emerald-400">
                {data.avgPunctualityRate}%
              </span>
            </div>
            <div className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
              {data.countExcellent} Xuất sắc · {data.countGood} Tốt · <strong className="text-red-600 dark:text-red-400">{data.countWarning} Lưu ý</strong>
            </div>
            <div className="mt-1 text-[11px] text-slate-400">
              Quên checkout: {data.totalMissingCheckouts} lần
            </div>
          </div>
        </div>
      )}

      {/* Tabs chuyển đổi: Biểu đồ trước, Bảng tổng hợp công sau - Style vuông vức */}
      <div className="flex border-b border-slate-200 dark:border-slate-800 no-print" role="tablist">
        {TAB_ITEMS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setActiveTab(tab.key)}
              className={`inline-flex shrink-0 items-center gap-2 border-b-2 -mb-px px-5 py-3 text-xs font-bold uppercase tracking-wider transition-colors rounded-none ${
                isActive
                  ? 'border-indigo-600 bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-2xs font-extrabold'
                  : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800/40'
              }`}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* TAB 1: BIỂU ĐỒ & PHÂN TÍCH (AUTO-PICKED / HIỂN THỊ ĐẦU TIÊN) */}
      {activeTab === 'charts' && (
        <div className="space-y-4">
          {/* Biểu đồ 1: Cột cơ bản đi làm vs đi muộn theo từng ngày trong tháng - Không sóng sánh */}
          <div className="border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 rounded-none p-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-slate-100">
                Thống kê có mặt & Đi muộn theo ngày trong tháng {data.monthLabel}
              </h3>
              <div className="flex items-center gap-4 text-xs">
                <span className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
                  <span className="h-3 w-3 rounded-none inline-block" style={{ backgroundColor: '#4F46E5' }} /> Có mặt
                </span>
                <span className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
                  <span className="h-3 w-3 rounded-none inline-block" style={{ backgroundColor: '#F59E0B' }} /> Đi muộn
                </span>
              </div>
            </div>

            <div className="mt-4 h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.dailyTrend} margin={{ top: 5, right: 10, left: -25, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" opacity={0.6} />
                  <XAxis
                    dataKey="dayNum"
                    tickLine={false}
                    axisLine={{ stroke: '#CBD5E1' }}
                    tick={{ fontSize: 11, fill: '#64748B' }}
                    tickFormatter={(val) => `${val}`}
                  />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    tick={{ fontSize: 11, fill: '#64748B' }}
                    allowDecimals={false}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#FFFFFF',
                      borderColor: '#E2E8F0',
                      borderRadius: '0px',
                      fontSize: '12px',
                      boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
                    }}
                    formatter={(val: any, name: any) => [
                      `${val} người`,
                      name,
                    ]}
                    labelFormatter={(label) => `Ngày ${label}/${data.month.slice(5, 7)}`}
                  />
                  <Bar dataKey="checkins" name="Có mặt" fill="#4F46E5" radius={[0, 0, 0, 0]} maxBarSize={16} />
                  <Bar dataKey="late" name="Đi muộn" fill="#F59E0B" radius={[0, 0, 0, 0]} maxBarSize={16} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Lưới 2 Bảng: Làm thêm giờ OT nhiều nhất & Đi muộn nhiều nhất */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {/* OT nhiều nhất */}
            <div className="border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 rounded-none p-4">
              <div className="flex items-center gap-2 pb-3 border-b border-slate-100 dark:border-slate-800">
                <Clock className="h-4 w-4 text-orange-600" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-slate-100">
                  Làm thêm giờ (OT) nhiều nhất
                </h3>
              </div>
              <div className="mt-2 divide-y divide-slate-100 dark:divide-slate-800/60 max-h-[380px] overflow-y-auto">
                {topOtEmployees.length === 0 ? (
                  <p className="py-6 text-center text-xs text-slate-400">Không có nhân sự nào làm thêm trong tháng.</p>
                ) : (
                  topOtEmployees.map((r) => (
                    <div key={r.profile.id} className="flex items-center justify-between py-1.5">
                      <div className="min-w-0 pr-2">
                        <p className="font-bold text-xs text-slate-800 dark:text-slate-100 truncate">{r.profile.name}</p>
                        <p className="text-[10px] text-slate-400 truncate">{r.profile.department || '—'}</p>
                      </div>

                      <div className="text-right flex-shrink-0">
                        <span className="font-mono text-xs font-bold text-orange-600 dark:text-orange-400">
                          +{r.otHoursTotal}h
                        </span>
                        <p className="text-[10px] text-slate-400">{r.otCount} lượt OT</p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Đi muộn nhiều nhất */}
            <div className="border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 rounded-none p-4">
              <div className="flex items-center gap-2 pb-3 border-b border-slate-100 dark:border-slate-800">
                <AlertTriangle className="h-4 w-4 text-amber-600" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-slate-100">
                  Đi muộn nhiều nhất
                </h3>
              </div>
              <div className="mt-2 divide-y divide-slate-100 dark:divide-slate-800/60 max-h-[380px] overflow-y-auto">
                {topLateEmployees.length === 0 ? (
                  <p className="py-6 text-center text-xs text-emerald-600">Tuyệt vời! Không có ai đi muộn trong tháng.</p>
                ) : (
                  topLateEmployees.map((r) => (
                    <div key={r.profile.id} className="flex items-center justify-between py-1.5">
                      <div className="min-w-0 pr-2">
                        <p className="font-bold text-xs text-slate-800 dark:text-slate-100 truncate">{r.profile.name}</p>
                        <p className="text-[10px] text-slate-400 truncate">{r.profile.department || '—'}</p>
                      </div>

                      <div className="text-right flex-shrink-0">
                        <span className="font-mono text-xs font-bold text-amber-600 dark:text-amber-400">
                          {r.lateCount} lần ({r.lateMinutes}p)
                        </span>
                        <p className="text-[10px] text-slate-400">
                          {r.lateUnexcusedCount > 0 ? `${r.lateUnexcusedCount} vi phạm` : 'Có phép'}
                        </p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: BẢNG TỔNG HỢP CÔNG NHÂN SỰ */}
      {activeTab === 'daily' && <AttendanceDailyReport />}

      {activeTab === 'summary' && (
        <div className="space-y-3">
          {/* Thanh công cụ lọc - Vuông vức, clean */}
          <div className="flex flex-wrap items-center justify-between gap-2.5 border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900 rounded-none no-print">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative w-full sm:w-60">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Tìm theo tên hoặc mã NV…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="h-8 w-full border border-slate-200 bg-white pl-8 pr-2.5 text-xs outline-none focus:border-indigo-500 rounded-lg dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>

              <div className="w-full sm:w-52">
                <Dropdown
                  aria-label="Phòng ban"
                  searchable
                  value={deptFilter}
                  options={departmentOptions}
                  onChange={setDeptFilter}
                />
              </div>

              <div className="w-full sm:w-52">
                <Dropdown
                  aria-label="Lọc điều kiện"
                  value={gradeFilter}
                  options={[
                    { value: '', label: 'Tất cả nhân sự' },
                    { value: 'EXCELLENT', label: 'Xuất sắc (Đạt chuẩn, 0 muộn)' },
                    { value: 'GOOD', label: 'Tốt (>= 90% công)' },
                    { value: 'FAIR', label: 'Trung bình' },
                    { value: 'WARNING', label: 'Cần lưu ý / Nhắc nhở' },
                    { value: 'HAS_LATE', label: 'Có đi muộn (> 0 lần)' },
                    { value: 'HAS_OT', label: 'Có làm thêm OT' },
                    { value: 'HAS_LEAVE', label: 'Có nghỉ phép' },
                    { value: 'HAS_MISSING_CHECKOUT', label: 'Có quên checkout' },
                  ]}
                  onChange={setGradeFilter}
                />
              </div>
            </div>

            <div className="text-xs text-slate-500 dark:text-slate-400">
              Tổng số: <strong>{filteredRollups.length}</strong> / {data.rollups.length} nhân sự
            </div>
          </div>

          {/* Bảng tổng hợp công - Vuông vức, clean */}
          {filteredRollups.length === 0 ? (
            <EmptyState
              title="Không tìm thấy nhân sự nào"
              description="Hãy thử đổi từ khóa tìm kiếm hoặc bỏ bớt các tiêu chí lọc."
            />
          ) : (
            <div className="border-2 border-slate-400 dark:border-slate-600 bg-white dark:bg-slate-900 rounded-xl overflow-hidden shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="border-b-2 border-[#bf1f2b] dark:border-[#e66a76] bg-[#fdf2f4] dark:bg-[#201114] text-xs font-black uppercase tracking-wider text-[#5c0f16] dark:text-[#fde8ea] shadow-[inset_0_-2px_0_#bf1f2b] dark:shadow-[inset_0_-2px_0_#e66a76]">
                    <tr>
                      <th
                        className="cursor-pointer px-2.5 py-1.5 hover:text-indigo-600 transition-colors"
                        onClick={() => handleSort('profile')}
                      >
                        <div className="flex items-center gap-1">
                          <span>Nhân viên</span>
                          <ArrowUpDown className="h-3 w-3 text-slate-400" />
                        </div>
                      </th>
                      <th
                        className="cursor-pointer px-2 py-1.5 text-center hover:text-indigo-600 transition-colors"
                        onClick={() => handleSort('workDays')}
                      >
                        <div className="flex items-center justify-center gap-1">
                          <span>Ngày công</span>
                          <ArrowUpDown className="h-3 w-3 text-slate-400" />
                        </div>
                      </th>
                      <th
                        className="cursor-pointer px-2 py-1.5 text-right hover:text-indigo-600 transition-colors"
                        onClick={() => handleSort('totalHours')}
                      >
                        <div className="flex items-center justify-end gap-1">
                          <span>Tổng giờ</span>
                          <ArrowUpDown className="h-3 w-3 text-slate-400" />
                        </div>
                      </th>
                      <th
                        className="cursor-pointer px-2 py-1.5 text-center hover:text-indigo-600 transition-colors"
                        onClick={() => handleSort('lateCount')}
                      >
                        <div className="flex items-center justify-center gap-1">
                          <span>Đi muộn</span>
                          <ArrowUpDown className="h-3 w-3 text-slate-400" />
                        </div>
                      </th>
                      <th
                        className="cursor-pointer px-2 py-1.5 text-center hover:text-indigo-600 transition-colors"
                        onClick={() => handleSort('otHoursTotal')}
                      >
                        <div className="flex items-center justify-center gap-1">
                          <span>Làm thêm (OT)</span>
                          <ArrowUpDown className="h-3 w-3 text-slate-400" />
                        </div>
                      </th>
                      <th
                        className="cursor-pointer px-2 py-1.5 text-center hover:text-indigo-600 transition-colors"
                        onClick={() => handleSort('leaveDaysTotal')}
                      >
                        <div className="flex items-center justify-center gap-1">
                          <span>Nghỉ phép</span>
                          <ArrowUpDown className="h-3 w-3 text-slate-400" />
                        </div>
                      </th>
                      <th className="px-2 py-1.5 text-center">Quên checkout</th>
                      <th
                        className="cursor-pointer px-2 py-1.5 text-center hover:text-indigo-600 transition-colors"
                        onClick={() => handleSort('punctualityRate')}
                      >
                        <div className="flex items-center justify-center gap-1">
                          <span>Đúng giờ</span>
                          <ArrowUpDown className="h-3 w-3 text-slate-400" />
                        </div>
                      </th>
                      <th className="px-2 py-1.5 text-center">Kỷ luật</th>
                      <th className="px-2.5 py-1.5 text-right">Chi tiết</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-300 dark:divide-slate-700 bg-white dark:bg-slate-900 font-semibold">
                    {pagedRollups.map((r) => {
                      const grade = GRADE_PILL[r.disciplineGrade];
                      return (
                        <tr
                          key={r.profile.id}
                          className="group transition-colors hover:bg-slate-100/80 dark:hover:bg-slate-800/60"
                        >
                          {/* Cột 1: Thông tin nhân sự */}
                          <td className="px-2.5 py-1.5">
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5">
                                <p className="truncate font-black text-xs text-slate-900 dark:text-slate-100">
                                  {r.profile.name}
                                </p>
                                {r.profile.employee_code && (
                                  <span className="border border-slate-300 bg-slate-100 px-1 py-0 font-mono text-[10px] font-bold text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 rounded">
                                    {r.profile.employee_code}
                                  </span>
                                )}
                              </div>
                              <p className="truncate text-[10px] font-medium text-slate-500 dark:text-slate-400">
                                {r.profile.department || '—'}
                              </p>
                            </div>
                          </td>

                          {/* Cột 2: Ngày công thực tế */}
                          <td className="px-2 py-1.5 text-center">
                            <div className="inline-flex flex-col items-center">
                              <div className="flex items-baseline gap-1 font-mono font-black text-xs text-slate-900 dark:text-slate-100">
                                <span>{r.workDays}</span>
                                <span className="text-[10px] text-slate-400">/ {r.standardDays}</span>
                              </div>
                              <div className="h-1.5 w-12 overflow-hidden bg-slate-200 dark:bg-slate-700 rounded-full mt-0.5">
                                <div
                                  className={`h-full ${
                                    r.completionRate >= 100
                                      ? 'bg-emerald-600'
                                      : r.completionRate >= 80
                                      ? 'bg-indigo-600'
                                      : 'bg-amber-500'
                                  }`}
                                  style={{ width: `${Math.min(100, r.completionRate)}%` }}
                                />
                              </div>
                            </div>
                          </td>

                          {/* Cột 3: Tổng giờ làm */}
                          <td className="px-2 py-1.5 text-right font-mono font-black text-xs text-slate-900 dark:text-slate-100">
                            {r.totalHours}h
                          </td>

                          {/* Cột 4: Đi muộn */}
                          <td className="px-2 py-1.5 text-center">
                            {r.lateCount > 0 ? (
                              <div className="inline-flex flex-col items-center">
                                <span className="border border-amber-300 bg-amber-50 px-1.5 py-0.2 text-[11px] font-black text-amber-800 dark:border-amber-700 dark:bg-amber-950/60 dark:text-amber-200 rounded-full">
                                  {r.lateCount} lần ({r.lateMinutes}p)
                                </span>
                                {r.lateAfterCutoffCount > 0 && (
                                  <span className="mt-0.5 text-[10px] font-black text-red-600 dark:text-red-400">
                                    {r.lateAfterCutoffCount} sau 9h
                                  </span>
                                )}
                              </div>
                            ) : (
                              <span className="text-slate-400 dark:text-slate-500 font-bold">—</span>
                            )}
                          </td>

                          {/* Cột 5: Làm thêm OT */}
                          <td className="px-2 py-1.5 text-center">
                            {r.otHoursTotal > 0 ? (
                              <span className="border border-orange-300 bg-orange-50 px-1.5 py-0.2 text-[11px] font-black text-orange-800 dark:border-orange-700 dark:bg-orange-950/60 dark:text-orange-200 rounded-full">
                                +{r.otHoursTotal}h
                              </span>
                            ) : (
                              <span className="text-slate-400 dark:text-slate-500 font-bold">—</span>
                            )}
                          </td>

                          {/* Cột 6: Nghỉ phép */}
                          <td className="px-2 py-1.5 text-center">
                            {r.leaveDaysTotal > 0 ? (
                              <div className="inline-flex flex-col items-center">
                                <span className="border border-violet-300 bg-violet-50 px-1.5 py-0.2 text-[11px] font-black text-violet-800 dark:border-violet-700 dark:bg-violet-950/60 dark:text-violet-200 rounded-full">
                                  {r.leaveDaysTotal}d
                                </span>
                                {r.leaveDaysUnpaid > 0 && (
                                  <span className="mt-0.5 text-[10px] font-bold text-slate-500">
                                    ({r.leaveDaysUnpaid}d ko lương)
                                  </span>
                                )}
                              </div>
                            ) : (
                              <span className="text-slate-400 dark:text-slate-500 font-bold">—</span>
                            )}
                          </td>

                          {/* Cột 7: Quên checkout */}
                          <td className="px-2 py-1.5 text-center">
                            {r.missingCheckoutCount > 0 ? (
                              <span className="border border-red-300 bg-red-50 px-1.5 py-0.2 font-black text-[11px] text-red-700 dark:border-red-700 dark:bg-red-950/60 dark:text-red-300 rounded-full">
                                {r.missingCheckoutCount}
                              </span>
                            ) : (
                              <span className="text-slate-400 dark:text-slate-500 font-bold">0</span>
                            )}
                          </td>

                          {/* Cột 8: Tỷ lệ đúng giờ */}
                          <td className="px-2 py-1.5 text-center">
                            <span
                              className={`font-mono font-black text-xs ${
                                r.punctualityRate >= 95
                                  ? 'text-emerald-700 dark:text-emerald-400'
                                  : r.punctualityRate >= 80
                                  ? 'text-indigo-700 dark:text-indigo-400'
                                  : 'text-amber-700 dark:text-amber-400'
                              }`}
                            >
                              {r.punctualityRate}%
                            </span>
                          </td>

                          {/* Cột 9: Xếp loại kỷ luật */}
                          <td className="px-2 py-1.5 text-center">
                            <span className={`inline-block px-2 py-0.2 text-[11px] font-black rounded-full ${grade.class}`}>
                              {grade.label}
                            </span>
                          </td>

                          {/* Cột 10: Thao tác xem chi tiết */}
                          <td className="px-2.5 py-1.5 text-right">
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-6 text-[10px] rounded-lg px-2 shadow-2xs"
                              onClick={() => setSelectedRollup(r)}
                            >
                              <Eye className="h-3 w-3" /> Chi tiết
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Phân trang */}
              <div className="border-t border-slate-200 p-2.5 dark:border-slate-800 no-print">
                <Pager
                  page={page}
                  total={filteredRollups.length}
                  size={ITEMS_PER_PAGE}
                  onPage={setPage}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Modal xem chi tiết từng nhân viên */}
      <EmployeeAttendanceModal
        open={Boolean(selectedRollup)}
        onClose={() => setSelectedRollup(null)}
        rollup={selectedRollup}
        month={data.month}
        attendances={data.attendances}
        lateRecords={data.lateRecords}
        otRecords={data.otRecords}
        leaveRecords={data.leaveRecords}
      />
    </div>
  );
}
