// Phân trang gọn cho danh sách đầu mục: "‹ Trước  1 / 3  Sau ›".
import { useEffect, useRef, type ReactNode, type TouchEvent } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export const ITEMS_PER_PAGE = 10;

/** Kẹp số trang về đoạn hợp lệ — danh sách ngắn đi thì không đứng ở trang không còn. */
export const clampPage = (page: number, total: number, size = ITEMS_PER_PAGE) =>
  Math.min(Math.max(1, page), Math.max(1, Math.ceil(total / size)));

export function Pager({
  page, total, size = ITEMS_PER_PAGE, noun = 'đầu mục', onPage,
}: {
  page: number;
  total: number;
  size?: number;
  /** Chữ sau tổng số: "đầu mục", "người"… */
  noun?: string;
  onPage: (page: number) => void;
}) {
  const pageCount = Math.max(1, Math.ceil(total / size));
  if (total <= size) return null;
  const from = (page - 1) * size + 1;
  const to = Math.min(page * size, total);
  const step = 'inline-flex h-9 items-center gap-1 rounded-none border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 transition hover:border-indigo-300 hover:text-indigo-700 disabled:pointer-events-none disabled:opacity-40';
  return (
    <nav className="flex flex-wrap items-center justify-between gap-2 pt-1 no-print" aria-label={`Phân trang ${noun}`}>
      <span className="text-xs text-slate-500">{from}–{to} / {total} {noun}</span>
      <div className="flex items-center gap-2">
        <button type="button" className={step} disabled={page <= 1} onClick={() => onPage(page - 1)}>
          <ChevronLeft className="h-3.5 w-3.5" /> Trước
        </button>
        <span className="min-w-[3.5rem] text-center text-xs font-bold tabular-nums text-slate-700">{page} / {pageCount}</span>
        <button type="button" className={step} disabled={page >= pageCount} onClick={() => onPage(page + 1)}>
          Sau <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </nav>
  );
}

/**
 * Khung danh sách có nút sang trang hai bên và lướt ngang để sang trang
 * (vuốt trên màn cảm ứng, hoặc hai ngón vuốt ngang trên bàn di chuột).
 */
export function PagedList({
  page, total, size = ITEMS_PER_PAGE, onPage, children,
}: {
  page: number;
  total: number;
  size?: number;
  onPage: (page: number) => void;
  children: ReactNode;
}) {
  const pageCount = Math.max(1, Math.ceil(total / size));
  const boxRef = useRef<HTMLDivElement>(null);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const latest = useRef({ page, pageCount, onPage });
  latest.current = { page, pageCount, onPage };

  // Bàn di chuột: cuộn ngang đủ xa thì sang trang, mỗi cú vuốt chỉ sang một trang.
  useEffect(() => {
    const box = boxRef.current;
    if (!box || pageCount <= 1) return undefined;
    let accumulated = 0;
    let lockedUntil = 0;
    let idle: number | undefined;
    const onWheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;
      event.preventDefault();
      const now = Date.now();
      if (now < lockedUntil) return;
      accumulated += event.deltaX;
      window.clearTimeout(idle);
      idle = window.setTimeout(() => { accumulated = 0; }, 180);
      if (Math.abs(accumulated) < 70) return;
      const { page: current, pageCount: count, onPage: go } = latest.current;
      const next = accumulated > 0 ? current + 1 : current - 1;
      accumulated = 0;
      lockedUntil = now + 500;
      if (next >= 1 && next <= count) go(next);
    };
    box.addEventListener('wheel', onWheel, { passive: false });
    return () => { box.removeEventListener('wheel', onWheel); window.clearTimeout(idle); };
  }, [pageCount]);

  if (pageCount <= 1) return <div className="min-w-0 space-y-2">{children}</div>;

  const onTouchStart = (event: TouchEvent) => {
    const point = event.touches[0];
    touch.current = { x: point.clientX, y: point.clientY };
  };
  const onTouchEnd = (event: TouchEvent) => {
    const start = touch.current;
    touch.current = null;
    if (!start) return;
    const point = event.changedTouches[0];
    const dx = point.clientX - start.x;
    const dy = point.clientY - start.y;
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    const next = dx < 0 ? page + 1 : page - 1;
    if (next >= 1 && next <= pageCount) onPage(next);
  };

  const side = 'sticky top-[42vh] flex h-8 w-8 items-center justify-center self-start rounded-full border border-slate-200 bg-white text-slate-500 shadow-sm transition hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-600 disabled:pointer-events-none disabled:opacity-30 no-print';
  return (
    <div
      ref={boxRef}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      className="grid grid-cols-[2rem_minmax(0,1fr)_2rem] gap-3"
    >
      <button type="button" className={side} disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Trang trước" title="Trang trước">
        <ChevronLeft className="h-4 w-4" />
      </button>
      <div className="min-w-0 space-y-2">{children}</div>
      <button type="button" className={side} disabled={page >= pageCount} onClick={() => onPage(page + 1)} aria-label="Trang sau" title="Trang sau">
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}
