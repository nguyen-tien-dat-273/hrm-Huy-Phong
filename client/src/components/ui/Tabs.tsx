import type { ComponentType, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { CountBadge } from './CountBadge';

export interface TabItem<K extends string = string> {
  key: K;
  label: string;
  icon?: ComponentType<{ className?: string }>;
  /** Số hiện cạnh tên tab (ví dụ số đơn chờ). */
  count?: number;
  /** Số báo việc cần xử lý: vẽ chấm đỏ, bằng 0 thì ẩn. */
  alert?: boolean;
  /** Tab là một trang riêng: bấm để chuyển đường dẫn thay vì đổi trạng thái. */
  to?: string;
}

interface TabsProps<K extends string> {
  items: readonly TabItem<K>[];
  value: K;
  onChange: (key: K) => void;
  label?: string;
  className?: string;
}

/** Thanh chuyển tab dùng chung: gạch chân tab đang chọn, chữ in hoa, vuông góc. Mọi trang chuyển nhóm nội dung đều dùng cái này. */
export function Tabs<K extends string>({ items, value, onChange, label, className = '' }: TabsProps<K>) {
  return (
    <div className={`flex overflow-x-auto border-b border-slate-300 dark:border-slate-700 no-print ${className}`} role="tablist" aria-label={label}>
      {items.map((item) => {
        const active = item.key === value;
        const Icon = item.icon;
        return (
          <TabShell
            key={item.key}
            to={item.to}
            active={active}
            onClick={() => onChange(item.key)}
            className={`-mb-px inline-flex shrink-0 items-center gap-2 rounded-none border-b-2 px-5 py-3 text-xs font-bold uppercase tracking-wider transition-colors ${
              active
                ? 'border-indigo-600 bg-white dark:bg-slate-900 text-indigo-700 dark:text-indigo-400'
                : 'border-transparent text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/40 hover:text-slate-900 dark:hover:text-slate-100'
            }`}
          >
            {Icon && <Icon className="h-4 w-4" />}
            {item.label}
            {item.alert && <CountBadge count={item.count ?? 0} />}
            {!item.alert && item.count !== undefined && (
              <span className={`rounded-full px-1.5 py-0.5 text-[11px] font-bold tabular-nums ${active ? 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300' : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300'}`}>
                {item.count}
              </span>
            )}
          </TabShell>
        );
      })}
    </div>
  );
}

function TabShell({ to, active, onClick, className, children }: { to?: string; active: boolean; onClick: () => void; className: string; children: ReactNode }) {
  if (to) return <Link to={to} role="tab" aria-selected={active} aria-current={active ? 'page' : undefined} className={className}>{children}</Link>;
  return <button type="button" role="tab" aria-selected={active} onClick={onClick} className={className}>{children}</button>;
}
