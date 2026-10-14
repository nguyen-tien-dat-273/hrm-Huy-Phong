// ============================================================================
// Cơ chế lương của một người, giải theo CÂY tổ chức (F06.03).
// ----------------------------------------------------------------------------
// Một khoản lương của một người có thể đến từ ba lớp, lớp trên thắng lớp dưới
// cho CÙNG một khoản:
//
//   1. Khai riêng cho người          (employee_pay_items)
//   2. Khoản chung của đơn vị        (unit_pay_items) — đơn vị GẦN NHẤT trên
//                                     cây thắng, rồi mới tới cấp trên
//   3. Mẫu bảng lương của khối       (payroll_template_items) — BL 01 / BL 02,
//                                     mẫu gán riêng cho người thắng mẫu của
//                                     đơn vị gần nhất
//
// Đi cây bằng đúng `unitLineage` mà KPI đang dùng (`lib/kpiSchemeFor.ts`):
// cùng giới hạn 10 cấp, cùng cách chặn vòng cha-con. Hai phân hệ gán theo cây
// mà hiểu "thừa hưởng" theo hai kiểu khác nhau là chỗ để người dùng nhầm.
//
// Bản trước chỉ khớp khoản của đúng `unit_id` của người — khoản khai ở Khối
// không xuống tới phòng con. Hồi đó cơ cấu khách hàng phẳng nên không lộ;
// giờ cây là Doanh nghiệp > Khối > Phòng ban (ENT-01) và công thức BL đặt theo
// khối (BR-PAY-002) thì phải đi cây.
//
// Bản database tương ứng: `payroll_template_for(uuid, date)`.
// ============================================================================

import { unitLineage, type ResolvableUnit } from './kpiSchemeFor';
import { itemsForPeriod, type AssignedPayItem, type PayItemAssignment } from './payroll';
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
  /** 'PERSONAL' = gán riêng; 'UNIT' = thừa hưởng từ đơn vị; null = không có mẫu. */
  source: 'PERSONAL' | 'UNIT' | null;
  fromUnit: ResolvableUnit | null;
  /** Nhãn ngắn hiện lên màn, ví dụ "BL02 · theo Khối Kinh doanh". */
  label: string;
}

/**
 * Mẫu bảng lương đang áp cho một người trong tháng.
 *
 * Đơn vị khai "không áp mẫu" (template_id NULL) là CHẶN thừa hưởng: người
 * trong đơn vị đó không có mẫu nào, kể cả khi cấp trên có.
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
      label: template ? `${template.code} · gán riêng` : 'Mẫu gán riêng đã bị xoá',
    };
  }

  for (const unit of unitLineage(person.unit_id, data.unitById)) {
    const row = data.unitTemplates
      .filter((entry) => entry.unit_id === unit.id && entry.effective_from <= monthStart)
      .sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0];
    if (!row) continue;
    if (!row.template_id) {
      return { template: null, source: 'UNIT', fromUnit: unit, label: `Không áp mẫu (chặn tại ${unit.name})` };
    }
    const template = templateById.get(row.template_id) ?? null;
    return {
      template, source: 'UNIT', fromUnit: unit,
      label: template ? `${template.code} · theo ${unit.name}` : 'Mẫu đã bị xoá',
    };
  }

  return { template: null, source: null, fromUnit: null, label: 'Chưa có mẫu bảng lương' };
}

/** Mẫu áp cho một ĐƠN VỊ (để vẽ cây): của chính nó hoặc cấp trên gần nhất. */
export function resolveTemplateForUnit(
  unitId: string,
  data: Pick<SchemeSourceData, 'templates' | 'unitTemplates' | 'unitById'>,
  monthStart: string,
): ResolvedTemplate {
  return resolveTemplateFor({ id: '', unit_id: unitId }, null, data, monthStart);
}

function assignmentOf(row: {
  component_id: string; amount: number | null; formula: string | null;
  taxable?: boolean | null; insurable?: boolean | null; is_base?: boolean | null;
  effective_from: string; effective_to: string | null;
}): PayItemAssignment {
  return {
    component_id: row.component_id,
    amount: row.amount == null ? null : Number(row.amount),
    formula: row.formula,
    taxable: row.taxable ?? null,
    insurable: row.insurable ?? null,
    is_base: row.is_base ?? null,
    effective_from: row.effective_from,
    effective_to: row.effective_to,
  };
}

/**
 * Toàn bộ khoản lương áp cho một người trong tháng, mỗi khoản kèm nhãn nguồn.
 *
 * Bỏ khoản ngừng hoạt động (`itemsForPeriod`) và khoản do engine tự tính —
 * database đã chặn gán chúng, đây là lớp phòng thủ cuối.
 */
