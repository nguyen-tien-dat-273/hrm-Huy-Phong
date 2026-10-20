// ============================================================================
// Hộp thoại xem giá trị & chỉnh sửa công thức ô bảng lương.
// ----------------------------------------------------------------------------
// Khi bấm vào một ô trên bảng lương:
// - Hiển thị giá trị hiện tại và diễn giải tính toán.
// - Hiển thị nguồn công thức (Cơ chế chung của đơn vị vs Khai riêng).
// - Cho phép chỉnh sửa công thức: nếu đang là công thức chung chưa khai riêng,
//   khi lưu sẽ TỰ ĐỘNG tạo bản khai riêng cho nhân sự này mà không ảnh hưởng người khác.
// - Nếu đã có khai riêng, cho phép khôi phục về công thức chung của đơn vị.
// ============================================================================

import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Info, RotateCcw, Save } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { FormulaInput } from '@/components/payroll/formula/FormulaInput';
import { parseAmountText, formulaScopeOf } from '@/components/payroll/schemeWorkbench';
import { buildFormulaEntries } from '@/lib/formulaEntries';
import { versionForMonth } from '@/lib/payrollSettings';
import { personalItemsAt } from '@/lib/payrollScheme';
import { saveScheme, type PayrollWorkspace } from '@/lib/payrollData';
import { formatFormulaNumber } from '@/lib/formulaTokens';
import { formatVND } from '@/lib/utils';
import { useToast } from '@/contexts/ToastContext';
import { useConfirm } from '@/contexts/ConfirmContext';
import type { ComputedPayslip, MechanismRow } from '@/lib/payroll';
import type { PayrollParams } from '@/lib/payrollSettings';
import type { PayComponentKind, Profile, SchemePayloadItem } from '@/types';

interface PayrollRowContext {
  profile: Profile;
  computed: ComputedPayslip;
  hasScheme: boolean;
  mechanism: string | null;
  mechanismRows?: MechanismRow[];
}

interface ItemColumnContext {
  code: string;
  name: string;
  kind: PayComponentKind;
}

interface CellFormulaModalProps {
  open: boolean;
  onClose: () => void;
  row: PayrollRowContext | null;
  column: ItemColumnContext | null;
  data: PayrollWorkspace;
  params: PayrollParams | null;
  monthStartStr: string;
  monthEndStr: string;
  monthLabel: string;
  canManage: boolean;
  readOnly?: boolean;
  onChanged: () => void;
}

