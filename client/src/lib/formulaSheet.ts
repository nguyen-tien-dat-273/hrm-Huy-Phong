// ============================================================================
// Toàn bộ công thức của một cơ chế, viết thành chữ — để đối chiếu với bộ công
// thức tính lương trên giấy ("Lương thời gian = (Bậc lương ÷ Công chuẩn) ×
// Ngày công").
// ----------------------------------------------------------------------------
// Chỉ liệt kê dòng cộng / trừ; dòng trung gian không đứng riêng mà (tuỳ chọn)
// được thay bằng chính công thức của nó ở chỗ được dùng, trong ngoặc. Dòng
// trung gian là số liệu nhập tay / khai từng người thì giữ tên — đó là đầu vào.
// ============================================================================

import { describeFormula, formatFormulaNumber, serializeFormula, tokenizeFormula, type FormulaToken } from './formulaTokens';
import type { MechanismRow } from './payroll';
import type { PayComponentCategory, PayComponentKind } from '@/types';

export interface FormulaSheetLine {
  /** Số thứ tự liên tục trên cả bảng, như phiếu lương. */
  no: number;
  code: string;
  name: string;
  kind: PayComponentKind;
  /** Vế phải, đã viết thành chữ. */
  text: string;
  /** Vế phải đúng như gõ trong cơ chế (khác `text` khi đã thay dòng trung gian). */
  written: string;
  /** Tên các dòng trung gian đã được thay vào. */
  expanded: string[];
}

export interface FormulaSheetSection {
  key: string;
  title: string;
  kind: 'EARNING' | 'DEDUCTION';
  lines: FormulaSheetLine[];
}

export interface FormulaSheet {
  sections: FormulaSheetSection[];
  /** "Tổng các khoản cộng = A + B + …" (chỉ vế phải). */
  grossText: string;
  /** "Thực lĩnh = Tổng các khoản cộng − X − …" (chỉ vế phải). */
  netText: string;
}

export interface FormulaSheetOptions {
  /** Thay dòng trung gian (dạng công thức) bằng công thức của nó. */
  expandIntermediate: boolean;
  /** Làm tròn thực lĩnh theo bộ tham số; đơn vị 1 là không làm tròn thêm. */
  rounding?: { unit: number; mode: 'NEAREST' | 'DOWN' | 'UP' } | null;
}

const GROSS_NAME = 'Tổng các khoản cộng';

const ROUNDING_MODE_TEXT = { NEAREST: 'gần nhất', DOWN: 'xuống', UP: 'lên' } as const;

/** Một thẻ đơn (một tên, một số, một lời gọi hàm trọn vẹn) thì không cần bọc ngoặc khi thay vào. */
function isAtomic(tokens: readonly FormulaToken[]): boolean {
  if (tokens.length === 1) return tokens[0].kind === 'ref' || tokens[0].kind === 'num';
  if (tokens[0]?.kind !== 'fn' || tokens[tokens.length - 1]?.kind !== 'rparen') return false;
  let depth = 0;
  for (let index = 0; index < tokens.length; index += 1) {
    const kind = tokens[index].kind;
    if (kind === 'fn' || kind === 'lparen') depth += 1;
    if (kind === 'rparen') depth -= 1;
    if (depth === 0 && index < tokens.length - 1) return false;
  }
  return true;
}

/** Vế phải của dòng không phải công thức: một con số, khai riêng từng người, hay nhập mỗi tháng. */
function describeFixedRow(row: MechanismRow): string {
  if (row.mode === 'VALUE') return formatFormulaNumber(Number(row.amount ?? 0));
  if (row.mode === 'PER_PERSON') {
    return `khai riêng từng người${row.amount != null ? ` (mức chung ${formatFormulaNumber(Number(row.amount))})` : ''}`;
  }
  return 'nhập mỗi tháng';
}

/** Cách tính của một dòng viết thành chữ — "Lương cơ bản ÷ Công chuẩn × Ngày công". */
export function describeRowFormula(row: MechanismRow, nameOf: (code: string) => string | undefined): string {
  if (row.mode !== 'FORMULA') return describeFixedRow(row);
  const formula = row.formula?.trim() ?? '';
  return formula ? describeFormula(formula, nameOf) : '(chưa có công thức)';
}

