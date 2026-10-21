import { createClient } from '@supabase/supabase-js';
import { deliverNotices, type NoticeRow } from './_push.js';

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

function readBearer(request: ApiRequest): string | null {
  const raw = request.headers.authorization;
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value?.startsWith('Bearer ') ? value.slice(7).trim() : null;
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
    return response.status(405).json({ error: 'Chỉ hỗ trợ phương thức POST.' });
  }

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || 'mailto:admin@huyphongwine.vn';
  if (!supabaseUrl || !anonKey || !serviceKey || !publicKey || !privateKey) {
    return response.status(503).json({ error: 'Dịch vụ thông báo điện thoại chưa được cấu hình đầy đủ.' });
  }

  const token = readBearer(request);
  if (!token) return response.status(401).json({ error: 'Phiên đăng nhập không hợp lệ.' });

  // Nới kiểu tại biên server vì API Auth không được suy luận chính xác từ
  // declaration dùng chung của trình duyệt.
  const authClient: any = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const service: any = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: authData, error: authError } = await authClient.auth.getUser(token);
  if (authError || !authData.user) return response.status(401).json({ error: 'Phiên đăng nhập đã hết hạn.' });

  const ids = parseBody(request.body).notificationIds;
  const notificationIds = Array.isArray(ids)
    ? ids.filter((id): id is string => typeof id === 'string').slice(0, 100)
    : [];
  if (notificationIds.length === 0) return response.status(400).json({ error: 'Không có thông báo để gửi.' });

  const { data: notices, error: noticeError } = await service
    .from('notifications')
    .select('id, user_id, type, title, message')
    .in('id', notificationIds)
    .eq('created_by', authData.user.id)
    .is('push_sent_at', null)
    .gte('created_at', new Date(Date.now() - 5 * 60 * 1000).toISOString());
  if (noticeError) return response.status(500).json({ error: 'Không đọc được thông báo vừa tạo.' });
  const rows = (notices ?? []) as NoticeRow[];
  if (rows.length === 0) return response.status(403).json({ error: 'Không có thông báo hợp lệ thuộc phiên hiện tại.' });

  const result = await deliverNotices(service, rows, { subject, publicKey, privateKey });
  if ('error' in result) return response.status(500).json({ error: result.error });

  return response.status(200).json(result);
}
