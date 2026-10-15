// ============================================================================
// Bộ máy tính lương THEO CƠ CHẾ.
// ----------------------------------------------------------------------------
// Một cơ chế lương là danh sách đầu mục lấy từ Danh mục. Mỗi dòng có một cách
// lấy giá trị:
//
//   Công thức      tham số, dữ liệu chấm công / KPI và các đầu mục KHÁC của
//                  cùng cơ chế — kết quả dòng này lại là biến của dòng sau
//   Giá trị        một con số chung, người / đơn vị khai riêng được
//   Từng người     con số khai cho từng người (lương cơ bản, số người phụ thuộc…)
//   Hằng tháng     số liệu nhập mỗi tháng (doanh số, số chuyến…)
//
// Dòng tính theo THỨ TỰ PHỤ THUỘC chứ không theo thứ tự hiện trên phiếu: B
// dùng A thì A luôn được tính trước. Vòng lặp (A dùng B, B dùng A) không tính
// được — dòng trong vòng ra 0 kèm cảnh báo, không chọn bừa một bên.
//
// Engine KHÔNG biết dòng nào là bảo hiểm hay thuế: mọi khoản là một đầu mục có
// tên. Nó chỉ biết đầu mục CỘNG vào lương, TRỪ khỏi lương, hay CHỈ ĐỂ TÍNH
// (Loại dòng ở Danh mục). Thực lĩnh = tổng cộng − tổng trừ, làm tròn theo
// bộ tham số. "Nhãn báo cáo" của đầu mục chỉ được cộng lại để báo cáo đọc
// (`reportTotals`), không dòng nào của phiếu đọc nó.
//
// Đọc kèm:
//   - `payrollFormula.ts`   bộ đánh giá biểu thức (không dùng eval)
//   - `payrollScheme.ts`    giải cơ chế của một người theo cây tổ chức
// ============================================================================

import { evaluateFormula, FormulaError, roundTo } from './payrollFormula';
import { referencedCodes, renderFormulaWithValues } from './formulaTokens';
import type { PayrollParams } from './payrollSettings';
import { OWN_AMOUNT_CODE, TOTAL_EARNINGS_CODE, type RowMode } from './payrollVariables';
import { sumReportTags, type ReportTotals } from './payrollReportTags';
import {
  dayWeight, EMPTY_PUNCTUALITY, EMPTY_SCHEDULES, measurePunctuality,
  type PunctualityExceptions, type ScheduleSet,
} from './workSchedule';
import type {
  Attendance,
  EmployeePayProfile,
  LeaveRequest,
  PayComponent,
  PayComponentKind,
  Profile,
} from '@/types';

// ---------------------------------------------------------------------------
// Tổng hợp công và phép trong kỳ
// ---------------------------------------------------------------------------

export interface PeriodStats {
  workDays: number;
  leaveDays: number;
  /**
   * Ngày nghỉ lễ công ty (L03, sheet "Đặc tả Lương – KPI") — CÓ lương nhưng
   * KHÔNG trừ vào quỹ phép, khác hẳn `leaveDays`. Tách riêng khỏi ngày công
   * và ngày phép vì ba khoản này khác nguồn dữ liệu (lịch nghỉ lễ công ty,
   * không phải đơn nghỉ phép cá nhân) và khác cách trừ quỹ.
   */
  holidayDays: number;
  /** Ngày công + ngày phép + ngày lễ hưởng lương. Cơ sở để chia lương theo ngày. */
  paidDays: number;
  /** Giờ làm thực tế cộng dồn từ check-in/check-out. */
  workHours: number;
  /** Ngày có check-in nhưng thiếu check-out — giờ công của ngày đó tính là 0. */
  missingCheckout: number;

  /**
   * Chuyên cần, đo bằng `lib/workSchedule.ts` từ ca làm việc.
   *
   * Bằng 0 khi chưa khai ca (migration chưa chạy hoặc tháng chưa có ca phủ) —
   * khi đó mọi công thức phạt đi muộn ra 0, tức là không phạt, thay vì phạt
   * dựa trên giờ chuẩn đoán bừa.
   */
  lateMinutes: number;
  lateCount: number;
  lateAfterCutoffCount: number;
  earlyMinutes: number;
  earlyCount: number;
}

