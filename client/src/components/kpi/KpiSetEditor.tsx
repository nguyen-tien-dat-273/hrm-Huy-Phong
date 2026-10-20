// ============================================================================
// Soạn một bộ KPI — form nằm thẳng trên trang, cạnh cây đơn vị.
// ----------------------------------------------------------------------------
// Nơi áp đã chốt từ chỗ mở form (KPI chung của đơn vị, bộ riêng của một người,
// hoặc bộ mẫu) nên form không cho đổi. Tiêu chí soạn theo hạng mục → tiêu chí
// con; "Chép tiêu chí từ" lấy nguyên danh sách của một bộ khác làm điểm xuất phát.
//
// Không có màn "xem": ở màn người / đơn vị form mở sẵn (`embedded`), sửa rồi
// Lưu. Tiêu chí đã lưu của một bộ không xoá được, cũng không đổi thứ tự — chỉ
// dòng vừa thêm chưa lưu mới bỏ được. Bộ không xoá, chỉ khoá (ngừng áp dụng).
// ============================================================================

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, ChevronDown, ChevronRight, Lock, LockOpen, Plus, Save, Trash2, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Dropdown } from '@/components/ui/Dropdown';
import { Input } from '@/components/ui/Input';
import { useToast } from '@/contexts/ToastContext';
import { useConfirm } from '@/contexts/ConfirmContext';
import {
  GROUP_LABEL, METHOD_LABEL, SOURCE_LABEL, fmtNum, parseNum, setProblems, weightTotals,
  type KpiBlock, type KpiGroup, type KpiLevel, type KpiMethod, type KpiRange, type KpiSet, type KpiSource,
} from '@/lib/kpi';
import { saveSet, type KpiWorkspace, type SetDraftItem } from '@/lib/kpiData';

export type KpiTargetKind = 'PERSON' | 'POSITION' | 'UNIT' | 'TEMPLATE';

export interface KpiSetTarget {
  kind: KpiTargetKind;
  /** user_id / position_id / unit_id; bộ mẫu để null. */
  id: string | null;
  /** Câu hiện ở đầu form, ví dụ "KPI chung · Phòng Kế toán". */
  label: string;
}

interface DraftItem {
  key: string;
  category: string;
  name: string;
  measure: string;
  group_code: KpiGroup;
  weight: string;
  standard_score: string;
  method: KpiMethod;
  levels: Array<{ score: string; label: string }>;
  ranges: Array<{ min: string; max: string; score: string }>;
  value_unit: string;
  penalty_pct: string;
  allow_over: boolean;
  source: KpiSource | '';
  note: string;
  /** Tiêu chí đã có trong bộ đang sửa — không cho xoá. */
  saved: boolean;
}

let keySeq = 0;
const newKey = () => `k${++keySeq}`;

const emptyItem = (category = '', group: KpiGroup = 'QUANT'): DraftItem => ({
  key: newKey(), category, name: '', measure: '', group_code: group, weight: '', standard_score: '4', method: 'LEVEL',
  levels: [{ score: '4', label: '' }, { score: '3', label: '' }, { score: '2', label: '' }, { score: '1', label: '' }],
  ranges: [], value_unit: '', penalty_pct: '', allow_over: false, source: '', note: '', saved: false,
});

const str = (value: number | null | undefined) => (value == null ? '' : String(value));

function toDraftItems(items: KpiWorkspace['setItems'], saved: boolean): DraftItem[] {
  return items.map((item) => ({
    key: newKey(),
    category: item.category,
    name: item.name,
    measure: item.measure ?? '',
    group_code: item.group_code,
    weight: str(item.weight),
    standard_score: str(item.standard_score),
    method: item.method,
    levels: item.levels.map((level) => ({ score: str(level.score), label: level.label })),
    ranges: item.ranges.map((range) => ({ min: str(range.min), max: str(range.max), score: str(range.score) })),
    value_unit: item.value_unit ?? '',
    penalty_pct: str(item.penalty_pct),
    allow_over: item.allow_over,
    source: item.source ?? '',
    note: item.note ?? '',
    saved,
  }));
}

