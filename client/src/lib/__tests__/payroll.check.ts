// Kiểm chứng engine lương. Chạy: npm run check:payroll
import { evaluateFormula } from '../payrollFormula';
import {
  computePayslip, mergeUnitAndEmployeeItems, progressiveIncomeTax, splitOvertimeHours, summarisePeriod,
  type PayrollAdjustment,
} from '../payroll';
import {
  EMPTY_SCHEDULES, measurePunctuality, monthStandardDays, type ScheduleSet,
} from '../workSchedule';
import { DEFAULT_PAYROLL_SETTINGS, toPayrollParams } from '../payrollSettings';
import { describeLevelIssues, isAutoScorable, scoreFromLevels } from '../kpiScoring';
import { buildPayrollJournal } from '../payrollJournal';
import { buildKpiFormula } from '../kpiPayFormula';
import type { EmployeePayProfile, PayComponent, EmployeePayItem, Profile } from '@/types';

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

// --- Thuế lũy tiến ----------------------------------------------------------
// Thu nhập tính thuế 20tr: 5tr*5% + 5tr*10% + 8tr*15% + 2tr*20% = 250k+500k+1.2tr+400k
check('thuế 20tr', progressiveIncomeTax(20_000_000).tax, 2_350_000);
check('thuế 5tr', progressiveIncomeTax(5_000_000).tax, 250_000);
check('thuế 0', progressiveIncomeTax(0).tax, 0);
check('thuế âm', progressiveIncomeTax(-1_000_000).tax, 0);
// 100tr: 250k+500k+1.2tr+2.8tr+5tr+8.4tr+7tr = 25.15tr
check('thuế 100tr', progressiveIncomeTax(100_000_000).tax, 25_150_000);

// --- Tính phiếu lương -------------------------------------------------------
const profile = { id: 'u1', name: 'Nguyễn Văn A', department: 'Kinh doanh' } as Profile;
const settings = toPayrollParams(
  { ...DEFAULT_PAYROLL_SETTINGS, standardWorkDays: 26 },
  { standardHoursPerDay: 8 },
);

function payProfile(over: Partial<EmployeePayProfile>): EmployeePayProfile {
  return {
    id: 'p1', user_id: 'u1', effective_from: '2026-01-01', pay_basis: 'MONTHLY',
    base_amount: 20_000_000, insurance_base: null, insurance_enabled: true, dependents: 0,
    tax_mode: 'PROGRESSIVE', flat_tax_rate: 10, standard_days_override: null, note: null,
    created_by: null, created_at: '', updated_at: '', ...over,
  };
}

const stats = { workDays: 26, leaveDays: 0, holidayDays: 0, paidDays: 26, workHours: 208, missingCheckout: 0 };

// Lương tháng đủ công, không phụ cấp, không người phụ thuộc.
const monthly = computePayslip({
  profile, payProfile: payProfile({}), items: [], inputs: {}, stats, settings,
});
check('gross lương tháng đủ công', monthly.gross, 20_000_000);
check('bảo hiểm 10.5%', monthly.insuranceEmployee, 2_100_000);
// TNCT = 20tr - 2.1tr - 11tr = 6.9tr -> 5tr*5% + 1.9tr*10% = 250k + 190k = 440k
check('thu nhập tính thuế', monthly.taxableIncome, 6_900_000);
check('thuế TNCN', monthly.personalIncomeTax, 440_000);
check('thực nhận', monthly.netPay, 20_000_000 - 2_100_000 - 440_000);

// Nghỉ không lương nửa tháng: lương theo công giảm, mức đóng bảo hiểm KHÔNG giảm.
const halfMonth = computePayslip({
  profile, payProfile: payProfile({}), items: [], inputs: {},
  stats: { workDays: 13, leaveDays: 0, holidayDays: 0, paidDays: 13, workHours: 104, missingCheckout: 0 },
  settings,
});
check('nửa tháng công', halfMonth.gross, 10_000_000);
check('bảo hiểm giữ nguyên mức đóng', halfMonth.insuranceEmployee, 2_100_000);

// Người phụ thuộc kéo thuế xuống.
const withDependents = computePayslip({
  profile, payProfile: payProfile({ dependents: 2 }), items: [], inputs: {}, stats, settings,
});
// TNCT = 20tr - 2.1tr - 11tr - 8.8tr < 0 -> 0
check('2 người phụ thuộc thì hết thuế', withDependents.personalIncomeTax, 0);

// Bảo hiểm phần doanh nghiệp: engine tự tính, không cần gán khoản nào.
const erLines = monthly.lines.filter((l) => l.kind === 'EMPLOYER_COST');
check('3 dòng chi phí doanh nghiệp', erLines.length, 3);
check('BHXH doanh nghiệp 17.5%', erLines.find((l) => l.code === 'ER_SOCIAL')?.amount, Math.round(20_000_000 * 0.175));
check('BHYT doanh nghiệp 3%', erLines.find((l) => l.code === 'ER_HEALTH')?.amount, 600_000);
check('BHTN doanh nghiệp 1%', erLines.find((l) => l.code === 'ER_UNEMPLOY')?.amount, 200_000);
check('tổng chi phí doanh nghiệp', monthly.insuranceEmployer, Math.round(20_000_000 * 0.215));
check('không trừ vào thực nhận', monthly.netPay, 20_000_000 - 2_100_000 - 440_000);

// Không tham gia bảo hiểm thì doanh nghiệp cũng không tốn phần đóng.
const noIns = computePayslip({
  profile, payProfile: payProfile({ insurance_enabled: false }), items: [], inputs: {}, stats, settings,
});
check('tắt bảo hiểm thì DN không đóng', noIns.insuranceEmployer, 0);

