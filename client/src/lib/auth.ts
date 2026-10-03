// ============================================================================
// Lớp xác thực: Supabase Auth (mật khẩu, phiên) + backend admin trên Vercel.
// ----------------------------------------------------------------------------
// - Đăng nhập / đổi mật khẩu: gọi thẳng Supabase Auth từ trình duyệt.
// - Tạo / xóa user, cấp mật khẩu tạm: gọi `/api/admin-users` (Vercel Function),
//   nơi duy nhất giữ service_role key. Không bao giờ gọi `supabase.auth.admin.*`
//   từ trình duyệt vì API đó đòi service_role key.
// ============================================================================

import type { SystemRole, Profile } from '@/types';
import { supabase } from './supabase';
import { describeDbError } from './dbError';
import { toAuthEmail } from './identity';

/**
 * Gốc của API admin. Mặc định cùng origin (bản deploy trên Vercel).
 * Khi chạy `npm run dev` bằng Vite thuần thì `/api/*` KHÔNG tồn tại — dùng
 * `vercel dev`, hoặc đặt VITE_ADMIN_API_BASE trỏ sang bản đã deploy.
 */
const ADMIN_API_BASE = (import.meta.env.VITE_ADMIN_API_BASE as string | undefined)?.replace(/\/$/, '') ?? '';

function profileFromRow(row: Record<string, unknown>): Profile {
  return {
    id: row.id as string,
    name: (row.name as string) ?? '',
    email: (row.email as string) ?? '',
    role: (row.role as SystemRole) ?? 'staff',
    access_role_code: (row.access_role_code as string | null) ?? null,
    department: (row.department as string | null) ?? null,
    employee_code: (row.employee_code as string | null) ?? null,
    unit_id: (row.unit_id as string | null) ?? null,
    position_id: (row.position_id as string | null) ?? null,
    manager_id: (row.manager_id as string | null) ?? null,
    hire_date: (row.hire_date as string | null) ?? null,
    employment_status: (row.employment_status as Profile['employment_status']) ?? 'active',
    phone: (row.phone as string | null) ?? null,
    hometown: (row.hometown as string | null) ?? null,
    permanent_address: (row.permanent_address as string | null) ?? null,
    current_address: (row.current_address as string | null) ?? null,
    education_level: (row.education_level as Profile['education_level']) ?? null,
    school_name: (row.school_name as string | null) ?? null,
    major: (row.major as string | null) ?? null,
    graduation_year: (row.graduation_year as number | null) ?? null,
    avatar_url: (row.avatar_url as string | null) ?? null,
    is_active: (row.is_active as boolean) ?? true,
    must_change_password: (row.must_change_password as boolean) ?? false,
    permissions: (row.permissions as string[] | null) ?? [],
    position_permissions: (row.position_permissions as string[] | null) ?? [],
    function_permissions: (row.function_permissions as string[] | null) ?? [],
    annual_leave_quota: (row.annual_leave_quota as number | null) ?? 12,
    created_at: (row.created_at as string) ?? new Date().toISOString(),
    updated_at: (row.updated_at as string) ?? new Date().toISOString(),
  };
}

async function fetchProfileById(id: string): Promise<Profile | null> {
  const { data, error } = await supabase.from('profiles').select('*').eq('id', id).maybeSingle();
  if (error || !data) return null;
  const profile = profileFromRow(data as unknown as Record<string, unknown>);
  if (profile.access_role_code) {
    const { data: accessRole } = await supabase
      .from('system_access_roles')
      .select('permissions')
      .eq('code', profile.access_role_code)
      .eq('is_active', true)
      .maybeSingle();
    profile.access_role_permissions = (accessRole?.permissions as string[] | null) ?? [];
    const { data: roleFunctions } = await supabase
      .from('system_access_role_functions')
      .select('function_code')
      .eq('access_role_code', profile.access_role_code);
    profile.function_permissions = (roleFunctions || [])
      .map((item) => item.function_code as string)
      .filter(Boolean);
  }
  if (profile.position_id) {
    // Migration có thể được triển khai sau frontend; khi bảng chưa có thì
    // giữ quyền tài khoản cũ thay vì làm hỏng đăng nhập.
    const { data: positionPermissions } = await supabase
      .from('job_position_permissions')
      .select('permission_code')
      .eq('position_id', profile.position_id);
    profile.position_permissions = (positionPermissions || [])
      .map((item) => item.permission_code as string)
      .filter(Boolean);
    const { data: positionFunctions } = await supabase
      .from('job_position_function_permissions')
      .select('function_code')
      .eq('position_id', profile.position_id);
    profile.function_permissions = Array.from(new Set([
      ...(profile.function_permissions || []),
      ...(positionFunctions || []).map((item) => item.function_code as string).filter(Boolean),
    ]));
  }
  return profile;
}

