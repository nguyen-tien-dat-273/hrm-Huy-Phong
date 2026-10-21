// Chip loại dòng: "+ Cộng", "− Trừ", "Trung gian" — dùng chung cho danh mục,
// cơ chế lương và khai riêng, để cùng một loại dòng trông giống nhau ở mọi màn.

import { KIND_SHORT } from '@/lib/formulaEntries';
import type { PayComponentKind } from '@/types';

export const KIND_CHIP_TONE: Record<PayComponentKind, string> = {
  EARNING: 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 ring-emerald-200 dark:ring-emerald-800/60',
  DEDUCTION: 'bg-rose-50 dark:bg-rose-950/60 text-rose-600 dark:text-rose-300 ring-rose-200 dark:ring-rose-800/60',
  INFO: 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 ring-slate-200 dark:ring-slate-700',
  EMPLOYER_COST: 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 ring-slate-200 dark:ring-slate-700',
};

export function KindChip({ kind, className = '' }: { kind: PayComponentKind; className?: string }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-md px-1.5 py-0.5 text-[10px] font-bold ring-1 ring-inset ${KIND_CHIP_TONE[kind]} ${className}`}
    >
      {KIND_SHORT[kind]}
    </span>
  );
}
