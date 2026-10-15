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
  Check, CheckCircle2, Copy, FlaskConical, Layers, Lock, Pencil, Plus, Save, Settings2,
  Table2, Trash2, TriangleAlert,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
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
  codeFromName, copyVersion, deleteParamVersion, firstEditableMonth, newTableId, paramsOf, saveParamVersion,
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
  /** Mở Chạy thử với bộ đang soạn (chưa cần lưu). */
  onDryRun: (version: PayrollParamVersion) => void;
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
  data, lastClosedMonth, currentMonth, canManage, onSaved, onDryRun,
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

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<PayrollParamVersion | null>(null);
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  // Hộp "Tạo bảng": mở khi bấm một trong hai nút thêm bảng.
  const [creating, setCreating] = useState<'LIST' | 'TIER' | null>(null);
  const [createForm, setCreateForm] = useState<NewTableForm>(BLANK_NEW_TABLE);
  const [createError, setCreateError] = useState<string | null>(null);

  // Mở bộ đang áp dụng khi vào màn / khi dữ liệu mới về và người dùng chưa sửa dở.
  useEffect(() => {
    if (touched) return;
    const pick = sorted.find((version) => version.id === selectedId) ?? sorted.find((version) => version.id === activeId) ?? sorted[0];
    if (pick) {
      setSelectedId(pick.id);
      setDraft(cloneEditable(pick));
    }
  }, [sorted, activeId, selectedId, touched]);

  // Form tạo bảng thuộc về bộ đang soạn — đổi sang bộ khác thì đóng.
  useEffect(() => { setCreating(null); }, [selectedId]);

  const reserved = useMemo(
    () => new Set([...RESERVED_FORMULA_NAMES, ...data.components.map((component) => component.code)]),
    [data.components],
  );
  const issues = draft ? validateParamVersion(draft, reserved) : {};
  const issueCount = Object.keys(issues).length;
  const locked = !!draft?.id && !!lastClosedMonth && draft.effectiveFrom <= lastClosedMonth;
  const readOnly = !canManage || locked;
  const minMonth = firstEditableMonth(lastClosedMonth, getTodayString());

  /** Tham số / bảng đang được dùng ở công thức nào — để không xoá nhầm. */
  const usage = useMemo(() => {
    const map = new Map<string, Set<string>>();
    const add = (code: string, where: string) => map.set(code, new Set([...(map.get(code) ?? []), where]));
    const componentById = new Map(data.components.map((component) => [component.id, component]));
    const templateById = new Map(data.templates.map((template) => [template.id, template]));
    for (const item of data.templateItems) {
      if (!item.formula || (item.effective_to && item.effective_to < currentMonth)) continue;
      const where = `${templateById.get(item.template_id)?.name ?? 'Cơ chế'} · ${componentById.get(item.component_id)?.name ?? '?'}`;
      for (const code of [...referencedCodes(item.formula), ...referencedFunctions(item.formula)]) add(code, where);
    }
    for (const item of [...data.items, ...data.unitItems]) {
      if (!item.formula || item.effective_to) continue;
      for (const code of [...referencedCodes(item.formula), ...referencedFunctions(item.formula)]) add(code, 'Công thức khai riêng');
    }
    return map;
  }, [currentMonth, data.components, data.items, data.templateItems, data.templates, data.unitItems]);

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

  const select = (version: PayrollParamVersion) => {
    setTouched(false);
    setSelectedId(version.id);
    setDraft(cloneEditable(version));
  };

  const startNew = () => {
    const base = draft ?? sorted[0];
    setTouched(true);
    setSelectedId(null);
    setDraft(base ? copyVersion(base, minMonth) : blankVersion(minMonth));
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
    setCreating(null);
  };

  const removeTable = async (table: ParamTable) => {
    if (!draft) return;
    const codes = table.kind === 'LIST' ? table.params.map((param) => param.code) : [table.code];
    const used = codes.flatMap((code) => [...(usage.get(code) ?? [])]);
    const ok = await confirm({
      title: `Xoá bảng “${table.name}”?`,
      message: used.length > 0
        ? `Bảng có tham số đang dùng ở: ${[...new Set(used)].slice(0, 6).join('; ')}. Xoá thì các công thức đó báo lỗi cho tới khi sửa.`
        : 'Bảng và các tham số trong bảng sẽ bị bỏ khỏi bộ tham số này.',
      confirmLabel: 'Xoá bảng',
      danger: true,
    });
    if (!ok) return;
    update({ tables: draft.tables.filter((item) => item.id !== table.id) });
  };

  const save = async () => {
    if (!draft) return;
    if (issueCount > 0) {
      toast('Còn ô chưa hợp lệ — sửa các ô đánh dấu đỏ.', 'warning');
      return;
    }
    const clash = versions.find((version) => version.effectiveFrom === draft.effectiveFrom && version.id !== draft.id);
    if (clash) {
      toast(`Đã có bộ tham số hiệu lực từ ${monthLabel(draft.effectiveFrom)} — mở bộ đó để sửa.`, 'warning');
      return;
    }
    const ok = await confirm({
      title: draft.id ? 'Lưu thay đổi bộ tham số?' : `Lưu bộ tham số mới hiệu lực từ ${monthLabel(draft.effectiveFrom)}?`,
      message: `Áp dụng cho kỳ lương từ ${monthLabel(draft.effectiveFrom)} cho tới bộ kế tiếp. Kỳ chưa khoá trong khoảng đó tính theo số mới khi chạy lại bảng lương; kỳ đã khoá giữ nguyên.`,
      confirmLabel: 'Lưu bộ tham số',
    });
    if (!ok) return;
    setSaving(true);
    const { error, id } = await saveParamVersion(draft);
    setSaving(false);
    if (error) {
      toast('Lưu thất bại: ' + error, 'error');
      return;
    }
    toast('Đã lưu bộ tham số lương.', 'success');
    setTouched(false);
    setSelectedId(id);
    onSaved();
  };

  const remove = async () => {
    if (!draft?.id) return;
    const ok = await confirm({
      title: `Xoá bộ tham số hiệu lực từ ${monthLabel(draft.effectiveFrom)}?`,
      message: 'Các tháng đang theo bộ này sẽ quay về bộ liền trước. Chỉ xoá được bộ chưa dùng cho kỳ lương đã khoá.',
      confirmLabel: 'Xoá bộ tham số',
      danger: true,
    });
    if (!ok) return;
    const error = await deleteParamVersion(draft.id);
    if (error) {
      toast('Xoá thất bại: ' + error, 'error');
      return;
    }
    toast('Đã xoá bộ tham số.', 'success');
    setTouched(false);
    setSelectedId(null);
    onSaved();
  };

  if (sorted.length === 0 && !draft) {
    return (
      <Card>
        <CardContent className="space-y-3 py-10 text-center">
          <Table2 className="mx-auto h-10 w-10 text-slate-300" />
          <p className="text-sm text-slate-500">Chưa có bộ tham số lương nào.</p>
          {canManage && (
            <Button onClick={startNew}><Plus className="h-4 w-4" /> Tạo bộ tham số đầu tiên</Button>
          )}
        </CardContent>
      </Card>
    );
  }
  if (!draft) return null;

  const versionOptionLabel = (version: PayrollParamVersion) => {
    const isLocked = !!lastClosedMonth && version.effectiveFrom <= lastClosedMonth;
    return [
      `Từ ${monthLabel(version.effectiveFrom)}`,
      version.label,
      version.id === activeId ? 'đang áp dụng' : null,
      isLocked ? 'đã dùng cho kỳ chốt' : null,
    ].filter(Boolean).join(' · ');
  };
  const unsavedNew = touched && !draft.id;
  const activeVersion = sorted.find((version) => version.id === activeId) ?? null;

  return (
    <div className={`space-y-4 ${touched ? 'pb-24' : ''}`}>
      {/* --- 1. Bộ tham số đang áp dụng + chọn bộ, hiệu lực, thao tác --- */}
      <section className="overflow-hidden rounded-2xl border border-indigo-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center gap-4 bg-gradient-to-r from-indigo-700 via-indigo-600 to-indigo-500 px-5 py-4 text-white">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/25">
            <Table2 className="h-6 w-6" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-indigo-100">
              Bộ tham số đang áp dụng · kỳ lương {monthLabel(currentMonth)}
            </p>
            <p className="mt-0.5 truncate text-xl font-extrabold">
              {activeVersion
                ? `Từ ${monthLabel(activeVersion.effectiveFrom)}${activeVersion.label ? ` · ${activeVersion.label}` : ''}`
                : 'Chưa có bộ nào hiệu lực'}
            </p>
          </div>
          {unsavedNew ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-400 px-3 py-1.5 text-xs font-bold text-amber-950">
              Bộ mới chưa lưu · từ {monthLabel(draft.effectiveFrom)}
            </span>
          ) : draft.id === activeId ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1.5 text-xs font-bold ring-1 ring-white/30">
              <CheckCircle2 className="h-3.5 w-3.5" /> Đang xem bộ này
            </span>
          ) : activeVersion ? (
            <button
              type="button"
              onClick={() => select(activeVersion)}
              className="inline-flex items-center gap-1.5 rounded-full bg-white px-3.5 py-1.5 text-xs font-bold text-indigo-700 shadow-sm transition hover:bg-indigo-50"
            >
              Về bộ đang áp dụng
            </button>
          ) : null}
        </div>

        <div className="space-y-4 p-5">
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-full sm:w-72">
              <Dropdown
                label="Bộ đang xem"
                value={unsavedNew ? '__new' : (selectedId ?? '')}
                options={[
                  ...(unsavedNew ? [{ value: '__new', label: `Bộ mới (chưa lưu) · từ ${monthLabel(draft.effectiveFrom)}` }] : []),
                  ...sorted.map((version) => ({ value: version.id ?? '', label: versionOptionLabel(version) })),
                ]}
                onChange={(value) => {
                  const picked = sorted.find((version) => version.id === value);
                  if (picked) select(picked);
                }}
              />
            </div>
            <div className="w-full sm:w-44">
              <Input
                label="Áp dụng từ tháng"
                required
                type="month"
                value={draft.effectiveFrom.slice(0, 7)}
                min={draft.id ? undefined : minMonth.slice(0, 7)}
                disabled={readOnly || (!!draft.id && draft.effectiveFrom.startsWith('2000-01'))}
                onChange={(event) => update({ effectiveFrom: event.target.value ? `${event.target.value}-01` : '' })}
                error={issues['general.effectiveFrom']}
              />
            </div>
            <div className="min-w-[10rem] flex-1">
              <Input label="Tên bộ" value={draft.label ?? ''} disabled={!canManage}
                onChange={(event) => update({ label: event.target.value })} placeholder="VD: Chính sách 2026" />
            </div>
            <div className="min-w-[12rem] flex-[1.4]">
              <Input label="Căn cứ" value={draft.note ?? ''} disabled={!canManage}
                onChange={(event) => update({ note: event.target.value })} placeholder="VD: Quyết định số 05/QĐ" />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
            <div className="flex min-w-0 items-center gap-2 text-xs">
              {locked && (
                <span className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-2.5 py-1.5 font-semibold text-slate-600">
                  <Lock className="h-3.5 w-3.5" /> Đã dùng cho kỳ chốt — chỉ xem
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {canManage && (
                <Button size="sm" variant="outline" onClick={startNew}>
                  <Copy className="h-3.5 w-3.5" /> Thêm bộ mới
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={() => onDryRun(draft)} disabled={issueCount > 0}>
                <FlaskConical className="h-3.5 w-3.5" /> Chạy thử
              </Button>
              {canManage && draft.id && !locked && sorted.length > 1 && (
                <Button size="sm" variant="ghost" onClick={() => void remove()} className="text-red-600 hover:bg-red-50">
                  <Trash2 className="h-3.5 w-3.5" /> Xoá bộ
                </Button>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* --- 2. Thiết lập chung --- */}
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Settings2 className="h-4 w-4 text-slate-500" /> Thiết lập chung</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <NumberField label="Công chuẩn mặc định (ngày)" required value={draft.standardWorkDays} step={0.5}
              disabled={readOnly} error={issues['general.standardWorkDays']} onChange={(v) => update({ standardWorkDays: v })} />
            <Dropdown label="Làm tròn thực lĩnh tới" value={String(draft.netRoundingUnit)} disabled={readOnly}
              options={ROUNDING_UNITS.map((unit) => ({ value: String(unit), label: unit === 1 ? 'Không làm tròn' : formatVND(unit) }))}
              onChange={(value) => update({ netRoundingUnit: Number(value) as NetRoundingUnit })} />
            <Dropdown label="Cách làm tròn" value={draft.netRoundingMode} disabled={readOnly || draft.netRoundingUnit === 1}
              options={[
                { value: 'NEAREST', label: 'Gần nhất' },
                { value: 'DOWN', label: 'Luôn xuống' },
                { value: 'UP', label: 'Luôn lên' },
              ]}
              onChange={(value) => update({ netRoundingMode: value as NetRoundingMode })} />
          </div>
          <div>
            <p className="mb-1.5 text-sm font-semibold text-slate-700">Mức sàn khi trình cơ chế</p>
            <div className="grid items-center gap-2 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
              <Dropdown aria-label="Đầu mục cần kiểm tra" searchable value={draft.floorComponentCode ?? ''} disabled={readOnly}
                options={[
                  { value: '', label: 'Không kiểm tra' },
                  ...data.components.filter((component) => component.is_active)
                    .map((component) => ({ value: component.code, label: component.name })),
                ]}
                onChange={(value) => update({ floorComponentCode: value || null })} />
              <span className="text-center text-sm font-bold text-slate-400">≥</span>
              <Dropdown aria-label="Tham số làm mức sàn" searchable value={draft.floorParamCode ?? ''} disabled={readOnly}
                options={[
                  { value: '', label: 'Chọn tham số…' },
                  ...paramsOf(draft).map((param) => ({
                    value: param.code, label: param.name, detail: formatWithUnit(param.value, param.unit),
                  })),
                ]}
                onChange={(value) => update({ floorParamCode: value || null })} />
            </div>
            {issues['general.floor'] && <p className="mt-1.5 text-xs font-medium text-red-600">{issues['general.floor']}</p>}
          </div>
        </CardContent>
      </Card>

      {/* --- 3. Các bảng tham số --- */}
      {!readOnly && (
        <div className="flex flex-wrap justify-end gap-2">
          <Button size="sm" variant="outline" onClick={() => openCreate('LIST')}>
            <Plus className="h-3.5 w-3.5" /> Bảng tham số
          </Button>
          <Button size="sm" variant="outline" onClick={() => openCreate('TIER')}>
            <Layers className="h-3.5 w-3.5" /> Bảng bậc thang
          </Button>
        </div>
      )}

      {draft.tables.length === 0 && (
        <Card><CardContent className="py-10 text-center text-sm text-slate-500">Bộ này chưa có bảng nào.</CardContent></Card>
      )}
      {draft.tables.map((table) => (table.kind === 'LIST' ? (
        <ListTableEditor
          key={table.id}
          table={table}
          readOnly={readOnly}
          issues={issues}
          usage={usage}
          taken={(exclude) => takenCodes(exclude)}
          onChange={(patch) => updateTable(table.id, patch)}
          onRemove={() => void removeTable(table)}
          confirmRemoveParam={async (param) => {
            const used = [...(usage.get(param.code) ?? [])];
            if (used.length === 0) return true;
            return confirm({
              title: `Xoá tham số “${param.name}”?`,
              message: `Đang dùng ở: ${used.slice(0, 6).join('; ')}. Xoá thì các công thức đó báo lỗi cho tới khi sửa.`,
              confirmLabel: 'Vẫn xoá',
              danger: true,
            });
          }}
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
          onRemove={() => void removeTable(table)}
        />
      )))}

      {/* --- 4. Tạo bảng --- */}
      <Modal
        open={!!creating && !readOnly}
        onClose={() => setCreating(null)}
        title={creating === 'TIER' ? 'Tạo bảng bậc thang' : 'Tạo bảng tham số'}
        size="md"
      >
        <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); createTable(); }} noValidate>
          <Input label="Tên bảng" required autoFocus value={createForm.name}
            placeholder={creating === 'TIER' ? 'VD: Biểu thuế lũy tiến' : 'VD: Bảo hiểm'}
            error={createError ?? undefined}
            onChange={(event) => { setCreateError(null); setCreateForm({ ...createForm, name: event.target.value }); }} />
          <Input label="Ghi chú" value={createForm.note} placeholder="Không bắt buộc"
            onChange={(event) => setCreateForm({ ...createForm, note: event.target.value })} />
          {creating === 'TIER' && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Dropdown label="Cách tính" value={createForm.mode} options={TIER_MODE_OPTIONS}
                onChange={(value) => setCreateForm({
                  ...createForm,
                  mode: value as TierParamTable['mode'],
                  ...(value === 'PROGRESSIVE' ? { unit: '%' as ParamUnit } : {}),
                })} />
              {createForm.mode === 'LOOKUP' && (
                <Dropdown label="Đơn vị của mức" value={createForm.unit} options={TIER_UNIT_OPTIONS}
                  onChange={(value) => setCreateForm({ ...createForm, unit: value as ParamUnit })} />
              )}
              <div className="sm:col-span-2">
                <Input label="Giá trị đưa vào tra" value={createForm.inputLabel}
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
        <div className="fixed bottom-0 left-0 right-0 z-30 border-t border-slate-200 bg-white/95 px-4 py-3 shadow-lg backdrop-blur-md print:hidden">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 lg:pl-64">
            <p className={`flex items-center gap-1.5 text-sm ${issueCount > 0 ? 'text-red-600' : 'text-slate-600'}`}>
              {issueCount > 0
                ? <><TriangleAlert className="h-4 w-4" /> {issueCount} ô chưa hợp lệ</>
                : <><Save className="h-4 w-4" /> Có thay đổi chưa lưu — bộ hiệu lực từ {monthLabel(draft.effectiveFrom)}</>}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => { setTouched(false); setSelectedId(selectedId ?? activeId); }} disabled={saving}>
                Huỷ thay đổi
              </Button>
              {canManage && !locked && (
                <Button onClick={() => void save()} disabled={saving || issueCount > 0}>
                  <Save className="h-4 w-4" /> {saving ? 'Đang lưu…' : 'Lưu bộ tham số'}
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ListTableEditor({
  table, readOnly, issues, usage, taken, onChange, onRemove, confirmRemoveParam,
}: {
  table: ListParamTable;
  readOnly: boolean;
  issues: Record<string, string | undefined>;
  usage: Map<string, Set<string>>;
  taken: (exclude?: string) => Set<string>;
  onChange: (patch: Partial<ListParamTable>) => void;
  onRemove: () => void;
  confirmRemoveParam: (param: ParamDef) => Promise<boolean>;
}) {
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

  const cell = 'h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-sm outline-none transition hover:border-slate-300 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/15 disabled:bg-slate-50 disabled:text-slate-500';

  return (
    <Card>
      <CardContent className="space-y-4 py-4">
        <TableHeading
          name={table.name}
          note={table.note}
          countText={`${table.params.length} tham số`}
          readOnly={readOnly}
          error={issues[`table.${table.id}`]}
          placeholder="VD: Bảo hiểm"
          onName={(name) => onChange({ name })}
          onNote={(note) => onChange({ note })}
          onRemove={onRemove}
        />

        {table.params.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  <th className="py-2 pr-3">Tên tham số</th>
                  <th className="w-32 py-2 pr-3">Loại</th>
                  <th className="w-40 py-2 pr-3">Đơn vị</th>
                  <th className="w-44 py-2 pr-3 text-right">Giá trị</th>
                  <th className="w-10 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {table.params.map((param, index) => {
                  const issue = issues[`param.${table.id}.${index}`];
                  const used = [...(usage.get(param.code) ?? [])];
                  return (
                    <tr key={index} className="align-top">
                      <td className="py-2 pr-3">
                        <input value={param.name} disabled={readOnly} placeholder="VD: Tỷ lệ BHYT"
                          title={used.length > 0 ? `Đang dùng ở:\n${used.join('\n')}` : undefined}
                          onChange={(event) => rename(index, event.target.value)}
                          className={`${cell} font-semibold ${issue ? 'border-red-300' : ''}`} />
                        {issue && <p className="mt-1 text-[11px] font-medium text-red-600">{issue}</p>}
                      </td>
                      <td className="py-2 pr-3">
                        <Dropdown compact value={param.type} disabled={readOnly} options={PARAM_TYPE_OPTIONS}
                          aria-label="Loại tham số" onChange={(value) => changeType(index, value as ParamType)} />
                      </td>
                      <td className="py-2 pr-3">
                        <Dropdown compact value={param.unit} disabled={readOnly} aria-label="Đơn vị"
                          options={PARAM_TYPE_UNITS[param.type].map((unit) => ({ value: unit, label: PARAM_UNIT_LABEL[unit] }))}
                          onChange={(value) => setParam(index, { unit: value as ParamUnit })} />
                      </td>
                      <td className="py-2 pr-3">
                        <MoneyInput
                          value={param.value}
                          money={isMoneyUnit(param.unit)}
                          disabled={readOnly}
                          aria-label={`Giá trị ${param.name || 'tham số'}`}
                          onChange={(value) => setParam(index, { value })}
                        />
                      </td>
                      <td className="py-2 text-right">
                        {!readOnly && (
                          <button type="button" aria-label={`Xoá ${param.name || 'tham số'}`}
                            onClick={async () => { if (await confirmRemoveParam(param)) onChange({ params: table.params.filter((_, i) => i !== index) }); }}
                            className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-300 transition hover:bg-red-50 hover:text-red-600">
                            <Trash2 className="h-4 w-4" />
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
  table, readOnly, issue, usage, taken, onChange, onRemove,
}: {
  table: TierParamTable;
  readOnly: boolean;
  issue?: string;
  usage: string[];
  taken: Set<string>;
  onChange: (patch: Partial<TierParamTable>) => void;
  onRemove: () => void;
}) {
  const progressive = table.mode === 'PROGRESSIVE';
  const rename = (name: string) => {
    const auto = table.code === codeFromName(table.name, taken, 'BANG');
    onChange({ name, ...(auto && usage.length === 0 && name.trim() ? { code: codeFromName(name, taken, 'BANG') } : {}) });
  };
  const setRow = (index: number, patch: Partial<TierParamTable['rows'][number]>) =>
    onChange({ rows: table.rows.map((row, i) => (i === index ? { ...row, ...patch } : row)) });
  const moneyLevel = !progressive && isMoneyUnit(table.unit);

  return (
    <Card>
      <CardContent className="space-y-4 py-4">
        <TableHeading
          name={table.name}
          note={table.note}
          countText={`${table.rows.length} bậc`}
          readOnly={readOnly}
          error={issue}
          placeholder="VD: Biểu thuế lũy tiến"
          onName={rename}
          onNote={(note) => onChange({ note })}
          onRemove={onRemove}
        />
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-full sm:w-52">
            <Dropdown label="Cách tính" value={table.mode} disabled={readOnly} options={TIER_MODE_OPTIONS}
              onChange={(value) => onChange({ mode: value as TierParamTable['mode'], ...(value === 'PROGRESSIVE' ? { unit: '%' as ParamUnit } : {}) })} />
          </div>
          <div className="min-w-[12rem] flex-1">
            <Input label="Giá trị đưa vào tra" value={table.inputLabel ?? ''} disabled={readOnly}
              onChange={(event) => onChange({ inputLabel: event.target.value || null })}
              placeholder={progressive ? 'VD: Thu nhập tính thuế' : 'VD: Tỷ lệ đạt doanh số (%)'} />
          </div>
          {!progressive && (
            <div className="w-full sm:w-52">
              <Dropdown label="Đơn vị của mức" value={table.unit} disabled={readOnly} options={TIER_UNIT_OPTIONS}
                onChange={(value) => onChange({ unit: value as ParamUnit })} />
            </div>
          )}
        </div>
        <table className="w-full max-w-xl text-sm">
          <thead>
            <tr className="text-left text-[11px] font-bold uppercase tracking-wider text-slate-400">
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
                      className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-300 transition hover:bg-red-50 hover:text-red-600">
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
  name, note, countText, readOnly, error, placeholder, onName, onNote, onRemove,
}: {
  name: string;
  note: string | null;
  countText: string;
  readOnly: boolean;
  error?: string;
  placeholder: string;
  onName: (name: string) => void;
  onNote: (note: string | null) => void;
  onRemove: () => void;
}) {
  const [editing, setEditing] = useState(() => !name.trim());
  const showEditor = !readOnly && (editing || !!error);
  const iconButton = 'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition';
  return (
    <div className="flex items-start gap-3">
      {showEditor ? (
        <div className="grid min-w-0 flex-1 gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
          <Input label="Tên bảng" autoFocus value={name} error={error} placeholder={placeholder}
            onChange={(event) => onName(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter' && name.trim()) setEditing(false); }} />
          <Input label="Ghi chú" value={note ?? ''} placeholder="Không bắt buộc"
            onChange={(event) => onNote(event.target.value || null)}
            onKeyDown={(event) => { if (event.key === 'Enter' && name.trim()) setEditing(false); }} />
        </div>
      ) : (
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1">
            <h3 className="truncate text-base font-bold text-slate-900">{name.trim() || 'Bảng chưa đặt tên'}</h3>
            {!readOnly && (
              <button type="button" onClick={() => setEditing(true)} aria-label={`Sửa tên bảng ${name}`} title="Sửa tên bảng"
                className={`${iconButton} text-slate-400 hover:bg-indigo-50 hover:text-indigo-600`}>
                <Pencil className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <p className="truncate text-xs text-slate-500">{[note, countText].filter(Boolean).join(' · ')}</p>
        </div>
      )}
      <div className={`flex shrink-0 items-center gap-1 ${showEditor ? 'pt-7' : ''}`}>
        {showEditor && !error && name.trim() && (
          <button type="button" onClick={() => setEditing(false)} aria-label="Xong" title="Xong"
            className={`${iconButton} text-emerald-600 hover:bg-emerald-50`}>
            <Check className="h-4 w-4" />
          </button>
        )}
        {!readOnly && (
          <button type="button" onClick={onRemove} aria-label={`Xoá bảng ${name}`} title="Xoá bảng"
            className={`${iconButton} text-slate-400 hover:bg-red-50 hover:text-red-600`}>
            <Trash2 className="h-4 w-4" />
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
    <Input
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
