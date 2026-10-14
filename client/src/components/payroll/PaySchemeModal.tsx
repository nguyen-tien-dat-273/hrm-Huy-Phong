// ============================================================================
// F06.03 — "Thiết lập Cơ chế Lương" cho MỘT người hoặc MỘT đơn vị.
// ----------------------------------------------------------------------------
// Màn này KHÔNG ghi thẳng cơ chế. Nó soạn một ĐỀ XUẤT (payroll_scheme_requests):
// lưu nháp được, trình BGĐ ký duyệt (BR-PAY-012); chỉ khi BGĐ duyệt database
// mới áp vào employee_pay_* / unit_pay_items. Cơ chế chưa duyệt là bản nháp,
// engine không dùng.
//
// Đề xuất là bản THAY THẾ TOÀN BỘ phần khai riêng từ tháng áp dụng: khoản nào
// không còn trong đề xuất thì hết hiệu lực từ tháng đó. Vì vậy màn mở ra với
// đúng các khoản đang áp, và đánh dấu rõ thêm / bỏ / đổi so với hiện hành —
// đó cũng là thứ BGĐ nhìn thấy khi ký.
//
// Không có con số lương nào nằm trong file này: lương tối thiểu vùng, thuế
// suất khấu trừ thẳng mặc định, công chuẩn… đều đọc từ bộ tham số hiệu lực.
// ============================================================================

import { useEffect, useMemo, useState } from 'react';
import { Building2, Save, Search, Send, Trash2, TriangleAlert, XCircle } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input, Select, Textarea } from '@/components/ui/Input';
import { Avatar } from '@/components/ui/Avatar';
import { PayrollFormulaBuilder } from '@/components/payroll/PayrollFormulaBuilder';
import { PayItemFormulaPicker } from '@/components/payroll/PayItemFormulaPicker';
import { useToast } from '@/contexts/ToastContext';
import { useConfirm } from '@/contexts/ConfirmContext';
import { useAppSettings } from '@/contexts/SettingsContext';
import { formatVND, getTodayString } from '@/lib/utils';
import { payProfileForPeriod, sampleFormulaScope } from '@/lib/payroll';
import { explainFormulaError, type FormulaFunctions } from '@/lib/payrollFormula';
import { parsePayFormula } from '@/lib/payItemFormula';
import { firstEditableMonth, versionForMonth, type NamedParamDef, type TierTable } from '@/lib/payrollSettings';
import {
  SCHEME_STATUS_LABEL, SCHEME_STATUS_TONE, baseAmountOf, diffSchemeItems, earliestSchemeMonth, openRequestFor,
  personalItemsAt, profilePayloadOf, resolvePayItems, resolveTemplateFor, unitItemsAt, type SchemeChangeKind,
} from '@/lib/payrollScheme';
import { computeForPerson, paramsForMonth, schemeSourceOf } from '@/lib/payrollRun';
import { cancelSchemeRequest, fetchPayrollApproverIds, saveSchemeRequest, type PayrollWorkspace } from '@/lib/payrollData';
import { notifyUsers } from '@/lib/assignments';
import type {
  EmployeePayItem, EmployeePayProfile, OrganizationUnit, PayComponent, Profile, SchemePayloadItem,
  SchemePayloadProfile, TaxMode,
} from '@/types';

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

/**
 * Cách tính khi KHÔNG khai công thức riêng: engine dùng `calc_type` của khoản
 * trong Danh mục. Nói ra để người khai biết khoản đó đang chạy theo cái gì.
 */
const CACH_TINH_MAC_DINH: Record<string, string> = {
  FIXED: 'số tiền cố định',
  PER_DAY: 'số tiền × ngày hưởng lương',
  PER_HOUR: 'số tiền × số giờ nhập hằng tháng',
  PER_UNIT: 'số tiền × sản lượng nhập hằng tháng',
  PERCENT: '% trên khoản gốc khai ở Danh mục',
  FORMULA: 'công thức khai ở Danh mục',
};

const TAX_MODE_LABEL: Record<TaxMode, string> = {
  PROGRESSIVE: 'Lũy tiến theo biểu thuế (có giảm trừ gia cảnh)',
  FLAT: 'Khấu trừ thẳng theo tỷ lệ (HĐ dưới 3 tháng)',
  NONE: 'Không khấu trừ thuế',
};

const CHANGE_LABEL: Record<Exclude<SchemeChangeKind, 'SAME'>, { text: string; tone: string }> = {
  ADDED: { text: 'Thêm mới', tone: 'bg-emerald-50 text-emerald-700' },
  CHANGED: { text: 'Thay đổi', tone: 'bg-amber-50 text-amber-700' },
  REMOVED: { text: 'Bỏ', tone: 'bg-red-50 text-red-700' },
};

