// ============================================================================
// Mẫu phiếu lương của một ĐƠN VỊ — thẻ "Phiếu lương" ở Cơ chế lương.
// ----------------------------------------------------------------------------
// Mã mẫu, tiêu đề, đầu mục nào lên đầu phiếu (dòng trung gian của cơ chế) và
// khoản trừ nào đứng trước Tổng cộng. Phần còn lại phiếu tự đánh số theo nhóm
// của Danh mục. Mẫu thừa hưởng như cơ chế (lib/payslipLayout); lưu mẫu không
// đổi cách tính.
// ============================================================================

import { useEffect, useMemo, useState } from 'react';
import { Eye, RotateCcw, Save } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { PayslipDocument, documentLinesFromCatalog } from '@/components/payroll/PayslipDocument';
import { fullMonthStats, monthEndOf, monthText } from '@/components/payroll/schemeWorkbench';
import { useToast } from '@/contexts/ToastContext';
import { useAppSettings } from '@/contexts/SettingsContext';
import { computePayslip } from '@/lib/payroll';
import { unitMechanismRows } from '@/lib/payrollScheme';
import { nameResolver, paramsForMonth, schemeSourceOf } from '@/lib/payrollRun';
import { savePayslipLayout, type PayrollWorkspace } from '@/lib/payrollData';
import {
  HEADER_FORMAT_LABEL, fromStoredLayout, guessHeaderFormat, resolvePayslipLayout, type ResolvedPayslipLayout,
} from '@/lib/payslipLayout';
import type { OrganizationUnit, PayComponent, PayslipHeaderFormat } from '@/types';

interface PayslipLayoutEditorProps {
  data: PayrollWorkspace;
  unit: OrganizationUnit;
  monthStart: string;
  canManage: boolean;
  onChanged: () => void;
}

const inputClass = 'h-9 w-full rounded-none border border-slate-200 px-3 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 disabled:bg-slate-50';

