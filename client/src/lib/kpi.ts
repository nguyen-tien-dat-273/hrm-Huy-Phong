// ============================================================================
// KPI — kiểu dữ liệu, nhãn và phép tính dùng chung.
// ----------------------------------------------------------------------------
// Database là nơi chốt điểm (`kpi_recalc_sheet`). Bản tính ở đây chỉ để thấy
// ngay KPI% khi đang chấm, trước khi bấm lưu — hai bên phải ra cùng một số.
// ============================================================================

export type KpiBlock = 'VAN_PHONG' | 'KINH_DOANH';
export type KpiGroup = 'QUANT' | 'QUAL';
export type KpiMethod = 'LEVEL' | 'RANGE' | 'PENALTY' | 'BINARY';
export type KpiSource = 'SALES_PCT' | 'COLLECT_PCT' | 'COVERAGE_PCT' | 'LATE_COUNT';
export type KpiSheetStatus = 'DRAFT' | 'PENDING' | 'REJECTED' | 'BOARD' | 'APPROVED';
export type KpiSalesStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'CHANGES';
export type KpiLinkSource =
  | 'KPI_PCT' | 'KPI_BONUS' | 'SALES_TARGET' | 'SALES_ACTUAL' | 'SALES_PCT' | 'COLLECT_ACTUAL' | 'COLLECT_PCT' | 'YEAR_BONUS';

export interface KpiLevel { score: number; label: string }
export interface KpiRange { min: number | null; max: number | null; score: number }

export interface KpiGrade { code: string; label: string; min: number }

export interface KpiSettings {
  id: string;
  effective_from: string;
  cap_pct: number;
  bonus_max_pct: number;
  grades: KpiGrade[];
  open_day: number;
  self_due_day: number;
  manager_due_day: number;
  manager_due_time: string;
  board_due_day: number;
  board_due_time: string;
  lock_day: number;
  lock_time: string;
  note: string | null;
}

/** Phần định nghĩa tiêu chí — chung cho bộ KPI và bản chụp trên phiếu. */
export interface KpiCriterion {
  category: string;
  name: string;
  measure: string | null;
  group_code: KpiGroup;
  weight: number;
  standard_score: number;
  method: KpiMethod;
  levels: KpiLevel[];
  ranges: KpiRange[];
  value_unit: string | null;
  penalty_pct: number | null;
  allow_over: boolean;
  source: KpiSource | null;
}

export interface KpiSetItem extends KpiCriterion {
  id: string;
  set_id: string;
  sort_order: number;
  note: string | null;
}

export interface KpiSet {
  id: string;
  code: string;
  name: string;
  block: KpiBlock;
  user_id: string | null;
  position_id: string | null;
  unit_id: string | null;
  base_set_id: string | null;
  effective_from: string;
  is_active: boolean;
  board_review: boolean;
  note: string | null;
  version: number;
  updated_at: string;
}

export interface KpiPeriod {
  month_start: string;
  status: 'OPEN' | 'LOCKED';
  opened_at: string;
  locked_at: string | null;
  locked_by: string | null;
}

export interface KpiSheet {
  id: string;
  period_month: string;
  user_id: string;
  set_id: string | null;
  set_name: string;
  block: KpiBlock;
  unit_id: string | null;
  reviewer_id: string | null;
  board_review: boolean;
  status: KpiSheetStatus;
  explanation: string | null;
  self_pct: number | null;
  manager_pct: number | null;
  bonus_pct: number;
  bonus_note: string | null;
  final_pct: number | null;
  grade: string | null;
  return_reason: string | null;
  submitted_at: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
  version: number;
  payroll_synced_at: string | null;
  updated_at: string;
}

export interface KpiSheetItem extends KpiCriterion {
  id: string;
  sheet_id: string;
  sort_order: number;
  self_value: number | null;
  self_score: number | null;
  self_na: boolean;
  self_note: string | null;
  evidence_url: string | null;
  evidence_path: string | null;
  evidence_name: string | null;
  mgr_value: number | null;
  mgr_score: number | null;
  mgr_na: boolean;
  mgr_reason: string | null;
  eff_weight: number | null;
  self_points: number | null;
  mgr_points: number | null;
}

