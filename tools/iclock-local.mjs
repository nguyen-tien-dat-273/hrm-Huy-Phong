// Máy chủ thử ADMS chạy trên máy dev, để máy chấm công gọi vào qua LAN bằng HTTP thường.
//
//   pnpm iclock:local            # dry-run: chỉ ghi log, POST luôn trả 500 để máy GIỮ dữ liệu
//   pnpm iclock:local -- --live  # chuyển tiếp thật vào handler → Supabase
//
// Dùng lại đúng api/iclock/*.ts của bản deploy, nên chạy được ở đây là chạy được trên Vercel
// (trừ khoản HTTPS). Mô phỏng cách Vercel parse thân request để lộ sớm lỗi "[object Object]".

import { createServer } from 'node:http';
import { parse as parseQuery } from 'node:querystring';

process.env.ATTENDANCE_DEVICE_SERIALS ||= '1313245000324';

const port = Number(process.env.ICLOCK_PORT || 8081);
const live = process.argv.includes('--live');

const [{ default: cdata }, { default: getrequest }, { default: devicecmd }] = await Promise.all([
  import('../api/iclock/cdata.ts'),
  import('../api/iclock/getrequest.ts'),
  import('../api/iclock/devicecmd.ts'),
]);
const routes = new Map([
  ['/iclock/cdata', cdata],
  ['/iclock/getrequest', getrequest],
  ['/iclock/devicecmd', devicecmd],
]);

const stamp = () => new Date().toLocaleTimeString('vi-VN', { hour12: false });

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks);
}

/** Giống Vercel: urlencoded → object, còn lại → chuỗi (hoặc Buffer nếu nhị phân). */
function vercelBody(raw, contentType = '') {
  if (!raw.length) return undefined;
  if (contentType.includes('application/x-www-form-urlencoded')) return parseQuery(raw.toString('utf8'));
  if (contentType.includes('application/json')) {
    try { return JSON.parse(raw.toString('utf8')); } catch { return raw.toString('utf8'); }
  }
  return raw.toString('utf8');
}

createServer(async (request, response) => {
  const raw = await readBody(request);
  const contentType = String(request.headers['content-type'] || '');
  const path = new URL(request.url || '/', 'http://x').pathname.toLowerCase();

  console.log(`\n[${stamp()}] ${request.socket.remoteAddress} ${request.method} ${request.url}`);
  console.log(`  content-type: ${contentType || '(không có)'}  | body: ${raw.length} byte`);
  if (raw.length) console.log('  ' + JSON.stringify(raw.toString('utf8').slice(0, 600)));

  const handler = routes.get(path);
  if (!handler) {
    console.log('  → 404 (đường dẫn không có handler)');
    response.statusCode = 404;
    return response.end('Not found');
  }

  const isPush = request.method === 'POST' && path === '/iclock/cdata';
  if (isPush && !live) {
    console.log('  → DRY-RUN: trả 500 để máy giữ nguyên dữ liệu (thêm --live để nạp thật)');
    response.statusCode = 500;
    return response.end('ERROR: dry-run');
  }

  const body = vercelBody(raw, contentType);
  if (body && typeof body === 'object') console.warn('  ⚠ Vercel sẽ parse thân thành OBJECT — rawBody() ở cdata.ts sẽ hỏng');

  const res = {
    status(code) { response.statusCode = code; return this; },
    setHeader: (name, value) => response.setHeader(name, value),
    send: (text) => response.end(text),
  };
  await handler({ method: request.method, url: request.url, headers: request.headers, body }, res);
  console.log(`  → ${response.statusCode}`);
  if (!response.writableEnded) response.end();
}).listen(port, '0.0.0.0', () => {
  console.log(`ADMS thử nghiệm: http://0.0.0.0:${port}/iclock/*  (${live ? 'LIVE — nạp thật' : 'DRY-RUN'})`);
  console.log(`Serial cho phép: ${process.env.ATTENDANCE_DEVICE_SERIALS}`);
});