export function PayslipLayoutEditor({ data, unit, monthStart, canManage, onChanged }: PayslipLayoutEditorProps) {
  const { toast } = useToast();
  const app = useAppSettings();
  const readOnly = !canManage;
  const monthEnd = monthEndOf(monthStart);

  const ownLayout = useMemo(() => {
    const own = data.payslipLayouts.find((layout) => layout.unit_id === unit.id);
    return own ? fromStoredLayout(own) : null;
  }, [data.payslipLayouts, unit.id]);
  const parentLayout = useMemo(
    () => resolvePayslipLayout(unit.parent_id, data.units, data.payslipLayouts, data.components),
    [data.components, data.payslipLayouts, data.units, unit.parent_id],
  );
  /** null = theo cấp trên (hoặc mặc định). */
  const [draft, setDraft] = useState<ResolvedPayslipLayout | null>(ownLayout);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const ownKey = JSON.stringify(ownLayout);
  useEffect(() => {
    if (!dirty) setDraft(ownLayout);
  }, [ownKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const layout = draft ?? parentLayout;
  const origin = draft ? null
    : parentLayout.originUnitId ? data.units.find((item) => item.id === parentLayout.originUnitId)?.name ?? 'cấp trên' : null;

  // ---- Dòng của cơ chế chung, để chọn và để xem phiếu mẫu ---------------------
  const source = useMemo(() => schemeSourceOf(data), [data]);
  const rows = useMemo(
    () => [...unitMechanismRows(unit.id, source, monthStart, monthEnd).values()]
      .sort((a, b) => a.sortOrder - b.sortOrder || a.component.sort_order - b.component.sort_order),
    [monthEnd, monthStart, source, unit.id],
  );
  const intermediates = rows.filter((row) => row.component.kind === 'INFO').map((row) => row.component);
  const deductions = rows.filter((row) => row.component.kind === 'DEDUCTION').map((row) => row.component);

  const params = useMemo(() => paramsForMonth(data, app, new Date(`${monthStart}T00:00:00`), monthStart), [app, data, monthStart]);
  const result = useMemo(() => {
    if (!params || rows.length === 0) return null;
    return computePayslip({
      profile: { id: 'sample', name: 'Nhân viên mẫu' },
      rows,
      stats: fullMonthStats(params),
      params,
      inputs: {},
      catalogCodes: data.components.map((component) => component.code),
      nameOf: nameResolver(data.components, params),
    });
  }, [data.components, params, rows]);

  // ---- Sửa ---------------------------------------------------------------------
  /** Đang theo cấp trên thì tách thành mẫu riêng, mang sẵn nội dung cũ. */
  const patch = (next: Partial<ResolvedPayslipLayout>) => {
    setDraft({ ...layout, originUnitId: unit.id, ...next });
    setDirty(true);
  };

  const headerFormatOf = (code: string) => layout.header.find((item) => item.code === code)?.format ?? null;
  const setHeader = (component: PayComponent, on: boolean, format?: PayslipHeaderFormat) => {
    const current = new Map(layout.header.map((item) => [item.code, item.format]));
    if (on) current.set(component.code, format ?? current.get(component.code) ?? guessHeaderFormat(component.name));
    else current.delete(component.code);
    const order = new Map(rows.map((row, index) => [row.component.code, index]));
    const header = [...current.entries()]
      .sort(([a], [b]) => (order.get(a) ?? Number.MAX_SAFE_INTEGER) - (order.get(b) ?? Number.MAX_SAFE_INTEGER))
      .map(([code, value]) => ({ code, format: value }));
    patch({ header });
  };
  const setBeforeTotal = (component: PayComponent, on: boolean) => {
    const rest = layout.beforeTotal.filter((code) => code !== component.code);
    patch({ beforeTotal: on ? [...rest, component.code] : rest });
  };

  const handleSave = async () => {
    setSaving(true);
    const error = await savePayslipLayout(unit.id, draft ? {
      form_code: draft.formCode?.trim() || null,
      title: draft.title?.trim() || null,
      header: draft.header,
      before_total: draft.beforeTotal,
    } : null);
    setSaving(false);
    if (error) { toast('Không lưu được mẫu phiếu lương: ' + error, 'error'); return; }
    setDirty(false);
    toast(`Đã lưu mẫu phiếu lương của ${unit.name}.`, 'success');
    onChanged();
  };

  return (
    <div className="space-y-4 pb-20">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${draft ? 'bg-indigo-50 text-indigo-600' : 'bg-slate-100 text-slate-500'}`}>
          {draft ? 'Mẫu riêng của đơn vị' : origin ? `Theo ${origin}` : 'Mặc định'}
        </span>
        <div className="flex flex-wrap gap-2">
          {!readOnly && draft && unit.parent_id && (
            <Button size="sm" variant="ghost" onClick={() => { setDraft(null); setDirty(true); }}>
              <RotateCcw className="h-3.5 w-3.5" /> Theo cấp trên
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => setPreviewOpen(true)} disabled={!result}>
            <Eye className="h-4 w-4" /> Xem phiếu mẫu
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
        <label className="space-y-1">
          <span className="text-xs font-semibold text-slate-600">Mã mẫu</span>
          <input
            value={layout.formCode ?? ''}
            onChange={(event) => patch({ formCode: event.target.value })}
            placeholder="VD: BL 01"
            disabled={readOnly}
            className={inputClass}
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs font-semibold text-slate-600">Tiêu đề</span>
          <input
            value={layout.title ?? ''}
            onChange={(event) => patch({ title: event.target.value })}
            placeholder={unit.name}
            disabled={readOnly}
            className={inputClass}
          />
        </label>
      </div>

      <PickList
        title="Đầu phiếu"
        empty="Cơ chế chung chưa có dòng trung gian nào."
        items={intermediates}
        isOn={(component) => !!headerFormatOf(component.code)}
        onToggle={(component, on) => setHeader(component, on)}
        readOnly={readOnly}
        extra={(component) => {
          const format = headerFormatOf(component.code);
          if (!format) return null;
          return readOnly ? (
            <span className="text-xs text-slate-500">{HEADER_FORMAT_LABEL[format]}</span>
          ) : (
            <select
              value={format}
              onChange={(event) => setHeader(component, true, event.target.value as PayslipHeaderFormat)}
              aria-label={`Cách in ${component.name}`}
              className="h-8 rounded-none border border-slate-200 bg-white px-2 text-xs text-slate-700 outline-none focus:border-indigo-500"
            >
              {(Object.keys(HEADER_FORMAT_LABEL) as PayslipHeaderFormat[]).map((value) => (
                <option key={value} value={value}>{HEADER_FORMAT_LABEL[value]}</option>
              ))}
            </select>
          );
        }}
      />

      <PickList
        title="Khoản trừ trước Tổng cộng"
        empty="Cơ chế chung chưa có khoản trừ nào."
        items={deductions}
        isOn={(component) => layout.beforeTotal.includes(component.code)}
        onToggle={setBeforeTotal}
        readOnly={readOnly}
      />

      <Modal square open={previewOpen && !!result} onClose={() => setPreviewOpen(false)} title={`Phiếu mẫu — ${unit.name}`} size="xl">
        {result && (
          <div className="overflow-hidden rounded-none border border-slate-200">
            <PayslipDocument
              lines={documentLinesFromCatalog(result.lines, data.components, data.categories, layout)}
              netPay={result.netPay}
              roundingAdjustment={result.roundingAdjustment}
              monthLabel={monthText(monthStart)}
              employeeName="Nhân viên mẫu"
              unitName={unit.name}
              standardDays={result.standardDays}
              layout={layout}
            />
          </div>
        )}
      </Modal>

      {dirty && !readOnly && (
        <div className="fixed bottom-0 left-0 right-0 z-30 border-t border-slate-200 bg-white/95 px-4 py-3 shadow-lg backdrop-blur-md print:hidden">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 lg:pl-64">
            <p className="flex items-center gap-1.5 text-sm text-slate-600"><Save className="h-4 w-4" /> Mẫu phiếu chưa lưu</p>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => { setDirty(false); setDraft(ownLayout); }} disabled={saving}>Huỷ thay đổi</Button>
              <Button onClick={() => void handleSave()} disabled={saving}>
                <Save className="h-4 w-4" /> {saving ? 'Đang lưu…' : 'Lưu mẫu phiếu'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PickList({ title, empty, items, isOn, onToggle, readOnly, extra }: {
  title: string;
  empty: string;
  items: PayComponent[];
  isOn: (component: PayComponent) => boolean;
  onToggle: (component: PayComponent, on: boolean) => void;
  readOnly: boolean;
  extra?: (component: PayComponent) => React.ReactNode;
}) {
  const count = items.filter(isOn).length;
  return (
    <section className="space-y-2">
      <h3 className="flex items-baseline gap-2 border-b border-slate-200 pb-1.5 text-xs font-extrabold uppercase tracking-wider text-slate-600">
        {title}
        <span className="font-semibold normal-case tracking-normal text-slate-400">{count}/{items.length}</span>
      </h3>
      {items.length === 0 ? (
        <p className="text-sm text-slate-400">{empty}</p>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-none border border-slate-200 bg-white">
          {items.map((component) => {
            const on = isOn(component);
            return (
              <li key={component.id} className="flex min-h-11 items-center gap-3 px-3 py-1.5">
                <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5">
                  <input
                    type="checkbox"
                    className="h-4 w-4 shrink-0 accent-indigo-600"
                    checked={on}
                    disabled={readOnly}
                    onChange={(event) => onToggle(component, event.target.checked)}
                  />
                  <span className={`truncate text-sm font-semibold ${on ? 'text-slate-800' : 'text-slate-500'}`}>{component.name}</span>
                </label>
                {extra?.(component)}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