interface ItemDraft {
  componentId: string;
  amount: string;
  formula: string;
  note: string;
  /** null = theo Danh mục; true/false = khai riêng cho người này. */
  taxable: boolean | null;
  insurable: boolean | null;
  isBase: boolean | null;
  /**
   * Công thức đã lưu mà bộ ô chọn không đọc nổi thì mở thẳng ô viết tay.
   * Tính MỘT LẦN lúc nạp: đang gõ dở mà màn nhảy về ô chọn là mất chữ.
   */
  handWritten: boolean;
}

interface ProfileDraft {
  dependents: string;
  insuranceEnabled: boolean;
  insuranceBase: string;
  taxMode: TaxMode;
  flatRate: string;
  standardDays: string;
  templateId: string;
}

const digitsOnly = (value: string) => value.replace(/[^\d]/g, '');
const decimalOnly = (value: string) => value.replace(/[^\d.]/g, '');
const monthText = (iso: string) => `${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/** Bỏ dấu để gõ "xang" tìm ra "Phụ cấp xăng xe". */
const stripTone = (text: string) => text
  .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd')
  .toLowerCase().trim();

function monthEndOf(monthStart: string): string {
  const [year, month] = monthStart.split('-').map(Number);
  return `${monthStart.slice(0, 7)}-${String(new Date(year, month, 0).getDate()).padStart(2, '0')}`;
}

function profileDraftOf(profile: SchemePayloadProfile): ProfileDraft {
  return {
    dependents: String(profile.dependents ?? 0),
    insuranceEnabled: profile.insurance_enabled,
    insuranceBase: profile.insurance_base == null ? '' : String(profile.insurance_base),
    taxMode: profile.tax_mode,
    flatRate: profile.flat_tax_rate == null ? '' : String(profile.flat_tax_rate),
    standardDays: profile.standard_days_override == null ? '' : String(profile.standard_days_override),
    templateId: profile.template_id ?? '',
  };
}

function profilePayloadFromDraft(draft: ProfileDraft): SchemePayloadProfile {
  return {
    dependents: Number(draft.dependents) || 0,
    insurance_enabled: draft.insuranceEnabled,
    insurance_base: draft.insuranceBase.trim() ? Number(draft.insuranceBase) : null,
    tax_mode: draft.taxMode,
    flat_tax_rate: draft.flatRate.trim() ? Number(draft.flatRate) : null,
    standard_days_override: draft.standardDays.trim() ? Number(draft.standardDays) : null,
    template_id: draft.templateId || null,
  };
}

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
  const [drafts, setDrafts] = useState<ItemDraft[]>([]);
  const [profile, setProfile] = useState<ProfileDraft | null>(null);
  const [note, setNote] = useState('');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState<'draft' | 'submit' | 'cancel' | null>(null);

  const componentById = useMemo(() => new Map(data.components.map((c) => [c.id, c])), [data.components]);
  const componentCodes = useMemo(() => data.components.map((c) => c.code), [data.components]);
  const inputCodes = useMemo(
    () => data.components.map((c) => c.input_code).filter((code): code is string => !!code),
    [data.components],
  );

  const draftOf = (item: SchemePayloadItem): ItemDraft => ({
    componentId: item.component_id,
    amount: item.amount == null ? '' : String(item.amount),
    formula: item.formula ?? '',
    note: item.note ?? '',
    taxable: item.taxable ?? null,
    insurable: item.insurable ?? null,
    isBase: item.is_base ?? null,
    handWritten: !!item.formula && !parsePayFormula(item.formula, componentCodes, inputCodes),
  });

  // Nạp lại mỗi lần mở cho một đối tượng khác. Tháng mở = tháng của đề xuất
  // đang dở, hoặc tháng đang xem nếu còn sửa được, hoặc tháng sớm nhất được sửa.
  useEffect(() => {
    if (!open || !target || !targetId) return;
    const start = request?.effective_from ?? (viewMonth >= minMonth ? viewMonth : minMonth);
    const end = monthEndOf(start);
    setMonth(start);
    const items = request?.payload.items
      ?? (target.type === 'USER'
        ? personalItemsAt(data.items, targetId, start, end)
        : unitItemsAt(data.unitItems, targetId, start, end));
    setDrafts(items.map(draftOf));
    if (target.type === 'USER') {
      const current = payProfileForPeriod(data.payProfiles.filter((row) => row.user_id === targetId), end);
      const fallbackRate = versionForMonth(data.paramVersions, start)?.flatTaxRate ?? 0;
      setProfile(profileDraftOf(request?.payload.profile ?? profilePayloadOf(current, fallbackRate)));
    } else {
      setProfile(null);
    }
    setNote(request?.note ?? '');
    setQuery('');
  }, [open, targetId, request?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const monthEnd = monthEndOf(month);
  const version = useMemo(() => versionForMonth(data.paramVersions, month), [data.paramVersions, month]);
  const params = useMemo(
    () => paramsForMonth(data, app, new Date(`${month}T00:00:00`), month),
    [data, app, month],
  );
  const formulaScope = useMemo(
    () => (params ? sampleFormulaScope(params, [...componentCodes, ...inputCodes]) : {}),
    [params, componentCodes, inputCodes],
  );

  const payloadItems: SchemePayloadItem[] = useMemo(() => drafts.map((draft) => ({
    component_id: draft.componentId,
    amount: draft.amount.trim() === '' ? null : Number(draft.amount),
    formula: draft.formula.trim() || null,
    note: draft.note.trim() || null,
    ...(isUser ? { taxable: draft.taxable, insurable: draft.insurable, is_base: draft.isBase } : {}),
  })), [drafts, isUser]);

  /** Phần khai riêng ĐANG ÁP ở tháng chọn — mốc so sánh thêm / bỏ / đổi. */
  const currentItems = useMemo(() => {
    if (!target || !targetId) return [];
    return target.type === 'USER'
      ? personalItemsAt(data.items, targetId, month, monthEnd)
      : unitItemsAt(data.unitItems, targetId, month, monthEnd);
  }, [data.items, data.unitItems, month, monthEnd, target, targetId]);
  const changes = useMemo(() => diffSchemeItems(currentItems, payloadItems), [currentItems, payloadItems]);
  const changeOf = (componentId: string) => changes.find((change) => change.componentId === componentId)?.kind ?? 'SAME';
  const removed = changes.filter((change) => change.kind === 'REMOVED');

  /**
   * Khoản người / đơn vị này THỪA HƯỞNG từ mẫu của khối và khoản chung của
   * đơn vị cấp trên — chỉ để xem. Khai riêng cùng khoản thì phần riêng thắng.
   */
  const inherited = useMemo(() => {
    if (!target) return [];
    const source = schemeSourceOf(data);
    if (target.type === 'USER') {
      return resolvePayItems(
        target.person,
        { template_id: profile?.templateId || null },
        { ...source, employeeItems: [] },
        month, monthEnd,
      );
    }
    return resolvePayItems(
      { id: '', unit_id: target.unit.id },
      null,
      { ...source, unitItems: source.unitItems.filter((row) => row.unit_id !== target.unit.id), employeeItems: [] },
      month, monthEnd,
    );
  }, [data, month, monthEnd, profile?.templateId, target]);

  const unitTemplateLabel = useMemo(() => {
    if (!target) return '';
    const person = target.type === 'USER' ? target.person : { id: '', unit_id: target.unit.id };
    return resolveTemplateFor(person, null, schemeSourceOf(data), month).label;
  }, [data, month, target]);

  // ---- Kiểm tra --------------------------------------------------------------
  const formulaIssues = drafts.map((draft) => (draft.formula.trim()
    ? explainFormulaError(draft.formula, formulaScope, { functions: params?.tierFunctions })
    : null));
  const amountIssues = drafts.map((draft) => {
    if (!draft.amount.trim()) return null;
    const value = Number(draft.amount);
    return Number.isFinite(value) && value >= 0 ? null : 'Mức phải là số không âm.';
  });
  const profileIssues: Partial<Record<keyof ProfileDraft, string>> = {};
  if (profile) {
    const dependents = Number(profile.dependents);
    if (!/^\d+$/.test(profile.dependents.trim()) || dependents > 30) profileIssues.dependents = 'Số nguyên từ 0 đến 30.';
    if (profile.taxMode === 'FLAT') {
      const rate = Number(profile.flatRate);
      if (!profile.flatRate.trim() || !(rate >= 0 && rate <= 100)) profileIssues.flatRate = 'Từ 0 đến 100%.';
    }
    if (profile.standardDays.trim()) {
      const days = Number(profile.standardDays);
      if (!(days > 0 && days <= 31)) profileIssues.standardDays = 'Trong khoảng 1–31, hoặc để trống.';
    }
  }
  const baseAmount = baseAmountOf(payloadItems, data.components);
  const baseCount = drafts.filter((draft) => draft.isBase ?? componentById.get(draft.componentId)?.is_base).length;
  const minimumWage = version?.regionalMinimumWage ?? null;
  const belowMinimum = baseAmount != null && minimumWage != null && baseAmount < minimumWage;
  const hasBlocking = formulaIssues.some(Boolean) || amountIssues.some(Boolean)
    || Object.keys(profileIssues).length > 0 || baseCount > 1;

  /** Ước tính một tháng đủ công chuẩn với cơ chế ĐANG SOẠN — chưa gồm OT/KPI/điều chỉnh. */
  const preview = useMemo(() => {
    if (!target || target.type !== 'USER' || !params || !profile || hasBlocking) return null;
    const userId = target.person.id;
    const payloadProfile = profilePayloadFromDraft(profile);
    const fakeProfile: EmployeePayProfile = {
      id: 'draft', user_id: userId, effective_from: month, pay_basis: 'MONTHLY', base_amount: 0,
      insurance_base: payloadProfile.insurance_base, insurance_enabled: payloadProfile.insurance_enabled,
      dependents: payloadProfile.dependents, tax_mode: payloadProfile.tax_mode,
      flat_tax_rate: payloadProfile.flat_tax_rate ?? 0,
      standard_days_override: payloadProfile.standard_days_override, template_id: payloadProfile.template_id,
      note: null, created_by: null, created_at: '', updated_at: '',
    };
    const fakeItems: EmployeePayItem[] = payloadItems.map((item, index) => ({
      id: `draft-${index}`, user_id: userId, component_id: item.component_id, amount: item.amount,
      formula: item.formula, taxable: item.taxable ?? null, insurable: item.insurable ?? null,
      is_base: item.is_base ?? null, effective_from: month, effective_to: null, note: item.note ?? null,
      created_by: null, created_at: '', updated_at: '',
    }));
    const sandbox: PayrollWorkspace = {
      ...data,
      items: [...data.items.filter((row) => row.user_id !== userId), ...fakeItems],
      payProfiles: [...data.payProfiles.filter((row) => row.user_id !== userId), fakeProfile],
      inputs: [], adjustments: [], attendanceRequests: [], attendance: [], leaves: [],
    };
    const standard = payloadProfile.standard_days_override ?? params.standardWorkDays;
    try {
      return computeForPerson(target.person, sandbox, params, new Date(`${month}T00:00:00`), month, monthEnd, {
        statsOverride: {
          workDays: standard, leaveDays: 0, holidayDays: 0,
          workHours: standard * params.hoursPerDay, lateCount: 0, earlyCount: 0,
        },
      }).computed;
    } catch {
      return null;
    }
  }, [data, hasBlocking, month, monthEnd, params, payloadItems, profile, target]);

  // ---- Chọn khoản ------------------------------------------------------------
  const pickable = useMemo(() => {
    const keyword = stripTone(query);
    return data.components
      .filter((c) => c.is_active && c.calc_source !== 'ENGINE')
      .filter((c) => !keyword || stripTone(c.name).includes(keyword) || stripTone(c.code).includes(keyword));
  }, [data.components, query]);
  const pickableGroups = useMemo(() => data.categories
    .map((category) => ({ category, items: pickable.filter((c) => c.category_code === category.code) }))
    .filter((group) => group.items.length > 0), [data.categories, pickable]);

  const chosen = (componentId: string) => drafts.some((draft) => draft.componentId === componentId);
  const updateDraft = (index: number, patch: Partial<ItemDraft>) => {
    setDrafts((list) => list.map((draft, i) => (i === index ? { ...draft, ...patch } : draft)));
  };
  const toggleComponent = (componentId: string) => {
    setDrafts((list) => (list.some((draft) => draft.componentId === componentId)
      ? list.filter((draft) => draft.componentId !== componentId)
      : [...list, {
        componentId, amount: '', formula: '', note: '',
        taxable: null, insurable: null, isBase: null, handWritten: false,
      }]));
  };
  /** Bật lương gốc cho một khoản thì tắt các khoản còn lại — mỗi cơ chế MỘT lương gốc. */
  const setBase = (index: number, on: boolean) => {
    setDrafts((list) => list.map((draft, i) => {
      if (i === index) return { ...draft, isBase: on };
      const effective = draft.isBase ?? componentById.get(draft.componentId)?.is_base ?? false;
      return on && effective ? { ...draft, isBase: false } : draft;
    }));
  };

  const assignedCodes = (skipIndex: number) => [
    ...drafts.filter((_, index) => index !== skipIndex).map((draft) => componentById.get(draft.componentId)?.code),
    ...inherited.map((entry) => entry.component.code),
  ].filter((code): code is string => !!code);

  const groupedDrafts = useMemo(() => data.categories
    .map((category) => ({
      category,
      rows: drafts.map((draft, index) => ({ draft, index }))
        .filter(({ draft }) => componentById.get(draft.componentId)?.category_code === category.code),
    }))
    .filter((group) => group.rows.length > 0), [componentById, data.categories, drafts]);

  // ---- Lưu / trình / huỷ -----------------------------------------------------
  const handleSave = async (submit: boolean) => {
    if (!target || !targetId) return;
    if (month < minMonth) {
      toast(`Tháng áp dụng sớm nhất là ${monthText(minMonth)}.`, 'warning');
      return;
    }
    if (hasBlocking) {
      toast('Còn ô chưa hợp lệ — sửa các chỗ tô đỏ trước.', 'warning');
      return;
    }
    if (submit) {
      if (!version) {
        toast(`Chưa có bộ tham số lương hiệu lực cho ${monthText(month)} — khai ở Tham số & công thức trước.`, 'warning');
        return;
      }
      if (belowMinimum) {
        toast(`Mức lương cơ bản thấp hơn lương tối thiểu vùng ${formatVND(minimumWage)} (BR-PAY-013).`, 'error');
        return;
      }
      if (drafts.length === 0 && isUser && inherited.length === 0) {
        const ok = await confirm({
          title: 'Trình cơ chế không có khoản nào?',
          message: 'Người này không khai khoản riêng và cũng không thừa hưởng khoản nào — phiếu lương sẽ ra 0đ.',
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
      payload: {
        ...(profile ? { profile: profilePayloadFromDraft(profile) } : {}),
        items: payloadItems,
      },
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
    if (error) return toast('Không huỷ được: ' + error, 'error');
    toast('Đã huỷ đề xuất.', 'success');
    onSaved();
    onClose();
  };

  if (!target) return null;

  return (
    <Modal open={open} onClose={onClose} title="Thiết lập cơ chế lương" size="xl">
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
                : 'Khoản chung — áp cho mọi người trong đơn vị và đơn vị con'}
              {' · '}Mẫu: {unitTemplateLabel}
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

        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label="Áp dụng từ tháng"
            type="month"
            required
            min={minMonth.slice(0, 7)}
            value={month.slice(0, 7)}
            disabled={locked}
            onChange={(event) => event.target.value && setMonth(`${event.target.value}-01`)}
            error={month < minMonth ? `Sớm nhất ${monthText(minMonth)} (sau kỳ đã chốt / phiên bản đã có).` : undefined}
          />
          <div className="rounded-xl border border-slate-200 px-3 py-2 text-xs text-slate-600">
            <p className="font-semibold text-slate-700">Bộ tham số áp dụng</p>
            {version ? (
              <p className="mt-0.5">
                Từ {monthText(version.effectiveFrom)} · Lương tối thiểu vùng {version.regionCode}:{' '}
                <strong>{formatVND(version.regionalMinimumWage)}</strong>
              </p>
            ) : (
              <p className="mt-0.5 text-red-600">Chưa có bộ tham số hiệu lực cho tháng này.</p>
            )}
          </div>
        </div>

        {/* --- Thuế / bảo hiểm / NPT (chỉ cho người) --- */}
        {profile && (
          <section className="space-y-3 rounded-xl border border-slate-200 p-3">
            <h3 className="text-[11px] font-bold uppercase tracking-widest text-slate-400">Thuế, bảo hiểm & người phụ thuộc</h3>
            <div className="grid gap-3 sm:grid-cols-3">
              <Input
                label="Số người phụ thuộc (NPT)"
                inputMode="numeric"
                required
                disabled={locked}
                value={profile.dependents}
                onChange={(event) => setProfile({ ...profile, dependents: digitsOnly(event.target.value) })}
                error={profileIssues.dependents}
              />
              <Select
                label="Cách tính thuế TNCN"
                disabled={locked}
                value={profile.taxMode}
                onChange={(event) => setProfile({ ...profile, taxMode: event.target.value as TaxMode })}
              >
                {(Object.keys(TAX_MODE_LABEL) as TaxMode[]).map((mode) => (
                  <option key={mode} value={mode}>{TAX_MODE_LABEL[mode]}</option>
                ))}
              </Select>
              {profile.taxMode === 'FLAT' ? (
                <Input
                  label="Thuế suất khấu trừ (%)"
                  inputMode="decimal"
                  required
                  disabled={locked}
                  value={profile.flatRate}
                  onChange={(event) => setProfile({ ...profile, flatRate: decimalOnly(event.target.value) })}
                  error={profileIssues.flatRate}
                />
              ) : <div />}
              <label className="flex items-center gap-2 text-sm font-semibold text-slate-700 sm:col-span-1">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-indigo-600"
                  disabled={locked}
                  checked={profile.insuranceEnabled}
                  onChange={(event) => setProfile({ ...profile, insuranceEnabled: event.target.checked })}
                />
                Tham gia BHXH / BHYT / BHTN
              </label>
              <Input
                label="Mức lương đóng bảo hiểm"
                inputMode="numeric"
                placeholder="Trống = theo các khoản tính bảo hiểm"
                disabled={locked || !profile.insuranceEnabled}
                value={profile.insuranceBase}
                onChange={(event) => setProfile({ ...profile, insuranceBase: digitsOnly(event.target.value) })}
              />
              <Input
                label="Công chuẩn riêng (ngày)"
                inputMode="decimal"
                placeholder={params ? `Trống = ${params.standardWorkDays} theo lịch` : 'Trống = theo lịch'}
                disabled={locked}
                value={profile.standardDays}
                onChange={(event) => setProfile({ ...profile, standardDays: decimalOnly(event.target.value) })}
                error={profileIssues.standardDays}
              />
            </div>
            <Select
              label="Mẫu bảng lương"
              disabled={locked}
              value={profile.templateId}
              onChange={(event) => setProfile({ ...profile, templateId: event.target.value })}
            >
              <option value="">Theo đơn vị — {unitTemplateLabel}</option>
              {data.templates.filter((template) => template.is_active || template.id === profile.templateId).map((template) => (
                <option key={template.id} value={template.id}>{template.code} · {template.name} (gán riêng)</option>
              ))}
            </Select>
          </section>
        )}

        {/* --- Khoản thừa hưởng --- */}
        <section className="rounded-xl border border-slate-200">
          <p className="border-b border-slate-100 px-3 py-2 text-[11px] font-bold uppercase tracking-widest text-slate-400">
            Thừa hưởng từ mẫu khối & đơn vị cấp trên ({inherited.length})
          </p>
          {inherited.length === 0 ? (
            <p className="px-3 py-3 text-xs text-slate-500">Không thừa hưởng khoản nào.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {inherited.map((entry) => {
                const overridden = chosen(entry.component.id);
                return (
                  <li key={entry.component.id} className={`flex flex-wrap items-center gap-2 px-3 py-1.5 text-xs ${overridden ? 'opacity-50' : ''}`}>
                    <span className="font-semibold text-slate-700">{entry.component.name}</span>
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-500">{entry.origin}</span>
                    <span className="ml-auto font-mono text-[11px] text-slate-500">
                      {entry.item.formula?.trim() || (entry.item.amount != null ? formatVND(entry.item.amount) : CACH_TINH_MAC_DINH[entry.component.calc_type])}
                    </span>
                    {overridden && <span className="text-[10px] font-bold text-indigo-600">← khai riêng bên dưới thay thế</span>}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* --- Chọn khoản khai riêng --- */}
        <section className="space-y-3">
          <h3 className="text-[11px] font-bold uppercase tracking-widest text-slate-400">
            {isUser ? 'Khoản khai riêng cho người này' : 'Khoản chung của đơn vị'} ({drafts.length})
          </h3>
          {!locked && (
            <div className="rounded-xl border border-slate-200 p-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Tìm khoản trong danh mục..."
                  className="h-10 w-full rounded-lg border border-slate-200 bg-slate-50/60 pl-9 pr-3 text-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
                />
              </div>
              <div className="mt-2 max-h-56 space-y-2 overflow-y-auto">
                {pickableGroups.length === 0 ? (
                  <p className="py-4 text-center text-xs text-slate-500">
                    {query ? <>Không có khoản nào khớp &ldquo;{query}&rdquo;.</> : 'Danh mục chưa có khoản nào đang hoạt động.'}
                  </p>
                ) : pickableGroups.map(({ category, items }) => (
                  <div key={category.code}>
                    <p className="px-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">{category.name}</p>
                    <div className="grid gap-0.5 sm:grid-cols-2">
                      {items.map((item) => (
                        <label key={item.id} className="flex cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 transition hover:bg-slate-50">
                          <input
                            type="checkbox"
                            checked={chosen(item.id)}
                            onChange={() => toggleComponent(item.id)}
                            className="mt-0.5 h-4 w-4 flex-shrink-0 accent-indigo-600"
                          />
                          <span className="min-w-0">
                            <span className="block truncate text-xs font-semibold text-slate-800">
                              {item.kind === 'DEDUCTION' ? '− ' : item.kind === 'EMPLOYER_COST' ? '◦ ' : '+ '}
                              {item.name}
                            </span>
                            <span className="font-mono text-[10px] text-slate-400">{item.code}</span>
                            {item.is_base && <span className="ml-1.5 text-[10px] font-bold text-indigo-600">LƯƠNG GỐC</span>}
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {drafts.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-500">
              {isUser
                ? 'Chưa khai khoản riêng — người này nhận đúng các khoản thừa hưởng ở trên.'
                : 'Đơn vị chưa có khoản chung nào.'}
            </p>
          ) : groupedDrafts.map((group) => (
            <div key={group.category.code} className="rounded-xl border border-slate-200">
              <p className="border-b border-slate-100 px-3 py-2 text-[11px] font-bold uppercase tracking-widest text-slate-400">
                {group.category.name} ({group.rows.length})
              </p>
              <div className="divide-y divide-slate-100">
                {group.rows.map(({ draft, index }) => (
                  <DraftRow
                    key={draft.componentId}
                    draft={draft}
                    component={componentById.get(draft.componentId)}
                    isUser={isUser}
                    locked={locked}
                    change={changeOf(draft.componentId)}
                    formulaIssue={formulaIssues[index]?.message ?? null}
                    amountIssue={amountIssues[index]}
                    components={data.components}
                    formulaScope={formulaScope}
                    assignedCodes={assignedCodes(index)}
                    namedParams={version?.namedParams ?? []}
                    tierTables={version?.tierTables ?? []}
                    functions={params?.tierFunctions}
                    onChange={(patch) => updateDraft(index, patch)}
                    onBase={(on) => setBase(index, on)}
                    onRemove={() => toggleComponent(draft.componentId)}
                  />
                ))}
              </div>
            </div>
          ))}

          {removed.length > 0 && (
            <div className="rounded-xl border border-red-200 bg-red-50/50 px-3 py-2 text-xs text-red-700">
              <p className="font-semibold">Sẽ thôi áp từ {monthText(month)}:</p>
              <p className="mt-0.5">{removed.map((change) => componentById.get(change.componentId)?.name ?? '?').join(', ')}</p>
            </div>
          )}
        </section>

        {/* --- Kiểm tra & ước tính --- */}
        <section className="space-y-2">
          {baseCount > 1 && (
            <Issue tone="error">Mỗi cơ chế chỉ được MỘT khoản lương gốc — bỏ bớt cờ &ldquo;Lương gốc&rdquo;.</Issue>
          )}
          {belowMinimum && (
            <Issue tone="error">
              Lương cơ bản {formatVND(baseAmount)} thấp hơn lương tối thiểu vùng {version?.regionCode}{' '}
              {formatVND(minimumWage)} (BR-PAY-013) — lưu nháp được nhưng không trình duyệt được.
            </Issue>
          )}
          {isUser && baseAmount == null && drafts.length > 0 && (
            <Issue tone="warning">
              Chưa có khoản lương gốc khai mức tiền riêng — hệ thống chưa đối chiếu được với lương tối thiểu vùng.
            </Issue>
          )}
          {preview && (
            <div className="grid gap-2 rounded-xl border border-indigo-100 bg-indigo-50/40 p-3 sm:grid-cols-4">
              <PreviewStat label="Tổng thu nhập (Gross)" value={preview.gross} />
              <PreviewStat label="Bảo hiểm NLĐ" value={preview.insuranceEmployee} />
              <PreviewStat label="Thuế TNCN" value={preview.personalIncomeTax} />
              <PreviewStat label="Thực lĩnh (Net)" value={preview.netPay} strong />
              <p className="text-[11px] text-slate-500 sm:col-span-4">
                Ước tính nếu đi đủ công chuẩn {monthText(month)}, chưa gồm số liệu tháng (OT, sản lượng, KPI) và điều chỉnh.
                {preview.warnings.length > 0 && <span className="text-amber-700"> Lưu ý: {preview.warnings.join(' · ')}</span>}
              </p>
            </div>
          )}
        </section>

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
              <Button onClick={() => void handleSave(true)} disabled={!!busy || hasBlocking || belowMinimum || !version}>
                <Send className="h-4 w-4" /> {busy === 'submit' ? 'Đang trình…' : 'Lưu & trình BGĐ duyệt'}
              </Button>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}

function DraftRow({
  draft, component, isUser, locked, change, formulaIssue, amountIssue, components, formulaScope,
  assignedCodes, namedParams, tierTables, functions, onChange, onBase, onRemove,
}: {
  draft: ItemDraft;
  component: PayComponent | undefined;
  isUser: boolean;
  locked: boolean;
  change: SchemeChangeKind;
  formulaIssue: string | null;
  amountIssue: string | null;
  components: PayComponent[];
  formulaScope: Readonly<Record<string, number>>;
  assignedCodes: string[];
  namedParams: readonly NamedParamDef[];
  tierTables: readonly TierTable[];
  functions: FormulaFunctions | undefined;
  onChange: (patch: Partial<ItemDraft>) => void;
  onBase: (on: boolean) => void;
  onRemove: () => void;
}) {
  const taxable = draft.taxable ?? component?.taxable ?? true;
  const insurable = draft.insurable ?? component?.insurable ?? false;
  const isBase = draft.isBase ?? component?.is_base ?? false;
  const percent = component?.calc_type === 'PERCENT';

  return (
    <div className="space-y-2 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-slate-800">{component?.name ?? 'Khoản đã bị xoá'}</span>
        <span className="font-mono text-[10px] text-slate-400">{component?.code}</span>
        {change !== 'SAME' && change !== 'REMOVED' && (
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${CHANGE_LABEL[change].tone}`}>{CHANGE_LABEL[change].text}</span>
        )}
        {!locked && (
          <button
            type="button"
            onClick={onRemove}
            className="ml-auto rounded p-1 text-slate-300 transition-colors hover:bg-red-50 hover:text-red-600"
            aria-label="Bỏ khoản này"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>

      {locked ? (
        <p className="font-mono text-[11px] text-slate-600">
          {draft.formula.trim() || (draft.amount ? formatVND(Number(draft.amount)) : CACH_TINH_MAC_DINH[component?.calc_type ?? 'FIXED'])}
        </p>
      ) : (
        <>
          {percent && (
            <Input
              label="Tỷ lệ riêng (%)"
              inputMode="decimal"
              placeholder={`Trống = ${Number(component?.default_amount ?? 0)}% theo danh mục`}
              value={draft.amount}
              onChange={(event) => onChange({ amount: decimalOnly(event.target.value) })}
              error={amountIssue ?? undefined}
            />
          )}
          {draft.handWritten || percent ? (
            <PayrollFormulaBuilder
              label={`Công thức ${component?.name ?? ''}`}
              value={draft.formula}
              onChange={(formula) => onChange({ formula })}
              sampleScope={formulaScope}
              components={components}
              defaultFormula={component?.formula}
              namedParams={namedParams}
              tierTables={tierTables}
              functions={functions}
            />
          ) : (
            <PayItemFormulaPicker
              componentName={component?.name ?? 'Khoản'}
              assignedCodes={assignedCodes}
              formula={draft.formula}
              onFormulaChange={(formula) => onChange({ formula })}
              amount={draft.amount}
              onAmountChange={(amount) => onChange({ amount: digitsOnly(amount) })}
              components={components}
              namedParams={namedParams}
              selfCode={component?.code ?? null}
              sampleScope={formulaScope}
            />
          )}
          {!draft.handWritten && !percent && (
            <button
              type="button"
              className="text-[11px] font-semibold text-indigo-600 hover:underline"
              onClick={() => onChange({ handWritten: true })}
            >
              Viết công thức tự do (dùng tham số / biểu bậc thang)
            </button>
          )}
        </>
      )}

      {formulaIssue && (
        <p className="flex items-center gap-1.5 text-xs font-semibold text-red-600">
          <TriangleAlert className="h-3.5 w-3.5 flex-shrink-0" /> {formulaIssue}
        </p>
      )}
      {amountIssue && !percent && <p className="text-xs font-semibold text-red-600">{amountIssue}</p>}

      {isUser && (
        <div className="flex flex-wrap gap-1.5">
          {([
            ['Chịu thuế TNCN', taxable, () => onChange({ taxable: !taxable })],
            ['Tính bảo hiểm', insurable, () => onChange({ insurable: !insurable })],
            ['Lương gốc', isBase, () => onBase(!isBase)],
          ] as const).map(([label, on, toggle]) => (
            <button
              key={label}
              type="button"
              disabled={locked}
              onClick={toggle}
              aria-pressed={on}
              className={`rounded-lg border px-2 py-1 text-[11px] font-semibold transition disabled:cursor-default ${
                on ? 'border-indigo-600 bg-indigo-50 text-indigo-700' : 'border-slate-200 text-slate-400 hover:border-indigo-300'
              }`}
            >
              {on ? '✓ ' : '○ '}{label}
            </button>
          ))}
        </div>
      )}

      {!locked && component && !draft.formula.trim() && !draft.amount && Number(component.default_amount) === 0 && !component.formula && (
        <p className="flex items-center gap-1.5 text-xs font-semibold text-amber-700">
          <TriangleAlert className="h-3.5 w-3.5 flex-shrink-0" /> Chưa có mức — khoản này sẽ cộng 0đ.
        </p>
      )}
    </div>
  );
}

function Issue({ tone, children }: { tone: 'error' | 'warning'; children: React.ReactNode }) {
  return (
    <p className={`flex items-start gap-2 rounded-xl border px-3 py-2 text-xs ${
      tone === 'error' ? 'border-red-200 bg-red-50 text-red-700' : 'border-amber-200 bg-amber-50 text-amber-800'
    }`}>
      <TriangleAlert className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
      <span>{children}</span>
    </p>
  );
}

function PreviewStat({ label, value, strong = false }: { label: string; value: number; strong?: boolean }) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</p>
      <p className={`tabular-nums ${strong ? 'text-base font-black text-indigo-700' : 'text-sm font-bold text-slate-700'}`}>
        {formatVND(value)}
      </p>
    </div>
  );
}
