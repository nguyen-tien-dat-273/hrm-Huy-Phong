// ============================================================================
// Công thức của MỘT khoản lương, khai bằng vài ô chọn.
// ----------------------------------------------------------------------------
// Mọi khoản lương đều là cùng một hình dạng:
//
//     (một con số)  ×  (nhân với gì)
//
// Con số lấy từ ô nhập tay, hoặc từ một khoản khác trong danh mục.
// "Nhân với gì" có thể là KHÔNG NHÂN — và đó chính là khoản cố định, không
// cần một loại riêng. Còn lại là ngày công, giờ công, KPI, số chuyến, sản
// lượng... tức những con số thay đổi theo tháng.
//
// Số liệu tháng KHÔNG phải khai thêm ở đâu cả: `MonthlyInputsTab` quét công
// thức của mọi khoản đã gán, thấy một biến lạ là tự dựng cột nhập liệu cho nó
// ở màn "Số liệu lương tháng". Nên chọn `SO_CHUYEN` ở đây là tháng sau quản lý
// đã có ô để điền.
//
// Tách khỏi component React CÓ CHỦ ĐÍCH: đây là logic ra tiền, phải kiểm
// chứng được bằng `npm run check:flows` mà không phải dựng cây React lên.
//
// `parse` là chiều ngược của `build`: mở lại một cơ chế đã khai thì các ô chọn
// phải hiện đúng cái đã lưu. Công thức nào không khớp hình dạng trên — do
// người dùng tự viết tay — thì trả null, và màn hình rơi về ô công thức tự do
// thay vì bịa ra một cách khai gần đúng rồi ghi đè mất công thức thật.
// ============================================================================

/** Đơn giá lấy từ đâu. */
export type PayItemSource =
  /** Con số khai riêng cho người này, vào biến `MUC_RIENG`. */
  | { kind: 'FIXED' }
  /** Một khoản khác trong danh mục, gọi theo mã của nó. */
  | { kind: 'COMPONENT'; code: string };

export interface GuidedPayFormula {
  source: PayItemSource;
  /**
   * Biến nhân vào đơn giá. `null` = khoản CỐ ĐỊNH, trả nguyên đơn giá.
   *
   * Có thể là biến hệ thống (`PAID_DAYS`, `WORK_HOURS`...) hoặc một mã số liệu
   * tháng do công ty tự đặt (`SO_CHUYEN`, `SAN_LUONG`...).
   */
  variable: string | null;
  /**
   * Chia đơn giá cho ngày công chuẩn trước khi nhân.
   *
   * Dùng khi đơn giá khai theo THÁNG mà trả theo ngày thực đi: lương tháng
   * 15 triệu, đi 22/24,5 công thì nhận 15tr ÷ 24,5 × 22.
   */
  prorate: boolean;
}

/** Biến hệ thống dùng được làm số nhân, kèm tên tiếng Việt. */
export const SYSTEM_VARIABLES: ReadonlyArray<{ code: string; label: string }> = [
  { code: 'PAID_DAYS', label: 'Ngày hưởng lương (đi làm + phép + lễ)' },
  { code: 'KPI_PCT', label: 'KPI đạt được (%)' },
  { code: 'WORK_DAYS', label: 'Ngày đi làm thực tế' },
  { code: 'WORK_HOURS', label: 'Giờ làm thực tế' },
  { code: 'LEAVE_DAYS', label: 'Ngày nghỉ phép' },
  { code: 'HOLIDAY_DAYS', label: 'Ngày nghỉ lễ' },
];

const SYSTEM_CODES = new Set(SYSTEM_VARIABLES.map((item) => item.code));

export const DEFAULT_GUIDED: GuidedPayFormula = {
  source: { kind: 'FIXED' },
  variable: null,
  prorate: false,
};

function sourceCode(source: PayItemSource): string {
  return source.kind === 'FIXED' ? 'MUC_RIENG' : source.code;
}

export function buildPayFormula(guided: GuidedPayFormula): string {
  const base = sourceCode(guided.source);
  if (!guided.variable) return base;
  // Ngoặc quanh phép chia để đọc ra ngay là "đơn giá ngày × số liệu"; không có
  // ngoặc thì vẫn đúng thứ tự nhưng khó soát bằng mắt.
  const unit = guided.prorate ? `(${base} / STANDARD_DAYS)` : base;
  return `${unit} * ${guided.variable}`;
}

const NAME = '([A-Z][A-Z0-9_]*)';

/**
 * Đọc ngược một công thức về các ô chọn. Trả null nếu nó không đúng hình dạng
 * mà màn hình này sinh ra — khi đó phải giữ nguyên công thức tự do.
 *
 * `knownCodes` là mã các khoản trong danh mục. Chỉ nhận đơn giá là MUC_RIENG
 * hoặc một mã CÓ THẬT: nhận bừa mọi chữ hoa sẽ biến `GROSS * PAID_DAYS` thành
 * "khoản tên GROSS", rồi lưu lại là hỏng.
 */
export function parsePayFormula(
  formula: string | null | undefined,
  knownCodes: readonly string[] = [],
): GuidedPayFormula | null {
  const text = (formula ?? '').trim();
  if (!text) return null;

  const asSource = (name: string): PayItemSource | null => {
    if (name === 'MUC_RIENG') return { kind: 'FIXED' };
    return knownCodes.includes(name) ? { kind: 'COMPONENT', code: name } : null;
  };

  /** Số nhân nhận biến hệ thống hoặc mã số liệu tháng, nhưng KHÔNG nhận tên
   *  một khoản khác — `A * B` giữa hai khoản không phải hình dạng này. */
  const asVariable = (name: string): string | null => {
    if (SYSTEM_CODES.has(name)) return name;
    if (knownCodes.includes(name) || name === 'MUC_RIENG' || name === 'STANDARD_DAYS') return null;
    return name;
  };

  const patterns: Array<[RegExp, boolean]> = [
    [new RegExp(`^\\(\\s*${NAME}\\s*/\\s*STANDARD_DAYS\\s*\\)\\s*\\*\\s*${NAME}$`), true],
    [new RegExp(`^${NAME}\\s*/\\s*STANDARD_DAYS\\s*\\*\\s*${NAME}$`), true],
    [new RegExp(`^${NAME}\\s*\\*\\s*${NAME}$`), false],
  ];

  for (const [pattern, prorate] of patterns) {
    const match = pattern.exec(text);
    if (!match) continue;
    const source = asSource(match[1]);
    const variable = asVariable(match[2]);
    if (!source || !variable) return null;
    return { source, variable, prorate };
  }

  const plain = new RegExp(`^${NAME}$`).exec(text);
  if (plain) {
    const source = asSource(plain[1]);
    return source ? { source, variable: null, prorate: false } : null;
  }

  return null;
}

/** Câu tiếng Việt mô tả cách tính, đặt cạnh công thức sinh ra. */
export function describePayFormula(
  guided: GuidedPayFormula,
  names: { source?: string; variable?: string } = {},
): string {
  const unit = guided.source.kind === 'FIXED'
    ? 'mức khai riêng cho người này'
    : `khoản ${names.source || guided.source.code}`;

  if (!guided.variable) return `Trả đúng ${unit} mỗi tháng, không phụ thuộc gì.`;

  const by = names.variable || guided.variable;
  return guided.prorate
    ? `Lấy ${unit} làm mức THÁNG, chia ngày công chuẩn rồi nhân ${by}.`
    : `Lấy ${unit} làm ĐƠN GIÁ, nhân với ${by}.`;
}
