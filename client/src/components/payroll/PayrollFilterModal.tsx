// ============================================================================
// Hộp thoại tuỳ chỉnh bộ lọc & hiển thị các đầu mục trên bảng lương.
// ----------------------------------------------------------------------------
// Gom:
// - Lọc theo phòng ban (unitFilter)
// - Bỏ dòng trung gian (hideIntermediate)
// - Tìm kiếm danh mục / cột (searchTerm)
// - Bật / tắt hiển thị từng đầu mục / nhóm đầu mục (hiddenColumnCodes)
// ============================================================================

import { useMemo, useState } from 'react';
import {
  Building2, Check, CheckSquare, CircleAlert, Filter, ListChecks, RotateCcw, Search, SlidersHorizontal, Square, X,
} from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Dropdown } from '@/components/ui/Dropdown';
import { KindChip } from '@/components/payroll/KindChip';
import { normalizeText } from '@/lib/formulaTokens';
import type { OrganizationUnit, PayComponentCategory, PayComponentKind } from '@/types';

export interface ItemColumn {
  code: string;
  name: string;
  kind: PayComponentKind;
  categoryCode?: string | null;
}

interface PayrollFilterModalProps {
  open: boolean;
  onClose: () => void;
  units: OrganizationUnit[];
  unitFilter: string;
  onUnitFilterChange: (unitId: string) => void;
  hideIntermediate: boolean;
  onHideIntermediateChange: (hide: boolean) => void;
  columns: ItemColumn[];
  hiddenColumnCodes: Set<string>;
  onToggleColumn: (code: string) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onReset: () => void;
  onSelectOnly: (codes: string[]) => void;
  onSelectGroup: (codes: string[], select: boolean) => void;
  onResetAll: () => void;
  categories: PayComponentCategory[];
}

