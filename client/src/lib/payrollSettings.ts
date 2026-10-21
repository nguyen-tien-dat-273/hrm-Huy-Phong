// ============================================================================
// Tham số lương theo NGÀY HIỆU LỰC, xếp trong các BẢNG do người dùng tự tạo.
// ----------------------------------------------------------------------------
// Một bộ tham số áp từ một tháng tới bộ kế tiếp. Trong bộ có:
//
//   * Thiết lập chung — thứ hệ thống cần để chạy: công chuẩn khi chưa khai ca
//     làm việc, cách làm tròn thực lĩnh, (tuỳ chọn) kiểm tra mức sàn.
//   * Các BẢNG tham số người dùng tự đặt tên và tự thêm tham số: "Bảo hiểm",
//     "Khấu trừ", "Làm thêm giờ"… Mỗi tham số có loại (thời gian / giá / tỷ lệ
//     / số lượng) và đơn vị. Hệ thống KHÔNG biết tham số nào là bảo hiểm hay
//     thuế — nó chỉ là một con số có tên, dùng trong công thức của cơ chế.
//   * Bảng bậc thang: gọi như một hàm trong công thức, kiểu tra mức (hoa
//     hồng) hoặc lũy tiến từng phần.
//
// Kỳ lương tháng M dùng bộ có `effectiveFrom` lớn nhất mà không vượt M. Bộ đã
// dùng cho kỳ lương đã chốt thì khoá (database chặn).
// ============================================================================

import { supabase } from './supabase';
import { describeDbError } from './dbError';
import { progressiveLookup, tierLookup, type FormulaFunctions } from './payrollFormula';
import {
  ALL_PARAM_UNITS, PARAM_TYPE_UNITS, formulaValueOf, typeOfUnit,
  type ParamType, type ParamUnit,
} from './payrollVariables';
import type { AppSettings } from './settings';

export type { ParamType, ParamUnit } from './payrollVariables';

/** Một tham số — mã của nó dùng thẳng trong công thức. */
export interface ParamDef {
  code: string;
  name: string;
  type: ParamType;
  unit: ParamUnit;
  value: number;
  note: string | null;
  /** Khoá thay vì xoá: giữ nguyên số cho công thức cũ, nhưng không sửa và không gợi ý khi khai công thức mới. */
  locked?: boolean;
}

export interface TierRow {
  /** Áp từ ngưỡng này (bao gồm) tới ngay dưới ngưỡng kế tiếp. */
  from: number;
  value: number;
}

/** LOOKUP: trả về mức của bậc chứa giá trị tra. PROGRESSIVE: cộng dồn từng phần. */
export type TierMode = 'LOOKUP' | 'PROGRESSIVE';

export interface ListParamTable {
  id: string;
  kind: 'LIST';
  name: string;
  note: string | null;
  locked?: boolean;
  params: ParamDef[];
}

export interface TierParamTable {
  id: string;
  kind: 'TIER';
  name: string;
  note: string | null;
  locked?: boolean;
  /** Tên hàm trong công thức. */
  code: string;
  mode: TierMode;
  /** Giá trị đưa vào tra, để người khai công thức biết truyền gì. */
  inputLabel: string | null;
  /** Đơn vị của cột giá trị (lũy tiến luôn là %). */
  unit: ParamUnit;
  rows: TierRow[];
}

export type ParamTable = ListParamTable | TierParamTable;

export type NetRoundingUnit = 1 | 10 | 100 | 1000 | 10000;
export type NetRoundingMode = 'NEAREST' | 'DOWN' | 'UP';

export interface PayrollParamVersion {
  /** NULL = bộ đang soạn, chưa lưu. */
  id: string | null;
  /** Ngày đầu tháng bắt đầu hiệu lực, dạng 'YYYY-MM-DD'. */
  effectiveFrom: string;
  label: string | null;
  note: string | null;
  updatedAt: string | null;
  /** Công chuẩn dùng khi tháng chưa khai ca làm việc. */
  standardWorkDays: number;
  netRoundingUnit: NetRoundingUnit;
  netRoundingMode: NetRoundingMode;
  /**
   * Kiểm tra mức sàn khi trình cơ chế (tuỳ chọn): giá trị khai riêng của đầu
   * mục này không được thấp hơn tham số kia — ví dụ Lương cơ bản ≥ Lương tối
   * thiểu vùng.
   */
  floorComponentCode: string | null;
  floorParamCode: string | null;
  tables: ParamTable[];
}

/**
 * PostgREST trả `numeric` về dạng chuỗi để không mất độ chính xác với số lớn.
 * Ném thẳng chuỗi vào phép tính lương sẽ ra `NaN` im lặng.
 */
