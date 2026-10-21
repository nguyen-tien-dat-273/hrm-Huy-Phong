import { timingSafeEqual } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { deliverNotices, type NoticeRow } from './_push.js';

type ApiRequest = {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
};

type ApiResponse = {
  status: (code: number) => ApiResponse;
  json: (body: Record<string, unknown>) => void;
  setHeader: (name: string, value: string) => void;
};

function readBearer(request: ApiRequest): string {
  const raw = request.headers.authorization;
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value?.startsWith('Bearer ') ? value.slice(7).trim() : '';
}

function sameSecret(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Nhịp nhắc nhở tự động: sinh thông báo nhắc nhở trong DB (hàm
 * `generate_reminders`, tự chống trùng) rồi đẩy Web Push cho những thông báo
 * chưa đẩy. Gọi mỗi vài phút bởi Vercel Cron, vòng lặp của server Docker hoặc
 * bất kỳ bộ lập lịch ngoài nào có `CRON_SECRET`.
 *
 * Không dùng phiên người dùng: đây là job nền, xác thực bằng bí mật chung.
 */
export default async function handler(request: ApiRequest, response: ApiResponse) {
  response.setHeader('Cache-Control', 'no-store');
  if (request.method !== 'GET' && request.method !== 'POST') {
    response.setHeader('Allow', 'GET, POST');
    return response.status(405).json({ error: 'Chỉ hỗ trợ GET hoặc POST.' });
  }

  const cronSecret = process.env.CRON_SECRET;
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!cronSecret || !supabaseUrl || !serviceKey) {
    return response.status(503).json({ error: 'Dịch vụ nhắc nhở chưa được cấu hình đầy đủ.' });
  }
  if (!sameSecret(readBearer(request), cronSecret)) {
    return response.status(401).json({ error: 'Không có quyền chạy nhắc nhở.' });
  }

  const service: any = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const { data: generated, error: generateError } = await service.rpc('generate_reminders');
  if (generateError) {
    return response.status(500).json({ error: `Không sinh được nhắc nhở: ${generateError.message}` });
  }

  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) {
    return response.status(200).json({ generated, push: 'chưa cấu hình VAPID' });
  }

  // Chỉ nhắc nhở tự động (có dedupe_key, không có người tạo), tối đa 3 giờ gần
  // đây: nhắc quá cũ không còn đúng ngữ cảnh nên không đẩy muộn.
  const { data: pending, error: pendingError } = await service
    .from('notifications')
    .select('id, user_id, type, title, message')
    .is('push_sent_at', null)
    .is('created_by', null)
    .not('dedupe_key', 'is', null)
    .gte('created_at', new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString())
    .order('created_at', { ascending: true })
    .limit(1000);
  if (pendingError) {
    return response.status(500).json({ error: 'Không đọc được nhắc nhở cần đẩy.', generated });
  }

  const push = await deliverNotices(
    service,
    (pending ?? []) as NoticeRow[],
    { subject: process.env.VAPID_SUBJECT || 'mailto:admin@huyphongwine.vn', publicKey, privateKey },
  );
  return response.status(200).json({ generated, push });
}
