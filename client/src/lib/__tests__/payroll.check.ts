// Kiểm chứng engine lương. Chạy: npm run check:payroll
import { evaluateFormula, progressiveLookup, tierLookup } from '../payrollFormula';
import {
  applyOverride, diffSchemeItems, earliestSchemeMonth, openRequestFor, resolveMechanismRows,
} from '../payrollScheme';
import {
  computePayslip, orderMechanismRows, splitOvertimeHours, summarisePeriod, systemScope,
  type MechanismRow, type PayrollAdjustment,
} from '../payroll';
import {
  EMPTY_SCHEDULES, measurePunctuality, monthStandardBreakdown, monthStandardDays, type ScheduleSet,
} from '../workSchedule';
import { toPayrollParams, type PayrollParamVersion } from '../payrollSettings';
import { DEFAULT_GRADES, finalPct, gradeOf, previewSheet, scoreFromValue, setProblems, type KpiCriterion } from '../kpi';
import { buildPayrollJournal } from '../payrollJournal';
import { buildFormulaSheet } from '../formulaSheet';
import {
  otherDeductionsOf, PAY_REPORT_TAGS, reportTagFitsKind, reportTagKindProblem, sumReportTags,
} from '../payrollReportTags';
import type {
  EmployeePayItem, LeaveRequest, PayComponent, PayComponentKind, PayReportTag, UnitPayItem,
} from '@/types';

/**
 * Bộ tham số dùng cho kiểm chứng — khai đủ như kế toán khai ở màn Tham số
 * lương: bảng tự đặt tên, mỗi tham số có loại và đơn vị, bảng bậc thang gọi
 * như hàm. Làm tròn thực lĩnh 1đ để so số cho gọn; hàng nghìn kiểm riêng.
 */
export const TEST_VERSION: PayrollParamVersion = {
  id: null, effectiveFrom: '2000-01-01', label: 'test', note: null, updatedAt: null,
  standardWorkDays: 26, netRoundingUnit: 1, netRoundingMode: 'NEAREST',
  floorComponentCode: null, floorParamCode: null,
  tables: [
    {
      id: 'bh', kind: 'LIST', name: 'Bảo hiểm', note: null, params: [
        { code: 'TY_LE_BHXH_NLD', name: 'BHXH người lao động', type: 'RATE', unit: '%', value: 8, note: null },
        { code: 'TY_LE_BHYT_NLD', name: 'BHYT người lao động', type: 'RATE', unit: '%', value: 1.5, note: null },
        { code: 'TY_LE_BHTN_NLD', name: 'BHTN người lao động', type: 'RATE', unit: '%', value: 1, note: null },
        { code: 'TRAN_BHXH_BHYT', name: 'Trần BHXH, BHYT', type: 'MONEY', unit: 'VND', value: 46_800_000, note: null },
        { code: 'TRAN_BHTN', name: 'Trần BHTN', type: 'MONEY', unit: 'VND', value: 99_200_000, note: null },
        { code: 'SO_NGAY_MIEN_DONG_BH', name: 'Nghỉ không lương từ (ngày)', type: 'TIME', unit: 'NGAY', value: 14, note: null },
      ],
    },
    {
      id: 'thue', kind: 'LIST', name: 'Thuế & quỹ', note: null, params: [
        { code: 'GIAM_TRU_BAN_THAN', name: 'Giảm trừ bản thân', type: 'MONEY', unit: 'VND_THANG', value: 11_000_000, note: null },
        { code: 'GIAM_TRU_NPT', name: 'Giảm trừ người phụ thuộc', type: 'MONEY', unit: 'VND_THANG', value: 4_400_000, note: null },
        { code: 'TY_LE_QUY', name: 'Tỷ lệ trích quỹ', type: 'RATE', unit: '%', value: 1, note: null },
        { code: 'HE_SO_OT', name: 'Hệ số OT ngày thường', type: 'RATE', unit: 'HE_SO', value: 1.5, note: null },
      ],
    },
    {
      id: 'pit', kind: 'TIER', name: 'Biểu thuế lũy tiến', note: null, code: 'THUE_LUY_TIEN', mode: 'PROGRESSIVE',
      inputLabel: 'Thu nhập tính thuế', unit: '%',
      rows: [
        { from: 0, value: 5 }, { from: 5_000_000, value: 10 }, { from: 10_000_000, value: 15 },
        { from: 18_000_000, value: 20 }, { from: 32_000_000, value: 25 }, { from: 52_000_000, value: 30 },
        { from: 80_000_000, value: 35 },
      ],
    },
    {
      id: 'hh', kind: 'TIER', name: 'Hoa hồng doanh thu', note: null, code: 'HH_BL02', mode: 'LOOKUP',
      inputLabel: 'Tỷ lệ đạt (%)', unit: '%',
      rows: [{ from: 0, value: 0 }, { from: 75, value: 1.5 }, { from: 90, value: 3 }, { from: 105, value: 4 }],
    },
  ],
};
const params = toPayrollParams(TEST_VERSION, { standardHoursPerDay: 8 });

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n        got ${JSON.stringify(actual)}\n        want ${JSON.stringify(expected)}`}`);
}

// --- Bộ đánh giá biểu thức --------------------------------------------------
const scope = { HOURLY_RATE: 100000, OT_WEEKDAY_HOURS: 10, REVENUE: 600_000_000, BASE: 15_000_000 };
check('nhân cơ bản', evaluateFormula('HOURLY_RATE * 1.5 * OT_WEEKDAY_HOURS', scope).value, 1_500_000);
check('ưu tiên toán tử', evaluateFormula('2 + 3 * 4', scope).value, 14);
check('ngoặc', evaluateFormula('(2 + 3) * 4', scope).value, 20);
check('MAX', evaluateFormula('MAX(BASE * 0.1, 2000000)', scope).value, 2_000_000);
check('IF bậc thang', evaluateFormula('IF(REVENUE > 500000000, REVENUE * 0.05, REVENUE * 0.03)', scope).value, 30_000_000);
check('ternary', evaluateFormula('REVENUE > 1000000000 ? 1 : 2', scope).value, 2);
check('gạch dưới trong số', evaluateFormula('1_000_000 + 1', scope).value, 1_000_001);
check('âm đơn', evaluateFormula('-BASE + 20000000', scope).value, 5_000_000);

function expectError(label: string, expr: string) {
  try {
    evaluateFormula(expr, scope);
    console.log(`FAIL  ${label} — đáng lẽ phải lỗi`);
    failures += 1;
  } catch {
    console.log(`PASS  ${label}`);
  }
}
expectError('chặn biến lạ', 'window.alert');
expectError('chặn chuỗi/eval', 'constructor("return 1")()');
expectError('chia 0', 'BASE / 0');
expectError('thiếu ngoặc', 'MAX(1, 2');

// --- Tham số theo bảng: % là phần trăm thật, bảng bậc thang là hàm ----------
check('tham số % vào công thức là phần trăm thật (1% = 0,01)', params.values.TY_LE_QUY, 0.01);
check('tham số hệ số giữ nguyên', params.values.HE_SO_OT, 1.5);
check('tham số tiền giữ nguyên', params.values.TRAN_BHTN, 99_200_000);
check('bảng tra bậc đơn vị %: đạt 95% → 3% = 0,03', params.functions.HH_BL02(95), 0.03);
check('bảng tra bậc: dưới bậc đầu → 0', params.functions.HH_BL02(50), 0);
// Thu nhập tính thuế 20tr: 5tr*5% + 5tr*10% + 8tr*15% + 2tr*20% = 250k+500k+1.2tr+400k
check('lũy tiến từng phần: 20tr → 2.350.000', Math.round(params.functions.THUE_LUY_TIEN(20_000_000)), 2_350_000);
check('lũy tiến: 5tr → 250.000', Math.round(params.functions.THUE_LUY_TIEN(5_000_000)), 250_000);
check('lũy tiến: 0 → 0', params.functions.THUE_LUY_TIEN(0), 0);
check('lũy tiến: số âm → 0', params.functions.THUE_LUY_TIEN(-1_000_000), 0);
// 100tr: 250k+500k+1.2tr+2.8tr+5tr+8.4tr+7tr = 25.15tr
check('lũy tiến: 100tr → 25.150.000', Math.round(params.functions.THUE_LUY_TIEN(100_000_000)), 25_150_000);
check('progressiveLookup dùng được độc lập',
  Math.round(progressiveLookup([{ from: 0, value: 10 }, { from: 1000, value: 20 }])(1500)), 200);

// --- Tính phiếu lương theo dòng cơ chế -------------------------------------
const comp = (code: string, kind: PayComponentKind = 'EARNING', over: Partial<PayComponent> = {}): PayComponent => ({
  id: `c-${code}`, code, name: code, kind, calc_type: 'FIXED',
  input_code: null, base_code: null, formula: null, taxable: true, insurable: false, prorate: false,
  ot_multiplier: null, tax_exempt_cap: null, is_base: false, max_amount: null, sort_order: 100,
  group_name: null, category_code: 'THU_NHAP_BIEN_DOI', calc_source: 'ASSIGNED',
  is_active: true, is_system: false, note: null, created_at: '', updated_at: '', ...over,
} as PayComponent);

let order = 0;
const row = (
  component: PayComponent, mode: MechanismRow['mode'], value: string | number | null = null, sortOrder?: number,
): MechanismRow => ({
  component, mode,
  formula: typeof value === 'string' ? value : null,
  amount: typeof value === 'number' ? value : null,
  sortOrder: sortOrder ?? (order += 10),
  origin: null,
});

const C = {
  LUONG_CO_BAN: comp('LUONG_CO_BAN', 'INFO', { name: 'Lương cơ bản' }),
  DAILY_RATE: comp('DAILY_RATE', 'INFO', { name: 'Đơn giá ngày' }),
  HOURLY_RATE: comp('HOURLY_RATE', 'INFO', { name: 'Đơn giá giờ' }),
  BASE_WORK: comp('BASE_WORK', 'EARNING', { name: 'Lương thời gian' }),
  BASE_LEAVE: comp('BASE_LEAVE', 'EARNING', { name: 'Lương phép' }),
  BASE_HOLIDAY: comp('BASE_HOLIDAY', 'EARNING', { name: 'Lương nghỉ lễ' }),
  INSURANCE_BASE: comp('INSURANCE_BASE', 'INFO', { name: 'Lương đóng bảo hiểm' }),
  DEPENDENTS: comp('DEPENDENTS', 'INFO', { name: 'Số người phụ thuộc' }),
  THU_NHAP_CHIU_THUE: comp('THU_NHAP_CHIU_THUE', 'INFO', { name: 'Thu nhập chịu thuế' }),
  THU_NHAP_TINH_THUE: comp('THU_NHAP_TINH_THUE', 'INFO', { name: 'Thu nhập tính thuế' }),
  INS_EMPLOYEE: comp('INS_EMPLOYEE', 'DEDUCTION', { name: 'BHXH, BHYT, BHTN' }),
  PIT: comp('PIT', 'DEDUCTION', { name: 'Thuế TNCN' }),
};
// Bảo hiểm chỉ là một công thức trên tham số — hệ thống không biết đó là bảo hiểm.
const BAO_HIEM = 'IF(UNPAID_DAYS >= SO_NGAY_MIEN_DONG_BH, 0, MIN(INSURANCE_BASE, TRAN_BHXH_BHYT) * '
  + '(TY_LE_BHXH_NLD + TY_LE_BHYT_NLD) + MIN(INSURANCE_BASE, TRAN_BHTN) * TY_LE_BHTN_NLD)';

