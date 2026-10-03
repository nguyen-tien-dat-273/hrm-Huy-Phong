import { createClient } from '@supabase/supabase-js';

type ApiRequest = { method?: string; body?: unknown };
type ApiResponse = {
  status: (code: number) => ApiResponse;
  json: (body: Record<string, unknown>) => void;
  setHeader: (name: string, value: string) => void;
};
type ProfileContact = { id: string; email: string; phone: string | null };

function parseBody(body: unknown): Record<string, unknown> {
  if (body && typeof body === 'object') return body as Record<string, unknown>;
  if (typeof body === 'string') {
    try { return JSON.parse(body) as Record<string, unknown>; } catch { return {}; }
  }
  return {};
}

function normalizePhone(value: string): string | null {
  const digits = value.replace(/\D/g, '');
  if (/^0\d{9}$/.test(digits)) return `+84${digits.slice(1)}`;
  if (/^84\d{9}$/.test(digits)) return `+${digits}`;
  if (/^\d{10,15}$/.test(digits) && value.trim().startsWith('+')) return `+${digits}`;
  return null;
}

export default async function handler(request: ApiRequest, response: ApiResponse) {
  response.setHeader('Cache-Control', 'no-store');
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return response.status(405).json({ error: 'Chỉ hỗ trợ phương thức POST.' });
  }

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !anonKey || !serviceKey) {
    return response.status(503).json({ error: 'Dịch vụ khôi phục mật khẩu chưa được cấu hình.' });
  }

  const body = parseBody(request.body);
  const channel = body.channel;
  const recipient = typeof body.recipient === 'string' ? body.recipient.trim() : '';
  if ((channel !== 'email' && channel !== 'phone') || !recipient) {
    return response.status(400).json({ error: 'Thông tin khôi phục không hợp lệ.' });
  }

  const service: any = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const authClient: any = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });

  let profile: ProfileContact | null = null;
  let destination = recipient.toLowerCase();
  if (channel === 'email') {
    const { data } = await service.from('profiles').select('id, email').ilike('email', destination).maybeSingle();
    profile = data ? { ...(data as Omit<ProfileContact, 'phone'>), phone: null } : null;
  } else {
    const normalized = normalizePhone(recipient);
    if (!normalized) return response.status(400).json({ error: 'Số điện thoại không hợp lệ. Ví dụ: 0862577958.' });
    destination = normalized;
    const { data, error } = await service.from('profiles').select('id, email, phone').not('phone', 'is', null).limit(5000);
    if (error && /phone|schema cache|column .*does not exist/i.test(error.message || '')) {
      return response.status(503).json({ error: 'Hệ thống chưa hoàn tất cấu hình số điện thoại hồ sơ.' });
    }
    profile = ((data ?? []) as ProfileContact[]).find((item) => item.phone && normalizePhone(item.phone) === normalized) ?? null;
  }

  // Phản hồi giống nhau khi không tìm thấy để không lộ danh sách tài khoản.
  if (!profile) return response.status(200).json({ accepted: true });

  // SMS chỉ được gửi khi số đã được xác minh và khớp Auth. Recovery không
  // được phép tự gắn/đổi phone của tài khoản — làm vậy sẽ mở đường chiếm tài khoản.
  const { data: authData } = await service.auth.admin.getUserById(profile.id);
  const authUser = authData?.user;
  if (channel === 'phone' && (
    !authUser?.phone
    || normalizePhone(authUser.phone) !== destination
    || !authUser.phone_confirmed_at
  )) {
    return response.status(200).json({ accepted: true });
  }
  if (channel === 'email' && authUser?.email?.toLowerCase() !== destination) {
    return response.status(200).json({ accepted: true });
  }

  const { error } = await authClient.auth.signInWithOtp({
    ...(channel === 'email' ? { email: destination } : { phone: destination }),
    options: { shouldCreateUser: false },
  });
  if (error) {
    if (/provider.*not enabled|phone.*disabled|sms/i.test(error.message || '')) {
      return response.status(503).json({ error: 'Kênh SMS chưa được bật. Vui lòng dùng email hoặc liên hệ quản trị viên.' });
    }
    if (/rate limit|security purposes|too many requests/i.test(error.message || '')) {
      return response.status(429).json({ error: 'Bạn vừa yêu cầu quá nhiều lần. Vui lòng đợi vài phút rồi thử lại.' });
    }
    return response.status(500).json({ error: 'Chưa gửi được mã xác minh. Vui lòng thử lại.' });
  }
  return response.status(200).json({ accepted: true });
}