// Lương giờ.
const hourly = computePayslip({
  profile,
  payProfile: payProfile({ pay_basis: 'HOURLY', base_amount: 60_000, insurance_enabled: false }),
  items: [], inputs: {},
  stats: { workDays: 20, leaveDays: 0, holidayDays: 0, paidDays: 20, workHours: 152, missingCheckout: 0 },
  settings,
});
check('lương giờ', hourly.gross, 60_000 * 152);
check('không đóng bảo hiểm', hourly.insuranceEmployee, 0);

// Trần đóng bảo hiểm với lương rất cao.
const highEarner = computePayslip({
  profile, payProfile: payProfile({ base_amount: 200_000_000 }), items: [], inputs: {}, stats, settings,
});
// BHXH+BHYT trên trần 46.8tr = 9.5%; BHTN trên trần 99.2tr = 1%
check('trần bảo hiểm', highEarner.insuranceEmployee,
  Math.round(46_800_000 * 0.095) + Math.round(99_200_000 * 0.01));

// Hoa hồng theo công thức bậc thang + tăng ca.
const component = (over: Partial<PayComponent>): PayComponent => ({
  id: 'c', code: 'X', name: 'X', kind: 'EARNING', calc_type: 'FIXED', default_amount: 0,
  input_code: null, base_code: null, formula: null, taxable: true, insurable: false,
  prorate: false, sort_order: 100, is_active: true, is_system: false, note: null,
  created_at: '', updated_at: '', ...over,
});
const item = (componentId: string, over: Partial<EmployeePayItem> = {}): EmployeePayItem => ({
  id: 'i', user_id: 'u1', component_id: componentId, amount: null, formula: null,
  effective_from: '2026-01-01', effective_to: null, note: null, created_by: null,
  created_at: '', updated_at: '', ...over,
});

const otComponent = component({
  id: 'c1', code: 'OT_WEEKDAY', name: 'Tăng ca 150%', calc_type: 'FORMULA',
  input_code: 'OT_WEEKDAY_HOURS', formula: 'HOURLY_RATE * 1.5 * OT_WEEKDAY_HOURS', sort_order: 210,
});
const commissionComponent = component({
  id: 'c2', code: 'COMMISSION', name: 'Hoa hồng', calc_type: 'FORMULA',
  formula: 'IF(REVENUE > 500000000, REVENUE * 0.05, REVENUE * 0.03)', sort_order: 320,
});

const sales = computePayslip({
  profile,
  payProfile: payProfile({ pay_basis: 'COMMISSION', base_amount: 8_000_000 }),
  items: [
    { item: item('c1'), component: otComponent },
    { item: item('c2'), component: commissionComponent },
  ],
  inputs: { OT_WEEKDAY_HOURS: 10, REVENUE: 600_000_000 },
  stats, settings,
});
// hourly rate = 8tr/26/8 = 38461.538..
const expectedOt = Math.round((8_000_000 / 26 / 8) * 1.5 * 10);
check('tăng ca theo công thức', sales.lines.find((l) => l.code === 'OT_WEEKDAY')?.amount, expectedOt);
check('hoa hồng bậc thang', sales.lines.find((l) => l.code === 'COMMISSION')?.amount, 30_000_000);
check('gross sales', sales.gross, 8_000_000 + expectedOt + 30_000_000);

// Khoản % trên khoản đứng sau nó -> cảnh báo, không làm sập phiếu.
const badPercent = component({
  id: 'c3', code: 'BAD', name: 'Sai thứ tự', calc_type: 'PERCENT', base_code: 'NOT_YET',
  default_amount: 10, sort_order: 10,
});
const withBad = computePayslip({
  profile, payProfile: payProfile({}), items: [{ item: item('c3'), component: badPercent }],
  inputs: {}, stats, settings,
});
check('khoản lỗi không làm sập phiếu', withBad.gross, 20_000_000);
check('có cảnh báo', withBad.warnings.length > 0, true);

// Công thức hỏng cũng chỉ cảnh báo.
const brokenFormula = component({
  id: 'c4', code: 'BROKEN', name: 'Công thức hỏng', calc_type: 'FORMULA',
  formula: 'KHONG_CO_BIEN_NAY * 2', sort_order: 400,
});
const withBroken = computePayslip({
  profile, payProfile: payProfile({}), items: [{ item: item('c4'), component: brokenFormula }],
  inputs: {}, stats, settings,
});
check('công thức hỏng vẫn ra phiếu', withBroken.gross, 20_000_000);
check('cảnh báo công thức hỏng', withBroken.warnings.some((w) => w.includes('Công thức hỏng')), true);

// --- Công thức lương Huy Phong -------------------------------------------
// Ba tình huống dễ vỡ nhất của bộ khoản lương seed ở migration
// 20260930210000, gộp trong một phiếu.
const transportStats = {
  workDays: 20, leaveDays: 4, holidayDays: 2, paidDays: 26, workHours: 160, missingCheckout: 0,
};
const transportComponent = component({
  id: 'h1', code: 'LUONG_VAN_CHUYEN', name: 'Lương vận chuyển', calc_type: 'FORMULA',
  input_code: 'SO_CHUYEN', formula: 'SO_CHUYEN * MUC_RIENG', sort_order: 110,
});
const otComponentHp = component({
  id: 'h2', code: 'LUONG_OT_THUONG', name: 'Làm thêm ngày thường', calc_type: 'FORMULA',
  input_code: 'OT_NGAY_THUONG', formula: 'HOURLY_RATE * OT_NGAY_THUONG * 2', sort_order: 120,
});
const unionComponent = component({
  id: 'h3', code: 'PHI_CONG_DOAN', name: 'Phí công đoàn', kind: 'DEDUCTION', calc_type: 'FORMULA',
  formula: '(BASE_WORK + LUONG_VAN_CHUYEN + LUONG_DOANH_SO) * 0.01', sort_order: 900,
});

