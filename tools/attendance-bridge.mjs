#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { ZkDevice } from 'zkteco-protocol';

function required(name, fallback) {
  const value = process.env[name] || fallback;
  if (!value) throw new Error(`Thiếu biến môi trường ${name}.`);
  return value;
}

function integer(name, fallback) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value)) throw new Error(`${name} phải là số nguyên.`);
  return value;
}

// Khai rong co chu dich: co may khong dung truong status de danh dau vao/ra
// (may Ronald Jack o day chi phat 1 va 15, ca hai deu roi vao gio den). Phai
// phan biet "khong khai" voi "khai la khong co ma nao" - dung `||` thi chuoi
// rong roi ve mac dinh 0,2,4 va moi lan quet sang bi doc thanh gio ra.
function codeSet(name, fallback) {
  const raw = process.env[name] ?? fallback;
  return new Set(raw
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value !== '')
    .map(Number)
    .filter(Number.isFinite));
}

const config = {
  host: required('RJ_DEVICE_IP'),
  port: integer('RJ_DEVICE_PORT', 4370),
  transport: (process.env.RJ_TRANSPORT || 'tcp').toLowerCase(),
  commKey: integer('RJ_COMM_KEY', 0),
  timeoutMs: integer('RJ_TIMEOUT_MS', 10000),
  utcOffset: process.env.RJ_UTC_OFFSET || '+07:00',
  pollMinutes: integer('RJ_POLL_MINUTES', 5),
  backfillDays: integer('RJ_BACKFILL_DAYS', 0),
  commandPollSeconds: integer('RJ_COMMAND_POLL_SECONDS', 20),
  once: process.argv.includes('--once'),
  supabaseUrl: required('SUPABASE_URL', process.env.VITE_SUPABASE_URL),
  supabaseAnonKey: required('SUPABASE_ANON_KEY', process.env.VITE_SUPABASE_ANON_KEY),
  bridgeToken: required('ATTENDANCE_BRIDGE_TOKEN'),
  inCodes: codeSet('RJ_IN_STATUS_CODES', '0,2,4'),
  outCodes: codeSet('RJ_OUT_STATUS_CODES', '1,3,5'),
};

if (!['tcp', 'udp'].includes(config.transport)) throw new Error('RJ_TRANSPORT chỉ nhận tcp hoặc udp.');
if (!/^[+-](0\d|1\d|2[0-3]):[0-5]\d$/.test(config.utcOffset)) {
  throw new Error('RJ_UTC_OFFSET phải có dạng +07:00.');
}
if (config.pollMinutes < 1) throw new Error('RJ_POLL_MINUTES phải từ 1 trở lên.');
if (config.backfillDays < 0) throw new Error('RJ_BACKFILL_DAYS không được âm.');
if (config.commandPollSeconds < 5) throw new Error('RJ_COMMAND_POLL_SECONDS phải từ 5 trở lên.');

