// ============================================================================
// Lịch nghỉ toàn công ty — ai nghỉ ngày nào, trên một lưới tháng.
// ----------------------------------------------------------------------------
// Câu hỏi người duyệt hỏi TRƯỚC KHI bấm duyệt là "hôm đó bộ phận còn ai?".
// Trước màn này, muốn biết phải mở từng đơn ra đọc ngày rồi tự ghép trong đầu —
// nên trên thực tế không ai kiểm, và hai người cùng bộ phận nghỉ trùng ngày chỉ
// lộ ra khi đã duyệt xong cả hai.
//
// Hiện CẢ đơn chờ duyệt lẫn đơn đã duyệt, phân biệt bằng nét đứt: đơn chờ cũng
// là thứ phải cân nhắc khi duyệt đơn tiếp theo, giấu nó đi thì màn hình trả lời
// sai chính câu hỏi nó sinh ra để trả lời.
// ============================================================================

import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { supabase } from '@/lib/supabase';
import { LEAVE_TYPE_CONFIG } from '@/lib/leave';
import type { LeaveRequest, Profile } from '@/types';

/** `YYYY-MM-DD` theo giờ ĐỊA PHƯƠNG — `toISOString()` lùi một ngày ở GMT+7. */
function dateKey(date: Date): string {
  const m = `${date.getMonth() + 1}`.padStart(2, '0');
  const d = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${m}-${d}`;
}

const THU = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];

interface Props {
  /** Chỉ hiện người trong phạm vi này. Rỗng = toàn công ty. */
  visibleUserIds?: readonly string[] | null;
}

export function CompanyLeaveCalendar({ visibleUserIds = null }: Props) {
  const today = new Date();
  const [month, setMonth] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [people, setPeople] = useState<Map<string, Profile>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const monthStart = dateKey(new Date(month.getFullYear(), month.getMonth(), 1));
  const monthEnd = dateKey(new Date(month.getFullYear(), month.getMonth() + 1, 0));

  useEffect(() => {
    let huy = false;
    const load = async () => {
      if (!supabase) return;
      setLoading(true);
      setError(null);
      // Đơn CHẠM vào tháng này, không phải đơn nằm gọn trong tháng: nghỉ
      // 28/09 → 03/10 vẫn phải hiện ở tháng 10.
      const [reqRes, peopleRes] = await Promise.all([
        supabase.from('leave_requests').select('*')
          .in('status', ['approved', 'pending'])
          .lte('start_date', monthEnd)
          .gte('end_date', monthStart),
        supabase.from('profiles').select('id, name, department, avatar_url').eq('is_active', true),
      ]);
      if (huy) return;
      if (reqRes.error) {
        setError(reqRes.error.message);
        setLoading(false);
        return;
      }
      const rows = ((reqRes.data || []) as LeaveRequest[]).filter((r) => !r.is_cancelled);
      setRequests(rows);
      setPeople(new Map(((peopleRes.data || []) as Profile[]).map((p) => [p.id, p])));
      setLoading(false);
    };
    void load();
    return () => { huy = true; };
  }, [monthStart, monthEnd]);

  /** Ngày (YYYY-MM-DD) → các đơn phủ ngày đó. */
  const theoNgay = useMemo(() => {
    const map = new Map<string, LeaveRequest[]>();
    for (const req of requests) {
      if (visibleUserIds && !visibleUserIds.includes(req.user_id)) continue;
      const from = new Date(`${req.start_date}T00:00:00`);
      const to = new Date(`${req.end_date}T00:00:00`);
      for (const day = new Date(from); day <= to; day.setDate(day.getDate() + 1)) {
        const key = dateKey(day);
        if (key < monthStart || key > monthEnd) continue;
        const list = map.get(key);
        if (list) list.push(req); else map.set(key, [req]);
      }
    }
    return map;
  }, [requests, visibleUserIds, monthStart, monthEnd]);

  /**
   * Các ô của lưới, bắt đầu từ THỨ HAI của tuần chứa ngày 1.
   *
   * `getDay()` trả Chủ nhật = 0, nên phải dịch về tuần bắt đầu thứ Hai —
   * không dịch thì cả lưới lệch một cột vào tháng nào bắt đầu Chủ nhật.
   */
  const cells = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const offset = (first.getDay() + 6) % 7;
    const start = new Date(first);
    start.setDate(1 - offset);
    const last = new Date(month.getFullYear(), month.getMonth() + 1, 0);
    const total = Math.ceil((offset + last.getDate()) / 7) * 7;
    return Array.from({ length: total }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d;
    });
  }, [month]);

  const tongDon = useMemo(
    () => new Set([...theoNgay.values()].flat().map((r) => r.id)).size,
    [theoNgay],
  );

  const step = (delta: number) =>
    setMonth((m) => new Date(m.getFullYear(), m.getMonth() + delta, 1));

  const nhan = `${`${month.getMonth() + 1}`.padStart(2, '0')}/${month.getFullYear()}`;

  if (error) return <ErrorState message={`Không tải được lịch nghỉ: ${error}`} />;

  return (
    <Card>
      <CardContent className="p-4 sm:p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-700">
              <CalendarDays className="h-4 w-4 text-indigo-500" />
              Lịch nghỉ toàn công ty
            </p>
            <p className="mt-0.5 text-xs text-slate-500">
              {loading ? 'Đang tải…' : `Tháng ${nhan} · ${tongDon} đơn`}
            </p>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => step(-1)}
              aria-label="Tháng trước"
              className="rounded-lg border border-slate-200 p-1.5 text-slate-500 transition hover:border-indigo-300 hover:text-indigo-600"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="min-w-[72px] text-center text-sm font-semibold text-slate-700">{nhan}</span>
            <button
              type="button"
              onClick={() => step(1)}
              aria-label="Tháng sau"
              className="rounded-lg border border-slate-200 p-1.5 text-slate-500 transition hover:border-indigo-300 hover:text-indigo-600"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Chú giải: không có nó thì các chip màu chỉ là màu. */}
        <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-slate-500">
          {Object.entries(LEAVE_TYPE_CONFIG).map(([key, cfg]) => (
            <span key={key} className="inline-flex items-center gap-1.5">
              <span className={`h-2 w-2 rounded-full ${cfg.dot}`} />
              {cfg.label}
            </span>
          ))}
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-3 rounded border border-dashed border-slate-400" />
            Chờ duyệt
          </span>
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-indigo-500" />
          </div>
        ) : tongDon === 0 ? (
          <EmptyState
            icon={<CalendarDays className="h-8 w-8" />}
            title="Không ai nghỉ trong tháng này"
            description={`Tháng ${nhan} chưa có đơn nghỉ nào được gửi hoặc duyệt.`}
          />
        ) : (
          <div className="overflow-x-auto">
            <div className="min-w-[640px]">
              <div className="grid grid-cols-7 gap-1 pb-1">
                {THU.map((t) => (
                  <div key={t} className="px-1 text-center text-[11px] font-bold text-slate-400">{t}</div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-1">
                {cells.map((day) => {
                  const key = dateKey(day);
                  const trongThang = day.getMonth() === month.getMonth();
                  const cuoiTuan = day.getDay() === 0 || day.getDay() === 6;
                  const list = theoNgay.get(key) ?? [];
                  return (
                    <div
                      key={key}
                      className={`min-h-[86px] rounded-lg border p-1.5 ${
                        !trongThang
                          ? 'border-slate-100 bg-slate-50/40'
                          : cuoiTuan
                            ? 'border-slate-100 bg-slate-50'
                            : 'border-slate-200 bg-white'
                      }`}
                    >
                      <div className={`mb-1 text-[11px] font-bold ${
                        !trongThang ? 'text-slate-300'
                          : cuoiTuan ? 'text-slate-400' : 'text-slate-600'
                      }`}
                      >
                        {day.getDate()}
                      </div>
                      <div className="space-y-0.5">
                        {list.slice(0, 3).map((req) => {
                          const cfg = LEAVE_TYPE_CONFIG[req.leave_type];
                          const ten = people.get(req.user_id)?.name ?? 'Nhân viên';
                          return (
                            <div
                              key={`${req.id}-${key}`}
                              title={`${ten} · ${cfg.label}${req.status === 'pending' ? ' · chờ duyệt' : ''}`}
                              className={`truncate rounded px-1 py-0.5 text-[10px] font-semibold ${cfg.color} ${
                                req.status === 'pending' ? 'border border-dashed border-current opacity-80' : ''
                              }`}
                            >
                              {ten}
                            </div>
                          );
                        })}
                        {/* Quá 3 người thì gộp, không kéo dài ô làm vỡ lưới. */}
                        {list.length > 3 && (
                          <div
                            className="px-1 text-[10px] font-bold text-slate-500"
                            title={list.slice(3).map((r) => people.get(r.user_id)?.name ?? '—').join(', ')}
                          >
                            +{list.length - 3} người
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