export interface KpiSalesTarget {
  id: string;
  period_month: string;
  user_id: string;
  sales_target: number;
  collect_target: number;
  customers_target: number;
  sales_actual: number | null;
  collect_actual: number | null;
  customers_actual: number | null;
  status: KpiSalesStatus;
  review_reason: string | null;
  confirm_status: 'CONFIRMED' | 'DISPUTED' | null;
  dispute_note: string | null;
  actual_note: string | null;
}

export interface KpiLog {
  id: number;
  sheet_id: string | null;
  period_month: string | null;
  user_id: string | null;
  action: string;
  from_status: string | null;
  to_status: string | null;
  reason: string | null;
  detail: Record<string, unknown> | null;
  actor_id: string | null;
  created_at: string;
}

export interface KpiReopenRequest {
  id: string;
  sheet_id: string;
  reason: string;
  minutes_path: string | null;
  minutes_name: string | null;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  requested_by: string | null;
  requested_at: string;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  old_pct: number | null;
  new_pct: number | null;
  closed_at: string | null;
}

export interface KpiYearReview {
  year: number;
  user_id: string;
  months: number;
  avg_pct: number | null;
  grade: string | null;
  late_count: number | null;
  discipline_flag: boolean;
  note: string | null;
  bonus_amount: number | null;
  raise_pct: number | null;
  payout_month: string | null;
  decision_reason: string | null;
  status: 'DRAFT' | 'APPROVED';
  approved_by: string | null;
  approved_at: string | null;
}

export interface KpiPayrollLink {
  source: KpiLinkSource;
  component_code: string | null;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Nhãn
// ---------------------------------------------------------------------------

export const BLOCK_LABEL: Record<KpiBlock, string> = { VAN_PHONG: 'Văn phòng', KINH_DOANH: 'Kinh doanh' };
export const GROUP_LABEL: Record<KpiGroup, string> = { QUANT: 'Định lượng', QUAL: 'Định tính' };
export const GROUP_ROMAN: Record<KpiGroup, string> = { QUANT: 'I', QUAL: 'II' };

export const METHOD_LABEL: Record<KpiMethod, string> = {
  LEVEL: 'Thang bậc',
  RANGE: 'Dải quy đổi',
  PENALTY: 'Trừ theo lần vi phạm',
  BINARY: 'Đạt / không đạt',
};

export const SOURCE_LABEL: Record<KpiSource, string> = {
  SALES_PCT: '% đạt doanh số bán',
  COLLECT_PCT: '% đạt doanh số thu',
  COVERAGE_PCT: '% khách hàng có đơn',
  LATE_COUNT: 'Số lần đi muộn, về sớm (chấm công)',
};

export const SHEET_STATUS_LABEL: Record<KpiSheetStatus, string> = {
  DRAFT: 'Đang tự chấm',
  PENDING: 'Chờ quản lý',
  REJECTED: 'Bị trả về',
  BOARD: 'Chờ BGĐ',
  APPROVED: 'Đã duyệt',
};

export const SHEET_STATUS_TONE: Record<KpiSheetStatus, string> = {
  DRAFT: 'bg-slate-100 text-slate-600 ring-slate-200',
  PENDING: 'bg-amber-50 text-amber-700 ring-amber-200',
  REJECTED: 'bg-red-50 text-red-600 ring-red-200',
  BOARD: 'bg-violet-50 text-violet-700 ring-violet-200',
  APPROVED: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
};

export const SALES_STATUS_LABEL: Record<KpiSalesStatus, string> = {
  DRAFT: 'Nháp',
  SUBMITTED: 'Đã gửi',
  APPROVED: 'Đã duyệt',
  CHANGES: 'Cần điều chỉnh',
};

export const SALES_STATUS_TONE: Record<KpiSalesStatus, string> = {
  DRAFT: 'bg-slate-100 text-slate-600 ring-slate-200',
  SUBMITTED: 'bg-amber-50 text-amber-700 ring-amber-200',
  APPROVED: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  CHANGES: 'bg-red-50 text-red-600 ring-red-200',
};

export const GRADE_TONE: Record<string, string> = {
  'A+': 'text-emerald-700',
  A: 'text-emerald-600',
  B: 'text-sky-700',
  C: 'text-amber-700',
  D: 'text-red-600',
};

export const LINK_SOURCES: ReadonlyArray<{ source: KpiLinkSource; label: string; unit: string; hint: string }> = [
  { source: 'KPI_PCT', label: 'Tỷ lệ KPI chốt', unit: '%', hint: '97,5 nghĩa là 97,5% — đã gồm thưởng trọng điểm, chặn trần' },
  { source: 'KPI_BONUS', label: 'Thưởng trọng điểm', unit: '%', hint: 'Phần thưởng trọng điểm quản lý đề xuất' },
  { source: 'SALES_TARGET', label: 'Doanh số khoán', unit: 'đồng', hint: 'Chỉ tiêu doanh số đã được Ban Giám đốc duyệt' },
  { source: 'SALES_ACTUAL', label: 'Doanh số cắt mã', unit: 'đồng', hint: 'Số thực hiện của nhân viên kinh doanh' },
  { source: 'SALES_PCT', label: '% đạt doanh số khoán', unit: '%', hint: 'Doanh số cắt mã ÷ doanh số khoán' },
  { source: 'COLLECT_ACTUAL', label: 'Doanh số thu tiền', unit: 'đồng', hint: 'Số thu thực hiện' },
  { source: 'COLLECT_PCT', label: '% đạt chỉ tiêu thu', unit: '%', hint: 'Doanh số thu ÷ chỉ tiêu thu' },
  { source: 'YEAR_BONUS', label: 'Thưởng năm đã duyệt', unit: 'đồng', hint: 'Điền vào tháng chi thưởng khi BGĐ phê duyệt' },
];

export const LOG_ACTION_LABEL: Record<string, string> = {
  CREATE: 'Tạo phiếu',
  SUBMIT: 'Gửi duyệt',
  APPROVE: 'Duyệt',
  MANAGER_APPROVE: 'Quản lý duyệt, chuyển BGĐ',
  BOARD_APPROVE: 'BGĐ duyệt cuối',
  RETURN: 'Trả về',
  PERIOD_OPEN: 'Mở kỳ',
  PERIOD_LOCK: 'Khoá sổ',
  REOPEN_REQUEST: 'Đề nghị mở lại',
  REOPEN: 'Mở lại phiếu',
  REOPEN_REJECT: 'Không duyệt mở lại',
  SALES_SUBMIT: 'Gửi duyệt chỉ tiêu',
  SALES_APPROVE: 'Duyệt chỉ tiêu',
  SALES_CHANGES: 'Yêu cầu điều chỉnh chỉ tiêu',
  SALES_CONFIRM: 'Xác nhận số liệu',
  SALES_DISPUTE: 'Khiếu nại số liệu',
  YEAR_SAVE: 'Lưu xét thưởng năm',
  YEAR_APPROVE: 'Duyệt thưởng năm',
};

// ---------------------------------------------------------------------------
// Số
// ---------------------------------------------------------------------------

const pctFormat = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 });
const numFormat = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 });

