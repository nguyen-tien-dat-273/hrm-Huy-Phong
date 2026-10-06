// ============================================================================
// Danh mục khoản lương của công ty.
// ----------------------------------------------------------------------------
// Đây chỉ là danh mục tham chiếu: tên khoản, loại, nhóm và mô tả. Cơ chế tính
// được quản lý ở các luồng nghiệp vụ tương ứng, không bày trong danh mục.
// ============================================================================

import { useMemo, useState } from 'react';
import { Lock, Pencil, Plus, Trash2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input, Select, Textarea } from '@/components/ui/Input';
import { useToast } from '@/contexts/ToastContext';
import { useConfirm } from '@/contexts/ConfirmContext';
import { deleteComponent, saveComponent } from '@/lib/payrollData';
import type { PayCalcType, PayComponent, PayComponentKind } from '@/types';

const KIND_LABEL: Record<PayComponentKind, string> = {
  EARNING: 'Khoản cộng',
  DEDUCTION: 'Khoản trừ',
  EMPLOYER_COST: 'Chi phí doanh nghiệp',
};

interface ComponentCatalogProps {
  components: PayComponent[];
  onChanged: () => void;
}

interface Draft {
  id?: string;
  code: string;
  name: string;
  kind: PayComponentKind;
  calc_type: PayCalcType;
  default_amount: string;
  input_code: string;
  base_code: string;
  formula: string;
  taxable: boolean;
  insurable: boolean;
  is_base: boolean;
  prorate: boolean;
  sort_order: string;
  group_name: string;
  ot_multiplier: string;
  tax_exempt_cap: string;
  max_amount: string;
  is_active: boolean;
  note: string;
}

