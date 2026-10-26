// ============================================================================
// Truy cập dữ liệu cho module lương.
// ----------------------------------------------------------------------------
// Tách khỏi component để trang AdminPayroll chỉ lo hiển thị, và để phần tính
// lương có thể kiểm chứng độc lập (xem `__tests__/payroll.check.ts`).
//
// Mọi thao tác đổi trạng thái hay ghi cơ chế lương đi qua RPC ở database
// (migration 20261013*_m06_*). Client không còn ghi thẳng vào bảng cơ chế
// hay đổi cột trạng thái kỳ lương — database chặn, và các hàm cũ làm việc đó
// đã bị gỡ khỏi file này để không ai gọi nhầm.
// ============================================================================

import type { PostgrestError } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { describeDbError } from './dbError';
import type {
  Attendance,
  CompanyHoliday,
  EmployeeBankAccount,
  EmployeePayItem,
  LeaveRequest,
  OrganizationUnit,
  PayComponent,
  PayComponentCategory,
  PayrollApprovalEvent,
  PayrollBankTemplate,
  PayrollInput,
  PayrollRun,
  PayrollSchemeRequest,
  PayScheme,
  PaySchemeItem,
  Payslip,
  PayslipLayout,
  PayslipLine,
  Profile,
  SchemePayloadItem,
} from '@/types';
import type { ComputedPayslip, PayrollAdjustment } from './payroll';
import { otherDeductionsOf } from './payrollReportTags';
import { fetchParamVersions, type PayrollParamVersion } from './payrollSettings';
import { EMPTY_SCHEDULES, fetchWorkSchedules, type ScheduleSet } from './workSchedule';

export interface AttendanceRequestForPayroll {
  user_id: string;
  request_type: 'LATE_ARRIVAL' | 'EARLY_LEAVE' | 'OVERTIME' | 'OT_WEEKDAY' | 'OT_WEEKEND' | 'OT_HOLIDAY' | 'NIGHT_WORK';
  work_date: string;
  minutes: number | null;
  hours: number | null;
}

export interface LockReadiness {
  timesheetLocked: boolean;
  openKpiReviews: number;
  lastClosedMonth: string | null;
}

