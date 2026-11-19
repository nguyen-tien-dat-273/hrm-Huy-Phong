import type { ComponentType } from 'react';
import { CountBadge } from './CountBadge';

export interface FilterChip<K extends string = string> {
  key: K;
  label: string;
  count?: number;
  icon?: ComponentType<{ className?: string }>;
  /** Số báo việc cần xử lý: chấm đỏ, bằng 0 thì ẩn. */
  alert?: boolean;
}

interface FilterChipsProps<K extends string> {
  items: readonly FilterChip<K>[];
  value: K;
  onChange: (key: K) => void;
  label?: string;
  className?: string;
}

/** Bộ lọc trạng thái dùng chung: dải nút vuông viền liền nhau, mục đang chọn tô đặc. Mọi bộ lọc trạng thái/nhóm đều dùng cái này, không dùng tab hay nút tự vẽ. */
export function FilterChips<K extends string>({ items, value, onChange, label, className = '' }: FilterChipsProps<K>) {
  return (
    <div className={`inline-flex max-w-full overflow-x-auto border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 no-print ${className}`} role="group" aria-label={label}>
      {items.map((item, index) => {
        const active = item.key === value;
        const Icon = item.icon;
        return (
          <button
            key={item.key}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(item.key)}
            className={`inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-none px-3.5 text-sm font-semibold transition-colors ${index > 0 ? 'border-l border-slate-300 dark:border-slate-600' : ''} ${
              active
                ? 'bg-indigo-600 text-white'
                : 'text-slate-800 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700'
            }`}
          >
            {Icon && <Icon className="h-4 w-4" />}
            {item.label}
            {item.alert && <CountBadge count={item.count ?? 0} />}
            {!item.alert && item.count !== undefined && (
              <span className={`text-xs font-bold tabular-nums ${active ? 'text-indigo-100' : 'text-slate-600 dark:text-slate-400'}`}>{item.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
