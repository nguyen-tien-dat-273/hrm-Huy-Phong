// ============================================================================
// Máy chấm công tự đẩy dữ liệu lên HRM (giao thức PUSH / ADMS của ZKTeco).
// ----------------------------------------------------------------------------
// Đảo chiều so với bridge: không ai đi đọc máy nữa, chính máy gọi ra.
//
//   bridge:  máy tính trong LAN  ──đọc 4370──>  máy chấm công
//   ADMS:    máy chấm công  ──HTTPS──>  endpoint này
//
// Nhờ đảo chiều mà không cần máy tính nào trong văn phòng: địa chỉ 192.168.x.x
// của máy chấm công không gọi vào được từ Internet, nhưng từ trong gọi ra thì
// bình thường.
//
// Máy gọi hai kiểu vào CÙNG đường dẫn này:
//
//   GET  /iclock/cdata?SN=...&options=all   → xin cấu hình (bắt tay)
//   POST /iclock/cdata?SN=...&table=ATTLOG  → đẩy các lần quét
//
// Thân POST là văn bản thuần, mỗi dòng một lần quét, các cột ngăn bằng Tab:
//
//   1234⇥2026-10-10 07:32:11⇥0⇥1⇥0⇥0
//   mã NV  thời điểm            tt vm
//
// Dữ liệu nhận được đổ vào ĐÚNG `ingest_attendance_device_events` mà bridge
// đang dùng. Toàn bộ phần khó — ánh xạ mã nhân viên, chống trùng, dựng ngày
// công, giành quyền với check-in tự khai — đã viết và sửa qua nhiều vòng rồi.
// Không làm lại cái nào.
//
// CẢNH BÁO: giao thức này KHÔNG có xác thực. Máy chỉ xưng danh bằng số sê-ri
// trên URL, không gửi được token hay header riêng. Nên phải chặn bằng danh
// sách sê-ri khai trước trong biến môi trường. Ai biết sê-ri vẫn giả mạo được
// — đó là giới hạn của giao thức, không phải của chỗ này.
// ============================================================================

import { createClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';

type ApiRequest = {
  method?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
};

type ApiResponse = {
  status: (code: number) => ApiResponse;
  setHeader: (name: string, value: string) => void;
  send: (body: string) => void;
};

/** Trả lời máy bằng văn bản thuần. Máy KHÔNG hiểu JSON. */
function text(response: ApiResponse, status: number, body: string) {
  response.setHeader('Content-Type', 'text/plain; charset=utf-8');
  response.status(status).send(body);
}

const env = (...names: string[]) => names.map((name) => process.env[name]).find((value) => value && value.trim()) || '';

/**
 * Múi giờ của máy. Máy gửi giờ ĐỊA PHƯƠNG không kèm múi giờ, nên phải tự gắn
 * vào — không gắn thì Postgres hiểu thành UTC và mọi lần quét lùi 7 tiếng,
 * đủ để một ca sáng rơi sang ngày hôm trước.
 */
const utcOffset = env('ATTENDANCE_UTC_OFFSET') || '+07:00';

const codeSet = (raw: string, fallback: string) =>
  new Set((raw || fallback).split(',').map((value) => Number(value.trim())).filter(Number.isFinite));
const inCodes = codeSet(env('RJ_IN_STATUS_CODES'), '0,2,4');
const outCodes = codeSet(env('RJ_OUT_STATUS_CODES'), '1,3,5');

/** Sê-ri được phép đẩy dữ liệu. Rỗng = chặn hết, vì mở cho mọi sê-ri là mở cho cả Internet. */
const allowedSerials = new Set(
  (env('ATTENDANCE_DEVICE_SERIALS') || '').split(',').map((value) => value.trim()).filter(Boolean),
);

function query(request: ApiRequest) {
  // `req.url` chỉ có phần path trở đi; thêm host giả để URL() chịu phân tích.
  const url = new URL(request.url || '/', 'http://device.local');
  const out: Record<string, string> = {};
  url.searchParams.forEach((value, key) => { out[key.toLowerCase()] = value; });
  return out;
}

/** Thân request có thể tới dạng chuỗi, Buffer, hoặc đã bị parse thành object. */
function rawBody(body: unknown): string {
  if (typeof body === 'string') return body;
  if (Buffer.isBuffer(body)) return body.toString('utf8');
  if (body && typeof body === 'object') return String((body as { toString(): string }).toString());
  return '';
}

interface DeviceEvent {
  external_id: string;
  device_user_id: string;
  punched_at: string;
  punch_type: 'IN' | 'OUT' | 'AUTO';
  verify_mode: string;
  raw_payload: Record<string, unknown>;
}

/**
 * Đổi một dòng ATTLOG thành sự kiện đúng khuôn mà RPC đang chờ.
 *
 * `external_id` phải ổn định để gửi lại cùng một lần quét không sinh thêm
 * dòng — RPC chống trùng bằng `on conflict (device_id, external_id)`. Băm
 * thêm tiền tố 'adms' để không đụng không gian băm của bridge: hai bên băm từ
 * nguồn khác nhau nên cùng một lần quét sẽ ra hai mã. Chạy song song trong
 * lúc thử thì sự kiện thô bị đôi, nhưng ngày công thì không — RPC gom theo
 * người-và-ngày trước khi dựng bản ghi chấm công.
 */
function toEvent(line: string, serial: string): DeviceEvent | null {
  const cols = line.split('\t').map((value) => value.trim());
  const [pin, stamp, statusRaw, verifyRaw, workcode] = cols;
  if (!pin || !stamp) return null;

  // Máy gửi "YYYY-MM-DD HH:MM:SS". Từ chối mọi khuôn khác thay vì đoán bừa.
  const match = stamp.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})$/);
  if (!match) return null;

  const status = Number(statusRaw);
  const punch_type = outCodes.has(status) ? 'OUT' : inCodes.has(status) ? 'IN' : 'AUTO';

  return {
    external_id: createHash('sha256')
      .update(['adms', serial, pin, `${match[1]} ${match[2]}`, statusRaw ?? '', verifyRaw ?? ''].join('|'))
      .digest('hex'),
    device_user_id: pin,
    punched_at: `${match[1]}T${match[2]}${utcOffset}`,
    punch_type,
    verify_mode: verifyRaw || '',
    raw_payload: { source: 'ADMS', serial, status: statusRaw, verify_mode: verifyRaw, workcode, line },
  };
}

