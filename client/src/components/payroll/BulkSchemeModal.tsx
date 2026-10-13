// ============================================================================
// Thiết lập cơ chế lương cho NHIỀU người cùng lúc.
// ----------------------------------------------------------------------------
// Một tổ công nhân mười mấy người cùng một đơn giá ngày là chuyện thường. Mở
// từng phiếu gõ lại mười mấy lần vừa lâu, vừa gần như chắc chắn có một người
// bị gõ lệch mà không ai đối chiếu ra.
//
// Màn này CỐ Ý hẹp: chỉ đặt những thứ thường giống nhau cả tổ — cách trả
// lương, mức, ngày hiệu lực, mức đóng bảo hiểm, cách tính thuế. Những thứ
// thuộc về từng người (số người phụ thuộc, khoản cộng/trừ riêng) không có ở
// đây, vì đặt hàng loạt cho chúng gần như luôn là sai.
//
// Ghi theo ngày hiệu lực như bản lẻ: đây là TẠO BẢN GHI MỚI, không sửa đè bản
// cũ, nên các tháng đã chạy lương giữ nguyên mức cũ.
// ============================================================================

import { useEffect, useMemo, useState } from 'react';
import { TriangleAlert, Users } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Input';
import { useToast } from '@/contexts/ToastContext';
import { formatVND } from '@/lib/utils';
import { savePayItem, savePayProfile } from '@/lib/payrollData';
import type { PayBasis, PayComponent, Profile, TaxMode } from '@/types';
import type { PayrollParams } from '@/lib/payrollSettings';

/**
 * `pay_basis` không còn khai ở đây — xem chú thích trong `PaySchemeModal`.
 * Lương gốc là một khoản trong danh mục, nên gán hàng loạt cũng là gán KHOẢN
 * đó cho cả nhóm chứ không phải đặt một "hình thức trả lương".
 */
const LEGACY_PAY_BASIS: PayBasis = 'MONTHLY';

const TAX_MODES: Array<{ value: TaxMode; label: string }> = [
  { value: 'PROGRESSIVE', label: 'Lũy tiến 7 bậc' },
  { value: 'FLAT', label: 'Khấu trừ thẳng theo %' },
  { value: 'NONE', label: 'Không khấu trừ' },
];

const digitsOnly = (value: string) => value.replace(/[^\d]/g, '');

interface BulkSchemeModalProps {
  open: boolean;
  targets: Profile[];
  /** Danh mục khoản, để tìm khoản được đánh dấu lương gốc. */
  components: PayComponent[];
  params: PayrollParams;
  defaultEffectiveFrom: string;
  actorId: string | null;
  onClose: () => void;
  onSaved: () => void;
}

