// ============================================================================
// Bộ máy tính lương.
// ----------------------------------------------------------------------------
// Thay cho công thức cứng viết thẳng trong AdminPayroll.tsx trước đây, nơi mọi
// nhân sự đều bị ép qua đúng một cách tính:
//
//   lương_cơ_bản / 26 * (ngày_công + ngày_phép) + phụ_cấp - 8% - 5%
//
// Cách tính đó sai với phần lớn người trong một công ty thật: nhân viên part
// time ăn lương giờ, thợ ăn khoán sản phẩm, sales ăn hoa hồng, và thuế TNCN
// không phải 5% phẳng mà là biểu lũy tiến bảy bậc.
//
// Ở đây lương gốc được tính theo cơ chế của từng người (`pay_basis`), rồi các
// khoản cộng/trừ chạy lần lượt theo `sort_order`. Mỗi khoản tính xong sẽ trở
// thành BIẾN cho khoản sau, nên HR ghép được những cách tính khá phức tạp mà
// không cần ai sửa code.
//
// Đọc kèm:
//   - `payrollFormula.ts`  bộ đánh giá biểu thức (không dùng eval)
//   - migration 20260921090000_payroll_engine.sql
// ============================================================================

import type { PayrollParams } from './payrollSettings';
import { evaluateFormula, FormulaError } from './payrollFormula';
import {
  dayWeight, EMPTY_PUNCTUALITY, EMPTY_SCHEDULES, measurePunctuality,
  type PunctualityExceptions, type ScheduleSet,
} from './workSchedule';
import type {
  Attendance,
  EmployeePayItem,
  EmployeePayProfile,
  LeaveRequest,
  PayBasis,
  PayComponent,
  PayComponentKind,
  Profile,
} from '@/types';

// ---------------------------------------------------------------------------
// Thuế thu nhập cá nhân
// ---------------------------------------------------------------------------

/**
 * Biểu thuế lũy tiến từng phần, Phụ lục 01 Thông tư 111/2013/TT-BTC.
 * `upTo` tính trên THU NHẬP TÍNH THUẾ tháng (đã trừ bảo hiểm và giảm trừ).
 */
export const PIT_BRACKETS: ReadonlyArray<{ upTo: number; rate: number }> = [
  { upTo: 5_000_000, rate: 0.05 },
  { upTo: 10_000_000, rate: 0.1 },
  { upTo: 18_000_000, rate: 0.15 },
  { upTo: 32_000_000, rate: 0.2 },
  { upTo: 52_000_000, rate: 0.25 },
  { upTo: 80_000_000, rate: 0.3 },
  { upTo: Number.POSITIVE_INFINITY, rate: 0.35 },
];

/**
 * Ngưỡng ngày không hưởng lương khiến tháng đó không phải đóng bảo hiểm.
 *
 * Điều 85 khoản 3 Luật Bảo hiểm xã hội 2014: người lao động không làm việc và
 * không hưởng tiền lương từ 14 ngày làm việc trở lên trong tháng thì không
 * đóng BHXH tháng đó. BHYT và BHTN đi theo cùng nguyên tắc.
 *
 * CỐ Ý không đưa ra thành tham số cấu hình: đây là con số của luật, không phải
 * chính sách của công ty. Mở cho sửa chỉ tạo thêm một chỗ khai sai.
 */
export const UNPAID_DAYS_WAIVING_INSURANCE = 14;

export interface TaxBreakdownStep {
  /** Phần thu nhập rơi vào bậc này. */
  amount: number;
  rate: number;
  tax: number;
}

/**
 * Thuế lũy tiến từng phần. "Từng phần" nghĩa là mỗi bậc chỉ đánh trên PHẦN thu
 * nhập nằm trong bậc đó, không phải áp một thuế suất cho toàn bộ thu nhập —
 * nhầm chỗ này là tính dư thuế cho nhân viên rất nhiều.
 */
export function progressiveIncomeTax(
  taxableIncome: number,
  /**
   * Biểu thuế. Mặc định là biểu trong code để mọi chỗ gọi cũ chạy nguyên vẹn;
   * bảng lương truyền vào biểu khai trong `pit_brackets` để kế toán tự sửa
   * được khi luật đổi, không phải chờ deploy.
   */
  brackets: ReadonlyArray<{ upTo: number; rate: number }> = PIT_BRACKETS,
): {
  tax: number;
  steps: TaxBreakdownStep[];
} {
  if (taxableIncome <= 0) return { tax: 0, steps: [] };

  const steps: TaxBreakdownStep[] = [];
  let tax = 0;
  let lowerBound = 0;

  for (const bracket of brackets) {
    if (taxableIncome <= lowerBound) break;
    const portion = Math.min(taxableIncome, bracket.upTo) - lowerBound;
    if (portion > 0) {
      const stepTax = portion * bracket.rate;
      steps.push({ amount: portion, rate: bracket.rate, tax: stepTax });
      tax += stepTax;
    }
    lowerBound = bracket.upTo;
  }

  return { tax: Math.round(tax), steps };
}

/**
 * Đổi biểu khai trong database sang dạng engine dùng.
 *
 * Hai khác biệt phải quy đổi: cận trên `null` của bậc cuối thành vô cực, và
 * thuế suất phần trăm (5) thành hệ số (0,05). Biểu rỗng thì giữ nguyên biểu
 * trong code — không bao giờ tính thuế bằng một biểu không có bậc nào.
 */
export function toTaxBrackets(
  brackets: ReadonlyArray<{ upperBound: number | null; rate: number }> | undefined,
): ReadonlyArray<{ upTo: number; rate: number }> {
  if (!brackets || brackets.length === 0) return PIT_BRACKETS;
  return brackets.map((bracket) => ({
    upTo: bracket.upperBound ?? Number.POSITIVE_INFINITY,
    rate: bracket.rate / 100,
  }));
}

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
// Tính một phiếu lương
// ---------------------------------------------------------------------------

export interface ComputedLine {
  code: string;
  name: string;
  kind: PayComponentKind;
  quantity: number | null;
  rate: number | null;
  amount: number;
  taxable: boolean;
  insurable: boolean;
  /**
   * Hệ số làm thêm giờ, nếu khoản này là tăng ca. Dùng tách phần miễn thuế
   * (T04). NULL với mọi khoản thường.
   */
  otMultiplier?: number | null;
  /**
   * Ngưỡng miễn thuế của khoản. Phần tiền vượt ngưỡng vẫn chịu thuế dù khoản
   * được đánh `taxable = false` — tiền ăn ca là ví dụ điển hình.
   */
  taxExemptCap?: number | null;
  /** Câu giải thích để phiếu lương tự nói được vì sao ra con số này. */
  detail: string;
}

