// ============================================================================
// Bảng lương cấu hình được — mỗi bảng là một cách XEM dữ liệu lương tháng như
// một sheet Excel (BL 01, BL 02, Lương cắt lô, Nghỉ phép, Đầu chai…).
// ----------------------------------------------------------------------------
// Bảng không tính gì. Mỗi cột lấy số từ một trong năm nguồn:
//   LINE   dòng phiếu lương của người đó (đầu mục)
//   DATA   dữ liệu chấm công của tháng (ngày công, ngày phép, giờ OT…)
//   LEAVE  sổ phép năm (đã nghỉ theo tháng, phép năm, trừ phép đi muộn, còn lại)
//   TOTAL  tổng của phiếu (tổng cộng, tổng trừ, thực lĩnh)
//   INFO   chữ: cảnh báo nhập sai ngày công, ngày đi làm chính thức, ô để trống
// Cột có `group` giống nhau và đứng liền nhau gộp thành một tiêu đề hai tầng.
// ============================================================================

import { supabase } from './supabase';
import { describeDbError } from './dbError';
import { systemScope, type ComputedPayslip } from './payroll';
import { SYSTEM_VARIABLES, TOTAL_EARNINGS_CODE } from './payrollVariables';
import type { OrganizationUnit, PayComponent } from '@/types';

export type SheetSource = 'LINE' | 'DATA' | 'LEAVE' | 'TOTAL' | 'INFO';

export interface SheetColumn {
  group: string | null;
  source: SheetSource;
  code: string;
  label: string | null;
  total: boolean;
}

export interface PayrollSheet {
  id: string;
  name: string;
  title: string | null;
  /** Mã biểu mẫu in ở góc phải (BL 01, DT 01…). */
  form_code: string | null;
  /** Dòng dưới tên công ty (PHÒNG KẾ TOÁN…). */
  issuer: string | null;
  /** Dòng dưới tiêu đề (BỘ PHẬN: KINH DOANH…). */
  subtitle: string | null;
  /** In dòng "Số ngày làm việc trong tháng". */
  show_standard_days: boolean;
  sort_order: number;
  require_codes: string[];
  unit_ids: string[];
  columns: SheetColumn[];
  updated_at?: string;
}

export const SOURCE_LABEL: Record<SheetSource, string> = {
  LINE: 'Đầu mục',
  DATA: 'Chấm công',
  LEAVE: 'Phép năm',
  TOTAL: 'Tổng phiếu',
  INFO: 'Thông tin',
};

/** Dữ liệu chấm công lấy được vào cột (khớp `payroll_sheet_data_codes()` ở database). */
export const DATA_SOURCES: ReadonlyArray<{ code: string; name: string }> = SYSTEM_VARIABLES
  .filter((variable) => !variable.hidden && variable.code !== TOTAL_EARNINGS_CODE)
  .map((variable) => ({ code: variable.code, name: variable.name }));

const MONTHS = Array.from({ length: 12 }, (_, index) => String(index + 1).padStart(2, '0'));

export const LEAVE_SOURCES: ReadonlyArray<{ code: string; name: string }> = [
  ...MONTHS.map((month) => ({ code: `LEAVE_M${month}`, name: `Phép đã nghỉ T${Number(month)}` })),
  { code: 'LEAVE_USED', name: 'Phép đã nghỉ cả năm' },
  { code: 'LEAVE_QUOTA', name: 'Phép năm' },
  ...MONTHS.map((month) => ({ code: `LATE_M${month}`, name: `Trừ phép đi muộn T${Number(month)}` })),
  { code: 'LATE_TOTAL', name: 'Tổng trừ phép đi muộn' },
  { code: 'LEAVE_REMAIN', name: 'Phép còn lại' },
];

export const TOTAL_SOURCES: ReadonlyArray<{ code: string; name: string }> = [
  { code: 'GROSS_PAY', name: 'Tổng các khoản cộng' },
  { code: 'DEDUCTIONS', name: 'Tổng các khoản trừ' },
  { code: 'NET_PAY', name: 'Thực lĩnh' },
];

