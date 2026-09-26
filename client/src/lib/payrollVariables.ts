// ============================================================================
// Từ vựng chung của phần lương: loại & đơn vị tham số, dữ liệu tự động mà hệ
// thống cấp cho công thức, hàm dựng sẵn, cách lấy giá trị của một dòng cơ chế.
// ----------------------------------------------------------------------------
// Tách riêng để engine, màn Tham số, màn Cơ chế và ô công thức dùng CHUNG một
// danh sách — tên hiển thị của một biến ở ô công thức phải trùng với tên ở
// nhật ký tính và trên phiếu lương.
// ============================================================================

/** Loại tham số — quyết định đơn vị được chọn. */
export type ParamType = 'TIME' | 'MONEY' | 'RATE' | 'COUNT';

export type ParamUnit =
  | 'NGAY' | 'GIO' | 'PHUT' | 'THANG'
  | 'VND' | 'VND_NGAY' | 'VND_GIO' | 'VND_THANG' | 'VND_LAN' | 'VND_SP'
  | '%' | 'HE_SO'
  | 'LAN' | 'NGUOI' | 'CHUYEN' | 'SP';

export const PARAM_TYPE_LABEL: Record<ParamType, string> = {
  TIME: 'Thời gian',
  MONEY: 'Giá',
  RATE: 'Tỷ lệ',
  COUNT: 'Số lượng',
};

export const PARAM_TYPE_UNITS: Record<ParamType, readonly ParamUnit[]> = {
  TIME: ['NGAY', 'GIO', 'PHUT', 'THANG'],
  MONEY: ['VND', 'VND_NGAY', 'VND_GIO', 'VND_THANG', 'VND_LAN', 'VND_SP'],
  RATE: ['%', 'HE_SO'],
  COUNT: ['LAN', 'NGUOI', 'CHUYEN', 'SP'],
};

export const PARAM_UNIT_LABEL: Record<ParamUnit, string> = {
  NGAY: 'ngày', GIO: 'giờ', PHUT: 'phút', THANG: 'tháng',
  VND: 'đồng', VND_NGAY: 'đồng/ngày', VND_GIO: 'đồng/giờ', VND_THANG: 'đồng/tháng', VND_LAN: 'đồng/lần',
  VND_SP: 'đồng/sản phẩm',
  '%': '%', HE_SO: 'hệ số',
  LAN: 'lần', NGUOI: 'người', CHUYEN: 'chuyến', SP: 'sản phẩm',
};

export const ALL_PARAM_UNITS = Object.keys(PARAM_UNIT_LABEL) as ParamUnit[];

export function typeOfUnit(unit: ParamUnit): ParamType {
  return (Object.keys(PARAM_TYPE_UNITS) as ParamType[]).find((type) => PARAM_TYPE_UNITS[type].includes(unit)) ?? 'MONEY';
}

/**
 * Giá trị một tham số mang vào công thức. Tham số đơn vị % được hiểu đúng là
 * phần trăm: 1,5 % vào công thức là 0,015 — người dùng gõ
 * "Lương đóng BH × Tỷ lệ BHYT" là ra số tiền, không phải nhớ chia 100.
 */
export function formulaValueOf(value: number, unit: ParamUnit | null | undefined): number {
  return unit === '%' ? value / 100 : value;
}

const numberFormat = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 4 });

/** Hiện một con số kèm đơn vị: "1,5 %", "400.000 đồng/ngày", "26 ngày". */
export function formatWithUnit(value: number, unit: ParamUnit | null | undefined): string {
  if (!Number.isFinite(value)) return '—';
  const text = numberFormat.format(value);
  if (!unit) return text;
  return unit === '%' ? `${text}%` : `${text} ${PARAM_UNIT_LABEL[unit]}`;
}

// ---------------------------------------------------------------------------
// Dữ liệu tự động — hệ thống lấy từ chấm công, đơn OT và KPI mỗi tháng
// ---------------------------------------------------------------------------