const huyphong = computePayslip({
  profile,
  payProfile: payProfile({ pay_basis: 'MONTHLY', base_amount: 26_000_000 }),
  items: [
    { item: item('h1', { amount: 50_000 }), component: transportComponent },
    { item: item('h2'), component: otComponentHp },
    { item: item('h3'), component: unionComponent },
  ],
  // OT_NGAY_THUONG cố tình KHÔNG nhập: tháng này không ai làm thêm.
  inputs: { SO_CHUYEN: 30 },
  stats: transportStats,
  settings,
  // LUONG_DOANH_SO có trong danh mục nhưng người này không được gán.
  catalogCodes: ['LUONG_VAN_CHUYEN', 'LUONG_DOANH_SO', 'LUONG_OT_THUONG', 'PHI_CONG_DOAN'],
});

// 26tr / 26 ngày chuẩn = 1tr/ngày, 20 ngày đi làm.
check('lương thời gian tách khỏi phép và lễ',
  huyphong.lines.find((l) => l.code === 'BASE_WORK')?.amount, 20_000_000);
check('lương vận chuyển theo số chuyến',
  huyphong.lines.find((l) => l.code === 'LUONG_VAN_CHUYEN')?.amount, 1_500_000);
// Số liệu tháng chưa nhập phải ra 0đ, KHÔNG phải lỗi "không có biến"
// (dòng vẫn nằm trên phiếu để thấy khoản này đã được xét, chỉ là bằng 0).
check('tháng không làm thêm thì OT bằng 0đ',
  huyphong.lines.find((l) => l.code === 'LUONG_OT_THUONG')?.amount, 0);
// Công đoàn = 1% x (20tr lương thời gian + 1,5tr vận chuyển), KHÔNG tính
// tiền phép và tiền lễ; khoản LUONG_DOANH_SO không được gán nên bằng 0.
check('phí công đoàn trên lương thời gian + vận chuyển',
  huyphong.lines.find((l) => l.code === 'PHI_CONG_DOAN')?.amount, 215_000);
check('không cảnh báo nào cho bộ khoản Huy Phong',
  huyphong.warnings.filter((w) => w.includes('công thức')).length, 0);

// --- Cách tính lương KPI ---------------------------------------------------
// Form sinh ra biểu thức rồi engine tính; kiểm chứng đi qua CẢ HAI bước để
// bắt được cả lỗi sinh sai lẫn lỗi cú pháp mà engine không chạy nổi.
const kpiMoney = (formula: string, pct: number) =>
  evaluateFormula(formula, { MUC_RIENG: 5_000_000, KPI_PCT: pct }).value;

const tyLe = buildKpiFormula({
  name: 'x', mode: 'TY_LE', cap: '120', floor: '', threshold: '', tiers: [],
});
check('tỷ lệ: đạt 85% nhận 85%', kpiMoney(tyLe, 85), 4_250_000);
// Trần là thứ hay quên nhất: chấm 150% mà không kẹp thì trả vượt quỹ lương.
check('tỷ lệ: chấm 150% vẫn chặn ở trần 120%', kpiMoney(tyLe, 150), 6_000_000);

const coSan = buildKpiFormula({
  name: 'x', mode: 'TY_LE', cap: '120', floor: '50', threshold: '', tiers: [],
});
check('sàn 50%: chấm 30% vẫn nhận theo 50%', kpiMoney(coSan, 30), 2_500_000);

const nguong = buildKpiFormula({
  name: 'x', mode: 'NGUONG', cap: '120', floor: '', threshold: '80', tiers: [],
});
check('ngưỡng 80%: chấm 79% nhận 0đ', kpiMoney(nguong, 79), 0);
check('ngưỡng 80%: chấm 80% nhận đúng 80%', kpiMoney(nguong, 80), 4_000_000);

const datKhong = buildKpiFormula({
  name: 'x', mode: 'DAT_KHONG', cap: '', floor: '', threshold: '90', tiers: [],
});
check('đạt/không: chấm 89% nhận 0đ', kpiMoney(datKhong, 89), 0);
check('đạt/không: chấm 95% vẫn nhận trọn mức', kpiMoney(datKhong, 95), 5_000_000);

// Bac khai LON XON co y: form phai tu xep giam dan, neu khong moi nguoi deu
// roi vao bac thap nhat khop dau tien.
const bacThang = buildKpiFormula({
  name: 'x', mode: 'BAC_THANG', cap: '', floor: '', threshold: '',
  tiers: [{ from: '60', pay: '50' }, { from: '100', pay: '120' }, { from: '80', pay: '100' }],
});
check('bậc thang: 105% rơi vào bậc cao nhất', kpiMoney(bacThang, 105), 6_000_000);
check('bậc thang: 85% rơi vào bậc giữa', kpiMoney(bacThang, 85), 5_000_000);
check('bậc thang: 65% rơi vào bậc thấp', kpiMoney(bacThang, 65), 2_500_000);
check('bậc thang: 40% dưới mọi bậc nhận 0đ', kpiMoney(bacThang, 40), 0);

// Thiếu cơ chế lương.
const noProfile = computePayslip({ profile, payProfile: null, items: [], inputs: {}, stats, settings });
check('không có cơ chế lương thì 0đ', noProfile.netPay, 0);
check('cảnh báo thiếu cơ chế', noProfile.warnings.length > 0, true);