/**
 * Cấu hình trả cho máy lúc bắt tay.
 *
 * `Delay` là số giây giữa hai lần máy hỏi lệnh. Để mặc định 10 giây thì mỗi
 * ngày ~8.600 lượt gọi hàm serverless cho một việc gần như luôn trả về "OK".
 * Đặt 60 giây: vẫn nhận dữ liệu tức thì nhờ `Realtime=1`, mà số lượt gọi còn
 * một phần sáu.
 */
function handshake(serial: string) {
  return [
    `GET OPTION FROM: ${serial}`,
    'ATTLOGStamp=None',
    'OPERLOGStamp=None',
    'ATTPHOTOStamp=None',
    'ErrorDelay=60',
    'Delay=60',
    'TransTimes=00:00;12:00',
    'TransInterval=1',
    'TransFlag=1000000000',
    `TimeZone=${Number(utcOffset.slice(0, 3))}`,
    'Realtime=1',
    'Encrypt=0',
  ].join('\n');
}

export default async function handler(request: ApiRequest, response: ApiResponse) {
  const params = query(request);
  const serial = (params.sn || '').trim();

  if (!serial) return text(response, 400, 'ERROR: thiếu SN');
  if (!allowedSerials.has(serial)) {
    // Kèm SỐ LƯỢNG sê-ri đã khai, không kèm giá trị. Hai nguyên nhân của lỗi
    // này nhìn giống hệt nhau từ bên ngoài, mà cách sửa thì ngược nhau:
    //   0  → biến ATTENDANCE_DEVICE_SERIALS chưa tới được hàm (chưa deploy lại,
    //        sai tên biến, hoặc chưa tick đúng Environment)
    //   >0 → biến có tới, nhưng giá trị không khớp (thừa dấu cách, sai chữ số)
    // Con số này không tiết lộ gì: nó chỉ nói "có mấy máy được khai".
    console.warn(`[iclock] từ chối sê-ri "${serial}" — đã khai ${allowedSerials.size} sê-ri`);
    return text(response, 403, `ERROR: thiet bi chua dang ky (da khai ${allowedSerials.size} serial)`);
  }

  if (request.method === 'GET') return text(response, 200, handshake(serial));
  if (request.method !== 'POST') return text(response, 405, 'ERROR: method');

  // Máy đẩy nhiều bảng qua cùng đường dẫn. Bảng nào không phải chấm công thì
  // vẫn phải trả OK, nếu không máy coi là lỗi và thử lại mãi.
  const table = (params.table || '').toUpperCase();
  if (table && table !== 'ATTLOG') return text(response, 200, 'OK');

  const lines = rawBody(request.body).split(/\r?\n/).filter((line) => line.trim() !== '');
  const events = lines.map((line) => toEvent(line, serial)).filter((event): event is DeviceEvent => event !== null);
  const skipped = lines.length - events.length;
  if (skipped > 0) console.warn(`[iclock] ${serial}: bỏ qua ${skipped}/${lines.length} dòng sai khuôn`);
  if (events.length === 0) return text(response, 200, 'OK: 0');

  // Hai cách xác thực với Supabase, ưu tiên cách không cần token:
  //   1. SUPABASE_SERVICE_ROLE_KEY có → tra máy theo sê-ri (hàm chỉ service role gọi được).
  //   2. Không có → dùng ATTENDANCE_BRIDGE_TOKEN như bridge.
  const supabaseUrl = env('SUPABASE_URL', 'VITE_SUPABASE_URL');
  const anonKey = env('SUPABASE_ANON_KEY', 'VITE_SUPABASE_ANON_KEY');
  const serviceKey = env('SUPABASE_SERVICE_ROLE_KEY');
  const bridgeToken = env('ATTENDANCE_BRIDGE_TOKEN').trim();
  if (!supabaseUrl || !(serviceKey || (anonKey && bridgeToken))) {
    console.error('[iclock] thiếu SUPABASE_URL và (SUPABASE_SERVICE_ROLE_KEY hoặc ATTENDANCE_BRIDGE_TOKEN + anon key)');
    return text(response, 500, 'ERROR: server chua cau hinh');
  }

  const supabase = createClient(supabaseUrl, serviceKey || anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  let bySerial = Boolean(serviceKey);

  // Chia lô như bridge: một lần quét cả ngày của 46 người vẫn gọn, nhưng lần
  // đẩy bù sau nhiều ngày mất kết nối thì có thể hàng nghìn dòng.
  let inserted = 0;
  for (let offset = 0; offset < events.length; offset += 500) {
    const batch = events.slice(offset, offset + 500);
    let { data, error } = bySerial
      ? await supabase.rpc('ingest_attendance_device_events_by_serial', { device_serial: serial, events: batch })
      : await supabase.rpc('ingest_attendance_device_events', { bridge_token: bridgeToken, events: batch });

    // Chưa chạy migration theo sê-ri thì lùi về token nếu có, thay vì chặn đứng.
    if (bySerial && error && /does not exist|schema cache/i.test(error.message || '') && bridgeToken && anonKey) {
      console.warn(`[iclock] ${serial}: chưa có hàm theo sê-ri, dùng token`);
      bySerial = false;
      ({ data, error } = await createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
        .rpc('ingest_attendance_device_events', { bridge_token: bridgeToken, events: batch }));
    }
    if (error) {
      console.error(`[iclock] ${serial}: Supabase từ chối — ${error.message}`);
      // Trả lỗi để máy GIỮ LẠI dữ liệu và đẩy lại sau. Trả OK ở đây là đồng ý
      // nhận rồi vứt đi: máy đánh dấu đã gửi và không bao giờ gửi lại nữa.
      return text(response, 500, 'ERROR: khong nap duoc');
    }
    const code = (data as { code?: string } | null)?.code;
    if (code === 'UNKNOWN_DEVICE') {
      console.error(`[iclock] ${serial}: sê-ri này chưa khai (hoặc đang tắt) trong HRM > Máy chấm công`);
      return text(response, 500, 'ERROR: may chua khai trong HRM');
    }
    if (code === 'AUTH_FAILED') {
      console.error(`[iclock] ${serial}: ATTENDANCE_BRIDGE_TOKEN sai hoặc đã thu hồi`);
      return text(response, 500, 'ERROR: token');
    }
    inserted += Number((data as { inserted?: number } | null)?.inserted || 0);
  }

  console.log(`[iclock] ${serial}: nhận ${events.length} lần quét, thêm mới ${inserted}`);
  return text(response, 200, `OK: ${events.length}`);
}
