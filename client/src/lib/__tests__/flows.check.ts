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

console.log(failures === 0 ? '\nTất cả kiểm chứng đều đạt.' : `\n${failures} kiểm chứng KHÔNG đạt.`);
process.exit(failures === 0 ? 0 : 1);
