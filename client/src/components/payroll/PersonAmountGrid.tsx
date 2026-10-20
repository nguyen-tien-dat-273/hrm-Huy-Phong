// ============================================================================
// Mức riêng từng người — một bảng kiểu Excel cho cả đơn vị.
// ----------------------------------------------------------------------------
// Hàng là người, cột là các dòng cơ chế "Khai riêng" (mỗi người một mức) hoặc
// dòng công thức có đọc mức riêng. Điền thẳng vào ô, hoặc dán một vùng chép từ
// Excel (ô đang chọn là góc trên-trái). Ô bỏ trống = theo mức chung, chữ xám là
// mức chung đó; ô tô vàng là dòng bắt buộc khai mà người chưa có.
//
// Lưu ghi lại TOÀN BỘ khai riêng của từng người có thay đổi (qua
// `save_payroll_scheme`), các khai riêng khác của người giữ nguyên. Người đang
// khai riêng bằng công thức ở một ô thì ô đó chỉ xem — sửa ở form của người.
// ============================================================================

import { useEffect, useMemo, useState, type ClipboardEvent, type KeyboardEvent } from 'react';
import { Save, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/contexts/ToastContext';
import { getTodayString } from '@/lib/utils';
import type { MechanismRow } from '@/lib/payroll';
import { referencedCodes } from '@/lib/formulaTokens';
import { OWN_AMOUNT_CODE } from '@/lib/payrollVariables';
import { firstEditableMonth } from '@/lib/payrollSettings';
import { earliestSchemeMonth, personalItemsAt, resolveSharedRows } from '@/lib/payrollScheme';
import { schemeSourceOf } from '@/lib/payrollRun';
import { saveScheme, type PayrollWorkspace } from '@/lib/payrollData';
import { monthEndOf, monthText } from '@/components/payroll/schemeWorkbench';
import type { PayComponent, Profile, SchemePayloadItem } from '@/types';

interface PersonAmountGridProps {
  data: PayrollWorkspace;
  people: readonly Profile[];
  monthStart: string;
  lastClosedMonth: string | null;
  canManage: boolean;
  onOpenPerson: (id: string) => void;
  onSaved: () => void;
}

const GROUPED = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 6 });

/** Dòng cần khai mức riêng: "Khai riêng", hoặc công thức có đọc mức riêng. */
const takesOwnAmount = (row: MechanismRow) => row.mode === 'PER_PERSON'
  || (row.mode === 'FORMULA' && referencedCodes(row.formula).includes(OWN_AMOUNT_CODE));

/** Ô chép từ Excel / gõ tay: "10.000.000", "10,000,000", "10000000", "1,5". */
function parseCell(text: string): number | null {
  const trimmed = text.trim().replace(/\s|đ|VND/gi, '');
  if (!trimmed) return null;
  let normalized = trimmed;
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(trimmed)) normalized = trimmed.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(trimmed)) normalized = trimmed.replace(/,/g, '');
  else normalized = trimmed.replace(',', '.');
  const value = Number(normalized);
  return Number.isFinite(value) ? value : Number.NaN;
}

const cellText = (value: number | null) => (value == null ? '' : GROUPED.format(value));
const keyOf = (personId: string, componentId: string) => `${personId}:${componentId}`;