export interface ComputedPayslip {
  payBasis: PayBasis;
  stats: PeriodStats;
  standardDays: number;
  hourlyRate: number;
  insuranceBase: number;
  lines: ComputedLine[];
  /** Tổng thu nhập trước khấu trừ. */
  gross: number;
  taxableIncome: number;
  insuranceEmployee: number;
  insuranceEmployer: number;
  personalIncomeTax: number;
  taxSteps: TaxBreakdownStep[];
  /** Khấu trừ ngoài bảo hiểm và thuế (tạm ứng, đoàn phí...). */
  otherDeductions: number;
  netPay: number;
  /** Tham số đã dùng — ghi vào `payslips.snapshot` khi chốt kỳ. */
  snapshot: Record<string, unknown>;
  /** Vấn đề cần người xử lý: thiếu cơ chế lương, công thức hỏng... */
  warnings: string[];
}

/** Mã khoản mà engine tự sinh, không đến từ `payroll_components`. */
export const SYSTEM_CODES = {
  // 'BASE' vẫn là tên BIẾN tổng hợp trong công thức (scope.BASE = tổng cả 3
  // dòng dưới) để không phá công thức cũ nào đang tham chiếu BASE — không
  // còn là mã của một DÒNG cụ thể trên phiếu (basis MONTHLY/DAILY/COMMISSION
  // giờ tách thành 3 dòng riêng; basis HOURLY/PIECE vẫn dùng đúng mã này).
  base: 'BASE',
  /** L01 sheet "Đặc tả Lương – KPI" — Lương thời gian (theo ngày công thực tế). */
  baseWork: 'BASE_WORK',
  /** L02 — Lương phép (ngày nghỉ phép có lương). */
  baseLeave: 'BASE_LEAVE',
  /** L03 — Lương nghỉ lễ (ngày lễ công ty, không trừ quỹ phép). */
  baseHoliday: 'BASE_HOLIDAY',
  socialInsurance: 'INS_SOCIAL',
  healthInsurance: 'INS_HEALTH',
  unemploymentInsurance: 'INS_UNEMPLOY',
  personalIncomeTax: 'PIT',
  /** LU-14 — truy lĩnh kỳ trước, chi trả ở kỳ này. */
  adjustmentRecovery: 'ADJ_RECOVERY',
  /** LU-14 — truy thu tiền đã trả thừa ở kỳ trước. */
  adjustmentClawback: 'ADJ_CLAWBACK',
} as const;

/** Câu giải thích cho dòng điều chỉnh: bù cho kỳ nào, vì sao. */
function adjustmentDetail(adjustment: PayrollAdjustment): string {
  const origin = adjustment.origin_month
    ? `Kỳ ${adjustment.origin_month.slice(5, 7)}/${adjustment.origin_month.slice(0, 4)}`
    : 'Không ghi kỳ gốc';
  return `${origin} — ${adjustment.reason}`;
}

const PAY_BASIS_LABEL: Record<PayBasis, string> = {
  MONTHLY: 'Lương tháng',
  HOURLY: 'Lương giờ',
  DAILY: 'Lương ngày',
  PIECE: 'Khoán sản phẩm',
  COMMISSION: 'Lương cứng + hoa hồng',
};

export function payBasisLabel(basis: PayBasis): string {
  return PAY_BASIS_LABEL[basis] ?? basis;
}

/**
 * Phần của một khoản đã gán mà engine thực sự đọc.
 *
 * Cố ý KHÔNG dùng thẳng `EmployeePayItem`: cùng một khoản có thể đến từ đơn vị
 * (`unit_pay_items`, khoá là `unit_id`) hoặc từ cá nhân (`employee_pay_items`,
 * khoá là `user_id`). Engine không quan tâm khoản đến từ đâu — nó chỉ cần
 * biết tính bằng giá trị nào và còn hiệu lực trong kỳ không.
 */
export interface PayItemAssignment {
  component_id: string;
  /** Ghi đè giá trị mặc định của khoản. NULL = dùng default_amount. */
  amount: number | null;
  /** Công thức riêng. NULL = dùng công thức chung của khoản. */
  formula: string | null;
  /**
   * Ba cờ khai riêng cho người này. NULL = chưa khai, lấy theo danh mục.
   *
   * Danh mục khoản lương chỉ còn là danh sách tên, nên thứ quyết định một
   * khoản có chịu thuế / tính bảo hiểm / là lương gốc hay không nằm ở đây.
   * Tuỳ chọn để engine chạy được cả với dữ liệu khai trước khi có ba cột này.
   */
  taxable?: boolean | null;
  insurable?: boolean | null;
  is_base?: boolean | null;
  effective_from: string;
  effective_to: string | null;
}

export interface AssignedPayItem {
  item: PayItemAssignment;
  component: PayComponent;
}

/**
 * Mã khoản mà một công thức đọc tới.
 *
 * Quét thô bằng regex chữ hoa: biến trong công thức luôn là MÃ VIẾT HOA, và
 * chỉ những mã trùng với khoản đang gán mới được coi là phụ thuộc — tên hàm
 * hay biến hệ thống như `NGAY_CONG` không nằm trong tập đó nên tự bị loại.
 */
function codesReferencedBy(formula: string): string[] {
  return [...new Set(formula.toUpperCase().match(/[A-Z][A-Z0-9_]*/g) ?? [])];
}

/**
 * Sắp các khoản sao cho khoản bị tham chiếu được tính trước.
 *
 * Giữ `sort_order` làm thứ tự nền: hai khoản không liên quan nhau thì vẫn ra
 * đúng thứ tự người dùng đã xếp trong danh mục, bảng lương không tự nhiên đảo
 * dòng sau khi nâng cấp.
 *
 * Vòng tròn phụ thuộc (A đọc B, B đọc A) thì KHÔNG thể sắp được — trả về theo
 * thứ tự cũ và cảnh báo, chứ không im lặng chọn bừa một bên để tính trước.
 */
function orderByDependency<T extends { component: PayComponent; formula?: string | null }>(
  items: T[],
  warnings: string[],
): T[] {
  const base = [...items].sort((a, b) => a.component.sort_order - b.component.sort_order);
  const byCode = new Map<string, T>();
  for (const item of base) {
    const code = item.component.code?.toUpperCase();
    if (code) byCode.set(code, item);
  }

  const out: T[] = [];
  const done = new Set<T>();
  const inProgress = new Set<T>();

  const visit = (item: T) => {
    if (done.has(item)) return;
    if (inProgress.has(item)) {
      warnings.push(
        `Khoản “${item.component.name}” nằm trong một vòng công thức tham chiếu lẫn nhau. `
        + 'Kết quả tính theo thứ tự trong danh mục — hãy bỏ bớt một tham chiếu.',
      );
      return;
    }
    inProgress.add(item);
    const formula = (item.formula?.trim() || item.component.formula?.trim() || '');
    if (formula) {
      for (const code of codesReferencedBy(formula)) {
        const dependency = byCode.get(code);
        // Chỉ đi theo mã của khoản KHÁC đang gán. Tự tham chiếu chính mình thì
        // bỏ qua, nếu không mọi khoản đều báo vòng tròn.
        if (dependency && dependency !== item) visit(dependency);
      }
    }
    inProgress.delete(item);
    done.add(item);
    out.push(item);
  };

  for (const item of base) visit(item);
  return out;
}