/** Cơ chế lương tháng điển hình: lương thời gian / phép / lễ, bảo hiểm, thuế. */
function standardRows(opts: {
  base?: number | null; dependents?: number; taxable?: string; extra?: MechanismRow[];
} = {}): MechanismRow[] {
  order = 0;
  return [
    row(C.LUONG_CO_BAN, 'PER_PERSON', opts.base === undefined ? 20_000_000 : opts.base),
    row(C.DAILY_RATE, 'FORMULA', 'LUONG_CO_BAN / STANDARD_DAYS'),
    row(C.HOURLY_RATE, 'FORMULA', 'DAILY_RATE / HOURS_PER_DAY'),
    row(C.BASE_WORK, 'FORMULA', 'DAILY_RATE * WORK_DAYS'),
    row(C.BASE_LEAVE, 'FORMULA', 'DAILY_RATE * LEAVE_DAYS'),
    row(C.BASE_HOLIDAY, 'FORMULA', 'DAILY_RATE * HOLIDAY_DAYS'),
    ...(opts.extra ?? []),
    row(C.INSURANCE_BASE, 'FORMULA', 'LUONG_CO_BAN'),
    row(C.DEPENDENTS, 'VALUE', opts.dependents ?? 0),
    row(C.THU_NHAP_CHIU_THUE, 'FORMULA', opts.taxable ?? 'TONG_THU_NHAP'),
    row(C.THU_NHAP_TINH_THUE, 'FORMULA', 'MAX(0, THU_NHAP_CHIU_THUE - INS_EMPLOYEE - GIAM_TRU_BAN_THAN - DEPENDENTS * GIAM_TRU_NPT)'),
    row(C.INS_EMPLOYEE, 'FORMULA', BAO_HIEM),
    row(C.PIT, 'FORMULA', 'THUE_LUY_TIEN(THU_NHAP_TINH_THUE)'),
  ];
}

const stats = (workDays = 26, leaveDays = 0, holidayDays = 0, extra: Record<string, number> = {}) => ({
  workDays, leaveDays, holidayDays, paidDays: workDays + leaveDays + holidayDays, workHours: workDays * 8,
  missingCheckout: 0, lateMinutes: 0, lateCount: 0, lateAfterCutoffCount: 0, earlyMinutes: 0, earlyCount: 0, ...extra,
});
const profile = { id: 'u1', name: 'Nguyễn Văn A' };
type SlipExtra = Partial<Omit<Parameters<typeof computePayslip>[0], 'profile' | 'rows' | 'stats' | 'params'>> & {
  params?: typeof params;
};
const slip = (rows: MechanismRow[], s = stats(), extra: SlipExtra = {}) =>
  computePayslip({ profile, rows, stats: s, params, ...extra });
const amountOf = (p: ReturnType<typeof computePayslip>, code: string) => p.lines.find((l) => l.code === code)?.amount;

// Lương tháng đủ công, không phụ cấp, không người phụ thuộc.
const monthly = slip(standardRows());
check('gross lương tháng đủ công', monthly.gross, 20_000_000);
check('lương cơ bản là MỨC — không thành dòng tiền thứ hai', monthly.lines.find((l) => l.code === 'LUONG_CO_BAN')?.kind, 'INFO');
check('bảo hiểm 10,5% tính bằng công thức', amountOf(monthly, 'INS_EMPLOYEE'), 2_100_000);
// TNTT = 20tr - 2.1tr - 11tr = 6.9tr -> 5tr*5% + 1.9tr*10% = 250k + 190k = 440k
check('thu nhập tính thuế', monthly.values.THU_NHAP_TINH_THUE, 6_900_000);
check('thuế TNCN', amountOf(monthly, 'PIT'), 440_000);
check('tổng trừ', monthly.totalDeductions, 2_540_000);
check('thực nhận', monthly.netPay, 20_000_000 - 2_100_000 - 440_000);
check('dòng trung gian giữ số lẻ tới 2 chữ số', amountOf(monthly, 'DAILY_RATE'), 769_230.77);
check('không cảnh báo nào cho cơ chế đầy đủ', monthly.warnings, []);

// Nghỉ không lương nửa tháng: lương theo công giảm, mức đóng bảo hiểm KHÔNG giảm.
const halfMonth = slip(standardRows(), stats(13));
check('nửa tháng công', halfMonth.gross, 10_000_000);
check('bảo hiểm giữ nguyên mức đóng', amountOf(halfMonth, 'INS_EMPLOYEE'), 2_100_000);

check('2 người phụ thuộc thì hết thuế', amountOf(slip(standardRows({ dependents: 2 })), 'PIT'), 0);

// Trần đóng bảo hiểm với lương rất cao: BHXH+BHYT trên trần 46.8tr = 9.5%; BHTN trên trần 99.2tr = 1%
check('trần bảo hiểm', amountOf(slip(standardRows({ base: 200_000_000 })), 'INS_EMPLOYEE'),
  Math.round(46_800_000 * 0.095) + Math.round(99_200_000 * 0.01));

// Nghỉ không lương từ 14 ngày: tháng đó không đóng bảo hiểm (ngưỡng là THAM SỐ).
const mostlyUnpaid = slip(standardRows(), stats(12));
check('nghỉ 14 ngày thì không trừ bảo hiểm', amountOf(mostlyUnpaid, 'INS_EMPLOYEE'), 0);
check('thực nhận không âm', mostlyUnpaid.netPay >= 0, true);
check('nghỉ 13 ngày vẫn trừ bảo hiểm đủ', amountOf(slip(standardRows(), stats(13)), 'INS_EMPLOYEE'), 2_100_000);
check('phép có lương và ngày lễ không tính là nghỉ không lương',
  amountOf(slip(standardRows(), stats(10, 4, 2)), 'INS_EMPLOYEE'), 2_100_000);
check('đổi ngưỡng ở bộ tham số thì công thức theo (16/26 công, ngưỡng 10 → miễn đóng)',
  amountOf(slip(standardRows(), stats(16), {
    params: toPayrollParams({
      ...TEST_VERSION,
      tables: TEST_VERSION.tables.map((table) => (table.kind === 'LIST' ? {
        ...table, params: table.params.map((p) => (p.code === 'SO_NGAY_MIEN_DONG_BH' ? { ...p, value: 10 } : p)),
      } : table)),
    }, { standardHoursPerDay: 8 }),
  }), 'INS_EMPLOYEE'), 0);

// Ba dòng lương thời gian / phép / lễ, cùng đơn giá ngày.
const split = slip(standardRows(), stats(20, 2, 1));
const dayRate = 20_000_000 / 26;
check('dòng Lương thời gian', amountOf(split, 'BASE_WORK'), Math.round(dayRate * 20));
check('dòng Lương phép', amountOf(split, 'BASE_LEAVE'), Math.round(dayRate * 2));
check('dòng Lương nghỉ lễ', amountOf(split, 'BASE_HOLIDAY'), Math.round(dayRate * 1));
check('gross = tổng ba dòng', split.gross,
  Math.round(dayRate * 20) + Math.round(dayRate * 2) + Math.round(dayRate * 1));

// --- Thứ tự tính theo phụ thuộc, vòng lặp, tổng thu nhập --------------------
// Dòng đọc tới dòng xếp SAU nó vẫn ra đúng: thứ tự tính theo phụ thuộc chứ
// không theo thứ tự hiện trên phiếu.
const ghep = slip([
  row(comp('THUONG_GHEP', 'EARNING', { name: 'Thưởng ghép' }), 'FORMULA', '(PC_XANG + PC_AN) * 0.1', 100),
  row(comp('PC_XANG', 'EARNING', { name: 'Phụ cấp xăng xe' }), 'VALUE', 500_000, 900),
  row(comp('PC_AN', 'EARNING', { name: 'Phụ cấp ăn ca' }), 'VALUE', 1_000_000, 910),
]);
check('dòng ghép đọc được dòng xếp sau nó', amountOf(ghep, 'THUONG_GHEP'), 150_000);
check('phiếu vẫn hiện theo thứ tự đã xếp', ghep.lines.map((l) => l.code), ['THUONG_GHEP', 'PC_XANG', 'PC_AN']);
check('orderMechanismRows: dòng bị đọc tới đứng trước',
  orderMechanismRows(standardRows()).ordered.findIndex((r) => r.component.code === 'DAILY_RATE')
    < orderMechanismRows(standardRows()).ordered.findIndex((r) => r.component.code === 'BASE_WORK'), true);

const vong = slip([
  row(comp('A', 'EARNING', { name: 'Dòng A' }), 'FORMULA', 'B + 1'),
  row(comp('B', 'EARNING', { name: 'Dòng B' }), 'FORMULA', 'A + 1'),
  row(comp('C', 'EARNING', { name: 'Dòng C' }), 'VALUE', 1_000),
]);
check('vòng lặp: cả hai dòng ra 0', [amountOf(vong, 'A'), amountOf(vong, 'B')], [0, 0]);
check('vòng lặp: đánh dấu lỗi trên phiếu', vong.lines.filter((l) => l.failed).map((l) => l.code), ['A', 'B']);
check('vòng lặp: cảnh báo gọi đúng tên', vong.warnings.some((w) => w.includes('Dòng A') && w.includes('Dòng B')), true);
check('vòng lặp không kéo sập dòng khác', amountOf(vong, 'C'), 1_000);

const quy = slip([
  row(comp('LUONG', 'EARNING'), 'VALUE', 10_000_000),
  row(comp('PHU_CAP', 'EARNING'), 'VALUE', 2_000_000),
  row(comp('QUY', 'DEDUCTION'), 'FORMULA', 'TONG_THU_NHAP * TY_LE_QUY'),
]);
check('dòng trừ đọc được tổng các khoản cộng', amountOf(quy, 'QUY'), 120_000);
const tuDoc = slip([
  row(comp('LUONG', 'EARNING'), 'VALUE', 10_000_000),
  row(comp('THUONG_TONG', 'EARNING', { name: 'Thưởng theo tổng' }), 'FORMULA', 'TONG_THU_NHAP * 0.1'),
]);
check('dòng cộng đọc tổng các khoản cộng (gồm chính nó) là vòng lặp', amountOf(tuDoc, 'THUONG_TONG'), 0);
check('và có cảnh báo', tuDoc.warnings.some((w) => w.includes('Thưởng theo tổng')), true);

// --- Từng cách lấy giá trị --------------------------------------------------
const thuong = comp('THUONG_THANG', 'EARNING', { name: 'Thưởng tháng' });
check('dòng Hằng tháng đọc số liệu tháng',
  amountOf(slip([row(thuong, 'MONTHLY_INPUT')], stats(), { inputs: { THUONG_THANG: 1_500_000 } }), 'THUONG_THANG'), 1_500_000);
const chuaNhap = slip([row(thuong, 'MONTHLY_INPUT')]);
check('chưa nhập số liệu tháng thì 0đ, không lỗi', amountOf(chuaNhap, 'THUONG_THANG'), 0);
check('và nói rõ là chưa nhập', chuaNhap.lines[0].detail, 'Chưa nhập số liệu tháng');

const thieuLuong = slip(standardRows({ base: null }));
check('khai từng người mà chưa khai: dòng lỗi, 0đ', thieuLuong.lines.find((l) => l.code === 'LUONG_CO_BAN')?.failed, true);
check('cảnh báo gọi đúng tên dòng chưa khai', thieuLuong.warnings.some((w) => w.includes('chưa khai “Lương cơ bản”')), true);

check('giá trị trống thì ra 0đ, không có mặc định của danh mục',
  amountOf(slip([row(comp('PC', 'EARNING'), 'VALUE', null)]), 'PC'), 0);

const hong = slip(standardRows({ extra: [row(comp('HONG', 'EARNING', { name: 'Công thức hỏng' }), 'FORMULA', 'KHONG_CO_BIEN_NAY * 2', 500)] }));
check('công thức hỏng vẫn ra phiếu', hong.gross, 20_000_000);
check('dòng hỏng nằm trên phiếu, đánh dấu lỗi', hong.lines.find((l) => l.code === 'HONG')?.failed, true);
check('cảnh báo công thức hỏng gọi đúng tên', hong.warnings.some((w) => w.includes('Công thức hỏng')), true);

const trungMa = slip([row(comp('WORK_DAYS', 'EARNING', { name: 'Trùng mã' }), 'VALUE', 5)]);
check('đầu mục trùng mã dữ liệu tự động bị bỏ qua', trungMa.lines.length, 0);
check('và có cảnh báo', trungMa.warnings.some((w) => w.includes('WORK_DAYS')), true);

