// ============================================================================
// Thiết kế cơ chế lương — mỗi đầu mục một cách tính.
// ----------------------------------------------------------------------------
// Một cơ chế (ví dụ "Khối Văn phòng") là danh sách đầu mục lấy từ Danh mục.
// Mỗi dòng chọn một cách lấy giá trị:
//
//   Công thức    [Lương cơ bản] ÷ [Công chuẩn của tháng] × [Ngày công thực tế]
//   Giá trị      một con số chung, từng người / đơn vị khai riêng được
//   Từng người   khai cho từng người ở tab Áp dụng (lương cơ bản, số NPT…)
//   Hằng tháng   nhập mỗi tháng ở màn Số liệu lương tháng
//
// Đầu mục đã có trong cơ chế là biến của các dòng khác (dòng B dùng kết quả
// dòng A). Thực lĩnh là dòng cuối, tự động: tổng các dòng cộng − tổng các
// dòng trừ. Mọi dòng tính lại NGAY với dữ liệu thử để người khai thấy số.
//
// Lưu là lưu TRỌN cơ chế, hiệu lực từ một tháng: kỳ đã tính không bị đổi.
// ============================================================================

import { useEffect, useMemo, useState, type DragEvent } from 'react';
import {
  ArrowDown, ArrowUp, Check, ChevronDown, ChevronRight, Copy, FlaskConical, GitBranch, GripVertical, Layers3,
  Pencil, Plus, Power, Save, Search, Sparkles, Trash2, TriangleAlert, UsersRound,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input, Textarea } from '@/components/ui/Input';
import { Dropdown } from '@/components/ui/Dropdown';
import { FormulaInput } from '@/components/payroll/formula/FormulaInput';
import { ITEMS_PER_PAGE, PagedList, Pager, clampPage } from '@/components/payroll/Pager';
import { UnitTreeList, flattenUnitTree } from '@/components/payroll/UnitTree';
import { useToast } from '@/contexts/ToastContext';
import { useConfirm } from '@/contexts/ConfirmContext';
import { useAppSettings } from '@/contexts/SettingsContext';
import { formatVND, getTodayString } from '@/lib/utils';
import {
  computePayslip, orderMechanismRows, systemScope, type ComputedPayslip, type MechanismRow,
} from '@/lib/payroll';
import {
  describeFormula, formatFormulaNumber, formulaIssueOf, normalizeText, referencedCodes, tokenizeFormula,
  type FormulaEntry,
} from '@/lib/formulaTokens';
import { buildFormulaEntries } from '@/lib/formulaEntries';
import { codeFromName, firstEditableMonth } from '@/lib/payrollSettings';
import {
  ROW_MODE_LABEL, type RowMode,
} from '@/lib/payrollVariables';
import { resolveTemplateForUnit, rowModeOf, templateRowsAt } from '@/lib/payrollScheme';
import { nameResolver, paramsForMonth, unitMapOf } from '@/lib/payrollRun';
import {
  assignTemplate, deleteTemplate, saveMechanism, saveTemplate, seedMechanismDefaults,
  type PayrollWorkspace,
} from '@/lib/payrollData';
import type {
  OrganizationUnit, PayComponent, PayrollTemplate, PayrollTemplateItem,
} from '@/types';

interface MechanismDesignerProps {
  data: PayrollWorkspace;
  /** Tháng đang xem ở trang — mặc định cho "hiệu lực từ". */
  monthStart: string;
  lastClosedMonth: string | null;
  /** Được sửa công thức cơ chế. */
  canManage: boolean;
  onChanged: () => void;
  onDryRun: (templateId: string) => void;
}

interface DraftRow {
  componentId: string;
  mode: RowMode;
  formula: string;
  amount: string;
  note: string;
}

const monthText = (iso: string) => (iso.startsWith('2000-01') ? 'trước đây' : `${iso.slice(5, 7)}/${iso.slice(0, 4)}`);

function monthEndOf(monthStart: string): string {
  const [year, month] = monthStart.split('-').map(Number);
  return `${monthStart.slice(0, 7)}-${String(new Date(year, month, 0).getDate()).padStart(2, '0')}`;
}

/** Ô số: trống là null, gõ sai là NaN (để báo lỗi đúng ô). Nhận "1.000.000" và "1,5". */
const parseAmount = (text: string): number | null => {
  if (!text.trim()) return null;
  const value = Number(/^\d{1,3}(\.\d{3})+$/.test(text.trim()) ? text.replace(/\./g, '') : text.replace(',', '.'));
  return Number.isFinite(value) ? value : Number.NaN;
};

/** Số dùng để tính: lỗi định dạng thì coi như chưa khai. */
const amountOf = (text: string): number | null => {
  const value = parseAmount(text);
  return value != null && Number.isFinite(value) ? value : null;
};

const toDraft = (item: PayrollTemplateItem, defaultAmount = 0): DraftRow => {
  const mode = rowModeOf(item);
  if (mode === 'VALUE') {
    // Dòng "giá trị" cũ: số riêng của dòng, trống thì theo mức mặc định của danh mục.
    const value = item.amount == null ? defaultAmount : Number(item.amount);
    return { componentId: item.component_id, mode: 'FORMULA', formula: String(value), amount: '', note: item.note ?? '' };
  }
  return {
    componentId: item.component_id,
    mode,
    formula: item.formula ?? '',
    amount: item.amount == null ? '' : String(Number(item.amount)),
    note: item.note ?? '',
  };
};

