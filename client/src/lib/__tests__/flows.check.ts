// Ghim các luật nghiệp vụ hay trôi âm thầm. Chạy: npm run check:flows
//
// Chung một chỗ vì cùng một tính chất: sai thì KHÔNG có gì báo ra màn hình,
// chỉ có một con số lặng lẽ khác đi.
//
//   1. Chuỗi đơn vị cha — cơ chế lương thừa hưởng theo đúng chuỗi này.
//   2. Dải quy đổi KPI — ranh giới hai dải.
//   3. Đếm ngày nghỉ phép theo lịch làm việc và ngày lễ.
//   4. Ô công thức dạng thẻ — chuyển qua lại giữa TÊN người dùng thấy và MÃ
//      được lưu; lệch một chiều là bấm Lưu đổi luôn công thức thật.
//
// (Engine lương có bộ kiểm riêng: `npm run check:payroll`.)
import { unitLineage, type ResolvableUnit } from '../orgUnits';
import { scoreFromValue, setProblems, type KpiCriterion } from '../kpi';
import { countWorkingDays } from '../leave';
import { evaluateFormula } from '../payrollFormula';
import {
  OP_DISPLAY, describeFormula, formulaIssueOf, groupEntries, parseLooseFormula, parseLooseNumber, previewFormula,
  referencedCodes, referencedFunctions, renderFormulaWithValues, searchEntries, serializeFormula, serializeWithOffsets,
  tokenIndexAt, tokenizeFormula, type FormulaEntry,
} from '../formulaTokens';
import { RESERVED_FORMULA_NAMES } from '../payrollVariables';

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n        got ${JSON.stringify(actual)}\n        want ${JSON.stringify(expected)}`}`);
}

// --- Cơ cấu mẫu: cong ty > khoi > phong -------------------------------------
const units: ResolvableUnit[] = [
  { id: 'cong-ty', name: 'Huy Phong Group', parent_id: null },
  { id: 'khoi', name: 'Khối Văn Phòng', parent_id: 'cong-ty' },
  { id: 'phong', name: 'Bộ phận Dự án', parent_id: 'khoi' },
];
const unitById = new Map(units.map((u) => [u.id, u]));

// --- Chuỗi đơn vị -----------------------------------------------------------
check('chuỗi đơn vị đi từ gần tới xa',
  unitLineage('phong', unitById).map((u) => u.id), ['phong', 'khoi', 'cong-ty']);
check('không có đơn vị thì chuỗi rỗng', unitLineage(null, unitById), []);

// Vòng cha-con không được làm treo trình duyệt.
const loopUnits = new Map<string, ResolvableUnit>([
  ['a', { id: 'a', name: 'A', parent_id: 'b' }],
  ['b', { id: 'b', name: 'B', parent_id: 'a' }],
]);
check('vòng cha-con vẫn dừng', unitLineage('a', loopUnits).map((u) => u.id), ['a', 'b']);

// --- Dải quy đổi: hai dải chạm nhau ---------------------------------------
//
// Dải là [từ, dưới): 105 thuộc dải trên. Bảng KPI thật viết "Từ 90 - 105%"
// ngay cạnh "Trên 105%" — 105 là con số hay gõ nhất.
const chamNhau = [{ min: 90, max: 105, score: 3 }, { min: 105, max: null, score: 4 }];
check('chạm nhau — số ranh giới thuộc dải trên', scoreFromValue(chamNhau, 105), 4);
check('chạm nhau — ngay dưới ranh giới thuộc dải dưới', scoreFromValue(chamNhau, 104.99), 3);
const dai = (ranges: KpiCriterion['ranges']): KpiCriterion => ({
  category: 'A', name: 'x', measure: null, group_code: 'QUANT', weight: 100, standard_score: 4, method: 'RANGE',
  levels: [], ranges, value_unit: '%', penalty_pct: null, allow_over: false, source: null,
});
check('chạm nhau không bị báo chồng', setProblems([dai(chamNhau)]), []);
check('hai dải cùng phủ một đoạn thì báo chồng',
  setProblems([dai([{ min: 90, max: 106, score: 3 }, { min: 105, max: null, score: 4 }])]).length, 1);