// Công thức trỏ tới đầu mục mà cơ chế người này không có: bằng 0. Dòng ra
// TIỀN thì phải cảnh báo; dòng trung gian (thu nhập chịu thuế…) cố ý cộng
// cả khoản có thể không có, nên không làm ồn.
const thieuNguon = slip(standardRows({
  taxable: 'TONG_THU_NHAP - MIN(ALLOW_MEAL, 730000)',
  extra: [row(comp('QUY', 'DEDUCTION', { name: 'Trích quỹ' }), 'FORMULA', '(BASE_WORK + LUONG_VAN_CHUYEN) * TY_LE_QUY', 500)],
}), stats(), { catalogCodes: ['LUONG_VAN_CHUYEN', 'ALLOW_MEAL'] });
check('đầu mục vắng mặt tính bằng 0', amountOf(thieuNguon, 'QUY'), 200_000);
check('dòng tiền đọc đầu mục vắng mặt thì cảnh báo',
  thieuNguon.warnings.some((w) => w.includes('Trích quỹ') && w.includes('LUONG_VAN_CHUYEN')), true);
check('dòng trung gian đọc đầu mục vắng mặt thì không cảnh báo',
  thieuNguon.warnings.some((w) => w.includes('ALLOW_MEAL')), false);

// --- Khai riêng đè dòng cơ chế (applyOverride) ------------------------------
const kpi = comp('LUONG_KPI', 'EARNING', { name: 'Lương KPI', sort_order: 200 });
const ot = comp('OT_WEEKDAY', 'EARNING', { name: 'OT ngày thường', sort_order: 210 });
const kpiRow: MechanismRow = { component: kpi, mode: 'FORMULA', formula: 'MUC_RIENG * TY_LE_KPI', amount: null, sortOrder: 10, origin: 'Cơ chế' };
const otRow: MechanismRow = { component: ot, mode: 'FORMULA', formula: 'HOURLY_RATE * HE_SO_OT * OT_WEEKDAY_HOURS', amount: null, sortOrder: 20, origin: 'Cơ chế' };
const kpiRieng = applyOverride(kpiRow, kpi, { amount: 5_000_000, formula: null }, 'Riêng');
check('mức riêng trên dòng công thức đọc MUC_RIENG: giữ công thức', [kpiRieng.mode, kpiRieng.formula, kpiRieng.amount, kpiRieng.origin],
  ['FORMULA', 'MUC_RIENG * TY_LE_KPI', 5_000_000, 'Riêng']);
const otRieng = applyOverride(otRow, ot, { amount: 300_000, formula: null }, 'Riêng');
check('mức riêng trên dòng công thức không đọc MUC_RIENG: thành giá trị', [otRieng.mode, otRieng.formula, otRieng.amount],
  ['VALUE', null, 300_000]);
check('công thức riêng thay công thức chung',
  applyOverride(otRow, ot, { amount: null, formula: 'HOURLY_RATE * 2 * OT_WEEKDAY_HOURS' }, 'Riêng').formula,
  'HOURLY_RATE * 2 * OT_WEEKDAY_HOURS');
check('dòng hằng tháng có giá trị riêng thành giá trị',
  applyOverride({ ...otRow, mode: 'MONTHLY_INPUT', formula: null }, ot, { amount: 1_000_000, formula: null }, 'Riêng').mode, 'VALUE');
check('khai riêng trống thì giữ nguyên dòng', applyOverride(otRow, ot, { amount: null, formula: null }, 'Riêng'), otRow);
const them = applyOverride(undefined, comp('PC_RIENG', 'EARNING', { sort_order: 150 }), { amount: 700_000, formula: null }, 'Riêng');
check('đầu mục không có trong cơ chế thành dòng thêm, xếp cuối phiếu', [them.mode, them.amount, them.sortOrder], ['VALUE', 700_000, 100_150]);

// --- KPI ---------------------------------------------------------------------
check('Lương KPI = mức KPI × tỷ lệ KPI',
  amountOf(slip([row(comp('MUC_KPI', 'INFO'), 'PER_PERSON', 5_000_000), row(kpi, 'FORMULA', 'MUC_KPI * TY_LE_KPI')],
    stats(), { inputs: { KPI_PCT: 80 } }), 'LUONG_KPI'), 4_000_000);
check('công thức cũ MUC_RIENG * KPI_PCT / 100 vẫn chạy',
  amountOf(slip([{ ...kpiRow, formula: 'MUC_RIENG * KPI_PCT / 100', amount: 8_000_000 }], stats(), { inputs: { KPI_PCT: 80 } }), 'LUONG_KPI'),
  6_400_000);
check('MUC_RIENG trống thì ra 0đ',
  amountOf(slip([kpiRow], stats(), { inputs: { KPI_PCT: 80 } }), 'LUONG_KPI'),
  0);

// --- Phần không chịu thuế: chỉ là công thức của dòng "Thu nhập chịu thuế" ----
const otTien = row(comp('OT150', 'EARNING'), 'VALUE', 3_000_000, 500);
const coOt = slip(standardRows({ extra: [otTien], taxable: 'TONG_THU_NHAP - ROUND(OT150 * (1.5 - 1) / 1.5)' }));
const thuongThuong = slip(standardRows({ extra: [otTien] }));
check('OT vẫn vào gross đầy đủ', coOt.gross, thuongThuong.gross);
check('OT 150%: phần trả cao hơn giờ thường để ngoài thu nhập chịu thuế',
  thuongThuong.values.THU_NHAP_TINH_THUE - coOt.values.THU_NHAP_TINH_THUE, 1_000_000);
const anCa = slip(standardRows({ extra: [row(comp('ALLOW_MEAL', 'EARNING'), 'VALUE', 1_000_000, 500)], taxable: 'TONG_THU_NHAP - MIN(ALLOW_MEAL, 730000)' }));
check('ăn ca vượt mức miễn: chỉ phần vượt vào thu nhập tính thuế',
  anCa.values.THU_NHAP_TINH_THUE - monthly.values.THU_NHAP_TINH_THUE, 270_000);

// --- Trần số tiền: chỉ là MIN trong công thức --------------------------------
const doanPhi = (base: number) => amountOf(slip(standardRows({
  base, extra: [row(comp('UNION_FEE', 'DEDUCTION'), 'FORMULA', 'MIN(MUC_RIENG / 100 * INSURANCE_BASE, 234000)', 700)],
}).map((r) => (r.component.code === 'UNION_FEE' ? { ...r, amount: 1 } : r))), 'UNION_FEE');
check('đoàn phí bị chặn ở trần', doanPhi(46_800_000), 234_000);
check('dưới trần thì giữ nguyên', doanPhi(10_000_000), 100_000);

// --- Điều chỉnh truy lĩnh / truy thu -----------------------------------------
const adj = (over: Partial<PayrollAdjustment>): PayrollAdjustment => ({
  id: 'a1', user_id: 'u1', kind: 'RECOVERY', amount: 1_000_000,
  reason: 'Tính thiếu tăng ca', taxable: true, origin_month: '2026-07-01', ...over,
});
const truyLinh = slip(standardRows(), stats(), { adjustments: [adj({ amount: 2_000_000 })] });
check('truy lĩnh cộng vào gross', truyLinh.gross, monthly.gross + 2_000_000);
check('truy lĩnh nằm trong tổng các khoản cộng mà công thức đọc', truyLinh.values.THU_NHAP_CHIU_THUE, 22_000_000);
check('dòng truy lĩnh ghi rõ kỳ gốc',
  truyLinh.lines.find((l) => l.code === 'ADJ_RECOVERY')?.detail, 'Kỳ 07/2026 — Tính thiếu tăng ca');
const truyThu = slip(standardRows(), stats(), { adjustments: [adj({ kind: 'CLAWBACK', amount: 500_000, reason: 'Trả thừa phụ cấp' })] });
check('truy thu không đổi gross', truyThu.gross, monthly.gross);
check('truy thu không đổi thu nhập tính thuế', truyThu.values.THU_NHAP_TINH_THUE, monthly.values.THU_NHAP_TINH_THUE);
check('truy thu trừ vào thực nhận', truyThu.netPay, monthly.netPay - 500_000);
check('không có điều chỉnh thì không đổi gì', slip(standardRows(), stats(), { adjustments: [] }).netPay, monthly.netPay);

// Điều chỉnh gắn vào đầu mục: sửa thẳng số của đầu mục, không thêm dòng riêng
const baseWork = amountOf(monthly, 'BASE_WORK');
const congVaoKhoan = slip(standardRows(), stats(), { adjustments: [adj({ component_code: 'BASE_WORK', amount: 300_000 })] });
check('cộng vào đầu mục: số đầu mục tăng đúng số điều chỉnh', amountOf(congVaoKhoan, 'BASE_WORK'), baseWork + 300_000);
check('cộng vào đầu mục: không sinh dòng điều chỉnh riêng', congVaoKhoan.lines.some((l) => l.code === 'ADJ_RECOVERY'), false);
check('cộng vào đầu mục: gross tăng đúng số điều chỉnh', congVaoKhoan.gross, monthly.gross + 300_000);
const truKhoan = slip(standardRows(), stats(), { adjustments: [adj({ kind: 'CLAWBACK', component_code: 'BASE_WORK', amount: 200_000 })] });
check('trừ bớt khỏi đầu mục thu nhập: số đầu mục giảm', amountOf(truKhoan, 'BASE_WORK'), baseWork - 200_000);
check('trừ bớt khỏi đầu mục thu nhập: thực nhận giảm đúng số đó', truKhoan.netPay, monthly.netPay - 200_000);
const doiLuongCoBan = slip(standardRows(), stats(), { adjustments: [adj({ component_code: 'LUONG_CO_BAN', amount: 5_000_000 })] });
check('điều chỉnh dòng trung gian: cộng vào giá trị', amountOf(doiLuongCoBan, 'LUONG_CO_BAN'), 25_000_000);
check('điều chỉnh dòng trung gian: không thành dòng tiền riêng', doiLuongCoBan.lines.some((l) => l.code === 'ADJ_RECOVERY'), false);
check('điều chỉnh dòng trung gian: công thức đọc giá trị mới', (amountOf(doiLuongCoBan, 'BASE_WORK') ?? 0) > (baseWork ?? 0), true);
const khoanChuaCo = slip(standardRows(), stats(), { adjustments: [adj({ component_code: 'KHONG_CO_TREN_PHIEU', amount: 100_000 })] });
check('đầu mục không có trên phiếu: thành dòng điều chỉnh riêng', khoanChuaCo.lines.some((l) => l.code === 'ADJ_RECOVERY'), true);

// --- Làm tròn thực lĩnh tới hàng nghìn ---------------------------------------
const lamTron = slip(standardRows({ base: 20_123_456 }), stats(), {
  params: toPayrollParams({ ...TEST_VERSION, netRoundingUnit: 1000 }, { standardHoursPerDay: 8 }),
});
check('thực lĩnh làm tròn tới hàng nghìn', lamTron.netPay % 1000, 0);
check('chênh lệch làm tròn ghi riêng, không quá nửa đơn vị',
  Math.abs(lamTron.roundingAdjustment) <= 500
    && lamTron.netPay === lamTron.gross - lamTron.totalDeductions + lamTron.roundingAdjustment,
  true);

// --- Công thức của một người chỉ đọc số liệu CỦA CHÍNH NGƯỜI ĐÓ ------------
const luongCb = comp('LUONG_CB', 'INFO', { name: 'Lương cơ bản' });
const luongCong = comp('LUONG_CONG', 'EARNING', { name: 'Lương công' });
const slipFor = (muc: number) => slip([
  row(luongCb, 'PER_PERSON', muc, 10),
  row(luongCong, 'FORMULA', '(LUONG_CB / STANDARD_DAYS) * PAID_DAYS', 20),
], { ...stats(24.5), workDays: 24.5 });
const a = amountOf(slipFor(8_000_000), 'LUONG_CONG') ?? 0;
const b = amountOf(slipFor(20_000_000), 'LUONG_CONG') ?? 0;
check('mỗi người ra một con số khác nhau', a !== b && a > 0, true);
check('tỷ lệ đúng bằng tỷ lệ mức riêng của hai người', Math.round((b / a) * 1000) / 1000, 2.5);
check('tính lại A sau khi tính B vẫn ra đúng số của A', amountOf(slipFor(8_000_000), 'LUONG_CONG'), a);