/** Dữ liệu cần để dựng bảng lương một tháng. */
export interface PayrollWorkspace {
  profiles: Profile[];
  /** Cây tổ chức — để giải cơ chế chung theo đơn vị cha. */
  units: OrganizationUnit[];
  categories: PayComponentCategory[];
  components: PayComponent[];
  paramVersions: PayrollParamVersion[];
  /** Cơ chế của từng người — mọi phiên bản, mỗi dòng đủ cách lấy số + công thức. */
  items: EmployeePayItem[];
  /** Bộ cơ chế mẫu — để sao chép cho người khác. */
  schemes: PayScheme[];
  schemeItems: PaySchemeItem[];
  /** Mẫu phiếu lương theo đơn vị — chỉ để trình bày phiếu. */
  payslipLayouts: PayslipLayout[];
  inputs: PayrollInput[];
  attendance: Attendance[];
  leaves: LeaveRequest[];
  /** Đơn đã duyệt dùng miễn phạt chuyên cần và tự lấy giờ tăng ca. */
  attendanceRequests: AttendanceRequestForPayroll[];
  /** Ngày lễ công ty rơi vào tháng đang tính — dùng tách L03 khỏi L01/L02. */
  holidays: string[];
  /** Ca làm việc — dùng tính công chuẩn theo tháng và đo đi muộn. */
  schedules: ScheduleSet;
  /** Điều chỉnh tăng / giảm dồn vào tháng này (FR06.04.02). */
  adjustments: PayrollAdjustment[];
  /** Đề xuất cơ chế lương chưa xử lý xong — để cây hiện "chờ duyệt". */
  schemeRequests: PayrollSchemeRequest[];
  run: PayrollRun | null;
  runEvents: PayrollApprovalEvent[];
  payslips: Payslip[];
  payslipLines: PayslipLine[];
  readiness: LockReadiness | null;
  /** Mã số liệu tháng do KPI tự điền khi khoá sổ — Bảng lương không cho gõ tay. */
  kpiCodes: string[];
  /** Mã số liệu tháng do Bảng công tự điền khi khoá kỳ công — cũng không gõ tay. */
  timesheetCodes: string[];
  timesheetLocked: boolean;
  /** Migration chưa chạy — UI hiện hướng dẫn thay vì báo lỗi khó hiểu. */
  engineReady: boolean;
  /** Bảng phiên bản tham số / đề xuất cơ chế đã có (migration F06.02–F06.04). */
  specReady: boolean;
  error: string | null;
}

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
  const empty: PayrollWorkspace = {
    profiles: [], units: [], categories: [], components: [], paramVersions: [],
    items: [], schemes: [], schemeItems: [], payslipLayouts: [], inputs: [],
    attendance: [], leaves: [], attendanceRequests: [], holidays: [], schedules: EMPTY_SCHEDULES,
    adjustments: [], schemeRequests: [], run: null, runEvents: [], payslips: [], payslipLines: [],
    readiness: null, kpiCodes: [], timesheetCodes: [], timesheetLocked: false, engineReady: false, specReady: false, error: null,
  };
  if (!supabase) return { ...empty, error: 'Chưa kết nối Supabase.' };

  const [
    versions, schedules,
    profilesRes, unitsRes, categoriesRes, componentsRes, itemsRes, schemesRes, schemeItemsRes, inputsRes,
    attendanceRes, leavesRes, attendanceRequestsRes, runRes, periodRes, requestsRes, holidaysRes, adjustmentsRes,
    layoutsRes,
  ] = await Promise.all([
    fetchParamVersions(),
    // Ca làm việc: cho công chuẩn theo tháng (BR-PAY-001) và đo đi muộn.
    fetchWorkSchedules(),
    supabase.from('profiles_directory').select('*').eq('is_active', true).order('name'),
    supabase.from('organization_units').select('id, code, name, unit_type, parent_id, manager_id, is_active, created_at, updated_at').order('name'),
    supabase.from('payroll_component_categories').select('*').order('sort_order'),
    supabase.from('payroll_components').select('*').order('sort_order'),
    // Nạp mọi phiên bản (cả tháng sau): cơ chế sửa được từ một tháng muộn hơn tháng đang xem.
    supabase.from('employee_pay_items').select('*'),
    // Bộ cơ chế mẫu: bảng chưa có (migration chưa chạy) thì báo lỗi thay vì đọc sai.
    supabase.from('payroll_schemes').select('id, name, created_at, updated_at').order('name'),
    supabase.from('payroll_scheme_items').select('id, scheme_id, component_id, mode, amount, formula, sort_order'),
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
    supabase.from('payroll_scheme_requests').select('*').in('status', ['DRAFT', 'SUBMITTED', 'REJECTED'])
      .order('updated_at', { ascending: false }),
    // Bảng có thể chưa tồn tại (migration chưa chạy) — chỉ là chưa tách được L03.
    supabase.from('company_holidays').select('holiday_date').eq('is_active', true)
      .gte('holiday_date', monthStartStr).lte('holiday_date', monthEndStr),
    supabase.from('payroll_adjustments')
      .select('id, user_id, kind, amount, reason, taxable, origin_month, component_code')
      .eq('month_start', monthStartStr),
    // Bảng có thể chưa tồn tại (migration chưa chạy) — phiếu dạng mẫu dùng cách hiện mặc định.
    supabase.from('payslip_layouts').select('unit_id, form_code, title, header, before_total, updated_at'),
  ]);

  // Bảng của bộ máy lương chưa tồn tại nghĩa là migration chưa chạy. Đây là
  // tình huống cấu hình, không phải lỗi dữ liệu — báo riêng để UI hướng dẫn.
  const engineReady = !componentsRes.error;
  const specReady = versions.supported && !schemesRes.error && !schemeItemsRes.error && !requestsRes.error && !categoriesRes.error;

  const blockingError =
    profilesRes.error ?? attendanceRes.error ?? leavesRes.error ?? null;

  let payslips: Payslip[] = [];
  let payslipLines: PayslipLine[] = [];
  let runEvents: PayrollApprovalEvent[] = [];
  const run = (runRes.data as PayrollRun | null) ?? null;

  if (run) {
    const [slipRes, eventsRes] = await Promise.all([
      supabase.from('payslips').select('*').eq('run_id', run.id),
      supabase.from('payroll_approval_events').select('*')
        .eq('subject_type', 'RUN').eq('subject_id', run.id).order('created_at', { ascending: false }),
    ]);
    payslips = (slipRes.data || []) as Payslip[];
    runEvents = eventsRes.error ? [] : (eventsRes.data || []) as PayrollApprovalEvent[];
    if (payslips.length > 0) {
      const linesRes = await supabase
        .from('payslip_lines')
        .select('*')
        .in('payslip_id', payslips.map((slip) => slip.id))
        .order('sequence');
      payslipLines = (linesRes.data || []) as PayslipLine[];
    }
  }

  const [readiness, kpiLinks, timesheetLinks] = await Promise.all([
    fetchLockReadiness(monthStartStr),
    // Bảng có thể chưa có (migration KPI chưa chạy) — khi đó chỉ KPI_PCT là mã tự điền.
    supabase.from('kpi_payroll_links').select('component_code'),
    supabase.from('timesheet_payroll_links').select('component_code'),
  ]);
  const timesheetCodes = ((timesheetLinks.data || []) as Array<{ component_code: string | null }>)
    .map((link) => link.component_code?.toUpperCase())
    .filter((code): code is string => !!code);
  const kpiCodes = ['KPI_PCT', ...((kpiLinks.data || []) as Array<{ component_code: string | null }>)
    .map((link) => link.component_code?.toUpperCase())
    .filter((code): code is string => !!code)];

  return {
    profiles: (profilesRes.data || []) as Profile[],
    units: (unitsRes.data || []) as OrganizationUnit[],
    categories: categoriesRes.error ? [] : (categoriesRes.data || []) as PayComponentCategory[],
    components: (componentsRes.data || []) as PayComponent[],
    paramVersions: versions.versions,
    items: (itemsRes.data || []) as EmployeePayItem[],
    schemes: schemesRes.error ? [] : (schemesRes.data || []) as PayScheme[],
    schemeItems: schemeItemsRes.error ? [] : (schemeItemsRes.data || []) as PaySchemeItem[],
    payslipLayouts: layoutsRes.error ? [] : (layoutsRes.data || []) as PayslipLayout[],
    inputs: (inputsRes.data || []) as PayrollInput[],
    attendance: (attendanceRes.data || []) as Attendance[],
    leaves: ((leavesRes.data || []) as LeaveRequest[]).filter((leave) => !leave.is_cancelled),
    // Giữ tương thích khi môi trường cũ chưa có bảng đơn chấm công: bảng
    // lương vẫn mở được, chỉ chưa tự miễn phạt/tự điền OT.
    attendanceRequests: attendanceRequestsRes.error
      ? []
      : (attendanceRequestsRes.data || []) as AttendanceRequestForPayroll[],
    holidays: ((holidaysRes.data || []) as Pick<CompanyHoliday, 'holiday_date'>[]).map((row) => row.holiday_date),
    adjustments: (adjustmentsRes.data || []) as PayrollAdjustment[],
    schemeRequests: requestsRes.error ? [] : (requestsRes.data || []) as PayrollSchemeRequest[],
    run,
    runEvents,
    payslips,
    payslipLines,
    readiness,
    kpiCodes,
    timesheetCodes,
    schedules,
    timesheetLocked: periodRes.data?.status === 'LOCKED',
    engineReady,
    specReady,
    error: blockingError ? describeDbError(blockingError) : versions.error,
  };
}

