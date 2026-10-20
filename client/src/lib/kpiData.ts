// ============================================================================
// Truy cập dữ liệu KPI.
// ----------------------------------------------------------------------------
// Đọc thẳng bảng (RLS lọc theo người xem); mọi đổi trạng thái phiếu, chỉ tiêu
// kinh doanh, khoá sổ, mở lại đi qua RPC ở database.
// ============================================================================

import { supabase } from './supabase';
import { describeDbErrorOrNull } from './dbError';
import type { JobPosition, OrganizationUnit, Profile } from '@/types';
import type {
  KpiLinkSource, KpiLog, KpiPayrollLink, KpiPeriod, KpiReopenRequest, KpiSalesTarget, KpiSet, KpiSetItem,
  KpiSettings, KpiSheet, KpiSheetItem, KpiYearReview,
} from './kpi';

const err = describeDbErrorOrNull;

export interface PayComponentOption {
  id: string;
  code: string;
  name: string;
  kind: string;
  is_active: boolean;
}

export interface KpiWorkspace {
  profiles: Profile[];
  units: OrganizationUnit[];
  positions: Pick<JobPosition, 'id' | 'title' | 'unit_id' | 'is_manager'>[];
  settings: KpiSettings[];
  sets: KpiSet[];
  setItems: KpiSetItem[];
  exemptions: Array<{ user_id: string; reason: string }>;
  period: KpiPeriod | null;
  sheets: KpiSheet[];
  sales: KpiSalesTarget[];
  reopen: KpiReopenRequest[];
  links: KpiPayrollLink[];
  components: PayComponentOption[];
  ready: boolean;
  error: string | null;
}

export async function loadKpiWorkspace(month: string): Promise<KpiWorkspace> {
  const [
    profilesRes, unitsRes, positionsRes, settingsRes, setsRes, itemsRes, exemptRes,
    periodRes, sheetsRes, salesRes, reopenRes, linksRes, componentsRes,
  ] = await Promise.all([
    supabase.from('profiles_directory').select('*').eq('is_active', true).order('name'),
    supabase.from('organization_units').select('id, code, name, unit_type, parent_id, manager_id, is_active, created_at, updated_at').order('name'),
    supabase.from('job_positions').select('id, title, unit_id, is_manager').order('title'),
    supabase.from('kpi_settings').select('*').order('effective_from', { ascending: false }),
    supabase.from('kpi_sets').select('*').order('name'),
    supabase.from('kpi_set_items').select('*').order('sort_order'),
    supabase.from('kpi_exemptions').select('user_id, reason'),
    supabase.from('kpi_periods').select('*').eq('month_start', month).maybeSingle(),
    supabase.from('kpi_sheets').select('*').eq('period_month', month),
    supabase.from('kpi_sales_targets').select('*').eq('period_month', month),
    supabase.from('kpi_reopen_requests').select('*').order('requested_at', { ascending: false }).limit(200),
    supabase.from('kpi_payroll_links').select('*'),
    supabase.from('payroll_components').select('id, code, name, kind, is_active').order('sort_order'),
  ]);

  const ready = !setsRes.error && !periodRes.error;
  const error = err(profilesRes.error) ?? (ready ? err(sheetsRes.error) ?? err(itemsRes.error) : null);
  return {
    profiles: (profilesRes.data || []) as Profile[],
    units: (unitsRes.data || []) as OrganizationUnit[],
    positions: (positionsRes.data || []) as KpiWorkspace['positions'],
    settings: ((settingsRes.data || []) as KpiSettings[]).map(normalizeSettings),
    sets: (setsRes.data || []) as KpiSet[],
    setItems: ((itemsRes.data || []) as KpiSetItem[]).map(numberize),
    exemptions: (exemptRes.data || []) as KpiWorkspace['exemptions'],
    period: (periodRes.data as KpiPeriod | null) ?? null,
    sheets: ((sheetsRes.data || []) as KpiSheet[]).map(numberizeSheet),
    sales: ((salesRes.data || []) as KpiSalesTarget[]).map(numberizeSales),
    reopen: (reopenRes.data || []) as KpiReopenRequest[],
    links: (linksRes.data || []) as KpiPayrollLink[],
    components: (componentsRes.data || []) as PayComponentOption[],
    ready,
    error,
  };
}

