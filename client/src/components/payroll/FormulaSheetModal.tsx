// ============================================================================
// "Xem công thức dạng chữ" — toàn bộ dòng cộng / trừ của một cơ chế, mỗi dòng
// một phương trình, xếp theo nhóm như phiếu lương. Để đối chiếu cơ chế đã dựng
// với bộ công thức tính lương trên giấy, không phải để sửa.
// ============================================================================

import { useMemo, useState } from 'react';
import { Copy } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/contexts/ToastContext';
import type { MechanismRow } from '@/lib/payroll';
import {
  FORMULA_SHEET_GROSS_NAME, buildFormulaSheet, formulaSheetText, type FormulaSheetOptions,
} from '@/lib/formulaSheet';
import type { PayComponentCategory } from '@/types';

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

interface FormulaSheetModalProps {
  open: boolean;
  onClose: () => void;
  /** Cơ chế của ai: tên đơn vị hoặc tên nhân viên. */
  subject: string;
  rows: readonly MechanismRow[];
  nameOf: (code: string) => string | undefined;
  categories: readonly PayComponentCategory[];
  rounding?: FormulaSheetOptions['rounding'];
}

export function FormulaSheetModal({ open, onClose, subject, rows, nameOf, categories, rounding }: FormulaSheetModalProps) {
  const { toast } = useToast();
  const [expand, setExpand] = useState(true);

  const sheet = useMemo(
    () => (open ? buildFormulaSheet(rows, nameOf, categories, { expandIntermediate: expand, rounding }) : null),
    [categories, expand, nameOf, open, rounding, rows],
  );

  const copy = async () => {
    if (!sheet) return;
    try {
      await navigator.clipboard.writeText(`Công thức lương — ${subject}\n\n${formulaSheetText(sheet, ROMAN)}`);
      toast('Đã chép toàn bộ công thức.', 'success');
    } catch {
      toast('Trình duyệt không cho chép — bôi đen rồi chép tay.', 'warning');
    }
  };

  const lastEarningIndex = sheet ? sheet.sections.map((section) => section.kind).lastIndexOf('EARNING') : -1;

  return (
    <Modal square open={open} onClose={onClose} title={`Công thức lương — ${subject}`} size="xl">
      {sheet && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                className="h-4 w-4 accent-indigo-600"
                checked={expand}
                onChange={(event) => setExpand(event.target.checked)}
              />
              Thay dòng trung gian bằng công thức của nó
            </label>
            <Button size="sm" variant="outline" onClick={() => void copy()}>
              <Copy className="h-4 w-4" /> Chép dạng chữ
            </Button>
          </div>
          <p className="text-xs text-slate-500">
            Chỉ gồm các khoản cộng và khoản trừ. Dòng trung gian là số liệu nhập tay hoặc khai từng người thì giữ nguyên tên.
          </p>

          {sheet.sections.length === 0 ? (
            <p className="rounded-none border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">
              Cơ chế chưa có khoản cộng hay khoản trừ nào.
            </p>
          ) : (
            <div className="space-y-5 rounded-none border border-slate-200 bg-white px-4 py-4 sm:px-6">
              {sheet.sections.map((section, index) => (
                <div key={section.key} className="space-y-2">
                  <h3 className="text-sm font-extrabold uppercase tracking-wide text-slate-800">
                    {ROMAN[index] ?? index + 1}. {section.title}
                  </h3>
                  <ol className="space-y-2.5">
                    {section.lines.map((line) => (
                      <li key={line.code} className="text-sm leading-relaxed text-slate-700">
                        <span className="font-semibold text-slate-900">{line.no}. {line.name}</span>
                        <span className={line.kind === 'DEDUCTION' ? 'text-red-600' : 'text-emerald-700'}>
                          {line.kind === 'DEDUCTION' ? ' (trừ)' : ' (cộng)'}
                        </span>
                        <span className="block pl-5 break-words">= {line.text}</span>
                        {expand && line.expanded.length > 0 && (
                          <span className="block pl-5 text-xs text-slate-400 break-words">
                            Trong cơ chế: {line.written}
                          </span>
                        )}
                      </li>
                    ))}
                  </ol>
                  {index === lastEarningIndex && (
                    <Equation tone="emerald" name={FORMULA_SHEET_GROSS_NAME} text={sheet.grossText} />
                  )}
                </div>
              ))}
              {lastEarningIndex < 0 && <Equation tone="emerald" name={FORMULA_SHEET_GROSS_NAME} text={sheet.grossText} />}
              <Equation tone="indigo" name="Thực lĩnh" text={sheet.netText} />
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

function Equation({ tone, name, text }: { tone: 'emerald' | 'indigo'; name: string; text: string }) {
  const tones = {
    emerald: 'border-emerald-200 bg-emerald-50 text-emerald-900',
    indigo: 'border-indigo-200 bg-indigo-50 text-indigo-900',
  };
  return (
    <p className={`rounded-none border px-3 py-2 text-sm leading-relaxed break-words ${tones[tone]}`}>
      <span className="font-extrabold uppercase tracking-wide">{name}</span> = {text}
    </p>
  );
}
