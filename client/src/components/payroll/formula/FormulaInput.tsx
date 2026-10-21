// ============================================================================
// Ô nhập công thức lương — gõ liền một dòng, gợi ý NGAY khi gõ.
// ----------------------------------------------------------------------------
//   Lương thời gian = [Lương cơ bản] ÷ [Công chuẩn của tháng] × [Ngày công thực tế]
//
// Mỗi phần của công thức là một THẺ: đầu mục, tham số, dữ liệu tự động, số,
// dấu và ngoặc. Người dùng gõ chữ (không dấu cũng được) → danh sách gợi ý hiện
// ngay dưới ô; Enter / Tab chốt gợi ý đang chọn, dấu cách chốt khi gợi ý đã
// rõ (chỉ còn một kết quả hoặc gõ đúng tên), gõ + − x * / : ( ) là thành dấu
// ngay. Backspace lùi từng thẻ, ← → đi qua các thẻ, bấm vào một thẻ để đổi.
//
// Công thức lưu dạng chuỗi mã — đổi tên tham số / đầu mục không làm vỡ công
// thức, và bộ đánh giá công thức dùng nguyên như trước.
// ============================================================================

import {
  useEffect, useId, useMemo, useRef, useState,
  type ClipboardEvent, type KeyboardEvent, type MouseEvent, type ReactNode,
} from 'react';
import { CheckCircle2, CornerDownLeft, PenLine, TriangleAlert } from 'lucide-react';
import {
  ENTRY_GROUP_LABEL, OP_DISPLAY, describeFormula, formatFormulaLiteral, formatFormulaNumber, formulaIssueOf, groupEntries,
  normalizeText, parseLooseFormula, parseLooseNumber, previewFormula, renderFormulaWithValues, searchEntries,
  serializeFormula, tokenizeFormula,
  type FormulaEntry, type FormulaOp, type FormulaToken,
} from '@/lib/formulaTokens';
import type { FormulaFunctions } from '@/lib/payrollFormula';

interface FormulaInputProps {
  /** Công thức dạng chuỗi mã — thứ được lưu. */
  value: string;
  onChange: (formula: string) => void;
  /** Mọi thứ gõ được: đầu mục, tham số, dữ liệu tự động, hàm. */
  entries: readonly FormulaEntry[];
  /** Giá trị thử của mọi mã, để kiểm tra và tính thử ngay khi gõ. */
  scope: Readonly<Record<string, number>>;
  functions?: FormulaFunctions;
  /** Vế trái của công thức: tên dòng đang khai. */
  leftLabel?: string;
  ariaLabel?: string;
  /** Chọn một đầu mục chưa có trong cơ chế → người gọi thêm dòng. */
  onAddEntry?: (entry: FormulaEntry) => void;
  /** Mã có trong danh mục nhưng chưa có trong cơ chế — tính bằng 0, tô vàng. */
  softCodes?: ReadonlySet<string>;
  formatResult?: (value: number) => string;
  disabled?: boolean;
  autoFocus?: boolean;
  /** Chỉ ghi kết quả cuối một lần (không viết lại từng số thế vào); công thức chỉ là một con số thì không ghi gì thêm. */
  resultOnly?: boolean;
  /** Nội dung nằm trong ô, sát mép phải (ví dụ nhãn "theo tháng"). */
  trailing?: ReactNode;
  /** Bỏ hàng nút dấu và hướng dẫn dưới ô — chỉ còn ô nhập và kết quả. */
  compact?: boolean;
  /** Chữ mờ khi ô trống. */
  placeholder?: string;
}

const OPERAND_END = new Set<FormulaToken['kind']>(['ref', 'num', 'rparen', 'unknown']);

const CHIP_TONE: Record<string, string> = {
  ROW: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
  PARAM: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  SYSTEM: 'bg-amber-50 text-amber-800 ring-amber-200',
  TIER: 'bg-violet-50 text-violet-700 ring-violet-200',
  FUNCTION: 'bg-violet-50 text-violet-700 ring-violet-200',
  CATALOG: 'bg-slate-100 text-slate-600 ring-slate-300 ring-dashed',
};