// Tiền ăn ca không chịu thuế.
const mealComponent = component({
  id: 'c5', code: 'ALLOW_MEAL', name: 'Tiền ăn ca', calc_type: 'FIXED',
  default_amount: 730_000, taxable: false, prorate: true, sort_order: 120,
});
const withMeal = computePayslip({
  profile, payProfile: payProfile({}), items: [{ item: item('c5'), component: mealComponent }],
  inputs: {}, stats, settings,
});
check('ăn ca vào gross', withMeal.gross, 20_730_000);
check('ăn ca không làm tăng thuế', withMeal.personalIncomeTax, monthly.personalIncomeTax);

// Thuế khoán 10% cho hợp đồng ngắn hạn.
const flat = computePayslip({
  profile, payProfile: payProfile({ tax_mode: 'FLAT', flat_tax_rate: 10, insurance_enabled: false }),
  items: [], inputs: {}, stats, settings,
});
check('thuế khoán 10%', flat.personalIncomeTax, 2_000_000);

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

// Tách 3 dòng lương gốc (L01/L02/L03) — tổng 3 dòng phải bằng ĐÚNG số tiền
// của một dòng gộp cũ (base.rate không đổi, chỉ đổi cách chia hiển thị).
const splitStats = { workDays: 20, leaveDays: 2, holidayDays: 1, paidDays: 23, workHours: 160, missingCheckout: 0 };
const splitSlip = computePayslip({
  profile, payProfile: payProfile({}), items: [], inputs: {}, stats: splitStats, settings,
});
const dayRate = 20_000_000 / 26;
check('dòng Lương thời gian (L01)', splitSlip.lines.find((l) => l.code === 'BASE_WORK')?.amount, Math.round(dayRate * 20));
check('dòng Lương phép (L02)', splitSlip.lines.find((l) => l.code === 'BASE_LEAVE')?.amount, Math.round(dayRate * 2));
check('dòng Lương nghỉ lễ (L03)', splitSlip.lines.find((l) => l.code === 'BASE_HOLIDAY')?.amount, Math.round(dayRate * 1));
check('tổng 3 dòng = gross (không đổi số tiền so với khi gộp 1 dòng)',
  splitSlip.gross, Math.round((dayRate * 23)));

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

const latePenalty = component({
  id: 'c9', code: 'LATE_FINE', name: 'Phạt đi muộn', kind: 'DEDUCTION', calc_type: 'FORMULA',
  // Đúng thang của đặc tả L16: 5.000đ/phút cho 15 phút đầu, 10.000đ từ phút 16.
  formula: 'MIN(LATE_MINUTES, 15) * 5000 + MAX(LATE_MINUTES - 15, 0) * 10000',
  sort_order: 600,
});
const withLateFine = computePayslip({
  profile, payProfile: payProfile({}), items: [{ item: item('c9'), component: latePenalty }],
  inputs: {}, stats: { ...stats, lateMinutes: 20 }, settings,
});
check('công thức phạt đi muộn đọc được LATE_MINUTES',
  withLateFine.lines.find((l) => l.code === 'LATE_FINE')?.amount, 15 * 5000 + 5 * 10000);

// --- OT: phần trả cao hơn giờ thường được miễn thuế TNCN (T04) --------------
// Hệ số 150% → 1/3 khoản tiền được miễn. Kiểm bằng cách so chính xác với một
// khoản thưởng THƯỜNG cùng số tiền: chênh lệch thu nhập tính thuế phải đúng
// bằng phần miễn, không hơn không kém.
const otAmount = 3_000_000;
const otPaid = component({
  id: 'cOT', code: 'OT150', name: 'Tăng ca 150%', calc_type: 'FIXED',
  default_amount: otAmount, ot_multiplier: 1.5, sort_order: 210,
});
const plainBonus = component({
  id: 'cB', code: 'BONUS_PLAIN', name: 'Thưởng thường', calc_type: 'FIXED',
  default_amount: otAmount, sort_order: 210,
});

const withOt = computePayslip({
  profile, payProfile: payProfile({}), items: [{ item: item('cOT'), component: otPaid }],
  inputs: {}, stats, settings,
});
const withBonus = computePayslip({
  profile, payProfile: payProfile({}), items: [{ item: item('cB'), component: plainBonus }],
  inputs: {}, stats, settings,
});

check('OT vẫn vào gross đầy đủ', withOt.gross, withBonus.gross);
check('OT 150% miễn thuế đúng 1/3',
  withBonus.taxableIncome - withOt.taxableIncome, Math.round(otAmount / 3));
check('miễn thuế làm thuế TNCN thấp hơn', withOt.personalIncomeTax < withBonus.personalIncomeTax, true);
check('OT không ảnh hưởng thực nhận qua đường khác',
  withOt.netPay - withBonus.netPay, withBonus.personalIncomeTax - withOt.personalIncomeTax);

// Hệ số 3 (ngày lễ) → miễn 2/3.
const ot300 = computePayslip({
  profile, payProfile: payProfile({}),
  items: [{ item: item('cOT3'), component: component({
    id: 'cOT3', code: 'OT300', name: 'Tăng ca 300%', calc_type: 'FIXED',
    default_amount: otAmount, ot_multiplier: 3, sort_order: 230,
  }) }],
  inputs: {}, stats, settings,
});
check('OT 300% miễn thuế đúng 2/3',
  withBonus.taxableIncome - ot300.taxableIncome, Math.round((otAmount * 2) / 3));

// --- Điều chỉnh truy lĩnh / truy thu (LU-14) --------------------------------
const adj = (over: Partial<PayrollAdjustment>): PayrollAdjustment => ({
  id: 'a1', user_id: 'u1', kind: 'RECOVERY', amount: 1_000_000,
  reason: 'Tính thiếu tăng ca', taxable: true, origin_month: '2026-07-01', ...over,
});