export function resolvePayItems(
  person: { id: string; unit_id?: string | null },
  payProfile: Pick<EmployeePayProfile, 'template_id'> | null,
  data: SchemeSourceData,
  monthStart: string,
  monthEnd: string,
): AssignedPayItem[] {
  const componentById = new Map(data.components.map((component) => [component.id, component]));
  const toAssigned = (
    rows: ReadonlyArray<Parameters<typeof assignmentOf>[0]>,
    origin: string,
  ): AssignedPayItem[] => rows
    .map((row) => ({ item: assignmentOf(row), component: componentById.get(row.component_id), origin }))
    .filter((entry): entry is AssignedPayItem & { origin: string } => !!entry.component)
    .filter((entry) => entry.component.calc_source !== 'ENGINE');

  const byComponent = new Map<string, AssignedPayItem>();

  // Lớp 3 — mẫu bảng lương.
  const template = resolveTemplateFor(person, payProfile, data, monthStart).template;
  if (template && template.is_active) {
    const rows = data.templateItems.filter((row) => row.template_id === template.id);
    for (const entry of itemsForPeriod(toAssigned(rows, `Mẫu ${template.code}`), monthStart, monthEnd)) {
      byComponent.set(entry.item.component_id, entry);
    }
  }

  // Lớp 2 — khoản chung của đơn vị, đi từ CẤP CAO NHẤT xuống đơn vị của người
  // đó để đơn vị gần nhất ghi đè sau cùng.
  const lineage = unitLineage(person.unit_id, data.unitById);
  for (const unit of [...lineage].reverse()) {
    const rows = data.unitItems.filter((row) => row.unit_id === unit.id);
    for (const entry of itemsForPeriod(toAssigned(rows, unit.name), monthStart, monthEnd)) {
      byComponent.set(entry.item.component_id, entry);
    }
  }

  // Lớp 1 — khai riêng.
  const own = data.employeeItems.filter((row) => row.user_id === person.id);
  for (const entry of itemsForPeriod(toAssigned(own, 'Riêng'), monthStart, monthEnd)) {
    byComponent.set(entry.item.component_id, entry);
  }

  return [...byComponent.values()];
}

// ---------------------------------------------------------------------------
// Đề xuất cơ chế lương (F06.03)
// ---------------------------------------------------------------------------

/** Khoản KHAI RIÊNG của một người còn hiệu lực ở tháng — điểm xuất phát của bản đề xuất. */
export function personalItemsAt(
  employeeItems: readonly EmployeePayItem[],
  userId: string,
  monthStart: string,
  monthEnd: string,
): SchemePayloadItem[] {
  return employeeItems
    .filter((row) => row.user_id === userId
      && row.effective_from <= monthEnd
      && (!row.effective_to || row.effective_to >= monthStart))
    .map((row) => ({
      component_id: row.component_id,
      amount: row.amount == null ? null : Number(row.amount),
      formula: row.formula,
      taxable: row.taxable,
      insurable: row.insurable,
      is_base: row.is_base,
      note: row.note,
    }));
}

/** Khoản chung của một đơn vị còn hiệu lực ở tháng. */
export function unitItemsAt(
  unitItems: readonly UnitPayItem[],
  unitId: string,
  monthStart: string,
  monthEnd: string,
): SchemePayloadItem[] {
  return unitItems
    .filter((row) => row.unit_id === unitId
      && row.effective_from <= monthEnd
      && (!row.effective_to || row.effective_to >= monthStart))
    .map((row) => ({
      component_id: row.component_id,
      amount: row.amount == null ? null : Number(row.amount),
      formula: row.formula,
      note: row.note,
    }));
}

export function profilePayloadOf(
  current: EmployeePayProfile | null,
  fallbackFlatTaxRate: number,
): SchemePayloadProfile {
  return {
    dependents: current?.dependents ?? 0,
    insurance_enabled: current?.insurance_enabled ?? true,
    insurance_base: current?.insurance_base == null ? null : Number(current.insurance_base),
    tax_mode: current?.tax_mode ?? 'PROGRESSIVE',
    flat_tax_rate: current?.flat_tax_rate == null ? fallbackFlatTaxRate : Number(current.flat_tax_rate),
    standard_days_override: current?.standard_days_override == null ? null : Number(current.standard_days_override),
    template_id: current?.template_id ?? null,
  };
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
  && (a.taxable ?? null) === (b.taxable ?? null)
  && (a.insurable ?? null) === (b.insurable ?? null)
  && (a.is_base ?? null) === (b.is_base ?? null);

/**
 * So cơ chế hiện hành với đề xuất, từng khoản một — thứ BGĐ cần nhìn khi ký:
 * thêm gì, bỏ gì, đổi mức nào, chứ không phải đọc lại cả cơ chế.
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

/** Mức lương cơ bản (khoản lương gốc) của một bản cơ chế, nếu có khai mức. */
export function baseAmountOf(
  items: readonly SchemePayloadItem[],
  components: readonly PayComponent[],
): number | null {
  const componentById = new Map(components.map((component) => [component.id, component]));
  const base = items.find((item) => item.is_base ?? componentById.get(item.component_id)?.is_base);
  return base?.amount ?? null;
}
