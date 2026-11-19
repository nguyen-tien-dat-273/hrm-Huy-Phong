// ============================================================================
// Thiết lập lương → Bảng lương: khai các bảng xem như sheet Excel (BL 01, BL 02,
// Lương cắt lô, Nghỉ phép, Đầu chai, Làm thêm giờ VC…).
// ----------------------------------------------------------------------------
// Mỗi bảng: tên, ai có mặt (người có một trong các dòng đã chọn, thuộc đơn vị đã
// chọn), danh sách cột. Cột lấy số từ đầu mục / chấm công / phép năm / tổng
// phiếu; cột liền nhau cùng "Nhóm" gộp thành tiêu đề hai tầng. Bảng chỉ để xem
// và nhập số liệu tháng — không đổi cách tính.
// ============================================================================

import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ArrowDown, ArrowUp, Plus, Save, Table2, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';
import { Dropdown, type DropdownOption } from '@/components/ui/Dropdown';
import { Input } from '@/components/ui/Input';
import { useToast } from '@/contexts/ToastContext';
import { useConfirm } from '@/contexts/ConfirmContext';
import type { PayrollWorkspace } from '@/lib/payrollData';
import {
  DATA_SOURCES, INFO_SOURCES, LEAVE_SOURCES, SOURCE_LABEL, TOTAL_SOURCES, columnLabel, deletePayrollSheet, headerGroups,
  savePayrollSheet, sourceName, type PayrollSheet, type SheetColumn, type SheetSource,
} from '@/lib/payrollSheets';

interface Draft {
  id: string | null;
  name: string;
  title: string;
  form_code: string;
  issuer: string;
  subtitle: string;
  show_standard_days: boolean;
  require_codes: string[];
  unit_ids: string[];
  columns: SheetColumn[];
}

const toDraft = (sheet: PayrollSheet | null): Draft => (sheet
  ? {
    id: sheet.id, name: sheet.name, title: sheet.title ?? '', form_code: sheet.form_code ?? '',
    issuer: sheet.issuer ?? '', subtitle: sheet.subtitle ?? '', show_standard_days: sheet.show_standard_days,
    require_codes: [...sheet.require_codes], unit_ids: [...sheet.unit_ids], columns: sheet.columns.map((column) => ({ ...column })),
  }
  : {
    id: null, name: '', title: '', form_code: '', issuer: '', subtitle: '', show_standard_days: false,
    require_codes: [], unit_ids: [], columns: [],
  });

const cellInput = 'h-8 w-full rounded-none border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 text-xs font-semibold text-slate-900 dark:text-slate-100 placeholder:text-slate-600 dark:placeholder:text-slate-400 outline-none focus:border-indigo-600 disabled:bg-slate-100 dark:disabled:bg-slate-800/60';

