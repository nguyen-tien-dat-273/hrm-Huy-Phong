// ============================================================================
// Tính phiếu lương của MỘT người trong MỘT tháng từ dữ liệu workspace.
// ----------------------------------------------------------------------------
// Bảng lương (F06.04), Chạy thử (F06.02) và xem trước ở Cơ chế lương (F06.03)
// đều cần đúng một phép tính này. Để mỗi màn tự ghép thì sớm muộn ba màn ra
// ba con số khác nhau cho cùng một người — đúng loại lệch mà kế toán chỉ phát
// hiện khi nhân viên thắc mắc phiếu lương.
// ============================================================================

import {
  computePayslip, payProfileForPeriod, splitOvertimeHours, summarisePeriod,
  type AssignedPayItem, type ComputedPayslip, type PeriodStats,
} from './payroll';
import { resolvePayItems, resolveTemplateFor, type ResolvedTemplate, type SchemeSourceData } from './payrollScheme';
import { toPayrollParams, versionForMonth, type PayrollParamVersion, type PayrollParams } from './payrollSettings';
import { monthStandardDays } from './workSchedule';
import type { ResolvableUnit } from './kpiSchemeFor';
import type { PayrollWorkspace } from './payrollData';
import type { AppSettings } from './settings';
import type { EmployeePayProfile, Profile } from '@/types';

export function unitMapOf(data: Pick<PayrollWorkspace, 'units'>): Map<string, ResolvableUnit> {
  return new Map(data.units.map((unit) => [unit.id, { id: unit.id, name: unit.name, parent_id: unit.parent_id }]));
}

export function schemeSourceOf(data: PayrollWorkspace): SchemeSourceData {
  return {
    components: data.components,
    unitById: unitMapOf(data),
    templates: data.templates,
    templateItems: data.templateItems,
    unitTemplates: data.unitTemplates,
    unitItems: data.unitItems,
    employeeItems: data.items,
  };
}

/**
 * Bộ tham số engine cho tháng: bộ có hiệu lực + giờ chuẩn + công chuẩn theo
 * lịch làm việc (BR-PAY-001: "hiệu chỉnh được theo lịch làm việc thực tế").
 * Null khi chưa có bộ nào hiệu lực — bảng lương phải dừng, không đoán số.
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

export interface StatsOverride {
  workDays?: number;
  leaveDays?: number;
  holidayDays?: number;
  workHours?: number;
  lateCount?: number;
  earlyCount?: number;
}

export interface PersonComputation {
  computed: ComputedPayslip;
  payProfile: EmployeePayProfile | null;
  items: AssignedPayItem[];
  template: ResolvedTemplate;
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
    /** Thử một mẫu bảng lương khác mẫu người này đang theo. */
    templateIdOverride?: string | null;
    trace?: boolean;
  } = {},
): PersonComputation {
  const payProfile = payProfileForPeriod(
    data.payProfiles.filter((item) => item.user_id === person.id),
    monthEndStr,
  );
  const source = schemeSourceOf(data);
  const profileForTemplate = options.templateIdOverride !== undefined
    ? { template_id: options.templateIdOverride }
    : payProfile;
  const template = resolveTemplateFor(person, profileForTemplate, source, monthStartStr);
  const items = resolvePayItems(person, profileForTemplate, source, monthStartStr, monthEndStr);

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

  // Đơn OT đã duyệt tự chảy vào ba biến chuẩn. Số kế toán nhập tay vẫn được
  // ưu tiên để họ có thể điều chỉnh khi cần đối soát.
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
    earlyCount: override.earlyCount ?? real.earlyCount,
  };
  stats.paidDays = stats.workDays + stats.leaveDays + stats.holidayDays;

  const computed = computePayslip({
    profile: person,
    payProfile,
    items,
    inputs,
    stats,
    settings: params,
    // Chỉ khoản GÁN được mới thành biến 0 mặc định; khoản engine tự tính đã có
    // biến riêng do engine cấp.
    catalogCodes: data.components.filter((component) => component.calc_source !== 'ENGINE').map((component) => component.code),
    adjustments: data.adjustments.filter((adjustment) => adjustment.user_id === person.id),
    trace: options.trace,
  });

  return { computed, payProfile, items, template, inputs, stats, hasScheme: !!payProfile || items.length > 0 };
}
