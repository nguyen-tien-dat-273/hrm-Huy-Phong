// ============================================================================
// Cơ chế lương của một người, giải theo CÂY tổ chức.
// ----------------------------------------------------------------------------
// Dòng lương của một người đến từ ba lớp, lớp trên thắng lớp dưới cho CÙNG một
// đầu mục:
//
//   1. Khai riêng cho người          (employee_pay_items)
//   2. Giá trị chung của đơn vị      (unit_pay_items) — đơn vị GẦN NHẤT trên
//                                     cây thắng, rồi mới tới cấp trên
//   3. Cơ chế lương                  (payroll_templates + _items) — cơ chế gán
//                                     riêng cho người thắng cơ chế của đơn vị
//                                     gần nhất
//
// Lớp 1 và 2 không tạo cơ chế mới: chúng KHAI GIÁ TRỊ cho dòng "Từng người" /
// "Giá trị", hoặc đổi riêng công thức của một dòng. Đầu mục chưa có trong cơ
// chế mà vẫn khai riêng thì thành một dòng thêm của riêng người đó.
//
// Đi cây bằng đúng `unitLineage` mà KPI đang dùng (`lib/kpiSchemeFor.ts`).
// Bản database tương ứng: `payroll_template_for(uuid, date)`.
// ============================================================================

import { unitLineage, type ResolvableUnit } from './kpiSchemeFor';
import { activeInPeriod, type MechanismRow } from './payroll';
import { referencedCodes } from './formulaTokens';
import { OWN_AMOUNT_CODE, type RowMode } from './payrollVariables';
import type {
  EmployeePayItem, EmployeePayProfile, PayComponent, PayrollSchemeRequest, PayrollTemplate, PayrollTemplateItem,
  SchemePayloadItem, SchemePayloadProfile, SchemeRequestStatus, UnitPayItem, UnitPayrollTemplate,
} from '@/types';

export interface SchemeSourceData {
  components: readonly PayComponent[];
  unitById: Map<string, ResolvableUnit>;
  templates: readonly PayrollTemplate[];
  templateItems: readonly PayrollTemplateItem[];
  unitTemplates: readonly UnitPayrollTemplate[];
  unitItems: readonly UnitPayItem[];
  employeeItems: readonly EmployeePayItem[];
}

export interface ResolvedTemplate {
  template: PayrollTemplate | null;
  /** 'PERSONAL' = gán riêng; 'UNIT' = thừa hưởng từ đơn vị; null = không có cơ chế. */
  source: 'PERSONAL' | 'UNIT' | null;
  fromUnit: ResolvableUnit | null;
  /** Nhãn ngắn hiện lên màn, ví dụ "Khối Kinh doanh · theo Phòng KD1". */
  label: string;
}

/**
 * Cơ chế đang áp cho một người trong tháng.
 *
 * Đơn vị khai "không áp cơ chế" (template_id NULL) là CHẶN thừa hưởng: người
 * trong đơn vị đó không có cơ chế nào, kể cả khi cấp trên có.
 */
export function resolveTemplateFor(
  person: { id: string; unit_id?: string | null },
  payProfile: Pick<EmployeePayProfile, 'template_id'> | null,
  data: Pick<SchemeSourceData, 'templates' | 'unitTemplates' | 'unitById'>,
  monthStart: string,
): ResolvedTemplate {
  const templateById = new Map(data.templates.map((template) => [template.id, template]));

  if (payProfile?.template_id) {
    const template = templateById.get(payProfile.template_id) ?? null;
    return {
      template, source: 'PERSONAL', fromUnit: null,
      label: template ? `${template.name} · gán riêng` : 'Cơ chế gán riêng đã bị xoá',
    };
  }

  for (const unit of unitLineage(person.unit_id, data.unitById)) {
    const row = data.unitTemplates
      .filter((entry) => entry.unit_id === unit.id && entry.effective_from <= monthStart)
      .sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0];
    if (!row) continue;
    if (!row.template_id) {
      return { template: null, source: 'UNIT', fromUnit: unit, label: `Không áp cơ chế (chặn tại ${unit.name})` };
    }
    const template = templateById.get(row.template_id) ?? null;
    return {
      template, source: 'UNIT', fromUnit: unit,
      label: template ? `${template.name} · theo ${unit.name}` : 'Cơ chế đã bị xoá',
    };
  }

  return { template: null, source: null, fromUnit: null, label: 'Chưa có cơ chế lương' };
}

/** Cơ chế áp cho một ĐƠN VỊ (để vẽ cây): của chính nó hoặc cấp trên gần nhất. */
export function resolveTemplateForUnit(
  unitId: string,
  data: Pick<SchemeSourceData, 'templates' | 'unitTemplates' | 'unitById'>,
  monthStart: string,
): ResolvedTemplate {
  return resolveTemplateFor({ id: '', unit_id: unitId }, null, data, monthStart);
}

