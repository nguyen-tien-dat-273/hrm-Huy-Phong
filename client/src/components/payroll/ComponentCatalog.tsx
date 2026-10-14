// ============================================================================
// F06.01 — Danh mục khoản lương & đãi ngộ.
// ----------------------------------------------------------------------------
// Theo đặc tả: mỗi khoản có MÃ định danh duy nhất, thuộc đúng MỘT trong năm
// nhóm bắt buộc (BR-PAY-001), có loại (cộng / trừ), tính chất (cố định /
// biến đổi), cờ chịu thuế TNCN, cờ tính đóng BHXH, đơn giá hoặc tỷ lệ mặc định
// và mô tả vai trò hạch toán.
//
// Danh mục KHÔNG chứa công thức: cách tính đặt ở Công thức theo khối (F06.02)
// và Cơ chế lương từng người (F06.03). Khoản cũ còn mang công thức mặc định
// thì hiện ra ở phần chi tiết (chỉ đọc) và lưu sửa không xoá mất nó — bản
// trước "ghi đè về rỗng" khi sửa, làm khoản OT đang chạy công thức thành khoản
// cố định 0đ chỉ vì ai đó sửa ghi chú.
//
// Xoá đi đúng luồng hoạt động F06.01: khoản đã phát sinh trong kỳ lương đã
// chốt thì database tự chuyển "Ngừng hoạt động" thay vì xoá, và ghi vết.
// ============================================================================

import { useEffect, useMemo, useState } from 'react';
import {
  Cpu, Eye, Layers, List, PackagePlus, Pencil, Plus, Search, Trash2, TriangleAlert,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input, Select, Textarea } from '@/components/ui/Input';
import { ExportButtons } from '@/components/payroll/ExportButtons';
import { useToast } from '@/contexts/ToastContext';
import { useConfirm } from '@/contexts/ConfirmContext';
import {
  fetchStandardCatalog, removeComponent, saveComponent, seedStandardCatalog, type StandardCatalogItem,
} from '@/lib/payrollData';
import { formatVND } from '@/lib/utils';
import type {
  EmployeePayItem, PayComponent, PayComponentCategory, PayComponentCategoryCode, PayComponentKind,
  PayComponentNature, PayrollTemplateItem, UnitPayItem,
} from '@/types';

const KIND_LABEL: Record<PayComponentKind, string> = {
  EARNING: 'Khoản cộng',
  DEDUCTION: 'Khoản trừ',
  EMPLOYER_COST: 'Doanh nghiệp đóng (không trừ lương)',
};

const NATURE_LABEL: Record<PayComponentNature, string> = {
  FIXED: 'Cố định định kỳ',
  VARIABLE: 'Biến đổi (hiệu suất / thời gian)',
};

const PAGE_SIZE = 15;

/** Bỏ dấu để gõ "phu cap" tìm ra "Phụ cấp". */
const stripTone = (text: string) => text
  .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd')
  .toLowerCase().trim();

/** Gợi ý mã hệ thống từ tên khoản — người dùng sửa lại được. */
function codeFromName(name: string, taken: readonly string[]): string {
  const base = name
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/^([0-9])/, 'K$1')
    .slice(0, 40) || 'KHOAN';
  if (!taken.includes(base)) return base;
  for (let i = 2; i < 100; i += 1) {
    const candidate = `${base}_${i}`;
    if (!taken.includes(candidate)) return candidate;
  }
  return `${base}_${Date.now().toString().slice(-4)}`;
}

interface Draft {
  id?: string;
  code: string;
  /** Người dùng đã tự gõ mã — thôi gợi ý theo tên. */
  codeTouched: boolean;
  name: string;
  category_code: PayComponentCategoryCode | '';
  kind: PayComponentKind;
  nature: PayComponentNature;
  default_amount: string;
  taxable: boolean;
  insurable: boolean;
  is_active: boolean;
  group_name: string;
  note: string;
  tax_exempt_cap: string;
  max_amount: string;
  ot_multiplier: string;
  calc_source: 'ASSIGNED' | 'ENGINE';
  calc_type: PayComponent['calc_type'];
}

type DraftErrors = Partial<Record<keyof Draft, string>>;

interface ComponentCatalogProps {
  components: PayComponent[];
  categories: PayComponentCategory[];
  /** Để màn chi tiết nói khoản đang được dùng ở bao nhiêu nơi. */
  employeeItems: EmployeePayItem[];
  unitItems: UnitPayItem[];
  templateItems: PayrollTemplateItem[];
  canManage: boolean;
  onChanged: () => void;
}

