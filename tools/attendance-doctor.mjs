#!/usr/bin/env node

// Dò toàn bộ đường đi trước khi bật bridge: máy chấm công -> mạng LAN -> Supabase.
// Chỉ ĐỌC từ máy chấm công. Không tự tạo ngày công nào trong HRM.
//
// Vì sao cần script riêng: `attendance-bridge.mjs` làm mọi mắt trong một lần
// chạy rồi đẩy luôn lên Supabase, nên khi sai một mắt (IP, comm key, token, mã
// nhân viên) thì chỉ thấy đúng một dòng "Đồng bộ thất bại" mà không biết mắt
// nào. Script này tách từng mắt và dừng ngay tại chỗ hỏng.

import net from 'node:net';
import { createClient } from '@supabase/supabase-js';
import { ZkAuthError, ZkConnectionError, ZkDevice, ZkTimeoutError } from 'zkteco-protocol';

const args = process.argv.slice(2);
const wantUsers = args.includes('--users');
const logsArg = args.find((value) => value.startsWith('--logs'));
const logsLimit = logsArg ? Number(logsArg.split('=')[1] || 10) : 0;
const skipSupabase = args.includes('--no-supabase');

const ok = (text) => console.log(`  \x1b[32m/\x1b[0m ${text}`);
const bad = (text) => console.log(`  \x1b[31mX\x1b[0m ${text}`);
const warn = (text) => console.log(`  \x1b[33m!\x1b[0m ${text}`);
const info = (text) => console.log(`    ${text}`);
const step = (text) => console.log(`\n\x1b[1m${text}\x1b[0m`);

let failed = false;
function fail(text, hint) {
  failed = true;
  bad(text);
  if (hint) info(`-> ${hint}`);
}

// ------------------------------------------------------------ 1. Biến môi trường
step('1. Bien moi truong');

const env = {
  host: process.env.RJ_DEVICE_IP,
  port: Number(process.env.RJ_DEVICE_PORT || 4370),
  transport: (process.env.RJ_TRANSPORT || 'tcp').toLowerCase(),
  commKey: Number(process.env.RJ_COMM_KEY || 0),
  timeoutMs: Number(process.env.RJ_TIMEOUT_MS || 10000),
  utcOffset: process.env.RJ_UTC_OFFSET || '+07:00',
  pollMinutes: Number(process.env.RJ_POLL_MINUTES || 5),
  backfillDays: Number(process.env.RJ_BACKFILL_DAYS || 0),
  supabaseUrl: process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY,
  bridgeToken: process.env.ATTENDANCE_BRIDGE_TOKEN,
};

if (!env.host) {
  fail('RJ_DEVICE_IP con trong.', 'Xem IP ngay tren may cham cong: Menu > Comm > Ethernet.');
} else if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(env.host)) {
  warn(`RJ_DEVICE_IP = ${env.host} (khong phai IPv4; chap nhan neu day la ten may trong LAN).`);
} else {
  ok(`May cham cong: ${env.host}:${env.port} qua ${env.transport.toUpperCase()}`);
}
if (!['tcp', 'udp'].includes(env.transport)) fail(`RJ_TRANSPORT = ${env.transport}`, 'Chi nhan tcp hoac udp.');
if (!Number.isInteger(env.commKey)) fail('RJ_COMM_KEY phai la so nguyen.', 'Chua dat khoa thi de 0.');
if (!/^[+-](0\d|1\d|2[0-3]):[0-5]\d$/.test(env.utcOffset)) {
  fail(`RJ_UTC_OFFSET = ${env.utcOffset}`, 'Phai co dang +07:00.');
} else {
  ok(`Gio tren may duoc hieu la ${env.utcOffset}`);
}
if (!(env.pollMinutes >= 1)) fail('RJ_POLL_MINUTES phai tu 1 tro len.');
else ok(`Bridge se dong bo moi ${env.pollMinutes} phut`);
if (env.backfillDays > 0) ok(`Chi doc log ${env.backfillDays} ngay gan nhat (RJ_BACKFILL_DAYS)`);
else info('RJ_BACKFILL_DAYS = 0: doc toan bo bo nho may moi lan (cham neu may giu nhieu nam log).');

