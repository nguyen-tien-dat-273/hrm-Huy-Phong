// ============================================================================
// Ca làm việc: công chuẩn theo tháng và đo đi muộn / về sớm.
// ----------------------------------------------------------------------------
// Trả lời tham số P02 của sheet "Đặc tả Lương – KPI": công chuẩn KHÔNG phải
// hằng số. Phiếu T8/2026 của khách ghi 23,5 công = 21 ngày thứ Hai–Sáu +
// 5 thứ Bảy × 0,5. Hàm `monthStandardDays` dưới đây tái lập đúng con số đó từ
// lịch, thay cho việc gõ cứng 26 cho mọi tháng.
//
// Đây cũng là chỗ duy nhất biết GIỜ VÀO CHUẨN, nên là điều kiện cần của phạt
// đi muộn (L16), phạt quá số lần (L17), thưởng đúng giờ (L14) và tiêu chí
// chuyên cần KPI (LU-06).
//
// Thư viện chỉ ĐO, không phán xét: nó trả về số phút và số lần, còn mức phạt
// hay ngưỡng bao nhiêu thì do `payroll_components` quyết định — phần lớn các
// ngưỡng trong đặc tả vẫn đang là "Cần xác nhận", và mục L16 cảnh báo Điều
// 127 BLLĐ 2019 cấm phạt tiền thay cho xử lý kỷ luật.
// ============================================================================

import { supabase } from './supabase';

export interface WorkSchedule {
  id: string;
  name: string;
  effective_from: string;
  effective_to: string | null;
  /** 'HH:MM:SS' theo giờ làm việc của công ty. */
  start_time: string;
  end_time: string;
  break_minutes: number;
  saturday_mode: 'OFF' | 'HALF' | 'FULL';
  /** Phút ân hạn trước khi tính là đi muộn. */
  grace_minutes: number;
  is_active: boolean;
  note: string | null;
}

/** Migration chưa chạy thì `supported` false — người gọi rơi về cấu hình cũ. */
export interface ScheduleSet {
  schedules: WorkSchedule[];
  supported: boolean;
  /** Công chuẩn nhập tay theo tháng, khoá 'YYYY-MM-01'. Có thì thắng số tính từ lịch. */
  overrides?: Readonly<Record<string, number>>;
}

export const EMPTY_SCHEDULES: ScheduleSet = { schedules: [], supported: false };

/** `includeLocked`: màn thiết lập cần thấy cả cấu hình đã khóa để mở khóa lại. */
export async function fetchWorkSchedules(includeLocked = false): Promise<ScheduleSet> {
  if (!supabase) return EMPTY_SCHEDULES;

  let query = supabase.from('work_schedules').select('*');
  if (!includeLocked) query = query.eq('is_active', true);
  const { data, error } = await query.order('effective_from');

  if (error) return EMPTY_SCHEDULES;
  return { schedules: (data || []) as WorkSchedule[], supported: true, overrides: await fetchMonthOverrides() };
}

/** Bảng công chuẩn nhập tay chưa có (migration chưa chạy) thì coi như không ghi đè. */
async function fetchMonthOverrides(): Promise<Record<string, number>> {
  if (!supabase) return {};
  const { data, error } = await supabase.from('month_standard_days').select('month, standard_days');
  if (error) return {};
  const overrides: Record<string, number> = {};
  for (const row of data ?? []) overrides[row.month as string] = Number(row.standard_days);
  return overrides;
}

/** Ghi công chuẩn nhập tay cho tháng; `standardDays` null là xoá, quay về số tính từ lịch. */
export async function saveMonthOverride(
  month: string,
  standardDays: number | null,
  userId: string | null,
): Promise<{ error: string | null }> {
  if (!supabase) return { error: 'Chưa kết nối máy chủ' };
  const { error } = standardDays == null
    ? await supabase.from('month_standard_days').delete().eq('month', month)
    : await supabase.from('month_standard_days')
      .upsert({ month, standard_days: standardDays, updated_by: userId }, { onConflict: 'month' });
  return { error: error?.message ?? null };
}

/** Công chuẩn nhập tay của tháng, null khi tháng đó dùng số tính từ lịch. */
export function monthOverride(set: ScheduleSet, monthStart: Date): number | null {
  const value = set.overrides?.[toIso(monthStart.getFullYear(), monthStart.getMonth(), 1)];
  return value != null && value > 0 ? value : null;
}

// ---------------------------------------------------------------------------
// Tra cứu
// ---------------------------------------------------------------------------