export interface SystemVariable {
  code: string;
  name: string;
  unit: ParamUnit | null;
  hint: string;
  /** Vẫn tính được nhưng không gợi ý khi gõ — giữ cho công thức cũ chạy. */
  hidden?: boolean;
}

export const TOTAL_EARNINGS_CODE = 'TONG_THU_NHAP';

export const SYSTEM_VARIABLES: readonly SystemVariable[] = [
  { code: 'WORK_DAYS', name: 'Ngày công thực tế', unit: 'NGAY', hint: 'Số ngày có chấm công đã duyệt trong tháng' },
  { code: 'LEAVE_DAYS', name: 'Ngày nghỉ phép có lương', unit: 'NGAY', hint: 'Từ đơn nghỉ phép đã duyệt' },
  { code: 'HOLIDAY_DAYS', name: 'Ngày nghỉ lễ', unit: 'NGAY', hint: 'Ngày lễ công ty không đi làm' },
  { code: 'PAID_DAYS', name: 'Ngày hưởng lương', unit: 'NGAY', hint: 'Ngày công thực tế + phép + lễ' },
  { code: 'UNPAID_DAYS', name: 'Ngày nghỉ không lương', unit: 'NGAY', hint: 'Công chuẩn − ngày hưởng lương' },
  { code: 'STANDARD_DAYS', name: 'Công chuẩn của tháng', unit: 'NGAY', hint: 'Theo lịch làm việc; chưa khai ca thì lấy công chuẩn ở Tham số lương' },
  { code: 'WORK_HOURS', name: 'Giờ làm thực tế', unit: 'GIO', hint: 'Cộng dồn giờ vào – ra đã duyệt' },
  { code: 'HOURS_PER_DAY', name: 'Giờ làm chuẩn mỗi ngày', unit: 'GIO', hint: 'Thiết lập giờ làm của công ty' },
  { code: 'OT_WEEKDAY_HOURS', name: 'Giờ làm thêm ngày thường', unit: 'GIO', hint: 'Từ đơn làm thêm đã duyệt' },
  { code: 'OT_WEEKEND_HOURS', name: 'Giờ làm thêm ngày nghỉ', unit: 'GIO', hint: 'Từ đơn làm thêm đã duyệt' },
  { code: 'OT_HOLIDAY_HOURS', name: 'Giờ làm thêm ngày lễ', unit: 'GIO', hint: 'Từ đơn làm thêm đã duyệt' },
  { code: 'TY_LE_KPI', name: 'Tỷ lệ KPI', unit: '%', hint: 'Kết quả phiếu KPI đã khoá của tháng' },
  { code: 'LATE_COUNT', name: 'Số lần đi muộn', unit: 'LAN', hint: 'Đo từ ca làm việc, trừ ngày có đơn đã duyệt' },
  { code: 'LATE_MINUTES', name: 'Số phút đi muộn', unit: 'PHUT', hint: 'Tổng số phút đi muộn trong tháng' },
  { code: 'LATE_AFTER_CUTOFF', name: 'Số lần đi muộn quá giờ giới hạn', unit: 'LAN', hint: 'Vào sau giờ giới hạn của ca' },
  { code: 'EARLY_COUNT', name: 'Số lần về sớm', unit: 'LAN', hint: 'Đo từ ca làm việc' },
  { code: 'EARLY_MINUTES', name: 'Số phút về sớm', unit: 'PHUT', hint: 'Tổng số phút về sớm trong tháng' },
  { code: TOTAL_EARNINGS_CODE, name: 'Tổng các khoản cộng', unit: 'VND', hint: 'Tổng mọi dòng "Cộng vào lương", gồm cả điều chỉnh tăng' },
  // Giữ cho công thức đã lưu trước đây.
  { code: 'KPI_PCT', name: 'Điểm KPI (dạng số)', unit: null, hint: '85 nghĩa là 85%', hidden: true },
  { code: 'ADJ_RECOVERY', name: 'Điều chỉnh tăng', unit: 'VND', hint: 'Tổng điều chỉnh tăng của kỳ', hidden: true },
  { code: 'ADJ_CLAWBACK', name: 'Điều chỉnh giảm', unit: 'VND', hint: 'Tổng điều chỉnh giảm của kỳ', hidden: true },
];

