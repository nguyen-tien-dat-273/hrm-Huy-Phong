import { randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

type ApiRequest = {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
};

type ApiResponse = {
  status: (code: number) => ApiResponse;
  json: (body: Record<string, unknown>) => void;
  setHeader: (name: string, value: string) => void;
};

type SystemRole = 'admin' | 'ceo' | 'teamlead' | 'staff';

const INTERNAL_EMAIL_DOMAIN = 'ppms.local';
const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,31}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ROLES: readonly SystemRole[] = ['admin', 'ceo', 'teamlead', 'staff'];
const PERMISSIONS = ['users', 'projects', 'reports', 'attendance', 'shifts', 'leave', 'training', 'settings'] as const;

function fail(response: ApiResponse, status: number, error: string) {
  response.status(status).json({ error });
}

function readBearer(request: ApiRequest): string | null {
  const raw = request.headers.authorization;
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value?.startsWith('Bearer ') ? value.slice(7).trim() : null;
}

function normalizeIdentifier(input: unknown): { email?: string; error?: string } {
  if (typeof input !== 'string') return { error: 'Thiếu tên đăng nhập hoặc email.' };
  const value = input.trim().toLowerCase();
  if (!value) return { error: 'Thiếu tên đăng nhập hoặc email.' };
  if (value.includes('@')) {
    if (!EMAIL_RE.test(value) || value.endsWith(`@${INTERNAL_EMAIL_DOMAIN}`)) return { error: 'Email không hợp lệ.' };
    return { email: value };
  }
  if (!USERNAME_RE.test(value)) return { error: 'Tên đăng nhập không hợp lệ.' };
  return { email: `${value}@${INTERNAL_EMAIL_DOMAIN}` };
}

function temporaryPassword(): string {
  return `${randomBytes(12).toString('base64url')}aA1!`;
}

function parseBody(body: unknown): Record<string, unknown> {
  if (body && typeof body === 'object') return body as Record<string, unknown>;
  if (typeof body === 'string') {
    try { return JSON.parse(body) as Record<string, unknown>; } catch { return {}; }
  }
  return {};
}