export interface ComputePayslipArgs {
  profile: Profile;
  payProfile: EmployeePayProfile | null;
  /** Khoản đã gán cho người này VÀ còn hiệu lực trong tháng đang tính. */
  items: AssignedPayItem[];
  /** Số liệu biến động tháng: mã → số lượng. */
  inputs: Readonly<Record<string, number>>;
  /**
   * Mã của MỌI khoản trong danh mục, kể cả khoản người này không được gán.
   *
   * Một công thức dùng chung cho cả công ty thường phải cộng các khoản mà chỉ
   * một số người có — phí công đoàn của Huy Phong tính trên lương thời gian
   * cộng lương vận chuyển, trong khi nhân viên văn phòng không có lương vận
   * chuyển. Không có danh sách này thì công thức đó ném lỗi "không có biến" ở
   * đúng những người đáng lẽ ra 0đ.
   *
   * Bỏ trống cũng chạy — chỉ các khoản đã gán mới thành biến.
   */
  catalogCodes?: readonly string[];
  stats: PeriodStats;
  settings: PayrollParams;
  /**
   * Truy lĩnh / truy thu kỳ trước dồn sang kỳ này (LU-14). Rỗng là bình
   * thường — phần lớn kỳ lương không có điều chỉnh nào.
   */
  adjustments?: readonly PayrollAdjustment[];
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
}

/**
 * Phần tiền làm thêm giờ được MIỄN thuế TNCN (T04).
 *
 * Chỉ áp cho khoản có khai `ot_multiplier`. Khoản thường trả 0, nên mặc định
 * mọi thứ vẫn chịu thuế toàn bộ như trước — chỉ những khoản HR chủ động đánh
 * dấu là tăng ca mới được miễn phần vượt.
 */
/**
 * Phần tiền của một dòng phải đưa vào thu nhập chịu thuế.
 *
 * Khoản đánh `taxable = false` mà CÓ ngưỡng miễn thì chỉ được miễn tới ngưỡng,
 * phần trả vượt vẫn chịu thuế. Trước đây cờ `taxable` quyết định tất-cả-hoặc-
 * không: công ty nâng tiền ăn ca từ 730.000đ lên 1.000.000đ thì cả 1 triệu
 * thoát thuế, trong khi quy định chỉ miễn tới ngưỡng.
 */
function taxablePortion(line: ComputedLine): number {
  if (line.taxable) return line.amount;
  const cap = line.taxExemptCap;
  if (cap == null) return 0;
  return Math.max(0, round(line.amount - cap));
}

function otTaxExempt(line: ComputedLine): number {
  const multiplier = line.otMultiplier ?? 0;
  if (multiplier <= 1 || line.amount <= 0) return 0;
  return round((line.amount * (multiplier - 1)) / multiplier);
}

function round(value: number): number {
  return Math.round(value);
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 }).format(value);
}

/**
 * Lương gốc theo cơ chế. Đây là chỗ bốn kiểu trả lương tách nhau ra.
 */
function computeBasePay(
  basis: PayBasis,
  baseAmount: number,
  stats: PeriodStats,
  standardDays: number,
): { amount: number; quantity: number; rate: number; detail: string } {
  switch (basis) {
    case 'HOURLY':
      return {
        amount: baseAmount * stats.workHours,
        quantity: stats.workHours,
        rate: baseAmount,
        detail: `${formatNumber(baseAmount)}đ/giờ × ${formatNumber(stats.workHours)} giờ làm thực tế`,
      };

    case 'DAILY':
      return {
        amount: baseAmount * stats.paidDays,
        quantity: stats.paidDays,
        rate: baseAmount,
        detail: `${formatNumber(baseAmount)}đ/ngày × ${formatNumber(stats.paidDays)} ngày công`,
      };

    case 'PIECE':
      // Người ăn khoán không có lương cứng: toàn bộ thu nhập đến từ khoản
      // PIECE_RATE nhân với sản lượng nghiệm thu.
      return {
        amount: 0,
        quantity: 0,
        rate: 0,
        detail: 'Không có lương cứng — thu nhập tính theo sản lượng khoán',
      };

    case 'MONTHLY':
    case 'COMMISSION':
    default: {
      const amount = (baseAmount / standardDays) * stats.paidDays;
      const label = basis === 'COMMISSION' ? 'Lương cứng' : 'Lương tháng';
      return {
        amount,
        quantity: stats.paidDays,
        rate: baseAmount / standardDays,
        detail:
          `${label} ${formatNumber(baseAmount)}đ ÷ ${formatNumber(standardDays)} ngày công chuẩn ` +
          `× ${formatNumber(stats.paidDays)} ngày hưởng lương`,
      };
    }
  }
}

/** Đơn giá giờ, dùng cho mọi công thức tăng ca và phụ cấp ca đêm. */
function computeHourlyRate(
  basis: PayBasis,
  baseAmount: number,
  standardDays: number,
  hoursPerDay: number,
): number {
  switch (basis) {
    case 'HOURLY':
      return baseAmount;
    case 'DAILY':
      return baseAmount / Math.max(hoursPerDay, 1);
    case 'PIECE':
      // Không có đơn giá giờ để quy đổi; tăng ca của thợ khoán phải trả bằng
      // khoản riêng chứ không nhân từ lương cứng.
      return 0;
    default:
      return baseAmount / Math.max(standardDays, 1) / Math.max(hoursPerDay, 1);
  }
}

/**
 * Tính một dòng khoản lương. Trả về `null` kèm cảnh báo nếu công thức hỏng —
 * một khoản sai không được làm hỏng cả phiếu lương.
 */
