// ============================================================================
// Bộ KPI theo SƠ ĐỒ TỔ CHỨC — cùng bố cục với Cơ chế lương.
// ----------------------------------------------------------------------------
// Cây đơn vị bên trái; chọn đơn vị → hai thẻ:
//
//   Nhân sự     ai đang theo bộ nào (riêng / theo vị trí / KPI chung của đơn
//               vị nào). Bấm một người là mở thẳng form KPI của người đó: sửa
//               rồi Lưu — đang theo KPI chung thì lưu thành bộ riêng.
//   KPI chung   form bộ cả đơn vị cùng theo; đơn vị con thừa hưởng theo
//               `unitLineage`, lưu ở đơn vị con là khai bộ chung riêng.
//
// Bộ KPI không xoá được, chỉ khoá (ngừng áp dụng) — khoá bộ riêng thì người
// về KPI chung, khoá KPI chung thì đơn vị về bộ của cấp trên.
//
// Khi mở kỳ, mỗi người nhận bộ gần nhất: riêng > vị trí > KPI chung của đơn vị
// gần nhất (kpi_set_for). Bộ mẫu không tự áp cho ai, nằm ở cuối cây để chép.
// Form soạn bộ nằm thẳng trên trang, không hộp thoại.
// ============================================================================

import { useEffect, useMemo, useState } from 'react';
import { startOfMonth } from 'date-fns';
import {
  ArrowLeft, Building2, ChevronRight, FileStack, Lock, LockOpen, Pencil, Plus, Search, Users,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Avatar } from '@/components/ui/Avatar';
import { UnitTreeList, flattenUnitTree } from '@/components/payroll/UnitTree';
import { ExportButtons } from '@/components/payroll/ExportButtons';
import { Pager, clampPage } from '@/components/payroll/Pager';
import { IconButton, KpiSetEditor, type KpiSetTarget } from '@/components/kpi/KpiSetEditor';
import { useToast } from '@/contexts/ToastContext';
import { useConfirm } from '@/contexts/ConfirmContext';
import { unitLineage } from '@/lib/orgUnits';
import { toDateString } from '@/lib/utils';
import {
  BLOCK_LABEL, fmtNum, fold, kpiSetFor, weightTotals, type KpiSet, type ResolvedKpiSet,
} from '@/lib/kpi';
import { setExempt, setSetActive, type KpiWorkspace } from '@/lib/kpiData';
import type { Profile } from '@/types';

const NO_UNIT = '__none__';
const TEMPLATES = '__templates__';
const PEOPLE_PER_PAGE = 15;

interface EditorState {
  target: KpiSetTarget;
  set: KpiSet | null;
  copyFrom: KpiSet | null;
  defaultName?: string;
}

const isShared = (set: KpiSet) => !set.user_id && !set.position_id && !!set.unit_id;
const isTemplate = (set: KpiSet) => !set.user_id && !set.position_id && !set.unit_id;
const byNewest = (a: KpiSet, b: KpiSet) => b.effective_from.localeCompare(a.effective_from);
const monthText = (date: string) => `${date.slice(5, 7)}/${date.slice(0, 4)}`;