const n = (value: unknown) => (value == null || value === '' ? null : Number(value));

function normalizeSettings(row: KpiSettings): KpiSettings {
  return {
    ...row,
    cap_pct: Number(row.cap_pct),
    bonus_max_pct: Number(row.bonus_max_pct),
    manager_due_time: String(row.manager_due_time).slice(0, 5),
    board_due_time: String(row.board_due_time).slice(0, 5),
    lock_time: String(row.lock_time).slice(0, 5),
  };
}

function numberize<T extends { weight: unknown; standard_score: unknown; penalty_pct: unknown }>(item: T): T {
  return { ...item, weight: Number(item.weight), standard_score: Number(item.standard_score), penalty_pct: n(item.penalty_pct) };
}

function numberizeSheet(sheet: KpiSheet): KpiSheet {
  return {
    ...sheet,
    self_pct: n(sheet.self_pct), manager_pct: n(sheet.manager_pct), bonus_pct: Number(sheet.bonus_pct) || 0,
    final_pct: n(sheet.final_pct),
  };
}

function numberizeSales(row: KpiSalesTarget): KpiSalesTarget {
  return {
    ...row,
    sales_target: Number(row.sales_target), collect_target: Number(row.collect_target),
    customers_target: Number(row.customers_target), sales_actual: n(row.sales_actual),
    collect_actual: n(row.collect_actual), customers_actual: n(row.customers_actual),
  };
}

/** Bộ tham số áp cho tháng. */
export function settingsFor(settings: readonly KpiSettings[], month: string): KpiSettings | null {
  return [...settings].sort((a, b) => b.effective_from.localeCompare(a.effective_from))
    .find((row) => row.effective_from <= month) ?? null;
}

// ---------------------------------------------------------------------------
// Phiếu
// ---------------------------------------------------------------------------

export async function loadSheetItems(sheetId: string): Promise<{ items: KpiSheetItem[]; error: string | null }> {
  const { data, error } = await supabase.from('kpi_sheet_items').select('*').eq('sheet_id', sheetId).order('sort_order');
  return {
    items: ((data || []) as KpiSheetItem[]).map((item) => ({
      ...numberize(item),
      self_value: n(item.self_value), self_score: n(item.self_score), mgr_value: n(item.mgr_value), mgr_score: n(item.mgr_score),
      eff_weight: n(item.eff_weight), self_points: n(item.self_points), mgr_points: n(item.mgr_points),
    })),
    error: err(error),
  };
}

export async function loadSheet(sheetId: string): Promise<KpiSheet | null> {
  const { data } = await supabase.from('kpi_sheets').select('*').eq('id', sheetId).maybeSingle();
  return data ? numberizeSheet(data as KpiSheet) : null;
}

export async function loadMySheets(userId: string, fromMonth: string): Promise<KpiSheet[]> {
  const { data } = await supabase.from('kpi_sheets').select('*').eq('user_id', userId)
    .gte('period_month', fromMonth).order('period_month', { ascending: false });
  return ((data || []) as KpiSheet[]).map(numberizeSheet);
}

/** Phiếu người khác mà người đang đăng nhập chấm / xem được trong tháng. */
export async function loadTeamSheets(month: string, userId: string): Promise<KpiSheet[]> {
  const { data } = await supabase.from('kpi_sheets').select('*').eq('period_month', month).neq('user_id', userId);
  return ((data || []) as KpiSheet[]).map(numberizeSheet);
}

export async function loadSheetsRange(from: string, to: string): Promise<KpiSheet[]> {
  const { data } = await supabase.from('kpi_sheets').select('*').gte('period_month', from).lte('period_month', to);
  return ((data || []) as KpiSheet[]).map(numberizeSheet);
}

export async function loadLogs(filter: { sheetId?: string; month?: string }): Promise<KpiLog[]> {
  let query = supabase.from('kpi_logs').select('*').order('created_at', { ascending: false }).limit(300);
  if (filter.sheetId) query = query.eq('sheet_id', filter.sheetId);
  if (filter.month) query = query.eq('period_month', filter.month);
  const { data } = await query;
  return (data || []) as KpiLog[];
}

