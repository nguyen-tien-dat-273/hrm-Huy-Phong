import { type ReactNode, useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl';
  /** Vuông góc (module Lương); mặc định bo góc. */
  square?: boolean;
}

export function Modal({ open, onClose, title, children, size = 'md', square = false }: ModalProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (open) {
      const previouslyFocused = document.activeElement as HTMLElement | null;
      const previousOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      const onKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape') onCloseRef.current();
        if (e.key === 'Tab' && panelRef.current) {
          const focusable = Array.from(panelRef.current.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')).filter((element) => !element.hasAttribute('disabled'));
          if (focusable.length === 0) return;
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
          else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
      };
      window.addEventListener('keydown', onKey);
      const focusFrame = requestAnimationFrame(() => panelRef.current?.querySelector<HTMLElement>('input, select, textarea, button')?.focus());
      return () => {
        cancelAnimationFrame(focusFrame);
        document.body.style.overflow = previousOverflow;
        window.removeEventListener('keydown', onKey);
        previouslyFocused?.focus();
      };
    }
  }, [open]);

  if (!open) return null;

  const sizes = {
    sm: 'max-w-md',
    md: 'max-w-lg',
    lg: 'max-w-2xl',
    xl: 'max-w-4xl',
    '2xl': 'max-w-6xl',
  };

  return (
    // Trên điện thoại: bám đáy, bo góc trên, cao tối đa 92vh — kiểu bottom
    // sheet quen thuộc, ngón cái với tới nút bấm dễ hơn hộp nổi giữa màn hình.
    // Từ sm trở lên: giữ nguyên hộp căn giữa như cũ.
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4" role="presentation">
      <div
        className="absolute inset-0 bg-slate-950/60 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`modal-in relative bg-white dark:bg-slate-900 shadow-2xl ring-1 ring-slate-900/5 dark:ring-white/10 w-full flex flex-col overflow-hidden
          ${square ? 'max-h-[92vh] sm:max-h-[90vh]' : 'rounded-t-3xl max-h-[92vh] sm:rounded-3xl sm:max-h-[90vh]'} ${sizes[size]}`}
      >
        {/* Thanh kéo — tín hiệu quen thuộc cho biết tấm này đóng được. */}
        <div className="sm:hidden flex justify-center pt-2.5 pb-1" aria-hidden="true">
          <span className="w-10 h-1 rounded-full bg-slate-300 dark:bg-slate-600" />
        </div>

        <div className="flex items-center justify-between px-5 sm:px-6 py-3.5 sm:py-4.5 border-b border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900">
          <h2 id={titleId} className="font-display text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className={`flex h-11 w-11 items-center justify-center ${square ? '' : 'rounded-xl'} text-slate-400 transition-colors hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-600 dark:hover:text-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500`}
            aria-label="Đóng"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="overflow-y-auto p-5 sm:p-6 safe-bottom sm:pb-6">
          {children}
        </div>
      </div>
    </div>
  );
}
