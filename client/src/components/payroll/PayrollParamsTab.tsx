// ============================================================================
// Tham số lương theo NGÀY HIỆU LỰC, xếp trong các BẢNG tự đặt tên.
// ----------------------------------------------------------------------------
// Người dùng tự tạo bảng ("Bảo hiểm", "Khấu trừ", "Làm thêm giờ"…) và thêm
// tham số vào. Mỗi tham số có loại (thời gian / giá / tỷ lệ / số lượng) và
// đơn vị; tên của nó gõ thẳng được trong công thức của cơ chế lương. Hệ thống
// không gán nghĩa riêng cho tham số nào — đổi chính sách là đổi con số ở đây.
//
// Mỗi bộ tham số áp từ một tháng. Đổi chính sách = tạo bộ mới hiệu lực từ
// tháng đó; các tháng trước giữ bộ cũ. Bộ đã dùng cho kỳ lương ĐÃ CHỐT thì
// khoá (database chặn).
// ============================================================================

import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft, Check, Copy, Layers, Lock, LockOpen, Pencil, Plus, Save, Search,
  Table2, Trash2, TriangleAlert, X,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Dropdown } from '@/components/ui/Dropdown';
import { MoneyInput, isMoneyUnit } from '@/components/payroll/MoneyInput';
import { useToast } from '@/contexts/ToastContext';
import { useConfirm } from '@/contexts/ConfirmContext';
import { formatVND, getTodayString } from '@/lib/utils';
import { stripLeadingZeros } from '@/lib/numericFocus';
import { referencedCodes, referencedFunctions } from '@/lib/formulaTokens';
import {
  codeFromName, copyVersion, deleteParamVersion, duplicateTable, firstEditableMonth, newTableId, paramsOf, saveParamVersion,
  validateParamVersion,
  type ListParamTable, type NetRoundingMode, type NetRoundingUnit, type ParamDef, type ParamTable,
  type PayrollParamVersion, type TierParamTable,
} from '@/lib/payrollSettings';
import {
  PARAM_TYPE_LABEL, PARAM_TYPE_UNITS, PARAM_UNIT_LABEL, RESERVED_FORMULA_NAMES, formatWithUnit,
  type ParamType, type ParamUnit,
} from '@/lib/payrollVariables';
import type { PayrollWorkspace } from '@/lib/payrollData';

interface PayrollParamsTabProps {
  data: PayrollWorkspace;
  /** Tháng lớn nhất đã khoá lương — bộ hiệu lực từ đó trở về trước bị khoá. */
  lastClosedMonth: string | null;
  /** Tháng đang xem ở các màn khác, để đánh dấu bộ "đang áp dụng". */
  currentMonth: string;
  canManage: boolean;
  onSaved: () => void;
}

const monthLabel = (iso: string) => (iso.startsWith('2000-01') ? 'Bộ gốc' : `${iso.slice(5, 7)}/${iso.slice(0, 4)}`);
const ROUNDING_UNITS: NetRoundingUnit[] = [1, 10, 100, 1000, 10000];
const TIER_MODE_OPTIONS = [
  { value: 'LOOKUP', label: 'Tra bậc' },
  { value: 'PROGRESSIVE', label: 'Lũy tiến từng phần' },
];
const TIER_UNIT_OPTIONS = (['%', 'HE_SO', 'VND', 'VND_NGAY', 'VND_THANG'] as ParamUnit[])
  .map((unit) => ({ value: unit, label: PARAM_UNIT_LABEL[unit] }));
const PARAM_TYPE_OPTIONS = (Object.keys(PARAM_TYPE_LABEL) as ParamType[])
  .map((type) => ({ value: type, label: PARAM_TYPE_LABEL[type] }));

interface NewTableForm {
  name: string;
  note: string;
  mode: TierParamTable['mode'];
  inputLabel: string;
  unit: ParamUnit;
}
const BLANK_NEW_TABLE: NewTableForm = { name: '', note: '', mode: 'LOOKUP', inputLabel: '', unit: '%' };

function blankVersion(effectiveFrom: string): PayrollParamVersion {
  return {
    id: null, effectiveFrom, label: null, note: null, updatedAt: null,
    standardWorkDays: 26, netRoundingUnit: 1000, netRoundingMode: 'NEAREST',
    floorComponentCode: null, floorParamCode: null,
    tables: [],
  };
}

const cloneEditable = (version: PayrollParamVersion): PayrollParamVersion => ({
  ...copyVersion(version, version.effectiveFrom), id: version.id, label: version.label, note: version.note, updatedAt: version.updatedAt,
});

