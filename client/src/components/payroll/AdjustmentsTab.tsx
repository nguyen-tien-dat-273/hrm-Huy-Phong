// ============================================================================
// Điều chỉnh lương: truy lĩnh và truy thu kỳ sau (LU-14).
// ----------------------------------------------------------------------------
// Sheet "Đặc tả Lương – KPI" ghi khoảng trống này ở mục LU-14: "Sai sót phát
// hiện sau khi khóa kỳ: truy lĩnh/truy thu kỳ sau – phiếu hiện chưa có dòng
// này."
//
// Điểm khác với việc gán một khoản lương thường: mỗi dòng ở đây BẮT BUỘC có
// lý do, và nên có kỳ gốc. Ba tháng sau nhìn lại, người rà soát phải trả lời
// được "khoản này bù cho tháng nào, vì sao" mà không phải đi hỏi ai.
// ============================================================================

import { useMemo, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, Plus, Trash2, TriangleAlert } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Avatar } from '@/components/ui/Avatar';
import { Input, Select, Textarea } from '@/components/ui/Input';
import { useToast } from '@/contexts/ToastContext';
import { useConfirm } from '@/contexts/ConfirmContext';
import { formatVND } from '@/lib/utils';
import { deletePayrollAdjustment, savePayrollAdjustment } from '@/lib/payrollData';
import type { PayrollAdjustment } from '@/lib/payroll';
import type { Profile } from '@/types';

interface AdjustmentsTabProps {
  profiles: Profile[];
  adjustments: PayrollAdjustment[];
  monthStart: string;
  monthLabel: string;
  actorId: string | null;
  /** Kỳ đã duyệt thì khóa — database cũng chặn, đây chỉ là lớp hiển thị. */
  readOnly: boolean;
  onChanged: () => void;
}

interface Draft {
  id?: string;
  user_id: string;
  kind: 'RECOVERY' | 'CLAWBACK';
  amount: string;
  reason: string;
  origin_month: string;
  taxable: boolean;
}

const KIND_LABEL: Record<Draft['kind'], string> = {
  RECOVERY: 'Truy lĩnh — trả bù cho nhân viên',
  CLAWBACK: 'Truy thu — thu hồi tiền đã trả thừa',
};

/** '2026-07-01' ↔ '2026-07' cho ô input type=month. */
const toMonthInput = (iso: string | null) => (iso ? iso.slice(0, 7) : '');
const fromMonthInput = (value: string) => (value ? `${value}-01` : null);

