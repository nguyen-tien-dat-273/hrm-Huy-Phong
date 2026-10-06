// Ghim các luật nghiệp vụ hay trôi âm thầm. Chạy: npm run check:flows
//
// Chung một chỗ vì cùng một tính chất: sai thì KHÔNG có gì báo ra màn hình,
// chỉ có một con số lặng lẽ khác đi.
//
//   1. Bộ giải "người này dùng bộ KPI nào" — phải khớp đúng bốn lớp của
//      `public.kpi_scheme_for` (migration 20261001140000). Lệch một lớp là có
//      người đứng ngoài kỳ chấm mà không ai thấy, nên mỗi lớp có một ca chứng
//      minh nó thắng lớp dưới và một ca chứng minh nó nhường lớp trên.
//   2. Thang điểm KPI — lỗ hổng ở ranh giới hai mức.
//   3. Đếm ngày nghỉ phép theo lịch làm việc và ngày lễ.
//
// (Engine lương có bộ kiểm riêng: `npm run check:payroll`.)
import { kpiSchemeFor, unitLineage, type KpiSchemeData, type ResolvableUnit } from '../kpiSchemeFor';
import { describeLevelIssues, scoreFromLevels } from '../kpiScoring';
import { countWorkingDays } from '../leave';
import { evaluateFormula } from '../payrollFormula';
import {
  buildPayFormula, isDayCount, parsePayFormula,
  DEFAULT_GUIDED, type GuidedPayFormula,
} from '../payItemFormula';

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

const tpl = (id: string, extra: Partial<KpiSchemeData['templates'][number]> = {}) => ({
  id, name: `Bộ ${id}`, is_active: true, unit_id: null, position_id: null, created_at: null, ...extra,
});

const person = { id: 'u1', unit_id: 'phong', position_id: 'vi-tri-1' };

const base = (over: Partial<KpiSchemeData> = {}): KpiSchemeData => ({
  personalSchemes: [], unitSchemes: [], templates: [], unitById, ...over,
});

const TODAY = '2026-10-05';

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

// --- Lớp 4: mẫu theo vị trí -------------------------------------------------
check('lớp 4 — mẫu khớp vị trí',
  kpiSchemeFor(person, base({ templates: [tpl('t-vitri', { position_id: 'vi-tri-1' })] }), TODAY).templateId,
  't-vitri');

check('mẫu vị trí đã tắt thì không dùng',
  kpiSchemeFor(person, base({ templates: [tpl('t-vitri', { position_id: 'vi-tri-1', is_active: false })] }), TODAY).templateId,
  null);

// --- Lớp 3: bộ khai thẳng cho đơn vị ----------------------------------------
check('lớp 3 thắng lớp 4',
  kpiSchemeFor(person, base({
    templates: [tpl('t-vitri', { position_id: 'vi-tri-1' }), tpl('t-phong', { unit_id: 'phong' })],
  }), TODAY).templateId,
  't-phong');

check('lớp 3 đi ngược lên cấp trên khi phòng chưa khai',
  kpiSchemeFor(person, base({ templates: [tpl('t-khoi', { unit_id: 'khoi' })] }), TODAY).templateId,
  't-khoi');

check('lớp 3 — đơn vị GẦN nhất thắng cấp trên',
  kpiSchemeFor(person, base({
    templates: [tpl('t-khoi', { unit_id: 'khoi' }), tpl('t-phong', { unit_id: 'phong' })],
  }), TODAY).templateId,
  't-phong');

// --- Lớp 2: bản gán cho đơn vị ----------------------------------------------
check('lớp 2 thắng lớp 3',
  kpiSchemeFor(person, base({
    unitSchemes: [{ unit_id: 'phong', template_id: 't-gan-phong', effective_from: '2026-01-01' }],
    templates: [tpl('t-gan-phong'), tpl('t-phong', { unit_id: 'phong' })],
  }), TODAY).templateId,
  't-gan-phong');

