// ============================================================================
// Tham số tính lương theo NGÀY HIỆU LỰC (F06.02).
// ----------------------------------------------------------------------------
// Một bộ tham số = mọi con số mà engine cần để tính lương của một tháng:
// tham số luật định (công chuẩn, bảo hiểm hai phía, KPCĐ, trần đóng, giảm trừ
// gia cảnh, lương cơ sở / tối thiểu vùng), biểu thuế, tham số công ty dùng
// trong công thức và biểu bậc thang. Kỳ lương tháng M dùng bộ có
// `effectiveFrom` lớn nhất mà không vượt M (migration 20261013110000).
//
// File này CỐ Ý không còn bộ số "mặc định". Bản trước giữ sẵn biểu thuế, tỷ lệ
// bảo hiểm, giảm trừ gia cảnh trong code và rơi về đó khi database thiếu — tức
// con số pháp lý vẫn nằm trong phần mềm, trái yêu cầu "tuyệt đối không
// hard-code" của F06.02. Giờ thiếu bộ tham số thì bảng lương NÓI là thiếu và
// không tính, thay vì lặng lẽ tính bằng một bộ số không ai khai.
//
// `standardHoursPerDay` KHÔNG nằm ở đây: Bảng công dùng nó làm ngưỡng đủ giờ
// công nên nó là thiết lập vận hành dùng chung, payroll chỉ đọc ké.
// ============================================================================

import { supabase } from './supabase';
import { describeDbError } from './dbError';
import { tierLookup, type FormulaFunctions } from './payrollFormula';
import type { AppSettings } from './settings';

/** Một bậc của biểu thuế lũy tiến từng phần. */
export interface PitBracket {
  step: number;
  /** NULL ở bậc cuối: không có cận trên. */
  upperBound: number | null;
  /** Thuế suất theo phần trăm, ví dụ 5 nghĩa là 5%. */
  rate: number;
}

export type ParamUnit = 'VND' | '%' | 'HE_SO' | 'NGAY' | 'GIO' | 'LAN';
export type ParamGroup = 'OT' | 'PENALTY' | 'FUND' | 'COMMISSION' | 'OTHER';

export const PARAM_UNIT_LABEL: Record<ParamUnit, string> = {
  VND: 'đồng', '%': '%', HE_SO: 'hệ số', NGAY: 'ngày', GIO: 'giờ', LAN: 'lần',
};

export const PARAM_GROUP_LABEL: Record<ParamGroup, string> = {
  OT: 'Làm thêm giờ & ca đêm',
  PENALTY: 'Phạt & khấu trừ tự động',
  FUND: 'Trích quỹ',
  COMMISSION: 'Doanh thu & hoa hồng',
  OTHER: 'Tham số khác',
};

/** Tham số tự khai — mã dùng thẳng trong công thức. */
export interface NamedParamDef {
  code: string;
  name: string;
  value: number;
  unit: ParamUnit;
  group: ParamGroup;
  note: string | null;
}

export interface TierRow {
  /** Áp từ ngưỡng này (bao gồm) tới ngay dưới ngưỡng kế tiếp. */
  from: number;
  value: number;
}

/** Biểu bậc thang — gọi trong công thức như một hàm: `HH_BL02(TY_LE)`. */
export interface TierTable {
  code: string;
  name: string;
  inputLabel: string | null;
  unit: ParamUnit;
  note: string | null;
  rows: TierRow[];
}

/** Các con số engine hiểu theo NGHĨA RIÊNG (không chỉ là biến trong công thức). */
export interface PayrollSettings {
  /** Mẫu số cho người hưởng lương tháng. */
  standardWorkDays: number;

  /** Phần người lao động trích đóng (%). */
  socialInsuranceRate: number;
  healthInsuranceRate: number;
  unemploymentInsuranceRate: number;

  /** Phần doanh nghiệp đóng (%). Không trừ vào lương nhân viên. */
  employerSocialRate: number;
  employerHealthRate: number;
  employerUnemploymentRate: number;
  /** Kinh phí công đoàn doanh nghiệp đóng (%). 0 = không tự tính. */
  employerUnionFundRate: number;

  /** Trần tiền lương đóng — BHXH/BHYT và BHTN có trần khác nhau. */
  insuranceSalaryCap: number;
  unemploymentSalaryCap: number;

  /** Giảm trừ gia cảnh khi tính thuế TNCN. */
  taxPersonalDeduction: number;
  taxDependentDeduction: number;

  /** Mức lương cơ sở và lương tối thiểu vùng — gốc của các trần ở trên. */
  baseSalaryLevel: number;
  regionalMinimumWage: number;
  regionCode: 'I' | 'II' | 'III' | 'IV';

