// ============================================================================
// Thiết lập lương — trang tổng quan và thanh bước dùng chung.
// ----------------------------------------------------------------------------
// Gom các màn thiết lập (làm một lần, sửa khi đổi chính sách) vào một chỗ, theo
// đúng thứ tự cần làm:
//
//   ① Thông số chung       bộ tham số hiệu lực của tháng (công chuẩn, BH, thuế…)
//   ② Bộ cơ chế mẫu         danh sách dòng đặt tên sẵn để copy cho nhiều người
//   ③ Cơ chế từng người     mỗi người một danh sách dòng riêng
//   ④ Chạy thử              xem phiếu của một người trước khi tính lương
//
// Mỗi bước tự kiểm tra trạng thái từ dữ liệu đã nạp nên kế toán biết ngay còn
// thiếu gì; bấm vào là tới đúng màn cần sửa.
// ============================================================================

import { useMemo } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { CheckCircle2, ChevronRight, CircleAlert, FlaskConical } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { versionForMonth } from '@/lib/payrollSettings';
import { blankMechanismRows, missingLabel, resolveMechanismRows } from '@/lib/payrollScheme';
import { schemeSourceOf } from '@/lib/payrollRun';
import type { PayrollWorkspace } from '@/lib/payrollData';
import type { Profile } from '@/types';

export const SETUP_BASE = '/admin/payroll/setup';

const STEP_LINKS = [
  { to: `${SETUP_BASE}/params`, label: '① Thông số chung', end: false },
  { to: `${SETUP_BASE}/schemes`, label: '② Cơ chế lương', end: false },
  { to: `${SETUP_BASE}/timesheet`, label: 'Liên kết Bảng công', end: false },
  { to: `${SETUP_BASE}/components`, label: 'Danh mục đầu mục', end: false },
] as const;

