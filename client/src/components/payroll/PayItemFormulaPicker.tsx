// ============================================================================
// Khai cách tính một khoản lương, đọc như một dòng phương trình.
// ----------------------------------------------------------------------------
//     Lương công  =  [ Lương cơ bản ]  ×  [ Ngày hưởng lương ]
//
// Ô trái gộp hai nguồn làm một: nhập thẳng một số, hoặc lấy từ một khoản khác
// trong danh mục. Ô phải là số nhân — và "Không nhân" chính là khoản cố định,
// không cần một nút chọn loại riêng.
//
// CÁ NHÂN HOÁ: danh sách bên trái tách hai nhóm theo NGƯỜI ĐANG KHAI. Khoản
// lương gán theo từng người, nên `LUONG_CB` trong công thức chỉ có số khi
// chính người đó cũng được gán khoản đó. Chọn một khoản chưa khai cho họ thì
// engine tính phần ấy bằng 0đ — đúng về số nhưng rất dễ nhầm, nên nói trước
// thay vì để phát hiện lúc đã trả lương thiếu.
//
// Số liệu tháng không phải khai thêm ở đâu: màn "Số liệu lương tháng" quét
// công thức của mọi khoản đã gán, thấy một biến lạ là tự dựng cột nhập liệu và
// đặt tên cột theo tên khoản dùng biến đó.
//
// Công thức sinh ra vẫn hiện nguyên văn, vì engine chạy trên chuỗi đó chứ
// không chạy trên các ô chọn — giấu đi thì lúc sai không ai soát được.
// ============================================================================

import { useMemo } from 'react';
import { PenLine, TriangleAlert } from 'lucide-react';
import { evaluateFormula } from '@/lib/payrollFormula';
import { formatVND } from '@/lib/utils';
import {
  buildPayFormula, parsePayFormula,
  DEFAULT_GUIDED, isDayCount, SYSTEM_VARIABLES,
  type GuidedPayFormula,
} from '@/lib/payItemFormula';
import type { PayComponent } from '@/types';

/** Giá trị riêng của ô chọn nguồn, không trùng mã khoản nào. */
const NHAP_TAY = '__SO__';

interface Props {
  /** Tên khoản đang khai — vế trái của phương trình. */
  componentName: string;
  /** Công thức hiện tại, dạng chuỗi — thứ thật sự được lưu và chạy. */
  formula: string;
  onFormulaChange: (next: string) => void;
  /** Số tiền khai riêng cho người này (biến `MUC_RIENG`). */
  amount: string;
  onAmountChange: (next: string) => void;
  components: PayComponent[];
  /** Khoản đang khai — tự loại ra để không tham chiếu chính nó. */
  selfCode?: string | null;
  /** Mã các khoản ĐÃ khai cho chính người này, để tách nhóm gợi ý. */
  assignedCodes: readonly string[];
  sampleScope: Readonly<Record<string, number>>;
  onWriteByHand: () => void;
}

