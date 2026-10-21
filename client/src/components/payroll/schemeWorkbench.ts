// Phần dùng chung của hai màn soạn cơ chế (cơ chế chung của đơn vị, khai riêng
// của người): dữ liệu thử để mỗi dòng hiện ngay con số, và phạm vi biến để
// kiểm tra công thức đang gõ.

import { systemScope, type ComputedPayslip, type PeriodStats } from '@/lib/payroll';
import type { PayrollParams } from '@/lib/payrollSettings';
import type { PayComponent } from '@/types';

/** Một tháng đi đủ công chuẩn, chưa có số liệu tháng — giả định cho mọi con số ước tính. */
export function fullMonthStats(params: Pick<PayrollParams, 'standardDays' | 'hoursPerDay'>): PeriodStats {
  const workDays = params.standardDays;
  return {
    workDays, leaveDays: 0, holidayDays: 0, paidDays: workDays,
    workHours: workDays * (params.hoursPerDay || 8), missingCheckout: 0,
    lateMinutes: 0, lateCount: 0, lateAfterCutoffCount: 0, earlyMinutes: 0, earlyCount: 0,
  };
}

/**
 * Phạm vi biến để kiểm tra công thức: đầu mục chưa tính (= 0) → tham số → dữ
 * liệu tự động → kết quả tính thử. `MUC_RIENG` = 1 chỉ để công thức cũ có đọc
 * "mức riêng" không bị báo thiếu biến.
 */
export function formulaScopeOf(
  components: readonly PayComponent[],
  params: PayrollParams | null,
  computed: Pick<ComputedPayslip, 'stats' | 'values'> | null,
): Record<string, number> {
  const base: Record<string, number> = {};
  for (const component of components) base[component.code] = 0;
  const stats = computed?.stats ?? fullMonthStats(params ?? { standardDays: 0, hoursPerDay: 8 });
  return {
    ...base,
    ...(params?.values ?? {}),
    ...systemScope(stats, params ?? { standardDays: 0, hoursPerDay: 8 }),
    ...(computed?.values ?? {}),
    MUC_RIENG: 1,
  };
}

/** Ô số: trống là null, gõ sai là NaN (để báo lỗi đúng ô). Nhận "1.000.000" và "1,5". */
export function parseAmountText(text: string): number | null {
  if (!text.trim()) return null;
  const value = Number(/^\d{1,3}(\.\d{3})+$/.test(text.trim()) ? text.replace(/\./g, '') : text.replace(',', '.'));
  return Number.isFinite(value) ? value : Number.NaN;
}

export function monthText(iso: string): string {
  return `${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

export function monthEndOf(monthStart: string): string {
  const [year, month] = monthStart.split('-').map(Number);
  return `${monthStart.slice(0, 7)}-${String(new Date(year, month, 0).getDate()).padStart(2, '0')}`;
}
