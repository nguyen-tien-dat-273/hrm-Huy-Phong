// ============================================================================
// Khung chờ tải cho các mục của Lương & Đãi ngộ.
// ----------------------------------------------------------------------------
// Mỗi khung dựng lại đúng bố cục của mục thật: cùng khoảng cách, cùng chiều cao
// ô nhập / nút / dòng bảng, cùng độ rộng cột. Phần chữ cố định (tiêu đề cột,
// nhãn tab) in thật; chỉ dữ liệu mới là thanh xám. Nhờ vậy lúc dữ liệu về, trang
// không nhảy và không đẩy nội dung xuống.
//
// Khi sửa bố cục một mục trong ComponentCatalog / PayrollParamsTab / PaySchemeTree /
// MonthlyInputsTab / AdjustmentsTab / PayrollRegister / PayrollApprovals, sửa
// khung tương ứng ở đây cho khớp.
// ============================================================================

import type { ReactNode } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/Card';

type Section = 'register' | 'schemes' | 'inputs' | 'adjustments' | 'catalog' | 'params' | 'approvals';

/** Thanh xám — bo `rounded-md` để lớp bo lớn hơn truyền vào còn ghi đè được. */
function Bar({ className = '' }: { className?: string }) {
  return <div className={`skeleton rounded-md ${className}`} aria-hidden="true" />;
}

/** Vỏ chung: báo trình đọc màn hình là đang tải, nội dung bên trong ẩn khỏi nó. */
function Frame({ children, className = 'space-y-4' }: { children: ReactNode; className?: string }) {
  return (
    <div className={className} role="status" aria-busy="true" aria-live="polite">
      <span className="sr-only">Đang tải dữ liệu…</span>
      {children}
    </div>
  );
}

const TH = 'text-left text-[11px] font-bold uppercase tracking-wider text-slate-400';

