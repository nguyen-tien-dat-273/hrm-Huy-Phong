// ============================================================================
// Xác thực lại cho các thao tác lương nhạy cảm.
// ----------------------------------------------------------------------------
// Ba chỗ trong M06 đòi người dùng chứng minh lại mình là ai NGAY LÚC thao tác,
// không chỉ "đang đăng nhập":
//
//   * KTT khoá kỳ lương bằng mã 2FA (FR06.04.03) — mã TOTP từ ứng dụng xác
//     thực, do Supabase Auth MFA kiểm. Không phải công tắc giả: trang Cấu hình
//     từng có một công tắc 2FA không làm gì và đã bị gỡ vì nói dối về bảo mật.
//   * BGĐ ký duyệt cơ chế lương và lệnh chi (BR-PAY-010/012) — nhập lại mật
//     khẩu (hoặc mã TOTP nếu đã bật).
//   * Nhân viên mở chi tiết phiếu lương (FR06.04.05) — nhập lại mật khẩu.
//
// Hàng rào thật nằm ở database: RPC và policy kiểm `amr` trong JWT có mốc xác
// thực trong vài phút gần nhất (`payroll_recent_auth`). Màn hình chỉ làm việc
// lấy mốc đó. Ai lách giao diện gọi thẳng API cũng không qua.
//
// Về "sinh trắc học" của FR06.04.05: trên điện thoại, ô mật khẩu ở đây khai
// `autocomplete="current-password"` nên trình quản lý mật khẩu của hệ điều
// hành điền được sau khi xác thực vân tay / FaceID. Hệ thống không tự đọc vân
// tay — không có nhà cung cấp WebAuthn nào được cấu hình ở Supabase của dự án.
// ============================================================================

import { supabase } from './supabase';

/**
 * Xác thực lại bằng mật khẩu của CHÍNH tài khoản đang đăng nhập.
 *
 * Supabase không có API "kiểm tra mật khẩu" riêng, nên đăng nhập lại bằng
 * mật khẩu — cùng cách `changeOwnPassword` đang làm. Phiên mới cùng người
 * dùng, JWT mang mốc `amr` mới mà database đọc.
 */
export async function reauthenticateWithPassword(authEmail: string, password: string): Promise<string | null> {
  if (!supabase) return 'Chưa kết nối Supabase.';
  if (!password) return 'Nhập mật khẩu.';
  const { error } = await supabase.auth.signInWithPassword({
    email: authEmail.trim().toLowerCase(),
    password,
  });
  if (!error) return null;
  return /invalid login credentials/i.test(error.message) ? 'Mật khẩu không đúng.' : error.message;
}

export interface TotpFactor {
  id: string;
  friendlyName: string | null;
  status: 'verified' | 'unverified';
}

/** Ứng dụng xác thực đã đăng ký của người đang đăng nhập. */
export async function listTotpFactors(): Promise<{ factors: TotpFactor[]; error: string | null }> {
  if (!supabase) return { factors: [], error: 'Chưa kết nối Supabase.' };
  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error) return { factors: [], error: error.message };
  return {
    factors: (data?.all ?? [])
      .filter((factor) => factor.factor_type === 'totp')
      .map((factor) => ({
        id: factor.id,
        friendlyName: factor.friendly_name ?? null,
        status: factor.status === 'verified' ? 'verified' : 'unverified',
      })),
    error: null,
  };
}

export interface TotpEnrollment {
  factorId: string;
  /** Ảnh QR dạng data URL (SVG) để quét bằng ứng dụng xác thực. */
  qrCode: string;
  /** Mã bí mật để gõ tay nếu không quét được QR. */
  secret: string;
}

/** Bắt đầu đăng ký ứng dụng xác thực. Phải xác minh một mã thì mới có hiệu lực. */
export async function enrollTotp(friendlyName: string): Promise<{ enrollment: TotpEnrollment | null; error: string | null }> {
  if (!supabase) return { enrollment: null, error: 'Chưa kết nối Supabase.' };

  // Bỏ các lần đăng ký dở (chưa xác minh) để không vướng giới hạn số factor.
  const existing = await listTotpFactors();
  for (const factor of existing.factors.filter((item) => item.status === 'unverified')) {
    await supabase.auth.mfa.unenroll({ factorId: factor.id });
  }

  const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName });
  if (error || !data) {
    return {
      enrollment: null,
      error: /disabled|not enabled/i.test(error?.message ?? '')
        ? 'Dự án Supabase chưa bật MFA TOTP (Authentication → Multi-Factor). Bật lên rồi thử lại.'
        : error?.message ?? 'Không đăng ký được ứng dụng xác thực.',
    };
  }
  return {
    enrollment: { factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret },
    error: null,
  };
}

/**
 * Nhập mã 6 số từ ứng dụng xác thực. Đúng mã thì phiên lên mức `aal2` và
 * JWT có mốc `totp` mới — thứ `lock_payroll_run` đòi.
 */
export async function verifyTotp(factorId: string, code: string): Promise<string | null> {
  if (!supabase) return 'Chưa kết nối Supabase.';
  const clean = code.replace(/\s+/g, '');
  if (!/^\d{6}$/.test(clean)) return 'Mã xác thực gồm 6 chữ số.';
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: clean });
  if (!error) return null;
  return /invalid|expired/i.test(error.message)
    ? 'Mã OTP không đúng hoặc đã hết hạn — nhập lại mã đang hiện trên ứng dụng.'
    : error.message;
}
