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
// ============================================================================

type ApiRequest = { method?: string; url?: string; headers: Record<string, string | string[] | undefined> };
type ApiResponse = { status: (code: number) => ApiResponse; setHeader: (n: string, v: string) => void; send: (body: string) => void };

const allowedSerials = new Set(
  (process.env.ATTENDANCE_DEVICE_SERIALS || '').split(',').map((value) => value.trim()).filter(Boolean),
);

export default function handler(request: ApiRequest, response: ApiResponse) {
  const serial = new URL(request.url || '/', 'http://device.local').searchParams.get('SN')?.trim() || '';
  response.setHeader('Content-Type', 'text/plain; charset=utf-8');

  if (!serial || !allowedSerials.has(serial)) {
    console.warn(`[iclock] getrequest từ sê-ri lạ: ${serial || '(trống)'}`);
    return response.status(403).send('ERROR: thiet bi chua dang ky');
  }
  return response.status(200).send('OK');
}