  /** Thuế khấu trừ thẳng cho hợp đồng dưới 3 tháng (%). */
  flatTaxRate: number;
  /** Số ngày nghỉ không lương trong tháng từ đó trở lên thì không đóng bảo hiểm. */
  unpaidDaysWaiveInsurance: number;
  /** Làm tròn thực lĩnh (FR06.04.01) — 1000 nghĩa là tới hàng nghìn. */
  netRoundingUnit: 1 | 10 | 100 | 1000 | 10000;
  netRoundingMode: 'NEAREST' | 'DOWN' | 'UP';
}

export interface PayrollParamVersion extends PayrollSettings {
  /** NULL = bộ đang soạn, chưa lưu. */
  id: string | null;
  /** Ngày đầu tháng bắt đầu hiệu lực, dạng 'YYYY-MM-DD'. */
  effectiveFrom: string;
  label: string | null;
  note: string | null;
  brackets: PitBracket[];
  namedParams: NamedParamDef[];
  tierTables: TierTable[];
  updatedAt: string | null;
}

/**
 * PostgREST trả `numeric` về dạng chuỗi để không mất độ chính xác với số lớn.
 * Ném thẳng chuỗi vào phép chia lương sẽ ra `NaN` im lặng.
 */
function num(value: unknown): number {
  const parsed = typeof value === 'string' ? parseFloat(value) : value;
  return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : Number.NaN;
}

const UNITS = Object.keys(PARAM_UNIT_LABEL) as ParamUnit[];
const GROUPS = Object.keys(PARAM_GROUP_LABEL) as ParamGroup[];

export function versionFromRow(row: Record<string, unknown>): PayrollParamVersion {
  const brackets = Array.isArray(row.pit_brackets) ? row.pit_brackets as Array<Record<string, unknown>> : [];
  const params = Array.isArray(row.named_params) ? row.named_params as Array<Record<string, unknown>> : [];
  const tiers = Array.isArray(row.tier_tables) ? row.tier_tables as Array<Record<string, unknown>> : [];
  const region = String(row.region_code ?? '');
  const rounding = num(row.net_rounding_unit);
  const mode = String(row.net_rounding_mode ?? '');

  return {
    id: (row.id as string) ?? null,
    effectiveFrom: String(row.effective_from ?? ''),
    label: (row.label as string) ?? null,
    note: (row.note as string) ?? null,
    updatedAt: (row.updated_at as string) ?? null,
    standardWorkDays: num(row.standard_work_days),
    socialInsuranceRate: num(row.social_insurance_rate),
    healthInsuranceRate: num(row.health_insurance_rate),
    unemploymentInsuranceRate: num(row.unemployment_insurance_rate),
    employerSocialRate: num(row.employer_social_rate),
    employerHealthRate: num(row.employer_health_rate),
    employerUnemploymentRate: num(row.employer_unemployment_rate),
    employerUnionFundRate: num(row.employer_union_fund_rate),
    insuranceSalaryCap: num(row.insurance_salary_cap),
    unemploymentSalaryCap: num(row.unemployment_salary_cap),
    taxPersonalDeduction: num(row.tax_personal_deduction),
    taxDependentDeduction: num(row.tax_dependent_deduction),
    baseSalaryLevel: num(row.base_salary_level),
    regionalMinimumWage: num(row.regional_minimum_wage),
    regionCode: (['I', 'II', 'III', 'IV'] as const).find((code) => code === region) ?? 'I',
    flatTaxRate: num(row.flat_tax_rate),
    unpaidDaysWaiveInsurance: num(row.unpaid_days_waive_insurance),
    netRoundingUnit: ([1, 10, 100, 1000, 10000] as const).find((unit) => unit === rounding) ?? 1,
    netRoundingMode: mode === 'DOWN' || mode === 'UP' ? mode : 'NEAREST',
    brackets: brackets.map((bracket, index) => ({
      step: index + 1,
      upperBound: bracket.upper_bound == null ? null : num(bracket.upper_bound),
      rate: num(bracket.rate),
    })),
    namedParams: params.map((param) => ({
      code: String(param.code ?? ''),
      name: String(param.name ?? ''),
      value: num(param.value),
      unit: UNITS.find((unit) => unit === param.unit) ?? 'VND',
      group: GROUPS.find((group) => group === param.group) ?? 'OTHER',
      note: (param.note as string) ?? null,
    })),
    tierTables: tiers.map((tier) => ({
      code: String(tier.code ?? ''),
      name: String(tier.name ?? ''),
      inputLabel: (tier.input_label as string) ?? null,
      unit: UNITS.find((unit) => unit === tier.unit) ?? '%',
      note: (tier.note as string) ?? null,
      rows: (Array.isArray(tier.rows) ? tier.rows as Array<Record<string, unknown>> : [])
        .map((r) => ({ from: num(r.from), value: num(r.value) })),
    })),
  };
}