function computeComponentLine(
  assigned: AssignedPayItem,
  scope: Record<string, number>,
  stats: PeriodStats,
  standardDays: number,
  inputs: Readonly<Record<string, number>>,
  warnings: string[],
  employeeName: string,
): ComputedLine | null {
  const { component, item } = assigned;
  // Giá trị riêng của người này thắng giá trị mặc định của công ty.
  const amount = item.amount ?? component.default_amount;
  const overrideFormula = item.formula?.trim() || '';
  const formula = overrideFormula || component.formula?.trim() || '';

  let value = 0;
  let quantity: number | null = null;
  let rate: number | null = null;
  let detail = '';

  // Công thức khai lúc GÁN khoản luôn thắng cách tính mặc định trong danh mục.
  // Trước đây UI cho phòng ban/nhân viên nhập công thức riêng cho cả khoản
  // FIXED, PER_DAY..., nhưng engine chỉ đọc nó nếu bản thân khoản có
  // `calc_type = FORMULA`. Dữ liệu được lưu thành công rồi âm thầm không có
  // tác dụng. Quy tắc ưu tiên này vừa sửa lỗi đó, vừa cho HR biến một khoản
  // thông thường thành khoản linh hoạt theo Công/KPI mà không phải biến màn
  // Danh mục thành nơi cấu hình kỹ thuật.
  switch (overrideFormula ? 'OVERRIDE' : component.calc_type) {
    case 'OVERRIDE': {
      try {
        const result = evaluateFormula(overrideFormula, { ...scope, MUC_RIENG: amount });
        value = result.value;
        detail = overrideFormula;
      } catch (error) {
        const reason = error instanceof FormulaError ? error.message : String(error);
        warnings.push(`${employeeName}: công thức khoản "${component.name}" lỗi — ${reason}`);
        return null;
      }
      break;
    }

    case 'FIXED': {
      value = amount;
      rate = amount;
      detail = component.prorate
        ? `${formatNumber(amount)}đ/tháng, chia theo ${formatNumber(stats.paidDays)}/${formatNumber(standardDays)} ngày công`
        : `${formatNumber(amount)}đ trọn tháng`;
      break;
    }

    case 'PER_DAY': {
      quantity = stats.paidDays;
      rate = amount;
      value = amount * stats.paidDays;
      detail = `${formatNumber(amount)}đ/ngày × ${formatNumber(stats.paidDays)} ngày`;
      break;
    }

    case 'PER_HOUR':
    case 'PER_UNIT': {
      const code = component.input_code ?? '';
      quantity = inputs[code] ?? 0;
      rate = amount;
      value = amount * quantity;
      const unit = component.calc_type === 'PER_HOUR' ? 'giờ' : 'đơn vị';
      detail = `${formatNumber(amount)}đ × ${formatNumber(quantity)} ${unit} (${code})`;
      break;
    }

    case 'PERCENT': {
      const baseCode = (component.base_code ?? '').toUpperCase();
      const baseValue = scope[baseCode];
      if (baseValue === undefined) {
        warnings.push(
          `${employeeName}: khoản "${component.name}" tính % trên "${baseCode}" nhưng chưa có giá trị đó ` +
            `tại thời điểm tính. Đặt sort_order lớn hơn khoản gốc.`,
        );
        return null;
      }
      rate = amount;
      quantity = baseValue;
      value = (baseValue * amount) / 100;
      detail = `${formatNumber(amount)}% × ${formatNumber(baseValue)}đ (${baseCode})`;
      break;
    }

    case 'FORMULA': {
      try {
        // `MUC_RIENG` = mức tiền gán cho chính khoản này ở Cơ chế lương (hoặc
        // mức mặc định trong danh mục nếu không gán riêng).
        //
        // Có biến này thì một khoản FORMULA mới lấy được con số của TỪNG
        // NGƯỜI. Trước đó công thức chỉ đọc được biến toàn cục, nên mọi khoản
        // kiểu "mức riêng × hệ số" đều phải nhét con số tiền vào module khác —
        // ví dụ mức lương KPI phải nằm trong mẫu KPI, khiến module KPI giữ
        // một con số tiền lương vốn không thuộc về nó.
        const result = evaluateFormula(formula, { ...scope, MUC_RIENG: amount });
        value = result.value;
        detail = formula;
      } catch (error) {
        const reason = error instanceof FormulaError ? error.message : String(error);
        warnings.push(`${employeeName}: công thức khoản "${component.name}" lỗi — ${reason}`);
        return null;
      }
      break;
    }

    default:
      return null;
  }

  // Chia theo ngày công. Chỉ áp cho khoản trả trọn tháng: khoản đã nhân theo
  // giờ/ngày/sản lượng thì bản thân nó đã phản ánh khối lượng làm việc rồi,
  // chia thêm lần nữa là trừ hai lần.
  if (!overrideFormula && component.prorate && component.calc_type === 'FIXED' && standardDays > 0) {
    value = (value / standardDays) * stats.paidDays;
  }

  // Trần của khoản, áp sau cùng. Nói rõ trong diễn giải: một con số bị cắt mà
  // phiếu lương im lặng là thứ người nhận không bao giờ tự đối chiếu ra.
  const cap = component.max_amount;
  if (cap != null && value > cap) {
    detail += ` · chạm trần ${formatNumber(cap)}đ (tính ra ${formatNumber(round(value))}đ)`;
    value = cap;
  }

  return {
    code: component.code,
    name: component.name,
    kind: component.kind,
    quantity,
    rate,
    amount: round(value),
    // Cờ khai riêng cho người này thắng; chưa khai thì theo danh mục.
    taxable: item.taxable ?? component.taxable,
    insurable: item.insurable ?? component.insurable,
    otMultiplier: component.ot_multiplier ?? null,
    taxExemptCap: component.tax_exempt_cap ?? null,
    detail,
  };
}

/**
 * Tính trọn một phiếu lương.
 *
 * Thứ tự cố ý: lương gốc → các khoản cộng (theo `sort_order`) → bảo hiểm →
 * thuế → các khoản trừ. Bảo hiểm phải xong trước thuế vì tiền bảo hiểm được
 * trừ khỏi thu nhập tính thuế; các khoản trừ khác đứng sau cùng vì chúng
 * không ảnh hưởng nghĩa vụ thuế.
 */
