// ============================================================================
// Bút toán kết chuyển lương sang kế toán.
// ----------------------------------------------------------------------------
// Sinh bảng bút toán Nợ/Có theo hệ thống tài khoản Thông tư 200 — thứ mà mọi
// phần mềm kế toán đều nhập được — rồi xuất Excel để kế toán đối chiếu.
//
// Hệ thống không biết dòng trừ nào là bảo hiểm hay thuế (mọi dòng là một đầu
// mục người dùng tự đặt tên), nên bút toán đi theo TỪNG ĐẦU MỤC TRỪ:
//
//   1. Chi phí lương phải trả    Nợ 642 / Có 334   — tổng các dòng cộng
//   2. Khấu trừ vào lương         Nợ 334 / Có 338   — mỗi đầu mục trừ một dòng
//
// Tài khoản Có của từng khoản trừ (3383 BHXH, 3335 thuế…) và tài khoản chi phí
// theo bộ phận (622 / 641 / 642) do kế toán chỉnh trong file — đoán bừa ở
// đây là đẩy sai chi phí vào sai khoản mục.
// ============================================================================

import type { ComputedPayslip } from './payroll';
import type { Profile } from '@/types';

/** Số hiệu tài khoản theo hệ thống tài khoản Thông tư 200/2014/TT-BTC. */
export const JOURNAL_ACCOUNTS = {
  /** Phải trả người lao động. */
  payable: '334',
  /** Chi phí quản lý doanh nghiệp — mặc định khi chưa ánh xạ bộ phận. */
  expenseDefault: '642',
  /** Phải trả, phải nộp khác — mặc định cho mọi khoản trừ, kế toán tự chỉnh. */
  deduction: '338',
} as const;

export interface JournalEntry {
  /** Nhóm bút toán, để kế toán đọc theo cụm thay vì một danh sách phẳng. */
  group: string;
  debit: string;
  credit: string;
  amount: number;
  /** Bộ phận chịu chi phí. */
  department: string;
  description: string;
}

export interface PayrollJournalRow {
  profile: Pick<Profile, 'id' | 'name' | 'department' | 'unit_id'>;
  computed: Pick<ComputedPayslip, 'gross' | 'totalDeductions' | 'netPay' | 'lines'>;
}

export interface PayrollJournal {
  entries: JournalEntry[];
  totals: {
    gross: number;
    deductions: number;
    netPay: number;
  };
  /** Nợ phải bằng Có. */
  balanced: boolean;
  totalDebit: number;
  totalCredit: number;
}

const UNASSIGNED = 'Chưa gán bộ phận';

/**
 * Dựng bảng bút toán cho một kỳ lương, gộp theo BỘ PHẬN (sổ kế toán ghi theo
 * khoản mục, không cần một dòng cho mỗi nhân viên).
 */
export function buildPayrollJournal(
  rows: PayrollJournalRow[],
  expenseAccount: string = JOURNAL_ACCOUNTS.expenseDefault,
  /** Tên đơn vị theo id — ưu tiên hơn ô chữ tự do `department`. */
  unitNameById?: Map<string, string>,
): PayrollJournal {
  const byDepartment = new Map<string, PayrollJournalRow[]>();
  for (const row of rows) {
    const unitName = row.profile.unit_id ? unitNameById?.get(row.profile.unit_id) : undefined;
    const key = unitName?.trim() || row.profile.department?.trim() || UNASSIGNED;
    byDepartment.set(key, [...(byDepartment.get(key) ?? []), row]);
  }

  const entries: JournalEntry[] = [];
  const totals = { gross: 0, deductions: 0, netPay: 0 };
  const push = (entry: JournalEntry) => {
    if (entry.amount > 0) entries.push(entry);
  };

  for (const [department, list] of [...byDepartment.entries()].sort()) {
    const gross = list.reduce((sum, row) => sum + row.computed.gross, 0);
    totals.gross += gross;
    totals.deductions += list.reduce((sum, row) => sum + row.computed.totalDeductions, 0);
    totals.netPay += list.reduce((sum, row) => sum + row.computed.netPay, 0);

    push({
      group: '1. Chi phí lương phải trả',
      debit: expenseAccount, credit: JOURNAL_ACCOUNTS.payable,
      amount: gross, department,
      description: `Tiền lương phải trả người lao động — ${department}`,
    });

    // Mỗi đầu mục trừ một bút toán, theo đúng tên người dùng đặt.
    const byName = new Map<string, number>();
    for (const row of list) {
      for (const line of row.computed.lines) {
        if (line.kind !== 'DEDUCTION') continue;
        byName.set(line.name, (byName.get(line.name) ?? 0) + line.amount);
      }
    }
    for (const [name, amount] of [...byName.entries()].sort((a, b) => a[0].localeCompare(b[0], 'vi'))) {
      push({
        group: '2. Khấu trừ vào lương',
        debit: JOURNAL_ACCOUNTS.payable, credit: JOURNAL_ACCOUNTS.deduction,
        amount, department,
        description: `${name} — ${department}`,
      });
    }
  }

  const totalDebit = entries.reduce((sum, entry) => sum + entry.amount, 0);
  const totalCredit = totalDebit;
  return { entries, totals, totalDebit, totalCredit, balanced: Math.abs(totalDebit - totalCredit) < 1 };
}
