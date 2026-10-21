// ============================================================================
// Công thức lương dạng THẺ — phần không có giao diện của ô nhập công thức.
// ----------------------------------------------------------------------------
// Công thức LƯU dưới dạng chuỗi mã (`LUONG_CO_BAN / STANDARD_DAYS * WORK_DAYS`)
// để bộ đánh giá công thức và database kiểm được như cũ. Người dùng thì thấy
// và gõ bằng TÊN: [Lương cơ bản] ÷ [Công chuẩn của tháng] × [Ngày công thực tế].
// File này lo phần chuyển qua lại giữa hai dạng đó, tìm gợi ý không dấu, và
// diễn giải công thức ra chữ / ra số cho phiếu lương.
// ============================================================================

import { evaluateFormula, explainFormulaError, type FormulaFunctions } from './payrollFormula';
import { stripVietnamese } from './tableExport';

export type FormulaOp = '+' | '-' | '*' | '/' | '%' | '>' | '<' | '>=' | '<=' | '==' | '!=' | '&&' | '||' | '?' | ':' | '!';

export type FormulaToken =
  | { kind: 'ref'; code: string }
  | { kind: 'num'; value: string }
  | { kind: 'op'; op: FormulaOp }
  | { kind: 'lparen' }
  | { kind: 'rparen' }
  | { kind: 'comma' }
  /** Đầu một lời gọi hàm, gồm cả dấu "(" mở. */
  | { kind: 'fn'; code: string }
  /** Chữ không khớp gì — hiện đỏ, không lưu được. */
  | { kind: 'unknown'; text: string };

export const OP_DISPLAY: Record<FormulaOp, string> = {
  '+': '+', '-': '−', '*': '×', '/': '÷', '%': 'dư', '>': '>', '<': '<', '>=': '≥', '<=': '≤',
  '==': '=', '!=': '≠', '&&': 'và', '||': 'hoặc', '?': '?', ':': ':', '!': 'không',
};

const MULTI_OPS: FormulaOp[] = ['>=', '<=', '==', '!=', '&&', '||'];
const SINGLE_OPS: FormulaOp[] = ['+', '-', '*', '/', '%', '>', '<', '?', ':', '!'];

/** Chuỗi mã → thẻ. Không bao giờ ném lỗi: ký tự lạ thành thẻ "unknown". */
export function tokenizeFormula(source: string): FormulaToken[] {
  const tokens: FormulaToken[] = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (/\s/.test(ch)) { i += 1; continue; }
    if (/[0-9.]/.test(ch)) {
      const start = i;
      while (i < source.length && /[0-9._]/.test(source[i])) i += 1;
      const raw = source.slice(start, i).replace(/_/g, '');
      const value = Number(raw);
      tokens.push(Number.isFinite(value) ? { kind: 'num', value: String(value) } : { kind: 'unknown', text: raw });
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      const start = i;
      while (i < source.length && /[A-Za-z0-9_]/.test(source[i])) i += 1;
      const code = source.slice(start, i).toUpperCase();
      let j = i;
      while (j < source.length && /\s/.test(source[j])) j += 1;
      if (source[j] === '(') {
        tokens.push({ kind: 'fn', code });
        i = j + 1;
      } else {
        tokens.push({ kind: 'ref', code });
      }
      continue;
    }
    if (ch === '(') { tokens.push({ kind: 'lparen' }); i += 1; continue; }
    if (ch === ')') { tokens.push({ kind: 'rparen' }); i += 1; continue; }
    if (ch === ',') { tokens.push({ kind: 'comma' }); i += 1; continue; }
    const two = source.slice(i, i + 2) as FormulaOp;
    if (MULTI_OPS.includes(two)) { tokens.push({ kind: 'op', op: two }); i += 2; continue; }
    if (SINGLE_OPS.includes(ch as FormulaOp)) { tokens.push({ kind: 'op', op: ch as FormulaOp }); i += 1; continue; }
    tokens.push({ kind: 'unknown', text: ch });
    i += 1;
  }
  return tokens;
}

function pieceOf(token: FormulaToken): string {
  switch (token.kind) {
    case 'ref': return token.code;
    case 'num': return token.value;
    case 'op': return token.op;
    case 'lparen': return '(';
    case 'rparen': return ')';
    case 'comma': return ',';
    case 'fn': return `${token.code}(`;
    default: return token.text;
  }
}

/** Thẻ → chuỗi mã, kèm vị trí ký tự của từng thẻ (để chỉ đúng thẻ lỗi). */
export function serializeWithOffsets(tokens: readonly FormulaToken[]): {
  text: string;
  offsets: Array<{ start: number; end: number }>;
} {
  let text = '';
  const offsets: Array<{ start: number; end: number }> = [];
  tokens.forEach((token, index) => {
    const previous = tokens[index - 1];
    const glue = index === 0
      || previous?.kind === 'lparen' || previous?.kind === 'fn'
      || token.kind === 'rparen' || token.kind === 'comma';
    if (!glue) text += ' ';
    const piece = pieceOf(token);
    offsets.push({ start: text.length, end: text.length + piece.length });
    text += piece;
  });
  return { text, offsets };
}

