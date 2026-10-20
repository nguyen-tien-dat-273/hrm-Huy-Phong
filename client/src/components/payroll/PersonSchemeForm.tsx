// ============================================================================
// Cơ chế lương của MỘT nhân sự — form nằm thẳng trên trang, không hộp thoại.
// ----------------------------------------------------------------------------
// Liệt kê đúng các dòng áp cho người này tháng đang xem (cơ chế chung của đơn
// vị + khai riêng); đầu mục chưa thiết lập thì không hiện. Ở mỗi dòng:
//
//   - Dòng đang khai riêng: ô nhập hiện sẵn — điền số (VND) hoặc công thức;
//     thùng rác để về mức chung (khoản chỉ có ở khai riêng thì bỏ hẳn).
//   - Dòng theo cơ chế chung: bấm bút chì để khai riêng cho người này.
//   - Đầu mục chưa có dòng nào: "Thêm đầu mục" cạnh ô lọc.
//
// Lưu là áp dụng ngay từ tháng đang xem (các tháng trước giữ nguyên). Bản khai
// là TOÀN BỘ phần khai riêng của người từ tháng áp dụng.
// ============================================================================

import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, FileText, FlaskConical, Pencil, Plus, Save, Search, SlidersHorizontal, Trash2, TriangleAlert } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { ITEMS_PER_PAGE, PagedList, Pager, clampPage } from '@/components/payroll/Pager';
import { MechanismAddDialog } from '@/components/payroll/MechanismAddDialog';
import { Avatar } from '@/components/ui/Avatar';
import { FormulaInput } from '@/components/payroll/formula/FormulaInput';
import { BankAccountCard } from '@/components/payroll/BankAccountCard';
import {
  formulaScopeOf, fullMonthStats, monthEndOf, monthText, parseAmountText,
} from '@/components/payroll/schemeWorkbench';
import { useToast } from '@/contexts/ToastContext';
import { useAppSettings } from '@/contexts/SettingsContext';
import { getTodayString } from '@/lib/utils';
import type { MechanismRow } from '@/lib/payroll';
import {
  formatFormulaNumber, formulaIssueOf, normalizeText, tokenizeFormula,
} from '@/lib/formulaTokens';
import { buildFormulaEntries } from '@/lib/formulaEntries';
import { FormulaSheetModal } from '@/components/payroll/FormulaSheetModal';
import { firstEditableMonth, versionForMonth } from '@/lib/payrollSettings';
import {
  diffSchemeItems, earliestSchemeMonth, personalItemsAt, resolveMechanismRows, resolveSharedRows,
} from '@/lib/payrollScheme';
import { computeForPerson, nameResolver, paramsForMonth, schemeSourceOf } from '@/lib/payrollRun';
import { saveScheme, type PayrollWorkspace } from '@/lib/payrollData';
import type { EmployeeBankAccount, EmployeePayItem, PayComponent, Profile, SchemePayloadItem } from '@/types';

interface ItemDraft {
  componentId: string;
  /** Ô khai riêng chứa một con số (VALUE) hay một công thức (FORMULA) — tự nhận ra từ nội dung gõ. */
  kind: 'VALUE' | 'FORMULA';
  amount: string;
  formula: string;
}

const draftOf = (item: SchemePayloadItem): ItemDraft => ({
  componentId: item.component_id,
  kind: item.formula?.trim() ? 'FORMULA' : 'VALUE',
  amount: item.amount == null ? '' : String(item.amount),
  formula: item.formula ?? '',
});

interface PersonSchemeFormProps {
  person: Profile;
  data: PayrollWorkspace;
  monthStart: string;
  lastClosedMonth: string | null;
  canManage: boolean;
  account: EmployeeBankAccount | null;
  /** Tên đơn vị của người — nơi cơ chế chung được áp xuống. */
  unitName: string | null;
  onBack?: () => void;
  onSaved: () => void;
  onAccountSaved: () => void;
  /** Mở Bảng lương tháng, đúng hàng của người này, để nhập số liệu tháng. */
  onOpenInputs: () => void;
  onDryRun: () => void;
}

