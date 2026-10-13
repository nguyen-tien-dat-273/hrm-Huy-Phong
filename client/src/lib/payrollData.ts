// ============================================================================
// Truy cập dữ liệu cho module lương.
// ----------------------------------------------------------------------------
// Tách khỏi component để trang AdminPayroll chỉ lo hiển thị, và để phần tính
// lương có thể kiểm chứng độc lập (xem `__tests__/payroll.check.ts`).
// ============================================================================

import { supabase } from './supabase';
import { describeDbError } from './dbError';
import type {
  Attendance,
  CompanyHoliday,
  EmployeePayItem,
  EmployeePayProfile,
  LeaveRequest,
  PayComponent,
  PayrollNamedParam,
  PayrollInput,
  PayrollRun,
  PayrollRunStatus,
  UnitPayItem,
  Payslip,
  PayslipLine,
  Profile,
} from '@/types';
import type { ComputedPayslip, PayrollAdjustment } from './payroll';
import {
  fetchPayrollSettings, fetchPitBrackets, DEFAULT_PAYROLL_SETTINGS, DEFAULT_PIT_BRACKETS,
  type PayrollSettings, type PitBracket,
} from './payrollSettings';
import { EMPTY_SCHEDULES, fetchWorkSchedules, type ScheduleSet } from './workSchedule';

export interface AttendanceRequestForPayroll {
  user_id: string;
  request_type: 'LATE_ARRIVAL' | 'EARLY_LEAVE' | 'OVERTIME';
  work_date: string;
  minutes: number | null;
  hours: number | null;
}

/** Dữ liệu cần để dựng bảng lương một tháng. */
export interface PayrollWorkspace {
  profiles: Profile[];
  components: PayComponent[];
  payProfiles: EmployeePayProfile[];
  items: EmployeePayItem[];
  /** Khoản gán cho cả đơn vị — người trong đơn vị thừa hưởng. */
  unitItems: UnitPayItem[];
  inputs: PayrollInput[];
  attendance: Attendance[];
  leaves: LeaveRequest[];
  /** Đơn đã duyệt dùng miễn phạt chuyên cần và tự lấy giờ tăng ca. */
  attendanceRequests: AttendanceRequestForPayroll[];
  /** Ngày lễ công ty rơi vào tháng đang tính — dùng tách L03 khỏi L01/L02. */
  holidays: string[];
  /** Ca làm việc — dùng tính công chuẩn theo tháng và đo đi muộn. */
  schedules: ScheduleSet;
  /** Truy lĩnh / truy thu kỳ trước dồn sang tháng này (LU-14). */
  adjustments: PayrollAdjustment[];
  run: PayrollRun | null;
  payslips: Payslip[];
  payslipLines: PayslipLine[];
  payrollSettings: PayrollSettings;
  /** Tham số tự khai — mã của chúng dùng được trong công thức. */
  namedParams: PayrollNamedParam[];
  pitBrackets: PitBracket[];
  timesheetLocked: boolean;
  /** Migration chưa chạy — UI hiện hướng dẫn thay vì báo lỗi khó hiểu. */
  engineReady: boolean;
  error: string | null;
}

const EMPTY: PayrollWorkspace = {
  profiles: [], components: [], payProfiles: [], items: [], unitItems: [], inputs: [],
  attendance: [], leaves: [], attendanceRequests: [], holidays: [], schedules: EMPTY_SCHEDULES, adjustments: [],
  run: null, payslips: [], payslipLines: [],
  payrollSettings: DEFAULT_PAYROLL_SETTINGS,
  namedParams: [],
  pitBrackets: DEFAULT_PIT_BRACKETS,
  timesheetLocked: false, engineReady: false, error: null,
};

/**
 * Nạp toàn bộ dữ liệu một kỳ lương trong một lượt.
 *
 * Chấm công chỉ lấy bản ĐÃ HOÀN TẤT và ĐÃ ĐƯỢC QUẢN LÝ DUYỆT: công chưa duyệt
 * không được phép chảy vào tiền lương. Nghỉ không lương bị loại khỏi ngày
 * hưởng lương ngay từ query.
 */
