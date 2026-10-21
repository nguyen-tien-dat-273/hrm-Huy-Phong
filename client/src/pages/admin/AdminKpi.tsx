// ============================================================================
// KPI — trang khung cho các mục con trên sidebar.
// ----------------------------------------------------------------------------
//   Bộ KPI                 → sets
//   Phiếu KPI tháng         → sheets   (chấm, duyệt, khoá sổ, mở lại)
//   Chỉ tiêu kinh doanh     → sales
//   Báo cáo KPI             → report
//   Tham số & liên kết lương → settings
// ============================================================================

import { useEffect, useMemo, useState } from 'react';
import { startOfMonth } from 'date-fns';
import { ShieldAlert, TriangleAlert } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/Card';
import { ErrorState } from '@/components/ui/ErrorState';
import { MonthNav } from '@/components/ui/MonthNav';
import { Skeleton } from '@/components/ui/Skeleton';
import { Banner } from '@/components/payroll/PayrollRegister';
import { KpiSetBoard } from '@/components/kpi/KpiSetBoard';
import { KpiPeriodBoard } from '@/components/kpi/KpiPeriodBoard';
import { KpiSalesBoard } from '@/components/kpi/KpiSalesBoard';
import { KpiReportBoard } from '@/components/kpi/KpiReportBoard';
import { KpiSettingsBoard } from '@/components/kpi/KpiSettingsBoard';
import { useAuth } from '@/contexts/AuthContext';
import { useRealtimeSync } from '@/hooks/useRealtimeSync';
import { hasAdminFunction } from '@/lib/permissions';
import { KPI_SECTION_FUNCTIONS, type KpiSection } from '@/lib/kpiAccess';
import { toDateString } from '@/lib/utils';
import { loadKpiWorkspace, settingsFor, type KpiWorkspace } from '@/lib/kpiData';
import type { SheetViewer } from '@/components/kpi/KpiSheetView';

const SECTION_META: Record<KpiSection, { title: string; monthScoped: boolean }> = {
  sets: { title: 'Bộ KPI', monthScoped: false },
  sheets: { title: 'Phiếu KPI tháng', monthScoped: true },
  sales: { title: 'Chỉ tiêu kinh doanh', monthScoped: true },
  report: { title: 'Báo cáo KPI', monthScoped: true },
  settings: { title: 'Tham số KPI', monthScoped: false },
};

export function AdminKpi({ section }: { section: KpiSection }) {
  const { profile } = useAuth();
  const meta = SECTION_META[section];
  const canView = hasAdminFunction(profile, KPI_SECTION_FUNCTIONS[section]);
  const canManage = hasAdminFunction(profile, 'admin.performance_manage');
  const viewer: SheetViewer = useMemo(() => ({
    id: profile?.id ?? null,
    canManage,
    isBoard: hasAdminFunction(profile, 'admin.kpi_approve'),
    canClose: canManage || hasAdminFunction(profile, 'admin.kpi_close'),
  }), [canManage, profile]);

  const [monthStart, setMonthStart] = useState(() => {
    // Kỳ KPI chấm vào đầu tháng sau: từ ngày 1 đến hết ngày 10, mặc định mở tháng trước.
    const today = new Date();
    return startOfMonth(today.getDate() <= 10 ? new Date(today.getFullYear(), today.getMonth() - 1, 1) : today);
  });
  const month = toDateString(monthStart);
  const [data, setData] = useState<KpiWorkspace | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async (silent = false) => {
    if (!canView) { setLoading(false); return; }
    if (!silent) setLoading(true);
    setData(await loadKpiWorkspace(month));
    setLoading(false);
  };
  useEffect(() => { void load(); }, [month, canView]); // eslint-disable-line react-hooks/exhaustive-deps

  useRealtimeSync(
    [{ table: 'kpi_sheets' }, { table: 'kpi_periods' }, { table: 'kpi_sales_targets' }],
    () => load(true),
    { enabled: canView, channelKey: 'kpi' },
  );

  if (!canView) {
    return (
      <Card className="!rounded-none">
        <CardContent>
          <p className="flex items-start gap-2.5 py-4 text-sm leading-relaxed text-slate-500">
            <ShieldAlert className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-500" />
            Bạn chưa được cấp chức năng cho mục <strong className="text-slate-700">{meta.title}</strong>.
          </p>
        </CardContent>
      </Card>
    );
  }

  const monthNav = meta.monthScoped && (
    <div className="flex justify-center no-print">
      <MonthNav value={monthStart} onChange={setMonthStart} bare />
    </div>
  );

  if (loading) {
    return (
      <div className="space-y-5">
        {monthNav}
        <div className="space-y-2 border border-slate-200 bg-white p-4">
          {Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-9 w-full !rounded-none" />)}
        </div>
      </div>
    );
  }
  if (!data) return null;
  if (data.error) {
    return <div className="border border-slate-200 bg-white"><ErrorState message={data.error} onRetry={() => load()} /></div>;
  }
  if (!data.ready) {
    return (
      <Banner tone="amber" icon={<TriangleAlert className="mt-0.5 h-4 w-4 flex-shrink-0" />}>
        Cơ sở dữ liệu chưa có phần KPI mới. Liên hệ quản trị hệ thống cập nhật rồi tải lại trang.
      </Banner>
    );
  }

  const settings = settingsFor(data.settings, month);
  const reload = () => { void load(true); };

  return (
    <div className="space-y-5 kpi-module" data-module="kpi">
      {monthNav}
      {section === 'sets' && <KpiSetBoard data={data} onChanged={reload} />}
      {section === 'sheets' && <KpiPeriodBoard data={data} month={month} settings={settings} viewer={viewer} onChanged={reload} />}
      {section === 'sales' && <KpiSalesBoard data={data} month={month} viewer={viewer} onChanged={reload} />}
      {section === 'report' && <KpiReportBoard data={data} month={month} settings={settings} viewer={viewer} />}
      {section === 'settings' && <KpiSettingsBoard data={data} month={month} onChanged={reload} />}
    </div>
  );
}
