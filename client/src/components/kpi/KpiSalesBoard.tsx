// ============================================================================
// Chỉ tiêu & kết quả kinh doanh tháng — giao khoán, tự xác nhận (admin, Kế toán
// trưởng, Ban Giám đốc quyền ngang nhau), nhập số thực hiện từ báo cáo AMIS,
// nhân viên xác nhận / khiếu nại.
// ============================================================================

import { useMemo, useState } from 'react';
import { CheckCircle2, Download, FileUp, Save, Search, TriangleAlert, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Dropdown } from '@/components/ui/Dropdown';
import { Modal } from '@/components/ui/Modal';
import { Textarea } from '@/components/ui/Input';
import { Banner } from '@/components/payroll/PayrollRegister';
import type { SheetViewer } from '@/components/kpi/KpiSheetView';
import { useToast } from '@/contexts/ToastContext';
import { unitLineage } from '@/lib/orgUnits';
import {
  SALES_STATUS_LABEL, SALES_STATUS_TONE, fmtNum, fmtPct, fold, kpiSetFor, monthLabelOf, parseNum, type KpiSalesTarget,
} from '@/lib/kpi';
import { reviewSalesTargets, saveSalesActuals, saveSalesTargets, type KpiWorkspace } from '@/lib/kpiData';

interface RowDraft { sales_target: string; collect_target: string; customers_target: string; sales_actual: string; collect_actual: string; customers_actual: string }
const FIELDS: Array<keyof RowDraft> = ['sales_target', 'collect_target', 'customers_target', 'sales_actual', 'collect_actual', 'customers_actual'];

const pct = (actual: number | null, target: number) => (actual == null || !target ? null : Math.round((actual * 10000) / target) / 100);