export const fmtPct = (value: number | null | undefined) =>
  value == null || !Number.isFinite(Number(value)) ? '—' : `${pctFormat.format(Number(value))}%`;
export const fmtNum = (value: number | null | undefined) =>
  value == null || !Number.isFinite(Number(value)) ? '—' : numFormat.format(Number(value));

/** "1.500.000" / "1,5" → số; trống → null. */
export function parseNum(raw: string): number | null {
  const text = raw.trim();
  if (!text) return null;
  const normalized = /,\d{1,2}$/.test(text) || (text.includes(',') && !text.includes('.'))
    ? text.replace(/\./g, '').replace(',', '.')
    : text.replace(/,/g, '');
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

export function gradeOf(pct: number | null | undefined, grades: readonly KpiGrade[]): KpiGrade | null {
  if (pct == null) return null;
  return [...grades].sort((a, b) => b.min - a.min).find((grade) => pct >= grade.min) ?? null;
}

export const DEFAULT_GRADES: KpiGrade[] = [
  { code: 'A+', label: 'Rất tốt', min: 100.01 },
  { code: 'A', label: 'Tốt', min: 95 },
  { code: 'B', label: 'Khá', min: 81 },
  { code: 'C', label: 'Trung bình khá', min: 51 },
  { code: 'D', label: 'Kém', min: 0 },
];

// ---------------------------------------------------------------------------
// Chấm điểm — bản sao của kpi_recalc_sheet
// ---------------------------------------------------------------------------

export function scoreFromValue(ranges: readonly KpiRange[], value: number | null): number | null {
  if (value == null) return null;
  const hits = ranges.filter((range) => (range.min == null || value >= range.min) && (range.max == null || value < range.max));
  return hits.length ? Math.max(...hits.map((range) => range.score)) : null;
}

export interface ScoreInput { value: number | null; score: number | null; na: boolean }

/** Điểm tiêu chí từ giá trị đo (dải quy đổi / trừ theo lần) hoặc điểm chọn. */
export function resolvedScore(item: KpiCriterion, input: ScoreInput): number | null {
  if (item.method === 'RANGE') return scoreFromValue(item.ranges, input.value);
  if (item.method === 'PENALTY') return input.value == null ? null : item.standard_score;
  return input.score;
}

/**
 * Tỷ trọng thực tế khi có tiêu chí "không phát sinh": phần đó chia cho các tiêu
 * chí còn lại cùng hạng mục; cả hạng mục không phát sinh thì chia cho nhóm;
 * cả nhóm không phát sinh thì chia cho toàn phiếu.
 */
export function effectiveWeights(items: ReadonlyArray<KpiCriterion & { na: boolean }>): number[] {
  const catTotal = new Map<string, number>();
  const catLive = new Map<string, number>();
  for (const item of items) {
    catTotal.set(item.category, (catTotal.get(item.category) ?? 0) + item.weight);
    if (!item.na) catLive.set(item.category, (catLive.get(item.category) ?? 0) + item.weight);
  }
  const groupLive = new Map<string, number>();
  const groupDead = new Map<string, number>();
  for (const item of items) {
    const live = (catLive.get(item.category) ?? 0) > 0;
    const map = live ? groupLive : groupDead;
    map.set(item.group_code, (map.get(item.group_code) ?? 0) + item.weight);
  }
  let liveTotal = 0;
  let deadTotal = 0;
  for (const group of new Set(items.map((item) => item.group_code))) {
    const live = groupLive.get(group) ?? 0;
    const dead = groupDead.get(group) ?? 0;
    if (live > 0) liveTotal += live + dead; else deadTotal += dead;
  }
  return items.map((item) => {
    const live = catLive.get(item.category) ?? 0;
    if (item.na || live === 0) return 0;
    const gLive = groupLive.get(item.group_code) ?? 0;
    const gDead = groupDead.get(item.group_code) ?? 0;
    return item.weight * (catTotal.get(item.category)! / live) * ((gLive + gDead) / gLive) * ((liveTotal + deadTotal) / liveTotal);
  });
}

export function pointsOf(item: KpiCriterion, eff: number, input: ScoreInput): number | null {
  if (input.na) return 0;
  if (item.method === 'PENALTY') {
    return input.value == null ? null : Math.max(0, eff - input.value * (item.penalty_pct ?? 0));
  }
  const score = resolvedScore(item, input);
  if (score == null) return null;
  const cap = item.allow_over ? 5 : item.standard_score;
  return (eff * Math.min(score, cap)) / item.standard_score;
}

export interface SheetPreview {
  eff: number[];
  points: Array<number | null>;
  /** Tổng các tiêu chí đã chấm. */
  total: number;
  complete: boolean;
}

export function previewSheet(items: readonly KpiCriterion[], inputs: readonly ScoreInput[]): SheetPreview {
  const eff = effectiveWeights(items.map((item, index) => ({ ...item, na: inputs[index]?.na ?? false })));
  const points = items.map((item, index) => pointsOf(item, eff[index], inputs[index] ?? { value: null, score: null, na: false }));
  const total = points.reduce<number>((sum, value) => sum + (value ?? 0), 0);
  return { eff, points, total: Math.round(total * 100) / 100, complete: points.every((value) => value != null) };
}

export function finalPct(managerPct: number, bonus: number, cap: number): number {
  return Math.round(Math.min(cap, managerPct + bonus) * 100) / 100;
}

/** Các mức điểm chọn được của tiêu chí thang bậc: bước 0,5, có nhãn ở mức đã mô tả. */
export function scoreOptions(item: KpiCriterion): Array<{ value: string; label: string }> {
  if (item.method === 'BINARY') {
    return [
      { value: String(item.standard_score), label: item.levels.find((level) => level.score === item.standard_score)?.label ?? 'Đạt' },
      { value: '0', label: item.levels.find((level) => level.score === 0)?.label ?? 'Không đạt' },
    ];
  }
  const max = item.allow_over ? 5 : item.standard_score;
  const step = item.standard_score <= 2 && !item.allow_over ? 1 : 0.5;
  const options: Array<{ value: string; label: string }> = [];
  for (let score = max; score >= 0; score -= step) {
    const rounded = Math.round(score * 10) / 10;
    const level = item.levels.find((entry) => Number(entry.score) === rounded);
    const over = rounded > item.standard_score;
    options.push({
      value: String(rounded),
      label: `${fmtNum(rounded)}${level ? ` · ${level.label}` : over ? ' · Vượt chuẩn' : ''}`,
    });
  }
  return options;
}

export function rangeLabel(range: KpiRange, unit: string | null): string {
  const u = unit === '%' ? '%' : unit ? ` ${unit}` : '';
  if (range.min != null && range.max != null) return `${fmtNum(range.min)} – dưới ${fmtNum(range.max)}${u}`;
  if (range.min != null) return `Từ ${fmtNum(range.min)}${u}`;
  if (range.max != null) return `Dưới ${fmtNum(range.max)}${u}`;
  return 'Mọi giá trị';
}

// ---------------------------------------------------------------------------
// Kiểm bộ KPI — bản sao của kpi_set_problems để báo ngay khi soạn
// ---------------------------------------------------------------------------

export function setProblems(items: readonly KpiCriterion[]): string[] {
  if (items.length === 0) return ['Bộ KPI chưa có tiêu chí nào.'];
  const problems: string[] = [];
  const total = items.reduce((sum, item) => sum + (Number(item.weight) || 0), 0);
  if (Math.abs(total - 100) > 0.01) problems.push(`Tổng tỷ trọng đang là ${fmtNum(total)}%, phải bằng 100%.`);
  const categories = new Set(items.map((item) => item.category.trim().toLowerCase()));
  if (categories.size > 10) problems.push(`Có ${categories.size} hạng mục, tối đa 10.`);
  for (const item of items) {
    const name = item.name.trim() || '(chưa đặt tên)';
    if (!item.category.trim()) problems.push(`“${name}”: chưa có hạng mục.`);
    if (!item.name.trim()) problems.push('Có tiêu chí chưa đặt tên.');
    if (!(Number(item.weight) > 0)) problems.push(`“${name}”: tỷ trọng phải lớn hơn 0.`);
    if (item.method === 'LEVEL' && item.levels.length === 0) problems.push(`“${name}”: chưa mô tả mức điểm.`);
    if (item.method === 'RANGE') {
      if (item.ranges.length === 0) problems.push(`“${name}”: chưa có dải quy đổi.`);
      for (let i = 0; i < item.ranges.length; i += 1) {
        for (let j = i + 1; j < item.ranges.length; j += 1) {
          const a = item.ranges[i];
          const b = item.ranges[j];
          if ((a.min ?? -Infinity) < (b.max ?? Infinity) && (b.min ?? -Infinity) < (a.max ?? Infinity)) {
            problems.push(`“${name}”: các dải quy đổi chồng lên nhau.`);
            i = item.ranges.length;
            break;
          }
        }
      }
    }
    if (item.method === 'PENALTY' && !(Number(item.penalty_pct) > 0)) problems.push(`“${name}”: chưa có mức trừ mỗi lần vi phạm.`);
  }
  return [...new Set(problems)];
}

/** Tổng tỷ trọng theo hạng mục và theo nhóm, giữ thứ tự xuất hiện. */
export function weightTotals(items: readonly KpiCriterion[]) {
  const byCategory = new Map<string, number>();
  const byGroup: Record<KpiGroup, number> = { QUANT: 0, QUAL: 0 };
  for (const item of items) {
    byCategory.set(item.category, (byCategory.get(item.category) ?? 0) + (Number(item.weight) || 0));
    byGroup[item.group_code] += Number(item.weight) || 0;
  }
  const total = byGroup.QUANT + byGroup.QUAL;
  return { byCategory, byGroup, total: Math.round(total * 1000) / 1000 };
}

/** Gom tiêu chí theo nhóm → hạng mục, giữ thứ tự. */
export function groupCriteria<T extends KpiCriterion>(items: readonly T[]) {
  const groups: Array<{ group: KpiGroup; categories: Array<{ name: string; items: Array<{ item: T; index: number }> }> }> = [];
  (['QUANT', 'QUAL'] as KpiGroup[]).forEach((group) => {
    const categories: Array<{ name: string; items: Array<{ item: T; index: number }> }> = [];
    items.forEach((item, index) => {
      if (item.group_code !== group) return;
      let category = categories.find((entry) => entry.name === item.category);
      if (!category) { category = { name: item.category, items: [] }; categories.push(category); }
      category.items.push({ item, index });
    });
    if (categories.length) groups.push({ group, categories });
  });
  return groups;
}

// ---------------------------------------------------------------------------
// Bộ KPI áp cho một người — bản sao của kpi_set_for để vẽ cây
// ---------------------------------------------------------------------------

export type KpiSetLevel = 'PERSON' | 'POSITION' | 'UNIT';

export interface ResolvedKpiSet {
  set: KpiSet;
  level: KpiSetLevel;
  /** Bộ chung: đơn vị khai bộ (chính đơn vị của người hoặc cấp trên). */
  unitId: string | null;
}

/**
 * Cá nhân > vị trí > KPI chung của đơn vị gần nhất (đi ngược lên gốc), cùng
 * cấp thì bộ hiệu lực muộn nhất thắng. Chỉ xét bộ đang áp dụng.
 */
export function kpiSetFor(
  person: { id: string; unit_id?: string | null; position_id?: string | null },
  sets: readonly KpiSet[],
  lineage: readonly string[],
  month: string,
): ResolvedKpiSet | null {
  const candidates = sets.filter((set) => set.is_active && set.effective_from <= month);
  const latest = (rows: KpiSet[]) => [...rows].sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0];
  const own = latest(candidates.filter((set) => set.user_id === person.id));
  if (own) return { set: own, level: 'PERSON', unitId: null };
  if (person.position_id) {
    const byPosition = latest(candidates.filter((set) => !set.user_id && set.position_id === person.position_id));
    if (byPosition) return { set: byPosition, level: 'POSITION', unitId: null };
  }
  for (const unitId of lineage) {
    const shared = latest(candidates.filter((set) => !set.user_id && !set.position_id && set.unit_id === unitId));
    if (shared) return { set: shared, level: 'UNIT', unitId };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Mốc thời gian của kỳ
// ---------------------------------------------------------------------------

export type KpiDeadlineKind = 'OPEN' | 'SELF' | 'MANAGER' | 'BOARD' | 'LOCK';

/** Mốc của kỳ tháng `month` ('YYYY-MM-01') theo giờ máy người dùng (công ty dùng giờ Việt Nam). */
export function deadlineOf(month: string, kind: KpiDeadlineKind, settings: KpiSettings | null): Date {
  const s = settings ?? {
    open_day: 25, self_due_day: 2, manager_due_day: 3, manager_due_time: '17:00',
    board_due_day: 4, board_due_time: '12:00', lock_day: 4, lock_time: '17:00',
  };
  const [year, mon] = month.split('-').map(Number);
  const at = (y: number, m: number, day: number, time: string) => {
    const [hh, mm] = time.split(':').map(Number);
    return new Date(y, m - 1, day, hh || 0, mm || 0);
  };
  const ny = mon === 12 ? year + 1 : year;
  const nm = mon === 12 ? 1 : mon + 1;
  switch (kind) {
    case 'OPEN': return at(year, mon, s.open_day, '00:00');
    case 'SELF': return at(ny, nm, s.self_due_day, '23:59');
    case 'MANAGER': return at(ny, nm, s.manager_due_day, s.manager_due_time);
    case 'BOARD': return at(ny, nm, s.board_due_day, s.board_due_time);
    default: return at(ny, nm, s.lock_day, s.lock_time);
  }
}

export const fmtDeadline = (date: Date) =>
  `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')} ${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}`;

/** Bỏ dấu để gõ "nguyen van" tìm ra "Nguyễn Văn". */
export const fold = (text: string) => text
  .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd')
  .toLowerCase().trim();

export const monthLabelOf = (month: string) => `${month.slice(5, 7)}/${month.slice(0, 4)}`;