async function rpcError<T>(promise: PromiseLike<{ data: T; error: PostgrestError | null }>): Promise<{ data: T | null; error: string | null }> {
  const { data, error } = await promise;
  return { data: error ? null : data, error: error ? describeDbError(error) : null };
}

export async function fetchLockReadiness(monthStart: string): Promise<LockReadiness | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc('payroll_lock_readiness', { p_month: monthStart });
  if (error || !data) return null;
  const row = data as { timesheet_locked: boolean; open_kpi_reviews: number; last_closed_month: string | null };
  return {
    timesheetLocked: !!row.timesheet_locked,
    openKpiReviews: Number(row.open_kpi_reviews) || 0,
    lastClosedMonth: row.last_closed_month,
  };
}

export async function fetchLastClosedMonth(): Promise<string | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc('payroll_last_closed_month');
  return error ? null : (data as string | null);
}

/**
 * Kỳ lương của tháng đã khoá chưa (LOCKED / APPROVED / PAID). Dùng ở Bảng công
 * để ẩn "Mở lại kỳ công" (BR-PAY-009) — database cũng chặn thao tác đó.
 */
export async function fetchPayrollMonthClosed(monthStart: string): Promise<boolean> {
  if (!supabase) return false;
  const { data, error } = await supabase.rpc('payroll_month_closed', { p_month: monthStart });
  return !error && data === true;
}