export async function loadPayrollWorkspace(
  monthStartStr: string,
  monthEndStr: string,
): Promise<PayrollWorkspace> {
  if (!supabase) return { ...EMPTY, error: 'Chưa kết nối Supabase.' };

  const [
    payrollSettings,
    pitBrackets,
    schedules,
    profilesRes, componentsRes, namedParamsRes, payProfilesRes, itemsRes, unitItemsRes, inputsRes,
    attendanceRes, leavesRes, attendanceRequestsRes, runRes, periodRes,
  ] = await Promise.all([
    // Tham số lương nằm ở bảng riêng `payroll_settings` (chỉ Admin/CEO ghi
    // được), không phải `app_settings` vốn mở cho quyền lẻ `settings`.
    fetchPayrollSettings(),
    // Biểu thuế lũy tiến: khai trong database để kế toán sửa được khi luật đổi.
    fetchPitBrackets(),
    // Ca làm việc: cho công chuẩn theo tháng (P02) và đo đi muộn.
    fetchWorkSchedules(),
    supabase.from('profiles_directory').select('*').eq('is_active', true).order('name'),
    supabase.from('payroll_components').select('*').order('sort_order'),
    supabase.from('payroll_named_params').select('*').eq('is_active', true).order('sort_order'),
    supabase.from('employee_pay_profiles').select('*').lte('effective_from', monthEndStr),
    supabase.from('employee_pay_items').select('*'),
    supabase.from('unit_pay_items').select('*'),
    supabase.from('payroll_inputs').select('*').eq('month_start', monthStartStr),
    supabase
      .from('attendance')
      .select('id, user_id, date, check_in_time, check_out_time, status, approved_by_lead, created_at')
      .eq('status', 'completed')
      .eq('approved_by_lead', true)
      .gte('date', monthStartStr)
      .lte('date', monthEndStr),
    supabase
      .from('leave_requests')
      .select('*')
      .eq('status', 'approved')
      .neq('leave_type', 'unpaid')
      .lte('start_date', monthEndStr)
      .gte('end_date', monthStartStr),
    supabase
      .from('attendance_requests')
      .select('user_id, request_type, work_date, minutes, hours')
      .eq('status', 'APPROVED')
      .gte('work_date', monthStartStr)
      .lte('work_date', monthEndStr),
    supabase.from('payroll_runs').select('*').eq('month_start', monthStartStr).maybeSingle(),
    supabase.from('timesheet_periods').select('status').eq('month_start', monthStartStr).maybeSingle(),
  ]);

  // Bảng company_holidays có thể chưa tồn tại (migration chưa chạy) — không
  // coi là lỗi chặn cả trang, chỉ đơn giản là chưa tách được L03.
  const holidaysRes = await supabase
    .from('company_holidays')
    .select('holiday_date')
    .eq('is_active', true)
    .gte('holiday_date', monthStartStr)
    .lte('holiday_date', monthEndStr);
  const holidays = ((holidaysRes.data || []) as Pick<CompanyHoliday, 'holiday_date'>[]).map(
    (row) => row.holiday_date,
  );

  // Điều chỉnh truy lĩnh/truy thu. Bảng có thể chưa tồn tại (migration chưa
  // chạy) — bỏ qua chứ không chặn cả trang, giống cách xử lý ngày lễ.
  const adjustmentsRes = await supabase
    .from('payroll_adjustments')
    .select('id, user_id, kind, amount, reason, taxable, origin_month')
    .eq('month_start', monthStartStr);
  const adjustments = (adjustmentsRes.data || []) as PayrollAdjustment[];

  // Bảng của bộ máy lương chưa tồn tại nghĩa là migration chưa chạy. Đây là
  // tình huống cấu hình, không phải lỗi dữ liệu — báo riêng để UI hướng dẫn.
  const engineReady = !componentsRes.error;

  const blockingError =
    profilesRes.error ?? attendanceRes.error ?? leavesRes.error ?? null;

  let payslips: Payslip[] = [];
  let payslipLines: PayslipLine[] = [];
  const run = (runRes.data as PayrollRun | null) ?? null;

  if (run) {
    const slipRes = await supabase.from('payslips').select('*').eq('run_id', run.id);
    payslips = (slipRes.data || []) as Payslip[];
    if (payslips.length > 0) {
      const linesRes = await supabase
        .from('payslip_lines')
        .select('*')
        .in('payslip_id', payslips.map((slip) => slip.id))
        .order('sequence');
      payslipLines = (linesRes.data || []) as PayslipLine[];
    }
  }

  return {
    profiles: (profilesRes.data || []) as Profile[],
    components: (componentsRes.data || []) as PayComponent[],
    // Bảng có thể chưa tồn tại (migration chưa chạy) — khi đó công thức nào
    // dùng mã tham số sẽ báo "không có biến", chứ cả trang không chết.
    namedParams: namedParamsRes.error ? [] : (namedParamsRes.data || []) as PayrollNamedParam[],
    payProfiles: (payProfilesRes.data || []) as EmployeePayProfile[],
    items: (itemsRes.data || []) as EmployeePayItem[],
    // Bảng có thể chưa tồn tại (migration chưa chạy) — khi đó chỉ mất phần
    // thừa hưởng theo đơn vị, khoản gán riêng vẫn chạy như cũ.
    unitItems: (unitItemsRes.data || []) as UnitPayItem[],
    inputs: (inputsRes.data || []) as PayrollInput[],
    attendance: (attendanceRes.data || []) as Attendance[],
    leaves: ((leavesRes.data || []) as LeaveRequest[]).filter((leave) => !leave.is_cancelled),
    // Giữ tương thích khi môi trường cũ chưa có bảng đơn chấm công: bảng
    // lương vẫn mở được, chỉ chưa tự miễn phạt/tự điền OT.
    attendanceRequests: attendanceRequestsRes.error
      ? []
      : (attendanceRequestsRes.data || []) as AttendanceRequestForPayroll[],
    holidays,
    adjustments,
    run,
    payslips,
    payslipLines,
    payrollSettings,
    pitBrackets,
    schedules,
    timesheetLocked: periodRes.data?.status === 'LOCKED',
    engineReady,
    error: blockingError ? describeDbError(blockingError) : null,
  };
}

