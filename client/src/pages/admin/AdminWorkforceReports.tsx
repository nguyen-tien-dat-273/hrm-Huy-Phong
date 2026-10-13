import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Download, ShieldCheck, Users, Wallet } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Input, Select } from '@/components/ui/Input';
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

function reportMonthLabel(month: string) {
  return `${month.slice(5, 7)}/${month.slice(0, 4)}`;
}

export function AdminWorkforceReports() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const canViewPayroll = hasAdminFunction(profile, 'admin.payroll');
  const canViewAllKpi = hasAdminFunction(profile, 'admin.performance_manage');
  const canViewKpi = !!profile && profile.is_active;
  const [report, setReport] = useState<ReportKey>('movement');
  const [year, setYear] = useState(String(currentYear()));
  const [unitId, setUnitId] = useState('');
  const [units, setUnits] = useState<ReportUnit[]>([]);
  const [people, setPeople] = useState<ReportPerson[]>([]);
  const [events, setEvents] = useState<EmploymentEvent[]>([]);
  const [runs, setRuns] = useState<PayrollRun[]>([]);
  const [payslips, setPayslips] = useState<PayslipReport[]>([]);
  const [reviews, setReviews] = useState<KpiReviewReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadVersion, setReloadVersion] = useState(0);
  const effectiveUnitId = report === 'kpi' && !canViewAllKpi ? profile?.unit_id ?? '' : unitId;

  useEffect(() => {
    if (!canViewPayroll) setReport('kpi');
  }, [canViewPayroll]);

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
      const [peopleResult, unitResult, eventResult] = await Promise.all([
        supabase.from('profiles_directory')
          .select('id,name,employee_code,department,unit_id,employment_status,hire_date,is_active'),
        supabase.from('organization_units').select('id,name').eq('is_active', true).order('name'),
        supabase.from('employment_status_events')
          .select('user_id,event_type,event_date,unit_id,department')
          .gte('event_date', yearStart)
          .lte('event_date', yearEnd),
      ]);

      const firstError = peopleResult.error ?? unitResult.error ?? eventResult.error;
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
        const reviewResult = await supabase.from('performance_reviews')
          .select('period_month,user_id,final_pct,rating,locked_at')
          .gte('period_month', yearStart)
          .lte('period_month', yearEnd)
          .not('locked_at', 'is', null);
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
        setPeople((peopleResult.data || []) as ReportPerson[]);
        setUnits((unitResult.data || []) as ReportUnit[]);
        setEvents((eventResult.data || []) as EmploymentEvent[]);
        setRuns(nextRuns);
        setPayslips(nextPayslips);
        setReviews(nextReviews);
      }
      setLoading(false);
    };

    void load();
    return () => { active = false; };
  }, [year, canViewPayroll, canViewKpi, reloadVersion]);

  const unitById = useMemo(() => new Map(units.map((unit) => [unit.id, unit.name])), [units]);
  const visibleEvents = useMemo(
    () => events.filter((event) => !unitId || event.unit_id === unitId),
    [events, unitId],
  );
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
    const payroll = visiblePayslips.filter((slip) => {
      const run = visibleRuns.get(slip.run_id);
      return run ? monthKey(run.month_start) === key : false;
    });
    return {
      month: key,
      hired: inMonth.filter((event) => event.event_type === 'HIRED').length,
      terminated: inMonth.filter((event) => event.event_type === 'TERMINATED').length,
      activeAgain: inMonth.filter((event) => event.event_type === 'REACTIVATED').length,
      gross: payroll.reduce((sum, slip) => sum + amount(slip.gross_pay), 0),
      employerInsurance: payroll.reduce((sum, slip) => sum + amount(slip.insurance_employer), 0),
      employees: payroll.length,
    };
  }), [year, visibleEvents, visiblePayslips, visibleRuns]);

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

  const currentHeadcount = useMemo(
    () => people.filter((person) => person.is_active
      && person.employment_status !== 'terminated'
      && (effectiveUnitId
        ? person.unit_id === effectiveUnitId
        : canViewAllKpi || (report !== 'kpi' && canViewPayroll) || person.id === profile?.id)).length,
    [people, effectiveUnitId, canViewAllKpi, canViewPayroll, report, profile?.id],
  );

  const exportExcel = async () => {
    try {
      const XLSX = await import('xlsx');
      const rows = report === 'movement'
        ? [
            ['Tháng', 'Tuyển mới', 'Nghỉ việc ghi nhận từ lúc bật lịch sử', 'Quay lại', 'Số phiếu lương đã duyệt', 'Tổng lương gộp', 'BH doanh nghiệp'],
            ...movementRows.map((row) => [reportMonthLabel(row.month), row.hired, row.terminated, row.activeAgain, row.employees, row.gross, row.employerInsurance]),
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
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'Báo cáo');
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
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 py-4">
          <div className="w-36"><Input label="Năm báo cáo" type="number" min="2000" max="2100" value={year} onChange={(event) => setYear(event.target.value)} /></div>
          {(report === 'kpi' ? canViewAllKpi : canViewPayroll) ? (
            <div className="min-w-[200px] flex-1">
              <Select label="Đơn vị" value={unitId} onChange={(event) => setUnitId(event.target.value)}>
                <option value="">Tất cả đơn vị</option>
                {units.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}
              </Select>
            </div>
          ) : (
            <div className="min-w-[200px] flex-1 rounded-xl border border-slate-200 px-3 py-2">
              <p className="text-xs font-semibold text-slate-500">Phạm vi KPI</p>
              <p className="mt-1 text-sm text-slate-800">{profile?.unit_id ? unitById.get(profile.unit_id) ?? 'Đơn vị của tôi' : 'Chỉ phiếu của tôi'}</p>
            </div>
          )}
          <Button variant="outline" onClick={() => void exportExcel()} disabled={!hasReportPermission}>
            <Download className="h-4 w-4" /> Xuất Excel
          </Button>
        </CardContent>
      </Card>

      {!hasReportPermission ? (
        <Card><CardContent className="py-8 text-sm text-slate-600">Tài khoản chưa được cấp quyền xem báo cáo KPI hoặc bảng lương.</CardContent></Card>
      ) : (
        <>
          <div className="flex flex-wrap gap-2" role="tablist" aria-label="Báo cáo quản trị nhân sự">
            {REPORT_TABS.filter((tab) => tab.key === 'kpi' || canViewPayroll).map((tab) => (
              <button
                key={tab.key}
                type="button"
                role="tab"
                aria-selected={report === tab.key}
                onClick={() => setReport(tab.key)}
                className={`min-h-10 rounded-xl px-4 text-sm font-semibold transition ${
                  report === tab.key ? 'bg-indigo-600 text-white shadow-sm' : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {report === 'movement' && canViewPayroll && (
            <MovementReport rows={movementRows} currentHeadcount={currentHeadcount} />
          )}
          {report === 'insurance' && canViewPayroll && <InsuranceReport rows={insuranceRows} />}
          {report === 'kpi' && <KpiReport rows={kpiRows} />}
        </>
      )}
    </div>
  );
}

function MovementReport({ rows, currentHeadcount }: {
  rows: Array<{ month: string; hired: number; terminated: number; activeAgain: number; gross: number; employerInsurance: number; employees: number }>;
  currentHeadcount: number;
}) {
  const hired = rows.reduce((sum, row) => sum + row.hired, 0);
  const terminated = rows.reduce((sum, row) => sum + row.terminated, 0);
  const payrollTotal = rows.reduce((sum, row) => sum + row.gross, 0);
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <SummaryCard icon={<Users className="h-4 w-4" />} label="Nhân sự hiện tại" value={String(currentHeadcount)} />
        <SummaryCard icon={<Users className="h-4 w-4" />} label="Tuyển mới trong năm" value={String(hired)} />
        <SummaryCard icon={<Wallet className="h-4 w-4" />} label="Tổng lương gộp đã duyệt" value={formatVND(payrollTotal)} />
      </div>
      <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        Lịch sử nghỉ việc chỉ được ghi nhận từ ngày chạy migration báo cáo; hệ thống không suy đoán ngày nghỉ cũ từ trạng thái hiện tại.
        Bảng lương chỉ gồm các kỳ đã duyệt hoặc đã chi trả.
      </p>
      <ReportTable title="Biến động nhân sự & quỹ lương theo tháng">
        <thead><tr><Th>Tháng</Th><Th>Tuyển mới</Th><Th>Nghỉ việc</Th><Th>Quay lại</Th><Th>Phiếu lương</Th><Th>Tổng lương gộp</Th><Th>BH doanh nghiệp</Th></tr></thead>
        <tbody>{rows.map((row) => <tr key={row.month}><Td>{reportMonthLabel(row.month)}</Td><Td>{row.hired}</Td><Td>{row.terminated}</Td><Td>{row.activeAgain}</Td><Td>{row.employees}</Td><Td>{formatVND(row.gross)}</Td><Td>{formatVND(row.employerInsurance)}</Td></tr>)}</tbody>
      </ReportTable>
      {terminated > 0 && <Badge className="bg-rose-50 text-rose-700">{terminated} trường hợp nghỉ việc được ghi nhận trong năm</Badge>}
    </div>
  );
}

function KpiReport({ rows }: {
  rows: Array<{ month: string; unit: string; count: number; average: number; ratingSummary: string }>;
}) {
  return (
    <ReportTable title="Tổng hợp các phiếu KPI đã khóa theo tháng và đơn vị">
      <thead><tr><Th>Tháng</Th><Th>Đơn vị</Th><Th>Số phiếu</Th><Th>Điểm trung bình</Th><Th>Xếp loại</Th></tr></thead>
      <tbody>{rows.map((row) => <tr key={`${row.month}-${row.unit}`}><Td>{reportMonthLabel(row.month)}</Td><Td>{row.unit}</Td><Td>{row.count}</Td><Td>{row.average.toFixed(1)}%</Td><Td>{row.ratingSummary || '—'}</Td></tr>)}</tbody>
      {rows.length === 0 && <EmptyTable message="Chưa có phiếu KPI đã khóa trong năm được chọn hoặc tài khoản chưa có quyền xem dữ liệu." />}
    </ReportTable>
  );
}

function InsuranceReport({ rows }: {
  rows: Array<{ month: string; employees: number; taxable: number; employeeInsurance: number; employerInsurance: number; incomeTax: number }>;
}) {
  const taxTotal = rows.reduce((sum, row) => sum + row.incomeTax, 0);
  const insuranceTotal = rows.reduce((sum, row) => sum + row.employeeInsurance + row.employerInsurance, 0);
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <SummaryCard icon={<ShieldCheck className="h-4 w-4" />} label="BH NLĐ + doanh nghiệp" value={formatVND(insuranceTotal)} />
        <SummaryCard icon={<Wallet className="h-4 w-4" />} label="Thuế TNCN đã khấu trừ" value={formatVND(taxTotal)} />
      </div>
      <ReportTable title="Tổng hợp bảo hiểm và thuế theo kỳ lương đã duyệt">
        <thead><tr><Th>Tháng</Th><Th>Phiếu lương</Th><Th>Thu nhập tính thuế</Th><Th>BH người lao động</Th><Th>BH doanh nghiệp</Th><Th>Thuế TNCN</Th></tr></thead>
        <tbody>{rows.map((row) => <tr key={row.month}><Td>{reportMonthLabel(row.month)}</Td><Td>{row.employees}</Td><Td>{formatVND(row.taxable)}</Td><Td>{formatVND(row.employeeInsurance)}</Td><Td>{formatVND(row.employerInsurance)}</Td><Td>{formatVND(row.incomeTax)}</Td></tr>)}</tbody>
      </ReportTable>
    </div>
  );
}

function SummaryCard({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <Card><CardContent className="flex items-start gap-3 py-4">
      <span className="mt-0.5 rounded-lg bg-indigo-50 p-2 text-indigo-600">{icon}</span>
      <div><p className="text-xs font-semibold text-slate-500">{label}</p><p className="mt-1 text-lg font-bold text-slate-900">{value}</p></div>
    </CardContent></Card>
  );
}

function ReportTable({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader><CardTitle>{title}</CardTitle></CardHeader>
      <CardContent><div className="overflow-x-auto rounded-xl border border-slate-200">
        <table className="w-full min-w-[680px] text-sm"><>{children}</></table>
      </div></CardContent>
    </Card>
  );
}

function Th({ children }: { children: ReactNode }) {
  return <th className="whitespace-nowrap bg-slate-50 px-3 py-2.5 text-left text-xs font-semibold text-slate-500">{children}</th>;
}

function Td({ children }: { children: ReactNode }) {
  return <td className="whitespace-nowrap px-3 py-2.5 text-slate-700">{children}</td>;
}

function EmptyTable({ message }: { message: string }) {
  return <tbody><tr><td colSpan={5} className="p-5"><EmptyState title="Chưa có dữ liệu" description={message} /></td></tr></tbody>;
}