export function PersonAmountGrid({ data, people, monthStart, lastClosedMonth, canManage, onOpenPerson, onSaved }: PersonAmountGridProps) {
  const { toast } = useToast();
  const source = useMemo(() => schemeSourceOf(data), [data]);
  const firstEditable = firstEditableMonth(lastClosedMonth, getTodayString());

  /** Mỗi người: tháng áp dụng khi lưu, khai riêng đang lưu, dòng cơ chế chung. */
  const sheet = useMemo(() => people.map((person) => {
    const minMonth = earliestSchemeMonth(
      firstEditable,
      data.items.filter((row) => row.user_id === person.id).map((row) => row.effective_from),
    );
    const month = monthStart >= minMonth ? monthStart : minMonth;
    const monthEnd = monthEndOf(month);
    const shared = new Map(resolveSharedRows(person, source, month, monthEnd).map((row) => [row.component.id, row]));
    const saved = personalItemsAt(data.items, person.id, month, monthEnd);
    return { person, month, shared, saved, savedById: new Map(saved.map((item) => [item.component_id, item])) };
  }), [data.items, firstEditable, monthStart, people, source]);

  const columns: PayComponent[] = useMemo(() => {
    const byId = new Map<string, { component: PayComponent; sortOrder: number }>();
    for (const { shared } of sheet) {
      for (const row of shared.values()) {
        if (takesOwnAmount(row) && !byId.has(row.component.id)) byId.set(row.component.id, { component: row.component, sortOrder: row.sortOrder });
      }
    }
    return [...byId.values()].sort((a, b) => a.sortOrder - b.sortOrder).map((entry) => entry.component);
  }, [sheet]);

  /** Ô đang sửa: khoá → chữ trong ô. Chưa có khoá là ô giữ giá trị đã lưu. */
  const [edits, setEdits] = useState<Map<string, string>>(new Map());
  const [saving, setSaving] = useState(false);
  const [active, setActive] = useState<{ row: number; col: number } | null>(null);
  const savedKey = JSON.stringify(sheet.map((entry) => [entry.person.id, entry.saved]));
  useEffect(() => { if (!saving) setEdits(new Map()); }, [savedKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const savedAmountOf = (index: number, componentId: string) => {
    const item = sheet[index].savedById.get(componentId);
    return item && !item.formula ? item.amount : null;
  };
  const hasOwnFormula = (index: number, componentId: string) => !!sheet[index].savedById.get(componentId)?.formula;
  const applies = (index: number, componentId: string) => {
    const row = sheet[index].shared.get(componentId);
    return !!row && takesOwnAmount(row);
  };
  const editable = (index: number, componentId: string) => canManage && applies(index, componentId) && !hasOwnFormula(index, componentId);
  const textAt = (index: number, componentId: string) => edits.get(keyOf(sheet[index].person.id, componentId))
    ?? cellText(savedAmountOf(index, componentId));

  const setCell = (next: Map<string, string>, index: number, componentId: string, text: string) => {
    const key = keyOf(sheet[index].person.id, componentId);
    if (text.trim() === cellText(savedAmountOf(index, componentId)) || parseCell(text) === savedAmountOf(index, componentId)) next.delete(key);
    else next.set(key, text);
  };

  const onType = (index: number, componentId: string, text: string) => {
    const next = new Map(edits);
    setCell(next, index, componentId, text);
    setEdits(next);
  };

  /** Dán một vùng từ Excel: tab ngăn cột, xuống dòng ngăn hàng; ô không sửa được thì bỏ qua. */
  const onPaste = (event: ClipboardEvent<HTMLInputElement>, row: number, col: number) => {
    const text = event.clipboardData.getData('text');
    if (!/[\t\n]/.test(text.trim())) return;
    event.preventDefault();
    const lines = text.replace(/\r/g, '').replace(/\n$/, '').split('\n');
    const next = new Map(edits);
    let skipped = 0;
    lines.forEach((line, dr) => line.split('\t').forEach((value, dc) => {
      const r = row + dr;
      const c = col + dc;
      if (r >= sheet.length || c >= columns.length) { skipped += 1; return; }
      if (!editable(r, columns[c].id)) { if (value.trim()) skipped += 1; return; }
      setCell(next, r, columns[c].id, value);
    }));
    setEdits(next);
    if (skipped > 0) toast(`Đã dán; bỏ qua ${skipped} ô nằm ngoài bảng hoặc không áp cho người đó.`, 'warning');
  };

  const focusCell = (row: number, col: number) => {
    document.getElementById(`pag-${row}-${col}`)?.focus();
  };
  const onKey = (event: KeyboardEvent<HTMLInputElement>, row: number, col: number) => {
    const move: Record<string, [number, number]> = { Enter: [1, 0], ArrowDown: [1, 0], ArrowUp: [-1, 0] };
    const step = move[event.key];
    if (!step) return;
    event.preventDefault();
    focusCell(Math.min(Math.max(row + step[0], 0), sheet.length - 1), col);
  };

  // ---- Kiểm tra & lưu --------------------------------------------------------
  const invalid = [...edits].filter(([, text]) => {
    const value = parseCell(text);
    return value != null && !(value >= 0);
  }).map(([key]) => key);
  const changedPeople = new Set([...edits.keys()].map((key) => key.split(':')[0]));

  const missingCount = sheet.reduce((sum, entry, index) => sum + columns.filter((component) => {
    const row = entry.shared.get(component.id);
    if (!row || row.mode !== 'PER_PERSON' || row.amount != null || hasOwnFormula(index, component.id)) return false;
    return parseCell(textAt(index, component.id)) == null;
  }).length, 0);

  const handleSave = async () => {
    if (invalid.length > 0) { toast('Còn ô không phải số không âm — sửa các ô tô đỏ trước.', 'warning'); return; }
    setSaving(true);
    let done = 0;
    const failed: string[] = [];
    for (const entry of sheet) {
      if (!changedPeople.has(entry.person.id)) continue;
      const items: SchemePayloadItem[] = entry.saved.filter((item) => !edits.has(keyOf(entry.person.id, item.component_id)));
      for (const component of columns) {
        const text = edits.get(keyOf(entry.person.id, component.id));
        if (text === undefined) continue;
        const value = parseCell(text);
        if (value != null) {
          items.push({ component_id: component.id, amount: value, formula: null, note: entry.savedById.get(component.id)?.note ?? null });
        }
      }
      const error = await saveScheme({
        targetType: 'USER', userId: entry.person.id, unitId: null, effectiveFrom: entry.month, items,
      });
      if (error) failed.push(`${entry.person.name}: ${error}`);
      else done += 1;
    }
    setSaving(false);
    if (failed.length > 0) toast(`Lưu được ${done} người, lỗi ${failed.length}: ${failed[0]}`, 'error');
    else toast(`Đã lưu mức riêng của ${done} người.`, 'success');
    setEdits(new Map());
    onSaved();
  };

  if (people.length === 0) {
    return <p className="rounded-none border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">Đơn vị này chưa có nhân sự.</p>;
  }
  if (columns.length === 0) {
    return (
      <p className="rounded-none border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">
        Cơ chế chung chưa có dòng nào cần khai mức riêng cho từng người. Ở thẻ “Cơ chế chung”, chọn
        “Mỗi người một mức” cho dòng cần khai (VD: lương cơ bản, mức trách nhiệm).
      </p>
    );
  }

  const later = sheet.find((entry) => entry.month > monthStart);

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">
        Điền thẳng vào ô hoặc dán cả vùng chép từ Excel. Ô trống là theo mức chung (chữ xám).
        Enter / ↑ ↓ để sang hàng.
        {missingCount > 0 && <span className="ml-1 font-semibold text-rose-700 dark:text-rose-400">Còn {missingCount} ô bắt buộc chưa điền.</span>}
      </p>
      {later && (
        <p className="rounded-none bg-slate-50 px-3 py-2 text-xs text-slate-600">
          Một số người chỉ sửa được từ {monthText(later.month)} (tháng {monthText(monthStart)} đã chốt hoặc đã có bản khai sau đó).
        </p>
      )}
      <div className="overflow-x-auto rounded-xl border-2 border-slate-400 dark:border-slate-600 shadow-sm overflow-hidden">
        <table className="w-full border-collapse text-xs text-slate-900 dark:text-slate-100">
          <thead>
            <tr className="border-b-2 border-[#bf1f2b] dark:border-[#e66a76] bg-[#fdf2f4] dark:bg-[#201114] text-left text-xs font-black uppercase tracking-wider text-[#5c0f16] dark:text-[#fde8ea] shadow-[inset_0_-2px_0_#bf1f2b] dark:shadow-[inset_0_-2px_0_#e66a76]">
              <th className="sticky left-0 z-20 min-w-[145px] max-w-[160px] border-r-2 border-[#eed5d8] dark:border-[#4a1c22] bg-[#fdf2f4] dark:bg-[#201114] px-2.5 py-1.5 font-black text-xs text-[#5c0f16] dark:text-[#fde8ea]">Nhân viên</th>
              {columns.map((component) => (
                <th key={component.id} className="min-w-[85px] max-w-[120px] border-r border-[#eed5d8] dark:border-[#4a1c22] px-2 py-1.5 text-right font-black text-xs text-[#5c0f16] dark:text-[#fde8ea]">
                  {component.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-300 dark:divide-slate-700 bg-white dark:bg-slate-900 font-semibold">
            {sheet.map((entry, row) => (
              <tr key={entry.person.id} className="group transition-colors hover:bg-slate-100/80 dark:hover:bg-slate-800/60">
                <td className="sticky left-0 z-10 border-r-2 border-slate-400 dark:border-slate-600 bg-white dark:bg-slate-900 group-hover:bg-slate-100/80 dark:group-hover:bg-slate-800/80 px-2.5 py-1 shadow-[2px_0_4px_-1px_rgba(0,0,0,0.06)] dark:shadow-[2px_0_4px_-1px_rgba(0,0,0,0.4)]">
                  <button type="button" onClick={() => onOpenPerson(entry.person.id)} className="text-left hover:text-indigo-600 dark:hover:text-indigo-400" title="Mở cơ chế của người này">
                    <span className="block truncate font-black text-slate-900 dark:text-slate-100 text-xs">{entry.person.name}</span>
                    <span className="block truncate text-[10px] font-semibold text-slate-500 dark:text-slate-400">{entry.person.employee_code ?? '—'}</span>
                  </button>
                </td>
                {columns.map((component, col) => {
                  const shared = entry.shared.get(component.id);
                  if (!applies(row, component.id)) {
                    return <td key={component.id} className="border-r border-slate-300 dark:border-slate-700 bg-slate-100/60 dark:bg-slate-800/40 px-2 text-right text-slate-400 dark:text-slate-600 text-xs" title="Không áp cho người này">—</td>;
                  }
                  if (hasOwnFormula(row, component.id)) {
                    return (
                      <td key={component.id} className="border-r border-slate-300 dark:border-slate-700 px-2 text-right text-xs italic text-indigo-600 dark:text-indigo-400 font-bold" title={entry.savedById.get(component.id)?.formula ?? ''}>
                        <button type="button" onClick={() => onOpenPerson(entry.person.id)}>Công thức riêng</button>
                      </td>
                    );
                  }
                  const key = keyOf(entry.person.id, component.id);
                  const text = textAt(row, component.id);
                  const bad = invalid.includes(key);
                  const lacking = shared?.mode === 'PER_PERSON' && shared.amount == null && parseCell(text) == null;
                  const isActive = active?.row === row && active.col === col;
                  return (
                    <td key={component.id} className={`border-r border-slate-300 dark:border-slate-700 p-0 ${
                      bad ? 'bg-red-50 dark:bg-red-950/40' : edits.has(key) ? 'bg-indigo-50/60 dark:bg-indigo-950/40' : lacking ? 'bg-rose-50/70 dark:bg-rose-950/40' : ''
                    } ${isActive ? 'outline outline-2 -outline-offset-2 outline-[#bf1f2b]' : ''}`}>
                      <input
                        id={`pag-${row}-${col}`}
                        value={text}
                        disabled={!canManage}
                        inputMode="decimal"
                        aria-label={`${component.name} của ${entry.person.name}`}
                        placeholder={shared?.amount != null ? cellText(shared.amount) : lacking ? 'Chưa khai' : ''}
                        onFocus={() => setActive({ row, col })}
                        onBlur={() => {
                          setActive(null);
                          const value = parseCell(text);
                          if (value != null && value >= 0 && edits.has(key)) onType(row, component.id, cellText(value));
                        }}
                        onChange={(event) => onType(row, component.id, event.target.value)}
                        onPaste={(event) => onPaste(event, row, col)}
                        onKeyDown={(event) => onKey(event, row, col)}
                        className="h-7 w-full bg-transparent px-2 text-right font-black text-slate-900 dark:text-slate-100 text-xs tabular-nums outline-none placeholder:text-slate-400 dark:placeholder:text-slate-500"
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {edits.size > 0 && canManage && (
        <div className="fixed bottom-0 left-0 right-0 z-30 border-t border-slate-200 bg-white/95 px-4 py-3 shadow-lg backdrop-blur-md print:hidden">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 lg:pl-64">
            <p className={`flex items-center gap-1.5 text-sm ${invalid.length > 0 ? 'text-red-600' : 'text-slate-600'}`}>
              {invalid.length > 0
                ? <><TriangleAlert className="h-4 w-4" /> {invalid.length} ô không hợp lệ</>
                : <><Save className="h-4 w-4" /> {edits.size} ô đã sửa · {changedPeople.size} người — áp dụng từ {monthText(monthStart)}</>}
            </p>
            <div className="flex gap-2">
              <Button variant="secondary" disabled={saving} onClick={() => setEdits(new Map())}>Huỷ thay đổi</Button>
              <Button onClick={() => void handleSave()} disabled={saving || invalid.length > 0}>
                <Save className="h-4 w-4" /> {saving ? 'Đang lưu…' : 'Lưu'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