if (!env.supabaseUrl || !env.supabaseAnonKey) {
  fail('Thieu SUPABASE_URL hoac SUPABASE_ANON_KEY.', 'Copy tu .env.local cua website.');
} else {
  ok(`Supabase: ${env.supabaseUrl}`);
}
if (!env.bridgeToken || env.bridgeToken.startsWith('rj_replace')) {
  fail('ATTENDANCE_BRIDGE_TOKEN chua duoc dien.', 'HRM > May cham cong > Tao token bridge (chi hien mot lan).');
} else if (env.bridgeToken.length < 20) {
  fail('ATTENDANCE_BRIDGE_TOKEN qua ngan, RPC se tu choi.', 'Tao lai token trong HRM.');
} else {
  ok(`Token bridge: ${env.bridgeToken.slice(0, 6)}...${env.bridgeToken.slice(-4)}`);
}

if (failed) {
  console.log('\n\x1b[31mDung o buoc bien moi truong.\x1b[0m Sua .env.attendance-bridge roi chay lai.');
  process.exit(1);
}

// ------------------------------------------------------------ 2. Mạng LAN
step('2. Duong mang toi may cham cong');

// Thử TCP riêng trước khi bắt tay giao thức: ECONNREFUSED ở đây nghĩa là sai
// IP/port hoặc firewall, còn lỗi ở bước 3 mới là chuyện giao thức/comm key.
if (env.transport === 'tcp') {
  const reachable = await new Promise((resolve) => {
    const socket = net.connect({ host: env.host, port: env.port });
    const done = (value) => { socket.destroy(); resolve(value); };
    socket.setTimeout(env.timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done('timeout'));
    socket.once('error', (error) => done(error.code || error.message));
  });
  if (reachable === true) {
    ok(`Cong ${env.port} mo.`);
  } else if (reachable === 'timeout') {
    fail(`Khong co phan hoi trong ${env.timeoutMs}ms.`,
      `May tinh nay phai cung mang LAN voi may cham cong. Thu: ping ${env.host}`);
  } else if (reachable === 'ECONNREFUSED') {
    fail(`${env.host} co tren mang nhung dong cong ${env.port}.`,
      'Kiem tra lai RJ_DEVICE_PORT (mac dinh 4370) tren may cham cong.');
  } else {
    fail(`Khong ket noi duoc: ${reachable}`, 'Sai IP, khac dai mang, hoac firewall Windows dang chan.');
  }
} else {
  info('UDP khong kiem tra truoc duoc; doi buoc bat tay ben duoi.');
}

if (failed) {
  console.log('\n\x1b[31mDung o buoc mang.\x1b[0m Chua toi duoc may thi khong can do tiep.');
  process.exit(1);
}

// ------------------------------------------------------------ 3. Bắt tay thiết bị
step('3. Bat tay may cham cong');

const device = new ZkDevice({
  host: env.host,
  port: env.port,
  transport: env.transport,
  commKey: env.commKey,
  timeoutMs: env.timeoutMs,
});

let logs = [];
let users = [];

