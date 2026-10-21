// ============================================================================
// Công chuẩn từng tháng: mặc định suy ra từ lịch giờ làm và ngày lễ để HR
// đối chiếu ngay với phiếu lương mẫu. Tháng nào công ty chốt số khác thì nhập
// tay ngay tại đây — Bảng công, Báo cáo công và Bảng lương đều dùng số đó.
// ============================================================================

import { Fragment, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { supabase } from '@/lib/supabase';
import {
  monthOverride, monthStandardBreakdown, saveMonthOverride, toIso, type ScheduleSet,
} from '@/lib/workSchedule';

const fmt = (value: number) => String(Math.round(value * 100) / 100).replace('.', ',');
const viDay = (iso: string) => iso.split('-').reverse().slice(0, 2).join('/');

/** Ô nhập công chuẩn của một tháng, kèm nút bỏ nhập tay để quay về số tính từ lịch. */
function OverrideEditor({
  month, current, calendar, onChanged,
}: {
  month: string;
  current: number | null;
  calendar: number | null;
  onChanged: () => Promise<void> | void;
}) {
  const { profile } = useAuth();
  const { toast } = useToast();
  const [draft, setDraft] = useState(current != null ? String(current) : '');
  const [saving, setSaving] = useState(false);
  useEffect(() => setDraft(current != null ? String(current) : ''), [current]);

  const value = Number(draft.replace(',', '.'));
  const invalid = draft.trim() === '' || !Number.isFinite(value) || value <= 0 || value > 31;
  const unchanged = current != null && value === current;

  const save = async (next: number | null) => {
    setSaving(true);
    const { error } = await saveMonthOverride(month, next, profile?.id ?? null);
    setSaving(false);
    if (error) {
      toast(`Lưu công chuẩn thất bại: ${error}`, 'error');
      return;
    }
    toast(next == null ? 'Đã quay về công chuẩn tính từ lịch' : 'Đã lưu công chuẩn của tháng', 'success');
    await onChanged();
  };

  return (
    <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-slate-200 pt-3">
      <label className="flex flex-col gap-1">
        <span className="text-xs font-black text-slate-900 dark:text-slate-100">Công chuẩn nhập tay</span>
        <input
          type="number"
          min={0.5}
          max={31}
          step={0.5}
          value={draft}
          placeholder={calendar != null ? fmt(calendar) : ''}
          aria-invalid={draft.trim() !== '' && invalid}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter' && !invalid && !unchanged) void save(value); }}
          className={`h-8 w-24 rounded-none border-2 bg-white dark:bg-slate-800 px-2 text-sm font-black tabular-nums focus:outline-none focus:ring-2 ${
            draft.trim() !== '' && invalid
              ? 'border-red-500 focus:ring-red-500/20'
              : 'border-slate-400 dark:border-slate-600 focus:border-indigo-500 focus:ring-indigo-500/20'
          }`}
        />
      </label>
      <Button theme="admin" size="sm" onClick={() => void save(value)} disabled={invalid || unchanged || saving}>
        {saving ? 'Đang lưu…' : 'Lưu'}
      </Button>
      {current != null && (
        <Button variant="secondary" size="sm" onClick={() => void save(null)} disabled={saving}>
          Dùng số tính từ lịch
        </Button>
      )}
    </div>
  );
}

export function MonthStandardCard({ set, onChanged }: { set: ScheduleSet; onChanged: () => Promise<void> | void }) {
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
    override: monthOverride(set, new Date(year, month, 1)),
  })), [set, year, holidays]);

  const currentMonth = now.getFullYear() === year ? now.getMonth() : -1;

  return (
    <Card className="!rounded-none border-2 border-slate-400 dark:border-slate-600 shadow-sm">
      <CardHeader className="!py-3 border-b-2 border-slate-300 dark:border-slate-700">
        <div className="flex items-center justify-between gap-3">
          <CardTitle>Công chuẩn theo tháng</CardTitle>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setYear((y) => y - 1)}
              className="inline-flex h-8 w-8 items-center justify-center text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              aria-label="Năm trước"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="min-w-[3rem] text-center text-sm font-black tabular-nums text-slate-900 dark:text-slate-100">{year}</span>
            <button
              onClick={() => setYear((y) => y + 1)}
              className="inline-flex h-8 w-8 items-center justify-center text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              aria-label="Năm sau"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </CardHeader>

      <table className="w-full text-left border-collapse">
        <tbody className="divide-y divide-slate-300 dark:divide-slate-700 bg-white dark:bg-slate-900 font-semibold">
          {rows.map(({ month, detail, override }) => {
            const isOpen = open === month;
            const isCurrent = month === currentMonth;
            return (
              <Fragment key={toIso(year, month, 1)}>
                <tr
                  onClick={() => setOpen(isOpen ? null : month)}
                  className={`cursor-pointer hover:bg-slate-50/80 dark:hover:bg-slate-800/60 transition-colors ${isCurrent ? 'outline outline-2 -outline-offset-2 outline-red-500 bg-red-50/30' : ''}`}
                  aria-current={isCurrent ? 'date' : undefined}
                >
                  <td className="px-4 py-2.5 text-sm font-bold text-slate-900 dark:text-slate-100">
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
                  <td className="px-4 py-2.5 text-right text-sm font-black tabular-nums text-slate-900 dark:text-slate-100">
                    {override != null ? (
                      <span className="inline-flex items-baseline gap-2">
                        {detail != null && detail.total !== override && (
                          <span className="text-xs font-semibold text-slate-400 line-through">{fmt(detail.total)}</span>
                        )}
                        <span className="text-indigo-700 dark:text-indigo-300" title="Công chuẩn nhập tay">{fmt(override)}</span>
                      </span>
                    ) : detail == null ? <span className="font-normal text-slate-400">—</span> : fmt(detail.total)}
                  </td>
                </tr>
                {isOpen && (
                  <tr className="bg-slate-50/70">
                    <td colSpan={2} className="px-4 py-3 text-sm">
                      {detail == null ? (
                        <p className="text-slate-500">
                          Chưa có giờ làm cố định nào phủ tháng này nên chưa tính được công chuẩn — có thể nhập tay bên dưới.
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
                      {override != null && (
                        <p className="mt-2 text-xs font-semibold text-indigo-700 dark:text-indigo-300">
                          Tháng này đang dùng công chuẩn nhập tay: {fmt(override)}.
                        </p>
                      )}
                      <OverrideEditor
                        month={toIso(year, month, 1)}
                        current={override}
                        calendar={detail?.total ?? null}
                        onChanged={onChanged}
                      />
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