// ---------------------------------------------------------------------------
// F06.01 — Danh mục khoản lương
// ---------------------------------------------------------------------------

/** Lỗi trùng mã từ ràng buộc unique: nói đúng câu đặc tả yêu cầu. */
function catalogError(error: PostgrestError): string {
  if (error.code === '23505' && /payroll_components_code_key|code/.test(error.message ?? '')
    && !/Tên khoản/.test(error.message ?? '')) {
    return 'Mã khoản lương đã tồn tại trên hệ thống.';
  }
  return describeDbError(error);
}

export async function saveComponent(
  component: Partial<PayComponent> & { code: string; name: string },
): Promise<string | null> {
  if (!supabase) return 'Chưa kết nối Supabase.';
  const { error } = component.id
    ? await supabase.from('payroll_components').update(component).eq('id', component.id)
    : await supabase.from('payroll_components').insert(component);
  return error ? catalogError(error) : null;
}

/** Thêm một đầu mục mới và trả về id — dùng khi tạo nhanh ngay trong màn thiết kế cơ chế. */
export async function createComponent(
  component: Partial<PayComponent> & { code: string; name: string },
): Promise<{ id: string | null; error: string | null }> {
  if (!supabase) return { id: null, error: 'Chưa kết nối Supabase.' };
  const { data, error } = await supabase.from('payroll_components').insert(component).select('id').single();
  return { id: (data as { id?: string } | null)?.id ?? null, error: error ? catalogError(error) : null };
}

/**
 * Tạo (id rỗng) hoặc sửa một dòng TRUNG GIAN ngay ở màn Cơ chế lương — dòng
 * không thuộc nhóm khoản lương nào nên không cần quyền Danh mục.
 */
export async function saveIntermediate(input: {
  id: string | null;
  code: string;
  name: string;
  showOnPayslip: boolean;
  note?: string | null;
}): Promise<{ id: string | null; error: string | null }> {
  if (!supabase) return { id: null, error: 'Chưa kết nối Supabase.' };
  const { data, error } = await rpcError(supabase.rpc('save_payroll_intermediate', {
    p_id: input.id,
    p_code: input.code,
    p_name: input.name,
    p_show_on_payslip: input.showOnPayslip,
    p_note: input.note ?? null,
  }));
  return { id: (data as string | null) ?? null, error };
}