// ----------------------------------------------------------------------------
// Đăng nhập / đăng xuất
// ----------------------------------------------------------------------------

/** `identifier` là tên đăng nhập hoặc email — xem `lib/identity.ts`. */
export async function signIn(identifier: string, password: string): Promise<{ user?: Profile; error?: string }> {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: toAuthEmail(identifier),
    password,
  });
  if (error) {
    return {
      error: /invalid login credentials/i.test(error.message)
        ? 'Tên đăng nhập hoặc mật khẩu không đúng.'
        : error.message,
    };
  }

  const uid = data.user?.id;
  if (!uid) return { error: 'Đăng nhập thất bại.' };

  const profile = await fetchProfileById(uid);
  if (!profile) {
    await supabase.auth.signOut();
    return { error: 'Không tìm thấy hồ sơ người dùng. Liên hệ quản trị viên.' };
  }
  if (!profile.is_active) {
    await supabase.auth.signOut();
    return { error: 'Tài khoản đã bị vô hiệu hóa. Liên hệ quản trị viên.' };
  }

  return { user: profile };
}

export async function getCurrentUser(): Promise<Profile | null> {
  const { data } = await supabase.auth.getUser();
  const uid = data.user?.id;
  if (!uid) return null;
  return fetchProfileById(uid);
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
}

// ----------------------------------------------------------------------------
// Quên mật khẩu / khôi phục bằng email
// ----------------------------------------------------------------------------

/**
 * Cách tự nhận mình là ai khi quên mật khẩu.
 *
 * `username` là đường chính: đó là thứ người ta thực sự nhớ. Nhiều tài khoản
 * còn KHÔNG có email thật — tài khoản tạo bằng tên đăng nhập mang địa chỉ nội
 * bộ `@ppms.local`, gõ vào ô email thì không bao giờ ra kết quả.
 */
export type RecoveryChannel = 'email' | 'phone' | 'username';

export function normalizeRecoveryPhone(value: string): string | null {
  const digits = value.replace(/\D/g, '');
  if (/^0\d{9}$/.test(digits)) return `+84${digits.slice(1)}`;
  if (/^84\d{9}$/.test(digits)) return `+${digits}`;
  if (/^\d{10,15}$/.test(digits) && value.trim().startsWith('+')) return `+${digits}`;
  return null;
}

export async function requestPasswordReset(
  channel: RecoveryChannel, recipient: string,
): Promise<{ error?: string; hint?: string; via?: 'email' | 'phone' }> {
  let response: Response;
  try {
    response = await fetch(`${ADMIN_API_BASE}/api/password-recovery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel, recipient }),
    });
  } catch {
    return { error: 'Không kết nối được tới dịch vụ khôi phục mật khẩu.' };
  }
  const body = await response.json().catch(() => null) as
    { error?: string; hint?: string; via?: 'email' | 'phone' } | null;
  if (!response.ok) return { error: body?.error ?? `Lỗi máy chủ (${response.status}).` };
  // Server trả `error` kèm HTTP 200 khi tài khoản có thật nhưng không có kênh
  // nào gửi mã được — đó là lời giải thích, không phải sự cố máy chủ.
  if (body?.error) return { error: body.error };
  return { hint: body?.hint, via: body?.via };
}

export async function verifyPasswordResetCode(channel: RecoveryChannel, recipient: string, token: string): Promise<{ error?: string }> {
  // Nhập bằng tên đăng nhập thì client KHÔNG biết mã gửi đi đâu — và cố tình
  // không cho biết. Server tra cứu lại rồi trả phiên đăng nhập về đây.
  if (channel === 'username') {
    let response: Response;
    try {
      response = await fetch(`${ADMIN_API_BASE}/api/password-recovery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'verify', channel, recipient, code: token.trim() }),
      });
    } catch {
      return { error: 'Không kết nối được tới dịch vụ khôi phục mật khẩu.' };
    }
    const body = await response.json().catch(() => null) as
      { error?: string; access_token?: string; refresh_token?: string } | null;
    if (!response.ok || !body?.access_token || !body?.refresh_token) {
      return { error: body?.error ?? 'Mã không đúng hoặc đã hết hạn.' };
    }
    const { error } = await supabase.auth.setSession({
      access_token: body.access_token, refresh_token: body.refresh_token,
    });
    if (error) return { error: describeDbError(error) };
    sessionStorage.setItem('hrm:password-recovery', '1');
    return {};
  }

  const destination = channel === 'phone' ? normalizeRecoveryPhone(recipient) : recipient.trim().toLowerCase();
  if (!destination) return { error: 'Số điện thoại không hợp lệ.' };
  const { error } = await supabase.auth.verifyOtp({
    ...(channel === 'email'
      ? { email: destination, token: token.trim(), type: 'email' as const }
      : { phone: destination, token: token.trim(), type: 'sms' as const }),
  });
  if (error) {
    return { error: /expired|invalid|token/i.test(error.message) ? 'Mã không đúng hoặc đã hết hạn. Vui lòng kiểm tra và thử lại.' : describeDbError(error) };
  }
  sessionStorage.setItem('hrm:password-recovery', '1');
  return {};
}