/** Thanh bước trên đầu mọi màn thiết lập lương. */
export function PayrollSetupSteps({ month }: { month: string }) {
  const query = `?month=${month.slice(0, 7)}`;
  return (
    <nav className="flex flex-wrap gap-1 border-b border-slate-200 no-print" aria-label="Các bước thiết lập lương">
      {STEP_LINKS.map((link) => (
        <NavLink
          key={link.to}
          to={`${link.to}${query}`}
          end={link.end}
          className={({ isActive }) => `-mb-px border-b-2 px-3.5 py-2 text-sm font-semibold transition ${
            isActive ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          {link.label}
        </NavLink>
      ))}
    </nav>
  );
}

interface PayrollSetupOverviewProps {
  data: PayrollWorkspace;
  monthStart: string;
  monthEnd: string;
  onDryRun: (personId?: string) => void;
}

interface PersonGap { person: Profile; noScheme: boolean; missing: string[] }

export function PayrollSetupOverview({ data, monthStart, monthEnd, onDryRun }: PayrollSetupOverviewProps) {
  const navigate = useNavigate();
  const month = monthStart.slice(0, 7);
  const version = useMemo(() => versionForMonth(data.paramVersions, monthStart), [data.paramVersions, monthStart]);

  const gaps = useMemo(() => {
    const source = schemeSourceOf(data);
    const result: PersonGap[] = [];
    for (const person of data.profiles) {
      const rows = resolveMechanismRows(person, source, monthStart, monthEnd);
      const missing = blankMechanismRows(rows).map((row) => row.component.name);
      if (rows.length === 0 || missing.length > 0) result.push({ person, noScheme: rows.length === 0, missing });
    }
    return result;
  }, [data, monthEnd, monthStart]);

  const noScheme = gaps.filter((gap) => gap.noScheme);
  const lacking = gaps.filter((gap) => !gap.noScheme);
  const missingCells = lacking.reduce((sum, gap) => sum + gap.missing.length, 0);
  const firstReady = data.profiles.find((person) => !gaps.some((gap) => gap.person.id === person.id));

  const steps = [
    {
      title: 'Thông số chung',
      detail: 'Công chuẩn, làm tròn thực lĩnh và các bảng tham số (bảo hiểm, thuế, làm thêm giờ…).',
      ok: !!version,
      status: version
        ? `${version.label?.trim() || 'Bộ tham số'} · hiệu lực từ ${version.effectiveFrom.slice(5, 7)}/${version.effectiveFrom.slice(0, 4)} · công chuẩn ${version.standardWorkDays}`
        : 'Chưa có bộ tham số hiệu lực cho tháng này',
      to: `${SETUP_BASE}/params?month=${month}`,
    },
    {
      title: 'Bộ cơ chế mẫu',
      detail: 'Danh sách dòng đặt tên sẵn, copy cho từng người rồi chỉnh riêng.',
      ok: data.schemes.length > 0,
      status: data.schemes.length > 0 ? `${data.schemes.length} bộ mẫu` : 'Chưa có bộ mẫu nào — có thể copy từ người khác',
      to: `${SETUP_BASE}/schemes?month=${month}&tab=templates`,
    },
    {
      title: 'Cơ chế từng người',
      detail: 'Mỗi người một danh sách dòng lương riêng của mình.',
      ok: gaps.length === 0,
      status: gaps.length === 0
        ? 'Mọi người đều đã có cơ chế'
        : `${noScheme.length > 0 ? `${noScheme.length} người chưa có cơ chế — phiếu sẽ ra 0đ` : ''}${noScheme.length > 0 && lacking.length > 0 ? ' · ' : ''}${lacking.length > 0 ? `${lacking.length} người còn thiếu ${missingCells} giá trị` : ''}`,
      to: `${SETUP_BASE}/schemes?month=${month}`,
    },
  ];

  return (
    <div className="space-y-4">
      <Card className="!rounded-none">
        <CardContent className="divide-y divide-slate-100 p-0">
          {steps.map((step, index) => (
            <button
              key={step.title}
              type="button"
              onClick={() => navigate(step.to)}
              className="flex w-full items-center gap-4 px-4 py-4 text-left transition hover:bg-slate-50"
            >
              <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                step.ok ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-700'
              }`}>
                {index + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-bold text-slate-900">{step.title}</span>
                <span className="block text-xs text-slate-500">{step.detail}</span>
                <span className={`mt-1 flex items-center gap-1.5 text-xs font-semibold ${step.ok ? 'text-emerald-700' : 'text-amber-700'}`}>
                  {step.ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <CircleAlert className="h-3.5 w-3.5" />}
                  {step.status}
                </span>
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" />
            </button>
          ))}
          <div className="flex w-full items-center gap-4 px-4 py-4">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-sm font-bold text-indigo-700">4</span>
            <span className="min-w-0 flex-1">
              <span className="block font-bold text-slate-900">Chạy thử</span>
              <span className="block text-xs text-slate-500">Xem phiếu lương của một người với số công giả định trước khi tính lương tháng.</span>
            </span>
            <Button size="sm" variant="outline" onClick={() => onDryRun(firstReady?.id)}>
              <FlaskConical className="h-4 w-4" /> Chạy thử
            </Button>
          </div>
        </CardContent>
      </Card>

      {gaps.length > 0 && (
        <Card className="!rounded-none">
          <CardContent className="space-y-2">
            <h3 className="text-sm font-bold text-slate-800">Người cần xử lý ({gaps.length})</h3>
            <ul className="divide-y divide-slate-50">
              {gaps.slice(0, 12).map((gap) => (
                <li key={gap.person.id}>
                  <button
                    type="button"
                    onClick={() => navigate(`${SETUP_BASE}/schemes?month=${month}&user=${gap.person.id}`)}
                    className="flex w-full items-center gap-2 py-1.5 text-left hover:bg-slate-50/70 dark:hover:bg-slate-800/50"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-bold text-slate-800 dark:text-slate-100">{gap.person.name}</span>
                      <span className="block truncate text-[10px] text-slate-400">{gap.person.employee_code ?? '—'} · {gap.person.department || '—'}</span>
                    </span>
                    <span
                      className={`max-w-[16rem] truncate rounded-full px-2 py-0.5 text-[10px] font-bold ${gap.noScheme ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-700'}`}
                      title={gap.noScheme ? undefined : `Còn trống: ${gap.missing.join(', ')}`}
                    >
                      {gap.noScheme ? 'Chưa có cơ chế' : missingLabel(gap.missing)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {gaps.length > 12 && <p className="text-xs text-slate-400">… và {gaps.length - 12} người khác.</p>}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