// --- Ngày nghỉ phép đếm theo lịch làm việc ----------------------------------
//
// Trước đây `countWorkingDays` chỉ bỏ thứ Bảy/Chủ nhật, kèm comment nói "hệ
// thống chưa có bảng ngày lễ" — câu đó lỗi thời từ migration 20260927120000.
// Hệ quả: đơn vắt qua Tết bị TRỪ OAN ngày phép cho những hôm vốn đã nghỉ.
const lichDayDu = {
  supported: true,
  schedules: [{
    id: 's1', name: 'Hành chính', effective_from: '2020-01-01', effective_to: null,
    start_time: '08:00', end_time: '17:00', break_minutes: 60, saturday_mode: 'HALF' as const,
  }],
};
// 02–06/02/2026 là thứ Hai tới thứ Sáu.
check('không lịch — vẫn đếm như cũ, 5 ngày',
  countWorkingDays('2026-02-02', '2026-02-06'), 5);
check('có ngày lễ 03/02 — chỉ còn 4 ngày bị trừ phép',
  countWorkingDays('2026-02-02', '2026-02-06', { schedules: lichDayDu, holidays: new Set(['2026-02-03']) }), 4);
// 07/02/2026 là thứ Bảy, ca khai HALF nên tính nửa ngày.
check('thứ Bảy nửa ngày tính 0,5',
  countWorkingDays('2026-02-02', '2026-02-07', { schedules: lichDayDu, holidays: new Set() }), 5.5);
check('chủ nhật không tính',
  countWorkingDays('2026-02-08', '2026-02-08', { schedules: lichDayDu, holidays: new Set() }), 0);
check('ngày kết thúc trước ngày bắt đầu trả 0',
  countWorkingDays('2026-02-06', '2026-02-02'), 0);

// --- Ô công thức dạng thẻ -----------------------------------------------------
//
// Công thức LƯU bằng mã (`LUONG_CO_BAN / STANDARD_DAYS * WORK_DAYS`), người
// dùng thấy và gõ bằng TÊN. Hai chiều phải khớp tuyệt đối: mở lại một cơ chế
// mà thẻ ghép ra chuỗi khác, bấm Lưu một cái là đổi công thức thật của người ta.
const ENTRIES: FormulaEntry[] = [
  { code: 'LUONG_CO_BAN', name: 'Lương cơ bản', group: 'ROW' },
  { code: 'DAILY_RATE', name: 'Đơn giá ngày', group: 'ROW' },
  { code: 'BASE_WORK', name: 'Lương thời gian', group: 'ROW' },
  { code: 'TY_LE_BHXH_NLD', name: 'Tỷ lệ BHXH người lao động', group: 'PARAM', section: 'Bảo hiểm' },
  { code: 'LUONG_CO_SO', name: 'Lương cơ sở', group: 'PARAM' },
  { code: 'STANDARD_DAYS', name: 'Công chuẩn của tháng', group: 'SYSTEM' },
  { code: 'WORK_DAYS', name: 'Ngày công thực tế', group: 'SYSTEM' },
  { code: 'KPI_PCT', name: 'Điểm KPI (dạng số)', group: 'SYSTEM', hidden: true },
  { code: 'MUC_RIENG', name: 'Mức riêng', group: 'SYSTEM', hidden: true },
  { code: 'THUE_LUY_TIEN', name: 'Biểu thuế lũy tiến', group: 'TIER', isFunction: true },
  { code: 'MIN', name: 'Nhỏ nhất', group: 'FUNCTION', isFunction: true },
  { code: 'IF', name: 'Nếu', group: 'FUNCTION', isFunction: true },
  { code: 'PHU_CAP_KHAC', name: 'Phụ cấp khác', group: 'CATALOG', componentId: 'c1' },
];
const tenCua = (code: string) => ENTRIES.find((entry) => entry.code === code)?.name;
const giuNguyen = (formula: string) => serializeFormula(tokenizeFormula(formula));

check('tách thẻ: đầu mục, phép tính, dữ liệu',
  tokenizeFormula('LUONG_CO_BAN / STANDARD_DAYS * WORK_DAYS').map((token) => token.kind), ['ref', 'op', 'ref', 'op', 'ref']);