export default async function handler(request: ApiRequest, response: ApiResponse) {
  response.setHeader('Cache-Control', 'no-store');
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return fail(response, 405, 'Chỉ hỗ trợ phương thức POST.');
  }

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  // Nêu ĐÚNG biến nào đang thiếu. Trước đây thông báo luôn đổ cho
  // SUPABASE_SERVICE_ROLE_KEY kể cả khi thứ thiếu là URL hay anon key, khiến
  // người cấu hình đi thêm khoá mới trong khi lỗi nằm ở chỗ khác.
  const missing = [
    !supabaseUrl && 'SUPABASE_URL (hoặc VITE_SUPABASE_URL)',
    !anonKey && 'SUPABASE_ANON_KEY (hoặc VITE_SUPABASE_ANON_KEY)',
    !serviceKey && 'SUPABASE_SERVICE_ROLE_KEY',
  ].filter(Boolean) as string[];

  // Kiểm tra lại từng biến thay vì dựa vào `missing.length`: TypeScript không
  // suy ra được rằng danh sách rỗng nghĩa là cả ba biến đều đã có giá trị, nên
  // các lệnh createClient bên dưới sẽ nhận `string | undefined`.
  if (!supabaseUrl || !anonKey || !serviceKey) {
    return fail(
      response,
      503,
      `Dịch vụ quản trị tài khoản chưa được cấu hình. Thiếu biến môi trường: ${missing.join(', ')}. ` +
        'Kiểm tra file cấu hình môi trường của dịch vụ API rồi khởi động lại.',
    );
  }

  const token = readBearer(request);
  if (!token) return fail(response, 401, 'Phiên đăng nhập không hợp lệ.');

  // Nới kiểu tại biên server vì các API Auth admin không được suy luận chính
  // xác từ declaration dùng chung của trình duyệt.
  const authClient: any = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const service: any = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: authData, error: authError } = await authClient.auth.getUser(token);
  if (authError || !authData.user) return fail(response, 401, 'Phiên đăng nhập đã hết hạn.');

  let { data: actor, error: actorError } = await service
    .from('profiles')
    .select('id, role, access_role_code, permissions, is_active')
    .eq('id', authData.user.id)
    .maybeSingle();
  // Cho phép bản frontend/API chạy an toàn trong lúc migration vai trò mới
  // chưa được thực thi trên môi trường Supabase hiện tại.
  if (actorError && /access_role_code|schema cache|column .* does not exist/i.test(actorError.message || '')) {
    ({ data: actor, error: actorError } = await service
      .from('profiles')
      .select('id, role, permissions, is_active')
      .eq('id', authData.user.id)
      .maybeSingle());
  }
  // Ba nguyên nhân rất khác nhau, trước đây trả về cùng một câu "Tài khoản
  // không có quyền quản trị" nên không lần ra được đang hỏng ở đâu.
  if (actorError) {
    return fail(response, 500, `Không đọc được hồ sơ nhân sự: ${actorError.message}`);
  }
  if (!actor) {
    // Service client dùng khóa đúng thì bỏ qua RLS và luôn thấy hàng này.
    // Không thấy gì gần như chỉ có một lý do: biến môi trường đang giữ một
    // khóa khác (anon/publishable) — khóa đó bị RLS chặn nên truy vấn trả rỗng
    // thay vì báo lỗi, trông y hệt như "không tìm thấy người dùng".
    return fail(
      response,
      403,
      'Không tìm thấy hồ sơ nhân sự cho tài khoản đang đăng nhập. Kiểm tra SUPABASE_SERVICE_ROLE_KEY: ' +
        'phải là khóa service_role (hoặc secret key), không phải anon/publishable key. ' +
        'Khóa sai sẽ bị RLS chặn và trả về rỗng.',
    );
  }
  if (!actor.is_active) {
    return fail(response, 403, 'Tài khoản đã bị vô hiệu hóa nên không thao tác quản trị được.');
  }

  const fullAdmin = actor.role === 'admin' || actor.role === 'ceo';
  const { data: actorAccessRole } = actor.access_role_code
    ? await service.from('system_access_roles').select('permissions, is_active').eq('code', actor.access_role_code).maybeSingle()
    : { data: null };
  const rolePermissions = Array.isArray(actorAccessRole?.permissions) ? actorAccessRole.permissions : [];
  const canManageUsers = fullAdmin || (Array.isArray(actor.permissions) && actor.permissions.includes('users')) || rolePermissions.includes('users');
  if (!canManageUsers) return fail(response, 403, 'Bạn không có quyền quản lý tài khoản.');

  const body = parseBody(request.body);
  const action = body.action;

  if (action === 'create') {
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const role = body.role as SystemRole;
    const requestedAccessRole = typeof body.access_role_code === 'string' ? body.access_role_code.trim().toLowerCase() : role;
    const identifier = normalizeIdentifier(body.identifier);
    if (name.length < 2) return fail(response, 400, 'Họ tên phải có ít nhất 2 ký tự.');
    if (identifier.error || !identifier.email) return fail(response, 400, identifier.error || 'Định danh không hợp lệ.');
    if (!ROLES.includes(role)) return fail(response, 400, 'Vai trò không hợp lệ.');
    if (!fullAdmin && role !== 'staff') return fail(response, 403, 'Quản trị viên được ủy quyền chỉ được tạo tài khoản nhân viên.');
    if (!/^[a-z][a-z0-9_]{1,49}$/.test(requestedAccessRole)) return fail(response, 400, 'Mã vai trò không hợp lệ.');

    const { data: accessRole, error: accessRoleError } = await service
      .from('system_access_roles')
      .select('code, is_active')
      .eq('code', requestedAccessRole)
      .maybeSingle();
    const rolesTableMissing = Boolean(accessRoleError && /system_access_roles|schema cache|relation .* does not exist/i.test(accessRoleError.message || ''));
    if (accessRoleError && !rolesTableMissing) return fail(response, 400, `Không đọc được vai trò nghiệp vụ: ${accessRoleError.message}`);
    if (!rolesTableMissing && !accessRole?.is_active) return fail(response, 400, 'Vai trò nghiệp vụ không tồn tại hoặc đã bị vô hiệu hóa.');
    const effectiveAccessRole = rolesTableMissing ? role : requestedAccessRole;
    if (!fullAdmin && effectiveAccessRole !== 'staff') return fail(response, 403, 'Quản trị viên được ủy quyền chỉ được tạo tài khoản Nhân viên.');

    const requestedPermissions = Array.isArray(body.permissions)
      ? body.permissions.filter((item): item is string => typeof item === 'string' && PERMISSIONS.includes(item as never))
      : [];
    // Quyền của vai trò nghiệp vụ lấy từ mẫu trong system_access_roles; chỉ
    // vai trò Nhân viên mới dùng quyền lẻ gửi từ form.
    const permissions = fullAdmin && effectiveAccessRole === 'staff' ? requestedPermissions : [];
    const password = temporaryPassword();
    const { data: created, error: createError } = await service.auth.admin.createUser({
      email: identifier.email,
      password,
      email_confirm: true,
      user_metadata: { name },
    });
    if (createError || !created.user) return fail(response, 400, createError?.message || 'Không tạo được tài khoản.');

    const profilePayload: Record<string, unknown> = {
      id: created.user.id,
      email: identifier.email,
      name,
      role,
      department: typeof body.department === 'string' ? body.department.trim() || null : null,
      permissions,
      is_active: true,
      must_change_password: true,
    };
    if (!rolesTableMissing) profilePayload.access_role_code = effectiveAccessRole;
    const { error: profileError } = await service.from('profiles').upsert(profilePayload);
    if (profileError) {
      await service.auth.admin.deleteUser(created.user.id);
      return fail(response, 400, `Không tạo được hồ sơ nhân sự: ${profileError.message}`);
    }
    return response.status(201).json({ id: created.user.id, email: identifier.email, tempPassword: password });
  }

  if (action === 'reset-password' || action === 'delete') {
    const userId = typeof body.userId === 'string' ? body.userId : '';
    if (!userId) return fail(response, 400, 'Thiếu người dùng cần xử lý.');
    if (userId === actor.id && action === 'delete') return fail(response, 400, 'Không thể xóa tài khoản đang đăng nhập.');

    const { data: target } = await service.from('profiles').select('id, role, must_change_password').eq('id', userId).maybeSingle();
    if (!target) return fail(response, 404, 'Không tìm thấy tài khoản.');
    if (!fullAdmin && target.role !== 'staff') return fail(response, 403, 'Bạn không được thao tác tài khoản quản trị hoặc trưởng nhóm.');

    if (action === 'delete') {
      const { error } = await service.auth.admin.deleteUser(userId);
      if (error) return fail(response, 400, error.message);
      return response.status(200).json({ success: true });
    }

    const password = temporaryPassword();
    const previousFlag = Boolean(target.must_change_password);
    const { error: flagError } = await service.from('profiles').update({ must_change_password: true }).eq('id', userId);
    if (flagError) return fail(response, 400, flagError.message);
    const { error: passwordError } = await service.auth.admin.updateUserById(userId, { password });
    if (passwordError) {
      await service.from('profiles').update({ must_change_password: previousFlag }).eq('id', userId);
      return fail(response, 400, passwordError.message);
    }
    return response.status(200).json({ tempPassword: password });
  }

  return fail(response, 400, 'Hành động không được hỗ trợ.');
}