export function computePayslip(args: ComputePayslipArgs): ComputedPayslip {
  const { profile, payProfile, items, inputs, stats, settings, adjustments = [], catalogCodes = [] } = args;
  const warnings: string[] = [];
  const lines: ComputedLine[] = [];

  /**
   * Khoản được đánh dấu LƯƠNG GỐC trong danh mục, nếu người này có gán.
   *
   * Khai lương gốc như mọi khoản khác — chọn trong danh mục rồi điền công
   * thức — thay vì học một mô hình riêng chỉ để khai một con số.
   *
   * Không gán khoản nào có cờ đó thì chạy y như cũ theo `pay_basis`. Nhờ vậy
   * cờ này bật lên không làm đổi lương của bất kỳ ai cho tới khi chính người
   * dùng gán khoản đó cho một người.
   */
  const baseItem = items.find((entry) => entry.item.is_base ?? entry.component.is_base);

  const basis: PayBasis = payProfile?.pay_basis ?? 'MONTHLY';
  const baseAmount = baseItem
    // Mức riêng của người này, không có thì lấy mức chung của danh mục.
    ? Number(baseItem.item.amount ?? baseItem.component.default_amount ?? 0)
    : Number(payProfile?.base_amount ?? 0);
  const hoursPerDay = Math.max(settings.hoursPerDay || 8, 1);
  const standardDays = Math.max(
    Number(payProfile?.standard_days_override ?? settings.standardWorkDays) || 26,
    1,
  );

  if (!payProfile) {
    warnings.push(`${profile.name}: chưa thiết lập cơ chế lương — phiếu đang là 0đ.`);
  } else if (baseAmount <= 0 && basis !== 'PIECE') {
    warnings.push(baseItem
      ? `${profile.name}: khoản lương gốc "${baseItem.component.name}" đang là 0đ.`
      : `${profile.name}: cơ chế "${payBasisLabel(basis)}" nhưng đơn giá đang là 0.`);
  }

  // --- Lương gốc ------------------------------------------------------------
  const base = computeBasePay(basis, baseAmount, stats, standardDays);
  const hourlyRate = computeHourlyRate(basis, baseAmount, standardDays, hoursPerDay);

  // Tách 3 dòng L01/L02/L03 (sheet "Đặc tả Lương – KPI") thay vì gộp chung
  // một dòng "Lương theo công" — đúng cấu trúc phiếu lương mẫu BL 01/BL 02
  // (các dòng riêng: Lương thời gian / Lương phép / Lương nghỉ lễ). Tổng 3
  // dòng LUÔN bằng `base.amount` cũ (cùng đơn giá `base.rate` × từng loại
  // ngày cộng lại đúng bằng `paidDays` cũ) — không đổi số tiền, chỉ đổi cách
  // hiển thị. Chỉ MONTHLY/DAILY/COMMISSION có khái niệm "đơn giá ngày" để
  // tách kiểu này; HOURLY/PIECE giữ nguyên một dòng như trước vì Excel không
  // mô tả tách L01/L02/L03 cho hai cơ chế lương đó.
  if (basis === 'HOURLY' || basis === 'PIECE') {
    lines.push({
      code: SYSTEM_CODES.base,
      name: basis === 'PIECE' ? 'Lương khoán (không có lương cứng)' : 'Lương theo giờ',
      kind: 'EARNING',
      quantity: base.quantity,
      rate: round(base.rate),
      amount: round(base.amount),
      taxable: true,
      insurable: true,
      detail: base.detail,
    });
  } else {
    const dayRate = base.rate;
    const pushDayLine = (code: string, name: string, days: number) => {
      if (days <= 0) return;
      lines.push({
        code,
        name,
        kind: 'EARNING',
        quantity: days,
        rate: round(dayRate),
        amount: round(dayRate * days),
        taxable: true,
        insurable: true,
        detail: `${formatNumber(round(dayRate))}đ/ngày × ${formatNumber(days)} ngày`,
      });
    };
    pushDayLine(SYSTEM_CODES.baseWork, 'Lương thời gian', stats.workDays);
    pushDayLine(SYSTEM_CODES.baseLeave, 'Lương phép', stats.leaveDays);
    pushDayLine(SYSTEM_CODES.baseHoliday, 'Lương nghỉ lễ', stats.holidayDays);
    // Cả 3 loại ngày đều = 0 (ví dụ nghỉ không lương trọn tháng) — vẫn giữ
    // một dòng Lương thời gian bằng 0đ để phiếu không thiếu hẳn phần lương
    // gốc, thay vì biến mất hoàn toàn khỏi phiếu.
    if (stats.workDays <= 0 && stats.leaveDays <= 0 && stats.holidayDays <= 0) {
      lines.push({
        code: SYSTEM_CODES.baseWork,
        name: 'Lương thời gian',
        kind: 'EARNING',
        quantity: 0,
        rate: round(dayRate),
        amount: 0,
        taxable: true,
        insurable: true,
        detail: `${formatNumber(round(dayRate))}đ/ngày × 0 ngày`,
      });
    }
  }

  // Lấy thẳng từ các dòng đã đẩy vào phiếu, thay vì tính lại: cơ chế HOURLY/PIECE
  // chỉ có một dòng lương gốc duy nhất, không tách ba, nên mọi cách tính lại đều
  // phải rẽ nhánh theo cơ chế — cộng từ dòng thật thì luôn khớp với phiếu.
  const amountOfLine = (code: string) => round(
    lines.filter((line) => line.code === code).reduce((sum, line) => sum + line.amount, 0),
  );

  // --- Phạm vi biến cho công thức -------------------------------------------
  // Mọi số liệu tháng đều thành biến, cộng thêm mã của các khoản đã tính xong.
  const scope: Record<string, number> = {
    BASE: round(base.amount),

    // Ba cấu phần của lương gốc, tách riêng.
    //
    // `BASE` là tổng cả ba, nên mọi khoản tính % trên "lương thời gian" mà
    // viết `BASE` đều thu dư phần lương phép và lương nghỉ lễ. Kinh phí công
    // đoàn của Huy Phong tính trên lương thời gian + lương doanh số, không
    // phải trên cả ba — không có ba biến này thì không khai đúng được.
    BASE_WORK: amountOfLine(SYSTEM_CODES.baseWork),
    BASE_LEAVE: amountOfLine(SYSTEM_CODES.baseLeave),
    BASE_HOLIDAY: amountOfLine(SYSTEM_CODES.baseHoliday),

    GROSS: round(base.amount), // tổng thu nhập TỚI THỜI ĐIỂM đang tính
    HOURLY_RATE: hourlyRate,
    DAILY_RATE: basis === 'DAILY' ? baseAmount : baseAmount / standardDays,
    MONTHLY_RATE: baseAmount,
    WORK_DAYS: stats.workDays,
    LEAVE_DAYS: stats.leaveDays,
    PAID_DAYS: stats.paidDays,
    STANDARD_DAYS: standardDays,
    WORK_HOURS: stats.workHours,
    HOURS_PER_DAY: hoursPerDay,
    HOLIDAY_DAYS: stats.holidayDays,
    DEPENDENTS: payProfile?.dependents ?? 0,

    // Chuyên cần, đo từ ca làm việc (lib/workSchedule.ts). Engine chỉ CUNG CẤP
    // số liệu; mức phạt và ngưỡng do khoản lương quyết định — đặc tả còn để
    // phần lớn ngưỡng ở trạng thái "Cần xác nhận", và mục L16 cảnh báo Điều
    // 127 BLLĐ 2019 cấm phạt tiền thay cho xử lý kỷ luật. Bằng 0 khi chưa khai
    // ca làm việc, nên công thức phạt sẽ ra 0 thay vì phạt oan.
    LATE_MINUTES: stats.lateMinutes,
    LATE_COUNT: stats.lateCount,
    LATE_AFTER_CUTOFF: stats.lateAfterCutoffCount,
    EARLY_MINUTES: stats.earlyMinutes,
    EARLY_COUNT: stats.earlyCount,
  };

  // Moi khoản trong danh mục đều là một biến, bằng 0 với người không được gán.
  for (const code of catalogCodes) {
    scope[code.toUpperCase()] = 0;
  }

  /**
   * Công thức trỏ tới một khoản mà NGƯỜI NÀY không được gán.
   *
   * Khoản lương được gán theo TỪNG NGƯỜI, nên `LUONG_CB` trong công thức của
   * một người chỉ có số khi chính người đó được gán khoản đó. Không gán thì
   * dòng trên vừa seed nó bằng 0 — công thức vẫn chạy, ra 0đ, và không có gì
   * nói vì sao. Một người mất nguyên khoản lương mà phiếu trông vẫn bình
   * thường.
   *
   * Seed bằng 0 là đúng (khoản chưa phát sinh thì bằng 0), nhưng im lặng thì
   * không. Nói thẳng tên khoản còn thiếu.
   */
  const assignedCodes = new Set(items.map((entry) => entry.component.code.toUpperCase()));
  const catalogSet = new Set(catalogCodes.map((code) => code.toUpperCase()));
  for (const entry of items) {
    const formula = entry.item.formula ?? entry.component.formula;
    if (!formula) continue;
    const missing = codesReferencedBy(formula)
      .filter((code) => catalogSet.has(code) && !assignedCodes.has(code));
    if (missing.length === 0) continue;
    warnings.push(
      `${profile.name}: khoản "${entry.component.name}" lấy số từ `
      + `${missing.join(', ')} nhưng người này chưa được gán khoản đó — phần đó tính bằng 0đ.`,
    );
  }

  // Moi so lieu thang da KHAI trong danh muc deu co mat trong pham vi bien,
  // bang 0 neu thang nay chua ai nhap.
  //
  // Khong co buoc nay thi mot cong thuc nhu `HOURLY_RATE * OT_NGAY_THUONG * 2`
  // se nem loi "khong co bien" o dung nhung thang khong ai lam them gio - tuc
  // la ca dong luong bien mat khoi phieu kem mot canh bao, trong khi cau tra
  // loi dung la 0d. Khai bao mot so lieu thang chinh la tuyen bo "bien nay ton
  // tai"; chua nhap nghia la chua phat sinh.
  for (const assigned of items) {
    const code = assigned.component.input_code;
    if (code) scope[code.toUpperCase()] = 0;
  }

  for (const [code, quantity] of Object.entries(inputs)) {
    scope[code.toUpperCase()] = quantity;
  }

  // Mức đóng bảo hiểm: lấy mức khai báo riêng nếu có, nếu không thì lấy lương
  // theo hợp đồng (KHÔNG phải lương thực nhận tháng này) — nghỉ nửa tháng
  // không làm giảm mức đóng bảo hiểm.
  const contractualBase =
    basis === 'MONTHLY' || basis === 'COMMISSION' ? baseAmount : round(base.amount);
  const declaredInsuranceBase = payProfile?.insurance_base ?? null;
  const rawInsuranceBase = Number(declaredInsuranceBase ?? contractualBase);
  scope.INSURANCE_BASE = rawInsuranceBase;

  // --- Các khoản cộng -------------------------------------------------------
  //
  // Sắp theo PHỤ THUỘC chứ không chỉ theo `sort_order`.
  //
  // Tổng lương là phép cộng trừ nhân chia giữa các khoản, nên một khoản được
  // phép tham chiếu mã của khoản khác. Nhưng khoản được tham chiếu phải tính
  // XONG trước, không thì lúc đọc nó vẫn đang là 0 — và công thức nhìn đúng
  // vẫn ra số sai, lặng lẽ, không cảnh báo gì. Xếp theo `sort_order` là phó
  // mặc chuyện đó cho người khai nhớ đánh số đúng thứ tự.
  const sorted = orderByDependency(items, warnings);

  const earningItems = sorted.filter((entry) => entry.component.kind === 'EARNING');
  for (const assigned of earningItems) {
    const line = computeComponentLine(
      assigned, scope, stats, standardDays, inputs, warnings, profile.name,
    );
    if (!line) continue;
    lines.push(line);
    scope[line.code] = line.amount;
    scope.GROSS = round(scope.GROSS + line.amount);
  }

  // Truy lĩnh kỳ trước (LU-14). Đặt SAU các khoản cộng và TRƯỚC khi chốt gross
  // để nó vào đúng diện chịu thuế — truy lĩnh tiền lương là thu nhập chịu thuế
  // của kỳ chi trả, không phải của kỳ phát sinh.
  let adjustmentRecovery = 0;
  for (const adjustment of adjustments) {
    if (adjustment.kind !== 'RECOVERY') continue;
    const amount = round(Number(adjustment.amount));
    if (amount <= 0) continue;
    lines.push({
      code: SYSTEM_CODES.adjustmentRecovery,
      name: 'Truy lĩnh kỳ trước',
      kind: 'EARNING', quantity: null, rate: null,
      amount, taxable: adjustment.taxable, insurable: false,
      detail: adjustmentDetail(adjustment),
    });
    adjustmentRecovery += amount;
    scope.GROSS = round(scope.GROSS + amount);
  }
  scope.ADJ_RECOVERY = adjustmentRecovery;

  const gross = lines
    .filter((line) => line.kind === 'EARNING')
    .reduce((sum, line) => sum + line.amount, 0);

  // --- Bảo hiểm bắt buộc ----------------------------------------------------
  // Hai trần khác nhau: BHXH/BHYT theo lương cơ sở, BHTN theo lương tối thiểu
  // vùng. Bản cũ không có trần nào, nên người lương cao bị trừ vượt quy định.
  const insuranceEnabled = payProfile?.insurance_enabled ?? true;
  const cappedSocialBase = Math.min(rawInsuranceBase, settings.insuranceSalaryCap);
  const cappedUnemployBase = Math.min(rawInsuranceBase, settings.unemploymentSalaryCap);

  // Số ngày làm việc trong tháng mà người này KHÔNG hưởng lương. Ngày lễ và
  // ngày nghỉ có lương đã nằm trong `paidDays` nên không bị tính vào đây.
  const unpaidDays = Math.max(0, standardDays - stats.paidDays);
  const waiveInsurance = unpaidDays >= UNPAID_DAYS_WAIVING_INSURANCE;

  // Trước khi có nhánh này, người nghỉ gần hết tháng vẫn bị trừ đủ bảo hiểm
  // trên mức lương đóng BH, trong khi lương thực tế gần bằng 0 — thực nhận ra
  // số ÂM. Vừa sai luật vừa là con số không ai giải thích nổi cho người lao
  // động.
  if (insuranceEnabled && rawInsuranceBase > 0 && waiveInsurance) {
    warnings.push(
      `${profile.name}: tháng này chỉ có ${formatNumber(stats.paidDays)} ngày công hưởng lương `
      + `trên ${formatNumber(standardDays)} ngày chuẩn (nghỉ không lương `
      + `${formatNumber(unpaidDays)} ngày ≥ ${UNPAID_DAYS_WAIVING_INSURANCE}) nên KHÔNG tính bảo hiểm `
      + 'theo Điều 85 Luật BHXH. Kiểm tra lại chấm công nếu đây là nhầm lẫn.',
    );
  }

  let insuranceEmployee = 0;
  if (insuranceEnabled && rawInsuranceBase > 0 && !waiveInsurance) {
    const social = round((cappedSocialBase * settings.socialInsuranceRate) / 100);
    const health = round((cappedSocialBase * settings.healthInsuranceRate) / 100);
    const unemployment = round((cappedUnemployBase * settings.unemploymentInsuranceRate) / 100);

    lines.push({
      code: SYSTEM_CODES.socialInsurance,
      name: `BHXH (${settings.socialInsuranceRate}%)`,
      kind: 'DEDUCTION', quantity: null, rate: settings.socialInsuranceRate,
      amount: social, taxable: false, insurable: false,
      detail: `${settings.socialInsuranceRate}% × ${formatNumber(cappedSocialBase)}đ mức đóng`,
    });
    lines.push({
      code: SYSTEM_CODES.healthInsurance,
      name: `BHYT (${settings.healthInsuranceRate}%)`,
      kind: 'DEDUCTION', quantity: null, rate: settings.healthInsuranceRate,
      amount: health, taxable: false, insurable: false,
      detail: `${settings.healthInsuranceRate}% × ${formatNumber(cappedSocialBase)}đ mức đóng`,
    });
    lines.push({
      code: SYSTEM_CODES.unemploymentInsurance,
      name: `BHTN (${settings.unemploymentInsuranceRate}%)`,
      kind: 'DEDUCTION', quantity: null, rate: settings.unemploymentInsuranceRate,
      amount: unemployment, taxable: false, insurable: false,
      detail: `${settings.unemploymentInsuranceRate}% × ${formatNumber(cappedUnemployBase)}đ mức đóng`,
    });

    insuranceEmployee = social + health + unemployment;
  }

  scope.INSURANCE_EMPLOYEE = insuranceEmployee;

  // --- Thuế thu nhập cá nhân ------------------------------------------------
  // Chỉ phần thu nhập có cờ `taxable` mới vào diện chịu thuế: tiền ăn ca trong
  // mức miễn, công tác phí… đứng ngoài.
  //
  // Riêng tiền làm thêm giờ: chỉ phần TƯƠNG ĐƯƠNG giờ thường mới chịu thuế,
  // phần trả cao hơn được miễn (T04, Điều 4 Thông tư 111/2013). Với hệ số
  // 150%, một khoản 150.000đ gồm 100.000đ chịu thuế và 50.000đ miễn — tức
  // phần miễn là (hệ số − 1) ÷ hệ số. Không trừ ra là tính dư thuế cho đúng
  // những người làm thêm nhiều nhất.
  // Kẹp ở 0: phần miễn của tăng ca chỉ được trừ trong phạm vi phần chịu thuế
  // của chính dòng đó. Không kẹp thì một khoản vừa miễn thuế vừa có hệ số tăng
  // ca sẽ trừ âm vào tổng, làm giảm thuế của các khoản khác.
  const taxableEarnings = lines
    .filter((line) => line.kind === 'EARNING')
    .reduce((sum, line) => sum + Math.max(0, taxablePortion(line) - otTaxExempt(line)), 0);

  const dependents = payProfile?.dependents ?? 0;
  const personalRelief = settings.taxPersonalDeduction;
  const dependentRelief = dependents * settings.taxDependentDeduction;
  const taxMode = payProfile?.tax_mode ?? 'PROGRESSIVE';

  let taxableIncome = 0;
  let personalIncomeTax = 0;
  let taxSteps: TaxBreakdownStep[] = [];
  let taxDetail = '';

  if (taxMode === 'NONE') {
    taxDetail = 'Không khấu trừ thuế tại nguồn';
  } else if (taxMode === 'FLAT') {
    // Hợp đồng dưới 3 tháng: khấu trừ thẳng trên tổng thu nhập chịu thuế,
    // KHÔNG có giảm trừ gia cảnh.
    const rate = payProfile?.flat_tax_rate ?? 10;
    taxableIncome = taxableEarnings;
    personalIncomeTax = round((taxableEarnings * rate) / 100);
    taxDetail = `Khấu trừ ${rate}% trên ${formatNumber(taxableEarnings)}đ (hợp đồng dưới 3 tháng)`;
  } else {
    taxableIncome = Math.max(0, taxableEarnings - insuranceEmployee - personalRelief - dependentRelief);
    const result = progressiveIncomeTax(taxableIncome, toTaxBrackets(settings.brackets));
    personalIncomeTax = result.tax;
    taxSteps = result.steps;
    taxDetail =
      `(${formatNumber(taxableEarnings)} − ${formatNumber(insuranceEmployee)} bảo hiểm ` +
      `− ${formatNumber(personalRelief)} bản thân` +
      (dependents > 0 ? ` − ${formatNumber(dependentRelief)} cho ${dependents} người phụ thuộc` : '') +
      `) = ${formatNumber(taxableIncome)}đ, lũy tiến ${result.steps.length} bậc`;
  }

  if (personalIncomeTax > 0 || taxMode !== 'NONE') {
    lines.push({
      code: SYSTEM_CODES.personalIncomeTax,
      name: 'Thuế thu nhập cá nhân',
      kind: 'DEDUCTION', quantity: null, rate: null,
      amount: personalIncomeTax, taxable: false, insurable: false,
      detail: taxDetail,
    });
  }

  scope.PIT = personalIncomeTax;
  scope.TAXABLE_INCOME = taxableIncome;

  // --- Khấu trừ khác --------------------------------------------------------
  let otherDeductions = 0;

  // Truy thu kỳ trước. Đặt SAU thuế: đây là thu hồi tiền đã trả thừa, không
  // phải một khoản làm giảm thu nhập chịu thuế của kỳ này.
  for (const adjustment of adjustments) {
    if (adjustment.kind !== 'CLAWBACK') continue;
    const amount = round(Number(adjustment.amount));
    if (amount <= 0) continue;
    lines.push({
      code: SYSTEM_CODES.adjustmentClawback,
      name: 'Truy thu kỳ trước',
      kind: 'DEDUCTION', quantity: null, rate: null,
      amount, taxable: false, insurable: false,
      detail: adjustmentDetail(adjustment),
    });
    otherDeductions += amount;
  }
  scope.ADJ_CLAWBACK = otherDeductions;
  for (const assigned of sorted.filter((entry) => entry.component.kind === 'DEDUCTION')) {
    const line = computeComponentLine(
      assigned, scope, stats, standardDays, inputs, warnings, profile.name,
    );
    if (!line) continue;
    lines.push(line);
    scope[line.code] = line.amount;
    otherDeductions += line.amount;
  }

  // --- Chi phí doanh nghiệp -------------------------------------------------
  // Không trừ của nhân viên; chỉ để biết một người thực sự tốn bao nhiêu.
  //
  // Bảo hiểm phần doanh nghiệp tính NGAY TẠI ĐÂY từ cấu hình, giống hệt cách
  // phần người lao động được tính ở trên. Trước đây ba khoản ER_* là component
  // phải gán tay cho từng người, nên cùng một nghĩa vụ bảo hiểm lại có hai nơi
  // khai báo tỷ lệ và hai cách vận hành.
  // `waiveInsurance` áp cho CẢ HAI phía: Điều 85 miễn nghĩa vụ đóng của tháng
  // đó, không phải chỉ miễn phần trừ vào lương nhân viên. Bỏ sót phần doanh
  // nghiệp sẽ khai vống chi phí nhân sự của tháng.
  let insuranceEmployer = 0;
  if (insuranceEnabled && rawInsuranceBase > 0 && !waiveInsurance) {
    const employerParts: Array<[string, string, number, number]> = [
      ['ER_SOCIAL', 'BHXH doanh nghiệp đóng', settings.employerSocialRate, cappedSocialBase],
      ['ER_HEALTH', 'BHYT doanh nghiệp đóng', settings.employerHealthRate, cappedSocialBase],
      ['ER_UNEMPLOY', 'BHTN doanh nghiệp đóng', settings.employerUnemploymentRate, cappedUnemployBase],
    ];

    for (const [code, name, rate, base] of employerParts) {
      if (rate <= 0) continue;
      const amount = round((base * rate) / 100);
      lines.push({
        code, name: `${name} (${rate}%)`, kind: 'EMPLOYER_COST',
        quantity: null, rate, amount, taxable: false, insurable: false,
        detail: `${rate}% × ${formatNumber(base)}đ mức đóng`,
      });
      scope[code] = amount;
      insuranceEmployer += amount;
    }
  }

  // Khoản chi phí doanh nghiệp KHÁC do HR tự định nghĩa (kinh phí công đoàn,
  // phúc lợi...) vẫn chạy qua component như trước.
  for (const assigned of sorted.filter((entry) => entry.component.kind === 'EMPLOYER_COST')) {
    const line = computeComponentLine(
      assigned, scope, stats, standardDays, inputs, warnings, profile.name,
    );
    if (!line) continue;
    lines.push(line);
    scope[line.code] = line.amount;
    insuranceEmployer += line.amount;
  }

  const netPay = gross - insuranceEmployee - personalIncomeTax - otherDeductions;

  if (netPay < 0) {
    warnings.push(
      `${profile.name}: thực nhận đang ÂM ${formatNumber(Math.abs(netPay))}đ — ` +
        'khoản khấu trừ vượt quá thu nhập, cần rà lại tạm ứng và khấu trừ khác.',
    );
  }

  return {
    payBasis: basis,
    stats,
    standardDays,
    hourlyRate: round(hourlyRate),
    insuranceBase: rawInsuranceBase,
    lines,
    gross: round(gross),
    taxableIncome: round(taxableIncome),
    insuranceEmployee: round(insuranceEmployee),
    insuranceEmployer: round(insuranceEmployer),
    personalIncomeTax: round(personalIncomeTax),
    taxSteps,
    otherDeductions: round(otherDeductions),
    netPay: round(netPay),
    snapshot: {
      pay_basis: basis,
      base_amount: baseAmount,
      standard_days: standardDays,
      hours_per_day: hoursPerDay,
      hourly_rate: round(hourlyRate),
      insurance_base: rawInsuranceBase,
      insurance_enabled: insuranceEnabled,
      insurance_cap_applied: rawInsuranceBase > settings.insuranceSalaryCap,
      social_insurance_rate: settings.socialInsuranceRate,
      health_insurance_rate: settings.healthInsuranceRate,
      unemployment_insurance_rate: settings.unemploymentInsuranceRate,
      employer_social_rate: settings.employerSocialRate,
      employer_health_rate: settings.employerHealthRate,
      employer_unemployment_rate: settings.employerUnemploymentRate,
      tax_mode: taxMode,
      flat_tax_rate: payProfile?.flat_tax_rate ?? null,
      dependents,
      personal_relief: personalRelief,
      dependent_relief: dependentRelief,
      tax_steps: taxSteps,
      inputs,
      computed_at: new Date().toISOString(),
    },
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Chọn bản ghi có hiệu lực
// ---------------------------------------------------------------------------

/**
 * Cơ chế lương áp dụng cho kỳ: bản ghi mới nhất có `effective_from` không vượt
 * quá ngày cuối kỳ. Nhờ vậy tăng lương giữa chừng không làm sai lệch các tháng
 * đã qua — lịch sử lương giữ nguyên thay vì bị ghi đè như bảng cũ.
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

/** Khoản còn hiệu lực trong kỳ (đã bắt đầu, chưa kết thúc). */
export function itemsForPeriod(
  items: AssignedPayItem[],
  periodStart: string,
  periodEnd: string,
): AssignedPayItem[] {
  return items.filter(({ item, component }) => {
    if (!component.is_active) return false;
    if (item.effective_from > periodEnd) return false;
    if (item.effective_to && item.effective_to < periodStart) return false;
    return true;
  });
}

/**
 * Gộp khoản của ĐƠN VỊ với khoản gán riêng cho NGƯỜI.
 *
 * Quy tắc: cùng một khoản thì bản của người THẮNG bản của đơn vị — không cộng
 * dồn. Cộng dồn nghĩa là một người vừa hưởng mức chung của phòng vừa hưởng
 * mức riêng, gần như luôn là sai và rất khó phát hiện vì phiếu lương vẫn ra
 * một con số trông hợp lý.
 *
 * Cả hai phía đều đã phải lọc theo kỳ trước khi vào đây.
 */
export function mergeUnitAndEmployeeItems(
  unitItems: AssignedPayItem[],
  employeeItems: AssignedPayItem[],
): AssignedPayItem[] {
  const overriddenComponents = new Set(employeeItems.map(({ item }) => item.component_id));
  const inherited = unitItems.filter(({ item }) => !overriddenComponents.has(item.component_id));
  return [...inherited, ...employeeItems];
}

/**
 * Bộ biến mẫu để kiểm tra công thức lúc HR đang gõ, trước khi có dữ liệu thật.
 */
export function sampleFormulaScope(
  settings: PayrollParams,
  extraCodes: string[] = [],
): Record<string, number> {
  const standardDays = settings.standardWorkDays || 26;
  const hoursPerDay = settings.hoursPerDay || 8;
  const monthly = 15_000_000;

  const scope: Record<string, number> = {
    BASE: monthly,
    BASE_WORK: monthly,
    BASE_LEAVE: 0,
    BASE_HOLIDAY: 0,
    GROSS: monthly,
    HOURLY_RATE: monthly / standardDays / hoursPerDay,
    DAILY_RATE: monthly / standardDays,
    MONTHLY_RATE: monthly,
    WORK_DAYS: standardDays,
    LEAVE_DAYS: 0,
    PAID_DAYS: standardDays,
    STANDARD_DAYS: standardDays,
    WORK_HOURS: standardDays * hoursPerDay,
    HOURS_PER_DAY: hoursPerDay,
    HOLIDAY_DAYS: 0,
    DEPENDENTS: 1,
    LATE_MINUTES: 0,
    LATE_COUNT: 0,
    LATE_AFTER_CUTOFF: 0,
    EARLY_MINUTES: 0,
    EARLY_COUNT: 0,
    KPI_PCT: 100,
    MUC_RIENG: 1_000_000,
    INSURANCE_BASE: monthly,
    INSURANCE_EMPLOYEE: monthly * 0.105,
    PIT: 0,
    TAXABLE_INCOME: 0,
  };

  for (const code of extraCodes) {
    const normalized = code.toUpperCase();
    if (scope[normalized] === undefined) scope[normalized] = 1;
  }
  return scope;
}
