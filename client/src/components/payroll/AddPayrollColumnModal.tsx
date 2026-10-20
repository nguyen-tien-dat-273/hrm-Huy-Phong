// ============================================================================
// Hộp thoại thêm danh mục / thêm cột vào bảng lương.
// ----------------------------------------------------------------------------
// Cho phép kế toán / admin:
// - Chọn một đầu mục có sẵn trong danh mục hoặc tạo một danh mục mới ngay tại đây.
// - Chọn phạm vi áp dụng: Toàn công ty, theo phòng ban hoặc theo nhân sự cụ thể.
// - Thiết lập cách tính (công thức, số tiền cố định, mức riêng từng người, số liệu tháng).
// - Lưu và cập nhật lại bảng lương ngay lập tức.
// ============================================================================

import { useMemo, useState } from 'react';
import { Columns3, Search } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Dropdown } from '@/components/ui/Dropdown';
import { KindChip } from '@/components/payroll/KindChip';
import { FormulaInput } from '@/components/payroll/formula/FormulaInput';
import { parseAmountText, formulaScopeOf } from '@/components/payroll/schemeWorkbench';
import { buildFormulaEntries } from '@/lib/formulaEntries';
import { versionForMonth, codeFromName } from '@/lib/payrollSettings';
import { unitItemsAt, personalItemsAt } from '@/lib/payrollScheme';
import { createComponent, saveScheme, type PayrollWorkspace } from '@/lib/payrollData';
import { normalizeText } from '@/lib/formulaTokens';
import { useToast } from '@/contexts/ToastContext';
import type { PayrollParams } from '@/lib/payrollSettings';
import type { PayComponentCategoryCode, PayComponentKind, SchemePayloadItem, UnitRowMode } from '@/types';

interface AddPayrollColumnModalProps {
  open: boolean;
  onClose: () => void;
  data: PayrollWorkspace;
  params: PayrollParams | null;
  monthStartStr: string;
  monthEndStr: string;
  monthLabel: string;
  currentUnitId?: string;
  onChanged: () => void;
}