export function toIso(year: number, monthIndex: number, day: number): string {
  return `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Ca áp dụng cho một ngày. Bản có hiệu lực muộn nhất thắng. */
export function scheduleForDate(set: ScheduleSet, iso: string): WorkSchedule | null {
  const matches = set.schedules.filter(
    (item) => item.effective_from <= iso && (!item.effective_to || item.effective_to >= iso),
  );
  if (matches.length === 0) return null;
  return matches.reduce((latest, item) =>
    item.effective_from > latest.effective_from ? item : latest);
}

/**
 * Trọng số công của một ngày: 1 ngày đủ, 0,5 nửa ngày, 0 ngày nghỉ.
 *
 * Ngày lễ trả 0 vì người lao động không phải đi làm — phần tiền của ngày đó
 * đi qua khoản "Lương nghỉ lễ" (L03) chứ không nằm trong công chuẩn.
 */
export function dayWeight(set: ScheduleSet, iso: string, holidays: ReadonlySet<string>): number {
  if (holidays.has(iso)) return 0;

  const weekday = new Date(`${iso}T00:00:00`).getDay();
  if (weekday === 0) return 0;

  if (weekday === 6) {
    const mode = scheduleForDate(set, iso)?.saturday_mode ?? 'OFF';
    return mode === 'FULL' ? 1 : mode === 'HALF' ? 0.5 : 0;
  }

  return 1;
}

/**
 * Công chuẩn của một tháng: số nhập tay nếu HR đã đặt, không thì tính từ lịch.
 */
export function monthStandardDays(
  set: ScheduleSet,
  monthStart: Date,
  holidays: readonly string[] = [],
): number | null {
  return monthOverride(set, monthStart) ?? calendarStandardDays(set, monthStart, holidays);
}

/**
 * Công chuẩn của một tháng, tính từ lịch.
 *
 * Trả `null` khi chưa có ca nào phủ tháng đó — người gọi phải rơi về ngày công
 * chuẩn trong tham số lương. Đoán bừa ở đây là làm sai mẫu số của cả bảng
 * lương mà không ai thấy.
 *
 * Kiểm chứng bằng ví dụ của đặc tả: T8/2026 có 21 ngày thứ Hai–Sáu và 5 thứ
 * Bảy, thứ Bảy nửa ngày → 21 + 2,5 = 23,5.
 */
export function calendarStandardDays(
  set: ScheduleSet,
  monthStart: Date,
  holidays: readonly string[] = [],
): number | null {
  if (!set.supported || set.schedules.length === 0) return null;

  const year = monthStart.getFullYear();
  const month = monthStart.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  // Không có ca nào phủ tháng này thì không suy ra được công chuẩn.
  if (!scheduleForDate(set, toIso(year, month, 1))
    && !scheduleForDate(set, toIso(year, month, daysInMonth))) {
    return null;
  }

  const holidaySet = new Set(holidays);
  let total = 0;
  for (let day = 1; day <= daysInMonth; day += 1) {
    total += dayWeight(set, toIso(year, month, day), holidaySet);
  }

  return Math.round(total * 100) / 100;
}

export interface StandardDaysLine {
  label: string;
  /** Số ngày thuộc nhóm này. */
  count: number;
  /** Công của MỘT ngày trong nhóm. */
  weight: number;
}

export interface StandardDaysBreakdown {
  total: number;
  lines: StandardDaysLine[];
  /** Ngày lễ rơi vào ngày vốn phải đi làm — chỉ những ngày này mới làm giảm công. */
  holidayDates: string[];
}

/**
 * Giải thích `calendarStandardDays`: đi qua từng ngày bằng đúng `dayWeight` rồi gom
 * theo nhóm, nên tổng các dòng luôn bằng công chuẩn. Trả null khi không tính được.
 */
export function monthStandardBreakdown(
  set: ScheduleSet,
  monthStart: Date,
  holidays: readonly string[] = [],
): StandardDaysBreakdown | null {
  const total = calendarStandardDays(set, monthStart, holidays);
  if (total == null) return null;

  const year = monthStart.getFullYear();
  const month = monthStart.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const holidaySet = new Set(holidays);
  const noHolidays: ReadonlySet<string> = new Set();

  let weekdays = 0;
  let sundays = 0;
  const saturdays = new Map<number, number>();
  const holidayDates: string[] = [];

  for (let day = 1; day <= daysInMonth; day += 1) {
    const iso = toIso(year, month, day);
    const weekday = new Date(`${iso}T00:00:00`).getDay();
    // Trọng số nếu không có ngày lễ, để biết ngày lễ nào thật sự làm mất công.
    const base = dayWeight(set, iso, noHolidays);

    if (holidaySet.has(iso) && base > 0) { holidayDates.push(iso); continue; }
    if (weekday === 0) sundays += 1;
    else if (weekday === 6) saturdays.set(base, (saturdays.get(base) ?? 0) + 1);
    else weekdays += 1;
  }

  const lines: StandardDaysLine[] = [{ label: 'Thứ Hai – Thứ Sáu', count: weekdays, weight: 1 }];
  for (const [weight, count] of [...saturdays].sort((a, b) => b[0] - a[0])) {
    lines.push({ label: 'Thứ Bảy', count, weight });
  }
  lines.push({ label: 'Chủ nhật', count: sundays, weight: 0 });
  if (holidayDates.length > 0) lines.push({ label: 'Ngày lễ', count: holidayDates.length, weight: 0 });

  return { total, lines, holidayDates };
}

/** Giờ công chuẩn mỗi ngày, suy từ ca trừ nghỉ trưa. */
export function hoursPerDay(schedule: WorkSchedule | null): number | null {
  if (!schedule) return null;
  const start = clockMinutes(schedule.start_time);
  const end = clockMinutes(schedule.end_time);
  const minutes = (end > start ? end - start : end + 24 * 60 - start) - schedule.break_minutes;
  return minutes > 0 ? Math.round((minutes / 60) * 100) / 100 : null;
}

// ---------------------------------------------------------------------------
// Đo đi muộn và về sớm
// ---------------------------------------------------------------------------

export interface PunctualityStats {
  /** Tổng phút đi muộn trong tháng, đã trừ ân hạn. */
  lateMinutes: number;
  /** Số LẦN đi muộn — đặc tả đặt ngưỡng theo lần, không theo phút. */
  lateCount: number;
  earlyMinutes: number;
  earlyCount: number;
  /**
   * Số lần vào sau giờ mốc (L16: sau 9h) — nhóm này đặc tả xử lý bằng trừ nửa
   * ngày phép/công, khác nhóm muộn ít bị phạt theo phút.
   */
  lateAfterCutoffCount: number;
}

export const EMPTY_PUNCTUALITY: PunctualityStats = {
  lateMinutes: 0, lateCount: 0, earlyMinutes: 0, earlyCount: 0, lateAfterCutoffCount: 0,
};

/** Các ngày đã có đơn đi muộn/về sớm được duyệt nên không tính vi phạm. */
export interface PunctualityExceptions {
  lateDates?: ReadonlySet<string>;
  earlyDates?: ReadonlySet<string>;
}

/** Giờ mốc "muộn quá thì trừ nửa công" trong đặc tả L16. */
export const LATE_CUTOFF_HOUR = 9;

function clockMinutes(value: string): number {
  const [hours, minutes] = value.split(':').map(Number);
  return (hours || 0) * 60 + (minutes || 0);
}

function minutesOfDay(timestamp: string): number {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return Number.NaN;
  return date.getHours() * 60 + date.getMinutes();
}

/**
 * Đo đi muộn / về sớm của một người trong kỳ.
 *
 * Ngày không có ca áp dụng bị BỎ QUA thay vì đoán giờ chuẩn — đoán sai ở đây
 * là phạt oan tiền của người lao động.
 */
export function measurePunctuality(
  set: ScheduleSet,
  records: ReadonlyArray<{ date: string; check_in_time: string | null; check_out_time: string | null }>,
  holidays: readonly string[] = [],
  exceptions: PunctualityExceptions = {},
): PunctualityStats {
  if (!set.supported) return EMPTY_PUNCTUALITY;

  const holidaySet = new Set(holidays);
  const stats: PunctualityStats = { ...EMPTY_PUNCTUALITY };

  for (const record of records) {
    const schedule = scheduleForDate(set, record.date);
    if (!schedule) continue;
    // Ngày nghỉ và ngày lễ không có khái niệm đi muộn.
    if (dayWeight(set, record.date, holidaySet) === 0) continue;

    if (record.check_in_time && !exceptions.lateDates?.has(record.date)) {
      const actual = minutesOfDay(record.check_in_time);
      if (Number.isFinite(actual)) {
        const late = actual - clockMinutes(schedule.start_time) - schedule.grace_minutes;
        if (late > 0) {
          stats.lateMinutes += late;
          stats.lateCount += 1;
          if (actual >= LATE_CUTOFF_HOUR * 60) stats.lateAfterCutoffCount += 1;
        }
      }
    }

    if (record.check_out_time && !exceptions.earlyDates?.has(record.date)) {
      let actual = minutesOfDay(record.check_out_time);
      if (Number.isFinite(actual)) {
        const start = clockMinutes(schedule.start_time);
        let scheduledEnd = clockMinutes(schedule.end_time);
        // Ca qua đêm: 22:00–06:00 được biểu diễn thành 22:00–30:00 để
        // checkout lúc 05:45 chỉ bị tính về sớm 15 phút, không phải 16 giờ.
        if (scheduledEnd <= start) scheduledEnd += 24 * 60;
        if (actual < start && scheduledEnd > 24 * 60) actual += 24 * 60;
        const early = scheduledEnd - actual;
        if (early > 0) {
          stats.earlyMinutes += early;
          stats.earlyCount += 1;
        }
      }
    }
  }

  return stats;
}