export function versionToRow(version: PayrollParamVersion): Record<string, unknown> {
  return {
    effective_from: version.effectiveFrom,
    label: version.label?.trim() || null,
    note: version.note?.trim() || null,
    standard_work_days: version.standardWorkDays,
    social_insurance_rate: version.socialInsuranceRate,
    health_insurance_rate: version.healthInsuranceRate,
    unemployment_insurance_rate: version.unemploymentInsuranceRate,
    employer_social_rate: version.employerSocialRate,
    employer_health_rate: version.employerHealthRate,
    employer_unemployment_rate: version.employerUnemploymentRate,
    employer_union_fund_rate: version.employerUnionFundRate,
    insurance_salary_cap: version.insuranceSalaryCap,
    unemployment_salary_cap: version.unemploymentSalaryCap,
    tax_personal_deduction: version.taxPersonalDeduction,
    tax_dependent_deduction: version.taxDependentDeduction,
    base_salary_level: version.baseSalaryLevel,
    regional_minimum_wage: version.regionalMinimumWage,
    region_code: version.regionCode,
    flat_tax_rate: version.flatTaxRate,
    unpaid_days_waive_insurance: version.unpaidDaysWaiveInsurance,
    net_rounding_unit: version.netRoundingUnit,
    net_rounding_mode: version.netRoundingMode,
    pit_brackets: version.brackets.map((bracket) => ({ upper_bound: bracket.upperBound, rate: bracket.rate })),
    named_params: version.namedParams.map((param) => ({
      code: param.code, name: param.name, value: param.value, unit: param.unit, group: param.group, note: param.note,
    })),
    tier_tables: version.tierTables.map((tier) => ({
      code: tier.code, name: tier.name, input_label: tier.inputLabel, unit: tier.unit, note: tier.note,
      rows: tier.rows.map((r) => ({ from: r.from, value: r.value })),
    })),
  };
}

export interface ParamVersionsResult {
  versions: PayrollParamVersion[];
  /** Bảng chưa tồn tại = migration F06.02 chưa chạy. */
  supported: boolean;
  error: string | null;
}

/** Mọi bộ tham số, mới nhất trước. Ít dòng (mỗi lần luật đổi một dòng) nên nạp hết. */
export async function fetchParamVersions(): Promise<ParamVersionsResult> {
  if (!supabase) return { versions: [], supported: false, error: 'Chưa kết nối Supabase.' };
  const { data, error } = await supabase
    .from('payroll_param_versions')
    .select('*')
    .order('effective_from', { ascending: false });
  if (error) {
    const missing = /payroll_param_versions|schema cache|does not exist/i.test(error.message ?? '');
    return { versions: [], supported: !missing, error: missing ? null : describeDbError(error) };
  }
  return {
    versions: ((data || []) as Record<string, unknown>[]).map(versionFromRow),
    supported: true,
    error: null,
  };
}

/** Bộ tham số áp cho tháng có ngày đầu tháng `monthStart` ('YYYY-MM-DD'). */
export function versionForMonth(
  versions: readonly PayrollParamVersion[],
  monthStart: string,
): PayrollParamVersion | null {
  return [...versions]
    .filter((version) => version.effectiveFrom <= monthStart)
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0] ?? null;
}

export async function saveParamVersion(
  version: PayrollParamVersion,
): Promise<{ error: string | null; id: string | null }> {
  if (!supabase) return { error: 'Chưa kết nối Supabase.', id: null };
  const row = versionToRow(version);
  const { data, error } = version.id
    ? await supabase.from('payroll_param_versions').update(row).eq('id', version.id).select('id').single()
    : await supabase.from('payroll_param_versions').insert(row).select('id').single();
  return { error: error ? describeDbError(error) : null, id: (data as { id?: string } | null)?.id ?? null };
}

export async function deleteParamVersion(id: string): Promise<string | null> {
  if (!supabase) return 'Chưa kết nối Supabase.';
  const { error } = await supabase.from('payroll_param_versions').delete().eq('id', id);
  return error ? describeDbError(error) : null;
}

