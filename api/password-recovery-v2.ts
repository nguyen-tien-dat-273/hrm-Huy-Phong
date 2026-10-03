import { createClient } from '@supabase/supabase-js';

type ApiRequest = { method?: string; body?: unknown };
type ApiResponse = {
  status: (code: number) => ApiResponse;
  json: (body: Record<string, unknown>) => void;
  setHeader: (name: string, value: string) => void;
};
type RecoveryChannel = 'email' | 'phone';
type ProfileContact = { id: string; email: string; phone: string | null };
type RecoveryMethod = { channel: RecoveryChannel; hint: string };
type RecoveryAccount = {
  destinations: Partial<Record<RecoveryChannel, string>>;
  methods: RecoveryMethod[];
};

/** Phải khớp `client/src/lib/identity.ts`. */
const INTERNAL_EMAIL_DOMAIN = 'ppms.local';

const isInternalEmail = (email: string) => email.toLowerCase().endsWith(`@${INTERNAL_EMAIL_DOMAIN}`);

function maskEmail(email: string): string {
  const [name, domain] = email.split('@');
  if (!domain) return '***';
  const visible = name.slice(0, Math.min(3, name.length));
  return `${visible}${'*'.repeat(Math.max(2, name.length - visible.length))}@${domain}`;
}

function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return digits.length <= 4 ? '***' : `${'*'.repeat(digits.length - 3)}${digits.slice(-3)}`;
}

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

function authEmailFromUsername(username: string): string {
  const normalized = username.trim().toLowerCase();
  return normalized.includes('@') ? normalized : `${normalized}@${INTERNAL_EMAIL_DOMAIN}`;
}

/**
 * Tên đăng nhập chỉ dùng để xác định tài khoản. Đích nhận mã luôn được lấy từ
 * Auth đã xác minh ở server; client chỉ nhận bản đã che và không thể thay đích
 * gửi bằng email/số điện thoại tự nhập.
 */
async function findRecoveryAccount(service: any, username: string): Promise<RecoveryAccount | null> {
  const { data } = await service.from('profiles')
    .select('id, email, phone')
    .ilike('email', authEmailFromUsername(username))
    .maybeSingle();
  if (!data) return null;

  const profile = data as ProfileContact;
  const { data: authData } = await service.auth.admin.getUserById(profile.id);
  const authUser = authData?.user;
  if (!authUser) return null;

  const destinations: Partial<Record<RecoveryChannel, string>> = {};
  const methods: RecoveryMethod[] = [];

  const verifiedEmail = authUser.email
    && authUser.email_confirmed_at
    && !isInternalEmail(authUser.email)
    ? authUser.email.toLowerCase()
    : null;
  if (verifiedEmail) {
    destinations.email = verifiedEmail;
    methods.push({ channel: 'email', hint: maskEmail(verifiedEmail) });
  }

  const profilePhone = profile.phone ? normalizePhone(profile.phone) : null;
  const authPhone = authUser.phone ? normalizePhone(authUser.phone) : null;
  const verifiedPhone = authPhone && authUser.phone_confirmed_at && authPhone === profilePhone
    ? authPhone
    : null;
  if (verifiedPhone) {
    destinations.phone = verifiedPhone;
    methods.push({ channel: 'phone', hint: maskPhone(verifiedPhone) });
  }

  return { destinations, methods };
}

function friendlyOtpError(message: string): { status: number; error: string } {
  if (/provider.*not enabled|phone.*disabled|sms/i.test(message)) {
    return { status: 503, error: 'Kênh SMS chưa được bật. Vui lòng chọn email hoặc liên hệ quản trị viên.' };
  }
  if (/rate limit|security purposes|too many requests/i.test(message)) {
    return { status: 429, error: 'Bạn vừa yêu cầu quá nhiều lần. Vui lòng đợi vài phút rồi thử lại.' };
  }
  return { status: 500, error: 'Chưa gửi được mã xác minh. Vui lòng thử lại.' };
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
  const action = typeof body.action === 'string' ? body.action : 'identify';
  const username = typeof body.username === 'string' ? body.username.trim() : '';
  const channel = body.channel === 'email' || body.channel === 'phone' ? body.channel : null;
  if (!username) return response.status(400).json({ error: 'Vui lòng nhập tên đăng nhập.' });

  const service: any = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const authClient: any = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const account = await findRecoveryAccount(service, username);

  if (action === 'identify') {
    // Một thông báo chung cho cả tài khoản không tồn tại và tài khoản chưa có
    // kênh đã xác minh: không biến endpoint này thành công cụ dò username.
    if (!account || account.methods.length === 0) {
      return response.status(200).json({
        accepted: true,
        methods: [],
        error: 'Không thể xác nhận kênh khôi phục cho tài khoản này. Kiểm tra lại tên đăng nhập hoặc liên hệ quản trị viên.',
      });
    }
    return response.status(200).json({ accepted: true, methods: account.methods });
  }

  if (!channel || (action !== 'send' && action !== 'verify')) {
    return response.status(400).json({ error: 'Yêu cầu khôi phục không hợp lệ.' });
  }

  const destination = account?.destinations[channel];
  if (!account || !destination) {
    return response.status(400).json({ error: 'Kênh khôi phục không còn khả dụng. Vui lòng bắt đầu lại.' });
  }

  if (action === 'send') {
    const { error } = await authClient.auth.signInWithOtp({
      ...(channel === 'email' ? { email: destination } : { phone: destination }),
      options: { shouldCreateUser: false },
    });
    if (error) {
      const friendly = friendlyOtpError(error.message || '');
      return response.status(friendly.status).json({ error: friendly.error });
    }
    const method = account.methods.find((item) => item.channel === channel);
    return response.status(200).json({ accepted: true, via: channel, hint: method?.hint });
  }

  const code = typeof body.code === 'string' ? body.code.trim() : '';
  if (!/^\d{6}$/.test(code)) {
    return response.status(400).json({ error: 'Mã xác minh gồm 6 chữ số.' });
  }
  const { data: verified, error: verifyError } = await authClient.auth.verifyOtp(
    channel === 'email'
      ? { email: destination, token: code, type: 'email' }
      : { phone: destination, token: code, type: 'sms' },
  );
  if (verifyError || !verified?.session) {
    return response.status(400).json({ error: 'Mã không đúng hoặc đã hết hạn.' });
  }
  return response.status(200).json({
    accepted: true,
    access_token: verified.session.access_token,
    refresh_token: verified.session.refresh_token,
  });
}
