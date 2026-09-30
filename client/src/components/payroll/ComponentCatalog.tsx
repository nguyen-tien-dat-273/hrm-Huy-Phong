// ============================================================================
// Danh mục khoản lương của công ty.
// ----------------------------------------------------------------------------
// Định nghĩa một lần ở đây, gán cho từng người ở PaySchemeModal. Nhờ tách hai
// việc này mà "tăng ca 150%" chỉ cần viết công thức một lần cho cả công ty,
// trong khi mỗi người vẫn ghi đè được đơn giá hoặc công thức của riêng mình.
// ============================================================================

import { useMemo, useState } from 'react';
import { Lock, Pencil, Plus, Trash2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input, Select, Textarea } from '@/components/ui/Input';
import { useToast } from '@/contexts/ToastContext';
import { useConfirm } from '@/contexts/ConfirmContext';
import { formatVND } from '@/lib/utils';
import { sampleFormulaScope } from '@/lib/payroll';
import { validateFormula } from '@/lib/payrollFormula';
import { deleteComponent, saveComponent } from '@/lib/payrollData';
import type { PayrollParams } from '@/lib/payrollSettings';
import type { PayCalcType, PayComponent, PayComponentKind } from '@/types';

const KIND_LABEL: Record<PayComponentKind, string> = {
  EARNING: 'Khoản cộng',
  DEDUCTION: 'Khoản trừ',
  EMPLOYER_COST: 'Chi phí doanh nghiệp',
};

const CALC_LABEL: Record<PayCalcType, string> = {
  FIXED: 'Số tiền cố định',
  PER_DAY: 'Đơn giá × ngày công',
  PER_HOUR: 'Đơn giá × số giờ',
  PER_UNIT: 'Đơn giá × sản lượng',
  PERCENT: 'Phần trăm của khoản khác',
  FORMULA: 'Công thức tự do',
};

interface ComponentCatalogProps {
  /** Tham số lương, dùng dựng bộ biến mẫu khi kiểm tra công thức. */
  params: PayrollParams;
  components: PayComponent[];
  onChanged: () => void;
}

interface Draft {
  id?: string;
  code: string;
  name: string;
  kind: PayComponentKind;
  calc_type: PayCalcType;
  default_amount: string;
  input_code: string;
  base_code: string;
  formula: string;
  taxable: boolean;
  insurable: boolean;
  prorate: boolean;
  sort_order: string;
  ot_multiplier: string;
  tax_exempt_cap: string;
  max_amount: string;
  is_active: boolean;
  note: string;
}

const BLANK: Draft = {
  code: '', name: '', kind: 'EARNING', calc_type: 'FIXED', default_amount: '0',
  input_code: '', base_code: '', formula: '', taxable: true, insurable: false,
  prorate: false, sort_order: '500', ot_multiplier: '',
  tax_exempt_cap: '', max_amount: '', is_active: true, note: '',
};

