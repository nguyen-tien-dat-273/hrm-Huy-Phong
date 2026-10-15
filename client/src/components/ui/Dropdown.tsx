// ============================================================================
// Dropdown dùng chung — cùng một giao diện cho mọi danh sách chọn.
// ----------------------------------------------------------------------------
// - Ô chọn giống ô nhập (cao, bo góc, viền) để các form đồng đều.
// - Danh sách mở ra có chiều cao tối đa cố định, dài thì cuộn trong khung.
// - Danh sách nhiều giá trị (mặc định > 7) có ô gõ để lọc (không dấu cũng được);
//   ít giá trị thì chỉ bấm chọn, không cần ô gõ.
// - Danh sách vẽ qua portal nên không bị cắt bởi khung cuộn của hộp thoại.
// ============================================================================

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Search } from 'lucide-react';

export interface DropdownOption {
  value: string;
  label: string;
  /** Chữ phụ nhỏ, căn phải trong danh sách (ví dụ giá trị hiện tại). */
  detail?: string;
}

interface DropdownProps {
  options: readonly DropdownOption[];
  value: string;
  onChange: (value: string) => void;
  label?: string;
  error?: string;
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
  /** Bật ô gõ lọc. Bỏ trống: tự bật khi có hơn SEARCH_THRESHOLD giá trị. */
  searchable?: boolean;
  /** Cỡ gọn cho ô trong bảng. */
  compact?: boolean;
  'aria-label'?: string;
  className?: string;
}

export const SEARCH_THRESHOLD = 7;

const fold = (text: string) => text
  .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd')
  .toLowerCase().trim();

interface Box { left: number; width: number; top?: number; bottom?: number; maxHeight: number }

export function Dropdown({
  options, value, onChange, label, error, required, disabled = false, placeholder = 'Chọn…',
  searchable, compact = false, className = '', ...rest
}: DropdownProps) {
  const id = useId();
  const listId = `${id}-list`;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [box, setBox] = useState<Box | null>(null);

  const withSearch = searchable ?? options.length > SEARCH_THRESHOLD;
  const selected = options.find((option) => option.value === value);

  const filtered = useMemo(() => {
    const keyword = fold(query);
    return keyword ? options.filter((option) => fold(option.label).includes(keyword)) : [...options];
  }, [options, query]);

  const place = () => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const below = window.innerHeight - rect.bottom - 12;
    const above = rect.top - 12;
    const wanted = withSearch ? 340 : 260;
    const openUp = below < Math.min(wanted, 220) && above > below;
    setBox({
      left: Math.max(8, Math.min(rect.left, window.innerWidth - Math.max(rect.width, 220) - 8)),
      width: Math.max(rect.width, 220),
      maxHeight: Math.max(160, Math.min(wanted, openUp ? above : below)),
      ...(openUp ? { bottom: window.innerHeight - rect.top + 4 } : { top: rect.bottom + 4 }),
    });
  };

  const close = (refocus = false) => {
    setOpen(false);
    setQuery('');
    if (refocus) triggerRef.current?.focus();
  };

  const openList = () => {
    if (disabled) return;
    const index = options.findIndex((option) => option.value === value);
    setActive(Math.max(index, 0));
    setOpen(true);
  };

  useLayoutEffect(() => {
    if (!open) return undefined;
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      close();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  useEffect(() => {
    if (!open || !box) return;
    if (withSearch) searchRef.current?.focus();
    else panelRef.current?.focus({ preventScroll: true });
  }, [open, withSearch, box === null]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    panelRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active, open, filtered.length]);

  const pick = (option: DropdownOption) => {
    onChange(option.value);
    close(true);
  };

  const onListKey = (event: KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((current) => Math.min(current + 1, Math.max(filtered.length - 1, 0)));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((current) => Math.max(current - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const option = filtered[Math.min(active, filtered.length - 1)];
      if (option) pick(option);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      // Hộp thoại chứa ô này cũng nghe phím Esc — chỉ đóng danh sách, không đóng cả hộp.
      event.nativeEvent.stopPropagation();
      close(true);
    } else if (event.key === 'Tab') {
      close();
    }
  };

  const triggerClass = compact
    ? 'h-9 rounded-lg px-2.5 focus:ring-2 focus:ring-indigo-500/15'
    : 'h-11 rounded-xl px-3.5 shadow-sm focus:ring-4 focus:ring-indigo-500/10';

  return (
    <div className={`w-full ${className}`}>
      {label && (
        <label htmlFor={id} className="mb-1.5 block text-sm font-semibold text-slate-700">
          {label}{required && <span className="ml-1 text-red-500" aria-hidden="true">*</span>}
        </label>
      )}
      <button
        ref={triggerRef}
        id={id}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={rest['aria-label']}
        aria-invalid={!!error}
        onClick={() => (open ? close() : openList())}
        onKeyDown={(event) => {
          if (open) return;
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); openList(); }
        }}
        className={`flex w-full items-center justify-between gap-2 border bg-white text-left text-sm text-slate-900 transition-all hover:border-slate-300 focus:border-indigo-500 focus:outline-none disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500 ${triggerClass} ${
          error ? 'border-red-400' : open ? 'border-indigo-500' : 'border-slate-200'
        }`}
      >
        <span className={`min-w-0 flex-1 truncate ${selected ? '' : 'text-slate-400'}`}>{selected?.label ?? placeholder}</span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {error && <p role="alert" className="mt-1.5 text-xs font-medium text-red-600">{error}</p>}

      {open && box && createPortal(
        <div
          ref={panelRef}
          style={{ position: 'fixed', left: box.left, width: box.width, top: box.top, bottom: box.bottom, maxHeight: box.maxHeight }}
          tabIndex={-1}
          className="z-[70] flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl shadow-slate-900/10 outline-none"
          onKeyDown={onListKey}
        >
          {withSearch && (
            <div className="relative shrink-0 border-b border-slate-100 p-2">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                ref={searchRef}
                value={query}
                onChange={(event) => { setQuery(event.target.value); setActive(0); }}
                placeholder="Gõ để lọc…"
                aria-label="Lọc danh sách"
                className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50/60 pl-8 pr-2 text-sm outline-none focus:border-indigo-500 focus:bg-white"
              />
            </div>
          )}
          <ul
            id={listId}
            role="listbox"
            className="min-h-0 flex-1 overflow-y-auto py-1 outline-none"
          >
            {filtered.length === 0 ? (
              <li className="px-3 py-3 text-center text-xs text-slate-500">Không có gì khớp “{query.trim()}”.</li>
            ) : filtered.map((option, index) => {
              const isSelected = option.value === value;
              const isActive = index === Math.min(active, filtered.length - 1);
              return (
                <li
                  key={option.value || '__empty'}
                  role="option"
                  aria-selected={isSelected}
                  data-active={isActive}
                  onMouseDown={(event) => { event.preventDefault(); pick(option); }}
                  onMouseEnter={() => setActive(index)}
                  className={`flex cursor-pointer items-center gap-2 px-3 py-2 text-sm ${
                    isActive ? 'bg-indigo-50' : ''
                  } ${isSelected ? 'font-semibold text-indigo-700' : 'text-slate-800'}`}
                >
                  <span className="min-w-0 flex-1 truncate">{option.label}</span>
                  {option.detail && <span className="shrink-0 text-xs tabular-nums text-slate-400">{option.detail}</span>}
                  {isSelected && <Check className="h-3.5 w-3.5 shrink-0 text-indigo-600" />}
                </li>
              );
            })}
          </ul>
        </div>,
        document.body,
      )}
    </div>
  );
}
