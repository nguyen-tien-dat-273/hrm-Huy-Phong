// ============================================================================
// Cơ chế lương của một người.
// ----------------------------------------------------------------------------
// Mỗi người có danh sách dòng của riêng mình (employee_pay_items) — cùng kiểu
// dòng với bộ cơ chế mẫu (payroll_scheme_items): đầu mục + cách lấy giá trị +
// công thức + thứ tự. Không còn lớp thừa hưởng theo đơn vị; bộ mẫu chỉ là nơi
// SAO CHÉP dòng sang người, không liên kết sau khi chép.
// ============================================================================

import { activeInPeriod, type MechanismRow } from './payroll';
import type { RowMode } from './payrollVariables';
import type {
  EmployeePayItem, PayComponent, PayrollSchemeRequest, SchemePayloadItem, SchemeRequestStatus, UnitRowMode,
} from '@/types';

export interface SchemeSourceData {
  components: readonly PayComponent[];
  employeeItems: readonly EmployeePayItem[];
}

/** Cách lấy giá trị của một dòng đã lưu (dòng cũ chưa có cột mode thì suy ra). */
export function rowModeOf(item: { mode?: string | null; formula?: string | null }): RowMode {
  if (item.mode && item.mode !== 'OFF') return item.mode as RowMode;
  return item.formula?.trim() ? 'FORMULA' : 'VALUE';
}

/** Dòng cơ chế đọc từ một dòng đã lưu của người hoặc của bộ mẫu. */
export function mechanismRowOf(
  item: { mode?: string | null; formula: string | null; amount: number | null; sort_order: number | null },
  component: PayComponent,
  origin: string,
): MechanismRow {
  const mode = rowModeOf(item);
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
 * Toàn bộ dòng lương của một người trong tháng, theo thứ tự trên phiếu.
 * Đầu mục đã ngừng hoạt động thì bỏ.
 */
export function resolveMechanismRows(
  person: { id: string },
  data: SchemeSourceData,
  monthStart: string,
  monthEnd: string,
): MechanismRow[] {
  const componentById = new Map(data.components.map((component) => [component.id, component]));
  const rows = new Map<string, MechanismRow>();
  for (const item of activeInPeriod(data.employeeItems.filter((row) => row.user_id === person.id), monthStart, monthEnd)) {
    const component = componentById.get(item.component_id);
    if (!component || !component.is_active) continue;
    rows.set(component.id, mechanismRowOf(item, component, 'Riêng'));
  }
  return [...rows.values()].sort((a, b) => a.sortOrder - b.sortOrder || a.component.sort_order - b.component.sort_order);
}

/** Dòng còn trống: "mỗi người một mức" chưa có số, hoặc công thức để trống. */
export function blankMechanismRows(rows: readonly MechanismRow[]): MechanismRow[] {
  return rows.filter((row) => (row.mode === 'PER_PERSON' && row.amount == null)
    || (row.mode === 'FORMULA' && !row.formula?.trim() && row.amount == null));
}

/** "Thiếu Lương cơ bản, Mức KPI" — gọi đúng tên, quá nhiều thì rút gọn. */
export function missingLabel(names: readonly string[], max = 2): string {
  if (names.length <= max) return `Thiếu ${names.join(', ')}`;
  return `Thiếu ${names.slice(0, max).join(', ')} +${names.length - max}`;
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

/** Dòng cơ chế của một người còn hiệu lực ở tháng — điểm xuất phát của bản đang soạn. */
export function personalItemsAt(
  employeeItems: readonly EmployeePayItem[],
  userId: string,
  monthStart: string,
  monthEnd: string,
): SchemePayloadItem[] {
  return activeInPeriod(employeeItems.filter((row) => row.user_id === userId), monthStart, monthEnd)
    .map((row) => payloadItemOf({ ...row, mode: row.mode ?? (row.formula?.trim() ? 'FORMULA' : 'VALUE') }));
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
