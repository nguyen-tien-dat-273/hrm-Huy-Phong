// ============================================================================
// Danh mục khoản lương — danh sách ĐẦU MỤC dùng trong cơ chế lương.
// ----------------------------------------------------------------------------
// Danh mục chỉ khai đầu mục LÀ GÌ: tên, mã, nhóm hiển thị, loại dòng (cộng vào
// lương / trừ khỏi lương / chỉ để tính), tính chất và giá trị mặc định nếu có.
// Cách tính của từng đầu mục đặt ở Cơ chế lương — mỗi cơ chế một công thức.
//
// Xoá: đầu mục đã phát sinh trong kỳ lương đã chốt thì database tự chuyển
// "Khóa" thay vì xoá, và ghi vết.
// ============================================================================

import { useEffect, useMemo, useState } from 'react';
import { Eye, PackagePlus, Pencil, Plus, Search, Trash2, TriangleAlert } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input, Textarea } from '@/components/ui/Input';
import { Dropdown } from '@/components/ui/Dropdown';
import { MoneyInput } from '@/components/payroll/MoneyInput';
import { ExportButtons } from '@/components/payroll/ExportButtons';
import { useToast } from '@/contexts/ToastContext';
import { useConfirm } from '@/contexts/ConfirmContext';
import {
  fetchStandardCatalog, removeComponent, saveComponent, seedStandardCatalog, type PayrollWorkspace, type StandardCatalogItem,
} from '@/lib/payrollData';
import { KIND_LABEL, KIND_SIGN } from '@/lib/formulaEntries';
import { formatFormulaNumber } from '@/lib/formulaTokens';
import { codeFromName } from '@/lib/payrollSettings';
import { PAY_REPORT_TAGS, reportTagKindProblem, reportTagLabel } from '@/lib/payrollReportTags';
import type {
  PayComponent, PayComponentCategoryCode, PayComponentKind, PayComponentNature, PayReportTag,
} from '@/types';

const NATURE_LABEL: Record<PayComponentNature, string> = {
  FIXED: 'Cố định',
  VARIABLE: 'Biến đổi',
  BOTH: 'Biến đổi / Cố định',
};

/** Ba loại dòng chọn được; EMPLOYER_COST chỉ còn trên dữ liệu cũ. */
const KINDS: Array<Exclude<PayComponentKind, 'EMPLOYER_COST'>> = ['EARNING', 'DEDUCTION', 'INFO'];

const KIND_TONE: Record<PayComponentKind, string> = {
  EARNING: 'bg-emerald-50 text-emerald-700',
  DEDUCTION: 'bg-red-50 text-red-600',
  INFO: 'bg-slate-100 text-slate-500',
  EMPLOYER_COST: 'bg-slate-100 text-slate-500',
};

/** Bỏ dấu để gõ "phu cap" tìm ra "Phụ cấp". */
const stripTone = (text: string) => text
  .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd')
  .toLowerCase().trim();

interface Draft {
  id?: string;
  code: string;
  /** Người dùng đã tự gõ mã — thôi gợi ý theo tên. */
  codeTouched: boolean;
  name: string;
  category_code: PayComponentCategoryCode | '';
  kind: PayComponentKind;
  nature: PayComponentNature;
  /** Nhãn báo cáo — rỗng là không gắn. Chỉ để báo cáo, không vào công thức. */
  report_tag: PayReportTag | '';
  default_amount: string;
  is_active: boolean;
  note: string;
}

type DraftErrors = Partial<Record<keyof Draft, string>>;

interface ComponentCatalogProps {
  data: PayrollWorkspace;
  canManage: boolean;
  onChanged: () => void;
}

