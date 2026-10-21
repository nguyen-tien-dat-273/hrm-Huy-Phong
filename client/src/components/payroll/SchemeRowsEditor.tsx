// ============================================================================
// Danh sách dòng của MỘT cơ chế lương — dùng cho bộ cơ chế mẫu và cho từng người.
// ----------------------------------------------------------------------------
//   [ Tên đầu mục ]  =  [ công thức hoặc con số ............ [theo tháng] ]  🗑
//   [ Gõ để tìm / thêm đầu mục… ]
//
// Dòng cuối là ô "gõ để thêm": gõ tên rồi chọn đầu mục trong danh mục, hoặc tạo
// dòng mới ngay tại đó. Không có nút Thêm hay hộp chọn riêng. "theo tháng" là
// nhãn bật tắt ở mép phải ô công thức: bật thì số được nhập mỗi tháng ngay trên
// Bảng lương thay vì tính theo công thức.
// ============================================================================

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Plus, Trash2, TriangleAlert } from 'lucide-react';
import { FormulaInput } from '@/components/payroll/formula/FormulaInput';
import { KindChip } from '@/components/payroll/KindChip';
import { sortDraft, type SchemeDraftRow } from '@/components/payroll/schemeDraft';
import type { SchemeWorkbench } from '@/components/payroll/useSchemeWorkbench';
import { useToast } from '@/contexts/ToastContext';
import { useConfirm } from '@/contexts/ConfirmContext';
import { buildFormulaEntries } from '@/lib/formulaEntries';
import { formatFormulaNumber, normalizeText, referencedCodes } from '@/lib/formulaTokens';
import { codeFromName, paramsOf } from '@/lib/payrollSettings';
import { RESERVED_FORMULA_NAMES } from '@/lib/payrollVariables';
import { saveIntermediate, type PayrollWorkspace } from '@/lib/payrollData';
import type { PayComponent } from '@/types';

interface SchemeRowsEditorProps {
  data: PayrollWorkspace;
  workbench: SchemeWorkbench;
  rows: SchemeDraftRow[];
  onChange: (rows: SchemeDraftRow[]) => void;
  readOnly: boolean;
  /** Dòng mới tạo xong ở danh mục — tải lại dữ liệu để có nó. */
  onCatalogChanged: () => void;
  /** Mã số liệu tháng do KPI / Bảng công tự điền — gắn nhãn cho dễ hiểu. */
  autoFilledCodes?: ReadonlySet<string>;
  /** Chữ mờ trong ô công thức còn trống. */
  blankPlaceholder?: string;
}

/** Nhãn "theo tháng" trong ô: bật = nhập mỗi tháng trên Bảng lương. */
function MonthlyChip({ on, disabled, onToggle }: { on: boolean; disabled: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onToggle}
      aria-pressed={on}
      title={on ? 'Số được nhập mỗi tháng ở Bảng lương — bấm để quay lại công thức' : 'Bấm để nhập số mỗi tháng ở Bảng lương thay vì công thức'}
      className={`rounded border px-1.5 py-0.5 text-[10px] font-bold leading-tight transition ${
        on
          ? 'border-indigo-600 bg-indigo-600 text-white'
          : 'border-slate-300 bg-white text-slate-500 hover:border-indigo-400 hover:text-indigo-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300'
      } ${disabled ? 'cursor-default opacity-60' : ''}`}
    >
      theo tháng
    </button>
  );
}