// --- Hoa hồng bậc thang ------------------------------------------------------
const hoaHongRows = () => {
  order = 0;
  return [
    row(comp('DOANH_SO', 'INFO'), 'MONTHLY_INPUT'),
    row(comp('DOANH_SO_KHOAN', 'INFO'), 'MONTHLY_INPUT'),
    row(comp('LUONG_DOANH_SO', 'EARNING', { name: 'Lương doanh thu' }), 'FORMULA',
      'IF(DOANH_SO_KHOAN > 0, DOANH_SO * HH_BL02(DOANH_SO / DOANH_SO_KHOAN * 100), 0)'),
  ];
};
check('hoa hồng: đạt 95% → 3% × 950tr = 28,5tr',
  amountOf(slip(hoaHongRows(), stats(), { inputs: { DOANH_SO: 950_000_000, DOANH_SO_KHOAN: 1_000_000_000 } }), 'LUONG_DOANH_SO'),
  28_500_000);
check('chưa có doanh số khoán: dòng ra 0đ, không biến mất khỏi phiếu',
  amountOf(slip(hoaHongRows(), stats(), { inputs: { DOANH_SO: 950_000_000, DOANH_SO_KHOAN: 0 } }), 'LUONG_DOANH_SO'), 0);

// --- Dữ liệu tự động ---------------------------------------------------------
const tuDong = systemScope(stats(20), params, { KPI_PCT: 85 });
check('ngày nghỉ không lương = công chuẩn − ngày hưởng lương', tuDong.UNPAID_DAYS, 6);
check('tỷ lệ KPI là phần trăm thật', tuDong.TY_LE_KPI, 0.85);
check('giờ chuẩn mỗi ngày', tuDong.HOURS_PER_DAY, 8);

// --- Nhật ký tính cho Chạy thử -------------------------------------------------
const nhatKy = slip(standardRows(), stats(), { trace: true });
check('chạy thử ghi đủ từng dòng', nhatKy.trace?.length, standardRows().length);
check('nhật ký có công thức đã thay số', typeof nhatKy.trace?.find((step) => step.code === 'BASE_WORK')?.rendered, 'string');
check('tính thường không tốn công ghi nhật ký', monthly.trace, undefined);

// --- Tổng hợp công ----------------------------------------------------------
const att = [
  { id: 'a1', user_id: 'u1', date: '2026-09-01', check_in_time: '2026-09-01T01:00:00Z', check_out_time: '2026-09-01T10:00:00Z' },
  { id: 'a2', user_id: 'u1', date: '2026-09-02', check_in_time: '2026-09-02T01:00:00Z', check_out_time: null },
  { id: 'a3', user_id: 'u1', date: '2026-09-01', check_in_time: '2026-09-01T01:00:00Z', check_out_time: '2026-09-01T10:00:00Z' },
] as any[];
const leaveReqs = [{ user_id: 'u1', start_date: '2026-09-07', end_date: '2026-09-08', half_day: false }] as any[];
const summary = summarisePeriod(att, leaveReqs, new Date(2026, 8, 1), 8);
check('ngày công đếm theo ngày duy nhất', summary.workDays, 2);
check('giờ làm', summary.workHours, 18);
check('thiếu check-out', summary.missingCheckout, 1);
check('ngày phép trong tháng', summary.leaveDays, 2);
check('chưa truyền ngày lễ thì holidayDays = 0', summary.holidayDays, 0);

// --- Ngày nghỉ lễ (L03) -------------------------------------------------------
// 2026-09-01 (Thứ 3): đã đi làm thật -> KHÔNG tính là ngày lễ (tránh trả 2 lần).
// 2026-09-03 (Thứ 5): không đi làm, không nghỉ phép -> ngày lễ.
// 2026-09-06 (Chủ nhật): cuối tuần vốn không phải ngày công -> không tính.
// 2026-09-07 (Thứ 2): rơi trong đơn nghỉ phép -> tính là NGÀY LỄ, không phải
//   ngày phép. Người lao động không bị trừ quỹ phép cho một ngày vốn đã nghỉ,
//   đúng như `countWorkingDays` bên `leave.ts` đang tính quỹ.
const holidays = ['2026-09-01', '2026-09-03', '2026-09-06', '2026-09-07'];
const withHolidays = summarisePeriod(att, leaveReqs, new Date(2026, 8, 1), 8, holidays);
check('ngày lễ không đè lên ngày đã đi làm', withHolidays.holidayDays, 2);
check('ngày lễ trong kỳ nghỉ không bị tính là ngày phép', withHolidays.leaveDays, 1);
// Điều PHẢI giữ nguyên là TỔNG — đổi cách quy kết giữa phép và lễ không được
// làm đổi số tiền. Trước khi sửa: 2 công + 2 phép + 1 lễ. Sau: 2 + 1 + 2.
check('đổi cách quy kết không làm đổi tổng ngày hưởng lương', withHolidays.paidDays, 5);
check('tổng luôn bằng ba thành phần cộng lại',
  withHolidays.paidDays,
  withHolidays.workDays + withHolidays.leaveDays + withHolidays.holidayDays);

// --- Lịch làm việc: công chuẩn theo tháng (P02) ------------------------------
const schedules: ScheduleSet = {
  supported: true,
  schedules: [{
    id: 's1', name: 'Giờ mùa hè',
    effective_from: '2026-01-01', effective_to: null,
    start_time: '08:00', end_time: '17:30',
    break_minutes: 90, saturday_mode: 'HALF', grace_minutes: 0,
    is_active: true, note: null,
  }],
};

// Ví dụ chính trong đặc tả: T8/2026 có 21 ngày thứ Hai–Sáu + 5 thứ Bảy.
// Thứ Bảy nửa ngày → 21 + 2,5 = 23,5 công. Đây là con số trên phiếu mẫu
// của khách, thay cho hằng số 26 mà hệ thống dùng trước đây.
check('công chuẩn T8/2026 = 23,5 (đúng phiếu mẫu)',
  monthStandardDays(schedules, new Date(2026, 7, 1)), 23.5);

// Ngày lễ bị loại khỏi công chuẩn — người lao động không phải đi làm, phần
// tiền đi qua khoản Lương nghỉ lễ (L03). So với chính tháng đó thay vì gõ
// cứng một con số: lịch mỗi tháng một khác, gõ cứng là kiểm chứng phép tính
// nhẩm của người viết test chứ không phải kiểm chứng code.
const sepBase = monthStandardDays(schedules, new Date(2026, 8, 1)) ?? 0;
check('2 ngày lễ ngày thường giảm đúng 2 công',
  monthStandardDays(schedules, new Date(2026, 8, 1), ['2026-09-02', '2026-09-03']), sepBase - 2);

// 2026-09-06 là Chủ nhật — vốn đã không phải ngày công nên không giảm thêm.
check('lễ rơi vào Chủ nhật không giảm công chuẩn',
  monthStandardDays(schedules, new Date(2026, 8, 1), ['2026-09-06']), sepBase);

check('thứ Bảy nghỉ hẳn thì công chuẩn thấp hơn',
  monthStandardDays(
    { supported: true, schedules: [{ ...schedules.schedules[0], saturday_mode: 'OFF' }] },
    new Date(2026, 7, 1),
  ), 21);

check('chưa khai ca thì trả null (không đoán bừa)',
  monthStandardDays(EMPTY_SCHEDULES, new Date(2026, 7, 1)), null);

// Dòng giải thích phải cộng ra đúng công chuẩn, kể cả khi có ngày lễ.
const giaiThich = monthStandardBreakdown(schedules, new Date(2026, 7, 1));
check('giải thích T8/2026: 21 ngày T2–T6',
  giaiThich?.lines.find((line) => line.label.startsWith('Thứ Hai'))?.count, 21);
check('giải thích T8/2026: 5 thứ Bảy × 0,5',
  giaiThich?.lines.find((line) => line.label === 'Thứ Bảy'), { label: 'Thứ Bảy', count: 5, weight: 0.5 });
const giaiThichLe = monthStandardBreakdown(schedules, new Date(2026, 8, 1), ['2026-09-02', '2026-09-06']);
check('giải thích: tổng các dòng bằng công chuẩn',
  giaiThichLe?.lines.reduce((sum, line) => sum + line.count * line.weight, 0), giaiThichLe?.total);
check('giải thích: lễ vào Chủ nhật không liệt kê là ngày bị trừ', giaiThichLe?.holidayDates, ['2026-09-02']);
check('giải thích: chưa khai ca thì null', monthStandardBreakdown(EMPTY_SCHEDULES, new Date(2026, 7, 1)), null);
// --- Đo đi muộn (L16/L17/L14/LU-06) -----------------------------------------
const punctual = measurePunctuality(schedules, [
  // Đúng giờ.
  { date: '2026-08-03', check_in_time: '2026-08-03T08:00:00', check_out_time: '2026-08-03T17:30:00' },
  // Muộn 12 phút.
  { date: '2026-08-04', check_in_time: '2026-08-04T08:12:00', check_out_time: '2026-08-04T17:30:00' },
  // Muộn 65 phút, vào sau 9h → thuộc nhóm bị trừ nửa công theo L16.
  { date: '2026-08-05', check_in_time: '2026-08-05T09:05:00', check_out_time: '2026-08-05T17:30:00' },
  // Về sớm 30 phút.
  { date: '2026-08-06', check_in_time: '2026-08-06T08:00:00', check_out_time: '2026-08-06T17:00:00' },
  // Chủ nhật: không có khái niệm đi muộn.
  { date: '2026-08-09', check_in_time: '2026-08-09T10:00:00', check_out_time: '2026-08-09T15:00:00' },
]);
check('tổng phút muộn', punctual.lateMinutes, 12 + 65);
check('số lần muộn', punctual.lateCount, 2);
check('số lần vào sau 9h', punctual.lateAfterCutoffCount, 1);
check('phút về sớm', punctual.earlyMinutes, 30);
check('chủ nhật không tính muộn', punctual.lateCount, 2);

const excused = measurePunctuality(
  schedules,
  [
    { date: '2026-08-04', check_in_time: '2026-08-04T08:20:00', check_out_time: '2026-08-04T17:00:00' },
  ],
  [],
  { lateDates: new Set(['2026-08-04']), earlyDates: new Set(['2026-08-04']) },
);
check('đơn đi muộn đã duyệt loại ngày khỏi phạt muộn', excused.lateMinutes, 0);
check('đơn về sớm đã duyệt loại ngày khỏi phạt về sớm', excused.earlyMinutes, 0);

const overnight = measurePunctuality(
  { supported: true, schedules: [{ ...schedules.schedules[0], start_time: '22:00', end_time: '06:00' }] },
  [{ date: '2026-08-03', check_in_time: '2026-08-03T22:00:00', check_out_time: '2026-08-04T05:45:00' }],
);
check('ca qua đêm checkout 05:45 chỉ về sớm 15 phút', overnight.earlyMinutes, 15);

// Phút ân hạn: muộn 12 phút với ân hạn 15 phút thì không tính là muộn.
const withGrace = measurePunctuality(
  { supported: true, schedules: [{ ...schedules.schedules[0], grace_minutes: 15 }] },
  [{ date: '2026-08-04', check_in_time: '2026-08-04T08:12:00', check_out_time: '2026-08-04T17:30:00' }],
);
check('ân hạn 15 phút bỏ qua muộn 12 phút', withGrace.lateCount, 0);

check('chưa khai ca thì không đo muộn',
  measurePunctuality(EMPTY_SCHEDULES, [
    { date: '2026-08-04', check_in_time: '2026-08-04T10:00:00', check_out_time: null },
  ]).lateCount, 0);

// Biến chuyên cần phải tới được công thức lương, nếu không thì đo xong để đó.
const lateStats = summarisePeriod(
  [
    { id: 'a', user_id: 'u1', date: '2026-08-04', check_in_time: '2026-08-04T08:20:00', check_out_time: '2026-08-04T17:30:00' },
  ] as any[],
  [], new Date(2026, 7, 1), 8, [], schedules,
);
check('summarisePeriod trả phút muộn', lateStats.lateMinutes, 20);

const phatMuon = slip([
  row(comp('LATE_FINE', 'DEDUCTION', { name: 'Phạt đi muộn' }), 'FORMULA',
    // Thang ví dụ: 5.000đ/phút cho 15 phút đầu, 10.000đ từ phút 16.
    'MIN(LATE_MINUTES, 15) * 5000 + MAX(LATE_MINUTES - 15, 0) * 10000'),
], stats(26, 0, 0, { lateMinutes: 20 }));
check('công thức phạt đi muộn đọc được số phút đi muộn', amountOf(phatMuon, 'LATE_FINE'), 15 * 5000 + 5 * 10000);

