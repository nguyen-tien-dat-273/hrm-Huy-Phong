// ============================================================================
// Máy báo kết quả thực hiện lệnh — giao thức PUSH / ADMS của ZKTeco.
// ----------------------------------------------------------------------------
// HRM chưa gửi lệnh nào (xem getrequest.ts) nên đường này gần như không bao
// giờ được gọi. Vẫn phải có: firmware coi 404 ở bất kỳ đường nào trong bộ ba
// là server hỏng, và có bản sẽ ngừng đẩy luôn dữ liệu chấm công.
//
// Ghi lại thân request để sau này có bật điều khiển máy thì đã có sẵn dấu vết
// mà lần.
// ============================================================================

type ApiRequest = { method?: string; url?: string; body?: unknown; headers: Record<string, string | string[] | undefined> };
type ApiResponse = { status: (code: number) => ApiResponse; setHeader: (n: string, v: string) => void; send: (body: string) => void };

const allowedSerials = new Set(
  (process.env.ATTENDANCE_DEVICE_SERIALS || '').split(',').map((value) => value.trim()).filter(Boolean),
);

export default function handler(request: ApiRequest, response: ApiResponse) {
  const serial = new URL(request.url || '/', 'http://device.local').searchParams.get('SN')?.trim() || '';
  response.setHeader('Content-Type', 'text/plain; charset=utf-8');

  if (!serial || !allowedSerials.has(serial)) {
    return response.status(403).send('ERROR: thiet bi chua dang ky');
  }

  const body = typeof request.body === 'string' ? request.body : Buffer.isBuffer(request.body) ? request.body.toString('utf8') : '';
  if (body.trim()) console.log(`[iclock] ${serial} báo kết quả lệnh: ${body.trim().slice(0, 500)}`);
  return response.status(200).send('OK');
}