/** Bản sao để soạn bộ mới từ một bộ đang có — đổi số nào thì sửa số đó. */
export function copyVersion(base: PayrollParamVersion, effectiveFrom: string): PayrollParamVersion {
  return {
    ...base,
    id: null,
    effectiveFrom,
    label: null,
    note: null,
    updatedAt: null,
    brackets: base.brackets.map((bracket) => ({ ...bracket })),
    namedParams: base.namedParams.map((param) => ({ ...param })),
    tierTables: base.tierTables.map((tier) => ({ ...tier, rows: tier.rows.map((r) => ({ ...r })) })),
  };
}

/** Lỗi theo từng ô, để màn hình đỏ đúng ô sai (UI_03). Khoá là tên trường. */
export type ParamIssues = Partial<Record<string, string>>;

/**
 * Kiểm tra tại chỗ trước khi lưu — cùng ngưỡng với CHECK và trigger ở
 * database, để người khai thấy lỗi ngay ở ô đang gõ chứ không phải lúc bấm lưu.
 *
 * `reserved`: tên đã có nghĩa trong engine / bộ đánh giá công thức (biến hệ
 * thống, hàm dựng sẵn) — tham số trùng tên sẽ đè biến hệ thống.
 */
export function validateParamVersion(
  version: PayrollParamVersion,
  reserved: ReadonlySet<string>,
): ParamIssues {
  const issues: ParamIssues = {};
  const rate = (key: keyof PayrollSettings, label: string) => {
    const value = version[key] as number;
    if (!Number.isFinite(value) || value < 0 || value > 100) issues[key] = `${label} phải từ 0 đến 100%.`;
  };
  const money = (key: keyof PayrollSettings, label: string, positive = false) => {
    const value = version[key] as number;
    if (!Number.isFinite(value) || value < 0 || (positive && value === 0)) {
      issues[key] = positive ? `${label} phải lớn hơn 0.` : `${label} không được âm.`;
    }
  };

  if (!/^\d{4}-\d{2}-01$/.test(version.effectiveFrom)) issues.effectiveFrom = 'Chọn tháng bắt đầu hiệu lực.';
  if (!Number.isFinite(version.standardWorkDays) || version.standardWorkDays <= 0 || version.standardWorkDays > 31) {
    issues.standardWorkDays = 'Ngày công chuẩn phải trong khoảng 0–31.';
  }
  rate('socialInsuranceRate', 'BHXH');
  rate('healthInsuranceRate', 'BHYT');
  rate('unemploymentInsuranceRate', 'BHTN');
  rate('employerSocialRate', 'BHXH doanh nghiệp');
  rate('employerHealthRate', 'BHYT doanh nghiệp');
  rate('employerUnemploymentRate', 'BHTN doanh nghiệp');
  rate('employerUnionFundRate', 'KPCĐ');
  rate('flatTaxRate', 'Thuế khấu trừ thẳng');
  if (!issues.socialInsuranceRate
    && version.socialInsuranceRate + version.healthInsuranceRate + version.unemploymentInsuranceRate > 100) {
    issues.socialInsuranceRate = 'Tổng tỷ lệ người lao động đóng vượt 100%.';
  }
  money('insuranceSalaryCap', 'Trần đóng BHXH/BHYT');
  money('unemploymentSalaryCap', 'Trần đóng BHTN');
  money('taxPersonalDeduction', 'Giảm trừ bản thân');
  money('taxDependentDeduction', 'Giảm trừ người phụ thuộc');
  money('baseSalaryLevel', 'Mức lương cơ sở', true);
  money('regionalMinimumWage', 'Lương tối thiểu vùng', true);
  if (!Number.isFinite(version.unpaidDaysWaiveInsurance)
    || version.unpaidDaysWaiveInsurance <= 0 || version.unpaidDaysWaiveInsurance > 31) {
    issues.unpaidDaysWaiveInsurance = 'Số ngày phải trong khoảng 0–31.';
  }

  if (version.brackets.length === 0) issues.brackets = 'Biểu thuế phải có ít nhất một bậc.';
  version.brackets.forEach((bracket, index) => {
    const last = index === version.brackets.length - 1;
    if (!Number.isFinite(bracket.rate) || bracket.rate < 0 || bracket.rate > 100) {
      issues[`bracket.${index}`] = `Thuế suất bậc ${index + 1} phải từ 0 đến 100%.`;
    } else if (!last && bracket.upperBound == null) {
      issues[`bracket.${index}`] = `Bậc ${index + 1} phải có cận trên — chỉ bậc cuối để trống.`;
    } else if (last && bracket.upperBound != null) {
      issues[`bracket.${index}`] = 'Bậc cuối phải để trống cận trên, nếu không thu nhập vượt bậc cuối không bị tính thuế.';
    } else if (index > 0 && bracket.upperBound != null
      && (version.brackets[index - 1].upperBound ?? Infinity) >= bracket.upperBound) {
      issues[`bracket.${index}`] = `Các bậc phải tăng dần (bậc ${index + 1}).`;
    }
  });

  const seen = new Set<string>();
  const checkCode = (code: string) => {
    if (!/^[A-Z][A-Z0-9_]*$/.test(code)) return `Mã "${code || '(trống)'}" phải viết hoa không dấu, bắt đầu bằng chữ.`;
    if (reserved.has(code)) return `Mã "${code}" trùng tên biến hệ thống.`;
    if (seen.has(code)) return `Mã "${code}" bị khai hai lần.`;
    seen.add(code);
    return null;
  };
  version.namedParams.forEach((param, index) => {
    const codeIssue = checkCode(param.code);
    if (codeIssue) issues[`param.${index}`] = codeIssue;
    else if (!param.name.trim()) issues[`param.${index}`] = `Tham số ${param.code} chưa có tên.`;
    else if (!Number.isFinite(param.value)) issues[`param.${index}`] = `Giá trị ${param.code} phải là số.`;
  });
  version.tierTables.forEach((tier, index) => {
    const codeIssue = checkCode(tier.code);
    if (codeIssue) issues[`tier.${index}`] = codeIssue;
    else if (!tier.name.trim()) issues[`tier.${index}`] = `Biểu ${tier.code} chưa có tên.`;
    else if (tier.rows.length === 0) issues[`tier.${index}`] = `Biểu ${tier.code} phải có ít nhất một mức.`;
    else if (tier.rows.some((row) => !Number.isFinite(row.from) || !Number.isFinite(row.value))) {
      issues[`tier.${index}`] = `Mọi mức của biểu ${tier.code} phải có ngưỡng và giá trị là số.`;
    } else if (tier.rows.some((row, i) => i > 0 && row.from <= tier.rows[i - 1].from)) {
      issues[`tier.${index}`] = `Ngưỡng của biểu ${tier.code} phải tăng dần, không trùng nhau.`;
    }
  });

  return issues;
}

