// ============================================================================
// Bảng công → Bảng lương: số liệu tháng, liên kết đầu mục, quy tắc tính.
// ----------------------------------------------------------------------------
// Mọi phép tính nằm ở database (timesheet_payroll_metrics); file này chỉ gọi RPC
// và giữ nhãn hiển thị. Khi khoá kỳ công, database tự ghi các số này vào số liệu
// lương tháng theo bảng liên kết.
// ============================================================================

import { supabase } from './supabase';
import { describeDbErrorOrNull } from './dbError';

export type TimesheetLinkSource =
  | 'OT_WEEKDAY_HOURS' | 'OT_WEEKEND_HOURS' | 'OT_HOLIDAY_HOURS' | 'NIGHT_WORK_DAYS' | 'LATE_DEDUCT_DAYS';

export interface TimesheetLink {
  source: TimesheetLinkSource;
  component_code: string | null;
}

export const TIMESHEET_LINK_SOURCES: ReadonlyArray<{ source: TimesheetLinkSource; label: string; unit: string; hint: string }> = [
  { source: 'OT_WEEKDAY_HOURS', label: 'Giờ làm thêm ngày thường', unit: 'giờ', hint: 'Từ đơn làm thêm đã duyệt, rơi vào ngày làm việc' },
  { source: 'OT_WEEKEND_HOURS', label: 'Giờ làm thêm Chủ nhật / ngày nghỉ', unit: 'giờ', hint: 'Từ đơn làm thêm đã duyệt, rơi vào ngày nghỉ hằng tuần' },
  { source: 'OT_HOLIDAY_HOURS', label: 'Giờ làm thêm ngày lễ', unit: 'giờ', hint: 'Từ đơn làm thêm đã duyệt, rơi vào ngày lễ công ty' },
  { source: 'NIGHT_WORK_DAYS', label: 'Công làm thêm sau 22h', unit: 'công', hint: 'Mỗi ngày ra sau mốc giờ đêm cộng một công' },
  { source: 'LATE_DEDUCT_DAYS', label: 'Công bị trừ do đi muộn quá số lần', unit: 'công', hint: 'Số ngày phạt sau khi đã trừ phép năm còn lại' },
];

/** Biến giờ làm thêm mà bảng lương đọc sẵn — chọn được dù không có trong danh mục đầu mục. */
export const OT_VARIABLE_OPTIONS: ReadonlyArray<{ code: string; name: string }> = [
  { code: 'OT_WEEKDAY_HOURS', name: 'Giờ làm thêm ngày thường' },
  { code: 'OT_WEEKEND_HOURS', name: 'Giờ làm thêm ngày nghỉ' },
  { code: 'OT_HOLIDAY_HOURS', name: 'Giờ làm thêm ngày lễ' },
];

export interface LateTier { from: number; days: number }

export interface TimesheetRules {
  late_tiers: LateTier[];
  night_cutoff: string;
  night_requires_ot: boolean;
  deduct_leave_first: boolean;
}

export const DEFAULT_TIMESHEET_RULES: TimesheetRules = {
  late_tiers: [{ from: 7, days: 1 }, { from: 11, days: 2 }, { from: 16, days: 6 }],
  night_cutoff: '22:00',
  night_requires_ot: true,
  deduct_leave_first: true,
};

/** Một dòng số liệu của một người trong tháng (từ timesheet_payroll_metrics). */
export interface TimesheetMetrics {
  user_id: string;
  ot_weekday: number;
  ot_weekend: number;
  ot_holiday: number;
  night_days: number;
  late_count: number;
  late_penalty_days: number;
  leave_balance: number;
  leave_deduct: number;
  pay_deduct: number;
  holiday_days: number;
}

const num = (value: unknown) => Number(value ?? 0) || 0;

/** Migration chưa chạy hoặc không đủ quyền thì trả `null` — Bảng công vẫn mở được, chỉ không hiện cột đối chiếu. */
export async function fetchTimesheetMetrics(monthStart: string): Promise<Map<string, TimesheetMetrics> | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc('timesheet_payroll_metrics', { p_month: monthStart });
  if (error) return null;
  const map = new Map<string, TimesheetMetrics>();
  for (const row of (data || []) as Array<Record<string, unknown>>) {
    const userId = String(row.user_id);
    map.set(userId, {
      user_id: userId,
      ot_weekday: num(row.ot_weekday),
      ot_weekend: num(row.ot_weekend),
      ot_holiday: num(row.ot_holiday),
      night_days: num(row.night_days),
      late_count: num(row.late_count),
      late_penalty_days: num(row.late_penalty_days),
      leave_balance: num(row.leave_balance),
      leave_deduct: num(row.leave_deduct),
      pay_deduct: num(row.pay_deduct),
      holiday_days: num(row.holiday_days),
    });
  }
  return map;
}

export async function fetchTimesheetLinks(): Promise<TimesheetLink[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.from('timesheet_payroll_links').select('source, component_code');
  return error ? [] : (data || []) as TimesheetLink[];
}

export async function fetchTimesheetRules(): Promise<TimesheetRules | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('timesheet_payroll_rules')
    .select('late_tiers, night_cutoff, night_requires_ot, deduct_leave_first')
    .maybeSingle();
  if (error || !data) return null;
  const tiers = Array.isArray(data.late_tiers) ? data.late_tiers as LateTier[] : [];
  return {
    late_tiers: tiers.map((tier) => ({ from: num(tier.from), days: num(tier.days) })).sort((a, b) => a.from - b.from),
    night_cutoff: String(data.night_cutoff ?? '22:00').slice(0, 5),
    night_requires_ot: !!data.night_requires_ot,
    deduct_leave_first: !!data.deduct_leave_first,
  };
}

export async function saveTimesheetLinks(links: TimesheetLink[]): Promise<string | null> {
  const { error } = await supabase.rpc('timesheet_save_payroll_links', { p_links: links });
  return describeDbErrorOrNull(error);
}

export async function saveTimesheetRules(rules: TimesheetRules): Promise<string | null> {
  const { error } = await supabase.rpc('timesheet_save_payroll_rules', {
    p_late_tiers: rules.late_tiers,
    p_night_cutoff: rules.night_cutoff,
    p_night_requires_ot: rules.night_requires_ot,
    p_deduct_leave_first: rules.deduct_leave_first,
  });
  return describeDbErrorOrNull(error);
}

/** Số ngày phạt ứng với số lần đi muộn — cùng cách tra với database, dùng để xem trước bảng bậc. */
export function penaltyDaysFor(lateCount: number, tiers: readonly LateTier[]): number {
  let days = 0;
  let best = -1;
  for (const tier of tiers) {
    if (lateCount >= tier.from && tier.from > best) { best = tier.from; days = tier.days; }
  }
  return days;
}
