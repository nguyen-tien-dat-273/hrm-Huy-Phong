// ============================================================================
// Cơ chế lương của một người, giải theo CÂY tổ chức.
// ----------------------------------------------------------------------------
// Dòng lương của một người đến từ hai lớp, lớp trên thắng lớp dưới cho CÙNG một
// đầu mục:
//
//   1. Khai riêng cho người      (employee_pay_items) — thay một dòng, hoặc
//                                 thêm dòng chỉ người này có.
//   2. Cơ chế chung của đơn vị   (unit_pay_items) — đi từ đơn vị CAO NHẤT
//                                 xuống đơn vị của người đó; đơn vị gần nhất
//                                 thắng. Mỗi dòng mang đủ định nghĩa (công
//                                 thức / giá trị / từng người / hằng tháng);
//                                 `OFF` là bỏ dòng của cấp trên.
//
// Đi cây bằng `unitLineage` (`lib/orgUnits.ts`).
// ============================================================================

import { unitLineage, type ResolvableUnit } from './orgUnits';
import { activeInPeriod, type MechanismRow } from './payroll';
import { referencedCodes } from './formulaTokens';
import { OWN_AMOUNT_CODE, type RowMode } from './payrollVariables';
import type {
  EmployeePayItem, PayComponent, PayrollSchemeRequest, SchemePayloadItem, SchemeRequestStatus, UnitPayItem, UnitRowMode,
} from '@/types';

export interface SchemeSourceData {
  components: readonly PayComponent[];
  unitById: Map<string, ResolvableUnit>;
  unitItems: readonly UnitPayItem[];
  employeeItems: readonly EmployeePayItem[];
}

/** Cách lấy giá trị của một dòng đơn vị đã lưu (dòng cũ chưa có cột mode thì suy ra). */
export function unitRowModeOf(item: Pick<UnitPayItem, 'mode' | 'formula'>): UnitRowMode {
  if (item.mode) return item.mode;
  return item.formula?.trim() ? 'FORMULA' : 'VALUE';
}

/** Dòng cơ chế đọc từ một dòng đơn vị (không phải OFF). */
function rowOfUnitItem(item: UnitPayItem, component: PayComponent, origin: string): MechanismRow {
  const mode = unitRowModeOf(item) as RowMode;
  return {
    component,
    mode,
    formula: mode === 'FORMULA' ? item.formula : null,
    amount: item.amount == null ? null : Number(item.amount),
    sortOrder: item.sort_order ?? component.sort_order,
    origin,
  };
}

/**
 * Áp một bản khai riêng (của đơn vị hoặc của người) lên dòng cơ chế.
 *
 *  - Có công thức → dòng tính theo công thức riêng đó.
 *  - Chỉ có con số → là giá trị riêng của dòng. Riêng dòng công thức cũ có
 *    đọc "mức riêng" (`MUC_RIENG`) thì con số đó là mức riêng, công thức giữ
 *    nguyên — đúng nghĩa lúc khai.
 *  - Đầu mục chưa có trong cơ chế → thành một dòng thêm của riêng đối tượng.
 */
export function applyOverride(
  existing: MechanismRow | undefined,
  component: PayComponent,
  override: { amount: number | null; formula: string | null },
  origin: string,
): MechanismRow {
  const formula = override.formula?.trim() || null;
  const amount = override.amount == null ? null : Number(override.amount);
  if (!existing) {
    return {
      component, mode: formula ? 'FORMULA' : 'VALUE', formula, amount,
      sortOrder: 100_000 + component.sort_order, origin,
    };
  }
  if (formula) return { ...existing, mode: 'FORMULA', formula, amount: amount ?? existing.amount, origin };
  if (amount == null) return existing;
  if (existing.mode === 'FORMULA') {
    return referencedCodes(existing.formula).includes(OWN_AMOUNT_CODE)
      ? { ...existing, amount, origin }
      : { ...existing, mode: 'VALUE', formula: null, amount, origin };
  }
  if (existing.mode === 'MONTHLY_INPUT') return { ...existing, mode: 'VALUE', amount, origin };
  return { ...existing, amount, origin };
}