/** Lưu mẫu phiếu lương của một đơn vị; `null` là bỏ mẫu riêng, theo cấp trên. */
export async function savePayslipLayout(
  unitId: string,
  layout: Omit<PayslipLayout, 'unit_id' | 'updated_at'> | null,
): Promise<string | null> {
  if (!supabase) return 'Chưa kết nối Supabase.';
  const { error } = await rpcError(supabase.rpc('save_payslip_layout', { p_unit_id: unitId, p_layout: layout }));
  return error;
}

/**
 * Xoá theo đúng luồng F06.01: khoản đã phát sinh trong kỳ lương chốt thì
 * database tự chuyển "Ngừng hoạt động" thay vì xoá.
 */
export async function removeComponent(id: string): Promise<{ result: 'DELETED' | 'DEACTIVATED' | null; error: string | null }> {
  if (!supabase) return { result: null, error: 'Chưa kết nối Supabase.' };
  const { data, error } = await rpcError(supabase.rpc('remove_payroll_component', { p_component_id: id }));
  return { result: data as 'DELETED' | 'DEACTIVATED' | null, error };
}

export interface StandardCatalogItem {
  std_no: number;
  code: string;
  name: string;
  category_code: string;
  kind: PayComponent['kind'];
  calc_source: PayComponent['calc_source'];
  taxable: boolean;
  insurable: boolean;
  is_base: boolean;
  note: string;
}

export async function fetchStandardCatalog(): Promise<StandardCatalogItem[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc('payroll_standard_catalog');
  return error ? [] : (data || []) as StandardCatalogItem[];
}

export async function seedStandardCatalog(): Promise<{ inserted: number; error: string | null }> {
  if (!supabase) return { inserted: 0, error: 'Chưa kết nối Supabase.' };
  const { data, error } = await rpcError(supabase.rpc('seed_standard_payroll_catalog'));
  return { inserted: Number(data) || 0, error };
}

// ---------------------------------------------------------------------------
// Cơ chế lương: cơ chế của từng người + bộ cơ chế mẫu để sao chép
// ---------------------------------------------------------------------------

/**
 * Lưu bộ cơ chế mẫu (id rỗng là tạo mới). `items` là TOÀN BỘ dòng của bộ mẫu.
 * Bộ mẫu không có tháng hiệu lực — chỉ là nơi để sao chép dòng sang người.
 */
export async function saveSchemeTemplate(
  id: string | null,
  name: string,
  items: SchemePayloadItem[],
): Promise<{ id: string | null; error: string | null }> {
  if (!supabase) return { id: null, error: 'Chưa kết nối Supabase.' };
  const { data, error } = await rpcError(supabase.rpc('save_payroll_scheme_template', {
    p_id: id, p_name: name, p_items: items,
  }));
  return { id: (data as string | null) ?? null, error };
}

export async function deleteSchemeTemplate(id: string): Promise<string | null> {
  if (!supabase) return 'Chưa kết nối Supabase.';
  const { error } = await rpcError(supabase.rpc('delete_payroll_scheme_template', { p_id: id }));
  return error;
}

/**
 * Lưu và áp dụng ngay cơ chế của một người, hiệu lực từ một tháng. `items` là
 * TOÀN BỘ dòng của người từ tháng đó; các tháng trước giữ nguyên.
 */
export async function saveScheme(args: {
  targetType: 'USER' | 'UNIT';
  userId: string | null;
  unitId: string | null;
  effectiveFrom: string;
  items: SchemePayloadItem[];
  note?: string | null;
}): Promise<string | null> {
  if (!supabase) return 'Chưa kết nối Supabase.';
  const { error } = await rpcError(supabase.rpc('save_payroll_scheme', {
    p_target_type: args.targetType,
    p_user_id: args.userId,
    p_unit_id: args.unitId,
    p_effective_from: args.effectiveFrom,
    p_payload: { items: args.items },
    p_note: args.note ?? null,
  }));
  return error;
}

