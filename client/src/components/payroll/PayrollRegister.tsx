// ============================================================================
// Bảng lương tháng: tính → khoá kỳ (2FA) → BGĐ ký duyệt chi → file ngân hàng
// → xác nhận chi trả & phát hành phiếu.
// ----------------------------------------------------------------------------
// • Bản nháp / Đã tính: số liệu tính TRỰC TIẾP từ chấm công, KPI, cơ chế lương
//   đã duyệt và bộ tham số hiệu lực — mỗi lần "Tính lại" ghi đè bộ phiếu nháp.
// • Đã khoá trở đi: hiển thị ĐÚNG bộ phiếu đã ghi, không tính lại. Sai sót sau
//   khi khoá xử lý bằng Điều chỉnh lương của kỳ sau — không có nút mở lại kỳ.
// • Bảng điền THEO ĐẦU MỤC: mỗi đầu mục của cơ chế một cột, đúng như bảng
//   lương kế toán vẫn làm trên Excel.
// • Mọi chuyển trạng thái đi qua RPC ở database; màn này chỉ gọi và hiển thị.
// ============================================================================

import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { format } from 'date-fns';
import {
  BookOpenCheck, Calculator, CheckCircle2, CircleAlert, CircleCheck, FileSpreadsheet, History, Landmark,
  LockKeyhole, Pencil, Search, TriangleAlert, Undo2, Wallet,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/Card';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Select, Textarea } from '@/components/ui/Input';
import { PayslipBreakdown } from '@/components/payroll/PayslipBreakdown';
import { ExportButtons } from '@/components/payroll/ExportButtons';
import { TwoFactorDialog } from '@/components/payroll/TwoFactorDialog';
import { BankExportModal } from '@/components/payroll/BankExportModal';
import { PaySchemeModal, type SchemeTarget } from '@/components/payroll/PaySchemeModal';
import { Timeline } from '@/components/payroll/PayrollApprovals';
import { useToast } from '@/contexts/ToastContext';
import { useConfirm } from '@/contexts/ConfirmContext';
import { useAuth } from '@/contexts/AuthContext';
import { hasAdminFunction } from '@/lib/permissions';
import { formatDateTime, formatVND } from '@/lib/utils';
import type { ComputedPayslip } from '@/lib/payroll';
import type { PayrollParams } from '@/lib/payrollSettings';
import { computeForPerson } from '@/lib/payrollRun';
import { buildPayrollJournal } from '@/lib/payrollJournal';
import { formatFormulaNumber } from '@/lib/formulaTokens';
import { KIND_SIGN } from '@/lib/formulaEntries';
import { stripVietnamese } from '@/lib/tableExport';
import {
  REAUTH_REQUIRED, ensurePayrollRun, fetchPayrollApproverIds, lockPayrollRun, markPayrollRunPaid, payslipDeductions,
  persistPayslips, withdrawPayrollRun, type PayrollWorkspace,
} from '@/lib/payrollData';
import { notifyUsers } from '@/lib/assignments';
import type { PayComponentKind, PayrollRunStatus, Profile } from '@/types';

interface PayrollRegisterProps {
  data: PayrollWorkspace;
  params: PayrollParams | null;
  monthStart: Date;
  monthStartStr: string;
  monthEndStr: string;
  monthLabel: string;
  onChanged: () => void;
}

interface PayrollRow {
  profile: Profile;
  computed: ComputedPayslip;
  hasScheme: boolean;
  /** Tên cơ chế đang áp (chỉ có khi tính trực tiếp). */
  mechanism: string | null;
}

interface ItemColumn {
  code: string;
  name: string;
  kind: PayComponentKind;
}

export const RUN_STATUS_LABEL: Record<PayrollRunStatus, string> = {
  DRAFT: 'Bản nháp',
  CALCULATED: 'Đã tính',
  LOCKED: 'Đã khoá · chờ BGĐ',
  APPROVED: 'BGĐ đã duyệt chi',
  PAID: 'Đã chi trả & phát hành',
};
const RUN_ORDER: PayrollRunStatus[] = ['DRAFT', 'CALCULATED', 'LOCKED', 'APPROVED', 'PAID'];
const PAGE_SIZE = 50;

type SortKey = 'name' | 'net_desc' | 'net_asc' | 'unit';
type StatusFilter = 'ALL' | 'MISSING' | 'WARNING';

const stripTone = (text: string) => stripVietnamese(text).toLowerCase().trim();

/** Phiếu đã ghi → cùng dạng với phiếu tính trực tiếp, để một bảng vẽ được cả hai. */
function rowsFromPayslips(data: PayrollWorkspace): PayrollRow[] {
  const linesBySlip = new Map<string, typeof data.payslipLines>();
  for (const line of data.payslipLines) {
    linesBySlip.set(line.payslip_id, [...(linesBySlip.get(line.payslip_id) ?? []), line]);
  }
  return data.payslips.map((slip) => ({
    profile: data.profiles.find((person) => person.id === slip.user_id)
      ?? ({ id: slip.user_id, name: slip.employee_name, department: slip.department, employee_code: slip.employee_code, avatar_url: null } as Profile),
    hasScheme: true,
    mechanism: null,
    computed: {
      stats: {
        workDays: Number(slip.work_days), leaveDays: Number(slip.leave_days), holidayDays: 0,
        paidDays: Number(slip.paid_days), workHours: Number(slip.work_hours), missingCheckout: 0,
        lateMinutes: 0, lateCount: 0, lateAfterCutoffCount: 0, earlyMinutes: 0, earlyCount: 0,
      },
      standardDays: Number(slip.standard_days),
      lines: (linesBySlip.get(slip.id) ?? []).map((line) => ({
        code: line.code, name: line.name, kind: line.kind, amount: Number(line.amount), detail: line.detail ?? '',
      })),
      gross: Number(slip.gross_pay),
      totalDeductions: payslipDeductions(slip),
      roundingAdjustment: Number(slip.rounding_adjustment ?? 0),
      reportTotals: {
        insuranceEmployee: Number(slip.insurance_employee) || 0,
        insuranceEmployer: Number(slip.insurance_employer) || 0,
        incomeTax: Number(slip.personal_income_tax) || 0,
        taxableIncome: Number(slip.taxable_income) || 0,
      },
      netPay: Number(slip.net_pay),
      snapshot: slip.snapshot,
      warnings: [],
      values: {},
    },
  }));
}

export function PayrollRegister({
  data, params, monthStart, monthStartStr, monthEndStr, monthLabel, onChanged,
}: PayrollRegisterProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const { profile } = useAuth();
  const { toast } = useToast();
  const confirm = useConfirm();
  const canManage = hasAdminFunction(profile, 'admin.payroll');
  const canEditSchemes = hasAdminFunction(profile, 'admin.payroll_schemes');

  const [query, setQuery] = useState('');
  const [unitFilter, setUnitFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [sort, setSort] = useState<SortKey>('name');
  const [page, setPage] = useState(0);
  const [showInfo, setShowInfo] = useState(true);
  const [detailUserId, setDetailUserId] = useState<string | null>(null);
  const [schemeTarget, setSchemeTarget] = useState<SchemeTarget | null>(null);
  const [busy, setBusy] = useState<'calc' | 'paid' | 'journal' | null>(null);
  const [lockOpen, setLockOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [withdrawReason, setWithdrawReason] = useState('');
  const [bankOpen, setBankOpen] = useState(false);

  const run = data.run;
  const runStatus: PayrollRunStatus = run?.status ?? 'DRAFT';
  const closed = runStatus === 'LOCKED' || runStatus === 'APPROVED' || runStatus === 'PAID';
  const approved = runStatus === 'APPROVED' || runStatus === 'PAID';
  const unitNames = useMemo(() => new Map(data.units.map((unit) => [unit.id, unit.name])), [data.units]);

  const liveRows: PayrollRow[] = useMemo(() => {
    if (!params || closed) return [];
    return data.profiles.map((person) => {
      const result = computeForPerson(person, data, params, monthStart, monthStartStr, monthEndStr);
      return { profile: person, computed: result.computed, hasScheme: result.hasScheme, mechanism: result.template.template?.name ?? null };
    });
  }, [closed, data, monthStart, monthStartStr, monthEndStr, params]);
  const frozenRows = useMemo(() => (closed ? rowsFromPayslips(data) : []), [closed, data]);
  const rows = closed ? frozenRows : liveRows;

  /** Phiếu nháp đã ghi còn khớp số liệu hiện tại không — khoá là khoá ĐÚNG bộ đã ghi. */
  const staleCount = useMemo(() => {
    if (runStatus !== 'CALCULATED') return 0;
    const stored = new Map(data.payslips.map((slip) => [slip.user_id, slip]));
    const schemed = liveRows.filter((row) => row.hasScheme);
    const changed = schemed.filter((row) => {
      const slip = stored.get(row.profile.id);
      return !slip || Math.abs(Number(slip.net_pay) - row.computed.netPay) >= 1 || Math.abs(Number(slip.gross_pay) - row.computed.gross) >= 1;
    }).length;
    const gone = data.payslips.filter((slip) => !schemed.some((row) => row.profile.id === slip.user_id)).length;
    return changed + gone;
  }, [data.payslips, liveRows, runStatus]);

  const selectedUserId = searchParams.get('user');
  const keyword = stripTone(query);
  const filtered = rows
    .filter((row) => !selectedUserId || row.profile.id === selectedUserId)
    .filter((row) => !keyword || stripTone(row.profile.name).includes(keyword) || stripTone(row.profile.employee_code ?? '').includes(keyword))
    .filter((row) => !unitFilter || row.profile.unit_id === unitFilter)
    .filter((row) => statusFilter === 'ALL'
      || (statusFilter === 'MISSING' && !row.hasScheme)
      || (statusFilter === 'WARNING' && row.computed.warnings.length > 0));
  const sorted = [...filtered].sort((a, b) => {
    if (sort === 'net_desc') return b.computed.netPay - a.computed.netPay;
    if (sort === 'net_asc') return a.computed.netPay - b.computed.netPay;
    if (sort === 'unit') {
      return (unitNames.get(a.profile.unit_id ?? '') ?? '').localeCompare(unitNames.get(b.profile.unit_id ?? '') ?? '', 'vi')
        || a.profile.name.localeCompare(b.profile.name, 'vi');
    }
    return a.profile.name.localeCompare(b.profile.name, 'vi');
  });
  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const pageRows = sorted.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

  /** Mỗi đầu mục một cột, theo thứ tự xuất hiện trên phiếu. */
  const columns = useMemo<ItemColumn[]>(() => {
    const seen = new Map<string, ItemColumn>();
    for (const row of sorted) {
      for (const line of row.computed.lines) {
        if (!seen.has(line.code)) seen.set(line.code, { code: line.code, name: line.name, kind: line.kind });
      }
    }
    return [...seen.values()];
  }, [sorted]);
  const shownColumns = showInfo ? columns : columns.filter((column) => column.kind !== 'INFO');
  const amountOf = (row: PayrollRow, code: string) => {
    const lines = row.computed.lines.filter((line) => line.code === code);
    return lines.length === 0 ? null : lines.reduce((sum, line) => sum + line.amount, 0);
  };

  const sum = (pick: (row: PayrollRow) => number, list: PayrollRow[] = filtered) => list.reduce((total, row) => total + pick(row), 0);
  const totals = {
    gross: sum((row) => row.computed.gross),
    deductions: sum((row) => row.computed.totalDeductions),
    rounding: sum((row) => row.computed.roundingAdjustment),
    net: sum((row) => row.computed.netPay),
  };
  const payableRows = rows.filter((row) => row.hasScheme);
  const allTotalsNet = sum((row) => row.computed.netPay, payableRows);

  const allWarnings = [...new Set(rows.flatMap((row) => row.computed.warnings))];
  const missingSchemeCount = rows.filter((row) => !row.hasScheme && row.computed.stats.paidDays > 0).length;
  const pendingSchemes = data.schemeRequests.filter((request) => request.status === 'SUBMITTED' && request.effective_from <= monthStartStr).length;
  const readiness = data.readiness;

  const checklist = [
    { ok: !!readiness?.timesheetLocked, blocking: true, label: 'Kỳ công tháng đã khoá', hint: 'Khoá ở Bảng công trước.' },
    { ok: (readiness?.openKpiReviews ?? 0) === 0, blocking: true, label: 'Phiếu KPI tháng đã khoá', hint: `Còn ${readiness?.openKpiReviews ?? 0} phiếu KPI chưa khoá.` },
    { ok: runStatus === 'CALCULATED' && staleCount === 0, blocking: true, label: 'Bộ phiếu đã tính khớp số liệu hiện tại', hint: runStatus === 'CALCULATED' ? `${staleCount} phiếu đã đổi — bấm Tính lại.` : 'Chưa tính lương.' },
    { ok: missingSchemeCount === 0, blocking: false, label: 'Mọi người có công đều có cơ chế lương', hint: `${missingSchemeCount} người có công nhưng chưa có cơ chế.` },
    { ok: pendingSchemes === 0, blocking: false, label: 'Không còn đề xuất cơ chế chờ duyệt cho tháng này', hint: `${pendingSchemes} đề xuất chờ BGĐ — duyệt xong phải tính lại.` },
    { ok: allWarnings.length === 0, blocking: false, label: 'Không có cảnh báo tính toán', hint: `${allWarnings.length} cảnh báo — xem chi tiết bên dưới.` },
  ];
  const canLock = checklist.every((item) => item.ok || !item.blocking);

  const nameOf = (id: string | null) => (id ? data.profiles.find((person) => person.id === id)?.name ?? 'Người dùng đã nghỉ' : '—');
  const detailRow = detailUserId ? rows.find((row) => row.profile.id === detailUserId) ?? null : null;
  const lastEvent = data.runEvents[0];

  // ---- Thao tác --------------------------------------------------------------
  const handleCalculate = async () => {
    const entries = liveRows.filter((row) => row.hasScheme);
    if (entries.length === 0) {
      toast('Chưa ai có cơ chế lương — thiết lập ở Cơ chế lương trước.', 'warning');
      return;
    }
    setBusy('calc');
    const ensured = await ensurePayrollRun(monthStartStr, profile?.id ?? null);
    if (ensured.error || !ensured.run) {
      setBusy(null);
      toast('Không tạo được kỳ lương: ' + (ensured.error ?? 'không rõ lỗi'), 'error');
      return;
    }
    const error = await persistPayslips(ensured.run, entries.map((row) => ({ profile: row.profile, computed: row.computed })));
    setBusy(null);
    if (error) return toast('Ghi bảng lương nháp thất bại: ' + error, 'error');
    toast(`Đã tính ${entries.length} phiếu lương nháp tháng ${monthLabel}.`, 'success');
    onChanged();
  };

  const handleLock = async (): Promise<string | null> => {
    if (!run) return 'Chưa có kỳ lương.';
    const error = await lockPayrollRun(run.id);
    if (error) {
      return error === REAUTH_REQUIRED
        ? 'Mã 2FA chưa hợp lệ hoặc đã quá 5 phút — nhập lại mã OTP.'
        : error;
    }
    const approvers = await fetchPayrollApproverIds();
    await notifyUsers(
      approvers,
      `Bảng lương ${monthLabel} chờ duyệt chi`,
      `Tổng thực chi ${formatVND(allTotalsNet)} cho ${payableRows.length} nhân sự. Mở Lương & đãi ngộ › Phê duyệt lương để ký.`,
      'payroll_run_submitted',
    );
    toast(`Đã khoá kỳ lương ${monthLabel} và trình Ban Giám đốc.`, 'success');
    onChanged();
    return null;
  };

  const handleWithdraw = async () => {
    if (!run || withdrawReason.trim().length < 3) return;
    const error = await withdrawPayrollRun(run.id, withdrawReason.trim());
    if (error) return toast('Không rút lại được: ' + error, 'error');
    setWithdrawOpen(false);
    setWithdrawReason('');
    toast('Đã rút kỳ lương về để sửa.', 'success');
    onChanged();
  };

  const handleMarkPaid = async () => {
    if (!run) return;
    const ok = await confirm({
      title: `Xác nhận đã chi trả lương tháng ${monthLabel}?`,
      message: `Tổng thực chi ${formatVND(allTotalsNet)}. Phiếu lương sẽ PHÁT HÀNH cho ${payableRows.length} nhân viên — họ xác thực lại để xem chi tiết trên ứng dụng.`,
      confirmLabel: 'Xác nhận & phát hành',
    });
    if (!ok) return;
    setBusy('paid');
    const { published, error } = await markPayrollRunPaid(run.id);
    if (error) {
      setBusy(null);
      toast('Không xác nhận được: ' + error, 'error');
      return;
    }
    await notifyUsers(
      data.payslips.map((slip) => slip.user_id),
      `Phiếu lương tháng ${monthLabel}`,
      'Phiếu lương của bạn đã được phát hành. Mở "Lương của tôi" và xác thực lại để xem chi tiết.',
      'payslip_published',
    );
    setBusy(null);
    toast(`Đã xác nhận chi trả và phát hành ${published} phiếu lương.`, 'success');
    onChanged();
  };

  /** Bút toán kết chuyển — chỉ có nghĩa khi số liệu đã được duyệt. */
  const handleExportJournal = async () => {
    setBusy('journal');
    try {
      const XLSX = await import('xlsx');
      const journal = buildPayrollJournal(filtered.map((row) => ({ profile: row.profile, computed: row.computed })), undefined, unitNames);
      const sheet: (string | number)[][] = [
        [`BÚT TOÁN KẾT CHUYỂN LƯƠNG THÁNG ${monthLabel}`],
        [`Trạng thái kỳ: ${RUN_STATUS_LABEL[runStatus]}`],
        ['Tài khoản chi phí mặc định 642, khoản trừ mặc định 338 — kế toán chỉnh theo cơ cấu và từng khoản trừ thực tế.'],
        [],
        ['Nhóm bút toán', 'Bộ phận', 'Nợ', 'Có', 'Số tiền', 'Diễn giải'],
        ...journal.entries.map((entry) => [entry.group, entry.department, entry.debit, entry.credit, entry.amount, entry.description]),
        [],
        ['', '', '', 'TỔNG PHÁT SINH', journal.totalDebit, journal.balanced ? 'Nợ = Có' : 'LỆCH — kiểm tra lại'],
        [],
        ['ĐỐI CHIẾU'],
        ['Tổng các khoản cộng (Có 334)', '', '', '', journal.totals.gross, ''],
        ['Tổng các khoản trừ', '', '', '', journal.totals.deductions, ''],
        ['THỰC CHI CHO NGƯỜI LAO ĐỘNG', '', '', '', journal.totals.netPay, ''],
      ];
      const worksheet = XLSX.utils.aoa_to_sheet(sheet);
      worksheet['!cols'] = [{ wch: 30 }, { wch: 20 }, { wch: 8 }, { wch: 8 }, { wch: 16 }, { wch: 44 }];
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Bút toán lương');
      XLSX.writeFile(workbook, `but-toan-luong-${format(monthStart, 'yyyy-MM')}.xlsx`);
    } catch (error) {
      toast('Xuất bút toán thất bại: ' + (error instanceof Error ? error.message : String(error)), 'error');
    }
    setBusy(null);
  };

  /** Mỗi đầu mục một cột — đúng như bảng lương kế toán vẫn đối chiếu. */
  const exportOptions = () => ({
    filename: `bang-luong-${format(monthStart, 'yyyy-MM')}`,
    sheetName: 'Bảng lương',
    title: `BẢNG LƯƠNG THÁNG ${monthLabel}`,
    subtitle: `Trạng thái kỳ: ${RUN_STATUS_LABEL[runStatus]}${closed ? ' (số liệu đã chốt)' : ' (bản xem trước)'}`,
    rows: sorted,
    columns: [
      { header: 'Mã NV', value: (row: PayrollRow) => row.profile.employee_code ?? '', width: 10 },
      { header: 'Họ tên', value: (row: PayrollRow) => row.profile.name, width: 24 },
      { header: 'Đơn vị', value: (row: PayrollRow) => unitNames.get(row.profile.unit_id ?? '') ?? row.profile.department ?? '', width: 20 },
      { header: 'Ngày công', value: (row: PayrollRow) => row.computed.stats.workDays, width: 10 },
      { header: 'Công chuẩn', value: (row: PayrollRow) => row.computed.standardDays, width: 10 },
      ...columns.map((column) => ({
        header: `${KIND_SIGN[column.kind]} ${column.name}`,
        value: (row: PayrollRow) => amountOf(row, column.code) ?? '',
        width: 16,
      })),
      { header: 'TỔNG CỘNG', value: (row: PayrollRow) => row.computed.gross },
      { header: 'TỔNG TRỪ', value: (row: PayrollRow) => row.computed.totalDeductions },
      { header: 'LÀM TRÒN', value: (row: PayrollRow) => row.computed.roundingAdjustment, width: 10 },
      { header: 'THỰC NHẬN', value: (row: PayrollRow) => row.computed.netPay },
    ],
  });

  // ---- Giao diện -------------------------------------------------------------
  if (!params && !closed) {
    return (
      <Banner tone="amber" icon={<TriangleAlert className="mt-0.5 h-4 w-4 flex-shrink-0" />}>
        Chưa có <strong>bộ tham số lương hiệu lực</strong> cho tháng {monthLabel} — bảng lương không tính được.
        Khai ở <strong>Tham số lương</strong> trước.
      </Banner>
    );
  }

  const cellTone = (kind: PayComponentKind) => (kind === 'DEDUCTION' ? 'text-red-600' : kind === 'INFO' ? 'text-slate-400' : 'text-slate-800');

  return (
    <div className="space-y-5">
      <RunLifecycle status={runStatus} />

      {/* --- Hành động theo trạng thái: bước tiếp theo bên trái, xuất file bên phải --- */}
      <div className="flex flex-wrap items-center justify-between gap-3 no-print">
        <div className="flex flex-wrap items-center gap-2">
          {canManage && !closed && (
            <Button onClick={() => void handleCalculate()} disabled={!!busy || liveRows.length === 0}>
              <Calculator className="h-4 w-4" /> {busy === 'calc' ? 'Đang tính…' : runStatus === 'DRAFT' ? 'Tính lương (bản nháp)' : 'Tính lại'}
            </Button>
          )}
          {canManage && runStatus === 'CALCULATED' && (
            <Button variant="success" onClick={() => setLockOpen(true)} disabled={!!busy || !canLock}
              title={canLock ? undefined : 'Hoàn tất các mục bắt buộc trong danh sách kiểm tra'}>
              <LockKeyhole className="h-4 w-4" /> Khoá kỳ & trình BGĐ (2FA)
            </Button>
          )}
          {canManage && runStatus === 'LOCKED' && (
            <Button variant="outline" onClick={() => setWithdrawOpen(true)} disabled={!!busy}>
              <Undo2 className="h-4 w-4" /> Rút lại để sửa
            </Button>
          )}
          {canManage && approved && (
            <Button variant="outline" onClick={() => setBankOpen(true)} disabled={!!busy}>
              <Landmark className="h-4 w-4" /> File chi lương ngân hàng
            </Button>
          )}
          {canManage && runStatus === 'APPROVED' && (
            <Button variant="success" onClick={() => void handleMarkPaid()} disabled={!!busy}>
              <Wallet className="h-4 w-4" /> {busy === 'paid' ? 'Đang xác nhận…' : 'Xác nhận đã chi trả & phát hành phiếu'}
            </Button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ExportButtons options={exportOptions} disabled={sorted.length === 0} />
          <Button variant="outline" size="sm" onClick={() => void handleExportJournal()} disabled={!!busy || !approved || filtered.length === 0}
            title={approved ? undefined : 'BGĐ duyệt chi xong mới xuất bút toán kết chuyển'}>
            <BookOpenCheck className="h-3.5 w-3.5" /> Bút toán kết chuyển
          </Button>
        </div>
      </div>

      {/* --- Thông báo theo trạng thái --- */}
      {runStatus === 'CALCULATED' && run?.review_note && lastEvent && (lastEvent.action === 'REJECTED' || lastEvent.action === 'WITHDRAWN') && (
        <Banner tone="red" icon={<CircleAlert className="mt-0.5 h-4 w-4 flex-shrink-0" />}>
          {lastEvent.action === 'REJECTED' ? 'Ban Giám đốc từ chối' : 'Kế toán đã rút lại'} ({lastEvent.actor_name ?? nameOf(lastEvent.actor_id)},{' '}
          {formatDateTime(lastEvent.created_at)}): <strong>{run.review_note}</strong>
        </Banner>
      )}
      {runStatus === 'LOCKED' && (
        <Banner tone="amber" icon={<LockKeyhole className="mt-0.5 h-4 w-4 flex-shrink-0" />}>
          Kỳ đã khoá lúc {formatDateTime(run?.locked_at ?? null)} bởi {nameOf(run?.locked_by ?? null)} — đang chờ Ban Giám đốc ký duyệt chi.
          Số liệu không sửa được; cần sửa thì <strong>Rút lại</strong> kèm lý do.
        </Banner>
      )}
      {runStatus === 'APPROVED' && (
        <Banner tone="emerald" icon={<CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0" />}>
          {nameOf(run?.approved_by ?? null)} đã ký duyệt chi lúc {formatDateTime(run?.approved_at ?? null)}. Xuất file ngân hàng để chi,
          sau đó xác nhận đã chi trả để phát hành phiếu lương.
        </Banner>
      )}
      {runStatus === 'PAID' && (
        <Banner tone="emerald" icon={<CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0" />}>
          Đã chi trả và phát hành phiếu lương lúc {formatDateTime(run?.published_at ?? run?.paid_at ?? null)}. Sai sót phát hiện sau
          xử lý bằng <strong>Điều chỉnh lương</strong> của kỳ sau.
        </Banner>
      )}

      {/* --- Danh sách kiểm tra trước khi khoá --- */}
      {canManage && !closed && (
        <Card>
          <CardContent className="py-4">
            <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-slate-400">Kiểm tra trước khi khoá kỳ</p>
            <ul className="grid gap-1.5 sm:grid-cols-2">
              {checklist.map((item) => (
                <li key={item.label} className="flex items-start gap-2 text-xs">
                  {item.ok
                    ? <CircleCheck className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-emerald-600" />
                    : <CircleAlert className={`mt-0.5 h-3.5 w-3.5 flex-shrink-0 ${item.blocking ? 'text-red-500' : 'text-amber-500'}`} />}
                  <span className={item.ok ? 'text-slate-600' : item.blocking ? 'font-semibold text-red-700' : 'text-amber-800'}>
                    {item.label}{!item.ok && <span className="font-normal"> — {item.hint}</span>}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {allWarnings.length > 0 && (
        <details className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <summary className="cursor-pointer text-sm font-bold text-amber-900">{allWarnings.length} cảnh báo cần xem lại</summary>
          <ul className="mt-2 space-y-1.5">
            {allWarnings.map((warning) => <li key={warning} className="text-xs leading-relaxed text-amber-800">• {warning}</li>)}
          </ul>
        </details>
      )}

      {selectedUserId && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-indigo-200 bg-indigo-50 px-4 py-3">
          <p className="text-sm font-bold text-indigo-900">Đang lọc theo một nhân sự được chọn từ Danh bạ.</p>
          <Button variant="outline" size="sm" onClick={() => setSearchParams({})}>Xem toàn bộ bảng lương</Button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryCard label="Tổng các khoản cộng" value={formatVND(totals.gross)} />
        <SummaryCard label="Tổng các khoản trừ" value={formatVND(totals.deductions)} tone="red" />
        <SummaryCard label="Tổng thực chi" value={formatVND(totals.net)} tone="indigo" hint={totals.rounding ? `Gồm làm tròn ${formatVND(totals.rounding)}` : undefined} />
        <SummaryCard label="Số phiếu" value={`${filtered.filter((row) => row.hasScheme).length} / ${filtered.length} người`} />
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3 no-print">
            <div className="relative min-w-[200px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={query}
                onChange={(event) => { setQuery(event.target.value); setPage(0); }}
                placeholder="Tìm theo tên hoặc mã nhân viên…"
                className="h-10 w-full rounded-xl border border-slate-200 pl-9 pr-3 text-sm outline-none focus:border-indigo-500"
              />
            </div>
            <div className="w-44">
              <Select aria-label="Lọc theo đơn vị" value={unitFilter} onChange={(event) => { setUnitFilter(event.target.value); setPage(0); }}>
                <option value="">Mọi đơn vị</option>
                {data.units.filter((unit) => unit.is_active).map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}
              </Select>
            </div>
            <div className="w-44">
              <Select aria-label="Lọc theo tình trạng" value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value as StatusFilter); setPage(0); }}>
                <option value="ALL">Mọi tình trạng</option>
                <option value="MISSING">Chưa có cơ chế</option>
                <option value="WARNING">Có cảnh báo</option>
              </Select>
            </div>
            <div className="w-44">
              <Select aria-label="Sắp xếp" value={sort} onChange={(event) => setSort(event.target.value as SortKey)}>
                <option value="name">Theo tên A→Z</option>
                <option value="unit">Theo đơn vị</option>
                <option value="net_desc">Thực nhận cao → thấp</option>
                <option value="net_asc">Thực nhận thấp → cao</option>
              </Select>
            </div>
            <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-600">
              <input type="checkbox" className="h-3.5 w-3.5 accent-indigo-600" checked={showInfo} onChange={(event) => setShowInfo(event.target.checked)} />
              Hiện dòng chỉ để tính
            </label>
            <span className="text-xs font-semibold text-slate-500">{filtered.length}/{rows.length} nhân sự</span>
          </div>

          {rows.length === 0 ? (
            <p className="px-6 py-12 text-center text-sm text-slate-500">
              {closed ? 'Kỳ này chưa có phiếu lương nào.' : 'Chưa có nhân sự đang làm việc.'}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-100 bg-[#FCFAF8]">
                    <th className="sticky left-0 z-10 min-w-[220px] bg-[#FCFAF8] px-4 py-3 text-left text-[10px] font-bold uppercase tracking-widest text-slate-400">Nhân sự</th>
                    <th className="px-3 py-3 text-center text-[10px] font-bold uppercase tracking-widest text-slate-400">Công</th>
                    {shownColumns.map((column) => (
                      <th key={column.code} className="min-w-[96px] px-3 py-3 text-right align-bottom">
                        <span className={`block text-[11px] font-bold leading-tight ${column.kind === 'DEDUCTION' ? 'text-red-500' : column.kind === 'INFO' ? 'text-slate-400' : 'text-slate-600'}`}>
                          {KIND_SIGN[column.kind]} {column.name}
                        </span>
                      </th>
                    ))}
                    <th className="min-w-[110px] px-3 py-3 text-right text-[10px] font-bold uppercase tracking-widest text-slate-500">Tổng cộng</th>
                    <th className="min-w-[100px] px-3 py-3 text-right text-[10px] font-bold uppercase tracking-widest text-red-400">Tổng trừ</th>
                    <th className="min-w-[120px] px-4 py-3 text-right text-[10px] font-bold uppercase tracking-widest text-indigo-500">Thực nhận</th>
                    <th className="w-12 px-2 py-3 no-print" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {pageRows.map((row) => (
                    <tr key={row.profile.id} className="cursor-pointer transition-colors hover:bg-[#FCFAF8]" onClick={() => setDetailUserId(row.profile.id)}>
                      <td className="sticky left-0 z-10 bg-white px-4 py-3">
                        <div className="flex min-w-0 items-center gap-2.5">
                          <Avatar name={row.profile.name} url={row.profile.avatar_url} size="sm" />
                          <div className="min-w-0">
                            <p className="flex items-center gap-1 truncate text-sm font-bold text-slate-800">
                              {row.profile.name}
                              {row.computed.warnings.length > 0 && <TriangleAlert className="h-3.5 w-3.5 shrink-0 text-amber-500" aria-label="Có cảnh báo" />}
                            </p>
                            <p className="truncate text-[10px] font-medium text-slate-400">
                              {row.hasScheme ? (row.mechanism ?? (unitNames.get(row.profile.unit_id ?? '') ?? row.profile.department ?? '')) : <span className="font-bold uppercase text-red-400">Chưa có cơ chế</span>}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-center font-bold tabular-nums text-slate-700">
                        {row.computed.stats.paidDays}
                        <span className="ml-0.5 text-[9px] text-slate-300">/{row.computed.standardDays}</span>
                      </td>
                      {shownColumns.map((column) => {
                        const amount = amountOf(row, column.code);
                        return (
                          <td key={column.code} className={`px-3 py-3 text-right tabular-nums ${cellTone(column.kind)}`}>
                            {amount == null ? <span className="text-slate-200">—</span> : formatFormulaNumber(amount)}
                          </td>
                        );
                      })}
                      <td className="px-3 py-3 text-right font-bold tabular-nums text-slate-800">{formatFormulaNumber(row.computed.gross)}</td>
                      <td className="px-3 py-3 text-right tabular-nums text-red-600">{row.computed.totalDeductions ? `−${formatFormulaNumber(row.computed.totalDeductions)}` : '—'}</td>
                      <td className="px-4 py-3 text-right text-sm font-bold tabular-nums text-slate-900">{formatVND(row.computed.netPay)}</td>
                      <td className="px-2 py-3 text-center no-print">
                        <button
                          onClick={(event) => { event.stopPropagation(); setSchemeTarget({ type: 'USER', person: row.profile }); }}
                          className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-indigo-50 hover:text-indigo-600"
                          aria-label={`Cơ chế lương của ${row.profile.name}`}
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t border-slate-200 bg-[#FCFAF8] font-bold">
                  <tr>
                    <td className="sticky left-0 z-10 bg-[#FCFAF8] px-4 py-4 text-[10px] font-bold uppercase tracking-widest text-slate-900">
                      Tổng ({filtered.length} nhân sự)
                    </td>
                    <td />
                    {shownColumns.map((column) => (
                      <td key={column.code} className={`px-3 py-4 text-right tabular-nums ${cellTone(column.kind)}`}>
                        {column.kind === 'INFO' ? '' : formatFormulaNumber(sum((row) => amountOf(row, column.code) ?? 0))}
                      </td>
                    ))}
                    <td className="px-3 py-4 text-right tabular-nums text-slate-800">{formatFormulaNumber(totals.gross)}</td>
                    <td className="px-3 py-4 text-right tabular-nums text-red-700">−{formatFormulaNumber(totals.deductions)}</td>
                    <td className="px-4 py-4 text-right text-sm tabular-nums text-indigo-700">{formatVND(totals.net)}</td>
                    <td className="no-print" />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
          {pageCount > 1 && (
            <div className="flex items-center justify-between border-t border-slate-100 px-4 py-2 text-xs text-slate-500 no-print">
              <span>Trang {currentPage + 1}/{pageCount}</span>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Trước</Button>
                <Button size="sm" variant="outline" disabled={currentPage >= pageCount - 1} onClick={() => setPage(currentPage + 1)}>Sau</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {data.runEvents.length > 0 && (
        <details className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
          <summary className="flex cursor-pointer items-center gap-2 text-sm font-bold text-slate-700">
            <History className="h-4 w-4 text-slate-400" /> Lịch sử kỳ lương ({data.runEvents.length})
          </summary>
          <div className="mt-3"><Timeline rows={data.runEvents} nameOf={nameOf} /></div>
        </details>
      )}

      {/* --- Hộp thoại --- */}
      <TwoFactorDialog
        open={lockOpen}
        title={`Khoá kỳ lương ${monthLabel}`}
        confirmLabel="Khoá kỳ & trình BGĐ"
        description={(
          <>
            Khoá bộ phiếu đã tính ({data.payslips.length} phiếu, tổng thực chi <strong>{formatVND(allTotalsNet)}</strong>) và trình
            Ban Giám đốc ký duyệt chi. Sau khi khoá, chấm công và số liệu tháng {monthLabel} không sửa được nữa.
          </>
        )}
        onClose={() => setLockOpen(false)}
        onVerified={handleLock}
      />

      <Modal open={withdrawOpen} onClose={() => setWithdrawOpen(false)} title="Rút kỳ lương về để sửa" size="md">
        <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void handleWithdraw(); }}>
          <p className="text-sm text-slate-600">Kỳ sẽ về trạng thái <strong>Đã tính</strong>; sửa xong phải tính lại và khoá lại bằng 2FA.</p>
          <Textarea
            label="Lý do rút lại"
            required
            rows={3}
            value={withdrawReason}
            onChange={(event) => setWithdrawReason(event.target.value)}
            error={withdrawReason && withdrawReason.trim().length < 3 ? 'Ít nhất 3 ký tự.' : undefined}
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setWithdrawOpen(false)}>Huỷ</Button>
            <Button type="submit" variant="danger" disabled={withdrawReason.trim().length < 3}>Rút lại</Button>
          </div>
        </form>
      </Modal>

      {run && (
        <BankExportModal
          open={bankOpen}
          run={run}
          rows={payableRows.map((row) => ({ profile: row.profile, net: row.computed.netPay }))}
          onClose={() => setBankOpen(false)}
          onExported={onChanged}
        />
      )}

      <PaySchemeModal
        open={!!schemeTarget}
        target={schemeTarget}
        data={data}
        viewMonth={monthStartStr}
        lastClosedMonth={data.readiness?.lastClosedMonth ?? null}
        readOnly={!canEditSchemes}
        onClose={() => setSchemeTarget(null)}
        onSaved={onChanged}
      />

      <Modal open={!!detailRow} onClose={() => setDetailUserId(null)} title={`Phiếu lương ${monthLabel} — ${detailRow?.profile.name ?? ''}`} size="lg">
        {detailRow && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <MiniStat label="Ngày công" value={`${detailRow.computed.stats.workDays}`} />
              <MiniStat label="Ngày phép / lễ" value={`${detailRow.computed.stats.leaveDays + detailRow.computed.stats.holidayDays}`} />
              <MiniStat label="Công chuẩn" value={`${detailRow.computed.standardDays}`} />
              <MiniStat label="Giờ làm" value={`${detailRow.computed.stats.workHours}`} />
            </div>
            {closed && <p className="flex items-center gap-1.5 text-xs text-slate-500"><FileSpreadsheet className="h-3.5 w-3.5" /> Số liệu đọc từ phiếu đã khoá — không tính lại.</p>}
            <PayslipBreakdown
              lines={detailRow.computed.lines}
              netPay={detailRow.computed.netPay}
              roundingAdjustment={detailRow.computed.roundingAdjustment}
              warnings={detailRow.computed.warnings}
            />
          </div>
        )}
      </Modal>
    </div>
  );
}


/** Vòng đời kỳ lương thành năm chặng — người làm lương thấy cả đường đi, không chỉ một nhãn. */
function RunLifecycle({ status }: { status: PayrollRunStatus }) {
  const current = RUN_ORDER.indexOf(status);
  return (
    <div className="flex flex-wrap items-center gap-1" role="status" aria-label={`Trạng thái kỳ: ${RUN_STATUS_LABEL[status]}`}>
      {RUN_ORDER.map((step, index) => (
        <span key={step} className="flex items-center gap-1">
          {index > 0 && <span className={`h-px w-3 ${index <= current ? 'bg-indigo-300' : 'bg-slate-200'}`} />}
          <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${index === current
            ? 'bg-indigo-600 text-white'
            : index < current ? 'bg-indigo-50 text-indigo-700' : 'bg-slate-100 text-slate-400'}`}>
            {RUN_STATUS_LABEL[step]}
          </span>
        </span>
      ))}
    </div>
  );
}

function SummaryCard({ label, value, tone = 'slate', hint }: { label: string; value: string; tone?: 'slate' | 'red' | 'indigo'; hint?: string }) {
  const colors = { slate: 'text-slate-900', red: 'text-red-600', indigo: 'text-indigo-700' };
  return (
    <Card>
      <CardContent className="py-4">
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{label}</p>
        <p className={`mt-1.5 text-lg font-extrabold tabular-nums ${colors[tone]}`}>{value}</p>
        {hint && <p className="mt-0.5 text-[10px] text-slate-400">{hint}</p>}
      </CardContent>
    </Card>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-slate-50 px-3 py-2.5">
      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{label}</p>
      <p className="mt-0.5 truncate text-sm font-bold text-slate-800">{value}</p>
    </div>
  );
}

export function Banner({ tone, icon, children }: { tone: 'amber' | 'emerald' | 'red'; icon: React.ReactNode; children: React.ReactNode }) {
  const tones = {
    amber: 'border-amber-200 bg-amber-50 text-amber-800',
    emerald: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    red: 'border-red-200 bg-red-50 text-red-800',
  };
  return (
    <div className={`flex items-start gap-2.5 rounded-xl border px-4 py-3 text-sm leading-relaxed ${tones[tone]}`}>
      {icon}
      <span>{children}</span>
    </div>
  );
}
