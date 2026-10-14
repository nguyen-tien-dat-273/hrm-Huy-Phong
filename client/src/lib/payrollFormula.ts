// ============================================================================
// Bộ đánh giá biểu thức cho công thức lương.
// ----------------------------------------------------------------------------
// HR tự viết cách tính từng khoản, ví dụ:
//
//   HOURLY_RATE * HE_SO_OT_THUONG * OT_WEEKDAY_HOURS
//   MAX(BASE * 0.1, 1000000)
//   IF(DOANH_SO_KHOAN > 0, DOANH_SO * HH_BL02(DOANH_SO / DOANH_SO_KHOAN * 100) / 100, 0)
//   ROUND(GROSS - INSURANCE_EMPLOYEE - PIT, -3)
//
// KHÔNG dùng `eval` hay `new Function`. Công thức đến từ database, mà database
// lại do người dùng ghi vào — đưa thẳng vào `eval` là mở cửa cho bất kỳ ai sửa
// được bảng `payroll_components` chạy JavaScript tùy ý trong phiên của kế toán
// đang xem bảng lương. Ở đây là parser tự viết: chỉ hiểu số, biến, bốn phép
// tính, so sánh và một nhúm hàm cho sẵn. Không có cách nào chạm tới `window`,
// `fetch` hay prototype chain.
//
// Đọc thành CÂY trước rồi mới tính, để `IF`, `? :`, `&&`, `||` chỉ tính nhánh
// được chọn. Bản cũ tính cả hai nhánh, nên công thức hoa hồng viết đúng kiểu
// `IF(DOANH_SO_KHOAN > 0, DOANH_SO / DOANH_SO_KHOAN, 0)` vẫn ném "chia cho 0"
// đúng ở những người chưa có doanh số khoán — khoản lương biến mất khỏi phiếu.
// ============================================================================

/** Hàm dựng sẵn — tên viết hoa để khỏi lẫn với mã khoản lương. */
const BUILTINS: Record<string, { min: number; max: number }> = {
  MIN: { min: 1, max: Infinity },
  MAX: { min: 1, max: Infinity },
  // ROUND(x) làm tròn đơn vị; ROUND(x, -3) tới hàng nghìn như Excel (FR06.02.02).
  ROUND: { min: 1, max: 2 },
  FLOOR: { min: 1, max: 1 },
  CEIL: { min: 1, max: 1 },
  ABS: { min: 1, max: 1 },
  // Điều kiện: IF(điều_kiện, giá_trị_đúng, giá_trị_sai) — chỉ tính nhánh được chọn.
  IF: { min: 3, max: 3 },
};

/** Tên hàm dựng sẵn, để màn cấu hình chặn đặt trùng tên tham số / biểu. */
export const BUILTIN_FUNCTION_NAMES: readonly string[] = Object.keys(BUILTINS);

/**
 * Hàm do DỮ LIỆU cấp thêm — mỗi biểu bậc thang trong bộ tham số là một hàm
 * một đối số: `HH_BL02(105)` trả về mức của bậc chứa 105.
 */
export type FormulaFunctions = Readonly<Record<string, (value: number) => number>>;

export interface FormulaOptions {
  functions?: FormulaFunctions;
}

type TokenType = 'number' | 'ident' | 'op' | 'paren' | 'comma';

interface Token {
  type: TokenType;
  value: string;
  /** Vị trí trong chuỗi gốc — để báo lỗi chỉ đúng chỗ sai. */
  at: number;
}