export function KpiSalesBoard({ data, month, viewer, onChanged }: {
  data: KpiWorkspace; month: string; viewer: SheetViewer; onChanged: () => void;
}) {
  const { toast } = useToast();
  const [edits, setEdits] = useState<Record<string, Partial<RowDraft>>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [extra, setExtra] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [changesOpen, setChangesOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [importErrors, setImportErrors] = useState<string[]>([]);

  const locked = data.period?.status === 'LOCKED';
  const label = monthLabelOf(month);
  // Admin, Kế toán trưởng, Ban Giám đốc quyền ngang nhau ở công ty này — ai
  // trong ba cũng giao/sửa chỉ tiêu và tự xác nhận được, không tách vai trò.
  const canConfirm = viewer.canManage || viewer.isBoard || viewer.canClose;
  const personById = useMemo(() => new Map(data.profiles.map((person) => [person.id, person])), [data.profiles]);
  const targetByUser = useMemo(() => new Map(data.sales.map((row) => [row.user_id, row])), [data.sales]);

  // Người trong khối Kinh doanh: có phiếu khối KD tháng này, đã có chỉ tiêu, hoặc vừa thêm tay.
  const userIds = useMemo(() => {
    const ids = new Set<string>();
    data.sheets.filter((sheet) => sheet.block === 'KINH_DOANH').forEach((sheet) => ids.add(sheet.user_id));
    data.sales.forEach((row) => ids.add(row.user_id));
    extra.forEach((id) => ids.add(id));
    return [...ids];
  }, [data.sheets, data.sales, extra]);

  // Thêm nhân viên chỉ chọn được người khối Kinh doanh — khác thì cơ chế lương
  // không có dòng nào đọc số, nhập vào cũng không tác dụng tới lương.
  const unitById = useMemo(() => new Map(data.units.map((unit) => [unit.id, unit])), [data.units]);
  const isKinhDoanh = useMemo(() => {
    const cache = new Map<string, boolean>();
    return (person: { id: string; unit_id?: string | null; position_id?: string | null }) => {
      const cached = cache.get(person.id);
      if (cached !== undefined) return cached;
      const lineage = unitLineage(person.unit_id, unitById);
      const result =
        kpiSetFor(person, data.sets, lineage.map((unit) => unit.id), month)?.set.block === 'KINH_DOANH'
        || lineage.some((unit) => fold(unit.name).includes('kinh doanh'));
      cache.set(person.id, result);
      return result;
    };
  }, [data.sets, month, unitById]);

  const keyword = fold(query);
  const rows = userIds
    .map((id) => ({ id, person: personById.get(id), target: targetByUser.get(id) ?? null }))
    .filter((row) => !keyword || fold(row.person?.name ?? '').includes(keyword))
    .sort((a, b) => (a.person?.name ?? '').localeCompare(b.person?.name ?? '', 'vi'));

  const valueOf = (userId: string, field: keyof RowDraft, target: KpiSalesTarget | null) => {
    const edit = edits[userId]?.[field];
    if (edit !== undefined) return edit;
    const raw = target?.[field];
    return raw == null ? '' : String(raw);
  };
  const setValue = (userId: string, field: keyof RowDraft, value: string) =>
    setEdits((current) => ({ ...current, [userId]: { ...current[userId], [field]: value.replace(/[^\d.,]/g, '') } }));

  const targetEditable = (target: KpiSalesTarget | null) => canConfirm && (!target || target.status === 'DRAFT' || target.status === 'CHANGES');
  const actualEditable = canConfirm && !locked;

  const changedTargets = Object.entries(edits).filter(([userId, edit]) =>
    targetEditable(targetByUser.get(userId) ?? null) && (edit.sales_target !== undefined || edit.collect_target !== undefined || edit.customers_target !== undefined));
  const changedActuals = Object.entries(edits).filter(([userId, edit]) =>
    targetByUser.has(userId) && (edit.sales_actual !== undefined || edit.collect_actual !== undefined || edit.customers_actual !== undefined));

  const num = (userId: string, field: keyof RowDraft) => parseNum(valueOf(userId, field, targetByUser.get(userId) ?? null));

  const handleSave = async () => {
    setBusy('save');
    if (changedTargets.length) {
      const { error } = await saveSalesTargets(month, changedTargets.map(([userId]) => ({
        user_id: userId,
        sales_target: num(userId, 'sales_target') ?? 0,
        collect_target: num(userId, 'collect_target') ?? 0,
        customers_target: num(userId, 'customers_target') ?? 0,
      })));
      if (error) { setBusy(null); toast(error, 'error'); return; }
    }
    if (changedActuals.length) {
      const { error } = await saveSalesActuals(month, changedActuals.map(([userId]) => ({
        user_id: userId,
        sales_actual: num(userId, 'sales_actual'),
        collect_actual: num(userId, 'collect_actual'),
        customers_actual: num(userId, 'customers_actual'),
      })));
      if (error) { setBusy(null); toast(error, 'error'); return; }
    }
    setBusy(null);
    setEdits({});
    toast('Đã lưu.');
    onChanged();
  };

  const act = async (action: 'SUBMIT' | 'APPROVE' | 'CHANGES') => {
    setBusy(action);
    const { data: count, error } = await reviewSalesTargets(month, [...selected], action, action === 'CHANGES' ? reason : undefined);
    setBusy(null);
    if (error) { toast(error, 'error'); return; }
    toast(`${count ?? 0} chỉ tiêu: ${action === 'SUBMIT' ? 'đã gửi duyệt' : action === 'APPROVE' ? 'đã duyệt' : 'đã yêu cầu điều chỉnh'}.`);
    setSelected(new Set());
    setChangesOpen(false); setReason('');
    onChanged();
  };

  const downloadTemplate = async () => {
    const XLSX = await import('xlsx');
    const sheetData = [
      ['Mã NV', 'Họ tên', 'Doanh số khoán', 'Chỉ tiêu thu', 'Số KH phụ trách', 'Doanh số cắt mã', 'Thu tiền', 'Số KH có đơn'],
      ...rows.map((row) => [
        row.person?.employee_code ?? '', row.person?.name ?? '',
        row.target?.sales_target ?? '', row.target?.collect_target ?? '', row.target?.customers_target ?? '',
        row.target?.sales_actual ?? '', row.target?.collect_actual ?? '', row.target?.customers_actual ?? '',
      ]),
    ];
    const sheet = XLSX.utils.aoa_to_sheet(sheetData);
    sheet['!cols'] = [
      { wch: 12 }, { wch: 24 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 18 },
    ];
    sheet['!rows'] = [{ hpt: 26 }, ...rows.map(() => ({ hpt: 22 }))];
    sheet['!views'] = [{ state: 'frozen', ySplit: 1 }];
    sheet['!autofilter'] = {
      ref: XLSX.utils.encode_range({
        s: { r: 0, c: 0 },
        e: { r: Math.max(0, sheetData.length - 1), c: 7 },
      }),
    };

    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, 'Chỉ tiêu');
    XLSX.writeFile(book, `chi-tieu-kinh-doanh-${month.slice(0, 7)}.xlsx`);
  };

  const importFile = async (file: File) => {
    const XLSX = await import('xlsx');
    const book = XLSX.read(await file.arrayBuffer());
    const table = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets[book.SheetNames[0]], { header: 1, defval: '' });
    const errors: string[] = [];
    const next: Record<string, Partial<RowDraft>> = { ...edits };
    const added: string[] = [];
    const byCode = new Map(data.profiles.filter((person) => person.employee_code).map((person) => [String(person.employee_code).trim().toLowerCase(), person]));
    const byName = new Map(data.profiles.map((person) => [fold(person.name), person]));
    table.slice(1).forEach((cells, index) => {
      const line = index + 2;
      const [code, name, ...values] = cells.map((cell) => String(cell ?? '').trim());
      if (!code && !name) return;
      const person = byCode.get(code.toLowerCase()) ?? byName.get(fold(name));
      if (!person) { errors.push(`Dòng ${line}: không tìm thấy nhân viên “${code || name}”.`); return; }
      if (!userIds.includes(person.id) && !isKinhDoanh(person)) {
        errors.push(`Dòng ${line}: ${person.name} không thuộc khối Kinh doanh — bỏ qua.`); return;
      }
      const draft: Partial<RowDraft> = {};
      let bad = false;
      FIELDS.forEach((field, i) => {
        const raw = values[i] ?? '';
        if (raw === '') return;
        const value = parseNum(raw);
        if (value == null || value < 0) { bad = true; errors.push(`Dòng ${line}: “${raw}” không phải số hợp lệ.`); return; }
        draft[field] = String(value);
      });
      if (bad) return;
      next[person.id] = { ...next[person.id], ...draft };
      if (!userIds.includes(person.id)) added.push(person.id);
    });
    setEdits(next);
    setExtra((current) => [...current, ...added]);
    setImportErrors(errors);
    toast(errors.length ? `Đã đọc tệp, ${errors.length} dòng lỗi bị bỏ qua — kiểm tra rồi bấm Lưu.` : 'Đã đọc tệp — kiểm tra rồi bấm Lưu.', errors.length ? 'warning' : 'success');
  };

  const selectable = (target: KpiSalesTarget | null) => !!target;
  const allSelected = rows.length > 0 && rows.filter((row) => selectable(row.target)).every((row) => selected.has(row.id));
  const disputes = data.sales.filter((row) => row.confirm_status === 'DISPUTED');

  const getCellClass = (isEdited: boolean) =>
    `h-8 w-full min-w-[6.5rem] rounded-md border px-2 text-center text-sm tabular-nums font-bold transition-all duration-150 outline-none shadow-xs ${
      isEdited
        ? 'border-indigo-400 bg-indigo-50/60 text-indigo-950 ring-1 ring-indigo-400/30 dark:border-indigo-500 dark:bg-indigo-950/50 dark:text-indigo-100'
        : 'border-slate-300 bg-white text-slate-900 hover:border-slate-400 hover:bg-slate-50/60 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:border-slate-500 dark:hover:bg-slate-750'
    } focus:border-indigo-600 focus:bg-white focus:ring-2 focus:ring-indigo-500/20 dark:focus:border-indigo-400 dark:focus:bg-slate-800`;

  return (
    <div className="space-y-4">
      {disputes.length > 0 && (
        <Banner tone="red" icon={<TriangleAlert className="mt-0.5 h-4 w-4 flex-shrink-0" />}>
          {disputes.length} nhân viên khiếu nại số liệu:{' '}
          {disputes.map((row) => `${personById.get(row.user_id)?.name ?? '—'} (${row.dispute_note ?? ''})`).join('; ')}
        </Banner>
      )}
      <Card className="!rounded-none border-2 border-slate-400 dark:border-slate-600 shadow-sm overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b-2 border-slate-300 dark:border-slate-700 px-4 py-3 no-print">
          <div className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Lọc theo tên nhân viên…" aria-label="Lọc theo tên"
              className="h-10 w-full rounded-xl border border-slate-300 bg-white pl-9 pr-3 text-sm font-semibold outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20" />
          </div>
          {canConfirm && (
            <div className="w-full sm:w-56">
              <Dropdown aria-label="Thêm nhân viên kinh doanh" value="" searchable
                placeholder={data.profiles.some((person) => !userIds.includes(person.id) && isKinhDoanh(person)) ? 'Thêm nhân viên…' : 'Không còn ai ở khối KD'}
                options={data.profiles.filter((person) => !userIds.includes(person.id) && isKinhDoanh(person)).map((person) => ({ value: person.id, label: person.name }))}
                onChange={(value) => setExtra((current) => [...current, value])} />
            </div>
          )}
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => void downloadTemplate()}><Download className="h-3.5 w-3.5" /> Tải mẫu</Button>
            {canConfirm && (
              <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700 shadow-sm hover:bg-slate-50">
                <FileUp className="h-3.5 w-3.5" /> Nhập Excel
                <input type="file" accept=".xlsx,.xls" className="hidden"
                  onChange={(event) => { const file = event.target.files?.[0]; if (file) void importFile(file); event.target.value = ''; }} />
              </label>
            )}
            <Button size="sm" onClick={() => void handleSave()} disabled={!!busy || (changedTargets.length + changedActuals.length === 0)}>
              <Save className="h-3.5 w-3.5" /> {busy === 'save' ? 'Đang lưu…' : 'Lưu'}
            </Button>
          </div>
        </div>

        {importErrors.length > 0 && (
          <ul className="list-disc space-y-0.5 border-b border-slate-200 py-2 pl-9 pr-4 text-xs font-semibold text-red-600">
            {importErrors.map((error) => <li key={error}>{error}</li>)}
          </ul>
        )}

        {selected.size > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-b border-indigo-200 bg-indigo-50 px-4 py-2 text-sm font-bold">
            <span className="font-black text-indigo-900">Đã chọn {selected.size}</span>
            {canConfirm && (
              <>
                <Button size="sm" variant="success" onClick={() => void act('APPROVE')} disabled={!!busy}><CheckCircle2 className="h-3.5 w-3.5" /> Xác nhận</Button>
                <Button size="sm" variant="outline" onClick={() => setChangesOpen(true)} disabled={!!busy}><Undo2 className="h-3.5 w-3.5" /> Mở lại để sửa</Button>
              </>
            )}
          </div>
        )}

        {rows.length === 0 ? (
          <p className="px-6 py-12 text-center text-sm font-semibold text-slate-500">
            Chưa có nhân viên kinh doanh tháng {label}.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1080px] whitespace-nowrap text-sm tabular-nums text-slate-900 dark:text-slate-100 border-collapse">
              <thead>
                <tr className="border-b-2 border-slate-400 dark:border-slate-600 bg-slate-100 dark:bg-slate-800 text-xs font-black uppercase tracking-wider text-slate-900 dark:text-slate-100">
                  <th className="w-10 px-3 py-3 text-center">
                    <input type="checkbox" aria-label="Chọn tất cả" checked={allSelected} className="h-4 w-4 accent-indigo-600"
                      onChange={(event) => setSelected(event.target.checked ? new Set(rows.filter((row) => row.target).map((row) => row.id)) : new Set())} />
                  </th>
                  <th className="px-3 py-3 text-left">Nhân viên</th>
                  <th className="border-l border-slate-400 dark:border-slate-600 px-2 py-3 text-center">Doanh số khoán</th>
                  <th className="border-l border-slate-400 dark:border-slate-600 px-2 py-3 text-center">Chỉ tiêu thu</th>
                  <th className="border-l border-slate-400 dark:border-slate-600 px-2 py-3 text-center">KH phụ trách</th>
                  <th className="border-l border-slate-400 dark:border-slate-600 px-2 py-3 text-center">Cắt mã</th>
                  <th className="border-l border-slate-400 dark:border-slate-600 px-2 py-3 text-center">Thu tiền</th>
                  <th className="border-l border-slate-400 dark:border-slate-600 px-2 py-3 text-center">KH có đơn</th>
                  <th className="border-l border-slate-400 dark:border-slate-600 px-2 py-3 text-center">% đạt bán / thu / KH</th>
                  <th className="border-l border-slate-400 dark:border-slate-600 px-2 py-3 text-center">Trạng thái</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-300 dark:divide-slate-700 bg-white dark:bg-slate-900 font-semibold">
                {rows.map(({ id, person, target }) => {
                  const tEdit = targetEditable(target);
                  const sales = num(id, 'sales_actual');
                  const collect = num(id, 'collect_actual');
                  const customers = num(id, 'customers_actual');
                  return (
                    <tr key={id} className="group transition-colors hover:bg-slate-100/80 dark:hover:bg-slate-800/60">
                      <td className="px-3 py-1.5 text-center">
                        <input type="checkbox" disabled={!target} aria-label={`Chọn ${person?.name ?? ''}`} className="h-4 w-4 accent-indigo-600"
                          checked={selected.has(id)}
                          onChange={(event) => setSelected((current) => {
                            const next = new Set(current);
                            if (event.target.checked) next.add(id); else next.delete(id);
                            return next;
                          })} />
                      </td>
                      <td className="px-3 py-1.5">
                        <p className="font-bold text-slate-900 dark:text-slate-100">{person?.name ?? '—'}</p>
                        {target?.review_reason && <p className="text-[11px] font-semibold text-red-600 dark:text-red-400">{target.review_reason}</p>}
                      </td>
                      {(['sales_target', 'collect_target', 'customers_target'] as const).map((field) => {
                        const isEdited = edits[id]?.[field] !== undefined;
                        return (
                          <td key={field} className="border-l border-slate-300 dark:border-slate-700 px-1.5 py-1.5 text-center font-semibold">
                            {tEdit ? (
                              <input
                                value={valueOf(id, field, target)}
                                inputMode="decimal"
                                aria-label={field}
                                onChange={(event) => setValue(id, field, event.target.value)}
                                className={getCellClass(isEdited)}
                              />
                            ) : fmtNum(target?.[field])}
                          </td>
                        );
                      })}
                      {(['sales_actual', 'collect_actual', 'customers_actual'] as const).map((field) => {
                        const isEdited = edits[id]?.[field] !== undefined;
                        return (
                          <td key={field} className="border-l border-slate-300 dark:border-slate-700 px-1.5 py-1.5 text-center font-semibold">
                            {actualEditable && target ? (
                              <input
                                value={valueOf(id, field, target)}
                                inputMode="decimal"
                                aria-label={field}
                                placeholder="—"
                                onChange={(event) => setValue(id, field, event.target.value)}
                                className={getCellClass(isEdited)}
                              />
                            ) : fmtNum(target?.[field])}
                          </td>
                        );
                      })}
                      <td className="border-l border-slate-300 dark:border-slate-700 px-2 py-1.5 text-center font-semibold">
                        {target ? (
                          <span>
                            {fmtPct(pct(sales, target.sales_target))} / {fmtPct(pct(collect, target.collect_target))} / {fmtPct(pct(customers, target.customers_target))}
                          </span>
                        ) : '—'}
                      </td>
                      <td className="border-l border-slate-300 dark:border-slate-700 px-2 py-1.5 text-center">
                        {target ? (
                          <>
                            <span className={`inline-flex rounded-md px-1.5 py-0.5 text-[10px] font-bold ring-1 ring-inset ${SALES_STATUS_TONE[target.status]}`}>
                              {SALES_STATUS_LABEL[target.status]}
                            </span>
                            {target.confirm_status && (
                              <p className={`mt-0.5 text-[10px] font-semibold ${target.confirm_status === 'CONFIRMED' ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                                {target.confirm_status === 'CONFIRMED' ? 'NV đã xác nhận' : 'NV khiếu nại'}
                              </p>
                            )}
                          </>
                        ) : <span className="text-[11px] text-slate-400">Chưa giao</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal square open={changesOpen} onClose={() => setChangesOpen(false)} title="Mở lại chỉ tiêu để sửa" size="sm">
        <div className="space-y-3">
          <Textarea className="!rounded-none" label="Lý do" required rows={3} value={reason} onChange={(event) => setReason(event.target.value)} autoFocus />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setChangesOpen(false)}>Huỷ</Button>
            <Button onClick={() => void act('CHANGES')} disabled={reason.trim().length < 3 || !!busy}>Mở lại</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
