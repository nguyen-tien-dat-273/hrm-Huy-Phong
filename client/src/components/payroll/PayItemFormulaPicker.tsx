// ============================================================================
// Khai cách tính một khoản lương bằng vài ô chọn.
// ----------------------------------------------------------------------------
// Hỏi đúng hai câu mà nghiệp vụ thật chỉ có hai câu:
//
//   1. Khoản này CỐ ĐỊNH hay KHÔNG CỐ ĐỊNH?
//   2. Nếu không cố định: đơn giá là gì, nhân với số liệu nào?
//
// Số liệu tháng không phải khai thêm ở đâu: màn "Số liệu lương tháng" quét
// công thức của mọi khoản đã gán, thấy một biến lạ là tự dựng cột nhập liệu.
// Chọn `SO_CHUYEN` ở đây thì tháng sau quản lý đã có ô để điền — nên màn này
// nói rõ điều đó thay vì để người khai tự hỏi "rồi ai nhập con số kia".
//
// Công thức sinh ra vẫn hiện NGUYÊN VĂN ở dưới, vì cuối cùng engine chạy trên
// chuỗi đó chứ không chạy trên ô chọn — giấu đi thì lúc sai không ai soát được.
//
// Công thức viết tay không khớp hai hình dạng trên thì màn này tự nhường chỗ
// cho ô tự do, không đoán bừa rồi ghi đè. Xem `lib/payItemFormula.ts`.
// ============================================================================

import { useMemo } from 'react';
import { Calculator, PenLine, TriangleAlert } from 'lucide-react';
import { Input, Select } from '@/components/ui/Input';
import { evaluateFormula } from '@/lib/payrollFormula';
import { formatVND } from '@/lib/utils';
import {
  buildPayFormula, describePayFormula, parsePayFormula,
  DEFAULT_GUIDED, SYSTEM_VARIABLES,
  type GuidedPayFormula,
} from '@/lib/payItemFormula';
import type { PayComponent } from '@/types';

interface Props {
  /** Công thức hiện tại, dạng chuỗi — thứ thật sự được lưu và chạy. */
  formula: string;
  onFormulaChange: (next: string) => void;
  /** Đơn giá khai riêng cho người này (biến `MUC_RIENG`). */
  amount: string;
  onAmountChange: (next: string) => void;
  components: PayComponent[];
  /** Khoản đang khai — tự loại khỏi danh sách để không tự tham chiếu chính nó. */
  selfCode?: string | null;
  sampleScope: Readonly<Record<string, number>>;
  onWriteByHand: () => void;
}

