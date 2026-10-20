// ============================================================================
// Điều chỉnh lương của MỘT người ngay trên bảng lương.
// ----------------------------------------------------------------------------
// Chọn ĐẦU MỤC cần chỉnh (đúng các cột đang có trên phiếu của người này):
//   • Đầu mục ra tiền (cộng / trừ): chọn cộng thêm hay trừ bớt, nhập số tiền —
//     số mới của đầu mục hiện ngay bên dưới để thấy trước khi lưu.
//   • Dòng trung gian (số người phụ thuộc, lương cơ bản…): nhập GIÁ TRỊ MỚI.
//     Các công thức đọc đầu mục này (thuế, bảo hiểm…) sẽ tính theo số mới.
// Chọn đầu mục xong, form ghi ra CÔNG THỨC LƯƠNG của đầu mục đó cho người này (viết
// bằng tên, rồi thay số) để biết số hiện tại ra từ đâu trước khi chỉnh.
// Mỗi điều chỉnh bắt buộc có lý do, nên nói rõ bù cho tháng nào nếu là sửa sai.
// ============================================================================

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ArrowRight, Minus, Plus, Trash2 } from 'lucide-react';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Dropdown, type DropdownOption } from '@/components/ui/Dropdown';
import { Input, Textarea } from '@/components/ui/Input';
import { MoneyInput } from '@/components/payroll/MoneyInput';
import { useToast } from '@/contexts/ToastContext';
import { useConfirm } from '@/contexts/ConfirmContext';
import { formatVND } from '@/lib/utils';
import { formatFormulaNumber } from '@/lib/formulaTokens';
import { describeRowFormula } from '@/lib/formulaSheet';
import { withKindSign } from '@/lib/formulaEntries';
import { deletePayrollAdjustment, savePayrollAdjustment } from '@/lib/payrollData';
import type { ComputedLine, MechanismRow, PayrollAdjustment } from '@/lib/payroll';
import type { PayComponentKind, Profile } from '@/types';

interface CatalogItem {
  code: string;
  name: string;
  kind: PayComponentKind;
  is_active?: boolean;
}

interface PersonAdjustmentModalProps {
  person: Profile | null;
  /** Mở từ ô trong bảng lương: đầu mục chọn sẵn và số MỚI người dùng vừa gõ (số cũ lấy từ phiếu). */
  initialTarget?: string | null;
  initialNewValue?: number;
  /** Các dòng đang có trên phiếu của người này — chính là các cột của bảng. */
  lines: ComputedLine[];
  /** Dòng cơ chế đã áp cho người này — nguồn của công thức lương ghi trên form. */
  mechanismRows?: MechanismRow[];
  /** Mã → tên, để viết công thức bằng tên đầu mục. */
  nameOf?: (code: string) => string | undefined;
  /** Danh mục đầu mục, để gọi tên khoản và chọn được khoản chưa có trên phiếu. */
  components: CatalogItem[];
  /** Điều chỉnh của tháng đang xem (mọi người) — modal tự lọc theo người. */
  adjustments: PayrollAdjustment[];
  monthStart: string;
  monthLabel: string;
  actorId: string | null;
  readOnly?: boolean;
  onClose: () => void;
  onChanged: () => void;
}

type Op = 'UP' | 'DOWN';
const NO_TARGET = '__none';

const isMoneyKind = (kind: PayComponentKind) => kind === 'EARNING' || kind === 'DEDUCTION';

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="mb-1.5 text-sm font-semibold text-slate-700">{label}</p>
      {children}
      {hint && <div className="mt-1.5 text-xs leading-relaxed text-slate-500">{hint}</div>}
    </div>
  );
}

