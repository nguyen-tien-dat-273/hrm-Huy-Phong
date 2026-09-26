// ============================================================================
// Công chuẩn từng tháng, chỉ xem: số suy ra từ lịch giờ làm và ngày lễ để HR
// đối chiếu ngay với phiếu lương mẫu. Muốn đổi thì đổi lịch giờ làm.
// ============================================================================

import { Fragment, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { supabase } from '@/lib/supabase';
import { monthStandardBreakdown, toIso, type ScheduleSet } from '@/lib/workSchedule';

const fmt = (value: number) => String(Math.round(value * 100) / 100).replace('.', ',');
const viDay = (iso: string) => iso.split('-').reverse().slice(0, 2).join('/');

export function MonthStandardCard({ set }: { set: ScheduleSet }) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [holidays, setHolidays] = useState<string[]>([]);
  const [open, setOpen] = useState<number | null>(null);

  // Ngày lễ làm giảm công chuẩn nên phải nạp cùng năm đang xem.
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    void (async () => {
      const { data } = await supabase!.from('company_holidays').select('holiday_date')
        .eq('is_active', true).gte('holiday_date', `${year}-01-01`).lte('holiday_date', `${year}-12-31`);
      if (!cancelled) setHolidays((data ?? []).map((row) => row.holiday_date as string));
    })();
    return () => { cancelled = true; };
  }, [year]);

  const rows = useMemo(() => Array.from({ length: 12 }, (_, month) => ({
    month,
    detail: monthStandardBreakdown(set, new Date(year, month, 1), holidays),
  })), [set, year, holidays]);

  const currentMonth = now.getFullYear() === year ? now.getMonth() : -1;

  return (
    <Card className="!rounded-none">
      <CardHeader className="!py-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle>Công chuẩn theo tháng</CardTitle>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setYear((y) => y - 1)}
              className="inline-flex h-8 w-8 items-center justify-center text-slate-500 hover:bg-slate-100"
              aria-label="Năm trước"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="min-w-[3rem] text-center text-sm font-bold tabular-nums text-slate-800">{year}</span>
            <button
              onClick={() => setYear((y) => y + 1)}
              className="inline-flex h-8 w-8 items-center justify-center text-slate-500 hover:bg-slate-100"
              aria-label="Năm sau"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </CardHeader>

      <table className="w-full text-left">
        <tbody className="divide-y divide-slate-50">
          {rows.map(({ month, detail }) => {
            const isOpen = open === month;
            const isCurrent = month === currentMonth;
            return (
              <Fragment key={toIso(year, month, 1)}>
                <tr
                  onClick={() => setOpen(isOpen ? null : month)}
                  className={`cursor-pointer hover:bg-slate-50 ${isCurrent ? 'outline outline-2 -outline-offset-2 outline-red-500' : ''}`}
                  aria-current={isCurrent ? 'date' : undefined}
                >
                  <td className="px-4 py-2 text-sm font-medium text-slate-700">
                    <button
                      type="button"
                      aria-expanded={isOpen}
                      onClick={(e) => { e.stopPropagation(); setOpen(isOpen ? null : month); }}
                      className="flex items-center gap-1.5"
                    >
                      <ChevronDown className={`h-3.5 w-3.5 text-slate-400 transition-transform ${isOpen ? '' : '-rotate-90'}`} />
                      Tháng {month + 1}
                    </button>
                  </td>
                  <td className="px-4 py-2 text-right text-sm font-bold tabular-nums text-slate-800">
                    {detail == null ? <span className="font-normal text-slate-400">—</span> : fmt(detail.total)}
                  </td>
                </tr>
                {isOpen && (
                  <tr className="bg-slate-50/70">
                    <td colSpan={2} className="px-4 py-3 text-sm">
                      {detail == null ? (
                        <p className="text-slate-500">
                          Chưa có giờ làm cố định nào phủ tháng này nên chưa tính được công chuẩn.
                        </p>
                      ) : (
                        <div className="space-y-1.5">
                          {detail.lines.map((line) => (
                            <div key={`${line.label}-${line.weight}`} className="flex items-baseline justify-between gap-3 text-slate-600">
                              <span>{line.count} ngày {line.label}{line.weight !== 1 && ` × ${fmt(line.weight)}`}</span>
                              <span className="tabular-nums">{fmt(line.count * line.weight)}</span>
                            </div>
                          ))}
                          <div className="flex items-baseline justify-between gap-3 border-t border-slate-200 pt-1.5 font-bold text-slate-800">
                            <span>Công chuẩn</span>
                            <span className="tabular-nums">{fmt(detail.total)}</span>
                          </div>
                          {detail.holidayDates.length > 0 && (
                            <p className="pt-1 text-xs text-slate-500">
                              Ngày lễ đã trừ: {detail.holidayDates.map(viDay).join(', ')}
                            </p>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}
