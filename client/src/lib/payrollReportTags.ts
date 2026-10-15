// ============================================================================
// Nhãn báo cáo của đầu mục lương.
// ----------------------------------------------------------------------------
// Engine tính lương KHÔNG biết đâu là bảo hiểm hay thuế — mỗi khoản chỉ là một
// đầu mục có tên. Nhưng báo cáo nhân sự (bảo hiểm & thuế theo tháng) cần biết
// con số nào thuộc cột nào, và đó là việc của NGƯỜI dùng khai: gắn nhãn cho đầu
// mục ở Danh mục. Nhãn KHÔNG đi vào công thức và không đổi cách tính; nó chỉ
// quyết định khi chốt kỳ, số của đầu mục cộng vào cột nào của phiếu lương
// (`insurance_employee`, `insurance_employer`, `personal_income_tax`,
// `taxable_income`) để báo cáo đọc.
//
// Nhãn đi cùng Loại dòng: khoản người lao động đóng / thuế phải là dòng TRỪ
// (nếu không, tổng khấu trừ trên phiếu bị cộng hai lần); phần doanh nghiệp đóng
// và thu nhập tính thuế là dòng CHỈ ĐỂ TÍNH.
// ============================================================================

import type { PayComponentKind, PayReportTag } from '@/types';

/** Tổng theo nhãn của một phiếu lương — đúng bốn cột báo cáo của `payslips`. */
export interface ReportTotals {
  insuranceEmployee: number;
  insuranceEmployer: number;
  incomeTax: number;
  taxableIncome: number;
}

export const EMPTY_REPORT_TOTALS: ReportTotals = {
  insuranceEmployee: 0, insuranceEmployer: 0, incomeTax: 0, taxableIncome: 0,
};

interface ReportTagInfo {
  code: PayReportTag;
  /** Tên hiện ở ô chọn nhãn. */
  label: string;
  /** Cột báo cáo mà nhãn này cộng vào. */
  column: keyof ReportTotals;
  /** Loại dòng được phép mang nhãn. */
  kinds: PayComponentKind[];
  /** Một câu nói nhãn dùng cho việc gì và phải đi với loại dòng nào. */
  hint: string;
}

export const PAY_REPORT_TAGS: ReportTagInfo[] = [
  {
    code: 'INSURANCE_EMPLOYEE',
    label: 'Bảo hiểm người lao động đóng',
    column: 'insuranceEmployee',
    kinds: ['DEDUCTION'],
    hint: 'Khoản trừ vào lương nhân viên; cộng vào cột “BH người lao động” của báo cáo. Dùng với loại dòng Trừ khỏi lương.',
  },
  {
    code: 'INSURANCE_EMPLOYER',
    label: 'Doanh nghiệp đóng thêm (BH, KPCĐ…)',
    column: 'insuranceEmployer',
    kinds: ['INFO', 'EMPLOYER_COST'],
    hint: 'Chi phí công ty chịu, không trừ của nhân viên; cộng vào cột “BH công ty đóng”. Dùng với loại dòng Chỉ để tính.',
  },
  {
    code: 'INCOME_TAX',
    label: 'Thuế thu nhập cá nhân',
    column: 'incomeTax',
    kinds: ['DEDUCTION'],
    hint: 'Khoản thuế trừ vào lương; cộng vào cột “Thuế TNCN” của báo cáo. Dùng với loại dòng Trừ khỏi lương.',
  },
  {
    code: 'TAXABLE_INCOME',
    label: 'Thu nhập tính thuế',
    column: 'taxableIncome',
    kinds: ['INFO'],
    hint: 'Số thu nhập dùng để tính thuế; cộng vào cột “Thu nhập tính thuế” của báo cáo. Dùng với loại dòng Chỉ để tính.',
  },
];

const TAG_BY_CODE = new Map(PAY_REPORT_TAGS.map((tag) => [tag.code, tag]));

export const reportTagInfo = (tag: PayReportTag | null | undefined): ReportTagInfo | null =>
  (tag ? TAG_BY_CODE.get(tag) ?? null : null);

export const reportTagLabel = (tag: PayReportTag | null | undefined): string | null =>
  reportTagInfo(tag)?.label ?? null;

/** Nhãn này đi được với loại dòng này không. Không nhãn thì luôn được. */
export function reportTagFitsKind(tag: PayReportTag | null | undefined, kind: PayComponentKind): boolean {
  const info = reportTagInfo(tag);
  return !info || info.kinds.includes(kind);
}

/** Câu báo lỗi cho form khi nhãn và loại dòng không đi cùng nhau; null nếu hợp lệ. */
export function reportTagKindProblem(tag: PayReportTag | null | undefined, kind: PayComponentKind): string | null {
  const info = reportTagInfo(tag);
  if (!info || info.kinds.includes(kind)) return null;
  const wanted = info.kinds.includes('DEDUCTION') ? 'Trừ khỏi lương' : 'Chỉ để tính';
  return `Nhãn “${info.label}” chỉ dùng với loại dòng “${wanted}”.`;
}

/**
 * Phần khấu trừ còn lại sau khi tách bảo hiểm người lao động và thuế — cột
 * `other_deductions` của phiếu. Cộng ba cột này luôn ra tổng trừ của phiếu.
 */
export function otherDeductionsOf(totalDeductions: number, totals: ReportTotals): number {
  return totalDeductions - totals.insuranceEmployee - totals.incomeTax;
}

/**
 * Cộng số của các dòng theo nhãn. Dòng mang nhãn không hợp với loại dòng của
 * nó bị bỏ qua — thà thiếu số báo cáo còn hơn làm tổng khấu trừ lệch.
 */
export function sumReportTags(
  lines: Array<{ tag: PayReportTag | null | undefined; kind: PayComponentKind; amount: number }>,
): ReportTotals {
  const totals: ReportTotals = { ...EMPTY_REPORT_TOTALS };
  for (const line of lines) {
    const info = reportTagInfo(line.tag);
    if (!info || !info.kinds.includes(line.kind)) continue;
    const amount = Number(line.amount);
    if (Number.isFinite(amount)) totals[info.column] += amount;
  }
  return {
    insuranceEmployee: Math.round(totals.insuranceEmployee),
    insuranceEmployer: Math.round(totals.insuranceEmployer),
    incomeTax: Math.round(totals.incomeTax),
    taxableIncome: Math.round(totals.taxableIncome),
  };
}
