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

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Building2, CircleAlert, Maximize2, Minus, Plus, Trash2, UserRound } from 'lucide-react';
import type { OrganizationUnit } from '@/types';

/**
 * Giới hạn thu/phóng.
 *
 * Dưới 30% thì chữ trong ô không còn đọc được nữa, nên cây quá lớn vẫn cuộn
 * ngang chứ không ép co bằng mọi giá. Ở mức đó sơ đồ để nhìn HÌNH DẠNG bộ
 * máy, còn đọc tên thì phóng lên hoặc bấm vào ô.
 */
const MIN_SCALE = 0.3;
const MAX_SCALE = 1;

export interface OrgChartProps {
  roots: OrganizationUnit[];
  childrenOf: (unitId: string) => OrganizationUnit[];
  typeLabel: (unit: OrganizationUnit) => string;
  managerName: (unit: OrganizationUnit) => string | null;
  employeeCount: (unitId: string) => number;
  /**
   * Nguoi treo THANG vao don vi, de ve ten ngay trong o.
   *
   * Con so "3 ns" khong tra loi duoc cau hoi thuc te la AI dang o trong
   * phong nay - nhin so do to chuc thi do moi la thu nguoi ta muon biet.
   */
  membersOf: (unitId: string) => { id: string; name: string }[];
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
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  /**
   * Thu nhỏ để nhìn hết cây.
   *
   * Một công ty vài chục phòng ban luôn rộng hơn màn hình, và cuộn ngang thì
   * không bao giờ thấy được hình dạng tổng thể — vốn là lý do duy nhất người
   * ta mở sơ đồ thay vì mở danh sách. Mặc định tự co vừa khung; bấm +/− thì
   * chuyển sang mức tự chọn và giữ nguyên mức đó.
   */
  const [autoFit, setAutoFit] = useState(true);
  const [scale, setScale] = useState(1);
  /** Kích thước THẬT của cây, đo trước khi co — `transform` không đổi offsetWidth. */
  const [size, setSize] = useState({ width: 0, height: 0 });
  /** Bề rộng khung nhìn, giữ trong state — đọc ref lúc dựng giao diện thì
      con số cũ không bao giờ được vẽ lại. */
  const [viewportWidth, setViewportWidth] = useState(0);