/**
 * Chia giờ tăng ca đã duyệt thành ba rổ theo Điều 98 BLLĐ 2019:
 * ngày thường 150%, ngày NGHỈ HẰNG TUẦN 200%, ngày lễ 300%.
 *
 * "Ngày nghỉ" KHÔNG đồng nghĩa với thứ Bảy + Chủ nhật. Công ty này khai
 * `saturday_mode` cho từng ca — thứ Bảy có thể là ngày làm đủ, nửa ngày, hoặc
 * nghỉ hẳn. Gán cứng thứ Bảy vào rổ 200% thì công ty làm thứ Bảy bị trả dư
 * một phần ba cho mọi giờ tăng ca hôm đó, và không có gì báo ra.
 *
 * Nên hỏi đúng câu mà cả hệ thống đang dùng để trả lời "hôm đó có phải ngày
 * làm không": `dayWeight` bằng 0 mới là ngày nghỉ.
 */
export function splitOvertimeHours(
  requests: ReadonlyArray<{ request_type: string; work_date: string; hours?: number | string | null }>,
  schedules: ScheduleSet,
  holidays: ReadonlySet<string>,
): { weekday: number; weekend: number; holiday: number } {
  const out = { weekday: 0, weekend: 0, holiday: 0 };
  for (const request of requests) {
    if (request.request_type !== 'OVERTIME') continue;
    const hours = Number(request.hours || 0);
    if (!Number.isFinite(hours) || hours <= 0) continue;

    if (holidays.has(request.work_date)) {
      out.holiday += hours;
      continue;
    }
    // Chưa khai ca nào thì không suy được ngày nghỉ của công ty; lùi về quy
    // ước thứ Bảy + Chủ nhật thay vì dồn hết vào rổ 150%.
    const restDay = schedules.supported
      ? dayWeight(schedules, request.work_date, holidays) === 0
      : [0, 6].includes(new Date(`${request.work_date}T00:00:00`).getDay());
    if (restDay) out.weekend += hours;
    else out.weekday += hours;
  }
  return {
    weekday: Math.round(out.weekday * 100) / 100,
    weekend: Math.round(out.weekend * 100) / 100,
    holiday: Math.round(out.holiday * 100) / 100,
  };
}

/**
 * Gộp chấm công, nghỉ phép và ngày lễ của MỘT người trong MỘT tháng.
 *
 * Ngày phép đếm theo khoảng ngày chứ không lấy thẳng cột `days`: một đơn nghỉ
 * có thể vắt qua hai tháng, phải tách đúng phần rơi vào tháng đang tính.
 *
 * `holidays`: danh sách ngày lễ (chuỗi ISO "YYYY-MM-DD") lấy từ bảng
 * `company_holidays`. Một ngày chỉ được tính là NGÀY LỄ nếu: rơi vào tháng
 * đang tính, là ngày thường (không phải cuối tuần — cuối tuần vốn đã không
 * phải ngày công), người này KHÔNG có chấm công thực tế ngày đó (đi làm thật
 * thì tính là ngày công, không phải ngày lễ nghỉ), và KHÔNG đã nằm trong một
 * đơn nghỉ phép đã duyệt ngày đó (tránh trả lương hai lần cho cùng một ngày —
 * đơn giản hoá: coi ngày dính nghỉ nửa buổi cũng là "đã có đơn", không tách
 * nửa ngày lễ + nửa ngày phép).
 */