// ---------------------------------------------------------------------------
// Ghi dữ liệu
// ---------------------------------------------------------------------------

export async function saveNamedParam(
  param: Partial<PayrollNamedParam> & { code: string; name: string },
): Promise<string | null> {
  if (!supabase) return 'Chưa kết nối Supabase.';
  const { error } = param.id
    ? await supabase.from('payroll_named_params').update(param).eq('id', param.id)
    : await supabase.from('payroll_named_params').insert(param);
  return error ? describeDbError(error) : null;
}

export async function deleteNamedParam(id: string): Promise<string | null> {
  if (!supabase) return 'Chưa kết nối Supabase.';
  const { error } = await supabase.from('payroll_named_params').delete().eq('id', id);
  return error ? describeDbError(error) : null;
}

export async function saveComponent(
  component: Partial<PayComponent> & { code: string; name: string },
): Promise<string | null> {
  if (!supabase) return 'Chưa kết nối Supabase.';
  const { error } = component.id
    ? await supabase.from('payroll_components').update(component).eq('id', component.id)
    : await supabase.from('payroll_components').insert(component);
  return error ? describeDbError(error) : null;
}

export async function deleteComponent(id: string): Promise<string | null> {
  if (!supabase) return 'Chưa kết nối Supabase.';
  const { error } = await supabase.from('payroll_components').delete().eq('id', id);
  return error ? describeDbError(error) : null;
}

export async function savePayProfile(
  payProfile: Partial<EmployeePayProfile> & { user_id: string; effective_from: string },
): Promise<string | null> {
  if (!supabase) return 'Chưa kết nối Supabase.';
  // Cùng người + cùng ngày hiệu lực là sửa lại bản ghi đó, không tạo bản trùng.
  const { error } = await supabase
    .from('employee_pay_profiles')
    .upsert(payProfile, { onConflict: 'user_id,effective_from' });
  return error ? describeDbError(error) : null;
}

