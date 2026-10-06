// ============================================================================
// Công thức của MỘT khoản lương, khai bằng vài ô chọn thay vì gõ biểu thức.
// ----------------------------------------------------------------------------
// Gần như mọi khoản trong bảng lương thật đều có cùng một hình dạng:
//
//     (một mức tiền)  ×  (số công)
//
// Mức tiền lấy từ một con số cố định khai cho người đó, hoặc từ một khoản khác
// đã có trong danh mục. Số công thì hoặc không nhân (trả nguyên mức cả tháng),
// hoặc nhân thẳng (mức là đơn giá NGÀY), hoặc chia công chuẩn rồi nhân công
// thực tế (mức là lương THÁNG, trả theo ngày đi làm).
//
// Tách khỏi component React CÓ CHỦ ĐÍCH: đây là logic ra tiền, phải kiểm
// chứng được bằng `npm run check:flows` mà không phải dựng cây React lên.
//
// `parse` là chiều ngược của `build`: mở lại một cơ chế đã khai thì các ô chọn
// phải hiện đúng cái đã lưu. Công thức nào không khớp hình dạng trên — do
// người dùng tự viết tay — thì trả null, và màn hình rơi về ô công thức tự do
// thay vì bịa ra một cách khai gần đúng rồi ghi đè mất công thức thật.
// ============================================================================

/** Mức tiền lấy từ đâu. */
export type PayItemSource =
  /** Con số khai riêng cho người này, vào biến `MUC_RIENG`. */
  | { kind: 'FIXED' }
  /** Một khoản khác trong danh mục, gọi theo mã của nó. */
  | { kind: 'COMPONENT'; code: string };

/** Nhân với số công kiểu gì. */
export type PayItemScale =
  /** Trả nguyên mức, không phụ thuộc ngày công. */
  | 'NONE'
  /** Mức là đơn giá MỘT NGÀY, nhân thẳng số công. */
  | 'PER_DAY'
  /** Mức là lương MỘT THÁNG, chia công chuẩn rồi nhân công thực tế. */
  | 'PRORATE';

/** Đếm công theo cột nào. */
export type PayItemDays = 'PAID_DAYS' | 'WORK_DAYS';

export interface GuidedPayFormula {
  source: PayItemSource;
  scale: PayItemScale;
  days: PayItemDays;
}

export const SCALE_LABEL: Record<PayItemScale, string> = {
  NONE: 'Trả nguyên mức, không nhân số công',
  PER_DAY: 'Mức là đơn giá một ngày — nhân với số công',
  PRORATE: 'Mức là lương một tháng — chia công chuẩn, nhân công thực tế',
};

export const DAYS_LABEL: Record<PayItemDays, string> = {
  PAID_DAYS: 'Ngày hưởng lương (đi làm + phép + lễ)',
  WORK_DAYS: 'Ngày đi làm thực tế',
};

export const DEFAULT_GUIDED: GuidedPayFormula = {
  source: { kind: 'FIXED' },
  scale: 'PER_DAY',
  days: 'PAID_DAYS',
};

/** Vế trái: tên biến mang mức tiền. */
function sourceCode(source: PayItemSource): string {
  return source.kind === 'FIXED' ? 'MUC_RIENG' : source.code;
}

export function buildPayFormula(guided: GuidedPayFormula): string {
  const base = sourceCode(guided.source);
  switch (guided.scale) {
    case 'NONE':
      return base;
    case 'PER_DAY':
      return `${base} * ${guided.days}`;
    case 'PRORATE':
      // Ngoặc quanh phép chia để đọc ra ngay là "đơn giá ngày × số công";
      // không có ngoặc thì vẫn đúng thứ tự nhưng khó soát bằng mắt.
      return `(${base} / STANDARD_DAYS) * ${guided.days}`;
    default:
      return base;
  }
}

const DAYS_RE = '(PAID_DAYS|WORK_DAYS)';
const NAME_RE = '([A-Z][A-Z0-9_]*)';

/**
 * Đọc ngược một công thức về các ô chọn. Trả null nếu nó không đúng hình dạng
 * mà màn hình này sinh ra — khi đó phải giữ nguyên công thức tự do.
 */
export function parsePayFormula(
  formula: string | null | undefined,
  knownCodes: readonly string[] = [],
): GuidedPayFormula | null {
  const text = (formula ?? '').trim();
  if (!text) return null;

  const asSource = (name: string): PayItemSource | null => {
    if (name === 'MUC_RIENG') return { kind: 'FIXED' };
    // Chỉ nhận mã có thật trong danh mục. Nhận bừa mọi chữ hoa sẽ biến
    // `GROSS * PAID_DAYS` thành "khoản tên GROSS", rồi lưu lại là hỏng.
    return knownCodes.includes(name) ? { kind: 'COMPONENT', code: name } : null;
  };

  let match = new RegExp(`^\\(\\s*${NAME_RE}\\s*/\\s*STANDARD_DAYS\\s*\\)\\s*\\*\\s*${DAYS_RE}$`).exec(text);
  if (match) {
    const source = asSource(match[1]);
    return source ? { source, scale: 'PRORATE', days: match[2] as PayItemDays } : null;
  }

  match = new RegExp(`^${NAME_RE}\\s*/\\s*STANDARD_DAYS\\s*\\*\\s*${DAYS_RE}$`).exec(text);
  if (match) {
    const source = asSource(match[1]);
    return source ? { source, scale: 'PRORATE', days: match[2] as PayItemDays } : null;
  }

  match = new RegExp(`^${NAME_RE}\\s*\\*\\s*${DAYS_RE}$`).exec(text);
  if (match) {
    const source = asSource(match[1]);
    return source ? { source, scale: 'PER_DAY', days: match[2] as PayItemDays } : null;
  }

  match = new RegExp(`^${NAME_RE}$`).exec(text);
  if (match) {
    const source = asSource(match[1]);
    return source ? { source, scale: 'NONE', days: 'PAID_DAYS' } : null;
  }

  return null;
}

/** Câu tiếng Việt mô tả cách tính, đặt cạnh công thức sinh ra. */
export function describePayFormula(
  guided: GuidedPayFormula,
  componentName?: string,
): string {
  const what = guided.source.kind === 'FIXED'
    ? 'mức khai riêng cho người này'
    : `khoản ${componentName || guided.source.code}`;
  switch (guided.scale) {
    case 'NONE':
      return `Trả đúng ${what}, không phụ thuộc ngày công.`;
    case 'PER_DAY':
      return `Lấy ${what} làm đơn giá một ngày, nhân với ${DAYS_LABEL[guided.days].toLowerCase()}.`;
    case 'PRORATE':
      return `Lấy ${what} làm lương tháng, chia ngày công chuẩn rồi nhân ${DAYS_LABEL[guided.days].toLowerCase()}.`;
    default:
      return '';
  }
}
