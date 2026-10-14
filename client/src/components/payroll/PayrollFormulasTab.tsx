// ============================================================================
// F06.02 · FR06.02.02 — Công thức tính lương theo KHỐI (mẫu BL 01 / BL 02).
// ----------------------------------------------------------------------------
// BR-PAY-002: Văn phòng, Kho, Vận chuyển theo BL 01; Kinh doanh theo BL 02.
// Một mẫu = danh sách khoản + công thức / mức của từng khoản. Gán mẫu cho
// đơn vị trên cây tổ chức; đơn vị con THỪA HƯỞNG mẫu của đơn vị gần nhất phía
// trên (cùng quy ước với KPI). Người cần khác thì khai riêng ở Cơ chế lương.
//
// Mọi thay đổi có "hiệu lực từ tháng": khoản cũ đóng ở cuối tháng trước, khoản
// mới mở từ tháng đó — kỳ đã tính không bị đổi ngược. Database chặn mọi thay
// đổi chạm vào kỳ đã khoá.
// ============================================================================

import { useEffect, useMemo, useState } from 'react';
import {
  FlaskConical, GitBranch, PackagePlus, Pencil, Plus, Power, Trash2, TriangleAlert,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input, Select, Textarea } from '@/components/ui/Input';
import { PayrollFormulaBuilder } from '@/components/payroll/PayrollFormulaBuilder';
import { UnitTreeList, flattenUnitTree } from '@/components/payroll/UnitTree';
import { useToast } from '@/contexts/ToastContext';
import { useConfirm } from '@/contexts/ConfirmContext';
import { formatVND, getTodayString } from '@/lib/utils';
import { sampleFormulaScope } from '@/lib/payroll';
import { explainFormulaError } from '@/lib/payrollFormula';
import { firstEditableMonth, type PayrollParams, type PayrollParamVersion } from '@/lib/payrollSettings';
import { resolveTemplateForUnit } from '@/lib/payrollScheme';
import { unitMapOf } from '@/lib/payrollRun';
import {
  assignTemplate, deleteTemplate, endTemplateItem, saveTemplate, saveTemplateItem, seedTemplateDefaults,
  type PayrollWorkspace,
} from '@/lib/payrollData';
import type { OrganizationUnit, PayrollTemplate, PayrollTemplateItem } from '@/types';

interface PayrollFormulasTabProps {
  data: PayrollWorkspace;
  params: PayrollParams | null;
  activeVersion: PayrollParamVersion | null;
  lastClosedMonth: string | null;
  canManage: boolean;
  onChanged: () => void;
  onDryRun: (templateId: string) => void;
}

const monthText = (iso: string) => (iso.startsWith('2000-01') ? 'trước đây' : `${iso.slice(5, 7)}/${iso.slice(0, 4)}`);

