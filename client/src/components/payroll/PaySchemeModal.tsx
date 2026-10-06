// ============================================================================
// Thiết lập cơ chế lương cho MỘT người.
// ----------------------------------------------------------------------------
// Đây là chỗ thay thế cho modal cũ chỉ có hai ô "lương cơ bản" và "phụ cấp".
// Một người ở đây được chọn cách tính lương gốc, mức đóng bảo hiểm, cách khấu
// trừ thuế, và gán từng khoản cộng/trừ riêng kèm giá trị hoặc công thức của
// riêng họ.
// ============================================================================

import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, TriangleAlert, Wallet } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input, Select, Textarea } from '@/components/ui/Input';
import { Avatar } from '@/components/ui/Avatar';
import { PayrollFormulaBuilder } from '@/components/payroll/PayrollFormulaBuilder';
import { PayItemFormulaPicker } from '@/components/payroll/PayItemFormulaPicker';
import { parsePayFormula } from '@/lib/payItemFormula';
import { useToast } from '@/contexts/ToastContext';
import { formatVND } from '@/lib/utils';
import { payBasisLabel, progressiveIncomeTax, sampleFormulaScope, toTaxBrackets } from '@/lib/payroll';
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

const PAY_BASES: Array<{ value: PayBasis; hint: string; who: string }> = [
  { value: 'MONTHLY', hint: 'Lương tháng ÷ ngày công chuẩn × ngày công thực tế.', who: 'Nhân viên chính thức' },
  { value: 'HOURLY', hint: 'Đơn giá giờ × giờ làm lấy từ chấm công.', who: 'Part-time, thời vụ' },
  { value: 'DAILY', hint: 'Đơn giá ngày × số ngày công.', who: 'Lao động công nhật' },
  { value: 'PIECE', hint: 'Không có lương cứng. Thu nhập hoàn toàn từ khoản khoán sản phẩm.', who: 'Thợ ăn theo sản lượng' },
  { value: 'COMMISSION', hint: 'Lương cứng thấp + hoa hồng doanh số.', who: 'Nhân viên kinh doanh' },
];

/** Chỉ lương tháng mới có mẫu số "ngày công chuẩn" để chia. */
const USES_STANDARD_DAYS: ReadonlyArray<PayBasis> = ['MONTHLY'];

const BASE_AMOUNT_LABEL: Record<PayBasis, string> = {
  MONTHLY: 'Lương tháng (VND)',
  HOURLY: 'Đơn giá một giờ (VND)',
  DAILY: 'Đơn giá một ngày công (VND)',
  PIECE: 'Lương cứng tối thiểu, để 0 nếu ăn khoán hoàn toàn (VND)',
  COMMISSION: 'Lương cứng hằng tháng (VND)',
};

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

