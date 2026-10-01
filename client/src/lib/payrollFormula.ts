// ============================================================================
// Bộ đánh giá biểu thức cho công thức lương.
// ----------------------------------------------------------------------------
// HR tự viết cách tính từng khoản, ví dụ:
//
//   HOURLY_RATE * 1.5 * OT_WEEKDAY_HOURS
//   MAX(BASE * 0.1, 1000000)
//   IF(REVENUE > 500000000, REVENUE * 0.05, REVENUE * 0.03)
//
// KHÔNG dùng `eval` hay `new Function`. Công thức đến từ database, mà database
// lại do người dùng ghi vào — đưa thẳng vào `eval` là mở cửa cho bất kỳ ai sửa
// được bảng `payroll_components` chạy JavaScript tùy ý trong phiên của kế toán
// đang xem bảng lương. Ở đây là parser tự viết: chỉ hiểu số, biến, bốn phép
// tính, so sánh và một nhúm hàm cho sẵn. Không có cách nào chạm tới `window`,
// `fetch` hay prototype chain.
// ============================================================================

/** Hàm dựng sẵn — tên viết hoa để khỏi lẫn với mã khoản lương. */
const FUNCTIONS: Record<string, { arity: number | 'variadic'; fn: (...args: number[]) => number }> = {
  MIN: { arity: 'variadic', fn: (...a) => Math.min(...a) },
  MAX: { arity: 'variadic', fn: (...a) => Math.max(...a) },
  ROUND: { arity: 1, fn: (a) => Math.round(a) },
  FLOOR: { arity: 1, fn: (a) => Math.floor(a) },
  CEIL: { arity: 1, fn: (a) => Math.ceil(a) },
  ABS: { arity: 1, fn: (a) => Math.abs(a) },
  // Điều kiện: IF(điều_kiện, giá_trị_đúng, giá_trị_sai).
  IF: { arity: 3, fn: (cond, a, b) => (cond !== 0 ? a : b) },
};

type TokenType = 'number' | 'ident' | 'op' | 'paren' | 'comma';

interface Token {
  type: TokenType;
  value: string;
  /** Vị trí trong chuỗi gốc — để báo lỗi chỉ đúng chỗ sai. */
  at: number;
}

export class FormulaError extends Error {
  constructor(message: string, readonly at?: number) {
    super(message);
    this.name = 'FormulaError';
  }
}

/** Toán tử nhiều ký tự phải thử trước toán tử một ký tự. */
const MULTI_CHAR_OPS = ['<=', '>=', '==', '!=', '&&', '||'];
const SINGLE_CHAR_OPS = ['+', '-', '*', '/', '%', '<', '>', '?', ':', '!'];

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < source.length) {
    const ch = source[i];

    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }

    if (/[0-9.]/.test(ch)) {
      const start = i;
      while (i < source.length && /[0-9._]/.test(source[i])) i += 1;
      // Dấu gạch dưới cho phép viết 1_000_000 cho dễ đọc.
      const raw = source.slice(start, i).replace(/_/g, '');
      const value = Number(raw);
      if (!Number.isFinite(value)) {
        throw new FormulaError(`Số không hợp lệ: "${raw}"`, start);
      }
      tokens.push({ type: 'number', value: String(value), at: start });
      continue;
    }

    if (/[A-Za-z_]/.test(ch)) {
      const start = i;
      while (i < source.length && /[A-Za-z0-9_]/.test(source[i])) i += 1;
      tokens.push({ type: 'ident', value: source.slice(start, i), at: start });
      continue;
    }

    if (ch === '(' || ch === ')') {
      tokens.push({ type: 'paren', value: ch, at: i });
      i += 1;
      continue;
    }

    if (ch === ',') {
      tokens.push({ type: 'comma', value: ch, at: i });
      i += 1;
      continue;
    }

    const twoChar = source.slice(i, i + 2);
    if (MULTI_CHAR_OPS.includes(twoChar)) {
      tokens.push({ type: 'op', value: twoChar, at: i });
      i += 2;
      continue;
    }

    if (SINGLE_CHAR_OPS.includes(ch)) {
      tokens.push({ type: 'op', value: ch, at: i });
      i += 1;
      continue;
    }

    throw new FormulaError(`Ký tự không dùng được trong công thức: "${ch}"`, i);
  }

  return tokens;
}

