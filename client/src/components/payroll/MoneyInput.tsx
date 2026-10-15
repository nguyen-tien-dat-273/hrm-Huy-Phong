// ============================================================================
// Ô nhập giá trị số của phân hệ lương.
// ----------------------------------------------------------------------------
// - Tiền (`money`): tự chia dấu "." mỗi 3 chữ số khi gõ. Gõ chữ số ĐẦU TIÊN thì
//   ô tự điền sẵn "000" phía sau và để con trỏ ngay sau số vừa gõ: gõ 5 ra
//   5.000, gõ tiếp 2 ra 52.000, 5 ra 525.000, 0 ra 5.250.000 — số tiền thường
//   là bội của nghìn nên không phải gõ lại ba số 0. Cần số lẻ thì xoá các số 0
//   phía sau (phím Delete hoặc Backspace), ô không tự điền lại giữa chừng.
// - Số thường (tỷ lệ, hệ số, số lượng…): giữ nguyên chữ đang gõ, "," là dấu thập phân.
//
// Ô giữ CHUỖI khi đang gõ: ép về số mỗi lần gõ thì xoá hết ô là nhảy về 0 và
// không gõ tiếp được.
// ============================================================================

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { stripLeadingZeros } from '@/lib/numericFocus';

const GROUPED = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 6 });

/** Chia nhóm hàng nghìn cho phần nguyên, giữ nguyên phần thập phân đang gõ. */
function groupDigits(raw: string): string {
  const negative = raw.startsWith('-');
  const body = raw.replace(/[^\d,]/g, '');
  const comma = body.indexOf(',');
  const integer = (comma < 0 ? body : body.slice(0, comma)).replace(/^0+(?=\d)/, '');
  const decimal = comma < 0 ? null : body.slice(comma + 1).replace(/,/g, '');
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${negative ? '-' : ''}${grouped}${decimal === null ? '' : `,${decimal}`}`;
}

function parseText(text: string, money: boolean): number {
  const trimmed = text.trim();
  if (trimmed === '' || trimmed === '-') return Number.NaN;
  if (money) return Number(trimmed.replace(/\./g, '').replace(',', '.'));
  const normalized = /^\d{1,3}(\.\d{3})+$/.test(trimmed) ? trimmed.replace(/\./g, '') : trimmed.replace(',', '.');
  return Number(normalized);
}

function textOf(value: number, money: boolean): string {
  if (!Number.isFinite(value)) return '';
  return money ? GROUPED.format(value) : String(value).replace('.', ',');
}

const digitsOf = (text: string) => text.replace(/\D/g, '');

interface MoneyInputProps {
  value: number;
  onChange: (value: number) => void;
  /** Giá trị là tiền: chia dấu "." hàng nghìn và tự điền sẵn 000 khi gõ số đầu. */
  money?: boolean;
  disabled?: boolean;
  invalid?: boolean;
  /** Cỡ ô cao bằng ô nhập của form (còn lại là cỡ ô trong bảng). */
  large?: boolean;
  placeholder?: string;
  'aria-label'?: string;
  className?: string;
}

export function MoneyInput({
  value, onChange, money = false, disabled = false, invalid = false, large = false, placeholder, className = '', ...rest
}: MoneyInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(() => textOf(value, money));
  /** Số chữ số nằm trước con trỏ — để giữ con trỏ đúng chỗ sau khi chen dấu ".". */
  const caretDigits = useRef<number | null>(null);
  const [tick, setTick] = useState(0);

  // Giá trị đổi từ bên ngoài (nạp lại, đổi bộ) thì dựng lại chữ; đang gõ dở thì giữ.
  useEffect(() => {
    setText((current) => {
      const parsed = parseText(current, money);
      if (current.trim() !== '' && parsed === value) return current;
      return textOf(value, money);
    });
  }, [value, money]);

  useLayoutEffect(() => {
    const input = inputRef.current;
    const digits = caretDigits.current;
    if (!input || digits === null) return;
    caretDigits.current = null;
    let seen = 0;
    let position = 0;
    while (position < text.length && seen < digits) {
      if (/\d/.test(text[position])) seen += 1;
      position += 1;
    }
    input.setSelectionRange(position, position);
  }, [text, tick]);

  const commit = (next: string) => {
    setText(next);
    setTick((current) => current + 1);
    onChange(parseText(next, money));
  };

  const handleMoneyChange = (input: HTMLInputElement, inputType: string) => {
    const raw = input.value;
    const caret = input.selectionStart ?? raw.length;
    const negative = raw.trim().startsWith('-');
    let body = raw.replace(/[^\d,]/g, '');
    const comma = body.indexOf(',');
    let digitsBefore = digitsOf(raw.slice(0, caret)).length;

    if (comma < 0) {
      const previous = digitsOf(text);
      // Xoá trúng một dấu "." thì số không đổi: xoá luôn chữ số kề bên cho người dùng thấy ô chạy.
      if (inputType.startsWith('delete') && body.length === previous.length && body.length > 0) {
        const index = inputType === 'deleteContentForward' ? digitsBefore : digitsBefore - 1;
        if (index >= 0 && index < body.length) {
          body = body.slice(0, index) + body.slice(index + 1);
          digitsBefore = index;
        }
      }
      body = body.replace(/^0+(?=\d)/, '');
      digitsBefore = Math.min(digitsBefore, body.length);
      // Chữ số đầu tiên vừa gõ vào ô trống: điền sẵn 000 phía sau, con trỏ đứng trước ba số 0.
      if (inputType === 'insertText' && /^[1-9]$/.test(body)) body += '000';
    }
    caretDigits.current = digitsBefore;
    commit(groupDigits(`${negative ? '-' : ''}${body}`));
  };

  return (
    <input
      ref={inputRef}
      inputMode="decimal"
      value={text}
      disabled={disabled}
      placeholder={placeholder}
      aria-label={rest['aria-label']}
      aria-invalid={invalid}
      onChange={(event) => {
        const input = event.target;
        if (money) {
          handleMoneyChange(input, (event.nativeEvent as InputEvent).inputType ?? '');
        } else {
          commit(stripLeadingZeros(input.value.replace(/[^\d.,-]/g, '')));
        }
      }}
      className={`w-full border bg-white text-right font-mono text-sm tabular-nums outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/15 disabled:bg-slate-50 disabled:text-slate-500 ${
        large ? 'h-11 rounded-xl px-3.5 shadow-sm' : 'h-9 rounded-lg px-2.5'
      } ${invalid ? 'border-red-300' : 'border-slate-200 hover:border-slate-300'} ${className}`}
    />
  );
}

/** Đơn vị tiền — ô giá trị được chia dấu "." và tự điền sẵn 000. */
export const isMoneyUnit = (unit: string | null | undefined) => !!unit && unit.startsWith('VND');