/** Cột chữ — không cộng tổng. */
export const INFO_SOURCES: ReadonlyArray<{ code: string; name: string }> = [
  { code: 'DAYS_CHECK', name: 'Cảnh báo nhập sai số liệu' },
  { code: 'START_DATE', name: 'Ngày đi làm chính thức' },
  { code: 'BLANK', name: 'Ô để trống' },
];

const SOURCE_LISTS: Record<Exclude<SheetSource, 'LINE'>, ReadonlyArray<{ code: string; name: string }>> = {
  DATA: DATA_SOURCES,
  LEAVE: LEAVE_SOURCES,
  TOTAL: TOTAL_SOURCES,
  INFO: INFO_SOURCES,
};

/** Tên mặc định của nguồn — dùng khi cột không đặt tên riêng. Không bao giờ trả mã biến. */
export function sourceName(source: SheetSource, code: string, components: readonly PayComponent[]): string {
  if (source === 'LINE') return components.find((component) => component.code === code)?.name ?? 'Đầu mục đã xoá';
  return SOURCE_LISTS[source].find((item) => item.code === code)?.name ?? 'Không rõ nguồn';
}

export const columnLabel = (column: SheetColumn, components: readonly PayComponent[]) =>
  column.label?.trim() || sourceName(column.source, column.code, components);

/** Tiêu đề hàng trên: cột liền nhau cùng nhóm gộp làm một; cột không nhóm đứng riêng. */
export function headerGroups<T extends { group?: string | null }>(columns: readonly T[]): Array<{ title: string | null; span: number }> {
  const out: Array<{ title: string | null; span: number }> = [];
  for (const column of columns) {
    const title = column.group?.trim() || null;
    const last = out[out.length - 1];
    if (title && last && last.title === title) last.span += 1;
    else out.push({ title, span: 1 });
  }
  return out;
}

/** Người có mặt trong bảng: thuộc đơn vị đã chọn (kể cả đơn vị con) và có ít nhất một dòng đã chọn. */
export function isSheetMember(
  sheet: Pick<PayrollSheet, 'require_codes' | 'unit_ids'>,
  person: { unit_id?: string | null },
  lineCodes: ReadonlySet<string>,
  units: readonly OrganizationUnit[],
): boolean {
  if (sheet.unit_ids.length > 0) {
    const chosen = new Set(sheet.unit_ids);
    const parentOf = new Map(units.map((unit) => [unit.id, unit.parent_id]));
    let current = person.unit_id ?? null;
    let inside = false;
    for (let depth = 0; current && depth < 50; depth += 1) {
      if (chosen.has(current)) { inside = true; break; }
      current = parentOf.get(current) ?? null;
    }
    if (!inside) return false;
  }
  return sheet.require_codes.length === 0 || sheet.require_codes.some((code) => lineCodes.has(code.toUpperCase()));
}

/** Dữ liệu chấm công của một phiếu (tính trực tiếp hoặc đã chốt). */
export function dataValueOf(computed: ComputedPayslip, code: string, hoursPerDay: number): number | null {
  const snapshot = computed.snapshot as { inputs?: Record<string, number>; hours_per_day?: number } | undefined;
  const scope = systemScope(
    computed.stats,
    { standardDays: computed.standardDays, hoursPerDay: Number(snapshot?.hours_per_day) || hoursPerDay },
    snapshot?.inputs ?? {},
  );
  const value = scope[code];
  return Number.isFinite(value) ? value : null;
}

export const DAYS_CHECK_OK = 'OK!';
export const DAYS_CHECK_WRONG = 'Đã nhập sai số ngày công của nhân viên này!';

/**
 * Ô chữ (nguồn INFO). Cảnh báo theo đúng công thức Excel: công + phép + lễ vượt
 * số ngày làm việc trong tháng thì báo sai.
 */
