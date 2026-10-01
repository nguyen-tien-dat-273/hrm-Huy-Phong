// ============================================================================
// KPI của tôi.
// ----------------------------------------------------------------------------
// Khu quản trị chấm KPI, và KPI% đó quy thẳng ra tiền qua khoản Lương KPI.
// Nhưng người bị chấm lại không có màn nào để xem mình được bao nhiêu, cao
// hay thấp ở tiêu chí nào — tức là con số quyết định một phần lương của họ
// nằm ngoài tầm nhìn của chính họ.
//
// Màn này CHỈ ĐỌC. Việc tự chấm (RC6.2) chưa dựng, nên không bày ô nhập để
// khỏi hứa một thứ chưa có.
// ============================================================================

import { useEffect, useState } from 'react';
import { Target, TriangleAlert } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Card, CardContent } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { getTodayString } from '@/lib/utils';

interface Review {
  id: string;
  period_month: string;
  template_id: string | null;
  final_pct: number | null;
  rating: string | null;
  locked_at: string | null;
}

interface Score {
  id: string;
  review_id: string;
  criteria_id: string;
  manager_score: number | null;
  not_applicable: boolean;
  not_applicable_reason: string | null;
}

interface Criteria {
  id: string;
  template_id: string;
  name: string;
  weight_percent: number;
  max_score: number;
  is_active: boolean;
}

export function StaffKpi() {
  const { profile } = useAuth();
  const [reviews, setReviews] = useState<Review[]>([]);
  const [scores, setScores] = useState<Score[]>([]);
  const [criteria, setCriteria] = useState<Criteria[]>([]);
  const [templateNames, setTemplateNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [supported, setSupported] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      if (!supabase || !profile) return;
      setLoading(true);
      const reviewRes = await supabase
        .from('performance_reviews')
        .select('id, period_month, template_id, final_pct, rating, locked_at')
        .eq('user_id', profile.id)
        .order('period_month', { ascending: false });

      if (reviewRes.error) {
        setSupported(false);
        setLoading(false);
        return;
      }
      const rows = (reviewRes.data || []) as Review[];
      setReviews(rows);
      setOpenId(rows[0]?.id ?? null);

      if (rows.length > 0) {
        const [scoreRes, criteriaRes, templateRes] = await Promise.all([
          supabase.from('performance_review_scores').select('*').in('review_id', rows.map((r) => r.id)),
          supabase.from('kpi_template_criteria').select('id, template_id, name, weight_percent, max_score, is_active'),
          supabase.from('kpi_position_templates').select('id, name'),
        ]);
        setScores((scoreRes.data || []) as Score[]);
        setCriteria((criteriaRes.data || []) as Criteria[]);
        const names: Record<string, string> = {};
        for (const row of (templateRes.data || []) as { id: string; name: string }[]) names[row.id] = row.name;
        setTemplateNames(names);
      }
      setLoading(false);
    };
    void load();
  }, [profile]);

  if (loading) return <Skeleton className="h-64" />;

  if (!supported) {
    return (
      <Card><CardContent>
        <p className="flex items-start gap-2.5 text-sm leading-relaxed text-amber-800">
          <TriangleAlert className="mt-0.5 h-5 w-5 flex-shrink-0" />
          Chưa đọc được dữ liệu KPI. Báo quản trị viên kiểm tra lại quyền truy cập.
        </p>
      </CardContent></Card>
    );
  }

  if (reviews.length === 0) {
    return (
      <EmptyState
        icon={<Target className="h-8 w-8" />}
        title="Chưa có kỳ KPI nào"
        description="Quản lý mở phiếu chấm cho tháng nào thì kết quả tháng đó hiện ở đây."
      />
    );
  }

  const monthLabel = (value: string) => {
    const [year, month] = value.split('-');
    return `Tháng ${month}/${year}`;
  };

  return (
    <div className="space-y-4">
      <p className="text-xs leading-relaxed text-slate-500">
        Kết quả do quản lý chấm. KPI% ở đây là con số dùng để tính khoản{' '}
        <strong className="text-slate-700">Lương KPI</strong> trên phiếu lương — nếu thấy chưa đúng,
        trao đổi với quản lý trước khi kỳ được khóa.
      </p>

      {reviews.map((review) => {
        const isOpen = openId === review.id;
        const rows = criteria
          .filter((item) => item.template_id === review.template_id && item.is_active)
          .map((item) => ({ item, score: scores.find((s) => s.review_id === review.id && s.criteria_id === item.id) }));

        return (
          <Card key={review.id}>
            <CardContent className="space-y-3">
              <button
                type="button"
                onClick={() => setOpenId(isOpen ? null : review.id)}
                className="flex w-full flex-wrap items-center gap-3 text-left"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-bold text-slate-900">{monthLabel(review.period_month)}</span>
                  <span className="block truncate text-xs text-slate-500">
                    {review.template_id ? templateNames[review.template_id] ?? 'Bộ KPI đã xóa' : 'Chưa gán bộ KPI'}
                  </span>
                </span>
                {review.rating && <Badge className="bg-slate-100 text-slate-700">{review.rating}</Badge>}
                <span className="text-right">
                  <span className="block text-xl font-extrabold text-indigo-600">
                    {review.final_pct == null ? '—' : `${Number(review.final_pct)}%`}
                  </span>
                  {/* Khoa hay chua la thong tin quan trong: chua khoa thi con
                      doi duoc, va KPI_PCT cung chua day sang bang luong. */}
                  <span className="block text-[11px] text-slate-400">
                    {review.locked_at ? 'Đã khóa' : 'Chưa khóa'}
                  </span>
                </span>
              </button>

              {isOpen && rows.length > 0 && (
                <ul className="divide-y divide-slate-50 border-t border-slate-100 pt-1">
                  {rows.map(({ item, score }) => (
                    <li key={item.id} className="flex flex-wrap items-center gap-3 py-2.5">
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-slate-800">
                          {item.name}
                          {score?.not_applicable && (
                            <span className="ml-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-500">
                              KHÔNG PHÁT SINH
                            </span>
                          )}
                        </span>
                        <span className="block text-[11px] text-slate-500">
                          Tỷ trọng {Number(item.weight_percent)}% · thang {Number(item.max_score)} điểm
                          {score?.not_applicable && score.not_applicable_reason
                            ? ` · ${score.not_applicable_reason}` : ''}
                        </span>
                      </span>
                      <span className="text-sm font-bold text-slate-700">
                        {score?.not_applicable
                          ? '—'
                          : score?.manager_score == null ? 'Chưa chấm' : Number(score.manager_score)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              {isOpen && rows.length === 0 && (
                <p className="border-t border-slate-100 pt-3 text-xs text-slate-500">
                  Bộ KPI của kỳ này không còn tiêu chí nào đang dùng.
                </p>
              )}
            </CardContent>
          </Card>
        );
      })}

      <p className="text-[11px] text-slate-400">Cập nhật tới {getTodayString()}.</p>
    </div>
  );
}
