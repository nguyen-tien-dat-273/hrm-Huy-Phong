// ============================================================================
// KPI: một module, KPI thuộc về từng người.
// ----------------------------------------------------------------------------
// Trước đây đây là BA mục menu riêng — Bộ KPI, Gán KPI cho nhân sự, Chấm điểm
// theo tháng — dựng quanh ý tưởng "bộ KPI dùng chung rồi gán xuống". Mô hình
// đó bắt người dùng khai một thứ trừu tượng trước (bộ KPI của ai?) rồi mới
// nối được vào người thật.
//
// Giờ đi thẳng: xuống cây tổ chức tới đúng một nhân sự, tạo bộ KPI CỦA RIÊNG
// họ ngay tại đó, khai tiêu chí ngay tại đó. Hai bước còn lại:
//
//   1. Nhân sự & KPI   đi xuống phòng ban → người → bộ riêng + tiêu chí
//   2. Chấm điểm       mở phiếu tháng, nhập điểm, khoá kỳ → sang bảng lương
//
// Dải trạng thái đọc thẳng từ dữ liệu thật, không phải nhãn trang trí: bước
// nào còn vướng thì nói rõ vướng cái gì.
// ============================================================================

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ClipboardCheck, Users } from 'lucide-react';
import { KpiReviewBoard } from '@/components/kpi/KpiReviewBoard';
import { KpiSchemeBoard } from '@/components/kpi/KpiSchemeBoard';
import { supabase } from '@/lib/supabase';
import { useRealtimeSync } from '@/hooks/useRealtimeSync';
import type { Profile } from '@/types';

/** Mã bước nằm trên URL để còn gửi link cho nhau và F5 không mất chỗ đang đứng. */
const STEPS = ['nhan-su', 'cham-diem'] as const;
type Step = (typeof STEPS)[number];

const isStep = (value: string | null): value is Step => (STEPS as readonly string[]).includes(value ?? '');

interface Criteria { template_id: string; weight_percent: number; is_active: boolean }

/**
 * Tình trạng của từng bước, đọc từ dữ liệu thật.
 *
 * Cố ý KHÔNG tính lại những gì hai màn con đã tính — chỉ đếm đủ để trả lời
 * một câu: bước này xong chưa, chưa thì vướng ở đâu.
 */
interface Health {
  peopleWithKpi: number;
  peopleTotal: number;
  unbalanced: number;
  reviewsThisMonth: number;
  openReviews: number;
  supported: boolean;
}

const currentMonth = () => new Date().toISOString().slice(0, 7);