export function infoValueOf(
  computed: ComputedPayslip,
  profile: { hire_date?: string | null },
  code: string,
  hoursPerDay: number,
): string {
  if (code === 'DAYS_CHECK') {
    const cong = computed.lines.find((line) => line.code === 'CONG')?.amount
      ?? dataValueOf(computed, 'WORK_DAYS', hoursPerDay) ?? 0;
    const leave = dataValueOf(computed, 'LEAVE_DAYS', hoursPerDay) ?? 0;
    const holiday = dataValueOf(computed, 'HOLIDAY_DAYS', hoursPerDay) ?? 0;
    return cong + leave + holiday > computed.standardDays + 1e-9 ? DAYS_CHECK_WRONG : DAYS_CHECK_OK;
  }
  if (code === 'START_DATE') {
    const match = profile.hire_date?.match(/^(\d{4})-(\d{2})-(\d{2})/);
    return match ? `${match[3]}/${match[2]}/${match[1]}` : '';
  }
  return '';
}

/** Tiêu đề in: thay {tháng} / {năm}; không có thì thêm "THÁNG mm/yyyy". */
export function sheetTitle(sheet: Pick<PayrollSheet, 'name' | 'title'>, month: string, year: number): string {
  const base = (sheet.title?.trim() || sheet.name).toUpperCase();
  if (/\{(THÁNG|NĂM)\}/.test(base)) return base.replace(/\{THÁNG\}/g, month).replace(/\{NĂM\}/g, String(year));
  return `${base} THÁNG ${month}`;
}

export function totalValueOf(computed: ComputedPayslip, code: string): number | null {
  if (code === 'GROSS_PAY') return computed.gross;
  if (code === 'DEDUCTIONS') return computed.totalDeductions;
  if (code === 'NET_PAY') return computed.netPay;
  return null;
}

// ---------------------------------------------------------------------------
// Sổ phép năm
// ---------------------------------------------------------------------------

/** Mã cột phép năm → số, theo từng người. */
export type LeaveYear = Map<string, Record<string, number>>;

const round2 = (value: number) => Math.round(value * 100) / 100;

/**
 * Phép năm của cả năm cho bảng Nghỉ phép: phép đã nghỉ từng tháng (đơn phép năm
 * đã duyệt, chia theo số ngày rơi vào tháng), phép năm (cấp + chuyển sang trong
 * sổ phép, chưa có sổ thì lấy hạn mức trong hồ sơ), phép bị trừ do đi muộn từng
 * tháng (bút toán Bảng công ghi vào sổ phép), còn lại.
 */
