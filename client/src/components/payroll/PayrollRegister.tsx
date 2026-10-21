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

import { useCallback, useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { format } from 'date-fns';
import {
  BookOpenCheck, Printer, Calculator, Check, CheckCircle2, CircleAlert, CircleCheck, Columns3, FileSpreadsheet, History,
  Lock, Pencil, Plus, Save, Search, Settings, SlidersHorizontal, TriangleAlert, Unlock, X,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Textarea } from '@/components/ui/Input';
import { MonthNav } from '@/components/ui/MonthNav';
import { PayslipBreakdown } from '@/components/payroll/PayslipBreakdown';
import { documentLinesFromCatalog } from '@/components/payroll/PayslipDocument';
import { resolvePayslipLayout } from '@/lib/payslipLayout';
import { ExportButtons } from '@/components/payroll/ExportButtons';
import { printTables } from '@/lib/tablePrint';
import { payrollSignOff, signOffLines } from '@/lib/payrollSignOff';
import { TwoFactorDialog } from '@/components/payroll/TwoFactorDialog';
import { BankExportModal } from '@/components/payroll/BankExportModal';
import { Timeline } from '@/components/payroll/PayrollApprovals';
import { PersonAdjustmentModal } from '@/components/payroll/PersonAdjustmentModal';
import { RowAdjustmentConfirmModal, type RowChangedItem } from '@/components/payroll/RowAdjustmentConfirmModal';
import { PersonSchemeForm } from '@/components/payroll/PersonSchemeForm';
import { CellFormulaModal } from '@/components/payroll/CellFormulaModal';
import { PayrollFilterModal, type ItemColumn } from '@/components/payroll/PayrollFilterModal';
import { PayrollOperationsModal } from '@/components/payroll/PayrollOperationsModal';
import {
  FullscreenPanel, FullscreenToggle, ScrollArrows, TableShell, scrollAreaClass, useColumnScroll,
} from '@/components/payroll/WideTable';
import { useToast } from '@/contexts/ToastContext';
import { useConfirm } from '@/contexts/ConfirmContext';
import { useAuth } from '@/contexts/AuthContext';
import { hasAdminFunction } from '@/lib/permissions';
import { formatVND } from '@/lib/utils';
import type { ComputedPayslip, MechanismRow } from '@/lib/payroll';
import type { PayrollParams } from '@/lib/payrollSettings';
import { computeForPerson, nameResolver, schemeSourceOf } from '@/lib/payrollRun';
import { blankMechanismRows, resolveMechanismRows } from '@/lib/payrollScheme';
import { buildPayrollJournal } from '@/lib/payrollJournal';
import { formatFormulaNumber, normalizeText } from '@/lib/formulaTokens';
import {
  REAUTH_REQUIRED, ensurePayrollRun, fetchBankAccounts, fetchPayrollApproverIds, lockPayrollRun, markPayrollRunPaid, payslipDeductions,
  persistPayslips, savePayrollInput, withdrawPayrollRun, type PayrollWorkspace,
} from '@/lib/payrollData';
import { notifyUsers } from '@/lib/assignments';
import type { EmployeeBankAccount, PayComponentKind, PayrollRunStatus, Profile } from '@/types';

interface PayrollRegisterProps {
  data: PayrollWorkspace;
  params: PayrollParams | null;
  monthStart: Date;
  monthStartStr: string;
  monthEndStr: string;
  monthLabel: string;
  onMonthChange?: (month: Date) => void;
  onChanged: () => void;
}

export interface PayrollRow {
  profile: Profile;
  computed: ComputedPayslip;
  hasScheme: boolean;
  /** Tên cơ chế đang áp (chỉ có khi tính trực tiếp). */
  mechanism: string | null;
  /** Dòng cơ chế đã áp cho người này (chỉ có khi tính trực tiếp) — để form Điều chỉnh lương ghi ra công thức. */
  mechanismRows?: MechanismRow[];
}


export const RUN_STATUS_LABEL: Record<PayrollRunStatus, string> = {
  DRAFT: 'Bản nháp',
  CALCULATED: 'Đã tính',
  LOCKED: 'Đã khoá · chờ duyệt',
  APPROVED: 'Đã duyệt chi',
  PAID: 'Đã chi trả & phát hành',
};
const PAGE_SIZE = 50;
/** Số KPI do module KPI tự đẩy sang khi khoá phiếu — không nhập tay. */
/** "10.500.000" (chấm ngăn nghìn) và "1,5" / "1.5" (số lẻ) đều đọc đúng. */
const parseQuantity = (raw: string) => {
  const text = /^\d{1,3}(\.\d{3})+(,\d+)?$/.test(raw) ? raw.replace(/\./g, '').replace(',', '.') : raw.replace(',', '.');
  return Number(text) || 0;
};

/** Phiếu đã ghi → cùng dạng với phiếu tính trực tiếp, để một bảng vẽ được cả hai. */
function rowsFromPayslips(data: PayrollWorkspace, monthStartStr: string, monthEndStr: string): PayrollRow[] {
  const linesBySlip = new Map<string, typeof data.payslipLines>();
  for (const line of data.payslipLines) {
    linesBySlip.set(line.payslip_id, [...(linesBySlip.get(line.payslip_id) ?? []), line]);
  }
  const source = schemeSourceOf(data);
  return data.payslips.map((slip) => {
    const person = data.profiles.find((p) => p.id === slip.user_id)
      ?? ({ id: slip.user_id, name: slip.employee_name, department: slip.department, employee_code: slip.employee_code, avatar_url: null } as Profile);
    const mRows = resolveMechanismRows(person, source, monthStartStr, monthEndStr);
    return {
      profile: person,
      hasScheme: true,
      mechanism: mRows.length > 0 ? (mRows[0]?.origin ?? null) : null,
      mechanismRows: mRows,
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
    };
  });
}

export function PayrollRegister({
  data, params, monthStart, monthStartStr, monthEndStr, monthLabel, onMonthChange, onChanged,
}: PayrollRegisterProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { toast } = useToast();
  const confirm = useConfirm();
  const canManage = hasAdminFunction(profile, 'admin.payroll');
  const canAdjust = hasAdminFunction(profile, 'admin.payroll_adjustments');
  const canEnter = hasAdminFunction(profile, 'admin.payroll_inputs');
  const canOpenSchemes = hasAdminFunction(profile, 'admin.payroll_schemes') || hasAdminFunction(profile, 'admin.payroll_settings');
  const canApprove = hasAdminFunction(profile, 'admin.payroll_approve');

  const [unitFilter, setUnitFilter] = useState('');
  const [personFilter, setPersonFilter] = useState('');
  const [columnSearch, setColumnSearch] = useState('');
  const [hideIntermediate, setHideIntermediate] = useState(false);
  const [filterModalOpen, setFilterModalOpen] = useState(false);
  const [operationsOpen, setOperationsOpen] = useState(false);
  const [hiddenColumnCodes, setHiddenColumnCodes] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem('hrm_payroll_hidden_cols');
      if (raw) return new Set(JSON.parse(raw));
    } catch {
      // ignore
    }
    return new Set();
  });

  const saveHiddenColumnCodes = (next: Set<string>) => {
    setHiddenColumnCodes(next);
    try {
      localStorage.setItem('hrm_payroll_hidden_cols', JSON.stringify([...next]));
    } catch {
      // ignore
    }
  };

  const handleToggleColumn = (code: string) => {
    const next = new Set(hiddenColumnCodes);
    if (next.has(code)) {
      next.delete(code);
    } else {
      next.add(code);
    }
    saveHiddenColumnCodes(next);
  };

  const handleSelectAllColumns = () => {
    saveHiddenColumnCodes(new Set());
  };

  const handleDeselectAllColumns = () => {
    saveHiddenColumnCodes(new Set(allAvailableColumns.map((c) => c.code)));
  };

  const handleResetColumns = () => {
    saveHiddenColumnCodes(new Set());
  };

  const handleSelectOnlyColumns = (codes: string[]) => {
    const codeSet = new Set(codes);
    saveHiddenColumnCodes(new Set(allAvailableColumns.filter((c) => !codeSet.has(c.code)).map((c) => c.code)));
  };

  const handleSelectGroupColumns = (codes: string[], select: boolean) => {
    const next = new Set(hiddenColumnCodes);
    for (const code of codes) {
      if (select) {
        next.delete(code);
      } else {
        next.add(code);
      }
    }
    saveHiddenColumnCodes(next);
  };

  const handleResetAllFilters = () => {
    setUnitFilter('');
    setHideIntermediate(false);
    saveHiddenColumnCodes(new Set());
    setPersonFilter('');
    setPage(0);
  };
  const [page, setPage] = useState(0);
  const [detailUserId, setDetailUserId] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<'payslip' | 'scheme'>('payslip');
  const [adjustUserId, setAdjustUserId] = useState<string | null>(null);
  const [adjustPreset, setAdjustPreset] = useState<{ code: string; newValue: number } | null>(null);
  const [editingRowUserId, setEditingRowUserId] = useState<string | null>(null);
  const [rowDraftValues, setRowDraftValues] = useState<Record<string, string>>({});
  const [confirmAdjustmentState, setConfirmAdjustmentState] = useState<{
    row: PayrollRow;
    items: RowChangedItem[];
  } | null>(null);
  const [inspectCell, setInspectCell] = useState<{ row: PayrollRow; column: ItemColumn } | null>(null);
  const [accounts, setAccounts] = useState<EmployeeBankAccount[]>([]);

  const reloadAccounts = () => { void fetchBankAccounts().then(setAccounts); };
  useEffect(reloadAccounts, []);

  /** Số đang gõ dở, khoá `mã nhân sự|mã đầu mục`. Chưa lưu thì chưa vào database. */
  const [edits, setEdits] = useState<Record<string, string>>({});
  /** Ô số liệu tháng đang được trỏ chuột tới — để hiện núm kéo kiểu Excel. */
  const [hoverCell, setHoverCell] = useState<{ userId: string; code: string } | null>(null);
  /** Đang kéo núm điền: từ dòng nào tới dòng nào (chỉ số trong trang đang xem), cùng một cột. */
  const [fillDrag, setFillDrag] = useState<{ code: string; value: string; startRow: number; endRow: number } | null>(null);
  const [inputMode, setInputMode] = useState(false);
  const [savingInputs, setSavingInputs] = useState(false);
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
      return { profile: person, computed: result.computed, hasScheme: result.hasScheme, mechanism: null, mechanismRows: result.rows };
    });
  }, [closed, data, monthStart, monthStartStr, monthEndStr, params]);

  /** Đầu mục "thay đổi theo tháng" của từng người — chỉ những ô này gõ được. Số KPI do hệ thống tự điền khi khoá sổ KPI. */
  const kpiCodes = useMemo(
    () => new Set([...data.kpiCodes, ...data.timesheetCodes].map((code) => code.toUpperCase())),
    [data.kpiCodes, data.timesheetCodes],
  );
  const neededByPerson = useMemo(() => {
    const map = new Map<string, Set<string>>();
    if (closed) return map;
    const source = schemeSourceOf(data);
    for (const person of data.profiles) {
      const codes = resolveMechanismRows(person, source, monthStartStr, monthEndStr)
        .filter((item) => item.mode === 'MONTHLY_INPUT' && !kpiCodes.has(item.component.code.toUpperCase()))
        .map((item) => item.component.code);
      if (codes.length > 0) map.set(person.id, new Set(codes));
    }
    return map;
  }, [closed, data, kpiCodes, monthEndStr, monthStartStr]);

  /** Người chưa thiết lập xong (chưa có cơ chế / thiếu mức riêng bắt buộc) — nhắc trước khi chốt. */
  const setupGaps = useMemo(() => (closed ? [] : liveRows.filter((row) => !row.hasScheme
    || blankMechanismRows(row.mechanismRows ?? []).length > 0)), [closed, liveRows]);

  const savedInputs = useMemo(
    () => new Map(data.inputs.map((input) => [`${input.user_id}|${input.code}`, String(Number(input.quantity))])),
    [data.inputs],
  );
  const inputValueOf = (userId: string, code: string) => edits[`${userId}|${code}`] ?? savedInputs.get(`${userId}|${code}`) ?? '';

  // Đổi tháng thì bỏ số gõ dở — tránh ghi nhầm số tháng này sang tháng khác.
  useEffect(() => {
    setEdits({});
    setInputMode(false);
    setEditingRowUserId(null);
    setRowDraftValues({});
    setConfirmAdjustmentState(null);
  }, [monthStartStr]);

  /** Tính lại ngay các hàng đang gõ dở để thấy lương đổi theo; hàng khác giữ nguyên. */
  const displayRows: PayrollRow[] = useMemo(() => {
    if (!params || closed) return liveRows;
    const typed = new Map<string, Record<string, number>>();
    for (const [key, raw] of Object.entries(edits)) {
      const [userId, code] = key.split('|');
      typed.set(userId, { ...typed.get(userId), [code]: parseQuantity(raw) });
    }
    if (typed.size === 0) return liveRows;
    return liveRows.map((row) => {
      const override = typed.get(row.profile.id);
      if (!override) return row;
      const result = computeForPerson(row.profile, data, params, monthStart, monthStartStr, monthEndStr, { inputsOverride: override });
      return { profile: row.profile, computed: result.computed, hasScheme: result.hasScheme, mechanism: null, mechanismRows: result.rows };
    });
  }, [closed, data, edits, liveRows, monthEndStr, monthStart, monthStartStr, params]);

  const frozenRows = useMemo(() => (closed ? rowsFromPayslips(data, monthStartStr, monthEndStr) : []), [closed, data, monthEndStr, monthStartStr]);
  const rows = closed ? frozenRows : displayRows;

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
  /** Bộ lọc "Số liệu theo tháng": chỉ còn người và cột cần nhập số liệu tháng — bấm một phát là ra bảng nhập. */
  const inputOptions = useMemo(() => {
    const codes = new Set<string>();
    for (const set of neededByPerson.values()) for (const code of set) codes.add(code);
    return [...codes];
  }, [neededByPerson]);
  const shownInputCodes = useMemo(() => {
    return inputMode ? new Set(inputOptions) : null;
  }, [inputMode, inputOptions]);
  const keyword = normalizeText(personFilter);
  const filtered = unitRows
    .filter((row) => !selectedUserId || row.profile.id === selectedUserId)
    .filter((row) => !keyword || normalizeText(`${row.profile.name} ${row.profile.employee_code ?? ''}`).includes(keyword))
    .filter((row) => !shownInputCodes || [...shownInputCodes].some((code) => neededByPerson.get(row.profile.id)?.has(code)))
