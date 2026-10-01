// ============================================================================
// KPI: một module, ba bước nối nhau.
// ----------------------------------------------------------------------------
// Trước đây đây là BA mục menu riêng — Bộ KPI, Gán KPI cho nhân sự, Chấm điểm
// theo tháng. Ba mục đó không độc lập: không có bộ KPI thì không gán được cho
// ai, chưa gán cho ai thì mở phiếu chấm ra trống. Người dùng phải tự biết thứ
// tự và tự nhớ mình đang dở ở đâu, trong khi hệ thống biết thừa.
//
// Gộp lại một màn, giữ nguyên ba việc nhưng xếp thành một luồng có hướng:
//
//   1. Bộ KPI       khai bộ + tiêu chí + cách tính điểm cho từng tiêu chí
//   2. Nhân sự      bộ nào áp cho phòng nào, ai dùng bộ riêng
//   3. Chấm điểm    mở phiếu tháng, nhập điểm, khoá kỳ → sang bảng lương
//
// Dải trạng thái trên đầu đọc thẳng từ dữ liệu thật, không phải nhãn trang
// trí: bước nào còn vướng thì nói rõ vướng cái gì. Đó là phần khiến ba bước
// này là một luồng chứ không phải ba cái tab cạnh nhau.
// ============================================================================

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ClipboardCheck, Target, Users } from 'lucide-react';
import { KpiReviewBoard } from '@/components/kpi/KpiReviewBoard';
import { KpiSchemeBoard } from '@/components/kpi/KpiSchemeBoard';
import { KpiTemplateEditor } from '@/components/kpi/KpiTemplateEditor';
import { supabase } from '@/lib/supabase';
import { useRealtimeSync } from '@/hooks/useRealtimeSync';
import type { Profile } from '@/types';

/** Mã bước nằm trên URL để còn gửi link cho nhau và F5 không mất chỗ đang đứng. */
const STEPS = ['tieu-chi', 'nhan-su', 'cham-diem'] as const;
type Step = (typeof STEPS)[number];

const isStep = (value: string | null): value is Step => (STEPS as readonly string[]).includes(value ?? '');

interface Template { id: string; is_active: boolean; unit_id: string | null; position_id: string | null }
interface Criteria { template_id: string; weight_percent: number; is_active: boolean }

/**
 * Tình trạng của từng bước, đọc từ dữ liệu thật.
 *
 * Cố ý KHÔNG tính lại những gì ba màn con đã tính — chỉ đếm đủ để trả lời một
 * câu: bước này xong chưa, chưa thì vướng ở đâu.
 */
interface Health {
  activeTemplates: number;
  unbalanced: number;
  empty: number;
  unitSchemes: number;
  personalSchemes: number;
  boundTemplates: number;
  reviewsThisMonth: number;
  openReviews: number;
  supported: boolean;
}

const currentMonth = () => new Date().toISOString().slice(0, 7);