const supabase = createClient(config.supabaseUrl, config.supabaseAnonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Giao thức không có lệnh "đọc từ mốc X"; thư viện tải hết rồi lọc phía client.
// Vẫn đáng đặt: máy giữ nhiều năm log thì mỗi vòng poll đỡ phải dựng lại toàn bộ
// mảng sự kiện và đỡ phải băm sha256 cho từng bản ghi cũ đã đồng bộ từ lâu.
function backfillSince() {
  if (config.backfillDays <= 0) return undefined;
  const sign = config.utcOffset.startsWith('-') ? -1 : 1;
  const [offsetHours, offsetMinutes] = config.utcOffset.slice(1).split(':').map(Number);
  const offsetMs = sign * (offsetHours * 60 + offsetMinutes) * 60_000;
  // Dịch instant theo offset rồi đọc bằng getUTC*: ra đúng giờ treo tường của máy,
  // không phụ thuộc timezone của máy tính đang chạy bridge.
  const shifted = new Date(Date.now() - config.backfillDays * 86_400_000 + offsetMs);
  const pad = (value) => String(value).padStart(2, '0');
  const parts = {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    second: shifted.getUTCSeconds(),
  };
  return {
    ...parts,
    local: parts.year + '-' + pad(parts.month) + '-' + pad(parts.day)
      + 'T' + pad(parts.hour) + ':' + pad(parts.minute) + ':' + pad(parts.second),
  };
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function toEvent(log) {
  if (!log.userId) return null;
  const local = log.timestamp?.local;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(local || '')) return null;
  const punchedAt = `${local}${config.utcOffset}`;
  const direction = config.outCodes.has(log.status)
    ? 'OUT'
    : config.inCodes.has(log.status)
      ? 'IN'
      : 'AUTO';
  const identity = [log.userId, local, log.status, log.verifyMode, log.raw].join('|');
  return {
    external_id: sha256(identity),
    device_user_id: String(log.userId).trim(),
    punched_at: punchedAt,
    punch_type: direction,
    verify_mode: String(log.verifyMode),
    raw_payload: {
      uid: log.uid,
      status: log.status,
      verify_mode: log.verifyMode,
      record_size: log.recordSize,
      user_id_source: log.userIdSource,
      raw: log.raw,
    },
  };
}

async function push(events) {
  let inserted = 0;
  let processed = 0;
  // `unmapped` KHÁC hai số kia: RPC trả về tổng số bản ghi đang chờ ánh xạ của
  // CẢ thiết bị, không phải của riêng lô vừa gửi. Cộng dồn qua 15 lô thì ra
  // 59870 cho một máy chỉ có 7370 bản ghi — con số vô nghĩa mà vẫn trông như
  // thật. Lấy giá trị của lô cuối, vì đó mới là tổng sau khi nạp xong.
  let unmapped = 0;
  for (let offset = 0; offset < events.length; offset += 500) {
    const batch = events.slice(offset, offset + 500);
    const { data, error } = await supabase.rpc('ingest_attendance_device_events', {
      bridge_token: config.bridgeToken,
      events: batch,
    });
    if (error) throw new Error(`Supabase từ chối đồng bộ: ${error.message}`);
    if (data?.ok === false && data?.code === 'AUTH_FAILED') {
      throw new Error('Token bridge sai, đã hết hạn hoặc đã bị thu hồi. Tạo token mới trong HRM và cập nhật cấu hình bridge.');
    }
    inserted += Number(data?.inserted || 0);
    processed += Number(data?.processed || 0);
    unmapped = Number(data?.unmapped || 0);
  }
  return { inserted, processed, unmapped };
}

async function syncOnce() {
  const started = new Date();
  const device = new ZkDevice({
    host: config.host,
    port: config.port,
    transport: config.transport,
    commKey: config.commKey,
    timeoutMs: config.timeoutMs,
  });
  try {
    await device.connect();
    // Giao thức thiết bị chỉ có một session/reply-id; đọc tuần tự để firmware
    // cũ không trả nhầm response khi nhiều lệnh đi cùng lúc.
    const identity = await device.getIdentity();
    const info = await device.getInfo();
    const since = backfillSince();
    const logs = await device.getAttendanceLogs(since ? { since } : undefined);
    const events = logs.map(toEvent).filter(Boolean);
    const skipped = logs.length - events.length;
    const result = events.length ? await push(events) : { inserted: 0, processed: 0, unmapped: 0 };
    console.log(JSON.stringify({
      at: started.toISOString(),
      device: identity.deviceName || config.host,
      serialNumber: identity.serialNumber || undefined,
      deviceRecords: info.recordCount,
      read: logs.length,
      skipped,
      ...result,
    }));
  } finally {
    await device.disconnect().catch(() => undefined);
  }
}

let syncing = false;
async function guardedSync() {
  if (syncing) return;
  syncing = true;
  try {
    await syncOnce();
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Đồng bộ thất bại:`, error instanceof Error ? error.message : error);
    if (config.once) process.exitCode = 1;
  } finally {
    syncing = false;
  }
}

// Website chạy trên Vercel không với tới được IP nội bộ của máy chấm công, nên
// nút "Đồng bộ ngay" trên HRM chỉ đặt một cờ trong database. Bridge đang ở trong
// LAN hỏi cờ đó vài chục giây một lần rồi đọc máy — người dùng thấy như bấm là chạy.
let commandPollingDisabled = false;
async function pollCommands() {
  if (commandPollingDisabled || syncing) return;
  const { data, error } = await supabase.rpc('claim_attendance_device_sync', {
    bridge_token: config.bridgeToken,
  });
  if (error) {
    // Chưa chạy migration thì tắt hẳn vòng hỏi, đừng để nó rính rích báo lỗi mãi:
    // đồng bộ theo lịch vẫn chạy bình thường mà không cần tính năng này.
    if (/does not exist|schema cache|function public/i.test(error.message || '')) {
      commandPollingDisabled = true;
      console.warn('Chưa có RPC claim_attendance_device_sync — nút "Đồng bộ ngay" trên HRM sẽ không tác dụng.');
      console.warn('Chạy supabase/paste-cap-nhat-dong-bo.sql để bật.');
      return;
    }
    console.error(`[${new Date().toISOString()}] Hỏi lệnh thất bại:`, error.message);
    return;
  }
  if (data?.sync_requested) {
    console.log(`[${new Date().toISOString()}] Nhận lệnh đồng bộ từ HRM.`);
    await guardedSync();
  }
}

await guardedSync();
if (!config.once) {
  console.log(`Bridge đang chạy; đồng bộ mỗi ${config.pollMinutes} phút, hỏi lệnh mỗi ${config.commandPollSeconds} giây.`);
  setInterval(guardedSync, config.pollMinutes * 60_000);
  setInterval(pollCommands, config.commandPollSeconds * 1000);
}
