// ============================================================================
// Khai cách tính một khoản lương bằng vài ô chọn.
// ----------------------------------------------------------------------------
// Trước đây mỗi khoản chỉ có một ô công thức trống và một bảng biến để tra.
// Người làm nhân sự phải tự nghĩ ra `MUC_RIENG * PAID_DAYS` — mà gần như mọi
// khoản trong bảng lương thật đều chỉ là một trong ba hình dạng:
//
//     trả nguyên mức  ·  mức × số công  ·  mức ÷ công chuẩn × số công
//
// Nên hỏi thẳng ba câu đó. Công thức vẫn được sinh ra và vẫn hiện nguyên văn
// ở dưới, vì cuối cùng engine chạy trên chuỗi đó chứ không chạy trên ô chọn —
// giấu nó đi thì lúc sai không ai soát được.
//
// Công thức viết tay không khớp ba hình dạng trên thì màn này tự nhường chỗ
// cho ô tự do, không đoán bừa rồi ghi đè. Xem `lib/payItemFormula.ts`.
// ============================================================================

import { useMemo } from 'react';
import { Calculator, PenLine } from 'lucide-react';
import { Input, Select } from '@/components/ui/Input';
import { evaluateFormula } from '@/lib/payrollFormula';
import { formatVND } from '@/lib/utils';
import {
  buildPayFormula, describePayFormula, parsePayFormula,
  DAYS_LABEL, DEFAULT_GUIDED, SCALE_LABEL,
  type GuidedPayFormula, type PayItemDays, type PayItemScale,
} from '@/lib/payItemFormula';
import type { PayComponent } from '@/types';

interface Props {
  /** Công thức hiện tại, dạng chuỗi — thứ thật sự được lưu và chạy. */
  formula: string;
  onFormulaChange: (next: string) => void;
  /** Mức tiền khai riêng cho người này (biến `MUC_RIENG`). */
  amount: string;
  onAmountChange: (next: string) => void;
  /** Danh mục khoản, để chọn "lấy mức từ khoản khác". */
  components: PayComponent[];
  /** Khoản đang khai — tự loại khỏi danh sách để không tự tham chiếu chính nó. */
  selfCode?: string | null;
  sampleScope: Readonly<Record<string, number>>;
  /** Chuyển sang ô công thức tự do. */
  onWriteByHand: () => void;
}

