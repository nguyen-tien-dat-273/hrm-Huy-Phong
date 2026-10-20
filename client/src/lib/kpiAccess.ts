// Mục KPI nào mở cho chức năng nào — dùng chung cho route, menu và trang.
import type { AdminFunctionCode } from './permissions';

export type KpiSection = 'sets' | 'sheets' | 'sales' | 'report' | 'settings';

const KPI_ALL: readonly AdminFunctionCode[] = ['admin.performance_manage', 'admin.kpi_approve', 'admin.kpi_close'];

export const KPI_SECTION_FUNCTIONS: Record<KpiSection, readonly AdminFunctionCode[]> = {
  sets: ['admin.performance_manage'],
  sheets: KPI_ALL,
  sales: KPI_ALL,
  report: KPI_ALL,
  settings: ['admin.performance_manage'],
};
