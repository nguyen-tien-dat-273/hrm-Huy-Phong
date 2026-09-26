// ============================================================================
// Phiếu lương trình bày như mẫu giấy của phòng kế toán ("Bảng thanh toán lương
// tháng", BL 01 / BL 02): đầu phiếu, bảng STT | Chỉ tiêu | Cách tính | Giá trị.
// ----------------------------------------------------------------------------
// Chỉ là cách trình bày khác của cùng các dòng phiếu — để đối chiếu với mẫu
// và để in, không tính lại gì. Mẫu của đơn vị (lib/payslipLayout) quyết định:
//   - dòng trung gian nào hiện ở đầu phiếu (dòng khác không hiện);
//   - khoản trừ nào đứng trước Tổng cộng (nhóm phạt, trừ ngay trong Tổng cộng).
// Còn lại tự đánh số: khoản cộng chia mục I, II, III… theo nhóm của Danh mục,
// dòng trong mục 1, 2, 3…; mục chỉ có một dòng thì gộp lên dòng mục; mỗi khoản
// trừ còn lại (bảo hiểm, quỹ, thuế…) một mục La Mã sau Tổng cộng.
// ============================================================================

import { useAppSettings } from '@/contexts/SettingsContext';
import { formatFormulaNumber } from '@/lib/formulaTokens';
import { guessHeaderFormat, type ResolvedPayslipLayout } from '@/lib/payslipLayout';
import type { PayComponent, PayComponentCategory, PayComponentKind, PayslipHeaderFormat } from '@/types';

export interface DocumentLine {
  code: string;
  name: string;
  kind: PayComponentKind;
  amount: number;
  detail?: string | null;
  /** Nhóm trong danh mục — null thì vào "Khoản cộng khác". */
  category?: { name: string; sort: number } | null;
}

export interface PayslipDocumentProps {
  lines: DocumentLine[];
  netPay: number;
  roundingAdjustment?: number;
  monthLabel: string;
  employeeName: string;
  employeeCode?: string | null;
  unitName?: string | null;
  standardDays?: number | null;
  /** Mẫu phiếu của đơn vị — không có thì hiện mọi dòng trung gian được truyền vào ở đầu phiếu. */
  layout?: ResolvedPayslipLayout | null;
}

const ROMAN = [
  'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X',
  'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX',
];
const romanOf = (index: number) => ROMAN[index] ?? String(index + 1);

const money = (value: number) => formatFormulaNumber(Math.round(value));

export function formatHeaderValue(value: number, format: PayslipHeaderFormat): string {
  if (format === 'money') return `${money(value)} đ`;
  if (format === 'percent') return `${formatFormulaNumber(Math.round(value * 100) / 100)}%`;
  if (format === 'ratio') return `${formatFormulaNumber(Math.round(value * 10000) / 100)}%`;
  return formatFormulaNumber(value);
}

/**
 * Dòng phiếu (đã tính ở máy kế toán) → dòng của phiếu dạng mẫu: gắn nhóm theo
 * danh mục, và chỉ giữ dòng trung gian nhân viên được thấy (theo mẫu của đơn
 * vị) — như phiếu nhân viên nhận.
 */
export function documentLinesFromCatalog(
  lines: ReadonlyArray<{ code: string; name: string; kind: PayComponentKind; amount: number; detail?: string | null }>,
  components: readonly PayComponent[],
  categories: readonly PayComponentCategory[],
  layout: ResolvedPayslipLayout,
): DocumentLine[] {
  const byCode = new Map(components.map((component) => [component.code, component]));
  const categoryByCode = new Map(categories.map((category) => [category.code, category]));
  const header = new Set(layout.header.map((item) => item.code));
  return lines
    .filter((line) => {
      if (line.kind === 'EMPLOYER_COST') return false;
      return line.kind !== 'INFO' || header.has(line.code);
    })
    .map((line) => {
      const code = byCode.get(line.code)?.category_code;
      const category = code ? categoryByCode.get(code) : undefined;
      return { ...line, category: category ? { name: category.name, sort: category.sort_order } : null };
    });
}

interface Group {
  roman: string;
  title: string;
  total: number;
  /** Mục một dòng: hiện thẳng trên dòng mục, không đánh số con. */
  collapsed: boolean;
  lines: Array<DocumentLine & { no: number }>;
}

/** Gom dòng theo nhóm danh mục (giữ thứ tự nhóm của danh mục, trong nhóm giữ thứ tự phiếu). */
function groupByCategory(lines: readonly DocumentLine[], fallback: string) {
  const groups: Array<{ title: string; sort: number; lines: DocumentLine[] }> = [];
  for (const line of lines) {
    const title = line.category?.name ?? fallback;
    const sort = line.category?.sort ?? Number.MAX_SAFE_INTEGER;
    let group = groups.find((item) => item.title === title);
    if (!group) { group = { title, sort, lines: [] }; groups.push(group); }
    group.lines.push(line);
  }
  return groups.sort((a, b) => a.sort - b.sort);
}