export function buildFormulaSheet(
  rows: readonly MechanismRow[],
  nameOf: (code: string) => string | undefined,
  categories: readonly Pick<PayComponentCategory, 'code' | 'name'>[],
  options: FormulaSheetOptions,
): FormulaSheet {
  const byCode = new Map(rows.map((row) => [row.component.code.toUpperCase(), row]));

  /** Thẻ của công thức `code` sau khi thay hết dòng trung gian bên trong. */
  const expandTokens = (tokens: readonly FormulaToken[], visiting: Set<string>, used: Set<string>): FormulaToken[] => {
    const out: FormulaToken[] = [];
    for (const token of tokens) {
      const row = token.kind === 'ref' ? byCode.get(token.code.toUpperCase()) : undefined;
      const formula = row?.formula?.trim();
      if (
        token.kind !== 'ref' || !row || row.component.kind !== 'INFO' || row.mode !== 'FORMULA' || !formula
        || visiting.has(token.code.toUpperCase())
      ) {
        out.push(token);
        continue;
      }
      used.add(row.component.name);
      const inner = expandTokens(
        tokenizeFormula(formula),
        new Set([...visiting, token.code.toUpperCase()]),
        used,
      );
      if (isAtomic(inner)) out.push(...inner);
      else out.push({ kind: 'lparen' }, ...inner, { kind: 'rparen' });
    }
    return out;
  };

  const rightSide = (row: MechanismRow): { text: string; written: string; expanded: string[] } => {
    if (row.mode === 'FORMULA') {
      const formula = row.formula?.trim() ?? '';
      if (!formula) return { text: '(chưa có công thức)', written: '(chưa có công thức)', expanded: [] };
      const written = describeFormula(formula, nameOf);
      if (!options.expandIntermediate) return { text: written, written, expanded: [] };
      const used = new Set<string>();
      const tokens = expandTokens(tokenizeFormula(formula), new Set([row.component.code.toUpperCase()]), used);
      return { text: describeFormula(serializeFormula(tokens), nameOf), written, expanded: [...used] };
    }
    const text = describeFixedRow(row);
    return { text, written: text, expanded: [] };
  };

  const listed = rows
    .filter((row) => row.component.kind === 'EARNING' || row.component.kind === 'DEDUCTION')
    .sort((a, b) => a.sortOrder - b.sortOrder || a.component.sort_order - b.component.sort_order);

  const groups: Array<Omit<FormulaSheetSection, 'lines'> & { rows: MechanismRow[] }> = [];
  const known = new Set(categories.map((category) => category.code));
  for (const kind of ['EARNING', 'DEDUCTION'] as const) {
    const ofKind = listed.filter((row) => row.component.kind === kind);
    for (const category of categories) {
      const inGroup = ofKind.filter((row) => row.component.category_code === category.code);
      if (inGroup.length) groups.push({ key: `${kind}-${category.code}`, title: category.name, kind, rows: inGroup });
    }
    const other = ofKind.filter((row) => !row.component.category_code || !known.has(row.component.category_code));
    if (other.length) {
      groups.push({ key: `${kind}-other`, title: kind === 'EARNING' ? 'Khoản cộng khác' : 'Khoản trừ khác', kind, rows: other });
    }
  }

  // Đánh số liên tục sau khi đã xếp nhóm — giống cột STT của phiếu lương.
  let no = 0;
  const sections: FormulaSheetSection[] = groups.map(({ rows: groupRows, ...section }) => ({
    ...section,
    lines: groupRows.map((row) => {
      no += 1;
      return { no, code: row.component.code, name: row.component.name, kind: row.component.kind, ...rightSide(row) };
    }),
  }));

  const namesOf = (kind: PayComponentKind) => sections
    .filter((section) => section.kind === kind)
    .flatMap((section) => section.lines.map((line) => line.name));
  const earnings = namesOf('EARNING');
  const deductions = namesOf('DEDUCTION');

  const grossText = earnings.length ? earnings.join(' + ') : '0';
  let netText = [GROSS_NAME, ...deductions].join(' − ');
  const unit = options.rounding?.unit ?? 1;
  if (unit > 1) {
    netText = `làm tròn ${ROUNDING_MODE_TEXT[options.rounding?.mode ?? 'NEAREST']} đến ${formatFormulaNumber(unit)} đ của (${netText})`;
  }

  return { sections, grossText, netText };
}

export const FORMULA_SHEET_GROSS_NAME = GROSS_NAME;

/** Cả bảng thành chữ thuần — để chép sang văn bản khác đối chiếu. */
export function formulaSheetText(sheet: FormulaSheet, romans: readonly string[]): string {
  const out: string[] = [];
  sheet.sections.forEach((section, index) => {
    out.push(`${romans[index] ?? index + 1}. ${section.title}`);
    for (const line of section.lines) out.push(`  ${line.no}. ${line.name} = ${line.text}`);
    const lastEarning = section.kind === 'EARNING' && sheet.sections[index + 1]?.kind !== 'EARNING';
    if (lastEarning) out.push(`${GROSS_NAME} = ${sheet.grossText}`);
  });
  if (!sheet.sections.some((section) => section.kind === 'EARNING')) out.push(`${GROSS_NAME} = ${sheet.grossText}`);
  out.push(`Thực lĩnh = ${sheet.netText}`);
  return out.join('\n');
}