export function PersonSchemeForm({
  person, data, monthStart, lastClosedMonth, canManage, account, unitName, onBack, onSaved, onAccountSaved, onOpenInputs, onDryRun,
}: PersonSchemeFormProps) {
  const { toast } = useToast();
  const app = useAppSettings();

  const minMonth = useMemo(() => earliestSchemeMonth(
    firstEditableMonth(lastClosedMonth, getTodayString()),
    data.items.filter((row) => row.user_id === person.id).map((row) => row.effective_from),
  ), [data.items, lastClosedMonth, person.id]);
  const month = monthStart >= minMonth ? monthStart : minMonth;
  const monthEnd = monthEndOf(month);

  const saved = useMemo(
    () => personalItemsAt(data.items, person.id, month, monthEnd),
    [data.items, month, monthEnd, person.id],
  );
  const savedKey = JSON.stringify(saved);

  const [drafts, setDrafts] = useState<ItemDraft[]>(() => saved.map(draftOf));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState('');
  const [page, setPage] = useState(1);
  const [sheetOpen, setSheetOpen] = useState(false);
  /** Hộp "Thêm đầu mục". */
  const [addOpen, setAddOpen] = useState(false);
  /** Dòng vừa thêm / vừa mở khai riêng — nhảy tới trang có nó và đặt con trỏ vào ô công thức. */
  const [focusId, setFocusId] = useState<string | null>(null);

  const readOnly = !canManage;
  const source = useMemo(() => schemeSourceOf(data), [data]);
  const componentById = useMemo(() => new Map(data.components.map((c) => [c.id, c])), [data.components]);
  const version = useMemo(() => versionForMonth(data.paramVersions, month), [data.paramVersions, month]);
  const params = useMemo(() => paramsForMonth(data, app, new Date(`${month}T00:00:00`), month), [app, data, month]);
  const nameOf = useMemo(() => nameResolver(data.components, params), [data.components, params]);

  const payloadItems: SchemePayloadItem[] = useMemo(() => drafts
    .map((item) => {
      const amount = parseAmountText(item.amount);
      return {
        component_id: item.componentId,
        amount: item.kind === 'VALUE' && amount != null && Number.isFinite(amount) ? amount : null,
        formula: item.kind === 'FORMULA' ? item.formula.trim() || null : null,
        note: null,
      };
    })
    .filter((item) => item.amount != null || item.formula != null), [drafts]);

  // ---- Dòng áp cho người này, theo bản khai đang soạn ------------------------
  const fakeItems: EmployeePayItem[] = useMemo(() => payloadItems.map((item, index) => ({
    id: `draft-${index}`, user_id: person.id, component_id: item.component_id, amount: item.amount, formula: item.formula,
    taxable: null, insurable: null, is_base: null, effective_from: month, effective_to: null, note: null,
    created_by: null, created_at: '', updated_at: '',
  })), [month, payloadItems, person.id]);

  const sharedRows = useMemo(
    () => resolveSharedRows(person, source, month, monthEnd),
    [month, monthEnd, person, source],
  );
  const sharedByComponent = useMemo(() => new Map(sharedRows.map((row) => [row.component.id, row])), [sharedRows]);
  const rows: MechanismRow[] = useMemo(
    () => resolveMechanismRows(person, { ...source, employeeItems: [...data.items.filter((row) => row.user_id !== person.id), ...fakeItems] }, month, monthEnd),
    [data.items, fakeItems, month, monthEnd, person, source],
  );

  // Ước tính theo số liệu tháng đã nhập, đi đủ công, chưa có điều chỉnh.
  const preview = useMemo(() => {
    if (!params) return null;
    const sandbox: PayrollWorkspace = {
      ...data,
      items: [...data.items.filter((row) => row.user_id !== person.id), ...fakeItems],
      adjustments: [],
    };
    try {
      return computeForPerson(person, sandbox, params, new Date(`${month}T00:00:00`), month, monthEnd, {
        statsOverride: fullMonthStats(params),
      });
    } catch {
      return null;
    }
  }, [data, fakeItems, month, monthEnd, params, person]);
  const lineByCode = useMemo(
    () => new Map((preview?.computed.lines ?? []).map((line) => [line.code, line])),
    [preview],
  );

  const scope = useMemo(
    () => formulaScopeOf(data.components, params, preview?.computed ?? null),
    [data.components, params, preview],
  );

  const draftFor = (componentId: string) => drafts.find((item) => item.componentId === componentId);

  // ---- Sửa -------------------------------------------------------------------
  const touch = (next: ItemDraft[]) => { setDrafts(next); setDirty(true); };
  /** Gõ MỘT ô: chỉ có một con số thì lưu như giá trị (VND), còn lại là công thức. */
  const setText = (componentId: string, text: string) => {
    const tokens = tokenizeFormula(text);
    const plain = tokens.length === 0 || (tokens.length === 1 && tokens[0].kind === 'num');
    const next: ItemDraft = plain
      ? { componentId, kind: 'VALUE', amount: tokens[0]?.kind === 'num' ? tokens[0].value : '', formula: '' }
      : { componentId, kind: 'FORMULA', formula: text, amount: '' };
    touch(draftFor(componentId)
      ? drafts.map((item) => (item.componentId === componentId ? next : item))
      : [...drafts, next]);
  };
  /** Mở ô khai riêng của một dòng: dòng công thức mang sẵn công thức để sửa, dòng giá trị mang sẵn số. */
  const startOverride = (row: MechanismRow) => {
    setFocusId(row.component.id);
    const base = sharedByComponent.get(row.component.id);
    const formula = base?.mode === 'FORMULA' ? base.formula ?? '' : '';
    const amount = base && base.mode !== 'FORMULA' && base.amount != null ? String(base.amount) : '';
    touch([...drafts, { componentId: row.component.id, kind: formula ? 'FORMULA' : 'VALUE', amount, formula }]);
  };
  const dropOverride = (componentId: string) => touch(drafts.filter((item) => item.componentId !== componentId));

  const addExtra = (componentId: string) => {
    if (draftFor(componentId)) return;
    setFocusId(componentId);
    touch([...drafts, { componentId, kind: 'VALUE', amount: '', formula: '' }]);
  };

  // ---- Kiểm tra --------------------------------------------------------------
  const issues = new Map<string, string>();
  for (const item of drafts) {
    if (item.kind === 'FORMULA') {
      if (!item.formula.trim()) { issues.set(item.componentId, 'Chưa có công thức.'); continue; }
      const issue = formulaIssueOf(tokenizeFormula(item.formula), scope, params?.functions ?? {}, nameOf);
      if (issue) issues.set(item.componentId, issue.message);
    } else if (item.amount.trim()) {
      const value = parseAmountText(item.amount);
      if (!(value != null && value >= 0)) issues.set(item.componentId, 'Phải là số không âm.');
    }
  }
  const missing = rows.filter((row) => row.mode === 'PER_PERSON' && row.amount == null);
  const changes = diffSchemeItems(saved, payloadItems).filter((change) => change.kind !== 'SAME');
  const hasChanges = changes.length > 0;

  // Nạp lại khi đổi người / tháng / dữ liệu mới về — trừ khi đang sửa dở.
  useEffect(() => {
    if (dirty && hasChanges) return;
    setDirty(false);
    setDrafts(saved.map(draftOf));
  }, [savedKey, person.id, month]); // eslint-disable-line react-hooks/exhaustive-deps

  const status = rows.length === 0
    ? { label: 'Chưa có cơ chế', tone: 'bg-red-50 text-red-600' }
    : missing.length > 0
      ? { label: `Thiếu ${missing.length} giá trị`, tone: 'bg-amber-50 text-amber-700' }
      : { label: 'Đủ', tone: 'bg-emerald-50 text-emerald-700' };

  const handleSave = async () => {
    if (issues.size > 0) { toast('Còn ô chưa hợp lệ — sửa các chỗ tô đỏ trước.', 'warning'); return; }
    if (!version) { toast(`Chưa có bộ tham số lương hiệu lực cho ${monthText(month)}.`, 'warning'); return; }
    setSaving(true);
    const error = await saveScheme({
      targetType: 'USER', userId: person.id, unitId: null, effectiveFrom: month, items: payloadItems,
    });
    setSaving(false);
    if (error) { toast('Không lưu được: ' + error, 'error'); return; }
    toast(`Đã lưu cơ chế lương của ${person.name} từ ${monthText(month)}.`, 'success');
    setDirty(false);
    onSaved();
  };

  // Chỉ đầu mục đã thiết lập cho người này: dòng đang áp (Từng người trước) và khoản khai riêng
  // đang soạn dở. Đầu mục khai riêng nổi lên đầu danh sách.
  const MODE_ORDER: Record<string, number> = { PER_PERSON: 0, VALUE: 1, FORMULA: 2, MONTHLY_INPUT: 3 };
  const rowIds = new Set(rows.map((row) => row.component.id));
  const keyword = normalizeText(filter);
  const options = [
    ...[...rows]
      .sort((a, b) => (MODE_ORDER[a.mode] ?? 9) - (MODE_ORDER[b.mode] ?? 9) || a.sortOrder - b.sortOrder)
      .map((row) => ({ component: row.component, row: row as MechanismRow | undefined })),
    // Khoản riêng vừa thêm, chưa điền gì nên chưa thành dòng.
    ...drafts
      .filter((item) => !rowIds.has(item.componentId))
      .flatMap((item) => {
        const component = componentById.get(item.componentId);
        return component ? [{ component, row: undefined as MechanismRow | undefined }] : [];
      }),
  ]
    .filter(({ component }) => !keyword || normalizeText(component.name).includes(keyword))
    .map((option, index) => ({ option, index, personal: drafts.some((item) => item.componentId === option.component.id) }))
    .sort((a, b) => Number(b.personal) - Number(a.personal) || a.index - b.index)
    .map((entry) => entry.option);
  const shownIds = new Set([...rowIds, ...drafts.map((item) => item.componentId)]);
  const candidates = data.components
    .filter((component) => component.is_active && !shownIds.has(component.id))
    .sort((a, b) => a.sort_order - b.sort_order);
  const groupOf = (component: PayComponent) => (component.category_code
    ? data.categories.find((category) => category.code === component.category_code)?.name ?? component.category_code
    : 'Dòng trung gian');
  const safePage = clampPage(page, options.length);
  const pageOptions = options.slice((safePage - 1) * ITEMS_PER_PAGE, safePage * ITEMS_PER_PAGE);
  const hasMonthly = rows.some((row) => row.mode === 'MONTHLY_INPUT');

  // Dòng vừa tích: sang đúng trang của nó.
  const optionKey = options.map(({ component }) => component.id).join(',');
  useEffect(() => {
    if (!focusId) return undefined;
    const index = options.findIndex(({ component }) => component.id === focusId);
    if (index >= 0) setPage(Math.floor(index / ITEMS_PER_PAGE) + 1);
    const timer = window.setTimeout(() => setFocusId(null), 400);
    return () => window.clearTimeout(timer);
  }, [focusId, optionKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const entriesFor = (code: string) => buildFormulaEntries({
    rowComponents: rows.map((row) => row.component),
    catalog: data.components,
    version,
    sampleValues: preview?.computed.values,
    excludeCode: code,
    includeCatalog: false,
  });

  return (
    <>
      <Card className="!rounded-none">
        <CardHeader className="flex flex-wrap items-center gap-3">
          {onBack && (
            <Button size="sm" variant="ghost" onClick={onBack} aria-label="Quay lại danh sách">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          )}
          <Avatar name={person.name} url={person.avatar_url} size="md" />
          <div className="min-w-0 flex-1">
            <CardTitle>{person.name}</CardTitle>
            <p className="text-xs text-slate-500">
              {person.employee_code ?? '—'} · {unitName ?? (person.department || 'Chưa có đơn vị')}
            </p>
          </div>
          <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${status.tone}`}>{status.label}</span>
          <Button size="sm" variant="outline" onClick={onDryRun}>
            <FlaskConical className="h-4 w-4" /> Chạy thử
          </Button>
          {hasMonthly && (
            <Button size="sm" variant="outline" onClick={onOpenInputs}>
              <SlidersHorizontal className="h-4 w-4" /> Số liệu tháng
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-3">
          {month > monthStart && (
            <p className="rounded-none bg-slate-50 px-3 py-2 text-xs text-slate-600">
              Tháng {monthText(monthStart)} đã chốt lương — bản lưu sẽ áp dụng từ {monthText(month)}.
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
            {rows.length > 0 && (
              <Button size="sm" variant="outline" className="sm:ml-auto" onClick={() => setSheetOpen(true)}>
                <FileText className="h-4 w-4" /> Xem công thức dạng chữ
              </Button>
            )}
          </div>

          {rows.length === 0 && (
            <p className="rounded-none bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Đơn vị của người này chưa có cơ chế chung — phiếu lương sẽ ra 0đ. Khai ở tab “Cơ chế chung” của đơn vị
              {readOnly ? '.' : ', hoặc bấm “Thêm đầu mục” để khai riêng.'}
            </p>
          )}

          {options.length === 0 ? (
            <p className="rounded-none border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-500">
              {keyword ? `Không có đầu mục nào khớp “${filter.trim()}”.` : 'Chưa có đầu mục nào.'}
            </p>
          ) : (
            <>
              <PagedList page={safePage} total={options.length} onPage={setPage}>
                {pageOptions.map(({ component, row }) => {
                  const id = component.id;
                  const item = draftFor(id);
                  const ticked = !!item;
                  const issue = issues.get(id);
                  const line = row ? lineByCode.get(component.code) : undefined;
                  const shared = sharedByComponent.get(id);
                  const lackValue = !ticked && shared?.mode === 'PER_PERSON' && shared.amount == null;
                  return (
                    <div key={id} className={`rounded-none border px-2.5 py-2.5 ${issue ? 'border-red-200' : ticked ? 'border-indigo-200 bg-white' : 'border-slate-200'}`}>
                      <div className="flex items-start gap-3">
                        <div className="min-w-0 flex-1">
                          {item ? (
                            <FormulaInput
                              value={item.kind === 'VALUE' ? item.amount : item.formula}
                              onChange={(text) => setText(id, text)}
                              entries={entriesFor(component.code)}
                              scope={scope}
                              functions={params?.functions}
                              leftLabel={component.name}
                              ariaLabel={`Khai riêng ${component.name}`}
                              formatResult={(value) => formatFormulaNumber(component.kind === 'INFO' ? value : Math.round(value))}
                              disabled={readOnly}
                              autoFocus={focusId === id}
                              resultOnly
                            />
                          ) : (
                            <div className="flex min-h-9 items-center gap-3">
                              <span className="min-w-0 flex-1">
                                <span className={`block truncate text-sm font-semibold ${
                                  !row ? 'text-slate-500' : component.kind === 'DEDUCTION' ? 'text-red-600' : 'text-slate-800'
                                }`}>
                                  {component.name}
                                </span>
                                {lackValue && (
                                  <span className="block truncate text-xs font-semibold text-red-600">Chưa khai — bấm bút chì để điền</span>
                                )}
                              </span>
                              {row && (
                                <span
                                  title="Giá trị tính được nếu đi đủ công"
                                  className={`shrink-0 text-right text-sm font-bold tabular-nums ${line?.failed ? 'text-amber-600' : 'text-slate-900'}`}
                                >
                                  {line ? formatFormulaNumber(line.amount) : '—'}
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                        {!readOnly && (ticked || shared) && (
                          <button
                            type="button"
                            onClick={() => (ticked ? dropOverride(id) : shared && startOverride(shared))}
                            title={ticked ? (shared ? 'Bỏ khai riêng, về mức chung' : 'Bỏ đầu mục khỏi người này') : 'Khai riêng cho người này'}
                            aria-label={`${ticked ? 'Bỏ khai riêng' : 'Khai riêng'} ${component.name}`}
                            className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors ${
                              ticked ? 'text-slate-400 hover:bg-red-50 hover:text-red-600'
                                : lackValue ? 'text-red-500 hover:bg-red-50' : 'text-slate-400 hover:bg-indigo-50 hover:text-indigo-600'
                            }`}
                          >
                            {ticked ? <Trash2 className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </PagedList>
              <Pager page={safePage} total={options.length} onPage={setPage} />
            </>
          )}

          {preview && preview.computed.warnings.length > 0 && (
            <p className="flex items-start gap-2 rounded-none bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
              <TriangleAlert className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
              {preview.computed.warnings.join(' · ')}
            </p>
          )}
        </CardContent>
      </Card>

      <BankAccountCard person={person} account={account} canManage={canManage} onSaved={onAccountSaved} />

      {dirty && hasChanges && !readOnly && (
        <div className="fixed bottom-0 left-0 right-0 z-30 border-t border-slate-200 bg-white/95 px-4 py-3 shadow-lg backdrop-blur-md print:hidden">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 lg:pl-64">
            <p className={`flex items-center gap-1.5 text-sm ${issues.size > 0 ? 'text-red-600' : 'text-slate-600'}`}>
              {issues.size > 0
                ? <><TriangleAlert className="h-4 w-4" /> {issues.size} ô chưa hợp lệ</>
                : <><Save className="h-4 w-4" /> {changes.length} thay đổi chưa lưu — áp dụng từ {monthText(month)}</>}
            </p>
            <div className="flex gap-2">
              <Button variant="secondary" disabled={saving} onClick={() => { setDirty(false); setDrafts(saved.map(draftOf)); }}>
                Huỷ thay đổi
              </Button>
              <Button onClick={() => void handleSave()} disabled={saving || issues.size > 0}>
                <Save className="h-4 w-4" /> {saving ? 'Đang lưu…' : 'Lưu'}
              </Button>
            </div>
          </div>
        </div>
      )}

      <MechanismAddDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        candidates={candidates}
        groupOf={groupOf}
        onPick={(component) => addExtra(component.id)}
      />

      <FormulaSheetModal
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        subject={person.name}
        rows={rows}
        nameOf={nameOf}
        categories={data.categories}
        rounding={params ? { unit: params.netRoundingUnit, mode: params.netRoundingMode } : null}
      />
    </>
  );
}
