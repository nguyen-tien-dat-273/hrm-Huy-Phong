// ============================================================================
// Lương & Đãi ngộ — trang khung cho các mục con trên sidebar.
// ----------------------------------------------------------------------------
//   Thiết lập lương (tổng quan)   → setup — gom ba mục dưới, có thanh bước
//   Danh mục khoản lương          → catalog
//   Tham số lương                 → params
//   Cơ chế lương (chung + riêng)  → schemes
//   Điều chỉnh                    → adjustments
//   Bảng lương (tính → khoá → chi) → register
//   Phê duyệt lương (BGĐ)         → approvals
//
// Trang chỉ nạp dữ liệu một lần cho tháng đang xem và chia cho từng mục; mỗi
// mục có quyền chức năng riêng (route đã chặn, ở đây chặn lần nữa để quyết
// định chỉ-xem hay được sửa). Không có con số lương nào được viết ở đây.
// ============================================================================

import { useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { endOfMonth, format, startOfMonth } from 'date-fns';
import { Calculator, ShieldAlert, TriangleAlert } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/Card';
import { ErrorState } from '@/components/ui/ErrorState';
import { MonthNav } from '@/components/ui/MonthNav';
import { PayrollSectionSkeleton } from '@/components/payroll/PayrollSkeletons';
import { ComponentCatalog } from '@/components/payroll/ComponentCatalog';
import { PayrollParamsTab } from '@/components/payroll/PayrollParamsTab';
import { TimesheetLinksBoard } from '@/components/payroll/TimesheetLinksBoard';
import { PayrollDryRunModal } from '@/components/payroll/PayrollDryRunModal';
import { PaySchemeTree } from '@/components/payroll/PaySchemeTree';
import { PayrollSetupSteps } from '@/components/payroll/PayrollSetupOverview';
import { AdjustmentsTab } from '@/components/payroll/AdjustmentsTab';
import { PayrollRegister, Banner, RUN_STATUS_LABEL } from '@/components/payroll/PayrollRegister';
import { PayrollApprovals } from '@/components/payroll/PayrollApprovals';
import { AdminWorkforceReports } from '@/pages/admin/AdminWorkforceReports';
import { useAuth } from '@/contexts/AuthContext';
import { useAppSettings } from '@/contexts/SettingsContext';
import { useRealtimeSync } from '@/hooks/useRealtimeSync';
import { hasAdminFunction, type AdminFunctionCode } from '@/lib/permissions';
import { toDateString } from '@/lib/utils';
import { loadPayrollWorkspace, type PayrollWorkspace } from '@/lib/payrollData';
import { paramsForMonth } from '@/lib/payrollRun';

type Tab = 'register' | 'setup' | 'schemes' | 'adjustments' | 'catalog' | 'params' | 'timesheet' | 'approvals' | 'reports';

/** Các mục thuộc "Thiết lập lương" — chung một thanh bước trên đầu trang. */
const SETUP_TABS: readonly Tab[] = ['params', 'schemes', 'timesheet', 'catalog'];

/**
 * Mỗi mục là một ROUTE riêng, đã hiện thành module con trên sidebar — trang
 * không vẽ thêm hàng tab. `monthScoped` quyết định có bộ chọn tháng không.
 */
const SECTION_META: Record<Tab, { title: string; hint: string; monthScoped: boolean; fn: readonly AdminFunctionCode[] }> = {
  setup: {
    title: 'Thiết lập lương',
    hint: '',
    monthScoped: true, fn: ['admin.payroll_settings', 'admin.payroll_schemes', 'admin.payroll_components'],
  },
  catalog: {
    title: 'Danh mục khoản lương',
    hint: '',
    monthScoped: false, fn: ['admin.payroll_components'],
  },
  params: {
    title: 'Tham số lương',
    hint: '',
    monthScoped: false, fn: ['admin.payroll_settings'],
  },
  timesheet: {
    title: 'Liên kết Bảng công',
    hint: '',
    monthScoped: false, fn: ['admin.payroll_settings'],
  },
  schemes: {
    title: 'Cơ chế lương',
    hint: '',
    monthScoped: true, fn: ['admin.payroll_settings', 'admin.payroll_schemes'],
  },
  adjustments: {
    title: 'Điều chỉnh lương',
    hint: '',
    monthScoped: true, fn: ['admin.payroll_adjustments'],
  },
  register: {
    title: 'Bảng lương tháng',
    hint: '',
    monthScoped: true, fn: ['admin.payroll'],
  },
  approvals: {
    title: 'Phê duyệt lương',
    hint: '',
    monthScoped: false, fn: ['admin.payroll_approve'],
  },
  reports: {
    title: 'Báo cáo lương',
    hint: '',
    monthScoped: false, fn: ['admin.payroll'],
  },
};

export function AdminPayroll({ section = 'register' }: { section?: Tab } = {}) {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const app = useAppSettings();
  const tab = section;
  const meta = SECTION_META[tab];
  const can = (code: AdminFunctionCode) => hasAdminFunction(profile, code);
  const canView = meta.fn.some(can);

  const [monthStart, setMonthStart] = useState(() => {
    const requested = searchParams.get('month');
    return requested && /^\d{4}-\d{2}$/.test(requested) ? new Date(`${requested}-01T00:00:00`) : startOfMonth(new Date());
  });
  const [data, setData] = useState<PayrollWorkspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [dryRun, setDryRun] = useState<{ personId?: string } | null>(null);

  const monthStartStr = toDateString(monthStart);
  const monthEndStr = toDateString(endOfMonth(monthStart));
  const monthLabel = format(monthStart, 'MM/yyyy');

  const loadData = async (silent = false) => {
    if (!canView) { setLoading(false); return; }
    if (tab === 'reports') {
      setLoading(false);
      return;
    }
    if (!silent) setLoading(true);
    setData(await loadPayrollWorkspace(monthStartStr, monthEndStr));
    setLoading(false);
  };
  useEffect(() => { void loadData(); }, [monthStartStr, canView]); // eslint-disable-line react-hooks/exhaustive-deps

  useRealtimeSync(
    [
      { table: 'attendance' }, { table: 'leave_requests' }, { table: 'timesheet_periods' },
      { table: 'employee_pay_profiles' }, { table: 'employee_pay_items' }, { table: 'payroll_schemes' }, { table: 'payroll_scheme_items' },
      { table: 'payroll_components' }, { table: 'payroll_inputs' }, { table: 'payroll_adjustments' },
      { table: 'payroll_runs' }, { table: 'payroll_scheme_requests' }, { table: 'payroll_param_versions' },
    ],
    () => loadData(true),
    { enabled: canView, channelKey: 'payroll' },
  );

  const params = useMemo(
    () => (data ? paramsForMonth(data, app, monthStart, monthStartStr) : null),
    [app, data, monthStart, monthStartStr],
  );
  const lastClosedMonth = data?.readiness?.lastClosedMonth ?? null;
  const runStatus = data?.run?.status ?? 'DRAFT';
  const monthClosed = runStatus === 'LOCKED' || runStatus === 'APPROVED' || runStatus === 'PAID';
  const reload = () => { void loadData(true); };

  const canManageSchemes = can('admin.payroll_schemes');

  if (!canView) {
    return (
      <Card className="!rounded-none">
        <CardContent>
          <p className="flex items-start gap-2.5 py-4 text-sm leading-relaxed text-slate-500">
            <ShieldAlert className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-500" />
            Bạn chưa được cấp chức năng cho mục <strong className="text-slate-700">{meta.title}</strong>. Dữ liệu lương
            chỉ mở theo đúng chức năng được giao.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (tab === 'setup') {
    return <Navigate to={`/admin/payroll/setup/params${searchParams.toString() ? `?${searchParams.toString()}` : ''}`} replace />;
  }

  if (tab === 'reports') {
    return (
      <div className="space-y-4">
        <AdminWorkforceReports
          defaultReport="movement"
          allowedTabs={['movement', 'insurance']}
        />
      </div>
    );
  }

  if (loading) {
    // Giữ nguyên tiêu đề + bộ chọn tháng, chỉ phần thân là khung chờ khớp bố cục từng mục.
    return (
      <div className="space-y-5">
        <div className="flex flex-wrap items-start justify-center gap-3 empty:hidden">
          {meta.monthScoped && tab !== 'register' && (
            <div className="flex flex-wrap items-center gap-2 no-print">
              <MonthNav value={monthStart} onChange={setMonthStart} bare />
            </div>
          )}
        </div>
        <PayrollSectionSkeleton section={tab} />
      </div>
    );
  }
  if (data?.error) {
    return (
      <div className="rounded-none border border-slate-200 bg-white">
        <ErrorState message={data.error} onRetry={() => loadData()} />
      </div>
    );
  }
  if (data && !data.engineReady) {
    return (
      <Card className="!rounded-none">
        <CardContent className="py-10 text-center">
          <Calculator className="mx-auto h-11 w-11 text-slate-300" />
          <h2 className="mt-3 text-lg font-bold text-slate-800">Chưa bật phần tính lương</h2>
          <p className="mx-auto mt-2 max-w-xl text-sm leading-relaxed text-slate-500">
            Cơ sở dữ liệu chưa có các bảng của phần lương. Liên hệ quản trị hệ thống để cập nhật rồi tải lại trang.
          </p>
        </CardContent>
      </Card>
    );
  }
  if (!data) return null;

  return (
    <div className="space-y-5 payroll-module" data-module="payroll">
      <div className="flex flex-wrap items-start justify-center gap-3 empty:hidden">
        {meta.monthScoped && tab !== 'register' && (
          <div className="flex flex-wrap items-center gap-2 no-print">
            <MonthNav value={monthStart} onChange={setMonthStart} bare />
            {data.run && (
              <span className="rounded-full bg-slate-100 dark:bg-slate-800 px-2.5 py-1 text-[11px] font-bold text-slate-600 dark:text-slate-300">
                Kỳ lương: {RUN_STATUS_LABEL[runStatus]}
              </span>
            )}
          </div>
        )}
      </div>

      {!data.specReady && (
        <Banner tone="amber" icon={<TriangleAlert className="mt-0.5 h-4 w-4 flex-shrink-0" />}>
          Cơ sở dữ liệu chưa cập nhật đủ cho phần lương (tham số theo hiệu lực, cơ chế, đề xuất, kỳ lương). Liên hệ quản trị
          hệ thống để cập nhật rồi tải lại trang.
        </Banner>
      )}
      {meta.monthScoped && tab !== 'register' && tab !== 'schemes' && monthClosed && (
        <Banner tone="amber" icon={<TriangleAlert className="mt-0.5 h-4 w-4 flex-shrink-0" />}>
          Kỳ lương {monthLabel} đã khoá — dữ liệu tháng này chỉ xem. Sai sót ghi vào Điều chỉnh lương của kỳ đang mở.
        </Banner>
      )}

      {SETUP_TABS.includes(tab) && <PayrollSetupSteps month={monthStartStr} />}

      {tab === 'catalog' && (
        <ComponentCatalog
          data={data}
          canManage={can('admin.payroll_components')}
          onChanged={reload}
        />
      )}

      {tab === 'params' && (
        <PayrollParamsTab
          data={data}
          lastClosedMonth={lastClosedMonth}
          currentMonth={monthStartStr}
          canManage={can('admin.payroll_settings')}
          onSaved={reload}
        />
      )}

      {tab === 'timesheet' && (
        <TimesheetLinksBoard
          data={data}
          canManage={can('admin.payroll_settings')}
          onChanged={reload}
        />
      )}

      {tab === 'schemes' && (
        <PaySchemeTree
          data={data}
          monthStart={monthStartStr}
          monthEnd={monthEndStr}
          lastClosedMonth={lastClosedMonth}
          canManage={canManageSchemes}
          focusUserId={searchParams.get('user')}
          initialTab={searchParams.get('tab') === 'templates' ? 'templates' : undefined}
          onChanged={reload}
          onDryRun={(personId) => setDryRun({ personId })}
        />
      )}

      {tab === 'adjustments' && (
        <AdjustmentsTab
          profiles={data.profiles}
          components={data.components}
          adjustments={data.adjustments}
          monthStart={monthStartStr}
          monthLabel={monthLabel}
          actorId={profile?.id ?? null}
          readOnly={monthClosed}
          onChanged={reload}
        />
      )}

      {tab === 'register' && (
        <PayrollRegister
          data={data}
          params={params}
          monthStart={monthStart}
          monthStartStr={monthStartStr}
          monthEndStr={monthEndStr}
          monthLabel={monthLabel}
          onMonthChange={setMonthStart}
          onChanged={reload}
        />
      )}

      {tab === 'approvals' && (
        <PayrollApprovals
          data={data}
          canApprove={can('admin.payroll_approve')}
          onChanged={reload}
          onOpenRun={(month) => navigate(`/admin/payroll?month=${month.slice(0, 7)}`)}
        />
      )}

      <PayrollDryRunModal
        open={!!dryRun}
        onClose={() => setDryRun(null)}
        data={data}
        monthStart={monthStart}
        monthStartStr={monthStartStr}
        monthEndStr={monthEndStr}
        initialPersonId={dryRun?.personId ?? null}
      />
    </div>
  );
}