export function AddPayrollColumnModal({
  open,
  onClose,
  data,
  params,
  monthStartStr,
  monthEndStr,
  monthLabel,
  currentUnitId,
  onChanged,
}: AddPayrollColumnModalProps) {
  const { toast } = useToast();

  const rootUnit = useMemo(
    () => data.units.find((u) => !u.parent_id) ?? data.units[0] ?? null,
    [data.units],
  );

  // Phạm vi áp dụng
  const [scopeType, setScopeType] = useState<'ALL' | 'UNIT' | 'USER'>(currentUnitId ? 'UNIT' : 'ALL');
  const [targetUnitId, setTargetUnitId] = useState<string>(currentUnitId || rootUnit?.id || '');
  const [targetUserId, setTargetUserId] = useState<string>(data.profiles[0]?.id || '');

  // Tab chọn có sẵn hay tạo mới
  const [sourceTab, setSourceTab] = useState<'CATALOG' | 'NEW'>('CATALOG');

  // Chọn từ catalog
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCompId, setSelectedCompId] = useState<string>('');

  // Tạo mới
  const [newName, setNewName] = useState('');
  const [newCode, setNewCode] = useState('');
  const [codeTouched, setCodeTouched] = useState(false);
  const [newKind, setNewKind] = useState<PayComponentKind>('EARNING');
  const [newCategoryCode, setNewCategoryCode] = useState<PayComponentCategoryCode | ''>('THU_NHAP_CO_DINH');

  // Cơ chế tính
  const [mode, setMode] = useState<UnitRowMode>('FORMULA');
  const [valueText, setValueText] = useState('');
  const [formulaText, setFormulaText] = useState('');
  const [busy, setBusy] = useState(false);

  const activeComponents = useMemo(
    () => data.components.filter((c) => c.is_active).sort((a, b) => a.sort_order - b.sort_order),
    [data.components],
  );

  const filteredComponents = useMemo(() => {
    if (!searchQuery.trim()) return activeComponents;
    const q = normalizeText(searchQuery);
    return activeComponents.filter((c) => normalizeText(`${c.name} ${c.code}`).includes(q));
  }, [activeComponents, searchQuery]);

  const selectedComponent = useMemo(
    () => activeComponents.find((c) => c.id === selectedCompId) ?? null,
    [activeComponents, selectedCompId],
  );

  const version = useMemo(() => versionForMonth(data.paramVersions, monthStartStr), [data.paramVersions, monthStartStr]);

  const entries = useMemo(() => {
    return buildFormulaEntries({
      rowComponents: activeComponents,
      catalog: data.components,
      version,
      sampleValues: {},
      excludeCode: sourceTab === 'CATALOG' ? selectedComponent?.code ?? '' : newCode,
      includeCatalog: true,
    });
  }, [activeComponents, data.components, newCode, selectedComponent?.code, sourceTab, version]);

  const formulaScope = useMemo(() => {
    return formulaScopeOf(data.components, params, null);
  }, [data.components, params]);

  if (!open) return null;

  const handleNameChange = (name: string) => {
    setNewName(name);
    if (!codeTouched) {
      setNewCode(codeFromName(name, data.components.map((c) => c.code), 'DAU_MUC'));
    }
  };

  const handleSave = async () => {
    setBusy(true);

    let compId = selectedCompId;
    let compName = selectedComponent?.name ?? '';

    // 1. Nếu tạo mới danh mục
    if (sourceTab === 'NEW') {
      if (!newName.trim() || !newCode.trim()) {
        setBusy(false);
        toast('Vui lòng nhập tên và mã danh mục.', 'warning');
        return;
      }

      // Kiểm tra trùng mã
      if (data.components.some((c) => c.code.toUpperCase() === newCode.trim().toUpperCase())) {
        setBusy(false);
        toast(`Mã "${newCode.trim().toUpperCase()}" đã tồn tại. Vui lòng chọn mã khác.`, 'warning');
        return;
      }

      const created = await createComponent({
        name: newName.trim(),
        code: newCode.trim().toUpperCase(),
        kind: newKind,
        category_code: newKind === 'INFO' ? null : (newCategoryCode || null),
        is_active: true,
        sort_order: 100,
        show_on_payslip: true,
      });

      if (created.error || !created.id) {
        setBusy(false);
        toast('Không thể tạo danh mục: ' + (created.error ?? 'Lỗi không xác định'), 'error');
        return;
      }

      compId = created.id;
      compName = newName.trim();
    } else {
      if (!compId) {
        setBusy(false);
        toast('Vui lòng chọn một danh mục.', 'warning');
        return;
      }
    }

    // 2. Chuẩn bị giá trị / công thức
    let amount: number | null = null;
    let formula: string | null = null;

    if (mode === 'VALUE') {
      amount = parseAmountText(valueText);
      if (amount == null || amount < 0) {
        setBusy(false);
        toast('Vui lòng nhập số tiền hợp lệ.', 'warning');
        return;
      }
    } else if (mode === 'FORMULA') {
      formula = formulaText.trim();
      if (!formula) {
        setBusy(false);
        toast('Vui lòng nhập công thức tính.', 'warning');
        return;
      }
    }

    // 3. Áp dụng vào đối tượng (Toàn công ty / Phòng ban / Nhân sự)
    if (scopeType === 'USER') {
      const userItems = personalItemsAt(data.items, targetUserId, monthStartStr, monthEndStr);
      const existingIdx = userItems.findIndex((it) => it.component_id === compId);
      const item: SchemePayloadItem = {
        component_id: compId,
        amount,
        formula,
      };
      const nextItems = existingIdx >= 0
        ? userItems.map((it, idx) => (idx === existingIdx ? item : it))
        : [...userItems, item];

      const error = await saveScheme({
        targetType: 'USER',
        userId: targetUserId,
        unitId: null,
        effectiveFrom: monthStartStr,
        items: nextItems,
        note: `Thêm cột ${compName} từ bảng lương tháng ${monthLabel}`,
      });

      setBusy(false);
      if (error) {
        toast('Không thể thêm cột: ' + error, 'error');
        return;
      }
    } else {
      const unitId = scopeType === 'ALL' ? (rootUnit?.id ?? targetUnitId) : targetUnitId;
      if (!unitId) {
        setBusy(false);
        toast('Chưa chọn đơn vị áp dụng.', 'warning');
        return;
      }

      const currentUnitItems = unitItemsAt(data.unitItems, unitId, monthStartStr, monthEndStr);
      const existingIdx = currentUnitItems.findIndex((it) => it.component_id === compId);
      const item: SchemePayloadItem = {
        component_id: compId,
        mode,
        amount,
        formula,
      };
      const nextItems = existingIdx >= 0
        ? currentUnitItems.map((it, idx) => (idx === existingIdx ? item : it))
        : [...currentUnitItems, item];

      const error = await saveScheme({
        targetType: 'UNIT',
        userId: null,
        unitId,
        effectiveFrom: monthStartStr,
        items: nextItems,
        note: `Thêm cột ${compName} từ bảng lương tháng ${monthLabel}`,
      });

      setBusy(false);
      if (error) {
        toast('Không thể thêm cột: ' + error, 'error');
        return;
      }
    }

    toast(`Đã thêm cột "${compName}" vào bảng lương.`, 'success');
    onChanged();
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Thêm danh mục / thêm cột vào bảng lương"
      size="xl"
      square
    >
      <div className="space-y-4">
        {/* Bước 1: Phạm vi áp dụng */}
        <div className="border border-slate-200 bg-[#FCFAF8] p-3.5 space-y-3 rounded-none">
          <label className="text-xs font-bold uppercase tracking-wider text-slate-600 block">
            1. Phạm vi áp dụng cột
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex items-center gap-2 text-sm font-semibold text-slate-800 cursor-pointer">
              <input
                type="radio"
                name="scopeType"
                checked={scopeType === 'ALL'}
                onChange={() => setScopeType('ALL')}
                className="text-indigo-600 focus:ring-indigo-500"
              />
              Toàn công ty ({rootUnit?.name ?? 'Chung'})
            </label>
            <label className="inline-flex items-center gap-2 text-sm font-semibold text-slate-800 cursor-pointer">
              <input
                type="radio"
                name="scopeType"
                checked={scopeType === 'UNIT'}
                onChange={() => setScopeType('UNIT')}
                className="text-indigo-600 focus:ring-indigo-500"
              />
              Theo phòng ban
            </label>
            <label className="inline-flex items-center gap-2 text-sm font-semibold text-slate-800 cursor-pointer">
              <input
                type="radio"
                name="scopeType"
                checked={scopeType === 'USER'}
                onChange={() => setScopeType('USER')}
                className="text-indigo-600 focus:ring-indigo-500"
              />
              Theo nhân sự cụ thể
            </label>
          </div>

          {scopeType === 'UNIT' && (
            <div className="w-full sm:w-72 pt-1">
              <Dropdown
                aria-label="Chọn phòng ban áp dụng"
                value={targetUnitId}
                searchable
                options={data.units.filter((u) => u.is_active).map((u) => ({ value: u.id, label: u.name }))}
                onChange={setTargetUnitId}
              />
            </div>
          )}

          {scopeType === 'USER' && (
            <div className="w-full sm:w-72 pt-1">
              <Dropdown
                aria-label="Chọn nhân sự áp dụng"
                value={targetUserId}
                searchable
                options={data.profiles.map((p) => ({
                  value: p.id,
                  label: `${p.name} ${p.employee_code ? `(${p.employee_code})` : ''}`,
                }))}
                onChange={setTargetUserId}
              />
            </div>
          )}
        </div>

        {/* Bước 2: Chọn danh mục hoặc tạo mới */}
        <div className="border border-slate-200 bg-white p-3.5 space-y-3 rounded-none">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
            <label className="text-xs font-bold uppercase tracking-wider text-slate-600">
              2. Chọn danh mục khoản lương
            </label>
            <div className="flex rounded-lg border border-slate-200 p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setSourceTab('CATALOG')}
                className={`px-3 py-1 font-semibold transition ${
                  sourceTab === 'CATALOG' ? 'bg-indigo-600 text-white rounded' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Chọn từ danh mục có sẵn
              </button>
              <button
                type="button"
                onClick={() => setSourceTab('NEW')}
                className={`px-3 py-1 font-semibold transition ${
                  sourceTab === 'NEW' ? 'bg-indigo-600 text-white rounded' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                + Tạo danh mục mới
              </button>
            </div>
          </div>

          {sourceTab === 'CATALOG' ? (
            <div className="space-y-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Tìm danh mục theo tên hoặc mã…"
                  className="h-10 w-full border border-slate-200 pl-9 pr-3 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
                />
              </div>

              <div className="max-h-48 overflow-y-auto divide-y divide-slate-100 border border-slate-200">
                {filteredComponents.length === 0 ? (
                  <p className="p-4 text-center text-xs text-slate-400">Không tìm thấy danh mục nào phù hợp.</p>
                ) : (
                  filteredComponents.map((comp) => {
                    const selected = comp.id === selectedCompId;
                    return (
                      <button
                        key={comp.id}
                        type="button"
                        onClick={() => setSelectedCompId(comp.id)}
                        className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-xs transition ${
                          selected ? 'bg-indigo-50 text-indigo-900 font-bold' : 'hover:bg-slate-50'
                        }`}
                      >
                        <div className="min-w-0">
                          <span className="font-semibold">{comp.name}</span>
                          <span className="ml-2 font-mono text-[10px] text-slate-400">[{comp.code}]</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <KindChip kind={comp.kind} />
                          {selected && <span className="text-indigo-600 font-bold">✓ Đã chọn</span>}
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="text-xs font-semibold text-slate-700 block mb-1">Tên danh mục *</label>
                  <input
                    value={newName}
                    onChange={(e) => handleNameChange(e.target.value)}
                    placeholder="VD: Phụ cấp trách nhiệm"
                    className="h-9 w-full border border-slate-200 px-3 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-700 block mb-1">Mã danh mục (tự sinh) *</label>
                  <input
                    value={newCode}
                    onChange={(e) => {
                      setNewCode(e.target.value.toUpperCase().replace(/\s+/g, '_'));
                      setCodeTouched(true);
                    }}
                    placeholder="VD: PC_TRACH_NHIEM"
                    className="h-9 w-full border border-slate-200 px-3 font-mono text-sm uppercase outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="text-xs font-semibold text-slate-700 block mb-1">Loại danh mục</label>
                  <Dropdown
                    aria-label="Loại danh mục"
                    value={newKind}
                    options={[
                      { value: 'EARNING', label: 'Khoản cộng (Thu nhập)' },
                      { value: 'DEDUCTION', label: 'Khoản trừ' },
                      { value: 'INFO', label: 'Dòng trung gian (không vào thực lĩnh)' },
                    ]}
                    onChange={(v) => setNewKind(v as PayComponentKind)}
                  />
                </div>
                {newKind !== 'INFO' && (
                  <div>
                    <label className="text-xs font-semibold text-slate-700 block mb-1">Nhóm danh mục</label>
                    <Dropdown
                      aria-label="Nhóm danh mục"
                      value={newCategoryCode}
                      options={[
                        ...data.categories.map((c) => ({ value: c.code, label: c.name })),
                        { value: '', label: 'Khác / Không phân nhóm' },
                      ]}
                      onChange={(v) => setNewCategoryCode(v as PayComponentCategoryCode)}
                    />
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Bước 3: Cách tính của cột này */}
        <div className="border border-slate-200 bg-white p-3.5 space-y-3 rounded-none">
          <label className="text-xs font-bold uppercase tracking-wider text-slate-600 block">
            3. Cách tính cho cột này
          </label>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <button
              type="button"
              onClick={() => setMode('FORMULA')}
              className={`border p-2.5 text-center transition ${
                mode === 'FORMULA'
                  ? 'border-indigo-600 bg-indigo-50 text-indigo-700 font-bold'
                  : 'border-slate-200 hover:bg-slate-50 text-slate-700'
              }`}
            >
              <span className="block text-xs font-semibold">Công thức</span>
              <span className="block text-[10px] text-slate-500 font-normal mt-0.5">Tự tính theo thẻ</span>
            </button>
            <button
              type="button"
              onClick={() => setMode('VALUE')}
              className={`border p-2.5 text-center transition ${
                mode === 'VALUE'
                  ? 'border-indigo-600 bg-indigo-50 text-indigo-700 font-bold'
                  : 'border-slate-200 hover:bg-slate-50 text-slate-700'
              }`}
            >
              <span className="block text-xs font-semibold">Số tiền cố định</span>
              <span className="block text-[10px] text-slate-500 font-normal mt-0.5">Số tiền VND chung</span>
            </button>
            <button
              type="button"
              onClick={() => setMode('PER_PERSON')}
              className={`border p-2.5 text-center transition ${
                mode === 'PER_PERSON'
                  ? 'border-indigo-600 bg-indigo-50 text-indigo-700 font-bold'
                  : 'border-slate-200 hover:bg-slate-50 text-slate-700'
              }`}
            >
              <span className="block text-xs font-semibold">Mỗi người một mức</span>
              <span className="block text-[10px] text-slate-500 font-normal mt-0.5">Khai riêng từng người</span>
            </button>
            <button
              type="button"
              onClick={() => setMode('MONTHLY_INPUT')}
              className={`border p-2.5 text-center transition ${
                mode === 'MONTHLY_INPUT'
                  ? 'border-indigo-600 bg-indigo-50 text-indigo-700 font-bold'
                  : 'border-slate-200 hover:bg-slate-50 text-slate-700'
              }`}
            >
              <span className="block text-xs font-semibold">Số liệu tháng</span>
              <span className="block text-[10px] text-slate-500 font-normal mt-0.5">Nhập tay hàng tháng</span>
            </button>
          </div>

          {mode === 'FORMULA' && (
            <div className="space-y-1.5 pt-1">
              <FormulaInput
                value={formulaText}
                onChange={setFormulaText}
                entries={entries}
                scope={formulaScope}
                functions={params?.functions}
                leftLabel={sourceTab === 'CATALOG' ? selectedComponent?.name : newName || 'Cột mới'}
              />
              <p className="text-[11px] text-slate-400">
                Gõ tên đầu mục, tham số, dấu cộng trừ nhân chia hoặc chọn từ danh sách gợi ý.
              </p>
            </div>
          )}

          {mode === 'VALUE' && (
            <div className="flex items-center gap-2 pt-1">
              <input
                type="text"
                inputMode="decimal"
                value={valueText}
                onChange={(e) => setValueText(e.target.value.replace(/[^\d.,]/g, ''))}
                placeholder="Nhập số tiền VND, vd: 1.500.000"
                className="h-10 w-full border border-slate-200 px-3 text-sm font-semibold tabular-nums text-slate-800 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
              />
              <span className="shrink-0 text-sm font-semibold text-slate-500">VNĐ</span>
            </div>
          )}

          {mode === 'PER_PERSON' && (
            <p className="text-xs text-slate-500 bg-slate-50 p-2.5 border border-slate-200">
              Cột này sẽ được tạo trên bảng lương. Bạn có thể bấm vào từng ô của nhân viên để nhập mức riêng cho từng người.
            </p>
          )}

          {mode === 'MONTHLY_INPUT' && (
            <p className="text-xs text-slate-500 bg-slate-50 p-2.5 border border-slate-200">
              Cột này là số liệu biến đổi theo tháng. Bạn có thể gõ trực tiếp vào ô trên bảng lương mỗi kỳ.
            </p>
          )}
        </div>

        {/* Footer actions */}
        <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-3">
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
            Huỷ
          </Button>
          <Button type="button" onClick={() => void handleSave()} disabled={busy}>
            <Columns3 className="h-4 w-4" /> {busy ? 'Đang thêm…' : 'Thêm cột vào bảng lương'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