for (const formula of [
  'LUONG_CO_BAN / STANDARD_DAYS * WORK_DAYS',
  'MIN(LUONG_CO_BAN, 46800000) * (TY_LE_BHXH_NLD + 0.015)',
  'IF(DOANH_SO_KHOAN > 0, DOANH_SO * HH_BL02(DOANH_SO / DOANH_SO_KHOAN * 100), 0)',
  'MAX(0, THU_NHAP_CHIU_THUE - INS_EMPLOYEE - GIAM_TRU_BAN_THAN - DEPENDENTS * GIAM_TRU_NPT)',
  'IF(DOANH_SO_KHOAN > 0 && DOANH_SO / DOANH_SO_KHOAN > NGUONG_THUONG_VUOT, MUC_THUONG_VUOT, 0)',
  'TONG_THU_NHAP - (MIN(ALLOW_MEAL, 730000) + ROUND(OT_WEEKDAY * (1.5 - 1) / 1.5))',
]) {
  check(`tách rồi ghép giữ nguyên chuỗi: ${formula}`, giuNguyen(formula), formula);
}
check('viết liền, chữ thường, số có gạch dưới vẫn về đúng dạng chuẩn',
  giuNguyen('luong_co_ban/STANDARD_DAYS*work_days+1_000_000'), 'LUONG_CO_BAN / STANDARD_DAYS * WORK_DAYS + 1000000');
check('ký tự lạ thành thẻ lỗi, không ném lỗi', tokenizeFormula('LUONG_CO_BAN # 2').map((token) => token.kind), ['ref', 'unknown', 'num']);
check('mã đọc tới: không trùng, không gồm tên hàm',
  referencedCodes('MIN(LUONG_CO_BAN, TRAN) * TY_LE + LUONG_CO_BAN'), ['LUONG_CO_BAN', 'TRAN', 'TY_LE']);
check('hàm đọc tới', referencedFunctions('MIN(A, THUE_LUY_TIEN(B))'), ['MIN', 'THUE_LUY_TIEN']);
const viTriThe = serializeWithOffsets(tokenizeFormula('A + BB'));
check('vị trí ký tự → thẻ chứa nó', tokenIndexAt(viTriThe.offsets, 5), 2);
check('vị trí rơi vào khoảng trắng → thẻ ngay sau', tokenIndexAt(viTriThe.offsets, 1), 1);

// --- Gợi ý khi gõ: không dấu, đầu từ, chữ cái đầu ---------------------------
check('gõ không dấu ra đúng đầu mục', searchEntries(ENTRIES, 'luong co ban')[0]?.code, 'LUONG_CO_BAN');
check('gõ chữ cái đầu "lcb"', searchEntries(ENTRIES, 'lcb')[0]?.code, 'LUONG_CO_BAN');
check('gõ giữa tên "co ban"', searchEntries(ENTRIES, 'co ban')[0]?.code, 'LUONG_CO_BAN');
check('gõ một phần tên "bhxh"', searchEntries(ENTRIES, 'bhxh')[0]?.code, 'TY_LE_BHXH_NLD');
check('gõ mã cũng ra', searchEntries(ENTRIES, 'daily_rate')[0]?.code, 'DAILY_RATE');
check('dữ liệu ẩn không gợi ý (chỉ để hiện tên công thức cũ)', searchEntries(ENTRIES, 'muc rieng'), []);
check('chưa gõ gì thì gợi ý mọi thứ trừ dữ liệu ẩn', searchEntries(ENTRIES, '').length, ENTRIES.length - 2);
check('gợi ý xếp nhóm theo thứ tự cố định',
  groupEntries(searchEntries(ENTRIES, '')).map((block) => block.group), ['ROW', 'PARAM', 'SYSTEM', 'TIER', 'FUNCTION', 'CATALOG']);

// --- Đọc chữ dán vào / "Dạng chữ" --------------------------------------------
check('số kiểu Việt: dấu chấm hàng nghìn', parseLooseNumber('1.000.000'), '1000000');
check('số kiểu Việt: dấu phẩy thập phân', parseLooseNumber('1,5'), '1.5');
check('có cả chấm và phẩy', parseLooseNumber('1.234,5'), '1234.5');
check('0.015 là số thập phân, không phải 15', parseLooseNumber('0.015'), '0.015');
check('1.5 là số thập phân', parseLooseNumber('1.5'), '1.5');
check('10% thành 0,1', parseLooseNumber('10%'), '0.1');
check('không phải số thì null', parseLooseNumber('abc'), null);
const doc = (text: string) => serializeFormula(parseLooseFormula(text, ENTRIES));
check('đọc theo tên và dấu × ÷', doc('Lương cơ bản ÷ Công chuẩn của tháng × Ngày công thực tế'),
  'LUONG_CO_BAN / STANDARD_DAYS * WORK_DAYS');
