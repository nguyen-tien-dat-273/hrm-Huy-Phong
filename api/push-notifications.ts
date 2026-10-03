import { createClient } from '@supabase/supabase-js';
import webpush from 'web-push';

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

type PushRow = { endpoint: string; p256dh: string; auth: string; user_id: string };
type NoticeRow = { id: string; user_id: string; type: string; title: string; message: string };

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

function targetUrl(type: string): string {
  switch (type) {
    case 'assignment_submitted': return '/admin/assignments';
    case 'attendance_request_created':
    case 'leave_requested':
    case 'leave_updated':
    case 'leave_cancellation_requested': return '/admin/leave';
    case 'recruitment_request':
    case 'recruitment_review': return '/admin/recruitment';
    case 'assignment_new':
    case 'assignment_approved':
    case 'assignment_rejected': return '/staff/assignments';
    case 'project_task_assigned': return '/staff/kanban';
    case 'attendance_approved': return '/staff/attendance';
    case 'attendance_request_approved':
    case 'attendance_request_rejected':
    case 'leave_approved':
    case 'leave_rejected':
    case 'leave_cancellation_approved':
    case 'leave_cancellation_rejected': return '/staff/leave';
    case 'training_assigned': return '/staff/training';
    case 'lifecycle_assigned':
    case 'lifecycle_mentor':
    case 'lifecycle_task': return '/staff/growth';
    case 'push_test': return '/profile';
    default: return '/';
  }
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

  // Vercel đôi khi suy luận declaration browser rút gọn cho function server,
  // làm mất `auth.getUser` ở bước typecheck dù API tồn tại đúng ở runtime.
  // Nới kiểu tại biên server, thống nhất với các endpoint xác thực còn lại.
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

  const userIds = [...new Set(rows.map((row) => row.user_id))];
  const { data: subscriptions, error: subscriptionError } = await service
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth, user_id')
    .in('user_id', userIds);
  if (subscriptionError) return response.status(500).json({ error: 'Không đọc được danh sách thiết bị.' });

  webpush.setVapidDetails(subject, publicKey, privateKey);
  const staleEndpoints: string[] = [];
  let sent = 0;

  await Promise.all(((subscriptions ?? []) as PushRow[]).map(async (subscription) => {
    const notice = rows.find((row) => row.user_id === subscription.user_id);
    if (!notice) return;
    try {
      await webpush.sendNotification(
        { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
        JSON.stringify({
          title: notice.title,
          body: notice.message,
          icon: '/icon-192.png',
          badge: '/icon-192.png',
          tag: notice.id,
          data: { url: targetUrl(notice.type), notificationId: notice.id },
        }),
        { TTL: 60 * 60 * 24, urgency: 'high' },
      );
      sent += 1;
    } catch (error) {
      const statusCode = (error as { statusCode?: number }).statusCode;
      if (statusCode === 404 || statusCode === 410) staleEndpoints.push(subscription.endpoint);
    }
  }));

  if (staleEndpoints.length > 0) {
    await service.from('push_subscriptions').delete().in('endpoint', staleEndpoints);
  }
  await service
    .from('notifications')
    .update({ push_sent_at: new Date().toISOString() })
    .in('id', rows.map((row) => row.id));

  return response.status(200).json({ sent, devices: subscriptions?.length ?? 0 });
}
