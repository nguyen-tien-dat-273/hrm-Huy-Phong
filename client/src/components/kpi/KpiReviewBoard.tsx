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
import { CheckCircle2, ChevronDown, ChevronRight, Lock, LockKeyhole, Plus, Printer, TriangleAlert } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { Avatar } from '@/components/ui/Avatar';
import { KpiEvidenceBox } from '@/components/kpi/KpiEvidenceBox';
import { Skeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/contexts/ToastContext';
import { useConfirm } from '@/contexts/ConfirmContext';
import { supabase } from '@/lib/supabase';
import { describeDbError } from '@/lib/dbError';
import { formatVND } from '@/lib/utils';
import { isAutoScorable, scoreFromLevels, type ScoreLevel } from '@/lib/kpiScoring';
import { buildSheetRows } from '@/lib/kpiSheet';
import { KpiSheetTable } from '@/components/kpi/KpiSheetTable';
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

/** Bốn chặng của một người trong kỳ, theo đúng luồng duyệt. */
type Stage = 'chua_gui' | 'cho_nhan_vien' | 'cho_duyet' | 'da_duyet';

const STAGE_LABEL: Record<Stage | 'tat_ca', string> = {
  tat_ca: 'Tất cả',
  chua_gui: 'Chưa gửi yêu cầu',
  cho_nhan_vien: 'Chờ nhân viên chấm',
  cho_duyet: 'Chờ duyệt',
  da_duyet: 'Đã duyệt',
};

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
  self_submitted_at: string | null;
  returned_at: string | null;
  return_reason: string | null;
  status: string;
}

interface Score {
  id: string;
  review_id: string;
  criteria_id: string;
  self_score: number | null;
  self_actual_value: number | null;
  manager_score: number | null;
  not_applicable: boolean;
  not_applicable_reason: string | null;
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
  const [stageFilter, setStageFilter] = useState<Stage | 'tat_ca'>('tat_ca');
  /** Bộ KPI gán riêng cho từng người — đường chính từ khi KPI thuộc về người. */
  const [schemes, setSchemes] = useState<{ user_id: string; template_id: string }[]>([]);
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

    const [templateRes, criteriaRes, schemeRes] = await Promise.all([
      supabase.from('kpi_position_templates').select('*').order('name'),
      supabase.from('kpi_template_criteria').select('*').order('sort_order'),
      supabase.from('employee_kpi_schemes').select('user_id, template_id')
        .order('effective_from', { ascending: false }),
    ]);
    // Thiếu bảng gán riêng thì vẫn chấm được bằng mẫu theo vị trí như cũ.
    setSchemes((schemeRes.data || []) as { user_id: string; template_id: string }[]);

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

  /**
   * Bộ KPI gợi ý cho một người, đi đúng thứ tự `kpi_scheme_for()` dưới
   * database: bộ RIÊNG của họ trước, hết mới rơi về mẫu khớp vị trí.
   *
   * Trước đây chỉ dò theo vị trí. Từ khi KPI thuộc về từng người, bộ riêng là
   * đường chính — không đọc nó thì người chấm mở phiếu ra thấy "chưa khớp mẫu
   * nào" rồi phải tự tìm trong một danh sách đầy những bộ mang tên người
   * khác, và chọn nhầm là chấm một người bằng tiêu chí của người bên cạnh.
   */
  const suggestTemplate = (profile: Profile) => {
    const own = schemes.find((row) => row.user_id === profile.id);
    const ownTemplate = own ? templates.find((item) => item.id === own.template_id) : undefined;
    if (ownTemplate?.is_active) return ownTemplate;
    return templates.find((item) => item.is_active && item.position_id && item.position_id === profile.position_id);
  };

  const activeTemplates = templates.filter((item) => item.is_active);

