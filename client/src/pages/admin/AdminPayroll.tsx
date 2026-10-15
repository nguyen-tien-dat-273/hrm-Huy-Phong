// ============================================================================
// Lương & Đãi ngộ — trang khung cho các mục con trên sidebar.
// ----------------------------------------------------------------------------
//   Danh mục khoản lương          → catalog
//   Tham số lương                 → params
//   Cơ chế lương (thiết kế + áp)  → schemes
//   Số liệu tháng / Điều chỉnh    → inputs / adjustments
//   Bảng lương (tính → khoá → chi) → register
//   Phê duyệt lương (BGĐ)         → approvals
//
// Trang chỉ nạp dữ liệu một lần cho tháng đang xem và chia cho từng mục; mỗi
// mục có quyền chức năng riêng (route đã chặn, ở đây chặn lần nữa để quyết
// định chỉ-xem hay được sửa). Không có con số lương nào được viết ở đây.
// ============================================================================

import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { endOfMonth, format, startOfMonth } from 'date-fns';
import { Calculator, PencilRuler, ShieldAlert, TriangleAlert, UsersRound } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/Card';
import { ErrorState } from '@/components/ui/ErrorState';
import { MonthNav } from '@/components/ui/MonthNav';
import { TableSkeleton } from '@/components/ui/Skeleton';
import { ComponentCatalog } from '@/components/payroll/ComponentCatalog';
import { PayrollParamsTab } from '@/components/payroll/PayrollParamsTab';
import { MechanismDesigner } from '@/components/payroll/MechanismDesigner';
import { PayrollDryRunModal } from '@/components/payroll/PayrollDryRunModal';
import { PaySchemeTree } from '@/components/payroll/PaySchemeTree';
import { MonthlyInputsTab } from '@/components/payroll/MonthlyInputsTab';
import { AdjustmentsTab } from '@/components/payroll/AdjustmentsTab';
import { PayrollRegister, Banner, RUN_STATUS_LABEL } from '@/components/payroll/PayrollRegister';
import { PayrollApprovals } from '@/components/payroll/PayrollApprovals';
import { useAuth } from '@/contexts/AuthContext';
import { useAppSettings } from '@/contexts/SettingsContext';
import { useRealtimeSync } from '@/hooks/useRealtimeSync';
import { hasAdminFunction, type AdminFunctionCode } from '@/lib/permissions';
import { toDateString } from '@/lib/utils';
import { loadPayrollWorkspace, type PayrollWorkspace } from '@/lib/payrollData';
import { paramsForMonth } from '@/lib/payrollRun';
import type { PayrollParamVersion } from '@/lib/payrollSettings';

type Tab = 'register' | 'schemes' | 'inputs' | 'adjustments' | 'catalog' | 'params' | 'approvals';

/**
 * Mỗi mục là một ROUTE riêng, đã hiện thành module con trên sidebar — trang
 * không vẽ thêm hàng tab. `monthScoped` quyết định có bộ chọn tháng không.
 */
const SECTION_META: Record<Tab, { title: string; hint: string; monthScoped: boolean; fn: readonly AdminFunctionCode[] }> = {
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
  schemes: {
    title: 'Cơ chế lương',
    hint: '',
    monthScoped: true, fn: ['admin.payroll_settings', 'admin.payroll_schemes'],
  },
  inputs: {
    title: 'Số liệu lương tháng',
    hint: 'Con số nhập mỗi tháng cho các dòng “Thay đổi theo tháng” của cơ chế: doanh số, số chuyến…',
    monthScoped: true, fn: ['admin.payroll_inputs'],
  },
  adjustments: {
    title: 'Điều chỉnh lương',
    hint: 'Điều chỉnh tăng (+) / giảm (−) có lý do — truy lĩnh, truy thu sai sót của kỳ đã khoá ghi vào kỳ đang mở.',
    monthScoped: true, fn: ['admin.payroll_adjustments'],
  },
  register: {
    title: 'Bảng lương tháng',
    hint: 'Tính bảng lương nháp theo cơ chế, khoá kỳ bằng 2FA, Ban Giám đốc ký duyệt chi, xuất file ngân hàng và phát hành phiếu.',
    monthScoped: true, fn: ['admin.payroll'],
  },
  approvals: {
    title: 'Phê duyệt lương',
    hint: 'Ban Giám đốc ký duyệt đề xuất cơ chế lương và lệnh chi lương; từ chối phải ghi lý do.',
    monthScoped: false, fn: ['admin.payroll_approve'],
  },
};