// --- Chấm phiếu KPI -------------------------------------------------------
// Bản tính ở màn hình phải ra đúng số mà kpi_recalc_sheet chốt dưới database
// (đã chạy thử cùng bộ số: 82,5% tự chấm; 105% duyệt có thưởng 5%).
const crit = (over: Partial<KpiCriterion>): KpiCriterion => ({
  category: 'A', name: 'x', measure: null, group_code: 'QUANT', weight: 25, standard_score: 4, method: 'LEVEL',
  levels: [], ranges: [], value_unit: null, penalty_pct: null, allow_over: false, source: null, ...over,
});
const phieu = [
  crit({ category: 'Xuất hàng', name: 'Xuất đúng', weight: 30 }),
  crit({ category: 'Xuất hàng', name: 'Xuất kịp', weight: 20, method: 'RANGE',
    ranges: [{ min: 95, max: null, score: 4 }, { min: 80, max: 95, score: 3 }, { min: null, max: 80, score: 1 }] }),
  crit({ category: 'Tem', name: 'Tem HQ', weight: 30, standard_score: 1, method: 'PENALTY', penalty_pct: 10 }),
  crit({ category: 'Chuyên cần', name: 'Đúng giờ', weight: 20, group_code: 'QUAL', allow_over: true }),
];
const tuCham = previewSheet(phieu, [
  { value: null, score: 3, na: false },
  { value: null, score: null, na: true },
  { value: 1, score: null, na: false },
  { value: null, score: 5, na: false },
]);
check('không phát sinh: tỷ trọng dồn cho tiêu chí cùng hạng mục', tuCham.eff.map((w) => Math.round(w * 100) / 100), [50, 0, 30, 20]);
check('tự chấm: 3/4×50 + (30 − 10) + 5/4×20 = 82,5', tuCham.total, 82.5);
const duyet = previewSheet(phieu, [
  { value: null, score: 4, na: false },
  { value: null, score: null, na: true },
  { value: 0, score: null, na: false },
  { value: null, score: 4, na: false },
]);
check('duyệt đủ điểm = 100%', duyet.total, 100);
check('thưởng trọng điểm 5% → 105%', finalPct(duyet.total, 5, 120), 105);
check('chặn trần 120%', finalPct(118, 10, 120), 120);
check('105% xếp A+', gradeOf(105, DEFAULT_GRADES)?.code, 'A+');
check('100% xếp A', gradeOf(100, DEFAULT_GRADES)?.code, 'A');
check('80,5% xếp C', gradeOf(80.5, DEFAULT_GRADES)?.code, 'C');
check('trừ theo lần không âm quá tỷ trọng', previewSheet([crit({ method: 'PENALTY', penalty_pct: 10, weight: 100, standard_score: 1 })],
  [{ value: 15, score: null, na: false }]).total, 0);

// Cả hạng mục không phát sinh: dồn cho các hạng mục còn lại cùng nhóm.
const caHangMuc = previewSheet([
  crit({ category: 'A', weight: 40 }), crit({ category: 'B', weight: 40 }), crit({ category: 'C', weight: 20, group_code: 'QUAL' }),
], [{ value: null, score: 4, na: false }, { value: null, score: null, na: true }, { value: null, score: 4, na: false }]);
check('cả hạng mục không phát sinh dồn trong nhóm', caHangMuc.eff, [80, 0, 20]);

check('dải quy đổi: cận dưới tính vào dải', scoreFromValue([{ min: 95, max: null, score: 4 }, { min: 80, max: 95, score: 3 }], 95), 4);
check('dải quy đổi: ngoài mọi dải thì chưa có điểm', scoreFromValue([{ min: 95, max: null, score: 4 }], 50), null);
check('bộ KPI tổng 96% bị chặn', setProblems([crit({ weight: 96, levels: [{ score: 4, label: 'ok' }] })]).length > 0, true);
check('dải chồng nhau bị chặn', setProblems([crit({ weight: 100, method: 'RANGE',
  ranges: [{ min: 0, max: 10, score: 4 }, { min: 5, max: null, score: 1 }] })]).some((p) => p.includes('chồng')), true);
check('bộ hợp lệ không báo gì', setProblems([crit({ weight: 100, levels: [{ score: 4, label: 'ok' }] })]), []);

// --- Chia giờ tăng ca theo Điều 98 BLLĐ 2019 --------------------------------
//
// "Ngày nghỉ" (200%) KHÔNG đồng nghĩa thứ Bảy + Chủ nhật. Công ty khai
// `saturday_mode` cho từng ca, nên thứ Bảy có thể là ngày làm. Gán cứng thứ
// Bảy vào rổ 200% là trả dư một phần ba cho mọi giờ tăng ca hôm đó.
const caThuBayLam: ScheduleSet = {
  supported: true,
  schedules: [{ ...schedules.schedules[0], saturday_mode: 'FULL' }],
};
const caThuBayNghi: ScheduleSet = {
  supported: true,
  schedules: [{ ...schedules.schedules[0], saturday_mode: 'OFF' }],
};
// 2026-08-08 là thứ Bảy, 2026-08-09 là Chủ nhật, 2026-08-07 là thứ Sáu.
const donOt = [
  { request_type: 'OVERTIME', work_date: '2026-08-07', hours: 2 },
  { request_type: 'OVERTIME', work_date: '2026-08-08', hours: 3 },
  { request_type: 'OVERTIME', work_date: '2026-08-09', hours: 4 },
];
check('công ty LÀM thứ Bảy: OT thứ Bảy vào rổ 150%',
  splitOvertimeHours(donOt, caThuBayLam, new Set()), { weekday: 5, weekend: 4, holiday: 0 });
check('công ty NGHỈ thứ Bảy: OT thứ Bảy vào rổ 200%',
  splitOvertimeHours(donOt, caThuBayNghi, new Set()), { weekday: 2, weekend: 7, holiday: 0 });
check('ngày lễ thắng tất cả, kể cả ngày thường',
  splitOvertimeHours(donOt, caThuBayLam, new Set(['2026-08-07'])), { weekday: 3, weekend: 4, holiday: 2 });
check('chưa khai ca nào thì lùi về quy ước T7+CN',
  splitOvertimeHours(donOt, EMPTY_SCHEDULES, new Set()), { weekday: 2, weekend: 7, holiday: 0 });
check('đơn không phải tăng ca thì bỏ qua',
  splitOvertimeHours([{ request_type: 'LATE_ARRIVAL', work_date: '2026-08-07', hours: 9 }], caThuBayLam, new Set()),
  { weekday: 0, weekend: 0, holiday: 0 });
check('giờ âm hoặc rỗng không được cộng vào',
  splitOvertimeHours([
    { request_type: 'OVERTIME', work_date: '2026-08-07', hours: -3 },
    { request_type: 'OVERTIME', work_date: '2026-08-07', hours: null },
  ], caThuBayLam, new Set()), { weekday: 0, weekend: 0, holiday: 0 });

// --- Ngày hưởng lương phải đếm cùng quyển lịch với công chuẩn ---------------
//
// `standardDays` lấy từ `monthStandardDays`, đếm thứ Bảy 0,5 hoặc 1 theo
// `saturday_mode`. Nếu `paidDays` lại bỏ hẳn thứ Bảy thì hai vế của phép chia
// `base / standardDays * paidDays` dùng hai quyển lịch khác nhau, và người
// nghỉ phép trọn tháng bị trả thiếu — không có gì báo ra.
const lichT7Nua: ScheduleSet = {
  supported: true,
  schedules: [{ ...schedules.schedules[0], saturday_mode: 'HALF' }],
};
// 2026-08-08 là thứ Bảy. Đơn nghỉ phủ đúng thứ Sáu 07 và thứ Bảy 08.
const nghiQuaThuBay = [{
  user_id: 'u1', start_date: '2026-08-07', end_date: '2026-08-08',
  half_day: false, status: 'approved', leave_type: 'annual', days: 2,
} as unknown as LeaveRequest];

check('thứ Bảy nửa ngày: nghỉ phép hưởng 1,5 công chứ không phải 1',
  summarisePeriod([], nghiQuaThuBay, new Date(2026, 7, 1), 8, [], lichT7Nua).leaveDays, 1.5);
const lichT7Nghi: ScheduleSet = {
  supported: true,
  schedules: [{ ...schedules.schedules[0], saturday_mode: 'OFF' }],
};
check('công ty nghỉ hẳn thứ Bảy thì chỉ 1 công',
  summarisePeriod([], nghiQuaThuBay, new Date(2026, 7, 1), 8, [], lichT7Nghi).leaveDays, 1);
check('công ty làm đủ thứ Bảy thì hưởng 2 công',
  summarisePeriod([], nghiQuaThuBay, new Date(2026, 7, 1), 8, [], {
    supported: true, schedules: [{ ...schedules.schedules[0], saturday_mode: 'FULL' }],
  }).leaveDays, 2);
check('chưa khai ca nào thì giữ nguyên nếp cũ (T7 không tính)',
  summarisePeriod([], nghiQuaThuBay, new Date(2026, 7, 1), 8).leaveDays, 1);
check('lễ rơi vào thứ Bảy nửa ngày vẫn hưởng 0,5 công',
  summarisePeriod([], [], new Date(2026, 7, 1), 8, ['2026-08-08'], lichT7Nua).holidayDays, 0.5);
check('lễ rơi vào Chủ nhật không hưởng công nào',
  summarisePeriod([], [], new Date(2026, 7, 1), 8, ['2026-08-09'], lichT7Nua).holidayDays, 0);

// --- Công thức: IF chỉ tính nhánh được chọn, ROUND(x, -3), biểu bậc thang ----
check('IF không nổ chia 0 ở nhánh không chọn',
  evaluateFormula('IF(KHOAN > 0, DS / KHOAN, 0)', { KHOAN: 0, DS: 5 }).value, 0);
check('toán tử ? : cũng vậy', evaluateFormula('KHOAN > 0 ? DS / KHOAN : 7', { KHOAN: 0, DS: 5 }).value, 7);
check('&& đi tắt', evaluateFormula('KHOAN > 0 && DS / KHOAN > 1', { KHOAN: 0, DS: 5 }).value, 0);
check('ROUND(x, -3) tới hàng nghìn', evaluateFormula('ROUND(17459600, -3)', {}).value, 17_460_000);
check('ROUND nửa đơn vị làm tròn ra xa 0', evaluateFormula('ROUND(2500, -3)', {}).value, 3_000);
check('ROUND(1.005, 2) = 1,01 như Excel (không vấp sai số dấu phẩy động)', evaluateFormula('ROUND(1.005, 2)', {}).value, 1.01);
expectError('biến gõ sai ở nhánh KHÔNG chọn vẫn bị bắt', 'IF(1 > 0, 5, BIEN_SAI)');
let viTri: number | undefined;
try { evaluateFormula('BASE * HE_SAI', { BASE: 1 }); } catch (error) { viTri = (error as { at?: number }).at; }
check('lỗi chỉ đúng vị trí ký tự', viTri, 7);
const hhBl02 = tierLookup([{ from: 0, value: 0 }, { from: 75, value: 1.5 }, { from: 90, value: 3 }, { from: 105, value: 4 }]);
check('bậc thang: 74,9% → 0', hhBl02(74.9), 0);
check('bậc thang: 89,5% → 1,5 (lấp khoảng hở 89–90%)', hhBl02(89.5), 1.5);
check('bậc thang: 104,5% → 3 (lấp khoảng hở 104–105%)', hhBl02(104.5), 3);
check('bậc thang: 160% → 4', hhBl02(160), 4);

// --- Bút toán kết chuyển lương ----------------------------------------------
// Hệ thống không biết dòng trừ nào là bảo hiểm hay thuế: mỗi đầu mục trừ một
// bút toán, theo đúng tên người dùng đặt.
const journal = buildPayrollJournal([
  { profile: { id: 'u1', name: 'A', department: 'Kinh doanh', unit_id: null }, computed: monthly },
  { profile: { id: 'u2', name: 'B', department: null, unit_id: null }, computed: monthly },
]);
check('bút toán cân Nợ = Có', journal.balanced, true);
check('gộp theo bộ phận, không theo từng người', new Set(journal.entries.map((e) => e.department)).size, 2);
check('chi phí lương Nợ 642 / Có 334 bằng tổng các khoản cộng',
  journal.entries.filter((e) => e.debit === '642' && e.credit === '334').reduce((sum, e) => sum + e.amount, 0), monthly.gross * 2);
