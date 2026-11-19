// ============================================================================
// Sơ đồ TUYẾN BÁO CÁO — ai cấp trên của ai.
// ----------------------------------------------------------------------------
// Sơ đồ đơn vị vẽ ra các PHÒNG BAN, mà phòng ban là nơi chốn — chúng ngang
// hàng nhau theo đúng nghĩa. Nhìn vào đó không trả lời được câu hỏi người ta
// thực sự hỏi khi xem sơ đồ tổ chức: ai cấp trên của ai.
//
// Thứ bậc nằm ở VỊ TRÍ, qua trường "Báo cáo cho vị trí". Giám đốc là một vị
// trí, không phải một chi nhánh. Màn này vẽ đúng cái cây ấy.
//
// Dùng lại cách vẽ đường nối của sơ đồ đơn vị: mỗi nhánh con là một cột, cột
// vẽ nửa thanh ngang bên trái và nửa bên phải, con đầu bỏ nửa trái, con cuối
// bỏ nửa phải.
// ============================================================================

import { BriefcaseBusiness, CircleAlert, Crown, ShieldCheck, Users } from 'lucide-react';
import type { JobPosition } from '@/types';

export interface PositionChartProps {
  positions: JobPosition[];
  unitNameById: Map<string, string>;
  /** Số người đang giữ từng vị trí. */
  holderCount: (positionId: string) => number;
  /** Số quyền module vị trí này mang theo. */
  permissionCount: (positionId: string) => number;
  selectedId: string | null;
  onSelect: (positionId: string) => void;
}

export function PositionChart(props: PositionChartProps) {
  const active = props.positions.filter((position) => position.is_active);

  const childrenOf = new Map<string | null, JobPosition[]>();
  const byId = new Map(active.map((position) => [position.id, position]));

  for (const position of active) {
    // Vị trí báo cáo cho một vị trí đã tắt hoặc đã xoá thì coi như đứng ở gốc,
    // thay vì biến mất khỏi sơ đồ mà không ai biết vì sao.
    const parentId = position.reports_to_position_id && byId.has(position.reports_to_position_id)
      ? position.reports_to_position_id
      : null;
    childrenOf.set(parentId, [...(childrenOf.get(parentId) ?? []), position]);
  }

  // Quản lý đứng trước trong cùng một cấp, rồi tới thứ tự chữ cái.
  childrenOf.forEach((list) => list.sort((a, b) => {
    if (a.is_manager !== b.is_manager) return a.is_manager ? -1 : 1;
    return a.title.localeCompare(b.title, 'vi');
  }));

  const roots = childrenOf.get(null) ?? [];

  if (active.length === 0) {
    return (
      <div className="px-5 py-12 text-center">
        <span className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-none bg-slate-50 text-slate-600">
          <BriefcaseBusiness className="h-5 w-5" />
        </span>
        <p className="text-sm font-semibold text-slate-600">Chưa khai vị trí nào</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto px-5 py-6">
      <div className="inline-flex min-w-full items-start justify-center gap-8">
        {roots.map((position) => (
          <Branch key={position.id} position={position} childrenOf={childrenOf} {...props} />
        ))}
      </div>
    </div>
  );
}

function Branch({
  position, childrenOf, ...props
}: PositionChartProps & {
  position: JobPosition;
  childrenOf: Map<string | null, JobPosition[]>;
}) {
  const children = childrenOf.get(position.id) ?? [];

  return (
    <div className="flex flex-col items-center">
      <PositionBox position={position} {...props} />

      {children.length > 0 && (
        <>
          <span aria-hidden className="h-5 w-px bg-slate-300" />
          <div className="flex items-start">
            {children.map((child, index) => (
              <div key={child.id} className="relative flex flex-col items-center px-3 pt-5">
                <span
                  aria-hidden
                  className={`absolute top-0 h-px bg-slate-300 ${index === 0 ? 'left-1/2' : 'left-0'} ${
                    index === children.length - 1 ? 'right-1/2' : 'right-0'
                  }`}
                />
                <span aria-hidden className="absolute left-1/2 top-0 h-5 w-px bg-slate-300" />
                <Branch position={child} childrenOf={childrenOf} {...props} />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function PositionBox({
  position, unitNameById, holderCount, permissionCount, selectedId, onSelect,
}: PositionChartProps & { position: JobPosition }) {
  const isSelected = selectedId === position.id;
  const holders = holderCount(position.id);
  const permissions = permissionCount(position.id);
  const unitName = unitNameById.get(position.unit_id);

  return (
    <button
      type="button"
      onClick={() => onSelect(position.id)}
      aria-current={isSelected ? 'true' : undefined}
      className={`flex w-56 flex-col gap-2 rounded-none border-2 px-3.5 py-3 text-left shadow-sm transition ${
        isSelected
          ? 'border-indigo-600 bg-indigo-50 ring-2 ring-indigo-500/20'
          : 'border-slate-200 bg-white hover:border-indigo-400 hover:shadow-md'
      }`}
    >
      <div className="flex items-start gap-2">
        <span
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-none ${
            position.is_manager ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600'
          }`}
        >
          {position.is_manager ? <Crown className="h-4 w-4" /> : <BriefcaseBusiness className="h-4 w-4" />}
        </span>
        <span className="min-w-0 flex-1">
          <strong className="line-clamp-2 text-[13px] leading-snug text-slate-900">{position.title}</strong>
          <span className="mt-0.5 block truncate text-[11px] text-slate-600">
            {unitName ?? 'Đơn vị không còn tồn tại'}
          </span>
        </span>
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-slate-100 pt-2 text-[11px]">
        <span className={`flex items-center gap-1 ${holders > 0 ? 'text-slate-600' : 'text-amber-600'}`}>
          {holders > 0 ? <Users className="h-3 w-3" /> : <CircleAlert className="h-3 w-3" />}
          {holders > 0 ? `${holders} người` : 'Chưa có ai'}
        </span>
        {permissions > 0 && (
          <span className="flex items-center gap-1 font-semibold text-indigo-600">
            <ShieldCheck className="h-3 w-3" />
            {permissions} quyền
          </span>
        )}
      </div>
    </button>
  );
}