export function KpiWorkspace({ profiles, actorId }: { profiles: Profile[]; actorId: string | null }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const requested = searchParams.get('buoc');
  const step: Step = isStep(requested) ? requested : 'nhan-su';

  const [health, setHealth] = useState<Health | null>(null);

  const goTo = (next: Step) => {
    const params = new URLSearchParams(searchParams);
    params.set('buoc', next);
    setSearchParams(params, { replace: true });
  };

  const activePeople = useMemo(() => profiles.filter((person) => person.is_active), [profiles]);

  const load = async () => {
    if (!supabase) return;
    const month = `${currentMonth()}-01`;
    const [schemeRes, criteriaRes, reviewRes] = await Promise.all([
      supabase.from('employee_kpi_schemes').select('user_id, template_id'),
      supabase.from('kpi_template_criteria').select('template_id, weight_percent, is_active'),
      supabase.from('performance_reviews').select('id, locked_at').eq('period_month', month),
    ]);

    // Thiếu bảng = chưa chạy migration. Không chặn cả màn: hai bước con tự báo
    // thiếu migration nào, dải trạng thái chỉ cần thôi khẳng định điều nó
    // không biết.
    if (schemeRes.error) {
      setHealth({
        peopleWithKpi: 0, peopleTotal: activePeople.length, unbalanced: 0,
        reviewsThisMonth: 0, openReviews: 0, supported: false,
      });
      return;
    }

    const schemes = (schemeRes.data || []) as { user_id: string; template_id: string }[];
    const criteria = (criteriaRes.data || []) as Criteria[];
    const reviews = (reviewRes.data || []) as { id: string; locked_at: string | null }[];

    const weightOf = (templateId: string) => criteria
      .filter((item) => item.template_id === templateId && item.is_active)
      .reduce((sum, item) => sum + Number(item.weight_percent || 0), 0);

    // Chỉ đếm người CÒN HOẠT ĐỘNG: người đã nghỉ vẫn còn bản ghi KPI cũ, đếm
    // vào thì con số "đã có KPI" vượt quá sĩ số và không ai hiểu vì sao.
    const activeIds = new Set(activePeople.map((person) => person.id));
    const own = schemes.filter((row) => activeIds.has(row.user_id));

    setHealth({
      peopleWithKpi: new Set(own.map((row) => row.user_id)).size,
      peopleTotal: activePeople.length,
      // Tổng trọng số phải đúng 100% mới bật được bộ KPI — ràng buộc nằm ở
      // database, đây chỉ nói sớm cho đỡ mất công bấm rồi mới biết.
      unbalanced: new Set(
        own.filter((row) => Math.abs(weightOf(row.template_id) - 100) > 0.01).map((row) => row.template_id),
      ).size,
      reviewsThisMonth: reviews.length,
      openReviews: reviews.filter((item) => !item.locked_at).length,
      supported: true,
    });
  };

  useEffect(() => { void load(); }, [activePeople.length]);
  useRealtimeSync(
    [
      { table: 'employee_kpi_schemes' }, { table: 'kpi_template_criteria' },
      { table: 'performance_reviews' },
    ],
    () => void load(),
    { channelKey: 'kpi-workspace' },
  );

  const steps = useMemo(() => [
    {
      key: 'nhan-su' as Step,
      label: 'Nhân sự & KPI riêng',
      hint: 'Xuống phòng ban, mở một người, khai bộ KPI của họ',
      icon: Users,
      status: !health?.supported ? null
        : health.peopleWithKpi === 0 ? { tone: 'warn' as const, text: 'Chưa ai có bộ KPI' }
          : health.unbalanced > 0 ? { tone: 'warn' as const, text: `${health.unbalanced} bộ chưa đủ 100%` }
            : { tone: 'ok' as const, text: `${health.peopleWithKpi}/${health.peopleTotal} người đã có` },
    },
    {
      key: 'cham-diem' as Step,
      label: 'Chấm điểm tháng',
      hint: 'Mở phiếu, nhập điểm rồi khoá kỳ',
      icon: ClipboardCheck,
      status: !health?.supported ? null
        : health.reviewsThisMonth === 0 ? { tone: 'idle' as const, text: 'Tháng này chưa mở phiếu' }
          : health.openReviews > 0 ? { tone: 'warn' as const, text: `${health.openReviews} phiếu chưa khoá` }
            : { tone: 'ok' as const, text: `${health.reviewsThisMonth} phiếu đã khoá` },
    },
  ], [health]);

  return (
    <div className="space-y-5">
      {/* Hai bước nối nhau, không phải hai tab rời.
          Dải trạng thái là thứ nói cho người dùng biết họ đang dở ở đâu — bỏ
          đi thì màn này quay về đúng mấy mục menu cũ, chỉ khác chỗ đứng. */}
      <div className="grid gap-2 sm:grid-cols-2">
        {steps.map((item, index) => {
          const on = step === item.key;
          const Icon = item.icon;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => goTo(item.key)}
              className={`flex items-start gap-3 rounded-2xl border p-3 text-left transition ${on
                ? 'border-indigo-300 bg-indigo-50/70 shadow-sm'
                : 'border-slate-200 bg-white hover:border-indigo-200 hover:bg-slate-50'}`}
            >
              <span className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl text-sm font-bold ${on ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-500'}`}>
                {index + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <Icon className={`h-4 w-4 flex-shrink-0 ${on ? 'text-indigo-600' : 'text-slate-400'}`} />
                  <span className={`truncate text-sm font-semibold ${on ? 'text-indigo-900' : 'text-slate-800'}`}>
                    {item.label}
                  </span>
                </span>
                <span className="mt-0.5 block text-[11px] leading-snug text-slate-500">{item.hint}</span>
                {item.status && (
                  <span className={`mt-1.5 inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                    item.status.tone === 'ok' ? 'bg-emerald-50 text-emerald-700'
                      : item.status.tone === 'warn' ? 'bg-amber-50 text-amber-700'
                        : 'bg-slate-100 text-slate-500'}`}
                  >
                    {item.status.text}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>

      {step === 'nhan-su' && <KpiSchemeBoard actorId={actorId} />}
      {step === 'cham-diem' && <KpiReviewBoard profiles={profiles} actorId={actorId} />}
    </div>
  );
}