export function ComponentCatalog({ components, params, onChanged }: ComponentCatalogProps) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);

  const formulaScope = useMemo(() => {
    const codes = components.flatMap((component) => [
      component.code,
      ...(component.input_code ? [component.input_code] : []),
    ]);
    return sampleFormulaScope(params, codes);
  }, [components, params]);

  const formulaError = draft?.calc_type === 'FORMULA' && draft.formula.trim()
    ? validateFormula(draft.formula, formulaScope)
    : null;

  const grouped = useMemo(() => ({
    EARNING: components.filter((item) => item.kind === 'EARNING'),
    DEDUCTION: components.filter((item) => item.kind === 'DEDUCTION'),
    EMPLOYER_COST: components.filter((item) => item.kind === 'EMPLOYER_COST'),
  }), [components]);

  const openEdit = (component: PayComponent) => setDraft({
    id: component.id,
    code: component.code,
    name: component.name,
    kind: component.kind,
    calc_type: component.calc_type,
    default_amount: String(Number(component.default_amount)),
    input_code: component.input_code ?? '',
    base_code: component.base_code ?? '',
    formula: component.formula ?? '',
    taxable: component.taxable,
    insurable: component.insurable,
    prorate: component.prorate,
    sort_order: String(component.sort_order),
    ot_multiplier: component.ot_multiplier == null ? '' : String(Number(component.ot_multiplier)),
    tax_exempt_cap: component.tax_exempt_cap == null ? '' : String(Number(component.tax_exempt_cap)),
    max_amount: component.max_amount == null ? '' : String(Number(component.max_amount)),
    is_active: component.is_active,
    note: component.note ?? '',
  });

  const handleSave = async () => {
    if (!draft) return;
    const code = draft.code.trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9_]*$/.test(code)) {
      toast('Mã khoản phải viết hoa không dấu, bắt đầu bằng chữ. VD: BONUS_TET', 'warning');
      return;
    }
    if (!draft.name.trim()) {
      toast('Nhập tên khoản lương.', 'warning');
      return;
    }
    if (formulaError) {
      toast('Công thức chưa hợp lệ: ' + formulaError, 'warning');
      return;
    }
    if (draft.calc_type === 'PERCENT' && !draft.base_code.trim()) {
      toast('Khoản tính theo phần trăm cần chỉ rõ tính trên mã nào.', 'warning');
      return;
    }
    if ((draft.calc_type === 'PER_HOUR' || draft.calc_type === 'PER_UNIT') && !draft.input_code.trim()) {
      toast('Khoản tính theo số lượng cần một mã số liệu tháng.', 'warning');
      return;
    }

    setSaving(true);
    const error = await saveComponent({
      ...(draft.id ? { id: draft.id } : {}),
      code,
      name: draft.name.trim(),
      kind: draft.kind,
      calc_type: draft.calc_type,
      default_amount: Number(draft.default_amount) || 0,
      input_code: draft.input_code.trim().toUpperCase() || null,
      base_code: draft.base_code.trim().toUpperCase() || null,
      formula: draft.formula.trim() || null,
      taxable: draft.taxable,
      insurable: draft.insurable,
      prorate: draft.prorate,
      sort_order: Number(draft.sort_order) || 500,
      ot_multiplier: draft.ot_multiplier ? Number(draft.ot_multiplier) : null,
      tax_exempt_cap: draft.tax_exempt_cap ? Number(draft.tax_exempt_cap) : null,
      max_amount: draft.max_amount ? Number(draft.max_amount) : null,
      is_active: draft.is_active,
      note: draft.note.trim() || null,
    });
    setSaving(false);

    if (error) {
      toast('Lưu khoản lương thất bại: ' + error, 'error');
      return;
    }
    toast(`Đã lưu khoản "${draft.name}".`, 'success');
    setDraft(null);
    onChanged();
  };

  const handleDelete = async (component: PayComponent) => {
    const ok = await confirm({
      title: `Xóa khoản "${component.name}"?`,
      message:
        'Mọi nhân sự đang được gán khoản này sẽ mất khoản đó ở các kỳ lương CHƯA chốt. ' +
        'Phiếu lương đã duyệt không đổi vì số liệu đã đóng băng.',
      confirmLabel: 'Xóa khoản',
      danger: true,
    });
    if (!ok) return;

    const error = await deleteComponent(component.id);
    if (error) {
      toast('Xóa thất bại: ' + error, 'error');
      return;
    }
    toast('Đã xóa khoản lương.', 'success');
    onChanged();
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        {/* Tiêu đề và câu mô tả do TRANG in ra rồi (AdminPayroll, bảng
            TAB_INTRO) — in lại ở đây thành hai dòng tiêu đề giống nhau chồng
            nhau. Chỉ giữ lại lưu ý riêng của tab này. */}
        <p className="max-w-2xl text-xs leading-relaxed text-slate-400">
          Bảo hiểm bắt buộc và thuế TNCN không nằm ở đây — hệ thống tự tính theo tỷ lệ khai
          ở tab <strong className="text-slate-500">Tham số lương</strong>.
        </p>
        <Button onClick={() => setDraft({ ...BLANK })}>
          <Plus className="h-4 w-4" /> Thêm khoản
        </Button>
      </div>

      {(['EARNING', 'DEDUCTION', 'EMPLOYER_COST'] as PayComponentKind[]).map((kind) => (
        <Card key={kind}>
          <CardContent className="p-0">
            <div className="border-b border-slate-100 bg-slate-50 px-5 py-3">
              <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                {KIND_LABEL[kind]} ({grouped[kind].length})
              </span>
            </div>
            {grouped[kind].length === 0 ? (
              <p className="px-5 py-6 text-center text-sm text-slate-400">Chưa có khoản nào.</p>
            ) : (
              <ul className="divide-y divide-slate-50">
                {grouped[kind].map((component) => (
                  <li
                    key={component.id}
                    title={component.note ?? undefined}
                    className="flex items-start gap-3 px-5 py-3.5"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-bold text-slate-800">{component.name}</span>
                        <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-500">
                          {component.code}
                        </code>
                        {!component.is_active && (
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-400">
                            TẮT
                          </span>
                        )}
                        {!component.taxable && kind === 'EARNING' && (
                          <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold text-emerald-600">
                            MIỄN THUẾ
                          </span>
                        )}
                        {component.insurable && (
                          <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-bold text-blue-600">
                            TÍNH BẢO HIỂM
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-slate-500">
                        {CALC_LABEL[component.calc_type]}
                        {component.calc_type === 'PERCENT' && ` — ${Number(component.default_amount)}% của ${component.base_code}`}
                        {component.calc_type === 'FIXED' && ` — mặc định ${formatVND(Number(component.default_amount))}`}
                        {component.calc_type === 'FORMULA' && (
                          <code className="ml-1 font-mono text-slate-600">{component.formula}</code>
                        )}
                      </p>
                    </div>
                    <div className="flex flex-shrink-0 items-center gap-1">
                      <button
                        onClick={() => openEdit(component)}
                        className="rounded p-1.5 text-slate-300 transition-colors hover:bg-indigo-50 hover:text-indigo-600"
                        aria-label={`Sửa ${component.name}`}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      {component.is_system ? (
                        <span
                          className="p-1.5 text-slate-200"
                          title="Khoản hệ thống — sửa được nhưng không xóa được"
                        >
                          <Lock className="h-3.5 w-3.5" />
                        </span>
                      ) : (
                        <button
                          onClick={() => handleDelete(component)}
                          className="rounded p-1.5 text-slate-300 transition-colors hover:bg-red-50 hover:text-red-600"
                          aria-label={`Xóa ${component.name}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      ))}

      <Modal
        open={!!draft}
        onClose={() => setDraft(null)}
        title={draft?.id ? 'Sửa khoản lương' : 'Thêm khoản lương'}
        size="lg"
      >
        {draft && (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                label="Tên khoản"
                placeholder="VD: Thưởng doanh số quý"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
              <Input
                label="Mã (viết hoa, dùng trong công thức)"
                placeholder="VD: BONUS_QUARTER"
                value={draft.code}
                onChange={(e) => setDraft({ ...draft, code: e.target.value.toUpperCase() })}
                className="font-mono"
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Select
                label="Loại"
                value={draft.kind}
                onChange={(e) => setDraft({ ...draft, kind: e.target.value as PayComponentKind })}
              >
                {Object.entries(KIND_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </Select>
              <Select
                label="Cách tính"
                value={draft.calc_type}
                onChange={(e) => setDraft({ ...draft, calc_type: e.target.value as PayCalcType })}
              >
                {Object.entries(CALC_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </Select>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                label={draft.calc_type === 'PERCENT' ? 'Tỷ lệ mặc định (%)' : 'Giá trị / đơn giá mặc định'}
                inputMode="decimal"
                value={draft.default_amount}
                onChange={(e) => setDraft({ ...draft, default_amount: e.target.value.replace(/[^\d.]/g, '') })}
              />
              <Input
                label="Thứ tự tính (số nhỏ tính trước)"
                inputMode="numeric"
                value={draft.sort_order}
                onChange={(e) => setDraft({ ...draft, sort_order: e.target.value.replace(/[^\d]/g, '') })}
              />
              <Input
                label="Trần số tiền (VND) — trống = không chặn"
                inputMode="numeric"
                placeholder="VD: 234000 cho đoàn phí công đoàn"
                value={draft.max_amount}
                onChange={(e) => setDraft({ ...draft, max_amount: e.target.value.replace(/[^\d]/g, '') })}
              />
              <p className="text-xs leading-relaxed text-slate-500">Áp sau khi tính xong. Phiếu lương sẽ ghi rõ khoản đã chạm trần.</p>
            </div>

            {/* T04: phần tiền làm thêm trả cao hơn giờ thường được miễn thuế
                TNCN. Khai hệ số ở đây, engine tự suy ra phần miễn — bắt HR tự
                tính tỷ lệ là mời thêm một chỗ nhập sai. */}
            {draft.kind === 'EARNING' && (
              <div>
                <Input
                  label="Hệ số làm thêm giờ (để trống nếu không phải tăng ca)"
                  inputMode="decimal"
                  placeholder="VD: 1.5 cho ngày thường, 2 cho ngày nghỉ, 3 cho ngày lễ"
                  value={draft.ot_multiplier}
                  onChange={(e) => setDraft({ ...draft, ot_multiplier: e.target.value.replace(/[^\d.]/g, '') })}
                />
                <p className="mt-1 text-xs leading-relaxed text-slate-500">
                  {Number(draft.ot_multiplier) > 1
                    ? `Phần trả cao hơn giờ thường được miễn thuế TNCN — tức ${
                      Math.round(((Number(draft.ot_multiplier) - 1) / Number(draft.ot_multiplier)) * 100)
                    }% số tiền của khoản này không tính vào thu nhập chịu thuế.`
                    : 'Chỉ khai cho khoản tăng ca. Khoản thường chịu thuế toàn bộ.'}
                </p>
              </div>
            )}

            {(draft.calc_type === 'PER_HOUR' || draft.calc_type === 'PER_UNIT') && (
              <Input
                label="Mã số liệu tháng"
                placeholder="VD: OT_WEEKDAY_HOURS hoặc UNITS"
                value={draft.input_code}
                onChange={(e) => setDraft({ ...draft, input_code: e.target.value.toUpperCase() })}
                className="font-mono"
              />
            )}

            {draft.calc_type === 'PERCENT' && (
              <Input
                label="Tính phần trăm trên mã nào"
                placeholder="VD: BASE, GROSS, INSURANCE_BASE, REVENUE"
                value={draft.base_code}
                onChange={(e) => setDraft({ ...draft, base_code: e.target.value.toUpperCase() })}
                className="font-mono"
              />
            )}

            {draft.calc_type === 'FORMULA' && (
              <Input
                label="Công thức"
                placeholder="VD: HOURLY_RATE * 1.5 * OT_WEEKDAY_HOURS"
                value={draft.formula}
                onChange={(e) => setDraft({ ...draft, formula: e.target.value })}
                error={formulaError ?? undefined}
                className="font-mono text-xs"
              />
            )}

            <div className="space-y-2.5 rounded-xl border border-slate-200 p-3.5">
              <Toggle
                checked={draft.taxable}
                onChange={(taxable) => setDraft({ ...draft, taxable })}
                label="Tính vào thu nhập chịu thuế TNCN"
                hint="Tắt cho tiền ăn ca trong mức miễn, công tác phí, trang phục."
              />
              {/* Ngưỡng miễn thuế chỉ có nghĩa khi khoản được đánh KHÔNG chịu
                  thuế: nó nói "miễn tới đây thôi, phần vượt vẫn phải tính". */}
              {!draft.taxable && (
                <div>
                  <Input
                    label="Miễn thuế tới mức (VND) — trống = miễn toàn bộ"
                    inputMode="numeric"
                    placeholder="VD: 730000 cho tiền ăn ca"
                    value={draft.tax_exempt_cap}
                    onChange={(e) => setDraft({ ...draft, tax_exempt_cap: e.target.value.replace(/[^\d]/g, '') })}
                  />
                  <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
                    Trả vượt ngưỡng này thì phần vượt tự động tính vào thu nhập chịu thuế.
                  </p>
                </div>
              )}
              <Toggle
                checked={draft.insurable}
                onChange={(insurable) => setDraft({ ...draft, insurable })}
                label="Tính vào lương đóng bảo hiểm"
                hint="Thường chỉ bật cho phụ cấp có tính chất lương như chức vụ, thâm niên."
              />
              <Toggle
                checked={draft.prorate}
                onChange={(prorate) => setDraft({ ...draft, prorate })}
                label="Chia theo ngày công thực tế"
                hint="Tắt nếu khoản trả trọn tháng bất kể đi làm bao nhiêu ngày."
              />
              <Toggle
                checked={draft.is_active}
                onChange={(is_active) => setDraft({ ...draft, is_active })}
                label="Đang sử dụng"
                hint="Tắt để ngừng áp dụng mà không xóa lịch sử."
              />
            </div>

            <Textarea
              label="Ghi chú"
              rows={2}
              value={draft.note}
              onChange={(e) => setDraft({ ...draft, note: e.target.value })}
            />

            <div className="flex gap-3 pt-1">
              <Button variant="outline" onClick={() => setDraft(null)} className="flex-1" disabled={saving}>
                Hủy
              </Button>
              <Button onClick={handleSave} className="flex-1" disabled={saving || !!formulaError}>
                {saving ? 'Đang lưu…' : 'Lưu khoản'}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function Toggle({
  checked, onChange, label, hint,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  hint: string;
}) {
  return (
    <label className="flex items-start gap-2.5 text-sm text-slate-700">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 flex-shrink-0 rounded border-slate-300"
      />
      <span>
        {label}
        <span className="block text-xs leading-relaxed text-slate-500">{hint}</span>
      </span>
    </label>
  );
}
