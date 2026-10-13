import { useId, useMemo, useRef } from 'react';
import { Calculator, CheckCircle2, TriangleAlert } from 'lucide-react';
import { evaluateFormula, validateFormula } from '@/lib/payrollFormula';
import { formatVND } from '@/lib/utils';
import type { PayComponent } from '@/types';

interface FormulaVariable {
  code: string;
  label: string;
  hint: string;
}

interface VariableGroup {
  title: string;
  variables: FormulaVariable[];
}

interface PayrollFormulaBuilderProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  sampleScope: Readonly<Record<string, number>>;
  components: PayComponent[];
  defaultFormula?: string | null;
}

const SYSTEM_GROUPS: VariableGroup[] = [
  {
    title: 'Mức lương',
    variables: [
      { code: 'MUC_RIENG', label: 'Mức riêng', hint: 'Mức tiền khai cho khoản đang gán' },
      { code: 'BASE', label: 'Lương gốc thực tế', hint: 'Tổng lương công, phép và ngày lễ' },
      { code: 'BASE_WORK', label: 'Lương ngày công', hint: 'Phần lương từ ngày đi làm' },
      { code: 'BASE_LEAVE', label: 'Lương ngày phép', hint: 'Phần lương phép hưởng lương' },
      { code: 'BASE_HOLIDAY', label: 'Lương ngày lễ', hint: 'Phần lương nghỉ lễ' },
      { code: 'GROSS', label: 'Tổng thu nhập', hint: 'Tổng tại thời điểm tính khoản này' },
      { code: 'MONTHLY_RATE', label: 'Lương thỏa thuận', hint: 'Mức lương tháng đã khai' },
      { code: 'DAILY_RATE', label: 'Đơn giá ngày', hint: 'Mức lương quy đổi một ngày' },
      { code: 'HOURLY_RATE', label: 'Đơn giá giờ', hint: 'Mức lương quy đổi một giờ' },
      { code: 'INSURANCE_BASE', label: 'Mức đóng BH', hint: 'Mức lương đóng bảo hiểm' },
    ],
  },
  {
    title: 'Công và thời gian',
    variables: [
      { code: 'WORK_DAYS', label: 'Ngày đi làm', hint: 'Số ngày có chấm công' },
      { code: 'LEAVE_DAYS', label: 'Ngày phép', hint: 'Ngày phép hưởng lương' },
      { code: 'HOLIDAY_DAYS', label: 'Ngày lễ', hint: 'Ngày lễ hưởng lương' },
      { code: 'PAID_DAYS', label: 'Ngày hưởng lương', hint: 'Công + phép + lễ' },
      { code: 'STANDARD_DAYS', label: 'Công chuẩn', hint: 'Ngày công chuẩn của kỳ' },
      { code: 'WORK_HOURS', label: 'Giờ làm', hint: 'Tổng giờ làm thực tế' },
      { code: 'HOURS_PER_DAY', label: 'Giờ mỗi ngày', hint: 'Số giờ chuẩn một ngày' },
    ],
  },
  {
    title: 'KPI và chuyên cần',
    variables: [
      { code: 'KPI_PCT', label: 'KPI (%)', hint: 'Tỷ lệ KPI của nhân viên trong kỳ' },
      { code: 'LATE_MINUTES', label: 'Phút đi muộn', hint: 'Tổng số phút đi muộn' },
      { code: 'LATE_COUNT', label: 'Lần đi muộn', hint: 'Số lần đi muộn' },
      { code: 'LATE_AFTER_CUTOFF', label: 'Muộn quá ngưỡng', hint: 'Số lần muộn sau giờ giới hạn' },
      { code: 'EARLY_MINUTES', label: 'Phút về sớm', hint: 'Tổng số phút về sớm' },
      { code: 'EARLY_COUNT', label: 'Lần về sớm', hint: 'Số lần về sớm' },
      { code: 'DEPENDENTS', label: 'Người phụ thuộc', hint: 'Số người phụ thuộc' },
    ],
  },
];