/**
 * Dòng của cơ chế chung áp cho một ĐƠN VỊ: đi từ cấp cao nhất xuống đơn vị đó,
 * dòng khai lại thay dòng cấp trên, `OFF` bỏ dòng. Đầu mục đã ngừng hoạt động
 * thì bỏ.
 */
export function unitMechanismRows(
  unitId: string | null | undefined,
  data: Pick<SchemeSourceData, 'components' | 'unitById' | 'unitItems'>,
  monthStart: string,
  monthEnd: string,
): Map<string, MechanismRow> {
  const componentById = new Map(data.components.map((component) => [component.id, component]));
  const rows = new Map<string, MechanismRow>();
  for (const unit of [...unitLineage(unitId, data.unitById)].reverse()) {
    for (const item of activeInPeriod(data.unitItems.filter((row) => row.unit_id === unit.id), monthStart, monthEnd)) {
      const component = componentById.get(item.component_id);
      if (!component) continue;
      if (unitRowModeOf(item) === 'OFF') { rows.delete(component.id); continue; }
      if (!component.is_active) continue;
      rows.set(component.id, rowOfUnitItem(item, component, unit.name));
    }
  }
  return rows;
}

/**
 * Toàn bộ dòng lương áp cho một người trong tháng, mỗi dòng kèm nguồn.
 * Đầu mục đã ngừng hoạt động thì bỏ.
 */
export function resolveMechanismRows(
  person: { id: string; unit_id?: string | null },
  data: SchemeSourceData,
  monthStart: string,
  monthEnd: string,
): MechanismRow[] {
  const componentById = new Map(data.components.map((component) => [component.id, component]));
  const rows = unitMechanismRows(person.unit_id, data, monthStart, monthEnd);

  for (const item of activeInPeriod(data.employeeItems.filter((row) => row.user_id === person.id), monthStart, monthEnd)) {
    const component = componentById.get(item.component_id);
    if (!component || !component.is_active) continue;
    rows.set(component.id, applyOverride(rows.get(component.id), component, item, 'Riêng'));
  }

  return [...rows.values()].sort((a, b) => a.sortOrder - b.sortOrder);
}

/** Dòng cơ chế của một người KHÔNG gồm khai riêng — để so với khai riêng đang soạn. */
export function resolveSharedRows(
  person: { id: string; unit_id?: string | null },
  data: SchemeSourceData,
  monthStart: string,
  monthEnd: string,
): MechanismRow[] {
  return [...unitMechanismRows(person.unit_id, data, monthStart, monthEnd).values()].sort((a, b) => a.sortOrder - b.sortOrder);
}

// ---------------------------------------------------------------------------
// Đề xuất cơ chế lương
// ---------------------------------------------------------------------------

function payloadItemOf(row: {
  component_id: string; amount: number | null; formula: string | null; note: string | null;
  mode?: UnitRowMode; sort_order?: number | null;
}): SchemePayloadItem {
  return {
    component_id: row.component_id,
    amount: row.amount == null ? null : Number(row.amount),
    formula: row.formula?.trim() || null,
    note: row.note,
    ...(row.mode ? { mode: row.mode } : {}),
    ...(row.sort_order != null ? { sort_order: row.sort_order } : {}),
  };
}

/** Khai riêng của một người còn hiệu lực ở tháng — điểm xuất phát của bản đề xuất. */
export function personalItemsAt(
  employeeItems: readonly EmployeePayItem[],
  userId: string,
  monthStart: string,
  monthEnd: string,
): SchemePayloadItem[] {
  return activeInPeriod(employeeItems.filter((row) => row.user_id === userId), monthStart, monthEnd)
    .map((row) => payloadItemOf({ ...row, mode: undefined, sort_order: undefined }));
}