const recovery = computePayslip({
  profile, payProfile: payProfile({}), items: [], inputs: {}, stats, settings,
  adjustments: [adj({ amount: 2_000_000 })],
});
check('truy lĩnh cộng vào gross', recovery.gross, monthly.gross + 2_000_000);
check('truy lĩnh chịu thuế', recovery.taxableIncome, monthly.taxableIncome + 2_000_000);
check('dòng truy lĩnh ghi rõ kỳ gốc',
  recovery.lines.find((l) => l.code === 'ADJ_RECOVERY')?.detail,
  'Kỳ 07/2026 — Tính thiếu tăng ca');

// Truy thu là thu hồi tiền đã trả thừa — KHÔNG làm giảm thu nhập chịu thuế
// của kỳ này, chỉ trừ vào thực nhận.
const clawback = computePayslip({
  profile, payProfile: payProfile({}), items: [], inputs: {}, stats, settings,
  adjustments: [adj({ kind: 'CLAWBACK', amount: 500_000, reason: 'Trả thừa phụ cấp' })],
});
check('truy thu không đổi gross', clawback.gross, monthly.gross);
check('truy thu không đổi thu nhập tính thuế', clawback.taxableIncome, monthly.taxableIncome);
check('truy thu trừ vào thực nhận', clawback.netPay, monthly.netPay - 500_000);

// Khoản hoàn lại không chịu thuế (VD trả lại tiền phạt đã trừ nhầm).
const untaxedRecovery = computePayslip({
  profile, payProfile: payProfile({}), items: [], inputs: {}, stats, settings,
  adjustments: [adj({ amount: 1_000_000, taxable: false })],
});
check('truy lĩnh miễn thuế không tăng thu nhập tính thuế',
  untaxedRecovery.taxableIncome, monthly.taxableIncome);
check('truy lĩnh miễn thuế vẫn vào gross', untaxedRecovery.gross, monthly.gross + 1_000_000);

// Kỳ không có điều chỉnh phải ra y hệt như trước khi có tính năng này.
const noAdj = computePayslip({
  profile, payProfile: payProfile({}), items: [], inputs: {}, stats, settings, adjustments: [],
});
check('không có điều chỉnh thì không đổi gì', noAdj.netPay, monthly.netPay);

// --- Gán khoản theo đơn vị, cá nhân ghi đè ----------------------------------
const unitMeal = component({
  id: 'cUM', code: 'ALLOW_MEAL', name: 'Tiền ăn ca', calc_type: 'FIXED',
  default_amount: 730_000, sort_order: 120,
});
const unitFuel = component({
  id: 'cUF', code: 'ALLOW_FUEL', name: 'Phụ cấp xăng xe', calc_type: 'FIXED',
  default_amount: 300_000, sort_order: 130,
});

const asAssignment = (componentId: string, amount: number | null) => ({
  component_id: componentId, amount, formula: null,
  effective_from: '2026-01-01', effective_to: null,
});

// Đơn vị gán 2 khoản; người này gán riêng tiền ăn ca mức cao hơn.
const mergedItems = mergeUnitAndEmployeeItems(
  [
    { item: asAssignment('cUM', 730_000), component: unitMeal },
    { item: asAssignment('cUF', 300_000), component: unitFuel },
  ],
  [{ item: asAssignment('cUM', 1_000_000), component: unitMeal }],
);

check('gộp xong còn đúng 2 khoản (không nhân đôi)', mergedItems.length, 2);
check('bản riêng thắng bản đơn vị',
  mergedItems.find((e) => e.item.component_id === 'cUM')?.item.amount, 1_000_000);
check('khoản đơn vị không bị ghi đè thì giữ nguyên',
  mergedItems.find((e) => e.item.component_id === 'cUF')?.item.amount, 300_000);

const mergedSlip = computePayslip({
  profile, payProfile: payProfile({}), items: mergedItems, inputs: {}, stats, settings,
});
// Ăn ca 1tr (bản riêng) + xăng xe 300k (thừa hưởng từ đơn vị).
check('tiền ra đúng: mức riêng + mức đơn vị, không cộng dồn hai mức ăn ca',
  mergedSlip.gross, monthly.gross + 1_000_000 + 300_000);

// Người không thuộc đơn vị nào vẫn tính được, chỉ là không thừa hưởng gì.
check('không có khoản đơn vị thì chỉ còn khoản riêng',
  mergeUnitAndEmployeeItems([], [{ item: asAssignment('cUM', 500_000), component: unitMeal }]).length, 1);
check('không có khoản riêng thì thừa hưởng hết của đơn vị',
  mergeUnitAndEmployeeItems(
    [{ item: asAssignment('cUF', 300_000), component: unitFuel }], [],
  ).length, 1);

// --- Bút toán kết chuyển lương (LU-14) --------------------------------------
const journal = buildPayrollJournal([
  { profile: { id: 'u1', name: 'A', department: 'Kinh doanh' }, computed: monthly },
  { profile: { id: 'u2', name: 'B', department: null }, computed: monthly },
]);

check('bút toán cân Nợ = Có', journal.balanced, true);
check('gộp theo bộ phận, không theo từng người',
  new Set(journal.entries.map((e) => e.department)).size, 2);
check('có bút toán chi phí lương Nợ 642 / Có 334',
  journal.entries.some((e) => e.debit === '642' && e.credit === '334'), true);
check('có bút toán thuế TNCN Nợ 334 / Có 3335',
  journal.entries.some((e) => e.debit === '334' && e.credit === '3335'), true);
check('tổng thu nhập khớp bảng lương', journal.totals.gross, monthly.gross * 2);
check('tổng thực chi khớp bảng lương', journal.totals.netPay, monthly.netPay * 2);
check('bảo hiểm doanh nghiệp không trừ vào thực chi',
  journal.totals.insuranceEmployer, monthly.insuranceEmployer * 2);
