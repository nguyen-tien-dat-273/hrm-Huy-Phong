// ============================================================================
// Công thức của MỘT khoản lương, khai bằng vài ô chọn.
// ----------------------------------------------------------------------------
// Mọi khoản lương của Huy Phong đều viết được theo một hình dạng:
//
//     [ vế tiền ]  ×  [ số liệu ]  ×  [ hệ số ]   ( ÷ 100 nếu khai theo % )
//
// Vế tiền: số khai riêng cho người này (`MUC_RIENG`), hoặc một khoản khác
// trong danh mục, hoặc một mức hệ thống (`HOURLY_RATE`, `BASE_WORK`...), hoặc
// TỔNG của mấy khoản cộng lại. Có thể KHÔNG có vế tiền — khi cả khoản chính là
// con số quản lý nhập thẳng (`THUONG`, `PHAT`).
//
// Số liệu và hệ số đều có thể bỏ trống. Bỏ cả hai thì khoản đó là khoản CỐ
// ĐỊNH, không cần một loại riêng cho nó.
//
// Số liệu tháng KHÔNG phải khai thêm ở đâu cả: `MonthlyInputsTab` quét công
// thức của mọi khoản đã gán, thấy một biến lạ là tự dựng cột nhập liệu cho nó
// ở màn "Số liệu lương tháng". Nên chọn `SO_CHUYEN` ở đây là tháng sau quản lý
// đã có ô để điền.
//
// ---------------------------------------------------------------------------
// VÌ SAO HÌNH DẠNG NÀY RỘNG ĐẾN THẾ
//
// Bản đầu chỉ nhận `tiền × số liệu`. Đem 14 công thức công ty đang dùng chạy
// qua thì CHỈ 2 cái đọc được — 12 cái còn lại rơi về ô viết tay, tức là cái
// "khai bằng ô chọn" trên thực tế không dùng được. Thiếu đúng bốn thứ: thứ tự
// hai vế đảo được, hệ số (`× 2` của làm thêm giờ), chia 100 (khai theo %), và
// tổng nhiều khoản (phí công đoàn tính trên ba khoản cộng lại).
//
// Nên bốn thứ đó nằm trong mô hình này. `parsePayFormula` đọc lại được cả 14,
// và `npm run check:flows` kiểm rằng đọc-rồi-dựng-lại cho ra ĐÚNG CÙNG MỘT SỐ
// TIỀN như công thức gốc — vì đây là tiền lương, sai một chỗ là trả sai người.
//
// Tách khỏi component React CÓ CHỦ ĐÍCH: đây là logic ra tiền, phải kiểm
// chứng được mà không phải dựng cây React lên.
// ============================================================================

/** Vế tiền lấy từ đâu. */
export type PayItemSource =
  /** Con số khai riêng cho người này, vào biến `MUC_RIENG`. */
  | { kind: 'FIXED' }
  /** Một mã: khoản khác trong danh mục, mức hệ thống, hoặc số liệu tháng. */
  | { kind: 'CODE'; code: string }
  /** Tổng mấy mã cộng lại, ví dụ phí công đoàn tính trên ba khoản. */
  | { kind: 'SUM'; codes: readonly string[] }
  /** Không có vế tiền — cả khoản là con số quản lý nhập thẳng. */
  | { kind: 'NONE' };

export interface GuidedPayFormula {
  source: PayItemSource;
  /**
   * Số liệu nhân vào vế tiền. `null` = không nhân.
   *
   * Có thể là biến hệ thống (`PAID_DAYS`, `WORK_HOURS`...) hoặc một mã số liệu
   * tháng do công ty tự đặt (`SO_CHUYEN`, `DOANH_SO`...).
   */
  variable: string | null;
  /**
   * Hệ số nhân thêm, GIỮ NGUYÊN DẠNG CHUỖI.
   *
   * Là chuỗi chứ không phải số để `0.01` không bị dựng lại thành `0.010000...`,
   * và để ô nhập còn giữ được trạng thái đang gõ dở (`'0.'`). `null` = không
   * nhân hệ số.
   */
  coefficient: string | null;
  /** Chia 100 ở cuối — dùng khi vế tiền hoặc số liệu khai theo phần trăm. */
  percent: boolean;
  /**
   * Chia vế tiền cho ngày công chuẩn trước khi nhân.
   *
   * Dùng khi số tiền khai theo THÁNG mà trả theo ngày thực đi: lương tháng
   * 15 triệu, đi 22/24,5 công thì nhận 15tr ÷ 24,5 × 22.
   */
  prorate: boolean;
}