export async function fetchLeaveYear(year: number): Promise<{ data: LeaveYear; error: string | null }> {
  const data: LeaveYear = new Map();
  if (!supabase) return { data, error: 'Chưa kết nối Supabase.' };
  const [requestsRes, ledgerRes, quotaRes] = await Promise.all([
    supabase.from('leave_requests')
      .select('user_id, start_date, end_date, days, status, leave_type, is_cancelled')
      .eq('leave_type', 'annual').eq('status', 'approved')
      .lte('start_date', `${year}-12-31`).gte('end_date', `${year}-01-01`),
    supabase.from('leave_ledger').select('*').eq('leave_year', year).eq('leave_type', 'annual'),
    supabase.from('profiles_leave_quota').select('id, annual_leave_quota'),
  ]);
  if (requestsRes.error) return { data, error: describeDbError(requestsRes.error) };

  const entry = (userId: string) => {
    let row = data.get(userId);
    if (!row) { row = {}; data.set(userId, row); }
    return row;
  };
  const add = (userId: string, code: string, value: number) => {
    const row = entry(userId);
    row[code] = round2((row[code] ?? 0) + value);
  };

  for (const request of (requestsRes.data || []) as Array<{ user_id: string; start_date: string; end_date: string; days: number; is_cancelled?: boolean }>) {
    if (request.is_cancelled) continue;
    const start = new Date(`${request.start_date}T00:00:00`);
    const end = new Date(`${request.end_date}T00:00:00`);
    const span = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1);
    const perDay = Number(request.days) / span;
    for (let day = new Date(start); day <= end; day.setDate(day.getDate() + 1)) {
      if (day.getFullYear() !== year) continue;
      add(request.user_id, `LEAVE_M${String(day.getMonth() + 1).padStart(2, '0')}`, perDay);
    }
  }

  const granted = new Map<string, number>();
  for (const item of (ledgerRes.error ? [] : ledgerRes.data || []) as Array<Record<string, unknown>>) {
    const userId = String(item.user_id);
    const days = Number(item.days) || 0;
    if (item.entry_type === 'GRANT' || item.entry_type === 'CARRY_FORWARD') {
      granted.set(userId, (granted.get(userId) ?? 0) + days);
    } else if (item.entry_type === 'ADJUSTMENT' && item.ref_kind === 'TIMESHEET_LATE' && typeof item.ref_month === 'string') {
      add(userId, `LATE_M${item.ref_month.slice(5, 7)}`, Math.abs(days));
    }
  }
  const quotaOf = new Map(((quotaRes.error ? [] : quotaRes.data || []) as Array<{ id: string; annual_leave_quota: number | null }>)
    .map((row) => [row.id, Number(row.annual_leave_quota) || 0]));

  for (const userId of new Set([...data.keys(), ...granted.keys(), ...quotaOf.keys()])) {
    const row = entry(userId);
    const used = MONTHS.reduce((sum, month) => sum + (row[`LEAVE_M${month}`] ?? 0), 0);
    const late = MONTHS.reduce((sum, month) => sum + (row[`LATE_M${month}`] ?? 0), 0);
    const quota = granted.get(userId) ?? quotaOf.get(userId) ?? 0;
    row.LEAVE_USED = round2(used);
    row.LATE_TOTAL = round2(late);
    row.LEAVE_QUOTA = round2(quota);
    row.LEAVE_REMAIN = round2(quota - used - late);
  }
  return { data, error: null };
}

// ---------------------------------------------------------------------------
// Đọc / ghi
// ---------------------------------------------------------------------------

function sheetFromRow(row: Record<string, unknown>): PayrollSheet {
  const columns = Array.isArray(row.columns) ? row.columns as Array<Record<string, unknown>> : [];
  return {
    id: String(row.id),
    name: String(row.name ?? ''),
    title: (row.title as string) ?? null,
    form_code: (row.form_code as string) || null,
    issuer: (row.issuer as string) || null,
    subtitle: (row.subtitle as string) || null,
    show_standard_days: row.show_standard_days === true,
    sort_order: Number(row.sort_order) || 0,
    require_codes: Array.isArray(row.require_codes) ? row.require_codes.map(String) : [],
    unit_ids: Array.isArray(row.unit_ids) ? row.unit_ids.map(String) : [],
    columns: columns.map((column) => ({
      group: (column.group as string) || null,
      source: (['LINE', 'DATA', 'LEAVE', 'TOTAL', 'INFO'].includes(String(column.source)) ? column.source : 'LINE') as SheetSource,
      code: String(column.code ?? ''),
      label: (column.label as string) || null,
      total: column.source !== 'INFO' && column.total !== false,
    })),
    updated_at: (row.updated_at as string) ?? undefined,
  };
}

export async function fetchPayrollSheets(): Promise<PayrollSheet[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.from('payroll_sheets').select('*').order('sort_order').order('name');
  return error ? [] : ((data || []) as Array<Record<string, unknown>>).map(sheetFromRow);
}

export async function savePayrollSheet(
  id: string | null,
  sheet: Omit<PayrollSheet, 'id' | 'updated_at'>,
): Promise<{ id: string | null; error: string | null }> {
  if (!supabase) return { id: null, error: 'Chưa kết nối Supabase.' };
  const { data, error } = await supabase.rpc('save_payroll_sheet', { p_id: id, p_sheet: sheet });
  return error ? { id: null, error: describeDbError(error) } : { id: String(data), error: null };
}

export async function deletePayrollSheet(id: string): Promise<string | null> {
  if (!supabase) return 'Chưa kết nối Supabase.';
  const { error } = await supabase.rpc('delete_payroll_sheet', { p_id: id });
  return error ? describeDbError(error) : null;
}
