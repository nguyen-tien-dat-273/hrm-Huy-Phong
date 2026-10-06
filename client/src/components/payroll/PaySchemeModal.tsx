// ============================================================================
// Thiết lập cơ chế lương cho MỘT người.
// ----------------------------------------------------------------------------
// Đây là chỗ thay thế cho modal cũ chỉ có hai ô "lương cơ bản" và "phụ cấp".
// Một người ở đây được chọn cách tính lương gốc, mức đóng bảo hiểm, cách khấu
// trừ thuế, và gán từng khoản cộng/trừ riêng kèm giá trị hoặc công thức của
// riêng họ.
// ============================================================================

import { useEffect, useMemo, useState } from 'react';
import { PenLine, Save, Search, Trash2, TriangleAlert, Wallet } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input, Textarea } from '@/components/ui/Input';
import { Avatar } from '@/components/ui/Avatar';
import { PayrollFormulaBuilder } from '@/components/payroll/PayrollFormulaBuilder';
import { PayItemFormulaPicker } from '@/components/payroll/PayItemFormulaPicker';
import { parsePayFormula } from '@/lib/payItemFormula';
import { useToast } from '@/contexts/ToastContext';
import { formatVND } from '@/lib/utils';
import { sampleFormulaScope } from '@/lib/payroll';
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
  /** Dòng đang được lưu lẻ, để chỉ khoá đúng nút đó. */
  const [savingOne, setSavingOne] = useState<number | null>(null);
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
   * Mã các khoản khác đã khai cho CHÍNH người này.
   *
   * Khoản lương gán theo từng người: công thức trỏ tới một khoản mà người này
   * chưa được khai thì engine tính phần đó bằng 0đ. Đưa danh sách này xuống để
   * ô chọn nguồn tách được "đã khai cho người này" với phần còn lại.
   */
  /**
   * Gom khoản theo nhóm, mỗi nhóm MỘT khung.
   *
   * Trước đây mỗi khoản một khung riêng, và chữ "KHOẢN CỘNG" lặp lại trên
   * từng khung — mười khoản cộng là mười lần cùng một chữ. Nhóm chỉ cần nói
   * một lần ở đầu khung.
   *
   * Giữ `index` GỐC trong mảng `drafts` chứ không đánh số lại theo nhóm: mọi
   * hàm sửa/xoá đều chạy theo chỉ số của mảng gốc, đánh lại là sửa nhầm dòng.
   */
  const groups = useMemo(() => {
    const order: Array<PayComponent['kind']> = ['EARNING', 'DEDUCTION', 'EMPLOYER_COST'];
    const label: Record<string, string> = {
      EARNING: 'Khoản cộng', DEDUCTION: 'Khoản trừ', EMPLOYER_COST: 'Chi phí doanh nghiệp',
    };
    return order
      .map((kind) => ({
        kind,
        label: label[kind],
        rows: drafts
          .map((draft, index) => ({ draft, index }))
          .filter((row) => (componentById.get(row.draft.componentId)?.kind ?? 'EARNING') === kind),
      }))
      .filter((group) => group.rows.length > 0);
  }, [drafts, componentById]);

  const assignedCodes = (skipIndex: number) => drafts
    .filter((_, index) => index !== skipIndex)
    .map((draft) => componentById.get(draft.componentId)?.code)
    .filter((code): code is string => !!code);

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
          note: '',
        }];
      }
      if (existing.id) setRemovedIds((ids) => [...ids, existing.id as string]);
      return list.filter((draft) => draft.componentId !== componentId);
    });
  };

  /**
   * Lưu RIÊNG một khoản, không chờ lưu cả cơ chế.
   *
   * Dùng khi khai xong một khoản rồi muốn chốt nó lại trước khi khai tiếp.
   *
   * Phải ghi `id` trả về vào draft: không giữ id thì lần lưu tổng sau đó coi
   * khoản này là mới và CHÈN THÊM một dòng nữa cho cùng một khoản — người đó
   * ăn khoản lương hai lần.
   */
  const saveOne = async (index: number) => {
    if (!target) return;
    const draft = drafts[index];
    if (!draft?.componentId) return;
    if (formulaErrors[index]) {
      toast('Công thức khoản này chưa hợp lệ — sửa trước khi lưu.', 'warning');
      return;
    }
    setSavingOne(index);
    const { error, id } = await savePayItem({
      ...(draft.id ? { id: draft.id } : {}),
      user_id: target.id,
      component_id: draft.componentId,
      amount: draft.amount ? Number(draft.amount) : null,
      formula: draft.formula.trim() || null,
      effective_from: effectiveFrom,
      note: draft.note.trim() || null,
      created_by: actorId,
    });
    setSavingOne(null);
    if (error) return toast('Không lưu được khoản này: ' + error, 'error');
    if (id) updateDraft(index, { id });
    toast(`Đã lưu ${componentById.get(draft.componentId)?.name ?? 'khoản'}.`, 'success');
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
      // Bốn trường dưới KHÔNG còn ô nhập trên màn. State của chúng nạp từ bản
      // ghi hiện có ở `useEffect` khởi tạo, nên lưu lại là ghi đúng giá trị cũ
      // chứ không phải mặc định — bỏ ô nhập mà ghi mặc định là âm thầm xoá
      // thiết lập bảo hiểm/thuế của người ta.
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
      const { error } = await savePayItem({
        ...(draft.id ? { id: draft.id } : {}),
        user_id: target.id,
        component_id: draft.componentId,
        amount: draft.amount ? Number(draft.amount) : null,
        formula: draft.formula.trim() || null,
        // Dùng chung ngày của cả cơ chế: ô "Áp dụng từ" giờ nằm ngoài, mỗi
        // khoản không còn ngày riêng.
        effective_from: effectiveFrom,
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

          {/* Màn này hiện CHỈ còn danh mục khoản. Hiệu lực, ngày công chuẩn,
              bảo hiểm và thuế đã bỏ khỏi giao diện theo yêu cầu — nhưng state
              của chúng GIỮ NGUYÊN và vẫn được ghi xuống khi lưu, lấy từ bản
              ghi hiện có. Bỏ ô nhập mà ghi giá trị mặc định là âm thầm xoá
              thiết lập bảo hiểm/thuế của người ta. */}
          <section className="space-y-3">
            <h3 className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
              Các khoản lương ({drafts.length})
            </h3>

            {/* Một ngày hiệu lực cho CẢ cơ chế, không phải mỗi khoản một ngày.
                Đổi lương là một quyết định có một mốc; để mỗi khoản một ngày
                thì sửa vài khoản xong sẽ có người mang ba mốc khác nhau, và
                đối chiếu bảng lương không ra vì sao. */}
            <Input
              label="Áp dụng từ ngày"
              type="date"
              value={effectiveFrom}
              onChange={(event) => setEffectiveFrom(event.target.value)}
            />
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
              <div className="space-y-4">
                {groups.map((group) => (
                  <div key={group.kind} className="rounded-xl border border-slate-200">
                    <p className="border-b border-slate-100 px-3 py-2 text-[11px] font-bold uppercase tracking-widest text-slate-400">
                      {group.label} ({group.rows.length})
                    </p>
                    <div className="divide-y divide-slate-100">
                      {group.rows.map(({ draft, index }) => {
                        const component = componentById.get(draft.componentId);
                        return (
                          <div key={draft.id ?? `new-${index}`} className="p-3">
                            {/* Hàng thao tác đứng TRÊN CÙNG và giống nhau ở mọi
                                khoản: công thức sinh ra, nút tự viết, lưu lẻ,
                                xoá. Để rải mỗi thứ một chỗ thì mỗi khoản phải
                                tìm lại từ đầu. */}
                            <div className="mb-2 flex flex-wrap items-center gap-2">
                              <code className="min-w-0 flex-1 break-words font-mono text-[11px] text-indigo-700">
                                {draft.formula.trim() || '—'}
                              </code>
                              {component?.is_base && (
                                <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-bold text-indigo-700">
                                  LƯƠNG GỐC
                                </span>
                              )}
                              <button
                                type="button"
                                onClick={() => updateDraft(index, { handWritten: !draft.handWritten })}
                                className={`inline-flex items-center gap-1 rounded px-1.5 py-1 text-[11px] font-bold transition ${
                                  draft.handWritten ? 'bg-indigo-50 text-indigo-700' : 'text-slate-400 hover:text-indigo-700'
                                }`}
                              >
                                <PenLine className="h-3 w-3" /> Tự viết
                              </button>
                              <button
                                type="button"
                                onClick={() => void saveOne(index)}
                                disabled={savingOne !== null}
                                className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-[11px] font-bold text-slate-400 transition hover:text-emerald-700 disabled:opacity-40"
                              >
                                <Save className="h-3 w-3" /> {savingOne === index ? 'Đang lưu…' : 'Lưu'}
                              </button>
                              <button
                                type="button"
                                onClick={() => removeDraft(index)}
                                className="rounded p-1 text-slate-300 transition-colors hover:bg-red-50 hover:text-red-600"
                                aria-label="Bỏ khoản này"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </div>

                            <div className="flex items-start gap-2">
                              <div className="min-w-0 flex-1">

                                {/* Khoản tính theo % thì "× số công" vô nghĩa — tỷ lệ
                                    nhân vào một khoản khác, không nhân vào ngày công.
                                    Giữ ô nhập tỷ lệ như cũ cho nhóm đó. */}
                                {component?.calc_type === 'PERCENT' && (
                                  <div className="mb-3">
                                    <Input
                                      label="Tỷ lệ riêng (%)"
                                      inputMode="decimal"
                                      placeholder={`Trống = ${formatComponentDefault(component)} theo danh mục`}
                                      value={draft.amount}
                                      onChange={(e) => updateDraft(index, { amount: e.target.value.replace(/[^\d.]/g, '') })}
                                    />
                                  </div>
                                )}

                                {draft.handWritten || component?.calc_type === 'PERCENT' ? (
                                  <PayrollFormulaBuilder
                                    label={`Công thức ${component?.name ?? ''}`}
                                    value={draft.formula}
                                    onChange={(formula) => updateDraft(index, { formula })}
                                    sampleScope={formulaScope}
                                    components={components}
                                    defaultFormula={component?.formula}
                                  />
                                ) : (
                                  <PayItemFormulaPicker
                                    componentName={component?.name ?? 'Khoản'}
                                    assignedCodes={assignedCodes(index)}
                                    formula={draft.formula}
                                    onFormulaChange={(formula) => updateDraft(index, { formula })}
                                    amount={draft.amount}
                                    onAmountChange={(amount) => updateDraft(index, { amount: digitsOnly(amount) })}
                                    components={components}
                                    selfCode={component?.code ?? null}
                                    sampleScope={formulaScope}
                                  />
                                )}

                                {/* Khoản có mức mặc định 0 mà không khai riêng thì gán
                                    xong vẫn ra 0đ — trông như đã làm xong nhưng thực tế
                                    không cộng gì vào lương. */}
                                {component && !draft.formula.trim() && !draft.amount
                                  && Number(component.default_amount) === 0 && (
                                  <p className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-amber-700">
                                    <TriangleAlert className="h-3.5 w-3.5 flex-shrink-0" />
                                    Chưa có mức — khoản này sẽ cộng 0đ.
                                  </p>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
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

/** Một dòng trong bảng ước tính. `muted` cho dòng chỉ để tham khảo, không cộng trừ. */
