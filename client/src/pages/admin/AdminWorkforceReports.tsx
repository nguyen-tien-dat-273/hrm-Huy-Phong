import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, Download, ShieldCheck, Users, Wallet, Target, Award } from 'lucide-react';
import {
  AreaChart, Area, BarChart, Bar, CartesianGrid, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine
} from 'recharts';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Dropdown } from '@/components/ui/Dropdown';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { hasAdminFunction } from '@/lib/permissions';
import { describeDbError } from '@/lib/dbError';
import { formatVND } from '@/lib/utils';
import { supabase } from '@/lib/supabase';

type ReportKey = 'movement' | 'kpi' | 'insurance';
type MovementType = 'HIRED' | 'TERMINATED' | 'REACTIVATED' | 'STATUS_CHANGED';

interface ReportUnit {
  id: string;
  name: string;
}

interface ReportPerson {
  id: string;
  name: string;
  employee_code: string | null;
  department: string | null;
  unit_id: string | null;
  employment_status: string | null;
  hire_date: string | null;
  is_active: boolean;
}

interface EmploymentEvent {
  user_id: string;
  event_type: MovementType;
  event_date: string;
  unit_id: string | null;
  department: string | null;
}

interface DepartmentHeadcount {
  department: string;
  count: number;
  percentage: number;
}

interface PayrollRun {
  id: string;
  month_start: string;
  status: 'DRAFT' | 'CALCULATED' | 'APPROVED' | 'PAID';
}

interface PayslipReport {
  run_id: string;
  user_id: string;
  employee_name: string;
  employee_code: string | null;
  department: string | null;
  gross_pay: number;
  taxable_income: number;
  insurance_employee: number;
  insurance_employer: number;
  personal_income_tax: number;
  net_pay: number;
}

interface KpiReviewReport {
  period_month: string;
  user_id: string;
  final_pct: number | null;
  rating: string | null;
  locked_at: string | null;
}

const REPORT_TABS: Array<{ key: ReportKey; label: string }> = [
  { key: 'movement', label: 'Biến động & quỹ lương' },
  { key: 'kpi', label: 'Tổng hợp KPI' },
  { key: 'insurance', label: 'BHXH & thuế TNCN' },
];

const MONTHS = Array.from({ length: 12 }, (_, index) => String(index + 1).padStart(2, '0'));
const currentYear = () => new Date().getFullYear();
const monthKey = (date: string) => date.slice(0, 7);
const amount = (value: number | string | null | undefined) => Number(value ?? 0);

function reportMonthLabel(month: any) {
  const str = String(month ?? '');
  return `${str.slice(5, 7)}/${str.slice(0, 4)}`;
}

function shortMonthLabel(month: string) {
  const m = month.includes('-') ? month.split('-')[1] : month;
  return `T${Number(m)}`;
}

