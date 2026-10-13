// ============================================================================
// Bảng chi tiết phiếu lương — dùng chung cho admin và nhân viên.
// ----------------------------------------------------------------------------
// Mỗi dòng mang theo câu giải thích cách ra con số. Bảng lương cũ chỉ hiện ba
// cột tổng (lương theo công / BHXH / thuế), nên khi nhân viên hỏi "sao tháng
// này ít hơn" thì kế toán phải mở Excel tính tay để trả lời.
// ============================================================================

import { CircleAlert } from 'lucide-react';
import { formatVND } from '@/lib/utils';
import type { PayComponentKind } from '@/types';

export interface BreakdownLine {
  code: string;
  name: string;
  kind: PayComponentKind;
  quantity?: number | null;
  rate?: number | null;
  amount: number;
  detail?: string | null;
}

interface PayslipBreakdownProps {
  lines: BreakdownLine[];
  netPay: number;
  /** Chênh lệch làm tròn thực lĩnh (FR06.04.01) — hiện để phiếu cộng trừ khớp. */
  roundingAdjustment?: number;
  /** Ẩn phần chi phí doanh nghiệp khi nhân viên tự xem phiếu của mình. */
  showEmployerCost?: boolean;
  warnings?: string[];
  theme?: 'admin' | 'staff';
}

export function PayslipBreakdown({
  lines,
  netPay,
  roundingAdjustment = 0,
  showEmployerCost = true,
  warnings = [],
  theme = 'admin',
}: PayslipBreakdownProps) {
  const earnings = lines.filter((line) => line.kind === 'EARNING');
  const deductions = lines.filter((line) => line.kind === 'DEDUCTION');
  const employerCosts = lines.filter((line) => line.kind === 'EMPLOYER_COST');

  const totalEarnings = earnings.reduce((sum, line) => sum + line.amount, 0);
  const totalDeductions = deductions.reduce((sum, line) => sum + line.amount, 0);
  const totalEmployer = employerCosts.reduce((sum, line) => sum + line.amount, 0);
  const accent = theme === 'staff' ? 'text-emerald-700' : 'text-indigo-700';

  return (
    <div className="space-y-4">
      {warnings.length > 0 && (
        <ul className="space-y-1.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          {warnings.map((warning) => (
            <li key={warning} className="flex items-start gap-2 text-xs leading-relaxed text-amber-800">
              <CircleAlert className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
              <span>{warning}</span>
            </li>
          ))}
        </ul>
      )}

      <Section title="Thu nhập" total={totalEarnings} lines={earnings} tone="positive" />

      {deductions.length > 0 && (
        <Section title="Khấu trừ" total={totalDeductions} lines={deductions} tone="negative" />
      )}

      {roundingAdjustment !== 0 && (
        <p className="flex items-center justify-between gap-4 px-4 text-xs text-slate-500">
          <span>Làm tròn thực lĩnh</span>
          <span className="tabular-nums">{roundingAdjustment > 0 ? '+' : '−'}{formatVND(Math.abs(roundingAdjustment))}</span>
        </p>
      )}

      <div className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-4">
        <span className="text-sm font-extrabold uppercase tracking-wide text-slate-900">Thực nhận</span>
        <span className={`text-xl font-extrabold tabular-nums ${netPay < 0 ? 'text-red-600' : accent}`}>
          {formatVND(netPay)}
        </span>
      </div>

      {showEmployerCost && employerCosts.length > 0 && (
        <div>
          <Section
            title="Chi phí doanh nghiệp đóng thêm"
            total={totalEmployer}
            lines={employerCosts}
            tone="neutral"
          />
          <p className="mt-2 px-1 text-xs text-slate-500">
            Không trừ vào lương nhân viên. Tổng chi phí thực tế cho người này:{' '}
            <strong className="text-slate-700">{formatVND(totalEarnings + totalEmployer)}</strong>.
          </p>
        </div>
      )}
    </div>
  );
}

function Section({
  title,
  total,
  lines,
  tone,
}: {
  title: string;
  total: number;
  lines: BreakdownLine[];
  tone: 'positive' | 'negative' | 'neutral';
}) {
  const amountColor =
    tone === 'negative' ? 'text-red-600' : tone === 'neutral' ? 'text-slate-500' : 'text-slate-900';
  const sign = tone === 'negative' ? '− ' : '';

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200">
      <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-4 py-2.5">
        <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{title}</span>
        <span className={`text-sm font-bold tabular-nums ${amountColor}`}>{sign}{formatVND(total)}</span>
      </div>
      <ul className="divide-y divide-slate-50">
        {lines.map((line) => (
          <li key={`${line.code}-${line.name}`} className="flex items-start justify-between gap-4 px-4 py-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-slate-700">{line.name}</p>
              {line.detail && (
                <p className="mt-0.5 text-xs leading-relaxed text-slate-400 break-words">{line.detail}</p>
              )}
            </div>
            <span className={`flex-shrink-0 text-sm font-bold tabular-nums ${amountColor}`}>
              {sign}{formatVND(line.amount)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