function PersonCell({ nameWidth = 'w-32' }: { nameWidth?: string }) {
  return (
    <div className="flex items-center gap-2">
      <Bar className="h-8 w-8 flex-shrink-0 rounded-full" />
      <div className="min-w-0 space-y-1.5">
        <Bar className={`h-3.5 ${nameWidth}`} />
        <Bar className="h-2.5 w-24" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Danh mục khoản lương
// ---------------------------------------------------------------------------
function CatalogSkeleton() {
  return (
    <Frame>
      <div className="flex flex-wrap items-center gap-2">
        <Bar className="h-10 min-w-[220px] max-w-md flex-1 rounded-xl" />
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Bar className="h-11 w-28 rounded-xl" />
          <Bar className="h-11 w-44 rounded-xl" />
          <Bar className="h-11 w-36 rounded-xl" />
        </div>
      </div>

      <div className="flex gap-1 overflow-hidden border-b border-slate-200">
        {['w-16', 'w-24', 'w-20', 'w-28', 'w-24'].map((width, index) => (
          <div key={index} className="-mb-px flex shrink-0 items-center border-b-2 border-transparent px-4 py-3">
            <Bar className={`h-5 ${width}`} />
          </div>
        ))}
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px]">
              <thead>
                <tr className={`border-b border-slate-100 bg-slate-50/70 ${TH}`}>
                  <th className="px-4 py-2.5">Tên đầu mục</th>
                  <th className="px-3 py-2.5">Loại dòng</th>
                  <th className="px-3 py-2.5">Tính chất</th>
                  <th className="px-3 py-2.5 text-right">Mặc định</th>
                  <th className="px-3 py-2.5">Trạng thái</th>
                  <th className="px-3 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {Array.from({ length: 8 }).map((_, index) => (
                  <tr key={index}>
                    <td className="px-4 py-3">
                      <Bar className="h-5 w-48" />
                      <Bar className="mt-1 h-4 w-24" />
                    </td>
                    <td className="px-3 py-3"><Bar className="h-6 w-24" /></td>
                    <td className="px-3 py-3"><Bar className="h-4 w-28" /></td>
                    <td className="px-3 py-3"><Bar className="ml-auto h-4 w-16" /></td>
                    <td className="px-3 py-3"><Bar className="h-4 w-20" /></td>
                    <td className="px-3 py-1.5">
                      <div className="flex justify-end gap-0.5">
                        <Bar className="h-9 w-9 rounded-lg" />
                        <Bar className="h-9 w-9 rounded-lg" />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </Frame>
  );
}

// ---------------------------------------------------------------------------
// Tham số lương
// ---------------------------------------------------------------------------
function ParamsSkeleton() {
  return (
    <Frame>
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center gap-4 border-b border-slate-100 px-5 py-4">
          <Bar className="h-12 w-12 shrink-0 rounded-xl" />
          <div className="min-w-0 flex-1 space-y-2">
            <Bar className="h-3.5 w-64 max-w-full" />
            <Bar className="h-6 w-56 max-w-full" />
          </div>
        </div>
        <div className="space-y-4 p-5">
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-full space-y-1.5 sm:w-72"><Bar className="h-4 w-24" /><Bar className="h-11 w-full rounded-xl" /></div>
            <div className="w-full space-y-1.5 sm:w-44"><Bar className="h-4 w-28" /><Bar className="h-11 w-full rounded-xl" /></div>
            <div className="min-w-[10rem] flex-1 space-y-1.5"><Bar className="h-4 w-16" /><Bar className="h-11 w-full rounded-xl" /></div>
            <div className="min-w-[12rem] flex-[1.4] space-y-1.5"><Bar className="h-4 w-16" /><Bar className="h-11 w-full rounded-xl" /></div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 pt-3">
            <Bar className="h-11 w-32 rounded-xl" />
            <Bar className="h-11 w-28 rounded-xl" />
          </div>
        </div>
      </section>

      <Card>
        <CardHeader><Bar className="h-6 w-40" /></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            {[0, 1, 2].map((index) => (
              <div key={index} className="space-y-1.5"><Bar className="h-4 w-36" /><Bar className="h-11 w-full rounded-xl" /></div>
            ))}
          </div>
        </CardContent>
      </Card>

      {[5, 4].map((rows, block) => (
        <Card key={block}>
          <CardContent className="space-y-4 py-4">
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-2">
                <Bar className="h-6 w-44" />
                <Bar className="h-3.5 w-64 max-w-full" />
              </div>
              <Bar className="h-5 w-20" />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className={`border-b border-slate-100 ${TH}`}>
                    <th className="py-2 pr-3">Tên tham số</th>
                    <th className="w-32 py-2 pr-3">Loại</th>
                    <th className="w-40 py-2 pr-3">Đơn vị</th>
                    <th className="w-44 py-2 pr-3 text-right">Giá trị</th>
                    <th className="w-10 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {Array.from({ length: rows }).map((_, index) => (
                    <tr key={index}>
                      <td className="py-2 pr-3"><Bar className="h-9 w-full rounded-lg" /></td>
                      <td className="py-2 pr-3"><Bar className="h-9 w-full rounded-lg" /></td>
                      <td className="py-2 pr-3"><Bar className="h-9 w-full rounded-lg" /></td>
                      <td className="py-2 pr-3"><Bar className="h-9 w-full rounded-lg" /></td>
                      <td className="py-2"><Bar className="h-9 w-9 rounded-lg" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      ))}
    </Frame>
  );
}

// ---------------------------------------------------------------------------
// Cơ chế lương — cây đơn vị bên trái, nhân sự / cơ chế bên phải
// ---------------------------------------------------------------------------
function SchemesSkeleton() {
  return (
    <Frame className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
      <Card className="overflow-hidden">
        <div className="border-b border-slate-100 p-3"><Bar className="h-10 w-full rounded-lg" /></div>
        <div className="space-y-1 p-2">
          {[0, 1, 1, 2, 2, 1, 2, 1].map((depth, index) => (
            <div key={index} className="flex items-center gap-2 px-2 py-2" style={{ paddingLeft: 8 + depth * 16 }}>
              <Bar className="h-4 w-4 flex-shrink-0" />
              <Bar className="h-4 flex-1" />
              <Bar className="h-3 w-12" />
            </div>
          ))}
        </div>
      </Card>

      <div className="min-w-0 space-y-4">
        <Card>
          <CardHeader className="flex flex-wrap items-center gap-3">
            <Bar className="h-6 w-56" />
          </CardHeader>
          <CardContent className="space-y-3">
            <Bar className="h-10 w-72 max-w-full rounded-xl" />
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className={`border-b border-slate-100 ${TH}`}>
                  <th className="py-2 pr-3">Nhân viên</th>
                  <th className="py-2 pr-3">Khai riêng</th>
                  <th className="py-2 pr-3">Tình trạng</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {Array.from({ length: 6 }).map((_, index) => (
                  <tr key={index}>
                    <td className="py-2 pr-3"><PersonCell /></td>
                    <td className="py-2 pr-3"><Bar className="h-4 w-14" /></td>
                    <td className="py-2 pr-3"><Bar className="h-5 w-24 rounded-full" /></td>
                    <td className="py-2 text-right"><Bar className="ml-auto h-4 w-4" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>
    </Frame>
  );
}

// ---------------------------------------------------------------------------
// Số liệu lương tháng
// ---------------------------------------------------------------------------
function InputsSkeleton() {
  return (
    <Frame>
      <Card className="min-w-0">
        <CardHeader className="flex flex-wrap items-center gap-3">
          <Bar className="h-6 min-w-0 flex-1" />
          <Bar className="h-10 w-full rounded-lg sm:w-64" />
          <Bar className="h-5 w-32" />
          <Bar className="h-11 w-40 rounded-xl" />
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm" style={{ minWidth: 320 + 3 * 140 }}>
              <thead>
                <tr className={`border-b border-slate-100 ${TH}`}>
                  <th className="py-2 pr-3">Nhân viên</th>
                  {[0, 1, 2].map((index) => (
                    <th key={index} className="py-2 pr-3"><Bar className="ml-auto h-3.5 w-20" /></th>
                  ))}
                  <th className="py-2 text-right">Lương thực nhận (đủ công)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {Array.from({ length: 6 }).map((_, index) => (
                  <tr key={index}>
                    <td className="py-2 pr-3"><PersonCell /></td>
                    {[0, 1, 2].map((cell) => (
                      <td key={cell} className="py-1.5 pr-3"><Bar className="ml-auto h-9 w-32 rounded-lg" /></td>
                    ))}
                    <td className="py-2"><Bar className="ml-auto h-5 w-28" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </Frame>
  );
}

// ---------------------------------------------------------------------------
// Điều chỉnh lương
// ---------------------------------------------------------------------------
function AdjustmentsSkeleton() {
  return (
    <Frame>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-2">
          <Bar className="h-6 w-60" />
          <Bar className="h-4 w-full max-w-xl" />
          <Bar className="h-4 w-2/3 max-w-md" />
        </div>
        <Bar className="h-11 w-44 rounded-xl" />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {[0, 1].map((index) => (
          <Card key={index}>
            <CardContent className="flex items-center gap-3 py-4">
              <Bar className="h-9 w-9 flex-shrink-0 rounded-xl" />
              <div className="space-y-2">
                <Bar className="h-3 w-36" />
                <Bar className="h-5 w-28" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardContent className="p-0">
          <ul className="divide-y divide-slate-50">
            {Array.from({ length: 5 }).map((_, index) => (
              <li key={index} className="flex items-start gap-3 px-5 py-4">
                <Bar className="h-8 w-8 flex-shrink-0 rounded-full" />
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex items-center gap-2">
                    <Bar className="h-5 w-36" />
                    <Bar className="h-5 w-16 rounded-full" />
                  </div>
                  <Bar className="h-3.5 w-full max-w-lg" />
                  <Bar className="h-3.5 w-40" />
                </div>
                <Bar className="h-5 w-24 flex-shrink-0" />
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </Frame>
  );
}

// ---------------------------------------------------------------------------
// Bảng lương tháng
// ---------------------------------------------------------------------------
function RegisterSkeleton() {
  const valueColumns = 5;
  return (
    <Frame className="space-y-5">
      <div className="flex flex-wrap items-center gap-1">
        {[0, 1, 2, 3, 4].map((index) => <Bar key={index} className="h-6 w-20 rounded-full" />)}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Bar className="h-11 w-52 rounded-xl" />
          <Bar className="h-11 w-28 rounded-xl" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Bar className="h-11 w-32 rounded-xl" />
          <Bar className="h-11 w-40 rounded-xl" />
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-4 py-3">
            <Bar className="h-11 w-full rounded-xl sm:w-60" />
            <Bar className="h-11 w-full rounded-xl sm:w-72" />
            <Bar className="h-11 w-full rounded-xl sm:w-48" />
            <Bar className="h-11 w-full rounded-xl sm:w-52" />
            <Bar className="ml-auto h-4 w-24" />
          </div>
          <div className="min-h-[320px] overflow-hidden">
            <table className="w-full whitespace-nowrap text-xs tabular-nums text-slate-700">
              <thead>
                <tr className="border-b border-slate-200 bg-[#FCFAF8] text-[11px] font-semibold text-slate-500">
                  <th className="w-[240px] min-w-[240px] max-w-[240px] bg-[#FCFAF8] px-4 py-3 text-left">Nhân sự</th>
                  <th className="border-l border-slate-100 px-3 py-3 text-center">Công</th>
                  {Array.from({ length: valueColumns }).map((_, index) => (
                    <th key={index} className="border-l border-slate-100 px-3 py-3"><Bar className="mx-auto h-3.5 w-16" /></th>
                  ))}
                  <th className="border-l border-slate-100 px-3 py-3 text-center text-slate-700">Tổng cộng</th>
                  <th className="border-l border-slate-100 px-3 py-3 text-center text-slate-700">Tổng trừ</th>
                  <th className="border-l border-slate-100 px-4 py-3 text-center text-slate-700">Thực nhận</th>
                  <th className="w-12 px-2 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {Array.from({ length: 8 }).map((_, index) => (
                  <tr key={index}>
                    <td className="w-[240px] min-w-[240px] max-w-[240px] px-4 py-2.5"><PersonCell nameWidth="w-28" /></td>
                    <td className="border-l border-slate-100 px-3 py-2.5"><Bar className="mx-auto h-4 w-10" /></td>
                    {Array.from({ length: valueColumns }).map((__, cell) => (
                      <td key={cell} className="border-l border-slate-100 px-3 py-2.5"><Bar className="mx-auto h-4 w-16" /></td>
                    ))}
                    <td className="border-l border-slate-100 px-3 py-2.5"><Bar className="mx-auto h-4 w-20" /></td>
                    <td className="border-l border-slate-100 px-3 py-2.5"><Bar className="mx-auto h-4 w-16" /></td>
                    <td className="border-l border-slate-100 px-4 py-2.5"><Bar className="mx-auto h-4 w-20" /></td>
                    <td className="px-2 py-2.5"><Bar className="mx-auto h-8 w-8 rounded-lg" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </Frame>
  );
}

// ---------------------------------------------------------------------------
// Phê duyệt lương
// ---------------------------------------------------------------------------
/** Chỉ phần danh sách hồ sơ — thanh lọc phía trên của mục đã có sẵn khi tải. */
export function ApprovalListSkeleton({ count = 2 }: { count?: number }) {
  return (
    <div className="space-y-3" role="status" aria-busy="true" aria-live="polite">
      <span className="sr-only">Đang tải hồ sơ…</span>
      {Array.from({ length: count }).map((_, index) => (
        <Card key={index}>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <Bar className="h-4 w-4 flex-shrink-0" />
              <div className="min-w-0 flex-1 space-y-2">
                <Bar className="h-5 w-52 max-w-full" />
                <Bar className="h-3.5 w-72 max-w-full" />
              </div>
              <Bar className="h-7 w-24 rounded-full" />
            </div>
            <div className="grid gap-2 rounded-xl bg-slate-50 p-3 sm:grid-cols-4">
              {[0, 1, 2, 3].map((cell) => (
                <div key={cell} className="space-y-1.5">
                  <Bar className="h-3 w-20" />
                  <Bar className="h-4 w-24" />
                </div>
              ))}
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <Bar className="h-11 w-40 rounded-xl" />
              <Bar className="h-11 w-28 rounded-xl" />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function ApprovalsSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Bar className="h-12 w-52 rounded-xl" />
        <Bar className="h-10 min-w-[200px] flex-1 rounded-lg" />
        <Bar className="h-10 w-48 rounded-lg" />
      </div>
      <ApprovalListSkeleton />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dùng ở AdminPayroll: chọn khung theo mục đang mở.
// ---------------------------------------------------------------------------
export function PayrollSectionSkeleton({ section }: { section: Section }) {
  switch (section) {
    case 'catalog': return <CatalogSkeleton />;
    case 'params': return <ParamsSkeleton />;
    case 'schemes': return <SchemesSkeleton />;
    case 'inputs': return <InputsSkeleton />;
    case 'adjustments': return <AdjustmentsSkeleton />;
    case 'approvals': return <ApprovalsSkeleton />;
    case 'register':
    default: return <RegisterSkeleton />;
  }
}

// ---------------------------------------------------------------------------
// Phiếu lương của tôi (nhân viên): thẻ thực nhận, 3 ô số, bảng chi tiết.
// ---------------------------------------------------------------------------
export function PayslipSkeleton() {
  return (
    <Frame className="space-y-5">
      <Card className="overflow-hidden">
        <CardContent className="py-7">
          <div className="flex flex-wrap items-end justify-between gap-5">
            <div className="space-y-3">
              <Bar className="h-5 w-44" />
              <Bar className="h-10 w-64 max-w-full" />
            </div>
            <Bar className="h-[74px] w-40 rounded-2xl" />
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {[0, 1, 2].map((index) => (
          <Card key={index}>
            <CardContent className="flex items-center gap-3 py-5">
              <Bar className="h-10 w-10 flex-shrink-0 rounded-xl" />
              <div className="min-w-0 space-y-2">
                <Bar className="h-3.5 w-32" />
                <Bar className="h-5 w-24" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-4 sm:px-6">
            <Bar className="h-10 w-10 rounded-xl" />
            <div className="space-y-2">
              <Bar className="h-5 w-40" />
              <Bar className="h-3.5 w-52" />
            </div>
          </div>
          <div className="space-y-4 px-5 py-5 sm:px-6">
            {Array.from({ length: 7 }).map((_, index) => (
              <div key={index} className="flex items-center justify-between gap-4">
                <div className="space-y-1.5">
                  <Bar className="h-4 w-44" />
                  <Bar className="h-3 w-64 max-w-full" />
                </div>
                <Bar className="h-4 w-24 flex-shrink-0" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </Frame>
  );
}