export function PersonAdjustmentModal({
  person, initialTarget, initialNewValue, lines, mechanismRows, nameOf, components, adjustments, monthStart, monthLabel, actorId, readOnly = false, onClose, onChanged,
}: PersonAdjustmentModalProps) {
  const { toast } = useToast();
  const confirm = useConfirm();

  const [target, setTarget] = useState('');
  const [op, setOp] = useState<Op>('UP');
  // NaN = ô trống: ô tiền tự điền sẵn "000" khi gõ chữ số đầu, không bắt xoá số 0.
  const [amount, setAmount] = useState(Number.NaN);
  const [newValue, setNewValue] = useState(Number.NaN);
  const [originMonth, setOriginMonth] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setTarget(''); setOp('UP'); setAmount(Number.NaN); setNewValue(Number.NaN); setOriginMonth(''); setReason('');
  };
  const close = () => { reset(); onClose(); };

  const lineByCode = useMemo(
    () => new Map(lines.filter((line) => !line.code.startsWith('ADJ_')).map((line) => [line.code.toUpperCase(), line])),
    [lines],
  );
  const catalogByCode = useMemo(
    () => new Map(components.map((item) => [item.code.toUpperCase(), item])),
    [components],
  );

  const options: DropdownOption[] = useMemo(() => {
    const onSlip = [...lineByCode.values()]
      .filter((line) => line.kind !== 'EMPLOYER_COST')
      .map((line) => ({
        value: line.code.toUpperCase(),
        label: isMoneyKind(line.kind) ? withKindSign(line.kind, line.name) : `${line.name} (trung gian)`,
        detail: formatFormulaNumber(line.amount),
      }));
    const offSlip = components
      .filter((item) => isMoneyKind(item.kind) && item.is_active !== false && !lineByCode.has(item.code.toUpperCase()))
      .map((item) => ({ value: item.code.toUpperCase(), label: withKindSign(item.kind, item.name), detail: 'chưa có trên phiếu' }));
    return [
      ...onSlip,
      ...offSlip,
      { value: NO_TARGET, label: 'Dòng điều chỉnh riêng (không gắn đầu mục nào)' },
    ];
  }, [components, lineByCode]);

  // Mở từ ô trong bảng: điền sẵn đầu mục, chiều tăng / giảm và chênh lệch giữa số cũ với số mới.
  useEffect(() => {
    if (!person || !initialTarget) return;
    const code = initialTarget.toUpperCase();
    setTarget(code);
    if (initialNewValue === undefined) return;
    const now = lineByCode.get(code)?.amount ?? 0;
    const diff = initialNewValue - now;
    setOp(diff >= 0 ? 'UP' : 'DOWN');
    setAmount(Math.round(Math.abs(diff) * 100) / 100);
    setNewValue(initialNewValue);
  }, [person, initialTarget, initialNewValue]); // eslint-disable-line react-hooks/exhaustive-deps

  const rowByCode = useMemo(
    () => new Map((mechanismRows ?? []).map((row) => [row.component.code.toUpperCase(), row])),
    [mechanismRows],
  );

  const own = person ? adjustments.filter((item) => item.user_id === person.id) : [];

  const chosen = !!target && target !== NO_TARGET;
  const targetLine = chosen ? lineByCode.get(target) : undefined;
  const targetKind: PayComponentKind | null = chosen ? (targetLine?.kind ?? catalogByCode.get(target)?.kind ?? null) : null;
  const targetName = chosen ? (targetLine?.name ?? catalogByCode.get(target)?.name ?? target) : null;
  /** Dòng trung gian: điều chỉnh là đặt GIÁ TRỊ MỚI, không phải một khoản tiền. */
  const valueMode = targetKind === 'INFO';
  const targetRow = chosen ? rowByCode.get(target) : undefined;

  /** Chiều tác động lên THỰC NHẬN (hoặc lên giá trị, với dòng trung gian). */
  const netKind: PayrollAdjustment['kind'] = targetKind && isMoneyKind(targetKind)
    ? ((op === 'UP') === (targetKind === 'EARNING') ? 'RECOVERY' : 'CLAWBACK')
    : (op === 'UP' ? 'RECOVERY' : 'CLAWBACK');

  const upLabel = targetName ? 'Cộng thêm vào khoản này' : 'Tăng thực nhận';
  const downLabel = targetName ? 'Trừ bớt khỏi khoản này' : 'Giảm thực nhận';

  const before = targetLine?.amount ?? 0;
  const after = before + (op === 'UP' ? amount : -amount);
  const currentValue = targetLine?.amount ?? 0;
  const valueDelta = newValue - currentValue;

  const save = async () => {
    if (!person) return;
    if (!target) return toast('Chọn đầu mục cần điều chỉnh, hoặc chọn dòng điều chỉnh riêng.', 'warning');

    let kind = netKind;
    let size = amount;
    if (valueMode) {
      if (!Number.isFinite(newValue) || newValue < 0) return toast('Nhập giá trị mới (không âm).', 'warning');
      if (Math.abs(valueDelta) < 1e-9) return toast('Giá trị mới đang trùng giá trị hiện tại.', 'warning');
      kind = valueDelta > 0 ? 'RECOVERY' : 'CLAWBACK';
      size = Math.round(Math.abs(valueDelta) * 100) / 100;
    } else if (!Number.isFinite(amount) || amount <= 0) {
      return toast('Nhập số tiền lớn hơn 0.', 'warning');
    }
    if (!reason.trim()) return toast('Ghi lý do điều chỉnh — bắt buộc, để rà soát về sau.', 'warning');

    setSaving(true);
    const error = await savePayrollAdjustment({
      user_id: person.id,
      month_start: monthStart,
      origin_month: originMonth ? `${originMonth}-01` : null,
      component_code: chosen ? target : null,
      kind,
      amount: size,
      reason: reason.trim(),
      taxable: true,
      created_by: actorId,
    });
    setSaving(false);
    if (error) return toast('Lưu điều chỉnh thất bại: ' + error, 'error');
    toast('Đã lưu điều chỉnh lương.', 'success');
    reset();
    onChanged();
    if (initialTarget) onClose();
  };

  const remove = async (item: PayrollAdjustment) => {
    const ok = await confirm({
      title: 'Xoá điều chỉnh này?',
      message: `Điều chỉnh này của ${person?.name ?? 'nhân sự'} sẽ không còn trên phiếu lương tháng ${monthLabel}.`,
      confirmLabel: 'Xoá',
      danger: true,
    });
    if (!ok) return;
    const error = await deletePayrollAdjustment(item.id);
    if (error) return toast('Xoá thất bại: ' + error, 'error');
    toast('Đã xoá điều chỉnh.', 'success');
    onChanged();
  };

  /** Điều chỉnh đã lưu tác động lên đầu mục của nó thế nào: + hay −. */
  const effectOf = (item: PayrollAdjustment) => {
    const code = item.component_code?.toUpperCase();
    const kind = code ? (lineByCode.get(code)?.kind ?? catalogByCode.get(code)?.kind) : undefined;
    const up = kind && isMoneyKind(kind)
      ? (item.kind === 'RECOVERY') === (kind === 'EARNING')
      : item.kind === 'RECOVERY';
    return { up, name: code ? (lineByCode.get(code)?.name ?? catalogByCode.get(code)?.name ?? code) : null };
  };

  return (
    <Modal square open={!!person} onClose={close} title={`Điều chỉnh lương ${monthLabel}`} size="md">
      {person && (
        <div className="space-y-5">
          <div className="flex items-center gap-3 rounded-none bg-slate-50 px-3.5 py-3">
            <Avatar name={person.name} url={person.avatar_url} size="sm" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold text-slate-800">{person.name}</p>
              <p className="truncate text-xs text-slate-500">
                {[person.employee_code, person.department].filter(Boolean).join(' · ') || '—'}
              </p>
            </div>
          </div>

          {readOnly && (
            <p className="rounded-none border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-800">
              Kỳ lương đã khoá / phát hành — chỉ xem các khoản điều chỉnh, không thể tạo mới hay xoá.
            </p>
          )}

          {own.length > 0 && (
            <section>
              <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-slate-400">Đã điều chỉnh trong tháng</p>
              <ul className="divide-y divide-slate-100 rounded-none border border-slate-200">
                {own.map((item) => {
                  const effect = effectOf(item);
                  return (
                    <li key={item.id} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 px-3.5 py-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-800">{effect.name ?? 'Dòng điều chỉnh riêng'}</p>
                        <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{item.reason}</p>
                        {item.origin_month && (
                          <p className="text-[11px] text-slate-400">Bù cho kỳ {item.origin_month.slice(5, 7)}/{item.origin_month.slice(0, 4)}</p>
                        )}
                      </div>
                      <span className={`text-sm font-bold tabular-nums ${effect.up ? 'text-emerald-700' : 'text-red-700'}`}>
                        {effect.up ? '+' : '−'}{formatFormulaNumber(Number(item.amount))}
                      </span>
                      {!readOnly && (
                        <button
                          type="button"
                          onClick={() => void remove(item)}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600"
                          aria-label="Xoá điều chỉnh"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {readOnly ? (
            <div className="space-y-4">
              {own.length === 0 && (
                <p className="rounded-none border border-dashed border-slate-200 py-6 text-center text-xs text-slate-500">
                  Không có khoản điều chỉnh nào trong tháng {monthLabel} cho nhân sự này.
                </p>
              )}
              <div className="flex justify-end pt-2">
                <Button type="button" onClick={close}>Đóng</Button>
              </div>
            </div>
          ) : (
            <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void save(); }}>
              <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400">Thêm điều chỉnh</p>

            <Field label="Đầu mục cần điều chỉnh">
              <Dropdown square
                value={target}
                options={options}
                searchable
                placeholder="Chọn đầu mục…"
                aria-label="Đầu mục cần điều chỉnh"
                onChange={(value) => { setTarget(value); setAmount(Number.NaN); setNewValue(Number.NaN); }}
              />
            </Field>

            {chosen && targetName && (
              <div className="rounded-none border border-slate-200 bg-slate-50 px-3.5 py-3 text-sm" aria-label="Công thức lương">
                <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400">Công thức lương</p>
                {targetRow ? (
                  <>
                    <p className="mt-1.5 break-words font-semibold text-slate-800">
                      {targetName} = <span className="font-medium text-slate-700">{describeRowFormula(targetRow, nameOf ?? (() => undefined))}</span>
                    </p>
                    {targetLine && (
                      <p className="mt-1 break-words text-xs tabular-nums text-slate-500">
                        {targetLine.detail ? `${targetLine.detail} = ` : '= '}
                        <span className="font-bold text-slate-800">{formatFormulaNumber(targetLine.amount)}</span>
                      </p>
                    )}
                  </>
                ) : (
                  <p className="mt-1.5 text-xs text-slate-500">
                    {targetLine
                      ? `Số hiện tại: ${formatFormulaNumber(targetLine.amount)}.`
                      : 'Đầu mục này chưa có trong cơ chế của người này nên phiếu lương chưa tính nó.'}
                  </p>
                )}
              </div>
            )}

            {valueMode ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Giá trị hiện tại">
                  <div className="flex h-11 items-center justify-end rounded-none border border-slate-200 bg-slate-50 px-3.5 font-mono text-sm tabular-nums text-slate-700">
                    {formatFormulaNumber(currentValue)}
                  </div>
                </Field>
                <Field label="Giá trị mới">
                  <MoneyInput large value={newValue} onChange={setNewValue} placeholder="Nhập số" aria-label="Giá trị mới" />
                </Field>
              </div>
            ) : (
              <>
                <Field label="Điều chỉnh">
                  <div className="grid grid-cols-2 gap-2">
                    {([['UP', upLabel, Plus], ['DOWN', downLabel, Minus]] as const).map(([value, label, Icon]) => {
                      const active = op === value;
                      const tone = value === 'UP'
                        ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                        : 'border-red-500 bg-red-50 text-red-700';
                      return (
                        <button
                          key={value}
                          type="button"
                          onClick={() => setOp(value)}
                          aria-pressed={active}
                          className={`flex h-11 items-center justify-center gap-2 rounded-none border px-3 text-sm font-semibold transition ${
                            active ? tone : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                          }`}
                        >
                          <Icon className="h-4 w-4 shrink-0" /> <span className="truncate">{label}</span>
                        </button>
                      );
                    })}
                  </div>
                </Field>

                <Field label="Số tiền (VND)">
                  <MoneyInput money large value={amount} onChange={setAmount} placeholder="Nhập số tiền" aria-label="Số tiền điều chỉnh" />
                </Field>
              </>
            )}

            {targetName && !valueMode && amount > 0 && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-none border border-slate-200 px-3.5 py-3 text-sm">
                <span className="font-semibold text-slate-700">{targetName}</span>
                <span className="flex items-center gap-2 tabular-nums">
                  <span className="text-slate-500">{formatFormulaNumber(before)}</span>
                  <ArrowRight className="h-3.5 w-3.5 text-slate-400" />
                  <span className="font-bold text-slate-900">{formatFormulaNumber(after)}</span>
                </span>
                <span className={`ml-auto text-xs font-semibold ${netKind === 'RECOVERY' ? 'text-emerald-700' : 'text-red-700'}`}>
                  Thực nhận {netKind === 'RECOVERY' ? 'tăng' : 'giảm'} {formatVND(amount)}
                </span>
              </div>
            )}

            {valueMode && targetName && Number.isFinite(newValue) && Math.abs(valueDelta) > 1e-9 && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-none border border-slate-200 px-3.5 py-3 text-sm">
                <span className="font-semibold text-slate-700">{targetName}</span>
                <span className="flex items-center gap-2 tabular-nums">
                  <span className="text-slate-500">{formatFormulaNumber(currentValue)}</span>
                  <ArrowRight className="h-3.5 w-3.5 text-slate-400" />
                  <span className="font-bold text-slate-900">{formatFormulaNumber(newValue)}</span>
                </span>
                <span className="ml-auto text-xs text-slate-500">Các khoản đọc giá trị này sẽ tính lại theo số mới.</span>
              </div>
            )}

            <Field
              label="Bù cho tháng (không bắt buộc)"
              hint="Chỉ chọn khi đây là sửa sai sót của một tháng trước — ví dụ tháng 7 tính thiếu thì chọn 07/2026, phiếu sẽ ghi “bù cho kỳ 07/2026”. Bỏ trống nếu là điều chỉnh của riêng tháng này."
            >
              <Input className="!rounded-none"
                type="month"
                value={originMonth}
                max={monthStart.slice(0, 7)}
                onChange={(event) => setOriginMonth(event.target.value)}
              />
            </Field>

            <Field label="Lý do điều chỉnh">
              <Textarea className="!rounded-none"
                rows={2}
                required
                placeholder="VD: Tháng 7 tính thiếu 8 giờ tăng ca ngày lễ"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </Field>

            <div className="grid grid-cols-2 gap-3 pt-1">
              <Button type="button" variant="outline" onClick={close} disabled={saving}>Đóng</Button>
              <Button type="submit" disabled={saving}>{saving ? 'Đang lưu…' : 'Lưu điều chỉnh'}</Button>
            </div>
          </form>
          )}
        </div>
      )}
    </Modal>
  );
}
