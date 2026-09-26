// ============================================================================
// Cơ chế chung của một ĐƠN VỊ.
// ----------------------------------------------------------------------------
// Danh sách dòng lương mà mọi người trong đơn vị (và đơn vị con) cùng theo.
// Mỗi dòng chọn một cách lấy giá trị:
//
//   Công thức   [Lương cơ bản] ÷ [Công chuẩn] × [Ngày công]  — hoặc một con số
//   Khai riêng  khai riêng cho từng người ở màn nhân sự
//   Theo tháng  nhập mỗi tháng ngay trên Bảng lương
//
// Đơn vị con thừa hưởng dòng của cấp trên; sửa một dòng ở đây là khai lại dòng
// đó riêng cho đơn vị này, "Bỏ khỏi đơn vị" là đơn vị này không dùng dòng đó.
// Lưu là áp dụng ngay từ tháng đang xem; các tháng trước giữ nguyên.
//
// Danh sách phẳng, 10 đầu mục một trang: CHỈ hiện đầu mục đã thiết lập, mỗi dòng
// hiện thẳng công thức đang sửa "Tên = công thức" và đúng MỘT kết quả cuối. Muốn
// thêm đầu mục thì bấm "Thêm đầu mục" cạnh ô lọc (chọn từ danh mục hoặc tạo dòng
// trung gian mới); thùng rác ở cuối dòng để bỏ đầu mục khỏi đơn vị. Mẫu phiếu
// lương khai ở thẻ "Phiếu lương" (PayslipLayoutEditor).
// ============================================================================