/** Sinh mã hệ thống ổn định từ tên khoản, người dùng không cần tự khai. */
function codeFromName(name: string, taken: string[]): string {
  const base = name
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
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

/**
 * Gom cac khoan cung mot loai thanh cac nhom, giu nguyen thu tu sort_order.
 *
 * Khoan chua khai nhom xuong cuoi va khong co dong tieu de - de danh muc cu
 * (chua ai gom nhom) trong y het truoc day.
 */
function groupRows(items: PayComponent[]): { group: string | null; items: PayComponent[] }[] {
  const order: (string | null)[] = [];
  const buckets = new Map<string | null, PayComponent[]>();
  for (const item of items) {
    const key = item.group_name?.trim() || null;
    if (!buckets.has(key)) { buckets.set(key, []); order.push(key); }
    buckets.get(key)!.push(item);
  }
  return order
    .sort((a, b) => (a === null ? 1 : 0) - (b === null ? 1 : 0))
    .map((group) => ({ group, items: buckets.get(group)! }));
}

const BLANK: Draft = {
  code: '', name: '', kind: 'EARNING', calc_type: 'FIXED', default_amount: '0',
  input_code: '', base_code: '', formula: '', taxable: true, insurable: false, is_base: false,
  prorate: false, sort_order: '500', group_name: '', ot_multiplier: '',
  tax_exempt_cap: '', max_amount: '', is_active: true, note: '',
};

export function ComponentCatalog({ components, onChanged }: ComponentCatalogProps) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [quickAdd, setQuickAdd] = useState<{
    name: string;
    kind: PayComponentKind;
    group_name: string;
    note: string;
  } | null>(null);
  const [quickSaving, setQuickSaving] = useState(false);

  /** Cac nhom da dung, de goi y thay vi bat go lai va go lech chinh ta. */
  const knownGroups = useMemo(
    () => [...new Set(components.map((item) => item.group_name).filter(Boolean) as string[])].sort(),
    [components],
  );

  const grouped = useMemo(() => ({
    EARNING: components.filter((item) => item.kind === 'EARNING'),
    DEDUCTION: components.filter((item) => item.kind === 'DEDUCTION'),
    EMPLOYER_COST: components.filter((item) => item.kind === 'EMPLOYER_COST'),
  }), [components]);

  const openEdit = (component: PayComponent) => setDraft({
    id: component.id,
    code: component.code,
    name: component.name,
    kind: component.kind,
    calc_type: component.calc_type,
    default_amount: String(Number(component.default_amount)),
    input_code: component.input_code ?? '',
    base_code: component.base_code ?? '',
    formula: component.formula ?? '',
    taxable: component.taxable,
    insurable: component.insurable,
    is_base: component.is_base,
    prorate: component.prorate,
    sort_order: String(component.sort_order),
    group_name: component.group_name ?? '',
    ot_multiplier: component.ot_multiplier == null ? '' : String(Number(component.ot_multiplier)),
    tax_exempt_cap: component.tax_exempt_cap == null ? '' : String(Number(component.tax_exempt_cap)),
    max_amount: component.max_amount == null ? '' : String(Number(component.max_amount)),
    is_active: component.is_active,
    note: component.note ?? '',
  });

  const handleSave = async () => {
    if (!draft) return;
    const code = draft.code.trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9_]*$/.test(code)) {
      toast('Mã khoản phải viết hoa không dấu, bắt đầu bằng chữ. VD: BONUS_TET', 'warning');
      return;
    }
    if (!draft.name.trim()) {
      toast('Nhập tên khoản lương.', 'warning');
      return;
    }
    setSaving(true);
    const error = await saveComponent({
      ...(draft.id ? { id: draft.id } : {}),
      code,
      name: draft.name.trim(),
      kind: draft.kind,
      calc_type: draft.calc_type,
      default_amount: Number(draft.default_amount) || 0,
      input_code: draft.input_code.trim().toUpperCase() || null,
      base_code: draft.base_code.trim().toUpperCase() || null,
      formula: draft.formula.trim() || null,
      taxable: draft.taxable,
      insurable: draft.insurable,
      is_base: draft.is_base,
      prorate: draft.prorate,
      sort_order: Number(draft.sort_order) || 500,
      group_name: draft.group_name.trim() || null,
      ot_multiplier: draft.ot_multiplier ? Number(draft.ot_multiplier) : null,
      tax_exempt_cap: draft.tax_exempt_cap ? Number(draft.tax_exempt_cap) : null,
      max_amount: draft.max_amount ? Number(draft.max_amount) : null,
      is_active: draft.is_active,
      note: draft.note.trim() || null,
    });
    setSaving(false);

    if (error) {
      toast('Lưu khoản lương thất bại: ' + error, 'error');
      return;
    }
    toast(`Đã lưu khoản "${draft.name}".`, 'success');
    setDraft(null);
    onChanged();
  };

  /** Thêm một mục danh mục; các trường tính toán dùng mặc định an toàn. */
  const handleQuickSave = async (keepOpen: boolean) => {
    if (!quickAdd) return;
    const name = quickAdd.name.trim();
    if (name.length < 2) {
      toast('Nhập tên khoản lương.', 'warning');
      return;
    }
    const code = codeFromName(name, components.map((item) => item.code));
    // Xếp sau mọi khoản đang có: khoản khai sau thường tính trên khoản khai
    // trước, và người dùng có thể đổi lại ở form đầy đủ.
    const nextOrder = components.reduce((max, item) => Math.max(max, item.sort_order), 400) + 10;

    setQuickSaving(true);
    const error = await saveComponent({
      code,
      name,
      kind: quickAdd.kind,
      calc_type: 'FIXED',
      default_amount: 0,
      input_code: null,
      base_code: null,
      formula: null,
      taxable: quickAdd.kind === 'EARNING',
      insurable: false,
      is_base: false,
      prorate: false,
      sort_order: nextOrder,
      group_name: quickAdd.group_name.trim() || null,
      ot_multiplier: null,
      tax_exempt_cap: null,
      max_amount: null,
      is_active: true,
      note: quickAdd.note.trim() || null,
    });
    setQuickSaving(false);

    if (error) {
      toast('Lưu khoản lương thất bại: ' + error, 'error');
      return;
    }
    toast(`Đã thêm "${name}" vào danh mục.`, 'success');
    // Giữ lại loại và nhóm khi thêm liên tiếp nhiều mục cùng danh mục.
    if (keepOpen) setQuickAdd({ name: '', kind: quickAdd.kind, group_name: quickAdd.group_name, note: '' });
    else setQuickAdd(null);
    onChanged();
  };

  /**
   * Mở khoá một khoản hệ thống để xoá được.
   *
   * `is_system` chỉ là cờ ở giao diện — database không chặn gì. Khoá cứng thì
   * danh mục có những dòng công ty không dùng mà không bỏ đi được, trong khi
   * danh mục chính là thứ công ty tự quản. Nên cho mở, nhưng bắt xác nhận:
   * vài khoản hệ thống có mã mà luồng khác gọi tên (KPI, công đoàn), xoá xong
   * là luồng đó im lặng tính 0đ.
   */
  const handleUnlock = async (component: PayComponent) => {
    const ok = await confirm({
      title: `Mở khoá "${component.name}"?`,
      message:
        'Khoản hệ thống do phần mềm tạo sẵn. Một số khoản có mã được luồng khác '
        + 'gọi tới (KPI, công đoàn) — xoá rồi thì phần đó âm thầm tính 0đ. '
        + 'Mở khoá xong sẽ hiện nút xoá.',
      confirmLabel: 'Mở khoá',
    });
    if (!ok) return;

    const error = await saveComponent({
      id: component.id, code: component.code, name: component.name, is_system: false,
    });
    if (error) {
      toast('Mở khoá thất bại: ' + error, 'error');
      return;
    }
    toast('Đã mở khoá — bấm thùng rác để xoá.', 'success');
    onChanged();
  };

  const handleDelete = async (component: PayComponent) => {
    const ok = await confirm({
      title: `Xóa khoản "${component.name}"?`,
      message:
        'Mọi nhân sự đang được gán khoản này sẽ mất khoản đó ở các kỳ lương CHƯA chốt. ' +
        'Phiếu lương đã duyệt không đổi vì số liệu đã đóng băng.',
      confirmLabel: 'Xóa khoản',
      danger: true,
    });
    if (!ok) return;

    const error = await deleteComponent(component.id);
    if (error) {
      toast('Xóa thất bại: ' + error, 'error');
      return;
    }
    toast('Đã xóa khoản lương.', 'success');
    onChanged();
  };

  return (
    <div className="space-y-5">
      {/* Nam o goc chu khong trong modal: hai form deu tro toi id nay, ma
          modal nao mo thi modal kia dong - de trong mot modal thi form con
          lai tro vao mot datalist khong ton tai. */}
      <datalist id="pay-component-groups">
        {knownGroups.map((group) => <option key={group} value={group} />)}
      </datalist>

      <div className="flex flex-wrap items-start justify-between gap-3">
        {/* Tiêu đề và câu mô tả do TRANG in ra rồi (AdminPayroll, bảng
            TAB_INTRO) — in lại ở đây thành hai dòng tiêu đề giống nhau chồng
            nhau. Chỉ giữ lại lưu ý riêng của tab này. */}
        <p className="max-w-2xl text-sm leading-relaxed text-slate-500">
          Danh sách các khoản thu nhập, khấu trừ và chi phí của doanh nghiệp. Ghi chú ngắn giúp
          người sử dụng hiểu khoản này dùng trong trường hợp nào.
        </p>
        <Button onClick={() => setQuickAdd({ name: '', kind: 'EARNING', group_name: '', note: '' })}>
          <Plus className="h-4 w-4" /> Thêm khoản
        </Button>
      </div>

      {(['EARNING', 'DEDUCTION', 'EMPLOYER_COST'] as PayComponentKind[]).map((kind) => (
        <Card key={kind}>
          <CardContent className="p-0">
            <div className="border-b border-slate-100 bg-slate-50 px-5 py-3">
              <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                {KIND_LABEL[kind]} ({grouped[kind].length})
              </span>
            </div>
            {grouped[kind].length === 0 ? (
              <p className="px-5 py-6 text-center text-sm text-slate-400">Chưa có khoản nào.</p>
            ) : (
              <ul className="divide-y divide-slate-50">
                {groupRows(grouped[kind]).map(({ group, items }) => (
                  <li key={group ?? '__none__'}>
                    {/* Chi in dong tieu de nhom khi THUC SU co nhom. Danh muc
                        chua ai gom nhom van la mot danh sach phang nhu cu,
                        khong tu nhien moc them mot cap trong rong. */}
                    {group && (
                      <p className="bg-slate-50/70 px-5 py-1.5 text-[11px] font-bold text-slate-500">
                        {group}
                        <span className="ml-1.5 font-normal text-slate-400">({items.length})</span>
                      </p>
                    )}
                    <ul className="divide-y divide-slate-50">
                {items.map((component) => (
                  <li
                    key={component.id}
                    title={component.note ?? undefined}
                    className="flex items-start gap-3 px-5 py-3.5"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-bold text-slate-800">{component.name}</span>
                        {!component.is_active && (
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-400">
                            TẮT
                          </span>
                        )}
                        {/* Khoan luong goc phai nhan ra duoc ngay trong danh
                            sach: no quyet dinh don gia tang ca va muc dong bao
                            hiem, khong phai mot khoan nhu moi khoan. */}
                        {component.is_base && (
                          <span className="rounded bg-indigo-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
                            LƯƠNG GỐC
                          </span>
                        )}
                        {!component.taxable && kind === 'EARNING' && (
                          <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold text-emerald-600">
                            MIỄN THUẾ
                          </span>
                        )}
                        {component.insurable && (
                          <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-bold text-blue-600">
                            TÍNH BẢO HIỂM
                          </span>
                        )}
                      </div>
                      <p className={`mt-1 text-sm leading-relaxed ${component.note ? 'text-slate-500' : 'italic text-slate-400'}`}>
                        {component.note || 'Chưa có ghi chú mô tả.'}
                      </p>
                    </div>
                    <div className="flex flex-shrink-0 items-center gap-1">
                      <button
                        onClick={() => openEdit(component)}
                        className="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-indigo-50 hover:text-indigo-600"
                        aria-label={`Sửa ${component.name}`}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      {component.is_system ? (
                        <button
                          onClick={() => void handleUnlock(component)}
                          className="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-slate-300 transition-colors hover:bg-amber-50 hover:text-amber-600"
                          aria-label={`Mở khoá ${component.name}`}
                          title="Khoản hệ thống — bấm để mở khoá rồi xoá"
                        >
                          <Lock className="h-3.5 w-3.5" />
                        </button>
                      ) : (
                        <button
                          onClick={() => handleDelete(component)}
                          className="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600"
                          aria-label={`Xóa ${component.name}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </li>
                ))}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      ))}

      {/* ---- Thêm mục vào danh mục ---- */}
      <Modal
        open={!!quickAdd}
        onClose={() => setQuickAdd(null)}
        title="Thêm khoản lương"
        size="md"
      >
        {quickAdd && (
          <form
            className="space-y-4"
            onSubmit={(event) => { event.preventDefault(); void handleQuickSave(false); }}
          >
            <p className="rounded-xl border border-indigo-100 bg-indigo-50/60 px-3.5 py-2.5 text-xs leading-relaxed text-indigo-900">
              Thêm tên khoản và mô tả ngắn để mọi người hiểu thống nhất khi lựa chọn và sử dụng.
            </p>

            <Input
              label="Tên khoản"
              placeholder="VD: Phụ cấp xăng xe"
              value={quickAdd.name}
              onChange={(e) => setQuickAdd({ ...quickAdd, name: e.target.value })}
              autoFocus
            />

            <div className="grid gap-3 sm:grid-cols-2">
              <Select
                label="Loại"
                value={quickAdd.kind}
                onChange={(e) => setQuickAdd({ ...quickAdd, kind: e.target.value as PayComponentKind })}
              >
                {Object.entries(KIND_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </Select>
              <div>
                <Input
                  label="Nhóm (không bắt buộc)"
                  placeholder="VD: Phụ cấp"
                  list="pay-component-groups"
                  value={quickAdd.group_name}
                  onChange={(e) => setQuickAdd({ ...quickAdd, group_name: e.target.value })}
                />
                <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
                  Gom các khoản cùng chủ đề lại. Một loại lương thường có nhiều khoản nhỏ —
                  Phụ cấp có văn phòng, vận chuyển, công tác.
                </p>
              </div>
            </div>

            <Textarea
              label="Ghi chú / mô tả"
              placeholder="VD: Hỗ trợ chi phí đi lại hàng tháng cho nhân viên thường xuyên di chuyển."
              rows={3}
              value={quickAdd.note}
              onChange={(e) => setQuickAdd({ ...quickAdd, note: e.target.value })}
            />

            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setQuickAdd(null)} disabled={quickSaving}>
                Đóng
              </Button>
              {/* Liet ke thi it khi chi co mot khoan - giu form mo de go tiep. */}
              <Button type="button" variant="outline" onClick={() => void handleQuickSave(true)} disabled={quickSaving}>
                Lưu & thêm khoản nữa
              </Button>
              <Button type="submit" disabled={quickSaving}>
                {quickSaving ? 'Đang lưu…' : 'Lưu khoản'}
              </Button>
            </div>
          </form>
        )}
      </Modal>

      {/* ---- Sửa thông tin danh mục ---- */}
      <Modal
        open={!!draft}
        onClose={() => setDraft(null)}
        title="Sửa khoản lương"
        size="md"
      >
        {draft && (
          <div className="space-y-4">
            <Input
              label="Tên khoản"
              placeholder="VD: Thưởng doanh số quý"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />

            <div className="grid gap-3 sm:grid-cols-2">
              <Select
                label="Loại"
                value={draft.kind}
                onChange={(e) => setDraft({ ...draft, kind: e.target.value as PayComponentKind })}
              >
                {Object.entries(KIND_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </Select>
              <Input
                label="Nhóm (không bắt buộc)"
                placeholder="VD: Phụ cấp"
                list="pay-component-groups"
                value={draft.group_name}
                onChange={(e) => setDraft({ ...draft, group_name: e.target.value })}
              />
            </div>

            <div className="space-y-3 rounded-xl border border-slate-200 p-3.5">
              <Toggle
                checked={draft.is_active}
                onChange={(is_active) => setDraft({ ...draft, is_active })}
                label="Đang sử dụng"
                hint="Tắt để ẩn khỏi lựa chọn mới nhưng vẫn giữ lịch sử đã sử dụng."
              />
              {/* Chi MOT khoan trong ca danh muc duoc lam luong goc - database
                  co unique index chan. Noi ro hai thu phu thuoc vao no, vi do
                  moi la cho sai ma khong ai nhin thay. */}
              <Toggle
                checked={draft.is_base}
                onChange={(is_base) => setDraft({ ...draft, is_base })}
                label="Đây là khoản LƯƠNG GỐC"
                hint="Hệ thống lấy mức của khoản này làm căn cứ tính đơn giá giờ tăng ca và mức đóng bảo hiểm. Cả danh mục chỉ một khoản được bật."
              />
            </div>

            <Textarea
              label="Ghi chú / mô tả"
              placeholder="Mô tả mục đích và trường hợp áp dụng của khoản này."
              rows={4}
              value={draft.note}
              onChange={(e) => setDraft({ ...draft, note: e.target.value })}
            />

            <div className="flex gap-3 pt-1">
              <Button variant="outline" onClick={() => setDraft(null)} className="flex-1" disabled={saving}>
                Hủy
              </Button>
              <Button onClick={handleSave} className="flex-1" disabled={saving}>
                {saving ? 'Đang lưu…' : 'Lưu khoản'}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function Toggle({
  checked, onChange, label, hint,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  hint: string;
}) {
  return (
    <label className="flex items-start gap-2.5 text-sm text-slate-700">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 flex-shrink-0 rounded border-slate-300"
      />
      <span>
        {label}
        <span className="block text-xs leading-relaxed text-slate-500">{hint}</span>
      </span>
    </label>
  );
}