export class FormulaError extends Error {
  constructor(message: string, readonly at?: number, readonly length = 1) {
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
        throw new FormulaError(`Số không hợp lệ: "${raw}"`, start, i - start);
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

// ---------------------------------------------------------------------------
// Cây cú pháp
// ---------------------------------------------------------------------------

type FormulaNode =
  | { kind: 'num'; value: number; at: number }
  | { kind: 'var'; name: string; at: number; length: number }
  | { kind: 'unary'; op: string; arg: FormulaNode; at: number }
  | { kind: 'binary'; op: string; left: FormulaNode; right: FormulaNode; at: number }
  | { kind: 'cond'; test: FormulaNode; whenTrue: FormulaNode; whenFalse: FormulaNode; at: number }
  | { kind: 'call'; name: string; args: FormulaNode[]; at: number; length: number };

/**
 * Parser đệ quy xuống, thứ tự ưu tiên từ lỏng tới chặt:
 * ternary → hoặc → và → so sánh → cộng trừ → nhân chia → dấu đơn → hạng tử.
 */
class Parser {
  private pos = 0;

  constructor(private readonly tokens: Token[], private readonly sourceLength: number) {}

  parse(): FormulaNode {
    const node = this.ternary();
    if (this.pos < this.tokens.length) {
      const token = this.tokens[this.pos];
      throw new FormulaError(`Thừa "${token.value}" ở cuối công thức.`, token.at, token.value.length);
    }
    return node;
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private eatOp(...values: string[]): Token | null {
    const token = this.peek();
    if (token && token.type === 'op' && values.includes(token.value)) {
      this.pos += 1;
      return token;
    }
    return null;
  }

  private ternary(): FormulaNode {
    const test = this.or();
    const question = this.eatOp('?');
    if (!question) return test;

    const whenTrue = this.ternary();
    if (!this.eatOp(':')) {
      throw new FormulaError('Thiếu ":" cho biểu thức điều kiện "? :".', this.peek()?.at ?? this.sourceLength);
    }
    const whenFalse = this.ternary();
    return { kind: 'cond', test, whenTrue, whenFalse, at: question.at };
  }

  private or(): FormulaNode {
    let left = this.and();
    for (let op = this.eatOp('||'); op; op = this.eatOp('||')) {
      left = { kind: 'binary', op: '||', left, right: this.and(), at: op.at };
    }
    return left;
  }

  private and(): FormulaNode {
    let left = this.comparison();
    for (let op = this.eatOp('&&'); op; op = this.eatOp('&&')) {
      left = { kind: 'binary', op: '&&', left, right: this.comparison(), at: op.at };
    }
    return left;
  }

  private comparison(): FormulaNode {
    let left = this.additive();
    for (let op = this.eatOp('<', '<=', '>', '>=', '==', '!='); op; op = this.eatOp('<', '<=', '>', '>=', '==', '!=')) {
      left = { kind: 'binary', op: op.value, left, right: this.additive(), at: op.at };
    }
    return left;
  }

  private additive(): FormulaNode {
    let left = this.multiplicative();
    for (let op = this.eatOp('+', '-'); op; op = this.eatOp('+', '-')) {
      left = { kind: 'binary', op: op.value, left, right: this.multiplicative(), at: op.at };
    }
    return left;
  }

  private multiplicative(): FormulaNode {
    let left = this.unary();
    for (let op = this.eatOp('*', '/', '%'); op; op = this.eatOp('*', '/', '%')) {
      left = { kind: 'binary', op: op.value, left, right: this.unary(), at: op.at };
    }
    return left;
  }

  private unary(): FormulaNode {
    const op = this.eatOp('-', '+', '!');
    if (op) return { kind: 'unary', op: op.value, arg: this.unary(), at: op.at };
    return this.primary();
  }

  private primary(): FormulaNode {
    const token = this.peek();
    if (!token) throw new FormulaError('Công thức kết thúc giữa chừng.', this.sourceLength);

    if (token.type === 'number') {
      this.pos += 1;
      return { kind: 'num', value: Number(token.value), at: token.at };
    }

    if (token.type === 'paren' && token.value === '(') {
      this.pos += 1;
      const inner = this.ternary();
      const closing = this.peek();
      if (!closing || closing.value !== ')') {
        throw new FormulaError('Thiếu dấu ")".', token.at);
      }
      this.pos += 1;
      return inner;
    }

    if (token.type === 'ident') {
      this.pos += 1;
      const next = this.peek();
      if (next && next.type === 'paren' && next.value === '(') {
        return this.call(token);
      }
      return { kind: 'var', name: token.value.toUpperCase(), at: token.at, length: token.value.length };
    }

    throw new FormulaError(`Không hiểu "${token.value}".`, token.at, token.value.length);
  }

  private call(nameToken: Token): FormulaNode {
    this.pos += 1; // bỏ qua "("
    const args: FormulaNode[] = [];

    if (this.peek()?.value !== ')') {
      for (;;) {
        args.push(this.ternary());
        if (this.peek()?.type === 'comma') {
          this.pos += 1;
          continue;
        }
        break;
      }
    }

    const closing = this.peek();
    if (!closing || closing.value !== ')') {
      throw new FormulaError(`Thiếu ")" khi gọi ${nameToken.value.toUpperCase()}.`, nameToken.at, nameToken.value.length);
    }
    this.pos += 1;
    return {
      kind: 'call', name: nameToken.value.toUpperCase(), args, at: nameToken.at, length: nameToken.value.length,
    };
  }
}

function parseFormula(source: string): FormulaNode | null {
  const tokens = tokenize(source);
  if (tokens.length === 0) return null;
  return new Parser(tokens, source.length).parse();
}

// ---------------------------------------------------------------------------
// Kiểm tra tĩnh: biến và hàm có tồn tại không — xét MỌI nhánh
// ---------------------------------------------------------------------------
// Tính thử chỉ đi qua nhánh được chọn với số liệu mẫu, nên một biến gõ sai ở
// nhánh còn lại sẽ lọt qua bước lưu rồi nổ lúc chạy lương tháng có số liệu
// thật rơi vào nhánh đó. Đi hết cây để bắt từ lúc gõ.
function checkReferences(
  node: FormulaNode,
  scope: Readonly<Record<string, number>>,
  functions: FormulaFunctions,
  used: Set<string>,
): void {
  switch (node.kind) {
    case 'num':
      return;
    case 'var':
      used.add(node.name);
      if (scope[node.name] === undefined) {
        throw new FormulaError(`Không có biến "${node.name}" trong kỳ lương này.`, node.at, node.length);
      }
      return;
    case 'unary':
      checkReferences(node.arg, scope, functions, used);
      return;
    case 'binary':
      checkReferences(node.left, scope, functions, used);
      checkReferences(node.right, scope, functions, used);
      return;
    case 'cond':
      checkReferences(node.test, scope, functions, used);
      checkReferences(node.whenTrue, scope, functions, used);
      checkReferences(node.whenFalse, scope, functions, used);
      return;
    case 'call': {
      const builtin = BUILTINS[node.name];
      if (builtin) {
        if (node.args.length < builtin.min || node.args.length > builtin.max) {
          const want = builtin.max === Infinity
            ? `ít nhất ${builtin.min}`
            : builtin.min === builtin.max ? `đúng ${builtin.min}` : `${builtin.min}–${builtin.max}`;
          throw new FormulaError(`${node.name} cần ${want} tham số, đang có ${node.args.length}.`, node.at, node.length);
        }
      } else if (functions[node.name]) {
        if (node.args.length !== 1) {
          throw new FormulaError(`Biểu ${node.name} nhận đúng 1 giá trị để tra bậc.`, node.at, node.length);
        }
      } else {
        throw new FormulaError(`Không có hàm hay biểu bậc thang "${node.name}".`, node.at, node.length);
      }
      node.args.forEach((arg) => checkReferences(arg, scope, functions, used));
    }
  }
}

/** Làm tròn kiểu Excel: nửa đơn vị làm tròn RA XA số 0, chữ số âm là hàng chục/trăm/nghìn. */
export function roundTo(value: number, digits = 0): number {
  const places = Math.trunc(digits);
  const sign = value < 0 ? -1 : 1;
  const abs = Math.abs(value);
  if (places < 0) {
    const unit = 10 ** -places;
    return sign * Math.round(abs / unit) * unit;
  }
  // Dịch dấu phẩy bằng ký pháp mũ thay vì nhân 10^n: 1.005 * 100 trong số
  // dấu phẩy động là 100.49999…, làm tròn ra 100 — Excel ra 101.
  const text = String(abs);
  if (/e/i.test(text)) return sign * Math.round(abs * 10 ** places) / 10 ** places;
  return sign * Number(`${Math.round(Number(`${text}e${places}`))}e-${places}`);
}

function evaluateNode(
  node: FormulaNode,
  scope: Readonly<Record<string, number>>,
  functions: FormulaFunctions,
): number {
  switch (node.kind) {
    case 'num':
      return node.value;
    case 'var': {
      const value = scope[node.name];
      if (value === undefined) {
        throw new FormulaError(`Không có biến "${node.name}" trong kỳ lương này.`, node.at, node.length);
      }
      return value;
    }
    case 'unary': {
      const arg = evaluateNode(node.arg, scope, functions);
      if (node.op === '-') return -arg;
      if (node.op === '!') return arg === 0 ? 1 : 0;
      return arg;
    }
    case 'cond':
      return evaluateNode(node.test, scope, functions) !== 0
        ? evaluateNode(node.whenTrue, scope, functions)
        : evaluateNode(node.whenFalse, scope, functions);
    case 'binary': {
      // Hai toán tử logic đi tắt: vế phải chỉ tính khi cần.
      if (node.op === '&&') {
        return evaluateNode(node.left, scope, functions) !== 0
          && evaluateNode(node.right, scope, functions) !== 0 ? 1 : 0;
      }
      if (node.op === '||') {
        return evaluateNode(node.left, scope, functions) !== 0
          || evaluateNode(node.right, scope, functions) !== 0 ? 1 : 0;
      }
      const left = evaluateNode(node.left, scope, functions);
      const right = evaluateNode(node.right, scope, functions);
      switch (node.op) {
        case '+': return left + right;
        case '-': return left - right;
        case '*': return left * right;
        case '/':
        case '%':
          if (right === 0) {
            // Chia cho 0 trong công thức lương gần như luôn là lỗi cấu hình
            // (ví dụ ngày công chuẩn chưa nhập). Báo lỗi thay vì để Infinity
            // lặng lẽ chảy vào phiếu lương.
            throw new FormulaError('Chia cho 0 — kiểm tra lại biến trong công thức.', node.at);
          }
          return node.op === '/' ? left / right : left % right;
        case '<': return left < right ? 1 : 0;
        case '<=': return left <= right ? 1 : 0;
        case '>': return left > right ? 1 : 0;
        case '>=': return left >= right ? 1 : 0;
        case '==': return left === right ? 1 : 0;
        default: return left !== right ? 1 : 0;
      }
    }
    case 'call': {
      if (node.name === 'IF') {
        return evaluateNode(node.args[0], scope, functions) !== 0
          ? evaluateNode(node.args[1], scope, functions)
          : evaluateNode(node.args[2], scope, functions);
      }
      const args = node.args.map((arg) => evaluateNode(arg, scope, functions));
      switch (node.name) {
        case 'MIN': return Math.min(...args);
        case 'MAX': return Math.max(...args);
        case 'ROUND': return roundTo(args[0], args[1] ?? 0);
        case 'FLOOR': return Math.floor(args[0]);
        case 'CEIL': return Math.ceil(args[0]);
        case 'ABS': return Math.abs(args[0]);
        default: {
          const fn = functions[node.name];
          if (!fn) throw new FormulaError(`Không có hàm hay biểu bậc thang "${node.name}".`, node.at, node.length);
          return fn(args[0]);
        }
      }
    }
  }
}

export interface FormulaResult {
  value: number;
  /** Các biến công thức tham chiếu (mọi nhánh) — hiện lên UI để HR biết nó phụ thuộc vào gì. */
  usedVariables: string[];
}

/**
 * Tính một công thức trong phạm vi biến cho trước.
 *
 * Ném `FormulaError` khi công thức sai cú pháp, gọi biến / hàm không tồn tại
 * (ở BẤT KỲ nhánh nào), hoặc chia cho 0 ở nhánh được chọn. Người gọi bắt lỗi
 * và hiện lên phiếu lương thay vì để cả trang trắng — một khoản sai công thức
 * không được phép làm sập bảng lương của cả công ty.
 */
export function evaluateFormula(
  source: string,
  scope: Readonly<Record<string, number>>,
  options: FormulaOptions = {},
): FormulaResult {
  const trimmed = source.trim();
  if (!trimmed) return { value: 0, usedVariables: [] };

  const tree = parseFormula(trimmed);
  if (!tree) return { value: 0, usedVariables: [] };

  const functions = options.functions ?? {};
  const used = new Set<string>();
  checkReferences(tree, scope, functions, used);

  const value = evaluateNode(tree, scope, functions);
  if (!Number.isFinite(value)) {
    throw new FormulaError('Công thức cho ra giá trị không phải số.');
  }
  return { value, usedVariables: [...used] };
}

export interface FormulaValidation {
  message: string;
  /** Vị trí ký tự lỗi trong công thức (đã bỏ khoảng trắng đầu), nếu xác định được. */
  at?: number;
  length?: number;
}

/**
 * Kiểm tra công thức trước khi lưu, dùng bộ biến mẫu. Trả về thông báo lỗi
 * hoặc null nếu công thức chạy được — để HR không lưu được công thức hỏng rồi
 * mới phát hiện lúc chạy lương.
 */
export function validateFormula(
  source: string,
  sampleScope: Readonly<Record<string, number>>,
  options: FormulaOptions = {},
): string | null {
  return explainFormulaError(source, sampleScope, options)?.message ?? null;
}

/** Như `validateFormula` nhưng giữ cả vị trí lỗi để tô đỏ đúng chỗ (F06.02). */
export function explainFormulaError(
  source: string,
  sampleScope: Readonly<Record<string, number>>,
  options: FormulaOptions = {},
): FormulaValidation | null {
  const leading = source.length - source.trimStart().length;
  try {
    evaluateFormula(source, sampleScope, options);
    return null;
  } catch (error) {
    if (error instanceof FormulaError) {
      return {
        message: error.message,
        at: error.at == null ? undefined : error.at + leading,
        length: error.length,
      };
    }
    return { message: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Biến một biểu bậc thang thành hàm tra cứu: trả về `value` của bậc có
 * `from` lớn nhất mà không vượt giá trị tra. Dưới bậc thấp nhất thì 0.
 *
 * Mỗi bậc áp từ ngưỡng của nó tới NGAY DƯỚI ngưỡng kế tiếp — cách hiểu này lấp
 * kín khoảng hở 89–90% và 104–105% mà BR-PAY-004 để ngỏ.
 */
export function tierLookup(rows: ReadonlyArray<{ from: number; value: number }>): (value: number) => number {
  const sorted = [...rows].sort((a, b) => a.from - b.from);
  return (input: number) => {
    let result = 0;
    for (const row of sorted) {
      if (input >= row.from) result = row.value;
      else break;
    }
    return result;
  };
}