check('người chưa gán bộ phận vẫn vào sổ',
  journal.entries.some((e) => e.department === 'Chưa gán bộ phận'), true);
check('không sinh bút toán số tiền 0',
  journal.entries.every((e) => e.amount > 0), true);


// --- Trần miễn thuế: tiền ăn ca trả vượt ngưỡng --------------------------
// Khoản đánh taxable = false mà CÓ ngưỡng thì chỉ được miễn tới ngưỡng. Kiểm
// bằng chênh lệch thu nhập tính thuế so với phiếu không có khoản nào: phần
// tăng thêm phải đúng bằng số tiền trả vượt ngưỡng.
const capMeal = component({
  id: 'cMeal', code: 'ALLOW_MEAL', name: 'Tiền ăn ca', calc_type: 'FIXED',
  default_amount: 1_000_000, taxable: false, tax_exempt_cap: 730_000, sort_order: 120,
});
const overCapMeal = computePayslip({
  profile, payProfile: payProfile({}), items: [{ item: item('cMeal'), component: capMeal }],
  inputs: {}, stats, settings,
});
check('ăn ca vượt ngưỡng: phần vượt vào thu nhập tính thuế',
  overCapMeal.taxableIncome - monthly.taxableIncome, 1_000_000 - 730_000);
check('ăn ca vượt ngưỡng: khoản vẫn trả đủ',
  overCapMeal.lines.find((l) => l.code === 'ALLOW_MEAL')?.amount, 1_000_000);

// Trả đúng trong ngưỡng thì miễn trọn, thu nhập tính thuế không đổi.
const atCapMeal = computePayslip({
  profile, payProfile: payProfile({}),
  items: [{ item: item('cMeal'), component: component({
    ...capMeal, default_amount: 730_000,
  }) }],
  inputs: {}, stats, settings,
});
check('ăn ca trong ngưỡng: miễn trọn',
  atCapMeal.taxableIncome, monthly.taxableIncome);

// Không khai ngưỡng thì giữ nguyên hành vi cũ: miễn toàn bộ.
const uncappedMeal = computePayslip({
  profile, payProfile: payProfile({}),
  items: [{ item: item('cMeal'), component: component({
    ...capMeal, default_amount: 1_000_000, tax_exempt_cap: null,
  }) }],
  inputs: {}, stats, settings,
});
check('không khai ngưỡng thì miễn toàn bộ như trước',
  uncappedMeal.taxableIncome, monthly.taxableIncome);

// --- Trần số tiền: đoàn phí công đoàn -------------------------------------
// 1% của mức đóng bảo hiểm 46,8tr = 468.000đ, nhưng trần là 234.000đ.
const unionFee = component({
  id: 'cUnion', code: 'UNION_FEE', name: 'Đoàn phí công đoàn', kind: 'DEDUCTION',
  calc_type: 'PERCENT', default_amount: 1, base_code: 'INSURANCE_BASE',
  taxable: false, max_amount: 234_000, sort_order: 610,
});
const withUnion = computePayslip({
  profile, payProfile: payProfile({ base_amount: 46_800_000 }),
  items: [{ item: item('cUnion'), component: unionFee }],
  inputs: {}, stats, settings,
});
const unionLine = withUnion.lines.find((l) => l.code === 'UNION_FEE');
check('đoàn phí bị chặn ở trần', unionLine?.amount, 234_000);
check('phiếu lương nói rõ đã chạm trần',
  (unionLine?.detail ?? '').includes('chạm trần'), true);

// Dưới trần thì không bị đụng tới, và diễn giải không nhắc trần.
const smallUnion = computePayslip({
  profile, payProfile: payProfile({ base_amount: 10_000_000 }),
  items: [{ item: item('cUnion'), component: unionFee }],
  inputs: {}, stats, settings,
});
const smallLine = smallUnion.lines.find((l) => l.code === 'UNION_FEE');
check('dưới trần thì giữ nguyên', smallLine?.amount, 100_000);
check('dưới trần thì không nhắc trần',
  (smallLine?.detail ?? '').includes('chạm trần'), false);


// --- Tự chấm KPI theo thang điểm ------------------------------------------
// Phải khớp nguyên văn quy tắc của public.kpi_score_from_levels trong
// migration 20260929100000, nếu không màn hình hứa một đằng, phiếu chấm ra
// một nẻo.
const errorLevels = [
  { score: 4, max: 0, label: 'Không sai lần nào' },
  { score: 3, min: 1, max: 1, label: 'Sai 1 lần' },
  { score: 2, min: 2, max: 3, label: 'Sai 2-3 lần' },
  { score: 0, min: 4, label: 'Sai trên 3 lần' },
];
check('0 lỗi được điểm tối đa', scoreFromLevels(errorLevels, 0), 4);
check('1 lỗi rơi đúng mức giữa', scoreFromLevels(errorLevels, 1), 3);
check('3 lỗi vẫn trong khoảng 2-3', scoreFromLevels(errorLevels, 3), 2);
check('10 lỗi rơi vào mức mở cận trên', scoreFromLevels(errorLevels, 10), 0);
check('chưa nhập số đo thì chưa có điểm', scoreFromLevels(errorLevels, null), null);

// Cận dưới mở: số âm vẫn phải khớp mức đầu.
check('cận dưới mở nhận cả số âm', scoreFromLevels(errorLevels, -2), 4);

// Thang "càng cao càng tốt" dùng cùng một dạng khai, không cần cột hướng.
const revenueLevels = [
  { score: 4, min: 100 },
  { score: 3, min: 90, max: 99.99 },
  { score: 1, min: 70, max: 89.99 },
];
check('đạt 100% doanh số được điểm tối đa', scoreFromLevels(revenueLevels, 100), 4);
check('đạt 95% rơi mức kế', scoreFromLevels(revenueLevels, 95), 3);
check('đạt 50% không mức nào phủ', scoreFromLevels(revenueLevels, 50), null);

