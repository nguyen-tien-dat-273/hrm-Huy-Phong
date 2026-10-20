// ============================================================================
// Danh mục khoản lương — danh sách ĐẦU MỤC dùng trong cơ chế lương.
// ----------------------------------------------------------------------------
// Danh mục chỉ khai đầu mục LÀ GÌ: tên, mã, nhóm (1 trong 5 nhóm), loại dòng
// (cộng vào lương / trừ khỏi lương) và nhãn báo cáo.
// Cách tính và con số của từng đầu mục đặt ở Cơ chế lương — mỗi cơ chế một công thức.
//
// Dòng TRUNG GIAN (đơn giá ngày, tổng cộng, thu nhập tính thuế…) không phải
// khoản lương: không thuộc nhóm nào, thường tạo thẳng ở Cơ chế lương. Ở đây
// chúng nằm riêng một thẻ để xem hoặc đổi tên.
//
// Không xoá đầu mục, chỉ Khóa / Mở khóa: đầu mục khóa vẫn giữ số liệu cũ nhưng
// không được chọn thêm vào cơ chế mới.
// ============================================================================

import { useEffect, useMemo, useState } from 'react';
import { Eye, Lock, LockOpen, PackagePlus, Pencil, Plus, Search, TriangleAlert } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input, Textarea } from '@/components/ui/Input';
import { Dropdown } from '@/components/ui/Dropdown';
import { ExportButtons } from '@/components/payroll/ExportButtons';
import { KindChip } from '@/components/payroll/KindChip';
import { useToast } from '@/contexts/ToastContext';
import { useConfirm } from '@/contexts/ConfirmContext';
import {
  fetchStandardCatalog, saveComponent, seedStandardCatalog, type PayrollWorkspace, type StandardCatalogItem,
} from '@/lib/payrollData';
import { KIND_LABEL, KIND_SHORT } from '@/lib/formulaEntries';
import { codeFromName } from '@/lib/payrollSettings';
import { PAY_REPORT_TAGS, reportTagKindProblem, reportTagLabel } from '@/lib/payrollReportTags';
import type {
  PayComponent, PayComponentCategoryCode, PayComponentKind, PayReportTag,
} from '@/types';

/** Ba loại dòng chọn được; EMPLOYER_COST chỉ còn trên dữ liệu cũ. */
const KINDS: Array<Exclude<PayComponentKind, 'EMPLOYER_COST'>> = ['EARNING', 'DEDUCTION', 'INFO'];

/** Thẻ lọc: tất cả, một trong năm nhóm, hoặc dòng trung gian không thuộc nhóm nào. */
type CatalogTab = 'ALL' | PayComponentCategoryCode | 'MID';

