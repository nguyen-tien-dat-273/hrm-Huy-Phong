// ============================================================================
// Cơ chế chung của một ĐƠN VỊ.
// ----------------------------------------------------------------------------
// Danh sách dòng lương mà mọi người trong đơn vị (và đơn vị con) cùng theo.
// Mỗi dòng chọn một cách lấy giá trị:
//
//   Công thức   [Lương cơ bản] ÷ [Công chuẩn] × [Ngày công]  — hoặc một con số
//   Từng người  khai riêng cho từng người ở màn nhân sự
//   Hằng tháng  nhập mỗi tháng ở Số liệu lương tháng
//
// Đơn vị con thừa hưởng dòng của cấp trên; sửa một dòng ở đây là khai lại dòng
// đó riêng cho đơn vị này, "Bỏ khỏi đơn vị" là đơn vị này không dùng dòng đó.
// Lưu là áp dụng ngay từ tháng đang xem; các tháng trước giữ nguyên.
// ============================================================================

import { useEffect, useMemo, useState } from 'react';
import { Check, ChevronDown, ChevronRight, RotateCcw, Save, Search, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { ITEMS_PER_PAGE, PagedList, Pager, clampPage } from '@/components/payroll/Pager';
import { FormulaInput } from '@/components/payroll/formula/FormulaInput';
import { formulaScopeOf, fullMonthStats, monthEndOf, monthText } from '@/components/payroll/schemeWorkbench';
import { useToast } from '@/contexts/ToastContext';
import { useConfirm } from '@/contexts/ConfirmContext';
import { useAppSettings } from '@/contexts/SettingsContext';
import { formatVND, getTodayString } from '@/lib/utils';
import { computePayslip, orderMechanismRows, type MechanismRow } from '@/lib/payroll';
import {
  describeFormula, formatFormulaNumber, formulaIssueOf, normalizeText, referencedCodes, tokenizeFormula,
} from '@/lib/formulaTokens';
import { KIND_SIGN, buildFormulaEntries } from '@/lib/formulaEntries';
import { firstEditableMonth, versionForMonth } from '@/lib/payrollSettings';
import { earliestSchemeMonth, unitItemsAt, unitMechanismRows } from '@/lib/payrollScheme';
import { nameResolver, paramsForMonth, schemeSourceOf } from '@/lib/payrollRun';
import { ROW_MODE_LABEL } from '@/lib/payrollVariables';
import { saveScheme, type PayrollWorkspace } from '@/lib/payrollData';
import type { OrganizationUnit, PayComponent, SchemePayloadItem, UnitRowMode } from '@/types';

type DraftMode = 'FORMULA' | 'PER_PERSON' | 'MONTHLY_INPUT' | 'OFF';

/** Một dòng KHAI TRỰC TIẾP ở đơn vị này. */
interface DraftRow {
  componentId: string;
  mode: DraftMode;
  /** Công thức, hoặc một con số cố định (dòng "Giá trị" cũ được đọc lên thành công thức một con số). */
  formula: string;
  /** Mức riêng: công thức đọc qua \`MUC_RIENG\`, hoặc mức chung của dòng "Từng người". */
  amount: number | null;
  sortOrder: number | null;
}

/** Dòng hiển thị: dòng thừa hưởng hoặc dòng khai ở đơn vị này (đã gộp). */
interface ViewRow {
  component: PayComponent;
  mode: DraftMode;
  formula: string;
  amount: number | null;
  sortOrder: number;
  /** Đơn vị cấp trên cung cấp dòng này (khi chưa khai lại). */
  origin: string | null;
  own: boolean;
  /** Đơn vị này khai lại một dòng mà cấp trên đã có. */
  overrides: boolean;
}

const draftOf = (item: SchemePayloadItem, defaultAmount: number): DraftRow => {
  const mode: UnitRowMode = item.mode ?? (item.formula?.trim() ? 'FORMULA' : 'VALUE');
  const base = { componentId: item.component_id, sortOrder: item.sort_order ?? null };
  if (mode === 'OFF') return { ...base, mode: 'OFF', formula: '', amount: null };
  if (mode === 'VALUE') {
    return { ...base, mode: 'FORMULA', formula: String(item.amount == null ? defaultAmount : Number(item.amount)), amount: null };
  }
  if (mode === 'FORMULA') {
    const formula = item.formula?.trim() || (item.amount != null ? String(Number(item.amount)) : '');
    return { ...base, mode: 'FORMULA', formula, amount: item.formula?.trim() ? item.amount : null };
  }
  return { ...base, mode, formula: '', amount: item.amount == null ? null : Number(item.amount) };
};

const viewOfRow = (row: MechanismRow): Pick<ViewRow, 'mode' | 'formula' | 'amount'> => {
  if (row.mode === 'VALUE') {
    return { mode: 'FORMULA', formula: String(row.amount ?? Number(row.component.default_amount ?? 0)), amount: null };
  }
  if (row.mode === 'FORMULA') return { mode: 'FORMULA', formula: row.formula ?? '', amount: row.amount };
  return { mode: row.mode, formula: '', amount: row.amount };
};

interface UnitMechanismEditorProps {
  data: PayrollWorkspace;
  unit: OrganizationUnit;
  /** Tháng đang xem — hiệu lực của bản lưu bắt đầu từ đây (hoặc tháng sớm nhất còn sửa được). */
  monthStart: string;
  lastClosedMonth: string | null;
  canManage: boolean;
  /** Số người sẽ theo cơ chế này (đơn vị và đơn vị con). */
  peopleCount: number;
  onChanged: () => void;
}

export function UnitMechanismEditor({
  data, unit, monthStart, lastClosedMonth, canManage, peopleCount, onChanged,
}: UnitMechanismEditorProps) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const app = useAppSettings();

  const minMonth = useMemo(() => earliestSchemeMonth(
    firstEditableMonth(lastClosedMonth, getTodayString()),
    data.unitItems.filter((row) => row.unit_id === unit.id).map((row) => row.effective_from),
  ), [data.unitItems, lastClosedMonth, unit.id]);
  const month = monthStart >= minMonth ? monthStart : minMonth;
  const monthEnd = monthEndOf(month);

  const componentById = useMemo(() => new Map(data.components.map((c) => [c.id, c])), [data.components]);
  const source = useMemo(() => schemeSourceOf(data), [data]);

  const savedDraft = useMemo(
    () => unitItemsAt(data.unitItems, unit.id, month, monthEnd)
      .map((item) => draftOf(item, Number(componentById.get(item.component_id)?.default_amount ?? 0))),
    [componentById, data.unitItems, month, monthEnd, unit.id],
  );
  const savedKey = JSON.stringify(savedDraft);

  const [draft, setDraft] = useState<DraftRow[]>(savedDraft);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [page, setPage] = useState(1);

  // Nạp lại khi đổi đơn vị / tháng / dữ liệu mới về — trừ khi đang sửa dở.
  useEffect(() => {
    if (dirty) return;
    setDraft(savedDraft);
  }, [savedKey, unit.id, month]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    setDirty(false);
    setDraft(savedDraft);
    setExpanded(null);
  }, [unit.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const readOnly = !canManage;

  // ---- Dòng thừa hưởng + dòng đã khai ở đơn vị này ---------------------------
  const inherited = useMemo(
    () => (unit.parent_id ? unitMechanismRows(unit.parent_id, source, month, monthEnd) : new Map<string, MechanismRow>()),
    [month, monthEnd, source, unit.parent_id],
  );

  const view = useMemo(() => {
    const map = new Map<string, ViewRow>();
    for (const [id, row] of inherited) {
      map.set(id, { component: row.component, ...viewOfRow(row), sortOrder: row.sortOrder, origin: row.origin, own: false, overrides: false });
    }
    for (const row of draft) {
      const component = componentById.get(row.componentId);
      if (!component) continue;
      const parent = inherited.get(row.componentId);
      map.set(row.componentId, {
        component, mode: row.mode, formula: row.formula, amount: row.amount,
        sortOrder: row.sortOrder ?? parent?.sortOrder ?? component.sort_order,
        origin: null, own: true, overrides: !!parent,
      });
    }
    return [...map.values()].sort((a, b) => a.sortOrder - b.sortOrder || a.component.sort_order - b.component.sort_order);
  }, [componentById, draft, inherited]);

  const active = useMemo(() => view.filter((row) => row.mode !== 'OFF'), [view]);

  // ---- Tham số, tính thử -----------------------------------------------------
  const version = useMemo(() => versionForMonth(data.paramVersions, month), [data.paramVersions, month]);
  const params = useMemo(() => paramsForMonth(data, app, new Date(`${month}T00:00:00`), month), [app, data, month]);
  const nameOf = useMemo(() => nameResolver(data.components, params), [data.components, params]);

  const mechanismRows: MechanismRow[] = useMemo(() => active.map((row) => ({
    component: row.component,
    mode: row.mode === 'OFF' ? 'FORMULA' : row.mode,
    formula: row.mode === 'FORMULA' ? row.formula.trim() || null : null,
    amount: row.amount,
    sortOrder: row.sortOrder,
    origin: unit.name,
  })), [active, unit.name]);

  const result = useMemo(() => {
    if (!params || mechanismRows.length === 0) return null;
    return computePayslip({
      profile: { id: 'sample', name: 'Nhân viên mẫu' },
      rows: mechanismRows,
      stats: fullMonthStats(params),
      params,
      inputs: {},
      catalogCodes: data.components.map((component) => component.code),
      nameOf,
    });
  }, [data.components, mechanismRows, nameOf, params]);

  const scope = useMemo(() => formulaScopeOf(data.components, params, result), [data.components, params, result]);
  const rowCodes = useMemo(() => new Set(active.map((row) => row.component.code)), [active]);
  const softCodes = useMemo(
    () => new Set(data.components.filter((component) => !rowCodes.has(component.code)).map((component) => component.code)),
    [data.components, rowCodes],
  );
  const { cyclic } = useMemo(() => orderMechanismRows(mechanismRows), [mechanismRows]);

  const issueOf = (row: ViewRow): string | null => {
    if (row.mode !== 'FORMULA') return null;
    if (cyclic.has(row.component.code)) return 'Dòng này nằm trong một vòng lặp công thức.';
    if (!row.formula.trim()) return 'Chưa có công thức.';
    const issue = formulaIssueOf(tokenizeFormula(row.formula), scope, params?.functions ?? {}, nameOf);
    return issue ? issue.message : null;
  };
  const issueCount = active.filter((row) => row.own && issueOf(row)).length;

  // ---- Sửa ---------------------------------------------------------------------
  const change = (next: DraftRow[]) => { setDraft(next); setDirty(true); };

  /** Sửa một dòng: dòng thừa hưởng thì khai lại riêng cho đơn vị này, mang sẵn nội dung cũ. */
  const patch = (row: ViewRow, patchRow: Partial<DraftRow>) => {
    const id = row.component.id;
    const existing = draft.find((item) => item.componentId === id);
    if (existing) {
      change(draft.map((item) => (item.componentId === id ? { ...item, ...patchRow } : item)));
    } else {
      change([...draft, {
        componentId: id, mode: row.mode, formula: row.formula, amount: row.amount, sortOrder: row.sortOrder, ...patchRow,
      }]);
    }
  };

  const setMode = (row: ViewRow, mode: DraftMode, on: boolean) => {
    patch(row, { mode: on ? mode : 'FORMULA' });
  };

  const usedBy = (code: string) => active
    .filter((row) => row.mode === 'FORMULA' && referencedCodes(row.formula).includes(code))
    .map((row) => row.component.name);

  /** Bỏ dòng khỏi đơn vị này: dòng chỉ có ở đây thì xoá, dòng của cấp trên thì đặt OFF. */
  const dropRow = async (row: ViewRow) => {
    const users = usedBy(row.component.code).filter((name) => name !== row.component.name);
    if (users.length > 0) {
      const ok = await confirm({
        title: `Bỏ “${row.component.name}” khỏi đơn vị?`,
        message: `Dòng này đang được dùng ở: ${users.join(', ')}. Bỏ đi thì các công thức đó tính phần này bằng 0.`,
        confirmLabel: 'Vẫn bỏ',
        danger: true,
      });
      if (!ok) return;
    }
    const id = row.component.id;
    if (inherited.has(id)) {
      const off: DraftRow = { componentId: id, mode: 'OFF', formula: '', amount: null, sortOrder: null };
      change([...draft.filter((item) => item.componentId !== id), off]);
    } else {
      change(draft.filter((item) => item.componentId !== id));
    }
    if (expanded === id) setExpanded(null);
  };

  /** Về dòng của cấp trên (xoá phần khai lại / dùng lại dòng đã bỏ). */
  const revertRow = (row: ViewRow) => {
    change(draft.filter((item) => item.componentId !== row.component.id));
  };

  const addComponent = (componentId: string, wanted?: DraftMode) => {
    const component = componentById.get(componentId);
    if (!component) return;
    const top = Math.max(0, ...view.map((row) => row.sortOrder).filter((value) => value < 100_000));
    const preset = Number(component.default_amount) > 0 ? String(Number(component.default_amount)) : '';
    const mode: DraftMode = wanted ?? (component.kind === 'INFO' && !preset ? 'PER_PERSON' : 'FORMULA');
    change([
      ...draft.filter((item) => item.componentId !== componentId),
      { componentId, mode, formula: mode === 'FORMULA' ? preset : '', amount: null, sortOrder: top + 10 },
    ]);
    if (mode === 'FORMULA') setExpanded(componentId);
  };

  // Mọi đầu mục: dòng của cơ chế (đã tích, kể cả dòng đã bỏ) rồi các đầu mục chưa có (chưa tích).
  const keyword = normalizeText(filter);
  const entries = [
    ...view.map((row) => ({ component: row.component, row: row as ViewRow | null })),
    ...data.components
      .filter((component) => component.is_active && !view.some((row) => row.component.id === component.id))
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((component) => ({ component, row: null as ViewRow | null })),
  ]
    .filter((entry) => !readOnly || (entry.row && entry.row.mode !== 'OFF'))
    .filter((entry) => !keyword || normalizeText(entry.component.name).includes(keyword));
  const safePage = clampPage(page, entries.length);
  const pageEntries = entries.slice((safePage - 1) * ITEMS_PER_PAGE, safePage * ITEMS_PER_PAGE);

  // ---- Lưu ---------------------------------------------------------------------
  const handleSave = async () => {
    if (issueCount > 0) {
      toast('Còn dòng chưa hợp lệ — sửa các dòng tô đỏ trước khi lưu.', 'warning');
      return;
    }
    setSaving(true);
    const items: SchemePayloadItem[] = draft.map((row) => ({
      component_id: row.componentId,
      mode: row.mode,
      formula: row.mode === 'FORMULA' ? row.formula.trim() || null : null,
      amount: row.mode === 'FORMULA' || row.mode === 'PER_PERSON' ? row.amount : null,
      sort_order: row.sortOrder,
      note: null,
    }));
    const error = await saveScheme({ targetType: 'UNIT', userId: null, unitId: unit.id, effectiveFrom: month, items });
    setSaving(false);
    if (error) {
      toast('Không lưu được: ' + error, 'error');
      return;
    }
    toast(`Đã lưu cơ chế chung của ${unit.name}, áp dụng từ ${monthText(month)}.`, 'success');
    setDirty(false);
    onChanged();
  };

  // ---- Giao diện -------------------------------------------------------------
  const kindTone = (row: ViewRow) => (row.component.kind === 'DEDUCTION' ? 'text-red-600'
    : row.component.kind === 'INFO' ? 'text-slate-500' : 'text-slate-900');

  return (
    <div className="space-y-3 pb-20">
      {month > monthStart && (
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
          Tháng {monthText(monthStart)} đã chốt lương — bản lưu sẽ áp dụng từ {monthText(month)}.
        </p>
      )}
      {!params && (
        <p className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
          Chưa có bộ tham số lương hiệu lực cho tháng này — khai ở Tham số lương để tính thử được.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={filter}
            onChange={(event) => { setFilter(event.target.value); setPage(1); }}
            placeholder="Lọc đầu mục theo tên…"
            aria-label="Lọc đầu mục theo tên"
            className="h-10 w-full rounded-xl border border-slate-200 pl-9 pr-3 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
          />
        </div>
        <span className="text-xs font-semibold text-slate-500">{active.length} đầu mục trong cơ chế</span>
      </div>

      {entries.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">
          {keyword ? `Không có đầu mục nào khớp “${filter.trim()}”.` : 'Đơn vị này chưa có dòng lương nào.'}
        </p>
      ) : (
        <>
          <PagedList page={safePage} total={entries.length} onPage={setPage}>
            <ol className="space-y-2">
              {pageEntries.map(({ component, row }) => {
                const id = component.id;
                const ticked = !!row && row.mode !== 'OFF';
                const off = !!row && row.mode === 'OFF';
                const open = ticked && expanded === id;
                const issue = row && ticked ? issueOf(row) : null;
                const line = result?.lines.find((item) => item.code === component.code);
                const summary = !row ? ''
                  : off ? 'Đã bỏ khỏi đơn vị này'
                    : row.mode === 'FORMULA'
                      ? (row.formula.trim() ? describeFormula(row.formula, nameOf) : 'Chưa có công thức')
                      : row.mode === 'PER_PERSON'
                        ? (row.amount != null ? `Từng người · mức chung ${formatFormulaNumber(row.amount)}` : 'Khai cho từng người')
                        : 'Nhập mỗi tháng';
                const toggleTick = () => {
                  if (!row) { addComponent(id); return; }
                  if (off) { revertRow(row); return; }
                  void dropRow(row);
                };
                return (
                  <li
                    key={id}
                    className={`rounded-xl border bg-white transition ${
                      issue ? 'border-red-200' : open ? 'border-indigo-300 shadow-sm' : ticked ? 'border-indigo-100' : 'border-slate-200'
                    }`}
                  >
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-2.5 py-2">
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={ticked}
                        aria-label={`${ticked ? 'Bỏ' : 'Thêm'} ${component.name} ${ticked ? 'khỏi' : 'vào'} cơ chế`}
                        disabled={readOnly}
                        onClick={toggleTick}
                        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2 transition disabled:cursor-not-allowed ${
                          ticked ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-slate-300 bg-white hover:border-indigo-400'
                        }`}
                      >
                        {ticked && <Check className="h-4 w-4" />}
                      </button>
                      <button
                        type="button"
                        disabled={!ticked}
                        onClick={() => setExpanded(open ? null : id)}
                        aria-expanded={open}
                        className="flex min-w-0 flex-1 basis-48 items-center gap-2 text-left disabled:cursor-default"
                      >
                        {ticked && (open ? <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" /> : <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />)}
                        <span className="min-w-0">
                          <span className={`block truncate text-sm font-semibold ${ticked ? 'text-slate-800' : 'text-slate-500'}`}>
                            {component.name}
                            {ticked && row && !row.own && row.origin && (
                              <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">từ {row.origin}</span>
                            )}
                            {ticked && row?.overrides && (
                              <span className="ml-2 rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-600">khai lại ở đơn vị này</span>
                            )}
                          </span>
                          {!open && (issue ?? summary) && (
                            <span className={`block truncate text-xs ${issue ? 'text-red-600' : 'text-slate-500'}`}>{issue ?? summary}</span>
                          )}
                        </span>
                      </button>

                      {!readOnly && (['PER_PERSON', 'MONTHLY_INPUT'] as const).map((mode) => (
                        <label key={mode} className="flex shrink-0 cursor-pointer items-center gap-1.5 text-xs font-semibold text-slate-600">
                          <input
                            type="checkbox"
                            className="h-3.5 w-3.5 accent-indigo-600"
                            checked={ticked && row?.mode === mode}
                            onChange={(event) => {
                              if (ticked && row) setMode(row, mode, event.target.checked);
                              else addComponent(id, mode);
                            }}
                          />
                          {ROW_MODE_LABEL[mode]}
                        </label>
                      ))}

                      <span className={`w-24 shrink-0 text-right text-sm font-bold tabular-nums ${
                        ticked && line?.failed ? 'text-amber-600' : ticked && row ? kindTone(row) : 'text-slate-300'
                      }`}>
                        {ticked && line ? `${component.kind === 'DEDUCTION' ? '−' : ''}${formatFormulaNumber(line.amount)}` : '—'}
                      </span>

                      {!readOnly && ticked && row?.overrides && (
                        <button
                          type="button"
                          onClick={() => revertRow(row)}
                          title="Bỏ phần khai lại, theo cấp trên"
                          aria-label={`Theo cấp trên: ${component.name}`}
                          className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-indigo-600"
                        >
                          <RotateCcw className="h-4 w-4" />
                        </button>
                      )}
                    </div>

                    {open && row && (
                      <div className="space-y-2 border-t border-slate-100 px-3 py-3">
                        {row.mode === 'FORMULA' && (
                          <FormulaInput
                            value={row.formula}
                            onChange={(formula) => patch(row, { formula, mode: 'FORMULA' })}
                            entries={buildFormulaEntries({
                              rowComponents: active.map((item) => item.component),
                              catalog: data.components,
                              version,
                              sampleValues: result?.values,
                              excludeCode: component.code,
                              includeCatalog: !readOnly,
                            })}
                            scope={scope}
                            functions={params?.functions}
                            leftLabel={component.name}
                            softCodes={softCodes}
                            onAddEntry={(entry) => { if (entry.componentId) addComponent(entry.componentId); }}
                            formatResult={(value) => formatFormulaNumber(component.kind === 'INFO' ? value : Math.round(value))}
                            disabled={readOnly}
                            autoFocus={!row.formula}
                          />
                        )}
                        {row.mode === 'PER_PERSON' && (
                          <p className="text-xs text-slate-500">
                            Giá trị khai riêng cho từng người ở màn nhân sự — người chưa khai thì phiếu báo thiếu.
                          </p>
                        )}
                        {row.mode === 'MONTHLY_INPUT' && (
                          <p className="text-xs text-slate-500">Con số nhập mỗi tháng ở Số liệu lương tháng.</p>
                        )}
                        {cyclic.has(component.code) && (
                          <p className="flex items-start gap-1.5 text-xs font-medium text-red-600">
                            <TriangleAlert className="mt-0.5 h-3.5 w-3.5" />
                            Vòng lặp: {[...cyclic].map((code) => nameOf(code) ?? code).join(' → ')}. Bỏ bớt một tham chiếu.
                          </p>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
          </PagedList>
          <Pager page={safePage} total={entries.length} onPage={setPage} />
        </>
      )}

      {result && active.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border-2 border-indigo-200 bg-indigo-50 px-4 py-3">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-indigo-600 text-sm font-black text-white">=</span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-extrabold uppercase tracking-wide text-indigo-900">Thực lĩnh mẫu</p>
            <p className="text-xs text-indigo-800/70">Đi đủ công, chưa có số liệu tháng; từng người sẽ ra số riêng.</p>
          </div>
          <div className="text-right text-xs text-indigo-800/80">
            <p className="tabular-nums">{formatVND(result.gross)} − {formatVND(result.totalDeductions)}</p>
            <p className="text-lg font-black tabular-nums text-indigo-700">{formatVND(result.netPay)}</p>
          </div>
        </div>
      )}

      {dirty && !readOnly && (
        <div className="fixed bottom-0 left-0 right-0 z-30 border-t border-slate-200 bg-white/95 px-4 py-3 shadow-lg backdrop-blur-md print:hidden">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 lg:pl-64">
            <p className={`flex items-center gap-1.5 text-sm ${issueCount > 0 ? 'text-red-600' : 'text-slate-600'}`}>
              {issueCount > 0
                ? <><TriangleAlert className="h-4 w-4" /> {issueCount} dòng chưa hợp lệ</>
                : <><Save className="h-4 w-4" /> Chưa lưu — áp dụng từ {monthText(month)} cho {peopleCount} người</>}
            </p>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => { setDirty(false); setDraft(savedDraft); }} disabled={saving}>
                Huỷ thay đổi
              </Button>
              <Button onClick={() => void handleSave()} disabled={saving || issueCount > 0}>
                <Save className="h-4 w-4" /> {saving ? 'Đang lưu…' : 'Lưu cơ chế chung'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