// Mức mô tả thuần (không ngưỡng) bị bỏ qua khi tự chấm.
check('thang toàn nhãn thì không tự chấm được',
  isAutoScorable([{ score: 4, label: 'Tốt' }, { score: 0, label: 'Kém' }]), false);
check('có một mức khai ngưỡng là tự chấm được', isAutoScorable(errorLevels), true);

// Mức khai trước thắng khi hai mức chồng nhau — quy tắc phân xử, không phải
// tuỳ bộ tối ưu.
check('hai mức chồng nhau thì mức khai trước thắng',
  scoreFromLevels([{ score: 4, min: 0, max: 5 }, { score: 1, min: 3, max: 9 }], 4), 4);
check('phát hiện được hai mức chồng nhau',
  describeLevelIssues([{ score: 4, min: 0, max: 5 }, { score: 1, min: 3, max: 9 }]).length > 0, true);
check('phát hiện được lỗ hổng giữa hai mức',
  describeLevelIssues([{ score: 4, min: 0, max: 1 }, { score: 1, min: 5 }]).length > 0, true);
check('thang liền mạch không báo lỗi',
  describeLevelIssues(errorLevels).length, 0);

// --- Nghỉ không lương từ 14 ngày: tháng đó không đóng bảo hiểm ------------
// Điều 85 khoản 3 Luật BHXH 2014. Trước khi có nhánh này, người nghỉ gần hết
// tháng vẫn bị trừ đủ bảo hiểm trên mức lương đóng BH trong khi lương thực tế
// gần bằng 0 — thực nhận ra số ÂM.
const fewDays = { workDays: 12, leaveDays: 0, holidayDays: 0, paidDays: 12, workHours: 96, missingCheckout: 0 };
const mostlyUnpaid = computePayslip({
  profile, payProfile: payProfile({}), items: [], inputs: {}, stats: fewDays, settings,
});
check('nghỉ 14 ngày thì không trừ bảo hiểm', mostlyUnpaid.insuranceEmployee, 0);
check('doanh nghiệp cũng không đóng tháng đó', mostlyUnpaid.insuranceEmployer, 0);
check('thực nhận không âm', mostlyUnpaid.netPay >= 0, true);
check('có cảnh báo giải thích vì sao',
  mostlyUnpaid.warnings.some((w) => w.includes('Điều 85')), true);

// Đúng 13 ngày nghỉ (dưới ngưỡng) thì vẫn đóng bình thường.
const justUnder = { workDays: 13, leaveDays: 0, holidayDays: 0, paidDays: 13, workHours: 104, missingCheckout: 0 };
const stillInsured = computePayslip({
  profile, payProfile: payProfile({}), items: [], inputs: {}, stats: justUnder, settings,
});
check('nghỉ 13 ngày vẫn trừ bảo hiểm đủ',
  stillInsured.insuranceEmployee, monthly.insuranceEmployee);
check('dưới ngưỡng thì không cảnh báo',
  stillInsured.warnings.some((w) => w.includes('Điều 85')), false);

// Ngày lễ và nghỉ phép CÓ lương không bị tính là nghỉ không lương.
const withPaidLeave = { workDays: 10, leaveDays: 4, holidayDays: 2, paidDays: 16, workHours: 80, missingCheckout: 0 };
const paidLeaveOk = computePayslip({
  profile, payProfile: payProfile({}), items: [], inputs: {}, stats: withPaidLeave, settings,
});
check('phép có lương và ngày lễ không tính là nghỉ không lương',
  paidLeaveOk.insuranceEmployee, monthly.insuranceEmployee);


// --- Bút toán gom theo ĐƠN VỊ, không theo ô chữ tự do --------------------
// `profile.department` là ô chữ nhập tay ở trang Hồ sơ & tài khoản, còn cả hệ
// thống dùng `unit_id`. Khai đơn vị đúng ở Cơ cấu tổ chức mà bỏ trống ô chữ
// thì bản cũ dồn hết bút toán vào "Chưa gán bộ phận".
const unitNames = new Map([['u-kd', 'Phòng Kinh doanh'], ['u-kt', 'Phòng Kế toán']]);
const journalRows = [
  { profile: { id: 'a', name: 'A', department: null, unit_id: 'u-kd' }, computed: monthly },
  { profile: { id: 'b', name: 'B', department: null, unit_id: 'u-kt' }, computed: monthly },
];
const byUnit = buildPayrollJournal(journalRows, undefined, unitNames);
check('gom theo tên đơn vị dù ô chữ bỏ trống',
  new Set(byUnit.entries.map((e) => e.department)),
  new Set(['Phòng Kinh doanh', 'Phòng Kế toán']));
check('không dồn vào Chưa gán bộ phận',
  byUnit.entries.some((e) => e.department.includes('Chưa gán')), false);

// Dữ liệu cũ chưa gán đơn vị vẫn dùng được ô chữ làm phương án lùi.
const legacy = buildPayrollJournal(
  [{ profile: { id: 'c', name: 'C', department: 'Kho vận', unit_id: null }, computed: monthly }],
  undefined,
  unitNames,
);
check('chưa gán đơn vị thì lùi về ô chữ cũ',
  legacy.entries.every((e) => e.department === 'Kho vận'), true);


