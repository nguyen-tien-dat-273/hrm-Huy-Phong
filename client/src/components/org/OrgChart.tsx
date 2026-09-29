// ============================================================================
// Sơ đồ tổ chức dạng cây từ trên xuống.
// ----------------------------------------------------------------------------
// Danh sách thụt lề đọc được quan hệ cha-con, nhưng không cho thấy hình dạng
// của bộ máy: ai ngang cấp với ai, một khối phình ra bao nhiêu nhánh. Đó là
// câu hỏi người xem cơ cấu tổ chức hỏi đầu tiên, nên cần một sơ đồ thật.
//
// Đường nối vẽ bằng border thuần, không SVG và không thư viện: cây tổ chức của
// khách chỉ vài chục node, kéo cả một thư viện đồ thị vào chỉ để vẽ mấy đoạn
// thẳng là đánh đổi sai.
//
// Cách nối: mỗi node con là một cột; cột vẽ nửa thanh ngang bên trái và nửa
// bên phải, con đầu bỏ nửa trái, con cuối bỏ nửa phải. Nhờ vậy node chỉ có một
// con thì chỉ còn đúng một cuống dọc, không thừa mẩu ngang nào.
// ============================================================================

import { Building2, CircleAlert, Plus, Trash2, UserRound } from 'lucide-react';
import type { OrganizationUnit } from '@/types';

export interface OrgChartProps {
  roots: OrganizationUnit[];
  childrenOf: (unitId: string) => OrganizationUnit[];
  typeLabel: (unit: OrganizationUnit) => string;
  managerName: (unit: OrganizationUnit) => string | null;
  employeeCount: (unitId: string) => number;
  needsAttention: (unitId: string) => boolean;
  selectedId: string | null;
  onSelect: (unitId: string) => void;
  /** Node đang thu gọn: con của nó hiện thành chip "+N" thay vì vẽ tiếp. */
  collapsed: Set<string>;
  onToggle: (unitId: string) => void;
  onAddChild: (unit: OrganizationUnit) => void;
  /** Xóa đơn vị. Đơn vị còn dữ liệu liên quan sẽ được ngừng hoạt động
   *  thay vì xóa — phía gọi lo việc đó, ở đây chỉ là nút bấm. */
  onRemove: (unit: OrganizationUnit) => void;
  /**
   * Tên doanh nghiệp, vẽ làm GỐC của cây.
   *
   * Không vẽ nó thành một ô đầy đủ như các đơn vị con — tên đã có ở thanh
   * định vị phía trên, lặp lại cả ô là thừa. Nhưng bỏ hẳn thì các đơn vị con
   * treo lơ lửng, nhìn thành danh sách phẳng chứ không ra cây, và không thấy
   * được cái gì đứng trên cái gì.
   *
   * Nên: một nhãn mảnh kèm đường nối xuống — đủ để mắt đọc ra thứ bậc.
   */
  rootLabel?: string;
}

