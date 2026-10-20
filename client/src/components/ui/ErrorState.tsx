import { TriangleAlert, RotateCw } from 'lucide-react';

interface ErrorStateProps {
  /** Nguyên văn lỗi từ backend — giữ nguyên để còn tra được nguyên nhân. */
  message: string;
  onRetry?: () => void;
}

/**
 * Hiển thị khi tải dữ liệu THẤT BẠI.
 *
 * Khác hẳn `EmptyState`: "chưa có dữ liệu" và "không tải được dữ liệu" là hai
 * tình huống khác nhau, trước đây app gộp làm một nên người dùng nhìn danh sách
 * rỗng mà tưởng là không có gì, trong khi thực tế truy vấn đang lỗi.
 */
export function ErrorState({ message, onRetry }: ErrorStateProps) {
  return (
    <div className="flex min-h-64 flex-col items-center justify-center text-center py-12 px-6">
      <div className="w-16 h-16 rounded-2xl bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 shadow-sm flex items-center justify-center text-red-500 mb-4">
        <TriangleAlert className="w-8 h-8" />
      </div>
      <h3 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">Không tải được dữ liệu</h3>
      <p className="text-sm text-slate-500 dark:text-slate-400 mt-1.5 max-w-md leading-relaxed">
        Đây là lỗi hệ thống, không phải do chưa có dữ liệu.
      </p>
      <code className="mt-3 max-w-lg text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-500/10 border border-red-100 dark:border-red-500/30 rounded-lg px-3 py-2 break-words">
        {message}
      </code>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-lg border border-slate-300 dark:border-slate-600 px-4 text-sm font-medium text-slate-700 dark:text-slate-200 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        >
          <RotateCw className="w-4 h-4" />
          Thử lại
        </button>
      )}
    </div>
  );
}