const TEMPLATES = [
  { label: 'KPI theo tỷ lệ', formula: 'MUC_RIENG * KPI_PCT / 100' },
  { label: 'Theo ngày hưởng lương', formula: 'MUC_RIENG * PAID_DAYS / MAX(STANDARD_DAYS, 1)' },
  { label: 'Thưởng đủ công', formula: 'IF(PAID_DAYS >= STANDARD_DAYS, MUC_RIENG, 0)' },
  { label: 'Thưởng không đi muộn', formula: 'IF(LATE_COUNT == 0, MUC_RIENG, 0)' },
] as const;

const FUNCTIONS = [
  { label: 'Điều kiện', value: 'IF(điều_kiện, giá_trị_đúng, giá_trị_sai)' },
  { label: 'Lấy nhỏ nhất', value: 'MIN(a, b)' },
  { label: 'Lấy lớn nhất', value: 'MAX(a, b)' },
  { label: 'Làm tròn', value: 'ROUND(giá_trị)' },
] as const;

export function PayrollFormulaBuilder({
  label, value, onChange, sampleScope, components, defaultFormula,
}: PayrollFormulaBuilderProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const inputId = useId();
  const error = value.trim() ? validateFormula(value, sampleScope) : null;
  const preview = useMemo(() => {
    if (!value.trim() || error) return null;
    try {
      return evaluateFormula(value, sampleScope);
    } catch {
      return null;
    }
  }, [error, sampleScope, value]);

  const dynamicGroups = useMemo<VariableGroup[]>(() => {
    const inputs = new Map<string, FormulaVariable>();
    const calculated = new Map<string, FormulaVariable>();
    for (const component of components) {
      if (component.input_code) {
        const code = component.input_code.toUpperCase();
        inputs.set(code, {
          code,
          label: component.name,
          hint: `Số liệu nhập theo tháng cho ${component.name}`,
        });
      }
      const code = component.code.toUpperCase();
      calculated.set(code, {
        code,
        label: component.name,
        hint: 'Số tiền của khoản này sau khi đã tính',
      });
    }
    return [
      { title: 'Số liệu tháng', variables: [...inputs.values()] },
      { title: 'Khoản đã tính trước', variables: [...calculated.values()] },
    ].filter((group) => group.variables.length > 0);
  }, [components]);

  const insert = (text: string, replaceAll = false) => {
    if (replaceAll) {
      onChange(text);
      requestAnimationFrame(() => textareaRef.current?.focus());
      return;
    }
    const textarea = textareaRef.current;
    const start = textarea?.selectionStart ?? value.length;
    const end = textarea?.selectionEnd ?? value.length;
    const needsLeftSpace = start > 0 && !/[\s(,+\-*/]/.test(value[start - 1]);
    const needsRightSpace = end < value.length && !/[\s),+\-*/]/.test(value[end]);
    const inserted = `${needsLeftSpace ? ' ' : ''}${text}${needsRightSpace ? ' ' : ''}`;
    const next = value.slice(0, start) + inserted + value.slice(end);
    onChange(next);
    requestAnimationFrame(() => {
      textarea?.focus();
      const cursor = start + inserted.length;
      textarea?.setSelectionRange(cursor, cursor);
    });
  };

  return (
    <div className="space-y-2">
      <label htmlFor={inputId} className="block text-sm font-semibold text-slate-700">{label}</label>
      <textarea
        ref={textareaRef}
        id={inputId}
        rows={2}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={defaultFormula || 'VD: MUC_RIENG * KPI_PCT / 100'}
        aria-invalid={!!error}
        className={`w-full rounded-xl border bg-white px-3.5 py-3 font-mono text-xs text-slate-900 shadow-sm transition-all placeholder:text-slate-400 focus:outline-none focus:ring-4 ${
          error
            ? 'border-red-400 focus:border-red-400 focus:ring-red-500/10'
            : 'border-slate-200 hover:border-slate-300 focus:border-indigo-500 focus:ring-indigo-500/10'
        }`}
      />

      {error ? (
        <p role="alert" className="flex items-start gap-1.5 text-xs font-medium text-red-600">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" /> {error}
        </p>
      ) : preview ? (
        <p className="flex items-center gap-1.5 text-xs font-medium text-emerald-700">
          <CheckCircle2 className="h-3.5 w-3.5" />
          Hợp lệ · kết quả thử {formatVND(Math.round(preview.value))}
          {preview.usedVariables.length > 0 && ` · dùng ${preview.usedVariables.join(', ')}`}
        </p>
      ) : defaultFormula ? (
        <p className="text-xs text-slate-500">
          Đang dùng công thức chung: <code className="font-mono text-slate-700">{defaultFormula}</code>
        </p>
      ) : (
        <p className="text-xs text-slate-500">Để trống nếu chỉ dùng mức tiền đã khai.</p>
      )}

      <details className="group rounded-xl border border-indigo-100 bg-indigo-50/40 px-3.5 py-3">
        <summary className="flex cursor-pointer list-none items-center gap-2 text-xs font-bold text-indigo-700">
          <Calculator className="h-4 w-4" /> Tạo công thức từ Công, KPI và dữ liệu lương
          <span className="ml-auto text-[10px] font-semibold text-indigo-400 group-open:hidden">Mở</span>
        </summary>

        <div className="mt-3 space-y-4 border-t border-indigo-100 pt-3">
          <div>
            <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-500">Công thức mẫu</p>
            <div className="flex flex-wrap gap-1.5">
              {TEMPLATES.map((template) => (
                <button
                  key={template.label}
                  type="button"
                  onClick={() => insert(template.formula, true)}
                  className="rounded-lg border border-indigo-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-indigo-700 transition hover:border-indigo-400 hover:bg-indigo-50"
                  title={template.formula}
                >
                  {template.label}
                </button>
              ))}
              {defaultFormula && value.trim() !== defaultFormula.trim() && (
                <button
                  type="button"
                  onClick={() => insert(defaultFormula, true)}
                  className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-600 transition hover:border-slate-400"
                >
                  Sao chép công thức chung
                </button>
              )}
            </div>
          </div>

          {[...SYSTEM_GROUPS, ...dynamicGroups].map((group) => (
            <div key={group.title}>
              <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-500">{group.title}</p>
              <div className="flex flex-wrap gap-1.5">
                {group.variables.map((variable) => (
                  <button
                    key={`${group.title}-${variable.code}`}
                    type="button"
                    onClick={() => insert(variable.code)}
                    title={`${variable.code} — ${variable.hint}`}
                    className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-left transition hover:border-indigo-300 hover:bg-indigo-50"
                  >
                    <span className="block text-xs font-semibold text-slate-700">{variable.label}</span>
                    <code className="block text-[10px] text-indigo-600">{variable.code}</code>
                  </button>
                ))}
              </div>
            </div>
          ))}

          <div>
            <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-500">Phép tính và hàm</p>
            <div className="flex flex-wrap gap-1.5">
              {[' + ', ' - ', ' * ', ' / ', '(', ')', ' >= ', ' == '].map((operator) => (
                <button
                  key={operator}
                  type="button"
                  onClick={() => insert(operator)}
                  className="min-w-9 rounded-lg border border-slate-200 bg-white px-2 py-1.5 font-mono text-xs font-bold text-slate-700 hover:border-indigo-300 hover:text-indigo-700"
                >
                  {operator.trim() || operator}
                </button>
              ))}
              {FUNCTIONS.map((fn) => (
                <button
                  key={fn.label}
                  type="button"
                  onClick={() => insert(fn.value)}
                  title={fn.value}
                  className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:border-indigo-300 hover:text-indigo-700"
                >
                  {fn.label}
                </button>
              ))}
            </div>
          </div>

          <p className="rounded-lg bg-white/80 px-3 py-2 text-[11px] leading-relaxed text-slate-500">
            Khoản tham chiếu phải được tính trước khoản hiện tại. Nếu dùng mã một khoản khác,
            hãy bảo đảm thứ tự của khoản đó đứng trước trong bảng lương.
          </p>
        </div>
      </details>
    </div>
  );
}