check('lớp 2 đi ngược lên cấp trên',
  kpiSchemeFor(person, base({
    unitSchemes: [{ unit_id: 'cong-ty', template_id: 't-cong-ty', effective_from: '2026-01-01' }],
    templates: [tpl('t-cong-ty')],
  }), TODAY).label,
  'Theo phòng Huy Phong Group');

check('lớp 2 — đơn vị gần nhất thắng',
  kpiSchemeFor(person, base({
    unitSchemes: [
      { unit_id: 'cong-ty', template_id: 't-cong-ty', effective_from: '2026-01-01' },
      { unit_id: 'khoi', template_id: 't-khoi', effective_from: '2026-01-01' },
    ],
    templates: [tpl('t-cong-ty'), tpl('t-khoi')],
  }), TODAY).templateId,
  't-khoi');

// --- Lớp 1: gán riêng -------------------------------------------------------
check('lớp 1 thắng tất cả',
  kpiSchemeFor(person, base({
    personalSchemes: [{ user_id: 'u1', template_id: 't-rieng', effective_from: '2026-01-01' }],
    unitSchemes: [{ unit_id: 'phong', template_id: 't-gan-phong', effective_from: '2026-01-01' }],
    templates: [tpl('t-rieng'), tpl('t-gan-phong'), tpl('t-vitri', { position_id: 'vi-tri-1' })],
  }), TODAY).templateId,
  't-rieng');

check('gán riêng của người KHÁC không ảnh hưởng',
  kpiSchemeFor(person, base({
    personalSchemes: [{ user_id: 'u2', template_id: 't-rieng', effective_from: '2026-01-01' }],
    templates: [tpl('t-rieng')],
  }), TODAY).templateId,
  null);

// --- Ngày hiệu lực ----------------------------------------------------------
// Database lọc `effective_from <= p_on`. Bỏ qua vế này thì một bản gán hẹn
// tháng sau trông như đã có hiệu lực hôm nay, và màn hình hứa một bộ KPI mà
// phiếu chấm không dùng.
check('bản gán hẹn ngày trong TƯƠNG LAI chưa có hiệu lực',
  kpiSchemeFor(person, base({
    personalSchemes: [{ user_id: 'u1', template_id: 't-sau', effective_from: '2026-12-01' }],
    templates: [tpl('t-sau')],
  }), TODAY).templateId,
  null);

check('hai bản gán riêng thì bản hiệu lực GẦN nhất thắng',
  kpiSchemeFor(person, base({
    personalSchemes: [
      { user_id: 'u1', template_id: 't-cu', effective_from: '2026-01-01' },
      { user_id: 'u1', template_id: 't-moi', effective_from: '2026-09-01' },
    ],
    templates: [tpl('t-cu'), tpl('t-moi')],
  }), TODAY).templateId,
  't-moi');

check('bản gán tương lai không che bản đang có hiệu lực',
  kpiSchemeFor(person, base({
    personalSchemes: [
      { user_id: 'u1', template_id: 't-dang-dung', effective_from: '2026-01-01' },
      { user_id: 'u1', template_id: 't-thang-sau', effective_from: '2026-12-01' },
    ],
    templates: [tpl('t-dang-dung'), tpl('t-thang-sau')],
  }), TODAY).templateId,
  't-dang-dung');

// --- Dữ liệu hỏng -----------------------------------------------------------
// Bản gán trỏ tới một bộ đã bị xoá: phải thấy được là CÓ gán mà bộ mất, không
// được im lặng coi như chưa gán — hai thứ đó cần hai cách xử lý khác nhau.
const orphan = kpiSchemeFor(person, base({
  personalSchemes: [{ user_id: 'u1', template_id: 't-da-xoa', effective_from: '2026-01-01' }],
  templates: [],
}), TODAY);
check('bản gán trỏ tới bộ đã xoá — vẫn báo có gán', orphan.templateId, 't-da-xoa');
check('bản gán trỏ tới bộ đã xoá — không dựng được bộ', orphan.template, null);

