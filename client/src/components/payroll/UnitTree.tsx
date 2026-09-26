// ============================================================================
// Cây đơn vị cho phân hệ lương — cùng cách vẽ với KPI (`KpiSchemeBoard`).
// ----------------------------------------------------------------------------
// Phẳng hoá cây theo thứ tự cha → con, thụt lề theo độ sâu: cơ cấu khách hàng
// chỉ sâu ba cấp (Doanh nghiệp > Khối > Phòng ban, ENT-01), bày hết ra chọn
// thẳng nhanh hơn đi từng nấc. Đơn vị lấy thẳng từ Cơ cấu tổ chức, không khai
// lại ở đây.
// ============================================================================

import { Building2, ChevronRight } from 'lucide-react';
import type { OrganizationUnit } from '@/types';

export interface UnitRow {
  unit: OrganizationUnit;
  depth: number;
}

/** Duyệt cây từ gốc; `seen` chặn vòng cha-con nếu dữ liệu hỏng. */
export function flattenUnitTree(units: readonly OrganizationUnit[]): UnitRow[] {
  const active = units.filter((unit) => unit.is_active);
  const ids = new Set(active.map((unit) => unit.id));
  const rows: UnitRow[] = [];
  const seen = new Set<string>();
  const walk = (parentId: string | null, depth: number) => {
    const children = active
      .filter((unit) => (unit.parent_id && ids.has(unit.parent_id) ? unit.parent_id : null) === parentId)
      .sort((a, b) => a.name.localeCompare(b.name, 'vi'));
    for (const unit of children) {
      if (seen.has(unit.id) || depth > 10) continue;
      seen.add(unit.id);
      rows.push({ unit, depth });
      walk(unit.id, depth + 1);
    }
  };
  walk(null, 0);
  return rows;
}

const TYPE_LABEL: Record<string, string> = {
  group: 'Tập đoàn', company: 'Doanh nghiệp', branch: 'Khối / chi nhánh', department: 'Phòng ban', team: 'Bộ phận',
};

export function UnitTreeList({
  rows, selectedId, onSelect, badge, meta,
}: {
  rows: UnitRow[];
  selectedId: string | null;
  onSelect: (unit: OrganizationUnit) => void;
  /** Nhãn nhỏ bên phải (ví dụ mẫu BL đang áp). */
  badge?: (unit: OrganizationUnit) => React.ReactNode;
  /** Dòng phụ dưới tên (ví dụ số nhân sự). */
  meta?: (unit: OrganizationUnit) => React.ReactNode;
}) {
  if (rows.length === 0) {
    return (
      <p className="px-4 py-6 text-center text-xs leading-relaxed text-slate-500">
        Chưa dựng cơ cấu tổ chức. Tạo đơn vị ở <strong>Cơ cấu tổ chức</strong> rồi quay lại.
      </p>
    );
  }
  return (
    <div role="tree">
      {rows.map(({ unit, depth }) => {
        const selected = unit.id === selectedId;
        return (
          <button
            key={unit.id}
            type="button"
            role="treeitem"
            aria-selected={selected}
            onClick={() => onSelect(unit)}
            className={`flex w-full items-center gap-2 py-2 pr-3 text-left transition ${
              selected ? 'bg-indigo-50' : 'hover:bg-indigo-50/50'
            }`}
            style={{ paddingLeft: `${12 + depth * 18}px` }}
          >
            {depth > 0 && <span aria-hidden className="h-px w-2.5 shrink-0 bg-slate-300" />}
            <Building2 className={`h-4 w-4 shrink-0 ${selected ? 'text-indigo-600' : 'text-slate-400'}`} />
            <span className="min-w-0 flex-1">
              <span className={`block truncate text-sm ${selected ? 'font-bold text-indigo-800' : 'font-semibold text-slate-800'}`}>
                {unit.name}
              </span>
              <span className="block truncate text-[11px] text-slate-400">
                {TYPE_LABEL[unit.unit_type] ?? unit.unit_type}
                {meta && <> · {meta(unit)}</>}
              </span>
            </span>
            {badge?.(unit)}
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-300" />
          </button>
        );
      })}
    </div>
  );
}