check('mỗi đầu mục trừ một bút toán Nợ 334 / Có 338, mang tên đầu mục',
  journal.entries.filter((e) => e.debit === '334' && e.department === 'Kinh doanh').map((e) => e.description),
  ['BHXH, BHYT, BHTN — Kinh doanh', 'Thuế TNCN — Kinh doanh']);
check('tổng thu nhập khớp bảng lương', journal.totals.gross, monthly.gross * 2);
check('tổng khấu trừ khớp bảng lương', journal.totals.deductions, monthly.totalDeductions * 2);
check('tổng thực chi khớp bảng lương', journal.totals.netPay, monthly.netPay * 2);
check('người chưa gán bộ phận vẫn vào sổ', journal.entries.some((e) => e.department === 'Chưa gán bộ phận'), true);
const khongThue = slip(standardRows({ dependents: 3 }));
check('đầu mục trừ bằng 0 không sinh bút toán',
  buildPayrollJournal([{ profile: { id: 'u3', name: 'C', department: 'Kho', unit_id: null }, computed: khongThue }])
    .entries.some((e) => e.description.startsWith('Thuế TNCN')), false);

// Gom theo ĐƠN VỊ trên cơ cấu tổ chức, ô chữ tự do chỉ là phương án lùi.
const unitNames = new Map([['u-kd', 'Phòng Kinh doanh'], ['u-kt', 'Phòng Kế toán']]);
const byUnit = buildPayrollJournal([
  { profile: { id: 'a', name: 'A', department: null, unit_id: 'u-kd' }, computed: monthly },
  { profile: { id: 'b', name: 'B', department: null, unit_id: 'u-kt' }, computed: monthly },
], undefined, unitNames);
check('gom theo tên đơn vị dù ô chữ bỏ trống',
  [...new Set(byUnit.entries.map((e) => e.department))].sort(), ['Phòng Kế toán', 'Phòng Kinh doanh'].sort());
check('chưa gán đơn vị thì lùi về ô chữ cũ',
  buildPayrollJournal([{ profile: { id: 'c', name: 'C', department: 'Kho vận', unit_id: null }, computed: monthly }], undefined, unitNames)
    .entries.every((e) => e.department === 'Kho vận'), true);

// --- Giải cơ chế theo CÂY tổ chức -------------------------------------------
const donVi = new Map([
  ['hp', { id: 'hp', name: 'Huy Phong', parent_id: null }],
  ['kd', { id: 'kd', name: 'Khối Kinh doanh', parent_id: 'hp' }],
  ['kd1', { id: 'kd1', name: 'Phòng KD1', parent_id: 'kd' }],
]);
const phuCap = comp('PHU_CAP', 'EARNING', { id: 'pc', name: 'Phụ cấp' });
/** Dòng cơ chế chung của một đơn vị; mặc định là dòng "Giá trị" 100.000 từ 01/2026. */
const dongDonVi = (id: string, unitId: string, over: Partial<UnitPayItem> = {}): UnitPayItem => ({
  id, unit_id: unitId, component_id: 'pc', mode: 'VALUE', amount: 100_000, formula: null, sort_order: 10,
  effective_from: '2026-01-01', effective_to: null, note: null, created_by: null, created_at: '', updated_at: '',
  ...over,
} as UnitPayItem);
const dongRieng = (amount: number | null, formula: string | null = null): EmployeePayItem => ({
  id: 'e1', user_id: 'u9', component_id: 'pc', amount, formula, effective_from: '2026-01-01', effective_to: null,
  note: null, created_by: null, created_at: '', updated_at: '',
} as EmployeePayItem);
const nguonCay = {
  components: [phuCap],
  unitById: donVi,
  unitItems: [dongDonVi('c1', 'hp')] as UnitPayItem[],
  employeeItems: [] as EmployeePayItem[],
};
const nvKd1 = { id: 'u9', unit_id: 'kd1' };
const giai = (data: typeof nguonCay, month = '2026-10-01', end = '2026-10-31') =>
  resolveMechanismRows(nvKd1, data as never, month, end);
check('đơn vị con thừa hưởng cơ chế chung của công ty, ghi nguồn bằng tên đơn vị',
  giai(nguonCay).map((r) => [r.amount, r.origin]), [[100_000, 'Huy Phong']]);
const coKhoi = { ...nguonCay, unitItems: [dongDonVi('c1', 'hp'), dongDonVi('c2', 'kd', { amount: 300_000 })] };
check('đơn vị GẦN nhất khai lại thì thay hẳn dòng của cấp trên',
  giai(coKhoi).map((r) => [r.amount, r.origin]), [[300_000, 'Khối Kinh doanh']]);
const coPhong = { ...coKhoi, unitItems: [...coKhoi.unitItems, dongDonVi('c3', 'kd1', { amount: 400_000 })] };
check('phòng khai lại thì thắng khối',
  giai(coPhong).map((r) => [r.amount, r.origin]), [[400_000, 'Phòng KD1']]);
check('đơn vị khác nhánh không ảnh hưởng',
  resolveMechanismRows({ id: 'x', unit_id: 'hp' }, coPhong as never, '2026-10-01', '2026-10-31').map((r) => r.amount), [100_000]);
check('khai riêng của người thắng tất cả',
  giai({ ...coPhong, employeeItems: [dongRieng(999_000)] }).map((r) => [r.amount, r.origin]), [[999_000, 'Riêng']]);
check('đơn vị con đặt OFF thì bỏ dòng của cấp trên',
  giai({ ...nguonCay, unitItems: [dongDonVi('c1', 'hp'), dongDonVi('c4', 'kd', { mode: 'OFF', amount: null })] }).length, 0);
check('khai riêng thêm lại được dòng đã OFF',
  giai({ ...nguonCay, unitItems: [dongDonVi('c1', 'hp'), dongDonVi('c4', 'kd', { mode: 'OFF', amount: null })],
    employeeItems: [dongRieng(50_000)] }).map((r) => [r.mode, r.amount]), [['VALUE', 50_000]]);
check('đầu mục đã khóa thì không lên phiếu',
  giai({ ...nguonCay, components: [{ ...phuCap, is_active: false }] }).length, 0);
const coCongThuc = { ...nguonCay, unitItems: [dongDonVi('c5', 'kd', { mode: 'FORMULA', formula: 'MUC_RIENG * WORK_DAYS', amount: null })] };
check('mức riêng trên dòng công thức đọc MUC_RIENG: công thức giữ nguyên',
  giai({ ...coCongThuc, employeeItems: [dongRieng(50_000)] }).map((r) => [r.mode, r.formula, r.amount]),
  [['FORMULA', 'MUC_RIENG * WORK_DAYS', 50_000]]);
check('dòng cơ chế hết hiệu lực trước tháng tính thì không lên phiếu',
  giai({ ...nguonCay, unitItems: [dongDonVi('c6', 'hp', { effective_to: '2026-09-30' })] }).length, 0);
check('dòng "Từng người" chưa khai giữ amount null để báo thiếu',
  giai({ ...nguonCay, unitItems: [dongDonVi('c7', 'hp', { mode: 'PER_PERSON', amount: null })] }).map((r) => [r.mode, r.amount]),
  [['PER_PERSON', null]]);

// --- Đề xuất cơ chế lương ----------------------------------------------------
check('tháng áp dụng sớm nhất = tháng sau kỳ đã chốt khi chưa có phiên bản sau đó',
  earliestSchemeMonth('2026-11-01', ['2026-03-01']), '2026-11-01');
check('không chen trước phiên bản đã có hiệu lực sau mốc chốt (cùng tháng thì được)',
  earliestSchemeMonth('2026-11-01', ['2026-12-01', '2026-02-01']), '2026-12-01');
check('phiên bản cũ ghi giữa tháng đẩy mốc sang đầu tháng sau',
  earliestSchemeMonth('2026-11-01', ['2026-12-15']), '2027-01-01');
const req = (id: string, status: 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'CANCELLED', user: string | null, unit: string | null) => ({
  id, code: id, target_type: (user ? 'USER' : 'UNIT') as 'USER' | 'UNIT', user_id: user, unit_id: unit, effective_from: '2026-11-01',
  status, payload: { items: [] }, note: null, created_by: null, created_at: '', updated_at: '', submitted_by: null,
  submitted_at: null, reviewed_by: null, reviewed_at: null, review_note: null, approval_fingerprint: null, applied_at: null,
});
check('đề xuất đã duyệt / đã huỷ không còn là đề xuất mở',
  openRequestFor([req('a', 'APPROVED', 'u1', null), req('b', 'CANCELLED', 'u1', null)] as never, { type: 'USER', id: 'u1' }), null);
check('đề xuất bị từ chối vẫn mở để sửa và trình lại',
  openRequestFor([req('a', 'APPROVED', 'u1', null), req('c', 'REJECTED', 'u1', null)] as never, { type: 'USER', id: 'u1' })?.id, 'c');
check('đề xuất của đơn vị không lẫn với đề xuất của người trùng id',
  openRequestFor([req('d', 'SUBMITTED', 'x', null)] as never, { type: 'UNIT', id: 'x' }), null);
check('BGĐ thấy đúng phần đổi: thêm / bỏ / đổi giá trị hay công thức, dòng giữ nguyên không tính',
  diffSchemeItems(
    [{ component_id: 'a', amount: 1, formula: null }, { component_id: 'b', amount: 2, formula: null },
      { component_id: 'c', amount: 3, formula: null }, { component_id: 'e', amount: null, formula: 'X * 2' }],
    [{ component_id: 'a', amount: 1, formula: null }, { component_id: 'b', amount: 5, formula: null },
      { component_id: 'd', amount: 4, formula: null }, { component_id: 'e', amount: null, formula: 'X * 3' }],
  ).map((change) => `${change.componentId}:${change.kind}`).sort().join(','), 'a:SAME,b:CHANGED,c:REMOVED,d:ADDED,e:CHANGED');

// --- Nhãn báo cáo: chỉ để báo cáo, không đổi cách tính ---------------------
const withTags = (rows: MechanismRow[], tags: Record<string, PayReportTag>) =>
  rows.map((r) => (tags[r.component.code]
    ? { ...r, component: { ...r.component, report_tag: tags[r.component.code] } }
    : r));
const BH_DN = comp('INS_EMPLOYER', 'INFO', { name: 'BH doanh nghiệp đóng' });
const ORDER_TAGS: Record<string, PayReportTag> = {
  INS_EMPLOYEE: 'INSURANCE_EMPLOYEE', PIT: 'INCOME_TAX', THU_NHAP_TINH_THUE: 'TAXABLE_INCOME', INS_EMPLOYER: 'INSURANCE_EMPLOYER',
};
const rowsNoTag = () => [...standardRows(), row(BH_DN, 'FORMULA', 'LUONG_CO_BAN * 0.215')];
const untagged = slip(rowsNoTag());
const tagged = slip(withTags(rowsNoTag(), ORDER_TAGS));

check('chưa gắn nhãn thì bốn cột báo cáo đều 0',
  untagged.reportTotals, { insuranceEmployee: 0, insuranceEmployer: 0, incomeTax: 0, taxableIncome: 0 });
check('gắn nhãn: BH người lao động = dòng bảo hiểm', tagged.reportTotals.insuranceEmployee, 2_100_000);
check('gắn nhãn: thuế = dòng thuế', tagged.reportTotals.incomeTax, 440_000);
check('gắn nhãn: thu nhập tính thuế', tagged.reportTotals.taxableIncome, 6_900_000);
check('gắn nhãn: doanh nghiệp đóng thêm', tagged.reportTotals.insuranceEmployer, 4_300_000);
check('nhãn không đổi thực lĩnh', tagged.netPay, untagged.netPay);
check('nhãn không đổi tổng trừ', tagged.totalDeductions, untagged.totalDeductions);
check('phần doanh nghiệp đóng thêm không trừ của nhân viên', tagged.totalDeductions, 2_540_000);
check('cộng bảo hiểm + thuế + khấu trừ còn lại = tổng trừ',
  tagged.reportTotals.insuranceEmployee + tagged.reportTotals.incomeTax
    + otherDeductionsOf(tagged.totalDeductions, tagged.reportTotals), tagged.totalDeductions);