export function KpiSetBoard({ data, onChanged }: { data: KpiWorkspace; onChanged: () => void }) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const month = useMemo(() => toDateString(startOfMonth(new Date())), []);

  const rows = useMemo(() => flattenUnitTree(data.units), [data.units]);
  const activeUnitIds = useMemo(() => new Set(rows.map((row) => row.unit.id)), [rows]);
  const unitById = useMemo(() => new Map(data.units.map((unit) => [unit.id, unit])), [data.units]);
  const positionById = useMemo(() => new Map(data.positions.map((position) => [position.id, position])), [data.positions]);
  const itemsBySet = useMemo(() => {
    const map = new Map<string, KpiWorkspace['setItems']>();
    for (const item of data.setItems) map.set(item.set_id, [...(map.get(item.set_id) ?? []), item]);
    return map;
  }, [data.setItems]);
  const exempt = useMemo(() => new Set(data.exemptions.map((row) => row.user_id)), [data.exemptions]);

  const [unitId, setUnitId] = useState<string | null>(() => rows[0]?.unit.id ?? null);
  const [personId, setPersonId] = useState<string | null>(null);
  const [tab, setTab] = useState<'people' | 'shared'>('people');
  const [includeChildren, setIncludeChildren] = useState(false);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [titleSlot, setTitleSlot] = useState<HTMLElement | null>(null);

  const lineageIds = (id: string | null | undefined) => unitLineage(id, unitById).map((unit) => unit.id);
  const resolve = (person: Profile) => kpiSetFor(person, data.sets, lineageIds(person.unit_id), month);

  /** Đơn vị và mọi đơn vị con (đi theo parent_id, chặn vòng). */
  const descendantsOf = (rootId: string): Set<string> => {
    const result = new Set([rootId]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const unit of data.units) {
        if (unit.parent_id && result.has(unit.parent_id) && !result.has(unit.id)) {
          result.add(unit.id);
          grew = true;
        }
      }
    }
    return result;
  };

  const people = useMemo(() => {
    if (query.trim()) {
      const keyword = fold(query);
      return data.profiles.filter((person) => fold(person.name).includes(keyword) || fold(person.employee_code ?? '').includes(keyword));
    }
    if (unitId === NO_UNIT) return data.profiles.filter((person) => !person.unit_id || !activeUnitIds.has(person.unit_id));
    if (!unitId || unitId === TEMPLATES) return [];
    const ids = includeChildren ? descendantsOf(unitId) : new Set([unitId]);
    return data.profiles.filter((person) => person.unit_id && ids.has(person.unit_id));
  }, [activeUnitIds, data.profiles, includeChildren, query, unitId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { setPage(1); }, [unitId, query, includeChildren]);
  const currentPage = clampPage(page, people.length, PEOPLE_PER_PAGE);
  const pagePeople = people.slice((currentPage - 1) * PEOPLE_PER_PAGE, currentPage * PEOPLE_PER_PAGE);

  const unassignedCount = data.profiles.filter((person) => !person.unit_id || !activeUnitIds.has(person.unit_id)).length;
  const templates = data.sets.filter(isTemplate).sort((a, b) => a.name.localeCompare(b.name, 'vi'));
  const unit = unitId && unitId !== NO_UNIT && unitId !== TEMPLATES ? unitById.get(unitId) ?? null : null;
  const person = personId ? data.profiles.find((row) => row.id === personId) ?? null : null;
  const unitHasShared = (id: string) => data.sets.some((set) => isShared(set) && set.unit_id === id && set.is_active);

  // ---------------------------------------------------------------- việc chung
  const sourceText = (resolved: ResolvedKpiSet | null) => {
    if (!resolved) return '';
    if (resolved.level === 'PERSON') return 'Bộ riêng';
    if (resolved.level === 'POSITION') return `Theo vị trí ${positionById.get(resolved.set.position_id!)?.title ?? ''}`.trim();
    return `KPI chung · ${unitById.get(resolved.unitId!)?.name ?? '—'}`;
  };

  const statusOf = (row: Profile, resolved: ResolvedKpiSet | null) => {
    if (exempt.has(row.id)) return { label: 'Không áp dụng', tone: 'bg-slate-100 text-slate-500' };
    if (!resolved) return { label: 'Chưa có KPI', tone: 'bg-red-50 text-red-600' };
    const total = weightTotals(itemsBySet.get(resolved.set.id) ?? []).total;
    if (Math.abs(total - 100) > 0.01) return { label: `Tổng ${fmtNum(total)}%`, tone: 'bg-amber-50 text-amber-700' };
    return { label: 'Đủ', tone: 'bg-emerald-50 text-emerald-700' };
  };

  /** Khoá / mở khoá — bộ KPI không xoá, khoá là ngừng áp dụng, phiếu đã tạo giữ nguyên. */
  const toggleSet = async (set: KpiSet) => {
    if (set.is_active && !(await confirm({
      title: `Khoá “${set.name}”?`,
      message: 'Từ kỳ mở sau, người đang theo bộ này về bộ của cấp trên. Phiếu đã tạo giữ nguyên; mở khoá lại được bất cứ lúc nào.',
      confirmLabel: 'Khoá',
    }))) return;
    const error = await setSetActive(set.id, !set.is_active);
    if (error) toast(error, 'error'); else { toast(set.is_active ? 'Đã khoá bộ KPI.' : 'Đã mở khoá, bộ KPI áp dụng lại.'); onChanged(); }
  };

  const toggleExempt = async (row: Profile) => {
    const error = await setExempt(row.id, !exempt.has(row.id));
    if (error) toast(error, 'error'); else onChanged();
  };

  const targetOf = (set: KpiSet): KpiSetTarget => {
    if (set.user_id) return { kind: 'PERSON', id: set.user_id, label: `Bộ riêng · ${data.profiles.find((row) => row.id === set.user_id)?.name ?? 'Nhân sự đã nghỉ'}` };
    if (set.position_id) return { kind: 'POSITION', id: set.position_id, label: `Theo vị trí · ${positionById.get(set.position_id)?.title ?? '—'}` };
    if (set.unit_id) return { kind: 'UNIT', id: set.unit_id, label: `KPI chung · ${unitById.get(set.unit_id)?.name ?? '—'} (gồm đơn vị con)` };
    return { kind: 'TEMPLATE', id: null, label: 'Bộ mẫu — không tự áp cho ai, dùng để chép' };
  };
  const editSet = (set: KpiSet) => setEditor({ target: targetOf(set), set, copyFrom: null });

  const selectUnit = (id: string) => { setUnitId(id); setPersonId(null); setQuery(''); setEditor(null); };

  const exportOptions = () => ({
    filename: 'kpi-nhan-su',
    sheetName: 'KPI nhân sự',
    title: 'BỘ KPI ĐANG ÁP CHO TỪNG NGƯỜI',
    subtitle: `${unit?.name ?? 'Kết quả tìm'} · ${people.length} người · tháng ${monthText(month)}`,
    columns: [
      { header: 'Mã NV', value: (row: Profile) => row.employee_code ?? '', width: 12 },
      { header: 'Họ tên', value: (row: Profile) => row.name, width: 28 },
      { header: 'Đơn vị', value: (row: Profile) => (row.unit_id ? unitById.get(row.unit_id)?.name ?? '' : ''), width: 24 },
      { header: 'Bộ KPI', value: (row: Profile) => (exempt.has(row.id) ? '' : resolve(row)?.set.name ?? ''), width: 32 },
      { header: 'Nguồn', value: (row: Profile) => (exempt.has(row.id) ? '' : sourceText(resolve(row))), width: 28 },
      { header: 'Tình trạng', value: (row: Profile) => statusOf(row, resolve(row)).label, width: 14 },
    ],
    rows: people,
  });

  // ---------------------------------------------------------------- vẽ
  const right = (() => {
    if (editor) {
      return (
        <KpiSetEditor
          key={editor.set?.id ?? `new-${editor.target.kind}-${editor.target.id}`}
          data={data}
          target={editor.target}
          set={editor.set}
          copyFrom={editor.copyFrom}
          defaultName={editor.defaultName}
          onCancel={() => setEditor(null)}
          onSaved={() => { setEditor(null); onChanged(); }}
        />
      );
    }

    if (person) {
      const resolved = exempt.has(person.id) ? null : resolve(person);
      const fallback = kpiSetFor({ ...person, id: '' }, data.sets, lineageIds(person.unit_id), month);
      const ownSets = data.sets.filter((set) => set.user_id === person.id).sort(byNewest);
      const isExempt = exempt.has(person.id);
      return (
        <Card className="!rounded-none">
          <CardHeader className="flex flex-wrap items-center gap-3">
            <Button size="sm" variant="ghost" onClick={() => setPersonId(null)} aria-label="Quay lại danh sách">
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <Avatar name={person.name} url={person.avatar_url} size="sm" />
            <div className="min-w-0 flex-1">
              <CardTitle className="truncate">{person.name}</CardTitle>
              <p className="truncate text-xs text-slate-500">
                {person.employee_code ?? '—'} · {person.unit_id ? unitById.get(person.unit_id)?.name ?? '—' : 'Chưa gán đơn vị'}
              </p>
            </div>
            <div ref={setTitleSlot} className="w-full min-w-0 sm:w-72" />
            <label className="flex cursor-pointer items-center gap-1.5 text-xs font-semibold text-slate-600">
              <input type="checkbox" className="h-3.5 w-3.5 accent-indigo-600" checked={isExempt} onChange={() => void toggleExempt(person)} />
              Không áp dụng KPI
            </label>
          </CardHeader>
          <CardContent className="space-y-4">
            {isExempt ? (
              <p className="border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-600">
                Người này không áp dụng KPI — khi mở kỳ sẽ không có phiếu. Bỏ tích ở trên để áp lại.
              </p>
            ) : (
              <>
                {ownSets.length > 1 && (
                  <SetList title="Các bộ riêng của người này" sets={ownSets} itemsBySet={itemsBySet} appliedId={resolved?.set.id ?? null}
                    onEdit={editSet} onToggle={toggleSet} />
                )}
                <KpiSetEditor
                  key={`${person.id}-${resolved?.set.id ?? 'none'}-${resolved?.set.version ?? 0}`}
                  embedded
                  data={data}
                  target={{ kind: 'PERSON', id: person.id, label: `Bộ riêng · ${person.name}` }}
                  set={resolved?.level === 'PERSON' ? resolved.set : null}
                  copyFrom={resolved && resolved.level !== 'PERSON' ? resolved.set : null}
                  defaultName={`KPI ${person.name}`}
                  titleSlot={titleSlot}
                  onToggleLock={toggleSet}
                  onSaved={onChanged}
                />
              </>
            )}
          </CardContent>
        </Card>
      );
    }

    if (unitId === TEMPLATES && !query.trim()) {
      return (
        <Card className="!rounded-none">
          <CardHeader className="flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1">
              <CardTitle className="flex items-center gap-2"><FileStack className="h-4 w-4 text-slate-400" /> Bộ mẫu</CardTitle>
              <p className="mt-0.5 text-xs text-slate-500">Không tự áp cho ai — dùng làm điểm xuất phát khi khai KPI chung hoặc bộ riêng.</p>
            </div>
            <Button size="sm" onClick={() => setEditor({ target: targetOf({ user_id: null, position_id: null, unit_id: null } as KpiSet), set: null, copyFrom: null })}>
              <Plus className="h-3.5 w-3.5" /> Thêm bộ mẫu
            </Button>
          </CardHeader>
          <CardContent>
            {templates.length === 0
              ? <p className="border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">Chưa có bộ mẫu.</p>
              : <SetList sets={templates} itemsBySet={itemsBySet} appliedId={null} onEdit={editSet} onToggle={toggleSet} />}
          </CardContent>
        </Card>
      );
    }

    const title = query.trim() ? `Kết quả tìm "${query.trim()}"` : unit?.name ?? (unitId === NO_UNIT ? 'Chưa gán đơn vị' : 'Chọn đơn vị');
    return (
      <Card className="!rounded-none">
        <CardHeader className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <CardTitle className="flex items-center gap-2">
              {query.trim() ? <Search className="h-4 w-4 text-slate-400" /> : <Building2 className="h-4 w-4 text-slate-400" />}
              {title}
            </CardTitle>
          </div>
          {unit && !query.trim() && tab === 'people' && (
            <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-600">
              <input type="checkbox" className="h-3.5 w-3.5 accent-indigo-600" checked={includeChildren} onChange={(event) => setIncludeChildren(event.target.checked)} />
              Gồm đơn vị con
            </label>
          )}
          {(tab === 'people' || query.trim() || !unit) && <ExportButtons options={exportOptions} disabled={people.length === 0} />}
        </CardHeader>
        <CardContent className="space-y-3">
          {unit && !query.trim() && (
            <div className="inline-flex rounded-none bg-slate-100 p-1 no-print" role="tablist" aria-label="Đơn vị">
              {([['people', 'Nhân sự'], ['shared', 'KPI chung']] as const).map(([value, label]) => (
                <button key={value} type="button" role="tab" aria-selected={tab === value} onClick={() => setTab(value)}
                  className={`rounded-none px-3.5 py-1.5 text-sm font-semibold transition ${tab === value ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>
                  {label}
                </button>
              ))}
            </div>
          )}

          {unit && !query.trim() && tab === 'shared' ? (
            <UnitSharedPanel
              unitId={unit.id}
              unitName={unit.name}
              data={data}
              month={month}
              lineage={lineageIds(unit.id)}
              itemsBySet={itemsBySet}
              unitNameOf={(id) => unitById.get(id)?.name ?? '—'}
              positionTitleOf={(id) => positionById.get(id)?.title ?? '—'}
              onCreate={(copyFrom) => setEditor({
                target: { kind: 'UNIT', id: unit.id, label: `KPI chung · ${unit.name} (gồm đơn vị con)` },
                set: null, copyFrom, defaultName: `KPI chung ${unit.name}`,
              })}
              onEdit={editSet}
              onToggle={toggleSet}
              onSaved={onChanged}
            />
          ) : people.length === 0 ? (
            <p className="border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">
              {query.trim() ? 'Không có nhân viên nào khớp.' : 'Đơn vị này chưa có nhân sự.'}
            </p>
          ) : (
            <div className="overflow-x-auto rounded-xl border-2 border-slate-400 dark:border-slate-600 shadow-sm overflow-hidden">
              <table className="w-full min-w-[460px] text-xs border-collapse">
                <thead>
                  <tr className="border-b-2 border-[#bf1f2b] dark:border-[#e66a76] bg-[#fdf2f4] dark:bg-[#201114] text-left text-xs font-black uppercase tracking-wider text-[#5c0f16] dark:text-[#fde8ea] shadow-[inset_0_-2px_0_#bf1f2b] dark:shadow-[inset_0_-2px_0_#e66a76]">
                    <th className="py-1.5 px-2.5 min-w-[130px]"><div className="min-w-[130px] line-clamp-1">Nhân viên</div></th>
                    <th className="border-l border-[#eed5d8] dark:border-[#4a1c22] py-1.5 px-2 min-w-[140px]"><div className="min-w-[140px] line-clamp-1">KPI đang theo</div></th>
                    <th className="border-l border-[#eed5d8] dark:border-[#4a1c22] py-1.5 px-2 min-w-[95px]"><div className="min-w-[95px] line-clamp-1">Tình trạng</div></th>
                    <th className="py-1.5 px-2 text-right w-8" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-300 dark:divide-slate-700 bg-white dark:bg-slate-900 font-semibold">
                  {pagePeople.map((row) => {
                    const resolved = exempt.has(row.id) ? null : resolve(row);
                    const status = statusOf(row, resolved);
                    return (
                      <tr key={row.id} className="group cursor-pointer transition-colors hover:bg-slate-100/80 dark:hover:bg-slate-800/60" onClick={() => setPersonId(row.id)}>
                        <td className="py-1 px-2.5">
                          <div className="min-w-0">
                            <p className="truncate font-black text-xs text-slate-900 dark:text-slate-100">{row.name}</p>
                            <p className="truncate text-[10px] font-medium text-slate-500 dark:text-slate-400">{row.employee_code ?? '—'} · {row.department || '—'}</p>
                          </div>
                        </td>
                        <td className="border-l border-slate-300 dark:border-slate-700 py-1 px-2">
                          {resolved ? (
                            <div className="min-w-0">
                              <p className="max-w-[220px] truncate text-xs font-bold text-slate-900 dark:text-slate-100">{resolved.set.name}</p>
                              <SourceChip resolved={resolved} text={sourceText(resolved)} />
                            </div>
                          ) : <span className="text-[11px] font-bold text-slate-400 dark:text-slate-500">—</span>}
                        </td>
                        <td className="border-l border-slate-300 dark:border-slate-700 py-1 px-2">
                          <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${status.tone}`}>{status.label}</span>
                        </td>
                        <td className="py-1 px-2 text-right text-slate-400 group-hover:text-slate-700 dark:group-hover:text-slate-200"><ChevronRight className="inline h-3.5 w-3.5" /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <Pager page={currentPage} total={people.length} size={PEOPLE_PER_PAGE} noun="người" onPage={setPage} />
            </div>
          )}
        </CardContent>
      </Card>
    );
  })();

  return (
    <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
      <div className="lg:self-start">
        <div className="pb-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              value={query}
              onChange={(event) => { setQuery(event.target.value); setPersonId(null); setEditor(null); }}
              placeholder="Tìm nhân viên theo tên / mã..."
              className="h-10 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
            />
          </div>
        </div>
        <div>
          <UnitTreeList
            rows={rows}
            selectedId={query.trim() ? null : unitId}
            onSelect={(selected) => selectUnit(selected.id)}
            meta={(row) => `${data.profiles.filter((p) => p.unit_id === row.id).length} người`}
            badge={(row) => (unitHasShared(row.id)
              ? <span className="shrink-0 bg-indigo-50 px-1.5 py-0.5 text-[10px] font-bold text-indigo-700">KPI chung</span>
              : null)}
          />
          {unassignedCount > 0 && (
            <TreeExtra icon={<Users className="h-4 w-4 text-slate-400" />} label="Chưa gán đơn vị" meta={`${unassignedCount} người`}
              selected={unitId === NO_UNIT && !query} onClick={() => selectUnit(NO_UNIT)} />
          )}
          <TreeExtra icon={<FileStack className="h-4 w-4 text-slate-400" />} label="Bộ mẫu" meta={`${templates.length} bộ`}
            selected={unitId === TEMPLATES && !query} onClick={() => selectUnit(TEMPLATES)} />
        </div>
      </div>

      <div className="min-w-0 space-y-4">{right}</div>
    </div>
  );
}

function UnitSharedPanel({
  unitId, unitName, data, month, lineage, itemsBySet, unitNameOf, positionTitleOf, onCreate, onEdit, onToggle, onSaved,
}: {
  unitId: string;
  unitName: string;
  data: KpiWorkspace;
  month: string;
  lineage: string[];
  itemsBySet: Map<string, KpiWorkspace['setItems']>;
  unitNameOf: (id: string) => string;
  positionTitleOf: (id: string) => string;
  onCreate: (copyFrom: KpiSet | null) => void;
  onEdit: (set: KpiSet) => void;
  onToggle: (set: KpiSet) => void;
  onSaved: () => void;
}) {
  const ownSets = data.sets.filter((set) => isShared(set) && set.unit_id === unitId).sort(byNewest);
  // Bộ chung đơn vị này đang theo: bộ khai tại đây, không có thì của cấp trên gần nhất.
  const applied = kpiSetFor({ id: '' }, data.sets, lineage, month);
  const inherited = applied && applied.unitId !== unitId ? applied : null;
  const positionIds = new Set(data.positions.filter((position) => position.unit_id === unitId).map((position) => position.id));
  const positionSets = data.sets.filter((set) => !set.user_id && set.position_id && positionIds.has(set.position_id)).sort(byNewest);

  const own = applied && !inherited ? applied.set : null;

  return (
    <div className="space-y-4">
      {ownSets.length > 0 && (
        <SetList
          title="KPI chung khai tại đơn vị này"
          sets={ownSets}
          itemsBySet={itemsBySet}
          appliedId={applied?.set.id ?? null}
          onEdit={onEdit}
          onToggle={onToggle}
          action={(
            <button type="button" className="text-xs font-semibold text-indigo-600 hover:underline" onClick={() => onCreate(applied?.set ?? ownSets[0])}>
              + Thêm bộ mới
            </button>
          )}
        />
      )}

      <KpiSetEditor
        key={`${unitId}-${applied?.set.id ?? 'none'}-${applied?.set.version ?? 0}`}
        embedded
        data={data}
        target={{ kind: 'UNIT', id: unitId, label: `KPI chung · ${unitName} (gồm đơn vị con)` }}
        set={own}
        copyFrom={inherited?.set ?? null}
        defaultName={`KPI chung ${unitName}`}
        onSaved={onSaved}
      />

      {positionSets.length > 0 && (
        <SetList
          title="Theo vị trí trong đơn vị (thay KPI chung cho người giữ vị trí)"
          sets={positionSets}
          itemsBySet={itemsBySet}
          appliedId={null}
          subtitle={(set) => positionTitleOf(set.position_id!)}
          onEdit={onEdit}
          onToggle={onToggle}
        />
      )}
    </div>
  );
}

/** Danh sách bộ gọn: tên, hiệu lực, số tiêu chí, trạng thái, sửa / khoá. Không có xoá. */
function SetList({ title, sets, itemsBySet, appliedId, subtitle, action, onEdit, onToggle }: {
  title?: string;
  sets: KpiSet[];
  itemsBySet: Map<string, KpiWorkspace['setItems']>;
  appliedId: string | null;
  subtitle?: (set: KpiSet) => string;
  action?: React.ReactNode;
  onEdit: (set: KpiSet) => void;
  onToggle: (set: KpiSet) => void;
}) {
  return (
    <div className="border border-slate-200">
      {(title || action) && (
        <div className="flex items-center justify-between gap-2 border-b border-slate-200 bg-[#FCFAF8] px-3 py-2">
          <p className="text-[11px] font-bold uppercase tracking-wider text-black">{title}</p>
          {action}
        </div>
      )}
      <div className="divide-y divide-slate-300 dark:divide-slate-700">
        {sets.map((set) => {
          const count = itemsBySet.get(set.id)?.length ?? 0;
          return (
            <div key={set.id} className={`flex flex-wrap items-center gap-3 px-3 py-2.5 ${set.is_active ? '' : 'opacity-70'}`}>
              <div className="min-w-0 flex-1">
                <button type="button" onClick={() => onEdit(set)} className="text-left text-sm font-bold text-slate-900 dark:text-slate-100 hover:text-indigo-700 dark:hover:text-indigo-400">
                  {set.name}
                </button>
                {set.id === appliedId && <span className="ml-2 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-700 px-1.5 py-0.5 text-xs font-bold text-emerald-800 dark:text-emerald-300 rounded">Đang theo</span>}
                <p className="text-xs text-slate-500 dark:text-slate-400 font-medium mt-0.5">
                  {subtitle ? `${subtitle(set)} · ` : ''}{set.code} · {BLOCK_LABEL[set.block]} · {count} tiêu chí · từ {monthText(set.effective_from)}
                  {set.board_review ? ' · BGĐ duyệt cuối' : ''}
                </p>
              </div>
              <span className={`inline-flex items-center gap-1.5 text-xs font-bold ${set.is_active ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-500'}`}>
                <span className={`h-2 w-2 rounded-full ${set.is_active ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                {set.is_active ? 'Đang áp dụng' : 'Đã khoá'}
              </span>
              <div className="flex gap-0.5 no-print">
                <IconButton label="Sửa" onClick={() => onEdit(set)}><Pencil className="h-3.5 w-3.5" /></IconButton>
                <IconButton label={set.is_active ? 'Khoá' : 'Mở khoá'} danger={set.is_active} onClick={() => onToggle(set)}>
                  {set.is_active ? <Lock className="h-3.5 w-3.5" /> : <LockOpen className="h-3.5 w-3.5" />}
                </IconButton>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SourceChip({ resolved, text }: { resolved: ResolvedKpiSet; text: string }) {
  const tone = resolved.level === 'PERSON'
    ? 'bg-indigo-50 text-indigo-700'
    : resolved.level === 'POSITION' ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-600';
  return <span className={`inline-block max-w-[260px] truncate px-1.5 py-0.5 align-middle text-[10px] font-bold ${tone}`}>{text}</span>;
}

function TreeExtra({ icon, label, meta, selected, onClick }: {
  icon: React.ReactNode; label: string; meta: string; selected: boolean; onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition ${
        selected ? 'bg-indigo-50 font-bold text-indigo-800' : 'font-semibold text-slate-600 hover:bg-indigo-50/50'
      }`}
    >
      {icon}
      <span className="flex-1">{label}</span>
      <span className="text-[11px] text-slate-400">{meta}</span>
    </button>
  );
}
