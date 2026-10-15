// ============================================================================
// Ô nhập số: bấm vào là bôi đen sẵn nội dung.
// ----------------------------------------------------------------------------
// Ô số hay mang sẵn "0" (mặc định của form, hoặc giá trị đã lưu). Con trỏ rơi
// vào cuối ô nên gõ "5" ra "05" và người dùng phải tự xoá số 0 trước. Bôi đen
// sẵn thì gõ gì là thay luôn số cũ — kể cả ô đang trống cũng không ảnh hưởng.
//
// Đặt MỘT lần ở cấp tài liệu để phủ mọi trang, kể cả các ô <input> viết tay
// không đi qua component Input dùng chung.
// ============================================================================

const NUMERIC_INPUT_MODES = new Set(['numeric', 'decimal']);

function isNumericField(target: EventTarget | null): target is HTMLInputElement {
  if (!(target instanceof HTMLInputElement)) return false;
  if (target.readOnly || target.disabled) return false;
  return target.type === 'number'
    || (target.type === 'text' && NUMERIC_INPUT_MODES.has(target.inputMode));
}

/** Bỏ các số 0 đứng đầu của một chuỗi số ("007" → "7", "0,5" và "0.5" giữ nguyên). */
export function stripLeadingZeros(raw: string): string {
  return raw.replace(/^(-?)0+(?=\d)/, '$1');
}

let installed = false;

export function installNumericSelectOnFocus(): void {
  if (installed || typeof document === 'undefined') return;
  installed = true;

  document.addEventListener('focusin', (event) => {
    const field = event.target;
    if (!isNumericField(field) || field.value === '') return;
    field.select();
    // Chuột nhả ra sau khi focus sẽ đặt lại con trỏ và làm mất vùng bôi đen —
    // chặn đúng một lần mouseup đó.
    const keepSelection = (up: Event) => up.preventDefault();
    field.addEventListener('mouseup', keepSelection, { once: true });
    window.setTimeout(() => field.removeEventListener('mouseup', keepSelection), 400);
  });
}