export function PayItemFormulaPicker({
  formula, onFormulaChange, amount, onAmountChange,
  components, selfCode, sampleScope, onWriteByHand,
}: Props) {
  // Chỉ nhận khoản ĐANG BẬT, và bỏ chính nó ra: một khoản tham chiếu chính
  // mình sẽ thành vòng lặp, engine bắt được nhưng báo lỗi khó hiểu.
  const usable = useMemo(
    () => components.filter((item) => item.is_active && item.code && item.code !== selfCode),
    [components, selfCode],
  );
  const codes = useMemo(() => usable.map((item) => item.code), [usable]);

  /**
   * Mã số liệu tháng mà công ty đã dùng ở đâu đó trong danh mục.
   *
   * Gợi ý từ dữ liệu thật thay vì bắt người khai tự nghĩ ra mã — và gõ trùng
   * mã đã có nghĩa là dùng chung một cột nhập liệu, không đẻ thêm cột mới.
   */
  const inputCodes = useMemo(() => {
    const seen = new Map<string, string>();
    for (const item of components) {
      if (item.is_active && item.input_code && !seen.has(item.input_code)) {
        seen.set(item.input_code, item.name);
      }
    }
    return [...seen].map(([code, name]) => ({ code, label: `${code} — ${name}` }));
  }, [components]);

  const guided = parsePayFormula(formula, codes) ?? DEFAULT_GUIDED;
  const set = (patch: Partial<GuidedPayFormula>) =>
    onFormulaChange(buildPayFormula({ ...guided, ...patch }));

  const generated = buildPayFormula(guided);
  const preview = useMemo(() => {
    try {
      return evaluateFormula(generated, { ...sampleScope, MUC_RIENG: Number(amount || 0) }).value;
    } catch {
      return null;
    }
  }, [generated, sampleScope, amount]);

  const sourceName = guided.source.kind === 'COMPONENT'
    ? usable.find((item) => item.code === (guided.source as { code: string }).code)?.name
    : undefined;
  const variableName = guided.variable
    ? SYSTEM_VARIABLES.find((item) => item.code === guided.variable)?.label ?? guided.variable
    : undefined;

  const isFixed = !guided.variable;
  /** Số liệu do công ty tự đặt, không phải biến hệ thống → cần người nhập hằng tháng. */
  const needsMonthlyEntry = !!guided.variable
    && !SYSTEM_VARIABLES.some((item) => item.code === guided.variable);

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
      {/* --- Câu 1: cố định hay không --- */}
      <div className="flex flex-wrap gap-2">
        {([
          [true, 'Cố định', 'Tháng nào cũng bằng đó tiền'],
          [false, 'Không cố định', 'Đơn giá × số liệu theo tháng'],
        ] as const).map(([fixed, label, hint]) => (
          <button
            key={label}
            type="button"
            onClick={() => set({
              // Bật "không cố định" thì phải có sẵn một số nhân, nếu không
              // công thức sinh ra vẫn là khoản cố định và nút trông như hỏng.
              variable: fixed ? null : (guided.variable ?? 'PAID_DAYS'),
              prorate: fixed ? false : guided.prorate,
            })}
            aria-pressed={isFixed === fixed}
            className={`flex-1 rounded-lg border-2 px-3 py-2 text-left transition ${
              isFixed === fixed
                ? 'border-indigo-600 bg-indigo-50'
                : 'border-slate-200 bg-white hover:border-indigo-300'
            }`}
          >
            <span className="block text-xs font-bold text-slate-800">{label}</span>
            <span className="mt-0.5 block text-[10px] leading-snug text-slate-500">{hint}</span>
          </button>
        ))}
      </div>

      {/* --- Câu 2a: đơn giá lấy từ đâu --- */}
      <div className="space-y-2">
        <div className="flex flex-wrap gap-2">
          {([
            ['FIXED', isFixed ? 'Nhập số tiền' : 'Nhập đơn giá'],
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
            label={isFixed ? 'Số tiền mỗi tháng (VND)' : 'Đơn giá một đơn vị (VND)'}
            inputMode="decimal"
            placeholder="VD: 200000"
            value={amount}
            onChange={(event) => onAmountChange(event.target.value.replace(/[^\d]/g, ''))}
          />
        ) : (
          <Select
            label={isFixed ? 'Lấy số tiền từ khoản' : 'Lấy đơn giá từ khoản'}
            value={guided.source.code}
            onChange={(event) => set({ source: { kind: 'COMPONENT', code: event.target.value } })}
          >
            {usable.map((item) => (
              <option key={item.id} value={item.code}>{item.name} ({item.code})</option>
            ))}
          </Select>
        )}
      </div>

      {/* --- Câu 2b: nhân với số liệu nào --- */}
      {!isFixed && (
        <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-2.5">
          <Select
            label="Nhân với số liệu"
            value={guided.variable ?? ''}
            onChange={(event) => set({ variable: event.target.value })}
          >
            <optgroup label="Lấy tự động từ chấm công">
              {SYSTEM_VARIABLES.map((item) => (
                <option key={item.code} value={item.code}>{item.label}</option>
              ))}
            </optgroup>
            {inputCodes.length > 0 && (
              <optgroup label="Số liệu quản lý nhập hằng tháng">
                {inputCodes.map((item) => (
                  <option key={item.code} value={item.code}>{item.label}</option>
                ))}
              </optgroup>
            )}
          </Select>

          <label className="flex cursor-pointer items-start gap-2">
            <input
              type="checkbox"
              checked={guided.prorate}
              onChange={(event) => set({ prorate: event.target.checked })}
              className="mt-0.5 h-4 w-4 accent-indigo-600"
            />
            <span className="text-[11px] leading-relaxed text-slate-700">
              Đơn giá đang khai theo <strong>tháng</strong> — chia cho ngày công chuẩn trước khi
              nhân. Dùng cho lương tháng trả theo ngày thực đi.
            </span>
          </label>

          {needsMonthlyEntry && (
            /* Nói trước ai sẽ nhập con số kia, để không ai khai xong rồi chờ
               một ô nhập liệu mà họ tưởng phải tự tạo. */
            <p className="flex items-start gap-1.5 rounded bg-amber-50 px-2 py-1.5 text-[11px] leading-relaxed text-amber-800">
              <TriangleAlert className="mt-0.5 h-3 w-3 flex-shrink-0" />
              <span>
                <code className="font-mono font-bold">{guided.variable}</code> là số liệu thay đổi
                theo tháng. Cột nhập cho nó tự hiện ở màn <strong>Số liệu lương tháng</strong>;
                tháng nào chưa điền thì khoản này tính ra 0đ.
              </span>
            </p>
          )}
        </div>
      )}

      {/* --- Công thức sinh ra, hiện nguyên văn --- */}
      <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
        <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-400">
          <Calculator className="h-3 w-3" /> Công thức
        </p>
        <code className="mt-1 block break-words font-mono text-xs text-indigo-700">{generated}</code>
        <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500">
          {describePayFormula(guided, { source: sourceName, variable: variableName })}
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
