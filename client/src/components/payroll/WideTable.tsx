// ============================================================================
// Khung cho bảng rộng nhiều cột (Bảng lương):
// • Nút lướt trái/phải mỗi lần đúng 3 cột — cột Nhân sự đứng yên.
// • Phóng to ra toàn màn hình / thu nhỏ về chỗ cũ (Esc để thu nhỏ).
// ----------------------------------------------------------------------------
// Toàn màn hình vẽ qua portal ra <body>: trang nằm trong khung có hiệu ứng
// transform (page-fade-in) nên `fixed` lồng bên trong không phủ đúng màn hình.
// Hộp thoại (z-50) và ô chọn (z-70) vẫn nổi trên lớp toàn màn hình (z-45).
// ============================================================================

import { useCallback, useEffect, useRef, useState, type DependencyList, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, Maximize2, Minimize2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';

/** Độ rộng cột Nhân sự cố định ở mép trái — nút lướt trái đặt ngay sau nó. */
/** Độ rộng 3 cột cố định (STT + Mã NV + Nhân sự) ở mép trái — nút lướt trái đặt ngay sau nó. */
export const STICKY_COL_WIDTH = 280;

export function useColumnScroll(deps: DependencyList) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState({ left: false, right: false });
  const updateEdge = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const left = el.scrollLeft > 1;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    // Sự kiện scroll bắn hàng chục lần mỗi giây. Trả lại đúng object cũ khi mép
    // không đổi để React bỏ qua — nếu không, mỗi lần cuộn là vẽ lại cả bảng.
    setEdge((prev) => (prev.left === left && prev.right === right ? prev : { left, right }));
  }, []);
  useEffect(() => {
    updateEdge();
    const el = scrollRef.current;
    if (!el) return undefined;
    const observer = new ResizeObserver(updateEdge);
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    return () => observer.disconnect();
  }, [updateEdge, ...deps]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Nhảy đúng 3 cột mỗi lần bấm; các cột cố định đứng yên nên không tính vào. */
  const scrollColumns = (direction: 1 | -1) => {
    const el = scrollRef.current;
    if (!el) return;
    const heads = Array.from(el.querySelectorAll<HTMLElement>('thead th'));
    const stickyHeads = heads.filter((head) => head.className.includes('sticky') && (head.className.includes('left-') || head.className.includes('left-[')));
    const sticky = stickyHeads.length > 0
      ? stickyHeads.reduce((acc, head) => acc + head.offsetWidth, 0)
      : (heads[0]?.offsetWidth ?? 0);
    const cols = heads.filter((head) => !stickyHeads.includes(head) && !head.classList.contains('no-print'));
    if (cols.length === 0) return;
    const visibleLeft = el.scrollLeft + sticky;
    const first = Math.max(0, cols.findIndex((head) => head.offsetLeft + head.offsetWidth > visibleLeft + 1));
    const next = Math.min(cols.length - 1, Math.max(0, first + direction * 3));
    el.scrollTo({ left: Math.max(0, cols[next].offsetLeft - sticky), behavior: 'smooth' });
  };

  return { scrollRef, edge, updateEdge, scrollColumns };
}

const ARROW_CLASS = 'no-print absolute top-1/2 z-40 inline-flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-slate-300 dark:border-slate-600 bg-white/95 dark:bg-slate-800/95 text-slate-800 dark:text-slate-100 shadow-lg transition hover:bg-slate-50 dark:hover:bg-slate-700 hover:text-indigo-700 dark:hover:text-indigo-400';

export function ScrollArrows({
  edge,
  onScroll,
  stickyWidth = STICKY_COL_WIDTH,
}: {
  edge: { left: boolean; right: boolean };
  onScroll: (direction: 1 | -1) => void;
  stickyWidth?: number;
}) {
  return (
    <>
      {edge.left && (
        <button
          type="button"
          onClick={() => onScroll(-1)}
          title="Về trái 3 cột"
          aria-label="Cuộn bảng về trái 3 cột"
          className={ARROW_CLASS}
          style={{ left: stickyWidth + 8 }}
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
      )}
      {edge.right && (
        <button
          type="button"
          onClick={() => onScroll(1)}
          title="Sang phải 3 cột"
          aria-label="Cuộn bảng sang phải 3 cột"
          className={`${ARROW_CLASS} right-3`}
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      )}
    </>
  );
}

export function FullscreenToggle({ full, onToggle, square = false, className = '' }: { full: boolean; onToggle: () => void; square?: boolean; className?: string }) {
  return (
    <Button
      variant="outline"
      size={square ? 'xs' : 'sm'}
      square={square}
      onClick={onToggle}
      title={full ? 'Thu nhỏ về trang (Esc)' : 'Phóng to toàn màn hình'}
      aria-label={full ? 'Thu nhỏ bảng' : 'Phóng to bảng toàn màn hình'}
      className={`no-print ${square ? '!min-h-0 !h-8 !w-8' : 'h-10 w-10'} p-0 shrink-0 border-slate-300 dark:border-slate-700 ${className}`}
    >
      {full ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
    </Button>
  );
}

/** Vỏ thẻ của bảng: thường là Card, toàn màn hình thì giãn kín khung. */
export function TableShell({ full, children }: { full: boolean; children: ReactNode }) {
  return (
    <div className={full
      ? 'flex min-h-0 flex-1 flex-col bg-white dark:bg-slate-900'
      : 'min-w-0 rounded-none border-2 border-slate-400 dark:border-slate-600 bg-white dark:bg-slate-900 shadow-md'}
    >
      {children}
    </div>
  );
}

/** Khung cuộn của bảng: thường cao theo màn hình, toàn màn hình thì lấp phần còn lại. */
export const scrollAreaClass = (full: boolean) => (full
  ? 'min-h-0 flex-1 overflow-auto'
  : 'max-h-[calc(100vh-13rem)] min-h-[320px] overflow-auto');

/**
 * Bình thường vẽ tại chỗ; `full` thì phủ kín màn hình. Esc để thu nhỏ — trừ
 * khi đang có hộp thoại mở (Esc khi đó là để đóng hộp thoại).
 */
export function FullscreenPanel({ full, onExit, children }: { full: boolean; onExit: () => void; children: ReactNode }) {
  useEffect(() => {
    if (!full) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || document.querySelector('[role="dialog"]')) return;
      onExit();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener('keydown', onKey);
    };
  }, [full, onExit]);

  if (!full) return <>{children}</>;
  return createPortal(
    <div className="fixed inset-0 z-[45] flex flex-col overflow-hidden bg-white dark:bg-slate-900" role="region" aria-label="Bảng toàn màn hình">
      {children}
    </div>,
    document.body,
  );
}