/**
 * Parser đệ quy xuống, thứ tự ưu tiên từ lỏng tới chặt:
 * ternary → hoặc → và → so sánh → cộng trừ → nhân chia → dấu đơn → hạng tử.
 */
class Parser {
  private pos = 0;

  constructor(
    private readonly tokens: Token[],
    private readonly scope: Readonly<Record<string, number>>,
    /** Tên biến đã gặp — dùng để báo "công thức này cần những gì". */
    private readonly seen: Set<string>,
  ) {}

  parse(): number {
    const value = this.ternary();
    if (this.pos < this.tokens.length) {
      const token = this.tokens[this.pos];
      throw new FormulaError(`Thừa "${token.value}" ở cuối công thức.`, token.at);
    }
    return value;
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private eatOp(...values: string[]): string | null {
    const token = this.peek();
    if (token && token.type === 'op' && values.includes(token.value)) {
      this.pos += 1;
      return token.value;
    }
    return null;
  }

  private ternary(): number {
    const condition = this.or();
    if (!this.eatOp('?')) return condition;

    const whenTrue = this.ternary();
    if (!this.eatOp(':')) {
      throw new FormulaError('Thiếu ":" cho biểu thức điều kiện "? :".', this.peek()?.at);
    }
    const whenFalse = this.ternary();
    return condition !== 0 ? whenTrue : whenFalse;
  }

  private or(): number {
    let left = this.and();
    while (this.eatOp('||')) {
      const right = this.and();
      left = left !== 0 || right !== 0 ? 1 : 0;
    }
    return left;
  }

  private and(): number {
    let left = this.comparison();
    while (this.eatOp('&&')) {
      const right = this.comparison();
      left = left !== 0 && right !== 0 ? 1 : 0;
    }
    return left;
  }

  private comparison(): number {
    let left = this.additive();
    for (;;) {
      const op = this.eatOp('<', '<=', '>', '>=', '==', '!=');
      if (!op) return left;
      const right = this.additive();
      switch (op) {
        case '<': left = left < right ? 1 : 0; break;
        case '<=': left = left <= right ? 1 : 0; break;
        case '>': left = left > right ? 1 : 0; break;
        case '>=': left = left >= right ? 1 : 0; break;
        case '==': left = left === right ? 1 : 0; break;
        default: left = left !== right ? 1 : 0;
      }
    }
  }

  private additive(): number {
    let left = this.multiplicative();
    for (;;) {
      const op = this.eatOp('+', '-');
      if (!op) return left;
      const right = this.multiplicative();
      left = op === '+' ? left + right : left - right;
    }
  }

  private multiplicative(): number {
    let left = this.unary();
    for (;;) {
      const op = this.eatOp('*', '/', '%');
      if (!op) return left;
      const right = this.unary();
      if ((op === '/' || op === '%') && right === 0) {
        // Chia cho 0 trong công thức lương gần như luôn là lỗi cấu hình (ví dụ
        // ngày công chuẩn chưa nhập). Trả 0 thay vì Infinity để con số sai
        // không lặng lẽ chảy vào phiếu lương.
        throw new FormulaError('Chia cho 0 — kiểm tra lại biến trong công thức.');
      }
      left = op === '*' ? left * right : op === '/' ? left / right : left % right;
    }
  }

  private unary(): number {
    const op = this.eatOp('-', '+', '!');
    if (op === '-') return -this.unary();
    if (op === '+') return this.unary();
    if (op === '!') return this.unary() === 0 ? 1 : 0;
    return this.primary();
  }

  private primary(): number {
    const token = this.peek();
    if (!token) throw new FormulaError('Công thức kết thúc giữa chừng.');

    if (token.type === 'number') {
      this.pos += 1;
      return Number(token.value);
    }

    if (token.type === 'paren' && token.value === '(') {
      this.pos += 1;
      const value = this.ternary();
      const closing = this.peek();
      if (!closing || closing.value !== ')') {
        throw new FormulaError('Thiếu dấu ")".', token.at);
      }
      this.pos += 1;
      return value;
    }

    if (token.type === 'ident') {
      this.pos += 1;
      const next = this.peek();

      if (next && next.type === 'paren' && next.value === '(') {
        return this.callFunction(token);
      }

      const name = token.value.toUpperCase();
      this.seen.add(name);
      const value = this.scope[name];
      if (value === undefined) {
        throw new FormulaError(`Không có biến "${token.value}" trong kỳ lương này.`, token.at);
      }
      return value;
    }

    throw new FormulaError(`Không hiểu "${token.value}".`, token.at);
  }

  private callFunction(nameToken: Token): number {
    const name = nameToken.value.toUpperCase();
    const spec = FUNCTIONS[name];
    if (!spec) {
      throw new FormulaError(`Không có hàm "${nameToken.value}".`, nameToken.at);
    }

    this.pos += 1; // bỏ qua "("
    const args: number[] = [];

    if (this.peek()?.value !== ')') {
      for (;;) {
        args.push(this.ternary());
        const next = this.peek();
        if (next?.type === 'comma') {
          this.pos += 1;
          continue;
        }
        break;
      }
    }

    const closing = this.peek();
    if (!closing || closing.value !== ')') {
      throw new FormulaError(`Thiếu ")" khi gọi ${name}.`, nameToken.at);
    }
    this.pos += 1;

    if (spec.arity === 'variadic') {
      if (args.length === 0) {
        throw new FormulaError(`${name} cần ít nhất một tham số.`, nameToken.at);
      }
    } else if (args.length !== spec.arity) {
      throw new FormulaError(
        `${name} cần đúng ${spec.arity} tham số, đang có ${args.length}.`,
        nameToken.at,
      );
    }

    return spec.fn(...args);
  }
}

export interface FormulaResult {
  value: number;
  /** Các biến công thức đã đọc — hiện lên UI để HR biết nó phụ thuộc vào gì. */
  usedVariables: string[];
}

/**
 * Tính một công thức trong phạm vi biến cho trước.
 *
 * Ném `FormulaError` khi công thức sai cú pháp hoặc gọi biến không tồn tại.
 * Người gọi bắt lỗi và hiện lên phiếu lương thay vì để cả trang trắng — một
 * khoản sai công thức không được phép làm sập bảng lương của cả công ty.
 */
export function evaluateFormula(
  source: string,
  scope: Readonly<Record<string, number>>,
): FormulaResult {
  const trimmed = source.trim();
  if (!trimmed) return { value: 0, usedVariables: [] };

  const seen = new Set<string>();
  const tokens = tokenize(trimmed);
  if (tokens.length === 0) return { value: 0, usedVariables: [] };

  const value = new Parser(tokens, scope, seen).parse();
  if (!Number.isFinite(value)) {
    throw new FormulaError('Công thức cho ra giá trị không phải số.');
  }

  return { value, usedVariables: [...seen] };
}

/**
 * Kiểm tra công thức trước khi lưu, dùng bộ biến mẫu. Trả về thông báo lỗi
 * hoặc null nếu công thức chạy được — để HR không lưu được công thức hỏng rồi
 * mới phát hiện lúc chạy lương.
 */
export function validateFormula(
  source: string,
  sampleScope: Readonly<Record<string, number>>,
): string | null {
  try {
    evaluateFormula(source, sampleScope);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}