/**
 * Mã hệ thống mang nghĩa SỐ TIỀN — dùng được làm vế tiền.
 *
 * Engine cấp sẵn (xem `scope` trong `lib/payroll.ts`). Khác với nhóm dưới ở
 * chỗ nhân chúng với ngày công là ra tiền, còn nhân hai mức tiền với nhau thì
 * vô nghĩa — nên màn hình không cho chọn một mức tiền làm số liệu.
 */
export const MONEY_RATES: ReadonlyArray<{ code: string; label: string }> = [
  { code: 'HOURLY_RATE', label: 'Tiền một giờ' },
  { code: 'DAILY_RATE', label: 'Tiền một ngày' },
  { code: 'MONTHLY_RATE', label: 'Lương tháng ở hồ sơ' },
  { code: 'BASE_WORK', label: 'Lương thời gian (ngày đi làm)' },
  { code: 'BASE_LEAVE', label: 'Lương ngày phép' },
  { code: 'BASE_HOLIDAY', label: 'Lương ngày lễ' },
  { code: 'BASE', label: 'Lương gốc (thời gian + phép + lễ)' },
  { code: 'GROSS', label: 'Tổng thu nhập tính tới khoản này' },
  { code: 'INSURANCE_BASE', label: 'Lương đóng bảo hiểm' },
];

/**
 * Số liệu hệ thống dùng được làm số nhân.
 *
 * `days` đánh dấu biến ĐẾM NGÀY CÔNG. Chỉ những biến đó mới có nghĩa khi chia
 * cho ngày công chuẩn — chia rồi nhân số chuyến hay nhân KPI% là vô nghĩa, nên
 * màn hình giấu lựa chọn đó đi với các biến còn lại.
 */
export const SYSTEM_VARIABLES: ReadonlyArray<{ code: string; label: string; days?: boolean }> = [
  { code: 'PAID_DAYS', label: 'Ngày hưởng lương (đi làm + phép + lễ)', days: true },
  { code: 'WORK_DAYS', label: 'Ngày đi làm thực tế', days: true },
  { code: 'LEAVE_DAYS', label: 'Ngày nghỉ phép', days: true },
  { code: 'HOLIDAY_DAYS', label: 'Ngày nghỉ lễ', days: true },
  { code: 'WORK_HOURS', label: 'Giờ làm thực tế' },
  { code: 'KPI_PCT', label: 'KPI đạt được (%)' },
  { code: 'DEPENDENTS', label: 'Số người phụ thuộc' },
  // Chuyên cần — engine đo từ ca làm việc. Bằng 0 khi chưa khai ca, nên công
  // thức phạt ra 0 thay vì phạt oan. Lưu ý Điều 127 BLLĐ 2019 cấm phạt tiền
  // thay cho xử lý kỷ luật.
  { code: 'LATE_MINUTES', label: 'Số phút đi muộn' },
  { code: 'LATE_COUNT', label: 'Số lần đi muộn' },
  { code: 'LATE_AFTER_CUTOFF', label: 'Số lần muộn quá ngưỡng' },
  { code: 'EARLY_MINUTES', label: 'Số phút về sớm' },
  { code: 'EARLY_COUNT', label: 'Số lần về sớm' },
];

/** Số liệu này có phải là số đếm ngày công không. */
export function isDayCount(code: string | null): boolean {
  return !!code && SYSTEM_VARIABLES.some((item) => item.code === code && item.days);
}

const MONEY_CODES = new Set(MONEY_RATES.map((item) => item.code));
const VARIABLE_CODES = new Set(SYSTEM_VARIABLES.map((item) => item.code));

/**
 * Số liệu tháng do ENGINE tự bơm vào, không khai ở `input_code` của khoản nào.
 *
 * `KPI_TARGET` do trigger `kpi_payroll_bridge` ghi vào `payroll_inputs` khi kỳ
 * KPI được khoá. Không có danh sách này thì công thức `LUONG_KPI` của chính
 * công ty bị coi là mã gõ sai và rơi về ô tự do.
 */
const ENGINE_INPUTS = new Set(['KPI_TARGET']);

export const DEFAULT_GUIDED: GuidedPayFormula = {
  source: { kind: 'FIXED' },
  variable: null,
  coefficient: null,
  percent: false,
  prorate: false,
};

/** Vế tiền, viết thành chuỗi. Rỗng khi khoản không có vế tiền. */
function sourceText(source: PayItemSource): string {
  switch (source.kind) {
    case 'FIXED': return 'MUC_RIENG';
    case 'CODE': return source.code;
    case 'NONE': return '';
    case 'SUM': {
      const codes = source.codes.filter((code) => !!code);
      if (codes.length === 0) return '';
      // Một mã thì không cần ngoặc; `(A) * B` đúng nhưng đọc như sai.
      if (codes.length === 1) return codes[0];
      return `(${codes.join(' + ')})`;
    }
  }
}