/** Dòng trung gian đứng ngoài năm nhóm. */
const isLooseIntermediate = (component: PayComponent) => component.kind === 'INFO' && !component.category_code;

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
  /** Nhãn báo cáo — rỗng là không gắn. Chỉ để báo cáo, không vào công thức. */
  report_tag: PayReportTag | '';
  /** Dòng trung gian: hiện trên phiếu lương của nhân viên. */
  show_on_payslip: boolean;
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
  const [categoryFilter, setCategoryFilter] = useState<CatalogTab>('ALL');

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
    const rows = searched.filter((component) => (
      categoryFilter === 'ALL'
      || (categoryFilter === 'MID' ? isLooseIntermediate(component) : component.category_code === categoryFilter)
    ));
    const orderOf = (component: PayComponent) => (component.category_code ? categoryOrder.get(component.category_code) ?? 98 : 99);
    return [...rows].sort((a, b) => orderOf(a) - orderOf(b) || a.sort_order - b.sort_order);
  }, [searched, categoryFilter, categoryOrder]);

  const usageOf = (component: PayComponent) => {
    const unitIds = new Set(data.unitItems
      .filter((item) => item.component_id === component.id && !item.effective_to && item.mode !== 'OFF').map((item) => item.unit_id));
    return {
      mechanisms: data.units.filter((unit) => unitIds.has(unit.id)).map((unit) => unit.name),
      people: new Set(data.items.filter((item) => item.component_id === component.id && !item.effective_to).map((item) => item.user_id)).size,
    };
  };

  // ------------------------------------------------------------------------
  // Biểu mẫu thêm / sửa
  // ------------------------------------------------------------------------
  const openCreate = (tab: CatalogTab = 'ALL') => {
    const categoryCode = tab === 'ALL' || tab === 'MID' ? '' : tab;
    setErrors({});
    setDraft({
      code: '', codeTouched: false, name: '', category_code: categoryCode,
      kind: tab === 'MID' ? 'INFO' : categoryCode === 'KHAU_TRU_PHAT' ? 'DEDUCTION' : 'EARNING',
      report_tag: '',
      show_on_payslip: false,
      is_active: true, note: '',
    });
  };

  const openEdit = (component: PayComponent) => {
    setErrors({});
    setDraft({
      id: component.id,
      code: component.code,
      codeTouched: true,
      name: component.name,
      category_code: component.category_code ?? '',
      kind: component.kind,
      report_tag: component.report_tag ?? '',
      show_on_payslip: !!component.show_on_payslip,
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
    if (!value.category_code && value.kind !== 'INFO') found.category_code = 'Khoản cộng / trừ phải thuộc một trong năm nhóm.';
    const tagProblem = reportTagKindProblem(value.report_tag || null, value.kind);
    if (tagProblem) found.report_tag = tagProblem;
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
      category_code: draft.category_code || null,
      kind: draft.kind,
      report_tag: draft.report_tag || null,
      show_on_payslip: draft.kind === 'INFO' && draft.show_on_payslip,
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

  const handleToggleLock = async (component: PayComponent) => {
    const locking = component.is_active;
    if (locking) {
      const usage = usageOf(component);
      const used = usage.mechanisms.length + usage.people;
      const ok = await confirm({
        title: `Khóa “${component.name}”?`,
        message:
          (used > 0
            ? `Đầu mục đang có trong cơ chế chung của ${usage.mechanisms.length} đơn vị${usage.mechanisms.length ? ` (${usage.mechanisms.join(', ')})` : ''} `
              + `và khai riêng của ${usage.people} nhân sự. `
            : '')
          + 'Khóa không xóa số liệu; đầu mục chỉ không được chọn thêm vào cơ chế mới. Mở khóa lại bất cứ lúc nào.',
        confirmLabel: 'Khóa đầu mục',
      });
      if (!ok) return;
    }

    const error = await saveComponent({ id: component.id, code: component.code, name: component.name, is_active: !locking });
    if (error) {
      toast(`${locking ? 'Khóa' : 'Mở khóa'} thất bại: ${error}`, 'error');
      return;
    }
    toast(locking ? `Đã khóa “${component.name}”.` : `Đã mở khóa “${component.name}”.`, 'success');
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
      { header: 'Nhóm', value: (c: PayComponent) => groupName(c), width: 24 },
      { header: 'Loại dòng', value: (c: PayComponent) => KIND_LABEL[c.kind], width: 18 },
      { header: 'Nhãn báo cáo', value: (c: PayComponent) => reportTagLabel(c.report_tag) ?? '', width: 30 },
      { header: 'Trạng thái', value: (c: PayComponent) => (c.is_active ? 'Kích hoạt' : 'Khóa'), width: 14 },
      { header: 'Mô tả', value: (c: PayComponent) => c.note ?? '', width: 50 },
    ],
    rows: filtered,
  });

  // ------------------------------------------------------------------------
  if (components.length === 0) {
    return (
      <Card className="!rounded-none">
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

  function groupName(component: PayComponent): string {
    if (!component.category_code) return 'Dòng trung gian';
    return categoryByCode.get(component.category_code)?.name ?? component.category_code;
  }

  function renderRow(component: PayComponent) {
    return (
      <tr key={component.id} className={`group transition-colors hover:bg-slate-100/80 dark:hover:bg-slate-800/60 ${component.is_active ? '' : 'opacity-60'}`}>
        <td className="px-4 py-2.5">
          <button type="button" onClick={() => setDetail(component)} className="text-left text-sm font-bold text-slate-900 dark:text-slate-100 hover:text-indigo-600 dark:hover:text-indigo-400">
            {component.name}
          </button>
          {categoryFilter === 'ALL' && (
            <p className="mt-0.5 text-[11px] font-medium text-slate-500 dark:text-slate-400">{groupName(component)}</p>
          )}
        </td>
        <td className="border-l border-slate-300 dark:border-slate-700 px-3 py-2.5 text-center">
          <span className="flex flex-wrap items-center justify-center gap-1.5">
            <KindChip kind={component.kind} />
          </span>
        </td>
        <td className="border-l border-slate-300 dark:border-slate-700 px-3 py-2.5 text-center">
          <span className={`inline-flex items-center gap-1.5 text-xs font-bold ${component.is_active ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-400 dark:text-slate-500'}`}>
            <span className={`h-2 w-2 rounded-full ${component.is_active ? 'bg-emerald-500' : 'bg-slate-400 dark:bg-slate-600'}`} />
            {component.is_active ? 'Kích hoạt' : 'Khóa'}
          </span>
        </td>
        <td className="border-l border-slate-300 dark:border-slate-700 px-2 py-1.5 text-center no-print">
          <div className="flex justify-center gap-0.5">
            {!canManage && (
              <IconButton label={`Xem ${component.name}`} onClick={() => setDetail(component)}><Eye className="h-3.5 w-3.5" /></IconButton>
            )}
            {canManage && (
              <IconButton label={`Sửa ${component.name}`} onClick={() => openEdit(component)}><Pencil className="h-3.5 w-3.5" /></IconButton>
            )}
            {canManage && (
              <IconButton label={`${component.is_active ? 'Khóa' : 'Mở khóa'} ${component.name}`} onClick={() => void handleToggleLock(component)}>
                {component.is_active ? <LockOpen className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />}
              </IconButton>
            )}
          </div>
        </td>
      </tr>
    );
  }

  function renderTable(rows: PayComponent[]) {
    return (
      <div className="overflow-x-auto">
        <table className="w-full min-w-[680px] whitespace-nowrap text-xs tabular-nums text-slate-900 dark:text-slate-100 border-collapse">
          <thead>
            <tr className="border-b-2 border-[#bf1f2b] dark:border-[#e66a76] bg-[#fdf2f4] dark:bg-[#201114] text-xs font-black uppercase tracking-wider text-[#5c0f16] dark:text-[#fde8ea] shadow-[inset_0_-2px_0_#bf1f2b] dark:shadow-[inset_0_-2px_0_#e66a76]">
              <th className="px-4 py-3.5 text-left">Tên đầu mục</th>
              <th className="border-l border-[#eed5d8] dark:border-[#4a1c22] px-3 py-3.5 text-center">Loại dòng</th>
              <th className="border-l border-[#eed5d8] dark:border-[#4a1c22] px-3 py-3.5 text-center">Trạng thái</th>
              <th className="border-l border-[#eed5d8] dark:border-[#4a1c22] w-12 px-2 py-3.5 no-print" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-300 dark:divide-slate-800 bg-white dark:bg-slate-900">{rows.map(renderRow)}</tbody>
        </table>
      </div>
    );
  }

  function renderForm() {
    return (
      <Modal square open={!!draft} onClose={() => setDraft(null)} title={draft?.id ? 'Sửa đầu mục' : 'Thêm đầu mục'} size="lg">
        {draft && (
          <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void handleSave(); }} noValidate>
            <Input className="!rounded-none"
              label="Tên đầu mục"
              required
              value={draft.name}
              onChange={(event) => updateDraft({ name: event.target.value })}
              error={errors.name ?? errors.code}
              placeholder="VD: Phụ cấp xăng xe"
              autoFocus
            />

            <div>
              <span className="mb-1.5 block text-sm font-semibold text-slate-700 dark:text-slate-300">Loại dòng<span className="ml-1 text-red-500" aria-hidden="true">*</span></span>
              <div className="grid grid-cols-3 gap-1 rounded-none bg-slate-100 dark:bg-slate-800 p-1" role="radiogroup" aria-label="Loại dòng">
                {KINDS.map((kind) => (
                  <button
                    key={kind}
                    type="button"
                    role="radio"
                    aria-checked={draft.kind === kind}
                    onClick={() => updateDraft({ kind })}
                    className={`rounded-none px-3 py-2 text-sm font-bold transition ${draft.kind === kind ? 'bg-white dark:bg-slate-700 text-indigo-700 dark:text-indigo-300 shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'}`}
                  >
                    {kind === 'INFO' ? KIND_LABEL[kind] : KIND_SHORT[kind]}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Dropdown square
                label="Nhóm"
                required={draft.kind !== 'INFO'}
                placeholder="Chọn nhóm…"
                value={draft.category_code}
                options={[
                  ...(draft.kind === 'INFO' ? [{ value: '', label: 'Không thuộc nhóm nào' }] : []),
                  ...categories.map((item) => ({ value: item.code, label: item.name })),
                ]}
                onChange={(value) => updateDraft({ category_code: value as PayComponentCategoryCode | '' })}
                error={errors.category_code}
              />
              <Dropdown square
                label="Nhãn báo cáo"
                value={draft.report_tag}
                options={[
                  { value: '', label: 'Không gắn nhãn' },
                  ...PAY_REPORT_TAGS.map((tag) => ({ value: tag.code, label: tag.label })),
                ]}
                onChange={(value) => updateDraft({ report_tag: value as PayReportTag | '' })}
                error={errors.report_tag}
              />
            </div>

            {draft.kind === 'INFO' && (
              <label className="flex cursor-pointer items-start gap-2.5 rounded-none border border-slate-200 dark:border-slate-700 px-3 py-2.5">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 accent-indigo-600"
                  checked={draft.show_on_payslip}
                  onChange={(event) => updateDraft({ show_on_payslip: event.target.checked })}
                />
                <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">Hiện trên phiếu lương</span>
              </label>
            )}

            <div>
              <span className="mb-1.5 block text-sm font-semibold text-slate-700 dark:text-slate-300">Trạng thái hoạt động</span>
              <div className="grid grid-cols-2 gap-1 rounded-none bg-slate-100 dark:bg-slate-800 p-1" role="radiogroup" aria-label="Trạng thái hoạt động">
                {([[true, 'Kích hoạt', 'bg-emerald-600 text-white'], [false, 'Khóa', 'bg-slate-600 dark:bg-slate-700 text-white']] as const).map(([value, label, on]) => (
                  <button
                    key={label}
                    type="button"
                    role="radio"
                    aria-checked={draft.is_active === value}
                    onClick={() => updateDraft({ is_active: value })}
                    className={`rounded-none px-3 py-2 text-sm font-bold transition ${draft.is_active === value ? on : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <Textarea className="!rounded-none" label="Mô tả" rows={2} value={draft.note}
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

  const tabs: Array<{ code: CatalogTab; label: string; count: number }> = [
    { code: 'ALL', label: 'Tất cả', count: searched.length },
    ...categories.map((category) => ({
      code: category.code as PayComponentCategoryCode,
      label: category.name,
      count: searched.filter((component) => component.category_code === category.code).length,
    })),
    { code: 'MID', label: 'Dòng trung gian', count: searched.filter(isLooseIntermediate).length },
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
            className="h-10 w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 pl-9 pr-3 text-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/15"
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
            <Button size="sm" onClick={() => openCreate(categoryFilter)}>
              <Plus className="h-3.5 w-3.5" /> {categoryFilter === 'MID' ? 'Thêm dòng trung gian' : 'Thêm khoản lương'}
            </Button>
          )}
        </div>
      </div>

      <div className="flex gap-1 overflow-x-auto border-b border-slate-200 dark:border-slate-800 no-print" role="tablist" aria-label="Lọc theo nhóm">
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
                active ? 'border-indigo-600 text-indigo-700 dark:text-indigo-400' : 'border-transparent text-slate-500 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-700 hover:text-slate-800 dark:hover:text-slate-200'
              }`}
            >
              {tab.label}
              <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums ${active ? 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300' : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400'}`}>
                {tab.count}
              </span>
            </button>
          );
        })}
      </div>

      {filtered.length === 0 ? (
        <Card className="!rounded-none"><CardContent className="py-10 text-center text-sm text-slate-500">Không có đầu mục nào khớp.</CardContent></Card>
      ) : (
        <Card className="!rounded-none">
          <CardContent className="p-0">{renderTable(filtered)}</CardContent>
        </Card>
      )}

      {renderForm()}

      {/* --- Chi tiết đầu mục --- */}
      <Modal square open={!!detail} onClose={() => setDetail(null)} title={detail?.name ?? ''} size="lg">
        {detail && (() => {
          const usage = usageOf(detail);
          return (
            <div className="space-y-4">
              <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
                <Field label="Nhóm" value={groupName(detail)} />
                <Field label="Loại dòng" value={<KindChip kind={detail.kind} />} />
                {detail.kind === 'INFO' && (
                  <Field label="Trên phiếu lương" value={detail.show_on_payslip ? 'Hiện cho nhân viên' : 'Không hiện'} />
                )}
                <Field label="Nhãn báo cáo" value={reportTagLabel(detail.report_tag) ?? 'Không gắn'} />
                <Field label="Trạng thái" value={detail.is_active ? 'Kích hoạt' : 'Khóa'} />
                <Field label="Có trong cơ chế chung của" value={usage.mechanisms.length ? usage.mechanisms.join(', ') : 'Chưa có đơn vị nào'} />
                <Field label="Khai riêng" value={`${usage.people} nhân sự`} />
              </dl>
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Mô tả</p>
                <p className="mt-1 whitespace-pre-line text-sm text-slate-700">{detail.note || 'Chưa có mô tả.'}</p>
              </div>
              {usage.mechanisms.length + usage.people === 0 && detail.is_active && (
                <p className="flex items-start gap-2 text-xs text-amber-700">
                  <TriangleAlert className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                  Chưa có trong cơ chế nào — đầu mục chưa đi vào phiếu lương của ai.
                </p>
              )}
              {canManage && (
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => void handleToggleLock(detail)}>
                    {detail.is_active ? <><Lock className="h-4 w-4" /> Khóa</> : <><LockOpen className="h-4 w-4" /> Mở khóa</>}
                  </Button>
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