export function BulkSchemeModal({
  open, targets, components, params, defaultEffectiveFrom, actorId, onClose, onSaved,
}: BulkSchemeModalProps) {
  const { toast } = useToast();

  const [baseAmount, setBaseAmount] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState(defaultEffectiveFrom);
  const [insuranceEnabled, setInsuranceEnabled] = useState(true);
  const [insuranceBase, setInsuranceBase] = useState('');
  const [taxMode, setTaxMode] = useState<TaxMode>('PROGRESSIVE');
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (!open) return;
    setBaseAmount('');
    setEffectiveFrom(defaultEffectiveFrom);
    setInsuranceEnabled(true);
    setInsuranceBase('');
    setTaxMode('PROGRESSIVE');
    setProgress(0);
  }, [open, defaultEffectiveFrom]);

  const baseComponent = components.find((item) => item.is_base && item.is_active);
  const parsedBase = Number(baseAmount || '0');
  const effectiveInsuranceBase = Number(insuranceBase || '0') || parsedBase;

  const monthlyCost = useMemo(
    () => (parsedBase > 0 ? parsedBase * targets.length : null),
    [parsedBase, targets.length],
  );

  const save = async () => {
    if (!baseComponent) {
      toast('Chưa có khoản nào được đánh dấu lương gốc trong Danh mục khoản lương.', 'error');
      return;
    }
    if (parsedBase <= 0) {
      toast('Nhập mức lương gốc hợp lệ.', 'warning');
      return;
    }

    setSaving(true);
    setProgress(0);

    // Ghi tuần tự để đếm được đúng số người đã xong. Lỗi giữa chừng thì DỪNG
    // và nói rõ đã ghi tới ai — im lặng bỏ qua sẽ để lại một tổ nửa có nửa
    // không mà không ai biết.
    for (let index = 0; index < targets.length; index += 1) {
      const target = targets[index];
      const error = await savePayProfile({
        user_id: target.id,
        effective_from: effectiveFrom,
        // Hai cột vestigial, xem chú thích ở LEGACY_PAY_BASIS.
        pay_basis: LEGACY_PAY_BASIS,
        base_amount: 0,
        insurance_enabled: insuranceEnabled,
        insurance_base: insuranceBase ? Number(insuranceBase) : null,
        dependents: 0,
        tax_mode: taxMode,
        flat_tax_rate: taxMode === 'FLAT' ? 10 : undefined,
        standard_days_override: null,
        note: `Thiết lập hàng loạt cho ${targets.length} nhân sự.`,
        created_by: actorId,
      });

      if (error) {
        setSaving(false);
        toast(
          `Dừng ở ${target.name}: ${error}. Đã lưu xong ${index} nhân sự trước đó.`,
          'error',
        );
        onSaved();
        return;
      }

      // Mức lương gốc nằm ở KHOẢN, không nằm ở hồ sơ nữa — phải ghi dòng này
      // thì engine mới suy ra được đơn giá giờ tăng ca và mức đóng bảo hiểm.
      const { error: itemError } = await savePayItem({
        user_id: target.id,
        component_id: baseComponent.id,
        amount: parsedBase,
        formula: `(MUC_RIENG / STANDARD_DAYS) * PAID_DAYS`,
        effective_from: effectiveFrom,
        created_by: actorId,
      });
      if (itemError) {
        setSaving(false);
        toast(
          `Đã lưu hồ sơ nhưng không gán được khoản lương gốc cho ${target.name}: ${itemError}.`,
          'error',
        );
        onSaved();
        return;
      }
      setProgress(index + 1);
    }

    setSaving(false);
    toast(`Đã thiết lập cơ chế lương cho ${targets.length} nhân sự.`, 'success');
    onSaved();
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title="Thiết lập cơ chế lương hàng loạt" size="lg">
      <div className="space-y-5">
        <div className="flex items-start gap-3 rounded-xl bg-indigo-50 px-4 py-3">
          <Users className="mt-0.5 h-5 w-5 flex-shrink-0 text-indigo-600" />
          <div className="min-w-0">
            <p className="text-sm font-bold text-indigo-900">
              Áp cho {targets.length} nhân sự
            </p>
            <p className="mt-0.5 truncate text-xs text-indigo-800">
              {targets.slice(0, 5).map((person) => person.name).join(', ')}
              {targets.length > 5 && ` và ${targets.length - 5} người nữa`}
            </p>
          </div>
        </div>

        {baseComponent ? (
          <div>
            <Input
              label={`Mức ${baseComponent.name} mỗi tháng (VND)`}
              inputMode="numeric"
              placeholder="VD: 15000000"
              value={baseAmount}
              onChange={(e) => setBaseAmount(digitsOnly(e.target.value))}
            />
            <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
              Gán cho cả nhóm theo cách tính <strong>chia công chuẩn × ngày hưởng lương</strong>.
              Ai cần khác thì sửa riêng ở Cơ chế lương của người đó.
              {monthlyCost != null && (
                <> Tổng lương tháng của nhóm: <strong className="text-slate-700">{formatVND(monthlyCost)}</strong>.</>
              )}
            </p>
          </div>
        ) : (
          <div className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3">
            <TriangleAlert className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-700" />
            <p className="text-[11px] leading-relaxed text-amber-900">
              Chưa có khoản nào được đánh dấu <strong>lương gốc</strong> trong Danh mục khoản lương.
              Bật cờ đó cho khoản lương cơ bản rồi quay lại — không có nó thì gán hàng loạt không
              biết ghi mức vào đâu.
            </p>
          </div>
        )}

        <Input
          label="Áp dụng từ ngày"
          type="date"
          value={effectiveFrom}
          onChange={(e) => setEffectiveFrom(e.target.value)}
        />

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
              Người lao động đóng{' '}
              {(params.socialInsuranceRate + params.healthInsuranceRate + params.unemploymentInsuranceRate).toFixed(1)}%.
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
                {effectiveInsuranceBase < params.regionalMinimumWage && (
                  <span className="text-amber-700">
                    {' '}— thấp hơn lương tối thiểu vùng {formatVND(params.regionalMinimumWage)}
                  </span>
                )}
              </p>
            ) : (
              <p className="mt-1.5 flex items-start gap-1.5 text-xs text-amber-700">
                <TriangleAlert className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                Chưa xác định được mức đóng — hình thức trả lương này không có mức cứng để suy ra.
              </p>
            )}
          </div>
        )}

        <Select label="Cách tính thuế TNCN" value={taxMode} onChange={(e) => setTaxMode(e.target.value as TaxMode)}>
          {TAX_MODES.map((mode) => (
            <option key={mode.value} value={mode.value}>{mode.label}</option>
          ))}
        </Select>

        <p className="rounded-lg bg-slate-50 px-3.5 py-2.5 text-xs leading-relaxed text-slate-600">
          <strong className="text-slate-700">Không đặt hàng loạt:</strong> số người phụ thuộc và các
          khoản cộng/trừ riêng — hai thứ này khác nhau theo từng người, đặt chung gần như luôn sai.
          Mở phiếu từng người ở nút <em>Sửa</em> để khai.
        </p>

        <p className="rounded-lg bg-blue-50 px-3.5 py-2.5 text-xs leading-relaxed text-blue-800">
          Đây là tạo bản ghi mới theo ngày hiệu lực, không sửa đè bản cũ. Các tháng đã chạy lương
          trước ngày này giữ nguyên mức cũ.
        </p>

        <div className="flex items-center justify-end gap-2">
          {saving && (
            <span className="mr-auto text-xs text-slate-500">
              Đang lưu {progress}/{targets.length}…
            </span>
          )}
          <Button variant="secondary" onClick={onClose} disabled={saving}>Hủy</Button>
          <Button theme="admin" onClick={save} disabled={saving || targets.length === 0}>
            {saving ? 'Đang lưu…' : `Áp cho ${targets.length} nhân sự`}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