export async function cancelSchemeRequest(id: string, reason?: string): Promise<string | null> {
  if (!supabase) return 'Chưa kết nối Supabase.';
  const { error } = await rpcError(supabase.rpc('cancel_payroll_scheme_request', { p_request_id: id, p_reason: reason ?? null }));
  return error;
}

/** Mã lỗi khi database đòi xác thực lại để ký (amr quá hạn). */
export const REAUTH_REQUIRED = 'REAUTH_REQUIRED';

function reviewError(error: PostgrestError | null): string | null {
  if (!error) return null;
  if (error.code === '28000') return REAUTH_REQUIRED;
  return describeDbError(error);
}

export async function reviewSchemeRequest(id: string, decision: 'APPROVED' | 'REJECTED', note: string | null): Promise<string | null> {
  if (!supabase) return 'Chưa kết nối Supabase.';
  const { error } = await supabase.rpc('review_payroll_scheme_request', {
    p_request_id: id, p_decision: decision, p_note: note,
  });
  return reviewError(error);
}

export async function fetchSchemeRequests(statuses: PayrollSchemeRequest['status'][]): Promise<PayrollSchemeRequest[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.from('payroll_scheme_requests').select('*')
    .in('status', statuses).order('updated_at', { ascending: false }).limit(200);
  return error ? [] : (data || []) as PayrollSchemeRequest[];
}

export async function fetchApprovalEvents(subjectType: 'SCHEME' | 'RUN', subjectIds: string[]): Promise<PayrollApprovalEvent[]> {
  if (!supabase || subjectIds.length === 0) return [];
  const { data, error } = await supabase.from('payroll_approval_events').select('*')
    .eq('subject_type', subjectType).in('subject_id', subjectIds).order('created_at', { ascending: false });
  return error ? [] : (data || []) as PayrollApprovalEvent[];
}

/** Người có chức năng Phê duyệt lương — để gửi thông báo trình ký. */
export async function fetchPayrollApproverIds(): Promise<string[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc('get_payroll_approver_ids');
  if (error || !Array.isArray(data)) return [];
  return (data as Array<{ user_id: string }>).map((row) => row.user_id).filter(Boolean);
}

// ---------------------------------------------------------------------------
// Số liệu tháng và điều chỉnh (FR06.04.02)
// ---------------------------------------------------------------------------

export async function savePayrollInput(
  input: { user_id: string; month_start: string; code: string; quantity: number; created_by?: string | null },
): Promise<string | null> {
  if (!supabase) return 'Chưa kết nối Supabase.';
  const { error } = await supabase
    .from('payroll_inputs')
    .upsert(input, { onConflict: 'user_id,month_start,code' });
  return error ? describeDbError(error) : null;
}

