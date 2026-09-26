// ============================================================================
// KPI của tôi — tự chấm, xem kết quả, xác nhận số liệu kinh doanh; quản lý
// trực tiếp chấm phiếu của nhóm ngay tại đây.
// ============================================================================

import { useEffect, useMemo, useState } from 'react';
import { startOfMonth } from 'date-fns';
import { CheckCircle2, MessageSquareWarning, Target } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Modal } from '@/components/ui/Modal';
import { MonthNav } from '@/components/ui/MonthNav';
import { Skeleton } from '@/components/ui/Skeleton';
import { Textarea } from '@/components/ui/Input';
import { KpiSheetView, sheetRole, type SheetViewer } from '@/components/kpi/KpiSheetView';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { useRealtimeSync } from '@/hooks/useRealtimeSync';
import { hasAdminFunction } from '@/lib/permissions';
import { toDateString } from '@/lib/utils';
import {
  GRADE_TONE, SHEET_STATUS_LABEL, SHEET_STATUS_TONE, fmtNum, fmtPct, monthLabelOf,
  type KpiPeriod, type KpiSalesTarget, type KpiSettings, type KpiSheet,
} from '@/lib/kpi';
import {
  confirmSales, loadMySales, loadMySheets, loadPeriod, loadSettings, loadTeamSheets, settingsFor,
} from '@/lib/kpiData';
import { supabase } from '@/lib/supabase';

type Tab = 'mine' | 'team' | 'history';

