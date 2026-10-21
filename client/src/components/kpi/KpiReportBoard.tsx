// ============================================================================
// Báo cáo KPI — tiến độ kỳ, kết quả tháng, tổng hợp quý/năm, xét thưởng năm.
// ============================================================================

import { useEffect, useMemo, useState } from 'react';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis
} from 'recharts';
import { BellRing, CheckCircle2, Save, Search, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';
import { Dropdown } from '@/components/ui/Dropdown';
import { ExportButtons } from '@/components/payroll/ExportButtons';
import type { SheetViewer } from '@/components/kpi/KpiSheetView';
import { useToast } from '@/contexts/ToastContext';
import { notifyUsers } from '@/lib/assignments';
import {
  BLOCK_LABEL, GRADE_TONE, SHEET_STATUS_LABEL, deadlineOf, fmtNum, fmtPct, fold, gradeOf, monthLabelOf, parseNum,
  type KpiBlock, type KpiSettings, type KpiSheet, type KpiSheetStatus, type KpiYearReview,
} from '@/lib/kpi';
import { loadSheetsRange, loadYearReviews, saveYearReviews, type KpiWorkspace } from '@/lib/kpiData';
import { supabase } from '@/lib/supabase';

type Tab = 'year' | 'progress' | 'month' | 'reward';

const TABS: Array<[Tab, string]> = [
  ['year', 'Tổng hợp quý / năm'],
  ['progress', 'Tiến độ kỳ'],
  ['month', 'Kết quả tháng'],
  ['reward', 'Xét thưởng & tăng lương'],
];

const avg = (values: number[]) => (values.length ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100 : null);

const GRADE_BADGE_STYLE: Record<string, string> = {
  'A+': 'border border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300',
  A: 'border border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300',
  B: 'border border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-300',
  C: 'border border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300',
  D: 'border border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300',
};

function renderHorizontalDeptTick(props: any) {
  const { x, y, payload } = props;
  const raw: string = String(payload?.value ?? '');
  if (!raw) return null;

  // Rút gọn các tiền tố phòng ban để hiển thị ngang hoàn toàn
  const clean = raw
    .replace(/^Phòng\s+/i, 'P. ')
    .replace(/^Bộ phận\s+/i, 'BP. ')
    .replace(/\s+-\s+Bộ phận\s+/i, ' - BP. ')
    .trim();

  // Chuỗi ngắn (<= 13 ký tự) nằm gọn trên 1 dòng ngang
  if (clean.length <= 13) {
    return (
      <g transform={`translate(${x},${y})`}>
        <text
          x={0}
          y={0}
          dy={12}
          textAnchor="middle"
          fill="#64748B"
          fontSize={10}
          fontWeight={500}
        >
          {clean}
        </text>
      </g>
    );
  }

  // Chuỗi dài hơn tách làm 2 dòng ngang cân đối
  let line1 = clean;
  let line2 = '';

  if (clean.includes(' - ')) {
    const parts = clean.split(' - ');
    line1 = parts[0];
    line2 = parts.slice(1).join(' - ');
  } else {
    const words = clean.split(/\s+/);
    if (words.length > 1) {
      const mid = Math.ceil(words.length / 2);
      line1 = words.slice(0, mid).join(' ');
      line2 = words.slice(mid).join(' ');
    }
  }

  if (line1.length > 14) line1 = line1.slice(0, 13) + '…';
  if (line2.length > 14) line2 = line2.slice(0, 13) + '…';

  return (
    <g transform={`translate(${x},${y})`}>
      <text
        x={0}
        y={0}
        textAnchor="middle"
        fill="#64748B"
        fontSize={10}
        fontWeight={500}
      >
        <tspan x={0} dy={10}>{line1}</tspan>
        {line2 ? <tspan x={0} dy={12}>{line2}</tspan> : null}
      </text>
    </g>
  );
}

export function KpiReportBoard({ data, month, settings, viewer }: {
  data: KpiWorkspace; month: string; settings: KpiSettings | null; viewer: SheetViewer;
}) {
  const { toast } = useToast();
  const [tab, setTab] = useState<Tab>('year');
  const [unitFilter, setUnitFilter] = useState('');
  const [blockFilter, setBlockFilter] = useState('');
  const [gradeFilter, setGradeFilter] = useState('');
  const [query, setQuery] = useState('');
  const year = Number(month.slice(0, 4));
  const [yearSheets, setYearSheets] = useState<KpiSheet[] | null>(null);
  const [lockedMonths, setLockedMonths] = useState<Set<string>>(new Set());

  const personById = useMemo(() => new Map(data.profiles.map((person) => [person.id, person])), [data.profiles]);
  const unitName = useMemo(() => new Map(data.units.map((unit) => [unit.id, unit.name])), [data.units]);
  const nameOf = (id: string) => personById.get(id)?.name ?? '—';
  const grades = settings?.grades ?? [];
  const label = monthLabelOf(month);

  useEffect(() => {
    if (tab !== 'year' && tab !== 'reward') return;
    let active = true;
    void Promise.all([
      loadSheetsRange(`${year}-01-01`, `${year}-12-01`),
      supabase.from('kpi_periods').select('month_start, status').gte('month_start', `${year}-01-01`).lte('month_start', `${year}-12-01`),
    ]).then(([sheets, periods]) => {
      if (!active) return;
      setYearSheets(sheets);
      setLockedMonths(new Set(((periods.data || []) as Array<{ month_start: string; status: string }>)
        .filter((row) => row.status === 'LOCKED').map((row) => row.month_start)));
    });
    return () => { active = false; };
  }, [tab, year]);

  const keyword = fold(query);
  const matches = (sheet: Pick<KpiSheet, 'user_id' | 'unit_id' | 'block'>) =>
    (!unitFilter || sheet.unit_id === unitFilter)
    && (!blockFilter || sheet.block === blockFilter)
    && (!keyword || fold(nameOf(sheet.user_id)).includes(keyword));

  const filters = (
    <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3 no-print">
      <div className="w-full sm:w-56">
        <Dropdown aria-label="Phòng ban" value={unitFilter} searchable
          options={[{ value: '', label: 'Tất cả phòng ban' }, ...data.units.filter((unit) => unit.is_active).map((unit) => ({ value: unit.id, label: unit.name }))]}
          onChange={setUnitFilter} />
      </div>
      <div className="w-full sm:w-40">
        <Dropdown aria-label="Khối" value={blockFilter} searchable={false}
          options={[{ value: '', label: 'Mọi khối' }, ...(Object.keys(BLOCK_LABEL) as KpiBlock[]).map((block) => ({ value: block, label: BLOCK_LABEL[block] }))]}
          onChange={setBlockFilter} />
      </div>
      {tab === 'month' && (
        <div className="w-full sm:w-36">
          <Dropdown aria-label="Xếp loại" value={gradeFilter} searchable={false}
            options={[{ value: '', label: 'Mọi xếp loại' }, ...grades.map((grade) => ({ value: grade.code, label: `${grade.code} · ${grade.label}` }))]}
            onChange={setGradeFilter} />
        </div>
      )}
      <div className="relative w-full sm:w-56">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm nhân viên…" aria-label="Tìm nhân viên"
          className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20" />
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex gap-1 overflow-x-auto border-b border-slate-200 no-print" role="tablist" aria-label="Loại báo cáo">
        {TABS.filter(([key]) => key !== 'reward' || viewer.isBoard || viewer.canClose || viewer.canManage).map(([key, text]) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)}
            className={`-mb-px shrink-0 border-b-2 px-4 py-3 text-sm font-semibold transition ${tab === key ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800'}`}>
            {text}
          </button>
        ))}
      </div>

      {tab === 'progress' && <Progress data={data} month={month} label={label} settings={settings} filters={filters} matches={matches} nameOf={nameOf} unitName={unitName} toast={toast} />}
      {tab === 'month' && <MonthResult data={data} label={label} month={month} grades={grades} gradeFilter={gradeFilter} filters={filters} matches={matches} nameOf={nameOf} unitName={unitName} />}
      {(tab === 'year' || tab === 'reward') && !yearSheets && <p className="py-10 text-center text-sm text-slate-400">Đang tổng hợp năm {year}…</p>}
      {tab === 'year' && yearSheets && (
        <YearSummary year={year} sheets={yearSheets} lockedMonths={lockedMonths} grades={grades} filters={filters} matches={matches} nameOf={nameOf} unitName={unitName} />
      )}
      {tab === 'reward' && yearSheets && (
        <Reward year={year} sheets={yearSheets} lockedMonths={lockedMonths} grades={grades} filters={filters} matches={matches} nameOf={nameOf} canApprove={viewer.isBoard} />
      )}
    </div>
  );
}

