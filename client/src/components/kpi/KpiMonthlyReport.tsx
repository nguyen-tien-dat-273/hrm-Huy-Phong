// ============================================================================
// Báo cáo KPI theo tháng — nhìn nhiều kỳ cùng lúc.
// ----------------------------------------------------------------------------
// Màn Chấm điểm chỉ trả lời được "tháng này ai bao nhiêu". Câu người phụ trách
// hỏi tiếp luôn là câu nó không trả lời được: ai đang đi xuống, phòng nào thấp
// hơn mặt bằng, người này ba tháng liền dưới 80% hay chỉ tháng vừa rồi trượt.
//
// Bảng ở đây xoay ngang: mỗi hàng một người, mỗi cột một tháng. Cùng một dữ
// liệu `performance_reviews`, chỉ khác cách xếp — nhưng đó mới là cách đọc ra
// xu hướng.
//
// Chỉ tính phiếu ĐÃ KHOÁ. Phiếu chưa khoá còn sửa được, đưa vào trung bình là
// báo cáo đổi số mỗi lần có người gõ thêm một ô.
// ============================================================================

import { useEffect, useMemo, useState } from 'react';
import { Download, TrendingDown, TrendingUp } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input, Select } from '@/components/ui/Input';
import { Skeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/contexts/ToastContext';
import { supabase } from '@/lib/supabase';
import type { Profile } from '@/types';

interface Review {
  period_month: string;
  user_id: string;
  final_pct: number | null;
  rating: string | null;
  locked_at: string | null;
}

interface Unit { id: string; name: string }

/** Danh sách mã tháng `YYYY-MM` từ `from` tới `to`, cũ trước. */
function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  const [fy, fm] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  if (!fy || !fm || !ty || !tm) return out;
  let year = fy;
  let month = fm;
  // Chặn 36 kỳ: kéo khoảng rộng quá thì bảng dài hơn màn hình và không ai đọc,
  // mà truy vấn thì nặng lên theo.
  for (let guard = 0; guard < 36; guard += 1) {
    out.push(`${year}-${String(month).padStart(2, '0')}`);
    if (year === ty && month === tm) break;
    month += 1;
    if (month > 12) { month = 1; year += 1; }
  }
  return out;
}