export function PaySchemeModal({
  open, target, current, components, assignedItems, params,
  defaultEffectiveFrom, actorId, onClose, onSaved,
}: PaySchemeModalProps) {
  const { toast } = useToast();

  const [basis, setBasis] = useState<PayBasis>('MONTHLY');
  /** Khoản được đánh dấu lương gốc trong danh mục, nếu đã khai. */
  const baseComponent = components.find((item) => item.is_base && item.is_active);
  const [baseAmount, setBaseAmount] = useState('');
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
  const [saving, setSaving] = useState(false);

  // Nạp lại mỗi lần mở cho người khác. Không dùng `key` ở phía cha vì modal
  // cần giữ trạng thái khi người dùng cuộn trong lúc đang sửa.
  useEffect(() => {
    if (!open) return;
    setBasis(current?.pay_basis ?? 'MONTHLY');
    setBaseAmount(current ? String(Number(current.base_amount)) : '');
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

  const availableComponents = components.filter(
    (component) => component.is_active && !drafts.some((draft) => draft.componentId === component.id),
  );

  const addDraft = () => {
    const next = availableComponents[0];
    if (!next) {
      toast('Đã gán hết các khoản đang hoạt động.', 'warning');
      return;
    }
    setDrafts((list) => [...list, {
      componentId: next.id,
      amount: '',
      formula: '',
      handWritten: false,
      effectiveFrom: effectiveFrom,
      note: '',
    }]);
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

  const parsedBase = Number(baseAmount || '0');
  const preview = useMemo(() => {
    const days = Number(standardDays) || params.standardWorkDays || 26;
    const hours = params.hoursPerDay || 8;
    switch (basis) {
      case 'HOURLY': return `${formatVND(parsedBase)}/giờ`;
      case 'DAILY': return `${formatVND(parsedBase)}/ngày · ${formatVND(parsedBase / hours)}/giờ`;
      case 'PIECE': return 'Thu nhập theo sản lượng nghiệm thu';
      default:
        return `${formatVND(parsedBase / days)}/ngày · ${formatVND(parsedBase / days / hours)}/giờ`;
    }
  }, [basis, parsedBase, standardDays, params]);

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
    const gross = basis === 'PIECE' ? 0 : parsedBase;
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
    basis, parsedBase, insuranceEnabled, effectiveInsuranceBase, dependents,
    taxMode, flatRate, params,
  ]);

  const handleSave = async () => {
    if (!target) return;
    if (basis !== 'PIECE' && parsedBase <= 0) {
      toast('Nhập đơn giá lương hợp lệ.', 'warning');
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
      pay_basis: basis,
      base_amount: parsedBase,
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

          {/* --- Lương gốc --- */}
          <section className="space-y-3">
            <h3 className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
              Bước 1 · Lương gốc
            </h3>

            {/* Lương gốc cũng là một KHOẢN trong danh mục, khai y như mọi
                khoản khác ở Bước 3: chọn khoản, rồi chọn cách tính. Không có
                lý do gì bắt học một mô hình riêng chỉ để khai một con số.

                Năm thẻ cơ chế cũ KHÔNG bỏ hẳn, chỉ thu vào mục "cách cũ":
                người đang ăn lương giờ / ngày / khoán vẫn chạy trên `pay_basis`,
                bỏ đi là mất cơ chế của họ giữa kỳ. Mục đó tự mở sẵn cho ai
                đang dùng, và đóng với người khai mới. */}
            {baseComponent ? (
              <div className="rounded-xl border-2 border-indigo-200 bg-indigo-50/60 px-3.5 py-3">
                <p className="text-sm font-bold text-slate-900">{baseComponent.name}</p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-slate-600">
                  Khoản được đánh dấu <strong>lương gốc</strong> trong danh mục. Mức khai bên dưới
                  là căn cứ tính đơn giá giờ tăng ca và mức đóng bảo hiểm.
                </p>
              </div>
            ) : (
              <>
                <div className="rounded-xl border border-dashed border-slate-300 bg-white px-3.5 py-3">
                  <p className="text-sm font-bold text-slate-800">Chưa có khoản nào là lương gốc</p>
                  <p className="mt-1 text-[11px] leading-relaxed text-slate-600">
                    Sang <strong>Danh mục khoản lương</strong>, bật cờ <strong>&ldquo;Đây là khoản
                    LƯƠNG GỐC&rdquo;</strong> cho khoản lương cơ bản. Sau đó khai nó như mọi khoản
                    khác ở Bước 3: chọn khoản, rồi chọn cách tính.
                  </p>
                </div>

                {/* `open` theo dữ liệu thật: ai đang ăn lương giờ/ngày/khoán
                    thì mở sẵn để thấy ngay cơ chế của mình; người khai mới
                    thấy nó đóng, nên đi theo đường khoản trong danh mục. */}
                <details open={basis !== 'MONTHLY' || parsedBase > 0} className="group">
                  <summary className="cursor-pointer list-none text-[11px] font-bold text-slate-500 transition hover:text-indigo-700">
                    Cách cũ: chọn cơ chế lương cố định ▾
                  </summary>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {PAY_BASES.map((entry) => (
                      <button
                        key={entry.value}
                        type="button"
                        onClick={() => setBasis(entry.value)}
                        aria-pressed={basis === entry.value}
                        className={`rounded-xl border-2 px-3 py-2.5 text-left transition ${
                          basis === entry.value
                            ? 'border-indigo-600 bg-indigo-50'
                            : 'border-slate-200 hover:border-indigo-300 hover:bg-slate-50'
                        }`}
                      >
                        <span className="block text-sm font-bold text-slate-800">{payBasisLabel(entry.value)}</span>
                        <span className="mt-0.5 block text-[11px] font-semibold text-indigo-600">{entry.who}</span>
                        <span className="mt-1 block text-[11px] leading-relaxed text-slate-500">{entry.hint}</span>
                      </button>
                    ))}
                  </div>
                </details>
              </>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Input
                  label={baseComponent ? `Mức ${baseComponent.name} (VND)` : BASE_AMOUNT_LABEL[basis]}
                  inputMode="numeric"
                  placeholder="VD: 15000000"
                  value={baseAmount}
                  onChange={(e) => setBaseAmount(digitsOnly(e.target.value))}
                />
                {parsedBase > 0 && (
                  <p className="mt-1.5 text-xs text-slate-500">
                    {formatVND(parsedBase)} — quy đổi {preview}
                  </p>
                )}
              </div>
              <Input
                label="Áp dụng từ ngày"
                type="date"
                value={effectiveFrom}
                onChange={(e) => setEffectiveFrom(e.target.value)}
              />
            </div>

            {/* Ngày công chuẩn chỉ là mẫu số của lương THÁNG. Hiện nó khi trả
                theo giờ hay theo sản lượng chỉ khiến người khai tưởng nó có
                ảnh hưởng. */}
            {USES_STANDARD_DAYS.includes(basis) && (
              <Input
                label={`Ngày công chuẩn riêng (trống = ${params.standardWorkDays} theo công ty)`}
                inputMode="numeric"
                placeholder={String(params.standardWorkDays)}
                value={standardDays}
                onChange={(e) => setStandardDays(digitsOnly(e.target.value))}
              />
            )}
            <p className="rounded-lg bg-blue-50 px-3 py-2 text-xs leading-relaxed text-blue-800">
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
                  /* Lương khoán không có mức cứng để suy ra, để trống là đóng
                     bảo hiểm trên 0đ — sai mà không có gì báo. */
                  <p className="mt-1.5 flex items-start gap-1.5 text-xs text-amber-700">
                    <TriangleAlert className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                    Chưa xác định được mức đóng. Hình thức trả lương này không có mức cứng để suy ra,
                    phải nhập tay — bỏ trống là đóng bảo hiểm trên 0 đồng.
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
            <div className="flex items-center justify-between">
              <h3 className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                Bước 3 · Các khoản lương ({drafts.length})
              </h3>
              <Button variant="outline" size="sm" onClick={addDraft} disabled={availableComponents.length === 0}>
                <Plus className="h-3.5 w-3.5" /> Thêm khoản
              </Button>
            </div>

            {drafts.length === 0 ? (
              <p className="rounded-xl border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-500">
                Chưa gán khoản nào. Người này chỉ nhận lương gốc, bảo hiểm và thuế.
              </p>
            ) : (
              <div className="space-y-3">
                {drafts.map((draft, index) => {
                  const component = componentById.get(draft.componentId);
                  return (
                    <div key={draft.id ?? `new-${index}`} className="rounded-xl border border-slate-200 p-3">
                      <div className="flex items-start gap-2">
                        <div className="min-w-0 flex-1">
                          <Select
                            value={draft.componentId}
                            onChange={(e) => updateDraft(index, { componentId: e.target.value })}
                          >
                            {components
                              .filter((item) => item.is_active || item.id === draft.componentId)
                              .map((item) => (
                                <option key={item.id} value={item.id}>
                                  {item.kind === 'DEDUCTION' ? '− ' : item.kind === 'EMPLOYER_COST' ? '◦ ' : '+ '}
                                  {item.name}
                                </option>
                              ))}
                          </Select>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeDraft(index)}
                          className="mt-1 rounded p-2 text-slate-300 transition-colors hover:bg-red-50 hover:text-red-600"
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
