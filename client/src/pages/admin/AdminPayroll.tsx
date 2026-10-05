// ============================================================================
// Bảng lương.
// ----------------------------------------------------------------------------
// Bản trước tính lương ngay trong render bằng một công thức cứng áp cho tất cả
// mọi người, và tính lại từ đầu mỗi lần mở trang — nên bảng lương tháng trước
// đổi theo cấu hình hôm nay. Bản này:
//
//   1. Lương gốc tính theo cơ chế riêng của từng người (tháng/giờ/ngày/khoán/
//      hoa hồng), các khoản cộng trừ chạy qua bộ máy ở `lib/payroll.ts`.
//   2. Kỳ lương có vòng đời DRAFT → CALCULATED → APPROVED → PAID. Duyệt xong
//      là số liệu đóng băng xuống `payslips`, không tính lại nữa.
//   3. Mỗi dòng tiền có câu giải thích, nên kế toán trả lời được câu hỏi
//      "sao tháng này ít hơn" mà không phải mở Excel.
// ============================================================================

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { endOfMonth, format, startOfMonth } from 'date-fns';
import {
  BookOpenCheck, Calculator, CheckCircle2, FileSpreadsheet, LockKeyhole, Pencil,
  RotateCcw, Search, ShieldAlert, TriangleAlert, Users, Wallet,
} from 'lucide-react';

/** Bo dau tieng Viet de o tim go "ha" van ra "Ha". */
const stripTone = (text: string) => text
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/đ/g, 'd').replace(/Đ/g, 'D')
  .toLowerCase().trim();
import { Card, CardContent } from '@/components/ui/Card';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { ErrorState } from '@/components/ui/ErrorState';
import { MonthNav } from '@/components/ui/MonthNav';
import { TableSkeleton } from '@/components/ui/Skeleton';
import { PaySchemeModal } from '@/components/payroll/PaySchemeModal';
import { ComponentCatalog } from '@/components/payroll/ComponentCatalog';
import { PayslipBreakdown } from '@/components/payroll/PayslipBreakdown';
import { MonthlyInputsTab } from '@/components/payroll/MonthlyInputsTab';
import { useToast } from '@/contexts/ToastContext';
import { useConfirm } from '@/contexts/ConfirmContext';
import { useAuth } from '@/contexts/AuthContext';
import { useAppSettings } from '@/contexts/SettingsContext';
import { useRealtimeSync } from '@/hooks/useRealtimeSync';
import { hasAdminFunction } from '@/lib/permissions';
import { formatVND, toDateString } from '@/lib/utils';
import {
  computePayslip, itemsForPeriod, mergeUnitAndEmployeeItems, payBasisLabel,
  payProfileForPeriod, splitOvertimeHours, summarisePeriod,
  type AssignedPayItem, type ComputedPayslip,
} from '@/lib/payroll';
import {
  ensurePayrollRun, loadPayrollWorkspace, persistPayslips, setRunStatus,
  type PayrollWorkspace,
} from '@/lib/payrollData';
import { DEFAULT_PAYROLL_SETTINGS, toPayrollParams } from '@/lib/payrollSettings';
import { supabase } from '@/lib/supabase';
import { EMPTY_SCHEDULES, monthStandardDays } from '@/lib/workSchedule';
import { buildPayrollJournal } from '@/lib/payrollJournal';
import { PayrollParamsTab } from '@/components/payroll/PayrollParamsTab';
import { AdjustmentsTab } from '@/components/payroll/AdjustmentsTab';
import { UnitPayItemsCard } from '@/components/payroll/UnitPayItemsCard';
import { BulkSchemeModal } from '@/components/payroll/BulkSchemeModal';
import type { Profile } from '@/types';

type Tab = 'register' | 'schemes' | 'inputs' | 'adjustments' | 'catalog' | 'params';

/**
 * Mỗi mục là một ROUTE riêng, đã hiện thành module con trên sidebar.
 *
 * Trang KHÔNG vẽ lại thanh tab: sidebar đang là thanh điều hướng duy nhất, vẽ
 * thêm một hàng tab y hệt chỉ làm người dùng phải đọc hai lần cùng một danh
 * sách rồi phân vân hai chỗ có khác nhau không.
 *
 * `monthScoped` quyết định có hiện bộ chọn tháng hay không. Danh mục khoản và
 * tham số lương dùng chung cho mọi kỳ — hiện "tháng 09/2026" ở đó sẽ khiến
 * người dùng tưởng mình đang sửa riêng cho tháng đó.
 */
const SECTION_META: Record<Tab, { title: string; hint: string; monthScoped: boolean }> = {
  register: {
    title: 'Bảng lương tháng',
    hint: 'Mỗi nhân sự tính theo cơ chế riêng: lương tháng, lương giờ, lương ngày, khoán sản phẩm hoặc hoa hồng doanh số.',
    monthScoped: true,
  },
  schemes: {
    title: 'Cơ chế lương',
    hint: 'Khai khoản cho cả đơn vị, rồi chỉ khai riêng cho người có mức khác mặt bằng chung.',
    monthScoped: true,
  },
  inputs: {
    title: 'Số liệu lương tháng',
    hint: 'Số liệu biến động từng tháng: sản lượng khoán, doanh số, thưởng đột xuất, khoản trừ.',
    monthScoped: true,
  },
  adjustments: {
    title: 'Điều chỉnh lương',
    hint: 'Truy lĩnh và truy thu của kỳ trước, cộng/trừ vào kỳ đang mở và vẫn ghi rõ nguồn gốc từ tháng nào.',
    monthScoped: true,
  },
  catalog: {
    title: 'Danh mục khoản lương',
    hint: 'Liệt kê các khoản lương dùng trong công ty kèm ghi chú để đơn vị và nhân sự chọn đúng.',
    monthScoped: false,
  },
  params: {
    title: 'Tham số lương',
    hint: 'Ngày công chuẩn, tỷ lệ bảo hiểm và biểu thuế dùng chung cho toàn hệ thống.',
    monthScoped: false,
  },
};

const RUN_STATUS_LABEL = {
  DRAFT: 'Bản nháp',
  CALCULATED: 'Đã tính',
  APPROVED: 'Đã duyệt',
  PAID: 'Đã chi trả',
} as const;

interface PayrollRow {
  profile: Profile;
  computed: ComputedPayslip;
  hasScheme: boolean;
  /** Đọc từ phiếu đã đóng băng thay vì tính lại. */
  frozen: boolean;
}