export function AdminPayroll({ section = 'register' }: { section?: Tab } = {}) {
  const [searchParams, setSearchParams] = useSearchParams();
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
  const [dryRun, setDryRun] = useState<{ draftVersion?: PayrollParamVersion; templateId?: string } | null>(null);

  const monthStartStr = toDateString(monthStart);
  const monthEndStr = toDateString(endOfMonth(monthStart));
  const monthLabel = format(monthStart, 'MM/yyyy');

  const loadData = async (silent = false) => {
    if (!canView) { setLoading(false); return; }
    if (!silent) setLoading(true);
    setData(await loadPayrollWorkspace(monthStartStr, monthEndStr));
    setLoading(false);
  };
  useEffect(() => { void loadData(); }, [monthStartStr, canView]); // eslint-disable-line react-hooks/exhaustive-deps

  useRealtimeSync(
    [
      { table: 'attendance' }, { table: 'leave_requests' }, { table: 'timesheet_periods' },
      { table: 'employee_pay_profiles' }, { table: 'employee_pay_items' }, { table: 'unit_pay_items' },
      { table: 'payroll_components' }, { table: 'payroll_inputs' }, { table: 'payroll_adjustments' },
      { table: 'payroll_runs' }, { table: 'payroll_scheme_requests' }, { table: 'payroll_param_versions' },
      { table: 'payroll_templates' }, { table: 'payroll_template_items' }, { table: 'unit_payroll_templates' },
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

  // Cơ chế lương có hai phần: thiết kế (công thức) và áp cho nhân sự.
  const canDesign = can('admin.payroll_settings');
  const canApply = can('admin.payroll_schemes');
  const requestedTab = searchParams.get('tab');
  const schemeTab: 'design' | 'apply' = !canDesign ? 'apply' : !canApply ? 'design' : requestedTab === 'apply' ? 'apply' : 'design';
  const setSchemeTab = (next: 'design' | 'apply') => {
    const params = new URLSearchParams(searchParams);
    params.set('tab', next);
    setSearchParams(params, { replace: true });
  };

  if (!canView) {
    return (
      <Card>
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
  if (loading) {
    return <div className="rounded-2xl border border-slate-200 bg-white p-5"><TableSkeleton rows={6} /></div>;
  }
  if (data?.error) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white">
        <ErrorState message={data.error} onRetry={() => loadData()} />
      </div>
    );
  }
  if (data && !data.engineReady) {
    return (
      <Card>
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
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-800">
            {meta.title}{meta.monthScoped && tab === 'register' ? ` ${monthLabel}` : ''}
          </h2>
          {meta.hint && <p className="mt-0.5 max-w-3xl text-sm text-slate-500">{meta.hint}</p>}
        </div>
        {meta.monthScoped && (
          <div className="flex flex-wrap items-center gap-2 no-print">
            <MonthNav value={monthStart} onChange={setMonthStart} />
            {tab !== 'register' && data.run && (
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-600">
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
          onDryRun={(version) => setDryRun({ draftVersion: version })}
        />
      )}

      {tab === 'schemes' && (
        <div className="space-y-4">
          {canDesign && canApply && (
            <div className="inline-flex rounded-xl bg-slate-100 p-1 no-print" role="tablist" aria-label="Cơ chế lương">
              {([
                ['design', 'Thiết kế cơ chế', PencilRuler],
                ['apply', 'Áp dụng cho nhân sự', UsersRound],
              ] as const).map(([value, label, Icon]) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={schemeTab === value}
                  onClick={() => setSchemeTab(value)}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-semibold transition ${
                    schemeTab === value ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  <Icon className="h-4 w-4" /> {label}
                </button>
              ))}
            </div>
          )}
          {schemeTab === 'design' ? (
            <MechanismDesigner
              data={data}
              monthStart={monthStartStr}
              lastClosedMonth={lastClosedMonth}
              canManage={canDesign}
              onChanged={reload}
              onDryRun={(templateId) => setDryRun({ templateId })}
            />
          ) : (
            <PaySchemeTree
              data={data}
              monthStart={monthStartStr}
              monthEnd={monthEndStr}
              lastClosedMonth={lastClosedMonth}
              canManage={canApply}
              onChanged={reload}
            />
          )}
        </div>
      )}

      {tab === 'inputs' && (
        <MonthlyInputsTab
          data={data}
          monthStart={monthStartStr}
          monthEnd={monthEndStr}
          actorId={profile?.id ?? null}
          readOnly={monthClosed}
          onChanged={reload}
        />
      )}

      {tab === 'adjustments' && (
        <AdjustmentsTab
          profiles={data.profiles}
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
        draftVersion={dryRun?.draftVersion ?? null}
        templateId={dryRun?.templateId ?? null}
      />
    </div>
  );
}