export function ComponentCatalog({
  components, categories, employeeItems, unitItems, templateItems, canManage, onChanged,
}: ComponentCatalogProps) {
  const { toast } = useToast();
  const confirm = useConfirm();

  const [query, setQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<'ALL' | PayComponentCategoryCode>('ALL');
  const [kindFilter, setKindFilter] = useState<'ALL' | PayComponentKind>('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'INACTIVE'>('ALL');
  const [natureFilter, setNatureFilter] = useState<'ALL' | PayComponentNature>('ALL');
  const [view, setView] = useState<'groups' | 'list'>('groups');
  const [sort, setSort] = useState<'order' | 'name' | 'code'>('order');
  const [page, setPage] = useState(1);

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

  const filtered = useMemo(() => {
    const keyword = stripTone(query);
    const rows = components.filter((component) =>
      (!keyword || stripTone(component.name).includes(keyword) || stripTone(component.code).includes(keyword))
      && (categoryFilter === 'ALL' || component.category_code === categoryFilter)
      && (kindFilter === 'ALL' || component.kind === kindFilter)
      && (natureFilter === 'ALL' || component.nature === natureFilter)
      && (statusFilter === 'ALL' || (statusFilter === 'ACTIVE') === component.is_active));
    return [...rows].sort((a, b) => (
      sort === 'name' ? a.name.localeCompare(b.name, 'vi')
        : sort === 'code' ? a.code.localeCompare(b.code)
          : a.sort_order - b.sort_order
    ));
  }, [components, query, categoryFilter, kindFilter, natureFilter, statusFilter, sort]);

  useEffect(() => { setPage(1); }, [query, categoryFilter, kindFilter, natureFilter, statusFilter, sort, view]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const usageOf = (component: PayComponent) => ({
    people: new Set(employeeItems.filter((item) => item.component_id === component.id && !item.effective_to).map((item) => item.user_id)).size,
    units: new Set(unitItems.filter((item) => item.component_id === component.id && !item.effective_to).map((item) => item.unit_id)).size,
    templates: new Set(templateItems.filter((item) => item.component_id === component.id && !item.effective_to).map((item) => item.template_id)).size,
  });

  // ------------------------------------------------------------------------
  // Biểu mẫu thêm / sửa (UI_03)
  // ------------------------------------------------------------------------
  const openCreate = (categoryCode?: PayComponentCategoryCode) => {
    const category = categoryCode ? categoryByCode.get(categoryCode) : undefined;
    setErrors({});
    setDraft({
      code: '', codeTouched: false, name: '', category_code: categoryCode ?? '',
      kind: category?.allowed_kinds[0] ?? 'EARNING', nature: category?.default_nature ?? 'VARIABLE',
      default_amount: '', taxable: true, insurable: false, is_active: true, group_name: '', note: '',
      tax_exempt_cap: '', max_amount: '', ot_multiplier: '', calc_source: 'ASSIGNED', calc_type: 'FIXED',
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
      default_amount: Number(component.default_amount) ? String(Number(component.default_amount)) : '',
      taxable: component.taxable,
      insurable: component.insurable,
      is_active: component.is_active,
      group_name: component.group_name ?? '',
      note: component.note ?? '',
      tax_exempt_cap: component.tax_exempt_cap == null ? '' : String(Number(component.tax_exempt_cap)),
      max_amount: component.max_amount == null ? '' : String(Number(component.max_amount)),
      ot_multiplier: component.ot_multiplier == null ? '' : String(Number(component.ot_multiplier)),
      calc_source: component.calc_source,
      calc_type: component.calc_type,
    });
  };

  const updateDraft = (patch: Partial<Draft>) => {
    setDraft((current) => {
      if (!current) return current;
      const next = { ...current, ...patch };
      // Mã gợi ý theo tên cho tới khi người dùng tự gõ mã.
      if (patch.name !== undefined && !current.codeTouched && !current.id) {
        next.code = codeFromName(patch.name, components.map((item) => item.code));
      }
      // Đổi nhóm thì loại khoản và tính chất mặc định đi theo nhóm.
      if (patch.category_code && patch.category_code !== current.category_code) {
        const category = categoryByCode.get(patch.category_code);
        if (category && !category.allowed_kinds.includes(next.kind)) next.kind = category.allowed_kinds[0];
        if (category && !current.id) next.nature = category.default_nature;
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
    if (!code) found.code = 'Nhập mã khoản lương.';
    else if (!/^[A-Z][A-Z0-9_]*$/.test(code)) found.code = 'Mã viết hoa không dấu, bắt đầu bằng chữ, chỉ gồm chữ, số và "_".';
    else if (components.some((item) => item.code === code && item.id !== value.id)) found.code = 'Mã khoản lương đã tồn tại trên hệ thống.';
    if (!value.name.trim()) found.name = 'Nhập tên khoản lương.';
    else if (components.some((item) => item.name.trim().toLowerCase() === value.name.trim().toLowerCase() && item.id !== value.id)) {
      found.name = 'Tên khoản lương đã tồn tại trên hệ thống.';
    }
    if (!value.category_code) found.category_code = 'Chọn 1 trong 5 nhóm phân loại (BR-PAY-001).';
    const category = value.category_code ? categoryByCode.get(value.category_code) : undefined;
    if (category && !category.allowed_kinds.includes(value.kind)) found.kind = `Nhóm "${category.name}" không nhận loại khoản này.`;
    const amount = value.default_amount.trim() === '' ? 0 : Number(value.default_amount);
    if (!Number.isFinite(amount) || amount < 0) found.default_amount = 'Mức mặc định phải là số không âm.';
    if (value.calc_type === 'PERCENT' && amount > 100) found.default_amount = 'Tỷ lệ phải từ 0 đến 100%.';
    for (const key of ['tax_exempt_cap', 'max_amount', 'ot_multiplier'] as const) {
      const raw = value[key].trim();
      if (raw && (!Number.isFinite(Number(raw)) || Number(raw) < 0)) found[key] = 'Phải là số không âm.';
    }
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
    const isEngine = draft.calc_source === 'ENGINE';
    setSaving(true);
    // Chỉ ghi những trường màn này quản lý. KHÔNG đụng calc_type/formula/
    // input_code của khoản cũ — xem đầu file.
    const error = await saveComponent({
      ...(draft.id ? { id: draft.id } : {
        calc_type: 'FIXED', formula: null, input_code: null, base_code: null, prorate: false,
        is_base: false, sort_order: components.reduce((max, item) => Math.max(max, item.sort_order), 400) + 10,
        calc_source: 'ASSIGNED',
      }),
      code: draft.code.trim().toUpperCase(),
      name: draft.name.trim(),
      note: draft.note.trim() || null,
      ...(isEngine ? {} : {
        category_code: draft.category_code as PayComponentCategoryCode,
        kind: draft.kind,
        nature: draft.nature,
        default_amount: draft.default_amount.trim() === '' ? 0 : Number(draft.default_amount),
        taxable: draft.taxable,
        insurable: draft.insurable,
        is_active: draft.is_active,
        group_name: draft.group_name.trim() || null,
        tax_exempt_cap: draft.tax_exempt_cap.trim() ? Number(draft.tax_exempt_cap) : null,
        max_amount: draft.max_amount.trim() ? Number(draft.max_amount) : null,
        ot_multiplier: draft.ot_multiplier.trim() ? Number(draft.ot_multiplier) : null,
      }),
    });
    setSaving(false);
    if (error) {
      // Lỗi trùng do database phát hiện (người khác vừa thêm) — đỏ đúng ô.
      if (/Mã khoản lương đã tồn tại/.test(error)) setErrors({ code: error });
      else if (/Tên khoản lương/.test(error)) setErrors({ name: error });
      toast('Không lưu được khoản lương: ' + error, 'error');
      return;
    }
    toast(`Đã lưu khoản "${draft.name.trim()}".`, 'success');
    setDraft(null);
    onChanged();
  };

  const handleDelete = async (component: PayComponent) => {
    const usage = usageOf(component);
    const used = usage.people + usage.units + usage.templates;
    const ok = await confirm({
      title: `Xoá khoản "${component.name}"?`,
      message:
        (used > 0
          ? `Khoản đang gán cho ${usage.people} nhân sự, ${usage.units} đơn vị, ${usage.templates} mẫu bảng lương — các gán đó mất theo ở kỳ chưa chốt. `
          : '')
        + 'Nếu khoản đã phát sinh trong kỳ lương đã chốt, hệ thống KHÔNG xoá mà tự chuyển sang "Ngừng hoạt động" để giữ số liệu hồi tố.'
        + (component.is_system ? ' Đây là khoản hệ thống — luồng khác (KPI, công đoàn) có thể đang gọi mã này.' : ''),
      confirmLabel: 'Xoá khoản',
      danger: true,
    });
    if (!ok) return;

    const { result, error } = await removeComponent(component.id);
    if (error) {
      toast('Xoá thất bại: ' + error, 'error');
      return;
    }
    toast(result === 'DEACTIVATED'
      ? `"${component.name}" đã phát sinh trong kỳ lương đã chốt — không xoá, đã chuyển Ngừng hoạt động.`
      : `Đã xoá vĩnh viễn "${component.name}".`, result === 'DEACTIVATED' ? 'warning' : 'success');
    setDetail(null);
    onChanged();
  };

  const handleSeed = async () => {
    const ok = await confirm({
      title: components.length === 0 ? 'Khởi tạo danh mục chuẩn?' : `Bổ sung ${missingStandard.length} khoản chuẩn còn thiếu?`,
      message: 'Thêm các khoản theo danh mục 26 khoản chuẩn của Huy Phong (5 nhóm). Khoản đã có giữ nguyên, '
        + 'không ghi đè tên hay cờ đã chỉnh. Khoản "hệ thống tự tính" (lương thời gian, phép, lễ, bảo hiểm, thuế) '
        + 'chỉ để liệt kê — engine đã tự tính, không gán được.',
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
    toast(`Đã thêm ${inserted} khoản chuẩn vào danh mục.`, 'success');
    onChanged();
  };

  const exportOptions = () => ({
    filename: 'danh-muc-khoan-luong',
    sheetName: 'Danh mục khoản lương',
    title: 'DANH MỤC KHOẢN LƯƠNG & ĐÃI NGỘ',
    subtitle: `${filtered.length} khoản · xuất lúc ${new Date().toLocaleString('vi-VN')}`,
    columns: [
      { header: 'Mã', value: (c: PayComponent) => c.code, width: 22 },
      { header: 'Tên khoản', value: (c: PayComponent) => c.name, width: 36 },
      { header: 'Nhóm', value: (c: PayComponent) => categoryByCode.get(c.category_code)?.name ?? c.category_code, width: 24 },
      { header: 'Loại', value: (c: PayComponent) => KIND_LABEL[c.kind], width: 20 },
      { header: 'Tính chất', value: (c: PayComponent) => NATURE_LABEL[c.nature], width: 22 },
      { header: 'Mức / tỷ lệ mặc định', value: (c: PayComponent) => Number(c.default_amount) || '', width: 16 },
      { header: 'Chịu thuế TNCN', value: (c: PayComponent) => (c.taxable ? 'Có' : 'Không'), width: 12 },
      { header: 'Tính BHXH', value: (c: PayComponent) => (c.insurable ? 'Có' : 'Không'), width: 10 },
      { header: 'Nguồn', value: (c: PayComponent) => (c.calc_source === 'ENGINE' ? 'Hệ thống tự tính' : 'Gán'), width: 14 },
      { header: 'Trạng thái', value: (c: PayComponent) => (c.is_active ? 'Kích hoạt' : 'Ngừng hoạt động'), width: 14 },
      { header: 'Mô tả vai trò hạch toán', value: (c: PayComponent) => c.note ?? '', width: 50 },
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
          description="Chưa có danh mục khoản lương nào được thiết lập. Vui lòng bấm 'Khởi tạo danh mục chuẩn' hoặc 'Thêm mới'."
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
      <tr key={component.id} className={`align-top transition-colors hover:bg-[#FCFAF8] ${component.is_active ? '' : 'opacity-60'}`}>
        <td className="px-4 py-3 font-mono text-[11px] font-bold text-indigo-700">{component.code}</td>
        <td className="px-3 py-3">
          <button type="button" onClick={() => setDetail(component)} className="text-left text-sm font-semibold text-slate-800 hover:text-indigo-700">
            {component.name}
          </button>
          <div className="mt-1 flex flex-wrap gap-1">
            {component.calc_source === 'ENGINE' && <Tag tone="violet" icon={<Cpu className="h-3 w-3" />}>Hệ thống tự tính</Tag>}
            {component.is_base && <Tag tone="indigo">Bậc lương</Tag>}
            {!component.is_active && <Tag tone="slate">Ngừng hoạt động</Tag>}
            {view === 'list' && category && <Tag tone="slate">{category.name}</Tag>}
          </div>
        </td>
        <td className="px-3 py-3 text-xs text-slate-600">{component.kind === 'EARNING' ? 'Cộng' : component.kind === 'DEDUCTION' ? 'Trừ' : 'DN đóng'}</td>
        <td className="px-3 py-3 text-xs text-slate-600">{component.nature === 'FIXED' ? 'Cố định' : 'Biến đổi'}</td>
        <td className="px-3 py-3 text-right text-xs tabular-nums text-slate-700">
          {Number(component.default_amount)
            ? component.calc_type === 'PERCENT' ? `${Number(component.default_amount)}%` : formatVND(Number(component.default_amount))
            : '—'}
        </td>
        <td className="px-3 py-3 text-center text-xs">{component.taxable ? '✓' : '—'}</td>
        <td className="px-3 py-3 text-center text-xs">{component.insurable ? '✓' : '—'}</td>
        <td className="px-3 py-3 no-print">
          <div className="flex justify-end gap-0.5">
            <IconButton label={`Xem ${component.name}`} onClick={() => setDetail(component)}><Eye className="h-3.5 w-3.5" /></IconButton>
            {canManage && (
              <IconButton label={`Sửa ${component.name}`} onClick={() => openEdit(component)}><Pencil className="h-3.5 w-3.5" /></IconButton>
            )}
            {canManage && component.calc_source !== 'ENGINE' && (
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
        <table className="w-full min-w-[760px]">
          <thead>
            <tr className="border-b border-slate-100 bg-[#FCFAF8] text-left text-[10px] font-bold uppercase tracking-widest text-slate-400">
              <th className="px-4 py-2.5">Mã</th>
              <th className="px-3 py-2.5">Tên khoản</th>
              <th className="px-3 py-2.5">Loại</th>
              <th className="px-3 py-2.5">Tính chất</th>
              <th className="px-3 py-2.5 text-right">Mặc định</th>
              <th className="px-3 py-2.5 text-center">Thuế</th>
              <th className="px-3 py-2.5 text-center">BHXH</th>
              <th className="px-3 py-2.5 no-print" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">{rows.map(renderRow)}</tbody>
        </table>
      </div>
    );
  }

  function renderForm() {
    const category = draft?.category_code ? categoryByCode.get(draft.category_code) : undefined;
    const isEngine = draft?.calc_source === 'ENGINE';
    return (
      <Modal open={!!draft} onClose={() => setDraft(null)} title={draft?.id ? 'Sửa khoản lương' : 'Thêm khoản lương'} size="lg">
        {draft && (
          <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void handleSave(); }} noValidate>
            {isEngine && (
              <p className="flex items-start gap-2 rounded-xl bg-violet-50 px-3.5 py-2.5 text-xs leading-relaxed text-violet-900">
                <Cpu className="mt-0.5 h-4 w-4 flex-shrink-0" />
                Khoản do hệ thống tự tính từ chấm công và tham số — chỉ sửa được tên và mô tả hạch toán.
              </p>
            )}
            <div className="grid gap-3 sm:grid-cols-[1fr_1.4fr]">
              <Input
                label="Mã khoản lương"
                required
                value={draft.code}
                disabled={isEngine}
                onChange={(event) => updateDraft({ code: event.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ''), codeTouched: true })}
                className="font-mono"
                error={errors.code}
                placeholder="VD: PC_XANG_XE"
              />
              <Input
                label="Tên khoản lương"
                required
                value={draft.name}
                onChange={(event) => updateDraft({ name: event.target.value })}
                error={errors.name}
                placeholder="VD: Phụ cấp xăng xe"
                autoFocus
              />
            </div>
            {draft.id && !isEngine && (
              <p className="-mt-2 text-[11px] text-slate-400">
                Mã là biến trong công thức: đổi mã thì công thức đang gọi mã cũ phải sửa theo. Khoản đã lên phiếu lương thì không đổi mã được.
              </p>
            )}

            {!isEngine && (
              <>
                <div className="grid gap-3 sm:grid-cols-3">
                  <Select
                    label="Nhóm phân loại"
                    required
                    value={draft.category_code}
                    onChange={(event) => updateDraft({ category_code: event.target.value as PayComponentCategoryCode })}
                    error={errors.category_code}
                  >
                    <option value="">Chọn nhóm…</option>
                    {categories.map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}
                  </Select>
                  <Select
                    label="Loại khoản"
                    required
                    value={draft.kind}
                    onChange={(event) => updateDraft({ kind: event.target.value as PayComponentKind })}
                    error={errors.kind}
                  >
                    {(category?.allowed_kinds ?? (['EARNING', 'DEDUCTION', 'EMPLOYER_COST'] as PayComponentKind[])).map((kind) => (
                      <option key={kind} value={kind}>{KIND_LABEL[kind]}</option>
                    ))}
                  </Select>
                  <Select
                    label="Tính chất"
                    required
                    value={draft.nature}
                    onChange={(event) => updateDraft({ nature: event.target.value as PayComponentNature })}
                  >
                    {Object.entries(NATURE_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </Select>
                </div>
                {category?.description && <p className="-mt-2 text-[11px] leading-relaxed text-slate-400">{category.description}</p>}

                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <Input
                      label={draft.calc_type === 'PERCENT' ? 'Tỷ lệ mặc định (%)' : 'Đơn giá / mức mặc định (VND)'}
                      inputMode="decimal"
                      value={draft.default_amount}
                      onChange={(event) => updateDraft({ default_amount: event.target.value.replace(/[^\d.]/g, '') })}
                      error={errors.default_amount}
                      placeholder="Để trống nếu khai theo từng người"
                    />
                    {Number(draft.default_amount) > 0 && draft.calc_type !== 'PERCENT' && (
                      <p className="mt-1 text-xs text-slate-500">= {formatVND(Number(draft.default_amount))}</p>
                    )}
                  </div>
                  <Input
                    label="Tiểu nhóm (không bắt buộc)"
                    list="pay-component-subgroups"
                    value={draft.group_name}
                    onChange={(event) => updateDraft({ group_name: event.target.value })}
                    placeholder="VD: Phụ cấp, Làm thêm giờ…"
                  />
                </div>

                <div className="grid gap-2 rounded-xl border border-slate-200 p-3.5 sm:grid-cols-3">
                  <Toggle checked={draft.taxable} onChange={(taxable) => updateDraft({ taxable })}
                    label="Chịu thuế TNCN" hint="Vào thu nhập chịu thuế (BR-PAY-002)." />
                  <Toggle checked={draft.insurable} onChange={(insurable) => updateDraft({ insurable })}
                    label="Tính đóng BHXH" hint="Thuộc tiền lương làm căn cứ đóng (BR-PAY-003)." />
                  <Toggle checked={draft.is_active} onChange={(is_active) => updateDraft({ is_active })}
                    label="Kích hoạt" hint="Tắt = Ngừng hoạt động, giữ lịch sử." />
                </div>

                <details className="rounded-xl border border-slate-200 px-3.5 py-2.5">
                  <summary className="cursor-pointer text-xs font-bold text-slate-600">Ngưỡng và trần (không bắt buộc)</summary>
                  <div className="mt-3 grid gap-3 sm:grid-cols-3">
                    <Input label="Ngưỡng miễn thuế (VND)" inputMode="decimal" value={draft.tax_exempt_cap}
                      onChange={(event) => updateDraft({ tax_exempt_cap: event.target.value.replace(/[^\d.]/g, '') })}
                      error={errors.tax_exempt_cap} placeholder="—" />
                    <Input label="Trần số tiền (VND)" inputMode="decimal" value={draft.max_amount}
                      onChange={(event) => updateDraft({ max_amount: event.target.value.replace(/[^\d.]/g, '') })}
                      error={errors.max_amount} placeholder="—" />
                    {draft.category_code === 'LAM_THEM_GIO' && (
                      <Input label="Hệ số làm thêm (miễn thuế phần vượt)" inputMode="decimal" value={draft.ot_multiplier}
                        onChange={(event) => updateDraft({ ot_multiplier: event.target.value.replace(/[^\d.]/g, '') })}
                        error={errors.ot_multiplier} placeholder="VD: 1.5" />
                    )}
                  </div>
                </details>
              </>
            )}

            <Textarea
              label="Mô tả vai trò hạch toán / ghi chú sử dụng"
              rows={3}
              value={draft.note}
              onChange={(event) => updateDraft({ note: event.target.value })}
              placeholder="VD: Hạch toán chi phí lương (TK 334). Trả cho nhân viên thường xuyên di chuyển."
            />

            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="secondary" onClick={() => setDraft(null)} disabled={saving}>Huỷ</Button>
              <Button type="submit" disabled={saving}>{saving ? 'Đang lưu…' : 'Lưu khoản lương'}</Button>
            </div>
          </form>
        )}
      </Modal>
    );
  }

  return (
    <div className="space-y-4">
      <datalist id="pay-component-subgroups">
        {[...new Set(components.map((item) => item.group_name).filter(Boolean) as string[])].sort()
          .map((group) => <option key={group} value={group} />)}
      </datalist>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-sm leading-relaxed text-slate-500">
          {components.length} khoản trong 5 nhóm bắt buộc. Danh mục chỉ khai <strong>khoản là gì</strong>; cách tính
          đặt ở <strong>Công thức theo khối</strong> và <strong>Cơ chế lương</strong>.
        </p>
        {canManage && (
          <div className="flex flex-wrap gap-2 no-print">
            {missingStandard.length > 0 && (
              <Button variant="outline" onClick={() => void handleSeed()} disabled={seeding}>
                <PackagePlus className="h-4 w-4" />
                {seeding ? 'Đang bổ sung…' : `Bổ sung ${missingStandard.length} khoản chuẩn còn thiếu`}
              </Button>
            )}
            <Button onClick={() => openCreate()}><Plus className="h-4 w-4" /> Thêm khoản lương</Button>
          </div>
        )}
      </div>

      {/* --- Thanh tìm kiếm, lọc, sắp xếp, xuất (UI_02) --- */}
      <Card>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[220px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Tìm theo mã hoặc tên khoản…"
                className="h-10 w-full rounded-xl border border-slate-200 pl-9 pr-3 text-sm outline-none focus:border-indigo-500"
              />
            </div>
            <div className="inline-flex rounded-xl bg-slate-100 p-1 no-print" role="tablist" aria-label="Cách xem">
              {([['groups', 'Theo 5 nhóm', Layers], ['list', 'Danh sách', List]] as const).map(([value, label, Icon]) => (
                <button key={value} type="button" role="tab" aria-selected={view === value} onClick={() => setView(value)}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition ${view === value ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>
                  <Icon className="h-3.5 w-3.5" /> {label}
                </button>
              ))}
            </div>
            <ExportButtons options={exportOptions} disabled={filtered.length === 0} />
          </div>
          <div className="grid gap-2 sm:grid-cols-5 no-print">
            <Select aria-label="Lọc theo nhóm" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value as typeof categoryFilter)}>
              <option value="ALL">Mọi nhóm</option>
              {categories.map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}
            </Select>
            <Select aria-label="Lọc theo loại" value={kindFilter} onChange={(event) => setKindFilter(event.target.value as typeof kindFilter)}>
              <option value="ALL">Mọi loại</option>
              {Object.entries(KIND_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </Select>
            <Select aria-label="Lọc theo tính chất" value={natureFilter} onChange={(event) => setNatureFilter(event.target.value as typeof natureFilter)}>
              <option value="ALL">Mọi tính chất</option>
              <option value="FIXED">Cố định</option>
              <option value="VARIABLE">Biến đổi</option>
            </Select>
            <Select aria-label="Lọc theo trạng thái" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}>
              <option value="ALL">Mọi trạng thái</option>
              <option value="ACTIVE">Kích hoạt</option>
              <option value="INACTIVE">Ngừng hoạt động</option>
            </Select>
            <Select aria-label="Sắp xếp" value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}>
              <option value="order">Sắp theo thứ tự tính</option>
              <option value="name">Sắp theo tên</option>
              <option value="code">Sắp theo mã</option>
            </Select>
          </div>
        </CardContent>
      </Card>

      {filtered.length === 0 ? (
        <Card><CardContent className="py-10 text-center text-sm text-slate-500">Không có khoản nào khớp bộ lọc.</CardContent></Card>
      ) : view === 'groups' ? (
        categories
          .filter((category) => categoryFilter === 'ALL' || category.code === categoryFilter)
          .map((category) => {
            const rows = filtered.filter((component) => component.category_code === category.code);
            return (
              <Card key={category.code}>
                <CardContent className="p-0">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50 px-4 py-3">
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-slate-800">
                        {category.name} <span className="font-normal text-slate-400">({rows.length})</span>
                      </p>
                      {category.description && <p className="mt-0.5 text-xs text-slate-500">{category.description}</p>}
                    </div>
                    {canManage && (
                      <Button size="sm" variant="ghost" onClick={() => openCreate(category.code)} className="no-print">
                        <Plus className="h-3.5 w-3.5" /> Thêm vào nhóm
                      </Button>
                    )}
                  </div>
                  {rows.length === 0
                    ? <p className="px-4 py-5 text-center text-xs text-slate-400">Chưa có khoản nào trong nhóm này.</p>
                    : renderTable(rows)}
                </CardContent>
              </Card>
            );
          })
      ) : (
        <Card>
          <CardContent className="p-0">
            {renderTable(pageRows)}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-4 py-3 text-xs text-slate-500 no-print">
              <span>{(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} / {filtered.length} khoản</span>
              <div className="flex gap-1">
                <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>Trước</Button>
                <span className="px-2 py-2 font-semibold">{page}/{pageCount}</span>
                <Button size="sm" variant="outline" disabled={page >= pageCount} onClick={() => setPage(page + 1)}>Sau</Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {renderForm()}

      {/* --- Chi tiết khoản --- */}
      <Modal open={!!detail} onClose={() => setDetail(null)} title={detail?.name ?? ''} size="lg">
        {detail && (() => {
          const usage = usageOf(detail);
          const category = categoryByCode.get(detail.category_code);
          const std = standard.find((item) => item.code === detail.code);
          return (
            <div className="space-y-4">
              <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
                <Field label="Mã" value={<code className="font-mono text-indigo-700">{detail.code}</code>} />
                <Field label="Nhóm phân loại" value={category?.name ?? detail.category_code} />
                <Field label="Loại khoản" value={KIND_LABEL[detail.kind]} />
                <Field label="Tính chất" value={NATURE_LABEL[detail.nature]} />
                <Field label="Nguồn" value={detail.calc_source === 'ENGINE' ? 'Hệ thống tự tính — không gán được' : 'Gán theo mẫu khối / phòng / người'} />
                <Field label="Trạng thái" value={detail.is_active ? 'Kích hoạt' : 'Ngừng hoạt động'} />
                <Field label="Mức / tỷ lệ mặc định" value={Number(detail.default_amount)
                  ? detail.calc_type === 'PERCENT' ? `${Number(detail.default_amount)}%` : formatVND(Number(detail.default_amount)) : '—'} />
                <Field label="Chịu thuế TNCN / tính BHXH" value={`${detail.taxable ? 'Có' : 'Không'} / ${detail.insurable ? 'Có' : 'Không'}`} />
                {detail.tax_exempt_cap != null && <Field label="Ngưỡng miễn thuế" value={formatVND(Number(detail.tax_exempt_cap))} />}
                {detail.max_amount != null && <Field label="Trần số tiền" value={formatVND(Number(detail.max_amount))} />}
                {std && <Field label="Danh mục chuẩn" value={`Khoản số ${std.std_no}/26`} />}
                <Field label="Đang dùng" value={`${usage.people} nhân sự · ${usage.units} đơn vị · ${usage.templates} mẫu bảng lương`} />
              </dl>
              {detail.formula && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-900">
                  <p className="font-bold">Công thức mặc định (khoản cũ — chỉ đọc)</p>
                  <code className="mt-1 block break-words font-mono">{detail.formula}</code>
                  <p className="mt-1 leading-relaxed">Dùng khi mẫu khối / cơ chế không khai công thức riêng. Khai cách tính ở Công thức theo khối.</p>
                </div>
              )}
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Mô tả vai trò hạch toán</p>
                <p className="mt-1 whitespace-pre-line text-sm text-slate-700">{detail.note || 'Chưa có mô tả.'}</p>
              </div>
              {usage.people + usage.units + usage.templates === 0 && detail.calc_source !== 'ENGINE' && detail.is_active && (
                <p className="flex items-start gap-2 text-xs text-amber-700">
                  <TriangleAlert className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                  Chưa gán ở đâu — khoản chưa đi vào phiếu lương của ai.
                </p>
              )}
              {canManage && (
                <div className="flex justify-end gap-2">
                  {detail.calc_source !== 'ENGINE' && (
                    <Button variant="outline" onClick={() => void handleDelete(detail)}><Trash2 className="h-4 w-4" /> Xoá</Button>
                  )}
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

function Tag({ children, tone, icon }: { children: React.ReactNode; tone: 'violet' | 'indigo' | 'slate'; icon?: React.ReactNode }) {
  const tones = {
    violet: 'bg-violet-50 text-violet-700',
    indigo: 'bg-indigo-600 text-white',
    slate: 'bg-slate-100 text-slate-500',
  };
  return (
    <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold ${tones[tone]}`}>
      {icon}{children}
    </span>
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

function Toggle({ checked, onChange, label, hint }: {
  checked: boolean; onChange: (value: boolean) => void; label: string; hint: string;
}) {
  return (
    <label className="flex items-start gap-2.5 text-sm text-slate-700">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 h-4 w-4 flex-shrink-0 rounded border-slate-300" />
      <span>
        {label}
        <span className="block text-xs leading-relaxed text-slate-500">{hint}</span>
      </span>
    </label>
  );
}