try {
  await device.connect();
  ok('Da bat tay xong.');

  // Đọc tuần tự: firmware cũ chỉ có một reply-id nên gửi song song sẽ lẫn response.
  const identity = await device.getIdentity();
  info(`Ten may     : ${identity.deviceName ?? '(may tu choi tra loi)'}`);
  info(`Serial      : ${identity.serialNumber ?? '(may tu choi tra loi)'}`);
  info(`Firmware    : ${identity.firmwareVersion ?? '(may tu choi tra loi)'}`);
  info(`Platform/OS : ${identity.platform ?? '?'} / ${identity.os ?? '?'}`);
  if (identity.serialNumber) info('-> Dan serial nay vao HRM > May cham cong cho khop thiet bi.');

  const deviceInfo = await device.getInfo();
  ok(`May dang giu ${deviceInfo.recordCount}/${deviceInfo.recordCapacity} ban ghi, ${deviceInfo.userCount} nguoi dung.`);
  if (deviceInfo.recordCount > 20000 && env.backfillDays === 0) {
    warn('Bo nho nhieu ban ghi ma RJ_BACKFILL_DAYS=0: moi lan dong bo se doc lai toan bo.');
    info('-> Dat RJ_BACKFILL_DAYS=30 de bridge chi doc 30 ngay gan nhat.');
  }

  // Lệch giờ máy là lỗi âm thầm nhất: ngày công vẫn vào nhưng giờ vào/ra sai.
  const deviceTime = await device.getTime();
  const deviceMs = Date.parse(`${deviceTime.local}${env.utcOffset}`);
  const driftMinutes = Number.isFinite(deviceMs) ? Math.round((deviceMs - Date.now()) / 60000) : NaN;
  if (!Number.isFinite(driftMinutes)) {
    warn(`Dong ho may tra ve ${deviceTime.local} - khong doc duoc thanh moc thoi gian.`);
  } else if (Math.abs(driftMinutes) <= 2) {
    ok(`Dong ho may: ${deviceTime.local} (khop may tinh nay, lech ${driftMinutes} phut).`);
  } else {
    warn(`Dong ho may lech ${driftMinutes} phut so voi may tinh nay (may: ${deviceTime.local}).`);
    info('-> Gio vao/ra se sai dung bang khoang lech nay. Chinh gio ngay tren may cham cong.');
  }

  users = await device.getUsers();
  logs = await device.getAttendanceLogs();
  ok(`Doc duoc ${logs.length} ban ghi cham cong.`);
} catch (error) {
  if (error instanceof ZkAuthError) {
    fail('May tu choi comm key.',
      'Sua RJ_COMM_KEY cho khop comm key tren may - Comm > PC Connection, '
      + `firmware cu ghi la Security hoac COMM Key (hien dang gui ${env.commKey}).`);
  } else if (error instanceof ZkTimeoutError) {
    fail('May im lang qua han.', 'Thu RJ_TRANSPORT=udp, hoac tang RJ_TIMEOUT_MS.');
  } else if (error instanceof ZkConnectionError) {
    fail(`Mat ket noi: ${error.message}`,
      'May co the dang phuc vu ket noi khac - dong phan mem quan ly may roi thu lai.');
  } else {
    fail(`Loi giao thuc: ${error instanceof Error ? error.message : error}`);
  }
} finally {
  await device.disconnect().catch(() => undefined);
}

if (failed) {
  console.log('\n\x1b[31mDung o buoc thiet bi.\x1b[0m');
  process.exit(1);
}

// ------------------------------------------------------------ 4. Mã nhân viên
step('4. Ma nhan vien tren may');

if (users.length === 0) {
  warn('May khong tra ve danh sach nguoi dung nao.');
  info('-> Chua dang ky van tay/khuon mat, hoac firmware khong cho doc danh sach.');
} else {
  ok(`${users.length} nguoi da dang ky tren may.`);
  info('Moi "Ma may" duoi day phai khop employee_code trong HRM, neu khong thi phai anh xa tay.');
  const rows = wantUsers ? users : users.slice(0, 15);
  console.log('');
  console.log('    Ma may      Ten tren may               Khac');
  console.log('    ----------  -------------------------  ---------------');
  for (const user of rows) {
    const code = String(user.userId || '').padEnd(10);
    const name = String(user.name || '(khong ten)').slice(0, 25).padEnd(25);
    const extra = [user.hasPassword ? 'mat khau' : null, user.cardNumber ? `the ${user.cardNumber}` : null]
      .filter(Boolean).join(', ') || '-';
    console.log(`    ${code}  ${name}  ${extra}`);
  }
  if (!wantUsers && users.length > rows.length) {
    console.log(`\n    ... con ${users.length - rows.length} nguoi. Them \x1b[1m--users\x1b[0m de xem het.`);
  }
  const noId = users.filter((user) => !user.userId).length;
  if (noId > 0) {
    warn(`${noId} nguoi khong co ma tren may - ban ghi cua ho se bi bo qua.`);
    info('-> Dat User ID cho ho ngay tren may cham cong.');
  }
}