export function PayrollParamsTab({
  data, lastClosedMonth, currentMonth, canManage, onSaved,
}: PayrollParamsTabProps) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const versions = data.paramVersions;

  const sorted = useMemo(
    () => [...versions].sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom)),
    [versions],
  );
  const activeId = useMemo(
    () => sorted.find((version) => version.effectiveFrom <= currentMonth)?.id ?? null,
    [sorted, currentMonth],
  );
  const minMonth = firstEditableMonth(lastClosedMonth, getTodayString());
  const reserved = useMemo(
    () => new Set([...RESERVED_FORMULA_NAMES, ...data.components.map((component) => component.code)]),
    [data.components],
  );

  // openId: bộ đang mở để sửa bảng tham số; null = màn chọn bộ.
  const [openId, setOpenId] = useState<string | null>(null);
  const [newVersion, setNewVersion] = useState<PayrollParamVersion | null>(null);
  const [draft, setDraft] = useState<PayrollParamVersion | null>(null);
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  // Hộp "Tạo bảng": mở khi bấm một trong hai nút thêm bảng.
  const [creating, setCreating] = useState<'LIST' | 'TIER' | null>(null);
  const [createForm, setCreateForm] = useState<NewTableForm>(BLANK_NEW_TABLE);
  const [createError, setCreateError] = useState<string | null>(null);
  const [tableQuery, setTableQuery] = useState('');

  // Nạp bản nháp của bộ đang mở; dữ liệu mới về thì làm mới khi người dùng chưa sửa dở.
  useEffect(() => {
    if (!openId || touched) return;
    const pick = sorted.find((version) => version.id === openId);
    if (pick) setDraft(cloneEditable(pick));
    else setOpenId(null);
  }, [sorted, openId, touched]);

  useEffect(() => { setCreating(null); setTableQuery(''); }, [openId]);

  const issues = draft ? validateParamVersion(draft, reserved) : {};
  const issueCount = Object.keys(issues).length;
  const locked = !!draft?.id && !!lastClosedMonth && draft.effectiveFrom <= lastClosedMonth;
  const readOnly = !canManage || locked;

  /** Tham số / bảng đang được dùng ở công thức nào — để không xoá nhầm. */
  const usage = useMemo(() => {
    const map = new Map<string, Set<string>>();
    const add = (code: string, where: string) => map.set(code, new Set([...(map.get(code) ?? []), where]));
    const componentById = new Map(data.components.map((component) => [component.id, component]));
    const unitById = new Map(data.units.map((unit) => [unit.id, unit]));
    for (const item of data.unitItems) {
      if (!item.formula || (item.effective_to && item.effective_to < currentMonth)) continue;
      const where = `${unitById.get(item.unit_id)?.name ?? 'Đơn vị'} · ${componentById.get(item.component_id)?.name ?? '?'}`;
      for (const code of [...referencedCodes(item.formula), ...referencedFunctions(item.formula)]) add(code, where);
    }
    for (const item of data.items) {
      if (!item.formula || item.effective_to) continue;
      for (const code of [...referencedCodes(item.formula), ...referencedFunctions(item.formula)]) add(code, 'Công thức khai riêng');
    }
    return map;
  }, [currentMonth, data.components, data.items, data.unitItems, data.units]);

  const update = (patch: Partial<PayrollParamVersion>) => {
    setTouched(true);
    setDraft((current) => (current ? { ...current, ...patch } : current));
  };
  const updateTable = (id: string, patch: Partial<ListParamTable> | Partial<TierParamTable>) => {
    setTouched(true);
    setDraft((current) => (current
      ? { ...current, tables: current.tables.map((table) => (table.id === id ? { ...table, ...patch } as ParamTable : table)) }
      : current));
  };

  const startNew = () => {
    const base = sorted[0];
    setNewVersion(base ? copyVersion(base, minMonth) : blankVersion(minMonth));
  };

  const back = async () => {
    if (touched) {
      const ok = await confirm({
        title: 'Bỏ thay đổi chưa lưu?',
        message: 'Các sửa đổi ở bảng tham số của bộ này chưa được lưu.',
        confirmLabel: 'Bỏ thay đổi',
        danger: true,
      });
      if (!ok) return;
    }
    setTouched(false);
    setDraft(null);
    setOpenId(null);
  };

  const takenCodes = (exclude?: string) => new Set([
    ...reserved,
    ...(draft ? paramsOf(draft).map((param) => param.code) : []),
    ...(draft?.tables.filter((table): table is TierParamTable => table.kind === 'TIER').map((table) => table.code) ?? []),
  ].filter((code) => code !== exclude));

  const openCreate = (kind: 'LIST' | 'TIER') => {
    setCreateForm(BLANK_NEW_TABLE);
    setCreateError(null);
    setCreating(kind);
  };

  const createTable = () => {
    if (!draft || !creating) return;
    const name = createForm.name.trim();
    if (!name) {
      setCreateError('Nhập tên bảng.');
      return;
    }
    if (draft.tables.some((table) => table.name.trim().toLowerCase() === name.toLowerCase())) {
      setCreateError('Đã có bảng trùng tên trong bộ này.');
      return;
    }
    const id = newTableId();
    const note = createForm.note.trim() || null;
    const table: ParamTable = creating === 'LIST'
      ? { id, kind: 'LIST', name, note, params: [] }
      : {
        id, kind: 'TIER', name, note, code: codeFromName(name, takenCodes(), 'BANG'),
        mode: createForm.mode, inputLabel: createForm.inputLabel.trim() || null,
        unit: createForm.mode === 'PROGRESSIVE' ? '%' : createForm.unit,
        rows: [{ from: 0, value: 0 }],
      };
    update({ tables: [...draft.tables, table] });
    setTableQuery('');
    setCreating(null);
  };

  // Bảng và tham số không xoá, chỉ khoá: công thức cũ vẫn chạy, nhưng không còn gợi ý khi khai công thức mới.
  const toggleTableLock = (table: ParamTable) => updateTable(table.id, { locked: !table.locked });

  /** Sao chép một bảng trong cùng bộ — dùng lại cấu trúc thay vì gõ lại từ đầu. */
  const duplicateTableInDraft = (table: ParamTable) => {
    if (!draft) return;
    const takenNamesLower = new Set(draft.tables.map((item) => item.name.trim().toLowerCase()));
    const copy = duplicateTable(table, takenNamesLower, takenCodes());
    setTouched(true);
    setDraft({ ...draft, tables: [...draft.tables, copy] });
    toast('Đã sao chép bảng — kiểm tra lại tên và mã rồi lưu.', 'success');
  };

  const saveTables = async () => {
    if (!draft) return;
    if (issueCount > 0) {
      toast('Còn ô chưa hợp lệ — sửa các ô đánh dấu đỏ.', 'warning');
      return;
    }
    setSaving(true);
    const { error } = await saveParamVersion(draft);
    setSaving(false);
    if (error) {
      toast('Lưu thất bại: ' + error, 'error');
      return;
    }
    toast('Đã lưu bảng tham số.', 'success');
    setTouched(false);
    onSaved();
  };

  // ------------------------------------------------------------------ Chọn bộ
  if (!openId) {
    return (
      <div className="space-y-4">
        {newVersion && (
          <VersionCard
            key="new"
            version={newVersion}
            isNew
            isActive={false}
            locked={false}
            canManage={canManage}
            minMonth={minMonth}
            reserved={reserved}
            data={data}
            versions={versions}
            canDelete={false}
            onOpen={() => undefined}
            onDiscard={() => setNewVersion(null)}
            onSaved={() => { setNewVersion(null); onSaved(); }}
          />
        )}
        {sorted.length === 0 && !newVersion && (
          <Card className="!rounded-none">
            <CardContent className="space-y-3 py-10 text-center">
              <Table2 className="mx-auto h-10 w-10 text-slate-300" />
              <p className="text-sm text-slate-500">Chưa có bộ tham số lương nào.</p>
            </CardContent>
          </Card>
        )}
        {sorted.map((version) => (
          <VersionCard
            key={`${version.id}:${version.updatedAt}`}
            version={version}
            isActive={version.id === activeId}
            locked={!!lastClosedMonth && version.effectiveFrom <= lastClosedMonth}
            canManage={canManage}
            minMonth={minMonth}
            reserved={reserved}
            data={data}
            versions={versions}
            canDelete={sorted.length > 1}
            onOpen={() => { setTouched(false); setOpenId(version.id); }}
            onSaved={onSaved}
          />
        ))}
        {canManage && !newVersion && (
          <button type="button" onClick={startNew}
            className="flex w-full flex-col items-center justify-center gap-1 rounded-none border border-dashed border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900/40 py-8 text-sm font-semibold text-slate-500 dark:text-slate-400 transition hover:border-indigo-400 hover:text-indigo-600">
            <Plus className="h-6 w-6" /> Thêm bộ
          </button>
        )}
      </div>
    );
  }

  // ------------------------------------------------- Trong một bộ: các bảng
  if (!draft) return null;

  // Lọc theo tên bảng, ghi chú hoặc tên tham số; bảng chưa đặt tên luôn hiện để còn nhập.
  const needle = tableQuery.trim().toLowerCase();
  const visibleTables = needle
    ? draft.tables.filter((table) => {
      if (!table.name.trim()) return true;
      const haystack = [
        table.name, table.note ?? '',
        ...(table.kind === 'LIST' ? table.params.map((param) => param.name) : [table.inputLabel ?? '']),
      ];
      return haystack.some((text) => text.toLowerCase().includes(needle));
    })
    : draft.tables;

  return (
    <div className={`space-y-4 ${touched ? 'pb-24' : ''}`}>
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" variant="outline" onClick={() => void back()}>
          <ArrowLeft className="h-3.5 w-3.5" /> Danh sách bộ
        </Button>
        <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
          Từ {monthLabel(draft.effectiveFrom)}{draft.label ? ` · ${draft.label}` : ''}
        </p>
        {locked && (
          <span className="inline-flex items-center gap-1.5 rounded-none bg-slate-100 dark:bg-slate-800 px-2.5 py-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300">
            <Lock className="h-3.5 w-3.5" /> Đã dùng cho kỳ chốt — chỉ xem
          </span>
        )}
      </div>

      {(!readOnly || draft.tables.length > 0) && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[14rem] flex-1 sm:max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={tableQuery}
              onChange={(event) => setTableQuery(event.target.value)}
              placeholder="Tìm bảng hoặc tham số…"
              aria-label="Tìm bảng tham số"
              className="h-9 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 pl-9 pr-3 text-sm outline-none transition hover:border-slate-300 dark:hover:border-slate-600 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/15"
            />
          </div>
          {!readOnly && (
            <div className="ml-auto flex flex-wrap justify-end gap-2">
              <Button size="sm" variant="outline" onClick={() => openCreate('LIST')}>
                <Plus className="h-3.5 w-3.5" /> Bảng tham số
              </Button>
              <Button size="sm" variant="outline" onClick={() => openCreate('TIER')}>
                <Layers className="h-3.5 w-3.5" /> Bảng bậc thang
              </Button>
            </div>
          )}
        </div>
      )}

      {draft.tables.length === 0 && (
        <Card className="!rounded-none"><CardContent className="py-10 text-center text-sm text-slate-500">Bộ này chưa có bảng nào.</CardContent></Card>
      )}
      {draft.tables.length > 0 && visibleTables.length === 0 && (
        <Card className="!rounded-none"><CardContent className="py-10 text-center text-sm text-slate-500">Không có bảng nào khớp “{tableQuery.trim()}”.</CardContent></Card>
      )}
      <div className="space-y-4">
        {visibleTables.map((table) => (table.kind === 'LIST' ? (
          <ListTableEditor
            key={table.id}
            table={table}
            readOnly={readOnly}
            issues={issues}
            usage={usage}
            taken={(exclude) => takenCodes(exclude)}
            onChange={(patch) => updateTable(table.id, patch)}
            onToggleLock={() => toggleTableLock(table)}
            onDuplicate={() => duplicateTableInDraft(table)}
          />
        ) : (
          <TierTableEditor
            key={table.id}
            table={table}
            readOnly={readOnly}
            issue={issues[`table.${table.id}`]}
            usage={[...(usage.get(table.code) ?? [])]}
            taken={takenCodes(table.code)}
            onChange={(patch) => updateTable(table.id, patch)}
            onToggleLock={() => toggleTableLock(table)}
            onDuplicate={() => duplicateTableInDraft(table)}
          />
        )))}
      </div>

      <Modal square
        open={!!creating && !readOnly}
        onClose={() => setCreating(null)}
        title={creating === 'TIER' ? 'Tạo bảng bậc thang' : 'Tạo bảng tham số'}
        size="md"
      >
        <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); createTable(); }} noValidate>
          <Input className="!rounded-none" label="Tên bảng" required autoFocus value={createForm.name}
            placeholder={creating === 'TIER' ? 'VD: Biểu thuế lũy tiến' : 'VD: Bảo hiểm'}
            error={createError ?? undefined}
            onChange={(event) => { setCreateError(null); setCreateForm({ ...createForm, name: event.target.value }); }} />
          <Input className="!rounded-none" label="Ghi chú" value={createForm.note} placeholder="Không bắt buộc"
            onChange={(event) => setCreateForm({ ...createForm, note: event.target.value })} />
          {creating === 'TIER' && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Dropdown square label="Cách tính" value={createForm.mode} options={TIER_MODE_OPTIONS}
                onChange={(value) => setCreateForm({
                  ...createForm,
                  mode: value as TierParamTable['mode'],
                  ...(value === 'PROGRESSIVE' ? { unit: '%' as ParamUnit } : {}),
                })} />
              {createForm.mode === 'LOOKUP' && (
                <Dropdown square label="Đơn vị của mức" value={createForm.unit} options={TIER_UNIT_OPTIONS}
                  onChange={(value) => setCreateForm({ ...createForm, unit: value as ParamUnit })} />
              )}
              <div className="sm:col-span-2">
                <Input className="!rounded-none" label="Giá trị đưa vào tra" value={createForm.inputLabel}
                  placeholder={createForm.mode === 'PROGRESSIVE' ? 'VD: Thu nhập tính thuế' : 'VD: Tỷ lệ đạt doanh số (%)'}
                  onChange={(event) => setCreateForm({ ...createForm, inputLabel: event.target.value })} />
              </div>
            </div>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={() => setCreating(null)}>Huỷ</Button>
            <Button type="submit"><Plus className="h-4 w-4" /> Tạo bảng</Button>
          </div>
        </form>
      </Modal>

      {/* --- Thanh lưu: chỉ hiện khi có thay đổi --- */}
      {touched && (
        <div className="fixed bottom-0 left-0 right-0 z-30 border-t border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 px-4 py-3 shadow-lg backdrop-blur-md print:hidden">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 lg:pl-64">
            <p className={`flex items-center gap-1.5 text-sm ${issueCount > 0 ? 'text-red-600 dark:text-red-400' : 'text-slate-600 dark:text-slate-300'}`}>
              {issueCount > 0
                ? <><TriangleAlert className="h-4 w-4" /> {issueCount} ô chưa hợp lệ</>
                : <><Save className="h-4 w-4" /> Có thay đổi chưa lưu</>}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => setTouched(false)} disabled={saving}>
                Huỷ thay đổi
              </Button>
              {canManage && !locked && (
                <Button onClick={() => void saveTables()} disabled={saving || issueCount > 0}>
                  <Save className="h-4 w-4" /> {saving ? 'Đang lưu…' : 'Lưu bảng tham số'}
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

type GeneralForm = Pick<PayrollParamVersion,
  'effectiveFrom' | 'label' | 'note' | 'standardWorkDays' | 'netRoundingUnit' | 'netRoundingMode' | 'floorComponentCode' | 'floorParamCode'>;

const pickGeneral = (version: PayrollParamVersion): GeneralForm => ({
  effectiveFrom: version.effectiveFrom, label: version.label, note: version.note,
  standardWorkDays: version.standardWorkDays, netRoundingUnit: version.netRoundingUnit,
  netRoundingMode: version.netRoundingMode, floorComponentCode: version.floorComponentCode,
  floorParamCode: version.floorParamCode,
});

/** Một bộ ở màn chọn bộ: tên, ngày áp dụng, thiết lập chung sửa ngay tại đây. */
function VersionCard({
  version, isNew = false, isActive, locked, canManage, minMonth, reserved, data, versions, canDelete,
  onOpen, onDiscard, onSaved,
}: {
  version: PayrollParamVersion;
  isNew?: boolean;
  isActive: boolean;
  locked: boolean;
  canManage: boolean;
  minMonth: string;
  reserved: Set<string>;
  data: PayrollWorkspace;
  versions: PayrollParamVersion[];
  canDelete: boolean;
  onOpen: () => void;
  onDiscard?: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const [form, setForm] = useState<GeneralForm>(() => pickGeneral(version));
  const [saving, setSaving] = useState(false);
  const readOnly = !canManage || locked;
  const dirty = isNew || JSON.stringify(form) !== JSON.stringify(pickGeneral(version));
  const merged: PayrollParamVersion = { ...version, ...form };
  const issues = validateParamVersion(merged, reserved);
  const set = (patch: Partial<GeneralForm>) => setForm((current) => ({ ...current, ...patch }));

  const save = async () => {
    if (Object.keys(issues).length > 0) {
      toast('Còn ô chưa hợp lệ — sửa các ô đánh dấu đỏ.', 'warning');
      return;
    }
    const clash = versions.find((item) => item.effectiveFrom === merged.effectiveFrom && item.id !== merged.id);
    if (clash) {
      toast(`Đã có bộ tham số hiệu lực từ ${monthLabel(merged.effectiveFrom)}.`, 'warning');
      return;
    }
    const ok = await confirm({
      title: isNew ? `Lưu bộ tham số mới hiệu lực từ ${monthLabel(merged.effectiveFrom)}?` : 'Lưu thay đổi bộ tham số?',
      message: `Áp dụng cho kỳ lương từ ${monthLabel(merged.effectiveFrom)} cho tới bộ kế tiếp. Kỳ chưa khoá trong khoảng đó tính theo số mới khi chạy lại bảng lương; kỳ đã khoá giữ nguyên.`,
      confirmLabel: 'Lưu bộ tham số',
    });
    if (!ok) return;
    setSaving(true);
    const { error } = await saveParamVersion(merged);
    setSaving(false);
    if (error) {
      toast('Lưu thất bại: ' + error, 'error');
      return;
    }
    toast('Đã lưu bộ tham số lương.', 'success');
    onSaved();
  };

  const remove = async () => {
    if (!version.id) return;
    const ok = await confirm({
      title: `Xoá bộ tham số hiệu lực từ ${monthLabel(version.effectiveFrom)}?`,
      message: 'Các tháng đang theo bộ này sẽ quay về bộ liền trước. Chỉ xoá được bộ chưa dùng cho kỳ lương đã khoá.',
      confirmLabel: 'Xoá bộ tham số',
      danger: true,
    });
    if (!ok) return;
    const error = await deleteParamVersion(version.id);
    if (error) {
      toast('Xoá thất bại: ' + error, 'error');
      return;
    }
    toast('Đã xoá bộ tham số.', 'success');
    onSaved();
  };

  const [editHead, setEditHead] = useState(isNew);
  const [editGeneral, setEditGeneral] = useState(isNew);
  const editing = editHead || editGeneral;
  const stop = (event: { stopPropagation: () => void }) => event.stopPropagation();
  const pencil = 'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-indigo-50 dark:hover:bg-slate-800 hover:text-indigo-600 dark:hover:text-indigo-400';
  const floorComponent = data.components.find((component) => component.code === form.floorComponentCode)?.name;
  const floorParam = paramsOf(version).find((param) => param.code === form.floorParamCode)?.name;
  const summary = [
    `Công chuẩn ${form.standardWorkDays} ngày`,
    form.netRoundingUnit === 1
      ? 'Không làm tròn thực lĩnh'
      : `Làm tròn thực lĩnh tới ${formatVND(form.netRoundingUnit)} (${{ NEAREST: 'gần nhất', DOWN: 'luôn xuống', UP: 'luôn lên' }[form.netRoundingMode]})`,
    floorComponent && floorParam ? `Mức sàn: ${floorComponent} ≥ ${floorParam}` : null,
  ].filter(Boolean);

  return (
    <section
      role={editing ? undefined : 'button'}
      tabIndex={editing ? undefined : 0}
      onClick={editing || isNew ? undefined : onOpen}
      onKeyDown={editing || isNew ? undefined : (event) => { if (event.key === 'Enter') onOpen(); }}
      className={`space-y-3 rounded-none border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-sm ${editing || isNew ? '' : 'cursor-pointer transition hover:border-indigo-300 dark:hover:border-slate-700 hover:shadow-md'}`}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2" onClick={editHead ? stop : undefined}>
        {editHead ? (
          <>
            <div className="w-56">
              <Input className="!rounded-none" aria-label="Tên bộ" autoFocus value={form.label ?? ''} disabled={!canManage}
                onChange={(event) => set({ label: event.target.value })} placeholder="Tên bộ, VD: Chính sách 2026" />
            </div>
            <div className="w-44">
              <Input className="!rounded-none"
                aria-label="Áp dụng từ tháng"
                type="month"
                value={form.effectiveFrom.slice(0, 7)}
                min={version.id ? undefined : minMonth.slice(0, 7)}
                disabled={readOnly || (!!version.id && version.effectiveFrom.startsWith('2000-01'))}
                onChange={(event) => set({ effectiveFrom: event.target.value ? `${event.target.value}-01` : '' })}
                error={issues['general.effectiveFrom']}
              />
            </div>
            {!isNew && (
              <button type="button" className={pencil} aria-label="Xong" title="Xong" onClick={() => setEditHead(false)}>
                <Check className="h-4 w-4" />
              </button>
            )}
          </>
        ) : (
          <>
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">{form.label?.trim() || 'Bộ chưa đặt tên'}</h3>
            {canManage && !locked && (
              <button type="button" className={`${pencil} -ml-2`} aria-label="Sửa tên và ngày áp dụng" title="Sửa tên, ngày áp dụng"
                onClick={(event) => { stop(event); setEditHead(true); }}>
                <Pencil className="h-3.5 w-3.5" />
              </button>
            )}
            <span className="text-sm text-slate-500 dark:text-slate-400">Áp dụng từ {monthLabel(form.effectiveFrom)}</span>
          </>
        )}
        {isNew && <span className="rounded-full bg-amber-100 dark:bg-amber-900/40 px-2.5 py-1 text-[11px] font-bold text-amber-800 dark:text-amber-300">Chưa lưu</span>}
        {isActive && <span className="rounded-full bg-emerald-100 dark:bg-emerald-900/40 px-2.5 py-1 text-[11px] font-bold text-emerald-700 dark:text-emerald-300">Đang áp dụng</span>}
        {locked && (
          <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 dark:bg-slate-800 px-2.5 py-1 text-[11px] font-bold text-slate-600 dark:text-slate-300">
            <Lock className="h-3 w-3" /> Đã dùng cho kỳ chốt
          </span>
        )}
        {canManage && !isNew && canDelete && !locked && (
          <button type="button" aria-label="Xoá bộ" title="Xoá bộ"
            onClick={(event) => { stop(event); void remove(); }}
            className="ml-auto flex h-8 w-8 items-center justify-center rounded-lg text-slate-300 hover:text-red-600 dark:text-slate-600 dark:hover:text-red-400 transition hover:bg-red-50 dark:hover:bg-red-950/40">
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="rounded-none border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 px-3 py-2.5" onClick={editGeneral ? stop : undefined}>
        {editGeneral ? (
          <div className="flex flex-wrap items-end gap-x-3 gap-y-3">
            <div className="w-32">
              <NumberField label="Công chuẩn (ngày)" required value={form.standardWorkDays} step={0.5}
                disabled={readOnly} error={issues['general.standardWorkDays']} onChange={(v) => set({ standardWorkDays: v })} />
            </div>
            <div className="w-40">
              <Dropdown square label="Làm tròn thực lĩnh tới" value={String(form.netRoundingUnit)} disabled={readOnly}
                options={ROUNDING_UNITS.map((unit) => ({ value: String(unit), label: unit === 1 ? 'Không làm tròn' : formatVND(unit) }))}
                onChange={(value) => set({ netRoundingUnit: Number(value) as NetRoundingUnit })} />
            </div>
            <div className="w-36">
              <Dropdown square label="Cách làm tròn" value={form.netRoundingMode} disabled={readOnly || form.netRoundingUnit === 1}
                options={[
                  { value: 'NEAREST', label: 'Gần nhất' },
                  { value: 'DOWN', label: 'Luôn xuống' },
                  { value: 'UP', label: 'Luôn lên' },
                ]}
                onChange={(value) => set({ netRoundingMode: value as NetRoundingMode })} />
            </div>
            <div>
              <p className="mb-1.5 text-sm font-semibold text-slate-700 dark:text-slate-300">Mức sàn khi trình cơ chế</p>
              <div className="flex items-center gap-2">
                <div className="w-48">
                  <Dropdown square aria-label="Đầu mục cần kiểm tra" searchable value={form.floorComponentCode ?? ''} disabled={readOnly}
                    options={[
                      { value: '', label: 'Không kiểm tra' },
                      ...data.components.filter((component) => component.is_active)
                        .map((component) => ({ value: component.code, label: component.name })),
                    ]}
                    onChange={(value) => set({ floorComponentCode: value || null })} />
                </div>
                <span className="text-sm font-bold text-slate-400">≥</span>
                <div className="w-48">
                  <Dropdown square aria-label="Tham số làm mức sàn" searchable value={form.floorParamCode ?? ''} disabled={readOnly}
                    options={[
                      { value: '', label: 'Chọn tham số…' },
                      ...paramsOf(version).filter((param) => !param.locked || param.code === form.floorParamCode).map((param) => ({
                        value: param.code, label: param.name, detail: formatWithUnit(param.value, param.unit),
                      })),
                    ]}
                    onChange={(value) => set({ floorParamCode: value || null })} />
                </div>
              </div>
            </div>
            {!isNew && (
              <button type="button" className={pencil} aria-label="Xong" title="Xong" onClick={() => setEditGeneral(false)}>
                <Check className="h-4 w-4" />
              </button>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <p className="min-w-0 flex-1 truncate text-sm text-slate-700 dark:text-slate-300">{summary.join(' · ')}</p>
            {canManage && !locked && (
              <button type="button" className={pencil} aria-label="Sửa thiết lập chung" title="Sửa thiết lập chung"
                onClick={(event) => { stop(event); setEditGeneral(true); }}>
                <Pencil className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        )}
        {editGeneral && issues['general.floor'] && <p className="mt-1.5 text-xs font-medium text-red-600">{issues['general.floor']}</p>}
      </div>

      {dirty && canManage && !locked && (
        <div className="flex justify-end gap-2" onClick={stop}>
          <Button size="sm" variant="secondary" disabled={saving}
            onClick={() => {
              if (isNew) { onDiscard?.(); return; }
              setForm(pickGeneral(version));
              setEditHead(false);
              setEditGeneral(false);
            }}>
            {isNew ? 'Bỏ bộ mới' : 'Huỷ thay đổi'}
          </Button>
          <Button size="sm" onClick={() => void save()} disabled={saving}>
            <Save className="h-3.5 w-3.5" /> {saving ? 'Đang lưu…' : 'Lưu bộ tham số'}
          </Button>
        </div>
      )}
    </section>
  );
}

function ListTableEditor({
  table, readOnly: viewOnly, issues, usage, taken, onChange, onToggleLock, onDuplicate,
}: {
  table: ListParamTable;
  readOnly: boolean;
  issues: Record<string, string | undefined>;
  usage: Map<string, Set<string>>;
  taken: (exclude?: string) => Set<string>;
  onChange: (patch: Partial<ListParamTable>) => void;
  onToggleLock: () => void;
  onDuplicate: () => void;
}) {
  // Bảng khoá: đứng yên cả bảng, chỉ còn nút mở khoá.
  const readOnly = viewOnly || !!table.locked;
  const setParam = (index: number, patch: Partial<ParamDef>) =>
    onChange({ params: table.params.map((param, i) => (i === index ? { ...param, ...patch } : param)) });

  const rename = (index: number, name: string) => {
    const param = table.params[index];
    const used = (usage.get(param.code)?.size ?? 0) > 0;
    // Mã đi theo tên cho tới khi tham số được dùng ở đâu đó — đổi mã lúc đó là làm vỡ công thức.
    const others = taken(param.code);
    const auto = !param.code || param.code === codeFromName(param.name, others, 'THAM_SO');
    setParam(index, { name, ...(auto && !used ? { code: name.trim() ? codeFromName(name, others, 'THAM_SO') : '' } : {}) });
  };

  const changeType = (index: number, type: ParamType) => {
    const unit = PARAM_TYPE_UNITS[type][0];
    setParam(index, { type, unit });
  };

  const add = () => onChange({
    params: [...table.params, { code: '', name: '', type: 'MONEY', unit: 'VND', value: 0, note: null }],
  });

  const cell = 'h-9 w-full rounded-none border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 px-2.5 text-sm outline-none transition hover:border-slate-300 dark:hover:border-slate-600 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/15 disabled:bg-slate-50 dark:disabled:bg-slate-900/50 disabled:text-slate-500 dark:disabled:text-slate-400';

  return (
    <Card className="!rounded-none">
      <CardContent className="space-y-4 py-4">
        <TableHeading
          name={table.name}
          note={table.note}
          countText=""
          readOnly={readOnly}
          locked={!!table.locked}
          canLock={!viewOnly}
          error={issues[`table.${table.id}`]}
          placeholder="VD: Bảo hiểm"
          onName={(name) => onChange({ name })}
          onNote={(note) => onChange({ note })}
          onToggleLock={onToggleLock}
          onDuplicate={!viewOnly ? onDuplicate : undefined}
        />

        {table.params.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[440px] text-sm">
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {table.params.map((param, index) => {
                  const issue = issues[`param.${table.id}.${index}`];
                  const used = [...(usage.get(param.code) ?? [])];
                  const rowLocked = !!param.locked;
                  const rowReadOnly = readOnly || rowLocked;
                  return (
                    <tr key={index} className={`align-top ${rowLocked ? 'bg-slate-50/70 dark:bg-slate-800/50' : ''}`}>
                      <td className="py-2 pr-3">
                        <input value={param.name} disabled={rowReadOnly} placeholder="VD: Tỷ lệ BHYT"
                          title={used.length > 0 ? `Đang dùng ở:\n${used.join('\n')}` : undefined}
                          onChange={(event) => rename(index, event.target.value)}
                          className={`${cell} font-semibold ${issue ? 'border-red-300 dark:border-red-500/60' : ''}`} />
                        {issue && <p className="mt-1 text-[11px] font-medium text-red-600 dark:text-red-400">{issue}</p>}
                      </td>
                      <td className="py-2 pr-3">
                        <Dropdown square compact value={param.type} disabled={rowReadOnly} options={PARAM_TYPE_OPTIONS}
                          aria-label="Loại tham số" onChange={(value) => changeType(index, value as ParamType)} />
                      </td>
                      <td className="py-2 pr-3">
                        <Dropdown square compact value={param.unit} disabled={rowReadOnly} aria-label="Đơn vị"
                          options={PARAM_TYPE_UNITS[param.type].map((unit) => ({ value: unit, label: PARAM_UNIT_LABEL[unit] }))}
                          onChange={(value) => setParam(index, { unit: value as ParamUnit })} />
                      </td>
                      <td className="py-2 pr-3">
                        <MoneyInput
                          value={param.value}
                          money={isMoneyUnit(param.unit)}
                          disabled={rowReadOnly}
                          aria-label={`Giá trị ${param.name || 'tham số'}`}
                          onChange={(value) => setParam(index, { value })}
                        />
                      </td>
                      <td className="py-2 text-right">
                        {/* Tham số không xoá được, chỉ khoá. Dòng mới thêm còn trống thì bỏ được (chưa có gì để giữ). */}
                        {!readOnly && !param.name.trim() && !param.code && !rowLocked ? (
                          <button type="button" aria-label="Bỏ dòng trống" title="Bỏ dòng trống"
                            onClick={() => onChange({ params: table.params.filter((_, i) => i !== index) })}
                            className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-300 hover:text-slate-600 dark:text-slate-600 dark:hover:text-slate-300 transition hover:bg-slate-100 dark:hover:bg-slate-800">
                            <X className="h-4 w-4" />
                          </button>
                        ) : !readOnly && (
                          <button type="button"
                            aria-label={`${rowLocked ? 'Mở khoá' : 'Khoá'} ${param.name || 'tham số'}`}
                            title={rowLocked ? 'Mở khoá tham số' : 'Khoá tham số — giữ nguyên số, không gợi ý ở công thức mới'}
                            onClick={() => setParam(index, { locked: !rowLocked })}
                            className={`flex h-9 w-9 items-center justify-center rounded-lg transition ${rowLocked ? 'text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/40' : 'text-slate-300 hover:text-slate-700 dark:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'}`}>
                            {rowLocked ? <Lock className="h-4 w-4" /> : <LockOpen className="h-4 w-4" />}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {table.params.length === 0 && <p className="py-2 text-center text-xs text-slate-400">Bảng chưa có tham số nào.</p>}
        {!readOnly && (
          <Button size="sm" variant="outline" onClick={add}><Plus className="h-3.5 w-3.5" /> Thêm tham số</Button>
        )}
      </CardContent>
    </Card>
  );
}

function TierTableEditor({
  table, readOnly: viewOnly, issue, usage, taken, onChange, onToggleLock, onDuplicate,
}: {
  table: TierParamTable;
  readOnly: boolean;
  issue?: string;
  usage: string[];
  taken: Set<string>;
  onChange: (patch: Partial<TierParamTable>) => void;
  onToggleLock: () => void;
  onDuplicate: () => void;
}) {
  const readOnly = viewOnly || !!table.locked;
  const progressive = table.mode === 'PROGRESSIVE';
  const rename = (name: string) => {
    const auto = table.code === codeFromName(table.name, taken, 'BANG');
    onChange({ name, ...(auto && usage.length === 0 && name.trim() ? { code: codeFromName(name, taken, 'BANG') } : {}) });
  };
  const setRow = (index: number, patch: Partial<TierParamTable['rows'][number]>) =>
    onChange({ rows: table.rows.map((row, i) => (i === index ? { ...row, ...patch } : row)) });
  const moneyLevel = !progressive && isMoneyUnit(table.unit);

  return (
    <Card className="!rounded-none">
      <CardContent className="space-y-4 py-4">
        <TableHeading
          name={table.name}
          note={table.note}
          countText=""
          readOnly={readOnly}
          locked={!!table.locked}
          canLock={!viewOnly}
          error={issue}
          placeholder="VD: Biểu thuế lũy tiến"
          onName={rename}
          onNote={(note) => onChange({ note })}
          onToggleLock={onToggleLock}
          onDuplicate={!viewOnly ? onDuplicate : undefined}
        />
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-full sm:w-52">
            <Dropdown square label="Cách tính" value={table.mode} disabled={readOnly} options={TIER_MODE_OPTIONS}
              onChange={(value) => onChange({ mode: value as TierParamTable['mode'], ...(value === 'PROGRESSIVE' ? { unit: '%' as ParamUnit } : {}) })} />
          </div>
          <div className="min-w-[12rem] flex-1">
            <Input className="!rounded-none" label="Giá trị đưa vào tra" value={table.inputLabel ?? ''} disabled={readOnly}
              onChange={(event) => onChange({ inputLabel: event.target.value || null })}
              placeholder={progressive ? 'VD: Thu nhập tính thuế' : 'VD: Tỷ lệ đạt doanh số (%)'} />
          </div>
          {!progressive && (
            <div className="w-full sm:w-52">
              <Dropdown square label="Đơn vị của mức" value={table.unit} disabled={readOnly} options={TIER_UNIT_OPTIONS}
                onChange={(value) => onChange({ unit: value as ParamUnit })} />
            </div>
          )}
        </div>
        <table className="w-full max-w-xl text-sm">
          <thead>
            <tr className="text-left text-[11px] font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
              <th className="pb-1.5 pr-3">{progressive ? 'Từ (≥)' : 'Từ ngưỡng (≥)'}</th>
              <th className="pb-1.5 pr-3 text-right">{progressive ? 'Tỷ lệ (%)' : `Mức (${PARAM_UNIT_LABEL[table.unit]})`}</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, index) => (
              <tr key={index}>
                <td className="py-1 pr-3">
                  <MoneyInput value={row.from} money={progressive} disabled={readOnly} aria-label={`Ngưỡng bậc ${index + 1}`}
                    onChange={(from) => setRow(index, { from })} />
                </td>
                <td className="py-1 pr-3">
                  <MoneyInput value={row.value} money={moneyLevel} disabled={readOnly} aria-label={`Mức bậc ${index + 1}`}
                    onChange={(value) => setRow(index, { value })} />
                </td>
                <td className="py-1 text-right">
                  {!readOnly && table.rows.length > 1 && (
                    <button type="button" aria-label={`Bỏ bậc ${index + 1}`} onClick={() => onChange({ rows: table.rows.filter((_, i) => i !== index) })}
                      className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-300 hover:text-red-600 dark:text-slate-600 dark:hover:text-red-400 transition hover:bg-red-50 dark:hover:bg-red-950/40">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!readOnly && (
          <Button size="sm" variant="outline" onClick={() => onChange({
            rows: [...table.rows, { from: (table.rows[table.rows.length - 1]?.from ?? 0) + (progressive ? 10_000_000 : 10), value: 0 }],
          })}><Plus className="h-3.5 w-3.5" /> Thêm bậc</Button>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Tên bảng làm tiêu đề, bút chì bên cạnh để sửa tên và ghi chú. Bảng vừa tạo
 * (chưa có tên) hoặc đang báo lỗi tên thì mở sẵn ô sửa.
 */
function TableHeading({
  name, note, countText, readOnly, locked, canLock, error, placeholder, onName, onNote, onToggleLock, onDuplicate,
}: {
  name: string;
  note: string | null;
  countText: string;
  /** Không sửa được tên/ghi chú (chỉ xem, hoặc bảng đã khoá). */
  readOnly: boolean;
  locked: boolean;
  /** Được phép khoá / mở khoá bảng. */
  canLock: boolean;
  error?: string;
  placeholder: string;
  onName: (name: string) => void;
  onNote: (note: string | null) => void;
  onToggleLock: () => void;
  /** Sao chép bảng này thành một bảng mới trong cùng bộ. Không truyền = không cho sao chép. */
  onDuplicate?: () => void;
}) {
  const [editing, setEditing] = useState(() => !name.trim());
  const showEditor = !readOnly && (editing || !!error);
  const iconButton = 'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition';
  return (
    <div className="flex items-start gap-3">
      {showEditor ? (
        <div className="grid min-w-0 flex-1 gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
          <Input className="!rounded-none" label="Tên bảng" autoFocus value={name} error={error} placeholder={placeholder}
            onChange={(event) => onName(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter' && name.trim()) setEditing(false); }} />
          <Input className="!rounded-none" label="Ghi chú" value={note ?? ''} placeholder="Không bắt buộc"
            onChange={(event) => onNote(event.target.value || null)}
            onKeyDown={(event) => { if (event.key === 'Enter' && name.trim()) setEditing(false); }} />
        </div>
      ) : (
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1">
            <h3 className="truncate text-base font-bold text-slate-900 dark:text-slate-100">{name.trim() || 'Bảng chưa đặt tên'}</h3>
            {locked && (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-100 dark:bg-amber-900/40 px-2.5 py-1 text-[11px] font-bold text-amber-800 dark:text-amber-300">
                <Lock className="h-3 w-3" /> Đã khoá
              </span>
            )}
            {!readOnly && (
              <button type="button" onClick={() => setEditing(true)} aria-label={`Sửa tên bảng ${name}`} title="Sửa tên bảng"
                className={`${iconButton} text-slate-400 hover:bg-indigo-50 dark:hover:bg-slate-800 hover:text-indigo-600 dark:hover:text-indigo-400`}>
                <Pencil className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <p className="truncate text-xs text-slate-500 dark:text-slate-400">{[note, countText].filter(Boolean).join(' · ')}</p>
        </div>
      )}
      <div className={`flex shrink-0 items-center gap-1 ${showEditor ? 'pt-7' : ''}`}>
        {showEditor && !error && name.trim() && (
          <button type="button" onClick={() => setEditing(false)} aria-label="Xong" title="Xong"
            className={`${iconButton} text-emerald-600 hover:bg-emerald-50 dark:hover:bg-slate-800`}>
            <Check className="h-4 w-4" />
          </button>
        )}
        {onDuplicate && (
          <button type="button" onClick={onDuplicate}
            aria-label={`Sao chép bảng ${name}`}
            title="Sao chép bảng — tạo bảng mới cùng cấu trúc trong bộ này"
            className={`${iconButton} text-slate-400 hover:bg-indigo-50 dark:hover:bg-slate-800 hover:text-indigo-600 dark:hover:text-indigo-400`}>
            <Copy className="h-3.5 w-3.5" />
          </button>
        )}
        {canLock && (
          <button type="button" onClick={onToggleLock}
            aria-label={`${locked ? 'Mở khoá' : 'Khoá'} bảng ${name}`}
            title={locked ? 'Mở khoá bảng' : 'Khoá bảng — giữ nguyên số, không gợi ý ở công thức mới'}
            className={`${iconButton} ${locked ? 'text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/40' : 'text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-slate-200'}`}>
            {locked ? <Lock className="h-4 w-4" /> : <LockOpen className="h-4 w-4" />}
          </button>
        )}
      </div>
    </div>
  );
}

function NumberField({
  label, value, onChange, step = 1, error, disabled, required,
}: {
  label: string; value: number; onChange: (v: number) => void; step?: number;
  error?: string; disabled?: boolean; required?: boolean;
}) {
  const [text, setText] = useState(Number.isFinite(value) ? String(value) : '');
  useEffect(() => {
    setText((current) => (Number(current) === value && current.trim() !== '' ? current : Number.isFinite(value) ? String(value) : ''));
  }, [value]);
  return (
    <Input className="!rounded-none"
      label={label}
      required={required}
      type="number"
      step={step}
      value={text}
      disabled={disabled}
      error={error}
      onChange={(event) => {
        const next = stripLeadingZeros(event.target.value);
        setText(next);
        onChange(next.trim() === '' ? Number.NaN : Number(next));
      }}
    />
  );
}