export function PayrollFilterModal({
  open,
  onClose,
  units,
  unitFilter,
  onUnitFilterChange,
  hideIntermediate,
  onHideIntermediateChange,
  columns,
  hiddenColumnCodes,
  onToggleColumn,
  onSelectAll,
  onDeselectAll,
  onReset,
  onSelectOnly,
  onSelectGroup,
  onResetAll,
  categories,
}: PayrollFilterModalProps) {
  const [searchTerm, setSearchTerm] = useState('');

  const categoryNameMap = useMemo(() => new Map<string, string>(categories.map((c) => [c.code, c.name])), [categories]);

  // Lọc danh sách cột theo từ khoá tìm kiếm
  const query = normalizeText(searchTerm.trim());
  const searchedColumns = useMemo(() => {
    if (!query) return columns;
    return columns.filter((col) => {
      const cat = col.categoryCode ? (categoryNameMap.get(col.categoryCode) ?? '') : '';
      return normalizeText(`${col.name} ${col.code} ${cat}`).includes(query);
    });
  }, [categoryNameMap, columns, query]);

  // Gom nhóm theo Loại đầu mục: Khoản cộng, Khoản trừ, Dòng trung gian
  const groups = useMemo(() => {
    const earnings = searchedColumns.filter((col) => col.kind === 'EARNING');
    const deductions = searchedColumns.filter((col) => col.kind === 'DEDUCTION');
    const info = searchedColumns.filter((col) => col.kind === 'INFO');
    const others = searchedColumns.filter(
      (col) => col.kind !== 'EARNING' && col.kind !== 'DEDUCTION' && col.kind !== 'INFO',
    );

    return [
      { key: 'EARNING' as const, label: 'Khoản cộng (Thu nhập)', kind: 'EARNING' as const, items: earnings, badgeColor: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' },
      { key: 'DEDUCTION' as const, label: 'Khoản trừ (Khấu trừ)', kind: 'DEDUCTION' as const, items: deductions, badgeColor: 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300' },
      { key: 'INFO' as const, label: 'Dòng trung gian (Thông tin tính)', kind: 'INFO' as const, items: info, badgeColor: 'bg-slate-200 text-slate-800 dark:bg-slate-800 dark:text-slate-300' },
      ...(others.length > 0 ? [{ key: 'OTHER' as const, label: 'Mục khác', kind: others[0].kind, items: others, badgeColor: 'bg-slate-100 text-slate-700' }] : []),
    ];
  }, [searchedColumns]);

  const totalVisibleCount = useMemo(
    () => columns.filter((col) => !hiddenColumnCodes.has(col.code)).length,
    [columns, hiddenColumnCodes],
  );

  return (
    <Modal square open={open} onClose={onClose} title="Tùy chỉnh" size="xl">
      <div className="space-y-5">
        {/* ===================== KHỐI 1: BỘ LỌC CƠ BẢN ===================== */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-900/60">
          {/* Lọc phòng ban */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 flex items-center gap-1.5">
              <Building2 className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
              Lọc theo phòng ban
            </label>
            <Dropdown
              aria-label="Lọc theo phòng ban"
              value={unitFilter}
              searchable
              options={[
                { value: '', label: 'Tất cả phòng ban' },
                ...units.filter((unit) => unit.is_active).map((unit) => ({ value: unit.id, label: unit.name })),
              ]}
              onChange={(value) => onUnitFilterChange(value)}
            />
            <p className="text-[11px] text-slate-400 dark:text-slate-500">
              Chỉ hiển thị các nhân sự thuộc phòng ban được chọn.
            </p>
          </div>

          {/* Bỏ dòng trung gian */}
          <div className="space-y-1.5">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 flex items-center gap-1.5">
              <Filter className="h-3.5 w-3.5 text-amber-500" />
              Dòng trung gian (INFO)
            </span>
            <label
              className={`flex items-start gap-3 p-2.5 rounded-xl border cursor-pointer transition select-none ${
                hideIntermediate
                  ? 'border-amber-400/80 bg-amber-50/70 dark:bg-amber-950/30 dark:border-amber-700/80'
                  : 'border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 hover:border-slate-400'
              }`}
            >
              <input
                type="checkbox"
                checked={hideIntermediate}
                onChange={(e) => onHideIntermediateChange(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 dark:border-slate-600 dark:bg-slate-700"
              />
              <div className="flex-1">
                <span className="text-xs font-bold text-slate-900 dark:text-slate-100 block">
                  Bỏ các dòng trung gian
                </span>
                <span className="text-[11px] text-slate-500 dark:text-slate-400 block leading-tight mt-0.5">
                  Ẩn các dòng số liệu trung gian (lương cơ bản, phụ thuộc, đơn giá...) không trực tiếp vào thực nhận.
                </span>
              </div>
            </label>
          </div>
        </div>

        {/* ===================== KHỐI 2: CHỌN ĐẦU MỤC HIỂN THỊ ===================== */}
        <div className="space-y-3">
          {/* Tiêu đề & Thống kê */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <ListChecks className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                Cột hiển thị
              </h3>
              <span className="rounded-full bg-indigo-50 dark:bg-indigo-950/70 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 px-2 py-0.5 text-xs font-bold">
                {totalVisibleCount} / {columns.length}
              </span>
            </div>

            {/* Các nút thao tác nhanh */}
            <div className="flex items-center gap-1.5 text-xs">
              <button
                type="button"
                onClick={onSelectAll}
                className="px-2.5 py-1 font-semibold rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 transition"
              >
                Hiện tất cả
              </button>
              <button
                type="button"
                onClick={onDeselectAll}
                className="px-2.5 py-1 font-semibold rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 transition"
              >
                Ẩn tất cả
              </button>
              <button
                type="button"
                onClick={onReset}
                title="Khôi phục trạng thái hiển thị mặc định"
                className="px-2.5 py-1 font-semibold rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 transition"
              >
                Mặc định
              </button>
            </div>
          </div>

          {/* Thanh tìm kiếm danh mục / đầu mục */}
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Tìm danh mục, tên khoản lương hoặc mã cột (VD: L01, ăn trưa, BHXH)..."
              aria-label="Tìm kiếm đầu mục"
              className="h-9 w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 pl-9 pr-8 text-xs font-medium text-slate-800 dark:text-slate-200 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
            />
            {searchTerm && (
              <button
                type="button"
                onClick={() => setSearchTerm('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                title="Xoá từ khoá tìm kiếm"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Thanh công cụ phụ khi đang gõ tìm kiếm */}
          {query && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-indigo-50/70 dark:bg-indigo-950/40 border border-indigo-200/80 dark:border-indigo-800/80 px-3 py-1.5 text-xs">
              <span className="font-semibold text-indigo-900 dark:text-indigo-200">
                Tìm thấy <strong>{searchedColumns.length}</strong> đầu mục khớp với &ldquo;{searchTerm}&rdquo;
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => onSelectOnly(searchedColumns.map((c) => c.code))}
                  className="px-2 py-0.5 rounded bg-indigo-600 text-white font-bold hover:bg-indigo-700 transition"
                >
                  Chỉ hiện các mục này
                </button>
                <button
                  type="button"
                  onClick={() => onSelectGroup(searchedColumns.map((c) => c.code), true)}
                  className="px-2 py-0.5 rounded border border-indigo-300 dark:border-indigo-700 bg-white dark:bg-slate-800 text-indigo-700 dark:text-indigo-300 font-bold hover:bg-indigo-50 transition"
                >
                  Bật các mục này
                </button>
                <button
                  type="button"
                  onClick={() => onSelectGroup(searchedColumns.map((c) => c.code), false)}
                  className="px-2 py-0.5 rounded border border-indigo-300 dark:border-indigo-700 bg-white dark:bg-slate-800 text-rose-600 dark:text-rose-400 font-bold hover:bg-rose-50 transition"
                >
                  Tắt các mục này
                </button>
              </div>
            </div>
          )}

          {/* Danh sách các đầu mục theo nhóm */}
          <div className="max-h-[360px] overflow-y-auto space-y-4 pr-1 rounded-xl border border-slate-200 dark:border-slate-800 p-3 bg-white dark:bg-slate-900">
            {searchedColumns.length === 0 ? (
              <div className="py-10 text-center text-sm font-medium text-slate-400 dark:text-slate-500">
                Không tìm thấy đầu mục nào khớp với &ldquo;{searchTerm}&rdquo;.
              </div>
            ) : (
              groups.map((group) => {
                if (group.items.length === 0) return null;
                const groupVisibleCount = group.items.filter((col) => !hiddenColumnCodes.has(col.code)).length;
                const allGroupChecked = groupVisibleCount === group.items.length;

                return (
                  <div key={group.key} className="space-y-2">
                    {/* Header của nhóm */}
                    <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-1.5">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                          {group.label}
                        </span>
                        <span className={`text-[10px] font-black px-1.5 py-0.5 rounded ${group.badgeColor}`}>
                          {groupVisibleCount} / {group.items.length}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-[11px]">
                        <button
                          type="button"
                          onClick={() => onSelectGroup(group.items.map((c) => c.code), !allGroupChecked)}
                          className="font-semibold text-indigo-600 dark:text-indigo-400 hover:underline"
                        >
                          {allGroupChecked ? 'Bỏ chọn nhóm' : 'Chọn cả nhóm'}
                        </button>
                      </div>
                    </div>

                    {/* Cảnh báo riêng cho dòng trung gian khi đang bật "Bỏ dòng trung gian" */}
                    {group.key === 'INFO' && hideIntermediate && (
                      <div className="flex items-center gap-2 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/80 px-2.5 py-1.5 text-[11px] text-amber-800 dark:text-amber-300">
                        <CircleAlert className="h-3.5 w-3.5 shrink-0" />
                        <span>
                          Dòng trung gian hiện đang bị ẩn trên bảng lương do bạn đã bật tuỳ chọn &ldquo;Bỏ các dòng trung gian&rdquo; ở trên.
                        </span>
                      </div>
                    )}

                    {/* Lưới các cột trong nhóm */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {group.items.map((col) => {
                        const isVisible = !hiddenColumnCodes.has(col.code);
                        const categoryName = col.categoryCode ? categoryNameMap.get(col.categoryCode) : null;

                        return (
                          <label
                            key={col.code}
                            className={`flex items-center gap-2.5 p-2 rounded-lg border cursor-pointer transition select-none ${
                              isVisible
                                ? 'border-indigo-200/90 dark:border-indigo-900 bg-indigo-50/30 dark:bg-indigo-950/20 hover:border-indigo-400'
                                : 'border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/40 opacity-70 hover:opacity-100 hover:border-slate-300'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={isVisible}
                              onChange={() => onToggleColumn(col.code)}
                              className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 dark:border-slate-600 dark:bg-slate-700"
                            />
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-bold text-slate-800 dark:text-slate-100 truncate" title={col.name}>
                                {col.name}
                              </p>
                              <p className="text-[10px] text-slate-400 dark:text-slate-500 font-mono truncate">
                                {col.code}
                                {categoryName && <span className="font-sans"> · {categoryName}</span>}
                              </p>
                            </div>
                            <KindChip kind={col.kind} />
                          </label>
                        );
                      })}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* ===================== KHỐI 3: NÚT THAO TÁC DƯỚI ===================== */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-200 dark:border-slate-800">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onResetAll}
            className="text-xs gap-1.5 border-slate-300 dark:border-slate-700"
          >
            <RotateCcw className="h-3.5 w-3.5" /> Đặt lại tất cả bộ lọc
          </Button>

          <Button type="button" variant="primary" size="sm" onClick={onClose} className="px-5">
            Xong
          </Button>
        </div>
      </div>
    </Modal>
  );
}