// Gán riêng trỏ tới bộ đã TẮT vẫn thắng: database không lọc is_active ở lớp 1,
// nên lọc thêm ở client sẽ cho ra bộ khác với bộ phiếu chấm thật sự dùng.
check('gán riêng tới bộ đã tắt vẫn thắng mẫu vị trí',
  kpiSchemeFor(person, base({
    personalSchemes: [{ user_id: 'u1', template_id: 't-tat', effective_from: '2026-01-01' }],
    templates: [tpl('t-tat', { is_active: false }), tpl('t-vitri', { position_id: 'vi-tri-1' })],
  }), TODAY).templateId,
  't-tat');

// --- Người chưa gán đơn vị --------------------------------------------------
check('người chưa gán đơn vị bỏ qua lớp 2 và 3',
  kpiSchemeFor({ id: 'u1', unit_id: null, position_id: 'vi-tri-1' }, base({
    unitSchemes: [{ unit_id: 'phong', template_id: 't-gan-phong', effective_from: '2026-01-01' }],
    templates: [tpl('t-gan-phong'), tpl('t-vitri', { position_id: 'vi-tri-1' })],
  }), TODAY).templateId,
  't-vitri');

// --- Thang điểm: hai mức chạm nhau ở một điểm -------------------------------
//
// Đúng MỘT đầu mở là liền mạch: 105 thuộc mức dưới. CẢ HAI đầu cùng mở thì 105
// không thuộc mức nào và `scoreFromLevels` trả null. Lỗ hổng rộng đúng một
// điểm nên nhánh "hở khoảng" của bộ kiểm không thấy — mà 105 lại chính là con
// số hay bị gõ nhất, vì nó là ranh giới hai mức. Bảng KPI thật của công ty
// viết "Từ 90 - 105%" ngay cạnh "Trên 105%".
const chamNhau = (haiDauMo: boolean) => [
  { score: 3, min: 90, max: 105, max_exclusive: haiDauMo },
  { score: 4, min: 105, min_exclusive: true },
];
check('chạm nhau, một đầu mở — liền mạch, không báo gì',
  describeLevelIssues(chamNhau(false)).length, 0);
check('chạm nhau, một đầu mở — số ranh giới vẫn ra điểm',
  scoreFromLevels(chamNhau(false), 105), 3);
check('chạm nhau, CẢ HAI đầu mở — phải báo lỗ hổng',
  describeLevelIssues(chamNhau(true)).length, 1);
check('chạm nhau, cả hai đầu mở — số ranh giới đúng là không ra điểm',
  scoreFromLevels(chamNhau(true), 105), null);
check('hai mức cùng phủ ranh giới thì vẫn báo chồng lấn',
  describeLevelIssues([{ score: 3, min: 90, max: 105 }, { score: 4, min: 105 }]).length, 1);

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

// --- Công thức một khoản lương, khai bằng ô chọn ----------------------------
//
// Hình dạng: [vế tiền] × [số liệu] × [hệ số], chia 100 nếu khai theo %.
//
// `parsePayFormula` phải là chiều ngược ĐÚNG của `buildPayFormula`: mở lại một
// cơ chế đã khai mà các ô chọn hiện sai thì bấm Lưu một cái là ghi đè mất công
// thức thật của người ta.
const MA_KHOAN = ['LUONG_CB', 'PC_XANG'];
/** Mã số liệu tháng đã khai ở `input_code` của khoản nào đó trong danh mục. */
const MA_SO_LIEU = [
  'SO_CHUYEN', 'DOANH_SO', 'OT_NGAY_THUONG', 'OT_NGAY_LE', 'OT_NGAY_SAU_22H',
  'SO_TINH_CONG_TAC', 'THUONG', 'PHAT',
];
const doc = (formula: string) => parsePayFormula(formula, MA_KHOAN, MA_SO_LIEU);
const dung = (patch: Partial<GuidedPayFormula>) =>
  buildPayFormula({ ...DEFAULT_GUIDED, ...patch });