/** Dòng của một cơ chế còn hiệu lực trong tháng, đúng thứ tự hiện trên phiếu. */
export function templateRowsAt(
  templateItems: readonly PayrollTemplateItem[],
  templateId: string,
  monthStart: string,
  monthEnd: string,
): PayrollTemplateItem[] {
  return activeInPeriod(templateItems.filter((item) => item.template_id === templateId), monthStart, monthEnd)
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
}

/** Cách lấy giá trị của một dòng cơ chế đã lưu (dòng cũ chưa có cột mode thì suy ra). */
export function rowModeOf(item: Pick<PayrollTemplateItem, 'mode' | 'formula'>): RowMode {
  if (item.mode) return item.mode;
  return item.formula?.trim() ? 'FORMULA' : 'VALUE';
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
 * Toàn bộ dòng lương áp cho một người trong tháng, mỗi dòng kèm nguồn.
 * Đầu mục đã ngừng hoạt động thì bỏ.
 */
export function resolveMechanismRows(
  person: { id: string; unit_id?: string | null },
  payProfile: Pick<EmployeePayProfile, 'template_id'> | null,
  data: SchemeSourceData,
  monthStart: string,
  monthEnd: string,
): MechanismRow[] {
  const componentById = new Map(data.components.map((component) => [component.id, component]));
  const rows = new Map<string, MechanismRow>();

  // Lớp 3 — cơ chế.
  const template = resolveTemplateFor(person, payProfile, data, monthStart).template;
  if (template && template.is_active) {
    for (const item of templateRowsAt(data.templateItems, template.id, monthStart, monthEnd)) {
      const component = componentById.get(item.component_id);
      if (!component || !component.is_active) continue;
      rows.set(component.id, {
        component,
        mode: rowModeOf(item),
        formula: item.formula,
        amount: item.amount == null ? null : Number(item.amount),
        sortOrder: item.sort_order ?? component.sort_order,
        origin: template.name,
      });
    }
  }

  const apply = (items: ReadonlyArray<{ component_id: string; amount: number | null; formula: string | null }>, origin: string) => {
    for (const item of items) {
      const component = componentById.get(item.component_id);
      if (!component || !component.is_active) continue;
      rows.set(component.id, applyOverride(rows.get(component.id), component, item, origin));
    }
  };

  // Lớp 2 — giá trị chung của đơn vị, đi từ CẤP CAO NHẤT xuống đơn vị của người
  // đó để đơn vị gần nhất ghi đè sau cùng.
  const lineage = unitLineage(person.unit_id, data.unitById);
  for (const unit of [...lineage].reverse()) {
    apply(activeInPeriod(data.unitItems.filter((row) => row.unit_id === unit.id), monthStart, monthEnd), unit.name);
  }

  // Lớp 1 — khai riêng.
  apply(activeInPeriod(data.employeeItems.filter((row) => row.user_id === person.id), monthStart, monthEnd), 'Riêng');

  return [...rows.values()].sort((a, b) => a.sortOrder - b.sortOrder);
}

/** Dòng cơ chế của một ĐƠN VỊ (không gồm khai riêng của chính đơn vị đó) — để xem khi khai giá trị chung. */
export function resolveUnitRows(
  unitId: string,
  data: SchemeSourceData,
  monthStart: string,
  monthEnd: string,
): MechanismRow[] {
  return resolveMechanismRows(
    { id: '', unit_id: unitId },
    null,
    { ...data, unitItems: data.unitItems.filter((row) => row.unit_id !== unitId), employeeItems: [] },
    monthStart,
    monthEnd,
  );
}

// ---------------------------------------------------------------------------
// Đề xuất cơ chế lương
// ---------------------------------------------------------------------------

function payloadItemOf(row: { component_id: string; amount: number | null; formula: string | null; note: string | null }): SchemePayloadItem {
  return {
    component_id: row.component_id,
    amount: row.amount == null ? null : Number(row.amount),
    formula: row.formula?.trim() || null,
    note: row.note,
  };
}

/** Khai riêng của một người còn hiệu lực ở tháng — điểm xuất phát của bản đề xuất. */
export function personalItemsAt(
  employeeItems: readonly EmployeePayItem[],
  userId: string,
  monthStart: string,
  monthEnd: string,
): SchemePayloadItem[] {
  return activeInPeriod(employeeItems.filter((row) => row.user_id === userId), monthStart, monthEnd).map(payloadItemOf);
}

/** Giá trị chung của một đơn vị còn hiệu lực ở tháng. */
export function unitItemsAt(
  unitItems: readonly UnitPayItem[],
  unitId: string,
  monthStart: string,
  monthEnd: string,
): SchemePayloadItem[] {
  return activeInPeriod(unitItems.filter((row) => row.unit_id === unitId), monthStart, monthEnd).map(payloadItemOf);
}

export function profilePayloadOf(current: Pick<EmployeePayProfile, 'template_id'> | null): SchemePayloadProfile {
  return { template_id: current?.template_id ?? null };
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
  && (a.formula?.trim() || null) === (b.formula?.trim() || null);

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
  DRAFT: 'Nháp', SUBMITTED: 'Chờ BGĐ duyệt', APPROVED: 'Đã duyệt', REJECTED: 'Bị từ chối', CANCELLED: 'Đã huỷ',
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