export function StaffKpi() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const [monthStart, setMonthStart] = useState(() => {
    const today = new Date();
    return startOfMonth(today.getDate() <= 10 ? new Date(today.getFullYear(), today.getMonth() - 1, 1) : today);
  });
  const month = toDateString(monthStart);
  const [tab, setTab] = useState<Tab>('mine');
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<KpiSettings[]>([]);
  const [period, setPeriod] = useState<KpiPeriod | null>(null);
  const [history, setHistory] = useState<KpiSheet[]>([]);
  const [team, setTeam] = useState<KpiSheet[]>([]);
  const [sales, setSales] = useState<KpiSalesTarget | null>(null);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [openSheet, setOpenSheet] = useState<KpiSheet | null>(null);
  const [disputeOpen, setDisputeOpen] = useState(false);
  const [dispute, setDispute] = useState('');

  const viewer: SheetViewer = useMemo(() => ({
    id: profile?.id ?? null,
    canManage: hasAdminFunction(profile, 'admin.performance_manage'),
    isBoard: hasAdminFunction(profile, 'admin.kpi_approve'),
    canClose: hasAdminFunction(profile, ['admin.kpi_close', 'admin.performance_manage']),
  }), [profile]);

  const load = async (silent = false) => {
    if (!profile) return;
    if (!silent) setLoading(true);
    const yearAgo = toDateString(new Date(monthStart.getFullYear() - 1, monthStart.getMonth(), 1));
    const [nextSettings, nextPeriod, mine, teamSheets, mySales] = await Promise.all([
      loadSettings(), loadPeriod(month), loadMySheets(profile.id, yearAgo), loadTeamSheets(month, profile.id), loadMySales(profile.id, month),
    ]);
    setSettings(nextSettings);
    setPeriod(nextPeriod);
    setHistory(mine);
    setTeam(teamSheets);
    setSales(mySales);
    const ids = [...new Set([...teamSheets.map((sheet) => sheet.user_id), ...mine.flatMap((sheet) => [sheet.reviewer_id, sheet.approved_by]),
      ...teamSheets.flatMap((sheet) => [sheet.reviewer_id, sheet.approved_by])].filter((id): id is string => !!id))];
    if (ids.length) {
      const { data } = await supabase.from('profiles_directory').select('id, name').in('id', ids);
      setNames(new Map(((data || []) as Array<{ id: string; name: string }>).map((row) => [row.id, row.name])));
    }
    setLoading(false);
  };

  useEffect(() => { void load(); }, [month, profile?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useRealtimeSync([{ table: 'kpi_sheets' }, { table: 'kpi_sales_targets' }], () => load(true), { enabled: !!profile, channelKey: 'staff-kpi' });

  const monthSettings = settingsFor(settings, month);
  const locked = period?.status === 'LOCKED';
  const mySheet = history.find((sheet) => sheet.period_month === month) ?? null;
  const nameOf = (id: string | null) => (id ? (id === profile?.id ? profile.name : names.get(id) ?? '—') : '—');
  const toReview = team.filter((sheet) => sheetRole(sheet, viewer, monthSettings, { locked, reopened: false }) != null);
  const showTeam = team.length > 0;

  const handleConfirm = async (ok: boolean) => {
    const { error } = await confirmSales(month, ok, ok ? undefined : dispute);
    if (error) { toast(error, 'error'); return; }
    toast(ok ? 'Đã xác nhận số liệu.' : 'Đã gửi khiếu nại.');
    setDisputeOpen(false); setDispute('');
    void load(true);
  };

  const tabs: Array<[Tab, string, number | null]> = [
    ['mine', 'Phiếu của tôi', null],
    ...(showTeam ? [['team', 'Cần chấm', toReview.length] as [Tab, string, number]] : []),
    ['history', 'Lịch sử', null],
  ];

  return (
    <div className="space-y-5">
      <div className="flex justify-center"><MonthNav value={monthStart} onChange={setMonthStart} theme="staff" bare /></div>

      <div className="flex gap-1 overflow-x-auto border-b border-slate-200" role="tablist">
        {tabs.map(([key, text, count]) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)}
            className={`-mb-px inline-flex shrink-0 items-center gap-2 border-b-2 px-4 py-3 text-sm font-semibold transition ${tab === key ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
            {text}
            {count != null && count > 0 && <span className="rounded-full bg-red-600 px-1.5 py-0.5 text-[10px] font-bold text-white">{count}</span>}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-2 border border-slate-200 bg-white p-4">
          {Array.from({ length: 5 }, (_, index) => <Skeleton key={index} className="h-10 w-full !rounded-none" />)}
        </div>
      ) : tab === 'mine' ? (
        <div className="space-y-4">
          {sales && (
            <Card className="!rounded-none">
              <CardContent className="space-y-3 py-3">
                <div className="grid grid-cols-1 gap-px bg-slate-100 sm:grid-cols-3">
                  {([
                    ['Doanh số cắt mã', sales.sales_actual, sales.sales_target],
                    ['Doanh số thu', sales.collect_actual, sales.collect_target],
                    ['Khách hàng có đơn', sales.customers_actual, sales.customers_target],
                  ] as Array<[string, number | null, number]>).map(([text, actual, target]) => (
                    <div key={text} className="bg-white px-3 py-2">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{text}</p>
                      <p className="text-sm tabular-nums text-slate-700">
                        <span className="text-lg font-bold text-slate-900">{fmtNum(actual)}</span> / {fmtNum(target)}
                        <span className="ml-2 font-semibold text-indigo-700">{actual != null && target ? fmtPct(Math.round((actual * 10000) / target) / 100) : ''}</span>
                      </p>
                    </div>
                  ))}
                </div>
                {sales.sales_actual != null && !locked && (
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    {sales.confirm_status === 'CONFIRMED' && <span className="text-xs font-semibold text-emerald-700">Bạn đã xác nhận số liệu</span>}
                    {sales.confirm_status === 'DISPUTED' && <span className="text-xs font-semibold text-red-600">Đã khiếu nại: {sales.dispute_note}</span>}
                    {sales.confirm_status !== 'CONFIRMED' && (
                      <Button size="sm" variant="success" theme="staff" onClick={() => void handleConfirm(true)}><CheckCircle2 className="h-3.5 w-3.5" /> Xác nhận</Button>
                    )}
                    <Button size="sm" variant="outline" theme="staff" onClick={() => setDisputeOpen(true)}><MessageSquareWarning className="h-3.5 w-3.5" /> Khiếu nại</Button>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
          {mySheet ? (
            <Card className="!rounded-none">
              <CardContent className="py-4">
                <KpiSheetView sheetId={mySheet.id} viewer={viewer} settings={monthSettings} locked={locked}
                  personName={profile?.name ?? ''} nameOf={nameOf} onChanged={() => void load(true)} />
              </CardContent>
            </Card>
          ) : (
            <Card className="!rounded-none">
              <EmptyState icon={<Target className="h-8 w-8" />} title={`Chưa có phiếu KPI tháng ${monthLabelOf(month)}`}
                description={period ? 'Bạn chưa được gán bộ KPI hoặc không thuộc diện đánh giá.' : 'Kỳ đánh giá tháng này chưa mở.'} />
            </Card>
          )}
        </div>
      ) : tab === 'team' ? (
        <SheetList sheets={team} nameOf={nameOf} highlight={new Set(toReview.map((sheet) => sheet.id))} onOpen={setOpenSheet}
          empty="Không có phiếu nào trong tháng này." />
      ) : (
        <SheetList sheets={history} nameOf={nameOf} showMonth onOpen={setOpenSheet} empty="Chưa có phiếu KPI nào." />
      )}

      <Modal square open={!!openSheet} onClose={() => setOpenSheet(null)} title={openSheet ? `Phiếu KPI tháng ${monthLabelOf(openSheet.period_month)}` : ''} size="2xl">
        {openSheet && (
          <KpiSheetView sheetId={openSheet.id} viewer={viewer} settings={settingsFor(settings, openSheet.period_month)}
            locked={openSheet.period_month === month ? locked : true}
            personName={nameOf(openSheet.user_id)} nameOf={nameOf}
            onChanged={() => void load(true)} onClose={() => setOpenSheet(null)} />
        )}
      </Modal>

      <Modal square open={disputeOpen} onClose={() => setDisputeOpen(false)} title="Khiếu nại số liệu kinh doanh" size="sm">
        <div className="space-y-3">
          <Textarea className="!rounded-none" label="Nội dung" required rows={3} value={dispute} onChange={(event) => setDispute(event.target.value)}
            placeholder="Số nào sai, số đúng là bao nhiêu" autoFocus />
          <div className="flex justify-end gap-2">
            <Button variant="outline" theme="staff" onClick={() => setDisputeOpen(false)}>Huỷ</Button>
            <Button theme="staff" onClick={() => void handleConfirm(false)} disabled={dispute.trim().length < 3}>Gửi</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function SheetList({ sheets, nameOf, onOpen, empty, highlight, showMonth = false }: {
  sheets: KpiSheet[]; nameOf: (id: string | null) => string; onOpen: (sheet: KpiSheet) => void; empty: string;
  highlight?: Set<string>; showMonth?: boolean;
}) {
  if (sheets.length === 0) return <Card className="!rounded-none"><CardContent className="py-10 text-center text-sm text-slate-500">{empty}</CardContent></Card>;
  const sorted = [...sheets].sort((a, b) => (showMonth
    ? b.period_month.localeCompare(a.period_month)
    : Number(highlight?.has(b.id)) - Number(highlight?.has(a.id)) || nameOf(a.user_id).localeCompare(nameOf(b.user_id), 'vi')));
  return (
    <Card className="!rounded-none">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] whitespace-nowrap text-xs tabular-nums text-slate-700">
          <thead>
            <tr className="border-b border-slate-200 bg-[#FCFAF8] text-[11px] font-semibold text-black">
              <th className="px-4 py-3 text-left">{showMonth ? 'Tháng' : 'Nhân viên'}</th>
              <th className="border-l border-slate-100 px-3 py-3 text-center">Trạng thái</th>
              <th className="border-l border-slate-100 px-3 py-3 text-center">Tự chấm</th>
              <th className="border-l border-slate-100 px-3 py-3 text-center">KPI chốt</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {sorted.map((sheet) => (
              <tr key={sheet.id} onClick={() => onOpen(sheet)} className={`cursor-pointer hover:bg-[#FCFAF8] ${highlight?.has(sheet.id) ? 'bg-amber-50/40' : ''}`}>
                <td className="px-4 py-2.5 font-semibold text-slate-800">{showMonth ? monthLabelOf(sheet.period_month) : nameOf(sheet.user_id)}</td>
                <td className="border-l border-slate-100 px-3 py-2.5 text-center">
                  <span className={`inline-flex rounded-md px-1.5 py-0.5 text-[10px] font-bold ring-1 ring-inset ${SHEET_STATUS_TONE[sheet.status]}`}>{SHEET_STATUS_LABEL[sheet.status]}</span>
                </td>
                <td className="border-l border-slate-100 px-3 py-2.5 text-center">{fmtPct(sheet.self_pct)}</td>
                <td className="border-l border-slate-100 px-3 py-2.5 text-center font-semibold">
                  {fmtPct(sheet.final_pct)}{sheet.grade && <span className={`ml-1.5 font-bold ${GRADE_TONE[sheet.grade] ?? ''}`}>{sheet.grade}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