export function serializeFormula(tokens: readonly FormulaToken[]): string {
  return serializeWithOffsets(tokens).text;
}

/** Thẻ chứa ký tự thứ `at` của chuỗi đã ghép. */
export function tokenIndexAt(offsets: ReadonlyArray<{ start: number; end: number }>, at: number): number {
  const exact = offsets.findIndex((range) => at >= range.start && at < range.end);
  if (exact >= 0) return exact;
  const after = offsets.findIndex((range) => range.start >= at);
  return after >= 0 ? after : offsets.length - 1;
}

/** Mã mà công thức đọc tới (không gồm tên hàm). */
export function referencedCodes(formula: string | null | undefined): string[] {
  if (!formula?.trim()) return [];
  return [...new Set(tokenizeFormula(formula)
    .filter((token): token is { kind: 'ref'; code: string } => token.kind === 'ref')
    .map((token) => token.code))];
}

export function referencedFunctions(formula: string | null | undefined): string[] {
  if (!formula?.trim()) return [];
  return [...new Set(tokenizeFormula(formula)
    .filter((token): token is { kind: 'fn'; code: string } => token.kind === 'fn')
    .map((token) => token.code))];
}

// ---------------------------------------------------------------------------
// Gợi ý khi gõ
// ---------------------------------------------------------------------------

export type EntryGroup = 'ROW' | 'PARAM' | 'SYSTEM' | 'TIER' | 'FUNCTION' | 'CATALOG';

export const ENTRY_GROUP_LABEL: Record<EntryGroup, string> = {
  ROW: 'Đầu mục trong cơ chế',
  PARAM: 'Tham số',
  SYSTEM: 'Dữ liệu tự động',
  TIER: 'Bảng bậc thang',
  FUNCTION: 'Hàm',
  CATALOG: 'Thêm từ danh mục',
};

const GROUP_ORDER: EntryGroup[] = ['ROW', 'PARAM', 'SYSTEM', 'TIER', 'FUNCTION', 'CATALOG'];

/** Một thứ gõ được vào công thức. */
export interface FormulaEntry {
  code: string;
  name: string;
  group: EntryGroup;
  /** Nhóm con, ví dụ tên bảng tham số. */
  section?: string;
  /** Đơn vị / giá trị hiện tại, hiện bên phải gợi ý. */
  detail?: string;
  hint?: string;
  /** Gọi như hàm: chèn kèm "(". */
  isFunction?: boolean;
  /** Đầu mục danh mục chưa có trong cơ chế — chọn là thêm dòng. */
  componentId?: string;
  /** Không gợi ý khi gõ — chỉ để công thức đã lưu từ trước hiện đúng tên. */
  hidden?: boolean;
}

export function normalizeText(text: string): string {
  return stripVietnamese(text).toLowerCase().replace(/[^a-z0-9%]+/g, ' ').trim();
}

function initialsOf(normalized: string): string {
  return normalized.split(' ').filter(Boolean).map((word) => word[0]).join('');
}

function scoreEntry(entry: FormulaEntry, query: string): number {
  const name = normalizeText(entry.name);
  const code = entry.code.toLowerCase();
  const compact = query.replace(/\s+/g, '');
  if (!query) return 1;
  if (name === query) return 100;
  if (name.startsWith(query)) return 85;
  const words = name.split(' ');
  const queryWords = query.split(' ');
  // "luong co" khớp "lương cơ bản"; "co ban" khớp "lương cơ bản".
  const wordsMatch = queryWords.every((word) => words.some((candidate) => candidate.startsWith(word)));
  if (wordsMatch && words.some((candidate) => candidate.startsWith(queryWords[0]))) return 70 - Math.min(words.length, 10);
  if (compact.length >= 2 && initialsOf(name).startsWith(compact)) return 55;
  if (name.includes(query)) return 45;
  if (code === compact || code === query.replace(/\s+/g, '_')) return 40;
  if (code.startsWith(compact) || code.includes(query.replace(/\s+/g, '_'))) return 30;
  return 0;
}

