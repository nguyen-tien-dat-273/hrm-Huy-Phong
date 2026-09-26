// ============================================================================
// Bảng chi tiết phiếu lương — dùng chung cho admin và nhân viên.
// ----------------------------------------------------------------------------
// Mỗi dòng mang theo cách ra con số ("12.000.000 ÷ 23,5 × 22,5"), để khi nhân
// viên hỏi "sao tháng này ít hơn" thì phiếu tự trả lời được.
// ============================================================================

import { CircleAlert } from 'lucide-react';
import { PayslipDocument, type PayslipDocumentProps } from '@/components/payroll/PayslipDocument';
import { formatVND } from '@/lib/utils';
import { formatFormulaNumber } from '@/lib/formulaTokens';
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
  /** Chênh lệch làm tròn thực lĩnh — hiện để phiếu cộng trừ khớp. */
  roundingAdjustment?: number;
  /** Ẩn phần chi phí doanh nghiệp (phiếu cũ) khi nhân viên tự xem phiếu của mình. */
  showEmployerCost?: boolean;
  warnings?: string[];
  theme?: 'admin' | 'staff';
  /**
   * Có thì thêm cách xem "Dạng phiếu lương" — trình bày như mẫu giấy của phòng
   * kế toán, để đối chiếu và in.
   */
  paper?: Omit<PayslipDocumentProps, 'netPay' | 'roundingAdjustment'>;
}

export function PayslipBreakdown({
  lines,
  netPay,
  roundingAdjustment = 0,
  showEmployerCost = true,
  warnings = [],
  theme = 'admin',
  paper,
}: PayslipBreakdownProps) {
  
  const info = lines.filter((line) => line.kind === 'INFO');
  const earnings = lines.filter((line) => line.kind === 'EARNING');
  const deductions = lines.filter((line) => line.kind === 'DEDUCTION');
  const employerCosts = lines.filter((line) => line.kind === 'EMPLOYER_COST');

  const totalEarnings = earnings.reduce((sum, line) => sum + line.amount, 0);
  const totalDeductions = deductions.reduce((sum, line) => sum + line.amount, 0);
  const totalEmployer = employerCosts.reduce((sum, line) => sum + line.amount, 0);
  const accent = theme === 'staff' ? 'text-emerald-700' : 'text-indigo-700';

  if (paper) {
    return (
      <div className="space-y-4">
        <div className="overflow-hidden rounded-none border border-slate-200 print:border-0">
          <PayslipDocument {...paper} netPay={netPay} roundingAdjustment={roundingAdjustment} />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {warnings.length > 0 && (
        <ul className="space-y-1.5 rounded-none border border-amber-200 bg-amber-50 px-4 py-3">
          {warnings.map((warning) => (
            <li key={warning} className="flex items-start gap-2 text-xs leading-relaxed text-amber-800">
              <CircleAlert className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
              <span>{warning}</span>
            </li>
          ))}
        </ul>
      )}

      {info.length > 0 && (
        <div className="overflow-hidden rounded-none border border-slate-200">
          <p className="border-b border-slate-100 bg-slate-50 px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-slate-500">Số liệu — không cộng trừ vào thực nhận</p>
          <dl className="grid gap-x-6 sm:grid-cols-2">
            {info.map((line) => (
              <div key={`${line.code}-${line.name}`} className="flex items-baseline justify-between gap-3 border-b border-slate-50 px-4 py-2.5 last:border-0">
                <dt className="min-w-0 text-sm text-slate-600">
                  {line.name}
                  {line.detail && <span className="mt-0.5 block text-xs text-slate-400 break-words">{line.detail}</span>}
                </dt>
                <dd className="shrink-0 text-[15px] font-semibold tabular-nums text-slate-800">{formatFormulaNumber(line.amount)}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      <Section title="Các khoản cộng" total={totalEarnings} lines={earnings} tone="positive" />

      {deductions.length > 0 && (
        <Section title="Các khoản trừ" total={totalDeductions} lines={deductions} tone="negative" />
      )}

      {roundingAdjustment !== 0 && (
        <p className="flex items-center justify-between gap-4 px-4 text-xs text-slate-500">
          <span>Làm tròn thực lĩnh</span>
          <span className="tabular-nums">{roundingAdjustment > 0 ? '+' : '−'}{formatVND(Math.abs(roundingAdjustment))}</span>
        </p>
      )}

      <div className="flex items-center justify-between gap-4 rounded-none border border-slate-200 bg-slate-50 px-4 py-4">
        <span className="text-sm font-extrabold uppercase tracking-wide text-slate-900">Thực nhận</span>
        <span className={`text-xl font-extrabold tabular-nums ${netPay < 0 ? 'text-red-600' : accent}`}>
          {formatVND(netPay)}
        </span>
      </div>

      {showEmployerCost && employerCosts.length > 0 && (
        <Section title="Doanh nghiệp chi thêm" total={totalEmployer} lines={employerCosts} tone="neutral" />
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
    <div className="overflow-hidden rounded-none border border-slate-200">
      <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-4 py-2.5">
        <span className="text-xs font-bold uppercase tracking-wider text-slate-500">{title}</span>
        <span className={`text-[15px] font-bold tabular-nums ${amountColor}`}>{sign}{formatVND(total)}</span>
      </div>
      {lines.length === 0 ? (
        <p className="px-4 py-3 text-xs text-slate-400">Không có dòng nào.</p>
      ) : (
        <ul className="divide-y divide-slate-50">
          {lines.map((line) => (
            <li key={`${line.code}-${line.name}`} className="flex items-start justify-between gap-4 px-4 py-3.5">
              <div className="min-w-0">
                <p className="text-[15px] font-medium text-slate-800">{line.name}</p>
                {line.detail && (
                  <p className="mt-1 text-[13px] leading-relaxed text-slate-500 break-words">{line.detail}</p>
                )}
              </div>
              <span className={`flex-shrink-0 text-[15px] font-bold tabular-nums ${amountColor}`}>
                {sign}{formatVND(line.amount)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