export async function loadPeriod(month: string): Promise<KpiPeriod | null> {
  const { data } = await supabase.from('kpi_periods').select('*').eq('month_start', month).maybeSingle();
  return (data as KpiPeriod | null) ?? null;
}

export async function loadSettings(): Promise<KpiSettings[]> {
  const { data } = await supabase.from('kpi_settings').select('*').order('effective_from', { ascending: false });
  return ((data || []) as KpiSettings[]).map(normalizeSettings);
}

export async function loadMySales(userId: string, month: string): Promise<KpiSalesTarget | null> {
  const { data } = await supabase.from('kpi_sales_targets').select('*').eq('user_id', userId).eq('period_month', month).maybeSingle();
  return data ? numberizeSales(data as KpiSalesTarget) : null;
}

export async function loadYearReviews(year: number): Promise<KpiYearReview[]> {
  const { data } = await supabase.from('kpi_year_reviews').select('*').eq('year', year);
  return (data || []) as KpiYearReview[];
}

const rpc = async (name: string, args: Record<string, unknown>) => {
  const { data, error } = await supabase.rpc(name, args);
  return { data, error: err(error) };
};

export interface SelfInput {
  id: string; value: number | null; score: number | null; na: boolean; note: string;
  evidence_url: string; evidence_path: string | null; evidence_name: string | null;
}

export interface ReviewInput { id: string; value: number | null; score: number | null; na: boolean; reason: string }

export const saveSelf = (sheetId: string, items: SelfInput[], explanation: string) =>
  rpc('kpi_save_self', { p_sheet: sheetId, p_items: items, p_explanation: explanation });
export const submitSheet = (sheetId: string) => rpc('kpi_submit', { p_sheet: sheetId });
export const saveReview = (sheetId: string, items: ReviewInput[], bonus: number, bonusNote: string) =>
  rpc('kpi_save_review', { p_sheet: sheetId, p_items: items, p_bonus: bonus, p_bonus_note: bonusNote });
export const approveSheet = (sheetId: string, note: string | null) => rpc('kpi_approve', { p_sheet: sheetId, p_note: note });
export const returnSheet = (sheetId: string, reason: string) => rpc('kpi_return', { p_sheet: sheetId, p_reason: reason });
export const openPeriod = (month: string) => rpc('kpi_open_period', { p_month: month });
export const lockPeriod = (month: string) => rpc('kpi_lock_period', { p_month: month });
export const requestReopen = (sheetId: string, reason: string, path: string, name: string) =>
  rpc('kpi_request_reopen', { p_sheet: sheetId, p_reason: reason, p_minutes_path: path, p_minutes_name: name });
export const decideReopen = (requestId: string, approve: boolean, note: string | null) =>
  rpc('kpi_decide_reopen', { p_request: requestId, p_approve: approve, p_note: note });
export const syncPayroll = (month: string) => rpc('kpi_sync_payroll', { p_month: month, p_user: null });

export const saveSalesTargets = (month: string, rows: Array<{ user_id: string; sales_target: number; collect_target: number; customers_target: number }>) =>
  rpc('kpi_save_sales_targets', { p_month: month, p_rows: rows });
export const saveSalesActuals = (month: string, rows: Array<{ user_id: string; sales_actual: number | null; collect_actual: number | null; customers_actual: number | null; note?: string }>) =>
  rpc('kpi_save_sales_actuals', { p_month: month, p_rows: rows });
export const reviewSalesTargets = (month: string, users: string[], action: 'SUBMIT' | 'APPROVE' | 'CHANGES', reason?: string) =>
  rpc('kpi_review_sales_targets', { p_month: month, p_users: users, p_action: action, p_reason: reason ?? null });
export const confirmSales = (month: string, confirm: boolean, note?: string) =>
  rpc('kpi_confirm_sales', { p_month: month, p_confirm: confirm, p_note: note ?? null });

export const savePayrollLinks = (links: Array<{ source: KpiLinkSource; component_code: string | null }>) =>
  rpc('kpi_save_payroll_links', { p_links: links });