/**
 * Lưu một khoản của một người. Trả về cả ID của dòng vừa ghi.
 *
 * ID là thứ bắt buộc với luồng "lưu lẻ từng khoản": lưu lẻ mà không giữ ID
 * thì lần lưu tổng sau đó coi khoản ấy là mới và CHÈN THÊM một dòng nữa cho
 * cùng một khoản — người đó ăn khoản lương hai lần.
 */
/**
 * Ba cột chỉ có sau migration 20261007100000.
 *
 * Đẩy code lên là deploy ngay, còn migration thì người dùng chạy tay — nên có
 * một quãng mà code mới gặp database cũ. Không xử lý thì cả màn Cơ chế lương
 * không lưu được gì trong quãng đó.
 */
const COT_MOI = ['taxable', 'insurable', 'is_base'] as const;

/** Database chưa có ba cột kia, chứ không phải người dùng nhập sai. */
function thieuCotMoi(error: { message?: string; code?: string }): boolean {
  const text = error.message ?? '';
  return COT_MOI.some((cot) => text.includes(`'${cot}'`) || text.includes(`"${cot}"`));
}

export async function savePayItem(
  item: Partial<EmployeePayItem> & { user_id: string; component_id: string; effective_from: string },
): Promise<{ error: string | null; id: string | null }> {
  if (!supabase) return { error: 'Chưa kết nối Supabase.', id: null };

  const ghi = async (payload: Record<string, unknown>) => (item.id
    ? await supabase!.from('employee_pay_items').update(payload).eq('id', item.id).select('id').single()
    : await supabase!.from('employee_pay_items').insert(payload).select('id').single());

  let { data, error } = await ghi(item);

  // Chạy lại không có ba cột mới. Khoản vẫn lưu được; ba tính chất kia tạm
  // lấy theo danh mục cho tới khi migration chạy.
  if (error && thieuCotMoi(error)) {
    const rutGon = { ...item } as Record<string, unknown>;
    for (const cot of COT_MOI) delete rutGon[cot];
    ({ data, error } = await ghi(rutGon));
  }

  return { error: error ? describeDbError(error) : null, id: (data as { id?: string } | null)?.id ?? null };
}

export async function deletePayItem(id: string): Promise<string | null> {
  if (!supabase) return 'Chưa kết nối Supabase.';
  const { error } = await supabase.from('employee_pay_items').delete().eq('id', id);
  return error ? describeDbError(error) : null;
}

export async function savePayrollInput(
  input: { user_id: string; month_start: string; code: string; quantity: number; created_by?: string | null },
): Promise<string | null> {
  if (!supabase) return 'Chưa kết nối Supabase.';
  const { error } = await supabase
    .from('payroll_inputs')
    .upsert(input, { onConflict: 'user_id,month_start,code' });
  return error ? describeDbError(error) : null;
}

// ---------------------------------------------------------------------------
// Kỳ chạy lương
// ---------------------------------------------------------------------------

export async function ensurePayrollRun(
  monthStart: string,
  createdBy: string | null,
): Promise<{ run: PayrollRun | null; error: string | null }> {
  if (!supabase) return { run: null, error: 'Chưa kết nối Supabase.' };

  const existing = await supabase
    .from('payroll_runs').select('*').eq('month_start', monthStart).maybeSingle();
  if (existing.data) return { run: existing.data as PayrollRun, error: null };

  const { data, error } = await supabase
    .from('payroll_runs')
    .insert({ month_start: monthStart, created_by: createdBy })
    .select()
    .single();
  return { run: (data as PayrollRun) ?? null, error: error ? describeDbError(error) : null };
}