// Thêm một khoản trừ không nhãn (tạm ứng): vào "khấu trừ còn lại", không vào bảo hiểm / thuế.
const withAdvance = slip(withTags([
  ...rowsNoTag(), row(comp('ADVANCE', 'DEDUCTION', { name: 'Tạm ứng' }), 'VALUE', 1_000_000),
], ORDER_TAGS));
check('khoản trừ không nhãn rơi vào phần khấu trừ còn lại',
  otherDeductionsOf(withAdvance.totalDeductions, withAdvance.reportTotals), 1_000_000);

// Nhãn người lao động đóng đặt nhầm lên dòng CỘNG thì bị bỏ qua — không làm lệch tổng trừ.
const wrongKind = slip(withTags(rowsNoTag(), { ...ORDER_TAGS, BASE_WORK: 'INSURANCE_EMPLOYEE', DAILY_RATE: 'INCOME_TAX' }));
check('nhãn đặt lên dòng cộng bị bỏ qua', wrongKind.reportTotals.insuranceEmployee, 2_100_000);
check('nhãn thuế đặt lên dòng trung gian bị bỏ qua', wrongKind.reportTotals.incomeTax, 440_000);

// Nhiều dòng cùng nhãn thì cộng lại.
check('nhiều dòng cùng nhãn được cộng',
  sumReportTags([
    { tag: 'INSURANCE_EMPLOYER', kind: 'INFO', amount: 1_000_000 },
    { tag: 'INSURANCE_EMPLOYER', kind: 'INFO', amount: 250_000 },
    { tag: null, kind: 'DEDUCTION', amount: 999 },
  ]).insuranceEmployer, 1_250_000);
check('nhãn khớp loại dòng: bảo hiểm NLĐ ↔ dòng trừ', reportTagFitsKind('INSURANCE_EMPLOYEE', 'DEDUCTION'), true);
check('nhãn khớp loại dòng: bảo hiểm NLĐ ✗ dòng cộng', reportTagFitsKind('INSURANCE_EMPLOYEE', 'EARNING'), false);
check('nhãn khớp loại dòng: doanh nghiệp đóng ↔ trung gian', reportTagFitsKind('INSURANCE_EMPLOYER', 'INFO'), true);
check('không nhãn thì hợp mọi loại dòng', reportTagFitsKind(null, 'EARNING'), true);
check('câu báo lỗi nói đúng loại dòng cần dùng',
  reportTagKindProblem('INCOME_TAX', 'INFO'), 'Nhãn “Thuế thu nhập cá nhân” chỉ dùng với loại dòng “Trừ khỏi lương”.');
check('nhãn hợp lệ không báo lỗi', reportTagKindProblem('TAXABLE_INCOME', 'INFO'), null);
check('đủ bốn nhãn báo cáo', PAY_REPORT_TAGS.map((tag) => tag.code).sort(),
  ['INCOME_TAX', 'INSURANCE_EMPLOYEE', 'INSURANCE_EMPLOYER', 'TAXABLE_INCOME']);

// --- Bảng lương mẫu BL 01 (bộ công thức gieo ở migration 20261021100000) --
// Tái hiện một dòng của sheet BL01 tháng 08/2026: bậc lương 10tr, trách nhiệm
// 10tr, đủ 23,5 công, không phạt, không người phụ thuộc. Bảo hiểm sheet tra từ
// bảng riêng; ở đây tính bằng 10,5% bậc lương (1.050.000).
{
  const bl01Version: PayrollParamVersion = {
    ...TEST_VERSION,
    standardWorkDays: 23.5,
    netRoundingUnit: 1000,
    tables: [
      TEST_VERSION.tables[0],
      {
        id: 'bl01', kind: 'LIST', name: 'Quy chế', note: null, params: [
          { code: 'GIAM_TRU_BAN_THAN', name: 'Giảm trừ bản thân', type: 'MONEY', unit: 'VND_THANG', value: 15_500_000, note: null },
          { code: 'GIAM_TRU_NPT', name: 'Giảm trừ người phụ thuộc', type: 'MONEY', unit: 'VND_THANG', value: 6_200_000, note: null },
          { code: 'TY_LE_QUY_1PT', name: 'Trừ 1% nhập quỹ', type: 'RATE', unit: '%', value: 1, note: null },
          { code: 'HE_SO_OT_THUONG', name: 'OT ngày thường', type: 'RATE', unit: 'HE_SO', value: 1.5, note: null },
          { code: 'HE_SO_OT_NGHI', name: 'OT ngày nghỉ', type: 'RATE', unit: 'HE_SO', value: 2, note: null },
          { code: 'HE_SO_OT_LE', name: 'OT ngày lễ', type: 'RATE', unit: 'HE_SO', value: 3, note: null },
          { code: 'DON_GIA_PHAT_DI_MUON', name: 'Phạt đi muộn', type: 'MONEY', unit: 'VND_LAN', value: 50_000, note: null },
          { code: 'DON_GIA_PHAT_DI_MUON_QUA_LAN', name: 'Phạt quá lần', type: 'MONEY', unit: 'VND_LAN', value: 100_000, note: null },
          { code: 'SO_LAN_DI_MUON_CHO_PHEP', name: 'Số lần đi muộn cho phép', type: 'COUNT', unit: 'LAN', value: 3, note: null },
        ],
      },
      {
        id: 'pit5', kind: 'TIER', name: 'Biểu thuế 5 bậc', note: null, code: 'THUE_LUY_TIEN', mode: 'PROGRESSIVE',
        inputLabel: 'Thu nhập tính thuế', unit: '%',
        rows: [
          { from: 0, value: 5 }, { from: 10_000_000, value: 10 }, { from: 30_000_000, value: 20 },
          { from: 60_000_000, value: 30 }, { from: 100_000_000, value: 35 },
        ],
      },
    ],
  };
  const bl01Params = toPayrollParams(bl01Version, { standardHoursPerDay: 8 });
  const mid = (code: string) => comp(code, 'INFO', { name: code, category_code: null });
  order = 0;
  const bl01Rows: MechanismRow[] = [
    row(mid('LUONG_CO_BAN'), 'PER_PERSON', 10_000_000),
    row(mid('DAILY_RATE'), 'FORMULA', 'LUONG_CO_BAN / STANDARD_DAYS'),
    row(mid('HOURLY_RATE'), 'FORMULA', 'DAILY_RATE / HOURS_PER_DAY'),
    row(mid('SO_CONG_DEM'), 'MONTHLY_INPUT'),
    row(comp('BASE_WORK'), 'FORMULA', 'DAILY_RATE * WORK_DAYS'),
    row(comp('BASE_HOLIDAY'), 'FORMULA', 'DAILY_RATE * HOLIDAY_DAYS'),
    row(comp('BASE_LEAVE'), 'FORMULA', 'DAILY_RATE * LEAVE_DAYS'),
    row(comp('OT_WEEKDAY'), 'FORMULA', 'HOURLY_RATE * HE_SO_OT_THUONG * OT_WEEKDAY_HOURS'),
    row(comp('CONG_THEM_DEM'), 'FORMULA', 'DAILY_RATE * SO_CONG_DEM'),
    row(comp('LUONG_VAN_CHUYEN'), 'MONTHLY_INPUT'),
    row(comp('ALLOW_RESPONSIBILITY', 'EARNING', { category_code: 'THU_NHAP_CO_DINH' }), 'VALUE', 10_000_000),
    row(comp('PHAT_DI_MUON_VE_SOM', 'DEDUCTION'), 'FORMULA', '(LATE_COUNT + EARLY_COUNT) * DON_GIA_PHAT_DI_MUON'),
    row(comp('PHAT_DI_MUON', 'DEDUCTION'), 'FORMULA', 'MAX(LATE_COUNT - SO_LAN_DI_MUON_CHO_PHEP, 0) * DON_GIA_PHAT_DI_MUON_QUA_LAN'),
    row(mid('TONG_CONG'), 'FORMULA', 'TONG_THU_NHAP - PHAT_DI_MUON_VE_SOM - PHAT_DI_MUON - PHAT_BAO_CAO'),
    row(mid('INSURANCE_BASE'), 'FORMULA', 'LUONG_CO_BAN'),
    row(comp('INS_EMPLOYEE', 'DEDUCTION'), 'FORMULA', BAO_HIEM),
    row(comp('QUY_CONG_DOAN', 'DEDUCTION'), 'FORMULA', '(BASE_WORK + LUONG_VAN_CHUYEN) * TY_LE_QUY_1PT'),
    row(mid('DEPENDENTS'), 'VALUE', 0),
    row(mid('THU_NHAP_MIEN_THUE'), 'FORMULA', '1000000 / STANDARD_DAYS * PAID_DAYS + MIN(1200000, 1500000 / STANDARD_DAYS * PAID_DAYS)'),
    row(mid('THU_NHAP_TINH_THUE'), 'FORMULA',
      'MAX(0, TONG_CONG - THU_NHAP_MIEN_THUE - DEPENDENTS * GIAM_TRU_NPT - INS_EMPLOYEE - GIAM_TRU_BAN_THAN)'),
    row(comp('PIT', 'DEDUCTION'), 'FORMULA', 'THUE_LUY_TIEN(THU_NHAP_TINH_THUE)'),
  ];
  const bl01 = computePayslip({
    profile, rows: bl01Rows, stats: stats(23.5), params: bl01Params,
    catalogCodes: ['PHAT_BAO_CAO', 'LUONG_VAN_CHUYEN'],
  });
  check('BL 01: lương thời gian đủ 23,5 công = bậc lương', amountOf(bl01, 'BASE_WORK'), 10_000_000);
  check('BL 01: tổng cộng (cột W) = 20.000.000', bl01.values.TONG_CONG, 20_000_000);
  check('BL 01: thu nhập miễn thuế (cột X) = 2.200.000', bl01.values.THU_NHAP_MIEN_THUE, 2_200_000);
  check('BL 01: thu nhập tính thuế (cột Z) = 1.250.000', bl01.values.THU_NHAP_TINH_THUE, 1_250_000);
  check('BL 01: thuế TNCN (cột AA) = 62.500', amountOf(bl01, 'PIT'), 62_500);
  check('BL 01: trừ 1% nhập quỹ (cột AC) = 100.000', amountOf(bl01, 'QUY_CONG_DOAN'), 100_000);
  check('BL 01: thực lĩnh (cột AD) làm tròn nghìn', bl01.netPay, 18_788_000);
  check('BL 01: dòng trung gian không vào tổng cộng', bl01.gross, 20_000_000);
  check('BL 01: đọc khoản không có trong cơ chế (phạt báo cáo) không cảnh báo ở dòng trung gian',
    bl01.warnings.some((warning) => warning.includes('TONG_CONG')), false);

  // Làm thêm giờ theo sheet "Thêm giờ VC": Lê Thu Hà, lương tính làm thêm 7 tr (bậc lương 5 tr),
  // 14 giờ ngày thường × 1 + 8 giờ Chủ nhật × 1,5 = 968.085 (cột P của BL01).
  const otParams = toPayrollParams({
    ...bl01Version,
    tables: [...bl01Version.tables, {
      id: 'ot', kind: 'LIST', name: 'Làm thêm', note: null, params: [
        { code: 'HE_SO_OT_THUONG', name: 'OT ngày thường', type: 'RATE', unit: 'HE_SO', value: 1, note: null },
        { code: 'HE_SO_OT_NGHI', name: 'OT ngày nghỉ', type: 'RATE', unit: 'HE_SO', value: 1.5, note: null },
        { code: 'HE_SO_OT_LE', name: 'OT ngày lễ', type: 'RATE', unit: 'HE_SO', value: 2, note: null },
      ],
    }].map((table) => (table.id === 'bl01' && table.kind === 'LIST'
      ? { ...table, params: table.params.filter((param) => !param.code.startsWith('HE_SO_OT')) }
      : table)),
  }, { standardHoursPerDay: 8 });
  order = 0;
  const otRows: MechanismRow[] = [
    row(mid('LUONG_CO_BAN'), 'PER_PERSON', 5_000_000),
    row(mid('LUONG_TINH_OT'), 'VALUE', 7_000_000),
    row(mid('HOURLY_RATE'), 'FORMULA', 'LUONG_TINH_OT / STANDARD_DAYS / HOURS_PER_DAY'),
    row(comp('OT_WEEKDAY'), 'FORMULA', 'HOURLY_RATE * HE_SO_OT_THUONG * OT_WEEKDAY_HOURS'),
    row(comp('OT_WEEKEND'), 'FORMULA', 'HOURLY_RATE * HE_SO_OT_NGHI * OT_WEEKEND_HOURS'),
  ];
  const ot = computePayslip({
    profile, rows: otRows, stats: stats(22), params: otParams,
    inputs: { OT_WEEKDAY_HOURS: 14, OT_WEEKEND_HOURS: 8 },
  });
  check('BL 01: làm thêm ngày thường × 1 trên lương tính làm thêm', amountOf(ot, 'OT_WEEKDAY'), 521_277);
  check('BL 01: làm thêm Chủ nhật × 1,5', amountOf(ot, 'OT_WEEKEND'), 446_809);

  // BL 02 — Kinh doanh: khai lại phần khác BL 01 (doanh số, hoa hồng bậc thang, quỹ 1%).
  const bl02Version: PayrollParamVersion = {
    ...bl01Version,
    tables: [
      ...bl01Version.tables,
      TEST_VERSION.tables[3],
      {
        id: 'kd', kind: 'LIST', name: 'Kinh doanh', note: null, params: [
          { code: 'TY_LE_HH_CAT_MA', name: 'Hoa hồng cắt mã', type: 'RATE', unit: '%', value: 1, note: null },
          { code: 'TY_LE_HH_CAT_LO', name: 'Hoa hồng cắt lô', type: 'RATE', unit: '%', value: 1, note: null },
          { code: 'NGUONG_THUONG_VUOT', name: 'Ngưỡng thưởng vượt', type: 'RATE', unit: '%', value: 150, note: null },
          { code: 'TY_LE_THUONG_VUOT', name: 'Thưởng vượt — phần bậc lương', type: 'RATE', unit: '%', value: 50, note: null },
          { code: 'NGUONG_HH_CAT_LO', name: 'Ngưỡng hoa hồng cắt lô', type: 'RATE', unit: '%', value: 75, note: null },
          { code: 'NGUONG_DS_TOI_THIEU', name: 'Tỷ lệ đạt tối thiểu', type: 'RATE', unit: '%', value: 30, note: null },
          { code: 'TY_LE_LUONG_DUOI_NGUONG', name: 'Lương khi dưới tối thiểu', type: 'RATE', unit: '%', value: 70, note: null },
        ],
      },
    ],
  };
  const bl02Params = toPayrollParams(bl02Version, { standardHoursPerDay: 8 });
  const bl02Rows = (doanhSo: number, catLo: number, khoan: number): MechanismRow[] => {
    const base = bl01Rows.filter((item) => !['LUONG_VAN_CHUYEN', 'QUY_CONG_DOAN', 'BASE_WORK'].includes(item.component.code));
    order = 1000;
    return [
      ...base,
      row(comp('BASE_WORK'), 'FORMULA',
        'DAILY_RATE * WORK_DAYS * IF(DOANH_SO_KHOAN > 0 && TY_LE_DAT_DS / 100 < NGUONG_DS_TOI_THIEU, TY_LE_LUONG_DUOI_NGUONG, 1)'),
      row(mid('MUC_KPI'), 'FORMULA', 'LUONG_CO_BAN / 3'),
      row(comp('LUONG_KPI'), 'FORMULA', 'MUC_KPI * TY_LE_KPI'),
      row(mid('DOANH_SO'), 'VALUE', doanhSo),
      row(mid('DOANH_SO_KHOAN'), 'VALUE', khoan),
      row(mid('DOANH_SO_CAT_MA'), 'VALUE', 0),
      row(mid('DOANH_SO_THU_CAT_LO'), 'VALUE', catLo),
      row(mid('TY_LE_DAT_DS'), 'FORMULA', 'IF(DOANH_SO_KHOAN > 0, (DOANH_SO + DOANH_SO_THU_CAT_LO) / DOANH_SO_KHOAN * 100, 0)'),
      row(comp('LUONG_DOANH_SO'), 'FORMULA', 'DOANH_SO * HH_BL02(TY_LE_DAT_DS) + DOANH_SO_CAT_MA * TY_LE_HH_CAT_MA'),
      row(comp('LUONG_DT_CAT_LO'), 'FORMULA', 'IF(TY_LE_DAT_DS / 100 >= NGUONG_HH_CAT_LO, DOANH_SO_THU_CAT_LO * TY_LE_HH_CAT_LO, 0)'),
      row(comp('THUONG_DOANH_SO_VUOT'), 'FORMULA', 'IF(TY_LE_DAT_DS / 100 >= NGUONG_THUONG_VUOT, LUONG_CO_BAN * TY_LE_THUONG_VUOT, 0)'),
      row(comp('QUY_CONG_DOAN', 'DEDUCTION'), 'FORMULA', '(BASE_WORK + LUONG_DOANH_SO + LUONG_DT_CAT_LO) * TY_LE_QUY_1PT'),
    ];
  };
  const kd = computePayslip({
    profile, rows: bl02Rows(800_000_000, 150_000_000, 1_000_000_000), stats: stats(23.5), params: bl02Params,
    catalogCodes: ['PHAT_BAO_CAO'],
  });
  check('BL 02: tỷ lệ đạt = (thu tiền + cắt lô) ÷ khoán = 95%', kd.values.TY_LE_DAT_DS, 95);
  check('BL 02: hoa hồng bậc 90–104% = 3% doanh số thu tiền', amountOf(kd, 'LUONG_DOANH_SO'), 24_000_000);
  check('BL 02: hoa hồng cắt lô 1%', amountOf(kd, 'LUONG_DT_CAT_LO'), 1_500_000);
  check('BL 02: chưa vượt 150% thì không thưởng vượt', amountOf(kd, 'THUONG_DOANH_SO_VUOT'), 0);
  check('BL 02: quỹ 1% trên lương thời gian + lương doanh thu', amountOf(kd, 'QUY_CONG_DOAN'), 355_000);
  const vuot = computePayslip({
    profile, rows: bl02Rows(1_600_000_000, 0, 1_000_000_000), stats: stats(23.5), params: bl02Params,
    catalogCodes: ['PHAT_BAO_CAO'],
  });
  check('BL 02: đạt từ 150% thì thưởng nửa tháng bậc lương', amountOf(vuot, 'THUONG_DOANH_SO_VUOT'), 5_000_000);
  const kdSlip = (doanhSo: number, catLo: number, khoan: number, kpi = 0) => computePayslip({
    profile, rows: bl02Rows(doanhSo, catLo, khoan), stats: stats(23.5), params: bl02Params,
    inputs: { KPI_PCT: kpi }, catalogCodes: ['PHAT_BAO_CAO'],
  });
  check('BL 02: lương KPI = bậc lương ÷ 3 × KPI', amountOf(kdSlip(800_000_000, 0, 1_000_000_000, 45), 'LUONG_KPI'), 1_500_000);
  const duoi75 = kdSlip(500_000_000, 200_000_000, 1_000_000_000);
  check('BL 02: đạt dưới 75% thì không có hoa hồng cắt lô', amountOf(duoi75, 'LUONG_DT_CAT_LO'), 0);
  check('BL 02: đạt dưới 75% thì không có hoa hồng doanh số', amountOf(duoi75, 'LUONG_DOANH_SO'), 0);
  check('BL 02: đạt dưới 75% nhưng từ 30% thì lương thời gian đủ', amountOf(duoi75, 'BASE_WORK'), 10_000_000);
  check('BL 02: đạt dưới 30% thì lương thời gian còn 70%', amountOf(kdSlip(200_000_000, 0, 1_000_000_000), 'BASE_WORK'), 7_000_000);
  check('BL 02: chưa giao khoán thì lương thời gian đủ', amountOf(kdSlip(0, 0, 0), 'BASE_WORK'), 10_000_000);
}