export function SchemeRowsEditor({
  data, workbench, rows, onChange, readOnly, onCatalogChanged, autoFilledCodes, blankPlaceholder,
}: SchemeRowsEditorProps) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const { componentById, version, params, nameOf, result, scope, softCodes, cyclic, issueOf } = workbench;

  /** Dòng vừa thêm — đặt con trỏ vào ô công thức của nó. */
  const [focusId, setFocusId] = useState<string | null>(null);
  /** Dòng mới tạo ở danh mục — thêm vào cơ chế khi dữ liệu tải lại có nó. */
  const [pendingAdd, setPendingAdd] = useState<string | null>(null);

  const ordered = useMemo(() => sortDraft(rows, componentById), [componentById, rows]);
  const rowIds = useMemo(() => new Set(rows.map((row) => row.componentId)), [rows]);
  const candidates = useMemo(() => data.components
    .filter((component) => component.is_active && !rowIds.has(component.id))
    .sort((a, b) => a.sort_order - b.sort_order), [data.components, rowIds]);

  const groupOf = (component: PayComponent) => (component.category_code
    ? data.categories.find((category) => category.code === component.category_code)?.name ?? ''
    : 'Dòng trung gian');

  const patch = (id: string, change: Partial<SchemeDraftRow>) => onChange(
    rows.map((row) => (row.componentId === id ? { ...row, ...change } : row)),
  );

  const addComponent = (componentId: string) => {
    if (rowIds.has(componentId)) return;
    const top = Math.max(0, ...rows.map((row) => row.sortOrder ?? componentById.get(row.componentId)?.sort_order ?? 0)
      .filter((value) => value < 100_000));
    onChange([...rows, { componentId, mode: 'FORMULA', formula: '', amount: null, sortOrder: top + 10 }]);
    setFocusId(componentId);
  };

  // Dòng vừa tạo xong ở danh mục: thêm vào cơ chế ngay khi dữ liệu mới về.
  useEffect(() => {
    if (!pendingAdd || !componentById.has(pendingAdd)) return;
    addComponent(pendingAdd);
    setPendingAdd(null);
  }, [componentById, pendingAdd]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!focusId) return undefined;
    const timer = window.setTimeout(() => setFocusId(null), 400);
    return () => window.clearTimeout(timer);
  }, [focusId]);

  const createLine = async (name: string): Promise<boolean> => {
    const taken = data.components.find((component) => component.name.trim().toLowerCase() === name.toLowerCase());
    if (taken) {
      if (rowIds.has(taken.id)) toast(`“${name}” đã có trong cơ chế.`, 'warning');
      else addComponent(taken.id);
      return true;
    }
    const codes = [
      ...data.components.map((component) => component.code),
      ...RESERVED_FORMULA_NAMES,
      ...paramsOf(version).map((param) => param.code),
    ];
    const { id, error } = await saveIntermediate({ id: null, code: codeFromName(name, codes, 'TRUNG_GIAN'), name, showOnPayslip: false });
    if (error || !id) { toast('Không tạo được dòng mới: ' + error, 'error'); return false; }
    setPendingAdd(id);
    onCatalogChanged();
    return true;
  };

  const usedBy = (code: string) => ordered
    .filter((row) => row.mode === 'FORMULA' && referencedCodes(row.formula).includes(code))
    .map((row) => componentById.get(row.componentId)?.name ?? '');

  const removeRow = async (row: SchemeDraftRow) => {
    const component = componentById.get(row.componentId);
    const users = component ? usedBy(component.code).filter((name) => name && name !== component.name) : [];
    if (users.length > 0) {
      const ok = await confirm({
        title: `Bỏ “${component?.name}”?`,
        message: `Dòng này đang được dùng ở: ${users.join(', ')}. Bỏ đi thì các công thức đó tính phần này bằng 0.`,
        confirmLabel: 'Vẫn bỏ',
        danger: true,
      });
      if (!ok) return;
    }
    onChange(rows.filter((item) => item.componentId !== row.componentId));
  };

  const entriesFor = (code: string) => buildFormulaEntries({
    rowComponents: ordered.flatMap((row) => componentById.get(row.componentId) ?? []),
    catalog: data.components,
    version,
    sampleValues: result?.values,
    excludeCode: code,
    includeCatalog: !readOnly,
  });

  const boxClass = (bad: boolean) => `flex min-h-11 items-center rounded-xl border-2 bg-white px-3 text-sm dark:bg-slate-800 ${
    bad ? 'border-red-400' : 'border-slate-300 dark:border-slate-600'
  }`;

  return (
    <div className="space-y-2">
      {ordered.length > 0 && (
        <ul className="space-y-2">
          {ordered.map((row) => {
            const component = componentById.get(row.componentId);
            if (!component) return null;
            const issue = issueOf(row);
            const monthly = row.mode === 'MONTHLY_INPUT';
            const intermediate = component.kind === 'INFO';
            const chip = (
              <MonthlyChip
                on={monthly}
                disabled={readOnly}
                onToggle={() => {
                  patch(row.componentId, { mode: monthly ? 'FORMULA' : 'MONTHLY_INPUT' });
                  if (monthly) setFocusId(row.componentId);
                }}
              />
            );
            return (
              <li key={row.componentId} className="group">
                <div className="flex items-start gap-2">
                  <div
                    className={`${boxClass(!!issue)} w-40 shrink-0 font-bold sm:w-56 ${
                      component.kind === 'DEDUCTION' ? 'text-red-600' : 'text-slate-900 dark:text-slate-100'
                    }`}
                    title={component.name}
                  >
                    <span className="truncate">{component.name}</span>
                  </div>
                  <span className="mt-2.5 shrink-0 font-black text-slate-400">=</span>
                  <div className="min-w-0 flex-1">
                    {monthly ? (
                      <div className={`${boxClass(false)} gap-2 text-slate-500`}>
                        <span className="min-w-0 flex-1 truncate">
                          {autoFilledCodes?.has(component.code.toUpperCase()) ? 'Tự điền khi khoá sổ' : 'Nhập mỗi tháng ở Bảng lương'}
                        </span>
                        {chip}
                      </div>
                    ) : (
                      <FormulaInput
                        value={row.formula}
                        onChange={(formula) => patch(row.componentId, { formula, mode: 'FORMULA' })}
                        entries={entriesFor(component.code)}
                        scope={scope}
                        functions={params?.functions}
                        ariaLabel={`Công thức ${component.name}`}
                        softCodes={softCodes}
                        onAddEntry={(entry) => { if (entry.componentId) addComponent(entry.componentId); }}
                        formatResult={(value) => formatFormulaNumber(intermediate ? value : Math.round(value))}
                        disabled={readOnly}
                        autoFocus={focusId === row.componentId}
                        resultOnly
                        compact
                        placeholder={blankPlaceholder}
                        trailing={chip}
                      />
                    )}
                    {cyclic.has(component.code) && (
                      <p className="mt-1 flex items-start gap-1.5 text-xs font-medium text-red-600">
                        <TriangleAlert className="mt-0.5 h-3.5 w-3.5" />
                        Vòng lặp: {[...cyclic].map((code) => nameOf(code) ?? code).join(' → ')}.
                      </p>
                    )}
                  </div>
                  {!readOnly && (
                    <button
                      type="button"
                      onClick={() => void removeRow(row)}
                      title="Bỏ dòng này"
                      aria-label={`Bỏ ${component.name}`}
                      className="mt-1.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {!readOnly && (
        <AddLine candidates={candidates} groupOf={groupOf} onPick={(component) => addComponent(component.id)} onCreate={createLine} boxClass={boxClass} empty={ordered.length === 0} />
      )}
      {readOnly && ordered.length === 0 && (
        <p className="rounded-none border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-500">Chưa có dòng nào.</p>
      )}
    </div>
  );
}

/** Dòng cuối: gõ để tìm đầu mục trong danh mục, hoặc tạo dòng mới ngay tại đây. */
function AddLine({ candidates, groupOf, onPick, onCreate, boxClass, empty }: {
  candidates: PayComponent[];
  groupOf: (component: PayComponent) => string;
  onPick: (component: PayComponent) => void;
  onCreate: (name: string) => Promise<boolean>;
  boxClass: (bad: boolean) => string;
  empty: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);

  const keyword = normalizeText(text);
  const matches = useMemo(
    () => candidates.filter((component) => !keyword || normalizeText(component.name).includes(keyword)).slice(0, 30),
    [candidates, keyword],
  );
  const name = text.trim();
  const exact = candidates.some((component) => normalizeText(component.name) === keyword);
  const canCreate = name.length > 0 && !exact;
  const total = matches.length + (canCreate ? 1 : 0);
  const safeActive = Math.min(active, Math.max(total - 1, 0));

  const reset = () => { setText(''); setActive(0); };
  const pick = (component: PayComponent) => { onPick(component); reset(); setOpen(false); };
  const create = async () => {
    if (!canCreate || busy) return;
    setBusy(true);
    const ok = await onCreate(name);
    setBusy(false);
    if (ok) { reset(); setOpen(false); }
  };
  const choose = (index: number) => {
    if (index < matches.length) pick(matches[index]);
    else void create();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true); setActive((value) => Math.min(value + 1, total - 1)); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setActive((value) => Math.max(value - 1, 0)); }
    else if (event.key === 'Enter') { event.preventDefault(); if (total > 0) choose(safeActive); }
    else if (event.key === 'Escape') { setOpen(false); }
  };

  return (
    <div className="flex items-start gap-2">
      <div className="relative w-40 shrink-0 sm:w-56">
        <div className={`${boxClass(false)} gap-1.5 border-dashed ${open ? '!border-indigo-500 ring-4 ring-indigo-500/10' : ''}`}>
          <Plus className="h-4 w-4 shrink-0 text-slate-400" />
          <input
            ref={inputRef}
            value={text}
            disabled={busy}
            onChange={(event) => { setText(event.target.value); setOpen(true); setActive(0); }}
            onFocus={() => setOpen(true)}
            onBlur={() => setOpen(false)}
            onKeyDown={onKeyDown}
            placeholder={empty ? 'Gõ tên đầu mục…' : 'Thêm đầu mục…'}
            aria-label="Gõ tên để tìm hoặc thêm đầu mục"
            role="combobox"
            aria-expanded={open}
            aria-autocomplete="list"
            className="min-w-0 flex-1 bg-transparent py-2 text-sm font-semibold text-slate-800 outline-none placeholder:font-normal placeholder:text-slate-400 dark:text-slate-100"
          />
        </div>
        {open && total > 0 && (
          <div
            role="listbox"
            className="absolute left-0 top-full z-40 mt-1 max-h-72 w-[min(22rem,80vw)] overflow-y-auto rounded-xl border border-slate-200 bg-white py-1 shadow-xl shadow-slate-900/10 dark:border-slate-700 dark:bg-slate-900"
          >
            {matches.map((component, index) => (
              <div
                key={component.id}
                role="option"
                aria-selected={index === safeActive}
                onMouseDown={(event) => { event.preventDefault(); pick(component); }}
                onMouseEnter={() => setActive(index)}
                className={`flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm ${index === safeActive ? 'bg-indigo-50 dark:bg-slate-800' : ''}`}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold text-slate-800 dark:text-slate-100">{component.name}</span>
                  <span className="block truncate text-[11px] text-slate-400">{groupOf(component)}</span>
                </span>
                <KindChip kind={component.kind} />
              </div>
            ))}
            {canCreate && (
              <div
                role="option"
                aria-selected={safeActive === matches.length}
                onMouseDown={(event) => { event.preventDefault(); void create(); }}
                onMouseEnter={() => setActive(matches.length)}
                className={`flex cursor-pointer items-center gap-2 border-t border-slate-100 px-3 py-2 text-sm font-semibold text-indigo-700 dark:border-slate-800 ${
                  safeActive === matches.length ? 'bg-indigo-50 dark:bg-slate-800' : ''
                }`}
              >
                <Plus className="h-4 w-4 shrink-0" />
                <span className="min-w-0 truncate">Tạo dòng mới “{name}”</span>
              </div>
            )}
          </div>
        )}
      </div>
      <span className="mt-2.5 shrink-0 font-black text-slate-300">=</span>
      <div className={`${boxClass(false)} min-w-0 flex-1 border-dashed text-slate-400`}>
        <span className="truncate">{empty ? 'Chọn đầu mục ở ô bên trái rồi gõ công thức' : ''}</span>
      </div>
      <span className="w-8 shrink-0" />
    </div>
  );
}