export function summarisePeriod(
  attendance: Attendance[],
  leaves: LeaveRequest[],
  monthStart: Date,
  hoursPerDay: number,
  holidays: readonly string[] = [],
  /**
   * Ca làm việc, để đo đi muộn / về sớm. Không truyền thì các chỉ số chuyên
   * cần bằng 0 — hệ thống KHÔNG đoán giờ vào chuẩn.
   */
  schedules: ScheduleSet = EMPTY_SCHEDULES,
  /** Đơn đi muộn/về sớm đã duyệt, dùng loại đúng ngày khỏi thống kê phạt. */
  punctualityExceptions: PunctualityExceptions = {},
): PeriodStats {
  const withCheckIn = attendance.filter((record) => record.check_in_time);
  const workedDates = new Set(withCheckIn.map((record) => record.date));
  const workDays = workedDates.size;

  let workHours = 0;
  let missingCheckout = 0;

  for (const record of withCheckIn) {
    if (!record.check_out_time) {
      missingCheckout += 1;
      continue;
    }
    const start = new Date(record.check_in_time as string).getTime();
    const end = new Date(record.check_out_time).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    // Chặn trên bằng 24h: dữ liệu chấm công lỗi (quên check-out hôm trước rồi
    // được sửa tay) từng tạo ra những ca dài hàng trăm giờ.
    workHours += Math.min((end - start) / 3_600_000, 24);
  }

  const year = monthStart.getFullYear();
  const month = monthStart.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  let leaveDays = 0;
  const leaveCoveredDates = new Set<string>();
  const holidaySet = new Set(holidays);
  // Không có ngày lễ nào: dùng để hỏi "hôm đó ĐÁNG LẼ là ngày làm mấy công",
  // vì `dayWeight` trả 0 cho mọi ngày lễ — mà ngày lễ vẫn được HƯỞNG lương.
  const noHolidays: ReadonlySet<string> = new Set<string>();

  for (const leave of leaves) {
    for (let day = 1; day <= daysInMonth; day += 1) {
      const iso = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      if (iso < leave.start_date || iso > leave.end_date) continue;
      // Nghỉ phép ăn theo đúng trọng số ngày làm của lịch công ty, KHÔNG phải
      // "cứ thứ Hai–Sáu là 1". Công ty này khai `saturday_mode`, nên mẫu số
      // `standardDays` đếm thứ Bảy 0,5 hoặc 1 — tử số bỏ hẳn thứ Bảy thì
      // người nghỉ phép trọn tháng chỉ được trả 21/23,5 lương.
      //
      // Ngày lễ rơi trong kỳ nghỉ trả về 0 ở đây và được `holidayDays` bên
      // dưới nhặt lại, nên tổng vẫn đúng một lần — và con số "nghỉ phép"
      // trên phiếu khớp với số ngày thật sự bị trừ quỹ phép.
      const weight = dayWeight(schedules, iso, holidaySet);
      if (weight === 0) continue;
      leaveDays += leave.half_day ? weight / 2 : weight;
      leaveCoveredDates.add(iso);
    }
  }

  // Đo đi muộn / về sớm trên toàn bộ bản ghi chấm công (kể cả ngày thiếu
  // check-out): thiếu giờ RA không làm mất dữ kiện giờ VÀO.
  const punctuality = schedules.supported
    ? measurePunctuality(schedules, attendance, holidays, punctualityExceptions)
    : EMPTY_PUNCTUALITY;

  const monthPrefix = `${year}-${String(month + 1).padStart(2, '0')}-`;
  let holidayDays = 0;
  for (const iso of holidaySet) {
    if (!iso.startsWith(monthPrefix)) continue;
    if (workedDates.has(iso) || leaveCoveredDates.has(iso)) continue;
    // Hỏi trọng số của ngày đó khi CHƯA tính nó là ngày lễ: lễ rơi vào thứ
    // Bảy làm nửa ngày thì hưởng 0,5 công, rơi vào Chủ nhật thì 0.
    holidayDays += dayWeight(schedules, iso, noHolidays);
  }
  holidayDays = Math.round(holidayDays * 100) / 100;
  leaveDays = Math.round(leaveDays * 100) / 100;

  return {
    workDays,
    holidayDays,
    leaveDays,
    paidDays: workDays + leaveDays + holidayDays,
    // Không tự bù giờ cho riêng bản ghi thiếu checkout: bản ghi đó phải được
    // hoàn thiện và duyệt lại. Chỉ lùi về giờ chuẩn với dữ liệu kế thừa khi
    // toàn tháng hoàn toàn không có một khoảng giờ hợp lệ nào.
    workHours: workHours > 0 ? Math.round(workHours * 100) / 100 : workDays * hoursPerDay,
    ...punctuality,
    missingCheckout,
  };
}

// ---------------------------------------------------------------------------
// Tính một phiếu lương theo cơ chế
// ---------------------------------------------------------------------------

/** Một dòng của cơ chế đã giải xong cho một người. */
export interface MechanismRow {
  component: PayComponent;
  mode: RowMode;
  /** Công thức (cách lấy "Công thức"). */
  formula: string | null;
  /**
   * Giá trị cấu hình (cách lấy "Giá trị" / "Từng người"). Với công thức khai
   * trước đây, đây là "mức riêng" mà công thức đọc qua `MUC_RIENG`.
   */
  amount: number | null;
  /** Thứ tự hiện trên phiếu. */
  sortOrder: number;
  /** Giá trị / công thức đang áp đến từ đâu: "Cơ chế BL01", "Phòng KD1", "Riêng". */
  origin: string | null;
}

export interface ComputedLine {
  code: string;
  name: string;
  kind: PayComponentKind;
  amount: number;
  /** Cách ra con số, bằng số: "12.000.000 ÷ 23,5 × 22,5". */
  detail: string;
  origin?: string | null;
  /** Dòng lỗi công thức / thiếu số liệu: vẫn nằm trên phiếu, bằng 0. */
  failed?: boolean;
}

