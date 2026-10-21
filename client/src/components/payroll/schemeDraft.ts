// Dòng cơ chế đang soạn — dùng chung cho cơ chế của một người và bộ cơ chế mẫu
// (cùng một kiểu dòng nên sao chép qua lại không cần đổi dạng).
//
// Trên màn hình mỗi dòng chỉ có hai cách lấy số: gõ công thức (hoặc một con số)
// hoặc "theo tháng" (nhập ngay trên Bảng lương). Dòng lưu kiểu "số cố định" /
// "mỗi người một mức" được đọc lên thành công thức một con số.

import type { MechanismRow } from '@/lib/payroll';
import type { PayComponent, SchemePayloadItem } from '@/types';

export interface SchemeDraftRow {
  componentId: string;
  mode: 'FORMULA' | 'MONTHLY_INPUT';
  /** Công thức, hoặc một con số cố định. */
  formula: string;
  /** Giữ nguyên cho công thức cũ có đọc "mức riêng". */
  amount: number | null;
  sortOrder: number | null;
}

interface StoredRow {
  mode?: string | null;
  formula: string | null;
  amount: number | null;
  sort_order: number | null;
}

const numberText = (value: number | null | undefined) => (value == null ? '' : String(Number(value)));

/** Một dòng đã lưu (của người hoặc của bộ mẫu) → dòng đang soạn. */
export function draftOfStored(componentId: string, item: StoredRow): SchemeDraftRow {
  const base = { componentId, sortOrder: item.sort_order ?? null };
  if (item.mode === 'MONTHLY_INPUT') return { ...base, mode: 'MONTHLY_INPUT', formula: '', amount: null };
  const formula = item.formula?.trim() ?? '';
  if (item.mode === 'FORMULA' || (!item.mode && formula)) {
    return { ...base, mode: 'FORMULA', formula: formula || numberText(item.amount), amount: formula ? item.amount : null };
  }
  // VALUE / PER_PERSON: một con số.
  return { ...base, mode: 'FORMULA', formula: numberText(item.amount), amount: null };
}

export const draftOfPayload = (item: SchemePayloadItem): SchemeDraftRow => draftOfStored(item.component_id, {
  mode: item.mode, formula: item.formula, amount: item.amount, sort_order: item.sort_order ?? null,
});

/** Dòng cơ chế đã giải (của một người) → dòng đang soạn. */
export const draftOfMechanism = (row: MechanismRow): SchemeDraftRow => draftOfStored(row.component.id, {
  mode: row.mode, formula: row.formula, amount: row.amount, sort_order: row.sortOrder,
});

/**
 * Dòng đang soạn → dòng lưu. Bộ mẫu (`blankAsPerPerson`) được để trống ô công
 * thức: lưu thành "mỗi người một mức", ai copy về thì phải điền số của mình.
 */
export function payloadOfDraft(rows: readonly SchemeDraftRow[], options: { blankAsPerPerson?: boolean } = {}): SchemePayloadItem[] {
  return rows.map((row) => (options.blankAsPerPerson && row.mode === 'FORMULA' && !row.formula.trim() ? {
    component_id: row.componentId,
    mode: 'PER_PERSON' as const,
    formula: null,
    amount: null,
    sort_order: row.sortOrder,
    note: null,
  } : {
    component_id: row.componentId,
    mode: row.mode,
    formula: row.mode === 'FORMULA' ? row.formula.trim() || null : null,
    amount: row.mode === 'FORMULA' ? row.amount : null,
    sort_order: row.sortOrder,
    note: null,
  }));
}

/** Thứ tự hiện trên phiếu: dòng chưa có thứ tự riêng theo danh mục. */
export function orderOfDraft(row: SchemeDraftRow, component: PayComponent | undefined): number {
  return row.sortOrder ?? component?.sort_order ?? 0;
}

export function sortDraft(rows: readonly SchemeDraftRow[], componentById: ReadonlyMap<string, PayComponent>): SchemeDraftRow[] {
  return [...rows].sort((a, b) => orderOfDraft(a, componentById.get(a.componentId)) - orderOfDraft(b, componentById.get(b.componentId)));
}

/** Hai bản soạn giống nhau về nội dung (bỏ qua thứ tự khai trong mảng). */
export function sameDraft(a: readonly SchemeDraftRow[], b: readonly SchemeDraftRow[]): boolean {
  const key = (rows: readonly SchemeDraftRow[]) => JSON.stringify(
    [...rows].map((row) => [row.componentId, row.mode, row.formula.trim(), row.amount, row.sortOrder]).sort(),
  );
  return key(a) === key(b);
}