export function OrgChart(props: OrgChartProps) {
  return (
    // Cây rộng hơn màn hình là chuyện bình thường — cuộn ngang trong khung
    // riêng để không đẩy cả trang lệch đi.
    <div className="overflow-x-auto px-5 py-6">
      <div className="flex min-w-full flex-col items-center">
        {props.rootLabel && (
          <>
            <span className="rounded-lg border border-slate-300 bg-slate-50 px-3 py-1.5 text-xs font-bold text-slate-600">
              {props.rootLabel}
            </span>
            <span aria-hidden className="h-5 w-px bg-slate-300" />
          </>
        )}

        <div className="flex items-start">
          {props.roots.map((root, index) => {
            // Có gốc thì các đơn vị cấp một phải được nối vào gốc, dùng đúng
            // cách vẽ thanh ngang như mọi cấp khác bên dưới.
            if (!props.rootLabel) {
              return (
                <div key={root.id} className="px-4">
                  <Subtree unit={root} {...props} />
                </div>
              );
            }
            return (
              <div key={root.id} className="relative flex flex-col items-center px-3 pt-5">
                <span
                  aria-hidden
                  className={`absolute top-0 h-px bg-slate-300 ${index === 0 ? 'left-1/2' : 'left-0'} ${
                    index === props.roots.length - 1 ? 'right-1/2' : 'right-0'
                  }`}
                />
                <span aria-hidden className="absolute left-1/2 top-0 h-5 w-px bg-slate-300" />
                <Subtree unit={root} {...props} />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Subtree({ unit, ...props }: OrgChartProps & { unit: OrganizationUnit }) {
  const children = props.childrenOf(unit.id);
  const isCollapsed = props.collapsed.has(unit.id);

  return (
    <div className="flex flex-col items-center">
      <NodeBox unit={unit} {...props} />

      {children.length > 0 && isCollapsed && (
        <>
          <Stem />
          <button
            type="button"
            onClick={() => props.onToggle(unit.id)}
            className="rounded-full border border-dashed border-slate-300 bg-white px-3 py-1 text-[11px] font-bold text-slate-500 transition hover:border-indigo-400 hover:text-indigo-600"
          >
            +{children.length} đơn vị con
          </button>
        </>
      )}

      {children.length > 0 && !isCollapsed && (
        <>
          <Stem />
          <div className="flex items-start">
            {children.map((child, index) => (
              <div key={child.id} className="relative flex flex-col items-center px-3 pt-5">
                {/* Thanh ngang nối các đơn vị ngang cấp. */}
                <span
                  aria-hidden
                  className={`absolute top-0 h-px bg-slate-300 ${index === 0 ? 'left-1/2' : 'left-0'} ${
                    index === children.length - 1 ? 'right-1/2' : 'right-0'
                  }`}
                />
                {/* Cuống dọc thả xuống node con. */}
                <span aria-hidden className="absolute left-1/2 top-0 h-5 w-px bg-slate-300" />
                <Subtree unit={child} {...props} />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** Đoạn dọc từ đáy một node xuống thanh ngang của lớp con. */
function Stem() {
  return <span aria-hidden className="h-5 w-px bg-slate-300" />;
}

function NodeBox({
  unit, typeLabel, managerName, employeeCount, needsAttention,
  selectedId, onSelect, childrenOf, collapsed, onToggle, onAddChild, onRemove,
}: OrgChartProps & { unit: OrganizationUnit }) {
  const isSelected = selectedId === unit.id;
  const manager = managerName(unit);
  const children = childrenOf(unit.id);

  return (
    <div className="group relative">
      <button
        type="button"
        onClick={() => onSelect(unit.id)}
        aria-current={isSelected ? 'true' : undefined}
        className={`flex w-52 flex-col gap-2 rounded-xl border-2 px-3.5 py-3 text-left shadow-sm transition ${
          isSelected
            ? 'border-indigo-600 bg-indigo-50 ring-2 ring-indigo-500/20'
            : unit.is_active
              ? 'border-slate-200 bg-white hover:border-indigo-400 hover:shadow-md'
              : 'border-slate-200 bg-slate-50 opacity-70 hover:border-slate-300'
        }`}
      >
        <div className="flex items-start gap-2">
          <span
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
              unit.is_active ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-200 text-slate-400'
            }`}
          >
            <Building2 className="h-4 w-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-start gap-1">
              <strong className="line-clamp-2 text-[13px] leading-snug text-slate-900">{unit.name}</strong>
              {needsAttention(unit.id) && (
                <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" aria-label="Cần bổ sung thông tin" />
              )}
            </span>
            <span className="mt-0.5 block truncate text-[11px] text-slate-400">{typeLabel(unit)}</span>
          </span>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-slate-100 pt-2 text-[11px]">
          <span className={`flex min-w-0 items-center gap-1 ${manager ? 'text-slate-500' : 'text-amber-600'}`}>
            <UserRound className="h-3 w-3 shrink-0" />
            <span className="truncate">{manager || 'Chưa có phụ trách'}</span>
          </span>
          <span className="shrink-0 font-bold text-slate-600">{employeeCount(unit.id)} ns</span>
        </div>
      </button>

      {/* Nút thao tác chỉ hiện khi rê chuột: sơ đồ là để NHÌN, nút bấm luôn
          hiện sẽ lấn át chính nội dung cần đọc. */}
      <div className="absolute -right-1.5 -top-1.5 hidden gap-1 group-focus-within:flex group-hover:flex">
        <button
          type="button"
          onClick={() => onAddChild(unit)}
          title={`Thêm đơn vị con vào ${unit.name}`}
          aria-label={`Thêm đơn vị con vào ${unit.name}`}
          className="flex h-6 w-6 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-sm transition hover:border-indigo-400 hover:text-indigo-600"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => onRemove(unit)}
          title={`Xóa ${unit.name}`}
          aria-label={`Xóa ${unit.name}`}
          className="flex h-6 w-6 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-400 shadow-sm transition hover:border-red-300 hover:bg-red-50 hover:text-red-600"
        >
          <Trash2 className="h-3 w-3" />
        </button>
        {children.length > 0 && (
          <button
            type="button"
            onClick={() => onToggle(unit.id)}
            title={collapsed.has(unit.id) ? 'Mở nhánh' : 'Thu gọn nhánh'}
            aria-label={`${collapsed.has(unit.id) ? 'Mở' : 'Thu gọn'} nhánh ${unit.name}`}
            aria-expanded={!collapsed.has(unit.id)}
            className="flex h-6 w-6 items-center justify-center rounded-full border border-slate-200 bg-white text-[11px] font-bold text-slate-500 shadow-sm transition hover:border-indigo-400 hover:text-indigo-600"
          >
            {collapsed.has(unit.id) ? '+' : '−'}
          </button>
        )}
      </div>
    </div>
  );
}