/** Một bước trong nhật ký tính — đủ để kế toán tự tính tay lại. */
export interface CalcTraceStep {
  code: string;
  label: string;
  kind: PayComponentKind;
  mode: RowMode | 'ADJUSTMENT';
  /** Công thức dạng mã, nếu dòng tính bằng công thức. */
  expression?: string;
  /** Công thức đã thay số. */
  rendered?: string;
  result: number;
  note?: string;
}

export interface ComputedPayslip {
  stats: PeriodStats;
  standardDays: number;
  lines: ComputedLine[];
  /** Tổng các dòng cộng vào lương. */
  gross: number;
  /** Tổng các dòng trừ khỏi lương. */
  totalDeductions: number;
  /** Chênh lệch do làm tròn thực lĩnh theo bộ tham số. */
  roundingAdjustment: number;
  /**
   * Số của các đầu mục có Nhãn báo cáo, cộng theo nhãn — ghi vào các cột báo
   * cáo của phiếu khi chốt kỳ. Không tham gia tính thực lĩnh.
   */
  reportTotals: ReportTotals;
  /** Thực lĩnh ĐÃ làm tròn. */
  netPay: number;
  /** Số liệu đã dùng — ghi vào `payslips.snapshot` khi tính. */
  snapshot: Record<string, unknown>;
  warnings: string[];
  /** Giá trị của từng đầu mục sau khi tính — màn thiết kế hiện kết quả thử từng dòng. */
  values: Record<string, number>;
  trace?: CalcTraceStep[];
}

/** Một khoản điều chỉnh đã ghi cho kỳ đang tính. */
export interface PayrollAdjustment {
  id: string;
  user_id: string;
  kind: 'RECOVERY' | 'CLAWBACK';
  amount: number;
  reason: string;
  taxable: boolean;
  /** Kỳ phát sinh sai sót, để phiếu nói rõ khoản này bù cho tháng nào. */
  origin_month: string | null;
  /** Đầu mục mà điều chỉnh cộng / trừ vào. Trống: dòng điều chỉnh riêng ở cuối phiếu. */
  component_code?: string | null;
}

export interface ComputePayslipArgs {
  profile: Pick<Profile, 'id' | 'name'>;
  rows: readonly MechanismRow[];
  stats: PeriodStats;
  params: PayrollParams;
  /** Số liệu tháng của người này (payroll_inputs + giờ OT tự lấy): mã → số. */
  inputs?: Readonly<Record<string, number>>;
  /**
   * Mã mọi đầu mục trong danh mục. Công thức đọc tới đầu mục mà cơ chế của
   * người này không có thì đầu mục đó bằng 0 (kèm cảnh báo) thay vì làm hỏng
   * cả dòng.
   */
  catalogCodes?: readonly string[];
  adjustments?: readonly PayrollAdjustment[];
  /** Tên hiển thị của một mã (tham số, dữ liệu) cho cảnh báo và diễn giải. */
  nameOf?: (code: string) => string | undefined;
  trace?: boolean;
}

/** Câu giải thích cho dòng điều chỉnh: bù cho kỳ nào, vì sao. */
function adjustmentDetail(adjustment: PayrollAdjustment): string {
  if (!adjustment.origin_month) return adjustment.reason;
  return `Kỳ ${adjustment.origin_month.slice(5, 7)}/${adjustment.origin_month.slice(0, 4)} — ${adjustment.reason}`;
}