export function buildPayFormula(guided: GuidedPayFormula): string {
  let base = sourceText(guided.source);
  // Ngoặc quanh phép chia để đọc ra ngay là "tiền một ngày × số liệu"; không
  // có ngoặc thì vẫn đúng thứ tự nhưng khó soát bằng mắt.
  if (base && guided.prorate) base = `(${base} / STANDARD_DAYS)`;

  const factors = [base, guided.variable ?? '', guided.coefficient ?? '']
    .filter((part) => part !== '');
  if (factors.length === 0) return '';

  const product = factors.join(' * ');
  return guided.percent ? `${product} / 100` : product;
}

const NAME = /^[A-Z][A-Z0-9_]*$/;
const NUMBER = /^\d+(?:\.\d+)?$/;
const SUM_GROUP = /^\(\s*([A-Z][A-Z0-9_]*(?:\s*\+\s*[A-Z][A-Z0-9_]*)+)\s*\)$/;
// Vế trong có thể là một mã, HOẶC một tổng đã có ngoặc riêng — phí công đoàn
// chia công chuẩn sẽ ra `((A + B) / STANDARD_DAYS)`. Bắt cứng một mã thì dạng
// đó dựng ra được mà đọc lại không được, tức là mở lên rồi lưu là mất.
const PRORATE_GROUP = /^\(\s*(.+?)\s*\/\s*STANDARD_DAYS\s*\)$/;
const PRORATE_HEAD = /^([A-Z][A-Z0-9_]*)\s*\/\s*STANDARD_DAYS\b/;

/**
 * Tách biểu thức theo dấu `*` ở NGOÀI mọi cặp ngoặc.
 *
 * Trả null khi gặp phép toán không thuộc hình dạng này ở ngoài ngoặc — `+`,
 * `-`, hay một `/` còn sót sau khi đã bóc `/ 100` và `/ STANDARD_DAYS`. Thà
 * trả null để rơi về ô tự do, còn hơn đọc hiểu một nửa rồi ghi đè.
 */
function splitFactors(text: string): string[] | null {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '(') depth += 1;
    else if (char === ')') {
      depth -= 1;
      if (depth < 0) return null;
    } else if (depth === 0 && char === '*') {
      parts.push(text.slice(start, index));
      start = index + 1;
    } else if (depth === 0 && (char === '+' || char === '-' || char === '/')) {
      return null;
    }
  }
  if (depth !== 0) return null;
  parts.push(text.slice(start));
  const trimmed = parts.map((part) => part.trim());
  return trimmed.some((part) => part === '') ? null : trimmed;
}

/** Bỏ số 0 thừa sau dấu thập phân: 4.00 → 4, 0.010 → 0.01. */
function tidyNumber(value: number): string {
  return String(Number(value.toFixed(10)));
}

/**
 * Đọc ngược một công thức về các ô chọn. Trả null nếu nó không đúng hình dạng
 * mà màn hình này sinh ra — khi đó phải giữ nguyên công thức tự do.
 *
 * `knownCodes` là mã các khoản trong danh mục; `knownInputs` là mã số liệu
 * tháng đã khai ở `input_code` của khoản nào đó. Mã KHÔNG thuộc hai danh sách
 * đó (lẫn danh sách hệ thống) bị coi là gõ sai và trả null — thà hiện ô tự do
 * còn hơn dựng một cách khai trỏ vào biến luôn bằng 0 rồi trả thiếu lương.
 */
