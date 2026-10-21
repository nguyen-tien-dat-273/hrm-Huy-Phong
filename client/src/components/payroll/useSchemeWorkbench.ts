// Tính thử cho màn soạn cơ chế: dòng đang soạn → kết quả từng dòng, phạm vi biến
// để kiểm tra công thức, và danh sách dòng chưa hợp lệ. Dùng chung cho cơ chế của
// một người (có số liệu thật của người đó) và bộ cơ chế mẫu (nhân viên mẫu đi đủ công).

import { useMemo } from 'react';
import { formulaScopeOf, fullMonthStats, monthEndOf } from '@/components/payroll/schemeWorkbench';
import type { SchemeDraftRow } from '@/components/payroll/schemeDraft';
import { useAppSettings } from '@/contexts/SettingsContext';
import { computePayslip, orderMechanismRows, type ComputedPayslip, type MechanismRow } from '@/lib/payroll';
import { formulaIssueOf, tokenizeFormula } from '@/lib/formulaTokens';
import { computeForPerson, nameResolver, paramsForMonth } from '@/lib/payrollRun';
import { versionForMonth } from '@/lib/payrollSettings';
import type { PayrollWorkspace } from '@/lib/payrollData';
import type { Profile } from '@/types';

export function useSchemeWorkbench(args: {
  data: PayrollWorkspace;
  month: string;
  rows: readonly SchemeDraftRow[];
  /** Có người thì tính bằng số liệu tháng của người đó; không thì nhân viên mẫu. */
  person?: Profile | null;
  /** Bộ mẫu: ô trống là "điền riêng cho từng người", không phải lỗi. */
  allowBlank?: boolean;
}) {
  const { data, month, rows, person = null, allowBlank = false } = args;
  const app = useAppSettings();
  const monthEnd = monthEndOf(month);

  const componentById = useMemo(() => new Map(data.components.map((component) => [component.id, component])), [data.components]);
  const version = useMemo(() => versionForMonth(data.paramVersions, month), [data.paramVersions, month]);
  const params = useMemo(() => paramsForMonth(data, app, new Date(`${month}T00:00:00`), month), [app, data, month]);
  const nameOf = useMemo(() => nameResolver(data.components, params), [data.components, params]);

  const mechanismRows: MechanismRow[] = useMemo(() => rows.flatMap((row, index) => {
    const component = componentById.get(row.componentId);
    if (!component) return [];
    const blank = allowBlank && row.mode === 'FORMULA' && !row.formula.trim();
    return [{
      component,
      mode: blank ? 'PER_PERSON' : row.mode,
      formula: row.mode === 'FORMULA' ? row.formula.trim() || null : null,
      amount: row.amount,
      sortOrder: row.sortOrder ?? component.sort_order ?? index,
      origin: person ? 'Riêng' : 'Mẫu',
    } satisfies MechanismRow];
  }).sort((a, b) => a.sortOrder - b.sortOrder), [allowBlank, componentById, person, rows]);

  const result: ComputedPayslip | null = useMemo(() => {
    if (!params || mechanismRows.length === 0) return null;
    try {
      if (person) {
        return computeForPerson(person, data, params, new Date(`${month}T00:00:00`), month, monthEnd, {
          statsOverride: fullMonthStats(params),
          rowsOverride: mechanismRows,
        }).computed;
      }
      return computePayslip({
        profile: { id: 'sample', name: 'Nhân viên mẫu' },
        rows: mechanismRows,
        stats: fullMonthStats(params),
        params,
        inputs: {},
        catalogCodes: data.components.map((component) => component.code),
        nameOf,
      });
    } catch {
      return null;
    }
  }, [data, mechanismRows, month, monthEnd, nameOf, params, person]);

  const scope = useMemo(() => formulaScopeOf(data.components, params, result), [data.components, params, result]);
  const rowCodes = useMemo(() => new Set(mechanismRows.map((row) => row.component.code)), [mechanismRows]);
  const softCodes = useMemo(
    () => new Set(data.components.filter((component) => !rowCodes.has(component.code)).map((component) => component.code)),
    [data.components, rowCodes],
  );
  const { cyclic } = useMemo(() => orderMechanismRows(mechanismRows), [mechanismRows]);

  /** Vì sao một dòng chưa hợp lệ (null = ổn). */
  const issueOf = (row: SchemeDraftRow): string | null => {
    if (row.mode !== 'FORMULA') return null;
    const component = componentById.get(row.componentId);
    if (component && cyclic.has(component.code)) return 'Dòng này nằm trong một vòng lặp công thức.';
    if (!row.formula.trim()) return allowBlank ? null : 'Chưa điền — gõ một con số hoặc công thức.';
    const issue = formulaIssueOf(tokenizeFormula(row.formula), scope, params?.functions ?? {}, nameOf);
    return issue ? issue.message : null;
  };
  const issueCount = rows.filter((row) => issueOf(row)).length;

  return {
    componentById, version, params, nameOf, mechanismRows, result, scope, softCodes, cyclic, issueOf, issueCount,
  };
}

export type SchemeWorkbench = ReturnType<typeof useSchemeWorkbench>;
