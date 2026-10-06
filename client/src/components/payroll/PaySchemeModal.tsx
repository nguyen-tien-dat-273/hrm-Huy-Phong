// ============================================================================
// Thiết lập cơ chế lương cho MỘT người.
// ----------------------------------------------------------------------------
// Đây là chỗ thay thế cho modal cũ chỉ có hai ô "lương cơ bản" và "phụ cấp".
// Một người ở đây được chọn cách tính lương gốc, mức đóng bảo hiểm, cách khấu
// trừ thuế, và gán từng khoản cộng/trừ riêng kèm giá trị hoặc công thức của
// riêng họ.
// ============================================================================

import { useEffect, useMemo, useState } from 'react';
import { Search, Trash2, TriangleAlert, Wallet } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input, Select, Textarea } from '@/components/ui/Input';
import { Avatar } from '@/components/ui/Avatar';
import { PayrollFormulaBuilder } from '@/components/payroll/PayrollFormulaBuilder';
import { PayItemFormulaPicker } from '@/components/payroll/PayItemFormulaPicker';
import { parsePayFormula } from '@/lib/payItemFormula';
import { useToast } from '@/contexts/ToastContext';
import { formatVND } from '@/lib/utils';
import { progressiveIncomeTax, sampleFormulaScope, toTaxBrackets } from '@/lib/payroll';
import { validateFormula } from '@/lib/payrollFormula';
import { deletePayItem, savePayItem, savePayProfile } from '@/lib/payrollData';
import type {
  EmployeePayItem,
  EmployeePayProfile,
  PayBasis,
  PayComponent,
  Profile,
  TaxMode,
} from '@/types';
import type { PayrollParams } from '@/lib/payrollSettings';

/**
 * `pay_basis` và `base_amount` không còn khai trên màn này.
 *
 * Trước đây lương gốc là một mô hình RIÊNG: chọn một trong năm cơ chế
 * (tháng / giờ / ngày / khoán / hoa hồng) rồi nhập một con số. Người khai phải
 * học hai cách cho cùng một việc — lương gốc một kiểu, mọi khoản khác một kiểu.
 *
 * Giờ lương gốc cũng chỉ là một khoản trong danh mục, khai y như mọi khoản
 * khác: chọn khoản, chọn cách tính. Năm cơ chế cũ diễn đạt lại được hết bằng
 * cách tính của khoản —
 *
 *     lương tháng   -> mức ÷ công chuẩn × số công
 *     lương ngày    -> mức × số công
 *     lương giờ     -> công thức riêng với biến WORK_HOURS
 *     khoán/hoa hồng-> không có khoản lương gốc, chỉ có khoản khoán
 *
 * Cột dưới database giữ nguyên để không phải viết migration và để các bản ghi
 * cũ vẫn đọc được; màn này luôn ghi 'MONTHLY' và 0.
 */
const LEGACY_PAY_BASIS: PayBasis = 'MONTHLY';

const TAX_MODES: Array<{ value: TaxMode; label: string; hint: string }> = [
  { value: 'PROGRESSIVE', label: 'Lũy tiến 7 bậc', hint: 'Hợp đồng từ 3 tháng trở lên.' },
  { value: 'FLAT', label: 'Khấu trừ thẳng theo %', hint: 'Hợp đồng dưới 3 tháng, cộng tác viên.' },
  { value: 'NONE', label: 'Không khấu trừ', hint: 'Người đã tự quyết toán hoặc được miễn.' },
];

interface PaySchemeModalProps {
  /** Tham số lương, dùng dựng bộ biến mẫu khi kiểm tra công thức. */
  params: PayrollParams;
  open: boolean;
  target: Profile | null;
  /** Bản ghi cơ chế đang áp dụng cho kỳ đang xem, nếu có. */
  current: EmployeePayProfile | null;
  components: PayComponent[];
  assignedItems: EmployeePayItem[];
  /** Ngày đầu tháng đang xem — mặc định cho ngày hiệu lực. */
  defaultEffectiveFrom: string;
  actorId: string | null;
  onClose: () => void;
  onSaved: () => void;
}