export function PayItemFormulaPicker({
  componentName, formula, onFormulaChange, amount, onAmountChange,
  components, selfCode, assignedCodes, sampleScope, onWriteByHand,
}: Props) {
  const usable = useMemo(
    () => components.filter((item) => item.is_active && item.code && item.code !== selfCode),
    [components, selfCode],
  );
  const codes = useMemo(() => usable.map((item) => item.code), [usable]);

  const assigned = useMemo(() => new Set(assignedCodes), [assignedCodes]);
  const daKhai = usable.filter((item) => assigned.has(item.code));
  const chuaKhai = usable.filter((item) => !assigned.has(item.code));

  /** Mã số liệu tháng mà công ty đã dùng ở đâu đó trong danh mục. */
  const inputCodes = useMemo(() => {
    const seen = new Map<string, string>();
    for (const item of components) {
      if (item.is_active && item.input_code && !seen.has(item.input_code)) {
        seen.set(item.input_code, item.name);
      }
    }
    return [...seen].map(([code, name]) => ({ code, label: name }));
  }, [components]);

  const guided = parsePayFormula(formula, codes) ?? DEFAULT_GUIDED;
  const set = (patch: Partial<GuidedPayFormula>) =>
    onFormulaChange(buildPayFormula({ ...guided, ...patch }));

  const generated = buildPayFormula(guided);
  const scope = useMemo(
    () => ({ ...sampleScope, MUC_RIENG: Number(amount || 0) }),
    [sampleScope, amount],
  );
  const valueOf = (prorate: boolean) => {
    try {
      return evaluateFormula(buildPayFormula({ ...guided, prorate }), scope).value;
    } catch {
      return null;
    }
  };

  const fromComponent = guided.source.kind === 'COMPONENT';
  const sourceCode = fromComponent ? (guided.source as { code: string }).code : null;
  /** Lấy số từ một khoản mà chính người này chưa được khai. */
  const nguonChuaKhai = !!sourceCode && !assigned.has(sourceCode);

  const onSource = (value: string) => set({
    source: value === NHAP_TAY ? { kind: 'FIXED' } : { kind: 'COMPONENT', code: value },
  });

  const slot = 'min-w-0 flex-1 rounded-lg border px-2.5 py-1.5 text-sm outline-none transition'
    + ' focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20';

  return (
    <div className="space-y-2.5">
      {/* --- Dòng phương trình --- */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="shrink-0 text-sm font-bold text-slate-800">{componentName}</span>
        <span className="shrink-0 text-base text-slate-400">=</span>

        {fromComponent ? (
          <select
            value={sourceCode ?? ''}
            onChange={(event) => onSource(event.target.value)}
            className={`${slot} ${nguonChuaKhai ? 'border-amber-400 bg-amber-50' : 'border-slate-200 bg-white'}`}
          >
            <option value={NHAP_TAY}>Nhập số cố định…</option>
            {daKhai.length > 0 && (
              <optgroup label="Đã khai cho người này">
                {daKhai.map((item) => <option key={item.id} value={item.code}>{item.name}</option>)}
              </optgroup>
            )}
            {chuaKhai.length > 0 && (
              <optgroup label="Chưa khai cho người này">
                {chuaKhai.map((item) => <option key={item.id} value={item.code}>{item.name}</option>)}
              </optgroup>
            )}
          </select>
        ) : (
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            <input
              inputMode="decimal"
              placeholder="VD: 200000"
              value={amount}
              onChange={(event) => onAmountChange(event.target.value.replace(/[^\d]/g, ''))}
              className={`${slot} border-indigo-300 bg-white font-mono`}
            />
            <button
              type="button"
              onClick={() => onSource(codes[0] ?? NHAP_TAY)}
              disabled={codes.length === 0}
              className="shrink-0 rounded-lg border border-slate-200 px-2 py-1.5 text-[11px] font-bold text-slate-500 transition hover:border-indigo-300 hover:text-indigo-700 disabled:opacity-40"
            >
              Lấy từ danh mục
            </button>
          </div>
        )}

        <span className="shrink-0 text-base text-slate-400">×</span>

        <select
          value={guided.variable ?? ''}
          onChange={(event) => set({
            variable: event.target.value || null,
            // Không nhân thì không có gì để chia; để sót cờ này lại sẽ sinh ra
            // `(MUC_RIENG / STANDARD_DAYS)` cụt đuôi ở lần bật lại sau.
            prorate: event.target.value ? guided.prorate : false,
          })}
          className={`${slot} border-slate-200 bg-white`}
        >
          <option value="">Không nhân</option>
          <optgroup label="Lấy tự động từ chấm công và KPI">
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
        </select>
      </div>

      {/* Lấy số từ khoản mà người này chưa khai thì phần đó bằng 0đ. Nói ngay,
          vì phát hiện lúc xem phiếu lương là đã trả thiếu rồi. */}
      {nguonChuaKhai && (
        <p className="flex items-start gap-1.5 rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11px] leading-relaxed text-amber-800">
          <TriangleAlert className="mt-0.5 h-3 w-3 flex-shrink-0" />
          Người này chưa được khai khoản đó, nên phần này tính bằng 0đ. Tick thêm khoản đó
          ở danh mục bên trên, hoặc chọn nguồn khác.
        </p>
      )}

      {/* Hai cách hiểu con số, kèm tiền thật của từng cách. Chỉ có nghĩa khi
          nhân với ngày công: "8tr × 22 công" ra 176 triệu, "8tr ÷ 24,5 × 22"
          ra 7,18 triệu — lệch 24,5 lần. */}
      {isDayCount(guided.variable) && (
        <div className="flex flex-wrap gap-1.5">
          {([
            [false, 'Tiền của 1 ngày', valueOf(false)],
            [true, 'Tiền của cả tháng', valueOf(true)],
          ] as const).map(([prorate, label, value]) => (
            <button
              key={label}
              type="button"
              onClick={() => set({ prorate })}
              aria-pressed={guided.prorate === prorate}
              className={`rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition ${
                guided.prorate === prorate
                  ? 'border-indigo-600 bg-indigo-50 text-indigo-700'
                  : 'border-slate-200 text-slate-500 hover:border-indigo-300'
              }`}
            >
              {label}
              {value != null && <span className="ml-1.5 font-mono">{formatVND(value)}</span>}
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <code className="min-w-0 break-words font-mono text-[11px] text-indigo-700">{generated}</code>
        <button
          type="button"
          onClick={onWriteByHand}
          className="inline-flex shrink-0 items-center gap-1 text-[11px] font-bold text-slate-400 transition hover:text-indigo-700"
        >
          <PenLine className="h-3 w-3" /> Tự viết công thức
        </button>
      </div>
    </div>
  );
}