export function KpiWorkspace({ profiles, actorId }: { profiles: Profile[]; actorId: string | null }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const requested = searchParams.get('buoc');
  const step: Step = isStep(requested) ? requested : 'tieu-chi';

  const [health, setHealth] = useState<Health | null>(null);

  const goTo = (next: Step) => {
    const params = new URLSearchParams(searchParams);
    params.set('buoc', next);
    params.delete('tao');
    params.delete('phong');
    setSearchParams(params, { replace: true });
  };

  /**
   * Bấm một nhân sự ở bước 2 → sang bước 1, mở sẵn form tạo bộ cho phòng của
   * họ.
   *
   * Chỗ người dùng nhận ra "người này chưa có bộ KPI" là bước 2. Bắt họ tự
   * sang bước 1 rồi tìm lại đúng phòng ban đó trong ô chọn là làm mất ngữ
   * cảnh vừa có.
   */
  const createTemplateFor = (unitId: string | null) => {
    const params = new URLSearchParams(searchParams);
    params.set('buoc', 'tieu-chi');
    // `tao` là lệnh, `phong` là ngữ cảnh. Tách đôi vì người chưa gán đơn vị
    // nào có `phong` rỗng — nhét chung một tham số thì không phân biệt được
    // "không có phòng" với "không yêu cầu tạo", và bấm vào họ sẽ không mở ra
    // gì cả.
    params.set('tao', '1');
    if (unitId) params.set('phong', unitId);
    else params.delete('phong');
    setSearchParams(params, { replace: true });
  };

  // Lệnh chỉ dùng một lần: không xoá khỏi URL thì đóng form xong nó bật lại
  // ngay, và F5 cũng bật lại.
  const clearCreateIntent = () => {
    const params = new URLSearchParams(searchParams);
    params.delete('tao');
    params.delete('phong');
    setSearchParams(params, { replace: true });
  };

  const load = async () => {
    if (!supabase) return;
    const month = `${currentMonth()}-01`;
    const [templateRes, criteriaRes, unitSchemeRes, personalSchemeRes, reviewRes] = await Promise.all([
      supabase.from('kpi_position_templates').select('id, is_active, unit_id, position_id'),
      supabase.from('kpi_template_criteria').select('template_id, weight_percent, is_active'),
      supabase.from('unit_kpi_schemes').select('unit_id'),
      supabase.from('employee_kpi_schemes').select('user_id'),
      supabase.from('performance_reviews').select('id, locked_at').eq('period_month', month),
    ]);

    // Thiếu bảng = chưa chạy migration. Không chặn cả màn: ba bước con tự báo
    // thiếu migration nào, dải trạng thái chỉ cần thôi khẳng định điều nó
    // không biết.
    if (templateRes.error) {
      setHealth({
        activeTemplates: 0, unbalanced: 0, empty: 0, unitSchemes: 0, personalSchemes: 0,
        boundTemplates: 0, reviewsThisMonth: 0, openReviews: 0, supported: false,
      });
      return;
    }

    const templates = (templateRes.data || []) as Template[];
    const criteria = (criteriaRes.data || []) as Criteria[];
    const active = templates.filter((item) => item.is_active);

    const weightOf = (templateId: string) => criteria
      .filter((item) => item.template_id === templateId && item.is_active)
      .reduce((sum, item) => sum + Number(item.weight_percent || 0), 0);
    const countOf = (templateId: string) => criteria
      .filter((item) => item.template_id === templateId && item.is_active).length;

    const reviews = (reviewRes.data || []) as { id: string; locked_at: string | null }[];

    setHealth({
      activeTemplates: active.length,
      // Tổng trọng số phải đúng 100% mới bật được bộ KPI — ràng buộc nằm ở
      // database, đây chỉ nói sớm cho đỡ mất công bấm rồi mới biết.
      unbalanced: active.filter((item) => countOf(item.id) > 0 && Math.abs(weightOf(item.id) - 100) > 0.01).length,
      empty: active.filter((item) => countOf(item.id) === 0).length,
      unitSchemes: new Set(((unitSchemeRes.data || []) as { unit_id: string }[]).map((row) => row.unit_id)).size,
      personalSchemes: new Set(((personalSchemeRes.data || []) as { user_id: string }[]).map((row) => row.user_id)).size,
      // Bộ KPI khai thẳng phòng ban cũng là đã gán — không đếm thì bước 2 báo
      // "chưa gán cho ai" trong khi mọi người vẫn chấm được bình thường.
      boundTemplates: active.filter((item) => item.unit_id || item.position_id).length,
      reviewsThisMonth: reviews.length,
      openReviews: reviews.filter((item) => !item.locked_at).length,
      supported: true,
    });
  };

  useEffect(() => { void load(); }, []);
  useRealtimeSync(
    [{ table: 'kpi_position_templates' }, { table: 'kpi_template_criteria' }, { table: 'performance_reviews' }],
    () => void load(),
    { channelKey: 'kpi-workspace' },
  );

  const steps = useMemo(() => {
    const assigned = (health?.unitSchemes ?? 0) + (health?.personalSchemes ?? 0) + (health?.boundTemplates ?? 0);
    return [
      {
        key: 'tieu-chi' as Step,
        label: 'Bộ KPI',
        hint: 'Khai bộ và tiêu chí kèm cách tính điểm',
        icon: Target,
        status: !health?.supported ? null
          : health.activeTemplates === 0 ? { tone: 'warn' as const, text: 'Chưa có bộ nào' }
            : health.empty > 0 ? { tone: 'warn' as const, text: `${health.empty} bộ chưa có tiêu chí` }
              : health.unbalanced > 0 ? { tone: 'warn' as const, text: `${health.unbalanced} bộ chưa đủ 100%` }
                : { tone: 'ok' as const, text: `${health.activeTemplates} bộ sẵn sàng` },
      },
      {
        key: 'nhan-su' as Step,
        label: 'Nhân sự áp dụng',
        hint: 'Bộ nào cho phòng nào, ai dùng bộ riêng',
        icon: Users,
        status: !health?.supported ? null
          : health.activeTemplates === 0 ? { tone: 'idle' as const, text: 'Cần bộ KPI trước' }
            : assigned === 0 ? { tone: 'warn' as const, text: 'Chưa gán cho ai' }
              : { tone: 'ok' as const, text: `${assigned} nơi đã gán` },
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
    ];
  }, [health]);

  return (
    <div className="space-y-5">
      {/* Ba bước nối nhau, không phải ba tab rời.
          Mũi tên và dải trạng thái là thứ nói cho người dùng biết họ đang dở ở
          đâu — bỏ đi thì màn này quay về đúng ba mục menu cũ, chỉ khác chỗ
          đứng. */}
      <div className="grid gap-2 sm:grid-cols-3">
        {steps.map((item, index) => {
          const on = step === item.key;
          const Icon = item.icon;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => goTo(item.key)}
              className={`group relative flex items-start gap-3 rounded-2xl border p-3 text-left transition ${on
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

      {step === 'tieu-chi' && (
        <KpiTemplateEditor
          actorId={actorId}
          createRequested={searchParams.get('tao') === '1'}
          createForUnitId={searchParams.get('phong')}
          onCreateHandled={clearCreateIntent}
        />
      )}
      {step === 'nhan-su' && <KpiSchemeBoard onCreateTemplate={createTemplateFor} />}
      {step === 'cham-diem' && <KpiReviewBoard profiles={profiles} actorId={actorId} />}
    </div>
  );
}
