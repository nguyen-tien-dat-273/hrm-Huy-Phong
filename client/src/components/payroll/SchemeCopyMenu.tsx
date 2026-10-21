// Nút "Copy từ": chọn một bộ cơ chế mẫu hoặc một nhân viên để chép toàn bộ dòng
// của họ sang cơ chế đang soạn. Chưa lưu cho tới khi bấm Lưu.

import { useMemo, useState } from 'react';
import { ChevronDown, Copy, Search } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { normalizeText } from '@/lib/formulaTokens';
import type { PayScheme, Profile } from '@/types';

interface SchemeCopyMenuProps {
  templates: readonly PayScheme[];
  /** Nhân viên đã có cơ chế (không gồm chính người đang soạn). */
  people: readonly Profile[];
  disabled?: boolean;
  onPickTemplate: (scheme: PayScheme) => void;
  onPickPerson: (person: Profile) => void;
}

const MAX_PEOPLE = 40;

export function SchemeCopyMenu({ templates, people, disabled, onPickTemplate, onPickPerson }: SchemeCopyMenuProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const keyword = normalizeText(query);
  const shownTemplates = useMemo(
    () => templates.filter((scheme) => !keyword || normalizeText(scheme.name).includes(keyword)),
    [keyword, templates],
  );
  const matchedPeople = useMemo(
    () => people.filter((person) => !keyword
      || normalizeText(person.name).includes(keyword)
      || normalizeText(person.employee_code ?? '').includes(keyword)),
    [keyword, people],
  );

  const close = () => { setOpen(false); setQuery(''); };
  const empty = shownTemplates.length === 0 && matchedPeople.length === 0;

  return (
    <div className="relative">
      <Button size="sm" variant="outline" disabled={disabled} onClick={() => setOpen((value) => !value)} aria-haspopup="listbox" aria-expanded={open}>
        <Copy className="h-4 w-4" /> Copy từ <ChevronDown className="h-3.5 w-3.5" />
      </Button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onMouseDown={close} aria-hidden />
          <div className="absolute right-0 top-full z-50 mt-1 w-[min(20rem,90vw)] rounded-xl border border-slate-200 bg-white p-2 shadow-xl shadow-slate-900/10 dark:border-slate-700 dark:bg-slate-900">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Escape') close(); }}
                placeholder="Tìm bộ mẫu hoặc nhân viên…"
                aria-label="Tìm nơi để copy cơ chế"
                className="h-9 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 dark:border-slate-700 dark:bg-slate-800"
              />
            </div>
            <div className="mt-2 max-h-72 overflow-y-auto" role="listbox">
              {shownTemplates.length > 0 && (
                <>
                  <p className="px-2 pb-1 pt-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">Bộ cơ chế mẫu</p>
                  {shownTemplates.map((scheme) => (
                    <button
                      key={scheme.id}
                      type="button"
                      role="option"
                      aria-selected={false}
                      onClick={() => { close(); onPickTemplate(scheme); }}
                      className="block w-full truncate rounded-lg px-2 py-1.5 text-left text-sm font-semibold text-slate-800 hover:bg-indigo-50 dark:text-slate-100 dark:hover:bg-slate-800"
                    >
                      {scheme.name}
                    </button>
                  ))}
                </>
              )}
              {matchedPeople.length > 0 && (
                <>
                  <p className="px-2 pb-1 pt-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">Nhân viên</p>
                  {matchedPeople.slice(0, MAX_PEOPLE).map((person) => (
                    <button
                      key={person.id}
                      type="button"
                      role="option"
                      aria-selected={false}
                      onClick={() => { close(); onPickPerson(person); }}
                      className="flex w-full items-baseline gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-indigo-50 dark:hover:bg-slate-800"
                    >
                      <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{person.name}</span>
                      <span className="shrink-0 text-[11px] text-slate-400">{person.employee_code ?? ''}</span>
                    </button>
                  ))}
                  {matchedPeople.length > MAX_PEOPLE && (
                    <p className="px-2 py-1 text-xs text-slate-400">Còn {matchedPeople.length - MAX_PEOPLE} người — gõ tên để lọc.</p>
                  )}
                </>
              )}
              {empty && <p className="px-2 py-4 text-center text-sm text-slate-500">Không có gì khớp.</p>}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