export async function savePayrollAdjustment(
  adjustment: {
    id?: string;
    user_id: string;
    month_start: string;
    origin_month: string | null;
    component_code?: string | null;
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
// F06.04 — Kỳ chạy lương
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

export interface PayslipToPersist {
  profile: Profile;
  computed: ComputedPayslip;
}

/**
 * Chạy bảng lương nháp: ghi toàn bộ phiếu và chuyển kỳ sang "Đã tính" trong
 * MỘT transaction ở database. Kỳ đã khoá thì từ chối.
 *
 * Phiếu có ba con số tổng: tổng cộng, tổng trừ, thực lĩnh. Hệ thống không biết
 * đâu là bảo hiểm hay thuế — chúng là các dòng như mọi dòng khác, nằm nguyên
 * trong `payslip_lines`. Bốn cột báo cáo (bảo hiểm NLĐ, doanh nghiệp đóng thêm,
 * thuế, thu nhập tính thuế) chỉ là tổng các đầu mục mà người dùng gắn Nhãn báo
 * cáo ở Danh mục; chưa gắn nhãn thì ghi 0. `other_deductions` là phần khấu trừ
 * còn lại sau khi tách bảo hiểm và thuế, nên cộng ba cột trừ luôn ra tổng trừ.
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
      pay_basis: 'MONTHLY',
      work_days: computed.stats.workDays,
      leave_days: computed.stats.leaveDays,
      paid_days: computed.stats.paidDays,
      standard_days: computed.standardDays,
      work_hours: computed.stats.workHours,
      gross_pay: computed.gross,
      taxable_income: computed.reportTotals.taxableIncome,
      insurance_employee: computed.reportTotals.insuranceEmployee,
      insurance_employer: computed.reportTotals.insuranceEmployer,
      personal_income_tax: computed.reportTotals.incomeTax,
      other_deductions: otherDeductionsOf(computed.totalDeductions, computed.reportTotals),
      rounding_adjustment: computed.roundingAdjustment,
      net_pay: computed.netPay,
      snapshot: computed.snapshot,
      lines: computed.lines.map((line, sequence) => ({
        sequence,
        code: line.code,
        name: line.name,
        kind: line.kind,
        quantity: null,
        rate: null,
        amount: line.amount,
        taxable: false,
        insurable: false,
        detail: line.detail,
      })),
    })),
  });
  return error ? describeDbError(error) : null;
}

/** Khoá kỳ (FR06.04.03). Phiên phải vừa nhập mã TOTP — xem `TwoFactorDialog`. */
export async function lockPayrollRun(runId: string): Promise<string | null> {
  if (!supabase) return 'Chưa kết nối Supabase.';
  const { error } = await supabase.rpc('lock_payroll_run', { p_run_id: runId });
  return reviewError(error);
}

export async function withdrawPayrollRun(runId: string, reason: string): Promise<string | null> {
  if (!supabase) return 'Chưa kết nối Supabase.';
  const { error } = await rpcError(supabase.rpc('withdraw_payroll_run', { p_run_id: runId, p_reason: reason }));
  return error;
}

/** BGĐ ký duyệt / từ chối chi trả (FR06.04.04). */
export async function reviewPayrollRun(runId: string, decision: 'APPROVED' | 'REJECTED', note: string | null): Promise<string | null> {
  if (!supabase) return 'Chưa kết nối Supabase.';
  const { error } = await supabase.rpc('review_payroll_run', { p_run_id: runId, p_decision: decision, p_note: note });
  return reviewError(error);
}

/** Xác nhận đã chi trả — phiếu lương phát hành cho nhân viên (FR06.04.05). */
export async function markPayrollRunPaid(runId: string): Promise<{ published: number; error: string | null }> {
  if (!supabase) return { published: 0, error: 'Chưa kết nối Supabase.' };
  const { data, error } = await rpcError(supabase.rpc('mark_payroll_run_paid', { p_run_id: runId }));
  return { published: Number(data) || 0, error };
}

export async function recordBankExport(runId: string, templateCode: string, rows: number, total: number): Promise<string | null> {
  if (!supabase) return 'Chưa kết nối Supabase.';
  const { error } = await rpcError(supabase.rpc('record_payroll_bank_export', {
    p_run_id: runId, p_template_code: templateCode, p_rows: rows, p_total: total,
  }));
  return error;
}

/** Kỳ lương đang chờ BGĐ duyệt / đã duyệt — cho màn Phê duyệt lương. */
export async function fetchRunsForApproval(): Promise<PayrollRun[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.from('payroll_runs').select('*')
    .in('status', ['LOCKED', 'APPROVED', 'PAID']).order('month_start', { ascending: false }).limit(24);
  return error ? [] : (data || []) as PayrollRun[];
}

export interface RunTotals {
  count: number;
  gross: number;
  deductions: number;
  net: number;
}

/**
 * Tổng khấu trừ của một phiếu: bảo hiểm + thuế + phần khấu trừ còn lại. Cộng cả
 * ba cột thì đúng cho mọi phiếu, dù đầu mục có gắn nhãn báo cáo hay không.
 */
export function payslipDeductions(slip: Pick<Payslip, 'insurance_employee' | 'personal_income_tax' | 'other_deductions'>): number {
  return (Number(slip.insurance_employee) || 0) + (Number(slip.personal_income_tax) || 0) + (Number(slip.other_deductions) || 0);
}

/** Tổng quỹ lương của từng kỳ — thứ BGĐ cần nhìn trước khi ký chi. */
export async function fetchRunTotals(runIds: string[]): Promise<Map<string, RunTotals>> {
  const totals = new Map<string, RunTotals>();
  if (!supabase || runIds.length === 0) return totals;
  const { data, error } = await supabase.from('payslips')
    .select('run_id, gross_pay, insurance_employee, personal_income_tax, other_deductions, net_pay')
    .in('run_id', runIds);
  if (error) return totals;
  for (const row of (data || []) as Array<Record<string, unknown>>) {
    const key = String(row.run_id);
    const current = totals.get(key) ?? { count: 0, gross: 0, deductions: 0, net: 0 };
    current.count += 1;
    current.gross += Number(row.gross_pay) || 0;
    current.deductions += payslipDeductions(row as Pick<Payslip, 'insurance_employee' | 'personal_income_tax' | 'other_deductions'>);
    current.net += Number(row.net_pay) || 0;
    totals.set(key, current);
  }
  return totals;
}

// ---------------------------------------------------------------------------
// Tài khoản nhận lương và mẫu file ngân hàng (FR06.04.04)
// ---------------------------------------------------------------------------

export async function fetchBankAccounts(): Promise<EmployeeBankAccount[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.from('employee_bank_accounts').select('*');
  return error ? [] : (data || []) as EmployeeBankAccount[];
}

export async function saveBankAccount(account: Omit<EmployeeBankAccount, 'updated_at'>): Promise<string | null> {
  if (!supabase) return 'Chưa kết nối Supabase.';
  const { error } = await supabase.from('employee_bank_accounts').upsert(account, { onConflict: 'user_id' });
  return error ? describeDbError(error) : null;
}

export async function fetchBankTemplates(): Promise<PayrollBankTemplate[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.from('payroll_bank_templates').select('*').order('sort_order');
  return error ? [] : (data || []) as PayrollBankTemplate[];
}

export async function saveBankTemplate(template: PayrollBankTemplate): Promise<string | null> {
  if (!supabase) return 'Chưa kết nối Supabase.';
  const { error } = await supabase.from('payroll_bank_templates').upsert(template, { onConflict: 'code' });
  return error ? describeDbError(error) : null;
}

// ---------------------------------------------------------------------------
// Phiếu lương của chính mình (FR06.04.05)
// ---------------------------------------------------------------------------

export interface MyPayslipStatus {
  published: boolean;
  publishedAt: string | null;
  inProgress: boolean;
  reauthRequired: boolean;
  reauthWindowMinutes: number;
}

export async function fetchMyPayslipStatus(monthStart: string): Promise<MyPayslipStatus | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc('get_my_payslip_status', { p_month: monthStart });
  if (error || !data) return null;
  const row = data as Record<string, unknown>;
  return {
    published: !!row.published,
    publishedAt: (row.published_at as string) ?? null,
    inProgress: !!row.in_progress,
    reauthRequired: !!row.reauth_required,
    reauthWindowMinutes: Number(row.reauth_window_minutes) || 0,
  };
}

export async function fetchMyPayslip(monthStart: string): Promise<{
  payslip: Payslip | null; lines: PayslipLine[]; layout: PayslipLayout | null; error: string | null;
}> {
  if (!supabase) return { payslip: null, lines: [], layout: null, error: 'Chưa kết nối Supabase.' };
  const { data, error } = await supabase.rpc('get_my_payslip', { p_month: monthStart });
  if (error) return { payslip: null, lines: [], layout: null, error: reviewError(error) };
  const row = data as { payslip?: Payslip; lines?: PayslipLine[]; layout?: PayslipLayout | null } | null;
  return { payslip: row?.payslip ?? null, lines: row?.lines ?? [], layout: row?.layout ?? null, error: null };
}