export function PayItemFormulaPicker({
  formula, onFormulaChange, amount, onAmountChange,
  components, selfCode, sampleScope, onWriteByHand,
}: Props) {
  // Chỉ nhận mã của khoản ĐANG BẬT, và bỏ chính nó ra: một khoản tham chiếu
  // chính mình sẽ thành vòng lặp, engine bắt được nhưng báo lỗi khó hiểu.
  const usable = useMemo(
    () => components.filter((item) => item.is_active && item.code && item.code !== selfCode),
    [components, selfCode],
  );
  const codes = useMemo(() => usable.map((item) => item.code), [usable]);

  const guided = parsePayFormula(formula, codes) ?? DEFAULT_GUIDED;
  const set = (patch: Partial<GuidedPayFormula>) =>
    onFormulaChange(buildPayFormula({ ...guided, ...patch }));

  const generated = buildPayFormula(guided);
  const preview = useMemo(() => {
    try {
      const scope = { ...sampleScope, MUC_RIENG: Number(amount || 0) };
      return evaluateFormula(generated, scope).value;
    } catch {
      return null;
    }
  }, [generated, sampleScope, amount]);

  const sourceName = guided.source.kind === 'COMPONENT'
    ? usable.find((item) => item.code === (guided.source as { code: string }).code)?.name
    : undefined;

  /** Nhãn ô tiền đổi theo cách nhân, để không ai nhập lương tháng vào ô đơn giá ngày. */
  const amountLabel = guided.scale === 'PER_DAY'
    ? 'Đơn giá một ngày (VND)'
    : guided.scale === 'PRORATE'
      ? 'Lương một tháng (VND)'
      : 'Mức cố định (VND)';

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Cách tính khoản này</p>

      {/* --- Vế trái: mức tiền lấy từ đâu --- */}
      <div className="space-y-2">
        <div className="flex flex-wrap gap-2">
          {([
            ['FIXED', 'Số khai riêng'],
            ['COMPONENT', 'Lấy từ khoản khác'],
          ] as const).map(([kind, label]) => (
            <button
              key={kind}
              type="button"
              onClick={() => set({
                source: kind === 'FIXED'
                  ? { kind: 'FIXED' }
                  : { kind: 'COMPONENT', code: guided.source.kind === 'COMPONENT' ? guided.source.code : (codes[0] ?? '') },
              })}
              aria-pressed={guided.source.kind === kind}
              disabled={kind === 'COMPONENT' && codes.length === 0}
              className={`rounded-lg border px-3 py-1.5 text-xs font-bold transition disabled:opacity-40 ${
                guided.source.kind === kind
                  ? 'border-indigo-600 bg-indigo-50 text-indigo-700'
                  : 'border-slate-200 bg-white text-slate-600 hover:border-indigo-300'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {guided.source.kind === 'FIXED' ? (
          <Input
            label={amountLabel}
            inputMode="decimal"
            placeholder="VD: 200000"
            value={amount}
            onChange={(event) => onAmountChange(event.target.value.replace(/[^\d]/g, ''))}
          />
        ) : (
          <Select
            label="Lấy mức từ khoản"
            value={guided.source.code}
            onChange={(event) => set({ source: { kind: 'COMPONENT', code: event.target.value } })}
          >
            {usable.map((item) => (
              <option key={item.id} value={item.code}>{item.name} ({item.code})</option>
            ))}
          </Select>
        )}
      </div>

      {/* --- Vế phải: nhân số công kiểu gì --- */}
      <div className="space-y-2">
        {(['NONE', 'PER_DAY', 'PRORATE'] as PayItemScale[]).map((scale) => (
          <label key={scale} className="flex cursor-pointer items-start gap-2 rounded-lg px-1 py-0.5">
            <input
              type="radio"
              name={`scale-${selfCode ?? 'new'}`}
              checked={guided.scale === scale}
              onChange={() => set({ scale })}
              className="mt-0.5 h-4 w-4 accent-indigo-600"
            />
            <span className="text-xs leading-relaxed text-slate-700">{SCALE_LABEL[scale]}</span>
          </label>
        ))}

        {guided.scale !== 'NONE' && (
          <Select
            label="Đếm công theo"
            value={guided.days}
            onChange={(event) => set({ days: event.target.value as PayItemDays })}
          >
            {(Object.keys(DAYS_LABEL) as PayItemDays[]).map((key) => (
              <option key={key} value={key}>{DAYS_LABEL[key]}</option>
            ))}
          </Select>
        )}
      </div>

      {/* --- Công thức sinh ra, hiện nguyên văn ---
           Engine chạy trên chuỗi này chứ không chạy trên các ô chọn ở trên.
           Giấu đi thì lúc con số ra sai không ai soát được bằng mắt. */}
      <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
        <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-400">
          <Calculator className="h-3 w-3" /> Công thức
        </p>
        <code className="mt-1 block break-words font-mono text-xs text-indigo-700">{generated}</code>
        <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500">
          {describePayFormula(guided, sourceName)}
        </p>
        {preview != null && (
          <p className="mt-1 text-[11px] font-semibold text-slate-700">
            Thử với số liệu mẫu: {formatVND(preview)}
          </p>
        )}
      </div>

      <button
        type="button"
        onClick={onWriteByHand}
        className="inline-flex items-center gap-1.5 text-[11px] font-bold text-slate-500 transition hover:text-indigo-700"
      >
        <PenLine className="h-3 w-3" /> Cần tính phức tạp hơn — tự viết công thức
      </button>
    </div>
  );
}