import { useEffect, useMemo, useState } from 'react';
import { FileText, Plus, RotateCcw, Save, Search, Trash2, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { ITEMS_PER_PAGE, PagedList, Pager, clampPage } from '@/components/payroll/Pager';
import { FormulaSheetModal } from '@/components/payroll/FormulaSheetModal';
import { MechanismAddDialog } from '@/components/payroll/MechanismAddDialog';
import { FormulaInput } from '@/components/payroll/formula/FormulaInput';
import { formulaScopeOf, fullMonthStats, monthEndOf, monthText } from '@/components/payroll/schemeWorkbench';
import { useToast } from '@/contexts/ToastContext';
import { useConfirm } from '@/contexts/ConfirmContext';
import { useAppSettings } from '@/contexts/SettingsContext';
import { getTodayString } from '@/lib/utils';
import { computePayslip, orderMechanismRows, type MechanismRow } from '@/lib/payroll';
import {
  formatFormulaNumber, formulaIssueOf, normalizeText, referencedCodes, tokenizeFormula,
} from '@/lib/formulaTokens';
import { buildFormulaEntries } from '@/lib/formulaEntries';
import { codeFromName, firstEditableMonth, paramsOf, versionForMonth } from '@/lib/payrollSettings';
import { earliestSchemeMonth, unitItemsAt, unitMechanismRows } from '@/lib/payrollScheme';
import { nameResolver, paramsForMonth, schemeSourceOf } from '@/lib/payrollRun';
import { RESERVED_FORMULA_NAMES, ROW_MODE_LABEL } from '@/lib/payrollVariables';
import { saveIntermediate, saveScheme, type PayrollWorkspace } from '@/lib/payrollData';
import type { OrganizationUnit, PayComponent, SchemePayloadItem, UnitRowMode } from '@/types';

type DraftMode = 'FORMULA' | 'PER_PERSON' | 'MONTHLY_INPUT' | 'OFF';

/** Một dòng KHAI TRỰC TIẾP ở đơn vị này. */
interface DraftRow {
  componentId: string;
  mode: DraftMode;
  /** Công thức, hoặc một con số cố định (dòng "Giá trị" cũ được đọc lên thành công thức một con số). */
  formula: string;
  /** Mức riêng: công thức đọc qua \`MUC_RIENG\`, hoặc mức chung của dòng "Khai riêng". */
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

const draftOf = (item: SchemePayloadItem): DraftRow => {
  const mode: UnitRowMode = item.mode ?? (item.formula?.trim() ? 'FORMULA' : 'VALUE');
  const base = { componentId: item.component_id, sortOrder: item.sort_order ?? null };
  if (mode === 'OFF') return { ...base, mode: 'OFF', formula: '', amount: null };
  if (mode === 'VALUE') {
    return { ...base, mode: 'FORMULA', formula: String(item.amount == null ? 0 : Number(item.amount)), amount: null };
  }
  if (mode === 'FORMULA') {
    const formula = item.formula?.trim() || (item.amount != null ? String(Number(item.amount)) : '');
    return { ...base, mode: 'FORMULA', formula, amount: item.formula?.trim() ? item.amount : null };
  }
  return { ...base, mode, formula: '', amount: item.amount == null ? null : Number(item.amount) };
};

const viewOfRow = (row: MechanismRow): Pick<ViewRow, 'mode' | 'formula' | 'amount'> => {
  if (row.mode === 'VALUE') {
    return { mode: 'FORMULA', formula: String(row.amount ?? 0), amount: null };
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
  /** Đầu mục nhận số từ KPI (Tham số KPI → Điền kết quả KPI vào lương). */
  const kpiCodeSet = useMemo(() => new Set(data.kpiCodes), [data.kpiCodes]);
  const source = useMemo(() => schemeSourceOf(data), [data]);

  const savedDraft = useMemo(
    () => unitItemsAt(data.unitItems, unit.id, month, monthEnd).map(draftOf),
    [data.unitItems, month, monthEnd, unit.id],
  );
  const savedKey = JSON.stringify(savedDraft);

  const [draft, setDraft] = useState<DraftRow[]>(savedDraft);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  /** Dòng vừa thêm — nhảy tới trang có nó và đặt con trỏ vào ô công thức. */
  const [focusId, setFocusId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState('');
  /** Hộp "Thêm đầu mục". */
  const [addOpen, setAddOpen] = useState(false);
  /** Dòng trung gian vừa tạo — tích vào cơ chế khi danh mục tải lại có nó. */
  const [pendingAdd, setPendingAdd] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  // Nạp lại khi đổi đơn vị / tháng / dữ liệu mới về — trừ khi đang sửa dở.
  useEffect(() => {
    if (dirty) return;
    setDraft(savedDraft);
  }, [savedKey, unit.id, month]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    setDirty(false);
    setDraft(savedDraft);
    setPage(1);
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
    if (!on) setFocusId(row.component.id);
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
  };

  /** Về dòng của cấp trên (xoá phần khai lại / dùng lại dòng đã bỏ). */
  const revertRow = (row: Pick<ViewRow, 'component'>) => {
    change(draft.filter((item) => item.componentId !== row.component.id));
  };

  const addComponent = (componentId: string, wanted?: DraftMode) => {
    const component = componentById.get(componentId);
    if (!component) return;
    const top = Math.max(0, ...view.map((row) => row.sortOrder).filter((value) => value < 100_000));
    const mode: DraftMode = wanted ?? (component.kind === 'INFO' ? 'PER_PERSON' : 'FORMULA');
    change([
      ...draft.filter((item) => item.componentId !== componentId),
      { componentId, mode, formula: '', amount: null, sortOrder: top + 10 },
    ]);
    setFocusId(componentId);
  };

  /** Chọn đầu mục trong hộp "Thêm": dòng đã bỏ của cấp trên thì dùng lại, còn lại thêm mới. */
  const pickComponent = (component: PayComponent) => {
    if (inherited.has(component.id)) {
      revertRow({ component });
      setFocusId(component.id);
      return;
    }
    addComponent(component.id);
  };

  // ---- Dòng trung gian tạo ngay tại đây -----------------------------------------
  useEffect(() => {
    if (!pendingAdd || !componentById.has(pendingAdd)) return;
    addComponent(pendingAdd, 'FORMULA');
    setPendingAdd(null);
  }, [componentById, pendingAdd]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Tạo dòng trung gian trong hộp "Thêm đầu mục". Trả về true khi tạo được. */
  const createIntermediate = async (name: string): Promise<boolean> => {
    if (data.components.some((component) => component.name.trim().toLowerCase() === name.toLowerCase())) {
      toast(`Đã có đầu mục “${name}” — chọn nó trong danh sách thay vì tạo mới.`, 'warning');
      return false;
    }
    const taken = [
      ...data.components.map((component) => component.code),
      ...RESERVED_FORMULA_NAMES,
      ...paramsOf(version).map((param) => param.code),
    ];
    const { id, error } = await saveIntermediate({ id: null, code: codeFromName(name, taken, 'TRUNG_GIAN'), name, showOnPayslip: false });
    if (error || !id) { toast('Không tạo được dòng trung gian: ' + (error ?? 'không rõ lỗi'), 'error'); return false; }
    setPendingAdd(id);
    onChanged();
    return true;
  };

  // ---- Danh sách phẳng ----------------------------------------------------
  // Chỉ đầu mục đã thiết lập, theo thứ tự trên phiếu. Chưa thiết lập thì thêm bằng "Thêm đầu mục".
  const keyword = normalizeText(filter);
  const entries: ViewRow[] = active.filter((row) => !keyword || normalizeText(row.component.name).includes(keyword));
  const candidates = data.components
    .filter((component) => component.is_active && !active.some((row) => row.component.id === component.id))
    .sort((a, b) => a.sort_order - b.sort_order);
  const groupOf = (component: PayComponent) => (component.category_code
    ? data.categories.find((category) => category.code === component.category_code)?.name ?? component.category_code
    : 'Dòng trung gian');
  const safePage = clampPage(page, entries.length);
  const pageEntries = entries.slice((safePage - 1) * ITEMS_PER_PAGE, safePage * ITEMS_PER_PAGE);

  // Dòng vừa thêm: sang đúng trang của nó.
  const entryKey = entries.map((entry) => entry.component.id).join(',');
  useEffect(() => {
    if (!focusId) return undefined;
    const index = entries.findIndex((entry) => entry.component.id === focusId);
    if (index >= 0) setPage(Math.floor(index / ITEMS_PER_PAGE) + 1);
    const timer = window.setTimeout(() => setFocusId(null), 400);
    return () => window.clearTimeout(timer);
  }, [focusId, entryKey]); // eslint-disable-line react-hooks/exhaustive-deps

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
    if (error) { toast('Không lưu được: ' + error, 'error'); return; }
    setDirty(false);
    toast(`Đã lưu cơ chế chung của ${unit.name}, áp dụng từ ${monthText(month)}.`, 'success');
    onChanged();
  };

  // ---- Giao diện -------------------------------------------------------------
  function renderEntry(row: ViewRow) {
    const { component } = row;
    const id = component.id;
    const formulaRow = row.mode === 'FORMULA';
    const issue = issueOf(row);
    const line = result?.lines.find((item) => item.code === component.code);
    const intermediate = component.kind === 'INFO';
    return (
      <li
        key={id}
        className={`rounded-none border bg-white px-2.5 py-2.5 transition ${issue ? 'border-red-200' : 'border-indigo-200'}`}
      >
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            {formulaRow ? (
              <>
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
                  formatResult={(value) => formatFormulaNumber(intermediate ? value : Math.round(value))}
                  disabled={readOnly}
                  autoFocus={focusId === id}
                  resultOnly
                />
                {cyclic.has(component.code) && (
                  <p className="mt-1 flex items-start gap-1.5 text-xs font-medium text-red-600">
                    <TriangleAlert className="mt-0.5 h-3.5 w-3.5" />
                    Vòng lặp: {[...cyclic].map((code) => nameOf(code) ?? code).join(' → ')}. Bỏ bớt một tham chiếu.
                  </p>
                )}
              </>
            ) : (
              <div className="flex min-h-9 items-center gap-3">
                <span className={`min-w-0 flex-1 truncate text-sm font-semibold ${
                  component.kind === 'DEDUCTION' ? 'text-red-600' : 'text-slate-800'
                }`}>
                  {component.name}
                </span>
                <span className={`shrink-0 text-right text-sm font-bold tabular-nums ${line?.failed ? 'text-amber-600' : 'text-slate-900'}`}>
                  {line ? formatFormulaNumber(line.amount) : '—'}
                </span>
              </div>
            )}
          </div>

          {!readOnly && (
            <div className="flex shrink-0 items-start gap-3 pt-0.5">
              <div className="flex flex-col items-start gap-1.5 text-xs font-semibold text-slate-600">
              {row.overrides && (
                <button
                  type="button"
                  onClick={() => revertRow(row)}
                  title="Bỏ phần khai lại, theo cấp trên"
                  aria-label={`Theo cấp trên: ${component.name}`}
                  className="inline-flex items-center gap-1 rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-600 hover:bg-indigo-100"
                >
                  <RotateCcw className="h-3 w-3" /> khai lại
                </button>
              )}
              {(['PER_PERSON', 'MONTHLY_INPUT'] as const).map((mode) => (
                <label key={mode} className="flex cursor-pointer items-center gap-1.5">
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 accent-indigo-600"
                    checked={row.mode === mode}
                    onChange={(event) => setMode(row, mode, event.target.checked)}
                  />
                  {ROW_MODE_LABEL[mode]}
                  {mode === 'MONTHLY_INPUT' && kpiCodeSet.has(component.code.toUpperCase()) && (
                    <span className="rounded bg-indigo-50 px-1 text-[10px] font-semibold text-indigo-600" title="Số tự điền khi khoá sổ KPI">từ KPI</span>
                  )}
                </label>
              ))}
              </div>
              <button
                type="button"
                onClick={() => void dropRow(row)}
                title="Bỏ đầu mục khỏi đơn vị"
                aria-label={`Bỏ ${component.name} khỏi cơ chế`}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
      </li>
    );
  }

  return (
    <div className="space-y-3 pb-20">
      {month > monthStart && (
        <p className="rounded-none bg-slate-50 px-3 py-2 text-xs text-slate-600">
          Tháng {monthText(monthStart)} đã chốt lương — bản lưu sẽ áp dụng từ {monthText(month)}.
        </p>
      )}
      {!params && (
        <p className="flex items-start gap-2 rounded-none bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
          Chưa có bộ tham số lương hiệu lực cho tháng này — khai ở Tham số lương để tính thử được.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={filter}
            onChange={(event) => { setFilter(event.target.value); setPage(1); }}
            placeholder="Lọc đầu mục theo tên…"
            aria-label="Lọc đầu mục theo tên"
            className="h-10 w-full rounded-xl border border-slate-200 pl-9 pr-3 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
          />
        </div>
        {!readOnly && (
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4" /> Thêm đầu mục
          </Button>
        )}
        {active.length > 0 && (
          <Button size="sm" variant="outline" className="sm:ml-auto" onClick={() => setSheetOpen(true)}>
            <FileText className="h-4 w-4" /> Xem công thức dạng chữ
          </Button>
        )}
      </div>

      {entries.length === 0 ? (
        <p className="rounded-none border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">
          {keyword ? `Không có đầu mục nào khớp “${filter.trim()}”.` : `Chưa có đầu mục nào trong cơ chế${readOnly ? '.' : ' — bấm “Thêm đầu mục”.'}`}
        </p>
      ) : (
        <>
          <PagedList page={safePage} total={entries.length} onPage={setPage}>
            <ol className="space-y-2">{pageEntries.map(renderEntry)}</ol>
          </PagedList>
          <Pager page={safePage} total={entries.length} onPage={setPage} />
        </>
      )}

      <MechanismAddDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        candidates={candidates}
        groupOf={groupOf}
        onPick={pickComponent}
        onCreateIntermediate={createIntermediate}
      />

      <FormulaSheetModal
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        subject={unit.name}
        rows={mechanismRows}
        nameOf={nameOf}
        categories={data.categories}
        rounding={params ? { unit: params.netRoundingUnit, mode: params.netRoundingMode } : null}
      />

      {dirty && !readOnly && (
        <div className="fixed bottom-0 left-0 right-0 z-30 border-t border-slate-200 bg-white/95 px-4 py-3 shadow-lg backdrop-blur-md print:hidden">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 lg:pl-64">
            <p className={`flex items-center gap-1.5 text-sm ${issueCount > 0 ? 'text-red-600' : 'text-slate-600'}`}>
              {issueCount > 0
                ? <><TriangleAlert className="h-4 w-4" /> {issueCount} dòng chưa hợp lệ</>
                : <><Save className="h-4 w-4" /> Chưa lưu — áp dụng từ {monthText(month)} cho {peopleCount} người</>}
            </p>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                onClick={() => { setDirty(false); setDraft(savedDraft); }}
                disabled={saving}
              >
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