export function PayrollSheetsBoard({ data, canManage, onChanged }: {
  data: PayrollWorkspace;
  canManage: boolean;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const [searchParams, setSearchParams] = useSearchParams();
  const sheets = data.sheets;
  const [selectedId, setSelectedId] = useState<string | null>(() => searchParams.get('sheet') ?? sheets[0]?.id ?? null);
  const selected = sheets.find((sheet) => sheet.id === selectedId) ?? null;
  const [draft, setDraft] = useState<Draft>(() => toDraft(selected));
  const [saving, setSaving] = useState(false);

  // Đổi bảng đang chọn (hoặc dữ liệu tải lại) thì nạp lại bản nháp.
  useEffect(() => {
    if (selectedId && !sheets.some((sheet) => sheet.id === selectedId)) {
      setSelectedId(sheets[0]?.id ?? null);
      return;
    }
    setDraft(toDraft(sheets.find((sheet) => sheet.id === selectedId) ?? null));
  }, [selectedId, sheets]);

  const pick = (id: string | null) => {
    setSelectedId(id);
    const next = new URLSearchParams(searchParams);
    if (id) next.set('sheet', id); else next.delete('sheet');
    setSearchParams(next, { replace: true });
  };

  const dirty = JSON.stringify(draft) !== JSON.stringify(toDraft(selected));
  const patch = (change: Partial<Draft>) => setDraft((current) => ({ ...current, ...change }));
  const patchColumn = (index: number, change: Partial<SheetColumn>) => setDraft((current) => ({
    ...current,
    columns: current.columns.map((column, i) => (i === index ? { ...column, ...change } : column)),
  }));
  const moveColumn = (index: number, step: number) => setDraft((current) => {
    const target = index + step;
    if (target < 0 || target >= current.columns.length) return current;
    const columns = [...current.columns];
    [columns[index], columns[target]] = [columns[target], columns[index]];
    return { ...current, columns };
  });
  const removeColumn = (index: number) => setDraft((current) => ({
    ...current, columns: current.columns.filter((_, i) => i !== index),
  }));
  const addColumn = () => setDraft((current) => ({
    ...current,
    columns: [...current.columns, {
      group: current.columns[current.columns.length - 1]?.group ?? null, source: 'LINE', code: '', label: null, total: true,
    }],
  }));

  const components = useMemo(
    () => [...data.components].filter((component) => component.is_active).sort((a, b) => a.sort_order - b.sort_order),
    [data.components],
  );
  const sourceOptions = useMemo<DropdownOption[]>(() => [
    ...components.map((component) => ({ value: `LINE:${component.code}`, label: component.name, detail: SOURCE_LABEL.LINE })),
    ...DATA_SOURCES.map((item) => ({ value: `DATA:${item.code}`, label: item.name, detail: SOURCE_LABEL.DATA })),
    ...LEAVE_SOURCES.map((item) => ({ value: `LEAVE:${item.code}`, label: item.name, detail: SOURCE_LABEL.LEAVE })),
    ...TOTAL_SOURCES.map((item) => ({ value: `TOTAL:${item.code}`, label: item.name, detail: SOURCE_LABEL.TOTAL })),
    ...INFO_SOURCES.map((item) => ({ value: `INFO:${item.code}`, label: item.name, detail: SOURCE_LABEL.INFO })),
  ], [components]);
  const componentOptions = useMemo<DropdownOption[]>(
    () => components.filter((component) => !draft.require_codes.includes(component.code))
      .map((component) => ({ value: component.code, label: component.name })),
    [components, draft.require_codes],
  );
  const unitOptions = useMemo<DropdownOption[]>(
    () => data.units.filter((unit) => !draft.unit_ids.includes(unit.id)).map((unit) => ({ value: unit.id, label: unit.name })),
    [data.units, draft.unit_ids],
  );
  const groupOptions = useMemo<DropdownOption[]>(
    () => data.categories.map((category) => ({ value: category.code, label: category.name })),
    [data.categories],
  );

  /** Thêm mọi đầu mục của một nhóm danh mục, đặt sẵn tiêu đề nhóm. */
  const addCategory = (code: string) => {
    const category = data.categories.find((item) => item.code === code);
    if (!category) return;
    const taken = new Set(draft.columns.filter((column) => column.source === 'LINE').map((column) => column.code));
    const added = components
      .filter((component) => component.category_code === code && !taken.has(component.code))
      .map((component): SheetColumn => ({ group: category.name, source: 'LINE', code: component.code, label: null, total: true }));
    if (added.length === 0) { toast(`Các đầu mục nhóm “${category.name}” đã có trong bảng.`, 'warning'); return; }
    patch({ columns: [...draft.columns, ...added] });
  };

  const problems = (() => {
    const found: string[] = [];
    if (!draft.name.trim()) found.push('Nhập tên bảng.');
    if (draft.columns.length === 0) found.push('Thêm ít nhất một cột.');
    if (draft.columns.some((column) => !column.code)) found.push('Có cột chưa chọn lấy số từ đâu.');
    if (sheets.some((sheet) => sheet.id !== draft.id && sheet.name.trim().toLowerCase() === draft.name.trim().toLowerCase())) {
      found.push('Đã có bảng cùng tên.');
    }
    return found;
  })();

  const handleSave = async () => {
    if (problems.length > 0) { toast(problems[0], 'warning'); return; }
    setSaving(true);
    const { id, error } = await savePayrollSheet(draft.id, {
      name: draft.name.trim(),
      title: draft.title.trim() || null,
      form_code: draft.form_code.trim() || null,
      issuer: draft.issuer.trim() || null,
      subtitle: draft.subtitle.trim() || null,
      show_standard_days: draft.show_standard_days,
      sort_order: selected?.sort_order ?? (Math.max(0, ...sheets.map((sheet) => sheet.sort_order)) + 10),
      require_codes: draft.require_codes,
      unit_ids: draft.unit_ids,
      columns: draft.columns,
    });
    setSaving(false);
    if (error) { toast('Không lưu được bảng: ' + error, 'error'); return; }
    toast(`Đã lưu bảng “${draft.name.trim()}”.`, 'success');
    if (id) pick(id);
    onChanged();
  };

  const handleDelete = async () => {
    if (!draft.id) { pick(sheets[0]?.id ?? null); return; }
    const ok = await confirm({
      title: `Xoá bảng “${draft.name}”?`,
      message: 'Chỉ xoá cách xem; số liệu lương không đổi.',
      confirmLabel: 'Xoá bảng',
      danger: true,
    });
    if (!ok) return;
    const error = await deletePayrollSheet(draft.id);
    if (error) { toast('Không xoá được: ' + error, 'error'); return; }
    toast('Đã xoá bảng.', 'success');
    pick(sheets.find((sheet) => sheet.id !== draft.id)?.id ?? null);
    onChanged();
  };

  const startNew = () => {
    setSelectedId(null);
    setDraft({ ...toDraft(null), name: 'Bảng mới' });
  };

  const unitName = (id: string) => data.units.find((unit) => unit.id === id)?.name ?? 'Đơn vị đã xoá';
  const componentName = (code: string) => data.components.find((component) => component.code === code)?.name ?? code;
  const previewHeads = headerGroups(draft.columns);
  const readOnly = !canManage;

  return (
    <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
      <Card className="!rounded-none self-start">
        <CardContent className="!p-2">
          <nav className="flex flex-col" aria-label="Các bảng lương">
            {sheets.map((sheet) => (
              <button
                key={sheet.id}
                type="button"
                onClick={() => pick(sheet.id)}
                className={`flex items-center gap-2 rounded-none px-3 py-2 text-left text-sm font-semibold transition ${
                  sheet.id === draft.id
                    ? 'bg-indigo-50 text-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-200'
                    : 'text-slate-800 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800'
                }`}
              >
                <Table2 className="h-4 w-4 shrink-0" />
                <span className="truncate">{sheet.name}</span>
              </button>
            ))}
            {!draft.id && draft.name && (
              <span className="flex items-center gap-2 bg-indigo-50 px-3 py-2 text-sm font-semibold text-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-200">
                <Table2 className="h-4 w-4 shrink-0" /> <span className="truncate">{draft.name}</span>
              </span>
            )}
          </nav>
          {canManage && (
            <Button size="sm" variant="outline" className="mt-2 w-full" onClick={startNew}>
              <Plus className="h-3.5 w-3.5" /> Thêm bảng
            </Button>
          )}
        </CardContent>
      </Card>

      {sheets.length === 0 && !draft.name ? (
        <Card className="!rounded-none">
          <CardContent className="py-10 text-center text-sm font-semibold text-slate-700 dark:text-slate-300">Chưa có bảng nào.</CardContent>
        </Card>
      ) : (
        <Card className="!rounded-none min-w-0">
          <CardContent className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label="Tên bảng" required value={draft.name} disabled={readOnly} onChange={(event) => patch({ name: event.target.value })} />
              <Input label="Tiêu đề khi in" value={draft.title} disabled={readOnly} placeholder={draft.name.toUpperCase()} onChange={(event) => patch({ title: event.target.value })} />
              <Input label="Mã biểu mẫu" value={draft.form_code} disabled={readOnly} placeholder="BL 01" onChange={(event) => patch({ form_code: event.target.value })} />
              <Input label="Đơn vị lập" value={draft.issuer} disabled={readOnly} placeholder="PHÒNG KẾ TOÁN" onChange={(event) => patch({ issuer: event.target.value })} />
              <Input label="Dòng dưới tiêu đề" value={draft.subtitle} disabled={readOnly} placeholder="BỘ PHẬN: KINH DOANH" onChange={(event) => patch({ subtitle: event.target.value })} />
              <label className="flex items-center gap-2 self-end pb-2.5 text-sm font-bold text-slate-800 dark:text-slate-200">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-indigo-600"
                  checked={draft.show_standard_days}
                  disabled={readOnly}
                  onChange={(event) => patch({ show_standard_days: event.target.checked })}
                />
                In số ngày làm việc
              </label>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <p className="mb-1.5 text-sm font-bold text-slate-800 dark:text-slate-200">Chỉ người có dòng</p>
                <div className="flex flex-wrap gap-1.5">
                  {draft.require_codes.map((code) => (
                    <span key={code} className="inline-flex items-center gap-1 rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-xs font-semibold text-indigo-800 dark:border-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-200">
                      {componentName(code)}
                      {!readOnly && (
                        <button type="button" aria-label={`Bỏ ${componentName(code)}`} onClick={() => patch({ require_codes: draft.require_codes.filter((item) => item !== code) })}>
                          <X className="h-3 w-3" />
                        </button>
                      )}
                    </span>
                  ))}
                  {draft.require_codes.length === 0 && <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">Mọi người</span>}
                </div>
                {!readOnly && (
                  <Dropdown
                    className="mt-2"
                    compact
                    value=""
                    placeholder="Thêm dòng…"
                    options={componentOptions}
                    onChange={(code) => code && patch({ require_codes: [...draft.require_codes, code] })}
                    aria-label="Thêm dòng bắt buộc"
                  />
                )}
              </div>
              <div>
                <p className="mb-1.5 text-sm font-bold text-slate-800 dark:text-slate-200">Đơn vị</p>
                <div className="flex flex-wrap gap-1.5">
                  {draft.unit_ids.map((id) => (
                    <span key={id} className="inline-flex items-center gap-1 rounded-full border border-slate-300 bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-800 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200">
                      {unitName(id)}
                      {!readOnly && (
                        <button type="button" aria-label={`Bỏ ${unitName(id)}`} onClick={() => patch({ unit_ids: draft.unit_ids.filter((item) => item !== id) })}>
                          <X className="h-3 w-3" />
                        </button>
                      )}
                    </span>
                  ))}
                  {draft.unit_ids.length === 0 && <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">Mọi đơn vị</span>}
                </div>
                {!readOnly && (
                  <Dropdown
                    className="mt-2"
                    compact
                    value=""
                    placeholder="Thêm đơn vị…"
                    options={unitOptions}
                    onChange={(id) => id && patch({ unit_ids: [...draft.unit_ids, id] })}
                    aria-label="Thêm đơn vị"
                  />
                )}
              </div>
            </div>

            <div>
              <p className="mb-1.5 text-sm font-bold text-slate-800 dark:text-slate-200">Cột ({draft.columns.length})</p>
              <div className="overflow-x-auto border border-slate-300 dark:border-slate-700">
                <table className="w-full min-w-[720px] text-xs">
                  <thead className="bg-slate-100 dark:bg-slate-800 text-left font-black text-slate-800 dark:text-slate-200">
                    <tr>
                      <th className="w-10 px-2 py-2 text-center">#</th>
                      <th className="w-[22%] px-2 py-2">Nhóm</th>
                      <th className="px-2 py-2">Lấy số từ</th>
                      <th className="w-[22%] px-2 py-2">Tên cột</th>
                      <th className="w-16 px-2 py-2 text-center">Cộng tổng</th>
                      <th className="w-24 px-2 py-2" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                    {draft.columns.map((column, index) => (
                      <tr key={index} className="bg-white dark:bg-slate-900">
                        <td className="px-2 py-1 text-center font-bold text-slate-700 dark:text-slate-300">{index + 1}</td>
                        <td className="px-2 py-1">
                          <input
                            className={cellInput}
                            value={column.group ?? ''}
                            disabled={readOnly}
                            placeholder="Cột đơn"
                            aria-label={`Nhóm của cột ${index + 1}`}
                            onChange={(event) => patchColumn(index, { group: event.target.value || null })}
                          />
                        </td>
                        <td className="px-2 py-1">
                          <Dropdown
                            compact
                            disabled={readOnly}
                            value={column.code ? `${column.source}:${column.code}` : ''}
                            placeholder="Chọn…"
                            options={sourceOptions}
                            onChange={(value) => {
                              const [source, code] = value.split(':') as [SheetSource, string];
                              patchColumn(index, { source, code, ...(source === 'INFO' ? { total: false } : {}) });
                            }}
                            aria-label={`Nguồn số của cột ${index + 1}`}
                          />
                        </td>
                        <td className="px-2 py-1">
                          <input
                            className={cellInput}
                            value={column.label ?? ''}
                            disabled={readOnly}
                            placeholder={column.code ? sourceName(column.source, column.code, data.components) : ''}
                            aria-label={`Tên cột ${index + 1}`}
                            onChange={(event) => patchColumn(index, { label: event.target.value || null })}
                          />
                        </td>
                        <td className="px-2 py-1 text-center">
                          <input
                            type="checkbox"
                            className="h-4 w-4 accent-indigo-600"
                            checked={column.total}
                            disabled={readOnly || column.source === 'INFO'}
                            aria-label={`Cộng tổng cột ${index + 1}`}
                            onChange={(event) => patchColumn(index, { total: event.target.checked })}
                          />
                        </td>
                        <td className="px-2 py-1">
                          {!readOnly && (
                            <div className="flex justify-end gap-0.5">
                              <button type="button" className="inline-flex h-7 w-7 items-center justify-center text-slate-700 hover:bg-slate-100 disabled:opacity-40 dark:text-slate-300 dark:hover:bg-slate-800" disabled={index === 0} onClick={() => moveColumn(index, -1)} aria-label="Lên">
                                <ArrowUp className="h-3.5 w-3.5" />
                              </button>
                              <button type="button" className="inline-flex h-7 w-7 items-center justify-center text-slate-700 hover:bg-slate-100 disabled:opacity-40 dark:text-slate-300 dark:hover:bg-slate-800" disabled={index === draft.columns.length - 1} onClick={() => moveColumn(index, 1)} aria-label="Xuống">
                                <ArrowDown className="h-3.5 w-3.5" />
                              </button>
                              <button type="button" className="inline-flex h-7 w-7 items-center justify-center text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40" onClick={() => removeColumn(index)} aria-label="Bỏ cột">
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!readOnly && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Button size="sm" variant="outline" onClick={addColumn}><Plus className="h-3.5 w-3.5" /> Thêm cột</Button>
                  <div className="w-56">
                    <Dropdown compact value="" placeholder="Thêm cả nhóm…" options={groupOptions} onChange={addCategory} aria-label="Thêm cả nhóm đầu mục" />
                  </div>
                </div>
              )}
            </div>

            {draft.columns.length > 0 && (
              <div>
                <p className="mb-1.5 text-sm font-bold text-slate-800 dark:text-slate-200">Xem trước</p>
                <div className="overflow-x-auto border border-slate-300 dark:border-slate-700">
                  <table className="w-max border-collapse text-xs font-black text-[#5c0f16] dark:text-[#fde8ea]">
                    <thead className="bg-[#fdf2f4] dark:bg-[#201114]">
                      <tr>
                        {(() => {
                          let cursor = 0;
                          return previewHeads.map((head) => {
                            const start = cursor;
                            cursor += head.span;
                            const twoTier = previewHeads.some((item) => item.title);
                            return head.title ? (
                              <th key={start} colSpan={head.span} className="border border-[#eed5d8] dark:border-[#4a1c22] px-2 py-1 text-center">{head.title}</th>
                            ) : (
                              <th key={start} rowSpan={twoTier ? 2 : 1} className="border border-[#eed5d8] dark:border-[#4a1c22] px-2 py-1 text-center">
                                {draft.columns[start].code ? columnLabel(draft.columns[start], data.components) : '…'}
                              </th>
                            );
                          });
                        })()}
                      </tr>
                      {previewHeads.some((head) => head.title) && (
                        <tr>
                          {(() => {
                            const cells: ReactElement[] = [];
                            let cursor = 0;
                            for (const head of previewHeads) {
                              if (head.title) {
                                for (let i = 0; i < head.span; i += 1) {
                                  const column = draft.columns[cursor + i];
                                  cells.push(
                                    <th key={cursor + i} className="border border-[#eed5d8] dark:border-[#4a1c22] px-2 py-1 text-center">
                                      {column.code ? columnLabel(column, data.components) : '…'}
                                    </th>,
                                  );
                                }
                              }
                              cursor += head.span;
                            }
                            return cells;
                          })()}
                        </tr>
                      )}
                    </thead>
                  </table>
                </div>
              </div>
            )}

            {canManage && (
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-4 dark:border-slate-800">
                <Button size="sm" variant="outline" onClick={() => void handleDelete()} className="text-red-700 dark:text-red-400">
                  <Trash2 className="h-3.5 w-3.5" /> {draft.id ? 'Xoá bảng' : 'Bỏ bảng mới'}
                </Button>
                <Button size="sm" onClick={() => void handleSave()} disabled={saving || (!dirty && !!draft.id)}>
                  <Save className="h-3.5 w-3.5" /> {saving ? 'Đang lưu…' : 'Lưu bảng'}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