check('cố định: trả nguyên mức khai riêng', dung({}), 'MUC_RIENG');
check('cố định: trả nguyên một khoản khác',
  dung({ source: { kind: 'CODE', code: 'PC_XANG' } }), 'PC_XANG');
check('mức riêng × số liệu tháng',
  dung({ variable: 'SO_CHUYEN' }), 'MUC_RIENG * SO_CHUYEN');
check('lấy vế tiền từ khoản khác',
  dung({ source: { kind: 'CODE', code: 'LUONG_CB' }, variable: 'WORK_HOURS' }),
  'LUONG_CB * WORK_HOURS');
check('chia công chuẩn rồi nhân ngày công thực tế',
  dung({ source: { kind: 'CODE', code: 'LUONG_CB' }, variable: 'PAID_DAYS', prorate: true }),
  '(LUONG_CB / STANDARD_DAYS) * PAID_DAYS');
check('hệ số nhân thêm',
  dung({ variable: 'OT_NGAY_LE', coefficient: '2' }), 'MUC_RIENG * OT_NGAY_LE * 2');
check('khai theo phần trăm',
  dung({ variable: 'DOANH_SO', percent: true }), 'MUC_RIENG * DOANH_SO / 100');
check('tổng nhiều khoản',
  dung({ source: { kind: 'SUM', codes: ['LUONG_CB', 'PC_XANG'] }, coefficient: '0.01' }),
  '(LUONG_CB + PC_XANG) * 0.01');
check('tổng một khoản thì bỏ ngoặc',
  dung({ source: { kind: 'SUM', codes: ['LUONG_CB'] } }), 'LUONG_CB');
check('không có vế tiền: cả khoản là con số quản lý nhập',
  dung({ source: { kind: 'NONE' }, variable: 'THUONG' }), 'THUONG');

// Đi vòng tròn build -> parse -> build cho mọi tổ hợp của năm ô.
for (const source of [
  { kind: 'FIXED' as const },
  { kind: 'CODE' as const, code: 'PC_XANG' },
  { kind: 'SUM' as const, codes: ['LUONG_CB', 'PC_XANG'] },
  { kind: 'NONE' as const },
]) {
  for (const variable of [null, 'PAID_DAYS', 'WORK_HOURS', 'SO_CHUYEN']) {
    for (const coefficient of [null, '2', '0.01']) {
      for (const percent of [false, true]) {
        for (const prorate of [false, true]) {
          const sinh = dung({ source, variable, coefficient, percent, prorate });
          if (sinh === '') continue;   // không khai gì cả, không phải công thức
          const lai = doc(sinh);
          check(`đi vòng tròn: ${sinh}`, lai ? buildPayFormula(lai) : null, sinh);
        }
      }
    }
  }
}

// Không khớp hình dạng thì phải trả null để màn hình giữ nguyên ô công thức tự
// do — đoán bừa rồi ghi đè là mất công thức người dùng đã viết tay.
for (const [vi_sao, la] of [
  ['có lời gọi hàm', 'IF(WORK_DAYS > 20, MUC_RIENG, 0)'],
  ['có hàm MIN', 'MIN(KPI_TARGET * KPI_PCT / 100, KPI_TARGET * 1.2)'],
  ['mã khoản không có thật', 'KHONG_CO * PAID_DAYS'],
  ['số liệu không có thật làm số nhân', 'MUC_RIENG * KHONG_CO'],
  ['hai khoản tiền nhân nhau', 'LUONG_CB * PC_XANG'],
  ['hai mức hệ thống nhân nhau', 'HOURLY_RATE * DAILY_RATE'],
  ['cộng ở ngoài ngoặc', 'BASE_WORK + LUONG_CB'],
  ['có phép trừ', 'MUC_RIENG - PHAT'],
  ['chia cho biến khác ngày công chuẩn', 'MUC_RIENG / WORK_DAYS'],
  ['cộng lẫn tiền với ngày', '(LUONG_CB + PAID_DAYS) * 0.01'],
  ['ngày công làm vế tiền', 'PAID_DAYS * SO_CHUYEN'],
  ['ngoặc lệch', '(MUC_RIENG * 2'],
  ['rỗng', ''],
] as const) {
  check(`giữ ô tự do khi ${vi_sao}`, doc(la), null);
}