;
  const sorted = [...filtered].sort((a, b) => a.profile.name.localeCompare(b.profile.name, 'vi'));
  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const pageRows = sorted.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

  /** Toàn bộ các đầu mục có trong bảng lương tháng này. */
  const allAvailableColumns = useMemo<ItemColumn[]>(() => {
    const categoryByCode = new Map(data.components.map((c) => [c.code, c.category_code]));
    const seen = new Map<string, ItemColumn>();
    for (const row of rows) {
      for (const line of row.computed.lines) {
        if (!seen.has(line.code)) {
          seen.set(line.code, {
            code: line.code,
            name: line.name,
            kind: line.kind,
            categoryCode: categoryByCode.get(line.code) ?? null,
          });
        }
      }
    }
    if (seen.size === 0) {
      for (const comp of data.components) {
        if (!seen.has(comp.code)) {
          seen.set(comp.code, {
            code: comp.code,
            name: comp.name,
            kind: comp.kind,
            categoryCode: comp.category_code,
          });
        }
      }
    }
    return [...seen.values()];
  }, [data.components, rows]);

  const categoryNameMap = useMemo(() => new Map<string, string>(data.categories.map((c) => [c.code, c.name])), [data.categories]);

  /** Mỗi đầu mục một cột, theo thứ tự xuất hiện trên phiếu. */
  const columns = useMemo<ItemColumn[]>(() => {
    const categoryByCode = new Map(data.components.map((c) => [c.code, c.category_code]));
    const seen = new Map<string, ItemColumn>();
    for (const row of sorted) {
      for (const line of row.computed.lines) {
        if (!seen.has(line.code)) {
          seen.set(line.code, {
            code: line.code,
            name: line.name,
            kind: line.kind,
            categoryCode: categoryByCode.get(line.code) ?? null,
          });
        }
      }
    }
    let all = [...seen.values()];
    if (shownInputCodes) {
      all = all.filter((column) => shownInputCodes.has(column.code));
    }
    if (hideIntermediate) {
      all = all.filter((column) => column.kind !== 'INFO');
    }
    if (hiddenColumnCodes.size > 0) {
      all = all.filter((column) => !hiddenColumnCodes.has(column.code));
    }
    if (columnSearch.trim()) {
      const q = normalizeText(columnSearch.trim());
      all = all.filter((column) => {
        const cat = column.categoryCode ? (categoryNameMap.get(column.categoryCode) ?? '') : '';
        return normalizeText(`${column.name} ${column.code} ${cat}`).includes(q);
      });
    }
    return all;
  }, [categoryNameMap, columnSearch, data.components, hiddenColumnCodes, hideIntermediate, shownInputCodes, sorted]);

  const activeFilterCount = (unitFilter ? 1 : 0) + (hideIntermediate ? 1 : 0) + (hiddenColumnCodes.size > 0 ? 1 : 0);
  const hasActiveFilters = activeFilterCount > 0;
  const amountOf = (row: PayrollRow, code: string) => {
    const lines = row.computed.lines.filter((line) => line.code === code);
    return lines.length === 0 ? null : lines.reduce((sum, line) => sum + line.amount, 0);
  };

  /** Điều chỉnh đã lưu gắn vào từng ô: tổng thay đổi và lý do — để ô hiện "số cũ + − chênh lệch". */
  const adjustmentByCell = useMemo(() => {
    const kindOf = new Map<string, PayComponentKind>();
    for (const item of data.components) kindOf.set(item.code.toUpperCase(), item.kind);
    const map = new Map<string, { delta: number; reasons: string[] }>();
    for (const item of data.adjustments) {
      const code = item.component_code?.trim().toUpperCase();
      if (!code) continue;
      const kind = kindOf.get(code);
      const up = kind === 'DEDUCTION' ? item.kind === 'CLAWBACK' : item.kind === 'RECOVERY';
      const key = `${item.user_id}|${code}`;
      const entry = map.get(key) ?? { delta: 0, reasons: [] };
      entry.delta += (up ? 1 : -1) * Number(item.amount);
      entry.reasons.push(item.reason);
      map.set(key, entry);
    }
    return map;
  }, [data.adjustments, data.components]);

  /** Ô số liệu tháng còn trống — người làm lương cần thấy ngay để nhập cho đủ. */
  const missingInputCount = useMemo(() => {
    let count = 0;
    for (const [userId, codes] of neededByPerson) {
      for (const code of codes) {
        if (inputValueOf(userId, code) === '') count += 1;
      }
    }
    return count;
  }, [edits, neededByPerson, savedInputs]); // eslint-disable-line react-hooks/exhaustive-deps

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
    { ok: (readiness?.openKpiReviews ?? 0) === 0, blocking: true, label: 'Kỳ KPI tháng đã khoá sổ', hint: 'Khoá sổ ở Phiếu KPI tháng — kết quả KPI tự điền vào lương.' },
    { ok: missingInputCount === 0, blocking: true, label: 'Đã nhập đủ số liệu theo tháng', hint: `Còn ${missingInputCount} ô số liệu tháng chưa nhập.` },
    {
      ok: closed || (runStatus === 'CALCULATED' && staleCount === 0),
      blocking: true,
      label: 'Bộ phiếu đã tính khớp số liệu hiện tại',
      hint: closed
        ? 'Đã tính và chốt số liệu khi khoá kỳ.'
        : runStatus === 'CALCULATED'
        ? `${staleCount} phiếu đã đổi — bấm Tính lại.`
        : 'Chưa tính lương.',
    },
    { ok: missingSchemeCount === 0, blocking: false, label: 'Mọi người có công đều có cơ chế lương', hint: `${missingSchemeCount} người có công nhưng chưa có cơ chế.` },
    { ok: pendingSchemes === 0, blocking: false, label: 'Không còn đề xuất cơ chế chờ duyệt cho tháng này', hint: `${pendingSchemes} đề xuất chờ duyệt — duyệt xong phải tính lại.` },
    { ok: allWarnings.length === 0, blocking: false, label: 'Không có cảnh báo tính toán', hint: `${allWarnings.length} cảnh báo — bấm nút Cảnh báo để xem từng dòng.` },
  ];
  const canLock = checklist.every((item) => item.ok || !item.blocking);
  const unmetCount = checklist.filter((item) => !item.ok).length;
  /** Mục bắt buộc chưa đạt — nút Kiểm tra báo đỏ để người làm lương thấy ngay vì sao chưa khoá kỳ được. */
  const blockingUnmet = checklist.filter((item) => !item.ok && item.blocking);

  const nameOf = (id: string | null) => (id ? data.profiles.find((person) => person.id === id)?.name ?? 'Người dùng đã nghỉ' : '—');
  const adjustRow = adjustUserId ? rows.find((row) => row.profile.id === adjustUserId) ?? null : null;
  const adjustNameOf = useMemo(() => nameResolver(data.components, params), [data.components, params]);
  const detailRow = detailUserId ? rows.find((row) => row.profile.id === detailUserId) ?? null : null;
  const lastEvent = data.runEvents[0];

  // ---- Cuộn ngang theo cột, toàn màn hình -------------------------------------
  const [full, setFull] = useState(false);
  const exitFull = useCallback(() => setFull(false), []);
  const { scrollRef, edge, updateEdge, scrollColumns } = useColumnScroll([columns.length, pageRows.length, rows.length, full]);

  const dirtyCount = Object.keys(edits).length;

  /**
   * Kéo núm ở góc một ô số liệu tháng xuống các dòng dưới (cùng cột) để điền
   * cùng giá trị — như núm điền của Excel. Chỉ điền vào ô cũng đang cần nhập
   * số liệu tháng đó; dòng không cần cột này thì bỏ qua.
   */
  useEffect(() => {
    if (!fillDrag) return;
    const handleMove = (event: MouseEvent) => {
      const target = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null;
      const cell = target?.closest<HTMLElement>('[data-fill-col]');
      if (!cell || cell.dataset.fillCol !== fillDrag.code) return;
      const row = Number(cell.dataset.fillRow);
      if (Number.isFinite(row)) setFillDrag((current) => (current && current.endRow !== row ? { ...current, endRow: row } : current));
    };
    const handleUp = () => {
      setFillDrag((current) => {
        if (!current) return null;
        const lo = Math.min(current.startRow, current.endRow);
        const hi = Math.max(current.startRow, current.endRow);
        if (lo !== hi) {
          setEdits((prev) => {
            const next = { ...prev };
            for (let i = lo; i <= hi; i += 1) {
              const target = pageRows[i];
              if (target && neededByPerson.get(target.profile.id)?.has(current.code)) {
                next[`${target.profile.id}|${current.code}`] = current.value;
              }
            }
            return next;
          });
        }
        return null;
      });
    };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [fillDrag, pageRows, neededByPerson]);

  /** Enter / mũi tên lên xuống nhảy sang ô cùng cột như Excel. */
  const moveInColumn = (event: KeyboardEvent<HTMLInputElement>, arrowsOnly = false) => {
    const step = event.key === 'ArrowUp' ? -1 : (event.key === 'Enter' && !arrowsOnly) || event.key === 'ArrowDown' ? 1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const cells = [...(scrollRef.current?.querySelectorAll<HTMLInputElement>(`input[data-col="${event.currentTarget.dataset.col}"]`) ?? [])];
    cells[cells.indexOf(event.currentTarget) + step]?.focus();
  };

  const closeAdjust = () => { setAdjustUserId(null); setAdjustPreset(null); };

  const startEditingRow = (row: PayrollRow) => {
    setEditingRowUserId(row.profile.id);
    const initial: Record<string, string> = {};
    for (const column of columns) {
      const amt = amountOf(row, column.code);
      initial[column.code] = amt != null ? formatFormulaNumber(amt) : '';
    }
    setRowDraftValues(initial);
  };

  const cancelEditingRow = () => {
    setEditingRowUserId(null);
    setRowDraftValues({});
  };

  const handleSaveRowEdits = (row: PayrollRow) => {
    const changedItems: RowChangedItem[] = [];
    for (const column of columns) {
      const currentAmt = amountOf(row, column.code) ?? 0;
      const raw = rowDraftValues[column.code];
      const newVal = raw !== undefined ? parseQuantity(raw) : currentAmt;
      const delta = Math.round((newVal - currentAmt) * 100) / 100;
      if (Math.abs(delta) >= 0.01) {
        changedItems.push({
          code: column.code,
          name: column.name,
          kind: column.kind,
          oldValue: currentAmt,
          newValue: newVal,
          delta,
        });
      }
    }
    if (changedItems.length === 0) {
      toast('Chưa có đầu mục nào thay đổi giá trị so với số hiện tại.', 'warning');
      return;
    }
    setConfirmAdjustmentState({
      row,
      items: changedItems,
    });
  };

  const handleSaveInputs = async () => {
    setSavingInputs(true);
    for (const [key, raw] of Object.entries(edits)) {
      const [userId, code] = key.split('|');
      const error = await savePayrollInput({
        user_id: userId, month_start: monthStartStr, code, quantity: parseQuantity(raw), created_by: profile?.id ?? null,
      });
      if (error) {
        setSavingInputs(false);
        return toast('Lưu số liệu thất bại: ' + error, 'error');
      }
    }
    setSavingInputs(false);
    setEdits({});
    toast(`Đã lưu ${dirtyCount} ô số liệu tháng.`, 'success');
    onChanged();
  };

  // ---- Thao tác --------------------------------------------------------------
  const handleCalculate = async () => {
    if (dirtyCount > 0) return toast('Còn số liệu tháng chưa lưu — lưu trước khi tính lương.', 'warning');
    if (missingInputCount > 0) {
      if (canEnter) { setInputMode(true); setPage(0); }
      return toast(`Còn ${missingInputCount} ô số liệu tháng chưa nhập — nhập đủ mới tính lương được.`, 'warning');
    }
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
  const handleExportJournal = async (mode: 'excel' | 'print' = 'excel') => {
    setBusy('journal');
    try {
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
        [],
        ...signOffLines(signOffOf()).map((line) => [line]),
      ];
      if (mode === 'print') {
        await printTables({
          title: String(sheet[0][0]),
          subtitle: String(sheet[1][0]),
          landscape: true,
          signOff: signOffOf(),
          tables: [{ header: sheet[4].map(String), rows: sheet.slice(5).filter((r) => r.length > 0 && r[0] !== 'ĐỐI CHIẾU') }],
        });
        setBusy(null);
        return;
      }
      const XLSX = await import('xlsx');
      const worksheet = XLSX.utils.aoa_to_sheet(sheet);
      worksheet['!merges'] = [
        { s: { r: 0, c: 0 }, e: { r: 0, c: 5 } },
        { s: { r: 1, c: 0 }, e: { r: 1, c: 5 } },
        { s: { r: 2, c: 0 }, e: { r: 2, c: 5 } },
      ];
      worksheet['!cols'] = [{ wch: 30 }, { wch: 22 }, { wch: 10 }, { wch: 10 }, { wch: 18 }, { wch: 48 }];
      worksheet['!rows'] = [{ hpt: 26 }, { hpt: 18 }, { hpt: 18 }, { hpt: 10 }, { hpt: 24 }];
      worksheet['!views'] = [{ state: 'frozen', ySplit: 5 }];

      // Number formatting for amounts
      const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');
      for (let R = 5; R <= range.e.r; R++) {
        const cell = worksheet[XLSX.utils.encode_cell({ r: R, c: 4 })];
        if (cell && typeof cell.v === 'number') {
          cell.z = '#,##0';
        }
      }

      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Bút toán lương');
      XLSX.writeFile(workbook, `but-toan-luong-${format(monthStart, 'yyyy-MM')}.xlsx`);
    } catch (error) {
      toast('Xuất bút toán thất bại: ' + (error instanceof Error ? error.message : String(error)), 'error');
    }
    setBusy(null);
  };

  /** Chữ ký điện tử + con dấu "ĐÃ DUYỆT" lấy từ dấu vết kỳ lương, in ở chân chứng từ. */
  const signOffOf = () => payrollSignOff(run, nameOf);

  /** Mỗi đầu mục một cột — đúng như bảng lương kế toán vẫn đối chiếu. */
  const exportOptions = () => ({
    filename: `bang-luong-${format(monthStart, 'yyyy-MM')}`,
    sheetName: 'Bảng lương',
    title: `BẢNG LƯƠNG THÁNG ${monthLabel}`,
    subtitle: `Trạng thái kỳ: ${RUN_STATUS_LABEL[runStatus]}${closed ? ' (số liệu đã chốt)' : ' (bản xem trước)'}`,
    rows: sorted,
    columns: [
      { header: 'STT', value: (_row: PayrollRow, index: number) => index + 1, width: 6 },
      { header: 'Mã NV', value: (row: PayrollRow) => row.profile.employee_code ?? '', width: 10 },
      { header: 'Họ tên', value: (row: PayrollRow) => row.profile.name, width: 24 },
      { header: 'Đơn vị', value: (row: PayrollRow) => unitNames.get(row.profile.unit_id ?? '') ?? row.profile.department ?? '', width: 20 },
      { header: 'Ngày công', value: (row: PayrollRow) => row.computed.stats.workDays, width: 10 },
      { header: 'Công chuẩn', value: (row: PayrollRow) => row.computed.standardDays, width: 10 },
      ...columns.map((column) => ({
        header: column.name,
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
        Khai ở <strong>Thiết lập lương → Thông số chung</strong> trước.
      </Banner>
    );
  }

  return (
    <div className="space-y-4">
      {selectedUserId && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-none border border-indigo-200 bg-indigo-50 px-4 py-3">
          <p className="text-sm font-bold text-indigo-900">Đang lọc theo một nhân sự được chọn từ Danh bạ.</p>
          <Button variant="outline" size="xs" square onClick={() => setSearchParams({})} className="!min-h-0 !h-8 px-2.5 text-xs">Xem toàn bộ bảng lương</Button>
        </div>
      )}

      <FullscreenPanel full={full} onExit={exitFull}>
      <TableShell full={full}>
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-300 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-900 px-4 py-2.5 no-print">
            {full && <p className="w-full text-xs font-bold text-slate-800 dark:text-slate-200 sm:w-auto">Bảng lương tháng {monthLabel}</p>}

            {/* CTA Trạng thái kỳ lương — chỉ hiện trạng thái, bấm vào để chỉnh sửa / vận hành */}
            <Button
              size="xs"
              square
              variant="outline"
              onClick={() => setOperationsOpen(true)}
              title={`Trạng thái: ${RUN_STATUS_LABEL[runStatus]} — Bấm để chỉnh sửa / vận hành kỳ lương`}
              aria-label={`Trạng thái: ${RUN_STATUS_LABEL[runStatus]} — Bấm để chỉnh sửa`}
              className={`!min-h-0 !h-8 gap-1.5 font-bold px-2.5 text-xs shadow-xs border transition ${
                runStatus === 'LOCKED'
                  ? 'border-amber-400 bg-amber-50 text-amber-900 hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-950/60 dark:text-amber-200'
                  : runStatus === 'APPROVED' || runStatus === 'PAID'
                  ? 'border-emerald-400 bg-emerald-50 text-emerald-900 hover:bg-emerald-100 dark:border-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-200'
                  : runStatus === 'CALCULATED'
                  ? 'border-blue-400 bg-blue-50 text-blue-900 hover:bg-blue-100 dark:border-blue-700 dark:bg-blue-950/60 dark:text-blue-200'
                  : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100 hover:border-slate-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              {runStatus === 'LOCKED' ? (
                <Lock className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
              ) : runStatus === 'APPROVED' || runStatus === 'PAID' ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
              ) : runStatus === 'CALCULATED' ? (
                <Calculator className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
              ) : (
                <Unlock className="h-3.5 w-3.5 text-slate-500 dark:text-slate-400" />
              )}
              <span>{RUN_STATUS_LABEL[runStatus]}</span>
            </Button>

            {/* Tìm kiếm theo tên nhân sự */}
            <div className="relative w-full sm:w-44">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                value={personFilter}
                onChange={(event) => { setPersonFilter(event.target.value); setPage(0); }}
                placeholder="Lọc nhân viên…"
                aria-label="Lọc theo tên nhân viên"
                className="!min-h-0 h-8 w-full !rounded-none border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 pl-8 pr-7 text-xs font-medium text-slate-800 dark:text-slate-200 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/20"
              />
              {personFilter && (
                <button
                  type="button"
                  onClick={() => { setPersonFilter(''); setPage(0); }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                  title="Xoá tìm nhân viên"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            {/* Tìm kiếm đầu mục cho bảng lương */}
            <div className="relative w-full sm:w-44">
              <Columns3 className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                value={columnSearch}
                onChange={(event) => setColumnSearch(event.target.value)}
                placeholder="Tìm đầu mục lương…"
                aria-label="Tìm đầu mục cho bảng lương"
                className="!min-h-0 h-8 w-full !rounded-none border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 pl-8 pr-7 text-xs font-medium text-slate-800 dark:text-slate-200 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/20"
              />
              {columnSearch && (
                <button
                  type="button"
                  onClick={() => setColumnSearch('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                  title="Xoá tìm đầu mục"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            {unitFilter && (
              <span className="inline-flex items-center gap-1.5 rounded-none border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-xs font-semibold text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-300">
                Phòng ban: {unitNames.get(unitFilter) ?? 'Đang chọn'}
                <button
                  type="button"
                  onClick={() => { setUnitFilter(''); setPersonFilter(''); setPage(0); }}
                  className="hover:text-indigo-900 dark:hover:text-indigo-100"
                  title="Bỏ lọc phòng ban"
                >
                  ✕
                </button>
              </span>
            )}
            {hideIntermediate && (
              <span className="inline-flex items-center gap-1.5 rounded-none border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
                Đã ẩn trung gian
                <button
                  type="button"
                  onClick={() => setHideIntermediate(false)}
                  className="hover:text-amber-900 dark:hover:text-amber-100"
                  title="Hiện lại dòng trung gian"
                >
                  ✕
                </button>
              </span>
            )}
            {hiddenColumnCodes.size > 0 && (
              <span className="inline-flex items-center gap-1.5 rounded-none border border-slate-300 bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                Ẩn {hiddenColumnCodes.size} đầu mục
                <button
                  type="button"
                  onClick={() => saveHiddenColumnCodes(new Set())}
                  className="hover:text-slate-900 dark:hover:text-slate-100"
                  title="Hiện lại tất cả đầu mục"
                >
                  ✕
                </button>
              </span>
            )}
            {columnSearch.trim() && (
              <span className="inline-flex items-center gap-1.5 rounded-none border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-xs font-semibold text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-300">
                Đầu mục: {columnSearch.trim()} ({columns.length})
                <button
                  type="button"
                  onClick={() => setColumnSearch('')}
                  className="hover:text-indigo-900 dark:hover:text-indigo-100"
                  title="Bỏ tìm kiếm đầu mục"
                >
                  ✕
                </button>
              </span>
            )}
            {canEnter && !closed && inputOptions.length > 0 && (
              <Button
                size="xs"
                square
                variant={inputMode ? 'primary' : 'outline'}
                aria-pressed={inputMode}
                onClick={() => { setInputMode((value) => !value); setPage(0); }}
                className="!min-h-0 !h-8 px-2.5 text-xs border-slate-300 dark:border-slate-700 gap-1.5"
              >
                <SlidersHorizontal className="h-3.5 w-3.5" /> Số liệu theo tháng
              </Button>
            )}
            <div className="ml-auto flex items-center gap-1.5">
              {onMonthChange && (
                <MonthNav value={monthStart} onChange={onMonthChange} compact square />
              )}
              <ExportButtons options={exportOptions} signOff={signOffOf} disabled={sorted.length === 0} square />
              <Button
                variant="outline"
                size="xs"
                square
                onClick={() => void handleExportJournal()}
                disabled={!!busy || !approved || filtered.length === 0}
                title={approved ? undefined : 'Duyệt chi xong mới xuất bút toán kết chuyển'}
                className="!min-h-0 !h-8 px-2.5 text-xs border-slate-300 dark:border-slate-700 gap-1.5 hidden md:inline-flex"
              >
                <BookOpenCheck className="h-3.5 w-3.5" /> Bút toán
              </Button>
              <Button
                variant="outline"
                size="xs"
                square
                onClick={() => void handleExportJournal('print')}
                disabled={!!busy || !approved || filtered.length === 0}
                title={approved ? 'In bút toán kết chuyển' : 'Duyệt chi xong mới in bút toán kết chuyển'}
                className="!min-h-0 !h-8 px-2.5 text-xs border-slate-300 dark:border-slate-700 gap-1.5 hidden md:inline-flex"
              >
                <Printer className="h-3.5 w-3.5" /> In bút toán
              </Button>
              <FullscreenToggle full={full} onToggle={() => setFull((value) => !value)} square />
              <Button
                size="xs"
                square
                variant={hasActiveFilters ? 'primary' : 'outline'}
                onClick={() => setFilterModalOpen(true)}
                title="Tùy chỉnh cột & bộ lọc"
                aria-label="Tùy chỉnh cột và bộ lọc"
                className="!min-h-0 !h-8 !w-8 p-0 relative shrink-0 border-slate-300 dark:border-slate-700"
              >
                <Settings className="h-3.5 w-3.5" />
                {activeFilterCount > 0 && (
                  <span className="absolute -top-1 -right-1 inline-flex items-center justify-center rounded-none bg-indigo-600 text-white dark:bg-indigo-400 dark:text-slate-900 text-[9px] font-black h-3.5 min-w-[14px] px-0.5 shadow-xs">
                    {activeFilterCount}
                  </span>
                )}
              </Button>
            </div>
          </div>

          {rows.length === 0 ? (
            <p className="px-6 py-12 text-center text-sm font-medium text-slate-500 dark:text-slate-400">
              {closed ? 'Kỳ này chưa có phiếu lương nào.' : 'Chưa có nhân sự đang làm việc.'}
            </p>
          ) : (
            <div className={full ? 'relative flex min-h-0 flex-1 flex-col' : 'relative'}>
              <ScrollArrows edge={edge} onScroll={scrollColumns} />
            <div ref={scrollRef} onScroll={updateEdge} className={scrollAreaClass(full)}>
              <table className="w-full whitespace-nowrap text-xs tabular-nums text-slate-900 dark:text-slate-100 border-collapse">
                <thead>
                  <tr className="border-b-2 border-[#bf1f2b] dark:border-[#e66a76] bg-[#fdf2f4] dark:bg-[#201114] text-xs font-black text-[#5c0f16] dark:text-[#fde8ea]">
                    <th className="sticky left-0 top-0 z-30 shadow-[inset_0_-2px_0_#bf1f2b] dark:shadow-[inset_0_-2px_0_#e66a76] w-[46px] min-w-[46px] max-w-[46px] bg-[#fdf2f4] dark:bg-[#201114] px-1 py-1 text-center border-r border-[#eed5d8] dark:border-[#4a1c22] font-black uppercase tracking-wider text-[#5c0f16] dark:text-[#fde8ea]">
                      STT
                    </th>
                    <th className="sticky left-[46px] top-0 z-30 shadow-[inset_0_-2px_0_#bf1f2b] dark:shadow-[inset_0_-2px_0_#e66a76] w-[84px] min-w-[84px] max-w-[84px] bg-[#fdf2f4] dark:bg-[#201114] px-1.5 py-1 text-center border-r border-[#eed5d8] dark:border-[#4a1c22] font-black uppercase tracking-wider text-[#5c0f16] dark:text-[#fde8ea]">
                      Mã NV
                    </th>
                    <th className="sticky left-[130px] top-0 z-30 shadow-[inset_0_-2px_0_#bf1f2b] dark:shadow-[inset_0_-2px_0_#e66a76] w-[150px] min-w-[150px] max-w-[150px] bg-[#fdf2f4] dark:bg-[#201114] px-2.5 py-1 text-left border-r-2 border-[#eed5d8] dark:border-[#4a1c22] font-black uppercase tracking-wider text-[#5c0f16] dark:text-[#fde8ea]">
                      Nhân sự
                    </th>
                    <th className="sticky top-0 z-20 bg-[#fdf2f4] dark:bg-[#201114] shadow-[inset_0_-2px_0_#bf1f2b] dark:shadow-[inset_0_-2px_0_#e66a76] min-w-[50px] px-1.5 py-1 border-l border-[#eed5d8] dark:border-[#4a1c22] text-center font-black uppercase tracking-wider text-[#5c0f16] dark:text-[#fde8ea]">
                      <div className="min-w-[50px] text-center line-clamp-1 leading-snug">Công</div>
                    </th>
                    {columns.map((column) => (
                      <th key={column.code} className="sticky top-0 z-20 bg-[#fdf2f4] dark:bg-[#201114] shadow-[inset_0_-2px_0_#bf1f2b] dark:shadow-[inset_0_-2px_0_#e66a76] min-w-[76px] max-w-[110px] px-1.5 py-1 border-l border-[#eed5d8] dark:border-[#4a1c22] text-center font-black text-[#5c0f16] dark:text-[#fde8ea]">
                        <div className="w-full min-w-[76px] max-w-[110px] mx-auto flex items-center justify-center">
                          <span
                            className="font-black text-[#5c0f16] dark:text-[#fde8ea] text-xs line-clamp-2 text-center leading-tight whitespace-normal break-words"
                            title={column.kind === 'INFO' ? `${column.name} (Dòng trung gian)` : column.name}
                          >
                            {column.name}
                          </span>
                        </div>
                      </th>
                    ))}
                    <th className="sticky top-0 z-20 bg-[#f9e5e7] dark:bg-[#2c1519] shadow-[inset_0_-2px_0_#bf1f2b] dark:shadow-[inset_0_-2px_0_#e66a76] min-w-[80px] max-w-[100px] px-1.5 py-1.5 border-l-2 border-[#bf1f2b] dark:border-[#e66a76] text-center font-black uppercase tracking-wider text-[#6f151c] dark:text-[#fcd6da]">
                      <div className="w-full min-w-[80px] text-center line-clamp-2 leading-tight">
                        Tổng cộng
                      </div>
                    </th>
                    <th className="sticky top-0 z-20 bg-[#fde8ea] dark:bg-rose-950/40 shadow-[inset_0_-2px_0_#e11d48] dark:shadow-[inset_0_-2px_0_#fb7185] min-w-[80px] max-w-[100px] px-1.5 py-1.5 border-l border-[#eed5d8] dark:border-[#4a1c22] text-center font-black uppercase tracking-wider text-rose-800 dark:text-rose-300">
                      <div className="w-full min-w-[80px] text-center line-clamp-2 leading-tight">
                        Tổng trừ
                      </div>
                    </th>
                    <th className="sticky top-0 z-20 bg-[#e8f5ec] dark:bg-[#08291a] shadow-[inset_0_-2px_0_#10b981] dark:shadow-[inset_0_-2px_0_#34d399] min-w-[85px] max-w-[110px] px-2 py-1.5 border-l-2 border-[#bf1f2b] dark:border-[#e66a76] text-center font-black uppercase tracking-wider text-emerald-950 dark:text-emerald-200">
                      <div className="w-full min-w-[85px] text-center line-clamp-2 leading-tight">
                        Thực nhận
                      </div>
                    </th>
                    <th className="sticky top-0 z-20 bg-[#fdf2f4] dark:bg-[#201114] shadow-[inset_0_-2px_0_#bf1f2b] dark:shadow-[inset_0_-2px_0_#e66a76] min-w-[72px] w-[72px] px-1 py-1.5 border-l border-[#eed5d8] dark:border-[#4a1c22] no-print" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-300 dark:divide-slate-800 bg-white dark:bg-slate-900">
                  {pageRows.map((row, rowIndex) => {
                    // Người chưa có cơ chế đã có sẵn một cảnh báo riêng trong `warnings`.
                    const flags = row.computed.warnings.length > 0
                      ? row.computed.warnings
                      : row.hasScheme ? [] : ['Chưa có cơ chế lương'];
                    const isEditingRow = editingRowUserId === row.profile.id;
                    return (
                      <tr key={row.profile.id} className={`group transition-colors ${isEditingRow ? 'bg-amber-50/70 dark:bg-amber-950/30 ring-1 ring-inset ring-amber-400 dark:ring-amber-500' : 'hover:bg-slate-100/80 dark:hover:bg-slate-800/60'}`}>
                        <td className={`sticky left-0 z-10 w-[46px] min-w-[46px] max-w-[46px] px-1 py-1 text-center font-bold text-slate-500 dark:text-slate-400 border-r border-slate-300 dark:border-slate-700 ${
                          isEditingRow ? 'bg-amber-50 dark:bg-slate-900' : 'bg-white dark:bg-slate-900 group-hover:bg-slate-100/80 dark:group-hover:bg-slate-800/80'
                        }`}>
                          {currentPage * PAGE_SIZE + rowIndex + 1}
                        </td>
                        <td className={`sticky left-[46px] z-10 w-[84px] min-w-[84px] max-w-[84px] px-1.5 py-1 text-center font-mono text-xs font-semibold text-slate-600 dark:text-slate-300 border-r border-slate-300 dark:border-slate-700 ${
                          isEditingRow ? 'bg-amber-50 dark:bg-slate-900' : 'bg-white dark:bg-slate-900 group-hover:bg-slate-100/80 dark:group-hover:bg-slate-800/80'
                        }`}>
                          <span className="truncate block" title={row.profile.employee_code ?? undefined}>
                            {row.profile.employee_code || '—'}
                          </span>
                        </td>
                        <td className={`sticky left-[130px] z-10 w-[150px] min-w-[150px] max-w-[150px] px-2.5 py-1 border-r-2 border-slate-400 dark:border-slate-600 shadow-[2px_0_4px_-1px_rgba(0,0,0,0.06)] dark:shadow-[2px_0_4px_-1px_rgba(0,0,0,0.4)] ${
                          isEditingRow ? 'bg-amber-50 dark:bg-slate-900' : 'bg-white dark:bg-slate-900 group-hover:bg-slate-100/80 dark:group-hover:bg-slate-800/80'
                        }`}>
                          <button
                            type="button"
                            onClick={() => {
                              setDetailTab('payslip');
                              setDetailUserId(row.profile.id);
                            }}
                            title="Xem phiếu lương & cơ chế"
                            className="flex w-full min-w-0 items-center justify-between gap-1 text-left"
                          >
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1">
                                <p className="truncate text-xs font-black text-slate-900 dark:text-slate-100 group-hover:text-indigo-700 dark:group-hover:text-indigo-400" title={row.profile.name}>{row.profile.name}</p>
                                {isEditingRow && (
                                  <span className="shrink-0 rounded bg-amber-200 dark:bg-amber-900/80 px-1 py-0.2 text-[9px] font-black text-amber-800 dark:text-amber-200 uppercase">
                                    Sửa
                                  </span>
                                )}
                              </div>
                            </div>
                            {flags.length > 0 && (
                              <span title={flags.join('\n')} className="shrink-0">
                                <TriangleAlert className="h-3.5 w-3.5 text-amber-500" aria-label={flags.join('. ')} />
                              </span>
                            )}
                          </button>
                        </td>
                        <td className="px-1.5 py-1 border-l border-slate-300 dark:border-slate-700 text-center font-bold text-slate-900 dark:text-slate-100 text-xs">
                          {row.computed.stats.paidDays}
                          <span className="text-slate-500 dark:text-slate-400 font-medium">/{row.computed.standardDays}</span>
                        </td>
                        {columns.map((column) => {
                          const amount = amountOf(row, column.code);
                          const userId = row.profile.id;
                          const monthly = canEnter && !closed && (neededByPerson.get(userId)?.has(column.code) ?? false);
                          const changed = adjustmentByCell.get(`${userId}|${column.code.toUpperCase()}`);
                          const empty = monthly && inputValueOf(userId, column.code) === '';
                          const inDragRange = monthly && !isEditingRow && !!fillDrag && fillDrag.code === column.code
                            && rowIndex >= Math.min(fillDrag.startRow, fillDrag.endRow) && rowIndex <= Math.max(fillDrag.startRow, fillDrag.endRow);
                          const showFillHandle = monthly && !isEditingRow && (inDragRange || (!fillDrag && hoverCell?.userId === userId && hoverCell.code === column.code));
                          const cellClass = 'h-7 w-full min-w-[4.6rem] border bg-transparent px-1 text-center text-xs tabular-nums text-slate-900 dark:text-slate-100 font-bold focus:bg-white dark:focus:bg-slate-800 focus:outline-none';

                          if (isEditingRow) {
                            const draftVal = rowDraftValues[column.code] ?? '';
                            const currentAmt = amount ?? 0;
                            const typedAmt = parseQuantity(draftVal);
                            const hasChanged = draftVal !== '' && Math.abs(typedAmt - currentAmt) >= 0.01;
                            const delta = Math.round((typedAmt - currentAmt) * 100) / 100;
                            return (
                              <td
                                key={column.code}
                                className={`px-1 py-0.5 border-l border-slate-300 dark:border-slate-700 text-center ${
                                  hasChanged
                                    ? 'bg-amber-100/70 dark:bg-amber-950/40'
                                    : 'bg-amber-50/30 dark:bg-amber-950/20'
                                }`}
                              >
                                <div className="relative py-0.5">
                                  <input
                                    type="text"
                                    inputMode="decimal"
                                    value={draftVal}
                                    onChange={(event) => {
                                      const val = event.target.value.replace(/[^\d.,]/g, '');
                                      setRowDraftValues((prev) => ({
                                        ...prev,
                                        [column.code]: val,
                                      }));
                                    }}
                                    onFocus={(event) => event.currentTarget.select()}
                                    onKeyDown={(event) => {
                                      if (event.key === 'Enter') {
                                        event.preventDefault();
                                        const inputs = Array.from(document.querySelectorAll<HTMLInputElement>(`input[data-row-edit="${userId}"]`));
                                        const idx = inputs.indexOf(event.currentTarget);
                                        if (idx >= 0 && idx < inputs.length - 1) {
                                          inputs[idx + 1].focus();
                                        } else {
                                          handleSaveRowEdits(row);
                                        }
                                      } else if (event.key === 'Escape') {
                                        event.preventDefault();
                                        cancelEditingRow();
                                      }
                                    }}
                                    data-row-edit={userId}
                                    data-col={column.code}
                                    placeholder="0"
                                    aria-label={`${column.name} của ${row.profile.name}`}
                                    className={`h-7 w-full min-w-[4.8rem] rounded border px-1 text-center text-xs tabular-nums font-bold focus:outline-none transition ${
                                      hasChanged
                                        ? 'border-[#bf1f2b] bg-rose-50/80 dark:bg-rose-950/60 text-[#5c0f16] dark:text-rose-100 focus:border-[#bf1f2b] focus:ring-1 focus:ring-[#bf1f2b]/40'
                                        : 'border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:border-[#bf1f2b] focus:ring-1 focus:ring-[#bf1f2b]/30'
                                    }`}
                                  />
                                  {hasChanged && (
                                    <span
                                      className="mt-0.5 block text-[10px] font-bold leading-tight tabular-nums text-slate-600 dark:text-slate-400 whitespace-nowrap"
                                      title={`Số cũ: ${formatFormulaNumber(currentAmt)}`}
                                    >
                                      cũ {formatFormulaNumber(currentAmt)}{' '}
                                      <span className={delta > 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-600 dark:text-rose-400'}>
                                        {delta > 0 ? '+' : '−'}{formatFormulaNumber(Math.abs(delta))}
                                      </span>
                                    </span>
                                  )}
                                </div>
                              </td>
                            );
                          }

                          return (
                            <td
                              key={column.code}
                              className={`px-1 border-l border-slate-300 dark:border-slate-700 text-center ${
                                monthly ? (empty ? 'bg-rose-50 dark:bg-rose-950/30 py-0.5' : inDragRange ? 'bg-indigo-50 dark:bg-indigo-950/30 py-0.5' : 'bg-rose-50/40 dark:bg-rose-950/20 py-0.5') : 'py-0.5'}`}
                            >
                              {monthly ? (
                                <div
                                  className="relative"
                                  data-fill-col={column.code}
                                  data-fill-row={rowIndex}
                                  onMouseEnter={() => { if (!fillDrag) setHoverCell({ userId, code: column.code }); }}
                                  onMouseLeave={() => setHoverCell((current) => (current?.userId === userId && current.code === column.code ? null : current))}
                                >
                                  <input
                                    type="text"
                                    inputMode="decimal"
                                    data-col={column.code}
                                    value={inputValueOf(userId, column.code)}
                                    onChange={(event) => setEdits((current) => ({
                                      ...current,
                                      [`${userId}|${column.code}`]: event.target.value.replace(/[^\d.,]/g, ''),
                                    }))}
                                    onFocus={(event) => event.currentTarget.select()}
                                    onKeyDown={(event) => moveInColumn(event)}
                                    placeholder="Chưa nhập"
                                    aria-label={`${column.name} của ${row.profile.name}`}
                                    className={`${cellClass} focus:border-[#bf1f2b] ${empty
                                      ? 'border-red-400 dark:border-red-500/80 placeholder:font-normal placeholder:text-slate-400 dark:placeholder:text-slate-500'
                                      : 'border-[#eed5d8] dark:border-[#4a1c22] placeholder:text-slate-400 dark:placeholder:text-slate-500 hover:border-[#bf1f2b]/60'}`}
                                  />
                                  {showFillHandle && (
                                    <div
                                      role="presentation"
                                      title="Kéo xuống để điền cùng giá trị cho các dòng dưới"
                                      onMouseDown={(event) => {
                                        event.preventDefault();
                                        setHoverCell(null);
                                        setFillDrag({ code: column.code, value: inputValueOf(userId, column.code), startRow: rowIndex, endRow: rowIndex });
                                      }}
                                      className="absolute -bottom-px -right-px h-2 w-2 cursor-crosshair border border-white dark:border-slate-900 bg-[#bf1f2b]"
                                    />
                                  )}
                                </div>
                              ) : (
                                <div
                                  role="button"
                                  tabIndex={0}
                                  onClick={() => setInspectCell({ row, column })}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter' || e.key === ' ') {
                                      e.preventDefault();
                                      setInspectCell({ row, column });
                                    }
                                  }}
                                  className="group/cell relative flex flex-col items-center justify-center min-h-[26px] min-w-[76px] max-w-[110px] px-1 py-0.5 rounded transition-colors select-none cursor-pointer hover:bg-rose-50/80 dark:hover:bg-slate-800 hover:text-slate-950 dark:hover:text-rose-200"
                                  title={closed ? `Bấm để xem công thức "${column.name}" (chỉ xem)` : `Bấm để xem giá trị & chỉnh sửa công thức "${column.name}"`}
                                >
                                  <span className="font-bold text-xs text-slate-900 dark:text-slate-100">
                                    {amount == null ? <span className="text-slate-400 dark:text-slate-500 font-normal">—</span> : formatFormulaNumber(amount)}
                                  </span>
                                  {changed && changed.delta !== 0 && amount != null && (
                                    <span
                                      className="mt-0.5 block text-[10px] font-bold leading-tight tabular-nums text-slate-600 dark:text-slate-400"
                                      title={changed.reasons.join('\n')}
                                    >
                                      cũ {formatFormulaNumber(amount - changed.delta)}{' '}
                                      <span className={changed.delta > 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-600 dark:text-rose-400'}>
                                        {changed.delta > 0 ? '+' : '−'}{formatFormulaNumber(Math.abs(changed.delta))}
                                      </span>
                                    </span>
                                  )}
                                </div>
                              )}
                            </td>
                          );
                        })}
                        {(() => {
                          let gross = row.computed.gross;
                          let deductions = row.computed.totalDeductions;
                          if (isEditingRow) {
                            for (const col of columns) {
                              if (rowDraftValues[col.code] !== undefined) {
                                const orig = amountOf(row, col.code) ?? 0;
                                const typed = parseQuantity(rowDraftValues[col.code]);
                                const diff = typed - orig;
                                if (col.kind === 'EARNING') gross += diff;
                                else if (col.kind === 'DEDUCTION') deductions += diff;
                              }
                            }
                            deductions = Math.max(0, deductions);
                          }
                          const netPay = Math.max(0, gross - deductions);
                          const grossChanged = isEditingRow && Math.abs(gross - row.computed.gross) >= 0.01;
                          const dedChanged = isEditingRow && Math.abs(deductions - row.computed.totalDeductions) >= 0.01;
                          const netChanged = isEditingRow && Math.abs(netPay - row.computed.netPay) >= 0.01;

                          return (
                            <>
                              <td className={`px-1.5 py-1 min-w-[80px] max-w-[100px] border-l-2 border-slate-400 dark:border-slate-600 text-center font-black text-xs ${
                                grossChanged ? 'bg-rose-100/70 text-rose-950 dark:bg-rose-950/50 dark:text-rose-200' : 'text-slate-900 dark:text-slate-100 bg-slate-50/60 dark:bg-slate-800/40'
                              }`}>
                                {formatFormulaNumber(gross)}
                                {grossChanged && (
                                  <span className="block text-[10px] font-bold text-slate-500 dark:text-slate-400">
                                    cũ {formatFormulaNumber(row.computed.gross)}
                                  </span>
                                )}
                              </td>
                              <td className={`px-1.5 py-1 min-w-[80px] max-w-[100px] border-l border-slate-300 dark:border-slate-700 text-center font-black text-xs ${
                                dedChanged ? 'bg-rose-100/70 text-rose-800 dark:bg-rose-950/50 dark:text-rose-200' : 'text-rose-700 dark:text-rose-400 bg-rose-50/30 dark:bg-rose-950/20'
                              }`}>
                                {deductions ? `−${formatFormulaNumber(deductions)}` : '—'}
                                {dedChanged && (
                                  <span className="block text-[10px] font-bold text-slate-500 dark:text-slate-400">
                                    cũ {formatFormulaNumber(row.computed.totalDeductions)}
                                  </span>
                                )}
                              </td>
                              <td className={`px-2 py-1 min-w-[85px] max-w-[110px] border-l-2 border-slate-400 dark:border-slate-600 text-center font-black text-xs ${
                                netChanged ? 'bg-emerald-100 text-emerald-950 dark:bg-emerald-950/70 dark:text-emerald-200' : 'text-emerald-950 dark:text-emerald-300 bg-emerald-50/50 dark:bg-emerald-950/30'
                              }`}>
                                {formatFormulaNumber(netPay)}
                                {netChanged && (
                                  <span className="block text-[10px] font-bold text-slate-500 dark:text-slate-400">
                                    cũ {formatFormulaNumber(row.computed.netPay)}
                                  </span>
                                )}
                              </td>
                            </>
                          );
                        })()}
                        <td className="px-1 py-1 border-l border-slate-300 dark:border-slate-700 text-center no-print min-w-[72px]">
                          {isEditingRow ? (
                            <div className="flex items-center justify-center gap-1">
                              <button
                                type="button"
                                onClick={(event) => { event.stopPropagation(); handleSaveRowEdits(row); }}
                                className="inline-flex h-6 w-6 items-center justify-center rounded bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs transition"
                                title="Lưu các thay đổi của hàng này"
                                aria-label="Lưu các thay đổi"
                              >
                                <Check className="h-3.5 w-3.5 stroke-[2.5]" />
                              </button>
                              <button
                                type="button"
                                onClick={(event) => { event.stopPropagation(); cancelEditingRow(); }}
                                className="inline-flex h-6 w-6 items-center justify-center rounded bg-slate-200 hover:bg-rose-100 text-slate-700 hover:text-rose-700 dark:bg-slate-700 dark:hover:bg-rose-950/60 dark:text-slate-300 dark:hover:text-rose-300 shadow-xs transition"
                                title="Hủy bỏ chỉnh sửa"
                                aria-label="Hủy bỏ chỉnh sửa"
                              >
                                <X className="h-3.5 w-3.5 stroke-[2.5]" />
                              </button>
                            </div>
                          ) : (
                            canAdjust && (
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  if (closed) {
                                    setAdjustUserId(row.profile.id);
                                  } else {
                                    startEditingRow(row);
                                  }
                                }}
                                className="inline-flex h-6 w-6 items-center justify-center rounded text-slate-500 dark:text-slate-400 transition-colors hover:bg-rose-50 dark:hover:bg-slate-800 hover:text-rose-600 dark:hover:text-rose-400"
                                title={closed ? 'Xem điều chỉnh lương (chỉ xem)' : 'Mở chỉnh sửa tất cả đầu lương hàng này'}
                                aria-label={`Chỉnh sửa lương của ${row.profile.name}`}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                            )
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="sticky bottom-0 z-20 bg-slate-100 dark:bg-slate-900 font-bold text-slate-900 dark:text-slate-100 border-t-2 border-slate-400 dark:border-slate-600 shadow-[0_-3px_6px_rgba(0,0,0,0.06)] dark:shadow-[0_-3px_6px_rgba(0,0,0,0.4)]">
                  <tr>
                    <td className="sticky left-0 z-10 shadow-[inset_0_2px_0_#94a3b8] dark:shadow-[inset_0_2px_0_#475569] w-[46px] min-w-[46px] max-w-[46px] bg-slate-100 dark:bg-slate-900 px-1 py-1.5 text-center text-xs font-black uppercase text-slate-500 dark:text-slate-400 border-r border-slate-300 dark:border-slate-700" />
                    <td className="sticky left-[46px] z-10 shadow-[inset_0_2px_0_#94a3b8] dark:shadow-[inset_0_2px_0_#475569] w-[84px] min-w-[84px] max-w-[84px] bg-slate-100 dark:bg-slate-900 px-1.5 py-1.5 text-center text-xs font-black uppercase text-slate-500 dark:text-slate-400 border-r border-slate-300 dark:border-slate-700" />
                    <td className="sticky left-[130px] z-10 shadow-[inset_0_2px_0_#94a3b8] dark:shadow-[inset_0_2px_0_#475569] w-[150px] min-w-[150px] max-w-[150px] bg-slate-100 dark:bg-slate-900 px-2.5 py-1.5 text-left text-xs font-black uppercase tracking-wider text-slate-900 dark:text-slate-100 border-r-2 border-slate-400 dark:border-slate-600">
                      Tổng ({filtered.length} người)
                    </td>
                    <td className="bg-slate-100 dark:bg-slate-900 shadow-[inset_0_2px_0_#94a3b8] dark:shadow-[inset_0_2px_0_#475569] border-l border-slate-300 dark:border-slate-700" />
                    {columns.map((column) => (
                      <td key={column.code} className="bg-slate-100 dark:bg-slate-900 shadow-[inset_0_2px_0_#94a3b8] dark:shadow-[inset_0_2px_0_#475569] px-1.5 py-1.5 border-l border-slate-300 dark:border-slate-700 text-center font-black text-slate-900 dark:text-slate-100 text-xs">
                        {column.kind === 'INFO' ? '' : formatFormulaNumber(sum((row) => amountOf(row, column.code) ?? 0))}
                      </td>
                    ))}
                    <td className="bg-slate-200/80 dark:bg-slate-800 shadow-[inset_0_2px_0_#94a3b8] dark:shadow-[inset_0_2px_0_#475569] px-1.5 py-1.5 border-l-2 border-slate-400 dark:border-slate-600 text-center font-black text-slate-900 dark:text-slate-100 text-xs">
                      {formatFormulaNumber(totals.gross)}
                    </td>
                    <td className="bg-rose-100/70 dark:bg-rose-950/50 shadow-[inset_0_2px_0_#94a3b8] dark:shadow-[inset_0_2px_0_#475569] px-1.5 py-1.5 border-l border-slate-300 dark:border-slate-700 text-center font-black text-rose-800 dark:text-rose-300 text-xs">
                      −{formatFormulaNumber(totals.deductions)}
                    </td>
                    <td className="bg-emerald-100/90 dark:bg-emerald-950/70 shadow-[inset_0_2px_0_#94a3b8] dark:shadow-[inset_0_2px_0_#475569] px-2 py-1.5 border-l-2 border-slate-400 dark:border-slate-600 text-center font-black text-emerald-950 dark:text-emerald-200 text-xs">
                      {formatFormulaNumber(totals.net)}
                    </td>
                    <td className="bg-slate-100 dark:bg-slate-900 shadow-[inset_0_2px_0_#94a3b8] dark:shadow-[inset_0_2px_0_#475569] border-l border-slate-300 dark:border-slate-700 no-print min-w-[72px] w-[72px]" />
                  </tr>
                </tfoot>
              </table>
            </div>
            </div>
          )}
          {pageCount > 1 && (
            <div className="flex items-center justify-between border-t border-slate-300 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-900 px-4 py-2.5 text-xs font-semibold text-slate-600 dark:text-slate-400 no-print">
              <span>Trang {currentPage + 1}/{pageCount}</span>
              <div className="flex gap-2">
                <Button size="xs" square variant="outline" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)} className="!min-h-0 !h-8 px-2.5 text-xs">Trước</Button>
                <Button size="xs" square variant="outline" disabled={currentPage >= pageCount - 1} onClick={() => setPage(currentPage + 1)} className="!min-h-0 !h-8 px-2.5 text-xs">Sau</Button>
              </div>
            </div>
          )}
      </TableShell>
      </FullscreenPanel>

      {data.runEvents.length > 0 && (
        <details className="rounded-none border border-slate-200 bg-white px-4 py-3">
          <summary className="flex cursor-pointer items-center gap-2 text-sm font-bold text-slate-700">
            <History className="h-4 w-4 text-slate-400" /> Lịch sử kỳ lương ({data.runEvents.length})
          </summary>
          <div className="mt-3"><Timeline rows={data.runEvents} nameOf={nameOf} /></div>
        </details>
      )}

      {!closed && dirtyCount > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-[46] border-t border-slate-200 bg-white/95 px-4 py-3 shadow-lg backdrop-blur-md print:hidden">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 lg:pl-64">
            <p className="flex items-center gap-1.5 text-sm text-slate-600">
              <Save className="h-4 w-4" /> {dirtyCount} ô số liệu tháng chưa lưu
            </p>
            <div className="flex gap-2">
              <Button size="xs" square variant="secondary" onClick={() => setEdits({})} disabled={savingInputs} className="!min-h-0 !h-8 px-3 text-xs">Huỷ thay đổi</Button>
              <Button size="xs" square onClick={() => void handleSaveInputs()} disabled={savingInputs} className="!min-h-0 !h-8 px-3 text-xs">
                <Save className="h-3.5 w-3.5" /> {savingInputs ? 'Đang lưu…' : `Lưu ${dirtyCount} thay đổi`}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* --- Hộp thoại --- */}
      <Modal square open={checkOpen} onClose={() => setCheckOpen(false)} title="Kiểm tra trước khi khoá kỳ" size="lg">
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

      <Modal
        square
        open={warningsOpen}
        onClose={() => setWarningsOpen(false)}
        title="Cảnh báo kỳ lương"
        size="lg"
      >
        <div className="space-y-4">
          {setupGaps.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 border border-amber-300 dark:border-amber-700/60 bg-amber-50 dark:bg-amber-950/40 p-3.5 text-xs text-amber-900 dark:text-amber-200">
              <div className="flex items-start gap-2.5">
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                <div>
                  <p className="font-bold">
                    {setupGaps.length} người chưa thiết lập xong lương
                  </p>
                  <ul className="mt-1 space-y-0.5 text-amber-800 dark:text-amber-300">
                    {setupGaps.slice(0, 8).map((gap) => {
                      const blanks = blankMechanismRows(gap.mechanismRows ?? []).map((item) => item.component.name);
                      return (
                        <li key={gap.profile.id}>
                          <strong>{gap.profile.name}</strong>: {gap.hasScheme ? `còn trống ${blanks.join(', ')}` : 'chưa có cơ chế — phiếu ra 0đ'}
                        </li>
                      );
                    })}
                    {setupGaps.length > 8 && <li>… và {setupGaps.length - 8} người khác.</li>}
                  </ul>
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="shrink-0 border-amber-300 dark:border-amber-700 bg-white dark:bg-slate-800 text-amber-900 dark:text-amber-200 hover:bg-amber-100/60"
                onClick={() => {
                  setWarningsOpen(false);
                  navigate(`/admin/payroll/setup/schemes?month=${monthStartStr.slice(0, 7)}`);
                }}
              >
                Xem ở Thiết lập lương
              </Button>
            </div>
          )}

          {canManage && !closed && missingInputCount > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 border border-amber-300 dark:border-amber-700/60 bg-amber-50 dark:bg-amber-950/40 p-3.5 text-xs text-amber-900 dark:text-amber-200">
              <div className="flex items-start gap-2.5">
                <SlidersHorizontal className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                <div>
                  <p className="font-bold">
                    Còn {missingInputCount} ô số liệu theo tháng chưa nhập
                  </p>
                  <p className="mt-0.5 text-amber-800 dark:text-amber-300">
                    Nhập đủ mới tính được lương chính xác.
                  </p>
                </div>
              </div>
              {canEnter && (
                <Button
                  size="sm"
                  variant="outline"
                  className="shrink-0 border-amber-300 dark:border-amber-700 bg-white dark:bg-slate-800 text-amber-900 dark:text-amber-200 hover:bg-amber-100/60"
                  onClick={() => {
                    setWarningsOpen(false);
                    setInputMode(true);
                    setPage(0);
                  }}
                >
                  Nhập số liệu tháng
                </Button>
              )}
            </div>
          )}

          {allWarnings.length > 0 && (
            <div className="space-y-2 pt-1">
              <p className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Chi tiết các cảnh báo ({allWarnings.length})
              </p>
              <ul className="max-h-[50vh] space-y-2 overflow-y-auto pr-1">
                {allWarnings.map((warning) => (
                  <li key={warning} className="flex items-start gap-2 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
                    <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" /> {warning}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
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

      <Modal square open={withdrawOpen} onClose={() => setWithdrawOpen(false)} title="Rút kỳ lương về để sửa" size="md">
        <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void handleWithdraw(); }}>
          <p className="text-sm text-slate-600">Kỳ sẽ về trạng thái <strong>Đã tính</strong>; sửa xong phải tính lại và khoá lại bằng 2FA.</p>
          <Textarea className="!rounded-none"
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
          signOff={signOffOf()}
          rows={payableRows.map((row) => ({ profile: row.profile, net: row.computed.netPay }))}
          onClose={() => setBankOpen(false)}
          onExported={onChanged}
        />
      )}

      <Modal
        square
        open={!!detailRow}
        onClose={() => setDetailUserId(null)}
        title={`Chi tiết nhân sự: ${detailRow?.profile.name ?? ''} — ${monthLabel}`}
        size="2xl"
      >
        {detailRow && (() => {
          const layout = resolvePayslipLayout(detailRow.profile.unit_id, data.units, data.payslipLayouts, data.components);
          return (
            <div className="space-y-4">
              <div className="flex border-b border-slate-200 no-print">
                <button
                  type="button"
                  onClick={() => setDetailTab('payslip')}
                  className={`flex items-center gap-2 px-4 py-2.5 text-sm font-semibold border-b-2 transition -mb-px ${
                    detailTab === 'payslip'
                      ? 'border-indigo-600 text-indigo-700'
                      : 'border-transparent text-slate-500 hover:text-slate-800'
                  }`}
                >
                  <FileSpreadsheet className="h-4 w-4" /> Phiếu lương
                </button>
                <button
                  type="button"
                  onClick={() => setDetailTab('scheme')}
                  className={`flex items-center gap-2 px-4 py-2.5 text-sm font-semibold border-b-2 transition -mb-px ${
                    detailTab === 'scheme'
                      ? 'border-indigo-600 text-indigo-700'
                      : 'border-transparent text-slate-500 hover:text-slate-800'
                  }`}
                >
                  <SlidersHorizontal className="h-4 w-4" /> Cơ chế lương
                </button>
              </div>

              {detailTab === 'payslip' ? (
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
                    paper={{
                      lines: documentLinesFromCatalog(detailRow.computed.lines, data.components, data.categories, layout),
                      monthLabel,
                      employeeName: detailRow.profile.name,
                      employeeCode: detailRow.profile.employee_code,
                      unitName: data.units.find((unit) => unit.id === detailRow.profile.unit_id)?.name ?? detailRow.profile.department,
                      standardDays: detailRow.computed.standardDays,
                      layout,
                    }}
                  />
                </div>
              ) : (
                <div className="space-y-3">
                  <PersonSchemeForm
                    person={detailRow.profile}
                    data={data}
                    monthStart={monthStartStr}
                    lastClosedMonth={data.readiness?.lastClosedMonth ?? null}
                    canManage={!closed && (canOpenSchemes || canManage)}
                    account={accounts.find((a) => a.user_id === detailRow.profile.id) ?? null}
                    unitName={unitNames.get(detailRow.profile.unit_id ?? '') ?? detailRow.profile.department ?? null}
                    onSaved={() => {
                      onChanged();
                      toast(`Đã lưu cơ chế lương của ${detailRow.profile.name}.`, 'success');
                    }}
                    onAccountSaved={reloadAccounts}
                    onOpenInputs={() => {
                      setDetailUserId(null);
                      setInputMode(true);
                    }}
                    onDryRun={() => {}}
                  />
                </div>
              )}
            </div>
          );
        })()}
      </Modal>

      <RowAdjustmentConfirmModal
        open={!!confirmAdjustmentState}
        row={confirmAdjustmentState?.row ?? null}
        items={confirmAdjustmentState?.items ?? []}
        monthStartStr={monthStartStr}
        monthLabel={monthLabel}
        actorId={profile?.id ?? null}
        existingAdjustments={
          confirmAdjustmentState
            ? data.adjustments.filter((a) => a.user_id === confirmAdjustmentState.row.profile.id)
            : []
        }
        onClose={() => setConfirmAdjustmentState(null)}
        onSuccess={() => {
          setConfirmAdjustmentState(null);
          cancelEditingRow();
          onChanged();
        }}
        onChanged={onChanged}
      />

      <PersonAdjustmentModal
        person={adjustRow?.profile ?? null}
        initialTarget={adjustPreset?.code ?? null}
        initialNewValue={adjustPreset?.newValue}
        lines={adjustRow?.computed.lines ?? []}
        mechanismRows={adjustRow?.mechanismRows}
        nameOf={adjustNameOf}
        components={data.components}
        adjustments={data.adjustments}
        monthStart={monthStartStr}
        monthLabel={monthLabel}
        actorId={profile?.id ?? null}
        readOnly={closed}
        onClose={closeAdjust}
        onChanged={onChanged}
      />

      <CellFormulaModal
        open={!!inspectCell}
        onClose={() => setInspectCell(null)}
        row={inspectCell?.row ?? null}
        column={inspectCell?.column ?? null}
        data={data}
        params={params}
        monthStartStr={monthStartStr}
        monthEndStr={monthEndStr}
        monthLabel={monthLabel}
        canManage={!closed && canManage}
        readOnly={closed}
        onChanged={onChanged}
      />

      <PayrollFilterModal
        open={filterModalOpen}
        onClose={() => setFilterModalOpen(false)}
        units={data.units}
        unitFilter={unitFilter}
        onUnitFilterChange={(val) => { setUnitFilter(val); setPersonFilter(''); setPage(0); }}
        hideIntermediate={hideIntermediate}
        onHideIntermediateChange={setHideIntermediate}
        columns={allAvailableColumns}
        hiddenColumnCodes={hiddenColumnCodes}
        onToggleColumn={handleToggleColumn}
        onSelectAll={handleSelectAllColumns}
        onDeselectAll={handleDeselectAllColumns}
        onReset={handleResetColumns}
        onSelectOnly={handleSelectOnlyColumns}
        onSelectGroup={handleSelectGroupColumns}
        onResetAll={handleResetAllFilters}
        categories={data.categories}
      />

      <PayrollOperationsModal
        open={operationsOpen}
        onClose={() => setOperationsOpen(false)}
        run={run}
        runStatus={runStatus}
        monthLabel={monthLabel}
        monthStartStr={monthStartStr}
        canManage={canManage}
        canApprove={canApprove}
        closed={closed}
        approved={approved}
        busy={busy}
        onChanged={onChanged}
        liveRowsCount={liveRows.length}
        missingInputCount={missingInputCount}
        canLock={canLock}
        unmetCount={unmetCount}
        blockingUnmet={blockingUnmet}
        checklist={checklist}
        allWarnings={allWarnings}
        setupGaps={setupGaps}
        lastEvent={lastEvent}
        runEvents={data.runEvents}
        onCalculate={handleCalculate}
        onOpenLock={() => setLockOpen(true)}
        onOpenWithdraw={() => setWithdrawOpen(true)}
        onOpenBank={() => setBankOpen(true)}
        onMarkPaid={handleMarkPaid}
        onExportJournal={() => handleExportJournal()}
        onPrintJournal={() => handleExportJournal('print')}
        exportOptions={exportOptions}
        signOff={signOffOf}
        nameOf={nameOf}
        sortedCount={sorted.length}
        filteredCount={filtered.length}
      />
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-none bg-slate-50 px-3 py-2.5">
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
    <div className={`flex items-start gap-2.5 rounded-none border px-4 py-3 text-sm leading-relaxed ${tones[tone]}`}>
      {icon}
      <span>{children}</span>
    </div>
  );
}