/**
 * Bộ tham số đầy đủ mà engine cần cho MỘT tháng: bộ có hiệu lực, cộng giờ
 * chuẩn mỗi ngày từ cấu hình hệ thống, và công chuẩn theo lịch làm việc nếu có.
 *
 * Gộp ở đây thay vì để engine tự đọc nhiều nguồn, nhờ vậy `lib/payroll.ts`
 * không phụ thuộc database và kiểm chứng được bằng dữ liệu thuần.
 */
export interface PayrollParams extends PayrollSettings {
  /** Giờ làm chuẩn mỗi ngày — dùng quy đổi đơn giá giờ cho tăng ca. */
  hoursPerDay: number;
  /** Biểu thuế lũy tiến đang áp dụng. */
  brackets: PitBracket[];
  /** Tham số tự khai: mã → giá trị. */
  namedParams: Readonly<Record<string, number>>;
  /** Biểu bậc thang, dạng hàm cho bộ đánh giá công thức. */
  tierFunctions: FormulaFunctions;
  /** Bộ tham số gốc, để phiếu lương ghi lại đã tính theo bộ nào. */
  versionEffectiveFrom: string;
}

export function toPayrollParams(
  version: PayrollParamVersion,
  app: Pick<AppSettings, 'standardHoursPerDay'>,
  /** Công chuẩn theo lịch làm việc của tháng (BR-PAY-001), thắng con số khai tay. */
  calendarStandardDays?: number | null,
): PayrollParams {
  return {
    ...version,
    standardWorkDays: calendarStandardDays ?? version.standardWorkDays,
    hoursPerDay: app.standardHoursPerDay,
    brackets: version.brackets,
    namedParams: Object.fromEntries(version.namedParams.map((param) => [param.code, param.value])),
    tierFunctions: Object.fromEntries(version.tierTables.map((tier) => [tier.code, tierLookup(tier.rows)])),
    versionEffectiveFrom: version.effectiveFrom,
  };
}

/** Tháng sớm nhất còn được đổi cấu hình: sau kỳ lương đã chốt gần nhất. */
export function firstEditableMonth(lastClosedMonth: string | null, today: string): string {
  const current = `${today.slice(0, 7)}-01`;
  if (!lastClosedMonth) return current;
  const [year, month] = lastClosedMonth.split('-').map(Number);
  const next = new Date(year, month, 1);
  const nextStr = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-01`;
  return nextStr > current ? nextStr : current;
}