// --------------------------------------------------------------------------- Tiến độ
function Progress({ data, month, label, settings, filters, matches, nameOf, unitName, toast }: {
  data: KpiWorkspace; month: string; label: string; settings: KpiSettings | null; filters: React.ReactNode;
  matches: (sheet: KpiSheet) => boolean; nameOf: (id: string) => string; unitName: Map<string, string>;
  toast: (message: string, type?: 'success' | 'error' | 'warning') => void;
}) {
  const sheets = data.sheets.filter(matches);
  const now = new Date();
  const overdue = (sheet: KpiSheet) =>
    ((sheet.status === 'DRAFT' || sheet.status === 'REJECTED') && now > deadlineOf(month, 'SELF', settings))
    || (sheet.status === 'PENDING' && now > deadlineOf(month, 'MANAGER', settings))
    || (sheet.status === 'BOARD' && now > deadlineOf(month, 'BOARD', settings));
  const count = (status: KpiSheetStatus) => sheets.filter((sheet) => sheet.status === status).length;
  const tiles: Array<[string, number, string]> = [
    ['Chưa tự chấm', count('DRAFT'), 'text-slate-700'],
    ['Bị trả về', count('REJECTED'), 'text-red-600'],
    ['Chờ quản lý', count('PENDING'), 'text-amber-700'],
    ['Chờ BGĐ', count('BOARD'), 'text-violet-700'],
    ['Đã duyệt', count('APPROVED'), 'text-emerald-700'],
    ['Quá hạn', sheets.filter(overdue).length, 'text-red-600'],
  ];
  const byUnit = new Map<string, Record<KpiSheetStatus, number>>();
  for (const sheet of sheets) {
    const key = sheet.unit_id ?? '';
    const row = byUnit.get(key) ?? { DRAFT: 0, REJECTED: 0, PENDING: 0, BOARD: 0, APPROVED: 0 };
    row[sheet.status] += 1;
    byUnit.set(key, row);
  }

  const unitProgressData = useMemo(() => {
    return [...byUnit.entries()]
      .map(([unit, row]) => ({
        unit: unitName.get(unit) ?? 'Chưa gán phòng',
        approved: row.APPROVED,
        pending: row.PENDING + row.BOARD,
        draft: row.DRAFT + row.REJECTED,
      }))
      .filter((u) => u.approved > 0 || u.pending > 0 || u.draft > 0)
      .slice(0, 10);
  }, [byUnit, unitName]);

  const remind = async () => {
    const targets = new Set<string>();
    for (const sheet of sheets) {
      if (sheet.status === 'DRAFT' || sheet.status === 'REJECTED') targets.add(sheet.user_id);
      if (sheet.status === 'PENDING' && sheet.reviewer_id) targets.add(sheet.reviewer_id);
    }
    await notifyUsers([...targets], `KPI tháng ${label}`, 'Phiếu KPI đang chờ bạn chấm. Mở KPI của tôi để hoàn tất trước hạn.', 'kpi_reminder');
    toast(`Đã nhắc ${targets.size} người.`);
  };

  return (
    <Card className="!rounded-none">
      {filters}
      <div className="grid grid-cols-2 gap-px border-b border-slate-100 bg-slate-100 sm:grid-cols-3 lg:grid-cols-6">
        {tiles.map(([text, value, tone]) => (
          <div key={text} className="bg-white px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{text}</p>
            <p className={`text-2xl font-bold tabular-nums ${tone}`}>{value}</p>
          </div>
        ))}
      </div>

      {/* Biểu đồ tiến độ hoàn thành KPI theo phòng ban */}
      {unitProgressData.length > 0 && (
        <div className="border-b border-slate-100 p-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-800">
              Tiến độ hoàn thành KPI theo phòng ban
            </h4>
            <div className="flex items-center gap-3 text-xs">
              <span className="flex items-center gap-1.5 text-slate-600">
                <span className="h-3 w-3 inline-block rounded-none" style={{ backgroundColor: '#10B981' }} /> Đã duyệt
              </span>
              <span className="flex items-center gap-1.5 text-slate-600">
                <span className="h-3 w-3 inline-block rounded-none" style={{ backgroundColor: '#F59E0B' }} /> Chờ duyệt
              </span>
              <span className="flex items-center gap-1.5 text-slate-600">
                <span className="h-3 w-3 inline-block rounded-none" style={{ backgroundColor: '#94A3B8' }} /> Chưa xong
              </span>
            </div>
          </div>
          <div className="mt-3 h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={unitProgressData} margin={{ top: 5, right: 10, left: -25, bottom: 28 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" opacity={0.6} />
                <XAxis
                  dataKey="unit"
                  interval={0}
                  tickLine={false}
                  axisLine={{ stroke: '#CBD5E1' }}
                  tick={renderHorizontalDeptTick}
                />
                <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: '#64748B' }} />
                <Tooltip
                  contentStyle={{ borderRadius: '0px', borderColor: '#E2E8F0', fontSize: '12px' }}
                  labelFormatter={(value: any) => `Đơn vị: ${value}`}
                  formatter={(value: any, name: any) => [`${value} phiếu`, name]}
                />
                <Bar dataKey="approved" name="Đã duyệt" stackId="a" fill="#10B981" maxBarSize={24} />
                <Bar dataKey="pending" name="Chờ duyệt" stackId="a" fill="#F59E0B" maxBarSize={24} />
                <Bar dataKey="draft" name="Chưa xong" stackId="a" fill="#94A3B8" maxBarSize={24} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-2 px-4 py-2">
        <p className="text-xs text-slate-500">{sheets.length} phiếu</p>
        <Button size="sm" variant="outline" className="rounded-md shadow-2xs" onClick={() => void remind()} disabled={sheets.every((sheet) => sheet.status === 'APPROVED' || sheet.status === 'BOARD')}>
          <BellRing className="h-3.5 w-3.5" /> Nhắc người chưa xong
        </Button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-xs tabular-nums text-slate-900 dark:text-slate-100 border-collapse">
          <thead>
            <tr className="border-b-2 border-[#bf1f2b] dark:border-[#e66a76] bg-[#fdf2f4] dark:bg-[#201114] text-xs font-bold text-[#5c0f16] dark:text-[#fde8ea]">
              <th className="px-4 py-3 text-left whitespace-normal break-words">Phòng ban</th>
              {(['DRAFT', 'REJECTED', 'PENDING', 'BOARD', 'APPROVED'] as KpiSheetStatus[]).map((status) => (
                <th key={status} className="border-l border-[#eed5d8] dark:border-[#4a1c22] px-3 py-3 text-center whitespace-normal break-words">{SHEET_STATUS_LABEL[status]}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-300 dark:divide-slate-800 bg-white dark:bg-slate-900">
            {[...byUnit.entries()].sort((a, b) => (unitName.get(a[0]) ?? '').localeCompare(unitName.get(b[0]) ?? '', 'vi')).map(([unit, row]) => (
              <tr key={unit} className="group transition-colors hover:bg-slate-100/80 dark:hover:bg-slate-800/60">
                <td className="px-4 py-2.5 font-bold text-slate-900 dark:text-slate-100">{unitName.get(unit) ?? 'Chưa gán phòng'}</td>
                {(['DRAFT', 'REJECTED', 'PENDING', 'BOARD', 'APPROVED'] as KpiSheetStatus[]).map((status) => (
                  <td key={status} className="border-l border-slate-300 dark:border-slate-700 px-3 py-2.5 text-center font-semibold">{row[status] || '—'}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {sheets.some(overdue) && (
        <p className="border-t border-slate-100 px-4 py-2 text-xs text-red-600">
          Quá hạn: {sheets.filter(overdue).map((sheet) => nameOf(sheet.user_id)).join(', ')}
        </p>
      )}
    </Card>
  );
}

// --------------------------------------------------------------------------- Kết quả tháng
function MonthResult({ data, label, month, grades, gradeFilter, filters, matches, nameOf, unitName }: {
  data: KpiWorkspace; label: string; month: string; grades: KpiSettings['grades']; gradeFilter: string; filters: React.ReactNode;
  matches: (sheet: KpiSheet) => boolean; nameOf: (id: string) => string; unitName: Map<string, string>;
}) {
  const approved = data.sheets.filter((sheet) => sheet.status === 'APPROVED' && matches(sheet));
  const rows = approved.filter((sheet) => !gradeFilter || sheet.grade === gradeFilter)
    .sort((a, b) => (b.final_pct ?? 0) - (a.final_pct ?? 0));
  const values = approved.map((sheet) => sheet.final_pct ?? 0);
  const top = approved.filter((sheet) => sheet.grade === 'A+' || sheet.grade === 'A').length;
  const low = approved.filter((sheet) => sheet.grade === 'C' || sheet.grade === 'D').length;
  const dist = grades.map((grade) => ({ grade: grade.code, count: approved.filter((sheet) => sheet.grade === grade.code).length }));

  const unitKpiData = useMemo(() => {
    const map = new Map<string, number[]>();
    for (const sheet of approved) {
      if (sheet.final_pct == null) continue;
      const key = sheet.unit_id ?? 'OTHER';
      const list = map.get(key) ?? [];
      list.push(sheet.final_pct);
      map.set(key, list);
    }
    return [...map.entries()]
      .map(([key, vals]) => ({
        unit: unitName.get(key) ?? (key === 'OTHER' ? 'Chưa gán phòng' : '—'),
        avg: Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10,
        count: vals.length,
      }))
      .sort((a, b) => b.avg - a.avg);
  }, [approved, unitName]);

  const exportOptions = () => ({
    filename: `ket-qua-kpi-${month.slice(0, 7)}`,
    sheetName: 'Kết quả KPI',
    title: `KẾT QUẢ KPI THÁNG ${label}`,
    columns: [
      { header: 'Họ tên', value: (sheet: KpiSheet) => nameOf(sheet.user_id), width: 28 },
      { header: 'Phòng ban', value: (sheet: KpiSheet) => unitName.get(sheet.unit_id ?? '') ?? '', width: 24 },
      { header: 'Khối', value: (sheet: KpiSheet) => BLOCK_LABEL[sheet.block], width: 12 },
      { header: 'KPI %', value: (sheet: KpiSheet) => sheet.final_pct ?? '', width: 10 },
      { header: 'Xếp loại', value: (sheet: KpiSheet) => sheet.grade ?? '', width: 10 },
      { header: 'Thưởng trọng điểm %', value: (sheet: KpiSheet) => sheet.bonus_pct || '', width: 14 },
    ],
    rows,
  });

  if (data.period?.status !== 'LOCKED' && approved.length === 0) {
    return <Card className="!rounded-none">{filters}<p className="px-6 py-12 text-center text-sm text-slate-500">Chưa có dữ liệu kỳ đã khoá.</p></Card>;
  }

  return (
    <Card className="!rounded-none">
      {filters}
      <div className="grid grid-cols-2 gap-px border-b border-slate-100 bg-slate-100 sm:grid-cols-4">
        <Stat label="KPI bình quân" value={fmtPct(avg(values))} />
        <Stat label="Tỷ lệ A+ / A" value={approved.length ? fmtPct((top * 100) / approved.length) : '—'} />
        <Stat label="Xếp loại C / D" value={String(low)} tone={low ? 'text-red-600' : undefined} />
        <Stat label="Đã hoàn thành" value={`${approved.length} phiếu`} tone="text-emerald-700" />
      </div>

      {/* 2 Biểu đồ: Phân bổ xếp loại KPI & Điểm KPI theo phòng ban */}
      <div className="grid grid-cols-1 gap-4 p-4 lg:grid-cols-2 border-b border-slate-100">
        {/* Biểu đồ 1: Cơ cấu phân bổ xếp loại KPI */}
        <div className="border border-slate-200 bg-white p-3.5">
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-800 pb-2.5 border-b border-slate-100">
            Cơ cấu phân bổ xếp loại KPI
          </h4>
          <div className="mt-3 h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dist} margin={{ top: 5, right: 10, left: -25, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" opacity={0.6} />
                <XAxis dataKey="grade" tickLine={false} axisLine={{ stroke: '#CBD5E1' }} tick={{ fontSize: 11, fill: '#64748B' }} />
                <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: '#64748B' }} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#FFFFFF', borderColor: '#E2E8F0', borderRadius: '0px', fontSize: '12px' }}
                  formatter={(value: any) => [`${value} người`, 'Số người']}
                />
                <Bar dataKey="count" fill="#4F46E5" radius={[0, 0, 0, 0]} maxBarSize={32} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Biểu đồ 2: Điểm KPI trung bình theo phòng ban */}
        <div className="border border-slate-200 bg-white p-3.5">
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-800 pb-2.5 border-b border-slate-100">
            Điểm KPI trung bình theo phòng ban (%)
          </h4>
          <div className="mt-3 h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={unitKpiData} margin={{ top: 5, right: 10, left: -20, bottom: 28 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" opacity={0.6} />
                <XAxis
                  dataKey="unit"
                  interval={0}
                  tickLine={false}
                  axisLine={{ stroke: '#CBD5E1' }}
                  tick={renderHorizontalDeptTick}
                />
                <YAxis domain={[0, 120]} tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: '#64748B' }} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#FFFFFF', borderColor: '#E2E8F0', borderRadius: '0px', fontSize: '12px' }}
                  labelFormatter={(value: any) => `Đơn vị: ${value}`}
                  formatter={(value: any) => [`${value}%`, 'Điểm KPI']}
                />
                <Bar dataKey="avg" name="Điểm TB" fill="#7C3AED" radius={[0, 0, 0, 0]} maxBarSize={28} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="flex justify-end px-4 py-2"><ExportButtons options={exportOptions} disabled={rows.length === 0} /></div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[620px] whitespace-nowrap text-sm tabular-nums text-slate-900 dark:text-slate-100 border-collapse">
          <thead>
            <tr className="border-b-2 border-[#bf1f2b] dark:border-[#e66a76] bg-[#fdf2f4] dark:bg-[#201114] text-xs font-black uppercase tracking-wider text-[#5c0f16] dark:text-[#fde8ea]">
              <th className="px-4 py-3 text-left min-w-[180px]"><div className="min-w-[180px] line-clamp-3">Nhân sự</div></th>
              <th className="border-l border-[#eed5d8] dark:border-[#4a1c22] px-3 py-3 text-left min-w-[140px]"><div className="min-w-[140px] line-clamp-3">Phòng ban</div></th>
              <th className="border-l border-[#eed5d8] dark:border-[#4a1c22] px-3 py-3 text-center min-w-[90px]"><div className="min-w-[90px] line-clamp-3">Khối</div></th>
              <th className="border-l border-[#eed5d8] dark:border-[#4a1c22] px-3 py-3 text-center min-w-[90px]"><div className="min-w-[90px] line-clamp-3">KPI</div></th>
              <th className="border-l border-[#eed5d8] dark:border-[#4a1c22] px-3 py-3 text-center min-w-[100px]"><div className="min-w-[100px] line-clamp-3">Xếp loại</div></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-300 dark:divide-slate-700 bg-white dark:bg-slate-900 font-semibold">
            {rows.map((sheet) => (
              <tr key={sheet.id} className="group transition-colors hover:bg-slate-100/80 dark:hover:bg-slate-800/60">
                <td className="px-4 py-2.5 font-black text-sm text-slate-900 dark:text-slate-100">{nameOf(sheet.user_id)}</td>
                <td className="border-l border-slate-300 dark:border-slate-700 px-3 py-2.5 font-medium text-xs">{unitName.get(sheet.unit_id ?? '') ?? '—'}</td>
                <td className="border-l border-slate-300 dark:border-slate-700 px-3 py-2.5 text-center font-medium text-xs">{BLOCK_LABEL[sheet.block]}</td>
                <td className="border-l border-slate-300 dark:border-slate-700 px-3 py-2.5 text-center font-black text-sm text-indigo-700 dark:text-indigo-400">{fmtPct(sheet.final_pct)}</td>
                <td className="border-l border-slate-300 dark:border-slate-700 px-3 py-2.5 text-center">
                  <span className={`inline-block px-2.5 py-0.5 text-xs font-bold rounded-full ${GRADE_BADGE_STYLE[sheet.grade ?? ''] ?? 'border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100'}`}>
                    {sheet.grade ?? '—'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="bg-white px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`text-2xl font-bold tabular-nums ${tone ?? 'text-slate-900'}`}>{value}</p>
    </div>
  );
}

// --------------------------------------------------------------------------- Năm
interface PersonYear {
  userId: string;
  unitId: string | null;
  block: KpiBlock;
  months: Array<number | null>;
  grades: Array<string | null>;
  quarters: Array<number | null>;
  year: number | null;
  counted: number;
  alert: string | null;
}

function summarise(sheets: KpiSheet[], lockedMonths: Set<string>): PersonYear[] {
  const byUser = new Map<string, PersonYear>();
  for (const sheet of sheets) {
    if (sheet.status !== 'APPROVED' || !lockedMonths.has(sheet.period_month)) continue;
    const row = byUser.get(sheet.user_id) ?? {
      userId: sheet.user_id, unitId: sheet.unit_id, block: sheet.block,
      months: Array(12).fill(null), grades: Array(12).fill(null), quarters: [], year: null, counted: 0, alert: null,
    };
    const index = Number(sheet.period_month.slice(5, 7)) - 1;
    row.months[index] = sheet.final_pct;
    row.grades[index] = sheet.grade;
    row.unitId = sheet.unit_id ?? row.unitId;
    byUser.set(sheet.user_id, row);
  }
  for (const row of byUser.values()) {
    // Tháng không có phiếu khoá (chưa vào làm, nghỉ dài) không tính vào mẫu số.
    row.quarters = [0, 1, 2, 3].map((q) => avg(row.months.slice(q * 3, q * 3 + 3).filter((value): value is number => value != null)));
    row.year = avg(row.quarters.filter((value): value is number => value != null));
    row.counted = row.months.filter((value) => value != null).length;
    const d = row.grades.findIndex((grade) => grade === 'D');
    const c2 = row.grades.findIndex((grade, i) => grade === 'C' && row.grades[i + 1] === 'C');
    row.alert = d >= 0 ? `D tháng ${d + 1}` : c2 >= 0 ? `C liền tháng ${c2 + 1}–${c2 + 2}` : null;
  }
  return [...byUser.values()];
}

function YearSummary({ year, sheets, lockedMonths, grades, filters, matches, nameOf, unitName }: {
  year: number; sheets: KpiSheet[]; lockedMonths: Set<string>; grades: KpiSettings['grades']; filters: React.ReactNode;
  matches: (sheet: Pick<KpiSheet, 'user_id' | 'unit_id' | 'block'>) => boolean; nameOf: (id: string) => string; unitName: Map<string, string>;
}) {
  const rows = summarise(sheets, lockedMonths)
    .filter((row) => matches({ user_id: row.userId, unit_id: row.unitId, block: row.block }))
    .sort((a, b) => nameOf(a.userId).localeCompare(nameOf(b.userId), 'vi'));

  const monthAverages = useMemo(() => {
    const gradeBMin = grades.find((g) => g.code === 'B')?.min ?? 81;
    return Array.from({ length: 12 }, (_, i) => {
      const vals = rows.map((r) => r.months[i]).filter((v): v is number => v != null);
      const passVals = vals.filter((v) => v >= gradeBMin);
      return {
        month: `T${i + 1}`,
        avg: vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10 : 0,
        count: vals.length,
        passCount: passVals.length,
        passRate: vals.length ? Math.round((passVals.length / vals.length) * 1000) / 10 : 0,
      };
    });
  }, [rows, grades]);

  const exportOptions = () => ({
    filename: `tong-hop-kpi-${year}`,
    sheetName: `KPI ${year}`,
    title: `TỔNG HỢP KPI NĂM ${year}`,
    columns: [
      { header: 'Họ tên', value: (row: PersonYear) => nameOf(row.userId), width: 26 },
      { header: 'Phòng ban', value: (row: PersonYear) => unitName.get(row.unitId ?? '') ?? '', width: 22 },
      ...Array.from({ length: 12 }, (_, i) => ({ header: `T${i + 1}`, value: (row: PersonYear) => row.months[i] ?? '', width: 8 })),
      ...[0, 1, 2, 3].map((q) => ({ header: `Quý ${q + 1}`, value: (row: PersonYear) => row.quarters[q] ?? '', width: 9 })),
      { header: 'Năm', value: (row: PersonYear) => row.year ?? '', width: 9 },
      { header: 'Xếp loại', value: (row: PersonYear) => gradeOf(row.year, grades)?.code ?? '', width: 9 },
      { header: 'Cảnh báo', value: (row: PersonYear) => row.alert ?? '', width: 18 },
    ],
    rows,
  });

  return (
    <Card className="!rounded-none">
      {filters}
      <div className="flex items-center justify-between px-4 py-2">
        <p className="text-xs text-slate-500">Chỉ tính phiếu đã duyệt của kỳ đã khoá sổ.</p>
        <ExportButtons options={exportOptions} disabled={rows.length === 0} />
      </div>

      {/* Biểu đồ xu hướng điểm KPI bình quân & tỷ lệ đạt chỉ tiêu 12 tháng - Sóng sánh monotone */}
      {rows.length > 0 && (
        <div className="p-4 border-b border-slate-100">
          <div className="border border-slate-200 bg-white p-3.5">
            <div className="flex flex-wrap items-center justify-between gap-3 pb-2.5 border-b border-slate-100">
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                  Xu hướng điểm KPI & mức độ đạt Khá - Giỏi 12 tháng năm {year} (%)
                </h4>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Đường sóng thể hiện điểm KPI bình quân (%) và tỷ lệ % nhân sự đạt từ mức Khá trở lên
                </p>
              </div>
              <div className="flex items-center gap-3 text-xs">
                <span className="flex items-center gap-1.5 text-slate-600">
                  <span className="h-2.5 w-2.5 rounded-full inline-block" style={{ backgroundColor: '#4F46E5' }} /> % KPI bình quân
                </span>
                <span className="flex items-center gap-1.5 text-slate-600">
                  <span className="h-2.5 w-2.5 rounded-full inline-block" style={{ backgroundColor: '#10B981' }} /> % Đạt Khá - Giỏi
                </span>
                <span className="flex items-center gap-1.5 text-slate-500">
                  <span className="w-4 border-b border-dashed border-rose-500 inline-block" /> Mốc 100%
                </span>
              </div>
            </div>
            <div className="mt-3 h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={monthAverages} margin={{ top: 15, right: 15, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="kpiYearAvgGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#4F46E5" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="#4F46E5" stopOpacity={0.0} />
                    </linearGradient>
                    <linearGradient id="kpiYearPassGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10B981" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#10B981" stopOpacity={0.0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" opacity={0.6} />
                  <XAxis dataKey="month" tickLine={false} axisLine={{ stroke: '#CBD5E1' }} tick={{ fontSize: 11, fill: '#64748B' }} />
                  <YAxis domain={[0, 130]} tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: '#64748B' }} />
                  <ReferenceLine y={100} stroke="#EF4444" strokeDasharray="4 4" label={{ value: 'Chỉ tiêu 100%', fill: '#EF4444', fontSize: 10, position: 'right' }} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#FFFFFF', borderColor: '#E2E8F0', borderRadius: '0px', fontSize: '12px' }}
                    formatter={(val: any, name: any, item: any) => {
                      if (name === '% KPI bình quân') {
                        return val > 0 ? [`${val}%`, '% KPI bình quân'] : ['Chưa có dữ liệu', '% KPI bình quân'];
                      }
                      return item.payload.count > 0
                        ? [`${val}% (${item.payload.passCount}/${item.payload.count} người)`, 'Tỷ lệ Khá - Giỏi']
                        : ['Chưa có dữ liệu', 'Tỷ lệ Khá - Giỏi'];
                    }}
                    labelFormatter={(label) => `Tháng ${label}`}
                  />
                  <Area type="monotone" dataKey="avg" name="% KPI bình quân" stroke="#4F46E5" strokeWidth={2.5} fill="url(#kpiYearAvgGrad)" />
                  <Area type="monotone" dataKey="passRate" name="Tỷ lệ Khá - Giỏi" stroke="#10B981" strokeWidth={2} fill="url(#kpiYearPassGrad)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      {rows.length === 0 ? (
        <p className="px-6 py-12 text-center text-sm text-slate-500">Chưa có dữ liệu kỳ đã khoá trong năm {year}.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1100px] whitespace-nowrap text-sm tabular-nums text-slate-900 dark:text-slate-100 border-collapse">
            <thead>
              <tr className="border-b-2 border-[#bf1f2b] dark:border-[#e66a76] bg-[#fdf2f4] dark:bg-[#201114] text-xs font-black uppercase tracking-wider text-[#5c0f16] dark:text-[#fde8ea]">
                <th className="sticky left-0 top-0 z-20 bg-[#fdf2f4] dark:bg-[#201114] border-r-2 border-[#eed5d8] dark:border-[#4a1c22] px-4 py-3 text-left font-black text-[#5c0f16] dark:text-[#fde8ea] shadow-[inset_0_-2px_0_#bf1f2b] dark:shadow-[inset_0_-2px_0_#e66a76] min-w-[190px]"><div className="min-w-[190px] line-clamp-3">Nhân sự</div></th>
                {Array.from({ length: 12 }, (_, i) => <th key={i} className="border-l border-[#eed5d8] dark:border-[#4a1c22] px-2 py-3 text-center min-w-[50px]"><div className="min-w-[45px] text-center line-clamp-1">T{i + 1}</div></th>)}
                {[1, 2, 3, 4].map((q) => <th key={q} className="border-l border-[#eed5d8] dark:border-[#4a1c22] px-2 py-3 text-center min-w-[50px]"><div className="min-w-[45px] text-center line-clamp-1">Q{q}</div></th>)}
                <th className="border-l border-[#eed5d8] dark:border-[#4a1c22] px-3 py-3 text-center min-w-[85px]"><div className="min-w-[85px] text-center line-clamp-3">Năm</div></th>
                <th className="border-l border-[#eed5d8] dark:border-[#4a1c22] px-3 py-3 text-center min-w-[80px]"><div className="min-w-[80px] text-center line-clamp-3">Loại</div></th>
                <th className="border-l border-[#eed5d8] dark:border-[#4a1c22] px-3 py-3 text-left min-w-[120px]"><div className="min-w-[120px] line-clamp-3">Cảnh báo</div></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-300 dark:divide-slate-700 bg-white dark:bg-slate-900 font-semibold">
              {rows.map((row) => {
                const grade = gradeOf(row.year, grades);
                return (
                  <tr key={row.userId} className="group transition-colors hover:bg-slate-100/80 dark:hover:bg-slate-800/60">
                    <td className="sticky left-0 z-10 bg-white dark:bg-slate-900 group-hover:bg-slate-100/80 dark:group-hover:bg-slate-800/80 border-r-2 border-slate-400 dark:border-slate-600 shadow-[2px_0_4px_-1px_rgba(0,0,0,0.06)] dark:shadow-[2px_0_4px_-1px_rgba(0,0,0,0.4)] px-4 py-2.5 font-black text-sm text-slate-900 dark:text-slate-100">{nameOf(row.userId)}</td>
                    {row.months.map((value, i) => (
                      <td key={i} className={`border-l border-slate-300 dark:border-slate-700 px-2 py-2 text-center font-medium ${GRADE_TONE[row.grades[i] ?? ''] ?? ''}`}>{value == null ? '' : fmtNum(value)}</td>
                    ))}
                    {row.quarters.map((value, q) => <td key={q} className="border-l border-slate-300 dark:border-slate-700 px-2 py-2 text-center font-medium">{value == null ? '' : fmtNum(value)}</td>)}
                    <td className="border-l border-slate-300 dark:border-slate-700 px-3 py-2 text-center font-bold">{fmtPct(row.year)}</td>
                    <td className="border-l border-slate-300 dark:border-slate-700 px-3 py-2 text-center">
                      <span className={`inline-block px-2.5 py-0.5 text-[11px] font-bold rounded-full ${GRADE_BADGE_STYLE[grade?.code ?? ''] ?? 'border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100'}`}>
                        {grade?.code ?? '—'}
                      </span>
                    </td>
                    <td className="border-l border-slate-300 dark:border-slate-700 px-3 py-2 text-red-600 dark:text-red-400 font-semibold">
                      {row.alert && <span className="inline-flex items-center gap-1"><TriangleAlert className="h-3 w-3" /> {row.alert}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

// --------------------------------------------------------------------------- Xét thưởng
interface RewardDraft { bonus: string; raise: string; discipline: boolean; late: string; reason: string }

function Reward({ year, sheets, lockedMonths, grades, filters, matches, nameOf, canApprove }: {
  year: number; sheets: KpiSheet[]; lockedMonths: Set<string>; grades: KpiSettings['grades']; filters: React.ReactNode;
  matches: (sheet: Pick<KpiSheet, 'user_id' | 'unit_id' | 'block'>) => boolean; nameOf: (id: string) => string; canApprove: boolean;
}) {
  const { toast } = useToast();
  const [saved, setSaved] = useState<KpiYearReview[]>([]);
  const [drafts, setDrafts] = useState<Record<string, RewardDraft>>({});
  const [frame, setFrame] = useState<Record<string, { bonus: string; raise: string }>>({});
  const [payout, setPayout] = useState(`${year + 1}-01`);
  const [busy, setBusy] = useState(false);

  const load = async () => setSaved(await loadYearReviews(year));
  useEffect(() => { void load(); }, [year]); // eslint-disable-line react-hooks/exhaustive-deps

  const savedBy = new Map(saved.map((row) => [row.user_id, row]));
  const people = summarise(sheets, lockedMonths)
    .filter((row) => matches({ user_id: row.userId, unit_id: row.unitId, block: row.block }))
    .sort((a, b) => (b.year ?? 0) - (a.year ?? 0));

  const draftOf = (userId: string): RewardDraft => drafts[userId] ?? {
    bonus: savedBy.get(userId)?.bonus_amount == null ? '' : String(savedBy.get(userId)!.bonus_amount),
    raise: savedBy.get(userId)?.raise_pct == null ? '' : String(savedBy.get(userId)!.raise_pct),
    discipline: savedBy.get(userId)?.discipline_flag ?? false,
    late: savedBy.get(userId)?.late_count == null ? '' : String(savedBy.get(userId)!.late_count),
    reason: savedBy.get(userId)?.decision_reason ?? '',
  };
  const patch = (userId: string, value: Partial<RewardDraft>) => setDrafts((current) => ({ ...current, [userId]: { ...draftOf(userId), ...value } }));

  const applyFrame = () => {
    const next = { ...drafts };
    for (const person of people) {
      if (savedBy.get(person.userId)?.status === 'APPROVED') continue;
      const grade = gradeOf(person.year, grades)?.code ?? '';
      const rule = frame[grade];
      if (!rule) continue;
      const draft = draftOf(person.userId);
      next[person.userId] = { ...draft, bonus: rule.bonus || draft.bonus, raise: draft.discipline ? '0' : rule.raise || draft.raise };
    }
    setDrafts(next);
  };

  const submit = async (approve: boolean) => {
    const rows = people.filter((person) => savedBy.get(person.userId)?.status !== 'APPROVED').map((person) => {
      const draft = draftOf(person.userId);
      return {
        user_id: person.userId,
        months: person.counted,
        avg_pct: person.year,
        grade: gradeOf(person.year, grades)?.code ?? null,
        late_count: parseNum(draft.late),
        discipline_flag: draft.discipline,
        bonus_amount: parseNum(draft.bonus),
        raise_pct: parseNum(draft.raise),
        decision_reason: draft.reason,
      };
    });
    setBusy(true);
    const { error } = await saveYearReviews(year, rows, approve, approve ? `${payout}-01` : null);
    setBusy(false);
    if (error) { toast(error, 'error'); return; }
    toast(approve ? 'Đã phê duyệt thưởng năm và tăng lương.' : 'Đã lưu đề xuất.');
    setDrafts({});
    void load();
  };

  const cell = 'h-8 w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 text-center text-sm font-bold tabular-nums text-slate-900 dark:text-slate-100 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/20';

  return (
    <Card className="!rounded-none border-2 border-slate-400 dark:border-slate-600 shadow-sm overflow-hidden">
      {filters}
      {canApprove && (
        <CardContent className="space-y-2 border-b-2 border-slate-300 dark:border-slate-700 py-3">
          <p className="text-xs font-black uppercase tracking-wider text-slate-900 dark:text-slate-100">Khung theo xếp loại</p>
          <div className="flex flex-wrap items-end gap-2">
            {grades.map((grade) => (
              <div key={grade.code} className="flex items-center gap-1 border border-slate-300 dark:border-slate-700 rounded-md px-2 py-1 bg-white dark:bg-slate-800">
                <span className={`w-7 text-xs font-bold ${GRADE_TONE[grade.code] ?? ''}`}>{grade.code}</span>
                <input placeholder="Thưởng" aria-label={`Thưởng loại ${grade.code}`} value={frame[grade.code]?.bonus ?? ''}
                  onChange={(event) => setFrame((current) => ({ ...current, [grade.code]: { raise: current[grade.code]?.raise ?? '', bonus: event.target.value.replace(/[^\d.,]/g, '') } }))}
                  className="h-8 w-28 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 text-xs font-bold tabular-nums text-slate-900 dark:text-slate-100 outline-none focus:border-indigo-500" />
                <input placeholder="% tăng" aria-label={`Tăng lương loại ${grade.code}`} value={frame[grade.code]?.raise ?? ''}
                  onChange={(event) => setFrame((current) => ({ ...current, [grade.code]: { bonus: current[grade.code]?.bonus ?? '', raise: event.target.value.replace(/[^\d.,]/g, '') } }))}
                  className="h-8 w-16 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 text-xs font-bold tabular-nums text-slate-900 dark:text-slate-100 outline-none focus:border-indigo-500" />
              </div>
            ))}
            <Button size="sm" variant="outline" onClick={applyFrame}>Áp khung</Button>
          </div>
        </CardContent>
      )}
      {people.length === 0 ? (
        <p className="px-6 py-12 text-center text-sm font-semibold text-slate-500">Chưa có dữ liệu kỳ đã khoá trong năm {year}.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1000px] whitespace-nowrap text-sm tabular-nums text-slate-900 dark:text-slate-100 border-collapse">
            <thead>
              <tr className="border-b-2 border-[#bf1f2b] dark:border-[#e66a76] bg-[#fdf2f4] dark:bg-[#201114] text-xs font-black uppercase tracking-wider text-[#5c0f16] dark:text-[#fde8ea]">
                <th className="px-4 py-3 text-left min-w-[170px]"><div className="min-w-[170px] line-clamp-3">Nhân sự</div></th>
                <th className="border-l border-[#eed5d8] dark:border-[#4a1c22] px-3 py-3 text-center min-w-[90px]"><div className="min-w-[90px] text-center line-clamp-3">KPI năm</div></th>
                <th className="border-l border-[#eed5d8] dark:border-[#4a1c22] px-3 py-3 text-center min-w-[75px]"><div className="min-w-[75px] text-center line-clamp-3">Loại</div></th>
                <th className="border-l border-[#eed5d8] dark:border-[#4a1c22] px-3 py-3 text-center min-w-[130px]"><div className="min-w-[130px] text-center line-clamp-3 leading-snug">Đi muộn / về sớm</div></th>
                <th className="border-l border-[#eed5d8] dark:border-[#4a1c22] px-3 py-3 text-center min-w-[85px]"><div className="min-w-[85px] text-center line-clamp-3 leading-snug">Kỷ luật</div></th>
                <th className="border-l border-[#eed5d8] dark:border-[#4a1c22] px-3 py-3 text-center min-w-[125px]"><div className="min-w-[125px] text-center line-clamp-3 leading-snug">Thưởng (đồng)</div></th>
                <th className="border-l border-[#eed5d8] dark:border-[#4a1c22] px-3 py-3 text-center min-w-[115px]"><div className="min-w-[115px] text-center line-clamp-3 leading-snug">Tăng lương %</div></th>
                <th className="border-l border-[#eed5d8] dark:border-[#4a1c22] px-3 py-3 text-left min-w-[170px]"><div className="min-w-[170px] line-clamp-3 leading-snug">Ghi chú quyết định</div></th>
                <th className="border-l border-[#eed5d8] dark:border-[#4a1c22] px-3 py-3 text-center min-w-[100px]"><div className="min-w-[100px] text-center line-clamp-3 leading-snug">Trạng thái</div></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-300 dark:divide-slate-700 bg-white dark:bg-slate-900 font-semibold">
              {people.map((person) => {
                const record = savedBy.get(person.userId);
                const done = record?.status === 'APPROVED';
                const draft = draftOf(person.userId);
                const grade = gradeOf(person.year, grades);
                const editable = canApprove && !done;
                return (
                  <tr key={person.userId} className="group transition-colors hover:bg-slate-100/80 dark:hover:bg-slate-800/60">
                    <td className="px-4 py-2 font-black text-sm text-slate-900 dark:text-slate-100 min-w-[170px]">{nameOf(person.userId)}<span className="ml-1 text-xs font-normal text-slate-500 dark:text-slate-400">{person.counted} tháng</span></td>
                    <td className="border-l border-slate-300 dark:border-slate-700 px-3 py-2 text-center font-bold min-w-[90px]">{fmtPct(person.year)}</td>
                    <td className={`border-l border-slate-300 dark:border-slate-700 px-3 py-2 text-center font-bold min-w-[75px] ${GRADE_TONE[grade?.code ?? ''] ?? ''}`}>{grade?.code ?? '—'}</td>
                    <td className="border-l border-slate-300 dark:border-slate-700 px-2 py-2 min-w-[130px]">{editable ? <input value={draft.late} onChange={(e) => patch(person.userId, { late: e.target.value.replace(/\D/g, '') })} className={cell} aria-label="Số lần đi muộn về sớm" /> : <span className="block text-center font-bold">{record?.late_count ?? '—'}</span>}</td>
                    <td className="border-l border-slate-300 dark:border-slate-700 px-2 py-2 text-center min-w-[85px]">
                      <input type="checkbox" disabled={!editable} checked={draft.discipline} aria-label="Bị kỷ luật trong năm"
                        onChange={(e) => patch(person.userId, { discipline: e.target.checked, ...(e.target.checked ? { raise: '0' } : {}) })} className="h-4 w-4 accent-red-600" />
                    </td>
                    <td className="border-l border-slate-300 dark:border-slate-700 px-2 py-2 min-w-[125px]">{editable ? <input value={draft.bonus} inputMode="decimal" onChange={(e) => patch(person.userId, { bonus: e.target.value.replace(/[^\d.,]/g, '') })} className={cell} aria-label="Thưởng" /> : <span className="block text-center font-bold">{fmtNum(record?.bonus_amount)}</span>}</td>
                    <td className="border-l border-slate-300 dark:border-slate-700 px-2 py-2 min-w-[115px]">{editable ? <input value={draft.raise} inputMode="decimal" disabled={draft.discipline} onChange={(e) => patch(person.userId, { raise: e.target.value.replace(/[^\d.,]/g, '') })} className={`${cell} disabled:bg-slate-100 dark:disabled:bg-slate-800 disabled:opacity-50`} aria-label="Tăng lương %" /> : <span className="block text-center font-bold">{record?.raise_pct == null ? '—' : fmtPct(record.raise_pct)}</span>}</td>
                    <td className="border-l border-slate-300 dark:border-slate-700 px-2 py-2 min-w-[170px]">{editable ? <input value={draft.reason} onChange={(e) => patch(person.userId, { reason: e.target.value })} className={`${cell} !text-left`} aria-label="Ghi chú quyết định" /> : <span className="text-slate-700 dark:text-slate-300 font-medium text-xs">{record?.decision_reason ?? ''}</span>}</td>
                    <td className="border-l border-slate-300 dark:border-slate-700 px-3 py-2 text-center min-w-[100px]">
                      {done ? <span className="font-bold text-emerald-700 dark:text-emerald-400">Đã duyệt</span> : record ? <span className="font-semibold text-slate-600 dark:text-slate-300">Đề xuất</span> : <span className="text-slate-400">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {canApprove && people.some((person) => savedBy.get(person.userId)?.status !== 'APPROVED') && (
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 px-4 py-3">
          <label className="flex items-center gap-2 text-xs font-semibold text-slate-600">
            Chi thưởng vào lương tháng
            <input type="month" value={payout} onChange={(event) => setPayout(event.target.value)}
              className="h-9 rounded-none border border-slate-200 px-2 text-sm outline-none focus:border-indigo-500" />
          </label>
          <Button size="sm" variant="outline" onClick={() => void submit(false)} disabled={busy}><Save className="h-3.5 w-3.5" /> Lưu đề xuất</Button>
          <Button size="sm" variant="success" onClick={() => void submit(true)} disabled={busy}><CheckCircle2 className="h-3.5 w-3.5" /> Phê duyệt</Button>
        </div>
      )}
    </Card>
  );
}
