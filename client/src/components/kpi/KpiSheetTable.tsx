// ============================================================================
// Bảng phiếu KPI trên màn — cùng bộ cột với bản in.
// ----------------------------------------------------------------------------
// Dùng ở cả hai phía: nhân viên xem phiếu của mình, người duyệt xem lại trước
// khi khoá. Cùng component nên hai bên nhìn thấy y hệt nhau — khác nhau một
// cột là đủ để sinh ra tranh cãi không ai gỡ được.
//
// Dữ liệu dựng ở `lib/kpiSheet`, chung với hàm in.
// ============================================================================

import { buildSheetRows, type SheetCriteria, type SheetScore } from '@/lib/kpiSheet';

export function KpiSheetTable({
  criteria,
  scores,
  finalPct,
  rating,
}: {
  criteria: SheetCriteria[];
  scores: SheetScore[];
  finalPct?: number | null;
  rating?: string | null;
}) {
  const rows = buildSheetRows(criteria, scores);
  if (rows.length === 0) return null;

  return (
    /* Bang 10 cot khong vua man hinh hep: cuon TRONG o nay chu khong de ca
       trang truot ngang - truot ca trang la mat luon thanh dieu huong. */
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="w-full min-w-[820px] text-xs">
        <thead>
          <tr className="bg-emerald-50 text-[11px] text-slate-700">
            <th rowSpan={2} className="border border-slate-200 px-2 py-1.5 font-bold">Stt</th>
            <th rowSpan={2} className="border border-slate-200 px-2 py-1.5 text-left font-bold">Mục tiêu BP</th>
            <th rowSpan={2} className="border border-slate-200 px-2 py-1.5 font-bold">Trọng số</th>
            <th rowSpan={2} className="border border-slate-200 px-2 py-1.5 font-bold">Kế hoạch/<br />cam kết</th>
            <th colSpan={2} className="border border-slate-200 px-2 py-1.5 font-bold">Thực hiện</th>
            <th colSpan={2} className="border border-slate-200 px-2 py-1.5 font-bold">Chấm điểm</th>
            <th rowSpan={2} className="border border-slate-200 px-2 py-1.5 font-bold">Thực hiện/<br />cam kết</th>
            <th rowSpan={2} className="border border-slate-200 px-2 py-1.5 text-left font-bold">Ghi chú</th>
          </tr>
          <tr className="bg-emerald-50 text-[11px] text-slate-700">
            <th className="border border-slate-200 px-2 py-1 font-semibold">Cá nhân<br />đánh giá</th>
            <th className="border border-slate-200 px-2 py-1 font-semibold">QL<br />đánh giá</th>
            <th className="border border-slate-200 px-2 py-1 font-semibold">Cá nhân<br />chấm</th>
            <th className="border border-slate-200 px-2 py-1 font-semibold">Quản lý<br />chấm</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.index} className="text-slate-700">
              <td className="border border-slate-200 px-2 py-1.5 text-center tabular-nums">{row.index}</td>
              <td className="border border-slate-200 px-2 py-1.5">{row.name}</td>
              <td className="border border-slate-200 px-2 py-1.5 text-center tabular-nums">{row.weight}%</td>
              <td className="border border-slate-200 px-2 py-1.5 text-center">{row.plan || '—'}</td>
              <td className="border border-slate-200 px-2 py-1.5 text-center tabular-nums">{row.selfActual || '—'}</td>
              <td className="border border-slate-200 px-2 py-1.5 text-center tabular-nums">{row.managerActual || '—'}</td>
              <td className="border border-slate-200 px-2 py-1.5 text-center tabular-nums">{row.selfScore || '—'}</td>
              {/* Diem quan ly la con so di vao luong, nen in dam. */}
              <td className="border border-slate-200 px-2 py-1.5 text-center font-bold tabular-nums text-slate-900">
                {row.managerScore || '—'}
              </td>
              <td className="border border-slate-200 px-2 py-1.5 text-center tabular-nums">{row.ratio || '—'}</td>
              <td className="border border-slate-200 px-2 py-1.5 text-slate-500">{row.note || ''}</td>
            </tr>
          ))}
        </tbody>
        {finalPct != null && (
          <tfoot>
            <tr className="bg-slate-50 font-bold text-slate-800">
              <td colSpan={8} className="border border-slate-200 px-2 py-1.5 text-right">
                Kết quả KPI toàn kỳ
              </td>
              <td className="border border-slate-200 px-2 py-1.5 text-center tabular-nums">
                {Number(finalPct)}%
              </td>
              <td className="border border-slate-200 px-2 py-1.5">{rating ?? ''}</td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
