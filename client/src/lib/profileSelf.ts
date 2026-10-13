// ============================================================================
// Hồ sơ cá nhân — nhân viên tự sửa thông tin của mình.
// ----------------------------------------------------------------------------
// Ghi thẳng vào `profiles`: policy giới hạn đúng dòng của mình, còn trigger
// `profile_privilege_changes_guard` chặn thay đổi vai trò, quyền, trạng thái,
// vị trí, đơn vị và các trường ảnh hưởng tới phân quyền.
//
// Ảnh đại diện nằm ở bucket `avatars`, đường dẫn LUÔN là `<user_id>/<file>` vì
// policy storage khoá quyền ghi theo đúng thư mục mang id của mình.
// ============================================================================

import { supabase } from './supabase';
import { describeDbError } from './dbError';
import { normalizeRecoveryPhone } from './auth';

/** Khớp `file_size_limit` của bucket trong migration 20260811160000. */
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;

/**
 * Khớp `allowed_mime_types` của bucket. KHÔNG có image/svg+xml: SVG chạy được
 * JavaScript trên domain của bạn.
 */
export const AVATAR_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

const AVATAR_BUCKET = 'avatars';

export interface SelfProfileInput {
  name: string;
  phone: string;
}

/** Số điện thoại phải khớp CHECK `profiles_phone_format` phía database. */
const PHONE_RE = /^[0-9+().\s-]{6,20}$/;

export function validateSelfProfile({ name, phone }: SelfProfileInput): string | null {
  if (!name.trim()) return 'Vui lòng nhập họ tên.';
  if (name.trim().length > 100) return 'Họ tên quá dài (tối đa 100 ký tự).';
  if (phone.trim() && !PHONE_RE.test(phone.trim())) {
    return 'Số điện thoại chỉ gồm chữ số và các ký tự + ( ) . - khoảng trắng, dài 6–20 ký tự.';
  }
  return null;
}

export async function updateOwnProfile(
  userId: string,
  { name, phone }: SelfProfileInput,
): Promise<{ error: string | null }> {
  const invalid = validateSelfProfile({ name, phone });
  if (invalid) return { error: invalid };

  const { error } = await supabase
    .from('profiles')
    .update({ name: name.trim(), phone: phone.trim() || null })
    .eq('id', userId);

  return { error: error ? describeDbError(error) : null };
}

export async function isOwnPhoneVerified(profilePhone: string): Promise<boolean> {
  const normalized = normalizeRecoveryPhone(profilePhone);
  if (!normalized) return false;
  const { data } = await supabase.auth.getUser();
  return !!data.user?.phone_confirmed_at && normalizeRecoveryPhone(data.user.phone ?? '') === normalized;
}

/** Gửi OTP tới số mới; Supabase chỉ đổi Auth phone sau khi nhập đúng mã. */
export async function requestOwnPhoneVerification(profilePhone: string): Promise<{ error: string | null }> {
  const normalized = normalizeRecoveryPhone(profilePhone);
  if (!normalized) return { error: 'Số điện thoại không hợp lệ. Ví dụ: 0862577958.' };
  const { error } = await supabase.auth.updateUser({ phone: normalized });
  if (!error) return { error: null };
  if (/provider.*not enabled|phone.*disabled|sms/i.test(error.message)) {
    return { error: 'Kênh SMS chưa được bật trong Supabase Auth. Vui lòng liên hệ quản trị viên.' };
  }
  if (/rate limit|security purposes|too many requests/i.test(error.message)) {
    return { error: 'Bạn vừa yêu cầu quá nhiều lần. Vui lòng đợi vài phút rồi thử lại.' };
  }
  return { error: describeDbError(error) };
}

export async function confirmOwnPhoneVerification(
  profilePhone: string,
  token: string,
): Promise<{ error: string | null }> {
  const normalized = normalizeRecoveryPhone(profilePhone);
  if (!normalized) return { error: 'Số điện thoại không hợp lệ.' };
  const { error } = await supabase.auth.verifyOtp({ phone: normalized, token: token.trim(), type: 'phone_change' });
  if (!error) return { error: null };
  return {
    error: /expired|invalid|token/i.test(error.message)
      ? 'Mã không đúng hoặc đã hết hạn. Vui lòng gửi lại mã.'
      : describeDbError(error),
  };
}

/**
 * Tải ảnh đại diện rồi ghi URL vào hồ sơ.
 *
 * Tên file có kèm dấu thời gian: trình duyệt và CDN cache rất dai theo URL, ghi
 * đè cùng một tên thì người dùng đổi ảnh xong vẫn thấy ảnh cũ. Ảnh cũ được xoá
 * sau khi ảnh mới đã ghi xong.
 */
export async function uploadAvatar(
  userId: string,
  file: File,
  currentUrl: string | null,
): Promise<{ error: string | null; url?: string }> {
  if (!AVATAR_MIME_TYPES.includes(file.type)) {
    return { error: 'Chỉ nhận ảnh JPG, PNG, WEBP hoặc GIF.' };
  }
  if (file.size > AVATAR_MAX_BYTES) {
    return { error: `Ảnh tối đa ${Math.round(AVATAR_MAX_BYTES / 1024 / 1024)} MB.` };
  }

  const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
  const path = `${userId}/${Date.now()}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from(AVATAR_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });

  if (uploadError) return { error: `Tải ảnh thất bại: ${uploadError.message}` };

  const { data } = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(path);
  const url = data.publicUrl;

  const { error: saveError } = await supabase
    .from('profiles')
    .update({ avatar_url: url })
    .eq('id', userId);

  if (saveError) {
    // Hồ sơ không ghi được thì ảnh vừa tải thành rác — dọn ngay.
    await supabase.storage.from(AVATAR_BUCKET).remove([path]);
    return { error: describeDbError(saveError) };
  }

  await removeOldAvatar(currentUrl, userId);
  return { error: null, url };
}

/** Gỡ ảnh đại diện, trả hồ sơ về dùng chữ cái đầu của tên. */
export async function removeAvatar(
  userId: string,
  currentUrl: string | null,
): Promise<{ error: string | null }> {
  const { error } = await supabase.from('profiles').update({ avatar_url: null }).eq('id', userId);
  if (error) return { error: describeDbError(error) };

  await removeOldAvatar(currentUrl, userId);
  return { error: null };
}

/**
 * Xoá file ảnh cũ trong storage. Lỗi được nuốt có chủ ý: hồ sơ đã trỏ sang ảnh
 * mới rồi, sót lại một file cũ không làm hỏng gì — báo lỗi ở đây chỉ khiến
 * người dùng tưởng việc đổi ảnh thất bại.
 */
async function removeOldAvatar(currentUrl: string | null, userId: string): Promise<void> {
  if (!currentUrl) return;

  const marker = `/${AVATAR_BUCKET}/`;
  const idx = currentUrl.indexOf(marker);
  if (idx === -1) return;

  const path = currentUrl.slice(idx + marker.length).split('?')[0];
  // Chỉ đụng vào file trong thư mục của chính mình — phòng URL bị sửa tay.
  if (!path.startsWith(`${userId}/`)) return;

  await supabase.storage.from(AVATAR_BUCKET).remove([path]);
}