function round(value: number): number {
  return Math.round(value);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Làm tròn thực lĩnh theo đơn vị và chiều của bộ tham số. */
function roundNet(value: number, unit: number, mode: 'NEAREST' | 'DOWN' | 'UP'): number {
  if (unit <= 1) return round(value);
  if (mode === 'DOWN') return Math.floor(value / unit) * unit;
  if (mode === 'UP') return Math.ceil(value / unit) * unit;
  return roundTo(value, -Math.round(Math.log10(unit)));
}

const isMoneyKind = (kind: PayComponentKind) => kind === 'EARNING' || kind === 'DEDUCTION';

/**
 * Dữ liệu tự động của một người trong tháng — biến mà công thức đọc được mà
 * không ai phải khai.
 */
export function systemScope(
  stats: PeriodStats,
  params: Pick<PayrollParams, 'standardDays' | 'hoursPerDay'>,
  inputs: Readonly<Record<string, number>> = {},
  adjustments: { recovery: number; clawback: number } = { recovery: 0, clawback: 0 },
): Record<string, number> {
  const standardDays = params.standardDays > 0 ? params.standardDays : 0;
  const kpi = Number(inputs.KPI_PCT ?? 0) || 0;
  return {
    WORK_DAYS: stats.workDays,
    LEAVE_DAYS: stats.leaveDays,
    HOLIDAY_DAYS: stats.holidayDays,
    PAID_DAYS: stats.paidDays,
    STANDARD_DAYS: standardDays,
    UNPAID_DAYS: Math.max(0, round2(standardDays - stats.paidDays)),
    WORK_HOURS: stats.workHours,
    HOURS_PER_DAY: params.hoursPerDay > 0 ? params.hoursPerDay : 0,
    OT_WEEKDAY_HOURS: Number(inputs.OT_WEEKDAY_HOURS ?? 0) || 0,
    OT_WEEKEND_HOURS: Number(inputs.OT_WEEKEND_HOURS ?? 0) || 0,
    OT_HOLIDAY_HOURS: Number(inputs.OT_HOLIDAY_HOURS ?? 0) || 0,
    KPI_PCT: kpi,
    TY_LE_KPI: kpi / 100,
    LATE_COUNT: stats.lateCount,
    LATE_MINUTES: stats.lateMinutes,
    LATE_AFTER_CUTOFF: stats.lateAfterCutoffCount,
    EARLY_COUNT: stats.earlyCount,
    EARLY_MINUTES: stats.earlyMinutes,
    ADJ_RECOVERY: adjustments.recovery,
    ADJ_CLAWBACK: adjustments.clawback,
    [TOTAL_EARNINGS_CODE]: 0,
  };
}

const rowCode = (row: MechanismRow) => row.component.code.toUpperCase();

/**
 * Thứ tự tính: dòng bị đọc tới đứng trước dòng đọc nó. Giữ thứ tự hiện trên
 * phiếu làm nền để hai dòng không liên quan nhau vẫn tính theo thứ tự quen.
 * Trả về cả tập mã nằm trong vòng lặp.
 */
export function orderMechanismRows(rows: readonly MechanismRow[]): { ordered: MechanismRow[]; cyclic: Set<string> } {
  const base = [...rows].sort((a, b) => a.sortOrder - b.sortOrder || a.component.sort_order - b.component.sort_order);
  const byCode = new Map(base.map((row) => [rowCode(row), row]));
  const dependencies = new Map<MechanismRow, MechanismRow[]>();
  for (const row of base) {
    if (row.mode !== 'FORMULA' || !row.formula?.trim()) { dependencies.set(row, []); continue; }
    const list: MechanismRow[] = [];
    for (const code of referencedCodes(row.formula)) {
      if (code === TOTAL_EARNINGS_CODE) {
        list.push(...base.filter((other) => other.component.kind === 'EARNING'));
        continue;
      }
      const dependency = byCode.get(code);
      if (dependency) list.push(dependency);
    }
    dependencies.set(row, list);
  }

  const ordered: MechanismRow[] = [];
  const done = new Set<MechanismRow>();
  const stack: MechanismRow[] = [];
  const cyclic = new Set<string>();
  const visit = (row: MechanismRow) => {
    if (done.has(row)) return;
    const position = stack.indexOf(row);
    if (position >= 0) {
      for (const member of stack.slice(position)) cyclic.add(rowCode(member));
      return;
    }
    stack.push(row);
    for (const dependency of dependencies.get(row) ?? []) visit(dependency);
    stack.pop();
    done.add(row);
    ordered.push(row);
  };
  for (const row of base) visit(row);
  return { ordered, cyclic };
}

/**
 * Tính trọn một phiếu lương theo các dòng cơ chế của người đó.
 *
 * Một dòng hỏng (công thức lỗi, thiếu số khai riêng) không được làm hỏng cả
 * phiếu: dòng đó ra 0, nằm nguyên trên phiếu và có cảnh báo gọi đúng tên.
 */
export function computePayslip(args: ComputePayslipArgs): ComputedPayslip {
  const { profile, stats, params, catalogCodes = [], adjustments = [] } = args;
  const inputs = args.inputs ?? {};
  const warnings: string[] = [];
  const trace: CalcTraceStep[] | null = args.trace ? [] : null;

  const rows = args.rows;
  const rowByCode = new Map(rows.map((row) => [rowCode(row), row]));
  const nameOf = (code: string) => rowByCode.get(code)?.component.name ?? args.nameOf?.(code) ?? code;

  // Điều chỉnh gắn vào đầu mục "chỉ để tính" (số người phụ thuộc, lương cơ bản…)
  // là điều chỉnh GIÁ TRỊ, không phải tiền: cộng / trừ thẳng vào giá trị của
  // đầu mục TRƯỚC khi các công thức đọc nó, nên thuế, bảo hiểm… tính theo số mới.
  const infoTarget = (adjustment: PayrollAdjustment): string | null => {
    const code = adjustment.component_code?.trim().toUpperCase();
    return code && rowByCode.get(code)?.component.kind === 'INFO' ? code : null;
  };
  const infoShift = new Map<string, { delta: number; notes: string[] }>();
  for (const adjustment of adjustments) {
    const code = infoTarget(adjustment);
    const size = Number(adjustment.amount);
    if (!code || !(size > 0)) continue;
    const signed = adjustment.kind === 'RECOVERY' ? size : -size;
    const entry = infoShift.get(code) ?? { delta: 0, notes: [] };
    entry.delta += signed;
    entry.notes.push(`${signed > 0 ? '+' : '−'}${new Intl.NumberFormat('vi-VN').format(size)} điều chỉnh: ${adjustmentDetail(adjustment)}`);
    infoShift.set(code, entry);
  }

  const moneyAdjustments = adjustments.filter((item) => !infoTarget(item));
  const recovery = moneyAdjustments.filter((item) => item.kind === 'RECOVERY')
    .reduce((sum, item) => sum + Math.max(0, round(Number(item.amount))), 0);
  const clawback = moneyAdjustments.filter((item) => item.kind === 'CLAWBACK')
    .reduce((sum, item) => sum + Math.max(0, round(Number(item.amount))), 0);

  const system = systemScope(stats, params, inputs, { recovery, clawback });
  const systemCodes = new Set(Object.keys(system));

  // Phạm vi biến, lớp sau thắng lớp trước: đầu mục chưa tính (= 0) → số liệu
  // tháng → tham số → dữ liệu tự động. Kết quả từng dòng ghi đè dần khi tính.
  const scope: Record<string, number> = {};
  for (const code of catalogCodes) scope[code.toUpperCase()] = 0;
  for (const [code, value] of Object.entries(inputs)) {
    const number = Number(value);
    if (Number.isFinite(number)) scope[code.toUpperCase()] = number;
  }
  Object.assign(scope, params.values, system);

  if (!params.standardDays) {
    warnings.push('Tháng này chưa có công chuẩn (chưa khai ca làm việc và bộ tham số chưa có công chuẩn) — công thức chia cho công chuẩn sẽ lỗi.');
  }
  if (rows.length === 0) {
    warnings.push(`${profile.name}: chưa có cơ chế lương — phiếu đang là 0đ.`);
  }

  const { ordered, cyclic } = orderMechanismRows(rows);
  if (cyclic.size > 0) {
    warnings.push(
      `${profile.name}: các dòng ${[...cyclic].map((code) => `“${nameOf(code)}”`).join(', ')} dùng lẫn nhau thành vòng lặp `
      + '— tính bằng 0. Bỏ bớt một tham chiếu trong cơ chế.',
    );
  }

  const values: Record<string, number> = {};
  const lineByCode = new Map<string, ComputedLine>();
  const knownCatalog = new Set(catalogCodes.map((code) => code.toUpperCase()));

  for (const row of ordered) {
    const code = rowCode(row);
    const name = row.component.name;
    if (systemCodes.has(code)) {
      warnings.push(`Đầu mục “${name}” trùng mã với dữ liệu tự động ${code} — bỏ qua dòng này.`);
      continue;
    }
    let value = 0;
    let failed = false;
    let detail = '';
    let expression: string | undefined;
    let rendered: string | undefined;

    if (cyclic.has(code)) {
      failed = true;
      detail = 'Vòng lặp công thức';
    } else if (row.mode === 'FORMULA') {
      const formula = row.formula?.trim() ?? '';
      if (!formula) {
        failed = true;
        detail = 'Chưa có công thức';
        warnings.push(`${profile.name}: dòng “${name}” chưa có công thức.`);
      } else {
        const refs = referencedCodes(formula);
        if (refs.includes(TOTAL_EARNINGS_CODE)) {
          scope[TOTAL_EARNINGS_CODE] = rows
            .filter((other) => other.component.kind === 'EARNING' && values[rowCode(other)] !== undefined)
            .reduce((sum, other) => sum + values[rowCode(other)], 0) + recovery;
        }
        // Chỉ nhắc ở dòng ra tiền: dòng "chỉ để tính" (kiểu thu nhập chịu thuế)
        // cố ý cộng cả những khoản người này có thể không có — bằng 0 là đúng.
        const missing = isMoneyKind(row.component.kind)
          ? refs.filter((ref) => knownCatalog.has(ref) && !rowByCode.has(ref) && inputs[ref] === undefined)
          : [];
        if (missing.length > 0) {
          warnings.push(
            `${profile.name}: dòng “${name}” lấy số từ ${missing.map((ref) => `“${nameOf(ref)}”`).join(', ')} `
            + 'nhưng cơ chế không có dòng đó — phần đó tính bằng 0.',
          );
        }
        const formulaScope = { ...scope, [OWN_AMOUNT_CODE]: row.amount ?? Number(row.component.default_amount ?? 0) };
        try {
          value = evaluateFormula(formula, formulaScope, { functions: params.functions }).value;
          expression = formula;
          rendered = renderFormulaWithValues(formula, formulaScope, nameOf);
          detail = rendered;
        } catch (error) {
          failed = true;
          detail = 'Công thức lỗi';
          const reason = error instanceof FormulaError ? error.message : String(error);
          warnings.push(`${profile.name}: công thức dòng “${name}” lỗi — ${reason}`);
        }
      }
    } else if (row.mode === 'PER_PERSON') {
      if (row.amount == null) {
        failed = true;
        detail = 'Chưa khai';
        warnings.push(`${profile.name}: chưa khai “${name}”.`);
      } else {
        value = row.amount;
        detail = row.origin ? `Khai riêng · ${row.origin}` : 'Khai riêng';
      }
    } else if (row.mode === 'MONTHLY_INPUT') {
      const entered = inputs[code];
      value = entered ?? 0;
      detail = entered === undefined ? 'Chưa nhập số liệu tháng' : 'Số liệu tháng';
    } else {
      value = row.amount ?? Number(row.component.default_amount ?? 0);
      detail = row.origin ? `Giá trị · ${row.origin}` : 'Giá trị';
    }

    const shift = row.component.kind === 'INFO' ? infoShift.get(code) : undefined;
    if (shift) {
      value += shift.delta;
      detail = [detail, ...shift.notes].filter(Boolean).join(' · ');
    }

    if (!Number.isFinite(value)) {
      value = 0;
      failed = true;
    }
    const money = isMoneyKind(row.component.kind);
    const stored = money ? round(value) : value;
    scope[code] = stored;
    values[code] = stored;
    lineByCode.set(code, {
      code,
      name,
      kind: row.component.kind,
      amount: money ? stored : round2(stored),
      detail,
      origin: row.origin,
      ...(failed ? { failed } : {}),
    });
    trace?.push({
      code, label: name, kind: row.component.kind, mode: row.mode,
      expression, rendered, result: money ? stored : round2(stored),
      note: failed ? detail : undefined,
    });
  }

  const lines: ComputedLine[] = [...rows]
    .sort((a, b) => a.sortOrder - b.sortOrder || a.component.sort_order - b.component.sort_order)
    .map((row) => lineByCode.get(rowCode(row)))
    .filter((line): line is ComputedLine => !!line);

  // Nhãn báo cáo: cộng số các dòng theo nhãn người dùng gắn ở Danh mục. Chỉ để
  // báo cáo — không dòng nào đọc kết quả này nên không ảnh hưởng thực lĩnh.
  const componentByCode = new Map(rows.map((row) => [rowCode(row), row.component]));
  const reportTotals = sumReportTags(lines.map((line) => ({
    tag: componentByCode.get(line.code)?.report_tag, kind: line.kind, amount: line.amount,
  })));

  // Điều chỉnh tăng / giảm (truy lĩnh, truy thu). Gắn vào đầu mục nào thì sửa
  // thẳng số của đầu mục đó trên phiếu; không gắn thì là dòng riêng ở cuối phiếu.
  // `kind` luôn là chiều tác động lên THỰC NHẬN, nên với đầu mục là khoản trừ
  // thì "tăng thực nhận" nghĩa là giảm khoản trừ.
  for (const adjustment of adjustments) {
    const amount = round(Number(adjustment.amount));
    if (!(amount > 0)) continue;
    if (infoTarget(adjustment)) continue; // đã cộng vào giá trị đầu mục ở trên
    const recoveryLine = adjustment.kind === 'RECOVERY';
    const targetCode = adjustment.component_code?.trim().toUpperCase();
    const target = targetCode
      ? lines.find((line) => line.code.toUpperCase() === targetCode
        && (line.kind === 'EARNING' || line.kind === 'DEDUCTION') && !line.code.startsWith('ADJ_'))
      : undefined;
    if (target) {
      const sign = recoveryLine === (target.kind === 'EARNING') ? 1 : -1;
      target.amount = round(target.amount + sign * amount);
      const note = `${sign > 0 ? '+' : '−'}${new Intl.NumberFormat('vi-VN').format(amount)} điều chỉnh: ${adjustmentDetail(adjustment)}`;
      target.detail = target.detail ? `${target.detail} · ${note}` : note;
      if (target.amount < 0) {
        warnings.push(`${profile.name}: điều chỉnh làm “${target.name}” âm — kiểm tra lại số tiền điều chỉnh.`);
      }
      trace?.push({
        code: target.code, label: target.name, kind: target.kind, mode: 'ADJUSTMENT',
        result: sign * amount, note: adjustment.reason,
      });
      continue;
    }
    const targetName = targetCode ? nameOf(targetCode) : null;
    const line: ComputedLine = {
      code: recoveryLine ? 'ADJ_RECOVERY' : 'ADJ_CLAWBACK',
      name: targetName
        ? `${targetName} — ${recoveryLine ? 'điều chỉnh tăng' : 'điều chỉnh giảm'}`
        : recoveryLine
          ? (adjustment.origin_month ? 'Truy lĩnh kỳ trước' : 'Điều chỉnh tăng')
          : (adjustment.origin_month ? 'Truy thu kỳ trước' : 'Điều chỉnh giảm'),
      kind: recoveryLine ? 'EARNING' : 'DEDUCTION',
      amount,
      detail: adjustmentDetail(adjustment),
    };
    lines.push(line);
    trace?.push({
      code: line.code, label: line.name, kind: line.kind, mode: 'ADJUSTMENT', result: amount, note: adjustment.reason,
    });
  }

  const gross = lines.filter((line) => line.kind === 'EARNING').reduce((sum, line) => sum + line.amount, 0);
  const totalDeductions = lines.filter((line) => line.kind === 'DEDUCTION').reduce((sum, line) => sum + line.amount, 0);
  values[TOTAL_EARNINGS_CODE] = gross;

  const rawNet = gross - totalDeductions;
  const netPay = roundNet(rawNet, params.netRoundingUnit ?? 1, params.netRoundingMode ?? 'NEAREST');
  const roundingAdjustment = round(netPay - round(rawNet));

  if (netPay < 0) {
    warnings.push(
      `${profile.name}: thực nhận đang ÂM ${new Intl.NumberFormat('vi-VN').format(Math.abs(netPay))}đ — `
      + 'tổng các khoản trừ vượt tổng các khoản cộng.',
    );
  }

  return {
    stats,
    standardDays: params.standardDays,
    lines,
    gross: round(gross),
    totalDeductions: round(totalDeductions),
    roundingAdjustment,
    reportTotals,
    netPay,
    snapshot: {
      param_version_effective_from: params.versionEffectiveFrom ?? null,
      standard_days: params.standardDays,
      hours_per_day: params.hoursPerDay,
      net_rounding_unit: params.netRoundingUnit ?? 1,
      rounding_adjustment: roundingAdjustment,
      inputs,
      values,
      computed_at: new Date().toISOString(),
    },
    warnings,
    values,
    ...(trace ? { trace } : {}),
  };
}

// ---------------------------------------------------------------------------
// Chọn bản ghi có hiệu lực
// ---------------------------------------------------------------------------

/**
 * Hồ sơ lương áp dụng cho kỳ: bản ghi mới nhất có `effective_from` không vượt
 * quá ngày cuối kỳ. Hồ sơ giờ chỉ còn giữ cơ chế gán riêng cho người.
 */
export function payProfileForPeriod(
  profiles: EmployeePayProfile[],
  periodEnd: string,
): EmployeePayProfile | null {
  const eligible = profiles
    .filter((item) => item.effective_from <= periodEnd)
    .sort((a, b) => b.effective_from.localeCompare(a.effective_from));
  return eligible[0] ?? null;
}

/** Bản ghi còn hiệu lực trong kỳ (đã bắt đầu, chưa kết thúc). */
export function activeInPeriod<T extends { effective_from: string; effective_to: string | null }>(
  rows: readonly T[],
  periodStart: string,
  periodEnd: string,
): T[] {
  return rows.filter((row) => row.effective_from <= periodEnd && (!row.effective_to || row.effective_to >= periodStart));
}