export function AdjustmentsTab({
  profiles, adjustments, monthStart, monthLabel, actorId, readOnly, onChanged,
}: AdjustmentsTabProps) {
  const { toast } = useToast();
  const confirm = useConfirm();

  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);

  const personById = useMemo(
    () => new Map(profiles.map((person) => [person.id, person])),
    [profiles],
  );

  const totals = useMemo(() => ({
    recovery: adjustments
      .filter((item) => item.kind === 'RECOVERY')
      .reduce((sum, item) => sum + Number(item.amount), 0),
    clawback: adjustments
      .filter((item) => item.kind === 'CLAWBACK')
      .reduce((sum, item) => sum + Number(item.amount), 0),
  }), [adjustments]);

  const save = async () => {
    if (!draft) return;
    if (!draft.user_id) {
      toast('Chọn nhân sự được điều chỉnh.', 'warning');
      return;
    }
    const amount = Number(draft.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast('Nhập số tiền lớn hơn 0.', 'warning');
      return;
    }
    // Bắt buộc lý do: đây là thứ phân biệt điều chỉnh với một khoản lương
    // thường, và là thứ người rà soát cần nhất khi mở lại hồ sơ sau này.
    if (!draft.reason.trim()) {
      toast('Ghi lý do điều chỉnh — bắt buộc, để rà soát về sau.', 'warning');
      return;
    }

    setSaving(true);
    const error = await savePayrollAdjustment({
      ...(draft.id ? { id: draft.id } : {}),
      user_id: draft.user_id,
      month_start: monthStart,
      origin_month: fromMonthInput(draft.origin_month),
      kind: draft.kind,
      amount,
      reason: draft.reason.trim(),
      taxable: draft.taxable,
      created_by: actorId,
    });
    setSaving(false);

    if (error) {
      toast('Lưu điều chỉnh thất bại: ' + error, 'error');
      return;
    }
    toast('Đã lưu điều chỉnh lương.', 'success');
    setDraft(null);
    onChanged();
  };

  const remove = async (adjustment: PayrollAdjustment) => {
    const person = personById.get(adjustment.user_id);
    const ok = await confirm({
      title: 'Xóa điều chỉnh này?',
      message:
        `${adjustment.kind === 'RECOVERY' ? 'Truy lĩnh' : 'Truy thu'} ` +
        `${formatVND(Number(adjustment.amount))} của ${person?.name ?? 'nhân sự'} ` +
        `sẽ không còn trên phiếu lương tháng ${monthLabel}.`,
      confirmLabel: 'Xóa',
      danger: true,
    });
    if (!ok) return;

    const error = await deletePayrollAdjustment(adjustment.id);
    if (error) {
      toast('Xóa thất bại: ' + error, 'error');
      return;
    }
    toast('Đã xóa điều chỉnh.', 'success');
    onChanged();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-bold text-slate-800">Điều chỉnh lương tháng {monthLabel}</h3>
          <p className="mt-0.5 text-sm leading-relaxed text-slate-500">
            Sai sót của kỳ đã khóa được xử lý ở kỳ này. Mỗi dòng phải ghi lý do và nên ghi kỳ
            phát sinh, để về sau tra được khoản tiền bù cho tháng nào.
          </p>
        </div>
        {!readOnly && (
          <Button onClick={() => setDraft({
            user_id: '', kind: 'RECOVERY', amount: '', reason: '', origin_month: '', taxable: true,
          })}>
            <Plus className="h-4 w-4" /> Thêm điều chỉnh
          </Button>
        )}
      </div>

      {readOnly && (
        <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          Kỳ lương đã duyệt nên không thêm sửa điều chỉnh được. Sai sót phát hiện lúc này
          xử lý ở kỳ sau — đó chính là mục đích của màn hình này.
        </p>
      )}

      {adjustments.length > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Card>
            <CardContent className="flex items-center gap-3 py-4">
              <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
                <ArrowUpRight className="h-4.5 w-4.5" />
              </span>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Tổng truy lĩnh</p>
                <p className="mt-0.5 text-base font-extrabold tabular-nums text-emerald-700">
                  {formatVND(totals.recovery)}
                </p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center gap-3 py-4">
              <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-red-50 text-red-600">
                <ArrowDownLeft className="h-4.5 w-4.5" />
              </span>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Tổng truy thu</p>
                <p className="mt-0.5 text-base font-extrabold tabular-nums text-red-700">
                  {formatVND(totals.clawback)}
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          {adjustments.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-slate-400">
              Chưa có điều chỉnh nào cho tháng {monthLabel}.
            </p>
          ) : (
            <ul className="divide-y divide-slate-50">
              {adjustments.map((adjustment) => {
                const person = personById.get(adjustment.user_id);
                const isRecovery = adjustment.kind === 'RECOVERY';
                return (
                  <li key={adjustment.id} className="flex items-start gap-3 px-5 py-4">
                    <Avatar name={person?.name ?? '?'} url={person?.avatar_url} size="sm" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-bold text-slate-800">
                          {person?.name ?? 'Nhân sự không còn hoạt động'}
                        </span>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                          isRecovery ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
                        }`}>
                          {isRecovery ? 'Truy lĩnh' : 'Truy thu'}
                        </span>
                        {!adjustment.taxable && (
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500">
                            KHÔNG CHỊU THUẾ
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-xs leading-relaxed text-slate-600">{adjustment.reason}</p>
                      <p className="mt-0.5 text-xs text-slate-400">
                        {adjustment.origin_month
                          ? `Bù cho kỳ ${adjustment.origin_month.slice(5, 7)}/${adjustment.origin_month.slice(0, 4)}`
                          : 'Chưa ghi kỳ phát sinh'}
                      </p>
                    </div>
                    <div className="flex flex-shrink-0 items-center gap-2">
                      <span className={`text-sm font-bold tabular-nums ${
                        isRecovery ? 'text-emerald-700' : 'text-red-700'
                      }`}>
                        {isRecovery ? '+' : '−'}{formatVND(Number(adjustment.amount))}
                      </span>
                      {!readOnly && (
                        <button
                          onClick={() => remove(adjustment)}
                          className="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600"
                          aria-label="Xóa điều chỉnh"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Modal open={!!draft} onClose={() => setDraft(null)} title="Thêm điều chỉnh lương" size="md">
        {draft && (
          <div className="space-y-4">
            <Select
              label="Nhân sự"
              value={draft.user_id}
              onChange={(e) => setDraft({ ...draft, user_id: e.target.value })}
            >
              <option value="">Chọn nhân sự</option>
              {profiles.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}{person.department ? ` · ${person.department}` : ''}
                </option>
              ))}
            </Select>

            <div>
              <Select
                label="Loại điều chỉnh"
                value={draft.kind}
                onChange={(e) => setDraft({ ...draft, kind: e.target.value as Draft['kind'] })}
              >
                {Object.entries(KIND_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </Select>
              <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
                {draft.kind === 'RECOVERY'
                  ? 'Cộng vào thu nhập kỳ này. Truy lĩnh tiền lương là thu nhập chịu thuế của kỳ CHI TRẢ.'
                  : 'Trừ vào thực nhận kỳ này. Không làm giảm thu nhập chịu thuế vì đây là thu hồi tiền đã trả.'}
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                label="Số tiền (VND)"
                inputMode="numeric"
                placeholder="VD: 1500000"
                value={draft.amount}
                onChange={(e) => setDraft({ ...draft, amount: e.target.value.replace(/[^\d]/g, '') })}
              />
              <Input
                label="Kỳ phát sinh sai sót"
                type="month"
                value={draft.origin_month}
                onChange={(e) => setDraft({ ...draft, origin_month: e.target.value })}
              />
            </div>
            {Number(draft.amount) > 0 && (
              <p className="-mt-2 text-xs text-slate-500">= {formatVND(Number(draft.amount))}</p>
            )}

            <Textarea
              label="Lý do (bắt buộc)"
              rows={2}
              placeholder="VD: Tháng 7 tính thiếu 8 giờ tăng ca ngày lễ"
              value={draft.reason}
              onChange={(e) => setDraft({ ...draft, reason: e.target.value })}
            />

            {draft.kind === 'RECOVERY' && (
              <label className="flex items-start gap-2.5 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={draft.taxable}
                  onChange={(e) => setDraft({ ...draft, taxable: e.target.checked })}
                  className="mt-0.5 h-4 w-4 flex-shrink-0 rounded border-slate-300"
                />
                <span>
                  Tính vào thu nhập chịu thuế
                  <span className="block text-xs leading-relaxed text-slate-500">
                    Bỏ chọn khi đây là khoản hoàn lại, ví dụ trả lại tiền phạt đã trừ nhầm —
                    hoàn tiền không phải thu nhập mới.
                  </span>
                </span>
              </label>
            )}

            <p className="flex items-start gap-2 rounded-lg bg-amber-50 px-3.5 py-2.5 text-xs leading-relaxed text-amber-800">
              <TriangleAlert className="mt-0.5 h-4 w-4 flex-shrink-0" />
              Điều chỉnh này vào phiếu lương tháng <strong>{monthLabel}</strong>. Kỳ lương gốc
              đã duyệt giữ nguyên — đó là nguyên tắc để phiếu lương đã phát không đổi số.
            </p>

            <div className="flex gap-3 pt-1">
              <Button variant="outline" onClick={() => setDraft(null)} className="flex-1" disabled={saving}>
                Hủy
              </Button>
              <Button onClick={save} className="flex-1" disabled={saving}>
                {saving ? 'Đang lưu…' : 'Lưu điều chỉnh'}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