export async function completePasswordRecovery(newPassword: string): Promise<{ error?: string }> {
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) return { error: 'Liên kết khôi phục không hợp lệ hoặc đã hết hạn.' };

  const { data, error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) {
    return {
      error: /expired|invalid|session/i.test(error.message)
        ? 'Liên kết khôi phục không hợp lệ hoặc đã hết hạn. Hãy yêu cầu một liên kết mới.'
        : describeDbError(error),
    };
  }

  if (data.user?.id) {
    const { error: flagError } = await supabase
      .from('profiles')
      .update({ must_change_password: false })
      .eq('id', data.user.id);
    if (flagError) {
      return { error: `Mật khẩu đã được đổi nhưng chưa cập nhật được trạng thái tài khoản: ${describeDbError(flagError)}` };
    }
  }

  sessionStorage.removeItem('hrm:password-recovery');
  await supabase.auth.signOut();
  return {};
}

// ----------------------------------------------------------------------------
// Đổi mật khẩu (bắt buộc nhập mật khẩu cũ)
// ----------------------------------------------------------------------------

/**
 * Supabase không có API "kiểm tra mật khẩu hiện tại", nên ta re-authenticate
 * bằng chính mật khẩu cũ trước khi cho phép cập nhật.
 */
export async function changeOwnPassword(
  authEmail: string,
  oldPassword: string,
  newPassword: string,
): Promise<{ error?: string }> {
  const { error: reauthError } = await supabase.auth.signInWithPassword({
    email: authEmail.trim().toLowerCase(),
    password: oldPassword,
  });
  if (reauthError) {
    return {
      error: /invalid login credentials/i.test(reauthError.message)
        ? 'Mật khẩu hiện tại không đúng.'
        : reauthError.message,
    };
  }

  const { data, error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) return { error: describeDbError(error) };

  if (data.user?.id) {
    // LỖI Ở ĐÂY TỪNG BỊ NUỐT và gây kẹt đăng nhập hoàn toàn: mật khẩu đã đổi
    // xong, nhưng cờ không hạ được thì ProtectedRoute lại đá về đúng trang này
    // — người dùng thấy "đổi thành công" rồi quay vòng mãi mà không có thông
    // báo nào. Mật khẩu cũ thì đã chết, nên không lùi lại được.
    // (Đã xảy ra thật: một trigger chặn nhầm cột này — xem migration
    //  20260811180000.)
    const { error: flagError } = await supabase
      .from('profiles')
      .update({ must_change_password: false })
      .eq('id', data.user.id);

    if (flagError) {
      return {
        error:
          `Mật khẩu MỚI đã được đặt thành công, nhưng hệ thống không gỡ được yêu cầu ` +
          `đổi mật khẩu: ${describeDbError(flagError)}. Hãy đăng nhập lại bằng mật khẩu ` +
          `mới; nếu vẫn bị hỏi đổi mật khẩu, báo quản trị viên.`,
      };
    }
  }
  return {};
}

// ----------------------------------------------------------------------------
// Quản trị người dùng (qua /api/admin-users trên Vercel)
// ----------------------------------------------------------------------------