check('khoảng trắng thừa vẫn đọc được', doc('  MUC_RIENG  *  SO_CHUYEN  ')?.variable, 'SO_CHUYEN');
check('thiếu ngoặc vẫn đọc được dạng chia công chuẩn',
  doc('LUONG_CB / STANDARD_DAYS * PAID_DAYS')?.prorate, true);
// Mức hệ thống làm vế tiền: CÓ CHỦ ĐÍCH nhận, khác bản đầu. Làm thêm giờ của
// công ty tính trên `HOURLY_RATE`, chặn thì cả nhóm đó không khai được.
check('mức hệ thống làm vế tiền thì nhận',
  doc('GROSS * PAID_DAYS')?.source, { kind: 'CODE', code: 'GROSS' });

// Ví dụ thật: lương cơ bản 8tr, đi 22/24,5 công.
//
// Hai cách hiểu lệch nhau 24,5 lần, mà khác biệt chỉ là một lựa chọn. Màn
// hình bày cả hai con số ra cạnh nhau chính vì ca này.
const LUONG = { LUONG_CB: 8_000_000, PAID_DAYS: 22, STANDARD_DAYS: 24.5 };
const tinh = (prorate: boolean) => evaluateFormula(buildPayFormula({
  source: { kind: 'CODE', code: 'LUONG_CB' },
  variable: 'PAID_DAYS', coefficient: null, percent: false, prorate,
}), LUONG).value;
check('coi 8tr là đơn giá NGÀY thì ra 176 triệu', tinh(false), 176_000_000);
check('coi 8tr là lương THÁNG thì ra đúng ~7,18 triệu',
  Math.round(tinh(true)), 7_183_673);

// Chia công chuẩn chỉ có nghĩa với biến đếm NGÀY công.
check('ngày hưởng lương là số đếm ngày', isDayCount('PAID_DAYS'), true);
check('giờ làm KHÔNG phải số đếm ngày', isDayCount('WORK_HOURS'), false);
check('KPI% KHÔNG phải số đếm ngày', isDayCount('KPI_PCT'), false);
check('số liệu tự đặt KHÔNG phải số đếm ngày', isDayCount('SO_CHUYEN'), false);

// --- Ô chọn phải diễn tả được công thức THẬT của công ty --------------------
//
// Kiểm chứng quan trọng nhất của màn Cơ chế lương. Bản đầu của bộ ô chọn chỉ
// nhận `tiền × số liệu`; đem 14 công thức đang gieo trong database chạy qua thì
// CHỈ 2 CÁI đọc được — nghĩa là trên thực tế không ai khai được bằng ô chọn,
// tất cả rơi về ô viết tay. Thiếu đúng bốn thứ: thứ tự hai vế đảo được, hệ số
// (`× 2` của làm thêm giờ), chia 100, và tổng nhiều khoản (phí công đoàn).
//
// Mỗi dòng dưới đây là công thức LẤY NGUYÊN từ migration. Hai điều phải đúng:
//
//   1. `parsePayFormula` đọc được — nếu không thì ô chọn vô dụng với chính
//      danh mục của công ty.
//   2. Đọc rồi DỰNG LẠI ra ĐÚNG CÙNG MỘT SỐ TIỀN. Chuỗi được phép khác (thứ tự
//      hai vế đảo, `* 2 * 2` gộp thành `* 4`) nhưng tiền thì không được lệch
//      một đồng: mở một cơ chế ra rồi bấm Lưu là ghi lại chuỗi mới, nên lệch ở
//      đây là âm thầm trả sai lương.
const DANH_MUC_THAT = [
  'LUONG_VAN_CHUYEN', 'LUONG_DOANH_SO', 'LUONG_OT_THUONG', 'LUONG_OT_LE',
  'CONG_THEM_DEM', 'PC_VAN_PHONG', 'PC_VAN_CHUYEN', 'PC_CONG_TAC_TINH',
  'THUONG_THANG', 'PHAT_THANG', 'PHI_CONG_DOAN', 'QUY_CONG_DOAN', 'LUONG_KPI',
];

