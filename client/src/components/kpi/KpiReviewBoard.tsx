// ============================================================================
// Chấm KPI theo mẫu vị trí, rồi khoá để đẩy sang bảng lương.
// ----------------------------------------------------------------------------
// Trước màn này, cầu nối KPI → lương đứt ở đúng một chỗ: database đã có đủ
// bảng, trigger tự tính `final_pct`, và trigger đẩy KPI_TARGET/KPI_PCT sang
// `payroll_inputs` khi review được khoá — nhưng KHÔNG có giao diện nào tạo
// hay khoá review. Kết quả là khoản LUONG_KPI luôn báo lỗi thiếu biến, và
// không ai biết vì sao.
//
// Màn này cố ý MỎNG: mọi phép tính nằm ở database.
//   - Tạo review  → trigger seed_kpi_review_scores tự sinh dòng điểm theo mẫu
//   - Nhập điểm   → trigger recalc_kpi_review tự tính final_pct và xếp loại
//   - Khoá review → trigger đẩy sang payroll_inputs
// Tính lại ở client là mời một nguồn số liệu thứ hai lệch với nguồn thật.
// ============================================================================

import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronRight, Lock, LockKeyhole, Plus, TriangleAlert } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { Avatar } from '@/components/ui/Avatar';
import { Skeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/contexts/ToastContext';
import { useConfirm } from '@/contexts/ConfirmContext';
import { supabase } from '@/lib/supabase';
import { describeDbError } from '@/lib/dbError';
import { formatVND } from '@/lib/utils';
import { isAutoScorable, scoreFromLevels, type ScoreLevel } from '@/lib/kpiScoring';
import type { Profile } from '@/types';


interface Template {
  id: string;
  code: string;
  name: string;
  block_code: string;
  position_id: string | null;
  default_kpi_amount: number;
  is_active: boolean;
}

interface Criteria {
  id: string;
  template_id: string;
  name: string;
  weight_percent: number;
  max_score: number;
  score_levels: ScoreLevel[];
  measure_unit: string | null;
  measure_hint: string | null;
  sort_order: number;
  is_active: boolean;
}

interface Review {
  id: string;
  period_month: string;
  user_id: string;
  template_id: string | null;
  final_pct: number | null;
  rating: string | null;
  locked_at: string | null;
  status: string;
}

interface Score {
  id: string;
  review_id: string;
  criteria_id: string;
  manager_score: number | null;
  manager_comment: string | null;
  actual_value: number | null;
  auto_scored: boolean;
}

const RATING_STYLE: Record<string, string> = {
  A_PLUS: 'bg-emerald-100 text-emerald-700',
  A: 'bg-emerald-50 text-emerald-700',
  B: 'bg-blue-50 text-blue-700',
  C: 'bg-amber-50 text-amber-700',
  D: 'bg-red-50 text-red-600',
};
const RATING_LABEL: Record<string, string> = {
  A_PLUS: 'A+', A: 'A', B: 'B', C: 'C', D: 'D',
};

export function KpiReviewBoard({ profiles, actorId }: { profiles: Profile[]; actorId: string | null }) {
  const { toast } = useToast();
  const confirm = useConfirm();

  // Ky cham la mot THANG, chon tren man hinh — giong het Bang luong, khong
  // phai mot thuc the tao truoc.
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [templates, setTemplates] = useState<Template[]>([]);
  const [criteria, setCriteria] = useState<Criteria[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [scores, setScores] = useState<Score[]>([]);
  const [loading, setLoading] = useState(true);
  const [supported, setSupported] = useState(true);
  const [openUserId, setOpenUserId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    if (!supabase) return;
    setLoading(true);

    const [templateRes, criteriaRes] = await Promise.all([
      supabase.from('kpi_position_templates').select('*').order('name'),
      supabase.from('kpi_template_criteria').select('*').order('sort_order'),
    ]);

    // Chưa chạy migration KPI: báo đúng lý do thay vì hiện một bảng trống
    // trông như "công ty chưa có mẫu nào".
    if (templateRes.error || criteriaRes.error) {
      setSupported(false);
      setLoading(false);
      return;
    }

    await loadReviews(month);
    setLoading(false);
  };

  const loadReviews = async (targetMonth: string) => {
    if (!supabase) return;
    const { data } = await supabase.from('performance_reviews').select('*').eq('period_month', `${targetMonth}-01`);
    const list = (data || []) as Review[];
    setReviews(list);

    if (list.length === 0) {
      setScores([]);
      return;
    }
    const { data: scoreData } = await supabase
      .from('performance_review_scores')
      .select('*')
      .in('review_id', list.map((item) => item.id));
    setScores((scoreData || []) as Score[]);
  };

  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void loadReviews(month); }, [month]); // eslint-disable-line react-hooks/exhaustive-deps

  const templateById = useMemo(() => new Map(templates.map((item) => [item.id, item])), [templates]);
  const reviewByUser = useMemo(() => new Map(reviews.map((item) => [item.user_id, item])), [reviews]);
  const criteriaByTemplate = useMemo(() => {
    const map = new Map<string, Criteria[]>();
    criteria.filter((item) => item.is_active).forEach((item) => {
      map.set(item.template_id, [...(map.get(item.template_id) || []), item]);
    });
    return map;
  }, [criteria]);

  /** Mẫu gợi ý theo vị trí của nhân sự; không khớp thì để người chấm tự chọn. */
  const suggestTemplate = (profile: Profile) =>
    templates.find((item) => item.is_active && item.position_id && item.position_id === profile.position_id);

  const activeTemplates = templates.filter((item) => item.is_active);

  const startReview = async (profile: Profile, templateId: string) => {
    if (!supabase) return;
    setBusy(true);
    // Chỉ chèn bản ghi — trigger seed_kpi_review_scores tự sinh dòng điểm theo
    // đúng bộ tiêu chí của mẫu, nên client không cần biết mẫu có gì.
    const { error } = await supabase.from('performance_reviews').insert({
      period_month: `${month}-01`,
      user_id: profile.id,
      template_id: templateId,
      reviewer_id: actorId,
      status: 'MANAGER_REVIEW',
    });
    setBusy(false);
    if (error) return toast('Không tạo được phiếu chấm: ' + describeDbError(error), 'error');
    setOpenUserId(profile.id);
    await loadReviews(month);
  };

  /**
   * Ghi SỐ ĐO thực tế. Điểm do trigger của database suy ra rồi tải lại —
   * client cố tình không tự tính để tránh hai nguồn số liệu lệch nhau.
   */
  const setActual = async (score: Score, value: number | null) => {
    if (!supabase) return;
    setScores((prev) => prev.map((item) => (item.id === score.id ? { ...item, actual_value: value } : item)));
    const { error } = await supabase
      .from('performance_review_scores')
      .update({ actual_value: value })
      .eq('id', score.id);
    if (error) toast('Không lưu được số đo: ' + describeDbError(error), 'error');
    await loadReviews(month);
  };

  const setScore = async (score: Score, value: number | null) => {
    if (!supabase) return;
    // Cập nhật ngay trên màn để gõ không bị giật, nhưng final_pct vẫn đọc lại
    // từ database sau khi trigger tính xong.
    setScores((prev) => prev.map((item) => (item.id === score.id ? { ...item, manager_score: value } : item)));
    const { error } = await supabase
      .from('performance_review_scores')
      .update({ manager_score: value, scored_manager_at: new Date().toISOString() })
      .eq('id', score.id);
    if (error) {
      toast('Không lưu được điểm: ' + describeDbError(error), 'error');
      await loadReviews(month);
      return;
    }
    await loadReviews(month);
  };

  const lockReview = async (review: Review, profile: Profile) => {
    const template = review.template_id ? templateById.get(review.template_id) : null;
    const pct = Number(review.final_pct ?? 0);
    const kpiPay = template ? Math.round((Number(template.default_kpi_amount) * pct) / 100) : 0;

    const ok = await confirm({
      title: `Khoá kết quả KPI của ${profile.name}?`,
      message:
        `Kết quả ${pct}% sẽ được đẩy sang bảng lương và KHÔNG sửa điểm được nữa.`
        + (template
          ? ` Lương KPI dự kiến: ${formatVND(kpiPay)} (mức ${formatVND(Number(template.default_kpi_amount))} × ${pct}%).`
          : '')
        + ' Sai sót phát hiện sau khi khoá phải xử lý bằng Điều chỉnh lương ở kỳ sau.',
      confirmLabel: 'Khoá kết quả',
      danger: true,
    });
    if (!ok || !supabase) return;

    setBusy(true);
    const { error } = await supabase
      .from('performance_reviews')
      .update({ locked_at: new Date().toISOString(), status: 'COMPLETED' })
      .eq('id', review.id);
    setBusy(false);
    if (error) return toast('Không khoá được: ' + describeDbError(error), 'error');
    toast(`Đã khoá KPI của ${profile.name}. Số liệu đã sang bảng lương.`, 'success');
    await loadReviews(month);
  };

  if (!supported) {
    return (
      <Card><CardContent>
        <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <TriangleAlert className="mt-0.5 h-5 w-5 flex-shrink-0" />
          <p className="leading-relaxed">
            Chưa chạy migration KPI. Chạy{' '}
            <code className="rounded bg-white px-1.5 py-0.5 font-mono text-xs">
              20260927100000_kpi_position_templates.sql
            </code>{' '}
            và{' '}
            <code className="rounded bg-white px-1.5 py-0.5 font-mono text-xs">
              20260927110000_kpi_payroll_bridge.sql
            </code>{' '}
            trên Supabase để dùng phần chấm KPI.
          </p>
        </div>
      </CardContent></Card>
    );
  }

  if (loading) return <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-20" />)}</div>;

  const lockedCount = reviews.filter((item) => item.locked_at).length;

  return (
    <Card>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-[200px]">
            <Input
              label="Kỳ chấm"
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
            />
          </div>
          <p className="text-xs text-slate-500">
            Đã khoá <strong className="text-slate-700">{lockedCount}</strong>/{reviews.length} phiếu ·{' '}
            {profiles.length} nhân sự
          </p>
        </div>

        <div className="flex items-start gap-2.5 rounded-xl border border-blue-200 bg-blue-50/70 px-4 py-3 text-xs leading-relaxed text-blue-900">
          <LockKeyhole className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <p>
            Chấm xong phải <strong>khoá</strong> thì kết quả mới sang bảng lương. Khoản{' '}
            <strong>Lương KPI</strong> của tháng tương ứng chỉ tính được sau khi khoá — chưa khoá thì
            phiếu lương sẽ báo lỗi thiếu biến, đúng chủ đích để không trả lương trên điểm còn sửa được.
          </p>
        </div>

        {activeTemplates.length === 0 && (
          <p className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-800">
            <TriangleAlert className="mt-0.5 h-4 w-4 flex-shrink-0" />
            Chưa có mẫu KPI nào đang bật. Mẫu phải đủ 100% trọng số mới bật được — kiểm tra lại bộ
            tiêu chí của mẫu.
          </p>
        )}

        <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
          {profiles.map((profile) => {
            const review = reviewByUser.get(profile.id);
            const template = review?.template_id ? templateById.get(review.template_id) : null;
            const isOpen = openUserId === profile.id;
            const locked = Boolean(review?.locked_at);
            const pct = Number(review?.final_pct ?? 0);
            const rows = template ? (criteriaByTemplate.get(template.id) || []) : [];
            const reviewScores = review ? scores.filter((item) => item.review_id === review.id) : [];

            return (
              <div key={profile.id}>
                <div className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <button
                    type="button"
                    onClick={() => setOpenUserId(isOpen ? null : profile.id)}
                    disabled={!review}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-indigo-600 disabled:opacity-30"
                    aria-label={isOpen ? `Thu gọn ${profile.name}` : `Mở ${profile.name}`}
                  >
                    {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  </button>
                  <Avatar name={profile.name} url={profile.avatar_url} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold text-slate-800">{profile.name}</p>
                    <p className="truncate text-xs text-slate-500">
                      {template ? template.name : 'Chưa chấm KPI kỳ này'}
                    </p>
                  </div>

                  {review && (
                    <div className="flex items-center gap-2">
                      <span className="text-right">
                        <strong className="block text-sm tabular-nums text-slate-800">{pct}%</strong>
                        <small className="text-[10px] text-slate-400">kết quả</small>
                      </span>
                      {review.rating && (
                        <Badge className={RATING_STYLE[review.rating] || 'bg-slate-100 text-slate-600'}>
                          {RATING_LABEL[review.rating] || review.rating}
                        </Badge>
                      )}
                      {locked && <Badge className="bg-slate-100 text-slate-600"><Lock className="mr-1 inline h-3 w-3" />Đã khoá</Badge>}
                    </div>
                  )}

                  {!review ? (
                    <TemplateStarter
                      profile={profile}
                      templates={activeTemplates}
                      suggested={suggestTemplate(profile)}
                      disabled={busy || activeTemplates.length === 0}
                      onStart={(templateId) => void startReview(profile, templateId)}
                    />
                  ) : !locked ? (
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => void lockReview(review, profile)}>
                      <Lock className="h-3.5 w-3.5" /> Khoá kết quả
                    </Button>
                  ) : null}
                </div>

                {isOpen && review && (
                  <div className="border-t border-slate-100 bg-slate-50/60 px-4 py-3">
                    {rows.length === 0 ? (
                      <p className="py-3 text-center text-xs text-slate-500">
                        Mẫu này chưa có tiêu chí nào đang bật.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {rows.map((row) => {
                          const score = reviewScores.find((item) => item.criteria_id === row.id);
                          const levels = Array.isArray(row.score_levels) ? row.score_levels : [];
                          const auto = isAutoScorable(levels);
                          // Điểm xem trước tính ở client để người nhập thấy
                          // ngay; điểm THẬT vẫn là manager_score do trigger ghi.
                          const preview = auto ? scoreFromLevels(levels, score?.actual_value ?? null) : null;
                          const shown = score?.manager_score ?? preview;

                          return (
                            <div key={row.id} className="flex flex-wrap items-center gap-3 rounded-lg bg-white px-3 py-2.5">
                              <div className="min-w-0 flex-1">
                                <p className="text-xs font-semibold text-slate-800">{row.name}</p>
                                <p className="text-[11px] text-slate-400">
                                  Trọng số {Number(row.weight_percent)}% · thang điểm {Number(row.max_score)}
                                  {auto && ' · hệ thống tự chấm'}
                                </p>
                                {auto && row.measure_hint && (
                                  <p className="mt-0.5 text-[11px] text-slate-400">{row.measure_hint}</p>
                                )}
                              </div>

                              {auto ? (
                                <>
                                  {/* Người chấm chỉ nhập SỐ ĐO, không tự quy ra
                                      điểm — đó là chỗ mỗi quản lý quy một kiểu. */}
                                  <label className="flex items-center gap-1.5 text-[11px] text-slate-500">
                                    Số đo
                                    <input
                                      inputMode="decimal"
                                      disabled={locked || !score}
                                      value={score?.actual_value == null ? '' : String(Number(score.actual_value))}
                                      onChange={(e) => {
                                        const clean = e.target.value.replace(/[^\d.-]/g, '');
                                        if (score) void setActual(score, clean === '' || clean === '-' ? null : Number(clean));
                                      }}
                                      className="h-9 w-24 rounded-lg border border-slate-200 bg-white px-2 text-right text-xs tabular-nums outline-none focus:border-indigo-500 disabled:bg-slate-100 disabled:text-slate-400"
                                    />
                                    {row.measure_unit && <span className="text-slate-400">{row.measure_unit}</span>}
                                  </label>

                                  <span className="min-w-[92px] text-right">
                                    {score?.actual_value == null ? (
                                      <span className="text-[11px] text-slate-400">chưa nhập</span>
                                    ) : shown == null ? (
                                      /* Số đo rơi ngoài mọi khoảng của thang —
                                         thang khai thiếu, không bịa ra 0 điểm. */
                                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700">
                                        <TriangleAlert className="h-3 w-3" /> ngoài thang
                                      </span>
                                    ) : (
                                      <>
                                        <strong className="block text-sm tabular-nums text-slate-800">
                                          {shown}/{Number(row.max_score)}
                                        </strong>
                                        <small className="text-[10px] text-slate-400">
                                          {score?.auto_scored ? 'tự chấm' : 'chấm tay'}
                                        </small>
                                      </>
                                    )}
                                  </span>
                                </>
                              ) : levels.length > 0 ? (
                                <select
                                  disabled={locked || !score}
                                  value={score?.manager_score == null ? '' : String(Number(score.manager_score))}
                                  onChange={(e) => score && void setScore(score, e.target.value === '' ? null : Number(e.target.value))}
                                  className="h-9 min-w-[200px] rounded-lg border border-slate-200 bg-white px-2 text-xs outline-none focus:border-indigo-500 disabled:bg-slate-100 disabled:text-slate-400"
                                >
                                  <option value="">Chưa chấm</option>
                                  {levels.map((level) => (
                                    <option key={level.score} value={level.score}>
                                      {level.score} — {level.label}
                                    </option>
                                  ))}
                                </select>
                              ) : (
                                <input
                                  inputMode="decimal"
                                  disabled={locked || !score}
                                  placeholder={`0–${Number(row.max_score)}`}
                                  value={score?.manager_score == null ? '' : String(Number(score.manager_score))}
                                  onChange={(e) => {
                                    const clean = e.target.value.replace(/[^\d.]/g, '');
                                    if (score) void setScore(score, clean === '' ? null : Number(clean));
                                  }}
                                  className="h-9 w-24 rounded-lg border border-slate-200 bg-white px-2 text-right text-xs tabular-nums outline-none focus:border-indigo-500 disabled:bg-slate-100 disabled:text-slate-400"
                                />
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {template && (
                      <p className="mt-3 text-xs leading-relaxed text-slate-500">
                        Mức lương KPI của mẫu này: <strong className="text-slate-700">{formatVND(Number(template.default_kpi_amount))}</strong>
                        {' · '}Lương KPI theo kết quả hiện tại:{' '}
                        <strong className="text-indigo-700">
                          {formatVND(Math.round((Number(template.default_kpi_amount) * pct) / 100))}
                        </strong>
                        {!locked && ' (chưa khoá nên chưa sang bảng lương)'}
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

/** Chọn mẫu rồi mở phiếu chấm. Gợi ý sẵn mẫu khớp vị trí của người đó. */
function TemplateStarter({
  profile, templates, suggested, disabled, onStart,
}: {
  profile: Profile;
  templates: Template[];
  suggested?: Template;
  disabled: boolean;
  onStart: (templateId: string) => void;
}) {
  const [templateId, setTemplateId] = useState(suggested?.id ?? '');

  useEffect(() => { if (suggested?.id) setTemplateId(suggested.id); }, [suggested?.id]);

  return (
    <div className="flex items-center gap-2">
      <select
        value={templateId}
        onChange={(e) => setTemplateId(e.target.value)}
        aria-label={`Mẫu KPI cho ${profile.name}`}
        className="h-9 min-w-[180px] rounded-lg border border-slate-200 bg-white px-2 text-xs outline-none focus:border-indigo-500"
      >
        <option value="">Chọn mẫu KPI…</option>
        {templates.map((item) => (
          <option key={item.id} value={item.id}>{item.name}</option>
        ))}
      </select>
      <Button size="sm" disabled={disabled || !templateId} onClick={() => onStart(templateId)}>
        <Plus className="h-3.5 w-3.5" /> Chấm
      </Button>
    </div>
  );
}