export async function setRunStatus(
  runId: string,
  status: PayrollRunStatus,
  actorId: string | null,
): Promise<string | null> {
  if (!supabase) return 'Chưa kết nối Supabase.';
  const patch: Record<string, unknown> = { status };
  if (status === 'APPROVED') patch.approved_by = actorId;
  const { error } = await supabase.from('payroll_runs').update(patch).eq('id', runId);
  return error ? describeDbError(error) : null;
}

export interface PayslipToPersist {
  profile: Profile;
  computed: ComputedPayslip;
}

/**
 * Ghi kết quả tính xuống database — đây là bước "đóng băng".
 *
 * Thay toàn bộ phiếu và dòng chi tiết qua một RPC transaction. Trigger
 * `payslips_immutable` chặn thao tác này khi kỳ đã duyệt.
 */
export async function persistPayslips(
  run: PayrollRun,
  entries: PayslipToPersist[],
): Promise<string | null> {
  if (!supabase) return 'Chưa kết nối Supabase.';

  const { error } = await supabase.rpc('persist_payroll_payslips', {
    target_run_id: run.id,
    payslip_entries: entries.map(({ profile, computed }) => ({
      user_id: profile.id,
      employee_name: profile.name,
      employee_code: profile.employee_code ?? null,
      department: profile.department ?? null,
      pay_basis: computed.payBasis,
      work_days: computed.stats.workDays,
      leave_days: computed.stats.leaveDays,
      paid_days: computed.stats.paidDays,
      standard_days: computed.standardDays,
      work_hours: computed.stats.workHours,
      gross_pay: computed.gross,
      taxable_income: computed.taxableIncome,
      insurance_employee: computed.insuranceEmployee,
      insurance_employer: computed.insuranceEmployer,
      personal_income_tax: computed.personalIncomeTax,
      other_deductions: computed.otherDeductions,
      net_pay: computed.netPay,
      snapshot: computed.snapshot,
      lines: computed.lines.map((line, sequence) => ({
        sequence,
        code: line.code,
        name: line.name,
        kind: line.kind,
        quantity: line.quantity,
        rate: line.rate,
        amount: line.amount,
        taxable: line.taxable,
        insurable: line.insurable,
        detail: line.detail,
      })),
    })),
  });
  return error ? describeDbError(error) : null;
}

// ---------------------------------------------------------------------------
// Điều chỉnh truy lĩnh / truy thu (LU-14)
// ---------------------------------------------------------------------------

export async function savePayrollAdjustment(
  adjustment: {
    id?: string;
    user_id: string;
    month_start: string;
    origin_month: string | null;
    kind: 'RECOVERY' | 'CLAWBACK';
    amount: number;
    reason: string;
    taxable: boolean;
    created_by?: string | null;
  },
): Promise<string | null> {
  if (!supabase) return 'Chưa kết nối Supabase.';
  const { error } = adjustment.id
    ? await supabase.from('payroll_adjustments').update(adjustment).eq('id', adjustment.id)
    : await supabase.from('payroll_adjustments').insert(adjustment);
  return error ? describeDbError(error) : null;
}

export async function deletePayrollAdjustment(id: string): Promise<string | null> {
  if (!supabase) return 'Chưa kết nối Supabase.';
  const { error } = await supabase.from('payroll_adjustments').delete().eq('id', id);
  return error ? describeDbError(error) : null;
}

// ---------------------------------------------------------------------------
// Khoản lương theo đơn vị
// ---------------------------------------------------------------------------

export async function saveUnitPayItem(
  item: Partial<UnitPayItem> & { unit_id: string; component_id: string; effective_from: string },
): Promise<string | null> {
  if (!supabase) return 'Chưa kết nối Supabase.';
  const { error } = item.id
    ? await supabase.from('unit_pay_items').update(item).eq('id', item.id)
    : await supabase.from('unit_pay_items').insert(item);
  return error ? describeDbError(error) : null;
}

export async function deleteUnitPayItem(id: string): Promise<string | null> {
  if (!supabase) return 'Chưa kết nối Supabase.';
  const { error } = await supabase.from('unit_pay_items').delete().eq('id', id);
  return error ? describeDbError(error) : null;
}