interface ItemDraft {
  id?: string;
  componentId: string;
  amount: string;
  formula: string;
  effectiveFrom: string;
  note: string;
  /**
   * Đang khai bằng ô công thức tự do thay vì các ô chọn.
   *
   * Bật khi mở một khoản có công thức viết tay (ô chọn không đọc nổi nó), hoặc
   * khi người dùng tự bấm "tự viết công thức". Không suy lại mỗi lần render:
   * người đang gõ dở một biểu thức phức tạp mà màn hình nhảy về ô chọn giữa
   * chừng là mất hết cái vừa gõ.
   */
  handWritten: boolean;
}

const digitsOnly = (value: string) => value.replace(/[^\d]/g, '');

/** Bỏ dấu để gõ "xang" tìm ra "Phụ cấp xăng xe". */
const stripTone = (text: string) => text
  .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd')
  .toLowerCase().trim();

export function PaySchemeModal({
  open, target, current, components, assignedItems, params,
  defaultEffectiveFrom, actorId, onClose, onSaved,
}: PaySchemeModalProps) {
  const { toast } = useToast();

  /** Khoản được đánh dấu lương gốc trong danh mục, nếu đã khai. */
  const baseComponent = components.find((item) => item.is_base && item.is_active);
  const [effectiveFrom, setEffectiveFrom] = useState(defaultEffectiveFrom);
  const [insuranceEnabled, setInsuranceEnabled] = useState(true);
  const [insuranceBase, setInsuranceBase] = useState('');
  const [dependents, setDependents] = useState('0');
  const [taxMode, setTaxMode] = useState<TaxMode>('PROGRESSIVE');
  const [flatRate, setFlatRate] = useState('10');
  const [standardDays, setStandardDays] = useState('');
  const [note, setNote] = useState('');
  const [drafts, setDrafts] = useState<ItemDraft[]>([]);
  const [removedIds, setRemovedIds] = useState<string[]>([]);
  const [componentQuery, setComponentQuery] = useState('');
  const [saving, setSaving] = useState(false);

  // Nạp lại mỗi lần mở cho người khác. Không dùng `key` ở phía cha vì modal
  // cần giữ trạng thái khi người dùng cuộn trong lúc đang sửa.
  useEffect(() => {
    if (!open) return;
    setEffectiveFrom(current?.effective_from ?? defaultEffectiveFrom);
    setInsuranceEnabled(current?.insurance_enabled ?? true);
    setInsuranceBase(current?.insurance_base != null ? String(Number(current.insurance_base)) : '');
    setDependents(String(current?.dependents ?? 0));
    setTaxMode(current?.tax_mode ?? 'PROGRESSIVE');
    setFlatRate(String(current?.flat_tax_rate ?? 10));
    setStandardDays(current?.standard_days_override != null ? String(Number(current.standard_days_override)) : '');
    setNote(current?.note ?? '');
    setDrafts(assignedItems.map((item) => ({
      id: item.id,
      componentId: item.component_id,
      amount: item.amount != null ? String(Number(item.amount)) : '',
      formula: item.formula ?? '',
      // Công thức đã lưu mà các ô chọn không đọc nổi thì mở thẳng ô tự do —
      // hiện ô chọn rồi bấm Lưu là ghi đè mất công thức người ta viết tay.
      handWritten: !!item.formula
        && !parsePayFormula(item.formula, components.map((c) => c.code)),
      effectiveFrom: item.effective_from,
      note: item.note ?? '',
    })));
    setRemovedIds([]);
  }, [open, target?.id, current?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const componentById = useMemo(
    () => new Map(components.map((component) => [component.id, component])),
    [components],
  );

  // Biến mẫu để kiểm tra công thức ngay lúc gõ, gồm cả mã số liệu tháng của
  // các khoản đang hoạt động — nếu không, công thức đúng vẫn báo "không có biến".
  const formulaScope = useMemo(() => {
    const inputCodes = components
      .map((component) => component.input_code)
      .filter((code): code is string => !!code);
    const componentCodes = components.map((component) => component.code);
    return sampleFormulaScope(params, [...inputCodes, ...componentCodes]);
  }, [components, params]);

  /**
   * Danh mục để tick chọn, lọc theo ô tìm.
   *
   * Danh mục thật có gần 40 khoản. Bản cũ bắt bấm "Thêm khoản" rồi dò trong
   * một dropdown dài bằng đó — mỗi khoản một lần, và không lúc nào thấy được
   * mình đã chọn những gì. Bày cả danh mục ra, tick một lượt, rồi mới khai
   * công thức cho từng khoản đã tick.
   */
  const pickable = useMemo(() => {
    const keyword = stripTone(componentQuery);
    return components
      .filter((item) => item.is_active)
      .filter((item) => !keyword
        || stripTone(item.name).includes(keyword)
        || stripTone(item.code || '').includes(keyword));
  }, [components, componentQuery]);

  const chosen = (componentId: string) => drafts.some((draft) => draft.componentId === componentId);

  /**
   * Tick vào thì thêm một dòng khai; bỏ tick thì gỡ dòng đó.
   *
   * Khoản ĐÃ LƯU mà bỏ tick phải đưa id vào `removedIds` để lúc lưu còn xoá
   * dưới database — chỉ gỡ khỏi màn hình thì lần mở sau nó hiện lại như chưa
   * có gì xảy ra.
   */
  const toggleComponent = (componentId: string) => {
    setDrafts((list) => {
      const existing = list.find((draft) => draft.componentId === componentId);
      if (!existing) {
        return [...list, {
          componentId,
          amount: '',
          formula: '',
          handWritten: false,
          effectiveFrom,
          note: '',
        }];
      }
      if (existing.id) setRemovedIds((ids) => [...ids, existing.id as string]);
      return list.filter((draft) => draft.componentId !== componentId);
    });
  };

  const updateDraft = (index: number, patch: Partial<ItemDraft>) => {
    setDrafts((list) => list.map((draft, i) => (i === index ? { ...draft, ...patch } : draft)));
  };

  const removeDraft = (index: number) => {
    setDrafts((list) => {
      const draft = list[index];
      if (draft?.id) setRemovedIds((ids) => [...ids, draft.id as string]);
      return list.filter((_, i) => i !== index);
    });
  };

  // Chặn lưu khi công thức hỏng: phát hiện lúc chạy lương thì đã muộn.
  const formulaErrors = drafts.map((draft) => {
    const source = draft.formula.trim();
    if (!source) return null;
    return validateFormula(source, formulaScope);
  });
  const hasFormulaError = formulaErrors.some(Boolean);

  /**
   * Mức của khoản được đánh dấu LƯƠNG GỐC, lấy từ chính dòng vừa khai bên
   * dưới. Đây là căn cứ suy đơn giá giờ tăng ca và mức đóng bảo hiểm, nên
   * phải đọc từ cùng một chỗ mà engine đọc — không giữ một ô riêng nữa.
   */
  const parsedBase = useMemo(() => {
    if (!baseComponent) return 0;
    const row = drafts.find((item) => item.componentId === baseComponent.id);
    return Number(row?.amount || baseComponent.default_amount || 0);
  }, [baseComponent, drafts]);

  // Mức lương thực dùng để đóng bảo hiểm. Bỏ trống thì engine lấy lương gốc,
  // nên hiện ra đây luôn — "trống = theo lương hợp đồng" là câu mà người đọc
  // vẫn phải tự suy ra con số.
  const effectiveInsuranceBase = Number(insuranceBase || '0') || parsedBase;

  /**
   * Ước tính một tháng đi ĐỦ công, CHƯA tính phụ cấp, tăng ca hay khoán.
   *
   * Không cố tính chính xác: số thật phụ thuộc chấm công và số liệu tháng chưa
   * tồn tại lúc đang setup. Mục đích là để người khai thấy ngay mình vừa tạo ra
   * mức thực nhận cỡ nào, thay vì phải lưu rồi chạy bảng lương mới biết.
   */
  const estimate = useMemo(() => {
    const gross = parsedBase;
    const insuranceSalary = insuranceEnabled
      ? Math.min(effectiveInsuranceBase, params.insuranceSalaryCap)
      : 0;
    const unemploymentSalary = insuranceEnabled
      ? Math.min(effectiveInsuranceBase, params.unemploymentSalaryCap)
      : 0;
    const insurance = Math.round(
      (insuranceSalary * (params.socialInsuranceRate + params.healthInsuranceRate)) / 100
        + (unemploymentSalary * params.unemploymentInsuranceRate) / 100,
    );

    const deduction = params.taxPersonalDeduction + Number(dependents || '0') * params.taxDependentDeduction;
    let tax = 0;
    if (taxMode === 'PROGRESSIVE') {
      tax = Math.round(progressiveIncomeTax(
        Math.max(0, gross - insurance - deduction),
        toTaxBrackets(params.brackets),
      ).tax);
    } else if (taxMode === 'FLAT') {
      tax = Math.round((gross * (Number(flatRate) || 0)) / 100);
    }

    return { gross, insurance, deduction, tax, net: gross - insurance - tax };
  }, [
    parsedBase, insuranceEnabled, effectiveInsuranceBase, dependents,
    taxMode, flatRate, params,
  ]);

  const handleSave = async () => {
    if (!target) return;
    if (drafts.length === 0) {
      toast('Chưa chọn khoản lương nào. Thêm ít nhất một khoản.', 'warning');
      return;
    }
    if (drafts.some((item) => !item.componentId)) {
      toast('Còn dòng chưa chọn khoản lương.', 'warning');
      return;
    }
    if (hasFormulaError) {
      toast('Còn công thức chưa hợp lệ — sửa trước khi lưu.', 'warning');
      return;
    }

    setSaving(true);
    const profileError = await savePayProfile({
      user_id: target.id,
      effective_from: effectiveFrom,
      // Hai cột vestigial: xem chú thích ở LEGACY_PAY_BASIS đầu file. Lương
      // gốc thật nằm ở khoản được đánh dấu trong danh mục.
      pay_basis: LEGACY_PAY_BASIS,
      base_amount: 0,
      insurance_base: insuranceBase ? Number(insuranceBase) : null,
      insurance_enabled: insuranceEnabled,
      dependents: Number(dependents) || 0,
      tax_mode: taxMode,
      flat_tax_rate: Number(flatRate) || 10,
      standard_days_override: standardDays ? Number(standardDays) : null,
      note: note.trim() || null,
      created_by: actorId,
    });

    if (profileError) {
      setSaving(false);
      toast('Lưu cơ chế lương thất bại: ' + profileError, 'error');
      return;
    }

    for (const id of removedIds) {
      const error = await deletePayItem(id);
      if (error) {
        setSaving(false);
        toast('Xóa khoản thất bại: ' + error, 'error');
        return;
      }
    }

    for (const draft of drafts) {
      const error = await savePayItem({
        ...(draft.id ? { id: draft.id } : {}),
        user_id: target.id,
        component_id: draft.componentId,
        amount: draft.amount ? Number(draft.amount) : null,
        formula: draft.formula.trim() || null,
        effective_from: draft.effectiveFrom,
        note: draft.note.trim() || null,
        created_by: actorId,
      });
      if (error) {
        setSaving(false);
        toast('Lưu khoản lương thất bại: ' + error, 'error');
        return;
      }
    }

    setSaving(false);
    toast(`Đã lưu cơ chế lương cho ${target.name}.`, 'success');
    onSaved();
    onClose();
  };


  return (
    <Modal open={open} onClose={onClose} title="Cơ chế lương" size="xl">
      {target && (
        <div className="space-y-5">
          <div className="flex items-center gap-3 rounded-xl bg-slate-50 p-3">
            <Avatar name={target.name} url={target.avatar_url} size="md" />
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-slate-800">{target.name}</p>
              <p className="text-xs text-slate-500">{target.department || 'Chưa có bộ phận'}</p>
            </div>
          </div>

          {/* --- Bước 1: khi nào áp dụng, và mẫu số chia công --- */}
          <section className="space-y-3">
            <h3 className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
              Bước 1 · Hiệu lực và ngày công chuẩn
            </h3>

            {/* Không còn ô "lương gốc" ở đây. Lương gốc là một KHOẢN trong danh
                mục, khai ở Bước 3 như mọi khoản khác — một cách khai cho mọi
                thứ, thay vì hai. Mức của nó đọc thẳng từ dòng đó. */}
            {baseComponent ? (
              <div className="rounded-xl border-2 border-indigo-200 bg-indigo-50/60 px-3.5 py-3">
                <p className="text-sm font-bold text-slate-900">
                  Lương gốc: {baseComponent.name}
                </p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-slate-600">
                  Khai mức và cách tính của khoản này ở <strong>Bước 3</strong>. Mức đó là căn cứ
                  suy đơn giá giờ tăng ca và mức đóng bảo hiểm.
                  {parsedBase > 0 && <> Đang là <strong>{formatVND(parsedBase)}</strong>.</>}
                </p>
              </div>
            ) : (
              /* Thiếu khoản lương gốc thì đơn giá giờ tăng ca và mức đóng bảo
                 hiểm đều bằng 0 — hai thứ đó sai thì không hiện ra dưới dạng
                 lỗi, chỉ là vài con số nhỏ đi trên phiếu lương. */
              <div className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3">
                <TriangleAlert className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-700" />
                <p className="text-[11px] leading-relaxed text-amber-900">
                  Chưa có khoản nào được đánh dấu <strong>lương gốc</strong>. Sang{' '}
                  <strong>Danh mục khoản lương</strong> bật cờ đó cho khoản lương cơ bản — thiếu nó
                  thì <strong>đơn giá giờ tăng ca</strong> và <strong>mức đóng bảo hiểm</strong>{' '}
                  đều tính trên 0đ.
                </p>
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                label="Áp dụng từ ngày"
                type="date"
                value={effectiveFrom}
                onChange={(e) => setEffectiveFrom(e.target.value)}
              />
              {/* Mẫu số của cách tính "chia công chuẩn × số công" ở Bước 3. */}
              <Input
                label={`Ngày công chuẩn riêng (trống = ${params.standardWorkDays} theo công ty)`}
                inputMode="numeric"
                placeholder={String(params.standardWorkDays)}
                value={standardDays}
                onChange={(e) => setStandardDays(digitsOnly(e.target.value))}
              />
            </div>

            <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-600">
              Đổi lương là tạo bản ghi mới theo ngày hiệu lực. Các tháng đã chạy lương trước
              ngày này giữ nguyên mức cũ.
            </p>
          </section>

          {/* --- Bảo hiểm & thuế --- */}
          <section className="space-y-3">
            <h3 className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
              Bước 2 · Bảo hiểm và thuế
            </h3>
            <label className="flex items-start gap-2.5 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={insuranceEnabled}
                onChange={(e) => setInsuranceEnabled(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-slate-300"
              />
              <span>
                Tham gia bảo hiểm bắt buộc
                <span className="block text-xs text-slate-500">
                  BHXH {params.socialInsuranceRate}% + BHYT {params.healthInsuranceRate}% +
                  BHTN {params.unemploymentInsuranceRate}% = {(
                    params.socialInsuranceRate + params.healthInsuranceRate + params.unemploymentInsuranceRate
                  ).toFixed(1)}% phần người lao động đóng.
                </span>
              </span>
            </label>
            {insuranceEnabled && (
              <div>
                <Input
                  label="Mức lương đóng bảo hiểm"
                  inputMode="numeric"
                  placeholder={parsedBase > 0 ? String(parsedBase) : 'VD: 8000000'}
                  value={insuranceBase}
                  onChange={(e) => setInsuranceBase(digitsOnly(e.target.value))}
                />
                {effectiveInsuranceBase > 0 ? (
                  <p className="mt-1.5 text-xs text-slate-500">
                    Sẽ đóng trên <strong className="text-slate-700">{formatVND(effectiveInsuranceBase)}</strong>
                    {!insuranceBase && ' (lấy theo lương gốc vì đang để trống)'}
                    {effectiveInsuranceBase > params.insuranceSalaryCap
                      && ` — vượt trần, chỉ đóng BHXH/BHYT trên ${formatVND(params.insuranceSalaryCap)}`}
                  </p>
                ) : (
                  /* Chưa khai khoản lương gốc thì không suy ra được mức đóng,
                     để trống là đóng bảo hiểm trên 0đ — sai mà không có gì báo. */
                  <p className="mt-1.5 flex items-start gap-1.5 text-xs text-amber-700">
                    <TriangleAlert className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                    Chưa suy ra được mức đóng vì chưa khai khoản lương gốc ở Bước 3. Nhập tay ở
                    đây, hoặc khai khoản đó — bỏ trống là đóng bảo hiểm trên 0 đồng.
                  </p>
                )}
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Select label="Cách tính thuế TNCN" value={taxMode} onChange={(e) => setTaxMode(e.target.value as TaxMode)}>
                  {TAX_MODES.map((mode) => (
                    <option key={mode.value} value={mode.value}>{mode.label}</option>
                  ))}
                </Select>
                <p className="mt-1.5 text-xs text-slate-500">
                  {TAX_MODES.find((mode) => mode.value === taxMode)?.hint}
                </p>
              </div>
              {taxMode === 'FLAT' ? (
                <Input
                  label="Tỷ lệ khấu trừ (%)"
                  inputMode="decimal"
                  value={flatRate}
                  onChange={(e) => setFlatRate(e.target.value.replace(/[^\d.]/g, ''))}
                />
              ) : (
                <div>
                  <Input
                    label="Số người phụ thuộc"
                    inputMode="numeric"
                    value={dependents}
                    onChange={(e) => setDependents(digitsOnly(e.target.value))}
                  />
                  <p className="mt-1.5 text-xs text-slate-500">
                    Giảm trừ {formatVND(params.taxDependentDeduction)}/người, cộng với{' '}
                    {formatVND(params.taxPersonalDeduction)} cho bản thân.
                  </p>
                </div>
              )}
            </div>
          </section>

          {/* --- Ước tính --- */}
          {estimate.gross > 0 && (
            <section className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                Ước tính một tháng đi đủ công
              </p>
              <dl className="mt-3 space-y-1.5 text-sm">
                <EstimateRow label="Lương gốc" value={estimate.gross} />
                {estimate.insurance > 0 && (
                  <EstimateRow label="Bảo hiểm người lao động đóng" value={-estimate.insurance} />
                )}
                {taxMode === 'PROGRESSIVE' && (
                  <EstimateRow
                    label={`Giảm trừ gia cảnh (bản thân${Number(dependents) > 0 ? ` + ${dependents} người phụ thuộc` : ''})`}
                    value={estimate.deduction}
                    muted
                  />
                )}
                <EstimateRow
                  label={taxMode === 'NONE' ? 'Thuế TNCN (không khấu trừ)' : 'Thuế TNCN'}
                  value={-estimate.tax}
                />
                <div className="flex items-baseline justify-between border-t border-slate-200 pt-2">
                  <dt className="text-sm font-bold text-slate-700">Thực nhận ước tính</dt>
                  <dd className="text-base font-extrabold tabular-nums text-indigo-700">
                    {formatVND(estimate.net)}
                  </dd>
                </div>
              </dl>
              <p className="mt-2.5 text-[11px] leading-relaxed text-slate-500">
                Chỉ tính lương gốc — <strong>chưa</strong> gồm phụ cấp, tăng ca, khoán sản phẩm hay
                khoản trừ. Số thật phụ thuộc chấm công và số liệu của từng tháng.
              </p>
            </section>
          )}

          {/* --- Khoản riêng --- */}
          <section className="space-y-3">
            <h3 className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
              Bước 3 · Các khoản lương ({drafts.length})
            </h3>

            {/* --- Chọn khoản từ danh mục --- */}
            <div className="rounded-xl border border-slate-200 p-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <input
                  value={componentQuery}
                  onChange={(event) => setComponentQuery(event.target.value)}
                  placeholder="Tìm khoản trong danh mục..."
                  className="h-10 w-full rounded-lg border border-slate-200 bg-slate-50/60 pl-9 pr-3 text-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
                />
              </div>
              <div className="mt-2 max-h-48 overflow-y-auto">
                {pickable.length === 0 ? (
                  <p className="py-4 text-center text-xs text-slate-500">
                    Không có khoản nào khớp &ldquo;{componentQuery}&rdquo;.
                  </p>
                ) : (
                  <div className="grid gap-1 sm:grid-cols-2">
                    {pickable.map((item) => (
                      <label
                        key={item.id}
                        className="flex cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 transition hover:bg-slate-50"
                      >
                        <input
                          type="checkbox"
                          checked={chosen(item.id)}
                          onChange={() => toggleComponent(item.id)}
                          className="mt-0.5 h-4 w-4 flex-shrink-0 accent-indigo-600"
                        />
                        <span className="min-w-0">
                          <span className="block truncate text-xs font-semibold text-slate-800">
                            {/* Dấu +/−/◦ cho thấy ngay khoản này cộng vào hay
                                trừ đi, không phải đọc tên mới đoán ra. */}
                            {item.kind === 'DEDUCTION' ? '− ' : item.kind === 'EMPLOYER_COST' ? '◦ ' : '+ '}
                            {item.name}
                          </span>
                          {item.is_base && (
                            <span className="text-[10px] font-bold text-indigo-600">LƯƠNG GỐC</span>
                          )}
                        </span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {drafts.length === 0 ? (
              <p className="rounded-xl border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-500">
                {/* Không còn "lương gốc" ngoài danh mục nữa: không khoản nào
                    thì phiếu lương thật sự ra 0đ, phải nói đúng như vậy. */}
                Chưa chọn khoản nào — phiếu lương của người này sẽ ra 0đ. Tick ít nhất khoản
                lương gốc ở trên.
              </p>
            ) : (
              <div className="space-y-3">
                {drafts.map((draft, index) => {
                  const component = componentById.get(draft.componentId);
                  return (
                    <div key={draft.id ?? `new-${index}`} className="rounded-xl border border-slate-200 p-3">
                      {/* Khoản nào đã cố định từ lúc tick ở trên, nên đây chỉ
                          còn là tiêu đề — không phải một ô chọn nữa. */}
                      <div className="flex items-start gap-2">
                        <p className="min-w-0 flex-1 text-sm font-bold text-slate-800">
                          {component
                            ? `${component.kind === 'DEDUCTION' ? '− ' : component.kind === 'EMPLOYER_COST' ? '◦ ' : '+ '}${component.name}`
                            : 'Khoản không còn trong danh mục'}
                          {component?.is_base && (
                            <span className="ml-2 rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-bold text-indigo-700">
                              LƯƠNG GỐC
                            </span>
                          )}
                        </p>
                        <button
                          type="button"
                          onClick={() => removeDraft(index)}
                          className="rounded p-1.5 text-slate-300 transition-colors hover:bg-red-50 hover:text-red-600"
                          aria-label="Bỏ khoản này"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>

                      {component && (
                        <p className="mt-2 text-xs text-slate-500">
                          {describeCalcType(component)}
                          {component.note ? ` — ${component.note}` : ''}
                        </p>
                      )}

                      <div className="mt-3 grid gap-3 sm:grid-cols-2">
                        {/* Khoản tính theo % thì "× số công" vô nghĩa — tỷ lệ
                            nhân vào một khoản khác, không nhân vào ngày công.
                            Giữ ô nhập tỷ lệ như cũ cho nhóm đó. */}
                        {component?.calc_type === 'PERCENT' && (
                          <Input
                            label="Tỷ lệ riêng (%)"
                            inputMode="decimal"
                            placeholder={`Trống = ${formatComponentDefault(component)} theo danh mục`}
                            value={draft.amount}
                            onChange={(e) => updateDraft(index, { amount: e.target.value.replace(/[^\d.]/g, '') })}
                          />
                        )}
                        <Input
                          label="Áp dụng từ"
                          type="date"
                          value={draft.effectiveFrom}
                          onChange={(e) => updateDraft(index, { effectiveFrom: e.target.value })}
                        />
                      </div>

                      <div className="mt-3">
                        {draft.handWritten || component?.calc_type === 'PERCENT' ? (
                          <PayrollFormulaBuilder
                            label="Công thức riêng (không bắt buộc)"
                            value={draft.formula}
                            onChange={(formula) => updateDraft(index, { formula })}
                            sampleScope={formulaScope}
                            components={components}
                            defaultFormula={component?.formula}
                          />
                        ) : (
                          <PayItemFormulaPicker
                            formula={draft.formula}
                            onFormulaChange={(formula) => updateDraft(index, { formula })}
                            amount={draft.amount}
                            onAmountChange={(amount) => updateDraft(index, { amount: digitsOnly(amount) })}
                            components={components}
                            selfCode={component?.code ?? null}
                            sampleScope={formulaScope}
                            onWriteByHand={() => updateDraft(index, { handWritten: true })}
                          />
                        )}
                      </div>

                      {/* Khoản có mức mặc định 0 mà không khai riêng thì gán
                          xong vẫn ra 0đ — trông như đã làm xong nhưng thực tế
                          không cộng gì vào lương. */}
                      {component && !draft.formula.trim() && !draft.amount
                        && Number(component.default_amount) === 0 && (
                        <p className="mt-2 flex items-start gap-1.5 text-xs leading-relaxed text-amber-700">
                          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                          Khoản này trong danh mục đang để mức 0đ. Không khai mức riêng thì gán xong
                          vẫn cộng 0đ vào lương — nhập mức ở ô bên trái, hoặc sửa mức chung ở
                          Danh mục khoản lương.
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

          </section>

          <Textarea
            label="Ghi chú"
            rows={2}
            placeholder="VD: Tăng lương theo quyết định ngày 01/09/2026"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />

          {hasFormulaError && (
            <p className="flex items-start gap-2 text-xs text-red-600">
              <TriangleAlert className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
              Còn công thức chưa hợp lệ. Sửa xong mới lưu được — công thức hỏng sẽ làm khoản đó
              bị bỏ qua khi chạy lương.
            </p>
          )}

          <div className="flex gap-3 pt-1">
            <Button variant="outline" onClick={onClose} className="flex-1" disabled={saving}>Hủy</Button>
            <Button onClick={handleSave} className="flex-1" disabled={saving || hasFormulaError}>
              {saving ? 'Đang lưu…' : (<><Wallet className="h-4 w-4" /> Lưu cơ chế lương</>)}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function formatComponentDefault(component: PayComponent): string {
  const amount = Number(component.default_amount);
  return component.calc_type === 'PERCENT' ? `${amount}%` : formatVND(amount);
}

function describeCalcType(component: PayComponent): string {
  switch (component.calc_type) {
    case 'FIXED':
      return component.prorate ? 'Số tiền cố định, chia theo ngày công' : 'Số tiền cố định trọn tháng';
    case 'PER_DAY': return 'Đơn giá × số ngày công';
    case 'PER_HOUR': return `Đơn giá × số giờ nhập ở mã ${component.input_code}`;
    case 'PER_UNIT': return `Đơn giá × sản lượng nhập ở mã ${component.input_code}`;
    case 'PERCENT': return `Phần trăm trên ${component.base_code}`;
    case 'FORMULA': return `Công thức: ${component.formula}`;
    default: return '';
  }
}

/** Một dòng trong bảng ước tính. `muted` cho dòng chỉ để tham khảo, không cộng trừ. */
function EstimateRow({ label, value, muted }: { label: string; value: number; muted?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className={`text-xs ${muted ? 'text-slate-400' : 'text-slate-600'}`}>{label}</dt>
      <dd className={`text-sm tabular-nums ${muted ? 'text-slate-400' : 'font-semibold text-slate-800'}`}>
        {value < 0 ? `− ${formatVND(-value)}` : formatVND(value)}
      </dd>
    </div>
  );
}