  /**
   * Danh sách bộ cho một người chọn tay.
   *
   * Lọc bỏ bộ RIÊNG của người khác: "KPI Ánh Dương" nằm trong ô chọn của
   * Trương Thị Hà là mời chọn nhầm. Bộ riêng của chính họ, và những bộ không
   * thuộc về riêng ai, thì vẫn giữ.
   */
  const templatesFor = (profile: Profile) => {
    const ownedByOthers = new Set(
      schemes.filter((row) => row.user_id !== profile.id).map((row) => row.template_id),
    );
    const mine = new Set(schemes.filter((row) => row.user_id === profile.id).map((row) => row.template_id));
    return activeTemplates.filter((item) => mine.has(item.id) || !ownedByOthers.has(item.id));
  };

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

  const setNotApplicable = async (score: Score, on: boolean) => {
    if (!supabase) return;
    let reason: string | null = null;
    if (on) {
      reason = window.prompt('Vì sao tiêu chí này tháng nay không phát sinh?')?.trim() || null;
      // BRD doi "QL xac nhan kem ly do": tat mot tieu chi lam TANG KPI cua
      // nguoi duoc tat, nen khong cho tat im lang.
      if (!reason) return;
    }
    setScores((prev) => prev.map((item) => (
      item.id === score.id ? { ...item, not_applicable: on, not_applicable_reason: reason } : item
    )));
    const { error } = await supabase
      .from('performance_review_scores')
      .update({ not_applicable: on, not_applicable_reason: reason })
      .eq('id', score.id);
    if (error) toast(describeDbError(error), 'error');
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

  /**
   * Mo lai ban tu cham cho nhan vien sua.
   *
   * Gui xong la khoa, nen phai co duong mo lai - nguoi cham nham mot o roi
   * khong sua duoc se di nho quan tri sua thang duoi database, dung thu can
   * tranh nhat voi du lieu cham diem.
   */
  /**
   * Trả phiếu về cho nhân viên, kèm lý do.
   *
   * Nhánh "Không đạt" trong luồng nghiệp vụ. Lý do là BẮT BUỘC — trả về mà
   * không nói vì sao thì nhân viên mở phiếu ra vẫn không biết sửa gì, đúng
   * bằng lúc chưa có nút này.
   */
  const returnSelf = async (review: Review, person: Profile) => {
    if (!supabase) return;
    const reason = window.prompt(
      `Trả phiếu của ${person.name} về để bổ sung. Nhân viên sẽ đọc được lý do này:`,
      review.return_reason ?? '',
    );
    // Bấm Hủy thì thôi; gõ rỗng thì nhắc, vì đó là nhầm chứ không phải ý muốn.
    if (reason === null) return;
    if (!reason.trim()) return toast('Phải nhập lý do trả về.', 'error');

    const { error } = await supabase.rpc('return_kpi_self_scores', {
      p_review: review.id, p_reason: reason,
    });
    if (error) return toast(describeDbError(error), 'error');
    toast(`Đã trả phiếu về cho ${person.name}.`, 'success');
    await loadReviews(month);
  };

  /**
   * In phiếu KPI của một người, đúng bộ cột của mẫu giấy công ty đang dùng.
   *
   * Mở cửa sổ riêng với một tài liệu HTML tự chứa thay vì dựng @media print
   * cho cả ứng dụng: phiếu này có bố cục riêng, nhét vào CSS in dùng chung
   * thì mỗi lần sửa giao diện lại phải nhớ kiểm tra bản in.
   */
  const printSheet = (person: Profile, review: Review) => {
    const template = review.template_id ? templateById.get(review.template_id) : null;
    const rows = template ? (criteriaByTemplate.get(template.id) || []) : [];
    const reviewScores = scores.filter((item) => item.review_id === review.id);

    const esc = (value: unknown) => String(value ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    // Dung chung ham voi bang tren man: ban in va ban xem lech nhau mot cot
    // la nguoi ky giay va nguoi xem man hinh doc hai con so khac nhau.
    const body = buildSheetRows(rows, reviewScores).map((row) => `<tr>
        <td class="c">${row.index}</td>
        <td>${esc(row.name)}</td>
        <td class="c">${row.weight}%</td>
        <td class="c">${esc(row.plan)}</td>
        <td class="c">${esc(row.selfActual)}</td>
        <td class="c">${esc(row.managerActual)}</td>
        <td class="c">${esc(row.selfScore)}</td>
        <td class="c b">${esc(row.managerScore)}</td>
        <td class="c">${esc(row.ratio)}</td>
        <td>${esc(row.note)}</td>
      </tr>`).join('');

    const html = `<!doctype html><html lang="vi"><head><meta charset="utf-8">
<title>Phiếu KPI ${esc(person.name)} - ${esc(month)}</title>
<style>
  body { font-family: "Times New Roman", serif; font-size: 12pt; margin: 18mm 12mm; color: #000; }
  h1 { font-size: 15pt; text-align: center; margin: 0 0 4px; text-transform: uppercase; }
  .sub { text-align: center; margin: 0 0 14px; font-size: 11pt; }
  .meta { margin-bottom: 10px; font-size: 11pt; }
  .meta span { margin-right: 24px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #000; padding: 4px 6px; font-size: 11pt; vertical-align: top; }
  th { background: #c6dfb4; text-align: center; font-weight: bold; }
  td.c { text-align: center; }
  td.b { font-weight: bold; }
  tfoot td { font-weight: bold; }
  .sign { margin-top: 28px; display: flex; justify-content: space-around; text-align: center; font-size: 11pt; }
  .sign div { width: 32%; }
  .sign .role { font-weight: bold; }
  .sign .hint { font-style: italic; font-size: 10pt; }
  @page { size: A4 landscape; margin: 12mm; }
</style></head><body>
<h1>Phiếu đánh giá KPI</h1>
<p class="sub">Kỳ tháng ${esc(month)}</p>
<p class="meta">
  <span><b>Nhân sự:</b> ${esc(person.name)}</span>
  <span><b>Mã NV:</b> ${esc(person.employee_code || '')}</span>
  <span><b>Bộ KPI:</b> ${esc(template?.name || '')}</span>
</p>
<table>
  <thead>
    <tr>
      <th rowspan="2">Stt</th>
      <th rowspan="2">Mục tiêu BP</th>
      <th rowspan="2">Trọng số</th>
      <th rowspan="2">Kế hoạch/<br>cam kết</th>
      <th colspan="2">Thực hiện</th>
      <th colspan="2">Chấm điểm</th>
      <th rowspan="2">Thực hiện/<br>cam kết</th>
      <th rowspan="2">Ghi chú</th>
    </tr>
    <tr>
      <th>Cá nhân<br>đánh giá</th>
      <th>QL<br>đánh giá</th>
      <th>Cá nhân<br>chấm</th>
      <th>Quản lý<br>chấm</th>
    </tr>
  </thead>
  <tbody>${body}</tbody>
  <tfoot>
    <tr>
      <td colspan="8" style="text-align:right">Kết quả KPI toàn kỳ</td>
      <td class="c">${review.final_pct == null ? '' : Number(review.final_pct) + '%'}</td>
      <td>${esc(review.rating || '')}</td>
    </tr>
  </tfoot>
</table>
<div class="sign">
  <div><p class="role">Người được đánh giá</p><p class="hint">(Ký, ghi rõ họ tên)</p></div>
  <div><p class="role">Người đánh giá</p><p class="hint">(Ký, ghi rõ họ tên)</p></div>
  <div><p class="role">Phê duyệt</p><p class="hint">(Ký, ghi rõ họ tên)</p></div>
</div>
</body></html>`;

    const win = window.open('', '_blank');
    if (!win) {
      return toast('Trình duyệt chặn cửa sổ in. Cho phép pop-up rồi thử lại.', 'error');
    }
    win.document.write(html);
    win.document.close();
    // Doi tai lieu ve xong roi moi goi in, neu khong Chrome in ra trang trong.
    win.onload = () => win.print();
  };

  const lockedCount = reviews.filter((item) => item.locked_at).length;

  /**
   * Một người đang ở chặng nào của kỳ.
   *
   * Bốn chặng đúng theo luồng: admin mở phiếu (gửi yêu cầu) → nhân viên tự
   * chấm rồi gửi → admin duyệt và khoá. Danh sách phẳng trộn cả bốn vào nhau
   * thì công ty ba chục người là không biết phải làm gì tiếp — ai đang chờ
   * mình, ai đang chờ người ta.
   */
  const stageOf = (person: Profile): Stage => {
    const review = reviewByUser.get(person.id);
    if (!review) return 'chua_gui';
    if (review.locked_at) return 'da_duyet';
    return review.self_submitted_at ? 'cho_duyet' : 'cho_nhan_vien';
  };

  const stageCount = (stage: Stage) => profiles.filter((person) => stageOf(person) === stage).length;

  const visibleProfiles = stageFilter === 'tat_ca'
    ? profiles
    : profiles.filter((person) => stageOf(person) === stageFilter);

  /**
   * Mở phiếu hàng loạt cho những người chưa có.
   *
   * Mở từng người một cho cả phòng là hai chục lần bấm giống hệt nhau, và
   * quên một người thì người đó không tự chấm được mà cũng không ai thấy.
   */
  const startAllPending = async () => {
    if (!supabase) return;
    const pending = profiles
      .filter((person) => stageOf(person) === 'chua_gui')
      .map((person) => ({ person, template: suggestTemplate(person) }));
    const ready = pending.filter((row) => row.template);
    const missing = pending.length - ready.length;

    if (ready.length === 0) {
      return toast('Không ai có bộ KPI để mở phiếu. Khai bộ KPI cho họ trước.', 'error');
    }

    const ok = await confirm({
      title: `Gửi yêu cầu chấm KPI cho ${ready.length} người?`,
      message: `Phiếu tháng ${month} sẽ mở ra để họ tự chấm.`
        + (missing > 0 ? ` ${missing} người chưa có bộ KPI nên bỏ qua.` : ''),
      confirmLabel: 'Gửi yêu cầu',
    });
    if (!ok) return;

    setBusy(true);
    const { error } = await supabase.from('performance_reviews').insert(
      ready.map((row) => ({
        period_month: `${month}-01`,
        user_id: row.person.id,
        template_id: row.template!.id,
        reviewer_id: actorId,
        status: 'MANAGER_REVIEW',
      })),
    );
    setBusy(false);
    if (error) return toast('Không mở được phiếu: ' + describeDbError(error), 'error');
    toast(`Đã gửi yêu cầu cho ${ready.length} người.`, 'success');
    await loadReviews(month);
  };

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

        {/* ---- Bảng tổng hợp đánh giá của kỳ ----
             Danh sách bên dưới trả lời "người này bao nhiêu điểm". Khối này
             trả lời câu người phụ trách hỏi trước tiên: cả kỳ đang đứng ở
             đâu, còn bao nhiêu phiếu chưa xong, và điểm rơi vào đâu.
             Không có nó thì muốn biết phải tự cộng tay cả danh sách. */}
        {(() => {
          const scored = reviews.filter((item) => item.final_pct != null);
          const average = scored.length
            ? scored.reduce((sum, item) => sum + Number(item.final_pct), 0) / scored.length
            : 0;
          const notStarted = profiles.filter((person) => !reviewByUser.get(person.id)).length;

          // Gom theo xếp loại do database tính, không tự xếp lại ở client —
          // hai nguồn xếp loại lệch nhau là thứ không ai gỡ được.
          const byRating = new Map<string, number>();
          for (const item of scored) {
            const key = item.rating || 'Chưa xếp loại';
            byRating.set(key, (byRating.get(key) || 0) + 1);
          }

          return (
            <div className="grid gap-2 sm:grid-cols-4">
              {/* Bốn ô này VỪA là con số vừa là bộ lọc. Tách làm hai hàng —
                  một hàng đếm, một hàng lọc — là bày hai lần cùng một thông
                  tin và bắt người dùng tự nối chúng lại. */}
              {([
                { stage: 'chua_gui' as Stage, warn: true },
                { stage: 'cho_nhan_vien' as Stage, warn: true },
                { stage: 'cho_duyet' as Stage, warn: true },
                { stage: 'da_duyet' as Stage, warn: false },
              ]).map(({ stage, warn }) => {
                const count = stageCount(stage);
                const on = stageFilter === stage;
                return (
                  <button
                    key={stage}
                    type="button"
                    onClick={() => setStageFilter(on ? 'tat_ca' : stage)}
                    aria-pressed={on}
                    className={`rounded-xl border px-3.5 py-2.5 text-left transition ${on
                      ? 'border-indigo-400 bg-indigo-50/70 ring-1 ring-indigo-300'
                      : 'border-slate-200 hover:border-indigo-200 hover:bg-slate-50'}`}
                  >
                    <p className="text-[11px] font-semibold text-slate-500">{STAGE_LABEL[stage]}</p>
                    <p className={`mt-0.5 text-lg font-bold ${warn && count > 0 ? 'text-amber-600' : 'text-slate-800'}`}>
                      {count}
                      <span className="ml-1 text-[11px] font-semibold text-slate-400">/{profiles.length}</span>
                    </p>
                  </button>
                );
              })}
              <div className="rounded-xl border border-slate-200 px-3.5 py-2.5 sm:col-span-2">
                <p className="text-[11px] font-semibold text-slate-500">KPI trung bình (phiếu đã khoá)</p>
                <p className="mt-0.5 text-lg font-bold text-slate-800">
                  {scored.length ? `${average.toFixed(1)}%` : '—'}
                </p>
              </div>
              {notStarted > 0 && (
                <div className="flex items-center sm:col-span-2">
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => void startAllPending()}>
                    <Plus className="h-3.5 w-3.5" /> Gửi yêu cầu cho {notStarted} người còn lại
                  </Button>
                </div>
              )}
              {byRating.size > 0 && (
                <div className="sm:col-span-4 flex flex-wrap items-center gap-1.5 rounded-xl border border-slate-200 px-3.5 py-2.5">
                  <span className="text-[11px] font-semibold text-slate-500">Xếp loại:</span>
                  {[...byRating.entries()].map(([rating, count]) => (
                    <Badge key={rating} className="bg-slate-100 text-slate-700">{rating}: {count}</Badge>
                  ))}
                </div>
              )}
            </div>
          );
        })()}

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

        {stageFilter !== 'tat_ca' && (
          <p className="text-[11px] font-semibold text-slate-500">
            Đang lọc: {STAGE_LABEL[stageFilter]} · {visibleProfiles.length} người.{' '}
            <button type="button" onClick={() => setStageFilter('tat_ca')} className="text-indigo-600 underline">
              Bỏ lọc
            </button>
          </p>
        )}

        <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
          {visibleProfiles.length === 0 && (
            <p className="px-4 py-6 text-center text-xs text-slate-400">
              Không ai ở chặng này.
            </p>
          )}
          {visibleProfiles.map((profile) => {
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
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-indigo-600 disabled:opacity-30"
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
                      {/* Trang thai ban tu cham: quan ly can biet nen cham
                          ngay hay cho nhan vien gui xong da. */}
                      {!locked && (
                        review.self_submitted_at ? (
                          <button
                            type="button"
                            onClick={() => void returnSelf(review, profile)}
                            title="Trả về cho nhân viên bổ sung, kèm lý do"
                            className="rounded-lg bg-emerald-50 px-2 py-1 text-[11px] font-bold text-emerald-700 transition hover:bg-emerald-100"
                          >
                            Đã tự chấm · trả về
                          </button>
                        ) : review.returned_at ? (
                          /* Đã trả về rồi: nói rõ đang chờ NHÂN VIÊN, không
                             phải chờ người duyệt — hai trạng thái này nhìn
                             giống nhau nếu chỉ ghi "chờ tự chấm". */
                          <Badge className="bg-rose-50 text-rose-700">Đã trả về, chờ bổ sung</Badge>
                        ) : (
                          <Badge className="bg-amber-50 text-amber-700">Chờ tự chấm</Badge>
                        )
                      )}
                      {locked && <Badge className="bg-slate-100 text-slate-600"><Lock className="mr-1 inline h-3 w-3" />Đã khoá</Badge>}
                    </div>
                  )}

                  {!review ? (
                    <TemplateStarter
                      profile={profile}
                      templates={templatesFor(profile)}
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
                    {review.return_reason && (
                      <p className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs leading-relaxed text-rose-900">
                        <strong>Đã trả về bổ sung:</strong> {review.return_reason}
                      </p>
                    )}
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
                            <div key={row.id} className="rounded-lg bg-white px-3 py-2.5">
                              <div className="flex flex-wrap items-center gap-3">
                              <div className="min-w-0 flex-1">
                                <p className="text-xs font-semibold text-slate-800">
                                  {row.name}
                                  {score?.not_applicable && (
                                    <span className="ml-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-500">
                                      KHÔNG PHÁT SINH
                                    </span>
                                  )}
                                </p>
                                <p className="text-[11px] text-slate-400">
                                  Trọng số {Number(row.weight_percent)}% · thang điểm {Number(row.max_score)}
                                  {auto && ' · hệ thống tự chấm'}
                                </p>
                                {auto && row.measure_hint && (
                                  <p className="mt-0.5 text-[11px] text-slate-400">{row.measure_hint}</p>
                                )}
                              </div>

                              {/* Diem nhan vien tu cham, dat ngay canh o
                                  nhap cua quan ly. Khong de xem cho vui:
                                  chenh lech lon la dau hieu hai ben hieu
                                  tieu chi khac nhau, va do la thu phai noi
                                  ra truoc khi khoa ky. */}
                              {score?.self_score != null && !score.not_applicable && (
                                <span className="rounded-lg bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-600">
                                  Tự chấm: {Number(score.self_score)}
                                </span>
                              )}

                              {/* Tat tieu chi khong phat sinh: ty trong cua no
                                  chia lai cho cac tieu chi con lai, thay vi
                                  tinh 0 diem va keo tut KPI cua nguoi khong co
                                  loi gi. */}
                              <label className="flex items-center gap-1.5 text-[11px] text-slate-500">
                                <input
                                  type="checkbox"
                                  disabled={locked || !score}
                                  checked={score?.not_applicable ?? false}
                                  onChange={(e) => score && void setNotApplicable(score, e.target.checked)}
                                  className="h-3.5 w-3.5 rounded border-slate-300"
                                />
                                Không phát sinh
                              </label>

                              {score?.not_applicable ? (
                                <span className="text-[11px] italic text-slate-400">
                                  {score.not_applicable_reason}
                                </span>
                              ) : auto ? (
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

                              {/* ---- Bảng đối chiếu ----
                                   Yêu cầu của tiêu chí ở trái, minh chứng
                                   nhân viên nộp ở phải. Đây là bước "Đối soát"
                                   trong luồng: chấm lại mà không nhìn bằng
                                   chứng thì chỉ là chép lại điểm nhân viên tự
                                   cho. Người duyệt xoá được minh chứng rác
                                   nhưng không thêm hộ — thêm hộ là làm chứng
                                   cho chính mình. */}
                              {score && (
                                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                                  <KpiEvidenceBox
                                    criteriaId={row.id}
                                    uploadedBy={actorId}
                                    readOnly
                                    label="Yêu cầu của tiêu chí"
                                  />
                                  <KpiEvidenceBox
                                    scoreId={score.id}
                                    uploadedBy={actorId}
                                    readOnly={locked}
                                    label="Nhân viên nộp"
                                  />
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Bảng đúng mẫu giấy, xem ngay trên HRM. Khối chấm điểm
                        bên trên là nơi NHẬP; bảng này là nơi ĐỌC lại toàn bộ trước
                        khi ký — hai việc khác nhau nên bày cạnh nhau. */}
                    <details className="mt-3 rounded-lg border border-slate-200 bg-white">
                      <summary className="cursor-pointer px-3 py-2 text-xs font-bold text-slate-700">
                        Bảng tổng hợp theo mẫu phiếu
                      </summary>
                      <div className="border-t border-slate-100 p-2">
                        <KpiSheetTable
                          criteria={rows}
                          scores={reviewScores}
                          finalPct={review.final_pct}
                          rating={review.rating}
                        />
                      </div>
                    </details>

                    <div className="mt-3 flex justify-end">
                      <Button size="sm" variant="outline" onClick={() => printSheet(profile, review)}>
                        <Printer className="h-3.5 w-3.5" /> In phiếu KPI
                      </Button>
                    </div>

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