// --- MUC_RIENG: công thức đọc được mức gán cho từng người ---------------
// Trước khi có biến này, một khoản FORMULA không lấy được con số tiền của
// TỪNG NGƯỜI, nên mức lương KPI buộc phải nằm trong mẫu KPI — module KPI giữ
// một con số tiền lương vốn không thuộc về nó.
const kpiPay = component({
  id: 'cKPI', code: 'LUONG_KPI', name: 'Lương KPI', calc_type: 'FORMULA',
  formula: 'MUC_RIENG * KPI_PCT / 100', default_amount: 5_000_000, sort_order: 340,
});

// Không gán riêng -> lấy mức mặc định của danh mục.
const kpiDefault = computePayslip({
  profile, payProfile: payProfile({}),
  items: [{ item: item('cKPI'), component: kpiPay }],
  inputs: { KPI_PCT: 80 }, stats, settings,
});
check('MUC_RIENG lùi về mức mặc định của danh mục',
  kpiDefault.lines.find((l) => l.code === 'LUONG_KPI')?.amount, 4_000_000);

// Gán riêng cho người này -> mức riêng thắng.
const kpiOverride = computePayslip({
  profile, payProfile: payProfile({}),
  items: [{ item: item('cKPI', { amount: 8_000_000 }), component: kpiPay }],
  inputs: { KPI_PCT: 80 }, stats, settings,
});
check('MUC_RIENG lấy mức gán riêng của từng người',
  kpiOverride.lines.find((l) => l.code === 'LUONG_KPI')?.amount, 6_400_000);

// Công thức khai lúc gán phải ghi đè được cả khoản FIXED. UI trước đây cho
// nhập trường này nhưng engine bỏ qua, khiến người dùng lưu thành công mà số
// tiền vẫn giữ nguyên mức cố định.
const flexibleBonus = component({
  id: 'cFlexible', code: 'THUONG_LINH_HOAT', name: 'Thưởng linh hoạt',
  calc_type: 'FIXED', default_amount: 2_000_000, sort_order: 350,
});
const flexibleResult = computePayslip({
  profile, payProfile: payProfile({}),
  items: [{
    item: item('cFlexible', { amount: 5_000_000, formula: 'MUC_RIENG * KPI_PCT / 100' }),
    component: flexibleBonus,
  }],
  inputs: { KPI_PCT: 80 }, stats, settings,
});
check('công thức riêng ghi đè cách tính FIXED',
  flexibleResult.lines.find((l) => l.code === 'THUONG_LINH_HOAT')?.amount, 4_000_000);

// ---------------------------------------------------------------------------
// Tổng lương ghép từ nhiều khoản: khoản này đọc được mã của khoản kia.
// ---------------------------------------------------------------------------
// Đây là cách người dùng mô tả cơ chế lương: khai sẵn các khoản trong danh
// mục, rồi tổng là phép cộng trừ nhân chia giữa chúng.
//
// Phần dễ sai: khoản bị tham chiếu phải tính XONG trước. Cố ý cho khoản phụ
// thuộc một `sort_order` NHỎ HƠN khoản nó đọc tới — sắp theo sort_order thì
// nó chạy trước và đọc ra 0, ra 0đ thay vì 1.650.000đ.
const phuCapXang = component({
  id: 'cXang', code: 'PC_XANG', name: 'Phụ cấp xăng xe',
  calc_type: 'FIXED', default_amount: 500_000, sort_order: 900,
});
const phuCapAn = component({
  id: 'cAn', code: 'PC_AN', name: 'Phụ cấp ăn ca',
  calc_type: 'FIXED', default_amount: 1_000_000, sort_order: 910,
});
// Thưởng = 10% của (xăng + ăn ca). Khai sort_order 100 để nó đứng TRƯỚC.
const thuongGhep = component({
  id: 'cGhep', code: 'THUONG_GHEP', name: 'Thưởng ghép',
  calc_type: 'FORMULA', formula: '(PC_XANG + PC_AN) * 0.1', sort_order: 100,
});
const ghepResult = computePayslip({
  profile, payProfile: payProfile({}),
  items: [
    { item: item('cGhep'), component: thuongGhep },
    { item: item('cXang'), component: phuCapXang },
    { item: item('cAn'), component: phuCapAn },
  ],
  inputs: {}, stats, settings,
});
check('khoản ghép đọc được mã của khoản xếp sau nó',
  ghepResult.lines.find((l) => l.code === 'THUONG_GHEP')?.amount, 150_000);

// ---------------------------------------------------------------------------
// Lương gốc khai bằng một KHOẢN trong danh mục, thay cho pay_basis/base_amount.
// ---------------------------------------------------------------------------
// Cố ý để `base_amount` của hồ sơ là một số KHÁC (5 triệu). Engine còn đọc
// trường cũ thì đơn giá giờ ra 5tr/26/8 chứ không phải 26tr/26/8 — bài kiểm
// bắt được ngay, chứ không chỉ chạy cho có.
const luongGoc = component({
  id: 'cBase', code: 'LUONG_CO_BAN', name: 'Lương cơ bản',
  calc_type: 'FIXED', is_base: true, default_amount: 0, sort_order: 10,
});
const baseByComponent = computePayslip({
  profile,
  payProfile: payProfile({ pay_basis: 'MONTHLY', base_amount: 5_000_000 }),
  items: [{ item: item('cBase', { amount: 26_000_000 }), component: luongGoc }],
  inputs: {}, stats, settings,
});
check('đơn giá giờ suy từ khoản được đánh dấu lương gốc',
  baseByComponent.hourlyRate, 26_000_000 / 26 / 8);
check('mức đóng bảo hiểm cũng theo khoản lương gốc',
  baseByComponent.insuranceBase, 26_000_000);

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

console.log(failures === 0 ? '\nTất cả kiểm chứng đều đạt.' : `\n${failures} kiểm chứng KHÔNG đạt.`);
process.exit(failures === 0 ? 0 : 1);
