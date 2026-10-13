// ============================================================================
// KPI của tôi.
// ----------------------------------------------------------------------------
// Khu quản trị chấm KPI, và KPI% đó quy thẳng ra tiền qua khoản Lương KPI.
// Nhưng người bị chấm lại không có màn nào để xem mình được bao nhiêu, cao
// hay thấp ở tiêu chí nào — tức là con số quyết định một phần lương của họ
// nằm ngoài tầm nhìn của chính họ.
//
// Màn này cũng là nơi TỰ CHẤM (RC6.2): nhân viên chấm trước, gửi đi, rồi
// quản lý chấm lại. Hai cột điểm nằm cạnh nhau nên chênh lệch lộ ra ngay —
// đó chính là chỗ cần trao đổi.
//
// Nhân viên chỉ ghi được `self_score`. Trigger `guard_kpi_score_columns`
// dưới database chặn mọi đường ghi vào `manager_score`, kể cả gọi thẳng API
// — giao diện chỉ là một trong nhiều lối vào.
// ============================================================================

import { useEffect, useState } from 'react';
import { Send, Target, TriangleAlert } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { KpiEvidenceBox } from '@/components/kpi/KpiEvidenceBox';
import { KpiSheetTable } from '@/components/kpi/KpiSheetTable';
import { isAutoScorable, scoreFromLevels, type ScoreLevel } from '@/lib/kpiScoring';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { describeDbError } from '@/lib/dbError';
import { supabase } from '@/lib/supabase';
import { getTodayString } from '@/lib/utils';

interface Review {
  id: string;
  period_month: string;
  template_id: string | null;
  final_pct: number | null;
  rating: string | null;
  locked_at: string | null;
  self_submitted_at: string | null;
  returned_at: string | null;
  return_reason: string | null;
}

interface Score {
  id: string;
  review_id: string;
  criteria_id: string;
  self_score: number | null;
  /** Ket qua thuc te do chinh nhan vien nhap; database suy ra self_score. */
  self_actual_value: number | null;
  manager_score: number | null;
  actual_value: number | null;
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
  score_levels: ScoreLevel[];
  measure_unit: string | null;
  measure_hint: string | null;
  section: string | null;
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
  const [saving, setSaving] = useState<string | null>(null);
  const { toast } = useToast();

  /**
   * Ghi diem tu cham.
   *
   * Chi ghi `self_score` - trigger duoi database chan san neu co ai co ghi
   * `manager_score`, nen day khong phai lop bao ve duy nhat.
   */
  /**
   * Ghi KET QUA THUC TE, de database suy ra diem.
   *
   * Nhan vien khong phai tu quy doi "98% doanh so" thanh "3 diem" trong dau -
   * do la viec cua bo muc tieu da khai. Ghi vao `self_actual_value`, KHONG
   * phai `actual_value`: cot kia co trigger suy ra diem chinh thuc, nhan vien
   * ghi duoc vao do la tu cham diem that cho minh.
   */
  const setSelfMeasure = async (score: Score, raw: string, criterion: Criteria) => {
    if (!supabase) return;
    const value = raw.trim() === '' ? null : Number(raw);
    if (value !== null && !Number.isFinite(value)) return;

    // Xem truoc ngay tai cho; con so THAT van do trigger ghi, tai lai sau.
    const preview = scoreFromLevels(criterion.score_levels, value);
    setScores((prev) => prev.map((item) => (
      item.id === score.id ? { ...item, self_actual_value: value, self_score: preview } : item
    )));

    const { error } = await supabase
      .from('performance_review_scores')
      .update({ self_actual_value: value })
      .eq('id', score.id);
    if (error) toast('Khong luu duoc ket qua: ' + describeDbError(error), 'error');
  };

  const setSelfScore = async (score: Score, raw: string) => {
    if (!supabase) return;
    const value = raw.trim() === '' ? null : Number(raw);
    if (value !== null && !Number.isFinite(value)) return;

    setScores((prev) => prev.map((item) => (
      item.id === score.id ? { ...item, self_score: value } : item
    )));

    const { error } = await supabase
      .from('performance_review_scores')
      .update({ self_score: value })
      .eq('id', score.id);
    if (error) toast(describeDbError(error), 'error');
  };

  const submitSelf = async (review: Review) => {
    if (!supabase) return;
    setSaving(review.id);
    const { data, error } = await supabase.rpc('submit_kpi_self_scores', { p_review: review.id });
    setSaving(null);
    if (error) return toast(describeDbError(error), 'error');
    setReviews((prev) => prev.map((item) => (
      item.id === review.id ? { ...item, self_submitted_at: (data as string) ?? new Date().toISOString() } : item
    )));
    toast('Đã gửi bản tự chấm cho quản lý.', 'success');
  };

