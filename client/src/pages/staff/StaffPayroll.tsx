// ============================================================================
// Phiếu lương của nhân viên.
// ----------------------------------------------------------------------------
// Ưu tiên đọc phiếu ĐÃ CHỐT từ `payslips` thay vì tự tính lại. Bản cũ tính lại
// ngay trên máy nhân viên bằng cùng công thức cứng của trang admin — hai bên
// tính riêng thì sớm muộn cũng lệch nhau, và nhân viên là người phát hiện ra.
//
// Khi kỳ chưa duyệt, trang vẫn hiện bản tạm tính (dùng chung engine với admin)
// và nói rõ đó là tạm tính, để người ta theo dõi được thu nhập đang tới đâu.
// ============================================================================

import { useEffect, useMemo, useState } from 'react';
import { endOfMonth, format, startOfMonth } from 'date-fns';
import {
  Banknote, CalendarCheck2, CircleDollarSign, Clock3, LockKeyhole, Printer,
  ReceiptText, ShieldCheck, WalletCards,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { MonthNav } from '@/components/ui/MonthNav';
import { Skeleton } from '@/components/ui/Skeleton';
import { ErrorState } from '@/components/ui/ErrorState';
import { PayslipBreakdown, type BreakdownLine } from '@/components/payroll/PayslipBreakdown';
import { OrgContact } from '@/components/OrgContact';
import { useAuth } from '@/contexts/AuthContext';
import { useAppSettings } from '@/contexts/SettingsContext';
import { useRealtimeSync } from '@/hooks/useRealtimeSync';
import { supabase } from '@/lib/supabase';
import { describeDbErrorOrNull } from '@/lib/dbError';
import { formatVND, toDateString } from '@/lib/utils';
import {
  DEFAULT_PAYROLL_SETTINGS, DEFAULT_PIT_BRACKETS, fetchPayrollSettings, fetchPitBrackets,
  toPayrollParams, type PitBracket,
  type PayrollSettings,
} from '@/lib/payrollSettings';
import {
  EMPTY_SCHEDULES, fetchWorkSchedules, monthStandardDays, type ScheduleSet,
} from '@/lib/workSchedule';
import {
  computePayslip, itemsForPeriod, mergeUnitAndEmployeeItems, payBasisLabel,
  payProfileForPeriod, summarisePeriod,
  type AssignedPayItem, type PayrollAdjustment,
} from '@/lib/payroll';
import type {
  Attendance, EmployeePayItem, EmployeePayProfile, LeaveRequest,
  PayComponent, PayrollInput, Payslip, PayslipLine, UnitPayItem,
} from '@/types';

type PeriodStatus = 'OPEN' | 'REVIEW' | 'LOCKED' | null;

export function StaffPayroll() {
  const { profile } = useAuth();
  const settings = useAppSettings();
  const [monthStart, setMonthStart] = useState(() => startOfMonth(new Date()));

  const [payslip, setPayslip] = useState<Payslip | null>(null);
  const [payslipLines, setPayslipLines] = useState<PayslipLine[]>([]);
  const [payProfiles, setPayProfiles] = useState<EmployeePayProfile[]>([]);
  const [items, setItems] = useState<EmployeePayItem[]>([]);
  const [unitItems, setUnitItems] = useState<UnitPayItem[]>([]);
  const [adjustments, setAdjustments] = useState<PayrollAdjustment[]>([]);
  const [components, setComponents] = useState<PayComponent[]>([]);
  const [inputs, setInputs] = useState<PayrollInput[]>([]);
  const [attendance, setAttendance] = useState<Attendance[]>([]);
  const [leaves, setLeaves] = useState<LeaveRequest[]>([]);
  const [holidays, setHolidays] = useState<string[]>([]);
  const [schedules, setSchedules] = useState<ScheduleSet>(EMPTY_SCHEDULES);
  const [payrollSettings, setPayrollSettings] = useState<PayrollSettings>(DEFAULT_PAYROLL_SETTINGS);
  const [pitBrackets, setPitBrackets] = useState<PitBracket[]>(DEFAULT_PIT_BRACKETS);
  const [periodStatus, setPeriodStatus] = useState<PeriodStatus>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const monthStartStr = toDateString(monthStart);
  const monthEndStr = toDateString(endOfMonth(monthStart));
  const monthLabel = format(monthStart, 'MM/yyyy');

  const loadData = async (silent = false) => {
    if (!profile || !supabase) return;
    if (!silent) setLoading(true);

    // RLS chỉ trả phiếu của chính mình và chỉ khi kỳ đã duyệt, nên truy vấn
    // này an toàn kể cả khi điều kiện lọc phía client bị bỏ sót.
    const slipRes = await supabase
      .from('payslips')
      .select('*, payroll_runs!inner(month_start, status)')
      .eq('user_id', profile.id)
      .eq('payroll_runs.month_start', monthStartStr)
      // Chỉ phát hành phiếu khi kỳ đã được Admin duyệt hoặc đánh dấu đã trả.
      // Điều kiện này giữ đúng luồng nghiệp vụ ngay cả khi policy RLS bị cấu
      // hình rộng hơn dự kiến ở môi trường triển khai.
      .in('payroll_runs.status', ['APPROVED', 'PAID'])
      .maybeSingle();

    const approvedSlip = (slipRes.data as Payslip | null) ?? null;
    let lines: PayslipLine[] = [];
    if (approvedSlip) {
      const lineRes = await supabase
        .from('payslip_lines').select('*').eq('payslip_id', approvedSlip.id).order('sequence');
      lines = (lineRes.data || []) as PayslipLine[];
    }

    const [
      payProfileRes, itemRes, unitItemRes, componentRes, inputRes, attendanceRes, leaveRes, periodRes,
      adjustmentRes, payrollParams, workSchedules, taxBrackets,
    ] = await Promise.all([
      supabase.from('employee_pay_profiles').select('*').eq('user_id', profile.id).lte('effective_from', monthEndStr),
      supabase.from('employee_pay_items').select('*').eq('user_id', profile.id),
      profile.unit_id
        ? supabase.from('unit_pay_items').select('*').eq('unit_id', profile.unit_id)
        : Promise.resolve({ data: [], error: null }),
      supabase.from('payroll_components').select('*').order('sort_order'),
      supabase.from('payroll_inputs').select('*').eq('user_id', profile.id).eq('month_start', monthStartStr),
      supabase
        .from('attendance')
        .select('id, user_id, date, check_in_time, check_out_time, status, approved_by_lead, created_at')
        .eq('user_id', profile.id).eq('status', 'completed').eq('approved_by_lead', true)
        .gte('date', monthStartStr).lte('date', monthEndStr),
      supabase
        .from('leave_requests').select('*')
        .eq('user_id', profile.id).eq('status', 'approved').neq('leave_type', 'unpaid')
        .lte('start_date', monthEndStr).gte('end_date', monthStartStr),
      supabase.rpc('get_payroll_period_status', { target_month: monthStartStr }),
      // Truy linh / truy thu ky truoc. Khong nap thi so nhan vien tu xem
      // LECH han so ke toan tinh - dung thang co dieu chinh, nguoi lao dong
      // doi chieu phieu luong voi man nay se thay hai con so khac nhau ma
      // khong chuong nao giai thich.
      //
      // RLS cho phep doc dong cua chinh minh (`user_id = auth.uid()`).
      supabase
        .from('payroll_adjustments')
        .select('id, user_id, kind, amount, reason, taxable, origin_month')
        .eq('user_id', profile.id).eq('month_start', monthStartStr),
      fetchPayrollSettings(),
      fetchWorkSchedules(),
      fetchPitBrackets(),
    ]);
    const holidayRes = await supabase
      .from('company_holidays')
      .select('holiday_date')
      .eq('is_active', true)
      .gte('holiday_date', monthStartStr)
      .lte('holiday_date', monthEndStr);

    setPayslip(approvedSlip);
    setPayslipLines(lines);
    setPayProfiles((payProfileRes.data || []) as EmployeePayProfile[]);
    setItems((itemRes.data || []) as EmployeePayItem[]);
    setUnitItems((unitItemRes.data || []) as UnitPayItem[]);
    setAdjustments((adjustmentRes.data || []) as PayrollAdjustment[]);
    // Nhân viên KHÔNG đọc được `payroll_components` (RLS chỉ mở cho admin), nên
    // lỗi ở đây là bình thường — bản tạm tính khi đó chỉ có lương gốc.
    setComponents((componentRes.data || []) as PayComponent[]);
    setInputs((inputRes.data || []) as PayrollInput[]);
    setAttendance((attendanceRes.data || []) as Attendance[]);
    setLeaves(((leaveRes.data || []) as LeaveRequest[]).filter((leave) => !leave.is_cancelled));
    setHolidays(((holidayRes.data || []) as { holiday_date: string }[]).map((row) => row.holiday_date));
    setPayrollSettings(payrollParams);
    setSchedules(workSchedules);
    setPitBrackets(taxBrackets);
    setPeriodStatus(periodRes.error ? null : ((periodRes.data as PeriodStatus) ?? null));
    setLoadError(describeDbErrorOrNull(attendanceRes.error) ?? describeDbErrorOrNull(leaveRes.error));
    setLoading(false);
  };

  useEffect(() => { void loadData(); }, [profile?.id, monthStartStr]); // eslint-disable-line react-hooks/exhaustive-deps

  useRealtimeSync(
    profile ? [
      { table: 'payslips', filter: `user_id=eq.${profile.id}` },
      { table: 'employee_pay_profiles', filter: `user_id=eq.${profile.id}` },
      { table: 'attendance', filter: `user_id=eq.${profile.id}` },
      { table: 'leave_requests', filter: `user_id=eq.${profile.id}` },
      { table: 'payroll_runs' },
    ] : [],
    () => loadData(true),
    { enabled: !!profile, channelKey: `staff-payroll-${profile?.id ?? 'anonymous'}` },
  );

  /**
   * Phiếu đã chốt thắng bản tạm tính. Con số nhân viên nhìn thấy sau khi kỳ
   * được duyệt phải đúng bằng con số kế toán đã duyệt, không phụ thuộc vào
   * cấu hình hiện tại của hệ thống.
   */
  const view = useMemo(() => {
    if (payslip && payslipLines.length > 0) {
      return {
        frozen: true as const,
        payBasis: payslip.pay_basis,
        workDays: Number(payslip.work_days),
        leaveDays: Number(payslip.leave_days),
        paidDays: Number(payslip.paid_days),
        standardDays: Number(payslip.standard_days),
        workHours: Number(payslip.work_hours),
        gross: Number(payslip.gross_pay),
        netPay: Number(payslip.net_pay),
        lines: payslipLines.map((line): BreakdownLine => ({
          code: line.code, name: line.name, kind: line.kind,
          quantity: line.quantity, rate: line.rate,
          amount: Number(line.amount), detail: line.detail,
        })),
        warnings: [] as string[],
      };
    }

    if (!profile) return null;

    const payProfile = payProfileForPeriod(payProfiles, monthEndStr);
    if (!payProfile) return null;

    const componentById = new Map(components.map((component) => [component.id, component]));
    // Phải gộp khoản đơn vị giống hệt trang Bảng lương, nếu không phiếu tạm
    // tính của nhân viên sẽ thiếu đúng những khoản cả phòng cùng hưởng.
    const toAssigned = (rows: Array<{ component_id: string }>): AssignedPayItem[] =>
      rows
        .map((row) => ({ item: row, component: componentById.get(row.component_id) }))
        .filter((entry): entry is AssignedPayItem => !!entry.component);

    const assigned = mergeUnitAndEmployeeItems(
      itemsForPeriod(toAssigned(unitItems), monthStartStr, monthEndStr),
      itemsForPeriod(toAssigned(items), monthStartStr, monthEndStr),
    );

    const inputMap: Record<string, number> = {};
    for (const input of inputs) inputMap[input.code] = Number(input.quantity);

    // Công chuẩn ưu tiên lịch làm việc (P02), giống trang Bảng lương — hai bên
    // phải ra cùng một con số, nếu không phiếu tạm tính sẽ lệch phiếu chính thức.
    const calendarDays = monthStandardDays(schedules, monthStart, holidays);
    const baseParams = toPayrollParams(payrollSettings, settings, pitBrackets);
    const params = calendarDays == null
      ? baseParams
      : { ...baseParams, standardWorkDays: calendarDays };
    const stats = summarisePeriod(attendance, leaves, monthStart, params.hoursPerDay, holidays, schedules);
    const computed = computePayslip({
      profile,
      payProfile,
      items: assigned,
      inputs: inputMap,
      stats,
      settings: params,
      catalogCodes: components.map((component) => component.code),
      adjustments,
    });

    return {
      frozen: false as const,
      payBasis: computed.payBasis,
      workDays: stats.workDays,
      leaveDays: stats.leaveDays,
      paidDays: stats.paidDays,
      standardDays: computed.standardDays,
      workHours: stats.workHours,
      gross: computed.gross,
      netPay: computed.netPay,
      lines: computed.lines
        // Chi phí doanh nghiệp đóng là chuyện nội bộ, không đưa vào phiếu của
        // nhân viên — nó không ảnh hưởng gì tới số tiền họ nhận.
        .filter((line) => line.kind !== 'EMPLOYER_COST')
        .map((line): BreakdownLine => ({
          code: line.code, name: line.name, kind: line.kind,
          quantity: line.quantity, rate: line.rate, amount: line.amount, detail: line.detail,
        })),
      warnings: computed.warnings,
    };
  }, [payslip, payslipLines, payProfiles, items, components, inputs, attendance, leaves, profile, monthStartStr, monthEndStr, settings, payrollSettings, pitBrackets, schedules, holidays, unitItems]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) {
    return <div className="space-y-5"><Skeleton className="h-36" /><Skeleton className="h-80" /></div>;
  }
  if (loadError) {
    return <ErrorState message={loadError} onRetry={() => loadData()} />;
  }

  const statusTone = view?.frozen
    ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
    : 'border-amber-200 bg-amber-50 text-amber-800';

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-600">Thu nhập cá nhân</p>
          <h1 className="mt-1 font-display text-2xl font-extrabold text-slate-900">Phiếu lương của tôi</h1>
          <p className="mt-1 text-sm text-slate-500">Chỉ bạn và quản trị viên được phép xem thông tin này.</p>
        </div>
        <div className="flex items-center gap-2 no-print">
          <MonthNav value={monthStart} onChange={setMonthStart} theme="staff" />
          <Button variant="outline" onClick={() => window.print()} aria-label="In phiếu lương">
            <Printer className="h-4 w-4" /> In phiếu
          </Button>
        </div>
      </div>

      <div className={`flex items-start gap-3 rounded-2xl border px-4 py-3 text-sm ${statusTone}`}>
        {view?.frozen
          ? <ShieldCheck className="mt-0.5 h-5 w-5 flex-shrink-0" />
          : <LockKeyhole className="mt-0.5 h-5 w-5 flex-shrink-0" />}
        <div>
          <p className="font-bold">
            {view?.frozen ? `Phiếu lương ${monthLabel} đã được duyệt` : `Phiếu lương ${monthLabel} đang tạm tính`}
          </p>
          <p className="mt-0.5 text-xs leading-relaxed opacity-80">
            {view?.frozen
              ? 'Số liệu đã chốt và không thay đổi nữa. Nếu thấy sai sót, liên hệ HR/C&B.'
              : periodStatus === 'LOCKED'
                ? 'Kỳ công đã khóa, HR/C&B đang hoàn tất bảng lương. Số thực nhận có thể còn thay đổi.'
                : 'Kỳ công chưa khóa nên số liệu còn biến động theo chấm công và phê duyệt.'}
          </p>
        </div>
      </div>

      {!view ? (
        <Card>
          <CardContent className="py-12 text-center">
            <WalletCards className="mx-auto h-11 w-11 text-slate-300" />
            <h2 className="mt-3 font-display text-lg font-bold text-slate-800">Chưa có cơ chế lương</h2>
            <p className="mx-auto mt-1 max-w-lg text-sm text-slate-500">
              HR/C&B chưa thiết lập cách tính lương cho tài khoản của bạn. Vui lòng liên hệ bộ phận
              phụ trách để được cập nhật.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card className="overflow-hidden border-emerald-200 bg-gradient-to-br from-emerald-600 to-teal-700 text-white shadow-lg shadow-emerald-900/10">
            <CardContent className="relative py-7">
              <CircleDollarSign className="absolute -right-6 -top-8 h-36 w-36 text-white/10" />
              <div className="relative flex flex-wrap items-end justify-between gap-5">
                <div>
                  <p className="text-sm font-medium text-emerald-100">
                    {view.frozen ? `Thực nhận tháng ${monthLabel}` : `Thực nhận dự kiến tháng ${monthLabel}`}
                  </p>
                  <p className="mt-2 font-display text-4xl font-extrabold tracking-tight">
                    {formatVND(view.netPay)}
                  </p>
                  <p className="mt-2 text-xs text-emerald-100/90">
                    Tính theo cơ chế: {payBasisLabel(view.payBasis)}
                  </p>
                </div>
                <div className="rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-right backdrop-blur-sm">
                  <p className="text-xs text-emerald-100">Ngày hưởng lương</p>
                  <p className="mt-1 text-2xl font-extrabold">
                    {view.paidDays}
                    <span className="ml-1 text-sm font-medium text-emerald-100">/{view.standardDays} ngày</span>
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Metric
              icon={<Banknote className="h-5 w-5" />}
              label="Tổng thu nhập trước khấu trừ"
              value={formatVND(view.gross)}
              tone="blue"
            />
            <Metric
              icon={<CalendarCheck2 className="h-5 w-5" />}
              label="Công + phép hưởng lương"
              value={`${view.workDays} + ${view.leaveDays} ngày`}
              tone="emerald"
            />
            <Metric
              icon={<Clock3 className="h-5 w-5" />}
              label="Giờ làm ghi nhận"
              value={`${view.workHours} giờ`}
              tone="violet"
            />
          </div>

          <Card>
            <CardContent className="p-0">
              <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-4 sm:px-6">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
                  <ReceiptText className="h-5 w-5" />
                </span>
                <div>
                  <h2 className="font-display text-lg font-bold text-slate-900">Chi tiết phiếu lương</h2>
                  <p className="text-xs text-slate-500">Mỗi dòng kèm cách tính ra con số.</p>
                </div>
              </div>
              <div className="px-5 py-5 sm:px-6">
                <PayslipBreakdown
                  lines={view.lines}
                  netPay={view.netPay}
                  showEmployerCost={false}
                  warnings={view.warnings}
                  theme="staff"
                />
              </div>
              {payslip?.note && (
                <div className="border-t border-slate-100 bg-slate-50 px-5 py-4 text-xs text-slate-600 sm:px-6">
                  <strong className="text-slate-700">Ghi chú từ HR/C&B:</strong> {payslip.note}
                </div>
              )}
            </CardContent>
          </Card>

          <p className="flex items-start gap-2 text-xs leading-relaxed text-slate-400">
            <ShieldCheck className="mt-0.5 h-4 w-4 flex-shrink-0" />
            Dữ liệu được bảo vệ theo tài khoản đăng nhập. Nếu số ngày công, phép hoặc khoản khấu trừ
            chưa đúng, hãy liên hệ HR/C&B trước khi kỳ lương được chốt.
          </p>

          <OrgContact prefix="Thắc mắc về phiếu lương, liên hệ" className="px-1" />
        </>
      )}
    </div>
  );
}

function Metric({
  icon, label, value, tone,
}: {
  icon: React.ReactNode; label: string; value: string; tone: 'blue' | 'emerald' | 'violet';
}) {
  const tones = {
    blue: 'bg-blue-50 text-blue-600',
    emerald: 'bg-emerald-50 text-emerald-600',
    violet: 'bg-violet-50 text-violet-600',
  };
  return (
    <Card>
      <CardContent className="flex items-center gap-3 py-5">
        <span className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl ${tones[tone]}`}>
          {icon}
        </span>
        <div className="min-w-0">
          <p className="text-xs font-medium text-slate-500">{label}</p>
          <p className="mt-1 truncate text-base font-extrabold tabular-nums text-slate-900">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}
