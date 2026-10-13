import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { TriangleAlert, Info } from 'lucide-react';
import { Button } from '@/components/ui/Button';

// ============================================================================
// Hộp thoại xác nhận thay cho `window.confirm`.
// ----------------------------------------------------------------------------
// `confirm()` mặc định của trình duyệt khóa cứng cả tab, không style được, và
// trông lạc lõng giữa giao diện còn lại. Provider này cho API tương đương nhưng
// trả về Promise, nên chỗ gọi gần như không phải sửa gì:
//
//   if (!(await confirm({ title: '...', message: '...' }))) return;
// ============================================================================

interface ConfirmOptions {
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Tô đỏ nút xác nhận cho hành động phá hủy (xóa, hủy bỏ). */
  danger?: boolean;
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | undefined>(undefined);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolverRef = useRef<((value: boolean) => void) | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  const confirm = useCallback<ConfirmFn>((opts) => {
    setOptions(opts);
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
    });
  }, []);

  const settle = (value: boolean) => {
    resolverRef.current?.(value);
    resolverRef.current = null;
    setOptions(null);
  };

  useEffect(() => {
    if (!options) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(() => cancelRef.current?.focus());

    return () => {
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, [options]);

  const handleDialogKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      settle(false);
      return;
    }
    if (event.key !== 'Tab') return;

    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    if (!focusable?.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const danger = options?.danger ?? false;

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}

      {options && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={options.message ? descriptionId : undefined}
          onKeyDown={handleDialogKeyDown}
        >
          <div className="absolute inset-0 bg-slate-950/60 backdrop-blur-[2px]" onClick={() => settle(false)} />

          <div ref={dialogRef} className="modal-in relative bg-white rounded-3xl shadow-2xl ring-1 ring-slate-900/5 w-full max-w-md overflow-hidden">
            <div className="p-6">
              <div className="flex items-start gap-4">
                <div
                  className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 ${
                    danger ? 'bg-red-50 text-red-600' : 'bg-indigo-50 text-indigo-600'
                  }`}
                >
                  {danger ? <TriangleAlert className="w-5 h-5" /> : <Info className="w-5 h-5" />}
                </div>
                <div className="min-w-0 pt-0.5">
                  <h2 id={titleId} className="font-display text-lg font-bold tracking-tight text-slate-900">{options.title}</h2>
                  {options.message && (
                    <div id={descriptionId} className="text-sm text-slate-500 mt-1.5 leading-relaxed">{options.message}</div>
                  )}
                </div>
              </div>
            </div>

            <div className="flex gap-3 px-6 py-4 bg-slate-50 border-t border-slate-100">
              <Button ref={cancelRef} type="button" variant="outline" onClick={() => settle(false)} className="flex-1">
                {options.cancelLabel ?? 'Hủy'}
              </Button>
              <button
                type="button"
                onClick={() => settle(true)}
                className={`flex-1 h-11 rounded-xl text-sm font-semibold text-white shadow-sm transition-all active:translate-y-px ${
                  danger
                    ? 'bg-red-600 hover:bg-red-700'
                    : 'bg-indigo-600 hover:bg-indigo-700'
                }`}
              >
                {options.confirmLabel ?? (danger ? 'Xóa' : 'Đồng ý')}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm must be used within ConfirmProvider');
  return ctx;
}