  const measure = useCallback(() => {
    const content = contentRef.current;
    const viewport = viewportRef.current;
    if (!content || !viewport) return;
    const width = content.offsetWidth;
    const height = content.offsetHeight;
    const available = viewport.clientWidth;

    // Chỉ ghi state khi số đo thực sự đổi.
    //
    // Đo → đổi tỷ lệ → đổi chiều cao hộp giữ chỗ → thanh cuộn dọc hiện/biến →
    // đổi bề rộng khung nhìn → đo lại. Không có ngưỡng này thì vòng đó có thể
    // dao động mãi, sơ đồ rủng liên tục và trình duyệt báo "ResizeObserver loop".
    setSize((current) => (
      Math.abs(current.width - width) < 1 && Math.abs(current.height - height) < 1
        ? current
        : { width, height }
    ));
    setViewportWidth((current) => (Math.abs(current - available) < 1 ? current : available));

    if (!autoFit || width === 0) return;
    // Trừ padding hai bên của khung nhìn.
    const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, (available - 40) / width));
    setScale((current) => (Math.abs(current - next) < 0.01 ? current : next));
  }, [autoFit]);

  useLayoutEffect(measure, [measure, props.roots, props.collapsed]);

  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    if (viewportRef.current) observer.observe(viewportRef.current);
    if (contentRef.current) observer.observe(contentRef.current);
    return () => observer.disconnect();
  }, [measure]);

  const zoomBy = (delta: number) => {
    setAutoFit(false);
    setScale((current) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, current + delta)));
  };

  // Cây nhỏ hơn khung thì không có gì để co — giấu thanh điều khiển đi thay vì
  // bày ba nút không làm gì.
  const needsScaling = size.width > 0 && (scale < MAX_SCALE || size.width > viewportWidth - 40);

  return (
    <div className="relative">
      {/* Thanh dieu khien la mot HANG RIENG, khong noi tren so do.
          Dat de len thi no che mat dung phan goc cay - cho nho cay cang de
          dam, vi goc luon nam giua phia tren. */}
      {needsScaling && (
        <div className="flex items-center justify-end gap-0.5 border-b border-slate-100 px-4 py-2">
          <button
            type="button"
            onClick={() => zoomBy(-0.1)}
            disabled={scale <= MIN_SCALE}
            aria-label="Thu nhỏ sơ đồ"
            className="flex h-7 w-7 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 disabled:opacity-30 disabled:hover:bg-transparent"
          >
            <Minus className="h-3.5 w-3.5" />
          </button>
          <span className="w-10 text-center text-[11px] font-bold tabular-nums text-slate-600">
            {Math.round(scale * 100)}%
          </span>
          <button
            type="button"
            onClick={() => zoomBy(0.1)}
            disabled={scale >= MAX_SCALE}
            aria-label="Phóng to sơ đồ"
            className="flex h-7 w-7 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 disabled:opacity-30 disabled:hover:bg-transparent"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
          <span aria-hidden className="mx-0.5 h-4 w-px bg-slate-200" />
          <button
            type="button"
            onClick={() => setAutoFit(true)}
            aria-pressed={autoFit}
            title="Co cả cây cho vừa khung"
            className={`flex h-7 items-center gap-1 rounded-md px-2 text-[11px] font-bold transition ${
              autoFit ? 'bg-indigo-50 text-indigo-700' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800'
            }`}
          >
            <Maximize2 className="h-3 w-3" />Vừa khung
          </button>
        </div>
      )}

      {/* Khung nhìn. Cây rộng hơn khung thì vẫn cuộn ngang được — thu nhỏ có
          giới hạn, không ép mọi cây phải vừa bằng mọi giá. */}
      <div ref={viewportRef} className="overflow-auto px-5 py-6">
        {/* Hộp giữ chỗ mang kích thước SAU khi co: `transform` không làm đổi
            vùng cuộn, thiếu hộp này thì phần dưới cây bị cắt mất. */}
        <div
          style={size.width > 0 ? { width: size.width * scale, height: size.height * scale } : undefined}
          className="mx-auto"
        >
          <div
            ref={contentRef}
            style={{ transform: `scale(${scale})`, transformOrigin: 'top left', width: 'max-content' }}
          >
      <div className="flex flex-col items-center">
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
              <div key={root.id} className="relative flex flex-col items-center px-2 pt-5">
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
              <div key={child.id} className="relative flex flex-col items-center px-2 pt-5">
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
  unit, typeLabel, managerName, employeeCount, membersOf, needsAttention,
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
        className={`flex w-44 flex-col gap-2 rounded-xl border-2 px-3 py-2.5 text-left shadow-sm transition ${
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
            {/* Nhan nay phai nam NGOAI phan to mau theo trang thai: kieu "dang
                chon" de len tren kieu "ngung hoat dong", nen mot don vi vua
                bam xoa ma dang duoc chon se trong y het don vi binh thuong —
                nguoi dung tuong lenh xoa khong an. */}
            {!unit.is_active && (
              <span className="mt-1 inline-block rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-bold text-slate-600">
                NGỪNG HOẠT ĐỘNG
              </span>
            )}
          </span>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-slate-100 pt-2 text-[11px]">
          <span className={`flex min-w-0 items-center gap-1 ${manager ? 'text-slate-500' : 'text-amber-600'}`}>
            <UserRound className="h-3 w-3 shrink-0" />
            <span className="truncate">{manager || 'Chưa có phụ trách'}</span>
          </span>
          <span className="shrink-0 font-bold text-slate-600">{employeeCount(unit.id)} ns</span>
        </div>

        {/* Ten nguoi trong don vi, cat o 4 dong.
            O rong 176px va so do co the thu con 30%, nen in het ten cua mot
            phong 20 nguoi se lam o cao gap may lan cac o khac va pha vo hinh
            dang cay - thu duy nhat so do nay ve ra. */}
        {(() => {
          const members = membersOf(unit.id);
          if (members.length === 0) return null;
          const shown = members.slice(0, 4);
          const rest = members.length - shown.length;
          return (
            <div className="mt-1.5 flex flex-col gap-0.5 border-t border-slate-100 pt-1.5">
              {shown.map((person) => (
                <span key={person.id} className="truncate text-[10px] leading-tight text-slate-500">
                  {person.name}
                </span>
              ))}
              {rest > 0 && (
                <span className="text-[10px] font-semibold leading-tight text-slate-400">
                  +{rest} người nữa
                </span>
              )}
            </div>
          );
        })()}
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
