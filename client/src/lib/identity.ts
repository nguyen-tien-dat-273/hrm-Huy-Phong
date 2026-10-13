// ============================================================================
// Định danh đăng nhập: tên đăng nhập HOẶC email.
// ----------------------------------------------------------------------------
// Supabase Auth luôn định danh người dùng bằng email. Để admin cấp tài khoản mà
// không cần hộp thư thật cho từng nhân viên, tên đăng nhập được ánh xạ sang một
// email nội bộ `<username>@ppms.local` — địa chỉ này không tồn tại và không bao
// giờ nhận được thư. Tài khoản kiểu này khi quên mật khẩu thì admin cấp lại
// mật khẩu tạm.
//
// Logic này được lặp lại trong api/admin-users.ts —
// sửa một bên thì phải sửa bên kia.
// ============================================================================

/**
 * Domain nội bộ cho tài khoản chỉ có tên đăng nhập.
 *
 * ⚠️ KHÔNG ĐỔI GIÁ TRỊ NÀY THEO TÊN THƯƠNG HIỆU.
 *
 * Đây không phải nhãn hiển thị mà là một phần ĐỊNH DANH ĐĂNG NHẬP đã ghi vào
 * `auth.users.email` của mọi tài khoản kiểu tên đăng nhập. Đổi thành
 * `huyphong.local` sẽ khiến `toAuthEmail('nguyenvana')` trả về một email không
 * tồn tại trong database — toàn bộ những người dùng đó lập tức không đăng nhập
 * được, mà thông báo lỗi chỉ là "sai tên đăng nhập hoặc mật khẩu".
 *
 * Muốn đổi thật thì phải chạy kèm một migration cập nhật email trong
 * `auth.users` và `profiles`, không phải sửa mỗi dòng này.
 *
 * (Vẫn cần đổi nếu Supabase project từ chối domain `.local` — nhưng khi đó
 * cũng phải di trú dữ liệu như trên.)
 */
export const INTERNAL_EMAIL_DOMAIN = 'ppms.local';

const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,31}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function looksLikeEmail(input: string): boolean {
  return input.includes('@');
}

/** Email nội bộ = tài khoản không có hộp thư thật. */
export function isInternalEmail(email: string): boolean {
  return email.toLowerCase().endsWith(`@${INTERNAL_EMAIL_DOMAIN}`);
}

/**
 * Chuyển thứ người dùng gõ vào thành email dùng cho Supabase Auth.
 * `nguyenvana` -> `nguyenvana@ppms.local`, `a@b.com` -> `a@b.com`
 */
export function toAuthEmail(input: string): string {
  const value = input.trim().toLowerCase();
  if (looksLikeEmail(value)) return value;
  return `${value}@${INTERNAL_EMAIL_DOMAIN}`;
}

/** Thứ nên hiển thị lại cho người dùng: tên đăng nhập, hoặc email nếu là email thật. */
export function displayIdentifier(email: string): string {
  if (!email) return '';
  return isInternalEmail(email) ? email.slice(0, email.lastIndexOf('@')) : email;
}

/** Kiểm tra định danh. Trả về lỗi, hoặc null nếu hợp lệ. */
export function validateIdentifier(input: string): string | null {
  const value = input.trim().toLowerCase();
  if (!value) return 'Vui lòng nhập tên đăng nhập hoặc email.';

  if (looksLikeEmail(value)) {
    if (!EMAIL_RE.test(value)) return 'Email không hợp lệ.';
    if (isInternalEmail(value)) return `Không dùng trực tiếp domain @${INTERNAL_EMAIL_DOMAIN}. Chỉ cần nhập tên đăng nhập.`;
    return null;
  }

  if (!USERNAME_RE.test(value)) {
    return 'Tên đăng nhập chỉ gồm chữ thường, số, dấu chấm, gạch ngang, gạch dưới; dài 3–32 ký tự và bắt đầu bằng chữ hoặc số.';
  }
  return null;
}
