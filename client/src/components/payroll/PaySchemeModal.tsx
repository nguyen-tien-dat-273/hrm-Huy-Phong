// ============================================================================
// Áp cơ chế lương cho MỘT người hoặc MỘT đơn vị.
// ----------------------------------------------------------------------------
// Công thức nằm ở cơ chế (tab Thiết kế). Ở đây chỉ còn những gì khác nhau
// giữa người này với người kia:
//
//   1. Theo cơ chế nào — của đơn vị (thừa hưởng theo cây) hay gán riêng.
//   2. Khai riêng: tích đầu mục muốn khác mức chung (lương cơ bản, số người
//      phụ thuộc…, hoặc một dòng chỉ người này có) rồi điền MỘT ô — gõ số (VND)
//      hoặc công thức đều được, hệ thống tự nhận ra là số hay công thức.
//
// Màn này KHÔNG ghi thẳng: nó soạn một ĐỀ XUẤT, lưu nháp được, trình Ban Giám
// đốc ký duyệt; chỉ khi BGĐ duyệt database mới áp. Đề xuất là bản THAY THẾ
// TOÀN BỘ phần khai riêng từ tháng áp dụng.
// ============================================================================

import { useEffect, useMemo, useState } from 'react';
import { Building2, Check, Pencil, Save, Search, Send, Trash2, TriangleAlert, XCircle } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input, Textarea } from '@/components/ui/Input';
import { Dropdown } from '@/components/ui/Dropdown';
import { Avatar } from '@/components/ui/Avatar';
import { FormulaInput } from '@/components/payroll/formula/FormulaInput';
import { ITEMS_PER_PAGE, PagedList, Pager, clampPage } from '@/components/payroll/Pager';
import { useToast } from '@/contexts/ToastContext';
import { useConfirm } from '@/contexts/ConfirmContext';
import { useAppSettings } from '@/contexts/SettingsContext';
import { formatVND, getTodayString } from '@/lib/utils';
import { normalizeText } from '@/lib/formulaTokens';
import { payProfileForPeriod, systemScope, type MechanismRow } from '@/lib/payroll';
import { describeFormula, formatFormulaNumber, formulaIssueOf, tokenizeFormula } from '@/lib/formulaTokens';
import { KIND_SIGN, buildFormulaEntries } from '@/lib/formulaEntries';
import { firstEditableMonth, paramsOf, versionForMonth } from '@/lib/payrollSettings';
import { ROW_MODE_LABEL } from '@/lib/payrollVariables';
import {
  SCHEME_STATUS_LABEL, SCHEME_STATUS_TONE, diffSchemeItems, earliestSchemeMonth, openRequestFor, personalItemsAt,
  profilePayloadOf, resolveMechanismRows, resolveTemplateFor, resolveUnitRows, unitItemsAt, type SchemeChangeKind,
} from '@/lib/payrollScheme';
import { computeForPerson, nameResolver, paramsForMonth, schemeSourceOf } from '@/lib/payrollRun';
import { cancelSchemeRequest, fetchPayrollApproverIds, saveSchemeRequest, type PayrollWorkspace } from '@/lib/payrollData';
import { notifyUsers } from '@/lib/assignments';
import type { EmployeePayItem, OrganizationUnit, PayComponent, Profile, SchemePayloadItem } from '@/types';

export type SchemeTarget = { type: 'USER'; person: Profile } | { type: 'UNIT'; unit: OrganizationUnit };

interface PaySchemeModalProps {
  open: boolean;
  target: SchemeTarget | null;
  data: PayrollWorkspace;
  /** Tháng đang xem ở màn cha — mặc định cho tháng áp dụng. */
  viewMonth: string;
  lastClosedMonth: string | null;
  /** Người chỉ có quyền xem (VD BGĐ) mở để đọc, không sửa. */
  readOnly?: boolean;
  onClose: () => void;
  onSaved: () => void;
}

interface ItemDraft {
  componentId: string;
  /** Ô khai riêng chứa một con số (VALUE) hay một công thức (FORMULA) — tự nhận ra từ nội dung gõ. */
  kind: 'VALUE' | 'FORMULA';
  amount: string;
  formula: string;
  note: string;
}