async function callAdminApi<T>(payload: Record<string, unknown>): Promise<{ data?: T; error?: string }> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) return { error: 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.' };

  let res: Response;
  try {
    res = await fetch(`${ADMIN_API_BASE}/api/admin-users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });
  } catch {
    return { error: 'Không kết nối được tới dịch vụ quản trị tài khoản (/api/admin-users).' };
  }

  let json: (T & { error?: string }) | null = null;
  try {
    json = (await res.json()) as T & { error?: string };
  } catch {
    /* phản hồi không phải JSON */
  }

  if (!res.ok) {
    if (res.status === 404) {
      return {
        error:
          'Không tìm thấy /api/admin-users. Chạy bằng `vercel dev` hoặc deploy lên Vercel — Vite thuần không phục vụ thư mục api/.',
      };
    }
    return { error: json?.error ?? `Lỗi máy chủ (${res.status}).` };
  }
  if (json?.error) return { error: json.error };
  return { data: json as T };
}

export async function adminCreateUser(input: {
  name: string;
  /** Tên đăng nhập hoặc email. */
  identifier: string;
  role: SystemRole;
  access_role_code?: string;
  department?: string;
  permissions?: string[];
}): Promise<{ tempPassword?: string; email?: string; error?: string }> {
  const { data, error } = await callAdminApi<{ tempPassword: string; email: string }>({
    action: 'create',
    name: input.name,
    identifier: input.identifier,
    role: input.role,
    access_role_code: input.access_role_code ?? input.role,
    department: input.department ?? '',
    permissions: input.permissions ?? [],
  });
  if (error) return { error };
  return { tempPassword: data?.tempPassword, email: data?.email };
}

export async function adminResetPassword(userId: string): Promise<{ tempPassword?: string; error?: string }> {
  const { data, error } = await callAdminApi<{ tempPassword: string }>({ action: 'reset-password', userId });
  if (error) return { error };
  return { tempPassword: data?.tempPassword };
}

/**
 * Xóa người dùng.
 *
 * Đường chính: `/api/admin-users` xóa cả bản ghi trong `auth.users` lẫn hồ sơ.
 *
 * Không xóa riêng `profiles`: làm vậy sẽ để lại tài khoản mồ côi trong
 * `auth.users`, giữ email và khiến định danh không thể tái sử dụng.
 */
export async function adminDeleteUser(userId: string): Promise<{ error?: string; partial?: boolean }> {
  const { error } = await callAdminApi({ action: 'delete', userId });
  if (!error) return {};
  return { error };
}

/** Cập nhật hồ sơ (không đụng tới mật khẩu) — đi thẳng qua RLS. */
export async function updateProfile(
  id: string,
  updates: Partial<Pick<Profile, 'name' | 'role' | 'access_role_code' | 'department' | 'is_active' | 'permissions' | 'phone' | 'hometown' | 'permanent_address' | 'current_address' | 'education_level' | 'school_name' | 'major' | 'graduation_year'>>,
): Promise<{ error?: string }> {
  let { error } = await supabase.from('profiles').update(updates).eq('id', id);
  // Frontend có thể được deploy trước migration vai trò mở rộng. Trong thời
  // gian đó vẫn cho sửa hồ sơ cũ bằng cơ chế role kỹ thuật, thay vì làm hỏng
  // toàn bộ thao tác quản trị người dùng.
  if (error && updates.access_role_code && /access_role_code|schema cache|column .* does not exist/i.test(error.message)) {
    const { access_role_code: _ignored, ...legacyUpdates } = updates;
    ({ error } = await supabase.from('profiles').update(legacyUpdates).eq('id', id));
  }
  if (error) {
    // Trigger prevent_self_privilege_change chặn tự đổi quyền của chính mình.
    const msg = /tự thay đổi quyền/i.test(error.message)
      ? 'Không thể tự thay đổi vai trò hoặc quyền của chính mình. Nhờ một quản trị viên khác thực hiện.'
      : describeDbError(error);
    return { error: msg };
  }
  return {};
}

export async function getUsers(): Promise<Profile[]> {
  const { data, error } = await supabase.from('profiles').select('*').order('created_at', { ascending: true });
  if (error || !data) return [];
  return (data as unknown as Record<string, unknown>[]).map(profileFromRow);
}
