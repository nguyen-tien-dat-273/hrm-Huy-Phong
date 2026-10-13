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
}

export const EMPTY_SCHEDULES: ScheduleSet = { schedules: [], supported: false };

export async function fetchWorkSchedules(): Promise<ScheduleSet> {
  if (!supabase) return EMPTY_SCHEDULES;

  const { data, error } = await supabase
    .from('work_schedules')
    .select('*')
    .eq('is_active', true)
    .order('effective_from');

  if (error) return EMPTY_SCHEDULES;
  return { schedules: (data || []) as WorkSchedule[], supported: true };
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
 * Công chuẩn của một tháng, tính từ lịch.
 *
 * Trả `null` khi chưa có ca nào phủ tháng đó — người gọi phải rơi về ngày công
 * chuẩn trong tham số lương. Đoán bừa ở đây là làm sai mẫu số của cả bảng
 * lương mà không ai thấy.
 *
 * Kiểm chứng bằng ví dụ của đặc tả: T8/2026 có 21 ngày thứ Hai–Sáu và 5 thứ
 * Bảy, thứ Bảy nửa ngày → 21 + 2,5 = 23,5.
 */
export function monthStandardDays(
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