const GROUP_DOT: Record<string, string> = {
  ROW: 'bg-indigo-500', PARAM: 'bg-emerald-500', SYSTEM: 'bg-amber-500', TIER: 'bg-violet-500',
  FUNCTION: 'bg-violet-500', CATALOG: 'bg-slate-400',
};

/** Cặp ngoặc: chỉ số thẻ mở ↔ thẻ đóng (thẻ hàm tính là ngoặc mở). */
function matchParens(tokens: readonly FormulaToken[]): Map<number, number> {
  const pairs = new Map<number, number>();
  const stack: number[] = [];
  tokens.forEach((token, index) => {
    if (token.kind === 'lparen' || token.kind === 'fn') stack.push(index);
    if (token.kind === 'rparen') {
      const open = stack.pop();
      if (open !== undefined) {
        pairs.set(open, index);
        pairs.set(index, open);
      }
    }
  });
  return pairs;
}

export function FormulaInput({
  value, onChange, entries, scope, functions = {}, leftLabel, ariaLabel, onAddEntry, softCodes,
  formatResult = formatFormulaNumber, disabled = false, autoFocus = false, resultOnly = false, trailing, compact = false, placeholder,
}: FormulaInputProps) {
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const lastEmitted = useRef(value);

  const [tokens, setTokens] = useState<FormulaToken[]>(() => tokenizeFormula(value));
  const [caret, setCaret] = useState(() => tokenizeFormula(value).length);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  /** Thẻ đã bấm Backspace một lần — bấm lần nữa mới xoá. */
  const [armed, setArmed] = useState<number | null>(null);
  const [focused, setFocused] = useState(false);
  const [textMode, setTextMode] = useState(false);
  const [textDraft, setTextDraft] = useState('');

  // Công thức đổi từ bên ngoài (nạp lại, chọn dòng khác) thì dựng lại thẻ.
  useEffect(() => {
    if (value === lastEmitted.current) return;
    const next = tokenizeFormula(value);
    lastEmitted.current = value;
    setTokens(next);
    setCaret(next.length);
    setQuery('');
    setArmed(null);
  }, [value]);

  const entryByCode = useMemo(() => new Map(entries.map((entry) => [entry.code, entry])), [entries]);
  const nameOf = (code: string) => entryByCode.get(code)?.name;

  const commit = (next: FormulaToken[], nextCaret: number) => {
    setTokens(next);
    setCaret(Math.max(0, Math.min(nextCaret, next.length)));
    setArmed(null);
    const text = serializeFormula(next);
    lastEmitted.current = text;
    onChange(text);
  };

  const insert = (added: FormulaToken[], caretShift = added.length, base = tokens, at = caret) => {
    const next = [...base.slice(0, at), ...added, ...base.slice(at)];
    commit(next, at + caretShift);
    return next;
  };

  // ---- Gợi ý ---------------------------------------------------------------
  const results = useMemo(() => {
    if (query.trim()) return searchEntries(entries, query, 40);
    return open ? [...entries] : [];
  }, [entries, open, query]);
  const groups = useMemo(() => groupEntries(results), [results]);
  const flat = useMemo(() => groups.flatMap((group) => group.items), [groups]);
  const showList = open && !disabled && flat.length > 0;
  const safeActive = Math.min(active, Math.max(flat.length - 1, 0));

  const tokenForEntry = (entry: FormulaEntry): FormulaToken[] => (entry.isFunction
    ? [{ kind: 'fn', code: entry.code }, { kind: 'rparen' }]
    : [{ kind: 'ref', code: entry.code }]);

  const choose = (entry: FormulaEntry, base = tokens, at = caret) => {
    if (entry.group === 'CATALOG') onAddEntry?.(entry);
    const added = tokenForEntry(entry);
    setQuery('');
    setOpen(false);
    setActive(0);
    // Hàm: con trỏ đứng giữa hai ngoặc để gõ tiếp đối số.
    return insert(added, entry.isFunction ? 1 : added.length, base, at);
  };

  /** Chốt chữ đang gõ thành một thẻ. Trả về mảng thẻ mới (để thao tác tiếp ngay). */
  const commitQuery = (mode: 'best' | 'strict' = 'best'): { tokens: FormulaToken[]; caret: number } | null => {
    const text = query.trim();
    if (!text) return null;
    const number = parseLooseNumber(text);
    if (number != null) {
      const next = insert([{ kind: 'num', value: number }]);
      setQuery('');
      return { tokens: next, caret: caret + 1 };
    }
    const exact = flat.find((entry) => normalizeText(entry.name) === normalizeText(text) || entry.code === text.toUpperCase());
    const pick = exact ?? (mode === 'best' ? flat[safeActive] ?? flat[0] : flat.length === 1 ? flat[0] : undefined);
    if (pick) {
      const next = choose(pick);
      return { tokens: next, caret: caret + (pick.isFunction ? 1 : 1) };
    }
    const next = insert([{ kind: 'unknown', text }]);
    setQuery('');
    setOpen(false);
    return { tokens: next, caret: caret + 1 };
  };

  // ---- Dấu ----------------------------------------------------------------
  const insertOperator = (op: FormulaOp | '(' | ')' | ',') => {
    let base = tokens;
    let at = caret;
    if (query.trim()) {
      // Gõ "(" ngay sau tên hàm → mở lời gọi hàm.
      if (op === '(') {
        const fn = flat.find((entry) => entry.isFunction);
        if (fn && (flat.length === 1 || normalizeText(fn.name) === normalizeText(query))) {
          choose(fn);
          return;
        }
      }
      const done = commitQuery('best');
      if (done) { base = done.tokens; at = done.caret; }
    }
    const previous = base[at - 1];
    if (op === '(') { insert([{ kind: 'lparen' }], 1, base, at); return; }
    if (op === ')') { insert([{ kind: 'rparen' }], 1, base, at); return; }
    if (op === ',') { insert([{ kind: 'comma' }], 1, base, at); return; }
    // Ghép dấu hai ký tự: > rồi = thành ≥, ! rồi = thành ≠…
    if (previous?.kind === 'op') {
      const merged = `${previous.op}${op}`;
      if (merged === '>=' || merged === '<=' || merged === '!=' || merged === '==') {
        const next = [...base.slice(0, at - 1), { kind: 'op', op: merged } as FormulaToken, ...base.slice(at)];
        commit(next, at);
        return;
      }
    }
    insert([{ kind: 'op', op }], 1, base, at);
  };

  const deleteAt = (index: number) => {
    if (index < 0 || index >= tokens.length) return;
    const next = tokens.filter((_, i) => i !== index);
    commit(next, index <= caret - 1 ? caret - 1 : caret);
  };

  // ---- Bàn phím -----------------------------------------------------------
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (disabled) return;
    const key = event.key;
    const empty = query === '';
    const previous = tokens[caret - 1];
    const afterOperand = !!previous && OPERAND_END.has(previous.kind);

    if (key === 'ArrowDown') {
      event.preventDefault();
      if (!open) { setOpen(true); setActive(0); return; }
      setActive((current) => Math.min(current + 1, Math.max(flat.length - 1, 0)));
      return;
    }
    if (key === 'ArrowUp') {
      if (!open) return;
      event.preventDefault();
      setActive((current) => Math.max(current - 1, 0));
      return;
    }
    if (key === 'Escape') {
      if (open || query) {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        setQuery('');
      }
      return;
    }
    if (key === 'Enter') {
      event.preventDefault();
      if (showList && flat[safeActive]) { choose(flat[safeActive]); return; }
      if (!empty) commitQuery('best');
      return;
    }
    if (key === 'Tab') {
      if (!empty) {
        event.preventDefault();
        if (showList && flat[safeActive]) choose(flat[safeActive]);
        else commitQuery('best');
      }
      return;
    }
    if (key === ' ') {
      if (empty) { event.preventDefault(); return; }
      const number = parseLooseNumber(query);
      if (number != null) { event.preventDefault(); commitQuery('strict'); return; }
      const exact = flat.find((entry) => normalizeText(entry.name) === normalizeText(query));
      if (exact || flat.length === 1) {
        event.preventDefault();
        choose(exact ?? flat[0]);
      }
      // Còn nhiều gợi ý: dấu cách là để gõ tiếp tên nhiều chữ.
      return;
    }
    if (key === 'Backspace' && empty) {
      event.preventDefault();
      if (caret === 0) return;
      const index = caret - 1;
      const token = tokens[index];
      if (token.kind === 'num') {
        const rest = token.value.slice(0, -1);
        const next = tokens.filter((_, i) => i !== index);
        commit(next, index);
        setQuery(rest === '-' ? '' : rest);
        return;
      }
      if (token.kind === 'ref' || token.kind === 'fn' || token.kind === 'unknown') {
        if (armed === index) deleteAt(index);
        else setArmed(index);
        return;
      }
      deleteAt(index);
      return;
    }
    if (key === 'Delete' && empty) {
      event.preventDefault();
      deleteAt(caret);
      return;
    }
    if (key === 'ArrowLeft' && empty) {
      event.preventDefault();
      setArmed(null);
      setCaret((current) => Math.max(0, current - 1));
      return;
    }
    if (key === 'ArrowRight' && empty) {
      event.preventDefault();
      setArmed(null);
      setCaret((current) => Math.min(tokens.length, current + 1));
      return;
    }
    if ((key === 'Home' || key === 'End') && empty) {
      event.preventDefault();
      setCaret(key === 'Home' ? 0 : tokens.length);
      return;
    }

    // Dấu phép tính và ngoặc.
    const operatorMap: Record<string, FormulaOp | '(' | ')' | ','> = {
      '+': '+', '-': '-', '*': '*', '/': '/', ':': '/', '(': '(', ')': ')', ',': ',', ';': ',',
      '>': '>', '<': '<', '=': '==', '!': '!', '&': '&&', '|': '||', '?': '?',
    };
    if (key === '%') {
      event.preventDefault();
      if (parseLooseNumber(query) != null) {
        const number = parseLooseNumber(`${query}%`);
        if (number != null) {
          insert([{ kind: 'num', value: number }]);
          setQuery('');
        }
      }
      return;
    }
    // "x" là dấu nhân khi đứng ngay sau một số hạng; còn lại là chữ của tên ("xăng xe").
    if ((key === 'x' || key === 'X') && empty && afterOperand) {
      event.preventDefault();
      insertOperator('*');
      return;
    }
    // ":" đứng ngay sau một số cũng là dấu chia; "," giữa hai chữ số là dấu thập phân.
    if (key === ',' && /\d$/.test(query)) return;
    const mapped = operatorMap[key];
    if (mapped) {
      event.preventDefault();
      // "=" ngay sau > < ! thì ghép thành ≥ ≤ ≠.
      if (key === '=' && empty && previous?.kind === 'op' && ['>', '<', '!', '=='].includes(previous.op)) {
        const merged = (previous.op === '==' ? '==' : `${previous.op}=`) as FormulaOp;
        commit([...tokens.slice(0, caret - 1), { kind: 'op', op: merged }, ...tokens.slice(caret)], caret);
        return;
      }
      insertOperator(mapped);
    }
  };

  const onPaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const text = event.clipboardData.getData('text');
    // Một chữ đơn thì để vào ô gõ như bình thường, gợi ý tự hiện.
    if (!/[+\-*/×÷:()%;,]/.test(text) && !/\s/.test(text.trim())) return;
    event.preventDefault();
    const parsed = parseLooseFormula(text, entries);
    insert(parsed);
    setQuery('');
  };

  const onBlurCapture = () => {
    // Đợi focus chuyển xong: bấm vào gợi ý không tính là rời ô.
    requestAnimationFrame(() => {
      if (boxRef.current?.contains(document.activeElement)) return;
      setFocused(false);
      setOpen(false);
      setArmed(null);
      if (query.trim()) commitQuery('strict');
    });
  };

  const focusInput = (event?: MouseEvent) => {
    if (disabled) return;
    if (event && event.target !== event.currentTarget) return;
    setCaret(tokens.length);
    inputRef.current?.focus();
  };

  const editToken = (index: number) => {
    if (disabled) return;
    const token = tokens[index];
    if (token.kind === 'ref' || token.kind === 'unknown') {
      const text = token.kind === 'ref' ? nameOf(token.code) ?? token.code : token.text;
      const next = tokens.filter((_, i) => i !== index);
      commit(next, index);
      setQuery(text);
      setOpen(true);
      setActive(0);
    } else if (token.kind === 'num') {
      const next = tokens.filter((_, i) => i !== index);
      commit(next, index);
      setQuery(formatFormulaLiteral(Number(token.value)));
    } else {
      setCaret(index + 1);
    }
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  // ---- Kiểm tra & tính thử -------------------------------------------------
  const issue = useMemo(
    () => formulaIssueOf(tokens, scope, functions, (code) => entryByCode.get(code)?.name),
    [entryByCode, functions, scope, tokens],
  );
  const result = useMemo(() => (issue ? null : previewFormula(tokens, scope, functions)), [functions, issue, scope, tokens]);
  const rendered = useMemo(
    () => (result == null ? '' : renderFormulaWithValues(serializeFormula(tokens), scope, (code) => entryByCode.get(code)?.name)),
    [entryByCode, result, scope, tokens],
  );
  const pairs = useMemo(() => matchParens(tokens), [tokens]);
  const highlightParens = new Set<number>();
  for (const index of [caret - 1, caret]) {
    const token = tokens[index];
    if (!token || (token.kind !== 'lparen' && token.kind !== 'rparen' && token.kind !== 'fn')) continue;
    highlightParens.add(index);
    const partner = pairs.get(index);
    if (partner !== undefined) highlightParens.add(partner);
  }
  const softRefs = tokens.filter((token): token is { kind: 'ref'; code: string } => token.kind === 'ref' && !!softCodes?.has(token.code));

  // ---- Vẽ -----------------------------------------------------------------
  const renderToken = (token: FormulaToken, index: number) => {
    const isError = issue?.tokenIndex === index;
    const ring = armed === index ? 'ring-2 ring-red-500 bg-red-50' : isError ? 'ring-2 ring-red-400' : '';
    const common = `cursor-pointer select-none rounded-md transition ${ring}`;
    if (token.kind === 'ref' || token.kind === 'fn') {
      const entry = entryByCode.get(token.code);
      const soft = token.kind === 'ref' && softCodes?.has(token.code);
      const tone = !entry ? 'bg-red-50 text-red-700 ring-red-300' : soft ? CHIP_TONE.CATALOG : CHIP_TONE[entry.group];
      return (
        <span
          key={index}
          role="button"
          tabIndex={-1}
          onMouseDown={(event) => { event.preventDefault(); editToken(index); }}
          title={entry ? `${entry.name}${entry.detail ? ` · ${entry.detail}` : ''}${soft ? ' — chưa có trong cơ chế, tính bằng 0' : ''}` : `Không có “${token.code}”`}
          className={`${common} inline-flex items-center px-1.5 py-0.5 text-xs font-semibold ring-1 ${tone} ${highlightParens.has(index) ? 'outline outline-2 outline-amber-300' : ''}`}
        >
          {entry?.name ?? token.code}{token.kind === 'fn' ? '(' : ''}
        </span>
      );
    }
    if (token.kind === 'num') {
      return (
        <span key={index} onMouseDown={(event) => { event.preventDefault(); editToken(index); }}
          className={`${common} px-0.5 font-mono text-sm font-semibold text-slate-800`}>
          {formatFormulaLiteral(Number(token.value))}
        </span>
      );
    }
    if (token.kind === 'unknown') {
      return (
        <span key={index} onMouseDown={(event) => { event.preventDefault(); editToken(index); }}
          title="Không khớp gì — bấm để sửa"
          className={`${common} px-1.5 py-0.5 text-xs font-semibold text-red-700 underline decoration-red-400 decoration-wavy ring-1 ring-red-300`}>
          {token.text}
        </span>
      );
    }
    const text = token.kind === 'op' ? OP_DISPLAY[token.op] : token.kind === 'lparen' ? '(' : token.kind === 'rparen' ? ')' : ';';
    const paren = token.kind === 'lparen' || token.kind === 'rparen';
    return (
      <span key={index} onMouseDown={(event) => { event.preventDefault(); editToken(index); }}
        className={`${common} px-0.5 text-base leading-none ${paren ? 'font-bold text-slate-600' : 'font-semibold text-slate-400'} ${highlightParens.has(index) ? 'bg-amber-100 text-amber-800' : ''}`}>
        {text}
      </span>
    );
  };

  const optionId = (index: number) => `${listId}-opt-${index}`;
  let optionIndex = -1;

  const applyText = () => {
    const parsed = parseLooseFormula(textDraft, entries);
    commit(parsed, parsed.length);
    setTextMode(false);
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-start gap-2">
        {leftLabel && (
          <span className="mt-2.5 shrink-0 text-sm font-black text-slate-900 dark:text-slate-100">
            {leftLabel} <span className="text-slate-400 font-black">=</span>
          </span>
        )}
        <div ref={boxRef} className="relative min-w-0 flex-1" onBlurCapture={onBlurCapture}>
          {textMode ? (
            <div className="space-y-2">
              <textarea
                value={textDraft}
                onChange={(event) => setTextDraft(event.target.value)}
                rows={2}
                autoFocus
                aria-label={ariaLabel ?? 'Công thức dạng chữ'}
                className="w-full rounded-xl border-2 border-indigo-400 dark:border-indigo-500 bg-white dark:bg-slate-800 px-3 py-2 text-sm font-semibold text-slate-900 dark:text-slate-100 outline-none focus:ring-2 focus:ring-indigo-500/20"
              />
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <button type="button" onClick={applyText}
                  className="rounded-lg bg-indigo-600 px-3 py-1.5 font-bold text-white hover:bg-indigo-700">
                  Dùng công thức này
                </button>
                <button type="button" onClick={() => setTextMode(false)}
                  className="rounded-lg px-3 py-1.5 font-semibold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
                  Huỷ
                </button>
                <span className="text-slate-500 dark:text-slate-400">Gõ tên đầu mục / tham số, dấu + − × ÷ và ngoặc; ngăn đối số của hàm bằng “;”.</span>
              </div>
            </div>
          ) : (
            <div
              onMouseDown={focusInput}
              className={`flex min-h-11 flex-wrap items-center gap-x-1 gap-y-1.5 rounded-xl border-2 bg-white dark:bg-slate-800 px-2.5 py-2 transition ${
                disabled ? 'cursor-not-allowed bg-slate-50 dark:bg-slate-900/50' : 'cursor-text'
              } ${issue && tokens.length > 0 ? 'border-red-400 dark:border-red-500' : focused ? 'border-indigo-500 ring-4 ring-indigo-500/10' : 'border-slate-300 dark:border-slate-600 hover:border-slate-400 dark:hover:border-slate-500'}`}
            >
              {tokens.slice(0, caret).map((token, i) => renderToken(token, i))}
              <input
                ref={inputRef}
                value={query}
                disabled={disabled}
                autoFocus={autoFocus}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setOpen(event.target.value.trim().length > 0);
                  setActive(0);
                  setArmed(null);
                }}
                onKeyDown={onKeyDown}
                onPaste={onPaste}
                onFocus={() => setFocused(true)}
                size={Math.max(query.length + 1, tokens.length === 0 ? 28 : 2)}
                placeholder={tokens.length === 0 ? placeholder ?? 'Gõ tên đầu mục, tham số…' : ''}
                role="combobox"
                aria-label={ariaLabel ?? (leftLabel ? `Công thức ${leftLabel}` : 'Công thức')}
                aria-expanded={showList}
                aria-controls={listId}
                aria-autocomplete="list"
                aria-activedescendant={showList ? optionId(safeActive) : undefined}
                className="min-w-[2ch] flex-1 bg-transparent py-0.5 text-sm text-slate-800 outline-none placeholder:text-slate-400"
              />
              {tokens.slice(caret).map((token, i) => renderToken(token, caret + i))}
              {trailing && <span className="ml-auto shrink-0 pl-2">{trailing}</span>}
            </div>
          )}

          {showList && !textMode && (
            <div
              id={listId}
              role="listbox"
              className="absolute left-0 right-0 top-full z-40 mt-1 max-h-72 overflow-y-auto rounded-xl border border-slate-200 bg-white py-1 shadow-xl shadow-slate-900/10"
            >
              {groups.map((group) => (
                <div key={group.group} role="group" aria-label={ENTRY_GROUP_LABEL[group.group]}>
                  <p className="sticky top-0 bg-white/95 px-3 pb-1 pt-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    {ENTRY_GROUP_LABEL[group.group]}
                  </p>
                  {group.items.map((entry) => {
                    optionIndex += 1;
                    const index = optionIndex;
                    const selected = index === safeActive;
                    return (
                      <div
                        key={`${entry.group}-${entry.code}`}
                        id={optionId(index)}
                        role="option"
                        aria-selected={selected}
                        onMouseDown={(event) => { event.preventDefault(); choose(entry); }}
                        onMouseEnter={() => setActive(index)}
                        className={`flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm ${selected ? 'bg-indigo-50' : 'hover:bg-slate-50'}`}
                      >
                        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${GROUP_DOT[entry.group]}`} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-semibold text-slate-800">
                            {entry.name}{entry.isFunction ? '( )' : ''}
                          </span>
                          {(entry.section || entry.hint) && (
                            <span className="block truncate text-[11px] text-slate-400">{entry.section ? `Bảng ${entry.section}` : entry.hint}</span>
                          )}
                        </span>
                        {entry.detail && <span className="shrink-0 text-xs tabular-nums text-slate-500">{entry.detail}</span>}
                        {selected && <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-indigo-400" />}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
          {open && !textMode && query.trim() && flat.length === 0 && !/^[\d\s.,%-]+$/.test(query.trim()) && (
            <div className="absolute left-0 right-0 top-full z-40 mt-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-500 shadow-xl">
              Không có gì khớp “{query.trim()}”. Thêm tham số ở trang Tham số lương hoặc đầu mục ở Danh mục.
            </div>
          )}
        </div>
      </div>

      {!textMode && (
        <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 ${leftLabel ? 'sm:pl-1' : ''}`}>
          {tokens.length === 0 ? (compact ? null : (
            <p className="text-xs text-slate-400">
              Gõ tên để chọn · <kbd className="rounded bg-slate-100 px-1 font-sans">Enter</kbd> chốt gợi ý · gõ + − x : ( ) để thêm dấu
            </p>
          )) : issue ? (
            <p role="alert" className="flex items-start gap-1.5 text-xs font-medium text-red-600">
              <TriangleAlert className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" /> {issue.message}
            </p>
          ) : result != null && resultOnly ? (
            tokens.length === 1 && tokens[0].kind === 'num' ? null : (
              <p className="flex min-w-0 items-center gap-1.5 text-sm text-emerald-700">
                <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0" />
                = <strong className="tabular-nums">{formatResult(result)}</strong>
              </p>
            )
          ) : result != null ? (
            <p className="flex min-w-0 items-start gap-1.5 text-xs text-emerald-700">
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
              <span className="min-w-0 break-words">
                <span className="text-slate-500">{rendered} =</span> <strong className="tabular-nums">{formatResult(result)}</strong>
              </span>
            </p>
          ) : null}
          {softRefs.length > 0 && !issue && (
            <p className="text-xs text-amber-700">
              {[...new Set(softRefs.map((token) => nameOf(token.code) ?? token.code))].join(', ')} chưa có trong cơ chế — đang tính bằng 0.
            </p>
          )}
          {!disabled && (!compact || focused) && (
            <div className="ml-auto flex items-center gap-1">
              {(['+', '-', '*', '/', '(', ')'] as const).map((op) => (
                <button
                  key={op}
                  type="button"
                  tabIndex={-1}
                  onMouseDown={(event) => { event.preventDefault(); insertOperator(op); inputRef.current?.focus(); }}
                  className="h-7 min-w-7 rounded-md border border-slate-200 bg-white px-1.5 text-sm font-semibold text-slate-500 hover:border-indigo-300 hover:text-indigo-700"
                  aria-label={`Chèn ${op === '(' ? 'mở ngoặc' : op === ')' ? 'đóng ngoặc' : OP_DISPLAY[op as FormulaOp]}`}
                >
                  {op === '(' || op === ')' ? op : OP_DISPLAY[op as FormulaOp]}
                </button>
              ))}
              <button
                type="button"
                onClick={() => { setTextDraft(describeFormula(serializeFormula(tokens), (code) => entryByCode.get(code)?.name)); setTextMode(true); }}
                className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11px] font-semibold text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                title="Sửa cả công thức dạng chữ"
              >
                <PenLine className="h-3.5 w-3.5" /> Dạng chữ
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
