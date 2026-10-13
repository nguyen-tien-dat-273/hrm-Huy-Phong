import { ChevronLeft, ChevronRight } from 'lucide-react';
import { startOfMonth, addMonths, format } from 'date-fns';
import { Button } from '@/components/ui/Button';

interface MonthNavProps {
  /** Ngày đầu tháng đang xem. */
  value: Date;
  onChange: (monthStart: Date) => void;
  /** Đổi màu nút "Tháng này" theo khu (mặc định admin). */
  theme?: 'admin' | 'staff';
}

/**
 * Điều hướng tháng ‹ MM/yyyy › + nút "Tháng này" — dùng chung cho Báo cáo,
 * Bảng công, Tính lương và Báo cáo cá nhân, để bốn trang không mỗi nơi một
 * kiểu. Không cho đi vượt tháng hiện tại: dữ liệu tương lai chưa tồn tại,
 * hiện bảng trống chỉ gây bối rối.
 */
export function MonthNav({ value, onChange, theme = 'admin' }: MonthNavProps) {
  const isCurrentMonth = format(value, 'yyyy-MM') === format(new Date(), 'yyyy-MM');
  return (
    <div className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white p-1 shadow-sm" aria-label="Điều hướng tháng">
      <button
        type="button"
        onClick={() => onChange(startOfMonth(addMonths(value, -1)))}
        className="flex h-11 w-11 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        aria-label="Tháng trước"
      >
        <ChevronLeft className="w-4 h-4" />
      </button>
      <span className="min-w-[82px] px-1 text-center text-sm font-bold tabular-nums text-slate-700">
        {format(value, 'MM/yyyy')}
      </span>
      <button
        type="button"
        onClick={() => onChange(startOfMonth(addMonths(value, 1)))}
        className="flex h-11 w-11 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-35"
        disabled={isCurrentMonth}
        aria-label="Tháng sau"
      >
        <ChevronRight className="w-4 h-4" />
      </button>
      {!isCurrentMonth && (
        <Button size="sm" variant="ghost" theme={theme} onClick={() => onChange(startOfMonth(new Date()))}>
          Tháng này
        </Button>
      )}
    </div>
  );
}
