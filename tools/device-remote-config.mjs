// Cấu hình kết nối máy chấm công khai trên HRM (Máy chấm công > Sửa thông tin).
// Bridge và script kiểm tra dùng chung để cùng một nguồn sự thật: đổi IP trên HRM
// là xong, không phải ra máy tính ở văn phòng sửa file .env.
//
// Giá trị nào HRM để trống thì giữ nguyên giá trị trong .env.

/** Trả về cấu hình từ HRM, hoặc null khi chưa chạy migration (bridge cũ vẫn chạy bằng .env). */
export async function fetchRemoteConfig(supabase, bridgeToken) {
  const { data, error } = await supabase.rpc('get_attendance_device_config', { bridge_token: bridgeToken });
  if (error) {
    if (/does not exist|schema cache|function public/i.test(error.message || '')) return null;
    throw new Error(`Không lấy được cấu hình máy từ HRM: ${error.message}`);
  }
  if (data?.ok === false) {
    throw new Error('Token bridge sai, đã hết hạn hoặc đã bị thu hồi. Tạo token mới trong HRM và cập nhật cấu hình bridge.');
  }
  return data;
}

/**
 * Ghi đè các trường kết nối của `config` bằng giá trị trên HRM; trả về danh sách
 * điều đã áp dụng để in ra cho người vận hành thấy IP đang dùng đến từ đâu.
 */
export function applyRemoteConfig(config, remote) {
  const applied = [];
  if (!remote) return applied;

  const ip = String(remote.ip_address ?? '').trim();
  if (ip) { config.host = ip; applied.push(`IP ${ip}`); }

  const port = Number(remote.port);
  if (Number.isInteger(port) && port > 0) { config.port = port; applied.push(`port ${port}`); }

  if (remote.connection_type === 'SERIAL') {
    throw new Error('Máy đang khai kiểu kết nối "Cổng COM"; bridge chỉ hỗ trợ TCP/IP và UDP. Sửa lại trong HRM.');
  }
  if (remote.connection_type === 'TCP' || remote.connection_type === 'UDP') {
    config.transport = remote.connection_type.toLowerCase();
    applied.push(config.transport.toUpperCase());
  }

  const commKey = String(remote.comm_password ?? '').trim();
  if (commKey) {
    if (!/^\d+$/.test(commKey)) throw new Error('Mật khẩu kết nối trên HRM phải là số (Comm Key của máy).');
    config.commKey = Number(commKey);
    applied.push('Comm Key');
  }

  config.direction = ['IN', 'OUT', 'BOTH'].includes(remote.direction) ? remote.direction : 'BOTH';
  config.expectedSerial = String(remote.serial_number ?? '').trim() || undefined;
  return applied;
}