const shiftMonth = (value: string, delta: number) => {
  const [y, m] = value.split('-').map(Number);
  const date = new Date(y, m - 1 + delta, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
};

const thisMonth = () => new Date().toISOString().slice(0, 7);

const toneOf = (pct: number) => (
  pct >= 100 ? 'bg-emerald-50 text-emerald-700'
    : pct >= 80 ? 'bg-indigo-50 text-indigo-700'
      : pct >= 60 ? 'bg-amber-50 text-amber-700'
        : 'bg-rose-50 text-rose-700'
);

export function KpiMonthlyReport({ profiles }: { profiles: Profile[] }) {
  const { toast } = useToast();
  const [from, setFrom] = useState(() => shiftMonth(thisMonth(), -5));
  const [to, setTo] = useState(thisMonth);
  const [unitId, setUnitId] = useState('');
  const [units, setUnits] = useState<Unit[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [supported, setSupported] = useState(true);

  const months = useMemo(() => monthsBetween(from, to), [from, to]);

  useEffect(() => {
    const load = async () => {
      if (!supabase || months.length === 0) return;
      setLoading(true);
      const [reviewRes, unitRes] = await Promise.all([
        supabase.from('performance_reviews')
          .select('period_month, user_id, final_pct, rating, locked_at')
          .gte('period_month', `${months[0]}-01`)
          .lte('period_month', `${months[months.length - 1]}-01`),
        supabase.from('organization_units').select('id, name').eq('is_active', true).order('name'),
      ]);
      if (reviewRes.error) { setSupported(false); setLoading(false); return; }
      setReviews((reviewRes.data || []) as Review[]);
      setUnits((unitRes.data || []) as Unit[]);
      setLoading(false);
    };
    void load();
  }, [from, to]);

  /** Chỉ phiếu đã khoá mới vào báo cáo — xem phần đầu file. */
  const byPerson = useMemo(() => {
    const map = new Map<string, Map<string, Review>>();
    for (const row of reviews) {
      if (!row.locked_at) continue;
      const month = row.period_month.slice(0, 7);
      const slot = map.get(row.user_id) ?? map.set(row.user_id, new Map()).get(row.user_id)!;
      slot.set(month, row);
    }
    return map;
  }, [reviews]);

  const rows = useMemo(() => profiles
    .filter((person) => person.is_active && (!unitId || person.unit_id === unitId))
    .map((person) => {
      const cells = months.map((month) => byPerson.get(person.id)?.get(month) ?? null);
      const scored = cells.filter((cell): cell is Review => cell?.final_pct != null);
      const average = scored.length
        ? scored.reduce((sum, cell) => sum + Number(cell.final_pct), 0) / scored.length
        : null;
      // Xu hướng = kỳ cuối so với kỳ liền trước CÓ ĐIỂM, không phải so với
      // trung bình: người ta hỏi "tháng này hơn hay kém tháng trước".
      const trend = scored.length >= 2
        ? Number(scored[scored.length - 1].final_pct) - Number(scored[scored.length - 2].final_pct)
        : null;
      return { person, cells, average, trend, scoredCount: scored.length };
    })
    // Người chưa có kỳ nào đã khoá vẫn hiện, nhưng xuống cuối: họ là việc phải
    // làm chứ không phải dữ liệu để đọc.
    .sort((a, b) => (b.scoredCount - a.scoredCount) || (b.average ?? -1) - (a.average ?? -1)),
  [profiles, unitId, months, byPerson]);

  const withData = rows.filter((row) => row.scoredCount > 0);

  const exportExcel = async () => {
    try {
      const XLSX = await import('xlsx');
      const header = ['Nhân sự', 'Mã NV', 'Phòng ban', ...months, 'Trung bình', 'Số kỳ'];
      const sheet = [
        header,
        ...rows.map((row) => [
          row.person.name,
          row.person.employee_code ?? '',
          units.find((unit) => unit.id === row.person.unit_id)?.name ?? '',
          ...row.cells.map((cell) => (cell?.final_pct == null ? '' : Number(cell.final_pct))),
          row.average == null ? '' : Number(row.average.toFixed(1)),
          row.scoredCount,
        ]),
      ];
      const worksheet = XLSX.utils.aoa_to_sheet(sheet);
      worksheet['!cols'] = header.map((_, index) => (index === 0 ? { wch: 24 } : { wch: 12 }));
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'KPI theo tháng');
      XLSX.writeFile(workbook, `bao-cao-kpi-${from}-den-${to}.xlsx`);
      toast('Đã xuất báo cáo KPI.', 'success');
    } catch (error) {
      toast('Xuất Excel thất bại: ' + (error instanceof Error ? error.message : String(error)), 'error');
    }
  };

  if (!supported) {
    return (
      <Card><CardContent>
        <p className="py-6 text-sm text-amber-800">
          Chưa có bảng phiếu chấm KPI. Hãy chạy các migration KPI trên Supabase.
        </p>
      </CardContent></Card>
    );
  }

  if (loading) return <Skeleton className="h-64" />;

  return (
    <Card>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-36"><Input label="Từ tháng" type="month" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div className="w-36"><Input label="Đến tháng" type="month" value={to} onChange={(e) => setTo(e.target.value)} /></div>
          <div className="min-w-[180px] flex-1">
            <Select label="Phòng ban" value={unitId} onChange={(e) => setUnitId(e.target.value)}>
              <option value="">Tất cả phòng ban</option>
              {units.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}
            </Select>
          </div>
          <Button variant="outline" onClick={() => void exportExcel()} disabled={rows.length === 0}>
            <Download className="h-4 w-4" /> Xuất Excel
          </Button>
        </div>

        {/* Ba con so dau: tra loi ngay "ky nay cong ty dang o dau" truoc khi
            nguoi doc phai tu quet ca bang. */}
        {withData.length > 0 && (() => {
          const all = withData.filter((row) => row.average != null);
          const mean = all.reduce((sum, row) => sum + (row.average ?? 0), 0) / (all.length || 1);
          const under = all.filter((row) => (row.average ?? 0) < 80).length;
          const falling = withData.filter((row) => (row.trend ?? 0) < 0).length;
          return (
            <div className="grid gap-2 sm:grid-cols-3">
              {[
                { label: 'KPI trung bình', value: `${mean.toFixed(1)}%`, warn: false },
                { label: 'Dưới 80%', value: `${under}/${all.length} người`, warn: under > 0 },
                { label: 'Giảm so với kỳ trước', value: `${falling} người`, warn: falling > 0 },
              ].map((item) => (
                <div key={item.label} className="rounded-xl border border-slate-200 px-3.5 py-2.5">
                  <p className="text-[11px] font-semibold text-slate-500">{item.label}</p>
                  <p className={`mt-0.5 text-lg font-bold ${item.warn ? 'text-amber-600' : 'text-slate-800'}`}>
                    {item.value}
                  </p>
                </div>
              ))}
            </div>
          );
        })()}

        {rows.length === 0 ? (
          <EmptyState title="Không có nhân sự nào" description="Đổi phòng ban hoặc khoảng tháng." />
        ) : (
          /* Bang rong hon man hinh thi cuon TRONG o nay, khong de ca trang
             truot ngang - truot ca trang la mat luon thanh dieu huong. */
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                  <th className="sticky left-0 z-10 bg-slate-50 px-3 py-2 text-left font-bold">Nhân sự</th>
                  {months.map((month) => (
                    <th key={month} className="px-2 py-2 text-center font-bold">{month.slice(5)}/{month.slice(2, 4)}</th>
                  ))}
                  <th className="px-3 py-2 text-right font-bold">TB</th>
                  <th className="px-2 py-2 text-center font-bold">Xu hướng</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((row) => (
                  <tr key={row.person.id} className="hover:bg-slate-50/60">
                    <td className="sticky left-0 z-10 bg-white px-3 py-2">
                      <span className="block truncate font-semibold text-slate-800">{row.person.name}</span>
                      <span className="block truncate text-[11px] text-slate-400">
                        {units.find((unit) => unit.id === row.person.unit_id)?.name ?? 'Chưa gán đơn vị'}
                      </span>
                    </td>
                    {row.cells.map((cell, index) => (
                      <td key={months[index]} className="px-2 py-2 text-center">
                        {cell?.final_pct == null ? (
                          <span className="text-xs text-slate-300">—</span>
                        ) : (
                          <span
                            title={cell.rating ?? undefined}
                            className={`inline-block rounded-md px-1.5 py-0.5 text-xs font-bold tabular-nums ${toneOf(Number(cell.final_pct))}`}
                          >
                            {Number(cell.final_pct)}
                          </span>
                        )}
                      </td>
                    ))}
                    <td className="px-3 py-2 text-right text-sm font-bold tabular-nums text-slate-800">
                      {row.average == null ? '—' : `${row.average.toFixed(1)}%`}
                    </td>
                    <td className="px-2 py-2 text-center">
                      {row.trend == null ? (
                        <span className="text-xs text-slate-300">—</span>
                      ) : row.trend >= 0 ? (
                        <span className="inline-flex items-center gap-0.5 text-xs font-bold text-emerald-600">
                          <TrendingUp className="h-3.5 w-3.5" />+{row.trend.toFixed(1)}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-0.5 text-xs font-bold text-rose-600">
                          <TrendingDown className="h-3.5 w-3.5" />{row.trend.toFixed(1)}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="text-[11px] leading-relaxed text-slate-400">
          Chỉ tính phiếu <strong>đã khoá</strong>. Phiếu chưa khoá còn sửa được, đưa vào trung bình
          thì báo cáo đổi số mỗi lần có người gõ thêm một ô.
          {withData.length < rows.length && (
            <> {rows.length - withData.length} người chưa có kỳ nào khoá nên nằm cuối bảng.</>
          )}
        </p>
      </CardContent>
    </Card>
  );
}