// Số lẻ, khác nhau từng biến: hai công thức khác nghĩa mà tình cờ ra cùng một
// số thì kiểm chứng này sẽ không bắt được.
const SO_MAU: Record<string, number> = {
  MUC_RIENG: 37_000, SO_CHUYEN: 13, DOANH_SO: 417_000_000,
  HOURLY_RATE: 41_322, DAILY_RATE: 330_578,
  OT_NGAY_THUONG: 7, OT_NGAY_LE: 3, OT_NGAY_SAU_22H: 4,
  WORK_DAYS: 21, SO_TINH_CONG_TAC: 6, PAID_DAYS: 22, STANDARD_DAYS: 24.5,
  THUONG: 1_750_000, PHAT: 220_000,
  BASE_WORK: 7_900_000, LUONG_VAN_CHUYEN: 481_000, LUONG_DOANH_SO: 6_255_000,
  KPI_TARGET: 3_300_000, KPI_PCT: 93.5,
};

for (const [ten, goc] of [
  ['Lương vận chuyển', 'SO_CHUYEN * MUC_RIENG'],
  ['Lương doanh số', 'DOANH_SO * MUC_RIENG / 100'],
  ['Làm thêm ngày thường', 'HOURLY_RATE * OT_NGAY_THUONG * 2'],
  ['Làm thêm ngày lễ', 'HOURLY_RATE * OT_NGAY_LE * 2 * 2'],
  ['Cộng thêm sau 22h', 'DAILY_RATE * OT_NGAY_SAU_22H'],
  ['Phụ cấp vận chuyển', 'MUC_RIENG * WORK_DAYS'],
  ['Phụ cấp công tác tỉnh', 'MUC_RIENG * SO_TINH_CONG_TAC'],
  ['Thưởng', 'THUONG'],
  ['Phạt', 'PHAT'],
  ['Phí công đoàn', '(BASE_WORK + LUONG_VAN_CHUYEN + LUONG_DOANH_SO) * 0.01'],
  ['Quỹ công đoàn (bản đầu)', 'BASE_WORK * 0.01'],
  ['Lương KPI', 'KPI_TARGET * KPI_PCT / 100'],
  ['Lương KPI (bản cũ)', 'MUC_RIENG * KPI_PCT / 100'],
  ['Khoản cố định', 'MUC_RIENG'],
] as const) {
  const guided = parsePayFormula(goc, DANH_MUC_THAT, [
    'SO_CHUYEN', 'DOANH_SO', 'OT_NGAY_THUONG', 'OT_NGAY_LE', 'OT_NGAY_SAU_22H',
    'SO_TINH_CONG_TAC', 'THUONG', 'PHAT',
  ]);
  if (!guided) {
    check(`ô chọn đọc được công thức thật: ${ten}`, null, goc);
    continue;
  }
  const dungLai = buildPayFormula(guided);
  // Nhân 100 rồi làm tròn: so tiền tới hàng xu, bỏ qua nhiễu dấu phẩy động.
  check(`${ten}: dựng lại ra đúng tiền cũ (${goc} => ${dungLai})`,
    Math.round(evaluateFormula(dungLai, SO_MAU).value * 100),
    Math.round(evaluateFormula(goc, SO_MAU).value * 100));
}

console.log(failures === 0 ? '\nTất cả kiểm chứng đều đạt.' : `\n${failures} kiểm chứng KHÔNG đạt.`);
process.exit(failures === 0 ? 0 : 1);