/** Dòng cơ chế chung KHAI TRỰC TIẾP ở một đơn vị, còn hiệu lực ở tháng (không gồm dòng thừa hưởng). */
export function unitItemsAt(
  unitItems: readonly UnitPayItem[],
  unitId: string,
  monthStart: string,
  monthEnd: string,
): SchemePayloadItem[] {
  return activeInPeriod(unitItems.filter((row) => row.unit_id === unitId), monthStart, monthEnd)
    .map((row) => payloadItemOf({ ...row, mode: unitRowModeOf(row) }));
}

export type SchemeChangeKind = 'ADDED' | 'REMOVED' | 'CHANGED' | 'SAME';

export interface SchemeItemChange {
  componentId: string;
  kind: SchemeChangeKind;
  before: SchemePayloadItem | null;
  after: SchemePayloadItem | null;
}

const sameItem = (a: SchemePayloadItem, b: SchemePayloadItem) =>
  (a.amount ?? null) === (b.amount ?? null)
  && (a.formula?.trim() || null) === (b.formula?.trim() || null)
  && (a.mode ?? null) === (b.mode ?? null);

/**
 * So khai riêng hiện hành với đề xuất, từng đầu mục một — thứ BGĐ cần nhìn
 * khi ký: thêm gì, bỏ gì, đổi số nào.
 */
export function diffSchemeItems(
  before: readonly SchemePayloadItem[],
  after: readonly SchemePayloadItem[],
): SchemeItemChange[] {
  const beforeById = new Map(before.map((item) => [item.component_id, item]));
  const afterById = new Map(after.map((item) => [item.component_id, item]));
  const ids = [...new Set([...beforeById.keys(), ...afterById.keys()])];
  return ids.map((componentId) => {
    const b = beforeById.get(componentId) ?? null;
    const a = afterById.get(componentId) ?? null;
    const kind: SchemeChangeKind = !b ? 'ADDED' : !a ? 'REMOVED' : sameItem(a, b) ? 'SAME' : 'CHANGED';
    return { componentId, kind, before: b, after: a };
  });
}

export const SCHEME_STATUS_LABEL: Record<SchemeRequestStatus, string> = {
  DRAFT: 'Nháp', SUBMITTED: 'Chờ duyệt', APPROVED: 'Đã duyệt', REJECTED: 'Bị từ chối', CANCELLED: 'Đã huỷ',
};

export const SCHEME_STATUS_TONE: Record<SchemeRequestStatus, string> = {
  DRAFT: 'bg-slate-100 text-slate-600',
  SUBMITTED: 'bg-amber-50 text-amber-700',
  APPROVED: 'bg-emerald-50 text-emerald-700',
  REJECTED: 'bg-red-50 text-red-700',
  CANCELLED: 'bg-slate-100 text-slate-400',
};

/** Đề xuất còn mở (nháp / chờ duyệt / bị từ chối) của một đối tượng — mỗi đối tượng tối đa một. */
export function openRequestFor(
  requests: readonly PayrollSchemeRequest[],
  target: { type: 'USER'; id: string } | { type: 'UNIT'; id: string },
): PayrollSchemeRequest | null {
  return requests.find((request) => request.target_type === target.type
    && (target.type === 'USER' ? request.user_id === target.id : request.unit_id === target.id)
    && (request.status === 'DRAFT' || request.status === 'SUBMITTED' || request.status === 'REJECTED')) ?? null;
}

/**
 * Tháng sớm nhất một đề xuất mới được áp: sau kỳ đã chốt, và không chen vào
 * TRƯỚC một phiên bản đã có hiệu lực sau đó (cùng tháng thì được — đề xuất
 * thay hẳn phiên bản tháng đó). Database kiểm lại đúng hai điều này.
 */
export function earliestSchemeMonth(firstEditable: string, ownEffectiveDates: readonly string[]): string {
  const latest = [...ownEffectiveDates].sort().at(-1);
  if (!latest) return firstEditable;
  let floor = latest;
  if (!latest.endsWith('-01')) {
    const [year, month] = latest.split('-').map(Number);
    const next = new Date(year, month, 1);
    floor = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-01`;
  }
  return floor > firstEditable ? floor : firstEditable;
}