export function MechanismDesigner({
  data, monthStart, lastClosedMonth, canManage, onChanged, onDryRun,
}: MechanismDesignerProps) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const app = useAppSettings();

  const minMonth = firstEditableMonth(lastClosedMonth, getTodayString());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [month, setMonth] = useState(() => (monthStart >= minMonth ? monthStart : minMonth));
  const [draft, setDraft] = useState<DraftRow[]>([]);
  const [dirty, setDirty] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const [rowPage, setRowPage] = useState(1);
  const [templateForm, setTemplateForm] = useState<{
    id?: string; name: string; description: string; start: 'EMPTY' | 'COPY' | 'VAN_PHONG' | 'KINH_DOANH'; copyFrom: string;
  } | null>(null);
  const [assigning, setAssigning] = useState<{ unit: OrganizationUnit | null; remove: boolean; month: string } | null>(null);
  const [unitQuery, setUnitQuery] = useState('');
  const [rowQuery, setRowQuery] = useState('');

  const monthEnd = monthEndOf(month);
  const readOnly = !canManage || month < minMonth;
  const componentById = useMemo(() => new Map(data.components.map((c) => [c.id, c])), [data.components]);
  const template = data.templates.find((item) => item.id === selectedId) ?? null;
  const unitById = useMemo(() => unitMapOf(data), [data]);
  const unitRows = useMemo(() => flattenUnitTree(data.units), [data.units]);
  const fromItem = (item: PayrollTemplateItem) => toDraft(item, Number(componentById.get(item.component_id)?.default_amount ?? 0));

  useEffect(() => { if (!assigning) setUnitQuery(''); }, [assigning]);

  useEffect(() => {
    if (!selectedId && data.templates.length > 0) {
      setSelectedId((data.templates.find((item) => item.is_active) ?? data.templates[0]).id);
    }
  }, [data.templates, selectedId]);

  const savedRows = useMemo(
    () => (template ? templateRowsAt(data.templateItems, template.id, month, monthEnd) : []),
    [data.templateItems, month, monthEnd, template],
  );
  const savedKey = savedRows.map((row) => `${row.id}:${row.formula}:${row.amount}:${row.mode}:${row.sort_order}`).join('|');

  // Nạp lại bộ dòng khi đổi cơ chế / tháng / dữ liệu mới về — trừ khi đang sửa dở.
  useEffect(() => {
    if (dirty) return;
    setDraft(savedRows.map(fromItem));
  }, [savedKey, template?.id, month]); // eslint-disable-line react-hooks/exhaustive-deps

  const guardDirty = async (): Promise<boolean> => {
    if (!dirty) return true;
    const ok = await confirm({
      title: 'Bỏ các thay đổi chưa lưu?',
      message: 'Cơ chế đang có thay đổi chưa lưu. Chuyển đi sẽ mất các thay đổi đó.',
      confirmLabel: 'Bỏ thay đổi',
      danger: true,
    });
    if (ok) setDirty(false);
    return ok;
  };

  const updateDraft = (next: DraftRow[]) => {
    setDraft(next);
    setDirty(true);
  };
  const patchRow = (index: number, patch: Partial<DraftRow>) =>
    updateDraft(draft.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  // ---- Tham số, dữ liệu thử ------------------------------------------------
  const version = useMemo(
    () => [...data.paramVersions].filter((item) => item.effectiveFrom <= month)
      .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0] ?? null,
    [data.paramVersions, month],
  );
  const params = useMemo(
    () => paramsForMonth(data, app, new Date(`${month}T00:00:00`), month),
    [app, data, month],
  );
  const nameOf = useMemo(() => nameResolver(data.components, params), [data.components, params]);

  const draftRows: MechanismRow[] = useMemo(() => draft
    .map((row, index) => {
      const component = componentById.get(row.componentId);
      if (!component) return null;
      return {
        component,
        mode: row.mode,
        formula: row.formula.trim() || null,
        amount: amountOf(row.amount),
        sortOrder: (index + 1) * 10,
        origin: template?.name ?? null,
      } satisfies MechanismRow;
    })
    .filter((row): row is MechanismRow => !!row), [componentById, draft, template?.name]);

  // Tính nhanh với số giả định (đủ công chuẩn, chưa có số liệu tháng) để mỗi dòng hiện kết quả.
  const result: ComputedPayslip | null = useMemo(() => {
    if (!params || !template) return null;
    const workDays = params.standardDays;
    return computePayslip({
      profile: { id: 'sample', name: 'Nhân viên mẫu' },
      rows: draftRows,
      stats: {
        workDays, leaveDays: 0, holidayDays: 0, paidDays: workDays,
        workHours: workDays * (params.hoursPerDay || 8), missingCheckout: 0,
        lateMinutes: 0, lateCount: 0, lateAfterCutoffCount: 0,
        earlyMinutes: 0, earlyCount: 0,
      },
      params,
      inputs: {},
      catalogCodes: data.components.map((component) => component.code),
      nameOf,
    });
  }, [data.components, draftRows, nameOf, params, template]);

  /** Phạm vi biến để kiểm tra công thức: dữ liệu thử + tham số + mọi đầu mục. */
  const scope = useMemo(() => {
    const base: Record<string, number> = {};
    for (const component of data.components) base[component.code] = 0;
    const stats = result?.stats ?? {
      workDays: params?.standardDays ?? 0, leaveDays: 0, holidayDays: 0, paidDays: params?.standardDays ?? 0,
      workHours: 0, missingCheckout: 0, lateMinutes: 0, lateCount: 0, lateAfterCutoffCount: 0, earlyMinutes: 0, earlyCount: 0,
    };
    return {
      ...base,
      ...(params?.values ?? {}),
      ...systemScope(stats, params ?? { standardDays: 0, hoursPerDay: 8 }),
      ...(result?.values ?? {}),
      MUC_RIENG: 1,
    } as Record<string, number>;
  }, [data.components, params, result]);

  const rowCodes = useMemo(() => new Set(draftRows.map((row) => row.component.code)), [draftRows]);
  const softCodes = useMemo(
    () => new Set(data.components.filter((component) => !rowCodes.has(component.code)).map((component) => component.code)),
    [data.components, rowCodes],
  );

  const { cyclic } = useMemo(() => orderMechanismRows(draftRows), [draftRows]);

  // Đầu mục mà công thức đang gọi nhưng cơ chế chưa có dòng — thiếu thì phần đó
  // tính bằng 0, nên nhắc và cho thêm bằng một cú bấm.
  const missingRefs = useMemo(() => {
    const byCode = new Map(data.components.map((component) => [component.code.toUpperCase(), component]));
    const found = new Map<string, PayComponent>();
    for (const row of draft) {
      if (row.mode !== 'FORMULA') continue;
      for (const code of referencedCodes(row.formula)) {
        const component = byCode.get(code.toUpperCase());
        if (component && !rowCodes.has(component.code) && component.is_active) found.set(component.id, component);
      }
    }
    return [...found.values()];
  }, [data.components, draft, rowCodes]);

  // Lấy các dòng còn thiếu từ một cơ chế khác (mặc định Cơ chế chung).
  const [pullFromId, setPullFromId] = useState('');
  const otherTemplates = useMemo(
    () => data.templates.filter((item) => item.id !== template?.id && item.is_active),
    [data.templates, template?.id],
  );
  const pullSource = otherTemplates.find((item) => item.id === pullFromId)
    ?? otherTemplates.find((item) => item.code === 'CO_CHE_CHUNG') ?? otherTemplates[0];
  const pullRows = useMemo(() => {
    if (!pullSource) return [];
    const have = new Set(draft.map((row) => row.componentId));
    return templateRowsAt(data.templateItems, pullSource.id, month, monthEnd)
      .filter((item) => !have.has(item.component_id));
  }, [data.templateItems, draft, month, monthEnd, pullSource]);

  const pullMissing = () => {
    if (pullRows.length === 0) return;
    updateDraft([...draft, ...pullRows.map(fromItem)]);
    toast(`Đã thêm ${pullRows.length} dòng từ “${pullSource?.name}” — rà lại công thức rồi lưu.`, 'success');
  };
  const addMissing = (components: PayComponent[]) => {
    const fresh = components.filter((component) => !draft.some((row) => row.componentId === component.id));
    if (fresh.length === 0) return;
    const fromSource = new Map(pullRows.map((item) => [item.component_id, item]));
    updateDraft([...draft, ...fresh.map((component) => {
      const source = fromSource.get(component.id);
      if (source) return fromItem(source);
      const preset = Number(component.default_amount) > 0 ? String(Number(component.default_amount)) : '';
      return { componentId: component.id, mode: (component.kind === 'INFO' ? 'PER_PERSON' : 'FORMULA') as RowMode, formula: preset, amount: '', note: '' };
    })]);
  };
  const rowIssues = draft.map((row) => {
    const component = componentById.get(row.componentId);
    if (!component) return 'Đầu mục không còn trong danh mục.';
    if (cyclic.has(component.code)) return 'Dòng này nằm trong một vòng lặp công thức.';
    if (row.mode === 'FORMULA') {
      if (!row.formula.trim()) return 'Chưa có công thức.';
      const issue = formulaIssueOf(tokenizeFormula(row.formula), scope, params?.functions ?? {}, nameOf);
      if (issue) return issue.message;
    }
    if (row.mode === 'VALUE') {
      const amount = parseAmount(row.amount);
      if (amount != null && !(amount >= 0)) return 'Giá trị phải là số không âm.';
    }
    return null;
  });
  const issueCount = rowIssues.filter(Boolean).length;

  const usedBy = (code: string) => draft
    .filter((row) => row.mode === 'FORMULA' && referencedCodes(row.formula).includes(code))
    .map((row) => componentById.get(row.componentId)?.name)
    .filter((name): name is string => !!name);

  // ---- Thêm / bỏ / sắp dòng ------------------------------------------------
  const addRow = (component: PayComponent, mode?: RowMode) => {
    if (draft.some((row) => row.componentId === component.id)) return;
    const nextMode: RowMode = mode ?? 'FORMULA';
    const preset = nextMode === 'FORMULA' && Number(component.default_amount) > 0 ? String(Number(component.default_amount)) : '';
    updateDraft([...draft, { componentId: component.id, mode: nextMode, formula: preset, amount: '', note: '' }]);
    setExpanded(component.id);
  };

  const removeRow = async (index: number) => {
    const component = componentById.get(draft[index].componentId);
    const users = component ? usedBy(component.code) : [];
    if (users.length > 0) {
      const ok = await confirm({
        title: `Bỏ “${component?.name}” khỏi cơ chế?`,
        message: `Dòng này đang được dùng ở: ${users.join(', ')}. Bỏ đi thì các công thức đó tính phần này bằng 0.`,
        confirmLabel: 'Vẫn bỏ',
        danger: true,
      });
      if (!ok) return;
    }
    updateDraft(draft.filter((_, i) => i !== index));
  };

  const moveRow = (from: number, to: number) => {
    if (to < 0 || to >= draft.length || from === to) return;
    const next = [...draft];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    updateDraft(next);
  };

  const onDragStart = (index: number) => (event: DragEvent) => {
    setDragIndex(index);
    event.dataTransfer.effectAllowed = 'move';
  };
  const onDrop = (index: number) => (event: DragEvent) => {
    event.preventDefault();
    if (dragIndex != null) moveRow(dragIndex, index);
    setDragIndex(null);
    setOverIndex(null);
  };

  const onAddEntry = (entry: FormulaEntry) => {
    const component = entry.componentId ? componentById.get(entry.componentId) : undefined;
    if (!component || draft.some((row) => row.componentId === component.id)) return;
    // Đầu mục được gọi từ một công thức: thêm dòng nhưng không mở nó ra, để
    // người dùng gõ tiếp công thức đang dở.
    const nextMode: RowMode = component.kind === 'INFO' ? 'PER_PERSON' : 'FORMULA';
    const preset = nextMode === 'FORMULA' && Number(component.default_amount) > 0 ? String(Number(component.default_amount)) : '';
    setDraft((current) => [...current, { componentId: component.id, mode: nextMode, formula: preset, amount: '', note: '' }]);
    setDirty(true);
    toast(`Đã thêm “${component.name}” vào cơ chế — khai cách tính cho dòng đó sau.`, 'success');
  };

  // ---- Lưu -----------------------------------------------------------------
  const handleSave = async () => {
    if (!template) return;
    if (issueCount > 0) {
      toast('Còn dòng chưa hợp lệ — sửa các dòng tô đỏ trước khi lưu.', 'warning');
      return;
    }
    const ok = await confirm({
      title: `Lưu cơ chế “${template.name}”?`,
      message: `Áp dụng từ kỳ lương ${monthText(month)} cho mọi người theo cơ chế này. Các tháng trước giữ nguyên.`,
      confirmLabel: 'Lưu cơ chế',
    });
    if (!ok) return;
    setSaving(true);
    const error = await saveMechanism(template.id, month, draft.map((row) => ({
      component_id: row.componentId,
      mode: row.mode,
      formula: row.mode === 'FORMULA' ? row.formula.trim() || null : null,
      amount: null,
      note: row.note.trim() || null,
    })));
    setSaving(false);
    if (error) {
      toast('Lưu cơ chế thất bại: ' + error, 'error');
      return;
    }
    toast(`Đã lưu cơ chế “${template.name}”, hiệu lực từ ${monthText(month)}.`, 'success');
    setDirty(false);
    onChanged();
  };

  // ---- Cơ chế: tạo, sửa, gán -----------------------------------------------
  const saveTemplateForm = async () => {
    if (!templateForm) return;
    const name = templateForm.name.trim();
    if (!name) { toast('Nhập tên cơ chế.', 'warning'); return; }
    const existing = data.templates.find((item) => item.id === templateForm.id);
    const code = existing?.code ?? codeFromName(name, data.templates.map((item) => item.code), 'CO_CHE');
    setSaving(true);
    const { id, error } = await saveTemplate({
      ...(existing ? { id: existing.id, is_active: existing.is_active } : {}),
      code, name, description: templateForm.description.trim() || null,
    });
    if (error || !id) {
      setSaving(false);
      toast('Lưu cơ chế thất bại: ' + (error ?? 'không rõ lỗi'), 'error');
      return;
    }
    if (!existing && templateForm.start === 'COPY' && templateForm.copyFrom) {
      const rows = templateRowsAt(data.templateItems, templateForm.copyFrom, month, monthEnd);
      const copyError = await saveMechanism(id, month, rows.map((row) => ({
        component_id: row.component_id, mode: rowModeOf(row), formula: row.formula, amount: row.amount == null ? null : Number(row.amount), note: row.note,
      })));
      if (copyError) toast('Đã tạo cơ chế nhưng chưa chép được dòng: ' + copyError, 'warning');
    }
    if (!existing && (templateForm.start === 'VAN_PHONG' || templateForm.start === 'KINH_DOANH')) {
      const { error: seedError } = await seedMechanismDefaults(id, month, templateForm.start);
      if (seedError) toast('Đã tạo cơ chế nhưng chưa nạp được mẫu gợi ý: ' + seedError, 'warning');
    }
    setSaving(false);
    toast(existing ? 'Đã cập nhật cơ chế.' : `Đã tạo cơ chế “${name}”.`, 'success');
    setTemplateForm(null);
    setDirty(false);
    setSelectedId(id);
    onChanged();
  };

  const seedInto = async (variant: 'VAN_PHONG' | 'KINH_DOANH') => {
    if (!template) return;
    setSaving(true);
    const { count, error } = await seedMechanismDefaults(template.id, month, variant);
    setSaving(false);
    if (error) { toast(error, 'error'); return; }
    toast(`Đã nạp ${count} dòng gợi ý — xem lại từng công thức trước khi áp dụng.`, 'success');
    setDirty(false);
    onChanged();
  };

  const toggleActive = async (target: PayrollTemplate) => {
    const { error } = await saveTemplate({ ...target, is_active: !target.is_active });
    if (error) { toast(error, 'error'); return; }
    toast(target.is_active ? 'Đã ngừng dùng cơ chế.' : 'Đã dùng lại cơ chế.', 'success');
    onChanged();
  };

  const removeTemplate = async (target: PayrollTemplate) => {
    const ok = await confirm({
      title: `Xoá cơ chế “${target.name}”?`,
      message: 'Chỉ xoá được cơ chế chưa từng gán cho đơn vị hay nhân sự nào. Cơ chế đã dùng thì chuyển Ngừng dùng.',
      confirmLabel: 'Xoá cơ chế',
      danger: true,
    });
    if (!ok) return;
    const error = await deleteTemplate(target.id);
    if (error) { toast(error, 'error'); return; }
    setSelectedId(null);
    setDirty(false);
    onChanged();
  };

  const directUnits = (templateId: string) => data.units.filter((unit) => {
    const latest = data.unitTemplates
      .filter((row) => row.unit_id === unit.id && row.effective_from <= month)
      .sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0];
    return latest?.template_id === templateId;
  });
  const peopleOn = (templateId: string) => data.profiles.filter((person) => {
    const own = data.payProfiles
      .filter((row) => row.user_id === person.id && row.effective_from <= monthEnd)
      .sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0];
    if (own?.template_id) return own.template_id === templateId;
    return !!person.unit_id
      && resolveTemplateForUnit(person.unit_id, { templates: data.templates, unitTemplates: data.unitTemplates, unitById }, month)
        .template?.id === templateId;
  });

  const saveAssignment = async () => {
    if (!assigning?.unit || !template) { toast('Chọn đơn vị trên cây.', 'warning'); return; }
    setSaving(true);
    const error = await assignTemplate(assigning.unit.id, assigning.remove ? null : template.id, assigning.month);
    setSaving(false);
    if (error) { toast('Gán thất bại: ' + error, 'error'); return; }
    toast(assigning.remove ? `${assigning.unit.name} thôi dùng cơ chế.` : `Đã gán “${template.name}” cho ${assigning.unit.name}.`, 'success');
    setAssigning(null);
    onChanged();
  };

  // ---- Giao diện -------------------------------------------------------------
  const unitKeyword = normalizeText(unitQuery);
  const filteredUnitRows = unitKeyword
    ? unitRows.filter((row) => normalizeText(row.unit.name).includes(unitKeyword))
    : unitRows;
  const units = template ? directUnits(template.id) : [];
  const people = template ? peopleOn(template.id) : [];
  const rowKeyword = normalizeText(rowQuery);
  const matchesRow = (component: PayComponent) => !rowKeyword || normalizeText(component.name).includes(rowKeyword);
  const unticked = data.components.filter((component) => component.is_active
    && !draft.some((row) => row.componentId === component.id) && matchesRow(component));
  // Một trang ITEMS_PER_PAGE đầu mục, tính trên cả dòng đã tích lẫn chưa tích.
  const listedIds = [
    ...draft.filter((row) => { const c = componentById.get(row.componentId); return !c || matchesRow(c); }).map((row) => row.componentId),
    ...(readOnly ? [] : unticked.map((component) => component.id)),
  ];
  const safePage = clampPage(rowPage, listedIds.length);
  const pageIds = new Set(listedIds.slice((safePage - 1) * ITEMS_PER_PAGE, safePage * ITEMS_PER_PAGE));

  return (
    <div className="grid gap-4 lg:grid-cols-[15rem_minmax(0,1fr)]">
      {/* --- Danh sách cơ chế --- */}
      <div className="space-y-2">
        {canManage && (
          <Button variant="outline" className="w-full" onClick={() => setTemplateForm({ name: '', description: '', start: 'EMPTY', copyFrom: '' })}>
            <Plus className="h-4 w-4" /> Tạo cơ chế
          </Button>
        )}
        {data.templates.length === 0 && (
          <p className="rounded-xl border border-dashed border-slate-200 px-3 py-6 text-center text-sm text-slate-500">Chưa có cơ chế nào.</p>
        )}
        {data.templates.map((item) => {
          const count = templateRowsAt(data.templateItems, item.id, month, monthEnd).length;
          return (
            <button
              key={item.id}
              type="button"
              onClick={async () => { if (item.id !== selectedId && await guardDirty()) { setSelectedId(item.id); setExpanded(null); setRowPage(1); } }}
              className={`w-full rounded-xl border px-3.5 py-3 text-left transition ${
                item.id === selectedId ? 'border-indigo-500 bg-indigo-50 ring-2 ring-indigo-500/20' : 'border-slate-200 bg-white hover:border-indigo-300'
              } ${item.is_active ? '' : 'opacity-60'}`}
            >
              <span className="block text-sm font-bold text-slate-800">{item.name}</span>
              <span className="mt-0.5 block text-xs text-slate-500">
                {count} đầu mục · {peopleOn(item.id).length} người{item.is_active ? '' : ' · ngừng dùng'}
              </span>
            </button>
          );
        })}
      </div>

      {/* --- Cơ chế đang chọn --- */}
      {!template ? (
        <Card><CardContent className="py-12 text-center text-sm text-slate-500">Chọn hoặc tạo một cơ chế lương.</CardContent></Card>
      ) : (
        <div className="min-w-0 space-y-4 pb-24">
          <Card>
            <CardContent className="space-y-3 py-4">
              <div className="flex flex-wrap items-start gap-3">
                <div className="min-w-0 flex-1">
                  <h3 className="text-lg font-bold text-slate-900">{template.name}</h3>
                  {template.description && <p className="mt-0.5 text-sm text-slate-500">{template.description}</p>}
                </div>
                <div className="w-40">
                  <Input
                    label="Hiệu lực từ tháng"
                    type="month"
                    value={month.slice(0, 7)}
                    onChange={async (event) => {
                      const next = event.target.value ? `${event.target.value}-01` : '';
                      if (next && next !== month && await guardDirty()) setMonth(next);
                    }}
                  />
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <UsersRound className="h-4 w-4 text-slate-400" />
                <span className="text-xs font-semibold text-slate-500">Áp dụng cho:</span>
                {units.length === 0 && <span className="text-xs text-slate-400">chưa gán đơn vị nào</span>}
                {units.map((unit) => (
                  <span key={unit.id} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">
                    {unit.name}
                    {canManage && (
                      <button type="button" aria-label={`Bỏ cơ chế khỏi ${unit.name}`} className="text-slate-400 hover:text-red-600"
                        onClick={() => setAssigning({ unit, remove: true, month: month < minMonth ? minMonth : month })}>×</button>
                    )}
                  </span>
                ))}
                <span className="text-xs text-slate-400">· {people.length} nhân sự đang theo</span>
                <div className="ml-auto flex flex-wrap gap-1.5">
                  {canManage && (
                    <Button size="sm" variant="outline" onClick={() => setAssigning({ unit: null, remove: false, month: month < minMonth ? minMonth : month })}>
                      <GitBranch className="h-3.5 w-3.5" /> Gán cho đơn vị
                    </Button>
                  )}
                  <Button size="sm" variant="outline" onClick={() => onDryRun(template.id)}>
                    <FlaskConical className="h-3.5 w-3.5" /> Chạy thử
                  </Button>
                  {canManage && (
                    <>
                      <Button size="sm" variant="ghost" aria-label="Sửa tên cơ chế"
                        onClick={() => setTemplateForm({ id: template.id, name: template.name, description: template.description ?? '', start: 'EMPTY', copyFrom: '' })}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => void toggleActive(template)} aria-label={template.is_active ? 'Ngừng dùng' : 'Dùng lại'}>
                        <Power className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => void removeTemplate(template)} aria-label="Xoá cơ chế">
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </>
                  )}
                </div>
              </div>
              {readOnly && canManage && (
                <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                  Kỳ {monthText(month)} đã chốt lương nên chỉ xem được. Đổi “Hiệu lực từ tháng” sang {monthText(minMonth)} trở đi để sửa.
                </p>
              )}
              {!params && (
                <p className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  <TriangleAlert className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                  Chưa có bộ tham số lương hiệu lực cho tháng này — khai ở Tham số lương để công thức tính thử được.
                </p>
              )}
            </CardContent>
          </Card>

          <div>
            {/* --- Các dòng của cơ chế --- */}
            <div className="min-w-0 space-y-2">
              {!readOnly && canManage && (missingRefs.length > 0 || (draft.length > 0 && pullRows.length > 0)) && (
                <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-900">
                  {missingRefs.length > 0 && (
                    <div className="flex flex-wrap items-center gap-2">
                      <TriangleAlert className="h-3.5 w-3.5 flex-shrink-0" />
                      <span>
                        Công thức đang dùng {missingRefs.length} đầu mục chưa có dòng trong cơ chế (phần đó tính bằng 0):
                      </span>
                      {missingRefs.map((component) => (
                        <button key={component.id} type="button" onClick={() => addMissing([component])}
                          className="rounded-md bg-white px-2 py-0.5 font-semibold text-amber-800 ring-1 ring-amber-300 hover:bg-amber-100">
                          + {component.name}
                        </button>
                      ))}
                      {missingRefs.length > 1 && (
                        <button type="button" onClick={() => addMissing(missingRefs)} className="font-bold underline">Thêm tất cả</button>
                      )}
                    </div>
                  )}
                  {draft.length > 0 && pullRows.length > 0 && pullSource && (
                    <div className="flex flex-wrap items-center gap-2">
                      <span>
                        <strong>{pullSource.name}</strong> có {pullRows.length} dòng mà cơ chế này chưa có.
                      </span>
                      {otherTemplates.length > 1 && (
                        <div className="w-52">
                          <Dropdown compact value={pullSource.id} aria-label="Lấy từ cơ chế"
                            options={otherTemplates.map((item) => ({ value: item.id, label: item.name }))}
                            onChange={setPullFromId} />
                        </div>
                      )}
                      <button type="button" onClick={pullMissing}
                        className="rounded-md bg-white px-2 py-0.5 font-semibold text-amber-800 ring-1 ring-amber-300 hover:bg-amber-100">
                        Thêm các dòng còn thiếu
                      </button>
                    </div>
                  )}
                </div>
              )}
              {(draft.length > 0 || unticked.length > 0 || rowQuery) && (
                <div className="flex flex-wrap items-center gap-3">
                  <div className="relative min-w-0 flex-1">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input
                      value={rowQuery}
                      onChange={(event) => { setRowQuery(event.target.value); setRowPage(1); }}
                      placeholder="Lọc đầu mục theo tên…"
                      aria-label="Lọc đầu mục theo tên"
                      className="h-10 w-full rounded-xl border border-slate-200 pl-9 pr-3 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
                    />
                  </div>
                  <span className="text-xs font-semibold text-slate-500">{draft.length} đầu mục trong cơ chế</span>
                </div>
              )}
              <PagedList page={safePage} total={listedIds.length} onPage={setRowPage}>
              {draft.length === 0 ? (
                <Card>
                  <CardContent className="space-y-4 py-10 text-center">
                    <Layers3 className="mx-auto h-10 w-10 text-slate-300" />
                    <div>
                      <p className="font-bold text-slate-800">Cơ chế chưa có đầu mục nào</p>
                      <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">
                        Tích đầu mục bên dưới rồi khai công thức cho từng dòng, hoặc nạp một bộ gợi ý để sửa tiếp.
                      </p>
                    </div>
                    {!readOnly && (
                      <div className="flex flex-wrap justify-center gap-2">
                        <Button variant="outline" onClick={() => void seedInto('VAN_PHONG')} disabled={saving}>
                          <Sparkles className="h-4 w-4" /> Gợi ý khối Văn phòng
                        </Button>
                        <Button variant="outline" onClick={() => void seedInto('KINH_DOANH')} disabled={saving}>
                          <Sparkles className="h-4 w-4" /> Gợi ý khối Kinh doanh
                        </Button>
                        {pullSource && pullRows.length > 0 && (
                          <Button variant="outline" onClick={pullMissing}>
                            <Layers3 className="h-4 w-4" /> Lấy các dòng từ “{pullSource.name}”
                          </Button>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              ) : (
                <ol className="space-y-2">
                  {draft.map((row, index) => {
                    if (!pageIds.has(row.componentId)) return null;
                    const component = componentById.get(row.componentId);
                    if (!component) {
                      return (
                        <li key={row.componentId} className="rounded-xl border border-dashed border-slate-200 px-3 py-2 text-xs text-slate-400">
                          Đang nạp đầu mục mới…
                        </li>
                      );
                    }
                    const open = expanded === row.componentId;
                    const issue = rowIssues[index];
                    const line = result?.lines.find((item) => item.code === component.code);
                    // Thẻ chỉ ghi công thức; dòng Từng người / Thay đổi theo tháng không có công thức để ghi.
                    const summary = row.mode === 'FORMULA'
                      ? (row.formula.trim() ? describeFormula(row.formula, nameOf) : 'Chưa có công thức')
                      : '';
                    return (
                      <li
                        key={row.componentId}
                        onDragOver={(event) => { if (dragIndex != null) { event.preventDefault(); setOverIndex(index); } }}
                        onDrop={onDrop(index)}
                        className={`rounded-xl border bg-white transition ${
                          issue ? 'border-red-200' : open ? 'border-indigo-300 shadow-sm' : 'border-slate-200'
                        } ${overIndex === index && dragIndex !== index ? 'ring-2 ring-indigo-300' : ''}`}
                      >
                        <div className="flex items-center gap-2 px-2.5 py-2">
                          {!readOnly && (
                            <span
                              draggable
                              onDragStart={onDragStart(index)}
                              onDragEnd={() => { setDragIndex(null); setOverIndex(null); }}
                              className="cursor-grab text-slate-300 hover:text-slate-500 active:cursor-grabbing"
                              title="Kéo để đổi thứ tự trên phiếu"
                            >
                              <GripVertical className="h-4 w-4" />
                            </span>
                          )}
                          <button
                            type="button"
                            role="checkbox"
                            aria-checked
                            aria-label={`Bỏ ${component.name} khỏi cơ chế`}
                            disabled={readOnly}
                            onClick={() => void removeRow(index)}
                            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2 border-indigo-600 bg-indigo-600 text-white transition disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            <Check className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setExpanded(open ? null : row.componentId)}
                            aria-expanded={open}
                            className="flex min-w-0 flex-1 items-center gap-2 text-left"
                          >
                            {open ? <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" /> : <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />}
                            <span className="min-w-0">
                              <span className="block truncate text-sm font-semibold text-slate-800">{component.name}</span>
                              {!open && (issue ?? summary) && (
                                <span className={`block truncate text-xs ${issue ? 'text-red-600' : 'text-slate-500'}`}>{issue ?? summary}</span>
                              )}
                            </span>
                          </button>
                          <span className="hidden shrink-0 items-center gap-3 sm:flex">
                            {(['PER_PERSON', 'MONTHLY_INPUT'] as const).map((mode) => (
                              <label key={mode}
                                className={`flex items-center gap-1.5 text-xs font-semibold ${readOnly ? 'text-slate-400' : 'cursor-pointer text-slate-600'}`}>
                                <input
                                  type="checkbox"
                                  className="h-3.5 w-3.5 accent-indigo-600"
                                  checked={row.mode === mode}
                                  disabled={readOnly}
                                  onChange={(event) => patchRow(index, { mode: event.target.checked ? mode : 'FORMULA' })}
                                />
                                {ROW_MODE_LABEL[mode]}
                              </label>
                            ))}
                          </span>
                          <span className={`shrink-0 text-right text-sm font-bold tabular-nums ${
                            line?.failed ? 'text-amber-600' : component.kind === 'DEDUCTION' ? 'text-red-600' : component.kind === 'INFO' ? 'text-slate-500' : 'text-slate-900'
                          }`}>
                            {line ? `${component.kind === 'DEDUCTION' ? '−' : ''}${formatFormulaNumber(line.amount)}` : '—'}
                          </span>
                          {!readOnly && (
                            <span className="flex shrink-0 items-center">
                              <button type="button" onClick={() => moveRow(index, index - 1)} disabled={index === 0}
                                className="rounded p-1 text-slate-300 hover:text-slate-600 disabled:opacity-30" aria-label="Lên trên">
                                <ArrowUp className="h-3.5 w-3.5" />
                              </button>
                              <button type="button" onClick={() => moveRow(index, index + 1)} disabled={index === draft.length - 1}
                                className="rounded p-1 text-slate-300 hover:text-slate-600 disabled:opacity-30" aria-label="Xuống dưới">
                                <ArrowDown className="h-3.5 w-3.5" />
                              </button>
                            </span>
                          )}
                        </div>

                        {open && (
                          <div className="space-y-3 border-t border-slate-100 px-3 py-3">
                            {/* Màn hẹp: hai nút tích nằm trong thẻ vì cột trên đầu dòng bị ẩn. */}
                            <div className="flex flex-wrap items-center gap-4 sm:hidden">
                              {(['PER_PERSON', 'MONTHLY_INPUT'] as const).map((mode) => (
                                <label key={mode} className="flex items-center gap-1.5 text-xs font-semibold text-slate-600">
                                  <input type="checkbox" className="h-3.5 w-3.5 accent-indigo-600" checked={row.mode === mode} disabled={readOnly}
                                    onChange={(event) => patchRow(index, { mode: event.target.checked ? mode : 'FORMULA' })} />
                                  {ROW_MODE_LABEL[mode]}
                                </label>
                              ))}
                            </div>

                            {row.mode === 'FORMULA' && (
                              <FormulaInput
                                value={row.formula}
                                onChange={(formula) => patchRow(index, { formula })}
                                entries={buildFormulaEntries({
                                  rowComponents: draftRows.map((item) => item.component),
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
                                onAddEntry={onAddEntry}
                                formatResult={(value) => formatFormulaNumber(component.kind === 'INFO' ? value : Math.round(value))}
                                disabled={readOnly}
                                autoFocus={!row.formula}
                              />
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
              )}

              {!readOnly && unticked.length > 0 && (
                <ol className="space-y-2" aria-label="Đầu mục chưa có trong cơ chế">
                  {unticked.filter((component) => pageIds.has(component.id)).map((component) => (
                    <li key={component.id} className="rounded-xl border border-slate-200 bg-white transition hover:border-indigo-200">
                      <div className="flex items-center gap-2 px-2.5 py-2">
                        <button
                          type="button"
                          role="checkbox"
                          aria-checked={false}
                          aria-label={`Thêm ${component.name} vào cơ chế`}
                          onClick={() => addRow(component)}
                          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2 border-slate-300 bg-white transition hover:border-indigo-400"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold text-slate-500">{component.name}</span>
                        </span>
                        <span className="hidden shrink-0 items-center gap-3 sm:flex">
                          {(['PER_PERSON', 'MONTHLY_INPUT'] as const).map((mode) => (
                            <label key={mode} className="flex cursor-pointer items-center gap-1.5 text-xs font-semibold text-slate-600">
                              <input
                                type="checkbox"
                                className="h-3.5 w-3.5 accent-indigo-600"
                                checked={false}
                                onChange={() => addRow(component, mode)}
                              />
                              {ROW_MODE_LABEL[mode]}
                            </label>
                          ))}
                        </span>
                        <span className="shrink-0 text-right text-sm font-bold tabular-nums text-slate-300">—</span>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
              </PagedList>
              <Pager page={safePage} total={listedIds.length} onPage={setRowPage} />

              {draft.length > 0 && (
                <div className={`sticky z-20 flex flex-wrap items-center gap-3 rounded-xl border-2 border-indigo-200 bg-indigo-50 px-4 py-3 shadow-lg shadow-slate-900/10 ${dirty ? 'bottom-16' : 'bottom-3'}`}>
                  <span className="flex h-6 w-6 items-center justify-center rounded-md bg-indigo-600 text-sm font-black text-white">=</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-extrabold uppercase tracking-wide text-indigo-900">Thực lĩnh</p>
                    <p className="text-xs text-indigo-800/70">
                      Tự động: tổng các dòng “+” trừ tổng các dòng “−”
                      {params && params.netRoundingUnit > 1 ? `, làm tròn ${formatVND(params.netRoundingUnit)}` : ''}.
                    </p>
                  </div>
                  {result && (
                    <div className="text-right text-xs text-indigo-800/80">
                      <p className="tabular-nums">{formatVND(result.gross)} − {formatVND(result.totalDeductions)}</p>
                      <p className="text-lg font-black tabular-nums text-indigo-700">{formatVND(result.netPay)}</p>
                    </div>
                  )}
                </div>
              )}
            </div>

          </div>

          {dirty && (
            <div className="fixed bottom-0 left-0 right-0 z-30 border-t border-slate-200 bg-white/95 px-4 py-3 shadow-lg backdrop-blur-md print:hidden">
              <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 lg:pl-64">
                <p className={`flex items-center gap-1.5 text-sm ${issueCount > 0 ? 'text-red-600' : 'text-slate-600'}`}>
                  {issueCount > 0
                    ? <><TriangleAlert className="h-4 w-4" /> {issueCount} dòng chưa hợp lệ</>
                    : <><Save className="h-4 w-4" /> Có thay đổi chưa lưu — áp dụng từ {monthText(month)}</>}
                </p>
                <div className="flex gap-2">
                  <Button variant="secondary" onClick={() => { setDirty(false); setDraft(savedRows.map(fromItem)); }} disabled={saving}>
                    Huỷ thay đổi
                  </Button>
                  <Button onClick={() => void handleSave()} disabled={saving || readOnly || issueCount > 0}>
                    <Save className="h-4 w-4" /> {saving ? 'Đang lưu…' : 'Lưu cơ chế'}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* --- Tạo / sửa cơ chế --- */}
      <Modal open={!!templateForm} onClose={() => setTemplateForm(null)} title={templateForm?.id ? 'Sửa cơ chế lương' : 'Tạo cơ chế lương'} size="md">
        {templateForm && (
          <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void saveTemplateForm(); }}>
            <Input label="Tên cơ chế" required value={templateForm.name} autoFocus
              onChange={(event) => setTemplateForm({ ...templateForm, name: event.target.value })}
              placeholder="VD: Khối Văn phòng" />
            <Textarea label="Mô tả (không bắt buộc)" rows={2} value={templateForm.description}
              onChange={(event) => setTemplateForm({ ...templateForm, description: event.target.value })} />
            {!templateForm.id && (
              <div className="space-y-2">
                <p className="text-sm font-semibold text-slate-700">Bắt đầu từ</p>
                {([
                  ['EMPTY', 'Trống', 'Tự thêm từng đầu mục.'],
                  ['COPY', 'Sao chép một cơ chế có sẵn', 'Chép nguyên các dòng và công thức.'],
                  ['VAN_PHONG', 'Gợi ý khối Văn phòng', 'Lương thời gian, phép, lễ, KPI, làm thêm giờ, bảo hiểm, công đoàn…'],
                  ['KINH_DOANH', 'Gợi ý khối Kinh doanh', 'Như trên, thêm hoa hồng doanh thu theo bảng bậc thang.'],
                ] as const).map(([value, label, hint]) => (
                  <label key={value} className={`flex cursor-pointer items-start gap-2.5 rounded-xl border px-3 py-2 ${templateForm.start === value ? 'border-indigo-400 bg-indigo-50/50' : 'border-slate-200'}`}>
                    <input type="radio" name="start" className="mt-1 accent-indigo-600" checked={templateForm.start === value}
                      onChange={() => setTemplateForm({ ...templateForm, start: value })} />
                    <span>
                      <span className="block text-sm font-semibold text-slate-800">{label}</span>
                      <span className="block text-xs text-slate-500">{hint}</span>
                    </span>
                  </label>
                ))}
                {templateForm.start === 'COPY' && (
                  <Dropdown label="Chép từ" placeholder="Chọn cơ chế…" value={templateForm.copyFrom}
                    options={data.templates.map((item) => ({ value: item.id, label: item.name }))}
                    onChange={(value) => setTemplateForm({ ...templateForm, copyFrom: value })} />
                )}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setTemplateForm(null)}>Huỷ</Button>
              <Button type="submit" disabled={saving}>{templateForm.id ? 'Lưu' : <><Copy className="h-4 w-4" /> Tạo cơ chế</>}</Button>
            </div>
          </form>
        )}
      </Modal>

      {/* --- Gán cơ chế cho đơn vị --- */}
      <Modal open={!!assigning} onClose={() => setAssigning(null)} title={assigning?.remove ? 'Bỏ cơ chế khỏi đơn vị' : `Gán “${template?.name ?? ''}” cho đơn vị`} size="lg">
        {assigning && (
          <div className="space-y-4">
            {assigning.remove ? (
              <p className="text-sm text-slate-600">
                <strong>{assigning.unit?.name}</strong> sẽ thôi dùng cơ chế từ tháng chọn và không thừa hưởng cơ chế của cấp trên —
                người trong đơn vị chỉ còn cơ chế gán riêng (nếu có).
              </p>
            ) : (
              <div className="space-y-2">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    value={unitQuery}
                    onChange={(event) => setUnitQuery(event.target.value)}
                    placeholder="Lọc đơn vị theo tên…"
                    aria-label="Lọc đơn vị theo tên"
                    className="h-10 w-full rounded-xl border border-slate-200 pl-9 pr-3 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
                  />
                </div>
                {filteredUnitRows.length === 0 && (
                  <p className="rounded-xl border border-dashed border-slate-200 px-3 py-4 text-center text-xs text-slate-500">
                    Không có đơn vị nào khớp “{unitQuery.trim()}”.
                  </p>
                )}
              <div className="max-h-80 overflow-y-auto rounded-xl border border-slate-200">
                <UnitTreeList
                  rows={filteredUnitRows}
                  selectedId={assigning.unit?.id ?? null}
                  onSelect={(unit) => setAssigning({ ...assigning, unit })}
                  badge={(unit) => {
                    const current = resolveTemplateForUnit(unit.id, { templates: data.templates, unitTemplates: data.unitTemplates, unitById }, assigning.month);
                    return current.template
                      ? <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-500">{current.template.name}</span>
                      : null;
                  }}
                />
              </div>
              </div>
            )}
            <p className="text-xs text-slate-500">Đơn vị con thừa hưởng cơ chế của đơn vị gần nhất phía trên.</p>
            <Input label="Hiệu lực từ tháng" required type="month" value={assigning.month.slice(0, 7)} min={minMonth.slice(0, 7)}
              onChange={(event) => event.target.value && setAssigning({ ...assigning, month: `${event.target.value}-01` })} />
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setAssigning(null)}>Huỷ</Button>
              <Button onClick={() => void saveAssignment()} disabled={saving || !assigning.unit}>
                {assigning.remove ? 'Bỏ cơ chế' : 'Gán cơ chế'}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
