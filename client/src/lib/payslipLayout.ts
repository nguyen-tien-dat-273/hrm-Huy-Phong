// ============================================================================
// Mẫu phiếu lương theo đơn vị.
// ----------------------------------------------------------------------------
// Mỗi phòng ban một mẫu (Văn phòng BL 01, Kinh doanh BL 02…): mã mẫu, tiêu đề,
// dòng trung gian nào hiện ở đầu phiếu, khoản trừ nào đứng trước Tổng cộng.
// Phần còn lại phiếu tự đánh số theo nhóm của Danh mục. Mẫu chỉ để trình bày,
// không đổi cách tính. Đơn vị con không có mẫu riêng thì dùng mẫu cấp trên —
// giống cách cơ chế chung thừa hưởng.
// ============================================================================

import { normalizeText } from './formulaTokens';
import type { OrganizationUnit, PayComponent, PayslipHeaderFormat, PayslipLayout } from '@/types';

/** Mẫu đã giải cho một đơn vị (kèm nơi lấy mẫu). */
export interface ResolvedPayslipLayout {
  formCode: string | null;
  title: string | null;
  header: Array<{ code: string; format: PayslipHeaderFormat }>;
  beforeTotal: string[];
  /** Đơn vị có mẫu này — null khi chưa đơn vị nào có mẫu (đang theo mặc định). */
  originUnitId: string | null;
}

export const HEADER_FORMAT_LABEL: Record<PayslipHeaderFormat, string> = {
  number: 'Số',
  money: 'Tiền (đ)',
  percent: 'Phần trăm (45 → 45%)',
  ratio: 'Tỷ lệ (0,45 → 45%)',
};

/** Đoán cách in con số theo tên dòng — chỉ để gợi ý khi vừa tích lên đầu phiếu. */
export function guessHeaderFormat(name: string): PayslipHeaderFormat {
  const text = normalizeText(name);
  if (name.includes('%')) return 'percent';
  if (text.includes('ty le')) return 'ratio';
  if (/(luong|doanh so|muc |tien|bac |don gia|thu nhap)/.test(`${text} `)) return 'money';
  return 'number';
}

/** Chưa có mẫu ở đâu: hiện dòng trung gian được đánh dấu "hiện trên phiếu lương" như trước. */
export function defaultPayslipLayout(components: readonly PayComponent[]): ResolvedPayslipLayout {
  return {
    formCode: null,
    title: null,
    header: components
      .filter((component) => component.kind === 'INFO' && component.show_on_payslip
        && component.report_tag !== 'INSURANCE_EMPLOYER')
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((component) => ({ code: component.code, format: guessHeaderFormat(component.name) })),
    beforeTotal: [],
    originUnitId: null,
  };
}

export function fromStoredLayout(layout: PayslipLayout): ResolvedPayslipLayout {
  return {
    formCode: layout.form_code,
    title: layout.title,
    header: (layout.header ?? []).map((item) => ({ code: item.code, format: item.format ?? 'number' })),
    beforeTotal: layout.before_total ?? [],
    originUnitId: layout.unit_id,
  };
}

/** Mẫu áp cho đơn vị: của chính nó, không có thì của cấp trên gần nhất, cuối cùng là mặc định. */
export function resolvePayslipLayout(
  unitId: string | null | undefined,
  units: readonly OrganizationUnit[],
  layouts: readonly PayslipLayout[],
  components: readonly PayComponent[],
): ResolvedPayslipLayout {
  const byUnit = new Map(layouts.map((layout) => [layout.unit_id, layout]));
  const parentOf = new Map(units.map((unit) => [unit.id, unit.parent_id]));
  const seen = new Set<string>();
  let current = unitId ?? null;
  while (current && !seen.has(current)) {
    seen.add(current);
    const own = byUnit.get(current);
    if (own) return fromStoredLayout(own);
    current = parentOf.get(current) ?? null;
  }
  return defaultPayslipLayout(components);
}
