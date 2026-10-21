// ============================================================================
// Tính phiếu lương của MỘT người trong MỘT tháng từ dữ liệu workspace.
// ----------------------------------------------------------------------------
// Bảng lương, Chạy thử và phần ước tính ở Cơ chế lương đều cần đúng một phép
// tính này. Để mỗi màn tự ghép thì sớm muộn ba màn ra ba con số khác nhau cho
// cùng một người.
// ============================================================================

import {
  computePayslip, splitOvertimeHours, summarisePeriod,
  type ComputedPayslip, type MechanismRow, type PeriodStats,
} from './payroll';
import { resolveMechanismRows, type SchemeSourceData } from './payrollScheme';
import { toPayrollParams, versionForMonth, type PayrollParamVersion, type PayrollParams } from './payrollSettings';
import { BUILTIN_FUNCTIONS, OWN_AMOUNT_CODE, OWN_AMOUNT_NAME, SYSTEM_VARIABLE_BY_CODE } from './payrollVariables';
import { monthStandardDays } from './workSchedule';
import type { PayrollWorkspace } from './payrollData';
import type { AppSettings } from './settings';
import type { Profile } from '@/types';

export function schemeSourceOf(data: PayrollWorkspace): SchemeSourceData {
  return {
    components: data.components,
    employeeItems: data.items,
  };
}

/**
 * Bộ tham số engine cho tháng: bộ có hiệu lực + giờ chuẩn + công chuẩn theo
 * lịch làm việc. Null khi chưa có bộ nào hiệu lực — bảng lương phải dừng,
 * không đoán số.
 */
export function paramsForMonth(
  data: Pick<PayrollWorkspace, 'paramVersions' | 'schedules' | 'holidays'>,
  app: Pick<AppSettings, 'standardHoursPerDay'>,
  monthStart: Date,
  monthStartStr: string,
  /** Bộ đang soạn (Chạy thử) thay cho bộ đã lưu. */
  draftVersion?: PayrollParamVersion | null,
): PayrollParams | null {
  const version = draftVersion ?? versionForMonth(data.paramVersions, monthStartStr);
  if (!version) return null;
  const calendarDays = monthStandardDays(data.schedules, monthStart, data.holidays);
  return toPayrollParams(version, app, calendarDays);
}

/** Tên hiển thị của một mã bất kỳ: đầu mục, tham số, dữ liệu tự động, hàm. */
export function nameResolver(
  components: ReadonlyArray<{ code: string; name: string }>,
  params: Pick<PayrollParams, 'names'> | null,
): (code: string) => string | undefined {
  const byCode = new Map<string, string>([[OWN_AMOUNT_CODE, OWN_AMOUNT_NAME]]);
  for (const fn of BUILTIN_FUNCTIONS) byCode.set(fn.code, fn.name);
  for (const variable of SYSTEM_VARIABLE_BY_CODE.values()) byCode.set(variable.code, variable.name);
  for (const [code, name] of Object.entries(params?.names ?? {})) byCode.set(code, name);
  for (const component of components) byCode.set(component.code.toUpperCase(), component.name);
  return (code) => byCode.get(code.toUpperCase());
}

export interface StatsOverride {
  workDays?: number;
  leaveDays?: number;
  holidayDays?: number;
  workHours?: number;
  lateCount?: number;
  lateMinutes?: number;
  earlyCount?: number;
  earlyMinutes?: number;
  lateAfterCutoffCount?: number;
  missingCheckout?: number;
}

export interface PersonComputation {
  computed: ComputedPayslip;
  rows: MechanismRow[];
  inputs: Record<string, number>;
  stats: PeriodStats;
  hasScheme: boolean;
}

export function computeForPerson(
  person: Profile,
  data: PayrollWorkspace,
  params: PayrollParams,
  monthStart: Date,
  monthStartStr: string,
  monthEndStr: string,
  options: {
    /** Số liệu giả định khi chạy thử — đè lên số liệu thật. */
    statsOverride?: StatsOverride;
    inputsOverride?: Record<string, number>;
    /** Thử bộ dòng đang soạn (cơ chế chung, ước tính khi khai riêng). */
    rowsOverride?: MechanismRow[];
    trace?: boolean;
  } = {},
): PersonComputation {
  const rows = options.rowsOverride
    ?? resolveMechanismRows(person, schemeSourceOf(data), monthStartStr, monthEndStr);

  const inputs: Record<string, number> = {};
  for (const input of data.inputs) {
    if (input.user_id === person.id) inputs[input.code] = Number(input.quantity);
  }

  const approvedRequests = data.attendanceRequests.filter((request) => request.user_id === person.id);
  const lateDates = new Set(
    approvedRequests.filter((request) => request.request_type === 'LATE_ARRIVAL').map((request) => request.work_date),
  );
  const earlyDates = new Set(
    approvedRequests.filter((request) => request.request_type === 'EARLY_LEAVE').map((request) => request.work_date),
  );

  // Đơn OT đã duyệt tự chảy vào ba biến giờ làm thêm. Số kế toán nhập tay vẫn
  // được ưu tiên để đối soát khi cần.
  const ot = splitOvertimeHours(approvedRequests, data.schedules, new Set(data.holidays));
  if (inputs.OT_WEEKDAY_HOURS == null && ot.weekday > 0) inputs.OT_WEEKDAY_HOURS = ot.weekday;
  if (inputs.OT_WEEKEND_HOURS == null && ot.weekend > 0) inputs.OT_WEEKEND_HOURS = ot.weekend;
  if (inputs.OT_HOLIDAY_HOURS == null && ot.holiday > 0) inputs.OT_HOLIDAY_HOURS = ot.holiday;
  Object.assign(inputs, options.inputsOverride ?? {});

  const real = summarisePeriod(
    data.attendance.filter((record) => record.user_id === person.id),
    data.leaves.filter((leave) => leave.user_id === person.id),
    monthStart,
    params.hoursPerDay,
    data.holidays,
    data.schedules,
    { lateDates, earlyDates },
  );
  const override = options.statsOverride ?? {};
  const stats: PeriodStats = {
    ...real,
    workDays: override.workDays ?? real.workDays,
    leaveDays: override.leaveDays ?? real.leaveDays,
    holidayDays: override.holidayDays ?? real.holidayDays,
    workHours: override.workHours ?? real.workHours,
    lateCount: override.lateCount ?? real.lateCount,
    lateMinutes: override.lateMinutes ?? real.lateMinutes,
    earlyCount: override.earlyCount ?? real.earlyCount,
    earlyMinutes: override.earlyMinutes ?? real.earlyMinutes,
    lateAfterCutoffCount: override.lateAfterCutoffCount ?? real.lateAfterCutoffCount,
    missingCheckout: override.missingCheckout ?? real.missingCheckout,
  };
  stats.paidDays = stats.workDays + stats.leaveDays + stats.holidayDays;

  const computed = computePayslip({
    profile: person,
    rows,
    stats,
    params,
    inputs,
    catalogCodes: data.components.map((component) => component.code),
    adjustments: data.adjustments.filter((adjustment) => adjustment.user_id === person.id),
    nameOf: nameResolver(data.components, params),
    trace: options.trace,
  });

  return { computed, rows, inputs, stats, hasScheme: rows.length > 0 };
}