const CHANGE_LABEL: Record<Exclude<SchemeChangeKind, 'SAME'>, { text: string; tone: string }> = {
  ADDED: { text: 'Mới', tone: 'bg-emerald-50 text-emerald-700' },
  CHANGED: { text: 'Đổi', tone: 'bg-amber-50 text-amber-700' },
  REMOVED: { text: 'Bỏ', tone: 'bg-red-50 text-red-700' },
};

const monthText = (iso: string) => `${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

function monthEndOf(monthStart: string): string {
  const [year, month] = monthStart.split('-').map(Number);
  return `${monthStart.slice(0, 7)}-${String(new Date(year, month, 0).getDate()).padStart(2, '0')}`;
}

function parseAmount(text: string): number | null {
  if (!text.trim()) return null;
  const value = Number(/^\d{1,3}(\.\d{3})+$/.test(text.trim()) ? text.replace(/\./g, '') : text.replace(',', '.'));
  return Number.isFinite(value) ? value : Number.NaN;
}

const draftOf = (item: SchemePayloadItem): ItemDraft => ({
  componentId: item.component_id,
  kind: item.formula?.trim() ? 'FORMULA' : 'VALUE',
  amount: item.amount == null ? '' : String(item.amount),
  formula: item.formula ?? '',
  note: item.note ?? '',
});

export function PaySchemeModal({
  open, target, data, viewMonth, lastClosedMonth, readOnly = false, onClose, onSaved,
}: PaySchemeModalProps) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const app = useAppSettings();

  const isUser = target?.type === 'USER';
  const targetId = target ? (target.type === 'USER' ? target.person.id : target.unit.id) : null;
  const targetName = target ? (target.type === 'USER' ? target.person.name : target.unit.name) : '';

  const request = useMemo(
    () => (target && targetId ? openRequestFor(data.schemeRequests, { type: target.type, id: targetId }) : null),
    [data.schemeRequests, target, targetId],
  );
  const locked = readOnly || request?.status === 'SUBMITTED';

  const minMonth = useMemo(() => {
    const floor = firstEditableMonth(lastClosedMonth, getTodayString());
    if (!target || !targetId) return floor;
    const own = target.type === 'USER'
      ? [
        ...data.payProfiles.filter((row) => row.user_id === targetId).map((row) => row.effective_from),
        ...data.items.filter((row) => row.user_id === targetId).map((row) => row.effective_from),
      ]
      : data.unitItems.filter((row) => row.unit_id === targetId).map((row) => row.effective_from);
    return earliestSchemeMonth(floor, own);
  }, [data.items, data.payProfiles, data.unitItems, lastClosedMonth, target, targetId]);

  const [month, setMonth] = useState(viewMonth);
  const [templateId, setTemplateId] = useState('');
  const [drafts, setDrafts] = useState<ItemDraft[]>([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<'draft' | 'submit' | 'cancel' | null>(null);
  /** Các đầu mục đang mở để sửa; còn lại đã "Lưu" và hiện ở dạng chỉ đọc cho tới khi bấm bút chì. */
  const [editing, setEditing] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState('');
  const [page, setPage] = useState(1);

  // Nạp lại mỗi lần mở cho một đối tượng khác.
  useEffect(() => {
    if (!open || !target || !targetId) return;
    const start = request?.effective_from ?? (viewMonth >= minMonth ? viewMonth : minMonth);
    const end = monthEndOf(start);
    setMonth(start);
    const items = request?.payload.items
      ?? (target.type === 'USER'
        ? personalItemsAt(data.items, targetId, start, end)
        : unitItemsAt(data.unitItems, targetId, start, end));
    const next = items.map(draftOf);
    setDrafts(next);
    if (target.type === 'USER') {
      const current = payProfileForPeriod(data.payProfiles.filter((row) => row.user_id === targetId), end);
      setTemplateId((request?.payload.profile ?? profilePayloadOf(current)).template_id ?? '');
    } else {
      setTemplateId('');
    }
    setEditing(new Set());
    setFilter('');
    setPage(1);
    setNote(request?.note ?? '');
  }, [open, targetId, request?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const monthEnd = monthEndOf(month);
  const source = useMemo(() => schemeSourceOf(data), [data]);
  const componentById = useMemo(() => new Map(data.components.map((c) => [c.id, c])), [data.components]);
  const version = useMemo(() => versionForMonth(data.paramVersions, month), [data.paramVersions, month]);
  const params = useMemo(() => paramsForMonth(data, app, new Date(`${month}T00:00:00`), month), [data, app, month]);
  const nameOf = useMemo(() => nameResolver(data.components, params), [data.components, params]);

  const resolvedTemplate = useMemo(() => {
    if (!target) return null;
    const person = target.type === 'USER' ? target.person : { id: '', unit_id: target.unit.id };
    return resolveTemplateFor(person, isUser ? { template_id: templateId || null } : null, source, month);
  }, [isUser, month, source, target, templateId]);
  const unitTemplateLabel = useMemo(() => {
    if (!target) return '';
    const person = target.type === 'USER' ? target.person : { id: '', unit_id: target.unit.id };
    return resolveTemplateFor(person, null, source, month).label;
  }, [month, source, target]);

  /** Dòng của cơ chế cộng giá trị thừa hưởng từ đơn vị — CHƯA gồm khai riêng của đối tượng này. */
  const baseRows: MechanismRow[] = useMemo(() => {
    if (!target) return [];
    if (target.type === 'USER') {
      return resolveMechanismRows(target.person, { template_id: templateId || null }, { ...source, employeeItems: [] }, month, monthEnd);
    }
    return resolveUnitRows(target.unit.id, source, month, monthEnd);
  }, [month, monthEnd, source, target, templateId]);
  const baseByComponent = useMemo(() => new Map(baseRows.map((row) => [row.component.id, row])), [baseRows]);

  const draftFor = (componentId: string) => drafts.find((item) => item.componentId === componentId);
  const patchDraft = (componentId: string, patch: Partial<ItemDraft>) =>
    setDrafts((list) => list.map((item) => (item.componentId === componentId ? { ...item, ...patch } : item)));
  /** Gõ MỘT ô: chỉ có một con số thì lưu như giá trị (VND), còn lại là công thức. */
  const setText = (componentId: string, text: string) => {
    const tokens = tokenizeFormula(text);
    const plain = tokens.length === 0 || (tokens.length === 1 && tokens[0].kind === 'num');
    patchDraft(componentId, plain
      ? { kind: 'VALUE', amount: tokens[0]?.kind === 'num' ? tokens[0].value : '', formula: '' }
      : { kind: 'FORMULA', formula: text, amount: '' });
  };
  const setEditingOf = (componentId: string, on: boolean) =>
    setEditing((current) => {
      const next = new Set(current);
      if (on) next.add(componentId); else next.delete(componentId);
      return next;
    });
  const removeDraft = (componentId: string) => {
    setDrafts((list) => list.filter((item) => item.componentId !== componentId));
    setEditingOf(componentId, false);
  };
  /** Tích một đầu mục: dòng công thức của cơ chế thì mang sẵn công thức đó để sửa. */
  const addDraft = (componentId: string) => {
    const base = baseByComponent.get(componentId);
    const formula = base?.mode === 'FORMULA' ? base.formula ?? '' : '';
    setDrafts((list) => [...list, { componentId, kind: formula ? 'FORMULA' : 'VALUE', amount: '', formula, note: '' }]);
    setEditingOf(componentId, true);
  };

  /** Mọi đầu mục khai riêng được: dòng của cơ chế (Từng người trước) rồi các đầu mục chưa có trong cơ chế. */
  const MODE_ORDER: Record<string, number> = { PER_PERSON: 0, VALUE: 1, FORMULA: 2, MONTHLY_INPUT: 3 };
  const options = [
    ...[...baseRows].sort((a, b) => (MODE_ORDER[a.mode] ?? 9) - (MODE_ORDER[b.mode] ?? 9) || a.sortOrder - b.sortOrder)
      .map((row) => ({ component: row.component, base: row as MechanismRow | undefined })),
    ...data.components
      .filter((component) => !baseByComponent.has(component.id) && (component.is_active || drafts.some((item) => item.componentId === component.id)))
      .map((component) => ({ component, base: undefined as MechanismRow | undefined })),
  ];

  // Lọc theo tên; đầu mục đã khai riêng nổi lên đầu danh sách.
  const filterKeyword = normalizeText(filter);
  const visibleOptions = options
    .filter(({ component }) => !filterKeyword || normalizeText(component.name).includes(filterKeyword))
    .map((option, index) => ({ option, index, ticked: drafts.some((item) => item.componentId === option.component.id) }))
    .sort((a, b) => Number(b.ticked) - Number(a.ticked) || a.index - b.index)
    .map((entry) => entry.option);
  const tickedCount = drafts.length;
  const safePage = clampPage(page, visibleOptions.length);
  const pageOptions = visibleOptions.slice((safePage - 1) * ITEMS_PER_PAGE, safePage * ITEMS_PER_PAGE);

  const payloadItems: SchemePayloadItem[] = useMemo(() => drafts
    .map((item) => {
      const amount = parseAmount(item.amount);
      return {
        component_id: item.componentId,
        amount: item.kind === 'VALUE' && amount != null && Number.isFinite(amount) ? amount : null,
        formula: item.kind === 'FORMULA' ? item.formula.trim() || null : null,
        note: item.note.trim() || null,
      };
    })
    .filter((item) => item.amount != null || item.formula != null), [drafts]);

  /** Khai riêng ĐANG ÁP ở tháng chọn — mốc so sánh thêm / bỏ / đổi. */
  const currentItems = useMemo(() => {
    if (!target || !targetId) return [];
    return target.type === 'USER'
      ? personalItemsAt(data.items, targetId, month, monthEnd)
      : unitItemsAt(data.unitItems, targetId, month, monthEnd);
  }, [data.items, data.unitItems, month, monthEnd, target, targetId]);
  const changes = useMemo(() => diffSchemeItems(currentItems, payloadItems), [currentItems, payloadItems]);
  const changeOf = (componentId: string) => changes.find((change) => change.componentId === componentId)?.kind ?? 'SAME';
  const removed = changes.filter((change) => change.kind === 'REMOVED');
  const templateChanged = isUser && targetId
    && (payProfileForPeriod(data.payProfiles.filter((row) => row.user_id === targetId), monthEnd)?.template_id ?? '') !== templateId;

  // ---- Ước tính một tháng đủ công với bộ khai đang soạn ----------------------
  const preview = useMemo(() => {
    if (!target || target.type !== 'USER' || !params) return null;
    const userId = target.person.id;
    const fakeItems: EmployeePayItem[] = payloadItems.map((item, index) => ({
      id: `draft-${index}`, user_id: userId, component_id: item.component_id, amount: item.amount, formula: item.formula,
      taxable: null, insurable: null, is_base: null, effective_from: month, effective_to: null, note: null,
      created_by: null, created_at: '', updated_at: '',
    }));
    const sandbox: PayrollWorkspace = {
      ...data,
      items: [...data.items.filter((row) => row.user_id !== userId), ...fakeItems],
      inputs: [], adjustments: [], attendanceRequests: [], attendance: [], leaves: [],
    };
    try {
      return computeForPerson(target.person, sandbox, params, new Date(`${month}T00:00:00`), month, monthEnd, {
        templateIdOverride: templateId || null,
        statsOverride: { workDays: params.standardDays, leaveDays: 0, holidayDays: 0, workHours: params.standardDays * params.hoursPerDay, lateCount: 0, earlyCount: 0 },
      }).computed;
    } catch {
      return null;
    }
  }, [data, month, monthEnd, params, payloadItems, target, templateId]);

  const scope = useMemo(() => {
    const base: Record<string, number> = {};
    for (const component of data.components) base[component.code] = 0;
    const stats = preview?.stats ?? {
      workDays: params?.standardDays ?? 0, leaveDays: 0, holidayDays: 0, paidDays: params?.standardDays ?? 0, workHours: 0,
      missingCheckout: 0, lateMinutes: 0, lateCount: 0, lateAfterCutoffCount: 0, earlyMinutes: 0, earlyCount: 0,
    };
    return {
      ...base, ...(params?.values ?? {}), ...systemScope(stats, params ?? { standardDays: 0, hoursPerDay: 8 }),
      ...(preview?.values ?? {}), MUC_RIENG: 1,
    } as Record<string, number>;
  }, [data.components, params, preview]);

  // ---- Kiểm tra --------------------------------------------------------------
  const issues = new Map<string, string>();
  for (const item of drafts) {
    if (item.kind === 'FORMULA') {
      if (!item.formula.trim()) { issues.set(item.componentId, 'Chưa có công thức.'); continue; }
      const issue = formulaIssueOf(tokenizeFormula(item.formula), scope, params?.functions ?? {}, nameOf);
      if (issue) issues.set(item.componentId, issue.message);
    } else if (item.amount.trim()) {
      const value = parseAmount(item.amount);
      if (!(value != null && value >= 0)) issues.set(item.componentId, 'Phải là số không âm.');
    }
  }
  const missingValues = isUser
    ? baseRows.filter((row) => row.mode === 'PER_PERSON' && row.amount == null && !payloadItems.some((item) => item.component_id === row.component.id && item.amount != null))
    : [];

  /** Kiểm tra mức sàn (nếu bộ tham số có khai): ví dụ lương cơ bản ≥ lương tối thiểu vùng. */
  const floor = useMemo(() => {
    if (!isUser || !version?.floorComponentCode || !version.floorParamCode) return null;
    const component = data.components.find((item) => item.code === version.floorComponentCode);
    const param = paramsOf(version).find((item) => item.code === version.floorParamCode);
    if (!component || !param) return null;
    const own = payloadItems.find((item) => item.component_id === component.id)?.amount;
    const value = own ?? baseByComponent.get(component.id)?.amount ?? null;
    if (value == null) return null;
    return { component, param, value, below: value < param.value };
  }, [baseByComponent, data.components, isUser, payloadItems, version]);

  const hasBlocking = issues.size > 0;

  // ---- Lưu / trình / huỷ -----------------------------------------------------
  const handleSave = async (submit: boolean) => {
    if (!target || !targetId) return;
    if (month < minMonth) { toast(`Tháng áp dụng sớm nhất là ${monthText(minMonth)}.`, 'warning'); return; }
    if (hasBlocking) { toast('Còn ô chưa hợp lệ — sửa các chỗ tô đỏ trước.', 'warning'); return; }
    if (submit) {
      if (!version) { toast(`Chưa có bộ tham số lương hiệu lực cho ${monthText(month)}.`, 'warning'); return; }
      if (floor?.below) {
        toast(`${floor.component.name} ${formatVND(floor.value)} thấp hơn ${floor.param.name} ${formatVND(floor.param.value)}.`, 'error');
        return;
      }
      if (missingValues.length > 0) {
        toast(`Còn thiếu: ${missingValues.map((row) => row.component.name).join(', ')}.`, 'warning');
        return;
      }
      if (isUser && baseRows.length === 0 && payloadItems.length === 0) {
        const ok = await confirm({
          title: 'Trình khi chưa có cơ chế?',
          message: 'Người này chưa theo cơ chế nào và không có dòng khai riêng — phiếu lương sẽ ra 0đ.',
          confirmLabel: 'Vẫn trình',
        });
        if (!ok) return;
      }
    }

    setBusy(submit ? 'submit' : 'draft');
    const { id, error } = await saveSchemeRequest({
      requestId: request && request.status !== 'SUBMITTED' ? request.id : null,
      targetType: target.type,
      userId: target.type === 'USER' ? targetId : null,
      unitId: target.type === 'UNIT' ? targetId : null,
      effectiveFrom: month,
      payload: { ...(isUser ? { profile: { template_id: templateId || null } } : {}), items: payloadItems },
      note: note.trim() || null,
      submit,
    });
    if (error || !id) {
      setBusy(null);
      toast((submit ? 'Không trình được: ' : 'Không lưu được: ') + (error ?? 'không rõ lỗi'), 'error');
      return;
    }
    if (submit) {
      const approvers = await fetchPayrollApproverIds();
      await notifyUsers(
        approvers,
        'Cơ chế lương chờ duyệt',
        `${target.type === 'USER' ? 'Nhân sự' : 'Đơn vị'} ${targetName} — áp dụng từ ${monthText(month)}. Mở Lương & đãi ngộ › Phê duyệt để ký.`,
        'payroll_scheme_submitted',
      );
    }
    setBusy(null);
    toast(submit ? `Đã trình BGĐ duyệt cơ chế lương của ${targetName}.` : 'Đã lưu nháp đề xuất.', 'success');
    onSaved();
    onClose();
  };

  const handleCancel = async () => {
    if (!request) return;
    const ok = await confirm({
      title: 'Huỷ đề xuất này?',
      message: request.status === 'SUBMITTED'
        ? 'Đề xuất đang chờ BGĐ duyệt sẽ bị rút về và huỷ. Cơ chế hiện hành giữ nguyên.'
        : 'Bản nháp sẽ bị huỷ. Cơ chế hiện hành giữ nguyên.',
      confirmLabel: 'Huỷ đề xuất',
      danger: true,
    });
    if (!ok) return;
    setBusy('cancel');
    const error = await cancelSchemeRequest(request.id);
    setBusy(null);
    if (error) { toast('Không huỷ được: ' + error, 'error'); return; }
    toast('Đã huỷ đề xuất.', 'success');
    onSaved();
    onClose();
  };

  if (!target) return null;

  const entriesFor = (component: PayComponent) => buildFormulaEntries({
    rowComponents: baseRows.map((row) => row.component),
    catalog: data.components,
    version,
    sampleValues: preview?.values,
    excludeCode: component.code,
    includeCatalog: false,
  });

  return (
    <Modal open={open} onClose={onClose} title={isUser ? 'Cơ chế lương của nhân sự' : 'Giá trị chung của đơn vị'} size="2xl">
      <div className="space-y-5">
        {/* --- Đối tượng + trạng thái đề xuất --- */}
        <div className="flex flex-wrap items-center gap-3 rounded-xl bg-slate-50 p-3">
          {target.type === 'USER' ? (
            <Avatar name={target.person.name} url={target.person.avatar_url} size="md" />
          ) : (
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-indigo-50 text-indigo-600">
              <Building2 className="h-5 w-5" />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold text-slate-800">{targetName}</p>
            <p className="text-xs text-slate-500">
              {target.type === 'USER'
                ? `${target.person.employee_code ?? ''}${target.person.employee_code ? ' · ' : ''}${target.person.department || 'Chưa có bộ phận'}`
                : 'Mức chung cho mọi người trong đơn vị và đơn vị con — từng người vẫn khai riêng được'}
            </p>
          </div>
          {request && (
            <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${SCHEME_STATUS_TONE[request.status]}`}>
              {request.code} · {SCHEME_STATUS_LABEL[request.status]}
            </span>
          )}
        </div>

        {request?.status === 'REJECTED' && request.review_note && (
          <p className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            <XCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
            <span><strong>BGĐ từ chối:</strong> {request.review_note} — sửa rồi trình lại.</span>
          </p>
        )}
        {request?.status === 'SUBMITTED' && (
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Đề xuất đang chờ BGĐ ký duyệt nên không sửa được. Cần đổi thì huỷ đề xuất rồi lập lại.
          </p>
        )}

        {/* --- 1. Cơ chế + tháng áp dụng --- */}
        <section className="grid gap-3 sm:grid-cols-[1fr_12rem]">
          {isUser ? (
            <Dropdown label="Theo cơ chế" disabled={locked} value={templateId} onChange={setTemplateId}
              options={[
                { value: '', label: `Theo đơn vị — ${unitTemplateLabel}` },
                ...data.templates.filter((item) => item.is_active || item.id === templateId)
                  .map((item) => ({ value: item.id, label: `${item.name} (gán riêng)` })),
              ]} />
          ) : (
            <div className="rounded-xl border border-slate-200 px-3 py-2 text-sm">
              <p className="text-xs font-semibold text-slate-500">Cơ chế của đơn vị</p>
              <p className="mt-0.5 font-semibold text-slate-800">{resolvedTemplate?.label}</p>
              <p className="mt-0.5 text-[11px] text-slate-400">Đổi cơ chế của đơn vị ở tab Thiết kế cơ chế (Gán cho đơn vị).</p>
            </div>
          )}
          <Input
            label="Áp dụng từ tháng"
            type="month"
            required
            min={minMonth.slice(0, 7)}
            value={month.slice(0, 7)}
            disabled={locked}
            onChange={(event) => event.target.value && setMonth(`${event.target.value}-01`)}
            error={month < minMonth ? `Sớm nhất ${monthText(minMonth)}.` : undefined}
          />
        </section>

        {isUser && !resolvedTemplate?.template && (
          <p className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
            Người này chưa theo cơ chế lương nào. Chọn một cơ chế ở trên, hoặc gán cơ chế cho đơn vị ở tab Thiết kế cơ chế.
          </p>
        )}

        <div className={`grid items-start gap-5 ${isUser ? 'lg:grid-cols-[minmax(0,1fr)_21rem]' : ''}`}>
        <div className="min-w-0 space-y-5">
        {/* --- 2. Khai riêng: tích đầu mục → form điền số / công thức mở xuống --- */}
        <section className="space-y-2">
          <h3 className="text-[11px] font-bold uppercase tracking-widest text-slate-400">
            {isUser ? 'Khai riêng cho người này' : 'Khai chung cho đơn vị'}
          </h3>
          {options.length > 0 && (
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
              <span className="text-xs font-semibold text-slate-500">{tickedCount} đã khai riêng</span>
            </div>
          )}
          {options.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-200 px-4 py-5 text-center text-sm text-slate-500">
              Chưa có đầu mục nào để khai riêng.
            </p>
          ) : visibleOptions.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-200 px-4 py-5 text-center text-sm text-slate-500">
              Không có đầu mục nào khớp “{filter.trim()}”.
            </p>
          ) : (
            <>
            <PagedList page={safePage} total={visibleOptions.length} onPage={setPage}>
              {pageOptions.map(({ component, base }) => {
                const item = draftFor(component.id);
                const ticked = !!item;
                const isEditing = ticked && editing.has(component.id) && !locked;
                const issue = issues.get(component.id);
                const change = changeOf(component.id);
                const inherited = base ? (base.amount ?? (base.mode === 'VALUE' ? Number(component.default_amount ?? 0) : null)) : null;
                const missing = isUser && base?.mode === 'PER_PERSON' && inherited == null && !(item?.amount.trim() || item?.formula.trim());
                return (
                  <div key={component.id} className={`rounded-xl border ${ticked ? 'border-indigo-200 bg-white' : 'border-slate-200'}`}>
                    <div className="flex items-start gap-3 px-3 py-2.5">
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={ticked}
                        aria-label={`Khai riêng ${component.name}`}
                        disabled={locked}
                        onClick={() => (ticked ? removeDraft(component.id) : addDraft(component.id))}
                        className={`mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md border-2 transition disabled:cursor-not-allowed ${
                          ticked ? 'border-indigo-600 bg-indigo-600 text-white' : missing ? 'border-red-400 bg-white' : 'border-slate-300 bg-white hover:border-indigo-400'
                        }`}
                      >
                        {ticked && <Check className="h-4 w-4" />}
                      </button>
                      <div className="min-w-0 flex-1">
                        <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-800">
                          <span className="text-slate-400">{KIND_SIGN[component.kind]}</span>
                          {component.name}
                          {base?.mode === 'PER_PERSON' && (
                            <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-bold text-indigo-700">Bắt buộc</span>
                          )}
                          {change !== 'SAME' && change !== 'REMOVED' && (
                            <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${CHANGE_LABEL[change].tone}`}>{CHANGE_LABEL[change].text}</span>
                          )}
                        </p>
                        <p className={`text-xs ${missing ? 'font-semibold text-red-600' : 'text-slate-500'}`}>
                          {missing
                            ? 'Chưa có giá trị — tích và khai trước khi trình duyệt.'
                            : !base
                              ? 'Không có trong cơ chế — dòng thêm riêng'
                              : inherited != null
                                ? `Mức chung: ${formatFormulaNumber(inherited)}`
                                : base.mode === 'FORMULA' && base.formula
                                  ? `Cơ chế: ${describeFormula(base.formula, nameOf)}`
                                  : `Cơ chế: ${ROW_MODE_LABEL[base.mode]}`}
                        </p>
                      </div>
                      {ticked && !locked && (
                        <div className="flex flex-shrink-0 items-center gap-1">
                          {isEditing ? (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={!!issue}
                              onClick={() => setEditingOf(component.id, false)}
                            >
                              <Check className="h-3.5 w-3.5" /> Lưu
                            </Button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setEditingOf(component.id, true)}
                              aria-label={`Sửa ${component.name}`}
                              className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-indigo-600"
                            >
                              <Pencil className="h-4 w-4" />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => removeDraft(component.id)}
                            aria-label={`Bỏ khai riêng ${component.name}`}
                            className="rounded-lg p-2 text-slate-300 hover:bg-red-50 hover:text-red-600"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      )}
                    </div>
                    {item && (
                      <div className="space-y-1 px-3 pb-3">
                        <FormulaInput
                          value={item.kind === 'VALUE' ? item.amount : item.formula}
                          onChange={(text) => setText(component.id, text)}
                          entries={entriesFor(component)}
                          scope={scope}
                          functions={params?.functions}
                          leftLabel={component.name}
                          ariaLabel={`Khai riêng ${component.name}`}
                          disabled={!isEditing}
                          autoFocus={isEditing && !item.amount && !item.formula}
                        />
                        {issue && <p className="text-xs font-medium text-red-600">{issue}</p>}
                      </div>
                    )}
                  </div>
                );
              })}
            </PagedList>
            <Pager page={safePage} total={visibleOptions.length} onPage={setPage} />
            </>
          )}
        </section>

        {removed.length > 0 && (
          <div className="rounded-xl border border-red-200 bg-red-50/50 px-3 py-2 text-xs text-red-700">
            <p className="font-semibold">Thôi khai riêng từ {monthText(month)} (về mức chung):</p>
            <p className="mt-0.5">{removed.map((change) => componentById.get(change.componentId)?.name ?? '?').join(', ')}</p>
          </div>
        )}
        {templateChanged && (
          <p className="text-xs font-semibold text-amber-700">Đổi cơ chế từ {monthText(month)}: {resolvedTemplate?.label}.</p>
        )}
        {floor?.below && (
          <p className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
            {floor.component.name} {formatVND(floor.value)} thấp hơn {floor.param.name} {formatVND(floor.param.value)} — lưu nháp được nhưng không trình duyệt được.
          </p>
        )}

        </div>

        {/* --- 4. Ước tính (cột phải) --- */}
        {preview && preview.lines.length > 0 && (
          <section className="rounded-xl border border-indigo-100 bg-indigo-50/40 p-3 lg:sticky lg:top-0">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-xs font-bold uppercase tracking-wider text-indigo-900/70">Ước tính nếu đi đủ công {monthText(month)}</p>
              <p className="text-lg font-black tabular-nums text-indigo-700">{formatVND(preview.netPay)}</p>
            </div>
            <ul className="mt-2 space-y-1 text-xs">
              {preview.lines.map((line) => (
                <li key={line.code} className="flex justify-between gap-3">
                  <span className={`truncate ${line.kind === 'INFO' ? 'text-slate-400' : 'text-slate-600'}`}>{KIND_SIGN[line.kind]} {line.name}</span>
                  <span className={`shrink-0 tabular-nums ${line.failed ? 'text-amber-600' : line.kind === 'DEDUCTION' ? 'text-red-600' : 'text-slate-800'}`}>
                    {formatFormulaNumber(line.amount)}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[11px] text-slate-500">
              Chưa gồm số liệu tháng (làm thêm giờ, doanh số, KPI) và điều chỉnh.
              {preview.warnings.length > 0 && <span className="text-amber-700"> Lưu ý: {preview.warnings.join(' · ')}</span>}
            </p>
          </section>
        )}
        </div>

        <Textarea
          label="Ghi chú / căn cứ"
          rows={2}
          disabled={locked}
          placeholder="VD: Tăng lương theo quyết định số 12/QĐ ngày 01/10/2026"
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />

        <div className="flex flex-wrap justify-end gap-2 pt-1">
          {request && !readOnly && (
            <Button variant="ghost" onClick={handleCancel} disabled={!!busy} className="mr-auto text-red-600">
              <Trash2 className="h-4 w-4" /> {busy === 'cancel' ? 'Đang huỷ…' : 'Huỷ đề xuất'}
            </Button>
          )}
          <Button variant="outline" onClick={onClose} disabled={!!busy}>Đóng</Button>
          {!locked && (
            <>
              <Button variant="secondary" onClick={() => void handleSave(false)} disabled={!!busy || hasBlocking}>
                <Save className="h-4 w-4" /> {busy === 'draft' ? 'Đang lưu…' : 'Lưu nháp'}
              </Button>
              <Button onClick={() => void handleSave(true)} disabled={!!busy || hasBlocking || !!floor?.below || !version}>
                <Send className="h-4 w-4" /> {busy === 'submit' ? 'Đang trình…' : 'Lưu & trình BGĐ duyệt'}
              </Button>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