check('đọc "x" và ":" như nhân chia', doc('luong co ban x 2 : 26'), 'LUONG_CO_BAN * 2 / 26');
check('đọc hàm theo tên, dấu ";" ngăn đối số', doc('Nhỏ nhất(Lương cơ bản; 46.800.000)'), 'MIN(LUONG_CO_BAN, 46800000)');
check('đọc phần trăm và dấu phẩy thập phân', doc('10% × Lương cơ bản + 1,5'), '0.1 * LUONG_CO_BAN + 1.5');
check('đọc được tên của dữ liệu ẩn khi gõ đúng tên', doc('Mức riêng × 2'), 'MUC_RIENG * 2');
check('đoạn không khớp gì thành thẻ lỗi', parseLooseFormula('Lương cơ bản + abc xyz', ENTRIES).map((token) => token.kind),
  ['ref', 'op', 'unknown']);
for (const formula of [
  'LUONG_CO_BAN / STANDARD_DAYS * WORK_DAYS',
  'MIN(LUONG_CO_BAN, 46800000) * (TY_LE_BHXH_NLD + 0.015)',
  'IF(WORK_DAYS > 20, MUC_RIENG * 1.234, 0)',
  'THUE_LUY_TIEN(LUONG_CO_SO * 2.5)',
]) {
  check(`chuyển qua "Dạng chữ" rồi về không đổi công thức: ${formula}`, doc(describeFormula(formula, tenCua)), formula);
}

// --- Kiểm tra và diễn giải ---------------------------------------------------
const phamVi = { LUONG_CO_BAN: 12_000_000, STANDARD_DAYS: 24, WORK_DAYS: 22, TY_LE_BHXH_NLD: 0.08, MUC_RIENG: 1 };
const loi = (formula: string) => formulaIssueOf(tokenizeFormula(formula), phamVi, {}, tenCua);
check('công thức đúng thì không lỗi', loi('LUONG_CO_BAN / STANDARD_DAYS * WORK_DAYS'), null);
check('thẻ lạ báo lỗi đúng thẻ', loi('LUONG_CO_BAN # 2')?.tokenIndex, 1);
check('đầu mục chưa có trong cơ chế: nói bằng TÊN, chỉ đúng thẻ',
  loi('LUONG_CO_BAN + PHU_CAP_KHAC'), { message: '“Phụ cấp khác” chưa có trong cơ chế này.', tokenIndex: 2 });
check('thiếu ngoặc đóng hàm: nói bằng tên hàm', loi('MIN(LUONG_CO_BAN, 2')?.message.includes('Nhỏ nhất'), true);
check('diễn giải bằng tên', describeFormula('LUONG_CO_BAN / STANDARD_DAYS * WORK_DAYS', tenCua),
  'Lương cơ bản ÷ Công chuẩn của tháng × Ngày công thực tế');
check('diễn giải hàm và đối số', describeFormula('MIN(LUONG_CO_BAN, 46800000)', tenCua), 'Nhỏ nhất(Lương cơ bản; 46.800.000)');
check('số lẻ trong công thức giữ đủ chữ số', describeFormula('LUONG_CO_BAN * 0.015', tenCua), 'Lương cơ bản × 0,015');
check('thay số cho cột "Cách tính"', renderFormulaWithValues('LUONG_CO_BAN / STANDARD_DAYS * WORK_DAYS', phamVi, tenCua),
  '12.000.000 ÷ 24 × 22');
check('tính thử', previewFormula(tokenizeFormula('LUONG_CO_BAN / STANDARD_DAYS * WORK_DAYS'), phamVi, {}), 11_000_000);
check('tính thử công thức có thẻ lỗi thì không ra số', previewFormula(tokenizeFormula('LUONG_CO_BAN # 2'), phamVi, {}), null);
check('dấu hiển thị dễ đọc', [OP_DISPLAY['*'], OP_DISPLAY['/'], OP_DISPLAY['-'], OP_DISPLAY['>=']], ['×', '÷', '−', '≥']);
check('mức riêng của dòng tính được trong công thức cũ',
  evaluateFormula('MUC_RIENG * WORK_DAYS', { MUC_RIENG: 50_000, WORK_DAYS: 22 }).value, 1_100_000);
check('tên dành riêng gồm dữ liệu tự động, mức riêng và hàm',
  ['WORK_DAYS', 'TONG_THU_NHAP', 'MUC_RIENG', 'MIN'].every((code) => RESERVED_FORMULA_NAMES.includes(code)), true);

console.log(failures === 0 ? '\nTất cả kiểm chứng đều đạt.' : `\n${failures} kiểm chứng KHÔNG đạt.`);
process.exit(failures === 0 ? 0 : 1);