export function AdminWorkforceReports({
  defaultReport = 'movement',
  allowedTabs,
}: {
  defaultReport?: ReportKey;
  allowedTabs?: ReportKey[];
} = {}) {
  const { profile } = useAuth();
  const { toast } = useToast();
  const canViewPayroll = hasAdminFunction(profile, 'admin.payroll');
  const canViewAllKpi = hasAdminFunction(profile, 'admin.performance_manage');
  const canViewKpi = !!profile && profile.is_active;

  const availableTabs = useMemo(() => {
    let tabs = REPORT_TABS.filter((tab) => tab.key === 'kpi' || canViewPayroll);
    if (allowedTabs && allowedTabs.length > 0) {
      tabs = tabs.filter((t) => allowedTabs.includes(t.key));
    }
    return tabs;
  }, [allowedTabs, canViewPayroll]);

  const [report, setReport] = useState<ReportKey>(() => {
    if (allowedTabs && allowedTabs.length > 0 && !allowedTabs.includes(defaultReport)) {
      return allowedTabs[0];
    }
    return defaultReport;
  });
  const [year, setYear] = useState(String(currentYear()));
  const [unitId, setUnitId] = useState('');
  const [units, setUnits] = useState<ReportUnit[]>([]);
  const [people, setPeople] = useState<ReportPerson[]>([]);
  const [events, setEvents] = useState<EmploymentEvent[]>([]);
  const [eventTrackingStartedOn, setEventTrackingStartedOn] = useState<string | null>(null);
  const [hasEventHistoryTable, setHasEventHistoryTable] = useState(true);
  const [runs, setRuns] = useState<PayrollRun[]>([]);
  const [payslips, setPayslips] = useState<PayslipReport[]>([]);
  const [reviews, setReviews] = useState<KpiReviewReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadVersion, setReloadVersion] = useState(0);
  const today = new Date();
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const effectiveUnitId = report === 'kpi' && !canViewAllKpi ? profile?.unit_id ?? '' : unitId;

  useEffect(() => {
    if (availableTabs.length > 0 && !availableTabs.some((t) => t.key === report)) {
      setReport(availableTabs[0].key);
    }
  }, [availableTabs, report]);

  useEffect(() => {
    let active = true;

    const load = async () => {
      if (!/^\d{4}$/.test(year) || Number(year) < 2000 || Number(year) > 2100) {
        setLoadError('Nhập năm báo cáo hợp lệ từ 2000 đến 2100.');
        setLoading(false);
        return;
      }
      setLoading(true);
      setLoadError(null);
      const yearStart = `${year}-01-01`;
      const yearEnd = `${year}-12-31`;
      const [peopleResult, unitResult, eventResult, trackingResult] = await Promise.all([
        supabase.from('profiles_directory')
          .select('id,name,employee_code,department,unit_id,employment_status,hire_date,is_active'),
        supabase.from('organization_units').select('id,name').eq('is_active', true).order('name'),
        supabase.from('employment_status_events')
          .select('user_id,event_type,event_date,unit_id,department')
          .gte('event_date', yearStart)
          .lte('event_date', todayKey),
        supabase.from('employment_status_events')
          .select('created_at')
          .order('created_at', { ascending: true })
          .limit(1)
          .maybeSingle(),
      ]);

      const isMissingEventTable = (err: { message?: string; code?: string } | null | undefined) => {
        if (!err) return false;
        const msg = (err.message || '').toLowerCase();
        const code = err.code || '';
        return code === 'PGRST205' || code === '42P01' || msg.includes('employment_status_events') || msg.includes('schema cache');
      };

      const eventTableMissing = isMissingEventTable(eventResult.error) || isMissingEventTable(trackingResult.error);
      const firstError = peopleResult.error ?? unitResult.error ?? (eventTableMissing ? null : (eventResult.error ?? trackingResult.error));
      let nextRuns: PayrollRun[] = [];
      let nextPayslips: PayslipReport[] = [];
      let nextReviews: KpiReviewReport[] = [];

      if (!firstError && canViewPayroll) {
        const runResult = await supabase.from('payroll_runs')
          .select('id,month_start,status')
          .gte('month_start', yearStart)
          .lte('month_start', yearEnd)
          .in('status', ['APPROVED', 'PAID'])
          .order('month_start');
        if (runResult.error) {
          if (active) setLoadError(describeDbError(runResult.error));
        } else {
          nextRuns = (runResult.data || []) as PayrollRun[];
          if (nextRuns.length > 0) {
            const payslipResult = await supabase.from('payslips')
              .select('run_id,user_id,employee_name,employee_code,department,gross_pay,taxable_income,insurance_employee,insurance_employer,personal_income_tax,net_pay')
              .in('run_id', nextRuns.map((run) => run.id));
            if (payslipResult.error) {
              if (active) setLoadError(describeDbError(payslipResult.error));
            } else {
              nextPayslips = (payslipResult.data || []) as PayslipReport[];
            }
          }
        }
      }

      if (!firstError && canViewKpi) {
        // Phiếu KPI đã duyệt; xếp loại và thời điểm duyệt đặt tên theo báo cáo.
        const reviewResult = await supabase.from('kpi_sheets')
          .select('period_month,user_id,final_pct,rating:grade,locked_at:approved_at')
          .gte('period_month', yearStart)
          .lte('period_month', yearEnd)
          .eq('status', 'APPROVED');
        if (reviewResult.error) {
          if (active) setLoadError((current) => current ?? describeDbError(reviewResult.error));
        } else {
          nextReviews = (reviewResult.data || []) as KpiReviewReport[];
        }
      }

      if (!active) return;
      if (firstError) {
        setLoadError(describeDbError(firstError));
      } else {
        const rawPeople = (peopleResult.data || []) as ReportPerson[];
        setPeople(rawPeople);
        setUnits((unitResult.data || []) as ReportUnit[]);
        setHasEventHistoryTable(!eventTableMissing);
        if (eventTableMissing) {
          const fallbackEvents: EmploymentEvent[] = rawPeople
            .filter((p) => p.hire_date && p.hire_date.startsWith(year))
            .map((p) => ({
              user_id: p.id,
              event_type: 'HIRED' as MovementType,
              event_date: p.hire_date!,
              unit_id: p.unit_id,
              department: p.department,
            }));
          setEvents(fallbackEvents);
          setEventTrackingStartedOn(null);
        } else {
          setEvents((eventResult.data || []) as EmploymentEvent[]);
          setEventTrackingStartedOn(
            typeof trackingResult.data?.created_at === 'string'
              ? trackingResult.data.created_at.slice(0, 10)
              : null,
          );
        }
        setRuns(nextRuns);
        setPayslips(nextPayslips);
        setReviews(nextReviews);
      }
      setLoading(false);
    };

    void load();
    return () => { active = false; };
  }, [year, canViewPayroll, canViewKpi, reloadVersion, todayKey]);

  const unitById = useMemo(() => new Map(units.map((unit) => [unit.id, unit.name])), [units]);
  const visibleEvents = useMemo(
    () => events.filter((event) => !unitId || event.unit_id === unitId),
    [events, unitId],
  );
  const currentHeadcount = useMemo(
    () => people.filter((person) => person.is_active
      && person.employment_status !== 'terminated'
      && (!unitId || person.unit_id === unitId)).length,
    [people, unitId],
  );
  const departmentRows = useMemo<DepartmentHeadcount[]>(() => {
    const grouped = new Map<string, number>();
    for (const person of people) {
      if (!person.is_active || person.employment_status === 'terminated' || (unitId && person.unit_id !== unitId)) continue;
      const department = person.department?.trim() || 'Chưa phân phòng ban';
      grouped.set(department, (grouped.get(department) ?? 0) + 1);
    }
    const total = [...grouped.values()].reduce((sum, count) => sum + count, 0);
    return [...grouped.entries()]
      .map(([department, count]) => ({ department, count, percentage: total ? count / total * 100 : 0 }))
      .sort((a, b) => b.count - a.count || a.department.localeCompare(b.department));
  }, [people, unitId]);
  const allowedUserIds = useMemo(
    () => new Set(people
      .filter((person) => effectiveUnitId
        ? person.unit_id === effectiveUnitId
        : canViewAllKpi || person.id === profile?.id)
      .map((person) => person.id)),
    [people, effectiveUnitId, canViewAllKpi, profile?.id],
  );
  const visibleRuns = useMemo(() => new Map(runs.map((run) => [run.id, run])), [runs]);
  const visiblePayslips = useMemo(
    () => payslips.filter((slip) => visibleRuns.has(slip.run_id)
      && (!unitId || slip.department === unitById.get(unitId))),
    [payslips, visibleRuns, unitId, unitById],
  );
  const visibleReviews = useMemo(
    () => reviews.filter((review) => review.locked_at && allowedUserIds.has(review.user_id)),
    [reviews, allowedUserIds],
  );

  const movementRows = useMemo(() => MONTHS.map((month) => {
    const key = `${year}-${month}`;
    const inMonth = visibleEvents.filter((event) => monthKey(event.event_date) === key);
    const monthStart = `${key}-01`;
    const monthEndDate = new Date(Number(year), Number(month), 0);
    const monthEnd = `${monthEndDate.getFullYear()}-${String(monthEndDate.getMonth() + 1).padStart(2, '0')}-${String(monthEndDate.getDate()).padStart(2, '0')}`;
    const trackingStart = eventTrackingStartedOn;
    const trackedEvents = visibleEvents.filter((event) => trackingStart
      && event.event_date >= trackingStart
      && event.event_date <= todayKey);
    const netChange = (event: EmploymentEvent) => (
      event.event_type === 'HIRED' || event.event_type === 'REACTIVATED' ? 1
        : event.event_type === 'TERMINATED' ? -1
          : 0
    );
    const observationStart = trackingStart && trackingStart > monthStart ? trackingStart : monthStart;
    const observedTerminations = inMonth.filter((event) => event.event_type === 'TERMINATED'
      && trackingStart != null && event.event_date >= trackingStart).length;
    // Không tính tỷ lệ tháng đang diễn ra: headcount cuối kỳ và số nghỉ việc
    // đều chưa đầy đủ, khiến tỷ lệ tạm thời dễ bị hiểu thành kết quả cả tháng.
    const rateIsAvailable = !!trackingStart
      && monthEnd >= trackingStart
      && monthEnd <= todayKey;
    const endingHeadcount = rateIsAvailable
      ? currentHeadcount - trackedEvents
        .filter((event) => event.event_date > monthEnd)
        .reduce((sum, event) => sum + netChange(event), 0)
      : null;
    const startingHeadcount = rateIsAvailable
      ? currentHeadcount - trackedEvents
        .filter((event) => event.event_date >= observationStart)
        .reduce((sum, event) => sum + netChange(event), 0)
      : null;
    const averageHeadcount = startingHeadcount == null || endingHeadcount == null
      ? null
      : (startingHeadcount + endingHeadcount) / 2;
    const payroll = visiblePayslips.filter((slip) => {
      const run = visibleRuns.get(slip.run_id);
      return run ? monthKey(run.month_start) === key : false;
    });
    return {
      month: key,
      hired: inMonth.filter((event) => event.event_type === 'HIRED').length,
      terminated: inMonth.filter((event) => event.event_type === 'TERMINATED').length,
      activeAgain: inMonth.filter((event) => event.event_type === 'REACTIVATED').length,
      turnoverRate: averageHeadcount && averageHeadcount > 0
        ? observedTerminations / averageHeadcount * 100
        : null,
      gross: payroll.reduce((sum, slip) => sum + amount(slip.gross_pay), 0),
      employerInsurance: payroll.reduce((sum, slip) => sum + amount(slip.insurance_employer), 0),
      employees: payroll.length,
    };
  }), [year, visibleEvents, visiblePayslips, visibleRuns, currentHeadcount, eventTrackingStartedOn, todayKey]);

  const insuranceRows = useMemo(() => MONTHS.map((month) => {
    const key = `${year}-${month}`;
    const payroll = visiblePayslips.filter((slip) => {
      const run = visibleRuns.get(slip.run_id);
      return run ? monthKey(run.month_start) === key : false;
    });
    return {
      month: key,
      employees: payroll.length,
      taxable: payroll.reduce((sum, slip) => sum + amount(slip.taxable_income), 0),
      employeeInsurance: payroll.reduce((sum, slip) => sum + amount(slip.insurance_employee), 0),
      employerInsurance: payroll.reduce((sum, slip) => sum + amount(slip.insurance_employer), 0),
      incomeTax: payroll.reduce((sum, slip) => sum + amount(slip.personal_income_tax), 0),
    };
  }), [year, visiblePayslips, visibleRuns]);

  const kpiRows = useMemo(() => {
    const grouped = new Map<string, { month: string; unit: string; total: number; count: number; ratings: Map<string, number> }>();
    for (const review of visibleReviews) {
      if (review.final_pct == null) continue;
      const person = people.find((item) => item.id === review.user_id);
      const unitName = person?.unit_id ? unitById.get(person.unit_id) ?? person.department ?? 'Chưa gán đơn vị' : person?.department ?? 'Chưa gán đơn vị';
      const key = `${monthKey(review.period_month)}|${unitName}`;
      const row = grouped.get(key) ?? { month: monthKey(review.period_month), unit: unitName, total: 0, count: 0, ratings: new Map<string, number>() };
      row.total += amount(review.final_pct);
      row.count += 1;
      if (review.rating) row.ratings.set(review.rating, (row.ratings.get(review.rating) ?? 0) + 1);
      grouped.set(key, row);
    }
    return [...grouped.values()]
      .map((row) => ({
        ...row,
        average: row.count ? row.total / row.count : 0,
        ratingSummary: [...row.ratings.entries()].map(([rating, count]) => `${rating}: ${count}`).join(', '),
      }))
      .sort((a, b) => a.month.localeCompare(b.month) || a.unit.localeCompare(b.unit));
  }, [visibleReviews, people, unitById]);

  // Xu hướng KPI & tỷ lệ nhân sự đạt Khá - Giỏi (loại B trở lên) theo từng tháng trong năm
  const monthlyKpiTrend = useMemo(() => {
    return MONTHS.map((month) => {
      const key = `${year}-${month}`;
      const inMonth = visibleReviews.filter((r) => monthKey(r.period_month) === key && r.final_pct != null);
      const count = inMonth.length;
      const avg = count ? Math.round((inMonth.reduce((s, r) => s + amount(r.final_pct), 0) / count) * 10) / 10 : 0;
      const targetMetCount = inMonth.filter((r) => {
        if (r.rating) return ['A+', 'A', 'B'].includes(r.rating);
        return amount(r.final_pct) >= 81;
      }).length;
      const targetMetRate = count ? Math.round((targetMetCount / count) * 1000) / 10 : 0;
      return {
        month: key,
        monthLabel: `Tháng ${Number(month)}/${year}`,
        shortMonth: `T${Number(month)}`,
        count,
        avg,
        hasData: count > 0,
        targetMetCount,
        targetMetRate,
      };
    });
  }, [year, visibleReviews]);

  const exportExcel = async () => {
    try {
      const XLSX = await import('xlsx');
      const rows = report === 'movement'
        ? [
          ['Tháng', 'Tuyển mới', 'Nghỉ việc ghi nhận từ lúc bật lịch sử', 'Quay lại', 'Tỷ lệ nghỉ việc (%)', 'Số phiếu lương đã duyệt', 'Tổng lương gộp', 'BH doanh nghiệp'],
          ...movementRows.map((row) => [reportMonthLabel(row.month), row.hired, row.terminated, row.activeAgain, row.turnoverRate == null ? '' : Number(row.turnoverRate.toFixed(2)), row.employees, row.gross, row.employerInsurance]),
        ]
        : report === 'insurance'
          ? [
            ['Tháng', 'Số phiếu lương', 'Thu nhập tính thuế', 'BH NLĐ', 'BH doanh nghiệp', 'Thuế TNCN'],
            ...insuranceRows.map((row) => [reportMonthLabel(row.month), row.employees, row.taxable, row.employeeInsurance, row.employerInsurance, row.incomeTax]),
          ]
          : [
            ['Tháng', 'Đơn vị', 'Số phiếu KPI đã khóa', 'Điểm trung bình (%)', 'Xếp loại'],
            ...kpiRows.map((row) => [reportMonthLabel(row.month), row.unit, row.count, Number(row.average.toFixed(1)), row.ratingSummary]),
          ];
      const ws = XLSX.utils.aoa_to_sheet(rows);
      ws['!cols'] = rows[0].map((h, colIdx) => {
        let maxLen = String(h).length;
        for (let r = 1; r < rows.length; r++) {
          const s = String(rows[r][colIdx] ?? '');
          if (s.length > maxLen) maxLen = s.length;
        }
        return { wch: Math.max(maxLen + 4, 14) };
      });
      ws['!rows'] = [{ hpt: 26 }, ...Array(rows.length - 1).fill({ hpt: 22 })];
      ws['!views'] = [{ state: 'frozen', ySplit: 1 }];
      ws['!autofilter'] = {
        ref: XLSX.utils.encode_range({
          s: { r: 0, c: 0 },
          e: { r: rows.length - 1, c: rows[0].length - 1 },
        }),
      };

      const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
      for (let R = 1; R <= range.e.r; R++) {
        for (let C = 0; C <= range.e.c; C++) {
          const cell = ws[XLSX.utils.encode_cell({ r: R, c: C })];
          if (cell && typeof cell.v === 'number') {
            if (Number.isInteger(cell.v) && Math.abs(cell.v) >= 1000) {
              cell.z = '#,##0';
            } else if (!Number.isInteger(cell.v)) {
              cell.z = '#,##0.0#';
            }
          }
        }
      }

      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, ws, 'Báo cáo');
      if (report === 'movement') {
        const deptRows = [
          ['Phòng ban', 'Nhân sự hiện tại', 'Tỷ trọng (%)'],
          ...departmentRows.map((row) => [row.department, row.count, Number(row.percentage.toFixed(1))]),
        ];
        const deptWs = XLSX.utils.aoa_to_sheet(deptRows);
        deptWs['!cols'] = [{ wch: 30 }, { wch: 20 }, { wch: 18 }];
        deptWs['!rows'] = [{ hpt: 26 }, ...Array(deptRows.length - 1).fill({ hpt: 22 })];
        XLSX.utils.book_append_sheet(workbook, deptWs, 'Cơ cấu phòng ban');
      }
      XLSX.writeFile(workbook, `bao-cao-quan-tri-${report}-${year}.xlsx`);
      toast('Đã xuất báo cáo quản trị.', 'success');
    } catch (error) {
      toast('Xuất Excel thất bại: ' + (error instanceof Error ? error.message : String(error)), 'error');
    }
  };

  if (loading) return <Skeleton className="h-72" />;
  if (loadError) {
    return <ErrorState message={loadError} onRetry={() => setReloadVersion((value) => value + 1)} />;
  }

  const hasReportPermission = canViewPayroll || canViewKpi;

  return (
    <div className="space-y-4">
      <div className="rounded-none border border-slate-200/80 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 shadow-card px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5" aria-label="Năm báo cáo">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 whitespace-nowrap">Năm:</span>
            <div className="inline-flex items-center rounded-none border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
              <button
                type="button"
                onClick={() => setYear((y) => String(Math.max(2000, (Number(y) || 2026) - 1)))}
                className="flex h-9 w-7 items-center justify-center text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-800 dark:hover:text-slate-200 transition-colors"
                aria-label="Năm trước"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
              <input
                id="report-year"
                type="number"
                min="2000"
                max="2100"
                value={year}
                onChange={(event) => setYear(event.target.value)}
                className="h-9 w-14 bg-transparent text-center text-xs font-bold tabular-nums text-slate-800 dark:text-slate-100 outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                aria-label="Năm báo cáo"
              />
              <button
                type="button"
                onClick={() => setYear((y) => String(Math.min(2100, (Number(y) || 2026) + 1)))}
                className="flex h-9 w-7 items-center justify-center text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-800 dark:hover:text-slate-200 transition-colors"
                aria-label="Năm sau"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {(report === 'kpi' ? canViewAllKpi : canViewPayroll) ? (
            <div className="w-56 sm:w-64">
              <Dropdown
                square
                compact
                aria-label="Đơn vị / Phòng ban"
                placeholder="Tất cả đơn vị"
                value={unitId}
                searchable
                options={[
                  { value: '', label: 'Tất cả đơn vị' },
                  ...units.map((unit) => ({ value: unit.id, label: unit.name })),
                ]}
                onChange={(val) => setUnitId(val)}
              />
            </div>
          ) : (
            <div className="inline-flex h-9 items-center gap-1.5 rounded-none border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 px-3 text-xs">
              <span className="font-semibold text-slate-500 dark:text-slate-400">Đơn vị:</span>
              <span className="font-bold text-slate-800 dark:text-slate-100 truncate max-w-[160px]">
                {profile?.unit_id ? unitById.get(profile.unit_id) ?? 'Đơn vị của tôi' : 'Chỉ phiếu của tôi'}
              </span>
            </div>
          )}

          <Button
            variant="outline"
            size="sm"
            className="h-9 rounded-md gap-2 text-xs font-semibold border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-850 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 shadow-2xs"
            onClick={() => void exportExcel()}
            disabled={!hasReportPermission}
          >
            <Download className="h-3.5 w-3.5" /> Xuất Excel
          </Button>

          {canViewPayroll && (
            <span className="ml-auto text-xs font-semibold text-slate-500 dark:text-slate-400 hidden sm:inline-block">
              Quy mô: <strong className="font-mono text-slate-800 dark:text-slate-200">{currentHeadcount}</strong> nhân sự
            </span>
          )}
        </div>
      </div>

      {!hasReportPermission ? (
        <div className="rounded-none border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 text-center text-sm text-slate-600 dark:text-slate-400">
          Tài khoản chưa được cấp quyền xem báo cáo KPI hoặc bảng lương.
        </div>
      ) : (
        <>
          <div className="flex border-b border-slate-200 dark:border-slate-800" role="tablist" aria-label="Báo cáo quản trị">
            {availableTabs.map((tab) => (
              <button
                key={tab.key}
                type="button"
                role="tab"
                aria-selected={report === tab.key}
                onClick={() => setReport(tab.key)}
                className={`px-5 py-3 text-xs font-bold uppercase tracking-wider transition-colors border-b-2 -mb-px rounded-none ${
                  report === tab.key
                    ? 'border-indigo-600 bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 font-extrabold shadow-sm'
                    : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800/40'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {report === 'movement' && canViewPayroll && (
            <MovementReport
              rows={movementRows}
              currentHeadcount={currentHeadcount}
              departmentRows={departmentRows}
              eventTrackingStartedOn={eventTrackingStartedOn}
              hasEventHistoryTable={hasEventHistoryTable}
            />
          )}
          {report === 'insurance' && canViewPayroll && <InsuranceReport rows={insuranceRows} />}
          {report === 'kpi' && <KpiReport rows={kpiRows} monthlyTrend={monthlyKpiTrend} year={year} />}
        </>
      )}
    </div>
  );
}

function MovementReport({ rows, currentHeadcount, departmentRows, eventTrackingStartedOn, hasEventHistoryTable }: {
  rows: Array<{ month: string; hired: number; terminated: number; activeAgain: number; turnoverRate: number | null; gross: number; employerInsurance: number; employees: number }>;
  currentHeadcount: number;
  departmentRows: DepartmentHeadcount[];
  eventTrackingStartedOn: string | null;
  hasEventHistoryTable: boolean;
}) {
  const totalHired = rows.reduce((sum, row) => sum + row.hired, 0);
  const totalTerminated = rows.reduce((sum, row) => sum + row.terminated, 0);
  const totalActiveAgain = rows.reduce((sum, row) => sum + row.activeAgain, 0);
  const totalEmployees = rows.reduce((sum, row) => sum + row.employees, 0);
  const totalGross = rows.reduce((sum, row) => sum + row.gross, 0);
  const totalEmployerInsurance = rows.reduce((sum, row) => sum + row.employerInsurance, 0);

  return (
    <div className="space-y-4">
      {!hasEventHistoryTable && (
        <div className="rounded-none border border-amber-300 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 px-4 py-3 text-xs text-amber-900 dark:text-amber-200 space-y-1">
          <p className="font-semibold flex items-center gap-2">
            <span>⚠️</span> Bảng lịch sử biến động chưa được kích hoạt trên cơ sở dữ liệu
          </p>
          <p className="text-amber-800 dark:text-amber-300">
            Hệ thống đang tạm tính số tuyển mới từ ngày vào làm của hồ sơ nhân sự. Để ghi nhận đầy đủ lịch sử nghỉ việc và tỷ lệ turnover, vui lòng chạy migration <code>20261010100000_employment_status_report_history.sql</code> trong Supabase SQL Editor.
          </p>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        <SummaryCard icon={<Users className="h-4 w-4" />} label="Nhân sự hiện tại" value={String(currentHeadcount)} />
        <SummaryCard icon={<Users className="h-4 w-4" />} label="Tuyển mới trong năm" value={String(totalHired)} />
        <SummaryCard icon={<Wallet className="h-4 w-4" />} label="Tổng lương gộp đã duyệt" value={formatVND(totalGross)} />
      </div>

      <p className="rounded-none border border-amber-200 dark:border-amber-900/60 bg-amber-50/70 dark:bg-amber-950/20 px-4 py-2.5 text-xs text-amber-900 dark:text-amber-200">
        Lịch sử nghỉ việc ghi nhận từ {eventTrackingStartedOn ? reportMonthLabel(eventTrackingStartedOn.slice(0, 7)) : 'khi bắt đầu lưu sự kiện'}.
        Tỷ lệ tháng = số nghỉ việc / headcount bình quân đầu-cuối kỳ; chỉ tính cho các tháng đã kết thúc. Bảng lương chỉ quét các kỳ đã duyệt hoặc đã chi trả.
      </p>

      {/* 2 Biểu đồ: Quỹ lương (Sóng sánh monotone) & Biến động nhân sự */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Biểu đồ 1: Biến động tổng quỹ lương theo tháng - Biểu đồ sóng sánh với dải màu gradient */}
        <div className="border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 rounded-none p-4">
          <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-100 dark:border-slate-800">
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-slate-100">
                Biến động quỹ lương theo tháng (VNĐ)
              </h3>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Xu hướng quỹ lương gộp và chi phí bảo hiểm doanh nghiệp đóng
              </p>
            </div>
            <div className="flex items-center gap-3 text-xs">
              <span className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
                <span className="h-2.5 w-2.5 rounded-full inline-block" style={{ backgroundColor: '#4F46E5' }} /> Lương gộp
              </span>
              <span className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
                <span className="h-2.5 w-2.5 rounded-full inline-block" style={{ backgroundColor: '#8B5CF6' }} /> BH DN đóng
              </span>
            </div>
          </div>
          <div className="mt-4 h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={rows} margin={{ top: 10, right: 10, left: 15, bottom: 0 }}>
                <defs>
                  <linearGradient id="payrollGrossGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#4F46E5" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#4F46E5" stopOpacity={0.0} />
                  </linearGradient>
                  <linearGradient id="payrollInsGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#8B5CF6" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#8B5CF6" stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" opacity={0.6} />
                <XAxis
                  dataKey="month"
                  tickLine={false}
                  axisLine={{ stroke: '#CBD5E1' }}
                  tick={{ fontSize: 11, fill: '#64748B' }}
                  tickFormatter={shortMonthLabel}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 10, fill: '#64748B' }}
                  tickFormatter={(val) => `${Math.round(val / 1_000_000)}tr`}
                />
                <Tooltip
                  contentStyle={{ backgroundColor: '#FFFFFF', borderColor: '#E2E8F0', borderRadius: '0px', fontSize: '12px' }}
                  formatter={(val: any, name: any) => [formatVND(val), name]}
                  labelFormatter={(label) => `Tháng ${reportMonthLabel(label)}`}
                />
                <Area type="monotone" dataKey="gross" name="Lương gộp" stroke="#4F46E5" strokeWidth={2.5} fill="url(#payrollGrossGrad)" />
                <Area type="monotone" dataKey="employerInsurance" name="BH DN đóng" stroke="#8B5CF6" strokeWidth={2} fill="url(#payrollInsGrad)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Biểu đồ 2: Tuyển mới & Nghỉ việc theo tháng */}
        <div className="border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 rounded-none p-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-slate-100">
              Biến động nhân sự (Tuyển mới vs Nghỉ việc)
            </h3>
            <div className="flex items-center gap-3 text-xs">
              <span className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
                <span className="h-3 w-3 inline-block rounded-none" style={{ backgroundColor: '#10B981' }} /> Tuyển mới
              </span>
              <span className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
                <span className="h-3 w-3 inline-block rounded-none" style={{ backgroundColor: '#F43F5E' }} /> Nghỉ việc
              </span>
            </div>
          </div>
          <div className="mt-4 h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rows} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" opacity={0.6} />
                <XAxis
                  dataKey="month"
                  tickLine={false}
                  axisLine={{ stroke: '#CBD5E1' }}
                  tick={{ fontSize: 11, fill: '#64748B' }}
                  tickFormatter={shortMonthLabel}
                />
                <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: '#64748B' }} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#FFFFFF', borderColor: '#E2E8F0', borderRadius: '0px', fontSize: '12px' }}
                  formatter={(val: any, name: any) => [`${val} người`, name]}
                  labelFormatter={(label) => `Tháng ${reportMonthLabel(label)}`}
                />
                <Bar dataKey="hired" name="Tuyển mới" fill="#10B981" radius={[0, 0, 0, 0]} maxBarSize={18} />
                <Bar dataKey="terminated" name="Nghỉ việc" fill="#F43F5E" radius={[0, 0, 0, 0]} maxBarSize={18} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <ReportTable title="Biến động nhân sự & quỹ lương theo tháng" subtitle={`Năm ${rows[0]?.month.slice(0, 4) ?? ''}`}>
        <thead>
          <tr>
            <Th align="center" className="w-24">Tháng</Th>
            <Th align="center">Tuyển mới</Th>
            <Th align="center">Nghỉ việc</Th>
            <Th align="center">Quay lại</Th>
            <Th align="right">Tỷ lệ nghỉ việc</Th>
            <Th align="center">Phiếu lương</Th>
            <Th align="right">Tổng lương gộp (VNĐ)</Th>
            <Th align="right">BH doanh nghiệp (VNĐ)</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.month} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors">
              <Td align="center" bold>{reportMonthLabel(row.month)}</Td>
              <Td align="center" mono>{row.hired > 0 ? <span className="text-emerald-600 dark:text-emerald-400 font-semibold">+{row.hired}</span> : '0'}</Td>
              <Td align="center" mono>{row.terminated > 0 ? <span className="text-rose-600 dark:text-rose-400 font-semibold">-{row.terminated}</span> : '0'}</Td>
              <Td align="center" mono>{row.activeAgain > 0 ? <span className="text-blue-600 dark:text-blue-400 font-semibold">+{row.activeAgain}</span> : '0'}</Td>
              <Td align="right" mono>{row.turnoverRate == null ? '—' : `${row.turnoverRate.toFixed(2)}%`}</Td>
              <Td align="center" mono>{row.employees > 0 ? row.employees : '—'}</Td>
              <Td align="right" mono bold={row.gross > 0}>{formatVND(row.gross)}</Td>
              <Td align="right" mono>{formatVND(row.employerInsurance)}</Td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-slate-300 dark:border-slate-600 bg-slate-100/90 dark:bg-slate-800 font-bold text-slate-900 dark:text-slate-100">
            <Td align="center" bold>TỔNG CỘNG</Td>
            <Td align="center" mono bold>{totalHired > 0 ? `+${totalHired}` : '0'}</Td>
            <Td align="center" mono bold>{totalTerminated > 0 ? `-${totalTerminated}` : '0'}</Td>
            <Td align="center" mono bold>{totalActiveAgain > 0 ? `+${totalActiveAgain}` : '0'}</Td>
            <Td align="right" mono>—</Td>
            <Td align="center" mono bold>{totalEmployees}</Td>
            <Td align="right" mono bold>{formatVND(totalGross)}</Td>
            <Td align="right" mono bold>{formatVND(totalEmployerInsurance)}</Td>
          </tr>
        </tfoot>
      </ReportTable>

      <ReportTable title="Cơ cấu nhân lực hiện tại theo phòng ban" subtitle={`Tổng cộng ${currentHeadcount} nhân sự`}>
        <thead>
          <tr>
            <Th align="left">Phòng ban / Đơn vị</Th>
            <Th align="center" className="w-36">Số nhân sự</Th>
            <Th align="right" className="w-36">Tỷ trọng (%)</Th>
          </tr>
        </thead>
        <tbody>
          {departmentRows.map((row) => (
            <tr key={row.department} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors">
              <Td align="left" bold>{row.department}</Td>
              <Td align="center" mono>{row.count}</Td>
              <Td align="right" mono>{row.percentage.toFixed(1)}%</Td>
            </tr>
          ))}
        </tbody>
        {departmentRows.length === 0 ? (
          <EmptyTable message="Chưa có nhân sự đang hoạt động trong phạm vi báo cáo." />
        ) : (
          <tfoot>
            <tr className="border-t-2 border-slate-300 dark:border-slate-600 bg-slate-100/90 dark:bg-slate-800 font-bold text-slate-900 dark:text-slate-100">
              <Td align="left" bold>TỔNG CỘNG</Td>
              <Td align="center" mono bold>{departmentRows.reduce((s, r) => s + r.count, 0)}</Td>
              <Td align="right" mono bold>100.0%</Td>
            </tr>
          </tfoot>
        )}
      </ReportTable>
      {totalTerminated > 0 && (
        <Badge className="rounded-full px-2.5 py-0.5 bg-rose-50 text-rose-700 dark:bg-rose-950 dark:text-rose-300 border border-rose-200 dark:border-rose-800">
          {totalTerminated} trường hợp nghỉ việc được ghi nhận trong năm
        </Badge>
      )}
    </div>
  );
}

function renderHorizontalDeptTick(props: any) {
  const { x, y, payload } = props;
  const raw: string = String(payload?.value ?? '');
  if (!raw) return null;

  // Rút gọn các tiền tố phòng ban để hiển thị ngang hoàn toàn
  const clean = raw
    .replace(/^Phòng\s+/i, 'P. ')
    .replace(/^Bộ phận\s+/i, 'BP. ')
    .replace(/\s+-\s+Bộ phận\s+/i, ' - BP. ')
    .trim();

  // Chuỗi ngắn (<= 13 ký tự) nằm gọn trên 1 dòng ngang
  if (clean.length <= 13) {
    return (
      <g transform={`translate(${x},${y})`}>
        <text
          x={0}
          y={0}
          dy={12}
          textAnchor="middle"
          fill="#64748B"
          fontSize={10}
          fontWeight={500}
        >
          {clean}
        </text>
      </g>
    );
  }

  // Chuỗi dài hơn tách làm 2 dòng ngang cân đối
  let line1 = clean;
  let line2 = '';

  if (clean.includes(' - ')) {
    const parts = clean.split(' - ');
    line1 = parts[0];
    line2 = parts.slice(1).join(' - ');
  } else {
    const words = clean.split(/\s+/);
    if (words.length > 1) {
      const mid = Math.ceil(words.length / 2);
      line1 = words.slice(0, mid).join(' ');
      line2 = words.slice(mid).join(' ');
    }
  }

  if (line1.length > 14) line1 = line1.slice(0, 13) + '…';
  if (line2.length > 14) line2 = line2.slice(0, 13) + '…';

  return (
    <g transform={`translate(${x},${y})`}>
      <text
        x={0}
        y={0}
        textAnchor="middle"
        fill="#64748B"
        fontSize={10}
        fontWeight={500}
      >
        <tspan x={0} dy={10}>{line1}</tspan>
        {line2 ? <tspan x={0} dy={12}>{line2}</tspan> : null}
      </text>
    </g>
  );
}

function KpiReport({
  rows,
  monthlyTrend,
  year,
}: {
  rows: Array<{ month: string; unit: string; count: number; average: number; ratingSummary: string }>;
  monthlyTrend: Array<{
    month: string;
    monthLabel: string;
    shortMonth: string;
    count: number;
    avg: number;
    hasData: boolean;
    targetMetCount: number;
    targetMetRate: number;
  }>;
  year: string;
}) {
  const monthsWithData = monthlyTrend.filter((m) => m.hasData);
  const totalReviews = monthsWithData.reduce((s, m) => s + m.count, 0);
  const totalMet = monthsWithData.reduce((s, m) => s + m.targetMetCount, 0);
  const overallAvg = monthsWithData.length ? Math.round((monthsWithData.reduce((s, m) => s + m.avg, 0) / monthsWithData.length) * 10) / 10 : 0;
  const overallMetRate = totalReviews ? Math.round((totalMet / totalReviews) * 1000) / 10 : 0;

  return (
    <div className="space-y-4">
      {/* 3 Thẻ chỉ số tổng quan mức độ hoàn thành KPI */}
      <div className="grid gap-3 sm:grid-cols-3">
        <SummaryCard icon={<Target className="h-4 w-4" />} label="Điểm KPI hoàn thành TB năm" value={`${overallAvg}%`} />
        <SummaryCard icon={<Award className="h-4 w-4" />} label="Tỷ lệ nhân sự đạt Khá - Giỏi" value={`${overallMetRate}%`} />
        <SummaryCard icon={<ShieldCheck className="h-4 w-4" />} label="Tổng lượt đánh giá đã khóa sổ" value={`${totalReviews} phiếu`} />
      </div>

      {/* Biểu đồ sóng sánh: Xu hướng % hoàn thành KPI & tỷ lệ đạt Khá - Giỏi theo tháng */}
      <div className="border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 rounded-none p-4">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-100 dark:border-slate-800">
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-slate-100">
              Xu hướng % hoàn thành KPI & tỷ lệ đạt Khá - Giỏi 12 tháng năm {year}
            </h3>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Đường sóng thể hiện điểm KPI bình quân (%) và tỷ lệ nhân sự đạt từ mức Khá trở lên (xếp loại B, A, A+)
            </p>
          </div>
          <div className="flex items-center gap-4 text-xs">
            <span className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
              <span className="h-2.5 w-2.5 rounded-full inline-block" style={{ backgroundColor: '#4F46E5' }} /> % KPI bình quân
            </span>
            <span className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
              <span className="h-2.5 w-2.5 rounded-full inline-block" style={{ backgroundColor: '#10B981' }} /> % Đạt Khá - Giỏi
            </span>
            <span className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
              <span className="w-4 border-b border-dashed border-rose-500 inline-block" /> Mốc 100%
            </span>
          </div>
        </div>
        <div className="mt-4 h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={monthlyTrend} margin={{ top: 15, right: 15, left: -15, bottom: 0 }}>
              <defs>
                <linearGradient id="kpiAvgGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#4F46E5" stopOpacity={0.35} />
                  <stop offset="95%" stopColor="#4F46E5" stopOpacity={0.0} />
                </linearGradient>
                <linearGradient id="kpiTargetGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10B981" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#10B981" stopOpacity={0.0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" opacity={0.6} />
              <XAxis
                dataKey="shortMonth"
                tickLine={false}
                axisLine={{ stroke: '#CBD5E1' }}
                tick={{ fontSize: 11, fill: '#64748B' }}
              />
              <YAxis domain={[0, 130]} tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: '#64748B' }} />
              <ReferenceLine y={100} stroke="#EF4444" strokeDasharray="4 4" label={{ value: 'Chỉ tiêu 100%', fill: '#EF4444', fontSize: 10, position: 'right' }} />
              <Tooltip
                contentStyle={{ backgroundColor: '#FFFFFF', borderColor: '#E2E8F0', borderRadius: '0px', fontSize: '12px' }}
                formatter={(val: any, name: any, item: any) => {
                  if (name === '% KPI bình quân') {
                    return item.payload.hasData ? [`${val}%`, '% KPI bình quân'] : ['Chưa có dữ liệu', '% KPI bình quân'];
                  }
                  return item.payload.hasData
                    ? [`${val}% (${item.payload.targetMetCount}/${item.payload.count} người)`, 'Tỷ lệ Khá - Giỏi']
                    : ['Chưa có dữ liệu', 'Tỷ lệ Khá - Giỏi'];
                }}
                labelFormatter={(_label, payload) => payload?.[0]?.payload?.monthLabel ?? ''}
              />
              <Area type="monotone" dataKey="avg" name="% KPI bình quân" stroke="#4F46E5" strokeWidth={2.5} fill="url(#kpiAvgGrad)" />
              <Area type="monotone" dataKey="targetMetRate" name="Tỷ lệ Khá - Giỏi" stroke="#10B981" strokeWidth={2} fill="url(#kpiTargetGrad)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Biểu đồ điểm KPI trung bình theo đơn vị / phòng ban */}
      {rows.length > 0 && (
        <div className="border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 rounded-none p-4">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-slate-100 pb-3 border-b border-slate-100 dark:border-slate-800">
            Điểm KPI trung bình theo đơn vị / phòng ban (%)
          </h3>
          <div className="mt-4 h-60 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rows} margin={{ top: 5, right: 10, left: -20, bottom: 28 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" opacity={0.6} />
                <XAxis
                  dataKey="unit"
                  interval={0}
                  tickLine={false}
                  axisLine={{ stroke: '#CBD5E1' }}
                  tick={renderHorizontalDeptTick}
                />
                <YAxis domain={[0, 120]} tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: '#64748B' }} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#FFFFFF', borderColor: '#E2E8F0', borderRadius: '0px', fontSize: '12px' }}
                  labelFormatter={(label: any) => `Đơn vị: ${label}`}
                  formatter={(val: any) => [`${Number(val).toFixed(1)}%`, 'Điểm KPI']}
                />
                <Bar dataKey="average" name="Điểm trung bình" fill="#4F46E5" radius={[0, 0, 0, 0]} maxBarSize={28} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <ReportTable title="Tổng hợp các phiếu KPI đã khóa theo tháng và đơn vị">
        <thead>
          <tr>
            <Th align="center" className="w-24">Tháng</Th>
            <Th align="left">Đơn vị / Phòng ban</Th>
            <Th align="center">Số phiếu đã khóa</Th>
            <Th align="right">Điểm trung bình</Th>
            <Th align="left">Cơ cấu xếp loại</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.month}-${row.unit}`} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors">
              <Td align="center" bold>{reportMonthLabel(row.month)}</Td>
              <Td align="left" bold>{row.unit}</Td>
              <Td align="center" mono>{row.count}</Td>
              <Td align="right" mono bold>{row.average.toFixed(1)}%</Td>
              <Td align="left">{row.ratingSummary || '—'}</Td>
            </tr>
          ))}
        </tbody>
        {rows.length === 0 && <EmptyTable message="Chưa có phiếu KPI đã khóa trong năm được chọn hoặc tài khoản chưa có quyền xem dữ liệu." />}
      </ReportTable>
    </div>
  );
}

function InsuranceReport({ rows }: {
  rows: Array<{ month: string; employees: number; taxable: number; employeeInsurance: number; employerInsurance: number; incomeTax: number }>;
}) {
  const taxTotal = rows.reduce((sum, row) => sum + row.incomeTax, 0);
  const employeeInsuranceTotal = rows.reduce((sum, row) => sum + row.employeeInsurance, 0);
  const employerInsuranceTotal = rows.reduce((sum, row) => sum + row.employerInsurance, 0);
  const totalTaxable = rows.reduce((sum, row) => sum + row.taxable, 0);
  const totalEmployees = rows.reduce((sum, row) => sum + row.employees, 0);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <SummaryCard icon={<ShieldCheck className="h-4 w-4" />} label="BH NLĐ đóng (10.5%)" value={formatVND(employeeInsuranceTotal)} />
        <SummaryCard icon={<ShieldCheck className="h-4 w-4" />} label="BH doanh nghiệp đóng (21.5%)" value={formatVND(employerInsuranceTotal)} />
        <SummaryCard icon={<Wallet className="h-4 w-4" />} label="Thuế TNCN đã khấu trừ" value={formatVND(taxTotal)} />
      </div>
      <p className="rounded-none border border-slate-200/80 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 px-4 py-2.5 text-xs text-slate-600 dark:text-slate-400">
        Số liệu được trích xuất từ các kỳ lương đã được duyệt (APPROVED / PAID). Khoản bảo hiểm NLĐ trích 10.5% (BHXH 8%, BHYT 1.5%, BHTN 1%); Doanh nghiệp đóng 21.5% (BHXH 17.5%, BHYT 3%, BHTN 1%).
      </p>

      {/* Biểu đồ cơ cấu nghĩa vụ Bảo hiểm & Thuế theo tháng - Biểu đồ sóng sánh monotone */}
      <div className="border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 rounded-none p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-100 dark:border-slate-800">
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-slate-100">
              Cơ cấu nghĩa vụ bảo hiểm & thuế TNCN theo tháng (VNĐ)
            </h3>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Đường sóng biến động các khoản trích theo lương theo từng kỳ chi trả
            </p>
          </div>
          <div className="flex items-center gap-3 text-xs">
            <span className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
              <span className="h-2.5 w-2.5 rounded-full inline-block" style={{ backgroundColor: '#7C3AED' }} /> BH Doanh nghiệp (21.5%)
            </span>
            <span className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
              <span className="h-2.5 w-2.5 rounded-full inline-block" style={{ backgroundColor: '#0EA5E9' }} /> BH NLĐ (10.5%)
            </span>
            <span className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
              <span className="h-2.5 w-2.5 rounded-full inline-block" style={{ backgroundColor: '#F59E0B' }} /> Thuế TNCN
            </span>
          </div>
        </div>
        <div className="mt-4 h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={rows} margin={{ top: 10, right: 10, left: 15, bottom: 0 }}>
              <defs>
                <linearGradient id="insEmployerGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#7C3AED" stopOpacity={0.35} />
                  <stop offset="95%" stopColor="#7C3AED" stopOpacity={0.0} />
                </linearGradient>
                <linearGradient id="insEmployeeGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#0EA5E9" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#0EA5E9" stopOpacity={0.0} />
                </linearGradient>
                <linearGradient id="insTaxGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#F59E0B" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#F59E0B" stopOpacity={0.0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" opacity={0.6} />
              <XAxis
                dataKey="month"
                tickLine={false}
                axisLine={{ stroke: '#CBD5E1' }}
                tick={{ fontSize: 11, fill: '#64748B' }}
                tickFormatter={shortMonthLabel}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 10, fill: '#64748B' }}
                tickFormatter={(val) => `${Math.round(val / 1_000_000)}tr`}
              />
              <Tooltip
                contentStyle={{ backgroundColor: '#FFFFFF', borderColor: '#E2E8F0', borderRadius: '0px', fontSize: '12px' }}
                formatter={(val: any, name: any) => [formatVND(val), name]}
                labelFormatter={(label) => `Tháng ${reportMonthLabel(label)}`}
              />
              <Area type="monotone" dataKey="employerInsurance" name="BH Doanh nghiệp (21.5%)" stroke="#7C3AED" strokeWidth={2} fill="url(#insEmployerGrad)" />
              <Area type="monotone" dataKey="employeeInsurance" name="BH NLĐ (10.5%)" stroke="#0EA5E9" strokeWidth={2} fill="url(#insEmployeeGrad)" />
              <Area type="monotone" dataKey="incomeTax" name="Thuế TNCN" stroke="#F59E0B" strokeWidth={2} fill="url(#insTaxGrad)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      <ReportTable title="Tổng hợp nghĩa vụ bảo hiểm và thuế theo kỳ lương" subtitle="Số liệu thực tế từ snapshot phiếu lương đã duyệt">
        <thead>
          <tr>
            <Th align="center" className="w-24">Tháng</Th>
            <Th align="center">Số phiếu</Th>
            <Th align="right">Thu nhập tính thuế (VNĐ)</Th>
            <Th align="right">BH người lao động (VNĐ)</Th>
            <Th align="right">BH doanh nghiệp (VNĐ)</Th>
            <Th align="right">Thuế TNCN (VNĐ)</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.month} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors">
              <Td align="center" bold>{reportMonthLabel(row.month)}</Td>
              <Td align="center" mono>{row.employees > 0 ? row.employees : '—'}</Td>
              <Td align="right" mono bold={row.taxable > 0}>{formatVND(row.taxable)}</Td>
              <Td align="right" mono>{formatVND(row.employeeInsurance)}</Td>
              <Td align="right" mono>{formatVND(row.employerInsurance)}</Td>
              <Td align="right" mono bold={row.incomeTax > 0}>{formatVND(row.incomeTax)}</Td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-slate-300 dark:border-slate-600 bg-slate-100/90 dark:bg-slate-800 font-bold text-slate-900 dark:text-slate-100">
            <Td align="center" bold>TỔNG CỘNG</Td>
            <Td align="center" mono bold>{totalEmployees}</Td>
            <Td align="right" mono bold>{formatVND(totalTaxable)}</Td>
            <Td align="right" mono bold>{formatVND(employeeInsuranceTotal)}</Td>
            <Td align="right" mono bold>{formatVND(employerInsuranceTotal)}</Td>
            <Td align="right" mono bold>{formatVND(taxTotal)}</Td>
          </tr>
        </tfoot>
      </ReportTable>
    </div>
  );
}

