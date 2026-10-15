// ============================================================================
// Danh sách thứ gõ được vào ô công thức của một cơ chế lương.
// ----------------------------------------------------------------------------
// Một chỗ dựng cho mọi màn có ô công thức (thiết kế cơ chế, khai riêng cho một
// người), để cùng một tham số mang cùng một tên và cùng nhóm ở mọi nơi.
// ============================================================================

import type { FormulaEntry } from './formulaTokens';
import { formatFormulaNumber } from './formulaTokens';
import { paramsOf, tierTablesOf, type PayrollParamVersion } from './payrollSettings';
import {
  BUILTIN_FUNCTIONS, OWN_AMOUNT_CODE, OWN_AMOUNT_HINT, OWN_AMOUNT_NAME, PARAM_UNIT_LABEL, SYSTEM_VARIABLES, formatWithUnit,
} from './payrollVariables';
import type { PayComponent, PayComponentKind } from '@/types';

export const KIND_SIGN: Record<PayComponentKind, string> = {
  EARNING: '+', DEDUCTION: '−', INFO: '·', EMPLOYER_COST: '◦',
};

export const KIND_LABEL: Record<PayComponentKind, string> = {
  EARNING: 'Cộng vào lương',
  DEDUCTION: 'Trừ khỏi lương',
  INFO: 'Chỉ để tính',
  EMPLOYER_COST: 'Doanh nghiệp chi',
};

export function buildFormulaEntries(args: {
  /** Đầu mục đang có trong cơ chế. */
  rowComponents: readonly PayComponent[];
  /** Toàn bộ danh mục — đầu mục chưa có trong cơ chế thành gợi ý "Thêm từ danh mục". */
  catalog: readonly PayComponent[];
  version: PayrollParamVersion | null;
  /** Giá trị thử của từng đầu mục, hiện bên phải gợi ý. */
  sampleValues?: Readonly<Record<string, number>>;
  /** Dòng đang khai — không tự tham chiếu chính nó. */
  excludeCode?: string | null;
  /** Có gợi ý thêm đầu mục mới vào cơ chế không. */
  includeCatalog?: boolean;
}): FormulaEntry[] {
  const { rowComponents, catalog, version, sampleValues = {}, excludeCode = null, includeCatalog = true } = args;
  const inMechanism = new Set(rowComponents.map((component) => component.code));
  const entries: FormulaEntry[] = [];

  for (const component of rowComponents) {
    if (component.code === excludeCode) continue;
    const sample = sampleValues[component.code];
    entries.push({
      code: component.code,
      name: component.name,
      group: 'ROW',
      detail: sample === undefined ? KIND_LABEL[component.kind] : formatFormulaNumber(sample),
      hint: KIND_LABEL[component.kind],
    });
  }
  for (const param of paramsOf(version)) {
    entries.push({
      code: param.code,
      name: param.name,
      group: 'PARAM',
      section: param.tableName,
      detail: formatWithUnit(param.value, param.unit),
      hint: `Tham số · bảng ${param.tableName}`,
    });
  }
  for (const variable of SYSTEM_VARIABLES) {
    entries.push({
      code: variable.code,
      name: variable.name,
      group: 'SYSTEM',
      detail: variable.unit ? PARAM_UNIT_LABEL[variable.unit] : undefined,
      hint: variable.hint,
      ...(variable.hidden ? { hidden: true } : {}),
    });
  }
  entries.push({ code: OWN_AMOUNT_CODE, name: OWN_AMOUNT_NAME, group: 'SYSTEM', hint: OWN_AMOUNT_HINT, hidden: true });
  for (const table of tierTablesOf(version)) {
    entries.push({
      code: table.code,
      name: table.name,
      group: 'TIER',
      isFunction: true,
      detail: table.mode === 'PROGRESSIVE' ? 'lũy tiến' : 'tra bậc',
      hint: table.inputLabel ? `Đưa vào: ${table.inputLabel}` : 'Bảng bậc thang',
    });
  }
  for (const fn of BUILTIN_FUNCTIONS) {
    entries.push({ code: fn.code, name: fn.name, group: 'FUNCTION', isFunction: true, hint: fn.hint });
  }
  if (includeCatalog) {
    for (const component of catalog) {
      if (!component.is_active || inMechanism.has(component.code) || component.code === excludeCode) continue;
      entries.push({
        code: component.code,
        name: component.name,
        group: 'CATALOG',
        componentId: component.id,
        detail: 'thêm vào cơ chế',
        hint: KIND_LABEL[component.kind],
      });
    }
  }
  return entries;
}

/** Tên hiển thị theo mã, dựng từ danh sách gợi ý. */
export function entryNameMap(entries: readonly FormulaEntry[]): Map<string, string> {
  return new Map(entries.map((entry) => [entry.code, entry.name]));
}
