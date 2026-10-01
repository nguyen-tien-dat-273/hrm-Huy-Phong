// ============================================================================
// Đóng dấu thời gian build vào sw.js sau khi Vite build xong.
// ----------------------------------------------------------------------------
// Vì sao phải làm: file trong `client/public/` được chép nguyên văn sang thư
// mục build, nên mỗi lần deploy cho ra một `sw.js` GIỐNG HỆT NHAU đến từng
// byte. Trình duyệt tải về, thấy không khác gì bản đang chạy, nên không cài
// worker mới và không bắn `controllerchange` — mà `controllerchange` chính là
// thứ `main.tsx` dựa vào để tự tải lại trang.
//
// Hệ quả thật: deploy xong, người dùng đang mở app trên điện thoại vẫn chạy
// bản cũ cho tới khi họ tự bấm tải lại. Họ không có lý do gì để nghĩ tới
// chuyện đó, nên với họ là "sửa rồi mà có thấy gì đâu".
//
// Vì sao không làm bằng plugin Vite: cả `generateBundle` lẫn `closeBundle`
// đều chạy trước bước chép `public/`, nên thay chuỗi ở đó bị ghi đè lại.
// Chạy sau `vite build` là chắc chắn.
// ============================================================================

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const file = resolve('client/dist/sw.js');

if (!existsSync(file)) {
  console.error('stamp-sw: không thấy client/dist/sw.js — bỏ qua.');
  process.exit(0);
}

const buildId = Date.now().toString(36);

// Vite chép `public/` xong SAU khi `vite build` trả về, nên lần ghi đầu hay
// bị bản gốc đè lại. Ghi rồi đọc kiểm, chưa được thì chờ chút ghi lại.
//
// Thất bại thì THOÁT LỖI chứ không bỏ qua: một sw.js không đóng dấu trông y
// hệt bản đóng dấu, chỉ khác là cơ chế tự tải lại không bao giờ chạy — đúng
// thứ im lặng mà script này sinh ra để chặn.
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

for (let attempt = 1; attempt <= 12; attempt += 1) {
  const source = readFileSync(file, 'utf8');

  if (source.includes(`hrm-${buildId}`)) {
    console.log(`stamp-sw: sw.js đóng dấu hrm-${buildId} (lần ${attempt})`);
    process.exit(0);
  }

  if (!source.includes('__BUILD_ID__')) {
    console.error('stamp-sw: sw.js không có __BUILD_ID__ — kiểm tra lại client/public/sw.js.');
    process.exit(1);
  }

  writeFileSync(file, source.replace('__BUILD_ID__', buildId), 'utf8');
  await sleep(120);
}

console.error('stamp-sw: ghi mãi vẫn bị đè, không đóng dấu được sw.js.');
process.exit(1);