function SummaryCard({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-none border border-slate-200/80 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 p-4 shadow-sm flex items-start gap-3">
      <span className="mt-0.5 rounded-none border border-indigo-100 dark:border-indigo-900/50 bg-indigo-50/80 dark:bg-indigo-950/40 p-2 text-indigo-600 dark:text-indigo-400">
        {icon}
      </span>
      <div>
        <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">{label}</p>
        <p className="mt-1 font-mono text-lg font-bold tabular-nums text-slate-900 dark:text-slate-100">{value}</p>
      </div>
    </div>
  );
}

function ReportTable({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div className="rounded-none border border-slate-200/80 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 shadow-card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/50 px-4 py-3">
        <p className="text-xs font-bold uppercase tracking-wider text-slate-900 dark:text-slate-100">{title}</p>
        {subtitle && <span className="text-[11px] text-slate-400 dark:text-slate-500">{subtitle}</span>}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs tabular-nums text-slate-700 dark:text-slate-200">
          {children}
        </table>
      </div>
    </div>
  );
}

function Th({ children, align = 'left', className = '' }: { children: ReactNode; align?: 'left' | 'center' | 'right'; className?: string }) {
  const alignClass = align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left';
  return (
    <th className={`whitespace-normal break-words leading-snug border-b border-r border-slate-200 dark:border-slate-700 bg-slate-50/90 dark:bg-slate-800/90 px-3 py-3 text-[11px] font-bold uppercase tracking-wider text-slate-700 dark:text-slate-200 ${alignClass} ${className}`}>
      {children}
    </th>
  );
}

function Td({ children, align = 'left', mono = false, bold = false, className = '' }: {
  children: ReactNode;
  align?: 'left' | 'center' | 'right';
  mono?: boolean;
  bold?: boolean;
  className?: string;
}) {
  const alignClass = align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left';
  return (
    <td className={`whitespace-nowrap border-b border-r border-slate-100 dark:border-slate-800 px-3 py-2.5 text-xs text-slate-700 dark:text-slate-200 ${mono ? 'font-mono tabular-nums' : ''} ${bold ? 'font-bold text-slate-900 dark:text-white' : ''} ${alignClass} ${className}`}>
      {children}
    </td>
  );
}

function EmptyTable({ message }: { message: string }) {
  return <tbody><tr><td colSpan={8} className="p-8 text-center text-slate-400 dark:text-slate-500">{message}</td></tr></tbody>;
}
