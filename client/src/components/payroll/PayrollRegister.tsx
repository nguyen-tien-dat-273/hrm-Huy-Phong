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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { format } from 'date-fns';
import {
  BookOpenCheck, Calculator, CheckCircle2, CircleAlert, CircleCheck, FileSpreadsheet, History, Landmark,
  ChevronLeft, ChevronRight, ListChecks, LockKeyhole, Pencil, TriangleAlert, Undo2, Wallet,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/Card';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Textarea } from '@/components/ui/Input';
import { Dropdown } from '@/components/ui/Dropdown';
import { PayslipBreakdown } from '@/components/payroll/PayslipBreakdown';
import { ExportButtons } from '@/components/payroll/ExportButtons';
import { TwoFactorDialog } from '@/components/payroll/TwoFactorDialog';
import { BankExportModal } from '@/components/payroll/BankExportModal';
import { Timeline } from '@/components/payroll/PayrollApprovals';
import { PersonAdjustmentModal } from '@/components/payroll/PersonAdjustmentModal';
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
  LOCKED: 'Đã khoá · chờ duyệt',
  APPROVED: 'Đã duyệt chi',
  PAID: 'Đã chi trả & phát hành',
};
const RUN_ORDER: PayrollRunStatus[] = ['DRAFT', 'CALCULATED', 'LOCKED', 'APPROVED', 'PAID'];
const PAGE_SIZE = 50;