// --- Công thức dạng chữ của cơ chế -------------------------------------------
{
  order = 0;
  const named = (code: string, name: string, kind: PayComponentKind, category: string | null = 'THU_NHAP_BIEN_DOI') =>
    comp(code, kind, { name, category_code: category });
  const sheetRows: MechanismRow[] = [
    row(named('LUONG_CO_BAN', 'Bậc lương', 'INFO', null), 'PER_PERSON', 10_000_000),
    row(named('DAILY_RATE', 'Đơn giá ngày', 'INFO', null), 'FORMULA', 'LUONG_CO_BAN / STANDARD_DAYS'),
    row(named('NGAY_CONG', 'Ngày công', 'INFO', null), 'MONTHLY_INPUT'),
    row(named('BASE_WORK', 'Lương thời gian', 'EARNING'), 'FORMULA', 'DAILY_RATE * NGAY_CONG'),
    row(named('PHU_CAP', 'Phụ cấp', 'EARNING', 'THU_NHAP_CO_DINH'), 'VALUE', 500_000),
    row(named('THUONG', 'Thưởng', 'EARNING', 'THUONG_PHAT_SINH'), 'MONTHLY_INPUT'),
    row(named('QUY', 'Quỹ 1%', 'DEDUCTION', 'KHAU_TRU_PHAT'), 'FORMULA', 'MAX(BASE_WORK, DAILY_RATE) * 0.01'),
  ];
  const sheetNames = new Map(sheetRows.map((item) => [item.component.code, item.component.name]));
  sheetNames.set('STANDARD_DAYS', 'Công chuẩn');
  const nameOfCode = (code: string) => sheetNames.get(code) ?? (code === 'MAX' ? 'Lớn nhất' : undefined);
  const categories = [
    { code: 'THU_NHAP_CO_DINH', name: 'Thu nhập cố định' },
    { code: 'THU_NHAP_BIEN_DOI', name: 'Thu nhập biến đổi' },
    { code: 'THUONG_PHAT_SINH', name: 'Thưởng' },
    { code: 'KHAU_TRU_PHAT', name: 'Khấu trừ' },
  ];
  const expanded = buildFormulaSheet(sheetRows, nameOfCode, categories, { expandIntermediate: true });
  const lines = expanded.sections.flatMap((section) => section.lines);
  check('Công thức chữ: chỉ dòng cộng / trừ, không có dòng trung gian',
    lines.map((line) => line.code), ['PHU_CAP', 'BASE_WORK', 'THUONG', 'QUY']);
  check('Công thức chữ: nhóm theo danh mục, đánh số liên tục',
    expanded.sections.map((section) => `${section.title}:${section.lines.map((line) => line.no).join(',')}`),
    ['Thu nhập cố định:1', 'Thu nhập biến đổi:2', 'Thưởng:3', 'Khấu trừ:4']);
  check('Công thức chữ: thay dòng trung gian bằng công thức, trong ngoặc',
    lines[1].text, '(Bậc lương ÷ Công chuẩn) × Ngày công');
  check('Công thức chữ: giữ bản gõ trong cơ chế để đối chiếu', lines[1].written, 'Đơn giá ngày × Ngày công');
  check('Công thức chữ: ghi lại dòng trung gian đã thay', lines[1].expanded, ['Đơn giá ngày']);
  check('Công thức chữ: trong lời gọi hàm cũng thay', lines[3].text, 'Lớn nhất(Lương thời gian; (Bậc lương ÷ Công chuẩn)) × 0,01');
  check('Công thức chữ: giá trị cố định / nhập tháng', [lines[0].text, lines[2].text], ['500.000', 'nhập mỗi tháng']);
  check('Công thức chữ: tổng cộng và thực lĩnh',
    [expanded.grossText, expanded.netText],
    ['Phụ cấp + Lương thời gian + Thưởng', 'Tổng các khoản cộng − Quỹ 1%']);
  const asWritten = buildFormulaSheet(sheetRows, nameOfCode, categories, {
    expandIntermediate: false, rounding: { unit: 1000, mode: 'NEAREST' },
  });
  check('Công thức chữ: tắt thay thế thì giữ tên dòng trung gian',
    asWritten.sections[1].lines[0].text, 'Đơn giá ngày × Ngày công');
  check('Công thức chữ: làm tròn thực lĩnh', asWritten.netText, 'làm tròn gần nhất đến 1.000 đ của (Tổng các khoản cộng − Quỹ 1%)');
}

console.log(failures === 0 ? '\nTất cả kiểm chứng đều đạt.' : `\n${failures} kiểm chứng KHÔNG đạt.`);
process.exit(failures === 0 ? 0 : 1);