export const saveYearReviews = (year: number, rows: unknown[], approve: boolean, payoutMonth: string | null) =>
  rpc('kpi_save_year_reviews', { p_year: year, p_rows: rows, p_approve: approve, p_payout_month: payoutMonth });

// ---------------------------------------------------------------------------
// Bộ KPI, tham số, người không áp dụng
// ---------------------------------------------------------------------------

export type SetDraftItem = Omit<KpiSetItem, 'id' | 'set_id' | 'sort_order'>;

export async function saveSet(set: Partial<KpiSet> & { name: string }, items: SetDraftItem[]) {
  return rpc('kpi_save_set', { p_set: set, p_items: items });
}

export async function setSetActive(id: string, active: boolean): Promise<string | null> {
  const { error } = await supabase.from('kpi_sets').update({ is_active: active }).eq('id', id);
  return err(error);
}

export async function deleteSet(id: string): Promise<string | null> {
  const { error } = await supabase.from('kpi_sets').delete().eq('id', id);
  return err(error);
}

export async function setProblemsRemote(id: string): Promise<string[]> {
  const { data } = await supabase.rpc('kpi_set_problems', { p_set: id });
  return (data as string[] | null) ?? [];
}

export async function saveSettings(row: Omit<KpiSettings, 'id' | 'note'> & { note?: string | null }): Promise<string | null> {
  const { error } = await supabase.from('kpi_settings').upsert(row, { onConflict: 'effective_from' });
  return err(error);
}

export async function deleteSettings(id: string): Promise<string | null> {
  const { error } = await supabase.from('kpi_settings').delete().eq('id', id);
  return err(error);
}

export async function setExempt(userId: string, exempt: boolean, reason = 'Không áp dụng KPI'): Promise<string | null> {
  const { error } = exempt
    ? await supabase.from('kpi_exemptions').upsert({ user_id: userId, reason })
    : await supabase.from('kpi_exemptions').delete().eq('user_id', userId);
  return err(error);
}

// ---------------------------------------------------------------------------
// Minh chứng / biên bản
// ---------------------------------------------------------------------------

export const KPI_BUCKET = 'kpi-evidence';
export const MAX_FILE_SIZE = 20 * 1024 * 1024;
const ALLOWED = ['pdf', 'png', 'jpg', 'jpeg', 'webp', 'heic', 'doc', 'docx', 'xls', 'xlsx'];

export function fileProblem(file: File): string | null {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (!ALLOWED.includes(ext)) return `Không nhận tệp .${ext || '?'} — dùng PDF, ảnh hoặc Office.`;
  if (file.size > MAX_FILE_SIZE) return 'Tệp quá 20 MB.';
  return null;
}

const cleanName = (name: string) => name
  .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd')
  .replace(/[^a-zA-Z0-9._-]/g, '-').replace(/-+/g, '-').slice(-80);

export async function uploadKpiFile(folder: string, file: File): Promise<{ path: string | null; error: string | null }> {
  const problem = fileProblem(file);
  if (problem) return { path: null, error: problem };
  const path = `${folder}/${Date.now()}-${cleanName(file.name)}`;
  const { error } = await supabase.storage.from(KPI_BUCKET).upload(path, file, { upsert: false });
  return { path: error ? null : path, error: error ? error.message : null };
}

export async function openKpiFile(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from(KPI_BUCKET).createSignedUrl(path, 300);
  if (error || !data) return error?.message ?? 'Không mở được tệp.';
  window.open(data.signedUrl, '_blank', 'noopener');
  return null;
}

/** Cách tính của các đầu mục trong cơ chế chung — để báo đầu mục nhận số KPI chưa để "Thay đổi theo tháng". */
export async function loadComponentModes(): Promise<Map<string, Set<string>>> {
  const { data } = await supabase.from('unit_pay_items').select('component_id, mode');
  const map = new Map<string, Set<string>>();
  for (const row of (data || []) as Array<{ component_id: string; mode: string }>) {
    map.set(row.component_id, (map.get(row.component_id) ?? new Set()).add(row.mode));
  }
  return map;
}