/** Số hạng của một mục trong công thức Tổng cộng: số thứ tự dòng, hoặc số La Mã của mục gộp. */
const termsOf = (group: Group): Array<number | string> => (group.collapsed ? [group.roman] : group.lines.map((line) => line.no));

/** "1 + 2 + … + 9 + II" — dãy số liên tục viết gọn như trên mẫu, số La Mã đứng sau. */
function joinTerms(terms: ReadonlyArray<number | string>): string {
  const numbers = terms.filter((term): term is number => typeof term === 'number');
  const romans = terms.filter((term): term is string => typeof term === 'string');
  const parts: string[] = [];
  let start = 0;
  for (let index = 1; index <= numbers.length; index += 1) {
    if (index < numbers.length && numbers[index] === numbers[index - 1] + 1) continue;
    const run = numbers.slice(start, index);
    if (run.length > 3) parts.push(`${run[0]} + ${run[1]} + … + ${run[run.length - 1]}`);
    else parts.push(...run.map(String));
    start = index;
  }
  return [...parts, ...romans].join(' + ');
}

export function PayslipDocument({
  lines, netPay, roundingAdjustment = 0, monthLabel, employeeName, employeeCode, unitName, standardDays, layout,
}: PayslipDocumentProps) {
  const { orgName } = useAppSettings();

  const infoByCode = new Map(lines.filter((line) => line.kind === 'INFO').map((line) => [line.code, line]));
  const headerInfo = layout
    ? layout.header.flatMap((item) => {
      const line = infoByCode.get(item.code);
      return line ? [{ line, format: item.format }] : [];
    })
    : [...infoByCode.values()].map((line) => ({ line, format: guessHeaderFormat(line.name) }));

  const beforeTotal = new Set(layout?.beforeTotal ?? []);
  const earnings = lines.filter((line) => line.kind === 'EARNING');
  const penalties = lines.filter((line) => line.kind === 'DEDUCTION' && beforeTotal.has(line.code));
  const deductions = lines.filter((line) => line.kind === 'DEDUCTION' && !beforeTotal.has(line.code));

  // Đánh số liền một mạch: mục La Mã theo thứ tự, dòng con 1, 2, 3… qua mọi mục.
  let no = 0;
  let romanIndex = 0;
  const build = (raw: ReturnType<typeof groupByCategory>): Group[] => raw.map((group) => {
    const collapsed = group.lines.length === 1;
    return {
      roman: romanOf(romanIndex++),
      title: group.title,
      total: group.lines.reduce((sum, line) => sum + line.amount, 0),
      collapsed,
      lines: group.lines.map((line) => ({ ...line, no: collapsed ? 0 : ++no })),
    };
  });
  const earningGroups = build(groupByCategory(earnings, 'Khoản cộng khác'));
  const penaltyGroups = build(groupByCategory(penalties, 'Khoản trừ'));

  const gross = earnings.reduce((sum, line) => sum + line.amount, 0);
  const penaltyTotal = penalties.reduce((sum, line) => sum + line.amount, 0);
  const subtotal = gross - penaltyTotal;
  const totalRoman = romanOf(romanIndex++);
  const deductionRomans = deductions.map(() => romanOf(romanIndex++));
  const netRoman = romanOf(romanIndex++);

  const plus = joinTerms(earningGroups.flatMap(termsOf));
  const minus = penaltyGroups.flatMap(termsOf).map((term) => ` − ${term}`).join('');
  const totalFormula = `${totalRoman} = ${plus || '0'}${minus}`;
  const netFormula = `${netRoman} = ${[totalRoman, ...deductionRomans].join(' − ')}`
    + (roundingAdjustment !== 0 ? ' (đã làm tròn)' : '');

  const standardDaysText = standardDays != null ? `ngày công chuẩn: ${formatFormulaNumber(standardDays)} công` : null;
  const subtitle = layout?.title?.trim() || unitName;

  const cell = 'border border-slate-500 px-3 py-2 align-top';
  const amountCell = `${cell} text-right tabular-nums whitespace-nowrap`;

  return (
    <div
      className="mx-auto max-w-4xl bg-white px-5 py-7 text-[15px] leading-relaxed text-slate-900 sm:px-10"
      style={{ fontFamily: '"Times New Roman", Times, "Noto Serif", serif' }}
    >
      <div className="flex items-start justify-between gap-4 font-bold uppercase">
        <div>
          <p>{orgName || 'Công ty'}</p>
          <p>Phòng kế toán</p>
        </div>
        {layout?.formCode && <p className="whitespace-nowrap">{layout.formCode}</p>}
      </div>

      <div className="mt-6 text-center">
        <p className="text-lg font-bold uppercase tracking-wide">Bảng thanh toán lương tháng {monthLabel}</p>
        {subtitle && <p className="mt-0.5 text-base font-bold uppercase">{subtitle}</p>}
      </div>

      <div className="mt-6 grid gap-x-10 gap-y-1.5 sm:grid-cols-2">
        <p>Tên nhân viên: <strong>{employeeName}</strong>{employeeCode ? ` (${employeeCode})` : ''}</p>
        {headerInfo.map(({ line, format }) => (
          <p key={line.code}>{line.name}: <strong className="tabular-nums">{formatHeaderValue(line.amount, format)}</strong></p>
        ))}
      </div>

      <div className="mt-5 overflow-x-auto">
        <table className="w-full min-w-[600px] border-collapse">
          <colgroup>
            <col className="w-16" />
            <col />
            <col className="w-[34%]" />
            <col className="w-44" />
          </colgroup>
          <thead>
            <tr className="bg-slate-100 font-bold text-black">
              <th className={`${cell} text-center`}>STT</th>
              <th className={`${cell} text-center`}>Chỉ tiêu</th>
              <th className={`${cell} text-center`}>Cách tính</th>
              <th className={`${cell} text-center`}>Giá trị (VND)</th>
            </tr>
          </thead>
          <tbody>
            {earningGroups.map((group, index) => (
              <GroupRows
                key={group.title}
                group={index === 0 && standardDaysText ? { ...group, title: `${group.title} (${standardDaysText})` } : group}
                cell={cell}
                amountCell={amountCell}
              />
            ))}
            {penaltyGroups.map((group) => (
              <GroupRows key={`penalty-${group.title}`} group={group} cell={cell} amountCell={amountCell} />
            ))}
            <tr className="bg-slate-50 font-bold">
              <td className={`${cell} text-center`}>{totalRoman}</td>
              <td className={cell}>Tổng cộng</td>
              <td className={`${cell} font-normal`}>{totalFormula}</td>
              <td className={amountCell}>{money(subtotal)}</td>
            </tr>
            {deductions.map((line, index) => (
              <tr key={line.code}>
                <td className={`${cell} text-center font-bold`}>{deductionRomans[index]}</td>
                <td className={`${cell} font-bold`}>{line.name}</td>
                <td className={`${cell} text-[14px] text-slate-700`}>{line.detail}</td>
                <td className={`${amountCell} font-bold`}>{money(line.amount)}</td>
              </tr>
            ))}
            {roundingAdjustment !== 0 && (
              <tr>
                <td className={cell} />
                <td className={cell}>Làm tròn thực lĩnh</td>
                <td className={cell} />
                <td className={amountCell}>{roundingAdjustment > 0 ? '+' : '−'}{money(Math.abs(roundingAdjustment))}</td>
              </tr>
            )}
            <tr className="bg-slate-100 font-bold">
              <td className={`${cell} text-center`}>{netRoman}</td>
              <td className={`${cell} uppercase`}>Thực lĩnh</td>
              <td className={cell}>{netFormula}</td>
              <td className={`${amountCell} text-base`}>{money(netPay)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="mt-8 grid grid-cols-3 gap-4 text-center font-bold uppercase">
        <p>Người lập biểu</p>
        <p>Phó giám đốc</p>
        <p>Giám đốc</p>
      </div>
      <div className="h-20" aria-hidden />
    </div>
  );
}

function GroupRows({ group, cell, amountCell }: { group: Group; cell: string; amountCell: string }) {
  if (group.collapsed) {
    const line = group.lines[0];
    return (
      <tr className="font-bold">
        <td className={`${cell} text-center`}>{group.roman}</td>
        <td className={cell}>{group.title}</td>
        <td className={`${cell} text-[14px] font-normal text-slate-700`}>
          {line.name !== group.title && <span className="block">{line.name}</span>}
          {line.detail}
        </td>
        <td className={amountCell}>{money(group.total)}</td>
      </tr>
    );
  }
  return (
    <>
      <tr className="font-bold">
        <td className={`${cell} text-center`}>{group.roman}</td>
        <td className={cell} colSpan={2}>{group.title}</td>
        <td className={amountCell}>{money(group.total)}</td>
      </tr>
      {group.lines.map((line) => (
        <tr key={line.code}>
          <td className={`${cell} text-center`}>{line.no}</td>
          <td className={cell}>{line.name}</td>
          <td className={`${cell} text-[14px] text-slate-700`}>{line.detail}</td>
          <td className={amountCell}>{money(line.amount)}</td>
        </tr>
      ))}
    </>
  );
}
