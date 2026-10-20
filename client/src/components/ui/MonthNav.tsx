import { ChevronLeft, ChevronRight } from 'lucide-react';
import { startOfMonth, addMonths, format } from 'date-fns';
import { Button } from '@/components/ui/Button';

interface MonthNavProps {
  /** Ngày đầu tháng đang xem. */
  value: Date;
  onChange: (monthStart: Date) => void;
  /** Đổi màu nút "Tháng này" theo khu (mặc định admin). */
  theme?: 'admin' | 'staff';
  /** Bỏ viền/nền/bóng — dùng khi bộ chọn đứng tự do giữa trang. */
  bare?: boolean;
  /** Chế độ gọn gàng (h-10) — dùng trên thanh công cụ / toolbar. */
  compact?: boolean;
}

/**
 * Điều hướng tháng ‹ MM/yyyy › + nút "Tháng này" — dùng chung cho Báo cáo,
 * Bảng công, Tính lương và Báo cáo cá nhân, để bốn trang không mỗi nơi một
 * kiểu. Không cho đi vượt tháng hiện tại: dữ liệu tương lai chưa tồn tại,
 * hiện bảng trống chỉ gây bối rối.
 */
export function MonthNav({ value, onChange, theme = 'admin', bare = false, compact = false }: MonthNavProps) {
  const isCurrentMonth = format(value, 'yyyy-MM') === format(new Date(), 'yyyy-MM');
  return (
    <div
      className={
        bare
          ? 'inline-flex items-center gap-1'
          : compact
          ? 'inline-flex h-10 items-center gap-0.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-1 shadow-xs'
          : 'inline-flex items-center gap-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-1 shadow-sm'
      }
      aria-label="Điều hướng tháng"
    >
      <button
        type="button"
        onClick={() => onChange(startOfMonth(addMonths(value, -1)))}
        className={`flex ${compact ? 'h-8 w-8' : 'h-11 w-11'} items-center justify-center rounded-lg text-slate-500 dark:text-slate-400 transition-colors hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-800 dark:hover:text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500`}
        aria-label="Tháng trước"
      >
        <ChevronLeft className="w-4 h-4" />
      </button>
      <span className={`${compact ? 'min-w-[76px]' : 'min-w-[82px]'} px-1 text-center text-sm font-bold tabular-nums text-slate-700 dark:text-slate-200`}>
        {format(value, 'MM/yyyy')}
      </span>
      <button
        type="button"
        onClick={() => onChange(startOfMonth(addMonths(value, 1)))}
        className={`flex ${compact ? 'h-8 w-8' : 'h-11 w-11'} items-center justify-center rounded-lg text-slate-500 dark:text-slate-400 transition-colors hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-800 dark:hover:text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-35`}
        disabled={isCurrentMonth}
        aria-label="Tháng sau"
      >
        <ChevronRight className="w-4 h-4" />
      </button>
      {!isCurrentMonth && (
        compact ? (
          <button
            type="button"
            onClick={() => onChange(startOfMonth(new Date()))}
            className="h-7 px-2 rounded-lg text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/60 transition-colors"
          >
            Tháng này
          </button>
        ) : (
          <Button size="sm" variant="ghost" theme={theme} onClick={() => onChange(startOfMonth(new Date()))}>
            Tháng này
          </Button>
        )
      )}
    </div>
  );
}
