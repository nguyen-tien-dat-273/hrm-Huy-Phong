import { createClient } from '@supabase/supabase-js';

type ApiRequest = { method?: string; body?: unknown };
type ApiResponse = {
  status: (code: number) => ApiResponse;
  json: (body: Record<string, unknown>) => void;
  setHeader: (name: string, value: string) => void;
};
type ProfileContact = { id: string; email: string; phone: string | null };

/**
 * Domain noi bo cho tai khoan chi co ten dang nhap.
 *
 * Phai khop `INTERNAL_EMAIL_DOMAIN` trong client/src/lib/identity.ts - sua mot
 * ben ma quen ben kia thi tra cuu theo ten dang nhap khong ra tai khoan nao.
 */
const INTERNAL_EMAIL_DOMAIN = 'ppms.local';

const isInternalEmail = (email: string) => email.toLowerCase().endsWith(`@${INTERNAL_EMAIL_DOMAIN}`);

/**
 * Che bot dia chi truoc khi tra ve.
 *
 * Nguoi quen mat khau can biet ma gui di dau de con mo dung hop thu, nhung
 * khong duoc tra nguyen dia chi: go bua mot ten dang nhap la doc duoc email
 * rieng cua dong nghiep.
 */
function maskEmail(email: string): string {
  const [name, domain] = email.split('@');
  if (!domain) return '***';
  const head = name.slice(0, Math.min(3, name.length));
  return `${head}${'*'.repeat(Math.max(2, name.length - head.length))}@${domain}`;
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
  const action = typeof body.action === 'string' ? body.action : 'request';
  const recipient = typeof body.recipient === 'string' ? body.recipient.trim() : '';
  if ((channel !== 'email' && channel !== 'phone' && channel !== 'username') || !recipient) {
    return response.status(400).json({ error: 'Thông tin khôi phục không hợp lệ.' });
  }

  const service: any = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const authClient: any = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });

  // ---- Xac minh ma khi nguoi dung nhap TEN DANG NHAP ---------------------
  //
  // Phai lam o server vi client khong biet dia chi that - va co tinh khong
  // cho biet. Tra ve phien dang nhap de trinh duyet tu dat vao, dung nhu khi
  // verifyOtp chay truc tiep o client voi email/so dien thoai.
  if (action === 'verify' && channel === 'username') {
    const code = typeof body.code === 'string' ? body.code.trim() : '';
    if (!/^\d{6}$/.test(code)) {
      return response.status(400).json({ error: 'Mã xác minh gồm 6 chữ số.' });
    }

    const authEmail = recipient.toLowerCase().includes('@')
      ? recipient.toLowerCase()
      : `${recipient.toLowerCase()}@${INTERNAL_EMAIL_DOMAIN}`;
    const { data: row } = await service.from('profiles')
      .select('id').ilike('email', authEmail).maybeSingle();
    // Khong noi la "khong co tai khoan nay": cau tra loi giong het luc nhap
    // sai ma, de khong bien o nay thanh cho do ten dang nhap.
    if (!row) return response.status(400).json({ error: 'Mã không đúng hoặc đã hết hạn.' });

    const { data: authData } = await service.auth.admin.getUserById((row as { id: string }).id);
    const authUser = authData?.user;
    const realEmail = authUser?.email && !isInternalEmail(authUser.email) ? authUser.email : null;
    const verifiedPhone = authUser?.phone && authUser.phone_confirmed_at
      ? normalizePhone(authUser.phone) : null;
    if (!realEmail && !verifiedPhone) {
      return response.status(400).json({ error: 'Mã không đúng hoặc đã hết hạn.' });
    }

    const { data: verified, error: verifyError } = await authClient.auth.verifyOtp(
      realEmail
        ? { email: realEmail, token: code, type: 'email' }
        : { phone: verifiedPhone as string, token: code, type: 'sms' },
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

  let profile: ProfileContact | null = null;
  let destination = recipient.toLowerCase();

  // ---- Tra cuu theo TEN DANG NHAP ---------------------------------------
  //
  // Day la thu nguoi dung thuc su nho. Email dang ky thi nhieu nguoi khong
  // nho, con tai khoan tao bang ten dang nhap thi email la `@ppms.local` -
  // mot hop thu khong ton tai, go vao o email khong bao gio ra ket qua.
  if (channel === 'username') {
    const authEmail = recipient.toLowerCase().includes('@')
      ? recipient.toLowerCase()
      : `${recipient.toLowerCase()}@${INTERNAL_EMAIL_DOMAIN}`;
    const { data } = await service.from('profiles')
      .select('id, email, phone').ilike('email', authEmail).maybeSingle();
    if (!data) return response.status(200).json({ accepted: true });

    const found = data as ProfileContact;
    const { data: authData } = await service.auth.admin.getUserById(found.id);
    const authUser = authData?.user;
    const realEmail = authUser?.email && !isInternalEmail(authUser.email) ? authUser.email : null;
    const verifiedPhone = authUser?.phone && authUser.phone_confirmed_at
      ? normalizePhone(authUser.phone) : null;

    // Khong co duong nao gui ma: noi THANG ra. Im lang tra `accepted` de ho
    // ngoi doi mot tin nhan khong bao gio den la tu cho ho mot ngo cut.
    if (!realEmail && !verifiedPhone) {
      return response.status(200).json({
        error: 'Tài khoản này chưa khai email hoặc số điện thoại đã xác minh nên không tự đặt lại '
          + 'mật khẩu được. Nhờ quản trị viên cấp mật khẩu tạm.',
      });
    }

    const via = realEmail ? 'email' : 'phone';
    const target = realEmail ?? (verifiedPhone as string);
    const { error: otpError } = await authClient.auth.signInWithOtp({
      ...(via === 'email' ? { email: target } : { phone: target }),
      options: { shouldCreateUser: false },
    });
    if (otpError) {
      if (/rate limit|security purposes|too many requests/i.test(otpError.message || '')) {
        return response.status(429).json({ error: 'Bạn vừa yêu cầu quá nhiều lần. Vui lòng đợi vài phút rồi thử lại.' });
      }
      return response.status(500).json({ error: 'Chưa gửi được mã xác minh. Vui lòng thử lại.' });
    }
    return response.status(200).json({
      accepted: true,
      via,
      hint: via === 'email' ? maskEmail(target) : maskPhone(target),
      // KHONG tra dia chi that. Luc nay nguoi hoi chua chung minh duoc gi -
      // go bua mot ten dang nhap la doc duoc email rieng cua dong nghiep.
      // Buoc xac minh ma se tra cuu lai o server.
    });
  }

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