// ------------------------------------------------------------ 5. Log mẫu
if (logsLimit > 0 && logs.length > 0) {
  step(`5. ${Math.min(logsLimit, logs.length)} lan cham gan nhat`);
  const recent = [...logs].sort((a, b) => (a.timestamp.local < b.timestamp.local ? 1 : -1)).slice(0, logsLimit);
  const inCodes = new Set((process.env.RJ_IN_STATUS_CODES || '0,2,4').split(',').map(Number));
  const outCodes = new Set((process.env.RJ_OUT_STATUS_CODES || '1,3,5').split(',').map(Number));
  console.log('');
  console.log('    Thoi diem            Ma may      status  Bridge hieu la');
  console.log('    -------------------  ----------  ------  --------------');
  for (const log of recent) {
    const direction = outCodes.has(log.status) ? 'RA' : inCodes.has(log.status) ? 'VAO' : 'AUTO (tu suy)';
    const stamp = log.timestamp.local.replace('T', ' ');
    console.log(`    ${stamp}  ${String(log.userId || '-').padEnd(10)}  ${String(log.status).padEnd(6)}  ${direction}`);
  }
  const statuses = [...new Set(logs.map((log) => log.status))].sort((a, b) => a - b);
  console.log(`\n    Cac ma status may nay dung: ${statuses.join(', ')}`);
  info('Neu cot "Bridge hieu la" sai, sua RJ_IN_STATUS_CODES / RJ_OUT_STATUS_CODES cho khop.');
  info('Toan bo AUTO cung khong sao: bridge lay lan dau la VAO, lan cuoi la RA.');
}

// ------------------------------------------------------------ 6. Supabase
if (skipSupabase) {
  step('6. Supabase - bo qua (--no-supabase)');
} else {
  step('6. Token va RPC tren Supabase');
  const supabase = createClient(env.supabaseUrl, env.supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  // Gửi mảng rỗng: đủ để RPC xác thực token nhưng không tạo bản ghi chấm công mới.
  const { data, error } = await supabase.rpc('ingest_attendance_device_events', {
    bridge_token: env.bridgeToken,
    events: [],
  });
  if (error) {
    const message = error.message || '';
    if (/does not exist|schema cache|function public/i.test(message)) {
      fail('Supabase chua co RPC ingest_attendance_device_events.',
        'Chay migration 20260926100000_attendance_devices.sql roi 20260927130000_attendance_device_autoapprove.sql.');
    } else if (/Khoa bridge sai|het han|thu hoi/i.test(message)) {
      fail('Token bi tu choi: sai, het han, da thu hoi, hoac thiet bi dang tat (is_active = false).',
        'HRM > May cham cong > Tao token bridge, roi dan lai vao .env.attendance-bridge.');
    } else if (/Khoa bridge khong hop le/i.test(message)) {
      fail('Token khong dung dinh dang.', 'Dan lai nguyen van token rj_... tu HRM.');
    } else {
      fail(`Supabase tu choi: ${message}`);
    }
  } else {
    ok(`Token hop le, RPC chay duoc (sync_id ${data?.sync_id || '-'}).`);
    if (Number(data?.unmapped || 0) > 0) {
      warn(`${data.unmapped} ban ghi cu dang cho vi ma may chua anh xa toi nhan vien.`);
      info('-> HRM > May cham cong > Ma chua anh xa, bam vao ma roi chon nhan vien.');
    }
    if (Number(data?.processed || 0) > 0) {
      info(`Lan do nay xu ly not ${data.processed} ban ghi dang cho.`);
    }
  }
}

console.log('');
if (failed) {
  console.log('\x1b[31mCon loi o tren - sua xong chay lai: pnpm attendance:doctor\x1b[0m');
  process.exit(1);
}
console.log('\x1b[32mMoi mat deu thong.\x1b[0m Dong bo that mot lan:  pnpm attendance:sync');
console.log('Roi chay lien tuc:  pnpm attendance:bridge');