/** Gợi ý theo chữ đang gõ — không dấu, khớp đầu từ, khớp chữ cái đầu ("lcb"). */
export function searchEntries(entries: readonly FormulaEntry[], rawQuery: string, limit = 40): FormulaEntry[] {
  const query = normalizeText(rawQuery);
  return entries
    .filter((entry) => !entry.hidden)
    .map((entry) => ({ entry, score: scoreEntry(entry, query) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score
      || GROUP_ORDER.indexOf(a.entry.group) - GROUP_ORDER.indexOf(b.entry.group)
      || a.entry.name.length - b.entry.name.length)
    .slice(0, limit)
    .map(({ entry }) => entry);
}

/** Sắp gợi ý thành từng nhóm, giữ thứ tự điểm trong mỗi nhóm. */
export function groupEntries(entries: readonly FormulaEntry[]): Array<{ group: EntryGroup; items: FormulaEntry[] }> {
  return GROUP_ORDER
    .map((group) => ({ group, items: entries.filter((entry) => entry.group === group) }))
    .filter((block) => block.items.length > 0);
}

// ---------------------------------------------------------------------------
// Đọc một đoạn chữ người dùng dán vào (tên hoặc mã)
// ---------------------------------------------------------------------------

/** "1.000.000" / "1,5" / "2.5" → chuỗi số chuẩn. Không phải số thì null. */
export function parseLooseNumber(raw: string): string | null {
  let text = raw.trim().replace(/\s+/g, '');
  let percent = false;
  if (text.endsWith('%')) { percent = true; text = text.slice(0, -1); }
  if (!/^\d[\d.,]*$|^[.,]\d+$/.test(text)) return null;
  if (text.includes(',') && text.includes('.')) text = text.replace(/\./g, '').replace(',', '.');
  else if (text.includes(',')) text = text.replace(',', '.');
  // "1.000.000" là dấu chấm hàng nghìn; "0.015" thì là số thập phân.
  else if (/^[1-9]\d{0,2}(\.\d{3})+$/.test(text)) text = text.replace(/\./g, '');
  const value = Number(text);
  if (!Number.isFinite(value)) return null;
  return String(percent ? value / 100 : value);
}

function matchEntry(text: string, entries: readonly FormulaEntry[]): FormulaEntry | null {
  const upper = text.trim().toUpperCase();
  const byCode = entries.find((entry) => entry.code === upper);
  if (byCode) return byCode;
  const normalized = normalizeText(text);
  const byName = entries.filter((entry) => normalizeText(entry.name) === normalized);
  if (byName.length >= 1) return byName[0];
  const found = searchEntries(entries, text, 2);
  return found.length === 1 ? found[0] : null;
}

/**
 * Đọc chữ dán vào: chấp nhận cả tên tiếng Việt lẫn mã, dấu × ÷ x : và dấu
 * phẩy thập phân. Đoạn nào không khớp thành thẻ đỏ để người dùng sửa.
 */
export function parseLooseFormula(text: string, entries: readonly FormulaEntry[]): FormulaToken[] {
  const tokens: FormulaToken[] = [];
  const normalized = text
    .replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-')
    .replace(/≥/g, '>=').replace(/≤/g, '<=').replace(/≠/g, '!=')
    .replace(/(^|\s)[xX](?=\s)/g, '$1*')
    .replace(/(^|\s):(?=\s)/g, '$1/');
  let buffer = '';
  const flush = (followedByParen: boolean) => {
    const piece = buffer.trim();
    buffer = '';
    if (!piece) return false;
    const number = parseLooseNumber(piece);
    if (number != null) { tokens.push({ kind: 'num', value: number }); return false; }
    const entry = matchEntry(piece, entries);
    if (followedByParen && (!entry || entry.isFunction)) {
      tokens.push({ kind: 'fn', code: entry?.code ?? piece.toUpperCase().replace(/[^A-Z0-9_]/g, '_') });
      return true;
    }
    tokens.push(entry ? { kind: 'ref', code: entry.code } : { kind: 'unknown', text: piece });
    return false;
  };
  for (let i = 0; i < normalized.length; i += 1) {
    const ch = normalized[i];
    const two = normalized.slice(i, i + 2) as FormulaOp;
    if (ch === '(') {
      if (!flush(true)) tokens.push({ kind: 'lparen' });
      continue;
    }
    if (ch === ')') { flush(false); tokens.push({ kind: 'rparen' }); continue; }
    // "1,5" là số thập phân; dấu phẩy khác (và ";") ngăn các đối số của hàm.
    if (ch === ',' && /\d$/.test(buffer) && /\d/.test(normalized[i + 1] ?? '')) { buffer += ch; continue; }
    if (ch === ',' || ch === ';') { flush(false); tokens.push({ kind: 'comma' }); continue; }
    if (MULTI_OPS.includes(two)) { flush(false); tokens.push({ kind: 'op', op: two }); i += 1; continue; }
    if (ch === '%' && /\d$/.test(buffer.trim())) { buffer += ch; continue; }
    if (SINGLE_OPS.includes(ch as FormulaOp) && ch !== '%') { flush(false); tokens.push({ kind: 'op', op: ch as FormulaOp }); continue; }
    buffer += ch;
  }
  flush(false);
  return tokens;
}

// ---------------------------------------------------------------------------
// Kiểm tra & diễn giải
// ---------------------------------------------------------------------------

export interface FormulaIssue {
  message: string;
  /** Thẻ bị lỗi (chỉ số trong mảng thẻ), nếu xác định được. */
  tokenIndex: number | null;
}

/**
 * Lỗi của một công thức dạng thẻ, viết bằng tên chứ không bằng mã. Rỗng thì
 * không lỗi (công thức trống là chuyện của người gọi).
 */
export function formulaIssueOf(
  tokens: readonly FormulaToken[],
  scope: Readonly<Record<string, number>>,
  functions: FormulaFunctions,
  nameOf: (code: string) => string | undefined,
): FormulaIssue | null {
  if (tokens.length === 0) return null;
  const unknown = tokens.findIndex((token) => token.kind === 'unknown');
  if (unknown >= 0) {
    const token = tokens[unknown] as { kind: 'unknown'; text: string };
    return { message: `“${token.text}” không khớp đầu mục, tham số hay dữ liệu nào — chọn từ gợi ý.`, tokenIndex: unknown };
  }
  const { text, offsets } = serializeWithOffsets(tokens);
  const issue = explainFormulaError(text, scope, { functions });
  if (!issue) return null;
  const message = issue.message
    .replace(/"([A-Z][A-Z0-9_]*)"/g, (_, code: string) => `“${nameOf(code) ?? code}”`)
    .replace(/Không có biến (“[^”]+”) trong kỳ lương này\./, '$1 chưa có trong cơ chế này.')
    .replace(/Thiếu "\)" khi gọi ([A-Z][A-Z0-9_]*)\./, (_, code: string) => `Thiếu dấu “)” đóng hàm ${nameOf(code) ?? code}.`)
    .replace('Thiếu dấu ")".', 'Thiếu dấu “)” đóng ngoặc.');
  return { message, tokenIndex: issue.at == null ? null : tokenIndexAt(offsets, issue.at) };
}

const numberFormat = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 });
const literalFormat = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 10 });