export function CellFormulaModal({
  open,
  onClose,
  row,
  column,
  data,
  params,
  monthStartStr,
  monthEndStr,
  monthLabel,
  canManage,
  readOnly: readOnlyProp,
  onChanged,
}: CellFormulaModalProps) {
  const readOnly = readOnlyProp ?? !canManage;
  const { toast } = useToast();
  const confirm = useConfirm();

  const component = useMemo(
    () => (column ? data.components.find((c) => c.code === column.code) ?? null : null),
    [column, data.components],
  );

  const line = useMemo(
    () => (row && column ? row.computed.lines.find((l) => l.code === column.code) ?? null : null),
    [row, column],
  );

  const mRow = useMemo(
    () => (row && column ? row.mechanismRows?.find((r) => r.component.code === column.code) ?? null : null),
    [row, column],
  );

  const personalItems = useMemo(
    () => (row ? personalItemsAt(data.items, row.profile.id, monthStartStr, monthEndStr) : []),
    [data.items, monthEndStr, monthStartStr, row],
  );

  const personalItem = useMemo(
    () => (component ? personalItems.find((it) => it.component_id === component.id) ?? null : null),
    [component, personalItems],
  );

  const isPersonal = !!personalItem;

  const [kind, setKind] = useState<'FORMULA' | 'VALUE'>('FORMULA');
  const [formulaText, setFormulaText] = useState('');
  const [saving, setSaving] = useState(false);

  // Khởi tạo công thức hoặc số tiền khi mở modal
  useEffect(() => {
    if (!open || !component) return;

    if (personalItem) {
      if (personalItem.formula?.trim()) {
        setKind('FORMULA');
        setFormulaText(personalItem.formula);
      } else if (personalItem.amount != null) {
        setKind('VALUE');
        setFormulaText(String(personalItem.amount));
      } else {
        setKind('FORMULA');
        setFormulaText('');
      }
    } else if (mRow) {
      if (mRow.mode === 'FORMULA' && mRow.formula) {
        setKind('FORMULA');
        setFormulaText(mRow.formula);
      } else if (mRow.amount != null) {
        setKind('VALUE');
        setFormulaText(String(mRow.amount));
      } else {
        setKind('FORMULA');
        setFormulaText(mRow.formula ?? '');
      }
    } else if (line) {
      setKind('VALUE');
      setFormulaText(line.amount != null ? String(line.amount) : '');
    } else {
      setKind('FORMULA');
      setFormulaText('');
    }
  }, [open, component, personalItem, mRow, line]);

  const version = useMemo(() => versionForMonth(data.paramVersions, monthStartStr), [data.paramVersions, monthStartStr]);

  const entries = useMemo(() => {
    if (!row || !column) return [];
    return buildFormulaEntries({
      rowComponents: (row.mechanismRows ?? []).map((r) => r.component),
      catalog: data.components,
      version,
      sampleValues: row.computed.values,
      excludeCode: column.code,
      includeCatalog: true,
    });
  }, [column, data.components, row, version]);

  const scope = useMemo(() => {
    if (!row) return {};
    return formulaScopeOf(data.components, params, row.computed);
  }, [data.components, params, row]);

  if (!open || !row || !column || !component) return null;

  const currentValue = line?.amount ?? 0;
  const currentDetail = line?.detail || '';

  const handleSave = async () => {
    if (!canManage) {
      toast('Bạn không có quyền chỉnh sửa cơ chế lương.', 'warning');
      return;
    }

    setSaving(true);
    let amount: number | null = null;
    let formula: string | null = null;

    if (kind === 'VALUE') {
      amount = parseAmountText(formulaText);
      formula = null;
      if (amount == null || amount < 0) {
        setSaving(false);
        toast('Vui lòng nhập số tiền hợp lệ.', 'warning');
        return;
      }
    } else {
      formula = formulaText.trim();
      amount = null;
      if (!formula) {
        setSaving(false);
        toast('Vui lòng nhập công thức tính.', 'warning');
        return;
      }
    }

    const newItem: SchemePayloadItem = {
      component_id: component.id,
      amount,
      formula,
    };

    // Tự động add thêm khai riêng vào cho họ nếu đang là công thức chung
    let nextItems: SchemePayloadItem[];
    const existingIndex = personalItems.findIndex((it) => it.component_id === component.id);
    if (existingIndex >= 0) {
      nextItems = personalItems.map((it, idx) => (idx === existingIndex ? newItem : it));
    } else {
      nextItems = [...personalItems, newItem];
    }

    const error = await saveScheme({
      targetType: 'USER',
      userId: row.profile.id,
      unitId: null,
      effectiveFrom: monthStartStr,
      items: nextItems,
      note: `Chỉnh sửa công thức cột ${component.name} từ bảng lương tháng ${monthLabel}`,
    });

    setSaving(false);
    if (error) {
      toast('Không lưu được: ' + error, 'error');
      return;
    }

    toast(
      isPersonal
        ? `Đã cập nhật công thức cho ${row.profile.name}.`
        : `Đã tự động tạo khai riêng cho ${row.profile.name}.`,
      'success',
    );
    onChanged();
    onClose();
  };

  const handleRevertToCommon = async () => {
    if (!isPersonal) return;
    const ok = await confirm({
      title: `Bỏ khai riêng cột ${component.name}?`,
      message: `${row.profile.name} sẽ quay lại áp dụng theo cơ chế chung của đơn vị. Các cấu hình riêng khác của người này vẫn được giữ nguyên.`,
      confirmLabel: 'Khôi phục mức chung',
    });
    if (!ok) return;

    setSaving(true);
    const nextItems = personalItems.filter((it) => it.component_id !== component.id);
    const error = await saveScheme({
      targetType: 'USER',
      userId: row.profile.id,
      unitId: null,
      effectiveFrom: monthStartStr,
      items: nextItems,
      note: `Bỏ khai riêng cột ${component.name} từ bảng lương tháng ${monthLabel}`,
    });
    setSaving(false);

    if (error) {
      toast('Không thể khôi phục: ' + error, 'error');
      return;
    }

    toast(`Đã huỷ khai riêng cho ${row.profile.name}, áp dụng lại cơ chế chung.`, 'success');
    onChanged();
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`${component.name} — ${row.profile.name}`}
      size="lg"
      square
    >
      <div className="space-y-4">
        {/* Thông tin giá trị hiện tại & nguồn */}
        <div className="flex flex-wrap items-center justify-between gap-3 border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80 px-4 py-3">
          <div>
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Giá trị tính ra:</span>{' '}
            <span className="text-lg font-bold text-slate-900 dark:text-slate-100">
              {formatFormulaNumber(currentValue)} <span className="text-xs font-normal text-slate-500 dark:text-slate-400">đ</span>
            </span>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Nguồn áp dụng:</span>
            <span
              className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 text-xs font-semibold rounded-full ${
                isPersonal ? 'bg-amber-100 dark:bg-amber-950/60 text-amber-900 dark:text-amber-300 border border-amber-300 dark:border-amber-700/60' : 'bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-200 border border-slate-300 dark:border-slate-600'
              }`}
            >
              {isPersonal ? (
                <>
                  <CheckCircle2 className="h-3.5 w-3.5 text-amber-700 dark:text-amber-400" /> Khai riêng cho nhân sự
                </>
              ) : (
                <>
                  <Info className="h-3.5 w-3.5 text-slate-600 dark:text-slate-400" /> Cơ chế chung ({mRow?.origin ?? 'Đơn vị'})
                </>
              )}
            </span>
          </div>
        </div>

        {currentDetail && (
          <div className="border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs">
            <span className="font-semibold text-slate-600 dark:text-slate-400">Diễn giải phép tính: </span>
            <code className="text-indigo-700 dark:text-indigo-400 font-mono font-medium">{currentDetail}</code>
          </div>
        )}

        {/* Phần chỉnh sửa / hiển thị công thức / số tiền */}
        <div className="border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-800 pb-2.5">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
              {readOnly ? 'Cách tính đang áp dụng' : 'Chỉnh sửa cách tính'}
            </span>
            {!readOnly && (
              <div className="flex rounded-lg border border-slate-300 dark:border-slate-700 p-0.5 text-xs">
                <button
                  type="button"
                  onClick={() => setKind('FORMULA')}
                  className={`px-3 py-1 font-semibold transition ${
                    kind === 'FORMULA' ? 'bg-indigo-600 text-white rounded' : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  Công thức
                </button>
                <button
                  type="button"
                  onClick={() => setKind('VALUE')}
                  className={`px-3 py-1 font-semibold transition ${
                    kind === 'VALUE' ? 'bg-indigo-600 text-white rounded' : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  Số tiền cố định (VND)
                </button>
              </div>
            )}
          </div>

          {readOnly ? (
            <div className="space-y-2">
              <div className="rounded border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 p-3 font-mono text-sm text-slate-800 dark:text-slate-200">
                {kind === 'FORMULA' ? (
                  formulaText ? formulaText : '—'
                ) : (
                  <span>
                    {parseAmountText(formulaText) != null
                      ? `${formatVND(parseAmountText(formulaText) ?? 0)} (${formulaText})`
                      : formulaText || '—'}
                  </span>
                )}
              </div>
            </div>
          ) : kind === 'FORMULA' ? (
            <div className="space-y-2">
              <FormulaInput
                value={formulaText}
                onChange={setFormulaText}
                entries={entries}
                scope={scope}
                functions={params?.functions}
                leftLabel={component.name}
                autoFocus
              />
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  inputMode="decimal"
                  value={formulaText}
                  onChange={(e) => setFormulaText(e.target.value.replace(/[^\d.,]/g, ''))}
                  placeholder="Nhập số tiền (VND), vd: 15.000.000"
                  className="h-10 w-full border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 text-sm font-semibold tabular-nums text-slate-800 dark:text-slate-100 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
                />
                <span className="shrink-0 text-sm font-semibold text-slate-600 dark:text-slate-400">VNĐ</span>
              </div>
              {parseAmountText(formulaText) != null && (
                <p className="text-xs font-medium text-indigo-700 dark:text-indigo-400">
                  Đọc là: {formatVND(parseAmountText(formulaText) ?? 0)}
                </p>
              )}
            </div>
          )}
        </div>

        {readOnly && (
          <p className="rounded border border-amber-200 dark:border-amber-800/60 bg-amber-50 dark:bg-amber-950/40 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
            Kỳ lương đã khoá / phát hành — chỉ xem công thức và diễn giải, không thể chỉnh sửa cơ chế.
          </p>
        )}

        {/* Footer actions */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 dark:border-slate-800 pt-3">
          <div>
            {!readOnly && isPersonal && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => void handleRevertToCommon()}
                disabled={saving}
                className="text-red-600 dark:text-rose-400 hover:bg-red-50 dark:hover:bg-rose-950/30 hover:text-red-700 dark:hover:text-rose-300"
              >
                <RotateCcw className="h-4 w-4" /> Dùng lại công thức chung
              </Button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
              {readOnly ? 'Đóng' : 'Huỷ'}
            </Button>
            {!readOnly && (
              <Button type="button" onClick={() => void handleSave()} disabled={saving || !formulaText.trim()}>
                <Save className="h-4 w-4" /> {saving ? 'Đang lưu…' : 'Lưu công thức'}
              </Button>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