function toPayload(items: DraftItem[]): SetDraftItem[] {
  return items.map((item) => ({
    category: item.category.trim(),
    name: item.name.trim(),
    measure: item.measure.trim() || null,
    group_code: item.group_code,
    weight: parseNum(item.weight) ?? 0,
    standard_score: parseNum(item.standard_score) ?? 4,
    method: item.method,
    levels: item.method === 'LEVEL' || item.method === 'BINARY'
      ? item.levels.filter((level) => level.label.trim() && parseNum(level.score) != null)
        .map((level): KpiLevel => ({ score: parseNum(level.score)!, label: level.label.trim() }))
      : [],
    ranges: item.method === 'RANGE'
      ? item.ranges.filter((range) => parseNum(range.score) != null)
        .map((range): KpiRange => ({ min: parseNum(range.min), max: parseNum(range.max), score: parseNum(range.score)! }))
      : [],
    value_unit: item.value_unit.trim() || null,
    penalty_pct: item.method === 'PENALTY' ? parseNum(item.penalty_pct) : null,
    allow_over: item.allow_over,
    source: item.source || null,
    note: item.note.trim() || null,
  }));
}

const thisMonth = () => new Date().toISOString().slice(0, 7);

export function KpiSetEditor({ data, target, set, copyFrom, defaultName, embedded = false, titleSlot, onToggleLock, onCancel, onSaved }: {
  data: KpiWorkspace;
  target: KpiSetTarget;
  /** Bộ đang sửa; null là bộ mới. */
  set: KpiSet | null;
  /** Bộ mới: lấy sẵn tiêu chí của bộ này (thường là bộ đang thừa hưởng). */
  copyFrom?: KpiSet | null;
  defaultName?: string;
  /** Nằm sẵn trong màn người / đơn vị: không khung, không nút quay lại. */
  embedded?: boolean;
  /** Chỗ trên tiêu đề màn người / đơn vị để đặt ô tên bộ cạnh tên người; bỏ trống thì tên nằm đầu form. */
  titleSlot?: HTMLElement | null;
  /** Khoá / mở khoá bộ đang sửa (nút cạnh tên bộ). */
  onToggleLock?: (set: KpiSet) => void;
  onCancel?: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const itemsOf = (id: string) => data.setItems.filter((item) => item.set_id === id);
  const origin = set ?? copyFrom ?? null;

  const initialItems = () => (origin ? toDraftItems(itemsOf(origin.id), !!set) : [emptyItem('', 'QUANT')]);
  const [name, setName] = useState(set?.name ?? defaultName ?? '');
  const [block, setBlock] = useState<KpiBlock>(origin?.block ?? 'VAN_PHONG');
  const [effectiveFrom, setEffectiveFrom] = useState(set ? set.effective_from.slice(0, 7) : thisMonth());
  const [boardReview, setBoardReview] = useState(origin?.board_review ?? false);
  const [note, setNote] = useState(set?.note ?? '');
  const [baseSetId, setBaseSetId] = useState<string | null>(set ? set.base_set_id : copyFrom?.id ?? null);
  const [items, setItemsRaw] = useState<DraftItem[]>(initialItems);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  // Mọi thay đổi đi qua đây để biết form đã sửa (bật nút Lưu / Hoàn tác).
  const touch = <T,>(setter: (value: T) => void) => (value: T) => { setter(value); setDirty(true); };
  const setItems: typeof setItemsRaw = (next) => { setItemsRaw(next); setDirty(true); };

  const reset = () => {
    setName(set?.name ?? defaultName ?? '');
    setBlock(origin?.block ?? 'VAN_PHONG');
    setEffectiveFrom(set ? set.effective_from.slice(0, 7) : thisMonth());
    setBoardReview(origin?.board_review ?? false);
    setNote(set?.note ?? '');
    setBaseSetId(set ? set.base_set_id : copyFrom?.id ?? null);
    setItemsRaw(initialItems());
    setExpanded(null);
    setDirty(false);
  };

  const updateItem = (key: string, patch: Partial<DraftItem>) =>
    setItems((current) => current.map((item) => (item.key === key ? { ...item, ...patch } : item)));
  const addItem = (category: string, group: KpiGroup) => {
    const item = emptyItem(category, group);
    setItems((current) => {
      const lastIndex = current.map((entry) => entry.category).lastIndexOf(category);
      const next = [...current];
      next.splice(lastIndex >= 0 ? lastIndex + 1 : next.length, 0, item);
      return next;
    });
    setExpanded(item.key);
  };
  const removeItem = (key: string) => setItems((current) => current.filter((item) => item.key !== key));

  const copyCriteria = async (sourceId: string) => {
    const source = data.sets.find((row) => row.id === sourceId);
    if (!source) return;
    const filled = items.some((item) => item.name.trim());
    if (filled && !(await confirm({ title: 'Thay toàn bộ tiêu chí?', message: `Danh sách đang soạn sẽ được thay bằng tiêu chí của “${source.name}”.`, confirmLabel: 'Thay' }))) return;
    // Bộ đã có tiêu chí lưu thì không thay cả danh sách — không thành đường lách để xoá.
    if (items.some((item) => item.saved)) { toast('Bộ đã có tiêu chí lưu, không thay được. Tạo bộ mới để chép.', 'error'); return; }
    setItems(toDraftItems(itemsOf(source.id), false));
    setBaseSetId(source.id);
    setBlock(source.block);
    if (!name.trim()) touch(setName)(source.name);
    setExpanded(null);
  };

  const renameCategory = (oldCategory: string, newCategory: string) => {
    setItems((current) =>
      current.map((item) => (item.category === oldCategory ? { ...item, category: newCategory } : item))
    );
  };
  const removeCategory = (category: string) => {
    setItems((current) => current.filter((item) => item.category !== category));
  };

  const payloadItems = toPayload(items);
  const problems = setProblems(payloadItems);
  const totals = weightTotals(payloadItems);
  const categories = [...new Set(items.map((item) => item.category).filter(Boolean))];

  const handleSave = async () => {
    if (!name.trim()) { toast('Đặt tên bộ KPI.', 'error'); return; }
    // Bộ đang khoá giữ nguyên khoá; bộ mới lưu là áp dụng ngay.
    const activate = set ? set.is_active : true;
    setSaving(true);
    const { error } = await saveSet({
      id: set?.id,
      name: name.trim(),
      block,
      user_id: target.kind === 'PERSON' ? target.id : null,
      position_id: target.kind === 'POSITION' ? target.id : null,
      unit_id: target.kind === 'UNIT' ? target.id : null,
      base_set_id: baseSetId,
      effective_from: `${effectiveFrom}-01`,
      is_active: activate,
      board_review: boardReview,
      note,
    }, payloadItems);
    setSaving(false);
    if (error) { toast(error, 'error'); return; }
    toast(activate ? 'Đã lưu bộ KPI.' : 'Đã lưu. Bộ đang khoá, chưa áp dụng.');
    setDirty(false);
    onSaved();
  };

  // Như bên lương: thanh lưu chỉ hiện khi có thay đổi (bộ mới ngoài màn nhúng thì hiện luôn).
  const showBar = dirty || !embedded;

  const copyOptions = data.sets
    .filter((row) => row.id !== set?.id)
    .map((row) => ({ value: row.id, label: `${row.name}${row.is_active ? '' : ' (chưa áp dụng)'}` }));

  const copyPicker = (
    <div className="w-full sm:w-72">
      <Dropdown compact square searchable aria-label="Chép tiêu chí từ bộ khác" value="" placeholder="Chép tiêu chí từ bộ khác…"
        options={copyOptions} onChange={(value) => void copyCriteria(value)} />
    </div>
  );

  const nameField = (
    <div className="flex min-w-0 items-center gap-1">
      <input
        value={name}
        onChange={(event) => touch(setName)(event.target.value)}
        placeholder="Tên bộ KPI"
        aria-label="Tên bộ KPI"
        className="h-8 min-w-0 flex-1 rounded-none border border-transparent bg-transparent px-1.5 text-sm font-semibold text-indigo-700 outline-none transition hover:border-slate-200 focus:border-indigo-500 focus:bg-white"
      />
      {set && onToggleLock && (
        <IconButton label={set.is_active ? 'Khoá bộ KPI' : 'Mở khoá bộ KPI'} danger={set.is_active} onClick={() => onToggleLock(set)}>
          {set.is_active ? <Lock className="h-3.5 w-3.5" /> : <LockOpen className="h-3.5 w-3.5" />}
        </IconButton>
      )}
    </div>
  );

  const body = (
    <div className="space-y-4">
        {embedded && (titleSlot ? createPortal(nameField, titleSlot) : nameField)}
        <div className="grid items-end gap-3 md:grid-cols-[1fr_1fr_1.4fr_auto]">
          {!embedded && (
            <Input className="!rounded-none" label="Tên bộ" required value={name} onChange={(event) => touch(setName)(event.target.value)}
              placeholder="VD: KPI Phòng Kế toán" autoFocus />
          )}
          <Dropdown compact square searchable={false} label="Khối" value={block}
            options={[{ value: 'VAN_PHONG', label: 'Văn phòng' }, { value: 'KINH_DOANH', label: 'Kinh doanh' }]}
            onChange={(value) => touch(setBlock)(value as KpiBlock)} />
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold text-slate-700">Hiệu lực từ tháng</span>
            <input type="month" value={effectiveFrom} onChange={(event) => touch(setEffectiveFrom)(event.target.value)}
              className="h-9 w-full rounded-none border border-slate-200 bg-white px-2.5 text-xs outline-none focus:border-indigo-500" />
          </label>
          {embedded && copyPicker}
          <label className="flex cursor-pointer items-center gap-2 pb-3 text-sm font-semibold text-slate-700">
            <input type="checkbox" checked={boardReview} onChange={(event) => touch(setBoardReview)(event.target.checked)} className="h-4 w-4 accent-indigo-600" />
            BGĐ duyệt cuối
          </label>
        </div>

        <div className="border-2 border-slate-400 dark:border-slate-600 shadow-sm">
          <div className="hidden grid-cols-[minmax(220px,1fr)_96px_72px_150px_64px_72px] border-b-2 border-slate-400 dark:border-slate-600 bg-slate-100 dark:bg-slate-800 text-xs font-black uppercase tracking-wider text-slate-900 dark:text-slate-100 md:grid">
            <div className="px-3 py-2.5">Tiêu chí</div>
            <div className="border-l border-slate-300 dark:border-slate-700 px-2 py-2.5 text-center">Nhóm</div>
            <div className="border-l border-slate-300 dark:border-slate-700 px-2 py-2.5 text-center">Tỷ trọng %</div>
            <div className="border-l border-slate-300 dark:border-slate-700 px-2 py-2.5 text-center">Cách chấm</div>
            <div className="border-l border-slate-300 dark:border-slate-700 px-2 py-2.5 text-center">Chuẩn</div>
            <div className="border-l border-slate-300 dark:border-slate-700 px-2 py-2.5" />
          </div>
          <datalist id="kpi-categories">{categories.map((category) => <option key={category} value={category} />)}</datalist>
          {items.map((item, index) => {
            const showHead = index === 0 || items[index - 1].category !== item.category;
            const isOpen = expanded === item.key;
            const categoryItems = items.filter((entry) => entry.category === item.category);
            const canRemoveCategory = categoryItems.length > 0 && categoryItems.every((entry) => !entry.saved);

            return (
              <div key={item.key} className="border-b border-slate-300 dark:border-slate-700 last:border-b-0">
                {showHead && (
                  <div className="flex items-center justify-between border-b-2 border-slate-300 dark:border-slate-700 bg-slate-200/90 dark:bg-slate-800 px-3 py-1.5 text-xs font-black text-slate-900 dark:text-slate-100">
                    <div className="flex min-w-0 items-center gap-2">
                      <input
                        value={item.category}
                        onChange={(event) => renameCategory(item.category, event.target.value)}
                        placeholder="Tên hạng mục..."
                        aria-label="Tên hạng mục"
                        className="h-7 w-60 rounded-none border border-transparent bg-transparent px-1.5 text-xs font-black text-slate-900 dark:text-slate-100 transition hover:border-slate-400 focus:border-indigo-500 focus:bg-white dark:focus:bg-slate-900 focus:outline-none"
                      />
                      <span className="text-slate-400">·</span>
                      <span className="text-xs font-black tabular-nums text-slate-700 dark:text-slate-300">
                        {fmtNum(totals.byCategory.get(item.category.trim()) ?? 0)}%
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 font-bold text-xs text-indigo-700 dark:text-indigo-400 hover:text-indigo-900 dark:hover:text-indigo-300 hover:underline"
                        onClick={() => addItem(item.category, item.group_code)}
                      >
                        <Plus className="h-3.5 w-3.5" /> Tiêu chí con
                      </button>
                      {canRemoveCategory && (
                        <IconButton label="Bỏ cả hạng mục này" danger onClick={() => removeCategory(item.category)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </IconButton>
                      )}
                    </div>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-1.5 p-1.5 md:grid-cols-[minmax(220px,1fr)_96px_72px_150px_64px_72px] md:gap-0 md:p-0">
                  <div className="col-span-2 md:col-span-1">
                    <CellInput value={item.name} placeholder="Tên tiêu chí" onChange={(value) => updateItem(item.key, { name: value })} />
                  </div>
                  <div className="md:border-l md:border-slate-300 dark:md:border-slate-700 md:p-1">
                    <Dropdown compact square searchable={false} aria-label="Nhóm" value={item.group_code}
                      options={[{ value: 'QUANT', label: GROUP_LABEL.QUANT }, { value: 'QUAL', label: GROUP_LABEL.QUAL }]}
                      onChange={(value) => updateItem(item.key, { group_code: value as KpiGroup })} />
                  </div>
                  <CellInput value={item.weight} placeholder="0" align="center" numeric onChange={(value) => updateItem(item.key, { weight: value })} />
                  <div className="md:border-l md:border-slate-300 dark:md:border-slate-700 md:p-1">
                    <Dropdown compact square searchable={false} aria-label="Cách chấm" value={item.method}
                      options={(Object.keys(METHOD_LABEL) as KpiMethod[]).map((method) => ({ value: method, label: METHOD_LABEL[method] }))}
                      onChange={(value) => updateItem(item.key, { method: value as KpiMethod })} />
                  </div>
                  <CellInput value={item.standard_score} align="center" numeric onChange={(value) => updateItem(item.key, { standard_score: value })} />
                  <div className="flex items-center justify-end gap-0.5 md:border-l md:border-slate-300 dark:md:border-slate-700 md:px-1">
                    <IconButton label={isOpen ? 'Thu gọn' : 'Chi tiết cách chấm'} onClick={() => setExpanded(isOpen ? null : item.key)}>
                      {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    </IconButton>
                    {!item.saved && (
                      <IconButton label="Bỏ dòng vừa thêm" danger onClick={() => removeItem(item.key)}><Trash2 className="h-4 w-4" /></IconButton>
                    )}
                  </div>
                </div>
                {isOpen && <CriterionDetail item={item} onChange={(patch) => updateItem(item.key, patch)} />}
              </div>
            );
          })}
        </div>
        <Button size="sm" variant="outline" onClick={() => addItem(`Hạng mục ${categories.length + 1}`, 'QUANT')}>
          <Plus className="h-3.5 w-3.5" /> Hạng mục mới
        </Button>

        {showBar && (
          <div className="fixed bottom-0 left-0 right-0 z-30 border-t border-slate-200 bg-white/95 px-4 py-3 shadow-lg backdrop-blur-md print:hidden">
            <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 lg:pl-64">
              <p className={`flex min-w-0 items-center gap-1.5 text-sm ${problems.length > 0 ? 'text-red-600' : 'text-slate-600'}`}
                title={problems.join(' · ')}>
                {problems.length > 0
                  ? <><TriangleAlert className="h-4 w-4 shrink-0" /> <span className="truncate">{problems[0]}{problems.length > 1 ? ` (+${problems.length - 1} lỗi nữa)` : ''}</span></>
                  : <><Save className="h-4 w-4 shrink-0" /> {set ? 'Thay đổi chưa lưu' : 'Bộ mới chưa lưu'}{set && !set.is_active ? ' — bộ đang khoá, lưu vẫn giữ khoá' : ''}</>}
              </p>
              <div className="flex gap-2">
                {embedded
                  ? <Button variant="secondary" onClick={reset} disabled={saving}>Huỷ thay đổi</Button>
                  : <Button variant="secondary" onClick={onCancel} disabled={saving}>Huỷ</Button>}
                <Button onClick={() => void handleSave()} disabled={saving || problems.length > 0}>
                  <Save className="h-4 w-4" /> {saving ? 'Đang lưu…' : 'Lưu'}
                </Button>
              </div>
            </div>
          </div>
        )}
    </div>
  );

  if (embedded) return body;
  return (
    <Card className="!rounded-none">
      <CardHeader className="flex flex-wrap items-center gap-3">
        <Button size="sm" variant="ghost" onClick={onCancel} aria-label="Quay lại">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="min-w-0 flex-1">
          <CardTitle>{set ? 'Sửa bộ KPI' : 'Bộ KPI mới'}</CardTitle>
          <p className="mt-0.5 truncate text-xs text-slate-500">{target.label}</p>
        </div>
        {copyPicker}
      </CardHeader>
      <CardContent>{body}</CardContent>
    </Card>
  );
}

function CriterionDetail({ item, onChange }: { item: DraftItem; onChange: (patch: Partial<DraftItem>) => void }) {
  const levelEditor = item.method === 'LEVEL' || item.method === 'BINARY';
  return (
    <div className="space-y-3 border-t border-dashed border-slate-200 bg-slate-50/60 px-3 py-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-slate-600">Thuộc hạng mục</span>
          <input
            value={item.category}
            list="kpi-categories"
            onChange={(event) => onChange({ category: event.target.value })}
            placeholder="Tên hạng mục"
            className="h-9 w-full rounded-none border border-slate-200 bg-white px-2.5 text-sm outline-none focus:border-indigo-500"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-slate-600">Tiêu chí đo lường</span>
          <input
            value={item.measure}
            onChange={(event) => onChange({ measure: event.target.value })}
            placeholder="Đo bằng gì, lấy số ở đâu"
            className="h-9 w-full rounded-none border border-slate-200 bg-white px-2.5 text-sm outline-none focus:border-indigo-500"
          />
        </label>
      </div>

      {levelEditor && (
        <div>
          <p className="mb-1 text-xs font-semibold text-slate-600">Mô tả từng mức điểm</p>
          <div className="space-y-1">
            {item.levels.map((level, index) => (
              <div key={index} className="flex gap-1.5">
                <input value={level.score} inputMode="decimal" aria-label="Điểm"
                  onChange={(event) => onChange({ levels: item.levels.map((entry, i) => (i === index ? { ...entry, score: event.target.value } : entry)) })}
                  className="h-8 w-16 rounded-none border border-slate-200 bg-white px-2 text-center text-xs tabular-nums outline-none focus:border-indigo-500" />
                <input value={level.label} placeholder="Mô tả mức" aria-label="Mô tả mức"
                  onChange={(event) => onChange({ levels: item.levels.map((entry, i) => (i === index ? { ...entry, label: event.target.value } : entry)) })}
                  className="h-8 min-w-0 flex-1 rounded-none border border-slate-200 bg-white px-2 text-xs outline-none focus:border-indigo-500" />
                <IconButton label="Bỏ mức" danger onClick={() => onChange({ levels: item.levels.filter((_, i) => i !== index) })}><Trash2 className="h-3 w-3" /></IconButton>
              </div>
            ))}
          </div>
          <button type="button" className="mt-1 text-xs font-semibold text-indigo-600 hover:underline"
            onClick={() => onChange({ levels: [...item.levels, { score: '', label: '' }] })}>+ Thêm mức</button>
        </div>
      )}

      {item.method === 'RANGE' && (
        <div>
          <p className="mb-1 text-xs font-semibold text-slate-600">Dải quy đổi → điểm <span className="font-normal text-slate-400">(từ ≤ giá trị &lt; dưới; bỏ trống = không chặn)</span></p>
          <div className="space-y-1">
            {item.ranges.map((range, index) => (
              <div key={index} className="flex items-center gap-1.5 text-xs text-slate-500">
                Từ
                <input value={range.min} inputMode="decimal" aria-label="Từ"
                  onChange={(event) => onChange({ ranges: item.ranges.map((entry, i) => (i === index ? { ...entry, min: event.target.value } : entry)) })}
                  className="h-8 w-20 rounded-none border border-slate-200 bg-white px-2 text-center tabular-nums outline-none focus:border-indigo-500" />
                dưới
                <input value={range.max} inputMode="decimal" aria-label="Dưới"
                  onChange={(event) => onChange({ ranges: item.ranges.map((entry, i) => (i === index ? { ...entry, max: event.target.value } : entry)) })}
                  className="h-8 w-20 rounded-none border border-slate-200 bg-white px-2 text-center tabular-nums outline-none focus:border-indigo-500" />
                → điểm
                <input value={range.score} inputMode="decimal" aria-label="Điểm"
                  onChange={(event) => onChange({ ranges: item.ranges.map((entry, i) => (i === index ? { ...entry, score: event.target.value } : entry)) })}
                  className="h-8 w-14 rounded-none border border-slate-200 bg-white px-2 text-center tabular-nums outline-none focus:border-indigo-500" />
                <IconButton label="Bỏ dải" danger onClick={() => onChange({ ranges: item.ranges.filter((_, i) => i !== index) })}><Trash2 className="h-3 w-3" /></IconButton>
              </div>
            ))}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <button type="button" className="text-xs font-semibold text-indigo-600 hover:underline"
              onClick={() => onChange({ ranges: [...item.ranges, { min: '', max: '', score: '' }] })}>+ Thêm dải</button>
            <label className="flex items-center gap-1.5 text-xs text-slate-600">
              Đơn vị
              <input value={item.value_unit} onChange={(event) => onChange({ value_unit: event.target.value })} placeholder="%, lần, bài…"
                className="h-8 w-24 rounded-none border border-slate-200 bg-white px-2 outline-none focus:border-indigo-500" />
            </label>
          </div>
        </div>
      )}

      {item.method === 'PENALTY' && (
        <label className="flex items-center gap-2 text-xs text-slate-600">
          Mỗi lần vi phạm trừ
          <input value={item.penalty_pct} inputMode="decimal" onChange={(event) => onChange({ penalty_pct: event.target.value })}
            className="h-8 w-20 rounded-none border border-slate-200 bg-white px-2 text-center tabular-nums outline-none focus:border-indigo-500" />
          % KPI (không trừ quá tỷ trọng của tiêu chí)
        </label>
      )}

      <div className="flex flex-wrap items-center gap-4">
        <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-slate-700">
          <input type="checkbox" checked={item.allow_over} onChange={(event) => onChange({ allow_over: event.target.checked })} className="h-3.5 w-3.5 accent-indigo-600" />
          Cho chấm vượt chuẩn (tối đa 5)
        </label>
        <div className="w-64">
          <Dropdown compact square searchable={false} aria-label="Tự điền giá trị" value={item.source}
            options={[{ value: '', label: 'Nhập tay' }, ...(Object.keys(SOURCE_LABEL) as KpiSource[]).map((source) => ({ value: source, label: `Tự điền: ${SOURCE_LABEL[source]}` }))]}
            onChange={(value) => onChange({ source: value as KpiSource | '' })} />
        </div>
      </div>
    </div>
  );
}

function CellInput({ value, onChange, placeholder, align = 'left', numeric = false, list }: {
  value: string; onChange: (value: string) => void; placeholder?: string; align?: 'left' | 'center'; numeric?: boolean; list?: string;
}) {
  return (
    <div className="md:border-l md:border-slate-300 dark:md:border-slate-700 md:p-1 md:first:border-l-0">
      <input
        value={value}
        list={list}
        inputMode={numeric ? 'decimal' : undefined}
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={(event) => onChange(numeric ? event.target.value.replace(/[^\d.,]/g, '') : event.target.value)}
        className={`h-9 w-full rounded-none border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2.5 text-sm font-bold text-slate-900 dark:text-slate-100 outline-none focus:border-indigo-500 ${align === 'center' ? 'text-center tabular-nums' : ''}`}
      />
    </div>
  );
}

export function IconButton({ children, label, onClick, danger = false }: {
  children: React.ReactNode; label: string; onClick: () => void; danger?: boolean;
}) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label}
      className={`inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors ${danger ? 'hover:bg-red-50 hover:text-red-600' : 'hover:bg-indigo-50 hover:text-indigo-600'}`}>
      {children}
    </button>
  );
}
