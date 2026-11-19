// Sinh cặp khoá VAPID cho thông báo đẩy điện thoại.
//   node tools/generate-vapid-keys.mjs          -> in ra màn hình
//   node tools/generate-vapid-keys.mjs --write  -> thêm vào .env nếu chưa có
// CẢNH BÁO: chỉ sinh khoá MỚI khi hệ thống chưa từng bật thông báo. Đổi khoá
// thì mọi điện thoại đã đăng ký phải bật lại thông báo.
import { readFileSync, appendFileSync, existsSync } from 'node:fs';
import webpush from 'web-push';

const keys = webpush.generateVAPIDKeys();
const block = `\nVAPID_PUBLIC_KEY=${keys.publicKey}\nVAPID_PRIVATE_KEY=${keys.privateKey}\nVAPID_SUBJECT=mailto:admin@huyphongwine.vn\n`;

if (process.argv.includes('--write')) {
  const file = '.env';
  if (existsSync(file) && /^VAPID_PUBLIC_KEY=.+/m.test(readFileSync(file, 'utf8'))) {
    console.error('.env đã có VAPID_PUBLIC_KEY — không ghi đè.');
    process.exit(1);
  }
  appendFileSync(file, block);
  console.log('Đã thêm VAPID_* vào .env. Nhớ thêm đúng 3 biến này vào Vercel / /opt/hrm/.env.');
} else {
  console.log(block.trim());
}