export function ComponentCatalog({ data, canManage, onChanged }: ComponentCatalogProps) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const { components, categories } = data;

  const [query, setQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<'ALL' | PayComponentCategoryCode>('ALL');

  const [draft, setDraft] = useState<Draft | null>(null);
  const [errors, setErrors] = useState<DraftErrors>({});
  const [saving, setSaving] = useState(false);
  const [detail, setDetail] = useState<PayComponent | null>(null);
  const [standard, setStandard] = useState<StandardCatalogItem[]>([]);
  const [seeding, setSeeding] = useState(false);

  useEffect(() => { void fetchStandardCatalog().then(setStandard); }, []);

  const categoryByCode = useMemo(
    () => new Map(categories.map((category) => [category.code, category])),
    [categories],
  );
  const missingStandard = useMemo(
    () => standard.filter((item) => !components.some((component) => component.code === item.code)),
    [standard, components],
  );

  const categoryOrder = useMemo(
    () => new Map(categories.map((category, index) => [category.code, index])),
    [categories],
  );

  /** Khớp ô tìm kiếm — dùng cả để đếm số đầu mục trên từng nhóm. */
  const searched = useMemo(() => {
    const keyword = stripTone(query);
    return components.filter((component) => !keyword || stripTone(component.name).includes(keyword));
  }, [components, query]);

  const filtered = useMemo(() => {
    const rows = searched.filter((component) => categoryFilter === 'ALL' || component.category_code === categoryFilter);
    return [...rows].sort((a, b) => (
      (categoryOrder.get(a.category_code) ?? 99) - (categoryOrder.get(b.category_code) ?? 99) || a.sort_order - b.sort_order
    ));
  }, [searched, categoryFilter, categoryOrder]);

  const usageOf = (component: PayComponent) => {
    const templateIds = new Set(data.templateItems
      .filter((item) => item.component_id === component.id && !item.effective_to).map((item) => item.template_id));
    return {
      mechanisms: data.templates.filter((template) => templateIds.has(template.id)).map((template) => template.name),
      people: new Set(data.items.filter((item) => item.component_id === component.id && !item.effective_to).map((item) => item.user_id)).size,
      units: new Set(data.unitItems.filter((item) => item.component_id === component.id && !item.effective_to).map((item) => item.unit_id)).size,
    };
  };

  // ------------------------------------------------------------------------
  // Biểu mẫu thêm / sửa
  // ------------------------------------------------------------------------
  const openCreate = (categoryCode?: PayComponentCategoryCode) => {
    const category = categoryCode ? categoryByCode.get(categoryCode) : undefined;
    setErrors({});
    setDraft({
      code: '', codeTouched: false, name: '', category_code: categoryCode ?? '',
      kind: categoryCode === 'KHAU_TRU_PHAT' ? 'DEDUCTION' : categoryCode === 'SO_LIEU' ? 'INFO' : 'EARNING',
      nature: category?.default_nature ?? 'VARIABLE',
      report_tag: '',
      default_amount: '', is_active: true, note: '',
    });
  };

  const openEdit = (component: PayComponent) => {
    setErrors({});
    setDraft({
      id: component.id,
      code: component.code,
      codeTouched: true,
      name: component.name,
      category_code: component.category_code,
      kind: component.kind,
      nature: component.nature,
      report_tag: component.report_tag ?? '',
      default_amount: Number(component.default_amount) ? String(Number(component.default_amount)) : '',
      is_active: component.is_active,
      note: component.note ?? '',
    });
  };

  const updateDraft = (patch: Partial<Draft>) => {
    setDraft((current) => {
      if (!current) return current;
      const next = { ...current, ...patch };
      // Mã gợi ý theo tên cho tới khi người dùng tự gõ mã.
      if (patch.name !== undefined && !current.codeTouched && !current.id) {
        next.code = patch.name.trim() ? codeFromName(patch.name, components.map((item) => item.code), 'DAU_MUC') : '';
      }
      if (patch.category_code && patch.category_code !== current.category_code && !current.id) {
        const category = categoryByCode.get(patch.category_code);
        if (category) next.nature = category.default_nature;
      }
      return next;
    });
    setErrors((current) => {
      const next = { ...current };
      for (const key of Object.keys(patch) as Array<keyof Draft>) delete next[key];
      return next;
    });
  };

  const validate = (value: Draft): DraftErrors => {
    const found: DraftErrors = {};
    const code = value.code.trim().toUpperCase();
    if (!code) found.code = 'Nhập mã đầu mục.';
    else if (!/^[A-Z][A-Z0-9_]*$/.test(code)) found.code = 'Mã viết hoa không dấu, bắt đầu bằng chữ, chỉ gồm chữ, số và "_".';
    else if (components.some((item) => item.code === code && item.id !== value.id)) found.code = 'Mã khoản lương đã tồn tại trên hệ thống.';
    if (!value.name.trim()) found.name = 'Nhập tên đầu mục.';
    else if (components.some((item) => item.name.trim().toLowerCase() === value.name.trim().toLowerCase() && item.id !== value.id)) {
      found.name = 'Tên khoản lương đã tồn tại trên hệ thống.';
    }
    if (!value.category_code) found.category_code = 'Chọn nhóm hiển thị.';
    const tagProblem = reportTagKindProblem(value.report_tag || null, value.kind);
    if (tagProblem) found.report_tag = tagProblem;
    const amount = value.default_amount.trim() === '' ? 0 : Number(value.default_amount);
    if (!Number.isFinite(amount) || amount < 0) found.default_amount = 'Giá trị mặc định phải là số không âm.';
    return found;
  };

  const handleSave = async () => {
    if (!draft) return;
    const found = validate(draft);
    setErrors(found);
    if (Object.keys(found).length > 0) {
      toast('Thông tin chưa hợp lệ — sửa các ô đánh dấu đỏ.', 'warning');
      return;
    }
    setSaving(true);
    const error = await saveComponent({
      ...(draft.id ? { id: draft.id } : {
        calc_type: 'FIXED', formula: null, input_code: null, base_code: null, prorate: false,
        is_base: false, sort_order: components.reduce((max, item) => Math.max(max, item.sort_order), 400) + 10,
        calc_source: 'ASSIGNED', taxable: true, insurable: false,
      }),
      code: draft.code.trim().toUpperCase(),
      name: draft.name.trim(),
      category_code: draft.category_code as PayComponentCategoryCode,
      kind: draft.kind,
      nature: draft.nature,
      report_tag: draft.report_tag || null,
      default_amount: draft.default_amount.trim() === '' ? 0 : Number(draft.default_amount),
      is_active: draft.is_active,
      note: draft.note.trim() || null,
    });
    setSaving(false);
    if (error) {
      if (/Mã khoản lương đã tồn tại/.test(error)) setErrors({ code: error });
      else if (/Tên khoản lương/.test(error)) setErrors({ name: error });
      toast('Không lưu được đầu mục: ' + error, 'error');
      return;
    }
    toast(`Đã lưu “${draft.name.trim()}”.`, 'success');
    setDraft(null);
    onChanged();
  };

  const handleDelete = async (component: PayComponent) => {
    const usage = usageOf(component);
    const used = usage.mechanisms.length + usage.people + usage.units;
    const ok = await confirm({
      title: `Xoá “${component.name}”?`,
      message:
        (used > 0
          ? `Đầu mục đang có trong ${usage.mechanisms.length} cơ chế${usage.mechanisms.length ? ` (${usage.mechanisms.join(', ')})` : ''}, `
            + `${usage.people} nhân sự và ${usage.units} đơn vị khai riêng — các dòng đó mất theo ở kỳ chưa chốt. `
          : '')
        + 'Nếu đầu mục đã phát sinh trong kỳ lương đã chốt, hệ thống KHÔNG xoá mà tự chuyển sang “Khóa” để giữ số liệu cũ.',
      confirmLabel: 'Xoá đầu mục',
      danger: true,
    });
    if (!ok) return;

    const { result, error } = await removeComponent(component.id);
    if (error) {
      toast('Xoá thất bại: ' + error, 'error');
      return;
    }
    toast(result === 'DEACTIVATED'
      ? `“${component.name}” đã phát sinh trong kỳ lương đã chốt — không xoá, đã chuyển Khóa.`
      : `Đã xoá “${component.name}”.`, result === 'DEACTIVATED' ? 'warning' : 'success');
    setDetail(null);
    onChanged();
  };

  const handleSeed = async () => {
    const ok = await confirm({
      title: components.length === 0 ? 'Khởi tạo danh mục chuẩn?' : `Bổ sung ${missingStandard.length} đầu mục chuẩn còn thiếu?`,
      message: 'Thêm các đầu mục chuẩn của công ty. Đầu mục đã có giữ nguyên, không ghi đè tên hay thiết lập đã chỉnh.',
      confirmLabel: components.length === 0 ? 'Khởi tạo' : 'Bổ sung',
    });
    if (!ok) return;
    setSeeding(true);
    const { inserted, error } = await seedStandardCatalog();
    setSeeding(false);
    if (error) {
      toast('Khởi tạo thất bại: ' + error, 'error');
      return;
    }
    toast(`Đã thêm ${inserted} đầu mục chuẩn vào danh mục.`, 'success');
    onChanged();
  };

  const exportOptions = () => ({
    filename: 'danh-muc-khoan-luong',
    sheetName: 'Danh mục khoản lương',
    title: 'DANH MỤC KHOẢN LƯƠNG & ĐÃI NGỘ',
    subtitle: `${filtered.length} đầu mục · xuất lúc ${new Date().toLocaleString('vi-VN')}`,
    columns: [
      { header: 'Mã', value: (c: PayComponent) => c.code, width: 22 },
      { header: 'Tên đầu mục', value: (c: PayComponent) => c.name, width: 36 },
      { header: 'Nhóm', value: (c: PayComponent) => categoryByCode.get(c.category_code)?.name ?? c.category_code, width: 24 },
      { header: 'Loại dòng', value: (c: PayComponent) => KIND_LABEL[c.kind], width: 18 },
      { header: 'Tính chất', value: (c: PayComponent) => NATURE_LABEL[c.nature], width: 22 },
      { header: 'Nhãn báo cáo', value: (c: PayComponent) => reportTagLabel(c.report_tag) ?? '', width: 30 },
      { header: 'Giá trị mặc định', value: (c: PayComponent) => Number(c.default_amount) || '', width: 16 },
      { header: 'Trạng thái', value: (c: PayComponent) => (c.is_active ? 'Kích hoạt' : 'Khóa'), width: 14 },
      { header: 'Mô tả', value: (c: PayComponent) => c.note ?? '', width: 50 },
    ],
    rows: filtered,
  });

  // ------------------------------------------------------------------------
  if (components.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={<PackagePlus className="h-8 w-8" />}
          title="Chưa có danh mục khoản lương"
          description="Chưa có đầu mục nào. Bấm “Khởi tạo danh mục chuẩn” hoặc “Thêm mới”."
          action={canManage ? (
            <div className="flex flex-wrap justify-center gap-2">
              <Button onClick={() => void handleSeed()} disabled={seeding}>
                <PackagePlus className="h-4 w-4" /> {seeding ? 'Đang khởi tạo…' : 'Khởi tạo danh mục chuẩn'}
              </Button>
              <Button variant="outline" onClick={() => openCreate()}><Plus className="h-4 w-4" /> Thêm mới</Button>
            </div>
          ) : undefined}
        />
        {renderForm()}
      </Card>
    );
  }

  function renderRow(component: PayComponent) {
    const category = categoryByCode.get(component.category_code);
    return (
      <tr key={component.id} className={`transition-colors hover:bg-slate-50/70 ${component.is_active ? '' : 'opacity-60'}`}>
        <td className="px-4 py-3">
          <button type="button" onClick={() => setDetail(component)} className="text-left text-sm font-semibold text-slate-800 hover:text-indigo-700">
            {component.name}
          </button>
          {categoryFilter === 'ALL' && category && (
            <p className="mt-0.5 text-[11px] text-slate-400">{category.name}</p>
          )}
        </td>
        <td className="px-3 py-3">
          <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-bold ${KIND_TONE[component.kind]}`}>
            {KIND_SIGN[component.kind]} {KIND_LABEL[component.kind]}
          </span>
        </td>
        <td className="px-3 py-3 text-xs text-slate-600">{NATURE_LABEL[component.nature]}</td>
        <td className="px-3 py-3 text-right text-xs tabular-nums text-slate-700">
          {Number(component.default_amount) ? formatFormulaNumber(Number(component.default_amount)) : '—'}
        </td>
        <td className="px-3 py-3">
          <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${component.is_active ? 'text-emerald-700' : 'text-slate-400'}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${component.is_active ? 'bg-emerald-500' : 'bg-slate-300'}`} />
            {component.is_active ? 'Kích hoạt' : 'Khóa'}
          </span>
        </td>
        <td className="px-3 py-1.5 no-print">
          <div className="flex justify-end gap-0.5">
            {!canManage && (
              <IconButton label={`Xem ${component.name}`} onClick={() => setDetail(component)}><Eye className="h-3.5 w-3.5" /></IconButton>
            )}
            {canManage && (
              <IconButton label={`Sửa ${component.name}`} onClick={() => openEdit(component)}><Pencil className="h-3.5 w-3.5" /></IconButton>
            )}
            {canManage && (
              <IconButton label={`Xoá ${component.name}`} danger onClick={() => void handleDelete(component)}><Trash2 className="h-3.5 w-3.5" /></IconButton>
            )}
          </div>
        </td>
      </tr>
    );
  }

  function renderTable(rows: PayComponent[]) {
    return (
      <div className="overflow-x-auto">
        <table className="w-full min-w-[680px]">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50/70 text-left text-[11px] font-bold uppercase tracking-wider text-slate-400">
              <th className="px-4 py-2.5">Tên đầu mục</th>
              <th className="px-3 py-2.5">Loại dòng</th>
              <th className="px-3 py-2.5">Tính chất</th>
              <th className="px-3 py-2.5 text-right">Mặc định</th>
              <th className="px-3 py-2.5">Trạng thái</th>
              <th className="px-3 py-2.5 no-print" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">{rows.map(renderRow)}</tbody>
        </table>
      </div>
    );
  }

  function renderForm() {
    return (
      <Modal open={!!draft} onClose={() => setDraft(null)} title={draft?.id ? 'Sửa đầu mục' : 'Thêm đầu mục'} size="lg">
        {draft && (
          <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void handleSave(); }} noValidate>
            <Input
              label="Tên đầu mục"
              required
              value={draft.name}
              onChange={(event) => updateDraft({ name: event.target.value })}
              error={errors.name ?? errors.code}
              placeholder="VD: Phụ cấp xăng xe"
              autoFocus
            />

            <div>
              <span className="mb-1.5 block text-sm font-semibold text-slate-700">Loại dòng<span className="ml-1 text-red-500" aria-hidden="true">*</span></span>
              <div className="grid grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1" role="radiogroup" aria-label="Loại dòng">
                {KINDS.map((kind) => (
                  <button
                    key={kind}
                    type="button"
                    role="radio"
                    aria-checked={draft.kind === kind}
                    onClick={() => updateDraft({ kind })}
                    className={`rounded-lg px-3 py-2 text-sm font-bold transition ${draft.kind === kind ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
                  >
                    {KIND_SIGN[kind]} {KIND_LABEL[kind]}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Dropdown
                  label="Nhóm hiển thị"
                  required
                  placeholder="Chọn nhóm…"
                  value={draft.category_code}
                  options={categories.map((item) => ({ value: item.code, label: item.name }))}
                  onChange={(value) => updateDraft({ category_code: value as PayComponentCategoryCode })}
                  error={errors.category_code}
                />
              </div>
              <Dropdown
                label="Tính chất"
                required
                value={draft.nature}
                options={Object.entries(NATURE_LABEL).map(([value, label]) => ({ value, label }))}
                onChange={(value) => updateDraft({ nature: value as PayComponentNature })}
              />
            </div>

            <Dropdown
              label="Nhãn báo cáo"
              value={draft.report_tag}
              options={[
                { value: '', label: 'Không gắn nhãn' },
                ...PAY_REPORT_TAGS.map((tag) => ({ value: tag.code, label: tag.label })),
              ]}
              onChange={(value) => updateDraft({ report_tag: value as PayReportTag | '' })}
              error={errors.report_tag}
            />

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <span className="mb-1.5 block text-sm font-semibold text-slate-700">Giá trị mặc định</span>
                <MoneyInput
                  large
                  money
                  value={draft.default_amount.trim() === '' ? Number.NaN : Number(draft.default_amount)}
                  aria-label="Giá trị mặc định"
                  placeholder="Để trống nếu không có"
                  invalid={!!errors.default_amount}
                  onChange={(value) => updateDraft({ default_amount: Number.isFinite(value) ? String(value) : '' })}
                />
                {errors.default_amount && <p className="mt-1.5 text-xs font-medium text-red-600">{errors.default_amount}</p>}
              </div>
              <div>
                <span className="mb-1.5 block text-sm font-semibold text-slate-700">Trạng thái hoạt động</span>
                <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1" role="radiogroup" aria-label="Trạng thái hoạt động">
                  {([[true, 'Kích hoạt', 'bg-emerald-600 text-white'], [false, 'Khóa', 'bg-slate-600 text-white']] as const).map(([value, label, on]) => (
                    <button
                      key={label}
                      type="button"
                      role="radio"
                      aria-checked={draft.is_active === value}
                      onClick={() => updateDraft({ is_active: value })}
                      className={`rounded-lg px-3 py-2 text-sm font-bold transition ${draft.is_active === value ? on : 'text-slate-500 hover:text-slate-800'}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <Textarea label="Mô tả" rows={2} value={draft.note}
              onChange={(event) => updateDraft({ note: event.target.value })} placeholder="VD: Hỗ trợ đi lại cho nhân viên thị trường." />

            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="secondary" onClick={() => setDraft(null)} disabled={saving}>Huỷ</Button>
              <Button type="submit" disabled={saving}>{saving ? 'Đang lưu…' : 'Lưu đầu mục'}</Button>
            </div>
          </form>
        )}
      </Modal>
    );
  }

  const tabs: Array<{ code: 'ALL' | PayComponentCategoryCode; label: string; count: number }> = [
    { code: 'ALL', label: 'Tất cả', count: searched.length },
    ...categories.map((category) => ({
      code: category.code as PayComponentCategoryCode,
      label: category.name,
      count: searched.filter((component) => component.category_code === category.code).length,
    })),
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] max-w-md flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Tìm đầu mục theo tên…"
            aria-label="Tìm đầu mục theo tên"
            className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/15"
          />
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2 no-print">
          <ExportButtons options={exportOptions} disabled={filtered.length === 0} />
          {canManage && missingStandard.length > 0 && (
            <Button size="sm" variant="outline" onClick={() => void handleSeed()} disabled={seeding}>
              <PackagePlus className="h-3.5 w-3.5" />
              {seeding ? 'Đang bổ sung…' : `Bổ sung ${missingStandard.length} đầu mục chuẩn`}
            </Button>
          )}
          {canManage && (
            <Button size="sm" onClick={() => openCreate(categoryFilter === 'ALL' ? undefined : categoryFilter)}>
              <Plus className="h-3.5 w-3.5" /> Thêm đầu mục
            </Button>
          )}
        </div>
      </div>

      <div className="flex gap-1 overflow-x-auto border-b border-slate-200 no-print" role="tablist" aria-label="Lọc theo nhóm">
        {tabs.map((tab) => {
          const active = categoryFilter === tab.code;
          return (
            <button
              key={tab.code}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setCategoryFilter(tab.code)}
              className={`-mb-px inline-flex shrink-0 items-center gap-2 border-b-2 px-4 py-3 text-sm font-semibold transition ${
                active ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800'
              }`}
            >
              {tab.label}
              <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums ${active ? 'bg-indigo-50 text-indigo-700' : 'bg-slate-100 text-slate-500'}`}>
                {tab.count}
              </span>
            </button>
          );
        })}
      </div>

      {filtered.length === 0 ? (
        <Card><CardContent className="py-10 text-center text-sm text-slate-500">Không có đầu mục nào khớp.</CardContent></Card>
      ) : (
        <Card>
          <CardContent className="p-0">{renderTable(filtered)}</CardContent>
        </Card>
      )}

      {renderForm()}

      {/* --- Chi tiết đầu mục --- */}
      <Modal open={!!detail} onClose={() => setDetail(null)} title={detail?.name ?? ''} size="lg">
        {detail && (() => {
          const usage = usageOf(detail);
          const category = categoryByCode.get(detail.category_code);
          return (
            <div className="space-y-4">
              <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
                <Field label="Nhóm" value={category?.name ?? detail.category_code} />
                <Field label="Loại dòng" value={`${KIND_SIGN[detail.kind]} ${KIND_LABEL[detail.kind]}`} />
                <Field label="Tính chất" value={NATURE_LABEL[detail.nature]} />
                <Field label="Nhãn báo cáo" value={reportTagLabel(detail.report_tag) ?? 'Không gắn'} />
                <Field label="Trạng thái" value={detail.is_active ? 'Kích hoạt' : 'Khóa'} />
                <Field label="Giá trị mặc định" value={Number(detail.default_amount) ? formatFormulaNumber(Number(detail.default_amount)) : '—'} />
                <Field label="Có trong cơ chế" value={usage.mechanisms.length ? usage.mechanisms.join(', ') : 'Chưa có'} />
                <Field label="Khai riêng" value={`${usage.people} nhân sự · ${usage.units} đơn vị`} />
              </dl>
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Mô tả</p>
                <p className="mt-1 whitespace-pre-line text-sm text-slate-700">{detail.note || 'Chưa có mô tả.'}</p>
              </div>
              {usage.mechanisms.length + usage.people + usage.units === 0 && detail.is_active && (
                <p className="flex items-start gap-2 text-xs text-amber-700">
                  <TriangleAlert className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                  Chưa có trong cơ chế nào — đầu mục chưa đi vào phiếu lương của ai.
                </p>
              )}
              {canManage && (
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => void handleDelete(detail)}><Trash2 className="h-4 w-4" /> Xoá</Button>
                  <Button onClick={() => { const target = detail; setDetail(null); openEdit(target); }}>
                    <Pencil className="h-4 w-4" /> Sửa
                  </Button>
                </div>
              )}
            </div>
          );
        })()}
      </Modal>
    </div>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{label}</dt>
      <dd className="mt-0.5 text-slate-800">{value}</dd>
    </div>
  );
}

function IconButton({ children, label, onClick, danger = false }: {
  children: React.ReactNode; label: string; onClick: () => void; danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 transition-colors ${
        danger ? 'hover:bg-red-50 hover:text-red-600' : 'hover:bg-indigo-50 hover:text-indigo-600'
      }`}
    >
      {children}
    </button>
  );
}
