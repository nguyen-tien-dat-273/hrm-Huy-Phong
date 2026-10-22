// ============================================================================
// Máy hỏi "có lệnh gì cho tôi không" — giao thức PUSH / ADMS của ZKTeco.
// ----------------------------------------------------------------------------
// Máy gọi đường dẫn này đều đặn theo chu kỳ `Delay` mà bước bắt tay trả về
// (xem cdata.ts). HRM hiện không điều khiển máy — không đồng bộ người dùng,
// không mở cửa, không đổi giờ — nên luôn trả "OK" nghĩa là không có việc gì.
//
// Vẫn phải có endpoint này. Thiếu nó máy nhận 404 liên tục, coi là server
// hỏng, và nhiều firmware sẽ NGỪNG đẩy cả dữ liệu chấm công.
//
// Sau này muốn điều khiển máy thì trả về chuỗi lệnh ở đây, ví dụ:
//   C:1:DATA UPDATE USERINFO PIN=123\tName=Nguyen Van A
//
// Mỗi lượt hỏi cũng là tín hiệu "máy còn sống": ghi `last_seen_at` để HRM phân
// biệt máy mất kết nối với máy chỉ là chưa ai chấm công. Việc ghi này làm theo
// kiểu cố gắng hết sức — lỗi thì chỉ cảnh báo, vẫn trả "OK" cho máy.
// ============================================================================

import { createClient } from '@supabase/supabase-js';

type ApiRequest = { method?: string; url?: string; headers: Record<string, string | string[] | undefined> };
type ApiResponse = { status: (code: number) => ApiResponse; setHeader: (n: string, v: string) => void; send: (body: string) => void };

const allowedSerials = new Set(
  (process.env.ATTENDANCE_DEVICE_SERIALS || '').split(',').map((value) => value.trim()).filter(Boolean),
);

const env = (...names: string[]) => names.map((name) => process.env[name]).find((value) => value && value.trim()) || '';

async function reportAlive(serial: string) {
  const supabaseUrl = env('SUPABASE_URL', 'VITE_SUPABASE_URL');
  const supabaseKey = env('SUPABASE_ANON_KEY', 'VITE_SUPABASE_ANON_KEY');
  const bridgeToken = env('ATTENDANCE_BRIDGE_TOKEN');
  if (!supabaseUrl || !supabaseKey || !bridgeToken) return;
  const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await supabase.rpc('touch_attendance_device', { bridge_token: bridgeToken });
  if (error) console.warn(`[iclock] ${serial}: không ghi được báo danh — ${error.message}`);
  else if ((data as { ok?: boolean } | null)?.ok === false) console.warn(`[iclock] ${serial}: báo danh bị từ chối — token sai hoặc đã thu hồi`);
}

export default async function handler(request: ApiRequest, response: ApiResponse) {
  const serial = new URL(request.url || '/', 'http://device.local').searchParams.get('SN')?.trim() || '';
  response.setHeader('Content-Type', 'text/plain; charset=utf-8');

  if (!serial || !allowedSerials.has(serial)) {
    console.warn(`[iclock] getrequest từ sê-ri lạ: ${serial || '(trống)'}`);
    return response.status(403).send('ERROR: thiet bi chua dang ky');
  }
  await reportAlive(serial).catch((error) => console.warn(`[iclock] ${serial}: báo danh lỗi — ${error?.message || error}`));
  return response.status(200).send('OK');
}
