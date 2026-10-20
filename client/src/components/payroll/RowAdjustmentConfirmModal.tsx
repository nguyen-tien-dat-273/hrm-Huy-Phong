// ============================================================================
// Hộp thoại xác nhận điều chỉnh nhiều đầu mục lương của một nhân sự.
// ----------------------------------------------------------------------------
// Khi Admin chỉnh sửa các ô trực tiếp trên hàng của bảng lương và bấm Lưu:
// • Hiển thị danh sách tất cả các đầu mục có thay đổi (số cũ → số mới, chênh lệch).
// • Bắt buộc nhập lý do điều chỉnh để lưu vết kiểm toán (audit log).
// • Cho phép chọn tháng phát sinh (nếu bù / truy thu cho kỳ trước).
// • Lưu toàn bộ các điều chỉnh chỉ với 1 lần bấm xác nhận.
// ============================================================================

import { useMemo, useState } from 'react';
import { ArrowRight, Check, History, Trash2 } from 'lucide-react';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Textarea } from '@/components/ui/Input';
import { useToast } from '@/contexts/ToastContext';
import { useConfirm } from '@/contexts/ConfirmContext';
import { formatFormulaNumber } from '@/lib/formulaTokens';
import { deletePayrollAdjustment, savePayrollAdjustment } from '@/lib/payrollData';
import type { PayrollAdjustment } from '@/lib/payroll';
import type { PayComponentKind, Profile } from '@/types';

export interface RowChangedItem {
  code: string;
  name: string;
  kind: PayComponentKind;
  oldValue: number;
  newValue: number;
  delta: number;
}

export interface RowAdjustmentConfirmModalProps {
  open: boolean;
  row: { profile: Profile; mechanism?: string | null } | null;
  items: RowChangedItem[];
  monthStartStr: string;
  monthLabel: string;
  actorId: string | null;
  existingAdjustments?: PayrollAdjustment[];
  onClose: () => void;
  onSuccess: () => void;
  onChanged?: () => void;
}