type SortKey = 'name' | 'net_desc' | 'net_asc' | 'unit';
type StatusFilter = 'ALL' | 'HAS_SCHEME' | 'MISSING' | 'WARNING';

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
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { toast } = useToast();
  const confirm = useConfirm();
  const canManage = hasAdminFunction(profile, 'admin.payroll');
  const canAdjust = hasAdminFunction(profile, 'admin.payroll_adjustments');
  const canOpenSchemes = hasAdminFunction(profile, 'admin.payroll_schemes') || hasAdminFunction(profile, 'admin.payroll_settings');

  const [unitFilter, setUnitFilter] = useState('');
  const [personFilter, setPersonFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [sort, setSort] = useState<SortKey>('name');
  const [page, setPage] = useState(0);
  const [detailUserId, setDetailUserId] = useState<string | null>(null);
  const [adjustUserId, setAdjustUserId] = useState<string | null>(null);
  const [busy, setBusy] = useState<'calc' | 'paid' | 'journal' | null>(null);
  const [lockOpen, setLockOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [withdrawReason, setWithdrawReason] = useState('');
  const [bankOpen, setBankOpen] = useState(false);
  const [checkOpen, setCheckOpen] = useState(false);
  const [warningsOpen, setWarningsOpen] = useState(false);

  const run = data.run;
  const runStatus: PayrollRunStatus = run?.status ?? 'DRAFT';
  const closed = runStatus === 'LOCKED' || runStatus === 'APPROVED' || runStatus === 'PAID';
  const approved = runStatus === 'APPROVED' || runStatus === 'PAID';
  const unitNames = useMemo(() => new Map(data.units.map((unit) => [unit.id, unit.name])), [data.units]);

  const liveRows: PayrollRow[] = useMemo(() => {
    if (!params || closed) return [];
    return data.profiles.map((person) => {
      const result = computeForPerson(person, data, params, monthStart, monthStartStr, monthEndStr);
      return { profile: person, computed: result.computed, hasScheme: result.hasScheme, mechanism: null };
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
  /** Danh sách nhân viên trong ô chọn thu hẹp theo phòng ban đã chọn. */
  const unitRows = rows.filter((row) => !unitFilter || row.profile.unit_id === unitFilter);
  const personOptions = [
    { value: '', label: 'Tất cả nhân viên' },
    ...[...unitRows]
      .sort((a, b) => a.profile.name.localeCompare(b.profile.name, 'vi'))
      .map((row) => ({
        value: row.profile.id,
        label: row.profile.employee_code ? `${row.profile.name} · ${row.profile.employee_code}` : row.profile.name,
      })),
  ];
  const filtered = unitRows
    .filter((row) => !selectedUserId || row.profile.id === selectedUserId)
    .filter((row) => !personFilter || row.profile.id === personFilter)
    .filter((row) => statusFilter === 'ALL'
      || (statusFilter === 'HAS_SCHEME' && row.hasScheme)
      || (statusFilter === 'MISSING' && !row.hasScheme)
      || (statusFilter === 'WARNING' && row.hasScheme && row.computed.warnings.length > 0));
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
    { ok: pendingSchemes === 0, blocking: false, label: 'Không còn đề xuất cơ chế chờ duyệt cho tháng này', hint: `${pendingSchemes} đề xuất chờ duyệt — duyệt xong phải tính lại.` },
    { ok: allWarnings.length === 0, blocking: false, label: 'Không có cảnh báo tính toán', hint: `${allWarnings.length} cảnh báo — bấm nút Cảnh báo để xem từng dòng.` },
  ];
  const canLock = checklist.every((item) => item.ok || !item.blocking);
  const unmetCount = checklist.filter((item) => !item.ok).length;

  const nameOf = (id: string | null) => (id ? data.profiles.find((person) => person.id === id)?.name ?? 'Người dùng đã nghỉ' : '—');
  const adjustRow = adjustUserId ? rows.find((row) => row.profile.id === adjustUserId) ?? null : null;
  const detailRow = detailUserId ? rows.find((row) => row.profile.id === detailUserId) ?? null : null;
  const lastEvent = data.runEvents[0];

  // ---- Cuộn ngang theo cột ---------------------------------------------------
  const scrollRef = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState({ left: false, right: false });
  const updateEdge = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setEdge({ left: el.scrollLeft > 1, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 1 });
  }, []);
  useEffect(() => {
    updateEdge();
    const el = scrollRef.current;
    if (!el) return undefined;
    const observer = new ResizeObserver(updateEdge);
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    return () => observer.disconnect();
  }, [updateEdge, columns.length, pageRows.length, rows.length]);

  /** Nhảy đúng 3 cột mỗi lần bấm; cột Nhân sự đứng yên nên không tính vào. */
  const scrollColumns = (direction: 1 | -1) => {
    const el = scrollRef.current;
    if (!el) return;
    const heads = Array.from(el.querySelectorAll<HTMLElement>('thead th'));
    const sticky = heads[0]?.offsetWidth ?? 0;
    const cols = heads.slice(1).filter((head) => !head.classList.contains('no-print'));
    if (cols.length === 0) return;
    const visibleLeft = el.scrollLeft + sticky;
    const first = Math.max(0, cols.findIndex((head) => head.offsetLeft + head.offsetWidth > visibleLeft + 1));
    const next = Math.min(cols.length - 1, Math.max(0, first + direction * 3));
    el.scrollTo({ left: Math.max(0, cols[next].offsetLeft - sticky), behavior: 'smooth' });
  };

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
    toast(`Đã khoá kỳ lương ${monthLabel} và trình duyệt.`, 'success');
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
              <LockKeyhole className="h-4 w-4" /> Khoá kỳ & trình duyệt (2FA)
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
          {canManage && !closed && (
            <Button variant="outline" size="sm" onClick={() => setCheckOpen(true)}>
              <ListChecks className="h-3.5 w-3.5" /> Kiểm tra
              {unmetCount > 0
                ? <span className="rounded-full bg-amber-100 px-1.5 text-[11px] font-bold text-amber-800">{unmetCount}</span>
                : <CircleCheck className="h-3.5 w-3.5 text-emerald-600" />}
            </Button>
          )}
          {allWarnings.length > 0 && (
            <Button variant="outline" size="sm" onClick={() => setWarningsOpen(true)}>
              <TriangleAlert className="h-3.5 w-3.5 text-amber-500" /> Cảnh báo
              <span className="rounded-full bg-amber-100 px-1.5 text-[11px] font-bold text-amber-800">{allWarnings.length}</span>
            </Button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ExportButtons options={exportOptions} disabled={sorted.length === 0} />
          <Button variant="outline" size="sm" onClick={() => void handleExportJournal()} disabled={!!busy || !approved || filtered.length === 0}
            title={approved ? undefined : 'Duyệt chi xong mới xuất bút toán kết chuyển'}>
            <BookOpenCheck className="h-3.5 w-3.5" /> Bút toán kết chuyển
          </Button>
        </div>
      </div>

      {/* --- Thông báo theo trạng thái --- */}
      {runStatus === 'CALCULATED' && run?.review_note && lastEvent && (lastEvent.action === 'REJECTED' || lastEvent.action === 'WITHDRAWN') && (
        <Banner tone="red" icon={<CircleAlert className="mt-0.5 h-4 w-4 flex-shrink-0" />}>
          {lastEvent.action === 'REJECTED' ? 'Người duyệt từ chối' : 'Kế toán đã rút lại'} ({lastEvent.actor_name ?? nameOf(lastEvent.actor_id)},{' '}
          {formatDateTime(lastEvent.created_at)}): <strong>{run.review_note}</strong>
        </Banner>
      )}
      {runStatus === 'LOCKED' && (
        <Banner tone="amber" icon={<LockKeyhole className="mt-0.5 h-4 w-4 flex-shrink-0" />}>
          Kỳ đã khoá lúc {formatDateTime(run?.locked_at ?? null)} bởi {nameOf(run?.locked_by ?? null)} — đang chờ ký duyệt chi.
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

      {selectedUserId && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-indigo-200 bg-indigo-50 px-4 py-3">
          <p className="text-sm font-bold text-indigo-900">Đang lọc theo một nhân sự được chọn từ Danh bạ.</p>
          <Button variant="outline" size="sm" onClick={() => setSearchParams({})}>Xem toàn bộ bảng lương</Button>
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-4 py-3 no-print">
            <div className="w-full sm:w-60">
              <Dropdown
                aria-label="Lọc theo phòng ban"
                value={unitFilter}
                searchable
                options={[
                  { value: '', label: 'Tất cả phòng ban' },
                  ...data.units.filter((unit) => unit.is_active).map((unit) => ({ value: unit.id, label: unit.name })),
                ]}
                onChange={(value) => { setUnitFilter(value); setPersonFilter(''); setPage(0); }}
              />
            </div>
            <div className="w-full sm:w-72">
              <Dropdown
                aria-label="Lọc theo nhân viên"
                value={personFilter}
                searchable
                options={personOptions}
                onChange={(value) => { setPersonFilter(value); setPage(0); }}
              />
            </div>
            <div className="w-full sm:w-48">
              <Dropdown
                aria-label="Lọc theo tình trạng"
                value={statusFilter}
                searchable={false}
                options={[
                  { value: 'ALL', label: 'Mọi tình trạng' },
                  { value: 'HAS_SCHEME', label: 'Đã có cơ chế' },
                  { value: 'MISSING', label: 'Chưa có cơ chế' },
                  { value: 'WARNING', label: 'Cảnh báo tính toán' },
                ]}
                onChange={(value) => { setStatusFilter(value as StatusFilter); setPage(0); }}
              />
            </div>
            <div className="w-full sm:w-52">
              <Dropdown
                aria-label="Sắp xếp"
                value={sort}
                searchable={false}
                options={[
                  { value: 'name', label: 'Theo tên A→Z' },
                  { value: 'unit', label: 'Theo đơn vị' },
                  { value: 'net_desc', label: 'Thực nhận cao → thấp' },
                  { value: 'net_asc', label: 'Thực nhận thấp → cao' },
                ]}
                onChange={(value) => setSort(value as SortKey)}
              />
            </div>
            <span className="ml-auto text-xs font-semibold text-slate-500">{filtered.length}/{rows.length} nhân sự</span>
          </div>

          {rows.length === 0 ? (
            <p className="px-6 py-12 text-center text-sm text-slate-500">
              {closed ? 'Kỳ này chưa có phiếu lương nào.' : 'Chưa có nhân sự đang làm việc.'}
            </p>
          ) : (
            <div className="relative">
              {edge.left && (
                <button
                  type="button"
                  onClick={() => scrollColumns(-1)}
                  title="Về trái 3 cột"
                  aria-label="Cuộn bảng về trái 3 cột"
                  className="no-print absolute left-[248px] top-1/2 z-40 inline-flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-slate-200 bg-white/95 text-slate-700 shadow-lg transition hover:bg-white hover:text-indigo-700"
                >
                  <ChevronLeft className="h-5 w-5" />
                </button>
              )}
              {edge.right && (
                <button
                  type="button"
                  onClick={() => scrollColumns(1)}
                  title="Sang phải 3 cột"
                  aria-label="Cuộn bảng sang phải 3 cột"
                  className="no-print absolute right-3 top-1/2 z-40 inline-flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-slate-200 bg-white/95 text-slate-700 shadow-lg transition hover:bg-white hover:text-indigo-700"
                >
                  <ChevronRight className="h-5 w-5" />
                </button>
              )}
            <div ref={scrollRef} onScroll={updateEdge} className="max-h-[calc(100vh-13rem)] min-h-[320px] overflow-auto">
              <table className="w-full whitespace-nowrap text-xs tabular-nums text-slate-700">
                <thead>
                  <tr className="border-b border-slate-200 bg-[#FCFAF8] text-[11px] font-semibold text-slate-500">
                    <th className="sticky left-0 top-0 z-30 shadow-[inset_0_-1px_0_#e2e8f0] w-[240px] min-w-[240px] max-w-[240px] bg-[#FCFAF8] px-4 py-3 text-left">Nhân sự</th>
                    <th className="sticky top-0 z-20 bg-[#FCFAF8] shadow-[inset_0_-1px_0_#e2e8f0] px-3 py-3 border-l border-slate-100 text-center">Công</th>
                    {columns.map((column) => (
                      <th key={column.code} className="sticky top-0 z-20 bg-[#FCFAF8] shadow-[inset_0_-1px_0_#e2e8f0] px-3 py-3 border-l border-slate-100 text-center">{KIND_SIGN[column.kind]} {column.name}</th>
                    ))}
                    <th className="sticky top-0 z-20 bg-[#FCFAF8] shadow-[inset_0_-1px_0_#e2e8f0] px-3 py-3 border-l border-slate-100 text-center text-slate-700">Tổng cộng</th>
                    <th className="sticky top-0 z-20 bg-[#FCFAF8] shadow-[inset_0_-1px_0_#e2e8f0] px-3 py-3 border-l border-slate-100 text-center text-slate-700">Tổng trừ</th>
                    <th className="sticky top-0 z-20 bg-[#FCFAF8] shadow-[inset_0_-1px_0_#e2e8f0] px-4 py-3 border-l border-slate-100 text-center text-slate-700">Thực nhận</th>
                    <th className="sticky top-0 z-20 bg-[#FCFAF8] shadow-[inset_0_-1px_0_#e2e8f0] w-12 px-2 py-3 no-print" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {pageRows.map((row) => {
                    // Người chưa có cơ chế đã có sẵn một cảnh báo riêng trong `warnings`.
                    const flags = row.computed.warnings.length > 0
                      ? row.computed.warnings
                      : row.hasScheme ? [] : ['Chưa có cơ chế lương'];
                    return (
                      <tr key={row.profile.id} className="group cursor-pointer transition-colors hover:bg-[#FCFAF8]" onClick={() => setDetailUserId(row.profile.id)}>
                        <td className="sticky left-0 z-10 w-[240px] min-w-[240px] max-w-[240px] bg-white px-4 py-2.5 group-hover:bg-[#FCFAF8]">
                          <div className="flex min-w-0 items-center gap-2.5">
                            <Avatar name={row.profile.name} url={row.profile.avatar_url} size="sm" />
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-xs font-semibold text-slate-800" title={row.profile.name}>{row.profile.name}</p>
                              <p className="truncate text-[11px] text-slate-400">
                                {row.mechanism ?? (unitNames.get(row.profile.unit_id ?? '') ?? row.profile.department ?? '—')}
                              </p>
                            </div>
                            {flags.length > 0 && (
                              <span title={flags.join('\n')} className="shrink-0">
                                <TriangleAlert className="h-4 w-4 text-amber-500" aria-label={flags.join('. ')} />
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2.5 border-l border-slate-100 text-center">
                          {row.computed.stats.paidDays}
                          <span className="text-slate-400">/{row.computed.standardDays}</span>
                        </td>
                        {columns.map((column) => {
                          const amount = amountOf(row, column.code);
                          return (
                            <td key={column.code} className="px-3 py-2.5 border-l border-slate-100 text-center">
                              {amount == null ? <span className="text-slate-300">—</span> : formatFormulaNumber(amount)}
                            </td>
                          );
                        })}
                        <td className="px-3 py-2.5 border-l border-slate-100 text-center font-semibold">{formatFormulaNumber(row.computed.gross)}</td>
                        <td className="px-3 py-2.5 border-l border-slate-100 text-center">{row.computed.totalDeductions ? `−${formatFormulaNumber(row.computed.totalDeductions)}` : '—'}</td>
                        <td className="px-4 py-2.5 border-l border-slate-100 text-center font-bold text-slate-900">{formatFormulaNumber(row.computed.netPay)}</td>
                        <td className="px-2 py-2.5 text-center no-print">
                          {canAdjust && !closed && (
                            <button
                              type="button"
                              onClick={(event) => { event.stopPropagation(); setAdjustUserId(row.profile.id); }}
                              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-indigo-50 hover:text-indigo-600"
                              title="Điều chỉnh lương"
                              aria-label={`Điều chỉnh lương của ${row.profile.name}`}
                            >
                              <Pencil className="h-4 w-4" />
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="sticky bottom-0 z-20 bg-[#FCFAF8] font-bold text-slate-800">
                  <tr>
                    <td className="sticky left-0 z-10 shadow-[inset_0_1px_0_#e2e8f0] w-[240px] min-w-[240px] max-w-[240px] bg-[#FCFAF8] px-4 py-3 text-left text-xs">
                      Tổng ({filtered.length} nhân sự)
                    </td>
                    <td className="bg-[#FCFAF8] shadow-[inset_0_1px_0_#e2e8f0] border-l border-slate-100" />
                    {columns.map((column) => (
                      <td key={column.code} className="bg-[#FCFAF8] shadow-[inset_0_1px_0_#e2e8f0] px-3 py-3 border-l border-slate-100 text-center">
                        {column.kind === 'INFO' ? '' : formatFormulaNumber(sum((row) => amountOf(row, column.code) ?? 0))}
                      </td>
                    ))}
                    <td className="bg-[#FCFAF8] shadow-[inset_0_1px_0_#e2e8f0] px-3 py-3 border-l border-slate-100 text-center">{formatFormulaNumber(totals.gross)}</td>
                    <td className="bg-[#FCFAF8] shadow-[inset_0_1px_0_#e2e8f0] px-3 py-3 border-l border-slate-100 text-center">−{formatFormulaNumber(totals.deductions)}</td>
                    <td className="bg-[#FCFAF8] shadow-[inset_0_1px_0_#e2e8f0] px-4 py-3 border-l border-slate-100 text-center text-slate-900">{formatFormulaNumber(totals.net)}</td>
                    <td className="bg-[#FCFAF8] shadow-[inset_0_1px_0_#e2e8f0] no-print" />
                  </tr>
                </tfoot>
              </table>
            </div>
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
      <Modal open={checkOpen} onClose={() => setCheckOpen(false)} title="Kiểm tra trước khi khoá kỳ" size="lg">
        <ul className="space-y-2.5">
          {checklist.map((item) => (
            <li key={item.label} className="flex items-start gap-2.5 text-sm">
              {item.ok
                ? <CircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                : <CircleAlert className={`mt-0.5 h-4 w-4 shrink-0 ${item.blocking ? 'text-red-500' : 'text-amber-500'}`} />}
              <span className={item.ok ? 'text-slate-600' : item.blocking ? 'font-semibold text-red-700' : 'text-amber-800'}>
                {item.label}
                {!item.ok && <span className="block text-xs font-normal">{item.hint}</span>}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-xs text-slate-500">
          Mục <span className="font-semibold text-red-600">đỏ</span> chặn khoá kỳ; mục <span className="font-semibold text-amber-600">vàng</span> chỉ là nhắc.
        </p>
      </Modal>

      <Modal open={warningsOpen} onClose={() => setWarningsOpen(false)} title={`${allWarnings.length} cảnh báo cần xem lại`} size="lg">
        <ul className="max-h-[60vh] space-y-2 overflow-y-auto pr-1">
          {allWarnings.map((warning) => (
            <li key={warning} className="flex items-start gap-2 text-sm leading-relaxed text-slate-700">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" /> {warning}
            </li>
          ))}
        </ul>
      </Modal>

      <TwoFactorDialog
        open={lockOpen}
        title={`Khoá kỳ lương ${monthLabel}`}
        confirmLabel="Khoá kỳ & trình duyệt"
        description={(
          <>
            Khoá bộ phiếu đã tính ({data.payslips.length} phiếu, tổng thực chi <strong>{formatVND(allTotalsNet)}</strong>) và trình
            người có quyền ký duyệt chi. Sau khi khoá, chấm công và số liệu tháng {monthLabel} không sửa được nữa.
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

      <Modal open={!!detailRow} onClose={() => setDetailUserId(null)} title={`Phiếu lương ${monthLabel} — ${detailRow?.profile.name ?? ''}`} size="lg">
        {detailRow && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <MiniStat label="Ngày công" value={`${detailRow.computed.stats.workDays}`} />
              <MiniStat label="Ngày phép / lễ" value={`${detailRow.computed.stats.leaveDays + detailRow.computed.stats.holidayDays}`} />
              <MiniStat label="Công chuẩn" value={`${detailRow.computed.standardDays}`} />
              <MiniStat label="Giờ làm" value={`${detailRow.computed.stats.workHours}`} />
            </div>
            {canOpenSchemes && (
              <div className="flex justify-end no-print">
                <Button variant="outline" size="sm" onClick={() => navigate(`/admin/payroll/schemes?month=${monthStartStr.slice(0, 7)}&user=${detailRow.profile.id}`)}>
                  Mở cơ chế lương của người này
                </Button>
              </div>
            )}
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

      <PersonAdjustmentModal
        person={adjustRow?.profile ?? null}
        lines={adjustRow?.computed.lines ?? []}
        components={data.components}
        adjustments={data.adjustments}
        monthStart={monthStartStr}
        monthLabel={monthLabel}
        actorId={profile?.id ?? null}
        onClose={() => setAdjustUserId(null)}
        onChanged={onChanged}
      />
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