/** Con số đã tính (giá trị thử, kết quả): gọn, tối đa 2 chữ số lẻ. */
export function formatFormulaNumber(value: number): string {
  return numberFormat.format(value);
}

/**
 * Con số người dùng GÕ trong công thức: giữ đủ chữ số lẻ. Làm tròn ở đây thì
 * chuyển qua "Dạng chữ" rồi chuyển lại là công thức đổi số (0,015 → 0,02).
 */
export function formatFormulaLiteral(value: number): string {
  return literalFormat.format(value);
}

function displayPieces(
  tokens: readonly FormulaToken[],
  refText: (code: string) => string,
  fnText: (code: string) => string,
): string {
  let text = '';
  tokens.forEach((token, index) => {
    const previous = tokens[index - 1];
    const glue = index === 0
      || previous?.kind === 'lparen' || previous?.kind === 'fn'
      || token.kind === 'rparen' || token.kind === 'comma';
    if (!glue) text += ' ';
    switch (token.kind) {
      case 'ref': text += refText(token.code); break;
      case 'num': text += formatFormulaLiteral(Number(token.value)); break;
      case 'op': text += OP_DISPLAY[token.op]; break;
      case 'lparen': text += '('; break;
      case 'rparen': text += ')'; break;
      case 'comma': text += ';'; break;
      case 'fn': text += `${fnText(token.code)}(`; break;
      default: text += token.text;
    }
  });
  return text;
}

/** "Lương cơ bản ÷ Công chuẩn của tháng × Ngày công thực tế". */
export function describeFormula(formula: string, nameOf: (code: string) => string | undefined): string {
  return displayPieces(tokenizeFormula(formula), (code) => nameOf(code) ?? code, (code) => nameOf(code) ?? code);
}

/** Thay mỗi biến bằng con số của nó: "12.000.000 ÷ 23,5 × 22,5" — cột "Cách tính" của phiếu lương. */
export function renderFormulaWithValues(
  formula: string,
  scope: Readonly<Record<string, number>>,
  nameOf: (code: string) => string | undefined = () => undefined,
): string {
  return displayPieces(
    tokenizeFormula(formula),
    (code) => (scope[code] === undefined ? nameOf(code) ?? code : formatFormulaNumber(scope[code])),
    (code) => nameOf(code) ?? code,
  );
}

/** Tính thử công thức dạng thẻ; lỗi thì null. */
export function previewFormula(
  tokens: readonly FormulaToken[],
  scope: Readonly<Record<string, number>>,
  functions: FormulaFunctions,
): number | null {
  if (tokens.length === 0 || tokens.some((token) => token.kind === 'unknown')) return null;
  try {
    return evaluateFormula(serializeFormula(tokens), scope, { functions }).value;
  } catch {
    return null;
  }
}
