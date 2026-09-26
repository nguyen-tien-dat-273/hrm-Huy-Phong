// ============================================================================
// Hộp "Thêm đầu mục" của Cơ chế lương (chung và riêng dùng chung).
// ----------------------------------------------------------------------------
// Cơ chế chỉ hiện những đầu mục ĐÃ thiết lập. Muốn thêm đầu mục thì mở hộp này,
// gõ tên để lọc trong danh mục rồi bấm đầu mục cần thêm. Ở cơ chế chung còn
// tạo được dòng trung gian mới ngay trong hộp.
// ============================================================================

import { useState } from 'react';
import { Plus, Search } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { KindChip } from '@/components/payroll/KindChip';
import { normalizeText } from '@/lib/formulaTokens';
import type { PayComponent } from '@/types';

interface MechanismAddDialogProps {
  open: boolean;
  onClose: () => void;
  /** Đầu mục còn chưa có trong cơ chế. */
  candidates: PayComponent[];
  /** Tên nhóm của đầu mục, để người chọn phân biệt các đầu mục gần giống. */
  groupOf: (component: PayComponent) => string;
  onPick: (component: PayComponent) => void;
  /** Có thì hộp cho tạo dòng trung gian mới (cơ chế chung). */
  onCreateIntermediate?: (name: string) => Promise<boolean>;
}

export function MechanismAddDialog({
  open, onClose, candidates, groupOf, onPick, onCreateIntermediate,
}: MechanismAddDialogProps) {
  const [query, setQuery] = useState('');
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);

  const close = () => { setQuery(''); setNewName(''); onClose(); };
  const keyword = normalizeText(query);
  const shown = candidates.filter((component) => !keyword || normalizeText(component.name).includes(keyword));

  const create = async () => {
    if (!onCreateIntermediate || !newName.trim()) return;
    setBusy(true);
    const ok = await onCreateIntermediate(newName.trim());
    setBusy(false);
    if (ok) close();
  };

  return (
    <Modal square open={open} onClose={close} title="Thêm đầu mục vào cơ chế" size="md">
      <div className="space-y-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Tìm đầu mục theo tên…"
            aria-label="Tìm đầu mục theo tên"
            className="h-10 w-full rounded-none border border-slate-200 pl-9 pr-3 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
          />
        </div>

        {shown.length === 0 ? (
          <p className="rounded-none border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-500">
            {keyword ? `Không có đầu mục nào khớp “${query.trim()}”.` : 'Mọi đầu mục trong danh mục đều đã có trong cơ chế.'}
          </p>
        ) : (
          <ul className="max-h-[50vh] divide-y divide-slate-100 overflow-y-auto rounded-none border border-slate-200">
            {shown.map((component) => (
              <li key={component.id}>
                <button
                  type="button"
                  onClick={() => { onPick(component); close(); }}
                  className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition hover:bg-indigo-50"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-slate-800">{component.name}</span>
                    <span className="block truncate text-[11px] text-slate-400">{groupOf(component)}</span>
                  </span>
                  <KindChip kind={component.kind} />
                  <Plus className="h-4 w-4 shrink-0 text-indigo-500" />
                </button>
              </li>
            ))}
          </ul>
        )}

        {onCreateIntermediate && (
          <form
            className="space-y-2 border-t border-slate-100 pt-3"
            onSubmit={(event) => { event.preventDefault(); void create(); }}
          >
            <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400">Hoặc tạo dòng trung gian mới</p>
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                placeholder="Tên dòng trung gian, VD: Đơn giá ngày"
                aria-label="Tên dòng trung gian"
                disabled={busy}
                className="h-9 min-w-0 flex-1 basis-56 rounded-none border border-slate-200 px-3 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
              />
              <Button size="sm" type="submit" disabled={busy || !newName.trim()}>
                {busy ? 'Đang tạo…' : 'Tạo và thêm'}
              </Button>
            </div>
          </form>
        )}
      </div>
    </Modal>
  );
}