export const SYSTEM_VARIABLE_BY_CODE: ReadonlyMap<string, SystemVariable> = new Map(
  SYSTEM_VARIABLES.map((variable) => [variable.code, variable]),
);

/**
 * "Mức riêng" của chính dòng đang tính — chỉ còn để công thức khai trước đây
 * (kiểu `MUC_RIENG * KPI_PCT / 100`) chạy tiếp. Công thức mới tách mức riêng
 * thành một dòng "Khai theo từng người".
 */
export const OWN_AMOUNT_CODE = 'MUC_RIENG';
export const OWN_AMOUNT_NAME = 'Mức riêng';
export const OWN_AMOUNT_HINT = 'Giá trị khai cho chính dòng này — chung ở cơ chế hoặc riêng từng người';

/** Hàm dựng sẵn của bộ đánh giá công thức, kèm tên tiếng Việt cho ô công thức. */
export const BUILTIN_FUNCTIONS: ReadonlyArray<{ code: string; name: string; hint: string }> = [
  { code: 'MIN', name: 'Nhỏ nhất', hint: 'Nhỏ nhất(a, b) — lấy số nhỏ hơn, dùng làm trần' },
  { code: 'MAX', name: 'Lớn nhất', hint: 'Lớn nhất(a, b) — lấy số lớn hơn, dùng làm sàn' },
  { code: 'ROUND', name: 'Làm tròn', hint: 'Làm tròn(x, -3) — tới hàng nghìn' },
  { code: 'IF', name: 'Nếu', hint: 'Nếu(điều kiện, giá trị khi đúng, giá trị khi sai)' },
  { code: 'FLOOR', name: 'Làm tròn xuống', hint: 'Làm tròn xuống số nguyên' },
  { code: 'CEIL', name: 'Làm tròn lên', hint: 'Làm tròn lên số nguyên' },
  { code: 'ABS', name: 'Giá trị tuyệt đối', hint: 'Bỏ dấu âm' },
];

/**
 * Tên đã có nghĩa riêng — tham số hay đầu mục không được đặt trùng, nếu không
 * sẽ đè dữ liệu hệ thống. Bản database: `payroll_reserved_formula_names()`.
 */
export const RESERVED_FORMULA_NAMES: readonly string[] = [
  ...SYSTEM_VARIABLES.map((variable) => variable.code),
  OWN_AMOUNT_CODE,
  ...BUILTIN_FUNCTIONS.map((fn) => fn.code),
];

// ---------------------------------------------------------------------------
// Dòng của cơ chế lương
// ---------------------------------------------------------------------------

/** Cách một dòng của cơ chế lấy giá trị. */
export type RowMode = 'FORMULA' | 'VALUE' | 'PER_PERSON' | 'MONTHLY_INPUT';

export const ROW_MODE_LABEL: Record<RowMode, string> = {
  FORMULA: 'Công thức',
  VALUE: 'Giá trị',
  PER_PERSON: 'Khai riêng',
  MONTHLY_INPUT: 'Theo tháng',
};

export const ROW_MODE_HINT: Record<RowMode, string> = {
  FORMULA: 'Tính từ tham số, dữ liệu chấm công và các đầu mục khác — hoặc gõ thẳng một con số cố định',
  VALUE: 'Một con số chung; từng người khai riêng được',
  PER_PERSON: 'Khai riêng cho từng người ở trang Cơ chế lương — bắt buộc',
  MONTHLY_INPUT: 'Nhập theo tháng ngay trên Bảng lương',
};