export function AdminPayroll({ section = 'register' }: { section?: Tab } = {}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const { profile } = useAuth();
  const { toast } = useToast();
  const confirm = useConfirm();
  const settings = useAppSettings();

  const [monthStart, setMonthStart] = useState(() => startOfMonth(new Date()));
  const [unitNames, setUnitNames] = useState<Map<string, string>>(new Map());
  const [bulkTargets, setBulkTargets] = useState<Profile[] | null>(null);
  const tab = section;
  const meta = SECTION_META[tab];

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!supabase) return;
      const { data, error } = await supabase.from('organization_units').select('id, name');
      if (cancelled || error || !data) return;
      setUnitNames(new Map(data.map((unit: { id: string; name: string }) => [unit.id, unit.name])));
    })();
    return () => { cancelled = true; };
  }, []);
  const [data, setData] = useState<PayrollWorkspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [schemeTarget, setSchemeTarget] = useState<Profile | null>(null);
  const [rowQuery, setRowQuery] = useState('');
  /** Phòng đang mở ở khối trên — danh sách "chưa thiết lập" bám theo. */
  const [focusedUnitId, setFocusedUnitId] = useState<string | null>(null);
  const [detailUserId, setDetailUserId] = useState<string | null>(null);

  const monthStartStr = toDateString(monthStart);
  const monthEndStr = toDateString(endOfMonth(monthStart));
  const monthLabel = format(monthStart, 'MM/yyyy');
  const canView = hasAdminFunction(profile, 'admin.payroll');

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
      { table: 'employee_pay_profiles' }, { table: 'employee_pay_items' },
      { table: 'payroll_components' }, { table: 'payroll_inputs' }, { table: 'payroll_runs' },
    ],
    () => loadData(true),
    { enabled: canView, channelKey: 'payroll' },
  );

  // Tham số tính lương lấy từ `payroll_settings` (module lương, chỉ Admin/CEO
  // ghi được), ghép thêm giờ chuẩn mỗi ngày từ cấu hình hệ thống — con số đó
  // dùng chung với Bảng công nên vẫn thuộc về cấu hình.
  // Công chuẩn ưu tiên LỊCH LÀM VIỆC (P02: T8/2026 ra 23,5 công) thay cho con
  // số cố định trong tham số lương. Chưa khai ca thì giữ nguyên cách cũ.
  const calendarStandardDays = useMemo(
    () => monthStandardDays(data?.schedules ?? EMPTY_SCHEDULES, monthStart, data?.holidays ?? []),
    [data?.schedules, data?.holidays, monthStartStr], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const params = useMemo(
    () => {
      const base = toPayrollParams(
        data?.payrollSettings ?? DEFAULT_PAYROLL_SETTINGS,
        settings,
        data?.pitBrackets,
      );
      return calendarStandardDays == null
        ? base
        : { ...base, standardWorkDays: calendarStandardDays };
    },
    [data?.payrollSettings, settings, calendarStandardDays],
  );

  // --------------------------------------------------------------------------
  // Tính bảng lương
  // --------------------------------------------------------------------------
  const rows: PayrollRow[] = useMemo(() => {
    if (!data) return [];

    const componentById = new Map(data.components.map((component) => [component.id, component]));
    // Kỳ đã duyệt thì hiển thị đúng con số đã chốt, KHÔNG tính lại. Đây là
    // điểm khác căn bản so với bản cũ: lương đã trả không đổi theo cấu hình.
    const frozen = data.run?.status === 'APPROVED' || data.run?.status === 'PAID';

    if (frozen && data.payslips.length > 0) {
      const linesBySlip = new Map<string, typeof data.payslipLines>();
      for (const line of data.payslipLines) {
        const list = linesBySlip.get(line.payslip_id) ?? [];
        list.push(line);
        linesBySlip.set(line.payslip_id, list);
      }

      return data.payslips.map((slip) => {
        const owner = data.profiles.find((item) => item.id === slip.user_id);
        const lines = (linesBySlip.get(slip.id) ?? []).map((line) => ({
          code: line.code, name: line.name, kind: line.kind,
          quantity: line.quantity, rate: line.rate, amount: Number(line.amount),
          taxable: line.taxable, insurable: line.insurable, detail: line.detail ?? '',
        }));

        return {
          profile: owner ?? ({ id: slip.user_id, name: slip.employee_name, department: slip.department } as Profile),
          hasScheme: true,
          frozen: true,
          computed: {
            payBasis: slip.pay_basis,
            stats: {
              workDays: Number(slip.work_days), leaveDays: Number(slip.leave_days),
              // payslips (kỳ đã đóng băng) chưa có cột holiday_days riêng —
              // dòng "Lương nghỉ lễ" thật vẫn nằm đúng trong payslip_lines ở
              // trên, chỗ này chỉ là số tổng hợp hiển thị đầu phiếu.
              holidayDays: 0,
              paidDays: Number(slip.paid_days), workHours: Number(slip.work_hours), missingCheckout: 0,
              // Phiếu đã chốt không lưu chỉ số chuyên cần riêng — tiền phạt đi
              // muộn (nếu có) đã nằm thành dòng trong payslip_lines rồi. Để 0
              // ở đây chỉ nghĩa là "không hiển thị lại", không phải "không có".
              lateMinutes: 0, lateCount: 0, lateAfterCutoffCount: 0,
              earlyMinutes: 0, earlyCount: 0,
            },
            standardDays: Number(slip.standard_days),
            hourlyRate: 0,
            insuranceBase: 0,
            lines,
            gross: Number(slip.gross_pay),
            taxableIncome: Number(slip.taxable_income),
            insuranceEmployee: Number(slip.insurance_employee),
            insuranceEmployer: Number(slip.insurance_employer),
            personalIncomeTax: Number(slip.personal_income_tax),
            taxSteps: [],
            otherDeductions: Number(slip.other_deductions),
            netPay: Number(slip.net_pay),
            snapshot: slip.snapshot,
            warnings: [],
          },
        };
      });
    }

    return data.profiles.map((person) => {
      const payProfile = payProfileForPeriod(
        data.payProfiles.filter((item) => item.user_id === person.id),
        monthEndStr,
      );

      // Khoản của ĐƠN VỊ người này thuộc về, cộng khoản gán riêng cho họ.
      // Bản riêng ghi đè bản của đơn vị nếu trùng khoản — xem
      // `mergeUnitAndEmployeeItems`.
      const toAssigned = (rows: Array<{ component_id: string }>): AssignedPayItem[] =>
        rows
          .map((item) => ({ item, component: componentById.get(item.component_id) }))
          .filter((entry): entry is AssignedPayItem => !!entry.component);

      const unitAssigned = person.unit_id
        ? toAssigned(data.unitItems.filter((item) => item.unit_id === person.unit_id))
        : [];
      const ownAssigned = toAssigned(data.items.filter((item) => item.user_id === person.id));

      const assigned = mergeUnitAndEmployeeItems(
        itemsForPeriod(unitAssigned, monthStartStr, monthEndStr),
        itemsForPeriod(ownAssigned, monthStartStr, monthEndStr),
      );

      const inputs: Record<string, number> = {};
      for (const input of data.inputs) {
        if (input.user_id === person.id) inputs[input.code] = Number(input.quantity);
      }

      const approvedRequests = data.attendanceRequests.filter((request) => request.user_id === person.id);
      const lateDates = new Set(
        approvedRequests.filter((request) => request.request_type === 'LATE_ARRIVAL').map((request) => request.work_date),
      );
      const earlyDates = new Set(
        approvedRequests.filter((request) => request.request_type === 'EARLY_LEAVE').map((request) => request.work_date),
      );

      // Đơn OT đã duyệt tự chảy vào ba biến chuẩn. Số kế toán nhập tay vẫn
      // được ưu tiên để họ có thể điều chỉnh khi cần đối soát.
      const ot = splitOvertimeHours(approvedRequests, data.schedules, new Set(data.holidays));
      if (inputs.OT_WEEKDAY_HOURS == null && ot.weekday > 0) inputs.OT_WEEKDAY_HOURS = ot.weekday;
      if (inputs.OT_WEEKEND_HOURS == null && ot.weekend > 0) inputs.OT_WEEKEND_HOURS = ot.weekend;
      if (inputs.OT_HOLIDAY_HOURS == null && ot.holiday > 0) inputs.OT_HOLIDAY_HOURS = ot.holiday;

      const stats = summarisePeriod(
        data.attendance.filter((record) => record.user_id === person.id),
        data.leaves.filter((leave) => leave.user_id === person.id),
        monthStart,
        params.hoursPerDay,
        data.holidays,
        data.schedules,
        { lateDates, earlyDates },
      );

      return {
        profile: person,
        hasScheme: !!payProfile,
        frozen: false,
        computed: computePayslip({
          profile: person,
          payProfile,
          items: assigned,
          inputs,
          stats,
          settings: params,
          catalogCodes: data.components.map((component) => component.code),
          adjustments: data.adjustments.filter((adjustment) => adjustment.user_id === person.id),
        }),
      };
    });
  }, [data, monthStartStr, monthEndStr, settings]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedUserId = searchParams.get('user');
  /**
   * Lọc bảng lương theo tên hoặc mã nhân viên.
   *
   * Công ty ba chục người là đã phải cuộn cả trang để tìm một dòng, mà việc
   * hay làm nhất ở màn này lại là mở đúng phiếu của một người để đối chiếu.
   * Bỏ dấu luôn: gõ "ha" phải ra "Hà".
   */
  const keyword = stripTone(rowQuery);
  const visibleRows = selectedUserId
    ? rows.filter((row) => row.profile.id === selectedUserId)
    : keyword
      ? rows.filter((row) => stripTone(row.profile.name).includes(keyword)
        || stripTone(row.profile.employee_code || '').includes(keyword))
      : rows;

  const totals = useMemo(() => ({
    gross: visibleRows.reduce((sum, row) => sum + row.computed.gross, 0),
    insurance: visibleRows.reduce((sum, row) => sum + row.computed.insuranceEmployee, 0),
    tax: visibleRows.reduce((sum, row) => sum + row.computed.personalIncomeTax, 0),
    other: visibleRows.reduce((sum, row) => sum + row.computed.otherDeductions, 0),
    net: visibleRows.reduce((sum, row) => sum + row.computed.netPay, 0),
    employer: visibleRows.reduce((sum, row) => sum + row.computed.insuranceEmployer, 0),
  }), [visibleRows]);

  const allWarnings = useMemo(
    () => [...new Set(rows.flatMap((row) => row.computed.warnings))],
    [rows],
  );
  const missingSchemeCount = rows.filter((row) => !row.hasScheme && row.computed.stats.paidDays > 0).length;

  const runStatus = data?.run?.status ?? 'DRAFT';
  const isFrozen = runStatus === 'APPROVED' || runStatus === 'PAID';
  const detailRow = detailUserId ? rows.find((row) => row.profile.id === detailUserId) : null;

  // --------------------------------------------------------------------------
  // Vòng đời kỳ lương
  // --------------------------------------------------------------------------
  const handleCalculate = async () => {
    if (!data) return;
    setBusy(true);
    const { run, error } = await ensurePayrollRun(monthStartStr, profile?.id ?? null);
    if (error || !run) {
      setBusy(false);
      toast('Không tạo được kỳ lương: ' + (error ?? 'lỗi không rõ'), 'error');
      return;
    }

    const persistError = await persistPayslips(
      run,
      rows.filter((row) => row.hasScheme).map((row) => ({ profile: row.profile, computed: row.computed })),
    );
    if (persistError) {
      setBusy(false);
      toast('Ghi phiếu lương thất bại: ' + persistError, 'error');
      return;
    }

    if (run.status === 'DRAFT') {
      const statusError = await setRunStatus(run.id, 'CALCULATED', profile?.id ?? null);
      if (statusError) {
        setBusy(false);
        toast('Không chuyển được trạng thái kỳ: ' + statusError, 'error');
        return;
      }
    }

    setBusy(false);
    toast(`Đã tính và lưu ${rows.filter((row) => row.hasScheme).length} phiếu lương tháng ${monthLabel}.`, 'success');
    void loadData(true);
  };

  const handleApprove = async () => {
    if (!data?.run) return;
    const ok = await confirm({
      title: `Duyệt bảng lương tháng ${monthLabel}?`,
      message:
        `Tổng thực chi ${formatVND(totals.net)} cho ${visibleRows.length} nhân sự. ` +
        'Sau khi duyệt, số liệu đóng băng: đổi cấu hình hay chấm công cũng không làm đổi ' +
        'phiếu lương này nữa. Muốn sửa phải mở lại kỳ.',
      confirmLabel: 'Duyệt bảng lương',
    });
    if (!ok) return;

    setBusy(true);
    const error = await setRunStatus(data.run.id, 'APPROVED', profile?.id ?? null);
    setBusy(false);
    if (error) {
      toast('Duyệt thất bại: ' + error, 'error');
      return;
    }
    toast('Đã duyệt bảng lương. Nhân viên xem được phiếu của mình.', 'success');
    void loadData(true);
  };

  const handleMarkPaid = async () => {
    if (!data?.run) return;
    setBusy(true);
    const error = await setRunStatus(data.run.id, 'PAID', profile?.id ?? null);
    setBusy(false);
    if (error) {
      toast('Cập nhật thất bại: ' + error, 'error');
      return;
    }
    toast('Đã đánh dấu kỳ lương là đã chi trả.', 'success');
    void loadData(true);
  };

  const handleReopen = async () => {
    if (!data?.run) return;
    const ok = await confirm({
      title: `Mở lại kỳ lương tháng ${monthLabel}?`,
      message:
        'Phiếu lương hiện tại sẽ hết hiệu lực và nhân viên không xem được nữa cho tới khi ' +
        'bạn tính và duyệt lại. Chỉ làm khi thực sự cần sửa số liệu đã chốt.',
      confirmLabel: 'Mở lại kỳ',
      danger: true,
    });
    if (!ok) return;

    setBusy(true);
    const error = await setRunStatus(data.run.id, 'DRAFT', profile?.id ?? null);
    setBusy(false);
    if (error) {
      toast('Mở lại thất bại: ' + error, 'error');
      return;
    }
    toast('Đã mở lại kỳ lương.', 'success');
    void loadData(true);
  };

  // --------------------------------------------------------------------------
  /**
   * Bút toán kết chuyển lương (LU-14) — bước cuối của kỳ lương.
   *
   * Xuất bảng Nợ/Có theo chuẩn Thông tư 200 để kế toán nhập vào phần mềm.
   * KHÔNG sinh định dạng riêng của MISA vì đặc tả còn để ngỏ câu hỏi
   * "Định dạng/API chuyển sang MISA" — một file Excel đúng chuẩn hạch toán
   * thì phần mềm nào cũng nhận, còn đoán sai định dạng thì vô dụng.
   */
  const handleExportJournal = async () => {
    setExporting(true);
    try {
      const XLSX = await import('xlsx');
      const journal = buildPayrollJournal(
        visibleRows.map((row) => ({ profile: row.profile, computed: row.computed })),
        undefined,
        unitNames,
      );

      const sheet: (string | number)[][] = [
        [`BÚT TOÁN KẾT CHUYỂN LƯƠNG THÁNG ${monthLabel}`],
        [`Trạng thái kỳ: ${RUN_STATUS_LABEL[runStatus]}`],
        ['Tài khoản chi phí mặc định 642 (quản lý doanh nghiệp). Bộ phận sản xuất đổi sang 622, bán hàng 641 — kế toán tự chỉnh theo cơ cấu thực tế.'],
        [],
        ['Nhóm bút toán', 'Bộ phận', 'Nợ', 'Có', 'Số tiền', 'Diễn giải'],
        ...journal.entries.map((entry) => [
          entry.group, entry.department, entry.debit, entry.credit, entry.amount, entry.description,
        ]),
        [],
        ['', '', '', 'TỔNG PHÁT SINH', journal.totalDebit, journal.balanced ? 'Nợ = Có' : 'LỆCH — kiểm tra lại'],
        [],
        ['ĐỐI CHIẾU'],
        ['Tổng thu nhập (Có 334)', '', '', '', journal.totals.gross, ''],
        ['Bảo hiểm người lao động đóng', '', '', '', journal.totals.insuranceEmployee, ''],
        ['Thuế TNCN khấu trừ', '', '', '', journal.totals.personalIncomeTax, ''],
        ['Khấu trừ khác', '', '', '', journal.totals.otherDeductions, ''],
        ['THỰC CHI CHO NGƯỜI LAO ĐỘNG', '', '', '', journal.totals.netPay, ''],
        ['Bảo hiểm doanh nghiệp đóng thêm', '', '', '', journal.totals.insuranceEmployer, ''],
      ];

      const worksheet = XLSX.utils.aoa_to_sheet(sheet);
      worksheet['!cols'] = [{ wch: 30 }, { wch: 20 }, { wch: 8 }, { wch: 8 }, { wch: 16 }, { wch: 44 }];
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Bút toán lương');
      XLSX.writeFile(workbook, `but-toan-luong-${format(monthStart, 'yyyy-MM')}.xlsx`);
      toast(`Đã xuất bút toán kết chuyển tháng ${monthLabel}.`, 'success');
    } catch (error) {
      toast('Xuất bút toán thất bại: ' + (error instanceof Error ? error.message : String(error)), 'error');
    }
    setExporting(false);
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const XLSX = await import('xlsx');
      // Mỗi khoản một cột: kế toán đối chiếu được từng khoản thay vì chỉ thấy
      // ba con số tổng như bản cũ.
      const codes = [...new Set(
        visibleRows.flatMap((row) => row.computed.lines.map((line) => `${line.kind}|${line.code}|${line.name}`)),
      )];
      const earningCols = codes.filter((key) => key.startsWith('EARNING|'));
      const deductionCols = codes.filter((key) => key.startsWith('DEDUCTION|'));
      const nameOf = (key: string) => key.split('|')[2];

      const header = [
        'STT', 'Mã NV', 'Họ tên', 'Bộ phận', 'Cơ chế', 'Ngày công', 'Ngày phép', 'Giờ làm',
        ...earningCols.map(nameOf),
        'TỔNG THU NHẬP',
        ...deductionCols.map(nameOf),
        'TỔNG KHẤU TRỪ', 'THỰC NHẬN',
      ];

      const amountFor = (row: PayrollRow, key: string) => {
        const [, code] = key.split('|');
        return row.computed.lines.find((line) => line.code === code)?.amount ?? 0;
      };

      const sheet: (string | number)[][] = [
        [`BẢNG LƯƠNG THÁNG ${monthLabel}`],
        [`Trạng thái kỳ: ${RUN_STATUS_LABEL[runStatus]}${isFrozen ? ' (số liệu đã đóng băng)' : ' (bản xem trước)'}`],
        [
          `Bảo hiểm NLĐ: BHXH ${params.socialInsuranceRate}% + BHYT ${params.healthInsuranceRate}% + ` +
          `BHTN ${params.unemploymentInsuranceRate}%. Thuế TNCN lũy tiến 7 bậc, giảm trừ bản thân ` +
          `${formatVND(params.taxPersonalDeduction)}, mỗi người phụ thuộc ${formatVND(params.taxDependentDeduction)}.`,
        ],
        [],
        header,
        ...visibleRows.map((row, index) => [
          index + 1,
          row.profile.employee_code ?? '',
          row.profile.name,
          row.profile.department ?? '',
          payBasisLabel(row.computed.payBasis),
          row.computed.stats.workDays,
          row.computed.stats.leaveDays,
          row.computed.stats.workHours,
          ...earningCols.map((key) => amountFor(row, key)),
          row.computed.gross,
          ...deductionCols.map((key) => amountFor(row, key)),
          row.computed.insuranceEmployee + row.computed.personalIncomeTax + row.computed.otherDeductions,
          row.computed.netPay,
        ]),
        [],
        [
          '', '', 'TỔNG CỘNG', '', '', '', '', '',
          ...earningCols.map((key) => visibleRows.reduce((sum, row) => sum + amountFor(row, key), 0)),
          totals.gross,
          ...deductionCols.map((key) => visibleRows.reduce((sum, row) => sum + amountFor(row, key), 0)),
          totals.insurance + totals.tax + totals.other,
          totals.net,
        ],
        [],
        [`Chi phí bảo hiểm doanh nghiệp đóng thêm: ${formatVND(totals.employer)}`],
        [`Tổng chi phí nhân sự: ${formatVND(totals.gross + totals.employer)}`],
      ];

      const worksheet = XLSX.utils.aoa_to_sheet(sheet);
      worksheet['!cols'] = header.map((_, index) =>
        index === 2 ? { wch: 24 } : index < 5 ? { wch: 14 } : { wch: 16 });
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Bảng lương');
      XLSX.writeFile(workbook, `bang-luong-${format(monthStart, 'yyyy-MM')}.xlsx`);
      toast(`Đã xuất bảng lương tháng ${monthLabel}.`, 'success');
    } catch (error) {
      toast('Xuất Excel thất bại: ' + (error instanceof Error ? error.message : String(error)), 'error');
    }
    setExporting(false);
  };

  // --------------------------------------------------------------------------
  if (!canView) {
    return (
      <Card>
        <CardContent>
          <p className="flex items-start gap-2.5 py-4 text-sm leading-relaxed text-slate-500">
            <ShieldAlert className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-500" />
            Bảng lương chỉ dành cho <strong className="text-slate-700">Admin / CEO</strong>. Dữ liệu lương
            không mở theo quyền lẻ — kể cả người được cấp quyền Chấm công cũng không xem được.
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
          <h2 className="mt-3 text-lg font-bold text-slate-800">Chưa bật bộ máy tính lương</h2>
          <p className="mx-auto mt-2 max-w-xl text-sm leading-relaxed text-slate-500">
            Cần chạy migration{' '}
            <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs">
              supabase/migrations/20260921090000_payroll_engine.sql
            </code>{' '}
            trên Supabase. Migration tạo danh mục khoản lương, cơ chế lương từng người và bảng phiếu
            lương, đồng thời chuyển dữ liệu từ bảng lương cũ sang.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-800">
            {meta.title}
            {meta.monthScoped && tab === 'register' ? ` ${monthLabel}` : ''}
          </h2>
          <p className="mt-0.5 text-sm text-slate-500">{meta.hint}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 no-print">
          {meta.monthScoped && <MonthNav value={monthStart} onChange={setMonthStart} />}
          {tab === 'register' && <RunStatusBadge status={runStatus} />}
        </div>
      </div>

      {/* --- Thanh hành động theo trạng thái kỳ, chỉ ở trang Bảng lương --- */}
      {tab === 'register' && (
        <>
          {/* Buoc tiep theo ben TRAI, xuat file ben PHAI.
              Sau nut cung mot trong luong thi khong nhin ra viec phai lam
              tiep la gi - "Xuat Excel" va "Duyet bang luong" khong phai hai
              lua chon ngang hang. */}
          <div className="flex flex-wrap items-center justify-between gap-3 no-print">
            <div className="flex flex-wrap items-center gap-2">
            {!isFrozen && (
              <Button onClick={handleCalculate} disabled={busy || rows.length === 0}>
                <Calculator className="h-4 w-4" />
                {busy ? 'Đang xử lý…' : runStatus === 'DRAFT' ? 'Tính lương' : 'Tính lại'}
              </Button>
            )}
            {runStatus === 'CALCULATED' && (
              <Button variant="success" onClick={handleApprove} disabled={busy || !data?.timesheetLocked}>
                <CheckCircle2 className="h-4 w-4" /> Duyệt bảng lương
              </Button>
            )}
            {runStatus === 'APPROVED' && (
              <Button variant="success" onClick={handleMarkPaid} disabled={busy}>
                <Wallet className="h-4 w-4" /> Đánh dấu đã chi trả
              </Button>
            )}
            {isFrozen && (
              <Button variant="outline" onClick={handleReopen} disabled={busy}>
                <RotateCcw className="h-4 w-4" /> Mở lại kỳ
              </Button>
            )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={handleExport} disabled={exporting || visibleRows.length === 0}>
              <FileSpreadsheet className="h-4 w-4" />
              {exporting ? 'Đang xuất…' : 'Xuất Excel'}
            </Button>
            {/* Bút toán chỉ có nghĩa khi số liệu đã chốt — xuất từ bản nháp là
                đưa cho kế toán một con số còn thay đổi được. */}
            <Button
              variant="outline"
              onClick={handleExportJournal}
              disabled={exporting || visibleRows.length === 0 || !isFrozen}
              title={!isFrozen ? 'Duyệt bảng lương trước khi xuất bút toán kết chuyển' : undefined}
            >
              <BookOpenCheck className="h-4 w-4" /> Bút toán kết chuyển
            </Button>
            </div>
          </div>

          {runStatus === 'CALCULATED' && !data?.timesheetLocked && (
            <Banner tone="amber" icon={<LockKeyhole className="mt-0.5 h-4.5 w-4.5 flex-shrink-0" />}>
              Kỳ công tháng này chưa khóa nên chưa duyệt được bảng lương. Khóa kỳ công ở trang Bảng công
              trước — duyệt lương khi chấm công còn sửa được là chốt trên số liệu đang chạy.
            </Banner>
          )}
        </>
      )}

      {tab === 'catalog' && data && (
        <ComponentCatalog
          components={data.components}
          onChanged={() => loadData(true)}
        />
      )}

      {tab === 'adjustments' && data && (
        <AdjustmentsTab
          profiles={data.profiles}
          adjustments={data.adjustments}
          monthStart={monthStartStr}
          monthLabel={monthLabel}
          actorId={profile?.id ?? null}
          readOnly={isFrozen}
          onChanged={() => loadData(true)}
        />
      )}

      {tab === 'params' && data && (
        <PayrollParamsTab
          settings={data.payrollSettings}
          brackets={data.pitBrackets}
          actorId={profile?.id ?? null}
          onSaved={() => loadData(true)}
        />
      )}

      {tab === 'inputs' && data && (
        <MonthlyInputsTab
          profiles={data.profiles}
          components={data.components}
          employeeItems={data.items}
          unitItems={data.unitItems}
          inputs={data.inputs}
          monthStart={monthStartStr}
          actorId={profile?.id ?? null}
          readOnly={isFrozen}
          onChanged={() => loadData(true)}
        />
      )}

      {tab === 'schemes' && data && (
        <div className="space-y-6">
          {/* Khoản theo đơn vị đứng TRƯỚC danh sách từng người: đây là nơi
              khai một lần cho cả phòng, còn bên dưới chỉ là phần riêng. */}
          <UnitPayItemsCard
            components={data.components}
            unitItems={data.unitItems}
            profiles={data.profiles}
            params={params}
            defaultEffectiveFrom={monthStartStr}
            actorId={profile?.id ?? null}
            onChanged={() => loadData(true)}
            onEditEmployee={setSchemeTarget}
            schemedUserIds={new Set(rows.filter((row) => row.hasScheme).map((row) => row.profile.id))}
            onSelectUnit={setFocusedUnitId}
          />
          {/* Dang dung trong mot phong thi KHOI TREN da liet ke dung nhung
              nguoi do, kem trang thai va nut Thiet lap. Bay them danh sach
              nay nua la cung mot nhom nguoi hien hai lan, cung mot thao tac
              hai cho.
              Danh sach toan cong ty chi co nghia khi chua chon phong nao -
              luc do no la danh sach viec con ton. */}
          {!focusedUnitId && (
            <SchemesTab
              rows={rows}
              unitNameById={unitNames}
              onEdit={setSchemeTarget}
              onBulk={setBulkTargets}
            />
          )}
        </div>
      )}

      {tab === 'register' && (
        <>
          {selectedUserId && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-indigo-200 bg-indigo-50 px-4 py-3">
              <p className="text-sm font-bold text-indigo-900">
                Đang lọc theo một nhân sự được chọn từ Danh bạ.
              </p>
              <Button variant="outline" size="sm" onClick={() => setSearchParams({})}>
                Xem toàn bộ bảng lương
              </Button>
            </div>
          )}

          {missingSchemeCount > 0 && (
            <Banner tone="amber" icon={<TriangleAlert className="mt-0.5 h-4.5 w-4.5 flex-shrink-0" />}>
              {missingSchemeCount} nhân sự có ngày công nhưng <strong>chưa thiết lập cơ chế lương</strong> —
              thực nhận đang hiện 0đ. Sang tab <strong>Cơ chế lương</strong> để thiết lập.
            </Banner>
          )}

          {allWarnings.length > 0 && (
            <details className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
              <summary className="cursor-pointer text-sm font-bold text-amber-900">
                {allWarnings.length} cảnh báo cần xem lại
              </summary>
              <ul className="mt-2 space-y-1.5">
                {allWarnings.map((warning) => (
                  <li key={warning} className="text-xs leading-relaxed text-amber-800">• {warning}</li>
                ))}
              </ul>
            </details>
          )}

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <SummaryCard label="Tổng thu nhập" value={formatVND(totals.gross)} />
            <SummaryCard label="Bảo hiểm + thuế" value={formatVND(totals.insurance + totals.tax)} tone="red" />
            <SummaryCard label="Tổng thực chi" value={formatVND(totals.net)} tone="indigo" />
            <SummaryCard
              label="Chi phí doanh nghiệp"
              value={formatVND(totals.gross + totals.employer)}
              hint="Gồm bảo hiểm phần công ty đóng"
            />
          </div>

          <Card>
            <CardContent className="p-0">
              {!selectedUserId && (
                <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-6 py-3 no-print">
                  <div className="relative min-w-0 flex-1">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input
                      value={rowQuery}
                      onChange={(event) => setRowQuery(event.target.value)}
                      placeholder="Tìm theo tên hoặc mã nhân viên…"
                      className="h-10 w-full rounded-xl border border-slate-200 pl-9 pr-3 text-sm outline-none focus:border-indigo-500"
                    />
                  </div>
                  <span className="text-xs font-semibold text-slate-500">
                    {visibleRows.length}/{rows.length} nhân sự
                  </span>
                </div>
              )}
              <div className="overflow-x-auto">
                <table className="w-full min-w-[920px]">
                  <thead>
                    <tr className="border-b border-slate-100 bg-[#FCFAF8]">
                      <Th align="left" className="px-6">Nhân sự</Th>
                      <Th align="left">Cơ chế</Th>
                      <Th align="center">Công</Th>
                      <Th align="right">Thu nhập</Th>
                      <Th align="right">Khấu trừ</Th>
                      <Th align="right" className="px-6">Thực nhận</Th>
                      <th className="w-12 px-4 py-4 no-print" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {visibleRows.map((row) => {
                      const deductions =
                        row.computed.insuranceEmployee + row.computed.personalIncomeTax + row.computed.otherDeductions;
                      return (
                        <tr
                          key={row.profile.id}
                          className="group cursor-pointer transition-colors hover:bg-[#FCFAF8]"
                          onClick={() => setDetailUserId(row.profile.id)}
                        >
                          <td className="px-6 py-4">
                            <div className="flex min-w-0 items-center gap-3">
                              <Avatar name={row.profile.name} url={row.profile.avatar_url} size="sm" />
                              <div className="min-w-0">
                                <p className="truncate text-sm font-bold text-slate-800">{row.profile.name}</p>
                                <p className="text-[10px] font-medium uppercase tracking-tighter text-slate-400">
                                  {row.profile.department || 'CHƯA CÓ BỘ PHẬN'}
                                </p>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-4">
                            {row.hasScheme ? (
                              <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-600">
                                {payBasisLabel(row.computed.payBasis)}
                              </span>
                            ) : (
                              <span className="text-[10px] font-bold uppercase text-red-400">CHƯA THIẾT LẬP</span>
                            )}
                          </td>
                          <td className="px-3 py-4 text-center text-xs font-bold tabular-nums text-slate-800">
                            {row.computed.stats.paidDays}
                            <span className="ml-0.5 text-[9px] text-slate-300">
                              ({row.computed.stats.workDays}+{row.computed.stats.leaveDays})
                            </span>
                          </td>
                          <td className="px-4 py-4 text-right text-xs font-bold tabular-nums text-slate-800">
                            {formatVND(row.computed.gross)}
                          </td>
                          <td className="px-4 py-4 text-right text-xs font-medium tabular-nums text-red-500">
                            −{formatVND(deductions)}
                          </td>
                          <td className="px-6 py-4 text-right text-sm font-bold tabular-nums text-slate-900">
                            {formatVND(row.computed.netPay)}
                          </td>
                          <td className="px-4 py-4 text-center no-print">
                            {/* 36x36 chu khong phai 26x26: o 26px thi tren
                                man cam tay phai nham rat ky, ma day la nut
                                duy nhat mo duoc co che luong tu bang. */}
                            <button
                              onClick={(event) => { event.stopPropagation(); setSchemeTarget(row.profile); }}
                              className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-indigo-50 hover:text-indigo-600 disabled:opacity-40"
                              aria-label={`Sửa cơ chế lương của ${row.profile.name}`}
                              disabled={isFrozen}
                            >
                              <Pencil className="h-4 w-4" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot className="border-t border-slate-200 bg-[#FCFAF8] font-bold">
                    <tr>
                      <td className="px-6 py-5 text-[10px] font-bold uppercase tracking-widest text-slate-900" colSpan={3}>
                        {selectedUserId ? 'TỔNG PHIẾU LƯƠNG' : `TỔNG QUỸ LƯƠNG (${visibleRows.length} NHÂN SỰ)`}
                      </td>
                      <td className="px-4 py-5 text-right text-xs tabular-nums text-slate-800">{formatVND(totals.gross)}</td>
                      <td className="px-4 py-5 text-right text-xs tabular-nums text-red-700">
                        −{formatVND(totals.insurance + totals.tax + totals.other)}
                      </td>
                      <td className="px-6 py-5 text-right text-base tabular-nums text-indigo-700">{formatVND(totals.net)}</td>
                      <td className="no-print" />
                    </tr>
                  </tfoot>
                </table>
              </div>
            </CardContent>
          </Card>
          <p className="px-1 text-xs text-slate-400">Bấm vào một dòng để xem chi tiết từng khoản trong phiếu lương.</p>
        </>
      )}

      {/* --- Modal --- */}
      <PaySchemeModal
        open={!!schemeTarget}
        target={schemeTarget}
        current={schemeTarget && data
          ? payProfileForPeriod(data.payProfiles.filter((item) => item.user_id === schemeTarget.id), monthEndStr)
          : null}
        components={data?.components ?? []}
        assignedItems={data?.items.filter((item) => item.user_id === schemeTarget?.id) ?? []}
        params={params}
        defaultEffectiveFrom={monthStartStr}
        actorId={profile?.id ?? null}
        onClose={() => setSchemeTarget(null)}
        onSaved={() => loadData(true)}
      />

      <BulkSchemeModal
        open={!!bulkTargets && bulkTargets.length > 0}
        targets={bulkTargets ?? []}
        params={params}
        defaultEffectiveFrom={monthStartStr}
        actorId={profile?.id ?? null}
        onClose={() => setBulkTargets(null)}
        onSaved={() => loadData(true)}
      />

      <Modal
        open={!!detailRow}
        onClose={() => setDetailUserId(null)}
        title={`Phiếu lương ${monthLabel} — ${detailRow?.profile.name ?? ''}`}
        size="lg"
      >
        {detailRow && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <MiniStat label="Cơ chế" value={payBasisLabel(detailRow.computed.payBasis)} />
              <MiniStat label="Ngày công" value={`${detailRow.computed.stats.workDays} ngày`} />
              <MiniStat label="Ngày phép" value={`${detailRow.computed.stats.leaveDays} ngày`} />
              <MiniStat label="Giờ làm" value={`${detailRow.computed.stats.workHours} giờ`} />
            </div>
            <PayslipBreakdown
              lines={detailRow.computed.lines}
              netPay={detailRow.computed.netPay}
              warnings={detailRow.computed.warnings}
            />
          </div>
        )}
      </Modal>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab cơ chế lương
// ---------------------------------------------------------------------------
/**
 * Danh sách cơ chế lương, gom theo ĐƠN VỊ.
 *
 * Bản trước là một danh sách phẳng tách rời khỏi thẻ khoản-theo-đơn-vị ngay
 * trên nó, nên không nhìn ra được phòng nào đã thiết lập xong, phòng nào còn
 * sót người — đúng lúc cần biết nhất là trước khi chốt lương.
 *
 * Thiết lập HÀNG LOẠT là phần còn lại: một tổ công nhân mười mấy người cùng
 * một mức, mở từng phiếu gõ lại mười mấy lần vừa lâu vừa dễ lệch. Chọn nhiều
 * người rồi đặt một lần, sau đó ai cần khác thì sửa riêng.
 */
function SchemesTab({
  rows, unitNameById, onEdit, onBulk,
}: {
  rows: PayrollRow[];
  unitNameById: Map<string, string>;
  onEdit: (profile: Profile) => void;
  onBulk: (profiles: Profile[]) => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const withoutScheme = rows.filter((row) => !row.hasScheme);

  // Gom theo đơn vị; người chưa gán đơn vị dồn vào một nhóm riêng ở cuối thay
  // vì lẫn vào nhóm nào đó — họ cần được nhìn thấy để đi gán đơn vị.
  const groups = useMemo(() => {
    const map = new Map<string, PayrollRow[]>();
    rows.forEach((row) => {
      const key = row.profile.unit_id || '';
      map.set(key, [...(map.get(key) || []), row]);
    });
    return [...map.entries()].sort(([a], [b]) => {
      if (!a) return 1;
      if (!b) return -1;
      return (unitNameById.get(a) || '').localeCompare(unitNameById.get(b) || '', 'vi');
    });
  }, [rows, unitNameById]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleGroup = (group: PayrollRow[]) => {
    const ids = group.map((row) => row.profile.id);
    const allOn = ids.every((id) => selected.has(id));
    setSelected((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => (allOn ? next.delete(id) : next.add(id)));
      return next;
    });
  };

  const selectedProfiles = rows.filter((row) => selected.has(row.profile.id)).map((row) => row.profile);

  return (
    <div className="space-y-4">
      {withoutScheme.length > 0 && (
        <Banner tone="amber" icon={<TriangleAlert className="mt-0.5 h-4.5 w-4.5 flex-shrink-0" />}>
          {withoutScheme.length} nhân sự chưa có cơ chế lương. Họ sẽ không xuất hiện trong bảng
          lương đã chốt cho tới khi được thiết lập. Tích chọn nhiều người rồi bấm{' '}
          <strong>Thiết lập hàng loạt</strong> nếu họ cùng một mức.
        </Banner>
      )}

      {groups.map(([unitId, group]) => {
        const allOn = group.every((row) => selected.has(row.profile.id));
        const missing = group.filter((row) => !row.hasScheme).length;

        return (
          <Card key={unitId || 'unassigned'}>
            <CardContent className="p-0">
              <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-5 py-3">
                <input
                  type="checkbox"
                  checked={allOn}
                  onChange={() => toggleGroup(group)}
                  aria-label={`Chọn tất cả trong ${unitNameById.get(unitId) || 'nhóm chưa gán đơn vị'}`}
                  className="h-4 w-4 rounded border-slate-300"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-slate-800">
                    {unitId ? unitNameById.get(unitId) || 'Đơn vị không còn tồn tại' : 'Chưa gán đơn vị'}
                  </p>
                  <p className="text-xs text-slate-500">
                    {group.length} nhân sự
                    {missing > 0 && <span className="font-semibold text-amber-600"> · {missing} chưa thiết lập</span>}
                    {!unitId && ' · không thừa hưởng khoản nào theo phòng ban'}
                  </p>
                </div>
              </div>

              <ul className="divide-y divide-slate-50">
                {group.map((row) => {
                  const scheme = row.computed;
                  return (
                    <li key={row.profile.id} className="flex items-center gap-3 px-5 py-3.5">
                      <input
                        type="checkbox"
                        checked={selected.has(row.profile.id)}
                        onChange={() => toggle(row.profile.id)}
                        aria-label={`Chọn ${row.profile.name}`}
                        className="h-4 w-4 rounded border-slate-300"
                      />
                      <Avatar name={row.profile.name} url={row.profile.avatar_url} size="sm" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-bold text-slate-800">{row.profile.name}</p>
                        <p className="text-xs text-slate-500">
                          {row.hasScheme ? (
                            <>
                              {payBasisLabel(scheme.payBasis)}
                              {scheme.gross > 0 && ` · thu nhập ${formatVND(scheme.gross)}`}
                            </>
                          ) : (
                            <span className="font-bold text-red-500">Chưa thiết lập cơ chế lương</span>
                          )}
                        </p>
                      </div>
                      <Button variant="outline" size="sm" onClick={() => onEdit(row.profile)}>
                        <Pencil className="h-3.5 w-3.5" /> {row.hasScheme ? 'Sửa' : 'Thiết lập'}
                      </Button>
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>
        );
      })}

      {/* Thanh thao tác nổi, chỉ hiện khi đang chọn — chiếm chỗ thường trực cho
          một hành động hiếm dùng là lãng phí màn hình. */}
      {selected.size > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-30 border-t border-slate-200 bg-white/95 px-4 py-3 shadow-lg backdrop-blur-md print:hidden">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 lg:pl-64">
            <p className="text-sm text-slate-600">
              Đang chọn <strong className="text-slate-800">{selected.size}</strong> nhân sự
            </p>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setSelected(new Set())}>Bỏ chọn</Button>
              <Button theme="admin" onClick={() => onBulk(selectedProfiles)}>
                <Users className="h-4 w-4" /> Thiết lập hàng loạt
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mảnh giao diện nhỏ
// ---------------------------------------------------------------------------
/**
 * Vòng đời của một kỳ lương, vẽ thành bốn chặng thay vì một cái nhãn.
 *
 * Nhãn "Đã tính" nói kỳ đang ở đâu nhưng không nói đã qua những gì và còn
 * phải làm gì — mà đây là quy trình bốn bước một chiều, duyệt xong là đóng
 * băng số liệu. Người làm lương cần thấy cả đường đi, không chỉ một điểm.
 */
function RunStatusBadge({ status }: { status: keyof typeof RUN_STATUS_LABEL }) {
  const order: (keyof typeof RUN_STATUS_LABEL)[] = ['DRAFT', 'CALCULATED', 'APPROVED', 'PAID'];
  const current = order.indexOf(status);

  return (
    <div className="flex items-center gap-1" role="status" aria-label={`Trạng thái kỳ: ${RUN_STATUS_LABEL[status]}`}>
      {order.map((step, index) => {
        const done = index < current;
        const here = index === current;
        return (
          <span key={step} className="flex items-center gap-1">
            {index > 0 && (
              <span className={`h-px w-3 ${index <= current ? 'bg-indigo-300' : 'bg-slate-200'}`} />
            )}
            <span
              className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${here
                ? 'bg-indigo-600 text-white'
                : done ? 'bg-indigo-50 text-indigo-700' : 'bg-slate-100 text-slate-400'}`}
            >
              {RUN_STATUS_LABEL[step]}
            </span>
          </span>
        );
      })}
    </div>
  );
}

function SummaryCard({
  label, value, tone = 'slate', hint,
}: {
  label: string; value: string; tone?: 'slate' | 'red' | 'indigo'; hint?: string;
}) {
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

function Th({
  children, align, className = '',
}: {
  children?: React.ReactNode; align: 'left' | 'center' | 'right'; className?: string;
}) {
  const alignment = { left: 'text-left', center: 'text-center', right: 'text-right' }[align];
  return (
    <th className={`${alignment} px-4 py-4 text-[10px] font-bold uppercase tracking-widest text-slate-400 ${className}`}>
      {children}
    </th>
  );
}

function Banner({
  tone, icon, children,
}: {
  tone: 'amber' | 'emerald'; icon: React.ReactNode; children: React.ReactNode;
}) {
  const tones = {
    amber: 'border-amber-200 bg-amber-50 text-amber-800',
    emerald: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  };
  return (
    <div className={`flex items-start gap-2.5 rounded-xl border px-4 py-3 text-sm leading-relaxed ${tones[tone]}`}>
      {icon}
      <span>{children}</span>
    </div>
  );
}
