import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

/** Số dòng mỗi trang chuẩn: bảng 20 dòng, danh sách thẻ 10 mục. Không tự đặt số khác. */
export const PAGE_SIZE_TABLE = 20;
export const PAGE_SIZE_LIST = 10;
/** Bảng ma trận nhiều cột (bảng công theo ngày, bảng lương): 50 dòng để ít phải lật trang. */
export const PAGE_SIZE_MATRIX = 50;

/** Kẹp số trang về đoạn hợp lệ — danh sách ngắn đi thì không đứng ở trang không còn. */
export const clampPage = (page: number, total: number, size = PAGE_SIZE_LIST) =>
  Math.min(Math.max(1, page), Math.max(1, Math.ceil(total / size)));

/**
 * Cắt danh sách theo trang. `resetKey` đổi (bộ lọc, tìm kiếm, tab, tháng…) thì về trang 1.
 * Dùng: const pg = usePagination(filtered, PAGE_SIZE_TABLE, [query, status]);
 *       pg.rows.map(...)   <Pagination {...pg} noun="nhân sự" />
 */
export function usePagination<T>(items: readonly T[], size = PAGE_SIZE_LIST, resetKey: readonly unknown[] = []) {
  const [requested, setPage] = useState(1);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setPage(1), resetKey);
  const page = clampPage(requested, items.length, size);
  const rows = useMemo(() => items.slice((page - 1) * size, page * size), [items, page, size]);
  return { page, setPage, rows, total: items.length, size };
}

interface PaginationProps {
  page: number;
  total: number;
  size?: number;
  /** Chữ sau tổng số: "người", "đơn", "dòng"… */
  noun?: string;
  setPage: (page: number) => void;
  className?: string;
}

/** Thanh phân trang dùng chung cho mọi danh sách và bảng: "21–40 / 95 người   ‹ Trước  2 / 5  Sau ›". Một trang thì không hiện. */
export function Pagination({ page, total, size = PAGE_SIZE_LIST, noun = 'dòng', setPage, className = '' }: PaginationProps) {
  const pageCount = Math.max(1, Math.ceil(total / size));
  if (total <= size) return null;
  const from = (page - 1) * size + 1;
  const to = Math.min(page * size, total);
  const step = 'inline-flex min-h-9 items-center gap-1 rounded-none border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 text-sm font-semibold text-slate-800 dark:text-slate-200 transition hover:bg-slate-100 dark:hover:bg-slate-700 disabled:pointer-events-none disabled:opacity-40';
  return (
    <nav className={`flex flex-wrap items-center justify-between gap-2 pt-3 no-print ${className}`} aria-label={`Phân trang ${noun}`}>
      <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{from}–{to} / {total} {noun}</span>
      <div className="flex items-center gap-2">
        <button type="button" className={step} disabled={page <= 1} onClick={() => setPage(page - 1)}>
          <ChevronLeft className="h-4 w-4" /> Trước
        </button>
        <span className="min-w-[4rem] text-center text-sm font-bold tabular-nums text-slate-900 dark:text-slate-100">{page} / {pageCount}</span>
        <button type="button" className={step} disabled={page >= pageCount} onClick={() => setPage(page + 1)}>
          Sau <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </nav>
  );
}