function num(value: unknown): number {
  const parsed = typeof value === 'string' ? parseFloat(value) : value;
  return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : Number.NaN;
}

const ROUNDING_UNITS: readonly NetRoundingUnit[] = [1, 10, 100, 1000, 10000];

export function newTableId(): string {
  return `t${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
}

function unitOf(value: unknown, fallback: ParamUnit): ParamUnit {
  return ALL_PARAM_UNITS.find((unit) => unit === value) ?? fallback;
}

function tableFromJson(raw: Record<string, unknown>): ParamTable {
  const id = typeof raw.id === 'string' && raw.id ? raw.id : newTableId();
  const name = String(raw.name ?? '');
  const note = typeof raw.note === 'string' && raw.note.trim() ? raw.note : null;
  const lock = raw.locked === true ? { locked: true } : {};
  if (raw.kind === 'TIER') {
    return {
      id, kind: 'TIER', name, note, ...lock,
      code: String(raw.code ?? ''),
      mode: raw.mode === 'PROGRESSIVE' ? 'PROGRESSIVE' : 'LOOKUP',
      inputLabel: typeof raw.input_label === 'string' ? raw.input_label : null,
      unit: unitOf(raw.unit, '%'),
      rows: (Array.isArray(raw.rows) ? raw.rows as Array<Record<string, unknown>> : [])
        .map((row) => ({ from: num(row.from), value: num(row.value) })),
    };
  }
  return {
    id, kind: 'LIST', name, note, ...lock,
    params: (Array.isArray(raw.params) ? raw.params as Array<Record<string, unknown>> : []).map((param) => {
      const unit = unitOf(param.unit, 'VND');
      const declared = String(param.type ?? '');
      const type = (Object.keys(PARAM_TYPE_UNITS) as ParamType[]).find((item) => item === declared) ?? typeOfUnit(unit);
      return {
        code: String(param.code ?? ''),
        name: String(param.name ?? ''),
        type,
        unit: PARAM_TYPE_UNITS[type].includes(unit) ? unit : PARAM_TYPE_UNITS[type][0],
        value: num(param.value),
        note: typeof param.note === 'string' && param.note.trim() ? param.note : null,
        ...(param.locked === true ? { locked: true } : {}),
      };
    }),
  };
}

export function versionFromRow(row: Record<string, unknown>): PayrollParamVersion {
  const rounding = num(row.net_rounding_unit);
  const mode = String(row.net_rounding_mode ?? '');
  const tables = Array.isArray(row.param_tables) ? row.param_tables as Array<Record<string, unknown>> : [];
  return {
    id: (row.id as string) ?? null,
    effectiveFrom: String(row.effective_from ?? ''),
    label: (row.label as string) ?? null,
    note: (row.note as string) ?? null,
    updatedAt: (row.updated_at as string) ?? null,
    standardWorkDays: num(row.standard_work_days),
    netRoundingUnit: ROUNDING_UNITS.find((unit) => unit === rounding) ?? 1,
    netRoundingMode: mode === 'DOWN' || mode === 'UP' ? mode : 'NEAREST',
    floorComponentCode: (row.floor_component_code as string) || null,
    floorParamCode: (row.floor_param_code as string) || null,
    tables: tables.map(tableFromJson),
  };
}

function tableToJson(table: ParamTable): Record<string, unknown> {
  if (table.kind === 'TIER') {
    return {
      id: table.id, kind: 'TIER', name: table.name.trim(), note: table.note?.trim() || null,
      ...(table.locked ? { locked: true } : {}),
      code: table.code, mode: table.mode, input_label: table.inputLabel?.trim() || null,
      unit: table.mode === 'PROGRESSIVE' ? '%' : table.unit,
      rows: table.rows.map((row) => ({ from: row.from, value: row.value })),
    };
  }
  return {
    id: table.id, kind: 'LIST', name: table.name.trim(), note: table.note?.trim() || null,
    ...(table.locked ? { locked: true } : {}),
    params: table.params.map((param) => ({
      code: param.code, name: param.name.trim(), type: param.type, unit: param.unit,
      value: param.value, note: param.note?.trim() || null,
      ...(param.locked ? { locked: true } : {}),
    })),
  };
}

export function versionToRow(version: PayrollParamVersion): Record<string, unknown> {
  return {
    effective_from: version.effectiveFrom,
    label: version.label?.trim() || null,
    note: version.note?.trim() || null,
    standard_work_days: version.standardWorkDays,
    net_rounding_unit: version.netRoundingUnit,
    net_rounding_mode: version.netRoundingMode,
    floor_component_code: version.floorComponentCode || null,
    floor_param_code: version.floorParamCode || null,
    param_tables: version.tables.map(tableToJson),
  };
}

export interface ParamVersionsResult {
  versions: PayrollParamVersion[];
  /** Bảng chưa tồn tại = migration chưa chạy. */
  supported: boolean;
  error: string | null;
}

/** Mọi bộ tham số, mới nhất trước. Ít dòng (mỗi lần chính sách đổi một dòng) nên nạp hết. */
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

function cloneTable(table: ParamTable): ParamTable {
  return table.kind === 'TIER'
    ? { ...table, rows: table.rows.map((row) => ({ ...row })) }
    : { ...table, params: table.params.map((param) => ({ ...param })) };
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
    tables: base.tables.map(cloneTable),
  };
}

function uniqueCopyName(name: string, takenNamesLower: ReadonlySet<string>): string {
  const base = `${name.trim()} (bản sao)`;
  if (!takenNamesLower.has(base.toLowerCase())) return base;
  for (let i = 2; i < 1000; i += 1) {
    const candidate = `${base} ${i}`;
    if (!takenNamesLower.has(candidate.toLowerCase())) return candidate;
  }
  return `${base} ${Date.now()}`;
}

/**
 * Bản sao của một bảng (tham số hoặc bậc thang) trong cùng bộ — để dùng lại
 * cấu trúc một bảng đã có thay vì gõ lại từ đầu. Tên thêm "(bản sao)", mã mọi
 * tham số và mã bảng bậc thang làm mới (mã phải duy nhất trong cả bộ); bảng
 * mới luôn mở khoá dù bảng gốc đang khoá.
 */
export function duplicateTable(
  table: ParamTable,
  takenNamesLower: ReadonlySet<string>,
  takenCodes: ReadonlySet<string>,
): ParamTable {
  const codes = new Set(takenCodes);
  const id = newTableId();
  const name = uniqueCopyName(table.name, takenNamesLower);
  if (table.kind === 'TIER') {
    return {
      ...table, id, name, locked: false,
      code: codeFromName(name, codes, 'BANG'),
      rows: table.rows.map((row) => ({ ...row })),
    };
  }
  return {
    ...table, id, name, locked: false,
    params: table.params.map((param) => {
      const code = codeFromName(param.name || 'THAM_SO', codes, 'THAM_SO');
      codes.add(code);
      return { ...param, code, locked: false };
    }),
  };
}

/** Mọi tham số của bộ, kèm tên bảng chứa nó. `locked` đã gộp cả việc bảng bị khoá. */
export function paramsOf(version: PayrollParamVersion | null): Array<ParamDef & { tableName: string }> {
  if (!version) return [];
  return version.tables.flatMap((table) => (table.kind === 'LIST'
    ? table.params.map((param) => ({ ...param, locked: !!(table.locked || param.locked), tableName: table.name }))
    : []));
}

export function tierTablesOf(version: PayrollParamVersion | null): TierParamTable[] {
  return version ? version.tables.filter((table): table is TierParamTable => table.kind === 'TIER') : [];
}

/** Lỗi theo từng ô, để màn hình đỏ đúng ô sai. Khoá: `general.<trường>`, `table.<id>`, `param.<id>.<chỉ số>`. */
export type ParamIssues = Partial<Record<string, string>>;

const CODE_PATTERN = /^[A-Z][A-Z0-9_]*$/;

/**
 * Kiểm tra tại chỗ trước khi lưu — cùng ngưỡng với trigger ở database, để
 * người khai thấy lỗi ngay ở ô đang gõ chứ không phải lúc bấm lưu.
 *
 * `reserved`: tên đã có nghĩa (dữ liệu tự động, hàm dựng sẵn, mã đầu mục) —
 * tham số trùng tên sẽ đè lên chúng trong công thức.
 */
export function validateParamVersion(
  version: PayrollParamVersion,
  reserved: ReadonlySet<string>,
): ParamIssues {
  const issues: ParamIssues = {};
  if (!/^\d{4}-\d{2}-01$/.test(version.effectiveFrom)) issues['general.effectiveFrom'] = 'Chọn tháng bắt đầu hiệu lực.';
  if (!Number.isFinite(version.standardWorkDays) || version.standardWorkDays <= 0 || version.standardWorkDays > 31) {
    issues['general.standardWorkDays'] = 'Công chuẩn phải trong khoảng 0–31.';
  }
  if (!!version.floorComponentCode !== !!version.floorParamCode) {
    issues['general.floor'] = 'Chọn đủ cả đầu mục và tham số để kiểm tra mức sàn, hoặc bỏ trống cả hai.';
  }

  const seen = new Set<string>();
  const checkCode = (code: string, what: string) => {
    if (!CODE_PATTERN.test(code)) return `Mã ${what} "${code || '(trống)'}" phải viết hoa không dấu, bắt đầu bằng chữ.`;
    if (reserved.has(code)) return `Mã "${code}" trùng tên đầu mục hoặc dữ liệu hệ thống — đổi tên khác.`;
    if (seen.has(code)) return `Mã "${code}" bị dùng hai lần.`;
    seen.add(code);
    return null;
  };

  version.tables.forEach((table) => {
    if (!table.name.trim()) issues[`table.${table.id}`] = 'Bảng chưa có tên.';
    if (table.kind === 'TIER') {
      const codeIssue = checkCode(table.code, 'bảng');
      if (codeIssue) issues[`table.${table.id}`] = codeIssue;
      else if (table.rows.length === 0) issues[`table.${table.id}`] = 'Bảng bậc thang phải có ít nhất một bậc.';
      else if (table.rows.some((row) => !Number.isFinite(row.from) || !Number.isFinite(row.value))) {
        issues[`table.${table.id}`] = 'Mọi bậc phải có ngưỡng và giá trị là số.';
      } else if (table.rows.some((row, index) => index > 0 && row.from <= table.rows[index - 1].from)) {
        issues[`table.${table.id}`] = 'Ngưỡng các bậc phải tăng dần, không trùng nhau.';
      }
      return;
    }
    table.params.forEach((param, index) => {
      const key = `param.${table.id}.${index}`;
      if (!param.name.trim()) { issues[key] = 'Tham số chưa có tên.'; return; }
      const codeIssue = checkCode(param.code, 'tham số');
      if (codeIssue) { issues[key] = codeIssue; return; }
      if (!Number.isFinite(param.value)) { issues[key] = `Giá trị "${param.name}" phải là số.`; return; }
      if (!PARAM_TYPE_UNITS[param.type].includes(param.unit)) issues[key] = 'Đơn vị không thuộc loại tham số đã chọn.';
    });
  });

  return issues;
}

/**
 * Bộ số engine cần cho MỘT tháng: bộ tham số hiệu lực, giờ chuẩn mỗi ngày và
 * công chuẩn theo lịch làm việc.
 */
export interface PayrollParams {
  versionEffectiveFrom: string;
  /** Công chuẩn của tháng: theo lịch làm việc, chưa khai ca thì theo bộ tham số. */
  standardDays: number;
  hoursPerDay: number;
  netRoundingUnit: NetRoundingUnit;
  netRoundingMode: NetRoundingMode;
  /** Mã tham số → giá trị đưa vào công thức (% đã đổi ra phần trăm thật). */
  values: Readonly<Record<string, number>>;
  /** Bảng bậc thang, dạng hàm cho bộ đánh giá công thức. */
  functions: FormulaFunctions;
  /** Mã tham số / bảng → tên hiển thị, cho nhật ký tính và cảnh báo. */
  names: Readonly<Record<string, string>>;
}

export function tierFunctionOf(table: TierParamTable): (value: number) => number {
  if (table.mode === 'PROGRESSIVE') return progressiveLookup(table.rows);
  return tierLookup(table.rows.map((row) => ({ from: row.from, value: formulaValueOf(row.value, table.unit) })));
}

export function toPayrollParams(
  version: PayrollParamVersion,
  app: Pick<AppSettings, 'standardHoursPerDay'>,
  /** Công chuẩn theo lịch làm việc của tháng, thắng con số khai tay. */
  calendarStandardDays?: number | null,
): PayrollParams {
  return {
    versionEffectiveFrom: version.effectiveFrom,
    standardDays: calendarStandardDays ?? version.standardWorkDays,
    hoursPerDay: app.standardHoursPerDay,
    netRoundingUnit: version.netRoundingUnit,
    netRoundingMode: version.netRoundingMode,
    values: Object.fromEntries(paramsOf(version).map((param) => [param.code, formulaValueOf(param.value, param.unit)])),
    functions: Object.fromEntries(tierTablesOf(version).map((table) => [table.code, tierFunctionOf(table)])),
    names: Object.fromEntries([
      ...paramsOf(version).map((param) => [param.code, param.name] as const),
      ...tierTablesOf(version).map((table) => [table.code, table.name] as const),
    ]),
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

/** Mã viết hoa không dấu từ tên: "Tỷ lệ BHYT" → "TY_LE_BHYT". Trùng thì thêm số. */
export function codeFromName(name: string, taken: Iterable<string>, fallback = 'MA'): string {
  const takenSet = new Set(taken);
  const base = name
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/^([0-9])/, `${fallback}_$1`)
    .slice(0, 40) || fallback;
  if (!takenSet.has(base)) return base;
  for (let i = 2; i < 1000; i += 1) {
    const candidate = `${base}_${i}`;
    if (!takenSet.has(candidate)) return candidate;
  }
  return `${base}_${Date.now().toString().slice(-5)}`;
}