export function RowAdjustmentConfirmModal({
  open,
  row,
  items,
  monthStartStr,
  monthLabel,
  actorId,
  existingAdjustments = [],
  onClose,
  onSuccess,
  onChanged,
}: RowAdjustmentConfirmModalProps) {
  const { toast } = useToast();
  const confirm = useConfirm();

  const [reason, setReason] = useState('');
  const [originMonth, setOriginMonth] = useState('');
  const [saving, setSaving] = useState(false);
  const [showExisting, setShowExisting] = useState(false);

  const netImpact = useMemo(() => {
    return items.reduce((sum, item) => {
      if (item.kind === 'EARNING') return sum + item.delta;
      if (item.kind === 'DEDUCTION') return sum - item.delta;
      return sum;
    }, 0);
  }, [items]);

  if (!row) return null;

  const handleConfirmSave = async () => {
    const trimmedReason = reason.trim();
    if (!trimmedReason || trimmedReason.length < 3) {
      toast('Vui lòng nhập lý do điều chỉnh (tối thiểu 3 ký tự) để phục vụ rà soát về sau.', 'warning');
      return;
    }

    setSaving(true);
    try {
      const errorList: string[] = [];
      for (const item of items) {
        let kind: 'RECOVERY' | 'CLAWBACK';
        if (item.kind === 'EARNING') {
          kind = item.delta > 0 ? 'RECOVERY' : 'CLAWBACK';
        } else if (item.kind === 'DEDUCTION') {
          kind = item.delta > 0 ? 'CLAWBACK' : 'RECOVERY';
        } else {
          kind = item.delta > 0 ? 'RECOVERY' : 'CLAWBACK';
        }

        const err = await savePayrollAdjustment({
          user_id: row.profile.id,
          month_start: monthStartStr,
          origin_month: originMonth ? `${originMonth}-01` : null,
          component_code: item.code,
          kind,
          amount: Math.round(Math.abs(item.delta) * 100) / 100,
          reason: trimmedReason,
          taxable: true,
          created_by: actorId,
        });

        if (err) {
          errorList.push(`${item.name}: ${err}`);
        }
      }

      if (errorList.length > 0) {
        toast(`Có lỗi khi lưu một số đầu mục: ${errorList.join('; ')}`, 'error');
      } else {
        toast(`Đã lưu điều chỉnh ${items.length} đầu mục cho ${row.profile.name}.`, 'success');
        setReason('');
        setOriginMonth('');
        onSuccess();
      }
    } catch (ex) {
      toast(`Lỗi không mong muốn: ${ex instanceof Error ? ex.message : String(ex)}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveExisting = async (item: PayrollAdjustment) => {
    const ok = await confirm({
      title: 'Xóa điều chỉnh này?',
      message: `Khoản điều chỉnh này của ${row.profile.name} sẽ không còn trên phiếu lương tháng ${monthLabel}.`,
      confirmLabel: 'Xóa',
      danger: true,
    });
    if (!ok) return;
    const error = await deletePayrollAdjustment(item.id);
    if (error) return toast('Xóa thất bại: ' + error, 'error');
    toast('Đã xóa điều chỉnh.', 'success');
    onChanged?.();
  };

  return (
    <Modal
      open={open}
      onClose={() => {
        if (!saving) onClose();
      }}
      title="Xác nhận điều chỉnh lương"
      size="lg"
    >
      <div className="space-y-5 text-sm">
        {/* Thông tin nhân sự */}
        <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 p-3.5">
          <div className="flex items-center gap-3 min-w-0">
            <Avatar name={row.profile.name} url={row.profile.avatar_url} size="md" />
            <div className="min-w-0">
              <p className="truncate font-bold text-slate-900 dark:text-slate-100 text-base">{row.profile.name}</p>
              <p className="truncate text-xs font-medium text-slate-500 dark:text-slate-400">
                {row.profile.employee_code ? `${row.profile.employee_code} · ` : ''}
                {row.mechanism ?? row.profile.department ?? 'Chưa gắn phòng ban'}
              </p>
            </div>
          </div>
          <div className="text-right shrink-0">
            <span className="inline-flex items-center rounded-md bg-indigo-50 dark:bg-indigo-950/60 px-2.5 py-1 text-xs font-bold text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
              Kỳ lương {monthLabel}
            </span>
          </div>
        </div>

        {/* Danh sách các đầu mục thay đổi */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="font-bold text-slate-900 dark:text-slate-100">
              Các đầu mục được điều chỉnh ({items.length})
            </p>
            {netImpact !== 0 && (
              <span className="text-xs font-bold text-slate-600 dark:text-slate-400">
                Tác động ước tính Thực nhận:{' '}
                <span className={netImpact > 0 ? 'text-emerald-600 dark:text-emerald-400 font-black' : 'text-rose-600 dark:text-rose-400 font-black'}>
                  {netImpact > 0 ? '+' : ''}{formatFormulaNumber(netImpact)} đ
                </span>
              </span>
            )}
          </div>

          <div className="max-h-64 overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800/80 bg-white dark:bg-slate-900 shadow-xs">
            {items.map((item) => {
              const isEarning = item.kind === 'EARNING';
              const isDeduction = item.kind === 'DEDUCTION';

              // Màu cho chênh lệch
              const isPositiveImpact = isEarning ? item.delta > 0 : isDeduction ? item.delta < 0 : item.delta > 0;

              return (
                <div key={item.code} className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-slate-900 dark:text-slate-100 text-sm truncate" title={item.name}>
                        {item.name}
                      </span>
                      <span
                        className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                          isEarning
                            ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                            : isDeduction
                            ? 'bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300'
                            : 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300'
                        }`}
                      >
                        {isEarning ? 'Thu nhập' : isDeduction ? 'Khoản trừ' : 'Trung gian'}
                      </span>
                    </div>
                    <span className="text-xs text-slate-400 font-mono">{item.code}</span>
                  </div>

                  <div className="flex items-center gap-3 tabular-nums text-sm shrink-0">
                    <span className="text-slate-500 line-through dark:text-slate-400">
                      {formatFormulaNumber(item.oldValue)}
                    </span>
                    <ArrowRight className="h-3.5 w-3.5 text-slate-400" />
                    <span className="font-bold text-slate-900 dark:text-slate-100">
                      {formatFormulaNumber(item.newValue)}
                    </span>
                    <span
                      className={`min-w-[70px] text-right font-black text-xs px-2 py-0.5 rounded ${
                        isPositiveImpact
                          ? 'bg-emerald-100/80 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300'
                          : 'bg-rose-100/80 text-rose-800 dark:bg-rose-950/80 dark:text-rose-300'
                      }`}
                    >
                      {item.delta > 0 ? '+' : ''}{formatFormulaNumber(item.delta)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Lý do điều chỉnh (bắt buộc) */}
        <div>
          <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5">
            Lý do điều chỉnh <span className="text-rose-500">*</span>
          </label>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            placeholder="Nhập lý do điều chỉnh cho các đầu mục trên (tối thiểu 3 ký tự, ví dụ: Quyết định tăng lương bổ sung, điều chỉnh thưởng KPI tháng 10...)"
            className="w-full text-sm"
          />
        </div>

        {/* Tháng phát sinh (tùy chọn) */}
        <div>
          <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5">
            Tháng phát sinh sai sót (nếu bù / truy thu cho kỳ trước)
          </label>
          <input
            type="month"
            value={originMonth}
            onChange={(e) => setOriginMonth(e.target.value)}
            max={monthStartStr.slice(0, 7)}
            className="h-9 w-full sm:w-60 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 text-sm font-medium text-slate-900 dark:text-slate-100 focus:border-indigo-500 focus:outline-none"
          />
          <p className="mt-1 text-xs text-slate-400">
            Để trống nếu là khoản điều chỉnh trực tiếp của kỳ lương tháng {monthLabel}.
          </p>
        </div>

        {/* Lịch sử điều chỉnh đã có trong tháng */}
        {existingAdjustments.length > 0 && (
          <div className="pt-2 border-t border-slate-200 dark:border-slate-800">
            <button
              type="button"
              onClick={() => setShowExisting((val) => !val)}
              className="flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 transition"
            >
              <History className="h-3.5 w-3.5" />
              {showExisting ? 'Ẩn' : 'Xem'} {existingAdjustments.length} điều chỉnh đã lưu trong tháng của nhân sự này
            </button>

            {showExisting && (
              <div className="mt-2.5 space-y-1.5 max-h-36 overflow-y-auto">
                {existingAdjustments.map((adj) => (
                  <div
                    key={adj.id}
                    className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/40 px-3 py-1.5 text-xs"
                  >
                    <div className="min-w-0 flex-1">
                      <span className="font-bold text-slate-800 dark:text-slate-200">
                        {adj.component_code ?? 'Điều chỉnh riêng'}
                      </span>
                      <span className="mx-1 text-slate-400">·</span>
                      <span className="text-slate-600 dark:text-slate-400">{adj.reason}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className={`font-bold tabular-nums ${adj.kind === 'RECOVERY' ? 'text-emerald-600' : 'text-rose-600'}`}>
                        {adj.kind === 'RECOVERY' ? '+' : '−'}{formatFormulaNumber(Number(adj.amount))}
                      </span>
                      <button
                        type="button"
                        onClick={() => void handleRemoveExisting(adj)}
                        className="p-1 text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 rounded hover:bg-rose-50 dark:hover:bg-rose-950/40"
                        title="Xóa điều chỉnh này"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Footer nút bấm */}
        <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-200 dark:border-slate-800">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={saving}
          >
            Quay lại sửa tiếp
          </Button>
          <Button
            type="button"
            variant="primary"
            onClick={() => void handleConfirmSave()}
            disabled={saving || !reason.trim()}
            className="gap-1.5"
          >
            <Check className="h-4 w-4" />
            {saving ? 'Đang lưu điều chỉnh...' : `Xác nhận & Lưu ${items.length} đầu mục`}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