export function parsePayFormula(
  formula: string | null | undefined,
  knownCodes: readonly string[] = [],
  knownInputs: readonly string[] = [],
): GuidedPayFormula | null {
  let text = (formula ?? '').trim();
  if (!text) return null;

  // Bóc `/ 100` ở cuối TRƯỚC khi tách, vì sau đó mọi `/` còn lại ở ngoài ngoặc
  // đều là hình dạng lạ.
  let percent = false;
  const tail = /\s*\/\s*100$/.exec(text);
  if (tail) {
    percent = true;
    text = text.slice(0, tail.index).trim();
  }

  // Dạng không ngoặc `A / STANDARD_DAYS * B` do bản cũ sinh ra: đưa về dạng có
  // ngoặc để chỉ còn một đường đọc.
  text = text.replace(PRORATE_HEAD, '($1 / STANDARD_DAYS)');

  const factors = splitFactors(text);
  if (!factors) return null;

  /** Mã này có mang nghĩa số tiền không — tức dùng được làm vế tiền. */
  const isMoney = (code: string) =>
    code === 'MUC_RIENG' || MONEY_CODES.has(code) || knownCodes.includes(code);
  /** Mã này là số liệu đếm được — tức dùng được làm số nhân. */
  const isQuantity = (code: string) =>
    VARIABLE_CODES.has(code) || ENGINE_INPUTS.has(code) || knownInputs.includes(code);

  const asSource = (code: string): PayItemSource | null => {
    if (code === 'MUC_RIENG') return { kind: 'FIXED' };
    // Biến hệ thống mang nghĩa SỐ LƯỢNG không làm được vế tiền: `PAID_DAYS *
    // SO_CHUYEN` là ngày nhân chuyến, không ra đồng nào.
    if (VARIABLE_CODES.has(code)) return null;
    // Số liệu tháng VẪN làm được vế tiền (`KPI_TARGET`, `THUONG`): engine
    // không biết mã nào là tiền mã nào là số lượng, và công ty dùng cả hai
    // kiểu. Nhưng phải là mã CÓ THẬT.
    if (!isMoney(code) && !ENGINE_INPUTS.has(code) && !knownInputs.includes(code)) return null;
    return { kind: 'CODE', code };
  };

  let source: PayItemSource | null = null;
  let prorate = false;
  const names: string[] = [];
  const numbers: string[] = [];

  for (const factor of factors) {
    if (NUMBER.test(factor)) {
      numbers.push(factor);
      continue;
    }
    const sum = SUM_GROUP.exec(factor);
    if (sum) {
      if (source) return null;
      const codes = sum[1].split('+').map((code) => code.trim());
      // Cộng thì mọi vế phải là TIỀN. `(BASE_WORK + PAID_DAYS)` cộng đồng với
      // ngày — engine vẫn ra một con số, nên không chặn ở đây là không ai chặn.
      if (!codes.every(isMoney)) return null;
      source = { kind: 'SUM', codes };
      continue;
    }
    const pro = PRORATE_GROUP.exec(factor);
    if (pro) {
      if (source) return null;
      const inner = pro[1].trim();
      const innerSum = SUM_GROUP.exec(inner);
      if (innerSum) {
        const codes = innerSum[1].split('+').map((code) => code.trim());
        if (!codes.every(isMoney)) return null;
        source = { kind: 'SUM', codes };
      } else if (NAME.test(inner)) {
        source = asSource(inner);
        if (!source) return null;
      } else {
        return null;
      }
      prorate = true;
      continue;
    }
    if (NAME.test(factor)) {
      names.push(factor);
      continue;
    }
    // Ngoặc lạ, lời gọi hàm `MIN(...)`, số âm... — không đọc hiểu.
    return null;
  }

  if (!source) {
    // Thứ tự hai vế đảo được: công ty viết cả `MUC_RIENG * SO_CHUYEN` lẫn
    // `SO_CHUYEN * MUC_RIENG`. Chọn vế tiền theo NGHĨA của mã, không theo chỗ
    // đứng — mã mang nghĩa tiền thắng.
    const moneyAt = names.findIndex(isMoney);
    if (moneyAt >= 0) {
      source = asSource(names[moneyAt]);
      if (!source) return null;
      names.splice(moneyAt, 1);
    } else if (names.length >= 2) {
      // Hai mã số liệu tháng nhân nhau (`KPI_TARGET * KPI_PCT`): mã đứng
      // trước là vế tiền. Không có cách nào biết chắc hơn, và dựng lại vẫn ra
      // đúng chuỗi cũ nên không làm đổi tiền của ai.
      source = asSource(names[0]);
      if (!source) return null;
      names.splice(0, 1);
    } else {
      // Chỉ còn một mã và nó không mang nghĩa tiền: cả khoản là con số quản
      // lý nhập thẳng (`THUONG`, `PHAT`).
      source = { kind: 'NONE' };
    }
  }

  if (names.length > 1) return null;
  const variable = names[0] ?? null;
  // Số nhân phải là số liệu ĐẾM ĐƯỢC. Hai vế tiền nhân nhau (`LUONG_CB *
  // PC_XANG`, `HOURLY_RATE * DAILY_RATE`) không phải công thức lương nào cả,
  // và một mã lạ ở đây nghĩa là gõ sai.
  if (variable && (isMoney(variable) || !isQuantity(variable))) return null;

  let coefficient: string | null = null;
  if (numbers.length === 1) {
    coefficient = numbers[0];
  } else if (numbers.length > 1) {
    // `HOURLY_RATE * OT_NGAY_LE * 2 * 2` — hai hệ số gộp thành một. Tiền
    // không đổi; phần diễn giải "2 giờ, hệ số 2" nằm ở ghi chú của khoản.
    coefficient = tidyNumber(numbers.reduce((acc, item) => acc * Number(item), 1));
  }

  if (source.kind === 'NONE' && !variable && !coefficient) return null;
  return { source, variable, coefficient, percent, prorate };
}