export function PayrollFormulasTab({
  data, params, activeVersion, lastClosedMonth, canManage, onChanged, onDryRun,
}: PayrollFormulasTabProps) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const minMonth = firstEditableMonth(lastClosedMonth, getTodayString());

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [effectiveMonth, setEffectiveMonth] = useState(minMonth);
  const [templateDraft, setTemplateDraft] = useState<{ id?: string; code: string; name: string; description: string } | null>(null);
  const [itemDraft, setItemDraft] = useState<{
    componentId: string; amount: string; formula: string; taxable: '' | 'true' | 'false'; insurable: '' | 'true' | 'false'; note: string; isNew: boolean;
  } | null>(null);
  const [assigning, setAssigning] = useState<{ unit: OrganizationUnit | null; templateId: string | null; month: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { setEffectiveMonth((current) => (current < minMonth ? minMonth : current)); }, [minMonth]);
  useEffect(() => {
    if (!selectedId && data.templates.length > 0) setSelectedId(data.templates[0].id);
  }, [data.templates, selectedId]);

  const template = data.templates.find((item) => item.id === selectedId) ?? null;
  const componentById = useMemo(() => new Map(data.components.map((c) => [c.id, c])), [data.components]);
  const unitById = useMemo(() => unitMapOf(data), [data]);
  const unitRows = useMemo(() => flattenUnitTree(data.units), [data.units]);
  const assignable = data.components.filter((c) => c.calc_source !== 'ENGINE' && c.is_active);

  /** Khoản của mẫu đang hiệu lực ở tháng đang chọn. */
  const itemsAt = (templateId: string, month: string): PayrollTemplateItem[] => data.templateItems
    .filter((item) => item.template_id === templateId && item.effective_from <= month
      && (!item.effective_to || item.effective_to >= month))
    .sort((a, b) => (componentById.get(a.component_id)?.sort_order ?? 0) - (componentById.get(b.component_id)?.sort_order ?? 0));

  /** Đơn vị khai THẲNG mẫu này (bản ghi mới nhất ≤ tháng đang chọn). */
  const directUnits = (templateId: string) => data.units.filter((unit) => {
    const latest = data.unitTemplates
      .filter((row) => row.unit_id === unit.id && row.effective_from <= effectiveMonth)
      .sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0];
    return latest?.template_id === templateId;
  });
  /** Người đang theo mẫu này (thừa hưởng qua cây). */
  const peopleOn = (templateId: string) => data.profiles.filter((person) => person.unit_id
    && resolveTemplateForUnit(person.unit_id, { templates: data.templates, unitTemplates: data.unitTemplates, unitById }, effectiveMonth)
      .template?.id === templateId);

  const formulaScope = useMemo(() => (params ? sampleFormulaScope(params, [
    ...data.components.map((c) => c.code), ...data.components.map((c) => c.input_code ?? '').filter(Boolean),
  ]) : {}), [params, data.components]);

  // ------------------------------------------------------------------------
  const saveTemplateInfo = async () => {
    if (!templateDraft) return;
    const code = templateDraft.code.trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9_]*$/.test(code)) return toast('Mã mẫu viết hoa không dấu, VD: BL03.', 'warning');
    if (!templateDraft.name.trim()) return toast('Nhập tên mẫu.', 'warning');
    setBusy(true);
    const { id, error } = await saveTemplate({
      ...(templateDraft.id ? { id: templateDraft.id } : {}),
      code, name: templateDraft.name.trim(), description: templateDraft.description.trim() || null,
    });
    setBusy(false);
    if (error) return toast('Lưu mẫu thất bại: ' + error, 'error');
    toast('Đã lưu mẫu bảng lương.', 'success');
    setTemplateDraft(null);
    if (id) setSelectedId(id);
    onChanged();
  };

  const toggleActive = async (target: PayrollTemplate) => {
    const { error } = await saveTemplate({ ...target, is_active: !target.is_active });
    if (error) return toast(error, 'error');
    toast(target.is_active ? 'Đã ngừng dùng mẫu.' : 'Đã bật lại mẫu.', 'success');
    onChanged();
  };

  const removeTemplate = async (target: PayrollTemplate) => {
    const ok = await confirm({
      title: `Xoá mẫu ${target.code}?`,
      message: 'Chỉ xoá được mẫu chưa từng gán cho đơn vị hay nhân sự nào. Mẫu đã dùng thì chuyển Ngừng dùng.',
      confirmLabel: 'Xoá mẫu', danger: true,
    });
    if (!ok) return;
    const error = await deleteTemplate(target.id);
    if (error) return toast(error, 'error');
    setSelectedId(null);
    onChanged();
  };

  const openItem = (item: PayrollTemplateItem | null) => {
    setItemDraft(item ? {
      componentId: item.component_id,
      amount: item.amount == null ? '' : String(Number(item.amount)),
      formula: item.formula ?? '',
      taxable: item.taxable == null ? '' : String(item.taxable) as 'true' | 'false',
      insurable: item.insurable == null ? '' : String(item.insurable) as 'true' | 'false',
      note: item.note ?? '',
      isNew: false,
    } : {
      componentId: assignable.find((c) => !itemsAt(template?.id ?? '', effectiveMonth).some((i) => i.component_id === c.id))?.id ?? '',
      amount: '', formula: '', taxable: '', insurable: '', note: '', isNew: true,
    });
  };

  const formulaIssue = itemDraft?.formula.trim()
    ? explainFormulaError(itemDraft.formula, formulaScope, { functions: params?.tierFunctions })
    : null;

  const saveItem = async () => {
    if (!template || !itemDraft) return;
    if (!itemDraft.componentId) return toast('Chọn khoản lương.', 'warning');
    if (formulaIssue) return toast('Công thức chưa hợp lệ — sửa đoạn tô đỏ.', 'warning');
    const amount = itemDraft.amount.trim() === '' ? null : Number(itemDraft.amount);
    if (amount != null && (!Number.isFinite(amount) || amount < 0)) return toast('Mức tiền phải là số không âm.', 'warning');
    setBusy(true);
    const error = await saveTemplateItem({
      templateId: template.id,
      componentId: itemDraft.componentId,
      effectiveFrom: effectiveMonth,
      amount,
      formula: itemDraft.formula.trim() || null,
      taxable: itemDraft.taxable === '' ? null : itemDraft.taxable === 'true',
      insurable: itemDraft.insurable === '' ? null : itemDraft.insurable === 'true',
      note: itemDraft.note.trim() || null,
    });
    setBusy(false);
    if (error) return toast('Lưu thất bại: ' + error, 'error');
    toast(`Đã lưu, hiệu lực từ ${monthText(effectiveMonth)}.`, 'success');
    setItemDraft(null);
    onChanged();
  };

  const endItem = async (item: PayrollTemplateItem) => {
    if (!template) return;
    const name = componentById.get(item.component_id)?.name ?? 'khoản';
    const ok = await confirm({
      title: `Bỏ "${name}" khỏi ${template.code}?`,
      message: `Từ ${monthText(effectiveMonth)} người theo mẫu này không còn khoản này; các tháng trước giữ nguyên.`,
      confirmLabel: 'Bỏ khoản', danger: true,
    });
    if (!ok) return;
    const error = await endTemplateItem(template.id, item.component_id, effectiveMonth);
    if (error) return toast(error, 'error');
    onChanged();
  };

  const seedDefaults = async () => {
    if (!template) return;
    setBusy(true);
    const { count, error } = await seedTemplateDefaults(template.id, effectiveMonth);
    setBusy(false);
    if (error) return toast(error, 'error');
    toast(`Đã nạp ${count} khoản gợi ý theo BR-PAY — kiểm tra lại từng công thức trước khi áp dụng.`, 'success');
    onChanged();
  };

  const saveAssignment = async () => {
    if (!assigning?.unit) return toast('Chọn khối / đơn vị trên cây.', 'warning');
    setBusy(true);
    const error = await assignTemplate(assigning.unit.id, assigning.templateId, assigning.month);
    setBusy(false);
    if (error) return toast('Gán thất bại: ' + error, 'error');
    toast(assigning.templateId ? `Đã gán mẫu cho ${assigning.unit.name}.` : `${assigning.unit.name} thôi dùng mẫu.`, 'success');
    setAssigning(null);
    onChanged();
  };

  // ------------------------------------------------------------------------
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-3xl text-sm leading-relaxed text-slate-500">
          Mỗi khối dùng một mẫu bảng lương: <strong>BL 01</strong> cho Văn phòng / Kho / Vận chuyển, <strong>BL 02</strong> cho
          Kinh doanh (BR-PAY-002, BR-PAY-004). Công thức chỉ gọi mã tham số và biểu bậc thang của
          <strong> Tham số lương</strong> — không gõ con số chính sách vào đây.
        </p>
        <div className="flex flex-wrap items-end gap-2 no-print">
          <Input label="Thay đổi hiệu lực từ tháng" type="month" value={effectiveMonth.slice(0, 7)} min={minMonth.slice(0, 7)}
            onChange={(event) => event.target.value && setEffectiveMonth(`${event.target.value}-01`)} />
          {canManage && (
            <Button variant="outline" onClick={() => setTemplateDraft({ code: '', name: '', description: '' })}>
              <Plus className="h-4 w-4" /> Tạo mẫu
            </Button>
          )}
        </div>
      </div>

      {!params && (
        <p className="flex items-start gap-2 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <TriangleAlert className="mt-0.5 h-4 w-4" /> Chưa có bộ tham số lương hiệu lực — công thức chưa kiểm tra được với tham số.
        </p>
      )}

      <div className="grid gap-5 lg:grid-cols-[18rem_1fr]">
        {/* --- Danh sách mẫu --- */}
        <div className="space-y-2">
          {data.templates.length === 0 && (
            <Card><CardContent className="py-6 text-center text-sm text-slate-500">Chưa có mẫu bảng lương.</CardContent></Card>
          )}
          {data.templates.map((item) => {
            const count = itemsAt(item.id, effectiveMonth).length;
            const people = peopleOn(item.id).length;
            return (
              <button key={item.id} type="button" onClick={() => setSelectedId(item.id)}
                className={`w-full rounded-xl border px-4 py-3 text-left transition ${
                  item.id === selectedId ? 'border-indigo-500 bg-indigo-50 ring-2 ring-indigo-500/20' : 'border-slate-200 bg-white hover:border-indigo-300'
                } ${item.is_active ? '' : 'opacity-60'}`}>
                <span className="font-mono text-[11px] font-bold text-indigo-700">{item.code}</span>
                <span className="mt-0.5 block text-sm font-bold text-slate-800">{item.name}</span>
                <span className="mt-1 block text-xs text-slate-500">{count} khoản · {people} nhân sự đang theo{item.is_active ? '' : ' · ngừng dùng'}</span>
              </button>
            );
          })}
        </div>

        {/* --- Chi tiết mẫu --- */}
        {template ? (
          <div className="space-y-5">
            <Card>
              <CardHeader className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <CardTitle>{template.name}</CardTitle>
                  {template.description && <p className="mt-1 text-xs leading-relaxed text-slate-500">{template.description}</p>}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => onDryRun(template.id)}><FlaskConical className="h-3.5 w-3.5" /> Chạy thử mẫu</Button>
                  {canManage && (
                    <>
                      <Button size="sm" variant="ghost" onClick={() => setTemplateDraft({ id: template.id, code: template.code, name: template.name, description: template.description ?? '' })}>
                        <Pencil className="h-3.5 w-3.5" /> Sửa
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => void toggleActive(template)}>
                        <Power className="h-3.5 w-3.5" /> {template.is_active ? 'Ngừng dùng' : 'Dùng lại'}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => void removeTemplate(template)}><Trash2 className="h-3.5 w-3.5" /></Button>
                    </>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Áp dụng cho khối / đơn vị (từ {monthText(effectiveMonth)})</p>
                  {canManage && (
                    <Button size="sm" variant="outline" onClick={() => setAssigning({ unit: null, templateId: template.id, month: effectiveMonth })}>
                      <GitBranch className="h-3.5 w-3.5" /> Gán cho khối…
                    </Button>
                  )}
                </div>
                {directUnits(template.id).length === 0 ? (
                  <p className="text-sm text-slate-500">Chưa gán cho đơn vị nào — chưa ai theo mẫu này.</p>
                ) : (
                  <ul className="flex flex-wrap gap-2">
                    {directUnits(template.id).map((unit) => (
                      <li key={unit.id} className="inline-flex items-center gap-2 rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs font-semibold text-slate-700">
                        {unit.name}
                        {canManage && (
                          <button type="button" className="text-slate-400 hover:text-red-600" aria-label={`Bỏ mẫu khỏi ${unit.name}`}
                            onClick={() => setAssigning({ unit, templateId: null, month: effectiveMonth })}>×</button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                <p className="text-[11px] leading-relaxed text-slate-400">
                  Đơn vị con thừa hưởng mẫu của đơn vị gần nhất phía trên. {peopleOn(template.id).length} nhân sự đang theo mẫu này.
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-wrap items-center justify-between gap-3">
                <CardTitle>Khoản và công thức (hiệu lực {monthText(effectiveMonth)})</CardTitle>
                {canManage && (
                  <div className="flex flex-wrap gap-2">
                    {itemsAt(template.id, effectiveMonth).length === 0 && !data.templateItems.some((i) => i.template_id === template.id) && (
                      <Button size="sm" variant="outline" onClick={() => void seedDefaults()} disabled={busy}>
                        <PackagePlus className="h-3.5 w-3.5" /> Nạp gợi ý theo BR-PAY
                      </Button>
                    )}
                    <Button size="sm" onClick={() => openItem(null)}><Plus className="h-3.5 w-3.5" /> Thêm khoản</Button>
                  </div>
                )}
              </CardHeader>
              <CardContent className="p-0">
                {itemsAt(template.id, effectiveMonth).length === 0 ? (
                  <p className="px-5 py-8 text-center text-sm text-slate-500">Mẫu chưa có khoản nào ở tháng này.</p>
                ) : (
                  <ul className="divide-y divide-slate-50">
                    {itemsAt(template.id, effectiveMonth).map((item) => {
                      const component = componentById.get(item.component_id);
                      const formula = item.formula ?? component?.formula ?? null;
                      const issue = formula && params
                        ? explainFormulaError(formula, formulaScope, { functions: params.tierFunctions })
                        : null;
                      return (
                        <li key={item.id} className="flex flex-wrap items-start gap-3 px-5 py-3">
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-semibold text-slate-800">
                              {component?.kind === 'DEDUCTION' ? '− ' : '+ '}{component?.name ?? 'Khoản đã xoá'}
                              {component?.is_base && <span className="ml-2 rounded bg-indigo-600 px-1.5 py-0.5 text-[10px] font-bold text-white">Bậc lương</span>}
                            </p>
                            <p className="mt-0.5 break-words font-mono text-[11px] text-indigo-700">
                              {item.formula ?? (component?.formula ? `${component.formula} (mặc định danh mục)` : item.amount != null ? `${formatVND(Number(item.amount))} cố định` : 'Mức khai riêng từng người')}
                            </p>
                            {issue && <p className="mt-0.5 text-[11px] text-red-600">⚠ {issue.message}</p>}
                            <p className="mt-0.5 text-[11px] text-slate-400">
                              Từ {monthText(item.effective_from)}{item.effective_to ? ` tới ${item.effective_to}` : ''}
                              {item.amount != null && item.formula ? ` · mức ${formatVND(Number(item.amount))}` : ''}
                              {item.note ? ` · ${item.note}` : ''}
                            </p>
                          </div>
                          {canManage && (
                            <div className="flex gap-1">
                              <Button size="sm" variant="ghost" onClick={() => openItem(item)}><Pencil className="h-3.5 w-3.5" /></Button>
                              <Button size="sm" variant="ghost" onClick={() => void endItem(item)}><Trash2 className="h-3.5 w-3.5" /></Button>
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>
        ) : (
          <Card><CardContent className="py-10 text-center text-sm text-slate-500">Chọn hoặc tạo một mẫu bảng lương.</CardContent></Card>
        )}
      </div>

      {/* --- Tạo / sửa mẫu --- */}
      <Modal open={!!templateDraft} onClose={() => setTemplateDraft(null)} title={templateDraft?.id ? 'Sửa mẫu bảng lương' : 'Tạo mẫu bảng lương'} size="md">
        {templateDraft && (
          <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void saveTemplateInfo(); }}>
            <Input label="Mã mẫu" required value={templateDraft.code} className="font-mono"
              onChange={(event) => setTemplateDraft({ ...templateDraft, code: event.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '') })} placeholder="VD: BL03" />
            <Input label="Tên mẫu" required value={templateDraft.name} onChange={(event) => setTemplateDraft({ ...templateDraft, name: event.target.value })} />
            <Textarea label="Mô tả / căn cứ quy chế" rows={3} value={templateDraft.description}
              onChange={(event) => setTemplateDraft({ ...templateDraft, description: event.target.value })} />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setTemplateDraft(null)}>Huỷ</Button>
              <Button type="submit" disabled={busy}>Lưu mẫu</Button>
            </div>
          </form>
        )}
      </Modal>

      {/* --- Khai khoản của mẫu --- */}
      <Modal open={!!itemDraft} onClose={() => setItemDraft(null)} title={`Khoản trong ${template?.code ?? ''} — hiệu lực từ ${monthText(effectiveMonth)}`} size="xl">
        {itemDraft && (
          <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void saveItem(); }}>
            <Select label="Khoản lương" required value={itemDraft.componentId} disabled={!itemDraft.isNew}
              onChange={(event) => setItemDraft({ ...itemDraft, componentId: event.target.value })}>
              <option value="">Chọn khoản…</option>
              {assignable.map((component) => (
                <option key={component.id} value={component.id}>
                  {component.kind === 'DEDUCTION' ? '− ' : component.kind === 'EMPLOYER_COST' ? '◦ ' : '+ '}{component.name} ({component.code})
                </option>
              ))}
            </Select>
            {componentById.get(itemDraft.componentId)?.is_base && (
              <p className="rounded-lg bg-indigo-50 px-3 py-2 text-xs leading-relaxed text-indigo-900">
                Khoản Bậc lương là MỨC để tính lương thời gian / phép / lễ (BR-PAY-002) — engine tự tính ba dòng đó, không cần công thức.
                Mức thường khai riêng từng người ở Cơ chế lương.
              </p>
            )}
            <div className="grid gap-3 sm:grid-cols-3">
              <Input label="Mức mặc định của khối (VND)" inputMode="decimal" value={itemDraft.amount}
                onChange={(event) => setItemDraft({ ...itemDraft, amount: event.target.value.replace(/[^\d.]/g, '') })}
                placeholder="Trống = khai từng người" />
              <Select label="Chịu thuế TNCN" value={itemDraft.taxable} onChange={(event) => setItemDraft({ ...itemDraft, taxable: event.target.value as '' | 'true' | 'false' })}>
                <option value="">Theo danh mục</option><option value="true">Có</option><option value="false">Không</option>
              </Select>
              <Select label="Tính BHXH" value={itemDraft.insurable} onChange={(event) => setItemDraft({ ...itemDraft, insurable: event.target.value as '' | 'true' | 'false' })}>
                <option value="">Theo danh mục</option><option value="true">Có</option><option value="false">Không</option>
              </Select>
            </div>
            <PayrollFormulaBuilder
              label="Công thức của khối (không bắt buộc)"
              value={itemDraft.formula}
              onChange={(formula) => setItemDraft({ ...itemDraft, formula })}
              sampleScope={formulaScope}
              components={data.components}
              defaultFormula={componentById.get(itemDraft.componentId)?.formula}
              namedParams={activeVersion?.namedParams}
              tierTables={activeVersion?.tierTables}
              functions={params?.tierFunctions}
            />
            <Input label="Ghi chú" value={itemDraft.note} onChange={(event) => setItemDraft({ ...itemDraft, note: event.target.value })} />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setItemDraft(null)}>Huỷ</Button>
              <Button type="submit" disabled={busy || !!formulaIssue}>{busy ? 'Đang lưu…' : 'Lưu khoản'}</Button>
            </div>
          </form>
        )}
      </Modal>

      {/* --- Gán mẫu cho khối trên cây --- */}
      <Modal open={!!assigning} onClose={() => setAssigning(null)} title={assigning?.templateId ? `Gán ${template?.code ?? ''} cho khối / đơn vị` : 'Bỏ áp mẫu'} size="lg">
        {assigning && (
          <div className="space-y-4">
            {assigning.templateId ? (
              <div className="max-h-80 overflow-y-auto rounded-xl border border-slate-200">
                <UnitTreeList rows={unitRows} selectedId={assigning.unit?.id ?? null}
                  onSelect={(unit) => setAssigning({ ...assigning, unit })}
                  badge={(unit) => {
                    const current = resolveTemplateForUnit(unit.id, { templates: data.templates, unitTemplates: data.unitTemplates, unitById }, assigning.month);
                    return current.template ? <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-500">{current.template.code}</span> : null;
                  }} />
              </div>
            ) : (
              <p className="text-sm text-slate-600">
                <strong>{assigning.unit?.name}</strong> sẽ thôi dùng mẫu từ tháng chọn, và CHẶN thừa hưởng mẫu của cấp trên —
                người trong đơn vị chỉ còn khoản khai riêng / khoản chung của phòng.
              </p>
            )}
            <Input label="Hiệu lực từ tháng" required type="month" value={assigning.month.slice(0, 7)} min={minMonth.slice(0, 7)}
              onChange={(event) => event.target.value && setAssigning({ ...assigning, month: `${event.target.value}-01` })} />
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setAssigning(null)}>Huỷ</Button>
              <Button onClick={() => void saveAssignment()} disabled={busy || !assigning.unit}>
                {assigning.templateId ? 'Gán mẫu' : 'Bỏ áp mẫu'}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