  useEffect(() => {
    const load = async () => {
      if (!supabase || !profile) return;
      setLoading(true);
      const reviewRes = await supabase
        .from('performance_reviews')
        .select('id, period_month, template_id, final_pct, rating, locked_at, self_submitted_at, returned_at, return_reason')
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
          supabase.from('kpi_template_criteria').select('id, template_id, name, weight_percent, max_score, is_active, score_levels, measure_unit, measure_hint, section'),
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
        Bạn tự chấm trước, gửi đi, rồi quản lý chấm lại. KPI% cuối cùng lấy theo{' '}
        <strong className="text-slate-700">điểm quản lý chấm</strong> và là con số dùng để tính
        khoản <strong className="text-slate-700">Lương KPI</strong> trên phiếu lương — thấy chưa
        đúng thì trao đổi trước khi kỳ được khóa.
      </p>

      {reviews.map((review) => {
        const isOpen = openId === review.id;
        const rows = criteria
          .filter((item) => item.template_id === review.template_id && item.is_active)
          .map((item) => ({ item, score: scores.find((s) => s.review_id === review.id && s.criteria_id === item.id) }));

        // Gui roi thi khoa lai - sua sau khi gui lam quan ly cham tren mot
        // ban khac voi ban ho da doc.
        const canSelfScore = !review.locked_at && !review.self_submitted_at;
        const missingSelf = rows.filter(({ score }) => score && score.self_score == null).length;
        // Da nhap ket qua ma van khong ra diem = so do roi ngoai moi muc tieu.
        // Noi dung ly do, khong de nguoi ta tuong minh quen cham.
        const outOfRange = rows.filter(({ score }) => (
          score && score.self_score == null && score.self_actual_value != null
        )).length;

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

              {/* Quan ly tra phieu ve kem ly do. Dat NGAY TREN nut gui, truoc
                  khi ho bam gui lan nua - de duoi cung thi ho gui lai ma chua
                  doc, va vong lap nay lap them mot luot nua. */}
              {isOpen && review.return_reason && !review.locked_at && (
                <p className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs leading-relaxed text-rose-900">
                  <strong>Quản lý trả về để bổ sung:</strong> {review.return_reason}
                </p>
              )}

              {isOpen && rows.length > 0 && canSelfScore && (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-indigo-200 bg-indigo-50/60 px-3.5 py-2.5">
                  <p className="min-w-0 text-xs leading-relaxed text-indigo-900">
                    {missingSelf > 0
                      ? outOfRange > 0
                        ? <><strong>{outOfRange} tiêu chí</strong> có kết quả rơi ngoài mọi mục tiêu đã khai nên chưa ra điểm. Kiểm lại con số, hoặc báo quản lý khai thiếu mục tiêu.</>
                        : <>Còn <strong>{missingSelf} tiêu chí</strong> bạn chưa tự chấm. Chấm đủ rồi hãy gửi.</>
                      : review.return_reason
                        ? <>Sửa theo yêu cầu ở trên rồi gửi lại — <strong>gửi rồi không sửa được nữa</strong>.</>
                        : <>Đã chấm đủ. Gửi đi để quản lý chấm lại — <strong>gửi rồi không sửa được nữa</strong>.</>}
                  </p>
                  <Button
                    size="sm"
                    disabled={missingSelf > 0 || saving === review.id}
                    onClick={() => void submitSelf(review)}
                  >
                    <Send className="h-3.5 w-3.5" />
                    {saving === review.id ? 'Đang gửi…' : 'Gửi bản tự chấm'}
                  </Button>
                </div>
              )}

              {isOpen && rows.length > 0 && review.self_submitted_at && (
                <p className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs leading-relaxed text-slate-600">
                  Đã gửi bản tự chấm. Muốn sửa thì nhờ quản lý trả về.
                </p>
              )}

              {isOpen && rows.length > 0 && (
                <ul className="divide-y divide-slate-50 border-t border-slate-100 pt-1">
                  {rows.map(({ item, score }) => {
                    const autoScore = isAutoScorable(item.score_levels);
                    return (
                    <li key={item.id} className="py-2.5">
                      <div className="flex flex-wrap items-center gap-3">
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
                      {/* Hai cot canh nhau: tu cham va quan ly cham. Nguoi
                          dung thay chenh lech ngay, khong phai nho so cu. */}
                      <span className="flex items-center gap-3">
                        {/* Tieu chi co muc tieu dang SO thi nhap ket qua that,
                            he thong suy ra diem. Bat nhan vien tu quy doi
                            "98% doanh so" thanh "3 diem" la bat ho lam viec ma
                            bo muc tieu da khai de lam ho. */}
                        {autoScore && (
                          <span className="text-center">
                            <span className="block text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                              Kết quả
                            </span>
                            {canSelfScore && score && !score.not_applicable ? (
                              <span className="mt-0.5 flex items-center gap-1">
                                <input
                                  inputMode="decimal"
                                  value={score.self_actual_value == null ? '' : String(score.self_actual_value)}
                                  onChange={(event) => void setSelfMeasure(score, event.target.value.replace(/[^\d.-]/g, ''), item)}
                                  placeholder="—"
                                  aria-label={`Kết quả thực tế của ${item.name}`}
                                  className="h-9 w-20 rounded-lg border border-slate-200 text-center text-sm outline-none focus:border-indigo-500"
                                />
                                {item.measure_unit && (
                                  <span className="text-[11px] text-slate-400">{item.measure_unit}</span>
                                )}
                              </span>
                            ) : (
                              <span className="mt-0.5 block text-sm font-bold text-slate-600">
                                {score?.self_actual_value == null ? '—'
                                  : `${Number(score.self_actual_value)}${item.measure_unit ? ' ' + item.measure_unit : ''}`}
                              </span>
                            )}
                          </span>
                        )}
                        <span className="text-center">
                          <span className="block text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                            Bạn chấm
                          </span>
                          {/* Co muc tieu so thi diem la KET QUA suy ra, khong
                              cho go de len - go de len la ban tu cham va bo
                              muc tieu noi hai dieu khac nhau. */}
                          {autoScore ? (
                            <span className="mt-0.5 block text-sm font-bold text-indigo-700">
                              {score?.not_applicable ? '—'
                                : score?.self_score == null ? '—' : Number(score.self_score)}
                            </span>
                          ) : canSelfScore && score && !score.not_applicable ? (
                            <input
                              inputMode="decimal"
                              value={score.self_score == null ? '' : String(score.self_score)}
                              onChange={(event) => void setSelfScore(score, event.target.value.replace(/[^\d.]/g, ''))}
                              placeholder="—"
                              aria-label={`Tự chấm ${item.name}`}
                              className="mt-0.5 h-9 w-16 rounded-lg border border-slate-200 text-center text-sm outline-none focus:border-indigo-500"
                            />
                          ) : (
                            <span className="mt-0.5 block text-sm font-bold text-slate-600">
                              {score?.not_applicable ? '—' : score?.self_score == null ? '—' : Number(score.self_score)}
                            </span>
                          )}
                        </span>
                        <span className="text-center">
                          <span className="block text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                            Quản lý
                          </span>
                          <span className="mt-0.5 block text-sm font-bold text-slate-800">
                            {score?.not_applicable
                              ? '—'
                              : score?.manager_score == null ? 'Chưa chấm' : Number(score.manager_score)}
                          </span>
                        </span>
                      </span>
                      </div>

                      {/* Minh chung cua chinh diem vua cham.
                          Khong co no thi nguoi duyet chi nhin thay mot con so
                          do nhan vien tu dat ra, khong co gi de doi chieu. */}
                      {score && (
                        <div className="mt-2 space-y-2">
                          <KpiEvidenceBox
                            criteriaId={item.id}
                            uploadedBy={profile?.id ?? null}
                            readOnly
                            label="Yêu cầu của tiêu chí"
                          />
                          <KpiEvidenceBox
                            scoreId={score.id}
                            uploadedBy={profile?.id ?? null}
                            readOnly={!canSelfScore}
                            label="Minh chứng của bạn"
                            hint={canSelfScore
                              ? 'Đính file hoặc viết giải trình. Gửi duyệt rồi thì không sửa được nữa.'
                              : undefined}
                          />
                        </div>
                      )}
                    </li>
                    );
                  })}
                </ul>
              )}

              {/* Bang dung mau phieu giay. Danh sach tren la noi NHAP, bang
                  nay la noi DOC lai toan bo ky - ke ca cot cua quan ly, de
                  nhan vien thay minh cham gi va quan ly chot gi. */}
              {isOpen && rows.length > 0 && (
                <details className="rounded-xl border border-slate-200 bg-white">
                  <summary className="cursor-pointer px-3.5 py-2.5 text-xs font-bold text-slate-700">
                    Bảng tổng hợp theo mẫu phiếu
                  </summary>
                  <div className="border-t border-slate-100 p-2">
                    <KpiSheetTable
                      criteria={rows.map(({ item }) => item)}
                      scores={rows.map(({ score }) => score).filter((row): row is Score => !!row)}
                      finalPct={review.final_pct}
                      rating={review.rating}
                    />
                  </div>
                </details>
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
